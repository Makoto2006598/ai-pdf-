"""
server.py —— FastAPI HTTP 服务

接口与 Cloudflare Worker 完全兼容：
  POST /api/convert
  Body:  { "provider": "local", "model": "<任意>", "text": "..." }
  Response: { "html": "..." } 或 { "error": "..." }

此外额外提供：
  GET  /api/status   —— 返回模型加载状态
  POST /api/load     —— 动态切换模型（供 GUI 调用）
"""

from __future__ import annotations

import re
import threading
from typing import Optional

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from model_manager import manager
from prompts import SYSTEM_PROMPT

app = FastAPI(title="llama-desktop proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)


# ── 请求/响应模型 ─────────────────────────────────────────────────────────────

class ConvertRequest(BaseModel):
    provider: str = "local"
    model:    str = "local"
    text:     str


class LoadRequest(BaseModel):
    model_path: str
    n_ctx:        int = 4096
    n_gpu_layers: int = -1


# ── 路由 ──────────────────────────────────────────────────────────────────────

@app.get("/api/status")
async def status():
    return {
        "loaded":      manager.is_loaded,
        "loading":     manager.is_loading,
        "model_path":  str(manager.loaded_path) if manager.loaded_path else None,
        "model_name":  manager.loaded_path.name if manager.loaded_path else None,
    }


@app.post("/api/load")
async def load_model(req: LoadRequest):
    if manager.is_loading:
        return JSONResponse({"error": "正在加载模型，请稍候"}, status_code=409)

    result: dict = {}
    event = threading.Event()

    def on_done(success: bool, msg: str):
        result["success"] = success
        result["message"] = msg
        event.set()

    manager.load_async(
        model_path=req.model_path,
        n_ctx=req.n_ctx,
        n_gpu_layers=req.n_gpu_layers,
        on_done=on_done,
    )
    event.wait(timeout=300)   # 最多等 5 分钟

    if not result:
        return JSONResponse({"error": "加载超时"}, status_code=504)
    if not result["success"]:
        return JSONResponse({"error": result["message"]}, status_code=500)
    return {"message": result["message"]}


@app.post("/api/convert")
async def convert(req: ConvertRequest):
    if not manager.is_loaded:
        if manager.is_loading:
            return JSONResponse({"error": "模型正在加载，请稍候"}, status_code=503)
        return JSONResponse({"error": "模型未加载，请先在桌面应用中选择模型文件"}, status_code=503)

    text = req.text.strip()
    if not text:
        return JSONResponse({"error": "text 不能为空"}, status_code=400)
    if len(text) > 8000:
        return JSONResponse(
            {"error": "笔记内容超出长度限制（最多 8000 字符），请分段处理"},
            status_code=413,
        )

    try:
        raw = manager.generate(
            system_prompt=SYSTEM_PROMPT,
            user_text=text,
        )
        # 清除部分模型返回的 markdown 代码块标记
        html = re.sub(r"^```html\s*", "", raw, flags=re.IGNORECASE)
        html = re.sub(r"\s*```$", "", html).strip()
        return {"html": html}
    except RuntimeError as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    except Exception as e:
        return JSONResponse({"error": f"生成失败：{e}"}, status_code=500)


# ── 服务器生命周期 ─────────────────────────────────────────────────────────────

_server_thread: Optional[threading.Thread] = None
_uvicorn_server: Optional[uvicorn.Server] = None


def start_server(host: str = "127.0.0.1", port: int = 8788) -> None:
    """在后台线程启动 uvicorn。"""
    global _server_thread, _uvicorn_server

    config = uvicorn.Config(app, host=host, port=port, log_level="warning")
    _uvicorn_server = uvicorn.Server(config)

    _server_thread = threading.Thread(
        target=_uvicorn_server.run,
        daemon=True,
        name="uvicorn",
    )
    _server_thread.start()


def stop_server() -> None:
    if _uvicorn_server:
        _uvicorn_server.should_exit = True


def is_server_running() -> bool:
    return _server_thread is not None and _server_thread.is_alive()
