// Edge Function: calculate-delivery-fee
// ---------------------------------------------------------------
// Recebe { restaurantId, address, city } e devolve { distanceKm, durationMin, fee }.
//
// Usa a LocationIQ (baseada no OpenStreetMap) em vez do Google Maps —
// tem plano gratuito generoso e não exige cadastrar cartão de crédito.
// A chave fica guardada como "secret" desta função no Supabase, nunca
// aparece no navegador.
//
// Fluxo:
//   1. Busca o restaurante no banco (usando a service role key, que tem
//      acesso total e só existe aqui no servidor, nunca no site).
//   2. Se o restaurante ainda não tem lat/lng guardados, geocodifica
//      "endereço + cidade" dele UMA vez e salva no banco.
//   3. Geocodifica "endereço + cidade" informados pelo cliente.
//   4. Pergunta à LocationIQ a distância de carro entre os dois pontos.
//   5. Se a distância vier maior que MAX_DISTANCIA_KM, recusa — é sinal
//      de que a busca encontrou um lugar errado (endereço ambíguo).
//   6. Calcula: taxa = taxa_base + preço_por_km × distância_km.
// ---------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_DISTANCIA_KM = 60; // acima disso, quase certamente é erro de geocodificação

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

async function geocode(address: string, city: string | null, apiKey: string) {
  const fullQuery = city ? address + ", " + city : address;
  const url =
    "https://us1.locationiq.com/v1/search?key=" +
    apiKey +
    "&q=" +
    encodeURIComponent(fullQuery) +
    "&countrycodes=br" + // restringe a busca ao Brasil, evita achar endereço em outro país
    "&format=json&limit=1";
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || !Array.isArray(data) || !data.length) {
    throw new Error("Não foi possível localizar o endereço: " + fullQuery + ". Confira se a cidade está certa.");
  }
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

async function drivingDistance(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  apiKey: string
) {
  const coords = origin.lng + "," + origin.lat + ";" + destination.lng + "," + destination.lat;
  const url =
    "https://us1.locationiq.com/v1/directions/driving/" +
    coords +
    "?key=" + apiKey + "&overview=false";
  const res = await fetch(url);
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!res.ok || !route) {
    throw new Error("Não foi possível calcular a rota entre os dois endereços.");
  }
  return {
    distanceKm: route.distance / 1000, // a LocationIQ devolve em metros
    durationMin: Math.round(route.duration / 60), // e em segundos
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { restaurantId, address, city } = await req.json();
    if (!restaurantId || !address) {
      return jsonResponse({ error: "Informe restaurantId e address." }, 400);
    }
    if (!city || !String(city).trim()) {
      return jsonResponse({ error: "Informe a cidade de entrega para calcular o frete com precisão." }, 400);
    }

    const LOCATIONIQ_API_KEY = Deno.env.get("LOCATIONIQ_API_KEY");
    if (!LOCATIONIQ_API_KEY) {
      return jsonResponse({ error: "LOCATIONIQ_API_KEY não configurada nesta função." }, 500);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: restaurant, error: fetchError } = await supabase
      .from("restaurants")
      .select("id, address, city, lat, lng, delivery_base_fee, delivery_price_per_km")
      .eq("id", restaurantId)
      .single();
    if (fetchError || !restaurant) {
      return jsonResponse({ error: "Restaurante não encontrado." }, 404);
    }

    let origin = { lat: restaurant.lat, lng: restaurant.lng };
    if (origin.lat == null || origin.lng == null) {
      if (!restaurant.address) {
        return jsonResponse({ error: "Este restaurante ainda não tem um endereço cadastrado." }, 400);
      }
      origin = await geocode(restaurant.address, restaurant.city, LOCATIONIQ_API_KEY);
      // Guarda para as próximas vezes não precisarem geocodificar de novo.
      await supabase.from("restaurants").update({ lat: origin.lat, lng: origin.lng }).eq("id", restaurantId);
    }

    const destination = await geocode(address, city, LOCATIONIQ_API_KEY);
    const { distanceKm, durationMin } = await drivingDistance(origin, destination, LOCATIONIQ_API_KEY);

    if (distanceKm > MAX_DISTANCIA_KM) {
      return jsonResponse(
        {
          error:
            "O endereço informado parece estar a " +
            Math.round(distanceKm) +
            " km do restaurante, o que é longe demais. Confira se digitou a rua e a cidade corretamente.",
        },
        422
      );
    }

    const baseFee = Number(restaurant.delivery_base_fee ?? 5);
    const pricePerKm = Number(restaurant.delivery_price_per_km ?? 1.5);
    const fee = Math.round((baseFee + pricePerKm * distanceKm) * 100) / 100;

    return jsonResponse({ distanceKm: Math.round(distanceKm * 10) / 10, durationMin, fee });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
