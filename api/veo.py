# Vercel 서버 함수: /api/veo?m=<경기 주소 slug> — 공개된 Veo 경기의 원본 영상(mp4) 주소를 찾아 줌
# (Veo 페이지는 다른 사이트 안에 넣을 수 없고, Veo API 는 브라우저에서 직접 부를 수 없어서 여기서 대신 물어봄)
import json
import re
import urllib.request
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

SLUG = re.compile(r'^[A-Za-z0-9_-]{6,200}$')


def resolve(slug):
    if not SLUG.match(slug or ''):
        return 400, {'error': 'bad match id'}
    url = f'https://app.veo.co/api/app/matches/{slug}/videos/'
    req = urllib.request.Request(url, headers={'User-Agent': 'ssaka-manager/1.0', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            vids = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return (404 if e.code in (401, 403, 404) else 502), {'error': 'not public' if e.code in (401, 403, 404) else f'veo {e.code}'}
    except Exception as e:  # noqa: BLE001
        return 502, {'error': str(e)}
    if not isinstance(vids, list):
        vids = vids.get('results', []) if isinstance(vids, dict) else []
    mp4 = [v for v in vids if v.get('mime_type') == 'video/mp4' and str(v.get('url', '')).startswith('https://')]
    # 일반 화면(standard)을 먼저, 없으면 파노라마
    mp4.sort(key=lambda v: (v.get('render_type') != 'standard', -(int(v.get('height') or 0))))
    if not mp4:
        return 404, {'error': 'no video'}
    return 200, {'url': mp4[0]['url'], 'type': mp4[0].get('render_type', ''), 'w': mp4[0].get('width'), 'h': mp4[0].get('height')}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        slug = (parse_qs(urlparse(self.path).query).get('m') or [''])[0]
        code, data = resolve(slug)
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)
