export const STORAGE_KEY = "work-mgr-v3";
export const BACKUP_KEY = "work-mgr-local-backup";

export const CATEGORIES = ["项目", "活动", "商务", "开发", "临时任务"];
export const STATUS_OPTIONS = ["进行中", "待启动", "已完成", "已搁置"];
export const PRIORITY_OPTIONS = ["高", "中", "低"];
export const DEADLINE_MODES = ["none", "date", "text"];

export const CAT_COLORS = {
  项目: "#C05046",
  活动: "#7030A0",
  商务: "#2E75B6",
  开发: "#548235",
  临时任务: "#BF8F00"
};

const PRIORITY_RANK = { 高: 0, 中: 1, 低: 2 };
const STATUS_RANK = { 进行中: 0, 待启动: 1, 已搁置: 2, 已完成: 3 };

export function catColor(category) {
  return CAT_COLORS[category] || "#64748b";
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
    return content ? { title: "", content, done: false } : null;
  }

  const title = typeof item.title === "string" ? item.title.trim() : "";
  const content = typeof item.content === "string" ? item.content.trim() : "";
  if (!title && !content) return null;

  return {
    title,
    content,
    done: Boolean(item.done)
  };
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

export function normalizeTask(raw = {}) {
  const deadlineFields = normalizeDeadlineFields(raw);
  return {
    id: raw.id || genId(),
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    category: CATEGORIES.includes(raw.category) ? raw.category : CATEGORIES[0],
    status: STATUS_OPTIONS.includes(raw.status) ? raw.status : STATUS_OPTIONS[0],
    priority: PRIORITY_OPTIONS.includes(raw.priority) ? raw.priority : PRIORITY_OPTIONS[0],
    responsible: typeof raw.responsible === "string" ? raw.responsible.trim() : "",
    participants: typeof raw.participants === "string" ? raw.participants.trim() : "",
    dailyActions: normalizeDailyActions(raw.dailyActions),
    archivedAt: typeof raw.archivedAt === "string" ? raw.archivedAt : undefined,
    ...deadlineFields
  };
}

export function createEmptyTask() {
  return {
    name: "",
    category: "项目",
    priority: "高",
    responsible: "我",
    participants: "",
    deadlineMode: "none",
    deadlineDate: "",
    deadlineText: "",
    status: "进行中"
  };
}

function createSeedTasks() {
  return [
    { name: "朝天宫项目-语料编写", category: "项目", status: "进行中", priority: "高", responsible: "我", participants: "邵颖团队", deadlineMode: "text", deadlineText: "4/24", dailyActions: {} },
    { name: "朝天宫项目-素材采集", category: "项目", status: "待启动", priority: "高", responsible: "于帆", participants: "rokid李源", deadlineMode: "text", deadlineText: "4/24", dailyActions: {} },
    { name: "rokid合作模式谈判", category: "商务", status: "进行中", priority: "高", responsible: "我", participants: "冯", deadlineMode: "text", deadlineText: "本周五", dailyActions: {} },
    { name: "工信商务消化", category: "商务", status: "进行中", priority: "高", responsible: "我", participants: "", deadlineMode: "text", deadlineText: "持续", dailyActions: {} },
    { name: "三台机器人对接", category: "开发", status: "进行中", priority: "中", responsible: "我", participants: "南大", deadlineMode: "text", deadlineText: "持续", dailyActions: {} },
    { name: "知识库维护", category: "开发", status: "进行中", priority: "中", responsible: "我", participants: "", deadlineMode: "text", deadlineText: "持续", dailyActions: {} },
    { name: "书记盯办事项", category: "临时任务", status: "进行中", priority: "高", responsible: "我", participants: "", deadlineMode: "none", deadlineText: "", dailyActions: {} }
  ].map((task) => normalizeTask(task));
}

export function defaultData() {
  return {
    schemaVersion: 3,
    _lastModified: 0,
    tasks: [],
    archivedTasks: []
  };
}

export function normalizeData(input) {
  if (!input || typeof input !== "object") return defaultData();

  const tasks = Array.isArray(input.tasks) ? input.tasks.map(normalizeTask).filter((task) => task.name) : [];
  const archivedTasks = Array.isArray(input.archivedTasks)
    ? input.archivedTasks.map((task) => normalizeTask({ ...task, status: "已完成" })).filter((task) => task.name)
    : [];

  return {
    schemaVersion: 3,
    _lastModified: typeof input._lastModified === "number" ? input._lastModified : Date.now(),
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

export function getCellItems(task, day) {
  const raw = task.dailyActions?.[day];
  if (!raw) return null;
  const normalized = Array.isArray(raw) ? raw.map(normalizePlanItem).filter(Boolean) : [normalizePlanItem(raw)].filter(Boolean);
  return normalized.length ? normalized : null;
}
