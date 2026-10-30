// 시제품 3.0: 경기 › 분석실 › 득점 · 실점 분석 — 기록실 경기의 장면(분 · 위치 · 루트)을 나눠 보기
// 한눈에 · 상황별(세트피스 · 전후반 · 스코어 상황 · 홈/원정) · 상대 · 경기별 · 선수별 · 기간 비교
import { db, collection, query, orderBy, getDocs } from '../fb.js';
import { esc, pageHead, empty, todayStr } from '../ui.js';
import { state } from '../store.js';
import { AGE_GROUPS } from '../pages/team.js';
import * as GL from './goalLog.js';

const { tally, zoneOf, pitchSvg, SET_PIECES, TIME_BINS, binOf, matchTabs } = GL;
const VIEWS = [['all', '한눈에'], ['situ', '상황별'], ['opp', '상대 · 경기별'], ['player', '선수별'], ['cmp', '기간 비교']];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const avg = (a, b) => (b ? (a / b).toFixed(2) : '-');
const res = (m) => (+m.gf > +m.ga ? 'W' : +m.gf === +m.ga ? 'D' : 'L');
const top1 = (arr) => tally(arr.filter(Boolean))[0]?.[0] || '-';
const isSet = (e) => SET_PIECES.includes(e.route);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* */ } return null; };
const HALF0 = { U12: 25, U15: 35, U18: 40 };

let view = 'all'; let scorer = ''; let pick = '';
const flt = { year: '전체', type: '전체', age: '전체', opp: '전체' };

export async function page(el) {
  const snap = await getDocs(query(collection(db, 'teams', state.team.id, 'matches'), orderBy('date', 'desc')));
  const ms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const groups = AGE_GROUPS[state.team.category] || [];
  const years = [...new Set(ms.map((m) => (m.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const types = [...new Set(ms.map((m) => m.matchType).filter(Boolean))];
  const opps = tally(ms.map((m) => m.opponent).filter(Boolean)).map(([o]) => o);
  const HKEY = `ssaka-gl-half:${state.team.id}`;
  let half = +store(HKEY) || HALF0[state.team.category] || 45;
  const cmp = { a: 'year0', b: 'year1', a1: '', a2: '', b1: '', b2: '' };

  const draw = () => {
    const rows = ms.filter((m) => (flt.year === '전체' || (m.date || '').startsWith(flt.year)) && (flt.type === '전체' || m.matchType === flt.type)
      && (flt.age === '전체' || m.ageGroup === flt.age) && (flt.opp === '전체' || m.opponent === flt.opp));
    const withEv = rows.filter((m) => (m.events || []).length);
    const body = view === 'all' ? GL.analysisHtml(rows, scorer) : view === 'situ' ? situ(rows, half) : view === 'opp' ? oppView(rows) : view === 'player' ? playerView(rows) : cmpView(ms, cmp, half);
    el.innerHTML = `${pageHead('MATCH', '경기')}${matchTabs('analysis')}
      <nav class="gl-views">${VIEWS.map(([k, l]) => `<button type="button" class="${k === view ? 'on' : ''}" data-view="${k}">${l}</button>`).join('')}</nav>
      ${view !== 'cmp' ? GL.filterBar([['year', '년도', years.map((y) => [y, `${y}년`])], ['type', '경기', types.map((t) => [t, t])], ...(groups.length ? [['age', '학년', groups.map((g) => [g, g])]] : []), ['opp', '상대', opps.map((o) => [o, o])]], flt, `${rows.length}경기 · 장면 있는 경기 ${withEv.length}`) : '<p class="muted small gl-intro">두 기간을 골라 나란히 비교해요 (위 고르기는 안 걸려요)</p>'}
      <div data-body>${body}</div>`;
    el.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { view = b.dataset.view; draw(); }));
    GL.bindFilterBar(el, flt, draw);
    el.querySelectorAll('[data-gl-scorer]').forEach((b) => (b.onclick = () => { scorer = b.dataset.glScorer; draw(); }));
    el.querySelector('[data-half]')?.addEventListener('change', (e) => { half = +e.target.value; store(HKEY, String(half)); draw(); });
    el.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { pick = pick === b.dataset.pick ? '' : b.dataset.pick; draw(); }));
    el.querySelectorAll('[data-cmp]').forEach((s) => (s.onchange = () => { cmp[s.dataset.cmp] = s.value; draw(); }));
    el.querySelectorAll('[data-to-player]').forEach((b) => (b.onclick = () => { scorer = b.dataset.toPlayer; view = 'all'; draw(); window.scrollTo(0, 0); }));
  };
  draw();
}

