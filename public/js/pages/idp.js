// IDP (개인 성장 평가) 시제품 — 선수 자기평가 → 코치 검토 → 확정 → 능력치(육각형) · 포지션 능력 · 월별 비교 · 목표 연결
// 저장: teams/{t}/idp/{uid}_{YYYY-MM} (선수 원래 답 answers · 코치 확정 coach 따로) + 그 아래 history (덧붙이기만)
// 팀 기능 'proto3'가 켜진 팀에서만 열려요.
import { db, collection, doc, getDoc, getDocs, setDoc, addDoc, query, where, serverTimestamp, writeBatch } from '../fb.js';
import { esc, toast, fail, pageHead, empty, confirmBox } from '../ui.js';
import { state, isCoach, go, hasFeature } from '../store.js';
import * as I from '../proto/idp.js';
import { loadCfg, refreshIdpFlag } from '../proto/idpStatus.js';
import { loadLinks, hubHtml, monthLinkRows } from '../proto/links.js';
import { seasonData, mountSeason } from '../proto/seasonStats.js';
import { buildDigest, digestHtml, bodyOf } from '../proto/digest.js';
import { computePeer, savePeer, loadPeer, MIN_N } from '../proto/peer.js'; // 같은 포지션 · 학년 · 팀 평균
import * as GL from '../proto/goalLog.js';
import { page as dataPage, lineChart } from './data.js';
import { pct as gPct, pace as gPace } from './goals.js';
import { loadTeamLogs, overviewRows, overviewHtml } from '../proto/idpOverview.js'; // 한눈에 보기 // 자동 정리 (무료 · 규칙)

const col = () => collection(db, 'teams', state.team.id, 'idp');
const dref = (id) => doc(db, 'teams', state.team.id, 'idp', id);
const hcol = (id) => collection(db, 'teams', state.team.id, 'idp', id, 'history');
const idOf = (uid, ym) => `${uid}_${ym}`;
// 능력치별로 묶기: 같은 능력의 문항(최대 2개)
const byAb = (items) => { const m = new Map(); items.forEach((it) => { if (!m.has(it.ab)) m.set(it.ab, []); m.get(it.ab).push(it); }); return [...m.entries()]; };
const AREA_L = { hex: '능력치', pos: '포지션', growth: '성장' };
const NOW = () => I.ymOf();
const STATUS = { none: ['아직 안 씀', ''], draft: ['작성 중', ''], submitted: ['제출 · 검토 대기', 'warn'], confirmed: ['확정', 'solid'] };
const when = (v) => { const ms = v?.toMillis ? v.toMillis() : v ? +new Date(v) : 0; if (!ms) return ''; const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

async function members() {
  const s = await getDocs(collection(db, 'teams', state.team.id, 'members'));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function idpOf(uid) {
  const s = await getDocs(uid ? query(col(), where('uid', '==', uid)) : col());
  return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.month < b.month ? -1 : 1));
}
// 한 달에 묻는 양 (코치가 정함): teams/{t}/idpConfig/main { mode: 'base' | 'full' }
const cfgRef = () => doc(db, 'teams', state.team.id, 'idpConfig', 'main');
async function loadMode() { try { const s0 = await getDoc(cfgRef()); return s0.exists() && s0.data().mode === 'full' ? 'full' : 'base'; } catch { return 'base'; } }
async function historyOf(id) {
  try { const s = await getDocs(hcol(id)); return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (+a.id || 0) - (+b.id || 0)); } catch { return []; }
}

export async function page(el, params = {}) {
  if (!hasFeature('proto3')) { el.innerHTML = empty('IDP 시제품은 이 팀에서 아직 켜지지 않았어요.'); return; }
  ptab = 'sum';
  try { const t = sessionStorage.getItem('ssaka.idp.tab'); if (t) { sessionStorage.removeItem('ssaka.idp.tab'); ptab = t; } } catch { /* */ } // 홈 '시즌 기록 보기' 등에서 바로 그 칸
  if (!isCoach()) { if (params.uid && params.uid !== state.user.uid) { go('/idp'); return; } return playerView(el, state.user.uid); }
  return params.uid ? playerView(el, params.uid) : coachView(el);
}

const banner = () => `<details class="p3-note"><summary>시제품 3.0 · 1차 시험용 문항이에요</summary><p>문항 은행: 능력치 · 포지션 · 성장마다 10개 (한 달 기본 45문항 · 전체 80문항) — 이 문항만으로 능력을 정확히 잰다고 보지 않아요 · 템플릿 ${I.TPL_VER} · 경기 기록 수로 점수가 자동으로 오르지 않아요</p></details>`;

