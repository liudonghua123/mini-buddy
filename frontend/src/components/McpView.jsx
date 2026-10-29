/* MCP 视图：服务器卡片、安装/编辑弹窗（builtin/stdio/http/sse） */
import React, { useEffect, useState } from "react";
import { useStore, setState, toast, confirmDialog } from "../lib/store.js";
import { api } from "../lib/api.js";
import { Modal, KvEditor } from "./Common.jsx";
import { t, useLang } from "../lib/i18n.js";

export async function loadMcps() {
  const mcps = await api.get("/api/mcp");
  setState({ mcps });
  return mcps;
}

function statusPill(s) {
  if (s.status === "running") return <span className="pill pill-running">{t("运行中")}</span>;
  if (s.status === "error") return <span className="pill pill-off" style={{ background: "var(--err-soft)", color: "var(--err)" }}>{t("错误")}</span>;
  return <span className="pill pill-off">{t("已停止")}</span>;
}

function McpCard({ srv, onEdit }) {
  const cfg = srv.config;
  const canEdit = true; // 全部可编辑（builtin 仅描述/超时）
  const meta = cfg.transport === "stdio"
    ? `${cfg.command} ${(cfg.args || []).join(" ")}`.trim()
    : cfg.transport === "http" || cfg.transport === "sse" ? cfg.url : `${t("内置")} · ${cfg.builtin_id}`;
  const tools = srv.tools || [];

  const act = async (fn, msg) => {
    try { await fn(); await loadMcps(); if (msg) toast(msg); }
    catch (e) { toast(e.message, "error"); }
  };
  const toggle = () => act(
    () => api.post(`/api/mcp/${srv.id}/toggle`, { enabled: !cfg.enabled }),
    cfg.enabled ? t("已禁用") : t("已启用")
  );
  const startStop = () => cfg.enabled && srv.status !== "running"
    ? act(() => api.post(`/api/mcp/${srv.id}/start`), t("已启动"))
    : act(() => api.post(`/api/mcp/${srv.id}/stop`), t("已停止"));
  const del = async () => {
    const yes = await confirmDialog(t("删除服务器"), t("删除「{name}」？该操作不可恢复。", { name: cfg.name }), { danger: true, confirmText: t("删除") });
    if (!yes) return;
    act(() => api.del(`/api/mcp/${srv.id}`), "已删除");
  };

  return (
    <div className="card srv-card">
      <div className="card-head">
        <span className="c-name">{cfg.name}</span>
        {statusPill(srv)}
        <span className="pill">{cfg.transport}</span>
        {!cfg.enabled && <span className="pill pill-off">{t("已禁用")}</span>}
      </div>
      {cfg.description && <div className="card-desc">{cfg.description}</div>}
      <div className="card-meta">{meta}</div>
      {tools.length > 0 && (
        <div className="tool-chips">{tools.map((t) => <span key={t.name} className="tool-chip">{t.name}</span>)}</div>
      )}
      <div className="card-foot">
        {cfg.enabled && srv.status !== "running"
          ? <button className="btn btn-secondary" onClick={startStop}>{t("启动")}</button>
          : cfg.enabled && <button className="btn btn-secondary" onClick={startStop}>{t("停止")}</button>}
        {canEdit && <button className="btn btn-ghost" onClick={() => onEdit(srv)}>{t("编辑")}</button>}
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={toggle}>{cfg.enabled ? t("禁用") : t("启用")}</button>
        <button className="btn btn-ghost btn-danger" onClick={del}>{t("删除")}</button>
      </div>
    </div>
  );
}

