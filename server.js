require("dotenv").config(); // dotenv для хранения секретов и конфигураций
const express = require("express");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const path = require("path");
const { randomInt, randomBytes, createHash } = require("node:crypto");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { hashPin, verifyPin } = require("./pin-security");

const app = express();
// Доверяем заголовкам X-Forwarded-For только от локального Nginx.
app.set("trust proxy", "loopback");
app.use(cookieParser());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Настройка подключения к нашей базе PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER,
  host: "localhost",
  database: process.env.DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

//
if (process.env.NODE_ENV === "development") {
  app.use(express.static(__dirname));
}
// Больше нет app.use(express.static(...)) — статику отдает Nginx!

const JWT_SECRET = process.env.JWT_SECRET;

let appSettings = {
  ORGANIZATION_GOAL_AMOUNT: 1000, // Порог суммы для купонов
  ORDER_DEADLINE_HOUR: 11, // Час дедлайна (12:00)
  COUPON_DISCOUNT_PERCENT: 10,
  DELIVERY_SERVICE_FEE: 49,
};

// Настройка хранилища для загружаемых картинок блюд
// Настройка хранилища для загружаемых картинок
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "menu-images"));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

// Настраиваем лимит в 5 МБ и фильтр по типу файлов (только картинки)
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Ограничение: 5 МБ
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Разрешено загружать только изображения!"), false);
    }
  },
});

// Middleware для проверки прав менеджера
// Middleware для проверки прав менеджера
async function checkManager(req, res, next) {
  // Проверяем, авторизован ли пользователь (через req.user, как в других роутах)
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: "Не авторизован" });
  }
  try {
    const result = await pool.query(
      "SELECT is_manager FROM customers WHERE id = $1",
      [req.user.id],
    );
    if (result.rows.length > 0 && result.rows[0].is_manager) {
      next(); // Пользователь менеджер — пропускаем
    } else {
      res
        .status(403)
        .json({ error: "Доступ запрещен. Требуются права менеджера." });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка проверки прав" });
  }
}

// ОРГАНИЗАЦИИ:

// 1. Получить список организаций для выпадающего списка
app.get("/api/organizations", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name FROM organizations ORDER BY id",
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера при получении организаций" });
  }
});

// АВТОРИЗАЦИЯ:

// Не блокируем всех сотрудников офиса по общему IP слишком агрессивно:
// у них может быть один внешний адрес. Для входа дополнительно ограничиваем
// количество запросов именно на конкретный телефон.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много регистраций. Попробуйте позже." },
});
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много попыток входа. Попробуйте позже." },
});
// Ограничение на номер, независимо от IP. Нормализуем номер до расчёта ключа.
const loginPhoneLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const phone = normalizeCustomerPhone(req.body?.phone_number);
    // Валидный телефон не является IP; используем префикс, чтобы не смешивать ключи.
    return phone ? `phone:${phone}` : `invalid:${ipKeyGenerator(req.ip)}`;
  },
  message: {
    error: "Слишком много попыток для этого номера. Попробуйте через 15 минут.",
  },
});

function normalizeCustomerPhone(value) {
  if (typeof value !== "string" || value.length > 60) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) {
    return `+7${digits.slice(1)}`;
  }
  return null;
}

// Новые аккаунты: PIN из 6 цифр (старые PIN из 4 цифр продолжают работать).
app.post("/api/auth/register", registerLimiter, async (req, res) => {
  const { name, phone_number, organization_id, pin_code } = req.body || {};
  const phone = normalizeCustomerPhone(phone_number);
  const cleanName = typeof name === "string" ? name.trim() : "";
  const orgId = Number(organization_id);

  if (
    !phone ||
    cleanName.length < 2 ||
    cleanName.length > 100 ||
    !Number.isSafeInteger(orgId) ||
    orgId <= 0 ||
    typeof pin_code !== "string" ||
    !/^\d{6}$/.test(pin_code)
  ) {
    return res.status(400).json({
      error: "Укажите имя, организацию, телефон и PIN-код из 6 цифр.",
    });
  }
  if (
    /^(\d)\1{5}$/.test(pin_code) ||
    ["123456", "654321", "012345"].includes(pin_code)
  ) {
    return res
      .status(400)
      .json({ error: "Придумайте менее очевидный PIN-код." });
  }

  try {
    const hash = await hashPin(pin_code);
    const newCustomer = await pool.query(
      `INSERT INTO customers (name, phone_number, organization_id, pin_code)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, phone_number, organization_id`,
      [cleanName, phone, orgId, hash],
    );
    return res.json({ success: true, customer: newCustomer.rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Номер уже зарегистрирован." });
    }
    if (err.code === "23503") {
      return res
        .status(400)
        .json({ error: "Выбранная организация не существует." });
    }
    console.error("Ошибка регистрации:", err);
    return res.status(500).json({ error: "Ошибка при регистрации" });
  }
});

app.post(
  "/api/auth/login",
  loginIpLimiter,
  loginPhoneLimiter,
  async (req, res) => {
    const { phone_number, pin_code } = req.body || {};
    const phone = normalizeCustomerPhone(phone_number);
    if (!phone || typeof pin_code !== "string" || !/^\d{4,6}$/.test(pin_code)) {
      return res
        .status(400)
        .json({ error: "Укажите корректный телефон и PIN-код." });
    }

    try {
      const result = await pool.query(
        "SELECT id, name, phone_number, organization_id, pin_code FROM customers WHERE phone_number = $1",
        [phone],
      );
      const customer = result.rows[0];
      // Одинаковое сообщение при неизвестном номере и неправильном PIN.
      if (!customer || !(await verifyPin(pin_code, customer.pin_code))) {
        return res.status(401).json({ error: "Неверный телефон или PIN-код." });
      }

      // Совместимость: если PIN ещё хранится открыто, обновляем его после верного входа.
      if (!customer.pin_code.startsWith("scrypt-v1:")) {
        const upgraded = await hashPin(pin_code);
        await pool.query(
          "UPDATE customers SET pin_code = $1 WHERE id = $2 AND pin_code = $3",
          [upgraded, customer.id, customer.pin_code],
        );
      }

      const token = jwt.sign(
        {
          id: customer.id,
          name: customer.name,
          phone_number: customer.phone_number,
          organization_id: customer.organization_id,
        },
        JWT_SECRET,
        { expiresIn: "30d" },
      );

      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      return res.json({
        success: true,
        message: "Успешный вход!",
        name: customer.name,
      });
    } catch (err) {
      console.error("Ошибка входа:", err);
      return res.status(500).json({ error: "Ошибка сервера при входе" });
    }
  },
);

// Проверка текущего пользователя по JWT-куке
app.get("/api/auth/me", (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.json({ loggedIn: false });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ loggedIn: true, user: decoded });
  } catch (err) {
    res.json({ loggedIn: false });
  }
});

// Выход из системы (очистка куки)
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true, message: "Вышли из системы" });
});

