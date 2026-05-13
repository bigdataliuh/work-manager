export const STORAGE_KEY = "work-mgr-v3";
export const BACKUP_KEY = "work-mgr-local-backup";

export const CATEGORIES = ["日常任务", "紧急任务", "临时事项", "行政商务流程"];
export const STATUS_OPTIONS = ["进行中", "待启动", "已完成", "已搁置"];
export const PRIORITY_OPTIONS = ["高", "中", "低"];
export const DEADLINE_MODES = ["none", "date", "text"];
export const PLAN_ITEM_STATUSES = ["pending", "done", "waiting", "canceled"];

export const CAT_COLORS = {
  日常任务: "#0F766E",
  紧急任务: "#C05046",
  临时事项: "#BF8F00",
  行政商务流程: "#2E75B6",
  项目: "#C05046",
  商务: "#2E75B6",
  开发: "#548235",
  临时任务: "#BF8F00",
  机器人: "#7030A0"
};

const LEGACY_CATEGORY_MAP = {
  活动: "机器人"
};

const PRIORITY_RANK = { 高: 0, 中: 1, 低: 2 };
const STATUS_RANK = { 进行中: 0, 待启动: 1, 已搁置: 2, 已完成: 3 };

export function catColor(category) {
  return CAT_COLORS[category] || "#64748b";
}

function normalizeCategoryName(category) {
  if (typeof category !== "string") return "";
  const trimmed = category.trim();
  return LEGACY_CATEGORY_MAP[trimmed] || trimmed;
}

