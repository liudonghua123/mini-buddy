/* App 根组件：视图路由 + 全局弹窗/Toast */
import React, { useEffect } from "react";
import { useStore, setState } from "./lib/store.js";
import { api } from "./lib/api.js";
import Sidebar, { selectSession } from "./components/Sidebar.jsx";
import ChatView from "./components/ChatView.jsx";
import McpView from "./components/McpView.jsx";
import SkillsView from "./components/SkillsView.jsx";
import DocsView from "./components/DocsView.jsx";
import TasksView from "./components/TasksView.jsx";
import AssistantsView from "./components/AssistantsView.jsx";
import SettingsView from "./components/SettingsView.jsx";
import { ToastHost, DialogHost } from "./components/Common.jsx";

function useBoot() {
  useEffect(() => {
    (async () => {
      try {
        const [sessions, mcps, skills, assistants] = await Promise.all([
          api.get("/api/sessions"),
          api.get("/api/mcp"),
          api.get("/api/skills"),
          api.get("/api/assistants"),
        ]);
        setState({ sessions, mcps, skills, assistants, loaded: true });
        // 深链 ?view=mcp 等
        const params = new URLSearchParams(location.search);
        const initView = params.get("view");
        const known = ["mcp", "skills", "docs", "tasks", "settings", "assistants"];
        if (sessions.length && !known.includes(initView)) {
          await selectSession(sessions[0].id);
        }
        if (initView && known.includes(initView)) setState({ view: initView });
      } catch (e) {
        setState({ loaded: true });
        console.error("初始化失败", e);
      }
    })();
  }, []);
}

export default function App() {
  const { view, loaded } = useStore();
  useBoot();

  if (!loaded) {
    return (
      <div className="boot">
        <div className="boot-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="40" height="40">
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <circle cx="11" cy="13" r="3" fill="#fff" />
            <circle cx="21" cy="13" r="3" fill="#fff" />
            <path d="M10 21c2 2.6 10 2.6 12 0" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar />
      {view === "chat" && <ChatView />}
      {view === "assistants" && <AssistantsView />}
      {view === "mcp" && <McpView />}
      {view === "skills" && <SkillsView />}
      {view === "docs" && <DocsView />}
      {view === "tasks" && <TasksView />}
      {view === "settings" && <SettingsView />}
      <ToastHost />
      <DialogHost />
    </div>
  );
}
