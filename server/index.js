import "dotenv/config";
import cors from "cors";
import express from "express";

import {
  SESSION_COOKIE,
  authenticateUser,
  bootstrapAdminUser,
  createSession,
  createUser,
  deleteSession,
  ensureAuthSchema,
  getSessionCookieOptions,
  getUserById,
  getUserBySessionToken,
  listActiveUsers,
  listUsers,
  readSessionCookie,
  resetUserPassword,
  updateUser
} from "./auth-repository.js";
import {
  ensureNotificationSchema,
  listNotifications,
  markNotificationsRead
} from "./notification-repository.js";
import { ensureSchema, getStateRecord, migrateLegacyStateToAdmin, saveStateRecord } from "./state-repository.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const corsOrigin = process.env.CORS_ORIGIN || true;

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));

function sendUser(response, user) {
  response.json({ user });
}

function sendLogin(response, user, sessionToken) {
  response.json({ user, sessionToken });
}

async function requireAuth(request, response, next) {
  try {
    const authHeader = request.headers.authorization || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const cookieToken = readSessionCookie(request);
    let token = bearerToken;
    let user = token ? await getUserBySessionToken(token) : null;

    if (!user && cookieToken && cookieToken !== token) {
      token = cookieToken;
      user = await getUserBySessionToken(cookieToken);
    }

    if (!user) {
      response.status(401).json({ message: "Authentication required." });
      return;
    }

    request.sessionToken = token;
    request.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(request, response, next) {
  if (request.user?.role !== "admin") {
    response.status(403).json({ message: "Admin permission required." });
    return;
  }
  next();
}

async function resolveStateUserId(request, response) {
  const requestedUserId = Number(request.query.userId || request.body?.userId || request.user.id);
  if (!Number.isInteger(requestedUserId) || requestedUserId <= 0) {
    response.status(400).json({ message: "Invalid userId." });
    return null;
  }

  if (requestedUserId !== request.user.id && request.user.role !== "admin") {
    response.status(403).json({ message: "Cannot access another user's workspace." });
    return null;
  }

  const target = await getUserById(requestedUserId);
  if (!target) {
    response.status(404).json({ message: "User not found." });
    return null;
  }

  return target.id;
}

app.get("/api/health", async (_request, response) => {
  response.json({
    ok: true,
    service: "work-manager-api",
    time: new Date().toISOString()
  });
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
    const { username, password } = request.body || {};
    const user = await authenticateUser(username, password);
    if (!user) {
      response.status(401).json({ message: "Username or password is incorrect." });
      return;
    }

    const session = await createSession(user.id);
    response.cookie(SESSION_COOKIE, session.token, getSessionCookieOptions());
    sendLogin(response, user, session.token);
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", requireAuth, async (request, response, next) => {
  try {
    await deleteSession(request.sessionToken);
    response.clearCookie(SESSION_COOKIE, { path: "/" });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuth, async (request, response) => {
  sendLogin(response, request.user, request.sessionToken);
});

app.get("/api/state", requireAuth, async (request, response, next) => {
  try {
    const userId = await resolveStateUserId(request, response);
    if (!userId) return;
    const record = await getStateRecord(userId);
    response.json(record);
  } catch (error) {
    next(error);
  }
});

app.put("/api/state", requireAuth, async (request, response, next) => {
  try {
    const { state, baseRevision = 0 } = request.body || {};
    if (!state || typeof state !== "object") {
      response.status(400).json({ message: "Request body.state is required." });
      return;
    }

    const userId = await resolveStateUserId(request, response);
    if (!userId) return;
    const saved = await saveStateRecord(userId, state, baseRevision, { actorUserId: request.user.id });
    response.json(saved);
  } catch (error) {
    if (error?.code === "REVISION_CONFLICT") {
      response.status(409).json({
        message: "State revision conflict.",
        ...error.latest
      });
      return;
    }

    next(error);
  }
});

app.get("/api/users", requireAuth, async (_request, response, next) => {
  try {
    response.json({ users: await listActiveUsers() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/notifications", requireAuth, async (request, response, next) => {
  try {
    response.json(await listNotifications(request.user.id, { limit: request.query.limit }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/notifications/read", requireAuth, async (request, response, next) => {
  try {
    await markNotificationsRead(request.user.id, request.body?.ids);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (_request, response, next) => {
  try {
    response.json({ users: await listUsers() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/users", requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const user = await createUser(request.body || {});
    response.status(201).json({ user });
  } catch (error) {
    if (["INVALID_USERNAME", "INVALID_PASSWORD", "USERNAME_EXISTS"].includes(error?.code)) {
      response.status(400).json({ message: error.message });
      return;
    }
    next(error);
  }
});

app.patch("/api/admin/users/:id", requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const userId = Number(request.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      response.status(400).json({ message: "Invalid user id." });
      return;
    }

    const user = await updateUser(userId, request.body || {});
    response.json({ user });
  } catch (error) {
    if (error?.code === "USER_NOT_FOUND") {
      response.status(404).json({ message: error.message });
      return;
    }
    next(error);
  }
});

app.post("/api/admin/users/:id/password", requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const userId = Number(request.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      response.status(400).json({ message: "Invalid user id." });
      return;
    }

    const user = await resetUserPassword(userId, request.body?.password);
    response.json({ user });
  } catch (error) {
    if (["INVALID_PASSWORD", "USER_NOT_FOUND"].includes(error?.code)) {
      response.status(error.code === "USER_NOT_FOUND" ? 404 : 400).json({ message: error.message });
      return;
    }
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  if (error?.status && error.status < 500) {
    response.status(error.status).json({
      message: error.message || "Bad request."
    });
    return;
  }

  response.status(500).json({
    message: "Internal server error."
  });
});

await ensureAuthSchema();
await bootstrapAdminUser();
await ensureNotificationSchema();
await ensureSchema();
await migrateLegacyStateToAdmin();

app.listen(port, () => {
  console.log(`work-manager api listening on :${port}`);
});
