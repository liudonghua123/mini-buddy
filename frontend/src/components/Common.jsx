/* 通用小组件：Toast 容器、确认/输入对话框、键值对编辑器 */
import React, { useEffect, useRef, useState } from "react";
import { useStore, closeDialog } from "../lib/store.js";
import { t } from "../lib/i18n.js";

export function ToastHost() {
  const toasts = useStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}

export function DialogHost() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  if (dialog.kind === "custom") return dialog.node;
  return <ConfirmPromptDialog dialog={dialog} />;
}

function ConfirmPromptDialog({ dialog }) {
  const [value, setValue] = useState(dialog.value || "");
  const inputRef = useRef(null);
  useEffect(() => {
    if (dialog.kind === "prompt" && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [dialog]);
  const submit = () => {
    if (dialog.kind === "prompt") dialog.resolve(value);
    else dialog.resolve(true);
  };
  return (
    <div className="modal-mask" role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) dialog.resolve(false); }}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label={dialog.title}>
        <div className="modal-head">
          <h2 className="modal-title">{dialog.title}</h2>
        </div>
        <div className="modal-body">
          {dialog.message && <p className="modal-message">{dialog.message}</p>}
          {dialog.kind === "prompt" && (
            <input
              ref={inputRef}
              className="modal-input"
              value={value}
              placeholder={dialog.placeholder || ""}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") dialog.resolve(null);
              }}
            />
          )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => dialog.resolve(false)}>{t("取消")}</button>
          <button
            className={`btn ${dialog.danger ? "btn-danger-solid" : "btn-primary"}`}
            onClick={submit}
          >
            {dialog.kind === "prompt" ? t("确定") : (dialog.confirmText ? t(dialog.confirmText) : t("确认"))}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 通用弹窗壳：标题 + 关闭 + 内容 + 底部操作 */
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-mask" role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? "modal-lg" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button className="btn-icon" onClick={onClose} aria-label={t("关闭")}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  );
}

/** 键值对编辑器（MCP env / headers 复用） */
export function KvEditor({ value = {}, onChange, keyPlaceholder = "键", valuePlaceholder = "值" }) {
  const [rows, setRows] = useState(() => {
    const entries = Object.entries(value);
    return entries.length ? entries : [];
  });
  useEffect(() => {
    const obj = {};
    for (const [k, v] of rows) if (k.trim()) obj[k.trim()] = v;
    onChange(obj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  const upd = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? [k, v] : r)));
  return (
    <div className="kv-editor">
      {rows.map(([k, v], i) => (
        <div className="kv-row" key={i}>
          <input value={k} placeholder={keyPlaceholder} onChange={(e) => upd(i, e.target.value, v)} />
          <input value={v} placeholder={valuePlaceholder} onChange={(e) => upd(i, k, e.target.value)} />
          <button type="button" className="btn-icon" aria-label={t("移除此项")}
            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost kv-add"
        onClick={() => setRows((rs) => [...rs, ["", ""]])}>
        {t("+ 添加一项")}
      </button>
    </div>
  );
}
