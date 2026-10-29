/* 全局流式管理器：流式输出挂在模块级单例上，切换会话不中断。
 *
 * 状态（模块级，不入 React store 以免大字符串重渲整树）：
 *   stream = {
 *     sid,            // 会话 id
 *     text,           // 已积累回复文本
 *     thinking,       // 已积累思考文本
 *     tools,          // [{name,detail,done}] 简版工具指示
 *     steps,          // 过程日志 [{kind,name,server,ok,elapsed_ms,input,output,running}]
 *     meta,           // {elapsed_ms,model,...} done 时填充
 *     phase,          // "running" | "done" | "error"
 *     startedAt,      // Date.now()
 *     error,          // phase=error 时的错误消息
 *   }
 * 订阅者（当前 ChatView）在 sessionId 匹配时实时渲染；
 * 切走后 SSE 读取循环继续，只是没有订阅者；切回时读全量快照。
 */

let stream = null;          // 当前活跃流（同一时刻至多一条）
const listeners = new Set();

export function getStream() { return stream; }

export function subscribeStream(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() { for (const l of listeners) l(stream ? { ...stream } : null); }

/** 推进过程日志步骤：running 标记的步骤就地更新，否则追加。 */
function pushStep(step) {
  if (!stream) return;
  const i = stream.steps.findIndex((s) => s.running);
  if (i >= 0) stream.steps[i] = { ...stream.steps[i], ...step, running: false };
  else stream.steps.push({ ...step, running: false });
}

/**
 * 启动一条流式回复（发送消息 → SSE → 完成）。
 * 返回 Promise<最终消息 | null>；即使中途切走会话也继续跑完并持久化。
 */
export async function runStream({ sid, content, mcps, skills, files, onUserSaved }) {
  if (stream && stream.phase === "running") {
    throw new Error("已有进行中的回复，请稍候");
  }
  stream = {
    sid, text: "", thinking: "", tools: [], steps: [], ask: null,
    meta: null, phase: "running", startedAt: Date.now(), error: "",
  };
  emit();

  const finish = (phase, errMsg) => {
    if (!stream || stream.sid !== sid) return;
    stream.phase = phase;
    if (errMsg) stream.error = errMsg;
    stream.meta = stream.meta || {
      elapsed_ms: Date.now() - stream.startedAt,
      model: "stream",
    };
    emit();
  };

  try {
    const res = await fetch(`/api/sessions/${sid}/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, mcps, skills, files }),
    });
    if (!res.ok) {
      let msg = `请求失败（${res.status}）`;
      try { const d = await res.json(); if (typeof d.detail === "string") msg = d.detail; } catch { /* ignore */ }
      finish("error", msg);
      emit();
      return null;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finalMsg = null;
    let userSaved = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = "message";
        const dataLines = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        let data = null;
        try { data = JSON.parse(dataLines.join("\n")); } catch { data = dataLines.join("\n"); }

        if (!stream) continue; // 已被 resetStream 清场
        if (event === "user_saved") {
          userSaved = true;
          onUserSaved?.(data);
        } else if (event === "delta") {
          stream.text += data;
        } else if (event === "thinking") {
          stream.thinking += data;
        } else if (event === "tool_start") {
          if (!stream.tools.find((x) => !x.done)) stream.tools.push({ name: data.name, detail: "", done: false });
        } else if (event === "tool_end") {
          const t = stream.tools.find((x) => !x.done);
          if (t) { t.done = true; t.detail = t.detail || "完成"; }
        } else if (event === "step_start") {
          // 过程日志：新步骤（可能仍在 running）
          stream.steps.push({ ...data, running: data.running !== false });
        } else if (event === "step_end") {
          const st = stream.steps.find((x) => x.running);
          if (st) { st.running = false; if (data.ok === false) st.ok = false; }
        } else if (event === "ask") {
          // HITL：助手向用户提问（随 done 的消息也会带 ask 字段）
          stream.ask = data;
        } else if (event === "done") {
          finalMsg = data;
          stream.meta = data.meta || stream.meta;
          stream.thinking = stream.thinking || data.thinking || "";
          // done 带回完整落库的 tool_events（含输入/输出），以此为准
          if (data.tool_events?.length) stream.steps = data.tool_events;
          finish("done");
        } else if (event === "error") {
          finalMsg = data;
          stream.text += (stream.text ? "\n\n" : "") + (data.content || "");
          if (data.tool_events?.length) stream.steps = data.tool_events;
          finish("error", data.content || "模型调用失败");
        }
        emit();
      }
    }
    if (!finalMsg && stream && stream.phase === "running") finish("error", "连接中断");
    emit();
    return finalMsg;
  } catch (e) {
    finish("error", e.message || String(e));
    emit();
    return null;
  }
}

/** 流结束后清场（调用方应先刷新消息列表再 reset）。 */
export function resetStream() {
  stream = null;
  emit();
}
