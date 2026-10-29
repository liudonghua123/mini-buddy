/* 聊天视图：消息流、流式渲染、composer 工具条（MCP/技能选择）、会话设置抽屉 */
import React, { useEffect, useRef, useState, useLayoutEffect } from "react";
import { useStore, setState, toast } from "../lib/store.js";
import { api } from "../lib/api.js";
import { md, renderCharts } from "../lib/md.js";
import { t, useLang } from "../lib/i18n.js";
import { getStream, subscribeStream, runStream, resetStream } from "../lib/streamManager.js";

const QUICK_PROMPTS = ["12 * (3 + 8) 等于多少", "现在几点了", "掷一个 20 面骰子", "画个流程图", "/tools"];

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* meta 行：耗时 / token / 模型 / 编辑标记 */
function MetaLine({ m }) {
  const meta = m.meta || {};
  const bits = [];
  if (meta.elapsed_ms != null) {
    const ms = meta.elapsed_ms;
    bits.push(ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
  }
  if (meta.input_tokens != null || meta.output_tokens != null) {
    const inp = meta.input_tokens ?? 0;
    const out = meta.output_tokens ?? 0;
    bits.push(t("{inp} 入 / {out} 出 tokens", { inp, out }));
  }
  if (meta.model && meta.model !== "mock") bits.push(meta.model);
  if (meta.calls > 1) bits.push(t("{n} 次调用", { n: meta.calls }));
  if (m.edited) bits.push(t("已编辑"));
  if (!bits.length) return null;
  return <div className="msg-meta"><span className="num">{bits.join(" · ")}</span></div>;
}

/* 思考过程：默认折叠 */
function Thinking({ text, live }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className={`think ${open ? "open" : ""}`}>
      <button type="button" className="think-toggle" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true"
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>
          <path d="m6 3.5 5 4.5-5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t("思考过程")}{live && <span className="think-live">{t("思考中…")}</span>}
        <span className="num think-len">{text.length}</span>
      </button>
      {open && <div className="think-body">{text}</div>}
    </div>
  );
}