/* ---------- 安装/编辑弹窗 ---------- */
function McpModal({ editing, onClose, onSaved }) {
  const [transport, setTransport] = useState(editing?.config.transport || "http");
  const [name, setName] = useState(editing?.config.name || "");
  const [desc, setDesc] = useState(editing?.config.description || "");
  const [timeout_, setTimeout_] = useState(editing?.config.timeout ?? 30);
  const [url, setUrl] = useState(editing?.config.url || "");
  const [command, setCommand] = useState(editing?.config.command || "");
  const [argsText, setArgsText] = useState((editing?.config.args || []).join("\n"));
  const [cwd, setCwd] = useState(editing?.config.cwd || "");
  const [env, setEnv] = useState(editing?.config.env || {});
  const [headers, setHeaders] = useState(editing?.config.headers || {});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const isBuiltin = editing?.config.transport === "builtin";

  const common = () => ({ name, description: desc, timeout: Number(timeout_) || 30 });
  const conn = () => transport === "http" || transport === "sse"
    ? { url, headers }
    : { command, args: argsText.split("\n").map((s) => s.trim()).filter(Boolean), cwd, env };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const body = transport === "builtin"
        ? { transport, builtin_id: editing?.config.builtin_id, ...common() }
        : { transport, ...conn(), ...common() };
      const r = await api.post("/api/mcp/test", body);
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, message: e.message, tools: [] });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!name.trim()) { toast("请填写名称", "error"); return; }
    try {
      if (editing) {
        await api.put(`/api/mcp/${editing.id}`, { ...common(), ...conn() });
      } else if (transport === "builtin") {
        // 内置服务器安装走专用接口
        await api.post(`/api/mcp/install/builtin/${editing ? editing.config.builtin_id : ""}`);
      } else {
        await api.post("/api/mcp/install", { ...common(), transport, enabled: true, ...conn() });
      }
      await onSaved();
      toast(editing ? "已保存并生效" : "已安装");
      onClose();
    } catch (e) {
      toast(e.message, "error");
    }
  };

  // builtin 编辑模式：只有描述/超时可保存；连接区块隐藏
  const builtinEdit = isBuiltin && editing;

  return (
    <Modal
      title={editing ? `${t("编辑 MCP")} — ${editing.config.name}` : t("安装 MCP")}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={test} disabled={testing || builtinEdit}>
            {testing ? t("测试中…") : t("测试连接")}
          </button>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>{t("取消")}</button>
          <button className="btn btn-primary" onClick={save}>
            {editing ? t("保存") : t("安装")}
          </button>
        </>
      }
    >
      {!editing && (
        <div className="transport-pick">
          {[
            ["http", t("Streamable HTTP")], ["sse", "SSE"],
            ["stdio", t("STDIO 进程")], ["builtin", t("内置演示")],
          ].map(([v, label]) => (
            <label key={v} className={`tp-item ${transport === v ? "on" : ""}`}>
              <input type="radio" name="transport" value={v} checked={transport === v}
                onChange={() => { setTransport(v); setTestResult(null); }} />
              {label}
            </label>
          ))}
        </div>
      )}

      <div className="field">
        <label>{t("名称")}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={isBuiltin}
          placeholder={t("如 天气查询")} />
      </div>
      <div className="field">
        <label>{t("描述")}{isBuiltin && <span className="bind-hint">{t("内置服务器：仅描述与超时可改")}</span>}</label>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("这个服务器提供什么能力")} />
      </div>
      <div className="field">
        <label>{t("超时时间（秒）")}</label>
        <input type="number" min="1" step="1" value={timeout_}
          onChange={(e) => setTimeout_(e.target.value)} />
      </div>

      {(transport === "http" || transport === "sse") && !builtinEdit && (
        <>
          <div className="field">
            <label>{transport === "sse" ? t("SSE 地址") : t("HTTP 地址")}</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.mcp.run/mcp" /> {/* taste-skill-ignore: URL format hint, not example data */}
          </div>
          <div className="field">
            <label>{t("自定义请求头")}</label>
            <KvEditor value={headers} onChange={setHeaders} keyPlaceholder={t("Header 名")} valuePlaceholder={t("值")} />
          </div>
        </>
      )}

      {transport === "stdio" && !builtinEdit && (
        <>
          <div className="field">
            <label>{t("启动命令")}</label>
            <input value={command} onChange={(e) => setCommand(e.target.value)}
              placeholder={t("npx 或 python")} />
          </div>
          <div className="field">
            <label>{t("参数（每行一个）")}</label>
            <textarea value={argsText} onChange={(e) => setArgsText(e.target.value)}
              placeholder={"-y\n@modelcontextprotocol/server-time"} />
          </div>
          <div className="field">
            <label>{t("工作目录（可选）")}</label>
            <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder={t("留空使用当前目录")} />
          </div>
          <div className="field">
            <label>{t("环境变量")}</label>
            <KvEditor value={env} onChange={setEnv} keyPlaceholder={t("变量名")} valuePlaceholder={t("值")} />
          </div>
        </>
      )}

      {transport === "builtin" && !editing && (
        <div className="field">
          <label>{t("选择内置服务器")}</label>
          <BuiltinPick />
        </div>
      )}

      {testResult && (
        <div className={`test-result ${testResult.ok ? "ok" : "fail"}`}>
          <strong>{testResult.ok ? t("连接成功") : t("连接失败")}</strong>
          <span>{testResult.message}</span>
          {testResult.tools?.length > 0 && (
            <div className="tool-chips">
              {testResult.tools.map((t) => <span key={t} className="tool-chip">{t}</span>)}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function BuiltinPick() {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/api/mcp/builtin").then(setList).catch(() => {}); }, []);
  return (
    <select defaultValue="">
      <option value="" disabled>{t("选择一个内置服务器")}</option>
      {list.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.desc}</option>)}
    </select>
  );
}

export default function McpView() {
  useLang();
  const mcps = useStore((s) => s.mcps);
  const [modal, setModal] = useState(null); // 'install' | srv 对象
  const [query, setQuery] = useState("");

  useEffect(() => { loadMcps(); }, []);

  const running = mcps.filter((m) => m.status === "running").length;
  const onSaved = () => loadMcps();
  const q = query.trim().toLowerCase();
  const filtered = q
    ? mcps.filter((m) => [
      m.config?.name || "",
      m.config?.description || "",
      m.config?.transport || "",
      (m.tools || []).map((t) => t.name).join(" "),
    ].join(" ").toLowerCase().includes(q))
    : mcps;

  return (
    <section className="view">
      <header className="view-head">
        <div>
          <h1>{t("MCP 服务器")}</h1>
          <p className="subline">{t("{n} 个服务器 · {r} 个运行中", { n: mcps.length, r: running })}</p>
        </div>
        <div className="head-actions">
          <div className="search-box">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.4" />
              <path d="m10.4 10.4 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              placeholder={t("搜索名称、描述或工具…")}
              aria-label={t("搜索 MCP 服务器")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={() => setModal("install")}>{t("安装 MCP")}</button>
        </div>
      </header>
      {mcps.length === 0 ? (
        <div className="empty-block">
          <div className="ec-title">{t("还没有 MCP 服务器")}</div>
          <div>{t("点击右上角「安装 MCP」添加内置或外部服务器。")}</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-block">
          <div className="ec-title">{t("没有匹配「{q}」的服务器", { q: query })}</div>
          <div>{t("试试搜索名称、描述或工具名。")}</div>
        </div>
      ) : (
        <div className="card-grid">
          {filtered.map((s) => <McpCard key={s.id} srv={s} onEdit={(srv) => setModal(srv)} />)}
        </div>
      )}
      {modal && (
        <McpModal
          editing={modal === "install" ? null : modal}
          onClose={() => setModal(null)}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}
