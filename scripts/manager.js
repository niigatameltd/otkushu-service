"use strict";

const managerState = {
  page: 1,
  totalPages: 1,
};

const $ = (id) => document.getElementById(id);

function createElement(tag, className = "", text = null) {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (text !== null) {
    element.textContent = String(text);
  }

  return element;
}

function money(value) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
  }).format(Number(value));
}

function formatCreatedAt(value) {
  if (!value) return "—";

  return new Date(value).toLocaleString("ru-RU", {
    timeZone: "Asia/Yakutsk",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDeliveryDate(value) {
  if (!value) return "—";

  const [year, month, day] = String(value).slice(0, 10).split("-");

  return `${day}.${month}.${year}`;
}

// Общая функция для запросов к API.
// Ошибки HTTP не игнорируем.
async function managerApi(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || `Ошибка HTTP ${response.status}`);

    error.status = response.status;
    throw error;
  }

  return data;
}

// --------------------------------------
// СБРОС PIN ПОКУПАТЕЛЯ
// --------------------------------------
let pinResetTarget = null;

async function lookupCustomerForPin(event) {
  event.preventDefault();
  const button = $("pin-lookup-btn");
  const message = $("pin-lookup-message");
  const resetMessage = $("pin-reset-message");
  const resetForm = $("pin-reset-form");
  const phone = $("pin-lookup-phone").value.trim();

  pinResetTarget = null;
  resetForm.hidden = true;
  resetForm.reset();
  resetMessage.textContent = "";
  message.textContent = "Ищем пользователя...";
  button.disabled = true;
  try {
    const data = await managerApi(
      `/api/manager/customers/lookup?phone=${encodeURIComponent(phone)}`,
    );
    const customer = data.customer;
    message.textContent = "Пользователь найден.";

    if (customer.is_manager) {
      message.textContent = "Это аккаунт менеджера. Сброс через эту форму запрещён.";
      return;
    }
    pinResetTarget = customer;
    $("pin-target-info").textContent =
      `Пользователь: ${customer.name} · Телефон: ${customer.phone_number} · ` +
      `Организация: ${customer.organization_name || "не указана"} · ID: ${customer.id}`;
    resetForm.hidden = false;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function submitCustomerPinReset(event) {
  event.preventDefault();
  if (!pinResetTarget) return;
  const message = $("pin-reset-message");
  const button = $("pin-reset-btn");
  const newPin = $("pin-new-code").value;
  const managerPin = $("pin-manager-code").value;
  const customer = pinResetTarget;

  if (!/^\d{6}$/.test(newPin) || !/^\d{4,6}$/.test(managerPin)) {
    message.textContent = "Новый PIN должен содержать 6 цифр. Проверьте также свой PIN.";
    return;
  }
  if (!confirm(`Сбросить PIN пользователю ${customer.name} (${customer.phone_number})?`)) {
    return;
  }

  button.disabled = true;
  message.textContent = "Сохраняем новый PIN...";
  try {
    await managerApi("/api/manager/customers/reset-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: customer.id,
        phone_number: customer.phone_number,
        new_pin: newPin,
        manager_pin: managerPin,
      }),
    });
    message.textContent = "PIN изменён. Передайте новый PIN лично владельцу аккаунта.";
    $("pin-reset-form").reset();
    $("pin-reset-form").hidden = true;
    $("pin-lookup-phone").value = "";
    $("pin-lookup-message").textContent = "";
    pinResetTarget = null;
  } catch (error) {
    message.textContent = `Не удалось изменить PIN: ${error.message}`;
    // Не оставляем PIN менеджера в поле при ошибке.
    $("pin-manager-code").value = "";
  } finally {
    button.disabled = false;
  }
}

// --------------------------------------
// СИСТЕМНЫЕ НАСТРОЙКИ
// --------------------------------------

async function loadManagerSettings() {
  const settings = await managerApi("/api/manager/settings");

  $("setting-goal").value = settings.ORGANIZATION_GOAL_AMOUNT;

  $("setting-deadline").value = settings.ORDER_DEADLINE_HOUR;

  $("setting-discount").value = settings.COUPON_DISCOUNT_PERCENT;

  $("setting-fee").value = settings.DELIVERY_SERVICE_FEE;
}

