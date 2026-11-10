// 영상 분석 엔진 — 프레임 분석(크로마키 마스크), 선수 트래킹, 원근 그리드(호모그래피), 그림 렌더링
// 모든 좌표는 영상 기준 0~1 정규화 좌표. 점은 {x, y} 또는 추적 대상에 붙은 {tr: id}.

export const GLASS = 'rgba(255,255,255,0.42)'; // 투명색 (반투명 흰색)
export const PALETTE = ['#ffd400', '#ff3b30', '#ffffff', '#00d1ff', '#34c759', GLASS];
// 그림 스타일 색 (중계 화면에서 많이 쓰는 색 + 팀 색 + 투명)
export const STYLE_COLORS = ['#ffd400', '#ffb020', '#ff7a00', '#ff3b30', '#e4002b', '#ff2d92', '#af52de', '#7c4dff', '#1e4fd8', '#0a2a6b', '#4ea1ff', '#00d1ff', '#00c7a3', '#34c759', '#0b6e3b', '#a3e635', '#ffffff', '#c7cdd1', '#8e8e93', '#3a3a3c', '#111111', GLASS];
// 유니폼 색 고르기용 (트래킹 링 안쪽 · 바깥 · 이름표)
export const TEAM_COLORS = ['#ffffff', '#ffd400', '#ff9f0a', '#ff3b30', '#c8102e', '#ff2d92', '#af52de', '#1e4fd8', '#0a2a6b', '#00d1ff', '#34c759', '#0b6e3b', '#8e8e93', '#111111'];
export const uid = () => Math.random().toString(36).slice(2, 9);

// ───────── 호모그래피 (원근 그리드 · 거리 측정) ─────────
function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export function homography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

export function project(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

const UNIT = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

// ───────── 경기장 맞추기 (캘리브레이션) ─────────
// 멈춘 화면에서 실제 크기를 아는 네모(페널티박스 등)의 네 모서리를 맞추면, 그 장면의 그림이 진짜 원근으로 잔디 위에 깔림
// 바닥 좌표(m): X = 골라인에서 앞으로(깊이), Y = 골라인을 따라. q[0]=(0,0) q[1]=(w,0) q[2]=(w,h) q[3]=(0,h) → q[0]–q[3] 이 골라인
// 경기장 맞추기 기준: 화면에 보이는 선의 네 점 → 바닥(m)
//  X = 골라인에서 앞으로(깊이), Y = 골라인을 따라(가로) · goal: 골대가 X=0 (full 은 X=w 에도) · sized: 크기를 적는 기준
export const CAL_TPL = {
  box: { l: '페널티박스', w: 16.5, h: 40.32, goal: true, d: '골라인 · 박스 네 모서리' },
  six: { l: '골 에어리어', w: 5.5, h: 18.32, goal: true, d: '골 에어리어 네 모서리' },
  center: { l: '하프라인 · 센터서클', w: 18.3, h: 68, sized: true, d: '하프라인 양 끝(터치라인과 만나는 곳) · 원 양쪽 끝' }, // 원만 쓰면 앞뒤(깊이)가 크게 틀려서 하프라인 끝까지
  half: { l: '반쪽 경기장', w: 52.5, h: 68, goal: true, sized: true, d: '골라인 두 코너 · 하프라인 양 끝' },
  full: { l: '경기장 전체', w: 105, h: 68, goal: true, sized: true, d: '네 코너' },
  rect: { l: '직접 입력', w: 20, h: 20, sized: true, d: '아는 크기의 네모' },
};
// 경기장 규격: 11인제(국제 규칙) · 8인제(대한축구협회 8인제 경기 규칙 2022 — 터치라인 62~68 · 골라인 46~50 · 페널티 에어리어 12.5 · 골 에어리어 4.5 · 페널티 마크 8.5 · 센터서클/아크 7 · 골대 5.7m)
export const PITCH = {
  11: { l: '11인제', L: 105, W: 68, r: 9.15, goal: 7.32, box: 16.5, six: 5.5, spot: 11 },
  8: { l: '8인제', L: 65, W: 48, r: 7, goal: 5.7, box: 12.5, six: 4.5, spot: 8.5 },
};
export const pitchOf = (c) => PITCH[c?.pitch === 8 || c?.pitch === '8' ? 8 : 11];
export const calSize = (c) => {
  const P0 = pitchOf(c); const t = CAL_TPL[c.tpl] || CAL_TPL.box;
  if (c.tpl === 'box') return { w: P0.box, h: P0.goal + P0.box * 2 }; // 박스 가로 = 골대 + 양쪽 박스 깊이
  if (c.tpl === 'six') return { w: P0.six, h: P0.goal + P0.six * 2 };
  if (c.tpl === 'center') return { w: P0.r * 2, h: +c.h || P0.W };
  if (c.tpl === 'half') return { w: +c.w || P0.L / 2, h: +c.h || P0.W };
  if (c.tpl === 'full') return { w: +c.w || P0.L, h: +c.h || P0.W };
  return t.sized ? { w: +c.w || t.w, h: +c.h || t.h } : { w: t.w, h: t.h };
};
// 네 점이 바닥의 어디인지 (센터서클은 마름모: 하프라인 먼 끝 · 원 오른쪽 · 하프라인 가까운 끝 · 원 왼쪽)
export const calSrc = (c) => { const { w, h } = calSize(c); const r = pitchOf(c).r; return c.tpl === 'center' ? [{ x: 0, y: -h / 2 }, { x: r, y: 0 }, { x: 0, y: h / 2 }, { x: -r, y: 0 }] : [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]; };
// 처음 점 자리 (기준을 바꿀 때)
export const calDefaultQ = (tpl) => (tpl === 'center' ? [{ x: 0.5, y: 0.3 }, { x: 0.64, y: 0.47 }, { x: 0.5, y: 0.82 }, { x: 0.36, y: 0.47 }] : [{ x: 0.3, y: 0.4 }, { x: 0.58, y: 0.4 }, { x: 0.7, y: 0.8 }, { x: 0.18, y: 0.8 }]);
// c: { q: 화면 네 점(0~1) } → { G(X,Y) 바닥→화면 px, S(px) 화면→바닥 }
export function calFrom(c, Wpx, Hpx) {
  if (!c?.q || c.q.length !== 4) return null;
  const { w, h } = calSize(c);
  const src = calSrc(c);
  const dst = c.q.map((p) => ({ x: p.x * Wpx, y: p.y * Hpx }));
  const Hg = homography(src, dst);
  const Hs = homography(dst, src);
  if (!Hg || !Hs) return null;
  return { G: (X, Y) => project(Hg, X, Y), S: (p) => project(Hs, p.x, p.y), w, h, W: Wpx, H: Hpx, src: c };
}
// 지금 장면에 맞춘 원근 (그리는 동안만 쓰는 값 — 스튜디오가 장면마다 정해 줌)
let CAL = null;
export function setCal(c) { CAL = c; }
export const getCal = () => CAL;
// 바닥 위 점들 → 화면 px
const gpath = (ctx, pts, close = true) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (close) ctx.closePath(); };
// 바닥의 원 (반지름 r m) → 화면 다각형
const gcircle = (C, r, n = 56) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return CAL.G(C.x + Math.cos(a) * r, C.y + Math.sin(a) * r); });
// 바닥 1m 가 이 자리에서 화면 몇 px 인지 (굵기 · 그림자 크기를 원근에 맞추는 데 씀)
const pxPerM = (C) => { const a = CAL.G(C.x, C.y); const b = CAL.G(C.x, C.y + 1); const c2 = CAL.G(C.x + 1, C.y); return (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c2.x - a.x, c2.y - a.y)) / 2; };

// 맞추기 안내선 (수정 화면에서만): 네모 + 골라인 + 박스 안 골 에어리어 · 페널티 지점 · 아크, 바깥으로 길게 뻗은 보조선
export function drawCalGuide(ctx, c, Wpx, Hpx, active) {
  const cal = calFrom(c, Wpx, Hpx);
  if (!cal) return;
  const { w, h } = cal; const P0 = pitchOf(c); const R0 = P0.r; const GH = P0.goal / 2;
  const L = (pts) => pts.map(([X, Y]) => cal.G(X, Y));
  const lw = Math.max(1.5, Wpx / 700);
  ctx.save();
  ctx.lineJoin = 'round';
  const blue = active ? '#00d1ff' : 'rgba(0,209,255,0.8)';
  const thin = (pts, close = false) => { gpath(ctx, L(pts), close); ctx.stroke(); };
  const arcPts = (cx, cy, r, a0, a1, n = 40) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
  const goalAt = (X, dir = 1) => { // 골대 (노랑) · 골 에어리어 · 페널티박스 · 지점 · 아크 — 반쪽 · 전체 경기장 안내용
    const cy = h / 2; const g0 = cal.G(X, cy - GH); const g1 = cal.G(X, cy + GH); const BH = GH + P0.box; const SH = GH + P0.six;
    ctx.strokeStyle = 'rgba(0,209,255,0.7)'; ctx.lineWidth = lw * 1.3;
    thin([[X, cy - BH], [X + dir * P0.box, cy - BH], [X + dir * P0.box, cy + BH], [X, cy + BH]]);
    thin([[X, cy - SH], [X + dir * P0.six, cy - SH], [X + dir * P0.six, cy + SH], [X, cy + SH]]);
    const a0 = Math.acos(Math.min(1, (P0.box - P0.spot) / R0)); thin(arcPts(X + dir * P0.spot, cy, R0, dir > 0 ? -a0 : Math.PI - a0, dir > 0 ? a0 : Math.PI + a0));
    ctx.strokeStyle = '#ffd400'; ctx.lineWidth = lw * 4; ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.stroke();
  };
  if (c.tpl === 'center') {
    // 하프라인 (흰색, 길게) · 센터서클 · 가운데 점
    ctx.setLineDash([lw * 4, lw * 4]); ctx.strokeStyle = 'rgba(0,209,255,0.55)'; ctx.lineWidth = lw; thin([[-40, 0], [40, 0]]); thin([[-40, -h / 2], [40, -h / 2]]); thin([[-40, h / 2], [40, h / 2]]); ctx.setLineDash([]); // 터치라인 (보조)
    ctx.strokeStyle = blue; ctx.lineWidth = lw * 2; thin(arcPts(0, 0, R0, 0, Math.PI * 2, 64), true);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw * 3.2; thin([[0, -h / 2], [0, h / 2]]);
    const s0 = cal.G(0, 0); ctx.fillStyle = '#00d1ff'; ctx.beginPath(); ctx.arc(s0.x, s0.y, lw * 2.4, 0, Math.PI * 2); ctx.fill();
  } else {
    // 보조선: 네 변을 화면 밖까지 길게 (영상의 선과 겹치는지 보기 쉽게)
    ctx.setLineDash([lw * 4, lw * 4]);
    ctx.strokeStyle = 'rgba(0,209,255,0.55)';
    ctx.lineWidth = lw;
    [[[0, -60], [0, h + 60]], [[w, -60], [w, h + 60]], [[-40, 0], [w + 60, 0]], [[-40, h], [w + 60, h]]].forEach((seg) => { gpath(ctx, L(seg), false); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.strokeStyle = blue; ctx.lineWidth = lw * 2;
    gpath(ctx, L([[0, 0], [w, 0], [w, h], [0, h]])); ctx.stroke();
    if (CAL_TPL[c.tpl]?.goal) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw * 3.2; thin([[0, 0], [0, h]]); if (c.tpl === 'full') thin([[w, 0], [w, h]]); }
    ctx.strokeStyle = 'rgba(0,209,255,0.75)'; ctx.lineWidth = lw * 1.4;
    if (c.tpl === 'box') {
      const sw2 = P0.goal + P0.six * 2; const y0 = (h - sw2) / 2;
      gpath(ctx, L([[0, y0], [P0.six, y0], [P0.six, y0 + sw2], [0, y0 + sw2]]), false); ctx.stroke();
      const s1 = cal.G(P0.spot, h / 2); ctx.fillStyle = '#00d1ff'; ctx.beginPath(); ctx.arc(s1.x, s1.y, lw * 2.4, 0, Math.PI * 2); ctx.fill();
      const arc = []; const a0 = Math.acos(Math.min(1, (w - P0.spot) / R0));
      for (let i = 0; i <= 24; i++) { const a = -a0 + (i / 24) * 2 * a0; arc.push(cal.G(P0.spot + Math.cos(a) * R0, h / 2 + Math.sin(a) * R0)); }
      gpath(ctx, arc, false); ctx.stroke();
      const g0 = cal.G(0, h / 2 - GH); const g1 = cal.G(0, h / 2 + GH);
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = lw * 4; ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.stroke();
    } else if (c.tpl === 'six') {
      const g0 = cal.G(0, h / 2 - GH); const g1 = cal.G(0, h / 2 + GH);
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = lw * 4; ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.stroke();
    } else if (c.tpl === 'half') {
      goalAt(0, 1);
      ctx.strokeStyle = 'rgba(0,209,255,0.75)'; ctx.lineWidth = lw * 1.4; thin(arcPts(w, h / 2, R0, Math.PI / 2, Math.PI * 1.5)); // 하프라인 쪽 센터서클 반
    } else if (c.tpl === 'full') {
      goalAt(0, 1); goalAt(w, -1);
      ctx.strokeStyle = 'rgba(0,209,255,0.75)'; ctx.lineWidth = lw * 1.4; thin([[w / 2, 0], [w / 2, h]]); thin(arcPts(w / 2, h / 2, R0, 0, Math.PI * 2, 64), true);
    }
  }
  // 모서리 손잡이 · 골라인 글자
  c.q.forEach((p, i) => {
    const x = p.x * Wpx; const y = p.y * Hpx; const r = Math.max(7, Wpx / 120);
    ctx.fillStyle = (c.tpl === 'center' ? i === 0 || i === 2 : i === 0 || i === 3) ? '#ffffff' : '#00d1ff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  });
  if (c.tpl === 'center') { const m = cal.G(0, -12); label(ctx, '하프라인', m.x, m.y, Wpx, '#ffffff'); }
  else if (CAL_TPL[c.tpl]?.goal) { const m = cal.G(-1.2, h / 2); label(ctx, '골라인', m.x, m.y, Wpx, '#ffffff'); }
  ctx.restore();
}

// ───────── 프레임 분석 ─────────
export class FrameAnalyzer {
  constructor(width = 480) {
    this.AW = width;
    this.AH = 270;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.mask = document.createElement('canvas');
    this.mctx = this.mask.getContext('2d');
    this.prevProf = null; // 카메라 움직임 추정용 직전 프레임 프로필
    this.cam = { dx: 0, dy: 0 };
    this.ok = false;
  }

  resize(vw, vh) {
    this.AH = Math.max(2, Math.round((this.AW * vh) / vw));
    this.prevProf = null;
    this.canvas.width = this.mask.width = this.AW;
    this.canvas.height = this.mask.height = this.AH;
  }

  // 현재 영상 프레임을 작게 읽어서 잔디 마스크(크로마키용) 생성
  grab(video, key) {
    const { AW, AH } = this;
    try {
      this.ctx.drawImage(video, 0, 0, AW, AH);
      this.img = this.ctx.getImageData(0, 0, AW, AH);
    } catch {
      this.ok = false; // CORS 등으로 픽셀을 못 읽는 경우
      return false;
    }
    const d = this.img.data;
    const n = AW * AH;
    const g = new Uint8Array(n); // 잔디 픽셀
    const sh = new Uint8Array(n); // 잔디 위 그림자 (잔디처럼 보고 그림을 가리지 않음)
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      g[i] = isGrass(d[p], d[p + 1], d[p + 2], key) ? 1 : 0;
      if (!g[i] && isShadow(d[p], d[p + 1], d[p + 2], key)) sh[i] = 1;
    }
    this.grass = g; this.shadow = sh;
    // 경기장 범위: 세로줄 · 가로줄마다 잔디가 몇 칸 이어지는 처음 ~ 끝. 그 밖(관중석 · 트랙 · 광고판)은
    // 선수가 아니니 그림을 가리지 않음 → 화살표가 경기장 밖으로 나가도 그대로 보임
    const R = Math.max(3, Math.round(AH * 0.015));
    const span = (len, at) => {
      let lo = -1; let hi = -1; let run = 0;
      for (let i = 0; i < len; i++) { run = at(i) ? run + 1 : 0; if (run >= R) { lo = i - R + 1; break; } }
      run = 0;
      for (let i = len - 1; i >= 0; i--) { run = at(i) ? run + 1 : 0; if (run >= R) { hi = i + R - 1; break; } }
      return [lo, hi];
    };
    const colSpan = Array.from({ length: AW }, (_, x) => span(AH, (y) => g[y * AW + x]));
    // 세로줄마다 잔디가 시작하는 높이 (0~1) — 오프사이드 · 경기장 밖으로 안 나가게 자를 때 (튀는 값은 주변 중간값으로)
    { const raw = colSpan.map(([ct]) => (ct >= 0 ? ct / AH : 1)); const R2 = 6;
      this.fieldTop = raw.map((_, i) => { const w = raw.slice(Math.max(0, i - R2), i + R2 + 1).sort((a, b) => a - b); return w[w.length >> 1]; }); }
    const rowSpan = Array.from({ length: AH }, (_, y) => span(AW, (x) => g[y * AW + x]));
    // 경기장 안에서 잔디가 아닌 곳 후보
    const cand = new Uint8Array(n);
    for (let y = 0, i = 0; y < AH; y++) {
      const [rl, rh] = rowSpan[y];
      for (let x = 0; x < AW; x++, i++) {
        const [ct, cb] = colSpan[x];
        const onPitch = ct >= 0 && rl >= 0 && y >= ct && y <= cb && x >= rl && x <= rh;
        cand[i] = onPitch && !g[i] && !sh[i] ? 1 : 0;
      }
    }
    // 경기장 흰 라인은 빼기: 밝고 색이 옅으면서 가는 것(세로 두께 3칸 이하 · 가로 두께 2칸 이하)
    // — 라인이 선수 발과 붙어서 '선수 덩어리'로 잡히면 그 위를 지나는 선 · 면이 끊겨 보임
    {
      const vr = new Uint8Array(n); const hr = new Uint8Array(n);
      for (let x = 0; x < AW; x++) { let y = 0; while (y < AH) { if (!cand[y * AW + x]) { y++; continue; } let e = y; while (e < AH && cand[e * AW + x]) e++; const L = Math.min(255, e - y); for (let k = y; k < e; k++) vr[k * AW + x] = L; y = e; } }
      for (let y = 0; y < AH; y++) { let x = 0; while (x < AW) { if (!cand[y * AW + x]) { x++; continue; } let e = x; while (e < AW && cand[y * AW + e]) e++; const L = Math.min(255, e - x); for (let k = x; k < e; k++) hr[y * AW + k] = L; x = e; } }
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        if (!cand[i] || (vr[i] > 3 && hr[i] > 2)) continue;
        const r = d[p]; const g2 = d[p + 1]; const b = d[p + 2];
        const mx = Math.max(r, g2, b); const mn = Math.min(r, g2, b);
        if (mx > 140 && mx - mn < 70) cand[i] = 0;
      }
    }
    // 그 중 '선수처럼 생긴 덩어리'만 그림을 가림 — 흰 라인 · 그림자 · 잔디 얼룩 · 작은 점은 무시 (화살표에 구멍이 나지 않게)
    const occ = playerBlobs(cand, AW, AH);
    // 진짜 선수만 남김: 발밑에 잔디가 있어야 하고(나무 · 펜스 · 관중석 빼기), 라인처럼 가늘고 길거나 하얗고 속이 빈 것은 빼기
    keepRealPlayers(occ, d, g, sh, AW, AH);
    // 선수 모양을 꽉 채움: 몸 안의 작은 틈(잔디색으로 보인 반바지 · 팔 사이 등)을 메워서 면 · 선 위에 선수가 구멍처럼 보이지 않고 통째로 앞에 서게
    closeGaps(occ, AW, AH, 3, 5);
    this.cand = cand;
    const m = this.mctx.createImageData(AW, AH);
    this.maskImg = m;
    const md = m.data;
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      md[p] = md[p + 1] = md[p + 2] = 255;
      md[p + 3] = occ[i] ? 0 : 255;
    }
    this.mctx.putImageData(m, 0, 0);
    this.ok = true;
    this.estimateCamera();
    return true;
  }

  // 선수 정중앙 · 발끝 찾기: 점(nx, ny = 발밑 근처)과 키(hN, 화면 높이 비율) 주변에서 잔디가 아닌 몸 픽셀을 모아
  // 몸이 있는 세로줄들의 가운데(x)와 가장 아래(발끝 y)를 돌려줌. 가는 가로줄(라인)은 세로로 짧아서 빠짐
  centerAt(nx, ny, hN) {
    if (!this.ok || !this.cand) return null;
    const { AW, AH } = this;
    const hp = Math.max(6, (hN || 0.08) * AH);
    const cx = nx * AW; const cy = ny * AH;
    const x0 = Math.max(0, Math.floor(cx - hp * 0.45)); const x1 = Math.min(AW - 1, Math.ceil(cx + hp * 0.45));
    const y0 = Math.max(0, Math.floor(cy - hp * 1.05)); const y1 = Math.min(AH - 1, Math.ceil(cy + hp * 0.12));
    if (x1 <= x0 || y1 <= y0) return null;
    let sw = 0; let sx = 0; let foot = -1; let top = AH;
    const need = Math.max(3, hp * 0.18);
    for (let x = x0; x <= x1; x++) {
      let run = 0; let best = 0; let n = 0; let low = -1; let hi = -1;
      for (let y = y0; y <= y1; y++) {
        if (this.cand[y * AW + x]) { run++; n++; low = y; if (hi < 0) hi = y; if (run > best) best = run; } else run = 0;
      }
      if (best >= need) { sw += n; sx += n * x; if (low > foot) foot = low; if (hi < top) top = hi; }
    }
    if (sw < hp * hp * 0.05) return null; // 몸이 거의 안 보이면 그대로
    return { x: (sx / sw + 0.5) / AW, y: (foot + 1) / AH, h: (foot + 1 - top) / AH };
  }

  // 트래킹 중인 선수 네모(정규화 x0,y0,x1,y1) 안의 잔디 아닌 픽셀은 무조건 그림 앞으로 (덩어리 판단이 틀려도 확실하게)
  occludeBoxes(boxes) {
    if (!this.ok || !this.cand || !this.maskImg || !boxes.length) return;
    const { AW, AH } = this;
    const md = this.maskImg.data;
    for (const b of boxes) {
      if ((b.y1 - b.y0) < 0.05) continue; // 멀리 있는 작은 선수는 앞으로 안 보냄 (선이 끊겨 보이지 않게)
      const x0 = Math.max(0, Math.floor(b.x0 * AW) - 1); const x1 = Math.min(AW - 1, Math.ceil(b.x1 * AW) + 1);
      const y0 = Math.max(0, Math.floor(b.y0 * AH) - 1); const y1 = Math.min(AH - 1, Math.ceil(b.y1 * AH) + 1);
      // 몸통(네모 위쪽 82%)은 어두운 유니폼도 앞으로 · 발밑 아래쪽은 그림자라 가리지 않음
      // 단, 어두운 색은 그 줄에서 선수 몸(잔디 아닌 색)이 실제로 있는 폭 안에서만 — 어두운 잔디 줄무늬가 그림을 가리지 않게
      const yb = y0 + Math.round((y1 - y0) * 0.82);
      const bw = x1 - x0 + 1; const pad = Math.max(1, Math.round(bw * 0.08));
      let pl = -1; let pr = -1; // 바로 윗줄의 몸 폭 (반바지처럼 줄 전체가 어두운 경우 이어 쓰기)
      for (let y = y0; y <= y1; y++) {
        let l = -1; let r = -1;
        for (let x = x0; x <= x1; x++) { const i = y * AW + x; if (this.cand[i]) { md[i * 4 + 3] = 0; if (l < 0) l = x; r = x; } }
        if (l < 0 && pl >= 0) { l = pl; r = pr; }
        if (y <= yb && l >= 0 && this.shadow) for (let x = Math.max(x0, l - pad); x <= Math.min(x1, r + pad); x++) { const i = y * AW + x; if (this.shadow[i]) md[i * 4 + 3] = 0; }
        if (l >= 0) { pl = l; pr = r; }
      }
    }
    this.mctx.putImageData(this.maskImg, 0, 0);
  }

  // 직전 프레임 대비 화면 전체가 얼마나 이동했는지 (정규화 좌표). 카메라 패닝 보정용.
  // 640px 프레임의 세로줄/가로줄 밝기 프로필을 서로 맞춰서 1/2픽셀 단위로 추정
  estimateCamera() {
    const { AW, AH } = this;
    const d = this.img.data;
    const col = new Float32Array(AW);
    const row = new Float32Array(AH);
    for (let y = 0; y < AH; y += 2) {
      for (let x = 0; x < AW; x += 1) {
        const p = (y * AW + x) * 4;
        const g = d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11;
        col[x] += g;
        row[y] += g;
      }
    }
    const grad = (a) => { const o = new Float32Array(a.length); for (let i = 1; i < a.length; i++) o[i] = a[i] - a[i - 1]; return o; };
    // 장면 전환(편집 컷) 감지용: 듬성듬성 뽑은 밝기
    const sparse = new Uint8Array(Math.ceil(AW / 8) * Math.ceil(AH / 8));
    let si = 0;
    for (let y = 0; y < AH; y += 8) for (let x = 0; x < AW; x += 8) { const p = (y * AW + x) * 4; sparse[si++] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8; }
    let diff = 0;
    if (this.prevSparse && this.prevSparse.length === sparse.length) {
      for (let i = 0; i < sparse.length; i++) diff += Math.abs(sparse[i] - this.prevSparse[i]);
      diff /= sparse.length;
    }
    this.prevSparse = sparse;
    this.diff = diff;
    const cur = { c: grad(col), r: grad(row) };
    const prev = this.prevProf;
    this.prevProf = cur;
    this.cam = { dx: 0, dy: 0 };
    if (!prev) return;
    const shift = (a, b, M) => {
      const costs = [];
      for (let s = -M; s <= M; s++) {
        let c = 0;
        let n = 0;
        for (let i = M; i < a.length - M; i++) { c += Math.abs(a[i] - b[i - s]); n++; }
        costs.push(c / n);
      }
      let bi = 0;
      for (let i = 1; i < costs.length; i++) if (costs[i] < costs[bi]) bi = i;
      let sub = 0;
      if (bi > 0 && bi < costs.length - 1) {
        const [l, m, r] = [costs[bi - 1], costs[bi], costs[bi + 1]];
        const den = l - 2 * m + r;
        if (den > 0) sub = (0.5 * (l - r)) / den;
      }
      return bi - M + sub;
    };
    const sx = shift(cur.c, prev.c, 24);
    const sy = shift(cur.r.filter((_, i) => i % 2 === 0), prev.r.filter((_, i) => i % 2 === 0), 8);
    // 화면 전체가 한꺼번에 바뀜(편집 컷) 또는 탐색 끝까지 밀린 값 → 장면 전환 (평소 패닝은 차이 4 안팎, 컷은 14 안팎)
    this.cut = this.diff > 11 || Math.abs(sx) > 22 || Math.abs(sy) > 7;
    this.cam = this.cut ? { dx: 0, dy: 0 } : { dx: sx / AW, dy: sy / (AH / 2) };
  }

  // 잔디가 시작되는 높이 (원근: 이 선에서 멀수록 선수가 크게 보임)
  horizon() {
    if (!this.img) return null;
    const { AW, AH } = this;
    const g = this.grass;
    if (!g) return null;
    for (let y = 0; y < AH; y += 2) {
      let n = 0;
      for (let x = 0; x < AW; x += 4) if (g[y * AW + x]) n++;
      if (n > AW / 4 * 0.55) return y / AH;
    }
    return null;
  }

  // 영상 아래쪽 2/3 에서 가장 많은 초록 계열 색상 → 잔디 기준색 자동 추정
  autoHue() {
    if (!this.img) return null;
    const { AW, AH } = this;
    const bins = new Float32Array(36);
    const d = this.img.data;
    for (let y = Math.floor(AH / 3); y < AH; y += 2) {
      for (let x = 0; x < AW; x += 2) {
        const p = (y * AW + x) * 4;
        const h = hueOf(d[p], d[p + 1], d[p + 2]);
        if (h >= 50 && h <= 180) bins[Math.floor(h / 10)] += 1;
      }
    }
    let best = -1;
    let bi = 0;
    for (let i = 5; i < 18; i++) { const v = bins[i - 1] * 0.5 + bins[i] + (bins[i + 1] || 0) * 0.5; if (v > best) { best = v; bi = i; } }
    return best > 50 ? bi * 10 + 5 : null;
  }
}

