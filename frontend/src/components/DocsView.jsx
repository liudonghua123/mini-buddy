/* 知识库视图：两级（库列表 → 库内文档）+ 检索测试 + 查看/编辑/分段编辑 */
import React, { useEffect, useState } from "react";
import { toast, confirmDialog } from "../lib/store.js";
import { api } from "../lib/api.js";
import { Modal } from "./Common.jsx";
import { md } from "../lib/md.js";
import { t, useLang } from "../lib/i18n.js";

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* 按文档类型渲染只读正文：md 渲染 / csv 表格 / json·其余 等宽 */
function DocReader({ doc }) {
  const name = (doc.name || "").toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    return <div className="doc-reader" dangerouslySetInnerHTML={{ __html: md(doc.text) }} />;
  }
  if (name.endsWith(".csv")) {
    const rows = doc.text.split(/\r?\n/).filter((r) => r.trim()).map((r) => r.split(","));
    if (rows.length) {
      const head = rows[0], body = rows.slice(1, 201);
      return (
        <div className="doc-reader">
          <table className="doc-csv">
            <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>{body.map((r, ri) => (
              <tr key={ri}>{head.map((_, ci) => <td key={ci}>{r[ci] || ""}</td>)}</tr>
            ))}</tbody>
          </table>
          {rows.length > 201 && <div className="doc-more">{t("仅预览前 200 行")}</div>}
        </div>
      );
    }
  }
  return <pre className="doc-plain">{doc.text}</pre>;
}

