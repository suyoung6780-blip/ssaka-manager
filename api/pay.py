# Vercel 서버 함수: /api/pay — 포트원(PortOne V2) · KG이니시스 결제 → 팀 이용기간 연장
#  ?step=start    (POST JSON · 로그인 열쇠) 팀 대표 · 금액 확인 → 주문(payOrders/{paymentId}) 만들고 결제창에 넣을 값 돌려줌
#  ?step=complete (POST JSON · 로그인 열쇠) 결제창이 끝나면: 포트원에서 결제를 다시 읽어 금액 · 상태 · 주문 확인 → 이용기간 연장
#  ?step=webhook  (POST · 포트원이 보냄) 결제 완료 알림 — 화면이 중간에 닫혀도 연장되게 (같은 확인을 서버끼리 다시 함)
#  ?step=result   (GET · 로그인 열쇠) 끝난 주문 결과 (완료 창에 보여 줄 요금제 · 기간)
# 정기결제 (1개월 요금제 — 매달 자동 결제, 12개월은 위처럼 한 번 결제):
#  ?step=subStart   (POST · 로그인 열쇠) 팀 대표 확인 → 카드 등록창(빌링키 발급)에 넣을 값 (mode: new 새로 · card 카드 바꾸기)
#  ?step=subConfirm (POST · 로그인 열쇠) 카드 등록이 끝나면: 빌링키 확인 → (새로) 첫 달 결제 + 다음 달 예약 / (카드 바꾸기) 예약만 새 카드로
#  ?step=subCancel  (POST · 로그인 열쇠) 정기결제 해지 — 예약 취소 · 빌링키 삭제 (이미 낸 기간은 끝까지 씀)
#  ?step=subRetry   (POST · 로그인 열쇠) 자동 결제가 실패했을 때 지금 다시 결제
#  ?step=subPlan    (POST · 로그인 열쇠) 다음 결제부터 요금제 바꾸기
#  webhook: 예약 결제가 끝나면(Transaction.Paid) 기간 연장 + 그 다음 달 예약 · 실패(Transaction.Failed)면 '결제 실패' 표시
#  저장: subs/{teamId} (대표 · 운영자만 읽음 — 상태 · 요금제 · 금액 · 다음 결제일 · 카드 이름) · subKeys/{teamId} (빌링키 — 서버만)
#        금액은 정기결제를 시작할 때 값 그대로 (출시 기념가로 시작한 팀은 계속 그 가격)
# 원칙: 금액은 늘 서버에서 요금표로 다시 계산 · 결제 정보는 화면이 보낸 값이 아니라 포트원에서 직접 읽음
#       · 주문을 만든 사람이 그 팀 대표인지 확인 · 금액이 다르거나 저장에 실패하면 결제를 바로 취소
# 필요한 설정 (Vercel 환경 변수):
#   GOOGLE_SA_JSON       — 이미 있음 (서비스 계정, Firestore 쓰기)
#   PORTONE_STORE_ID     — 포트원 콘솔 › 결제 연동 › 연동 정보 › 상점 아이디 (store-…)
#   PORTONE_CHANNEL_KEY  — 포트원 콘솔 › 결제 연동 › 채널 관리 › KG이니시스 채널의 채널 키 (channel-key-…) — 테스트 채널 → 심사 후 실연동 채널로 바꿈
#   PORTONE_API_SECRET   — 포트원 콘솔 › 결제 연동 › 연동 정보 › V2 API Secret (서버에만 · 화면 코드에 넣지 않음)
#   PORTONE_BILLING_CHANNEL_KEY — 정기결제(빌링)용 KG이니시스 채널 키 (일반 결제와 상점 아이디(MID)가 따로 나옴 · 없으면 정기결제 시작 안 됨)
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
PLANS = {'wonderkid': ('원더키드', 9900), 'gaffer': ('가퍼', 14900), 'grassroots': ('그래스루츠', 19900), 'rising': ('넌리그', 29900), 'pro': ('챔피언십', 44900), 'champion': ('프리미어', 59900)}
CYCLES = {'month': ('1개월', 30, 1), 'year': ('12개월', 365, 10)}
# 요금제 인원 (승인된 선수, 지도자) — public/js/config.js 의 players · coaches 와 같아야 함
CAPS = {'wonderkid': (1, 1), 'gaffer': (0, 1), 'grassroots': (10, 1), 'rising': (30, 3), 'pro': (50, 6), 'champion': (80, 10)}