// ───────── 공통 조각 ─────────
const evOf = (rows) => rows.flatMap((m) => (m.events || []).map((e) => ({ ...e, m })));
const card = (title, sub, inner) => `<section class="card gl-sec"><div class="card-head"><h3>${title}${sub ? ` <small class="muted">${sub}</small>` : ''}</h3></div>${inner}</section>`;
// 득점 · 실점 나란히 막대 (라벨 · 득 · 실)
function duoBars(list) {
  const max = Math.max(1, ...list.flatMap((x) => [x.f, x.a]));
  return `<ul class="gl-duo">${list.map((x) => `<li><span>${x.l}</span>
    <div class="gl-dbar f"><div><i style="width:${(x.f / max) * 100}%"></i></div><b>${x.f}</b></div>
    <div class="gl-dbar a"><div><i style="width:${(x.a / max) * 100}%"></i></div><b>${x.a}</b></div>${x.note ? `<small>${x.note}</small>` : ''}</li>`).join('')}</ul>
    <p class="gl-legend"><i class="gl-k f"></i>득점 <i class="gl-k a"></i>실점</p>`;
}
const noEv = () => empty('이 조건에 장면(분 · 위치 · 루트)이 적힌 경기가 없어요.');

// ───────── 상황별 ─────────
function situ(rows, half) {
  const ev = evOf(rows); if (!ev.length) return noEv();
  const F = ev.filter((e) => e.side === 'for'); const A = ev.filter((e) => e.side === 'against');
  // 세트피스 vs 필드
  const sp = [['세트피스', (e) => isSet(e)], ['필드 플레이', (e) => e.route && !isSet(e)], ['루트 안 적음', (e) => !e.route]]
    .map(([l, f]) => ({ l, f: F.filter(f).length, a: A.filter(f).length })).filter((x) => x.f || x.a);
  const spDetail = SET_PIECES.map((r) => ({ l: r, f: F.filter((e) => e.route === r).length, a: A.filter((e) => e.route === r).length })).filter((x) => x.f || x.a);
  // 전반 · 후반 · 마지막 10분
  const hasMin = (e) => e.min != null;
  const hl = [['전반', (e) => e.min <= half], [`후반`, (e) => e.min > half], [`마지막 10분 (${half * 2 - 9}분 이후)`, (e) => e.min > half * 2 - 10]]
    .map(([l, f]) => ({ l, f: F.filter(hasMin).filter(f).length, a: A.filter(hasMin).filter(f).length }));
  // 스코어 상황: 장면이 점수만큼 다 적히고 분이 다 있는 경기만
  const full = rows.filter((m) => { const e = m.events || []; return e.length && e.filter((x) => x.side === 'for').length === +m.gf && e.filter((x) => x.side === 'against').length === +m.ga && e.every(hasMin); });
  const st = { lead: { f: 0, a: 0 }, draw: { f: 0, a: 0 }, trail: { f: 0, a: 0 } };
  const first = { us: [], them: [] };
  full.forEach((m) => {
    let u = 0; let t = 0;
    [...m.events].sort((x, y) => x.min - y.min || (x.side === 'for' ? -1 : 1)).forEach((e, i) => {
      const k = u > t ? 'lead' : u < t ? 'trail' : 'draw';
      st[k][e.side === 'for' ? 'f' : 'a'] += 1;
      if (i === 0) first[e.side === 'for' ? 'us' : 'them'].push(m);
      if (e.side === 'for') u += 1; else t += 1;
    });
  });
  const wr = (arr) => (arr.length ? `${arr.filter((m) => res(m) === 'W').length}승 ${arr.filter((m) => res(m) === 'D').length}무 ${arr.filter((m) => res(m) === 'L').length}패 · 승률 ${pct(arr.filter((m) => res(m) === 'W').length, arr.length)}%` : '-');
  // 홈 · 원정
  const ven = [['home', '홈'], ['away', '원정'], ['neutral', '중립']].map(([v, l]) => { const g = rows.filter((m) => (m.venue || 'home') === v); return { l, g }; }).filter((x) => x.g.length);
  return `<div class="grid2 top">
    ${card('세트피스 · 필드 플레이', `득점 ${F.length} · 실점 ${A.length}`, `${duoBars(sp.map((x) => ({ ...x, note: `득 ${pct(x.f, F.length)}% · 실 ${pct(x.a, A.length)}%` })))}${spDetail.length ? `<h4>세트피스 나눠 보기</h4>${duoBars(spDetail)}` : ''}`)}
    ${card('전반 · 후반', `<label class="gl-half">한 쪽 <select data-half>${[20, 25, 30, 35, 40, 45].map((n) => `<option value="${n}" ${n === half ? 'selected' : ''}>${n}분</option>`).join('')}</select></label>`, duoBars(hl))}
  </div>
  <div class="grid2 top">
    ${card('스코어 상황별', `장면이 다 적힌 경기 ${full.length}개 기준`, full.length ? `${duoBars([{ l: '앞설 때', ...st.lead }, { l: '비길 때', ...st.draw }, { l: '뒤질 때', ...st.trail }])}
      <ul class="gl-kv"><li><span>선제골 넣은 경기</span><b>${first.us.length}경기</b><small>${wr(first.us)}</small></li><li><span>선제골 먹은 경기</span><b>${first.them.length}경기</b><small>${wr(first.them)}</small></li></ul>` : '<p class="muted small">점수만큼 장면(분 포함)이 다 적힌 경기가 있어야 계산할 수 있어요.</p>')}
    ${card('홈 · 원정', '경기 기록 기준', `<table class="tbl rec-tbl"><tr><th></th><th>경기</th><th>승-무-패</th><th>경기당 득/실</th><th>세트피스 실점</th></tr>${ven.map(({ l, g }) => { const e = evOf(g).filter((x) => x.side === 'against'); return `<tr><td><b>${l}</b></td><td>${g.length}</td><td>${g.filter((m) => res(m) === 'W').length}-${g.filter((m) => res(m) === 'D').length}-${g.filter((m) => res(m) === 'L').length}</td><td>${avg(g.reduce((s, m) => s + +m.gf, 0), g.length)} / ${avg(g.reduce((s, m) => s + +m.ga, 0), g.length)}</td><td>${e.length ? `${pct(e.filter(isSet).length, e.length)}%` : '-'}</td></tr>`; }).join('')}</table>`)}
  </div>`;
}

