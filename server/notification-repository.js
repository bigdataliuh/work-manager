import crypto from "node:crypto";

import { getDbPool } from "./db.js";

function normalizeNotification(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceType: row.source_type,
    sourceTitle: row.source_title,
    sourceContent: row.source_content,
    sourceMeta: row.source_meta,
    actorUser: {
      id: row.actor_user_id ? Number(row.actor_user_id) : null,
      username: row.actor_username || "",
      displayName: row.actor_display_name || ""
    },
    workspaceUser: {
      id: row.workspace_user_id ? Number(row.workspace_user_id) : null,
      username: row.workspace_username || "",
      displayName: row.workspace_display_name || ""
    },
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}

function textHash(parts) {
  return crypto
    .createHash("sha256")
    .update(parts.filter(Boolean).join("\n"))
    .digest("hex")
    .slice(0, 20);
}

function normalizeMentionIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

function extractMentionTokens(text) {
  const tokens = new Set();
  const input = String(text || "");
  const pattern = /(^|[\s,，。；;:：、()[\]{}<>《》"'“”‘’])@([^\s@,，。；;:：、()[\]{}<>《》"'“”‘’]+)/g;
  let match;

  while ((match = pattern.exec(input))) {
    const token = normalizeMentionIdentifier(match[2]);
    if (token) tokens.add(token);
  }

  return tokens;
}

function taskText(task = {}) {
  return [task.name, task.responsible, task.participants].filter(Boolean).join("\n");
}

function planText(item = {}) {
  return [item.title, item.content].filter(Boolean).join("\n");
}

function taskSignature(task = {}) {
  return textHash([task.name, task.responsible, task.participants]);
}

function planSignature(item = {}) {
  return textHash([item.title, item.content]);
}

function buildUserMentionMap(users) {
  const map = new Map();
  users.forEach((user) => {
    const username = normalizeMentionIdentifier(user.username);
    const displayName = normalizeMentionIdentifier(user.display_name);
    if (username) map.set(username, user);
    if (displayName) map.set(displayName, user);
  });
  return map;
}

function resolveMentionedUsers(text, mentionMap) {
  const recipients = new Map();
  extractMentionTokens(text).forEach((token) => {
    const user = mentionMap.get(token);
    if (user) recipients.set(Number(user.id), user);
  });
  return recipients;
}

function normalizeTaskMap(state = {}) {
  const map = new Map();
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  tasks.forEach((task) => {
    if (task?.id) map.set(String(task.id), task);
  });
  return map;
}

function normalizePlanMap(task = {}) {
  const map = new Map();
  Object.entries(task.dailyActions || {}).forEach(([day, items]) => {
    if (!Array.isArray(items)) return;
    items.forEach((item, index) => {
      map.set(`${day}:${index}`, { day, index, item });
    });
  });
  return map;
}

async function insertNotification(connection, notification) {
  await connection.query(
    `INSERT IGNORE INTO notifications
      (recipient_user_id, actor_user_id, workspace_user_id, source_type, source_key, source_title, source_content, source_meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      notification.recipientUserId,
      notification.actorUserId,
      notification.workspaceUserId,
      notification.sourceType,
      notification.sourceKey,
      notification.sourceTitle,
      notification.sourceContent,
      notification.sourceMeta
    ]
  );
}

async function notifyMentionedUsers(connection, users, notification) {
  for (const user of users.values()) {
    const recipientUserId = Number(user.id);
    if (recipientUserId === notification.actorUserId) continue;

    await insertNotification(connection, {
      ...notification,
      recipientUserId
    });
  }
}

export async function ensureNotificationSchema() {
  const pool = getDbPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      recipient_user_id INT UNSIGNED NOT NULL,
      actor_user_id INT UNSIGNED NOT NULL,
      workspace_user_id INT UNSIGNED NOT NULL,
      source_type VARCHAR(20) NOT NULL,
      source_key VARCHAR(160) NOT NULL,
      source_title VARCHAR(255) NOT NULL,
      source_content TEXT NOT NULL,
      source_meta VARCHAR(255) NOT NULL DEFAULT '',
      read_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_notifications_recipient_source (recipient_user_id, source_key),
      INDEX idx_notifications_recipient_created (recipient_user_id, created_at),
      INDEX idx_notifications_recipient_read (recipient_user_id, read_at),
      CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_notifications_workspace FOREIGN KEY (workspace_user_id) REFERENCES users(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

export async function createMentionNotifications(connection, { actorUserId, workspaceUserId, beforeState, afterState }) {
  const [users] = await connection.query(
    "SELECT id, username, display_name FROM users WHERE is_active = 1"
  );
  if (!users.length) return;

  const mentionMap = buildUserMentionMap(users);
  const beforeTasks = normalizeTaskMap(beforeState);
  const afterTasks = normalizeTaskMap(afterState);

  for (const [taskId, task] of afterTasks.entries()) {
    const currentTaskText = taskText(task);
    const currentTaskSignature = taskSignature(task);
    const previousTask = beforeTasks.get(taskId);

    if (currentTaskSignature !== taskSignature(previousTask)) {
      const mentionedUsers = resolveMentionedUsers(currentTaskText, mentionMap);
      await notifyMentionedUsers(connection, mentionedUsers, {
        actorUserId,
        workspaceUserId,
        sourceType: "task",
        sourceKey: `${workspaceUserId}:task:${taskId}:${currentTaskSignature}`,
        sourceTitle: task.name || "未命名任务",
        sourceContent: [task.responsible ? `负责人：${task.responsible}` : "", task.participants ? `参与人：${task.participants}` : ""]
          .filter(Boolean)
          .join("\n"),
        sourceMeta: task.category || ""
      });
    }

    const previousPlans = normalizePlanMap(previousTask);
    const currentPlans = normalizePlanMap(task);

    for (const [planKey, plan] of currentPlans.entries()) {
      const currentPlanText = planText(plan.item);
      const currentPlanSignature = planSignature(plan.item);
      const previousPlan = previousPlans.get(planKey);
      if (currentPlanSignature === planSignature(previousPlan?.item)) continue;

      const mentionedUsers = resolveMentionedUsers(currentPlanText, mentionMap);
      await notifyMentionedUsers(connection, mentionedUsers, {
        actorUserId,
        workspaceUserId,
        sourceType: "plan",
        sourceKey: `${workspaceUserId}:plan:${taskId}:${planKey}:${currentPlanSignature}`,
        sourceTitle: task.name || "未命名任务",
        sourceContent: [plan.item?.title, plan.item?.content].filter(Boolean).join("\n"),
        sourceMeta: plan.day
      });
    }
  }
}

export async function listNotifications(userId, { limit = 50 } = {}) {
  const pool = getDbPool();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const [rows] = await pool.query(
    `SELECT notifications.*,
            actor.username AS actor_username,
            actor.display_name AS actor_display_name,
            workspace.username AS workspace_username,
            workspace.display_name AS workspace_display_name
       FROM notifications
       JOIN users actor ON actor.id = notifications.actor_user_id
       JOIN users workspace ON workspace.id = notifications.workspace_user_id
      WHERE notifications.recipient_user_id = ?
      ORDER BY notifications.created_at DESC, notifications.id DESC
      LIMIT ?`,
    [userId, safeLimit]
  );

  const [countRows] = await pool.query(
    "SELECT COUNT(*) AS total FROM notifications WHERE recipient_user_id = ? AND read_at IS NULL",
    [userId]
  );

  return {
    notifications: rows.map(normalizeNotification),
    unreadCount: Number(countRows[0]?.total || 0)
  };
}

export async function markNotificationsRead(userId, ids = []) {
  const pool = getDbPool();
  const safeIds = Array.isArray(ids)
    ? ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];

  if (!safeIds.length) {
    await pool.query(
      "UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE recipient_user_id = ? AND read_at IS NULL",
      [userId]
    );
    return;
  }

  await pool.query(
    "UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE recipient_user_id = ? AND id IN (?)",
    [userId, safeIds]
  );
}
