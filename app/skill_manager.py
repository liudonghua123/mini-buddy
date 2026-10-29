"""SkillManager：技能的安装、启停、删除、版本化。

技能是一个目录，含 SKILL.md（YAML frontmatter + 正文指令）与可选附属文件。
- 本地文件系统存储：skills_runtime/<slug>/
- 版本化：每次写文件前把改动文件快照到 .versions/<n>/，可查看历史、回滚
- 种子技能：首次启动生成 4 个演示技能
- zip 安装：解压到 skills/，防 zip-slip
- 新建：手动创建
"""
from __future__ import annotations

import io
import json
import os
import re
import shutil
import zipfile

from .models import SkillManifest, new_id, now_ms, slugify

VERSIONS_DIR = ".versions"
MAX_VERSIONS = 30  # 每个技能最多保留的版本数

SEED_SKILLS: list[dict] = [
    {
        "slug": "meeting-notes",
        "name": "会议纪要",
        "description": "把零散的讨论记录整理成结构化会议纪要：决议、待办、负责人。",
        "instructions": (
            "把用户给的会议内容整理为三段：\n"
            "1. 【决议】一句话列出达成的事项\n"
            "2. 【待办】表格：事项 | 负责人 | 截止\n"
            "3. 【遗留】未决问题\n"
            "不要添加会议里没有的信息。"
        ),
    },
    {
        "slug": "code-review",
        "name": "代码评审",
        "description": "按正确性、可读性、边界情况三步审查代码并给出修复建议。",
        "instructions": (
            "评审代码时依次检查：\n"
            "1. 正确性：逻辑错误、边界条件\n"
            "2. 可读性：命名、结构\n"
            "3. 风险：异常、并发、资源泄漏\n"
            "每条问题给出最小修复代码。最后按 1-5 打分。"
        ),
    },
    {
        "slug": "translator",
        "name": "中英互译",
        "description": "在中文与英文之间自然互译，保留术语原文。",
        "instructions": (
            "翻译时保持自然流畅而非逐字直译；\n"
            "专有名词首次出现时在括号里保留原文；\n"
            "用户给中文就译成英文，给英文就译成中文。"
        ),
    },
    {
        "slug": "charts-mermaid",
        "name": "Mermaid 图表",
        "description": "用 Mermaid 画流程图、时序图、甘特图，输出可在聊天中直接渲染的图表。",
        "instructions": (
            "用户需要结构图、流程图、时序图、甘特图时，用 Mermaid 绘制。\n\n"
            "## 输出格式（必须严格遵守）\n"
            "- 图表必须放在 ```mermaid 围栏代码块中，前端会把该代码块渲染成图。\n"
            "- 代码块内只写 Mermaid 语法，不要混入解释文字或注释。\n"
            "- 首行必须是图表类型声明，如 `graph TD`、`graph LR`、`sequenceDiagram`、`gantt`。\n"
            "- 节点文字可含中文；含括号等特殊字符时用引号包裹，如 `A[\"开始 (Start)\"]`。\n"
            "- 代码块外面用一两句话简要说明图表内容。\n\n"
            "## 常用语法\n"
            "- 流程图：`graph TD` 纵向 / `graph LR` 横向；节点形状 `A[矩形]`、`B(圆角)`、`C{菱形判断}`；连线 `A --> B`、`A -- 标签 --> B`。\n"
            "- 时序图：`sequenceDiagram`；`participant A as 别名`；实线 `A->>B: 消息`，虚线返回 `B-->>A: 响应`。\n"
            "- 甘特图：`gantt`；`dateFormat YYYY-MM-DD`；`section 阶段名` 分组；`任务名 :a1, 2026-01-01, 7d`。\n\n"
            "## 完整示例\n"
            "用户说「画一个下单流程」，你应该回复：\n\n"
            "下单流程如下，从浏览商品到发货共 6 步，含库存判断分支：\n\n"
            "```mermaid\n"
            "graph TD\n"
            "    A[浏览商品] --> B[加入购物车]\n"
            "    B --> C{库存充足?}\n"
            "    C -- 是 --> D[提交订单]\n"
            "    C -- 否 --> E[缺货提醒]\n"
            "    D --> F[支付]\n"
            "    F --> G[发货]\n"
            "```\n\n"
            "严禁把 Mermaid 代码放进普通 ``` 代码块（那样只会显示为纯文本，无法渲染成图）。"
        ),
    },
    {
        "slug": "charts-echarts",
        "name": "ECharts 图表",
        "description": "用 ECharts 画柱状图、折线图、饼图，输出可在聊天中直接渲染的 option JSON。",
        "instructions": (
            "用户需要数据图表（柱状图、折线图、饼图等）时，用 ECharts 绘制。\n\n"
            "## 输出格式（必须严格遵守）\n"
            "- 图表必须放在 ```echarts 围栏代码块中，前端会把该代码块渲染成图。\n"
            "- 代码块内容是**一个完整的 ECharts option JSON 对象**：不要写 `option =`、不要注释、JSON 外不要任何文字。\n"
            "- JSON 必须合法：键和字符串都用双引号，无尾逗号。\n"
            "- 柱状图/折线图必须有 `xAxis`（category）+ `yAxis`（value）+ `series`；饼图在 `series` 里用 type=pie 和 {name, value} 数据。\n"
            "- 可加 `title`、`tooltip`、`legend` 增强可读性。\n"
            "- 代码块外面用一两句话解读数据结论。\n\n"
            "## 完整示例\n"
            "用户说「画个柱状图看近四周销量」，你应该回复：\n\n"
            "近四周销量逐周上升，第 4 周达到峰值 320 件：\n\n"
            "```echarts\n"
            "{\n"
            "  \"title\": { \"text\": \"近四周销量（件）\" },\n"
            "  \"tooltip\": {},\n"
            "  \"xAxis\": { \"type\": \"category\", \"data\": [\"第1周\", \"第2周\", \"第3周\", \"第4周\"] },\n"
            "  \"yAxis\": { \"type\": \"value\" },\n"
            "  \"series\": [{ \"type\": \"bar\", \"data\": [180, 220, 260, 320] }]\n"
            "}\n"
            "```\n\n"
            "严禁把 option JSON 放进普通 ``` 代码块（那样只会显示为纯文本，无法渲染成图）。"
        ),
    },
    {
        "slug": "weekly-report",
        "name": "周报生成",
        "description": "把一周的碎片记录汇总成一页周报：进展、数据、风险、下周计划。",
        "instructions": (
            "生成周报的固定结构：\n"
            "## 本周进展\n3-5 条，动词开头\n"
            "## 关键数据\n有数字就列，没有写「无量化数据」\n"
            "## 风险与阻塞\n每条附应对\n"
            "## 下周计划\n最多 5 条"
        ),
    },
]

