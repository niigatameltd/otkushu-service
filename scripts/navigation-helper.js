document.addEventListener("DOMContentLoaded", () => {
  const nav = document.getElementById("mainNav");
  if (!nav) return;

  // Нормализуем адреса страниц
  function normalizePath(path) {
    let normalized = path
      .replace(/\.html$/i, "") // Убираем .html
      .replace(/\/+$/, ""); // Убираем слеш в конце

    // Главная страница
    if (normalized === "" || normalized === "/index") {
      return "/";
    }

    return normalized;
  }

  // Получаем текущий адрес
  const currentPath = normalizePath(window.location.pathname);

  // Подсветка активной страницы
  nav
    .querySelectorAll(".main-nav-link[href]:not(.otk-faq-link)")
    .forEach((link) => {
      const linkPath = normalizePath(new URL(link.href).pathname);

      const isActive = linkPath === currentPath;

      link.classList.toggle("is-active", isActive);

      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

  // Управление мобильным меню
  const toggle = nav.querySelector(".hamburger-btn");

  const syncMenuState = () => {
    if (!toggle) return;

    const expanded = nav.classList.contains("open");

    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute(
      "aria-label",
      expanded ? "Закрыть меню" : "Открыть меню",
    );
  };

  toggle?.addEventListener("click", syncMenuState);
  syncMenuState();

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("open")) {
      nav.classList.remove("open");
      syncMenuState();
      toggle?.focus();
    }
  });
});
