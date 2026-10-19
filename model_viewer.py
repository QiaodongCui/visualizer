"""Model Viewer desktop app: shows STEP / OBJ / STL files in a native window.

Usage: ModelViewer.exe [path-to-model]
"""
import os
import secrets
import sys
import threading
import urllib.parse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import webview

APP_NAME = "Model Viewer"


def resource_dir():
    # PyInstaller unpacks bundled data into sys._MEIPASS.
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, "web")


class Handler(SimpleHTTPRequestHandler):
    # Files the page may fetch, keyed by a random token (so the server can't be
    # used to read arbitrary files from disk).
    shared_files = {}

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".html": "text/html",
    }

    def do_GET(self):
        if self.path.startswith("/file/"):
            token = urllib.parse.unquote(self.path[len("/file/"):])
            path = self.shared_files.get(token)
            if not path or not os.path.isfile(path):
                self.send_error(404)
                return
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def log_message(self, *args):
        pass  # windowed exe has no console


class Api:
    # Attributes must be private: pywebview exposes public ones to JavaScript and
    # would recurse into the native window object, freezing the app.
    def __init__(self):
        self._window = None

    def set_title(self, title):
        if self._window:
            self._window.title = title


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=resource_dir()))
    threading.Thread(target=server.serve_forever, daemon=True).start()

    url = f"http://127.0.0.1:{server.server_port}/index.html"
    title = APP_NAME
    if len(sys.argv) > 1 and os.path.isfile(sys.argv[1]):
        path = os.path.abspath(sys.argv[1])
        token = secrets.token_urlsafe(16)
        Handler.shared_files[token] = path
        name = os.path.basename(path)
        url += "?" + urllib.parse.urlencode({"open": token, "name": name})
        title = f"{name} - {APP_NAME}"

    api = Api()
    api._window = webview.create_window(title, url, js_api=api, width=1280, height=800)
    webview.start(private_mode=True)
    server.shutdown()


if __name__ == "__main__":
    main()
