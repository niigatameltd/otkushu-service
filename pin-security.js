"use strict";

// const { randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
// const { promisify } = require("node:util");
import { promisify } from "node:util";
const scryptAsync = promisify(scrypt);

const PREFIX = "scrypt-v1";
const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

export async function hashPin(pin) {
  if (typeof pin !== "string") throw new TypeError("PIN must be a string");
  const salt = randomBytes(16);
  const digest = await scryptAsync(pin, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  // ~78 символов — помещается в customers.pin_code VARCHAR(100).
  return `${PREFIX}:${salt.toString("base64url")}:${digest.toString("base64url")}`;
}

export async function verifyPin(pin, stored) {
  if (typeof pin !== "string" || typeof stored !== "string") return false;
  if (stored.startsWith(`${PREFIX}:`)) {
    const parts = stored.split(":");
    if (parts.length !== 3) return false;
    try {
      const salt = Buffer.from(parts[1], "base64url");
      const expected = Buffer.from(parts[2], "base64url");
      if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
      const actual = await scryptAsync(pin, salt, KEY_LENGTH, SCRYPT_OPTIONS);
      return timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }
  // Переходный период: старые пользователи с открытым PIN.
  const a = Buffer.from(pin, "utf8");
  const b = Buffer.from(stored, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
