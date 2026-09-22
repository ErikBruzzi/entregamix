// Edge Function: stripe-webhook
// ---------------------------------------------------------------
// O Stripe chama esta função automaticamente quando o status de um
// pagamento muda. É AQUI, e só aqui, que confiamos que o cliente pagou
// de verdade — nunca no navegador dele.
//
// Ao confirmar um pagamento (payment_intent.succeeded):
//   1. Marca o pedido como payment_status = 'pago'.
//   2. Credita o saldo do restaurante: valor da comida menos a comissão
//      da plataforma (taxa configurada em platform_settings).
//
// Configuração necessária no painel do Stripe:
//   Developers > Webhooks > Add endpoint
//   URL: https://SEU-PROJETO.supabase.co/functions/v1/stripe-webhook
//   Evento: payment_intent.succeeded
//   Depois de criar, copie o "Signing secret" (começa com whsec_) e
//   guarde como STRIPE_WEBHOOK_SECRET nos secrets desta função.
// ---------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Verifica a assinatura do Stripe manualmente (sem depender do SDK oficial,
// que não roda bem em Deno). Segue exatamente o algoritmo documentado pelo
// Stripe: HMAC-SHA256 de "timestamp.payload_bruto" usando o webhook secret.
async function verifyStripeSignature(payload: string, signatureHeader: string, secret: string) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("=") as [string, string])
  );
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const signedPayload = timestamp + "." + payload;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return expected === signature;
}

Deno.serve(async (req) => {
  try {
    const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!STRIPE_WEBHOOK_SECRET) {
      return jsonResponse({ error: "STRIPE_WEBHOOK_SECRET não configurada." }, 500);
    }

    const rawBody = await req.text();
    const signatureHeader = req.headers.get("stripe-signature") || "";
    const isValid = await verifyStripeSignature(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET);
    if (!isValid) {
      return jsonResponse({ error: "Assinatura inválida." }, 400);
    }

    const event = JSON.parse(rawBody);

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      const orderId = paymentIntent.metadata?.order_id;
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

      // Evita creditar duas vezes se o Stripe reenviar o mesmo evento.
      if (order.payment_status === "pago") return jsonResponse({ received: true });

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

      // Credita o saldo do restaurante somando ao valor atual (evita
      // condição de corrida entre pedidos simultâneos).
      await supabase.rpc("increment_restaurant_balance", {
        p_restaurant_id: order.restaurant_id,
        p_amount: restaurantCredit,
      });
    }

    if (event.type === "payment_intent.payment_failed") {
      const paymentIntent = event.data.object;
      const orderId = paymentIntent.metadata?.order_id;
      if (orderId) {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        await supabase
          .from("orders")
          .update({ payment_status: "falhou", status: "cancelado" })
          .eq("id", orderId)
          .eq("payment_status", "pendente"); // nunca sobrescreve um pedido já pago
      }
    }

    return jsonResponse({ received: true });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
