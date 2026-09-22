// Edge Function: mp-webhook
// ---------------------------------------------------------------
// O Mercado Pago chama esta função quando o status de um pagamento muda
// (notificação simples, só com o id — por isso sempre buscamos os dados
// completos de volta na API deles, nunca confiando só no que veio na
// notificação). É AQUI, e só aqui, que confiamos que o cliente pagou de
// verdade — nunca no navegador dele.
//
// Ao confirmar um pagamento (status "approved"):
//   1. Marca o pedido como payment_status = 'pago' e status = 'recebido'.
//   2. Credita o saldo do restaurante: valor da comida menos a comissão
//      da plataforma (taxa configurada em platform_settings).
//
// Configuração necessária no painel do Mercado Pago:
//   Suas integrações > (sua aplicação) > Webhooks > Configurar notificações
//   URL: https://SEU-PROJETO.supabase.co/functions/v1/mp-webhook
//   Eventos: Pagamentos
//   Copie a "Chave secreta" mostrada ali e guarde como MP_WEBHOOK_SECRET
//   nos secrets desta função.
// ---------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function verifyMpSignature(
  dataId: string,
  requestId: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k.trim(), v];
    })
  );
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const expected = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return expected === v1;
}

Deno.serve(async (req) => {
  try {
    const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN");
    const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET");
    if (!MP_ACCESS_TOKEN) return jsonResponse({ error: "MP_ACCESS_TOKEN não configurada." }, 500);

    const url = new URL(req.url);
    const dataId = url.searchParams.get("data.id") || url.searchParams.get("id");
    const type = url.searchParams.get("type") || url.searchParams.get("topic");

    if (MP_WEBHOOK_SECRET) {
      const signatureHeader = req.headers.get("x-signature") || "";
      const requestId = req.headers.get("x-request-id") || "";
      const isValid = dataId
        ? await verifyMpSignature(dataId, requestId, signatureHeader, MP_WEBHOOK_SECRET)
        : false;
      if (!isValid) return jsonResponse({ error: "Assinatura inválida." }, 400);
    }

    if (type !== "payment" || !dataId) {
      return jsonResponse({ received: true });
    }

    // Nunca confie no corpo da notificação — busca os dados reais e
    // atualizados do pagamento direto na API do Mercado Pago.
    const paymentRes = await fetch("https://api.mercadopago.com/v1/payments/" + dataId, {
      headers: { Authorization: "Bearer " + MP_ACCESS_TOKEN },
    });
    const payment = await paymentRes.json();
    if (!paymentRes.ok) return jsonResponse({ received: true });

    const orderId = payment.external_reference;
    if (!orderId) return jsonResponse({ received: true });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, restaurant_id, food_subtotal, payment_status")
      .eq("id", orderId)
      .single();
    if (orderError || !order) return jsonResponse({ received: true });

    // Evita creditar duas vezes se o Mercado Pago reenviar a mesma notificação.
    if (order.payment_status === "pago") return jsonResponse({ received: true });

    if (payment.status === "approved") {
      const { data: settings } = await supabase
        .from("platform_settings")
        .select("commission_percent, commission_fixed")
        .eq("id", true)
        .single();

      const commissionPercent = Number(settings?.commission_percent ?? 10);
      const commissionFixed = Number(settings?.commission_fixed ?? 0);
      const foodSubtotal = Number(order.food_subtotal ?? 0);
      const commission = foodSubtotal * (commissionPercent / 100) + commissionFixed;
      const restaurantCredit = Math.max(0, Math.round((foodSubtotal - commission) * 100) / 100);

      await supabase.from("orders").update({ payment_status: "pago", status: "recebido" }).eq("id", orderId);

      await supabase.rpc("increment_restaurant_balance", {
        p_restaurant_id: order.restaurant_id,
        p_amount: restaurantCredit,
      });
    } else if (payment.status === "rejected" || payment.status === "cancelled") {
      await supabase
        .from("orders")
        .update({ payment_status: "falhou", status: "cancelado" })
        .eq("id", orderId)
        .eq("payment_status", "pendente");
    }

    return jsonResponse({ received: true });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
