# Vercel 서버 함수: /api/pay — 포트원(PortOne V2) · KG이니시스 결제 → 팀 이용기간 연장
#  ?step=start    (POST JSON · 로그인 열쇠) 팀 대표 · 금액 확인 → 주문(payOrders/{paymentId}) 만들고 결제창에 넣을 값 돌려줌
#  ?step=complete (POST JSON · 로그인 열쇠) 결제창이 끝나면: 포트원에서 결제를 다시 읽어 금액 · 상태 · 주문 확인 → 이용기간 연장
#  ?step=webhook  (POST · 포트원이 보냄) 결제 완료 알림 — 화면이 중간에 닫혀도 연장되게 (같은 확인을 서버끼리 다시 함)
#  ?step=result   (GET · 로그인 열쇠) 끝난 주문 결과 (완료 창에 보여 줄 요금제 · 기간)
# 원칙: 금액은 늘 서버에서 요금표로 다시 계산 · 결제 정보는 화면이 보낸 값이 아니라 포트원에서 직접 읽음
#       · 주문을 만든 사람이 그 팀 대표인지 확인 · 금액이 다르거나 저장에 실패하면 결제를 바로 취소
# 필요한 설정 (Vercel 환경 변수):
#   GOOGLE_SA_JSON       — 이미 있음 (서비스 계정, Firestore 쓰기)
#   PORTONE_STORE_ID     — 포트원 콘솔 › 결제 연동 › 연동 정보 › 상점 아이디 (store-…)
#   PORTONE_CHANNEL_KEY  — 포트원 콘솔 › 결제 연동 › 채널 관리 › KG이니시스 채널의 채널 키 (channel-key-…) — 테스트 채널 → 심사 후 실연동 채널로 바꿈
#   PORTONE_API_SECRET   — 포트원 콘솔 › 결제 연동 › 연동 정보 › V2 API Secret (서버에만 · 화면 코드에 넣지 않음)
import json
import os
import time
import urllib.parse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

PROJECT = 'ssaka-manager'
FS = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'
DOCS = f'projects/{PROJECT}/databases/(default)/documents'
API = 'https://api.portone.io'
# public/js/config.js 의 PLANS · CYCLES 와 같아야 함
PLANS = {'gaffer': ('가퍼', 14900), 'rising': ('라이징', 29000), 'pro': ('프로', 39000), 'champion': ('챔피언', 54900)}
CYCLES = {'month': ('1개월', 30, 1), 'year': ('12개월', 365, 10)}


def _env(k):
    return os.environ.get(k, '').strip()


def _now_ms():
    return int(time.time() * 1000)


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


def _str(f, k):
    return (f.get(k) or {}).get('stringValue', '')


def _int(f, k):
    try:
        return int((f.get(k) or {}).get('integerValue', '0'))
    except Exception:  # noqa: BLE001
        return 0


def _q(pid):
    return urllib.parse.quote(pid, safe='')


def _session():
    raw = _env('GOOGLE_SA_JSON')
    if not raw:
        return None
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    cred = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=['https://www.googleapis.com/auth/datastore'])
    return AuthorizedSession(cred)


def _uid_of(headers):
    from google.oauth2 import id_token
    from google.auth.transport.requests import Request
    tok = (headers.get('Authorization') or '').replace('Bearer ', '', 1)
    claims = id_token.verify_firebase_token(tok, Request(), audience=PROJECT)
    return claims['user_id'] if 'user_id' in claims else claims['sub']


def _portone(method, path, body=None):
    import requests
    h = {'Authorization': f"PortOne {_env('PORTONE_API_SECRET')}", 'Content-Type': 'application/json'}
    r = requests.request(method, f'{API}{path}', headers=h, json=body, timeout=20)
    try:
        return r.status_code, r.json()
    except Exception:  # noqa: BLE001
        return r.status_code, {}


def _cancel(pid, reason):
    # 돈만 나가는 일이 없게 (금액 불일치 · 저장 실패)
    try:
        code, _ = _portone('POST', f'/payments/{_q(pid)}/cancel', {'reason': reason[:100]})
        return code == 200
    except Exception:  # noqa: BLE001
        return False


