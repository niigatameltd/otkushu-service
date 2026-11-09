"use strict";

const guestElements = {
  loading: document.getElementById("guest-order-loading"),
  details: document.getElementById("guest-order-details"),
  linkPanel: document.getElementById("guest-order-link-panel"),
  errorPanel: document.getElementById("guest-order-error-panel"),
  error: document.getElementById("guest-error"),
  message: document.getElementById("guest-message"),
  pay: document.getElementById("guest-pay-button"),
  refresh: document.getElementById("guest-refresh-button"),
  copy: document.getElementById("guest-copy-button"),
};
let guestToken = null;
let guestBusy = false;
let guestPolls = 0;

const GUEST_RETURN_KEY = "otkushu_guest_return_v1";
const GUEST_RETURN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function rememberGuestLink(token) {
  const url = `/guest-order.html#token=${token}`;
  sessionStorage.setItem("otkushu_last_guest_order", url);
  // В отличие от sessionStorage, localStorage доступен другим вкладкам
  // того же браузера и того же origin.
  localStorage.setItem(GUEST_RETURN_KEY, JSON.stringify({
    url,
    savedAt: Date.now(),
  }));
  return url;
}

function parseGuestToken() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const token = new URLSearchParams(hash).get("token");
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    rememberGuestLink(token);
    return token;
  }

  // Вернулись из ЮKassa без токена: сначала ищем его в этой вкладке.
  const saved = sessionStorage.getItem("otkushu_last_guest_order") || "";
  const match = /^\/guest-order\.html#token=([A-Za-z0-9_-]{43})$/.exec(saved);
  if (match) {
    history.replaceState(null, "", rememberGuestLink(match[1]));
    return match[1];
  }

  // На мобильном ЮKassa может вернуть человека в новую вкладку.
  // Используем временную резервную ссылку, если она не старше суток.
  try {
    const savedReturn = JSON.parse(localStorage.getItem(GUEST_RETURN_KEY) || "null");
    if (savedReturn &&
        Number.isFinite(savedReturn.savedAt) &&
        Date.now() >= savedReturn.savedAt &&
        Date.now() - savedReturn.savedAt <= GUEST_RETURN_MAX_AGE_MS) {
      const fallback = /^\/guest-order\.html#token=([A-Za-z0-9_-]{43})$/.exec(savedReturn.url || "");
      if (fallback) {
        history.replaceState(null, "", rememberGuestLink(fallback[1]));
        return fallback[1];
      }
    }
    localStorage.removeItem(GUEST_RETURN_KEY);
  } catch {
    localStorage.removeItem(GUEST_RETURN_KEY);
  }
  return null;
}

function money(value) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency", currency: "RUB",
  }).format(Number(value));
}

function showGuestError(message) {
  guestElements.loading.hidden = true;
  guestElements.errorPanel.hidden = false;
  guestElements.error.textContent = String(message);
}

