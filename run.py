"""Mini Buddy 启动入口：uv run python run.py

监听地址/端口可用环境变量覆盖（云部署用）：
    HOST=0.0.0.0 PORT=8688 python run.py
"""
import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8688")),
        reload=False,
    )