def _complete(ses, pid, uid=None):
    # 포트원에서 결제를 직접 읽어 확인 → 이용기간 연장 + 결제 기록 (주문마다 한 번만). 돌려주는 값: (http 코드, 결과)
    orr = ses.get(f'{FS}/payOrders/{_q(pid)}', timeout=10)
    if orr.status_code != 200:
        return 404, {'ok': False, 'message': '주문을 찾지 못했어요.'}
    o = orr.json().get('fields', {})
    team_id, ouid, plan, cycle, price = _str(o, 'teamId'), _str(o, 'uid'), _str(o, 'plan'), _str(o, 'cycle'), _int(o, 'price')
    if uid and uid != ouid:
        return 403, {'ok': False, 'message': '내 주문이 아니에요.'}
    if _str(o, 'status') == 'done':
        return 200, {'ok': True, 'again': True, 'paymentId': pid}
    if plan not in PLANS or cycle not in CYCLES or price != PLANS[plan][1] * CYCLES[cycle][2]:
        return 400, {'ok': False, 'message': '주문 정보가 요금표와 달라요.'}
    code, pay = _portone('GET', f'/payments/{_q(pid)}')
    if code != 200:
        return 400, {'ok': False, 'message': '결제 정보를 확인하지 못했어요. 돈이 나갔다면 운영자에게 문의해 주세요.'}
    if pay.get('status') != 'PAID':
        return 400, {'ok': False, 'message': '결제가 끝나지 않았어요.'}
    try:
        paid = int((pay.get('amount') or {}).get('total'))
    except Exception:  # noqa: BLE001
        paid = -1
    if paid != price or (pay.get('currency') or 'KRW') != 'KRW':
        _cancel(pid, '자동 취소: 결제 금액이 주문과 다름')
        return 400, {'ok': False, 'message': '결제 금액이 주문과 달라서 자동으로 취소했어요 (돈은 나가지 않아요).'}
    tr = ses.get(f'{FS}/teams/{team_id}', timeout=10)
    team = tr.json().get('fields', {}) if tr.status_code == 200 else {}
    if _str(team, 'ownerUid') != ouid:
        _cancel(pid, '자동 취소: 팀 대표 확인 실패')
        return 403, {'ok': False, 'message': '팀 대표가 바뀌어서 결제를 자동으로 취소했어요.'}
    days = CYCLES[cycle][1]
    now = _now_ms()
    base = max(now, _ms(team.get('paidUntil')))
    until = base + days * 864e5
    method = (pay.get('method') or {}).get('type') or ''
    receipt = pay.get('receiptUrl') or ''
    test = (pay.get('channel') or {}).get('type') == 'TEST'
    writes = [
        {'update': {'name': f'{DOCS}/payments/{pid}', 'fields': {
            'teamId': {'stringValue': team_id}, 'uid': {'stringValue': ouid}, 'plan': {'stringValue': plan},
            'cycle': {'stringValue': cycle}, 'amount': {'integerValue': str(price)}, 'pg': {'stringValue': 'portone-inicis'},
            'txId': {'stringValue': pay.get('transactionId') or ''}, 'method': {'stringValue': method}, 'receiptUrl': {'stringValue': receipt},
            'from': {'timestampValue': _ts(base)}, 'until': {'timestampValue': _ts(until)},
            'test': {'booleanValue': test}, 'createdAt': {'timestampValue': _ts(now)}}},
         'currentDocument': {'exists': False}},
        {'update': {'name': f'{DOCS}/teams/{team_id}', 'fields': {
            'paidUntil': {'timestampValue': _ts(until)}, 'plan': {'stringValue': plan}, 'planCycle': {'stringValue': cycle},
            'status': {'stringValue': 'active'}, 'lastPaidAt': {'timestampValue': _ts(now)}}},
         'updateMask': {'fieldPaths': ['paidUntil', 'plan', 'planCycle', 'status', 'lastPaidAt']},
         'currentDocument': {'exists': True}},
        {'update': {'name': f'{DOCS}/payOrders/{pid}', 'fields': {'status': {'stringValue': 'done'}}},
         'updateMask': {'fieldPaths': ['status']}, 'currentDocument': {'exists': True}},
    ]
    cr = ses.post(f'{FS}:commit', json={'writes': writes}, timeout=15)
    if cr.status_code != 200:
        # 화면 · 알림이 거의 동시에 왔으면 다른 쪽이 이미 저장했을 수 있음
        again = ses.get(f'{FS}/payOrders/{_q(pid)}', timeout=10)
        if again.status_code == 200 and _str(again.json().get('fields', {}), 'status') == 'done':
            return 200, {'ok': True, 'again': True, 'paymentId': pid}
        _cancel(pid, '자동 취소: 이용기간 저장 실패')
        return 500, {'ok': False, 'message': '결제를 저장하지 못해서 자동으로 취소했어요 (돈은 나가지 않아요). 잠시 후 다시 해 주세요.'}
    return 200, {'ok': True, 'paymentId': pid}


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

    def _qs(self):
        return urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

    def _json(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'{}')

    def do_GET(self):
        if (self._qs().get('step') or [''])[0] != 'result':
            return self._fail(404, '없는 주소예요.')
        pid = (self._qs().get('paymentId') or [''])[0]
        try:
            uid = _uid_of(self.headers)
        except Exception:  # noqa: BLE001
            return self._fail(401, '로그인이 풀렸어요. 다시 로그인해 주세요.')
        ses = _session()
        if not ses:
            return self._fail(500, '서버 설정이 아직 안 됐어요.')
        pr = ses.get(f'{FS}/payments/{_q(pid)}', timeout=10)
        if pr.status_code != 200:
            return self._fail(404, '결제 기록을 찾지 못했어요. 돈이 나갔다면 운영자에게 문의해 주세요.')
        f = pr.json().get('fields', {})
        if _str(f, 'uid') != uid:
            return self._fail(403, '내 결제가 아니에요.')
        plan, cycle = _str(f, 'plan'), _str(f, 'cycle')
        return self._send(200, {'ok': True, 'planName': PLANS.get(plan, ('',))[0], 'cycle': CYCLES.get(cycle, ('',))[0],
                                'until': _kst(_ms(f.get('until'))), 'receiptUrl': _str(f, 'receiptUrl')})

    def do_POST(self):  # noqa: C901
        step = (self._qs().get('step') or [''])[0]
        try:
            q = self._json()
        except Exception:  # noqa: BLE001
            return self._fail(400, '요청이 올바르지 않아요.')
        if step == 'webhook':
            # 포트원 결제 완료 알림 — 알림 내용은 믿지 않고 paymentId 로 포트원에서 다시 읽어 확인
            pid = str(((q.get('data') or {}).get('paymentId')) or '')
            ses = _session()
            if pid and ses and str(q.get('type') or '').startswith('Transaction.Paid'):
                _complete(ses, pid)
            return self._send(200, {'ok': True})
        if step not in ('start', 'complete'):
            return self._fail(404, '없는 주소예요.')
        try:
            uid = _uid_of(self.headers)
        except Exception:  # noqa: BLE001
            return self._fail(401, '로그인이 풀렸어요. 다시 로그인해 주세요.')
        ses = _session()
        if not ses:
            return self._fail(500, '서버 설정이 아직 안 됐어요. 운영자에게 문의해 주세요.')
        if step == 'complete':
            code, res = _complete(ses, str(q.get('paymentId') or ''), uid)
            return self._send(code, res)
        # ── start ──
        team_id, plan, cycle = str(q.get('teamId') or ''), str(q.get('plan') or ''), str(q.get('cycle') or '')
        if plan not in PLANS or cycle not in CYCLES or not team_id or not team_id.replace('_', '').isalnum():
            return self._fail(400, '주문 정보가 올바르지 않아요.')
        if not (_env('PORTONE_STORE_ID') and _env('PORTONE_CHANNEL_KEY') and _env('PORTONE_API_SECRET')):
            return self._fail(500, '결제 설정이 아직 안 됐어요. 운영자에게 문의해 주세요.')
        tr = ses.get(f'{FS}/teams/{team_id}', timeout=10)
        if tr.status_code != 200:
            return self._fail(404, '팀을 찾지 못했어요.')
        if _str(tr.json().get('fields', {}), 'ownerUid') != uid:
            return self._fail(403, '팀 대표 지도자만 결제할 수 있어요.')
        plan_name, month = PLANS[plan]
        cyc_label, _days, mult = CYCLES[cycle]
        price = month * mult
        now = _now_ms()
        pid = f'{team_id}-{plan}-{cycle}-{now}'  # 영문 · 숫자 · '-' 만 (포트원: ASCII 만)
        # 주문 먼저 기록 (결제가 끝났을 때 누가 · 무엇을 · 얼마에 샀는지는 이 기록으로만 판단)
        cr = ses.post(f'{FS}:commit', json={'writes': [{'update': {'name': f'{DOCS}/payOrders/{pid}', 'fields': {
            'uid': {'stringValue': uid}, 'teamId': {'stringValue': team_id}, 'plan': {'stringValue': plan}, 'cycle': {'stringValue': cycle},
            'price': {'integerValue': str(price)}, 'status': {'stringValue': 'ready'}, 'createdAt': {'timestampValue': _ts(now)}}},
            'currentDocument': {'exists': False}}]}, timeout=15)
        if cr.status_code != 200:
            return self._fail(500, '주문을 만들지 못했어요. 잠시 후 다시 해 주세요.')
        return self._send(200, {'ok': True, 'storeId': _env('PORTONE_STORE_ID'), 'channelKey': _env('PORTONE_CHANNEL_KEY'),
                                'paymentId': pid, 'orderName': f'싸카매니저 {plan_name} {cyc_label}', 'totalAmount': price})
