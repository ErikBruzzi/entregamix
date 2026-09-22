// Edge Function: request-mp-payout
// ---------------------------------------------------------------
// Transfere o saldo atual do restaurante/entregador da conta Mercado Pago
// do aplicativo para a chave PIX cadastrada por ele, e desconta o saldo
// no banco. Usa a API de Payouts (Money Out) do Mercado Pago.
//
// IMPORTANTE — configuração necessária antes de usar:
//   1. A conta Mercado Pago do APLICATIVO precisa ter uma chave PIX
//      própria já cadastrada (Suas integrações > Payouts, ou dentro do
//      próprio app Mercado Pago).
//   2. Em produção, o Mercado Pago exige uma assinatura extra (X-signature)
//      nessas chamadas, gerada com um par de chaves pública/privada do
//      integrador. Esta função envia X-enforce-signature: false, que
//      funciona em testes; antes de operar com dinheiro real, confirme
//      com o suporte do Mercado Pago se sua integração já está habilitada
//      para Payouts em produção sem essa assinatura, ou implemente-a
//      seguindo a documentação oficial de Payouts.
//
// Recebe: { type: 'restaurante' | 'entregador', id }
// Devolve: { amount, transactionId }
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
    if (!MP_ACCESS_TOKEN) return jsonResponse({ error: "MP_ACCESS_TOKEN não configurada." }, 500);

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
    let pixKey: string | null;
    let pixKeyType: string | null;
    let pixOwnerDocument: string | null;
    let table: "restaurants" | "profiles";
    let recipientId: string;

    if (type === "restaurante") {
      const { data: restaurant, error } = await supabase
        .from("restaurants")
        .select("id, owner_id, balance, pix_key, pix_key_type, pix_owner_document")
        .eq("id", id)
        .single();
      if (error || !restaurant) return jsonResponse({ error: "Restaurante não encontrado." }, 404);
      if (restaurant.owner_id !== callerId) return jsonResponse({ error: "Esta conta não é dona deste restaurante." }, 403);
      balance = Number(restaurant.balance || 0);
      pixKey = restaurant.pix_key;
      pixKeyType = restaurant.pix_key_type;
      pixOwnerDocument = restaurant.pix_owner_document;
      table = "restaurants";
      recipientId = restaurant.owner_id;
    } else if (type === "entregador") {
      if (id !== callerId) return jsonResponse({ error: "Você só pode sacar da própria conta." }, 403);
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, balance, pix_key, pix_key_type, pix_owner_document")
        .eq("id", id)
        .single();
      if (error || !profile) return jsonResponse({ error: "Perfil não encontrado." }, 404);
      balance = Number(profile.balance || 0);
      pixKey = profile.pix_key;
      pixKeyType = profile.pix_key_type;
      pixOwnerDocument = profile.pix_owner_document;
      table = "profiles";
      recipientId = profile.id;
    } else {
      return jsonResponse({ error: "type deve ser 'restaurante' ou 'entregador'." }, 400);
    }

    if (!pixKey || !pixKeyType || !pixOwnerDocument) {
      return jsonResponse({ error: "Cadastre sua chave PIX (e o CPF/CNPJ do titular) antes de sacar." }, 400);
    }
    if (!balance || balance <= 0) {
      return jsonResponse({ error: "Você não tem saldo disponível para sacar." }, 400);
    }

    const amount = Math.round(balance * 100) / 100;
    const documentDigits = pixOwnerDocument.replace(/\D/g, "");
    const documentType = documentDigits.length > 11 ? "CNPJ" : "CPF";

    const payoutBody = {
      external_reference: "payout-" + table + "-" + id + "-" + Date.now(),
      point_of_interaction: { type: "PSP_TRANSFER" },
      seller_configuration: {
        notification_info: {
          notification_url: Deno.env.get("SUPABASE_URL") + "/functions/v1/mp-webhook",
        },
      },
      transaction: {
        from: { accounts: [{ amount }] },
        to: {
          accounts: [
            {
              type: "current",
              amount,
              chave: { type: pixKeyType, value: pixKey },
              owner: { identification: { type: documentType, number: documentDigits } },
            },
          ],
        },
        total_amount: amount,
      },
    };

    const payoutRes = await fetch("https://api.mercadopago.com/v1/transaction-intents/process", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + MP_ACCESS_TOKEN,
        "Content-Type": "application/json",
        "X-Idempotency-Key": crypto.randomUUID(),
        "X-enforce-signature": "false",
      },
      body: JSON.stringify(payoutBody),
    });
    const payoutResult = await payoutRes.json();
    if (!payoutRes.ok) {
      throw new Error(payoutResult?.message || payoutResult?.error || "Não foi possível transferir o saldo.");
    }

    // Desconta exatamente o valor transferido (não zera direto, por segurança
    // contra qualquer crédito que possa ter chegado entre a leitura e agora).
    await supabase
      .from(table)
      .update({ balance: balance - amount })
      .eq("id", id);

    await supabase.from("payouts").insert({
      recipient_type: type,
      recipient_id: recipientId,
      amount,
      mp_transaction_id: payoutResult.id || null,
      status: "concluido",
    });

    return jsonResponse({ amount, transactionId: payoutResult.id || null });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
