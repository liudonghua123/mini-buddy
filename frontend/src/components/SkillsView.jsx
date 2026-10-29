/* 技能视图：卡片、目录树 + Monaco 文件编辑器、新建/zip 上传、版本历史 */
import React, { useEffect, useRef, useState } from "react";
import { useStore, setState, toast, confirmDialog, promptDialog } from "../lib/store.js";
import { api } from "../lib/api.js";
import { Modal } from "./Common.jsx";
import { LibLoader } from "../lib/md.js";
import { t } from "../lib/i18n.js";
import { getTheme, useTheme } from "../lib/theme.js";

export async function loadSkills() {
  const skills = await api.get("/api/skills");
  setState({ skills });
  return skills;
}

function SkillCard({ sk, onView }) {
  const srcPill = sk.source === "builtin" ? t("内置") : sk.source === "zip" ? "zip" : t("手动");
  const act = async (fn, msg) => {
    try { await fn(); await loadSkills(); if (msg) toast(msg); }
    catch (e) { toast(e.message, "error"); }
  };
  const toggle = () => act(() => api.post(`/api/skills/${sk.slug}/toggle`, { enabled: !sk.enabled }),
    t(sk.enabled ? "已禁用" : "已启用"));
  const del = async () => {
    const yes = await confirmDialog(t("删除技能"), t("删除技能「{name}」？其文件将被移除。", { name: sk.name }), { danger: true, confirmText: t("删除") });
    if (!yes) return;
    act(() => api.del(`/api/skills/${sk.slug}`), t("已删除"));
  };
  return (
    <div className="card skill-card">
      <div className="card-head">
        <span className="c-name">{sk.name}</span>
        <span className={`pill ${sk.enabled ? "pill-running" : "pill-off"}`}>{sk.enabled ? t("启用") : t("禁用")}</span>
        <span className="pill">{srcPill}</span>
      </div>
      <div className="card-desc">{sk.description || t("无描述")}</div>
      <div className="card-meta">{sk.slug} · v{sk.version} · {t("{n} 个文件", { n: sk.files.length })}</div>
      <div className="card-foot">
        <button className="btn btn-ghost" onClick={() => onView(sk)}>{t("查看")}</button>
        <button className="btn btn-ghost" onClick={() => onView(sk)}>{t("编辑")}</button>
        <span className="spacer" />
        <button className="btn btn-secondary" onClick={toggle}>{sk.enabled ? t("禁用") : t("启用")}</button>
        <button className="btn btn-ghost btn-danger" onClick={del}>{t("删除")}</button>
      </div>
    </div>
  );
}

/* ---------- Monaco 编辑器弹窗 ---------- */
const LANGS = { md: "markdown", py: "python", js: "javascript", mjs: "javascript", ts: "typescript", json: "json", yaml: "yaml", yml: "yaml", html: "html", css: "css", txt: "plaintext" };
const langOf = (p) => LANGS[(p.split(".").pop() || "").toLowerCase()] || "plaintext";

function fmtTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* 版本历史面板：列表 + 文件预览 + 回滚 */
function VersionPanel({ sk, onClose }) {
  const [versions, setVersions] = useState(null);
  const [preview, setPreview] = useState(null); // {n, path, content}

  const load = () => api.get(`/api/skills/${encodeURIComponent(sk.slug)}/versions`)
    .then(setVersions).catch((e) => toast(e.message, "error"));
  useEffect(() => { load(); }, [sk.slug]);

  const openFile = async (n, path) => {
    try {
      const r = await api.get(`/api/skills/${encodeURIComponent(sk.slug)}/versions/${n}?path=${encodeURIComponent(path)}`);
      setPreview({ n, path, content: r.content });
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const rollback = async (n) => {
    const yes = await confirmDialog(t("回滚版本"), t("把 v{n} 的文件恢复到当前版本？当前内容会先自动保存为一个新版本。", { n }), { confirmText: t("回滚") });
    if (!yes) return;
    try {
      const r = await api.post(`/api/skills/${encodeURIComponent(sk.slug)}/rollback/${n}`);
      toast(t("已回滚 {n} 个文件", { n: r.count }));
      setPreview(null);
      load();
      loadSkills();
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <div className="ver-panel">
      <div className="ver-head">
        <span className="c-name">{t("版本历史")}</span>
        <span className="pill">{versions ? t("{n} 个版本", { n: versions.length }) : "…"}</span>
        <span className="spacer" />
        <button className="btn-icon" onClick={onClose} aria-label={t("版本历史")}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
            <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {!versions ? (
        <div className="cp-empty">{t("加载中…")}</div>
      ) : versions.length === 0 ? (
        <div className="cp-empty">{t("还没有历史版本。保存文件后会自动快照。")}</div>
      ) : (
        <div className="ver-list">
          {versions.map((v) => (
            <div className="ver-item" key={v.n}>
              <div className="ver-main">
                <span className="ver-num num">v{v.n}</span>
                <span className="ver-note">{v.note || t("自动快照")}</span>
                <span className="ver-meta num">{fmtTs(v.ts)} · {t("{n} 文件", { n: v.files.length })}</span>
              </div>
              <div className="ver-files">
                {v.files.map((f) => (
                  <button key={f} className="tool-chip ver-file-btn"
                    onClick={() => openFile(v.n, f)}>{f}</button>
                ))}
              </div>
              <div className="ver-foot">
                <span className="spacer" />
                <button className="btn btn-secondary ver-rollback" onClick={() => rollback(v.n)}>{t("回滚此版本")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {preview && (
        <div className="ver-preview">
          <div className="ver-preview-head">
            <strong className="num">v{preview.n}</strong> · {preview.path}
            <span className="spacer" />
            <button className="btn-icon" onClick={() => setPreview(null)} aria-label="关闭预览">
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none">
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <pre className="ver-code"><code>{preview.content}</code></pre>
        </div>
      )}
    </div>
  );
}

function SkillEditorModal({ sk, onClose }) {
  const theme = useTheme(); // 主题切换时联动 Monaco
  const [files, setFiles] = useState([]);
  const [current, setCurrent] = useState("SKILL.md");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [versionsDirty, setVersionsDirty] = useState(0); // 保存后递增，触发版本列表刷新
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const modelCache = useRef(new Map());
  const valueRef = useRef("");

  const refreshTree = async () => {
    const items = await api.get(`/api/skills/${encodeURIComponent(sk.slug)}/tree`);
    setFiles(items.filter((i) => !i.is_dir));
    return items;
  };
  useEffect(() => { refreshTree(); }, [sk.slug]);

  /* Monaco 懒加载 + 建编辑器 */
  useEffect(() => {
    let disposed = false;
    (async () => {
      const [fileData, monaco] = await Promise.all([
        api.get(`/api/skills/${encodeURIComponent(sk.slug)}/file?path=${encodeURIComponent("SKILL.md")}`),
        LibLoader.monaco(),
      ]);
      if (disposed || !hostRef.current) return;
      monacoRef.current = monaco;
      const model = monaco.editor.createModel(fileData.content, langOf("SKILL.md"));
      modelCache.current.set("SKILL.md", { model });
      editorRef.current = monaco.editor.create(hostRef.current, {
        model, theme: getTheme() === "dark" ? "vs-dark" : "vs", minimap: { enabled: false }, fontSize: 13,
        lineNumbers: "on", scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2,
        automaticLayout: true,
      });
      editorRef.current.onDidChangeModelContent(() => {
        valueRef.current = editorRef.current.getValue();
        setDirty(true);
      });
    })().catch((e) => toast(t("编辑器加载失败：{msg}", { msg: e.message }), "error"));
    return () => { disposed = true; editorRef.current?.dispose(); };
  }, [sk.slug]);

  /* 主题切换 → 更新 Monaco 主题 */
  useEffect(() => {
    monacoRef.current?.editor.setTheme(getTheme() === "dark" ? "vs-dark" : "vs");
  }, [theme]);

  const openFile = async (path) => {
    if (!editorRef.current) return;
    if (dirty && !window.__miniBuddyIgnore) {
      const yes = await confirmDialog("未保存的修改", `「${current}」有未保存修改，切换后将丢失。仍要切换？`, { danger: true });
      if (!yes) return;
    }
    try {
      const f = await api.get(`/api/skills/${encodeURIComponent(sk.slug)}/file?path=${encodeURIComponent(path)}`);
      const monaco = monacoRef.current;
      let cached = modelCache.current.get(path);
      if (!cached) {
        const model = monaco.editor.createModel(f.content, langOf(path));
        cached = { model };
        modelCache.current.set(path, cached);
      }
      editorRef.current.setModel(cached.model);
      valueRef.current = f.content;
      setCurrent(path);
      setDirty(false);
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const saveFile = async () => {
    if (!editorRef.current) return;
    setSaving(true);
    try {
      const r = await api.put(`/api/skills/${encodeURIComponent(sk.slug)}/file`, {
        path: current, content: editorRef.current.getValue(),
      });
      setDirty(false);
      toast(r.snapshot != null
        ? t("保存 {path}（快照 v{n}）", { path: current, n: r.snapshot })
        : t("已保存 {path}", { path: current }));
      setVersionsDirty((x) => x + 1);
      refreshTree();
      loadSkills();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const newFile = async () => {
    const path = await promptDialog(t("新建文件"), { placeholder: t("路径，如 reference/style.md") });
    if (!path || !path.trim()) return;
    try {
      await api.put(`/api/skills/${encodeURIComponent(sk.slug)}/file`, { path: path.trim(), content: "" });
      await refreshTree();
      await openFile(path.trim());
      toast(t("文件已创建"));
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const delFile = async (e, path) => {
    e.stopPropagation();
    if (path.toLowerCase() === "skill.md") { toast(t("SKILL.md 不可删除"), "error"); return; }
    const yes = await confirmDialog(t("删除文件"), t("删除「{path}」？", { path }), { danger: true, confirmText: t("删除") });
    if (!yes) return;
    try {
      await api.del(`/api/skills/${encodeURIComponent(sk.slug)}/file`, { path });
      modelCache.current.delete(path);
      if (current === path) await openFile("SKILL.md");
      await refreshTree();
      loadSkills();
      toast(t("已删除"));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  return (
    <Modal
      title={`${t("技能")} — ${sk.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-secondary" onClick={saveFile} disabled={saving || !editorRef.current}>
            {saving ? t("保存中…") : t("保存文件")}
          </button>
          <button className="btn btn-ghost" onClick={() => setShowVersions(true)}>
            {t("版本历史")}
          </button>
          {dirty && <span className="dirty-note">{t("有未保存修改")}</span>}
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>{t("完成")}</button>
        </>
      }
    >
      <div className="card-meta" style={{ marginBottom: 10 }}>
        {sk.slug} · v{sk.version} · {t("保存 SKILL.md 会同步技能名称与描述")} · {t("保存自动生成版本快照")}
      </div>
      <div className="skill-editor">
        <div className="skill-tree" role="tree" aria-label={t("技能文件目录")}>
          {files.map((f) => (
            <div key={f.path}
              className={`tree-item ${f.path === current ? "sel" : ""} ${f.path.endsWith("/") ? "dir" : ""}`}
              role="treeitem" aria-selected={f.path === current} tabIndex={0}
              onClick={() => openFile(f.path)}
              onKeyDown={(e) => { if (e.key === "Enter") openFile(f.path); }}>
              <span className="t-ico">{f.path.endsWith("/") ? "▸" : "M"}</span>
              <span>{f.path}</span>
              {!f.path.toLowerCase().endsWith("skill.md") && (
                <span className="t-del" role="button" aria-label={t("删除 {path}", { path: f.path })} onClick={(e) => delFile(e, f.path)}>
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="none">
                    <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </span>
              )}
            </div>
          ))}
          <button className="tree-add" onClick={newFile}>+ {t("新建文件")}</button>
        </div>
        <div className="skill-mono-wrap" ref={hostRef} aria-label={t("文件编辑区")} />
      </div>
      {showVersions && (
        <VersionPanel sk={{ ...sk, _tick: versionsDirty }} onClose={() => setShowVersions(false)} />
      )}
    </Modal>
  );
}

/* ---------- 新建技能弹窗 ---------- */
function NewSkillModal({ onClose }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [instructions, setInstructions] = useState("");
  const save = async () => {
    if (!name.trim()) { toast(t("请填写名称"), "error"); return; }
    try {
      await api.post("/api/skills", { name: name.trim(), description: desc, instructions });
      await loadSkills();
      toast(t("技能已创建"));
      onClose();
    } catch (e) {
      toast(e.message, "error");
    }
  };
  return (
    <Modal title={t("新建技能")} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{t("取消")}</button>
        <button className="btn btn-primary" onClick={save}>{t("创建")}</button>
      </>}>
      <div className="field">
        <label>{t("技能名称")}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("如 周报生成")} />
      </div>
      <div className="field">
        <label>{t("描述")}</label>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("一句话说明技能用途")} />
      </div>
      <div className="field">
        <label>{t("技能指令（会注入给模型）")}</label>
        <textarea rows={6} value={instructions} onChange={(e) => setInstructions(e.target.value)}
          placeholder={t("描述模型应如何处理输入…")} />
      </div>
    </Modal>
  );
}

export default function SkillsView() {
  const skills = useStore((s) => s.skills);
  const [editorFor, setEditorFor] = useState(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const zipRef = useRef(null);

  useEffect(() => { loadSkills(); }, []);

  const onZip = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api.upload("/api/skills/install", fd);
      await loadSkills();
      toast(t("技能包已安装"));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? skills.filter((s) => [
      s.name || "",
      s.description || "",
      s.slug || "",
      (s.files || []).join(" "),
    ].join(" ").toLowerCase().includes(q))
    : skills;

  return (
    <section className="view">
      <header className="view-head">
        <div>
          <h1>{t("技能")}</h1>
          <p className="subline">{t("{n} 个技能 · {e} 个启用", { n: skills.length, e: skills.filter((s) => s.enabled).length })}</p>
        </div>
        <div className="head-actions">
          <div className="search-box">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.4" />
              <path d="m10.4 10.4 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              placeholder={t("搜索技能名称、描述…")}
              aria-label={t("搜索技能")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="btn btn-secondary" onClick={() => zipRef.current?.click()}>{t("上传 zip")}</button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>{t("新建技能")}</button>
          <input ref={zipRef} type="file" accept=".zip" hidden onChange={onZip} aria-hidden="true" />
        </div>
      </header>
      {skills.length === 0 ? (
        <div className="empty-block">
          <div className="ec-title">{t("还没有技能")}</div>
          <div>{t("上传一个含 SKILL.md 的 zip，或点「新建技能」。")}</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-block">
          <div className="ec-title">{t("没有匹配「{q}」的技能", { q: query })}</div>
          <div>{t("试试搜索名称、描述或 slug。")}</div>
        </div>
      ) : (
        <div className="card-grid">
          {filtered.map((s) => <SkillCard key={s.slug} sk={s} onView={setEditorFor} />)}
        </div>
      )}
      {editorFor && <SkillEditorModal sk={editorFor} onClose={() => setEditorFor(null)} />}
      {creating && <NewSkillModal onClose={() => setCreating(false)} />}
    </section>
  );
}