def _oid(team_id, tag, ms, rnd=0):
    # 주문 번호: KG이니시스는 40자까지만 받음 → 팀 번호(20자까지) + 종류 + 시간(36진수 8자) [+ 무작위]
    n, b = int(ms), ''
    while n:
        n, r = divmod(n, 36)
        b = '0123456789abcdefghijklmnopqrstuvwxyz'[r] + b
    s = f'{team_id[:20]}-{tag}-{b or "0"}' + (f'-{os.urandom(rnd).hex()}' if rnd else '')
    return s[:40]


def _pc(plan):  # 요금제 한 글자 (주문 번호용)
    return str(list(PLANS).index(plan)) if plan in PLANS else 'x'


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
    sub = (o.get('sub') or {}).get('booleanValue', False)
    if plan not in PLANS or cycle not in CYCLES or price <= 0 or (not sub and price != PLANS[plan][1] * CYCLES[cycle][2]):
        return 400, {'ok': False, 'message': '주문 정보가 요금표와 달라요.'}
    code, pay = _portone('GET', f'/payments/{_q(pid)}')
    if code != 200:
        return 400, {'ok': False, 'message': '결제 정보를 확인하지 못했어요. 돈이 나갔다면 운영자에게 문의해 주세요.'}
    if pay.get('status') != 'PAID':
        if sub and pay.get('status') == 'FAILED':
            _sub_failed(ses, team_id, pid, ((pay.get('failure') or {}).get('reason') or '')[:120])
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
    # 첫 결제(팀도 사람도 처음): 결제일부터 7일 안 전액 환불 대상 — 한 번만 (환불받고 다시 결제해 또 환불받는 반복 막기)
    first = not team.get('firstPaidAt') and _get(ses, f'payers/{ouid}') is None
    writes = [
        {'update': {'name': f'{DOCS}/payments/{pid}', 'fields': {
            'teamId': {'stringValue': team_id}, 'uid': {'stringValue': ouid}, 'plan': {'stringValue': plan},
            'cycle': {'stringValue': cycle}, 'amount': {'integerValue': str(price)}, 'pg': {'stringValue': 'portone-inicis'},
            'txId': {'stringValue': pay.get('transactionId') or ''}, 'method': {'stringValue': method}, 'receiptUrl': {'stringValue': receipt},
            'from': {'timestampValue': _ts(base)}, 'until': {'timestampValue': _ts(until)},
            'test': {'booleanValue': test}, 'first': {'booleanValue': first}, 'createdAt': {'timestampValue': _ts(now)}}},
         'currentDocument': {'exists': False}},
        {'update': {'name': f'{DOCS}/teams/{team_id}', 'fields': {
            'paidUntil': {'timestampValue': _ts(until)}, 'plan': {'stringValue': plan}, 'planCycle': {'stringValue': cycle},
            'status': {'stringValue': 'active'}, 'lastPaidAt': {'timestampValue': _ts(now)}}},
         'updateMask': {'fieldPaths': ['paidUntil', 'plan', 'planCycle', 'status', 'lastPaidAt']},
         'currentDocument': {'exists': True}},
        {'update': {'name': f'{DOCS}/payOrders/{pid}', 'fields': {'status': {'stringValue': 'done'}}},
         'updateMask': {'fieldPaths': ['status']}, 'currentDocument': {'exists': True}},
    ]
    if first:
        writes[1]['update']['fields']['firstPaidAt'] = {'timestampValue': _ts(now)}
        writes[1]['updateMask']['fieldPaths'].append('firstPaidAt')
        writes.append({'update': {'name': f'{DOCS}/payers/{ouid}', 'fields': {
            'teamId': {'stringValue': team_id}, 'paymentId': {'stringValue': pid}, 'at': {'timestampValue': _ts(now)}}},
            'currentDocument': {'exists': False}})
    cr = ses.post(f'{FS}:commit', json={'writes': writes}, timeout=15)
    if cr.status_code != 200:
        # 화면 · 알림이 거의 동시에 왔으면 다른 쪽이 이미 저장했을 수 있음
        again = ses.get(f'{FS}/payOrders/{_q(pid)}', timeout=10)
        if again.status_code == 200 and _str(again.json().get('fields', {}), 'status') == 'done':
            return 200, {'ok': True, 'again': True, 'paymentId': pid}
        _cancel(pid, '자동 취소: 이용기간 저장 실패')
        return 500, {'ok': False, 'message': '결제를 저장하지 못해서 자동으로 취소했어요 (돈은 나가지 않아요). 잠시 후 다시 해 주세요.'}
    if sub:
        _sub_paid(ses, team_id, until)  # 다음 달 결제 예약 (실패해도 결제는 이미 끝남 — 상태에 '예약 실패' 표시)
    return 200, {'ok': True, 'paymentId': pid}


