"""Mini Buddy 启动入口：uv run python run.py"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8688, reload=False)
