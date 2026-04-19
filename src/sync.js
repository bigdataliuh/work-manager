export const GIST_ID_KEY = "work-mgr-gist-id";
export const SESSION_TOKEN_KEY = "work-mgr-gist-token-session";

async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json();
}

export async function gistCreate(token, data) {
  const json = await request("https://api.github.com/gists", {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      description: "工作管理系统数据备份",
      public: false,
      files: {
        "work-manager-data.json": {
          content: JSON.stringify(data)
        }
      }
    })
  });
  return json.id;
}

export async function gistUpdate(token, gistId, data) {
  await request(`https://api.github.com/gists/${gistId}`, {
    method: "PATCH",
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      files: {
        "work-manager-data.json": {
          content: JSON.stringify(data)
        }
      }
    })
  });
  return true;
}

export async function gistLoad(token, gistId) {
  const json = await request(`https://api.github.com/gists/${gistId}`, {
    headers: {
      Authorization: `token ${token}`
    }
  });

  const raw = json.files?.["work-manager-data.json"]?.content;
  return raw ? JSON.parse(raw) : null;
}

export function getSessionToken() {
  return sessionStorage.getItem(SESSION_TOKEN_KEY) || "";
}

export function setSessionToken(token) {
  if (!token) return;
  sessionStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearSessionToken() {
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
}

export function getSavedGistId() {
  return localStorage.getItem(GIST_ID_KEY) || "";
}

export function setSavedGistId(gistId) {
  if (!gistId) return;
  localStorage.setItem(GIST_ID_KEY, gistId);
}

export function clearSavedGistId() {
  localStorage.removeItem(GIST_ID_KEY);
}
