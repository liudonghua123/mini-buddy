"""会话与聊天引擎：AgentScope 驱动 + 会话级能力解析 + 命令系统 + mock 回复。

LLM 路径：AgentScope ReActAgent + Toolkit（MCP 工具经 FunctionTool 适配）+
会话级 system prompt（助手身份 + 会话补充）。流式回复经 SSE 推给前端。
"""
from __future__ import annotations

import json
import re
import time
from typing import Any, AsyncGenerator

from .models import (
    CapabilityState,
    ChatSession,
    MCPServer,
    Message,
    SessionCaps,
    SessionOverrides,
    SkillManifest,
    new_id,
    now_ms,
)

HELP_TEXT = (
    "**可用命令**\n"
    "- `/tools` — 查看当前会话生效的 MCP 工具\n"
    "- `/skills` — 查看当前会话生效的技能\n"
    "- `/tool 名称 参数JSON` — 调用一个 MCP 工具，如 `/tool roll {\"sides\":20}`\n"
    "- `/skill 名称` — 手动触发一次技能（返回技能指令效果）\n"
    "- `/help` — 显示本帮助\n\n"
    "提示：输入框下方的工具条可以为单条消息选择 MCP 与技能；会话设置里可切换助手身份。"
)

COMMAND_RE = re.compile(r"^/(tool|tools|skills|skill|help)\b\s*(.*)$", re.S)
DEFAULT_OVERRIDE: CapabilityState = "inherit"


def _resolve(state: CapabilityState, global_on: bool) -> bool:
    if state == "on":
        return True
    if state == "off":
        return False
    return global_on


class SessionManager:
    def __init__(self, store) -> None:
        self.store = store

    def list(self) -> list[ChatSession]:
        return sorted(self.store.list_sessions(), key=lambda s: -s.updated_at)

    def get(self, sid: str) -> ChatSession | None:
        for s in self.store.list_sessions():
            if s.id == sid:
                return s
        return None

    def create(self, title: str = "新会话") -> ChatSession:
        s = ChatSession(id=new_id("ses"), title=title, created_at=now_ms(), updated_at=now_ms(),
                        overrides=SessionOverrides())
        sessions = self.store.list_sessions()
        sessions.append(s)
        self.store.save_sessions(sessions)
        return s

    def touch(self, sid: str) -> None:
        sessions = self.store.list_sessions()
        for s in sessions:
            if s.id == sid:
                s.updated_at = now_ms()
        self.store.save_sessions(sessions)

    def rename(self, sid: str, title: str) -> ChatSession | None:
        sessions = self.store.list_sessions()
        for s in sessions:
            if s.id == sid:
                s.title = title.strip() or s.title
                s.updated_at = now_ms()
                self.store.save_sessions(sessions)
                return s
        return None

    def delete(self, sid: str) -> bool:
        sessions = self.store.list_sessions()
        rest = [s for s in sessions if s.id != sid]
        if len(rest) == len(sessions):
            return False
        self.store.save_sessions(rest)
        try:
            import os
            os.remove(self.store._msg_path(sid))
        except OSError:
            pass
        return True

    def clear_all(self) -> int:
        """清空全部会话数据（会话 + 消息文件）。返回删除的会话数。"""
        n = self.store.clear_sessions()
        return n

    def set_overrides(self, sid: str, overrides: SessionOverrides) -> ChatSession | None:
        sessions = self.store.list_sessions()
        for s in sessions:
            if s.id == sid:
                s.overrides = overrides
                s.updated_at = now_ms()
                self.store.save_sessions(sessions)
                return s
        return None

    def set_override_key(self, sid: str, kind: str, key: str,
                         state: CapabilityState) -> ChatSession | None:
        """设置单个能力的会话级状态（不覆盖其他键）。"""
        sessions = self.store.list_sessions()
        for s in sessions:
            if s.id == sid:
                d = s.overrides.model_dump()
                d.setdefault(kind, {})[key] = state
                s.overrides = SessionOverrides(**d)
                s.updated_at = now_ms()
                self.store.save_sessions(sessions)
                return s
        return None

    def update_session(self, sid: str, **fields) -> ChatSession | None:
        """更新会话字段（assistant_id / system_prompt / temperature / title）。"""
        sessions = self.store.list_sessions()
        for s in sessions:
            if s.id == sid:
                for k, v in fields.items():
                    if hasattr(s, k):
                        setattr(s, k, v)
                s.updated_at = now_ms()
                self.store.save_sessions(sessions)
                return s
        return None

    def messages(self, sid: str) -> list[Message]:
        return self.store.load_messages(sid)

    def append_message(self, m: Message) -> None:
        msgs = self.store.load_messages(m.session_id)
        msgs.append(m)
        self.store.save_messages(m.session_id, msgs)
        self.touch(m.session_id)


