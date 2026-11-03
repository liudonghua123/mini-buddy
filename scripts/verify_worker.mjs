/**
 * Worker 网关本地验证（不依赖 wrangler/miniflare）：
 * 直接 import worker 的 default export，mock env.ASSETS，
 * BACKEND_URL 指向本机 8688 真实后端。
 *
 * 用法：node scripts/verify_worker.mjs [BASE_URL]
 * 通过条件：
 *   W1 API 反代（GET /api/sessions 返回后端 JSON）
 *   W2 后端不可达时 502 + JSON detail
 *   W3 SSE 流式透传（POST /stream 收到 event: 片段）
 *   W4 非 API 路径走 ASSETS（mock 返回标记内容）
 *   W5 透传 POST 请求体（JSON body 完整到达后端）
 *   W6 BACKEND_URL 未配置 → 503
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mod = await import(
  new URL(`file://${join(root, "worker/src/index.js").replace(/\\/g, "/")}`).href
);
const worker = mod.default;

const BASE = process.argv[2] || "http://127.0.0.1:8688";

// ---- mock ASSETS：模拟 Cloudflare 静态资产服务 ----
const assets = {
  async fetch(request) {
    return new Response(`__ASSETS__ ${new URL(request.url).pathname}`, {
      headers: { "content-type": "text/html" },
    });
  },
};

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

// W1: API 反代
{
  const req = new Request(`${BASE.replace(/\/$/, "") === BASE ? "http://worker.test" : "http://worker.test"}/api/sessions`);
  const env = { ASSETS: assets, BACKEND_URL: BASE };
  const resp = await worker.fetch(req, env);
  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  ok("W1 api proxy 200 + json", resp.status === 200 && parsed !== null,
     `status=${resp.status} body=${text.slice(0, 80)}`);
}

// W2: 后端不可达 → 502
{
  const env = { ASSETS: assets, BACKEND_URL: "http://127.0.0.1:59999" };
  const resp = await worker.fetch(new Request("http://worker.test/api/sessions"), env);
  const body = await resp.json();
  ok("W2 backend down -> 502", resp.status === 502 && String(body.detail).includes("不可达"),
     `status=${resp.status}`);
}

// W3: SSE 流式透传
{
  // 建会话
  const cs = await fetch(`${BASE}/api/sessions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "worker-e2e" }),
  });
  const sess = await cs.json();
  const env = { ASSETS: assets, BACKEND_URL: BASE };
  const resp = await worker.fetch(
    new Request(`http://worker.test/api/sessions/${sess.id}/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "回复一个字：好" }),
    }),
    env
  );
  const ct = resp.headers.get("content-type") || "";
  // 读流（限 30s）
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "", gotEvent = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    if (buf.includes("event:")) { gotEvent = true; break; }
  }
  try { await reader.cancel(); } catch {}
  ok("W3 sse passthrough", resp.status === 200 && ct.includes("text/event-stream") && gotEvent,
     `status=${resp.status} ct=${ct} gotEvent=${gotEvent}`);
}

// W4: 非 API 走 ASSETS
{
  const env = { ASSETS: assets, BACKEND_URL: BASE };
  const resp = await worker.fetch(new Request("http://worker.test/index.html"), env);
  const text = await resp.text();
  ok("W4 static via assets", text.startsWith("__ASSETS__"), text.slice(0, 40));
}

// W5: POST body 透传（用 404 端点验证后端收到的 JSON 结构 → 换真实端点 /api/assistants）
{
  const env = { ASSETS: assets, BACKEND_URL: BASE };
  const resp = await worker.fetch(
    new Request("http://worker.test/api/assistants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "worker-verify", prompt: "x" }),
    }),
    env
  );
  const body = await resp.json();
  ok("W5 post body passthrough", resp.status === 200 && body.name === "worker-verify",
     `status=${resp.status} ${JSON.stringify(body).slice(0, 80)}`);
  // 清理
  if (body.id) await fetch(`${BASE}/api/assistants/${body.id}`, { method: "DELETE" });
}

// W6: 未配置 BACKEND_URL → 503
{
  const resp = await worker.fetch(new Request("http://worker.test/api/sessions"),
                                  { ASSETS: assets });
  ok("W6 no backend url -> 503", resp.status === 503, `status=${resp.status}`);
}

console.log(`\n==== ${pass} PASS / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