// ───────── 상대 · 경기별 ─────────
function oppView(rows) {
  if (!rows.length) return empty('경기 기록이 없어요.');
  const by = {}; rows.forEach((m) => (by[m.opponent || '-'] ||= []).push(m));
  const oppRows = Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([o, g]) => {
    const e = evOf(g); const F = e.filter((x) => x.side === 'for'); const A = e.filter((x) => x.side === 'against');
    return `<tr><td><b>${esc(o)}</b></td><td>${g.length}</td><td>${g.filter((m) => res(m) === 'W').length}-${g.filter((m) => res(m) === 'D').length}-${g.filter((m) => res(m) === 'L').length}</td><td>${g.reduce((s, m) => s + +m.gf, 0)}/${g.reduce((s, m) => s + +m.ga, 0)}</td>
      <td>${esc(top1(F.map((x) => x.route)))}</td><td class="gl-bad">${esc(top1(A.map((x) => x.route)))}</td><td class="gl-bad">${esc(top1(A.filter((x) => x.x != null).map((x) => zoneOf(x.x, x.y))))}</td></tr>`;
  }).join('');
  const list = rows.map((m) => {
    const e = (m.events || []).slice().sort((a, b) => (a.min ?? 999) - (b.min ?? 999));
    const open = pick === m.id;
    return `<li class="gl-mrow ${open ? 'open' : ''}"><button type="button" data-pick="${esc(m.id)}"><span class="date-badge">${esc((m.date || '').slice(2).replace(/-/g, '.'))}</span>
      <span class="res ${res(m)}">${res(m)}</span><strong>vs ${esc(m.opponent)}</strong><b>${+m.gf} : ${+m.ga}</b><small>${esc([m.matchType, m.ageGroup].filter(Boolean).join(' · '))}</small><em>${e.length ? `장면 ${e.length}` : '장면 없음'}</em></button>
      ${open ? (e.length ? `<div class="gl-mdet"><ol class="gl-tl">${e.map((x) => `<li class="${x.side}"><b>${x.min != null ? `${x.min}′` : '-'}</b><span>${x.side === 'for' ? `${esc(x.name || '득점')}${x.assistName ? ` ← ${esc(x.assistName)}` : ''}` : '실점'}</span><small>${esc([x.route, x.x != null ? zoneOf(x.x, x.y) : ''].filter(Boolean).join(' · '))}</small></li>`).join('')}</ol>
        <div class="grid2 top"><div><h4>득점</h4>${pitchSvg('for', e.filter((x) => x.side === 'for').map((x) => ({ ...x, cls: 'f', t: `${x.min ?? ''}′ ${x.name || ''}` })))}</div><div><h4>실점</h4>${pitchSvg('against', e.filter((x) => x.side === 'against').map((x) => ({ ...x, cls: 'a', t: `${x.min ?? ''}′ ${x.route || ''}` })))}</div></div></div>`
        : '<p class="muted small gl-mdet">이 경기는 장면이 안 적혔어요. 기록실에서 경기 수정 → 득점 · 실점 장면으로 넣을 수 있어요.</p>') : ''}</li>`;
  }).join('');
  return `${card('상대팀별', '주 루트 · 지역은 장면이 적힌 경기만', `<div class="tbl-scroll"><table class="tbl rec-tbl"><tr><th>상대</th><th>경기</th><th>승-무-패</th><th>득/실</th><th>주 득점 루트</th><th>주 실점 루트</th><th>주 실점 지역</th></tr>${oppRows}</table></div>`)}
    ${card('경기별', '누르면 그 경기 장면만', `<ul class="gl-mlist">${list}</ul>`)}`;
}

