// 새 소식 점 — 공지 · 스케줄 · 미팅 · 분석 · 훈련 · 일지 · 목표 · 대화에 새 글이 오면 메뉴 옆에 주황 점
// 칸마다 가장 최근 글 몇 개만 실시간으로 지켜봄(읽기 비용 적게). '마지막으로 본 때'는 이 기기에 저장
// 홈 '새 소식': 지켜보는 글 중 아직 안 본 것을 한 줄씩 (무엇이 · 누가 · 언제) — 누르면 그 화면으로, 보면 사라짐
import { auth, db, collection, doc, query, where, orderBy, limit, onSnapshot } from './fb.js';
import { state, isCoach, isSquad, inTeam } from './store.js';

let unsubs = [];
let key = '';
const latest = {}; // 칸 → 남이 쓴 가장 최근 시각(ms)
const items = {}; // 칸 → [{ t, text, href }] (새 소식 한 줄들)
const subs = new Set(); // 홈 새 소식 칸 (바뀌면 다시 그림)
const fire = () => subs.forEach((f) => { try { f(); } catch { /* */ } });
const ms = (t) => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : typeof t === 'number' ? t : 0);
const seenKey = () => `ssaka.seen.${state.user?.uid}.${state.team?.id}`;
const readSeen = () => { try { return JSON.parse(localStorage.getItem(seenKey()) || 'null'); } catch { return null; } };
const writeSeen = (s) => { try { localStorage.setItem(seenKey(), JSON.stringify(s)); } catch { /* */ } };
let seen = {};

// 지금 보고 있는 칸 (메뉴 주소 기준)
const SECTIONS = ['/notice', '/schedule', '/meeting', '/analysis', '/training', '/journal-check', '/goals', '/gamemodel', '/daily', '/journal'];
// 분석실(득점 · 실점 분석)은 영상룸(/analysis) 새 글 표시와 따로
const sectionOf = (path) => (path === '/analysis/goals' ? '' : SECTIONS.filter((s) => path === s || path.startsWith(`${s}/`)).sort((a, b) => b.length - a.length)[0] || '');
const current = () => sectionOf(location.hash.slice(1) || '/');

export const hasNew = (sec) => (latest[sec] || 0) > (seen[sec] || 0);
// 따로 켜는 점 (예: 시제품 성장 평가 — 이번 달 자기평가를 안 냄 · 검토 대기)
const flags = {};
export function setFlag(path, on) { flags[path] = !!on; paint(); }

export function markSeen(path) {
  const sec = sectionOf(path);
  if (!sec || !state.user) return;
  seen[sec] = Math.max(Date.now(), latest[sec] || 0);
  if (sec === '/journal' || sec === '/daily') { seen['/journal'] = seen['/daily'] = seen[sec]; } // 일지 검사 소식은 오늘 기록 · 내 일지 어디서 봐도
  writeSeen(seen);
  paint(); fire();
}
// 홈 새 소식: 안 본 것 (최근 순)
// 맨 위로: 선수는 나에 대한 것(일지 검사 · 경기 피드백 · 대화), 지도자는 선수들이 올린 것(일지 · 개인 목표 · 대화)
const MINE = { player: ['/daily'], coach: ['/journal-check', '/goals'] };
export function feed() {
  const top = MINE[isCoach() ? 'coach' : 'player'];
  return Object.entries(items).flatMap(([sec, list]) => list.filter((x) => x.t > (seen[sec] || 0)).map((x) => ({ ...x, sec, me: top.includes(sec) })))
    .sort((a, b) => (b.me - a.me) || (b.t - a.t));
}
export function onFeed(f) { subs.add(f); return () => subs.delete(f); }
export function markAllSeen() {
  Object.keys(items).forEach((sec) => { seen[sec] = Math.max(Date.now(), latest[sec] || 0); });
  writeSeen(seen); paint(); fire();
}

