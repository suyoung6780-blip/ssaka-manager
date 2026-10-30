// 시제품 3.0: 같은 포지션 · 같은 학년 · 팀 평균 (성장 평가 비교 그래프)
// 선수는 다른 선수의 성장 평가를 못 읽어서(보안 규칙 그대로), 코치 화면에서 평균만 계산해 idpConfig/peer 에 저장 → 선수는 이것만 읽음
// 이름 없이 숫자만: 그룹별 인원 · 평균 OVR · 능력치 평균 · OVR 목록(순위 계산용)
import { db, doc, getDoc, setDoc } from '../fb.js';
import { state } from '../store.js';
import * as I from './idp.js';

const ref = () => doc(db, 'teams', state.team.id, 'idpConfig', 'peer');
const r1 = (v) => Math.round(v * 10) / 10;
export const MIN_N = 3; // 선수 화면: 이보다 적은 그룹은 평균을 안 보여 줌 (몇 명 안 되면 누구 점수인지 짐작돼서)

export function computePeer(players, all) {
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const conf = all.filter((d) => d.status === 'confirmed' && d.tplVer === I.TPL_VER && byId[d.uid]);
  const months = {};
  conf.forEach((d) => {
    const o = I.ovrOf(d); if (o == null) return;
    const g = byId[d.uid].grade || '';
    const m = (months[d.month] ||= { team: [], pg: {}, grade: {} });
    const row = { o, sc: d.coach?.scores || {} };
    m.team.push(row); (m.pg[d.pg] ||= []).push(row); if (g) (m.grade[g] ||= []).push(row);
  });
  const sum = (rows) => {
    const ab = {}; const cnt = {};
    rows.forEach((r) => Object.entries(r.sc).forEach(([k, v]) => { if (v == null) return; ab[k] = (ab[k] || 0) + v; cnt[k] = (cnt[k] || 0) + 1; }));
    return { n: rows.length, ovr: r1(rows.reduce((s, r) => s + r.o, 0) / rows.length), ab: Object.fromEntries(Object.entries(ab).map(([k, v]) => [k, r1(v / cnt[k])])), ovrs: rows.map((r) => r.o).sort((a, b) => b - a) };
  };
  const out = {};
  Object.entries(months).forEach(([ym, m]) => {
    out[ym] = { team: sum(m.team), pg: Object.fromEntries(Object.entries(m.pg).map(([k, v]) => [k, sum(v)])), grade: Object.fromEntries(Object.entries(m.grade).map(([k, v]) => [k, sum(v)])) };
  });
  return out;
}
// 바뀐 게 있을 때만 저장 (쓰기 아끼기)
let lastSaved = '';
export async function savePeer(months) {
  const s = JSON.stringify(months);
  if (s === lastSaved) return;
  try {
    const cur = await getDoc(ref());
    if (cur.exists() && JSON.stringify(cur.data().months || {}) === s) { lastSaved = s; return; }
    await setDoc(ref(), { months, at: new Date().toISOString() });
    lastSaved = s;
  } catch { /* 저장 못 해도 화면은 그대로 */ }
}
export async function loadPeer() {
  try { const s = await getDoc(ref()); return s.exists() ? s.data().months || {} : {}; } catch { return {}; }
}
