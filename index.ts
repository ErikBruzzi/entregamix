// Edge Function: create-mp-payment
// ---------------------------------------------------------------
// Recebe os dados do pedido + os dados de pagamento coletados pelo
// "Payment Brick" do Mercado Pago no navegador do cliente, cria o pedido
// no banco (ainda pendente) e processa a cobrança de verdade via API do
// Mercado Pago (POST /v1/payments) — o dinheiro vai para a conta Mercado
// Pago do PRÓPRIO aplicativo.
//
// Para pagamento no cartão, o Mercado Pago normalmente já aprova na hora
// (retornamos status "approved" e o front-end libera o pedido). Para PIX,
// o pagamento fica "pending" até o cliente realmente pagar o QR code — o
// pedido só passa a "pago" de verdade quando o mp-webhook confirmar.
//
// Devolve: { orderId, status, qrCode?, qrCodeBase64? }
// ---------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN");
    if (!MP_ACCESS_TOKEN) return jsonResponse({ error: "MP_ACCESS_TOKEN não configurada nesta função." }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const userToken = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let userId: string | null = null;
    if (userToken) {
      const { data: userData } = await supabase.auth.getUser(userToken);
      userId = userData?.user?.id ?? null;
    }

    const {
      restaurantId,
      items,
      address,
      deliveryCity,
      foodSubtotal,
      deliveryFee,
      deliveryDistanceKm,
      total,
      formData, // vem do Payment Brick: { token?, payment_method_id, installments?, payer, ... }
    } = await req.json();

    if (!restaurantId || !items?.length || !address || !total || !formData) {
      return jsonResponse({ error: "Dados incompletos para criar o pagamento." }, 400);
    }

    // 1) Cria o pedido no banco, ainda como pendente de pagamento.
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        user_id: userId,
        restaurant_id: restaurantId,
        address,
        delivery_city: deliveryCity,
        food_subtotal: foodSubtotal,
        delivery_fee: deliveryFee,
        delivery_distance_km: deliveryDistanceKm,
        total,
        status: "aguardando_pagamento",
        payment_status: "pendente",
      })
      .select()
      .single();
    if (orderError) throw orderError;

    const orderItems = items.map((it: any) => ({
      order_id: order.id,
      menu_item_id: it.id,
      name: it.name,
      price: it.price,
      quantity: it.quantity,
    }));
    const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
    if (itemsError) throw itemsError;

    // 2) Processa o pagamento de verdade no Mercado Pago.
    const paymentBody = {
      ...formData,
      transaction_amount: Number(total),
      description: "Pedido Mix #" + order.id.slice(0, 8),
      external_reference: order.id,
      notification_url: Deno.env.get("SUPABASE_URL") + "/functions/v1/mp-webhook",
    };

    const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + MP_ACCESS_TOKEN,
        "Content-Type": "application/json",
        "X-Idempotency-Key": order.id,
      },
      body: JSON.stringify(paymentBody),
    });
    const payment = await mpRes.json();
    if (!mpRes.ok) {
      await supabase.from("orders").update({ payment_status: "falhou", status: "cancelado" }).eq("id", order.id);
      throw new Error(payment?.message || "Não foi possível processar o pagamento.");
    }

    await supabase.from("orders").update({ mp_payment_id: String(payment.id) }).eq("id", order.id);

    // Se o Mercado Pago já aprovou na hora (comum em cartão), atualiza direto
    // — mas o webhook é sempre a fonte de verdade final, isso é só para o
    // cliente não precisar esperar a confirmação assíncrona nesse caso comum.
    if (payment.status === "approved") {
      await supabase.from("orders").update({ payment_status: "pago", status: "recebido" }).eq("id", order.id);
    }

    const pixData = payment.point_of_interaction?.transaction_data;

    return jsonResponse({
      orderId: order.id,
      status: payment.status, // approved | pending | in_process | rejected
      qrCode: pixData?.qr_code,
      qrCodeBase64: pixData?.qr_code_base64,
    });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