// МЕНЮ:
// Главный маршрут (endpoint), который отдает меню из базы в формате JSON
// Получить меню с правильной сортировкой по заданным категориям
app.get("/api/menu", async (req, res) => {
  try {
    const query = `
SELECT * FROM dishes
WHERE is_available = TRUE
ORDER BY
  CASE category
    WHEN 'ХОЛОДНЫЕ БЛЮДА' THEN 1
    WHEN 'ПЕРВЫЕ БЛЮДА' THEN 2
    WHEN 'ГОРЯЧИЕ БЛЮДА' THEN 3
    WHEN 'ГАРНИРЫ' THEN 4
    WHEN 'МУЧНЫЕ ИЗДЕЛИЯ' THEN 5
    WHEN 'НАПИТКИ' THEN 6
    ELSE 7
  END,
  id ASC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Ошибка при получении данных меню");
  }
});

// Middleware для проверки авторизации (если еще не вынес в отдельную функцию)
function checkAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: "Требуется авторизация." });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, name, phone_number, organization_id }
    next();
  } catch (err) {
    return res.status(403).json({ error: "Недействительный токен." });
  }
}

// Публичные настройки для отображения на главной и в статистике
app.get("/api/settings", (req, res) => {
  res.json(appSettings);
});

// юкасса функция создания платежа по доке шаг 1:

function createYooKassaPayment(idempotenceKey, order) {
  let credentials;
  if (process.env.YOOKASSA_MODE === "live") {
    credentials = Buffer.from(
      `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`,
    ).toString("base64");
  } else if (process.env.YOOKASSA_MODE === "test") {
    credentials = Buffer.from(
      `${process.env.YOOKASSA_SHOP_ID_TEST}:${process.env.YOOKASSA_SECRET_KEY_TEST}`,
    ).toString("base64");
  } else {
    throw new Error("Неизвестный режим ЮKassa");
  }

  const create = fetch("https://api.yookassa.ru/v3/payments", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Idempotence-Key": idempotenceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(order),
  })
    .then((response) => {
      return response.json().then((data) => {
        if (!response.ok) {
          throw new Error(`Ошибка ${response.status} - ${data.description}`);
        }

        return data;
      });
    })
    .catch((error) => {
      console.error("Ошибка создания платежа:", error.message);

      throw error;
    })
    .finally(() => {
      console.log("Запрос к ЮKassa завершён");
    });

  return create;
}

// ДЛЯ ПРОВЕРКИ ПЛАТЕЖА:
function getYooKassaPayment(payment_id) {
  if (!payment_id || typeof payment_id !== "string") {
    throw new Error("Некорректный ID платежа");
  }

  let credentials;

  if (process.env.YOOKASSA_MODE === "test") {
    credentials = Buffer.from(
      `${process.env.YOOKASSA_SHOP_ID_TEST}:${process.env.YOOKASSA_SECRET_KEY_TEST}`,
    ).toString("base64");
  } else if (process.env.YOOKASSA_MODE === "live") {
    credentials = Buffer.from(
      `${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`,
    ).toString("base64");
  } else {
    throw new Error("Неизвестный режим ЮKassa");
  }

  const result = fetch(`https://api.yookassa.ru/v3/payments/${payment_id}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${credentials}`,
    },
  })
    .then((response) => {
      return response.json().then((data) => {
        if (!response.ok) {
          throw new Error(`Ошибка ${response.status} - ${data.description}`);
        }
        return data;
      });
    })
    .catch((error) => {
      console.error("Ошибка проверки платежа:", error.message);

      throw error;
    })
    .finally(() => {
      console.log("Запрос к ЮKassa завершён");
    });
  return result;
}

// БОНУСЫ ОРГАНИЗАЦИИ
async function awardOrganizationCoupons(client, organizationId, deliveryDate) {
  // Если покупатель не принадлежит организации,
  // бонусы не начисляем.
  if (organizationId == null) {
    return;
  }

  // 1. Получаем цель организации из настроек.
  const goalAmount = Number(appSettings.ORGANIZATION_GOAL_AMOUNT);

  if (!Number.isFinite(goalAmount) || goalAmount <= 0) {
    throw new Error("Некорректная цель организации");
  }

  // 2. Считаем сумму ОПЛАЧЕННЫХ блюд организации
  // за конкретную дату доставки.
  //
  // total_price = блюда после скидки + доставка
  // delivery_fee = стоимость доставки
  //
  // Следовательно, вычитая доставку,
  // получаем стоимость блюд после скидки.

  const sumResult = await client.query(
    `
    SELECT
      COALESCE(
        SUM(total_price - COALESCE(delivery_fee, 0)),
        0
      ) AS total_food

    FROM orders

    WHERE organization_id = $1
      AND delivery_date = $2
      AND status = 'active'
    `,
    [organizationId, deliveryDate],
  );

  // PostgreSQL возвращает NUMERIC в виде строки.
  const totalFood = Number(sumResult.rows[0].total_food);

  console.log(
    `[БОНУСЫ] Организация №${organizationId}: ` +
      `сумма блюд ${totalFood} ₽ / цель ${goalAmount} ₽`,
  );

  // 3. Если организация ещё не достигла цели,
  // никаких купонов не начисляем.
  if (totalFood < goalAmount) {
    console.log(
      `[БОНУСЫ] Цель не достигнута. ` +
        `Осталось ${Math.max(0, goalAmount - totalFood).toFixed(2)} ₽`,
    );

    return;
  }

  // 4. Цель достигнута!
  // Находим всех покупателей организации,
  // у которых есть хотя бы один оплаченный заказ
  // на эту дату доставки.
  //
  // UNIQUE + ON CONFLICT защищают
  // от повторного начисления купона.

  const rewardsResult = await client.query(
    `
    INSERT INTO organization_coupon_rewards (
      customer_id,
      organization_id,
      delivery_date
    )

    SELECT DISTINCT
      customer_id,
      organization_id,
      delivery_date

    FROM orders

    WHERE organization_id = $1
      AND delivery_date = $2
      AND status = 'active'
      AND customer_id IS NOT NULL -- Гости участвуют в сумме, но не получают купоны

    ON CONFLICT (
      customer_id,
      organization_id,
      delivery_date
    )
    DO NOTHING

    RETURNING customer_id
    `,
    [organizationId, deliveryDate],
  );

  // 5. Получаем ID покупателей,
  // которым ещё не начисляли бонус.
  const rewardedCustomerIds = rewardsResult.rows.map((row) => row.customer_id);

  // 6. Начисляем по одному купону каждому.
  if (rewardedCustomerIds.length > 0) {
    await client.query(
      `
      UPDATE customers

      SET coupons_count = COALESCE(coupons_count, 0) + 1

      WHERE id = ANY($1::int[])
      `,
      [rewardedCustomerIds],
    );
  }

  console.log(
    `[БОНУСЫ] Организация №${organizationId}: ` +
      `цель достигнута (${totalFood} ₽). ` +
      `Начислено купонов: ${rewardedCustomerIds.length}`,
  );
}

