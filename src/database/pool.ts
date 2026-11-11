import { Pool } from "pg";

type myPool = {
  user: string;
  host: string;
  database: string;
  password: string;
  port: number;
};

export const createDatabase = (): Pool => {
  if (!process.env.DB_USER) {
    throw new Error("Ошибка укажи в env юзера для подкл к БД");
  }

  if (!process.env.DATABASE) {
    throw new Error("Укажи название базы в env");
  }

  if (!process.env.DB_PASSWORD) {
    throw new Error("Пароль БД не указан");
  }

  if (!process.env.DB_PORT) {
    throw new Error("Укажи порт");
  }

  const config: myPool = {
    user: process.env.DB_USER,
    host: "localhost",
    database: process.env.DATABASE,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 5432,
  };
  const pool = new Pool(config);
  return pool;
};
