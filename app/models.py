"""Mini Buddy 公共模型。"""
from __future__ import annotations

import re
import time
import uuid
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


SLUG_RE = re.compile(r"[^a-z0-9_\-\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]")


def slugify(name: str) -> str:
    """把名字转成安全的目录名（保留中日韩字符）。"""
    s = name.strip().lower().replace(" ", "-")
    s = SLUG_RE.sub("", s)
    return s[:48] or "unnamed"


CapabilityState = Literal["inherit", "on", "off"]


class MCPServerConfig(BaseModel):
    """一个 MCP 服务器的连接配置。"""
    name: str
    transport: Literal["builtin", "stdio", "http", "sse"] = "builtin"
    description: str = ""
    timeout: float = 30.0  # 连接/调用超时（秒）
    # stdio
    command: Optional[str] = None
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    cwd: Optional[str] = None
    # http / sse
    url: Optional[str] = None
    headers: dict[str, str] = Field(default_factory=dict)  # 自定义请求头（鉴权等）
    # builtin
    builtin_id: Optional[str] = None
    # 运行时
    enabled: bool = True


class MCPServer(BaseModel):
    id: str
    config: MCPServerConfig
    status: Literal["stopped", "starting", "running", "error"] = "stopped"
    status_detail: str = ""
    tools: list[dict[str, Any]] = Field(default_factory=list)  # [{name, description}]
    created_at: int
    last_started_at: Optional[int] = None


class SkillManifest(BaseModel):
    """技能清单（对应 SKILL.md 的 frontmatter）。"""
    slug: str
    name: str
    description: str = ""
    version: str = "0.1.0"
    source: Literal["builtin", "zip", "manual"] = "builtin"
    enabled: bool = True
    instructions: str = ""  # SKILL.md 正文
    files: list[str] = Field(default_factory=list)  # 技能目录内的文件名
    created_at: int = 0


class SessionOverrides(BaseModel):
    """会话级能力控制。"""
    mcps: dict[str, CapabilityState] = Field(default_factory=dict)   # server_id -> inherit/on/off
    skills: dict[str, CapabilityState] = Field(default_factory=dict)  # slug -> inherit/on/off


class Message(BaseModel):
    id: str
    session_id: str
    role: Literal["user", "assistant", "system"]
    content: str
    ts: int
    tool_events: list[dict[str, Any]] = Field(default_factory=list)  # [{type,name,server,ok,detail}]
    # 消息级能力选择：这条消息期望使用的 MCP / 技能
    attachments: dict[str, list[str]] = Field(default_factory=dict)  # {"mcps": [id], "skills": [slug]}
    # 附件：[{id, name, mime, size, url}]（url 以 /api/files/ 开头）
    files: list[dict[str, Any]] = Field(default_factory=list)
    # 思考过程（reasoning），前端默认折叠展示
    thinking: str = ""
    # 消息元信息：{elapsed_ms, input_tokens, output_tokens, model, calls}
    meta: dict[str, Any] = Field(default_factory=dict)
    # HITL：助手向用户发起的提问卡 {id, question, options, multi}
    ask: Optional[dict[str, Any]] = None
    # 用户/助手编辑过内容后置 True
    edited: bool = False


class Assistant(BaseModel):
    """助手（角色身份），参考 Cherry Studio 的 assistants。"""
    id: str
    name: str
    emoji: str = "🤖"
    description: str = ""
    prompt: str = ""            # 助手的系统提示词
    builtin: bool = False       # 内置角色不可删除
    # 能力绑定：None = 不限制（继承全部）；[ids] = 只用这些
    mcps: Optional[list[str]] = None
    skills: Optional[list[str]] = None
    kbs: Optional[list[str]] = None   # 知识库 kb_id 列表（库级）
    created_at: int = 0


class ChatSession(BaseModel):
    id: str
    title: str
    created_at: int
    updated_at: int
    overrides: SessionOverrides = Field(default_factory=SessionOverrides)
    assistant_id: Optional[str] = None   # 绑定的助手（角色身份）
    # HITL：等待用户回答的提问（回答/新消息发送后清除）
    pending_question: Optional[dict[str, Any]] = None
    system_prompt: str = ""              # 会话级系统提示词（叠加在助手 prompt 之后）
    temperature: float = 0.7


class Settings(BaseModel):
    model: str = "mock"  # "mock" 或 OpenAI 兼容模型名
    api_base: str = "https://api.openai.com/v1"
    api_key: str = ""
    system_prompt: str = "你是 Mini Buddy，一个浏览器里的 AI 助手工作台。"
    embed_version: int = 1  # 分词/embedding 算法版本（变更时启动重嵌）


class SessionCaps(BaseModel):
    """一个会话实际生效的能力（继承全局开关后的结果）。"""
    mcps: list[dict[str, Any]] = Field(default_factory=list)
    skills: list[dict[str, Any]] = Field(default_factory=list)


# ---------- 记忆 / 文档 RAG / 定时任务 ----------


class MemoryItem(BaseModel):
    """一条长期记忆（手动管理 + 聊天可引用）。"""
    id: str
    content: str
    source: Literal["manual", "chat"] = "manual"
    session_id: Optional[str] = None  # 来源会话（source=chat 时）
    created_at: int = 0
    updated_at: int = 0


class DocChunk(BaseModel):
    """文档分块 + 向量。"""
    id: str
    doc_id: str
    idx: int
    text: str
    vector: list[float] = Field(default_factory=list)


class KnowledgeBase(BaseModel):
    """一个知识库（文档的分组容器）。"""
    id: str
    name: str
    description: str = ""
    created_at: int = 0


class DocFile(BaseModel):
    """一个已入库文档。"""
    id: str
    name: str
    kb_id: str = ""             # 所属知识库
    mime: str = ""
    size: int = 0
    chunks: int = 0
    text: str = ""                # 全文（分段编辑的基准）；旧文档惰性重建
    created_at: int = 0


class ScheduledTask(BaseModel):
    """定时任务：interval_minutes（每 N 分钟）或 daily_at（HH:MM 每日）。"""
    id: str
    name: str
    prompt: str
    session_id: str                 # 执行结果落到哪个会话
    kind: Literal["interval", "daily"] = "interval"
    interval_minutes: int = 60      # kind=interval
    daily_at: str = "09:00"         # kind=daily，HH:MM
    enabled: bool = True
    created_at: int = 0
    last_run: Optional[int] = None
    next_run: Optional[int] = None
    run_count: int = 0
    last_ok: Optional[bool] = None
    last_result: str = ""