FRONT_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.S)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """解析 SKILL.md 的 YAML frontmatter（手工解析 name/description/version）。"""
    m = FRONT_RE.match(text)
    meta: dict = {}
    body = text
    if m:
        raw = m.group(1)
        body = text[m.end():]
        for line in raw.splitlines():
            if ":" in line:
                k, _, v = line.partition(":")
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k in {"name", "description", "version"}:
                    meta[k] = v
    return meta, body.strip()


class SkillManager:
    def __init__(self, store, base_dir: str) -> None:
        self.store = store
        self.base = base_dir
        os.makedirs(base_dir, exist_ok=True)

    # ---- 目录辅助 ----
    def _dir(self, slug: str) -> str:
        safe = slugify(slug)
        return os.path.join(self.base, safe)

    def _versions_dir(self, slug: str) -> str:
        return os.path.join(self._dir(slug), VERSIONS_DIR)

    def read_skill_md(self, slug: str) -> str:
        p = os.path.join(self._dir(slug), "SKILL.md")
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                return f.read()
        return ""

    def _write_skill_md(self, slug: str, name: str, description: str, version: str, instructions: str) -> None:
        d = self._dir(slug)
        os.makedirs(d, exist_ok=True)
        content = (
            "---\n"
            f"name: {name}\n"
            f"description: {description}\n"
            f"version: {version}\n"
            "---\n\n" + instructions.strip() + "\n"
        )
        with open(os.path.join(d, "SKILL.md"), "w", encoding="utf-8") as f:
            f.write(content)

    def _list_files(self, slug: str) -> list[str]:
        d = self._dir(slug)
        if not os.path.isdir(d):
            return []
        out: list[str] = []
        for root, dirs, files in os.walk(d):
            dirs[:] = [x for x in dirs if x != VERSIONS_DIR]  # 版本目录不算技能文件
            for fn in files:
                rel = os.path.relpath(os.path.join(root, fn), d)
                out.append(rel.replace("\\", "/"))
        return sorted(out)

    # ---- 种子 ----
    def seed_if_empty(self) -> None:
        """首次启动写入全部种子技能；已有数据时增量补装缺失的内置技能。"""
        existing = {s.slug for s in self.store.list_skills()}
        skills = []
        for s in SEED_SKILLS:
            if s["slug"] in existing:
                continue
            self._write_skill_md(s["slug"], s["name"], s["description"], "0.1.0", s["instructions"])
            skills.append(SkillManifest(
                slug=s["slug"], name=s["name"], description=s["description"],
                source="builtin", instructions=s["instructions"],
                files=self._list_files(s["slug"]), created_at=now_ms(),
            ))
        if skills:
            self.store.save_skills(self.store.list_skills() + skills)

    # ---- CRUD ----
    def list_skills(self) -> list[SkillManifest]:
        return self.store.list_skills()

    def get(self, slug: str) -> SkillManifest | None:
        for s in self.store.list_skills():
            if s.slug == slug:
                return s
        return None

    def create(self, name: str, description: str, instructions: str) -> SkillManifest:
        slug = slugify(name)
        if self.get(slug):
            raise ValueError(f"技能已存在: {slug}")
        self._write_skill_md(slug, name, description, "0.1.0", instructions)
        m = SkillManifest(
            slug=slug, name=name, description=description, source="manual",
            instructions=instructions, files=self._list_files(slug), created_at=now_ms(),
        )
        skills = self.store.list_skills()
        skills.append(m)
        self.store.save_skills(skills)
        return m

    def update(self, slug: str, name: str, description: str, instructions: str) -> SkillManifest:
        skills = self.store.list_skills()
        for s in skills:
            if s.slug == slug:
                s.name = name
                s.description = description
                s.instructions = instructions
                self._write_skill_md(slug, name, description, s.version, instructions)
                s.files = self._list_files(slug)
                self.store.save_skills(skills)
                return s
        raise ValueError(f"技能不存在: {slug}")

    def set_enabled(self, slug: str, enabled: bool) -> SkillManifest:
        skills = self.store.list_skills()
        for s in skills:
            if s.slug == slug:
                s.enabled = enabled
                self.store.save_skills(skills)
                return s
        raise ValueError(f"技能不存在: {slug}")

    def delete(self, slug: str) -> None:
        skills = self.store.list_skills()
        skills = [s for s in skills if s.slug != slug]
        self.store.save_skills(skills)
        d = self._dir(slug)
        if os.path.isdir(d):
            shutil.rmtree(d, ignore_errors=True)

    # ---- zip 安装 ----
    def install_zip(self, data: bytes, filename: str) -> SkillManifest:
        zf = zipfile.ZipFile(io.BytesIO(data))
        # 找 SKILL.md 所在的根目录（兼容 zip 里多包一层目录的情况）
        names = zf.namelist()
        skill_md_path = None
        for n in names:
            if n.endswith("SKILL.md") and n.count("/") <= 1:
                skill_md_path = n
                break
        if not skill_md_path:
            raise ValueError("zip 中未找到 SKILL.md")
        root = os.path.dirname(skill_md_path)  # 可能为空

        # 先读 SKILL.md 拿到名字 -> slug
        meta_raw = zf.read(skill_md_path).decode("utf-8", errors="replace")
        meta, body = parse_frontmatter(meta_raw)
        name = meta.get("name") or os.path.splitext(filename)[0]
        slug = slugify(name)
        if self.get(slug):
            raise ValueError(f"技能已存在: {slug}")

        dest = self._dir(slug)
        os.makedirs(dest, exist_ok=True)
        # 防 zip-slip：只解包 root 下的文件
        for n in names:
            if n.endswith("/"):
                continue
            rel = os.path.relpath(n, root) if root else n
            rel = rel.replace("\\", "/")
            if rel.startswith("..") or os.path.isabs(rel):
                continue
            target = os.path.join(dest, rel)
            if not os.path.abspath(target).startswith(os.path.abspath(dest)):
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with zf.open(n) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)

        m = SkillManifest(
            slug=slug, name=name, description=meta.get("description", ""),
            version=meta.get("version", "0.1.0"), source="zip",
            instructions=body, files=self._list_files(slug), created_at=now_ms(),
        )
        skills = self.store.list_skills()
        skills.append(m)
        self.store.save_skills(skills)
        return m

    # ---- 版本化 ----
    """写入前快照。version_note 记录这次保存的说明。"""

    def snapshot_before_write(self, slug: str, rel_paths: list[str], note: str = "") -> int | None:
        """写文件前调用：把将被覆盖的文件（当前内容）快照为一个新版本。
        rel_paths: 即将写入的相对路径列表；不存在于磁盘的跳过（新建文件无旧版可存）。
        返回版本号；没有任何可快照文件（全是新建）时返回 None 不建版本。
        """
        d = self._dir(slug)
        if not os.path.isdir(d):
            return None
        existing = [r for r in rel_paths if os.path.isfile(os.path.join(d, r))]
        if not existing:
            return None
        vdir = self._versions_dir(slug)
        os.makedirs(vdir, exist_ok=True)
        n = self._next_version_num(slug)
        vpath = os.path.join(vdir, str(n))
        os.makedirs(vpath, exist_ok=True)
        for rel in existing:
            target = os.path.join(vpath, rel)
            os.makedirs(os.path.dirname(target) or vpath, exist_ok=True)
            shutil.copy2(os.path.join(d, rel), target)
        with open(os.path.join(vpath, "_meta.json"), "w", encoding="utf-8") as f:
            json.dump({"n": n, "ts": now_ms(), "files": existing, "note": note}, f, ensure_ascii=False)
        self._prune_versions(slug)
        return n

    def _next_version_num(self, slug: str) -> int:
        vdir = self._versions_dir(slug)
        nums = [int(x) for x in os.listdir(vdir) if x.isdigit()]
        return (max(nums) + 1) if nums else 1

    def _prune_versions(self, slug: str) -> None:
        vdir = self._versions_dir(slug)
        if not os.path.isdir(vdir):
            return
        nums = sorted(int(x) for x in os.listdir(vdir) if x.isdigit())
        for n in nums[:-MAX_VERSIONS]:
            shutil.rmtree(os.path.join(vdir, str(n)), ignore_errors=True)

    def list_versions(self, slug: str) -> list[dict]:
        """版本列表（新→旧）：[{n, ts, files, note}]。"""
        vdir = self._versions_dir(slug)
        if not os.path.isdir(vdir):
            return []
        out: list[dict] = []
        for x in os.listdir(vdir):
            if not x.isdigit():
                continue
            meta_path = os.path.join(vdir, x, "_meta.json")
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    out.append(json.load(f))
            except Exception:
                out.append({"n": int(x), "ts": 0, "files": [], "note": ""})
        out.sort(key=lambda v: -v.get("n", 0))
        return out

    def read_version_file(self, slug: str, n: int, rel: str) -> str | None:
        p = os.path.join(self._versions_dir(slug), str(n), rel)
        if not os.path.isfile(p):
            return None
        with open(p, "r", encoding="utf-8") as f:
            return f.read()

    def rollback(self, slug: str, n: int) -> dict:
        """把版本 n 的全部文件覆盖回工作区（回滚前先把当前状态快照成新版本）。"""
        vpath = os.path.join(self._versions_dir(slug), str(n))
        meta_path = os.path.join(vpath, "_meta.json")
        if not os.path.isfile(meta_path):
            raise ValueError(f"版本不存在: {n}")
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        d = self._dir(slug)
        # 回滚前先快照当前内容，防丢失
        self.snapshot_before_write(slug, meta.get("files", []), note=f"回滚到 v{n} 前的自动保存")
        restored: list[str] = []
        for rel in meta.get("files", []):
            src = os.path.join(vpath, rel)
            if not os.path.isfile(src):
                continue
            target = os.path.join(d, rel)
            os.makedirs(os.path.dirname(target) or d, exist_ok=True)
            shutil.copy2(src, target)
            restored.append(rel)
        # SKILL.md 被回滚则同步 manifest
        if any(r.lower() == "skill.md" for r in restored):
            with open(os.path.join(d, "SKILL.md"), "r", encoding="utf-8") as f:
                meta2, instr = parse_frontmatter(f.read())
            skills = self.store.list_skills()
            for s in skills:
                if s.slug == slug:
                    s.name = meta2.get("name", s.name)
                    s.description = meta2.get("description", s.description)
                    s.instructions = instr
                    if meta2.get("version"):
                        s.version = meta2["version"]
            self.store.save_skills(skills)
        skills = self.store.list_skills()
        for s in skills:
            if s.slug == slug:
                s.files = self._list_files(slug)
        self.store.save_skills(skills)
        return {"restored": restored, "count": len(restored)}
