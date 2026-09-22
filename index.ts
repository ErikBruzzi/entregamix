// Edge Function: create-payment-intent
// ---------------------------------------------------------------
// Recebe os dados do pedido, cria a cobrança no Stripe (o dinheiro vai
// para a conta Stripe do PRÓPRIO aplicativo) e grava o pedido no banco
// com payment_status = 'pendente'. Só depois que o Stripe confirmar o
// pagamento de verdade (via stripe-webhook) é que o pedido passa a
// "pago" e aparece de fato para o restaurante.
//
// Devolve { clientSecret, orderId } — o navegador usa o clientSecret
// com o Stripe.js para coletar o cartão e confirmar o pagamento.
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) {
      return jsonResponse({ error: "STRIPE_SECRET_KEY não configurada nesta função." }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userToken = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Descobre quem é o cliente a partir do token que ele mandou (se houver).
    let userId: string | null = null;
    if (userToken) {
      const { data: userData } = await supabase.auth.getUser(userToken);
      userId = userData?.user?.id ?? null;
    }

    const {
      restaurantId,
      items, // [{ id, name, price, quantity }]
      address,
      deliveryCity,
      foodSubtotal,
      deliveryFee,
      deliveryDistanceKm,
      total,
    } = await req.json();

    if (!restaurantId || !items?.length || !address || !total) {
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

    // 2) Cria a cobrança no Stripe, em centavos.
    const amountInCents = Math.round(Number(total) * 100);
    const params = new URLSearchParams();
    params.set("amount", String(amountInCents));
    params.set("currency", "brl");
    params.set("metadata[order_id]", order.id);
    params.append("automatic_payment_methods[enabled]", "true");

    const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + STRIPE_SECRET_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const paymentIntent = await stripeRes.json();
    if (!stripeRes.ok) {
      throw new Error(paymentIntent?.error?.message || "Não foi possível criar a cobrança no Stripe.");
    }

    // Guarda o id do PaymentIntent no pedido, para o webhook conseguir achar
    // este pedido de volta quando o pagamento for confirmado.
    await supabase
      .from("orders")
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq("id", order.id);

    return jsonResponse({ clientSecret: paymentIntent.client_secret, orderId: order.id });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
