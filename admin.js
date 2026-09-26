(function () {
  const $ = (id) => document.getElementById(id);
  let items = [];
  let history = [];
  let currentFilter = "todos";

  const pixKeyTypeLabel = {
    CPF: "CPF",
    CNPJ: "CNPJ",
    EMAIL: "E-mail",
    PHONE: "Telefone",
    EVP: "Chave aleatória",
  };

  /* ---------------- LOGIN ---------------- */
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("gateEmail").value.trim();
    const password = $("gatePassword").value;
    const errBox = $("gateError");
    errBox.style.display = "none";
    try {
      await window.DB.signIn({ email, password });
      await loadData();
      $("loginGate").style.display = "none";
      $("dashboardContent").style.display = "block";
    } catch (err) {
      errBox.textContent = (err && err.message) || String(err);
      errBox.style.display = "block";
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await window.DB.signOut();
    location.reload();
  });

  /* ---------------- DADOS ---------------- */
  async function loadData() {
    const data = await window.DB.getAdminData();
    items = data.items;
    history = data.history || [];
    renderSummary();
    renderList();
    renderHistory();
  }

  function renderSummary() {
    const withBalance = items.filter((it) => it.balance > 0);
    const total = withBalance.reduce((sum, it) => sum + it.balance, 0);
    $("totalPending").textContent = "R$ " + total.toFixed(2).replace(".", ",");
    $("totalAccounts").textContent = String(withBalance.length);
  }

  function matchesFilter(it) {
    if (currentFilter === "todos") return true;
    if (currentFilter === "com-saldo") return it.balance > 0;
    return it.type === currentFilter;
  }

  function renderList() {
    const list = $("usersList");
    const visible = items.filter(matchesFilter).sort((a, b) => b.balance - a.balance);
    if (!visible.length) {
      list.innerHTML = '<div class="empty-state">Nenhuma conta encontrada com esse filtro.</div>';
      return;
    }
    list.innerHTML = visible
      .map((it) => {
        const hasPix = it.pixKey && it.pixKeyType && it.pixOwnerDocument;
        return `
      <div class="user-card" data-type="${it.type}" data-id="${it.id}">
        <div class="row">
          <div>
            <span class="name">${it.name || "(sem nome)"}</span>
            <span class="type-badge ${it.type}">${it.type === "restaurante" ? "Restaurante" : "Entregador"}</span>
          </div>
          <div class="balance">R$ ${Number(it.balance).toFixed(2).replace(".", ",")}</div>
        </div>
        ${
          hasPix
            ? `<div class="pix-line">Pix (${pixKeyTypeLabel[it.pixKeyType] || it.pixKeyType}): ${it.pixKey} · Titular: ${it.pixOwnerDocument}</div>`
            : `<div class="pix-line">Sem chave PIX cadastrada ainda.</div>`
        }
        ${
          it.pendingPayout
            ? `<div class="pending-badge">Saque solicitado em ${new Date(it.pendingPayout.createdAt).toLocaleDateString("pt-BR")}</div>`
            : ""
        }
        <div class="actions">
          ${
            it.balance > 0 && hasPix
              ? `<button class="primary-btn green" data-action="settle">Marcar saldo como pago</button>`
              : ""
          }
        </div>
      </div>`;
      })
      .join("");

    list.querySelectorAll('[data-action="settle"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".user-card");
        const type = card.dataset.type;
        const id = card.dataset.id;
        const item = items.find((it) => it.type === type && it.id === id);
        if (!confirm(`Confirma que já fez o Pix de R$ ${Number(item.balance).toFixed(2).replace(".", ",")} para "${item.name}"?`)) return;
        btn.disabled = true;
        btn.textContent = "Confirmando...";
        try {
          await window.DB.settlePayout(type, id);
          await loadData();
        } catch (err) {
          alert("Não foi possível confirmar: " + ((err && err.message) || err));
          btn.disabled = false;
          btn.textContent = "Marcar saldo como pago";
        }
      });
    });
  }

  /* ---------------- HISTÓRICO DE PAGAMENTOS ---------------- */
  function renderHistory() {
    const list = $("historyList");
    if (!list) return;
    if (!history.length) {
      list.innerHTML = '<div class="empty-state">Nenhum pagamento registrado ainda.</div>';
      return;
    }
    list.innerHTML = history
      .map((h) => {
        const date = new Date(h.createdAt);
        const dateLabel = date.toLocaleDateString("pt-BR") + " às " + date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        const isReversed = h.status === "estornado";
        return `
      <div class="user-card${isReversed ? " reversed" : ""}" data-payout-id="${h.id}">
        <div class="row">
          <div>
            <span class="name">${h.name || "(sem nome)"}</span>
            <span class="type-badge ${h.type}">${h.type === "restaurante" ? "Restaurante" : "Entregador"}</span>
          </div>
          <div class="balance">R$ ${Number(h.amount).toFixed(2).replace(".", ",")}</div>
        </div>
        <div class="pix-line">Pago em ${dateLabel}${isReversed ? " · <strong>Estornado</strong>" : ""}</div>
        <div class="actions">
          ${
            !isReversed
              ? `<button class="primary-btn danger" data-action="undo">Desfazer (houve erro)</button>`
              : ""
          }
        </div>
      </div>`;
      })
      .join("");

    list.querySelectorAll('[data-action="undo"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".user-card");
        const payoutId = card.dataset.payoutId;
        const entry = history.find((h) => h.id === payoutId);
        if (
          !confirm(
            `Confirma que houve erro nesse pagamento de R$ ${Number(entry.amount).toFixed(2).replace(".", ",")} para "${entry.name}"?\n\nO valor volta para o saldo dessa conta e ela aparecerá novamente na lista de saldos pendentes.`
          )
        )
          return;
        btn.disabled = true;
        btn.textContent = "Desfazendo...";
        try {
          await window.DB.undoPayout(payoutId);
          await loadData();
        } catch (err) {
          alert("Não foi possível desfazer: " + ((err && err.message) || err));
          btn.disabled = false;
          btn.textContent = "Desfazer (houve erro)";
        }
      });
    });
  }

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderList();
    });
  });

  document.querySelectorAll(".section-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".section-tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".section-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const panel = btn.dataset.section === "historico" ? $("panelHistorico") : $("panelSaldos");
      panel.classList.add("active");
    });
  });

  $("refreshBtn").addEventListener("click", loadData);

  /* ---------------- INICIALIZAÇÃO ---------------- */
  (async function init() {
    const session = await window.DB.getSession();
    if (!session) return;
    try {
      await loadData();
      $("loginGate").style.display = "none";
      $("dashboardContent").style.display = "block";
    } catch (err) {
      // Sessão existe mas a conta não é admin (ou algo falhou) — desloga
      // e deixa a pessoa tentar de novo pela tela de login.
      await window.DB.signOut();
    }
  })();
})();
