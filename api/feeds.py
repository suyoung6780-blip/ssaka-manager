# Vercel 서버 함수: /api/feeds — 축구 뉴스 · 블로그 · 유튜브를 모아 JSON 으로 (무료, 30분 동안 CDN 에 저장해 두고 재사용)
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'feedbot'))
import feeds  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        failed = []
        try:
            data = feeds.collect()
            failed = data['failed']
            body = json.dumps(data, ensure_ascii=False).encode()
            code = 200
        except Exception as e:  # noqa: BLE001
            body = json.dumps({'error': str(e)}).encode()
            code = 500
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        if code == 200:
            # 일부 출처가 실패했으면 5분 뒤 다시, 다 됐으면 30분 동안 재사용
            self.send_header('Cache-Control', f"public, s-maxage={300 if failed else 1800}, stale-while-revalidate=3600")
        self.end_headers()
        self.wfile.write(body)
