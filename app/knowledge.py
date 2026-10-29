"""知识模块：长期记忆、文档 RAG（本地哈希向量）、定时任务调度。

- 记忆：手动 CRUD；build_system_prompt 时注入为「长期记忆」段
- 文档：上传→抽取文本→分块→哈希 embedding→余弦 top-k 检索；聊天时注入
- 定时：interval（每 N 分钟）/ daily（每日 HH:MM）；到期把任务 prompt 作为
  用户消息发给目标会话的 chat_engine，结果作为消息落库；lifespan 驱动
"""
from __future__ import annotations

import asyncio
import hashlib
import math
import os
import re
import time
from datetime import datetime, timedelta
from typing import Any

from .models import (DocChunk, DocFile, KnowledgeBase, MemoryItem,
                     ScheduledTask, new_id, now_ms)

# ---------- 哈希 embedding（无需外部模型） ----------

EMBED_DIM = 256
EMBED_VERSION = 2  # v2: CJK 单字切分（v1 连续中文整句成单 token，检索不可用）
_CJK = re.compile(r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]")
_WORD_RE = re.compile(r"[a-zA-Z0-9_]+|[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]", re.UNICODE)


def _tokens(text: str) -> list[str]:
    """英文/数字整词，CJK 单字切（配合 bigram 得到字对匹配）。"""
    # 先把 CJK 字符之间的粘连拆开：逐字提取
    return _WORD_RE.findall(text.lower())


def embed(text: str) -> list[float]:
    """特征哈希 embedding：unigram+bigram → 符号哈希 → L2 归一化。"""
    vec = [0.0] * EMBED_DIM
    toks = _tokens(text)
    grams = toks + [a + b for a, b in zip(toks, toks[1:])]
    for g in grams:
        h = int(hashlib.md5(g.encode("utf-8")).hexdigest(), 16)
        i = h % EMBED_DIM
        sign = 1.0 if (h >> 64) & 1 else -1.0
        vec[i] += sign
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [round(x / norm, 6) for x in vec]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))


# ---------- 文本抽取与分块 ----------

