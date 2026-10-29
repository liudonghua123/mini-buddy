"""Mini Buddy 持久化：~/.mini-buddy/data/ 下的 JSON 文件。

所有用户数据（配置 JSON、技能目录、上传文档索引）都以文件系统为准，
可用 MINIBUDDY_HOME 环境变量整体改到其它目录（默认 ~/.mini-buddy）。
"""
from __future__ import annotations

import json
import os
import shutil
import threading
from typing import Any

from .models import (
    Assistant,
    ChatSession,
    DocChunk,
    DocFile,
    KnowledgeBase,
    MCPServer,
    MemoryItem,
    Message,
    ScheduledTask,
    Settings,
    SkillManifest,
)

# ---------- 数据根目录：~/.mini-buddy（可覆盖） ----------
_MINIBUDDY_HOME = os.environ.get("MINIBUDDY_HOME") or os.path.join(
    os.path.expanduser("~"), ".mini-buddy")
DATA_DIR = os.environ.get("MINIBUDDY_DATA") or os.path.join(_MINIBUDDY_HOME, "data")

# 兼容旧版：项目内 data/ 与 skills_runtime/（首次启动自动迁移）
_LEGACY_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_LEGACY_DATA = os.path.join(_LEGACY_BASE, "data")
_LEGACY_SKILLS = os.path.join(_LEGACY_BASE, "skills_runtime")


def migrate_legacy_files() -> dict:
    """旧项目内 data/、skills_runtime/ → ~/.mini-buddy/。返回迁移摘要。"""
    moved = {"data": False, "skills": False}
    try:
        if os.path.isdir(_LEGACY_DATA) and not os.path.isdir(DATA_DIR):
            os.makedirs(os.path.dirname(DATA_DIR), exist_ok=True)
            shutil.move(_LEGACY_DATA, DATA_DIR)
            moved["data"] = True
        elif os.path.isdir(_LEGACY_DATA) and os.path.isdir(DATA_DIR):
            # 两处都有：把旧目录里的新文件搬过去（简单策略：逐文件补缺）
            for fn in os.listdir(_LEGACY_DATA):
                src = os.path.join(_LEGACY_DATA, fn)
                dst = os.path.join(DATA_DIR, fn)
                if os.path.isfile(src) and not os.path.exists(dst):
                    shutil.copy2(src, dst)
            moved["data"] = True
        legacy_messages = os.path.join(DATA_DIR, "messages")
        os.makedirs(legacy_messages, exist_ok=True)
    except Exception:
        pass
    return moved


