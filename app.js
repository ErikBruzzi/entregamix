(function () {
  let currentUser = null;
  let authMode = "signin"; // ou "signup"
  let restaurants = [];
  let activeRestaurant = null;
  let cart = []; // { id, name, price, quantity, restaurantId }
  let orders = [];

  const screens = ["auth", "home", "menu", "cart", "checkout", "orders", "account"];
  const $ = (id) => document.getElementById(id);

  function showScreen(name) {
    screens.forEach((s) => $("screen-" + s).classList.toggle("active", s === name));
    document.querySelectorAll(".nav-btn").forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.go === name)
    );
    $("bottomNav").style.display = name === "auth" ? "none" : "flex";
    if (name === "home") renderRestaurants();
    if (name === "cart") renderCart();
    if (name === "orders") renderOrders();
    if (name === "account") renderAccount();
    if (name === "checkout") renderCheckout();
    window.scrollTo(0, 0);
  }

  function requireAuth(nextScreen) {
    if (!currentUser) {
      showScreen("auth");
      return false;
    }
    showScreen(nextScreen);
    return true;
  }

  document.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const target = el.dataset.go;
      if ((target === "orders" || target === "account" || target === "checkout") && !currentUser) {
        showScreen("auth");
        return;
      }
      showScreen(target);
    });
  });

  /* ---------------- AUTENTICAÇÃO ---------------- */
  function updateAuthUI() {
    $("authTitle").textContent = authMode === "signin" ? "Entrar na sua conta" : "Criar sua conta";
    $("authSubmit").textContent = authMode === "signin" ? "Entrar" : "Criar conta";
    $("fieldName").style.display = authMode === "signup" ? "block" : "none";
    $("fieldRole").style.display = authMode === "signup" ? "block" : "none";
    $("fieldPhone").style.display = authMode === "signup" ? "block" : "none";
    $("fieldTerms").style.display = authMode === "signup" ? "block" : "none";
    $("authTerms").checked = false;
    $("switchModeText").innerHTML =
      authMode === "signin"
        ? 'Ainda não tem conta? <a href="#" id="switchModeLink">Criar conta</a>'
        : 'Já tem uma conta? <a href="#" id="switchModeLink">Entrar</a>';
    document.getElementById("switchModeLink").addEventListener("click", (e) => {
      e.preventDefault();
      authMode = authMode === "signin" ? "signup" : "signin";
      updateAuthUI();
    });
  }
  document.getElementById("switchModeLink").addEventListener("click", (e) => {
    e.preventDefault();
    authMode = "signup";
    updateAuthUI();
  });

  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const btn = $("authSubmit");
    btn.disabled = true;
    btn.textContent = "Aguarde...";
    try {
      if (authMode === "signup") {
        if (!$("authTerms").checked) {
          alert("Para criar sua conta, você precisa ler e concordar com os Termos de Uso e Política de Repasses.");
          btn.disabled = false;
          return;
        }
        const name = $("authName").value.trim();
        const phone = $("authPhone").value.trim();
        const role = $("authRole").value;
        const { user, session } = await window.DB.signUp({ name, email, phone, password, role, termsAccepted: true });
        currentUser = user;

        if (!session) {
          // Conta criada com sucesso, mas o projeto exige confirmação de
          // e-mail — ainda não existe login ativo. Não tenta buscar nada
          // autenticado; só avisa e volta para a tela de login.
          $("authForm").reset();
          authMode = "signin";
          updateAuthUI();
          alert("Conta criada! Verifique seu e-mail para confirmar antes de entrar.");
          btn.disabled = false;
          return;
        }
      } else {
        const { user } = await window.DB.signIn({ email, password });
        currentUser = user;
      }
      $("authForm").reset();
      const profile = await window.DB.getProfile(currentUser.id);
      if (profile.role === "restaurante") {
        window.location.href = "restaurante.html";
        return;
      }
      if (profile.role === "entregador") {
        window.location.href = "entregador.html";
        return;
      }
      await loadOrders();
      showScreen("home");
    } catch (err) {
      alert("Não foi possível continuar: " + (err.message || err));
    } finally {
      btn.disabled = false;
      updateAuthUI();
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await window.DB.signOut();
    currentUser = null;
    orders = [];
    cart = [];
    showScreen("auth");
  });

  /* ---------------- RESTAURANTES ---------------- */
  const thumbColors = ["#D6202A", "#167A46", "#171717", "#A81620", "#0F5C34"];
  function colorFor(id) {
    let hash = 0;
    for (const ch of id) hash += ch.charCodeAt(0);
    return thumbColors[hash % thumbColors.length];
  }

  async function loadRestaurants() {
    restaurants = await window.DB.getRestaurants();
  }

  function renderRestaurants(filter) {
    const list = $("restaurantList");
    const term = (filter || $("searchInput").value || "").toLowerCase();
    const visible = restaurants.filter(
      (r) => r.name.toLowerCase().includes(term) || (r.category || "").toLowerCase().includes(term)
    );
    if (!visible.length) {
      list.innerHTML = '<div class="empty-state">Nenhum restaurante encontrado.</div>';
      return;
    }
    list.innerHTML = visible
      .map(
        (r) => `
      <div class="restaurant-card" data-id="${r.id}">
        ${
          r.imageUrl
            ? `<img class="restaurant-thumb" src="${r.imageUrl}" alt="${r.name}" style="object-fit:cover;" />`
            : `<div class="restaurant-thumb" style="background:${colorFor(r.id)}">${r.name.charAt(0)}</div>`
        }
        <div class="restaurant-info">
          <div class="name">${r.name}</div>
          <div class="meta">
            <span class="chip">${r.category || "Variado"}</span>
            <span>${r.etaMinutes} min · Entrega a partir de R$ ${Number(r.deliveryBaseFee).toFixed(2).replace(".", ",")}</span>
          </div>
        </div>
      </div>`
      )
      .join("");
    list.querySelectorAll(".restaurant-card").forEach((card) => {
      card.addEventListener("click", () => openMenu(card.dataset.id));
    });
  }
  $("searchInput").addEventListener("input", () => renderRestaurants());

  async function openMenu(restaurantId) {
    activeRestaurant = restaurants.find((r) => r.id === restaurantId);
    $("menuRestaurantName").textContent = activeRestaurant.name;
    $("menuRestaurantMeta").textContent = `${activeRestaurant.category || ""} · ${activeRestaurant.etaMinutes} min`;
    const items = await window.DB.getMenu(restaurantId);
    $("menuList").innerHTML = items
      .map(
        (it) => `
      <div class="menu-item">
        ${
          it.imageUrl
            ? `<img class="item-thumb" src="${it.imageUrl}" alt="${it.name}" />`
            : `<div class="item-thumb-placeholder">🍽️</div>`
        }
        <div class="info">
          <div class="name">${it.name}</div>
          ${it.description ? `<div class="desc">${it.description}</div>` : ""}
          <div class="price">R$ ${Number(it.price).toFixed(2).replace(".", ",")}</div>
        </div>
        <button class="add-btn" data-id="${it.id}" data-name="${it.name}" data-price="${it.price}">+</button>
      </div>`
      )
      .join("");
    $("menuList").querySelectorAll(".add-btn").forEach((btn) => {
      btn.addEventListener("click", () => addToCart(btn.dataset));
    });
    showScreen("menu");
  }

  /* ---------------- CARRINHO ---------------- */
  function addToCart(data) {
    if (cart.length && cart[0].restaurantId !== activeRestaurant.id) {
      if (!confirm("Seu carrinho tem itens de outro restaurante. Deseja esvaziar e adicionar este item?")) return;
      cart = [];
    }
    const existing = cart.find((c) => c.id === data.id);
    if (existing) existing.quantity += 1;
    else
      cart.push({
        id: data.id,
        name: data.name,
        price: parseFloat(data.price),
        quantity: 1,
        restaurantId: activeRestaurant.id,
      });
    updateCartBadge();
    const addBtn = event.target;
    addBtn.textContent = "✓";
    setTimeout(() => (addBtn.textContent = "+"), 500);
  }

  function updateCartBadge() {
    const count = cart.reduce((sum, c) => sum + c.quantity, 0);
    const badge = $("cartBadge");
    badge.textContent = count;
    badge.style.display = count > 0 ? "flex" : "none";
  }

  function cartTotal() {
    const subtotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
    const fee = calculatedDelivery ? calculatedDelivery.fee : 0;
    return { subtotal, fee, total: subtotal + fee };
  }

  function renderCart() {
    const content = $("cartContent");
    if (!cart.length) {
      content.innerHTML = '<div class="empty-state">Seu carrinho está vazio.<br>Escolha um restaurante para começar.</div>';
      return;
    }
    const { subtotal } = cartTotal();
    content.innerHTML =
      cart
        .map(
          (c) => `
      <div class="cart-line">
        <div>
          <div style="font-weight:600; font-size:14px;">${c.name}</div>
          <div style="font-size:13px; color:var(--ink-soft);">R$ ${c.price.toFixed(2).replace(".", ",")}</div>
        </div>
        <div class="qty-control">
          <button data-id="${c.id}" data-op="dec">−</button>
          <span>${c.quantity}</span>
          <button data-id="${c.id}" data-op="inc">+</button>
        </div>
      </div>`
        )
        .join("") +
      `
      <div class="totals-row"><span>Subtotal</span><span>R$ ${subtotal.toFixed(2).replace(".", ",")}</span></div>
      <div class="totals-row" style="color:var(--ink-soft); font-size:12px;"><span>Taxa de entrega</span><span>Calculada na próxima etapa, por distância</span></div>
      <button class="primary-btn" id="goCheckoutBtn">Ir para o endereço</button>
    `;
    content.querySelectorAll("[data-op]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = cart.find((c) => c.id === btn.dataset.id);
        if (btn.dataset.op === "inc") item.quantity += 1;
        else item.quantity -= 1;
        cart = cart.filter((c) => c.quantity > 0);
        updateCartBadge();
        renderCart();
      });
    });
    const checkoutBtn = document.getElementById("goCheckoutBtn");
    if (checkoutBtn)
      checkoutBtn.addEventListener("click", () => {
        if (!currentUser) return showScreen("auth");
        showScreen("checkout");
      });
  }

  /* ---------------- CHECKOUT (com cálculo de frete por distância) ---------------- */
  let calculatedDelivery = null; // { fee, distanceKm, durationMin }

  function renderCheckout() {
    calculatedDelivery = null;
    $("deliveryEstimate").innerHTML = "";
    $("checkoutFee").textContent = "—";
    $("confirmOrderBtn").disabled = true;
    $("confirmOrderBtn").textContent = "Calcule o frete para continuar";
    $("confirmOrderBtn").style.display = "block";
    resetPaymentSection();
    updateCheckoutTotals();
  }

  function updateCheckoutTotals() {
    const { subtotal, fee, total } = cartTotal();
    $("checkoutSubtotal").textContent = "R$ " + subtotal.toFixed(2).replace(".", ",");
    $("checkoutFee").textContent = calculatedDelivery ? "R$ " + fee.toFixed(2).replace(".", ",") : "—";
    $("checkoutTotal").textContent = "R$ " + total.toFixed(2).replace(".", ",");
  }

  $("calcFeeBtn").addEventListener("click", async () => {
    const address = $("checkoutAddress").value.trim();
    const city = $("checkoutCity").value.trim();
    if (!address) return alert("Digite o endereço de entrega primeiro.");
    if (!city) return alert("Digite a cidade de entrega — sem isso o cálculo de distância fica impreciso.");
    const btn = $("calcFeeBtn");
    btn.disabled = true;
    btn.textContent = "Calculando...";
    $("deliveryEstimate").innerHTML = "";
    try {
      const result = await window.DB.calculateDeliveryFee(activeRestaurant.id, address, city);
      calculatedDelivery = result;
      $("deliveryEstimate").innerHTML =
        `<div class="delivery-estimate">📍 <strong>${result.distanceKm} km</strong> do restaurante · chegada em cerca de <strong>${result.durationMin} min</strong></div>`;
      $("confirmOrderBtn").disabled = false;
      $("confirmOrderBtn").textContent = "Confirmar pedido";
      updateCheckoutTotals();
    } catch (err) {
      calculatedDelivery = null;
      $("deliveryEstimate").innerHTML = `<div class="delivery-estimate" style="color:var(--red-dark);">${(err && err.message) || err}</div>`;
      $("confirmOrderBtn").disabled = true;
      $("confirmOrderBtn").textContent = "Calcule o frete para continuar";
    } finally {
      btn.disabled = false;
      btn.textContent = "Calcular frete";
    }
  });

  // Se o cliente mudar o endereço ou a cidade depois de calcular, invalida o
  // frete calculado anteriormente para evitar cobrar a distância errada.
  function invalidateDeliveryEstimate() {
    if (calculatedDelivery) {
      calculatedDelivery = null;
      $("deliveryEstimate").innerHTML = "";
      $("confirmOrderBtn").disabled = true;
      $("confirmOrderBtn").textContent = "Calcule o frete para continuar";
      updateCheckoutTotals();
    }
  }
  $("checkoutAddress").addEventListener("input", invalidateDeliveryEstimate);
  $("checkoutCity").addEventListener("input", invalidateDeliveryEstimate);

  /* ---------------- PAGAMENTO (MERCADO PAGO) ---------------- */
  const mp = window.MercadoPago && window.APP_CONFIG.MP_PUBLIC_KEY
    ? new MercadoPago(window.APP_CONFIG.MP_PUBLIC_KEY, { locale: "pt-BR" })
    : null;
  let paymentBrick = null;

  function resetPaymentSection() {
    $("paymentSection").style.display = "none";
    $("paymentError").style.display = "none";
    $("paymentError").textContent = "";
    $("pixResult").style.display = "none";
    $("pixResult").innerHTML = "";
    if (paymentBrick) {
      try { paymentBrick.unmount(); } catch (e) { /* já desmontado */ }
      paymentBrick = null;
    }
  }

  // Envia o pedido + os dados de pagamento (se houver) para a Edge Function,
  // que de fato cria o pedido no banco e cobra no Mercado Pago.
  async function submitOrder(formData) {
    const address = $("checkoutAddress").value.trim();
    const city = $("checkoutCity").value.trim();
    const { subtotal, fee, total } = cartTotal();
    return window.DB.createMpPayment({
      restaurantId: activeRestaurant.id,
      items: cart,
      address,
      deliveryCity: city,
      foodSubtotal: subtotal,
      deliveryFee: fee,
      deliveryDistanceKm: calculatedDelivery.distanceKm,
      total,
      formData: formData || {},
    });
  }

  $("confirmOrderBtn").addEventListener("click", async () => {
    const address = $("checkoutAddress").value.trim();
    const city = $("checkoutCity").value.trim();
    if (!address || !city || !calculatedDelivery) return alert("Calcule o frete antes de confirmar.");

    if (!mp) {
      // Modo demonstração: não há Mercado Pago de verdade, o pedido já é
      // criado direto como se o pagamento tivesse sido aprovado na hora.
      const btn = $("confirmOrderBtn");
      btn.disabled = true;
      btn.textContent = "Processando...";
      try {
        await submitOrder({});
        await finishCheckout();
      } catch (err) {
        alert("Não foi possível concluir o pedido: " + ((err && err.message) || err));
      } finally {
        btn.disabled = false;
        btn.textContent = "Ir para pagamento";
      }
      return;
    }

    const { total } = cartTotal();
    $("confirmOrderBtn").style.display = "none";
    $("paymentSection").style.display = "block";
    $("paymentError").style.display = "none";

    try {
      paymentBrick = await mp.bricks().create("payment", "paymentElement", {
        initialization: {
          amount: total,
          payer: { email: (currentUser && currentUser.email) || "" },
        },
        customization: {
          paymentMethods: {
            creditCard: "all",
            debitCard: "all",
            bankTransfer: "all", // inclui Pix
          },
        },
        callbacks: {
          onReady: () => {
            // O Brick terminou de montar o formulário — nada a fazer aqui,
            // mas o Mercado Pago exige que esse callback exista.
          },
          onError: (error) => {
            console.error(error);
            $("paymentError").textContent = "Não foi possível carregar o formulário de pagamento.";
            $("paymentError").style.display = "block";
          },
          onSubmit: ({ formData }) => {
            return new Promise(async (resolve, reject) => {
              $("paymentError").style.display = "none";
              try {
                const result = await submitOrder(formData);
                if (result.status === "approved") {
                  await finishCheckout();
                } else if (result.qrCodeBase64) {
                  // Pix: fica pendente até o cliente pagar o QR code; o
                  // mp-webhook confirma o pagamento depois, em segundo plano.
                  showPixResult(result.qrCode, result.qrCodeBase64);
                } else if (result.status === "pending" || result.status === "in_process") {
                  await finishCheckout();
                  alert("Pagamento em análise. Você será avisado assim que for confirmado.");
                } else {
                  throw new Error("Pagamento não aprovado. Tente outra forma de pagamento.");
                }
                resolve();
              } catch (err) {
                $("paymentError").textContent = (err && err.message) || String(err);
                $("paymentError").style.display = "block";
                reject();
              }
            });
          },
        },
      });
    } catch (err) {
      alert("Não foi possível iniciar o pagamento: " + ((err && err.message) || err));
      $("confirmOrderBtn").style.display = "block";
      $("paymentSection").style.display = "none";
    }
  });

  function showPixResult(qrCode, qrCodeBase64) {
    $("paymentSection").style.display = "none";
    const box = $("pixResult");
    box.style.display = "block";
    box.innerHTML =
      '<div class="section-title" style="font-size:15px;">Pague com Pix para concluir</div>' +
      '<img src="data:image/png;base64,' + qrCodeBase64 + '" alt="QR Code Pix" style="width:220px; display:block; margin:0 auto 12px;" />' +
      '<p style="font-size:13px; color:var(--ink-soft); margin-bottom:8px;">Ou copie o código Pix copia-e-cola:</p>' +
      '<textarea readonly style="width:100%; height:70px; font-size:11px; margin-bottom:10px;">' + (qrCode || "") + '</textarea>' +
      '<p style="font-size:13px; color:var(--ink-soft);">Assim que o pagamento for confirmado, o pedido aparece em "Pedidos".</p>' +
      '<button class="primary-btn" id="pixDoneBtn" style="margin-top:12px;">Já paguei / Ver meus pedidos</button>';
    $("pixDoneBtn").addEventListener("click", finishCheckout);
  }

  async function finishCheckout() {
    cart = [];
    updateCartBadge();
    $("checkoutAddress").value = "";
    $("checkoutCity").value = "";
    calculatedDelivery = null;
    resetPaymentSection();
    $("confirmOrderBtn").style.display = "block";
    await loadOrders();
    showScreen("orders");
  }

  /* ---------------- PEDIDOS ---------------- */
  async function loadOrders() {
    if (!currentUser) return;
    orders = await window.DB.getOrders(currentUser.id);
  }

  const statusLabel = {
    aguardando_pagamento: "Aguardando pagamento",
    recebido: "Recebido",
    preparando: "Preparando",
    a_caminho: "A caminho",
    entregue: "Entregue",
    cancelado: "Cancelado",
  };

  function renderOrders() {
    const list = $("ordersList");
    if (!orders.length) {
      list.innerHTML = '<div class="empty-state">Você ainda não fez nenhum pedido.</div>';
      return;
    }
    list.innerHTML = orders
      .map((o) => {
        const date = new Date(o.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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
          <div>
            <button class="chat-btn" data-chat-order="${o.id}" data-chat-channel="restaurante" data-chat-title="Chat com ${o.restaurantName}">💬 Falar com o restaurante</button>
            ${o.courierId ? `<button class="chat-btn" data-chat-order="${o.id}" data-chat-channel="entregador" data-chat-title="Chat com o entregador">💬 Falar com o entregador</button>` : ""}
            ${o.paymentStatus === "pago" ? `<a class="chat-btn" href="recibo.html?order=${o.id}" target="_blank" rel="noopener" style="text-decoration:none; display:inline-block;">🧾 Ver comprovante</a>` : ""}
          </div>
        </div>`;
      })
      .join("");
    list.querySelectorAll("[data-chat-order]").forEach((btn) => {
      btn.addEventListener("click", () =>
        openChat(btn.dataset.chatOrder, btn.dataset.chatChannel, btn.dataset.chatTitle, "cliente")
      );
    });
  }

  /* ---------------- CHAT ---------------- */
  let chatSub = null;
  let chatOrderId = null;
  let chatChannel = null;
  let chatSenderRole = null;

  async function openChat(orderId, channel, title, senderRole) {
    chatOrderId = orderId;
    chatChannel = channel;
    chatSenderRole = senderRole;
    $("chatTitle").textContent = title;
    $("chatOverlay").classList.add("active");
    $("chatMessages").innerHTML = '<div class="chat-empty">Carregando conversa...</div>';
    const msgs = await window.DB.getMessages(orderId, channel);
    renderChatMessages(msgs);
    if (chatSub) window.DB.unsubscribe(chatSub);
    chatSub = window.DB.subscribeToMessages(orderId, channel, (msg) => {
      appendChatMessage(msg);
    });
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
    msgs.forEach((m) => appendChatMessage(m, true));
  }

  function appendChatMessage(m, skipScroll) {
    const box = $("chatMessages");
    if (box.querySelector(".chat-empty")) box.innerHTML = "";
    const mine = m.senderRole === chatSenderRole;
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble " + (mine ? "mine" : "theirs");
    const who = mine ? "Você" : m.senderRole === "restaurante" ? "Restaurante" : m.senderRole === "entregador" ? "Entregador" : "Cliente";
    bubble.innerHTML = `<div class="who">${who}</div>${escapeHtml(m.content)}`;
    box.appendChild(bubble);
    if (!skipScroll) box.scrollTop = box.scrollHeight;
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
    await window.DB.sendMessage(chatOrderId, chatChannel, content, chatSenderRole);
    $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
  });

  /* ---------------- CONTA ---------------- */
  async function renderAccount() {
    if (!currentUser) return;
    const profile = await window.DB.getProfile(currentUser.id);
    $("accountSummary").innerHTML = `
      <div style="background:var(--surface); border-radius:12px; padding:16px;">
        <div style="font-weight:700; font-size:16px;">${profile.name || "Sem nome"}</div>
        <div style="color:var(--ink-soft); font-size:14px; margin-top:4px;">${profile.email || ""}</div>
        <div style="color:var(--ink-soft); font-size:14px;">${profile.phone || "Telefone não informado"}</div>
      </div>`;
  }

  /* ---------------- INICIALIZAÇÃO ---------------- */
  function showFatalError(err) {
    console.error("Falha ao iniciar o Mix:", err);
    document.getElementById("app").innerHTML = `
      <div style="padding:24px; font-family:Inter,sans-serif;">
        <h2 style="color:#D6202A;">Não foi possível carregar o app</h2>
        <p style="color:#6B6B6B; font-size:14px;">Detalhe técnico (mostre isso para quem for te ajudar a corrigir):</p>
        <pre style="background:#F7F7F7; padding:12px; border-radius:8px; font-size:12px; white-space:pre-wrap; word-break:break-word;">${(err && err.message) || err}</pre>
        <p style="color:#6B6B6B; font-size:13px;">Causas mais comuns: a URL ou a chave anon em js/config.js estão erradas ou incompletas, ou a tabela "restaurants" ainda não existe no Supabase.</p>
      </div>`;
  }

  async function init() {
    try {
      updateAuthUI();
      await loadRestaurants();
      const session = await window.DB.getSession();
      if (session) {
        currentUser = session.user;
        const profile = await window.DB.getProfile(currentUser.id);
        if (profile.role === "restaurante") return void (window.location.href = "restaurante.html");
        if (profile.role === "entregador") return void (window.location.href = "entregador.html");
        await loadOrders();
      }
      showScreen("home"); // navegar sem login é permitido; login só é pedido no checkout/pedidos/conta
      window.DB.onAuthChange((user) => {
        currentUser = user;
      });
    } catch (err) {
      showFatalError(err);
    }
  }

  init();
})();