# ───────── 정기결제 ─────────
def _f(v):
    # 파이썬 값 → Firestore 값
    if isinstance(v, bool):
        return {'booleanValue': v}
    if isinstance(v, int):
        return {'integerValue': str(v)}
    if v is None:
        return {'nullValue': None}
    return {'stringValue': str(v)}


def _patch(ses, path, fields, ts=()):
    # 문서 일부만 바꿈 (ts: 시각으로 넣을 칸 — 값은 ms)
    body = {k: ({'timestampValue': _ts(v)} if k in ts and v else _f(v)) for k, v in fields.items()}
    mask = '&'.join(f'updateMask.fieldPaths={k}' for k in fields)
    r = ses.patch(f'{FS}/{path}?{mask}', json={'fields': body}, timeout=10)
    return r.status_code == 200


def _get(ses, path):
    r = ses.get(f'{FS}/{path}', timeout=10)
    return r.json().get('fields', {}) if r.status_code == 200 else None


def _customer(uid, name='', phone='', email=''):
    c = {'id': uid}
    if name:
        c['name'] = {'full': name}
    if phone:
        c['phoneNumber'] = phone
    if email:
        c['email'] = email
    return c


def _card_name(bk):
    # 빌링키 정보에서 '신한카드 · 1234' 같은 이름 (못 읽으면 빈 칸)
    code, info = _portone('GET', f'/billing-keys/{_q(bk)}')
    if code != 200:
        return None, ''
    ms = info.get('methods') or ([info.get('method')] if info.get('method') else [])
    card = next(((m or {}).get('card') or {} for m in ms if (m or {}).get('card')), {})
    num = ''.join(ch for ch in str(card.get('number') or '') if ch.isdigit())[-4:]
    return info, ' · '.join(x for x in [card.get('name') or card.get('issuer') or '', num] if x)


def _schedule(ses, team_id, at_ms):
    # at_ms(다음 결제일)에 결제 예약 + 주문 기록 (같은 날 예약은 한 번만)
    sb, sk = _get(ses, f'subs/{team_id}'), _get(ses, f'subKeys/{team_id}')
    if not sb or not sk or _str(sb, 'status') == 'off':
        return False
    plan, price, uid, bk = _str(sb, 'plan'), _int(sb, 'price'), _str(sb, 'uid'), _str(sk, 'billingKey')
    pid = _oid(team_id, f'{_pc(plan)}s', at_ms)  # 예약 결제: 같은 날 예약은 같은 번호 (한 번만)
    cr = ses.post(f'{FS}:commit', json={'writes': [{'update': {'name': f'{DOCS}/payOrders/{pid}', 'fields': {
        'uid': _f(uid), 'teamId': _f(team_id), 'plan': _f(plan), 'cycle': _f('month'), 'price': _f(price), 'sub': _f(True),
        'status': _f('scheduled'), 'createdAt': {'timestampValue': _ts(_now_ms())}}}, 'currentDocument': {'exists': False}}]}, timeout=15)
    if cr.status_code != 200:
        return _str(sb, 'nextPid') == pid  # 이미 예약함
    code, res = _portone('POST', f'/payments/{_q(pid)}/schedule', {
        'payment': {'billingKey': bk, 'orderName': f'싸카매니저 월간 이용권 ({PLANS[plan][0]})', 'customer': _customer(uid),
                    'amount': {'total': price}, 'currency': 'KRW'},
        'timeToPay': _ts(at_ms)[:19] + 'Z'})
    if code != 200:
        _patch(ses, f'payOrders/{pid}', {'status': 'schedule-failed'})
        _patch(ses, f'subs/{team_id}', {'status': 'error', 'note': '다음 결제 예약을 못 했어요'})
        return False
    sid = ((res.get('schedule') or {}).get('id')) or ''
    _patch(ses, f'subs/{team_id}', {'status': 'on', 'nextAt': at_ms, 'nextPid': pid, 'scheduleId': sid, 'note': ''}, ts=('nextAt',))
    return True