// 잔디 아닌 픽셀 덩어리 중 선수 모양(세로로 서 있고 · 속이 차 있고 · 너무 작지 않은 것)만 남김
// 1차: 그대로 덩어리를 나눠 선수 모양이면 남김 (멀리 있는 가는 선수도 그대로 살아남게)
// 2차: 선수 모양이 아닌 큰 덩어리(선수 + 라인 · 그림자가 붙은 것)만 가는 부분을 깎아 다시 나눠 봄
function blobsOf(mask, W, H, only = null) {
  const n = W * H;
  const lab = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const list = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (!mask[s0] || lab[s0] >= 0 || (only && !only[s0])) continue;
    const id = list.length;
    let sp = 0; stack[sp++] = s0; lab[s0] = id;
    let x0 = W; let x1 = 0; let y0 = H; let y1 = 0;
    const px = [];
    while (sp) {
      const i = stack[--sp];
      const x = i % W; const y = (i - x) / W;
      px.push(i);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) if (j >= 0 && mask[j] && lab[j] < 0 && (!only || only[j])) { lab[j] = id; stack[sp++] = j; }
    }
    list.push({ px, x0, x1, y0, y1 });
  }
  return list;
}
function looksPlayer(b, H) {
  const bw = b.x1 - b.x0 + 1; const bh = b.y1 - b.y0 + 1;
  const fill = b.px.length / (bw * bh);
  const minH = Math.max(5, H * 0.016);
  return bh >= minH && b.px.length >= minH * 1.5 && bh >= bw * 0.45 && fill >= 0.15 && bh < H * 0.75 && bw < H * 0.5;
}
function keepRealPlayers(occ, d, g, sh, W, H) {
  // 경기장이 시작되는 줄 (잔디가 절반 넘게 깔린 첫 줄) — 발이 그보다 위면 선수가 아님 (나무 · 펜스 · 둑)
  let top = 0;
  for (let y = 0; y < H; y += 2) { let n = 0; for (let x = 0; x < W; x += 4) if (g[y * W + x]) n++; if (n > (W / 4) * 0.55) { top = y; break; } }
  for (const b of blobsOf(occ, W, H)) {
    const bw = b.x1 - b.x0 + 1; const bh = b.y1 - b.y0 + 1;
    // 멀리 있는 작은 선수는 선보다 가늘어서, 앞으로 보내면 선이 뚝 끊겨 보임 → 그림 위로 그냥 지나가게
    let bad = bh < Math.max(10, H * 0.05) || bh > bw * 7 || bw > bh * 2.6; // 작음 · 라인 · 그물처럼 너무 길쭉하거나 옆으로 넓음
    if (!bad) { // 거의 하얗고 속이 빈 덩어리 = 라인 조각
      let wt = 0;
      for (const i of b.px) { const p = i * 4; const mx = Math.max(d[p], d[p + 1], d[p + 2]); const mn = Math.min(d[p], d[p + 1], d[p + 2]); if (mx > 135 && mx - mn < 60) wt++; }
      if (wt / b.px.length > 0.55 && (b.px.length / (bw * bh) < 0.5 || bh < 12)) bad = true;
    }
    if (!bad && b.y1 < top - 2) bad = true;
    if (!bad && b.y1 < H - 3) { // 발밑(바로 아래 4줄)에 잔디나 그림자가 있어야 선수 — 나무 · 펜스 · 벽 위는 아님
      let gr = 0; let tot = 0;
      for (let y = b.y1 + 1; y <= Math.min(H - 1, b.y1 + 4); y++) for (let x = b.x0; x <= b.x1; x++) { tot++; if (g[y * W + x] || sh[y * W + x]) gr++; }
      if (tot && gr / tot < 0.25) bad = true;
    }
    if (bad) { for (const i of b.px) occ[i] = 0; continue; }
    // 발밑에서 옆으로 길게 깔린 진한 그림자는 선수가 아님 — 몸통(위쪽 60%)의 가로 범위 밖에 있는 아래쪽 어두운 픽셀은 뺌
    // (그림자까지 선수로 보면 그 위를 지나는 선 · 면이 크게 끊김)
    const yCut = b.y0 + Math.round(bh * 0.6);
    let lx = W; let rx = -1;
    for (const i of b.px) { const y = (i / W) | 0; if (y >= yCut) continue; const x = i - y * W; if (x < lx) lx = x; if (x > rx) rx = x; }
    if (rx >= lx) {
      const pad = Math.max(2, Math.round((rx - lx + 1) * 0.25));
      for (const i of b.px) {
        const y = (i / W) | 0; if (y < yCut) continue;
        const x = i - y * W; if (x >= lx - pad && x <= rx + pad) continue;
        const p = i * 4; const mx = Math.max(d[p], d[p + 1], d[p + 2]); const mn = Math.min(d[p], d[p + 1], d[p + 2]);
        if ((mx < 110 && (mx - mn) < Math.max(28, mx * 0.45)) || (mx > 150 && mx - mn < 60)) occ[i] = 0; // 그림자 · 발에 붙은 흰 라인
      }
    }
  }
}

function closeGaps(m, W, H, gx, gy) {
  for (let y = 0; y < H; y++) {
    let last = -1;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!m[i]) continue;
      if (last >= 0 && x - last > 1 && x - last - 1 <= gx) for (let k = last + 1; k < x; k++) m[y * W + k] = 2;
      last = x;
    }
  }
  for (let x = 0; x < W; x++) {
    let last = -1;
    for (let y = 0; y < H; y++) {
      const i = y * W + x;
      if (!m[i]) continue;
      if (last >= 0 && y - last > 1 && y - last - 1 <= gy) for (let k = last + 1; k < y; k++) m[k * W + x] = 2;
      last = y;
    }
  }
}

function playerBlobs(cand0, W, H) {
  const n = W * H;
  const keep = new Uint8Array(n);
  const rest = new Uint8Array(n); // 2차로 다시 볼 덩어리
  const minH = Math.max(5, H * 0.016);
  for (const b of blobsOf(cand0, W, H)) {
    if (looksPlayer(b, H)) for (const i of b.px) keep[i] = 1;
    else if (b.px.length >= minH * 3 && b.y1 - b.y0 + 1 >= minH) for (const i of b.px) rest[i] = 1;
  }
  // 2차: 3×3 열기로 3픽셀보다 가는 것(라인 · 그물 · 얇은 그림자)을 떼어 내고 다시 나눔
  const er = new Uint8Array(n);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    er[i] = rest[i] && rest[i - 1] && rest[i + 1] && rest[i - W] && rest[i + W] && rest[i - W - 1] && rest[i - W + 1] && rest[i + W - 1] && rest[i + W + 1] ? 1 : 0;
  }
  const op = new Uint8Array(n);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (er[i]) { op[i] = op[i - 1] = op[i + 1] = op[i - W] = op[i + W] = op[i - W - 1] = op[i - W + 1] = op[i + W - 1] = op[i + W + 1] = 1; }
  }
  const keep2 = new Uint8Array(n);
  for (const b of blobsOf(op, W, H)) if (looksPlayer(b, H)) for (const i of b.px) keep2[i] = 1;
  // 2차로 찾은 선수는 둘레 2픽셀 안의 원래 픽셀(가는 팔다리 · 윤곽)을 되살림
  let cur = keep2;
  for (let r = 0; r < 2; r++) {
    const nx = Uint8Array.from(cur);
    for (let i = 0; i < n; i++) {
      if (!cur[i]) continue;
      const x = i % W;
      if (x > 0) nx[i - 1] = 1; if (x < W - 1) nx[i + 1] = 1;
      if (i >= W) nx[i - W] = 1; if (i < n - W) nx[i + W] = 1;
    }
    cur = nx;
  }
  // 모든 선수: 둘레 1픽셀 넓혀서 윤곽이 깔끔하게
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!(keep[i] || keep2[i] || (cur[i] && rest[i]))) continue;
    out[i] = 1;
    const x = i % W;
    if (x > 0) out[i - 1] = 1; if (x < W - 1) out[i + 1] = 1;
    if (i >= W) out[i - W] = 1; if (i < n - W) out[i + W] = 1;
  }
  return out;
}

function hueOf(r, g, b) {
  const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
  const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
  const c = max - min;
  if (max < 16 || c < max * 0.16) return -1; // 너무 어둡거나 무채색
  let h;
  if (max === r) h = 60 * (((g - b) / c) % 6);
  else if (max === g) h = 60 * ((b - r) / c + 2);
  else h = 60 * ((r - g) / c + 4);
  return h < 0 ? h + 360 : h;
}

// 잔디 위 그림자: 어둡고, 색이 옅거나(회색빛) 잔디 쪽 색 — 선수 · 기둥 그림자가 그림을 가리지 않게
export function isShadow(r, g, b, key) {
  const v = r > g ? (r > b ? r : b) : (g > b ? g : b);
  if (v > 125) return false; // 밝으면 그림자가 아님
  const h = hueOf(r, g, b);
  if (h < 0) return v >= 58; // 어둡고 회색빛 (아주 까만 건 검은 유니폼일 수 있어 그대로 선수로)
  let dh = Math.abs(h - key.hue);
  if (dh > 180) dh = 360 - dh;
  return dh <= 34 + key.tol * 0.7; // 어두운 잔디색
}

export function isGrass(r, g, b, key) {
  const h = hueOf(r, g, b);
  if (h < 0) return false;
  let dh = Math.abs(h - key.hue);
  if (dh > 180) dh = 360 - dh;
  const tol = 14 + key.tol * 0.5;
  if (dh <= tol) return true;
  // 햇빛 받은 잔디: 노란빛 쪽으로 조금 더 넓게 — 대신 연한 색만 (진한 노랑 · 연두 유니폼은 그대로 선수)
  // (노란빛 잔디를 선수로 잘못 보면 그 위의 선 · 발밑 원이 통째로 숨어 버림)
  const toward = (key.hue - h + 360) % 360; // 잔디 색보다 노란 쪽으로 얼마나
  if (toward > tol && toward <= tol + 22) {
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b); const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    if (mx > 70 && (mx - mn) / mx < 0.55) return true;
  }
  return false;
}

// ───────── 선수 트래킹 ─────────
// 원본 영상에서 선수 주변만 읽어 처리:
//  1) 카메라 패닝 + 선수 속도로 다음 위치 예측
//  2) 예측 위치 주변에서 유니폼 색 분포(상의/하의)가 가장 비슷한 곳 찾기 (가까울수록 유리 → 같은 팀 선수로 튀는 것 방지)
//  3) 그 자리에서 몸 덩어리를 다시 측정해 정확한 발 위치로 (가로 라인은 지움)
//  4) 잠깐 놓쳐도 예측 경로로 이어가다가 다시 찾음

// 잔디 아닌 픽셀 → 세로 닫기(작은 틈 메우기) → 세로 열기(가로 라인처럼 얇은 것 지우기)
function bodyMask(d, w, h, key, t) {
  let m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = isGrass(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], key) ? 0 : 1;
  const vmorph = (src, r, dilate) => {
    const o = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let v = dilate ? 0 : 1;
        for (let k = -r; k <= r; k++) {
          const yy = y + k;
          const s2 = yy < 0 || yy >= h ? 0 : src[yy * w + x];
          if (dilate ? s2 : !s2) { v = dilate ? 1 : 0; break; }
        }
        o[y * w + x] = v;
      }
    }
    return o;
  };
  m = vmorph(vmorph(m, t, true), t, false);
  return vmorph(vmorph(m, t + 1, false), t + 1, true);
}

export class PlayerTracker {
  constructor() {
    this.c = document.createElement('canvas');
    this.ctx = this.c.getContext('2d', { willReadFrequently: true });
  }

  // 영상의 (x0,y0,w,h) 영역을 배율 k 로 읽기
  read(video, x0, y0, w, h, k = 1) {
    const ow = Math.max(1, Math.round(w * k));
    const oh = Math.max(1, Math.round(h * k));
    if (this.c.width < ow) this.c.width = ow;
    if (this.c.height < oh) this.c.height = oh;
    this.ctx.clearRect(0, 0, ow, oh);
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.filter = k < 0.8 ? 'blur(0.5px)' : 'none'; // 축소할 때 계단현상 줄이기
    this.ctx.drawImage(video, x0, y0, w, h, 0, 0, ow, oh);
    this.ctx.filter = 'none';
    return { w: ow, h: oh, d: this.ctx.getImageData(0, 0, ow, oh).data };
  }

