// 시제품 3.0: 선수 '시즌 기록' — 시즌(연도) · 대회(경기 형태) · 월별로 득점 · 도움 · 출전 · 평점 · 일지 · 컨디션 · OVR
// 모으는 곳: 경기 기록실(득점 · 도움 · 경기 형태) + 오늘 기록의 경기 일지(출전 시간 · 평점) + 훈련일지(컨디션) + 성장 평가(월별 확정 OVR)
// 숫자는 '참고'로 보여 주기만 하고, 성장 평가 점수를 자동으로 바꾸지 않음
import { esc } from '../ui.js';
import * as I from './idp.js';

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f1 = (v) => (v == null ? '-' : (Math.round(v * 10) / 10).toFixed(1));
const yOf = (d) => String(d || '').slice(0, 4);
const mOf = (d) => +String(d || '').slice(5, 7);

// 한 선수의 기록을 경기 · 일지 · OVR 줄로 펼침
export function seasonData(links, idpList) {
  const games = links.games || [];
  const gameOn = (date) => games.find((m) => m.date === date);
  const apps = new Map(); // 날짜 → 경기 한 줄
  const row = (date) => {
    if (!apps.has(date)) { const g = gameOn(date); apps.set(date, { date, type: g?.matchType || '', minutes: null, rating: null, g: 0, a: 0, opp: g?.opponent || '' }); }
    return apps.get(date);
  };
  (links.logs || []).forEach((l) => {
    const mj = l.match || {};
    const isMatch = l.kind === 'match' || mj.minutes != null && mj.minutes !== '' || mj.rating != null || (mj.scenes || []).length || mj.good || mj.bad;
    if (!isMatch) return;
    const r = row(l.date);
    if (!r.type && mj.type) r.type = mj.type;
    if (!r.opp && mj.opponent) r.opp = mj.opponent;
    if (mj.minutes != null && mj.minutes !== '') r.minutes = +mj.minutes;
    if (mj.rating != null && mj.rating !== '') r.rating = +mj.rating;
  });
  (links.mres || []).forEach(({ m, g, a }) => { const r = row(m.date); r.g += g; r.a += a; if (!r.type) r.type = m.matchType || ''; });
  const matches = [...apps.values()].map((r) => ({ ...r, type: r.type || '기타' })).sort((x, y) => (x.date < y.date ? -1 : 1));
  const train = (links.logs || []).map((l) => ({ date: l.date, cond: +l.condition || null })); // 훈련 · 경기 일지 모두
  const ovr = (idpList || []).filter((d) => d.status === 'confirmed').map((d) => ({ month: d.month, v: I.ovrOf(d) })).filter((x) => x.v != null).sort((x, y) => (x.month < y.month ? -1 : 1));
  const years = [...new Set([...matches.map((r) => yOf(r.date)), ...train.map((t) => yOf(t.date)), ...ovr.map((o) => yOf(o.month))].filter(Boolean))].sort().reverse();
  const types = [...new Set(matches.map((r) => r.type))];
  return { matches, train, ovr, years, types };
}

function sum(rows) {
  const ms = rows.filter((r) => r.minutes != null);
  const rs = rows.filter((r) => r.rating != null);
  const G = rows.reduce((a, r) => a + r.g, 0); const A = rows.reduce((a, r) => a + r.a, 0);
  return { n: rows.length, min: ms.reduce((a, r) => a + r.minutes, 0), hasMin: ms.length > 0, G, A, P: G + A, rating: avg(rs.map((r) => r.rating)) };
}

