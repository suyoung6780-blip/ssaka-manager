// 선수 성장 기록 받기 — 기간(1개월 · 6개월 · 1년 · 직접)을 골라 PDF(학부모님께 보여 드리는 요약 리포트) · 엑셀(날짜별 전체 기록)로
// 모으는 곳: 오늘 기록(일지 · 몸 상태) · 기록실(득점 · 도움) · 경기 일지(출전 시간 · 평점) · 성장 평가(확정 점수 · 피드백) · 목표 · 키 · 몸무게
// 코치: 아무 선수 · 선수: 내 기록만 (보안 규칙도 그렇게 읽힘)
import { db, collection, query, where, getDocs } from './fb.js';
import { esc, text, toast, fail, modal, todayStr } from './ui.js';
import { state, isCoach } from './store.js';
import { sleepOf } from './sleep.js';
import { loadLinks } from './proto/links.js';
import { seasonData } from './proto/seasonStats.js';
import { bodyOf } from './proto/digest.js';
import * as I from './proto/idp.js';
import { pct, pace } from './pages/goals.js';

const H2C = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const XLSX_JS = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
const loadScript = (src) => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
  const sc = document.createElement('script');
  sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error('파일 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));
  document.head.appendChild(sc);
});

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - (n - 1)); return ymd(d); };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f1 = (v) => (v == null ? '-' : (Math.round(v * 10) / 10).toFixed(1));
const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
const dot = (s) => `${s.slice(0, 4)}.${s.slice(5, 7)}.${s.slice(8, 10)}`;
const ymLong = (ym) => `${ym.slice(0, 4)}년 ${+ym.slice(5, 7)}월`;
const hm = (m) => (m == null ? '-' : `${Math.floor(m / 60)}시간${m % 60 ? ` ${Math.round(m % 60)}분` : ''}`);
const CONDITION = ['', '최악', '나쁨', '보통', '좋음', '최고'];
const PERIODS = [['1m', '최근 1개월', 30], ['6m', '최근 6개월', 182], ['1y', '최근 1년', 365]];
const isMatchLog = (l) => l.kind === 'match' || !!l.match;

// ───────── 기간 고르기 창 ─────────
export function reportModal(uid, name = '') {
  let pick = '1m';
  const m = modal(`<span class="eyebrow">PLAYER REPORT</span><h2>${esc(name || '선수')} 성장 기록 받기</h2>
    <p class="muted">일지 · 몸 상태 · 경기 · 성장 평가 · 목표 · 키 · 몸무게를 기간별로 모아 파일로 받아요.</p>
    <div class="chips wrap rp-per">${PERIODS.map(([k, l]) => `<button type="button" class="chip ${k === pick ? 'on' : ''}" data-per="${k}">${l}</button>`).join('')}<button type="button" class="chip" data-per="custom">직접 고르기</button></div>
    <div class="grid2 rp-dates" data-dates hidden>
      <label>시작일<input type="date" name="from" value="${ago(30)}" max="${todayStr()}"></label>
      <label>종료일<input type="date" name="to" value="${todayStr()}" max="${todayStr()}"></label></div>
    <div class="rp-btns">
      <button type="button" class="btn" data-out="pdf"><b>PDF 받기</b><small>학부모님께 보여 드리기 좋은 요약 리포트</small></button>
      <button type="button" class="btn ghost" data-out="xlsx"><b>엑셀 받기</b><small>날짜별 전체 기록 · 정리 · 보관용</small></button>
    </div>
    <p class="muted small" data-rpmsg></p>`);
  const $ = (q) => m.el.querySelector(q);
  m.el.querySelectorAll('[data-per]').forEach((b) => (b.onclick = () => {
    pick = b.dataset.per;
    m.el.querySelectorAll('[data-per]').forEach((x) => x.classList.toggle('on', x === b));
    $('[data-dates]').hidden = pick !== 'custom';
  }));
  const range = () => {
    if (pick !== 'custom') { const n = PERIODS.find(([k]) => k === pick)[2]; return [ago(n), todayStr()]; }
    let a = $('[name=from]').value; let b = $('[name=to]').value;
    if (!a || !b) return null;
    if (a > b) [a, b] = [b, a];
    return [a, b];
  };
  m.el.querySelectorAll('[data-out]').forEach((b) => (b.onclick = async () => {
    const r = range();
    if (!r) { toast('시작일과 종료일을 골라 주세요.'); return; }
    const btns = [...m.el.querySelectorAll('[data-out]')];
    btns.forEach((x) => { x.disabled = true; });
    $('[data-rpmsg]').textContent = '기록을 모으는 중…';
    try {
      const R = await gather(uid, r[0], r[1]);
      $('[data-rpmsg]').textContent = b.dataset.out === 'pdf' ? 'PDF 만드는 중… (몇 초 걸려요)' : '엑셀 만드는 중…';
      if (b.dataset.out === 'pdf') await makePdf(R); else await makeXlsx(R);
      m.close();
    } catch (err) { fail(err); $('[data-rpmsg]').textContent = ''; btns.forEach((x) => { x.disabled = false; }); }
  }));
}

