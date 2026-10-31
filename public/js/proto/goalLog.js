// 시제품 3.0: 골 · 실점 장면 — 선수 경기 일지(분 · 위치 · 루트) → 코치 확인 → 경기 기록실 · 득점/실점 분석
// 위치는 하프 경기장 기준 미터: x = 우리 왼쪽 터치라인부터 가로(0~68), y = 그 골라인부터 거리(0~52.5)
//  득점: 상대 골대가 위 / 실점: 우리 골대가 아래 — 둘 다 '우리가 위로 공격'하는 방향이라 왼쪽 · 오른쪽이 같음
// 보안 규칙은 그대로: 선수는 자기 일지만 쓰고, 코치가 일지를 읽어 기록실에 저장
import { esc, options } from '../ui.js';

// 경기 › 기록실 · 분석실 머리 (두 화면 공통) — 영상 분석은 따로 '영상룸'
export const matchTabs = (cur) => `<nav class="gl-mtabs"><a href="#/records" class="${cur === 'records' ? 'on' : ''}">기록실</a><a href="#/analysis/goals" class="${cur === 'analysis' ? 'on' : ''}">분석실</a></nav>`;
// 고르기 한 줄 (년도 · 경기 · 학년 · 상대) — defs: [[키, 이름, [[값, 보이는 글]...]]] · '전체'면 안 거름
export function filterBar(defs, flt, extra = '') {
  const any = defs.some(([k]) => flt[k] !== '전체');
  return `<div class="gl-fbar">${defs.map(([k, l, list]) => `<label class="${flt[k] !== '전체' ? 'on' : ''}"><span>${l}</span><select data-fsel="${k}"><option value="전체">전체</option>${list.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(flt[k]) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`).join('')}
    ${any ? '<button type="button" class="link-btn small" data-freset>전체 보기</button>' : ''}${extra ? `<small class="muted">${extra}</small>` : ''}</div>`;
}
export function bindFilterBar(root, flt, redraw) {
  root.querySelectorAll('[data-fsel]').forEach((s) => (s.onchange = () => { flt[s.dataset.fsel] = s.value; redraw(); }));
  root.querySelector('[data-freset]')?.addEventListener('click', () => { Object.keys(flt).forEach((k) => { flt[k] = '전체'; }); redraw(); });
}
export const ROUTES = ['측면 크로스', '중앙 침투 패스', '개인 돌파', '코너킥', '프리킥', 'PK', '역습', '세컨볼', '기타'];
export const TIME_BINS = [[0, 15, '0–15'], [16, 30, '16–30'], [31, 45, '31–45'], [46, 60, '46–60'], [61, 75, '61–75'], [76, 999, '76+']];
const W = 68; const D = 52.5;

// 지역 이름 (우리 기준 왼쪽 · 오른쪽)
export function zoneOf(x, y) {
  if (x == null || y == null) return '';
  if (y <= 5.5 && x >= 24.84 && x <= 43.16) return '골 에어리어';
  if (y <= 16.5 && x >= 13.84 && x <= 54.16) return x >= 24.84 && x <= 43.16 ? '박스 안 중앙' : x < 34 ? '박스 안 왼쪽' : '박스 안 오른쪽';
  if (y <= 30) return x < 13.84 ? '왼쪽 측면' : x > 54.16 ? '오른쪽 측면' : '박스 밖 중앙';
  return '먼 거리';
}
export const SET_PIECES = ['코너킥', '프리킥', 'PK'];
export const binOf = (min) => TIME_BINS.findIndex(([a, b]) => +min >= a && +min <= b);
export const tally = (arr) => { const o = {}; arr.forEach((v) => { if (v !== '' && v != null) o[v] = (o[v] || 0) + 1; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };

// ───────── 하프 경기장 그림 ─────────
// side: 'for'(상대 골대 위) | 'against'(우리 골대 아래)
function lines() {
  return `<rect x="0" y="0" width="${W}" height="${D}" class="gl-ln"/>
    <rect x="13.84" y="0" width="40.32" height="16.5" class="gl-ln"/><rect x="24.84" y="0" width="18.32" height="5.5" class="gl-ln"/>
    <rect x="30.34" y="-1.6" width="7.32" height="1.6" class="gl-goal"/><circle cx="34" cy="11" r=".5" class="gl-dotln"/>
    <path d="M26.7 16.5 A9.15 9.15 0 0 0 41.3 16.5" class="gl-ln"/><path d="M24.85 ${D} A9.15 9.15 0 0 1 43.15 ${D}" class="gl-ln"/>`;
}
const py = (side, y) => (side === 'against' ? D - y : y);
export function pitchSvg(side, dots = [], { cls = '' } = {}) {
  const flip = side === 'against' ? `transform="translate(0 ${D}) scale(1 -1)"` : '';
  return `<svg class="gl-pitch ${side} ${cls}" viewBox="-2 -6 ${W + 4} ${D + 12}" preserveAspectRatio="xMidYMid meet">
    <rect x="-2" y="-2.5" width="${W + 4}" height="${D + 5}" class="gl-turf"/><g ${flip}>${lines()}</g>
    <text x="34" y="${side === 'against' ? D + 5.4 : -3.3}" class="gl-gtxt">${side === 'against' ? '우리 골대' : '상대 골대'}</text>
    <g data-dots>${dots.map((p) => dotSvg(side, p)).join('')}</g></svg>`;
}
const dotSvg = (side, p) => (p.x == null ? '' : `<circle cx="${p.x}" cy="${py(side, p.y)}" r="${p.r || 1.6}" class="gl-dot ${p.cls || ''}"><title>${esc(p.t || '')}</title></circle>`);

// 누르면 그 자리에 점 하나 (onPick(x, y))
function bindPick(svg, side, cur, onPick) {
  const put = (p) => { svg.querySelector('[data-dots]').innerHTML = dotSvg(side, { ...p, cls: 'pick', r: 2 }); };
  if (cur?.x != null) put(cur);
  svg.addEventListener('pointerdown', (e) => {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse());
    const x = Math.round(Math.max(0, Math.min(W, q.x)) * 10) / 10;
    const yy = Math.max(0, Math.min(D, q.y));
    const y = Math.round((side === 'against' ? D - yy : yy) * 10) / 10;
    put({ x, y }); onPick(x, y);
  });
}

// ───────── 한 줄 입력 (분 · 루트 · 선수 · 위치) ─────────
// kind: goal(내 골) | assist(내 도움) | conceded(실점) | fgoal(기록실: 득점 장면) | fconc(기록실: 실점 장면)
const playerOpts = (players, sel, blank = '선택 안 함') => `<option value="">${blank}</option>${players.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.number ? `${p.number} ` : '')}${esc(p.name)}</option>`).join('')}`;
function rowHtml(kind, v, players) {
  const side = kind === 'conceded' || kind === 'fconc' ? 'against' : 'for';
  const hasPos = kind !== 'assist';
  return `<div class="gl-row" data-kind="${kind}">
    <div class="gl-f">
      <label class="gl-min">분<input type="number" min="0" max="130" inputmode="numeric" data-g="min" value="${esc(v.min ?? '')}" placeholder="23"></label>
      ${kind === 'fgoal' ? `<label>득점<select data-g="uid">${playerOpts(players, v.uid, '선수 선택')}<option value="og" ${v.uid === 'og' ? 'selected' : ''}>상대 자책골</option></select></label>` : ''}
      ${kind === 'assist' ? `<label>골 넣은 선수<select data-g="scorerUid">${playerOpts(players, v.scorerUid, '선수 선택')}</select></label>` : ''}
      ${kind === 'goal' || kind === 'fgoal' ? `<label>도움<select data-g="assistUid">${playerOpts(players, v.assistUid)}</select></label>` : ''}
      ${hasPos ? `<label>어떻게<select data-g="route">${options([['', '고르기'], ...ROUTES], v.route)}</select></label>` : ''}
      ${hasPos ? `<button type="button" class="btn ghost sm gl-posbtn ${v.x != null ? 'set' : ''}" data-pos>${v.x != null ? `위치 · ${esc(zoneOf(v.x, v.y))}` : '위치 찍기'}</button>` : ''}
      <button type="button" class="link-btn" data-rm aria-label="빼기">✕</button>
    </div>
    ${hasPos ? `<div class="gl-pickbox" hidden><p class="muted small">${side === 'for' ? '슈팅한 곳' : '상대가 슈팅한 곳'}을 눌러요 · 위로 공격하는 방향이에요</p>${pitchSvg(side)}</div>` : ''}
  </div>`;
}
function bindRow(row) {
  const kind = row.dataset.kind;
  const side = kind === 'conceded' || kind === 'fconc' ? 'against' : 'for';
  row.querySelector('[data-rm]').onclick = () => row.remove();
  const btn = row.querySelector('[data-pos]');
  if (!btn) return;
  const box = row.querySelector('.gl-pickbox');
  const cur = row._pos || null;
  bindPick(box.querySelector('svg'), side, cur, (x, y) => { row._pos = { x, y }; btn.classList.add('set'); btn.textContent = `위치 · ${zoneOf(x, y)}`; });
  btn.onclick = () => { box.hidden = !box.hidden; };
}
function readRow(row, players) {
  const g = Object.fromEntries([...row.querySelectorAll('[data-g]')].map((f) => [f.dataset.g, f.value]));
  const nm = (id) => players.find((p) => p.id === id)?.name || '';
  const o = { min: g.min === '' ? null : +g.min };
  if (g.route != null) o.route = g.route;
  if (row._pos) Object.assign(o, row._pos);
  if (row._by) o.by = row._by; // 실점: 일지에 적은 선수들
  if (g.uid != null) Object.assign(o, g.uid === 'og' ? { uid: 'og', name: '상대 자책골' } : { uid: g.uid, name: nm(g.uid) });
  if (g.assistUid) Object.assign(o, { assistUid: g.assistUid, assistName: nm(g.assistUid) });
  if (g.scorerUid != null) Object.assign(o, { scorerUid: g.scorerUid, scorerName: nm(g.scorerUid) });
  return o;
}
const filled = (o) => o.min != null || o.route || o.x != null || o.uid || o.scorerUid || o.assistUid;
function listBlock(box, kind, items, players, addLabel) {
  const wrap = box.querySelector(`[data-list="${kind}"]`);
  const add = (v = {}) => { wrap.insertAdjacentHTML('beforeend', rowHtml(kind, v, players)); const r = wrap.lastElementChild; if (v.x != null) r._pos = { x: v.x, y: v.y }; if (v.by) r._by = v.by; bindRow(r); return r; };
  items.forEach((v) => add(v));
  box.querySelector(`[data-add="${kind}"]`).onclick = () => { const r = add(); r.querySelector('[data-g=min]').focus(); };
  return () => [...wrap.querySelectorAll('.gl-row')].map((r) => readRow(r, players)).filter(filled);
}

// ───────── 선수 경기 일지 칸 ─────────
// games: 이 날 기록실 경기 · groups: 학년 목록 · mj: 저장된 경기 일지
export function mountJournal(box, { mj = {}, players = [], games = [], groups = [], me = '' }) {
  const mates = players.filter((p) => p.id !== me);
  box.innerHTML = `<section class="gl-card">
    <div class="gl-ch"><h4>골 · 도움 · 실점</h4><p class="muted small">넣었거나 도왔거나 먹은 골이 있으면 눌러서 적어요 — 코치님 확인 뒤 기록실 · 분석실에 모여요</p></div>
    <div class="gl-big">
      <button type="button" data-add="goal"><b>+ 내 골</b><span data-cnt="goal"></span></button>
      <button type="button" data-add="assist"><b>+ 내 도움</b><span data-cnt="assist"></span></button>
      <button type="button" data-add="conceded" class="a"><b>+ 실점 장면</b><small>골키퍼 · 수비수</small><span data-cnt="conceded"></span></button>
    </div>
    ${games.length > 1 ? `<label class="gl-which">어느 경기였나요?<select data-gl-game>${games.map((g) => `<option value="${esc(g.id)}" ${g.id === mj.gameId ? 'selected' : ''}>${esc([g.ageGroup, g.matchType, `vs ${g.opponent}`].filter(Boolean).join(' · '))}</option>`).join('')}</select></label>`
      : !games.length && groups.length ? `<label class="gl-which">학년<select data-gl-age>${options([['', '고르기'], ...groups], mj.ageGroup)}</select><small class="muted">같은 날 학년마다 경기가 따로 있으면 꼭 골라 주세요</small></label>` : ''}
    <div class="gl-part" data-part-of="goal"><div class="gl-ph"><b>내 골</b></div><div data-list="goal"></div></div>
    <div class="gl-part" data-part-of="assist"><div class="gl-ph"><b>내 도움</b><small class="muted">골 넣은 선수가 일지를 안 써도 남아요</small></div><div data-list="assist"></div></div>
    <div class="gl-part" data-part-of="conceded"><div class="gl-ph"><b>실점 장면</b><small class="muted">같은 실점은 몇 분인지로 하나로 합쳐요</small></div><div data-list="conceded"></div></div>
  </section>`;
  // 개수 표시 · 빈 칸은 숨김
  const sync = () => ['goal', 'assist', 'conceded'].forEach((k) => { const n = box.querySelectorAll(`[data-list="${k}"] .gl-row`).length; box.querySelector(`[data-cnt="${k}"]`).textContent = n ? `${n}개` : ''; box.querySelector(`[data-part-of="${k}"]`).hidden = !n; box.querySelector(`[data-add="${k}"]`).classList.toggle('has', n > 0); });
  const mo = new MutationObserver(sync); box.querySelectorAll('[data-list]').forEach((x) => mo.observe(x, { childList: true })); // 목록만 지켜봄 (개수 글자를 바꿔도 다시 안 불림)
  const get = {
    goals: listBlock(box, 'goal', mj.goals || [], mates),
    assistsMine: listBlock(box, 'assist', mj.assistsMine || [], mates),
    conceded: listBlock(box, 'conceded', mj.conceded || [], mates),
  };
  sync();
  return () => {
    const out = { goals: get.goals(), assistsMine: get.assistsMine().filter((a) => a.scorerUid), conceded: get.conceded() };
    const g = box.querySelector('[data-gl-game]'); if (g) out.gameId = g.value; else if (games.length === 1) out.gameId = games[0].id;
    const a = box.querySelector('[data-gl-age]'); if (a) out.ageGroup = a.value;
    return out;
  };
}
// 코치가 일지 읽을 때 한 줄 요약
export function journalSummary(m = {}) {
  const parts = [];
  (m.goals || []).forEach((g) => parts.push(`골 ${g.min != null ? `${g.min}분` : ''}${g.route ? ` · ${g.route}` : ''}${g.x != null ? ` · ${zoneOf(g.x, g.y)}` : ''}${g.assistName ? ` (도움 ${g.assistName})` : ''}`));
  (m.assistsMine || []).forEach((a) => parts.push(`도움 ${a.min != null ? `${a.min}분 ` : ''}→ ${a.scorerName || ''}`));
  (m.conceded || []).forEach((c) => parts.push(`실점 ${c.min != null ? `${c.min}분` : ''}${c.route ? ` · ${c.route}` : ''}${c.x != null ? ` · ${zoneOf(c.x, c.y)}` : ''}`));
  return parts.length ? `<ul class="gl-sum">${parts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
}

