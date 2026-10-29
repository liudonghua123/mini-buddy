"""内置演示 MCP 服务器（基于 FastMCP 进程内实例）。

四个内置服务器演示了 MCP 的工具能力，无需外部进程即可体验：
- clock: 时间工具
- calc: 安全表达式计算器
- echo: 回声/文本工具
- dice: 随机工具
"""
from __future__ import annotations

import ast
import math
import random
from datetime import datetime, timedelta, timezone

from fastmcp import FastMCP

# ---- 工具实现（供内置服务器注册） ----


def _safe_eval(expr: str) -> float:
    """ast 白名单表达式求值，不接触 eval。"""
    node = ast.parse(expr.strip(), mode="eval")
    allowed_funcs = {
        "sqrt": math.sqrt, "abs": abs, "round": round,
        "min": min, "max": max, "pow": pow,
        "sin": math.sin, "cos": math.cos, "tan": math.tan,
        "log": math.log, "log10": math.log10, "floor": math.floor, "ceil": math.ceil,
    }
    allowed_names = {"pi": math.pi, "e": math.e, "tau": math.tau}

    def ev(n: ast.AST) -> float:
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return float(n.value)
        if isinstance(n, ast.BinOp) and type(n.op) in {ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.FloorDiv}:
            a, b = ev(n.left), ev(n.right)
            if isinstance(n.op, ast.Add):
                return a + b
            if isinstance(n.op, ast.Sub):
                return a - b
            if isinstance(n.op, ast.Mult):
                return a * b
            if isinstance(n.op, ast.Div):
                return a / b
            if isinstance(n.op, ast.Pow):
                return a ** b
            if isinstance(n.op, ast.Mod):
                return a % b
            return a // b
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.USub, ast.UAdd)):
            v = ev(n.operand)
            return -v if isinstance(n.op, ast.USub) else v
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in allowed_funcs:
            return float(allowed_funcs[n.func.id](*[ev(a) for a in n.args]))
        if isinstance(n, ast.Name) and n.id in allowed_names:
            return allowed_names[n.id]
        raise ValueError(f"不支持的表达式元素: {ast.dump(n)[:60]}")

    return ev(node)


# ---- 内置服务器 ----


def build_clock_server() -> FastMCP:
    mcp = FastMCP("clock")

    @mcp.tool
    def now(tz_offset_hours: int = 8) -> str:
        """返回当前时间。tz_offset_hours 为 UTC 偏移小时数，默认 +8（北京时间）。"""
        tz = timezone(timedelta(hours=tz_offset_hours))
        return datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S %Z")

    @mcp.tool
    def days_until(date: str) -> int:
        """计算今天到目标日期（YYYY-MM-DD）还有多少天。"""
        target = datetime.strptime(date, "%Y-%m-%d").date()
        return (target - datetime.now().date()).days

    return mcp


def build_calc_server() -> FastMCP:
    mcp = FastMCP("calc")

    @mcp.tool
    def calculate(expression: str) -> float:
        """计算一个数学表达式，支持 + - * / ** % 与 sqrt/abs/round/min/max/pi 等。"""
        return _safe_eval(expression)

    return mcp


def build_echo_server() -> FastMCP:
    mcp = FastMCP("echo")

    @mcp.tool
    def echo(text: str) -> str:
        """原样返回输入文本。"""
        return text

    @mcp.tool
    def shout(text: str) -> str:
        """把文本转成大写并加感叹号。"""
        return text.upper() + "!"

    return mcp


def build_dice_server() -> FastMCP:
    mcp = FastMCP("dice")

    @mcp.tool
    def roll(sides: int = 6, times: int = 1) -> str:
        """掷一个 sides 面的骰子 times 次，返回结果序列。"""
        rolls = [random.randint(1, max(2, sides)) for _ in range(min(20, max(1, times)))]
        return ", ".join(str(r) for r in rolls)

    @mcp.tool
    def flip() -> str:
        """抛一次硬币，返回正面或反面。"""
        return random.choice(["正面", "反面"])

    return mcp


# builtin_id -> (显示名, 描述, 工厂)
BUILTIN_SERVERS: dict[str, dict] = {
    "clock": {"name": "时钟 Clock", "desc": "当前时间与日期计算", "factory": build_clock_server},
    "calc": {"name": "计算器 Calc", "desc": "安全的数学表达式计算", "factory": build_calc_server},
    "echo": {"name": "回声 Echo", "desc": "文本回声演示", "factory": build_echo_server},
    "dice": {"name": "骰子 Dice", "desc": "随机数与抛硬币", "factory": build_dice_server},
}

_instances: dict[str, FastMCP] = {}


def get_builtin_instance(builtin_id: str) -> FastMCP:
    if builtin_id not in BUILTIN_SERVERS:
        raise KeyError(f"未知内置服务器: {builtin_id}")
    if builtin_id not in _instances:
        _instances[builtin_id] = BUILTIN_SERVERS[builtin_id]["factory"]()
    return _instances[builtin_id]