// ───────── 기록 모으기 ─────────
async function gather(uid, from, to) {
  const tid = state.team.id;
  const [ms, ids, gs] = await Promise.all([
    getDocs(collection(db, 'teams', tid, 'members')),
    getDocs(query(collection(db, 'teams', tid, 'idp'), where('uid', '==', uid))).catch(() => null),
    getDocs(query(collection(db, 'teams', tid, 'goals'), where('ownerUid', '==', uid))).catch(() => null),
  ]);
  const roster = ms.docs.map((d) => ({ id: d.id, ...d.data() }));
  const me = roster.find((x) => x.id === uid) || { id: uid, name: '' };
  const links = await loadLinks(uid, roster.filter((x) => x.role === 'player'));
  const idpAll = ids ? ids.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.month < b.month ? -1 : 1)) : [];
  const inR = (d) => d >= from && d <= to;
  const fm = from.slice(0, 7); const tm = to.slice(0, 7);
  const logs = links.logs.filter((l) => inR(l.date || ''));
  const games = seasonData(links, idpAll).matches.filter((x) => inR(x.date));
  const idp = idpAll.filter((d) => d.status === 'confirmed' && d.month >= fm && d.month <= tm);
  const body = bodyOf(idpAll, links.logs, me).months.filter((x) => x.ym >= fm && x.ym <= tm);
  const msOf = (v) => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : 0);
  // 목표: 기간 안에 진행했거나 기한이 걸친 개인 목표
  const goals = (gs ? gs.docs.map((d) => ({ id: d.id, ...d.data() })) : [])
    .filter((g) => g.scope === 'personal')
    .map((g) => ({ ...g, title: g.title || g.text || '', status: g.status || (g.done ? 'done' : 'doing') }))
    .filter((g) => { const c = msOf(g.createdAt); return (!c || ymd(new Date(c)) <= to) && (!g.due || g.due >= from || g.status === 'doing'); });
  return { me, from, to, logs, games, idp, body, goals, made: todayStr() };
}

// 숫자 요약 (PDF · 엑셀 같이 씀)
function totals(R) {
  const L = R.logs;
  const nums = (f) => L.map(f).map(num).filter((v) => v != null);
  const G = R.games;
  const mins = G.filter((x) => x.minutes != null);
  const rates = G.filter((x) => x.rating != null);
  const ovr = R.idp.map((d) => ({ m: d.month, v: I.ovrOf(d) })).filter((x) => x.v != null);
  const hs = R.body.filter((x) => x.h); const ws = R.body.filter((x) => x.w);
  return {
    days: L.length, trainN: L.filter((l) => !isMatchLog(l)).length, matchN: L.filter(isMatchLog).length,
    trainMin: nums((l) => (l.absent ? null : l.trainMin)).reduce((a, b) => a + b, 0), hasMin: nums((l) => l.trainMin).length > 0,
    cond: avg(nums((l) => l.condition)), rpe: avg(nums((l) => l.rpe)), sleep: avg(L.map(sleepOf).filter((v) => v != null)),
    hurt: L.filter((l) => l.hurt || +l.injury > 0).length, absent: L.filter((l) => l.absent).length,
    comments: L.filter((l) => l.coachComment).length,
    apps: G.length, min: mins.reduce((a, x) => a + x.minutes, 0), hasGameMin: mins.length > 0,
    g: G.reduce((a, x) => a + x.g, 0), a: G.reduce((a, x) => a + x.a, 0), rating: avg(rates.map((x) => x.rating)),
    ovr0: ovr[0], ovr1: ovr[ovr.length - 1],
    h0: hs[0]?.h, h1: hs[hs.length - 1]?.h, w0: ws[0]?.w, w1: ws[ws.length - 1]?.w,
    goalN: R.goals.length, goalDone: R.goals.filter((g) => g.status === 'done').length, goalPct: avg(R.goals.filter((g) => g.status !== 'miss').map(pct)),
  };
}