// 메뉴 · 모바일 ☰ 버튼 · 앱 아이콘 배지
export function paint() {
  document.querySelectorAll('.nav-list a[href]').forEach((a) => {
    const sec = sectionOf(a.getAttribute('href').slice(1));
    a.classList.toggle('has-new', (!!sec && hasNew(sec)) || !!flags[a.getAttribute('href').slice(1)]);
  });
  const n = SECTIONS.filter(hasNew).length + Object.values(flags).filter(Boolean).length;
  document.querySelector('[data-toggle="nav-open"]')?.classList.toggle('has-new', n > 0);
  try { if ('setAppBadge' in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch { /* */ }
}

// say(d) → 새 소식 한 줄 (없으면 점만) · href: 누르면 갈 곳 (없으면 그 칸)
function watch(sec, q, pick, say = null, href = null) {
  unsubs.push(onSnapshot(q, (snap) => {
    const docs = snap.docs ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : [snap.data?.()].filter(Boolean);
    latest[sec] = Math.max(0, ...docs.map(pick).filter(Boolean));
    items[sec] = say ? docs.map((d) => ({ t: pick(d), text: say(d), href: href ? href(d) : `#${sec}` })).filter((x) => x.t && x.text) : [];
    if (current() === sec) { seen[sec] = Math.max(seen[sec] || 0, latest[sec]); writeSeen(seen); }
    paint(); fire();
  }, () => {}));
}

export function startNews() {
  const k = `${state.user?.uid}|${state.team?.id}|${state.member?.role}|${isSquad()}`;
  if (k === key) return;
  stopNews();
  key = k;
  if (!state.user || !inTeam() || !isSquad()) return;
  const me = state.user.uid;
  seen = readSeen() || Object.fromEntries(SECTIONS.map((s) => [s, auth.demo ? 0 : Date.now()])); // 처음 쓰는 기기: 지금까지는 본 걸로 (데모는 점이 보이게)
  writeSeen(seen);
  const tid = state.team.id;
  const posts = collection(db, 'teams', tid, 'posts');
  const notMine = (t) => (d) => (d.authorUid === me ? 0 : ms(d[t]));
  const by = (d) => (d.authorName ? ` · ${d.authorName}` : '');
  const md = (s) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${+s.slice(5, 7)}/${+s.slice(8)}` : '');
  const post = (sec, type, say, extra = () => true, n = 4) => watch(sec, query(posts, where('type', '==', type), orderBy('createdAt', 'desc'), limit(n)),
    (d) => (extra(d) ? notMine('createdAt')(d) : 0), say);
  post('/notice', 'notice', (d) => `새 공지 · ${d.title || '공지'}${by(d)}`);
  post('/schedule', 'schedule', (d) => (d.isNote ? `스케줄 비고 · ${d.title || ''}` : `새 일정 · ${[md(d.date), d.time, d.title].filter(Boolean).join(' ')}${d.kind ? ` (${d.kind})` : ''}`));
  post('/meeting', 'meeting', (d) => `미팅룸 새 글 · ${d.title || ''}${by(d)}`);
  post('/training', 'daily', (d) => `훈련 안내 · ${[md(d.date), d.time, d.title].filter(Boolean).join(' ') || '새 훈련'}${by(d)}`);
  post('/analysis', 'analysis', (d) => `영상룸 · ${d.title || '새 영상'}${by(d)}`, (d) => isCoach() || d.mode === 'match'); // 선수는 경기 영상만 보임
  // 목표: 코치는 선수 개인 목표, 선수는 팀 목표
  watch('/goals', query(collection(db, 'teams', tid, 'goals'), orderBy('createdAt', 'desc'), limit(4)),
    (d) => (d.ownerUid === me || (!isCoach() && d.scope !== 'team') ? 0 : ms(d.createdAt)),
    (d) => (d.scope === 'team' ? `팀 목표 · ${d.title || ''}` : `${d.ownerName || '선수'} 개인 목표 · ${d.title || ''}`));
  if (isCoach()) {
    // 일지검사: 새로 제출된 일지 (누가 · 무슨 일지)
    watch('/journal-check', query(collection(db, 'teams', tid, 'logs'), orderBy('submittedAt', 'desc'), limit(10)), (d) => (d.submitted ? ms(d.submittedAt) : 0),
      (d) => `${d.name || '선수'} ${d.kind === 'match' ? '경기' : '훈련'} 일지 제출 · ${md(d.date)}${d.hurt || (+d.injury || 0) >= 5 ? ' · 부상 주의' : ''}`,
      () => '#/journal-check');
  } else {
    // 오늘 기록: 코치가 검사 · 코멘트를 남김
    watch('/daily', query(collection(db, 'teams', tid, 'logs'), where('uid', '==', me), orderBy('date', 'desc'), limit(4)), (d) => (d.checked ? ms(d.checkedAt) : 0),
      (d) => `코치님이 ${md(d.date)} 일지를 검사했어요${d.coachComment ? ` · "${String(d.coachComment).slice(0, 40)}"` : ''}`, () => '#/journal');
    // 게임모델: 코치가 고침
    watch('/gamemodel', doc(db, 'teams', tid, 'private', 'gameModel'), (d) => ms(d.updatedAt), () => '게임모델이 바뀌었어요');
  }
}

export function stopNews() {
  unsubs.forEach((u) => { try { u(); } catch { /* */ } });
  unsubs = [];
  key = '';
  Object.keys(latest).forEach((k) => delete latest[k]);
  Object.keys(items).forEach((k) => delete items[k]);
  paint(); fire();
}
