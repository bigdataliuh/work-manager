import React, { useEffect, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  createEmptyTask,
  dateKey,
  dayLabel,
  defaultData,
  fmtDate,
  formatDateInput,
  formatDeadline,
  getCellItems,
  getMonday,
  isToday,
  loadBackup,
  loadData,
  normalizeData,
  saveBackup,
  saveData,
  sortTasks,
  updateTimestamp,
  catColor,
  genId
} from "./data.js";
import {
  clearSavedGistId,
  clearSessionToken,
  completeMentionPlan,
  completeMentionTask,
  completeNotification,
  createAdminUser,
  deleteAdminUser,
  getSavedGistId,
  getCurrentUser,
  getSessionToken,
  gistCreate,
  gistLoad,
  gistUpdate,
  listAdminUsers,
  listMentionUsers,
  listNotifications,
  login,
  logout,
  markNotificationsRead,
  resetAdminUserPassword,
  setSavedGistId,
  setSessionToken,
  updateAdminUser
} from "./sync.js";
import { ConfirmDialog, MentionPicker, Modal, MobileView, PBadge, SBadge, TaskForm, ToastStack } from "./components.jsx";

function dataReducer(state, action) {
  switch (action.type) {
    case "replace":
      return updateTimestamp(action.data);

    case "addTask":
      return updateTimestamp({
        ...state,
        tasks: [...state.tasks, normalizeData({ categories: state.categories, tasks: [{ ...action.task, id: genId(), dailyActions: {} }], archivedTasks: [] }).tasks[0]]
      });

    case "updateTask":
      return updateTimestamp({
        ...state,
        tasks: state.tasks.map((task) => (task.id === action.task.id ? normalizeData({ categories: state.categories, tasks: [{ ...task, ...action.task }], archivedTasks: [] }).tasks[0] : task))
      });

    case "archiveTask": {
      const target = state.tasks.find((task) => task.id === action.id);
      if (!target) return state;
      return updateTimestamp({
        ...state,
        tasks: state.tasks.filter((task) => task.id !== action.id),
        archivedTasks: [{ ...target, status: "已完成", archivedAt: new Date().toISOString() }, ...state.archivedTasks]
      });
    }

    case "restoreTask": {
      const target = state.archivedTasks.find((task) => task.id === action.id);
      if (!target) return state;
      const restored = { ...target, status: "进行中" };
      delete restored.archivedAt;
      return updateTimestamp({
        ...state,
        tasks: [...state.tasks, restored],
        archivedTasks: state.archivedTasks.filter((task) => task.id !== action.id)
      });
    }

    case "deleteTask":
      return updateTimestamp({
        ...state,
        tasks: state.tasks.filter((task) => task.id !== action.id)
      });

    case "deleteArchivedTask":
      return updateTimestamp({
        ...state,
        archivedTasks: state.archivedTasks.filter((task) => task.id !== action.id)
      });

    case "saveCellItems":
      return updateTimestamp({
        ...state,
        tasks: state.tasks.map((task) => {
          if (task.id !== action.taskId) return task;
          const nextDailyActions = { ...task.dailyActions };
          if (action.items.length) nextDailyActions[action.day] = action.items;
          else delete nextDailyActions[action.day];
          return { ...task, dailyActions: nextDailyActions };
        })
      });

    case "toggleItemDone":
      return updateTimestamp({
        ...state,
        tasks: state.tasks.map((task) => {
          if (task.id !== action.taskId) return task;
          const items = getCellItems(task, action.day);
          if (!items || !items[action.index]) return task;
          const nextItems = items.map((item, index) => (index === action.index ? { ...item, done: !item.done } : item));
          return { ...task, dailyActions: { ...task.dailyActions, [action.day]: nextItems } };
        })
      });

    case "rolloverItem": {
      const nextDay = getNextDayKey(action.day);
      if (!nextDay) return state;

      return updateTimestamp({
        ...state,
        tasks: state.tasks.map((task) => {
          if (task.id !== action.taskId) return task;
          const items = getCellItems(task, action.day);
          if (!items || !items[action.index]) return task;

          const itemToMove = { ...items[action.index], done: false };
          const remainingItems = items.filter((_, index) => index !== action.index);
          const nextDayItems = getCellItems(task, nextDay) || [];
          const nextDailyActions = {
            ...task.dailyActions,
            [nextDay]: [...nextDayItems, itemToMove]
          };

          if (remainingItems.length) nextDailyActions[action.day] = remainingItems;
          else delete nextDailyActions[action.day];

          return { ...task, dailyActions: nextDailyActions };
        })
      });
    }

    default:
      return state;
  }
}

function getNextDayKey(day) {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + 1);
  return dateKey(date);
}

function createToast(message, type = "success") {
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), message, type };
}

