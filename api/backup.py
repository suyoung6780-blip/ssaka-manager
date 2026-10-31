# Vercel 서버 함수: /api/backup — 운영자 전용. Firestore 전체 데이터를 조금씩(최대 500개) 읽어 돌려줌 → 운영자 화면이 모아서 파일 하나로 저장
#  ?list=1                     맨 위 모음 이름 + 하위 모음 이름(아래 SUB) 목록
#  ?c=<모음 이름>&after=<문서 경로>  그 이름의 모든 모음(하위 포함)에서 문서 500개씩 — next 가 있으면 이어서 부름
# 값은 Firestore 원래 형식(stringValue · timestampValue …) 그대로 → 나중에 그대로 되살릴 수 있게
# 문서 1개 = 읽기 1번 (무료 한도에서 빠짐). 필요한 설정: GOOGLE_SA_JSON (이미 있음 · Firestore 읽기)
# 시험: FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 이면 로컬 에뮬레이터를 읽음
import json
import os
import urllib.parse
from http.server import BaseHTTPRequestHandler

PROJECT = 'ssaka-manager'
ADMINS = {'suyoung6780@gmail.com'}
# 하위 모음 이름 (firestore.rules 의 match 와 같게) — 새 하위 모음을 만들면 여기에도 추가
SUB = ['members', 'private', 'posts', 'coachNotes', 'matches', 'goals', 'logs', 'idp', 'history', 'idpConfig', 'matchWork',
       'counsel', 'replies', 'scouts', 'todos', 'notes', 'messages', 'comments']
PAGE = 500


def _session():
    emu = os.environ.get('FIRESTORE_EMULATOR_HOST')
    if emu:
        import requests
        s = requests.Session()
        s.headers['Authorization'] = 'Bearer owner'
        return s, f'http://{emu}/v1/projects/demo-ssaka/databases/(default)/documents'
    raw = os.environ.get('GOOGLE_SA_JSON')
    if not raw:
        return None, None
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    cred = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=['https://www.googleapis.com/auth/datastore'])
    return AuthorizedSession(cred), f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'


def _is_admin(headers):
    if os.environ.get('FIRESTORE_EMULATOR_HOST'):
        return True
    from google.oauth2 import id_token
    from google.auth.transport.requests import Request
    auth = headers.get('Authorization', '')
    info = id_token.verify_firebase_token(auth[7:] if auth.startswith('Bearer ') else '', Request(), audience=PROJECT)
    return (info.get('email') or '').lower() in ADMINS and info.get('email_verified')


def roots(ses, base):
    r = ses.post(f'{base}:listCollectionIds', json={'pageSize': 300}, timeout=15)
    r.raise_for_status()
    return r.json().get('collectionIds', [])


def page(ses, base, cid, after=''):
    q = {'from': [{'collectionId': cid, 'allDescendants': True}], 'orderBy': [{'field': {'fieldPath': '__name__'}}], 'limit': PAGE}
    if after:
        q['startAt'] = {'values': [{'referenceValue': after}], 'before': False}
    r = ses.post(f'{base}:runQuery', json={'structuredQuery': q}, timeout=25)
    r.raise_for_status()
    docs = [x['document'] for x in r.json() if 'document' in x]
    out = [{'name': d['name'].split('/documents/', 1)[1], 'fields': d.get('fields', {}), 'createTime': d.get('createTime'), 'updateTime': d.get('updateTime')} for d in docs]
    nxt = docs[-1]['name'] if len(docs) == PAGE else ''
    return out, nxt


class handler(BaseHTTPRequestHandler):
    def send(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            if not _is_admin(self.headers):
                return self.send(403, {'error': '운영자만 할 수 있어요'})
        except Exception:  # noqa: BLE001
            return self.send(401, {'error': '로그인이 필요해요'})
        ses, base = _session()
        if not ses:
            return self.send(200, {'ok': False, 'error': '서버 설정(GOOGLE_SA_JSON)이 없어요'})
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        try:
            if qs.get('list'):
                top = roots(ses, base)
                return self.send(200, {'ok': True, 'groups': top + [c for c in SUB if c not in top]})
            cid = (qs.get('c') or [''])[0]
            if not cid.replace('_', '').isalnum():
                return self.send(400, {'error': '모음 이름이 올바르지 않아요'})
            docs, nxt = page(ses, base, cid, (qs.get('after') or [''])[0])
            return self.send(200, {'ok': True, 'docs': docs, 'next': nxt})
        except Exception as e:  # noqa: BLE001
            return self.send(200, {'ok': False, 'error': str(e)[:300]})
