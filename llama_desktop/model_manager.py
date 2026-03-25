"""
model_manager.py —— GGUF 模型文件扫描与加载

职责：
  - 在常见路径下扫描 .gguf 文件
  - 管理单例模型实例（避免重复加载）
  - 提供加载/卸载接口
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Callable, Optional

# llama-cpp-python 的导入放在运行时，避免没安装时 GUI 启动失败
_llama = None


def _import_llama():
    global _llama
    if _llama is None:
        from llama_cpp import Llama  # type: ignore
        _llama = Llama
    return _llama


# ── 默认搜索路径 ──────────────────────────────────────────────────────────────

DEFAULT_SEARCH_DIRS: list[Path] = [
    Path.home() / "models",
    Path.home() / ".cache" / "lm-studio" / "models",
    Path.home() / ".ollama" / "models" / "blobs",   # ollama 缓存（gguf 格式）
    Path("/opt/models"),
    Path.cwd() / "models",
]


def scan_gguf_files(extra_dirs: list[str] | None = None) -> list[Path]:
    """返回所有找到的 .gguf 文件路径列表（按修改时间倒序）。"""
    dirs = list(DEFAULT_SEARCH_DIRS)
    if extra_dirs:
        dirs.extend(Path(d) for d in extra_dirs)

    found: list[Path] = []
    seen: set[Path] = set()
    for d in dirs:
        if not d.exists():
            continue
        for p in d.rglob("*.gguf"):
            resolved = p.resolve()
            if resolved not in seen:
                seen.add(resolved)
                found.append(p)

    found.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return found


# ── 模型单例管理 ──────────────────────────────────────────────────────────────

class ModelManager:
    """线程安全的模型加载/卸载管理器。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model = None
        self._loaded_path: Optional[Path] = None
        self._loading = False

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def loaded_path(self) -> Optional[Path]:
        return self._loaded_path

    @property
    def is_loading(self) -> bool:
        return self._loading

    def load_async(
        self,
        model_path: str | Path,
        n_ctx: int = 4096,
        n_gpu_layers: int = -1,   # -1 = 全部 offload 到 GPU/Metal
        on_done: Callable[[bool, str], None] | None = None,
    ) -> None:
        """在后台线程加载模型，完成后回调 on_done(success, message)。"""
        def _worker():
            self._loading = True
            try:
                Llama = _import_llama()
                with self._lock:
                    # 先卸载旧模型
                    if self._model is not None:
                        del self._model
                        self._model = None
                        self._loaded_path = None

                    self._model = Llama(
                        model_path=str(model_path),
                        n_ctx=n_ctx,
                        n_gpu_layers=n_gpu_layers,
                        verbose=False,
                    )
                    self._loaded_path = Path(model_path)

                if on_done:
                    on_done(True, f"已加载：{Path(model_path).name}")
            except Exception as e:
                if on_done:
                    on_done(False, f"加载失败：{e}")
            finally:
                self._loading = False

        threading.Thread(target=_worker, daemon=True).start()

    def unload(self) -> None:
        with self._lock:
            if self._model is not None:
                del self._model
                self._model = None
                self._loaded_path = None

    def generate(
        self,
        system_prompt: str,
        user_text: str,
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> str:
        """调用已加载模型生成文本，返回 assistant 内容。"""
        with self._lock:
            if self._model is None:
                raise RuntimeError("模型未加载")

            output = self._model.create_chat_completion(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_text},
                ],
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return output["choices"][0]["message"]["content"]


# 全局单例
manager = ModelManager()
