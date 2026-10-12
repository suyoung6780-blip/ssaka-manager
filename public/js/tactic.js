// 텍티컬 패드 v2 — 필드(종류·크기·색) · 그리드 · 선수/콘/골대/영역/화살표/텍스트를 배치하고 JSON 으로 저장
// 좌표 단위는 미터. 예전(v1: home/away/ball/arrows) 데이터도 자동 변환해서 그대로 열린다.
const NS = 'http://www.w3.org/2000/svg';

export const FORMATIONS = {
  '4-4-2': [[5, 34], [20, 10], [18, 26], [18, 42], [20, 58], [38, 10], [36, 27], [36, 41], [38, 58], [50, 27], [50, 41]],
  '4-3-3': [[5, 34], [20, 10], [18, 26], [18, 42], [20, 58], [33, 34], [38, 22], [38, 46], [50, 12], [52, 34], [50, 56]],
  '4-2-3-1': [[5, 34], [20, 10], [18, 26], [18, 42], [20, 58], [30, 27], [30, 41], [40, 14], [40, 34], [40, 54], [51, 34]],
  '3-5-2': [[5, 34], [18, 20], [17, 34], [18, 48], [34, 8], [32, 26], [30, 34], [32, 42], [34, 60], [50, 27], [50, 41]],
  '3-4-3': [[5, 34], [18, 20], [17, 34], [18, 48], [34, 10], [32, 27], [32, 41], [34, 58], [48, 14], [52, 34], [48, 54]],
};

export const FIELDS = {
  full: { label: '풀코트', w: 105, h: 68 },
  half: { label: '하프코트', w: 52.5, h: 68 },
  box: { label: '페널티박스 주변', w: 36, h: 50 },
  custom: { label: '직접 설정 (그리드 훈련장)', w: 30, h: 20 },
};
const GRIDS = { none: '그리드 없음', '3x3': '3×3 존', lanes5: '5레인', zones18: '18존 (6×3)', custom: '직접 설정' };
const GRID_PRESET = { none: [0, 0], '3x3': [3, 3], lanes5: [0, 5], zones18: [6, 3] };
const COLORS = { dark: '다크', green: '잔디', white: '화이트' };
export const TEAMS = {
  a: { label: 'A', fill: '#ffffff', text: '#000000', stroke: '#000000' },
  b: { label: 'B', fill: '#151515', text: '#ffffff', stroke: '#ffffff' },
  c: { label: 'C', fill: '#e5484d', text: '#ffffff', stroke: '#7a1c1f' },
  d: { label: 'D', fill: '#3b82f6', text: '#ffffff', stroke: '#173a75' },
  j: { label: '조커', fill: '#f5c400', text: '#000000', stroke: '#6b5600' },
};
const THEME = {
  dark: { bg: '#0b0b0b', out: '#070707', line: 'rgba(255,255,255,.6)', grid: 'rgba(255,255,255,.22)', ink: '#ffffff', zone: 'rgba(255,255,255,.12)' },
  green: { bg: '#3d7a37', bg2: '#438541', out: '#2f5f2b', line: 'rgba(255,255,255,.9)', grid: 'rgba(255,255,255,.4)', ink: '#ffffff', zone: 'rgba(255,255,255,.18)' },
  white: { bg: '#fbfbfa', out: '#efefed', line: '#bdbdbb', grid: '#dcdcda', ink: '#111111', zone: 'rgba(0,0,0,.08)' },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
let padSeq = 0;
const round = (n) => Math.round(n * 10) / 10;

export function blank(type = 'full') {
  const f = FIELDS[type];
  return { v: 2, field: { type, w: f.w, h: f.h, color: 'dark' }, grid: { preset: 'none', cols: 0, rows: 0 }, items: [] };
}

function formationItems(name, team, w, h, mirror) {
  const pts = FORMATIONS[name] || FORMATIONS['4-3-3'];
  return pts.map(([x, y], i) => {
    let px = (x / 105) * w;
    let py = (y / 68) * h;
    if (mirror) { px = w - px; py = h - py; }
    return { k: 'player', team, n: String(i + 1), x: round(px), y: round(py) };
  });
}

export function formationData(name = '4-3-3', withAway = true) {
  const d = blank('full');
  d.formation = FORMATIONS[name] ? name : '4-3-3';
  d.items = [
    ...formationItems(d.formation, 'a', 105, 68, false),
    ...(withAway ? formationItems(d.formation, 'b', 105, 68, true) : []),
    { k: 'ball', x: 52.5, y: 34 },
  ];
  return d;
}

// v1 → v2
export function normalize(data) {
  if (!data) return formationData('4-3-3', false);
  if (data.v === 2) {
    const d = clone(data);
    d.grid ||= { preset: 'none', cols: 0, rows: 0 };
    d.items ||= [];
    return d;
  }
  const d = blank('full');
  d.formation = data.formation;
  (data.home || []).forEach((p) => d.items.push({ k: 'player', team: 'a', n: String(p.n), x: p.x, y: p.y }));
  (data.away || []).forEach((p) => d.items.push({ k: 'player', team: 'b', n: String(p.n), x: p.x, y: p.y }));
  if (data.ball) d.items.push({ k: 'ball', x: data.ball.x, y: data.ball.y });
  (data.arrows || []).forEach((a) => d.items.push({ k: 'arrow', style: a.dash ? 'dribble' : 'pass', x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 }));
  return d;
}

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== '') e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// ───────── 필드 그리기 ─────────
function drawField(g, d, T, u) {
  const { w, h, type } = d.field;
  const sw = 0.35 * Math.max(u, 0.45);
  if (d.field.color === 'green') {
    const n = Math.max(6, Math.round(w / 9));
    for (let i = 0; i < n; i++) el('rect', { x: (w / n) * i, y: 0, width: w / n + 0.01, height: h, fill: i % 2 ? T.bg2 : T.bg }, g);
  } else {
    el('rect', { x: 0, y: 0, width: w, height: h, fill: T.bg }, g);
  }
  const L = el('g', { fill: 'none', stroke: T.line, 'stroke-width': sw }, g);
  if (type !== 'custom') el('rect', { x: 0, y: 0, width: w, height: h }, L); // 직접 설정은 테두리 없이 화면만

  const goalEnd = (x, dir) => {
    const cy = h / 2;
    el('rect', { x: dir > 0 ? x : x - 16.5, y: cy - 20.16, width: 16.5, height: 40.32 }, L);
    el('rect', { x: dir > 0 ? x : x - 5.5, y: cy - 9.16, width: 5.5, height: 18.32 }, L);
    el('circle', { cx: x + dir * 11, cy, r: sw * 1.4, fill: T.line, stroke: 'none' }, L);
    el('path', { d: `M ${x + dir * 16.5} ${cy - 7.3} A 9.15 9.15 0 0 ${dir > 0 ? 1 : 0} ${x + dir * 16.5} ${cy + 7.3}` }, L);
    el('rect', { x: dir > 0 ? x - 2 : x, y: cy - 3.66, width: 2, height: 7.32 }, L);
  };

  if (type === 'full') {
    el('line', { x1: w / 2, y1: 0, x2: w / 2, y2: h }, L);
    el('circle', { cx: w / 2, cy: h / 2, r: 9.15 }, L);
    el('circle', { cx: w / 2, cy: h / 2, r: sw * 1.4, fill: T.line, stroke: 'none' }, L);
    goalEnd(0, 1);
    goalEnd(w, -1);
  } else if (type === 'half') {
    el('path', { d: `M 0 ${h / 2 - 9.15} A 9.15 9.15 0 0 1 0 ${h / 2 + 9.15}` }, L);
    goalEnd(w, -1);
  } else if (type === 'box') {
    // 오른쪽이 골라인
    const cy = h / 2;
    el('rect', { x: w - 16.5, y: cy - 20.16, width: 16.5, height: 40.32 }, L);
    el('rect', { x: w - 5.5, y: cy - 9.16, width: 5.5, height: 18.32 }, L);
    el('circle', { cx: w - 11, cy, r: sw * 1.4, fill: T.line, stroke: 'none' }, L);
    el('path', { d: `M ${w - 16.5} ${cy - 7.3} A 9.15 9.15 0 0 0 ${w - 16.5} ${cy + 7.3}` }, L);
    el('rect', { x: w, y: cy - 3.66, width: 2, height: 7.32 }, L);
  }

  // 그리드
  const { cols, rows } = d.grid;
  const G = el('g', { stroke: T.grid, 'stroke-width': sw * 0.8, 'stroke-dasharray': `${u * 1.2} ${u * 0.9}` }, g);
  for (let i = 1; i < cols; i++) el('line', { x1: (w / cols) * i, y1: 0, x2: (w / cols) * i, y2: h }, G);
  for (let i = 1; i < rows; i++) el('line', { x1: 0, y1: (h / rows) * i, x2: w, y2: (h / rows) * i }, G);
}


// 하프코트 · 페널티박스 주변은 골대가 위로 오게 세로로 그림 (좌표는 그대로, 화면만 돌림) — 글자는 다시 똑바로
let vertical = false;
export const isVertical = (type) => type === 'half' || type === 'box';
const upright = (x, y) => (vertical ? `rotate(90 ${x} ${y})` : '');

// 곡선 화살표: 시작(x1,y1) · 끝(x2,y2) · 가운데 조절점(cx,cy, 없으면 직선)
const ctrlOf = (it) => ({ x: it.cx ?? (it.x1 + it.x2) / 2, y: it.cy ?? (it.y1 + it.y2) / 2 });
export function bez(it, t) {
  const c = ctrlOf(it); const u = 1 - t;
  return { x: u * u * it.x1 + 2 * u * t * c.x + t * t * it.x2, y: u * u * it.y1 + 2 * u * t * c.y + t * t * it.y2 };
}
const bezPts = (it, upto = 1, n = 28) => Array.from({ length: n + 1 }, (_, i) => bez(it, (i / n) * upto));
// 꺾은선을 따라 물결 (드리블)
function wavyPts(pts, u) {
  const out = [pts[0]];
  let acc = 0; let k = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]; const b = pts[i];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1e-6;
    const nx = -(b.y - a.y) / L; const ny = (b.x - a.x) / L;
    acc += L;
    if (acc >= 1.1 * u || i === pts.length - 1) {
      const off = i === pts.length - 1 ? 0 : (k++ % 2 ? 1 : -1) * 0.8 * u;
      out.push({ x: b.x + nx * off, y: b.y + ny * off });
      acc = 0;
    }
  }
  return out;
}
const ptsD = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

