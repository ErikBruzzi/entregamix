(function () {
  const paymentMethodLabel = {
    pix: "Pix",
    credit_card: "Cartão de crédito",
    debit_card: "Cartão de débito",
    account_money: "Saldo em conta",
  };

  function money(v) {
    return "R$ " + Number(v || 0).toFixed(2).replace(".", ",");
  }

  (async function init() {
    const params = new URLSearchParams(location.search);
    const orderId = params.get("order") || params.get("id");
    const content = document.getElementById("receiptContent");

    if (!orderId) {
      content.innerHTML = '<div class="empty-state">Link de comprovante inválido.</div>';
      return;
    }

    try {
      const receipt = await window.DB.getReceipt(orderId);
      if (!receipt) {
        content.innerHTML =
          '<div class="empty-state">Este comprovante não foi encontrado. Ele pode ter expirado (comprovantes ficam disponíveis por 30 dias após o pagamento).</div>';
        return;
      }

      const paidDate = new Date(receipt.paidAt);
      const itemsHtml = (receipt.items || [])
        .map(
          (it) => `
        <div class="item-row">
          <span><span class="qty">${it.quantity}x</span>${it.name}</span>
          <span>${money(it.price * it.quantity)}</span>
        </div>`
        )
        .join("");

      content.innerHTML = `
        <div class="receipt-card">
          <span class="status-pill">Pagamento confirmado</span>
          <div class="label">Restaurante</div>
          <div class="restaurant-name">${receipt.restaurantName}</div>
          <div class="paid-date">Pago em ${paidDate.toLocaleDateString("pt-BR")} às ${paidDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>

          ${itemsHtml}

          <div class="totals-row">
            <span>Subtotal</span>
            <span>${money(receipt.foodSubtotal)}</span>
          </div>
          <div class="totals-row">
            <span>Taxa de entrega</span>
            <span>${money(receipt.deliveryFee)}</span>
          </div>
          <div class="totals-row total">
            <span>Total</span>
            <span>${money(receipt.total)}</span>
          </div>

          ${receipt.paymentMethod ? `<div class="meta-line">Forma de pagamento: ${paymentMethodLabel[receipt.paymentMethod] || receipt.paymentMethod}</div>` : ""}
          ${receipt.address ? `<div class="meta-line">Endereço de entrega: ${receipt.address}</div>` : ""}
        </div>
        <div class="expiry-note">Este comprovante fica disponível por 30 dias a partir do pagamento.</div>
      `;
    } catch (err) {
      content.innerHTML = '<div class="empty-state">Não foi possível carregar o comprovante: ' + ((err && err.message) || err) + "</div>";
    }
  })();
})();
