type DatabaseConfig = {
  user: string;
  host: string;
  database: string;
  password: string;
  port: number;
};

export const createDatabaseConfig = (): DatabaseConfig => {
  const { DB_USER, DATABASE, DB_PASSWORD, DB_PORT } = process.env;

  if (!DB_USER) {
    throw new Error("DB_USER не указан");
  }

  if (!DATABASE) {
    throw new Error("DATABASE не указана");
  }

  if (!DB_PASSWORD) {
    throw new Error("DB_PASSWORD не указан");
  }

  const port = Number(DB_PORT ?? 5432);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Некорректный DB_PORT");
  }

  return {
    user: DB_USER,
    host: "localhost",
    database: DATABASE,
    password: DB_PASSWORD,
    port,
  };
};