/* 查看 / 全文编辑 / 分段编辑 三模式弹窗 */
function DocModal({ docId, onClose, onChanged }) {
  const [data, setData] = useState(null);       // { doc, chunks }
  const [mode, setMode] = useState("read");     // read | full | chunks
  const [fullText, setFullText] = useState("");
  const [drafts, setDrafts] = useState({});     // chunk_id -> text
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const r = await api.get(`/api/docs/${docId}`);
    setData(r);
    setFullText(r.doc.text || "");
    setDrafts({});
  };
  useEffect(() => { load(); }, [docId]);

  const saveFull = async () => {
    setSaving(true);
    try {
      await api.put(`/api/docs/${docId}`, { text: fullText });
      toast(t("已重新分块并向量化"));
      await load();
      setMode("read");
      onChanged();
    } catch (e) { toast(e.message, "error"); }
    setSaving(false);
  };

  const saveChunk = async (cid) => {
    setSaving(true);
    try {
      await api.put(`/api/docs/${docId}/chunks/${cid}`, { text: drafts[cid] ?? "" });
      toast(t("分段已更新并重新嵌入"));
      await load();
      onChanged();
    } catch (e) { toast(e.message, "error"); }
    setSaving(false);
  };

  const delChunk = async (c) => {
    const yes = await confirmDialog(t("删除分段"),
      t("删除该分段？其余分段保持不变。"), { danger: true });
    if (!yes) return;
    await api.put(`/api/docs/${docId}/chunks/${c.id}`, { text: "" });
    toast(t("分段已删除"));
    await load();
    onChanged();
  };

  if (!data) {
    return (
      <Modal title={t("文档详情")} onClose={onClose} wide>
        <div className="cp-empty">{t("加载中…")}</div>
      </Modal>
    );
  }
  const { doc, chunks } = data;
  const seg = (k) => `seg ${mode === k ? "on" : ""}`;

  return (
    <Modal title={doc.name} onClose={onClose} wide footer={
      mode === "full" ? (
        <>
          <button className="btn btn-ghost" onClick={() => { setMode("read"); setFullText(doc.text); }}>{t("取消")}</button>
          <button className="btn btn-primary" disabled={saving} onClick={saveFull}>{t("保存并重新分块")}</button>
        </>
      ) : (
        <button className="btn btn-secondary" onClick={onClose}>{t("关闭")}</button>
      )
    }>
      <div className="doc-toolbar">
        <div className="seg-row" role="tablist">
          <button type="button" className={seg("read")} onClick={() => setMode("read")}>{t("阅读")}</button>
          <button type="button" className={seg("full")} onClick={() => { setFullText(doc.text); setMode("full"); }}>{t("全文编辑")}</button>
          <button type="button" className={seg("chunks")} onClick={() => setMode("chunks")}>
            {t("分段编辑")}<span className="seg-count">{chunks.length}</span>
          </button>
        </div>
        <span className="doc-size num">{(doc.size / 1024).toFixed(1)} KB</span>
      </div>

      {mode === "read" && <DocReader doc={doc} />}

      {mode === "full" && (
        <textarea className="doc-full-edit" rows={18} value={fullText}
          spellCheck={false}
          placeholder={t("编辑全文，保存后重新分块并向量化")}
          onChange={(e) => setFullText(e.target.value)} />
      )}

      {mode === "chunks" && (
        <div className="doc-chunks">
          {chunks.length === 0 && <div className="cp-empty">{t("没有分段。")}</div>}
          {chunks.map((c) => (
            <div className="doc-chunk" key={c.id}>
              <div className="doc-chunk-head">
                <span className="doc-chunk-idx num">#{c.idx + 1}</span>
                <span className="doc-chunk-chars num">{c.chars} {t("字")}</span>
                <span className="spacer" />
                <button className="btn btn-ghost" disabled={saving}
                  onClick={() => saveChunk(c.id)}>{t("保存此段")}</button>
                <button className="btn btn-danger" onClick={() => delChunk(c)}>{t("删除段")}</button>
              </div>
              <textarea rows={Math.min(8, Math.max(3, Math.ceil(c.chars / 60)))}
                value={drafts[c.id] ?? c.text} spellCheck={false}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* 新建 / 编辑知识库弹窗 */
function KbModal({ initial, onClose, onSaved }) {
  const editing = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");

  const save = async () => {
    if (!name.trim()) { toast(t("请输入知识库名称"), "error"); return; }
    try {
      if (editing) await api.put(`/api/kbs/${initial.id}`, { name: name.trim(), description });
      else await api.post("/api/kbs", { name: name.trim(), description });
      toast(editing ? t("知识库已保存") : t("知识库已创建"));
      onSaved();
      onClose();
    } catch (e) { toast(e.message, "error"); }
  };

  return (
    <Modal title={editing ? t("编辑知识库") : t("新建知识库")} onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>{t("取消")}</button>
        <button className="btn btn-primary" onClick={save}>{editing ? t("保存") : t("创建")}</button>
      </>
    }>
      <div className="field">
        <label>{t("名称")}</label>
        <input value={name} placeholder={t("例如：产品资料")} autoFocus
          onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>{t("描述")}</label>
        <input value={description} placeholder={t("这个库存什么内容（可选）")}
          onChange={(e) => setDescription(e.target.value)} />
      </div>
    </Modal>
  );
}

/* 删除库确认：选择是否连同文档 */
async function kbDeleteDialog(kb) {
  return confirmDialog(
    t("删除知识库"),
    kb.doc_count > 0
      ? t("「{name}」里有 {n} 篇文档，删除库时这些文档怎么处理？", { name: kb.name, n: kb.doc_count })
      : t("确定删除空知识库「{name}」？", { name: kb.name }),
    { danger: true }
  );
}

export default function DocsView() {
  useLang();
  const [kbs, setKbs] = useState([]);
  const [current, setCurrent] = useState(null);   // 当前库（null = 库列表）
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [kbModal, setKbModal] = useState(null);   // null | {} | kb
  const [kbLoading, setKbLoading] = useState(false);

  const loadKbs = async () => setKbs(await api.get("/api/kbs"));
  const loadDocs = async (kbId) => {
    setKbLoading(true);
    const list = await api.get(`/api/docs?kb_id=${encodeURIComponent(kbId)}`);
    setDocs(list);
    setKbLoading(false);
  };
  useEffect(() => { loadKbs(); }, []);

  const openKb = async (kb) => {
    setCurrent(kb);
    setHits(null);
    setQuery("");
    await loadDocs(kb.id);
  };

  const upload = async (fileList) => {
    const list = [...fileList].slice(0, 5);
    setBusy(true);
    for (const f of list) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        await api.upload(`/api/docs?kb_id=${encodeURIComponent(current.id)}`, fd);
        toast(t("「{name}」已入库", { name: f.name }));
      } catch (e) {
        toast(e.message, "error");
      }
    }
    setBusy(false);
    await loadDocs(current.id);
    loadKbs();
  };

  const del = async (d) => {
    const yes = await confirmDialog(t("删除文档"), t("删除「{name}」及其全部向量分块？", { name: d.name }), { danger: true });
    if (!yes) return;
    await api.del(`/api/docs/${d.id}`);
    toast(t("已删除"));
    await loadDocs(current.id);
    loadKbs();
  };

  const delKb = async (kb) => {
    const yes = await kbDeleteDialog(kb);
    if (!yes) return;
    let withDocs = true;
    if (kb.doc_count > 0) {
      // 再问一次：只删库（文档移入最早的库）还是连同文档删除
      const moveInstead = await confirmDialog(
        t("文档处理"),
        t("选择「确定」把 {n} 篇文档移入最早的库再删除本库；选择「取消」则连同文档一起删除。", { n: kb.doc_count })
      );
      withDocs = !moveInstead;
    }
    try {
      await api.del(`/api/kbs/${kb.id}?with_docs=${withDocs}`);
      toast(t("知识库已删除"));
      loadKbs();
    } catch (e) { toast(e.message, "error"); }
  };

  const search = async () => {
    if (!query.trim()) return;
    const body = current ? { query, kb_ids: [current.id] } : { query };
    const r = await api.post("/api/docs/search", body);
    setHits(r);
  };

  /* ---------- 库详情视图 ---------- */
  if (current) {
    return (
      <div className="view">
        <div className="view-head">
          <div>
            <div className="kb-crumbs">
              <button className="crumb-back" onClick={() => { setCurrent(null); setHits(null); }}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
                  <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t("全部知识库")}
              </button>
            </div>
            <h1>{current.name}</h1>
            <p className="subline">{current.description || t("在这个库上传文档，聊天时自动检索。")}</p>
          </div>
          <div className="head-actions">
            <label className={`btn btn-primary ${busy ? "disabled" : ""}`}>
              <input type="file" multiple hidden accept=".txt,.md,.csv,.json,.pdf,text/*,application/pdf"
                onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
              {busy ? t("解析中…") : t("上传文档")}
            </label>
          </div>
        </div>

        <div className="rag-test">
          <input className="search-box" value={query} placeholder={t("在「{name}」内检索测试", { name: current.name })}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
          <button className="btn btn-secondary" onClick={search}>{t("检索")}</button>
        </div>
        {hits !== null && (
          <div className="rag-hits">
            {hits.length === 0 ? <div className="cp-empty">{t("没有命中的片段。")}</div> :
              hits.map((h, i) => (
                <div className="rag-hit" key={h.chunk_id}>
                  <div className="rag-hit-head">[{i + 1}] {h.doc_name} · {t("相关度")} {h.score}</div>
                  <div className="rag-hit-text">{h.text.slice(0, 200)}{h.text.length > 200 ? "…" : ""}</div>
                </div>
              ))}
          </div>
        )}

        {kbLoading ? <div className="cp-empty">{t("加载中…")}</div> : (
          <>
            {docs.length === 0 && hits === null && (
              <div className="empty-block"><div className="ec-title">{t("这个库还没有文档")}</div>
                <div>{t("支持 txt / md / csv / json / pdf。")}</div></div>
            )}
            <div className="card-grid">
              {docs.map((d) => (
                <div className="card doc-card" key={d.id}>
                  <div className="card-head">
                    <span className="doc-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
                        <path d="M4 2h5.2L12.5 5.3V14a.7.7 0 0 1-.7.7H4a.7.7 0 0 1-.7-.7V2.7A.7.7 0 0 1 4 2Z" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M9 2v3.5h3.5" stroke="currentColor" strokeWidth="1.2" />
                      </svg>
                    </span>
                    <span className="c-name">{d.name}</span>
                  </div>
                  <div className="card-meta">{d.chunks} {t("分块")} · {(d.size / 1024).toFixed(1)} KB · {fmtTime(d.created_at)}</div>
                  <div className="card-foot">
                    <button className="btn btn-ghost" onClick={() => setOpenId(d.id)}>{t("查看")}</button>
                    <span className="spacer" />
                    <button className="btn btn-danger" onClick={() => del(d)}>{t("删除")}</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {openId && <DocModal docId={openId} onClose={() => setOpenId(null)} onChanged={() => { loadDocs(current.id); loadKbs(); }} />}
      </div>
    );
  }

  /* ---------- 库列表视图 ---------- */
  return (
    <div className="view">
      <div className="view-head">
        <div>
          <h1>{t("知识库")}</h1>
          <p className="subline">{t("按主题分库管理文档，聊天时自动检索相关片段注入上下文。")}</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-primary" onClick={() => setKbModal({})}>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {t("新建知识库")}
          </button>
        </div>
      </div>

      {kbs.length === 0 && (
        <div className="empty-block"><div className="ec-title">{t("还没有知识库")}</div>
          <div>{t("先新建一个库，再往里上传文档。")}</div></div>
      )}
      <div className="card-grid">
        {kbs.map((kb) => (
          <div className="card kb-card" key={kb.id}
            onClick={() => openKb(kb)} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter") openKb(kb); }}>
            <div className="card-head">
              <span className="kb-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
                  <path d="M2.5 4.2 8 2l5.5 2.2v7.6L8 14l-5.5-2.2V4.2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  <path d="M2.5 4.2 8 6.4l5.5-2.2M8 6.4V14" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="c-name">{kb.name}</span>
            </div>
            <div className="card-desc">{kb.description || t("没有描述")}</div>
            <div className="card-meta">
              {kb.doc_count} {t("篇文档")} · {kb.total_chunks} {t("分块")} · {(kb.total_size / 1024).toFixed(1)} KB
            </div>
            <div className="card-foot" onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-ghost" onClick={() => openKb(kb)}>{t("打开")}</button>
              <span className="spacer" />
              <button className="btn btn-ghost" onClick={() => setKbModal(kb)}>{t("编辑")}</button>
              <button className="btn btn-danger" onClick={() => delKb(kb)}>{t("删除")}</button>
            </div>
          </div>
        ))}
      </div>

      {kbModal && (
        <KbModal initial={kbModal.id ? kbModal : null}
          onClose={() => setKbModal(null)}
          onSaved={loadKbs} />
      )}
    </div>
  );
}