class ChatEngine:
    """命令路由 + AgentScope ReAct / 模拟回复。"""

    def __init__(self, session_mgr: SessionManager, mcp_manager, skill_manager, store,
                 knowledge=None) -> None:
        self.sessions = session_mgr
        self.mcps = mcp_manager
        self.skills = skill_manager
        self.store = store
        self.knowledge = knowledge  # KnowledgeManager（记忆 + 文档 RAG）
        # AgentScope 惰性导入（重）
        self._as = None
        # 每个会话的 AgentState（上下文持久），key: session_id
        self._states: dict[str, Any] = {}

    # ---- AgentScope 惰性导入 ----
    def _agentscope(self):
        if self._as is None:
            from agentscope import agent as as_agent, message as as_msg, tool as as_tool
            from agentscope.permission import (
                PermissionDecision,
                PermissionBehavior,
            )
            self._as = {
                "Agent": as_agent.Agent,
                "Toolkit": as_tool.Toolkit,
                "FunctionTool": as_tool.FunctionTool,
                "ToolResponse": as_tool.ToolResponse,
                "TextBlock": as_msg.TextBlock,
                # 内置/MCP 工具免用户确认：工具结果会以过程日志展示
                "ALLOW": PermissionDecision(
                    behavior=PermissionBehavior.ALLOW,
                    message="Allowed by Mini Buddy session tools.",
                ),
            }
        return self._as

    # ---- 能力解析 ----
    def _assistant(self, session: ChatSession):
        if not session.assistant_id:
            return None
        return next((x for x in self.store.list_assistants()
                     if x.id == session.assistant_id), None)

    def effective_caps(self, session: ChatSession) -> SessionCaps:
        all_mcps: list[MCPServer] = self.store.list_mcps()
        all_skills: list[SkillManifest] = self.skills.list_skills()
        ov = session.overrides
        a = self._assistant(session)
        # 助手绑定的能力范围：None = 不限制；[ids] = 只用这些
        a_mcp_ids = a.mcps if (a and a.mcps is not None) else None
        a_skill_ids = a.skills if (a and a.skills is not None) else None

        caps = SessionCaps()
        for srv in all_mcps:
            state: CapabilityState = ov.mcps.get(srv.id, DEFAULT_OVERRIDE)
            in_scope = a_mcp_ids is None or srv.id in a_mcp_ids
            usable = in_scope and _resolve(state, srv.config.enabled and srv.status == "running")
            caps.mcps.append({
                "id": srv.id, "name": srv.config.name, "transport": srv.config.transport,
                "state": state, "global_enabled": srv.config.enabled,
                "running": srv.status == "running", "usable": usable,
                "tools": [t["name"] for t in srv.tools] if usable else [],
            })
        for sk in all_skills:
            state = ov.skills.get(sk.slug, DEFAULT_OVERRIDE)
            in_scope = a_skill_ids is None or sk.slug in a_skill_ids
            usable = in_scope and _resolve(state, sk.enabled)
            caps.skills.append({
                "slug": sk.slug, "name": sk.name, "description": sk.description,
                "state": state, "global_enabled": sk.enabled,
                "usable": usable,
            })
        return caps

    def _usable_mcp_servers(self, session: ChatSession,
                            picked: list[str] | None = None) -> list[dict]:
        """picked=None → 全部会话生效能力；picked=[] → 显式全不选；[ids] → 只用这些。"""
        caps = [m for m in self.effective_caps(session).mcps if m["usable"]]
        if picked is not None:
            caps = [m for m in caps if m["id"] in picked]
        return caps

    def _usable_skills(self, session: ChatSession,
                       picked: list[str] | None = None) -> list[dict]:
        """picked=None → 全部会话生效能力；picked=[] → 显式全不选；[slugs] → 只用这些。"""
        caps = [s for s in self.effective_caps(session).skills if s["usable"]]
        if picked is not None:
            caps = [s for s in caps if s["slug"] in picked]
        return caps

    # ---- 消息 ----
    def _mk_msg(self, session_id: str, role: str, content: str,
                tool_events: list[dict] | None = None,
                thinking: str = "", meta: dict | None = None,
                ask: dict | None = None,
                edited: bool = False) -> Message:
        return Message(id=new_id("msg"), session_id=session_id, role=role,  # type: ignore[arg-type]
                       content=content, ts=now_ms(), tool_events=tool_events or [],
                       thinking=thinking, meta=meta or {}, ask=ask, edited=edited)

    def edit_message(self, sid: str, msg_id: str, content: str) -> Message | None:
        """编辑已持久化的消息内容（标记 edited）。"""
        msgs = self.store.load_messages(sid)
        for i, m in enumerate(msgs):
            if m.id == msg_id:
                msgs[i] = m.model_copy(update={"content": content, "edited": True})
                self.store.save_messages(sid, msgs)
                self.sessions.touch(sid)
                return msgs[i]
        return None

    # ---- 命令处理 ----
    def _handle_command(self, session: ChatSession, cmd: str, rest: str,
                        picked_mcps: list[str] | None = None,
                        picked_skills: list[str] | None = None) -> Message:
        if cmd == "help":
            return self._mk_msg(session.id, "assistant", HELP_TEXT)
        if cmd == "tools":
            usable = self._usable_mcp_servers(session, picked_mcps)
            if not usable:
                return self._mk_msg(session.id, "assistant", "当前会话没有生效的 MCP 服务器。在会话设置的能力开关里打开，或在「MCP」页安装并启动。")
            lines = ["**当前会话生效的 MCP 工具**\n"]
            for m in usable:
                st = "运行中" if m["running"] else "未运行"
                lines.append(f"- **{m['name']}**（{m['transport']} · {st}）: {', '.join(m['tools']) or '无工具'}")
            return self._mk_msg(session.id, "assistant", "\n".join(lines))
        if cmd == "skills":
            usable = self._usable_skills(session, picked_skills)
            if not usable:
                return self._mk_msg(session.id, "assistant", "当前会话没有生效的技能。在会话设置的能力开关里打开，或在「技能」页安装。")
            lines = ["**当前会话生效的技能**\n"]
            for s in usable:
                lines.append(f"- **{s['name']}** — {s['description']}")
            return self._mk_msg(session.id, "assistant", "\n".join(lines))
        if cmd == "tool":
            parts = rest.strip().split(" ", 1)
            if not parts or not parts[0]:
                return self._mk_msg(session.id, "assistant", "用法：`/tool 工具名 {\"参数\": \"值\"}`。先用 `/tools` 查看可用工具。")
            tool_name = parts[0]
            args: dict[str, Any] = {}
            if len(parts) > 1 and parts[1].strip():
                try:
                    args = json.loads(parts[1])
                except json.JSONDecodeError as e:
                    return self._mk_msg(session.id, "assistant", f"参数 JSON 解析失败：{e}")
            events: list[dict] = []
            for m in self._usable_mcp_servers(session, picked_mcps):
                if tool_name in m["tools"] and m["running"]:
                    srv = next((s for s in self.store.list_mcps() if s.id == m["id"]), None)
                    if srv:
                        try:
                            t0 = time.time()
                            result = self.mcps.call_tool(srv, tool_name, args)
                            elapsed = int((time.time() - t0) * 1000)
                            events.append({"type": "tool_call", "name": tool_name,
                                           "server": m["name"], "ok": True,
                                           "detail": f"{elapsed / 1000:.2f}s",
                                           "elapsed_ms": elapsed,
                                           "input": args,
                                           "output": str(result)[:2000]})
                            out = f"**工具 {tool_name}（{m['name']}）**\n\n```\n{result}\n```"
                            return self._mk_msg(session.id, "assistant", out, events)
                        except Exception as e:
                            events.append({"type": "tool_call", "name": tool_name,
                                           "server": m["name"], "ok": False,
                                           "detail": str(e)[:120],
                                           "elapsed_ms": int((time.time() - t0) * 1000),
                                           "input": args,
                                           "output": f"错误：{e}"})
                            return self._mk_msg(session.id, "assistant", f"工具调用失败：{e}", events)
            return self._mk_msg(session.id, "assistant",
                                f"找不到可用的工具 `{tool_name}`。它所属的 MCP 服务器可能被本会话关闭或未运行。用 `/tools` 看看。")
        if cmd == "skill":
            slug = rest.strip()
            usable = self._usable_skills(session, picked_skills)
            sk = next((s for s in usable if s["slug"] == slug or s["name"] == slug), None)
            if not sk:
                return self._mk_msg(session.id, "assistant",
                                    f"当前会话没有生效的技能 `{slug}`。用 `/skills` 查看，或在会话设置里开启。")
            full = next((x for x in self.skills.list_skills() if x.slug == sk["slug"]), None)
            body = full.instructions if full else ""
            return self._mk_msg(
                session.id, "assistant",
                f"**技能「{sk['name']}」已加载**\n\n{sk['description']}\n\n接下来按它的指令工作。例如发送：\n\n```\n请按「{sk['name']}」技能处理：<你的内容>\n```\n\n<details><summary>技能指令（SKILL.md）</summary>\n\n```\n{body}\n```\n\n</details>")
        return self._mk_msg(session.id, "assistant", "未知命令，试试 /help")

    # ---- 主入口（非流式，命令与 mock 用；流式见 stream_chat） ----
    def chat(self, session: ChatSession, text: str,
             picked_mcps: list[str] | None = None,
             picked_skills: list[str] | None = None) -> list[Message]:
        text = text.strip()
        attachments = {"mcps": picked_mcps if picked_mcps is not None else [],
                       "skills": picked_skills if picked_skills is not None else []}
        out: list[Message] = []
        m = COMMAND_RE.match(text)
        if m:
            cmd, rest = m.group(1), m.group(2)
            reply = self._handle_command(session, cmd, rest,
                                         picked_mcps=picked_mcps, picked_skills=picked_skills)
            u = self._mk_msg(session.id, "user", text)
            u.attachments = attachments
            out.append(u)
            out.append(reply)
            for msg in out:
                self.sessions.append_message(msg)
            return out

        u = self._mk_msg(session.id, "user", text)
        u.attachments = attachments
        out.append(u)
        settings = self.store.load_settings()
        if settings.model == "mock" or not settings.api_key:
            reply = self._mock_reply(session, text, picked_mcps, picked_skills)
            out.append(reply)
            for msg in out:
                self.sessions.append_message(msg)
            return out
        # 真实 LLM：内部复用流式路径，聚合为消息列表返回
        import asyncio

        async def _run():
            saved_user, final = None, None
            async for ev in self.stream_chat(session, text, picked_mcps, picked_skills):
                if ev["event"] == "user_saved":
                    saved_user = ev["data"]
                elif ev["event"] in ("done", "error"):
                    final = ev["data"]
            return saved_user, final

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                    saved_user, final = ex.run_until_complete(_run())  # type: ignore[union-attr]
            else:
                saved_user, final = loop.run_until_complete(_run())
        except RuntimeError:
            saved_user, final = asyncio.run(_run())
        result: list[Message] = []
        if saved_user:
            result.append(Message(**saved_user))
        if final:
            result.append(Message(**final))
        return result

    # ---- 系统提示词组装：全局 + 助手身份 + 会话补充 + 记忆/文档 + 技能指令 ----
    def build_system_prompt(self, session: ChatSession,
                            picked_skills: list[str] | None = None,
                            rag_context: str = "",
                            memory_context: str = "") -> str:
        settings = self.store.load_settings()
        parts = [settings.system_prompt]
        # HITL：告知模型可以向用户提问并暂停等待
        parts.append(
            "## 向用户提问\n"
            "当缺少完成任务所需的关键信息时（需求不清、需要在选项间选择、"
            "执行前需确认），调用 ask_user 工具提问并暂停；"
            "用户回答后会作为新的消息自动继续。不要滥用：能合理假设的先做。")
        if session.assistant_id:
            assistants = self.store.list_assistants()
            a = next((x for x in assistants if x.id == session.assistant_id), None)
            if a and a.prompt:
                parts.append(a.prompt)
        if session.system_prompt:
            parts.append(session.system_prompt)
        # 记忆：用户长期保存的信息
        if memory_context:
            parts.append(memory_context)
        # 文档 RAG：按本条消息检索到的知识片段
        if rag_context:
            parts.append(rag_context)
        # 技能指令：仅注入本条消息显式选中的技能，避免把所有技能塞进上下文
        usable = self._usable_skills(session, picked_skills)
        for sk in usable:
            full = next((x for x in self.skills.list_skills() if x.slug == sk["slug"]), None)
            if full and full.instructions:
                parts.append(f"## 技能「{sk['name']}」\n\n{full.instructions}")
        return "\n\n".join(p for p in parts if p.strip())

    # ---- HITL：ask_user 工具 + MCP 工具 -> AgentScope FunctionTool ----
    def _make_ask_user_tool(self, session: ChatSession, ask_out: list):
        """内置 ask_user：模型缺信息时向用户提问，本轮结束等待回答。

        提问写入 ask_out[0]（{id,question,options,multi}），工具立即返回，
        由 stream_chat 负责挂起会话并落库提问卡。
        """
        as_ = self._agentscope()
        FunctionTool = as_["FunctionTool"]

        def ask_user(question: str, options: str = "", multi: str = "false") -> str:
            """当缺少完成任务所需的信息时，向用户提问并暂停等待回答。

            Args:
                question: 要问用户的问题，一句话说清需要什么信息。
                options: 可供选择的选项，用竖线 | 分隔；不需要选项则留空。
                multi: 是否允许多选，"true"/"false"，默认单选。
            """
            opts = [o.strip() for o in options.split("|") if o.strip()] \
                if options.strip() else []
            ask_out.append({
                "id": f"ask_{now_ms()}",
                "question": question.strip(),
                "options": opts,
                "multi": multi.strip().lower() == "true",
            })
            return ("提问已发送给用户，本轮回答到此结束。"
                    "请不要再继续调用其他工具或输出后续步骤；"
                    "用户回答后会自动继续。")

        return FunctionTool(
            ask_user,
            name="ask_user",
            description=("Ask the user a question and pause for their reply. "
                          "Use it when required information is missing "
                          "(clarify requirements, choose between options, "
                          "confirm before acting). The reply arrives as the "
                          "user's next message."),
            permission=self._agentscope()["ALLOW"],
            input_schema={
                "type": "object",
                "properties": {
                    "question": {"type": "string",
                                   "description": "要问用户的问题"},
                    "options": {"type": "string",
                                  "description": "选项，用 | 分隔；可留空表示自由文本"},
                    "multi": {"type": "string",
                                "description": "是否多选 true/false，默认 false"},
                },
                "required": ["question"],
            },
        )

    def _build_toolkit(self, session: ChatSession, picked_mcps: list[str] | None,
                       picked_skills: list[str] | None, events_out: list[dict],
                       ask_out: list | None = None):
        """把会话生效（picked=None 时为全部；picked=[] 为无）的 MCP 工具装进 Toolkit。"""
        as_ = self._agentscope()
        Toolkit, FunctionTool = as_["Toolkit"], as_["FunctionTool"]
        toolkit = Toolkit()
        # HITL：ask_user 始终可用（第一个注册）
        if ask_out is not None:
            toolkit._pending = getattr(toolkit, "_pending", [])
            toolkit._pending.append(self._make_ask_user_tool(session, ask_out))

        for m in self._usable_mcp_servers(session, picked_mcps):
            srv = next((s for s in self.store.list_mcps() if s.id == m["id"]), None)
            if not srv or srv.status != "running":
                continue
            server_name = srv.config.name
            for t in srv.tools:
                tool_name, desc, schema = t["name"], t.get("description", ""), t.get("schema") or {}
                if not schema:
                    schema = {"type": "object", "properties": {}}

                def _make_call(srv=srv, tool_name=tool_name, server_name=server_name):
                    def call(**kwargs):
                        t0 = time.time()
                        try:
                            result = self.mcps.call_tool(srv, tool_name, kwargs)
                            elapsed = int((time.time() - t0) * 1000)
                            events_out.append({
                                "type": "tool_call", "name": tool_name,
                                "server": server_name, "ok": True,
                                "detail": f"{elapsed / 1000:.2f}s",
                                "elapsed_ms": elapsed,
                                "input": kwargs,
                                "output": str(result)[:2000],
                            })
                        except Exception as e:
                            elapsed = int((time.time() - t0) * 1000)
                            events_out.append({
                                "type": "tool_call", "name": tool_name,
                                "server": server_name, "ok": False,
                                "detail": str(e)[:120],
                                "elapsed_ms": elapsed,
                                "input": kwargs,
                                "output": f"错误：{e}",
                            })
                            result = f"工具调用失败：{e}"
                        ToolResponse = as_["ToolResponse"]
                        TextBlock = as_["TextBlock"]
                        return ToolResponse(content=[TextBlock(text=str(result))])
                    return call

                ft = FunctionTool(
                    _make_call(),
                    name=tool_name,
                    description=f"[{server_name}] {desc}".strip(),
                    input_schema=schema,
                    permission=self._agentscope()["ALLOW"],
                )
                # add_tool 是 async —— 留给 stream_chat 里统一 await
                toolkit._pending = getattr(toolkit, "_pending", [])
                toolkit._pending.append(ft)
        return toolkit

    # ---- 流式回复：AgentScope ReAct ----
    async def stream_chat(self, session: ChatSession, text: str,
                          picked_mcps: list[str] | None = None,
                          picked_skills: list[str] | None = None,
                          files: list[dict] | None = None) -> AsyncGenerator[dict, None]:
        """产出 SSE 事件 dict：{event: delta|tool|done|error, data: ...}。

        职责：构建 Toolkit、组装 system prompt、驱动 AgentScope Agent.reply_stream、
        持久化消息。
        """
        text = text.strip()
        files = files or []
        settings = self.store.load_settings()
        t0 = time.time()

        # HITL：用户发新消息即视为对挂起提问的回应（或放弃），清除挂起标记
        if session.pending_question:
            session.pending_question = None
            self.sessions.update_session(session.id,
                                         pending_question=None)

        u = self._mk_msg(session.id, "user", text)
        u.attachments = {"mcps": picked_mcps if picked_mcps is not None else [],
                         "skills": picked_skills if picked_skills is not None else []}
        if files:
            u.files = files
        self.sessions.append_message(u)
        yield {"event": "user_saved", "data": u.model_dump()}

        if settings.model == "mock" or not settings.api_key:
            reply = self._mock_reply(session, text, picked_mcps, picked_skills)
            reply.meta = {"elapsed_ms": int((time.time() - t0) * 1000),
                          "model": "mock", "calls": 1}
            self.sessions.append_message(reply)
            yield {"event": "delta", "data": reply.content}
            yield {"event": "done", "data": reply.model_dump()}
            return

        # ---- 真实 LLM：AgentScope ----
        events: list[dict] = []
        rag_trace: list[dict] = []   # 检索/工具过程日志（用时/输入/输出）
        ask_out: list[dict] = []     # HITL：本轮 ask_user 提问（至多一条）
        try:
            as_ = self._agentscope()
            from agentscope.model import OpenAIChatModel
            from agentscope.credential import OpenAICredential
            from agentscope.state import AgentState
            from agentscope.message import UserMsg

            toolkit = self._build_toolkit(session, picked_mcps, picked_skills,
                                           events, ask_out=ask_out)
            for ft in getattr(toolkit, "_pending", []):
                await toolkit.add_tool(ft, group_name="basic")
            toolkit._pending = []

            # 会话状态：持久上下文
            state = self._states.get(session.id)
            if state is None:
                state = AgentState()
                # 历史：把已持久化的最近消息注入上下文
                for hm in self.sessions.messages(session.id)[-21:-1]:  # 刚 append 的 user 不算
                    if hm.role in ("user", "assistant") and not hm.content.startswith("/"):
                        if hm.role == "user":
                            state.context.append(UserMsg("user", hm.content))
                        else:
                            from agentscope.message import AssistantMsg
                            state.context.append(AssistantMsg("assistant", hm.content))
                self._states[session.id] = state

            model = OpenAIChatModel(
                credential=OpenAICredential(api_key=settings.api_key, base_url=settings.api_base),
                model=settings.model,
                stream=True,
                parameters=OpenAIChatModel.Parameters(temperature=session.temperature),
            )

            # 记忆 + 文档 RAG 上下文（RAG 按助手绑定的知识库过滤，库级）
            memory_ctx = self.knowledge.memory_context() if self.knowledge else ""
            a = self._assistant(session)
            rag_kb_ids = a.kbs if (a and a.kbs is not None) else None
            rag_ctx = (self.knowledge.rag_context(text, kb_ids=rag_kb_ids,
                                                  trace=rag_trace)
                       if self.knowledge else "")
            for st in rag_trace:   # 检索日志实时推送
                yield {"event": "step_start", "data": st}

            agent = as_["Agent"](
                name="assistant",
                system_prompt=self.build_system_prompt(
                    session, picked_skills,
                    rag_context=rag_ctx, memory_context=memory_ctx),
                model=model,
                toolkit=toolkit,
                state=state,
            )

            content_parts: list[str] = []
            thinking_parts: list[str] = []
            input_tokens = 0
            output_tokens = 0
            model_calls = 0
            tool_marks: dict[str, dict] = {}   # tool_call_id -> 已推送的步骤
            async for ev in agent.reply_stream(UserMsg("user", text)):
                etype = getattr(ev, "type", None)
                type_name = str(etype.value) if hasattr(etype, "value") else str(etype)
                if type_name == "TEXT_BLOCK_DELTA":
                    content_parts.append(ev.delta)
                    yield {"event": "delta", "data": ev.delta}
                elif type_name == "THINKING_BLOCK_DELTA":
                    thinking_parts.append(ev.delta)
                    yield {"event": "thinking", "data": ev.delta}
                elif type_name == "MODEL_CALL_END":
                    model_calls += 1
                    input_tokens += int(getattr(ev, "input_tokens", 0) or 0)
                    output_tokens += int(getattr(ev, "output_tokens", 0) or 0)
                elif type_name == "TOOL_CALL_START":
                    mark = {"kind": "tool", "name": ev.tool_call_name,
                            "server": "MCP", "ok": True, "elapsed_ms": 0,
                            "input": {}, "output": "", "running": True}
                    tool_marks[ev.tool_call_id] = mark
                    rag_trace.append(mark)
                    yield {"event": "step_start", "data": mark}
                elif type_name == "TOOL_RESULT_END":
                    mark = tool_marks.pop(ev.tool_call_id, None)
                    ok = str(getattr(ev, "state", "")) != "ToolResultState.ERROR"
                    if mark:
                        mark["ok"] = ok
                        mark["elapsed_ms"] = int((time.time() - t0) * 1000)
                        mark["running"] = False
                    yield {"event": "step_end", "data": {
                        "id": ev.tool_call_id, "ok": ok}}
                elif type_name == "REPLY_END":
                    break

            # 工具执行详情（含输入/输出/用时）合并进过程日志
            for ev_item in events:
                if ev_item.get("type") == "tool_call":
                    rag_trace.append(ev_item)
            content = "".join(content_parts).strip() or "(模型没有返回内容)"
            thinking = "".join(thinking_parts).strip()
            meta = {
                "elapsed_ms": int((time.time() - t0) * 1000),
                "model": settings.model,
                "calls": model_calls,
            }
            if input_tokens or output_tokens:
                meta["input_tokens"] = input_tokens
                meta["output_tokens"] = output_tokens
            ask = ask_out[0] if ask_out else None
            reply = self._mk_msg(session.id, "assistant", content,
                                 rag_trace,
                                 thinking=thinking, meta=meta, ask=ask)
            self.sessions.append_message(reply)
            if ask:
                # HITL：挂起会话等待用户回答；agent 状态已持久，
                # 用户的回答作为下一条消息到达时自然续上上下文
                self.sessions.update_session(session.id,
                                             pending_question=ask)
                yield {"event": "ask", "data": ask}
            yield {"event": "done", "data": reply.model_dump()}
        except Exception as e:
            # 失败也要把已记录的过程日志带出来
            err = self._mk_msg(session.id, "assistant",
                               f"模型调用失败：{type(e).__name__}: {str(e)[:300]}",
                               rag_trace,
                               meta={"elapsed_ms": int((time.time() - t0) * 1000),
                                     "model": settings.model, "error": True})
            self.sessions.append_message(err)
            yield {"event": "error", "data": err.model_dump()}

    # ---- 模拟回复：让内置能力"活"起来 ----
    def _mock_reply(self, session: ChatSession, text: str,
                    picked_mcps: list[str] | None = None,
                    picked_skills: list[str] | None = None) -> Message:
        usable_mcps = self._usable_mcp_servers(session, picked_mcps)
        usable_skills = self._usable_skills(session, picked_skills)
        tool_names = {t: m["name"] for m in usable_mcps for t in m["tools"]}

        # 用户显式选择了技能（picked_skills 非空列表）时，按第一个技能指令处理
        if picked_skills and usable_skills:
            sk = usable_skills[0]
            events = [{"type": "skill_apply", "name": sk["name"], "server": "技能", "ok": True,
                       "detail": "按技能指令处理"}]
            # 图表技能：mock 也输出真实格式的示例图，方便无 API key 时验证渲染
            if sk["slug"] == "charts-mermaid":
                body = ("已按技能「Mermaid 图表」处理。下面用 mermaid 画一张流程图：\n\n"
                        "```mermaid\n"
                        "graph TD\n"
                        f"    A[{text[:16] or '用户输入'}] --> B{{需要拆解?}}\n"
                        "    B -- 是 --> C[分步执行]\n"
                        "    B -- 否 --> D[直接回答]\n"
                        "    C --> E[汇总输出]\n"
                        "    D --> E\n"
                        "```\n\n接入真实模型后，图会按你的内容动态生成。")
                return self._mk_msg(session.id, "assistant", body, events)
            if sk["slug"] == "charts-echarts":
                body = ("已按技能「ECharts 图表」处理。下面用 echarts 画一张柱状图：\n\n"
                        "```echarts\n"
                        "{\n"
                        "  \"title\": { \"text\": \"示例数据\" },\n"
                        "  \"tooltip\": {},\n"
                        "  \"xAxis\": { \"type\": \"category\", \"data\": [\"一月\", \"二月\", \"三月\", \"四月\"] },\n"
                        "  \"yAxis\": { \"type\": \"value\" },\n"
                        "  \"series\": [{ \"type\": \"bar\", \"data\": [120, 200, 150, 260] }]\n"
                        "}\n"
                        "```\n\n接入真实模型后，图会按你的数据动态生成。")
                return self._mk_msg(session.id, "assistant", body, events)
            body = (f"已按技能「{sk['name']}」处理你的输入。\n\n"
                    f"**技能指令摘要**：{sk['description']}\n\n"
                    f"对「{text[:60]}{'…' if len(text) > 60 else ''}」的处理结果如下（mock 演示）：\n\n"
                    f"```\n按「{sk['name']}」的结构组织这段内容…\n```\n\n"
                    "接入真实模型后，这里会是模型按技能指令生成的实际结果。")
            return self._mk_msg(session.id, "assistant", body, events)

        # 图表演示：mermaid / echarts
        if re.search(r"mermaid|流程图|时序图|sequence", text, re.I):
            demo = ("好的，用 mermaid 画一个流程图：\n\n"
                    "```mermaid\n"
                    "graph LR\n"
                    "    A[用户消息] --> B{命令?}\n"
                    "    B -- 是 --> C[命令路由]\n"
                    "    B -- 否 --> D[能力解析]\n"
                    "    C --> E[工具调用]\n"
                    "    D --> F[LLM 回复]\n"
                    "    E --> F\n"
                    "```\n\n前端会用 mermaid 客户端渲染上图。")
            return self._mk_msg(session.id, "assistant", demo)
        if re.search(r"echarts|图表|柱状图|饼图|折线图", text, re.I):
            demo = ("好的，用 echarts 画一个柱状图：\n\n"
                    "```echarts\n"
                    '{"title": {"text": "本周会话消息数"},'
                    ' "xAxis": {"type": "category", "data": ["周一", "周二", "周三", "周四", "周五"]},'
                    ' "yAxis": {"type": "value"},'
                    ' "series": [{"type": "bar", "data": [12, 18, 9, 25, 31]}]}\n'
                    "```\n\n前端会用 echarts 客户端渲染上图。")
            return self._mk_msg(session.id, "assistant", demo)

        # 自动调用：计算
        if "calculate" in tool_names:
            exprs = re.findall(r"-?\d+(?:\.\d+)?(?:\s*[\+\-\*\/\^%]\s*-?\(?\d+(?:\.\d+)?\)?)+", text)
            if exprs:
                expr = exprs[0].replace("^", "**").replace(" ", "")
                srv = next((s for s in self.store.list_mcps()
                            if s.config.name == tool_names["calculate"] and s.status == "running"), None)
                if srv:
                    try:
                        t0 = time.time()
                        result = self.mcps.call_tool(srv, "calculate", {"expression": expr})
                        events = [{"type": "tool_call", "name": "calculate", "server": tool_names["calculate"],
                                   "ok": True, "detail": f"{time.time()-t0:.2f}s"}]
                        return self._mk_msg(
                            session.id, "assistant",
                            f"用计算器算了一下 `{expr}`：\n\n```\n{expr} = {result}\n```\n\n还需要算别的吗？", events)
                    except Exception:
                        pass

        # 自动调用：时间
        if "now" in tool_names and re.search(r"现在几点|几点了|今天.*几号|现在时间|当前时间", text):
            srv = next((s for s in self.store.list_mcps()
                        if s.config.name == tool_names["now"] and s.status == "running"), None)
            if srv:
                try:
                    result = self.mcps.call_tool(srv, "now", {"tz_offset_hours": 8})
                    events = [{"type": "tool_call", "name": "now", "server": tool_names["now"], "ok": True, "detail": ""}]
                    return self._mk_msg(session.id, "assistant", f"现在是 **{result}**。", events)
                except Exception:
                    pass

        # 自动调用：骰子
        if "roll" in tool_names and re.search(r"掷骰子|掷个骰子|roll|骰子", text, re.I):
            sides = 6
            ms = re.search(r"(\d+)\s*(?:面|d)(?:的)?骰", text) or re.search(r"d(\d+)", text, re.I)
            if ms:
                sides = min(1000, max(2, int(ms.group(1))))
            srv = next((s for s in self.store.list_mcps()
                        if s.config.name == tool_names["roll"] and s.status == "running"), None)
            if srv:
                try:
                    result = self.mcps.call_tool(srv, "roll", {"sides": sides, "times": 1})
                    events = [{"type": "tool_call", "name": "roll", "server": tool_names["roll"], "ok": True, "detail": f"d{sides}"}]
                    return self._mk_msg(session.id, "assistant", f"掷一个 {sides} 面骰：**{result}**", events)
                except Exception:
                    pass

        # 助手身份提示
        persona_hint = ""
        if session.assistant_id:
            assistants = self.store.list_assistants()
            a = next((x for x in assistants if x.id == session.assistant_id), None)
            if a:
                persona_hint = f"\n\n当前身份：{a.emoji} **{a.name}** —— {a.description}"

        # 技能提示
        skill_hint = ""
        if usable_skills:
            names = "、".join(s["name"] for s in usable_skills[:4])
            skill_hint = f"\n\n本会话可用的技能：{names}（`/skills` 查看详情）。"

        mcp_hint = ""
        if usable_mcps:
            mcp_hint = f"\n\n已接入 {len(usable_mcps)} 个 MCP 服务器（`/tools` 可查看工具）。"
        else:
            mcp_hint = "\n\n本会话未启用 MCP 服务器 —— 需要工具调用的话，在输入框下方工具条或会话设置里打开。"

        body = (
            f"收到：「{text[:60]}{'…' if len(text) > 60 else ''}」{persona_hint}\n\n"
            "我是 Mini Buddy 的模拟回复（当前模型为 mock）。真实模型可在「设置」里配置 OpenAI 兼容接口；"
            "也可以用命令直接操作能力：" + "；".join([
                "`/tools` 查看生效工具",
                "`/tool 名称 参数JSON` 调用工具",
                "`/skills` 查看技能",
                "`/help` 看全部",
            ]) + skill_hint + mcp_hint
        )
        return self._mk_msg(session.id, "assistant", body)
