/* ==============================================================
   OTKUSHU — Статистика организаций
   Использует существующий GET /api/stats/today-organizations.
   Не влияет на оплату, заказы и назначение даты доставки.
   ============================================================= */

const statsMoney = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const statsInteger = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function formatStatsMoney(value) {
  return `${statsMoney.format(safeNumber(value))} ₽`;
}

function formatStatsCount(value) {
  return statsInteger.format(safeNumber(value));
}

function makeStatsElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function appendStatsMetric(parent, label, value) {
  const cell = makeStatsElement("div", "stats-org__metric");
  cell.append(
    makeStatsElement("span", "", label),
    makeStatsElement("strong", "", formatStatsCount(value)),
  );
  parent.appendChild(cell);
}

function buildOrganizationCard(row, index) {
  const collected = safeNumber(row.total_sum);
  const goal = safeNumber(row.goal_amount);
  const remaining =
    goal > 0
      ? row.remaining_to_goal !== null && row.remaining_to_goal !== undefined
        ? safeNumber(row.remaining_to_goal)
        : Math.max(0, goal - collected)
      : 0;
  const achieved = row.goal_achieved === true;
  const progress = goal > 0 ? Math.min(100, (collected / goal) * 100) : 0;
  const percentLabel = `${Math.round(progress)}%`;

  const card = makeStatsElement(
    "article",
    `stats-org${achieved ? " stats-org--achieved" : ""}`,
  );
  const top = makeStatsElement("div", "stats-org__top");
  const identity = makeStatsElement("div", "stats-org__identity");
  const orgIcon = makeStatsElement("span", "stats-org__icon");
  const iconImg = document.createElement("img");
  iconImg.src = "/icons/building-complex.svg";
  iconImg.alt = "";
  orgIcon.appendChild(iconImg);

  const identityText = document.createElement("div");
  const heading = makeStatsElement(
    "h3",
    "",
    row.organization_name || `Организация ${index + 1}`,
  );
  const headingId = `stats-org-heading-${index}`;
  heading.id = headingId;
  card.setAttribute("aria-labelledby", headingId);
  identityText.append(
    heading,
    makeStatsElement("p", "stats-org__subtext", "Совместный сбор заказов"),
  );
  identity.append(orgIcon, identityText);

  const status = makeStatsElement(
    "span",
    `stats-org__status stats-org__status--${achieved ? "achieved" : "pending"}`,
    achieved ? "Цель достигнута" : "Сбор продолжается",
  );
  top.append(identity, status);

  const progressTop = makeStatsElement("div", "stats-org__progress-top");
  progressTop.append(
    makeStatsElement("span", "", "Собрано / цель"),
    makeStatsElement(
      "strong",
      "",
      `${formatStatsMoney(collected)} / ${goal > 0 ? formatStatsMoney(goal) : "цель не задана"}`,
    ),
  );

  const track = makeStatsElement("div", "stats-org__track");
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-label", `Выполнение цели: ${heading.textContent}`);
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", String(Math.round(progress)));
  track.setAttribute("aria-valuetext", `${percentLabel} от цели`);
  const fill = makeStatsElement("div", "stats-org__fill");
  fill.style.width = `${progress}%`;
  track.appendChild(fill);

  const bottom = makeStatsElement("div", "stats-org__progress-bottom");
  bottom.append(
    makeStatsElement(
      "span",
      "",
      goal > 0 ? "Прогресс выполнения" : "Цель не задана",
    ),
    makeStatsElement("strong", "", goal > 0 ? percentLabel : "—"),
  );

  const metrics = makeStatsElement("div", "stats-org__metrics");
  appendStatsMetric(
    metrics,
    "Зарегистрированных покупателей",
    row.total_customers,
  );
  appendStatsMetric(metrics, "Гостевых заказов", row.guest_orders);
  appendStatsMetric(metrics, "Всего заказов", row.total_orders);

  const note = makeStatsElement(
    "div",
    `stats-org__note${achieved ? "" : " stats-org__note--pending"}`,
  );
  const noteIcon = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  noteIcon.setAttribute("viewBox", "0 0 24 24");
  noteIcon.setAttribute("fill", "none");
  noteIcon.setAttribute("stroke", "currentColor");
  noteIcon.setAttribute("stroke-width", "1.8");
  noteIcon.setAttribute("stroke-linecap", "round");
  noteIcon.setAttribute("stroke-linejoin", "round");
  noteIcon.setAttribute("aria-hidden", "true");
  noteIcon.innerHTML =
    '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>';
  note.append(
    noteIcon,
    makeStatsElement(
      "span",
      "",
      goal <= 0
        ? "Целевая сумма для этой организации пока не указана."
        : achieved
          ? "Командная цель достигнута! Бонусные купоны предоставляются согласно правилам сервиса."
          : `До цели осталось ${formatStatsMoney(remaining)}. Заказывайте вместе с коллегами!`,
    ),
  );

  card.append(top, progressTop, track, bottom, metrics, note);
  return card;
}

