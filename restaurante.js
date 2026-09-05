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
    $("settEta").value = myRestaurant.etaMinutes || 30;
    $("settFee").value = myRestaurant.deliveryFee || 0;
    $("settActive").checked = !!myRestaurant.active;
  }

  $("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const updates = {
        name: $("settName").value.trim(),
        category: $("settCategory").value.trim(),
        address: $("settAddress").value.trim(),
        etaMinutes: parseInt($("settEta").value, 10),
        deliveryFee: parseFloat($("settFee").value),
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
          <div>
            <span class="name">${it.name}</span>
            ${!it.available ? '<span class="badge-unavailable">Indisponível</span>' : ""}
            ${it.description ? `<div class="desc">${it.description}</div>` : ""}
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
    });
  }

  $("addItemBtn").addEventListener("click", async () => {
    const name = $("newItemName").value.trim();
    const description = $("newItemDesc").value.trim();
    const price = parseFloat($("newItemPrice").value);
    if (!name || isNaN(price) || price < 0) return alert("Preencha o nome e um preço válido.");
    await window.DB.createMenuItem(myRestaurant.id, { name, description, price });
    $("newItemName").value = "";
    $("newItemDesc").value = "";
    $("newItemPrice").value = "";
    loadMenu();
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
            <span>R$ ${Number(o.total).toFixed(2).replace(".", ",")}</span>
          </div>
          ${itemsHtml ? `<div class="order-items">${itemsHtml}</div>` : ""}
          <div class="order-items">Entregar em: ${o.address}</div>
          <div class="order-actions" data-id="${o.id}">${actions}</div>
        </div>`;
      })
      .join("");

    list.querySelectorAll(".order-actions").forEach((el) => {
      el.querySelectorAll("button[data-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await window.DB.updateOrderStatus(el.dataset.id, btn.dataset.action);
          loadOrders();
        });
      });
    });
  }

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