async function saveManagerSettings(event) {
  event.preventDefault();

  const button = event.currentTarget.querySelector('button[type="submit"]');

  button.disabled = true;

  try {
    const body = {
      goal_amount: Number($("setting-goal").value),
      deadline_hour: Number($("setting-deadline").value),
      discount_percent: Number($("setting-discount").value),
      delivery_service_fee: Number($("setting-fee").value),
    };

    const result = await managerApi("/api/manager/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    alert(result.message || "Настройки сохранены");

    await loadManagerSettings();
  } catch (error) {
    console.error(error);
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}

// --------------------------------------
// ДОБАВЛЕНИЕ БЛЮДА
// --------------------------------------

async function addManagerDish(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');

  button.disabled = true;

  try {
    const formData = new FormData(form);

    const result = await managerApi("/api/manager/dishes", {
      method: "POST",
      body: formData,
    });

    alert(`Блюдо «${result.dish.name}» успешно добавлено`);

    form.reset();

    await loadManagerDishes();
  } catch (error) {
    console.error(error);
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}

// --------------------------------------
// СПИСОК БЛЮД
// --------------------------------------

async function loadManagerDishes() {
  const container = $("manager-dishes-container");

  container.textContent = "Загружаем блюда...";

  try {
    const dishes = await managerApi("/api/manager/dishes");

    container.replaceChildren();

    if (dishes.length === 0) {
      container.textContent = "Каталог пока пуст.";
      return;
    }

    const scroll = createElement("div", "manager-table-scroll");

    const table = createElement("table", "manager-table");

    const thead = document.createElement("thead");
    const headingRow = document.createElement("tr");

    const columns = [
      "Фото",
      "Название",
      "Цена",
      "Остаток",
      "Доступность",
      "Действия",
    ];

    for (const column of columns) {
      headingRow.append(createElement("th", "", column));
    }

    thead.append(headingRow);

    const tbody = document.createElement("tbody");

    for (const dish of dishes) {
      const tr = document.createElement("tr");

      // Фото
      const photoCell = document.createElement("td");
      const photo = document.createElement("img");

      const filename = String(dish.image_url || "default.jpg");

      photo.src = /^[a-zA-Z0-9_.-]+$/.test(filename)
        ? `/menu-images/${encodeURIComponent(filename)}`
        : "/menu-images/default.jpg";

      photo.alt = String(dish.name);

      photoCell.append(photo);

      // Название
      const nameCell = document.createElement("td");

      nameCell.append(
        createElement("strong", "", dish.name),
        createElement(
          "div",
          "manager-notice",
          `${dish.category || "—"} · ${dish.weight || "—"}`,
        ),
      );

      if (dish.description) {
        nameCell.append(
          createElement("div", "manager-notice", dish.description),
        );
      }

      // Цена
      const priceCell = createElement("td", "", money(dish.price));

      // Количество
      const quantityCell = document.createElement("td");

      const quantityInput = document.createElement("input");
      quantityInput.type = "number";
      quantityInput.min = "0";
      quantityInput.max = "1000000";
      quantityInput.step = "1";
      quantityInput.className = "manager-quantity";
      quantityInput.value = String(dish.quantity);
      quantityInput.setAttribute("aria-label", `Количество блюда ${dish.name}`);

      quantityCell.append(quantityInput);

      // Видимость
      const statusCell = createElement(
        "td",
        "",
        dish.is_available ? "В меню" : "Скрыто",
      );

      // Кнопки действий
      const actionsCell = document.createElement("td");
      const actions = createElement("div", "manager-table-actions");

      const saveButton = createElement(
        "button",
        "manager-button secondary",
        "Сохранить",
      );

      saveButton.type = "button";

      saveButton.addEventListener("click", async () => {
        const rawQuantity = quantityInput.value.trim();
        const quantity = Number(rawQuantity);

        if (
          rawQuantity === "" ||
          !Number.isSafeInteger(quantity) ||
          quantity < 0 ||
          quantity > 1000000
        ) {
          alert("Укажите целое количество от 0");
          return;
        }

        saveButton.disabled = true;

        try {
          await managerApi(`/api/manager/dishes/${dish.id}/quantity`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ quantity }),
          });

          await loadManagerDishes();
        } catch (error) {
          console.error(error);
          alert(error.message);
          saveButton.disabled = false;
        }
      });

      const visibilityButton = createElement(
        "button",
        dish.is_available ? "manager-button danger" : "manager-button",
        dish.is_available ? "Скрыть" : "Вернуть",
      );

      visibilityButton.type = "button";

      visibilityButton.addEventListener("click", async () => {
        const confirmation = dish.is_available
          ? `Скрыть «${dish.name}» из меню?`
          : `Вернуть «${dish.name}» в меню?`;

        if (!confirm(confirmation)) return;

        visibilityButton.disabled = true;

        try {
          if (dish.is_available) {
            await managerApi(`/api/manager/dishes/${dish.id}`, {
              method: "DELETE",
            });
          } else {
            await managerApi(`/api/manager/dishes/${dish.id}/visibility`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                is_available: true,
              }),
            });
          }

          await loadManagerDishes();
        } catch (error) {
          console.error(error);
          alert(error.message);
          visibilityButton.disabled = false;
        }
      });

      actions.append(saveButton, visibilityButton);
      actionsCell.append(actions);

      tr.append(
        photoCell,
        nameCell,
        priceCell,
        quantityCell,
        statusCell,
        actionsCell,
      );

      tbody.append(tr);
    }

    table.append(thead, tbody);
    scroll.append(table);
    container.append(scroll);
  } catch (error) {
    console.error(error);
    container.textContent = `Не удалось загрузить блюда: ${error.message}`;
  }
}

