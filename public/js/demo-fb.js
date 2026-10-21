import { ADMIN_EMAILS } from './config.js';
// 체험 모드: 진짜 Firebase 대신 쓰는 가짜 데이터 (브라우저 메모리에만 — 실제 회원 데이터는 건드리지 않음)
// 쓰는 곳: 실제 사이트의 demo.html (import map 으로 js/fb.js 를 이 파일로 바꿔 끼움) · 개발용 dev-server.py --demo
// In-memory mock of the Firebase surface used by the app
import { formationData, blank } from './tactic.js';
const store = new Map();
class Ts { constructor(ms) { this._ms = ms; } toMillis() { return this._ms; } toDate() { return new Date(this._ms); } }
const now = () => new Ts(Date.now());
export const Timestamp = { fromMillis: (ms) => new Ts(ms) };
const U = 'uCoach';
// 이 컴퓨터에서 개발할 때만 (로컬 영상 · 운영자 미리보기)
const LOCAL = typeof location !== 'undefined' && (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /^192\.168\./.test(location.hostname));
const seed = (p, d) => store.set(p, d);
const later = Timestamp.fromMillis(Date.now() + 20 * 864e5);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = ymd(new Date());
seed(`users/${U}`, { name: '김코치', role: 'coach', agree: { ver: 'demo', terms: 'demo' }, email: 'c@x.com', teamId: 'T1', position: '', photo: '', coachTitle: '수석코치', duty: 'U15 담당', licenses: 'KFA B급, GK 3급', school: '성남중 - 풍생고 - 용인대', career: '2019~2022 FC 블랙 U12 코치\n2023~ FC 블랙 U15 수석코치' });
seed('teams/T1', { name: 'FC 블랙', category: 'U15', isPublic: true, ownerUid: U, ownerName: '김코치', createdAt: Timestamp.fromMillis(Date.now() - 30 * 864e5), status: 'active', paidUntil: later, intro: '테스트 팀' });
seed('teams/T2', { name: '화이트 유나이티드', category: 'K7', isPublic: false, ownerUid: 'x', ownerName: '백감독', free: true, createdAt: Timestamp.fromMillis(Date.now() - 12 * 864e5), status: 'active', paidUntil: later });
seed('teams/T3', { name: '그레이 FC', category: 'U15', isPublic: true, ownerUid: 'y', ownerName: '최감독', free: true, createdAt: Timestamp.fromMillis(Date.now() - 5 * 864e5), status: 'active', paidUntil: later });
seed(`teams/T1/members/${U}`, { name: '김코치', role: 'coach', coachTitle: '수석코치', duty: 'U15 담당', licenses: 'KFA B급, GK 3급', school: '성남중 - 풍생고 - 용인대', career: '2019~2022 FC 블랙 U12 코치\n2023~ FC 블랙 U15 수석코치' });
seed('users/p1', { name: '박선수', role: 'player', agree: { ver: 'demo', terms: 'demo' }, email: 'p@x.com', teamId: 'T1', position: 'ST', number: '9', height: '175', weight: '65', affiliation: '블랙중 3학년' });
seed('teams/T1/members/c2', { name: '최코치', role: 'coach', coachTitle: 'GK 코치' });
seed('teams/T1/members/p1', { name: '박선수', role: 'player', affiliation: '블랙중 3학년', position: 'ST', number: '9', height: '175', weight: '65' });
seed('teams/T1/members/p2', { name: '이선수', role: 'player', position: 'GK', number: '1' });
seed('teams/T3/members/q1', { name: '최상대', role: 'player', position: 'CM', number: '8' });
// 운영자가 내보낸 예시 계정: 로그인 화면에서 old@x.com 으로 로그인하면 이유 안내가 보임
{ const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('old@x.com')))].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (LOCAL) seed(`expelled/${h}`, { email: 'old@x.com', name: '예전계정', reason: '· 지도자 / 선수 계정을 잘못 골랐어요\n지도자로 다시 가입한 뒤 팀 코드로 들어와 주세요.', at: Timestamp.fromMillis(Date.now() - 864e5), by: '운영자' }); }
seed('teams/T4', { name: '레드 유소년', category: 'U12', isPublic: true, ownerUid: 'z', ownerName: '정감독', free: true, createdAt: Timestamp.fromMillis(Date.now() - 2 * 864e5), status: 'active', paidUntil: later, intro: 'U12 공개 팀' });
seed('teams/T4/members/z', { name: '정감독', role: 'coach' });
seed('teams/T4/members/r1', { name: '한유망', role: 'player', affiliation: '레드초 6학년', position: 'LW', number: '11', height: '148', weight: '38', birthYear: '2014' });
seed('teams/T4/members/r2', { name: '오수비', role: 'player', position: 'CB', number: '4', height: '152', weight: '41', birthYear: '2014' });
seed('teams/T1/private/billing', { code: 'Xk7mQ2pR9a', paidUntil: later });
seed('teamCodes/Xk7mQ2pR9a', { teamId: 'T1' });
seed('system/features', { teams: { T1: { wellness: true } } }); // 데모: FC 블랙에 '컨디션 엑셀' 켜 둠
[['T2', 'Wp4nHs8eKd'], ['T3', 'Gr7tYb2mQx'], ['T4', 'Rd5uNc9vJa']].forEach(([t, c]) => { seed(`teamCodes/${c}`, { teamId: t }); seed(`teams/${t}/private/billing`, { code: c }); });
// 게임모델 패턴 (체험용): 빌드업 · 공격 · 수비 · 전환 · 세트피스 — 일부는 장면(움직임)까지
const PATTERNS = (() => {
  const base = (f, away = false) => { const d = formationData(f, away); d.items.forEach((x, i) => { x.id = `i${i}`; }); return d; };
  const pl = (d, n, team = 'a') => d.items.find((x) => x.k === 'player' && x.team === team && String(x.n) === String(n));
  const ball = (d) => d.items.find((x) => x.k === 'ball');
  const arrow = (style, x1, y1, x2, y2, extra = {}) => ({ id: `a${Math.random().toString(36).slice(2, 7)}`, k: 'arrow', style, x1, y1, x2, y2, ...extra });
  const out = [];
  { // 빌드업: 골킥 짧게 — 센터백이 벌리고 수비형 미드가 내려와 3명
    const d = base('4-3-3'); const gk = pl(d, 1); const cb1 = pl(d, 3); const cb2 = pl(d, 4); const dm = pl(d, 6);
    const b = ball(d); b.x = gk.x + 2; b.y = gk.y;
    d.anim = true; d.steps = [{ [cb1.id]: [cb1.x - 6, 12], [cb2.id]: [cb2.x - 6, 56], [dm.id]: [dm.x - 10, 34] }, { [b.id]: [cb2.x - 6, 56] }, { [b.id]: [dm.x - 10, 34] }];
    d.items.push(arrow('pass', gk.x + 2, gk.y, cb2.x - 6, 56), arrow('pass', cb2.x - 6, 56, dm.x - 10, 34, { order: 2 }));
    out.push({ id: 'pt1', title: '골킥 짧게 — 센터백 벌리고 6번 내려오기', cat: '빌드업', note: '골킥 때 센터백 둘(3 · 4번)은 페널티박스 양 끝까지 벌려요.\n6번은 두 센터백 사이로 내려와서 받을 준비.\n상대가 압박을 안 오면 짧게, 3명 이상 오면 9번에게 길게.', pad: d });
  }
  { // 빌드업: 풀백 올리고 3-2
    const d = base('4-3-3'); const lb = pl(d, 2); const rb = pl(d, 5); d.anim = true; const dm = pl(d, 6);
    d.steps = [{ [lb.id]: [lb.x + 25, lb.y], [rb.id]: [rb.x + 25, rb.y], [dm.id]: [dm.x - 8, 34] }];
    d.items.push(arrow('run', lb.x, lb.y, lb.x + 24, lb.y), arrow('run', rb.x, rb.y, rb.x + 24, rb.y), { id: 'z1', k: 'zone', style: 'dash', x: 22, y: 18, w: 18, h: 32 });
    out.push({ id: 'pt2', title: '3-2 빌드업 (양 풀백 높게)', cat: '빌드업', note: '두 풀백(2 · 5번)은 하프라인 근처까지 높게 올라가고, 6번이 센터백 사이로 내려가 3명이 돼요.\n점선 영역 안에서 3 대 2 를 만들어 상대 첫 압박을 넘겨요.', pad: d });
  }
  { // 공격: 오른쪽 오버래핑 → 컷백
    const d = base('4-3-3'); const rb = pl(d, 5); const rw = pl(d, 11); const st = pl(d, 10); const cm = pl(d, 8); d.anim = true;
    const b = ball(d); b.x = rw.x - 4; b.y = rw.y;
    d.items.push(arrow('run', rb.x, rb.y, 92, 62, { via: [{ x: 70, y: 64 }] }), arrow('dribble', rw.x, rw.y, rw.x + 6, rw.y - 10), arrow('pass', 92, 62, 86, 40, { order: 2 }), arrow('run', st.x, st.y, 98, 36, { order: 2 }), arrow('run', cm.x, cm.y, 84, 42, { order: 2 }));
    out.push({ id: 'pt3', title: '오른쪽 오버래핑 → 컷백', cat: '공격', note: '11번이 안쪽으로 치고 들어가면 5번(오른쪽 풀백)은 바깥으로 전력질주.\n5번은 엔드라인 근처에서 낮게 컷백, 10번은 니어로 끌고 8번이 페널티 지점으로 들어와 마무리.', pad: d });
  }
  { // 수비: 미들블록 · 압박 신호
    const d = base('4-4-2', true);
    d.items.push({ id: 'z2', k: 'zone', style: 'fill', c: '#ff3b30', x: 40, y: 0, w: 25, h: 68 }, { id: 't1', k: 'text', t: '여기 들어오면 압박', x: 52.5, y: 6 });
    out.push({ id: 'pt4', title: '미들블록 — 하프라인 앞에서 압박 시작', cat: '수비', note: '평소엔 4-4-2 로 하프라인 뒤에서 간격을 지켜요.\n상대가 빨간 영역으로 공을 몰고 오면 가까운 두 명이 바로 압박, 나머지는 공 쪽으로 좁혀요.\n뒤로 돌리는 패스가 신호 — 그때 한 줄 올라가요.', pad: d });
  }
  { // 전환: 공 뺏기면 5초 역압박
    const d = base('4-3-3'); const b = ball(d); b.x = 70; b.y = 24;
    const near = [pl(d, 9), pl(d, 10), pl(d, 7)].filter(Boolean);
    near.forEach((p) => d.items.push(arrow('run', p.x, p.y, 70 + (p.x > 70 ? 3 : -3), 24 + (p.y > 24 ? 4 : -4))));
    d.items.push({ id: 'z3', k: 'zone', shape: 'ellipse', style: 'dash', c: '#ffd400', x: 60, y: 14, w: 20, h: 20 }, { id: 't2', k: 'text', t: '5초', x: 70, y: 11 });
    out.push({ id: 'pt5', title: '뺏기면 5초 역압박', cat: '전환', note: '공을 잃은 곳에서 가장 가까운 3명(9 · 10 · 7번)이 5초 동안 바로 덤벼요.\n5초 안에 못 뺏으면 그때 내려가서 다시 자리 잡기.', pad: d });
  }
  { // 세트피스: 오른쪽 코너킥 니어 런
    const d = blank('full'); d.anim = true; d.items = [];
    const P = (n, x, y) => { const it = { id: `c${n}`, k: 'player', team: 'a', n: String(n), x, y }; d.items.push(it); return it; };
    P(7, 104, 66); P(9, 92, 40); P(4, 88, 30); P(5, 86, 46); P(10, 80, 34); P(11, 76, 52);
    d.items.push({ id: 'cb', k: 'ball', x: 104, y: 67 }, arrow('run', 92, 40, 99, 30, { order: 1 }), arrow('run', 88, 30, 96, 36, { order: 1 }), arrow('run', 86, 46, 95, 42, { order: 1 }), arrow('pass', 104, 66, 99, 30, { via: [{ x: 102, y: 46 }], order: 2 }));
    out.push({ id: 'pt6', title: '오른쪽 코너킥 — 니어 포스트 런', cat: '세트피스', note: '7번이 오른발 인스윙으로 니어 포스트.\n9번이 니어로 뛰어 머리로 방향만 바꾸고, 4번 · 5번은 골문 앞으로.\n10번은 박스 밖 세컨드볼, 11번은 역습 대비.', pad: d });
  }
  { // 세트피스 수비: 코너킥 지역 수비
    const d = blank('full'); d.anim = true; d.items = [];
    [[1, 103, 34], [2, 102, 27], [3, 102, 41], [4, 98, 26], [5, 98, 34], [6, 98, 42], [8, 92, 30], [7, 92, 40], [9, 88, 34], [10, 70, 22], [11, 70, 50]].forEach(([n, x, y]) => d.items.push({ id: `d${n}`, k: 'player', team: 'a', n: String(n), x, y }));
    d.items.push({ id: 'zz', k: 'zone', style: 'fill', c: '#4ea1ff', x: 96, y: 23, w: 8.5, h: 22 }, { id: 't3', k: 'text', t: '지역 5명', x: 100, y: 20 });
    out.push({ id: 'pt7', title: '코너킥 수비 — 지역 5명 + 대인 2명', cat: '세트피스', note: '골 에어리어 앞 5명(2 · 3 · 4 · 5 · 6번)이 지역을 지키고, 7 · 8번은 상대 키 큰 선수 2명을 대인 마크.\n9번은 페널티 지점 세컨드볼, 10 · 11번은 하프라인 쪽에서 역습 출발.', pad: d });
  }
  return out;
})();
seed('teams/T1/private/gameModel', { philosophy: '점유', captain: 'p1', formation: '4-3-3', patterns: PATTERNS });
seed('teams/T1/posts/a', { type: 'notice', title: '10월 리그 일정 및 원정 버스 안내', body: '토요일 원정 경기 버스는 7시 30분 출발합니다.', createdAt: now(), pinned: true });
seed('teams/T1/posts/a2', { type: 'notice', title: '이번 주 훈련 집중 포인트: 압박 탈출', body: '받기 전에 어깨 너머 보기! 일지에 꼭 적어오세요.', createdAt: now() });
// 미팅룸 예시 (체험용)
{ const ago = (d) => Timestamp.fromMillis(Date.now() - d * 864e5); const dd = (d) => ymd(new Date(Date.now() - d * 864e5));
  seed('teams/T1/posts/mt1', { type: 'meeting', title: '주말 리그 상대 분석 — 화이트 유나이티드', date: dd(0), opponent: '화이트 유나이티드', authorName: '김코치', createdAt: ago(0),
    body: '상대 기본 4-4-2 · 골킥은 거의 롱볼.\n9번이 등지고 받아 측면으로 펼치는 패턴이 많음 → 센터백 한 명은 무조건 붙고, 6번이 세컨볼.\n세트피스: 코너킥 니어 포스트로 두 명이 달려옴.\n\n우리 약속: 전반 20분까지는 라인 높게, 뺏기면 5초 역압박.',
    links: [{ name: '상대 경기 영상 (전반 하이라이트)', url: 'https://www.youtube.com/' }, { name: '전술 PPT', url: 'https://drive.google.com/' }, { name: '세트피스 정리 PDF', url: 'https://drive.google.com/' }] });
  seed('teams/T1/posts/mt2', { type: 'meeting', title: '세트피스 미팅 — 코너킥 수비 위치', date: dd(2), authorName: '최코치', createdAt: ago(2),
    body: '지역 4명 + 대인 3명.\n니어 포스트 앞 공간은 7번 · 11번이 책임.\n골키퍼 앞을 가리는 상대는 4번이 밀어내기.',
    links: [{ name: '코너킥 수비 그림', url: 'https://drive.google.com/' }] });
  seed('teams/T1/posts/mt3', { type: 'meeting', title: '지난 경기 리뷰 — 그레이 FC (1:1)', date: dd(6), opponent: '그레이 FC', authorName: '김코치', createdAt: ago(6),
    body: '잘된 점: 3-2 빌드업 · 6번이 계속 받아 줌.\n아쉬운 점: 왼쪽 풀백이 올라간 뒤 뒷공간 커버가 늦음 (실점 장면).\n이번 주 훈련: 풀백 올라갈 때 반대 센터백이 옆으로 밀어 주기.',
    links: [{ name: '실점 장면 클립', url: 'https://www.youtube.com/' }, { name: '분석 리포트', url: 'https://drive.google.com/' }] }); }
