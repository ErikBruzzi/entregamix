(function () {
  const $ = (id) => document.getElementById(id);
  let currentUser = null;
  let myRestaurant = null;
  let gateMode = "signin";
  let ordersPollTimer = null;

  const statusLabel = {
    recebido: "Novo pedido",
    preparando: "Preparando",
    pronto: "Pronto p/ retirada",
    a_caminho: "A caminho do cliente",
    entregue: "Entregue",
    cancelado: "Cancelado",
  };

  /* ---------------- LOGIN / CADASTRO ---------------- */
  function updateGateUI() {
    $("gateTitle").textContent = gateMode === "signin" ? "Entre na sua conta de restaurante" : "Cadastre seu restaurante";
    $("gateSubmit").textContent = gateMode === "signin" ? "Entrar" : "Criar conta";
    $("gateFieldName").style.display = gateMode === "signup" ? "block" : "none";
    $("gateSwitchText").textContent = gateMode === "signin" ? "Ainda não tem conta de restaurante?" : "Já tem uma conta?";
    $("gateSwitchLink").textContent = gateMode === "signin" ? "Criar conta" : "Entrar";
    $("gateError").style.display = "none";
  }
  $("gateSwitchLink").addEventListener("click", (e) => {
    e.preventDefault();
    gateMode = gateMode === "signin" ? "signup" : "signin";
    updateGateUI();
  });

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("gateEmail").value.trim();
    const password = $("gatePassword").value;
    const errBox = $("gateError");
    errBox.style.display = "none";
    try {
      let user;
      if (gateMode === "signup") {
        const name = $("gateName").value.trim();
        ({ user } = await window.DB.signUp({ name, email, phone: "", password, role: "restaurante" }));
      } else {
        ({ user } = await window.DB.signIn({ email, password }));
      }
      currentUser = user;
      const profile = await window.DB.getProfile(currentUser.id);
      if (profile.role !== "restaurante") {
        await window.DB.signOut();
        throw new Error("Esta conta não está cadastrada como restaurante. Use a tela inicial do app para entrar como cliente.");
      }
      await loadRestaurantAndShow();
    } catch (err) {
      errBox.textContent = (err && err.message) || String(err);
      errBox.style.display = "block";
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await window.DB.signOut();
    clearInterval(ordersPollTimer);
    location.reload();
  });

  /* ---------------- ABAS ---------------- */
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $("panel-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "orders") loadOrders();
      if (btn.dataset.tab === "menu") loadMenu();
    });
  });

  /* ---------------- CONFIGURAÇÕES DO RESTAURANTE ---------------- */
  function fillSettingsForm() {
    $("settName").value = myRestaurant.name || "";
    $("settCategory").value = myRestaurant.category || "";
    $("settAddress").value = myRestaurant.address || "";
    $("settCity").value = myRestaurant.city || "";
    $("settEta").value = myRestaurant.etaMinutes || 30;
    $("settBaseFee").value = myRestaurant.deliveryBaseFee ?? 5;
    $("settPerKm").value = myRestaurant.deliveryPricePerKm ?? 1.5;
    $("settActive").checked = !!myRestaurant.active;
  }

  $("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const updates = {
        name: $("settName").value.trim(),
        category: $("settCategory").value.trim(),
        address: $("settAddress").value.trim(),
        city: $("settCity").value.trim(),
        etaMinutes: parseInt($("settEta").value, 10),
        deliveryBaseFee: parseFloat($("settBaseFee").value),
        deliveryPricePerKm: parseFloat($("settPerKm").value),
        active: $("settActive").checked,
      };
      const { restaurant } = await window.DB.updateMyRestaurant(myRestaurant.id, updates);
      myRestaurant = { ...myRestaurant, ...updates, id: restaurant.id };
      const msg = $("settSaveMsg");
      msg.style.display = "block";
      setTimeout(() => (msg.style.display = "none"), 2500);
    } catch (err) {
      alert("Não foi possível salvar: " + ((err && err.message) || err));
    }
  });

  /* ---------------- CARDÁPIO ---------------- */
  async function loadMenu() {
    const items = await window.DB.getMyMenu(myRestaurant.id);
    renderMenu(items);
  }

  function renderMenu(items) {
    const list = $("menuList");
    if (!items.length) {
      list.innerHTML = '<div class="empty-state">Nenhum prato cadastrado ainda. Adicione o primeiro acima.</div>';
      return;
    }
    list.innerHTML = items
      .map(
        (it) => `
      <div class="menu-item-card" data-id="${it.id}">
        <div class="row">
          <div class="item-info-row">
            ${
              it.imageUrl
                ? `<img class="item-thumb" src="${it.imageUrl}" alt="${it.name}" />`
                : `<div class="item-thumb-placeholder">🍽️</div>`
            }
            <div>
              <span class="name">${it.name}</span>
              ${!it.available ? '<span class="badge-unavailable">Indisponível</span>' : ""}
              ${it.description ? `<div class="desc">${it.description}</div>` : ""}
              <div><button class="photo-btn" data-action="photo">Trocar foto</button></div>
              <input type="file" accept="image/*" data-action="photo-input" style="display:none;" />
            </div>
          </div>
          <div class="price">R$ ${Number(it.price).toFixed(2).replace(".", ",")}</div>
        </div>
        <div class="actions">
          <button class="secondary-btn" data-action="toggle">${it.available ? "Marcar indisponível" : "Marcar disponível"}</button>
          <button class="secondary-btn" data-action="edit-price">Editar preço</button>
          <button class="secondary-btn" data-action="delete" style="color:var(--red-dark);">Excluir</button>
        </div>
      </div>`
      )
      .join("");

    list.querySelectorAll(".menu-item-card").forEach((card) => {
      const id = card.dataset.id;
      const item = items.find((i) => i.id === id);
      card.querySelector('[data-action="toggle"]').addEventListener("click", async () => {
        await window.DB.updateMenuItem(id, { available: !item.available });
        loadMenu();
      });
      card.querySelector('[data-action="edit-price"]').addEventListener("click", async () => {
        const novo = prompt("Novo preço para \"" + item.name + "\" (R$):", item.price);
        if (novo === null) return;
        const price = parseFloat(novo.replace(",", "."));
        if (isNaN(price) || price < 0) return alert("Preço inválido.");
        await window.DB.updateMenuItem(id, { price });
        loadMenu();
      });
      card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
        if (!confirm('Excluir "' + item.name + '" do cardápio?')) return;
        await window.DB.deleteMenuItem(id);
        loadMenu();
      });
      const photoInput = card.querySelector('[data-action="photo-input"]');
      card.querySelector('[data-action="photo"]').addEventListener("click", () => photoInput.click());
      photoInput.addEventListener("change", async () => {
        const file = photoInput.files[0];
        if (!file) return;
        try {
          const imageUrl = await window.DB.uploadMenuImage(myRestaurant.id, file);
          await window.DB.updateMenuItem(id, { imageUrl });
          loadMenu();
        } catch (err) {
          alert("Não foi possível enviar a foto: " + ((err && err.message) || err));
        }
      });
    });
  }

  $("addItemBtn").addEventListener("click", async () => {
    const name = $("newItemName").value.trim();
    const description = $("newItemDesc").value.trim();
    const price = parseFloat($("newItemPrice").value);
    const file = $("newItemImage").files[0];
    if (!name || isNaN(price) || price < 0) return alert("Preencha o nome e um preço válido.");
    const btn = $("addItemBtn");
    btn.disabled = true;
    btn.textContent = file ? "Enviando foto..." : "Adicionando...";
    try {
      let imageUrl = null;
      if (file) imageUrl = await window.DB.uploadMenuImage(myRestaurant.id, file);
      await window.DB.createMenuItem(myRestaurant.id, { name, description, price, imageUrl });
      $("newItemName").value = "";
      $("newItemDesc").value = "";
      $("newItemPrice").value = "";
      $("newItemImage").value = "";
      loadMenu();
    } catch (err) {
      alert("Não foi possível adicionar o prato: " + ((err && err.message) || err));
    } finally {
      btn.disabled = false;
      btn.textContent = "Adicionar prato";
    }
  });

  /* ---------------- PEDIDOS ---------------- */
  async function loadOrders() {
    const orders = await window.DB.getRestaurantOrders(myRestaurant.id);
    renderOrders(orders);
  }

  function renderOrders(orders) {
    const list = $("ordersList");
    if (!orders.length) {
      list.innerHTML = '<div class="empty-state">Nenhum pedido recebido ainda.</div>';
      return;
    }
    list.innerHTML = orders
      .map((o) => {
        const date = new Date(o.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
        const itemsHtml = (o.items || []).map((it) => `${it.quantity}× ${it.name}`).join(", ");
        let actions = "";
        if (o.status === "recebido") {
          actions = `<button class="primary-btn green" data-action="preparando">Aceitar e preparar</button>
                     <button class="secondary-btn" data-action="cancelado" style="color:var(--red-dark);">Recusar</button>`;
        } else if (o.status === "preparando") {
          actions = `<button class="primary-btn green" data-action="pronto">Marcar como pronto p/ retirada</button>
                     <button class="secondary-btn" data-action="cancelado" style="color:var(--red-dark);">Cancelar</button>`;
        } else if (o.status === "pronto" && !o.courierId) {
          actions = `<div style="font-size:13px; color:var(--ink-soft);">Aguardando um entregador aceitar a corrida.</div>`;
        } else if (o.status === "pronto" && o.courierId) {
          actions = `<div class="pickup-code">Confira este código com o entregador antes de entregar o pedido: <strong>${o.pickupCode}</strong></div>`;
        }
        return `
        <div class="order-card">
          <div class="row">
            <strong>Pedido #${o.id.slice(0, 8)}</strong>
            <span class="status-badge status-${o.status}">${statusLabel[o.status] || o.status}</span>
          </div>
          <div class="row" style="color:var(--ink-soft); font-size:13px;">
            <span>${date}</span>
            <span>Você recebe: R$ ${Number(o.foodSubtotal ?? o.total).toFixed(2).replace(".", ",")}</span>
          </div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:-4px; margin-bottom:6px;">Total pago pelo cliente (comida + entrega): R$ ${Number(o.total).toFixed(2).replace(".", ",")}</div>
          ${itemsHtml ? `<div class="order-items">${itemsHtml}</div>` : ""}
          <div class="order-items">Entregar em: ${o.address}</div>
          <div class="order-actions" data-id="${o.id}">${actions}</div>
          <div class="order-actions">
            <button class="chat-btn" data-chat-order="${o.id}">💬 Chat com o cliente</button>
          </div>
        </div>`;
      })
      .join("");

    list.querySelectorAll("[data-chat-order]").forEach((btn) => {
      btn.addEventListener("click", () =>
        openChat(btn.dataset.chatOrder, "restaurante", "Chat com o cliente", "restaurante")
      );
    });

    list.querySelectorAll(".order-actions[data-id]").forEach((el) => {
      el.querySelectorAll("button[data-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await window.DB.updateOrderStatus(el.dataset.id, btn.dataset.action);
          loadOrders();
        });
      });
    });
  }

  /* ---------------- CHAT ---------------- */
  let chatSub = null;
  let chatOrderId = null;

  async function openChat(orderId, channel, title) {
    chatOrderId = orderId;
    $("chatTitle").textContent = title;
    $("chatOverlay").classList.add("active");
    $("chatMessages").innerHTML = '<div class="chat-empty">Carregando conversa...</div>';
    const msgs = await window.DB.getMessages(orderId, channel);
    renderChatMessages(msgs);
    if (chatSub) window.DB.unsubscribe(chatSub);
    chatSub = window.DB.subscribeToMessages(orderId, channel, (msg) => appendChatMessage(msg));
  }

  function closeChat() {
    $("chatOverlay").classList.remove("active");
    if (chatSub) window.DB.unsubscribe(chatSub);
    chatSub = null;
  }
  $("chatCloseBtn").addEventListener("click", closeChat);

  function renderChatMessages(msgs) {
    const box = $("chatMessages");
    if (!msgs.length) {
      box.innerHTML = '<div class="chat-empty">Nenhuma mensagem ainda. Diga olá!</div>';
      return;
    }
    box.innerHTML = "";
    msgs.forEach((m) => appendChatMessage(m));
  }

  function appendChatMessage(m) {
    const box = $("chatMessages");
    if (box.querySelector(".chat-empty")) box.innerHTML = "";
    const mine = m.senderRole === "restaurante";
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble " + (mine ? "mine" : "theirs");
    const who = mine ? "Você" : "Cliente";
    bubble.innerHTML = `<div class="who">${who}</div>${escapeHtml(m.content)}`;
    box.appendChild(bubble);
    box.scrollTop = box.scrollHeight;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  $("chatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("chatInput");
    const content = input.value.trim();
    if (!content) return;
    input.value = "";
    await window.DB.sendMessage(chatOrderId, "restaurante", content, "restaurante");
  });

  /* ---------------- INICIALIZAÇÃO ---------------- */
  function showDashboard() {
    $("loginGate").style.display = "none";
    $("dashboardContent").style.display = "block";
  }

  async function loadRestaurantAndShow() {
    myRestaurant = await window.DB.getMyRestaurant(currentUser.id);
    if (!myRestaurant) {
      alert("Não encontramos um restaurante vinculado a esta conta. Fale com o suporte.");
      return;
    }
    fillSettingsForm();
    showDashboard();
    loadMenu();
    loadOrders();
    ordersPollTimer = setInterval(() => {
      if (document.getElementById("panel-orders").classList.contains("active")) loadOrders();
    }, 15000);
  }

  async function init() {
    updateGateUI();
    const session = await window.DB.getSession();
    if (session) {
      currentUser = session.user;
      const profile = await window.DB.getProfile(currentUser.id);
      if (profile.role === "restaurante") {
        await loadRestaurantAndShow();
      }
    }
  }
  init();
})();
