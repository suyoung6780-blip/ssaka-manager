# Vercel 서버 함수: /api/pay — 토스페이먼츠 결제 승인 → 팀 이용기간 연장
# 결제창에서 돌아온 사이트가 { paymentKey, orderId, amount } 와 로그인 열쇠(ID 토큰)를 보냄
#  1) 로그인한 사람이 그 팀의 대표인지 확인
#  2) 주문번호의 요금제 · 기간으로 금액을 다시 계산해서 보낸 금액과 같은지 확인 (화면에서 금액을 바꿔도 소용없게)
#  3) 토스에 승인 요청 → 승인되면 팀 paidUntil 연장 + payments/{orderId} 기록
#  4) 저장에 실패하면 결제를 바로 취소 (돈만 나가는 일이 없게)
# 필요한 설정 (Vercel 환경 변수):
#   GOOGLE_SA_JSON   — 이미 있음 (서비스 계정). 'Cloud Datastore 사용자' 권한이 있어야 Firestore 에 씀
#   TOSS_SECRET_KEY  — 토스페이먼츠 '결제위젯 연동 키'의 시크릿 키 (test_gsk_… / 심사 후 live_gsk_…). 없으면 토스 문서용 테스트 키로 테스트만
import base64
import json
import os
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

PROJECT = 'ssaka-manager'
FS = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'
# public/js/config.js 의 PLANS · CYCLES 와 같아야 함
PLANS = {'gaffer': ('가퍼', 14900), 'rising': ('라이징', 29000), 'pro': ('프로', 39000), 'champion': ('챔피언', 54900)}
CYCLES = {'month': ('1개월', 30, 1), 'year': ('12개월', 365, 10)}
DOC_TEST_SK = 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6'  # 토스 공식 문서의 공개 결제위젯 테스트 키 (실제 돈이 오가지 않음)


def _secret():
    return os.environ.get('TOSS_SECRET_KEY') or DOC_TEST_SK


def _toss(path, body):
    import requests
    auth = base64.b64encode(f'{_secret()}:'.encode()).decode()
    r = requests.post(f'https://api.tosspayments.com/v1/{path}', json=body, timeout=20,
                      headers={'Authorization': f'Basic {auth}', 'Content-Type': 'application/json'})
    return r.status_code, r.json()


