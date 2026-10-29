"""FastAPI 路由与静态托管。"""
from __future__ import annotations

import json
import os
import shutil
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from typing import Literal, Optional

from pydantic import BaseModel

from .builtin_mcps import BUILTIN_SERVERS
from .chat_engine import ChatEngine, SessionManager
from .knowledge import KnowledgeManager, TaskScheduler
from .mcp_manager import MCPManager
from .models import (
    Assistant,
    MCPServer,
    MCPServerConfig,
    Message,
    SessionOverrides,
    Settings,
    SkillManifest,
    new_id,
    now_ms,
)
from .personas import seed_assistants
from .skill_manager import SkillManager
from .store import Store

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIST = os.path.join(BASE, "frontend", "dist")
WEB_DIR = FRONTEND_DIST if os.path.isdir(FRONTEND_DIST) else os.path.join(BASE, "web")
# 用户数据根：~/.mini-buddy（JSON 配置在 data/，技能目录在 skills/）
from .store import DATA_DIR as MB_DATA_DIR, migrate_legacy_files

_minibuddy_home = os.path.dirname(MB_DATA_DIR)
SKILLS_DIR = os.environ.get("MINIBUDDY_SKILLS") or os.path.join(_minibuddy_home, "skills")

# 首次启动：旧版项目内 data/、skills_runtime/ → ~/.mini-buddy/
_migrated = migrate_legacy_files()
if os.path.isdir(os.path.join(BASE, "skills_runtime")) and not os.path.isdir(SKILLS_DIR):
    try:
        import shutil as _shutil
        os.makedirs(os.path.dirname(SKILLS_DIR), exist_ok=True)
        _shutil.move(os.path.join(BASE, "skills_runtime"), SKILLS_DIR)
        _migrated["skills"] = True
    except Exception:
        pass

store = Store()
mcp_manager = MCPManager()
skill_manager = SkillManager(store, SKILLS_DIR)
session_manager = SessionManager(store)
knowledge = KnowledgeManager(store)
chat_engine = ChatEngine(session_manager, mcp_manager, skill_manager, store,
                         knowledge=knowledge)
