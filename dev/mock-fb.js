// 데모 모드(dev-server.py --demo)에서 js/fb.js 대신 제공되는 가짜 Firebase — 배포되지 않음
// In-memory mock of the Firebase surface used by the app
import { formationData, blank } from './tactic.js';
const store = new Map();
class Ts { constructor(ms) { this._ms = ms; } toMillis() { return this._ms; } toDate() { return new Date(this._ms); } }
const now = () => new Ts(Date.now());
export const Timestamp = { fromMillis: (ms) => new Ts(ms) };
const U = 'uCoach';
const seed = (p, d) => store.set(p, d);
const later = Timestamp.fromMillis(Date.now() + 20 * 864e5);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = ymd(new Date());
seed(`users/${U}`, { name: '김코치', role: 'coach', agree: { ver: 'demo' }, email: 'c@x.com', teamId: 'T1', position: '', photo: '', coachTitle: '수석코치', duty: 'U15 담당', licenses: 'KFA B급, GK 3급', school: '성남중 - 풍생고 - 용인대', career: '2019~2022 FC 블랙 U12 코치\n2023~ FC 블랙 U15 수석코치' });
seed('teams/T1', { name: 'FC 블랙', category: 'U15', isPublic: true, ownerUid: U, ownerName: '김코치', createdAt: Timestamp.fromMillis(Date.now() - 30 * 864e5), status: 'active', paidUntil: later, intro: '테스트 팀' });
seed('teams/T2', { name: '화이트 유나이티드', category: 'K7', isPublic: false, ownerUid: 'x', ownerName: '백감독', free: true, createdAt: Timestamp.fromMillis(Date.now() - 12 * 864e5), status: 'active', paidUntil: later });
seed('teams/T3', { name: '그레이 FC', category: 'U15', isPublic: true, ownerUid: 'y', ownerName: '최감독', free: true, createdAt: Timestamp.fromMillis(Date.now() - 5 * 864e5), status: 'active', paidUntil: later });
seed(`teams/T1/members/${U}`, { name: '김코치', role: 'coach', coachTitle: '수석코치', duty: 'U15 담당', licenses: 'KFA B급, GK 3급', school: '성남중 - 풍생고 - 용인대', career: '2019~2022 FC 블랙 U12 코치\n2023~ FC 블랙 U15 수석코치' });
seed('users/p1', { name: '박선수', role: 'player', agree: { ver: 'demo' }, email: 'p@x.com', teamId: 'T1', position: 'ST', number: '9', height: '175', weight: '65', affiliation: '블랙중 3학년' });
seed('teams/T1/members/p1', { name: '박선수', role: 'player', affiliation: '블랙중 3학년', position: 'ST', number: '9', height: '175', weight: '65' });
seed('teams/T1/members/p2', { name: '이선수', role: 'player', position: 'GK', number: '1' });
seed('teams/T3/members/q1', { name: '최상대', role: 'player', position: 'CM', number: '8' });
seed('teams/T4', { name: '레드 유소년', category: 'U12', isPublic: true, ownerUid: 'z', ownerName: '정감독', free: true, createdAt: Timestamp.fromMillis(Date.now() - 2 * 864e5), status: 'active', paidUntil: later, intro: 'U12 공개 팀' });
seed('teams/T4/members/z', { name: '정감독', role: 'coach' });
seed('teams/T4/members/r1', { name: '한유망', role: 'player', affiliation: '레드초 6학년', position: 'LW', number: '11', height: '148', weight: '38', birthYear: '2014' });
seed('teams/T4/members/r2', { name: '오수비', role: 'player', position: 'CB', number: '4', height: '152', weight: '41', birthYear: '2014' });
seed('teams/T1/private/billing', { code: 'Xk7mQ2pR9a', paidUntil: later });
seed('teamCodes/Xk7mQ2pR9a', { teamId: 'T1' });
seed('system/features', { teams: { T1: { wellness: true } } }); // 데모: FC 블랙에 '컨디션 엑셀' 켜 둠
[['T2', 'Wp4nHs8eKd'], ['T3', 'Gr7tYb2mQx'], ['T4', 'Rd5uNc9vJa']].forEach(([t, c]) => { seed(`teamCodes/${c}`, { teamId: t }); seed(`teams/${t}/private/billing`, { code: c }); });
seed('teams/T1/private/gameModel', { philosophy: '점유', captain: 'p1', formation: '4-3-3' });
seed('teams/T1/posts/a', { type: 'notice', title: '10월 리그 일정 및 원정 버스 안내', body: '토요일 원정 경기 버스는 7시 30분 출발합니다.', createdAt: now(), pinned: true });
seed('teams/T1/posts/a2', { type: 'notice', title: '이번 주 훈련 집중 포인트: 압박 탈출', body: '받기 전에 어깨 너머 보기! 일지에 꼭 적어오세요.', createdAt: now() });
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
tr('c5', { title: '사이드백 오버래핑 + 크로스', topics: ['크로스·마무리', '공격 전술'], ages: ['U15'], players: 10, duration: 20, pad: formationData('4-2-3-1', false) });
tr('c6', { title: '골키퍼 1v1 각 좁히기', topics: ['골키퍼'], ages: ['U12', 'U15', 'U18'], players: 4, duration: 15, pad: gk, points: '공보다 먼저 자세 낮추기\n각도 줄이며 앞으로 나가기' });
// 데모 전용: 로컬에만 있는 경기 영상(public/__media/demo.m4v, 저장소에 안 올라감)으로 만든 AI 트래킹 예시
seed('teams/T1/posts/demo', { type: 'analysis', title: '연수구청U12 — 7번 수비 위치', opponent: '연수구청U12', date: '2026-03-14', video: { url: '/__media/demo.m4v', name: '연수구청U12 전력분석.m4v' }, createdAt: now(), tele: {"items":[{"id":"qwtgrlq","k":"spot","color":"#ffd400","t0":200,"t1":208,"hold":4,"p":{"tr":"onk11ig"},"size":0.025,"scale":1,"marker":true,"name":"7번"},{"id":"6bihjyc","k":"arrow","color":"#ffd400","t0":200,"t1":205,"hold":4,"a":{"tr":"onk11ig"},"b":{"x":0.66,"y":0.62},"style":"solid","c":{"x":0.55615,"y":0.74405}}],"trackers":[{"id":"onk11ig","name":"선수 1","path":[[200,0.4523,0.8764,0.2239],[200.083,0.4518,0.8607,0.2227],[200.167,0.4519,0.8518,0.2157],[200.25,0.452,0.8597,0.2152],[200.333,0.452,0.8525,0.2145],[200.417,0.452,0.8632,0.2174],[200.5,0.4522,0.8558,0.2166],[200.583,0.4522,0.8611,0.2169],[200.667,0.4522,0.8519,0.2153],[200.75,0.452,0.8597,0.2145],[200.833,0.4522,0.8527,0.2145],[200.917,0.4518,0.8616,0.215],[201,0.4522,0.8525,0.2143],[201.083,0.4518,0.8598,0.2137],[201.167,0.4522,0.8513,0.2129],[201.25,0.4518,0.8603,0.2135],[201.333,0.4517,0.8602,0.2135],[201.417,0.4517,0.8602,0.2132],[201.5,0.4517,0.8603,0.2133],[201.583,0.4518,0.8591,0.2114],[201.667,0.4519,0.8601,0.2113],[201.75,0.4519,0.8595,0.2101],[201.833,0.4517,0.86,0.2114],[201.917,0.4517,0.8593,0.2114],[202,0.4512,0.8582,0.2143],[202.083,0.452,0.8675,0.2201],[202.167,0.452,0.8544,0.2159],[202.25,0.4516,0.8599,0.2147],[202.333,0.4518,0.867,0.2199],[202.417,0.4522,0.8544,0.2151],[202.5,0.4518,0.859,0.2143],[202.583,0.4518,0.8532,0.2131],[202.667,0.4517,0.8614,0.2145],[202.75,0.452,0.8523,0.2134],[202.833,0.4516,0.8607,0.2139],[202.917,0.4522,0.8524,0.2135],[203,0.4591,0.8454,0.2127],[203.083,0.4669,0.8477,0.2154],[203.167,0.4748,0.8506,0.2257],[203.25,0.4882,0.8403,0.2217],[203.333,0.4939,0.8315,0.2161],[203.417,0.5097,0.8199,0.2091],[203.5,0.5154,0.8073,0.2003],[203.583,0.5195,0.7931,0.1983],[203.667,0.5229,0.7717,0.1767],[203.75,0.5287,0.7788,0.1786],[203.833,0.5291,0.7547,0.1695],[203.917,0.5309,0.7416,0.1597],[204,0.5358,0.7364,0.1577],[204.083,0.5296,0.7155,0.1477],[204.167,0.5242,0.7008,0.1361],[204.25,0.5206,0.7009,0.1406],[204.333,0.5213,0.6966,0.1469],[204.417,0.5094,0.6808,0.1417],[204.5,0.5078,0.6773,0.1375],[204.583,0.5079,0.6658,0.1314],[204.667,0.4928,0.6497,0.1233],[204.75,0.4896,0.6535,0.1248],[204.833,0.4887,0.6471,0.1285],[204.917,0.48,0.6376,0.1277],[205,0.4705,0.6305,0.1265],[205.083,0.4645,0.6164,0.1243],[205.167,0.4598,0.6075,0.117],[205.25,0.4513,0.6068,0.117],[205.333,0.4485,0.6044,0.1193],[205.417,0.4381,0.5892,0.1141],[205.5,0.4354,0.5898,0.1135],[205.583,0.4327,0.5854,0.1162],[205.667,0.425,0.5716,0.1116],[205.75,0.4199,0.5667,0.1083],[205.833,0.4162,0.5613,0.1058],[205.917,0.4164,0.5617,0.1059],[206,0.407,0.5583,0.107],[206.083,0.3893,0.5323,0.1082],[206.167,0.4039,0.547,0.1034],[206.25,0.3888,0.5363,0.1074],[206.333,0.3885,0.5326,0.1106],[206.417,0.3882,0.5299,0.1088],[206.5,0.384,0.5237,0.106],[206.583,0.3816,0.5155,0.1037],[206.667,0.3822,0.5205,0.1024],[206.75,0.3783,0.5198,0.1017],[206.833,0.377,0.519,0.1034],[206.917,0.3771,0.5009,0.0953],[207,0.3667,0.5078,0.0899],[207.083,0.3713,0.5146,0.0927],[207.167,0.3579,0.5071,0.0885],[207.25,0.3559,0.5141,0.0887],[207.333,0.3545,0.511,0.0873],[207.417,0.3534,0.5038,0.0828],[207.5,0.3505,0.5048,0.0798],[207.583,0.3495,0.506,0.0764],[207.667,0.346,0.5112,0.0789],[207.75,0.343,0.5116,0.0775],[207.833,0.3417,0.5089,0.0765],[207.917,0.341,0.5051,0.0752],[208,0.3367,0.5092,0.075]],"h":0.075,"ar":0.325,"manual":false}],"set":{"chroma":true,"hue":100,"hueManual":false,"tol":40,"dur":5,"durEnd":false,"hold":2,"autoTrack":true}} });
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
    'dl1-1': { name: '써드맨 4v2 론도', plan: '화요일 오후 훈련', focus: 3, good: '2터치 안에 패스 성공이 많았어요', hard: '압박 오면 당황해서 뺏겼어요', next: '받기 전에 어깨 너머로 보기' },
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
    ] }, note: '8번이 공을 잡는 순간 수비 4번 뒤로 뛰어들어가서 골' }],
  },
});
{ const d2 = (() => { const d = new Date(); d.setDate(d.getDate() - 2); return ymd(d); })();
  seed(`teams/T1/logs/p1_${d2}`, { uid: 'p1', name: '박선수', date: d2, kind: 'train', condition: 4, sleep: 8, rpe: 3, trainMin: 60, sleepQ: 4, injury: 0, submitted: true, submittedAt: now(), checked: true, coachComment: '회복 훈련도 성실하게 잘했어!',
    sessions: { 'dl2-0': { name: '회복 조깅', focus: 4, good: '천천히 끝까지 뛰었어요', hard: '', next: '' }, 'dl2-1': { name: '스트레칭', focus: 3, good: '', hard: '햄스트링이 뻣뻣해요', next: '집에서도 스트레칭' } },
    learned: '회복도 훈련이다', tomorrow: '압박 탈출 연습' }); }
