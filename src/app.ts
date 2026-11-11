import express from "express";
import cookieParser from "cookie-parser";
import type { Pool } from "pg";
import { createCheckManager } from "./middlewares/check-manager.middleware.js";

export const createApp = (pool: Pool) => {
  const app = express();
  // Доверяем заголовкам X-Forwarded-For только от локального Nginx.
  app.set("trust proxy", "loopback");
  app.use(cookieParser());
  app.use(express.json());

  if (process.env.NODE_ENV === "development") {
    app.use(express.static(import.meta.dirname));
  } // статика от express

  const JWT_SECRET = process.env.JWT_SECRET;

  let appSettings = {
    ORGANIZATION_GOAL_AMOUNT: 1000, // Порог суммы для купонов
    ORDER_DEADLINE_HOUR: 11, // Час дедлайна (12:00)
    COUPON_DISCOUNT_PERCENT: 10,
    DELIVERY_SERVICE_FEE: 49,
  };

  const checkManager = createCheckManager(pool);

  app.get("/", (req, res) => {
    res.status(200).json({ message: "GOOD" });
  });

  return app;
};
