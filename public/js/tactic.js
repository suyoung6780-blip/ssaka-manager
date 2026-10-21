// 텍티컬 패드 v2 — 필드(종류·크기·색) · 그리드 · 선수/콘/골대/영역/화살표/텍스트를 배치하고 JSON 으로 저장
// 좌표 단위는 미터. 예전(v1: home/away/ball/arrows) 데이터도 자동 변환해서 그대로 열린다.
const NS = 'http://www.w3.org/2000/svg';
// 손가락으로 쓰는 화면(휴대폰 · 태블릿): 손잡이 · 누르는 범위를 크게
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const isPhone = () => COARSE || (typeof innerWidth === 'number' && innerWidth <= 900);

export const FORMATIONS = {
  '4-4-2': [[5, 34], [20, 10], [18, 26], [18, 42], [20, 58], [38, 10], [36, 27], [36, 41], [38, 58], [50, 27], [50, 41]],
  '4-3-3': [[5, 34], [20, 10], [18, 26], [18, 42], [20, 58], [33, 34], [38, 22], [38, 46], [50, 12], [52, 34], [50, 56]],
  '4-2-3-1': [[5, 34], [20, 10], [18, 26], [18, 42], [20, 58], [30, 27], [30, 41], [40, 14], [40, 34], [40, 54], [51, 34]],
  '3-5-2': [[5, 34], [18, 20], [17, 34], [18, 48], [34, 8], [32, 26], [30, 34], [32, 42], [34, 60], [50, 27], [50, 41]],
  '3-4-3': [[5, 34], [18, 20], [17, 34], [18, 48], [34, 10], [32, 27], [32, 41], [34, 58], [48, 14], [52, 34], [48, 54]],
  // 8대8 (골키퍼 + 7명)
  '3-3-1': [[5, 34], [19, 16], [17, 34], [19, 52], [34, 12], [32, 34], [34, 56], [49, 34]],
  '3-2-2': [[5, 34], [19, 16], [17, 34], [19, 52], [32, 25], [32, 43], [48, 24], [48, 44]],
  '2-3-2': [[5, 34], [18, 24], [18, 44], [33, 12], [31, 34], [33, 56], [48, 24], [48, 44]],
  '3-1-3': [[5, 34], [19, 16], [17, 34], [19, 52], [30, 34], [45, 12], [49, 34], [45, 56]],
  '2-4-1': [[5, 34], [18, 24], [18, 44], [33, 10], [31, 27], [31, 41], [33, 58], [49, 34]],
};
export const is8 = (name) => FORMATIONS[name]?.length === 8;
const formOpts = (tm, eight) => Object.keys(FORMATIONS).filter((f) => is8(f) === eight).map((f) => `<option value="${tm}:${f}">${tm.toUpperCase()} · ${f}</option>`).join('');

export const FIELDS = {
  full: { label: '풀코트', w: 105, h: 68 },
  half: { label: '하프코트', w: 52.5, h: 68 },
  box: { label: '페널티박스 주변', w: 36, h: 50 },
  custom: { label: '직접 설정 (그리드 훈련장)', w: 30, h: 20 },
};
const GRIDS = { none: '그리드 없음', '3x3': '3×3 존', lanes5: '5레인', zones18: '18존 (6×3)', custom: '칸 수 직접 설정', meter: '칸 크기(m) 직접 설정' };
const GRID_PRESET = { none: [0, 0], '3x3': [3, 3], lanes5: [0, 5], zones18: [6, 3] };
const COLORS = { dark: '다크', green: '잔디', white: '화이트' };
export const TEAMS = {
  a: { label: 'A', fill: '#ffffff', text: '#000000', stroke: '#000000' },
  b: { label: 'B', fill: '#151515', text: '#ffffff', stroke: '#ffffff' },
  c: { label: 'C', fill: '#e5484d', text: '#ffffff', stroke: '#7a1c1f' },
  d: { label: 'D', fill: '#3b82f6', text: '#ffffff', stroke: '#173a75' },
  e: { label: 'E', fill: '#22c55e', text: '#000000', stroke: '#0f5a2a' },
  f: { label: 'F', fill: '#f97316', text: '#ffffff', stroke: '#7a3609' },
  g: { label: 'G', fill: '#8b5cf6', text: '#ffffff', stroke: '#3d2380' },
  h: { label: 'H', fill: '#38bdf8', text: '#000000', stroke: '#0b5a7a' },
  i: { label: 'I', fill: '#ec4899', text: '#ffffff', stroke: '#7a1f4c' },
  k: { label: 'K', fill: '#8a8a8a', text: '#ffffff', stroke: '#3a3a3a' },
  j: { label: '중립', fill: '#f5c400', text: '#000000', stroke: '#6b5600' }, // 예전 '조커' (같은 색)
  s: { label: '서브', fill: '#94a3b8', text: '#0b1220', stroke: '#334155' },
  t: { label: '타겟', fill: '#14b8a6', text: '#ffffff', stroke: '#0b5e55' },
  x: { label: '코치', fill: '#111827', text: '#f5c400', stroke: '#f5c400' },
};
// 중립 · 서브 · 타겟 · 코치: 선수와 따로 놓는 역할 표시 (N · S · T · C)
const ROLES = { n: { team: 'j', t: 'N', l: '중립' }, s: { team: 's', t: 'S', l: '서브' }, t: { team: 't', t: 'T', l: '타겟' }, c: { team: 'x', t: 'C', l: '코치' } };
const ROLE_TEAMS = ['j', 's', 't', 'x']; // 선수 팀 색 목록에서는 뺌
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

  // 경기장을 표준(105×68)보다 작게 정하면 박스 · 센터서클도 같이 줄임 (8인제 · 소형 경기장)
  const std = type === 'full' ? [105, 68] : type === 'half' ? [52.5, 68] : [36, 50];
  const k = Math.min(1, w / std[0], h / std[1]);
  const goalEnd = (x, dir) => {
    const cy = h / 2;
    el('rect', { x: dir > 0 ? x : x - 16.5 * k, y: cy - 20.16 * k, width: 16.5 * k, height: 40.32 * k }, L);
    el('rect', { x: dir > 0 ? x : x - 5.5 * k, y: cy - 9.16 * k, width: 5.5 * k, height: 18.32 * k }, L);
    el('circle', { cx: x + dir * 11 * k, cy, r: sw * 1.4, fill: T.line, stroke: 'none' }, L);
    el('path', { d: `M ${x + dir * 16.5 * k} ${cy - 7.3 * k} A ${9.15 * k} ${9.15 * k} 0 0 ${dir > 0 ? 1 : 0} ${x + dir * 16.5 * k} ${cy + 7.3 * k}` }, L);
    el('rect', { x: dir > 0 ? x - 2 * k : x, y: cy - 3.66 * k, width: 2 * k, height: 7.32 * k }, L);
  };

  if (type === 'full') {
    el('line', { x1: w / 2, y1: 0, x2: w / 2, y2: h }, L);
    el('circle', { cx: w / 2, cy: h / 2, r: 9.15 * k }, L);
    el('circle', { cx: w / 2, cy: h / 2, r: sw * 1.4, fill: T.line, stroke: 'none' }, L);
    goalEnd(0, 1);
    goalEnd(w, -1);
  } else if (type === 'half') {
    el('path', { d: `M 0 ${h / 2 - 9.15 * k} A ${9.15 * k} ${9.15 * k} 0 0 1 0 ${h / 2 + 9.15 * k}` }, L);
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
  if (d.grid.preset === 'meter' && d.grid.cw > 0 && d.grid.ch > 0) { // 칸 크기(m)로: 가로 cw m · 세로 ch m 마다 선
    for (let x = d.grid.cw; x < w - 0.01; x += d.grid.cw) el('line', { x1: x, y1: 0, x2: x, y2: h }, G);
    for (let y = d.grid.ch; y < h - 0.01; y += d.grid.ch) el('line', { x1: 0, y1: y, x2: w, y2: y }, G);
  } else {
    for (let i = 1; i < cols; i++) el('line', { x1: (w / cols) * i, y1: 0, x2: (w / cols) * i, y2: h }, G);
    for (let i = 1; i < rows; i++) el('line', { x1: 0, y1: (h / rows) * i, x2: w, y2: (h / rows) * i }, G);
  }
}


// 하프코트 · 페널티박스 주변은 골대가 위로 오게 세로로 그림 (좌표는 그대로, 화면만 돌림) — 글자는 다시 똑바로
let vertical = false;
export const isVertical = (type) => type === 'half' || type === 'box';
const upright = (x, y) => (vertical ? `rotate(90 ${x} ${y})` : '');

