/* 左栏（桌面，可折叠）+ 底部导航 / 会话抽屉（移动端） */
import React, { useEffect, useState } from "react";
import { useStore, setState, toast, confirmDialog } from "../lib/store.js";
import { t, useLang } from "../lib/i18n.js";
import { api } from "../lib/api.js";

const NAV_ICON_KEYS = ["chat", "mcp", "skills", "docs", "tasks", "assistants", "settings"];
const NAV_ICONS = {
  chat: <path d="M3 4.5h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z" strokeWidth="1.4" strokeLinejoin="round" fill="none" stroke="currentColor" />,
  mcp: <>
    <rect x="2" y="3" width="12" height="4" rx="1.4" strokeWidth="1.4" fill="none" stroke="currentColor" />
    <rect x="2" y="9" width="12" height="4" rx="1.4" strokeWidth="1.4" fill="none" stroke="currentColor" />
    <circle cx="4.6" cy="5" r="0.8" fill="currentColor" />
    <circle cx="4.6" cy="11" r="0.8" fill="currentColor" />
  </>,
  skills: <path d="M8 1.8 9.6 6l4.2 1.6L9.6 9.2 8 13.4 6.4 9.2 2.2 7.6 6.4 6 8 1.8Z" strokeWidth="1.3" strokeLinejoin="round" fill="none" stroke="currentColor" />,
  docs: <>
    <path d="M8 2.2c2.8 0 5 1.1 5 2.5v6.6c0 1.4-2.2 2.5-5 2.5s-5-1.1-5-2.5V4.7c0-1.4 2.2-2.5 5-2.5Z" strokeWidth="1.3" fill="none" stroke="currentColor" />
    <path d="M3 4.7c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5M3 8c0 1.4 2.2 2.5 5 2.5S13 9.4 13 8" strokeWidth="1.3" fill="none" stroke="currentColor" />
  </>,
  tasks: <>
    <circle cx="8" cy="8" r="5.6" strokeWidth="1.3" fill="none" stroke="currentColor" />
    <path d="M8 5v3.2l2.2 1.4" strokeWidth="1.3" strokeLinecap="round" fill="none" stroke="currentColor" />
  </>,
  assistants: <path d="M8 2a4.5 4.5 0 0 1 4.5 4.5v3A4.5 4.5 0 0 1 8 14a4.5 4.5 0 0 1-4.5-4.5v-3A4.5 4.5 0 0 1 8 2Z" strokeWidth="1.4" fill="none" stroke="currentColor" />,
  settings: <path d="M8 5.4A2.6 2.6 0 1 1 8 10.6 2.6 2.6 0 0 1 8 5.4Zm0-3v2m0 9.2v2m-5.6-6.6h2m7.2 0h2M3.9 3.9 5.3 5.3m5.4 5.4 1.4 1.4m0-9.2-1.4 1.4M5.3 10.7l-1.4 1.4" strokeWidth="1.4" strokeLinecap="round" fill="none" stroke="currentColor" />,
};
const NAV_LABELS = { chat: "会话", mcp: "MCP", skills: "技能", docs: "知识库", tasks: "定时任务", assistants: "助手", settings: "设置" };
/* 默认组/无助手会话的兜底图标（SVG，避免 emoji-as-UI） */
const ChatGlyph = (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
    <path d="M3 4.5h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);

async function loadSessions() {
  const sessions = await api.get("/api/sessions");
  setState({ sessions });
  return sessions;
}

export async function selectSession(id) {
  setState({ sessionId: id, view: "chat", sessionsOpen: false });
  const [detail, messages, mcps, skills] = await Promise.all([
    api.get(`/api/sessions/${id}`),
    api.get(`/api/sessions/${id}/messages`),
    api.get("/api/mcp"),
    api.get("/api/skills"),
  ]);
  setState({ sessionDetail: detail, messages, mcps, skills });
}

export { loadSessions };

/* 会话按 assistant 分组：组 = [{key, name, emoji, sessions}]，组内 updated_at 降序 */
function groupSessions(sessions, assistants) {
  const groups = new Map();
  for (const s of sessions) {
    const a = s.assistant
      || (s.assistant_id && assistants.find((x) => x.id === s.assistant_id))
      || null;
    const key = a ? a.id : "_default";
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: a ? a.name : t("默认"),
        emoji: a ? a.emoji : null, // null → 组头渲染 ChatGlyph
        sessions: [],
      });
    }
    groups.get(key).sessions.push(s);
  }
  // 默认组排最后
  const arr = [...groups.values()];
  arr.sort((g1, g2) => (g1.key === "_default" ? 1 : g2.key === "_default" ? -1 : 0));
  return arr;
}

