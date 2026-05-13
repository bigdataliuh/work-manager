import crypto from "node:crypto";
import { promisify } from "node:util";

import { getDbPool } from "./db.js";

export const SESSION_COOKIE = "work_manager_session";

const scryptAsync = promisify(crypto.scrypt);
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 14);

function normalizeUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null
  };
}

function publicUser(row) {
  return normalizeUser(row);
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function normalizeDisplayName(displayName, username) {
  return String(displayName || "").trim() || username;
}

function validateUsername(username) {
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) {
    throw Object.assign(new Error("Invalid username"), {
      code: "INVALID_USERNAME"
    });
  }
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw Object.assign(new Error("Password must be at least 8 characters."), {
      code: "INVALID_PASSWORD"
    });
  }
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function verifyPassword(password, passwordHash) {
  const [scheme, salt, expectedHex] = String(passwordHash || "").split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex) return false;

  const actual = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionExpiresAt() {
  const date = new Date();
  date.setDate(date.getDate() + SESSION_TTL_DAYS);
  return date;
}

export function getSessionCookieOptions() {
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge
  };
}

export async function ensureAuthSchema() {
  const pool = getDbPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      display_name VARCHAR(100) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'user',
      password_hash VARCHAR(255) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      last_login_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_users_role (role),
      INDEX idx_users_active (is_active)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sessions_user_id (user_id),
      INDEX idx_sessions_expires_at (expires_at),
      CONSTRAINT fk_sessions_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

export async function bootstrapAdminUser() {
  const pool = getDbPool();
  const [rows] = await pool.query("SELECT COUNT(*) AS total FROM users");
  if (Number(rows[0]?.total || 0) > 0) return null;

  const username = normalizeUsername(process.env.ADMIN_USERNAME || "admin");
  const password = process.env.ADMIN_PASSWORD || "";
  const displayName = normalizeDisplayName(process.env.ADMIN_DISPLAY_NAME || "Admin", username);

  validateUsername(username);
  if (!password) {
    throw new Error("ADMIN_PASSWORD is required when bootstrapping the first admin user.");
  }
  validatePassword(password);

  const passwordHash = await hashPassword(password);
  const [result] = await pool.query(
    "INSERT INTO users (username, display_name, role, password_hash, is_active) VALUES (?, ?, 'admin', ?, 1)",
    [username, displayName, passwordHash]
  );

  return {
    id: Number(result.insertId),
    username,
    displayName,
    role: "admin",
    isActive: true
  };
}

export async function getFirstAdminUser() {
  const pool = getDbPool();
  const [rows] = await pool.query("SELECT * FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
  return publicUser(rows[0]);
}

export async function authenticateUser(usernameInput, password) {
  if (typeof password !== "string") return null;

  const username = normalizeUsername(usernameInput);
  const pool = getDbPool();
  const [rows] = await pool.query("SELECT * FROM users WHERE username = ? LIMIT 1", [username]);
  const row = rows[0];

  if (!row || !row.is_active) return null;
  const passwordOk = await verifyPassword(password, row.password_hash);
  if (!passwordOk) return null;

  await pool.query("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", [row.id]);
  return publicUser({ ...row, last_login_at: new Date() });
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const expiresAt = sessionExpiresAt();
  const pool = getDbPool();

  await pool.query(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
    [userId, tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

export async function deleteSession(token) {
  if (!token) return;
  const pool = getDbPool();
  await pool.query("DELETE FROM sessions WHERE token_hash = ?", [hashSessionToken(token)]);
}

export async function getUserBySessionToken(token) {
  if (!token) return null;
  const pool = getDbPool();
  const [rows] = await pool.query(
    `SELECT users.*
       FROM sessions
       JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
        AND sessions.expires_at > CURRENT_TIMESTAMP
        AND users.is_active = 1
      LIMIT 1`,
    [hashSessionToken(token)]
  );

  if (!rows.length) return null;
  await pool.query("UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?", [hashSessionToken(token)]);
  return publicUser(rows[0]);
}

export function readSessionCookie(request) {
  const header = request.headers.cookie || "";
  const pairs = header.split(";").map((item) => item.trim()).filter(Boolean);
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    const key = decodeURIComponent(pair.slice(0, index));
    if (key === SESSION_COOKIE) {
      return decodeURIComponent(pair.slice(index + 1));
    }
  }
  return "";
}

export async function listUsers() {
  const pool = getDbPool();
  const [rows] = await pool.query(
    "SELECT * FROM users ORDER BY role = 'admin' DESC, is_active DESC, username ASC"
  );
  return rows.map(publicUser);
}

export async function listActiveUsers() {
  const pool = getDbPool();
  const [rows] = await pool.query(
    "SELECT * FROM users WHERE is_active = 1 ORDER BY display_name ASC, username ASC"
  );
  return rows.map(publicUser);
}

export async function getUserById(userId) {
  const pool = getDbPool();
  const [rows] = await pool.query("SELECT * FROM users WHERE id = ? LIMIT 1", [userId]);
  return publicUser(rows[0]);
}

export async function createUser({ username: usernameInput, displayName: displayNameInput, password, role = "user" }) {
  const username = normalizeUsername(usernameInput);
  validateUsername(username);
  validatePassword(password);

  const normalizedRole = role === "admin" ? "admin" : "user";
  const displayName = normalizeDisplayName(displayNameInput, username);
  const passwordHash = await hashPassword(password);
  const pool = getDbPool();

  try {
    const [result] = await pool.query(
      "INSERT INTO users (username, display_name, role, password_hash, is_active) VALUES (?, ?, ?, ?, 1)",
      [username, displayName, normalizedRole, passwordHash]
    );
    return getUserById(result.insertId);
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      throw Object.assign(new Error("Username already exists."), { code: "USERNAME_EXISTS" });
    }
    throw error;
  }
}

export async function updateUser(userId, { displayName, role, isActive }) {
  const target = await getUserById(userId);
  if (!target) {
    throw Object.assign(new Error("User not found."), { code: "USER_NOT_FOUND" });
  }

  const nextDisplayName = displayName === undefined ? target.displayName : normalizeDisplayName(displayName, target.username);
  const nextRole = role === "admin" ? "admin" : "user";
  const nextActive = isActive === undefined ? target.isActive : Boolean(isActive);
  const pool = getDbPool();

  await pool.query(
    "UPDATE users SET display_name = ?, role = ?, is_active = ? WHERE id = ?",
    [nextDisplayName, nextRole, nextActive ? 1 : 0, userId]
  );

  if (!nextActive) {
    await pool.query("DELETE FROM sessions WHERE user_id = ?", [userId]);
  }

  return getUserById(userId);
}

export async function deleteUser(userId) {
  const target = await getUserById(userId);
  if (!target) {
    throw Object.assign(new Error("User not found."), { code: "USER_NOT_FOUND" });
  }

  const pool = getDbPool();
  await pool.query("DELETE FROM users WHERE id = ?", [userId]);
  return target;
}

export async function resetUserPassword(userId, password) {
  validatePassword(password);

  const target = await getUserById(userId);
  if (!target) {
    throw Object.assign(new Error("User not found."), { code: "USER_NOT_FOUND" });
  }

  const passwordHash = await hashPassword(password);
  const pool = getDbPool();
  await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, userId]);
  await pool.query("DELETE FROM sessions WHERE user_id = ?", [userId]);
  return getUserById(userId);
}