seed('teams/T1/posts/b', { type: 'schedule', title: '리그전', date: today, time: '10:00', kind: '경기', group: 'U15', createdAt: now() });
[[1, '16:00', '훈련', 'U12', '패스 훈련'], [2, '17:00', '훈련', 'U15', '빌드업 훈련'], [3, '10:00', '경기', 'U12', '연습경기 vs 성남'], [5, '19:00', '미팅', '', '전술 미팅'], [6, '16:00', '훈련', 'U15', '세트피스'], [8, '', '휴식', '', '휴식일']]
  .forEach(([n, time, kind, group, title], i) => { const d = new Date(); d.setDate(d.getDate() + n); seed(`teams/T1/posts/s${i}`, { type: 'schedule', title, date: ymd(d), time, kind, group, place: kind === '경기' ? '탄천 보조구장' : '팀 훈련장', createdAt: now() }); });
const board = (type, color, grid, items, w, h) => { const b = blank(type); b.field.color = color; if (w) { b.field.w = w; b.field.h = h; } b.grid = grid; b.items = items; return b; };
const P = (team, n, x, y) => ({ k: 'player', team, n: String(n), x, y });
const rondo = board('custom', 'white', { preset: 'none', cols: 0, rows: 0 }, [
  { k: 'zone', style: 'fill', x: 2, y: 2, w: 8, h: 8 },
  { k: 'cone', x: 2, y: 2 }, { k: 'cone', x: 10, y: 2 }, { k: 'cone', x: 2, y: 10 }, { k: 'cone', x: 10, y: 10 },
  P('a', 1, 6, 1), P('a', 2, 11, 6), P('a', 3, 6, 11), P('a', 4, 1, 6), P('c', 1, 5, 5), P('c', 2, 7, 7),
  { k: 'ball', x: 6.8, y: 1.2 }, { k: 'arrow', style: 'pass', x1: 6, y1: 1, x2: 10.6, y2: 5.4 }, { k: 'arrow', style: 'run', x1: 1, y1: 6, x2: 3.5, y2: 9.5 },
], 12, 12);
const sideBuild = board('half', 'green', { preset: 'lanes5', cols: 0, rows: 5 }, [
  P('a', 1, 4, 34), P('a', 2, 12, 10), P('a', 4, 10, 28), P('a', 6, 22, 30), P('a', 8, 28, 16), P('a', 7, 32, 5), P('a', 9, 40, 22),
  P('b', 1, 50, 34), P('b', 3, 40, 12), P('b', 5, 42, 28), P('b', 8, 30, 24), P('b', 7, 24, 12), P('b', 9, 18, 22),
  { k: 'zone', style: 'dash', x: 0, y: 0, w: 52.5, h: 27.2 }, { k: 'text', t: '포워드 존', x: 46, y: 6 },
  { k: 'ball', x: 12, y: 12 }, { k: 'arrow', style: 'pass', x1: 12, y1: 10, x2: 27, y2: 15.5 }, { k: 'arrow', style: 'run', x1: 32, y1: 5, x2: 44, y2: 4 },
]);
const transition = board('custom', 'dark', { preset: 'custom', cols: 3, rows: 1 }, [
  { k: 'minigoal', x: 0.6, y: 15 }, { k: 'minigoal', x: 44.4, y: 15, rot: 180 },
  P('a', 1, 6, 6), P('a', 2, 6, 24), P('a', 3, 12, 15), P('b', 1, 20, 8), P('b', 2, 22, 22), P('b', 3, 26, 15), P('c', 1, 34, 6), P('c', 2, 34, 24), P('c', 3, 39, 15),
  { k: 'ball', x: 13.5, y: 15 }, { k: 'arrow', style: 'dribble', x1: 13, y1: 16, x2: 21, y2: 16 },
], 45, 30);
const gk = board('box', 'white', { preset: 'none', cols: 0, rows: 0 }, [
  P('j', 'GK', 33, 25), P('b', 9, 18, 21), { k: 'ball', x: 19.5, y: 22 }, { k: 'arrow', style: 'run', x1: 33, y1: 25, x2: 29, y2: 23.5 },
  { k: 'marker', x: 20, y: 12 }, { k: 'marker', x: 20, y: 38 }, { k: 'text', t: '각 좁히기', x: 27, y: 33 },
]);
const tr = (id, d) => seed(`teams/T1/posts/${id}`, { type: 'training', authorName: '김코치', authorUid: U, createdAt: now(), date: today, ...d });
tr('c', { title: '써드맨 4v2 론도', topics: ['론도', '패스·리시빙'], ages: ['U12', 'U15'], players: 6, duration: 15, space: '12×12m', pad: rondo,
  body: '4명이 사각형 바깥, 2명이 안에서 압박. 2터치 제한, 10패스 성공 시 1점.', points: '공 받기 전에 어깨 너머로 확인하기\n몸을 열고 받아서 반대쪽으로\n패스 후 바로 각도 만들기' });
