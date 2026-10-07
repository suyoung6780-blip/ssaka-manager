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
  el('rect', { x: 0, y: 0, width: w, height: h }, L);

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

function wavy(x1, y1, x2, y2, u) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.max(2, Math.floor(len / (2.2 * u)));
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  let d = `M ${x1} ${y1}`;
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * (len - 2 * u);
    const off = i === n ? 0 : (i % 2 ? 1 : -1) * 0.8 * u;
    d += ` L ${x1 + ux * t - uy * off} ${y1 + uy * t + ux * off}`;
  }
  return `${d} L ${x2} ${y2}`;
}

function drawItem(layer, it, i, T, u, selected, mk) {
  const g = el('g', { 'data-i': i, class: `it it-${it.k}${selected ? ' sel' : ''}` }, layer);
  const ring = (r) => selected && el('circle', { cx: it.x, cy: it.y, r, fill: 'none', stroke: '#4ea1ff', 'stroke-width': 0.3 * u, 'stroke-dasharray': `${u} ${u * 0.6}` }, g);
  switch (it.k) {
    case 'player': {
      const tm = TEAMS[it.team] || TEAMS.a;
      const r = 2.1 * u;
      el('circle', { cx: it.x, cy: it.y, r, fill: tm.fill, stroke: tm.stroke, 'stroke-width': 0.3 * u }, g);
      const t = el('text', { x: it.x, y: it.y + 0.75 * u, 'text-anchor': 'middle', 'font-size': (String(it.n).length > 2 ? 1.5 : 2.1) * u, fill: tm.text, 'font-weight': 800 }, g);
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
      el('path', { d: `M ${it.x} ${it.y - s} L ${it.x + s * 0.9} ${it.y + s * 0.7} L ${it.x - s * 0.9} ${it.y + s * 0.7} Z`, fill: '#ff8a00', stroke: '#7a3e00', 'stroke-width': 0.2 * u }, g);
      ring(2 * u);
      break;
    }
    case 'marker':
      el('ellipse', { cx: it.x, cy: it.y, rx: 1.1 * u, ry: 0.6 * u, fill: '#f5c400', stroke: '#6b5600', 'stroke-width': 0.2 * u }, g);
      ring(1.8 * u);
      break;
    case 'minigoal':
    case 'goal': {
      const big = it.k === 'goal';
      const gw = big ? 7.32 : 3 * u;
      const gd = big ? 2 : 1.2 * u;
      const rot = it.rot || 0;
      const gg = el('g', { transform: `rotate(${rot} ${it.x} ${it.y})` }, g);
      el('rect', { x: it.x - gd / 2, y: it.y - gw / 2, width: gd, height: gw, fill: 'rgba(255,255,255,.25)', stroke: T.ink, 'stroke-width': 0.35 * u }, gg);
      for (let k = 1; k < 4; k++) el('line', { x1: it.x - gd / 2, y1: it.y - gw / 2 + (gw / 4) * k, x2: it.x + gd / 2, y2: it.y - gw / 2 + (gw / 4) * k, stroke: T.ink, 'stroke-width': 0.12 * u, opacity: 0.6 }, gg);
      ring(gw / 2 + u);
      break;
    }
    case 'zone': {
      const dash = it.style === 'dash';
      el('rect', {
        x: it.x, y: it.y, width: it.w, height: it.h,
        fill: dash ? 'rgba(229,72,77,.06)' : T.zone,
        stroke: dash ? '#e5484d' : 'none', 'stroke-width': 0.35 * u, 'stroke-dasharray': dash ? `${u * 1.2} ${u * 0.8}` : '',
      }, g);
      if (selected) {
        el('rect', { x: it.x, y: it.y, width: it.w, height: it.h, fill: 'none', stroke: '#4ea1ff', 'stroke-width': 0.3 * u, 'stroke-dasharray': `${u} ${u * 0.6}` }, g);
        el('circle', { cx: it.x + it.w, cy: it.y + it.h, r: 1.1 * u, fill: '#4ea1ff', 'data-handle': 'size' }, g);
      }
      break;
    }
    case 'arrow': {
      const color = T.ink;
      const common = { stroke: color, 'stroke-width': 0.45 * u, fill: 'none', 'marker-end': `url(#${mk})`, 'stroke-linecap': 'round' };
      if (it.style === 'dribble') el('path', { d: wavy(it.x1, it.y1, it.x2, it.y2, u), ...common }, g);
      else el('line', { x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, ...common, 'stroke-dasharray': it.style === 'run' ? `${u * 1.2} ${u * 0.9}` : '' }, g);
      el('line', { x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, stroke: 'transparent', 'stroke-width': 2.4 * u }, g);
      if (selected) {
        el('circle', { cx: it.x1, cy: it.y1, r: 1 * u, fill: '#4ea1ff', 'data-handle': 'p1' }, g);
        el('circle', { cx: it.x2, cy: it.y2, r: 1 * u, fill: '#4ea1ff', 'data-handle': 'p2' }, g);
      }
      break;
    }
    case 'text': {
      const t = el('text', { x: it.x, y: it.y, 'text-anchor': 'middle', 'font-size': 2.4 * u, 'font-weight': 800, fill: T.ink }, g);
      t.textContent = it.t;
      if (selected) {
        const b = { w: Math.max(4, String(it.t).length * 2.2) * u, h: 3.4 * u };
        el('rect', { x: it.x - b.w / 2, y: it.y - b.h * 0.75, width: b.w, height: b.h, fill: 'none', stroke: '#4ea1ff', 'stroke-width': 0.3 * u, 'stroke-dasharray': `${u} ${u * 0.6}` }, g);
      }
      break;
    }
    default:
  }
}

