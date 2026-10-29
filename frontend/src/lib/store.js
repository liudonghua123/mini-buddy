import { useSyncExternalStore } from "react";

/** 轻量全局 store：状态 + 订阅，避免引第三方状态库。 */
let state = {
  view: "chat",            // chat | assistants | mcp | skills | settings
  sessions: [],
  sessionId: null,
  sessionDetail: null,     // {id,title,assistant_id,system_prompt,temperature,overrides,caps}
  messages: [],
  mcps: [],
  skills: [],
  assistants: [],
  loaded: false,
  sessionsOpen: false,     // 移动端会话抽屉
  toasts: [],              // 必须初始化，避免 selector 每次返回新引用导致无限重渲
  dialog: null,
};

const listeners = new Set();
function emit() { for (const l of listeners) l(); }

export function getState() { return state; }
export function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

export function useStore(selector = (s) => s) {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => selector(state)
  );
}

/* ---------- Toast ---------- */
let toastSeq = 1;
export function toast(text, kind = "info") {
  const id = toastSeq++;
  setState({ toasts: [...(state.toasts || []), { id, text, kind }] });
  setTimeout(() => {
    setState({ toasts: (state.toasts || []).filter((t) => t.id !== id) });
  }, 3200);
}

/* ---------- 对话框（替代 alert/confirm/prompt） ----------
 * dialog: {kind:'confirm'|'prompt'|'custom', title, message, placeholder, value, danger, resolve}
 * 或组件弹窗直接挂 dialogHost
 */
let dialogSeq = 1;
export function openDialog(dialog) {
  return new Promise((resolve) => {
    setState({
      dialog: { id: dialogSeq++, ...dialog, resolve: (v) => { setState({ dialog: null }); resolve(v); } },
    });
  });
}
export function confirmDialog(title, message, { danger = false } = {}) {
  return openDialog({ kind: "confirm", title, message, danger });
}
export function promptDialog(title, { placeholder = "", value = "" } = {}) {
  return openDialog({ kind: "prompt", title, placeholder, value });
}
export function closeDialog(result) {
  if (state.dialog) state.dialog.resolve(result);
}
export function setDialogHost(node) { setState({ dialogHost: node }); }
