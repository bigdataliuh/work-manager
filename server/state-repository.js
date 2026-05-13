import { getFirstAdminUser } from "./auth-repository.js";
import { getDbPool } from "./db.js";
import { createMentionNotifications } from "./notification-repository.js";

const LEGACY_WORKSPACE_ROW_ID = 1;
const DEFAULT_CATEGORIES = [
  "\u9879\u76ee",
  "\u5546\u52a1",
  "\u5f00\u53d1",
  "\u65e5\u5e38\u4efb\u52a1",
  "\u4e34\u65f6\u4efb\u52a1",
  "\u673a\u5668\u4eba"
];

function normalizeCategoryName(category) {
  if (typeof category !== "string") return "";
  const trimmed = category.trim();
  return trimmed === "\u6d3b\u52a8" ? "\u673a\u5668\u4eba" : trimmed;
}

function normalizeCategories(rawCategories, taskLists = []) {
  const categories = [];
  const seen = new Set();

  function pushCategory(category) {
    const normalized = normalizeCategoryName(category);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    categories.push(normalized);
  }

  if (Array.isArray(rawCategories) && rawCategories.length) {
    rawCategories.forEach(pushCategory);
  } else {
    DEFAULT_CATEGORIES.forEach(pushCategory);
  }

  taskLists.flat().forEach((task) => pushCategory(task?.category));

  return categories.length ? categories : [...DEFAULT_CATEGORIES];
}

function normalizeStateShape(state) {
  if (!state || typeof state !== "object") {
    return {
      schemaVersion: 4,
      _lastModified: 0,
      categories: [...DEFAULT_CATEGORIES],
      tasks: [],
      archivedTasks: []
    };
  }

  const rawTasks = Array.isArray(state.tasks) ? state.tasks : [];
  const rawArchivedTasks = Array.isArray(state.archivedTasks) ? state.archivedTasks : [];

  return {
    schemaVersion: typeof state.schemaVersion === "number" ? state.schemaVersion : 4,
    _lastModified: typeof state._lastModified === "number" ? state._lastModified : Date.now(),
    categories: normalizeCategories(state.categories, [rawTasks, rawArchivedTasks]),
    tasks: rawTasks,
    archivedTasks: rawArchivedTasks
  };
}

export async function ensureSchema() {
  const pool = getDbPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_states (
      user_id INT UNSIGNED NOT NULL PRIMARY KEY,
      data_json LONGTEXT NOT NULL,
      revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_states_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      data_json LONGTEXT NOT NULL,
      revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

export async function migrateLegacyStateToAdmin() {
  const admin = await getFirstAdminUser();
  if (!admin) return;

  const pool = getDbPool();
  const [existingRows] = await pool.query(
    "SELECT user_id FROM user_states WHERE user_id = ? LIMIT 1",
    [admin.id]
  );
  if (existingRows.length) return;

  const [legacyRows] = await pool.query(
    "SELECT data_json, revision FROM app_state WHERE id = ? LIMIT 1",
    [LEGACY_WORKSPACE_ROW_ID]
  );
  if (!legacyRows.length) return;

  const legacy = legacyRows[0];
  await pool.query(
    "INSERT INTO user_states (user_id, data_json, revision) VALUES (?, ?, ?)",
    [admin.id, JSON.stringify(normalizeStateShape(JSON.parse(legacy.data_json))), Number(legacy.revision || 1)]
  );
}

export async function getStateRecord(userId) {
  const pool = getDbPool();
  const [rows] = await pool.query(
    "SELECT data_json, revision, updated_at FROM user_states WHERE user_id = ? LIMIT 1",
    [userId]
  );

  if (!rows.length) {
    return {
      state: normalizeStateShape(null),
      revision: 0,
      updatedAt: null
    };
  }

  const row = rows[0];
  return {
    state: normalizeStateShape(JSON.parse(row.data_json)),
    revision: Number(row.revision || 0),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

export async function saveStateRecord(userId, state, baseRevision, { actorUserId = userId } = {}) {
  const pool = getDbPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      "SELECT data_json, revision, updated_at FROM user_states WHERE user_id = ? FOR UPDATE",
      [userId]
    );

    const normalizedState = normalizeStateShape(state);
    const previousState = rows.length ? normalizeStateShape(JSON.parse(rows[0].data_json)) : normalizeStateShape(null);

    if (!rows.length) {
      if (baseRevision && Number(baseRevision) !== 0) {
        throw Object.assign(new Error("Revision conflict"), {
          code: "REVISION_CONFLICT",
          latest: {
            state: normalizeStateShape(null),
            revision: 0,
            updatedAt: null
          }
        });
      }

      await connection.query(
        "INSERT INTO user_states (user_id, data_json, revision) VALUES (?, ?, 1)",
        [userId, JSON.stringify(normalizedState)]
      );
      await createMentionNotifications(connection, {
        actorUserId,
        workspaceUserId: userId,
        beforeState: previousState,
        afterState: normalizedState
      });

      await connection.commit();
      return {
        state: normalizedState,
        revision: 1,
        updatedAt: new Date().toISOString()
      };
    }

    const currentRow = rows[0];
    const currentRevision = Number(currentRow.revision || 0);

    if (Number(baseRevision || 0) !== currentRevision) {
      throw Object.assign(new Error("Revision conflict"), {
        code: "REVISION_CONFLICT",
        latest: {
          state: previousState,
          revision: currentRevision,
          updatedAt: currentRow.updated_at ? new Date(currentRow.updated_at).toISOString() : null
        }
      });
    }

    const nextRevision = currentRevision + 1;
    await connection.query(
      "UPDATE user_states SET data_json = ?, revision = ? WHERE user_id = ?",
      [JSON.stringify(normalizedState), nextRevision, userId]
    );
    await createMentionNotifications(connection, {
      actorUserId,
      workspaceUserId: userId,
      beforeState: previousState,
      afterState: normalizedState
    });

    await connection.commit();
    return {
      state: normalizedState,
      revision: nextRevision,
      updatedAt: new Date().toISOString()
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