// ───────── 코치: 팀 전체 ─────────
// 코치 화면: 탭 3개 — 선수 카드 (오버롤) · 월별 (제출 · 검토) · 데이터 (평균 · 강점 · 부족 · 변화)
let ctab = 'overview';
let ptab = 'sum'; // 선수 성장 카드 칸
// 코치 화면 3칸: 선수(모두 한눈에 · 카드) · 이번 달 평가(제출 · 검토) · 팀 분석
const CTABS = [['overview', '선수'], ['month', '이번 달 평가'], ['data', '팀 분석']];
let ovf = 'all'; let ovv = 'card'; // 선수 칸: 거르기 · 보기 (선수 카드 / 먼저 볼 순서)
async function coachView(el, ym = NOW()) {
  const [ms, all, cfg] = await Promise.all([members(), idpOf(null), loadCfg()]);
  const mode = cfg.mode; const deadline = I.dueOf(ym, cfg.due); const closed = !I.canWrite(ym) && ym < NOW();
  const players = ms.filter((m) => m.role === 'player').sort((a, b) => (+a.number || 99) - (+b.number || 99));
  savePeer(computePeer(players, all)); // 선수 화면 비교 그래프용 평균 (이름 없이)
  const byU = (u, m) => all.find((d) => d.uid === u && d.month === m);
  const lastConf = (u, m) => all.filter((d) => d.uid === u && d.status === 'confirmed' && d.month < m).pop();
  const rows = players.map((p) => { const d = byU(p.id, ym); const f = d && d.status === 'submitted' ? I.flagsOf(d, lastConf(p.id, ym)) : null; return { p, d, f, st: d?.status || 'none' }; });
  const clean = rows.filter((r) => r.st === 'submitted' && r.f.n === 0);
  const months = [...new Set([NOW(), I.ymAdd(NOW(), -1), I.ymAdd(NOW(), -2), ...all.map((d) => d.month)])].sort().reverse().slice(0, 6);
  const sub = rows.filter((r) => r.st === 'submitted' || r.st === 'confirmed').length;
  const waiting = rows.filter((r) => r.st === 'submitted').length;
  const ovRows = ctab === 'overview' ? overviewRows(players, all, await loadTeamLogs(), ym) : null;
  const body = ctab === 'overview' ? overviewHtml(ovRows, ym, ovf, ovv, (shown) => cardsHtml(players.filter((p) => shown.some((r) => r.p.id === p.id)), all, rows, shown))
    : ctab === 'data' ? `${teamOvrHtml(cardInfo(players, all, rows), all)}${analysisHtml(players, all)}${dataHtml(players, all, ym, months)}`
    : `<section class="card p3-card"><div class="row between wrap"><div class="seg">${months.map((m) => `<button class="${m === ym ? 'on' : ''}" data-ym="${m}">${I.ymLabel(m)}</button>`).join('')}</div>
        <details class="p3-set"><summary>설정 · 마감 · 문항 양</summary><div class="row wrap">
        <label class="p3-f">마감<select data-due>${I.DUE_OPTS.map(([v, l]) => `<option value="${v}" ${v === cfg.due ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="p3-f">한 달에 묻는 양<select data-mode>${Object.entries(I.MODES).map(([k, v]) => `<option value="${k}" ${k === mode ? 'selected' : ''}>${v.l} · ${v.n}문항 · 약 ${v.min}분</option>`).join('')}</select></label></div>
      <p class="muted small">기본은 능력치마다 10개 중 5개를 달마다 번갈아 물어서 두 달이면 10개를 다 물어요. 전체는 매달 모두 물어요. 바꾸면 <b>아직 쓰기 시작하지 않은 선수</b>부터 적용돼요. 마감이 지나도 그 달 말일까지 낼 수 있고 '늦게 냄'으로 표시돼요 · 지난달 것은 다음 달 ${I.GRACE_DAY}일까지 마저 낼 수 있어요.</p></details></div>
      <p class="small">${I.ymLabel(ym)} 마감 <b>${deadline.getMonth() + 1}/${deadline.getDate()}</b> (${I.ddayOf(deadline)})${closed ? ' · <b>이 달은 닫혔어요</b>' : ''}</p>
      <div class="ga-kpis p3-mk">
        <div class="ga-k"><small>제출</small><strong>${sub}<i>/${players.length}</i></strong><span>${players.length ? Math.round((sub / players.length) * 100) : 0}% 제출</span></div>
        <div class="ga-k ok"><small>확정</small><strong>${rows.filter((r) => r.st === 'confirmed').length}</strong><span>코치 확정 끝</span></div>
        <div class="ga-k"><small>검토 대기</small><strong>${waiting}</strong><span>${clean.length ? `표시 없음 ${clean.length}명 · 한 번에 확정 가능` : '하나씩 확인'}</span></div>
        <div class="ga-k bad"><small>확인할 답 있음</small><strong>${rows.filter((r) => r.f?.n).length}</strong><span>2단계 넘게 바뀜 · 같은 답 · 메모</span></div>
        <div class="ga-k"><small>안 씀 · 작성 중</small><strong>${rows.filter((r) => r.st === 'none' || r.st === 'draft').length}</strong><span>알림을 보내면 좋아요</span></div>
      </div>
      ${clean.length ? `<div class="row"><button class="btn sm" data-batch>표시 없는 제출 ${clean.length}명 한 번에 확정</button><span class="muted small">선수 답 그대로 확정 · 나중에 선수 화면에서 고칠 수 있어요 (바꾼 기록이 남아요)</span></div>` : ''}
      <table class="tbl p3-tbl p3-team"><tr><th>선수</th><th>포지션</th><th>${I.ymLabel(ym)}</th><th>확인할 것</th><th>OVR (그 달)</th><th>지난 확정</th><th></th></tr>
      ${rows.map(({ p, d, f, st }) => { const pos = I.normPos(d?.pos) || I.normPos(p.position); const pg = d?.pg || I.POS_GROUP(pos); const lc = lastConf(p.id, ym); const o = d?.status === 'confirmed' ? I.ovrOf(d) : null; const o0 = lc && lc.pg === d?.pg ? I.ovrOf(lc) : null; return `<tr><td><b>${esc(p.number ? `${p.number} ` : '')}${esc(p.name || '')}</b></td><td>${pos ? `${esc(pos)} <small class="muted">${esc(I.POS_NAME[pos])}</small>` : pg ? esc(I.POS[pg]?.l || pg) : '<span class="muted">포지션 없음</span>'}</td>
        <td>${closed && (st === 'none' || st === 'draft') ? '<span class="tag p3-miss">미제출</span>' : `<span class="tag ${STATUS[st][1]}">${STATUS[st][0]}</span>`}${d?.submittedAt && new Date(d.submittedAt) > deadline ? ' <small class="p3-late">늦게 냄</small>' : ''}</td><td>${f ? (f.n ? `<b class="p3-flag">${f.n}개</b>` : '<span class="muted">없음</span>') : ''}</td>
        <td>${o != null ? `<b>${o}</b>${o0 != null ? ` <small class="p3-trend ${o - o0 > 0 ? 'up' : o - o0 < 0 ? 'down' : 'flat'}">${o - o0 > 0 ? '+' : ''}${o - o0}</small>` : ''}` : '-'}</td><td>${lc ? I.ymLabel(lc.month) : '-'}</td>
        <td><a class="btn ghost sm" href="#/idp/${esc(p.id)}">${st === 'submitted' ? '검토하기' : '성장 카드'}</a></td></tr>`; }).join('')}</table>
      ${players.length ? '' : '<p class="muted">팀에 선수가 없어요.</p>'}</section>`;
  el.innerHTML = `${pageHead('IDP', '성장 평가')}${banner()}
    <nav class="tabs">${CTABS.map(([k, l]) => `<a href="javascript:void 0" data-ctab="${k}" class="${ctab === k ? 'on' : ''}">${l}${k === 'month' && waiting ? ` <span class="p3-badge">${waiting}</span>` : ''}</a>`).join('')}</nav>
    ${body}`;
  el.querySelectorAll('[data-ctab]').forEach((a) => (a.onclick = () => { ctab = a.dataset.ctab; coachView(el, ym); }));
  el.querySelectorAll('[data-ym]').forEach((b) => (b.onclick = () => coachView(el, b.dataset.ym)));
  el.querySelectorAll('[data-ovf]').forEach((b) => (b.onclick = () => { ovf = b.dataset.ovf; coachView(el, ym); }));
  el.querySelectorAll('[data-ovv]').forEach((b) => (b.onclick = () => { ovv = b.dataset.ovv; coachView(el, ym); }));
  el.querySelector('[data-csv]')?.addEventListener('click', () => downloadCsv(players, all));
  el.querySelector('[data-due]')?.addEventListener('change', async (e) => {
    try { await setDoc(cfgRef(), { mode, due: +e.target.value, by: state.user.uid, at: new Date().toISOString() }); toast(`마감을 ${I.DUE_OPTS.find(([v]) => v === +e.target.value)[1]}까지로 바꿨어요.`); coachView(el, ym); } catch (err) { fail(err); }
  });
  el.querySelector('[data-mode]')?.addEventListener('change', async (e) => {
    try { await setDoc(cfgRef(), { mode: e.target.value, due: cfg.due, by: state.user.uid, at: new Date().toISOString() }); toast(`한 달에 묻는 양을 ${I.MODES[e.target.value].l}(${I.MODES[e.target.value].n}문항)으로 바꿨어요.`); } catch (err) { fail(err); }
  });
  el.querySelector('[data-batch]')?.addEventListener('click', async () => {
    if (!(await confirmBox(`${clean.length}명의 자기평가를 선수 답 그대로 확정할까요?`))) return;
    try {
      for (const r of clean) await confirmDoc(r.d, I.draftScores(r.d), {}, { feedback: r.d.coach?.feedback || '', what: 'batch-confirm' });
      toast(`${clean.length}명을 확정했어요.`); refreshIdpFlag(); coachView(el, ym);
    } catch (e) { fail(e); }
  });
}

// ───────── 데이터 탭: 팀이 잘하는 것 · 부족한 것 · 달마다 늘고 줄어든 것 ─────────
function analysisHtml(players, all) {
  const conf = all.filter((d) => d.status === 'confirmed' && d.tplVer === I.TPL_VER && d.pg);
  const months = [...new Set(conf.map((d) => d.month))].sort().slice(-4);
  if (!months.length) return `<section class="card p3-card"><h3>팀 분석</h3><p class="muted">확정된 기록이 생기면 분석이 나와요.</p></section>`;
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  // 그 달 기준: 선수마다 가장 최근 확정 기록
  const asOf = (m, f = () => true) => { const by = {}; conf.filter((d) => d.month <= m && f(d)).forEach((d) => { if (!by[d.uid] || by[d.uid].month < d.month) by[d.uid] = d; }); return Object.values(by); };
  const abAvg = (docs, ab) => { const v = avg(docs.map((d) => d.coach?.scores?.[ab]).filter((x) => x != null)); return v == null ? null : Math.round(((v - 1) / 4) * 100); };
  const field = (d) => d.pg !== 'GK';
  const last = months[months.length - 1]; const prev = months[months.length - 2];
  const nowDocs = asOf(last, field);
  const rows = I.FIELD.map((a) => { const vals = months.map((m) => abAvg(asOf(m, field), a.id)); const v = vals[vals.length - 1]; const d = prev ? v - vals[vals.length - 2] : null; return { a, vals, v, d }; });
  const has = rows.filter((r) => r.v != null);
  const best = [...has].sort((x, y) => y.v - x.v).slice(0, 2); const worst = [...has].sort((x, y) => x.v - y.v).slice(0, 2);
  const up = has.filter((r) => r.d > 0).sort((x, y) => y.d - x.d).slice(0, 2); const down = has.filter((r) => r.d < 0).sort((x, y) => x.d - y.d).slice(0, 2);
  const dl = (d) => (d == null ? '' : `<span class="p3-trend ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${d > 0 ? '+' : ''}${d}</span>`);
  const heat = (v) => (v == null ? '' : `style="background:rgba(57,231,95,${(0.05 + (v / 100) * 0.4).toFixed(2)})"`);
  // 줄별 × 능력치
  const lineRows = I.LINES.filter(([k]) => k !== 'GK').map(([k, l]) => { const docs = nowDocs.filter((d) => I.lineOf(d.pos, d.pg) === k); return { l, n: docs.length, vals: I.FIELD.map((a) => abAvg(docs, a.id)) }; }).filter((r) => r.n);
  // 포지션 전문 능력 (묶음별 · 같은 묶음끼리만)
  const pgs = [...new Set(asOf(last).map((d) => d.pg))].filter((g) => I.POS[g]);
  const posBlocks = pgs.map((g) => { const docs = asOf(last, (d) => d.pg === g); const docsP = prev ? asOf(prev, (d) => d.pg === g) : []; const its = I.POS[g].items.map(([id, l]) => ({ l, v: abAvg(docs, id), d: prev && abAvg(docsP, id) != null && abAvg(docs, id) != null ? abAvg(docs, id) - abAvg(docsP, id) : null })).filter((x) => x.v != null); return { g, n: docs.length, its }; }).filter((b) => b.its.length);
  // 성장 영역 (골키퍼 포함 전체)
  const allNow = asOf(last); const allPrev = prev ? asOf(prev) : [];
  const gro = I.GROWTH.map((g) => { const v = abAvg(allNow, g.id); const v0 = prev ? abAvg(allPrev, g.id) : null; return { g, v, d: v != null && v0 != null ? v - v0 : null }; });
  // 선수별 OVR 변화 (같은 포지션 묶음 · 바로 앞 확정과 비교)
  const ch = players.map((p) => { const ds = conf.filter((d) => d.uid === p.id); const a = ds[ds.length - 1]; const b = [...ds].reverse().find((d) => d !== a && d.pg === a?.pg); const o = I.ovrOf(a); const o0 = I.ovrOf(b); return { p, o, d: o != null && o0 != null ? o - o0 : null, m: a?.month }; }).filter((x) => x.d != null);
  const ups = [...ch].filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 3); const dns = [...ch].filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 3);
  const name = (r) => `${esc(r.a.l)} <b>${r.v}</b>`;
  // 선수 체크: 팀 · 줄 평균보다 10점 넘게 높거나 낮음 · 바로 앞 확정보다 10점 넘게 오르거나 내림
  const tAvg = avg(nowDocs.map(I.ovrOf).filter((v) => v != null));
  const lAvg = Object.fromEntries(I.LINES.map(([k]) => [k, avg(nowDocs.filter((d) => I.lineOf(d.pos, d.pg) === k).map(I.ovrOf).filter((v) => v != null))]));
  const chk = players.map((p) => { const d0 = nowDocs.find((d) => d.uid === p.id); if (!d0) return null; const o = I.ovrOf(d0); const line = I.lineOf(d0.pos || p.position, d0.pg); const c = ch.find((x) => x.p.id === p.id); const vt = tAvg != null ? Math.round(o - tAvg) : null; const vl = lAvg[line] != null ? Math.round(o - lAvg[line]) : null; const tags = [];
    if (vt >= 10) tags.push(['good', '팀 평균 이상']); if (vt <= -10) tags.push(['bad', '팀 평균 이하']);
    if (c?.d >= 10) tags.push(['up', '급상승']); if (c?.d <= -10) tags.push(['down', '급하락']);
    return { p, o, line, vt, vl, d: c?.d ?? null, tags, m: d0.month }; }).filter(Boolean).sort((a, b) => b.tags.length - a.tags.length || Math.abs(b.d || 0) - Math.abs(a.d || 0));
  const sgn = (v) => (v == null ? '-' : `<span class="p3-trend ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}">${v > 0 ? '+' : ''}${v}</span>`);
  const LN = Object.fromEntries(I.LINES.map(([k, l]) => [k, l]));
  const chkHtml = `<section class="card p3-card"><h3>선수 체크 <small class="muted">필드 선수 · 팀 평균 ${tAvg == null ? '-' : Math.round(tAvg)} · 평균보다 10점 넘게 높거나 낮으면 표시 · 바로 앞 확정보다 10점 넘게 변하면 급상승 · 급하락</small></h3>
    <table class="tbl p3-tbl p3-chk"><tr><th>선수</th><th>줄</th><th>OVR</th><th>팀 평균 대비</th><th>줄 평균 대비</th><th>지난 확정 대비</th><th>체크</th></tr>
    ${chk.map((x) => `<tr class="${x.tags.length ? 'hl' : ''}"><td><a href="#/idp/${esc(x.p.id)}"><b>${esc(x.p.number ? `${x.p.number} ` : '')}${esc(x.p.name || '')}</b></a> <small class="muted">${I.ymLabel(x.m)}</small></td><td><span class="p3-lchip l-${x.line}">${esc(LN[x.line] || '-')}</span></td><td><b>${x.o}</b></td><td>${sgn(x.vt)}</td><td>${sgn(x.vl)}</td><td>${sgn(x.d)}</td><td>${x.tags.map(([k, l]) => `<span class="p3-ctag ${k}">${l}</span>`).join('') || '<span class="muted small">-</span>'}</td></tr>`).join('')}</table>
    <p class="muted small">급하락은 몸 상태 · 마음 · 포지션 변화 때문일 수도 있어요. 점수만 보지 말고 선수와 이야기해 보세요.</p></section>`;
  return `${chkHtml}<section class="card p3-card"><h3>팀 분석 요약 <small class="muted">${I.ymLabel(last)} 기준 · 필드 선수 ${nowDocs.length}명 · 선수마다 가장 최근 확정 점수 · 지난달(${prev ? I.ymLabel(prev) : '-'})과 비교</small></h3>
    <div class="p3-sum4">
      <div class="good"><small>잘하는 것</small>${best.map((r) => `<p>${name(r)}</p>`).join('') || '<p class="muted">-</p>'}</div>
      <div class="bad"><small>부족한 것</small>${worst.map((r) => `<p>${name(r)}</p>`).join('') || '<p class="muted">-</p>'}</div>
      <div class="up"><small>지난달보다 늘었어요</small>${up.map((r) => `<p>${esc(r.a.l)} ${dl(r.d)}</p>`).join('') || '<p class="muted">늘어난 능력치가 없어요</p>'}</div>
      <div class="down"><small>지난달보다 줄었어요</small>${down.map((r) => `<p>${esc(r.a.l)} ${dl(r.d)}</p>`).join('') || '<p class="muted">줄어든 능력치가 없어요</p>'}</div>
    </div>
    ${worst[0] ? `<p class="small p3-reco">훈련 추천: 팀에서 가장 낮은 <b>${esc(worst[0].a.l)}</b>(${worst[0].v})부터 — 다음 달 팀 목표나 훈련 주제로 잡아 보세요.${down[0] ? ` 지난달보다 떨어진 <b>${esc(down[0].a.l)}</b>도 확인이 필요해요.` : ''}</p>` : ''}
  </section>
  <section class="card p3-card"><h3>능력치별 달마다 변화 <small class="muted">팀 평균 0~100 · 칸이 진할수록 높음</small></h3>
    <table class="tbl p3-tbl p3-heat"><tr><th>능력치</th>${months.map((m) => `<th>${I.ymLabel(m)}</th>`).join('')}<th>지난달 대비</th></tr>
    ${rows.map((r) => `<tr><td><b>${esc(r.a.l)}</b></td>${r.vals.map((v) => `<td ${heat(v)}>${v ?? '-'}</td>`).join('')}<td>${dl(r.d) || '-'}</td></tr>`).join('')}
    <tr class="p3-tot"><td><b>팀 OVR</b></td>${months.map((m) => { const v = avg(asOf(m, field).map(I.ovrOf).filter((x) => x != null)); return `<td><b>${v == null ? '-' : Math.round(v)}</b></td>`; }).join('')}<td>${(() => { const a = avg(asOf(last, field).map(I.ovrOf).filter((x) => x != null)); const b = prev ? avg(asOf(prev, field).map(I.ovrOf).filter((x) => x != null)) : null; return a != null && b != null ? dl(Math.round(a) - Math.round(b)) : '-'; })()}</td></tr></table></section>
  <div class="p3-grid">
    <section class="card p3-card"><h3>줄별 비교 <small class="muted">수비 · 미드필더 · 공격 × 능력치 (같은 6개 능력치라 비교 가능)</small></h3>
      ${lineRows.length ? `<table class="tbl p3-tbl p3-heat"><tr><th></th>${I.FIELD.map((a) => `<th>${esc(a.s)}</th>`).join('')}</tr>${lineRows.map((r) => `<tr><td><b>${r.l}</b> <small class="muted">${r.n}명</small></td>${r.vals.map((v) => `<td ${heat(v)}>${v ?? '-'}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="muted small">줄별로 나눌 확정 기록이 없어요.</p>'}</section>
    <section class="card p3-card"><h3>성장 영역 <small class="muted">팀 평균 · 골키퍼 포함</small></h3>
      <ul class="p3-bars">${gro.map((x) => `<li><span>${esc(x.g.l)}</span><div class="p3-meter"><i style="width:${x.v ?? 0}%"></i></div><b class="p3-num">${x.v ?? '-'}</b>${dl(x.d) || '<span></span>'}</li>`).join('')}</ul></section>
  </div>
  <div class="p3-grid">
    <section class="card p3-card"><h3>포지션 전문 능력 <small class="muted">묶음마다 팀 평균 · 같은 묶음끼리만</small></h3>
      ${posBlocks.length ? posBlocks.map((b) => { const srt = [...b.its].sort((x, y) => y.v - x.v); return `<h4>${esc(I.POS[b.g].l)} <small class="muted">${b.n}명 · 강점 ${esc(srt[0].l)} · 부족 ${esc(srt[srt.length - 1].l)}</small></h4><ul class="p3-bars">${b.its.map((x) => `<li><span>${esc(x.l)}</span><div class="p3-meter"><i style="width:${x.v}%"></i></div><b class="p3-num">${x.v}</b>${dl(x.d) || '<span></span>'}</li>`).join('')}</ul>`; }).join('') : '<p class="muted small">확정 기록이 없어요.</p>'}</section>
    <section class="card p3-card"><h3>선수별 변화 <small class="muted">OVR · 같은 포지션 묶음의 바로 앞 확정과 비교 · 순위가 아니라 변화만</small></h3>
      <h4>많이 오른 선수</h4>${ups.length ? `<ul class="list">${ups.map((x) => `<li><a href="#/idp/${esc(x.p.id)}"><b>${esc(x.p.number ? `${x.p.number} ` : '')}${esc(x.p.name)}</b></a> <span class="muted">${x.o}</span> ${dl(x.d)}</li>`).join('')}</ul>` : '<p class="muted small">없어요</p>'}
      <h4>내려간 선수 <small class="muted">이야기해 볼 선수</small></h4>${dns.length ? `<ul class="list">${dns.map((x) => `<li><a href="#/idp/${esc(x.p.id)}"><b>${esc(x.p.number ? `${x.p.number} ` : '')}${esc(x.p.name)}</b></a> <span class="muted">${x.o}</span> ${dl(x.d)}</li>`).join('')}</ul>` : '<p class="muted small">없어요</p>'}</section>
  </div>`;
}

// 확정: 코치 점수 저장 + rev 올리고 같은 번호의 바꾼 기록(history)을 함께
async function confirmDoc(d, scores, reasons, { feedback = '', goalHint = null, what = 'confirm' } = {}) {
  const base = d.coach?.scores || I.draftScores(d);
  const changes = Object.keys(scores).filter((k) => scores[k] !== base[k] || reasons[k]).map((k) => ({ ab: k, from: base[k] ?? null, to: scores[k], reason: reasons[k] || '' }));
  const rev = (d.rev || 0) + 1;
  const coach = { scores, reasons: { ...(d.coach?.reasons || {}), ...reasons }, feedback, goalHint: goalHint || d.coach?.goalHint || null };
  // 점수와 바꾼 기록을 한 번에 (보안 규칙: 같은 번호의 기록이 없으면 확정이 거절됨)
  const { id, ...rest } = d;
  const b = writeBatch(db);
  b.set(doc(hcol(id), String(rev)), { by: state.user.uid, byName: state.profile?.name || '', at: new Date().toISOString(), what: d.status === 'confirmed' ? 'reconfirm' : what, changes, feedback });
  b.set(dref(id), { ...rest, coach, status: 'confirmed', rev, confirmedBy: state.user.uid, confirmedByName: state.profile?.name || '', confirmedAt: new Date().toISOString() });
  await b.commit();
}

// ───────── 선수 성장 카드 (선수 본인 · 코치) ─────────
async function playerView(el, uid, ym = NOW()) {
  const [ms, list, cfg] = await Promise.all([members(), idpOf(uid), loadCfg()]);
  const cfgMode = cfg.mode; const deadline = I.dueOf(ym, cfg.due); const writable = I.canWrite(ym);
  const prevYm = I.ymAdd(NOW(), -1); const prevDoc = list.find((d) => d.month === prevYm);
  const grace = !isCoach() && ym === NOW() && I.canWrite(prevYm) && !(prevDoc && (prevDoc.status === 'submitted' || prevDoc.status === 'confirmed'));
  const me = ms.find((m) => m.id === uid);
  if (!me) { el.innerHTML = empty('선수를 찾지 못했어요.'); return; }
  const coach = isCoach();
  let cur = list.find((d) => d.month === ym);
  const posNow = I.normPos(cur?.pos) || I.normPos(list.filter((d) => d.pos).pop()?.pos) || I.normPos(me.position);
  const defPg = cur?.pg || (posNow ? I.POS_GROUP(posNow) : '') || list.filter((d) => d.pg).pop()?.pg;
  const conf = list.filter((d) => d.status === 'confirmed');
  const pgNow = cur?.pg || defPg;
  const series = conf.filter((d) => d.pg === pgNow && d.tplVer === I.TPL_VER); // 같은 포지션 묶음 · 같은 템플릿만 비교
  const last = series[series.length - 1];
  const prevConf = conf.filter((d) => d.month < ym).pop();
  const hist = cur ? await historyOf(cur.id) : [];
  // 경기 영상 연결 (참고만): 확정된 경기 기록 중 이 선수로 연결된 것
  let evid = [];
  try {
    const ps = await getDocs(query(collection(db, 'teams', state.team.id, 'posts'), where('type', '==', 'analysis')));
    ps.docs.forEach((s) => { const p = s.data(); if (p.mode !== 'match') return; (p.events || []).filter((e) => e.uid === uid).forEach((e) => evid.push({ ...e, post: s.id, title: p.title })); });
  } catch { evid = []; }
  // 개인 목표 (IDP와 연결된 것 · 전체)
  let goals = [];
  try { const gs = await getDocs(query(collection(db, 'teams', state.team.id, 'goals'), where('ownerUid', '==', uid))); goals = gs.docs.map((s) => ({ id: s.id, ...s.data() })).filter((g) => g.scope === 'personal'); } catch { goals = []; }

  const links = await loadLinks(uid, ms.filter((m) => m.role === 'player'));
  // 비교: 코치는 팀 전체 성장 평가로 바로 계산(이름까지) · 선수는 코치가 저장해 둔 평균만
  const roster = ms.filter((m) => m.role === 'player');
  const teamDocs = coach ? await idpOf(null) : [];
  const peer = coach ? computePeer(roster, teamDocs) : await loadPeer();
  if (coach) savePeer(peer);
  const body0 = bodyOf(list.filter((d) => d.month !== ym), links.logs, me); // 지난 몸 기록 (이번 달 칸 미리 채움)
  const dg = buildDigest({ logs: links.logs, idpList: list, member: me, ym });
  const digestSec = `<section class="card p3-card">${digestHtml(dg, { title: `${I.ymLabel(ym)} 자동 정리` })}</section>`;
  const hex = I.hexOf(pgNow);
  const posItems = I.POS[pgNow]?.items || [];
  const st = cur?.status || 'none';
  // 맨 위: 내 OVR 카드 + 능력치 → 세부 · 포지션 · 성장 · 월별 → 이번 달 자기평가 (코치가 검토할 게 있으면 검토가 맨 위)
  const line = I.lineOf(posNow, pgNow);
  const ovr = I.ovrOf(last); const ovr0 = I.ovrOf(series[series.length - 2]);
  const sc = last?.coach?.scores || {};
  const rankedAb = hex.filter((a) => sc[a.id] != null).sort((a, b) => sc[b.id] - sc[a.id]);
  const posSel = `<label class="p3-f">${coach ? '포지션' : '내 포지션'}<select data-pos ${st === 'confirmed' || coach ? 'disabled' : ''}><option value="">고르기</option>${I.LINES.map(([, ln, ps]) => `<optgroup label="${ln}">${ps.map((x) => `<option value="${x}" ${x === posNow ? 'selected' : ''}>${x} · ${I.POS_NAME[x]}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
  const heroHtml = `<div class="p3-hero">
    <section class="p3-mycard p3-pc l-${line || 'none'}">
      <div class="p3-pc-top"><div><b class="p3-ovr">${ovr ?? '-'}</b><small>OVR 참고${last ? ` · ${I.ymLabel(last.month)} 확정` : ''}</small></div><div class="p3-pc-r"><span class="p3-pc-pos">${esc(posNow || '-')}</span><span class="p3-pc-num">${esc(me.number || '')}</span></div></div>
      <div class="p3-pc-name">${esc(me.name || '')}</div>
      <small class="p3-mc-pos">${esc(I.POS_NAME[posNow] || '')}${pgNow ? ` · 평가 문항 ${esc(I.POS[pgNow]?.l || '')}` : ''}</small>
      <div class="p3-mc-row">${ovr != null && ovr0 != null ? `<span class="p3-trend ${ovr - ovr0 > 0 ? 'up' : ovr - ovr0 < 0 ? 'down' : 'flat'}">지난 확정 ${ovr - ovr0 > 0 ? '+' : ''}${ovr - ovr0}</span>` : `<span class="muted small">${last ? '비교할 지난 확정 없음' : '확정되면 OVR이 생겨요'}</span>`}</div>
      ${rankedAb.length ? `<div class="p3-mc-sw"><div><small>강점</small><b>${esc(rankedAb[0].l)}</b></div><div><small>보완</small><b>${esc(rankedAb[rankedAb.length - 1].l)}</b></div></div>` : ''}
      <div class="p3-mc-month"><span>${I.ymLabel(ym)} 자기평가</span><span class="tag ${STATUS[st][1]}">${STATUS[st][0]}</span>${!coach && st !== 'confirmed' && pgNow && writable ? '<button class="btn sm" data-gosurvey>자기평가 하기</button>' : ''}
        <small class="p3-due">${writable ? `마감 ${deadline.getMonth() + 1}/${deadline.getDate()} · ${I.nowDate() > deadline && st !== 'submitted' && st !== 'confirmed' ? '마감 지남 · 늦게 내도 돼요' : I.ddayOf(deadline)}` : '기간이 지나 닫혔어요'}</small></div>
      ${grace ? `<p class="p3-grace">지난달(${I.ymLabel(prevYm)}) 자기평가를 아직 안 냈어요 — <b>${I.GRACE_DAY}일까지</b> 마저 낼 수 있어요. <button class="link-btn small" data-goprev>${I.ymLabel(prevYm)} 쓰기</button></p>` : ''}
      ${ym !== NOW() ? `<p class="p3-grace">${I.ymLabel(ym)} 자기평가를 보고 있어요. <button class="link-btn small" data-gonow>이번 달(${I.ymLabel(NOW())})로</button></p>` : ''}
      <div class="p3-mc-sel">${posSel}</div>
      ${pgNow ? '' : '<p class="p3-why">먼저 내 포지션을 골라 주세요. 포지션마다 묻는 전문 능력이 달라요.</p>'}
    </section>
    <section class="card p3-card"><h3>능력치 <small class="muted">${last ? `${I.ymLabel(last.month)} 확정` : '확정 기록 없음'} · 진한 면 = 이번 확정 · 점선 = 최근 3개월 평균</small></h3>
      <div class="p3-abwrap">${pgNow ? hexSvg(hex, sc, avgMap(series, hex)) : ''}<ul class="p3-stats">${hex.map((a) => statRow(a, last, series)).join('')}</ul></div></section>
  </div>`;
  const monthHtml = `<section class="card p3-card p3-survey" data-month>${monthCard()}</section>`;
  const reviewFirst = coach && st === 'submitted';
  // 성장 카드는 3칸으로 나눔: 요약(카드 · 자동 정리 · 이번 달) · 능력치(세부 · 포지션 · 성장 · 월별) · 연결 기록(일지 · 경기 · 목표 · 피드백 · 바꾼 기록)
  const PT = [['sum', '요약'], ['body', '몸 상태'], ['ab', '능력치 · 비교'], ['goal', '목표'], ['season', '경기'], ['link', '일지 · 피드백']];
  if (!PT.some(([k]) => k === ptab)) ptab = 'sum';
  el.innerHTML = `${coach ? pageHead('PLAYER', [`${me.number ? `${me.number} ` : ''}${me.name || ''}`, posNow, me.grade].filter(Boolean).join(' · '), `<button type="button" class="btn ghost sm" data-prof>프로필 · 관리</button><a class="btn ghost sm" href="#/idp">성장 평가 전체</a>`) : pageHead('MY PAGE', '내 성장 카드')}${banner()}
    <nav class="tabs p3-ptabs">${PT.map(([k, l]) => `<a href="javascript:void 0" data-ptab="${k}" class="${ptab === k ? 'on' : ''}">${l}${k === 'sum' && reviewFirst ? ' <span class="p3-badge">검토</span>' : ''}</a>`).join('')}</nav>
    <div data-pt="sum" ${ptab === 'sum' ? '' : 'hidden'}>
    ${hubHtml(links, goals, evid, uid, { tabs: true })}
    ${reviewFirst ? digestSec + monthHtml : ''}
    ${heroHtml}
    ${reviewFirst ? '' : digestSec}
    ${reviewFirst ? '' : monthHtml}
    </div>
    <div data-pt="body" data-body-embed ${ptab === 'body' ? '' : 'hidden'}></div>
    <div data-pt="goal" ${ptab === 'goal' ? '' : 'hidden'}>${goalsTab()}</div>
    <div data-pt="ab" ${ptab === 'ab' ? '' : 'hidden'}>
    ${peerHtml({ me, pgNow, hex, series, peer, coach, teamDocs, roster, uid })}
    ${pgNow ? subsHtml(hex, last, list.filter((d) => d.pg === pgNow && d.tplVer === I.TPL_VER && d.status !== 'draft')) : ''}
    <section class="card p3-card p3-abd" data-abd><p class="muted small">능력치 · 막대 · 그래프 선을 누르면 그 능력의 월별 점수 · 코치가 바꾼 이유 · 관련 경기 장면이 여기 모이고, 다른 차트에서도 같이 강조돼요.</p></section>
    <div class="p3-grid">
      <section class="card p3-card"><h3>${esc(I.POS[pgNow]?.l || '포지션')} 전문 능력 <small class="muted">같은 포지션 묶음 안에서만 봐요</small></h3>
        ${posItems.length ? `<ul class="p3-bars">${posItems.map(([id, l]) => barRow(id, l, last, series)).join('')}</ul>` : '<p class="muted small">포지션 묶음을 고르면 보여요.</p>'}</section>
      <section class="card p3-card"><h3>성장 영역 <small class="muted">축구 능력치와 따로 봐요</small></h3>
        <ul class="p3-bars">${I.GROWTH.map((g) => barRow(g.id, g.l, last, conf)).join('')}</ul>
        <p class="muted small">신체(스피드 · 체력)는 자기평가보다 측정값(예: 30m 달리기)이 정확해서 이번 시제품에서는 묻지 않아요.</p></section>
    </div>
    <section class="card p3-card"><h3>월별 기록 <small class="muted">같은 포지션 묶음 · 같은 템플릿(${I.TPL_VER})의 확정 점수만 이어요</small></h3>${chartSvg(series, hex)}${monthTable(series, hex, links)}</section>
    </div>
    <div data-pt="season" ${ptab === 'season' ? '' : 'hidden'}><div data-season></div>${goalMapHtml()}</div>
    <div data-pt="link" ${ptab === 'link' ? '' : 'hidden'}>
    ${logsHtml()}
    <div class="p3-grid">
      <section class="card p3-card"><h3>코치 피드백 · 목표</h3>${feedbackHtml()}</section>
      <section class="card p3-card"><h3>경기 영상에서 연결된 장면 <small class="muted">참고만 · 점수에 자동으로 들어가지 않아요</small></h3>${evidHtml()}</section>
    </div>
    ${cur ? `<section class="card p3-card"><h3>바꾼 기록 <small class="muted">${I.ymLabel(cur.month)} · 지우지 않고 쌓여요</small></h3>${hist.length ? `<ul class="list p3-hist">${hist.map((h) => `<li><b>${esc(h.byName || '')}</b> <small class="muted">${when(h.at)} · ${{ confirm: '확정', reconfirm: '다시 확정', 'batch-confirm': '한 번에 확정', submit: '제출' }[h.what] || esc(h.what)}</small>${(h.changes || []).filter((c) => c.from !== c.to || c.reason).map((c) => `<div class="small">${esc(abName(c.ab))}: ${c.from ?? '-'} → <b>${c.to}</b>${c.reason ? ` · ${esc(c.reason)}` : ''}</div>`).join('')}</li>`).join('')}</ul>` : '<p class="muted small">아직 없어요.</p>'}</section>` : ''}
    </div>`;

  // 묻는 양: 이미 쓰기 시작한 자기평가는 처음 양 그대로 (달 중간에 문항이 바뀌지 않게)
  function modeNow() { return cur?.mode || (cur?.answers && Object.keys(cur.answers).length ? 'base' : cfgMode); }
  // ── 이번 달 카드 ──
  function monthCard() {
    const items = pgNow ? I.monthItems(pgNow, ym, modeNow()) : [];
    const head = `<h3>${I.ymLabel(ym)} 자기평가 <span class="tag ${STATUS[st][1]}">${STATUS[st][0]}</span></h3>`;
    if (!pgNow) return `${head}<p class="muted small">포지션 묶음을 고르면 문항이 나와요.</p>`;
    if (coach) {
      if (!cur || st === 'none' || st === 'draft') return `${head}<p class="muted small">선수가 아직 제출하지 않았어요.</p>`;
      return `${head}${reviewHtml(items)}`;
    }
    if (!writable && st !== 'confirmed') return `${head}<p class="muted small">${st === 'submitted' ? '제출한 자기평가예요. 코치님이 확인하면 능력치가 바뀌어요.' : `기간이 지나 닫혔어요 (미제출). 다음 달 자기평가는 매달 1일에 열려요.`}</p>`;
    if (st === 'confirmed') return `${head}<p class="small">코치님이 <b>${when(cur.confirmedAt)}</b>에 확정했어요. 내 원래 답은 그대로 남아 있어요.</p>${answersTable(items, true)}`;
    // 묶음 제목 → (기본 능력치는 능력치마다 작은 제목) → 문항 한 줄씩
    const sec = (area, t, d) => {
      const list = items.filter((it) => it.area === area);
      if (!list.length) return '';
      const groups = area === 'hex' ? byAb(list) : [[area, list]];
      return `<li class="p3-qsec a-${area}"><b>${t}</b> <small class="muted">${d} · ${list.length}문항</small></li>${groups.map(([, its]) => `${area === 'hex' ? `<li class="p3-qab"><b>${esc(its[0].l)}</b><small class="muted">${its.length}문항</small></li>` : ''}${its.map((it) => qRow(it, items.indexOf(it))).join('')}`).join('')}`;
    };
    return `${head}${bodyRow()}<p class="muted small">상황을 떠올리고 <b>10번 중 몇 번</b> 그렇게 하는지 골라요 · ${items.length}문항 · 약 ${Math.round(items.length / 3.8)}분 · 고른 답은 바로 저장돼요 (나눠서 해도 돼요)${st === 'submitted' ? ' · 제출했어요 — 코치님 확정 전까지 고칠 수 있어요' : ''}</p>
      <ol class="p3-q">${sec('hex', '기본 능력치', `능력치마다 ${modeNow() === 'full' ? 10 : 5}문항`)}${sec('pos', `${esc(I.POS[pgNow]?.l || '')} 전문 능력`, '내 포지션')}${sec('growth', '성장', '마음 · 습관 · 소통 · 자기관리')}</ol>
      <div class="row"><button class="btn" data-submit ${items.every((it) => cur?.answers?.[it.id] != null) ? '' : 'disabled'}>${st === 'submitted' ? '다시 제출' : '제출하기'}</button><span class="muted small" data-left>${items.filter((it) => cur?.answers?.[it.id] == null).length}문항 남음</span></div>`;
  }
  // 이번 달 몸 기록: 키 · 몸무게 (지난 기록으로 미리 채움 · 제출하면 같이 저장)
  function bodyRow() {
    const h = cur?.body?.h ?? body0.h ?? ''; const w = cur?.body?.w ?? body0.w ?? '';
    return `<div class="p3-body"><b>이번 달 몸 기록</b>
      <label>키 <input type="number" inputmode="decimal" step="0.1" min="90" max="230" data-bh value="${esc(h)}"> cm</label>
      <label>몸무게 <input type="number" inputmode="decimal" step="0.1" min="20" max="150" data-bw value="${esc(w)}"> kg</label>
      <small class="muted">${body0.h || body0.w ? `지난 기록 ${body0.h ?? '-'}cm · ${body0.w ?? '-'}kg — 바뀌었으면 고쳐 주세요` : '한 달에 한 번 재서 적어요'}</small></div>`;
  }
  function qRow(it, i) {
    const v = cur?.answers?.[it.id];
    return `<li data-q="${it.id}" class="${v != null ? 'done' : ''}"><div class="p3-qt"><span class="p3-qn">${i + 1}</span><div><small class="p3-qsub">${esc(it.area === 'hex' ? it.sub || '' : it.l)}</small><p>${esc(it.text)}</p></div></div>
      <div class="p3-scale">${I.SCALE.map(([n, l, f]) => `<button type="button" class="${v === n ? 'on' : ''}" data-v="${n}"><b>${n}</b><small>${l}</small><small class="muted">${f}</small></button>`).join('')}</div>
      <details ${cur?.notes?.[it.id] ? 'open' : ''}><summary class="small muted">메모 (예: 어떤 경기 · 장면)</summary><input data-note maxlength="80" value="${esc(cur?.notes?.[it.id] || '')}" placeholder="예) 토요일 경기 후반, 압박 받을 때 두 번 뺏김"></details></li>`;
  }
  function answersTable(items, withCoach) {
    const pa = I.draftScores(cur);
    return `<table class="tbl p3-tbl"><tr><th>능력</th><th>내 답</th>${withCoach ? '<th>확정</th>' : ''}</tr>${byAb(items).map(([ab, its]) => { const s0 = cur.coach?.scores?.[ab]; const r = cur.coach?.reasons?.[ab]; return `<tr><td><b>${esc(its[0].l)}</b> <small class="muted">${AREA_L[its[0].area]}</small>${its.map((it) => `<br><small class="muted">${esc(it.text)} → <b>${cur.answers?.[it.id] ?? '-'}</b>${it.rev ? ' (거꾸로 문항)' : ''}</small>`).join('')}</td><td>${pa[ab] ?? '-'}</td>${withCoach ? `<td><b>${s0 ?? '-'}</b>${r ? `<br><small>${esc(r)}</small>` : ''}</td>` : ''}</tr>`; }).join('')}</table>`;
  }
  // ── 코치 검토 ──
  function reviewHtml(items) {
    const fl = I.flagsOf(cur, prevConf);
    const base = cur.coach?.scores || I.draftScores(cur);
    return `<p class="small">${st === 'confirmed' ? `${when(cur.confirmedAt)} 확정됨 — 고치면 이유와 함께 다시 확정돼요.` : `제출 ${when(cur.submittedAt)} · 확인할 것 <b>${fl.n}개</b>${fl.n ? ' (위로 모았어요)' : ' — 그대로 확정해도 돼요'}`}</p>
      ${fl.whole.map((w) => `<p class="p3-why">${esc(w)}</p>`).join('')}
      ${cur.body ? `<p class="small p3-bodyline">몸 기록 · 키 <b>${cur.body.h ?? '-'}cm</b> · 몸무게 <b>${cur.body.w ?? '-'}kg</b>${body0.h && cur.body.h ? ` (지난 기록보다 키 ${(cur.body.h - body0.h >= 0 ? '+' : '')}${(cur.body.h - body0.h).toFixed(1)}cm${body0.w && cur.body.w ? ` · 몸무게 ${(cur.body.w - body0.w >= 0 ? '+' : '')}${(cur.body.w - body0.w).toFixed(1)}kg` : ''})` : ''}</p>` : ''}
      <table class="tbl p3-tbl p3-rev"><tr><th>능력 · 선수 답</th><th>답 평균</th><th>지난 확정</th><th>확정 점수</th></tr>
      ${byAb(items).map(([ab, its]) => ({ ab, its, fl: its.flatMap((it) => fl.items[it.id] || []) })).sort((a, b) => (b.fl.length ? 1 : 0) - (a.fl.length ? 1 : 0)).map(({ ab, its, fl: f0 }) => {
        const vals = its.map((it) => I.scoreOfAnswer(it, cur.answers?.[it.id])).filter((v) => v != null);
        const ps = vals.length ? Math.round(vals.reduce((x, y) => x + y, 0) / vals.length) : null;
        return `<tr class="${f0.length ? 'flag' : ''}" data-ab="${ab}" data-ps="${ps ?? ''}"><td><b>${esc(its[0].l)}</b> <small class="muted">${AREA_L[its[0].area]}</small>
          ${its.map((it) => `<div class="p3-ans"><small class="muted">${esc(it.text)}${it.rev ? ' <i>(거꾸로 문항)</i>' : ''}</small><b>${cur.answers?.[it.id] ?? '-'}</b></div>${cur.notes?.[it.id] ? `<div class="p3-memo">메모 · ${esc(cur.notes[it.id])}</div>` : ''}`).join('')}
          ${[...new Set(f0)].map((f) => `<small class="p3-flag">${esc(f)}</small>`).join('<br>')}</td>
        <td>${vals.length ? (vals.reduce((x, y) => x + y, 0) / vals.length).toFixed(1) : '-'}</td><td>${prevConf?.coach?.scores?.[ab] ?? '-'}</td>
        <td><div class="p3-pick">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="${base[ab] === n ? 'on' : ''}" data-s="${n}">${n}</button>`).join('')}</div><input class="p3-reason" data-reason placeholder="바꾼 이유 (선수 답과 다르면 꼭)" value="${esc(cur.coach?.reasons?.[ab] || '')}" ${base[ab] !== ps || cur.coach?.reasons?.[ab] ? '' : 'hidden'}></td></tr>`; }).join('')}</table>
      <label>피드백 (선수에게 보여요)<textarea data-fb rows="3" maxlength="400" placeholder="잘한 점 1개 · 다음 달 한 가지">${esc(cur.coach?.feedback || '')}</textarea></label>
      <div class="row wrap"><label class="p3-f">다음 달 목표 추천<select data-gab><option value="">고르지 않음</option>${[...hex, ...posItems.map(([id, l]) => ({ id, l })), ...I.GROWTH].map((a) => `<option value="${a.id}" ${cur.coach?.goalHint?.ab === a.id ? 'selected' : ''}>${esc(a.l)}</option>`).join('')}</select></label>
        <input data-gtext maxlength="60" placeholder="예) 공 받기 전 어깨 너머 2번 보기" value="${esc(cur.coach?.goalHint?.text || '')}"></div>
      <div class="row"><button class="btn" data-confirm>${st === 'confirmed' ? '고친 내용으로 다시 확정' : '확정하기'}</button><span class="muted small">선수 원래 답은 바뀌지 않아요 · 바꾼 점수와 이유는 기록으로 남아요</span></div>`;
  }
  // 목표 칸: 진행 중 → 끝난 것
  function goalsTab() {
    if (!goals.length) return `<section class="card p3-card"><p class="muted">아직 목표가 없어요.${coach ? '' : ' <a href="#/goals">목표</a>에서 만들 수 있어요.'}</p></section>`;
    const doing = goals.filter((g) => (g.status || 'doing') === 'doing'); const rest = goals.filter((g) => (g.status || 'doing') !== 'doing');
    const row = (g) => { const p = gPct(g); const pc = gPace(g); return `<li><div class="p3-gl-t"><b>${esc(g.title)}</b><small class="muted">${esc([g.category, g.due ? `기한 ${g.due}` : '', g.idp ? 'IDP 추천' : ''].filter(Boolean).join(' · '))}</small></div>
      <div class="p3-meter"><i style="width:${p}%"></i></div><b class="p3-num">${p}%</b><em class="ga-st k-${pc.k}">${g.status === 'done' ? '달성' : g.status === 'miss' ? '미달' : pc.l}</em></li>`; };
    return `<section class="card p3-card"><h3>진행 중 <small class="muted">${doing.length}개 · 평균 ${doing.length ? Math.round(doing.reduce((s, g) => s + gPct(g), 0) / doing.length) : 0}%</small></h3>${doing.length ? `<ul class="p3-glist">${doing.map(row).join('')}</ul>` : '<p class="muted small">진행 중인 목표가 없어요.</p>'}</section>
      ${rest.length ? `<section class="card p3-card"><h3>끝난 목표 <small class="muted">${rest.length}개 · 달성 ${rest.filter((g) => g.status === 'done').length}</small></h3><ul class="p3-glist">${rest.map(row).join('')}</ul></section>` : ''}
      <p class="muted small">목표는 <a href="#/goals">목표</a> 화면에서 ${coach ? '선수가 직접 관리해요' : '고치고 진행률을 올려요'}.</p>`;
  }
  // 최근 일지 (코치 한마디 · 질문)
  function logsHtml() {
    const ls = [...links.logs].reverse().slice(0, 12);
    if (!ls.length) return '<section class="card p3-card"><h3>최근 일지</h3><p class="muted small">아직 일지가 없어요.</p></section>';
    return `<section class="card p3-card"><h3>최근 일지 <small class="muted">${links.logs.length}개 중 12개</small></h3><ul class="list p3-loglist">${ls.map((l) => { const k = l.kind || (l.match ? 'match' : 'train'); const asks = [...Object.values(l.sessions || {}), ...(l.match?.scenes || [])].filter((x) => x?.ask).length; return `<li><span class="date-badge">${esc(l.date.slice(5).replace('-', '.'))}</span><div><strong>${k === 'match' ? `경기${l.match?.opponent ? ` vs ${esc(l.match.opponent)}` : ''}` : '훈련'} <small class="muted">컨디션 ${l.condition ?? '-'} · ${l.injury ? `부상도 ${l.injury}` : '부상 없음'}${asks ? ` · 질문 ${asks}` : ''}</small></strong>
      <small class="${l.coachComment ? 'ml-cc' : 'muted'}">${l.coachComment ? `코치 한마디: ${esc(l.coachComment.slice(0, 80))}` : l.checked ? '검사 완료' : l.submitted ? '제출 · 검사 대기' : '작성 중'}</small></div></li>`; }).join('')}</ul>
      ${coach ? '<a class="btn ghost sm" href="#/journal-check">일지검사로</a>' : '<a class="btn ghost sm" href="#/daily">오늘 기록으로</a>'}</section>`;
  }
  // 이 선수 득점 지도 (기록실 장면 중 이 선수 골 · 도움)
  function goalMapHtml() {
    const ev = links.games.flatMap((m) => (m.events || []).filter((e) => e.side === 'for' && (e.uid === uid || e.assistUid === uid)).map((e) => ({ ...e, m })));
    const gs = ev.filter((e) => e.uid === uid); const as = ev.filter((e) => e.assistUid === uid);
    if (!ev.length) return '<section class="card p3-card"><h3>득점 지도</h3><p class="muted small">기록실 장면(분 · 위치 · 루트)에 이 선수 골 · 도움이 생기면 여기에 지도로 보여요.</p></section>';
    const top = (arr) => GL.tally(arr.filter(Boolean)).slice(0, 3).map(([k, n]) => `${esc(k)} ${n}`).join(' · ') || '-';
    return `<section class="card p3-card"><h3>득점 지도 <small class="muted">골 ${gs.length} · 도움 ${as.length} · 장면이 적힌 경기 기준</small></h3>
      <div class="p3-grid"><div>${GL.pitchSvg('for', [...as.map((e) => ({ ...e, cls: 'b', t: `도움 ${e.m.date} ${e.name || ''}` })), ...gs.map((e) => ({ ...e, cls: 'f', t: `${e.m.date} vs ${e.m.opponent} ${e.min ?? ''}′ ${e.route || ''}` }))])}<p class="gl-legend"><i class="gl-k f"></i>골 <i class="gl-k b"></i>도움 준 골</p></div>
      <ul class="gl-kv"><li><span>주 지역</span><b>${top(gs.filter((e) => e.x != null).map((e) => GL.zoneOf(e.x, e.y)))}</b></li><li><span>주 루트</span><b>${top(gs.map((e) => e.route))}</b></li><li><span>도움 받은 선수</span><b>${top(gs.map((e) => e.assistName))}</b></li><li><span>도움 준 선수</span><b>${top(as.map((e) => e.name))}</b></li></ul></div>
      <a class="btn ghost sm" href="#/analysis/goals">분석실에서 더 보기</a></section>`;
  }
  function feedbackHtml() {
    const src = cur?.status === 'confirmed' ? cur : last;
    const gh = src?.coach?.goalHint;
    const linked = goals.filter((g) => g.idp);
    return `${src?.coach?.feedback ? `<p class="p3-fb">${esc(src.coach.feedback)}</p><p class="muted small">${I.ymLabel(src.month)} · ${esc(src.confirmedByName || '')}</p>` : '<p class="muted small">아직 피드백이 없어요.</p>'}
      ${gh?.ab ? `<div class="p3-goal"><b>코치 추천 목표</b> <span class="tag">${esc(abName(gh.ab))}</span><p>${esc(gh.text || `${abName(gh.ab)} 한 단계 올리기`)}</p>${!coach && !linked.some((g) => g.idp?.ab === gh.ab && g.idp?.month === src.month) ? '<button class="btn sm" data-mkgoal>내 목표로 만들기</button>' : '<span class="muted small">목표로 만들었어요</span>'}</div>` : ''}
      ${linked.length ? `<h4>IDP에서 만든 목표</h4><ul class="list">${linked.map((g) => `<li><b>${esc(g.title)}</b> <small class="muted">${esc(abName(g.idp.ab))} · ${I.ymLabel(g.idp.month)} · ${g.status === 'done' ? '달성' : '진행 중'}</small></li>`).join('')}</ul>` : ''}
      <p class="muted small">목표는 <a href="#/goals">목표</a> 화면에서 선수가 직접 관리해요.</p>`;
  }
  function evidHtml() {
    if (!evid.length) return '<p class="muted small">이 선수와 연결된 경기 기록이 아직 없어요. 영상룸 경기 영상에서 우리 팀 기록에 선수를 연결하면 여기에 모여요.</p>';
    const cnt = {}; evid.forEach((e) => { cnt[e.k] = (cnt[e.k] || 0) + 1; });
    const names = { attack: '공격 전개', through: '스루패스', long: '롱볼', dribble: '돌파', cross: '크로스', shot: '슈팅', goal: '득점', press: '압박', win: '볼 탈취', clear: '클리어링', save: '선방', duel: '경합', loss: '볼 뺏김', counter: '역습', gegen: '역압박', corner: '코너킥', freekick: '프리킥', penalty: '페널티킥', foul: '파울', note: '메모', offside: '오프사이드' };
    const posts = [...new Set(evid.map((e) => e.post))];
    return `<p class="small">확정된 경기 기록 <b>${evid.length}개</b> · 경기 ${posts.length}개</p>
      <div class="p3-chips">${Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="tag">${esc(names[k] || k)} ${n}</span>`).join('')}</div>
      <ul class="list small">${posts.map((p) => `<li><a href="#/analysis/${esc(p)}">${esc(evid.find((e) => e.post === p).title || '경기 영상')}</a> <span class="muted">${evid.filter((e) => e.post === p).length}개</span></li>`).join('')}</ul>
      <p class="muted small">코치가 검토할 때 근거로 보는 자료예요. 기록이 많다고 능력치가 오르지 않아요 (경기마다 기록한 양이 달라서요).</p>`;
  }

  // ── 차트 연동: 능력 하나를 고르면 모든 차트에서 강조 + 상세 칸 ──
  const KN = { attack: '공격 전개', through: '스루패스', long: '롱볼', dribble: '돌파', cross: '크로스', shot: '슈팅', goal: '득점', press: '압박', win: '볼 탈취', clear: '클리어링', save: '선방', duel: '경합', loss: '볼 뺏김', counter: '역습', gegen: '역압박' };
  const allConf = conf.filter((d) => d.tplVer === I.TPL_VER);
  function selectAb(ab) {
    const on = el.dataset.sel !== ab ? ab : '';
    el.dataset.sel = on;
    el.querySelectorAll('[data-ab]').forEach((x) => { x.classList.toggle('sel', !!on && x.dataset.ab === on); x.classList.toggle('dim', !!on && x.dataset.ab !== on && !!x.closest('.p3-chart, .p3-hex, .p3-legend')); });
    const box0 = el.querySelector('[data-abd]');
    if (!on) { box0.innerHTML = '<p class="muted small">능력치 · 막대 · 그래프 선을 누르면 그 능력의 월별 점수 · 코치가 바꾼 이유 · 관련 경기 장면이 여기 모여요.</p>'; return; }
    const ser = (I.FIELD.concat(I.GK).some((a) => a.id === on) || Object.values(I.POS).some((p0) => p0.items.some(([id]) => id === on))) ? series : allConf;
    const pts = ser.filter((d) => d.coach?.scores?.[on] != null);
    const t0 = I.trendOf(ser, on);
    const kinds = I.AB_KINDS[on] || [];
    const ev = evid.filter((e) => kinds.includes(e.k));
    const byPost = [...new Set(ev.map((e) => e.post))];
    const reasons = pts.filter((d) => d.coach?.reasons?.[on]).map((d) => [d.month, d.coach.reasons[on]]);
    const ans = cur?.answers ? Object.entries(cur.answers).find(([k]) => k.split('#')[0] === on) : null;
    box0.innerHTML = `<div class="row between wrap"><h3>${esc(abName(on))} <small class="muted">${t0.l}${t0.avg != null ? ` · 최근 평균 ${I.stat(Math.round(t0.avg * 10) / 10)}` : ''}</small></h3><button class="link-btn small" data-unsel>닫기</button></div>
      <div class="p3-abgrid">
        <div><h4>월별 확정 점수</h4>${pts.length ? `<div class="p3-chips">${pts.map((d) => `<span class="tag">${I.ymLabel(d.month)} <b>${I.stat(d.coach.scores[on])}</b></span>`).join('')}</div>` : '<p class="muted small">아직 확정 점수가 없어요.</p>'}
          ${ans ? `<p class="small">이번 달 선수 답: <b>${ans[1]}</b>${cur.notes?.[ans[0]] ? ` · 메모 "${esc(cur.notes[ans[0]])}"` : ''}</p>` : ''}</div>
        <div><h4>코치가 바꾼 이유</h4>${reasons.length ? `<ul class="list small">${reasons.map(([m, r]) => `<li><b>${I.ymLabel(m)}</b> ${esc(r)}</li>`).join('')}</ul>` : '<p class="muted small">선수 답 그대로 확정했어요.</p>'}</div>
        <div><h4>관련 경기 장면 <small class="muted">참고만</small></h4>${!kinds.length ? '<p class="muted small">이 능력은 경기 기록 종류로 바로 이어지지 않아요 — 코치가 영상을 보고 판단하는 영역이에요.</p>' : ev.length ? `<div class="p3-chips">${kinds.map((k) => { const n = ev.filter((e) => e.k === k).length; return n ? `<span class="tag">${KN[k] || k} ${n}</span>` : ''; }).join('')}</div><ul class="list small">${byPost.map((p0) => `<li><a href="#/analysis/${esc(p0)}">${esc(ev.find((e) => e.post === p0).title || '경기 영상')}</a> <span class="muted">${ev.filter((e) => e.post === p0).length}개</span></li>`).join('')}</ul>` : `<p class="muted small">${kinds.map((k) => KN[k] || k).join(' · ')} 기록 중 이 선수와 연결된 것이 아직 없어요.</p>`}</div>
      </div>`;
    box0.querySelector('[data-unsel]').onclick = () => selectAb(on);
  }
  // 차트 연동은 능력치 · 막대 · 그래프에서만 (검토 표에서 점수를 누를 때는 화면이 움직이지 않게)
  el.querySelectorAll('[data-ab]').forEach((x) => { if (x.closest('.p3-rev')) return; x.style.cursor = 'pointer'; x.addEventListener('click', () => selectAb(x.dataset.ab)); });

  // ── 동작 ──
  const box = el.querySelector('[data-month]');
  mountSeason(el.querySelector('[data-season]'), seasonData(links, list)); // 시즌 · 대회 · 월별 기록
  const bodyBox = el.querySelector('[data-body-embed]');
  const openBody = () => { if (ptab === 'body' && !bodyBox.dataset.done) { bodyBox.dataset.done = '1'; bodyBox.innerHTML = '<p class="muted small">불러오는 중…</p>'; dataPage(bodyBox, { uid }).catch(fail); } };
  el.querySelectorAll('[data-ptab]').forEach((t) => (t.onclick = () => { ptab = t.dataset.ptab; el.querySelectorAll('[data-ptab]').forEach((x) => x.classList.toggle('on', x === t)); el.querySelectorAll('[data-pt]').forEach((d) => { d.hidden = d.dataset.pt !== ptab; }); openBody(); }));
  openBody();
  el.querySelector('[data-prof]')?.addEventListener('click', () => { try { sessionStorage.setItem('ssaka.locker.open', uid); } catch { /* */ } go('/locker'); });
  // 비교 육각형: 같은 포지션 · 같은 학년 · 팀
  el.querySelectorAll('[data-pcmp]').forEach((b) => (b.onclick = () => { el.querySelectorAll('[data-pcmp]').forEach((x) => x.classList.toggle('on', x === b)); el.querySelectorAll('[data-phex]').forEach((h) => { h.hidden = h.dataset.phex !== b.dataset.pcmp; }); }));
  const goTab = (k) => el.querySelector(`[data-ptab="${k}"]`)?.click();
  // 요약 칸의 '연결된 기록 · 능력치' 바로가기
  el.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => goTab(b.dataset.goto)));
  el.querySelector('[data-gosurvey]')?.addEventListener('click', () => { goTab('sum'); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  el.querySelector('[data-goprev]')?.addEventListener('click', () => playerView(el, uid, prevYm));
  el.querySelector('[data-gonow]')?.addEventListener('click', () => playerView(el, uid, NOW()));
  el.querySelector('[data-pos]')?.addEventListener('change', async (e) => {
    const pos = e.target.value; if (!pos) return;
    const pg = I.POS_GROUP(pos);
    if (pg !== pgNow && cur?.answers && Object.keys(cur.answers).length && !(await confirmBox('포지션이 바뀌면 포지션 전문 문항이 달라져요. 바꿀까요?'))) { e.target.value = posNow; return; }
    await savePart({ pos, pg }); playerView(el, uid, ym);
  });
  async function savePart(part) {
    const id = idOf(uid, ym);
    cur = { id, uid, name: me.name || '', month: ym, mode: modeNow(), pos: posNow, pg: pgNow, tplVer: I.TPL_VER, status: 'draft', answers: {}, notes: {}, rev: 0, ...(cur || {}), ...part };
    if (cur.status === 'confirmed') return;
    const { id: _i, ...data } = cur; void _i;
    await setDoc(dref(id), data);
  }
  box.querySelectorAll('[data-q]').forEach((li) => {
    const qid = li.dataset.q;
    li.querySelectorAll('[data-v]').forEach((b) => (b.onclick = async () => {
      try {
        await savePart({ answers: { ...(cur?.answers || {}), [qid]: +b.dataset.v } });
        li.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b));
        li.classList.add('done');
        const items = I.monthItems(pgNow, ym, modeNow()); const left = items.filter((it) => cur.answers[it.id] == null).length;
        box.querySelector('[data-left]').textContent = left ? `${left}문항 남음` : '모두 답했어요';
        box.querySelector('[data-submit]').disabled = !!left;
      } catch (e) { fail(e); }
    }));
    const n = li.querySelector('[data-note]');
    if (n) n.onchange = () => savePart({ notes: { ...(cur?.notes || {}), [qid]: n.value.trim().slice(0, 80) } }).catch(fail);
  });
  const bodyNow = () => { const h = +box.querySelector('[data-bh]')?.value || null; const w = +box.querySelector('[data-bw]')?.value || null; return h || w ? { ...(h ? { h } : {}), ...(w ? { w } : {}) } : null; };
  box.querySelectorAll('[data-bh], [data-bw]').forEach((inp) => (inp.onchange = () => { const b = bodyNow(); if (b) savePart({ body: b }).catch(fail); }));
  box.querySelector('[data-submit]')?.addEventListener('click', async () => {
    try {
      const b = bodyNow();
      await savePart({ status: 'submitted', submittedAt: new Date().toISOString(), ...(b ? { body: b } : {}) });
      await addDoc(hcol(cur.id), { by: uid, byName: me.name || '', at: new Date().toISOString(), what: 'submit', changes: [] }).catch(() => {});
      toast('제출했어요. 코치님이 확인하면 능력치가 바뀌어요.'); refreshIdpFlag(); playerView(el, uid, ym);
    } catch (e) { fail(e); }
  });
  // 코치 검토
  const rev = box.querySelector('.p3-rev');
  if (rev) {
    rev.querySelectorAll('tr[data-ab]').forEach((tr) => {
      tr.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => {
        tr.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b));
        const r = tr.querySelector('[data-reason]'); r.hidden = +b.dataset.s === +tr.dataset.ps && !r.value; if (!r.hidden && +b.dataset.s !== +tr.dataset.ps) r.focus();
      }));
    });
    box.querySelector('[data-confirm]').onclick = async () => {
      const scores = {}; const reasons = {}; let miss = null;
      rev.querySelectorAll('tr[data-ab]').forEach((tr) => {
        const on = tr.querySelector('[data-s].on'); if (!on) return;
        const s = +on.dataset.s; scores[tr.dataset.ab] = s;
        const r = tr.querySelector('[data-reason]').value.trim();
        if (r) reasons[tr.dataset.ab] = r;
        if (tr.dataset.ps !== '' && s !== +tr.dataset.ps && !r && !miss) miss = tr;
      });
      if (miss) { toast('선수 답과 다르게 정한 점수는 이유를 한 줄 적어 주세요.'); miss.querySelector('[data-reason]').hidden = false; miss.querySelector('[data-reason]').focus(); return; }
      const gab = box.querySelector('[data-gab]').value;
      try {
        await confirmDoc(cur, scores, reasons, { feedback: box.querySelector('[data-fb]').value.trim(), goalHint: gab ? { ab: gab, text: box.querySelector('[data-gtext]').value.trim() } : null });
        toast('확정했어요. 선수 화면에도 바로 보여요.'); refreshIdpFlag(); playerView(el, uid, ym);
      } catch (e) { fail(e); }
    };
  }
  el.querySelector('[data-mkgoal]')?.addEventListener('click', async () => {
    const src = cur?.status === 'confirmed' ? cur : last; const gh = src.coach.goalHint;
    try {
      await addDoc(collection(db, 'teams', state.team.id, 'goals'), { scope: 'personal', title: gh.text || `${abName(gh.ab)} 한 단계 올리기`, category: '경기력', why: `IDP ${I.ymLabel(src.month)} 코치 추천`, how: '', due: '', status: 'doing', progress: 0, ownerUid: state.user.uid, ownerName: state.profile?.name || '', createdAt: serverTimestamp(), idp: { ab: gh.ab, month: src.month, tplVer: src.tplVer } });
      toast('내 목표에 넣었어요.'); playerView(el, uid, ym);
    } catch (e) { fail(e); }
  });
}

