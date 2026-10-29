/* 定时任务视图：与 MCP/技能同级的独立管理页 */
import React, { useEffect, useState } from "react";
import { useStore, toast, confirmDialog } from "../lib/store.js";
import { api } from "../lib/api.js";
import { Modal } from "./Common.jsx";
import { t, useLang } from "../lib/i18n.js";

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function TaskModal({ initial, onClose, onSaved }) {
  const { sessions } = useStore();
  const [name, setName] = useState(initial?.name || "");
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [sessionId, setSessionId] = useState(initial?.session_id || sessions?.[0]?.id || "");
  const [kind, setKind] = useState(initial?.kind || "interval");
  const [intervalMinutes, setIntervalMinutes] = useState(initial?.interval_minutes || 60);
  const [dailyAt, setDailyAt] = useState(initial?.daily_at || "09:00");
  const editing = !!initial;

  const save = async () => {
    if (!name.trim() || !prompt.trim()) { toast(t("名称与提示词不能为空"), "error"); return; }
    if (!sessionId) { toast(t("请选择目标会话"), "error"); return; }
    const body = { name, prompt, session_id: sessionId, kind,
      interval_minutes: Number(intervalMinutes) || 60, daily_at: dailyAt };
    if (editing) await api.put(`/api/tasks/${initial.id}`, body);
    else await api.post("/api/tasks", body);
    toast(editing ? t("已保存") : t("任务已创建"));
    onSaved();
    onClose();
  };

  return (
    <Modal title={editing ? t("编辑任务") : t("新建任务")} onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>{t("取消")}</button>
        <button className="btn btn-primary" onClick={save}>{t("保存")}</button>
      </>
    }>
      <div className="field">
        <label>{t("任务名称")}</label>
        <input value={name} placeholder={t("例如：每日会话总结")} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>{t("执行频率")}</label>
        <div className="seg-row">
          <button type="button" className={`seg ${kind === "interval" ? "on" : ""}`}
            onClick={() => setKind("interval")}>{t("间隔")}</button>
          <button type="button" className={`seg ${kind === "daily" ? "on" : ""}`}
            onClick={() => setKind("daily")}>{t("每日")}</button>
        </div>
        {kind === "interval" ? (
          <div className="inline-field">
            <input type="number" min={1} max={1440} value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(e.target.value)} />
            <span>{t("分钟一次")}</span>
          </div>
        ) : (
          <div className="inline-field">
            <input type="time" value={dailyAt} onChange={(e) => setDailyAt(e.target.value)} />
            <span>{t("每天这个时间执行")}</span>
          </div>
        )}
      </div>
      <div className="field">
        <label>{t("目标会话")}</label>
        <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
          {(sessions || []).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </div>
      <div className="field">
        <label>{t("提示词（会作为用户消息发给该会话）")}</label>
        <textarea rows={4} value={prompt}
          placeholder={t("例如：总结一下本会话目前的要点，输出待办清单。")}
          onChange={(e) => setPrompt(e.target.value)} />
      </div>
    </Modal>
  );
}

export default function TasksView() {
  useLang();
  const [tasks, setTasks] = useState([]);
  const [editing, setEditing] = useState(null);
  const { sessions } = useStore();
  const load = async () => setTasks(await api.get("/api/tasks"));
  useEffect(() => { load(); }, []);

  const toggle = async (task) => {
    await api.put(`/api/tasks/${task.id}`, { enabled: !task.enabled });
    load();
  };
  const del = async (task) => {
    const yes = await confirmDialog(t("删除任务"), t("删除「{name}」？", { name: task.name }), { danger: true });
    if (!yes) return;
    await api.del(`/api/tasks/${task.id}`);
    toast(t("已删除"));
    load();
  };
  const runNow = async (task) => {
    try {
      await api.post(`/api/tasks/${task.id}/run`, {});
      toast(t("已执行，结果写入目标会话"));
      load();
    } catch (e) { toast(e.message, "error"); }
  };

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>{t("定时任务")}</h1>
          <p className="subline">{t("按周期把一段提示词发到指定会话，由 AI 生成并落库。")}</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-primary" disabled={!sessions?.length}
            onClick={() => setEditing({})}>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {t("新建任务")}
          </button>
        </div>
      </div>

      {tasks.length === 0 && (
        <div className="empty-block"><div className="ec-title">{t("还没有定时任务")}</div>
          <div>{t("例如：每天 9 点总结昨日会话。")}</div></div>
      )}
      <div className="task-list">
        {tasks.map((task) => (
          <div className={`task-item ${task.enabled ? "" : "off"}`} key={task.id}>
            <div className="task-main">
              <div className="task-name">
                {task.kind === "daily"
                  ? t("每日 {t}", { t: task.daily_at })
                  : t("每 {n} 分钟", { n: task.interval_minutes })}
                <span className="task-title">{task.name}</span>
              </div>
              <div className="task-prompt">{task.prompt}</div>
              <div className="task-meta">
                {t("目标会话")} {sessions?.find((s) => s.id === task.session_id)?.title || task.session_id}
                {task.next_run ? ` · ${t("下次")} ${fmtTime(task.next_run)}` : ""}
                {task.run_count ? ` · ${t("已跑 {n} 次", { n: task.run_count })}` : ""}
                {task.last_ok === false ? ` · ${t("上次失败")}` : ""}
              </div>
              {task.last_result && <div className="task-result">{task.last_result}</div>}
            </div>
            <div className="task-actions">
              <button className="btn btn-ghost" onClick={() => runNow(task)}>{t("立即运行")}</button>
              <button className="btn btn-ghost" onClick={() => setEditing(task)}>{t("编辑")}</button>
              <button className={`sw ${task.enabled ? "on" : ""}`} role="switch" aria-checked={task.enabled}
                aria-label={t("启停")} onClick={() => toggle(task)} />
              <button className="btn btn-danger" onClick={() => del(task)}>{t("删除")}</button>
            </div>
          </div>
        ))}
      </div>
      {editing !== null && (
        <TaskModal initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </div>
  );
}
