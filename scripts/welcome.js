document.addEventListener("DOMContentLoaded", () => {
  const LAST_VISIT_KEY = "otkushu_last_visit";
  const WELCOME_PENDING_KEY = "otkushu_welcome_pending";

  const DAYS_ABSENT = 7; // кол-во дней
  const ABSENCE_MS = DAYS_ABSENT * 24 * 60 * 60 * 1000;

  const dialog = document.getElementById("otk-welcome");

  // Окно находится только на главной странице
  if (!dialog) return;

  const startButton = document.getElementById("otk-welcome-start");
  const closeButton = document.getElementById("otk-welcome-close");

  let goToMenu = false;
  let shouldShow = false;

  // Проверяем историю посещений
  try {
    const now = Date.now();
    const savedVisit = localStorage.getItem(LAST_VISIT_KEY);

    const lastVisit = savedVisit === null ? null : Number(savedVisit);

    const firstVisit = savedVisit === null;

    const longAbsent =
      lastVisit !== null &&
      (!Number.isFinite(lastVisit) || now - lastVisit >= ABSENCE_MS);

    if (firstVisit || longAbsent) {
      localStorage.setItem(WELCOME_PENDING_KEY, "1");
    }

    shouldShow = localStorage.getItem(WELCOME_PENDING_KEY) === "1";

    localStorage.setItem(LAST_VISIT_KEY, String(now));
  } catch (error) {
    console.warn("Хранилище посещений недоступно:", error);
  }

  // Универсальная функция открытия окна
  function openWelcome() {
    if (dialog.open) return;

    goToMenu = false;

    dialog.showModal();
    document.body.classList.add("otk-welcome-locked");
  }

  // Кнопка "Понятно, к меню!"
  startButton.addEventListener("click", () => {
    goToMenu = true;
    dialog.close();
  });

  // Крестик
  closeButton.addEventListener("click", () => {
    dialog.close();
  });

  // Закрытие по затемнённому фону
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  // Обработка закрытия окна
  dialog.addEventListener("close", () => {
    document.body.classList.remove("otk-welcome-locked");

    try {
      localStorage.removeItem(WELCOME_PENDING_KEY);
    } catch (error) {
      console.warn("Ошибка сохранения приветствия:", error);
    }

    // Убираем #faq из адреса после закрытия
    if (window.location.hash === "#faq") {
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }

    const shouldScroll = goToMenu;
    goToMenu = false;

    if (!shouldScroll) return;

    const menu =
      document.getElementById("category-tabs-container") ||
      document.getElementById("menu-container");

    if (!menu) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    requestAnimationFrame(() => {
      menu.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  });

  // Открытие FAQ через адрес /#faq
  function checkFaqHash() {
    if (window.location.hash === "#faq") {
      openWelcome();
    }
  }

  // Если пользователь нажал FAQ без изменения адреса
  document.querySelectorAll(".otk-faq-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openWelcome();
    });
  });

  // Реагируем на изменение #faq в адресе
  window.addEventListener("hashchange", checkFaqHash);

  // Автоматическое приветствие или ручное открытие FAQ
  if (shouldShow || window.location.hash === "#faq") {
    openWelcome();
  }
});
