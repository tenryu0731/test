# claude.ai の公開ページに近い CSP を付けて配信する確認用サーバー
# 使い方: python3 tools/csp-server.py 8781   （作品フォルダで実行）
import http.server, sys
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:")
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1] if len(sys.argv) > 1 else 8781)), H).serve_forever()
