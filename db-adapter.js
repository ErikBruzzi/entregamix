/*
  CAMADA DE ACESSO A DADOS (DATA ACCESS LAYER)
  ---------------------------------------------
  Única parte do app que sabe que existe um banco chamado Supabase.
  Para trocar de banco no futuro, reescreva este arquivo mantendo os
  mesmos nomes de função e formatos de retorno.

  Contrato da interface window.DB (todas as funções são assíncronas):
    Conta / sessão:
    - signUp({ name, email, phone, password, role })  -> { user }
    - signIn({ email, password })                      -> { user }
    - signOut()                                        -> void
    - getSession()                                     -> { user } | null
    - onAuthChange(callback)                           -> void
    - getProfile(userId)                               -> { name, email, phone, address, role }
    - updateProfile(userId, data)                      -> { profile }

    Cliente:
    - getRestaurants()                                 -> [{ id, name, category, etaMinutes, deliveryBaseFee }]
    - calculateDeliveryFee(restaurantId, address)      -> { distanceKm, durationMin, fee }  (usa a Edge Function + Google Maps)
    - getMenu(restaurantId)                            -> [{ id, name, description, price, imageUrl }]
    - createOrder({ restaurantId, items, address, foodSubtotal, deliveryFee, deliveryDistanceKm, total }) -> { order }
    - getOrders(userId)                                -> [{ id, restaurantName, status, total, foodSubtotal, deliveryFee, createdAt, items, courierId }]

    Restaurante (dono):
    - getMyRestaurant(ownerId)                         -> { id, name, category, address, etaMinutes, deliveryBaseFee, deliveryPricePerKm, active }
    - updateMyRestaurant(restaurantId, data)           -> { restaurant }  (data pode incluir deliveryBaseFee, deliveryPricePerKm)
    - getMyMenu(restaurantId)                          -> [{ id, name, description, price, available, imageUrl }]
    - createMenuItem(restaurantId, data)               -> { item }  (data pode incluir imageUrl)
    - updateMenuItem(itemId, data)                     -> { item }
    - deleteMenuItem(itemId)                           -> void
    - uploadMenuImage(restaurantId, file)              -> url (string) — envie o resultado como imageUrl
    - getRestaurantOrders(restaurantId)                -> [{ id, status, total, createdAt, address, courierId, pickupCode, items }]
    - updateOrderStatus(orderId, status)               -> void

    Entregador:
    - getAvailableDeliveries()                         -> [{ id, restaurantName, restaurantAddress, address, total, createdAt }]
    - getMyDeliveries(courierId)                       -> [{ id, restaurantName, restaurantAddress, address, total, status, pickupCode, createdAt }]
    - claimDelivery(orderId, courierId)                -> { order }  (lança erro se outro entregador já pegou)
    - confirmPickup(orderId)                           -> void  (status -> a_caminho)
    - confirmDelivery(orderId)                         -> void  (status -> entregue)

    Chat (usado pelos três papéis, um pedido pode ter até 2 conversas):
    - getMessages(orderId, channel)                    -> [{ id, senderId, senderRole, content, createdAt }]
      channel é 'restaurante' (cliente↔restaurante) ou 'entregador' (cliente↔entregador)
    - sendMessage(orderId, channel, content, senderRole) -> { message }
    - subscribeToMessages(orderId, channel, onMessage) -> subscription (guarde para poder cancelar)
    - unsubscribe(subscription)                        -> void
*/

