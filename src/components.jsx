import React from "react";
import { CATEGORIES, PRIORITY_OPTIONS, STATUS_OPTIONS, catColor, dateKey, dayLabel, formatDeadline, getMonday, isToday } from "./data.js";

export function PBadge({ priority, small = false }) {
  const cls = priority === "高" ? "badge-priority-high" : priority === "中" ? "badge-priority-mid" : "badge-priority-low";
  return <span className={`badge ${small ? "badge-sm" : ""} ${cls}`}>{priority}</span>;
}

export function SBadge({ status, small = false }) {
  const cls = status === "进行中" ? "badge-status-active" : status === "已完成" ? "badge-status-done" : "badge-status-pending";
  return <span className={`badge ${small ? "badge-sm" : ""} ${cls}`}>{status}</span>;
}

export function Modal({ open, onClose, title, width, children }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: width || 420 }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, value, onChange, placeholder, options, rows, type = "text", help }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {options ? (
        <select className="field-select" value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : rows ? (
        <textarea
          className="field-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={rows}
        />
      ) : (
        <input
          className="field-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type={type}
        />
      )}
      {help ? <div className="field-help">{help}</div> : null}
    </div>
  );
}

export function DeadlineField({ task, onChange }) {
  return (
    <div className="field">
      <label className="field-label">截止时间</label>
      <div className="segmented-control">
        {[
          { key: "none", label: "无" },
          { key: "date", label: "日期" },
          { key: "text", label: "说明" }
        ].map((option) => (
          <button
            key={option.key}
            type="button"
            className={`segmented-btn ${task.deadlineMode === option.key ? "active" : ""}`}
            onClick={() => onChange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {task.deadlineMode === "date" ? (
        <Field
          label=""
          type="date"
          value={task.deadlineDate}
          onChange={(value) => onChange("date", value)}
          help="日期型截止时间可以稳定排序。"
        />
      ) : null}
      {task.deadlineMode === "text" ? (
        <Field
          label=""
          value={task.deadlineText}
          onChange={(value) => onChange("text", value)}
          placeholder="如：本周五、持续、等对方确认"
          help="说明型截止时间适合不规则节点。"
        />
      ) : null}
      {task.deadlineMode === "none" ? <div className="field-help">不设置截止时间。</div> : null}
    </div>
  );
}

function renderPlanItem(item, onToggle, compact = false) {
  const label = item.title || item.content.split("\n")[0];
  return (
    <div
      key={`${label}-${item.content}`}
      style={{
        display: "flex",
        alignItems: compact ? "center" : "flex-start",
        gap: compact ? 4 : 10,
        padding: compact ? 0 : "6px 0",
        borderBottom: compact ? "none" : undefined
      }}
    >
      <span
        onClick={onToggle}
        style={{
          flexShrink: 0,
          width: compact ? 14 : 20,
          height: compact ? 14 : 20,
          marginTop: compact ? 0 : 2,
          borderRadius: compact ? 3 : 5,
          border: `${compact ? 1.5 : 2}px solid ${item.done ? "#22c55e" : "#ddd"}`,
          background: item.done ? "#22c55e" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer"
        }}
      >
        {item.done ? <span style={{ color: "#fff", fontSize: compact ? 10 : 13, lineHeight: 1 }}>✓</span> : null}
      </span>
      <div style={{ flex: 1, opacity: item.done ? 0.5 : 1 }}>
        {compact ? (
          <span
            style={{
              fontSize: 12,
              lineHeight: 1.4,
              color: item.done ? "#aaa" : "#333",
              textDecoration: item.done ? "line-through" : "none",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "block"
            }}
          >
            {label}
          </span>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#222", textDecoration: item.done ? "line-through" : "none", lineHeight: 1.4 }}>
              {label}
            </div>
            {item.title && item.content ? <div style={{ fontSize: 12, color: "#999", marginTop: 3, lineHeight: 1.5 }}>{item.content}</div> : null}
          </>
        )}
      </div>
    </div>
  );
}

export function MobileTaskCard({ task, day, getItems, onToggleItemDone, onEditTask, onEditCell, setCellItems }) {
  const items = getItems(task, day);
  const hasItems = items && items.length > 0;

  function openPlanEditor() {
    onEditCell({ taskId: task.id, day });
    setCellItems(hasItems ? items.map((item) => ({ ...item })) : [{ title: "", content: "", done: false }]);
  }

  return (
    <div className="mobile-task-card" style={{ borderLeftColor: catColor(task.category) }}>
      <div className="mobile-task-header">
        <div style={{ flex: 1, minWidth: 0 }} onClick={() => onEditTask({ ...task })}>
          <div className="mobile-task-name">{task.name}</div>
          <div className="mobile-task-badges">
            <PBadge priority={task.priority} small />
            <SBadge status={task.status} small />
            {formatDeadline(task) ? <span className="badge-deadline">截止:{formatDeadline(task)}</span> : null}
          </div>
        </div>
        <div className="mobile-task-quick-actions">
          <button className="mobile-mini-btn" onClick={openPlanEditor}>{hasItems ? "计划" : "记录"}</button>
          <button className="mobile-mini-btn" onClick={() => onEditTask({ ...task })}>编辑</button>
        </div>
      </div>
      <div className="mobile-plan-divider" />
      <div className="mobile-plan-area">
        {hasItems ? items.map((item, index) => (
          <div key={`${task.id}-${day}-${index}`} className="mobile-plan-item" style={{ borderBottom: index < items.length - 1 ? "1px solid #f5f5f5" : "none" }}>
            {renderPlanItem(item, () => onToggleItemDone(task.id, day, index))}
          </div>
        )) : null}
        <div className="mobile-plan-add" onClick={openPlanEditor}>+ {hasItems ? "添加计划" : "记录今日计划"}</div>
      </div>
    </div>
  );
}

export function MobileView({
  data,
  mobileDay,
  setMobileDay,
  searchQuery,
  setSearchQuery,
  filterCat,
  setFilterCat,
  getCellItems,
  onToggleItemDone,
  onEditTask,
  onEditCell,
  setCellItems
}) {
  const mobileDayObj = new Date(`${mobileDay}T00:00:00`);
  const monday = getMonday(mobileDayObj);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    return date;
  });

  return (
    <>
      <div className="mobile-toolbar">
        <div className="mobile-search">
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="🔍 搜索任务…" />
        </div>
        <div className="mobile-filter-strip">
          {["全部", ...CATEGORIES].map((category) => (
            <button
              key={category}
              className={`mobile-filter-chip ${filterCat === category ? "active" : ""}`}
              style={filterCat === category ? { background: category === "全部" ? "#1a1a2e" : catColor(category) } : {}}
              onClick={() => setFilterCat(category)}
            >
              {category}
            </button>
          ))}
        </div>
      </div>
      <div className="mobile-day-strip">
        <button
          onClick={() => {
            const previous = new Date(monday);
            previous.setDate(previous.getDate() - 7);
            setMobileDay(dateKey(previous));
          }}
          style={{ background: "none", border: "none", color: "#bbb", cursor: "pointer", fontSize: 20, padding: "0 4px", flexShrink: 0 }}
        >
          ‹
        </button>
        {days.map((date) => {
          const key = dateKey(date);
          return (
            <div
              key={key}
              onClick={() => setMobileDay(key)}
              className={`mobile-day-chip ${key === mobileDay ? "active" : ""} ${isToday(date) ? "today-chip" : ""}`}
            >
              <span className="mobile-day-chip-label">{dayLabel(date)}</span>
              <span className="mobile-day-chip-num">{date.getDate()}</span>
            </div>
          );
        })}
        <button
          onClick={() => {
            const next = new Date(monday);
            next.setDate(next.getDate() + 7);
            setMobileDay(dateKey(next));
          }}
          style={{ background: "none", border: "none", color: "#bbb", cursor: "pointer", fontSize: 20, padding: "0 4px", flexShrink: 0 }}
        >
          ›
        </button>
      </div>
      <div className="mobile-day-summary">
        <div>
          <div className="mobile-day-summary-label">{mobileDayObj.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" })}</div>
          <div className="mobile-day-summary-count">{data.length} 个任务</div>
        </div>
      </div>
      <div className="mobile-task-list">
        {data.length === 0 ? <div className="empty-mobile-state">没有匹配的任务</div> : null}
        {data.map((task) => (
          <MobileTaskCard
            key={task.id}
            task={task}
            day={mobileDay}
            getItems={getCellItems}
            onToggleItemDone={onToggleItemDone}
            onEditTask={onEditTask}
            onEditCell={onEditCell}
            setCellItems={setCellItems}
          />
        ))}
      </div>
    </>
  );
}

export function TaskForm({ task, setTask }) {
  function updateField(key, value) {
    setTask((current) => ({ ...current, [key]: value }));
  }

  function updateDeadline(mode, value = "") {
    if (mode === "none") {
      setTask((current) => ({ ...current, deadlineMode: "none", deadlineDate: "", deadlineText: "" }));
      return;
    }

    if (mode === "date") {
      setTask((current) => ({ ...current, deadlineMode: "date", deadlineDate: value || current.deadlineDate, deadlineText: "" }));
      return;
    }

    setTask((current) => ({ ...current, deadlineMode: "text", deadlineDate: "", deadlineText: value || current.deadlineText }));
  }

  return (
    <>
      <Field label="任务名称" value={task.name} onChange={(value) => updateField("name", value)} placeholder="如：朝天宫项目-现场测试" />
      <div className="field-row">
        <Field label="分类" value={task.category} onChange={(value) => updateField("category", value)} options={CATEGORIES} />
        <Field label="优先级" value={task.priority} onChange={(value) => updateField("priority", value)} options={PRIORITY_OPTIONS} />
      </div>
      <div className="field-row">
        <Field label="负责人" value={task.responsible} onChange={(value) => updateField("responsible", value)} placeholder="谁负责" />
        <Field label="参与人" value={task.participants} onChange={(value) => updateField("participants", value)} placeholder="协作方" />
      </div>
      <div className="field-row">
        <DeadlineField task={task} onChange={updateDeadline} />
        <Field label="状态" value={task.status} onChange={(value) => updateField("status", value)} options={STATUS_OPTIONS} />
      </div>
    </>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel, confirmTone = "dark", onConfirm, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title={title || "请确认"} width={400}>
      <div className="dialog-text">{message}</div>
      <div className="dialog-actions">
        <button className="btn btn-outline" onClick={onClose}>取消</button>
        <button className={`btn ${confirmTone === "danger" ? "btn-danger" : "btn-dark"}`} onClick={onConfirm}>{confirmLabel || "确认"}</button>
      </div>
    </Modal>
  );
}

export function ToastStack({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type || ""}`}>{toast.message}</div>
      ))}
    </div>
  );
}
