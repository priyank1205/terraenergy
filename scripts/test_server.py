#!/usr/bin/env python3
"""
scripts/test_server.py
Lightweight local HTTP server for TerraEnergy web app with automatic MIME types and CORS support.
"""

import http.server
import socketserver
import os
import sys

PORT = 3000

class TerraHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def guess_type(self, path):
        if path.endswith(".js"):
            return "application/javascript"
        elif path.endswith(".json"):
            return "application/json"
        elif path.endswith(".css"):
            return "text/css"
        elif path.endswith(".html"):
            return "text/html"
        return super().guess_type(path)

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    with socketserver.TCPServer(("", port), TerraHandler) as httpd:
        print(f"TerraEnergy web app live at: http://localhost:{port}")
        print("Press Ctrl+C to stop the server.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

if __name__ == "__main__":
    main()
