(function () {
  const $ = (id) => document.getElementById(id);
  let currentUser = null;

  const statusLabel = {
    recebido: "Recebido",
    preparando: "Preparando",
    a_caminho: "A caminho",
    entregue: "Entregue",
    cancelado: "Cancelado",
  };

  let gateMode = "signin";

  function showDashboard() {
    $("loginGate").style.display = "none";
    $("dashboardContent").style.display = "block";
  }

  function updateGateUI() {
    $("gateTitle").textContent = gateMode === "signin" ? "Entre para acessar seu dashboard" : "Crie sua conta";
    $("gateSubmit").textContent = gateMode === "signin" ? "Entrar" : "Criar conta";
    $("gateFieldName").style.display = gateMode === "signup" ? "block" : "none";
    $("gateFieldPhone").style.display = gateMode === "signup" ? "block" : "none";
    $("gateSwitchText").textContent = gateMode === "signin" ? "Ainda não tem conta?" : "Já tem uma conta?";
    $("gateSwitchLink").textContent = gateMode === "signin" ? "Criar conta" : "Entrar";
    $("gateError").style.display = "none";
  }

  $("gateSwitchLink").addEventListener("click", (e) => {
    e.preventDefault();
    gateMode = gateMode === "signin" ? "signup" : "signin";
    updateGateUI();
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $("panel-" + btn.dataset.tab).classList.add("active");
    });
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
        const phone = $("gatePhone").value.trim();
        ({ user } = await window.DB.signUp({ name, email, phone, password }));
      } else {
        ({ user } = await window.DB.signIn({ email, password }));
      }
      currentUser = user;
      await loadAccount();
      await loadOrders();
      showDashboard();
    } catch (err) {
      errBox.textContent = "Não foi possível continuar: " + ((err && err.message) || err);
      errBox.style.display = "block";
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await window.DB.signOut();
    currentUser = null;
    location.reload();
  });

  async function loadAccount() {
    const profile = await window.DB.getProfile(currentUser.id);
    $("accName").value = profile.name || "";
    $("accEmail").value = profile.email || currentUser.email || "";
    $("accPhone").value = profile.phone || "";
    $("accAddress").value = profile.address || "";
  }

  $("accountForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await window.DB.updateProfile(currentUser.id, {
        name: $("accName").value.trim(),
        phone: $("accPhone").value.trim(),
        address: $("accAddress").value.trim(),
      });
      const msg = $("saveMsg");
      msg.style.display = "block";
      setTimeout(() => (msg.style.display = "none"), 2500);
    } catch (err) {
      alert("Não foi possível salvar: " + (err.message || err));
    }
  });

  async function loadOrders() {
    const orders = await window.DB.getOrders(currentUser.id);
    const list = $("ordersList");
    if (!orders.length) {
      list.innerHTML = '<div class="empty-state">Nenhum pedido encontrado ainda.</div>';
      return;
    }
    list.innerHTML = orders
      .map((o) => {
        const date = new Date(o.createdAt).toLocaleDateString("pt-BR", {
          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
        });
        const itemsHtml = (o.items || [])
          .map((it) => `${it.quantity}× ${it.name}`)
          .join(", ");
        return `
        <div class="order-card">
          <div class="row">
            <strong>${o.restaurantName}</strong>
            <span class="status-badge status-${o.status}">${statusLabel[o.status] || o.status}</span>
          </div>
          <div class="row" style="color:var(--ink-soft); font-size:13px;">
            <span>${date}</span>
            <span>R$ ${Number(o.total).toFixed(2).replace(".", ",")}</span>
          </div>
          ${itemsHtml ? `<div class="order-items">${itemsHtml}</div>` : ""}
        </div>`;
      })
      .join("");
  }

  async function init() {
    updateGateUI();
    const session = await window.DB.getSession();
    if (session) {
      currentUser = session.user;
      await loadAccount();
      await loadOrders();
      showDashboard();
    }
  }
  init();
})();