// 기구 기본 색
const KIND_COLOR = { cone: '#ff8a00', marker: '#f5c400', pole: '#ffd400', hurdle: '#ff3b30', ladder: '#ffd400', gmarker: '#ff9f0a', gymball: '#4ea1ff', bosu: '#5e5ce6', vision: '#ffd400' };
export const TOOL_COLORS = ['', '#ffd400', '#ff3b30', '#ff9f0a', '#34c759', '#00d1ff', '#4ea1ff', '#bf5af2', '#ff6fb5', '#ffffff', '#111111'];
const COLORABLE = ['arrow', 'zone', 'text', 'cone', 'marker', 'pole', 'hurdle', 'ladder', 'gmarker', 'gymball', 'bosu', 'vision'];
const ROTATABLE = ['goal', 'minigoal', 'hurdle', 'ladder'];

// o: { prog: 화살표가 그어진 정도(0~1), op: 투명도, badge: 순서 번호 표시, origin: 시야 기준점(선수 위치) }
function drawItem(layer, it, i, T, u0, selected, mkFor, o = {}) {
  const z = it.k === 'zone' ? 1 : (it.s || 1); // 아이템 크기 (기본 1)
  const u = u0 * z;
  const g = el('g', { 'data-i': i, class: `it it-${it.k}${selected ? ' sel' : ''}`, opacity: o.op != null && o.op < 1 ? Math.max(0, o.op).toFixed(2) : '' }, layer);
  const ring = (r) => selected && el('circle', { cx: it.x, cy: it.y, r, fill: 'none', stroke: '#4ea1ff', 'stroke-width': 0.3 * u, 'stroke-dasharray': `${u} ${u * 0.6}` }, g);
  const col = it.c || KIND_COLOR[it.k] || T.ink;
  const rotG = () => el('g', { transform: `rotate(${it.rot || 0} ${it.x} ${it.y})` }, g);
  switch (it.k) {
    case 'player': {
      const tm = TEAMS[it.team] || TEAMS.a;
      const r = 2.1 * u;
      el('circle', { cx: it.x, cy: it.y, r, fill: tm.fill, stroke: tm.stroke, 'stroke-width': 0.3 * u }, g);
      const t = el('text', { x: it.x, y: it.y + 0.75 * u, 'text-anchor': 'middle', 'font-size': (String(it.n).length > 2 ? 1.5 : 2.1) * u, fill: tm.text, 'font-weight': 800, transform: upright(it.x, it.y) }, g);
      t.textContent = it.n ?? '';
      ring(r + 0.9 * u);
      break;
    }
    case 'ball':
      el('circle', { cx: it.x, cy: it.y, r: 1 * u, fill: '#fff', stroke: '#000', 'stroke-width': 0.25 * u }, g);
      el('circle', { cx: it.x, cy: it.y, r: 0.38 * u, fill: '#000' }, g);
      ring(1.9 * u);
      break;
    case 'cone': {
      const s = 1.3 * u;
      el('path', { d: `M ${it.x} ${it.y - s} L ${it.x + s * 0.9} ${it.y + s * 0.7} L ${it.x - s * 0.9} ${it.y + s * 0.7} Z`, fill: col, stroke: 'rgba(0,0,0,.45)', 'stroke-width': 0.2 * u, transform: upright(it.x, it.y) }, g);
      ring(2 * u);
      break;
    }
    case 'marker':
      el('ellipse', { cx: it.x, cy: it.y, rx: 1.1 * u, ry: 0.6 * u, fill: col, stroke: 'rgba(0,0,0,.45)', 'stroke-width': 0.2 * u, transform: upright(it.x, it.y) }, g);
      ring(1.8 * u);
      break;
    case 'gmarker': // 납작한 그라운드 마커 (가운데 구멍)
      el('circle', { cx: it.x, cy: it.y, r: 1 * u, fill: col, stroke: 'rgba(0,0,0,.45)', 'stroke-width': 0.18 * u }, g);
      el('circle', { cx: it.x, cy: it.y, r: 0.35 * u, fill: T.bg }, g);
      ring(1.8 * u);
      break;
    case 'pole': { // 폴대 (옆에서 본 모양)
      const pg = el('g', { transform: upright(it.x, it.y) }, g);
      el('ellipse', { cx: it.x, cy: it.y + 0.9 * u, rx: 0.9 * u, ry: 0.32 * u, fill: 'rgba(0,0,0,.55)' }, pg);
      el('line', { x1: it.x, y1: it.y + 0.9 * u, x2: it.x, y2: it.y - 3 * u, stroke: col, 'stroke-width': 0.5 * u, 'stroke-linecap': 'round' }, pg);
      for (let k = 0; k < 3; k++) el('line', { x1: it.x, y1: it.y - 0.2 * u - k * 1.1 * u, x2: it.x, y2: it.y - 0.6 * u - k * 1.1 * u, stroke: '#111', 'stroke-width': 0.52 * u }, pg);
      ring(2.2 * u);
      break;
    }
    case 'hurdle': { // 허들 (⊓)
      const hg = rotG();
      el('path', { d: `M ${it.x - 1.6 * u} ${it.y + 0.6 * u} L ${it.x - 1.6 * u} ${it.y - 0.7 * u} L ${it.x + 1.6 * u} ${it.y - 0.7 * u} L ${it.x + 1.6 * u} ${it.y + 0.6 * u}`, fill: 'none', stroke: col, 'stroke-width': 0.45 * u, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, hg);
      ring(2.3 * u);
      break;
    }
    case 'ladder': { // 스피드 사다리
      const lg = rotG();
      el('rect', { x: it.x - 1.1 * u, y: it.y - 4 * u, width: 2.2 * u, height: 8 * u, fill: 'none', stroke: col, 'stroke-width': 0.3 * u }, lg);
      for (let k = 1; k < 8; k++) el('line', { x1: it.x - 1.1 * u, y1: it.y - 4 * u + k * u, x2: it.x + 1.1 * u, y2: it.y - 4 * u + k * u, stroke: col, 'stroke-width': 0.22 * u }, lg);
      ring(4.6 * u);
      break;
    }
    case 'gymball': // 짐볼
      el('circle', { cx: it.x, cy: it.y, r: 2 * u, fill: col, stroke: 'rgba(0,0,0,.4)', 'stroke-width': 0.25 * u }, g);
      el('circle', { cx: it.x - 0.6 * u, cy: it.y - 0.7 * u, r: 0.6 * u, fill: 'rgba(255,255,255,.45)' }, g);
      ring(2.8 * u);
      break;
    case 'bosu': { // 밸런스볼 (반구)
      const bg = el('g', { transform: upright(it.x, it.y) }, g);
      el('path', { d: `M ${it.x - 1.9 * u} ${it.y + 0.5 * u} A ${1.9 * u} ${1.9 * u} 0 0 1 ${it.x + 1.9 * u} ${it.y + 0.5 * u} Z`, fill: col, stroke: 'rgba(0,0,0,.4)', 'stroke-width': 0.22 * u }, bg);
      el('rect', { x: it.x - 2 * u, y: it.y + 0.4 * u, width: 4 * u, height: 0.45 * u, rx: 0.2 * u, fill: '#222' }, bg);
      ring(2.6 * u);
      break;
    }
    case 'minigoal':
    case 'goal': {
      const big = it.k === 'goal';
      const gw = big ? 7.32 * z : 3 * u;
      const gd = big ? 2 * z : 1.2 * u;
      const gg = rotG();
      el('rect', { x: it.x - gd / 2, y: it.y - gw / 2, width: gd, height: gw, fill: 'rgba(255,255,255,.25)', stroke: T.ink, 'stroke-width': 0.35 * u }, gg);
      for (let k = 1; k < 4; k++) el('line', { x1: it.x - gd / 2, y1: it.y - gw / 2 + (gw / 4) * k, x2: it.x + gd / 2, y2: it.y - gw / 2 + (gw / 4) * k, stroke: T.ink, 'stroke-width': 0.12 * u, opacity: 0.6 }, gg);
      ring(gw / 2 + u);
      break;
    }
    case 'zone': {
      const dash = it.style === 'dash';
      const zc = it.c || (dash ? '#e5484d' : '');
      el('rect', {
        x: it.x, y: it.y, width: it.w, height: it.h,
        fill: zc ? `${zc}${dash ? '14' : '33'}` : T.zone,
        stroke: dash || it.c ? zc : 'none', 'stroke-width': 0.35 * u, 'stroke-dasharray': dash ? `${u * 1.2} ${u * 0.8}` : '',
      }, g);
      if (selected) {
        el('rect', { x: it.x, y: it.y, width: it.w, height: it.h, fill: 'none', stroke: '#4ea1ff', 'stroke-width': 0.3 * u, 'stroke-dasharray': `${u} ${u * 0.6}` }, g);
        el('circle', { cx: it.x + it.w, cy: it.y + it.h, r: 1.1 * u, fill: '#4ea1ff', 'data-handle': 'size' }, g);
      }
      break;
    }
    case 'arrow': {
      const prog = o.prog == null ? 1 : o.prog;
      if (prog <= 0) break;
      let pts = bezPts(it, prog);
      if (it.style === 'dribble') pts = wavyPts(pts, u);
      el('path', { d: ptsD(pts), stroke: col, 'stroke-width': 0.45 * u, fill: 'none', 'marker-end': `url(#${mkFor(col)})`, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': it.style === 'run' ? `${u * 1.2} ${u * 0.9}` : '' }, g);
      el('path', { d: ptsD(bezPts(it)), stroke: 'transparent', 'stroke-width': 2.4 * u, fill: 'none' }, g);
      if (o.badge) { // 순서 번호
        const m = bez(it, 0.5);
        el('circle', { cx: m.x, cy: m.y, r: 1.2 * u, fill: col, stroke: '#000', 'stroke-width': 0.18 * u }, g);
        const t = el('text', { x: m.x, y: m.y + 0.5 * u, 'text-anchor': 'middle', 'font-size': 1.45 * u, 'font-weight': 900, fill: '#000', transform: upright(m.x, m.y) }, g);
        t.textContent = it.order || 1;
      }
      if (selected) {
        const m = bez(it, 0.5);
        el('circle', { cx: it.x1, cy: it.y1, r: 1 * u, fill: '#4ea1ff', 'data-handle': 'p1' }, g);
        el('circle', { cx: it.x2, cy: it.y2, r: 1 * u, fill: '#4ea1ff', 'data-handle': 'p2' }, g);
        el('circle', { cx: m.x, cy: m.y, r: 0.9 * u, fill: '#fff', stroke: '#4ea1ff', 'stroke-width': 0.3 * u, 'data-handle': 'pc' }, g); // 끌면 곡선
      }
      break;
    }
    case 'vision': { // 시야: 선수가 바라보는 방향을 V 모양으로
      const O = o.origin || { x: it.x, y: it.y };
      const L = it.len || 12; const a = ((it.ang || 0) * Math.PI) / 180; const sp = (((it.spread || 50) / 2) * Math.PI) / 180;
      const A = { x: O.x + Math.cos(a - sp) * L, y: O.y + Math.sin(a - sp) * L };
      const B = { x: O.x + Math.cos(a + sp) * L, y: O.y + Math.sin(a + sp) * L };
      el('path', { d: `M ${O.x} ${O.y} L ${A.x} ${A.y} A ${L} ${L} 0 0 1 ${B.x} ${B.y} Z`, fill: col, 'fill-opacity': 0.16, stroke: 'none' }, g);
      el('path', { d: `M ${A.x} ${A.y} L ${O.x} ${O.y} L ${B.x} ${B.y}`, fill: 'none', stroke: col, 'stroke-width': 0.4 * u, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': `${u * 1.1} ${u * 0.6}` }, g);
      if (selected) {
        el('circle', { cx: O.x + Math.cos(a) * L, cy: O.y + Math.sin(a) * L, r: 1 * u, fill: '#4ea1ff', 'data-handle': 'vh' }, g);
        if (!it.who) el('circle', { cx: O.x, cy: O.y, r: 0.8 * u, fill: '#4ea1ff' }, g);
      }
      break;
    }
    case 'text': {
      const t = el('text', { x: it.x, y: it.y, 'text-anchor': 'middle', 'font-size': 2.4 * u, 'font-weight': 800, fill: it.c || T.ink, transform: upright(it.x, it.y) }, g);
      t.textContent = it.t;
      if (selected) {
        const b = { w: Math.max(4, String(it.t).length * 2.2) * u, h: 3.4 * u };
        el('rect', { x: it.x - b.w / 2, y: it.y - b.h * 0.75, width: b.w, height: b.h, fill: 'none', stroke: '#4ea1ff', 'stroke-width': 0.3 * u, 'stroke-dasharray': `${u} ${u * 0.6}`, transform: upright(it.x, it.y) }, g);
      }
      break;
    }
    default:
  }
  return g;
}

const TOOLS = [
  ['select', '선택·이동', '⬚'],
  ['player', '선수', '●'],
  ['ball', '공', '⚽'],
  ['pass', '패스', '→'],
  ['run', '이동', '⇢'],
  ['dribble', '드리블', '↝'],
  ['vision', '시야', '∨'],
  ['cone', '콘', '▲'],
  ['marker', '마커', '◒'],
  ['gmarker', '그라운드마커', '◉'],
  ['pole', '폴대', '┃'],
  ['hurdle', '허들', 'Π'],
  ['ladder', '사다리', '☷'],
  ['gymball', '짐볼', '◯'],
  ['bosu', '밸런스볼', '◓'],
  ['minigoal', '미니골대', '⊓'],
  ['goal', '골대', '⊔'],
  ['zone', '영역', '▭'],
  ['zone-dash', '점선 영역', '⬚'],
  ['text', '글자', 'T'],
];

// 도구 묶음 — [이름, 아이콘, 들어 있는 도구들]
const TOOL_GROUPS = [
  ['선택', '⬚', ['select']],
  ['선수', '●', ['player']],
  ['공', '⚽', ['ball']],
  ['화살표', '→', ['pass', 'run', 'dribble']],
  ['시야', '∨', ['vision']],
  ['기구', '▲', ['cone', 'marker', 'gmarker', 'pole', 'hurdle', 'ladder', 'gymball', 'bosu', 'minigoal', 'goal']],
  ['영역', '▭', ['zone', 'zone-dash']],
  ['글자', 'T', ['text']],
];
const TOOL_INFO = Object.fromEntries(TOOLS.map(([k, l, ic]) => [k, { l, ic }]));

// 움직임(장면): data.steps[k] = { 아이템id: [x, y] } — 장면 1은 기본 위치, 장면 2부터 바뀐 위치만 저장
const MOVABLE = ['player', 'ball', 'cone', 'marker', 'text', 'gmarker', 'pole', 'hurdle', 'ladder', 'gymball', 'bosu', 'vision'];
const EQUIP = ['cone', 'marker', 'ball', 'minigoal', 'goal', 'gmarker', 'pole', 'hurdle', 'ladder', 'gymball', 'bosu'];
let idSeq = 0;
let clipboard = null; // Ctrl+C 한 아이템들 (다른 작전판에도 붙여넣기 가능)
let activePad = 0; // 마지막으로 만진 작전판 (단축키는 그 작전판에만)
const newId = () => `i${Date.now().toString(36)}${(++idSeq).toString(36)}`;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

export function createPad(container, initial, { editable = true, motion = false, play = true } = {}) {
  let data = normalize(initial);
  data.steps ||= [];
  let scene = 0; // 0 = 장면 1 (기본)
  let anim = null; // 재생 중: 아이템id → [x, y]
  let raf = 0;
  let tool = 'select';
  let team = 'a';
  let sel = -1;
  const extra = new Set(); // 함께 고른 아이템들 (Ctrl · Shift + 클릭)
  const padId = ++padSeq;
  if (editable) activePad = padId; // 새로 연 편집 작전판이 단축키를 받음
  const history = [];
  const future = []; // 다시 실행 (Ctrl+Shift+Z / Ctrl+Y)
  const sizes = {}; // 도구별 마지막 크기 → 새로 놓는 것도 같은 크기로
  let ccol = ''; // 지금 고른 색 ('' = 기본색)
  const kindOf = (t) => (['pass', 'run', 'dribble'].includes(t) ? 'arrow' : t);
  const curSize = () => sizes[kindOf(tool)] || 1;
  const mk = `ah${++padSeq}`;

  container.classList.add('pad');
  container.innerHTML = editable ? `
    <div class="pad-field">
      <select data-ft title="필드">${Object.entries(FIELDS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('')}</select>
      <span class="pad-size"><input type="number" data-fw min="5" max="120" step="1" title="가로(m)"><i>×</i><input type="number" data-fh min="5" max="90" step="1" title="세로(m)"><i>m</i></span>
      <select data-fc title="필드 색">${Object.entries(COLORS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <select data-gp title="그리드">${Object.entries(GRIDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <span class="pad-size" data-gsize><input type="number" data-gc min="0" max="12" title="세로줄(칸)"><i>×</i><input type="number" data-gr min="0" max="12" title="가로줄(칸)"><i>칸</i></span>
      <select data-form title="포메이션"><option value="">포메이션 넣기</option>
        <optgroup label="A팀">${Object.keys(FORMATIONS).map((f) => `<option value="a:${f}">A · ${f}</option>`).join('')}</optgroup>
        <optgroup label="B팀 (상대)">${Object.keys(FORMATIONS).map((f) => `<option value="b:${f}">B · ${f}</option>`).join('')}</optgroup>
      </select>
    </div>
    <div class="pad-tools">
      ${TOOL_GROUPS.map(([l, ic, ks], gi) => (ks.length === 1
        ? `<button type="button" class="ptool" data-tool="${ks[0]}" title="${l}"><b>${ic}</b>${l}</button>`
        : `<span class="pgroup" data-grp="${gi}"><button type="button" class="ptool" data-gbtn="${gi}" title="${l}"><b>${ic}</b><span data-glabel>${l}</span> ▾</button>
          <span class="pgmenu" hidden>${ks.map((k) => `<button type="button" data-tool="${k}"><b>${TOOL_INFO[k].ic}</b>${TOOL_INFO[k].l}</button>`).join('')}</span></span>`)).join('')}
      <button type="button" class="ptool pfull" data-act="full" title="크게 (Esc로 닫기)"><b>⛶</b><span data-flabel>크게</span></button>
    </div>
    <div class="pad-acts">
      <button type="button" class="chip" data-act="undo">되돌리기</button>
      <button type="button" class="chip" data-act="clear">모두 지우기</button>
      <span class="pad-sz" data-size>크기 <button type="button" class="chip" data-sz="-1" title="작게 (- 키)">−</button><input type="number" min="1" max="300" data-szin title="1~300 적고 Enter"><i>%</i><button type="button" class="chip" data-sz="1" title="크게 (+ 키)">+</button></span>
      <span class="pad-ord" data-order title="같은 번호끼리 한꺼번에 움직여요 · 기본 1">순서 <input type="number" min="1" max="20" data-ordin> <small>번째</small></span>
    </div>
    <div class="pad-acts pad-sel" data-selbar>
      <span class="pad-num" data-pnum>번호 <input data-pnin maxlength="4" title="선수 번호 (또는 짧은 이름) 적고 Enter"></span>
      <span class="pad-teams" data-teams>${Object.entries(TEAMS).map(([k, t]) => `<button type="button" class="pteam" data-team="${k}" style="--c:${t.fill};--t:${t.text}">${t.label}</button>`).join('')}</span>
      <span class="pad-colors" data-colors>${TOOL_COLORS.map((c) => `<button type="button" class="pcol ${c ? '' : 'def'}" data-col="${c}" style="--c:${c || 'transparent'}" title="${c || '기본색'}"></button>`).join('')}</span>
      <span class="pad-opt" data-spread>시야 ${[[30, '좁게'], [50, '보통'], [80, '넓게']].map(([v, l]) => `<button type="button" class="chip" data-sp="${v}">${l}</button>`).join('')}</span>
      <button type="button" class="chip" data-straight>직선으로</button>
      <span class="pad-grp"><button type="button" class="chip" data-act="front" title="맨 앞으로 (Ctrl+])">⬆ 맨 앞으로</button><button type="button" class="chip" data-act="back" title="맨 뒤로 (Ctrl+[)">⬇ 맨 뒤로</button><button type="button" class="chip" data-act="rotate">회전</button></span>
      <span class="pad-grp"><button type="button" class="chip" data-act="delete">선택 삭제</button><button type="button" class="chip" data-act="delall">모든 장면 삭제</button><button type="button" class="chip" data-act="unmove">움직임 취소</button></span>
    </div>
    <small class="muted pad-hint" data-hint></small>` : '';

  const svg = el('svg', { class: 'pad-svg', tabindex: editable ? 0 : -1 });
  let world = svg; // 필드 · 아이템이 들어가는 그룹 (세로 필드면 돌아가 있음)
  container.appendChild(svg);


  const snapshot = () => { history.push(JSON.stringify(data)); if (history.length > 80) history.shift(); future.length = 0; };
  const selected = () => [items()[sel], ...extra].filter(Boolean);
  // 작은 그리드 훈련장에서도 선수·콘이 너무 작아지지 않게 하한을 둔다
  const unit = () => Math.max(0.55, Math.max(data.field.w, data.field.h) / 105);
  const items = () => data.items;
  // 바깥 여백: 골대(2m)가 보일 만큼만 · 직접 설정은 거의 없이
  const margin = () => (data.field.type === 'custom' ? 0.6 * unit() : Math.max(2 * unit(), 2.4));
  const nextNum = (tm) => {
    const nums = items().filter((x) => x.k === 'player' && x.team === tm).map((x) => +x.n).filter((n) => !isNaN(n));
    return String(nums.length ? Math.max(...nums) + 1 : 1);
  };

  // 장면 s 에서의 위치 (앞 장면들을 차례로 적용)
  const posAt = (s) => {
    const m = {};
    data.items.forEach((it) => { if (MOVABLE.includes(it.k)) m[it.id] = [it.x, it.y]; });
    for (let k = 0; k < s && k < data.steps.length; k++) Object.entries(data.steps[k]).forEach(([id, p]) => { if (m[id]) m[id] = [p[0], p[1]]; });
    return m;
  };
  const shown = (pos) => data.items.map((it) => (pos[it.id] ? { ...it, x: pos[it.id][0], y: pos[it.id][1] } : it));
  // 장면 s 에서 보이는지: from(이 장면부터) · until(이 장면까지) · hide(이 장면만 숨김)
  const visIn = (it, s) => s >= (it.from || 0) && (it.until == null || s <= it.until) && !(it.hide || []).includes(s);
  // 장면을 끼워넣거나(+1) 지울 때(-1) 장면 번호 맞추기
  const shiftScenes = (at, d) => data.items.forEach((it) => {
    if (d > 0) {
      if ((it.from || 0) >= at) it.from = (it.from || 0) + 1;
      if (it.until != null && it.until >= at) it.until += 1;
      if (it.hide) it.hide = it.hide.map((h) => (h >= at ? h + 1 : h));
    } else {
      if ((it.from || 0) > at) it.from -= 1;
      if (it.until != null && it.until >= at) it.until = Math.max(it.from || 0, it.until - 1);
      if (it.hide) it.hide = it.hide.filter((h) => h !== at).map((h) => (h > at ? h - 1 : h));
    }
    if (!it.from) delete it.from;
    if (it.hide && !it.hide.length) delete it.hide;
  });
  const arrowsIn = (s) => data.items.filter((x) => x.k === 'arrow' && (x.from || 0) === s && visIn(x, s));

  function render() {
    data.items.forEach((it) => { it.id ||= newId(); });
    const { w, h } = data.field;
    const u = unit();
    const T = THEME[data.field.color] || THEME.dark;
    const m = margin();
    vertical = isVertical(data.field.type);
    svg.setAttribute('viewBox', vertical ? `${-m} ${-m} ${h + 2 * m} ${w + 2 * m}` : `${-m} ${-m} ${w + 2 * m} ${h + 2 * m}`);
    svg.style.background = data.field.type === 'custom' ? T.bg : T.out;
    svg.classList.toggle('vert', vertical);
    svg.innerHTML = '';
    // 화살촉: 색마다 하나씩
    const defs = el('defs', {}, svg);
    const marks = new Map();
    const mkFor = (c) => {
      if (!marks.has(c)) {
        const id = `${mk}-${marks.size}`;
        marks.set(c, id);
        defs.insertAdjacentHTML('beforeend', `<marker id="${id}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`);
      }
      return marks.get(c);
    };
    world = el('g', vertical ? { transform: `matrix(0 -1 1 0 0 ${w})` } : {}, svg);
    drawField(el('g', {}, world), data, T, u);
    const pos = anim ? anim.pos : posAt(scene);
    const sc = anim ? anim.scene : scene;
    const list = shown(pos);
    // 이전 장면에서 움직인 길 (점선)
    if (!anim && scene > 0) {
      const prev = posAt(scene - 1);
      const gl = el('g', { class: 'ghosts' }, world);
      const orderUsed = Object.values(data.stepOrder?.[scene - 1] || {}).some((v) => v > 1) || data.items.some((x) => x.k === 'arrow' && (x.order || 1) > 1);
      Object.entries(pos).forEach(([id, [x, y]]) => {
        const q = prev[id];
        if (!q || (q[0] === x && q[1] === y)) return;
        const st = data.steps[scene - 1]?.[id];
        const c = st && st.length > 2 ? { x: st[2], y: st[3] } : { x: (q[0] + x) / 2, y: (q[1] + y) / 2 };
        el('path', { d: `M ${q[0]} ${q[1]} Q ${c.x} ${c.y} ${x} ${y}`, fill: 'none', stroke: '#ffd400', 'stroke-width': 0.35 * u, 'stroke-dasharray': `${u} ${u * 0.7}`, opacity: 0.7 }, gl);
        el('circle', { cx: q[0], cy: q[1], r: 1.4 * u, fill: editable ? 'rgba(255,212,0,.12)' : 'none', stroke: '#ffd400', 'stroke-width': 0.3 * u, opacity: 0.8, ...(editable ? { 'data-gs': id, class: 'ghost-s' } : {}) }, gl);
        if (editable) {
          const m = { x: 0.25 * q[0] + 0.5 * c.x + 0.25 * x, y: 0.25 * q[1] + 0.5 * c.y + 0.25 * y };
          const on = ordOf(scene - 1, id);
          el('circle', { cx: m.x, cy: m.y, r: (orderUsed ? 1.2 : 0.85) * u, fill: '#fff', stroke: '#ffd400', 'stroke-width': 0.35 * u, 'data-gh': id, class: 'ghost-h' }, gl);
          if (orderUsed) { const t = el('text', { x: m.x, y: m.y + 0.5 * u, 'text-anchor': 'middle', 'font-size': 1.45 * u, 'font-weight': 900, fill: '#000', 'pointer-events': 'none', transform: upright(m.x, m.y) }, gl); t.textContent = on; }
        }
      });
    }
    const layer = el('g', {}, world);
    // 그리는 순서: 영역 → 화살표 → 장비 → 선수 → 공 → 글자
    const order = { zone: 0, ladder: 0.5, vision: 0.8, arrow: 1, cone: 2, marker: 2, gmarker: 2, pole: 2, hurdle: 2, gymball: 2, bosu: 2, minigoal: 2, goal: 2, player: 3, ball: 4, text: 5 };
    const badges = editable && data.items.some((x) => x.k === 'arrow' && (x.order || 1) > 1);
    const zOf = (x) => (x.z != null ? x.z : order[x.k] ?? 2);
    list.map((it, i) => [it, i]).sort((a, b) => zOf(a[0]) - zOf(b[0]))
      .forEach(([it, i]) => {
        const op = anim?.vis?.[it.id] ?? (visIn(data.items[i], sc) ? 1 : 0);
        if (op <= 0) return;
        const who = it.k === 'vision' && it.who && pos[it.who] ? { x: pos[it.who][0], y: pos[it.who][1] } : null;
        drawItem(layer, it, i, T, u, editable && !anim && (i === sel || extra.has(data.items[i])), mkFor, {
          op, prog: anim?.prog?.[it.id], badge: badges && it.k === 'arrow', origin: who,
        });
      });
    vertical = false;
    if (editable) syncUi();
    drawMotion();
  }

  // ───────── 움직임 바 ─────────
  const mbar = document.createElement('div');
  mbar.className = 'pad-motion';
  container.appendChild(mbar);
  if (!editable) mbar.classList.add('view');
  const hasMotion = () => data.steps.length > 0 || data.items.some((x) => x.k === 'arrow');
  function drawMotion() {
    if (!editable) {
      mbar.hidden = !(play && hasMotion());
      if (mbar.hidden) return;
      mbar.innerHTML = `<button type="button" class="chip on" data-play>${anim ? '■ 멈춤' : '▶ 움직임 보기'}</button>
        <span class="pm-dots">${[0, ...data.steps].map((_, k) => `<i class="${k === scene && !anim ? 'on' : ''}"></i>`).join('')}</span>`;
    } else {
      if (!motion) { mbar.hidden = true; return; }
      const n = data.steps.length + 1;
      mbar.innerHTML = `<b>🎬 움직임</b>
        <span class="pm-scenes">${Array.from({ length: n }, (_, k) => `<button type="button" class="chip ${k === scene ? 'on' : ''}" data-sc="${k}">장면 ${k + 1}</button>`).join('')}
        <button type="button" class="chip" data-addsc>+ 장면</button></span>
        ${hasMotion() ? `<button type="button" class="chip" data-play>${anim ? '■ 멈춤' : '▶ 재생'}</button>` : ''}
        ${scene > 0 ? '<button type="button" class="chip" data-delsc>이 장면 삭제</button>' : ''}
        <small class="muted">${n === 1 ? '<b>+ 장면</b>을 누르고 선수 · 공 · 기구를 끌어서 옮기면 ▶ 재생할 때 그 자리로 움직여요' : scene > 0 ? `장면 ${scene + 1}: 끌어서 옮겨요 · <b>노란 점선 가운데 흰 점</b>을 끌면 곡선으로 움직여요(더블클릭하면 직선) · 여기서 지우면 이 장면에서만 지워져요` : '장면 1: 처음 위치예요'}</small>`;
      mbar.querySelectorAll('[data-sc]').forEach((b) => (b.onclick = () => { stop(); scene = +b.dataset.sc; sel = -1; render(); }));
      mbar.querySelector('[data-addsc]').onclick = () => { stop(); snapshot(); data.steps.splice(scene, 0, {}); if (data.stepOrder) data.stepOrder.splice(scene, 0, {}); shiftScenes(scene + 1, 1); scene += 1; sel = -1; extra.clear(); render(); };
      mbar.querySelector('[data-delsc]')?.addEventListener('click', () => {
        stop(); snapshot();
        // 이 장면에서만 있던 것(이 장면부터 시작해서 이 장면에서 끝나는 화살표 등)은 같이 지움
        data.items = data.items.filter((x) => !((x.from || 0) === scene && x.until === scene));
        data.steps.splice(scene - 1, 1); data.stepOrder?.splice(scene - 1, 1); shiftScenes(scene, -1); scene -= 1; sel = -1; extra.clear(); render();
      });
    }
    mbar.querySelector('[data-play]')?.addEventListener('click', () => (anim ? (stop(), render()) : playAll()));
  }
  function stop() { cancelAnimationFrame(raf); anim = null; }
  // 장면 s → s+1 로 옮긴 것의 순서 (1 먼저 · 2 다음 · 3 마지막), data.stepOrder[s] = { 아이템id: 순서 }
  const ordOf = (s0, id) => data.stepOrder?.[s0]?.[id] || 1;
  const movedIn = (s0) => Object.keys(data.steps[s0] || {}).filter((id) => {
    const a = posAt(s0)[id]; const b = posAt(s0 + 1)[id];
    return a && b && (a[0] !== b[0] || a[1] !== b[1]);
  });
  function playAll() {
    const N = data.steps.length;
    const P = Array.from({ length: N + 1 }, (_, k) => posAt(k));
    // 시간표: 장면마다 ① 화살표가 순서대로 끝까지 그어지고 → ② 옮긴 선수 · 공 · 기구가 순서대로 움직이고 → ③ 다음 장면으로 바뀜
    const segs = [];
    for (let s0 = 0; s0 <= N; s0++) {
      const arrO = [...new Set(arrowsIn(s0).map((x) => x.order || 1))].sort((a, b) => a - b);
      const moved = s0 < N ? movedIn(s0) : [];
      const movO = [...new Set(moved.map((id) => ordOf(s0, id)))].sort((a, b) => a - b);
      arrO.forEach((o) => segs.push({ s: s0, kind: 'draw', o, moved, dur: 1000 }, { s: s0, kind: 'draw', o, hold: true, moved, dur: 250 }));
      movO.forEach((o) => segs.push({ s: s0, kind: 'move', o, moved, dur: 1150 }, { s: s0, kind: 'move', o, hold: true, moved, dur: 200 }));
      if (s0 < N) segs.push({ s: s0, kind: 'switch', moved, dur: 350 });
    }
    if (!segs.length) return;
    const total = segs.reduce((a, x) => a + x.dur, 0);
    const frameAt = (t) => {
      let acc = 0; let cur = segs[segs.length - 1]; let f = 1;
      for (const sg of segs) { if (t < acc + sg.dur) { cur = sg; f = (t - acc) / sg.dur; break; } acc += sg.dur; }
      const { s: s0, kind, o } = cur;
      const e = cur.hold ? 1 : ease(Math.min(1, f));
      const pos = { ...P[s0] };
      const prog = {};
      arrowsIn(s0).forEach((x) => {
        const xo = x.order || 1;
        prog[x.id] = kind !== 'draw' ? 1 : xo < o ? 1 : xo === o ? e : 0;
      });
      cur.moved.forEach((id) => {
        const a0 = P[s0][id]; const b0 = P[s0 + 1][id];
        if (kind === 'draw') return; // 화살표가 다 그어지기 전엔 제자리
        if (kind === 'switch') { pos[id] = b0; return; }
        const mo = ordOf(s0, id);
        if (mo < o) { pos[id] = b0; return; }
        if (mo > o) return;
        const st = data.steps[s0]?.[id];
        if (st && st.length > 2) { const u2 = 1 - e; pos[id] = [u2 * u2 * a0[0] + 2 * u2 * e * st[2] + e * e * b0[0], u2 * u2 * a0[1] + 2 * u2 * e * st[3] + e * e * b0[1]]; } // 노란 점선을 휘어 둔 곡선
        else pos[id] = [a0[0] + (b0[0] - a0[0]) * e, a0[1] + (b0[1] - a0[1]) * e];
      });
      // 다음 장면으로 바뀔 때: 이 장면에만 있던 화살표 등은 흐려지고, 다음 장면 것은 나타남
      let vis = null;
      if (kind === 'switch') {
        vis = {};
        data.items.forEach((it) => {
          const va = visIn(it, s0); const vb = visIn(it, s0 + 1);
          if (!va && it.k === 'arrow' && (it.from || 0) === s0 + 1) { vis[it.id] = 0; return; } // 다음 장면 화살표는 다음 장면에서 그어지며 나타남
          vis[it.id] = va && vb ? 1 : va ? 1 - e : vb ? e : 0;
        });
      }
      return { pos, prog, vis, scene: s0 };
    };
    const t0 = performance.now();
    const tick = (now) => {
      if (!svg.isConnected) { stop(); return; }
      const t = Math.max(0, now - t0);
      if (t >= total) { anim = null; scene = N; render(); return; }
      anim = frameAt(t);
      render();
      raf = requestAnimationFrame(tick);
    };
    sel = -1; extra.clear();
    anim = frameAt(0);
    raf = requestAnimationFrame(tick);
  }

  function syncUi() {
    const f = data.field;
    container.querySelector('[data-ft]').value = f.type;
    container.querySelector('[data-fw]').value = f.w;
    container.querySelector('[data-fh]').value = f.h;
    container.querySelector('[data-fw]').disabled = container.querySelector('[data-fh]').disabled = f.type !== 'custom';
    container.querySelector('[data-fc]').value = f.color;
    container.querySelector('[data-gp]').value = data.grid.preset;
    container.querySelector('[data-gc]').value = data.grid.cols;
    container.querySelector('[data-gr]').value = data.grid.rows;
    container.querySelector('[data-gsize]').hidden = data.grid.preset !== 'custom';
    container.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
    container.querySelectorAll('[data-grp]').forEach((g) => {
      const [l, ic, ks] = TOOL_GROUPS[+g.dataset.grp];
      const on = ks.includes(tool);
      g.querySelector('[data-gbtn]').classList.toggle('on', on);
      g.querySelector('[data-gbtn] b').textContent = on ? TOOL_INFO[tool].ic : ic;
      g.querySelector('[data-glabel]').textContent = on ? TOOL_INFO[tool].l : l;
    });
    container.querySelectorAll('[data-team]').forEach((b) => b.classList.toggle('on', b.dataset.team === team));
    container.querySelector('[data-teams]').hidden = tool !== 'player';
    const s = items()[sel];
    container.querySelector('[data-act="rotate"]').hidden = !(s && ROTATABLE.includes(s.k));
    const multiScene = data.steps.length > 0;
    container.querySelector('[data-act="delete"]').hidden = !s;
    container.querySelector('[data-act="delete"]').textContent = multiScene ? `장면 ${scene + 1} 삭제` : '삭제';
    container.querySelector('[data-act="delall"]').hidden = !(s && multiScene);
    ['front', 'back'].forEach((k) => { container.querySelector(`[data-act="${k}"]`).hidden = !s; });
    container.querySelector('[data-act="unmove"]').hidden = !(s && scene > 0 && selected().some((x) => data.steps[scene - 1]?.[x.id]));
    const canSize = s && s.k !== 'zone';
    container.querySelector('[data-size]').hidden = !(canSize || (tool !== 'select' && !tool.startsWith('zone')));
    const szin = container.querySelector('[data-szin]');
    if (document.activeElement !== szin) szin.value = Math.round((canSize ? s.s || 1 : curSize()) * 100);
    // 색: 고른 것(또는 지금 도구)이 색을 바꿀 수 있을 때
    const colorTool = COLORABLE.includes(kindOf(tool === 'zone-dash' ? 'zone' : tool));
    const colSel = selected().some((x) => COLORABLE.includes(x.k));
    container.querySelector('[data-colors]').hidden = !(colorTool || colSel);
    const curCol = colSel ? (selected().find((x) => COLORABLE.includes(x.k)).c || '') : ccol;
    container.querySelectorAll('[data-col]').forEach((b) => b.classList.toggle('on', b.dataset.col === curCol));
    const movedHere = s && scene > 0 && data.steps[scene - 1]?.[s.id];
    container.querySelector('[data-order]').hidden = !(s && (s.k === 'arrow' || movedHere));
    const curOrd = s?.k === 'arrow' ? (s.order || 1) : movedHere ? ordOf(scene - 1, s.id) : 0;
    // 선수 번호 고치기 (선수 하나만 골랐을 때)
    const onePlayer = s && s.k === 'player' && !extra.size;
    container.querySelector('[data-pnum]').hidden = !onePlayer;
    const pnin = container.querySelector('[data-pnin]');
    if (onePlayer && document.activeElement !== pnin) pnin.value = s.n ?? '';
    const ordin = container.querySelector('[data-ordin]');
    if (document.activeElement !== ordin) ordin.value = curOrd || 1;
    container.querySelector('[data-straight]').hidden = !(s?.k === 'arrow' && s.cx != null);
    container.querySelector('[data-spread]').hidden = !(s && s.k === 'vision');
    container.querySelectorAll('[data-sp]').forEach((b) => b.classList.toggle('on', s?.k === 'vision' && +b.dataset.sp === (s.spread || 50)));
    const selbar = container.querySelector('[data-selbar]');
    selbar.querySelectorAll('.pad-grp').forEach((g) => { g.hidden = ![...g.children].some((c) => !c.hidden); });
    selbar.hidden = ![...selbar.children].some((c) => !c.hidden);
    container.querySelector('[data-hint]').textContent = {
      select: '끌어서 이동 · Ctrl(⌘)+클릭 여러 개 · Ctrl+C/V 복사·붙여넣기 · Ctrl+Z 되돌리기 · Delete 삭제 · +/- 크기 · 더블클릭 번호 수정',
      player: '필드를 누르면 선수가 놓입니다 (번호 자동) · Enter 키로 선택·이동',
      zone: '끌어서 영역 그리기', 'zone-dash': '끌어서 영역 그리기',
      pass: '끌어서 화살표 · 고른 뒤 가운데 흰 점을 끌면 곡선', run: '끌어서 화살표 · 고른 뒤 가운데 흰 점을 끌면 곡선', dribble: '끌어서 화살표 · 고른 뒤 가운데 흰 점을 끌면 곡선',
      vision: '선수를 누른 채 바라보는 쪽으로 끌어요 → V 모양 시야 (선수를 따라다녀요)',
      text: '필드를 누르고 글자 입력',
    }[tool] || '필드를 누르면 놓입니다 · Enter 키로 선택·이동';
  }

  render();
  // 바깥에서 재생 (보여주기 화면의 Space · Enter · → 키)
  const api = {
    getData: () => clone(data),
    hasMotion: () => hasMotion(),
    play: () => { if (!hasMotion()) return false; stop(); scene = 0; playAll(); return true; },
    reset: () => { stop(); scene = 0; render(); },
  };
  if (!editable) return api;

  // ───────── 필드 · 그리드 설정 ─────────
  const resize = (nw, nh) => {
    const { w, h } = data.field;
    const sx = nw / w;
    const sy = nh / h;
    data.items.forEach((it) => {
      if ('x' in it) { it.x = round(it.x * sx); it.y = round(it.y * sy); }
      if (it.k === 'zone') { it.w = round(it.w * sx); it.h = round(it.h * sy); }
      if (it.k === 'arrow') {
        it.x1 = round(it.x1 * sx); it.y1 = round(it.y1 * sy); it.x2 = round(it.x2 * sx); it.y2 = round(it.y2 * sy);
        if (it.cx != null) { it.cx = round(it.cx * sx); it.cy = round(it.cy * sy); }
      }
      if (it.k === 'vision' && it.len) it.len = round(it.len * (sx + sy) / 2);
    });
    data.steps.forEach((st) => Object.values(st).forEach((p) => { p[0] = round(p[0] * sx); p[1] = round(p[1] * sy); if (p.length > 2) { p[2] = round(p[2] * sx); p[3] = round(p[3] * sy); } }));
    data.field.w = nw;
    data.field.h = nh;
  };
  container.querySelector('[data-ft]').onchange = (e) => {
    snapshot();
    const f = FIELDS[e.target.value];
    data.field.type = e.target.value;
    resize(f.w, f.h);
    render();
  };
  const sizeInput = () => {
    const nw = Math.min(120, Math.max(5, +container.querySelector('[data-fw]').value || data.field.w));
    const nh = Math.min(90, Math.max(5, +container.querySelector('[data-fh]').value || data.field.h));
    snapshot();
    resize(nw, nh);
    render();
  };
  container.querySelector('[data-fw]').onchange = sizeInput;
  container.querySelector('[data-fh]').onchange = sizeInput;
  container.querySelector('[data-fc]').onchange = (e) => { snapshot(); data.field.color = e.target.value; render(); };
  container.querySelector('[data-gp]').onchange = (e) => {
    snapshot();
    const p = e.target.value;
    data.grid.preset = p;
    if (p !== 'custom') [data.grid.cols, data.grid.rows] = GRID_PRESET[p];
    else if (!data.grid.cols && !data.grid.rows) [data.grid.cols, data.grid.rows] = [4, 4];
    render();
  };
  const gridInput = () => {
    snapshot();
    data.grid.cols = Math.min(12, Math.max(0, +container.querySelector('[data-gc]').value || 0));
    data.grid.rows = Math.min(12, Math.max(0, +container.querySelector('[data-gr]').value || 0));
    render();
  };
  container.querySelector('[data-gc]').onchange = gridInput;
  container.querySelector('[data-gr]').onchange = gridInput;
  container.querySelector('[data-form]').onchange = (e) => {
    const [tm, name] = e.target.value.split(':');
    e.target.value = '';
    if (!name) return;
    snapshot();
    data.items = data.items.filter((x) => !(x.k === 'player' && x.team === tm));
    data.items.push(...formationItems(name, tm, data.field.w, data.field.h, tm === 'b'));
    if (tm === 'a') data.formation = name;
    sel = -1;
    render();
  };

  // ───────── 도구 ─────────
  const closeMenus = () => container.querySelectorAll('.pgmenu').forEach((m) => { m.hidden = true; });
  container.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => { tool = b.dataset.tool; sel = -1; extra.clear(); closeMenus(); render(); }));
  container.querySelectorAll('[data-gbtn]').forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const m = b.nextElementSibling;
    const open = m.hidden;
    closeMenus();
    m.hidden = !open;
  }));
  document.addEventListener('click', (e) => { if (!container.contains(e.target) || !e.target.closest('.pgroup')) closeMenus(); });
  // ⛶ 크게: 전체 화면에서 편집 (Esc 로 돌아오기)
  const setFull = (on) => {
    container.classList.toggle('pad-full', on);
    container.querySelector('[data-flabel]').textContent = on ? '작게' : '크게';
    if (on && container.requestFullscreen && !document.fullscreenElement) container.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement === container) document.exitFullscreen().catch(() => {});
    render();
  };
  container.querySelector('[data-act="full"]').onclick = () => setFull(!container.classList.contains('pad-full'));
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && container.classList.contains('pad-full')) setFull(false); });
  container.querySelectorAll('[data-team]').forEach((b) => (b.onclick = () => { team = b.dataset.team; syncUi(); }));
  // 화살표에 붙은 이동(다음 장면 자리) 지우기
  const unlinkArrow = (x) => {
    const st = data.steps[x.from || 0];
    if (x.who && st?.[x.who] && st[x.who][0] === x.x2 && st[x.who][1] === x.y2) delete st[x.who];
  };
  const delAll = () => { // 모든 장면에서 삭제
    if (sel < 0) return;
    snapshot();
    const gone = new Set(selected());
    gone.forEach((x) => { if (x.k === 'arrow') unlinkArrow(x); });
    data.items = data.items.filter((x) => !gone.has(x) && !(x.k === 'vision' && gone.has(data.items.find((p) => p.id === x.who))));
    sel = -1; extra.clear();
    render();
  };
  const del = () => { // 장면이 여러 개면 지금 장면에서만 숨김
    if (sel < 0) return;
    if (!data.steps.length) { delAll(); return; }
    snapshot();
    const gone = [];
    selected().forEach((x) => {
      const onlyHere = (x.from || 0) === scene && (x.until === scene || (scene === data.steps.length && (x.from || 0) === scene));
      if (onlyHere) gone.push(x);
      else x.hide = [...new Set([...(x.hide || []), scene])];
    });
    gone.forEach((x) => { if (x.k === 'arrow') unlinkArrow(x); });
    data.items = data.items.filter((x) => !gone.includes(x));
    sel = -1; extra.clear();
    render();
  };
  container.querySelector('[data-act="delall"]').onclick = delAll;
  // 맨 앞으로 · 맨 뒤로 (공과 선수가 겹칠 때 등)
  const KIND_Z = { zone: 0, ladder: 0.5, vision: 0.8, arrow: 1, player: 3, ball: 4, text: 5 };
  const zNow = (x) => (x.z != null ? x.z : KIND_Z[x.k] ?? 2);
  const toZ = (front) => {
    const list = selected();
    if (!list.length) return;
    snapshot();
    const zs = data.items.map(zNow);
    const top = Math.max(...zs); const bot = Math.min(...zs);
    list.forEach((x, i) => { x.z = front ? top + 1 + i * 0.01 : bot - 1 - i * 0.01; });
    render();
  };
  container.querySelector('[data-act="front"]').onclick = () => toZ(true);
  container.querySelector('[data-act="back"]').onclick = () => toZ(false);
  // 이 장면으로 옮긴 것을 되돌림 (앞 장면 자리 그대로)
  container.querySelector('[data-act="unmove"]').onclick = () => {
    const list = selected().filter((x) => data.steps[scene - 1]?.[x.id]);
    if (!list.length) return;
    snapshot();
    list.forEach((x) => { delete data.steps[scene - 1][x.id]; if (data.stepOrder?.[scene - 1]) delete data.stepOrder[scene - 1][x.id]; });
    render();
  };
  // 색
  container.querySelectorAll('[data-col]').forEach((b) => (b.onclick = () => {
    ccol = b.dataset.col;
    const list = selected().filter((x) => COLORABLE.includes(x.k));
    if (list.length) { snapshot(); list.forEach((x) => { if (ccol) x.c = ccol; else delete x.c; }); }
    render();
  }));
  // 화살표 순서 · 직선으로 · 시야 넓이
  // 선수 번호
  const pnIn = container.querySelector('[data-pnin]');
  pnIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); pnIn.blur(); } e.stopPropagation(); };
  pnIn.onchange = () => {
    const x = items()[sel];
    if (x?.k !== 'player') return;
    snapshot();
    x.n = pnIn.value.trim().slice(0, 4);
    render();
  };
  // 순서: 숫자로 (기본 1 = 다 같이 · 2로 바꾸면 그것만 두 번째로 …)
  const ordIn = container.querySelector('[data-ordin]');
  ordIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ordIn.blur(); } e.stopPropagation(); };
  ordIn.onchange = () => {
    const n = Math.min(20, Math.max(1, Math.round(+ordIn.value || 1)));
    const list = selected();
    if (!list.length) return;
    snapshot();
    list.forEach((x) => {
      if (x.k === 'arrow') { x.order = n; if (n === 1) delete x.order; return; }
      if (scene > 0 && data.steps[scene - 1]?.[x.id]) { // 이 장면으로 옮기는 순서
        data.stepOrder ||= [];
        while (data.stepOrder.length < data.steps.length) data.stepOrder.push({});
        if (n === 1) delete data.stepOrder[scene - 1][x.id]; else data.stepOrder[scene - 1][x.id] = n;
      }
    });
    render();
  };
  container.querySelector('[data-straight]').onclick = () => { const x = items()[sel]; if (x?.k !== 'arrow') return; snapshot(); delete x.cx; delete x.cy; render(); };
  container.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = () => {
    const list = selected().filter((x) => x.k === 'vision');
    if (!list.length) return;
    snapshot(); list.forEach((x) => { x.spread = +b.dataset.sp; }); render();
  }));
  // 크기 숫자 입력 (1~300%, Enter)
  container.querySelector('[data-szin]').onchange = (e) => {
    const v = Math.min(300, Math.max(1, Math.round(+e.target.value || 100))) / 100;
    const list = selected().filter((x) => x.k !== 'zone');
    if (list.length) { snapshot(); list.forEach((x) => { x.s = v; if (v === 1) delete x.s; sizes[x.k] = v; }); } else if (tool !== 'select') sizes[kindOf(tool)] = v;
    e.target.blur();
    render();
  };
  container.querySelector('[data-szin]').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.dispatchEvent(new Event('change')); } };
  container.querySelector('[data-act="delete"]').onclick = del;
  container.querySelector('[data-act="rotate"]').onclick = () => {
    const s = items()[sel];
    if (!s || !ROTATABLE.includes(s.k)) return;
    snapshot();
    s.rot = ((s.rot || 0) + 90) % 360;
    render();
  };
  const undo = () => {
    if (!history.length) return;
    stop();
    future.push(JSON.stringify(data));
    data = JSON.parse(history.pop());
    scene = Math.min(scene, data.steps.length);
    sel = -1; extra.clear();
    render();
  };
  const redo = () => {
    if (!future.length) return;
    stop();
    history.push(JSON.stringify(data));
    data = JSON.parse(future.pop());
    scene = Math.min(scene, data.steps.length);
    sel = -1; extra.clear();
    render();
  };
  container.querySelector('[data-act="undo"]').onclick = undo;
  // 복사 · 붙여넣기 · 모두 고르기
  const copy = () => { const list = selected(); if (list.length) clipboard = list.map((x) => { const c = clone(x); delete c.id; return c; }); return list.length; };
  const paste = () => {
    if (!clipboard?.length) return;
    snapshot();
    const off = 2 * unit();
    const added = clipboard.map((x) => {
      const c = clone(x);
      if ('x1' in c) { c.x1 = round(c.x1 + off); c.y1 = round(c.y1 + off); c.x2 = round(c.x2 + off); c.y2 = round(c.y2 + off); if (c.cx != null) { c.cx = round(c.cx + off); c.cy = round(c.cy + off); } } else { c.x = round(c.x + off); c.y = round(c.y + off); }
      if (c.k === 'player') c.n = nextNum(c.team);
      delete c.who; delete c.until; delete c.hide; // 붙여넣은 건 지금 장면부터 · 따로
      if (scene) c.from = scene; else delete c.from;
      return c;
    });
    data.items.push(...added);
    clipboard = clipboard.map((x) => { const c = clone(x); if ('x1' in c) { c.x1 += off; c.y1 += off; c.x2 += off; c.y2 += off; } else { c.x += off; c.y += off; } return c; }); // 또 붙이면 조금씩 비켜서
    tool = 'select';
    sel = data.items.indexOf(added[0]); extra.clear(); added.slice(1).forEach((x) => extra.add(x));
    render();
  };
  container.querySelector('[data-act="clear"]').onclick = () => { stop(); snapshot(); data.items = []; data.steps = []; scene = 0; sel = -1; extra.clear(); render(); };
  // 크기: 고른 것(없으면 지금 도구로 새로 놓을 것)을 한 단계씩
  const STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 1.8, 2.2, 2.6, 3];
  const step = (v, d) => { const i = STEPS.findIndex((x) => x >= v - 0.001); return STEPS[Math.max(0, Math.min(STEPS.length - 1, (i < 0 ? STEPS.length - 1 : i) + d))]; };
  const resizeSel = (d) => {
    const list = selected().filter((x) => x.k !== 'zone');
    if (list.length) {
      snapshot();
      list.forEach((s) => {
        s.s = step(s.s || 1, d);
        if (s.s === 1) delete s.s;
        sizes[s.k] = s.s || 1;
      });
    } else if (tool !== 'select') sizes[kindOf(tool)] = step(curSize(), d);
    render();
  };
  container.querySelectorAll('[data-sz]').forEach((b) => (b.onclick = () => resizeSel(+b.dataset.sz)));
  // 키보드 — Delete · Backspace 삭제, +/- 크기, Enter 선택·이동 (글 쓰는 칸에 있을 땐 무시)
  const onKey = (e) => {
    if (!svg.isConnected) { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onOut, true); return; }
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
    const mine = (!a || a === document.body || container.contains(a)) && activePad === padId;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    // Ctrl/⌘ + Z 되돌리기 · Shift+Z / Y 다시 · C 복사 · V 붙여넣기 · D 복제 · A 모두 고르기
    if (mod && mine && !e.isComposing) {
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); return; }
      if (key === 'c' && sel >= 0) { e.preventDefault(); copy(); return; }
      if (key === 'x' && sel >= 0) { e.preventDefault(); copy(); del(); return; }
      if (key === 'v' && clipboard?.length) { e.preventDefault(); paste(); return; }
      if (key === 'd' && sel >= 0) { e.preventDefault(); copy(); paste(); return; }
      if (e.key === ']' && sel >= 0) { e.preventDefault(); toZ(true); return; }
      if (e.key === '[' && sel >= 0) { e.preventDefault(); toZ(false); return; }
      if (key === 'a' && items().length) { e.preventDefault(); tool = 'select'; const vis = items().filter((x) => visIn(x, scene)); sel = items().indexOf(vis[0]); extra.clear(); vis.slice(1).forEach((x) => extra.add(x)); render(); return; }
    }
    if (e.key === 'Escape' && container.classList.contains('pad-full') && sel < 0) { setFull(false); return; }
    if (e.key === 'Escape' && mine && sel >= 0) { sel = -1; extra.clear(); render(); return; }
    if (!mine) return;
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault(); // 방금 누른 도구 버튼이 다시 눌리지 않게
      if (tool !== 'select') { tool = 'select'; render(); }
      return;
    }
    if (sel < 0) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); resizeSel(1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); resizeSel(-1); }
  };
  // 작전판 밖을 누르면 선택 풀기 (다른 작전판과 헷갈리지 않게)
  const onOut = (e) => { if (!svg.isConnected) return; if (container.contains(e.target)) { activePad = padId; return; } if (sel >= 0) { sel = -1; extra.clear(); render(); } };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onOut, true);

  // ───────── 포인터 ─────────
  const pt = (e) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(world.getScreenCTM().inverse());
    const { w, h } = data.field;
    const m = margin();
    return { x: round(Math.max(-m, Math.min(w + m, p.x))), y: round(Math.max(-m, Math.min(h + m, p.y))) };
  };
  let drag = null;
  // 지금 장면에서 p 에 가장 가까운 선수 · 공 (r × 크기 안)
  const nearest = (p, kinds, r) => {
    const pos = posAt(scene);
    let best = null;
    data.items.forEach((x) => {
      if (!kinds.includes(x.k) || !visIn(x, scene) || !pos[x.id]) return;
      const d = Math.hypot(pos[x.id][0] - p.x, pos[x.id][1] - p.y);
      if (d <= r * unit() * (x.s || 1) && (!best || d < best.d)) best = { it: x, p: pos[x.id], d };
    });
    return best;
  };
  const aimVision = (it, p) => {
    const o = it.who ? (posAt(scene)[it.who] || [it.x, it.y]) : [it.x, it.y];
    it.ang = Math.round((Math.atan2(p.y - o[1], p.x - o[0]) * 180) / Math.PI);
    it.len = round(Math.max(3 * unit(), Math.hypot(p.x - o[0], p.y - o[1])));
  };

  svg.addEventListener('pointerdown', (e) => {
    activePad = padId;
    if (anim) { stop(); render(); }
    svg.focus({ preventScroll: true });
    const p = pt(e);
    const gh = e.target.closest?.('[data-gh]');
    if (gh && scene > 0) {
      snapshot();
      drag = { ghost: gh.dataset.gh, start: p };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    // 노란 동그라미(이 장면으로 오기 전 시작 자리) 끌기 → 움직임을 더하지 않고 시작 자리만 바꿈
    const gs = e.target.closest?.('[data-gs]');
    if (gs && scene > 0) {
      snapshot();
      drag = { startPt: gs.dataset.gs, start: p };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    const g = e.target.closest('[data-i]');
    const handle = e.target.getAttribute('data-handle');

    // 고른 그림의 점(곡선 · 끝점 · 시야 방향)은 어떤 도구를 쥐고 있어도 바로 끌 수 있게
    if (tool === 'select' || (handle && g)) {
      if (!g) { sel = -1; extra.clear(); render(); return; }
      const i = +g.dataset.i;
      const hit = items()[i];
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        // 여러 개 고르기: 누를 때마다 넣었다 뺐다
        if (i === sel) { const nx = [...extra][0]; if (nx) { extra.delete(nx); sel = items().indexOf(nx); } else sel = -1; }
        else if (extra.has(hit)) extra.delete(hit);
        else { if (sel >= 0) extra.add(items()[sel]); sel = i; }
        render();
        return;
      }
      if (i !== sel && !extra.has(hit)) extra.clear(); // 고른 묶음 밖을 누르면 그것만
      else if (extra.has(hit)) { extra.delete(hit); if (sel >= 0) extra.add(items()[sel]); }
      sel = i;
      const it = items()[sel];
      snapshot();
      const group = handle ? [] : [...extra];
      if (scene > 0 && MOVABLE.includes(it.k) && !handle) {
        const pos = posAt(scene);
        const [x, y] = pos[it.id];
        drag = { it, start: p, orig: { x, y }, stepMove: true, group: group.filter((m) => MOVABLE.includes(m.k)).map((m) => ({ m, o: { x: pos[m.id][0], y: pos[m.id][1] } })) };
        svg.setPointerCapture(e.pointerId);
        render();
        return;
      }
      drag = { it, start: p, orig: clone(it), handle, group: group.map((m) => ({ m, o: clone(m) })), cow: scene > (it.from || 0) && (!MOVABLE.includes(it.k) || !!handle) };
      svg.setPointerCapture(e.pointerId);
      render();
      return;
    }
    snapshot();
    let it;
    if (tool === 'player') it = { k: 'player', team, n: nextNum(team), x: p.x, y: p.y };
    else if (EQUIP.includes(tool)) it = { k: tool, x: p.x, y: p.y };
    else if (tool === 'vision') {
      // 선수를 누르고 시작하면 그 선수를 따라다니는 시야
      const pl = nearest(p, ['player'], 3.2);
      const o = pl ? { x: pl.p[0], y: pl.p[1] } : p;
      it = { k: 'vision', x: o.x, y: o.y, ang: 0, len: 12 * unit(), spread: 50, ...(pl ? { who: pl.it.id } : {}) };
    }
    else if (tool === 'zone' || tool === 'zone-dash') it = { k: 'zone', style: tool === 'zone-dash' ? 'dash' : 'fill', x: p.x, y: p.y, w: 0, h: 0 };
    else if (['pass', 'run', 'dribble'].includes(tool)) it = { k: 'arrow', style: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    else if (tool === 'text') {
      const t = prompt('필드에 쓸 글자');
      if (!t) { history.pop(); return; }
      it = { k: 'text', t: t.slice(0, 30), x: p.x, y: p.y };
    }
    if (!it) return;
    if (it.k !== 'zone' && curSize() !== 1) it.s = curSize();
    if (scene) it.from = scene; // 지금 장면부터 보임
    if (ccol && COLORABLE.includes(it.k)) it.c = ccol;
    data.items.push(it);
    sel = data.items.length - 1; extra.clear();
    if (it.k === 'zone' || it.k === 'arrow' || it.k === 'vision') {
      drag = { it, start: p, creating: true };
      svg.setPointerCapture(e.pointerId);
    }
    render();
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = pt(e);
    if (drag.cow) {
      // 처음 움직일 때 나눔: 앞 장면들은 원래 것, 이 장면부터는 복사본을 고침
      drag.cow = false;
      const old = drag.it;
      const cp = clone(old);
      cp.id = newId();
      cp.from = scene;
      cp.hide = (old.hide || []).filter((h) => h >= scene);
      old.hide = (old.hide || []).filter((h) => h < scene);
      if (!cp.hide.length) delete cp.hide;
      if (!old.hide.length) delete old.hide;
      old.until = scene - 1;
      data.items.push(cp);
      drag.it = cp;
      sel = data.items.length - 1;
      extra.clear(); drag.group = [];
    }
    if (drag.startPt) {
      const id = drag.startPt;
      const xy = [round(p.x), round(p.y)];
      if (scene - 1 === 0) { const it0 = data.items.find((x) => x.id === id); if (it0) { it0.x = xy[0]; it0.y = xy[1]; } } else {
        const old = data.steps[scene - 2][id];
        data.steps[scene - 2][id] = old?.length > 2 ? [...xy, old[2], old[3]] : xy;
      }
      render();
      return;
    }
    if (drag.ghost) {
      // 끈 점을 곡선이 지나가도록 조절점 계산 (이전 장면 자리 → 이 장면 자리)
      const id = drag.ghost;
      const q = posAt(scene - 1)[id]; const b = posAt(scene)[id];
      const st = data.steps[scene - 1][id];
      data.steps[scene - 1][id] = [st[0], st[1], round(2 * p.x - (q[0] + b[0]) / 2), round(2 * p.y - (q[1] + b[1]) / 2)];
      render();
      return;
    }
    const { it, start, orig, handle } = drag;
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (drag.stepMove) {
      const keepC = (id, xy) => { const old = data.steps[scene - 1][id]; data.steps[scene - 1][id] = old?.length > 2 ? [...xy, old[2], old[3]] : xy; };
      keepC(it.id, [round(orig.x + dx), round(orig.y + dy)]);
      drag.group?.forEach(({ m, o }) => keepC(m.id, [round(o.x + dx), round(o.y + dy)]));
    } else if (drag.creating) {
      if (it.k === 'zone') {
        it.x = Math.min(start.x, p.x); it.y = Math.min(start.y, p.y);
        it.w = round(Math.abs(dx)); it.h = round(Math.abs(dy));
      } else if (it.k === 'vision') aimVision(it, p);
      else { it.x2 = p.x; it.y2 = p.y; }
    } else if (handle === 'size') {
      it.w = round(Math.max(1, orig.w + dx)); it.h = round(Math.max(1, orig.h + dy));
    } else if (handle === 'p1') { it.x1 = p.x; it.y1 = p.y; } else if (handle === 'p2') { it.x2 = p.x; it.y2 = p.y; } else if (handle === 'pc') {
      // 끈 점을 곡선이 지나가도록 조절점 계산
      it.cx = round(2 * p.x - (it.x1 + it.x2) / 2); it.cy = round(2 * p.y - (it.y1 + it.y2) / 2);
    } else if (handle === 'vh') aimVision(it, p);
    else if (it.k === 'arrow') {
      it.x1 = round(orig.x1 + dx); it.y1 = round(orig.y1 + dy); it.x2 = round(orig.x2 + dx); it.y2 = round(orig.y2 + dy);
      if (orig.cx != null) { it.cx = round(orig.cx + dx); it.cy = round(orig.cy + dy); }
    } else if (it.k === 'vision' && it.who) { /* 선수에 붙은 시야는 선수를 따라감 */ } else { it.x = round(orig.x + dx); it.y = round(orig.y + dy); }
    // 함께 고른 것들도 같이 옮기기
    if (!drag.stepMove && !drag.creating && !handle) {
      drag.group?.forEach(({ m, o }) => {
        if (m.k === 'arrow') { m.x1 = round(o.x1 + dx); m.y1 = round(o.y1 + dy); m.x2 = round(o.x2 + dx); m.y2 = round(o.y2 + dy); if (o.cx != null) { m.cx = round(o.cx + dx); m.cy = round(o.cy + dy); } } else if (!(m.k === 'vision' && m.who)) { m.x = round(o.x + dx); m.y = round(o.y + dy); }
      });
    }
    render();
  });

  const end = () => {
    if (!drag) return;
    if (drag.ghost || drag.startPt) { drag = null; render(); return; }
    const { it, creating } = drag;
    const u = unit();
    // 너무 작게 그려진 영역/화살표는 취소
    if (creating && ((it.k === 'zone' && (it.w < u || it.h < u)) || (it.k === 'arrow' && Math.hypot(it.x2 - it.x1, it.y2 - it.y1) < 1.5 * u))) {
      data.items.splice(data.items.indexOf(it), 1);
      history.pop();
      sel = -1;
    } else if (drag.stepMove) {
      const q = data.steps[scene - 1][it.id];
      if (!q || (q[0] === drag.orig.x && q[1] === drag.orig.y)) history.pop();
    } else if (!creating && JSON.stringify(it) === JSON.stringify(drag.orig)) {
      history.pop(); // 클릭만 하고 안 움직임
    }
    // 옮긴 선수 · 공에 붙은 화살표 맞추기: 이 장면에서 시작하는 화살표는 시작점, 앞 장면에서 온 화살표는 끝점
    if (!creating && MOVABLE.includes(it.k) && it.k !== 'vision') {
      const pos = posAt(scene)[it.id];
      if (pos) {
        data.items.forEach((a) => {
          if (a.k !== 'arrow' || a.who !== it.id) return;
          if ((a.from || 0) === scene) { a.x1 = pos[0]; a.y1 = pos[1]; }
          if ((a.from || 0) === scene - 1) { a.x2 = pos[0]; a.y2 = pos[1]; }
        });
      }
    }
    drag = null;
    render();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  svg.addEventListener('dblclick', (e) => {
    const gh = e.target.closest?.('[data-gh]');
    if (gh && scene > 0) { const st = data.steps[scene - 1][gh.dataset.gh]; if (st?.length > 2) { snapshot(); data.steps[scene - 1][gh.dataset.gh] = [st[0], st[1]]; render(); } return; }
    const g = e.target.closest('[data-i]');
    if (!g) return;
    const it = items()[+g.dataset.i];
    if (it.k === 'player') {
      const v = prompt('번호 또는 이름 (짧게)', it.n);
      if (v !== null) { snapshot(); it.n = v.slice(0, 4); render(); }
    } else if (it.k === 'text') {
      const v = prompt('글자 수정', it.t);
      if (v) { snapshot(); it.t = v.slice(0, 30); render(); }
    }
  });

  return api;
}