tr('c2', { title: '4-3-3 미들블럭 기초', topics: ['수비 전술'], ages: ['U15', 'U18'], players: 11, duration: 25, pad: formationData('4-3-3', true),
  points: '9번은 상대 6번 그림자 수비\n윙어는 안쪽 패스길 먼저 막기\n라인 간격 10~15m 유지' });
tr('c3', { title: '7v7 한 쪽 사이드 빌드업', topics: ['빌드업', '포지셔널 게임'], ages: ['U15', 'U18'], players: 15, duration: 20, space: '하프코트', pad: sideBuild });
tr('c4', { title: '3v3v3 전환 게임', topics: ['전환·역습', '포제션 게임'], ages: ['U12', 'U15', '성인'], players: 9, duration: 20, space: '45×30m', pad: transition, points: '공 뺏으면 3초 안에 앞으로\n뺏기면 가장 가까운 2명이 즉시 압박' });
// 움직임(장면) 예시: 윙어에게 패스 → 사이드백 오버래핑 → 크로스
const overlap = (() => { const d = formationData('4-2-3-1', false); d.items.forEach((x, i) => { x.id = `o${i}`; }); const rb = 'o4'; const rw = 'o9'; const ball = `o${d.items.length - 1}`;
  d.steps = [{ [ball]: [40, 54] }, { [rb]: [52, 64], [rw]: [50, 46] }, { [rb]: [80, 62], [ball]: [80, 62] }, { [ball]: [97, 34] }]; return d; })();
tr('c5', { title: '사이드백 오버래핑 + 크로스', topics: ['크로스·마무리', '공격 전술'], ages: ['U15'], players: 10, duration: 20, pad: overlap,
  points: '윙어가 안으로 좁혀 길 열어주기\n사이드백은 윙어 바깥으로 전력질주\n크로스는 낮고 빠르게' });