def _sub_paid(ses, team_id, until):
    _patch(ses, f'subs/{team_id}', {'lastPaidAt': _now_ms(), 'failedAt': None, 'note': ''}, ts=('lastPaidAt',))
    _schedule(ses, team_id, until)
    # 매달: 인원이 요금제를 넘었으면 표시 (대표 홈 · 결제 화면에 '요금제를 올려 주세요' · 운영자도 봄)
    sb = _get(ses, f'subs/{team_id}') or {}
    plan, n = _str(sb, 'plan'), _count(ses, team_id)
    if plan in CAPS and n is not None:
        _patch(ses, f'subs/{team_id}', {'over': n[0] > CAPS[plan][0] or n[1] > CAPS[plan][1], 'players': n[0], 'coaches': n[1]})


def _sub_failed(ses, team_id, pid, reason):
    _patch(ses, f'payOrders/{pid}', {'status': 'failed'})
    if _str(_get(ses, f'subs/{team_id}') or {}, 'status') in ('off', ''):
        return  # 해지했거나 첫 결제 실패로 시작하지 않은 정기결제
    _patch(ses, f'subs/{team_id}', {'status': 'failed', 'failedAt': _now_ms(), 'note': reason or '카드 결제가 안 됐어요'}, ts=('failedAt',))


def _revoke(ses, team_id, delete_key=True):
    # 예약 취소 (+ 빌링키 삭제). 남은 예약 주문은 '취소'로
    sk, sb = _get(ses, f'subKeys/{team_id}'), _get(ses, f'subs/{team_id}') or {}
    bk = _str(sk or {}, 'billingKey')
    if bk:
        _portone('DELETE', '/payment-schedules', {'storeId': _env('PORTONE_STORE_ID'), 'billingKey': bk})
        if delete_key:
            _portone('DELETE', f'/billing-keys/{_q(bk)}')
    if _str(sb, 'nextPid'):
        _patch(ses, f"payOrders/{_str(sb, 'nextPid')}", {'status': 'revoked'})
    return bk


def _charge_now(ses, team_id, uid, prof):
    # 빌링키로 지금 바로 한 달 결제 → _complete 로 기간 연장 (+ 다음 달 예약)
    sb, sk = _get(ses, f'subs/{team_id}'), _get(ses, f'subKeys/{team_id}')
    plan, price, bk = _str(sb, 'plan'), _int(sb, 'price'), _str(sk or {}, 'billingKey')
    now = _now_ms()
    pid = _oid(team_id, f'{_pc(plan)}n', now, 2)  # 지금 결제 (예약 결제는 '…s-{결제일}')
    cr = ses.post(f'{FS}:commit', json={'writes': [{'update': {'name': f'{DOCS}/payOrders/{pid}', 'fields': {
        'uid': _f(uid), 'teamId': _f(team_id), 'plan': _f(plan), 'cycle': _f('month'), 'price': _f(price), 'sub': _f(True),
        'status': _f('ready'), 'createdAt': {'timestampValue': _ts(now)}}}, 'currentDocument': {'exists': False}}]}, timeout=15)
    if cr.status_code != 200:
        return 500, {'ok': False, 'message': '주문을 만들지 못했어요. 잠시 후 다시 해 주세요.'}
    code, res = _portone('POST', f'/payments/{_q(pid)}/billing-key', {
        'billingKey': bk, 'orderName': f'싸카매니저 월간 이용권 ({PLANS[plan][0]})', 'customer': _customer(uid, *prof),
        'amount': {'total': price}, 'currency': 'KRW'})
    if code != 200:
        _sub_failed(ses, team_id, pid, str(res.get('message') or '')[:120])
        return 400, {'ok': False, 'message': f"카드 결제가 안 됐어요. {str(res.get('message') or '')[:80]}".strip()}
    return _complete(ses, pid, uid)


