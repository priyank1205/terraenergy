#!/usr/bin/env python3
"""
Local static server for TerraEnergy.

    python3 scripts/serve.py [port]      # default 3000

Serves the project root with correct MIME types and gzip for JSON/JS/CSS so the ~2 MB of
map data loads quickly, and disables caching so rebuilt data shows up immediately.
"""

from __future__ import annotations

import gzip
import http.server
import json
import os
import socketserver
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
COMPRESSIBLE = {".json", ".js", ".css", ".html", ".svg", ".txt"}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        if urlparse(self.path).path == "/api/trade":
            from io import BytesIO
            from pipeline.sources.bilateral import fetch_pair
            query = parse_qs(urlparse(self.path).query)
            try:
                result = fetch_pair(query.get("a", [""])[0], query.get("b", [""])[0],
                                    query.get("frequency", ["A"])[0], query.get("refresh", ["0"])[0] == "1")
                status = 200
            except ValueError as exc:
                result, status = {"error": str(exc)}, 400
            except Exception:
                result, status = {"error": "The trade source is unavailable. The saved snapshot remains available."}, 502
            data = json.dumps(result, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return BytesIO(data)
        path = Path(self.translate_path(self.path))
        accepts_gzip = "gzip" in self.headers.get("Accept-Encoding", "")
        if path.is_file() and path.suffix in COMPRESSIBLE and accepts_gzip:
            data = gzip.compress(path.read_bytes(), compresslevel=6)
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(str(path)))
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            from io import BytesIO
            return BytesIO(data)
        return super().send_head()

    def log_message(self, fmt, *args):
        if os.environ.get("QUIET"):
            return
        super().log_message(fmt, *args)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 3000))
    with Server(("127.0.0.1", port), Handler) as httpd:
        print(f"TerraEnergy running at http://localhost:{port}  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
