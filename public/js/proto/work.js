// 경기 영상 작업 기록 (시제품) — 코치만 보는 곳: teams/{t}/matchWork/{분석 id}
//  · scan: 장면 후보 찾기 결과 (어떤 방식 · 언제 · 후보 목록 · 멈춤 구간)
//  · log : 바꾼 기록 (언제 · 무엇을 · 어떤 후보에서) — 지우지 않고 덧붙이기만
//  · sessions: 작업 시간 (수동 기록 / 후보 검토) — 실제로 시간이 줄었는지 비교하려고
// 분석 게시물(posts)은 선수도 읽으므로, 확정 전 후보 · 작업 기록은 여기에만 둔다.
import { db, doc, getDoc, setDoc } from '../fb.js';
import { state, hasFeature, isCoach } from '../store.js';

export const protoOn = () => hasFeature('proto3') && isCoach();
const ref = (id) => doc(db, 'teams', state.team.id, 'matchWork', id);
export async function loadWork(id) {
  try { const s = await getDoc(ref(id)); return s.exists() ? s.data() : {}; } catch { return {}; }
}
export async function saveWork(id, w) {
  await setDoc(ref(id), { ...w, by: state.user.uid, at: new Date().toISOString() });
}

// 작업 시간: 영상이 재생 중이거나 45초 안에 손을 댄 시간만 셈 (켜 두고 자리를 비운 시간은 빼요)
export function workTimer() {
  const s = { start: new Date().toISOString(), sec: 0, keys: 0, clicks: 0, adds: 0, edits: 0, dels: 0, undos: 0, candOk: 0, candNo: 0, skipSec: 0, mode: 'manual' };
  let last = 0; let playing = () => false; // 처음 손대기 전 시간은 세지 않음
  const touch = () => { last = Date.now(); };
  const tick = setInterval(() => { if (document.visibilityState === 'visible' && (playing() || Date.now() - last < 45000)) s.sec++; }, 1000);
  return {
    s, touch,
    bindPlaying: (f) => { playing = f; },
    count: (k, n = 1) => { s[k] = (s[k] || 0) + n; touch(); },
    stop: () => clearInterval(tick),
  };
}
// 분석 1분(영상 길이)당 작업 시간
export const perMin = (sess, videoSec) => (videoSec ? sess.sec / (videoSec / 60) : 0);
export const fmtDur = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)}시간 ${Math.round((sec % 3600) / 60)}분` : sec >= 60 ? `${Math.floor(sec / 60)}분 ${Math.round(sec % 60)}초` : `${Math.round(sec)}초`);