// 기간 길이에 따라 날 · 주 · 달로 묶기
function buckets(from, to) {
  const span = Math.round((new Date(`${to}T00:00`) - new Date(`${from}T00:00`)) / 864e5) + 1;
  const out = [];
  if (span <= 45) {
    for (let d = new Date(`${from}T00:00`); ymd(d) <= to; d.setDate(d.getDate() + 1)) { const k = ymd(d); out.push({ a: k, b: k, l: `${+k.slice(5, 7)}/${+k.slice(8)}` }); }
    return { unit: '날', out };
  }
  if (span <= 200) {
    for (let d = new Date(`${from}T00:00`); ymd(d) <= to; d.setDate(d.getDate() + 7)) {
      const e = new Date(d); e.setDate(e.getDate() + 6);
      const a = ymd(d); const b = ymd(e) > to ? to : ymd(e);
      out.push({ a, b, l: `${+a.slice(5, 7)}/${+a.slice(8)}` });
    }
    return { unit: '주', out };
  }
  for (let d = new Date(+from.slice(0, 4), +from.slice(5, 7) - 1, 1); ymd(d) <= to; d.setMonth(d.getMonth() + 1)) {
    const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    out.push({ a: ymd(d) < from ? from : ymd(d), b: ymd(e) > to ? to : ymd(e), l: `${d.getMonth() + 1}월` });
  }
  return { unit: '달', out };
}

// ───────── PDF ─────────
const ACC = '#17a34a';
// 막대(일지 수) + 선(컨디션) 그래프
function condChart(R) {
  const { unit, out } = buckets(R.from, R.to);
  const pts = out.map((b) => {
    const ls = R.logs.filter((l) => l.date >= b.a && l.date <= b.b);
    return { l: b.l, n: ls.length, c: avg(ls.map((l) => num(l.condition)).filter((v) => v != null)) };
  });
  if (!pts.some((p) => p.n)) return '';
  const W = 680; const H = 196; const L0 = 34; const R0 = 10; const T = 20; const B = 26;
  const cw = (W - L0 - R0) / pts.length;
  const maxN = Math.max(1, ...pts.map((p) => p.n));
  const y5 = (v) => T + (H - T - B) * (1 - (v - 1) / 4);
  const yN = (v) => H - B - (H - T - B) * (v / maxN);
  const every = Math.ceil(pts.length / 12);
  const bars = pts.map((p, i) => (p.n ? `<rect x="${(L0 + i * cw + cw * 0.18).toFixed(1)}" y="${yN(p.n).toFixed(1)}" width="${(cw * 0.64).toFixed(1)}" height="${(H - B - yN(p.n)).toFixed(1)}" rx="2" fill="#d9e9dd"/>` : '')).join('');
  const line = pts.map((p, i) => (p.c == null ? null : [L0 + i * cw + cw / 2, y5(p.c)])).filter(Boolean);
  const path = line.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const labs = pts.map((p, i) => (i % every ? '' : `<text x="${(L0 + i * cw + cw / 2).toFixed(1)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#888">${p.l}</text>`)).join('');
  const grid = [1, 2, 3, 4, 5].map((v) => `<line x1="${L0}" x2="${W - R0}" y1="${y5(v).toFixed(1)}" y2="${y5(v).toFixed(1)}" stroke="#eee"/><text x="${L0 - 8}" y="${(y5(v) + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="#999">${v}</text>`).join('');
  return `<section class="rp-blk"><h3>컨디션 흐름 <small>${unit}별 평균 컨디션(선 · 1~5) · 일지 쓴 날 수(막대)</small></h3>
    <svg viewBox="0 0 ${W} ${H}" width="100%">${grid}${bars}<text x="${W - 2}" y="${T - 4}" font-size="10" text-anchor="end" fill="#9bb9a3">막대 맨 위 = 일지 ${maxN}일</text>
      <path d="${path}" fill="none" stroke="${ACC}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>${line.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${line.length > 40 ? 1.6 : 2.8}" fill="${ACC}"/>`).join('')}${labs}</svg></section>`;
}

// 성장 평가: 달마다 능력치(0~100) 표 + OVR
function idpBlocks(R) {
  if (!R.idp.length) return [];
  const docs = R.idp.slice(-6); // 표는 최근 6번까지 (엑셀엔 전부)
  const abs = [];
  docs.forEach((d) => I.hexOf(d.pg).forEach((a) => { if (!abs.some((x) => x.id === a.id)) abs.push(a); }));
  I.GROWTH.forEach((g) => { if (docs.some((d) => d.coach?.scores?.[g.id] != null)) abs.push(g); });
  const cell = (d, id) => { const s = d.coach?.scores?.[id]; return s == null ? '-' : I.stat(s); };
  const first = docs[0]; const last = docs[docs.length - 1];
  const diff = (id) => { const a = first.coach?.scores?.[id]; const b = last.coach?.scores?.[id]; if (a == null || b == null || docs.length < 2) return ''; const v = I.stat(b) - I.stat(a); return v ? `<b class="${v > 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${v}</b>` : '<span class="muted">0</span>'; };
  const rows = abs.map((a) => `<tr><td>${esc(a.l)}</td>${docs.map((d) => `<td>${cell(d, a.id)}</td>`).join('')}<td>${diff(a.id)}</td></tr>`).join('');
  const ovrRow = `<tr class="rp-ovr"><td>OVR</td>${docs.map((d) => `<td>${I.ovrOf(d) ?? '-'}</td>`).join('')}<td>${docs.length > 1 && I.ovrOf(first) != null && I.ovrOf(last) != null ? (() => { const v = I.ovrOf(last) - I.ovrOf(first); return v ? `<b class="${v > 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${v}</b>` : '0'; })() : ''}</td></tr>`;
  const fb = R.idp.filter((d) => d.coach?.feedback).slice(-4).reverse();
  return [`<section class="rp-blk"><h3>성장 평가 <small>코치님이 확정한 능력치 (0~100) · 확정 ${R.idp.length}번</small></h3>
    <table class="rp-tbl"><tr><th>능력</th>${docs.map((d) => `<th>${ymLong(d.month).slice(2)}</th>`).join('')}<th>변화</th></tr>${ovrRow}${rows}</table>
    <p class="rp-note">선수 자기평가를 코치님이 검토해 확정한 점수예요. 한 단계 = 25점.</p></section>`,
  ...(fb.length ? [`<section class="rp-blk"><h3>성장 평가 피드백</h3>${fb.map((d) => `<div class="rp-quote"><small>${ymLong(d.month)} · ${esc(d.confirmedByName || '코치')}</small><p>${text(d.coach.feedback)}</p></div>`).join('')}</section>`] : [])];
}