/* 过程日志：MCP / 技能 / 知识库执行的完整步骤（默认折叠） */
function ProcessLog({ steps, live }) {
  const [open, setOpen] = useState(false);
  const list = (steps || []).filter((s) => s && (s.name || s.kind));
  if (!list.length) return null;
  const totalMs = list.reduce((acc, s) => acc + (s.elapsed_ms || 0), 0);
  const running = list.some((s) => s.running);
  const fmtMs = (ms) => ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
  const fmtVal = (v) => {
    if (v == null) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v, null, 1);
    return s.length > 800 ? s.slice(0, 800) + "…" : s;
  };
  const kindLabel = (s) =>
    s.kind === "rag" ? t("知识检索") : s.kind === "skill" ? t("技能") : t("工具");

  return (
    <div className={`plog ${open ? "open" : ""}`}>
      <button type="button" className="plog-toggle" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true"
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>
          <path d="m6 3.5 5 4.5-5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t("过程日志")}
        <span className="plog-count num">{list.length} {t("步")}</span>
        {totalMs > 0 && <span className="plog-ms num">{fmtMs(totalMs)}</span>}
        {(live || running) && <span className="plog-live">{t("执行中…")}</span>}
      </button>
      {open && (
        <div className="plog-body">
          {list.map((s, i) => (
            <div className={`plog-step ${s.ok === false ? "fail" : ""}`} key={i}>
              <div className="plog-step-head">
                <span className={`plog-dot ${s.running ? "run" : s.ok === false ? "fail" : "ok"}`} />
                <span className="plog-idx num">{i + 1}</span>
                <span className="plog-name">{s.name || kindLabel(s)}</span>
                {s.server && <span className="plog-server">{s.server}</span>}
                <span className="spacer" />
                {typeof s.elapsed_ms === "number" && s.elapsed_ms > 0 && (
                  <span className="plog-step-ms num">{fmtMs(s.elapsed_ms)}</span>
                )}
                {s.running && <span className="plog-live">{t("执行中…")}</span>}
              </div>
              {s.input != null && Object.keys(s.input).length > 0 && (
                <div className="plog-io">
                  <span className="plog-io-label">{t("输入")}</span>
                  <pre className="plog-io-val">{fmtVal(s.input)}</pre>
                </div>
              )}
              {s.output != null && s.output !== "" && (
                <div className="plog-io">
                  <span className="plog-io-label">{t("输出")}</span>
                  <pre className="plog-io-val">{fmtVal(s.output)}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* HITL 提问卡：助手请求补充信息（单选/多选/自由文本） */
function AskCard({ ask, onAnswer, disabled }) {
  const [picked, setPicked] = useState(new Set());
  const [text, setText] = useState("");
  if (!ask) return null;
  const hasOptions = (ask.options || []).length > 0;

  const togglePick = (opt) => {
    setPicked((p) => {
      const next = new Set(ask.multi ? p : []);
      if (next.has(opt)) next.delete(opt); else next.add(opt);
      return next;
    });
  };

  const submit = () => {
    let answer = "";
    if (hasOptions) answer = [...picked].join("、");
    if (text.trim()) answer = answer ? `${answer}\n${text.trim()}` : text.trim();
    if (!answer) return;
    onAnswer(answer);
  };

  const canSubmit = hasOptions ? picked.size > 0 : text.trim().length > 0;

  return (
    <div className="ask-card" role="group" aria-label={t("助手提问")}>
      <div className="ask-head">
        <span className="ask-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
            <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6.2 6.2a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.8.7-.8 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="8" cy="11.4" r=".9" fill="currentColor" />
          </svg>
        </span>
        <span className="ask-title">{t("需要你补充信息")}</span>
        {ask.multi && hasOptions && <span className="pill">{t("可多选")}</span>}
      </div>
      <div className="ask-question">{ask.question}</div>
      {hasOptions && (
        <div className="ask-options">
          {ask.options.map((opt) => (
            <button key={opt} type="button"
              className={`ask-opt ${picked.has(opt) ? "on" : ""}`}
              aria-pressed={picked.has(opt)}
              onClick={() => togglePick(opt)}>{opt}</button>
          ))}
        </div>
      )}
      <div className="ask-input-row">
        <input className="ask-input" value={text}
          placeholder={hasOptions ? t("也可以补充说明…") : t("输入你的回答…")}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <button className="btn btn-primary ask-send" disabled={disabled || !canSubmit}
          onClick={submit}>
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
            <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t("回答并继续")}
        </button>
      </div>
    </div>
  );
}

/* 内联编辑器 */
function InlineEditor({ initial, onSave, onCancel, rows = 3 }) {
  const [val, setVal] = useState(initial);
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.focus();
      ref.current.style.height = "auto";
      ref.current.style.height = Math.min(ref.current.scrollHeight, 300) + "px";
    }
  }, []);
  return (
    <div className="msg-editor">
      <textarea ref={ref} rows={rows} value={val} aria-label={t("编辑消息")}
        onChange={(e) => { setVal(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 300) + "px"; }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(val); }
          if (e.key === "Escape") onCancel();
        }} />
      <div className="msg-editor-foot">
        <span className="msg-editor-hint">{t("Ctrl+Enter 保存 · Esc 取消")}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>{t("取消")}</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!val.trim() || val === initial}
          onClick={() => onSave(val)}>{t("保存")}</button>
      </div>
    </div>
  );
}

/* 复制辅助：纯文本 / Markdown 源码 */
function copyText(text) {
  const done = () => toast(t("已复制"));
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); done(); } catch { toast(t("复制失败"), "error"); }
  ta.remove();
}

function fmtSize(n) {
  if (n == null) return "";
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + "MB";
  if (n >= 1024) return Math.round(n / 1024) + "KB";
  return n + "B";
}