const ALL_AB = [...I.FIELD, ...I.GK, ...Object.values(I.POS).flatMap((p) => p.items.map(([id, l]) => ({ id, l }))), ...I.GROWTH];
const abName = (id) => ALL_AB.find((a) => a.id === id)?.l || id;
function avgMap(series, hex) { const m = {}; hex.forEach((a) => { const t = I.trendOf(series, a.id); if (t.avg != null) m[a.id] = t.avg; }); return m; }
const TREND_CLS = { up: 'up', down: 'down', flat: 'flat', wait: 'wait' };
function spark(series, ab) {
  const pts = series.filter((d) => d.coach?.scores?.[ab] != null).slice(-3).map((d) => d.coach.scores[ab]);
  if (pts.length < 2) return '';
  const w = 54; const h = 18;
  const xy = pts.map((v, i) => `${(i / (pts.length - 1)) * (w - 4) + 2},${h - 2 - ((v - 1) / 4) * (h - 4)}`).join(' ');
  return `<svg class="p3-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${xy}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
}
function statRow(a, last, series) {
  const s = last?.coach?.scores?.[a.id]; const t = I.trendOf(series, a.id);
  return `<li data-ab="${a.id}" class="p3-sel-able"><span>${esc(a.l)}</span><b class="p3-num">${s != null ? I.stat(s) : '-'}</b>${spark(series, a.id)}<span class="p3-trend ${TREND_CLS[t.k]}">${t.l}</span></li>`;
}
function barRow(id, l, last, series) {
  const s = last?.coach?.scores?.[id]; const t = I.trendOf(series, id);
  return `<li data-ab="${id}" class="p3-sel-able"><span>${esc(l)}</span><div class="p3-meter"><i style="width:${s != null ? I.stat(s) : 0}%"></i></div><b class="p3-num">${s != null ? I.stat(s) : '-'}</b><span class="p3-trend ${TREND_CLS[t.k]}">${t.l}</span></li>`;
}
// 육각형: 진한 면 = 이번 확정, 점선 = 최근 3개월 평균
function hexSvg(hex, cur, avg) {
  const C = 120; const R = 86;
  const pt = (i, v) => { const a = (-90 + i * 60) * (Math.PI / 180); const r = (R * Math.max(0, v)) / 100; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const poly = (vals) => vals.map((v, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
  const rings = [25, 50, 75, 100].map((r) => `<polygon points="${poly(hex.map(() => r))}" class="p3-ring"/>`).join('');
  const axes = hex.map((_, i) => { const [x, y] = pt(i, 100); return `<line x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="p3-ring"/>`; }).join('');
  const has = hex.some((a) => cur[a.id] != null);
  const curP = has ? `<polygon points="${poly(hex.map((a) => I.stat(cur[a.id]) ?? 0))}" class="p3-cur"/>` : '';
  const avgP = Object.keys(avg).length ? `<polygon points="${poly(hex.map((a) => (avg[a.id] != null ? ((avg[a.id] - 1) / 4) * 100 : 0)))}" class="p3-avg"/>` : '';
  const dots = has ? hex.map((a, i) => { const [x, y] = pt(i, I.stat(cur[a.id]) ?? 0); return `<circle data-ab="${a.id}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" class="p3-hdot"/>`; }).join('') : '';
  const labels = hex.map((a, i) => { const [x, y] = pt(i, 122); return `<g data-ab="${a.id}" class="p3-hab"><text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" class="p3-hl">${esc(a.l)}</text><text x="${x.toFixed(1)}" y="${(y + 18).toFixed(1)}" text-anchor="middle" class="p3-hv">${cur[a.id] != null ? I.stat(cur[a.id]) : '-'}</text></g>`; }).join('');
  return `<svg class="p3-hex" viewBox="-30 -10 300 270" role="img" aria-label="능력치 육각형">${rings}${axes}${avgP}${curP}${dots}${labels}${has ? '' : `<text x="${C}" y="${C}" text-anchor="middle" class="p3-hl">확정 기록이 생기면 그려져요</text>`}</svg>`;
}
// ───────── 비교: 이 선수 vs 같은 포지션 · 같은 학년 · 팀 (월별 OVR 선 · 능력치 육각형 · 순위) ─────────
// 선수 화면은 그룹 인원이 MIN_N 명보다 적으면 평균을 숨김 (누구 점수인지 짐작되지 않게) · 코치는 이름까지
function peerHtml({ me, pgNow, hex, series, peer, coach, teamDocs, roster, uid }) {
  const grade = me.grade || '';
  const pgL = I.POS[pgNow]?.l || '같은 포지션';
  const ok = (g) => g && (coach ? g.n >= 1 : g.n >= MIN_N);
  const months = [...new Set([...series.map((d) => d.month), ...Object.keys(peer)])].sort().slice(-6);
  if (!months.length || !pgNow) return '<section class="card p3-card"><h3>비교</h3><p class="muted small">확정된 성장 평가가 생기면 같은 포지션 · 같은 학년 · 팀 평균과 비교해서 보여요.</p></section>';
  const myDoc = (m) => series.find((d) => d.month === m);
  const last = series[series.length - 1]; const lm = last?.month;
  const GR = [['pg', pgL, (m) => peer[m]?.pg?.[pgNow]], ...(grade ? [['grade', grade, (m) => peer[m]?.grade?.[grade]]] : []), ['team', '팀 전체', (m) => peer[m]?.team]];
  const h0 = Math.max(0, GR.findIndex(([, , f]) => ok(f(lm || months[months.length - 1]))));
  const ymL = (m) => I.ymLabel(m);
  const names = (k) => { if (!coach || !lm) return ''; const byId = Object.fromEntries(roster.map((p) => [p.id, p])); const pred = k === 'pg' ? (d) => d.pg === pgNow : k === 'grade' ? (d) => byId[d.uid].grade === grade : () => true; const rows = teamDocs.filter((d) => d.month === lm && d.status === 'confirmed' && d.tplVer === I.TPL_VER && byId[d.uid] && pred(d)).map((d) => [byId[d.uid].name, I.ovrOf(d), d.uid]).filter((r) => r[1] != null).sort((a, b) => b[1] - a[1]); return rows.length > 1 ? `<details class="p3-nm"><summary class="small muted">이름 · 순위 보기 (코치만)</summary><ol class="p3-rk">${rows.map(([n, o, u]) => `<li class="${u === uid ? 'me' : ''}"><span>${esc(n)}</span><b>${o}</b></li>`).join('')}</ol></details>` : ''; };
  // 카드 하나: 큰 숫자(나) + 평균과 차이 + 선 그래프 (파란 = 나 · 회색 점선 = 평균)
  const cardOf = (label, mineF, avgF, gl, extra = '') => {
    const mv = lm ? mineF(lm) : null; const av = lm ? avgF(lm) : null;
    const dif = mv != null && av != null ? Math.round(mv - av) : null;
    return `<section class="card p3-cc"><div class="card-head"><h4>${esc(label)}</h4><b class="dr-avg">${mv ?? '-'}</b></div>
      <p class="p3-ccd">${av != null ? `${esc(gl)} 평균 <b>${Math.round(av)}</b> · ${dif == null ? '' : dif > 0 ? `<em class="up">+${dif} 높아요</em>` : dif < 0 ? `<em class="down">${dif} 낮아요</em>` : '<em>평균과 같아요</em>'}` : '<span class="muted">비교할 평균이 없어요</span>'}</p>
      ${lineChart(months, [{ pts: months.map(mineF), color: '#4ea1ff', fill: true }, { pts: months.map(avgF), color: 'rgba(160,160,160,.9)', dash: true }], 100, true, ymL)}${extra}</section>`;
  };
  const panes = GR.map(([k, gl, f], gi) => {
    const g = (m) => (ok(f(m)) ? f(m) : null);
    const gLast = lm ? g(lm) : null;
    const myO = last ? I.ovrOf(last) : null;
    const rank = gLast && myO != null ? `<p class="p3-rank">${esc(gl)} ${gLast.n}명 중 <b>${gLast.ovrs.filter((o) => o > myO).length + 1}위</b></p>` : '';
    const hidden = !coach && lm && f(lm) && !ok(f(lm)) ? `<p class="muted small">${esc(gl)}은(는) ${MIN_N}명보다 적어 평균을 숨겼어요 (누구 점수인지 짐작되지 않게).</p>` : '';
    return `<div data-phex="${k}" ${gi === h0 ? '' : 'hidden'}>${hidden}<div class="dr-grid p3-ccgrid">
      ${cardOf('OVR', (m) => (myDoc(m) ? I.ovrOf(myDoc(m)) : null), (m) => g(m)?.ovr ?? null, gl, rank + names(k))}
      ${hex.map((a) => cardOf(a.l, (m) => I.stat(myDoc(m)?.coach?.scores?.[a.id]), (m) => (g(m)?.ab?.[a.id] != null ? I.stat(g(m).ab[a.id]) : null), gl)).join('')}
    </div></div>`;
  }).join('');
  return `<section class="card p3-card p3-peer"><div class="row between wrap"><h3>비교 <small class="muted">${lm ? `${I.ymLabel(lm)} 확정 기준` : '확정 기록 없음'}</small></h3>
      <div class="seg p3-cmpseg">${GR.map(([k, l], i) => `<button type="button" data-pcmp="${k}" class="${i === h0 ? 'on' : ''}">${k === 'pg' ? '같은 포지션' : k === 'grade' ? '같은 학년' : '팀 전체'}<small> ${k === 'team' ? '' : esc(l)}</small></button>`).join('')}</div></div>
    <p class="muted small p3-cmpkey"><i class="p3-kme"></i>나 <i class="p3-kav"></i>고른 그룹 평균${coach ? '' : ` · ${MIN_N}명 이상 모인 그룹만 · 이름은 안 보여요`}</p>
    ${panes}</section>`;
}
const LINE_C = ['#39e75f', '#4ea1ff', '#ffd60a', '#ff9f0a', '#bf5af2', '#ff453a'];
function chartSvg(series, hex) {
  const ss = series.slice(-6);
  if (ss.length < 2) return '<p class="muted small">확정된 달이 2개 이상이면 선으로 이어져요.</p>';
  const W = 560; const H = 170; const L = 34; const B = 24; const T = 10;
  const X = (i) => L + (i / (ss.length - 1)) * (W - L - 16); const Y = (v) => T + (1 - v / 100) * (H - T - B);
  const grid = [0, 25, 50, 75, 100].map((v) => `<line x1="${L}" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}" class="p3-ring"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" class="p3-ax">${v}</text>`).join('');
  const xs = ss.map((d, i) => `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" class="p3-ax">${I.ymLabel(d.month)}</text>`).join('');
  const lines = hex.map((a, k) => { const pts = ss.map((d, i) => (d.coach?.scores?.[a.id] != null ? `${X(i)},${Y(I.stat(d.coach.scores[a.id]))}` : null)).filter(Boolean); return pts.length > 1 ? `<g data-ab="${a.id}" class="p3-cl"><polyline points="${pts.join(' ')}" fill="none" stroke="${LINE_C[k]}" stroke-width="2"/>${pts.map((p) => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="2.6" fill="${LINE_C[k]}"/>`).join('')}</g>` : ''; }).join('');
  return `<svg class="p3-chart" viewBox="0 0 ${W} ${H}">${grid}${xs}${lines}</svg><div class="p3-legend">${hex.map((a, k) => `<span data-ab="${a.id}" class="p3-sel-able"><i style="background:${LINE_C[k]}"></i>${esc(a.l)}</span>`).join('')}</div>`;
}
function monthTable(series, hex, links) {
  const ss = series.slice(-4);
  if (!ss.length) return '';
  return `<table class="tbl p3-tbl"><tr><th>능력치</th>${ss.map((d) => `<th>${I.ymLabel(d.month)}</th>`).join('')}<th>지난달 대비</th></tr>${hex.map((a) => { const v = ss.map((d) => d.coach?.scores?.[a.id]); const a1 = v[v.length - 1]; const a0 = v[v.length - 2]; const dlt = a1 != null && a0 != null ? I.stat(a1) - I.stat(a0) : null; return `<tr data-ab="${a.id}" class="p3-sel-able"><td>${esc(a.l)}</td>${v.map((x) => `<td>${x != null ? I.stat(x) : '-'}</td>`).join('')}<td class="${dlt > 0 ? 'up' : dlt < 0 ? 'down' : ''}">${dlt == null ? '-' : dlt === 0 ? '같음' : `${dlt > 0 ? '+' : ''}${dlt}`}</td></tr>`; }).join('')}
    ${links ? `<tr class="lk-sep"><td colspan="${ss.length + 2}">같은 달의 다른 기록 (참고)</td></tr>${monthLinkRows(ss.map((d) => d.month), links)}` : ''}</table>
    <p class="muted small">한 단계 = 25점이에요. 능력치 점수는 그 달 문항(기본 5개)의 평균이라 한 달 변화는 흔들릴 수 있어요 — 추세(최근 3개월)를 함께 보세요. 아래 훈련일지 · 경기 기록은 참고로 나란히 보여 줄 뿐, 점수에 들어가지 않아요.</p>`;
}

// ───────── 선수 카드 (오버롤 한눈에) — 포지션 묶음별 · 같은 묶음끼리만 비교 · 순위는 매기지 않음 ─────────
function cardInfo(players, all, rows) {
  return players.map((p) => {
    const mine = all.filter((d) => d.uid === p.id && d.status === 'confirmed' && d.tplVer === I.TPL_VER);
    const last = mine[mine.length - 1];
    const pos = I.normPos(all.filter((d) => d.uid === p.id && d.pos).pop()?.pos) || I.normPos(p.position);
    const pg = last?.pg || all.filter((d) => d.uid === p.id && d.pg).pop()?.pg || I.POS_GROUP(pos);
    const line = I.lineOf(pos, pg);
    const same = mine.filter((d) => d.pg === pg);
    const lc = same[same.length - 1]; const pv = same[same.length - 2];
    const o = I.ovrOf(lc); const o0 = I.ovrOf(pv);
    const st = rows.find((r) => r.p.id === p.id)?.st || 'none';
    return { p, pos, pg, line, lc, o, d: o != null && o0 != null ? o - o0 : null, st, n: same.length };
  });
}
function cardsHtml(players, all, rows, ov = []) {
  const info = cardInfo(players, all, rows).map((x) => ({ ...x, lv: ov.find((r) => r.p.id === x.p.id)?.lv }));
  if (!info.length) return '<p class="muted">해당하는 선수가 없어요.</p>';
  const groups = I.LINES.map(([k, l]) => [l, info.filter((x) => x.line === k)]).filter(([, l]) => l.length);
  const noPg = info.filter((x) => !x.line);
  return `<section class="card p3-card"><p class="muted small" style="margin-top:0">OVR = 능력치 6개 확정 점수 평균 (참고용) · 골키퍼는 따로 · 카드를 누르면 성장 카드</p>
    ${groups.map(([ln, l]) => `<h4 class="p3-gh l-${l[0].line}"><i></i>${esc(ln)} <small class="muted">${l.length}명</small></h4><div class="p3-cards">${l.map(card).join('')}</div>`).join('')}
    ${noPg.length ? `<h4 class="p3-gh">포지션 묶음 없음 <small class="muted">선수가 자기평가에서 고르면 들어가요</small></h4><div class="p3-cards">${noPg.map(card).join('')}</div>` : ''}
  </section>`;
}
function card({ p, pos, pg, line, lc, o, d, st, n, lv }) {
  const hex = I.hexOf(pg || '');
  const sc = lc?.coach?.scores || {};
  const ranked = hex.filter((a) => sc[a.id] != null).sort((a, b) => sc[b.id] - sc[a.id]);
  const tier = o == null ? 'none' : o >= 75 ? 'gold' : o >= 50 ? 'silver' : 'bronze';
  void tier;
  return `<a class="p3-pc l-${line || 'none'}" href="#/idp/${esc(p.id)}">
    <div class="p3-pc-top"><div><b class="p3-ovr">${o ?? '-'}</b><small>OVR 참고</small></div><div class="p3-pc-r"><span class="p3-pc-pos" title="${esc(I.POS_NAME[pos] || '')}">${esc(pos || pg || '-')}</span><span class="p3-pc-num">${esc(p.number || '')}</span></div></div>
    ${miniHex(hex, sc)}
    <div class="p3-pc-name">${esc(p.name || '')}</div>
    <div class="p3-pc-stats">${hex.map((a) => `<span><b>${sc[a.id] != null ? I.stat(sc[a.id]) : '-'}</b>${esc(a.s || a.l)}</span>`).join('')}</div>
    <div class="p3-pc-foot">${d == null ? `<span class="muted">${n ? '비교할 지난달 없음' : '확정 기록 없음'}</span>` : `<span class="p3-trend ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">지난달 ${d > 0 ? '+' : ''}${d}</span>`}
      ${ranked[0] ? `<span>강점 <b>${esc(ranked[0].s || ranked[0].l)}</b></span>` : ''}<span class="tag ${STATUS[st][1]}">${STATUS[st][0]}</span>${lv === 'bad' ? '<span class="tag bad">먼저 볼 선수</span>' : ''}</div>
  </a>`;
}
function miniHex(hex, sc) {
  const C = 50; const R = 38;
  const pt = (i, v) => { const a = (-90 + i * 60) * (Math.PI / 180); const r = (R * v) / 100; return `${(C + r * Math.cos(a)).toFixed(1)},${(C + r * Math.sin(a)).toFixed(1)}`; };
  const ring = (v) => `<polygon points="${hex.map((_, i) => pt(i, v)).join(' ')}" class="p3-ring"/>`;
  const has = hex.some((a) => sc[a.id] != null);
  return `<svg class="p3-mhex" viewBox="0 0 100 100">${ring(100)}${ring(50)}${has ? `<polygon points="${hex.map((a, i) => pt(i, I.stat(sc[a.id]) ?? 0)).join(' ')}" class="p3-cur"/>` : ''}</svg>`;
}

// ───────── 자기평가 데이터 (팀) — 제출 현황 · 능력치별 평균 · 답 분포 · 코치가 고친 비율 · CSV ─────────
function dataHtml(players, all, ym, months) {
  const docs = all.filter((d) => d.month === ym && d.tplVer === I.TPL_VER);
  const subd = docs.filter((d) => d.status === 'submitted' || d.status === 'confirmed');
  const field = subd.filter((d) => d.pg && d.pg !== 'GK');
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  // 능력치별: 선수 답 평균 · 확정 평균 (필드 선수, 0~100)
  const rows = I.FIELD.map((a) => {
    const self = field.map((d) => I.draftScores(d)[a.id]).filter((v) => v != null);
    const conf = field.filter((d) => d.status === 'confirmed').map((d) => d.coach?.scores?.[a.id]).filter((v) => v != null);
    return { a, self: avg(self), conf: avg(conf), n: self.length, nc: conf.length };
  });
  // 답 분포 (이번 달 낸 모든 답)
  const dist = [0, 0, 0, 0, 0]; subd.forEach((d) => Object.values(d.answers || {}).forEach((v) => { if (v >= 1 && v <= 5) dist[v - 1]++; }));
  const dn = dist.reduce((a, b) => a + b, 0);
  // 코치가 고친 비율 (확정된 것 중 이유를 적고 바꾼 능력 수)
  const confd = all.filter((d) => d.status === 'confirmed' && d.tplVer === I.TPL_VER);
  const changed = confd.reduce((a, d) => a + Object.keys(d.coach?.reasons || {}).filter((k) => d.coach.reasons[k]).length, 0);
  const totalAb = confd.reduce((a, d) => a + Object.keys(d.coach?.scores || {}).length, 0);
  const sub4 = [...months].reverse().slice(-4).map((m) => { const ds = all.filter((d) => d.month === m); return { m, n: ds.filter((d) => d.status === 'submitted' || d.status === 'confirmed').length }; });
  const P = (v) => (v == null ? '-' : I.stat(Math.round(v * 10) / 10));
  return `<section class="card p3-card"><div class="row between wrap"><h3>자기평가 데이터 <small class="muted">${I.ymLabel(ym)} · 템플릿 ${I.TPL_VER} · 필드 선수 기준 (골키퍼는 문항이 달라 빼요)</small></h3><button class="btn ghost sm" data-csv>엑셀(CSV)로 받기</button></div>
    <div class="p3-dgrid">
      <div><h4>제출 현황 <small class="muted">선수 ${players.length}명</small></h4>
        <ul class="p3-bars">${sub4.map((x) => `<li><span>${I.ymLabel(x.m)}</span><div class="p3-meter"><i style="width:${players.length ? (x.n / players.length) * 100 : 0}%"></i></div><b class="p3-num">${x.n}</b><span class="p3-trend wait">${players.length ? Math.round((x.n / players.length) * 100) : 0}%</span></li>`).join('')}</ul></div>
      <div><h4>답 분포 <small class="muted">이번 달 답 ${dn}개 · 한쪽으로 몰리면 문항이 쉽거나 대충 답한 것일 수 있어요</small></h4>
        <div class="p3-dist">${dist.map((v, i) => `<div><i style="height:${dn ? (v / dn) * 100 : 0}%"></i><b>${dn ? Math.round((v / dn) * 100) : 0}%</b><small>${i + 1} ${I.SCALE[i][1]}</small></div>`).join('')}</div></div>
      <div><h4>코치가 고친 비율 <small class="muted">확정된 능력 점수 중 이유를 적고 바꾼 것</small></h4>
        <p class="p3-bigstat">${totalAb ? Math.round((changed / totalAb) * 100) : 0}<i>%</i></p><p class="muted small">${changed}개 / ${totalAb}개 · 너무 높으면 문항이 선수 수준에 안 맞는 신호예요</p></div>
    </div>
    <h4>능력치별 팀 평균 <small class="muted">0~100 · 선수 답 평균은 확정 전 선수 생각, 확정 평균은 코치가 정한 점수</small></h4>
    <table class="tbl p3-tbl"><tr><th>능력치</th><th>선수 답 평균</th><th>확정 평균</th><th>답한 선수</th></tr>${rows.map((r) => `<tr><td>${esc(r.a.l)}</td><td>${P(r.self)}</td><td><b>${P(r.conf)}</b></td><td>${r.n}명${r.nc !== r.n ? ` <small class="muted">(확정 ${r.nc})</small>` : ''}</td></tr>`).join('')}</table>
  </section>`;
}
function downloadCsv(players, all) {
  const name = Object.fromEntries(players.map((p) => [p.id, p]));
  const lines = [['선수', '번호', '포지션', '월', '상태', '템플릿', '구분', '능력', '문항', '선수 답', '능력 확정 점수', '바꾼 이유']];
  all.forEach((d) => {
    const p = name[d.uid] || {};
    I.monthItems(d.pg, d.month, d.mode).forEach((it) => {
      lines.push([p.name || d.name || '', p.number || '', d.pos || p.position || '', d.month, STATUS[d.status || 'none'][0], d.tplVer || '', { hex: '능력치', pos: '포지션', growth: '성장' }[it.area], it.l, it.text + (it.rev ? ' (거꾸로)' : ''), d.answers?.[it.id] ?? '', d.coach?.scores?.[it.ab] ?? '', d.coach?.reasons?.[it.ab] || '']);
    });
  });
  const csv = '﻿' + lines.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `IDP_자기평가_${state.team.name || ''}_${I.ymOf()}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`CSV로 내려받았어요 (${lines.length - 1}줄). 엑셀에서 바로 열려요.`);
}