def _count(ses, team_id):
    # 승인된 선수 · 지도자 수 (화면에서만 막으면 우회할 수 있어서 결제 전에 서버가 다시 셈)
    players = coaches = 0
    tok = ''
    for _ in range(20):
        r = ses.get(f'{FS}/teams/{team_id}/members?pageSize=300' + (f'&pageToken={urllib.parse.quote(tok)}' if tok else ''), timeout=15)
        if r.status_code != 200:
            return None
        j = r.json()
        for d in j.get('documents', []):
            f = d.get('fields', {})
            if (f.get('approved') or {}).get('booleanValue', True) is False:
                continue
            role = _str(f, 'role')
            players += role == 'player'
            coaches += role == 'coach'
        tok = j.get('nextPageToken') or ''
        if not tok:
            break
    return players, coaches


def _plan_problem(ses, team_id, team, plan):
    # 이 요금제로 결제할 수 없는 이유 (없으면 '') — 공간 종류 · 인원
    kind = _str(team, 'kind') or 'team'
    if kind == 'personal' and plan != 'wonderkid':
        return '개인 계정은 원더키드 요금제만 고를 수 있어요.'
    if kind == 'gaffer' and plan != 'gaffer':
        return '지도자 계정은 가퍼 요금제만 고를 수 있어요.'
    if kind not in ('personal', 'gaffer') and plan in ('wonderkid', 'gaffer'):
        return '팀 계정은 그래스루츠 · 넌리그 · 챔피언십 · 프리미어 요금제 중에서 골라 주세요.'
    n = _count(ses, team_id)
    if n is None:
        return '팀 인원을 확인하지 못했어요. 잠시 후 다시 해 주세요.'
    cp, cc = CAPS[plan]
    if n[0] > cp or n[1] > cc:
        return f'승인된 인원(선수 {n[0]}명 · 지도자 {n[1]}명)이 {PLANS[plan][0]} 요금제(선수 {cp}명 · 지도자 {cc}명까지)보다 많아요. 더 큰 요금제를 골라 주세요.'
    return ''


def _owner_team(ses, uid, team_id):
    if not team_id or not team_id.replace('_', '').isalnum():
        return None, (400, '팀 정보가 올바르지 않아요.')
    t = _get(ses, f'teams/{team_id}')
    if t is None:
        return None, (404, '팀을 찾지 못했어요.')
    if _str(t, 'ownerUid') != uid:
        return None, (403, '팀 대표 지도자만 정기결제를 관리할 수 있어요.')
    return t, None