/* 消息附件：图片缩略图 / 文件卡片 */
function FileChips({ files }) {
  if (!files?.length) return null;
  return (
    <div className="msg-files">
      {files.map((f, i) => f.mime?.startsWith("image/") ? (
        <a key={i} className="msg-img" href={f.url} target="_blank" rel="noreferrer">
          <img src={f.url} alt={f.name} loading="lazy" />
        </a>
      ) : (
        <a key={i} className="file-card" href={f.url} target="_blank" rel="noreferrer" download={f.name}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <path d="M9.5 1.8H4.6a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h6.8a1 1 0 0 0 1-1V4.7l-2.9-2.9Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M9.3 2v2.8h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span className="fc-main">
            <span className="fc-name">{f.name}</span>
            <span className="fc-size">{fmtSize(f.size)}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

/* ---------- 单条消息 ---------- */
function Message({ m, mcps, skills, onEdited, onAnswer, answerDisabled }) {
  const ref = useRef(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!ref.current || editing) return;
    const dispose = renderCharts(ref.current);
    return () => dispose.then((d) => d());
  }, [m.content, editing]);

  const roleLabel = m.role === "user" ? t("你") : m.role === "assistant" ? "Mini Buddy" : t("系统");
  const chips = [];
  for (const id of m.attachments?.mcps || []) {
    const srv = mcps.find((x) => x.id === id);
    if (srv) chips.push({ text: srv.config.name, sk: false });
  }
  for (const slug of m.attachments?.skills || []) {
    const sk = skills.find((x) => x.slug === slug);
    if (sk) chips.push({ text: sk.name, sk: true });
  }
  // 助手回复不可编辑；复制按钮：纯文本（去 markdown）与 Markdown 源码
  const canEdit = m.role === "user";

  const saveEdit = async (val) => {
    try {
      const updated = await api.patch(`/api/sessions/${m.session_id}/messages/${m.id}`, { content: val });
      setEditing(false);
      onEdited?.(updated);
    } catch (e) {
      toast(t("保存失败：{msg}", { msg: e.message }), "error");
    }
  };

  return (
    <div className={`msg msg-${m.role} ${editing ? "editing" : ""}`}>
      <div className="msg-role">
        {roleLabel} · <span className="num">{fmtTime(m.ts)}</span>
        <span className="msg-actions">
          {canEdit && !editing && (
            <button type="button" className="msg-edit-btn" aria-label={t("编辑消息")}
              title={t("编辑消息")}
              onClick={() => setEditing(true)}>
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">
                <path d="m11.3 2.2 2.5 2.5L6 12.5l-3.3.8.8-3.3 7.8-7.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <button type="button" className="msg-copy-btn" aria-label={t("复制文本")}
            title={t("复制文本")}
            onClick={() => copyText(m.content.replace(/```[\s\S]*?```/g, (block) =>
              block.split("\n").slice(1, -1).join("\n")).trim())}>
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
              <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
          <button type="button" className="msg-copy-btn" aria-label={t("复制 Markdown")}
            title={t("复制 Markdown")}
            onClick={() => copyText(m.content)}>
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">
              <path d="M2 11.5V4.5L5 8l3-3.5v7M9.5 4.5l2 4 2-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </button>
        </span>
      </div>
      {editing ? (
        <InlineEditor initial={m.content} onSave={saveEdit} onCancel={() => setEditing(false)} />
      ) : (
        <>
          {m.role === "assistant" && m.thinking && <Thinking text={m.thinking} />}
          {m.files?.length > 0 && <FileChips files={m.files} />}
          <div className="msg-bubble" ref={ref} dangerouslySetInnerHTML={{ __html: md(m.content) }} />
          <MetaLine m={m} />
        </>
      )}
      {chips.length > 0 && !editing && (
        <div className="msg-attach">
          {chips.map((c, i) => <span key={i} className={`pick-chip ${c.sk ? "sk" : ""}`}>{c.text}</span>)}
        </div>
      )}
      {m.tool_events?.length > 0 && !editing && (
        <ProcessLog steps={m.tool_events} />
      )}
      {m.role === "assistant" && m.ask && !editing && (
        <AskCard ask={m.ask} onAnswer={onAnswer} disabled={answerDisabled} />
      )}
    </div>
  );
}

/* ---------- composer 工具条 popover（Cherry Studio 风格开关列表） ---------- */
function useOutsideClose(open, refs, close) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (refs.every((r) => !r.current?.contains(e.target))) close();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
}

function Switch({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`sw ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span className="sw-knob" />
    </button>
  );
}

function ToolPopover({ open, onClose, anchor, usable, picked, touched, toggle, resetFollow }) {
  const popRef = useRef(null);
  const [layer, setLayer] = useState(null); // null=分类层 | "mcp" | "skill"
  const [query, setQuery] = useState("");
  useOutsideClose(open, [popRef, anchor], onClose);
  useEffect(() => {
    if (!open) { setLayer(null); setQuery(""); }
  }, [open]);
  if (!open) return null;

  const items = layer === "mcp" ? usable.mcps : layer === "skill" ? usable.skills : [];
  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((it) => {
      if (layer === "mcp") {
        const hay = [
          it.config?.name || it.name || "",
          it.config?.description || "",
          (it.tools || []).map((t) => t.name).join(" "),
        ].join(" ").toLowerCase();
        return hay.includes(q);
      }
      return `${it.name || ""} ${it.description || ""}`.toLowerCase().includes(q);
    })
    : items;

  return (
    <div className="cap-pop" ref={popRef} role="dialog" aria-label="选择本条消息的能力">
      {layer === null ? (
        <>
          <button type="button" className="cat-item" onClick={() => setLayer("mcp")}>
            <span className="cat-ico mcp" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
                <rect x="2" y="3" width="12" height="4" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
                <rect x="2" y="9" width="12" height="4" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="4.6" cy="5" r="0.8" fill="currentColor" />
                <circle cx="4.6" cy="11" r="0.8" fill="currentColor" />
              </svg>
            </span>
            <span className="cat-main">
              <span className="cat-name">{t("MCP 服务器")}</span>
              <span className="cat-sub">{t("外部工具与数据源")}</span>
            </span>
            <span className="cat-count num">{usable.mcps.length}</span>
          </button>
          <button type="button" className="cat-item" onClick={() => setLayer("skill")}>
            <span className="cat-ico skill" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
                <path d="M8 1.8 9.6 6l4.2 1.6L9.6 9.2 8 13.4 6.4 9.2 2.2 7.6 6.4 6 8 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="cat-main">
              <span className="cat-name">{t("技能")}</span>
              <span className="cat-sub">{t("专项指令包")}</span>
            </span>
            <span className="cat-count num">{usable.skills.length}</span>
          </button>
          <div className="cap-pop-note">
            {touched
              ? t("本次发送只用勾选的能力。")
              : t("开关跟随会话生效能力；改动后只影响下一条消息。")}
          </div>
          {touched && (
            <button type="button" className="cap-follow-btn" onClick={resetFollow}>
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">
                <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.6v2.6h-2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t("恢复跟随会话能力")}
            </button>
          )}
        </>
      ) : (
        <>
          <div className="cap-pop-head">
            <button type="button" className="cp-back" aria-label={t("返回分类")}
              onClick={() => { setLayer(null); setQuery(""); }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
                <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {layer === "mcp" ? t("MCP 服务器") : t("技能")}
            <span className="cap-pop-count num">{filtered.length}/{items.length}</span>
          </div>
          <div className="cap-pop-search">
            <div className="search-box sm">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.4" />
                <path d="m10.4 10.4 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input
                value={query}
                placeholder={layer === "mcp" ? t("搜索服务器或工具…") : t("搜索技能…")}
                aria-label={t("搜索")}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="cap-pop-list">
            {items.length === 0 ? (
              <div className="cp-empty">{layer === "mcp" ? t("本会话没有可用的 MCP") : t("本会话没有可用的技能")}</div>
            ) : filtered.length === 0 ? (
              <div className="cp-empty">{t("没有匹配「{q}」的结果", { q: query })}</div>
            ) : (
              filtered.map((it) => {
                const key = layer === "mcp" ? it.id : it.slug;
                // 初始态：跟随会话生效能力（与管理页同步）；用户动过开关后按显式选择
                const on = layer === "mcp" ? picked.mcps.has(it.id) : picked.skills.has(it.slug);
                const name = layer === "mcp" ? (it.config?.name || it.name) : it.name;
                const sub = layer === "mcp"
                  ? `${t("{n} 工具", { n: (it.tools || []).length })} · ${it.config?.transport || it.transport || ""}`
                  : (it.description || "").slice(0, 18);
                return (
                  <div className="cp-item" key={key}>
                    <div className="cp-item-main">
                      <span className="cp-name">{name}</span>
                      <span className="cp-sub">{sub}</span>
                    </div>
                    <Switch on={on} label={t("选择 {x}", { x: name })} onChange={() => toggle(layer, key)} />
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- 会话设置抽屉 ---------- */
function SessionDrawer({ onClose }) {
  const { sessionId, sessionDetail, mcps, skills, assistants } = useStore();
  const [prompt, setPrompt] = useState(sessionDetail?.system_prompt || "");
  const [temp, setTemp] = useState(sessionDetail?.temperature ?? 0.7);
  const [saving, setSaving] = useState(false);

  const saveBase = async (fields) => {
    setSaving(true);
    try {
      const res = await api.patch(`/api/sessions/${sessionId}`, fields);
      const detail = await api.get(`/api/sessions/${sessionId}`);
      setState({ sessionDetail: detail });
      const sessions = await api.get("/api/sessions");
      setState({ sessions });
      return res;
    } finally {
      setSaving(false);
    }
  };

  const setAssistant = async (id) => {
    await saveBase({ assistant_id: id });
    toast(id === null ? t("已恢复默认身份") : t("助手身份已切换"));
  };
  const savePrompt = async () => {
    await saveBase({ system_prompt: prompt });
    toast(t("会话提示词已保存"));
  };
  const saveTemp = async (v) => {
    setTemp(v);
    await saveBase({ temperature: v });
  };

  const setCapState = async (kind, key, st) => {
    // 单键设置：inherit=跟随全局管理开关，on/off=会话级强制
    const res = await api.put(`/api/sessions/${sessionId}/overrides/key`, { kind, key, state: st });
    setState({ sessionDetail: { ...sessionDetail, overrides: res.overrides, caps: res.caps } });
    toast(st === "inherit"
      ? t("已恢复跟随全局开关")
      : st === "on" ? t("本会话已开启") : t("本会话已关闭"));
  };

  const refreshCaps = async () => {
    // 与管理页全局状态重新同步（MCP 启停、技能启停后点这里）
    const detail = await api.get(`/api/sessions/${sessionId}`);
    setState({ sessionDetail: detail });
    toast(t("已同步最新全局状态"));
  };

  const currentAssistant = assistants?.find((a) => a.id === sessionDetail?.assistant_id);
  const caps = sessionDetail?.caps;

  const capItem = (it, kind) => {
    const key = kind === "mcp" ? it.id : it.slug;
    const kindKey = kind === "mcp" ? "mcps" : "skills";
    const sub = kind === "mcp"
      ? `${t("{n} 工具", { n: it.tools.length })}${it.running ? " · " + t("运行中") : ""}`
      : "技能";
    // 三态：inherit（跟随全局） | on（会话强制开） | off（会话强制关）
    const inherit = it.state === "inherit";
    const globalOn = it.global_enabled;
    const subState = inherit
      ? (globalOn ? t("跟随全局：开") : t("跟随全局：关"))
      : inherit === false && it.state === "on" ? t("本会话强制开") : t("本会话强制关");
    return (
      <div className="cap-row" key={key}>
        <div className="cap-row-main">
          <span className="cap-row-name">{it.name}</span>
          <span className="cap-row-sub">{sub} · {subState}</span>
        </div>
        <div className="cap-row-ctl">
          <Switch
            on={it.state === "on" || (it.state === "inherit" && it.usable)}
            label={`${it.name} ${it.usable ? t("{x} 开启", { x: "" }).trim() : t("{x} 关闭", { x: "" }).trim()}`}
            onChange={(on) => setCapState(kindKey, key, on ? "on" : "off")}
          />
          {!inherit && (
            <button type="button" className="cap-inherit-btn" aria-label={t("恢复跟随全局")}
              title={t("恢复跟随全局")}
              onClick={() => setCapState(kindKey, key, "inherit")}>
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">
                <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.6v2.6h-2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="drawer-mask" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t("会话设置")}>
        <div className="drawer-head">
          <h2>{t("会话设置")}</h2>
          <button className="btn-icon" onClick={onClose} aria-label={t("关闭会话设置")}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="drawer-scroll">
          <section className="drawer-sec">
            <h3>{t("助手身份")}</h3>
            {/* taste-skill-ignore: emoji is user-chosen persona identity, product feature */}
            <div className="assistant-strip">
              <button
                className={`ast-chip ${!sessionDetail?.assistant_id ? "on" : ""}`}
                onClick={() => setAssistant(null)}
              >
                <span className="ast-emoji">{"\u{1F916}"}</span>{t("默认")}
              </button>
              {(assistants || []).map((a) => (
                <button
                  key={a.id}
                  className={`ast-chip ${sessionDetail?.assistant_id === a.id ? "on" : ""}`}
                  onClick={() => setAssistant(a.id)}
                  title={a.description}
                >
                  <span className="ast-emoji">{a.emoji}</span>{a.name}
                </button>
              ))}
            </div>
            {currentAssistant && (
              <p className="drawer-note">{currentAssistant.description}</p>
            )}
          </section>

          <section className="drawer-sec">
            <h3>{t("会话提示词")}</h3>
            <p className="drawer-note">{t("叠加在助手身份之后，只对本会话生效。")}</p>
            <textarea
              className="drawer-textarea"
              rows={4}
              value={prompt}
              placeholder={t("例如：回答尽量简短，用中文。")}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="drawer-actions">
              <button className="btn btn-secondary" disabled={saving || prompt === (sessionDetail?.system_prompt || "")}
                onClick={() => { setPrompt(sessionDetail?.system_prompt || ""); }}>
                {t("还原")}
              </button>
              <button className="btn btn-primary" disabled={saving || prompt === (sessionDetail?.system_prompt || "")}
                onClick={savePrompt}>
                {t("保存提示词")}
              </button>
            </div>
          </section>

          <section className="drawer-sec">
            <h3>{t("温度")} <span className="num drawer-temp">{temp.toFixed(1)}</span></h3>
            <input
              type="range" min="0" max="2" step="0.1" value={temp}
              aria-label={t("温度")}
              onChange={(e) => saveTemp(parseFloat(e.target.value))}
            />
            <div className="range-labels"><span>{t("精确 0")}</span><span>{t("平衡 1")}</span><span>{t("发散 2")}</span></div>
          </section>

          {caps && (
            <section className="drawer-sec">
              <h3>
                {t("本会话能力")}
                <button type="button" className="cap-sync-btn" onClick={refreshCaps} aria-label={t("同步全局状态")}>
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
                    <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.6v2.6h-2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t("同步")}
                </button>
              </h3>
              <p className="drawer-note">{t("开关跟随「MCP」「技能」页的全局启用；此处可对单个能力做会话级强制开/关。")}</p>
              <h4 className="cap-group">{t("MCP 服务器")}</h4>
              {caps.mcps.length
                ? caps.mcps.map((m) => capItem(m, "mcp"))
                : <div className="cp-empty">{t("还没有 MCP，去「MCP」页安装。")}</div>}
              <h4 className="cap-group">{t("技能")}</h4>
              {caps.skills.length
                ? caps.skills.map((s) => capItem(s, "skill"))
                : <div className="cp-empty">{t("还没有技能，去「技能」页创建。")}</div>}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ---------- PickBar：输入框上方已选能力 chips（picked=null=跟随，不显示） ---------- */
function PickBar({ picked, remove }) {
  const { mcps, skills } = useStore();
  if (!picked) return null;
  const chips = [
    ...[...picked.mcps].map((id) => ({ kind: "mcp", id, text: mcps.find((m) => m.id === id)?.config.name })),
    ...[...picked.skills].map((slug) => ({ kind: "skill", id: slug, text: skills.find((s) => s.slug === slug)?.name })),
  ].filter((c) => c.text);
  if (!chips.length) return null;
  return (
    <div className="pick-bar">
      {chips.map((c) => (
        <span key={c.kind + c.id} className={`pick-chip ${c.kind === "skill" ? "sk" : ""}`}>
          {c.text}
          <span className="pc-x" role="button" aria-label={t("移除 {x}", { x: c.text })} onClick={() => remove(c.kind, c.id)}>
            <svg viewBox="0 0 16 16" width="9" height="9" fill="none">
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
        </span>
      ))}
    </div>
  );
}

/* ---------- 主组件 ---------- */
export default function ChatView() {
  useLang();
  const { sessions, sessionId, sessionDetail, messages, mcps, skills, assistants } = useStore();
  const [input, setInput] = useState("");
  // 活跃流快照（来自 streamManager；切走会话后流仍在跑，切回时这里拿到全量进度）
  const [stream, setStream] = useState(() => getStream());
  const [toolsOpen, setToolsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // null = 跟随会话生效能力（与管理页同步）；{mcps:Set, skills:Set} = 本条消息显式选择
  const [picked, setPicked] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]); // 待发送附件
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const taRef = useRef(null);
  const toolBtnRef = useRef(null);

  const session = sessions.find((s) => s.id === sessionId);
  const streamHere = stream && stream.sid === sessionId ? stream : null;
  const streamText = streamHere?.phase === "running" ? streamHere.text : "";
  const streamThinking = streamHere?.phase === "running" ? streamHere.thinking : "";
  const sending = streamHere?.phase === "running";

  // 订阅流状态（任何会话的流变化都通知；streamHere 过滤出本会话的）
  useEffect(() => subscribeStream((s) => {
    setStream(s);
    // 自己会话的流结束时，拉取持久化消息（done/error 都已落库）
    if (s && s.sid === sessionId && (s.phase === "done" || s.phase === "error")) {
      (async () => {
        try {
          const [msgs, sessions2] = await Promise.all([
            api.get(`/api/sessions/${s.sid}/messages`),
            api.get("/api/sessions"),
          ]);
          setState({ messages: msgs, sessions: sessions2 });
          resetStream();
        } catch { /* 忽略刷新失败 */ }
      })();
    }
  }), [sessionId]);

  const young = messages.length <= 2 && !streamText;
  const assistant = assistants?.find((a) => a.id === sessionDetail?.assistant_id);

  const usable = {
    mcps: mcps.filter((m) => {
      const cap = sessionDetail?.caps?.mcps.find((x) => x.id === m.id);
      return cap ? cap.usable : m.config.enabled && m.status === "running";
    }),
    skills: skills.filter((s) => {
      const cap = sessionDetail?.caps?.skills.find((x) => x.slug === s.slug);
      return cap ? cap.usable : s.enabled;
    }),
  };

  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [messages, streamText, streamHere?.steps, sending]);

  const autosize = (el) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const toggle = (kind, id) => {
    // 第一次点开关：从「跟随」进入显式模式，初始集合 = 当前会话生效能力
    setPicked((p) => {
      const base = p || {
        mcps: new Set(usable.mcps.map((m) => m.id)),
        skills: new Set(usable.skills.map((s) => s.slug)),
      };
      const next = { mcps: new Set(base.mcps), skills: new Set(base.skills) };
      const set = kind === "mcp" ? next.mcps : next.skills;
      if (set.has(id)) set.delete(id); else set.add(id);
      return next;
    });
  };
  const resetFollow = () => setPicked(null);
  const removeChip = (kind, id) => toggle(kind, id);

  const send = async (textOverride) => {
    const text = (textOverride ?? input).trim();
    const hasFiles = pendingFiles.length > 0;
    if ((!text && !hasFiles) || sending || !sessionId) return;
    setInput("");
    setPendingFiles([]);
    if (taRef.current) taRef.current.style.height = "auto";
    // picked=null → 不传选择（后端用全部会话生效能力）；显式模式 → 传所选集合
    const att = picked
      ? { mcps: [...picked.mcps], skills: [...picked.skills] }
      : { mcps: null, skills: null };
    setPicked(null);
    // 乐观插入用户消息（user_saved 事件到达后再以持久化消息覆盖）
    setState({
      messages: [...messages, {
        id: "tmp", role: "user", content: text, ts: Date.now(), tool_events: [],
        attachments: { mcps: att.mcps || [], skills: att.skills || [] },
        files: hasFiles ? pendingFiles : [],
      }],
    });
    try {
      await runStream({
        sid: sessionId, content: text,
        mcps: att.mcps ?? undefined, skills: att.skills ?? undefined,
        files: hasFiles ? pendingFiles : undefined,
        onUserSaved: (saved) => {
          // 用后端持久化的用户消息替换乐观消息
          setState((st) => ({
            messages: st.messages.map((m) => (m.id === "tmp" ? saved : m)),
          }));
        },
      });
      // done 后的刷新由 stream 订阅回调统一处理
    } catch (e) {
      toast(t("发送失败：{msg}", { msg: e.message }), "error");
    } finally {
      taRef.current?.focus();
    }
  };

  /* 附件上传：文件选择 + 粘贴图片 */
  const uploadFiles = async (fileList) => {
    const list = [...fileList].slice(0, 6); // 单次最多 6 个
    for (const f of list) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        const meta = await api.upload("/api/upload", fd);
        setPendingFiles((pf) => [...pf, meta]);
      } catch (e) {
        toast(t("上传失败：{msg}", { msg: e.message }), "error");
      }
    }
  };
  const removePending = (idx) => setPendingFiles((pf) => pf.filter((_, i) => i !== idx));

  const onMsgEdited = (updated) => {
    setState({ messages: messages.map((m) => (m.id === updated.id ? updated : m)) });
    toast(t("消息已更新"));
  };

  return (
    <div className="chat-layout">
      <main className="chat-main">
        <header className="chat-head">
          <div>
            <h1>{session?.title || t("选择或新建会话")}{assistant && (
              <span className="head-persona"><span aria-hidden="true">{assistant.emoji}</span> {assistant.name}</span>
            )}</h1>
            <p className="subline">
              {sessionDetail?.caps
                ? `${sessionDetail.caps.mcps.filter((m) => m.usable).length} 个 MCP · ${sessionDetail.caps.skills.filter((s) => s.usable).length} 个技能生效`
                : "命令以 / 开头，如 /tools"}
            </p>
          </div>
          <div className="head-actions">
            <button
              className="btn-icon chat-sessions-btn"
              aria-label={t("会话列表")}
              onClick={() => setState({ sessionsOpen: true })}
            >
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
                <path d="M2.5 4h11M2.5 8h11M2.5 12h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <button
              className={`btn btn-secondary ${sessionDetail ? "" : "hidden"}`}
              onClick={() => setSettingsOpen(true)}
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
                <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
                <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <span className="btn-label">{t("会话设置")}</span>
            </button>
          </div>
        </header>

        <div className="chat-scroll" ref={scrollRef}>
          <div className="msg-list">
            {!messages.length && !streamText && (
              <div className="empty-chat">
                <div className="ec-title">{t("开始对话")}</div>
                <div>{t("输入消息，或点下面的例子直接发送。命令以 / 开头。")}</div>
              </div>
            )}
            {messages.map((m) => (
              <Message key={m.id} m={m} mcps={mcps} skills={skills}
                onEdited={onMsgEdited}
                onAnswer={(ans) => send(ans)}
                answerDisabled={sending} />
            ))}
            {sending && streamHere && (
              <div className="msg msg-assistant" id="typing-msg">
                <div className="msg-role">Mini Buddy · <span className="num">{t("生成中…")}</span></div>
                {streamThinking && <Thinking text={streamThinking} live />}
                <ProcessLog steps={streamHere.steps} live />
                {streamHere.ask && (
                  <AskCard ask={streamHere.ask} onAnswer={(ans) => send(ans)} disabled />
                )}
                <div className="msg-bubble">
                  {streamText
                    ? <div className="stream-body" dangerouslySetInnerHTML={{ __html: md(streamText) }} />
                    : <span className="typing"><i /><i /><i /></span>}
                </div>
              </div>
            )}
          </div>
        </div>

        {young && (
          <div className="composer-sugs">
            {QUICK_PROMPTS.map((q) => (
              <button key={q} className="quick-chip" onClick={() => send(q)}>{q}</button>
            ))}
          </div>
        )}
        <PickBar picked={picked} remove={removeChip} />
        {pendingFiles.length > 0 && (
          <div className="attach-bar">
            {pendingFiles.map((f, i) => (
              <span key={i} className="pick-chip">
                {f.name.slice(0, 20)}{f.name.length > 20 ? "…" : ""}
                <span className="pc-x" role="button" aria-label={t("移除 {x}", { x: f.name })} onClick={() => removePending(i)}>
                  <svg viewBox="0 0 16 16" width="9" height="9" fill="none">
                    <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </span>
              </span>
            ))}
          </div>
        )}
        <div className="composer">
          <textarea
            ref={taRef}
            rows={1}
            placeholder={session ? t("发消息，或输入 / 查看命令…") : t("先选择或新建一个会话")}
            value={input}
            disabled={!session}
            aria-label={t("消息输入框")}
            onChange={(e) => { setInput(e.target.value); autosize(e.target); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            onPaste={(e) => {
              const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
              if (imgs.length) {
                e.preventDefault();
                uploadFiles(imgs);
              }
            }}
          />
          <div className="composer-foot">
            <div className="composer-tools" ref={toolBtnRef}>
              <input ref={fileInputRef} type="file" multiple hidden
                accept="image/*,text/*,.pdf,.json,.md,.txt,.csv"
                onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
              <button className="cap-picker" aria-label={t("上传文件")}
                title={t("上传文件")}
                onClick={() => fileInputRef.current?.click()}>
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
                  <path d="M8 11V3M8 3 4.8 6.2M8 3l3.2 3.2M2.8 10.5v1.7a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-1.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                className={`cap-picker ${toolsOpen || picked ? "active" : ""}`}
                aria-label={t("为本条消息选择 MCP 和技能")}
                aria-expanded={toolsOpen}
                onClick={() => setToolsOpen(!toolsOpen)}
              >
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
                  <rect x="2" y="4" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M5.5 2v3M10.5 2v3M2 7.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <circle cx="5.8" cy="10.2" r="0.9" fill="currentColor" />
                  <circle cx="10.2" cy="10.2" r="0.9" fill="currentColor" />
                </svg>
                <span>{t("MCP · 技能")}</span>
                {picked && (picked.mcps.size !== usable.mcps.length || picked.skills.size !== usable.skills.length) && (
                  <span className="cp-badge num">{picked.mcps.size + picked.skills.size}</span>
                )}
              </button>
              <ToolPopover
                open={toolsOpen}
                onClose={() => setToolsOpen(false)}
                anchor={toolBtnRef}
                usable={usable}
                picked={picked || { mcps: new Set(usable.mcps.map((m) => m.id)), skills: new Set(usable.skills.map((s) => s.slug)) }}
                touched={!!picked}
                toggle={toggle}
                resetFollow={resetFollow}
              />
            </div>
            <button className="btn btn-primary btn-send" aria-label={t("发送")} disabled={!session || sending} onClick={() => send()}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
                <path d="M8 13V3M8 3 3.5 7.5M8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </main>
      {settingsOpen && <SessionDrawer onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