function App() {
  const [data, dispatch] = useReducer(dataReducer, undefined, loadData);
  const [weekOffset, setWeekOffset] = useState(0);
  const [filterCat, setFilterCat] = useState("全部");
  const [desktopVisibility, setDesktopVisibility] = useState("active");
  const [showAdd, setShowAdd] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveCategory, setArchiveCategory] = useState("全部");
  const [archiveSort, setArchiveSort] = useState("latest");
  const [archiveDetailTask, setArchiveDetailTask] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [editCell, setEditCell] = useState(null);
  const [cellItems, setCellItems] = useState([{ title: "", content: "", done: false }]);
  const [expandedCell, setExpandedCell] = useState(null);
  const [newTask, setNewTask] = useState(() => createEmptyTask());
  const [gistToken, setGistToken] = useState("");
  const [gistId, setGistId] = useState("");
  const [syncStatus, setSyncStatus] = useState("idle");
  const [tokenInput, setTokenInput] = useState("");
  const [remoteUpdate, setRemoteUpdate] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const [mobileDay, setMobileDay] = useState(() => dateKey(new Date()));
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [backupInfo, setBackupInfo] = useState(() => loadBackup());
  const [hasInitializedRemote, setHasInitializedRemote] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [authStatus, setAuthStatus] = useState("loading");
  const [currentUser, setCurrentUser] = useState(null);
  const [workspaceUser, setWorkspaceUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminUserForm, setAdminUserForm] = useState({ username: "", displayName: "", password: "", role: "user" });
  const [mentionUsers, setMentionUsers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const fileRef = useRef(null);
  const syncTimerRef = useRef(null);
  const todayColRef = useRef(null);
  const latestDataRef = useRef(data);

  function hasCloudData(state) {
    return Boolean(state?.tasks?.length || state?.archivedTasks?.length);
  }

  function pushToast(message, type = "success") {
    setToasts((current) => [...current, createToast(message, type)]);
  }

  function applyStateUpdate(updater) {
    dispatch({ type: "replace", data: updater(data) });
  }

  function backupAndApply(reason, updater) {
    saveBackup(data, reason);
    setBackupInfo(loadBackup());
    applyStateUpdate(updater);
  }

  const isAdmin = currentUser?.role === "admin";

  async function refreshMentionUsers() {
    const users = await listMentionUsers();
    setMentionUsers(users);
    return users;
  }

  async function refreshNotifications() {
    const result = await listNotifications();
    setNotifications(result.notifications);
    setUnreadNotifications(result.unreadCount);
    return result;
  }

  async function refreshAdminUsers() {
    if (!isAdmin) return [];
    const users = await listAdminUsers();
    setAdminUsers(users);
    setWorkspaceUser((current) => {
      if (!current) return current;
      return users.find((user) => user.id === current.id) || current;
    });
    return users;
  }

  function activateUserSession(user) {
    setCurrentUser(user);
    setWorkspaceUser(user);
    setGistToken("session");
    setGistId(String(user.id));
    setHasInitializedRemote(false);
    setRemoteUpdate(null);
    setAuthStatus("authenticated");
    dispatch({ type: "replace", data: defaultData() });
  }

  async function handleLogin(event) {
    event.preventDefault();
    setLoginError("");
    setAuthStatus("loading");

    try {
      const user = await login(loginForm.username, loginForm.password);
      activateUserSession(user);
      setLoginForm({ username: "", password: "" });
      await refreshMentionUsers();
      await refreshNotifications();
      if (user.role === "admin") {
        const users = await listAdminUsers();
        setAdminUsers(users);
      }
    } catch (error) {
      console.error(error);
      setAuthStatus("anonymous");
      setLoginError("账号或密码不正确");
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } catch (error) {
      console.error(error);
    }

    clearSessionToken();
    setCurrentUser(null);
    setWorkspaceUser(null);
    setAdminUsers([]);
    setMentionUsers([]);
    setNotifications([]);
    setUnreadNotifications(0);
    setShowNotifications(false);
    setGistToken("");
    setGistId("");
    setHasInitializedRemote(false);
    setRemoteUpdate(null);
    setAuthStatus("anonymous");
    dispatch({ type: "replace", data: defaultData() });
  }

  function switchWorkspaceUser(user) {
    if (!user || user.id === workspaceUser?.id) return;
    setWorkspaceUser(user);
    setGistId(String(user.id));
    setHasInitializedRemote(false);
    setRemoteUpdate(null);
    setShowArchive(false);
    setShowAdd(false);
    setEditTask(null);
    setEditCell(null);
    setExpandedCell(null);
    dispatch({ type: "replace", data: defaultData() });
    pushToast(`已切换到 ${user.displayName || user.username} 的工作台`, "warning");
  }

  async function handleCreateAdminUser(event) {
    event.preventDefault();
    try {
      await createAdminUser(adminUserForm);
      setAdminUserForm({ username: "", displayName: "", password: "", role: "user" });
      await refreshAdminUsers();
      pushToast("账号已创建");
    } catch (error) {
      console.error(error);
      pushToast(error.message || "账号创建失败", "error");
    }
  }

  async function handleToggleUserActive(user) {
    if (user.id === currentUser?.id) {
      pushToast("不能停用当前登录账号", "warning");
      return;
    }

    try {
      await updateAdminUser(user.id, { isActive: !user.isActive, role: user.role, displayName: user.displayName });
      await refreshAdminUsers();
      pushToast(user.isActive ? "账号已停用" : "账号已启用", "warning");
    } catch (error) {
      console.error(error);
      pushToast("账号状态更新失败", "error");
    }
  }

  function handleDeleteAdminUser(user) {
    if (user.id === currentUser?.id) {
      pushToast("不能删除当前登录账号", "warning");
      return;
    }

    askConfirm({
      title: "删除账号",
      message: `确认删除 ${user.displayName || user.username}？该账号的工作台数据、登录会话和相关通知会一并删除。`,
      confirmLabel: "确认删除",
      confirmTone: "danger",
      onConfirm: async () => {
        try {
          await deleteAdminUser(user.id);
          const users = await refreshAdminUsers();
          await refreshMentionUsers();
          if (workspaceUser?.id === user.id) {
            switchWorkspaceUser(users.find((item) => item.id === currentUser?.id) || currentUser);
          }
          setConfirmState(null);
          pushToast("账号已删除", "warning");
        } catch (error) {
          console.error(error);
          setConfirmState(null);
          pushToast(error.message || "账号删除失败", "error");
        }
      }
    });
  }

  async function handleResetUserPassword(user) {
    const password = window.prompt(`输入 ${user.displayName || user.username} 的新密码，至少 8 位`);
    if (!password) return;

    try {
      await resetAdminUserPassword(user.id, password);
      await refreshAdminUsers();
      pushToast("密码已重置");
    } catch (error) {
      console.error(error);
      pushToast(error.message || "密码重置失败", "error");
    }
  }

  async function openNotifications() {
    setShowNotifications(true);
    try {
      const result = await refreshNotifications();
      if (result.unreadCount > 0) {
        await markNotificationsRead();
        await refreshNotifications();
      }
    } catch (error) {
      console.error(error);
      pushToast("通知加载失败", "error");
    }
  }

  async function handleCompleteNotification(notification) {
    try {
      await completeNotification(notification.id);
      await refreshNotifications();
      pushToast("已通知相关成员任务完成");
    } catch (error) {
      console.error(error);
      pushToast(error.message || "任务完成通知失败", "error");
    }
  }

  async function handleCompleteMentionTask(task) {
    try {
      const completedCount = await completeMentionTask(workspaceUser?.id || currentUser?.id, task.id);
      await refreshNotifications();
      pushToast(completedCount ? "已通知相关成员任务完成" : "没有找到可更新的@通知", completedCount ? "success" : "warning");
    } catch (error) {
      console.error(error);
      pushToast(error.message || "任务完成通知失败", "error");
    }
  }

  async function handleCompleteMentionPlan(index) {
    if (!editCell) return;
    try {
      const completedCount = await completeMentionPlan(workspaceUser?.id || currentUser?.id, editCell.taskId, editCell.day, index);
      await refreshNotifications();
      pushToast(completedCount ? "已通知相关成员任务完成" : "没有找到可更新的@通知", completedCount ? "success" : "warning");
    } catch (error) {
      console.error(error);
      pushToast(error.message || "任务完成通知失败", "error");
    }
  }

  useEffect(() => {
    let active = true;

    getCurrentUser()
      .then(async (user) => {
        if (!active) return;
        activateUserSession(user);
        const mentionableUsers = await listMentionUsers();
        if (active) setMentionUsers(mentionableUsers);
        const notificationResult = await listNotifications();
        if (active) {
          setNotifications(notificationResult.notifications);
          setUnreadNotifications(notificationResult.unreadCount);
        }
        if (user.role === "admin") {
          const users = await listAdminUsers();
          if (active) setAdminUsers(users);
        }
      })
      .catch(() => {
        if (active) {
          setAuthStatus("anonymous");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toasts.length) return undefined;
    const timer = setTimeout(() => {
      setToasts((current) => current.slice(1));
    }, 3200);
    return () => clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    if (!currentUser) return undefined;
    const timer = window.setInterval(() => {
      refreshNotifications().catch((error) => console.error(error));
    }, 60000);
    return () => window.clearInterval(timer);
  }, [currentUser?.id]);

  useEffect(() => {
    saveData(data);
    latestDataRef.current = data;
  }, [data]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (filterCat !== "全部" && !data.categories.includes(filterCat)) {
      setFilterCat("全部");
    }
  }, [data.categories, filterCat]);

  useEffect(() => {
    if (!data.categories.length) return;
    setNewTask((current) => (data.categories.includes(current.category) ? current : { ...current, category: data.categories[0] }));
    setEditTask((current) => (current && !data.categories.includes(current.category) ? { ...current, category: data.categories[0] } : current));
  }, [data.categories]);

  useEffect(() => {
    if (!gistToken || !gistId) return undefined;

    let active = true;
    setHasInitializedRemote(false);
    setSyncStatus("syncing");

    gistLoad(gistToken, gistId)
      .then((remote) => {
        if (!active || !remote?.tasks) {
          if (active) setSyncStatus("error");
          return;
        }

        const normalizedRemote = normalizeData(remote);
        const remoteHasData = hasCloudData(normalizedRemote);
        const localHasData = hasCloudData(latestDataRef.current);
        setHasInitializedRemote(true);

        if (remoteHasData) {
          dispatch({ type: "replace", data: normalizedRemote });
          setRemoteUpdate(null);
          setSyncStatus("ok");
          return;
        }

        if (!remoteHasData && localHasData) {
          setSyncStatus("ok");
          return;
        }

        if (normalizedRemote._lastModified > data._lastModified + 5000) {
          setRemoteUpdate(normalizedRemote);
          setSyncStatus("ok");
          return;
        }

        setSyncStatus("ok");
      })
      .catch(() => {
        if (active) setSyncStatus("error");
      });

    const poll = window.setInterval(async () => {
      try {
        const remote = await gistLoad(gistToken, gistId);
        if (!remote?.tasks) return;
        const normalizedRemote = normalizeData(remote);
        if (normalizedRemote._lastModified > latestDataRef.current._lastModified + 5000) {
          setRemoteUpdate(normalizedRemote);
        }
      } catch (error) {
        console.error(error);
      }
    }, 60000);

    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, [gistToken, gistId]);

  useEffect(() => {
    if (!gistToken || !gistId) return undefined;
    if (!hasInitializedRemote) return undefined;
    if (remoteUpdate && remoteUpdate._lastModified > data._lastModified + 5000) return undefined;

    window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(async () => {
      setSyncStatus("syncing");
      try {
        await gistUpdate(gistToken, gistId, data);
        setSyncStatus("ok");
      } catch (error) {
        console.error(error);
        setSyncStatus("error");
      }
    }, 1200);

    return () => window.clearTimeout(syncTimerRef.current);
  }, [data, gistId, gistToken, remoteUpdate, hasInitializedRemote]);

  const monday = getMonday(new Date());
  monday.setDate(monday.getDate() + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    return date;
  });

  const query = searchQuery.trim().toLowerCase();
  const weekStart = dateKey(days[0]);
  const weekEnd = dateKey(days[6]);

  function hasItemsAroundToday(task) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return [-1, 0, 1].some((offset) => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      return Boolean(getCellItems(task, dateKey(date)));
    });
  }

  function hasNearbyDeadline(task) {
    if (task.deadlineMode !== "date" || !task.deadlineDate) return false;
    return task.deadlineDate >= weekStart && task.deadlineDate <= weekEnd;
  }

  function getLatestPlanSummary(task) {
    const entries = Object.entries(task.dailyActions || {})
      .filter(([, items]) => Array.isArray(items) && items.length)
      .sort(([left], [right]) => right.localeCompare(left));
    if (!entries.length) return "";
    const [, items] = entries[0];
    const first = items[0];
    return first?.title || first?.content || "";
  }

  function getArchivePlanDays(task) {
    return Object.entries(task.dailyActions || {})
      .filter(([, items]) => Array.isArray(items) && items.length)
      .sort(([left], [right]) => right.localeCompare(left));
  }

  function notificationActorLabel(notification) {
    return notification.actorUser?.displayName || notification.actorUser?.username || "有人";
  }

  function notificationCompletedByLabel(notification) {
    return notification.completedByUser?.displayName || notification.completedByUser?.username || "有人";
  }

  function notificationMeta(notification) {
    const workspaceName = notification.workspaceUser?.displayName || notification.workspaceUser?.username || "";
    const parts = [
      notification.sourceType === "plan" ? "每日计划" : "任务",
      notification.sourceMeta,
      workspaceName ? `${workspaceName} 的工作台` : ""
    ].filter(Boolean);
    return parts.join(" · ");
  }

  function taskHasMentions(task) {
    return /(^|\s)@[^@\s]+/.test([task?.name, task?.responsible, task?.participants].filter(Boolean).join(" "));
  }

  function planHasMentions(item) {
    return /(^|\s)@[^@\s]+/.test([item?.title, item?.content].filter(Boolean).join(" "));
  }

  function isActiveTask(task) {
    if (hasItemsAroundToday(task)) return true;
    if (hasNearbyDeadline(task)) return true;
    return false;
  }

  const filteredTasks = sortTasks(
    data.tasks.filter((task) => {
      if (filterCat !== "全部" && task.category !== filterCat) return false;
      if (!query) return true;

      return (
        task.name.toLowerCase().includes(query) ||
        task.responsible.toLowerCase().includes(query) ||
        task.participants.toLowerCase().includes(query) ||
        formatDeadline(task).toLowerCase().includes(query) ||
        Object.values(task.dailyActions).some((items) =>
          Array.isArray(items) && items.some((item) => item.title.toLowerCase().includes(query) || item.content.toLowerCase().includes(query))
        )
      );
    })
  );

  const desktopSections = data.categories
    .map((category) => {
      const tasks = filteredTasks.filter((task) => task.category === category);
      const activeTasks = tasks.filter(isActiveTask);
      const silentTasks = tasks.filter((task) => !isActiveTask(task));
      return { category, activeTasks, silentTasks, total: tasks.length };
    })
    .filter((section) => section.total > 0);

  const mobileTasks = sortTasks(
    data.tasks.filter((task) => {
      if (filterCat !== "全部" && task.category !== filterCat) return false;
      if (!query) return true;
      return (
        task.name.toLowerCase().includes(query) ||
        task.responsible.toLowerCase().includes(query) ||
        task.participants.toLowerCase().includes(query) ||
        formatDeadline(task).toLowerCase().includes(query)
      );
    })
  );

  const archiveSearch = archiveQuery.trim().toLowerCase();
  const archiveTasks = [...data.archivedTasks]
    .filter((task) => {
      if (archiveCategory !== "全部" && task.category !== archiveCategory) return false;
      if (!archiveSearch) return true;

      return (
        task.name.toLowerCase().includes(archiveSearch) ||
        task.category.toLowerCase().includes(archiveSearch) ||
        task.responsible.toLowerCase().includes(archiveSearch) ||
        task.participants.toLowerCase().includes(archiveSearch) ||
        formatDeadline(task).toLowerCase().includes(archiveSearch) ||
        getLatestPlanSummary(task).toLowerCase().includes(archiveSearch)
      );
    })
    .sort((left, right) => {
      if (archiveSort === "earliest") {
        return new Date(left.archivedAt || 0).getTime() - new Date(right.archivedAt || 0).getTime();
      }

      if (archiveSort === "category") {
        const categoryDiff = left.category.localeCompare(right.category, "zh-CN");
        if (categoryDiff !== 0) return categoryDiff;
      }

      return new Date(right.archivedAt || 0).getTime() - new Date(left.archivedAt || 0).getTime();
    });

  function askConfirm({ title, message, confirmLabel, confirmTone = "dark", onConfirm }) {
    setConfirmState({ title, message, confirmLabel, confirmTone, onConfirm });
  }

  function resetNewTask() {
    setNewTask(createEmptyTask(data.categories));
  }

  function toggleSilentCategory(category) {
    setCollapsedCategories((current) => ({ ...current, [category]: current[category] !== false ? false : true }));
  }

  function moveCategory(category, direction) {
    const currentIndex = data.categories.indexOf(category);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= data.categories.length) return;

    backupAndApply("调整分类顺序前自动备份", (current) => {
      const nextCategories = [...current.categories];
      const [item] = nextCategories.splice(currentIndex, 1);
      nextCategories.splice(nextIndex, 0, item);
      return { ...current, categories: nextCategories };
    });
    pushToast("分类顺序已更新");
  }

  function addCategory() {
    const input = window.prompt("输入新分类名称");
    const nextCategory = input?.trim();
    if (!nextCategory) return;
    if (data.categories.includes(nextCategory)) {
      pushToast("分类已存在", "warning");
      return;
    }

    backupAndApply("新增分类前自动备份", (current) => ({
      ...current,
      categories: [...current.categories, nextCategory]
    }));
    pushToast("分类已新增");
  }

  function renameCategory(category) {
    const input = window.prompt("输入新的分类名称", category);
    const nextCategory = input?.trim();
    if (!nextCategory || nextCategory === category) return;
    if (data.categories.includes(nextCategory)) {
      pushToast("分类名称已存在", "warning");
      return;
    }

    backupAndApply("重命名分类前自动备份", (current) => ({
      ...current,
      categories: current.categories.map((item) => (item === category ? nextCategory : item)),
      tasks: current.tasks.map((task) => (task.category === category ? { ...task, category: nextCategory } : task)),
      archivedTasks: current.archivedTasks.map((task) => (task.category === category ? { ...task, category: nextCategory } : task))
    }));
    setCollapsedCategories((current) => {
      if (!(category in current)) return current;
      return { ...current, [nextCategory]: current[category] };
    });
    pushToast("分类已重命名");
  }

  function removeCategory(category) {
    if (data.categories.length <= 1) {
      pushToast("至少保留一个分类", "warning");
      return;
    }

    const remainingCategories = data.categories.filter((item) => item !== category);
    const target = window.prompt(`删除后要迁移到哪个分类？\n可选：${remainingCategories.join("、")}`, remainingCategories[0]);
    const targetCategory = target?.trim();
    if (!targetCategory) return;
    if (!remainingCategories.includes(targetCategory)) {
      pushToast("迁移目标无效", "warning");
      return;
    }

    backupAndApply("删除分类前自动备份", (current) => ({
      ...current,
      categories: current.categories.filter((item) => item !== category),
      tasks: current.tasks.map((task) => (task.category === category ? { ...task, category: targetCategory } : task)),
      archivedTasks: current.archivedTasks.map((task) => (task.category === category ? { ...task, category: targetCategory } : task))
    }));
    setCollapsedCategories((current) => {
      if (!(category in current)) return current;
      const next = { ...current };
      delete next[category];
      return next;
    });
    if (filterCat === category) {
      setFilterCat("全部");
    }
    pushToast("分类已删除并迁移任务", "warning");
  }

  function duplicateArchivedTask(task) {
    const copiedTask = normalizeData({
      categories: data.categories,
      tasks: [{ ...task, id: genId(), status: "待启动", archivedAt: undefined }],
      archivedTasks: []
    }).tasks[0];

    dispatch({
      type: "replace",
      data: {
        ...data,
        tasks: [...data.tasks, copiedTask]
      }
    });
    setShowArchive(false);
    pushToast("已复制为新任务");
  }

  function openArchiveDetail(task) {
    setArchiveDetailTask(task);
  }

  function handleAddTask() {
    if (!newTask.name.trim()) {
      pushToast("任务名称不能为空", "warning");
      return;
    }
    dispatch({ type: "addTask", task: newTask });
    resetNewTask();
    setShowAdd(false);
    pushToast("任务已添加");
  }

  function handleSaveTaskEdit() {
    if (!editTask?.name.trim()) {
      pushToast("任务名称不能为空", "warning");
      return;
    }
    dispatch({ type: "updateTask", task: editTask });
    setEditTask(null);
    pushToast("任务已更新");
  }

  function handleSaveCellEdit() {
    if (!editCell) return;
    const validItems = cellItems
      .map((item) => ({
        title: item.title.trim(),
        content: item.content.trim(),
        done: Boolean(item.done)
      }))
      .filter((item) => item.title || item.content);

    dispatch({ type: "saveCellItems", taskId: editCell.taskId, day: editCell.day, items: validItems });
    setEditCell(null);
    setCellItems([{ title: "", content: "", done: false }]);
    pushToast(validItems.length ? "计划已保存" : "计划已清空");
  }

  function appendMentionToPlan(index, user) {
    const token = `@${user.username}`;
    setCellItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const content = String(item.content || "");
      if (content.split(/\s+/).includes(token)) return item;
      return {
        ...item,
        content: content ? `${content} ${token}` : token
      };
    }));
  }

  function handleRolloverItem(taskId, day, index) {
    dispatch({ type: "rolloverItem", taskId, day, index });
    setExpandedCell(null);
    pushToast("未完成计划已平移到次日", "warning");
  }

  function handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const imported = normalizeData(JSON.parse(loadEvent.target.result));
        saveBackup(data, "导入前自动备份");
        setBackupInfo(loadBackup());
        dispatch({ type: "replace", data: imported });
        pushToast("数据导入成功");
        setShowSettings(false);
      } catch (error) {
        console.error(error);
        pushToast("文件格式不正确或解析失败", "error");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `work-mgr-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    pushToast("数据已导出");
  }

  function resetDataWithBackup() {
    askConfirm({
      title: "重置所有数据",
      message: "当前任务、归档和每日计划都会被清空。系统会先保存一份本地备份。",
      confirmLabel: "确认重置",
      confirmTone: "danger",
      onConfirm: () => {
        saveBackup(data, "重置前自动备份");
        setBackupInfo(loadBackup());
        dispatch({ type: "replace", data: defaultData() });
        setShowSettings(false);
        pushToast("数据已重置", "warning");
        setConfirmState(null);
      }
    });
  }

  function restoreBackup() {
    const backup = loadBackup();
    if (!backup?.data) {
      pushToast("没有可恢复的本地备份", "warning");
      return;
    }

    askConfirm({
      title: "恢复本地备份",
      message: `将恢复 ${new Date(backup.savedAt).toLocaleString()} 的备份：${backup.reason}。当前数据会被覆盖。`,
      confirmLabel: "恢复备份",
      onConfirm: () => {
        dispatch({ type: "replace", data: backup.data });
        setConfirmState(null);
        pushToast("本地备份已恢复");
      }
    });
  }

  async function connectCloud() {
    const token = tokenInput.trim();
    if (!token) {
      pushToast("先粘贴 GitHub Token", "warning");
      return;
    }

    setSyncStatus("syncing");
    try {
      const existingGistId = gistId || getSavedGistId();
      if (existingGistId) {
        const remote = await gistLoad(token, existingGistId);
        if (!remote?.tasks) throw new Error("Remote data missing");
        setSessionToken(token);
        setGistToken(token);
        setGistId(existingGistId);
        setSyncStatus("ok");
        setTokenInput("");
        pushToast("已连接现有云端数据");
        return;
      }

      const createdId = await gistCreate(token, data);
      setSavedGistId(createdId);
      setSessionToken(token);
      setGistToken(token);
      setGistId(createdId);
      setTokenInput("");
      setSyncStatus("ok");
      pushToast("已创建并连接云端备份");
    } catch (error) {
      console.error(error);
      setSyncStatus("error");
      pushToast("连接失败，请检查 Token 权限和网络", "error");
    }
  }

  function disconnectCloud() {
    askConfirm({
      title: "断开云同步",
      message: "这会清除当前浏览器会话中的 Token。Gist ID 会保留，之后重新输入 Token 即可继续同步。",
      confirmLabel: "确认断开",
      confirmTone: "danger",
      onConfirm: () => {
        clearSessionToken();
        setGistToken("");
        setSyncStatus("idle");
        setTokenInput("");
        setConfirmState(null);
        pushToast("已断开当前会话的云同步", "warning");
      }
    });
  }

  function forgetCloud() {
    askConfirm({
      title: "移除云同步配置",
      message: "这会移除保存的 Gist ID，并清除当前会话 Token。云端数据不会被删除。",
      confirmLabel: "移除配置",
      confirmTone: "danger",
      onConfirm: () => {
        clearSessionToken();
        clearSavedGistId();
        setGistToken("");
        setGistId("");
        setSyncStatus("idle");
        setConfirmState(null);
        pushToast("云同步配置已移除", "warning");
      }
    });
  }

  async function pullFromCloud() {
    if (!gistToken || !gistId) {
      pushToast("当前没有可用的云同步连接", "warning");
      return;
    }

    setSyncStatus("syncing");
    try {
      const remote = await gistLoad(gistToken, gistId);
      if (!remote?.tasks) throw new Error("Remote data missing");
      saveBackup(data, "从云端恢复前自动备份");
      setBackupInfo(loadBackup());
      dispatch({ type: "replace", data: normalizeData(remote) });
      setRemoteUpdate(null);
      setSyncStatus("ok");
      pushToast("已从云端恢复最新数据");
    } catch (error) {
      console.error(error);
      setSyncStatus("error");
      pushToast("云端恢复失败", "error");
    }
  }

  async function keepLocalVersion() {
    if (!gistToken || !gistId) {
      setRemoteUpdate(null);
      return;
    }
    setSyncStatus("syncing");
    try {
      await gistUpdate(gistToken, gistId, data);
      setRemoteUpdate(null);
      setSyncStatus("ok");
      pushToast("本地版本已覆盖云端");
    } catch (error) {
      console.error(error);
      setSyncStatus("error");
      pushToast("覆盖云端失败", "error");
    }
  }

  function useCloudVersion() {
    if (!remoteUpdate) return;
    saveBackup(data, "冲突解决前自动备份");
    setBackupInfo(loadBackup());
    dispatch({ type: "replace", data: remoteUpdate });
    setRemoteUpdate(null);
    pushToast("已切换到云端版本", "warning");
  }

  function scrollToToday() {
    if (weekOffset !== 0) {
      setWeekOffset(0);
      window.setTimeout(() => todayColRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }), 100);
      return;
    }
    todayColRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  const isWeChat = /MicroMessenger/i.test(navigator.userAgent);

  if (authStatus === "loading") {
    return (
      <div className="auth-shell">
        <div className="auth-panel">
          <div className="auth-title">江苏文创 工作管理系统</div>
          <div className="auth-note">正在检查登录状态...</div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="auth-shell">
        <form className="auth-panel" onSubmit={handleLogin}>
          <div className="auth-title">江苏文创 工作管理系统</div>
          <div className="auth-note">使用你的部门账号登录后进入个人工作台。</div>
          <label className="field-label">账号</label>
          <input
            className="field-input"
            value={loginForm.username}
            onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
            autoComplete="username"
            autoFocus
          />
          <label className="field-label">密码</label>
          <input
            className="field-input"
            type="password"
            value={loginForm.password}
            onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
            autoComplete="current-password"
          />
          {loginError ? <div className="auth-error">{loginError}</div> : null}
          <button className="btn btn-dark btn-block" type="submit">登录</button>
        </form>
      </div>
    );
  }

  return (
    <>
      {isWeChat ? (
        <div className="info-banner wechat">
          <span style={{ fontSize: 20 }}>💬</span>
          <div>
            <div style={{ fontWeight: 600 }}>请在外部浏览器中打开</div>
            <div style={{ opacity: 0.9, fontSize: 12 }}>点右上角 ··· → 选择「在浏览器打开」，数据同步才能正常工作</div>
          </div>
        </div>
      ) : null}

      <div className="header">
        {isMobile ? (
          <div className="header-top">
            <h1>{workspaceUser?.displayName || currentUser.displayName || currentUser.username}</h1>
            <div className="header-actions">
              {gistId ? <span className={`sync-pill ${syncStatus === "ok" ? "ok" : syncStatus === "error" ? "error" : "syncing"}`}>☁ {syncStatus === "ok" ? "已同步" : syncStatus === "error" ? "失败" : "同步中"}</span> : null}
              <button className="btn btn-ghost notification-trigger" onClick={openNotifications}>
                通知{unreadNotifications > 0 ? <span className="notification-badge">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span> : null}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>⚙</button>
              <button className="btn btn-ghost" onClick={() => setMobileDay(dateKey(new Date()))}>今日</button>
            </div>
          </div>
        ) : (
          <div className="header-desktop">
            <div className="header-brand">
              <div className="header-brand-mark">
                <img src="./assets/jiangsu-wenchuang-mark.png" alt="江苏文创" className="header-brand-logo" />
              </div>
              <div className="header-brand-copy">
                <h1>{workspaceUser?.id === currentUser?.id ? `${currentUser.displayName || currentUser.username} 的工作台` : `${workspaceUser?.displayName || workspaceUser?.username} 的工作台`}</h1>
              </div>
            </div>

            <div className="header-center">
              <div className="week-nav">
                <button className="week-nav-arrow" onClick={() => setWeekOffset((current) => current - 1)}>‹</button>
                <div className="week-nav-core">
                  <div className="week-info">{fmtDate(days[0])} - {fmtDate(days[6])}</div>
                  {weekOffset === 0 ? <span className="badge-week">本周</span> : null}
                  <button className="btn-today" onClick={scrollToToday}>今日</button>
                </div>
                <button className="week-nav-arrow" onClick={() => setWeekOffset((current) => current + 1)}>›</button>
              </div>
            </div>

            <div className="header-actions">
              {gistId ? <span className={`sync-pill ${syncStatus === "ok" ? "ok" : syncStatus === "error" ? "error" : "syncing"}`}>☁ {syncStatus === "ok" ? "已同步" : syncStatus === "error" ? "失败" : "同步中"}</span> : null}
              <button className="btn btn-ghost notification-trigger" onClick={openNotifications}>
                通知{unreadNotifications > 0 ? <span className="notification-badge">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span> : null}
              </button>
              {isAdmin && adminUsers.length ? (
                <select
                  className="workspace-select"
                  value={workspaceUser?.id || ""}
                  onChange={(event) => switchWorkspaceUser(adminUsers.find((user) => user.id === Number(event.target.value)))}
                >
                  {adminUsers.map((user) => (
                    <option key={user.id} value={user.id}>{user.displayName || user.username}</option>
                  ))}
                </select>
              ) : null}
              <button className="btn btn-ghost" onClick={handleLogout}>退出</button>
              <button className="btn btn-ghost" onClick={() => setShowArchive(true)}>已完结</button>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowSettings(true)}>⚙</button>
              <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ 新任务</button>
            </div>
          </div>
        )}
      </div>

      {remoteUpdate ? (
        <div className="sync-banner">
          <span>☁️ 云端发现新版本（{new Date(remoteUpdate._lastModified).toLocaleTimeString()}）。先决定保留本地还是使用云端，避免直接互相覆盖。</span>
          <div className="sync-banner-actions">
            <button className="btn btn-outline" onClick={keepLocalVersion}>保留本地</button>
            <button className="btn btn-dark" onClick={useCloudVersion}>使用云端</button>
            <button className="btn btn-outline" onClick={() => setRemoteUpdate(null)}>稍后处理</button>
          </div>
        </div>
      ) : null}

      {isMobile ? (
        <MobileView
          data={mobileTasks}
          categories={data.categories}
          mobileDay={mobileDay}
          setMobileDay={setMobileDay}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          filterCat={filterCat}
          setFilterCat={setFilterCat}
          getCellItems={getCellItems}
          onToggleItemDone={(taskId, day, index) => dispatch({ type: "toggleItemDone", taskId, day, index })}
          onRolloverItem={handleRolloverItem}
          onEditTask={setEditTask}
          onEditCell={setEditCell}
          setCellItems={setCellItems}
        />
      ) : (
        <div className="desktop-shell">
          <div className="filter-bar">
            {["全部", ...data.categories].map((category) => (
              <button
                key={category}
                className={`filter-btn ${filterCat === category ? "active" : ""}`}
                style={filterCat === category ? { background: category === "全部" ? "#1a1a2e" : catColor(category), borderColor: "transparent" } : {}}
                onClick={() => setFilterCat(category)}
              >
                {category}
              </button>
            ))}
            <div className="desktop-visibility-switch">
              <button className={`filter-btn visibility-toggle-btn ${desktopVisibility === "active" ? "active" : ""}`} onClick={() => setDesktopVisibility("active")}>
                仅活跃
              </button>
              <button className={`filter-btn visibility-toggle-btn ${desktopVisibility === "all" ? "active" : ""}`} onClick={() => setDesktopVisibility("all")}>
                含静默
              </button>
            </div>
            <div className="filter-search-wrap">
              <input className="search-input" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="🔍 搜索任务…" />
            </div>
          </div>

          <div className="main-area">
            <div className="day-header-row">
              <div className="corner-cell">事项 ({filteredTasks.length})</div>
              {days.map((date) => (
                <div key={date.toISOString()} ref={isToday(date) ? todayColRef : null} className={`day-cell ${isToday(date) ? "today" : ""}`}>
                  <div className="day-label">{dayLabel(date)}</div>
                  <div className="day-num">{date.getDate()}</div>
                </div>
              ))}
            </div>

            {desktopSections.map(({ category, activeTasks, silentTasks, total }) => (
              <React.Fragment key={category}>
                <div className="grid-container">
                  <div className="cat-header" style={{ background: `${catColor(category)}12`, borderLeft: `3px solid ${catColor(category)}`, color: catColor(category) }}>
                    <div className="cat-header-row">
                      <span>{category}（{total}）</span>
                      {silentTasks.length ? (
                        <button className="cat-toggle-btn" onClick={() => toggleSilentCategory(category)}>
                          {collapsedCategories[category] !== false ? `展开静默任务（${silentTasks.length}）` : `收起静默任务（${silentTasks.length}）`}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
                {activeTasks.map((task) => (
                  <div key={task.id} className="task-row">
                    <div className="task-info" style={{ borderLeftColor: catColor(task.category) }} onClick={() => setEditTask({ ...task })}>
                      <div className="task-name">{task.name}</div>
                      <div className="task-meta">
                        <PBadge priority={task.priority} small />
                        <SBadge status={task.status} small />
                        {formatDeadline(task) ? <span className="badge-deadline">截止:{formatDeadline(task)}</span> : null}
                      </div>
                      {task.responsible ? <div className="task-people">{task.responsible}{task.participants ? ` · ${task.participants}` : ""}</div> : null}
                    </div>
                    {days.map((date) => {
                      const day = dateKey(date);
                      const items = getCellItems(task, day);
                      const expandedKey = `${task.id}-${day}`;
                      const isExpanded = expandedCell === expandedKey;
                      return (
                        <div
                          key={day}
                          className={`daily-cell ${isToday(date) ? "today" : ""}`}
                          onClick={() => {
                            if (isExpanded) {
                              setExpandedCell(null);
                            } else if (items) {
                              setExpandedCell(expandedKey);
                            } else {
                              setEditCell({ taskId: task.id, day });
                              setCellItems([{ title: "", content: "", done: false }]);
                            }
                          }}
                        >
                          {items ? (
                            <>
                              {!isExpanded ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                  {items.map((item, index) => (
                                    <div key={`${expandedKey}-${index}`}>
                                      {renderCompactPlanItem(
                                        item,
                                        () => dispatch({ type: "toggleItemDone", taskId: task.id, day, index }),
                                        () => handleRolloverItem(task.id, day, index)
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="cell-expanded" onClick={(event) => event.stopPropagation()}>
                                  {items.map((item, index) => (
                                    <div key={`${expandedKey}-full-${index}`} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: index < items.length - 1 ? 10 : 0 }}>
                                      <div style={{ display: "flex", gap: 4, flexShrink: 0, marginTop: 2 }}>
                                        {renderPlanActionButton({
                                          label: "✓",
                                          active: item.done,
                                          activeColor: "#22c55e",
                                          title: item.done ? "取消完成" : "标记完成",
                                          onClick: () => dispatch({ type: "toggleItemDone", taskId: task.id, day, index })
                                        })}
                                        {renderPlanActionButton({
                                          label: "×",
                                          active: false,
                                          activeColor: "#ef4444",
                                          title: "未完成，平移到次日",
                                          onClick: () => handleRolloverItem(task.id, day, index)
                                        })}
                                      </div>
                                      <div style={{ opacity: item.done ? 0.5 : 1 }}>
                                        {item.title ? <div style={{ fontWeight: 600, fontSize: 12, color: "#333", marginBottom: 2, textDecoration: item.done ? "line-through" : "none" }}>{item.title}</div> : null}
                                        {item.content ? <div className="cell-expanded-text" style={{ textDecoration: item.done ? "line-through" : "none" }}>{item.content}</div> : null}
                                      </div>
                                    </div>
                                  ))}
                                  <div className="cell-expanded-actions">
                                    <button
                                      className="btn btn-outline"
                                      style={{ fontSize: 11, padding: "3px 10px" }}
                                      onClick={() => {
                                        setEditCell({ taskId: task.id, day });
                                        setCellItems(items.map((item) => ({ ...item })));
                                        setExpandedCell(null);
                                      }}
                                    >
                                      编辑
                                    </button>
                                    <button className="btn" style={{ fontSize: 11, padding: "3px 10px", background: "#f0f0f0", color: "#999", border: "none" }} onClick={() => setExpandedCell(null)}>
                                      收起
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="daily-cell-empty">+</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {(desktopVisibility === "all" || query) && (query || collapsedCategories[category] === false) ? (
                  silentTasks.map((task) => (
                    <div key={task.id} className="task-row task-row-muted">
                      <div className="task-info task-info-muted" style={{ borderLeftColor: catColor(task.category) }} onClick={() => setEditTask({ ...task })}>
                        <div className="task-name">{task.name}</div>
                        <div className="task-meta">
                          <PBadge priority={task.priority} small />
                          <SBadge status={task.status} small />
                          {formatDeadline(task) ? <span className="badge-deadline">截止:{formatDeadline(task)}</span> : null}
                        </div>
                        {task.responsible ? <div className="task-people">{task.responsible}{task.participants ? ` · ${task.participants}` : ""}</div> : null}
                      </div>
                      {days.map((date) => {
                        const day = dateKey(date);
                        const items = getCellItems(task, day);
                        return (
                          <div
                            key={`${task.id}-${day}`}
                            className={`daily-cell ${isToday(date) ? "today" : ""}`}
                            onClick={() => {
                              if (!items) {
                                setEditCell({ taskId: task.id, day });
                                setCellItems([{ title: "", content: "", done: false }]);
                              }
                            }}
                          >
                            {items ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                {items.map((item, index) => (
                                  <div key={`${task.id}-${day}-silent-${index}`}>
                                    {renderCompactPlanItem(
                                      item,
                                      () => dispatch({ type: "toggleItemDone", taskId: task.id, day, index }),
                                      () => handleRolloverItem(task.id, day, index)
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="daily-cell-empty daily-cell-empty-muted">+</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))
                ) : null}
              </React.Fragment>
            ))}

            {filteredTasks.length === 0 ? <div className="empty-grid-state">暂无匹配任务，点击右上角“+ 新任务”添加</div> : null}
          </div>
        </div>
      )}

      {isMobile ? (
        <div className="mobile-bottom-bar">
          <button className="mobile-bottom-btn" onClick={() => setMobileDay(dateKey(new Date()))}>
            <span className="mobile-bottom-icon">◉</span>
            <span>今天</span>
          </button>
          <button className="mobile-bottom-btn" onClick={() => setShowArchive(true)}>
            <span className="mobile-bottom-icon">✓</span>
            <span>归档</span>
          </button>
          <button className="mobile-bottom-btn" onClick={openNotifications}>
            <span className="mobile-bottom-icon">＠</span>
            <span>通知{unreadNotifications > 0 ? `(${unreadNotifications > 99 ? "99+" : unreadNotifications})` : ""}</span>
          </button>
          <button className="mobile-bottom-btn mobile-bottom-btn-primary" onClick={() => setShowAdd(true)}>
            <span className="mobile-bottom-icon">＋</span>
            <span>新任务</span>
          </button>
          <button className="mobile-bottom-btn" onClick={() => setShowSettings(true)}>
            <span className="mobile-bottom-icon">⚙</span>
            <span>设置</span>
          </button>
        </div>
      ) : null}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="添加新任务">
        <TaskForm task={newTask} setTask={setNewTask} categories={data.categories} mentionUsers={mentionUsers} />
        <button className="btn btn-dark btn-block" onClick={handleAddTask}>添加</button>
      </Modal>

      <Modal open={Boolean(editTask)} onClose={() => setEditTask(null)} title="编辑任务">
        {editTask ? (
          <>
            <TaskForm task={editTask} setTask={setEditTask} categories={data.categories} mentionUsers={mentionUsers} />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button className="btn btn-dark" style={{ flex: 1, padding: 11, borderRadius: 10, fontSize: 14 }} onClick={handleSaveTaskEdit}>保存</button>
              {taskHasMentions(editTask) ? (
                <button className="btn btn-outline" style={{ padding: "11px 16px", borderRadius: 10, fontSize: 14 }} onClick={() => handleCompleteMentionTask(editTask)}>任务已完成</button>
              ) : null}
              <button className="btn btn-success" style={{ padding: "11px 16px", borderRadius: 10, fontSize: 14 }} onClick={() => dispatch({ type: "archiveTask", id: editTask.id })}>完结归档</button>
              <button
                className="btn btn-danger"
                style={{ padding: "11px 16px", borderRadius: 10, fontSize: 14 }}
                onClick={() => askConfirm({
                  title: "删除任务",
                  message: "任务本体和所有每日计划都会被删除。",
                  confirmLabel: "确认删除",
                  confirmTone: "danger",
                  onConfirm: () => {
                    dispatch({ type: "deleteTask", id: editTask.id, archived: false });
                    setEditTask(null);
                    setConfirmState(null);
                    pushToast("任务已删除", "warning");
                  }
                })}
              >
                删除
              </button>
            </div>
          </>
        ) : null}
      </Modal>

      <Modal open={Boolean(editCell)} onClose={() => { setEditCell(null); setCellItems([{ title: "", content: "", done: false }]); }} title="编辑当日计划" width={420}>
        {editCell ? (
          <>
            <div style={{ fontSize: 12, color: "#999", marginBottom: 12 }}>
              {data.tasks.find((task) => task.id === editCell.taskId)?.name} · {editCell.day}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {cellItems.map((item, index) => (
                <div key={`editor-${index}`} className="plan-editor-card">
                  <div className="plan-editor-head">
                    <span className="plan-editor-title">计划 {index + 1}</span>
                    {cellItems.length > 1 ? (
                      <button className="ghost-icon-btn" onClick={() => setCellItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                    ) : null}
                  </div>
                  <input
                    className="field-input"
                    style={{ marginBottom: 6 }}
                    placeholder="标题（显示在日历格中）"
                    value={item.title}
                    onChange={(event) => setCellItems((current) => current.map((it, itemIndex) => (itemIndex === index ? { ...it, title: event.target.value } : it)))}
                  />
                  <textarea
                    className="field-textarea"
                    rows={2}
                    placeholder="详细内容（可选）"
                    value={item.content}
                    onChange={(event) => setCellItems((current) => current.map((it, itemIndex) => (itemIndex === index ? { ...it, content: event.target.value } : it)))}
                  />
                  <MentionPicker users={mentionUsers} onMention={(user) => appendMentionToPlan(index, user)} />
                  {planHasMentions(item) ? (
                    <div className="plan-editor-actions">
                      <button className="btn btn-outline" onClick={() => handleCompleteMentionPlan(index)}>任务已完成</button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <button className="plan-add-btn" onClick={() => setCellItems((current) => [...current, { title: "", content: "", done: false }])}>+ 添加计划</button>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button className="btn btn-dark" style={{ flex: 1, padding: 11, borderRadius: 10, fontSize: 14 }} onClick={handleSaveCellEdit}>保存</button>
              <button
                className="btn btn-danger"
                style={{ padding: "11px 16px", borderRadius: 10, fontSize: 14 }}
                onClick={() => {
                  dispatch({ type: "saveCellItems", taskId: editCell.taskId, day: editCell.day, items: [] });
                  setEditCell(null);
                  setCellItems([{ title: "", content: "", done: false }]);
                  pushToast("计划已清除", "warning");
                }}
              >
                清除
              </button>
            </div>
          </>
        ) : null}
      </Modal>

      <Modal open={showArchive} onClose={() => setShowArchive(false)} title={`已完结任务 (${data.archivedTasks.length})`} width={440}>
        {data.archivedTasks.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "#bbb" }}>暂无已完结任务</div>
        ) : (
          <>
            <div className="archive-toolbar">
              <input
                className="archive-search-input"
                value={archiveQuery}
                onChange={(event) => setArchiveQuery(event.target.value)}
                placeholder="搜索已完成任务…"
              />
              <select className="archive-filter-select" value={archiveCategory} onChange={(event) => setArchiveCategory(event.target.value)}>
                {["全部", ...data.categories].map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              <select className="archive-filter-select" value={archiveSort} onChange={(event) => setArchiveSort(event.target.value)}>
                <option value="latest">最近归档</option>
                <option value="earliest">最早归档</option>
                <option value="category">按分类</option>
              </select>
            </div>
            <div style={{ maxHeight: "60vh", overflow: "auto" }}>
            {archiveTasks.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "#bbb" }}>没有匹配的已完成任务</div>
            ) : archiveTasks.map((task) => (
              <div key={task.id} className="archive-item">
                <div className="archive-main">
                  <div className="archive-name">{task.name}</div>
                  <div className="archive-meta">{task.category} · 归档于 {task.archivedAt ? new Date(task.archivedAt).toLocaleDateString() : ""}</div>
                  <div className="archive-meta">
                    {task.responsible ? `负责人：${task.responsible}` : "负责人：未填写"}
                    {formatDeadline(task) ? ` · 截止：${formatDeadline(task)}` : ""}
                  </div>
                  {getLatestPlanSummary(task) ? <div className="archive-summary">最近计划：{getLatestPlanSummary(task)}</div> : null}
                </div>
                <div className="archive-actions">
                  <button className="btn btn-outline" style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6 }} onClick={() => openArchiveDetail(task)}>历史计划</button>
                  <button className="btn btn-outline" style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6 }} onClick={() => dispatch({ type: "restoreTask", id: task.id })}>恢复</button>
                  <button className="btn btn-outline" style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6 }} onClick={() => duplicateArchivedTask(task)}>复制</button>
                  <button
                    className="btn btn-danger"
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6 }}
                    onClick={() => askConfirm({
                      title: "删除归档任务",
                      message: "归档记录将被永久删除。",
                      confirmLabel: "确认删除",
                      confirmTone: "danger",
                      onConfirm: () => {
                        dispatch({ type: "deleteArchivedTask", id: task.id });
                        setConfirmState(null);
                        pushToast("归档任务已删除", "warning");
                      }
                    })}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
            </div>
          </>
        )}
      </Modal>

      <Modal open={Boolean(archiveDetailTask)} onClose={() => setArchiveDetailTask(null)} title={archiveDetailTask ? `${archiveDetailTask.name} · 历史计划` : "历史计划"} width={520}>
        {archiveDetailTask ? (
          <>
            <div className="archive-detail-meta">
              <div><strong>分类：</strong>{archiveDetailTask.category}</div>
              <div><strong>归档时间：</strong>{archiveDetailTask.archivedAt ? new Date(archiveDetailTask.archivedAt).toLocaleString() : "未记录"}</div>
              <div><strong>截止日期：</strong>{formatDeadline(archiveDetailTask) || "未设置"}</div>
            </div>
            {getArchivePlanDays(archiveDetailTask).length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "#bbb" }}>这个任务没有历史计划记录</div>
            ) : (
              <div className="archive-plan-list">
                {getArchivePlanDays(archiveDetailTask).map(([day, items]) => (
                  <div key={`${archiveDetailTask.id}-${day}`} className="archive-plan-day">
                    <div className="archive-plan-day-label">{formatDateInput(day)}</div>
                    <div className="archive-plan-items">
                      {items.map((item, index) => (
                        <div key={`${archiveDetailTask.id}-${day}-${index}`} className="archive-plan-item">
                          <div className={`archive-plan-check ${item.done ? "done" : ""}`}>{item.done ? "✓" : ""}</div>
                          <div className="archive-plan-copy">
                            <div className={`archive-plan-title ${item.done ? "done" : ""}`}>{item.title || item.content.split("\n")[0]}</div>
                            {item.title && item.content ? <div className={`archive-plan-detail ${item.done ? "done" : ""}`}>{item.content}</div> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </Modal>

      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="设置" width={420}>
        <div className="data-section" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
          <div className="data-section-title">☁️ 服务端同步</div>
          <div className="status-box">
            <div><strong>同步方式：</strong>Alibaba Cloud API + MySQL</div>
            <div><strong>当前工作空间：</strong>{gistId}</div>
            <div><strong>同步状态：</strong>{syncStatus === "ok" ? "已同步" : syncStatus === "error" ? "连接失败" : "同步中"}</div>
          </div>
          <p className="settings-note" style={{ marginTop: 10 }}>
            当前版本以服务端数据库作为唯一真实数据源。本地 localStorage 继续保留用于缓存和备份，不再使用 GitHub Gist 作为主同步方式。
          </p>
          <div className="inline-actions">
            <button className="btn btn-outline" onClick={pullFromCloud}>↓ 从服务端刷新</button>
            <button className="btn btn-outline" onClick={handleLogout}>退出登录</button>
          </div>
        </div>

        {isAdmin ? (
          <div className="data-section">
            <div className="data-section-title">账号管理</div>
            <form className="admin-user-form" onSubmit={handleCreateAdminUser}>
              <input
                className="field-input"
                value={adminUserForm.username}
                onChange={(event) => setAdminUserForm((current) => ({ ...current, username: event.target.value }))}
                placeholder="账号，如 zhangsan"
              />
              <input
                className="field-input"
                value={adminUserForm.displayName}
                onChange={(event) => setAdminUserForm((current) => ({ ...current, displayName: event.target.value }))}
                placeholder="显示名"
              />
              <input
                className="field-input"
                type="password"
                value={adminUserForm.password}
                onChange={(event) => setAdminUserForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="初始密码，至少 8 位"
              />
              <select
                className="field-select"
                value={adminUserForm.role}
                onChange={(event) => setAdminUserForm((current) => ({ ...current, role: event.target.value }))}
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
              <button className="btn btn-dark" type="submit">创建账号</button>
            </form>
            <div className="admin-user-list">
              {adminUsers.map((user) => (
                <div key={user.id} className="admin-user-row">
                  <div className="admin-user-main">
                    <div className="admin-user-name">{user.displayName || user.username}</div>
                    <div className="admin-user-meta">
                      {user.username} · {user.role === "admin" ? "管理员" : "普通用户"} · {user.isActive ? "启用" : "停用"}
                    </div>
                  </div>
                  <div className="admin-user-actions">
                    <button className="btn btn-outline" onClick={() => switchWorkspaceUser(user)}>工作台</button>
                    <button className="btn btn-outline" onClick={() => handleResetUserPassword(user)}>重置密码</button>
                    <button className="btn btn-danger" onClick={() => handleToggleUserActive(user)} disabled={user.id === currentUser?.id}>
                      {user.isActive ? "停用" : "启用"}
                    </button>
                    <button className="btn btn-danger" onClick={() => handleDeleteAdminUser(user)} disabled={user.id === currentUser?.id}>
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="data-section">
          <div className="data-section-title">本地数据</div>
          <div className="data-actions">
            <button className="btn btn-primary" onClick={exportData}>📤 导出</button>
            <button className="btn btn-outline" onClick={() => fileRef.current?.click()}>📥 导入</button>
            <button className="btn btn-danger" onClick={resetDataWithBackup}>🗑 重置</button>
          </div>
        </div>

        <div className="data-section">
          <div className="data-section-title">本地备份</div>
          <div className="status-box">
            {backupInfo ? (
              <>
                <div><strong>最近备份：</strong>{new Date(backupInfo.savedAt).toLocaleString()}</div>
                <div><strong>原因：</strong>{backupInfo.reason}</div>
              </>
            ) : (
              <div>当前没有本地备份。</div>
            )}
          </div>
          <div className="inline-actions">
            <button className="btn btn-outline" onClick={restoreBackup}>恢复最近备份</button>
          </div>
        </div>

        <div className="data-section">
          <div className="data-section-title">分类管理</div>
          <div className="settings-note">分类顺序会同步到顶部标签栏和新增任务表单。删除分类时，系统会先要求你把现有任务迁移到其他分类，不会直接丢失任务。</div>
          <div className="category-admin-list">
            {data.categories.map((category, index) => (
              <div key={category} className="category-admin-row">
                <div className="category-admin-name">
                  <span className="category-admin-dot" style={{ background: catColor(category) }} />
                  <span>{category}</span>
                </div>
                <div className="category-admin-actions">
                  <button className="btn btn-outline" onClick={() => moveCategory(category, -1)} disabled={index === 0}>上移</button>
                  <button className="btn btn-outline" onClick={() => moveCategory(category, 1)} disabled={index === data.categories.length - 1}>下移</button>
                  <button className="btn btn-outline" onClick={() => renameCategory(category)}>重命名</button>
                  <button className="btn btn-danger" onClick={() => removeCategory(category)}>删除</button>
                </div>
              </div>
            ))}
          </div>
          <div className="inline-actions">
            <button className="btn btn-dark" onClick={addCategory}>新增分类</button>
          </div>
        </div>

        <div className="data-section">
          <div className="data-section-title">使用说明</div>
          <div className="settings-note">
            <p>1. 数据会优先写入服务端，再同步到其他设备，跨端一致性会比 Gist 方案稳定。</p>
            <p>2. 如果其他设备已经写入了新版本，顶部仍会提示你决定保留本地还是采用服务端版本。</p>
            <p>3. 导入、重置、覆盖服务端版本之前，系统仍会自动保留一份本地备份。</p>
          </div>
        </div>
      </Modal>

      <Modal open={showNotifications} onClose={() => setShowNotifications(false)} title="通知" width={460}>
        <div className="notification-panel">
          {notifications.length === 0 ? (
            <div className="notification-empty">暂无通知</div>
          ) : notifications.map((notification) => (
            <div key={notification.id} className={`notification-item ${notification.readAt ? "" : "unread"} ${notification.completedAt ? "completed" : ""}`}>
              <div className="notification-item-head">
                <span>{notification.completedAt ? `${notificationCompletedByLabel(notification)} 标记任务已完成` : `${notificationActorLabel(notification)} 提到了你`}</span>
                <time>{notification.createdAt ? new Date(notification.createdAt).toLocaleString() : ""}</time>
              </div>
              <div className="notification-item-title">{notification.sourceTitle}</div>
              {notification.sourceContent ? <div className="notification-item-content">{notification.sourceContent}</div> : null}
              <div className="notification-item-meta">
                {notificationMeta(notification)}
                {notification.completedAt ? ` · 已完成 ${new Date(notification.completedAt).toLocaleString()}` : ""}
              </div>
              {!notification.completedAt ? (
                <div className="notification-item-actions">
                  <button className="btn btn-outline" onClick={() => handleCompleteNotification(notification)}>任务已完成</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        confirmTone={confirmState?.confirmTone}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
      />

      <ToastStack toasts={toasts} />
      <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImportFile} />
    </>
  );
}

function renderCompactPlanItem(item, onToggle, onRollover) {
  const label = item.title || item.content.split("\n")[0];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {renderPlanActionButton({
        label: "✓",
        active: item.done,
        activeColor: "#22c55e",
        title: item.done ? "取消完成" : "标记完成",
        onClick: onToggle
      })}
      {renderPlanActionButton({
        label: "×",
        active: false,
        activeColor: "#ef4444",
        title: "未完成，平移到次日",
        onClick: onRollover
      })}
      <span
        style={{
          fontSize: 12,
          lineHeight: 1.4,
          color: item.done ? "#aaa" : "#333",
          textDecoration: item.done ? "line-through" : "none",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {label}
      </span>
    </div>
  );
}

function renderPlanActionButton({ label, active, activeColor, title, onClick }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      style={{
        flexShrink: 0,
        width: 14,
        height: 14,
        borderRadius: 3,
        border: `1.5px solid ${active ? activeColor : "#ccc"}`,
        background: active ? activeColor : "transparent",
        color: active ? "#fff" : activeColor,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        padding: 0,
        fontSize: 10,
        lineHeight: 1,
        fontWeight: 700
      }}
    >
      {active || label === "×" ? label : ""}
    </button>
  );
}

createRoot(document.getElementById("app")).render(<App />);
