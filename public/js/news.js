// 새 소식 점 — 공지 · 스케줄 · 미팅 · 분석 · 훈련 · 일지 · 목표 · 대화에 새 글이 오면 메뉴 옆에 주황 점
// 칸마다 가장 최근 글 몇 개만 실시간으로 지켜봄(읽기 비용 적게). '마지막으로 본 때'는 이 기기에 저장
import { auth, db, collection, doc, query, where, orderBy, limit, onSnapshot } from './fb.js';
import { state, isCoach, isSquad, inTeam } from './store.js';

let unsubs = [];
let key = '';
const latest = {}; // 칸 → 남이 쓴 가장 최근 시각(ms)
const ms = (t) => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : typeof t === 'number' ? t : 0);
const seenKey = () => `ssaka.seen.${state.user?.uid}.${state.team?.id}`;
const readSeen = () => { try { return JSON.parse(localStorage.getItem(seenKey()) || 'null'); } catch { return null; } };
const writeSeen = (s) => { try { localStorage.setItem(seenKey(), JSON.stringify(s)); } catch { /* */ } };
let seen = {};

// 지금 보고 있는 칸 (메뉴 주소 기준)
const SECTIONS = ['/notice', '/schedule', '/meeting', '/analysis', '/training', '/journal-check', '/goals', '/gamemodel', '/daily', '/chat'];
// 분석실(득점 · 실점 분석)은 필름룸(/analysis) 새 글 표시와 따로
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
  writeSeen(seen);
  paint();
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

function watch(sec, q, pick) {
  unsubs.push(onSnapshot(q, (snap) => {
    const docs = snap.docs ? snap.docs.map((d) => d.data()) : [snap.data?.()].filter(Boolean);
    latest[sec] = Math.max(0, ...docs.map(pick).filter(Boolean));
    if (current() === sec) { seen[sec] = Math.max(seen[sec] || 0, latest[sec]); writeSeen(seen); }
    paint();
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
  const post = (sec, type, extra = () => true) => watch(sec, query(posts, where('type', '==', type), orderBy('createdAt', 'desc'), limit(3)),
    (d) => (extra(d) ? notMine('createdAt')(d) : 0));
  post('/notice', 'notice');
  post('/schedule', 'schedule');
  post('/meeting', 'meeting');
  post('/training', 'daily');
  post('/analysis', 'analysis', (d) => isCoach() || d.mode === 'match'); // 선수는 경기 영상만 보임
  // 목표: 코치는 선수 개인 목표, 선수는 팀 목표
  watch('/goals', query(collection(db, 'teams', tid, 'goals'), orderBy('createdAt', 'desc'), limit(3)),
    (d) => (d.ownerUid === me || (!isCoach() && d.scope !== 'team') ? 0 : ms(d.createdAt)));
  if (isCoach()) {
    // 일지검사: 새로 제출된 일지
    watch('/journal-check', query(collection(db, 'teams', tid, 'logs'), orderBy('submittedAt', 'desc'), limit(3)), (d) => (d.submitted ? ms(d.submittedAt) : 0));
  } else {
    // 오늘 기록: 코치가 검사 · 코멘트를 남김
    watch('/daily', query(collection(db, 'teams', tid, 'logs'), where('uid', '==', me), orderBy('date', 'desc'), limit(3)), (d) => (d.checked ? ms(d.checkedAt) : 0));
    // 게임모델: 코치가 고침
    watch('/gamemodel', doc(db, 'teams', tid, 'private', 'gameModel'), (d) => ms(d.updatedAt));
  }
  // 대화: 상대가 보낸 새 메시지 (lastFrom · lastAt — 대화방을 열기만 해서는 안 바뀜)
  watch('/chat', query(collection(db, 'chats'), where('participants', 'array-contains', me), orderBy('updatedAt', 'desc'), limit(3)),
    (d) => (d.lastFrom === me ? 0 : ms(d.lastAt)));
}

export function stopNews() {
  unsubs.forEach((u) => { try { u(); } catch { /* */ } });
  unsubs = [];
  key = '';
  Object.keys(latest).forEach((k) => delete latest[k]);
  paint();
}
