(function () {
  const $ = (id) => document.getElementById(id);
  let currentUser = null;
  let profile = null;
  let gateMode = "signin";
  let pollTimer = null;

  /* ---------------- LOGIN / CADASTRO ---------------- */
  function updateGateUI() {
    $("gateTitle").textContent = gateMode === "signin" ? "Entre na sua conta de entregador" : "Cadastre-se como entregador";
    $("gateSubmit").textContent = gateMode === "signin" ? "Entrar" : "Criar conta";
    $("gateFieldName").style.display = gateMode === "signup" ? "block" : "none";
    $("gateFieldPhone").style.display = gateMode === "signup" ? "block" : "none";
    $("gateSwitchText").textContent = gateMode === "signin" ? "Ainda não tem conta de entregador?" : "Já tem uma conta?";
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
        const phone = $("gatePhone").value.trim();
        ({ user } = await window.DB.signUp({ name, email, phone, password, role: "entregador" }));
      } else {
        ({ user } = await window.DB.signIn({ email, password }));
      }
      currentUser = user;
      profile = await window.DB.getProfile(currentUser.id);
      if (profile.role !== "entregador") {
        await window.DB.signOut();
        throw new Error("Esta conta não está cadastrada como entregador. Use a tela inicial do app para entrar como cliente.");
      }
      showDashboard();
    } catch (err) {
      errBox.textContent = (err && err.message) || String(err);
      errBox.style.display = "block";
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await window.DB.signOut();
    clearInterval(pollTimer);
    location.reload();
  });

  /* ---------------- ABAS ---------------- */
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $("panel-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "available") loadAvailable();
      if (btn.dataset.tab === "mine") loadMine();
    });
  });

  /* ---------------- ENTREGAS DISPONÍVEIS ---------------- */
  async function loadAvailable() {
    if (!profile.city) {
      $("availableList").innerHTML =
        '<div class="empty-state">Defina sua cidade de atuação na aba "Conta" para começar a ver corridas disponíveis.</div>';
      return;
    }
    const list = await window.DB.getAvailableDeliveries();
    renderAvailable(list);
  }

  function renderAvailable(deliveries) {
    const box = $("availableList");
    if (!deliveries.length) {
      box.innerHTML = '<div class="empty-state">Nenhuma corrida disponível no momento.<br>Assim que um restaurante marcar um pedido como pronto, ele aparece aqui.</div>';
      return;
    }
    box.innerHTML = deliveries
      .map(
        (d) => `
      <div class="delivery-card" data-id="${d.id}">
        <div class="stop pickup">
          <div class="dot"></div>
          <div><div class="label">Retirar em</div>${d.restaurantName}<br><span style="color:var(--ink-soft);">${d.restaurantAddress || "Endereço não informado"}</span></div>
        </div>
        <div class="stop dropoff">
          <div class="dot"></div>
          <div><div class="label">Entregar em</div>${d.address}</div>
        </div>
        <div class="row">
          <span class="fee-tag">Você ganha: R$ ${Number(d.deliveryFee ?? 0).toFixed(2).replace(".", ",")}${d.distanceKm ? ` · ${d.distanceKm} km` : ""}</span>
          <button class="primary-btn green" style="width:auto; padding:10px 18px;" data-action="claim">Aceitar corrida</button>
        </div>
      </div>`
      )
      .join("");

    box.querySelectorAll("[data-action='claim']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".delivery-card");
        const orderId = card.dataset.id;
        btn.disabled = true;
        btn.textContent = "Aceitando...";
        try {
          const { order } = await window.DB.claimDelivery(orderId, currentUser.id);
          alert(
            "Corrida aceita! Seu código de retirada é " +
              order.pickupCode +
              ". Mostre este código ao restaurante para pegar o pedido."
          );
          await loadAvailable();
        } catch (err) {
          // Outro entregador foi mais rápido, ou o pedido não está mais disponível.
          alert((err && err.message) || String(err));
          await loadAvailable();
        }
      });
    });
  }

  /* ---------------- MINHAS ENTREGAS ---------------- */
  async function loadMine() {
    const list = await window.DB.getMyDeliveries(currentUser.id);
    renderMine(list);
  }

  const statusLabel = { pronto: "Aguardando retirada", a_caminho: "A caminho do cliente", entregue: "Entregue" };

  function renderMine(deliveries) {
    const box = $("mineList");
    const active = deliveries.filter((d) => d.status !== "entregue");
    const done = deliveries.filter((d) => d.status === "entregue");

    if (!deliveries.length) {
      box.innerHTML = '<div class="empty-state">Você ainda não aceitou nenhuma corrida.</div>';
      return;
    }

    function card(d) {
      let action = "";
      if (d.status === "pronto") {
        action = `<button class="primary-btn green" data-action="pickup">Confirmar retirada no restaurante</button>`;
      } else if (d.status === "a_caminho") {
        action = `<button class="primary-btn" data-action="deliver">Confirmar entrega ao cliente</button>`;
      }
      return `
      <div class="delivery-card" data-id="${d.id}">
        <div class="row">
          <span class="status-badge status-${d.status}">${statusLabel[d.status] || d.status}</span>
          <span class="fee-tag">R$ ${Number(d.deliveryFee ?? 0).toFixed(2).replace(".", ",")}</span>
        </div>
        <div class="stop pickup">
          <div class="dot"></div>
          <div><div class="label">Retirar em</div>${d.restaurantName}<br><span style="color:var(--ink-soft);">${d.restaurantAddress || ""}</span></div>
        </div>
        <div class="stop dropoff">
          <div class="dot"></div>
          <div><div class="label">Entregar em</div>${d.address}</div>
        </div>
        ${d.status !== "entregue" ? `<div class="code-box">Código de retirada<strong>${d.pickupCode}</strong></div>` : ""}
        ${action}
        <button class="chat-btn" data-chat-order="${d.id}">💬 Chat com o cliente</button>
      </div>`;
    }

    box.innerHTML =
      (active.length ? active.map(card).join("") : '<div class="empty-state">Nenhuma entrega em andamento.</div>') +
      (done.length
        ? `<div style="margin:18px 0 10px; font-weight:700; color:var(--ink-soft); font-size:13px;">Concluídas</div>` +
          done.map(card).join("")
        : "");

    box.querySelectorAll("[data-chat-order]").forEach((btn) => {
      btn.addEventListener("click", () =>
        openChat(btn.dataset.chatOrder, "entregador", "Chat com o cliente")
      );
    });

    box.querySelectorAll("[data-action='pickup']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest(".delivery-card").dataset.id;
        await window.DB.confirmPickup(id);
        loadMine();
      });
    });
    box.querySelectorAll("[data-action='deliver']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest(".delivery-card").dataset.id;
        if (!confirm("Confirmar que o pedido foi entregue ao cliente?")) return;
        await window.DB.confirmDelivery(id);
        loadMine();
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
    const mine = m.senderRole === "entregador";
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
    await window.DB.sendMessage(chatOrderId, "entregador", content, "entregador");
  });

  /* ---------------- CONTA ---------------- */
  function renderAccount() {
    $("profileBox").innerHTML = `
      <div style="font-weight:700; font-size:16px;">${profile.name || "Sem nome"}</div>
      <div style="color:var(--ink-soft); font-size:14px; margin-top:4px;">${profile.email || ""}</div>
      <div style="color:var(--ink-soft); font-size:14px;">${profile.phone || "Telefone não informado"}</div>
    `;
    $("myCity").value = profile.city || "";
  }

  $("cityForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const city = $("myCity").value.trim();
    if (!city) return;
    try {
      await window.DB.updateProfile(currentUser.id, { city });
      profile.city = city;
      const msg = $("citySaveMsg");
      msg.style.display = "block";
      setTimeout(() => (msg.style.display = "none"), 2500);
      // A cidade mudou: recarrega a lista de disponíveis para refletir o filtro novo.
      if ($("panel-available").classList.contains("active")) loadAvailable();
    } catch (err) {
      alert("Não foi possível salvar: " + ((err && err.message) || err));
    }
  });

  /* ---------------- INICIALIZAÇÃO ---------------- */
  function showDashboard() {
    $("loginGate").style.display = "none";
    $("dashboardContent").style.display = "block";
    renderAccount();
    loadAvailable();
    loadMine();
    pollTimer = setInterval(() => {
      if ($("panel-available").classList.contains("active")) loadAvailable();
      if ($("panel-mine").classList.contains("active")) loadMine();
    }, 15000);
  }

  async function init() {
    updateGateUI();
    const session = await window.DB.getSession();
    if (session) {
      currentUser = session.user;
      profile = await window.DB.getProfile(currentUser.id);
      if (profile.role === "entregador") showDashboard();
    }
  }
  init();
})();
