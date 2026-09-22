// Edge Function: connect-stripe-account
// ---------------------------------------------------------------
// Cria (ou retoma) uma conta Stripe Express para um restaurante ou
// entregador, e devolve o link de onboarding do próprio Stripe para o
// navegador redirecionar o usuário. É nessa conta que o saque vai cair.
//
// Recebe: { type: 'restaurante' | 'entregador', id }
//   - type 'restaurante': id é o id do restaurante.
//   - type 'entregador': id é o id do usuário (auth.users.id) do entregador.
// Devolve: { url }
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

async function stripeRequest(path: string, secretKey: string, params: URLSearchParams) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + secretKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Erro na chamada ao Stripe.");
  return data;
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

    let table: "restaurants" | "profiles";
    let idColumn: string;
    let email = authData.user.email || undefined;

    if (type === "restaurante") {
      const { data: restaurant, error } = await supabase
        .from("restaurants")
        .select("id, owner_id, stripe_account_id")
        .eq("id", id)
        .single();
      if (error || !restaurant) return jsonResponse({ error: "Restaurante não encontrado." }, 404);
      if (restaurant.owner_id !== callerId) return jsonResponse({ error: "Esta conta não é dona deste restaurante." }, 403);
      table = "restaurants";
      idColumn = restaurant.id;
      var existingAccountId = restaurant.stripe_account_id;
    } else if (type === "entregador") {
      if (id !== callerId) return jsonResponse({ error: "Você só pode conectar a própria conta." }, 403);
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, stripe_account_id")
        .eq("id", id)
        .single();
      if (error || !profile) return jsonResponse({ error: "Perfil não encontrado." }, 404);
      table = "profiles";
      idColumn = profile.id;
      var existingAccountId2 = profile.stripe_account_id;
    } else {
      return jsonResponse({ error: "type deve ser 'restaurante' ou 'entregador'." }, 400);
    }

    let accountId = type === "restaurante" ? existingAccountId : existingAccountId2;

    if (!accountId) {
      const params = new URLSearchParams();
      params.set("type", "express");
      params.set("country", "BR");
      if (email) params.set("email", email);
      params.set("capabilities[transfers][requested]", "true");
      const account = await stripeRequest("accounts", STRIPE_SECRET_KEY, params);
      accountId = account.id;

      await supabase.from(table).update({ stripe_account_id: accountId }).eq("id", idColumn);
    }

    const origin = req.headers.get("origin") || "https://example.com";
    const linkParams = new URLSearchParams();
    linkParams.set("account", accountId);
    linkParams.set("refresh_url", origin + "/" + (type === "restaurante" ? "restaurante.html" : "entregador.html"));
    linkParams.set("return_url", origin + "/" + (type === "restaurante" ? "restaurante.html" : "entregador.html"));
    linkParams.set("type", "account_onboarding");
    const accountLink = await stripeRequest("account_links", STRIPE_SECRET_KEY, linkParams);

    return jsonResponse({ url: accountLink.url });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
