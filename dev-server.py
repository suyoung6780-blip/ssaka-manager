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
PORT = int(sys.argv[sys.argv.index('--port') + 1]) if '--port' in sys.argv else 8765  # 시제품: --port 로 다른 번호


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
        if DEMO and path == '/api/usage':  # 데모: 운영자 사용량 화면 미리보기용 예시 숫자
            return self.send_bytes(json.dumps({'configured': True, 'used': {'read': 18342, 'write': 2210, 'delete': 41}, 'limits': {'read': 50000, 'write': 20000, 'delete': 20000},
                                               'since': '2026-10-14T07:00:00Z', 'reset': '2026-10-15T07:00:00Z', 'at': '2026-10-14T13:20:00Z', 'demo': True}).encode(), 'application/json; charset=utf-8')
        if path == '/api/veo':  # Veo 공개 경기 → 원본 영상 주소 (배포 때 api/veo.py 와 같은 코드)
            import importlib.util
            spec = importlib.util.spec_from_file_location('veo', ROOT / 'api' / 'veo.py'); veo = importlib.util.module_from_spec(spec); spec.loader.exec_module(veo)
            from urllib.parse import parse_qs, urlparse
            code, data = veo.resolve((parse_qs(urlparse(self.path).query).get('m') or [''])[0])
            body = json.dumps(data).encode()
            self.send_response(code); self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        if path == '/api/feeds':
            return self.send_bytes(json.dumps(collect(), ensure_ascii=False).encode(), 'application/json; charset=utf-8')
        if DEMO and path == '/js/fb.js':
            return self.send_bytes((PUBLIC / 'js' / 'demo-fb.js').read_bytes(), 'text/javascript; charset=utf-8')
        if DEMO and path == '/js/config.js':
            src = (PUBLIC / 'js' / 'config.js').read_text(encoding='utf-8')
            src = src.replace("export const isConfigured = ", "export const isConfigured = true || ")
            return self.send_bytes(src.encode(), 'text/javascript; charset=utf-8')
        rng = self.headers.get('Range')
        if rng and rng.startswith('bytes='):
            return self.send_range(rng)
        return super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]
        if DEMO and path == '/api/admin_user':  # 데모: 계정 지우기는 흉내만
            return self.send_bytes(json.dumps({'ok': True, 'demo': True}).encode(), 'application/json; charset=utf-8')
        if DEMO and path == '/api/pay':  # 데모: 포트원 테스트 결제창까지만 (DB · 로그인 확인 없이)
            return self.demo_pay()
        self.send_response(404); self.end_headers()

    def demo_pay(self):
        # 데모: 포트원 테스트 결제창까지 (DB · 로그인 확인 없이). 이 컴퓨터에서 PORTONE_STORE_ID · PORTONE_CHANNEL_KEY 를 넣고 켜면 열림
        import os, time as _t
        from urllib.parse import parse_qs, urlparse
        step = (parse_qs(urlparse(self.path).query).get('step') or [''])[0]
        n = int(self.headers.get('Content-Length') or 0)
        q = json.loads(self.rfile.read(n) or b'{}')
        J = lambda o: self.send_bytes(json.dumps(o, ensure_ascii=False).encode(), 'application/json; charset=utf-8')
        if step == 'complete':  # 체험 모드: 승인 확인 · 기간 연장은 하지 않음
            return J({'ok': False, 'message': '체험 모드라 결제창까지만 확인했어요 (기간 연장은 실제 사이트에서). 테스트 결제는 포트원이 자동으로 취소해요.'})
        sid, ck = os.environ.get('PORTONE_STORE_ID', ''), os.environ.get('PORTONE_CHANNEL_KEY', '')
        if not (sid and ck):
            return J({'ok': False, 'message': '데모: 포트원 상점 아이디 · 채널 키가 아직 없어요.'})
        prices = {'gaffer': ('가퍼', 14900), 'rising': ('라이징', 29000), 'pro': ('프로', 39000), 'champion': ('챔피언', 54900)}
        cyc = {'month': ('1개월', 1), 'year': ('12개월', 10)}
        p, c = prices.get(q.get('plan'), prices['pro']), cyc.get(q.get('cycle'), cyc['month'])
        return J({'ok': True, 'storeId': sid, 'channelKey': ck, 'paymentId': f"DEMO-{q.get('plan')}-{q.get('cycle')}-{int(_t.time() * 1000)}",
                  'orderName': f'싸카매니저 {p[0]} {c[0]}', 'totalAmount': p[1] * c[1]})

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