class Store:
    """极简 JSON 文件存储，带进程内锁。"""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        os.makedirs(DATA_DIR, exist_ok=True)
        self.sessions_file = os.path.join(DATA_DIR, "sessions.json")
        self.mcps_file = os.path.join(DATA_DIR, "mcps.json")
        self.skills_file = os.path.join(DATA_DIR, "skills.json")
        self.settings_file = os.path.join(DATA_DIR, "settings.json")
        self.assistants_file = os.path.join(DATA_DIR, "assistants.json")
        self.memories_file = os.path.join(DATA_DIR, "memories.json")
        self.docs_file = os.path.join(DATA_DIR, "docs.json")
        self.chunks_file = os.path.join(DATA_DIR, "chunks.json")
        self.kbs_file = os.path.join(DATA_DIR, "kbs.json")
        self.tasks_file = os.path.join(DATA_DIR, "tasks.json")
        self.messages_dir = os.path.join(DATA_DIR, "messages")
        os.makedirs(self.messages_dir, exist_ok=True)

    # ---- 底层 ----
    def _read(self, path: str, default: Any) -> Any:
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return default
        except Exception:
            return default

    def _write(self, path: str, data: Any) -> None:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)

    # ---- sessions ----
    def list_sessions(self) -> list[ChatSession]:
        with self._lock:
            rows = self._read(self.sessions_file, [])
            return [ChatSession(**r) for r in rows]

    def save_sessions(self, sessions: list[ChatSession]) -> None:
        with self._lock:
            self._write(self.sessions_file, [s.model_dump() for s in sessions])

    # ---- messages（每个会话一个文件） ----
    def load_messages(self, session_id: str) -> list[Message]:
        with self._lock:
            rows = self._read(self._msg_path(session_id), [])
            return [Message(**r) for r in rows]

    def save_messages(self, session_id: str, messages: list[Message]) -> None:
        with self._lock:
            self._write(self._msg_path(session_id), [m.model_dump() for m in messages])

    def _msg_path(self, session_id: str) -> str:
        safe = "".join(c for c in session_id if c.isalnum() or c in "_-")
        return os.path.join(self.messages_dir, f"{safe}.json")

    def clear_sessions(self) -> int:
        """清空全部会话与消息文件。返回删除的会话数。"""
        with self._lock:
            sessions = self.list_sessions()
            self._write(self.sessions_file, [])
            removed = 0
            for s in sessions:
                try:
                    os.remove(self._msg_path(s.id))
                    removed += 1
                except OSError:
                    pass
            return len(sessions)

    # ---- mcps ----
    def list_mcps(self) -> list[MCPServer]:
        with self._lock:
            rows = self._read(self.mcps_file, [])
            return [MCPServer(**r) for r in rows]

    def save_mcps(self, servers: list[MCPServer]) -> None:
        with self._lock:
            self._write(self.mcps_file, [s.model_dump() for s in servers])

    # ---- skills ----
    def list_skills(self) -> list[SkillManifest]:
        with self._lock:
            rows = self._read(self.skills_file, [])
            return [SkillManifest(**r) for r in rows]

    def save_skills(self, skills: list[SkillManifest]) -> None:
        with self._lock:
            self._write(self.skills_file, [s.model_dump() for s in skills])

    # ---- settings ----
    def load_settings(self) -> Settings:
        with self._lock:
            return Settings(**self._read(self.settings_file, {}))

    def save_settings(self, settings: Settings) -> None:
        with self._lock:
            self._write(self.settings_file, settings.model_dump())

    # ---- assistants ----
    def list_assistants(self) -> list[Assistant]:
        with self._lock:
            rows = self._read(self.assistants_file, [])
            return [Assistant(**r) for r in rows]

    def save_assistants(self, assistants: list[Assistant]) -> None:
        with self._lock:
            self._write(self.assistants_file, [a.model_dump() for a in assistants])

    # ---- memories ----
    def list_memories(self) -> list[MemoryItem]:
        with self._lock:
            rows = self._read(self.memories_file, [])
            return [MemoryItem(**r) for r in rows]

    def save_memories(self, items: list[MemoryItem]) -> None:
        with self._lock:
            self._write(self.memories_file, [m.model_dump() for m in items])

    # ---- docs（RAG） ----
    def list_docs(self) -> list[DocFile]:
        with self._lock:
            rows = self._read(self.docs_file, [])
            return [DocFile(**r) for r in rows]

    def save_docs(self, docs: list[DocFile]) -> None:
        with self._lock:
            self._write(self.docs_file, [d.model_dump() for d in docs])

    def list_chunks(self) -> list[DocChunk]:
        with self._lock:
            rows = self._read(self.chunks_file, [])
            return [DocChunk(**r) for r in rows]

    def save_chunks(self, chunks: list[DocChunk]) -> None:
        with self._lock:
            self._write(self.chunks_file, [c.model_dump() for c in chunks])

    # ---- knowledge bases ----
    def list_kbs(self) -> list[KnowledgeBase]:
        with self._lock:
            rows = self._read(self.kbs_file, [])
            return [KnowledgeBase(**r) for r in rows]

    def save_kbs(self, kbs: list[KnowledgeBase]) -> None:
        with self._lock:
            self._write(self.kbs_file, [k.model_dump() for k in kbs])

    # ---- scheduled tasks ----
    def list_tasks(self) -> list[ScheduledTask]:
        with self._lock:
            rows = self._read(self.tasks_file, [])
            return [ScheduledTask(**r) for r in rows]

    def save_tasks(self, tasks: list[ScheduledTask]) -> None:
        with self._lock:
            self._write(self.tasks_file, [t.model_dump() for t in tasks])
