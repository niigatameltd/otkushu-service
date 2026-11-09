"use strict";

(function () {
  const game = document.getElementById("bite-game");
  const button = document.getElementById("bite-play-button");
  const reel = document.getElementById("bite-reel");
  const result = document.getElementById("bite-result");
  const caption = document.getElementById("bite-caption");
  if (!game || !button || !reel || !result || !caption) return;

  let spinning = false;
  const reels = ["🍔", "🥪", "🎟️", "🍟", "🎁", "🎫"];

  // Ссылка показывается только тем, у кого ещё нет оплаченного заказа.
  const orderLink = document.createElement("a");
  orderLink.href = "/";
  orderLink.textContent = "Перейти в меню и сделать заказ";
  orderLink.className = "bite-order-link";
  orderLink.style.cssText =
    "display:none;margin:14px auto 0;color:#166534;font-weight:700;text-decoration:underline;text-underline-offset:3px;";
  caption.insertAdjacentElement("afterend", orderLink);

  function showLocked() {
    button.disabled = true;
    button.textContent = "🔒 Сначала сделай заказ";
    reel.textContent = "🔒";
    reel.classList.remove("bite-reel-win", "bite-reel-spinning");
    result.textContent = "Игра пока закрыта";
    caption.textContent =
      "Оплати первый заказ в «Откушу!», чтобы открылись ежедневные попытки.";
    orderLink.style.display = "inline-block";
  }

  function showAlreadyPlayed(won) {
    orderLink.style.display = "none";
    button.disabled = true;
    button.textContent = "Попробовать снова завтра";
    reel.textContent = won ? "🎫" : "🍔";
    reel.classList.toggle("bite-reel-win", won);
    result.textContent = won
      ? "Сегодня ты выиграл купон! 🎉"
      : "Сегодня попытка уже использована.";
    caption.textContent = "Новая попытка — после 00:00 по времени Якутска.";
  }

  async function getJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.assign("/login.html");
      throw new Error("Необходимо войти в аккаунт");
    }
    if (!response.ok) {
      throw new Error(data.error || `Ошибка HTTP ${response.status}`);
    }
    return data;
  }

  async function loadGameStatus() {
    try {
      const status = await getJson("/api/bite-game/today");
      game.hidden = false;
      if (status.eligible !== true) {
        showLocked();
      } else if (status.played) {
        showAlreadyPlayed(status.won);
      } else {
        orderLink.style.display = "none";
        button.disabled = false;
        button.textContent = "Откусить!";
        reel.textContent = "🍔";
        reel.classList.remove("bite-reel-win");
        result.textContent = "Испытай удачу вдруг сегодня твой день?";
        caption.textContent = `Шанс выиграть 1 купон ${status.chance_percent}%. Одна попытка в день.`;
      }
    } catch (error) {
      console.error("Ошибка загрузки игры:", error);
      game.hidden = false;
      orderLink.style.display = "none";
      button.disabled = true;
      result.textContent = "Игра временно недоступна.";
      caption.textContent = error.message;
    }
  }

  button.addEventListener("click", async () => {
    if (spinning || button.disabled) return;
    spinning = true;
    button.disabled = true;
    button.textContent = "Крутим...";
    result.textContent = "Откушу выбирает твой результат...";
    caption.textContent = "Результат определяет сервер, а не анимация.";
    reel.classList.add("bite-reel-spinning");
    let tick = 0;
    const ticker = setInterval(() => {
      reel.textContent = reels[tick % reels.length];
      tick++;
    }, 100);

    try {
      // Не показываем результат мгновенно, но не считаем его в браузере.
      const [response] = await Promise.all([
        getJson("/api/bite-game/play", { method: "POST" }),
        new Promise((resolve) => setTimeout(resolve, 4000)), // интрига
      ]);
      if (response.already_played) {
        showAlreadyPlayed(response.won);
      } else if (response.won) {
        reel.textContent = "🎫";
        reel.classList.add("bite-reel-win");
        result.textContent = "ДЖЕКПОТ! +1 купон 🎉";
        caption.textContent =
          "Купон уже начислен на твой баланс. Завтра можно снова!";
        button.textContent = "Попробовать снова завтра";
        if (typeof window.loadProfileData === "function") {
          await window.loadProfileData();
        }
      } else {
        reel.textContent = "🍔";
        result.textContent = "Сегодня без купона — но завтра новая попытка!";
        caption.textContent =
          "Ты сможешь снова «откусить» после 00:00 по Якутску.";
        button.textContent = "Попробовать снова завтра";
      }
    } catch (error) {
      console.error("Ошибка розыгрыша:", error);
      reel.textContent = "❔";
      result.textContent = "Не удалось проверить результат.";
      caption.textContent =
        "Обнови страницу: если попытка состоялась, результат сохранён.";
      // Не включаем кнопку наугад: сперва сверим результат с сервером.
      await loadGameStatus();
    } finally {
      clearInterval(ticker);
      reel.classList.remove("bite-reel-spinning");
      spinning = false;
    }
  });

  loadGameStatus();
})();