// --------------------------------------
// ВСЕ ЗАКАЗЫ
// --------------------------------------

const orderStatusNames = {
  pending_payment: "Ожидает оплаты",
  active: "Оплачен",
  cancelled: "Отменён",
};

function appendInfoField(parent, title, value) {
  const field = createElement("div", "manager-info-field");

  field.append(
    createElement("span", "", title),
    createElement("strong", "", value ?? "—"),
  );

  parent.append(field);
}

function renderManagerOrder(order) {
  const card = createElement("article", "manager-order");

  const header = createElement("div", "manager-order-header");

  const title = createElement("h3", "", `Заказ №${order.order_id}`);

  const knownStatus = Object.hasOwn(orderStatusNames, order.status);

  const badge = createElement(
    "span",
    `manager-status ${knownStatus ? order.status : ""}`,
    orderStatusNames[order.status] || "Статус неизвестен",
  );

  header.append(title, badge);

  const info = createElement("div", "manager-order-info");

  appendInfoField(
    info,
    "Тип покупателя",
    order.is_guest ? "Гость (без регистрации)" : "Зарегистрированный",
  );

  appendInfoField(info, "Покупатель", order.customer_name);

  appendInfoField(info, "Телефон", order.phone_number);

  appendInfoField(info, "Организация", order.organization_name);

  appendInfoField(info, "Создан", formatCreatedAt(order.created_at));

  appendInfoField(
    info,
    "Дата доставки",
    formatDeliveryDate(order.delivery_date),
  );

  const couponText = !order.used_coupon
    ? "Не использовался"
    : order.coupon_deducted
      ? "Использован и списан"
      : order.status === "pending_payment"
        ? "Зарезервирован"
        : "Не списан";

  appendInfoField(info, "Купон", couponText);

  appendInfoField(info, "ID платежа ЮKassa", order.yookassa_payment_id || "—");

  const itemsBlock = createElement("div", "manager-order-items");

  itemsBlock.append(createElement("h4", "", "Состав заказа"));

  const itemsList = document.createElement("ul");

  for (const item of order.items || []) {
    const total = Number(item.price) * Number(item.quantity);

    itemsList.append(
      createElement(
        "li",
        "",
        `${item.name} × ${item.quantity} — ${money(total)}`,
      ),
    );
  }

  if (!itemsList.children.length) {
    itemsList.append(createElement("li", "", "Нет позиций"));
  }

  itemsBlock.append(itemsList);

  const prices = createElement("div", "manager-order-info");

  const totalPrice = Number(order.total_price);
  const deliveryFee = Number(order.delivery_fee);

  appendInfoField(
    prices,
    "Блюда после скидки",
    money(totalPrice - deliveryFee),
  );

  appendInfoField(prices, "Доставка", money(deliveryFee));

  const total = createElement(
    "div",
    "manager-order-total",
    `Итого оплачено / к оплате: ${money(totalPrice)}`,
  );

  card.append(header, info, itemsBlock, prices, total);

  if (order.delivery_comment) {
    const comment = createElement("div", "manager-comment");

    comment.append(
      createElement("strong", "", "Комментарий покупателя:"),
      createElement("div", "", order.delivery_comment),
    );

    card.append(comment);
  }

  return card;
}