function parseStatsDate(value) {
  // API возвращает дату календарного дня. Не переводим её в местное время браузера.
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return { key: `${match[1]}-${match[2]}-${match[3]}`, date };
}

function yakutskDayKey() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Yakutsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function getStatsDateLabel(data) {
  const parsed = parseStatsDate(data.target_date);
  if (!parsed) return { label: "Уточняется", relative: null };
  const label = parsed.date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const today = yakutskDayKey();
  const todayDate = parseStatsDate(today);
  const tomorrowDate = new Date(todayDate.date.getTime() + 86_400_000);
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);
  return {
    label,
    relative:
      parsed.key === today
        ? "today"
        : parsed.key === tomorrow
          ? "tomorrow"
          : "other",
  };
}

function renderStatsPeriod(data) {
  const { label, relative } = getStatsDateLabel(data);
  const deadline = Number(data.deadline_hour);
  const hasDeadline =
    data.deadline_hour !== null &&
    data.deadline_hour !== undefined &&
    data.deadline_hour !== "" &&
    Number.isInteger(deadline) &&
    deadline >= 0 &&
    deadline <= 23;
  const cutoff = hasDeadline ? `${String(deadline).padStart(2, "0")}:00` : null;

  document.getElementById("stats-period-status").textContent =
    "Заказы принимаются круглосуточно";
  document.getElementById("stats-period-date").textContent = label;
  document.getElementById("stats-period-title").textContent =
    relative === "today"
      ? "Собираем заказы на сегодня"
      : relative === "tomorrow"
        ? "Собираем заказы на завтра"
        : "Актуальный период сбора";

  const period =
    relative === "today"
      ? "сегодня"
      : relative === "tomorrow"
        ? "завтра"
        : `на ${label}`;
  document.getElementById("stats-period-description").textContent =
    `В статистике показаны заказы на ${period}. ` +
    (cutoff
      ? `Дедлайн ${cutoff} по времени Якутска определяет день доставки, а не закрывает оформление заказов.`
      : "Дата доставки определяется сервером по действующим настройкам.");
}

function renderStatsState(message, description, isError) {
  const container = document.getElementById("stats-container");
  container.replaceChildren();
  const state = makeStatsElement("div", "stats-state");
  state.append(
    makeStatsElement("strong", "", message),
    makeStatsElement("p", "", description),
  );
  const action = isError
    ? makeStatsElement("button", "stats-state__button", "Повторить загрузку")
    : makeStatsElement("a", "stats-state__button", "Посмотреть меню");
  if (isError) {
    action.type = "button";
    action.addEventListener("click", loadStats);
  } else {
    action.href = "/";
  }
  state.appendChild(action);
  container.appendChild(state);
}

let statsRequestInProgress = false;