// 세부 능력치 24개: 능력치(코치 확정) 아래 세부 4개(선수 자기평가 최근 답)
function subsHtml(hex, last, docs) {
  return `<section class="card p3-card"><h3>세부 능력치 <small class="muted">큰 숫자 = 코치 확정 능력치 · 막대 = 선수 자기평가 최근 답 (세부 질문은 두 달에 한 번씩 돌아와요)</small></h3>
    <div class="p3-subgrid">${hex.map((a) => { const s0 = last?.coach?.scores?.[a.id]; const subs = I.subScores(docs, a.id); return `<div class="p3-subbox" data-ab="${a.id}">
      <div class="p3-subh"><b>${esc(a.l)}</b><span class="p3-num">${s0 != null ? I.stat(s0) : '-'}</span></div>
      <ul>${subs.map((x) => `<li><span>${esc(x.l)}</span><div class="p3-meter"><i style="width:${x.v != null ? I.stat(x.v) : 0}%"></i></div><b>${x.v != null ? I.stat(x.v) : '-'}</b><small class="muted">${x.month ? I.ymLabel(x.month) : '아직'}</small></li>`).join('')}</ul></div>`; }).join('')}</div></section>`;
}

// 팀 오버롤: 필드 선수 OVR 평균 · 줄별 · 골키퍼 따로 · 지난달 대비 · 최근 4개월 · 팀 평균 육각형
function teamOvrHtml(info, all) {
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const fieldI = info.filter((x) => x.o != null && x.line && x.line !== 'GK');
  const team = avg(fieldI.map((x) => x.o));
  const lines = I.LINES.filter(([k]) => k !== 'GK').map(([k, l]) => ({ l, v: avg(fieldI.filter((x) => x.line === k).map((x) => x.o)), n: fieldI.filter((x) => x.line === k).length }));
  const gk = avg(info.filter((x) => x.o != null && x.line === 'GK').map((x) => x.o));
  // 월별 팀 OVR: 그 달 기준으로 선수마다 가장 최근 확정 기록의 OVR 평균 (확정이 덜 된 달에도 튀지 않게)
  const conf = all.filter((d) => d.status === 'confirmed' && d.tplVer === I.TPL_VER && d.pg && d.pg !== 'GK');
  const ms = [...new Set(conf.map((d) => d.month))].sort().slice(-4);
  const asOf = (m) => { const by = {}; conf.filter((d) => d.month <= m).forEach((d) => { if (!by[d.uid] || by[d.uid].month < d.month) by[d.uid] = d; }); return avg(Object.values(by).map(I.ovrOf).filter((v) => v != null)); };
  const byM = ms.map((m) => ({ m, v: asOf(m) }));
  const dlt = byM.length >= 2 && byM[byM.length - 1].v != null && byM[byM.length - 2].v != null ? byM[byM.length - 1].v - byM[byM.length - 2].v : null;
  // 팀 평균 육각형 (필드 선수 최근 확정)
  const hexAvg = {}; I.FIELD.forEach((a) => { const v = fieldI.map((x) => x.lc?.coach?.scores?.[a.id]).filter((y) => y != null); if (v.length) hexAvg[a.id] = v.reduce((x, y) => x + y, 0) / v.length; });
  const ranked = I.FIELD.filter((a) => hexAvg[a.id] != null).sort((a, b) => hexAvg[b.id] - hexAvg[a.id]);
  const W = 180; const H = 46;
  const pts = byM.filter((x) => x.v != null);
  const line = pts.length >= 2 ? `<svg class="p3-tspark" viewBox="0 0 ${W} ${H + 16}"><polyline points="${pts.map((x, i) => `${(i / (pts.length - 1)) * (W - 56) + 28},${H - 4 - (x.v / 100) * (H - 10)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2"/>${pts.map((x, i) => `<circle cx="${(i / (pts.length - 1)) * (W - 56) + 28}" cy="${H - 4 - (x.v / 100) * (H - 10)}" r="3" fill="currentColor"/><text x="${(i / (pts.length - 1)) * (W - 56) + 28}" y="${H + 12}" text-anchor="middle" class="p3-ax">${I.ymLabel(x.m)} ${x.v}</text>`).join('')}</svg>` : '<p class="muted small">확정된 달이 2개 이상이면 추세가 나와요.</p>';
  return `<section class="card p3-card p3-team-ovr"><h3>팀 오버롤 <small class="muted">필드 선수 최근 확정 OVR 평균 (참고용) · 골키퍼는 능력치가 달라 따로</small></h3>
    <div class="p3-tov">
      <div class="p3-tov-main"><b class="p3-ovr">${team ?? '-'}</b><small>팀 OVR · 필드 ${fieldI.length}명</small>${dlt != null ? `<span class="p3-trend ${dlt > 0 ? 'up' : dlt < 0 ? 'down' : 'flat'}">지난달 ${dlt > 0 ? '+' : ''}${dlt}</span>` : ''}</div>
      <div class="p3-tov-lines">${lines.map((x) => `<div><small>${x.l}</small><b>${x.v ?? '-'}</b><span class="muted">${x.n}명</span></div>`).join('')}<div><small>골키퍼</small><b>${gk ?? '-'}</b><span class="muted">따로</span></div></div>
      <div class="p3-tov-hex">${miniHex(I.FIELD, hexAvg)}<div class="small">${ranked[0] ? `강점 <b>${esc(ranked[0].l)}</b> ${I.stat(Math.round(hexAvg[ranked[0].id]))}` : ''}${ranked.length > 1 ? `<br>보완 <b>${esc(ranked[ranked.length - 1].l)}</b> ${I.stat(Math.round(hexAvg[ranked[ranked.length - 1].id]))}` : ''}</div></div>
      <div class="p3-tov-trend"><small class="muted">최근 4개월 팀 OVR</small>${line}</div>
    </div></section>`;
}