async function loadManagerOrders() {
  const container = $("manager-orders-container");

  container.textContent = "Загрузка заказов...";

  try {
    const params = new URLSearchParams({
      page: String(managerState.page),
      status: $("orders-status").value,
      q: $("orders-search").value.trim(),
    });

    const data = await managerApi(`/api/manager/orders?${params.toString()}`);

    $("stat-all").textContent = data.summary.all_orders;

    $("stat-paid").textContent = data.summary.paid_orders;

    $("stat-pending").textContent = data.summary.pending_orders;

    $("stat-cancelled").textContent = data.summary.cancelled_orders;

    container.replaceChildren();

    if (!data.orders.length) {
      container.append(
        createElement("p", "manager-notice", "Заказы не найдены."),
      );
    } else {
      for (const order of data.orders) {
        container.append(renderManagerOrder(order));
      }
    }

    managerState.totalPages = Math.max(
      1,
      Math.ceil(data.total / data.page_size),
    );

    $("orders-page-label").textContent =
      `Страница ${data.page} из ${managerState.totalPages}`;

    $("orders-prev").disabled = managerState.page <= 1;

    $("orders-next").disabled = managerState.page >= managerState.totalPages;
  } catch (error) {
    console.error(error);

    container.textContent = `Не удалось загрузить заказы: ${error.message}`;
  }
}

// --------------------------------------
// ИНИЦИАЛИЗАЦИЯ
// --------------------------------------

async function initManager() {
  try {
    // Проверяем права через защищённый API.
    await loadManagerSettings();

    $("manager-access-message").hidden = true;
    $("manager-app").hidden = false;

    await Promise.all([loadManagerDishes(), loadManagerOrders()]);
  } catch (error) {
    console.error("Ошибка входа в панель:", error);

    $("manager-access-message").textContent =
      error.status === 401
        ? "Для входа в панель необходимо авторизоваться."
        : error.status === 403
          ? "У вас нет прав менеджера."
          : `Не удалось открыть панель: ${error.message}`;
  }
}

$("pin-lookup-form").addEventListener("submit", lookupCustomerForPin);
$("pin-reset-form").addEventListener("submit", submitCustomerPinReset);

$("settings-form").addEventListener("submit", saveManagerSettings);

$("add-dish-form").addEventListener("submit", addManagerDish);

$("refresh-dishes").addEventListener("click", loadManagerDishes);

$("refresh-orders").addEventListener("click", loadManagerOrders);

$("orders-filter-form").addEventListener("submit", (event) => {
  event.preventDefault();
  managerState.page = 1;
  loadManagerOrders();
});

$("orders-prev").addEventListener("click", () => {
  if (managerState.page > 1) {
    managerState.page--;
    loadManagerOrders();
  }
});

$("orders-next").addEventListener("click", () => {
  if (managerState.page < managerState.totalPages) {
    managerState.page++;
    loadManagerOrders();
  }
});

initManager();