  // 클릭 지점에서 선수의 발 위치 · 키 찾기.
  // 잔디 아닌 픽셀 → 세로 방향 닫기(작은 틈 메우기) · 열기(가로 라인 같은 얇은 것 지우기) → 클릭에 가장 가까운 덩어리
  // hh: 이 선수의 평소 키(영상 px, 알면) — 발끝에서 그만큼 올라간 몸통으로 좌우 중심을 잡음
  measure(video, cx, cy, key, hz = null, hh = null) {
    const m1 = this.measureK(video, cx, cy, key, hz, 1, hh);
    if (m1 && m1.ph >= 26) return m1;
    // 멀리 있는(작게 보이는) 선수: 주변만 2배 확대해서 다시 — 가는 다리 · 몸이 잡음으로 지워지지 않게
    const m2 = this.measureK(video, cx, cy, key, hz, 2, hh);
    return m2 || m1;
  }
  measureK(video, cx, cy, key, hz, K, hh = null) {
    const VW = video.videoWidth;
    const VH = video.videoHeight;
    const box0 = Math.round(VH * (K > 1 ? 0.12 : 0.24));
    const X0 = Math.max(0, Math.round(cx - box0 / 2));
    const Y0 = Math.max(0, Math.round(cy - box0 * 0.85));
    const W0 = Math.min(box0, VW - X0);
    const H0 = Math.min(box0, VH - Y0);
    const rd = this.read(video, X0, Y0, W0, H0, K);
    const d = rd.d; const w = rd.w; const h = rd.h;
    const box = box0 * K; const x0 = 0; const y0 = 0;
    cx = (cx - X0) * K; cy = (cy - Y0) * K;
    const t = K > 1 ? Math.max(1, Math.round(VH / 480)) : Math.max(2, Math.round(VH / 240)); // 확대했을 땐 가늘게
    const fg = bodyMask(d, w, h, key, t);
    const lx = Math.round(cx - x0);
    const ly = Math.round(cy - y0);
    let seed = -1;
    for (let r = 0; r <= 14 && seed < 0; r++) {
      for (let dy = -r; dy <= r && seed < 0; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = lx + dx; const y = ly + dy;
          if (x >= 0 && y >= 0 && x < w && y < h && fg[y * w + x]) { seed = y * w + x; break; }
        }
      }
    }
    if (seed < 0) return null;
    const seen = new Uint8Array(w * h);
    const q = [seed];
    seen[seed] = 1;
    let x1 = w; let y1 = h; let x2 = 0; let y2 = 0; let n = 0; let sx = 0;
    const gapY = Math.max(2, Math.round(VH / 180) * K);
    const rows = new Float32Array(h);
    const rowsN = new Uint16Array(h);
    while (q.length) {
      const i = q.pop();
      const x = i % w; const y = (i / w) | 0;
      n++; sx += x; rows[y] += x; rowsN[y]++;
      if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      // 위아래로는 작은 틈(상의 · 하의 · 양말 사이)을 건너 이어 붙임 — 몸이 끊겨 키를 반만 재지 않게
      for (let dy = -gapY; dy <= gapY; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dy) > 1 && dx !== 0) continue;
          const xx = x + dx; const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (!seen[j] && fg[j]) { seen[j] = 1; q.push(j); }
        }
      }
    }
    let ph = y2 - y1 + 1;
    let top = y1;
    // 원근 기준 키 범위: 잔디 시작선(hz)에서 아래로 내려올수록 크게 보인다
    if (hz != null) {
      const below = (cy / K + Y0 - hz * VH) * K;
      if (below > 10) {
        const maxH = below * 0.8;
        const minH = below * 0.18;
        if (ph > maxH) { top = y2 + 1 - Math.round(maxH); ph = Math.round(maxH); } // 뒤쪽 사람들과 붙은 경우 아래쪽만
        if (ph < minH) { top = y2 + 1 - Math.round(minH); ph = Math.round(minH); }
      }
    }
    if (ph < (K > 1 ? 9 : 8) || x2 - x1 + 1 > ph * 1.8) return null;
    // 몸 중심: 평소 키(hh)를 알면 몸통(어깨 ~ 엉덩이) 행들의 가운데값 — 다리 · 발밑 그림자는 뛸 때마다 좌우로 벌어짐
    // 몸통 자리는 발끝에서 키만큼 올라가서 잡음 (머리 쪽이 뒤 사람과 붙어도 흔들리지 않게). 모르면 아래쪽 2/3 행
    const mid = (a, b) => { const cs = []; for (let y = Math.max(0, a); y <= Math.min(h - 1, b); y++) if (rowsN[y]) cs.push(rows[y] / rowsN[y]); cs.sort((p, q) => p - q); return cs.length >= 3 ? cs[cs.length >> 1] : null; };
    const hk = hh ? hh * K : 0;
    const mx = (hk > 12 ? mid(y2 - Math.round(hk * 0.86), y2 - Math.round(hk * 0.48)) : null) ?? mid(y2 - Math.round(ph * 0.66), y2) ?? sx / n;
    return { x: X0 + (x0 + mx) / K, y: Y0 + (y0 + y2 + 1) / K, ph: Math.min(ph, box * 0.95) / K };
  }

  // 유니폼 색 분포 (잔디 제외) — 위(상의) / 아래(하의·양말) 따로 48칸씩
  hist(d, w, x0, y0, tw, th, key) {
    const hst = new Float32Array(96);
    const n = [0, 0];
    const split = y0 + th * 0.55;
    for (let y = y0; y < y0 + th; y++) {
      const half = y < split ? 0 : 1;
      for (let x = x0; x < x0 + tw; x++) {
        const p = (y * w + x) * 4;
        const r = d[p]; const g = d[p + 1]; const b = d[p + 2];
        if (isGrass(r, g, b, key)) continue;
        const max = Math.max(r, g, b); const min = Math.min(r, g, b);
        let bin;
        if (max < 60) bin = 44; // 검정
        else if (max - min < max * 0.22) bin = max > 170 ? 45 : 46; // 흰색 / 회색
        else bin = Math.min(35, Math.floor(hueOf(r, g, b) / 10));
        hst[half * 48 + bin] += 1;
        n[half]++;
      }
    }
    for (let i = 0; i < 96; i++) hst[i] /= Math.max(1, n[i < 48 ? 0 : 1]);
    return { hst, n: n[0] + n[1] };
  }

  init(video, nx, ny, key, hz = null) {
    const VW = video.videoWidth;
    const VH = video.videoHeight;
    const m = this.measure(video, nx * VW, ny * VH, key, hz);
    const st = m ? { x: m.x, y: m.y, ph: m.ph } : { x: nx * VW, y: ny * VH, ph: VH * 0.06 };
    Object.assign(st, { vx: 0, vy: 0, miss: 0, hz, ph0: st.ph });
    const b = this.box(st);
    const r = this.read(video, b.x0, b.y0, b.tw, b.th, 1);
    st.hist = this.hist(r.d, r.w, 0, 0, r.w, r.h, key).hst;
    return st;
  }

  // 사용자가 네모로 감싼 선수로 시작 (네모 아래변 = 발, 높이 = 키)
  initBox(video, a, b, key, hz = null) {
    const VW = video.videoWidth;
    const VH = video.videoHeight;
    const x0 = Math.min(a.x, b.x) * VW;
    const x1 = Math.max(a.x, b.x) * VW;
    const y0 = Math.min(a.y, b.y) * VH;
    const y1 = Math.max(a.y, b.y) * VH;
    const ph = Math.max(8, y1 - y0);
    const st = { x: (x0 + x1) / 2, y: y1, ph };
    // 네모 안에서 몸을 다시 재서 발 위치만 살짝 보정
    const m = this.measure(video, st.x, y1 - ph * 0.1, key, hz);
    if (m && Math.abs(m.ph - ph) < ph * 0.35 && Math.abs(m.x - st.x) < (x1 - x0) * 0.4) { st.x = m.x; st.y = Math.min(y1 + ph * 0.05, m.y); }
    Object.assign(st, { vx: 0, vy: 0, miss: 0, hz, ph0: ph });
    const r = this.read(video, x0, y0, Math.max(4, x1 - x0), Math.max(6, y1 - y0), 1);
    st.hist = this.hist(r.d, r.w, 0, 0, r.w, r.h, key).hst;
    return st;
  }

  box(st) {
    const th = Math.max(8, Math.round(st.ph * 1.05));
    const tw = Math.max(6, Math.round(st.ph * 0.5));
    return { tw, th, x0: st.x - tw / 2, y0: st.y - th };
  }

  // 한 프레임 진행. dt: 이전 처리 이후 흐른 시간(초), cam: 카메라 이동(정규화)
  step(video, st, key, dt, cam = { dx: 0, dy: 0 }) {
    const VW = video.videoWidth;
    const VH = video.videoHeight;
    const t = Math.min(dt, 0.5);
    const camX = cam.dx * VW;
    const camY = cam.dy * VH;
    const px = st.x + camX + st.vx * t;
    const py = st.y + camY + st.vy * t;
    const R = Math.min(VH * 0.3, st.ph * 0.7 + Math.hypot(st.vx, st.vy) * t * 1.3 + Math.min(st.miss, 12) * st.ph * 0.35 + 4);
    const b = this.box(st);
    const x0 = Math.max(0, px - b.tw / 2 - R);
    const y0 = Math.max(0, py - b.th - R * 0.7);
    const x1 = Math.min(VW, px + b.tw / 2 + R);
    const y1 = Math.min(VH, py + R * 0.7);
    if (x1 - x0 < b.tw || y1 - y0 < b.th) return null;
    const k = Math.min(2.5, 26 / st.ph); // 큰 선수는 줄이고, 작은 선수는 확대해서 비교
    const r = this.read(video, x0, y0, x1 - x0, y1 - y0, k);
    const tw = Math.max(4, Math.round(b.tw * k));
    const th = Math.max(6, Math.round(b.th * k));
    const stp = Math.max(1, Math.round(tw / 6));
    const H = st.hist;
    if (!st.hist0) st.hist0 = Float32Array.from(H);
    const H0 = st.hist0; // 처음 잡은 모습 — 겹친 뒤 다른 선수로 옮겨 타지 않게
    let best = -1;
    let bx = -1;
    let by = -1;
    let bestBc = 0;
    for (let y = 0; y <= r.h - th; y += stp) {
      for (let x = 0; x <= r.w - tw; x += stp) {
        const { hst, n } = this.hist(r.d, r.w, x, y, tw, th, key);
        if (n < tw * th * 0.12) continue;
        let bc = 0; let bc0 = 0;
        for (let i = 0; i < 96; i++) { bc += Math.sqrt(hst[i] * H[i]); bc0 += Math.sqrt(hst[i] * H0[i]); }
        bc = (bc * 0.6 + bc0 * 0.4) / 2;
        // 같은 팀(같은 색) 선수가 옆에 있으면 색만으론 구분이 안 됨 → 움직임으로 예상한 자리를 더 믿음
        const dist = Math.hypot(x0 + (x + tw / 2) / k - px, y0 + (y + th) / k - py) / Math.max(R, st.ph * 0.4);
        const score = bc - dist * 0.15;
        if (score > best) { best = score; bestBc = bc; bx = x; by = y; }
      }
    }
    if (bx < 0 || bestBc < (st.ph < 30 ? 0.36 : 0.42)) {
      // 놓침: 카메라 이동 + 예측 경로로 잠깐 이어감
      st.miss++;
      st.x = px; st.y = py;
      st.vx *= 0.7; st.vy *= 0.7;
      // 놓쳐도 포기하지 않음: 예측 위치를 돌려주고 다음 프레임에 더 넓게 다시 찾음
      return { x: st.x / VW, y: st.y / VH, ok: false, score: bestBc };
    }
    let nx = x0 + (bx + tw / 2) / k;
    let ny = y0 + (by + th) / k;
    // 그 자리에서 몸을 다시 측정해 정확한 발 위치 · 중심으로
    const m = this.measure(video, nx, ny - st.ph * 0.15, key, st.hz); // 재생 중 색 추적은 아래쪽 행 기준이 덜 흔들림 (몸통 기준은 AI 추적에서만)
    if (m && Math.abs(m.ph - st.ph) < st.ph * 0.45 && Math.hypot(m.x - nx, m.y - ny) < st.ph * 0.5) {
      nx = m.x; ny = m.y;
      // 멀어지거나 가까워지면 크기도 천천히 따라감 (다리 들기 등 순간 측정값에 휘둘리지 않게 프레임당 1%, 처음 크기의 0.6~1.6배)
      if (Math.abs(m.ph - st.ph) < st.ph * 0.3) {
        const target = Math.min(st.ph * 1.02, Math.max(st.ph * 0.98, m.ph));
        st.ph = Math.min(st.ph0 * 2.2, Math.max(st.ph0 * 0.35, target));
      }
    }
    if (dt > 0) {
      const a = 0.7 / Math.max(1, st.miss + 1); // 움직임 변화에 빠르게 반응
      const ivx = (nx - st.x - camX) / dt;
      const ivy = (ny - st.y - camY) / dt;
      const lim = st.ph * 6; // 한 번에 튀는 값 제한 (초당 키의 6배)
      st.vx = st.vx * (1 - a) + Math.max(-lim, Math.min(lim, ivx)) * a;
      st.vy = st.vy * (1 - a) + Math.max(-lim, Math.min(lim, ivy)) * a;
    }
    st.x = nx; st.y = ny; st.miss = 0;
    // 확실할 때만 색 분포를 천천히 갱신 (조명 · 그늘 변화 대응)
    if (bestBc > 0.7) {
      const bb = this.box(st);
      const cr = this.read(video, bb.x0, bb.y0, bb.tw, bb.th, Math.min(2.5, 26 / st.ph));
      const cur = this.hist(cr.d, cr.w, 0, 0, cr.w, cr.h, key).hst;
      for (let i = 0; i < 96; i++) H[i] = H[i] * 0.88 + cur[i] * 0.12;
    }
    return { x: nx / VW, y: ny / VH, ok: true, score: bestBc };
  }
}

// ───────── 추적 대상 위치 ─────────
export function trackerPos(tr, t) {
  const p = tr.path;
  if (!p.length) return null;
  const camOf = (q) => (q.length >= 6 ? { cx: q[4], cy: q[5] } : {});
  if (t <= p[0][0]) return { x: p[0][1], y: p[0][2], h: p[0][3], ...camOf(p[0]) };
  const last = p[p.length - 1];
  if (t >= last[0]) return { x: last[1], y: last[2], h: last[3], ...camOf(last) };
  let lo = 0;
  let hi = p.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid][0] <= t) lo = mid; else hi = mid; }
  const a = p[lo];
  const b = p[hi];
  const k = (t - a[0]) / (b[0] - a[0] || 1);
  // 그 순간의 선수 키(화면 높이 비율) — 카메라 줌 · 원근에 따라 바뀜
  const h = a[3] && b[3] ? a[3] + (b[3] - a[3]) * k : a[3] || b[3];
  if (tr.manual && p.length >= 3) {
    // 수동으로 찍은 점 사이는 부드럽게 — 점 간격(시간)을 반영하고, 점 밖으로 튀어나가지 않게 (단조 3차 보간)
    const p0 = p[Math.max(0, lo - 1)];
    const p3 = p[Math.min(p.length - 1, hi + 1)];
    const dt = b[0] - a[0] || 1;
    const slope = (q, r) => (r[0] - q[0] > 1e-6 ? 1 / (r[0] - q[0]) : 0);
    const tan = (i, prev, cur, next) => {
      const d0 = prev === cur ? null : (cur[i] - prev[i]) * slope(prev, cur);
      const d1 = next === cur ? null : (next[i] - cur[i]) * slope(cur, next);
      if (d0 == null) return d1 ?? 0;
      if (d1 == null) return d0;
      if (d0 * d1 <= 0) return 0; // 방향이 바뀌는 점에서는 멈췄다 가듯이 (튀지 않게)
      return (2 * d0 * d1) / (d0 + d1);
    };
    const k2 = k * k; const k3 = k2 * k;
    const herm = (i) => (2 * k3 - 3 * k2 + 1) * a[i] + (k3 - 2 * k2 + k) * dt * tan(i, p0, a, b) + (-2 * k3 + 3 * k2) * b[i] + (k3 - k2) * dt * tan(i, a, b, p3);
    return { x: herm(1), y: herm(2), h };
  }
  // 카메라 누적 이동: 두 점 모두 있을 때만 (없으면 예전처럼 화면 좌표 그대로)
  const cm = a.length >= 6 && b.length >= 6 ? { cx: a[4] + (b[4] - a[4]) * k, cy: a[5] + (b[5] - a[5]) * k } : {};
  return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k, h, ...cm };
}

export function steadyPos(tr, t) {
  if (!tr?.path?.length) return null;
  if (tr.manual) return trackerPos(tr, t);
  const tEnd = tr.path[tr.path.length - 1][0];
  if (t > tEnd - 0.45) return steadyRaw(tr, t);
  // 같은 기록이면 계산해 둔 점을 다시 씀
  const key = `${tr.path.length}:${tEnd}`;
  // 계산 캐시는 저장 · 되돌리기(JSON)에 들어가지 않게 숨긴 속성으로 — 되돌리면 {}로 바뀌어 오류 나던 것
  if (tr._sk !== key || !(tr._sc instanceof Map)) {
    Object.defineProperty(tr, '_sk', { value: key, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(tr, '_sc', { value: new Map(), writable: true, configurable: true, enumerable: false });
  }
  const STEP = 0.2;
  const at = (k) => { let v = tr._sc.get(k); if (!v) { v = steadyRaw(tr, k * STEP); if (v) tr._sc.set(k, v); } return v; };
  const k1 = Math.floor(t / STEP); const u = t / STEP - k1;
  const p0 = at(k1 - 1); const p1 = at(k1); const p2 = at(k1 + 1); const p3 = at(k1 + 2);
  if (!p0 || !p1 || !p2 || !p3 || (k1 + 1) * STEP > tEnd - 0.45) return steadyRaw(tr, t);
  const cr = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), h: p1.h + (p2.h - p1.h) * u };
}
function steadyRaw(tr, t) {
  // 카메라 누적 이동(cx, cy)이 기록된 길이면: 카메라 움직임을 빼고(선수 자체 움직임만) 거른 뒤 다시 더함
  //  → 서 있는 선수는 카메라가 돌아도 '서 있는 것'으로 보고 단단히 고정, 표시는 화면 속 선수에 그대로 붙어 있음
  // 앞뒤로 쓰는 구간의 점이 모두 카메라 기록을 가졌을 때만 (섞여 있으면 기준이 달라 튐 → 예전처럼 화면 좌표로)
  const p = tr.path; let ok = true;
  for (let i = 0; i < p.length; i++) { const q = p[i]; if (q[0] < t - 1.15) continue; if (q[0] > t + 1.15) break; if (q.length < 6) { ok = false; break; } }
  const cam = ok ? (q) => [q.cx || 0, q.cy || 0] : () => [0, 0];
  const own = ok ? (q) => [q.x - (q.cx || 0), q.y - (q.cy || 0)] : (q) => [q.x, q.y];
  const avg = (c, half, step, g = own) => {
    let sx = 0; let sy = 0; let sh = 0; let sw = 0; const sg = half / 2;
    for (let d = -half; d <= half + 1e-9; d += step) {
      const q = trackerPos(tr, c + d); if (!q) continue;
      const [X, Y] = g(q);
      const w = Math.exp(-(d * d) / (2 * sg * sg)); sx += X * w; sy += Y * w; sh += (q.h || 0) * w; sw += w;
    }
    return sw ? { x: sx / sw, y: sy / sw, h: sh / sw } : null;
  };
  const tEnd = tr.path[tr.path.length - 1][0];
  if (t > tEnd - 0.45) {
    // 경로 끝(재생하며 따라가는 중): 지난 기록에 직선을 맞춰 지금 위치를 구함
    // (평균만 내면 늦게 따라오고, 늦은 만큼 앞으로 늘려 그리면 잡음까지 커져 표시가 떨림)
    const now = Math.min(t, tEnd);
    const fit = (span, g = own) => {
      let sw = 0; let su = 0; let suu = 0; let sx = 0; let sy = 0; let sux = 0; let suy = 0; let sh = 0;
      for (let d = 0; d <= span + 1e-9; d += 0.04) {
        const q = trackerPos(tr, now - d); if (!q) continue;
        const [X, Y] = g(q);
        const w = 1 - d / (span + 0.04); const u = -d;
        sw += w; su += w * u; suu += w * u * u; sx += w * X; sy += w * Y; sux += w * u * X; suy += w * u * Y; sh += w * (q.h || 0);
      }
      if (!sw) return null;
      const den = sw * suu - su * su;
      const vx = den > 1e-9 ? (sw * sux - su * sx) / den : 0; const vy = den > 1e-9 ? (sw * suy - su * sy) / den : 0;
      return { x: (sx - vx * su) / sw, y: (sy - vy * su) / sw, h: sh / sw, vx, vy, mx: sx / sw, my: sy / sw, mu: su / sw };
    };
    // 움직임(속도)은 길게(0.8초) 보고, 자리는 최근 짧게(0.3초) 평균 + 평균이 늦은 만큼만 속도로 당김 — 직선 끝값만 쓰면 잡음이 큼
    const fv = fit(0.8); const fm = fit(0.3);
    if (!fv || !fm) return trackerPos(tr, t);
    const f = { x: fm.mx - fv.vx * fm.mu, y: fm.my - fv.vy * fm.mu, h: fm.h, vx: fv.vx, vy: fv.vy };
    const slow = fit(1.0);
    const hh0 = Math.max(0.02, f.h || tr.h || 0.08);
    // 서 있는지: 0.7초 동안 (카메라 빼고) 움직인 거리를 선수 키와 비교 → 서 있으면 1초 평균 자리에 고정
    const mvL = (Math.hypot(f.vx, f.vy) * 0.7) / hh0;
    const k2 = Math.min(1, Math.max(0, (mvL - 0.12) / 0.25));
    const ahead = Math.min(0.1, Math.max(0, t - tEnd)); // 기록이 아직 못 따라온 아주 짧은 틈만 움직임대로
    const fx = f.x + f.vx * ahead; const fy = f.y + f.vy * ahead;
    const sx0 = slow ? slow.x - slow.vx * 0.33 : fx; const sy0 = slow ? slow.y - slow.vy * 0.33 : fy; // 1초 직선의 가운데쯤(평균 자리)
    // 카메라는 지금 자리 그대로 (짧게 맞춘 직선으로 잔떨림만 거름)
    const cv = fit(0.5, cam); const cm = fit(0.2, cam);
    const cxN = cv && cm ? cm.mx - cv.vx * cm.mu + cv.vx * ahead : 0; const cyN = cv && cm ? cm.my - cv.vy * cm.mu + cv.vy * ahead : 0;
    return { x: sx0 + (fx - sx0) * k2 + cxN, y: sy0 + (fy - sy0) * k2 + cyN, h: (slow || f).h };
  }
  const wide = avg(t, 1.0, 0.08);
  const a = avg(t - 0.5, 0.3, 0.05); const b = avg(t + 0.5, 0.3, 0.05);
  const camNow = avg(t, 0.15, 0.03, cam) || { x: 0, y: 0 }; // 카메라 자리 (앞뒤 0.15초로 잔떨림만)
  if (!wide || !a || !b) { const q = avg(t, 0.4, 0.05); return q ? { x: q.x + camNow.x, y: q.y + camNow.y, h: q.h } : trackerPos(tr, t); }
  // 가만히 있는지: 앞뒤 1초 사이에 (카메라 빼고) 움직인 거리를 선수 키와 비교 (멀리 있는 작은 선수도 같은 기준)
  const hh = Math.max(0.02, wide.h || tr.h || 0.08);
  const mv = Math.hypot(a.x - b.x, a.y - b.y) / hh;
  // 빨리 움직일수록 평균 내는 시간을 짧게 — 길게 평균 내면 표시가 늦게 따라감
  const nearHalf = 0.4 - 0.28 * Math.min(1, Math.max(0, (mv - 0.5) / 1.5));
  const near = avg(t, nearHalf, Math.min(0.05, nearHalf / 4)) || wide;
  const k = Math.min(1, Math.max(0, (mv - 0.18) / 0.3)); // 키의 18% 안쪽이면 고정, 키의 절반 넘게 움직이면 그대로 따라감
  // 키(링 크기)는 항상 넓게 평균 — 커졌다 작아졌다 하지 않게
  return { x: wide.x + (near.x - wide.x) * k + camNow.x, y: wide.y + (near.y - wide.y) * k + camNow.y, h: wide.h };
}