seed(`teams/T1/logs/p2_${today}`, { uid: 'p2', name: '이선수', date: today, condition: 4, sleep: 8, rpe: 4, trainMin: 90, sleepQ: 4, injury: 0 }); // 작성 중(미제출) 예시
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
const FRESH = QS.has('new');
// 데모 계정: 이메일 · 비밀번호 · 인증 여부를 이 브라우저에 기억 (새로고침해도 유지)
// 김코치 c@x.com / coach123 · 박선수(선수) p@x.com / player123
const ACC_KEY = 'ssaka.demo.accounts';
const BASE_ACC = { 'c@x.com': { pw: 'coach123', uid: U, verified: true }, 'p@x.com': { pw: 'player123', uid: 'p1', verified: true } };
const accounts = (() => { try { return { ...BASE_ACC, ...JSON.parse(localStorage.getItem(ACC_KEY) || '{}') }; } catch { return { ...BASE_ACC }; } })();
const saveAcc = () => { try { localStorage.setItem(ACC_KEY, JSON.stringify(accounts)); } catch { /* */ } };
const mkUser = (uid, email) => ({
  uid, email, emailVerified: !!accounts[email]?.verified,
  async reload() { this.emailVerified = !!accounts[this.email]?.verified; },
  async getIdToken() { return 'demo'; },
});
// ?as=player 로 열면 선수(박선수)로 로그인된 상태
export const auth = { currentUser: QS.has('out') ? null : FRESH ? mkUser('uNew', 'new@example.com') : QS.get('as') === 'player' ? mkUser('p1', 'p@x.com') : mkUser(U, 'c@x.com') };
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
  accounts[email] = { pw, uid: 'u-' + email.replace(/[^a-z0-9]/g, '') };
  saveAcc();
  setUser(mkUser(accounts[email].uid, email));
};
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
