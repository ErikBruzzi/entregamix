/*
  CAMADA DE ACESSO A DADOS (DATA ACCESS LAYER)
  ---------------------------------------------
  Esta é a ÚNICA parte do app que sabe que existe um banco de dados chamado
  Supabase. O index.html e o dashboard.html nunca importam o Supabase
  diretamente — eles só chamam window.DB.algumaFuncao(...).

  Por quê isso importa: se um dia vocês quiserem trocar o Supabase por
  outro banco (Firebase, um backend próprio, etc.), basta reescrever ESTE
  arquivo mantendo os mesmos nomes de função e o mesmo formato de retorno.
  Nenhuma outra parte do código precisa mudar.

  Contrato da interface window.DB (todas as funções são assíncronas):
    - signUp({ name, email, phone, password })      -> { user }
    - signIn({ email, password })                    -> { user }
    - signOut()                                      -> void
    - getSession()                                   -> { user } | null
    - onAuthChange(callback)                         -> void (chama callback(user|null) quando o login muda)
    - getRestaurants()                                -> [{ id, name, category, etaMinutes, deliveryFee }]
    - getMenu(restaurantId)                           -> [{ id, name, description, price }]
    - createOrder({ restaurantId, items, address, total }) -> { order }
    - getOrders(userId)                               -> [{ id, restaurantName, status, total, createdAt, items }]
    - getProfile(userId)                              -> { name, email, phone, address }
    - updateProfile(userId, data)                     -> { profile }
*/