// УВЕДОМЛЕНИЯ ОТ ЮKASSA
app.post("/api/yookassa/webhook", async (req, res) => {
  // 1. Получаем ID платежа из уведомления.
  const paymentId = req.body?.object?.id;

  // Проверяем, что ID вообще передан.
  if (!paymentId || typeof paymentId !== "string") {
    return res.sendStatus(400);
  }

  // 2. Получаем реальную информацию о платеже от ЮKassa.
  // Пока никакой транзакции PostgreSQL не открываем!
  let payment;

  try {
    payment = await getYooKassaPayment(paymentId);
  } catch (error) {
    console.error("Не удалось проверить платёж:", error);
    return res.sendStatus(500);
  }

  // Проверяем, что ЮKassa вернула именно запрошенный платёж.
  if (payment.id !== paymentId) {
    console.error("ID платежа не совпадает!");
    return res.sendStatus(500);
  }

  // Обрабатываем только два окончательных состояния.
  if (payment.status !== "succeeded" && payment.status !== "canceled") {
    console.log("Платёж ещё не завершён:", payment.status);
    return res.sendStatus(200);
  }

  // 3. Получаем отдельное соединение с PostgreSQL.
  const client = await pool.connect();

  try {
    // Начинаем транзакцию.
    await client.query("BEGIN");

    // Сначала узнаём организацию без блокировки заказа.
    const orderInfo = await client.query(
      `SELECT organization_id
   FROM orders
   WHERE yookassa_payment_id = $1`,
      [payment.id],
    );

    if (orderInfo.rows.length === 0) {
      throw new Error("Заказ не найден");
    }

    const organizationId = orderInfo.rows[0].organization_id;

    // Блокируем организацию.
    if (organizationId != null) {
      await client.query(
        `SELECT id
     FROM organizations
     WHERE id = $1
     FOR UPDATE`,
        [organizationId],
      );
    }

    // 4. Находим заказ по ID платежа.
    // FOR UPDATE блокирует строку заказа до COMMIT/ROLLBACK.
    const orderRes = await client.query(
      `SELECT *
       FROM orders
       WHERE yookassa_payment_id = $1
       FOR UPDATE`,
      [payment.id],
    );

    // Если заказ не найден, прекращаем обработку.
    if (orderRes.rows.length === 0) {
      throw new Error(`Заказ для платежа ${payment.id} не найден`);
    }

    // Для удобства достаём объект заказа.
    const order = orderRes.rows[0];

    // 5. Проверяем сумму и валюту.
    if (
      order.total_price !== payment.amount?.value ||
      payment.amount?.currency !== "RUB"
    ) {
      throw new Error(`Не совпадает сумма или валюта заказа ${order.id}`);
    }

    // 6. Проверяем, не обработали ли заказ раньше.
    if (order.status !== "pending_payment") {
      console.log("Заказ уже обработан:", order.id, order.status);

      // Нельзя молча игнорировать противоречивое состояние.
      if (
        (payment.status === "succeeded" && order.status !== "active") ||
        (payment.status === "canceled" && order.status !== "cancelled")
      ) {
        throw new Error(`Конфликт статуса заказа ${order.id}`);
      }

      await client.query("COMMIT");
      return res.sendStatus(200);
    }

    // ==========================================
    // 7. УСПЕШНАЯ ОПЛАТА
    // ==========================================
    if (payment.status === "succeeded" && payment.paid === true) {
      // Если покупатель использовал купон:
      if (order.used_coupon === true && order.coupon_deducted === false) {
        // Уменьшаем количество купонов на 1.
        // Условие coupons_count > 0 не позволяет получить отрицательный баланс.
        const couponResult = await client.query(
          `UPDATE customers
           SET coupons_count = coupons_count - 1
           WHERE id = $1 AND coupons_count > 0`,
          [order.customer_id],
        );

        // Если купон списать не удалось, откатим всю транзакцию.
        if (couponResult.rowCount !== 1) {
          throw new Error(`Не удалось списать купон заказа ${order.id}`);
        }

        // Запоминаем, что купон действительно списан.
        await client.query(
          `UPDATE orders
           SET coupon_deducted = TRUE
           WHERE id = $1`,
          [order.id],
        );
      }

      // Переводим заказ в активное состояние.
      await client.query(
        `UPDATE orders
         SET status = 'active'
         WHERE id = $1`,
        [order.id],
      );

      await awardOrganizationCoupons(
        client,
        order.organization_id,
        order.delivery_date,
      );

      console.log("Оплата подтверждена, заказ активирован:", order.id);

      // Здесь позже подключим начисление бонусов организации.
      // Важно: этот блок тоже должен работать в транзакции.
    }

    // ==========================================
    // 8. ОТМЕНА ПЛАТЕЖА
    // ==========================================
    else if (payment.status === "canceled") {
      // Возвращаем зарезервированные порции на склад.
      await client.query(
        `
UPDATE dishes AS d
SET quantity = d.quantity + reserved.quantity
FROM (
  SELECT dish_id, SUM(quantity) AS quantity
  FROM order_items
  WHERE order_id = $1
  GROUP BY dish_id
) AS reserved
WHERE d.id = reserved.dish_id`,
        [order.id],
      );

      // Переводим заказ в cancelled.
      await client.query(
        `UPDATE orders
         SET status = 'cancelled'
         WHERE id = $1`,
        [order.id],
      );

      // Купон не списываем.
      // Его резерв автоматически освободится,
      // потому что заказ больше не pending_payment.

      console.log("Заказ отменён, блюда возвращены:", order.id);
    }

    // Если получили succeeded, но paid !== true,
    // это противоречивое состояние, требующее проверки.
    else {
      throw new Error(`Неожиданное состояние платежа ${payment.id}`);
    }

    // 9. Сохраняем ВСЕ изменения транзакции.
    await client.query("COMMIT");

    // Сообщаем ЮKassa, что уведомление обработано.
    return res.sendStatus(200);
  } catch (error) {
    // При любой ошибке откатываем изменения PostgreSQL.
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Ошибка ROLLBACK:", rollbackError);
    }

    console.error("Ошибка обработки webhook:", error);
    return res.sendStatus(500);
  } finally {
    // Обязательно возвращаем соединение в пул.
    client.release();
  }
});

// ЗАКАЗЫ:

// Гостям разрешено заказывать без аккаунта, но не получать купоны.
// Лимит сдерживает автоматическое резервирование всего меню неоплаченными заказами.
// Для офиса с общим IP установлен умеренный порог, его следует пересмотреть по нагрузке.
const guestCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много попыток оформления. Попробуйте позже." },
});

const guestViewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Попробуйте позже." },
});

function hashGuestToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function readGuestToken(req) {
  const header = req.get("Authorization") || "";
  const match = /^Bearer ([a-zA-Z0-9_-]{43})$/.exec(header);
  return match ? match[1] : null;
}

function publicGuestReturnUrl() {
  // Используем уже настроенный публичный HTTPS-адрес магазина.
  const base = new URL(process.env.YOOKASSA_RETURN_URL);
  if (base.protocol !== "https:") {
    throw new Error("YOOKASSA_RETURN_URL должен использовать HTTPS");
  }
  return new URL("/guest-order.html", base.origin).toString();
}

app.post("/api/orders", checkAuth, (req, res) => createOrder(req, res, false));
app.post("/api/orders/guest", guestCreateLimiter, (req, res) =>
  createOrder(req, res, true),
);

