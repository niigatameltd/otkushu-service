// Быстрая проверка авторизации без сетевых подгрузок HTML

async function checkAuthAndRender() {
  const slot = document.getElementById("user-auth-slot");
  if (!slot) return;

  try {
    const res = await fetch("/api/auth/profile");

    if (res.ok) {
      const user = await res.json();

      let managerBtn = "";
      if (user.is_manager) {
        managerBtn = `<a href="/manager.html" class="main-nav-manager-button">Управление</a>`;
      }

      slot.innerHTML = `
        ${managerBtn}
        <span class="main-nav-name">${user.name}</span>
        <button onclick="logoutUser()" class="main-nav-exit-button">Выйти</button>
      `;
    } else {
      // Пользователь не авторизован — оставляем дефолтную ссылку "Войти" из HTML
    }
  } catch (err) {
    console.error("Ошибка при проверке авторизации:", err);
  } finally {
    // В ЛЮБОМ случае (успех или ошибка) делаем блок видимым, убирая класс скрытия
    slot.classList.remove("auth-slot-hidden");
  }
}

async function logoutUser() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
}

// Функция для открытия/закрытия меню на мобильных устройствах
function toggleMenu() {
  const nav = document.getElementById("mainNav");
  nav.classList.toggle("open");

  // Меняем иконку с ☰ (бургер) на ✕ (крестик) для красоты
  const btn = nav.querySelector(".hamburger-btn");
  if (nav.classList.contains("open")) {
    btn.textContent = "✕";
  } else {
    btn.textContent = "☰";
  }
}

function checkCart() {
  const cart = JSON.parse(localStorage.getItem("cart")) || [];
  if (cart.length > 0) {
    // Если корзина не пуста, подсвечиваем ссылку на корзину на главной странице
    const cartLink = document.getElementById("cart-link");
    if (cartLink) {
      cartLink.style.fontWeight = "bold";
      cartLink.style.backgroundColor = "#faca4b";
      cartLink.style.color = "#1e293b;"; // Можно выбрать любой цвет для подсветки
      // помимо цвета еще надо чтобы в скобках было количество товаров в корзине, например: "Корзина (3)"
      cartLink.textContent = `(${cart.reduce((sum, item) => sum + item.quantity, 0)}) Корзина`;
    }
  }
}

// Запускаем проверку сразу при загрузке DOM

document.addEventListener("DOMContentLoaded", checkAuthAndRender);
document.addEventListener("DOMContentLoaded", checkCart);
