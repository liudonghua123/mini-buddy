# Mini Buddy × Cloudflare Workers 部署

Mini Buddy 采用**混合架构**部署到 Cloudflare：Worker 托管前端静态资源，并把 `/api/*`
反向代理到你自己的 Python 后端（本地机器 / VPS / Docker 均可）。

```
浏览器 → Cloudflare Worker
          ├─ 静态前端     Cloudflare Assets（frontend/dist）
          └─ /api/*      反代 BACKEND_URL（Python 后端，SSE 流式透传）
```

> 为什么后端不放进 Worker？后端依赖 agentscope 运行时、stdio 子进程 MCP、
> `~/.mini-buddy` 文件持久化——这些在 Workers 运行时不可用。混合架构让前端获得
> Cloudflare 的全球加速与统一域名（免 CORS），后端保持完整能力。

## 1. 暴露 Python 后端

Worker 需要能通过 HTTPS 访问你的后端。常见方案任选其一：

- **Cloudflare Tunnel（推荐，无需公网 IP）**：
  ```bash
  cloudflared tunnel --url http://127.0.0.1:8688
  # 得到 https://xxx.trycloudflare.com
  ```
- **VPS / Docker**：用 Caddy/Nginx 反代 + TLS，或直接暴露端口。
- 后端监听地址可用环境变量控制：`HOST=0.0.0.0 PORT=8688 python run.py`

> ⚠️ 安全提示：mini-buddy 后端无鉴权，公网暴露前请自行加反代层鉴权
> （如 Cloudflare Access、Basic Auth）或仅在内网使用。

## 2. 部署 Worker

```bash
cd worker
npm install

# 配置后端地址（secret 优先于 wrangler.jsonc 里的 vars）
npx wrangler secret put BACKEND_URL
# 输入：https://xxx.trycloudflare.com（或你的后端地址）

# 部署（自动上传 ../frontend/dist 静态资产）
npx wrangler deploy
```

本地调试：

```bash
# 先启动后端
HOST=127.0.0.1 PORT=8688 python run.py

# 再起 Worker（BACKEND_URL 默认 http://127.0.0.1:8688）
cd worker && npx wrangler dev
# 打开 http://localhost:8787
```

## 3. 实现细节

- `wrangler.jsonc`：`assets.run_worker_first: ["/api/*"]` 让 API 请求先进 Worker，
  其余路径由 Assets 直接服务（SPA 回退 `single-page-application`）。
- `src/index.js`：删除 `cf-*` / `x-forwarded-*` 代理头；请求体流式转发（`duplex: half`）；
  响应体不缓冲，`text/event-stream` 原样透传，保证聊天打字机效果。
- `BACKEND_URL` 支持路径前缀（如 `https://host/base`）。

## 4. 普通环境部署（不变）

原来的方式完全保留——后端 + 前端构建产物由 FastAPI 同端口服务：

```bash
uv sync
cd frontend && npm ci && npm run build && cd ..
python run.py            # http://127.0.0.1:8688
```

两种方式可并存：内网直连后端，外网走 Cloudflare。