scheduler = TaskScheduler(store, session_manager, chat_engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if _migrated.get("data") or _migrated.get("skills"):
        print(f"[migrate] 用户数据已迁移到 {_minibuddy_home} -> {_migrated}")
    # 首次启动：种子内置 MCP + 技能 + 欢迎会话
    if not store.list_mcps():
        servers: list[MCPServer] = []
        for bid, meta in BUILTIN_SERVERS.items():
            cfg = MCPServerConfig(name=meta["name"], transport="builtin", builtin_id=bid)
            srv = MCPServer(id=new_id("mcp"), config=cfg, created_at=now_ms())
            ok, detail = mcp_manager.start(srv)
            servers.append(srv)
        store.save_mcps(servers)
    else:
        # 重启后恢复：持久化的 running 状态对应的连接在内存里已失效，重连
        servers = store.list_mcps()
        for srv in servers:
            if srv.config.enabled and srv.status == "running":
                mcp_manager.start(srv)
            elif srv.status == "running":
                srv.status = "stopped"
                srv.tools = []
        store.save_mcps(servers)
    skill_manager.seed_if_empty()
    seed_assistants(store)
    knowledge.ensure_default_kb()  # 默认知识库（旧文档归入）
    if not store.list_sessions():
        s = session_manager.create("欢迎")
        assistants = store.list_assistants()
        if assistants:
            session_manager.update_session(s.id, assistant_id=assistants[0].id)
        session_manager.append_message(Message(
            id=new_id("msg"), session_id=s.id, role="assistant", ts=now_ms(),
            content=(
                "欢迎使用 **Mini Buddy** —— 一个浏览器里的 AI 助手工作台。\n\n"
                "三件套都在：\n"
                "- **会话**：左侧新建，会话设置里可选助手身份、系统提示词与温度\n"
                "- **MCP**：内置 4 个演示服务器（时钟/计算器/回声/骰子），输入框下方工具条可为单条消息勾选\n"
                "- **技能**：SKILL.md 技能，支持 zip 安装、新建、启停\n\n"
                "试试发消息：`12 * (3 + 8)`、`现在几点`、`掷一个 20 面骰子`，或命令 `/tools`、`/help`。"
            ),
        ))
    yield
    scheduler.stop()
    mcp_manager.shutdown()


app = FastAPI(title="Mini Buddy", lifespan=lifespan)


@app.on_event("startup")
async def _start_scheduler():
    n = knowledge.reindex_if_stale()
    if n:
        print(f"[knowledge] embedding 版本升级，已重嵌 {n} 个文档")
    scheduler.start()


app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

# ---------- schemas ----------


class ChatIn(BaseModel):
    content: str
    # None = 未选择（全部会话生效能力参与）；[] = 显式全不选；[ids] = 只用这些
    mcps: Optional[list[str]] = None
    skills: Optional[list[str]] = None
    # 附件（先经 /api/upload 上传，再引用 url）
    files: list[dict] = []


class MessageEditIn(BaseModel):
    content: str


class OverrideIn(BaseModel):
    mcps: dict[str, str] = {}
    skills: dict[str, str] = {}


class RenameIn(BaseModel):
    title: str


class SessionUpdateIn(BaseModel):
    title: str | None = None
    assistant_id: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None


class SkillCreateIn(BaseModel):
    name: str
    description: str = ""
    instructions: str = ""


class SkillUpdateIn(BaseModel):
    name: str
    description: str = ""
    instructions: str = ""


class SkillToggleIn(BaseModel):
    enabled: bool


class MCPInstallIn(BaseModel):
    name: str
    transport: str = "http"
    description: str = ""
    timeout: float = 30.0
    url: str | None = None
    command: str | None = None
    args: list[str] = []
    env: dict[str, str] = {}
    cwd: str | None = None
    headers: dict[str, str] = {}
    enabled: bool = True


class MCPTestIn(BaseModel):
    transport: str = "http"
    url: str | None = None
    command: str | None = None
    args: list[str] = []
    env: dict[str, str] = {}
    headers: dict[str, str] = {}
    cwd: str | None = None
    builtin_id: str | None = None
    timeout: float = 30.0


class MCPUpdateIn(BaseModel):
    name: str
    description: str = ""
    timeout: float = 30.0
    url: str | None = None
    command: str | None = None
    args: list[str] = []
    env: dict[str, str] = {}
    cwd: str | None = None
    headers: dict[str, str] = {}


class MCPToolCallIn(BaseModel):
    tool: str
    arguments: dict = {}


class ToggleIn(BaseModel):
    enabled: bool


class SettingsIn(BaseModel):
    model: str = "mock"
    api_base: str = "https://api.openai.com/v1"
    api_key: str = ""
    system_prompt: str = ""


# ---------- 会话 ----------


def _session_brief(s):
    a = next((x for x in store.list_assistants() if x.id == s.assistant_id), None)
    return {
        "id": s.id, "title": s.title, "created_at": s.created_at, "updated_at": s.updated_at,
        "assistant_id": s.assistant_id,
        "assistant": ({"id": a.id, "name": a.name, "emoji": a.emoji} if a else None),
        "pending_question": s.pending_question,
    }


@app.get("/api/sessions")
def list_sessions():
    return [_session_brief(s) for s in session_manager.list()]


@app.post("/api/sessions")
def create_session(body: SessionUpdateIn = None):
    s = session_manager.create()
    fields = (body.model_dump() if body else {}) or {}
    fields = {k: v for k, v in fields.items() if v is not None and k != "title"}
    if fields:
        s = session_manager.update_session(s.id, **fields) or s
    return _session_brief(s)


@app.get("/api/sessions/{sid}")
def get_session(sid: str):
    s = session_manager.get(sid)
    if not s:
        raise HTTPException(404, "会话不存在")
    brief = _session_brief(s)
    brief["system_prompt"] = s.system_prompt
    brief["temperature"] = s.temperature
    brief["overrides"] = s.overrides.model_dump()
    brief["caps"] = chat_engine.effective_caps(s).model_dump()
    return brief


@app.delete("/api/sessions/{sid}")
def delete_session(sid: str):
    if not session_manager.delete(sid):
        raise HTTPException(404, "会话不存在")
    return {"ok": True}


@app.post("/api/sessions/clear-all")
def clear_all_sessions():
    """清空全部会话与消息数据。"""
    n = session_manager.clear_all()
    return {"ok": True, "removed": n}


@app.post("/api/sessions/clear-assistant")
def clear_assistant_sessions(body: dict):
    """清空某个助手的全部会话（assistant_id=null 表示默认分组）。"""
    aid = body.get("assistant_id")
    sessions = session_manager.list()
    targets = [s for s in sessions
               if (s.assistant_id or None) == (aid or None)]
    for s in targets:
        session_manager.delete(s.id)
    return {"ok": True, "removed": len(targets)}


@app.patch("/api/sessions/{sid}")
def update_session(sid: str, body: SessionUpdateIn):
    # exclude_unset：只取请求里显式给出的字段；assistant_id 传 null 是"还原默认身份"的合法操作
    fields = body.model_dump(exclude_unset=True) if body else {}
    if not fields:
        raise HTTPException(400, "没有要更新的字段")
    s = session_manager.update_session(sid, **fields)
    if not s:
        raise HTTPException(404, "会话不存在")
    if "assistant_id" in fields:
        assistants = store.list_assistants()
        if fields["assistant_id"] and not any(a.id == fields["assistant_id"] for a in assistants):
            raise HTTPException(404, "助手不存在")
        if fields["assistant_id"] is None:
            s = session_manager.update_session(sid, assistant_id=None)
    return _session_brief(s or session_manager.get(sid))


@app.put("/api/sessions/{sid}/overrides")
def set_overrides(sid: str, body: OverrideIn):
    s = session_manager.get(sid)
    if not s:
        raise HTTPException(404, "会话不存在")
    valid_states = {"inherit", "on", "off"}
    mcps = {k: v for k, v in body.mcps.items() if v in valid_states}
    skills = {k: v for k, v in body.skills.items() if v in valid_states}
    updated = session_manager.set_overrides(sid, SessionOverrides(mcps=mcps, skills=skills))
    return {"ok": True, "overrides": updated.overrides.model_dump(),
            "caps": chat_engine.effective_caps(updated).model_dump()}


class OverrideKeyIn(BaseModel):
    kind: Literal["mcps", "skills"]
    key: str
    state: Literal["inherit", "on", "off"]


@app.put("/api/sessions/{sid}/overrides/key")
def set_override_key(sid: str, body: OverrideKeyIn):
    """设置单个能力的会话级状态（inherit 跟随全局管理开关，on/off 会话级强制）。"""
    s = session_manager.get(sid)
    if not s:
        raise HTTPException(404, "会话不存在")
    updated = session_manager.set_override_key(sid, body.kind, body.key, body.state)
    if not updated:
        raise HTTPException(404, "会话不存在")
    return {"ok": True, "overrides": updated.overrides.model_dump(),
            "caps": chat_engine.effective_caps(updated).model_dump()}


@app.get("/api/sessions/{sid}/messages")
def get_messages(sid: str):
    if not session_manager.get(sid):
        raise HTTPException(404, "会话不存在")
    return [m.model_dump() for m in session_manager.messages(sid)]


@app.patch("/api/sessions/{sid}/messages/{msg_id}")
def edit_message(sid: str, msg_id: str, body: MessageEditIn):
    """编辑消息内容（用户/助手均可），标记 edited。"""
    if not session_manager.get(sid):
        raise HTTPException(404, "会话不存在")
    if not body.content.strip():
        raise HTTPException(400, "消息不能为空")
    m = chat_engine.edit_message(sid, msg_id, body.content)
    if not m:
        raise HTTPException(404, "消息不存在")
    return m.model_dump()


@app.post("/api/sessions/{sid}/messages")
def send_message(sid: str, body: ChatIn):
    s = session_manager.get(sid)
    if not s:
        raise HTTPException(404, "会话不存在")
    if not body.content.strip():
        raise HTTPException(400, "消息不能为空")
    msgs = chat_engine.chat(s, body.content,
                            picked_mcps=body.mcps, picked_skills=body.skills)
    return [m.model_dump() for m in msgs]


@app.post("/api/sessions/{sid}/stream")
async def stream_message(sid: str, body: ChatIn):
    """流式聊天：SSE 事件（user_saved / delta / tool_start / tool_end / done / error）。"""
    s = session_manager.get(sid)
    if not s:
        raise HTTPException(404, "会话不存在")
    if not body.content.strip() and not body.files:
        raise HTTPException(400, "消息不能为空")

    async def gen():
        async for ev in chat_engine.stream_chat(s, body.content,
                                                 picked_mcps=body.mcps,
                                                 picked_skills=body.skills,
                                                 files=body.files):
            yield f"event: {ev['event']}\ndata: {json.dumps(ev['data'], ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- 文件上传 ----------

UPLOAD_DIR = os.path.join(BASE, "data", "uploads")
ALLOWED_MIME_PREFIXES = ("image/", "text/", "application/pdf", "application/json")
MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20MB


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """上传附件，返回 {id, name, mime, size, url}。"""
    import uuid as _uuid
    data = await file.read()
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(400, "文件超过 20MB 限制")
    mime = file.content_type or "application/octet-stream"
    if not mime.startswith(ALLOWED_MIME_PREFIXES):
        raise HTTPException(400, f"不支持的文件类型：{mime}")
    ext = os.path.splitext(file.filename or "file")[1][:16] or ""
    fid = _uuid.uuid4().hex[:12]
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    path = os.path.join(UPLOAD_DIR, fid + ext)
    with open(path, "wb") as f:
        f.write(data)
    return {"id": fid, "name": file.filename or "file",
            "mime": mime, "size": len(data), "url": f"/api/files/{fid}{ext}"}


@app.get("/api/files/{name}")
def get_file(name: str):
    """提供上传文件访问（防目录穿越）。"""
    safe = os.path.basename(name)
    path = os.path.join(UPLOAD_DIR, safe)
    if not os.path.isfile(path):
        raise HTTPException(404, "文件不存在")
    return FileResponse(path)


# ---------- 记忆（长期记忆） ----------


class MemoryIn(BaseModel):
    content: str


@app.get("/api/memories")
def list_memories():
    return [m.model_dump() for m in knowledge.list_memories()]


@app.post("/api/memories")
def add_memory(body: MemoryIn):
    if not body.content.strip():
        raise HTTPException(400, "内容不能为空")
    return knowledge.add_memory(body.content).model_dump()


@app.put("/api/memories/{mid}")
def update_memory(mid: str, body: MemoryIn):
    m = knowledge.update_memory(mid, body.content)
    if not m:
        raise HTTPException(404, "记忆不存在")
    return m.model_dump()


@app.delete("/api/memories/{mid}")
def delete_memory(mid: str):
    if not knowledge.delete_memory(mid):
        raise HTTPException(404, "记忆不存在")
    return {"ok": True}


# ---------- 文档 RAG ----------


@app.get("/api/kbs")
def list_kbs():
    """知识库列表（含文档统计）。"""
    return knowledge.list_kbs()


class KbIn(BaseModel):
    name: str
    description: str = ""


@app.post("/api/kbs")
def create_kb(body: KbIn):
    try:
        kb = knowledge.create_kb(body.name, body.description)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return kb.model_dump()


@app.put("/api/kbs/{kb_id}")
def update_kb(kb_id: str, body: KbIn):
    kb = knowledge.update_kb(kb_id, body.name, body.description)
    if not kb:
        raise HTTPException(404, "知识库不存在")
    return kb.model_dump()


@app.delete("/api/kbs/{kb_id}")
def delete_kb(kb_id: str, with_docs: bool = True):
    if not knowledge.delete_kb(kb_id, with_docs=with_docs):
        raise HTTPException(404, "知识库不存在")
    return {"ok": True}


@app.get("/api/docs")
def list_docs(kb_id: str | None = None):
    docs = store.list_docs()
    if kb_id:
        docs = [d for d in docs if d.kb_id == kb_id]
    return [d.model_dump() for d in docs]


@app.post("/api/docs")
async def upload_doc(file: UploadFile = File(...), kb_id: str | None = None):
    """上传文档入库（txt/md/csv/json/pdf），自动分块+向量化。"""
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(400, "文件超过 20MB 限制")
    mime = file.content_type or "application/octet-stream"
    filename = file.filename or "file.txt"
    ext = os.path.splitext(filename)[1].lower()
    ok_ext = {".txt", ".md", ".csv", ".json", ".pdf"}
    if ext not in ok_ext and not mime.startswith(("text/", "application/pdf")):
        raise HTTPException(400, f"不支持的文档类型：{ext or mime}")
    try:
        doc = knowledge.add_doc(filename, mime, data, kb_id=kb_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return doc.model_dump()


@app.delete("/api/docs/{doc_id}")
def delete_doc(doc_id: str):
    if not knowledge.delete_doc(doc_id):
        raise HTTPException(404, "文档不存在")
    return {"ok": True}


@app.get("/api/docs/{doc_id}")
def get_doc(doc_id: str):
    """文档详情：全文 + 分段列表（供查看/编辑）。"""
    r = knowledge.get_doc(doc_id)
    if not r:
        raise HTTPException(404, "文档不存在")
    return r


class DocTextIn(BaseModel):
    text: str


@app.put("/api/docs/{doc_id}")
def update_doc(doc_id: str, body: DocTextIn):
    """全文编辑：重新分块 + 向量化。"""
    try:
        doc = knowledge.update_doc_text(doc_id, body.text)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not doc:
        raise HTTPException(404, "文档不存在")
    return doc.model_dump()


class ChunkTextIn(BaseModel):
    text: str


@app.put("/api/docs/{doc_id}/chunks/{chunk_id}")
def update_doc_chunk(doc_id: str, chunk_id: str, body: ChunkTextIn):
    """分段编辑：只重嵌该段，其余段不动。"""
    r = knowledge.update_chunk_text(doc_id, chunk_id, body.text)
    if not r:
        raise HTTPException(404, "文档或分段不存在")
    return r


class RagQueryIn(BaseModel):
    query: str
    top_k: int = 4
    kb_ids: list[str] | None = None


@app.post("/api/docs/search")
def rag_search(body: RagQueryIn):
    """检索测试：看文档库对 query 会命中哪些片段。"""
    return knowledge.search(body.query, body.top_k, kb_ids=body.kb_ids)


# ---------- 定时任务 ----------


class TaskIn(BaseModel):
    name: str
    prompt: str
    session_id: str
    kind: Literal["interval", "daily"] = "interval"
    interval_minutes: int = 60
    daily_at: str = "09:00"
    enabled: bool = True


class TaskUpdateIn(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    session_id: Optional[str] = None
    kind: Optional[Literal["interval", "daily"]] = None
    interval_minutes: Optional[int] = None
    daily_at: Optional[str] = None
    enabled: Optional[bool] = None


@app.get("/api/tasks")
def list_tasks():
    return [t.model_dump() for t in scheduler.list()]


@app.post("/api/tasks")
def create_task(body: TaskIn):
    if not body.name.strip() or not body.prompt.strip():
        raise HTTPException(400, "名称与提示词不能为空")
    try:
        t = scheduler.create(body.name, body.prompt, body.session_id, body.kind,
                             interval_minutes=body.interval_minutes,
                             daily_at=body.daily_at, enabled=body.enabled)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return t.model_dump()


@app.put("/api/tasks/{tid}")
def update_task(tid: str, body: TaskUpdateIn):
    t = scheduler.update(tid, **{k: v for k, v in body.model_dump().items()})
    if not t:
        raise HTTPException(404, "任务不存在")
    return t.model_dump()


@app.delete("/api/tasks/{tid}")
def delete_task(tid: str):
    if not scheduler.delete(tid):
        raise HTTPException(404, "任务不存在")
    return {"ok": True}


@app.post("/api/tasks/{tid}/run")
async def run_task_now(tid: str):
    t = scheduler.get(tid)
    if not t:
        raise HTTPException(404, "任务不存在")
    result = await scheduler.run_task(t)
    updated = scheduler.get(tid)
    return {"ok": True, "result": result, "task": updated.model_dump() if updated else None}


# ---------- 助手（角色身份） ----------


class AssistantIn(BaseModel):
    name: str
    emoji: str = "🤖"
    description: str = ""
    prompt: str = ""
    mcps: Optional[list[str]] = None
    skills: Optional[list[str]] = None
    kbs: Optional[list[str]] = None


@app.get("/api/assistants")
def list_assistants():
    return [a.model_dump() for a in store.list_assistants()]


@app.post("/api/assistants")
def create_assistant(body: AssistantIn):
    if not body.name.strip():
        raise HTTPException(400, "名称不能为空")
    a = Assistant(id=new_id("ast"), name=body.name.strip(), emoji=body.emoji or "🤖",
                  description=body.description, prompt=body.prompt,
                  mcps=body.mcps, skills=body.skills, kbs=body.kbs,
                  created_at=now_ms())
    assistants = store.list_assistants()
    assistants.append(a)
    store.save_assistants(assistants)
    return a.model_dump()


@app.put("/api/assistants/{assistant_id}")
def update_assistant(assistant_id: str, body: AssistantIn):
    assistants = store.list_assistants()
    for a in assistants:
        if a.id == assistant_id:
            a.name = body.name.strip() or a.name
            a.emoji = body.emoji or a.emoji
            a.description = body.description
            a.prompt = body.prompt
            a.mcps = body.mcps
            a.skills = body.skills
            a.kbs = body.kbs
            store.save_assistants(assistants)
            return a.model_dump()
    raise HTTPException(404, "助手不存在")


@app.delete("/api/assistants/{assistant_id}")
def delete_assistant(assistant_id: str):
    assistants = store.list_assistants()
    target = next((a for a in assistants if a.id == assistant_id), None)
    if not target:
        raise HTTPException(404, "助手不存在")
    if target.builtin:
        raise HTTPException(400, "内置助手不可删除")
    store.save_assistants([a for a in assistants if a.id != assistant_id])
    # 解绑使用该助手的会话
    sessions = store.list_sessions()
    changed = False
    for s in sessions:
        if s.assistant_id == assistant_id:
            s.assistant_id = None
            changed = True
    if changed:
        store.save_sessions(sessions)
    return {"ok": True}


# ---------- MCP ----------


@app.get("/api/mcp")
def list_mcps():
    return [s.model_dump() for s in store.list_mcps()]


@app.get("/api/mcp/builtin")
def list_builtin():
    return [{"id": bid, "name": m["name"], "desc": m["desc"]} for bid, m in BUILTIN_SERVERS.items()]


@app.post("/api/mcp/install/builtin/{builtin_id}")
def install_builtin(builtin_id: str):
    if builtin_id not in BUILTIN_SERVERS:
        raise HTTPException(404, "未知内置服务器")
    meta = BUILTIN_SERVERS[builtin_id]
    cfg = MCPServerConfig(name=meta["name"], transport="builtin", builtin_id=builtin_id)
    srv = MCPServer(id=new_id("mcp"), config=cfg, created_at=now_ms())
    ok, detail = mcp_manager.start(srv)
    servers = store.list_mcps()
    if any(s.config.builtin_id == builtin_id for s in servers):
        raise HTTPException(409, "该内置服务器已安装")
    servers.append(srv)
    store.save_mcps(servers)
    return srv.model_dump()


@app.post("/api/mcp/install")
def install_mcp(body: MCPInstallIn):
    if body.transport not in {"stdio", "http", "sse"}:
        raise HTTPException(400, "transport 必须是 stdio、http 或 sse")
    if body.transport in {"http", "sse"} and not body.url:
        raise HTTPException(400, f"{body.transport} 服务器需要 url")
    if body.transport == "stdio" and not body.command:
        raise HTTPException(400, "stdio 服务器需要 command")
    cfg = MCPServerConfig(name=body.name, transport=body.transport, description=body.description,
                          timeout=body.timeout, url=body.url, command=body.command,
                          args=body.args, env=body.env, cwd=body.cwd,
                          headers=body.headers, enabled=body.enabled)
    srv = MCPServer(id=new_id("mcp"), config=cfg, created_at=now_ms())
    if body.enabled:
        mcp_manager.start(srv)
    servers = store.list_mcps()
    servers.append(srv)
    store.save_mcps(servers)
    return srv.model_dump()


@app.put("/api/mcp/{server_id}")
def update_mcp(server_id: str, body: MCPUpdateIn):
    """更新配置；运行中的服务器按新配置重启。

    内置服务器只允许改 description / timeout（连接参数以 body 显式传为准，
    builtin 时不应用 url/command 等字段）。
    """
    servers = store.list_mcps()
    srv = next((s for s in servers if s.id == server_id), None)
    if not srv:
        raise HTTPException(404, "服务器不存在")
    if not body.name.strip():
        raise HTTPException(400, "名称不能为空")
    was_running = srv.status == "running"
    if srv.config.transport == "builtin":
        # 内置：仅描述/超时可编辑，不重启（无连接参数变化）
        srv.config.description = body.description
        srv.config.timeout = body.timeout
        store.save_mcps(servers)
        return srv.model_dump()
    mcp_manager.stop(srv)
    srv.config.name = body.name.strip()
    srv.config.description = body.description
    srv.config.timeout = body.timeout
    srv.config.url = body.url
    srv.config.command = body.command
    srv.config.args = body.args
    srv.config.env = body.env
    srv.config.cwd = body.cwd
    srv.config.headers = body.headers
    if was_running:
        mcp_manager.start(srv)
    store.save_mcps(servers)
    return srv.model_dump()


@app.post("/api/mcp/test")
def test_mcp(body: MCPTestIn):
    if body.transport == "builtin":
        if body.builtin_id not in BUILTIN_SERVERS:
            raise HTTPException(404, "未知内置服务器")
        cfg = MCPServerConfig(name="probe", transport="builtin", builtin_id=body.builtin_id)
    else:
        cfg = MCPServerConfig(name="probe", transport=body.transport, url=body.url,
                              command=body.command, args=body.args, env=body.env,
                              cwd=body.cwd, headers=body.headers, timeout=body.timeout)
    ok, msg, tools = mcp_manager.test_connect(cfg)
    return {"ok": ok, "message": msg, "tools": tools}


@app.post("/api/mcp/{server_id}/start")
def start_mcp(server_id: str):
    servers = store.list_mcps()
    srv = next((s for s in servers if s.id == server_id), None)
    if not srv:
        raise HTTPException(404, "服务器不存在")
    ok, detail = mcp_manager.start(srv)
    store.save_mcps(servers)
    return {"ok": ok, "detail": detail, "server": srv.model_dump()}


@app.post("/api/mcp/{server_id}/stop")
def stop_mcp(server_id: str):
    servers = store.list_mcps()
    srv = next((s for s in servers if s.id == server_id), None)
    if not srv:
        raise HTTPException(404, "服务器不存在")
    mcp_manager.stop(srv)
    store.save_mcps(servers)
    return {"ok": True, "server": srv.model_dump()}


@app.post("/api/mcp/{server_id}/toggle")
def toggle_mcp(server_id: str, body: ToggleIn):
    servers = store.list_mcps()
    srv = next((s for s in servers if s.id == server_id), None)
    if not srv:
        raise HTTPException(404, "服务器不存在")
    srv.config.enabled = body.enabled
    if not body.enabled:
        mcp_manager.stop(srv)
    elif body.enabled and srv.status == "stopped":
        mcp_manager.start(srv)
    store.save_mcps(servers)
    return {"ok": True, "server": srv.model_dump()}


@app.delete("/api/mcp/{server_id}")
def delete_mcp(server_id: str):
    servers = store.list_mcps()
    srv = next((s for s in servers if s.id == server_id), None)
    if not srv:
        raise HTTPException(404, "服务器不存在")
    mcp_manager.stop(srv)
    store.save_mcps([s for s in servers if s.id != server_id])
    return {"ok": True}


@app.post("/api/mcp/{server_id}/tools/{tool_name}")
def call_tool(server_id: str, tool_name: str, body: MCPToolCallIn):
    servers = store.list_mcps()
    srv = next((s for s in servers if s.id == server_id), None)
    if not srv:
        raise HTTPException(404, "服务器不存在")
    if srv.status != "running":
        raise HTTPException(400, "服务器未运行")
    try:
        result = mcp_manager.call_tool(srv, tool_name, body.arguments)
        return {"ok": True, "result": result}
    except Exception as e:
        raise HTTPException(500, f"工具调用失败: {e}")


# ---------- 技能 ----------


@app.get("/api/skills")
def list_skills():
    return [s.model_dump() for s in skill_manager.list_skills()]


@app.post("/api/skills")
def create_skill(body: SkillCreateIn):
    try:
        return skill_manager.create(body.name, body.description, body.instructions).model_dump()
    except ValueError as e:
        raise HTTPException(409, str(e))


@app.get("/api/skills/{slug}")
def get_skill(slug: str):
    s = skill_manager.get(slug)
    if not s:
        raise HTTPException(404, "技能不存在")
    return s.model_dump()


@app.put("/api/skills/{slug}")
def update_skill(slug: str, body: SkillUpdateIn):
    try:
        return skill_manager.update(slug, body.name, body.description, body.instructions).model_dump()
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/skills/{slug}/toggle")
def toggle_skill(slug: str, body: SkillToggleIn):
    try:
        return skill_manager.set_enabled(slug, body.enabled).model_dump()
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.delete("/api/skills/{slug}")
def delete_skill(slug: str):
    skill_manager.delete(slug)
    return {"ok": True}


@app.post("/api/skills/install")
async def install_skill_zip(file: UploadFile = File(...)):
    data = await file.read()
    try:
        return skill_manager.install_zip(data, file.filename or "skill.zip").model_dump()
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---------- 技能文件（目录树 + Monaco 编辑） ----------


class FileWriteIn(BaseModel):
    path: str
    content: str


class FileDeleteIn(BaseModel):
    path: str


def _safe_skill_path(slug: str, rel: str) -> str:
    """校验技能文件路径，防目录穿越。"""
    base = os.path.abspath(skill_manager._dir(slug))
    rel_norm = rel.replace("\\", "/").lstrip("/")
    if not rel_norm or rel_norm.endswith("/"):
        raise HTTPException(400, "非法路径")
    target = os.path.abspath(os.path.join(base, rel_norm))
    if not target.startswith(base + os.sep) and target != base:
        raise HTTPException(400, "路径越界")
    return target


@app.get("/api/skills/{slug}/tree")
def skill_tree(slug: str):
    """目录树：[{path, size, is_dir}]，扁平相对路径列表。"""
    s = skill_manager.get(slug)
    if not s:
        raise HTTPException(404, "技能不存在")
    base = skill_manager._dir(slug)
    out: list[dict] = []
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in {".git", "__pycache__", "node_modules", ".versions"}]
        for d in dirs:
            rel = os.path.relpath(os.path.join(root, d), base).replace("\\", "/")
            out.append({"path": rel + "/", "size": 0, "is_dir": True})
        for fn in files:
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, base).replace("\\", "/")
            try:
                size = os.path.getsize(p)
            except OSError:
                size = 0
            out.append({"path": rel, "size": size, "is_dir": False})
    out.sort(key=lambda x: x["path"])
    return out


@app.get("/api/skills/{slug}/file")
def skill_file_read(slug: str, path: str):
    target = _safe_skill_path(slug, path)
    if not os.path.isfile(target):
        raise HTTPException(404, "文件不存在")
    try:
        with open(target, "r", encoding="utf-8") as f:
            content = f.read()
    except UnicodeDecodeError:
        raise HTTPException(400, "二进制文件暂不支持在线编辑")
    return {"path": path.replace("\\", "/"), "content": content, "size": os.path.getsize(target)}


@app.put("/api/skills/{slug}/file")
def skill_file_write(slug: str, body: FileWriteIn):
    s = skill_manager.get(slug)
    if not s:
        raise HTTPException(404, "技能不存在")
    target = _safe_skill_path(slug, body.path)
    # 版本化：覆盖已有文件前先快照当前内容
    rel = body.path.replace("\\", "/")
    snap_n = skill_manager.snapshot_before_write(slug, [rel], note=f"保存 {rel} 前的自动快照")
    os.makedirs(os.path.dirname(target) or target, exist_ok=True)
    with open(target, "w", encoding="utf-8") as f:
        f.write(body.content)
    # SKILL.md 变化时同步 manifest（名称/描述/正文）
    if body.path.replace("\\", "/").lower() == "skill.md":
        from .skill_manager import parse_frontmatter
        meta, instr = parse_frontmatter(body.content)
        skill_manager.update(slug, meta.get("name", s.name),
                             meta.get("description", s.description), instr)
    else:
        skills = store.list_skills()
        for sk in skills:
            if sk.slug == slug:
                sk.files = skill_manager._list_files(slug)
        store.save_skills(skills)
    return {"ok": True, "size": len(body.content.encode("utf-8")), "snapshot": snap_n}


# ---------- 技能版本化 ----------


@app.get("/api/skills/{slug}/versions")
def skill_versions(slug: str):
    """版本列表（新→旧）。"""
    s = skill_manager.get(slug)
    if not s:
        raise HTTPException(404, "技能不存在")
    return skill_manager.list_versions(slug)


@app.get("/api/skills/{slug}/versions/{n}")
def skill_version_file(slug: str, n: int, path: str):
    """读取某版本中的单个文件内容。"""
    s = skill_manager.get(slug)
    if not s:
        raise HTTPException(404, "技能不存在")
    target = _safe_skill_path(slug, path)  # 复用路径校验（防穿越）
    content = skill_manager.read_version_file(slug, n, path.replace("\\", "/"))
    if content is None:
        raise HTTPException(404, "该版本中没有此文件")
    return {"path": path.replace("\\", "/"), "content": content}


@app.post("/api/skills/{slug}/rollback/{n}")
def skill_rollback(slug: str, n: int):
    """回滚：把版本 n 的文件覆盖回工作区（回滚前自动快照当前状态）。"""
    s = skill_manager.get(slug)
    if not s:
        raise HTTPException(404, "技能不存在")
    try:
        r = skill_manager.rollback(slug, n)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"ok": True, **r}