// 이 시점부터 새로 따라가기: 이후 기록은 지우고 이 위치부터
export function setTrackerAt(tr, t, x, y, h = tr.h) {
  tr.path = tr.path.filter((q) => q[0] < t - 0.001);
  tr.path.push(h ? [+t.toFixed(3), +x.toFixed(4), +y.toFixed(4), +h.toFixed(4)] : [+t.toFixed(3), +x.toFixed(4), +y.toFixed(4)]);
}

// 수동 점 찍기: 이 시점의 점만 넣거나 바꿈 (앞뒤 점은 그대로)
export function setKeyAt(tr, t, x, y, h = tr.h, tol = 0.02) {
  tr.path = tr.path.filter((q) => Math.abs(q[0] - t) > tol);
  tr.path.push(h ? [+t.toFixed(3), +x.toFixed(4), +y.toFixed(4), +h.toFixed(4)] : [+t.toFixed(3), +x.toFixed(4), +y.toFixed(4)]);
  tr.path.sort((p, q) => p[0] - q[0]);
}
export function stampH(tr, t, h = tr.h, tol = 0.03) {
  if (!h) return;
  for (const q of tr.path) if (Math.abs(q[0] - t) <= tol) q[3] = +h.toFixed(4);
}
export function delKeyAt(tr, t, tol = 0.05) {
  const n = tr.path.length;
  tr.path = tr.path.filter((q) => Math.abs(q[0] - t) > tol);
  return n !== tr.path.length;
}
// 촘촘한 AI 경로 → step 초 간격 점으로 (수동으로 고치기 쉽게)
export function thinPath(tr, step) {
  const p = tr.path;
  if (p.length < 3) return;
  const out = [p[0]];
  for (let s = p[0][0] + step; s < p[p.length - 1][0]; s += step) {
    let best = null;
    for (const q of p) if (!best || Math.abs(q[0] - s) < Math.abs(best[0] - s)) best = q;
    if (best && best !== out[out.length - 1]) out.push(best);
  }
  out.push(p[p.length - 1]);
  tr.path = out;
}

// ───────── 그리기 ─────────
export const GROUND = new Set(['arrow', 'spot', 'poly', 'link', 'grid', 'measure', 'offside', 'vision', 'angle']);
export const itemPoints = (it) => ({
  arrow: [it.a, it.b, it.c], spot: [it.p], poly: it.pts, link: it.pts, grid: it.q, measure: [it.a, it.b], text: [it.p], xg: [it.p], timer: [it.p], move: [it.b], zoom: [it.p], light: [it.p], offside: [it.p], vision: [it.a, it.b], angle: [it.a, it.b, it.c],
}[it.k] || []);

// 각도(도) — 화면에서 본 두 선 사이
export function angleDeg(a, b, c) {
  const a1 = Math.atan2(b.y - a.y, b.x - a.x); const a2 = Math.atan2(c.y - a.y, c.x - a.x);
  let d = Math.abs(a2 - a1) * 180 / Math.PI;
  if (d > 180) d = 360 - d;
  return d;
}

// ───────── 오프사이드 라인: 기준점(p)을 지나 화면 끝에서 끝까지 · 한쪽은 어둡게 한쪽은 밝게 ─────────
// d: 선 방향 (정규화 좌표 차이). 없으면 세로
export function offsideGeom(it, p, W, H) {
  const d = it.d || { x: 0, y: 1 };
  let dx = d.x * W; let dy = d.y * H;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  // 화면 사각형 안에서 선이 지나는 구간 (Liang–Barsky)
  let t0 = -Infinity; let t1 = Infinity;
  for (const [pp, q] of [[-dx, p.x], [dx, W - p.x], [-dy, p.y], [dy, H - p.y]]) {
    if (Math.abs(pp) < 1e-9) continue;
    const r = q / pp;
    if (pp < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
  }
  if (!Number.isFinite(t0)) t0 = -Math.hypot(W, H);
  if (!Number.isFinite(t1)) t1 = Math.hypot(W, H);
  const nx = -dy; const ny = dx; // 선의 법선 (어느 쪽인지 가르는 방향)
  // 화면 사각형을 선으로 잘라 두 쪽 다각형으로
  const rect = [[0, 0], [W, 0], [W, H], [0, H]];
  const half = (sign) => {
    const out = [];
    const f = ([x, y]) => sign * ((x - p.x) * nx + (y - p.y) * ny);
    for (let i = 0; i < 4; i++) {
      const a = rect[i]; const b = rect[(i + 1) % 4];
      const fa = f(a); const fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) { const k = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
    }
    return out;
  };
  return { dx, dy, t0, t1, dark: half(it.side === -1 ? -1 : 1), bright: half(it.side === -1 ? 1 : -1) };
}
function drawOffside(ctx, it, p, W, H, col, prog) {
  const g = offsideGeom(it, p, W, H);
  const k = Math.min(1, Math.max(0, prog));
  const fill = (pts, style) => { if (pts.length < 3) return; ctx.fillStyle = style; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); };
  const s = it.dim ?? 0.5;
  fill(g.dark, `rgba(0,0,0,${(s * 0.9 * k).toFixed(3)})`);
  fill(g.bright, `rgba(255,255,255,${(s * 0.26 * k).toFixed(3)})`);
  // 선: 기준점에서 양쪽 끝으로 뻗어 나감
  const a = { x: p.x + g.dx * g.t0 * k, y: p.y + g.dy * g.t0 * k };
  const b = { x: p.x + g.dx * g.t1 * k, y: p.y + g.dy * g.t1 * k };
  const lw = Math.max(3, W / 260);
  ctx.save();
  // 바닥에 깔린 두꺼운 빛 띠 (옆면 · 그림자 · 은은한 빛)
  ctx.shadowColor = col; ctx.shadowBlur = lw * 3;
  ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.restore();
  solid(ctx, (c) => { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }, { col, width: lw, depth: lw * 0.9 });
}

function hatch(ctx, color, s) {
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(s);
  const g = c.getContext('2d');
  g.strokeStyle = color;
  g.globalAlpha = 0.55;
  g.lineWidth = Math.max(1, s / 5);
  g.beginPath();
  g.moveTo(0, s); g.lineTo(s, 0);
  g.moveTo(-s / 2, s / 2); g.lineTo(s / 2, -s / 2);
  g.moveTo(s / 2, s * 1.5); g.lineTo(s * 1.5, s / 2);
  g.stroke();
  return ctx.createPattern(c, 'repeat');
}

function arrowHead(ctx, x, y, ang, s) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - s * Math.cos(ang - 0.45), y - s * Math.sin(ang - 0.45));
  ctx.lineTo(x - s * Math.cos(ang + 0.45), y - s * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
}

export function gridH(it) { return it.q.length === 4 ? homography(UNIT, it.q.map((p) => ({ x: p.x, y: p.y }))) : null; }

export function meters(items, a, b) {
  if (CAL) { const pa = CAL.S({ x: a.x * CAL.W, y: a.y * CAL.H }); const pb = CAL.S({ x: b.x * CAL.W, y: b.y * CAL.H }); return Math.hypot(pa.x - pb.x, pa.y - pb.y); }
  const g = [...items].reverse().find((x) => x.k === 'grid' && x.q.length === 4);
  if (!g) return null;
  const inv = homography(g.q, UNIT);
  if (!inv) return null;
  const pa = project(inv, a.x, a.y);
  const pb = project(inv, b.x, b.y);
  return Math.hypot((pa.x - pb.x) * g.wM, (pa.y - pb.y) * g.hM);
}

// it: 그림, P: 점 → 화면 픽셀 좌표 함수, W: 캔버스 폭, items: 전체(거리 계산용)
// 점들을 지나는 매끈한 닫힌 곡선 (동그라미 도형)
function smoothClosed(ctx, pts) {
  const n = pts.length;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const m0 = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m0.x, m0.y);
  for (let i = 0; i < n; i++) { const m = mid(pts[i], pts[(i + 1) % n]); ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y); }
}

const easeOut = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

// 바닥에 깔린 두꺼운 리본 화살표: 원근(멀수록 가늘게) + 그림자 + 밝은 테두리. dash 면 띠를 끊어서 '이동' 표시
// ph: 화살표 시작점에 서 있는 선수의 화면 키(px) — 있으면 선수 크기에 맞춰 굵기를 정함 (멀리 작게 · 가까이 크게)
function ribbonArrow(ctx, pts, { W, H, hz, col, dash, ph, bold, sz = 1 }) {
  if (pts.length < 2) return;
  const hzPx = (hz ?? 0.3) * H;
  const p0 = pts[0];
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let widthAt;
  let base;
  if (ph) {
    base = Math.min(W / 26, Math.max(4, ph * 0.2));
    const near = p0.y - hzPx > 6; // 잔디 시작선 아래 → 원근(앞으로 올수록 굵게)
    widthAt = (p) => base * (near ? Math.min(1.6, Math.max(0.5, (p.y - hzPx) / (p0.y - hzPx))) : 1);
  } else {
    base = Math.max(9, W / 62);
    widthAt = (p) => base * Math.min(1.3, Math.max(0.5, 0.25 + (p.y - hzPx) / Math.max(1, H - hzPx)));
  }
  // 크기 조절 (화살표 크기 40% ~ 200%)
  if (sz !== 1) { const w0 = widthAt; widthAt = (p) => w0(p) * sz; base *= sz; }
  // 짧은 화살표: 머리가 몸통보다 커지지 않게 굵기 · 머리를 길이에 맞춰 줄임
  const tip = pts[pts.length - 1];
  if (!bold) base = Math.max(4 * Math.min(1, sz), base * 0.55); // 패스 선 (widthAt 은 base 를 씀)
  const want = widthAt(tip) * (bold ? 2.8 : 5);
  const shrink = Math.min(1, (L * 0.45) / Math.max(1, want));
  if (shrink < 1) { const wa = widthAt; const k = Math.max(0.35, shrink); widthAt = (p) => wa(p) * k; base *= k; }
  const headLen = Math.min(widthAt(tip) * (bold ? 2.8 : 4.6), L * 0.45);
  let acc = 0;
  let cut = pts.length - 1;
  for (let i = pts.length - 1; i > 0; i--) { acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (acc >= headLen) { cut = i; break; } cut = i - 1; }
  const body = pts.slice(0, Math.max(1, cut) + 1);
  const neck = body[body.length - 1];
  const ang = Math.atan2(tip.y - neck.y, tip.x - neck.x);
  // 몸통 띠 (구간마다 법선 방향으로 폭만큼)
  const cum = new Map(); { let acc = 0; body.forEach((p, i) => { if (i) acc += Math.hypot(p.x - body[i - 1].x, p.y - body[i - 1].y); cum.set(p, acc); }); }
  const Lb = cum.get(body[body.length - 1]) || 1;
  const tap = (p) => (bold ? 0.4 + 0.6 * Math.min(1, (cum.get(p) ?? Lb) / Lb) : 1);
  const side = (arr, sgn) => arr.map((p, i) => {
    const q = arr[Math.min(arr.length - 1, i + 1)];
    const o = arr[Math.max(0, i - 1)];
    const a2 = Math.atan2(q.y - o.y, q.x - o.x);
    const w = (widthAt(p) / 2) * tap(p);
    return { x: p.x + Math.cos(a2 + (Math.PI / 2) * sgn) * w, y: p.y + Math.sin(a2 + (Math.PI / 2) * sgn) * w };
  });
  const segs = [];
  if (dash && body.length > 2) {
    // 길이를 따라 띠를 끊기
    let run = 0; let on = true; let cur = [body[0]];
    const dashLen = base * (bold ? 2.2 : 4.5); const gap = base * (bold ? 1.3 : 3);
    for (let i = 1; i < body.length; i++) {
      run += Math.hypot(body[i].x - body[i - 1].x, body[i].y - body[i - 1].y);
      cur.push(body[i]);
      if (run >= (on ? dashLen : gap)) { if (on && cur.length > 1) segs.push(cur); on = !on; run = 0; cur = [body[i]]; }
    }
    if (on && cur.length > 1) segs.push(cur);
  } else segs.push(body);
  const hw = widthAt(tip) * (bold ? 1.5 : 1.9);
  const head = [
    { x: tip.x, y: tip.y },
    { x: neck.x + Math.cos(ang + Math.PI / 2) * hw, y: neck.y + Math.sin(ang + Math.PI / 2) * hw },
    { x: neck.x + Math.cos(ang - Math.PI / 2) * hw, y: neck.y + Math.sin(ang - Math.PI / 2) * hw },
  ];
  const shapes = [...segs.map((sg) => [...side(sg, 1), ...side(sg, -1).reverse()]), head];
  if (bold) paintSlab(ctx, shapes, col, base, pts[0], tip); else paintCrisp(ctx, shapes, col, Math.max(2, base));
}

