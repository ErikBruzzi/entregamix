// Edge Function: request-payout
// ---------------------------------------------------------------
// Transfere o saldo atual do restaurante/entregador da conta Stripe do
// aplicativo para a conta Stripe conectada dele, e zera o saldo no banco.
//
// Recebe: { type: 'restaurante' | 'entregador', id }
// Devolve: { amount, transferId }
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
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) return jsonResponse({ error: "STRIPE_SECRET_KEY não configurada." }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const userToken = authHeader.replace("Bearer ", "");
    if (!userToken) return jsonResponse({ error: "Não autenticado." }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: authData, error: authError } = await supabase.auth.getUser(userToken);
    if (authError || !authData?.user) return jsonResponse({ error: "Sessão inválida." }, 401);
    const callerId = authData.user.id;

    const { type, id } = await req.json();
    if (!type || !id) return jsonResponse({ error: "Informe type e id." }, 400);

    let balance: number;
    let stripeAccountId: string | null;
    let table: "restaurants" | "profiles";
    let recipientId: string; // sempre o id do usuário dono, para o histórico de saques

    if (type === "restaurante") {
      const { data: restaurant, error } = await supabase
        .from("restaurants")
        .select("id, owner_id, balance, stripe_account_id")
        .eq("id", id)
        .single();
      if (error || !restaurant) return jsonResponse({ error: "Restaurante não encontrado." }, 404);
      if (restaurant.owner_id !== callerId) return jsonResponse({ error: "Esta conta não é dona deste restaurante." }, 403);
      balance = Number(restaurant.balance || 0);
      stripeAccountId = restaurant.stripe_account_id;
      table = "restaurants";
      recipientId = restaurant.owner_id;
    } else if (type === "entregador") {
      if (id !== callerId) return jsonResponse({ error: "Você só pode sacar da própria conta." }, 403);
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, balance, stripe_account_id")
        .eq("id", id)
        .single();
      if (error || !profile) return jsonResponse({ error: "Perfil não encontrado." }, 404);
      balance = Number(profile.balance || 0);
      stripeAccountId = profile.stripe_account_id;
      table = "profiles";
      recipientId = profile.id;
    } else {
      return jsonResponse({ error: "type deve ser 'restaurante' ou 'entregador'." }, 400);
    }

    if (!stripeAccountId) {
      return jsonResponse({ error: "Conecte sua conta Stripe antes de sacar." }, 400);
    }
    if (!balance || balance <= 0) {
      return jsonResponse({ error: "Você não tem saldo disponível para sacar." }, 400);
    }

    // Confere se a conta Stripe já terminou o cadastro e pode receber transferências.
    const accountRes = await fetch("https://api.stripe.com/v1/accounts/" + stripeAccountId, {
      headers: { Authorization: "Bearer " + STRIPE_SECRET_KEY },
    });
    const account = await accountRes.json();
    if (!accountRes.ok) throw new Error(account?.error?.message || "Não foi possível verificar sua conta Stripe.");
    if (!account.payouts_enabled) {
      return jsonResponse({ error: "Sua conta Stripe ainda não terminou o cadastro. Finalize o onboarding antes de sacar." }, 400);
    }

    const amountInCents = Math.round(balance * 100);
    const params = new URLSearchParams();
    params.set("amount", String(amountInCents));
    params.set("currency", "brl");
    params.set("destination", stripeAccountId);
    const transferRes = await fetch("https://api.stripe.com/v1/transfers", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + STRIPE_SECRET_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const transfer = await transferRes.json();
    if (!transferRes.ok) throw new Error(transfer?.error?.message || "Não foi possível transferir o saldo.");

    // Desconta exatamente o valor transferido (não zera direto, por segurança
    // contra qualquer crédito que possa ter chegado entre a leitura e agora).
    await supabase
      .from(table)
      .update({ balance: balance - amountInCents / 100 })
      .eq("id", id);

    await supabase.from("payouts").insert({
      recipient_type: type,
      recipient_id: recipientId,
      amount: amountInCents / 100,
      stripe_transfer_id: transfer.id,
      status: "concluido",
    });

    return jsonResponse({ amount: amountInCents / 100, transferId: transfer.id });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
