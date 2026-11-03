/**
 * Mini Buddy Cloudflare Worker 网关
 *
 * 架构（混合部署）：
 *   浏览器 → Cloudflare Worker
 *             ├─ 静态前端：Cloudflare Assets 直接托管（见 wrangler.jsonc）
 *             └─ /api/*  ：反向代理到 BACKEND_URL（Python 后端，可跑在本地/VPS/Docker）
 *
 * SSE 说明：/api/sessions/{id}/stream 返回 text/event-stream，
 * 这里不做任何缓冲，直接把上游响应体（ReadableStream）透传给浏览器。
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 非 API 路径：交给静态资产（含 SPA 回退）
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // API：反代到 Python 后端
    const backend = (env.BACKEND_URL || "").replace(/\/+$/, "");
    if (!backend) {
      return json(
        { detail: "BACKEND_URL 未配置。运行 `wrangler secret put BACKEND_URL` 指向可访问的 mini-buddy 后端（如 https://your-host:8688）" },
        503
      );
    }

    const upstream = new URL(url.pathname + url.search, backend);

    // 复制请求头并清理代理相关头（Host 由 fetch 按 URL 自动设置）
    const headers = new Headers(request.headers);
    for (const h of [
      "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor",
      "cf-warp-tag-id", "true-client-ip",
      "x-forwarded-for", "x-forwarded-proto", "x-real-ip",
      // Workers fetch 到源站不支持 HTTP/1.1 连接复用语义
      "connection", "keep-alive", "transfer-encoding", "upgrade",
    ]) headers.delete(h);

    const init = { method: request.method, headers, redirect: "manual" };
    if (!["GET", "HEAD"].includes(request.method)) {
      init.body = request.body;           // 流式转发请求体
      init.duplex = "half";               // ReadableStream body 必需
    }

    let resp;
    try {
      resp = await fetch(upstream, init);
    } catch (e) {
      return json({ detail: `后端不可达（${backend}）：${e.message}` }, 502);
    }

    // 原样透传状态码、响应头与流式响应体（SSE 不缓冲）
    const outHeaders = new Headers(resp.headers);
    outHeaders.delete("content-security-policy");
    outHeaders.delete("x-frame-options");
    return new Response(resp.body, { status: resp.status, headers: outHeaders });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
