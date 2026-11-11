import "dotenv/config";
import { createDatabaseConfig } from "./database/config.js";
import { createApp } from "./app.js";
import { Pool } from "pg";
const startServer = async () => {
  let pool;

  try {
    const config = createDatabaseConfig();
    pool = new Pool(config);
    // Проверяем соединение до запуска сервера
    await pool.query("SELECT 1");
    const app = createApp(pool);

    const port = Number(process.env.TS_PORT ?? 3001);

    app.listen(port, () => {
      console.log(`Otkushu 2.0 запущен на порту ${port}`);
    });
  } catch (error) {
    console.error("Ошибка запуска:", error);

    if (pool) {
      await pool.end();
    }

    process.exitCode = 1;
  }
};

startServer();
