/* 助手视图：内置 + 自定义角色身份卡片网格 */
import React, { useState, useEffect } from "react";
import { useStore, setState, toast, confirmDialog } from "../lib/store.js";
import { api } from "../lib/api.js";
import { Modal } from "./Common.jsx";
import { t, useLang } from "../lib/i18n.js";

/* 搜索式绑定选择器：输入关键词过滤候选，点选添加 / 已选 chip × 删除 */
function BindPicker({ items, sel, setSel, allLabel, idKey, nameKey, subtitle, placeholder }) {
  const [q, setQ] = useState("");
  const kw = q.trim().toLowerCase();
  const nameOf = (it) => it[nameKey] || it.name || it.config?.name || it.id || it.slug;
  const match = (it) => {
    if (!kw) return true;
    const hay = [nameOf(it), it[idKey] || "",
      subtitle ? subtitle(it) || "" : ""].join(" ").toLowerCase();
    return kw.split(/\s+/).every((k) => hay.includes(k));
  };
  const idOf = (it) => it[idKey];
  const picked = sel === null ? [] : items.filter((it) => sel.includes(idOf(it)));
  const cands = items.filter((it) =>
    (sel === null || !sel.includes(idOf(it))) && match(it));
  const firstCand = cands[0];

  const add = (id) => setSel([...(sel ?? []), id]);   // 不限制 → 点第一个即转为指定
  const remove = (id) => {
    const rest = (sel || []).filter((x) => x !== id);
    setSel(rest.length ? rest : null);                // 删空回到「不限制」
  };
  const tryAddFirst = () => {                          // Enter 快捷添加首个候选
    if (firstCand) {
      add(idOf(firstCand));
      setQ("");
    }
  };

  return (
    <div className="bind-picker">
      <div className="bp-top">
        <input className="bp-search" value={q}
          placeholder={placeholder || t("输入关键词筛选，点选添加…")}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); tryAddFirst(); } }} />
        <button type="button"
          className={`bind-all ${sel === null ? "on" : ""}`}
          onClick={() => setSel(null)}>{allLabel}</button>
      </div>
      {picked.length > 0 && (
        <div className="bp-picked">
          {picked.map((it) => (
            <span className="bp-chip" key={idOf(it)}>
              {nameOf(it)}
              <button type="button" className="bp-x" aria-label={t("移除")}
                onClick={() => remove(idOf(it))}>
                <svg viewBox="0 0 10 10" width="8" height="8" fill="none" aria-hidden="true">
                  <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="bp-cands">
        {cands.map((it) => (
          <button key={idOf(it)} type="button" className="bp-cand"
            onClick={() => add(idOf(it))}>
            {nameOf(it)}
            {subtitle && subtitle(it) && <span className="bp-sub">{subtitle(it)}</span>}
          </button>
        ))}
        {cands.length === 0 && <span className="bp-none">
          {items.length === 0 ? t("暂无可选项") : t("没有匹配项")}</span>}
      </div>
    </div>
  );
}

/* 弹窗内分区标题 */
function Section({ icon, title, hint, children }) {
  return (
    <section className="ast-section">
      <div className="ast-section-head">
        <span className="ast-section-icon" aria-hidden="true">{icon}</span>
        <span className="ast-section-title">{title}</span>
        {hint && <span className="bind-hint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/* 助手弹窗 */
function AssistantModal({ initial, onClose, onSaved }) {
  const { mcps, skills } = useStore();
  const [kbs, setKbs] = useState([]);
  const [name, setName] = useState(initial?.name || "");
  const [emoji, setEmoji] = useState(initial?.emoji || "\u{1F916}");
  const [description, setDescription] = useState(initial?.description || "");
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  // null = 不限制（跟随全部）；数组 = 只用这些
  const [mcpSel, setMcpSel] = useState(initial?.mcps ?? null);
  const [skillSel, setSkillSel] = useState(initial?.skills ?? null);
  const [kbSel, setKbSel] = useState(initial?.kbs ?? null);
  const editing = !!initial;

  useEffect(() => {
    api.get("/api/kbs").then(setKbs).catch(() => {});
  }, []);

  const bindCount = (sel) => sel === null ? null : sel.length;

  const save = async () => {
    if (!name.trim()) { toast(t("请填写名称"), "error"); return; }
    const body = {
      name: name.trim(), emoji, description, prompt,
      mcps: mcpSel, skills: skillSel, kbs: kbSel,
    };
    if (editing) await api.put(`/api/assistants/${initial.id}`, body);
    else await api.post("/api/assistants", body);
    const assistants = await api.get("/api/assistants");
    setState({ assistants });
    toast(editing ? t("助手已保存") : t("助手已创建"));
    onSaved();
    onClose();
  };

  return (
    <Modal title={editing ? t("编辑助手") : t("新建助手")} onClose={onClose} wide footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>{t("取消")}</button>
        <button className="btn btn-primary" onClick={save}>{editing ? t("保存") : t("创建")}</button>
      </>
    }>
      <Section icon="🪪" title={t("身份")}>
        <div className="ast-form-row">
          <div className="field">
            <label>{t("名称")}</label>
            <input value={name} placeholder={t("例如：产品经理")} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>{t("图标")}</label>
            {/* taste-skill-ignore: emoji is user-chosen persona identity, product feature */}
            <div className="emoji-row">
              {["\u{1F916}", "\u{1F9D1}\u200D\u{1F4BB}", "\u270D\uFE0F", "\u{1F393}", "\u{1F30D}", "\u{1F4CA}", "\u{1F4A1}", "\u{1F3AF}", "\u{1F9ED}", "\u2699\uFE0F"].map((e) => (
                <button key={e} type="button" className={`emoji-pick ${emoji === e ? "on" : ""}`}
                  aria-label={`${t("图标")} ${e}`} onClick={() => setEmoji(e)}>{e}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="field">
          <label>{t("一句话描述")}</label>
          <input value={description} placeholder={t("这个助手擅长什么")} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label>{t("系统提示词")}</label>
          <textarea rows={5} value={prompt} placeholder={t("定义这个助手的身份、语气与工作方式…")}
            onChange={(e) => setPrompt(e.target.value)} />
        </div>
      </Section>

      <Section icon="🔌" title={t("能力绑定")}
        hint={t("不限制 = 跟随全局；指定后只有勾选项可用")}>
        <div className="field">
          <label>MCP{bindCount(mcpSel) !== null && <span className="bind-hint">{t("已选 {n} 项，其余禁用", { n: bindCount(mcpSel) })}</span>}</label>
          <BindPicker items={mcps || []} sel={mcpSel} setSel={setMcpSel}
            allLabel={t("不限制（全部可用）")} idKey="id" nameKey="name"
            subtitle={(m) => m.config?.description || ""}
            placeholder={t("搜索 MCP 服务器…")} />
        </div>
        <div className="field">
          <label>{t("技能")}{bindCount(skillSel) !== null && <span className="bind-hint">{t("已选 {n} 项，其余禁用", { n: bindCount(skillSel) })}</span>}</label>
          <BindPicker items={skills || []} sel={skillSel} setSel={setSkillSel}
            allLabel={t("不限制（全部可用）")} idKey="slug" nameKey="name"
            subtitle={(s) => s.description || ""}
            placeholder={t("搜索技能…")} />
        </div>
        <div className="field">
          <label>{t("知识库")}{bindCount(kbSel) !== null && <span className="bind-hint">{t("已选 {n} 个库", { n: bindCount(kbSel) })}</span>}</label>
          <BindPicker items={kbs} sel={kbSel} setSel={setKbSel}
            allLabel={t("不限制（检索全部库）")} idKey="id" nameKey="name"
            subtitle={(k) => k.doc_count > 0 ? t("{n} 篇文档", { n: k.doc_count }) : t("空库")}
            placeholder={t("搜索知识库…")} />
        </div>
      </Section>
    </Modal>
  );
}

export default function AssistantsView() {
  useLang();
  const { assistants } = useStore();
  const [editing, setEditing] = useState(null); // null | {} | assistant
  const list = assistants || [];

  const del = async (a) => {
    const yes = await confirmDialog(t("删除助手"), t("删除「{name}」？使用它的会话会恢复默认身份。", { name: a.name }), { danger: true });
    if (!yes) return;
    try {
      await api.del(`/api/assistants/${a.id}`);
      const assistants = await api.get("/api/assistants");
      setState({ assistants });
      toast(t("已删除"));
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>{t("助手")}</h1>
          <p className="subline">{t("给会话一个角色身份：内置 6 个，也可以造自己的。")}</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {t("新建助手")}
          </button>
        </div>
      </div>

      <div className="card-grid">
        {list.map((a) => (
          <div className="card ast-card" key={a.id}>
            <div className="card-head">
              <span className="ast-big" aria-hidden="true">{a.emoji}</span>
              <span className="c-name">{a.name}</span>
              {a.builtin && <span className="pill">{t("内置")}</span>}
            </div>
            <div className="card-desc">{a.description || t("没有描述")}</div>
            {a.prompt && <div className="ast-prompt">{a.prompt}</div>}
            <div className="ast-binds">
              <span className={`bind-pill ${a.mcps == null ? "" : "set"}`}>
                {t("MCP {s}", { s: a.mcps == null ? t("全部") : a.mcps.length })}
              </span>
              <span className={`bind-pill ${a.skills == null ? "" : "set"}`}>
                {t("技能 {s}", { s: a.skills == null ? t("全部") : a.skills.length })}
              </span>
              <span className={`bind-pill ${a.kbs == null ? "" : "set"}`}>
                {t("知识库 {s}", { s: a.kbs == null ? t("全部") : a.kbs.length })}
              </span>
            </div>
            <div className="card-foot">
              <button className="btn btn-ghost" onClick={() => setEditing(a)}>{t("编辑")}</button>
              <span className="spacer" />
              {!a.builtin && (
                <button className="btn btn-danger" onClick={() => del(a)}>{t("删除")}</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing !== null && (
        <AssistantModal initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => {}} />
      )}
    </div>
  );
}
