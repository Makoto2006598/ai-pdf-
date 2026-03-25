"""
gui.py —— Tkinter 桌面 GUI

布局：
  ┌─────────────────────────────────────┐
  │  模型文件                [浏览] [扫描] │
  │  ─────────────────────────────────  │
  │  服务地址   127.0.0.1  端口  8788    │
  │  Metal GPU 层数  [-1 = 全部]         │
  │  ─────────────────────────────────  │
  │  [  加载模型 + 启动服务  ]            │
  │  [  在浏览器中打开前端  ]             │
  │  ─────────────────────────────────  │
  │  状态：●  日志输出区域               │
  └─────────────────────────────────────┘
"""

from __future__ import annotations

import os
import sys
import threading
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import filedialog, font, scrolledtext, ttk
from typing import Optional

import server
from model_manager import manager, scan_gguf_files

# ── 颜色常量 ──────────────────────────────────────────────────────────────────
CLR_BG      = "#1e1e2e"
CLR_SURFACE = "#2a2a3e"
CLR_BORDER  = "#45475a"
CLR_FG      = "#cdd6f4"
CLR_MUTED   = "#6c7086"
CLR_GREEN   = "#a6e3a1"
CLR_RED     = "#f38ba8"
CLR_YELLOW  = "#f9e2af"
CLR_BLUE    = "#89b4fa"
CLR_BTN     = "#313244"
CLR_BTN_ACT = "#45475a"


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("llama desktop — 笔记转 PDF 本地服务")
        self.configure(bg=CLR_BG)
        self.resizable(False, False)

        self._server_started = False
        self._model_path_var = tk.StringVar()
        self._host_var       = tk.StringVar(value="127.0.0.1")
        self._port_var       = tk.StringVar(value="8788")
        self._gpu_layers_var = tk.StringVar(value="-1")

        self._build_ui()
        self._log("欢迎使用 llama desktop。请选择 GGUF 模型文件后点击「启动」。")
        self._auto_scan()

    # ── UI 构建 ───────────────────────────────────────────────────────────────

    def _build_ui(self) -> None:
        pad = {"padx": 16, "pady": 6}

        # ── 模型选择区 ────────────────────────────────────────────────────────
        frm_model = tk.Frame(self, bg=CLR_BG)
        frm_model.pack(fill="x", **pad)

        tk.Label(frm_model, text="模型文件", bg=CLR_BG, fg=CLR_MUTED,
                 font=("SF Pro Text", 11)).pack(anchor="w")

        row_path = tk.Frame(frm_model, bg=CLR_BG)
        row_path.pack(fill="x", pady=(2, 0))

        self._path_entry = tk.Entry(
            row_path, textvariable=self._model_path_var,
            bg=CLR_SURFACE, fg=CLR_FG, insertbackground=CLR_FG,
            relief="flat", font=("SF Mono", 11), bd=0,
            highlightthickness=1, highlightbackground=CLR_BORDER,
        )
        self._path_entry.pack(side="left", fill="x", expand=True, ipady=5, ipadx=6)

        self._btn_browse = self._mk_btn(row_path, "浏览", self._browse_file)
        self._btn_browse.pack(side="left", padx=(6, 0))

        self._btn_scan = self._mk_btn(row_path, "扫描", self._do_scan)
        self._btn_scan.pack(side="left", padx=(4, 0))

        # ── 扫描结果下拉 ──────────────────────────────────────────────────────
        self._scan_frame = tk.Frame(self, bg=CLR_BG)
        self._scan_frame.pack(fill="x", padx=16, pady=(0, 4))

        self._scan_combo = ttk.Combobox(
            self._scan_frame, state="readonly",
            font=("SF Mono", 10), height=8,
        )
        self._style_combo()
        self._scan_combo.bind("<<ComboboxSelected>>", self._on_combo_select)

        # ── 分隔线 ────────────────────────────────────────────────────────────
        tk.Frame(self, bg=CLR_BORDER, height=1).pack(fill="x", padx=16, pady=4)

        # ── 服务器设置 ────────────────────────────────────────────────────────
        frm_srv = tk.Frame(self, bg=CLR_BG)
        frm_srv.pack(fill="x", **pad)

        self._add_labeled_entry(frm_srv, "服务地址", self._host_var, width=14, col=0)
        self._add_labeled_entry(frm_srv, "端口",     self._port_var, width=7,  col=2)
        self._add_labeled_entry(frm_srv, "GPU 层数（-1=全部 Metal）",
                                self._gpu_layers_var, width=7, col=4)

        # ── 分隔线 ────────────────────────────────────────────────────────────
        tk.Frame(self, bg=CLR_BORDER, height=1).pack(fill="x", padx=16, pady=4)

        # ── 操作按钮区 ────────────────────────────────────────────────────────
        frm_btns = tk.Frame(self, bg=CLR_BG)
        frm_btns.pack(fill="x", padx=16, pady=4)

        self._btn_start = self._mk_btn(
            frm_btns, "⚡  加载模型 + 启动服务", self._do_start,
            fg=CLR_GREEN, width=26,
        )
        self._btn_start.pack(side="left")

        self._btn_open = self._mk_btn(
            frm_btns, "🌐  在浏览器打开", self._do_open_browser,
            fg=CLR_BLUE, width=16,
        )
        self._btn_open.pack(side="left", padx=(8, 0))
        self._btn_open.config(state="disabled")

        # ── 状态指示灯 + 文字 ─────────────────────────────────────────────────
        frm_status = tk.Frame(self, bg=CLR_BG)
        frm_status.pack(fill="x", padx=16, pady=(4, 0))

        self._status_dot  = tk.Label(frm_status, text="●", bg=CLR_BG,
                                     fg=CLR_MUTED, font=("SF Pro Text", 13))
        self._status_dot.pack(side="left")
        self._status_lbl  = tk.Label(frm_status, text="未启动",
                                     bg=CLR_BG, fg=CLR_MUTED,
                                     font=("SF Pro Text", 11))
        self._status_lbl.pack(side="left", padx=(4, 0))

        # ── 日志区 ────────────────────────────────────────────────────────────
        tk.Frame(self, bg=CLR_BORDER, height=1).pack(fill="x", padx=16, pady=6)

        self._log_box = scrolledtext.ScrolledText(
            self, bg=CLR_SURFACE, fg=CLR_FG,
            font=("SF Mono", 10), relief="flat",
            width=62, height=12, state="disabled",
            bd=0, highlightthickness=0,
        )
        self._log_box.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        self._log_box.tag_config("ok",   foreground=CLR_GREEN)
        self._log_box.tag_config("err",  foreground=CLR_RED)
        self._log_box.tag_config("info", foreground=CLR_YELLOW)

    # ── 辅助：创建按钮 ────────────────────────────────────────────────────────

    def _mk_btn(self, parent, text, cmd, fg=CLR_FG, width=None) -> tk.Button:
        kw = dict(
            text=text, command=cmd,
            bg=CLR_BTN, fg=fg, activebackground=CLR_BTN_ACT, activeforeground=fg,
            relief="flat", font=("SF Pro Text", 11),
            cursor="hand2", bd=0, padx=10, pady=5,
        )
        if width:
            kw["width"] = width
        return tk.Button(parent, **kw)

    def _add_labeled_entry(self, parent, label, var, width, col) -> None:
        tk.Label(parent, text=label, bg=CLR_BG, fg=CLR_MUTED,
                 font=("SF Pro Text", 10)).grid(row=0, column=col,
                                                 padx=(0 if col == 0 else 12, 4),
                                                 sticky="w")
        e = tk.Entry(parent, textvariable=var, width=width,
                     bg=CLR_SURFACE, fg=CLR_FG, insertbackground=CLR_FG,
                     relief="flat", font=("SF Mono", 11), bd=0,
                     highlightthickness=1, highlightbackground=CLR_BORDER)
        e.grid(row=0, column=col + 1, ipady=4, ipadx=4)

    def _style_combo(self) -> None:
        style = ttk.Style()
        style.theme_use("default")
        style.configure("TCombobox",
                         fieldbackground=CLR_SURFACE,
                         background=CLR_BTN,
                         foreground=CLR_FG,
                         selectbackground=CLR_BTN_ACT,
                         selectforeground=CLR_FG,
                         arrowcolor=CLR_FG)

    # ── 事件处理 ──────────────────────────────────────────────────────────────

    def _browse_file(self) -> None:
        path = filedialog.askopenfilename(
            title="选择 GGUF 模型文件",
            filetypes=[("GGUF 模型", "*.gguf"), ("所有文件", "*.*")],
        )
        if path:
            self._model_path_var.set(path)

    def _auto_scan(self) -> None:
        """启动时静默扫描，找到文件就填充下拉。"""
        def _worker():
            files = scan_gguf_files()
            if files:
                self.after(0, lambda: self._populate_combo(files))
        threading.Thread(target=_worker, daemon=True).start()

    def _do_scan(self) -> None:
        self._log("扫描常见目录中……", tag="info")
        def _worker():
            files = scan_gguf_files()
            if files:
                self.after(0, lambda: self._populate_combo(files, verbose=True))
            else:
                self.after(0, lambda: self._log(
                    "未找到 .gguf 文件。请手动点击「浏览」选择文件。", tag="err"))
        threading.Thread(target=_worker, daemon=True).start()

    def _populate_combo(self, files: list[Path], verbose: bool = False) -> None:
        names = [str(p) for p in files]
        self._scan_combo["values"] = names
        self._scan_combo.pack(fill="x")
        if verbose:
            self._log(f"找到 {len(files)} 个模型文件，请从下拉中选择。", tag="ok")
        # 自动选第一个
        if not self._model_path_var.get() and files:
            self._scan_combo.current(0)
            self._model_path_var.set(names[0])

    def _on_combo_select(self, _event) -> None:
        self._model_path_var.set(self._scan_combo.get())

    def _do_start(self) -> None:
        model_path = self._model_path_var.get().strip()
        if not model_path:
            self._log("请先选择 GGUF 模型文件。", tag="err")
            return
        if not Path(model_path).exists():
            self._log(f"文件不存在：{model_path}", tag="err")
            return

        try:
            port = int(self._port_var.get())
            n_gpu = int(self._gpu_layers_var.get())
        except ValueError:
            self._log("端口和 GPU 层数必须是整数。", tag="err")
            return

        self._btn_start.config(state="disabled", text="加载中……")
        self._set_status("loading")
        self._log(f"正在加载模型：{Path(model_path).name}", tag="info")

        def on_model_done(success: bool, msg: str) -> None:
            self.after(0, lambda: self._on_model_loaded(success, msg, port))

        manager.load_async(
            model_path=model_path,
            n_gpu_layers=n_gpu,
            on_done=on_model_done,
        )

    def _on_model_loaded(self, success: bool, msg: str, port: int) -> None:
        if not success:
            self._log(msg, tag="err")
            self._set_status("error")
            self._btn_start.config(state="normal", text="⚡  加载模型 + 启动服务")
            return

        self._log(msg, tag="ok")

        if not server.is_server_running():
            host = self._host_var.get().strip() or "127.0.0.1"
            server.start_server(host=host, port=port)
            self._log(f"API 服务已启动：http://{host}:{port}/api/convert", tag="ok")
            self._server_started = True

        self._set_status("running")
        self._btn_start.config(state="normal", text="🔄  重新加载模型")
        self._btn_open.config(state="normal")

        # 提示前端应该把 PROXY_URL 指向本地
        self._log(
            f"提示：将前端 App.jsx 中 PROXY_URL 改为 "
            f"http://127.0.0.1:{self._port_var.get()}/api/convert 后重新构建即可离线使用。",
            tag="info",
        )

    def _do_open_browser(self) -> None:
        port = self._port_var.get().strip()
        # 尝试打开前端 dist/index.html（相对路径）
        dist = Path(__file__).parent.parent / "notes-pdf" / "dist" / "index.html"
        if dist.exists():
            webbrowser.open(dist.as_uri())
        else:
            webbrowser.open(f"http://127.0.0.1:{port}/")

    # ── 状态 & 日志 ───────────────────────────────────────────────────────────

    def _set_status(self, state: str) -> None:
        mapping = {
            "running": (CLR_GREEN,  "运行中"),
            "loading": (CLR_YELLOW, "加载中……"),
            "error":   (CLR_RED,    "出错"),
            "idle":    (CLR_MUTED,  "未启动"),
        }
        color, text = mapping.get(state, (CLR_MUTED, state))
        self._status_dot.config(fg=color)
        self._status_lbl.config(fg=color, text=text)

    def _log(self, msg: str, tag: str = "") -> None:
        self._log_box.config(state="normal")
        self._log_box.insert("end", msg + "\n", tag or ())
        self._log_box.see("end")
        self._log_box.config(state="disabled")