def _sub_step(ses, step, uid, q):  # noqa: C901
    # 돌려주는 값: (http 코드, 결과)
    team_id = str(q.get('teamId') or '')
    t, err = _owner_team(ses, uid, team_id)
    if err:
        return err[0], {'ok': False, 'message': err[1]}
    sb = _get(ses, f'subs/{team_id}') or {}
    on = _str(sb, 'status') in ('on', 'failed', 'error', 'starting')
    prof = (str(q.get('name') or '')[:40], ''.join(ch for ch in str(q.get('phone') or '') if ch.isdigit())[:11], str(q.get('email') or '')[:80])
    if step == 'subStart':
        mode, plan = str(q.get('mode') or 'new'), str(q.get('plan') or '')
        if not (_env('PORTONE_STORE_ID') and _env('PORTONE_BILLING_CHANNEL_KEY') and _env('PORTONE_API_SECRET')):
            return 500, {'ok': False, 'message': '정기결제 설정이 아직 안 됐어요. 운영자에게 문의해 주세요.'}
        if mode == 'new' and (plan not in PLANS or on):
            return 400, {'ok': False, 'message': '이미 정기결제 중이에요.' if on else '요금제를 다시 골라 주세요.'}
        if mode == 'card' and not on:
            return 400, {'ok': False, 'message': '정기결제 중이 아니에요.'}
        why = _plan_problem(ses, team_id, t, plan) if mode == 'new' else ''
        if why:
            return 400, {'ok': False, 'message': why}
        now = _now_ms()
        iid = _oid(team_id, 'bk', now, 3)
        cr = ses.post(f'{FS}:commit', json={'writes': [{'update': {'name': f'{DOCS}/subOrders/{iid}', 'fields': {
            'uid': _f(uid), 'teamId': _f(team_id), 'mode': _f(mode), 'plan': _f(plan if mode == 'new' else _str(sb, 'plan')),
            'price': _f(PLANS[plan][1] if mode == 'new' else _int(sb, 'price')), 'status': _f('ready'),
            'createdAt': {'timestampValue': _ts(now)}}}, 'currentDocument': {'exists': False}}]}, timeout=15)
        if cr.status_code != 200:
            return 500, {'ok': False, 'message': '잠시 후 다시 해 주세요.'}
        return 200, {'ok': True, 'storeId': _env('PORTONE_STORE_ID'), 'channelKey': _env('PORTONE_BILLING_CHANNEL_KEY'), 'issueId': iid,
                     'price': PLANS[plan][1] if mode == 'new' else _int(sb, 'price'),  # 카드 등록창에 보여 줄 상품 가격 (여기선 결제 안 됨)
                     'issueName': '싸카매니저 월간 이용권'}  # 결제창 상품명 칸이 좁아서 짧게 (요금제는 주문 기록에 남음)
    if step == 'subConfirm':
        iid, bk = str(q.get('issueId') or ''), str(q.get('billingKey') or '')
        o = _get(ses, f'subOrders/{_q(iid)}')
        if not o or _str(o, 'uid') != uid or _str(o, 'teamId') != team_id or not bk:
            return 404, {'ok': False, 'message': '카드 등록 정보를 찾지 못했어요.'}
        if _str(o, 'status') != 'ready':
            return 200, {'ok': True, 'again': True}
        info, card = _card_name(bk)
        if not info or info.get('status') != 'ISSUED' or ((info.get('customer') or {}).get('id') not in (None, uid)):
            return 400, {'ok': False, 'message': '카드 등록을 확인하지 못했어요. 다시 해 주세요.'}
        _patch(ses, f'subOrders/{_q(iid)}', {'status': 'done'})
        if _str(o, 'mode') == 'card':
            old = _revoke(ses, team_id, delete_key=False)
            _patch(ses, f'subKeys/{team_id}', {'billingKey': bk, 'uid': uid})
            if old and old != bk:
                _portone('DELETE', f'/billing-keys/{_q(old)}')
            _patch(ses, f'subs/{team_id}', {'card': card, 'nextPid': ''})
            nxt = _ms(sb.get('nextAt'))
            if _str(sb, 'status') == 'failed' or nxt <= _now_ms():
                return _charge_now(ses, team_id, uid, prof)  # 결제가 밀려 있으면 새 카드로 바로
            ok = _schedule(ses, team_id, nxt)
            return 200, {'ok': ok, 'message': '' if ok else '새 카드로 다음 결제를 예약하지 못했어요. 운영자에게 문의해 주세요.'}
        plan, price = _str(o, 'plan'), _int(o, 'price')
        why = _plan_problem(ses, team_id, t, plan)
        if why:
            _portone('DELETE', f'/billing-keys/{_q(bk)}')
            return 400, {'ok': False, 'message': why}
        _patch(ses, f'subKeys/{team_id}', {'billingKey': bk, 'uid': uid})
        _patch(ses, f'subs/{team_id}', {'uid': uid, 'plan': plan, 'price': price, 'status': 'starting', 'card': card,
                                        'startedAt': _now_ms(), 'nextAt': None, 'nextPid': '', 'note': ''}, ts=('startedAt',))
        code, res = _charge_now(ses, team_id, uid, prof)
        if not res.get('ok'):
            _revoke(ses, team_id)
            _patch(ses, f'subs/{team_id}', {'status': 'off', 'note': '첫 결제가 안 돼서 정기결제를 시작하지 않았어요'})
        return code, res
    if not on:
        return 400, {'ok': False, 'message': '정기결제 중이 아니에요.'}
    if step == 'subCancel':
        _revoke(ses, team_id)
        _patch(ses, f'subs/{team_id}', {'status': 'off', 'cancelledAt': _now_ms(), 'nextAt': None, 'nextPid': '', 'note': ''}, ts=('cancelledAt',))
        _patch(ses, f'subKeys/{team_id}', {'billingKey': ''})
        return 200, {'ok': True, 'until': _kst(_ms(t.get('paidUntil')))}
    if step == 'subRetry':
        if _str(sb, 'status') not in ('failed', 'error'):
            return 400, {'ok': False, 'message': '다시 결제할 것이 없어요.'}
        if _ms(t.get('paidUntil')) > _now_ms() + 864e5:  # 기간이 남아 있으면 예약만 다시
            ok = _schedule(ses, team_id, _ms(t.get('paidUntil')))
            return 200, {'ok': ok}
        return _charge_now(ses, team_id, uid, prof)
    if step == 'subPlan':
        plan = str(q.get('plan') or '')
        if plan not in PLANS or plan == _str(sb, 'plan'):
            return 400, {'ok': False, 'message': '바꿀 요금제를 골라 주세요.'}
        why = _plan_problem(ses, team_id, t, plan)
        if why:
            return 400, {'ok': False, 'message': why}
        _revoke(ses, team_id, delete_key=False)
        _patch(ses, f'subs/{team_id}', {'plan': plan, 'price': PLANS[plan][1], 'nextPid': ''})
        ok = _schedule(ses, team_id, _ms(sb.get('nextAt')) or _ms(t.get('paidUntil')))
        return 200, {'ok': ok, 'message': '' if ok else '다음 결제를 예약하지 못했어요. 운영자에게 문의해 주세요.'}
    return 404, {'ok': False, 'message': '없는 주소예요.'}


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
            typ = str(q.get('type') or '')
            if pid and ses and (typ.startswith('Transaction.Paid') or typ.startswith('Transaction.Failed')):
                _complete(ses, pid)  # 실패면 _complete 안에서 정기결제 '결제 실패' 표시
            return self._send(200, {'ok': True})
        if step not in ('start', 'complete', 'subStart', 'subConfirm', 'subCancel', 'subRetry', 'subPlan'):
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
        if step.startswith('sub'):
            code, res = _sub_step(ses, step, uid, q)
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
        if _str(_get(ses, f'subs/{team_id}') or {}, 'status') in ('on', 'failed', 'error', 'starting'):
            return self._fail(400, '정기결제 중이에요. 12개월로 바꾸려면 먼저 정기결제를 해지해 주세요 (낸 기간은 끝까지 써요).')
        if cycle == 'month':
            return self._fail(400, '1개월 요금제는 정기결제로만 결제돼요. 화면을 새로고침해 주세요.')
        why = _plan_problem(ses, team_id, tr.json().get('fields', {}), plan)
        if why:
            return self._fail(400, why)
        plan_name, month = PLANS[plan]
        cyc_label, _days, mult = CYCLES[cycle]
        price = month * mult
        now = _now_ms()
        pid = _oid(team_id, f'{_pc(plan)}{cycle[0]}', now)  # 영문 · 숫자 · '-' 만 (포트원: ASCII 만 · 이니시스 40자)
        # 주문 먼저 기록 (결제가 끝났을 때 누가 · 무엇을 · 얼마에 샀는지는 이 기록으로만 판단)
        cr = ses.post(f'{FS}:commit', json={'writes': [{'update': {'name': f'{DOCS}/payOrders/{pid}', 'fields': {
            'uid': {'stringValue': uid}, 'teamId': {'stringValue': team_id}, 'plan': {'stringValue': plan}, 'cycle': {'stringValue': cycle},
            'price': {'integerValue': str(price)}, 'status': {'stringValue': 'ready'}, 'createdAt': {'timestampValue': _ts(now)}}},
            'currentDocument': {'exists': False}}]}, timeout=15)
        if cr.status_code != 200:
            return self._fail(500, '주문을 만들지 못했어요. 잠시 후 다시 해 주세요.')
        return self._send(200, {'ok': True, 'storeId': _env('PORTONE_STORE_ID'), 'channelKey': _env('PORTONE_CHANNEL_KEY'),
                                'paymentId': pid, 'orderName': '싸카매니저 연간 이용권' if cycle == 'year' else '싸카매니저 월간 이용권', 'totalAmount': price})
