let allDishes = []; // Храним загруженный список блюд для фильтрации
let currentCategory = "ALL"; // Текущая выбранная категория

// Функция изменения количества на карточке товара перед добавлением в корзину

// Изменение количества блюда на карточке
function changeCount(dishId, delta, maxStock) {
  const qtySpan = document.getElementById(`qty-${dishId}`);

  if (!qtySpan) return;

  let current = Number(qtySpan.textContent) + delta;

  if (current < 1) {
    current = 1;
  }

  if (current > maxStock) {
    showToast(`Максимально доступно: ${maxStock} шт.`, "warning");

    current = maxStock;
  }

  qtySpan.textContent = current;
}

// Функция добавления товара в корзину с учетом выбранного количества и лимитов

// Добавление блюда в корзину
function addDishToCart(dishId, name, price, maxStock) {
  const qtySpan = document.getElementById(`qty-${dishId}`);

  const selectedQty = qtySpan ? Number(qtySpan.textContent) : 1;

  const cart = JSON.parse(localStorage.getItem("cart") || "[]");

  const existingItem = cart.find((item) => Number(item.id) === Number(dishId));

  const currentInCart = existingItem ? Number(existingItem.quantity) : 0;

  // Проверяем остатки
  if (currentInCart + selectedQty > maxStock) {
    showToast(
      `Доступно ${maxStock} шт. Уже в корзине: ${currentInCart} шт.`,
      "warning",
      5000,
    );

    return;
  }

  // Добавляем блюдо
  if (existingItem) {
    existingItem.quantity += selectedQty;
  } else {
    cart.push({
      id: dishId,
      name,
      price,
      quantity: selectedQty,
    });
  }

  localStorage.setItem("cart", JSON.stringify(cart));

  // Обновляем счётчик корзины в навигации
  if (typeof checkCart === "function") {
    checkCart();
  }

  // Показываем уведомление
  showToast(
    `${name} — ${selectedQty} шт. добавлено в корзину`,
    "success",
    3000,
  );
}

// Рендеринг карточек меню (с учетом фильтрации по категориям)
function renderMenu() {
  const container = document.getElementById("menu-container");
  if (!container) return;
  container.innerHTML = "";

  // Фильтруем блюда по выбранной категории
  const filteredDishes =
    currentCategory === "ALL"
      ? allDishes
      : allDishes.filter((d) => d.category === currentCategory);

  if (filteredDishes.length === 0) {
    container.innerHTML =
      '<p style="text-align: center; color: var(--text-muted); grid-column: 1 / -1;">В этой категории пока нет позиций.</p>';
    return;
  }

  filteredDishes.forEach((dish) => {
    const card = document.createElement("div");
    card.className = "dish-card";
    const isOutOfStock = dish.quantity <= 0;

    card.innerHTML = `
      <div>
        <div class="dish-image-container">
          <img src="menu-images/${dish.image_url}" alt="${dish.name}" class="dish-image" />
          <div class="dish-quantity-badge">Доступно: ${dish.quantity}</div>
          <div class="dish-quantity-badge-bottom">Фактический внешний вид блюда может отличатся</div>
        </div>
        <div class="dish-info" id="order-info"> 
          <span class="category">${dish.category}</span>
          <h3>${dish.name}</h3>
          <p>${dish.description || "Без описания"}</p>
          <div class="dish-weight">${dish.weight || "стандарт"}</div>
        </div>
      </div>
      
      <div class="dish-footer">
        <div class="dish-price-row">
          <div class="dish-price">${dish.price} ₽</div>
          ${
            !isOutOfStock
              ? `
                <div class="dish-counter">
                  <button onclick="changeCount(${dish.id}, -1, ${dish.quantity})">-</button>
                  <span id="qty-${dish.id}">1</span>
                  <button onclick="changeCount(${dish.id}, 1, ${dish.quantity})">+</button>
                </div>
              `
              : ""
          }
        </div>

        ${
          !isOutOfStock
            ? `
<button
  type="button"
  class="dish-add-button"
  style="width: 100%; background: var(--primary); color: white; border: none; padding: 10px; border-radius: var(--radius); cursor: pointer; font-weight: 800; font-size: 1rem;"
>
  В корзину
</button>
            `
            : `
              <button disabled style="width: 100%; background: #cbd5e1; color: #64748b; border: none; padding: 10px; border-radius: 8px; cursor: not-allowed; font-weight: bold;">
                Нет в наличии
              </button>
            `
        }
      </div>
    `;
    const addButton = card.querySelector(".dish-add-button");

    if (addButton) {
      addButton.addEventListener("click", () => {
        addDishToCart(dish.id, dish.name, dish.price, dish.quantity);
      });
    }
    container.appendChild(card);
  });
}

// Генерация кнопок-табов категорий сверху меню
function renderCategoryTabs() {
  const container = document.getElementById("menu-container");
  if (!container) return;

  // Ищем или создаем блок табов перед контейнером меню
  let tabsContainer = document.getElementById("category-tabs-container");
  if (!tabsContainer) {
    tabsContainer = document.createElement("div");
    tabsContainer.id = "category-tabs-container";
    tabsContainer.className = "category-tabs";
    container.parentNode.insertBefore(tabsContainer, container);
  }

  // Получаем уникальные категории из меню
  const categories = [...new Set(allDishes.map((d) => d.category))];

  let html = `<button class="category-tab ${currentCategory === "ALL" ? "active" : ""}" onclick="filterCategory('ALL')">Все меню</button>`;

  categories.forEach((cat) => {
    html += `<button class="category-tab ${currentCategory === cat ? "active" : ""}" onclick="filterCategory('${cat}')">${cat}</button>`;
  });

  tabsContainer.innerHTML = html;
}

