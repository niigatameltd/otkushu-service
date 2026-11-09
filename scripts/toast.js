"use strict";

// Универсальная система уведомлений otkushu.ru
(function () {
  const MAX_TOASTS = 4;

  const toastTypes = {
    success: {
      icon: "✓",
      title: "Успешно",
    },
    error: {
      icon: "!",
      title: "Ошибка",
    },
    warning: {
      icon: "!",
      title: "Внимание",
    },
    info: {
      icon: "i",
      title: "Информация",
    },
  };

  // Создаём контейнер только при необходимости.
  function getToastContainer() {
    let container = document.getElementById("toast-container");

    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.className = "toast-container";

      document.body.appendChild(container);
    }

    return container;
  }

  // Закрытие одного уведомления.
  function removeToast(toast) {
    if (toast.dataset.closing === "true") {
      return;
    }

    toast.dataset.closing = "true";
    toast.classList.add("toast-hide");

    // Ждём окончания CSS-анимации.
    setTimeout(() => {
      toast.remove();
    }, 250);
  }

  // Основная функция.
  window.showToast = function (message, type = "info", duration = 4000) {
    const container = getToastContainer();

    const selectedType = toastTypes[type] ? type : "info";

    const config = toastTypes[selectedType];

    // Ограничиваем количество уведомлений на экране.
    const existingToasts = container.querySelectorAll(".toast");

    if (existingToasts.length >= MAX_TOASTS) {
      removeToast(existingToasts[0]);
    }

    const toast = document.createElement("div");

    toast.className = `toast toast-${selectedType}`;

    toast.setAttribute("role", selectedType === "error" ? "alert" : "status");

    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = config.icon;
    icon.setAttribute("aria-hidden", "true");

    const content = document.createElement("div");
    content.className = "toast-content";

    const title = document.createElement("strong");
    title.className = "toast-title";
    title.textContent = config.title;

    const description = document.createElement("p");
    description.className = "toast-description";

    // textContent защищает от выполнения HTML.
    description.textContent = String(message);

    content.append(title, description);

    const closeButton = document.createElement("button");
    closeButton.className = "toast-close";
    closeButton.type = "button";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Закрыть уведомление");

    closeButton.addEventListener("click", () => {
      removeToast(toast);
    });

    toast.append(icon, content, closeButton);
    container.appendChild(toast);

    // Автоматическое закрытие.
    const safeDuration = Number.isFinite(duration)
      ? Math.max(1000, Math.min(duration, 30000))
      : 4000;

    setTimeout(() => {
      removeToast(toast);
    }, safeDuration);

    return toast;
  };
})();
