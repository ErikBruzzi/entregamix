(function () {
  const $ = (id) => document.getElementById(id);
  let items = [];
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
    items = await window.DB.getAdminData();
    renderSummary();
    renderList();
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

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderList();
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
