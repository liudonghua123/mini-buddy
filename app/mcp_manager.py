"""MCPManager：MCP 服务器的生命周期与工具调用。

支持四种 transport：
- builtin: 进程内 FastMCP 实例（内置演示服务器）
- stdio:   子进程 + JSON-RPC（FastMCP 的 StdioTransport，可设 env/cwd）
- http:    Streamable HTTP（可设自定义请求头）
- sse:     SSE（可设自定义请求头）
"""
from __future__ import annotations

import asyncio
import threading
from typing import Any

from fastmcp import Client
from fastmcp.client.transports import (
    FastMCPTransport,
    SSETransport,
    StdioTransport,
    StreamableHttpTransport,
)

from . import builtin_mcps
from .models import MCPServer, MCPServerConfig, now_ms, new_id

DEFAULT_TIMEOUT = 30.0


class MCPManager:
    def __init__(self) -> None:
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._loop.run_forever, daemon=True, name="mcp-loop")
        self._thread.start()
        self._clients: dict[str, Client] = {}

    # ---- 事件循环封装 ----
    def run(self, coro, timeout: float | None = None):
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result(
            timeout=timeout if timeout is not None else DEFAULT_TIMEOUT + 10)

    def _build_client(self, cfg: MCPServerConfig) -> Client:
        to = max(5.0, float(cfg.timeout or DEFAULT_TIMEOUT))
        if cfg.transport == "builtin":
            inst = builtin_mcps.get_builtin_instance(cfg.builtin_id or "")
            return Client(FastMCPTransport(inst), timeout=to)
        if cfg.transport == "stdio":
            return Client(StdioTransport(
                cfg.command or "", cfg.args,
                env=cfg.env or None, cwd=cfg.cwd or None,
            ), timeout=to)
        if cfg.transport == "http":
            return Client(StreamableHttpTransport(
                cfg.url or "", headers=cfg.headers or None,
            ), timeout=to)
        if cfg.transport == "sse":
            return Client(SSETransport(
                cfg.url or "", headers=cfg.headers or None,
            ), timeout=to)
        raise ValueError(f"未知 transport: {cfg.transport}")

    async def _connect(self, server: MCPServer) -> tuple[Client, list[dict]]:
        client = self._build_client(server.config)
        to = max(5.0, float(server.config.timeout or DEFAULT_TIMEOUT))
        async with asyncio.timeout(to):
            async with client:
                tools = await client.list_tools()
                tool_dicts = []
                for t in tools:
                    schema = getattr(t, "inputSchema", None) or {}
                    tool_dicts.append({
                        "name": t.name,
                        "description": (t.description or "")[:160],
                        "schema": schema,
                    })
        return client, tool_dicts

    # ---- 公开 API（同步接口给路由用） ----

    def test_connect(self, cfg: MCPServerConfig) -> tuple[bool, str, list[dict]]:
        """测试一份配置能否连上，返回 (ok, 消息, 工具列表)。"""
        probe = MCPServer(id="probe", config=cfg, created_at=now_ms())
        try:
            client, tools = self.run(self._connect(probe), timeout=cfg.timeout + 10)
            try:
                self.run(self._close(client))
            except Exception:
                pass
            names = ", ".join(t["name"] for t in tools[:6]) or "无工具"
            return True, f"连接成功，{len(tools)} 个工具: {names}", tools
        except Exception as e:
            return False, f"{type(e).__name__}: {e}", []

    def start(self, server: MCPServer) -> tuple[bool, str]:
        """连接并列出工具；成功则缓存连接。"""
        try:
            client, tools = self.run(self._connect(server), timeout=server.config.timeout + 10)
            self._clients[server.id] = client
            server.tools = tools
            server.status = "running"
            server.status_detail = f"{len(tools)} 个工具"
            server.last_started_at = now_ms()
            return True, server.status_detail
        except Exception as e:
            server.status = "error"
            server.status_detail = f"{type(e).__name__}: {str(e)[:200]}"
            return False, server.status_detail

    def stop(self, server: MCPServer) -> None:
        client = self._clients.pop(server.id, None)
        if client:
            try:
                self.run(self._close(client))
            except Exception:
                pass
        server.status = "stopped"
        server.status_detail = ""
        server.tools = []

    async def _close(self, client: Client) -> None:
        # Client 用法是 async with；这里缓存复用，需要显式断开
        try:
            await client._disconnect()  # fastmcp 内部 API
        except Exception:
            pass

    def call_tool(self, server: MCPServer, tool_name: str, arguments: dict[str, Any]) -> Any:
        client = self._clients.get(server.id)
        if client is None:
            raise RuntimeError(f"服务器 {server.config.name} 未运行，请先启动")
        to = max(5.0, float(server.config.timeout or DEFAULT_TIMEOUT))

        async def _call():
            async with asyncio.timeout(to):
                async with client:
                    result = await client.call_tool(tool_name, arguments)
            return result

        result = self.run(_call(), timeout=to + 10)
        # CallToolResult -> 文本（含 structured content / 图片占位）
        parts = []
        try:
            for item in result.content:
                text = getattr(item, "text", None)
                if text is not None:
                    parts.append(text)
                else:
                    parts.append(str(item))
        except Exception:
            parts.append(str(result))
        return "\n".join(parts) if parts else "(空结果)"

    def shutdown(self) -> None:
        for sid, client in list(self._clients.items()):
            try:
                self.run(self._close(client))
            except Exception:
                pass
        self._clients.clear()
        self._loop.call_soon_threadsafe(self._loop.stop)
