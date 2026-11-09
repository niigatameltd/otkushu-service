"use strict";

// Состояние страницы.
// Процент скидки здесь не задаём: получаем его с сервера.
const cartState = {
  settings: null,
  coupons: null,
  menu: null,
  loading: true,
  submitting: false,
  loggedIn: null, // null пока проверяем авторизацию
  organizations: null,
};

const cartElements = {
  items: document.getElementById("cart-container"),
  clearButton: document.getElementById("clear-cart-btn"),
  couponSection: document.getElementById("coupon-section"),
  couponCheckbox: document.getElementById("use-coupon"),
  couponPercent: document.getElementById("coupon-percent"),
  couponAvailable: document.getElementById("available-coupons-text"),
  couponMessage: document.getElementById("coupon-message"),
  subtotal: document.getElementById("cart-subtotal"),
  discountRow: document.getElementById("discount-row"),
  discountTitle: document.getElementById("discount-title"),
  discountAmount: document.getElementById("discount-amount"),
  total: document.getElementById("cart-total"),
  checkoutButton: document.getElementById("checkout-btn"),
  checkoutMessage: document.getElementById("checkout-message"),
  deliveryFee: document.getElementById("cart-delivery-fee"),
  deliveryComment: document.getElementById("delivery-comment"),
  deliveryCommentCounter: document.getElementById("delivery-comment-counter"),
  guestPanel: document.getElementById("guest-panel"),
  guestName: document.getElementById("guest-name"),
  guestPhone: document.getElementById("guest-phone"),
  guestEmail: document.getElementById("guest-email"),
  guestOrganization: document.getElementById("guest-organization"),
};

// Красивое форматирование рублей.
function formatMoney(valueInKopecks) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
  }).format(valueInKopecks / 100);
}

// Преобразование суммы в копейки для расчётов.
function toKopecks(value) {
  return Math.round(Number(value) * 100);
}

