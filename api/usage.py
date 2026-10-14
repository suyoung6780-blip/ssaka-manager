# Vercel 서버 함수: /api/usage — 운영자 전용. Firebase(Firestore) 오늘 사용량(읽기 · 쓰기 · 삭제)을 Google Cloud Monitoring 에서 읽어 옴
# 필요한 설정: Vercel 환경 변수 GOOGLE_SA_JSON = '모니터링 뷰어' 권한 서비스 계정 키(JSON 전체)
# 무료 한도는 미국 서부 자정에 다시 채워짐 → 그 시각부터 지금까지 합계
import datetime
import json
import os
from http.server import BaseHTTPRequestHandler
from zoneinfo import ZoneInfo

PROJECT = 'ssaka-manager'
ADMINS = {'suyoung6780@gmail.com'}
LIMITS = {'read': 50000, 'write': 20000, 'delete': 20000}


def today_usage(creds_info):
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession

    creds = service_account.Credentials.from_service_account_info(creds_info, scopes=['https://www.googleapis.com/auth/monitoring.read'])
    s = AuthorizedSession(creds)
    pt = ZoneInfo('America/Los_Angeles')
    now = datetime.datetime.now(datetime.timezone.utc)
    start = now.astimezone(pt).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(datetime.timezone.utc)
    secs = max(60, int((now - start).total_seconds()))
    iso = lambda d: d.strftime('%Y-%m-%dT%H:%M:%SZ')  # noqa: E731
    out = {}
    for key in LIMITS:
        r = s.get(f'https://monitoring.googleapis.com/v3/projects/{PROJECT}/timeSeries', params={
            'filter': f'metric.type="firestore.googleapis.com/document/{key}_count"',
            'interval.startTime': iso(start), 'interval.endTime': iso(now),
            'aggregation.alignmentPeriod': f'{secs}s', 'aggregation.perSeriesAligner': 'ALIGN_SUM',
            'aggregation.crossSeriesReducer': 'REDUCE_SUM',
        }, timeout=10)
        r.raise_for_status()
        total = 0
        for ts in r.json().get('timeSeries', []):
            for p in ts.get('points', []):
                v = p.get('value', {})
                total += int(v.get('int64Value', 0) or 0) + int(v.get('doubleValue', 0) or 0)
        out[key] = total
    reset = start + datetime.timedelta(days=1)
    return {'configured': True, 'used': out, 'limits': LIMITS, 'since': iso(start), 'reset': iso(reset), 'at': iso(now)}


class handler(BaseHTTPRequestHandler):
    def send(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # 운영자인지 확인: Firebase 로그인 토큰 (이메일 인증까지 한 운영자 이메일만)
        try:
            from google.oauth2 import id_token
            from google.auth.transport.requests import Request
            auth = self.headers.get('Authorization', '')
            tok = auth[7:] if auth.startswith('Bearer ') else ''
            info = id_token.verify_firebase_token(tok, Request(), audience=PROJECT)
        except Exception:  # noqa: BLE001
            return self.send(401, {'error': '로그인이 필요해요'})
        if (info.get('email') or '').lower() not in ADMINS or not info.get('email_verified'):
            return self.send(403, {'error': '운영자만 볼 수 있어요'})
        raw = os.environ.get('GOOGLE_SA_JSON')
        if not raw:
            return self.send(200, {'configured': False})
        try:
            return self.send(200, today_usage(json.loads(raw)))
        except Exception as e:  # noqa: BLE001
            return self.send(200, {'configured': True, 'error': str(e)[:300]})