(function () {
  const config = window.APP_CONFIG || {};
  const isConfigured =
    config.SUPABASE_URL &&
    !config.SUPABASE_URL.includes("COLE_A_URL") &&
    config.SUPABASE_ANON_KEY &&
    !config.SUPABASE_ANON_KEY.includes("COLE_SUA_CHAVE");

  function showDemoBanner() {
    document.addEventListener("DOMContentLoaded", () => {
      const banner = document.createElement("div");
      banner.textContent =
        "Modo demonstração: dados temporários, sem conexão com o Supabase. Configure config.js para ativar o banco de dados real.";
      banner.style.cssText =
        "position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#171717;color:#fff;font:600 12px/1.4 Inter,sans-serif;text-align:center;padding:8px 12px;";
      document.body.appendChild(banner);
    });
  }

  function genCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  /* ---------------------------------------------------------------------
     ADAPTADOR SUPABASE
  --------------------------------------------------------------------- */
  function buildSupabaseAdapter() {
    const client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

    return {
      /* ---------- CONTA / SESSÃO ---------- */
      async signUp({ name, email, phone, password, role, city }) {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { name, phone, role: role || "cliente", city: city || null } },
        });
        if (error) throw error;
        return { user: data.user };
      },

      async signIn({ email, password }) {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return { user: data.user };
      },

      async signOut() {
        await client.auth.signOut();
      },

      async getSession() {
        const { data } = await client.auth.getSession();
        return data.session ? { user: data.session.user } : null;
      },

      onAuthChange(callback) {
        client.auth.onAuthStateChange((_event, session) => {
          callback(session ? session.user : null);
        });
      },

      async getProfile(userId) {
        const { data, error } = await client
          .from("profiles")
          .select("name, email, phone, address, role, city")
          .eq("id", userId)
          .maybeSingle();
        if (error) throw error;
        if (data) return data;

        // Login sem perfil correspondente (ex.: criado antes do gatilho automático).
        const { data: authData } = await client.auth.getUser();
        const email = authData && authData.user ? authData.user.email : "";
        const { data: created, error: createError } = await client
          .from("profiles")
          .insert({ id: userId, name: "", email, phone: "", address: "", role: "cliente" })
          .select()
          .single();
        if (createError) throw createError;
        return created;
      },

      async updateProfile(userId, updates) {
        const { data, error } = await client
          .from("profiles")
          .update(updates)
          .eq("id", userId)
          .select()
          .single();
        if (error) throw error;
        return { profile: data };
      },

      /* ---------- CLIENTE ---------- */
      async getRestaurants() {
        const { data, error } = await client
          .from("restaurants")
          .select("id, name, category, city, eta_minutes, delivery_base_fee")
          .eq("active", true);
        if (error) throw error;
        return (data || []).map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          city: r.city,
          etaMinutes: r.eta_minutes,
          deliveryBaseFee: r.delivery_base_fee,
        }));
      },

      async calculateDeliveryFee(restaurantId, address, city) {
        const res = await fetch(config.SUPABASE_URL + "/functions/v1/calculate-delivery-fee", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: config.SUPABASE_ANON_KEY,
            Authorization: "Bearer " + config.SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ restaurantId, address, city }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Não foi possível calcular a taxa de entrega.");
        return data; // { distanceKm, durationMin, fee }
      },

      async getMenu(restaurantId) {
        const { data, error } = await client
          .from("menu_items")
          .select("id, name, description, price, image_url")
          .eq("restaurant_id", restaurantId)
          .eq("available", true);
        if (error) throw error;
        return (data || []).map((it) => ({
          id: it.id,
          name: it.name,
          description: it.description,
          price: it.price,
          imageUrl: it.image_url,
        }));
      },

      async createOrder({ restaurantId, items, address, deliveryCity, foodSubtotal, deliveryFee, deliveryDistanceKm, total }) {
        const session = await this.getSession();
        const userId = session ? session.user.id : null;
        const { data, error } = await client
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
            status: "recebido",
          })
          .select()
          .single();
        if (error) throw error;

        const orderItems = items.map((it) => ({
          order_id: data.id,
          menu_item_id: it.id,
          name: it.name,
          price: it.price,
          quantity: it.quantity,
        }));
        const { error: itemsError } = await client.from("order_items").insert(orderItems);
        if (itemsError) throw itemsError;

        return { order: data };
      },

      async getOrders(userId) {
        const { data, error } = await client
          .from("orders")
          .select(
            "id, status, total, food_subtotal, delivery_fee, created_at, courier_id, restaurants(name), order_items(name, price, quantity)"
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return (data || []).map((o) => ({
          id: o.id,
          restaurantName: o.restaurants ? o.restaurants.name : "Restaurante",
          status: o.status,
          total: o.total,
          foodSubtotal: o.food_subtotal,
          deliveryFee: o.delivery_fee,
          createdAt: o.created_at,
          items: o.order_items || [],
          courierId: o.courier_id,
        }));
      },

      /* ---------- RESTAURANTE (DONO) ---------- */
      async getMyRestaurant(ownerId) {
        const { data, error } = await client
          .from("restaurants")
          .select("id, name, category, address, city, eta_minutes, delivery_base_fee, delivery_price_per_km, active")
          .eq("owner_id", ownerId)
          .maybeSingle();
        if (error) throw error;
        if (!data) return null;
        return {
          id: data.id,
          name: data.name,
          category: data.category,
          address: data.address,
          city: data.city,
          etaMinutes: data.eta_minutes,
          deliveryBaseFee: data.delivery_base_fee,
          deliveryPricePerKm: data.delivery_price_per_km,
          active: data.active,
        };
      },

      async updateMyRestaurant(restaurantId, updates) {
        const payload = {};
        if (updates.name !== undefined) payload.name = updates.name;
        if (updates.category !== undefined) payload.category = updates.category;
        if (updates.address !== undefined) {
          payload.address = updates.address;
          // Endereço mudou: limpa as coordenadas guardadas para forçar uma
          // nova geocodificação na próxima vez que alguém calcular o frete.
          payload.lat = null;
          payload.lng = null;
        }
        if (updates.city !== undefined) {
          payload.city = updates.city;
          // Cidade também afeta a geocodificação — limpa por segurança.
          payload.lat = null;
          payload.lng = null;
        }
        if (updates.etaMinutes !== undefined) payload.eta_minutes = updates.etaMinutes;
        if (updates.deliveryBaseFee !== undefined) payload.delivery_base_fee = updates.deliveryBaseFee;
        if (updates.deliveryPricePerKm !== undefined) payload.delivery_price_per_km = updates.deliveryPricePerKm;
        if (updates.active !== undefined) payload.active = updates.active;
        const { data, error } = await client
          .from("restaurants")
          .update(payload)
          .eq("id", restaurantId)
          .select()
          .single();
        if (error) throw error;
        return { restaurant: data };
      },

      async getMyMenu(restaurantId) {
        const { data, error } = await client
          .from("menu_items")
          .select("id, name, description, price, available, image_url")
          .eq("restaurant_id", restaurantId)
          .order("created_at", { ascending: true });
        if (error) throw error;
        return (data || []).map((it) => ({
          id: it.id,
          name: it.name,
          description: it.description,
          price: it.price,
          available: it.available,
          imageUrl: it.image_url,
        }));
      },

      async createMenuItem(restaurantId, item) {
        const { data, error } = await client
          .from("menu_items")
          .insert({
            restaurant_id: restaurantId,
            name: item.name,
            description: item.description || "",
            price: item.price,
            available: item.available !== false,
            image_url: item.imageUrl || null,
          })
          .select()
          .single();
        if (error) throw error;
        return { item: { ...data, imageUrl: data.image_url } };
      },

      async updateMenuItem(itemId, updates) {
        const payload = { ...updates };
        if (payload.imageUrl !== undefined) {
          payload.image_url = payload.imageUrl;
          delete payload.imageUrl;
        }
        const { data, error } = await client
          .from("menu_items")
          .update(payload)
          .eq("id", itemId)
          .select()
          .single();
        if (error) throw error;
        return { item: { ...data, imageUrl: data.image_url } };
      },

      async deleteMenuItem(itemId) {
        const { error } = await client.from("menu_items").delete().eq("id", itemId);
        if (error) throw error;
      },

      async requestUploadToken(restaurantId) {
        const { data, error } = await client
          .from("upload_tokens")
          .insert({ restaurant_id: restaurantId })
          .select()
          .single();
        if (error) throw error;
        return data.token;
      },

      async uploadMenuImage(restaurantId, file) {
        // Pede um código de permissão de uso único antes de enviar (veja o
        // comentário no supabase-schema.sql sobre por que isso é necessário
        // neste projeto). Essa etapa passa pela checagem normal de dono do
        // restaurante, que funciona corretamente.
        const token = await this.requestUploadToken(restaurantId);
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = token + "/" + Date.now() + "." + ext;
        const { error } = await client.storage.from("menu-images").upload(path, file, {
          upsert: false,
          cacheControl: "3600",
        });
        if (error) throw error;
        const { data } = client.storage.from("menu-images").getPublicUrl(path);
        return data.publicUrl;
      },

      async getRestaurantOrders(restaurantId) {
        const { data, error } = await client
          .from("orders")
          .select("id, status, total, food_subtotal, delivery_fee, created_at, address, courier_id, pickup_code, order_items(name, price, quantity)")
          .eq("restaurant_id", restaurantId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return (data || []).map((o) => ({
          id: o.id,
          status: o.status,
          total: o.total,
          foodSubtotal: o.food_subtotal,
          deliveryFee: o.delivery_fee,
          createdAt: o.created_at,
          address: o.address,
          courierId: o.courier_id,
          pickupCode: o.pickup_code,
          items: o.order_items || [],
        }));
      },

      async updateOrderStatus(orderId, status) {
        const { error } = await client.from("orders").update({ status }).eq("id", orderId);
        if (error) throw error;
      },

      /* ---------- ENTREGADOR ---------- */
      async getAvailableDeliveries() {
        const { data, error } = await client
          .from("orders")
          .select("id, total, delivery_fee, delivery_distance_km, created_at, address, restaurants(name, address)")
          .eq("status", "pronto")
          .is("courier_id", null)
          .order("created_at", { ascending: true });
        if (error) throw error;
        return (data || []).map((o) => ({
          id: o.id,
          total: o.total,
          deliveryFee: o.delivery_fee,
          distanceKm: o.delivery_distance_km,
          createdAt: o.created_at,
          address: o.address,
          restaurantName: o.restaurants ? o.restaurants.name : "Restaurante",
          restaurantAddress: o.restaurants ? o.restaurants.address : "",
        }));
      },

      async getMyDeliveries(courierId) {
        const { data, error } = await client
          .from("orders")
          .select("id, total, delivery_fee, delivery_distance_km, created_at, address, status, pickup_code, restaurants(name, address)")
          .eq("courier_id", courierId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return (data || []).map((o) => ({
          id: o.id,
          total: o.total,
          deliveryFee: o.delivery_fee,
          distanceKm: o.delivery_distance_km,
          createdAt: o.created_at,
          address: o.address,
          status: o.status,
          pickupCode: o.pickup_code,
          restaurantName: o.restaurants ? o.restaurants.name : "Restaurante",
          restaurantAddress: o.restaurants ? o.restaurants.address : "",
        }));
      },

      async claimDelivery(orderId, courierId) {
        const code = genCode();
        const { data, error } = await client
          .from("orders")
          .update({ courier_id: courierId, pickup_code: code })
          .eq("id", orderId)
          .is("courier_id", null)
          .select();
        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error("Este pedido já foi aceito por outro entregador.");
        }
        return { order: { id: data[0].id, pickupCode: data[0].pickup_code } };
      },

      async confirmPickup(orderId) {
        const { error } = await client.from("orders").update({ status: "a_caminho" }).eq("id", orderId);
        if (error) throw error;
      },

      async confirmDelivery(orderId) {
        const { error } = await client.from("orders").update({ status: "entregue" }).eq("id", orderId);
        if (error) throw error;
      },

      /* ---------- CHAT ---------- */
      async getMessages(orderId, channel) {
        const { data, error } = await client
          .from("messages")
          .select("id, sender_id, sender_role, content, created_at")
          .eq("order_id", orderId)
          .eq("channel", channel)
          .order("created_at", { ascending: true });
        if (error) throw error;
        return (data || []).map((m) => ({
          id: m.id,
          senderId: m.sender_id,
          senderRole: m.sender_role,
          content: m.content,
          createdAt: m.created_at,
        }));
      },

      async sendMessage(orderId, channel, content, senderRole) {
        const session = await this.getSession();
        const senderId = session ? session.user.id : null;
        const { data, error } = await client
          .from("messages")
          .insert({ order_id: orderId, channel, sender_id: senderId, sender_role: senderRole, content })
          .select()
          .single();
        if (error) throw error;
        return {
          message: {
            id: data.id,
            senderId: data.sender_id,
            senderRole: data.sender_role,
            content: data.content,
            createdAt: data.created_at,
          },
        };
      },

      subscribeToMessages(orderId, channel, onMessage) {
        const sub = client
          .channel("messages-" + orderId + "-" + channel)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages", filter: "order_id=eq." + orderId },
            (payload) => {
              if (payload.new.channel !== channel) return;
              onMessage({
                id: payload.new.id,
                senderId: payload.new.sender_id,
                senderRole: payload.new.sender_role,
                content: payload.new.content,
                createdAt: payload.new.created_at,
              });
            }
          )
          .subscribe();
        return sub;
      },

      unsubscribe(sub) {
        if (sub) client.removeChannel(sub);
      },
    };
  }

  /* ---------------------------------------------------------------------
     ADAPTADOR DEMO (memória local, sem persistência)
  --------------------------------------------------------------------- */
  function buildDemoAdapter() {
    const demoRestaurants = [
      { id: "r1", ownerId: null, name: "Sabor da Vila", category: "Brasileira", address: "Rua das Flores, 120", etaMinutes: 35, deliveryBaseFee: 5, deliveryPricePerKm: 1.5, active: true },
      { id: "r2", ownerId: null, name: "Pizzaria Bella", category: "Pizzas", address: "Av. Central, 500", etaMinutes: 40, deliveryBaseFee: 6, deliveryPricePerKm: 1.8, active: true },
    ];
    const demoMenus = {
      r1: [
        { id: "m1", restaurantId: "r1", name: "Feijoada completa", description: "Arroz, couve e farofa", price: 32.9, available: true },
        { id: "m2", restaurantId: "r1", name: "Frango grelhado", description: "Com legumes salteados", price: 24.5, available: true },
      ],
      r2: [
        { id: "m3", restaurantId: "r2", name: "Pizza Margherita", description: "Molho, muçarela e manjericão", price: 44.0, available: true },
      ],
    };
    let currentUser = null;
    let profile = null;
    const orders = [];
    const authListeners = [];
    const messages = {};
    const messageListeners = {};
    let idCounter = 1;

    function findOrder(id) {
      return orders.find((o) => o.id === id);
    }

    return {
      async signUp({ name, email, phone, role }) {
        currentUser = { id: "demo-user", email };
        profile = { name, email, phone, address: "", role: role || "cliente" };
        if (profile.role === "restaurante") {
          demoRestaurants.push({
            id: "r-demo",
            ownerId: currentUser.id,
            name: name || "Meu restaurante",
            category: "Geral",
            address: "",
            etaMinutes: 30,
            deliveryBaseFee: 5,
            deliveryPricePerKm: 1.5,
            active: true,
          });
          demoMenus["r-demo"] = [];
        }
        authListeners.forEach((cb) => cb(currentUser));
        return { user: currentUser };
      },
      async signIn({ email }) {
        currentUser = { id: "demo-user", email };
        profile = profile || { name: "Usuário Demo", email, phone: "", address: "", role: "cliente" };
        authListeners.forEach((cb) => cb(currentUser));
        return { user: currentUser };
      },
      async signOut() {
        currentUser = null;
        authListeners.forEach((cb) => cb(null));
      },
      async getSession() {
        return currentUser ? { user: currentUser } : null;
      },
      onAuthChange(cb) {
        authListeners.push(cb);
      },
      async getProfile() {
        return profile || { name: "", email: "", phone: "", address: "", role: "cliente", city: null };
      },
      async updateProfile(_userId, updates) {
        profile = { ...profile, ...updates };
        return { profile };
      },

      async getRestaurants() {
        return demoRestaurants.filter((r) => r.active);
      },
      async calculateDeliveryFee(restaurantId, address, _city) {
        // Sem Google Maps no modo demo: gera uma distância plausível a
        // partir do texto do endereço, só para simular a experiência.
        const restaurant = demoRestaurants.find((r) => r.id === restaurantId);
        const distanceKm = Math.round(((address.length % 12) + 1.5) * 10) / 10;
        const base = restaurant ? Number(restaurant.deliveryBaseFee) : 5;
        const perKm = restaurant ? Number(restaurant.deliveryPricePerKm) : 1.5;
        const fee = Math.round((base + perKm * distanceKm) * 100) / 100;
        return { distanceKm, durationMin: Math.round(distanceKm * 3), fee };
      },
      async getMenu(restaurantId) {
        return (demoMenus[restaurantId] || []).filter((m) => m.available);
      },
      async createOrder({ restaurantId, items, address, deliveryCity, foodSubtotal, deliveryFee, deliveryDistanceKm, total }) {
        const restaurant = demoRestaurants.find((r) => r.id === restaurantId);
        const order = {
          id: "o" + idCounter++,
          userId: currentUser ? currentUser.id : null,
          restaurantId,
          restaurantName: restaurant ? restaurant.name : "Restaurante",
          restaurantAddress: restaurant ? restaurant.address : "",
          status: "recebido",
          total,
          foodSubtotal,
          deliveryFee,
          deliveryDistanceKm,
          deliveryCity,
          createdAt: new Date().toISOString(),
          items,
          address,
          courierId: null,
          pickupCode: null,
        };
        orders.unshift(order);
        return { order };
      },
      async getOrders(userId) {
        return orders.filter((o) => o.userId === userId);
      },

      async getMyRestaurant(ownerId) {
        return demoRestaurants.find((r) => r.ownerId === ownerId) || null;
      },
      async updateMyRestaurant(restaurantId, updates) {
        const r = demoRestaurants.find((r) => r.id === restaurantId);
        Object.assign(r, updates);
        return { restaurant: r };
      },
      async getMyMenu(restaurantId) {
        return demoMenus[restaurantId] || [];
      },
      async createMenuItem(restaurantId, item) {
        const newItem = { id: "m" + idCounter++, restaurantId, available: true, ...item };
        demoMenus[restaurantId] = demoMenus[restaurantId] || [];
        demoMenus[restaurantId].push(newItem);
        return { item: newItem };
      },
      async updateMenuItem(itemId, updates) {
        for (const key in demoMenus) {
          const item = demoMenus[key].find((m) => m.id === itemId);
          if (item) {
            Object.assign(item, updates);
            return { item };
          }
        }
      },
      async deleteMenuItem(itemId) {
        for (const key in demoMenus) {
          demoMenus[key] = demoMenus[key].filter((m) => m.id !== itemId);
        }
      },
      async uploadMenuImage(_restaurantId, file) {
        // Sem Storage real no modo demo: converte a imagem para uso local nesta aba.
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
          reader.readAsDataURL(file);
        });
      },
      async getRestaurantOrders(restaurantId) {
        return orders.filter((o) => o.restaurantId === restaurantId);
      },
      async updateOrderStatus(orderId, status) {
        const o = findOrder(orderId);
        if (o) o.status = status;
      },

      async getAvailableDeliveries() {
        return orders.filter((o) => o.status === "pronto" && !o.courierId);
      },
      async getMyDeliveries(courierId) {
        return orders.filter((o) => o.courierId === courierId);
      },
      async claimDelivery(orderId, courierId) {
        const o = findOrder(orderId);
        if (!o || o.courierId) throw new Error("Este pedido já foi aceito por outro entregador.");
        o.courierId = courierId;
        o.pickupCode = genCode();
        o.status = "pronto";
        return { order: { id: o.id, pickupCode: o.pickupCode } };
      },
      async confirmPickup(orderId) {
        const o = findOrder(orderId);
        if (o) o.status = "a_caminho";
      },
      async confirmDelivery(orderId) {
        const o = findOrder(orderId);
        if (o) o.status = "entregue";
      },

      /* ---------- CHAT (simulado, só nesta aba) ---------- */
      async getMessages(orderId, channel) {
        const key = orderId + ":" + channel;
        return messages[key] || [];
      },
      async sendMessage(orderId, channel, content, senderRole) {
        const key = orderId + ":" + channel;
        const msg = {
          id: "msg" + idCounter++,
          senderId: currentUser ? currentUser.id : null,
          senderRole,
          content,
          createdAt: new Date().toISOString(),
        };
        messages[key] = messages[key] || [];
        messages[key].push(msg);
        (messageListeners[key] || []).forEach((cb) => cb(msg));
        return { message: msg };
      },
      subscribeToMessages(orderId, channel, onMessage) {
        const key = orderId + ":" + channel;
        messageListeners[key] = messageListeners[key] || [];
        messageListeners[key].push(onMessage);
        return { key, onMessage };
      },
      unsubscribe(sub) {
        if (!sub) return;
        const list = messageListeners[sub.key];
        if (list) messageListeners[sub.key] = list.filter((cb) => cb !== sub.onMessage);
      },
    };
  }

  if (isConfigured && window.supabase) {
    window.DB = buildSupabaseAdapter();
    window.DB_MODE = "supabase";
  } else {
    window.DB = buildDemoAdapter();
    window.DB_MODE = "demo";
    showDemoBanner();
  }
})();
