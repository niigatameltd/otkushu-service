const heroElement = document.getElementById("heroTitle");

const defaultSettings = {
  ORDER_DEADLINE_HOUR: 10,
  COUPON_DISCOUNT_PERCENT: 10,
};

fetch("/api/settings", {
  method: "GET",
})
  .then((response) => {
    if (!response.ok) {
      throw new Error("Ошибка запроса api/settings");
    }
    return response.json(); // забираем тело в json
  })
  .catch((error) => {
    console.error("Ошибка получения данных: ", error);
    return defaultSettings;
  })
  .then((settings) => {
    const texts = [
      `<span class="hero-title-highlight">Доставка обедов</span> из столовой прямо к вам <span class="hero-title-highlight">на работу</span>, дешевле чем бизнес-ланч!`,
      `Успейте заказать <span class="hero-title-highlight">до ${settings.ORDER_DEADLINE_HOUR}:00</span> и в 12:00 уже наслаждайтесь вкусным обедом!`,
      `Достигайте <span class="hero-title-highlight">цели организации</span> и получите <span class="hero-title-highlight">купон ${settings.COUPON_DISCOUNT_PERCENT}%</span> на следующий заказ!`,
    ];

    let index = 0;

    heroElement.innerHTML = texts[index];

    setInterval(() => {
      index++;

      if (index >= texts.length) {
        index = 0;
      }

      heroElement.classList.add("hero-is-changing");

      setTimeout(() => {
        heroElement.innerHTML = texts[index];
        heroElement.classList.remove("hero-is-changing");
      }, 400);
    }, 5000);
  });
