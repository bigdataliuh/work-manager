import { getDbPool } from "./db.js";

const WORKSPACE_ROW_ID = 1;

function normalizeStateShape(state) {
  if (!state || typeof state !== "object") {
    return {
      schemaVersion: 3,
      _lastModified: 0,
      tasks: [],
      archivedTasks: []
    };
  }

  return {
    schemaVersion: typeof state.schemaVersion === "number" ? state.schemaVersion : 3,
    _lastModified: typeof state._lastModified === "number" ? state._lastModified : Date.now(),
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    archivedTasks: Array.isArray(state.archivedTasks) ? state.archivedTasks : []
  };
}

export async function ensureSchema() {
  const pool = getDbPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      data_json LONGTEXT NOT NULL,
      revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

export async function getStateRecord() {
  const pool = getDbPool();
  const [rows] = await pool.query(
    "SELECT data_json, revision, updated_at FROM app_state WHERE id = ? LIMIT 1",
    [WORKSPACE_ROW_ID]
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

export async function saveStateRecord(state, baseRevision) {
  const pool = getDbPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      "SELECT data_json, revision, updated_at FROM app_state WHERE id = ? FOR UPDATE",
      [WORKSPACE_ROW_ID]
    );

    const normalizedState = normalizeStateShape(state);

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
        "INSERT INTO app_state (id, data_json, revision) VALUES (?, ?, 1)",
        [WORKSPACE_ROW_ID, JSON.stringify(normalizedState)]
      );

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
          state: normalizeStateShape(JSON.parse(currentRow.data_json)),
          revision: currentRevision,
          updatedAt: currentRow.updated_at ? new Date(currentRow.updated_at).toISOString() : null
        }
      });
    }

    const nextRevision = currentRevision + 1;
    await connection.query(
      "UPDATE app_state SET data_json = ?, revision = ? WHERE id = ?",
      [JSON.stringify(normalizedState), nextRevision, WORKSPACE_ROW_ID]
    );

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