// ───────── 선수별 ─────────
function playerView(rows) {
  const ev = evOf(rows); const F = ev.filter((e) => e.side === 'for' && e.uid !== 'og'); const A = ev.filter((e) => e.side === 'against');
  if (!ev.length) return noEv();
  const P = {};
  F.forEach((e) => { const k = e.uid || e.name; if (!k) return; (P[k] ||= { name: e.name, g: [], a: 0 }).g.push(e); });
  F.forEach((e) => { const k = e.assistUid || e.assistName; if (!k) return; (P[k] ||= { name: e.assistName, g: [], a: 0 }).a += 1; });
  const prow = Object.entries(P).sort((x, y) => y[1].g.length + y[1].a - (x[1].g.length + x[1].a)).map(([k, p]) => {
    const pos = p.g.filter((e) => e.x != null);
    return `<tr><td><button type="button" class="link-btn" data-to-player="${esc(k)}">${esc(p.name || '?')}</button></td><td><b>${p.g.length}</b></td><td>${p.a}</td><td>${p.g.length + p.a}</td>
      <td>${esc(top1(pos.map((e) => zoneOf(e.x, e.y))))}</td><td>${esc(top1(p.g.map((e) => e.route)))}</td><td>${p.g.length ? `${pct(p.g.filter(isSet).length, p.g.length)}%` : '-'}</td><td>${pos.length ? `${pct(pos.filter((e) => e.y <= 16.5 && e.x >= 13.84 && e.x <= 54.16).length, pos.length)}%` : '-'}</td></tr>`;
  }).join('');
  const combos = tally(F.filter((e) => e.assistName && e.name).map((e) => `${e.assistName} → ${e.name}`)).slice(0, 8);
  const rep = {}; A.forEach((e) => (e.by || []).forEach((n) => (rep[n] ||= []).push(e)));
  const repRows = Object.entries(rep).sort((a, b) => b[1].length - a[1].length);
  return `${card('득점 · 도움', '이름을 누르면 그 선수 득점 지역 지도로', `<div class="tbl-scroll"><table class="tbl rec-tbl"><tr><th>선수</th><th>골</th><th>도움</th><th>공격P</th><th>주 지역</th><th>주 루트</th><th>세트피스</th><th>박스 안</th></tr>${prow || '<tr><td colspan="8" class="muted">득점 장면이 없어요</td></tr>'}</table></div>`)}
    <div class="grid2 top">
      ${card('도움 콤비', '누가 누구에게', combos.length ? `<ul class="gl-bars f">${combos.map(([c, n]) => `<li><span>${esc(c)}</span><div><i style="width:${(n / combos[0][1]) * 100}%"></i></div><b>${n}</b><small></small></li>`).join('')}</ul>` : '<p class="muted small">도움이 적힌 골이 없어요</p>')}
      ${card('실점 장면을 적은 선수', '선수 경기 일지에서 모은 실점만', repRows.length ? `<table class="tbl rec-tbl"><tr><th>선수</th><th>실점 장면</th><th>주 루트</th><th>주 지역</th></tr>${repRows.map(([n, e]) => `<tr><td>${esc(n)}</td><td>${e.length}</td><td>${esc(top1(e.map((x) => x.route)))}</td><td>${esc(top1(e.filter((x) => x.x != null).map((x) => zoneOf(x.x, x.y))))}</td></tr>`).join('')}</table>` : '<p class="muted small">일지에서 모은 실점 장면이 아직 없어요</p>')}
    </div>`;
}