export function normalizeCategories(rawCategories, taskLists = []) {
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
    CATEGORIES.forEach(pushCategory);
  }

  taskLists.flat().forEach((task) => pushCategory(task?.category));

  return categories.length ? categories : [...CATEGORIES];
}

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function getMonday(date) {
  const dt = new Date(date);
  const day = dt.getDay();
  dt.setDate(dt.getDate() - day + (day === 0 ? -6 : 1));
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export function fmtDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function dayLabel(date) {
  return `周${"日一二三四五六"[date.getDay()]}`;
}

export function isToday(date) {
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatDateInput(dateString) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return fmtDate(date);
}

export function formatDeadline(task) {
  if (task.deadlineMode === "date" && task.deadlineDate) return formatDateInput(task.deadlineDate);
  if (task.deadlineMode === "text") return task.deadlineText;
  return "";
}

export function deadlineSortValue(task) {
  if (task.deadlineMode !== "date" || !task.deadlineDate) return Number.POSITIVE_INFINITY;
  const ts = new Date(`${task.deadlineDate}T00:00:00`).getTime();
  return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts;
}

export function sortTasks(tasks) {
  return [...tasks].sort((left, right) => {
    const priorityDiff = (PRIORITY_RANK[left.priority] ?? 99) - (PRIORITY_RANK[right.priority] ?? 99);
    if (priorityDiff !== 0) return priorityDiff;

    const statusDiff = (STATUS_RANK[left.status] ?? 99) - (STATUS_RANK[right.status] ?? 99);
    if (statusDiff !== 0) return statusDiff;

    const deadlineDiff = deadlineSortValue(left) - deadlineSortValue(right);
    if (deadlineDiff !== 0) return deadlineDiff;

    return left.name.localeCompare(right.name, "zh-CN");
  });
}

function normalizeDeadlineFields(raw = {}) {
  if (DEADLINE_MODES.includes(raw.deadlineMode)) {
    return {
      deadlineMode: raw.deadlineMode,
      deadlineDate: raw.deadlineDate || "",
      deadlineText: raw.deadlineText || ""
    };
  }

  if (typeof raw.deadline === "string" && raw.deadline.trim()) {
    return {
      deadlineMode: "text",
      deadlineDate: "",
      deadlineText: raw.deadline.trim()
    };
  }

  return {
    deadlineMode: "none",
    deadlineDate: "",
    deadlineText: ""
  };
}

function normalizePlanItem(item) {
  if (!item) return null;
  if (typeof item === "string") {
    const content = item.trim();
    return content ? { title: "", content, done: false, status: "pending" } : null;
  }

  const title = typeof item.title === "string" ? item.title.trim() : "";
  const content = typeof item.content === "string" ? item.content.trim() : "";
  if (!title && !content) return null;
  const status = PLAN_ITEM_STATUSES.includes(item.status) ? item.status : (item.done ? "done" : "pending");

  const normalized = {
    title,
    content,
    done: status === "done",
    status
  };

  if (typeof item.handledAt === "string") normalized.handledAt = item.handledAt;
  if (typeof item.handledReason === "string") normalized.handledReason = item.handledReason;
  if (typeof item.deferredFrom === "string") normalized.deferredFrom = item.deferredFrom;

  return normalized;
}

function normalizeDailyActions(dailyActions = {}) {
  const next = {};
  Object.entries(dailyActions || {}).forEach(([key, value]) => {
    const normalizedItems = Array.isArray(value)
      ? value.map(normalizePlanItem).filter(Boolean)
      : [normalizePlanItem(value)].filter(Boolean);

    if (normalizedItems.length) next[key] = normalizedItems;
  });
  return next;
}

export function normalizeTask(raw = {}, categories = CATEGORIES) {
  const deadlineFields = normalizeDeadlineFields(raw);
  const normalizedCategory = normalizeCategoryName(raw.category);
  return {
    id: raw.id || genId(),
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    category: categories.includes(normalizedCategory) ? normalizedCategory : categories[0] || CATEGORIES[0],
    status: STATUS_OPTIONS.includes(raw.status) ? raw.status : STATUS_OPTIONS[0],
    priority: PRIORITY_OPTIONS.includes(raw.priority) ? raw.priority : PRIORITY_OPTIONS[0],
    responsible: typeof raw.responsible === "string" ? raw.responsible.trim() : "",
    participants: typeof raw.participants === "string" ? raw.participants.trim() : "",
    dailyActions: normalizeDailyActions(raw.dailyActions),
    archivedAt: typeof raw.archivedAt === "string" ? raw.archivedAt : undefined,
    ...deadlineFields
  };
}

export function createEmptyTask(categories = CATEGORIES) {
  return {
    name: "",
    category: categories[0] || CATEGORIES[0],
    priority: "高",
    responsible: "我",
    participants: "",
    deadlineMode: "none",
    deadlineDate: "",
    deadlineText: "",
    status: "进行中"
  };
}

export function defaultData() {
  return {
    schemaVersion: 4,
    _lastModified: 0,
    categories: [...CATEGORIES],
    tasks: [],
    archivedTasks: []
  };
}

export function normalizeData(input) {
  if (!input || typeof input !== "object") return defaultData();

  const rawTasks = Array.isArray(input.tasks) ? input.tasks : [];
  const rawArchivedTasks = Array.isArray(input.archivedTasks) ? input.archivedTasks : [];
  const categories = normalizeCategories(input.categories, [rawTasks, rawArchivedTasks]);
  const tasks = rawTasks.map((task) => normalizeTask(task, categories)).filter((task) => task.name);
  const archivedTasks = rawArchivedTasks
    .map((task) => normalizeTask({ ...task, status: "已完成" }, categories))
    .filter((task) => task.name);

  return {
    schemaVersion: 4,
    _lastModified: typeof input._lastModified === "number" ? input._lastModified : Date.now(),
    categories,
    tasks,
    archivedTasks
  };
}

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeData(JSON.parse(raw)) : defaultData();
  } catch (error) {
    console.error(error);
    return defaultData();
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
  } catch (error) {
    console.error(error);
  }
}

export function saveBackup(data, reason = "手动备份") {
  try {
    localStorage.setItem(
      BACKUP_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        reason,
        data: normalizeData(data)
      })
    );
  } catch (error) {
    console.error(error);
  }
}

export function loadBackup() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data) return null;
    return {
      savedAt: parsed.savedAt,
      reason: parsed.reason || "最近备份",
      data: normalizeData(parsed.data)
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}

export function updateTimestamp(data) {
  return {
    ...normalizeData(data),
    _lastModified: Date.now()
  };
}

export function getCellItems(task, day, { includeCanceled = false } = {}) {
  const raw = task.dailyActions?.[day];
  if (!raw) return null;
  const normalized = (Array.isArray(raw) ? raw.map(normalizePlanItem) : [normalizePlanItem(raw)])
    .filter(Boolean)
    .filter((item) => includeCanceled || item.status !== "canceled");
  return normalized.length ? normalized : null;
}
