let currentMode = "login"; // 'login' или 'register'

// Функция приведения телефона к стандарту +7XXXXXXXXXX
// Функция автоматической очистки и приведения телефона к стандарту +7XXXXXXXXXX
// Функция приведения телефона к стандарту +7XXXXXXXXXX
function normalizePhoneNumber(phone) {
  // Убираем всё, кроме цифр и плюса
  let cleaned = phone.replace(/[^\+\d]/g, "").trim();

  // Если начинается с 8 и длина 11 (например, 89148282046)
  if (cleaned.startsWith("8") && cleaned.length === 11) {
    cleaned = "+7" + cleaned.slice(1);
  }
  // Если начинается с 7 и длина 11 (например, 79148282046)
  else if (cleaned.startsWith("7") && cleaned.length === 11) {
    cleaned = "+" + cleaned;
  }
  // Если ввели 10 цифр без префикса (например, 9148282046)
  else if (cleaned.length === 10) {
    cleaned = "+7" + cleaned;
  }

  return cleaned;
}

// Добавим автоформатирование прямо при вводе в поле (чтобы человек видел результат)
document.addEventListener("DOMContentLoaded", () => {
  const phoneInput = document.getElementById("phone_number");
  if (phoneInput) {
    phoneInput.addEventListener("input", (e) => {
      // Подсказываем +7, если поле пустое
      if (e.target.value.length === 1 && e.target.value === "8") {
        e.target.value = "+7";
      }
    });
  }
});

// Переключение между вкладками Вход / Регистрация
function switchMode(mode) {
  currentMode = mode;
  const title = document.getElementById("form-title");
  const nameField = document.getElementById("name-field-container");
  const orgField = document.getElementById("org-field-container");
  const submitBtn = document.getElementById("submit-btn");
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const pinLabel = document.getElementById("pin-label");
  const pinInput = document.getElementById("pin_code");

  if (mode === "login") {
    title.innerText = "Вход в систему";
    pinLabel.innerText = "PIN-код (6 цифр):";
    pinInput.placeholder = "6 цифр";
    nameField.style.display = "none";
    orgField.style.display = "none";
    submitBtn.innerText = "Войти";
    tabLogin.style.color = "#16a34a";
    tabLogin.style.borderBottom = "2px solid #16a34a";
    tabRegister.style.color = "#7f8c8d";
    tabRegister.style.borderBottom = "none";
  } else {
    title.innerText = "Регистрация сотрудника";
    pinLabel.innerText = "Придумайте PIN-код (6 цифр):";
    pinInput.placeholder = "6 цифр";
    nameField.style.display = "block";
    orgField.style.display = "block";
    submitBtn.innerText = "Зарегистрироваться";
    tabRegister.style.color = "#16a34a";
    tabRegister.style.borderBottom = "2px solid #16a34a";
    tabLogin.style.color = "#7f8c8d";
    tabLogin.style.borderBottom = "none";

    loadOrganizations(); // Подгружаем список организаций
  }
}

// Загрузка списка организаций с сервера
async function loadOrganizations() {
  try {
    const response = await fetch("/api/organizations");
    const orgs = await response.json();
    const select = document.getElementById("organization_id");

    select.innerHTML = '<option value="">Выберите организацию...</option>';
    orgs.forEach((org) => {
      select.innerHTML += `<option value="${org.id}">${org.name}</option>`;
    });
  } catch (err) {
    console.error("Ошибка загрузки организаций:", err);
  }
}

// Обработка отправки формы
// Обработка отправки формы
document.getElementById("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  let rawPhone = document.getElementById("phone_number").value.trim();
  const phone_number = normalizePhoneNumber(rawPhone);

  // Принудительно обновляем значение в поле инпута, чтобы пользователь видел результат
  document.getElementById("phone_number").value = phone_number;

  const pin_code = document.getElementById("pin_code").value.trim();

  // Новые регистрации требуют PIN из 6 цифр, старые пользователи могут войти с 4-значным.
  if (
    !(currentMode === "register"
      ? /^\d{6}$/.test(pin_code)
      : /^\d{4,6}$/.test(pin_code))
  ) {
    showToast(
      currentMode === "register"
        ? "Придумайте PIN из 6 цифр."
        : "Введите PIN из 4–6 цифр.",
      "warning",
      3000,
    );
    return;
  }

  // Проверка формата (+7 и 10 цифр после него, итого 12 символов)
  const phoneRegex = /^\+7\d{10}$/;
  if (!phoneRegex.test(phone_number)) {
    showToast(
      "Введите корректный номер телефона в формате: +79149996655",
      "error",
      3000,
    );
    return;
  }

  let url = "/api/auth/login";
  let bodyData = { phone_number, pin_code };

  if (currentMode === "register") {
    url = "/api/auth/register";
    const name = document.getElementById("name").value.trim();
    const organization_id = document.getElementById("organization_id").value;

    if (!name || !organization_id) {
      // Показываем уведомление
      showToast(`Заполните имя и выберите организацию`, "error", 2000);
      return;
    }

    bodyData.name = name;
    bodyData.organization_id = parseInt(organization_id);
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyData),
    });

    const result = await response.json();

    if (response.ok) {
      if (currentMode === "register") {
        showToast(
          `Регистрация прошла успешно! Теперь вы можете войти`,
          "success",
          2000,
        );
        switchMode("login"); // Переключаем на вкладку входа
      } else {
        showToast(`Добро пожаловать, ${result.name}!`, "success", 2000);
        window.location.href = "/"; // Перенаправляем на главную
      }
    } else {
      showToast(
        "Ошибка: " + (result.error || "Не удалось выполнить действие"),
        "error",
        4000,
      );
    }
  } catch (err) {
    console.error("Ошибка сети:", err);
    showToast(`Ошибка соединения с сервером`, "error", 4000);
  }
});