// Существующая логика в одном месте для обычного заказа и заказа гостя.
async function createOrder(req, res, guestMode) {
  let client;
  try {
    client = await pool.connect();
    // 1. Получаем точную дату и время для Якутска (UTC+9)
    const yakutskTimeStr = new Date().toLocaleString("en-US", {
      timeZone: "Asia/Yakutsk",
    });
    const nowYakutsk = new Date(yakutskTimeStr);

    const currentHour = nowYakutsk.getHours();
    let targetDate = new Date(nowYakutsk);

    // Если время уже после дедлайна (например, после 12:00 дня), доставка переносится на завтра
    if (currentHour >= appSettings.ORDER_DEADLINE_HOUR) {
      targetDate.setDate(targetDate.getDate() + 1);
    }

    // Форматируем дату в YYYY-MM-DD напрямую, без опасных conversion-сдвигов
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, "0");
    const day = String(targetDate.getDate()).padStart(2, "0");
    const formattedDeliveryDate = `${year}-${month}-${day}`;

    const { items, use_coupon, delivery_comment } = req.body || {};
    const customerId = guestMode ? null : req.user.id;
    const organizationId = guestMode
      ? Number(req.body?.organization_id)
      : req.user.organization_id;

    const guestName =
      guestMode && typeof req.body?.guest_name === "string"
        ? req.body.guest_name.trim()
        : null;
    const guestPhone = guestMode
      ? normalizeCustomerPhone(req.body?.guest_phone)
      : null;
    const guestEmailRaw =
      guestMode && typeof req.body?.guest_email === "string"
        ? req.body.guest_email.trim()
        : "";
    const guestEmail = guestEmailRaw || null;
    const guestToken = guestMode ? randomBytes(32).toString("base64url") : null;
    const guestTokenHash = guestToken ? hashGuestToken(guestToken) : null;

    if (guestMode) {
      if (
        !guestName ||
        guestName.length < 2 ||
        guestName.length > 100 ||
        !guestPhone ||
        !Number.isSafeInteger(organizationId) ||
        organizationId <= 0
      ) {
        return res.status(400).json({
          error: "Укажите имя, российский телефон и организацию.",
        });
      }
      if (
        guestEmail &&
        (guestEmail.length > 255 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail))
      ) {
        return res.status(400).json({ error: "Некорректный email." });
      }
      if (use_coupon !== undefined && use_coupon !== false) {
        return res.status(400).json({
          error: "Купоны доступны только зарегистрированным покупателям.",
        });
      }
      // Не доверяем идентификатору организации от посетителя.
      const orgCheck = await client.query(
        "SELECT 1 FROM organizations WHERE id = $1",
        [organizationId],
      );
      if (orgCheck.rowCount !== 1) {
        return res.status(400).json({ error: "Организация не найдена." });
      }
    }

    // Комментарий необязателен.
    // Разрешаем строку, null или отсутствие поля.
    if (delivery_comment != null && typeof delivery_comment !== "string") {
      return res.status(400).json({
        error: "Комментарий должен быть текстом",
      });
    }

    const deliveryComment =
      typeof delivery_comment === "string" ? delivery_comment.trim() : "";

    if (deliveryComment.length > 500) {
      return res.status(400).json({
        error: "Комментарий не должен превышать 500 символов",
      });
    }

    // Не записываем телефоны и комментарии посетителей в логи.

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "Корзина пуста или имеет неправильный формат!",
      });
    }

    const dishIds = new Set();

    for (const item of items) {
      const dishId = Number(item.id);

      if (!Number.isSafeInteger(dishId) || dishId <= 0) {
        return res.status(400).json({
          error: "Некорректный ID блюда",
        });
      }

      if (dishIds.has(dishId)) {
        return res.status(400).json({
          error: "Одно и то же блюдо передано несколько раз",
        });
      }

      dishIds.add(dishId);
    }

    let totalPrice = 0;
    const orderItems = [];

    await client.query("BEGIN"); // начинаем транзакцию

    for (const item of items) {
      const quantity = Number(item.quantity);

      if (!Number.isInteger(quantity) || quantity <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Количество должно быть целым положительным числом",
        });
      }

      // FOR UPDATE решает race condition - блокировкой строки до завершения транзакции
      const dish = await client.query(
        `
  SELECT id, name, COALESCE(quantity, 0) AS quantity, price
  FROM dishes
  WHERE id = $1
    AND is_available = TRUE
  FOR UPDATE 
  `,
        [item.id],
      );

      // проверяем наличие в БД:
      if (dish.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          error: "Блюдо не найдено",
        });
      }

      // проверяем количество с БД:
      if (dish.rows[0].quantity < quantity) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Недостаточно блюда на складе",
        });
      }

      // списываем остатки в БД:
      await client.query(
        `UPDATE dishes SET quantity = quantity - $1 WHERE id = $2`,
        [quantity, dish.rows[0].id],
      );

      orderItems.push({
        dish_id: dish.rows[0].id,
        quantity: quantity,
        name: dish.rows[0].name,
        price: dish.rows[0].price,
      });

      // считаем общую сумму заказанных блюд:
      totalPrice = dish.rows[0].price * quantity + totalPrice;
    }

    // Проверяем наличие купона и рассчитываем скидку
    let couponUsed = false;

    if (!guestMode && use_coupon === true) {
      const customerRes = await client.query(
        "SELECT coupons_count FROM customers WHERE id = $1 FOR UPDATE",
        [customerId],
      );

      const currentCoupons = customerRes.rows[0]?.coupons_count || 0;

      const reservedRes = await client.query(
        `
  SELECT COUNT(*)::int AS reserved
  FROM orders
  WHERE customer_id = $1
    AND status = 'pending_payment'
    AND used_coupon = TRUE
    AND coupon_deducted = FALSE
  `,
        [customerId],
      );

      const reservedCoupons = reservedRes.rows[0].reserved;

      const availableCoupons = currentCoupons - reservedCoupons;

      if (availableCoupons > 0) {
        couponUsed = true;

        const discountPercent = Number(appSettings.COUPON_DISCOUNT_PERCENT);

        if (
          !Number.isFinite(discountPercent) ||
          discountPercent < 0 ||
          discountPercent > 100
        ) {
          throw new Error("Некорректный процент скидки");
        }

        const totalKopecks = Math.round(totalPrice * 100);

        const discountKopecks = Math.round(
          (totalKopecks * discountPercent) / 100,
        );

        totalPrice = Math.max(0, (totalKopecks - discountKopecks) / 100);
      } else {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "У вас нет доступных купонов!",
        });
      }
    }

    const foodTotal = totalPrice;

    const deliveryFee = Number(appSettings.DELIVERY_SERVICE_FEE);

    if (
      !Number.isFinite(deliveryFee) ||
      deliveryFee < 0 ||
      !Number.isSafeInteger(Math.round(deliveryFee * 100))
    ) {
      throw new Error("Некорректная стоимость доставки");
    }

    const finalTotalKopecks =
      Math.round(foodTotal * 100) + Math.round(deliveryFee * 100);

    if (finalTotalKopecks <= 0) {
      throw new Error("Итоговая сумма должна быть больше нуля");
    }

    const finalTotal = finalTotalKopecks / 100;

    // добавляем заказ в таблицу orders и получаем сразу его id:
    const order = await client.query(
      `
  INSERT INTO orders (
    customer_id,
    organization_id,
    total_price,
    delivery_fee,
    used_coupon,
    delivery_date,
    status,
    delivery_comment,
    guest_name,
    guest_phone,
    guest_email,
    guest_access_token_hash
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  RETURNING id
  `,
      [
        customerId,
        organizationId,
        finalTotal,
        deliveryFee,
        couponUsed,
        formattedDeliveryDate,
        "pending_payment",
        deliveryComment || null,
        guestName,
        guestPhone,
        guestEmail,
        guestTokenHash,
      ],
    );

    console.log("Создан заказ:", order.rows[0].id);

    //добавляем заказ в таблицу order_items в БД:
    for (const item of orderItems) {
      await client.query(
        `INSERT INTO order_items
      (order_id, dish_id, dish_name, price, quantity)
     VALUES ($1, $2, $3, $4, $5)`,
        [order.rows[0].id, item.dish_id, item.name, item.price, item.quantity],
      );
    }

    // START Юкасса Integration by ME =D
    // Генерируем key:
    const key = crypto.randomUUID(); // idempotencekey генерируем
    // делаем body для запроса:
    const yooKassaBody = {
      amount: {
        value: finalTotal.toFixed(2),
        currency: "RUB",
      },

      capture: true,

      confirmation: {
        type: "redirect",
        // Без токена в return_url — он остаётся только в браузере гостя.
        return_url: guestMode
          ? publicGuestReturnUrl()
          : process.env.YOOKASSA_RETURN_URL,
      },

      description: `Оплата за услугу организации и доставки индивидуального питания, заказ №${order.rows[0].id}`,
    };
    // делаем сам запрос:
    const yooKassaResult = await createYooKassaPayment(key, yooKassaBody); // получаем готовый js объект

    if (!yooKassaResult.confirmation?.confirmation_url) {
      throw new Error("ЮKassa не вернула ссылку оплаты");
    }

    // сохраняем полученный yookassa_payment_id в postgresql orders:
    await client.query(
      `UPDATE orders SET yookassa_payment_id = $1 WHERE id = $2`,
      [yooKassaResult.id, order.rows[0].id],
    );

    await client.query("COMMIT"); // подтверждаем

    // отправляем ответ:
    return res.status(201).json({
      success: true,

      order: order.rows[0].id,
      order_id: order.rows[0].id,

      items: orderItems,

      total_price: finalTotal.toFixed(2),
      delivery_fee: deliveryFee.toFixed(2),

      message: `Заказ успешно оформлен на ${formattedDeliveryDate}!`,

      payment_url: yooKassaResult.confirmation.confirmation_url,
      ...(guestMode
        ? {
            // Секрет размещается во фрагменте URL (#...), который браузер
            // не отправляет Nginx при обычном открытии страницы.
            guest_order_url: `/guest-order.html#token=${guestToken}`,
          }
        : {}),
    });
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Ошибка ROLLBACK:", rollbackError);
      }
    }
    console.error("Ошибка при сохранении заказа:", error);
    return res.status(500).json({
      error: "Внутренняя ошибка сервера",
    });
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Статус гостевого заказа. Только обладатель секретной ссылки видит сведения.
app.get("/api/guest-orders/status", guestViewLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const token = readGuestToken(req);
  if (!token)
    return res.status(401).json({ error: "Неверная ссылка на заказ." });
  try {
    const result = await pool.query(
      `
      SELECT o.id, o.guest_name, o.status, o.total_price, o.delivery_fee,
             o.created_at, o.delivery_date::text AS delivery_date,
             o.delivery_comment, org.name AS organization_name,
             COALESCE(
               (SELECT json_agg(json_build_object(
                  'name', oi.dish_name, 'quantity', oi.quantity, 'price', oi.price
               ) ORDER BY oi.id)
               FROM order_items oi WHERE oi.order_id = o.id),
               '[]'::json
             ) AS items
      FROM orders o
      JOIN organizations org ON org.id = o.organization_id
      WHERE o.customer_id IS NULL AND o.guest_access_token_hash = $1
    `,
      [hashGuestToken(token)],
    );
    if (result.rowCount !== 1) {
      return res.status(404).json({ error: "Гостевой заказ не найден." });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка статуса гостевого заказа:", error);
    return res.status(500).json({ error: "Не удалось получить заказ." });
  }
});

