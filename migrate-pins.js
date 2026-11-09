"use strict";
// Запускать после pm2 stop obedayut: node migrate-pins.js
require("dotenv").config();
const { Pool } = require("pg");
const { hashPin } = require("./pin-security");

const pool = new Pool({
  user: process.env.DB_USER,
  host: "localhost",
  database: process.env.DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

async function run() {
  const list = await pool.query("SELECT id, pin_code FROM customers ORDER BY id");
  let updated = 0;
  for (const row of list.rows) {
    if (row.pin_code.startsWith("scrypt-v1:")) continue;
    const hash = await hashPin(row.pin_code);
    const result = await pool.query(
      "UPDATE customers SET pin_code = $1 WHERE id = $2 AND pin_code = $3",
      [hash, row.id, row.pin_code],
    );
    updated += result.rowCount;
  }
  console.log(`Обновлено PIN-кодов: ${updated}. Всего пользователей: ${list.rowCount}.`);
}
run().catch((err) => {
  console.error("Ошибка миграции PIN:", err);
  process.exitCode = 1;
}).finally(() => pool.end());