// Переключение категории
window.filterCategory = function (category) {
  currentCategory = category;
  renderCategoryTabs();
  renderMenu();
};

// Функция для загрузки меню с бэкенда
async function loadMenu() {
  try {
    const response = await fetch("/api/menu");
    allDishes = await response.json();

    renderCategoryTabs();
    renderMenu();
  } catch (err) {
    console.error("Ошибка загрузки меню:", err);

    showToast(
      "Не удалось загрузить меню. Попробуйте обновить страницу.",
      "error",
      6000,
    );

    const container = document.getElementById("menu-container");

    if (container) {
      container.textContent =
        "Не удалось загрузить меню. Попробуйте обновить страницу.";
    }
  }
}

// Динамический баннер доставки с учетом дедлайна с сервера

// Динамический баннер приёма заказов

function updateDeliveryBanner(deadlineHour, goalAmount) {
  const banner = document.getElementById("delivery-banner");
  if (!banner) return;

  const statusElement = document.getElementById("delivery-banner-status");
  const titleElement = document.getElementById("delivery-banner-title");
  const descriptionElement = document.getElementById(
    "delivery-banner-description",
  );
  const dateElement = document.getElementById("delivery-banner-date");
  const goalElement = document.getElementById("delivery-banner-goal");

  // 1. Отображаем цель организации
  const goal = Number(goalAmount);

  if (
    goalAmount != null &&
    goalAmount !== "" &&
    Number.isFinite(goal) &&
    goal > 0
  ) {
    const formattedGoal = new Intl.NumberFormat("ru-RU").format(goal);

    goalElement.textContent = `Цель организации — ${formattedGoal} ₽. Заказывайте вместе с коллегами!`;
  } else {
    goalElement.textContent = "Цель организации пока не указана.";
  }

  // 2. Проверяем дедлайн
  const deadline = Number(deadlineHour);

  if (
    deadlineHour == null ||
    deadlineHour === "" ||
    !Number.isInteger(deadline) ||
    deadline < 0 ||
    deadline > 23
  ) {
    banner.dataset.state = "loading";

    statusElement.textContent = "ЗАКАЗЫ ПРИНИМАЮТСЯ";
    titleElement.textContent = "Вы можете оформить заказ";
    descriptionElement.textContent =
      "Ожидаемое время доставки пока уточняется.";
    dateElement.textContent = "—";

    return;
  }

  // 3. Получаем время именно по Якутску
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Yakutsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const time = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  const currentHour = Number(time.hour);

  // 4. Определяем дату доставки
  const deliveryTomorrow = currentHour >= deadline;

  banner.dataset.state = deliveryTomorrow ? "tomorrow" : "today";

  const deliveryDate = new Date(
    Date.UTC(
      Number(time.year),
      Number(time.month) - 1,
      Number(time.day) + (deliveryTomorrow ? 1 : 0),
    ),
  );

  const dateText = deliveryDate.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  dateElement.textContent = dateText;

  const deadlineText = `${String(deadline).padStart(2, "0")}:00`;

  // 5. Заказы принимаются ВСЕГДА
  statusElement.textContent = "ЗАКАЗЫ ПРИНИМАЮТСЯ";

  if (deliveryTomorrow) {
    titleElement.textContent = "Заказывайте на завтра!";

    descriptionElement.textContent =
      `Дедлайн на сегодня (${deadlineText}) уже прошёл. ` +
      `Оформить заказ можно прямо сейчас! ` +
      `Ожидаемая доставка завтра около 12:00.`;
  } else {
    titleElement.textContent = "Успейте заказать на сегодня!";

    descriptionElement.textContent =
      `Оформите заказ до ${deadlineText} по времени Якутска. ` +
      `Ожидаемая доставка сегодня около 12:00.`;
  }
}

// Загрузка LIVE-параметров, баннера и меню при старте
async function initMainPage() {
  try {
    const res = await fetch("/api/settings");
    if (res.ok) {
      const settings = await res.json();

      document.getElementById("banner-goal").innerText =
        `${settings.ORGANIZATION_GOAL_AMOUNT} ₽`;
      document.getElementById("banner-deadline").innerText =
        `${settings.ORDER_DEADLINE_HOUR}:00`;
      document.getElementById("banner-discount").innerText =
        `${settings.COUPON_DISCOUNT_PERCENT}%`;

      updateDeliveryBanner(
        settings.ORDER_DEADLINE_HOUR,
        settings.ORGANIZATION_GOAL_AMOUNT,
      );

      setInterval(() => {
        updateDeliveryBanner(
          settings.ORDER_DEADLINE_HOUR,
          settings.ORGANIZATION_GOAL_AMOUNT,
        );
      }, 60_000);
    }
  } catch (err) {
    console.error("Не удалось загрузить параметры системы:", err);
    updateDeliveryBanner(1314, 11230);
  }

  loadMenu();
}

document.addEventListener("DOMContentLoaded", initMainPage);