// Продолжение того ЖЕ платежа, без создания новых заказов и без резерва блюд.
app.post(
  "/api/guest-orders/resume-payment",
  guestViewLimiter,
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const token = readGuestToken(req);
    if (!token)
      return res.status(401).json({ error: "Неверная ссылка на заказ." });
    try {
      const result = await pool.query(
        `
      SELECT id, status, total_price, yookassa_payment_id
      FROM orders
      WHERE customer_id IS NULL AND guest_access_token_hash = $1
    `,
        [hashGuestToken(token)],
      );
      if (result.rowCount !== 1) {
        return res.status(404).json({ error: "Гостевой заказ не найден." });
      }
      const order = result.rows[0];
      if (order.status !== "pending_payment" || !order.yookassa_payment_id) {
        return res.status(409).json({ error: "Заказ не ожидает оплаты." });
      }
      const payment = await getYooKassaPayment(order.yookassa_payment_id);
      if (
        payment.id !== order.yookassa_payment_id ||
        payment.amount?.currency !== "RUB" ||
        !/^\d+\.\d{2}$/.test(String(payment.amount?.value ?? "")) ||
        Math.round(Number(payment.amount.value) * 100) !==
          Math.round(Number(order.total_price) * 100)
      ) {
        throw new Error("Сумма, валюта или ID платежа не совпадают");
      }
      if (payment.status !== "pending" || payment.paid === true) {
        return res.status(409).json({
          error:
            payment.status === "succeeded"
              ? "Оплата уже поступила в ЮKassa. Обновите статус заказа."
              : "Этот платёж уже недоступен. Обновите статус заказа.",
        });
      }
      const url = payment.confirmation?.confirmation_url;
      if (
        payment.confirmation?.type !== "redirect" ||
        typeof url !== "string"
      ) {
        return res.status(409).json({ error: "Ссылка на оплату недоступна." });
      }
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("ЮKassa вернула некорректный URL");
      }
      if (parsed.protocol !== "https:") {
        throw new Error("ЮKassa вернула небезопасную ссылку");
      }
      return res.json({ order_id: order.id, confirmation_url: url });
    } catch (error) {
      console.error("Ошибка гостевого продолжения оплаты:", error);
      return res.status(502).json({
        error: "Не удалось проверить платёж. Попробуйте позже.",
      });
    }
  },
);

// ПРОДОЛЖИТЬ ОПЛАТУ СУЩЕСТВУЮЩЕГО ЗАКАЗА

app.post("/api/orders/:id/resume-payment", checkAuth, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const customerId = req.user.id;

    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      return res.status(400).json({
        error: "Некорректный номер заказа",
      });
    }

    // 1. Ищем заказ только текущего покупателя.
    const orderResult = await pool.query(
      `
        SELECT
          id,
          customer_id,
          status,
          total_price,
          yookassa_payment_id
        FROM orders
        WHERE id = $1
          AND customer_id = $2
        `,
      [orderId, customerId],
    );

    if (orderResult.rowCount === 0) {
      return res.status(404).json({
        error: "Заказ не найден",
      });
    }

    const order = orderResult.rows[0];

    // 2. Разрешаем продолжение только ожидающего заказа.
    if (order.status !== "pending_payment") {
      return res.status(409).json({
        error:
          "Этот заказ больше не ожидает оплаты. " +
          "Обновите страницу «Мои заказы».",
      });
    }

    // 3. У заказа должен существовать платёж ЮKassa.
    const paymentId = order.yookassa_payment_id;

    if (!paymentId) {
      return res.status(409).json({
        error:
          "Платёж для заказа пока не найден. " +
          "Не создавайте повторный заказ. " +
          "Обратитесь к администрации сервиса.",
      });
    }

    // 4. Получаем реальное состояние платежа у ЮKassa.
    // Новый платёж НЕ создаём!
    const payment = await getYooKassaPayment(paymentId);

    // 5. Убеждаемся, что ЮKassa вернула нужный платёж.
    if (payment.id !== paymentId) {
      throw new Error("Не совпадает ID платежа ЮKassa");
    }

    // 6. Проверяем валюту и сумму.
    const paymentAmount = String(payment.amount?.value ?? "");
    const orderAmount = Number(order.total_price);

    if (
      payment.amount?.currency !== "RUB" ||
      !/^\d+\.\d{2}$/.test(paymentAmount) ||
      !Number.isFinite(orderAmount) ||
      Math.round(Number(paymentAmount) * 100) !== Math.round(orderAmount * 100)
    ) {
      throw new Error(
        `Сумма или валюта платежа заказа №${orderId} не совпадает`,
      );
    }

    // 7. Платёж уже успешно оплачен.
    // Ждём webhook, если локальный статус ещё не обновился.
    if (payment.status === "succeeded") {
      return res.status(409).json({
        error:
          "Оплата уже подтверждена ЮKassa. " +
          "Подождите обновления статуса заказа.",
      });
    }

    // 8. Платёж отменён или истёк срок подтверждения.
    if (payment.status === "canceled") {
      return res.status(409).json({
        error:
          "Срок оплаты этого платежа истёк " +
          "или платёж был отменён. " +
          "Дождитесь обновления статуса заказа.",
      });
    }

    // 9. Неизвестное состояние — не перенаправляем.
    if (payment.status !== "pending" || payment.paid === true) {
      return res.status(409).json({
        error: "Платёж сейчас недоступен для продолжения",
      });
    }

    // 10. Берём ссылку на подтверждение из ЮKassa.
    const confirmationUrl = payment.confirmation?.confirmation_url;

    if (
      payment.confirmation?.type !== "redirect" ||
      typeof confirmationUrl !== "string"
    ) {
      return res.status(409).json({
        error: "Ссылка на продолжение оплаты недоступна",
      });
    }

    // Разрешаем только защищённую HTTPS-ссылку.
    let url;

    try {
      url = new URL(confirmationUrl);
    } catch {
      throw new Error("Некорректная ссылка ЮKassa");
    }

    if (url.protocol !== "https:") {
      throw new Error("Небезопасная ссылка оплаты");
    }

    // Ссылка принадлежит существующему платежу.
    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      order_id: order.id,
      payment_status: "pending",
      confirmation_url: confirmationUrl,
    });
  } catch (error) {
    console.error("Ошибка продолжения оплаты заказа:", error);

    return res.status(502).json({
      error: "Не удалось проверить платёж в ЮKassa. " + "Попробуйте позже.",
    });
  }
});

