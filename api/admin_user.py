# Vercel 서버 함수: /api/admin_user — 운영자 전용. 가입 계정(Firebase 로그인)을 완전히 지움 → 같은 이메일로 다시 가입 가능
# 필요한 설정: Vercel 환경 변수 GOOGLE_SA_JSON 의 서비스 계정에 'Firebase 인증 관리자'(roles/firebaseauth.admin) 권한
# 앱 데이터(프로필 · 팀 소속 · 일지 등)는 운영자 화면에서 먼저 지우고, 여기서는 로그인 계정만 지움
import json
import os
import re
from http.server import BaseHTTPRequestHandler

PROJECT = 'ssaka-manager'
ADMINS = {'suyoung6780@gmail.com'}
UID = re.compile(r'^[A-Za-z0-9_-]{6,128}$')


class handler(BaseHTTPRequestHandler):
    def send(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            from google.oauth2 import id_token
            from google.auth.transport.requests import Request
            auth = self.headers.get('Authorization', '')
            info = id_token.verify_firebase_token(auth[7:] if auth.startswith('Bearer ') else '', Request(), audience=PROJECT)
        except Exception:  # noqa: BLE001
            return self.send(401, {'error': '로그인이 필요해요'})
        if (info.get('email') or '').lower() not in ADMINS or not info.get('email_verified'):
            return self.send(403, {'error': '운영자만 할 수 있어요'})
        try:
            n = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(min(n, 4096)) or b'{}')
        except Exception:  # noqa: BLE001
            body = {}
        uid = str(body.get('uid', ''))
        if not UID.match(uid):
            return self.send(400, {'error': '잘못된 계정이에요'})
        if uid == info.get('user_id') or uid == info.get('sub'):
            return self.send(400, {'error': '운영자 본인 계정은 여기서 지울 수 없어요'})
        raw = os.environ.get('GOOGLE_SA_JSON')
        if not raw:
            return self.send(200, {'ok': False, 'setup': True, 'error': '서버 설정(GOOGLE_SA_JSON)이 없어요'})
        try:
            from google.oauth2 import service_account
            from google.auth.transport.requests import AuthorizedSession
            creds = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=['https://www.googleapis.com/auth/cloud-platform'])
            s = AuthorizedSession(creds)
            r = s.post(f'https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}/accounts:delete', json={'localId': uid}, timeout=10)
            if r.status_code == 403:
                return self.send(200, {'ok': False, 'setup': True, 'error': '서비스 계정에 Firebase 인증 관리자 권한이 없어요'})
            if r.status_code == 400 and 'USER_NOT_FOUND' in r.text:
                return self.send(200, {'ok': True, 'already': True})
            r.raise_for_status()
            return self.send(200, {'ok': True})
        except Exception as e:  # noqa: BLE001
            return self.send(200, {'ok': False, 'error': str(e)[:300]})