// 곡선: 시작 → 지나가는 점들 → 끝을 부드럽게 잇기 (Catmull-Rom). 점을 늘릴수록 더 자유롭게 휘고 길어짐 (사이드 스텝 · 지그재그)
const SEG = 14; // 점 사이마다 촘촘히 나눌 개수
function crPts(P) {
  if (P.length < 3) return P.map((p) => ({ x: p.x, y: p.y }));
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)]; const p1 = P[i]; const p2 = P[i + 1]; const p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < SEG; k++) {
      const t = k / SEG; const t2 = t * t; const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push({ x: P[P.length - 1].x, y: P[P.length - 1].y });
  return out;
}
const quadPts = (a, c, b, n = 28) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; const u = 1 - t; return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }; });
// 촘촘한 점들 → 길이 비율(0~1)로 위치 찾기 (속도 일정)
function sampler(pts) {
  const L = [0];
  for (let k = 1; k < pts.length; k++) L.push(L[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
  const tot = L[L.length - 1] || 1e-6;
  return (t) => {
    const want = Math.max(0, Math.min(1, t)) * tot;
    let k = 1; while (k < L.length - 1 && L[k] < want) k++;
    const f = (want - L[k - 1]) / Math.max(1e-6, L[k] - L[k - 1]);
    const a = pts[k - 1]; const b = pts[k] || a;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
}
// 화살표: 시작(x1,y1) · 지나가는 점 via[{x,y}] · 끝(x2,y2) — 예전 곡선(cx,cy)도 그대로 그림
const arrowCtl = (it) => [{ x: it.x1, y: it.y1 }, ...(it.via || []), { x: it.x2, y: it.y2 }];
function arrowDense(it) {
  if (it.via?.length) return crPts(arrowCtl(it));
  if (it.cx != null) return quadPts({ x: it.x1, y: it.y1 }, { x: it.cx, y: it.cy }, { x: it.x2, y: it.y2 });
  return [{ x: it.x1, y: it.y1 }, { x: it.x2, y: it.y2 }];
}
export function bez(it, t) { return sampler(arrowDense(it))(t); }
const bezPts = (it, upto = 1, n = 28) => { const f = sampler(arrowDense(it)); return Array.from({ length: n + 1 }, (_, i) => f((i / n) * upto)); };
// 점과 점 사이 가운데 (여기를 끌면 새 점이 생김)
function segMids(P) {
  if (P.length < 3) return [{ x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 }];
  const d = crPts(P);
  return Array.from({ length: P.length - 1 }, (_, i) => d[i * SEG + SEG / 2]);
}
// 장면 사이 움직임 길: steps 값 [x, y] 직선 · [x, y, cx, cy] 예전 곡선 · [x, y, 'v', x1, y1, x2, y2 …] 지나가는 점들
const stepVia = (st) => (st?.[2] === 'v' ? Array.from({ length: Math.floor((st.length - 3) / 2) }, (_, k) => ({ x: st[3 + 2 * k], y: st[4 + 2 * k] })) : null);
function stepDense(q, b, st) {
  const a = { x: q[0], y: q[1] }; const e = { x: b[0], y: b[1] };
  const v = stepVia(st);
  if (v?.length) return crPts([a, ...v, e]);
  if (st && st.length > 3 && typeof st[2] === 'number') return quadPts(a, { x: st[2], y: st[3] }, e);
  return [a, e];
}
// 화면에서 끌 점 목록 (예전 곡선은 곡선 가운데 한 점으로)
function stepPoints(q, b, st) {
  const v = stepVia(st);
  if (v) return v;
  if (st && st.length > 3 && typeof st[2] === 'number') return [{ x: 0.25 * q[0] + 0.5 * st[2] + 0.25 * b[0], y: 0.25 * q[1] + 0.5 * st[3] + 0.25 * b[1] }];
  return [];
}
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
const KIND_COLOR = { link: '#ffd400', cone: '#ff8a00', marker: '#f5c400', pole: '#ffd400', hurdle: '#ff3b30', ladder: '#ffd400', gmarker: '#ff9f0a', gymball: '#4ea1ff', bosu: '#5e5ce6', vision: '#ffd400' };
// 색 고르기: 작은 색 칸을 색상별 · 밝기별로 (맨 위 회색 한 줄 + 색상 10가지 × 밝기 7단계)
const hsl2hex = (h, s0, l0) => {
  const s1 = s0 / 100; const l1 = l0 / 100; const a = s1 * Math.min(l1, 1 - l1);
  const f = (n) => { const k = (n + h / 30) % 12; const c = l1 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
};
export const SWATCHES = [
  '#ffffff', '#e5e7eb', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937', '#111111', '#000000',
  ...[[92, 88], [88, 76], [84, 64], [80, 52], [76, 42], [72, 32], [66, 22]].flatMap(([sat, lig]) => [0, 25, 45, 58, 110, 160, 195, 220, 268, 322].map((h) => hsl2hex(h, sat, lig))),
];
export const TOOL_COLORS = ['', ...SWATCHES];
const lumOf = (hex) => { const n = parseInt(hex.slice(1), 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const shadeOf = (hex, k) => { const n = parseInt(hex.slice(1), 16); return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - k)).toString(16).padStart(2, '0')).join('')}`; };
// 선수 색: 직접 고른 색(pc)이 있으면 그 색 · 글자는 잘 보이게 흰색/검정 · 테두리는 진하게
export const playerColors = (it) => (it.pc ? { fill: it.pc, text: lumOf(it.pc) > 0.42 ? '#000000' : '#ffffff', stroke: lumOf(it.pc) > 0.85 ? '#111111' : shadeOf(it.pc, 0.5) } : (TEAMS[it.team] || TEAMS.a));
const colorKey = (x) => x.pc || (TEAMS[x.team] || TEAMS.a).fill;
const COLORABLE = ['arrow', 'zone', 'text', 'num', 'cone', 'marker', 'pole', 'hurdle', 'ladder', 'gmarker', 'gymball', 'bosu', 'vision', 'link'];
const ROTATABLE = ['goal', 'minigoal', 'hurdle', 'ladder'];

// o: { prog: 화살표가 그어진 정도(0~1), op: 투명도, badge: 순서 번호 표시, origin: 시야 기준점(선수 위치) }
function drawItem(layer, it, i, T, u0, selected, mkFor, o = {}) {
  const z = it.k === 'zone' ? 1 : (it.s || 1); // 아이템 크기 (기본 1)
  const u = u0 * z * (it.k === 'zone' || it.k === 'player' ? 1 : ITEM_SCALE); // 그림 크기 (선수는 원래 크기 · 나머지는 예전 65% 크기가 지금의 100%)
  const uh = u0 * Math.max(1, z) * (COARSE ? 1.5 : 1); // 끄는 점(손잡이)은 누르기 쉽게 원래 크기 (손가락 화면은 1.5배)
  const g = el('g', { 'data-i': i, class: `it it-${it.k}${selected ? ' sel' : ''}`, opacity: o.op != null && o.op < 1 ? Math.max(0, o.op).toFixed(2) : '' }, layer);
  const ring = (r) => selected && el('circle', { cx: it.x, cy: it.y, r, fill: 'none', stroke: '#4ea1ff', 'stroke-width': 0.3 * u, 'stroke-dasharray': `${u} ${u * 0.6}` }, g);
  const col = it.c || KIND_COLOR[it.k] || T.ink;
  const rotG = () => el('g', { transform: `rotate(${it.rot || 0} ${it.x} ${it.y})` }, g);
  switch (it.k) {
    case 'player': {
      const tm = playerColors(it);
      const r = 2.1 * u;
      const cx = it.x; const cy = it.y;
      const numT = (y, fs) => { const t = el('text', { x: 0, y: 0, 'text-anchor': 'middle', 'font-size': fs * u * 20, 'letter-spacing': 0, fill: tm.text, 'font-weight': 800, transform: `${upright(cx, cy)} translate(${cx} ${y}) scale(0.05)` }, g); t.textContent = it.n ?? ''; return t; };
      const long = String(it.n ?? '').length > 2;
      if (it.ps === 'shirt' && !it.role) {
        // 유니폼(셔츠) 모양 — 경기장을 세로로 돌려도 셔츠는 바로 서 있게 (글자처럼)
        const sg = el('g', { transform: upright(cx, cy) }, g);
        const P = (dx, dy) => `${(cx + dx * u).toFixed(2)} ${(cy + dy * u).toFixed(2)}`;
        const shirtD = `M${P(-1.15, -2.1)} L${P(-2.5, -1.45)} L${P(-2.9, 0)} L${P(-1.75, 0.45)} L${P(-1.75, 2.2)} L${P(1.75, 2.2)} L${P(1.75, 0.45)} L${P(2.9, 0)} L${P(2.5, -1.45)} L${P(1.15, -2.1)} Q${P(0, -1.2)} ${P(-1.15, -2.1)} Z`;
        el('path', { d: shirtD, fill: tm.fill, stroke: 'none' }, sg);
        // 두 번째 색: 가로(위 · 아래 상하의 느낌) · 세로(3줄 — 인터밀란 느낌)
        if ((it.sp === 'h' || it.sp === 'v') && it.pc2) {
          const cid = `sh${String(it.id || i).replace(/[^a-z0-9]/gi, '')}`;
          const cp = el('clipPath', { id: cid }, sg); el('path', { d: shirtD }, cp);
          const band = el('g', { 'clip-path': `url(#${cid})` }, sg);
          if (it.sp === 'h') el('rect', { x: cx - 3 * u, y: cy + 0.15 * u, width: 6 * u, height: 2.2 * u, fill: it.pc2 }, band);
          else el('rect', { x: cx - 0.58 * u, y: cy - 2.3 * u, width: 1.16 * u, height: 4.6 * u, fill: it.pc2 }, band), el('rect', { x: cx - 2.95 * u, y: cy - 2.3 * u, width: 1.2 * u, height: 4.6 * u, fill: it.pc2 }, band), el('rect', { x: cx + 1.75 * u, y: cy - 2.3 * u, width: 1.2 * u, height: 4.6 * u, fill: it.pc2 }, band);
        }
        el('path', { d: shirtD, fill: 'none', stroke: tm.stroke, 'stroke-width': 0.28 * u, 'stroke-linejoin': 'round' }, sg);
        const nt = numT(cy + 1.15 * u, long ? 1.25 : 1.75);
        if ((it.sp === 'h' || it.sp === 'v') && it.pc2) { // 번호는 두 번째 색(아래쪽 · 가운데 줄) 위에 — 그 색에 맞춰 글자색
          const light = lumOf(it.pc2) > 0.42;
          nt.setAttribute('fill', light ? '#000000' : '#ffffff');
          nt.setAttribute('stroke', light ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)'); nt.setAttribute('stroke-width', 2.2); nt.setAttribute('paint-order', 'stroke');
        }
      } else {
        const pat = !it.role && (it.sp === 'h' || it.sp === 'v') && it.pc2;
        el('circle', { cx, cy, r, fill: tm.fill, stroke: pat ? 'none' : tm.stroke, 'stroke-width': it.role ? 0.45 * u : 0.3 * u }, g);
        if (pat) { // 동그라미도 두 번째 색: 가로(아래 반) · 세로(가운데 줄 — 3줄)
          const cg = el('g', { transform: upright(cx, cy) }, g);
          const cid = `cc${String(it.id || i).replace(/[^a-z0-9]/gi, '')}`;
          const cp = el('clipPath', { id: cid }, cg); el('circle', { cx, cy, r }, cp);
          const band = el('g', { 'clip-path': `url(#${cid})` }, cg);
          if (it.sp === 'h') el('rect', { x: cx - r, y: cy, width: 2 * r, height: r, fill: it.pc2 }, band);
          else el('rect', { x: cx - r / 3, y: cy - r, width: (2 * r) / 3, height: 2 * r, fill: it.pc2 }, band);
          el('circle', { cx, cy, r, fill: 'none', stroke: tm.stroke, 'stroke-width': 0.3 * u }, g);
        }
        const nc = numT(cy + 0.75 * u, long ? 1.5 : 2.1); // 크게 그려 줄임 (작은 글자 겹침 방지)
        if (pat) { // 번호가 두 색에 걸쳐도 보이게 테두리
          const light = it.sp === 'v' ? lumOf(it.pc2) > 0.42 : lumOf(tm.fill.startsWith('#') ? tm.fill : '#ffffff') > 0.42;
          nc.setAttribute('fill', light ? '#000000' : '#ffffff');
          nc.setAttribute('stroke', light ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.6)'); nc.setAttribute('stroke-width', 2.4); nc.setAttribute('paint-order', 'stroke');
        }
      }
      ring(r + 0.9 * u);
      break;
    }
    case 'link': {
      // 선수 연결: 이은 선수들을 따라다니는 선 (+ 면 채우기)
      const pts = (it.ids || []).map((id) => o.posOf?.(id)).filter(Boolean);
      if (!pts.length) break;
      const d0 = pts.map((p, k) => `${k ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
      const d = d0 + (it.closed && pts.length > 2 ? ' Z' : ''); // 도형: 첫 선수까지 닫음
      if (it.area && pts.length > 2) el('path', { d: `${d0} Z`, fill: col, 'fill-opacity': 0.3, stroke: 'none' }, g);
      el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 2.4 * u0, 'pointer-events': 'stroke' }, g); // 누르기 쉽게 넓은 투명 선
      el('path', { d, fill: 'none', stroke: col, 'stroke-width': 0.5 * u0, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': it.style === 'dash' ? `${1.4 * u0} ${1 * u0}` : '', opacity: 0.95 }, g);
      pts.forEach((p) => el('circle', { cx: p[0], cy: p[1], r: 0.55 * u0, fill: col }, g));
      if (selected) el('path', { d, fill: 'none', stroke: '#4ea1ff', 'stroke-width': 0.25 * u0, 'stroke-dasharray': `${u0} ${u0 * 0.6}` }, g);
      break;
    }
    case 'ball': {
      // 진짜 축구공처럼: 흰 공 + 가운데 검은 오각형 + 둘레의 오각형 조각(살짝만 보임) + 육각형 이음선 + 입체 그늘
      const R = 1.7 * u; const bx = it.x; const by = it.y;
      const svgEl = layer.ownerSVGElement;
      const gid = 'ballshade';
      if (svgEl && !svgEl.querySelector(`#${gid}`)) {
        let defs = svgEl.querySelector('defs'); if (!defs) defs = el('defs', {}, svgEl);
        defs.insertAdjacentHTML('beforeend', `<radialGradient id="${gid}" cx="38%" cy="32%" r="72%"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f1f3f4"/><stop offset="1" stop-color="#a7b0b8"/></radialGradient>`);
      }
      const P = (a, rr) => [bx + Math.cos(a) * rr, by + Math.sin(a) * rr];
      const pent = (c, rr, rot) => Array.from({ length: 5 }, (_, k) => { const a = rot + (k * 2 * Math.PI) / 5; return `${(c[0] + Math.cos(a) * rr).toFixed(3)},${(c[1] + Math.sin(a) * rr).toFixed(3)}`; }).join(' ');
      const clipId = `bc${it.id || i}`.replace(/[^a-z0-9]/gi, '');
      const cp = el('clipPath', { id: clipId }, g); el('circle', { cx: bx, cy: by, r: R }, cp);
      el('ellipse', { cx: bx + 0.15 * R, cy: by + 0.85 * R, rx: 0.85 * R, ry: 0.28 * R, fill: 'rgba(0,0,0,.35)' }, g); // 바닥 그림자
      el('circle', { cx: bx, cy: by, r: R, fill: `url(#${gid})` }, g);
      const inner = el('g', { 'clip-path': `url(#${clipId})` }, g);
      const top = -Math.PI / 2;
      const cr = 0.34 * R; // 가운데 오각형
      el('polygon', { points: pent([bx, by], cr, top), fill: '#161616' }, inner);
      for (let k = 0; k < 5; k++) {
        const a = top + (k * 2 * Math.PI) / 5; // 가운데 오각형 꼭짓점 방향
        const b = a + Math.PI / 5; // 그 사이 방향 → 둘레 오각형
        const v = P(a, cr); const w = P(a, 0.62 * R);
        el('line', { x1: v[0], y1: v[1], x2: w[0], y2: w[1], stroke: '#8d949a', 'stroke-width': 0.05 * R }, inner); // 육각형 이음선
        const w2 = P(a + (2 * Math.PI) / 5, 0.62 * R);
        const e = P(b, 0.78 * R);
        el('polyline', { points: `${w[0]},${w[1]} ${e[0]},${e[1]} ${w2[0]},${w2[1]}`, fill: 'none', stroke: '#8d949a', 'stroke-width': 0.05 * R }, inner);
        el('polygon', { points: pent(P(b, 1.08 * R), 0.32 * R, b + Math.PI), fill: '#161616' }, inner); // 둘레 오각형 (가장자리에 일부만)
      }
      el('circle', { cx: bx, cy: by, r: R, fill: 'none', stroke: '#1d1d1d', 'stroke-width': 0.07 * R }, g);
      el('ellipse', { cx: bx - 0.38 * R, cy: by - 0.42 * R, rx: 0.22 * R, ry: 0.12 * R, fill: 'rgba(255,255,255,.8)', transform: `rotate(-35 ${bx - 0.38 * R} ${by - 0.42 * R})` }, g); // 반짝임
      ring(R + 0.9 * u);
      break;
    }
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
      // 위에서 본 골대: 앞쪽(입구)은 굵은 골대 틀 · 기둥, 뒤쪽은 그물 (돌리기로 방향 바꿈 · 기본은 오른쪽을 봄)
      const big = it.k === 'goal';
      const gw = big ? 7.32 * z : 4.2 * u; // 입구 폭
      const gd = big ? 2.2 * z : 1.9 * u; // 깊이
      const gg = rotG();
      const fx = it.x + gd / 2; // 입구(골라인) 쪽
      const bx = it.x - gd / 2; // 그물 뒤쪽
      const y0 = it.y - gw / 2; const y1 = it.y + gw / 2;
      const frame = big ? '#ffffff' : '#ff5a36';
      const pw = (big ? 0.42 : 0.34) * u * (big ? Math.max(1, z * 0.6) : 1); // 틀 굵기
      // 그림자
      el('path', { d: `M ${fx} ${y0} L ${bx + gd * 0.25} ${y0 + gw * 0.06} L ${bx + gd * 0.25} ${y1 - gw * 0.06} L ${fx} ${y1} Z`, fill: 'rgba(0,0,0,.35)', transform: `translate(${0.25 * u} ${0.3 * u})` }, gg);
      // 그물 바닥(뒤로 갈수록 살짝 좁아지는 사다리꼴) + 그물 무늬
      const net = `M ${fx} ${y0} L ${bx} ${y0 + gw * 0.08} L ${bx} ${y1 - gw * 0.08} L ${fx} ${y1} Z`;
      el('path', { d: net, fill: 'rgba(255,255,255,.18)', stroke: frame, 'stroke-width': pw * 0.45, 'stroke-linejoin': 'round' }, gg);
      const cells = big ? 8 : 5;
      for (let k = 1; k < cells; k++) { const yy = y0 + (gw / cells) * k; el('line', { x1: fx, y1: yy, x2: bx, y2: it.y + (yy - it.y) * 0.84, stroke: '#ffffff', 'stroke-width': 0.08 * u, opacity: 0.55 }, gg); }
      for (let k = 1; k < 3; k++) { const xx = fx - (gd / 3) * k; const sh = gw * 0.08 * (k / 3); el('line', { x1: xx, y1: y0 + sh, x2: xx, y2: y1 - sh, stroke: '#ffffff', 'stroke-width': 0.08 * u, opacity: 0.55 }, gg); }
      // 옆 틀 + 앞 크로스바(입구)
      el('path', { d: `M ${bx} ${y0 + gw * 0.08} L ${fx} ${y0} L ${fx} ${y1} L ${bx} ${y1 - gw * 0.08}`, fill: 'none', stroke: frame, 'stroke-width': pw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, gg);
      el('line', { x1: fx, y1: y0, x2: fx, y2: y1, stroke: frame, 'stroke-width': pw * 1.5, 'stroke-linecap': 'round' }, gg);
      // 골포스트 (입구 양 끝 동그라미)
      [y0, y1].forEach((yy) => el('circle', { cx: fx, cy: yy, r: pw * 1.25, fill: frame, stroke: 'rgba(0,0,0,.5)', 'stroke-width': pw * 0.3 }, gg));
      ring(gw / 2 + u);
      break;
    }
    case 'zone': {
      const dash = it.style === 'dash';
      const zc = it.c || (dash ? '#e5484d' : '');
      const look = {
        fill: zc ? `${zc}${dash ? '14' : '33'}` : T.zone,
        stroke: dash || it.c ? zc : 'none', 'stroke-width': 0.35 * u, 'stroke-dasharray': dash ? `${u * 1.2} ${u * 0.8}` : '',
      };
      // 모양: 네모(기본) · 동그라미 · 세모 · 마름모
      if (it.shape === 'ellipse') el('ellipse', { cx: it.x + it.w / 2, cy: it.y + it.h / 2, rx: it.w / 2, ry: it.h / 2, ...look }, g);
      else if (it.shape === 'tri') el('polygon', { points: `${it.x + it.w / 2},${it.y} ${it.x + it.w},${it.y + it.h} ${it.x},${it.y + it.h}`, 'stroke-linejoin': 'round', ...look }, g);
      else if (it.shape === 'diamond') el('polygon', { points: `${it.x + it.w / 2},${it.y} ${it.x + it.w},${it.y + it.h / 2} ${it.x + it.w / 2},${it.y + it.h} ${it.x},${it.y + it.h / 2}`, 'stroke-linejoin': 'round', ...look }, g);
      else el('rect', { x: it.x, y: it.y, width: it.w, height: it.h, ...look }, g);
      if (selected) {
        el('rect', { x: it.x, y: it.y, width: it.w, height: it.h, fill: 'none', stroke: '#4ea1ff', 'stroke-width': 0.3 * u, 'stroke-dasharray': `${u} ${u * 0.6}` }, g);
        el('circle', { cx: it.x + it.w, cy: it.y + it.h, r: 1.1 * u, fill: '#4ea1ff', 'data-handle': 'size' }, g);
      }
      break;
    }
    case 'arrow': {
      const prog = o.prog == null ? 1 : o.prog;
      if (prog <= 0) break;
      // 흔들림 없이: 전체 곡선(드리블 물결 포함)을 한 번 만들어 두고 그어진 길이만큼 잘라 씀,
      // 화살촉 방향은 곡선 자체의 방향으로 (그어지는 중 마지막 짧은 조각 방향을 쓰면 짧은 화살표일수록 흔들렸음)
      const full = bezPts(it, 1, 48);
      let all = it.style === 'dribble' ? wavyPts(full, u) : full;
      const lens = [0];
      for (let k = 1; k < all.length; k++) lens.push(lens[k - 1] + Math.hypot(all[k].x - all[k - 1].x, all[k].y - all[k - 1].y));
      const Ltot = lens[lens.length - 1] || 1e-6;
      const hl = Math.min(1.8 * u, Ltot * 0.45); // 화살촉 길이 (짧은 화살표는 줄임)
      const want = Ltot * Math.min(1, prog);
      const bodyL = Math.max(0, want - hl * 0.7);
      const cutAt = (L) => {
        let k = 1; while (k < lens.length - 1 && lens[k] < L) k++;
        const f = (L - lens[k - 1]) / Math.max(1e-6, lens[k] - lens[k - 1]);
        return { k, p: { x: all[k - 1].x + (all[k].x - all[k - 1].x) * f, y: all[k - 1].y + (all[k].y - all[k - 1].y) * f } };
      };
      const b = cutAt(bodyL);
      const pts = [...all.slice(0, b.k), b.p];
      if (bodyL > 0.01) el('path', { d: ptsD(pts), stroke: col, 'stroke-width': 0.45 * u, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': it.style === 'run' ? `${u * 1.2} ${u * 0.9}` : '' }, g);
      // 화살촉: 매끈한 곡선(물결 없는) 위, 그어진 길이 비율의 점과 방향
      const fl = [0];
      for (let k = 1; k < full.length; k++) fl.push(fl[k - 1] + Math.hypot(full[k].x - full[k - 1].x, full[k].y - full[k - 1].y));
      const Lf = fl[fl.length - 1] || 1e-6;
      const onFull = (L) => {
        let k = 1; while (k < fl.length - 1 && fl[k] < L) k++;
        const f = (L - fl[k - 1]) / Math.max(1e-6, fl[k] - fl[k - 1]);
        return { x: full[k - 1].x + (full[k].x - full[k - 1].x) * f, y: full[k - 1].y + (full[k].y - full[k - 1].y) * f };
      };
      const tip = onFull(Lf * Math.min(1, prog));
      const back = onFull(Math.max(0, Lf * Math.min(1, prog) - Math.max(hl, Lf * 0.08)));
      let ang = Math.atan2(tip.y - back.y, tip.x - back.x);
      if (!isFinite(ang) || (tip.x === back.x && tip.y === back.y)) ang = Math.atan2(it.y2 - it.y1, it.x2 - it.x1);
      const hw = hl * 0.55;
      el('path', { d: `M ${tip.x} ${tip.y} L ${tip.x - Math.cos(ang) * hl - Math.sin(ang) * hw} ${tip.y - Math.sin(ang) * hl + Math.cos(ang) * hw} L ${tip.x - Math.cos(ang) * hl + Math.sin(ang) * hw} ${tip.y - Math.sin(ang) * hl - Math.cos(ang) * hw} Z`, fill: col, stroke: 'none' }, g);
      void mkFor;
      el('path', { d: ptsD(bezPts(it)), stroke: 'transparent', 'stroke-width': 2.4 * uh, fill: 'none' }, g);
      if (o.badge) { // 순서 번호
        const m = bez(it, 0.5);
        el('circle', { cx: m.x, cy: m.y, r: 1.2 * u, fill: col, stroke: '#000', 'stroke-width': 0.18 * u }, g);
        const t = el('text', { x: m.x, y: m.y + 0.5 * u, 'text-anchor': 'middle', 'font-size': 1.45 * u, 'font-weight': 900, fill: '#000', transform: upright(m.x, m.y) }, g);
        t.textContent = it.order || 1;
      }
      if (selected) {
        el('circle', { cx: it.x1, cy: it.y1, r: 1 * uh, fill: '#4ea1ff', 'data-handle': 'p1' }, g);
        el('circle', { cx: it.x2, cy: it.y2, r: 1 * uh, fill: '#4ea1ff', 'data-handle': 'p2' }, g);
        if (it.cx != null && !it.via) { // 예전 곡선: 가운데 한 점 (끌면 새 방식으로)
          const m = bez(it, 0.5);
          el('circle', { cx: m.x, cy: m.y, r: 0.9 * uh, fill: '#fff', stroke: '#4ea1ff', 'stroke-width': 0.3 * uh, 'data-handle': 'q0' }, g);
        } else {
          // 점과 점 사이 작은 점: 끌면 꺾는 점이 하나 더 생김 → 사이드 스텝 · 지그재그도 자유롭게
          segMids(arrowCtl(it)).forEach((m, k) => el('circle', { cx: m.x, cy: m.y, r: 0.6 * uh, fill: 'rgba(255,255,255,.55)', stroke: '#4ea1ff', 'stroke-width': 0.22 * uh, 'data-handle': `n${k}`, class: 'h-add' }, g));
          (it.via || []).forEach((v, k) => el('circle', { cx: v.x, cy: v.y, r: 0.95 * uh, fill: '#fff', stroke: '#4ea1ff', 'stroke-width': 0.32 * uh, 'data-handle': `q${k}` }, g)); // 끌어서 옮김 · 더블클릭하면 지움
        }
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
        el('circle', { cx: O.x + Math.cos(a) * L, cy: O.y + Math.sin(a) * L, r: 1 * uh, fill: '#4ea1ff', 'data-handle': 'vh' }, g);
        if (!it.who) el('circle', { cx: O.x, cy: O.y, r: 0.8 * u, fill: '#4ea1ff' }, g);
      }
      break;
    }
    case 'num': { // 설명용 번호 1 · 2 · 3 (네모) — 그림 위에 순서를 붙여서 설명
      const r = 1.6 * u; // 네모 반 크기 — 동그란 선수와 헷갈리지 않게 네모로
      const fill = it.c || '#ffd400';
      el('rect', { x: it.x - r, y: it.y - r, width: 2 * r, height: 2 * r, rx: 0.35 * u, fill, stroke: '#000', 'stroke-width': 0.22 * u, transform: upright(it.x, it.y) }, g);
      const dark = ['#111111', '#5e5ce6', '#bf5af2', '#ff3b30', '#4ea1ff'].includes(fill);
      const t = el('text', { x: 0, y: 0, 'text-anchor': 'middle', 'font-size': (String(it.n).length > 1 ? 1.6 : 2) * u * 20, 'font-weight': 900, fill: dark ? '#fff' : '#000', transform: `${upright(it.x, it.y)} translate(${it.x} ${it.y + 0.7 * u}) scale(0.05)` }, g);
      t.textContent = it.n ?? '';
      if (selected) { const R2 = r + 0.8 * u; el('rect', { x: it.x - R2, y: it.y - R2, width: 2 * R2, height: 2 * R2, rx: 0.5 * u, fill: 'none', stroke: '#4ea1ff', 'stroke-width': 0.3 * u, 'stroke-dasharray': `${u} ${u * 0.6}` }, g); }
      break;
    }
    case 'text': {
      // 아주 작은 글자 크기(필드 단위)로 그리면 크롬이 글자 폭을 반올림해 글자가 겹치고 띄어쓰기가 사라짐
      // → 20배 큰 글자로 그린 뒤 1/20 로 줄여서 그림 (보이는 크기는 같음)
      const K = 20;
      const t = el('text', {
        x: 0, y: 0, 'text-anchor': 'middle', 'font-size': 2.4 * u * K, 'font-weight': 800, 'letter-spacing': 0, fill: it.c || T.ink,
        stroke: (it.c || T.ink) === '#111111' || T.ink === '#111111' ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.55)', 'stroke-width': 0.35 * u * K, 'paint-order': 'stroke', 'stroke-linejoin': 'round',
        transform: `${upright(it.x, it.y)} translate(${it.x} ${it.y}) scale(${1 / K})`,
      }, g);
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
  ['ball', '공', '◉'],
  ['pass', '패스', '→'],
  ['run', '이동', '⇢'],
  ['dribble', '드리블', '↝'],
  ['link', '선수 연결', '⟋'],
  ['role-n', '중립 (N)', 'N'],
  ['role-s', '서브 (S)', 'S'],
  ['role-t', '타겟 (T)', 'T'],
  ['role-c', '코치 (C)', 'C'],
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
  ['zone', '네모', '▭'],
  ['zone-dash', '점선 네모', '⬚'],
  ['zone-o', '동그라미', '◯'],
  ['zone-o-dash', '점선 동그라미', '◌'],
  ['zone-tri', '세모', '△'],
  ['zone-tri-dash', '점선 세모', '△'],
  ['zone-dia', '마름모', '◇'],
  ['text', '글자', 'T'],
  ['num', '순서', '□'],
];

// 도구 묶음 — [이름, 아이콘, 들어 있는 도구들]
const TOOL_GROUPS = [
  ['선택', '⬚', ['select']],
  ['선수', '●', ['player']],
  ['역할', 'N', ['role-n', 'role-s', 'role-t', 'role-c']],
  ['공', '◉', ['ball']],
  ['화살표', '→', ['pass', 'run', 'dribble']],
  ['연결', '⟋', ['link']],
  ['시야', '∨', ['vision']],
  ['기구', '▲', ['cone', 'marker', 'gmarker', 'pole', 'hurdle', 'ladder', 'gymball', 'bosu', 'minigoal', 'goal']],
  ['영역', '▭', ['zone', 'zone-dash', 'zone-o', 'zone-o-dash', 'zone-tri', 'zone-tri-dash', 'zone-dia']],
  ['글자', 'T', ['text']],
  ['순서', '□', ['num']],
];
const ITEM_SCALE = 0.65; // 공 · 기구 · 번호 · 글자 · 화살표 기본 크기 (선수는 그대로)
const ARROW_HINT = '끌어서 화살표 · 고른 뒤 선 위의 작은 점을 끌면 휘는 점이 하나씩 늘어나요 (사이드 스텝 · 지그재그) · 흰 점 더블클릭하면 그 점만 지움';
const TOOL_INFO = Object.fromEntries(TOOLS.map(([k, l, ic]) => [k, { l, ic }]));

// 움직임(장면): data.steps[k] = { 아이템id: [x, y] } — 장면 1은 기본 위치, 장면 2부터 바뀐 위치만 저장
const MOVABLE = ['player', 'ball', 'cone', 'marker', 'text', 'num', 'gmarker', 'pole', 'hurdle', 'ladder', 'gymball', 'bosu', 'vision'];
const EQUIP = ['cone', 'marker', 'ball', 'minigoal', 'goal', 'gmarker', 'pole', 'hurdle', 'ladder', 'gymball', 'bosu'];
let idSeq = 0;
let clipboard = null; // Ctrl+C 한 아이템들 (다른 작전판에도 붙여넣기 가능)
let activePad = 0; // 마지막으로 만진 작전판 (단축키는 그 작전판에만)
const newId = () => `i${Date.now().toString(36)}${(++idSeq).toString(36)}`;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

// draft: 임시 보관 이름 (예: '팀id/gm') — 주면 고칠 때마다 이 컴퓨터에 자동 보관 → 저장 안 하고 나갔다 와도 불러오기
export function createPad(container, initial, { editable = true, motion = false, play = true, draft = null, onChange = null, exportTitle = null } = {}) {
  let data = normalize(initial);
  data.steps ||= [];
  let scene = 0; // 0 = 장면 1 (기본)
  let anim = null; // 재생 중: 아이템id → [x, y]
  let raf = 0;
  let pl = null; // 재생 정보 { frameAt, total, t0, N } — 멈췄다 이어가기용
  let paused = null; // 보기 화면에서 멈춘 시각 { t }
  let mkey = ''; // 움직임 바를 다시 그릴지 (재생 중 매 프레임 다시 그리면 버튼이 안 눌림)
  let tool = 'select';
  let linking = null; // 선수 연결: 지금 잇고 있는 선
  let pdef = ''; // 새로 놓는 선수 모양 ('' 동그라미 · 'shirt' 유니폼)
  let sdef = ''; let c2def = '#ffffff'; // 새로 놓는 유니폼 무늬 ('' 단색 · 'h' 가로 2색 · 'v' 세로 3줄) · 두 번째 색
  let pcur = ''; // 새로 놓는 선수 색 (작은 색 칸에서 고른 색)
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
    <div class="pad-field" data-fieldbox hidden>
      <select data-ft title="필드">${Object.entries(FIELDS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('')}</select>
      <span class="pad-size"><i>경기장 가로</i><input type="number" data-fw min="5" max="120" step="any" form="_pad" title="가로(m)"><i>m × 세로</i><input type="number" data-fh min="5" max="90" step="any" form="_pad" title="세로(m)"><i>m</i></span>
      <select data-fo title="경기장 방향"><option value="">방향 자동</option><option value="h">↔ 가로로 보기</option><option value="v">↕ 세로로 보기</option></select>
      <select data-fc title="필드 색">${Object.entries(COLORS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <select data-gp title="그리드">${Object.entries(GRIDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <span class="pad-size" data-gsize><i>가로</i><input type="number" data-gc min="0" max="20" form="_pad" title="가로 칸 수"><i>칸 × 세로</i><input type="number" data-gr min="0" max="20" form="_pad" title="세로 칸 수"><i>칸</i></span>
      <span class="pad-size" data-gmsize><i>칸 가로</i><input type="number" data-gcw min="1" max="60" step="any" form="_pad" title="칸 가로(m)"><i>m × 세로</i><input type="number" data-gch min="1" max="60" step="any" form="_pad" title="칸 세로(m)"><i>m</i></span>
      <select data-form title="포메이션 넣기"><option value="">포메이션 넣기</option>
        <optgroup label="A팀 · 11대11">${formOpts('a', false)}</optgroup>
        <optgroup label="A팀 · 8대8">${formOpts('a', true)}</optgroup>
        <optgroup label="B팀 (상대) · 11대11">${formOpts('b', false)}</optgroup>
        <optgroup label="B팀 (상대) · 8대8">${formOpts('b', true)}</optgroup>
      </select>
    </div>
    <div class="pad-tools">
      ${TOOL_GROUPS.map(([l, ic, ks], gi) => (ks.length === 1
        ? `<button type="button" class="ptool" data-tool="${ks[0]}" title="${l}"><b>${ic}</b><span class="plab">${l}</span></button>`
        : `<span class="pgroup" data-grp="${gi}"><button type="button" class="ptool" data-gbtn="${gi}" title="${l}"><b>${ic}</b><span class="plab"><span data-glabel>${l}</span> ▾</span></button>
          <span class="pgmenu" hidden>${ks.map((k) => `<button type="button" data-tool="${k}"><b>${TOOL_INFO[k].ic}</b>${TOOL_INFO[k].l}</button>`).join('')}</span></span>`)).join('')}
      <button type="button" class="ptool" data-fieldtg title="경기장 · 그리드 · 포메이션 · 선수 모양"><b>⚙</b><span class="plab">경기장</span></button>
      <span class="pad-tsep"></span>
      <button type="button" class="ptool pact" data-act="undo" title="되돌리기 (Ctrl+Z)"><b>↶</b><span class="plab">되돌리기</span></button>
      <button type="button" class="ptool pact" data-act="clear" title="모두 지우기"><b>⌫</b><span class="plab">모두 지우기</span></button>
      <button type="button" class="ptool pnotes" data-notes hidden title="그림을 보면서 글 쓰기"><b>✎</b><span class="plab">글</span></button>
      ${exportTitle != null ? `<button type="button" class="ptool pexp" data-xp="image" title="이미지로 저장"><b>▣</b><span class="plab">이미지 저장</span></button>
      <button type="button" class="ptool pexp" data-xp="video" title="영상으로 저장 (움직임이 있을 때)"><b>▶</b><span class="plab">영상 저장</span></button>` : ''}
      <button type="button" class="ptool pfull" data-act="full" title="크게 (Esc로 닫기)"><b>⛶</b><span class="plab" data-flabel>크게</span></button>
    </div>
    <div class="pad-acts">
      <span class="pad-sz" data-size title="크기"><button type="button" class="chip" data-sz="-1" title="작게 (- 키)">−</button><input type="number" min="1" max="300" form="_pad" data-szin title="1~300 적고 Enter"><i>%</i><button type="button" class="chip" data-sz="1" title="크게 (+ 키)">+</button></span>
      <span class="pad-ord" data-order title="움직이는 순서 (같은 번호끼리 함께)">순서 <input type="number" min="1" max="20" form="_pad" data-ordin></span>
    </div>
    <div class="pad-acts pad-sel" data-selbar>
      <span class="pad-num" data-pnum><b data-pnlab hidden>번호</b><input data-pnin maxlength="4" placeholder="번호" title="번호 적고 Enter"></span>
      <span class="pad-num pad-txt" data-ptxt><input data-ptin maxlength="30" placeholder="글자" title="글자를 고치고 Enter"></span>
      <span class="pad-teams" data-teams><small class="muted" data-tlab>팀 색</small><button type="button" class="pcdot" data-tdot title="색 고르기"><i></i><span data-tdotlab></span>▾</button>
        <span class="pad-pop pad-swatch pad-tpop" data-tpop hidden>${SWATCHES.map((c) => `<button type="button" class="sw" data-pc="${c}" style="--c:${c}" title="${c}"></button>`).join('')}</span></span>
      <span class="pad-tsel" data-tsel><button type="button" class="chip" data-selteam title="같은 색 선수 모두 고르기">같은 색 고르기</button><button type="button" class="chip" data-selall title="선수 모두 고르기">전체 고르기</button></span>
      <span class="pad-colors" data-colors><button type="button" class="pcdot" data-cdot title="색 고르기"><i></i>색 ▾</button>
        <span class="pad-pop pad-swatch pad-cpop" data-cpop hidden><button type="button" class="sw def wide" data-col="" title="기본색">기본색</button>${SWATCHES.map((c) => `<button type="button" class="sw" data-col="${c}" style="--c:${c}" title="${c}"></button>`).join('')}</span></span>
      <span class="pad-grp" data-psbar><small class="muted">모양</small><button type="button" class="chip" data-psopt="">동그라미</button><button type="button" class="chip" data-psopt="shirt">유니폼</button></span>
      <span class="pad-grp" data-spbar><small class="muted">무늬</small><button type="button" class="chip" data-spopt="">단색</button><button type="button" class="chip" data-spopt="h" title="위 · 아래 두 색 (상하의 느낌)">가로</button><button type="button" class="chip" data-spopt="v" title="세로 3줄 (인터밀란 느낌)">세로</button>
        <span class="pad-teams" data-sp2wrap><button type="button" class="pcdot" data-t2dot title="두 번째 색 고르기"><i></i>두 번째 색 ▾</button>
        <span class="pad-pop pad-swatch pad-t2pop" data-t2pop hidden>${SWATCHES.map((c) => `<button type="button" class="sw" data-pc2="${c}" style="--c:${c}" title="${c}"></button>`).join('')}</span></span></span>
      <span class="pad-grp" data-rolebar>${Object.entries(ROLES).map(([k, R]) => `<button type="button" class="chip" data-roleopt="${k}"><b>${R.t}</b> ${R.l}</button>`).join('')}</span>
      <span class="pad-grp" data-linkopt><button type="button" class="chip" data-lshape="open" title="이은 순서대로 선">선</button><button type="button" class="chip" data-lshape="closed" title="마지막 선수와 첫 선수를 이어 도형으로 (3명부터)">도형</button><button type="button" class="chip" data-lstyle="solid">실선</button><button type="button" class="chip" data-lstyle="dash">점선</button><button type="button" class="chip" data-larea title="이은 선수들 사이를 색으로 채우기">면 채우기</button></span>
      <span class="pad-opt" data-spread title="시야 넓이">${[[30, '좁게'], [50, '보통'], [80, '넓게']].map(([v, l]) => `<button type="button" class="chip" data-sp="${v}">${l}</button>`).join('')}</span>
      <button type="button" class="chip" data-straight title="직선으로">⟋ 직선</button>
      <span class="pad-grp"><button type="button" class="chip" data-act="dup" title="복제 (Ctrl+D · 복사 Ctrl+C · 붙여넣기 Ctrl+V)">⧉ 복제</button><button type="button" class="chip" data-act="front" title="맨 앞으로 (Ctrl+])">순서 앞으로</button><button type="button" class="chip" data-act="back" title="맨 뒤로 (Ctrl+[)">순서 뒤로</button><button type="button" class="chip" data-act="rotate" title="회전">⟳ 회전</button></span>
      <span class="pad-grp"><button type="button" class="chip" data-act="delete">선택 삭제</button><button type="button" class="chip" data-act="delonly">이 장면에서만 삭제</button><button type="button" class="chip" data-act="delall" title="모든 장면에서 삭제">✕ 전체</button><button type="button" class="chip" data-act="unmove" title="이 장면 움직임 취소">↺ 움직임</button></span>
    </div>
    <small class="muted pad-hint" data-hint></small>` : '';

  const svg = el('svg', { class: 'pad-svg', tabindex: editable ? 0 : -1 });
  let world = svg; // 필드 · 아이템이 들어가는 그룹 (세로 필드면 돌아가 있음)
  container.appendChild(svg);
  const unproj = (cx, cy, fn) => fn(cx, cy); // 화면 자리 → 그림 자리 (한 곳에서 계산)
  // 확대: view = 지금 보이는 영역 [x, y, w, h] (null = 전체)
  let view = null;
  let baseVB = '';
  let phoneUi = null; // 휴대폰 전체화면 { top, sheet, marks }
  const zbtn = document.createElement('button');
  zbtn.type = 'button'; zbtn.className = 'pad-zoom'; zbtn.hidden = true;
  zbtn.onclick = () => { view = null; render(); };
  container.appendChild(zbtn);
  function zoomUi() {
    const bw = +baseVB.split(' ')[2] || 1;
    zbtn.hidden = !view;
    if (view) zbtn.innerHTML = `<b>${Math.round((bw / view[2]) * 100)}%</b> 전체 보기`;
  }


  const snapshot = () => { history.push(JSON.stringify(data)); if (history.length > 80) history.shift(); future.length = 0; queueDraft(); onChange?.(); };
  // ── 임시 보관 ──
  const DKEY = editable && draft ? `ssaka-pad:${draft}` : null;
  let draftT = null;
  let draftOff = false; // 저장 · 지우기 뒤엔 다시 고칠 때까지 보관 안 함
  const saveDraft = () => {
    clearTimeout(draftT); draftT = null;
    if (!DKEY || draftOff) return;
    try { localStorage.setItem(DKEY, JSON.stringify({ at: Date.now(), data })); } catch { /* 보관 못 해도 그냥 진행 */ }
  };
  function queueDraft() { if (DKEY) { draftOff = false; clearTimeout(draftT); draftT = setTimeout(saveDraft, 1200); } }
  const selected = () => [items()[sel], ...extra].filter(Boolean);
  // 작은 그리드 훈련장에서도 선수·콘이 너무 작아지지 않게 하한을 둔다
  const unit = () => Math.max(0.55, Math.max(data.field.w, data.field.h) / 105);
  const items = () => data.items;
  // 바깥 여백: 골대(2m)가 보일 만큼만 · 직접 설정은 거의 없이
  const margin = () => (data.field.type === 'custom' ? 0.6 * unit() : Math.max(2 * unit(), 2.4));
  const nextNum = (tm, pc) => {
    const key = pc || (TEAMS[tm] || TEAMS.a).fill; // 같은 색 선수끼리 번호
    const nums = items().filter((x) => x.k === 'player' && !x.role && colorKey(x) === key).map((x) => +x.n).filter((n) => !isNaN(n));
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
    vertical = data.field.orient ? data.field.orient === 'v' : isVertical(data.field.type); // 가로 · 세로 보기 (직접 고르면 그대로)
    svg.setAttribute('viewBox', vertical ? `${-m} ${-m} ${h + 2 * m} ${w + 2 * m}` : `${-m} ${-m} ${w + 2 * m} ${h + 2 * m}`);
    svg.style.background = data.field.type === 'custom' ? T.bg : T.out;
    // 두 손가락으로 확대한 상태 유지 (경기장 크기가 바뀌면 처음으로)
    const baseNow = svg.getAttribute('viewBox');
    if (baseNow !== baseVB) { baseVB = baseNow; view = null; }
    if (view) svg.setAttribute('viewBox', view.join(' '));
    zoomUi();
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
    world = el('g', { id: `${mk}-w`, ...(vertical ? { transform: `matrix(0 -1 1 0 0 ${w})` } : {}) }, svg);
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
        const dense = stepDense(q, [x, y], st);
        el('path', { d: ptsD(dense), fill: 'none', stroke: '#ffd400', 'stroke-width': 0.35 * u, 'stroke-dasharray': `${u} ${u * 0.7}`, opacity: 0.7 }, gl);
        el('circle', { cx: q[0], cy: q[1], r: 1.4 * u, fill: editable ? 'rgba(255,212,0,.12)' : 'none', stroke: '#ffd400', 'stroke-width': 0.3 * u, opacity: 0.8, ...(editable ? { 'data-gs': id, class: 'ghost-s' } : {}) }, gl);
        if (editable) {
          // 노란 점선 위: 작은 점(점 사이)을 끌면 꺾는 점이 생기고, 흰 점은 끌어서 옮기거나 더블클릭해서 지움
          const vs = stepPoints(q, [x, y], st);
          const P = [{ x: q[0], y: q[1] }, ...vs, { x, y }];
          segMids(P).forEach((m, k) => el('circle', { cx: m.x, cy: m.y, r: 0.6 * u, fill: 'rgba(255,255,255,.55)', stroke: '#ffd400', 'stroke-width': 0.25 * u, 'data-gh': id, 'data-ga': k, class: 'ghost-h h-add' }, gl));
          vs.forEach((v, k) => el('circle', { cx: v.x, cy: v.y, r: 0.9 * u, fill: '#fff', stroke: '#ffd400', 'stroke-width': 0.35 * u, 'data-gh': id, 'data-gv': k, class: 'ghost-h' }, gl));
          if (orderUsed) {
            const m = sampler(dense)(0.5); const on = ordOf(scene - 1, id);
            el('circle', { cx: m.x, cy: m.y - 2 * u, r: 1.2 * u, fill: '#ffd400', stroke: '#000', 'stroke-width': 0.2 * u, 'pointer-events': 'none' }, gl);
            const t = el('text', { x: m.x, y: m.y - 1.5 * u, 'text-anchor': 'middle', 'font-size': 1.45 * u, 'font-weight': 900, fill: '#000', 'pointer-events': 'none', transform: upright(m.x, m.y - 2 * u) }, gl); t.textContent = on;
          }
        }
      });
    }
    const layer = el('g', {}, world);
    // 그리는 순서: 영역 → 화살표 → 장비 → 선수 → 공 → 글자
    const order = { zone: 0, ladder: 0.5, vision: 0.8, link: 0.9, arrow: 1, cone: 2, marker: 2, gmarker: 2, pole: 2, hurdle: 2, gymball: 2, bosu: 2, minigoal: 2, goal: 2, player: 3, ball: 4, text: 5, num: 6 };
    const badges = editable && data.items.some((x) => x.k === 'arrow' && (x.order || 1) > 1);
    const zOf = (x) => (x.z != null ? x.z : order[x.k] ?? 2);
    list.map((it, i) => [it, i]).sort((a, b) => zOf(a[0]) - zOf(b[0]))
      .forEach(([it, i]) => {
        const op = anim?.vis?.[it.id] ?? (visIn(data.items[i], sc) ? 1 : 0);
        if (op <= 0) return;
        const who = it.k === 'vision' && it.who && pos[it.who] ? { x: pos[it.who][0], y: pos[it.who][1] } : null;
        drawItem(layer, it, i, T, u, editable && !anim && (i === sel || extra.has(data.items[i])), mkFor, {
          op, prog: anim?.prog?.[it.id], badge: badges && it.k === 'arrow', origin: who,
          posOf: (id) => pos[id],
        });
      });
    // 지금 장면 번호 (수정할 때만 · 재생 중엔 숨김)
    if (editable && !anim && animOn() && data.steps.length) {
      const VW = vertical ? h + 2 * m : w + 2 * m;
      const fs = Math.max(0.9, VW * 0.019);
      const label = `장면 ${scene + 1} / ${data.steps.length + 1}`;
      const g = el('g', { 'pointer-events': 'none' }, svg);
      el('rect', { x: -m + fs * 0.5, y: -m + fs * 0.5, width: fs * (label.length * 0.62 + 1.2), height: fs * 1.7, rx: fs * 0.45, fill: 'rgba(0,0,0,.72)', stroke: '#ffd400', 'stroke-width': fs * 0.08 }, g);
      const t = el('text', { x: 0, y: 0, 'font-size': fs * 20, 'font-weight': 800, fill: '#ffd400', transform: `translate(${-m + fs * 1.1} ${-m + fs * 1.72}) scale(0.05)` }, g);
      t.textContent = label;
    }
    vertical = false;
    if (editable) syncUi();
    drawMotion();
    syncSheet();
  }

  // ───────── 움직임 바 ─────────
  const mbar = document.createElement('div');
  mbar.className = 'pad-motion';
  container.appendChild(mbar);
  if (!editable) mbar.classList.add('view');
  // 기본은 그림(이미지)으로만 · '애니메이션 사용'을 켜야 장면 1 · 2 · 3 움직임 (예전에 장면을 만든 작전판은 켜진 채로)
  const animOn = () => data.anim === true || (data.anim !== false && data.steps.length > 0);
  const hasMotion = () => animOn() && (data.steps.length > 0 || data.items.some((x) => x.k === 'arrow'));
  function drawMotion() {
    const key = [editable, motion, play, !!anim, !!paused, scene, anim?.scene, data.steps.length, hasMotion(), animOn()].map((v) => (v && typeof v === 'object' ? 1 : v)).join('|');
    if (key === mkey && mbar.innerHTML) return;
    mkey = key;
    const N1 = data.steps.length + 1;
    if (!editable) {
      mbar.hidden = !(play !== false && hasMotion());
      if (mbar.hidden) return;
      const playing = anim && !paused;
      const cur = anim ? anim.scene : scene;
      mbar.innerHTML = `${playing ? '<button type="button" class="chip on" data-pause>❚❚ 멈춤</button>'
        : paused ? '<button type="button" class="chip on" data-resume>▶ 이어서</button><button type="button" class="chip" data-play0>⏮ 처음부터</button>'
          : '<button type="button" class="chip on" data-play0>▶ 움직임 보기</button>'}
        <span class="pm-dots" title="누르면 그 장면부터 재생">${Array.from({ length: N1 }, (_, k) => `<i class="${k === cur ? 'on' : ''}" data-dot="${k}"></i>`).join('')}</span>`;
    } else {
      if (!motion) { mbar.hidden = true; return; }
      mbar.hidden = false;
      if (!animOn()) {
        mbar.innerHTML = `<span class="pm-lab">움직임</span><button type="button" class="chip" data-animon title="장면을 추가해서 선수 · 공을 움직이게">▶ 움직임 만들기</button>`;
        mbar.querySelector('[data-animon]').onclick = () => { snapshot(); data.anim = true; render(); };
        return;
      }
      const n = N1;
      mbar.innerHTML = `<span class="pm-lab">장면</span>
        <span class="pm-scenes">${Array.from({ length: n }, (_, k) => `<button type="button" class="chip pnum ${k === (anim ? anim.scene : scene) ? 'on' : ''}" data-sc="${k}" title="장면 ${k + 1}">${k + 1}</button>`).join('')}
        <button type="button" class="chip pnum" data-addsc title="장면 추가">+</button></span>
        ${hasMotion() ? (anim ? '<button type="button" class="chip on" data-pause title="멈추고 이 장면에서 고치기">❚❚</button>'
          : `<button type="button" class="chip on" data-playhere title="${scene > 0 ? '이 장면부터 재생' : '재생'}">▶ 재생</button>${scene > 0 ? '<button type="button" class="chip pico" data-play0 title="처음부터">⏮</button>' : ''}`) : ''}
        ${scene > 0 && !anim ? '<button type="button" class="chip" data-delsc title="이 장면 삭제">✕ 이 장면 삭제</button>' : ''}
        <button type="button" class="chip pm-off" data-animoff title="움직임 끄기 (그림 한 장으로)">움직임 끄기</button>
        `;
      mbar.querySelectorAll('[data-sc]').forEach((b) => (b.onclick = () => { stop(); scene = +b.dataset.sc; sel = -1; render(); }));
      mbar.querySelector('[data-addsc]').onclick = () => { stop(); snapshot(); data.steps.splice(scene, 0, {}); if (data.stepOrder) data.stepOrder.splice(scene, 0, {}); shiftScenes(scene + 1, 1); scene += 1; sel = -1; extra.clear(); render(); };
      mbar.querySelector('[data-delsc]')?.addEventListener('click', () => {
        stop(); snapshot();
        // 이 장면에서만 있던 것(이 장면부터 시작해서 이 장면에서 끝나는 화살표 등)은 같이 지움
        data.items = data.items.filter((x) => !((x.from || 0) === scene && x.until === scene));
        data.steps.splice(scene - 1, 1); data.stepOrder?.splice(scene - 1, 1); shiftScenes(scene, -1); scene -= 1; sel = -1; extra.clear(); render();
      });
      mbar.querySelector('[data-playhere]')?.addEventListener('click', () => playAll(Math.max(0, scene - 1))); // 이 장면으로 오는 움직임부터
      mbar.querySelector('[data-animoff]').onclick = () => {
        // 끄면 장면 1(처음 그림)만 남김
        if (data.steps.length && !confirm('애니메이션을 끄면 장면 2부터의 움직임이 지워지고 장면 1 그림만 남아요. 끌까요?')) return;
        stop(); snapshot();
        data.items = data.items.filter((x) => (x.from || 0) === 0).map((x) => { const c = { ...x }; delete c.until; delete c.hide; return c; });
        data.steps = []; delete data.stepOrder; data.anim = false; scene = 0; sel = -1; extra.clear(); render();
      };
    }
    mbar.querySelector('[data-play0]')?.addEventListener('click', () => { stop(); scene = 0; playAll(0); });
    mbar.querySelector('[data-pause]')?.addEventListener('click', pauseAnim);
    mbar.querySelector('[data-resume]')?.addEventListener('click', resumeAnim);
    mbar.querySelectorAll('[data-dot]').forEach((d) => (d.onclick = () => { stop(); scene = +d.dataset.dot; playAll(scene); }));
  }
  // 멈춤: 수정 화면에선 지금 재생 중인 장면으로 멈춰서 바로 고칠 수 있게 · 보기 화면에선 그 순간에 멈춤(이어서 가능)
  function pauseAnim() {
    if (!anim) return;
    if (editable) { const s0 = anim.scene; stop(); scene = s0; sel = -1; render(); return; }
    cancelAnimationFrame(raf);
    paused = { t: performance.now() - pl.t0 };
    drawMotion();
  }
  function resumeAnim() {
    if (!paused || !pl) return;
    pl.t0 = performance.now() - paused.t;
    paused = null;
    raf = requestAnimationFrame(tickAnim);
    drawMotion();
  }
  function tickAnim(now) {
    if (!svg.isConnected || !pl) { stop(); return; }
    const t = Math.max(0, now - pl.t0);
    if (t >= pl.total) { anim = null; scene = pl.N; pl = null; render(); return; }
    anim = pl.frameAt(t);
    render();
    raf = requestAnimationFrame(tickAnim);
  }
  function stop() { cancelAnimationFrame(raf); anim = null; paused = null; }
  // 장면 s → s+1 로 옮긴 것의 순서 (1 먼저 · 2 다음 · 3 마지막), data.stepOrder[s] = { 아이템id: 순서 }
  const ordOf = (s0, id) => data.stepOrder?.[s0]?.[id] || 1;
  const movedIn = (s0) => Object.keys(data.steps[s0] || {}).filter((id) => {
    const a = posAt(s0)[id]; const b = posAt(s0 + 1)[id];
    return a && b && (a[0] !== b[0] || a[1] !== b[1]);
  });
  function playAll(start = 0) {
    stop();
    const N = data.steps.length;
    start = Math.max(0, Math.min(N, start));
    const P = Array.from({ length: N + 1 }, (_, k) => posAt(k));
    // 시간표: 장면마다 ① 화살표가 순서대로 끝까지 그어지고 → ② 옮긴 선수 · 공 · 기구가 순서대로 움직이고 → ③ 다음 장면으로 바뀜
    const segs = [];
    for (let s0 = start; s0 <= N; s0++) {
      const arrO = [...new Set(arrowsIn(s0).map((x) => x.order || 1))].sort((a, b) => a - b);
      const moved = s0 < N ? movedIn(s0) : [];
      const movO = [...new Set(moved.map((id) => ordOf(s0, id)))].sort((a, b) => a - b);
      arrO.forEach((o) => segs.push({ s: s0, kind: 'draw', o, moved, dur: 1000 }, { s: s0, kind: 'draw', o, hold: true, moved, dur: 250 }));
      movO.forEach((o) => segs.push({ s: s0, kind: 'move', o, moved, dur: 1150 }, { s: s0, kind: 'move', o, hold: true, moved, dur: 200 }));
      if (s0 < N) segs.push({ s: s0, kind: 'switch', moved, dur: 350 });
    }
    if (!segs.length) { scene = start; render(); return; }
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
        if (st && st.length > 2) { const q = sampler(stepDense(a0, b0, st))(e); pos[id] = [q.x, q.y]; } // 노란 점선을 휘어 둔 길 그대로
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
    pl = { frameAt, total, t0: performance.now(), N };
    sel = -1; extra.clear();
    anim = frameAt(0);
    raf = requestAnimationFrame(tickAnim);
  }

  function syncUi() {
    const f = data.field;
    container.querySelector('[data-ft]').value = f.type;
    container.querySelector('[data-fw]').value = f.w;
    container.querySelector('[data-fh]').value = f.h;
    container.querySelector('[data-fw]').disabled = container.querySelector('[data-fh]').disabled = false; // 모든 경기장 가로 · 세로 직접
    container.querySelector('[data-fc]').value = f.color;
    container.querySelector('[data-fo]').value = f.orient || '';
    container.querySelector('[data-gp]').value = data.grid.preset;
    container.querySelector('[data-gc]').value = data.grid.cols;
    container.querySelector('[data-gr]').value = data.grid.rows;
    container.querySelector('[data-gsize]').hidden = data.grid.preset !== 'custom';
    container.querySelector('[data-gmsize]').hidden = data.grid.preset !== 'meter';
    container.querySelector('[data-gcw]').value = data.grid.cw || '';
    container.querySelector('[data-gch]').value = data.grid.ch || '';
    container.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
    container.querySelectorAll('[data-grp]').forEach((g) => {
      const [l, ic, ks] = TOOL_GROUPS[+g.dataset.grp];
      const on = ks.includes(tool);
      g.querySelector('[data-gbtn]').classList.toggle('on', on);
      g.querySelector('[data-gbtn] b').textContent = on ? TOOL_INFO[tool].ic : ic;
      g.querySelector('[data-glabel]').textContent = on ? TOOL_INFO[tool].l : l;
      g.querySelector('[data-gbtn]').title = on ? TOOL_INFO[tool].l : l;
    });
    // 팀 색: 선수 도구일 땐 새로 놓을 선수 색 · 선수를 고르면 고른 선수들 색 바꾸기
    const selPl = selected().filter((x) => x.k === 'player' && !x.role);
    const selAny = selected().filter((x) => x.k === 'player'); // 역할 표시(N · S · T · C)도 색은 바꿀 수 있음
    const selTeams = [...new Set(selAny.map((x) => x.team || 'a'))];
    container.querySelectorAll('[data-team]').forEach((b) => b.classList.toggle('on', selAny.length ? selTeams.length === 1 && selTeams[0] === b.dataset.team : b.dataset.team === team));
    container.querySelector('[data-teams]').hidden = !(tool === 'player' || selAny.length);
    const hasRole = selAny.some((x) => x.role);
    container.querySelectorAll('[data-tpop] .rt').forEach((b) => { b.hidden = !hasRole; }); // 역할 색은 역할 표시를 골랐을 때만
    container.querySelector('[data-tlab]').textContent = selAny.length ? (selPl.length ? `선수 ${selPl.length}명 색` : '색') : '팀 색';
    container.querySelector('[data-tsel]').hidden = !selPl.length;
    const s = items()[sel];
    container.querySelector('[data-act="rotate"]').hidden = !(s && ROTATABLE.includes(s.k));
    const multiScene = data.steps.length > 0;
    // 장면이 여러 개: [장면 N부터 삭제] [장면 N에서만 삭제] [모든 장면 삭제] (장면 1에선 '부터'가 '모든 장면'과 같아서 숨김)
    container.querySelector('[data-act="delete"]').hidden = !s || (multiScene && scene === 0);
    const delB = container.querySelector('[data-act="delete"]'); delB.textContent = multiScene ? `✕ ${scene + 1}장면부터` : '✕ 삭제'; delB.title = multiScene ? `장면 ${scene + 1}부터 삭제` : '삭제 (Delete)';
    container.querySelector('[data-act="delonly"]').hidden = !(s && multiScene);
    const delO = container.querySelector('[data-act="delonly"]'); delO.textContent = `✕ ${scene + 1}장면만`; delO.title = `장면 ${scene + 1}에서만 삭제`;
    container.querySelector('[data-act="delall"]').hidden = !(s && multiScene);
    ['front', 'back', 'dup'].forEach((k) => { container.querySelector(`[data-act="${k}"]`).hidden = !s; });
    container.querySelector('[data-act="unmove"]').hidden = !(s && scene > 0 && selected().some((x) => data.steps[scene - 1]?.[x.id]));
    const canSize = s && s.k !== 'zone';
    container.querySelector('[data-size]').hidden = !(canSize || (tool !== 'select' && !tool.startsWith('zone')));
    const szin = container.querySelector('[data-szin]');
    if (document.activeElement !== szin) szin.value = Math.round((canSize ? s.s || 1 : curSize()) * 100);
    // 색: 고른 것(또는 지금 도구)이 색을 바꿀 수 있을 때
    const colorTool = COLORABLE.includes(kindOf(tool.startsWith('zone') ? 'zone' : tool));
    const colSel = selected().some((x) => COLORABLE.includes(x.k));
    container.querySelector('[data-colors]').hidden = !(colorTool || colSel);
    // 색 점: 지금 색 · 팀 색 점: 고른 선수(또는 새로 놓을 선수)의 팀
    const keys = [...new Set(selAny.map(colorKey))];
    const curKey = selAny.length ? (keys.length === 1 ? keys[0] : null) : (pcur || (TEAMS[team] || TEAMS.a).fill);
    const tdot = container.querySelector('[data-tdot]');
    const dc = curKey ? playerColors(selAny.length && keys.length === 1 ? selAny[0] : { team, pc: pcur }) : null;
    tdot.style.setProperty('--c', dc ? dc.fill : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)'); tdot.style.setProperty('--s', dc ? dc.stroke : '#888');
    tdot.classList.toggle('multi', !dc);
    container.querySelector('[data-tdotlab]').textContent = dc ? '색' : '여러 색';
    container.querySelectorAll('[data-pc]').forEach((b) => b.classList.toggle('on', !!curKey && b.dataset.pc.toLowerCase() === String(curKey).toLowerCase()));
    const sl = s && s.k === 'link' && !extra.size;
    container.querySelector('[data-linkopt]').hidden = !sl;
    if (sl) { container.querySelectorAll('[data-lstyle]').forEach((b) => b.classList.toggle('on', (s.style === 'dash') === (b.dataset.lstyle === 'dash'))); container.querySelector('[data-larea]').classList.toggle('on', !!s.area); container.querySelectorAll('[data-lshape]').forEach((b) => { b.classList.toggle('on', !!s.closed === (b.dataset.lshape === 'closed')); if (b.dataset.lshape === 'closed') b.disabled = (s.ids || []).length < 3; }); }
    // 선수 모양 (동그라미 · 유니폼) · 역할 바꾸기
    const plOnly = selected().filter((x) => x.k === 'player' && !x.role);
    container.querySelector('[data-psbar]').hidden = !(plOnly.length || tool === 'player');
    const curPs = plOnly.length ? (plOnly.every((x) => x.ps === 'shirt') ? 'shirt' : plOnly.every((x) => !x.ps) ? '' : null) : pdef;
    container.querySelectorAll('[data-psopt]').forEach((b) => b.classList.toggle('on', b.dataset.psopt === curPs));
    const shirts = plOnly; // 동그라미 · 유니폼 모두 무늬 가능
    container.querySelector('[data-spbar]').hidden = !(shirts.length || (tool === 'player' && !plOnly.length));
    const curSp = shirts.length ? (shirts.every((x) => (x.sp || '') === (shirts[0].sp || '')) ? (shirts[0].sp || '') : null) : sdef;
    container.querySelectorAll('[data-spopt]').forEach((b) => b.classList.toggle('on', b.dataset.spopt === curSp));
    const cur2 = shirts.length ? (shirts[0].pc2 || c2def) : c2def;
    container.querySelector('[data-sp2wrap]').hidden = !curSp;
    container.querySelector('[data-t2dot]').style.setProperty('--c', cur2);
    container.querySelectorAll('[data-pc2]').forEach((b) => b.classList.toggle('on', b.dataset.pc2.toLowerCase() === String(cur2).toLowerCase()));
    const roleSel = selected().filter((x) => x.k === 'player' && x.role);
    container.querySelector('[data-rolebar]').hidden = !roleSel.length;
    container.querySelectorAll('[data-roleopt]').forEach((b) => b.classList.toggle('on', roleSel.length > 0 && roleSel.every((x) => x.role === b.dataset.roleopt)));
    const curCol = colSel ? (selected().find((x) => COLORABLE.includes(x.k)).c || '') : ccol;
    container.querySelectorAll('[data-col]').forEach((b) => b.classList.toggle('on', b.dataset.col === curCol));
    const cdot = container.querySelector('[data-cdot]'); cdot.style.setProperty('--c', curCol || 'transparent'); cdot.classList.toggle('def', !curCol);
    const movedHere = s && scene > 0 && data.steps[scene - 1]?.[s.id];
    container.querySelector('[data-order]').hidden = !(s && (s.k === 'arrow' || movedHere));
    const curOrd = s?.k === 'arrow' ? (s.order || 1) : movedHere ? ordOf(scene - 1, s.id) : 0;
    // 선수 번호 고치기 (선수 하나만 골랐을 때)
    const onePlayer = s && ((s.k === 'player' && !s.role) || s.k === 'num') && !extra.size;
    container.querySelector('[data-pnum]').hidden = !onePlayer;
    if (onePlayer) container.querySelector('[data-pnlab]').textContent = s.k === 'num' ? '순서' : '번호';
    const pnin = container.querySelector('[data-pnin]');
    if (onePlayer && document.activeElement !== pnin) pnin.value = s.n ?? '';
    const oneText = s && s.k === 'text' && !extra.size;
    container.querySelector('[data-ptxt]').hidden = !oneText;
    const ptin = container.querySelector('[data-ptin]');
    if (oneText && document.activeElement !== ptin) ptin.value = s.t ?? '';
    const ordin = container.querySelector('[data-ordin]');
    if (document.activeElement !== ordin) ordin.value = curOrd || 1;
    container.querySelector('[data-straight]').hidden = !(s?.k === 'arrow' && (s.cx != null || s.via?.length));
    container.querySelector('[data-spread]').hidden = !(s && s.k === 'vision');
    container.querySelectorAll('[data-sp]').forEach((b) => b.classList.toggle('on', s?.k === 'vision' && +b.dataset.sp === (s.spread || 50)));
    const selbar = container.querySelector('[data-selbar]');
    selbar.querySelectorAll('.pad-grp:not([data-linkopt]):not([data-psbar]):not([data-rolebar]):not([data-spbar])').forEach((g) => { g.hidden = ![...g.children].some((c) => !c.hidden); });
    selbar.hidden = ![...selbar.children].some((c) => !c.hidden);
    container.querySelector('[data-hint]').textContent = {
      select: '끌어서 이동 · Ctrl(⌘)+클릭 여러 개 · Ctrl+C/V 복사·붙여넣기 · Ctrl+Z 되돌리기 · Delete 삭제 · +/- 크기 · 더블클릭 번호 수정',
      player: '필드를 누르면 선수가 놓입니다 (번호 자동) · Enter 키로 선택·이동',
      ...Object.fromEntries(TOOLS.filter(([k]) => k.startsWith('zone')).map(([k]) => [k, '끌어서 영역 그리기 · 고른 뒤 오른쪽 아래 점으로 크기 조절'])),
      pass: ARROW_HINT, run: ARROW_HINT, dribble: ARROW_HINT,
      num: '필드를 누르면 순서 1 · 2 · 3 이 차례로 놓여요 · 두 번 누르면 아래 칸에서 숫자 고치기',
      vision: '선수를 누른 채 바라보는 쪽으로 끌어요 → V 모양 시야 (선수를 따라다녀요)',
      text: '필드를 누르고 글자 입력',
    }[tool] || '필드를 누르면 놓입니다 · Enter 키로 선택·이동';
  }

  render();
  // 바깥에서 재생 (보여주기 화면의 Space · Enter · → 키)
  const api = {
    getData: () => clone(data),
    hasMotion: () => hasMotion(),
    play: () => { if (!hasMotion()) return false; stop(); scene = 0; playAll(0); return true; },
    reset: () => { stop(); scene = 0; render(); },
    // 이미지 · 영상으로 내보내기 (padExport.js)
    scenes: () => data.steps.length + 1,
    setScene: (k) => { stop(); scene = Math.max(0, Math.min(data.steps.length, k)); sel = -1; extra.clear(); render(); },
    svgEl: () => svg,
    motionPlan: () => {
      if (!hasMotion()) return null;
      playAll(0); cancelAnimationFrame(raf);
      const plan = pl; if (!plan) return null;
      return {
        total: plan.total,
        at: (t) => { pl = plan; anim = plan.frameAt(Math.max(0, Math.min(t, plan.total - 1))); render(); },
        end: () => { stop(); pl = null; scene = plan.N; render(); },
      };
    },
  };
  api.clearDraft = () => { clearTimeout(draftT); draftT = null; draftOff = true; if (DKEY) try { localStorage.removeItem(DKEY); } catch { /* */ } };
  if (!editable) return api;

  // 저장 안 하고 나갔던 작전판이 있으면 위에 알림 → 불러오기 / 버리기
  if (DKEY) {
    let d0 = null;
    try { d0 = JSON.parse(localStorage.getItem(DKEY) || 'null'); } catch { d0 = null; }
    if (d0?.data && JSON.stringify(d0.data) !== JSON.stringify(data)) {
      const t0 = new Date(d0.at);
      const bar = document.createElement('div');
      bar.className = 'pad-draft';
      bar.innerHTML = `<span>저장하지 않은 작전판이 있어요 (${t0.getMonth() + 1}/${t0.getDate()} ${String(t0.getHours()).padStart(2, '0')}:${String(t0.getMinutes()).padStart(2, '0')})</span>
        <button type="button" class="chip on" data-dload>불러오기</button><button type="button" class="chip" data-ddrop>버리기</button>`;
      container.prepend(bar);
      bar.querySelector('[data-dload]').onclick = () => { snapshot(); data = normalize(d0.data); data.steps ||= []; scene = 0; sel = -1; extra.clear(); bar.remove(); render(); };
      bar.querySelector('[data-ddrop]').onclick = () => { api.clearDraft(); bar.remove(); };
    }
    window.addEventListener('pagehide', () => { if (svg.isConnected) saveDraft(); }); // 다른 화면으로 옮긴 작전판은 건드리지 않음
  }

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
        if (it.via) it.via = it.via.map((v) => ({ x: round(v.x * sx), y: round(v.y * sy) }));
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
  container.querySelector('[data-fo]').onchange = (e) => { snapshot(); if (e.target.value) data.field.orient = e.target.value; else delete data.field.orient; render(); };
  container.querySelector('[data-gp]').onchange = (e) => {
    snapshot();
    const p = e.target.value;
    data.grid.preset = p;
    if (p === 'meter') { if (!data.grid.cw) { data.grid.cw = 10; data.grid.ch = 10; } [data.grid.cols, data.grid.rows] = [0, 0]; }
    else if (p !== 'custom') [data.grid.cols, data.grid.rows] = GRID_PRESET[p];
    else if (!data.grid.cols && !data.grid.rows) [data.grid.cols, data.grid.rows] = [4, 4];
    render();
  };
  const gridInput = () => {
    snapshot();
    data.grid.cols = Math.min(20, Math.max(0, +container.querySelector('[data-gc]').value || 0));
    data.grid.rows = Math.min(20, Math.max(0, +container.querySelector('[data-gr]').value || 0));
    render();
  };
  const gridMInput = () => {
    snapshot();
    data.grid.cw = Math.min(60, Math.max(1, +container.querySelector('[data-gcw]').value || 10));
    data.grid.ch = Math.min(60, Math.max(1, +container.querySelector('[data-gch]').value || 10));
    render();
  };
  container.querySelector('[data-gcw]').onchange = gridMInput;
  container.querySelector('[data-gch]').onchange = gridMInput;
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
  // ⚙ 경기장 설정 펼치기
  container.querySelector('[data-fieldtg]')?.addEventListener('click', (e) => { const fb = container.querySelector('[data-fieldbox]'); fb.hidden = !fb.hidden; e.currentTarget.classList.toggle('on', !fb.hidden); });
  container.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => { finishLink(); tool = b.dataset.tool; sel = -1; extra.clear(); closeMenus(); render(); }));
  container.querySelectorAll('[data-gbtn]').forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const m = b.nextElementSibling;
    const open = m.hidden;
    closeMenus();
    m.hidden = !open;
    m.style.left = ''; m.style.top = '';
    if (open && phoneUi) { // 휴대폰 전체화면: 도구 줄 옆으로, 화면 아래로 넘치면 위로
      const r = m.getBoundingClientRect(); const over = r.bottom - (innerHeight - 8);
      if (over > 0) m.style.top = `${-over}px`;
    } else if (open) { // 휴대폰: 메뉴가 화면 오른쪽 밖으로 나가면 안쪽으로 당김
      const r = m.getBoundingClientRect(); const over = r.right - (document.documentElement.clientWidth - 8);
      if (over > 0) m.style.left = `${-Math.min(over, r.left - 8)}px`;
    }
  }));
  document.addEventListener('click', (e) => { if (!container.contains(e.target) || !e.target.closest('.pgroup')) closeMenus(); });
  // ⛶ 크게: 전체 화면에서 편집 (Esc 로 돌아오기)
  // ───────── 그림 + 글 (일지 장면 · 훈련 프로그램 등): 이 작전판과 같은 칸에 있는 글 칸 ─────────
  const host = () => container.closest('.mj-scene, .sess, [data-notes-host], form, .modal');
  const noteFields = () => {
    const h = host(); if (!h) return [];
    return [...h.querySelectorAll('textarea, input[data-sf], input[data-scene-note], input[data-scene-ask]')]
      .filter((f) => !container.contains(f) && !f.closest('[hidden]') && !f.disabled && getComputedStyle(f).display !== 'none');
  };
  // 전체화면에서 [글]: 그 글 칸들을 오른쪽 창으로 잠깐 옮겨 와서 그림을 보면서 쓰기 → 닫으면 원래 자리로
  let notes = null;
  function openNotes() {
    const fs = noteFields(); if (!fs.length) return;
    const panel = document.createElement('div');
    panel.className = 'pad-notes';
    panel.innerHTML = '<div class="pn-head"><b>글</b><small class="muted">쓰는 내용은 원래 칸에 그대로 들어가요</small><button type="button" class="btn ghost sm" data-notes-x>닫기</button></div><div class="pn-body"></div>';
    const body = panel.querySelector('.pn-body');
    const moved = fs.map((f) => { const n = f.closest('label') && !f.closest('label').contains(container) ? f.closest('label') : f; const mark = document.createComment('note'); n.before(mark); body.appendChild(n); return { n, mark }; });
    container.appendChild(panel);
    container.classList.add('pad-notes-on');
    panel.querySelector('[data-notes-x]').onclick = () => { closeNotes(); render(); };
    notes = { panel, moved };
    render();
  }
  function closeNotes() {
    if (!notes) return;
    notes.moved.forEach(({ n, mark }) => { mark.replaceWith(n); });
    notes.panel.remove(); notes = null;
    container.classList.remove('pad-notes-on');
  }
  // 세로 화면에서 글 칸을 쓰는 동안: 그림이 화면 밖으로 나가면 위에 작은 그림을 띄워 둠 (누르면 크게 그리기)
  let mini = null;
  if (editable && COARSE) {
    const onFocusIn = (e) => {
      if (!svg.isConnected) { document.removeEventListener('focusin', onFocusIn); return; }
      const f = e.target;
      if (container.classList.contains('pad-full') || !noteFields().includes(f)) { mini?.remove(); mini = null; return; }
      const r = svg.getBoundingClientRect();
      const vh = window.visualViewport?.height || innerHeight;
      if (r.height && (Math.min(r.bottom, vh) - Math.max(r.top, 60)) / r.height > 0.6) return; // 그림이 거의 다 보이면 그대로
      if (!mini) {
        mini = document.createElement('button');
        mini.type = 'button'; mini.className = 'pad-mini';
        mini.innerHTML = `<svg viewBox="${baseVB}"><use href="#${mk}-w"/></svg><span>크게 그리기 ⛶</span>`;
        mini.onpointerdown = (ev) => ev.preventDefault(); // 글 칸 포커스가 먼저 풀리지 않게
        mini.onclick = () => { mini?.remove(); mini = null; setFull(true); };
        document.body.appendChild(mini);
      }
      mini.firstChild.style.background = svg.style.background;
      mini.firstChild.setAttribute('viewBox', baseVB);
    };
    const onFocusOut = () => setTimeout(() => { if (mini && !noteFields().includes(document.activeElement)) { mini.remove(); mini = null; } }, 120);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
  }

  // 휴대폰: 화면 전체 · 도구는 왼쪽 세로 줄 · 고른 것 설정은 아래에서 올라오는 창 (pad-phone)
  let autoFull = false; // 가로로 돌려서 저절로 커진 경우 → 세로로 돌리면 저절로 돌아옴
  // 휴대폰 전체화면에서만: 버튼들을 위쪽 줄 · 아래 창으로 잠깐 옮김 (닫으면 원래 자리로)
  function enterPhoneUi() {
    if (phoneUi) return;
    const top = document.createElement('div'); top.className = 'pad-topbar';
    const sheet = document.createElement('div'); sheet.className = 'pad-sheet';
    const marks = [];
    const move = (n, to) => { if (!n) return; const m = document.createComment('pad'); n.before(m); to.appendChild(n); marks.push([m, n]); };
    move(mbar, top);
    ['[data-fieldtg]', '[data-act="undo"]', '[data-act="clear"]', '[data-notes]', '[data-act="full"]'].forEach((q) => move(container.querySelector(`.pad-tools ${q}`), top));
    container.querySelectorAll(':scope > .pad-acts').forEach((a) => move(a, sheet));
    container.append(top, sheet);
    phoneUi = { top, sheet, marks };
  }
  function leavePhoneUi() {
    if (!phoneUi) return;
    phoneUi.marks.reverse().forEach(([m, n]) => m.replaceWith(n));
    phoneUi.top.remove(); phoneUi.sheet.remove(); phoneUi = null;
  }
  // 아래 창: 보여줄 설정이 있을 때만
  function syncSheet() {
    if (!phoneUi) return;
    const vis = (x) => !x.hidden && (x.classList.contains('pad-grp') ? [...x.children].some((c) => !c.hidden) : true);
    phoneUi.sheet.classList.toggle('empty', ![...phoneUi.sheet.querySelectorAll(':scope > .pad-acts > *')].some(vis));
  }
  const setFull = (on, auto = false) => {
    autoFull = on && auto;
    const phone = on && isPhone();
    if (phone) enterPhoneUi(); else leavePhoneUi();
    container.closest('.modal-wrap')?.classList.toggle('pad-host-full', on); // 창 안의 작전판도 화면 전체로
    container.classList.toggle('pad-full', on);
    container.classList.toggle('pad-phone', phone);
    document.documentElement.classList.toggle('pad-locked', !!document.querySelector('.pad.pad-full'));
    container.querySelector('[data-flabel]').textContent = on ? '작게' : '크게'; // 휴대폰도 '작게' — '완료'는 확인 버튼처럼 보여서
    if (on && !phone && container.requestFullscreen && !document.fullscreenElement) container.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement === container) document.exitFullscreen().catch(() => {});
    if (!on) { view = null; closeNotes(); }
    notesBtn.hidden = !(on && noteFields().length);
    hint?.classList.toggle('gone', on);
    render();
  };
  // 세로로 들고 있을 때: '가로로 돌리면 크게' 한 번 안내 (이대로 쓰기를 누르면 다시 안 물어봄)
  const PORTRAIT_OK = 'ssaka.pad.portraitOk';
  let hint = null;
  if (COARSE && editable) {
    hint = document.createElement('div');
    hint.className = 'pad-rotate';
    hint.innerHTML = '<span><b>⟲ 가로로 돌리면</b> 작전판이 화면 전체로 커져요</span><button type="button" class="btn sm" data-rot-go>가로로 크게</button><button type="button" class="btn ghost sm" data-rot-no>이대로 쓰기</button>';
    container.insertBefore(hint, svg.nextSibling);
    const portrait = matchMedia('(orientation: portrait)');
    const syncHint = () => { let ok = false; try { ok = localStorage.getItem(PORTRAIT_OK) === '1'; } catch { /* */ } hint.hidden = ok || !portrait.matches || container.classList.contains('pad-full'); };
    syncHint();
    hint.querySelector('[data-rot-go]').onclick = () => { setFull(true); try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch { /* 지원 안 하는 폰 */ } };
    hint.querySelector('[data-rot-no]').onclick = () => { try { localStorage.setItem(PORTRAIT_OK, '1'); } catch { /* */ } document.querySelectorAll('.pad-rotate').forEach((x) => { x.hidden = true; }); };
    // 휴대폰을 돌리면: 가로 → 마지막으로 만진 작전판이 화면에 보이면 저절로 크게, 세로 → 저절로 커진 것은 원래대로
    const onRot = () => {
      if (!svg.isConnected) { portrait.removeEventListener('change', onRot); return; }
      syncHint();
      const r = svg.getBoundingClientRect();
      const onScreen = r.bottom > 0 && r.top < innerHeight && r.width > 0;
      if (!portrait.matches && activePad === padId && onScreen && !container.classList.contains('pad-full')) setFull(true, true);
      else if (portrait.matches && autoFull) setFull(false);
    };
    portrait.addEventListener('change', onRot);
  }
  // [크게] 화면에서 바로 이미지 · 영상으로 저장 (코치가 만드는 작전판만 — exportTitle)
  container.querySelectorAll('[data-xp]').forEach((b) => (b.onclick = async () => {
    const t = typeof exportTitle === 'function' ? exportTitle() : exportTitle;
    (await import('./pages/training.js')).exportPad(b.dataset.xp, clone(data), t || '작전판', b);
  }));
  const notesBtn = container.querySelector('[data-notes]');
  notesBtn.onclick = () => { if (notes) { closeNotes(); render(); } else openNotes(); };
  container.querySelector('[data-act="full"]').onclick = () => setFull(!container.classList.contains('pad-full'));
  // 키보드가 올라오면 보이는 높이(visualViewport)에 맞춰 경기장 크기 조절
  const fitKeyboard = () => container.style.setProperty('--vvh', `${Math.round(window.visualViewport?.height || innerHeight)}px`);
  window.visualViewport?.addEventListener('resize', () => { if (container.classList.contains('pad-typing')) fitKeyboard(); });
  // 글 칸을 누르면 (휴대폰 전체화면) 입력 줄을 화면 위로 — 키보드에 안 가려지게
  ['[data-ptin]', '[data-pnin]', '[data-szin]', '[data-ordin]'].forEach((q) => {
    const inp = container.querySelector(q);
    inp.addEventListener('focus', () => { container.classList.add('pad-typing'); fitKeyboard(); });
    inp.addEventListener('blur', () => setTimeout(() => { if (!container.contains(document.activeElement) || !/^INPUT$/.test(document.activeElement.tagName)) container.classList.remove('pad-typing'); }, 50));
  });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && container.classList.contains('pad-full')) setFull(false); });
  container.querySelectorAll('[data-pc]').forEach((b) => (b.onclick = () => {
    pcur = b.dataset.pc;
    const ps = selected().filter((x) => x.k === 'player');
    if (ps.length) { snapshot(); ps.forEach((x) => { x.pc = pcur; }); render(); } else syncUi();
  }));
  container.querySelectorAll('[data-team]').forEach((b) => (b.onclick = () => {
    team = b.dataset.team;
    const ps = selected().filter((x) => x.k === 'player'); // 선수 · 역할 표시 모두 (역할은 글자 그대로 색만)
    if (ps.length) { snapshot(); ps.forEach((x) => { x.team = team; }); render(); } else syncUi();
  }));
  // 선수 여러 명 한꺼번에 고르기 (휴대폰에서도 — Ctrl 없이)
  const pickPlayers = (f) => {
    const ps = data.items.filter((x) => x.k === 'player' && !x.role && visIn(x, scene) && f(x));
    if (!ps.length) return;
    sel = data.items.indexOf(ps[0]); extra.clear(); ps.slice(1).forEach((x) => extra.add(x)); render();
  };
  container.querySelector('[data-selteam]').onclick = () => { const s0 = selected().find((x) => x.k === 'player'); if (!s0) return; const k0 = colorKey(s0); pickPlayers((x) => colorKey(x) === k0); };
  container.querySelector('[data-selall]').onclick = () => pickPlayers(() => true);
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
  const del = () => { // 장면이 여러 개면 지금 장면부터 안 나오게 (앞 장면엔 그대로 남음 — 뒤 장면에서 다시 생기지 않게)
    if (sel < 0) return;
    if (!data.steps.length) { delAll(); return; }
    snapshot();
    const gone = [];
    selected().forEach((x) => {
      if ((x.from || 0) >= scene) { gone.push(x); return; } // 이 장면에서 처음 나온 것 → 완전히 지움
      x.until = x.until == null ? scene - 1 : Math.min(x.until, scene - 1);
      if (x.hide) { x.hide = x.hide.filter((h) => h < scene); if (!x.hide.length) delete x.hide; }
    });
    gone.forEach((x) => { if (x.k === 'arrow') unlinkArrow(x); });
    data.items = data.items.filter((x) => !gone.includes(x));
    sel = -1; extra.clear();
    render();
  };
  container.querySelector('[data-act="delall"]').onclick = delAll;
  // 이 장면에서만 숨김 (앞 · 뒤 장면엔 그대로)
  container.querySelector('[data-act="delonly"]').onclick = () => {
    if (sel < 0) return;
    snapshot();
    selected().forEach((x) => { x.hide = [...new Set([...(x.hide || []), scene])]; });
    sel = -1; extra.clear();
    render();
  };
  // 맨 앞으로 · 맨 뒤로 (공과 선수가 겹칠 때 등)
  const KIND_Z = { zone: 0, ladder: 0.5, vision: 0.8, arrow: 1, player: 3, ball: 4, text: 5, num: 6 };
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
  container.querySelector('[data-act="dup"]').onclick = () => { if (copy()) paste(); };
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
    if (x?.k !== 'player' && x?.k !== 'num') return;
    snapshot();
    x.n = pnIn.value.trim().slice(0, x.k === 'num' ? 3 : 4);
    render();
  };
  // 글자 고치기 (고른 글자 → 아래 칸에서 바로)
  const ptIn = container.querySelector('[data-ptin]');
  ptIn.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ptIn.blur(); } e.stopPropagation(); };
  ptIn.oninput = () => {
    const x = items()[sel];
    if (x?.k !== 'text' || !ptIn.value.trim()) return;
    if (!ptIn.dataset.snap) { snapshot(); ptIn.dataset.snap = '1'; }
    x.t = ptIn.value.slice(0, 30);
    render();
  };
  ptIn.onblur = () => { delete ptIn.dataset.snap; };
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
  container.querySelector('[data-straight]').onclick = () => { const x = items()[sel]; if (x?.k !== 'arrow') return; snapshot(); delete x.cx; delete x.cy; delete x.via; render(); };
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
  // 선수 모양: 고른 선수들을 동그라미 · 유니폼으로 (새로 놓는 선수도 같은 모양)
  container.querySelectorAll('[data-psopt]').forEach((b) => (b.onclick = () => {
    pdef = b.dataset.psopt;
    let ps = selected().filter((x) => x.k === 'player' && !x.role);
    if (!ps.length) ps = data.items.filter((x) => x.k === 'player' && !x.role); // 고른 선수가 없으면 모든 선수
    if (ps.length) { snapshot(); ps.forEach((x) => { if (pdef) x.ps = pdef; else delete x.ps; }); }
    render();
  }));
  // 무늬 · 두 번째 색 (고른 선수 · 없으면 선수 모두 — 동그라미 · 유니폼)
  const shirtTargets = () => { const sel = selected().filter((x) => x.k === 'player' && !x.role); return sel.length ? sel : data.items.filter((x) => x.k === 'player' && !x.role); };
  container.querySelectorAll('[data-spopt]').forEach((b) => (b.onclick = () => {
    sdef = b.dataset.spopt;
    const ps = shirtTargets();
    if (ps.length) { snapshot(); ps.forEach((x) => { if (sdef) { x.sp = sdef; x.pc2 ||= c2def; } else { delete x.sp; delete x.pc2; } }); }
    render();
  }));
  container.querySelectorAll('[data-pc2]').forEach((b) => (b.onclick = () => {
    c2def = b.dataset.pc2;
    const ps = shirtTargets().filter((x) => x.sp);
    if (ps.length) { snapshot(); ps.forEach((x) => { x.pc2 = c2def; }); }
    setTimeout(closePops, 0); render();
  }));
  // 역할(중립 · 서브 · 타겟 · 코치) 바꾸기
  container.querySelectorAll('[data-roleopt]').forEach((b) => (b.onclick = () => {
    const R = ROLES[b.dataset.roleopt];
    const rs = selected().filter((x) => x.k === 'player' && x.role);
    if (rs.length) { snapshot(); rs.forEach((x) => { x.role = b.dataset.roleopt; x.team = R.team; x.n = R.t; delete x.pc; }); render(); }
  }));  // 색 · 팀 색: 점을 누르면 고르는 창이 펼쳐짐
  const closePops = () => container.querySelectorAll('.pad-pop').forEach((x) => { x.hidden = true; });
  const togglePop = (q) => (e) => {
    e.stopPropagation(); const p = container.querySelector(q); const open = p.hidden; closePops(); p.hidden = !open;
    // [크게] 화면(컴퓨터): 설정 줄 안에 갇히지 않게 화면 위에 띄움
    p.style.position = p.style.left = p.style.top = '';
    if (open && !container.classList.contains('pad-phone')) { // 설정 줄이 가로 스크롤이라 그 안에 갇히지 않게 화면 위에 띄움
      const r = e.currentTarget.getBoundingClientRect();
      p.style.position = 'fixed';
      p.style.left = `${Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8))}px`;
      p.style.top = `${Math.min(r.bottom + 6, innerHeight - p.offsetHeight - 8)}px`;
    }
  };
  container.querySelector('[data-tdot]').onclick = togglePop('[data-tpop]');
  container.querySelector('[data-cdot]').onclick = togglePop('[data-cpop]');
  container.querySelector('[data-t2dot]').onclick = togglePop('[data-t2pop]');
  container.addEventListener('click', (e) => { if (e.target.closest('[data-team], [data-col], [data-pc]')) setTimeout(closePops, 0); });
  document.addEventListener('pointerdown', (e) => { if (!svg.isConnected) return; if (!e.target.closest?.('.pad-pop, [data-tdot], [data-cdot], [data-t2dot]')) closePops(); }, true);
  // 선수 연결 설정: 실선 · 점선 · 면 채우기
  container.querySelectorAll('[data-lstyle]').forEach((b) => (b.onclick = () => { const x = items()[sel]; if (x?.k !== 'link') return; snapshot(); if (b.dataset.lstyle === 'dash') x.style = 'dash'; else delete x.style; render(); }));
  container.querySelectorAll('[data-lshape]').forEach((b) => (b.onclick = () => { const x = items()[sel]; if (x?.k !== 'link') return; snapshot(); if (b.dataset.lshape === 'closed') { x.closed = true; x.area = true; } else { delete x.closed; delete x.area; } render(); }));
  container.querySelector('[data-larea]').onclick = () => { const x = items()[sel]; if (x?.k !== 'link') return; snapshot(); if (x.area) delete x.area; else x.area = true; render(); };
  // 연결 끝: 한 명만 이은 선은 지움
  function finishLink() {
    if (linking && data.items.includes(linking) && (linking.ids || []).length < 2) data.items.splice(data.items.indexOf(linking), 1);
    linking = null;
  }
  // 복사 · 붙여넣기 · 모두 고르기
  const copy = () => { const list = selected(); if (list.length) clipboard = list.map((x) => { const c = clone(x); delete c.id; return c; }); return list.length; };
  const paste = () => {
    if (!clipboard?.length) return;
    snapshot();
    const off = 2 * unit();
    const added = clipboard.map((x) => {
      const c = clone(x);
      if ('x1' in c) { c.x1 = round(c.x1 + off); c.y1 = round(c.y1 + off); c.x2 = round(c.x2 + off); c.y2 = round(c.y2 + off); if (c.cx != null) { c.cx = round(c.cx + off); c.cy = round(c.cy + off); } if (c.via) c.via = c.via.map((v) => ({ x: round(v.x + off), y: round(v.y + off) })); } else { c.x = round(c.x + off); c.y = round(c.y + off); }
      if (c.k === 'player' && !c.role) c.n = nextNum(c.team, c.pc);
      delete c.who; delete c.until; delete c.hide; // 붙여넣은 건 지금 장면부터 · 따로
      if (scene) c.from = scene; else delete c.from;
      return c;
    });
    data.items.push(...added);
    clipboard = clipboard.map((x) => { const c = clone(x); if ('x1' in c) { c.x1 += off; c.y1 += off; c.x2 += off; c.y2 += off; if (c.via) c.via = c.via.map((v) => ({ x: v.x + off, y: v.y + off })); } else { c.x += off; c.y += off; } return c; }); // 또 붙이면 조금씩 비켜서
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
      if (tool !== 'select') { finishLink(); tool = 'select'; render(); }
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
    const p = unproj(e.clientX, e.clientY, (X, Y) => new DOMPoint(X, Y).matrixTransform(world.getScreenCTM().inverse()));
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

  // ───────── 두 손가락: 확대 · 이동 ─────────
  const touches = new Map();
  let pinch = null;
  let dblTap = null; // 두 번 톡톡 → 선택 도구 { t, x, y, mark }
  const toastPad = (msg) => {
    const t = document.createElement('div'); t.className = 'pad-toast'; t.textContent = msg;
    (container.classList.contains('pad-full') ? container : document.body).appendChild(t);
    setTimeout(() => t.remove(), 1300);
  };
  let gestureMark = 0; // 첫 손가락을 댈 때의 되돌리기 위치 — 두 번째 손가락이 오면 첫 손가락이 한 것은 취소
  const userPt = (x, y) => unproj(x, y, (X, Y) => new DOMPoint(X, Y).matrixTransform(svg.getScreenCTM().inverse()));
  function startPinch() {
    const [a, b] = [...touches.values()];
    hideLoupe();
    if (drag) drag = null;
    if (history.length > gestureMark) { undo(); future.pop(); }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const bw = +baseVB.split(' ')[2];
    pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), k0: view ? bw / view[2] : 1, P0: userPt(mid.x, mid.y) };
  }
  function movePinch() {
    const [a, b] = [...touches.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const [bx, by, bw, bh] = baseVB.split(' ').map(Number);
    const k = Math.min(4, Math.max(1, (pinch.k0 * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d0));
    if (k < 1.03) { view = null; svg.setAttribute('viewBox', baseVB); zoomUi(); return; }
    const w = bw / k; const h = bh / k;
    let x = pinch.P0.x - w / 2; let y = pinch.P0.y - h / 2;
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    const P1 = userPt(mid.x, mid.y); // 손가락 가운데가 처음 잡은 자리에 오도록
    x += pinch.P0.x - P1.x; y += pinch.P0.y - P1.y;
    x = Math.min(bx + bw - w, Math.max(bx, x)); y = Math.min(by + bh - h, Math.max(by, y));
    view = [x, y, w, h].map((v) => +v.toFixed(3));
    svg.setAttribute('viewBox', view.join(' '));
    zoomUi();
  }
  if (editable) {
    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      // 첫 손가락이면 예전 손가락 기록은 지움 — 화면을 다시 그리면서 '손 뗌' 신호를 못 받은 손가락이 남아
      // 한 손가락도 두 손가락(확대)으로 잘못 처리되던 문제 (도구가 안 먹고 위아래로 끌면 확대되던 것)
      if (e.isPrimary) { touches.clear(); pinch = null; }
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // 휴대폰: 그리는 도구일 때 빈 곳 · 그림을 빠르게 두 번 톡톡 → 첫 번째 톡으로 생긴 것은 취소하고 [선택]으로
      if (touches.size === 1 && tool !== 'select') {
        const now = performance.now(); const dt = dblTap;
        if (dt && now - dt.t < 420 && Math.hypot(e.clientX - dt.x, e.clientY - dt.y) < 44) {
          dblTap = null;
          e.stopImmediatePropagation(); e.preventDefault();
          touches.delete(e.pointerId);
          while (history.length > dt.mark) { undo(); future.pop(); }
          finishLink(); drag = null; tool = 'select'; sel = -1; extra.clear();
          document.activeElement?.blur?.();
          render();
          toastPad('선택으로 돌아왔어요');
          return;
        }
        dblTap = { t: now, x: e.clientX, y: e.clientY, mark: history.length };
      } else if (touches.size > 1) dblTap = null;
      if (touches.size === 1) gestureMark = history.length;
      if (touches.size === 2) { startPinch(); e.stopImmediatePropagation(); e.preventDefault(); }
      else if (touches.size > 2) e.stopImmediatePropagation();
    });
    svg.addEventListener('pointermove', (e) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch) { e.stopImmediatePropagation(); if (touches.size >= 2) movePinch(); }
    });
    const lift = (e) => {
      if (!touches.has(e.pointerId)) return;
      touches.delete(e.pointerId);
      if (pinch) { e.stopImmediatePropagation(); if (touches.size < 2) { pinch = null; if (!touches.size) render(); } }
    };
    svg.addEventListener('pointerup', lift);
    svg.addEventListener('pointercancel', lift);
    // 손가락 아래 그림이 다시 그려져 사라져도 '손 뗌'을 놓치지 않게 창 전체에서도 받음
    const liftAny = (e) => { if (!svg.isConnected) { window.removeEventListener('pointerup', liftAny, true); window.removeEventListener('pointercancel', liftAny, true); return; } if (touches.has(e.pointerId)) lift(e); };
    window.addEventListener('pointerup', liftAny, true);
    window.addEventListener('pointercancel', liftAny, true);
  }

  // ───────── 돋보기: 손가락으로 끄는 동안 가려진 곳을 손가락 위에 크게 ─────────
  let loupe = null;
  function showLoupe(e) {
    if (!loupe) {
      loupe = document.createElement('div');
      loupe.className = 'pad-loupe';
      loupe.innerHTML = `<svg><use href="#${mk}-w"/></svg><i></i>`;
      document.body.appendChild(loupe);
    }
    const S = 112; const Z = 2.2;
    const { q, scale } = unproj(e.clientX, e.clientY, (X, Y) => { const ctm = svg.getScreenCTM(); return { q: new DOMPoint(X, Y).matrixTransform(ctm.inverse()), scale: Math.hypot(ctm.a, ctm.b) || 1 }; });
    const uw = S / Z / scale;
    const ls = loupe.firstChild;
    ls.setAttribute('viewBox', `${q.x - uw / 2} ${q.y - uw / 2} ${uw} ${uw}`);
    ls.style.background = svg.style.background;
    let top = e.clientY - S - 54;
    if (top < 6) top = e.clientY + 54;
    const left = Math.min(innerWidth - S - 6, Math.max(6, e.clientX - S / 2));
    loupe.style.left = `${left}px`; loupe.style.top = `${top}px`;
    loupe.hidden = false;
  }
  function hideLoupe() { if (loupe) loupe.hidden = true; }

  let lastTap = { t: 0, id: null };
  svg.addEventListener('pointerdown', (e) => {
    activePad = padId;
    if (anim) { stop(); render(); }
    // 같은 글자 · 선수를 0.4초 안에 두 번 누르면 바로 고치기 (화면을 다시 그려서 브라우저 더블클릭이 안 잡히던 것)
    const tg = e.target.closest?.('[data-i]');
    const tit = tg && items()[+tg.dataset.i];
    if (tit && (tit.k === 'text' || (tit.k === 'player' && !tit.role) || tit.k === 'num')) {
      const now = performance.now();
      if (lastTap.id === tit.id && now - lastTap.t < 400) {
        lastTap = { t: 0, id: null };
        e.preventDefault();
        sel = items().indexOf(tit); extra.clear(); render();
        const inp = container.querySelector(tit.k === 'text' ? '[data-ptin]' : '[data-pnin]');
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
        return;
      }
      lastTap = { t: now, id: tit.id };
    }
    svg.focus({ preventScroll: true });
    const p = pt(e);
    const gh = e.target.closest?.('[data-gh]');
    if (gh && scene > 0) {
      snapshot();
      drag = { ghost: gh.dataset.gh, start: p, gv: gh.dataset.gv != null ? +gh.dataset.gv : null, ga: gh.dataset.ga != null ? +gh.dataset.ga : null };
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
    let g = e.target.closest('[data-i]');
    if (!g && tool === 'select' && e.pointerType === 'touch') {
      // 손가락은 마우스보다 굵어서, 살짝 빗나가도 가장 가까운 선수 · 공 · 기구를 잡음
      const pos = posAt(scene); let best = null;
      data.items.forEach((x, i) => {
        if (!MOVABLE.includes(x.k) || !visIn(x, scene) || !pos[x.id]) return;
        const d = Math.hypot(pos[x.id][0] - p.x, pos[x.id][1] - p.y);
        if (d <= 2.8 * unit() * Math.max(1, x.s || 1) && (!best || d < best.d)) best = { i, d };
      });
      if (best) g = svg.querySelector(`[data-i="${best.i}"]`);
    }
    const handle = g ? e.target.getAttribute('data-handle') : null;

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
    if (tool === 'link') {
      const hitP = nearest(p, ['player'], 3.4);
      const cur = linking && data.items.includes(linking) ? linking : null;
      if (!hitP) { finishLink(); sel = -1; extra.clear(); render(); return; } // 빈 곳 → 이 선은 끝
      if (cur) {
        // 첫 선수를 다시 누르면 도형으로 닫고 끝
        if (cur.ids.length >= 3 && cur.ids[0] === hitP.it.id) { snapshot(); cur.closed = true; cur.area = true; const k = data.items.indexOf(cur); finishLink(); sel = k; extra.clear(); render(); return; }
        if (cur.ids[cur.ids.length - 1] !== hitP.it.id) { snapshot(); cur.ids.push(hitP.it.id); }
      } else {
        snapshot();
        const ln = { k: 'link', ids: [hitP.it.id], ...(ccol ? { c: ccol } : {}) };
        if (scene) ln.from = scene;
        data.items.push(ln); linking = ln;
      }
      sel = data.items.indexOf(linking); extra.clear(); render();
      return;
    }
    snapshot();
    let it;
    if (tool === 'player') it = { k: 'player', team, n: nextNum(team, pcur), x: p.x, y: p.y, ...(pdef ? { ps: pdef } : {}), ...(pcur ? { pc: pcur } : {}), ...(sdef ? { sp: sdef, pc2: c2def } : {}) };
    else if (tool.startsWith('role-')) { const rk = tool.slice(5); const R = ROLES[rk]; it = { k: 'player', role: rk, team: R.team, n: R.t, x: p.x, y: p.y }; }
    else if (EQUIP.includes(tool)) it = { k: tool, x: p.x, y: p.y };
    else if (tool === 'num') { const ns = items().filter((x) => x.k === 'num').map((x) => +x.n).filter((n) => !isNaN(n)); it = { k: 'num', n: String(ns.length ? Math.max(...ns) + 1 : 1), x: p.x, y: p.y }; }
    else if (tool === 'vision') {
      // 선수를 누르고 시작하면 그 선수를 따라다니는 시야
      const pl = nearest(p, ['player'], 3.2);
      const o = pl ? { x: pl.p[0], y: pl.p[1] } : p;
      it = { k: 'vision', x: o.x, y: o.y, ang: 0, len: 12 * unit(), spread: 50, ...(pl ? { who: pl.it.id } : {}) };
    }
    else if (tool.startsWith('zone')) {
      const shape = tool.includes('-o') ? 'ellipse' : tool.includes('-tri') ? 'tri' : tool.includes('-dia') ? 'diamond' : '';
      it = { k: 'zone', style: tool.endsWith('-dash') ? 'dash' : 'fill', ...(shape ? { shape } : {}), x: p.x, y: p.y, w: 0, h: 0 };
    }
    else if (['pass', 'run', 'dribble'].includes(tool)) it = { k: 'arrow', style: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    else if (tool === 'text') {
      // 그 자리에 '글자'를 놓고 입력 칸으로 바로 — 쓰는 대로 경기장에 보임 (휴대폰은 화면 위쪽 입력 줄)
      it = { k: 'text', t: '글자', x: p.x, y: p.y };
      setTimeout(() => { const inp = container.querySelector('[data-ptin]'); inp.focus(); inp.select(); }, 0);
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
    if (drag.it?.k === 'link') return; // 연결선은 선수를 따라다님 — 직접 옮기지 않음
    const p = pt(e);
    if (e.pointerType === 'touch') showLoupe(e);
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
        data.steps[scene - 2][id] = old?.length > 2 ? [...xy, ...old.slice(2)] : xy;
      }
      render();
      return;
    }
    if (drag.ghost) {
      // 끈 점을 곡선이 지나가도록 조절점 계산 (이전 장면 자리 → 이 장면 자리)
      const id = drag.ghost;
      const q = posAt(scene - 1)[id]; const b = posAt(scene)[id];
      const st = data.steps[scene - 1][id];
      const vs = stepPoints(q, b, st);
      if (drag.ga != null) { vs.splice(drag.ga, 0, { x: p.x, y: p.y }); drag.gv = drag.ga; drag.ga = null; } // 점 사이를 끌면 새 점
      if (drag.gv != null) vs[drag.gv] = { x: round(p.x), y: round(p.y) };
      data.steps[scene - 1][id] = [st[0], st[1], 'v', ...vs.flatMap((v) => [round(v.x), round(v.y)])];
      render();
      return;
    }
    const { it, start, orig, handle } = drag;
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (drag.stepMove) {
      const keepC = (id, xy) => { const old = data.steps[scene - 1][id]; data.steps[scene - 1][id] = old?.length > 2 ? [...xy, ...old.slice(2)] : xy; };
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
    } else if (handle === 'p1') { it.x1 = p.x; it.y1 = p.y; } else if (handle === 'p2') { it.x2 = p.x; it.y2 = p.y; } else if (/^[nq]\d+$/.test(handle || '')) {
      // 곡선 점: n = 점 사이에서 새로 만들기, q = 있는 점 옮기기 (예전 곡선은 처음 끌 때 새 방식으로 바꿈)
      if (it.cx != null && !it.via) { it.via = [bez(it, 0.5)]; delete it.cx; delete it.cy; }
      it.via ||= [];
      let k = +handle.slice(1);
      if (handle[0] === 'n') { it.via.splice(k, 0, { x: p.x, y: p.y }); drag.handle = `q${k}`; }
      it.via[k] = { x: round(p.x), y: round(p.y) };
    } else if (handle === 'vh') aimVision(it, p);
    else if (it.k === 'arrow') {
      it.x1 = round(orig.x1 + dx); it.y1 = round(orig.y1 + dy); it.x2 = round(orig.x2 + dx); it.y2 = round(orig.y2 + dy);
      if (orig.cx != null) { it.cx = round(orig.cx + dx); it.cy = round(orig.cy + dy); }
      if (orig.via) it.via = orig.via.map((v) => ({ x: round(v.x + dx), y: round(v.y + dy) }));
    } else if (it.k === 'vision' && it.who) { /* 선수에 붙은 시야는 선수를 따라감 */ } else { it.x = round(orig.x + dx); it.y = round(orig.y + dy); }
    // 함께 고른 것들도 같이 옮기기
    if (!drag.stepMove && !drag.creating && !handle) {
      drag.group?.forEach(({ m, o }) => {
        if (m.k === 'arrow') { m.x1 = round(o.x1 + dx); m.y1 = round(o.y1 + dy); m.x2 = round(o.x2 + dx); m.y2 = round(o.y2 + dy); if (o.cx != null) { m.cx = round(o.cx + dx); m.cy = round(o.cy + dy); } if (o.via) m.via = o.via.map((v) => ({ x: round(v.x + dx), y: round(v.y + dy) })); } else if (!(m.k === 'vision' && m.who)) { m.x = round(o.x + dx); m.y = round(o.y + dy); }
      });
    }
    render();
  });

  const end = () => {
    hideLoupe();
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
    if (gh && scene > 0) { // 흰 점 더블클릭 → 그 점만 지움 (다 지우면 직선)
      const id = gh.dataset.gh; const st = data.steps[scene - 1][id];
      if (st?.length > 2 && gh.dataset.gv != null) {
        snapshot();
        const vs = stepPoints(posAt(scene - 1)[id], posAt(scene)[id], st); vs.splice(+gh.dataset.gv, 1);
        data.steps[scene - 1][id] = vs.length ? [st[0], st[1], 'v', ...vs.flatMap((v) => [round(v.x), round(v.y)])] : [st[0], st[1]];
        render();
      }
      return;
    }
    const g = e.target.closest('[data-i]');
    if (!g) return;
    const it = items()[+g.dataset.i];
    const hq = e.target.getAttribute('data-handle');
    if (it.k === 'arrow' && /^q\d+$/.test(hq || '')) { // 화살표 흰 점 더블클릭 → 그 점만 지움
      snapshot();
      if (it.via) { it.via.splice(+hq.slice(1), 1); if (!it.via.length) delete it.via; } else { delete it.cx; delete it.cy; }
      render();
      return;
    }
    if ((it.k === 'player' && !it.role) || it.k === 'num' || it.k === 'text') {
      // 두 번 누르면 아래(휴대폰은 위쪽) 입력 칸에서 바로 고치기
      sel = items().indexOf(it); extra.clear(); render();
      const inp = container.querySelector(it.k === 'text' ? '[data-ptin]' : '[data-pnin]');
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    }
  });

  return api;
}