tr('c6', { title: '골키퍼 1v1 각 좁히기', topics: ['골키퍼'], ages: ['U12', 'U15', 'U18'], players: 4, duration: 15, pad: gk, points: '공보다 먼저 자세 낮추기\n각도 줄이며 앞으로 나가기' });
// 체험용 팀 목록: 여러 연령 · 리그 팀 30개 (모두 가상의 팀)
const DEMO_TEAMS = [
  ['한빛 FC', 'U12', '오감독'], ['새솔 유소년', 'U12', '윤감독'], ['푸른숲 FC U12', 'U12', '장감독'], ['다온 축구클럽', 'U12', '서감독'], ['별빛 키즈 FC', 'U12', '권감독'],
  ['청솔 FC U15', 'U15', '임감독'], ['하늘빛 유나이티드', 'U15', '조감독'], ['누리 FC', 'U15', '한감독'], ['은하 U15', 'U15', '배감독'], ['솔내 FC', 'U15', '신감독'], ['바람골 FC U15', 'U15', '유감독'],
  ['도담 FC U18', 'U18', '홍감독'], ['가람 유나이티드', 'U18', '고감독'], ['미르 FC', 'U18', '문감독'], ['라온 U18', 'U18', '양감독'], ['해솔 FC U18', 'U18', '송감독'],
  ['온누리 대학', 'U22', '안감독'], ['한울 FC U22', 'U22', '구감독'], ['새벽 유나이티드', 'U22', '노감독'],
  ['동네축구 연합', 'K5·6·7', '하감독'], ['한마음 FC', 'K5·6·7', '전감독'], ['토요 FC', 'K5·6·7', '남감독'], ['강변 유나이티드', 'K5·6·7', '심감독'],
  ['시티 레인저스', 'K3·4', '곽감독'], ['그린필드 FC', 'K3·4', '성감독'],
  ['메트로 FC', 'K1·2', '차감독'],
  ['블루윙 여자축구단', 'WK', '주감독'], ['하늘 여자 FC', 'WK', '우감독'],
  ['수요 풋살 모임', '기타', '민감독'], ['직장인 FC 퇴근후', '기타', '류감독'],
];
DEMO_TEAMS.forEach(([name, category, ownerName], i) => {
  const id = `X${String(i + 1).padStart(2, '0')}`;
  seed(`teams/${id}`, { name, category, isPublic: true, ownerUid: `o${id}`, ownerName, free: true, status: 'active', paidUntil: later, createdAt: Timestamp.fromMillis(Date.now() - (40 - i) * 864e5) });
  seed(`teams/${id}/members/o${id}`, { name: ownerName, role: 'coach' });
});
// 체험용 커뮤니티: 다른 팀 지도자들이 올린 훈련 공유 · 지도자 게시판 글 (댓글 포함)
{
  const prog = (id) => { const p = store.get(`teams/T1/posts/${id}`) || {}; return { title: p.title || '', topics: p.topics || [], ages: p.ages || [], players: p.players || '', duration: p.duration || '', space: p.space || '', body: p.body || '', points: p.points || '', pad: p.pad || null }; };
  const ago = (h) => Timestamp.fromMillis(Date.now() - h * 3600e3);
  const T = (i) => { const [name, category, ownerName] = DEMO_TEAMS[i]; const id = `X${String(i + 1).padStart(2, '0')}`; return { teamId: id, teamName: name, teamCategory: category, authorUid: `o${id}`, authorName: ownerName.replace('감독', '') + ['민준', '서준', '도윤', '하준', '지호', '준우', '현우', '건우'][i % 8] }; };
  let n = 0;
  const post = (who, cat, title, body, extra = {}, comments = []) => {
    const id = `cm${++n}`;
    seed(`community/${id}`, { cat, title, body, commentN: comments.length, ...who, createdAt: ago(n * 7), lastAt: ago(n * 5), ...extra });
    comments.forEach(([w, text], k) => seed(`community/${id}/comments/k${k}`, { body: text, uid: w.authorUid, name: w.authorName, teamId: w.teamId, teamName: w.teamName, createdAt: ago(n * 5 - k) }));
  };
  const share = (who, id, title, body, comments) => post(who, '훈련 공유', title, body, { share: { kind: 'program', program: { ...prog(id), title } } }, comments);
  share(T(6), 'c', '압박 속 써드맨 론도 (2터치)', '빌드업 첫 패스가 자꾸 끊겨서 이걸로 2주 했더니 확실히 좋아졌어요. 처음엔 3터치로 시작하세요.', [[T(11), '저희도 해 볼게요! 공간은 몇 m로 하셨어요?'], [T(6), '12×12에서 시작해서 10×10으로 줄였어요.']]);
  share(T(12), 'c3', '한 쪽 사이드 7v7 빌드업 게임', '풀백 · 윙어 · 중앙 미드 삼각형을 만드는 게 핵심이에요. 반대쪽 전환 패스에 보너스 점수.', [[T(1), 'U12에서도 5v5로 줄여서 써 봤는데 좋네요.']]);
  share(T(2), 'c4', '3팀 전환 게임 (공 뺏으면 바로 역습)', '빼앗긴 팀이 밖으로 나가고 기다리던 팀이 들어오는 방식이라 쉴 틈이 없어요. 체력 훈련 겸용.', []);
  share(T(9), 'c5', '오버래핑 → 낮고 빠른 크로스 마무리', '크로스는 무조건 낮고 빠르게. 니어 · 파 두 명이 꼭 들어가게 규칙을 걸었어요.', [[T(15), '좋은 자료 감사합니다. 저희 팀으로 가져갔어요!']]);
  share(T(4), 'c6', '골키퍼 1v1 각 좁히기 기본', 'GK 코치가 없는 팀도 할 수 있게 단순하게 만들었어요.', [[T(0), '초등부에 딱이네요 👍'.replace(' 👍', '')]]);
  share(T(14), 'c2', '4-3-3 미들블록 위치 잡기', '수비할 때 4-5-1로 내려서는 기준을 정리했어요. 상대 빌드업 때 윙어 위치가 핵심.', []);
  const talk = (who, title, body, comments) => post(who, '지도자 게시판', title, body, {}, comments);
  talk(T(7), '11월 둘째 주 U15 연습경기 상대 구해요', '토요일 오전 10시 · 저희 학교 인조잔디(주차 가능) · 11 vs 11 · 전후반 35분\n연락은 팀 페이지 → 팀에 연락하기로 주세요.', [[T(10), '저희 가능합니다! 연락드릴게요.']]);
  talk(T(19), '겨울 실내 훈련 장소 어디 쓰세요?', '12월부터 운동장이 얼어서 실내 풋살장 알아보는 중인데, 시간당 비용이 어느 정도인지 궁금합니다.', [[T(21), '저희는 평일 저녁 2시간 12만 원 정도예요.'], [T(28), '학교 체육관 대관도 알아보세요. 훨씬 싸요.']]);
  talk(T(0), '[대회] 12월 U12 유소년 페스티벌 참가팀 모집', '조별 리그 후 토너먼트 · 8 vs 8 · 참가비 팀당 10만 원\n관심 있는 팀은 댓글 남겨 주세요.', [[T(1), '참가하고 싶어요!'], [T(3), '저희도요. 일정표 나오면 공유 부탁드려요.']]);
  talk(T(16), '선수들 일지 쓰게 하는 팁 있나요?', '처음엔 잘 쓰다가 2주 지나면 반으로 줄어요. 다들 어떻게 하세요?', [[T(12), '코치가 매일 한 줄이라도 답을 달아 주니까 확실히 늘었어요.'], [T(5), '주간 MVP를 일지 많이 쓴 선수로 뽑았어요 ㅎㅎ']]);
  talk(T(24), '[테스트] 내년 U18 입단 테스트 안내', '1월 둘째 주 · 2009년생 대상 · 포지션별 테스트\n자세한 건 팀 페이지로 문의 주세요.', []);
  talk(T(26), '여자 축구팀 친선경기 하실 팀 있나요?', '성인 여자팀입니다. 주말 오후 아무 때나 괜찮아요!', [[T(27), '저희랑 해요! 연락드릴게요.']]);
}
// 데모 전용: 로컬에만 있는 경기 영상(public/__media/demo.m4v, 저장소에 안 올라감)으로 만든 AI 트래킹 예시
// 데모 경기분석 예시: 상대는 오른쪽(우리 왼쪽) 측면 공격 · 크로스가 많고, 후반에 몰아침
{ let sd = 7; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const ev = []; const add = (t, team, k, x, y) => ev.push({ id: `e${ev.length}`, t: Math.round(t), team, k, x: +x.toFixed(3), y: +y.toFixed(3) });
  for (let i = 0; i < 70; i++) {
    const t = rnd() < 0.6 ? 2700 + rnd() * 2700 : rnd() * 2700; const side = rnd() < 0.5 ? 0.82 + rnd() * 0.16 : rnd() < 0.5 ? 0.4 + rnd() * 0.2 : rnd() * 0.3;
    add(t, 'opp', 'attack', 0.45 + rnd() * 0.45, side);
  }
  for (let i = 0; i < 14; i++) add(rnd() * 5400, 'opp', 'cross', 0.78 + rnd() * 0.18, rnd() < 0.75 ? 0.86 + rnd() * 0.12 : 0.04 + rnd() * 0.1);
  for (let i = 0; i < 12; i++) add(rnd() * 5400, 'opp', 'shot', rnd() < 0.5 ? 0.86 + rnd() * 0.1 : 0.7 + rnd() * 0.12, 0.25 + rnd() * 0.5);
  add(3120, 'opp', 'goal', 0.93, 0.55); add(4410, 'opp', 'goal', 0.9, 0.42);
  for (let i = 0; i < 16; i++) add(rnd() * 5400, 'opp', 'loss', 0.15 + rnd() * 0.3, rnd() < 0.6 ? rnd() * 0.33 : 0.33 + rnd() * 0.6);
  for (let i = 0; i < 6; i++) add(rnd() * 5400, 'opp', 'setpiece', rnd() < 0.5 ? 0.99 : 0.75, rnd() < 0.5 ? 0.02 : 0.95);
  for (let i = 0; i < 40; i++) add(rnd() * 5400, 'us', 'attack', 0.45 + rnd() * 0.45, rnd());
  for (let i = 0; i < 8; i++) add(rnd() * 5400, 'us', 'shot', 0.75 + rnd() * 0.2, 0.3 + rnd() * 0.4);
  add(1500, 'us', 'goal', 0.92, 0.5);
  for (let i = 0; i < 12; i++) add(rnd() * 5400, 'us', 'loss', 0.2 + rnd() * 0.5, rnd());
  ev.sort((a, b) => a.t - b.t);
  seed('teams/T1/posts/match1', { type: 'analysis', mode: 'match', title: 'vs 그레이 FC 경기분석', opponent: '그레이 FC', date: '2026-10-04', oppDir: 'right',
    events: ev, // 영상은 데모에서 직접 열기 (내 컴퓨터 파일 · 유튜브 링크) formations: [{ id: 'f1', team: 'opp', name: '4-4-2', label: '전반', t: 30, ai: true, pad: (() => { const p = formationData('4-4-2', false); p.items.forEach((x) => { if (x.team) x.team = 'c'; }); return p; })() }],
    authorName: '김코치', createdAt: now() }); }