// мои заказы:
app.get("/api/my-orders", checkAuth, async (req, res) => {
  try {
    const customerId = req.user.id;

    const result = await pool.query(
      `
      SELECT
        o.id,
        o.total_price,
        o.created_at,
        o.delivery_date::text AS delivery_date,
        o.status,
        o.used_coupon,
        o.coupon_deducted,
        o.delivery_comment,

        COALESCE(
          json_agg(
            json_build_object(
              'name', oi.dish_name,
              'price', oi.price,
              'quantity', oi.quantity
            )
            ORDER BY oi.id
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'::json
        ) AS items

      FROM orders o

      LEFT JOIN order_items oi
        ON oi.order_id = o.id

      WHERE o.customer_id = $1

      GROUP BY o.id

      ORDER BY o.created_at DESC, o.id DESC
      `,
      [customerId],
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Ошибка /api/my-orders:", error);

    return res.status(500).json({
      error: "Ошибка получения истории заказов",
    });
  }
});

// СТАТИСТИКА:
// 1. Обновленный эндпоинт статистики (с учетом таймзоны Якутска Asia/Yakutsk)

app.get("/api/stats/today-organizations", async (req, res) => {
  try {
    // 1. Получаем текущие дату и час именно в Якутске.
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Yakutsk",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());

    const getPart = (type) => parts.find((part) => part.type === type)?.value;

    const year = Number(getPart("year"));
    const month = Number(getPart("month"));
    const day = Number(getPart("day"));
    const currentHour = Number(getPart("hour"));

    // 2. Определяем дату доставки.
    // Используем UTC только для арифметики календарных дат.
    const targetDate = new Date(Date.UTC(year, month - 1, day));

    const deadlineHour = Number(appSettings.ORDER_DEADLINE_HOUR);

    if (
      !Number.isInteger(deadlineHour) ||
      deadlineHour < 0 ||
      deadlineHour > 23
    ) {
      throw new Error("Некорректный час дедлайна");
    }

    // После дедлайна показываем статистику на завтра.
    if (currentHour >= deadlineHour) {
      targetDate.setUTCDate(targetDate.getUTCDate() + 1);
    }

    const formattedTargetDate = targetDate.toISOString().slice(0, 10);

    // 3. Получаем цель организации из настроек.
    const goalAmount = Number(appSettings.ORGANIZATION_GOAL_AMOUNT);

    if (!Number.isFinite(goalAmount) || goalAmount <= 0) {
      throw new Error("Некорректная цель организации");
    }

    // 4. Получаем статистику организаций.
    // Учитываем только оплаченные заказы.
    //
    // ВАЖНО:
    // total_price включает стоимость доставки.
    // Поэтому delivery_fee вычитаем.
    //
    // Купон уже учтён в total_price:
    // считаем стоимость блюд ПОСЛЕ скидки.

    const query = `
      SELECT
        org.id AS organization_id,
        org.name AS organization_name,

        COUNT(DISTINCT o.customer_id)::integer AS total_customers,
        COUNT(o.id) FILTER (
          WHERE o.id IS NOT NULL AND o.customer_id IS NULL
        )::integer AS guest_orders,
        COUNT(o.id)::integer AS total_orders,

        COALESCE(
          SUM(
            o.total_price - COALESCE(o.delivery_fee, 0)
          ),
          0
        ) AS total_sum

      FROM organizations org

      LEFT JOIN orders o
        ON org.id = o.organization_id
        AND o.delivery_date = $1
        AND o.status = 'active'

      GROUP BY org.id, org.name

      ORDER BY total_sum DESC, org.name ASC;
    `;

    const result = await pool.query(query, [formattedTargetDate]);

    // 5. Рассчитываем прогресс каждой организации.
    const responseData = result.rows.map((row) => {
      // PostgreSQL возвращает NUMERIC как строку.
      const currentSum = Number(row.total_sum);

      const remaining = Math.max(
        0,
        Number((goalAmount - currentSum).toFixed(2)),
      );

      const isGoalAchieved = currentSum >= goalAmount;

      return {
        ...row,

        // Отдаём сумму блюд числом.
        total_sum: currentSum,

        goal_amount: goalAmount,
        remaining_to_goal: remaining,
        goal_achieved: isGoalAchieved,

        target_date: formattedTargetDate,
      };
    });

    // 6. Возвращаем ответ frontend.
    return res.json({
      deadline_hour: deadlineHour,
      target_date: formattedTargetDate,
      organizations: responseData,
    });
  } catch (error) {
    console.error("Ошибка /api/stats/today-organizations:", error);

    return res.status(500).json({
      error: "Ошибка получения статистики",
    });
  }
});

app.get("/api/coupons/availability", checkAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        COALESCE(c.coupons_count, 0)::integer AS total,

        (
          SELECT COUNT(*)::integer
          FROM orders o
          WHERE o.customer_id = c.id
            AND o.status = 'pending_payment'
            AND o.used_coupon = TRUE
            AND o.coupon_deducted = FALSE
        ) AS reserved

      FROM customers c
      WHERE c.id = $1
      `,
      [req.user.id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Пользователь не найден",
      });
    }

    const total = Number(result.rows[0].total);
    const reserved = Number(result.rows[0].reserved);
    const available = Math.max(0, total - reserved);

    return res.json({
      total,
      reserved,
      available,
    });
  } catch (error) {
    console.error("Ошибка проверки купонов:", error);

    return res.status(500).json({
      error: "Не удалось получить информацию о купонах",
    });
  }
});

// ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ:

app.get("/api/auth/profile", checkAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        c.id,
        c.name,
        c.phone_number,
        c.organization_id,
        o.name AS organization_name,
        c.coupons_count,
        c.is_manager
      FROM customers AS c
      LEFT JOIN organizations AS o
        ON c.organization_id = o.id
      WHERE c.id = $1`,
      [req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// НОВЫЕ МЕНЕДЖЕРСКИЕ ЭНДПОИНТЫ:

// --------------------------------------
// АДМИНИСТРАТИВНЫЙ СБРОС PIN-КОДА
// --------------------------------------
// Ограничиваем количество попыток подтвердить PIN менеджера.
const managerPinResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `manager-pin-reset:${req.user.id}`,
  message: {
    error: "Слишком много попыток сброса PIN. Попробуйте через 15 минут.",
  },
});

// Искать можно по ПОЛНОМУ номеру телефона, а не по части номера.
app.get(
  "/api/manager/customers/lookup",
  checkAuth,
  checkManager,
  async (req, res) => {
    const phone = normalizeCustomerPhone(req.query.phone);
    if (!phone) {
      return res.status(400).json({ error: "Укажите полный номер телефона." });
    }
    try {
      const result = await pool.query(
        `SELECT c.id, c.name, c.phone_number, COALESCE(c.is_manager, false) AS is_manager,
              o.name AS organization_name
       FROM customers c
       LEFT JOIN organizations o ON o.id = c.organization_id
       WHERE c.phone_number = $1`,
        [phone],
      );
      if (!result.rowCount) {
        return res.status(404).json({ error: "Пользователь не найден." });
      }
      return res.json({ customer: result.rows[0] });
    } catch (error) {
      console.error("Ошибка поиска клиента менеджером:", error);
      return res.status(500).json({ error: "Не удалось найти пользователя." });
    }
  },
);

app.post(
  "/api/manager/customers/reset-pin",
  checkAuth,
  checkManager,
  managerPinResetLimiter,
  async (req, res) => {
    // Нужен запрос с нашего сайта, а не с постороннего домена.
    const allowedOrigin = process.env.PUBLIC_ORIGIN || "https://otkushu.ru";
    if (req.get("origin") !== allowedOrigin) {
      return res.status(403).json({ error: "Недопустимый источник запроса." });
    }

    const { customer_id, phone_number, new_pin, manager_pin } = req.body || {};
    const customerId = Number(customer_id);
    const phone = normalizeCustomerPhone(phone_number);

    if (
      !Number.isSafeInteger(customerId) ||
      customerId < 1 ||
      !phone ||
      typeof new_pin !== "string" ||
      !/^\d{6}$/.test(new_pin) ||
      typeof manager_pin !== "string" ||
      !/^\d{4,6}$/.test(manager_pin)
    ) {
      return res
        .status(400)
        .json({ error: "Проверьте пользователя и PIN-коды (новый — 6 цифр)." });
    }

    // Такую же проверку применяем при обычной регистрации.
    if (
      /^(\d)\1{5}$/.test(new_pin) ||
      ["123456", "654321", "012345"].includes(new_pin)
    ) {
      return res
        .status(400)
        .json({ error: "Придумайте менее очевидный новый PIN." });
    }

    // Самому себе и другим менеджерам сбрасывать PIN в этой форме нельзя.
    if (customerId === Number(req.user.id)) {
      return res
        .status(403)
        .json({ error: "Через этот инструмент нельзя сбросить свой PIN." });
    }

    try {
      const managerResult = await pool.query(
        "SELECT pin_code FROM customers WHERE id = $1 AND is_manager = TRUE",
        [req.user.id],
      );
      if (
        !managerResult.rowCount ||
        !(await verifyPin(manager_pin, managerResult.rows[0].pin_code))
      ) {
        return res.status(403).json({ error: "Неверный PIN менеджера." });
      }

      const hashedNewPin = await hashPin(new_pin);
      const result = await pool.query(
        `UPDATE customers
         SET pin_code = $1
         WHERE id = $2 AND phone_number = $3 AND COALESCE(is_manager, FALSE) = FALSE
         RETURNING id, name, phone_number`,
        [hashedNewPin, customerId, phone],
      );

      if (!result.rowCount) {
        return res.status(409).json({
          error:
            "Пользователь не найден, данные изменились или это менеджер. Найдите его заново.",
        });
      }

      // PIN не записываем ни в логи, ни в ответ API.
      return res.json({ success: true, customer: result.rows[0] });
    } catch (error) {
      console.error("Ошибка административного сброса PIN:", error);
      return res.status(500).json({ error: "Не удалось изменить PIN." });
    }
  },
);

// 1. Получить настройки и статус менеджера
app.get("/api/manager/settings", checkAuth, checkManager, (req, res) => {
  res.json(appSettings);
});

// 2. Обновить настройки

app.post("/api/manager/settings", checkAuth, checkManager, (req, res) => {
  try {
    const {
      goal_amount,
      deadline_hour,
      discount_percent,
      delivery_service_fee,
    } = req.body ?? {};

    // Проверяем, что все поля действительно переданы.
    if (
      [goal_amount, deadline_hour, discount_percent, delivery_service_fee].some(
        (value) => value == null || value === "",
      )
    ) {
      return res.status(400).json({
        error: "Заполните все настройки",
      });
    }

    const goal = Number(goal_amount);
    const deadline = Number(deadline_hour);
    const discount = Number(discount_percent);
    const fee = Number(delivery_service_fee);

    if (
      !Number.isFinite(goal) ||
      goal <= 0 ||
      goal > 10000000 ||
      !Number.isInteger(deadline) ||
      deadline < 0 ||
      deadline > 23 ||
      !Number.isFinite(discount) ||
      discount < 0 ||
      discount >= 100 ||
      !Number.isFinite(fee) ||
      fee < 0 ||
      fee > 100000 ||
      !Number.isInteger(Math.round(fee * 100))
    ) {
      return res.status(400).json({
        error: "Некорректные значения настроек",
      });
    }

    appSettings = {
      ...appSettings,
      ORGANIZATION_GOAL_AMOUNT: goal,
      ORDER_DEADLINE_HOUR: deadline,
      COUPON_DISCOUNT_PERCENT: discount,
      DELIVERY_SERVICE_FEE: fee,
    };

    return res.json({
      success: true,
      message: "Настройки обновлены",
      settings: appSettings,
    });
  } catch (error) {
    console.error("Ошибка сохранения настроек:", error);

    return res.status(500).json({
      error: "Не удалось сохранить настройки",
    });
  }
});

app.get("/api/manager/orders", checkAuth, checkManager, async (req, res) => {
  try {
    const page = Math.max(
      1,
      Math.min(1000000, Number.parseInt(req.query.page, 10) || 1),
    );

    const pageSize = 50;

    const status = String(req.query.status || "").trim();
    const search = String(req.query.q || "")
      .trim()
      .slice(0, 100);

    if (
      status &&
      !["pending_payment", "active", "cancelled"].includes(status)
    ) {
      return res.status(400).json({
        error: "Недопустимый фильтр статуса",
      });
    }

    const offset = (page - 1) * pageSize;

    const filters = `
        WHERE
          ($1::text = '' OR o.status = $1)
          AND (
            $2::text = ''
            OR o.id::text ILIKE '%' || $2 || '%'
            OR COALESCE(c.name, '') ILIKE '%' || $2 || '%'
            OR COALESCE(c.phone_number, '') ILIKE '%' || $2 || '%'
            OR COALESCE(o.guest_name, '') ILIKE '%' || $2 || '%'
            OR COALESCE(o.guest_phone, '') ILIKE '%' || $2 || '%'
            OR COALESCE(org.name, '') ILIKE '%' || $2 || '%'
            OR COALESCE(o.delivery_comment, '') ILIKE '%' || $2 || '%'
            OR COALESCE(o.yookassa_payment_id, '') ILIKE '%' || $2 || '%'
          )
      `;

    const joins = `
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN organizations org
          ON org.id = o.organization_id
      `;

    const [ordersRes, countRes, summaryRes] = await Promise.all([
      pool.query(
        `
            SELECT
              o.id AS order_id,
              o.customer_id,
              COALESCE(c.name, o.guest_name, 'Не указан') AS customer_name,
              COALESCE(c.phone_number, o.guest_phone) AS phone_number,
              (o.customer_id IS NULL) AS is_guest,
              COALESCE(org.name, 'Без организации')
                AS organization_name,

              o.created_at,
              o.delivery_date::text AS delivery_date,
              o.status,
              o.total_price,
              o.delivery_fee,
              o.used_coupon,
              o.coupon_deducted,
              o.delivery_comment,
              o.yookassa_payment_id,

              COALESCE(
                (
                  SELECT json_agg(
                    json_build_object(
                      'name', oi.dish_name,
                      'quantity', oi.quantity,
                      'price', oi.price
                    )
                    ORDER BY oi.id
                  )
                  FROM order_items oi
                  WHERE oi.order_id = o.id
                ),
                '[]'::json
              ) AS items

            ${joins}
            ${filters}

            ORDER BY o.created_at DESC, o.id DESC
            LIMIT $3 OFFSET $4
            `,
        [status, search, pageSize, offset],
      ),

      pool.query(
        `
            SELECT COUNT(*)::integer AS total
            ${joins}
            ${filters}
            `,
        [status, search],
      ),

      pool.query(
        `
            SELECT
              COUNT(*)::integer AS all_orders,
              COUNT(*) FILTER (
                WHERE status = 'active'
              )::integer AS paid_orders,
              COUNT(*) FILTER (
                WHERE status = 'pending_payment'
              )::integer AS pending_orders,
              COUNT(*) FILTER (
                WHERE status = 'cancelled'
              )::integer AS cancelled_orders
            FROM orders
            `,
      ),
    ]);

    return res.json({
      orders: ordersRes.rows,
      total: countRes.rows[0].total,
      page,
      page_size: pageSize,
      summary: summaryRes.rows[0],
    });
  } catch (error) {
    console.error("Ошибка заказов менеджера:", error);

    return res.status(500).json({
      error: "Не удалось получить заказы",
    });
  }
});

app.get("/api/manager/dishes", checkAuth, checkManager, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          id,
          name,
          category,
          price,
          weight,
          description,
          image_url,
          quantity,
          is_available
        FROM dishes
        ORDER BY is_available DESC, category, name, id
        `,
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Ошибка получения блюд:", error);

    return res.status(500).json({
      error: "Не удалось получить меню",
    });
  }
});

app.patch(
  "/api/manager/dishes/:id/quantity",
  checkAuth,
  checkManager,
  async (req, res) => {
    try {
      const dishId = Number(req.params.id);
      const quantity = req.body?.quantity;

      if (
        !Number.isSafeInteger(dishId) ||
        dishId <= 0 ||
        !Number.isSafeInteger(quantity) ||
        quantity < 0 ||
        quantity > 1000000
      ) {
        return res.status(400).json({
          error: "Некорректное количество или ID блюда",
        });
      }

      const result = await pool.query(
        `
        UPDATE dishes
        SET quantity = $1
        WHERE id = $2
        RETURNING id, name, quantity
        `,
        [quantity, dishId],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: "Блюдо не найдено",
        });
      }

      return res.json({
        success: true,
        dish: result.rows[0],
      });
    } catch (error) {
      console.error("Ошибка изменения количества:", error);

      return res.status(500).json({
        error: "Не удалось изменить количество",
      });
    }
  },
);

app.delete(
  "/api/manager/dishes/:id",
  checkAuth,
  checkManager,
  async (req, res) => {
    try {
      const dishId = Number(req.params.id);

      if (!Number.isSafeInteger(dishId) || dishId <= 0) {
        return res.status(400).json({
          error: "Некорректный ID блюда",
        });
      }

      const result = await pool.query(
        `
        UPDATE dishes
        SET is_available = FALSE
        WHERE id = $1
        RETURNING id, name, is_available
        `,
        [dishId],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: "Блюдо не найдено",
        });
      }

      return res.json({
        success: true,
        message: "Блюдо скрыто из меню",
        dish: result.rows[0],
      });
    } catch (error) {
      console.error("Ошибка скрытия блюда:", error);

      return res.status(500).json({
        error: "Не удалось скрыть блюдо",
      });
    }
  },
);

app.patch(
  "/api/manager/dishes/:id/visibility",
  checkAuth,
  checkManager,
  async (req, res) => {
    try {
      const dishId = Number(req.params.id);
      const isAvailable = req.body?.is_available;

      if (
        !Number.isSafeInteger(dishId) ||
        dishId <= 0 ||
        typeof isAvailable !== "boolean"
      ) {
        return res.status(400).json({
          error: "Некорректные данные",
        });
      }

      const result = await pool.query(
        `
        UPDATE dishes
        SET is_available = $1
        WHERE id = $2
        RETURNING id, name, is_available
        `,
        [isAvailable, dishId],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          error: "Блюдо не найдено",
        });
      }

      return res.json({
        success: true,
        dish: result.rows[0],
      });
    } catch (error) {
      console.error("Ошибка видимости блюда:", error);

      return res.status(500).json({
        error: "Не удалось изменить видимость блюда",
      });
    }
  },
);

app.post(
  "/api/manager/dishes",
  checkAuth,
  checkManager,

  // Используем твой существующий multer upload.
  (req, res, next) => {
    upload.single("image")(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        return res.status(400).json({
          error:
            error.code === "LIMIT_FILE_SIZE"
              ? "Максимальный размер фотографии — 5 МБ"
              : error.message,
        });
      }

      if (error) {
        return res.status(400).json({
          error: error.message,
        });
      }

      next();
    });
  },

  async (req, res) => {
    try {
      const { name, category, price, weight, description, quantity } =
        req.body ?? {};

      const dishName = String(name ?? "").trim();
      const dishCategory = String(category ?? "").trim();
      const dishWeight = String(weight ?? "").trim();
      const dishDescription = String(description ?? "").trim();

      const dishPrice = Number(price);
      const dishQuantity = Number(quantity);

      if (
        !dishName ||
        dishName.length > 255 ||
        !dishCategory ||
        dishCategory.length > 100
      ) {
        return res.status(400).json({
          error: "Проверьте название и категорию блюда",
        });
      }

      if (
        price == null ||
        !/^\d+(\.\d{1,2})?$/.test(String(price)) ||
        !Number.isFinite(dishPrice) ||
        dishPrice <= 0 ||
        dishPrice > 99999999
      ) {
        return res.status(400).json({
          error: "Укажите корректную цену блюда",
        });
      }

      if (
        quantity == null ||
        String(quantity).trim() === "" ||
        !Number.isSafeInteger(dishQuantity) ||
        dishQuantity < 0 ||
        dishQuantity > 1000000
      ) {
        return res.status(400).json({
          error: "Количество должно быть целым числом от 0",
        });
      }

      if (dishWeight.length > 100 || dishDescription.length > 2000) {
        return res.status(400).json({
          error: "Слишком длинное описание или вес блюда",
        });
      }

      const imageUrl = req.file?.filename ?? "default.jpg";

      const result = await pool.query(
        `
        INSERT INTO dishes (
          name,
          category,
          price,
          weight,
          description,
          image_url,
          quantity,
          is_available
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
        RETURNING id, name, category, price, quantity, is_available
        `,
        [
          dishName,
          dishCategory,
          dishPrice.toFixed(2),
          dishWeight || "стандарт",
          dishDescription,
          imageUrl,
          dishQuantity,
        ],
      );

      return res.status(201).json({
        success: true,
        dish: result.rows[0],
      });
    } catch (error) {
      console.error("Ошибка добавления блюда:", error);

      return res.status(500).json({
        error: "Не удалось добавить блюдо",
      });
    }
  },
);
// ЭТО ФРАГМЕНТ ДЛЯ ВСТАВКИ В СУЩЕСТВУЮЩИЙ server.js.
// Не подключай как отдельный Node-сервер: он использует существующие app, pool, checkAuth.
// В начале server.js добавь ОДИН раз:
// const { randomInt } = require('node:crypto');

// Сегодняшняя попытка по календарю Якутска (UTC+9).
const BITE_WIN_CHANCE_PERCENT = 15; // 15% шанс выигрыша

app.get("/api/bite-game/today", checkAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         ((NOW() AT TIME ZONE 'Asia/Yakutsk')::date)::text AS today,
         ((NOW() AT TIME ZONE 'Asia/Yakutsk')::date + 1)::text AS next_date,
         a.won,
         EXISTS (
           SELECT 1
           FROM orders AS paid_order
           WHERE paid_order.customer_id = c.id
             AND paid_order.status = 'active'
         ) AS eligible
       FROM customers AS c
       LEFT JOIN daily_bite_attempts AS a
         ON a.customer_id = c.id
        AND a.attempt_date = (NOW() AT TIME ZONE 'Asia/Yakutsk')::date
       WHERE c.id = $1`,
      [req.user.id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    const record = result.rows[0];
    return res.json({
      played: record.won !== null,
      won: record.won === true,
      eligible: record.eligible === true,
      today: record.today,
      next_date: record.next_date,
      chance_percent: BITE_WIN_CHANCE_PERCENT,
    });
  } catch (error) {
    console.error("Не удалось получить статус «Откусить!»:", error);
    return res.status(500).json({ error: "Не удалось загрузить игру" });
  }
});

// Одна попытка в день после первого оплаченного заказа; купон выдаётся атомарно.
app.post("/api/bite-game/play", checkAuth, async (req, res) => {
  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    // Дата вычисляется сервером, не передаётся браузером.
    const dayResult = await client.query(
      `SELECT ((NOW() AT TIME ZONE 'Asia/Yakutsk')::date)::text AS today,
              ((NOW() AT TIME ZONE 'Asia/Yakutsk')::date + 1)::text AS next_date`,
    );
    const { today, next_date: nextDate } = dayResult.rows[0];

    // Проверка исключительно на сервере: одного успешного платежа
    // зарегистрированного покупателя достаточно для пожизненного доступа к игре.
    // Проверяем ДО генерации результата и создания ежедневной попытки.
    const accessResult = await client.query(
      `SELECT
         EXISTS (SELECT 1 FROM customers WHERE id = $1) AS customer_exists,
         EXISTS (
           SELECT 1 FROM orders
           WHERE customer_id = $1 AND status = 'active'
         ) AS eligible`,
      [req.user.id],
    );
    const access = accessResult.rows[0];

    if (!access.customer_exists) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    if (!access.eligible) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(403).json({
        code: "BITE_FIRST_ORDER_REQUIRED",
        eligible: false,
        error:
          "Сначала оплати свой первый заказ, чтобы открыть игру «Откусить!»",
      });
    }

    // 0...99: выигрыш, если результат меньше заданного процента.
    const rolledWin = randomInt(100) < BITE_WIN_CHANCE_PERCENT;

    const insertResult = await client.query(
      `INSERT INTO daily_bite_attempts (customer_id, attempt_date, won)
       SELECT c.id, $2::date, $3::boolean
       FROM customers AS c
       WHERE c.id = $1
       ON CONFLICT (customer_id, attempt_date) DO NOTHING
       RETURNING won`,
      [req.user.id, today, rolledWin],
    );

    if (insertResult.rowCount === 0) {
      // Повторный клик/запрос: возвращаем УЖЕ записанный результат.
      const oldResult = await client.query(
        `SELECT won
         FROM daily_bite_attempts
         WHERE customer_id = $1 AND attempt_date = $2::date`,
        [req.user.id, today],
      );

      if (oldResult.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(404).json({ error: "Пользователь не найден" });
      }

      await client.query("COMMIT");
      transactionStarted = false;
      return res.json({
        played: true,
        already_played: true,
        won: oldResult.rows[0].won === true,
        next_date: nextDate,
      });
    }

    // Только первая попытка дня может выдать один купон.
    if (rolledWin) {
      const creditResult = await client.query(
        `UPDATE customers
         SET coupons_count = COALESCE(coupons_count, 0) + 1
         WHERE id = $1
         RETURNING coupons_count`,
        [req.user.id],
      );
      if (creditResult.rowCount !== 1) {
        throw new Error("Не удалось начислить выигранный купон");
      }
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return res.json({
      played: true,
      already_played: false,
      won: rolledWin,
      awarded_coupons: rolledWin ? 1 : 0,
      next_date: nextDate,
    });
  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        console.error("Ошибка ROLLBACK игры:", rollbackError);
      });
    }
    console.error("Ошибка «Откусить!»:", error);
    return res
      .status(500)
      .json({ error: "Розыгрыш не удался. Попробуйте ещё раз" });
  } finally {
    if (client) client.release();
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен и слушает порт ${PORT}`);
});
