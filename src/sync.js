export const GIST_ID_KEY = "work-mgr-server-workspace";
export const SESSION_TOKEN_KEY = "work-mgr-server-sync-session";

const REVISION_KEY = "work-mgr-server-revision";
export const DEFAULT_WORKSPACE_ID = "primary";
const CONNECTED_SESSION = "server-sync";

function normalizeApiBase(base) {
  if (!base) return "/api";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function getApiBase() {
  return normalizeApiBase(globalThis.window?.WORK_MANAGER_API_BASE || "/api");
}

function readStoredRevision() {
  const raw = localStorage.getItem(REVISION_KEY);
  return raw ? Number(raw) || 0 : 0;
}

function writeStoredRevision(revision) {
  if (typeof revision !== "number" || Number.isNaN(revision)) return;
  localStorage.setItem(REVISION_KEY, String(revision));
}

async function request(path, options = {}) {
  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
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
    schemaVersion: 3,
    _lastModified: 0,
    tasks: [],
    archivedTasks: []
  };
}

export async function gistCreate(_token, data) {
  const json = await request("/state", {
    method: "PUT",
    body: JSON.stringify({
      state: data,
      baseRevision: readStoredRevision()
    })
  });

  writeStoredRevision(json.revision || 0);
  return DEFAULT_WORKSPACE_ID;
}

export async function gistUpdate(_token, _gistId, data) {
  const json = await request("/state", {
    method: "PUT",
    body: JSON.stringify({
      state: data,
      baseRevision: readStoredRevision()
    })
  });

  writeStoredRevision(json.revision || 0);
  return true;
}

export async function gistLoad(_token, _gistId) {
  const json = await request("/state");
  writeStoredRevision(json?.revision || 0);
  return json?.state || createEmptyRemoteState();
}

export function getSessionToken() {
  return sessionStorage.getItem(SESSION_TOKEN_KEY) || (localStorage.getItem(GIST_ID_KEY) ? CONNECTED_SESSION : "");
}

export function setSessionToken(_token) {
  sessionStorage.setItem(SESSION_TOKEN_KEY, CONNECTED_SESSION);
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
