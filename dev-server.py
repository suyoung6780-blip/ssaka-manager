#!/usr/bin/env python3
"""싸카매니저 로컬 개발 서버 (파이썬 기본 라이브러리만 사용)

  python3 dev-server.py           # public/ 제공 + /api/feeds (실제 뉴스·유튜브 수집)
  python3 dev-server.py --demo    # Firebase 없이 예시 데이터로 화면 미리보기
  python3 dev-server.py --demo --lan  # + 같은 와이파이의 휴대폰에서 http://<맥 IP>:8765 로 접속

/api/feeds 는 feedbot/feeds.py 로 모읍니다 (배포 시에는 GitHub Actions 가 같은 코드로 feeds.json 을 만듦).
"""
import json
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / 'public'
sys.path.insert(0, str(ROOT / 'feedbot'))
import feeds  # noqa: E402  — 축구 브리핑 수집 (GitHub Actions 와 같은 코드)
DEMO = '--demo' in sys.argv
LAN = '--lan' in sys.argv
PORT = 8765


_cache = {'data': None}


def collect():
    if _cache['data'] and time.time() * 1000 - _cache['data']['updatedAt'] < 10 * 60 * 1000:
        return _cache['data']
    _cache['data'] = feeds.collect()
    return _cache['data']


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(PUBLIC), **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_bytes(self, body, ctype):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/feeds':
            return self.send_bytes(json.dumps(collect(), ensure_ascii=False).encode(), 'application/json; charset=utf-8')
        if DEMO and path == '/js/fb.js':
            return self.send_bytes((ROOT / 'dev' / 'mock-fb.js').read_bytes(), 'text/javascript; charset=utf-8')
        if DEMO and path == '/js/config.js':
            src = (PUBLIC / 'js' / 'config.js').read_text(encoding='utf-8')
            src = src.replace("export const isConfigured = ", "export const isConfigured = true || ")
            return self.send_bytes(src.encode(), 'text/javascript; charset=utf-8')
        rng = self.headers.get('Range')
        if rng and rng.startswith('bytes='):
            return self.send_range(rng)
        return super().do_GET()

    # 영상 탐색(seek)에 필요한 HTTP Range 요청 지원 — 기본 http.server 는 지원하지 않음
    def send_range(self, rng):
        path = Path(self.translate_path(self.path.split('?')[0]))
        if not path.is_file():
            return super().do_GET()
        size = path.stat().st_size
        start_s, _, end_s = rng[6:].split(',')[0].partition('-')
        try:
            if start_s:
                start = int(start_s)
                end = min(size - 1, int(end_s)) if end_s else size - 1
            else:
                start = max(0, size - int(end_s))
                end = size - 1
        except ValueError:
            return super().do_GET()
        if start >= size or start > end:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.end_headers()
            return
        length = end - start + 1
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(length))
        self.end_headers()
        with open(path, 'rb') as f:
            f.seek(start)
            remaining = length
            try:
                while remaining > 0:
                    chunk = f.read(min(1 << 20, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def log_message(self, fmt, *args):
        if args and '/api/' in str(args[0]):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    print(f"싸카매니저 {'데모 ' if DEMO else ''}서버: http://localhost:{PORT}")
    # --lan: 같은 와이파이의 휴대폰에서도 접속 (http://<맥 IP>:8765)
    ThreadingHTTPServer(('0.0.0.0' if LAN else '127.0.0.1', PORT), Handler).serve_forever()