if (LOCAL) seed('teams/T1/posts/demo', { type: 'analysis', title: '연수구청U12 — 7번 수비 위치', opponent: '연수구청U12', date: '2026-03-14', video: { url: '/__media/demo.m4v', name: '연수구청U12 전력분석.m4v' }, createdAt: now(), tele: {"items":[{"id":"qwtgrlq","k":"spot","color":"#ffd400","t0":200,"t1":208,"hold":4,"p":{"tr":"onk11ig"},"size":0.025,"scale":1,"marker":true,"name":"7번"},{"id":"6bihjyc","k":"arrow","color":"#ffd400","t0":200,"t1":205,"hold":4,"a":{"tr":"onk11ig"},"b":{"x":0.66,"y":0.62},"style":"solid","c":{"x":0.55615,"y":0.74405}},{"id":"outarw","k":"arrow","color":"#4ea1ff","t0":200,"t1":204,"hold":4,"a":{"x":0.6,"y":0.62},"b":{"x":0.9,"y":0.27},"style":"solid","c":{"x":0.8,"y":0.5}}],"trackers":[{"id":"onk11ig","name":"선수 1","path":[[200,0.4523,0.8764,0.2239],[200.083,0.4518,0.8607,0.2227],[200.167,0.4519,0.8518,0.2157],[200.25,0.452,0.8597,0.2152],[200.333,0.452,0.8525,0.2145],[200.417,0.452,0.8632,0.2174],[200.5,0.4522,0.8558,0.2166],[200.583,0.4522,0.8611,0.2169],[200.667,0.4522,0.8519,0.2153],[200.75,0.452,0.8597,0.2145],[200.833,0.4522,0.8527,0.2145],[200.917,0.4518,0.8616,0.215],[201,0.4522,0.8525,0.2143],[201.083,0.4518,0.8598,0.2137],[201.167,0.4522,0.8513,0.2129],[201.25,0.4518,0.8603,0.2135],[201.333,0.4517,0.8602,0.2135],[201.417,0.4517,0.8602,0.2132],[201.5,0.4517,0.8603,0.2133],[201.583,0.4518,0.8591,0.2114],[201.667,0.4519,0.8601,0.2113],[201.75,0.4519,0.8595,0.2101],[201.833,0.4517,0.86,0.2114],[201.917,0.4517,0.8593,0.2114],[202,0.4512,0.8582,0.2143],[202.083,0.452,0.8675,0.2201],[202.167,0.452,0.8544,0.2159],[202.25,0.4516,0.8599,0.2147],[202.333,0.4518,0.867,0.2199],[202.417,0.4522,0.8544,0.2151],[202.5,0.4518,0.859,0.2143],[202.583,0.4518,0.8532,0.2131],[202.667,0.4517,0.8614,0.2145],[202.75,0.452,0.8523,0.2134],[202.833,0.4516,0.8607,0.2139],[202.917,0.4522,0.8524,0.2135],[203,0.4591,0.8454,0.2127],[203.083,0.4669,0.8477,0.2154],[203.167,0.4748,0.8506,0.2257],[203.25,0.4882,0.8403,0.2217],[203.333,0.4939,0.8315,0.2161],[203.417,0.5097,0.8199,0.2091],[203.5,0.5154,0.8073,0.2003],[203.583,0.5195,0.7931,0.1983],[203.667,0.5229,0.7717,0.1767],[203.75,0.5287,0.7788,0.1786],[203.833,0.5291,0.7547,0.1695],[203.917,0.5309,0.7416,0.1597],[204,0.5358,0.7364,0.1577],[204.083,0.5296,0.7155,0.1477],[204.167,0.5242,0.7008,0.1361],[204.25,0.5206,0.7009,0.1406],[204.333,0.5213,0.6966,0.1469],[204.417,0.5094,0.6808,0.1417],[204.5,0.5078,0.6773,0.1375],[204.583,0.5079,0.6658,0.1314],[204.667,0.4928,0.6497,0.1233],[204.75,0.4896,0.6535,0.1248],[204.833,0.4887,0.6471,0.1285],[204.917,0.48,0.6376,0.1277],[205,0.4705,0.6305,0.1265],[205.083,0.4645,0.6164,0.1243],[205.167,0.4598,0.6075,0.117],[205.25,0.4513,0.6068,0.117],[205.333,0.4485,0.6044,0.1193],[205.417,0.4381,0.5892,0.1141],[205.5,0.4354,0.5898,0.1135],[205.583,0.4327,0.5854,0.1162],[205.667,0.425,0.5716,0.1116],[205.75,0.4199,0.5667,0.1083],[205.833,0.4162,0.5613,0.1058],[205.917,0.4164,0.5617,0.1059],[206,0.407,0.5583,0.107],[206.083,0.3893,0.5323,0.1082],[206.167,0.4039,0.547,0.1034],[206.25,0.3888,0.5363,0.1074],[206.333,0.3885,0.5326,0.1106],[206.417,0.3882,0.5299,0.1088],[206.5,0.384,0.5237,0.106],[206.583,0.3816,0.5155,0.1037],[206.667,0.3822,0.5205,0.1024],[206.75,0.3783,0.5198,0.1017],[206.833,0.377,0.519,0.1034],[206.917,0.3771,0.5009,0.0953],[207,0.3667,0.5078,0.0899],[207.083,0.3713,0.5146,0.0927],[207.167,0.3579,0.5071,0.0885],[207.25,0.3559,0.5141,0.0887],[207.333,0.3545,0.511,0.0873],[207.417,0.3534,0.5038,0.0828],[207.5,0.3505,0.5048,0.0798],[207.583,0.3495,0.506,0.0764],[207.667,0.346,0.5112,0.0789],[207.75,0.343,0.5116,0.0775],[207.833,0.3417,0.5089,0.0765],[207.917,0.341,0.5051,0.0752],[208,0.3367,0.5092,0.075]],"h":0.075,"ar":0.325,"manual":false}],"set":{"chroma":true,"hue":100,"hueManual":false,"tol":40,"dur":5,"durEnd":false,"hold":2,"autoTrack":true}} });
seed('teams/T1/posts/d', { type: 'analysis', title: 'vs A', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', timeline: '1:20 압박', createdAt: now() });
seed('teams/T1/matches/m0', { date: '2025-11-08', matchType: '대회', ageGroup: 'U13', opponent: '성남FC U13', gf: 3, ga: 2, scorers: [{ name: '이선수', goals: 1 }], assists: [] });
seed('teams/T1/matches/m00', { date: '2025-09-20', matchType: '연습경기', ageGroup: 'U15', opponent: '수원 U15', gf: 1, ga: 1, scorers: [], assists: [] });
seed('teams/T1/matches/m1', { date: today, matchType: '리그', ageGroup: 'U15', opponent: 'A', gf: 2, ga: 1, scorers: [{ name: '박선수', goals: 2 }], assists: [] });
seed('teams/T1/matches/m2', { date: (() => { const d = new Date(); d.setDate(d.getDate() - 3); return ymd(d); })(), matchType: '스토브리그', ageGroup: 'U14', opponent: 'B', gf: 0, ga: 0, scorers: [], assists: [] });
seed('teams/T1/goals/g1', { scope: 'team', title: '리그 3위 이내', category: '결과 · 성적', period: '시즌', due: '2026-11-30', target: 3, current: 5, unit: '위', lower: true, desc: '남은 6경기 4승 이상', status: 'doing', ownerUid: U, createdAt: now() });
seed('teams/T1/goals/g3', { scope: 'team', title: '클린시트 10경기', category: '경기력', period: '시즌', target: 10, current: 4, unit: '경기', status: 'doing', ownerUid: U, createdAt: now() });
seed('teams/T1/goals/g4', { scope: 'team', title: '빌드업에서 롱볼 대신 짧은 패스 우선', category: '기술 · 전술', period: '월', progress: 60, status: 'doing', ownerUid: U, createdAt: now() });
seed('teams/T1/goals/g5', { scope: 'team', title: '훈련 지각 0명', category: '태도 · 팀문화', period: '분기', target: 0, status: 'done', ownerUid: U, createdAt: now() });
seed('teams/T1/goals/g2', { scope: 'personal', title: '왼발 패스 정확하게', category: '기술', why: '왼쪽에서 받으면 자꾸 오른발로 바꿔서 늦어요', how: '매일 벽 패스 왼발 50개', due: '2026-10-31', progress: 40, status: 'doing', ownerUid: 'p1', ownerName: '박선수', coachComment: '좋은 목표야! 훈련 끝나고 같이 해보자', coachChecked: true, createdAt: now() });
seed('teams/T1/goals/g6', { scope: 'personal', title: '공중볼 캐칭 자신감', category: '마음가짐', why: '크로스 올 때 무서워요', how: '매일 하이볼 캐칭 20개', progress: 20, status: 'doing', ownerUid: 'p2', ownerName: '이선수', createdAt: now() });
seed(`teams/T1/logs/p1_${today}`, {
  uid: 'p1', name: '박선수', date: today, condition: 2, sleep: 5.5, rpe: 7, trainMin: 90, sleepQ: 2, injury: 6, injuryPart: '발목', bedtime: '01:00', wakeTime: '06:30',
  kind: 'match', submitted: true, submittedAt: now(),
  sessions: {
    'dl1-0': { name: '웜업 · 동적 스트레칭', plan: '화요일 오후 훈련', focus: 4, good: '몸이 빨리 풀렸어요', hard: '', next: '' },
    'dl1-1': { name: '써드맨 4v2 론도', plan: '화요일 오후 훈련', focus: 3, good: '2터치 안에 패스 성공이 많았어요', hard: '압박 오면 당황해서 뺏겼어요', next: '받기 전에 어깨 너머로 보기', ask: '압박이 두 명 오면 뒤로 돌려야 하나요, 아니면 옆으로 빼야 하나요?' },
    'dl1-2': { name: '3v3v3 전환 게임', plan: '화요일 오후 훈련', focus: 5, good: '뺏고 바로 앞으로 패스', hard: '체력이 떨어졌어요', next: '전환할 때 소리 지르기' },
  },
  goalScore: 3, learned: '몸을 열고 받으면 시야가 넓어진다', tomorrow: '왼발 패스 50개',
  match: {
    opponent: 'A', type: '리그', gf: 2, ga: 1, minutes: 70, position: 'ST', rating: 8,
    good: '전반 20분 수비 뒷공간 침투해서 첫 골', bad: '후반에 압박을 안 해서 상대가 편하게 빌드업했어요', learned: '골은 움직임에서 나온다', next: '후반에도 끝까지 압박하기',
    scenes: [{ pad: { v: 2, field: { type: 'half', w: 52.5, h: 68, color: 'green' }, grid: { preset: 'none', cols: 0, rows: 0 }, items: [
      { k: 'player', team: 'a', n: '9', x: 30, y: 30 }, { k: 'player', team: 'a', n: '8', x: 18, y: 44 },
      { k: 'player', team: 'b', n: '4', x: 38, y: 28 }, { k: 'player', team: 'b', n: '5', x: 38, y: 40 }, { k: 'player', team: 'j', n: 'GK', x: 50, y: 34 },
      { k: 'ball', x: 19, y: 43 }, { k: 'arrow', style: 'pass', x1: 19, y1: 43, x2: 44, y2: 30 }, { k: 'arrow', style: 'run', x1: 31, y1: 30, x2: 44, y2: 31 },
    ] }, key: 'sc1', note: '8번이 공을 잡는 순간 수비 4번 뒤로 뛰어들어가서 골', ask: '이렇게 뒤로 뛸 때 오프사이드 안 걸리려면 언제 출발해야 해요?' }],
  },
});
{ const d2 = (() => { const d = new Date(); d.setDate(d.getDate() - 2); return ymd(d); })();
  seed(`teams/T1/logs/p1_${d2}`, { uid: 'p1', name: '박선수', date: d2, kind: 'train', condition: 4, sleep: 8, rpe: 3, trainMin: 60, sleepQ: 4, injury: 0, submitted: true, submittedAt: now(), checked: true, coachComment: '회복 훈련도 성실하게 잘했어!',
    sessions: { 'dl2-0': { name: '회복 조깅', focus: 4, good: '천천히 끝까지 뛰었어요', hard: '', next: '' }, 'dl2-1': { name: '스트레칭', focus: 3, good: '', hard: '햄스트링이 뻣뻣해요', next: '집에서도 스트레칭', ask: '햄스트링 스트레칭은 몇 초씩 하면 돼요?' } },
    answers: { 'dl2-1': { text: '한 번에 30초씩, 양쪽 3번! 반동 주지 말고 천천히 늘려 줘.', by: '김코치' } },
    learned: '회복도 훈련이다', tomorrow: '압박 탈출 연습' }); }
seed(`teams/T1/logs/p2_${today}`, { uid: 'p2', name: '이선수', date: today, condition: 4, sleep: 8, rpe: 4, trainMin: 90, sleepQ: 4, injury: 0 }); // 작성 중(미제출) 예시
// 데이터실 데모: 최근 30일 — 선수마다 다른 상황 (부상 · 피로 · 부하 급증 · 강도 약함 · 수면 불규칙 · 기록 부족)
[['p3', '최선수', 'CM', '8'], ['p4', '정선수', 'CB', '4'], ['p5', '강선수', 'RW', '7'], ['p6', '윤선수', 'LB', '3']]
  .forEach(([id, name, position, number]) => seed(`teams/T1/members/${id}`, { name, role: 'player', position, number }));
(() => {
  let r = 7; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const hhmm = (m) => { const t = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 5 ? t % 60 - (t % 5) : t % 60).padStart(2, '0')}`; };
  const cl = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));
  for (let back = 1; back < 31; back++) {
    const d = new Date(); d.setDate(d.getDate() - back);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const rest = back % 7 === 0;
    ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].forEach((id) => {
      if (store.has(`teams/T1/logs/${id}_${ds}`) || rnd() < 0.12) return;
      if (id === 'p6' && back < 8 && back !== 3) return; // 최근 기록 부족
      const recent = back <= 7;
      let cond = 3.8 + rnd() - 0.5; let rpe = 5 + rnd() * 2; let min = rest ? 0 : 75; let bed = 22 * 60 + 40 + rnd() * 30; let sleep = 470 + rnd() * 40; let inj = 0; let part = '';
      if (id === 'p1' && recent && back <= 4) { inj = back <= 2 ? 6 : 4; part = '오른쪽 무릎'; cond = 2.8; }
      if (id === 'p2' && recent) { cond = 4 - (7 - back) * 0.35; sleep = 340 + rnd() * 40; bed = 24 * 60 + 20; }
      if (id === 'p3' && recent) { rpe = 8 + rnd() * 1.5; min = rest ? 60 : 120; }
      if (id === 'p4') { rpe = recent ? 2.5 + rnd() : 4 + rnd(); cond = 4.4; }
      if (id === 'p5' && recent) { bed = (back % 2 ? 21 * 60 + 30 : 25 * 60 + 30) + rnd() * 20; sleep = back % 2 ? 560 : 360; }
      store.set(`teams/T1/logs/${id}_${ds}`, { uid: id, name: store.get(`teams/T1/members/${id}`).name, date: ds, submitted: true,
        condition: cl(cond, 1, 5), rpe: rest ? 1 : cl(rpe, 1, 10), trainMin: min, sleepQ: cl(sleep / 120, 1, 5),
        bedtime: hhmm(bed), wakeTime: hhmm(bed + sleep), injury: inj, injuryPart: part });
    });
  }
})();
seed('teams/T1/counsel/k1', { title: '진로', body: '고민', authorUid: 'p1', authorName: '박선수', createdAt: now(), status: 'open' });
seed('teams/T1/scouts/r1', { name: '한유망', uid: 'r1', position: 'LW', number: '11', height: '148', weight: '38', birthYear: '2014', affiliation: '레드초 6학년', teamId: 'T4', teamName: '레드 유소년', category: 'U12', note: '왼발 드리블 좋음, 1v1 자신감. 수비 가담 보완 필요', by: '김코치', createdAt: now() });
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
seed('teams/T1/posts/dl1', { type: 'daily', date: today, time: '16:00', place: '탄천 보조구장', title: '화요일 오후 훈련 — 압박 탈출', goal: '압박 받을 때 몸을 열고 받아서 반대쪽으로 빠져나가기', createdAt: now(), authorName: '김코치',
  blocks: [{ name: '웜업 · 동적 스트레칭', min: '15', desc: '조깅 → 스트레칭 → 스텝 사다리' }, { programId: 'c', name: '써드맨 4v2 론도', min: '15', desc: '2터치 제한, 10패스 = 1점' }, { programId: 'c4', name: '3v3v3 전환 게임', min: '20', desc: '뺏으면 3초 안에 앞으로!' }, { name: '정리 운동', min: '10' }],
  gear: '축구화, 정강이 보호대, 물 1L', memo: '토요일 리그전 명단은 목요일에 발표합니다.' });
seed('teams/T1/posts/dl2', { type: 'daily', date: day(-2), time: '16:00', place: '탄천 보조구장', title: '일요일 회복 훈련', goal: '가볍게 몸 풀기', createdAt: now(), authorName: '김코치', blocks: [{ name: '회복 조깅', min: '20' }, { name: '스트레칭', min: '15' }] });
seed('teams/T1/coachNotes/n1', { date: day(-2), attend: '14', intensity: '2', done: '회복 조깅\n스트레칭', good: '전원 참석, 분위기 좋음', improve: '스트레칭 집중도 낮음', players: '박선수 발목 통증 — 다음 훈련 강도 조절', next: '화요일 압박 탈출 론도', authorName: '김코치', authorUid: U, createdAt: now() });
seed(`users/${U}/todos/t1`, { text: '오후 훈련 콘 세팅', done: false, createdAt: now() });
seed(`users/${U}/todos/t2`, { text: '주말 리그전 명단 제출', done: true, createdAt: now() });
// 코치 노트 (체험용)
{ const ago = (d) => Timestamp.fromMillis(Date.now() - d * 864e5);
  seed(`users/${U}/notes/n1`, { cat: 'period', title: '리그 3주차 마이크로 사이클 (토요일 경기)', pinned: true, tags: ['U15', '부하관리'], body: '지난 경기 뒤 햄스트링 뻐근한 선수 2명 — MD-4 스프린트 양 줄이기.', data: { phase: '시즌 중 · 3주차', goal: '수비 전환 속도 · 경기 전 이틀은 부하 낮추기', rows: [
    { md: 'MD+1', day: '일', focus: '회복', load: '1', what: '출전 선수 회복 조깅 20분 · 미출전 선수 보충 훈련' },
    { md: 'MD+2', day: '월', focus: '휴식', load: '0', what: '' },
    { md: 'MD-4', day: '화', focus: '근력 · 소공간', load: '5', what: '4v4+3 론도 (20x25m) 4분 x 5세트 · 1v1 수비' },
    { md: 'MD-3', day: '수', focus: '지구력 · 대공간', load: '4', what: '9v9 전환 게임 (뺏으면 6초 안에 슈팅)' },
    { md: 'MD-2', day: '목', focus: '스피드 · 전술', load: '3', what: '11v0 빌드업 패턴 · 10m 스프린트 6회' },
    { md: 'MD-1', day: '금', focus: '활성화 · 세트피스', load: '2', what: '코너킥 니어 런 · 프리킥 벽' },
    { md: 'MD', day: '토', focus: '경기', load: '5', what: 'vs 화이트 유나이티드' }] }, createdAt: ago(3), updatedAt: ago(1) });
  seed(`users/${U}/notes/n2`, { cat: 'paper', title: '소공간 게임에서 인원 수에 따른 신체 부하 차이', tags: ['SSG', '논문'], body: '3v3은 심박이 높지만 고강도 달리기 거리는 대공간이 더 김 — 한 주에 둘 다 필요.', data: { authors: 'Hill-Haas 외', year: '2011', source: 'Sports Medicine', link: 'doi.org/10.2165/11539740-000000000-00000', summary: '인원이 적을수록(2v2 · 3v3) 심박수 · 젖산 · 자각도가 높아짐.\n공간을 넓히면 이동 거리와 고강도 달리기가 늘어남.\n규칙(터치 제한 · 코치 격려)도 강도를 바꿈.', apply: 'MD-4는 3v3~4v4 작은 공간, MD-3은 8v8 이상 큰 공간으로 나눠서 쓰기.' }, createdAt: ago(6), updatedAt: ago(5) });
  seed(`users/${U}/notes/n3`, { cat: 'think', title: '공을 잃은 뒤 5초 동안 우리는 무엇을 하나', tags: ['전환', '게임모델'], body: '지금은 가장 가까운 선수 혼자 달려가고 나머지는 멈춰서 본다.\n원하는 모습: 가장 가까운 3명이 공 쪽으로 좁히고, 뒤의 둘은 패스 길을 막는다.\n\n훈련에서 "뺏기면 5초" 규칙을 계속 걸어야 습관이 된다. 점수를 주자 — 5초 안에 다시 뺏으면 1점.', createdAt: ago(2), updatedAt: ago(2) });
  seed(`users/${U}/notes/n4`, { cat: 'review', title: '리그 2라운드 — 그레이 FC', tags: ['리그'], body: '', data: { date: today, opp: '그레이 FC', score: '1 : 1 무', good: '전반 빌드업 3-2가 잘 됨 · 6번이 계속 받아 줌', bad: '실점 장면: 왼쪽 풀백이 올라간 뒤 뒷공간 · 커버 늦음', next: '풀백 올라갈 때 반대 센터백이 옆으로 밀어 주는 움직임 연습' }, createdAt: ago(8), updatedAt: ago(8) }); }
seed('chats/p1_uCoach', { kind: 'member', teamId: 'T1', participants: ['p1', U], names: { [U]: '김코치', p1: '박선수' }, teams: { [U]: 'FC 블랙', p1: 'FC 블랙' }, updatedAt: now(), lastMessage: '내일 훈련 몇 시예요?' });
seed('chats/p1_uCoach/messages/1', { uid: 'p1', text: '내일 훈련 몇 시예요?', createdAt: now() });
seed('chats/uCoach_y', { kind: 'team', teamId: 'T3', fromTeamId: 'T1', participants: [U, 'y'], names: { [U]: '김코치', y: '그레이 FC' }, teams: { [U]: 'FC 블랙', y: '팀 계정' }, updatedAt: now(), lastMessage: '연습경기 가능할까요?' });
// 운영자 문의 예시
seed('support/T3', { teamId: 'T3', teamName: '그레이 FC', category: 'U15', lastMessage: '팀 코드를 다시 발급받을 수 있나요?', lastFrom: 'team', unreadAdmin: true, updatedAt: now() });
seed('support/T3/messages/1', { text: '안녕하세요! 팀 코드를 다시 발급받을 수 있나요? 졸업생에게 코드가 퍼져서요.', uid: 'y', name: '최감독', from: 'team', createdAt: Timestamp.fromMillis(Date.now() - 3600e3) });
seed('support/T3/messages/2', { text: '팀 코드를 다시 발급받을 수 있나요?', uid: 'y', name: '최감독', from: 'team', createdAt: now() });
seed('feedback/f1', { kind: '개선 제안', title: '일지검사에서 학년별로 보고 싶어요', body: 'U12, U15 같이 운영해서 학년 필터가 있으면 좋겠습니다.', status: '접수', uid: 'z', name: '정감독', role: 'coach', teamId: 'T4', teamName: '레드 유소년', createdAt: Timestamp.fromMillis(Date.now() - 86400e3) });
seed('feedback/f2', { kind: '질문', title: '영상은 몇 분까지 올릴 수 있나요?', body: '분석실에 경기 전체 영상을 올려도 되나요?', status: '답변 완료', reply: '네, 경기 전체 영상도 올릴 수 있어요.', repliedAt: now(), uid: U, name: '김코치', role: 'coach', teamId: 'T1', teamName: 'FC 블랙', createdAt: Timestamp.fromMillis(Date.now() - 2 * 86400e3) });
seed('chats/uCoach_y/messages/1', { uid: U, text: '연습경기 가능할까요?', createdAt: now() });

export const app = {}; export const storage = {}; export const functions = {}; export const db = {};
// ?new 로 열면 방금 가입한 새 계정(개인계정 · 팀 없음)으로 시작 — 가입 흐름 미리보기용
// ?out 으로 열면 로그아웃 상태(로그인 · 회원가입 화면부터) — 가입하면 새 계정, 로그인하면 김코치
const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
// ?warn 팀명 주의 받은 상태 · ?limit 기능 제한된 상태로 미리보기 (FC 블랙)
if (QS.has('warn')) Object.assign(store.get('teams/T1'), { nameWarn: { name: 'FC 블랙', at: Timestamp.now ? Timestamp.fromMillis(Date.now()) : null } });
if (QS.has('limit')) Object.assign(store.get('teams/T1'), { restricted: true });
const FRESH = QS.has('new');
// 데모 계정: 이메일 · 비밀번호 · 인증 여부를 이 브라우저에 기억 (새로고침해도 유지)
// 김코치 c@x.com / coach123 · 박선수(선수) p@x.com / player123
const ACC_KEY = 'ssaka.demo.accounts';
const BASE_ACC = { 'c@x.com': { pw: 'coach123', uid: U, verified: true }, 'p@x.com': { pw: 'player123', uid: 'p1', verified: true }, 'new@example.com': { pw: 'new123', uid: 'uNew', verified: true } };
const accounts = (() => { try { return { ...BASE_ACC, ...JSON.parse(localStorage.getItem(ACC_KEY) || '{}') }; } catch { return { ...BASE_ACC }; } })();
const saveAcc = () => { try { localStorage.setItem(ACC_KEY, JSON.stringify(accounts)); } catch { /* */ } };
const mkUser = (uid, email) => ({
  uid, email, emailVerified: !!accounts[email]?.verified,
  metadata: { creationTime: new Date(accounts[email]?.at || '2026-01-01').toUTCString() },
  async reload() { this.emailVerified = !!accounts[this.email]?.verified; },
  async getIdToken() { return 'demo'; },
});
// ?as=player 로 열면 선수(박선수)로 로그인된 상태
// ?as=admin 로 열면 운영자(김코치 + 운영자 이메일)로 로그인된 상태 — 운영자 페이지 미리보기용
const adminUser = () => Object.assign(mkUser(U, ADMIN_EMAILS[0]), { emailVerified: true, async reload() {} });
export const auth = { currentUser: QS.has('out') ? null : FRESH ? mkUser('uNew', 'new@example.com') : QS.get('as') === 'player' ? mkUser('p1', 'p@x.com') : (LOCAL && QS.get('as') === 'admin') ? adminUser() : mkUser(U, 'c@x.com') };
let authCb = () => {};
const setUser = (u) => { auth.currentUser = u; setTimeout(() => authCb(u), 0); };
// 데모에서 직접 가입한 계정의 프로필(users/u-…)도 이 브라우저에 기억
const PROF_KEY = 'ssaka.demo.profiles';
try { Object.entries(JSON.parse(localStorage.getItem(PROF_KEY) || '{}')).forEach(([k, v]) => store.set(k, v)); } catch { /* */ }
const saveProfiles = () => { try { localStorage.setItem(PROF_KEY, JSON.stringify(Object.fromEntries([...store].filter(([k]) => /^users\/u-[^/]+$/.test(k))))); } catch { /* */ } };
const authErr = (code) => Object.assign(new Error(code), { code });
auth.demo = true;
export const onAuthStateChanged = (_a, cb) => { authCb = cb; setTimeout(() => cb(auth.currentUser), 0); return () => {}; };
export const signOut = async () => setUser(null);
export const createUserWithEmailAndPassword = async (_a, email, pw) => {
  email = email.trim().toLowerCase();
  if (accounts[email]) throw authErr('auth/email-already-in-use');
  if ((pw || '').length < 6) throw authErr('auth/weak-password');
  accounts[email] = { pw, uid: 'u-' + email.replace(/[^a-z0-9]/g, ''), at: Date.now() };
  saveAcc();
  setUser(mkUser(accounts[email].uid, email));
};
// 소셜 로그인: 체험 모드에서는 쓰지 않음
export class GoogleAuthProvider { setCustomParameters() {} }
const noSocial = async () => { const e = new Error('체험 모드에서는 구글 · 카카오 로그인을 쓸 수 없어요. 아래 데모 계정으로 들어가 보세요.'); e.code = 'demo/social'; throw e; };
export const signInWithPopup = noSocial; export const signInWithRedirect = noSocial; export const signInWithCustomToken = noSocial;
export const signInWithEmailAndPassword = async (_a, email, pw) => {
  const acc = accounts[email.trim().toLowerCase()];
  if (!acc || acc.pw !== pw) throw authErr('auth/invalid-credential');
  setUser(mkUser(acc.uid, email.trim().toLowerCase()));
};
const demoMail = (html) => setTimeout(() => {
  document.querySelector('.demo-mail')?.remove();
  const w = document.createElement('div');
  w.className = 'demo-mail';
  w.innerHTML = `<div class="demo-mail-card">${html}<button class="btn ghost sm" type="button">닫기</button></div>`;
  w.querySelector('button').onclick = () => w.remove();
  document.body.appendChild(w);
}, 600);
// 데모: 이메일 인증 메일
export const sendEmailVerification = async (user) => {
  const link = `${location.pathname}?out&mode=verifyEmail&oobCode=VERIFY-${encodeURIComponent(user.email)}`;
  demoMail(`<span class="eyebrow">데모 · ${user.email} 받은편지함</span><strong>싸카매니저 이메일 인증</strong>
    <small>보낸사람 noreply@ssaka-manager.firebaseapp.com</small><p>아래 링크를 눌러 이메일 주소를 인증하세요.</p>
    <a class="btn sm" href="${link}">이메일 인증하기</a>`);
};
export const applyActionCode = async (_a, code) => {
  const email = String(code).startsWith('VERIFY-') ? decodeURIComponent(code.slice(7)) : '';
  if (!accounts[email] || accounts[email].verified) throw authErr('auth/invalid-action-code');
  accounts[email].verified = true;
  saveAcc();
};
// 데모: 실제 메일 대신 '받은 메일' 미리보기를 띄움 → 링크를 누르면 앱의 새 비밀번호 화면
export const sendPasswordResetEmail = async (_a, email) => {
  if (!/^\S+@\S+\.\S+$/.test(email || '')) throw authErr('auth/invalid-email');
  email = email.trim().toLowerCase();
  const known = !!accounts[email];
  const link = `${location.pathname}?out&mode=resetPassword&oobCode=DEMO-${encodeURIComponent(email)}&lang=ko`;
  setTimeout(() => {
    document.querySelector('.demo-mail')?.remove();
    const w = document.createElement('div');
    w.className = 'demo-mail';
    w.innerHTML = known ? `<div class="demo-mail-card"><span class="eyebrow">데모 · ${email} 받은편지함</span>
      <strong>싸카매니저 비밀번호 재설정</strong><small>보낸사람 noreply@ssaka-manager.firebaseapp.com</small>
      <p>안녕하세요. 아래 링크를 눌러 싸카매니저 비밀번호를 재설정하세요. 요청하지 않았다면 이 메일을 무시하세요.</p>
      <a class="btn sm" href="${link}">비밀번호 재설정하기</a><button class="btn ghost sm" type="button">닫기</button></div>`
      : `<div class="demo-mail-card"><span class="eyebrow">데모 · ${email}</span>
      <strong>가입되지 않은 이메일</strong><p>실제로는 이 주소로 메일이 가지 않아요. (보안상 화면에는 '보냈어요'로 똑같이 보입니다)</p>
      <button class="btn ghost sm" type="button">닫기</button></div>`;
    w.querySelector('button').onclick = () => w.remove();
    document.body.appendChild(w);
  }, 600);
};
export const verifyPasswordResetCode = async (_a, code) => {
  const email = String(code).startsWith('DEMO-') ? decodeURIComponent(code.slice(5)) : '';
  if (!accounts[email] || sessionStorage.getItem('used:' + code)) throw authErr('auth/invalid-action-code');
  return email;
};
export const confirmPasswordReset = async (_a, code, pw) => {
  if (pw.length < 6) throw authErr('auth/weak-password');
  const email = await verifyPasswordResetCode(_a, code);
  accounts[email].pw = pw;
  saveAcc();
  try { sessionStorage.setItem('used:' + code, '1'); } catch { /* */ } // 링크는 한 번만
};
export const updateProfile = async () => {};
export const EmailAuthProvider = { credential: (email, pw) => ({ email, pw }) };
export const reauthenticateWithCredential = async (u, c) => { if (accounts[u.email]?.pw !== c.pw) throw authErr('auth/invalid-credential'); };
export const deleteUser = async (u) => { delete accounts[u.email]; saveAcc(); setUser(null); };

const join = (parts) => parts.flatMap((p) => (typeof p === 'string' ? p.split('/') : [p.path])).join('/').replace(/^\/+/, '');
let auto = 0;
export const collection = (_db, ...p) => ({ path: join(p), kind: 'col' });
export const doc = (base, ...p) => {
  if (base && base.kind === 'col') return { path: join([base.path, ...(p.length ? p : ['auto' + (++auto)])]), kind: 'doc', get id() { return this.path.split('/').pop(); } };
  return { path: join(p), kind: 'doc', get id() { return this.path.split('/').pop(); } };
};
const snapDoc = (path) => ({ id: path.split('/').pop(), ref: { path, kind: 'doc', id: path.split('/').pop() }, exists: () => store.has(path), data: () => (store.has(path) ? structuredClone(store.get(path)) : undefined) });
// keep Timestamp methods through structuredClone
const fixTs = (o) => { if (o && typeof o === 'object') for (const k in o) { if (o[k] && o[k]._ms !== undefined) o[k] = Timestamp.fromMillis(o[k]._ms); else fixTs(o[k]); } return o; };
const sd = (path) => { const s = snapDoc(path); const d = s.data; s.data = () => fixTs(d()); return s; };
export const getDoc = async (r) => sd(r.path);
export const where = (f, op, v) => ({ t: 'w', f, op, v }); export const orderBy = (f, dir = 'asc') => ({ t: 'o', f, dir }); export const limit = (n) => ({ t: 'l', n });
export const query = (c, ...cs) => ({ ...c, cs });
const val = (v) => (v && v._ms !== undefined ? v._ms : v);
function run(q) {
  const depth = q.path.split('/').length + 1;
  let rows = [...store.keys()].filter((k) => k.startsWith(q.path + '/') && k.split('/').length === depth);
  for (const c of q.cs || []) {
    if (c.t === 'w') rows = rows.filter((k) => { const x = store.get(k)[c.f]; return { '==': x === c.v, '>=': x >= c.v, '<=': x <= c.v, '>': x > c.v, '<': x < c.v, 'array-contains': (x || []).includes(c.v), in: c.v.includes(x) }[c.op]; });
    if (c.t === 'o') rows.sort((a, b) => { const x = val(store.get(a)[c.f]); const y = val(store.get(b)[c.f]); return (x > y ? 1 : x < y ? -1 : 0) * (c.dir === 'desc' ? -1 : 1); });
    if (c.t === 'l') rows = rows.slice(0, c.n);
  }
  const docs = rows.map(sd);
  return { docs, empty: !docs.length, size: docs.length };
}
export const getDocs = async (q) => run(q);
export const onSnapshot = (q, cb) => { setTimeout(() => cb(run(q)), 0); return () => {}; };
const merge = (a, b) => { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && b[k]._ms === undefined && a[k] && typeof a[k] === 'object') merge(a[k], b[k]); else a[k] = b[k]; } return a; };
export const setDoc = async (r, d, o) => { store.set(r.path, o?.merge && store.has(r.path) ? merge(store.get(r.path), d) : d); saveProfiles(); };
export const addDoc = async (c, d) => { const r = doc(c); store.set(r.path, d); return r; };
export const updateDoc = async (r, d) => { if (!store.has(r.path)) throw new Error('no doc ' + r.path); Object.assign(store.get(r.path), d); saveProfiles(); };
export const deleteDoc = async (r) => { store.delete(r.path); };
export const serverTimestamp = now;
export const writeBatch = () => { const ops = []; return {
  set(r, d, o) { ops.push(() => setDoc(r, d, o)); }, update(r, d) { ops.push(() => updateDoc(r, d)); }, delete(r) { ops.push(() => deleteDoc(r)); },
  async commit() { for (const op of ops) await op(); } }; };
// 데모용 파일 저장소: 올린 파일을 브라우저 메모리에 보관 (새로고침하면 사라짐)
const files = new Map();
export const storageRef = (_s, path) => ({ path });
export const uploadBytes = async (r, file) => { files.set(r.path, file); };
export const uploadBytesResumable = (r, file) => ({
  on(_evt, progress, _err, done) {
    files.set(r.path, file);
    setTimeout(() => { progress({ bytesTransferred: file.size, totalBytes: file.size }); done(); }, 50);
  },
});
export const getDownloadURL = async (r) => {
  const f = files.get(r.path);
  if (!f) throw new Error('파일 없음: ' + r.path);
  return URL.createObjectURL(f);
};
export const httpsCallable = () => async () => ({ data: { code: 'ABC234', paidUntil: Date.now() } });