async function loadStats() {
  if (statsRequestInProgress) return;
  statsRequestInProgress = true;
  const button = document.getElementById("stats-refresh");
  const updated = document.getElementById("stats-updated");
  const container = document.getElementById("stats-container");
  button.disabled = true;
  container.setAttribute("aria-busy", "true");
  updated.textContent = "Обновляем данные…";

  try {
    const response = await fetch("/api/stats/today-organizations", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.organizations)) {
      throw new Error("Некорректный формат ответа API");
    }

    const rows = data.organizations;
    const sum = rows.reduce(
      (total, row) => total + safeNumber(row.total_sum),
      0,
    );
    const goal = rows.reduce(
      (total, row) => total + safeNumber(row.goal_amount),
      0,
    );
    const orders = rows.reduce(
      (total, row) => total + safeNumber(row.total_orders),
      0,
    );
    document.getElementById("stats-total-sum").textContent =
      formatStatsMoney(sum);
    document.getElementById("stats-total-goal").textContent = rows.length
      ? formatStatsMoney(goal)
      : "—";
    document.getElementById("stats-total-orders").textContent =
      formatStatsCount(orders);

    // Круговой прогресс отображает реальные суммарные данные API.
    const overallRing = document.getElementById("stats-overall-ring");
    const overallProgress =
      goal > 0 ? Math.min(100, Math.round((sum / goal) * 100)) : 0;
    overallRing.style.setProperty(
      "--stats-ring-progress",
      `${overallProgress}%`,
    );
    overallRing.setAttribute("aria-valuenow", String(overallProgress));
    overallRing.setAttribute(
      "aria-valuetext",
      goal > 0 ? `${overallProgress}% от общей цели` : "Цель пока не задана",
    );
    document.getElementById("stats-overall-percent").textContent =
      goal > 0 ? `${overallProgress}%` : "—";
    document.getElementById("stats-overall-caption").textContent =
      goal > 0 ? "Процент от суммы целей организаций" : "Цель пока не указана";

    renderStatsPeriod(data);

    const countElement = document.getElementById("stats-org-count");
    countElement.hidden = rows.length === 0;
    countElement.textContent = `${formatStatsCount(rows.length)} орг.`;

    if (!rows.length) {
      renderStatsState(
        "Пока нет данных по организациям",
        "За текущую дату сбора сервер не вернул ни одной организации. Загляните позже или выберите блюда прямо сейчас.",
        false,
      );
    } else {
      const fragment = document.createDocumentFragment();
      rows.forEach((row, index) =>
        fragment.appendChild(buildOrganizationCard(row, index)),
      );
      container.replaceChildren(fragment);
    }

    updated.textContent = `Обновлено в ${new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Yakutsk",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date())} (Якутск)`;
  } catch (error) {
    console.error("Не удалось загрузить статистику:", error);
    updated.textContent = "Не удалось обновить";
    // Не оставляем устаревшие итоги после ошибки загрузки.
    for (const id of [
      "stats-total-sum",
      "stats-total-goal",
      "stats-total-orders",
      "stats-overall-percent",
    ]) {
      document.getElementById(id).textContent = "—";
    }
    document
      .getElementById("stats-overall-ring")
      .style.setProperty("--stats-ring-progress", "0%");
    document
      .getElementById("stats-overall-ring")
      .setAttribute("aria-valuenow", "0");
    document.getElementById("stats-overall-caption").textContent =
      "Данные временно недоступны";
    document.getElementById("stats-org-count").hidden = true;
    document.getElementById("stats-period-date").textContent = "—";
    renderStatsState(
      "Не удалось загрузить статистику",
      "Проверьте интернет-соединение и попробуйте ещё раз. Уже оформленные заказы при этом не изменяются.",
      true,
    );
    document.getElementById("stats-period-title").textContent =
      "Данные временно недоступны";
    document.getElementById("stats-period-description").textContent =
      "Обновите страницу или повторите запрос.";
  } finally {
    statsRequestInProgress = false;
    button.disabled = false;
    container.setAttribute("aria-busy", "false");
  }
}

// Оставляем глобальное имя функции для совместимости со старым кодом.
window.loadStats = loadStats;
document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("stats-refresh")
    ?.addEventListener("click", loadStats);
  loadStats();
});