function pdfBlocks(R) {
  const t = totals(R);
  const me = R.me;
  const K = (v, l, sub = '') => `<div class="rp-k"><small>${l}</small><strong>${v}</strong>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const chg = (a, b, u) => (a != null && b != null && a !== b ? `${b - a > 0 ? '+' : ''}${(Math.round((b - a) * 10) / 10)}${u} (기간 중)` : '');
  const blocks = [];
  blocks.push(`<header class="rp-head"><span class="rp-brand">SSAKA MANAGER</span><span>${esc(state.team?.name || '')} · ${dot(R.made)} 만듦</span></header>
    <section class="rp-blk rp-title">
      <small class="rp-eye">PLAYER GROWTH REPORT</small>
      <h1>${esc(me.name || '')} 선수 성장 리포트</h1>
      <p class="rp-sub">${dot(R.from)} ~ ${dot(R.to)}</p>
      <div class="rp-prof">${[['팀', state.team?.name], ['등번호', me.number], ['포지션', me.position], ['소속 · 학년', me.affiliation || me.grade], ['주발', { R: '오른발', L: '왼발', B: '양발' }[me.foot]]]
        .filter(([, v]) => v).map(([k, v]) => `<div><small>${k}</small><b>${esc(String(v))}</b></div>`).join('')}</div>
    </section>`);
  blocks.push(`<section class="rp-blk"><h3>한눈에 보기</h3><div class="rp-kpis">
    ${K(`${t.days}<i>일</i>`, '일지 쓴 날', `훈련 ${t.trainN} · 경기 ${t.matchN}`)}
    ${K(t.hasMin ? `${Math.round(t.trainMin / 60)}<i>시간</i>` : '-', '훈련 · 경기 시간', t.hasMin ? `${t.trainMin}분` : '')}
    ${K(`${f1(t.cond)}<i>/5</i>`, '평균 컨디션', t.cond ? CONDITION[Math.round(t.cond)] : '')}
    ${K(t.sleep == null ? '-' : `${(t.sleep / 60).toFixed(1)}<i>시간</i>`, '평균 수면')}
    ${K(`${t.apps}<i>경기</i>`, '출전', t.hasGameMin ? `${t.min}분` : '')}
    ${K(`${t.g} · ${t.a}`, '득점 · 도움', t.rating != null ? `평균 평점 ${f1(t.rating)}` : '')}
    ${K(t.ovr1 ? t.ovr1.v : '-', '성장 평가 OVR', t.ovr0 && t.ovr1 && t.ovr0 !== t.ovr1 ? `${ymLong(t.ovr0.m).slice(2)} ${t.ovr0.v} → ${ymLong(t.ovr1.m).slice(2)} ${t.ovr1.v}` : t.ovr1 ? `${ymLong(t.ovr1.m)} 확정` : '확정 기록 없음')}
    ${K(t.goalN ? `${t.goalDone}<i>/${t.goalN}</i>` : '-', '목표 달성', t.goalN ? `평균 진행률 ${Math.round(t.goalPct || 0)}%` : '')}
    ${K(t.h1 ? `${t.h1}<i>cm</i>` : +me.height ? `${+me.height}<i>cm</i>` : '-', '키', t.h1 ? chg(t.h0, t.h1, 'cm') : +me.height ? '프로필 기준' : '')}
    ${K(t.w1 ? `${t.w1}<i>kg</i>` : +me.weight ? `${+me.weight}<i>kg</i>` : '-', '몸무게', t.w1 ? chg(t.w0, t.w1, 'kg') : +me.weight ? '프로필 기준' : '')}
  </div>${t.hurt || t.absent ? `<p class="rp-note">아팠던 날 ${t.hurt}일${t.absent ? ` · 불참 ${t.absent}일` : ''}</p>` : ''}</section>`);
  const cc = condChart(R); if (cc) blocks.push(cc);
  // 달별 요약
  const months = [...new Set([...R.logs.map((l) => l.date.slice(0, 7)), ...R.games.map((x) => x.date.slice(0, 7)), ...R.idp.map((d) => d.month)])].sort();
  if (months.length > 1) {
    blocks.push(`<section class="rp-blk"><h3>달별 요약</h3><table class="rp-tbl"><tr><th>달</th><th>일지</th><th>훈련 · 경기 시간</th><th>컨디션</th><th>수면</th><th>출전</th><th>득점</th><th>도움</th><th>OVR</th></tr>
      ${months.map((mo) => {
        const ls = R.logs.filter((l) => l.date.startsWith(mo)); const gs = R.games.filter((x) => x.date.startsWith(mo));
        const tm = ls.map((l) => num(l.trainMin)).filter((v) => v != null);
        const d = R.idp.find((x) => x.month === mo);
        return `<tr><td>${ymLong(mo).slice(2)}</td><td>${ls.length || '-'}</td><td>${tm.length ? `${tm.reduce((a, b) => a + b, 0)}분` : '-'}</td><td>${f1(avg(ls.map((l) => num(l.condition)).filter((v) => v != null)))}</td>
          <td>${hm(avg(ls.map(sleepOf).filter((v) => v != null)))}</td><td>${gs.length || '-'}</td><td>${gs.reduce((a, x) => a + x.g, 0) || '-'}</td><td>${gs.reduce((a, x) => a + x.a, 0) || '-'}</td><td>${d ? I.ovrOf(d) ?? '-' : '-'}</td></tr>`;
      }).join('')}</table></section>`);
  }
  // 경기 기록 (15줄씩 나눠 쪽이 넘어가도 표가 잘리지 않게)
  if (R.games.length) {
    for (let i = 0; i < R.games.length; i += 15) {
      const part = R.games.slice(i, i + 15);
      blocks.push(`<section class="rp-blk">${i ? '' : `<h3>경기 기록 <small>출전 ${t.apps}경기${t.hasGameMin ? ` · ${t.min}분` : ''} · ${t.g}골 ${t.a}도움</small></h3>`}
        <table class="rp-tbl"><tr><th>날짜</th><th>대회</th><th>상대</th><th>출전</th><th>득점</th><th>도움</th><th>평점</th></tr>
        ${part.map((x) => `<tr><td>${dot(x.date).slice(2)}</td><td>${esc(x.type || '-')}</td><td>${esc(x.opp || '-')}</td><td>${x.minutes != null ? `${x.minutes}분` : '-'}</td><td>${x.g || '-'}</td><td>${x.a || '-'}</td><td>${x.rating != null ? f1(x.rating) : '-'}</td></tr>`).join('')}</table></section>`);
    }
  }
  blocks.push(...idpBlocks(R));
  // 키 · 몸무게
  if (R.body.length) {
    blocks.push(`<section class="rp-blk"><h3>키 · 몸무게</h3><table class="rp-tbl"><tr><th>달</th>${R.body.map((x) => `<th>${ymLong(x.ym).slice(2)}</th>`).join('')}</tr>
      <tr><td>키</td>${R.body.map((x) => `<td>${x.h ? `${x.h}cm` : '-'}</td>`).join('')}</tr><tr><td>몸무게</td>${R.body.map((x) => `<td>${x.w ? `${x.w}kg` : '-'}</td>`).join('')}</tr></table></section>`);
  }
  // 목표
  if (R.goals.length) {
    blocks.push(`<section class="rp-blk"><h3>목표</h3>${R.goals.map((g) => { const p = pct(g); const pc = pace(g); return `<div class="rp-goal"><div><b>${esc(g.title)}</b><small>${esc([g.category, g.due ? `기한 ${dot(g.due)}` : ''].filter(Boolean).join(' · '))}</small>${g.coachComment ? `<p>코치 한마디 · ${esc(g.coachComment)}</p>` : ''}</div>
      <div class="rp-gp"><span class="rp-bar"><i style="width:${p}%"></i></span><b>${p}%</b><em>${pc.l}</em></div></div>`; }).join('')}</section>`);
  }
  // 코치 한마디 (최근 10개 · 엑셀엔 전부)
  const cm = R.logs.filter((l) => l.coachComment).slice(-10).reverse();
  if (cm.length) blocks.push(`<section class="rp-blk"><h3>코치 한마디 <small>일지에 남긴 말 · 최근 ${cm.length}개${t.comments > cm.length ? ` (전체 ${t.comments}개는 엑셀에)` : ''}</small></h3>${cm.map((l) => `<div class="rp-quote"><small>${dot(l.date)}${isMatchLog(l) ? ' · 경기' : ''}</small><p>${text(l.coachComment)}</p></div>`).join('')}</section>`);
  if (!R.logs.length && !R.games.length && !R.idp.length && !R.goals.length) blocks.push('<section class="rp-blk"><p class="rp-note">이 기간에는 모인 기록이 없어요.</p></section>');
  blocks.push(`<footer class="rp-foot">싸카매니저 · 선수가 쓴 일지와 코치님 기록으로 만든 리포트예요 · ssakamanager.co.kr</footer>`);
  return blocks;
}

async function makePdf(R) {
  const wrap = document.createElement('div');
  wrap.className = 'pdf-wrap';
  wrap.innerHTML = `<article class="pdf-page rp-page">${pdfBlocks(R).join('')}</article>`;
  document.body.appendChild(wrap);
  try {
    await Promise.all([loadScript(H2C), loadScript(JSPDF)]);
    await document.fonts?.ready;
    const page = wrap.firstElementChild;
    const scale = page.offsetHeight * 2 > 30000 ? 1.4 : 2; // 아주 긴 리포트는 그림 크기 제한 안으로
    const cv = await window.html2canvas(page, { scale, backgroundColor: '#ffffff', logging: false });
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const PW = 210; const PH = 297; const M = 10;
    const pxPerMm = cv.width / (PW - M * 2);
    const pageH = Math.floor((PH - M * 2 - 6) * pxPerMm);
    const k = cv.width / page.offsetWidth;
    // 덩어리(제목 · 칸 · 표) 사이에서만 쪽을 나눔
    const ends = [...page.children].map((c) => Math.round((c.offsetTop + c.offsetHeight + 8) * k));
    const cuts = [];
    for (let y = 0; y < cv.height - 2;) {
      const fit = ends.filter((e) => e > y + 40 && e <= y + pageH);
      const cut = y + pageH >= cv.height ? cv.height : (fit.length ? Math.max(...fit) : y + pageH);
      cuts.push([y, cut]); y = cut;
    }
    cuts.forEach(([y, cut], i) => {
      if (i) pdf.addPage();
      const h = cut - y;
      const part = document.createElement('canvas');
      part.width = cv.width; part.height = h;
      const pc = part.getContext('2d');
      pc.fillStyle = '#fff'; pc.fillRect(0, 0, part.width, h);
      pc.drawImage(cv, 0, y, cv.width, h, 0, 0, cv.width, h);
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', M, M, PW - M * 2, h / pxPerMm);
      pdf.setFontSize(8); pdf.setTextColor(150);
      pdf.text(`${i + 1} / ${cuts.length}`, PW / 2, PH - 5, { align: 'center' });
    });
    pdf.save(`${fileBase(R)}.pdf`);
    toast('성장 리포트 PDF를 저장했어요.');
  } finally { wrap.remove(); }
}

const fileBase = (R) => `${String(R.me.name || '선수').replace(/[\\/:*?"<>|]/g, '')}_성장기록_${R.from.replace(/-/g, '.')}~${R.to.replace(/-/g, '.')}`;

// ───────── 엑셀 ─────────
async function makeXlsx(R) {
  await loadScript(XLSX_JS);
  const X = window.XLSX;
  const wb = X.utils.book_new();
  const line = { style: 'thin', color: { rgb: 'DDDDDD' } };
  const sheet = (name, head, rows, widths) => {
    const ws = X.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = widths.map((w) => ({ wch: w }));
    ws['!rows'] = [{ hpt: 22 }];
    for (let c = 0; c < head.length; c++) {
      const hc = ws[X.utils.encode_cell({ r: 0, c })];
      if (hc) hc.s = { fill: { fgColor: { rgb: '1F2A24' } }, font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 }, alignment: { vertical: 'center' }, border: { bottom: line } };
      for (let r = 1; r <= rows.length; r++) {
        const cell = ws[X.utils.encode_cell({ r, c })];
        if (cell) cell.s = { font: { sz: 10 }, border: { bottom: line }, alignment: { vertical: 'top', wrapText: typeof cell.v === 'string' && cell.v.length > 20, horizontal: typeof cell.v === 'number' ? 'right' : 'left' } };
      }
    }
    X.utils.book_append_sheet(wb, ws, name);
  };
  const t = totals(R);
  const me = R.me;
  const v = (x) => (x == null || Number.isNaN(x) ? '' : x);
  const r1 = (x) => (x == null ? '' : Math.round(x * 10) / 10);
  // 1) 요약
  sheet('요약', ['항목', '내용'], [
    ['선수', me.name || ''], ['팀', state.team?.name || ''], ['등번호', me.number || ''], ['포지션', me.position || ''], ['소속 · 학년', me.affiliation || me.grade || ''],
    ['기간', `${R.from} ~ ${R.to}`], ['만든 날', R.made], ['', ''],
    ['일지 쓴 날', t.days], ['훈련 일지', t.trainN], ['경기 일지', t.matchN], ['훈련 · 경기 시간(분)', t.hasMin ? t.trainMin : ''],
    ['평균 컨디션(1~5)', r1(t.cond)], ['평균 자각도(RPE 1~10)', r1(t.rpe)], ['평균 수면(분)', t.sleep == null ? '' : Math.round(t.sleep)], ['아팠던 날', t.hurt], ['불참', t.absent],
    ['출전 경기', t.apps], ['출전 시간(분)', t.hasGameMin ? t.min : ''], ['득점', t.g], ['도움', t.a], ['평균 평점', r1(t.rating)],
    ['성장 평가 OVR (처음)', t.ovr0 ? `${t.ovr0.v} (${t.ovr0.m})` : ''], ['성장 평가 OVR (마지막)', t.ovr1 ? `${t.ovr1.v} (${t.ovr1.m})` : ''],
    ['키(cm)', t.h1 ? `${t.h0 && t.h0 !== t.h1 ? `${t.h0} → ` : ''}${t.h1}` : ''], ['몸무게(kg)', t.w1 ? `${t.w0 && t.w0 !== t.w1 ? `${t.w0} → ` : ''}${t.w1}` : ''],
    ['목표', t.goalN ? `${t.goalDone}개 달성 / ${t.goalN}개` : ''],
  ], [24, 40]);
  // 2) 달별
  const months = [...new Set([...R.logs.map((l) => l.date.slice(0, 7)), ...R.games.map((x) => x.date.slice(0, 7)), ...R.idp.map((d) => d.month), ...R.body.map((x) => x.ym)])].sort();
  sheet('달별', ['달', '일지', '훈련 일지', '경기 일지', '훈련 · 경기 시간(분)', '평균 컨디션', '평균 자각도', '평균 수면(분)', '출전', '출전 시간(분)', '득점', '도움', 'OVR', '키(cm)', '몸무게(kg)'], months.map((mo) => {
    const ls = R.logs.filter((l) => l.date.startsWith(mo)); const gs = R.games.filter((x) => x.date.startsWith(mo));
    const n = (f) => ls.map(f).map(num).filter((x) => x != null);
    const d = R.idp.find((x) => x.month === mo); const b = R.body.find((x) => x.ym === mo);
    const gm = gs.filter((x) => x.minutes != null);
    return [mo, ls.length, ls.filter((l) => !isMatchLog(l)).length, ls.filter(isMatchLog).length, n((l) => l.trainMin).reduce((a, c) => a + c, 0) || '', r1(avg(n((l) => l.condition))), r1(avg(n((l) => l.rpe))),
      v(avg(ls.map(sleepOf).filter((x) => x != null)) == null ? null : Math.round(avg(ls.map(sleepOf).filter((x) => x != null)))), gs.length, gm.length ? gm.reduce((a, x) => a + x.minutes, 0) : '',
      gs.reduce((a, x) => a + x.g, 0), gs.reduce((a, x) => a + x.a, 0), d ? v(I.ovrOf(d)) : '', b?.h || '', b?.w || ''];
  }), [9, 6, 9, 9, 17, 11, 11, 13, 6, 13, 6, 6, 6, 8, 10]);
  // 3) 일지 (날짜별 전부)
  const sessText = (l) => Object.values(l.sessions || {}).map((s) => [s.name, s.did && `한 것: ${s.did}`, s.good && `잘된 점: ${s.good}`, s.hard && `어려웠던 점: ${s.hard}`, s.next && `다음엔: ${s.next}`].filter(Boolean).join(' / ')).filter(Boolean).join('\n');
  sheet('일지', ['날짜', '종류', '컨디션(1~5)', '자각도(RPE)', '훈련 · 경기 시간(분)', '수면(분)', '수면 질(1~5)', '통증(0~10)', '부상', '불참', '키(cm)', '몸무게(kg)', '오늘 한 훈련', '잘한 점', '보완할 점', '배운 점', '내일 목표', '경기 상대', '출전(분)', '평점', '경기 잘한 점', '경기 아쉬운 점', '경기 느낀 점', '코치 한마디'],
    R.logs.map((l) => {
      const mj = l.match || {};
      return [l.date, isMatchLog(l) ? '경기' : '훈련', v(num(l.condition)), v(num(l.rpe)), v(num(l.trainMin)), v(sleepOf(l)), v(num(l.sleepQ)), v(num(l.injury)),
        l.hurt ? `${l.hurt === 'match' ? '경기' : '훈련'} 중${l.hurtWhen ? ` · ${l.hurtWhen}` : ''}` : '', l.absent ? (l.absentReason || '불참') : '', v(num(l.height)), v(num(l.weight)),
        sessText(l) || l.training || '', l.good || '', l.improve || '', l.learned || mj.learned || '', l.tomorrow || mj.next || '',
        mj.opponent || '', mj.played === false ? 0 : v(num(mj.minutes)), v(num(mj.rating)), mj.good || '', mj.bad || '', mj.felt || '', l.coachComment || ''];
    }), [11, 6, 10, 10, 14, 8, 10, 9, 14, 12, 7, 9, 40, 28, 28, 28, 24, 14, 8, 6, 28, 28, 28, 34]);
  // 4) 경기
  sheet('경기', ['날짜', '대회', '상대', '출전 시간(분)', '득점', '도움', '평점'], R.games.map((x) => [x.date, x.type || '', x.opp || '', v(x.minutes), x.g, x.a, v(x.rating)]), [11, 12, 18, 13, 6, 6, 6]);
  // 5) 성장 평가 (확정된 달 전부 · 능력치 0~100)
  const abs = [];
  R.idp.forEach((d) => [...I.hexOf(d.pg), ...I.GROWTH].forEach((a) => { if (d.coach?.scores?.[a.id] != null && !abs.some((x) => x.id === a.id)) abs.push(a); }));
  sheet('성장 평가', ['달', '포지션 묶음', 'OVR', ...abs.map((a) => a.l), '코치 피드백', '확정한 코치'],
    R.idp.map((d) => [d.month, I.POS[d.pg]?.l || d.pg || '', v(I.ovrOf(d)), ...abs.map((a) => (d.coach?.scores?.[a.id] == null ? '' : I.stat(d.coach.scores[a.id]))), d.coach?.feedback || '', d.confirmedByName || '']),
    [9, 12, 6, ...abs.map(() => 10), 40, 10]);
  // 6) 키 · 몸무게
  sheet('키 · 몸무게', ['달', '키(cm)', '몸무게(kg)'], R.body.length ? R.body.map((x) => [x.ym, x.h || '', x.w || '']) : me.height || me.weight ? [['프로필', +me.height || '', +me.weight || '']] : [], [9, 9, 11]);
  // 7) 목표
  sheet('목표', ['목표', '분야', '기한', '진행률(%)', '상태', '왜', '어떻게', '코치 한마디'],
    R.goals.map((g) => [g.title, g.category || '', g.due || '', pct(g), pace(g).l, g.why || '', g.how || '', g.coachComment || '']), [30, 12, 11, 10, 10, 26, 26, 30]);
  X.writeFile(wb, `${fileBase(R)}.xlsx`);
  toast('성장 기록 엑셀을 저장했어요.');
}

// 누가 받을 수 있는지 (코치는 아무 선수 · 선수는 자기 것만)
export const canReport = (uid) => isCoach() || uid === state.user?.uid;
