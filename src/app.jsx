import React, { useEffect, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CATEGORIES,
  createEmptyTask,
  dateKey,
  dayLabel,
  defaultData,
  fmtDate,
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
  getSavedGistId,
  getSessionToken,
  gistCreate,
  gistLoad,
  gistUpdate,
  setSavedGistId,
  setSessionToken
} from "./sync.js";
import { ConfirmDialog, Modal, MobileView, PBadge, SBadge, TaskForm, ToastStack } from "./components.jsx";

function dataReducer(state, action) {
  switch (action.type) {
    case "replace":
      return updateTimestamp(action.data);

    case "addTask":
      return updateTimestamp({
        ...state,
        tasks: [...state.tasks, normalizeData({ tasks: [{ ...action.task, id: genId(), dailyActions: {} }], archivedTasks: [] }).tasks[0]]
      });

    case "updateTask":
      return updateTimestamp({
        ...state,
        tasks: state.tasks.map((task) => (task.id === action.task.id ? normalizeData({ tasks: [{ ...task, ...action.task }], archivedTasks: [] }).tasks[0] : task))
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

    default:
      return state;
  }
}

function createToast(message, type = "success") {
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), message, type };
}

function App() {
  const [data, dispatch] = useReducer(dataReducer, undefined, loadData);
  const [weekOffset, setWeekOffset] = useState(0);
  const [filterCat, setFilterCat] = useState("全部");
  const [showAdd, setShowAdd] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [editCell, setEditCell] = useState(null);
  const [cellItems, setCellItems] = useState([{ title: "", content: "", done: false }]);
  const [expandedCell, setExpandedCell] = useState(null);
  const [newTask, setNewTask] = useState(createEmptyTask);
  const [gistToken, setGistToken] = useState(() => getSessionToken());
  const [gistId, setGistId] = useState(() => getSavedGistId());
  const [syncStatus, setSyncStatus] = useState("idle");
  const [tokenInput, setTokenInput] = useState("");
  const [remoteUpdate, setRemoteUpdate] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const [mobileDay, setMobileDay] = useState(() => dateKey(new Date()));
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [backupInfo, setBackupInfo] = useState(() => loadBackup());
  const fileRef = useRef(null);
  const syncTimerRef = useRef(null);
  const todayColRef = useRef(null);

  function pushToast(message, type = "success") {
    setToasts((current) => [...current, createToast(message, type)]);
  }

  useEffect(() => {
    if (!toasts.length) return undefined;
    const timer = setTimeout(() => {
      setToasts((current) => current.slice(1));
    }, 3200);
    return () => clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    saveData(data);
  }, [data]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!gistToken || !gistId) return undefined;

    let active = true;
    setSyncStatus("syncing");

    gistLoad(gistToken, gistId)
      .then((remote) => {
        if (!active || !remote?.tasks) {
          if (active) setSyncStatus("error");
          return;
        }

        const normalizedRemote = normalizeData(remote);
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
        if (normalizedRemote._lastModified > data._lastModified + 5000) {
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
  }, [gistToken, gistId, data._lastModified]);

  useEffect(() => {
    if (!gistToken || !gistId) return undefined;
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
  }, [data, gistId, gistToken, remoteUpdate]);

  const monday = getMonday(new Date());
  monday.setDate(monday.getDate() + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    return date;
  });

  const query = searchQuery.trim().toLowerCase();
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

  const groupedTasks = filteredTasks.reduce((accumulator, task) => {
    if (!accumulator[task.category]) accumulator[task.category] = [];
    accumulator[task.category].push(task);
    return accumulator;
  }, {});

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

  function askConfirm({ title, message, confirmLabel, confirmTone = "dark", onConfirm }) {
    setConfirmState({ title, message, confirmLabel, confirmTone, onConfirm });
  }

  function resetNewTask() {
    setNewTask(createEmptyTask());
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
        <div className="header-top">
          <h1>📋 {isMobile ? "工作管理" : "刘昊的工作管理系统"}</h1>
          <div className="header-actions">
            {gistId ? <span className={`sync-pill ${syncStatus === "ok" ? "ok" : syncStatus === "error" ? "error" : "syncing"}`}>☁ {syncStatus === "ok" ? "已同步" : syncStatus === "error" ? "失败" : "同步中"}</span> : null}
            <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>⚙</button>
            {!isMobile ? <button className="btn btn-ghost" onClick={() => setShowArchive(true)}>已完结</button> : null}
            {isMobile ? <button className="btn btn-ghost" onClick={() => setMobileDay(dateKey(new Date()))}>今日</button> : null}
            {!isMobile ? <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ 新任务</button> : null}
          </div>
        </div>
        {!isMobile ? (
          <div className="week-nav">
            <button onClick={() => setWeekOffset((current) => current - 1)}>‹</button>
            <div className="week-info">
              {fmtDate(days[0])} - {fmtDate(days[6])}
              {weekOffset === 0 ? <span className="badge-week">本周</span> : null}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn-today" onClick={scrollToToday}>今日</button>
              <button onClick={() => setWeekOffset((current) => current + 1)}>›</button>
            </div>
          </div>
        ) : null}
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
          mobileDay={mobileDay}
          setMobileDay={setMobileDay}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          filterCat={filterCat}
          setFilterCat={setFilterCat}
          getCellItems={getCellItems}
          onToggleItemDone={(taskId, day, index) => dispatch({ type: "toggleItemDone", taskId, day, index })}
          onEditTask={setEditTask}
          onEditCell={setEditCell}
          setCellItems={setCellItems}
        />
      ) : (
        <>
          <div className="filter-bar">
            {["全部", ...CATEGORIES].map((category) => (
              <button
                key={category}
                className={`filter-btn ${filterCat === category ? "active" : ""}`}
                style={filterCat === category ? { background: category === "全部" ? "#1a1a2e" : catColor(category), borderColor: "transparent" } : {}}
                onClick={() => setFilterCat(category)}
              >
                {category}
              </button>
            ))}
            <div style={{ marginLeft: "auto", flexShrink: 0 }}>
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

            {Object.entries(groupedTasks).map(([category, tasks]) => (
              <React.Fragment key={category}>
                <div className="grid-container">
                  <div className="cat-header" style={{ background: `${catColor(category)}12`, borderLeft: `3px solid ${catColor(category)}`, color: catColor(category) }}>
                    {category}（{tasks.length}）
                  </div>
                </div>
                {tasks.map((task) => (
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
                                      {renderCompactPlanItem(item, () => dispatch({ type: "toggleItemDone", taskId: task.id, day, index }))}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="cell-expanded" onClick={(event) => event.stopPropagation()}>
                                  {items.map((item, index) => (
                                    <div key={`${expandedKey}-full-${index}`} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: index < items.length - 1 ? 10 : 0 }}>
                                      <span
                                        onClick={() => dispatch({ type: "toggleItemDone", taskId: task.id, day, index })}
                                        style={{
                                          flexShrink: 0,
                                          marginTop: 2,
                                          width: 14,
                                          height: 14,
                                          borderRadius: 3,
                                          border: `1.5px solid ${item.done ? "#22c55e" : "#ccc"}`,
                                          background: item.done ? "#22c55e" : "transparent",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          cursor: "pointer"
                                        }}
                                      >
                                        {item.done ? <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span> : null}
                                      </span>
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
              </React.Fragment>
            ))}

            {filteredTasks.length === 0 ? <div className="empty-grid-state">暂无匹配任务，点击右上角“+ 新任务”添加</div> : null}
          </div>
        </>
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
        <TaskForm task={newTask} setTask={setNewTask} />
        <button className="btn btn-dark btn-block" onClick={handleAddTask}>添加</button>
      </Modal>

      <Modal open={Boolean(editTask)} onClose={() => setEditTask(null)} title="编辑任务">
        {editTask ? (
          <>
            <TaskForm task={editTask} setTask={setEditTask} />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button className="btn btn-dark" style={{ flex: 1, padding: 11, borderRadius: 10, fontSize: 14 }} onClick={handleSaveTaskEdit}>保存</button>
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
          <div style={{ maxHeight: "60vh", overflow: "auto" }}>
            {sortTasks(data.archivedTasks).map((task) => (
              <div key={task.id} className="archive-item">
                <div>
                  <div className="archive-name">{task.name}</div>
                  <div className="archive-meta">{task.category} · 归档于 {task.archivedAt ? new Date(task.archivedAt).toLocaleDateString() : ""}</div>
                </div>
                <div className="archive-actions">
                  <button className="btn btn-outline" style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6 }} onClick={() => dispatch({ type: "restoreTask", id: task.id })}>恢复</button>
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
        )}
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
          </div>
        </div>

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
          <div className="data-section-title">使用说明</div>
          <div className="settings-note">
            <p>1. 数据会优先写入服务端，再同步到其他设备，跨端一致性会比 Gist 方案稳定。</p>
            <p>2. 如果其他设备已经写入了新版本，顶部仍会提示你决定保留本地还是采用服务端版本。</p>
            <p>3. 导入、重置、覆盖服务端版本之前，系统仍会自动保留一份本地备份。</p>
          </div>
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

function renderCompactPlanItem(item, onToggle) {
  const label = item.title || item.content.split("\n")[0];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        style={{
          flexShrink: 0,
          width: 14,
          height: 14,
          borderRadius: 3,
          border: `1.5px solid ${item.done ? "#22c55e" : "#ccc"}`,
          background: item.done ? "#22c55e" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer"
        }}
      >
        {item.done ? <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span> : null}
      </span>
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

createRoot(document.getElementById("app")).render(<App />);