// ───────── 일지 모으기 (코치) ─────────
const normName = (s) => String(s || '').toLowerCase().replace(/[\s·.\-_()]/g, '').replace(/^(fc)|(fc)$/g, '');
const near = (a, b, d) => a != null && b != null && Math.abs(a - b) <= d;
// logs: 경기 일지가 있는 선수 일지 · matches: 기록실 경기 → 경기마다 제안 하나
export function gather(logs, matches) {
  const ml = logs.filter((l) => l.kind === 'match' && l.match && l.submitted);
  const groups = new Map();
  ml.forEach((l) => {
    const m = l.match;
    const sameDay = matches.filter((x) => x.date === l.date);
    const target = (m.gameId && matches.find((x) => x.id === m.gameId)) || (sameDay.length === 1 && (!m.ageGroup || !sameDay[0].ageGroup || sameDay[0].ageGroup === m.ageGroup) ? sameDay[0] : null)
      || (m.ageGroup ? sameDay.find((x) => x.ageGroup === m.ageGroup) : null);
    const key = target ? `id:${target.id}` : `${l.date}|${m.ageGroup || ''}`;
    if (!groups.has(key)) groups.set(key, { key, date: l.date, target, logs: [] });
    groups.get(key).logs.push(l);
  });
  // 이미 기록실에 있는 경기는 새로 적힌 골 · 도움 · 실점 장면이 있을 때만
  const hasScene = (l) => ['goals', 'assistsMine', 'conceded'].some((k) => (l.match[k] || []).length);
  return [...groups.values()].map((g) => merge(g)).filter((g) => g.pending.length && (!g.target || g.pending.some(hasScene)))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
function merge(g) {
  const used = new Set(g.target?.fromLogs || []);
  const logId = (l) => `${l.uid}_${l.date}`;
  g.pending = g.logs.filter((l) => !used.has(logId(l)));
  const L = g.logs;
  const pick = (f) => { const t = tally(L.map(f).filter((v) => v !== '' && v != null).map(String)); return { v: t[0]?.[0] ?? '', all: t, conflict: t.length > 1 }; };
  // 상대팀: 띄어쓰기 · FC 차이는 같은 팀으로
  const opp = {}; L.forEach((l) => { const o = (l.match.opponent || '').trim(); if (!o) return; const k = normName(o) || o; (opp[k] ||= []).push(o); });
  const oppT = Object.values(opp).sort((a, b) => b.length - a.length);
  g.opponent = { v: oppT[0] ? tally(oppT[0])[0][0] : '', all: tally(L.map((l) => (l.match.opponent || '').trim()).filter(Boolean)), conflict: oppT.length > 1 };
  g.gf = pick((l) => l.match.gf); g.ga = pick((l) => l.match.ga);
  g.type = pick((l) => l.match.type); g.age = pick((l) => l.match.ageGroup);
  // 득점 장면: 골 넣은 선수가 적은 골 + 도움 준 선수가 적은 도움(같은 선수 · 3분 안이면 같은 골)
  const goals = [];
  L.forEach((l) => (l.match.goals || []).forEach((x) => goals.push({ ...x, uid: l.uid, name: l.name, by: [l.name] })));
  L.forEach((l) => (l.match.assistsMine || []).forEach((a) => {
    const hit = goals.find((x) => x.uid === a.scorerUid && (x.min == null || a.min == null || near(x.min, a.min, 3)) && (!x.assistUid || x.assistUid === l.uid));
    if (hit) { Object.assign(hit, { assistUid: l.uid, assistName: l.name }); if (hit.min == null) hit.min = a.min; hit.by.push(l.name); } else goals.push({ min: a.min, uid: a.scorerUid, name: a.scorerName, assistUid: l.uid, assistName: l.name, by: [l.name] });
  }));
  goals.sort((a, b) => (a.min ?? 999) - (b.min ?? 999));
  // 실점: 몇 분이 2분 안이면 같은 실점 · 위치는 평균 · 루트는 많이 고른 것
  const cs = [];
  L.forEach((l) => (l.match.conceded || []).forEach((c) => {
    const hit = c.min != null && cs.find((x) => near(x.min, c.min, 2));
    if (hit) hit.items.push({ ...c, by: l.name }); else cs.push({ min: c.min, items: [{ ...c, by: l.name }] });
  }));
  const conceded = cs.map((c) => { const p = c.items.filter((i) => i.x != null); return { min: c.min, route: tally(c.items.map((i) => i.route).filter(Boolean))[0]?.[0] || '', ...(p.length ? { x: Math.round((p.reduce((s, i) => s + i.x, 0) / p.length) * 10) / 10, y: Math.round((p.reduce((s, i) => s + i.y, 0) / p.length) * 10) / 10 } : {}), by: c.items.map((i) => i.by) }; })
    .sort((a, b) => (a.min ?? 999) - (b.min ?? 999));
  g.goals = goals; g.conceded = conceded;
  const cnt = (arr, k, nk) => { const o = {}; arr.forEach((x) => { if (!x[k] || x[k] === 'og') return; (o[x[k]] ||= { uid: x[k], name: x[nk], goals: 0 }).goals += 1; }); return Object.values(o); };
  g.scorers = cnt(goals, 'uid', 'name'); g.assists = cnt(goals, 'assistUid', 'assistName');
  // 확인할 것
  const warn = [];
  const gf = +(g.target?.gf ?? g.gf.v); const ga = +(g.target?.ga ?? g.ga.v);
  if (g.goals.length && gf !== g.goals.length) warn.push(`적힌 골 ${g.goals.length}개 · 점수는 ${gf}골`);
  if (g.conceded.length && ga !== g.conceded.length) warn.push(`적힌 실점 ${g.conceded.length}개 · 점수는 ${ga}실점`);
  g.warn = warn;
  g.events = [...goals.map((x) => ({ side: 'for', min: x.min ?? null, route: x.route || '', ...(x.x != null ? { x: x.x, y: x.y } : {}), uid: x.uid || '', name: x.name || '', ...(x.assistUid ? { assistUid: x.assistUid, assistName: x.assistName } : {}) })),
    ...conceded.map((x) => ({ side: 'against', min: x.min ?? null, route: x.route || '', ...(x.x != null ? { x: x.x, y: x.y } : {}), by: x.by }))];
  g.logIds = g.logs.map(logId);
  return g;
}

// 기록실 경기에 이미 장면이 있으면: 같은 쪽 · 2분 안이면 같은 장면으로 보고 새것만 더함
export function mergeEvents(old = [], add = []) {
  const out = [...old];
  add.forEach((e) => { if (!out.some((o) => o.side === e.side && (o.min == null || e.min == null ? false : Math.abs(o.min - e.min) <= 2))) out.push(e); });
  return out.sort((a, b) => (a.side === b.side ? (a.min ?? 999) - (b.min ?? 999) : a.side === 'for' ? -1 : 1));
}

// 제안 카드 (경기 기록실 맨 위)
export function gatherHtml(list, dismissed) {
  const show = list.filter((g) => !dismissed.has(g.key + g.logIds.join(',')));
  if (!show.length) return '';
  const hl = (x) => (x.conflict ? `<span class="gl-warn">${esc(x.v)}</span>` : esc(x.v || '-'));
  const diff = (l, x) => (x.conflict ? `<li><span>${l}</span>${x.all.map(([v, n], i) => `<em class="${i ? '' : 'top'}">${esc(v)} <i>${n}명</i></em>`).join('')}</li>` : '');
  return `<details class="card gl-gather" ${show.length <= 2 ? 'open' : ''}><summary><b>선수 일지에서 모은 경기</b><span class="gl-cnt">${show.length}</span><small class="muted">확인하면 기록실에 들어가요</small></summary>
    ${show.map((g, i) => {
      const t = g.target;
      return `<article class="gl-prop" data-gi="${list.indexOf(g)}">
      <header><span class="date-badge">${esc(g.date.slice(5).replace('-', '.'))}</span>
        <strong>${t ? `${esc(t.ageGroup ? `${t.ageGroup} · ` : '')}vs ${esc(t.opponent)} <b>${+t.gf} : ${+t.ga}</b>` : `${g.age.v ? `${esc(g.age.v)} · ` : ''}vs ${hl(g.opponent)} <b>${hl(g.gf)} : ${hl(g.ga)}</b>`}</strong>
        <small class="muted">일지 ${g.logs.length}명${g.pending.length < g.logs.length ? ` · 새로 ${g.pending.length}명` : ''}</small></header>
      <ul class="gl-plist">
        ${g.goals.length ? `<li><span>득점</span>${g.goals.map((x) => `<em>${x.min != null ? `${x.min}′ ` : ''}${esc(x.name || '?')}${x.assistName ? ` <i>← ${esc(x.assistName)}</i>` : ''}${x.route ? ` · ${esc(x.route)}` : ''}</em>`).join('')}</li>` : ''}
        ${g.conceded.length ? `<li><span>실점</span>${g.conceded.map((x) => `<em>${x.min != null ? `${x.min}′ ` : ''}${esc(x.route || '')}${x.x != null ? ` · ${esc(zoneOf(x.x, x.y))}` : ''} <i>${esc(x.by.join(' · '))}</i></em>`).join('')}</li>` : ''}
        ${!g.goals.length && !g.conceded.length ? '<li class="muted small">골 · 실점 장면은 안 적혔어요</li>' : ''}
      </ul>
      ${!t && (g.opponent.conflict || g.gf.conflict || g.ga.conflict) ? `<div class="gl-diff"><b>선수마다 다르게 적었어요</b> <small class="muted">가장 많이 적은 값(초록)으로 채웠어요 · 확인 창에서 고칠 수 있어요</small><ul class="gl-plist">${diff('상대', g.opponent)}${diff('득점', g.gf)}${diff('실점', g.ga)}</ul></div>` : ''}
      ${g.warn.length ? `<p class="gl-note">${g.warn.map(esc).join('<br>')}</p>` : ''}
      <div class="row end"><button type="button" class="btn ghost sm" data-gl-skip>이번엔 안 올리기</button>
        <button type="button" class="btn sm" data-gl-ok>${t ? `장면 ${g.events.length}개 이 경기에 넣기` : '확인하고 기록실에 올리기'}</button></div>
    </article>`; }).join('')}</details>`;
}

// ───────── 기록실 입력 창: 득점 · 실점 장면 ─────────
export function mountEditor(box, events = [], players = []) {
  box.innerHTML = `<fieldset class="picks gl-ed"><legend>득점 · 실점 장면 <small class="muted">분 · 위치 · 루트 — 아래 분석에 쓰여요</small></legend>
    <div class="gl-part"><div class="gl-ph"><b>득점</b><button type="button" class="link-btn small" data-add="fgoal">+ 득점 장면</button></div><div data-list="fgoal"></div></div>
    <div class="gl-part"><div class="gl-ph"><b>실점</b><button type="button" class="link-btn small" data-add="fconc">+ 실점 장면</button></div><div data-list="fconc"></div></div></fieldset>`;
  const a = listBlock(box, 'fgoal', events.filter((e) => e.side === 'for'), players);
  const b = listBlock(box, 'fconc', events.filter((e) => e.side === 'against'), players);
  return () => [...a().map((e) => ({ side: 'for', route: '', uid: '', name: '', ...e })), ...b().map((e) => ({ side: 'against', route: '', ...e }))];
}

// ───────── 득점 · 실점 분석 ─────────
export function analysisHtml(rows, scorer = '') {
  const ev = rows.flatMap((m) => (m.events || []).map((e) => ({ ...e, m })));
  if (!ev.length) return `<section class="card gl-ana"><h3>득점 · 실점 분석</h3><p class="muted small">골 · 실점 장면(분 · 위치 · 루트)이 쌓이면 여기에 지역 · 루트 · 시간대가 보여요. 선수들이 경기 일지에 적거나, 경기 기록에서 직접 넣을 수 있어요.</p></section>`;
  const F = ev.filter((e) => e.side === 'for'); const A = ev.filter((e) => e.side === 'against');
  const Fs = scorer ? F.filter((e) => e.uid === scorer || e.name === scorer) : F;
  const who = tally(F.filter((e) => e.name && e.uid !== 'og').map((e) => e.uid || e.name)).map(([k, n]) => [k, F.find((e) => (e.uid || e.name) === k)?.name || k, n]);
  const zoneList = (arr) => { const t = tally(arr.filter((e) => e.x != null).map((e) => zoneOf(e.x, e.y))); const n = arr.filter((e) => e.x != null).length; return t.length ? `<ol class="gl-zl">${t.slice(0, 4).map(([z, c]) => `<li><span>${esc(z)}</span><b>${c}</b><small>${Math.round((c / n) * 100)}%</small></li>`).join('')}</ol>` : '<p class="muted small">위치가 적힌 장면이 없어요</p>'; };
  const routeBars = (arr, cls) => { const t = tally(arr.map((e) => e.route).filter(Boolean)); const n = t.reduce((s, x) => s + x[1], 0); return t.length ? `<ul class="gl-bars ${cls}">${t.map(([r, c]) => `<li><span>${esc(r)}</span><div><i style="width:${(c / t[0][1]) * 100}%"></i></div><b>${c}</b><small>${Math.round((c / n) * 100)}%</small></li>`).join('')}</ul>` : '<p class="muted small">루트가 적힌 장면이 없어요</p>'; };
  const tb = (arr) => TIME_BINS.map((_, i) => arr.filter((e) => e.min != null && binOf(e.min) === i).length);
  const tf = tb(Fs); const ta = tb(A); const tmax = Math.max(1, ...tf, ...ta);
  const top = (arr) => tally(arr).slice(0, 1)[0];
  const lines2 = [];
  const fr = top(Fs.map((e) => e.route).filter(Boolean)); const ar = top(A.map((e) => e.route).filter(Boolean));
  const fz = top(Fs.filter((e) => e.x != null).map((e) => zoneOf(e.x, e.y))); const az = top(A.filter((e) => e.x != null).map((e) => zoneOf(e.x, e.y)));
  const at = ta.indexOf(Math.max(...ta)); const ft = tf.indexOf(Math.max(...tf));
  const ga_ = (w) => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '이' : '가'; }; // 이/가
  const tl = (i) => (i === TIME_BINS.length - 1 ? '76분 이후' : `${TIME_BINS[i][2]}분`);
  const say = (label, r, z, tArr, ti, n, verb) => `<b>${label}</b> ${r ? `${esc(r[0])}${ga_(r[0])} 가장 많아요(${Math.round((r[1] / n) * 100)}%)` : ''}${z ? ` · 주로 ${esc(z[0])}` : ''}${Math.max(...tArr) ? ` · ${tl(ti)}에 가장 많이 ${verb}` : ''}`;
  if (Fs.length) lines2.push(say('득점', fr, fz, tf, ft, Fs.filter((e) => e.route).length || 1, '넣어요'));
  if (A.length) lines2.push(say('실점', ar, az, ta, at, A.filter((e) => e.route).length || 1, '먹어요'));
  return `<section class="card gl-ana">
    <div class="card-head"><h3>한눈에 보기 <small class="muted">장면 ${ev.length}개</small></h3></div>
    ${lines2.length ? `<p class="gl-line">${lines2.join('<br>')}</p>` : ''}
    ${who.length ? `<div class="chips gl-who"><span class="chip-label">득점 선수</span><button type="button" class="chip ${scorer ? '' : 'active'}" data-gl-scorer="">전체</button>${who.map(([k, n, c]) => `<button type="button" class="chip ${scorer === k ? 'active' : ''}" data-gl-scorer="${esc(k)}">${esc(n)} ${c}</button>`).join('')}</div>` : ''}
    <div class="grid2 top gl-maps">
      <div><h4>득점 지역 <small class="muted">${Fs.length}골${scorer ? ` · ${esc(who.find((w) => w[0] === scorer)?.[1] || '')}` : ''}</small></h4>${pitchSvg('for', Fs.map((e) => ({ x: e.x, y: e.y, cls: 'f', t: `${e.m.date} vs ${e.m.opponent} ${e.min ?? ''}′ ${e.name || ''} ${e.route || ''}` })))}${zoneList(Fs)}</div>
      <div><h4>실점 지역 <small class="muted">${A.length}실점</small></h4>${pitchSvg('against', A.map((e) => ({ x: e.x, y: e.y, cls: 'a', t: `${e.m.date} vs ${e.m.opponent} ${e.min ?? ''}′ ${e.route || ''}` })))}${zoneList(A)}</div>
    </div>
    <div class="grid2 top"><div><h4>득점 루트</h4>${routeBars(Fs, 'f')}</div><div><h4>실점 루트</h4>${routeBars(A, 'a')}</div></div>
    <h4>시간대 <small class="muted">분 · <i class="gl-k f"></i>득점 <i class="gl-k a"></i>실점</small></h4>
    <div class="gl-time">${TIME_BINS.map(([, , l], i) => `<div class="gl-tc"><div class="gl-tf"><i style="height:${(tf[i] / tmax) * 100}%"></i><b>${tf[i] || ''}</b></div><div class="gl-ta"><i style="height:${(ta[i] / tmax) * 100}%"></i><b>${ta[i] || ''}</b></div><small>${l}</small></div>`).join('')}</div>
  </section>`;
}