async function guestApi(url, method = "GET") {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    credentials: "omit",
    headers: { Authorization: `Bearer ${guestToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function renderGuestOrder(order) {
  guestElements.loading.hidden = true;
  guestElements.errorPanel.hidden = true;
  guestElements.details.hidden = false;
  guestElements.linkPanel.hidden = false;

  document.getElementById("guest-order-title").textContent = `Заказ №${order.id}`;
  document.getElementById("guest-order-name").textContent = order.guest_name || "—";
  document.getElementById("guest-order-organization").textContent = order.organization_name || "—";
  const [y,m,d] = (order.delivery_date || "").split("-");
  document.getElementById("guest-order-date").textContent = y && m && d ? `${d}.${m}.${y}` : "—";
  document.getElementById("guest-order-fee").textContent = money(order.delivery_fee);
  document.getElementById("guest-order-total").textContent = money(order.total_price);
  const comment = document.getElementById("guest-order-comment");
  comment.hidden = !order.delivery_comment;
  comment.textContent = order.delivery_comment ? `Комментарий: ${order.delivery_comment}` : "";

  const list = document.getElementById("guest-order-items");
  list.replaceChildren();
  (Array.isArray(order.items) ? order.items : []).forEach((item) => {
    const row = document.createElement("div");
    row.className = "guest-order-item";
    const name = document.createElement("span");
    name.textContent = `${item.name} × ${item.quantity}`;
    const amount = document.createElement("strong");
    amount.textContent = money(Number(item.price) * Number(item.quantity));
    row.append(name, amount);
    list.append(row);
  });

  const statuses = {
    pending_payment: "Ожидает оплаты",
    active: "Оплачен",
    cancelled: "Отменён",
  };
  document.getElementById("guest-order-status").textContent =
    statuses[order.status] || "Уточняется";
  guestElements.pay.hidden = order.status !== "pending_payment";
  guestElements.message.textContent = order.status === "active"
    ? "Оплата подтверждена сервером. Заказ принят. Спасибо!"
    : order.status === "cancelled"
      ? "Этот заказ отменён. Не пытайтесь оплачивать его старой ссылкой."
      : "Заказ создан, но ещё не оплачен. Сохрани ссылку и нажми «Перейти к оплате». После оплаты статус обновится по уведомлению ЮKassa.";
}

async function loadGuestOrder() {
  if (guestBusy) return;
  guestBusy = true;
  guestElements.refresh.disabled = true;
  try {
    const order = await guestApi("/api/guest-orders/status");
    renderGuestOrder(order);
  } catch (error) {
    if (guestElements.details.hidden) showGuestError(error.message);
    else guestElements.message.textContent = `Не удалось обновить статус: ${error.message}`;
  } finally {
    guestBusy = false;
    guestElements.refresh.disabled = false;
  }
}

async function resumeGuestPayment() {
  if (guestBusy) return;
  guestBusy = true;
  guestElements.pay.disabled = true;
  guestElements.pay.textContent = "Проверяем платёж...";
  try {
    const result = await guestApi("/api/guest-orders/resume-payment", "POST");
    const url = new URL(result.confirmation_url);
    if (url.protocol !== "https:") throw new Error("Некорректная ссылка оплаты");
    // Источник возврата — эта же вкладка; sessionStorage сохранит секрет.
    window.location.assign(url.href);
  } catch (error) {
    await loadGuestOrderAfterResumeError();
    guestElements.message.textContent = error.message;
  } finally {
    guestBusy = false;
    guestElements.pay.disabled = false;
    guestElements.pay.textContent = "Перейти к оплате";
  }
}

async function loadGuestOrderAfterResumeError() {
  // Не запускаем loadGuestOrder() в состоянии guestBusy: получаем статус прямо.
  try { renderGuestOrder(await guestApi("/api/guest-orders/status")); }
  catch { /* Сообщение об ошибке оплаты уже показано. */ }
}

guestElements.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.origin + `/guest-order.html#token=${guestToken}`);
    document.getElementById("guest-copy-message").textContent = "Ссылка скопирована.";
  } catch {
    document.getElementById("guest-copy-message").textContent =
      "Не удалось скопировать автоматически — скопируй адрес из строки браузера.";
  }
});
guestElements.refresh.addEventListener("click", loadGuestOrder);
guestElements.pay.addEventListener("click", resumeGuestPayment);

guestToken = parseGuestToken();
if (!guestToken) {
  showGuestError("Секретная ссылка не найдена. Открой сохранённую ссылку на заказ или обратись в поддержку.");
} else {
  loadGuestOrder();
  // Платёж может подтвердиться чуть позже возвращения с ЮKassa.
  // Первую минуту периодически обновляем статус, потом оставляем кнопку.
  const poll = setInterval(async () => {
    if (++guestPolls >= 6) { clearInterval(poll); return; }
    if (!guestElements.details.hidden && guestElements.pay.hidden) {
      clearInterval(poll); return;
    }
    await loadGuestOrder();
  }, 10000);
}