// ───────── 원근을 맞춘 장면: 바닥(m)에서 만든 화살표 → 화면 ─────────
// 몸통 폭 1.1m · 머리 길이 2m · 폭 2.3m 로 잔디에 칠한 것처럼 (멀리 가면 자연스럽게 가늘고 납작해짐)
function groundArrow(ctx, ptsPx, { col, dash, bold, sz = 1 }) {
  const g = ptsPx.map((p) => CAL.S(p));
  const segL = []; let L = 0;
  for (let i = 1; i < g.length; i++) { const d = Math.hypot(g[i].x - g[i - 1].x, g[i].y - g[i - 1].y); segL.push(d); L += d; }
  if (L < 0.3) return;
  const k = Math.min(1, (L * 0.4) / (bold ? 2.0 : 1.5));
  const bw = (bold ? 1.1 * Math.max(0.5, k) / 2 : 0.3) * sz; const headL = Math.min(L * 0.45, (bold ? 2.0 : 1.9) * k * sz); const headW = (bold ? 1.15 * Math.max(0.55, k) : 0.95 * Math.max(0.7, k)) * sz;
  // 몸통 끝(머리 시작) 찾기
  let left = L - headL; const body = [g[0]];
  for (let i = 1; i < g.length; i++) {
    if (left >= segL[i - 1]) { body.push(g[i]); left -= segL[i - 1]; continue; }
    const t2 = segL[i - 1] ? left / segL[i - 1] : 0;
    body.push({ x: g[i - 1].x + (g[i].x - g[i - 1].x) * t2, y: g[i - 1].y + (g[i].y - g[i - 1].y) * t2 }); break;
  }
  const tip = g[g.length - 1]; const neck = body[body.length - 1];
  const nrm = (a, b) => { const dx = b.x - a.x; const dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; return { x: -dy / l, y: dx / l }; };
  const cumG = new Map(); { let acc = 0; body.forEach((p, i) => { if (i) acc += Math.hypot(p.x - body[i - 1].x, p.y - body[i - 1].y); cumG.set(p, acc); }); }
  const Lg = cumG.get(body[body.length - 1]) || 1;
  const side = (arr, sg) => arr.map((p, i) => { const n = nrm(arr[Math.max(0, i - 1)], arr[Math.min(arr.length - 1, i + 1)]); const w = bold ? bw * (0.4 + 0.6 * Math.min(1, (cumG.get(p) ?? Lg) / Lg)) : bw; return { x: p.x + n.x * w * sg, y: p.y + n.y * w * sg }; });
  const segs = [];
  if (dash) { // 이동(점선): 1.6m 띠 · 1m 빈칸
    let run = 0; let on = true; let cur = [body[0]];
    for (let i = 1; i < body.length; i++) {
      run += Math.hypot(body[i].x - body[i - 1].x, body[i].y - body[i - 1].y); cur.push(body[i]);
      if (run >= (on ? (bold ? 1.6 : 1.1) : (bold ? 1.0 : 0.7))) { if (on && cur.length > 1) segs.push(cur); on = !on; run = 0; cur = [body[i]]; }
    }
    if (on && cur.length > 1) segs.push(cur);
  } else segs.push(body);
  const hn = nrm(neck, tip);
  const head = [tip, { x: neck.x + hn.x * headW, y: neck.y + hn.y * headW }, { x: neck.x - hn.x * headW, y: neck.y - hn.y * headW }];
  const shapes = [...segs.filter((sg) => sg.length > 1).map((sg) => [...side(sg, 1), ...side(sg, -1).reverse()]), head].map((sh) => sh.map((p) => CAL.G(p.x, p.y)));
  if (bold) paintSlab(ctx, shapes, col, Math.max(3, bw * 2 * pxPerM(g[0])), CAL.G(g[0].x, g[0].y), CAL.G(tip.x, tip.y));
  else paintCrisp(ctx, shapes, col, Math.max(2, bw * 2 * pxPerM(g[g.length - 1])));
}
// 바닥에 깔린 입체 판: 그림자 → 옆면(두께) → 윗면 색 + 음영 → 밝은 테두리
// 바닥에 칠한 납작한 띠: 꼬리는 옅고 머리 쪽으로 진해짐 + 은은한 빛 + 얇은 밝은 테두리 (FIFA 분석 영상 느낌)
function paintSlab(ctx, shapes, col, base, from = null, to = null) {
  const fillAll = () => shapes.forEach((sh) => { gpath(ctx, sh); ctx.fill(); });
  const all = shapes.flat();
  const a = from || all[0]; const b = to || all[all.length - 1];
  const gr = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  gr.addColorStop(0, rgba(col, 0.25)); gr.addColorStop(0.5, rgba(col, 0.68)); gr.addColorStop(1, rgba(col, 0.97));
  ctx.save();
  ctx.shadowColor = rgba(col, 0.55); ctx.shadowBlur = Math.max(4, base * 1.1);
  ctx.fillStyle = gr; fillAll();
  ctx.shadowBlur = 0;
  const eg = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  eg.addColorStop(0, rgba(tint(col, 0.6), 0.25)); eg.addColorStop(1, rgba(tint(col, 0.6), 0.95));
  ctx.strokeStyle = eg; ctx.lineWidth = Math.max(1, base * 0.08); ctx.lineJoin = 'round';
  shapes.forEach((sh) => { gpath(ctx, sh); ctx.stroke(); });
  ctx.restore();
}
function paintCrisp(ctx, shapes, col, base) {
  const fillAll = () => shapes.forEach((sh) => { gpath(ctx, sh); ctx.fill(); });
  const depth = Math.max(1, base * 0.38);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.filter = `blur(${Math.max(1, depth).toFixed(1)}px)`;
  ctx.translate(0, depth * 1.7); fillAll(); ctx.restore();
  ctx.save(); ctx.fillStyle = shade(col, -0.42);
  for (let d = depth; d > 0; d -= Math.max(0.6, depth / 3)) { ctx.save(); ctx.translate(0, d); fillAll(); ctx.restore(); }
  ctx.fillStyle = col; fillAll();
  ctx.restore();
}
// '#rrggbb' 또는 rgba → 투명도 a 인 rgba
function rgba(col, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(col || '');
  if (m) { const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  const r = /rgba?\(([^)]+)\)/.exec(col || '');
  if (r) { const [R, G, B, A = 1] = r[1].split(',').map((v) => +v); return `rgba(${R},${G},${B},${(+A) * a})`; }
  return `rgba(255,255,255,${a})`;
}
// 흰색 쪽으로 섞기 (밝은 테두리 · 빛 심지)
function tint(col, k) {
  const m = /^#([0-9a-f]{6})$/i.exec(col || '');
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16); const f = (v) => Math.round(v + (255 - v) * k);
  return `#${[f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// 색을 밝게(+) · 어둡게(-) — 반투명(GLASS) 같은 rgba 는 검은 반투명으로
function shade(col, k) {
  const m = /^#([0-9a-f]{6})$/i.exec(col || '');
  if (!m) return 'rgba(0,0,0,0.35)';
  const n = parseInt(m[1], 16);
  const f = (v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// 2차 곡선을 0~prog 구간만 점으로 (그어지면서 나타나는 효과)
function quadPts(a, c, b, prog, n = 40) {
  const pts = [];
  const m = Math.max(1, Math.round(n * prog));
  for (let i = 0; i <= m; i++) {
    const t = (i / n);
    const u = 1 - t;
    pts.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
  }
  return pts;
}

// 꺾은선을 길이 기준으로 0~prog 만큼
// 면 채우기 바닥 색: 영상의 잔디를 그대로 다시 그리고 색만 입힘 (잔디 결 · 그림자가 살아 있어 바닥에 칠한 느낌)
// 영상 픽셀을 읽을 수 없으면(유튜브 등) 예전처럼 반투명 색
let TEX = null;
export const setGroundTex = (v) => { TEX = v; };
let tintCv = null;
function groundTint(ctx, poly, col, k) {
  const W = ctx.canvas.width; const H = ctx.canvas.height;
  if (!TEX || !(TEX.videoWidth || TEX.width)) { ctx.save(); ctx.globalAlpha = 0.9 * k; ctx.fillStyle = rgba(col, 0.34); gpath(ctx, poly); ctx.fill(); ctx.restore(); return; }
  if (!tintCv) tintCv = document.createElement('canvas');
  if (tintCv.width !== W || tintCv.height !== H) { tintCv.width = W; tintCv.height = H; }
  const t = tintCv.getContext('2d');
  t.save(); t.clearRect(0, 0, W, H);
  gpath(t, poly); t.clip();
  t.drawImage(TEX, 0, 0, W, H);
  t.globalCompositeOperation = 'color'; t.fillStyle = col; t.fillRect(0, 0, W, H); // 밝기(잔디 결)는 그대로, 색만 팀 색
  t.globalCompositeOperation = 'soft-light'; t.globalAlpha = 0.5; t.fillRect(0, 0, W, H); // 살짝 더 선명하게
  t.globalCompositeOperation = 'screen'; t.globalAlpha = 0.18; t.fillRect(0, 0, W, H); // 조금 밝게
  t.restore();
  ctx.save();
  ctx.globalAlpha = 0.72 * k; ctx.drawImage(tintCv, 0, 0);
  // 가장자리는 조금 진하게 (칠한 경계가 보이게)
  ctx.globalAlpha = 0.5 * k; ctx.strokeStyle = rgba(col, 0.55); ctx.lineWidth = Math.max(3, W / 160); ctx.lineJoin = 'round';
  gpath(ctx, poly); ctx.clip(); gpath(ctx, poly); ctx.stroke();
  ctx.restore();
}

// 드리블 화살표: 선을 따라 물결 (진폭 amp px · 끝 18%는 곧게 펴서 화살촉이 바르게)
function wavy(pts, amp) {
  if (pts.length < 3) return pts;
  const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const tot = L[L.length - 1]; if (tot < 10) return pts;
  const wl = Math.max(amp * 4, 18); // 물결 하나 길이
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x; const dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1;
    const k = L[i] / tot; const fade = k > 0.82 ? 0 : k < 0.06 ? k / 0.06 : 1;
    const o = Math.sin((L[i] / wl) * Math.PI * 2) * amp * fade;
    return { x: p.x - (dy / d) * o, y: p.y + (dx / d) * o };
  });
}

// 선을 따라 움직이는 빛 한 줄기 (t: 초 · 1.8초에 한 바퀴)
function flowLight(ctx, pts, t, wdt, col) {
  const L = []; let tot = 0;
  for (let i = 0; i < pts.length - 1; i++) { const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); L.push(d); tot += d; }
  if (tot < 4) return;
  const len = Math.max(wdt * 14, tot * 0.24);
  const head = (((t / 1.8) % 1) + 1) % 1 * (tot + len);
  const at = (d) => { let x = Math.max(0, Math.min(tot, d)); for (let i = 0; i < L.length; i++) { if (x <= L[i] || i === L.length - 1) { const k = L[i] ? x / L[i] : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k }; } x -= L[i]; } return pts[pts.length - 1]; };
  const n = 14;
  ctx.save(); ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
  const pass = (wMul, alpha, style, blur) => {
    ctx.shadowColor = style; ctx.shadowBlur = blur;
    for (let j = 0; j < n; j++) {
      const d0 = head - len + (len * j) / n; const d1 = head - len + (len * (j + 1)) / n;
      if (d1 < 0 || d0 > tot) continue;
      const a = at(d0); const b = at(d1); const k = (j + 1) / n;
      ctx.strokeStyle = style.replace('A', (alpha * k * k).toFixed(3)); ctx.lineWidth = wdt * wMul * (0.6 + 0.8 * k);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  };
  pass(3.2, 0.35, 'rgba(255,245,200,A)', wdt * 3); // 바깥 번짐
  pass(1.4, 0.95, 'rgba(255,255,255,A)', 0); // 가운데 밝은 줄
  ctx.shadowColor = col; ctx.shadowBlur = wdt * 6; ctx.fillStyle = 'rgba(255,255,255,.95)';
  if (head >= 0 && head <= tot) { const h = at(head); ctx.beginPath(); ctx.arc(h.x, h.y, wdt * 1.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function partialLine(pts, prog) {
  if (prog >= 1) return pts;
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(d); total += d; }
  let left = total * prog;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (left >= seg[i - 1]) { out.push(pts[i]); left -= seg[i - 1]; continue; }
    const k = seg[i - 1] ? left / seg[i - 1] : 0;
    out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k });
    break;
  }
  return out;
}

// ───────── 입체 선: 바닥 그림자 → 옆면(두께, 어두운 색) → 윗면(색) → 윗면 빛 ─────────
// build(ctx): 선 모양을 그리는 함수 (closed 면 닫힌 도형) · width: 굵기(px) · depth: 바닥에서 뜬 두께(px)
function solid(ctx, build, { col, width, dash = null, closed = false, alpha = 1 }) {
  const w = Math.max(1.5, width * 0.62);
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash.map((v) => v * 0.8));
  // 은은한 빛 (같은 색이 살짝 번짐)
  ctx.shadowColor = rgba(col, 0.7); ctx.shadowBlur = w * 2.4;
  ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = w;
  ctx.beginPath(); build(ctx); if (closed) ctx.closePath(); ctx.stroke();
  // 가운데 밝은 심지
  ctx.shadowBlur = 0; ctx.globalAlpha = alpha * 0.85; ctx.strokeStyle = tint(col, 0.65); ctx.lineWidth = Math.max(0.8, w * 0.32);
  ctx.beginPath(); build(ctx); if (closed) ctx.closePath(); ctx.stroke();
  ctx.restore();
}
// 원근 굵기 배율: 잔디 시작선(hz) 근처는 가늘게, 화면 아래(가까이)는 굵게
const perspK = (y, H, hz) => { const hp = (hz ?? 0.3) * H; return Math.min(1.35, Math.max(0.45, 0.25 + (y - hp) / Math.max(1, H - hp))); };
// 바닥 면 채우기: 아래로 갈수록 진한 그라데이션 + 빗금
function slabFill(ctx, build, col, lw, alpha, ys) {
  const g = ctx.createLinearGradient(0, ys[0], 0, ys[1]);
  g.addColorStop(0, rgba(col, 0.14)); g.addColorStop(1, rgba(col, 0.3));
  ctx.save();
  ctx.beginPath(); build(ctx); ctx.closePath();
  ctx.globalAlpha = alpha; ctx.fillStyle = g; ctx.fill();
  ctx.restore();
}

// it._prog: 나타나는 효과 진행도 (0~1, 없으면 1)
// 연결선 '바닥 원판' 모양: 원판 가장자리 → 다음 원판 가장자리까지 흰 띠 (원판 크기는 발밑 원판과 같은 계산)
function discBands(ctx, lp, P, it, prog, W) {
  const nP = it.pts.length;
  const known = (it._phs || []).filter(Boolean);
  const ph0 = known.length ? known.reduce((x, y) => x + y, 0) / known.length : W / 14; // 선수에 안 붙은 점은 이은 선수들의 평균 키로
  const ph = (i) => (it._phs && it._phs[i % nP]) || ph0;
  const disc = (i) => { const q = P(lp[i]); const R = lp[i]?.tr ? ph(i) * 0.4957 : 0; const ry = R * 0.26; return { x: q.x, y: q.y - ry * 0.15, R, ry }; }; // 선수에 안 붙은 점은 원판 없음
  const edge = (d, ux, uy) => { if (!d.R) return { x: d.x, y: d.y }; const r = 1 / Math.sqrt((ux / d.R) ** 2 + (uy / d.ry) ** 2); return { x: d.x + ux * r, y: d.y + uy * r }; };
  const segs = [];
  for (let i = 0; i < lp.length - 1; i++) {
    const A = disc(i); const B = disc(i + 1);
    const L = Math.hypot(B.x - A.x, B.y - A.y); if (L < 1) continue;
    const ux = (B.x - A.x) / L; const uy = (B.y - A.y) / L;
    const a = edge(A, ux, uy); const b = edge(B, -ux, -uy);
    if ((b.x - a.x) * ux + (b.y - a.y) * uy <= 0) continue; // 원판끼리 겹치면 띠 없음
    segs.push({ a, b, wa: ph(i) * 0.075, wb: ph(i + 1) * 0.075 }); // 띠 폭: 그 자리 선수 키에 맞춰 (원근)
  }
  const lens = segs.map((g) => Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y));
  let left = lens.reduce((x, y) => x + y, 0) * easeOut(prog);
  const quad = (g, k, dy) => {
    const bx = g.a.x + (g.b.x - g.a.x) * k; const by = g.a.y + (g.b.y - g.a.y) * k; const wb = g.wa + (g.wb - g.wa) * k;
    const L = Math.hypot(bx - g.a.x, by - g.a.y) || 1; const nx = -(by - g.a.y) / L; const ny = (bx - g.a.x) / L;
    // 바닥에 누운 띠: 세로 방향 두께는 납작하게
    ctx.beginPath();
    ctx.moveTo(g.a.x + nx * g.wa, g.a.y + ny * g.wa * 0.35 + dy); ctx.lineTo(bx + nx * wb, by + ny * wb * 0.35 + dy);
    ctx.lineTo(bx - nx * wb, by - ny * wb * 0.35 + dy); ctx.lineTo(g.a.x - nx * g.wa, g.a.y - ny * g.wa * 0.35 + dy); ctx.closePath();
  };
  ctx.save();
  segs.forEach((g, i) => {
    const L = lens[i]; const k = Math.max(0, Math.min(1, left / L)); left -= L; if (k <= 0.01) return;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; quad(g, k, Math.max(1, g.wa * 0.3)); ctx.fill(); // 살짝 두께 (아래 그림자)
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; quad(g, k, 0); ctx.fill();
  });
  ctx.restore();
}

// ───────── 슈팅 xG (추정) — 골대까지 거리(m) · 슈팅 각도(두 골대 사이 각, 라디안)로 계산하는 공개 로지스틱 모델 ─────────
//  예) 페널티 지점 일반 슈팅 ≈ 0.29 · 6m 정면 ≈ 0.57 · 20m 정면 ≈ 0.09 · PK 0.76 (머리 · 프리킥 · 코너는 낮춤)
export function xgOf(d, th, body = 'foot', sit = 'open', px = null) {
  if (sit === 'pk') return 0.76;
  let z = -1.0 + 1.75 * th - 0.095 * d;
  if (body === 'head') z -= 0.9;
  if (sit === 'fk') z -= 0.35;
  if (sit === 'corner') z -= 0.2;
  if (px) { // 선수 위치: 슈팅 길을 막는 선수 · 바로 옆 압박 · 골키퍼가 길에 없으면(빈 골대) 크게
    z -= 0.45 * Math.min(3, px.blk);
    if (px.press < 1.5) z -= 0.35; else if (px.press < 3) z -= 0.15;
    if (px.open) z += 0.9;
  }
  return Math.max(0.01, Math.min(0.95, 1 / (1 + Math.exp(-z))));
}
// 화면 점(px) → 바닥 자리 · 골대까지 거리 · 각도 (경기장 맞추기가 박스 · 골 에어리어일 때만: 골라인이 X=0)
export function shotInfo(p) { return CAL ? shotFrom(CAL, p) : null; }
// cal: calFrom(...) 결과 · p: 그 cal 의 화면 좌표 — 골대가 있는 기준만 (전체 경기장은 가까운 골대)
export function shotFrom(cal, p) {
  if (!cal || !CAL_TPL[cal.src?.tpl]?.goal) return null;
  const g = { ...cal.S(p) }; const cy = cal.h / 2;
  if (cal.src.tpl === 'full' && g.x > cal.w / 2) g.x = cal.w - g.x; // 반대쪽 골대
  const GH = pitchOf(cal.src).goal / 2; const p1 = { x: 0, y: cy - GH }; const p2 = { x: 0, y: cy + GH };
  const d = Math.hypot(g.x, g.y - cy);
  let th = Math.abs(Math.atan2(p2.y - g.y, p2.x - g.x) - Math.atan2(p1.y - g.y, p1.x - g.x)); if (th > Math.PI) th = 2 * Math.PI - th;
  if (g.x <= 0.2) th = Math.min(th, 0.05); // 골라인 뒤 · 위
  return { g, d, th, posts: [p1, p2], far: cal.src.tpl === 'full' && cal.S(p).x > cal.w / 2 };
}
// 선수 위치(화면 0~1 발 자리들) → 슈팅 길을 막는 선수 · 압박 거리 · 골키퍼
//  cal: calFrom(...) (W·H 는 그 cal 의 화면 크기) · info: shotFrom 결과 · 팀은 구분하지 않음 (같은 편도 슈팅 길은 막음)
export function xgPlayers(cal, info, pl) {
  if (!cal || !info || !Array.isArray(pl) || pl.length < 2) return null;
  const S = info.g; const cy = cal.h / 2;
  const pts = pl.map((q, i) => { const g = cal.S({ x: q.x * cal.W, y: q.y * cal.H }); return { i, g: info.far ? { x: cal.w - g.x, y: g.y } : g }; })
    .filter((o) => Number.isFinite(o.g.x) && Math.hypot(o.g.x - S.x, o.g.y - S.y) > 0.7); // 슈팅한 선수 자신은 빼고
  const gh = pitchOf(cal.src).goal / 2 + 0.45; const P1 = { x: 0, y: cy - gh }; const P2 = { x: 0, y: cy + gh }; // 골대 + 몸 반쪽
  const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const inCone = (g) => { const d1 = side(S, P1, g); const d2 = side(P1, P2, g); const d3 = side(P2, S, g); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) && g.x > -0.5; };
  const gkc = pts.filter((o) => o.g.x < 7 && o.g.x > -1 && Math.abs(o.g.y - cy) < 8).sort((a, b) => Math.hypot(a.g.x, a.g.y - cy) - Math.hypot(b.g.x, b.g.y - cy))[0];
  const blk = pts.filter((o) => o !== gkc && inCone(o.g));
  const press = Math.min(99, ...pts.map((o) => Math.hypot(o.g.x - S.x, o.g.y - S.y)));
  const gkIn = !!gkc && inCone(gkc.g);
  return { blk: blk.length, press, gk: gkc ? gkc.i : null, gkIn, open: info.d < 25 && !!gkc && !gkIn && !blk.length /* 골키퍼를 찾았는데 길에 없을 때만 (못 찾은 건 모름) */, blkI: blk.map((o) => o.i) };
}
const XG_SIT = { open: '일반', fk: '프리킥', corner: '코너킥', pk: 'PK' };
const xgColor = (v) => (v >= 0.35 ? '#ff5a5f' : v >= 0.15 ? '#ffd400' : v >= 0.06 ? '#39e75f' : '#4ea1ff');
// 방송 그래픽 카드 (거리 · 글자 · xG · 속도 같은 모양): 반투명 검은 카드 + 왼쪽 색 띠 · 글자 길이에 맞춰 카드 크기 (칸 밖으로 안 나감)
const BF = 'Pretendard Variable, Pretendard, sans-serif';
const spaced = (ctx, on, u) => { try { ctx.letterSpacing = on ? `${1.6 * u}px` : '0px'; } catch { /* */ } };
function cardBox(ctx, cx, cy, cw, ch, col, u) {
  const r = 10 * u;
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 14 * u; ctx.shadowOffsetY = 4 * u;
  ctx.fillStyle = 'rgba(10,13,12,.86)'; ctx.beginPath(); ctx.roundRect(cx, cy, cw, ch, r); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = u; ctx.beginPath(); ctx.roundRect(cx + 0.5 * u, cy + 0.5 * u, cw - u, ch - u, r); ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(cx, cy, 5 * u, ch, [r, 0, 0, r]); ctx.fill();
}
// o: { x, y: 가리키는 자리(카드는 그 위) · W · col · eyebrow(작은 제목) · big(큰 숫자) · unit · lines(작은 줄들) · k(나타나는 정도) }
export function bcard(ctx, o) {
  const u = o.W / 1280; const k = o.k ?? 1; const pad = 16 * u; const CW = ctx.canvas.width;
  ctx.save(); ctx.globalAlpha *= k; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.font = `800 ${11 * u}px ${BF}`; spaced(ctx, true, u); const ew = o.eyebrow ? ctx.measureText(o.eyebrow).width : 0; spaced(ctx, false, u);
  ctx.font = `900 ${30 * u}px ${BF}`; const bw = o.big != null ? ctx.measureText(o.big).width : 0;
  ctx.font = `700 ${12 * u}px ${BF}`; const uw = o.unit ? ctx.measureText(o.unit).width + 5 * u : 0;
  ctx.font = `600 ${12 * u}px ${BF}`; const lws = (o.lines || []).map((l) => ctx.measureText(l).width);
  const cw = Math.min(CW - 12 * u, Math.max(o.minW ?? 110 * u, Math.max(ew, bw + uw, ...lws, 0) + pad * 2 + 4 * u));
  const ch = 12 * u + (o.eyebrow ? 14 * u : 0) + (o.big != null ? 34 * u : 0) + (o.lines || []).length * 17 * u + 6 * u;
  const cx = Math.max(6 * u, Math.min(CW - cw - 6 * u, o.x - cw / 2)); let cy = o.y - ch - 9 * u; const below = cy < 6 * u; if (below) cy = o.y + 12 * u;
  ctx.translate(0, (1 - k) * 8 * u);
  cardBox(ctx, cx, cy, cw, ch, o.col, u);
  const xt = Math.max(cx + 14 * u, Math.min(cx + cw - 14 * u, o.x)); // 가리키는 꼬리
  ctx.fillStyle = 'rgba(10,13,12,.86)'; ctx.beginPath(); if (below) { ctx.moveTo(xt - 7 * u, cy); ctx.lineTo(xt + 7 * u, cy); ctx.lineTo(xt, cy - 7 * u); } else { ctx.moveTo(xt - 7 * u, cy + ch); ctx.lineTo(xt + 7 * u, cy + ch); ctx.lineTo(xt, cy + ch + 7 * u); } ctx.closePath(); ctx.fill();
  let yy = cy + 12 * u;
  ctx.save(); ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip();
  if (o.eyebrow) { ctx.fillStyle = o.eyeCol || 'rgba(255,255,255,.6)'; ctx.font = `800 ${11 * u}px ${BF}`; spaced(ctx, true, u); ctx.fillText(o.eyebrow, cx + pad, yy + 9 * u); spaced(ctx, false, u); yy += 14 * u; }
  if (o.big != null) { ctx.fillStyle = '#fff'; ctx.font = `900 ${30 * u}px ${BF}`; ctx.fillText(o.big, cx + pad - u, yy + 30 * u); if (o.unit) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `700 ${12 * u}px ${BF}`; ctx.fillText(o.unit, cx + pad + bw + 4 * u, yy + 30 * u); } yy += 34 * u; }
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = `600 ${12 * u}px ${BF}`; (o.lines || []).forEach((l) => { ctx.fillText(l, cx + pad, yy + 13 * u); yy += 17 * u; });
  ctx.restore(); ctx.restore();
}
// 방송 그래픽처럼: 반투명 검은 카드 + 왼쪽 색 띠 + 큰 숫자 + 막대
function xgCard(ctx, x, y, W, H, xg, info, it, k, px = null) {
  const u = W / 1280; const chh = 104 * u; const r = 12 * u;
  // 카드 너비: 안에 들어갈 글자 길이에 맞춤 (글자가 칸 밖으로 안 나가게)
  const F0 = 'Pretendard Variable, Pretendard, sans-serif';
  const ln1 = xg == null ? '' : it.sit === 'pk' ? 'PK' : `${info.d.toFixed(1)}m · ${Math.round((info.th * 180) / Math.PI)}°`;
  const ln2 = xg == null ? '' : px && it.sit !== 'pk' ? (px.open ? '골키퍼 없는 길 · 추정' : `${px.blk ? `막는 선수 ${px.blk}명` : '막는 선수 없음'}${px.gkIn ? ' · GK' : ''} · 추정`) : `${it.body === 'head' ? '머리' : '발'} · ${XG_SIT[it.sit] || '일반'} · 추정`;
  ctx.save(); ctx.font = `900 ${40 * u}px ${F0}`; const nw = ctx.measureText('0.00').width; ctx.font = `600 ${12 * u}px ${F0}`; const lw2 = Math.max(ctx.measureText(ln1).width, ctx.measureText(ln2).width);
  ctx.font = `700 ${17 * u}px ${F0}`; const ew2 = xg == null ? Math.max(ctx.measureText('이 기준엔 골대가 없어요').width, ctx.measureText('경기장 맞추기를 먼저').width) : 0; ctx.font = `600 ${12 * u}px ${F0}`; const ew3 = xg == null ? ctx.measureText('박스 · 반쪽 · 전체 경기장으로 맞추면 계산돼요').width : 0; ctx.restore();
  const cw = Math.max(196 * u, xg == null ? Math.max(ew2, ew3) + 40 * u : 20 * u + nw + 10 * u + lw2 + 20 * u);
  let cx = x + 26 * u; let cy = y - chh - 34 * u;
  if (cx + cw > W - 10 * u) cx = x - cw - 26 * u; if (cy < 10 * u) cy = y + 30 * u; cx = Math.max(10 * u, cx);
  const col = xg == null ? '#9aa3a0' : xgColor(xg);
  ctx.save(); ctx.globalAlpha *= k; ctx.translate(0, (1 - k) * 10 * u);
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 18 * u; ctx.shadowOffsetY = 6 * u;
  ctx.fillStyle = 'rgba(10,13,12,.86)'; ctx.beginPath(); ctx.roundRect(cx, cy, cw, chh, r); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(cx, cy, 6 * u, chh, [r, 0, 0, r]); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1 * u; ctx.beginPath(); ctx.roundRect(cx + 0.5 * u, cy + 0.5 * u, cw - u, chh - u, r); ctx.stroke();
  const F = 'Pretendard Variable, Pretendard, sans-serif';
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `800 ${13 * u}px ${F}`; try { ctx.letterSpacing = `${2 * u}px`; } catch { /* */ }
  ctx.fillText(xg != null && xg >= 0.35 ? 'xG · 결정적 기회' : 'xG · 득점 기대값', cx + 20 * u, cy + 26 * u);
  try { ctx.letterSpacing = '0px'; } catch { /* */ }
  if (xg == null) { const noGoal = !!CAL; ctx.fillStyle = '#fff'; ctx.font = `700 ${17 * u}px ${F}`; ctx.fillText(noGoal ? '이 기준엔 골대가 없어요' : '경기장 맞추기를 먼저', cx + 20 * u, cy + 62 * u); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = `600 ${12 * u}px ${F}`; ctx.fillText(noGoal ? '박스 · 반쪽 · 전체 경기장으로 맞추면 계산돼요' : '측정 → 경기장 맞추기를 하면 계산돼요', cx + 20 * u, cy + 86 * u); ctx.restore(); return; }
  ctx.fillStyle = '#fff'; ctx.font = `900 ${40 * u}px ${F}`; ctx.fillText((xg * k).toFixed(2), cx + 18 * u, cy + 68 * u);
  const tw = ctx.measureText('0.00').width;
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = `600 ${12 * u}px ${F}`;
  ctx.fillText(ln1, cx + 28 * u + tw, cy + 50 * u);
  ctx.fillText(ln2, cx + 28 * u + tw, cy + 68 * u);
  const bx = cx + 20 * u; const bw = cw - 40 * u; const by = cy + 84 * u;
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.roundRect(bx, by, bw, 6 * u, 3 * u); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(bx, by, Math.max(6 * u, bw * xg * k), 6 * u, 3 * u); ctx.fill();
  ctx.restore();
}

export function drawItem(ctx, it, P, W, items, resolve) {
  const lw = Math.max(2, W / 380);
  const prog = it._prog == null ? 1 : it._prog;
  const col = it.color || PALETTE[0];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = lw;
  switch (it.k) {
    case 'arrow': {
      const [a, b, c] = [P(it.a), P(it.b), P(it.c || { x: (resolve(it.a).x + resolve(it.b).x) / 2, y: (resolve(it.a).y + resolve(it.b).y) / 2 })];
      let pts = quadPts(a, c, b, easeOut(prog), it.style === 'dribble' ? 120 : 48);
      if (it.style === 'dribble') pts = wavy(pts, Math.max(4, W / 160) * (it.asz || 1)); // 드리블: 물결선 (끝 화살촉 앞은 곧게)
      if (CAL) groundArrow(ctx, pts, { col, dash: it.style === 'dash', bold: it.weight === 'bold', sz: it.asz || 1 }); else ribbonArrow(ctx, pts, { bold: it.weight === 'bold', W, H: ctx.canvas.height, hz: it._hz, ph: it._ph, col, dash: it.style === 'dash', solid: pts.length > 1, sz: it.asz || 1 });
      if (prog >= 1 && (it.m != null || it.dist)) {
        const m = it.m != null ? it.m : meters(items, resolve(it.a), resolve(it.b));
        if (m != null) label(ctx, `${+(+m).toFixed(1)}m`, (a.x + b.x) / 2, (a.y + b.y) / 2 - lw * 6, W, col === GLASS ? '#ffffff' : col);
      }
      break;
    }
    case 'spot': {
      // 트래킹 선수 발밑: 지나온 길 꼬리 → 옅게 빛나는 원판 + 진한 빛 고리 + 바깥에서 천천히 도는 호 세 조각
      const p = P(it.p);
      const k = easeOut(prog);
      let ringAt; let lwR; let maxW; // ringAt(r배율, 각도) → 화면 점
      const CAL = null; // 선수 표시는 경기장 맞추기와 따로 — 맞춤이 어긋나도 동그라미는 선수 발밑 그대로
      if (CAL) {
        const C = CAL.S(p); const R = 0.95 * (it.scale || 1);
        const ppm = pxPerM(C);
        if (R * ppm < 1) break;
        ringAt = (r, a) => CAL.G(C.x + Math.cos(a) * R * r, C.y + Math.sin(a) * R * r);
        lwR = Math.max(2.2, 0.13 * ppm); maxW = R * 1.1;
      } else {
        const rx = (it.size || 0.025) * W * 0.85; const ry = rx * 0.26; // 바닥에 눕힌 납작함 (세우면 앞쪽 반이 발을 덮음)
        if (rx < 1) break;
        ringAt = (r, a) => ({ x: p.x + Math.cos(a) * rx * r, y: p.y + Math.sin(a) * ry * r });
        lwR = Math.max(2.2, rx * 0.12); maxW = rx * 1.1;
      }
      // 바닥 원판(look 'disc'): 바닥에 납작하게 깔린 색 원판 + 흰 테두리 — 빛 효과 없이 깔끔하게 (선수는 판 위에 서 있음)
      if (it.look === 'disc') {
        if (it._part === 'front') break;
        const c0 = ringAt(0, 0); const e1 = ringAt(1, 0); const e2 = ringAt(1, Math.PI / 2);
        const rx0 = Math.hypot(e1.x - c0.x, e1.y - c0.y); const ry0 = Math.max(1, Math.hypot(e2.x - c0.x, e2.y - c0.y));
        const g = prog < 1 ? easeOut(Math.min(1, prog / 0.7)) : 1;
        const R = rx0 * 1.35 * (0.35 + 0.65 * g);
        const fy = ry0 / rx0; const lw = Math.max(2, R * 0.1);
        const cy0 = c0.y - R * fy * 0.15; // 발이 판 가운데쯤 오게 (발끝 점보다 살짝 위)
        ctx.save(); ctx.globalAlpha = Math.min(1, g * 1.5);
        // 판 두께: 테두리 아래로 살짝 어두운 옆면
        ctx.save(); ctx.translate(c0.x, cy0 + Math.max(1, lw * 0.45)); ctx.scale(1, fy);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(0, 0, R + lw * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        ctx.save(); ctx.translate(c0.x, cy0); ctx.scale(1, fy);
        // 안쪽 색 (가운데가 조금 밝게)
        const inC = it.fill || col;
        const fg = ctx.createRadialGradient(0, -R * 0.2, R * 0.1, 0, 0, R);
        fg.addColorStop(0, rgba(tint(inC, 0.25), 0.82)); fg.addColorStop(1, rgba(inC, 0.78));
        ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
        // 흰 테두리
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
        ctx.restore(); ctx.restore();
        break;
      }
      // 1) 이동 꼬리 + 잔상 (선수 옮기기처럼): 굵게 이어진 꼬리가 끝으로 갈수록 가늘고 투명해지고, 움직일 때 뒤에 옅은 링 잔상 3개
      // it._part: 'back' = 바닥 쪽(선수 다리 뒤로 숨는 먼 쪽 반 + 꼬리 · 그림자 · 빛) / 'front' = 발 앞을 지나는 가까운 쪽 반
      const part = it._part;
      const c00 = ringAt(0, 0);
      const inCol0 = it.fill || tint(col, 0.75);
      if (part !== 'front') {
        // 바닥에 닿은 느낌: 발밑 그림자(선수 몸에 가려 발 주변만 보임) + 링 안쪽 잔디에 은은한 빛
        const e1 = ringAt(1, 0); const e2 = ringAt(1, Math.PI / 2);
        const rx0 = Math.hypot(e1.x - c00.x, e1.y - c00.y); const ry0 = Math.max(1, Math.hypot(e2.x - c00.x, e2.y - c00.y));
        const gk = easeOut(prog);
        ctx.save(); ctx.translate(c00.x, c00.y); ctx.scale(1, ry0 / rx0);
        const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, rx0 * 0.95);
        pool.addColorStop(0, rgba(col, 0.2 * gk)); pool.addColorStop(0.6, rgba(col, 0.1 * gk)); pool.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = pool; ctx.beginPath(); ctx.arc(0, 0, rx0 * 0.95, 0, Math.PI * 2); ctx.fill();
        const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, rx0 * 0.32);
        sh.addColorStop(0, `rgba(0,0,0,${0.3 * gk})`); sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(0, 0, rx0 * 0.32, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      if (part !== 'front' && it._trail && it._trail.length > 2) {
        const tp = it._trail.map(P);
        const n = tp.length;
        // 바닥 좌표(원근 맞춤이면 m, 아니면 화면 px · 세로는 원근만큼 납작하게)
        const toG = CAL ? (q) => CAL.S(q) : (q) => q;
        const fromG = CAL ? (X, Y) => CAL.G(X, Y) : (X, Y) => ({ x: X, y: Y });
        const g = tp.map(toG);
        const end = g[n - 1];
        const rG = CAL ? 0.95 * (it.scale || 1) : (it.size || 0.025) * W * 0.85;
        const flat = CAL ? 1 : 0.26;
        // 링 바깥부터 시작하도록 끝쪽을 잘라냄
        const dist = (a, b) => Math.hypot(b.x - a.x, (b.y - a.y) / flat);
        let cut = n - 1; while (cut > 0 && dist(g[cut], end) < rG * 0.95) cut--;
        const body = g.slice(0, cut + 1);
        let total = 0; for (let i2 = 1; i2 < body.length; i2++) total += dist(body[i2 - 1], body[i2]);
        if (body.length > 1 && total > rG * 0.4) {
          let acc = 0; const cum = body.map((q, i2) => (i2 ? (acc += dist(body[i2 - 1], q)) : 0));
          const L2 = []; const R2 = [];
          body.forEach((q, i2) => {
            const a = body[Math.max(0, i2 - 1)]; const b = body[Math.min(body.length - 1, i2 + 1)];
            const dx = b.x - a.x; const dy = (b.y - a.y) / flat; const l = Math.hypot(dx, dy) || 1;
            const f = cum[i2] / Math.max(1e-6, total); // 0 = 끝, 1 = 선수 쪽
            const wv = rG * 0.55 * f ** 1.4;
            L2.push(fromG(q.x - (dy / l) * wv, q.y + (dx / l) * wv * flat)); R2.push(fromG(q.x + (dy / l) * wv, q.y - (dx / l) * wv * flat));
          });
          const poly = [...L2, ...R2.reverse()];
          const p0 = fromG(body[0].x, body[0].y); const p1 = fromG(body[body.length - 1].x, body[body.length - 1].y);
          const gr = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
          gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(0.55, rgba(col, 0.45)); gr.addColorStop(1, rgba(col, 0.92));
          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.translate(0, Math.max(1, rG * (CAL ? pxPerM(end) : 1) * 0.04)); gpath(ctx, poly); ctx.fill(); ctx.restore();
          ctx.save(); ctx.fillStyle = gr; gpath(ctx, poly); ctx.fill();
          // 가운데 밝은 줄 (두 번째 색)
          const cg = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
          cg.addColorStop(0, rgba(inCol0, 0)); cg.addColorStop(1, rgba(inCol0, 0.7));
          ctx.strokeStyle = cg; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.5, (CAL ? 0.12 * pxPerM(end) : rG * 0.1));
          gpath(ctx, body.slice(Math.floor(body.length * 0.35)).map((q) => fromG(q.x, q.y)), false); ctx.stroke();
          ctx.restore();
        }
        // 잔상: 움직이는 중이면 0.15초 · 0.3초 · 0.45초 전 자리에 옅은 링
        const moved = dist(g[Math.max(0, n - 10)], end) > rG * 0.5;
        if (moved && prog >= 1) {
          [[3, 0.32], [6, 0.2], [9, 0.11]].forEach(([back, al]) => {
            const q = g[Math.max(0, n - 1 - back)]; if (!q) return;
            const pts = Array.from({ length: 41 }, (_, i2) => { const an = (i2 / 40) * Math.PI * 2; return fromG(q.x + Math.cos(an) * rG * 0.9, q.y + Math.sin(an) * rG * 0.9 * flat); });
            ctx.save(); ctx.globalAlpha = al; ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, lwR * 1.3); gpath(ctx, pts); ctx.stroke(); ctx.restore();
          });
        }
      }
      // 2) FIFA 스타일 링: 바깥 띠(팀 색) + 안쪽 띠(두 번째 색), 앞뒤 두 군데 끊김, 살짝 두께
      const inCol = it.fill || tint(col, 0.75);
      const arcPts = (r, a0, a1, nn = 28) => Array.from({ length: nn + 1 }, (_, i2) => ringAt(r, a0 + ((a1 - a0) * i2) / nn));
      const band = (r0, r1, a0, a1) => [...arcPts(r1, a0, a1), ...arcPts(r0, a0, a1).reverse()];
      const gap = 0.26; const g0 = Math.PI / 2 + 0.42; // 끊긴 곳 (앞쪽 조금 오른쪽 · 반대편)
      const sweep = Math.PI - gap;
      const halves = [g0 + gap / 2, g0 + Math.PI + gap / 2];
      // 등장 연출: 0~0.45 빛 줄기, 0.25~1 링이 펼쳐짐
      const fl = prog < 1 ? Math.max(0, 1 - Math.abs(prog - 0.22) / 0.26) : 0;
      if (fl > 0 && part !== 'back') {
        const c0 = ringAt(0, 0); const e1 = ringAt(1, 0); const rw = Math.hypot(e1.x - c0.x, e1.y - c0.y);
        const half = rw * (0.6 + 2.6 * Math.min(1, prog / 0.3));
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const lg = ctx.createLinearGradient(c0.x - half, 0, c0.x + half, 0);
        lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, `rgba(255,255,255,${0.95 * fl})`); lg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = lg; ctx.fillRect(c0.x - half, c0.y - Math.max(1, rw * 0.035), half * 2, Math.max(2, rw * 0.07));
        const rg = ctx.createRadialGradient(c0.x, c0.y, 0, c0.x, c0.y, rw * 0.5);
        rg.addColorStop(0, `rgba(255,255,255,${0.9 * fl})`); rg.addColorStop(0.35, `rgba(255,255,240,${0.35 * fl})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(c0.x, c0.y, rw * 0.5, rw * 0.22, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      const grow = prog < 1 ? easeOut(Math.max(0, (prog - 0.25) / 0.75)) : 1;
      if (grow <= 0.01) break;
      const sc = 0.25 + 0.75 * grow; // 작게 시작해 펼쳐짐
      // 빛 벽: 링 바깥 테두리에서 위로 은은하게 올라오는 빛 (먼 쪽은 선수 뒤, 가까운 쪽은 앞) → 바닥에 놓인 입체 느낌
      if (it.glow !== false) {
        const e1 = ringAt(1, 0); const e2 = ringAt(1, Math.PI / 2);
        const rx1 = Math.hypot(e1.x - c00.x, e1.y - c00.y) * sc; const ry1 = Math.max(1, Math.hypot(e2.x - c00.x, e2.y - c00.y)) * sc;
        const hw = rx1 * 0.9 * grow;
        const wall = (a0, a1, al) => {
          // 세로 띠를 여러 장 — 가운데(정면)는 진하고 양옆 끝으로 갈수록 옅게 (상자처럼 각지지 않게)
          const n2 = 28; const wc = col;
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          for (let i2 = 0; i2 < n2; i2++) {
            const t0 = a0 + ((a1 - a0) * i2) / n2; const t1 = a0 + ((a1 - a0) * (i2 + 1)) / n2;
            const p0 = { x: c00.x + Math.cos(t0) * rx1, y: c00.y + Math.sin(t0) * ry1 }; const p1 = { x: c00.x + Math.cos(t1) * rx1, y: c00.y + Math.sin(t1) * ry1 };
            const k2 = 0.25 + 0.75 * Math.abs(Math.sin((t0 + t1) / 2)); // 옆 끝 옅게
            const g2 = ctx.createLinearGradient(0, Math.max(p0.y, p1.y), 0, Math.min(p0.y, p1.y) - hw);
            g2.addColorStop(0, rgba(wc, al * k2)); g2.addColorStop(0.4, rgba(wc, al * k2 * 0.45)); g2.addColorStop(1, rgba(wc, 0));
            ctx.fillStyle = g2; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p1.x, p1.y - hw); ctx.lineTo(p0.x, p0.y - hw); ctx.closePath(); ctx.fill();
          }
          ctx.restore();
        };
        if (part !== 'front') wall(Math.PI, Math.PI * 2, 0.6); // 먼 쪽 벽 (선수 뒤)
        if (!part) wall(0, Math.PI, 0.3); // 가까운 쪽 벽 — 앞뒤를 나눠 그릴 땐 빼서 선수 다리를 가리지 않게 (선수 모양을 모를 때만)
      }
      // 먼 쪽 반(화면 위쪽)은 바닥 레이어(선수 다리 뒤), 가까운 쪽 반은 발 앞
      if (part) { ctx.save(); ctx.beginPath(); if (part === 'back') ctx.rect(-1e5, -1e5, 2e5, 1e5 + c00.y); else ctx.rect(-1e5, c00.y, 2e5, 1e5); ctx.clip(); }
      const outerB = halves.map((a0) => band(0.8 * sc, sc, a0, a0 + sweep));
      const innerB = halves.map((a0) => band(0.62 * sc, 0.8 * sc, a0, a0 + sweep));
      ctx.save(); ctx.globalAlpha = Math.min(1, grow * 1.6);
      const thick = Math.max(1, lwR * 0.38);
      // 중계 화면 느낌 링: 두께 있는 옆면 · 위(먼 쪽)는 밝고 아래(가까운 쪽)는 진한 윗면 · 가장자리 반짝임 · 링을 따라 도는 빛
      const top = ringAt(sc, -Math.PI / 2); const bot = ringAt(sc, Math.PI / 2);
      const paint = (shapes, c3, depth) => {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.filter = `blur(${Math.max(1, depth * 0.9).toFixed(1)}px)`;
        ctx.translate(0, depth * 1.7); shapes.forEach((sh) => { gpath(ctx, sh); ctx.fill(); }); ctx.restore();
        ctx.save();
        const side = ctx.createLinearGradient(0, top.y, 0, bot.y + depth);
        side.addColorStop(0, shade(c3, -0.25)); side.addColorStop(1, shade(c3, -0.6));
        ctx.fillStyle = side;
        for (let d = depth; d > 0; d -= Math.max(0.5, depth / 4)) { ctx.save(); ctx.translate(0, d); shapes.forEach((sh) => { gpath(ctx, sh); ctx.fill(); }); ctx.restore(); }
        const face = ctx.createLinearGradient(0, top.y, 0, bot.y);
        face.addColorStop(0, tint(c3, 0.45)); face.addColorStop(0.45, c3); face.addColorStop(1, shade(c3, -0.12));
        ctx.fillStyle = face; shapes.forEach((sh) => { gpath(ctx, sh); ctx.fill(); });
        ctx.restore();
      };
      const rimLine = (r, a0, a1, al, w2) => { ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${al})`; ctx.lineWidth = w2; ctx.lineCap = 'round'; gpath(ctx, arcPts(r, a0, a1, 24), false); ctx.stroke(); ctx.restore(); };
      paint(outerB, col, thick * 1.5);
      paint(innerB, inCol, thick);
      // 가장자리 반짝임: 바깥 띠 위쪽 테두리 · 안쪽 띠 아래쪽 테두리 (빛이 위에서 비추는 것처럼)
      const hw2 = Math.max(0.8, lwR * 0.12);
      halves.forEach((a0) => { rimLine(sc, a0 + 0.05, a0 + sweep - 0.05, 0.55, hw2); rimLine(0.62 * sc, a0 + 0.05, a0 + sweep - 0.05, 0.22, hw2 * 0.8); });
      // 링을 따라 천천히 도는 빛 (내보낸 영상에서도 같은 속도)
      if (it._flow != null && it.sheen !== false && grow >= 1) {
        const ang = (it._flow * 1.3) % (Math.PI * 2);
        const q = ringAt(0.82 * sc, ang); const e1 = ringAt(1, 0); const rr = Math.hypot(e1.x - c00.x, e1.y - c00.y) * 0.55;
        ctx.save();
        ctx.beginPath(); [...outerB, ...innerB].forEach((sh) => { sh.forEach((pt, k2) => (k2 ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y))); ctx.closePath(); }); ctx.clip();
        const sg = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, rr);
        sg.addColorStop(0, 'rgba(255,255,255,0.75)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = sg; ctx.fillRect(q.x - rr, q.y - rr, rr * 2, rr * 2);
        ctx.restore();
      }
      ctx.restore();
      if (part) ctx.restore();
      break;
    }
    case 'poly':
    case 'link': {
      // 도형으로 잇기: 마지막 선수 → 첫 선수까지 닫음 (삼각형 · 사각형 …)
      // 면 채우기를 켜면 테두리 선도 마지막 선수 → 첫 선수까지 이어서 닫음
      const lp = it.k === 'link' && (it.closed || it.area) && it.pts.length >= 3 ? [...it.pts, it.pts[0]] : it.pts;
      let pts = lp.map(P);
      if (pts.length < 2) break;
      const fade = it.k === 'poly' ? easeOut(prog) : 1;
      if (it.k === 'link') pts = partialLine(pts, easeOut(prog));
      ctx.globalAlpha = fade;
      // 동그라미는 늘 손잡이 네 점을 꼭 지나는 타원 (카메라가 누워 있어도 손잡이대로 — 바닥 원으로 바꾸면 멀리서 크게 벗어나 다루기 어려움)
      // 수비 라인 '벽': 이은 선수들 사이에 세운 반투명 판 (선수 키만큼)
      if (it.k === 'link' && it.wall && it._phs && it.pts.length > 1) {
        const full = lp.map(P); const nP = it.pts.length; const ph = (k) => it._phs[k % nP];
        ctx.save();
        for (let i = 0; i < full.length - 1; i++) {
          const a = full[i]; const b = full[i + 1];
          const ha = (ph(i) || ph(i + 1) || W / 14) * 0.95; const hb = (ph(i + 1) || ph(i) || W / 14) * 0.95;
          const top = Math.min(a.y - ha, b.y - hb);
          const gr = ctx.createLinearGradient(0, Math.max(a.y, b.y), 0, top);
          gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.globalAlpha = 0.6 * fade * easeOut(prog); ctx.fillStyle = gr;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x, b.y - hb); ctx.lineTo(a.x, a.y - ha); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 0.85 * fade * easeOut(prog); ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, lw * 0.7);
          ctx.beginPath(); ctx.moveTo(a.x, a.y - ha); ctx.lineTo(b.x, b.y - hb); ctx.stroke();
        }
        ctx.restore();
      }
      const build = (c) => {
        if (it.shape === 'circle' && pts.length === 4) {
          const cx = (pts[0].x + pts[2].x) / 2; const cy = (pts[1].y + pts[3].y) / 2;
          c.ellipse(cx, cy, Math.max(1, Math.abs(pts[0].x - pts[2].x) / 2), Math.max(1, Math.abs(pts[1].y - pts[3].y) / 2), 0, 0, Math.PI * 2);
        } else if (it.shape === 'circle') smoothClosed(c, pts);
        else pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      };
      const ys = [Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y))];
      const k3 = perspK((ys[0] + ys[1]) / 2, ctx.canvas.height, it._hz);
      const wdt = Math.max(2.5, W / 300) * k3;
      if (it.k === 'poly') {
        slabFill(ctx, build, col, lw, fade, ys);
        solid(ctx, build, { col, width: wdt, depth: wdt * 0.9, closed: true });
      } else {
        // 면 채우기: 이은 선수들이 만드는 모양 (라인 · 블록)
        if (it.area && pts.length >= 3 && prog > 0.55) groundTint(ctx, it.pts.map(P), col, easeOut(Math.min(1, (prog - 0.55) / 0.45)));
        // 바닥 원판 모양: 선수 발밑 원판 가장자리끼리 잇는 바닥에 깔린 흰 띠 (가까울수록 넓게)
        if (it.look === 'disc') { discBands(ctx, lp, P, it, prog, W); break; }
        // 잔디에 깔린 팀 색 선 — 기본 실선 (선택: 점선)
        const dashOn = it.lstyle === 'dash'; // 기본은 실선
        if (CAL && it.groundLine) { // 바닥에 깔린 띠(실제 두께)는 따로 켰을 때만 — 기본은 경기장을 맞춰도 같은 굵기의 선 (가까운 쪽이 너무 두꺼워지지 않게)
          const g = lp.map(P).map((q) => CAL.S(q));
          const segs = [];
          // 선수 → 선수 순서로 그어짐 (한꺼번에 자라지 않고 앞 선이 다 그어지면 다음 선)
          const lens = []; for (let i3 = 0; i3 < g.length - 1; i3++) lens.push(Math.hypot(g[i3 + 1].x - g[i3].x, g[i3 + 1].y - g[i3].y));
          let left = lens.reduce((x, y) => x + y, 0) * easeOut(prog);
          for (let i3 = 0; i3 < g.length - 1; i3++) {
            const a = g[i3]; const b = g[i3 + 1]; const L0 = lens[i3]; const L = Math.max(0, Math.min(L0, left)); left -= L0; if (L < 0.05) continue;
            const ux = (b.x - a.x) / (L0 || 1); const uy = (b.y - a.y) / (L0 || 1); const nx = -uy * 0.15; const ny = ux * 0.15;
            const step = dashOn ? 1.5 : L; const on = dashOn ? 0.9 : L;
            for (let d = 0.6; d < L - 0.6; d += step) { const e = Math.min(L - 0.6, d + on); segs.push([[a.x + ux * d + nx, a.y + uy * d + ny], [a.x + ux * e + nx, a.y + uy * e + ny], [a.x + ux * e - nx, a.y + uy * e - ny], [a.x + ux * d - nx, a.y + uy * d - ny]].map(([X, Y]) => CAL.G(X, Y))); }
          }
          if (segs.length) paintCrisp(ctx, segs, col, Math.max(2, 0.25 * pxPerM(g[0])));
        } else {
          ctx.save(); ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
          if (dashOn) ctx.setLineDash([wdt * 3.6, wdt * 2.4]);
          ctx.strokeStyle = shade(col, -0.45); ctx.lineWidth = wdt * 1.8; ctx.translate(0, Math.max(1, wdt * 0.35));
          ctx.beginPath(); build(ctx); ctx.stroke();
          ctx.translate(0, -Math.max(1, wdt * 0.35)); ctx.strokeStyle = col;
          ctx.beginPath(); build(ctx); ctx.stroke();
          ctx.restore();
        }
        // 흐르는 빛: 다 그어진 뒤 이은 선을 따라 밝은 빛이 계속 지나감 (선수끼리 이어진 느낌)
        if (it._flow != null && it.flow !== false && prog >= 1) flowLight(ctx, lp.map(P), it._flow, wdt, col);
      }
      break;
    }
    case 'grid': {
      if (it.q.length < 4) { // 만드는 중
        const q = it.q.map(P);
        ctx.setLineDash([lw * 2, lw * 2]);
        ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
        break;
      }
      const H = gridH(it);
      if (!H) break;
      const k = easeOut(prog);
      const Q = (u, v) => P(project(H, u, v));
      // 체크무늬 바닥
      for (let i = 0; i < it.cols; i++) {
        for (let j = 0; j < it.rows; j++) {
          const q = [Q(i / it.cols, j / it.rows), Q((i + 1) / it.cols, j / it.rows), Q((i + 1) / it.cols, (j + 1) / it.rows), Q(i / it.cols, (j + 1) / it.rows)];
          ctx.globalAlpha = ((i + j) % 2 ? 0.05 : 0.14) * k;
          ctx.beginPath(); q.forEach((p, n) => (n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill();
        }
      }
      // 안쪽 선
      ctx.globalAlpha = 0.5 * k;
      ctx.lineWidth = lw * 0.5;
      ctx.shadowColor = rgba(col, 0.6); ctx.shadowBlur = lw * 2;
      ctx.beginPath();
      for (let i = 1; i < it.cols; i++) { const p1 = Q(i / it.cols, 0); const p2 = Q(i / it.cols, 1); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
      for (let j = 1; j < it.rows; j++) { const p1 = Q(0, j / it.rows); const p2 = Q(1, j / it.rows); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
      ctx.stroke();
      // 테두리
      ctx.globalAlpha = k;
      ctx.lineWidth = lw * 1.1;
      ctx.beginPath(); [Q(0, 0), Q(1, 0), Q(1, 1), Q(0, 1)].forEach((p, n) => (n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
      break;
    }
    case 'measure': {
      // 거리: 잔디에 칠한 줄자 띠(원근) + 양 끝에 세운 깃대 + 바닥 고리 — 위에 거리 글자 (drawMeasureLabel)
      const a = P(it.a);
      const b = P(it.b);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 3) break;
      const k = easeOut(prog);
      const H0 = ctx.canvas.height;
      // 바닥 좌표: 경기장 맞춤이면 m, 아니면 화면 px (세로는 원근만큼 납작)
      const flat = 0.42;
      const toG = CAL ? (q) => CAL.S(q) : (q) => ({ x: q.x, y: q.y / flat });
      const fromG = CAL ? (X, Y) => CAL.G(X, Y) : (X, Y) => ({ x: X, y: Y * flat });
      const A = toG(a); const B0 = toG(b);
      const B = { x: A.x + (B0.x - A.x) * k, y: A.y + (B0.y - A.y) * k };
      const L = Math.hypot(B.x - A.x, B.y - A.y);
      if (L < 1e-3) break;
      const ux = (B.x - A.x) / L; const uy = (B.y - A.y) / L;
      const hw = CAL ? 0.32 : Math.max(3, W / 300) * perspK((a.y + b.y) / 2, H0, it._hz); // 띠 반폭 (m 또는 px)
      const quad = (s0, s1, w0) => [[s0, -w0], [s1, -w0], [s1, w0], [s0, w0]].map(([sv, wv]) => fromG(A.x + ux * sv - uy * wv, A.y + uy * sv + ux * wv));
      const poly = (pts) => { ctx.beginPath(); pts.forEach((p, i2) => (i2 ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };
      ctx.save();
      // 중계 화면식 거리 표시: 잔디 위 옅은 그림자 + 점선 (xG 슈팅 길과 같은 모양) · 양 끝 바닥 고리
      ctx.globalAlpha = 0.35; ctx.fillStyle = 'rgba(0,0,0,.7)'; poly(quad(0, L, hw * 1.6)); ctx.fill(); ctx.globalAlpha = 1;
      const e = fromG(B.x, B.y);
      ctx.strokeStyle = col; ctx.lineWidth = lw * 1.1; ctx.lineCap = 'round'; ctx.setLineDash([lw * 3, lw * 2.2]);
      ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = lw * 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.setLineDash([]); ctx.shadowBlur = 0;
      const rr = Math.max(6, W / 120);
      const ring = (q, s2) => { ctx.strokeStyle = col; ctx.lineWidth = lw * 1.1; ctx.beginPath(); ctx.ellipse(q.x, q.y, rr * 1.5 * s2, rr * 0.62 * s2, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(q.x, q.y, rr * 0.3 * s2, 0, Math.PI * 2); ctx.fill(); };
      ring(a, 1); if (k >= 1) ring(b, 1);
      ctx.restore();
      break;
    }
    case 'xg': {
      // 슈팅 xG: 바닥에 깔린 슈팅 각도(골대 두 기둥까지) + 슈팅 자리 고리 + 카드
      const p = P(it.p); const k = easeOut(prog); const H = ctx.canvas.height;
      const info = shotInfo(p);
      const px = info && !it.noPl ? xgPlayers(CAL, info, it.pl) : null;
      const xg = info ? (it.sit === 'pk' ? 0.76 : xgOf(info.d, info.th, it.body, it.sit, px)) : null;
      const colx = xg == null ? '#9aa3a0' : xgColor(xg);
      ctx.save(); ctx.globalAlpha = k;
      if (info) {
        const PX = (q) => CAL.G(info.far ? CAL.w - q.x : q.x, q.y); const A = PX(info.posts[0]); const B = PX(info.posts[1]); // 전체 경기장: 반대쪽 골대
        const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
        const gr = ctx.createLinearGradient(p.x, p.y, mid.x, mid.y); gr.addColorStop(0, 'rgba(255,255,255,.04)'); gr.addColorStop(1, `${colx}66`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = colx; ctx.lineWidth = lw * 0.9; ctx.setLineDash([lw * 3, lw * 2.2]);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(A.x, A.y); ctx.moveTo(p.x, p.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw * 2; ctx.shadowColor = colx; ctx.shadowBlur = lw * 4;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.shadowBlur = 0;
      }
      // 선수 위치: 슈팅 길을 막는 선수(빨강) · 골키퍼(노랑) 발밑 고리
      if (px && it.sit !== 'pk') {
        const ring = (q, c2) => { const s2 = P(q); const r2 = Math.max(6, W / 130); ctx.strokeStyle = c2; ctx.lineWidth = lw; ctx.beginPath(); ctx.ellipse(s2.x, s2.y, r2 * 1.5 * k, r2 * 0.6 * k, 0, 0, Math.PI * 2); ctx.stroke(); };
        px.blkI.forEach((i) => ring(it.pl[i], '#ff5a5f'));
        if (px.gk != null) ring(it.pl[px.gk], '#ffd400');
      }
      // 슈팅 자리: 바닥 고리 두 겹 + 가운데 공
      const rr = Math.max(7, W / 110);
      ctx.strokeStyle = colx; ctx.lineWidth = lw * 1.2; ctx.beginPath(); ctx.ellipse(p.x, p.y, rr * 1.6 * k, rr * 0.7 * k, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = k * 0.5; ctx.beginPath(); ctx.ellipse(p.x, p.y, rr * 2.5 * k, rr * 1.1 * k, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = k;
      ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = rr * 0.6; ctx.beginPath(); ctx.arc(p.x, p.y - rr * 0.2, rr * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.restore();
      xgCard(ctx, p.x, p.y, W, H, xg, info, it, k, px);
      break;
    }
    case 'timer': {
      // 스톱워치: 시작부터 흐른 '경기 시간'(영상 시각) — 끝에서 멈추고 잠깐 그대로 · 방송 카드 + 둥근 진행 막대
      const p = P(it.p); const u = W / 1280; const k = easeOut(prog);
      const now = it._now ?? it.t0; const end = it.t1 ?? Infinity;
      const el = Math.max(0, Math.min(now, end) - it.t0); const done = now >= end - 1e-3;
      const num = el < 60 ? el.toFixed(1) : `${Math.floor(el / 60)}:${(el % 60).toFixed(1).padStart(4, '0')}`;
      ctx.save(); ctx.globalAlpha *= k;
      ctx.font = `900 ${40 * u}px ${BF}`; const nw = ctx.measureText(num).width;
      ctx.font = `800 ${13 * u}px ${BF}`; spaced(ctx, true, u); const tw = ctx.measureText(it.name || '시간').width; spaced(ctx, false, u);
      const cw = Math.max(200 * u, 22 * u + Math.max(nw + 34 * u, tw) + 84 * u); const chh = 96 * u;
      const cx = Math.max(6 * u, Math.min(ctx.canvas.width - cw - 6 * u, p.x - cw / 2)); const cy = Math.max(6 * u, Math.min(ctx.canvas.height - chh - 6 * u, p.y - chh / 2));
      const accent = done ? '#39e75f' : col;
      cardBox(ctx, cx, cy, cw, chh, accent, u);
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.font = `800 ${13 * u}px ${BF}`; spaced(ctx, true, u); ctx.fillText(it.name || '시간', cx + 22 * u, cy + 30 * u); spaced(ctx, false, u);
      ctx.fillStyle = '#fff'; ctx.font = `900 ${40 * u}px ${BF}`; ctx.fillText(num, cx + 20 * u, cy + 78 * u);
      ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.font = `700 ${16 * u}px ${BF}`; ctx.fillText(el < 60 ? '초' : '', cx + 26 * u + nw, cy + 78 * u);
      const rcx = cx + cw - 44 * u; const rcy = cy + chh / 2; const rr = 26 * u;
      ctx.lineWidth = 6 * u; ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.beginPath(); ctx.arc(rcx, rcy, rr, 0, Math.PI * 2); ctx.stroke();
      const fr = Number.isFinite(end) ? Math.min(1, el / Math.max(0.1, end - it.t0)) : (el % 1);
      ctx.strokeStyle = accent; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(rcx, rcy, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fr); ctx.stroke();
      ctx.restore();
      break;
    }
    case 'text': {
      // 글자: 크기(fs 배율) · 배경색(bg, 'none' = 투명 · 기본 반투명 검정) 조절
      const p = P(it.p);
      const fs = Math.max(10, (W / 52) * (it.fs || 1));
      const k = easeOut(prog);
      ctx.save();
      ctx.globalAlpha = k;
      ctx.font = `800 ${fs}px ${BF}`;
      // 여러 줄 (Enter 로 줄 바꿈) · 기본은 중계 화면 자막처럼: 비스듬한 검은 판 + 왼쪽 색 띠 + 아래 색 줄
      //  첫 줄은 크게(제목) · 다음 줄은 작게(설명) · 왼쪽에서 밀려 나오며 나타남 / 배경을 고르면 그 색 판 · 투명이면 글자 그림자만
      const rows = String(it.t || '').split('\n').slice(0, 4).filter((r0, i) => i === 0 || r0.trim());
      const card = it.bg == null || it.bg === 'rgba(0,0,0,.72)';
      if (card) {
        const sfs = fs * 0.62; const padX = fs * 0.7; const padY = fs * 0.42; const lh1 = fs * 1.12; const lh2 = sfs * 1.35;
        ctx.font = `900 ${fs}px ${BF}`; const w1 = ctx.measureText(rows[0] || '').width;
        ctx.font = `600 ${sfs}px ${BF}`; const w2 = Math.max(0, ...rows.slice(1).map((r0) => ctx.measureText(r0).width));
        const h0 = padY * 2 + lh1 + (rows.length - 1) * lh2; const sl = h0 * 0.26; const bar = fs * 0.32;
        const w0 = Math.max(w1, w2) + padX * 2 + bar + sl;
        const x0 = p.x - w0 / 2; const y0 = p.y - h0 / 2;
        const para = (xa, wa) => { ctx.beginPath(); ctx.moveTo(xa + sl, y0); ctx.lineTo(xa + wa + sl, y0); ctx.lineTo(xa + wa, y0 + h0); ctx.lineTo(xa, y0 + h0); ctx.closePath(); };
        ctx.save(); ctx.beginPath(); ctx.rect(x0 - 2, y0 - fs, (w0 + sl + 4) * k, h0 + fs * 2); ctx.clip(); // 왼쪽에서 밀려 나옴
        ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = fs * 0.5; ctx.shadowOffsetY = fs * 0.12;
        const gr = ctx.createLinearGradient(0, y0, 0, y0 + h0); gr.addColorStop(0, 'rgba(22,26,24,.95)'); gr.addColorStop(1, 'rgba(8,10,9,.92)');
        ctx.fillStyle = gr; para(x0, w0); ctx.fill(); ctx.shadowColor = 'transparent';
        ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.moveTo(x0 + sl, y0); ctx.lineTo(x0 + w0 + sl, y0); ctx.lineTo(x0 + w0 + sl * 0.5, y0 + h0 * 0.5); ctx.lineTo(x0 + sl * 0.5, y0 + h0 * 0.5); ctx.closePath(); ctx.fill(); // 위쪽 은은한 빛
        ctx.fillStyle = col; para(x0, bar); ctx.fill(); // 왼쪽 색 띠
        ctx.fillRect(x0 + bar * 0.4, y0 + h0 - Math.max(2, fs * 0.07), (w0 - bar) * 0.55, Math.max(2, fs * 0.07)); // 아래 색 줄
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const tx = x0 + bar + sl * 0.5 + padX * 0.8;
        ctx.fillStyle = '#ffffff'; ctx.font = `900 ${fs}px ${BF}`; ctx.fillText(rows[0] || '', tx, y0 + padY + fs * 0.92);
        ctx.fillStyle = 'rgba(255,255,255,.78)'; ctx.font = `600 ${sfs}px ${BF}`;
        rows.slice(1).forEach((r0, i) => ctx.fillText(r0, tx - (sl * (i + 1) * lh2) / h0, y0 + padY + lh1 + lh2 * (i + 0.8)));
        ctx.restore();
      } else {
        const lh = fs * 1.3; const tw = Math.max(...rows.map((r0) => ctx.measureText(r0).width)); const bx = fs * 0.5;
        const bw0 = tw + bx * 2; const bh = rows.length * lh + fs * 0.5; const x0 = p.x - bw0 / 2; const y0 = p.y - bh / 2;
        if (it.bg !== 'none') { ctx.fillStyle = it.bg === GLASS ? 'rgba(255,255,255,.42)' : it.bg; ctx.beginPath(); ctx.roundRect(x0, y0, bw0, bh, fs * 0.3); ctx.fill(); }
        else { ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = fs * 0.25; ctx.shadowOffsetY = fs * 0.04; } // 배경 없을 땐 글자 그림자로 잘 보이게
        ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        rows.forEach((r0, i) => ctx.fillText(r0, p.x, y0 + fs * 0.25 + lh * (i + 0.5)));
      }
      ctx.restore();
      break;
    }
    case 'vision': {
      // 선수 눈앞으로 펼쳐지는 V자 시야 (끝으로 갈수록 옅게)
      const a = P(it.a); const b = P(it.b);
      const len = Math.hypot(b.x - a.x, b.y - a.y) * easeOut(prog);
      if (len < 2) break;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const half = ((it.spread || 50) * Math.PI) / 360;
      // 선수에서 뻗어 나가는 반투명 쐐기: 가까운 쪽은 진하고 끝으로 갈수록 사라짐 · 테두리 없이 부드럽게
      let fan; let far;
      if (CAL) {
        const A = CAL.S(a); const B = CAL.S(b);
        const gl = Math.hypot(B.x - A.x, B.y - A.y) * easeOut(prog); const ga = Math.atan2(B.y - A.y, B.x - A.x);
        fan = [CAL.G(A.x, A.y)];
        for (let i2 = 0; i2 <= 24; i2++) { const an = ga - half + (i2 / 24) * 2 * half; fan.push(CAL.G(A.x + Math.cos(an) * gl, A.y + Math.sin(an) * gl)); }
        far = CAL.G(A.x + Math.cos(ga) * gl, A.y + Math.sin(ga) * gl);
      } else {
        fan = [a];
        for (let i2 = 0; i2 <= 24; i2++) { const an = ang - half + (i2 / 24) * 2 * half; fan.push({ x: a.x + Math.cos(an) * len, y: a.y + Math.sin(an) * len }); }
        far = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
      }
      const op = it.vop ?? 0.55; // 진하기
      const fadeEnd = it.vfade !== false; // 끝으로 갈수록 옅게
      const grad = ctx.createLinearGradient(a.x, a.y, far.x, far.y);
      grad.addColorStop(0, rgba(col, op)); grad.addColorStop(0.55, rgba(col, fadeEnd ? op * 0.4 : op * 0.8)); grad.addColorStop(1, rgba(col, fadeEnd ? 0 : op * 0.6));
      const Lf = Math.hypot(far.x - a.x, far.y - a.y);
      ctx.save(); ctx.filter = `blur(${Math.max(1, Lf * 0.025).toFixed(1)}px)`; ctx.fillStyle = grad; gpath(ctx, fan); ctx.fill(); ctx.restore();
      if (it.vedge) { // 양쪽 테두리 선
        ctx.save(); ctx.strokeStyle = rgba(col, Math.min(1, op + 0.3)); ctx.lineWidth = Math.max(1.5, W / 500); ctx.setLineDash([W / 140, W / 220]);
        ctx.beginPath(); ctx.moveTo(fan[0].x, fan[0].y); ctx.lineTo(fan[1].x, fan[1].y); ctx.moveTo(fan[0].x, fan[0].y); ctx.lineTo(fan[fan.length - 1].x, fan[fan.length - 1].y); ctx.stroke(); ctx.restore();
      }
      break;
    }
    case 'offside': {
      const op = P(it.p); const H0 = ctx.canvas.height;
      // 선 · 어둡게 하는 면은 경기장 안에만 (카메라가 경기장 밖까지 보여도 관중석 · 하늘로 안 나가게)
      //  경기장 맞춤이 있으면 터치라인 사이(바닥 m) · 없으면 잔디가 시작되는 높이(지평선) 아래
      let clip = null;
      if (CAL) {
        const g2 = CAL.S(op); const q = CAL.G(g2.x, g2.y + 10); it = { ...it, d: { x: (q.x - op.x) / W, y: (q.y - op.y) / H0 } };
        const tpl = CAL.src?.tpl; const cy = CAL.h / 2;
        const [y0, y1] = tpl === 'center' ? [-CAL.h / 2, CAL.h / 2] : tpl === 'half' || tpl === 'full' ? [0, CAL.h] : tpl === 'rect' ? [null, null] : [cy - pitchOf(CAL.src).W / 2, cy + pitchOf(CAL.src).W / 2];
        if (y0 != null) {
          const quad = [[g2.x - 60, y0], [g2.x + 60, y0], [g2.x + 60, y1], [g2.x - 60, y1]].map(([X, Y]) => CAL.G(X, Y));
          if (quad.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Math.abs(v.x) < W * 20 && Math.abs(v.y) < H0 * 20)) clip = quad;
        }
      }
      if (!clip && it._ft?.length) { // 경기장 맞춤이 없으면: 세로줄마다 잔디가 시작하는 선을 따라 (그물 · 골대 · 관중석은 안 칠함)
        const n = it._ft.length; const pts = [];
        const floor = it._hz != null ? Math.max(0, it._hz - 0.02) : 0; // 나무 · 초록 그물도 잔디처럼 보여서: 화면 전체로 본 잔디 시작선보다 위로는 안 감
        const yAt = (i) => Math.min(H0, Math.max(floor, it._ft[i]) * H0);
        for (let i = 0; i < n; i += 2) pts.push({ x: (i / (n - 1)) * W, y: yAt(i) });
        pts.push({ x: W, y: yAt(n - 1) }, { x: W, y: H0 }, { x: 0, y: H0 });
        clip = pts;
      }
      if (!clip && it._hz != null) { const yh = Math.max(0, it._hz * H0 - H0 * 0.01); clip = [{ x: 0, y: yh }, { x: W, y: yh }, { x: W, y: H0 }, { x: 0, y: H0 }]; }
      ctx.save();
      if (clip) { ctx.beginPath(); clip.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y))); ctx.closePath(); ctx.clip(); }
      drawOffside(ctx, it, op, W, H0, col, easeOut(prog));
      ctx.restore();
      break;
    }
    default:
  }
  ctx.restore();
}

export function nameTag(ctx, txt, x, y, W, col, fill = null) {
  const raw = String(txt).trim(); if (!raw) return;
  const m = /^(\d{1,3})\s+(.+)$/.exec(raw);
  const num = m ? m[1] : null; const name = (m ? m[2] : raw).toUpperCase();
  const bg = fill || (col === '#ffffff' ? '#111111' : '#ffffff');
  const fg = col === bg ? (col === '#111111' ? '#ffffff' : '#111111') : col;
  const fs = Math.max(12, W / 60);
  ctx.save();
  ctx.font = `800 ${fs}px Pretendard, sans-serif`;
  const nw = num ? ctx.measureText(num).width + fs * 0.7 : 0;
  const tw = ctx.measureText(name).width + fs * 0.8;
  const hgt = fs * 1.4; const x0 = x - (nw + tw) / 2; const y0 = y - hgt;
  ctx.fillStyle = rgba(bg, 0.82); ctx.fillRect(x0 + nw, y0, tw, hgt);
  if (num) { ctx.fillStyle = fg; ctx.fillRect(x0, y0, nw, hgt); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (num) { ctx.fillStyle = bg; ctx.fillText(num, x0 + nw / 2, y0 + hgt / 2 + fs * 0.05); }
  ctx.fillStyle = fg; ctx.fillText(name, x0 + nw + tw / 2, y0 + hgt / 2 + fs * 0.05);
  ctx.restore();
}

export function label(ctx, txt, x, y, W, col, big = false) {
  const fs = Math.max(11, W / (big ? 52 : 70));
  ctx.save();
  ctx.font = `800 ${fs}px Pretendard, sans-serif`;
  const w = ctx.measureText(txt).width + fs;
  ctx.fillStyle = 'rgba(0,0,0,.72)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - fs * 0.85, w, fs * 1.5, fs * 0.3);
  ctx.fill();
  ctx.fillStyle = col;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(txt, x, y - fs * 0.1);
  ctx.restore();
}

// 각도 숫자 (예전에 만든 각도 그림용)
export function drawAngleLabel(ctx, it, P, W) {
  if (it.k !== 'angle' || (it._prog ?? 1) < 1) return;
  const a = P(it.a); const b = P(it.b); const c = P(it.c);
  const deg = it.deg != null ? +it.deg : angleDeg(a, b, c);
  const a1 = Math.atan2(b.y - a.y, b.x - a.x); let d = Math.atan2(c.y - a.y, c.x - a.x) - a1;
  while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const mid = a1 + d / 2; const r = Math.min(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y)) * 0.5;
  label(ctx, `${Math.round(deg)}°`, a.x + Math.cos(mid) * r, a.y + Math.sin(mid) * r, W, it.color || PALETTE[0]);
}

// 거리 측정 라벨은 크로마키 위(가려지지 않게)에 그린다
// 팀 간격: 선수 연결로 이은 선수들의 폭(터치라인 쪽으로 · 경기장 가로) · 깊이(골대 쪽으로 · 경기장 세로) — 경기장 맞추기가 있어야 m
export function drawLinkDims(ctx, it, P, W) {
  const pts = (it.pts || []).map(P).filter((q) => q && Number.isFinite(q.x));
  if (pts.length < 2) return;
  const u = W / 1280; const k = it._prog == null ? 1 : Math.min(1, Math.max(0, (it._prog - 0.4) / 0.6));
  const top = pts.reduce((a, b) => (b.y < a.y ? b : a)); const cxs = pts.reduce((v, q) => v + q.x, 0) / pts.length;
  const col = it.color || PALETTE[0];
  if (!CAL) { bcard(ctx, { x: cxs, y: top.y - 18 * u, W, col, eyebrow: '팀 간격', lines: ['경기장 맞추기를 하면 m 로 나와요'], k }); return; }
  const g = pts.map((q) => CAL.S(q)); const xs = g.map((q) => q.x); const ys = g.map((q) => q.y);
  const depth = Math.max(...xs) - Math.min(...xs); const width = Math.max(...ys) - Math.min(...ys); // X = 골대 쪽(길이) · Y = 가로(폭)
  if (!Number.isFinite(depth) || !Number.isFinite(width)) return;
  bcard(ctx, { x: cxs - 70 * u, y: top.y - 18 * u, W, col, eyebrow: '폭', big: width.toFixed(1), unit: 'm', minW: 120 * u, k });
  bcard(ctx, { x: cxs + 70 * u, y: top.y - 18 * u, W, col, eyebrow: '깊이', big: depth.toFixed(1), unit: 'm', minW: 120 * u, k });
}
export function drawMeasureLabel(ctx, it, P, W, items, resolve) {
  if (it.k !== 'measure') return;
  const a = P(it.a);
  const b = P(it.b);
  const auto = meters(items, resolve(it.a), resolve(it.b)); // 옮기면 다시 잼 (직접 적은 값만 그대로)
  const m = it.m != null && (it.mFix || auto == null) ? +it.m : auto;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const lift = CAL ? 1.1 * pxPerM(CAL.S(mid)) : W / 45 * perspK(mid.y, ctx.canvas.height, it._hz); // 바닥에서 조금 띄워서
  bcard(ctx, { x: mid.x, y: mid.y - lift * 0.6, W, col: it.color || PALETTE[0], eyebrow: 'DISTANCE', ...(m != null ? { big: (+m).toFixed(1), unit: 'm' } : { lines: ['경기장 맞추기를 하면 m 로 나와요'] }), k: it._prog == null ? 1 : Math.min(1, Math.max(0, (it._prog - 0.5) / 0.5)) });
}

// 선수 사진 오려내기: 영상에서 선수 네모 영역을 읽어 잔디 픽셀은 투명하게 (선수 이동 기능용)
export function cutPlayer(video, fx, fy, ph, key) {
  const VW = video.videoWidth;
  const VH = video.videoHeight;
  const h = Math.max(8, Math.round(ph * 1.12));
  const w = Math.max(6, Math.round(ph * 0.75));
  const x0 = Math.round(fx - w / 2);
  const y0 = Math.round(fy - h + ph * 0.04);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(video, x0, y0, w, h, 0, 0, w, h);
  const im = g.getImageData(0, 0, w, h);
  const d = im.data;
  const n = w * h;
  // 1) 잔디가 아닌 곳
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const p = i * 4; fg[i] = isGrass(d[p], d[p + 1], d[p + 2], key) ? 0 : 1; }
  // 2) 가는 선(경기장 라인 · 그물 등) 지우기: 깎았다가(erode) 다시 불림(dilate)
  const r = ph > 110 ? 2 : 1;
  const morph = (src, keepIf) => {
    const out = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let cnt = 0; let tot = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; tot++; cnt += src[yy * w + xx]; }
        }
        out[y * w + x] = keepIf(cnt, tot) ? 1 : 0;
      }
    }
    return out;
  };
  const open = morph(morph(fg, (k, t) => k === t), (k) => k > 0);
  // 3) 몸통(상자 가운데 · 위에서 55%)에서 가장 가까운 덩어리를 씨앗으로 이어진 부분만
  const cx = w / 2;
  let seed = -1; let best = Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!open[y * w + x]) continue;
      const dd = (x - cx) ** 2 + ((y - h * 0.5) * 0.6) ** 2;
      if (dd < best) { best = dd; seed = y * w + x; }
    }
  }
  const keep = new Uint8Array(n);
  if (seed >= 0) {
    const st = [seed];
    keep[seed] = 1;
    while (st.length) {
      const i = st.pop();
      const x = i % w; const y = (i - x) / w;
      const nb = [x > 0 && i - 1, x < w - 1 && i + 1, y > 0 && i - w, y < h - 1 && i + w];
      for (const j of nb) if (j !== false && open[j] && !keep[j]) { keep[j] = 1; st.push(j); }
    }
    // 4) 줄마다 몸 가운데(±22%)에 걸친 부분만 — 옆 사람 · 배경이 붙어 들어오는 것 막기
    const core = ph * 0.22;
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        if (!keep[y * w + x]) { x++; continue; }
        let e = x;
        while (e < w && keep[y * w + e]) e++;
        if (e - 1 < cx - core || x > cx + core) for (let k = x; k < e; k++) keep[y * w + k] = 0;
        x = e;
      }
    }
  }
  // 5) 깎였던 가장자리 되살리기(원래 잔디 아닌 곳 안에서만) + 테두리는 반투명으로 부드럽게
  const grow = morph(keep, (k) => k > 0);
  for (let i = 0; i < n; i++) {
    const on = grow[i] && fg[i];
    let a = on ? 255 : 0;
    if (on) {
      const x = i % w; const y = (i - x) / w;
      const edge = (x > 0 && !(grow[i - 1] && fg[i - 1])) || (x < w - 1 && !(grow[i + 1] && fg[i + 1]))
        || (y > 0 && !(grow[i - w] && fg[i - w])) || (y < h - 1 && !(grow[i + w] && fg[i + w]));
      if (edge) a = 150;
    }
    d[i * 4 + 3] = a;
  }
  g.putImageData(im, 0, 0);
  return { url: c.toDataURL('image/png'), bg: cleanPlate(d, w, h), wN: w / VW, hN: h / VH, footOff: (y0 + h - fy) / VH };
}

// 선수를 지운 '빈 자리' 그림: 선수 픽셀을 주변(좌우 · 위아래) 잔디 색으로 메움 → 원래 자리에 덮으면 선수가 사라져 보임
function cleanPlate(d, w, h) {
  const n = w * h;
  const hole = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] > 0) hole[i] = 1;
  // 윤곽까지 덮게 2픽셀 넓힘
  for (let r = 0; r < 2; r++) {
    const nx = Uint8Array.from(hole);
    for (let i = 0; i < n; i++) if (hole[i]) { const x = i % w; if (x > 0) nx[i - 1] = 1; if (x < w - 1) nx[i + 1] = 1; if (i >= w) nx[i - w] = 1; if (i < n - w) nx[i + w] = 1; }
    hole.set(nx);
  }
  const out = new Uint8ClampedArray(n * 4);
  const acc = new Float32Array(n * 3); const wt = new Float32Array(n);
  const add = (i, j, k) => { acc[i * 3] += d[j * 4] * k; acc[i * 3 + 1] += d[j * 4 + 1] * k; acc[i * 3 + 2] += d[j * 4 + 2] * k; wt[i] += k; };
  // 가로로: 구멍 양옆 픽셀 사이를 이어 칠함
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!hole[y * w + x]) { x++; continue; }
      let e = x; while (e < w && hole[y * w + e]) e++;
      const L = x > 0 ? y * w + x - 1 : -1; const R = e < w ? y * w + e : -1;
      for (let k = x; k < e; k++) {
        const tt = (k - x + 1) / (e - x + 1);
        if (L >= 0 && R >= 0) { add(y * w + k, L, 1 - tt); add(y * w + k, R, tt); } else if (L >= 0) add(y * w + k, L, 1); else if (R >= 0) add(y * w + k, R, 1);
      }
      x = e;
    }
  }
  // 세로로도 (잔디 줄무늬 · 그림자 결이 자연스럽게)
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!hole[y * w + x]) { y++; continue; }
      let e = y; while (e < h && hole[e * w + x]) e++;
      const T = y > 0 ? (y - 1) * w + x : -1; const B = e < h ? e * w + x : -1;
      for (let k = y; k < e; k++) {
        const tt = (k - y + 1) / (e - y + 1);
        if (T >= 0 && B >= 0) { add(k * w + x, T, 1 - tt); add(k * w + x, B, tt); } else if (T >= 0) add(k * w + x, T, 1); else if (B >= 0) add(k * w + x, B, 1);
      }
      y = e;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!hole[i] || !wt[i]) continue;
    out[i * 4] = acc[i * 3] / wt[i]; out[i * 4 + 1] = acc[i * 3 + 1] / wt[i]; out[i * 4 + 2] = acc[i * 3 + 2] / wt[i]; out[i * 4 + 3] = 255;
  }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.putImageData(new ImageData(out, w, h), 0, 0);
  // 살짝 흐리게 해서 줄무늬 자국을 숨김 (구멍 안에서만)
  const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
  const g2 = c2.getContext('2d');
  g2.filter = `blur(${Math.max(1, Math.round(h / 60))}px)`;
  g2.drawImage(c, 0, 0);
  g2.filter = 'none';
  g2.globalCompositeOperation = 'destination-in';
  g2.drawImage(c, 0, 0);
  return c2.toDataURL('image/png');
}

// 직접 자르기: 코치가 감싼 네모(영상 픽셀) 안에서 잔디만 투명하게. 가운데 덩어리와 이어진 부분만 남김
export function cutBox(video, box, key) {
  const VW = video.videoWidth;
  const VH = video.videoHeight;
  const x0 = Math.max(0, Math.round(box.x0)); const y0 = Math.max(0, Math.round(box.y0));
  const w = Math.max(4, Math.min(VW - x0, Math.round(box.x1 - box.x0)));
  const h = Math.max(4, Math.min(VH - y0, Math.round(box.y1 - box.y0)));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(video, x0, y0, w, h, 0, 0, w, h);
  const im = g.getImageData(0, 0, w, h);
  const d = im.data;
  const n = w * h;
  const fg = new Uint8Array(n);
  let fgN = 0;
  for (let i = 0; i < n; i++) { const p = i * 4; fg[i] = isGrass(d[p], d[p + 1], d[p + 2], key) ? 0 : 1; fgN += fg[i]; }
  // 잔디가 거의 없으면(실내 · 다른 색 바닥) 네모 그대로
  if (fgN < n * 0.92) {
    // 가는 선(라인 · 그물) 지우기: 깎았다가 다시 불림
    const morph = (src, keepIf) => {
      const out = new Uint8Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let cnt = 0; let tot = 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; tot++; cnt += src[yy * w + xx]; } }
        out[y * w + x] = keepIf(cnt, tot) ? 1 : 0;
      }
      return out;
    };
    const open = morph(morph(fg, (k, t) => k === t), (k) => k > 0);
    // 네모 안의 덩어리들 중 가운데에 가깝고 큰 것들을 남김 (선수 몸이 두세 덩어리로 갈라져도 이어지게)
    const lab = new Int32Array(n).fill(-1);
    const blobs = [];
    for (let i = 0; i < n; i++) {
      if (!open[i] || lab[i] >= 0) continue;
      const id = blobs.length; const st = [i]; lab[i] = id; let cnt = 0; let sx = 0; let sy = 0;
      while (st.length) {
        const j = st.pop(); cnt++; const x = j % w; const y = (j - x) / w; sx += x; sy += y;
        for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) if (k >= 0 && open[k] && lab[k] < 0) { lab[k] = id; st.push(k); }
      }
      blobs.push({ cnt, cx: sx / cnt / w, cy: sy / cnt / h });
    }
    const big = Math.max(1, ...blobs.map((b) => b.cnt));
    const keepId = new Set(blobs.map((b, i) => [b, i]).filter(([b]) => b.cnt > big * 0.08 && Math.abs(b.cx - 0.5) < 0.4).map(([, i]) => i));
    for (let i = 0; i < n; i++) {
      const on = open[i] && keepId.has(lab[i]);
      // 원래 잔디가 아닌 가장자리는 살리고, 경계는 반투명
      let a = on || (fg[i] && ((i % w > 0 && open[i - 1] && keepId.has(lab[i - 1])) || (i % w < w - 1 && open[i + 1] && keepId.has(lab[i + 1])))) ? 255 : 0;
      if (a && (i % w === 0 || i % w === w - 1 || !fg[i])) a = 150;
      d[i * 4 + 3] = a;
    }
    g.putImageData(im, 0, 0);
  }
  return { url: c.toDataURL('image/png'), bg: cleanPlate(d, w, h), wN: w / VW, hN: h / VH, fx: x0 + w / 2, fy: y0 + h };
}
