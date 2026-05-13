export const GIST_ID_KEY = "work-mgr-server-workspace";
export const SESSION_TOKEN_KEY = "work-mgr-server-sync-session";

const REVISION_KEY_PREFIX = "work-mgr-server-revision";
export const DEFAULT_WORKSPACE_ID = "primary";
const CONNECTED_SESSION = "server-sync";

function normalizeApiBase(base) {
  if (!base) return "/api";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function getApiBase() {
  return normalizeApiBase(globalThis.window?.WORK_MANAGER_API_BASE || "/api");
}

function getAuthToken() {
  const token = sessionStorage.getItem(SESSION_TOKEN_KEY) || "";
  if (token === CONNECTED_SESSION || token === "session") {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    return "";
  }
  return token;
}

function writeAuthToken(token) {
  if (token) {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  }
}

function revisionKey(workspaceId = DEFAULT_WORKSPACE_ID) {
  return `${REVISION_KEY_PREFIX}:${workspaceId || DEFAULT_WORKSPACE_ID}`;
}

function readStoredRevision(workspaceId) {
  const raw = localStorage.getItem(revisionKey(workspaceId));
  return raw ? Number(raw) || 0 : 0;
}

function writeStoredRevision(workspaceId, revision) {
  if (typeof revision !== "number" || Number.isNaN(revision)) return;
  localStorage.setItem(revisionKey(workspaceId), String(revision));
}

function statePath(workspaceId) {
  if (!workspaceId || workspaceId === DEFAULT_WORKSPACE_ID) return "/state";
  return `/state?userId=${encodeURIComponent(workspaceId)}`;
}

export async function request(path, options = {}) {
  const authToken = getAuthToken();
  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {})
    }
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.message || `Request failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function createEmptyRemoteState() {
  return {
    schemaVersion: 4,
    _lastModified: 0,
    categories: [],
    tasks: [],
    archivedTasks: []
  };
}

export async function login(username, password) {
  const json = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  writeAuthToken(json.sessionToken);
  return json.user;
}

export async function logout() {
  await request("/auth/logout", { method: "POST" });
}

export async function getCurrentUser() {
  const json = await request("/auth/me");
  writeAuthToken(json.sessionToken);
  return json.user;
}

export async function listAdminUsers() {
  const json = await request("/admin/users");
  return json.users || [];
}

export async function listMentionUsers() {
  const json = await request("/users");
  return json.users || [];
}

export async function createAdminUser(data) {
  const json = await request("/admin/users", {
    method: "POST",
    body: JSON.stringify(data)
  });
  return json.user;
}

export async function updateAdminUser(userId, data) {
  const json = await request(`/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(data)
  });
  return json.user;
}

export async function deleteAdminUser(userId) {
  const json = await request(`/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE"
  });
  return json.user;
}

export async function resetAdminUserPassword(userId, password) {
  const json = await request(`/admin/users/${encodeURIComponent(userId)}/password`, {
    method: "POST",
    body: JSON.stringify({ password })
  });
  return json.user;
}

export async function listNotifications(limit = 50) {
  const json = await request(`/notifications?limit=${encodeURIComponent(limit)}`);
  return {
    notifications: json.notifications || [],
    unreadCount: Number(json.unreadCount || 0)
  };
}

export async function markNotificationsRead(ids = []) {
  await request("/notifications/read", {
    method: "POST",
    body: JSON.stringify({ ids })
  });
}

export async function completeNotification(notificationId) {
  await request(`/notifications/${encodeURIComponent(notificationId)}/complete`, {
    method: "POST"
  });
}

export async function completeMentionTask(userId, taskId) {
  const json = await request("/mentions/task-complete", {
    method: "POST",
    body: JSON.stringify({ userId, taskId })
  });
  return json.completedCount || 0;
}

export async function completeMentionPlan(userId, taskId, day, index) {
  const json = await request("/mentions/plan-complete", {
    method: "POST",
    body: JSON.stringify({ userId, taskId, day, index })
  });
  return json.completedCount || 0;
}

export async function gistCreate(_token, data) {
  const workspaceId = DEFAULT_WORKSPACE_ID;
  const json = await request(statePath(workspaceId), {
    method: "PUT",
    body: JSON.stringify({
      state: data,
      baseRevision: readStoredRevision(workspaceId)
    })
  });

  writeStoredRevision(workspaceId, json.revision || 0);
  return workspaceId;
}

export async function gistUpdate(_token, workspaceId, data) {
  const targetWorkspaceId = workspaceId || DEFAULT_WORKSPACE_ID;

  async function putState() {
    return request(statePath(targetWorkspaceId), {
      method: "PUT",
      body: JSON.stringify({
        state: data,
        baseRevision: readStoredRevision(targetWorkspaceId)
      })
    });
  }

  let json;
  try {
    json = await putState();
  } catch (error) {
    if (error?.status !== 409 || typeof error?.payload?.revision !== "number") {
      throw error;
    }

    writeStoredRevision(targetWorkspaceId, error.payload.revision);
    json = await putState();
  }

  writeStoredRevision(targetWorkspaceId, json.revision || 0);
  return true;
}

export async function gistLoad(_token, workspaceId) {
  const targetWorkspaceId = workspaceId || DEFAULT_WORKSPACE_ID;
  const json = await request(statePath(targetWorkspaceId));
  writeStoredRevision(targetWorkspaceId, json?.revision || 0);
  return json?.state || createEmptyRemoteState();
}

export function getSessionToken() {
  return getAuthToken();
}

export function setSessionToken(token) {
  writeAuthToken(token || CONNECTED_SESSION);
}

export function clearSessionToken() {
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

export function getSavedGistId() {
  return localStorage.getItem(GIST_ID_KEY) || "";
}

export function setSavedGistId(gistId) {
  localStorage.setItem(GIST_ID_KEY, gistId || DEFAULT_WORKSPACE_ID);
}

export function clearSavedGistId() {
  localStorage.removeItem(GIST_ID_KEY);
}