@app.delete("/api/skills/{slug}/file")
def skill_file_delete(slug: str, body: FileDeleteIn):
    s = skill_manager.get(slug)
    if not s:
        raise HTTPException(404, "技能不存在")
    rel = body.path.replace("\\", "/").rstrip("/")
    if rel.lower() == "skill.md":
        raise HTTPException(400, "SKILL.md 不可删除")
    target = _safe_skill_path(slug, rel)
    if os.path.isdir(target):
        shutil.rmtree(target, ignore_errors=True)
    elif os.path.isfile(target):
        os.remove(target)
    else:
        raise HTTPException(404, "文件不存在")
    skills = store.list_skills()
    for sk in skills:
        if sk.slug == slug:
            sk.files = skill_manager._list_files(slug)
    store.save_skills(skills)
    return {"ok": True}


# ---------- 设置 ----------


@app.get("/api/settings")
def get_settings():
    s = store.load_settings()
    masked = s.model_dump()
    if s.api_key:
        masked["api_key"] = "***"
        masked["has_api_key"] = True
    else:
        masked["has_api_key"] = False
    return masked


@app.put("/api/settings")
def put_settings(body: SettingsIn):
    current = store.load_settings()
    current.model = body.model
    current.api_base = body.api_base
    current.system_prompt = body.system_prompt or current.system_prompt
    if body.api_key and body.api_key != "***":
        current.api_key = body.api_key
    store.save_settings(current)
    return {"ok": True}


# ---------- 静态托管（Vite 构建产物或旧 web/） ----------

if os.path.isdir(os.path.join(WEB_DIR, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(WEB_DIR, "assets")), name="assets")


@app.get("/{path:path}")
def spa_fallback(path: str):
    """SPA 路由回退：命中静态文件则返回，否则回 index.html。"""
    target = os.path.normpath(os.path.join(WEB_DIR, path))
    if target.startswith(WEB_DIR) and os.path.isfile(target):
        return FileResponse(target)
    return FileResponse(os.path.join(WEB_DIR, "index.html"))
