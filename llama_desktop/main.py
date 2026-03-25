"""
main.py —— 入口

用法：
  python main.py              # 启动 GUI
  python main.py --headless   # 无 GUI，直接加载模型并启动 API 服务
                                （适合 SSH 远程或脚本调用）

  --model   <path>  指定 GGUF 文件路径（headless 必填，GUI 可选）
  --port    <int>   API 服务端口（默认 8788）
  --host    <str>   监听地址（默认 127.0.0.1）
  --gpu     <int>   GPU offload 层数（默认 -1 = 全部）
"""

from __future__ import annotations

import argparse
import signal
import sys
import time


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="llama desktop — 笔记转 PDF 本地服务")
    p.add_argument("--headless", action="store_true", help="无 GUI 模式")
    p.add_argument("--model",    type=str,  default="",      help="GGUF 模型文件路径")
    p.add_argument("--port",     type=int,  default=8788,    help="API 服务端口")
    p.add_argument("--host",     type=str,  default="127.0.0.1", help="监听地址")
    p.add_argument("--gpu",      type=int,  default=-1,      help="GPU 层数，-1=全部")
    return p.parse_args()


def run_headless(args: argparse.Namespace) -> None:
    """无 GUI 模式：加载模型 → 启动服务 → 阻塞等待 Ctrl+C。"""
    from model_manager import manager, scan_gguf_files
    import server

    model_path = args.model
    if not model_path:
        files = scan_gguf_files()
        if not files:
            print("错误：未指定 --model，且未在常见目录找到 .gguf 文件", file=sys.stderr)
            sys.exit(1)
        model_path = str(files[0])
        print(f"自动选择模型：{model_path}")

    print(f"加载模型：{model_path} …")

    done_event   = __import__("threading").Event()
    load_result  = {}

    def on_done(success: bool, msg: str) -> None:
        load_result["success"] = success
        load_result["msg"]     = msg
        done_event.set()

    manager.load_async(model_path, n_gpu_layers=args.gpu, on_done=on_done)
    done_event.wait()

    if not load_result.get("success"):
        print(f"加载失败：{load_result.get('msg')}", file=sys.stderr)
        sys.exit(1)

    print(load_result["msg"])
    server.start_server(host=args.host, port=args.port)
    print(f"API 服务已启动：http://{args.host}:{args.port}/api/convert")
    print("按 Ctrl+C 停止服务。")

    def _shutdown(sig, frame):
        print("\n正在关闭……")
        server.stop_server()
        sys.exit(0)

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    while True:
        time.sleep(1)


def run_gui(args: argparse.Namespace) -> None:
    from gui import App

    app = App()

    # 若命令行预填了模型路径，写入输入框
    if args.model:
        app._model_path_var.set(args.model)

    app.mainloop()


if __name__ == "__main__":
    args = parse_args()
    if args.headless:
        run_headless(args)
    else:
        run_gui(args)
