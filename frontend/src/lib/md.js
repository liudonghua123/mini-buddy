/* Markdown 渲染 + mermaid/echarts 图表代码块解析 */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/** 把 markdown 文本转 HTML；mermaid/echarts 代码块产出 <div data-chart> 占位。 */
export function md(text) {
  const blocks = [];
  let t = String(text).replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) => {
    if (lang === "mermaid") {
      blocks.push(`<div class="chart-block" data-chart="mermaid">${esc(code.trim())}</div>`);
    } else if (lang === "echarts") {
      blocks.push(`<div class="chart-block" data-chart="echarts">${esc(code.trim())}</div>`);
    } else {
      blocks.push(`<pre><code>${esc(code.replace(/^\w*\n/, ""))}</code></pre>`);
    }
    return `\u0000${blocks.length - 1}\u0000`;
  });
  t = esc(t);
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  const out = [];
  let listBuf = [];
  const flushList = () => {
    if (listBuf.length) {
      out.push("<ul>" + listBuf.map((i) => `<li>${i}</li>`).join("") + "</ul>");
      listBuf = [];
    }
  };
  for (const line of t.split("\n")) {
    const m = line.match(/^\s*[-*]\s+(.*)/);
    if (m) { listBuf.push(m[1]); continue; }
    flushList();
    if (line.trim() === "") continue;
    if (/^\u0000\d+\u0000$/.test(line.trim())) { out.push(line.trim()); continue; }
    out.push(`<p>${line}</p>`);
  }
  flushList();
  return out.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
}

/* ---------- CDN 库懒加载（mermaid / echarts / monaco） ---------- */
const loaded = {};
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
    document.head.appendChild(s);
  });
}

export const LibLoader = {
  async mermaid() {
    if (loaded.mermaid) return loaded.mermaid;
    // mermaid@10 UMD 优先：@11 ESM 在部分环境（headless / 中文标签）dagre 布局度量异常
    try {
      await loadScript("https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js");
      const m = window.mermaid;
      if (!m) throw new Error("no window.mermaid");
      m.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
      loaded.mermaid = m;
      return m;
    } catch (e10) {
      const mod = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
      const m = mod.default || mod;
      if (!m) throw new Error("mermaid 加载失败: " + (e10 && e10.message || e10));
      m.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
      loaded.mermaid = m;
      return m;
    }
  },
  async echarts() {
    if (loaded.echarts) return loaded.echarts;
    await loadScript("https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js");
    if (!window.echarts) throw new Error("echarts 加载失败");
    loaded.echarts = window.echarts;
    return window.echarts;
  },
  async monaco() {
    if (loaded.monaco) return loaded.monaco;
    const base = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/";
    await loadScript(base + "vs/loader.js");
    if (!window.require) throw new Error("monaco loader 加载失败");
    await new Promise((resolve, reject) => {
      window.require.config({ paths: { vs: base + "vs" } });
      window.require(["vs/editor/editor.main"], resolve, reject);
    });
    if (!window.monaco) throw new Error("monaco 加载失败");
    loaded.monaco = window.monaco;
    return window.monaco;
  },
};

/** 渲染 rootEl 内所有 data-chart 容器。返回清理函数（echarts 实例 dispose）。 */
export async function renderCharts(rootEl) {
  const disposers = [];
  for (const el of rootEl.querySelectorAll('[data-chart="mermaid"]')) {
    const src = el.textContent;
    try {
      const mermaid = await LibLoader.mermaid();
      const { svg } = await mermaid.render("mmd-" + Math.random().toString(36).slice(2), src);
      el.innerHTML = svg;
    } catch (e) {
      el.innerHTML = "";
      el.className = "chart-err";
      el.textContent = `mermaid 渲染失败：${String(e.message || e)}`;
    }
  }
  for (const el of rootEl.querySelectorAll('[data-chart="echarts"]')) {
    const src = el.textContent;
    try {
      const echarts = await LibLoader.echarts();
      const opt = JSON.parse(src);
      el.innerHTML = "";
      el.style.height = "300px";
      const chart = echarts.init(el);
      chart.setOption(opt);
      disposers.push(() => chart.dispose());
    } catch (e) {
      el.innerHTML = "";
      el.className = "chart-err";
      el.textContent = `echarts 渲染失败：${String(e.message || e)}`;
    }
  }
  return () => disposers.forEach((d) => d());
}

export function slugify(name) {
  const s = String(name).toLowerCase().trim()
    .replace(/[^a-z0-9_\-\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "skill";
}