const TOOLS = [
  ['select', '선택·이동', '⬚'],
  ['player', '선수', '●'],
  ['cone', '콘', '▲'],
  ['marker', '마커', '◒'],
  ['ball', '공', '⚽'],
  ['minigoal', '미니골대', '⊓'],
  ['goal', '골대', '⊔'],
  ['zone', '영역', '▭'],
  ['zone-dash', '점선 영역', '⬚'],
  ['pass', '패스', '→'],
  ['run', '이동', '⇢'],
  ['dribble', '드리블', '↝'],
  ['text', '글자', 'T'],
];

export function createPad(container, initial, { editable = true } = {}) {
  let data = normalize(initial);
  let tool = 'select';
  let team = 'a';
  let sel = -1;
  const history = [];
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
      ${TOOLS.map(([k, l, ic]) => `<button type="button" class="ptool" data-tool="${k}" title="${l}"><b>${ic}</b>${l}</button>`).join('')}
    </div>
    <div class="pad-teams" data-teams>${Object.entries(TEAMS).map(([k, t]) => `<button type="button" class="pteam" data-team="${k}" style="--c:${t.fill};--t:${t.text}">${t.label}</button>`).join('')}<small>선수 색</small></div>
    <div class="pad-acts">
      <button type="button" class="chip" data-act="rotate">회전</button>
      <button type="button" class="chip" data-act="delete">선택 삭제</button>
      <button type="button" class="chip" data-act="undo">되돌리기</button>
      <button type="button" class="chip" data-act="clear">모두 지우기</button>
      <small class="muted" data-hint></small>
    </div>` : '';

  const svg = el('svg', { class: 'pad-svg', tabindex: editable ? 0 : -1 });
  container.appendChild(svg);

  const snapshot = () => { history.push(JSON.stringify(data)); if (history.length > 80) history.shift(); };
  // 작은 그리드 훈련장에서도 선수·콘이 너무 작아지지 않게 하한을 둔다
  const unit = () => Math.max(0.55, Math.max(data.field.w, data.field.h) / 105);
  const items = () => data.items;
  const nextNum = (tm) => {
    const nums = items().filter((x) => x.k === 'player' && x.team === tm).map((x) => +x.n).filter((n) => !isNaN(n));
    return String(nums.length ? Math.max(...nums) + 1 : 1);
  };

  function render() {
    const { w, h } = data.field;
    const u = unit();
    const T = THEME[data.field.color] || THEME.dark;
    const m = Math.max(3 * u, 2.6);
    svg.setAttribute('viewBox', `${-m} ${-m} ${w + 2 * m} ${h + 2 * m}`);
    svg.style.background = T.out;
    svg.innerHTML = '';
    el('defs', {}, svg).innerHTML = `<marker id="${mk}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${T.ink}"/></marker>`;
    drawField(el('g', {}, svg), data, T, u);
    const layer = el('g', {}, svg);
    // 그리는 순서: 영역 → 화살표 → 장비 → 선수 → 공 → 글자
    const order = { zone: 0, arrow: 1, cone: 2, marker: 2, minigoal: 2, goal: 2, player: 3, ball: 4, text: 5 };
    items().map((it, i) => [it, i]).sort((a, b) => order[a[0].k] - order[b[0].k])
      .forEach(([it, i]) => drawItem(layer, it, i, T, u, editable && i === sel, mk));
    if (editable) syncUi();
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
    container.querySelectorAll('[data-team]').forEach((b) => b.classList.toggle('on', b.dataset.team === team));
    container.querySelector('[data-teams]').hidden = tool !== 'player';
    const s = items()[sel];
    container.querySelector('[data-act="rotate"]').hidden = !(s && (s.k === 'goal' || s.k === 'minigoal'));
    container.querySelector('[data-act="delete"]').hidden = !s;
    container.querySelector('[data-hint]').textContent = {
      select: '끌어서 이동 · 더블클릭으로 번호/글자 수정 · Delete 키로 삭제',
      player: '필드를 누르면 선수가 놓입니다 (번호 자동)',
      zone: '끌어서 영역 그리기', 'zone-dash': '끌어서 영역 그리기',
      pass: '끌어서 화살표 그리기', run: '끌어서 화살표 그리기', dribble: '끌어서 화살표 그리기',
      text: '필드를 누르고 글자 입력',
    }[tool] || '필드를 누르면 놓입니다';
  }

  render();
  if (!editable) return { getData: () => clone(data) };

  // ───────── 필드 · 그리드 설정 ─────────
  const resize = (nw, nh) => {
    const { w, h } = data.field;
    const sx = nw / w;
    const sy = nh / h;
    data.items.forEach((it) => {
      if ('x' in it) { it.x = round(it.x * sx); it.y = round(it.y * sy); }
      if (it.k === 'zone') { it.w = round(it.w * sx); it.h = round(it.h * sy); }
      if (it.k === 'arrow') { it.x1 = round(it.x1 * sx); it.y1 = round(it.y1 * sy); it.x2 = round(it.x2 * sx); it.y2 = round(it.y2 * sy); }
    });
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
  container.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => { tool = b.dataset.tool; sel = -1; render(); }));
  container.querySelectorAll('[data-team]').forEach((b) => (b.onclick = () => { team = b.dataset.team; syncUi(); }));
  const del = () => {
    if (sel < 0) return;
    snapshot();
    data.items.splice(sel, 1);
    sel = -1;
    render();
  };
  container.querySelector('[data-act="delete"]').onclick = del;
  container.querySelector('[data-act="rotate"]').onclick = () => {
    const s = items()[sel];
    if (!s) return;
    snapshot();
    s.rot = ((s.rot || 0) + 90) % 360;
    render();
  };
  container.querySelector('[data-act="undo"]').onclick = () => {
    if (!history.length) return;
    data = JSON.parse(history.pop());
    sel = -1;
    render();
  };
  container.querySelector('[data-act="clear"]').onclick = () => { snapshot(); data.items = []; sel = -1; render(); };
  svg.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0) { e.preventDefault(); del(); }
  });

  // ───────── 포인터 ─────────
  const pt = (e) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    const { w, h } = data.field;
    const m = Math.max(3 * unit(), 2.6);
    return { x: round(Math.max(-m, Math.min(w + m, p.x))), y: round(Math.max(-m, Math.min(h + m, p.y))) };
  };
  let drag = null;

  svg.addEventListener('pointerdown', (e) => {
    svg.focus({ preventScroll: true });
    const p = pt(e);
    const g = e.target.closest('[data-i]');
    const handle = e.target.getAttribute('data-handle');

    if (tool === 'select') {
      if (!g) { sel = -1; render(); return; }
      sel = +g.dataset.i;
      const it = items()[sel];
      snapshot();
      drag = { it, start: p, orig: clone(it), handle };
      svg.setPointerCapture(e.pointerId);
      render();
      return;
    }
    snapshot();
    let it;
    if (tool === 'player') it = { k: 'player', team, n: nextNum(team), x: p.x, y: p.y };
    else if (['cone', 'marker', 'ball', 'minigoal', 'goal'].includes(tool)) it = { k: tool, x: p.x, y: p.y };
    else if (tool === 'zone' || tool === 'zone-dash') it = { k: 'zone', style: tool === 'zone-dash' ? 'dash' : 'fill', x: p.x, y: p.y, w: 0, h: 0 };
    else if (['pass', 'run', 'dribble'].includes(tool)) it = { k: 'arrow', style: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    else if (tool === 'text') {
      const t = prompt('필드에 쓸 글자');
      if (!t) { history.pop(); return; }
      it = { k: 'text', t: t.slice(0, 30), x: p.x, y: p.y };
    }
    if (!it) return;
    data.items.push(it);
    sel = data.items.length - 1;
    if (it.k === 'zone' || it.k === 'arrow') {
      drag = { it, start: p, creating: true };
      svg.setPointerCapture(e.pointerId);
    }
    render();
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = pt(e);
    const { it, start, orig, handle } = drag;
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (drag.creating) {
      if (it.k === 'zone') {
        it.x = Math.min(start.x, p.x); it.y = Math.min(start.y, p.y);
        it.w = round(Math.abs(dx)); it.h = round(Math.abs(dy));
      } else { it.x2 = p.x; it.y2 = p.y; }
    } else if (handle === 'size') {
      it.w = round(Math.max(1, orig.w + dx)); it.h = round(Math.max(1, orig.h + dy));
    } else if (handle === 'p1') { it.x1 = p.x; it.y1 = p.y; } else if (handle === 'p2') { it.x2 = p.x; it.y2 = p.y; } else if (it.k === 'arrow') {
      it.x1 = round(orig.x1 + dx); it.y1 = round(orig.y1 + dy); it.x2 = round(orig.x2 + dx); it.y2 = round(orig.y2 + dy);
    } else { it.x = round(orig.x + dx); it.y = round(orig.y + dy); }
    render();
  });

  const end = () => {
    if (!drag) return;
    const { it, creating } = drag;
    const u = unit();
    // 너무 작게 그려진 영역/화살표는 취소
    if (creating && ((it.k === 'zone' && (it.w < u || it.h < u)) || (it.k === 'arrow' && Math.hypot(it.x2 - it.x1, it.y2 - it.y1) < 1.5 * u))) {
      data.items.splice(data.items.indexOf(it), 1);
      history.pop();
      sel = -1;
    } else if (!creating && JSON.stringify(it) === JSON.stringify(drag.orig)) {
      history.pop(); // 클릭만 하고 안 움직임
    }
    drag = null;
    render();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  svg.addEventListener('dblclick', (e) => {
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

  return { getData: () => clone(data) };
}
