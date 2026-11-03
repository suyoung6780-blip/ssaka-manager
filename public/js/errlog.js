// 기능이 실패했을 때 운영자에게 자동으로 남기는 기록 (errLogs) — 운영자 화면에서 최근 기록을 봄
// 한 번 열 때 최대 5개까지만 (같은 오류가 반복돼도 쓰기 한도를 쓰지 않게) · 실패해도 화면엔 영향 없음
import { db, collection, addDoc, serverTimestamp } from './fb.js';
import { state } from './store.js';

let sent = 0;
export async function logError(where, err, { info = '' } = {}) {
  if (!state.user || sent >= 5) return;
  sent++;
  try {
    await addDoc(collection(db, 'errLogs'), {
      uid: state.user.uid,
      where: String(where).slice(0, 40),
      msg: String(err?.message || err || '').slice(0, 300),
      info: String(info).slice(0, 300),
      ua: navigator.userAgent.slice(0, 300),
      teamId: state.team?.id || '',
      at: serverTimestamp(),
    });
  } catch { /* 기록을 못 남겨도 그만 */ }
}