def _ts(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def _ms(v):
    if not v or 'timestampValue' not in v:
        return 0
    s = v['timestampValue'].rstrip('Z')
    frac = '0'
    if '.' in s:
        s, frac = s.split('.', 1)
    d = datetime.strptime(s, '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc)
    return int(d.timestamp() * 1000) + int((frac + '000')[:3])


def _kst(ms):
    d = datetime.fromtimestamp(ms / 1000 + 9 * 3600, tz=timezone.utc)
    return f'{d.year}년 {d.month}월 {d.day}일'


class handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _fail(self, code, msg):
        self._send(code, {'ok': False, 'message': msg})

    def do_POST(self):  # noqa: C901
        try:
            n = int(self.headers.get('Content-Length') or 0)
            q = json.loads(self.rfile.read(n) or b'{}')
        except Exception:  # noqa: BLE001
            return self._fail(400, '요청이 올바르지 않아요.')
        payment_key = str(q.get('paymentKey') or '')
        order_id = str(q.get('orderId') or '')
        try:
            amount = int(q.get('amount'))
        except Exception:  # noqa: BLE001
            return self._fail(400, '결제 금액이 올바르지 않아요.')
        parts = order_id.split('-')
        if not payment_key or len(parts) != 4 or parts[1] not in PLANS or parts[2] not in CYCLES:
            return self._fail(400, '주문 정보가 올바르지 않아요.')
        team_id, plan, cycle = parts[0], parts[1], parts[2]
        plan_name, month = PLANS[plan]
        cyc_label, days, mult = CYCLES[cycle]
        price = month * mult
        if amount != price:
            return self._fail(400, '결제 금액이 요금표와 달라요.')

        raw = os.environ.get('GOOGLE_SA_JSON', '')
        if not raw:
            return self._fail(500, '서버 설정이 아직 안 됐어요. 운영자에게 문의해 주세요.')
        # 1) 로그인 확인
        try:
            from google.oauth2 import id_token, service_account
            from google.auth.transport.requests import Request, AuthorizedSession
            tok = (self.headers.get('Authorization') or '').replace('Bearer ', '', 1)
            claims = id_token.verify_firebase_token(tok, Request(), audience=PROJECT)
            uid = claims['user_id'] if 'user_id' in claims else claims['sub']
        except Exception:  # noqa: BLE001
            return self._fail(401, '로그인이 풀렸어요. 다시 로그인한 뒤 운영자에게 문의해 주세요.')
        info = json.loads(raw)
        cred = service_account.Credentials.from_service_account_info(info, scopes=['https://www.googleapis.com/auth/datastore'])
        ses = AuthorizedSession(cred)

        # 이미 처리한 주문이면 그 결과 그대로 (새로고침 등)
        prev = ses.get(f'{FS}/payments/{order_id}', timeout=10)
        if prev.status_code == 200:
            f = prev.json().get('fields', {})
            return self._send(200, {'ok': True, 'again': True, 'planName': plan_name, 'until': _kst(_ms(f.get('until'))),
                                    'receiptUrl': f.get('receiptUrl', {}).get('stringValue', '')})

        # 2) 팀 대표 확인
        tr = ses.get(f'{FS}/teams/{team_id}', timeout=10)
        if tr.status_code != 200:
            return self._fail(404 if tr.status_code == 404 else 500, '팀을 찾지 못했어요.' if tr.status_code == 404 else '팀 정보를 읽지 못했어요 (서버 권한). 운영자에게 문의해 주세요.')
        team = tr.json().get('fields', {})
        if team.get('ownerUid', {}).get('stringValue') != uid:
            return self._fail(403, '팀 대표 지도자만 결제할 수 있어요.')

        # 3) 토스 승인
        code, pay = _toss('payments/confirm', {'paymentKey': payment_key, 'orderId': order_id, 'amount': price})
        if code != 200 or pay.get('status') != 'DONE' or int(pay.get('totalAmount') or 0) != price:
            return self._fail(400, pay.get('message') or '결제 승인이 되지 않았어요.')

        # 4) 이용기간 연장 + 결제 기록 (주문번호마다 한 번만)
        now = int(time.time() * 1000)
        base = max(now, _ms(team.get('paidUntil')))
        until = base + days * 864e5
        receipt = (pay.get('receipt') or {}).get('url', '')
        writes = [
            {'update': {'name': f'projects/{PROJECT}/databases/(default)/documents/payments/{order_id}', 'fields': {
                'teamId': {'stringValue': team_id}, 'uid': {'stringValue': uid}, 'plan': {'stringValue': plan},
                'cycle': {'stringValue': cycle}, 'amount': {'integerValue': str(price)}, 'paymentKey': {'stringValue': payment_key},
                'method': {'stringValue': pay.get('method') or ''}, 'approvedAt': {'stringValue': pay.get('approvedAt') or ''},
                'receiptUrl': {'stringValue': receipt}, 'from': {'timestampValue': _ts(base)}, 'until': {'timestampValue': _ts(until)},
                'test': {'booleanValue': _secret().startswith('test_')}, 'createdAt': {'timestampValue': _ts(now)}}},
             'currentDocument': {'exists': False}},
            {'update': {'name': f'projects/{PROJECT}/databases/(default)/documents/teams/{team_id}', 'fields': {
                'paidUntil': {'timestampValue': _ts(until)}, 'plan': {'stringValue': plan}, 'planCycle': {'stringValue': cycle},
                'status': {'stringValue': 'active'}, 'lastPaidAt': {'timestampValue': _ts(now)}}},
             'updateMask': {'fieldPaths': ['paidUntil', 'plan', 'planCycle', 'status', 'lastPaidAt']},
             'currentDocument': {'exists': True}},
        ]
        cr = ses.post(f'{FS}:commit', json={'writes': writes}, timeout=15)
        if cr.status_code != 200:
            _toss(f'payments/{payment_key}/cancel', {'cancelReason': '이용기간 저장 실패로 자동 취소'})
            return self._fail(500, '결제를 저장하지 못해서 자동으로 취소했어요 (돈은 나가지 않아요). 잠시 후 다시 해 주세요.')
        return self._send(200, {'ok': True, 'planName': plan_name, 'cycle': cyc_label, 'until': _kst(until), 'receiptUrl': receipt})