(function () {
  const config = window.APP_CONFIG || {};
  const isConfigured =
    config.SUPABASE_URL &&
    !config.SUPABASE_URL.includes("COLE_A_URL") &&
    config.SUPABASE_ANON_KEY &&
    !config.SUPABASE_ANON_KEY.includes("COLE_SUA_CHAVE");

  // Avisa visualmente na tela (barra fixa) quando o app está em modo demo.
  function showDemoBanner() {
    document.addEventListener("DOMContentLoaded", () => {
      const banner = document.createElement("div");
      banner.textContent =
        "Modo demonstração: dados temporários, sem conexão com o Supabase. Configure js/config.js para ativar o banco de dados real.";
      banner.style.cssText =
        "position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#171717;color:#fff;font:600 12px/1.4 Inter,sans-serif;text-align:center;padding:8px 12px;";
      document.body.appendChild(banner);
    });
  }

  /* ---------------------------------------------------------------------
     ADAPTADOR SUPABASE (usado quando js/config.js está preenchido)
  --------------------------------------------------------------------- */
  function buildSupabaseAdapter() {
    const client = window.supabase.createClient(
      config.SUPABASE_URL,
      config.SUPABASE_ANON_KEY
    );

    return {
      async signUp({ name, email, phone, password }) {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { name, phone } },
        });
        if (error) throw error;
        // O perfil é criado automaticamente pelo gatilho handle_new_user no banco
        // (veja supabase-schema.sql), então funciona mesmo antes da confirmação de e-mail.
        return { user: data.user };
      },

      async signIn({ email, password }) {
        const { data, error } = await client.auth.signInWithPassword({
          email,
          password,
        });
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

      async getRestaurants() {
        const { data, error } = await client
          .from("restaurants")
          .select("id, name, category, eta_minutes, delivery_fee")
          .eq("active", true);
        if (error) throw error;
        return (data || []).map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          etaMinutes: r.eta_minutes,
          deliveryFee: r.delivery_fee,
        }));
      },

      async getMenu(restaurantId) {
        const { data, error } = await client
          .from("menu_items")
          .select("id, name, description, price")
          .eq("restaurant_id", restaurantId);
        if (error) throw error;
        return data || [];
      },

      async createOrder({ restaurantId, items, address, total }) {
        const session = await this.getSession();
        const userId = session ? session.user.id : null;
        const { data, error } = await client
          .from("orders")
          .insert({
            user_id: userId,
            restaurant_id: restaurantId,
            address,
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
        const { error: itemsError } = await client
          .from("order_items")
          .insert(orderItems);
        if (itemsError) throw itemsError;

        return { order: data };
      },

      async getOrders(userId) {
        const { data, error } = await client
          .from("orders")
          .select(
            "id, status, total, created_at, restaurants(name), order_items(name, price, quantity)"
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return (data || []).map((o) => ({
          id: o.id,
          restaurantName: o.restaurants ? o.restaurants.name : "Restaurante",
          status: o.status,
          total: o.total,
          createdAt: o.created_at,
          items: o.order_items || [],
        }));
      },

      async getProfile(userId) {
        const { data, error } = await client
          .from("profiles")
          .select("name, email, phone, address")
          .eq("id", userId)
          .maybeSingle();
        if (error) throw error;
        if (data) return data;

        // Login existente sem perfil correspondente (ex.: criado antes do
        // gatilho automático). Cria o perfil agora, já com sessão ativa.
        const { data: authData } = await client.auth.getUser();
        const email = authData && authData.user ? authData.user.email : "";
        const { data: created, error: createError } = await client
          .from("profiles")
          .insert({ id: userId, name: "", email, phone: "", address: "" })
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
    };
  }

  /* ---------------------------------------------------------------------
     ADAPTADOR DEMO (memória local, sem persistência) — só para pré-visualizar
  --------------------------------------------------------------------- */
  function buildDemoAdapter() {
    const demoRestaurants = [
      { id: "r1", name: "Sabor da Vila", category: "Brasileira", etaMinutes: 35, deliveryFee: 6.9 },
      { id: "r2", name: "Pizzaria Bella", category: "Pizzas", etaMinutes: 40, deliveryFee: 8.5 },
      { id: "r3", name: "Cantina do Mercado", category: "Massas", etaMinutes: 30, deliveryFee: 5.0 },
      { id: "r4", name: "Doce Ponto", category: "Sobremesas", etaMinutes: 25, deliveryFee: 4.5 },
    ];
    const demoMenus = {
      r1: [
        { id: "m1", name: "Feijoada completa", description: "Arroz, couve e farofa", price: 32.9 },
        { id: "m2", name: "Frango grelhado", description: "Com legumes salteados", price: 24.5 },
      ],
      r2: [
        { id: "m3", name: "Pizza Margherita", description: "Molho, muçarela e manjericão", price: 44.0 },
        { id: "m4", name: "Pizza Calabresa", description: "Cebola e azeitona", price: 46.0 },
      ],
      r3: [
        { id: "m5", name: "Fettuccine ao molho branco", description: "Com champignon", price: 29.9 },
        { id: "m6", name: "Nhoque ao sugo", description: "Molho de tomate fresco", price: 27.0 },
      ],
      r4: [
        { id: "m7", name: "Brigadeiro gourmet (6un)", description: "", price: 18.0 },
        { id: "m8", name: "Torta de limão (fatia)", description: "", price: 12.5 },
      ],
    };

    let currentUser = null;
    let profile = null;
    const orders = [];
    const authListeners = [];

    return {
      async signUp({ name, email, phone }) {
        currentUser = { id: "demo-user", email };
        profile = { name, email, phone, address: "" };
        authListeners.forEach((cb) => cb(currentUser));
        return { user: currentUser };
      },
      async signIn({ email }) {
        currentUser = { id: "demo-user", email };
        profile = profile || { name: "Cliente Demo", email, phone: "", address: "" };
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
      async getRestaurants() {
        return demoRestaurants;
      },
      async getMenu(restaurantId) {
        return demoMenus[restaurantId] || [];
      },
      async createOrder({ restaurantId, items, address, total }) {
        const restaurant = demoRestaurants.find((r) => r.id === restaurantId);
        const order = {
          id: "o" + (orders.length + 1),
          restaurantName: restaurant ? restaurant.name : "Restaurante",
          status: "recebido",
          total,
          createdAt: new Date().toISOString(),
          items,
          address,
        };
        orders.unshift(order);
        return { order };
      },
      async getOrders() {
        return orders;
      },
      async getProfile() {
        return profile || { name: "", email: "", phone: "", address: "" };
      },
      async updateProfile(_userId, updates) {
        profile = { ...profile, ...updates };
        return { profile };
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