// Читаем корзину в формате, который использует main.js:
// [{ id, name, price, quantity }]
function readCart() {
  try {
    const data = JSON.parse(localStorage.getItem("cart") || "[]");

    if (!Array.isArray(data)) return [];

    return data
      .map((item) => ({
        id: Number(item.id),
        name: String(item.name ?? ""),
        price: Number(item.price),
        quantity: Number(item.quantity),
      }))
      .filter(
        (item) =>
          Number.isSafeInteger(item.id) &&
          item.id > 0 &&
          Number.isSafeInteger(item.quantity) &&
          item.quantity > 0,
      );
  } catch (error) {
    console.error("Ошибка чтения корзины:", error);
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem("cart", JSON.stringify(cart));

  if (typeof checkCart === "function") {
    checkCart();
  }

  renderCart();
}

// Получаем актуальные настройки сервера.
async function loadCartSettings() {
  const response = await fetch("/api/settings", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Не удалось получить настройки сайта");
  }

  const settings = await response.json();

  const percent = Number(settings.COUPON_DISCOUNT_PERCENT);

  const deliveryFee = Number(settings.DELIVERY_SERVICE_FEE);

  if (
    settings.DELIVERY_SERVICE_FEE == null ||
    !Number.isFinite(deliveryFee) ||
    deliveryFee < 0 ||
    !Number.isInteger(deliveryFee * 100)
  ) {
    throw new Error("Некорректная стоимость доставки");
  }

  if (
    settings.COUPON_DISCOUNT_PERCENT == null ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  ) {
    throw new Error("Сервер вернул некорректный процент скидки");
  }

  cartState.settings = {
    ...settings,
    COUPON_DISCOUNT_PERCENT: percent,
    DELIVERY_SERVICE_FEE: deliveryFee,
  };
}

// Получаем настоящие цены и остатки блюд из БД.
async function loadActualMenu() {
  const response = await fetch("/api/menu", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Не удалось загрузить меню");
  }

  const dishes = await response.json();

  if (!Array.isArray(dishes)) {
    throw new Error("Неверный формат меню");
  }

  cartState.menu = new Map();

  for (const dish of dishes) {
    const id = Number(dish.id);
    const price = Number(dish.price);
    const stock = Number(dish.quantity);

    if (
      Number.isSafeInteger(id) &&
      Number.isFinite(price) &&
      price >= 0 &&
      Number.isSafeInteger(stock) &&
      stock >= 0
    ) {
      cartState.menu.set(id, {
        id,
        name: String(dish.name ?? ""),
        price,
        quantity: stock,
      });
    }
  }
}

// Отдельно определяем режим покупки. Отсутствие сети не считаем «гостем».
async function loadAuthState() {
  const response = await fetch("/api/auth/me", {
    credentials: "same-origin", cache: "no-store",
  });
  if (!response.ok) throw new Error("Не удалось проверить авторизацию");
  const data = await response.json();
  if (typeof data.loggedIn !== "boolean") {
    throw new Error("Неверный ответ сервера авторизации");
  }
  cartState.loggedIn = data.loggedIn;
}

async function loadOrganizations() {
  const response = await fetch("/api/organizations", { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось получить организации");
  const organizations = await response.json();
  if (!Array.isArray(organizations)) {
    throw new Error("Неверный список организаций");
  }
  cartState.organizations = organizations;
  const select = cartElements.guestOrganization;
  select.replaceChildren(new Option("Выберите организацию", ""));
  organizations.forEach((org) => {
    if (Number.isSafeInteger(Number(org.id)) && Number(org.id) > 0) {
      select.append(new Option(String(org.name), String(org.id)));
    }
  });
}

// Получаем купоны с учётом неоплаченных заказов.
async function loadAvailableCoupons() {
  cartState.coupons = null;
  const response = await fetch("/api/coupons/availability", {
    credentials: "same-origin",
    cache: "no-store",
  });

  // Неавторизованный пользователь не имеет купонов
  // в рамках текущего сеанса.
  if (response.status === 401 || response.status === 403) {
    cartState.coupons = null;
    return;
  }

  if (!response.ok) {
    throw new Error("Не удалось проверить купоны");
  }

  const coupons = await response.json();

  const total = Number(coupons.total);
  const reserved = Number(coupons.reserved);
  const available = Number(coupons.available);

  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(reserved) ||
    !Number.isSafeInteger(available) ||
    total < 0 ||
    reserved < 0 ||
    available < 0 ||
    reserved > total ||
    available !== total - reserved
  ) {
    throw new Error("Некорректные данные о купонах");
  }

  cartState.coupons = {
    total,
    reserved,
    available,
  };
}

// Берём цену не из localStorage, а из актуального меню.
function calculateCart() {
  const cart = readCart();

  let subtotal = 0;
  let hasStockProblem = false;

  for (const item of cart) {
    const dish = cartState.menu?.get(item.id);

    if (!dish || item.quantity > dish.quantity) {
      hasStockProblem = true;
    }

    if (dish) {
      subtotal += toKopecks(dish.price) * item.quantity;
    }
  }

  const percent = cartState.settings?.COUPON_DISCOUNT_PERCENT;

  const couponAvailable = (cartState.coupons?.available ?? 0) > 0;

  const useCoupon =
    cartState.loggedIn === true &&
    cartElements.couponCheckbox.checked &&
    couponAvailable &&
    typeof percent === "number";

  const discount = useCoupon ? Math.round((subtotal * percent) / 100) : 0;
  const deliveryFee = toKopecks(cartState.settings?.DELIVERY_SERVICE_FEE ?? 0);

  return {
    subtotal,
    discount,
    deliveryFee,
    total: subtotal - discount + deliveryFee,
    useCoupon,
    percent,
    hasStockProblem,
  };
}

// Вспомогательная функция создания DOM-элемента.
function makeElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (text !== undefined) {
    element.textContent = String(text);
  }

  return element;
}

// Отображение купонов.
function renderCoupons(cartHasItems) {
  const coupons = cartState.coupons;
  const settings = cartState.settings;

  const section = cartElements.couponSection;
  const checkbox = cartElements.couponCheckbox;

  if (!cartHasItems || !settings || cartState.loggedIn !== true) {
    section.hidden = true;
    checkbox.checked = false;
    checkbox.disabled = true;
    return;
  }

  section.hidden = false;

  const percent = settings.COUPON_DISCOUNT_PERCENT;

  cartElements.couponPercent.textContent = `${percent}%`;

  if (!coupons) {
    checkbox.checked = false;
    checkbox.disabled = true;

    cartElements.couponAvailable.textContent = "0";

    cartElements.couponMessage.textContent =
      "Купоны недоступны или не удалось проверить их количество. " +
      "Можно оформить заказ без купона.";

    return;
  }

  const available = coupons.available;
  const reserved = coupons.reserved;

  cartElements.couponAvailable.textContent = String(available);

  const couponCanBeUsed = available > 0 && percent < 100;

  checkbox.disabled = !couponCanBeUsed || cartState.submitting;

  // Сбрасываем выбор только если купон действительно недоступен.
  // Во время отправки заказа выбранное значение сохраняем.
  if (!couponCanBeUsed) {
    checkbox.checked = false;
  }

  if (available === 0 && reserved > 0) {
    cartElements.couponMessage.textContent =
      `Все ваши купоны (${reserved} шт.) ` +
      "зарезервированы в неоплаченных заказах.";
  } else if (available > 0 && reserved > 0) {
    cartElements.couponMessage.textContent =
      `Доступно: ${available}. ` + `В резерве: ${reserved}.`;
  } else if (available > 0) {
    cartElements.couponMessage.textContent =
      `У вас ${available} купон(ов), ` + "которые можно использовать.";
  } else {
    cartElements.couponMessage.textContent =
      "У вас пока нет доступных купонов.";
  }

  if (percent >= 100) {
    cartElements.couponMessage.textContent =
      "Скидка 100% не поддерживается для онлайн-оплаты. " +
      "Обратитесь к администрации сервиса.";
  }
}

// Создаём одну строку товара.
function renderCartItem(item, index) {
  const dish = cartState.menu?.get(item.id);

  const row = makeElement("div", "cart-item");

  const info = makeElement("div", "cart-item-info");

  const name = makeElement(
    "div",
    "cart-item-name",
    dish?.name || item.name || "Блюдо",
  );

  const price = makeElement(
    "div",
    "cart-item-price",
    dish ? `${formatMoney(toKopecks(dish.price))} за шт.` : "Цена уточняется",
  );

  info.append(name, price);

  if (cartState.menu && !dish) {
    info.append(
      makeElement(
        "div",
        "cart-item-warning",
        "Блюдо больше не доступно в меню. Удалите его.",
      ),
    );
  } else if (dish && item.quantity > dish.quantity) {
    info.append(
      makeElement(
        "div",
        "cart-item-warning",
        `Недостаточно в наличии. Доступно: ${dish.quantity} шт.`,
      ),
    );
  }

  const counter = makeElement("div", "cart-counter");

  const minus = makeElement("button", "", "−");
  minus.type = "button";
  minus.dataset.action = "minus";
  minus.dataset.index = String(index);
  minus.disabled = cartState.submitting;

  const count = makeElement("span", "", item.quantity);

  const plus = makeElement("button", "", "+");
  plus.type = "button";
  plus.dataset.action = "plus";
  plus.dataset.index = String(index);
  plus.disabled =
    cartState.submitting || (dish ? item.quantity >= dish.quantity : true);

  counter.append(minus, count, plus);

  const right = makeElement("div", "cart-item-right");

  const itemTotal = makeElement(
    "div",
    "cart-item-total",
    dish ? formatMoney(toKopecks(dish.price) * item.quantity) : "—",
  );

  const remove = makeElement("button", "cart-remove", "Удалить");

  remove.type = "button";
  remove.dataset.action = "remove";
  remove.dataset.index = String(index);
  remove.disabled = cartState.submitting;

  right.append(itemTotal, remove);

  row.append(info, counter, right);

  return row;
}

// Основная перерисовка корзины.
function renderCart() {
  const cart = readCart();
  const hasItems = cart.length > 0;

  cartElements.items.replaceChildren();

  if (!hasItems) {
    cartElements.items.append(
      makeElement("p", "cart-message", "Ваша корзина пока пуста."),
    );
  } else {
    cart.forEach((item, index) => {
      cartElements.items.append(renderCartItem(item, index));
    });
  }

  cartElements.clearButton.hidden = !hasItems || cartState.submitting;

  renderCoupons(hasItems);
  cartElements.guestPanel.hidden = cartState.loggedIn !== false;

  const summary = calculateCart();

  const canShowPrices = cartState.menu !== null;

  cartElements.subtotal.textContent = canShowPrices
    ? formatMoney(summary.subtotal)
    : "—";

  cartElements.deliveryFee.textContent =
    canShowPrices && cartState.settings
      ? formatMoney(summary.deliveryFee)
      : "—";

  cartElements.discountRow.hidden = !summary.useCoupon;

  cartElements.discountTitle.textContent = `Скидка по купону (${summary.percent ?? "—"}%)`;

  cartElements.discountAmount.textContent = `−${formatMoney(summary.discount)}`;

  cartElements.total.textContent = canShowPrices
    ? formatMoney(summary.total)
    : "—";

  const canCheckout =
    hasItems &&
    !cartState.loading &&
    !cartState.submitting &&
    cartState.loggedIn !== null &&
    (cartState.loggedIn === true || cartState.organizations !== null) &&
    cartState.settings !== null &&
    cartState.menu !== null &&
    !summary.hasStockProblem &&
    summary.total > 0;

  cartElements.checkoutButton.disabled = !canCheckout;

  cartElements.checkoutButton.textContent = cartState.submitting
    ? "Создаём платёж..."
    : cartState.loading
      ? "Загрузка данных..."
      : "Перейти к оплате";

  if (cartState.loading) {
    cartElements.checkoutMessage.textContent =
      "Проверяем цены, настройки и доступность оформления.";
  } else if (cartState.loggedIn === null) {
    cartElements.checkoutMessage.textContent =
      "Не удалось проверить вход в систему. Обновите страницу.";
  } else if (cartState.loggedIn === false && !cartState.organizations) {
    cartElements.checkoutMessage.textContent =
      "Не удалось загрузить организации. Обновите страницу.";
  } else if (!cartState.settings || !cartState.menu) {
    cartElements.checkoutMessage.textContent =
      "Не удалось получить цены или настройки. " + "Обновите страницу.";
  } else if (summary.hasStockProblem) {
    cartElements.checkoutMessage.textContent =
      "Проверьте наличие блюд и их количество.";
  } else if (!hasItems) {
    cartElements.checkoutMessage.textContent = "Добавьте блюда из меню.";
  } else {
    cartElements.checkoutMessage.textContent =
      "Итог предварительный. Сервер проверит " +
      "цены, остатки и купоны при создании заказа.";
  }
}

// Изменяем количество или удаляем блюдо.
function changeCartItem(index, action) {
  if (cartState.submitting) return;

  const cart = readCart();
  const item = cart[index];

  if (!item) return;

  if (action === "remove") {
    cart.splice(index, 1);
  } else if (action === "minus") {
    if (item.quantity <= 1) {
      cart.splice(index, 1);
    } else {
      item.quantity -= 1;
    }
  } else if (action === "plus") {
    const dish = cartState.menu?.get(item.id);

    if (!dish) return;

    if (item.quantity >= dish.quantity) {
      alert("Больше этого количества сейчас нет в наличии.");
      return;
    }

    item.quantity += 1;
  }

  saveCart(cart);
}

// Оформление и переход на ЮKassa.
async function checkout() {
  if (cartState.submitting) return;

  if (!cartState.settings || !cartState.menu) {
    alert("Не удалось получить настройки или меню.");
    return;
  }

  const cart = readCart();

  if (cart.length === 0) {
    alert("Корзина пуста.");
    return;
  }

  const wantedCoupon = cartState.loggedIn === true &&
    cartElements.couponCheckbox.checked;

  // Подтверждаем данные гостя ДО запроса, который резервирует блюда.
  if (cartState.loggedIn === false) {
    const name = cartElements.guestName.value.trim();
    const phone = cartElements.guestPhone.value.trim();
    const orgId = Number(cartElements.guestOrganization.value);
    const email = cartElements.guestEmail.value.trim();
    if (name.length < 2 || name.length > 100 ||
        !/^\+?[\d()\s-]{10,25}$/.test(phone) ||
        !Number.isSafeInteger(orgId) || orgId <= 0 ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      alert("Укажи имя, телефон, организацию и корректный email (если заполнен).");
      return;
    }
  }

  const previousTotal = calculateCart().total;

  const checkoutAsRegistered = cartState.loggedIn === true;
  cartState.submitting = true;
  renderCart();

  try {
    // Перед оплатой ещё раз проверяем актуальные данные.
    await Promise.all([
      loadCartSettings(),
      loadActualMenu(),
      loadAvailableCoupons(),
      loadAuthState(),
    ]);
    // Если пользователь вошёл/вышел в другой вкладке — сначала покажем
    // актуальный режим корзины, не отправляя заказ ошибочным маршрутом.
    if (cartState.loggedIn !== checkoutAsRegistered) {
      alert("Авторизация изменилась. Проверьте форму и повторите оформление.");
      return;
    }

    // Не отправляем заказ с купоном,
    // если его успели зарезервировать в другом заказе.
    if (wantedCoupon && !(cartState.coupons?.available > 0)) {
      cartElements.couponCheckbox.checked = false;

      alert(
        "Купон больше недоступен. " +
          "Возможно, он зарезервирован в другом заказе.",
      );

      return;
    }

    const summary = calculateCart();

    if (summary.hasStockProblem) {
      alert("Изменились остатки блюд. " + "Проверьте количество в корзине.");

      return;
    }

    if (summary.total <= 0) {
      alert("Некорректная сумма заказа.");
      return;
    }

    // Если изменилась сумма, спрашиваем согласие.
    if (summary.total !== previousTotal) {
      const accepted = confirm(
        "Сумма заказа изменилась.\n" +
          `Новая сумма: ${formatMoney(summary.total)}.\n\n` +
          "Продолжить оформление?",
      );

      if (!accepted) return;
    }

    const authResponse = await fetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!authResponse.ok) {
      throw new Error("Не удалось проверить авторизацию");
    }

    const authData = await authResponse.json();

    if (authData.loggedIn !== checkoutAsRegistered) {
      alert("Авторизация изменилась. Проверьте форму и повторите оформление.");
      cartState.loggedIn = authData.loggedIn;
      return;
    }

    // Отправляем только ID, количество и флаг купона.
    // Цена рассчитывается сервером самостоятельно.
    const deliveryComment = cartElements.deliveryComment.value.trim();

    const orderData = {
      items: cart.map((item) => ({
        id: item.id,
        quantity: item.quantity,
      })),

      use_coupon: wantedCoupon,

      // Комментарий к доставке
      delivery_comment: deliveryComment || null,
      ...(checkoutAsRegistered ? {} : {
        organization_id: Number(cartElements.guestOrganization.value),
        guest_name: cartElements.guestName.value.trim(),
        guest_phone: cartElements.guestPhone.value.trim(),
        guest_email: cartElements.guestEmail.value.trim() || null,
      }),
    };

    const response = await fetch(
      checkoutAsRegistered ? "/api/orders" : "/api/orders/guest", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderData),
    });

    const result = await response.json();

    if (!response.ok) {
      if (result.order_id && checkoutAsRegistered) {
        alert(
          (result.error || "Возникла ошибка оплаты.") +
            "\n\nЗаказ мог быть создан. " +
            "Проверьте раздел «Мои заказы».",
        );

        window.location.href = "/orders.html";
        return;
      }

      alert(result.error || "Не удалось оформить заказ.");

      return;
    }

    const paymentUrl = result.confirmation_url || result.payment_url;

    if (!checkoutAsRegistered) {
      const guestOrderUrl = result.guest_order_url;
      if (typeof guestOrderUrl !== "string" ||
          !/^\/guest-order\.html#token=[A-Za-z0-9_-]{43}$/.test(guestOrderUrl)) {
        alert("Заказ мог быть создан, но ссылка на него не получена. " +
          "Не создавайте повторный заказ — обратитесь в поддержку.");
        return;
      }
      sessionStorage.setItem("otkushu_last_guest_order", guestOrderUrl);
      // Резерв для возврата ЮKassa в другой вкладке того же браузера.
      localStorage.setItem("otkushu_guest_return_v1", JSON.stringify({
        url: guestOrderUrl,
        savedAt: Date.now(),
      }));
      localStorage.removeItem("cart");
      window.location.assign(guestOrderUrl);
      return;
    }

    if (
      !paymentUrl ||
      typeof paymentUrl !== "string" ||
      !paymentUrl.startsWith("https://")
    ) {
      alert(
        "Заказ создан, но ссылка на оплату недоступна. " +
          "Откройте «Мои заказы» и не создавайте дубль.",
      );
      return;
    }

    if (result.order_id) {
      sessionStorage.setItem("last_order_id", String(result.order_id));
    }

    // Заказ уже создан в базе.
    // Очищаем локальную корзину перед переходом к оплате.
    localStorage.removeItem("cart");

    window.location.assign(paymentUrl);
  } catch (error) {
    console.error("Ошибка оформления заказа:", error);

    alert(checkoutAsRegistered
      ? "Не удалось завершить оформление. Если заказ мог быть создан, " +
        "проверьте «Мои заказы», чтобы не оформить заказ дважды."
      : "Не удалось завершить оформление. Если запрос был отправлен, " +
        "не нажимайте повторно: сначала проверьте страницу гостевого заказа " +
        "или обратитесь в поддержку, чтобы избежать дубля.");
  } finally {
    cartState.submitting = false;
    renderCart();
  }
}

// Слушатели событий.
cartElements.items.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");

  if (!button) return;

  const index = Number(button.dataset.index);
  const action = button.dataset.action;

  if (!Number.isSafeInteger(index) || index < 0) return;

  changeCartItem(index, action);
});

cartElements.clearButton.addEventListener("click", () => {
  if (cartState.submitting) return;

  if (confirm("Очистить всю корзину?")) {
    localStorage.removeItem("cart");
    renderCart();
  }
});
cartElements.deliveryComment.addEventListener("input", () => {
  const length = cartElements.deliveryComment.value.length;

  cartElements.deliveryCommentCounter.textContent = `${length} / 500`;
});
cartElements.couponCheckbox.addEventListener("change", renderCart);

cartElements.checkoutButton.addEventListener("click", checkout);

// Инициализация.
async function initCartPage() {
  cartState.loading = true;
  renderCart();

  const results = await Promise.allSettled([
    loadCartSettings(),
    loadActualMenu(),
    loadAvailableCoupons(),
    loadAuthState(),
    loadOrganizations(),
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Не удалось загрузить данные корзины:", result.reason);
    }
  }

  cartState.loading = false;
  renderCart();
}

initCartPage();
