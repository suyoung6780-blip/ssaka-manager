# 시제품 보안 규칙 시험 (로컬 에뮬레이터 전용 · demo-ssaka · 실제 Firebase에 닿지 않음)
import json, base64, time, urllib.request, urllib.error, sys

P = 'demo-ssaka'
HOST = 'http://127.0.0.1:8085'
BASE = f'{HOST}/v1/projects/{P}/databases/(default)/documents'

def tok(uid, email=None):
    if uid == 'owner': return 'owner'
    h = base64.urlsafe_b64encode(json.dumps({'alg': 'none', 'typ': 'JWT'}).encode()).rstrip(b'=').decode()
    now = int(time.time())
    body = {'iss': f'https://securetoken.google.com/{P}', 'aud': P, 'auth_time': now, 'user_id': uid, 'sub': uid, 'iat': now, 'exp': now + 3600,
            'email': email or f'{uid}@test.local', 'email_verified': True, 'firebase': {'identities': {}, 'sign_in_provider': 'password'}}
    b = base64.urlsafe_b64encode(json.dumps(body).encode()).rstrip(b'=').decode()
    return f'{h}.{b}.'

def enc(v):
    if v is None: return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, float): return {'doubleValue': v}
    if isinstance(v, str): return {'stringValue': v}
    if isinstance(v, list): return {'arrayValue': {'values': [enc(x) for x in v]}}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: enc(x) for k, x in v.items()}}}
    raise TypeError(v)
def fields(d): return {k: enc(v) for k, v in d.items()}