// ───────── 기간 비교 ─────────
const ymd = (d) => todayStr(d);
function range(k, c1, c2) {
  const now = new Date(); const y = now.getFullYear(); const d = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return ymd(x); };
  const m0 = new Date(y, now.getMonth(), 1); const m1 = new Date(y, now.getMonth() - 1, 1); const m1e = new Date(y, now.getMonth(), 0);
  return ({ d30: [d(29), ymd(now), '최근 30일'], p30: [d(59), d(30), '그 전 30일'], m0: [ymd(m0), ymd(now), '이번 달'], m1: [ymd(m1), ymd(m1e), '지난 달'],
    year0: [`${y}-01-01`, `${y}-12-31`, `${y}년`], year1: [`${y - 1}-01-01`, `${y - 1}-12-31`, `${y - 1}년`],
    h1: [`${y}-01-01`, `${y}-06-30`, `${y} 상반기`], h2: [`${y}-07-01`, `${y}-12-31`, `${y} 하반기`], custom: [c1 || '0000', c2 || '9999', '직접 고르기'] })[k];
}
const PRESETS = [['d30', '최근 30일'], ['p30', '그 전 30일'], ['m0', '이번 달'], ['m1', '지난 달'], ['year0', '올해'], ['year1', '작년'], ['h1', '올해 상반기'], ['h2', '올해 하반기'], ['custom', '직접 고르기']];
function stats(g, half) {
  const e = evOf(g); const F = e.filter((x) => x.side === 'for'); const A = e.filter((x) => x.side === 'against');
  const pos = (arr) => arr.filter((x) => x.x != null);
  const n = g.length; const gf = g.reduce((s, m) => s + +m.gf, 0); const ga = g.reduce((s, m) => s + +m.ga, 0);
  return { n, F, A, w: g.filter((m) => res(m) === 'W').length, d: g.filter((m) => res(m) === 'D').length, l: g.filter((m) => res(m) === 'L').length,
    gfA: n ? gf / n : null, gaA: n ? ga / n : null,
    setF: F.length ? pct(F.filter(isSet).length, F.length) : null, setA: A.length ? pct(A.filter(isSet).length, A.length) : null,
    boxF: pos(F).length ? pct(pos(F).filter((x) => x.y <= 16.5 && x.x >= 13.84 && x.x <= 54.16).length, pos(F).length) : null,
    lateA: A.filter((x) => x.min != null).length ? pct(A.filter((x) => x.min > half).length, A.filter((x) => x.min != null).length) : null,
    rF: top1(F.map((x) => x.route)), rA: top1(A.map((x) => x.route)), zA: top1(pos(A).map((x) => zoneOf(x.x, x.y))) };
}
function cmpView(ms, c, half) {
  const ra = range(c.a, c.a1, c.a2); const rb = range(c.b, c.b1, c.b2);
  const inR = (r) => ms.filter((m) => m.date >= r[0] && m.date <= r[1]);
  const A = stats(inR(ra), half); const B = stats(inR(rb), half);
  const sel = (k) => `<div class="gl-cpick"><select data-cmp="${k}">${PRESETS.map(([v, l]) => `<option value="${v}" ${c[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${c[k] === 'custom' ? `<input type="date" data-cmp="${k}1" value="${esc(c[`${k}1`])}"><input type="date" data-cmp="${k}2" value="${esc(c[`${k}2`])}">` : `<small class="muted">${range(c[k])[0]} ~ ${range(c[k])[1]}</small>`}</div>`;
  const f = (v, u = '', dec = false) => (v == null ? '-' : `${dec ? v.toFixed(2) : v}${u}`);
  // 좋아졌는지: up = 클수록 좋음
  const delta = (a, b, up) => { if (a == null || b == null || a === b) return ''; const better = up ? a > b : a < b; return `<i class="gl-d ${better ? 'good' : 'bad'}">${better ? '좋아짐' : '나빠짐'}</i>`; };
  const row = (l, a, b, u, up, dec) => `<tr><td>${l}</td><td><b>${f(a, u, dec)}</b>${up == null ? '' : delta(a, b, up)}</td><td>${f(b, u, dec)}</td></tr>`;
  const tb = (arr) => TIME_BINS.map((_, i) => arr.filter((e) => e.min != null && binOf(e.min) === i).length);
  const ta = tb(A.A); const tbb = tb(B.A); const mx = Math.max(1, ...ta, ...tbb);
  return `<section class="card gl-sec"><div class="gl-cmph"><div><span class="gl-tagA">A</span>${sel('a')}</div><div><span class="gl-tagB">B</span>${sel('b')}</div></div>
    <div class="tbl-scroll"><table class="tbl rec-tbl gl-ctbl"><tr><th></th><th>A · ${esc(ra[2])}</th><th>B · ${esc(rb[2])}</th></tr>
      ${row('경기', A.n, B.n)}<tr><td>승-무-패</td><td><b>${A.w}-${A.d}-${A.l}</b></td><td>${B.w}-${B.d}-${B.l}</td></tr>
      ${row('경기당 득점', A.gfA, B.gfA, '', true, true)}${row('경기당 실점', A.gaA, B.gaA, '', false, true)}
      ${row('세트피스 득점 비율', A.setF, B.setF, '%')}${row('세트피스 실점 비율', A.setA, B.setA, '%', false)}
      ${row('박스 안 득점 비율', A.boxF, B.boxF, '%', true)}${row('후반 실점 비율', A.lateA, B.lateA, '%', false)}
      <tr><td>주 득점 루트</td><td><b>${esc(A.rF)}</b></td><td>${esc(B.rF)}</td></tr><tr><td>주 실점 루트</td><td><b>${esc(A.rA)}</b></td><td>${esc(B.rA)}</td></tr><tr><td>주 실점 지역</td><td><b>${esc(A.zA)}</b></td><td>${esc(B.zA)}</td></tr>
    </table></div></section>
    <div class="grid2 top">
      ${card('실점 지역', '<span class="gl-tagA">A</span> 빨강 · <span class="gl-tagB">B</span> 회색', pitchSvg('against', [...B.A.map((e) => ({ ...e, cls: 'b' })), ...A.A.map((e) => ({ ...e, cls: 'a' }))]))}
      ${card('득점 지역', '<span class="gl-tagA">A</span> 초록 · <span class="gl-tagB">B</span> 회색', pitchSvg('for', [...B.F.map((e) => ({ ...e, cls: 'b' })), ...A.F.map((e) => ({ ...e, cls: 'f' }))]))}
    </div>
    ${card('실점 시간대', 'A · B', `<div class="gl-cbars">${TIME_BINS.map(([, , l], i) => `<div><div class="gl-cb"><i class="a" style="height:${(ta[i] / mx) * 100}%"><b>${ta[i] || ''}</b></i><i class="b" style="height:${(tbb[i] / mx) * 100}%"><b>${tbb[i] || ''}</b></i></div><small>${l}</small></div>`).join('')}</div>`)}`;
}