/* 折叠状态持久化 */
const SB_KEY = "mb_sidebar_collapsed";
function getCollapsed() {
  try { return localStorage.getItem(SB_KEY) === "1"; } catch { return false; }
}
function setCollapsed(v) {
  try { localStorage.setItem(SB_KEY, v ? "1" : "0"); } catch { /* ignore */ }
}

/* 分组折叠持久化（JSON 数组存 closed 组 key） */
const GC_KEY = "mb_group_closed";
function getClosedGroups() {
  try {
    const v = JSON.parse(localStorage.getItem(GC_KEY) || "[]");
    return Array.isArray(v) ? new Set(v) : new Set();
  } catch { return new Set(); }
}
function setClosedGroups(set) {
  try { localStorage.setItem(GC_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

/* ---------- 会话项（桌面/抽屉共用） ---------- */
function SessionItem({ s, sessionId, collapsed, delSession }) {
  return (
    <button
      className={`session-item ${s.id === sessionId ? "selected" : ""}`}
      title={collapsed ? s.title : s.title}
      onClick={() => selectSession(s.id)}
    >
      {collapsed && <span className="s-emoji" aria-hidden="true">{s.assistant?.emoji || ChatGlyph}</span>}
      <span className="s-title">{s.title}</span>
      {!collapsed && (
        <span className="s-del" role="button" aria-label={t("删除 {x}", { x: s.title })} onClick={(e) => delSession(e, s.id)}>
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none">
            <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      )}
    </button>
  );
}

/* ---------- 组头（可点击折叠 + 新建/清空） ---------- */
function GroupHead({ g, closed, onToggle, onNew, onClear }) {
  return (
    <div
      className={`sgroup-head ${closed ? "closed" : ""}`}
      role="button" tabIndex={0}
      aria-expanded={!closed}
      title={closed ? t("展开分组") : t("收起分组")}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
    >
      <span className="sgroup-emoji" aria-hidden="true">{g.emoji || ChatGlyph}</span>
      <span className="sgroup-name">{g.name}</span>
      <span className="sgroup-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sgroup-btn" aria-label={t("在此分组新建会话")}
          title={t("新建会话")} onClick={() => onNew(g)}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="sgroup-btn danger" aria-label={t("清空该分组会话")}
          title={t("清空分组")} onClick={() => onClear(g)}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
            <path d="M3 4.5h10M6.5 4.5V3.4a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.1M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </span>
      <span className="sgroup-count num">{g.sessions.length}</span>
      <svg className="sgroup-caret" viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
        <path d="M3.5 4.5 6 7l2.5-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/* ---------- 桌面侧栏 ---------- */
function DesktopSidebar() {
  useLang(); // 语言切换时重渲
  const { sessions, sessionId, view, mcps, skills, assistants } = useStore();
  const [collapsed, setCollapsedState] = useState(getCollapsed);
  const [closedGroups, setClosedGroupsState] = useState(getClosedGroups);

  const toggleCollapse = () => {
    setCollapsedState((v) => { setCollapsed(!v); return !v; });
  };

  const toggleGroup = (key) => {
    setClosedGroupsState((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      setClosedGroups(next);
      return next;
    });
  };

  const newSession = async () => {
    const s = await api.post("/api/sessions");
    await loadSessions();
    await selectSession(s.id);
    toast(t("已创建会话"));
  };

  const newSessionInGroup = async (g) => {
    const body = g.key === "_default" ? {} : { assistant_id: g.key };
    const s = await api.post("/api/sessions", body);
    await loadSessions();
    await selectSession(s.id);
    toast(t("已在「{name}」新建会话", { name: g.name }));
  };

  const clearGroup = async (g) => {
    const n = g.sessions.length;
    const yes = await confirmDialog(t("清空分组"),
      t("删除「{name}」下的全部 {n} 个会话？消息也会一起删除。", { name: g.name, n }), { danger: true });
    if (!yes) return;
    const aid = g.key === "_default" ? null : g.key;
    await api.post("/api/sessions/clear-assistant", { assistant_id: aid });
    if (g.sessions.some((s) => s.id === sessionId)) {
      setState({ sessionId: null, messages: [], sessionDetail: null });
    }
    await loadSessions();
    toast(t("已删除 {n} 个会话", { n }));
  };

  const delSession = async (e, id) => {
    e.stopPropagation();
    const yes = await confirmDialog(t("删除会话"), t("删除这个会话？消息也会一起删除。"), { danger: true });
    if (!yes) return;
    await api.del(`/api/sessions/${id}`);
    if (sessionId === id) setState({ sessionId: null, messages: [], sessionDetail: null });
    await loadSessions();
    toast(t("会话已删除"));
  };

  const groups = groupSessions(sessions, assistants);
  const counts = { mcp: mcps.length, skills: skills.length, assistants: assistants.length };
  const bottomNav = ["mcp", "skills", "docs", "tasks", "assistants", "settings"];

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <span className="brand-logo">
          <svg className="brand-mark" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <circle cx="11" cy="13" r="3" fill="#fff" />
            <circle cx="21" cy="13" r="3" fill="#fff" />
            <path d="M10 21c2 2.6 10 2.6 12 0" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          </svg>
        </span>
        {!collapsed && (
          <div className="brand-text">
            <div className="brand-name">Mini Buddy</div>
            <div className="brand-sub">{t("AI 助手工作台")}</div>
          </div>
        )}
        <button
          type="button"
          className="sb-toggle"
          aria-label={collapsed ? t("展开侧栏") : t("收起侧栏")}
          title={collapsed ? t("展开侧栏") : t("收起侧栏")}
          onClick={toggleCollapse}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <path d="m8.5 4-4 4 4 4M12.5 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <button className="btn btn-primary new-chat"
          aria-label={t("新建会话")} onClick={newSession}>
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {t("新建会话")}
        </button>
      )}

      {!collapsed && (
        <nav className="session-list" aria-label={t("会话列表")}>
          {groups.map((g) => {
            const closed = closedGroups.has(g.key);
            return (
              <div className={`sgroup ${closed ? "closed" : ""}`} key={g.key}>
                <GroupHead g={g} closed={closed} onToggle={() => toggleGroup(g.key)}
                  onNew={newSessionInGroup} onClear={clearGroup} />
                <div className="sgroup-body">
                  {g.sessions.map((s) => (
                    <SessionItem key={s.id} s={s} sessionId={sessionId} collapsed={collapsed} delSession={delSession} />
                  ))}
                </div>
              </div>
            );
          })}
          {sessions.length === 0 && (
            <div className="cp-empty">{t("还没有会话，点上面新建。")}</div>
          )}
        </nav>
      )}

      <div className="sidebar-nav">
        {bottomNav.map((k) => (
          <button
            key={k}
            className={`nav-item ${view === k ? "selected" : ""}`}
            title={collapsed ? t(NAV_LABELS[k]) : undefined}
            onClick={() => setState({ view: k })}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">{NAV_ICONS[k]}</svg>
            {!collapsed && <span>{t(NAV_LABELS[k])}</span>}
            {!collapsed && counts[k] > 0 && <span className="count num">{counts[k]}</span>}
          </button>
        ))}
      </div>
    </aside>
  );
}

/* ---------- 移动端：底部导航 + 会话抽屉 ---------- */
function MobileNav() {
  useLang();
  const { view, sessionId, sessionsOpen, mcps, skills, assistants } = useStore();
  const counts = { mcp: mcps.length, skills: skills.length, assistants: assistants.length };

  const go = (key) => {
    if (key === "chat") {
      if (sessionId) { selectSession(sessionId); }
      else setState({ sessionsOpen: true, view: "chat" });
      return;
    }
    setState({ view: key, sessionsOpen: false });
  };

  return (
    <nav className="mobile-nav" aria-label={t("主导航")}>
      {NAV_ICON_KEYS.map((k) => (
        <button
          key={k}
          className={`mnav-item ${view === k ? "selected" : ""}`}
          aria-label={t(NAV_LABELS[k])}
          onClick={() => go(k)}
        >
          <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">{NAV_ICONS[k]}</svg>
          <span>{t(NAV_LABELS[k])}</span>
          {counts[k] > 0 && <i className="mnav-dot num">{counts[k]}</i>}
        </button>
      ))}
    </nav>
  );
}

function SessionsDrawer() {
  useLang();
  const { sessions, sessionId, sessionsOpen, assistants } = useStore();
  const [closedGroups, setClosedGroupsState] = useState(getClosedGroups);
  if (!sessionsOpen) return null;

  const toggleGroup = (key) => {
    setClosedGroupsState((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      setClosedGroups(next);
      return next;
    });
  };

  const newSession = async () => {
    const s = await api.post("/api/sessions");
    await loadSessions();
    await selectSession(s.id);
    toast(t("已创建会话"));
  };
  const newSessionInGroup = async (g) => {
    const body = g.key === "_default" ? {} : { assistant_id: g.key };
    const s = await api.post("/api/sessions", body);
    await loadSessions();
    await selectSession(s.id);
    toast(t("已在「{name}」新建会话", { name: g.name }));
  };
  const clearGroup = async (g) => {
    const n = g.sessions.length;
    const yes = await confirmDialog(t("清空分组"),
      t("删除「{name}」下的全部 {n} 个会话？消息也会一起删除。", { name: g.name, n }), { danger: true });
    if (!yes) return;
    const aid = g.key === "_default" ? null : g.key;
    await api.post("/api/sessions/clear-assistant", { assistant_id: aid });
    if (g.sessions.some((s) => s.id === sessionId)) {
      setState({ sessionId: null, messages: [], sessionDetail: null });
    }
    await loadSessions();
    toast(t("已删除 {n} 个会话", { n }));
  };
  const delSession = async (e, id) => {
    e.stopPropagation();
    const yes = await confirmDialog(t("删除会话"), t("删除这个会话？消息也会一起删除。"), { danger: true });
    if (!yes) return;
    await api.del(`/api/sessions/${id}`);
    if (sessionId === id) setState({ sessionId: null, messages: [], sessionDetail: null });
    await loadSessions();
    toast(t("会话已删除"));
  };

  const groups = groupSessions(sessions, assistants);

  return (
    <div className="drawer-mask" role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setState({ sessionsOpen: false }); }}>
      <aside className="drawer sessions-drawer" role="dialog" aria-modal="true" aria-label="会话列表">
        <div className="drawer-head">
          <h2>{t("会话")}</h2>
          <button className="btn-icon" onClick={() => setState({ sessionsOpen: false })} aria-label={t("关闭会话列表")}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <button className="btn btn-primary new-chat" onClick={newSession}>
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {t("新建会话")}
        </button>
        <div className="session-list drawer-session-list" aria-label={t("会话列表")}>
          {groups.map((g) => {
            const closed = closedGroups.has(g.key);
            return (
              <div className={`sgroup ${closed ? "closed" : ""}`} key={g.key}>
                <GroupHead g={g} closed={closed} onToggle={() => toggleGroup(g.key)}
                  onNew={newSessionInGroup} onClear={clearGroup} />
                <div className="sgroup-body">
                  {g.sessions.map((s) => (
                    <SessionItem key={s.id} s={s} sessionId={sessionId} collapsed={false} delSession={delSession} />
                  ))}
                </div>
              </div>
            );
          })}
          {sessions.length === 0 && <div className="cp-empty">{t("还没有会话，点上面新建。")}</div>}
        </div>
      </aside>
    </div>
  );
}

/* ---------- 导出 ---------- */
export default function Sidebar() {
  return (
    <>
      <DesktopSidebar />
      <MobileNav />
      <SessionsDrawer />
    </>
  );
}