def extract_text(filename: str, mime: str, data: bytes) -> str:
    """从上传字节流抽取文本。支持 txt/md/csv/json/pdf；pdf 用 pypdf（可选）。"""
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf" or mime == "application/pdf":
        try:
            import io
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            return "\n".join((p.extract_text() or "") for p in reader.pages)
        except Exception as e:  # pypdf 未安装或解析失败
            raise ValueError(f"PDF 解析失败：{e}") from e
    # 其余按文本处理（utf-8 优先，gbk 兜底）
    for enc in ("utf-8", "gb18030"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("无法解码的文件编码")


def chunk_text(text: str, size: int = 500, overlap: int = 50) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= size:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        # 尽量在换行/句号处断开
        if end < len(text):
            window = text[start:end]
            cut = max(window.rfind("\n"), window.rfind("。"), window.rfind(". "))
            if cut > size // 2:
                end = start + cut + 1
        chunks.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return [c for c in chunks if c]


class KnowledgeManager:
    """记忆 + 文档 RAG。"""

    def __init__(self, store) -> None:
        self.store = store

    # ---- embedding 版本迁移 ----
    def reindex_if_stale(self) -> int:
        """分词算法升级后对旧文档重新分块向量化，返回处理文档数。"""
        st = self.store.load_settings()
        if st.embed_version >= EMBED_VERSION:
            return 0
        docs = self.store.list_docs()
        for d in docs:
            chunks = sorted((c for c in self.store.list_chunks()
                             if c.doc_id == d.id), key=lambda c: c.idx)
            if chunks:
                self._replace_chunks(d.id, [c.text for c in chunks])
        st = st.model_copy(update={"embed_version": EMBED_VERSION})
        self.store.save_settings(st)
        return len(docs)

    # ---- 记忆 ----
    def list_memories(self) -> list[MemoryItem]:
        return sorted(self.store.list_memories(), key=lambda m: -m.created_at)

    def add_memory(self, content: str, source: str = "manual",
                   session_id: str | None = None) -> MemoryItem:
        item = MemoryItem(id=new_id("mem"), content=content.strip(),
                          source=source, session_id=session_id,
                          created_at=now_ms(), updated_at=now_ms())
        items = self.store.list_memories()
        items.append(item)
        self.store.save_memories(items)
        return item

    def update_memory(self, mid: str, content: str) -> MemoryItem | None:
        items = self.store.list_memories()
        for i, m in enumerate(items):
            if m.id == mid:
                items[i] = m.model_copy(update={"content": content.strip(),
                                                "updated_at": now_ms()})
                self.store.save_memories(items)
                return items[i]
        return None

    def delete_memory(self, mid: str) -> bool:
        items = self.store.list_memories()
        rest = [m for m in items if m.id != mid]
        if len(rest) == len(items):
            return False
        self.store.save_memories(rest)
        return True

    def memory_context(self, limit: int = 20) -> str:
        mems = self.list_memories()[:limit]
        if not mems:
            return ""
        lines = "\n".join(f"- {m.content}" for m in mems)
        return f"## 长期记忆（用户主动保存的信息）\n\n{lines}"

    # ---- 文档 ----
    def ensure_default_kb(self) -> str:
        """保证存在「默认知识库」，返回其 id。旧文档自动归入。"""
        kbs = self.store.list_kbs()
        if kbs:
            return kbs[0].id
        kb = KnowledgeBase(id=new_id("kb"), name="默认知识库",
                            description="上传文档自动归入这里",
                            created_at=now_ms())
        self.store.save_kbs([kb])
        # 旧文档（无 kb_id）归入默认库
        docs = self.store.list_docs()
        changed = False
        for i, d in enumerate(docs):
            if not d.kb_id:
                docs[i] = d.model_copy(update={"kb_id": kb.id})
                changed = True
        if changed:
            self.store.save_docs(docs)
        return kb.id

    def list_kbs(self) -> list[dict[str, Any]]:
        """知识库列表（带文档数/大小统计）。"""
        self.ensure_default_kb()
        docs = self.store.list_docs()
        out = []
        for kb in sorted(self.store.list_kbs(), key=lambda k: k.created_at):
            kd = [d for d in docs if d.kb_id == kb.id]
            out.append({
                **kb.model_dump(),
                "doc_count": len(kd),
                "total_size": sum(d.size for d in kd),
                "total_chunks": sum(d.chunks for d in kd),
            })
        return out

    def create_kb(self, name: str, description: str = "") -> KnowledgeBase:
        if not name.strip():
            raise ValueError("名称不能为空")
        kb = KnowledgeBase(id=new_id("kb"), name=name.strip(),
                            description=description.strip(), created_at=now_ms())
        kbs = self.store.list_kbs()
        kbs.append(kb)
        self.store.save_kbs(kbs)
        return kb

    def update_kb(self, kb_id: str, name: str,
                   description: str = "") -> KnowledgeBase | None:
        kbs = self.store.list_kbs()
        for i, kb in enumerate(kbs):
            if kb.id == kb_id:
                kbs[i] = kb.model_copy(update={"name": name.strip() or kb.name,
                                                  "description": description})
                self.store.save_kbs(kbs)
                return kbs[i]
        return None

    def delete_kb(self, kb_id: str, with_docs: bool = True) -> bool:
        """删除知识库；with_docs=True 连同文档与分块。"""
        kbs = self.store.list_kbs()
        rest = [k for k in kbs if k.id != kb_id]
        if len(rest) == len(kbs):
            return False
        if with_docs:
            docs = self.store.list_docs()
            doc_ids = {d.id for d in docs if d.kb_id == kb_id}
            self.store.save_docs([d for d in docs if d.id not in doc_ids])
            self.store.save_chunks([c for c in self.store.list_chunks()
                                     if c.doc_id not in doc_ids])
        else:
            docs = self.store.list_docs()
            # 兜底库：剩余库中最早的；没有剩余库则重建默认库
            fallback = min((k for k in rest), key=lambda k: k.created_at,
                           default=None)
            if fallback is None:
                fallback_id = self.ensure_default_kb()
            else:
                fallback_id = fallback.id
            moved = [d.model_copy(update={"kb_id": fallback_id})
                     for d in docs if d.kb_id == kb_id]
            keep = [d for d in docs if d.kb_id != kb_id]
            self.store.save_docs(keep + moved)
        self.store.save_kbs(rest)
        return True

    def add_doc(self, filename: str, mime: str, data: bytes,
                kb_id: str | None = None) -> DocFile:
        text = extract_text(filename, mime, data)
        pieces = chunk_text(text)
        if not pieces:
            raise ValueError("文档中没有可提取的文本")
        if not kb_id:
            kb_id = self.ensure_default_kb()
        doc = DocFile(id=new_id("doc"), name=filename, kb_id=kb_id, mime=mime,
                      size=len(data), chunks=len(pieces),
                      text=text, created_at=now_ms())
        chunks = [DocChunk(id=new_id("chk"), doc_id=doc.id, idx=i,
                           text=p, vector=embed(p))
                  for i, p in enumerate(pieces)]
        docs = self.store.list_docs()
        docs.append(doc)
        self.store.save_docs(docs)
        all_chunks = self.store.list_chunks()
        all_chunks.extend(chunks)
        self.store.save_chunks(all_chunks)
        return doc

    def delete_doc(self, doc_id: str) -> bool:
        docs = self.store.list_docs()
        rest = [d for d in docs if d.id != doc_id]
        if len(rest) == len(docs):
            return False
        self.store.save_docs(rest)
        self.store.save_chunks([c for c in self.store.list_chunks()
                                if c.doc_id != doc_id])
        return True

    # ---- 文档查看 / 编辑 ----
    def _save_docs(self, docs: list[DocFile]) -> None:
        self.store.save_docs(docs)

    def get_doc(self, doc_id: str) -> dict[str, Any] | None:
        """全文 + 分段列表。旧文档没有 text 时从分段惰性重建。"""
        doc = next((d for d in self.store.list_docs() if d.id == doc_id), None)
        if not doc:
            return None
        chunks = sorted((c for c in self.store.list_chunks()
                         if c.doc_id == doc_id), key=lambda c: c.idx)
        text = doc.text
        if not text and chunks:
            text = "\n".join(c.text for c in chunks)
            doc = doc.model_copy(update={"text": text})
            docs = self.store.list_docs()
            for i, d in enumerate(docs):
                if d.id == doc_id:
                    docs[i] = doc
                    break
            self._save_docs(docs)
        return {"doc": doc.model_dump(),
                "chunks": [{"id": c.id, "idx": c.idx, "text": c.text,
                            "chars": len(c.text)} for c in chunks]}

    def _replace_chunks(self, doc_id: str, pieces: list[str]) -> int:
        """重建文档全部分块并向量化，返回新分块数。"""
        chunks = [DocChunk(id=new_id("chk"), doc_id=doc_id, idx=i,
                            text=p, vector=embed(p))
                  for i, p in enumerate(pieces)]
        all_chunks = [c for c in self.store.list_chunks() if c.doc_id != doc_id]
        all_chunks.extend(chunks)
        self.store.save_chunks(all_chunks)
        return len(chunks)

    def update_doc_text(self, doc_id: str, text: str) -> DocFile | None:
        """全文编辑：整篇重新分块 + 向量化。"""
        doc = next((d for d in self.store.list_docs() if d.id == doc_id), None)
        if not doc:
            return None
        pieces = chunk_text(text)
        if not pieces:
            raise ValueError("编辑后的文档没有可提取的文本")
        n = self._replace_chunks(doc_id, pieces)
        doc = doc.model_copy(update={"text": text, "chunks": n,
                                      "size": len(text.encode("utf-8"))})
        docs = self.store.list_docs()
        for i, d in enumerate(docs):
            if d.id == doc_id:
                docs[i] = doc
                break
        self._save_docs(docs)
        return doc

    def update_chunk_text(self, doc_id: str, chunk_id: str,
                          text: str) -> dict[str, Any] | None:
        """分段编辑：只重嵌该段；同步拼接回全文（保持其它段不变）。"""
        doc = next((d for d in self.store.list_docs() if d.id == doc_id), None)
        if not doc:
            return None
        chunks = sorted((c for c in self.store.list_chunks()
                         if c.doc_id == doc_id), key=lambda c: c.idx)
        target = next((c for c in chunks if c.id == chunk_id), None)
        if not target:
            return None
        text = text.strip()
        all_chunks = self.store.list_chunks()
        if text:
            vec = embed(text)
            for i, c in enumerate(all_chunks):
                if c.id == chunk_id:
                    all_chunks[i] = c.model_copy(update={"text": text,
                                                          "vector": vec})
                    break
        else:  # 清空即删除该段
            all_chunks = [c for c in all_chunks if c.id != chunk_id]
        self.store.save_chunks(all_chunks)
        # 全文 = 各段按序拼接（段间补换行）
        kept = sorted((c for c in all_chunks if c.doc_id == doc_id),
                      key=lambda c: c.idx)
        # 删除段后重排 idx
        if len(kept) != len(chunks):
            for j, c in enumerate(kept):
                for i, x in enumerate(all_chunks):
                    if x.id == c.id:
                        all_chunks[i] = x.model_copy(update={"idx": j})
                        break
            self.store.save_chunks(all_chunks)
        new_text = "\n".join(c.text for c in kept)
        doc = doc.model_copy(update={"text": new_text,
                                      "chunks": len(kept),
                                      "size": len(new_text.encode("utf-8"))})
        docs = self.store.list_docs()
        for i, d in enumerate(docs):
            if d.id == doc_id:
                docs[i] = doc
                break
        self._save_docs(docs)
        return {"doc": doc.model_dump(), "chunk_count": len(kept)}

    def search(self, query: str, top_k: int = 4,
               doc_ids: list[str] | None = None,
               kb_ids: list[str] | None = None) -> list[dict[str, Any]]:
        qv = embed(query)
        docs = {d.id: d for d in self.store.list_docs()}
        if kb_ids is not None:
            docs = {k: v for k, v in docs.items() if v.kb_id in set(kb_ids)}
        if doc_ids is not None:
            docs = {k: v for k, v in docs.items() if k in set(doc_ids)}
        scored = []
        for c in self.store.list_chunks():
            d = docs.get(c.doc_id)
            if not d:
                continue
            scored.append((cosine(qv, c.vector), c, d))
        scored.sort(key=lambda x: -x[0])
        out = []
        for score, c, d in scored[:top_k]:
            if score < 0.05:  # 相关性太低的丢掉
                continue
            out.append({"doc_id": d.id, "doc_name": d.name,
                        "chunk_id": c.id, "score": round(score, 4),
                        "text": c.text[:600]})
        return out

    def rag_context(self, query: str, top_k: int = 4,
                    doc_ids: list[str] | None = None,
                    kb_ids: list[str] | None = None,
                    trace: list[dict] | None = None) -> str:
        """检索并拼装上下文；trace 非 None 时写入检索过程日志（用时/输入/输出）。"""
        t0 = time.time()
        hits = self.search(query, top_k, doc_ids=doc_ids, kb_ids=kb_ids)
        elapsed = int((time.time() - t0) * 1000)
        if trace is not None:
            kb_names = {k.id: k.name for k in self.store.list_kbs()}
            scope = [kb_names.get(x, x) for x in kb_ids] if kb_ids is not None else None
            trace.append({
                "kind": "rag", "name": "知识检索", "server": "知识库",
                "ok": True, "elapsed_ms": elapsed,
                "input": {"query": query, "top_k": top_k,
                           "知识库范围": scope},
                "output": {"命中数": len(hits),
                            "片段": [f"《{h['doc_name']}》 {h['score']}"
                                       for h in hits]} if hits else {"命中数": 0},
            })
        if not hits:
            return ""
        blocks = []
        for i, h in enumerate(hits, 1):
            blocks.append(f"[{i}] 来自文档《{h['doc_name']}》（相关度 {h['score']}）\n{h['text']}")
        return ("## 文档知识库检索结果（回答时可引用，并注明来源）\n\n"
                + "\n\n".join(blocks))


class TaskScheduler:
    """定时任务：asyncio 循环驱动（lifespan 启动）。"""

    def __init__(self, store, session_manager, chat_engine) -> None:
        self.store = store
        self.sessions = session_manager
        self.engine = chat_engine
        self._task: asyncio.Task | None = None
        self._running = False

    # ---- 计划 ----
    @staticmethod
    def compute_next_run(t: ScheduledTask, from_ms: int | None = None) -> int:
        base = from_ms or now_ms()
        if t.kind == "interval":
            return base + max(1, t.interval_minutes) * 60_000
        # daily：今天的 HH:MM，过期则明天
        dt = datetime.fromtimestamp(base / 1000)
        hh, mm = (t.daily_at or "09:00").split(":")[:2]
        target = dt.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
        if target.timestamp() * 1000 <= base:
            target += timedelta(days=1)
        return int(target.timestamp() * 1000)

    def recompute_next(self, t: ScheduledTask) -> None:
        t.next_run = self.compute_next_run(t) if t.enabled else None

    # ---- CRUD ----
    def list(self) -> list[ScheduledTask]:
        return sorted(self.store.list_tasks(), key=lambda t: -t.created_at)

    def get(self, tid: str) -> ScheduledTask | None:
        return next((t for t in self.store.list_tasks() if t.id == tid), None)

    def create(self, name: str, prompt: str, session_id: str, kind: str,
               interval_minutes: int = 60, daily_at: str = "09:00",
               enabled: bool = True) -> ScheduledTask:
        if not session_manager_has(self.sessions, session_id):
            raise ValueError("目标会话不存在")
        t = ScheduledTask(id=new_id("task"), name=name.strip(), prompt=prompt.strip(),
                          session_id=session_id, kind=kind,  # type: ignore[arg-type]
                          interval_minutes=max(1, int(interval_minutes)),
                          daily_at=daily_at, enabled=enabled,
                          created_at=now_ms())
        self.recompute_next(t)
        tasks = self.store.list_tasks()
        tasks.append(t)
        self.store.save_tasks(tasks)
        return t

    def update(self, tid: str, **fields) -> ScheduledTask | None:
        tasks = self.store.list_tasks()
        for i, t in enumerate(tasks):
            if t.id == tid:
                data = t.model_dump()
                for k, v in fields.items():
                    if v is not None and k in data:
                        data[k] = v
                nt = ScheduledTask(**data)
                self.recompute_next(nt)
                tasks[i] = nt
                self.store.save_tasks(tasks)
                return nt
        return None

    def delete(self, tid: str) -> bool:
        tasks = self.store.list_tasks()
        rest = [t for t in tasks if t.id != tid]
        if len(rest) == len(tasks):
            return False
        self.store.save_tasks(rest)
        return True

    # ---- 执行 ----
    async def run_task(self, t: ScheduledTask) -> str:
        """把任务 prompt 作为用户消息发给目标会话（真实 LLM 或 mock）。"""
        session = self.sessions.get(t.session_id)
        if not session:
            return "目标会话不存在"
        result: list[str] = []

        async def _consume():
            async for ev in self.engine.stream_chat(session, t.prompt):
                if ev["event"] == "delta":
                    result.append(str(ev["data"]))
                elif ev["event"] == "done":
                    result.clear()
                    result.append("(已落库)")

        try:
            await asyncio.wait_for(_consume(), timeout=180)
            ok = True
            text = "(回复已写入会话)" if result and result[0] == "(已落库)" \
                else "".join(result)[:200]
            # done 事件清空后重放内容 -> 简化：直接读最后一条 assistant 消息
            msgs = self.sessions.messages(t.session_id)
            last_asst = next((m for m in reversed(msgs) if m.role == "assistant"), None)
            if last_asst:
                text = last_asst.content[:200]
        except Exception as e:
            ok = False
            text = f"{type(e).__name__}: {str(e)[:150]}"
        # 更新运行记录
        tasks = self.store.list_tasks()
        for i, x in enumerate(tasks):
            if x.id == t.id:
                tasks[i].last_run = now_ms()
                tasks[i].run_count += 1
                tasks[i].last_ok = ok
                tasks[i].last_result = text
                self.recompute_next(tasks[i])
                self.store.save_tasks(tasks)
                break
        return text

    # ---- 调度循环 ----
    async def _loop(self) -> None:
        while self._running:
            try:
                now = now_ms()
                for t in self.store.list_tasks():
                    if t.enabled and t.next_run and t.next_run <= now:
                        await self.run_task(t)
            except Exception:
                pass
            await asyncio.sleep(5)

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        # 启动时给没有 next_run 的任务补齐
        tasks = self.store.list_tasks()
        changed = False
        for t in tasks:
            if t.enabled and not t.next_run:
                self.recompute_next(t)
                changed = True
        if changed:
            self.store.save_tasks(tasks)
        self._task = asyncio.get_running_loop().create_task(self._loop())

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()


def session_manager_has(sm, sid: str) -> bool:
    return sm.get(sid) is not None
