import "dotenv/config";
import cors from "cors";
import express from "express";

import {
  SESSION_COOKIE,
  authenticateUser,
  bootstrapAdminUser,
  canAccessUserWorkspace,
  canManageUserAccount,
  createSession,
  createUser,
  deleteSession,
  deleteUser,
  ensureAuthSchema,
  getSessionCookieOptions,
  getUserById,
  getUserBySessionToken,
  isSuperAdmin,
  listActiveUsers,
  listVisibleUsers,
  presentUserForActor,
  readSessionCookie,
  resetUserPassword,
  updateUser
} from "./auth-repository.js";
import {
  completeNotificationSourceById,
  completeNotificationSourceByPlan,
  completeNotificationSourceByTask,
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
  response.json({ user: presentUserForActor(user, user), sessionToken });
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

  const target = await getUserById(requestedUserId);
  if (!target) {
    response.status(404).json({ message: "User not found." });
    return null;
  }

  if (!canAccessUserWorkspace(request.user, target)) {
    response.status(403).json({ message: "Cannot access this workspace." });
    return null;
  }

  return target.id;
}

async function resolveManageableUser(request, response) {
  const userId = Number(request.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    response.status(400).json({ message: "Invalid user id." });
    return null;
  }

  const target = await getUserById(userId);
  if (!target) {
    response.status(404).json({ message: "User not found." });
    return null;
  }

  if (!canManageUserAccount(request.user, target)) {
    response.status(403).json({ message: "Cannot manage this user." });
    return null;
  }

  return target;
}

function normalizeCreateUserBody(actor, body = {}) {
  const normalizedRole = body.role === "admin" ? "admin" : "user";
  if (normalizedRole === "admin" && !isSuperAdmin(actor)) {
    throw Object.assign(new Error("Only admin can create administrator accounts."), { code: "ADMIN_LEVEL_REQUIRED" });
  }

  return {
    ...body,
    role: normalizedRole,
    adminLevel: isSuperAdmin(actor) ? body.adminLevel : undefined
  };
}

function normalizeUpdateUserBody(actor, body = {}) {
  if (!isSuperAdmin(actor) && (body.role === "admin" || body.adminLevel !== undefined)) {
    throw Object.assign(new Error("Only admin can change administrator permissions."), { code: "ADMIN_LEVEL_REQUIRED" });
  }

  return {
    ...body,
    adminLevel: isSuperAdmin(actor) ? body.adminLevel : undefined
  };
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

app.post("/api/notifications/:id/complete", requireAuth, async (request, response, next) => {
  try {
    await completeNotificationSourceById(request.user.id, request.params.id);
    response.json({ ok: true });
  } catch (error) {
    if (["INVALID_NOTIFICATION_ID", "NOTIFICATION_NOT_FOUND"].includes(error?.code)) {
      response.status(error.code === "NOTIFICATION_NOT_FOUND" ? 404 : 400).json({ message: error.message });
      return;
    }
    next(error);
  }
});

app.post("/api/mentions/task-complete", requireAuth, async (request, response, next) => {
  try {
    const userId = await resolveStateUserId(request, response);
    if (!userId) return;

    const completedCount = await completeNotificationSourceByTask({
      actorUserId: request.user.id,
      workspaceUserId: userId,
      taskId: request.body?.taskId
    });
    response.json({ ok: true, completedCount });
  } catch (error) {
    if (error?.code === "INVALID_MENTION_SOURCE") {
      response.status(400).json({ message: error.message });
      return;
    }
    next(error);
  }
});

app.post("/api/mentions/plan-complete", requireAuth, async (request, response, next) => {
  try {
    const userId = await resolveStateUserId(request, response);
    if (!userId) return;

    const completedCount = await completeNotificationSourceByPlan({
      actorUserId: request.user.id,
      workspaceUserId: userId,
      taskId: request.body?.taskId,
      day: request.body?.day,
      index: request.body?.index
    });
    response.json({ ok: true, completedCount });
  } catch (error) {
    if (error?.code === "INVALID_MENTION_SOURCE") {
      response.status(400).json({ message: error.message });
      return;
    }
    next(error);
  }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const users = await listVisibleUsers(request.user);
    response.json({ users: users.map((user) => presentUserForActor(request.user, user)) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/users", requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const user = await createUser(normalizeCreateUserBody(request.user, request.body || {}));
    response.status(201).json({ user: presentUserForActor(request.user, user) });
  } catch (error) {
    if (["INVALID_USERNAME", "INVALID_PASSWORD", "USERNAME_EXISTS", "ADMIN_LEVEL_REQUIRED"].includes(error?.code)) {
      response.status(error.code === "ADMIN_LEVEL_REQUIRED" ? 403 : 400).json({ message: error.message });
      return;
    }
    next(error);
  }
});

app.patch("/api/admin/users/:id", requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const target = await resolveManageableUser(request, response);
    if (!target) return;

    const user = await updateUser(target.id, normalizeUpdateUserBody(request.user, request.body || {}));
    response.json({ user: presentUserForActor(request.user, user) });
  } catch (error) {
    if (["USER_NOT_FOUND", "ADMIN_LEVEL_REQUIRED"].includes(error?.code)) {
      response.status(error.code === "USER_NOT_FOUND" ? 404 : 403).json({ message: error.message });
      return;
    }
    next(error);
  }
});

app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (request, response, next) => {
  try {
    const target = await resolveManageableUser(request, response);
    if (!target) return;

    const user = await deleteUser(target.id);
    response.json({ user: presentUserForActor(request.user, user) });
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
    const target = await resolveManageableUser(request, response);
    if (!target) return;

    const user = await resetUserPassword(target.id, request.body?.password);
    response.json({ user: presentUserForActor(request.user, user) });
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
