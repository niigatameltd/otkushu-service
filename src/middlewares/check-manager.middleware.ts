import type { Pool } from "pg";
import type { Request, Response, NextFunction } from "express";

type AuthRequest = Request & {
  user?: {
    id: number;
  };
};

export const createCheckManager = (pool: Pool) => {
  // буду в server.js DI писать
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
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
  };
};

// async function checkManager(req, res, next) {
//   // Проверяем, авторизован ли пользователь (через req.user, как в других роутах)
//   if (!req.user || !req.user.id) {
//     return res.status(401).json({ error: "Не авторизован" });
//   }
//   try {
//     const result = await pool.query(
//       "SELECT is_manager FROM customers WHERE id = $1",
//       [req.user.id],
//     );
//     if (result.rows.length > 0 && result.rows[0].is_manager) {
//       next(); // Пользователь менеджер — пропускаем
//     } else {
//       res
//         .status(403)
//         .json({ error: "Доступ запрещен. Требуются права менеджера." });
//     }
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Ошибка проверки прав" });
//   }
// }