def req(method, url, who, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={'Authorization': f'Bearer {tok(who)}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(r) as res: return res.status, res.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()

def setdoc(path, d, who='owner'): return req('PATCH', f'{BASE}/{path}', who, {'fields': fields(d)})
def getdoc(path, who): return req('GET', f'{BASE}/{path}', who)
def deldoc(path, who): return req('DELETE', f'{BASE}/{path}', who)
def listq(colpath, who, field=None, value=None):
    parent, cid = colpath.rsplit('/', 1)
    q = {'structuredQuery': {'from': [{'collectionId': cid}]}}
    if field: q['structuredQuery']['where'] = {'fieldFilter': {'field': {'fieldPath': field}, 'op': 'EQUAL', 'value': enc(value)}}
    return req('POST', f'{BASE}/{parent}:runQuery', who, q)
def commit(writes, who):
    w = []
    for path, d in writes:
        w.append({'update': {'name': f'projects/{P}/databases/(default)/documents/{path}', 'fields': fields(d)}})
    return req('POST', f'{BASE}:commit', who, {'writes': w})

# ───── 초기화 · 가짜 데이터 ─────
req('DELETE', f'{HOST}/emulator/v1/projects/{P}/databases/(default)/documents', 'owner')
setdoc('users/coach', {'name': '김코치', 'role': 'coach', 'teamId': 'T1'})
setdoc('users/p1', {'name': '박선수', 'role': 'player', 'teamId': 'T1'})
setdoc('users/p2', {'name': '이선수', 'role': 'player', 'teamId': 'T1'})
setdoc('users/p9', {'name': '대기선수', 'role': 'player', 'teamId': 'T1'})
setdoc('users/c2', {'name': '다른팀코치', 'role': 'coach', 'teamId': 'T2'})
setdoc('teams/T1', {'name': 'FC 블랙', 'ownerUid': 'coach', 'status': 'active', 'free': True})
setdoc('teams/T2', {'name': '다른 팀', 'ownerUid': 'c2', 'status': 'active', 'free': True})
setdoc('teams/T1/members/coach', {'name': '김코치', 'role': 'coach'})
setdoc('teams/T1/members/p1', {'name': '박선수', 'role': 'player', 'approved': True})
setdoc('teams/T1/members/p2', {'name': '이선수', 'role': 'player', 'approved': True})
setdoc('teams/T1/members/p9', {'name': '대기선수', 'role': 'player', 'approved': False})
setdoc('teams/T2/members/c2', {'name': '다른팀코치', 'role': 'coach'})
setdoc('teams/T1/idp/p2_2026-10', {'uid': 'p2', 'month': '2026-10', 'pg': 'GK', 'tplVer': 'v3', 'status': 'submitted', 'answers': {'a': 3}, 'rev': 0})

results = []
def check(name, got, want):
    code = got[0]; ok = (code == 200) == want
    results.append((ok, name, 'allow' if want else 'deny', code))

M = '2026-10'
base_doc = {'uid': 'p1', 'month': M, 'pg': 'ST', 'tplVer': 'v3', 'status': 'draft', 'answers': {'pass#0': 3}, 'rev': 0, 'mode': 'base'}
# ── IDP: 선수 ──
check('선수: 내 자기평가 만들기 (작성 중)', setdoc(f'teams/T1/idp/p1_{M}', base_doc, 'p1'), True)
check('선수: 코치 칸을 넣어서 만들기', setdoc(f'teams/T1/idp/p1_2026-09', {**base_doc, 'month': '2026-09', 'coach': {'scores': {'pass': 5}}}, 'p1'), False)
check('선수: 다른 선수 이름으로 만들기', setdoc(f'teams/T1/idp/p2_2026-09', {**base_doc, 'uid': 'p2', 'month': '2026-09'}, 'p1'), False)
check('선수: 문서 이름과 달이 다르게 만들기', setdoc(f'teams/T1/idp/p1_2026-08', {**base_doc, 'month': '2026-07'}, 'p1'), False)
check('선수: 처음부터 확정 상태로 만들기', setdoc(f'teams/T1/idp/p1_2026-06', {**base_doc, 'month': '2026-06', 'status': 'confirmed'}, 'p1'), False)
check('승인 대기 선수: 자기평가 만들기', setdoc(f'teams/T1/idp/p9_{M}', {**base_doc, 'uid': 'p9'}, 'p9'), False)
check('선수: 내 답 고치고 제출', setdoc(f'teams/T1/idp/p1_{M}', {**base_doc, 'answers': {'pass#0': 4}, 'status': 'submitted'}, 'p1'), True)
check('선수: 제출한 뒤 코치 점수 칸 쓰기', setdoc(f'teams/T1/idp/p1_{M}', {**base_doc, 'status': 'submitted', 'answers': {'pass#0': 4}, 'coach': {'scores': {'pass': 5}}}, 'p1'), False)
check('선수: 스스로 확정으로 바꾸기', setdoc(f'teams/T1/idp/p1_{M}', {**base_doc, 'status': 'confirmed', 'answers': {'pass#0': 4}}, 'p1'), False)
check('선수: 내 자기평가 읽기', getdoc(f'teams/T1/idp/p1_{M}', 'p1'), True)
check('선수: 다른 선수 자기평가 읽기', getdoc('teams/T1/idp/p2_2026-10', 'p1'), False)
check('선수: 팀 전체 자기평가 목록', listq('teams/T1/idp', 'p1'), False)
check('선수: 내 것만 목록 (uid = 나)', listq('teams/T1/idp', 'p1', 'uid', 'p1'), True)
check('선수: 다른 선수 것 목록 (uid = p2)', listq('teams/T1/idp', 'p1', 'uid', 'p2'), False)
check('선수: 내 자기평가 지우기', deldoc(f'teams/T1/idp/p1_{M}', 'p1'), False)
check('선수: 제출 기록(history) 남기기', setdoc(f'teams/T1/idp/p1_{M}/history/s1', {'by': 'p1', 'what': 'submit', 'at': 'x'}, 'p1'), True)
check('선수: 확정 기록인 척 history 쓰기', setdoc(f'teams/T1/idp/p1_{M}/history/s2', {'by': 'p1', 'what': 'confirm', 'at': 'x'}, 'p1'), False)
# ── IDP: 코치 ──
check('코치: 선수 자기평가 읽기', getdoc(f'teams/T1/idp/p1_{M}', 'coach'), True)
check('코치: 팀 전체 목록', listq('teams/T1/idp', 'coach'), True)
check('코치: 선수 원래 답 바꾸기', setdoc(f'teams/T1/idp/p1_{M}', {**base_doc, 'status': 'submitted', 'answers': {'pass#0': 1}}, 'coach'), False)
sub = {**base_doc, 'status': 'submitted', 'answers': {'pass#0': 4}}
conf = {**sub, 'status': 'confirmed', 'rev': 1, 'coach': {'scores': {'pass': 3}, 'reasons': {'pass': '영상 확인'}}, 'confirmedBy': 'coach', 'confirmedByName': '김코치', 'confirmedAt': 'x'}
check('코치: 바꾼 기록 없이 확정', setdoc(f'teams/T1/idp/p1_{M}', conf, 'coach'), False)
check('코치: 다른 사람 이름으로 확정', commit([(f'teams/T1/idp/p1_{M}/history/1', {'by': 'coach', 'at': 'x'}), (f'teams/T1/idp/p1_{M}', {**conf, 'confirmedBy': 'p2'})], 'coach'), False)
check('코치: 확정 + 바꾼 기록 한 번에', commit([(f'teams/T1/idp/p1_{M}/history/1', {'by': 'coach', 'at': 'x', 'what': 'confirm'}), (f'teams/T1/idp/p1_{M}', conf)], 'coach'), True)
check('선수: 확정된 뒤 내 답 고치기', setdoc(f'teams/T1/idp/p1_{M}', {**conf, 'answers': {'pass#0': 5}}, 'p1'), False)
check('코치: 바꾼 기록 고치기', setdoc(f'teams/T1/idp/p1_{M}/history/1', {'by': 'coach', 'at': 'y', 'what': 'confirm'}, 'coach'), False)
check('코치: 바꾼 기록 지우기', deldoc(f'teams/T1/idp/p1_{M}/history/1', 'coach'), False)
check('코치: 자기평가 지우기', deldoc(f'teams/T1/idp/p1_{M}', 'coach'), False)
check('코치: 다시 확정 (rev 2 + 기록 2)', commit([(f'teams/T1/idp/p1_{M}/history/2', {'by': 'coach', 'at': 'x', 'what': 'reconfirm'}), (f'teams/T1/idp/p1_{M}', {**conf, 'rev': 2, 'coach': {'scores': {'pass': 4}}})], 'coach'), True)
check('코치: rev를 건너뛰어 확정 (rev 4)', commit([(f'teams/T1/idp/p1_{M}/history/4', {'by': 'coach', 'at': 'x'}), (f'teams/T1/idp/p1_{M}', {**conf, 'rev': 4})], 'coach'), False)
check('다른 팀 코치: 우리 선수 자기평가 읽기', getdoc(f'teams/T1/idp/p1_{M}', 'c2'), False)
check('다른 팀 코치: 우리 팀 목록', listq('teams/T1/idp', 'c2'), False)
# ── IDP 설정 ──
check('코치: 묻는 양 · 마감 설정', setdoc('teams/T1/idpConfig/main', {'mode': 'base', 'due': 10}, 'coach'), True)
check('선수: 설정 읽기', getdoc('teams/T1/idpConfig/main', 'p1'), True)
check('선수: 설정 바꾸기', setdoc('teams/T1/idpConfig/main', {'mode': 'full', 'due': 0}, 'p1'), False)
# ── 경기분석 작업 기록 (AI 후보) ──
check('코치: 작업 기록 쓰기', setdoc('teams/T1/matchWork/a1', {'scan': {'n': 3}}, 'coach'), True)
check('코치: 작업 기록 읽기', getdoc('teams/T1/matchWork/a1', 'coach'), True)
check('선수: AI 후보 · 작업 기록 읽기', getdoc('teams/T1/matchWork/a1', 'p1'), False)
check('선수: 작업 기록 쓰기', setdoc('teams/T1/matchWork/a2', {'x': 1}, 'p1'), False)
# ── 연동된 기존 칸 ──
check('선수: IDP 추천으로 내 목표 만들기', setdoc('teams/T1/goals/g1', {'scope': 'personal', 'title': '스캐닝', 'ownerUid': 'p1', 'idp': {'ab': 'scan', 'month': M}}, 'p1'), True)
check('선수: 다른 선수 목표 만들기', setdoc('teams/T1/goals/g2', {'scope': 'personal', 'title': 'x', 'ownerUid': 'p2'}, 'p1'), False)
check('코치: 경기 기록에 득점자 UID 저장', setdoc('teams/T1/matches/m1', {'opponent': 'A', 'gf': 1, 'ga': 0, 'scorers': [{'uid': 'p1', 'name': '박선수', 'goals': 1}]}, 'coach'), True)
check('선수: 경기 기록 고치기', setdoc('teams/T1/matches/m1', {'opponent': 'A', 'gf': 9, 'ga': 0}, 'p1'), False)
check('선수: 경기 기록 읽기', getdoc('teams/T1/matches/m1', 'p1'), True)

bad = [r for r in results if not r[0]]
for ok, name, want, code in results: print(('통과' if ok else '실패'), '·', name, '· 기대', want, '· 결과', code)
print(f'\n{len(results) - len(bad)}/{len(results)} 통과')
sys.exit(1 if bad else 0)
