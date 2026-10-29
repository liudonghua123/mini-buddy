/* 记忆管理区块（设置页内）：列表 + 新增/编辑/删除 */
import React, { useEffect, useState } from "react";
import { toast, confirmDialog } from "../lib/store.js";
import { api } from "../lib/api.js";
import { Modal } from "./Common.jsx";
import { t } from "../lib/i18n.js";

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function MemoryModal({ initial, onClose, onSaved }) {
  const [content, setContent] = useState(initial?.content || "");
  const editing = !!initial;
  const save = async () => {
    if (!content.trim()) { toast(t("内容不能为空"), "error"); return; }
    if (editing) await api.put(`/api/memories/${initial.id}`, { content });
    else await api.post("/api/memories", { content });
    toast(editing ? t("已保存") : t("记忆已保存"));
    onSaved();
    onClose();
  };
  return (
    <Modal title={editing ? t("编辑记忆") : t("新增记忆")} onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>{t("取消")}</button>
        <button className="btn btn-primary" onClick={save}>{t("保存")}</button>
      </>
    }>
      <div className="field">
        <label>{t("记忆内容")}</label>
        <textarea rows={4} value={content} autoFocus
          placeholder={t("例如：我喜欢简洁的回复；我的时区是 UTC+8…")}
          onChange={(e) => setContent(e.target.value)} />
      </div>
    </Modal>
  );
}

export default function MemorySection() {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null); // null | {} | memory
  const load = async () => setItems(await api.get("/api/memories"));
  useEffect(() => { load(); }, []);

  const del = async (m) => {
    const yes = await confirmDialog(t("删除记忆"), t("删除这条记忆？聊天中不再引用。"), { danger: true });
    if (!yes) return;
    await api.del(`/api/memories/${m.id}`);
    toast(t("已删除"));
    load();
  };

  return (
    <div className="card settings-card">
      <div className="card-head">
        <span className="c-name">{t("记忆")}</span>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={() => setEditing({})}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {t("新增记忆")}
        </button>
      </div>
      <div className="card-desc">{t("保存给 AI 的长期信息：偏好、约定、背景。每次对话自动注入。")}</div>
      {items.length === 0 && (
        <div className="card-desc faint">{t("还没有记忆，点右上「新增记忆」保存第一条。")}</div>
      )}
      <div className="mem-list">
        {items.map((m) => (
          <div className="mem-item" key={m.id}>
            <div className="mem-body">
              <div className="mem-content">{m.content}</div>
              <div className="mem-meta">{fmtTime(m.created_at)} · {t(m.source === "chat" ? "来自对话" : "手动")}</div>
            </div>
            <div className="mem-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(m)}>{t("编辑")}</button>
              <button className="btn btn-danger" onClick={() => del(m)}>{t("删除")}</button>
            </div>
          </div>
        ))}
      </div>
      {editing !== null && (
        <MemoryModal initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </div>
  );
}
