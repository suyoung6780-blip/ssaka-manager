# Vercel 서버 함수: /api/kakao — 카카오로 가입 · 로그인
# 1) /api/kakao?start=1        → 카카오 로그인 화면으로 보냄 (위조 방지용 state 쿠키)
# 2) 카카오가 /api/kakao?code=… 로 돌려보냄 → 카카오에서 이메일 확인
#    → 같은 이메일의 Firebase 계정(없으면 새로 만듦)으로 들어오는 열쇠(커스텀 토큰)를 만들어
#    → 사이트 #/login?kt=열쇠 로 보냄 (사이트가 바로 로그인하고 주소에서 지움)
# 필요한 설정 (Vercel 환경 변수):
#   GOOGLE_SA_JSON      — 이미 있음 (서비스 계정 · 'Firebase 인증 관리자' 권한)
#   KAKAO_REST_KEY      — 카카오 디벨로퍼스 › 내 애플리케이션 › 앱 키 › REST API 키
#   KAKAO_CLIENT_SECRET — 카카오 디벨로퍼스에서 클라이언트 시크릿을 ON 으로 켰다면 꼭 (그 REST API 키의 시크릿 코드)
#                         서버에서만 씀 — 화면 코드에 넣지 않음 · 켰는데 없거나 틀리면 카카오가 KOE010 을 돌려줌
#   설정 확인: /api/kakao?diag=1 → 키 · 시크릿이 '들어 있는지'만 (값은 안 보여 줌)
# 카카오 디벨로퍼스 › 카카오 로그인 › Redirect URI 에 https://<사이트 주소>/api/kakao 등록
# 동의항목: 카카오계정(이메일) 필수 — 이메일로 기존 계정을 찾고, 이메일 인증된 계정만 받음
import json
import os
import secrets
import time
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlencode, urlparse

PROJECT = 'ssaka-manager'
IDT = f'https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}'
AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit'


def _sa():
    raw = os.environ.get('GOOGLE_SA_JSON', '')
    return json.loads(raw) if raw else None


def _admin_session(info):
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    cred = service_account.Credentials.from_service_account_info(info, scopes=['https://www.googleapis.com/auth/cloud-platform'])
    return AuthorizedSession(cred), cred


def _custom_token(cred, info, uid):
    from google.auth import jwt
    now = int(time.time())
    payload = {
        'iss': info['client_email'], 'sub': info['client_email'], 'aud': AUD,
        'iat': now, 'exp': now + 3000, 'uid': uid, 'claims': {'via': 'kakao'},
    }
    tok = jwt.encode(cred.signer, payload)
    return tok.decode() if isinstance(tok, bytes) else tok


class handler(BaseHTTPRequestHandler):
    def _base(self):
        host = self.headers.get('x-forwarded-host') or self.headers.get('host') or 'www.ssakamanager.co.kr'
        return f'https://{host}'

    def _go(self, url, cookie=None):
        self.send_response(302)
        self.send_header('Location', url)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        if cookie is not None:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()

    def _fail(self, why):
        # 쿠키 지우고 사이트 로그인 화면으로 (이유는 짧은 코드로)
        self._go(f'{self._base()}/#/login?kerr={why}', 'kk_state=; Max-Age=0; Path=/api/kakao; HttpOnly; Secure; SameSite=Lax')

    def do_GET(self):  # noqa: C901
        import requests
        q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
        key = os.environ.get('KAKAO_REST_KEY', '').strip()
        secret = os.environ.get('KAKAO_CLIENT_SECRET', '').strip()  # 붙여 넣을 때 생긴 앞뒤 공백 · 줄바꿈 제거
        info = _sa()
        if q.get('diag'):  # 운영 환경 변수가 들어 있는지만 확인 (값은 절대 보여 주지 않음)
            body = json.dumps({'rest_key': bool(key), 'client_secret': bool(secret), 'service_account': bool(info)}).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(body)
            return
        if not key or not info:
            return self._fail('config')
        redirect = f'{self._base()}/api/kakao'

        # 1) 카카오 로그인 화면으로
        if q.get('start'):
            st = secrets.token_urlsafe(24)
            url = 'https://kauth.kakao.com/oauth/authorize?' + urlencode({
                'client_id': key, 'redirect_uri': redirect, 'response_type': 'code', 'state': st, 'scope': 'account_email',
            })
            return self._go(url, f'kk_state={st}; Max-Age=600; Path=/api/kakao; HttpOnly; Secure; SameSite=Lax')

        # 2) 카카오에서 돌아옴
        if q.get('error'):
            return self._fail('cancel')
        cookie = self.headers.get('Cookie', '')
        saved = next((c.split('=', 1)[1] for c in cookie.split('; ') if c.startswith('kk_state=')), '')
        if not q.get('code') or not saved or not secrets.compare_digest(saved, q.get('state', '')):
            return self._fail('state')
        try:
            data = {'grant_type': 'authorization_code', 'client_id': key, 'redirect_uri': redirect, 'code': q['code']}
            if secret:
                data['client_secret'] = secret
            t = requests.post('https://kauth.kakao.com/oauth/token', data=data, timeout=10).json()
            at = t.get('access_token')
            if not at:
                err = str(t.get('error_code') or t.get('error') or '')
                # 서버 기록에는 오류 코드만 (시크릿 · 코드 값은 남기지 않음)
                print(f"kakao token error: {err} {str(t.get('error_description') or '')[:120]} secret_set={bool(secret)}", flush=True)
                return self._fail('secret' if err in ('KOE010', 'invalid_client') else 'token')
            me = requests.get('https://kapi.kakao.com/v2/user/me', headers={'Authorization': f'Bearer {at}'}, timeout=10).json()
            acc = me.get('kakao_account') or {}
            email = (acc.get('email') or '').strip().lower()
            if not email:
                return self._fail('email')
            if not (acc.get('is_email_valid') and acc.get('is_email_verified')):
                return self._fail('unverified')
            kid = str(me.get('id') or '')

            ses, cred = _admin_session(info)
            # 같은 이메일로 이미 가입한 계정이 있으면 그 계정으로
            r = ses.post(f'{IDT}/accounts:lookup', json={'email': [email]}, timeout=10).json()
            users = r.get('users') or []
            if users:
                uid = users[0]['localId']
            else:
                uid = f'kakao_{kid}' if kid else None
                body = {'email': email, 'emailVerified': True}
                if uid:
                    body['localId'] = uid
                c = ses.post(f'{IDT}/accounts', json=body, timeout=10).json()
                uid = c.get('localId') or uid
                if not uid:
                    return self._fail('config')
            tok = _custom_token(cred, info, uid)
        except Exception:  # noqa: BLE001
            return self._fail('config')
        self._go(f'{self._base()}/#/login?kt={tok}', 'kk_state=; Max-Age=0; Path=/api/kakao; HttpOnly; Secure; SameSite=Lax')
