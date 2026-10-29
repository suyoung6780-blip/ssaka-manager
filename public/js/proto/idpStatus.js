// IDP 현황 (홈 화면 · 메뉴 알림 점) — 이번 달 자기평가 상태 · 마감 · 팀 제출 현황
import { db, collection, doc, getDoc, getDocs, query, where } from '../fb.js';
import { state, isCoach, hasFeature } from '../store.js';
import { esc } from '../ui.js';
import * as I from './idp.js';
import { setFlag } from '../news.js';

const col = () => collection(db, 'teams', state.team.id, 'idp');
export async function loadCfg() {
  try { const s = await getDoc(doc(db, 'teams', state.team.id, 'idpConfig', 'main')); const d = s.exists() ? s.data() : {}; return { mode: d.mode === 'full' ? 'full' : 'base', due: +d.due || 0 }; } catch { return { mode: 'base', due: 0 }; }
}
const done = (d) => d && (d.status === 'submitted' || d.status === 'confirmed');

export async function playerStatus(uid = state.user.uid) {
  const [cfg, snap] = await Promise.all([loadCfg(), getDocs(query(col(), where('uid', '==', uid)))]);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.month < b.month ? -1 : 1));
  const ym = I.ymOf(); const prevYm = I.ymAdd(ym, -1);
  const cur = list.find((d) => d.month === ym); const prev = list.find((d) => d.month === prevYm);
  const conf = list.filter((d) => d.status === 'confirmed' && d.tplVer === I.TPL_VER);
  const last = conf[conf.length - 1]; const before = [...conf].reverse().find((d) => d !== last && d.pg === last?.pg);
  const deadline = I.dueOf(ym, cfg.due);
  return {
    cfg, ym, cur, st: cur?.status || 'none', deadline, dday: I.ddayOf(deadline), late: I.nowDate() > deadline,
    grace: I.canWrite(prevYm) && !done(prev) ? { ym: prevYm, st: prev?.status || 'none' } : null,
    ovr: I.ovrOf(last), delta: I.ovrOf(last) != null && I.ovrOf(before) != null ? I.ovrOf(last) - I.ovrOf(before) : null, lastMonth: last?.month,
  };
}
export async function teamStatus() {
  const [cfg, idp, mem] = await Promise.all([loadCfg(), getDocs(col()), getDocs(collection(db, 'teams', state.team.id, 'members'))]);
  const players = mem.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.role === 'player' && m.approved !== false);
  const all = idp.docs.map((d) => ({ id: d.id, ...d.data() }));
  const ym = I.ymOf();
  const now = all.filter((d) => d.month === ym);
  const deadline = I.dueOf(ym, cfg.due);
  // 팀 OVR: 필드 선수마다 가장 최근 확정
  const by = {}; all.filter((d) => d.status === 'confirmed' && d.tplVer === I.TPL_VER && d.pg && d.pg !== 'GK').forEach((d) => { if (!by[d.uid] || by[d.uid].month < d.month) by[d.uid] = d; });
  const ov = Object.values(by).map(I.ovrOf).filter((v) => v != null);
  return {
    cfg, ym, deadline, dday: I.ddayOf(deadline), total: players.length,
    sub: now.filter(done).length, waiting: now.filter((d) => d.status === 'submitted').length, confirmed: now.filter((d) => d.status === 'confirmed').length,
    teamOvr: ov.length ? Math.round(ov.reduce((a, b) => a + b, 0) / ov.length) : null,
  };
}
// 메뉴 '성장 평가' 옆 주황 점: 선수 = 이번 달(또는 마저 낼 지난달) 안 냄 · 코치 = 검토 대기 있음
export async function refreshIdpFlag() {
  if (!state.team || !hasFeature('proto3')) { setFlag('/idp', false); return; }
  try {
    if (isCoach()) { const t = await teamStatus(); setFlag('/idp', t.waiting > 0); }
    else { const p = await playerStatus(); setFlag('/idp', !done(p.cur) || !!p.grace); }
  } catch { /* 점은 없어도 됨 */ }
}
// 홈 카드
export async function homeIdpCard(box) {
  if (!box || !hasFeature('proto3')) return;
  try {
    if (isCoach()) {
      const t = await teamStatus();
      const pct = t.total ? Math.round((t.sub / t.total) * 100) : 0;
      box.innerHTML = `<section class="card hcard p3-home"><div class="card-head"><h3>성장 평가 <small class="muted">${I.ymLabel(t.ym)} 자기평가 · 마감 ${t.deadline.getMonth() + 1}/${t.deadline.getDate()} (${t.dday})</small></h3><a href="#/idp" class="more">성장 평가 →</a></div>
        <div class="p3-home-k"><div><small>제출</small><b>${t.sub}<i>/${t.total}</i></b><div class="p3-meter"><i style="width:${pct}%"></i></div></div>
          <div class="${t.waiting ? 'warn' : ''}"><small>검토 대기</small><b>${t.waiting}</b><span>${t.waiting ? '확정해 주세요' : '없어요'}</span></div>
          <div><small>확정</small><b>${t.confirmed}</b><span>이번 달</span></div>
          <div><small>팀 OVR</small><b>${t.teamOvr ?? '-'}</b><span>필드 선수 평균</span></div></div></section>`;
    } else {
      const p = await playerStatus();
      const ST = { none: '아직 안 씀', draft: '작성 중', submitted: '제출 · 검토 대기', confirmed: '확정' };
      const todo = !done(p.cur);
      box.innerHTML = `<section class="card hcard p3-home"><div class="card-head"><h3>내 성장 평가</h3><a href="#/idp" class="more">내 성장 카드 →</a></div>
        <div class="p3-home-p"><div class="p3-home-ovr"><b>${p.ovr ?? '-'}</b><small>OVR 참고${p.lastMonth ? ` · ${I.ymLabel(p.lastMonth)} 확정` : ''}</small>${p.delta != null ? `<span class="p3-trend ${p.delta > 0 ? 'up' : p.delta < 0 ? 'down' : 'flat'}">${p.delta > 0 ? '+' : ''}${p.delta}</span>` : ''}</div>
          <div class="p3-home-st"><span>${I.ymLabel(p.ym)} 자기평가</span><b class="${todo ? 'p3-todo' : ''}">${ST[p.st]}</b><small>마감 ${p.deadline.getMonth() + 1}/${p.deadline.getDate()} · ${p.late && todo ? '마감 지남 · 늦게 내도 돼요' : p.dday}</small></div></div>
        ${p.grace ? `<p class="p3-grace">지난달(${I.ymLabel(p.grace.ym)}) 자기평가를 아직 안 냈어요 — <b>${I.GRACE_DAY}일까지</b> 마저 낼 수 있어요.</p>` : ''}
        <a href="#/idp" class="btn full">${todo ? '자기평가 하기' : '내 성장 카드 보기'}</a></section>`;
    }
  } catch { box.innerHTML = ''; }
}
export const IDP_ESC = esc;