export function seasonHtml(d, year, comp) {
  if (!d.years.length) return '<section class="card p3-card"><p class="muted">아직 모인 기록이 없어요. 경기 기록실에 득점 · 도움이 들어가거나, 오늘 기록에 경기 일지(출전 시간 · 평점)를 쓰면 여기에 시즌별로 쌓여요.</p></section>';
  const y = d.years.includes(year) ? year : d.years[0];
  const inY = (r) => yOf(r.date) === y;
  const mrows = d.matches.filter(inY).filter((r) => comp === 'all' || r.type === comp);
  const s = sum(mrows);
  const tY = d.train.filter(inY);
  const conds = tY.map((t) => t.cond).filter(Boolean);
  const oY = d.ovr.filter((o) => yOf(o.month) === y);
  const oD = oY.length >= 2 ? oY[oY.length - 1].v - oY[0].v : null;
  const typesY = [...new Set(d.matches.filter(inY).map((r) => r.type))];
  // 월별
  const months = [...new Set([...mrows.map((r) => mOf(r.date)), ...tY.map((t) => mOf(t.date)), ...oY.map((o) => +o.month.slice(5, 7))])].filter(Boolean).sort((a, b) => a - b);
  const maxP = Math.max(1, ...months.map((mo) => sum(mrows.filter((r) => mOf(r.date) === mo)).P));
  const mTable = months.map((mo) => {
    const ms = sum(mrows.filter((r) => mOf(r.date) === mo));
    const tm = tY.filter((t) => mOf(t.date) === mo); const c = avg(tm.map((t) => t.cond).filter(Boolean));
    const o = oY.find((x) => +x.month.slice(5, 7) === mo);
    return `<tr><td><b>${mo}월</b></td><td>${ms.n || '-'}</td><td>${ms.hasMin ? ms.min : '-'}</td><td>${ms.G || '-'}</td><td>${ms.A || '-'}</td>
      <td class="ss-barc"><span class="ss-bar" style="--w:${Math.round((ms.P / maxP) * 100)}%"></span><b>${ms.P || ''}</b></td><td>${f1(ms.rating)}</td><td>${tm.length || '-'}</td><td>${f1(c)}</td><td>${o ? o.v : '-'}</td></tr>`;
  }).join('');
  // 대회별 (그 시즌)
  const cTable = typesY.map((t) => { const c = sum(d.matches.filter(inY).filter((r) => r.type === t)); return `<tr><td><b>${esc(t)}</b></td><td>${c.n}</td><td>${c.hasMin ? c.min : '-'}</td><td>${c.G}</td><td>${c.A}</td><td>${c.n ? f1(c.P / c.n) : '-'}</td><td>${f1(c.rating)}</td></tr>`; }).join('');
  // 시즌별 (모든 해)
  const yTable = d.years.map((yy) => {
    const c = sum(d.matches.filter((r) => yOf(r.date) === yy).filter((r) => comp === 'all' || r.type === comp));
    const tl = d.train.filter((t) => yOf(t.date) === yy); const cc = avg(tl.map((t) => t.cond).filter(Boolean));
    const oo = d.ovr.filter((o) => yOf(o.month) === yy).pop();
    return `<tr class="${yy === y ? 'on' : ''}"><td><b>${yy}</b></td><td>${c.n}</td><td>${c.G}</td><td>${c.A}</td><td>${c.n ? f1(c.P / c.n) : '-'}</td><td>${f1(c.rating)}</td><td>${tl.length}</td><td>${f1(cc)}</td><td>${oo ? oo.v : '-'}</td></tr>`;
  }).join('');
  const K = (v, l, sub = '') => `<div class="ga-k"><small>${l}</small><strong>${v}</strong>${sub ? `<span>${sub}</span>` : ''}</div>`;
  return `<section class="card p3-card ss-top">
      <div class="ss-bar-row">
        <label class="p3-f">시즌<select data-ss-year>${d.years.map((yy) => `<option value="${yy}" ${yy === y ? 'selected' : ''}>${yy} 시즌</option>`).join('')}</select></label>
        <div class="seg ss-comp"><button type="button" data-ss-comp="all" class="${comp === 'all' ? 'on' : ''}">전체 경기</button>${typesY.map((t) => `<button type="button" data-ss-comp="${esc(t)}" class="${comp === t ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>
      </div>
      <div class="ga-kpis ss-kpis">
        ${K(s.n, '출전 경기', s.hasMin ? `${s.min}분` : '출전 시간 기록 없음')}
        ${K(s.G, '득점')}${K(s.A, '도움')}
        ${K(s.P, '공격포인트', s.n ? `경기당 ${f1(s.P / s.n)}` : '')}
        ${K(f1(s.rating), '평균 평점', '경기 일지 · 10점 만점')}
        ${K(tY.length, '훈련 · 경기 일지', conds.length ? `평균 컨디션 ${f1(avg(conds))}` : '')}
        ${K(oY.length ? oY[oY.length - 1].v : '-', 'OVR (마지막 확정)', oD != null ? `시즌 중 ${oD > 0 ? '+' : ''}${oD}` : '')}
      </div>
      <p class="muted small">득점 · 도움은 경기 기록실, 출전 시간 · 평점은 오늘 기록의 경기 일지에서 모아요 · 참고로만 보여 주고 성장 평가 점수는 바꾸지 않아요</p>
    </section>
    <section class="card p3-card"><h3>${y} 월별 <small class="muted">${comp === 'all' ? '전체 경기' : esc(comp)} · 일지 · 컨디션 · OVR은 모든 기록</small></h3>
      <div class="tbl-wrap"><table class="tbl p3-tbl ss-tbl"><tr><th>달</th><th>경기</th><th>분</th><th>득점</th><th>도움</th><th>공격P</th><th>평점</th><th>일지</th><th>컨디션</th><th>OVR</th></tr>${mTable}</table></div></section>
    <div class="p3-grid">
      <section class="card p3-card"><h3>${y} 대회별</h3>${cTable ? `<div class="tbl-wrap"><table class="tbl p3-tbl ss-tbl"><tr><th>대회</th><th>경기</th><th>분</th><th>득점</th><th>도움</th><th>경기당 P</th><th>평점</th></tr>${cTable}</table></div>` : '<p class="muted small">이 시즌 경기 기록이 없어요.</p>'}</section>
      <section class="card p3-card"><h3>시즌별 <small class="muted">${comp === 'all' ? '전체 경기' : esc(comp)}</small></h3><div class="tbl-wrap"><table class="tbl p3-tbl ss-tbl"><tr><th>시즌</th><th>경기</th><th>득점</th><th>도움</th><th>경기당 P</th><th>평점</th><th>일지</th><th>컨디션</th><th>OVR</th></tr>${yTable}</table></div></section>
    </div>`;
}

// 칸 안에서 시즌 · 대회 바꾸기 (다시 읽지 않고 그 자리에서)
export function mountSeason(box, d) {
  let year = d.years[0] || String(new Date().getFullYear()); let comp = 'all';
  const draw = () => {
    box.innerHTML = seasonHtml(d, year, comp);
    box.querySelector('[data-ss-year]')?.addEventListener('change', (e) => { year = e.target.value; comp = 'all'; draw(); });
    box.querySelectorAll('[data-ss-comp]').forEach((b) => (b.onclick = () => { comp = b.dataset.ssComp; draw(); }));
  };
  draw();
}
