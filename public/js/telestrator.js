// 영상 분석 엔진 — 프레임 분석(크로마키 마스크), 선수 트래킹, 원근 그리드(호모그래피), 그림 렌더링
// 모든 좌표는 영상 기준 0~1 정규화 좌표. 점은 {x, y} 또는 추적 대상에 붙은 {tr: id}.

export const GLASS = 'rgba(255,255,255,0.42)'; // 투명색 (반투명 흰색)
export const PALETTE = ['#ffd400', '#ff3b30', '#ffffff', '#00d1ff', '#34c759', GLASS];
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
export const CAL_TPL = {
  box: { l: '페널티박스', w: 16.5, h: 40.32 },
  six: { l: '골 에어리어', w: 5.5, h: 18.32 },
  rect: { l: '직접 입력', w: 20, h: 20 },
};
export const calSize = (c) => (c.tpl === 'rect' ? { w: +c.w || 20, h: +c.h || 20 } : CAL_TPL[c.tpl] || CAL_TPL.box);
// c: { q: 화면 네 점(0~1) } → { G(X,Y) 바닥→화면 px, S(px) 화면→바닥 }
export function calFrom(c, Wpx, Hpx) {
  if (!c?.q || c.q.length !== 4) return null;
  const { w, h } = calSize(c);
  const src = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
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
  const { w, h } = cal;
  const L = (pts) => pts.map(([X, Y]) => cal.G(X, Y));
  const lw = Math.max(1.5, Wpx / 700);
  ctx.save();
  ctx.lineJoin = 'round';
  // 보조선: 골라인 · 앞 선 · 양옆 선을 화면 밖까지 길게 (영상의 선과 겹치는지 보기 쉽게)
  ctx.setLineDash([lw * 4, lw * 4]);
  ctx.strokeStyle = 'rgba(0,209,255,0.55)';
  ctx.lineWidth = lw;
  [[[0, -60], [0, h + 60]], [[w, -60], [w, h + 60]], [[-40, 0], [w + 60, 0]], [[-40, h], [w + 60, h]]].forEach((seg) => { gpath(ctx, L(seg), false); ctx.stroke(); });
  ctx.setLineDash([]);
  // 네모 · 골라인
  ctx.strokeStyle = active ? '#00d1ff' : 'rgba(0,209,255,0.8)';
  ctx.lineWidth = lw * 2;
  gpath(ctx, L([[0, 0], [w, 0], [w, h], [0, h]])); ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw * 3.2;
  gpath(ctx, L([[0, 0], [0, h]]), false); ctx.stroke();
  // 박스: 골 에어리어 · 페널티 지점 · 아크
  if (c.tpl !== 'rect') {
    ctx.strokeStyle = 'rgba(0,209,255,0.75)'; ctx.lineWidth = lw * 1.4;
    if (c.tpl === 'box') {
      const y0 = (h - 18.32) / 2;
      gpath(ctx, L([[0, y0], [5.5, y0], [5.5, y0 + 18.32], [0, y0 + 18.32]]), false); ctx.stroke();
      const s = cal.G(11, h / 2); ctx.fillStyle = '#00d1ff'; ctx.beginPath(); ctx.arc(s.x, s.y, lw * 2.4, 0, Math.PI * 2); ctx.fill();
      const arc = []; const a0 = Math.acos((w - 11) / 9.15);
      for (let i = 0; i <= 24; i++) { const a = -a0 + (i / 24) * 2 * a0; arc.push(cal.G(11 + Math.cos(a) * 9.15, h / 2 + Math.sin(a) * 9.15)); }
      gpath(ctx, arc, false); ctx.stroke();
    }
    // 골대 (골라인 가운데 7.32m)
    const g0 = cal.G(0, h / 2 - 3.66); const g1 = cal.G(0, h / 2 + 3.66);
    ctx.strokeStyle = '#ffd400'; ctx.lineWidth = lw * 4; ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.stroke();
  }
  // 모서리 손잡이 · 골라인 글자
  c.q.forEach((p, i) => {
    const x = p.x * Wpx; const y = p.y * Hpx; const r = Math.max(7, Wpx / 120);
    ctx.fillStyle = i === 0 || i === 3 ? '#ffffff' : '#00d1ff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  });
  const m = cal.G(-1.2, h / 2);
  label(ctx, '골라인', m.x, m.y, Wpx, '#ffffff');
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
    if (bad) for (const i of b.px) occ[i] = 0;
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
  return dh <= 14 + key.tol * 0.5;
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
  measure(video, cx, cy, key, hz = null) {
    const m1 = this.measureK(video, cx, cy, key, hz, 1);
    if (m1 && m1.ph >= 26) return m1;
    // 멀리 있는(작게 보이는) 선수: 주변만 2배 확대해서 다시 — 가는 다리 · 몸이 잡음으로 지워지지 않게
    const m2 = this.measureK(video, cx, cy, key, hz, 2);
    return m2 || m1;
  }
  measureK(video, cx, cy, key, hz, K) {
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
    // 몸 중심: 아래쪽 2/3 행들의 가운데값
    const cs = [];
    for (let y = Math.max(top, y2 - Math.round(ph * 0.66)); y <= y2; y++) if (rowsN[y]) cs.push(rows[y] / rowsN[y]);
    cs.sort((a, b) => a - b);
    const mx = cs.length ? cs[cs.length >> 1] : sx / n;
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
    const m = this.measure(video, nx, ny - st.ph * 0.15, key, st.hz);
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
  if (t <= p[0][0]) return { x: p[0][1], y: p[0][2], h: p[0][3] };
  const last = p[p.length - 1];
  if (t >= last[0]) return { x: last[1], y: last[2], h: last[3] };
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
  return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k, h };
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
  const avg = (c, half, step) => {
    let sx = 0; let sy = 0; let sh = 0; let sw = 0; const sg = half / 2;
    for (let d = -half; d <= half + 1e-9; d += step) {
      const q = trackerPos(tr, c + d); if (!q) continue;
      const w = Math.exp(-(d * d) / (2 * sg * sg)); sx += q.x * w; sy += q.y * w; sh += (q.h || 0) * w; sw += w;
    }
    return sw ? { x: sx / sw, y: sy / sw, h: sh / sw } : null;
  };
  const tEnd = tr.path[tr.path.length - 1][0];
  if (t > tEnd - 0.45) {
    const back = (c, span) => { let sx = 0; let sy = 0; let sh = 0; let sw = 0; for (let d = 0; d <= span + 1e-9; d += 0.04) { const q = trackerPos(tr, c - d); if (!q) continue; const w = 1 - d / (span + 0.04); sx += q.x * w; sy += q.y * w; sh += (q.h || 0) * w; sw += w; } return sw ? { x: sx / sw, y: sy / sw, h: sh / sw } : null; };
    const now = Math.min(t, tEnd);
    const m0 = back(now, 0.28); const m1 = back(now - 0.2, 0.28);
    if (!m0 || !m1) return trackerPos(tr, t);
    const hh0 = Math.max(0.02, m0.h || tr.h || 0.08);
    const slow = back(now, 1.0); const before = back(now - 0.7, 0.3);
    // 서 있는지: 지금과 0.7초 전 위치 차이를 선수 키와 비교
    const mvL = before ? Math.hypot(m0.x - before.x, m0.y - before.y) / hh0 : 1;
    const k2 = Math.min(1, Math.max(0, (mvL - 0.12) / 0.25)); // 서 있으면 0 → 1초 평균으로 고정
    const lead = 0.5 * k2; // 뛸 때만 평균 때문에 늦어진 만큼 앞으로
    const fx = m0.x + (m0.x - m1.x) * lead; const fy = m0.y + (m0.y - m1.y) * lead;
    return { x: slow.x + (fx - slow.x) * k2, y: slow.y + (fy - slow.y) * k2, h: slow.h || m0.h };
  }
  const near = avg(t, 0.4, 0.05); const wide = avg(t, 1.0, 0.08);
  const a = avg(t - 0.5, 0.3, 0.05); const b = avg(t + 0.5, 0.3, 0.05);
  if (!near || !wide || !a || !b) return near || trackerPos(tr, t);
  // 가만히 있는지: 앞뒤 1초 사이에 움직인 거리를 선수 키와 비교 (멀리 있는 작은 선수도 같은 기준)
  const hh = Math.max(0.02, wide.h || tr.h || 0.08);
  const mv = Math.hypot(a.x - b.x, a.y - b.y) / hh;
  const k = Math.min(1, Math.max(0, (mv - 0.18) / 0.3)); // 키의 18% 안쪽이면 고정, 키의 절반 넘게 움직이면 그대로 따라감
  // 키(링 크기)는 항상 넓게 평균 — 커졌다 작아졌다 하지 않게
  return { x: wide.x + (near.x - wide.x) * k, y: wide.y + (near.y - wide.y) * k, h: wide.h };
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
  arrow: [it.a, it.b, it.c], spot: [it.p], poly: it.pts, link: it.pts, grid: it.q, measure: [it.a, it.b], text: [it.p], move: [it.b], zoom: [it.p], light: [it.p], offside: [it.p], vision: [it.a, it.b], angle: [it.a, it.b, it.c],
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
      if (CAL) {
        const C = CAL.S(p); const R = 0.95 * (it.scale || 1);
        const ppm = pxPerM(C);
        if (R * ppm < 1) break;
        ringAt = (r, a) => CAL.G(C.x + Math.cos(a) * R * r, C.y + Math.sin(a) * R * r);
        lwR = Math.max(2.2, 0.13 * ppm); maxW = R * 1.1;
      } else {
        const rx = (it.size || 0.025) * W * 0.85; const ry = rx * 0.36;
        if (rx < 1) break;
        ringAt = (r, a) => ({ x: p.x + Math.cos(a) * rx * r, y: p.y + Math.sin(a) * ry * r });
        lwR = Math.max(2.2, rx * 0.12); maxW = rx * 1.1;
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
        const flat = CAL ? 1 : 0.36;
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
          const n2 = 24; const base = []; for (let i2 = 0; i2 <= n2; i2++) { const an = a0 + ((a1 - a0) * i2) / n2; base.push({ x: c00.x + Math.cos(an) * rx1, y: c00.y + Math.sin(an) * ry1 }); }
          const gr = ctx.createLinearGradient(0, c00.y + ry1, 0, c00.y - ry1 - hw);
          const wc = col; // 팀 색 빛을 잔디 위에 더함(lighter) — 아래가 진하고 위로 사라짐
          gr.addColorStop(0, rgba(wc, al)); gr.addColorStop(0.4, rgba(wc, al * 0.5)); gr.addColorStop(1, rgba(wc, 0));
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gr; ctx.beginPath();
          base.forEach((q, i2) => (i2 ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
          for (let i2 = base.length - 1; i2 >= 0; i2--) ctx.lineTo(base[i2].x, base[i2].y - hw);
          ctx.closePath(); ctx.fill(); ctx.restore();
        };
        if (part !== 'front') wall(Math.PI, Math.PI * 2, 0.6); // 먼 쪽 벽 (선수 뒤)
        if (part !== 'back') wall(0, Math.PI, 0.3); // 가까운 쪽 벽 (선수 앞 · 더 옅게)
      }
      // 먼 쪽 반(화면 위쪽)은 바닥 레이어(선수 다리 뒤), 가까운 쪽 반은 발 앞
      if (part) { ctx.save(); ctx.beginPath(); if (part === 'back') ctx.rect(-1e5, -1e5, 2e5, 1e5 + c00.y); else ctx.rect(-1e5, c00.y, 2e5, 1e5); ctx.clip(); }
      const outerB = halves.map((a0) => band(0.8 * sc, sc, a0, a0 + sweep));
      const innerB = halves.map((a0) => band(0.62 * sc, 0.8 * sc, a0, a0 + sweep));
      ctx.save(); ctx.globalAlpha = Math.min(1, grow * 1.6);
      const thick = Math.max(1, lwR * 0.38);
      const paint = (shapes, c3) => {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.filter = `blur(${Math.max(1, thick * 0.8).toFixed(1)}px)`;
        ctx.translate(0, thick * 1.6); shapes.forEach((sh) => { gpath(ctx, sh); ctx.fill(); }); ctx.restore();
        ctx.save(); ctx.fillStyle = shade(c3, -0.45);
        for (let d = thick; d > 0; d -= Math.max(0.6, thick / 3)) { ctx.save(); ctx.translate(0, d); shapes.forEach((sh) => { gpath(ctx, sh); ctx.fill(); }); ctx.restore(); }
        ctx.fillStyle = c3; shapes.forEach((sh) => { gpath(ctx, sh); ctx.fill(); });
        ctx.restore();
      };
      paint(outerB, col);
      paint(innerB, inCol);
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
      // 원근 맞춤: 동그라미는 잔디 위의 진짜 원으로
      if (CAL && it.k === 'poly' && it.shape === 'circle' && pts.length === 4) {
        const cx = (pts[0].x + pts[2].x) / 2; const cy = (pts[1].y + pts[3].y) / 2;
        const C = CAL.S({ x: cx, y: cy });
        const R = pts.reduce((v, q) => { const g2 = CAL.S(q); return v + Math.hypot(g2.x - C.x, g2.y - C.y); }, 0) / 4;
        pts = gcircle(C, R, 64);
        it = { ...it, shape: 'gpoly' };
      }
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
        // 잔디에 깔린 팀 색 선 — 기본 실선 (선택: 점선)
        const dashOn = it.lstyle === 'dash'; // 기본은 실선
        if (CAL) {
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
      // 중계 화면식 거리 표시: 잔디 위 얇은 그림자 띠 + 양쪽 화살촉 선 + 양 끝 가로 표시 (깃대 없음)
      ctx.globalAlpha = 0.4; ctx.fillStyle = 'rgba(0,0,0,.6)'; poly(quad(0, L, hw * 2.4)); ctx.fill(); ctx.globalAlpha = 1;
      const head = Math.min(L * 0.3, hw * 8); // 화살촉 길이
      ctx.fillStyle = col;
      poly(quad(head * 0.7, L - (k >= 1 ? head * 0.7 : 0), hw * 0.9)); ctx.fill(); // 가운데 선
      const tri = (s0, dir) => { const tip = s0; const back = s0 + dir * head; return [fromG(A.x + ux * tip, A.y + uy * tip), fromG(A.x + ux * back - uy * hw * 3.2, A.y + uy * back + ux * hw * 3.2), fromG(A.x + ux * back + uy * hw * 3.2, A.y + uy * back - ux * hw * 3.2)]; };
      poly(tri(0, 1)); ctx.fill(); // 시작 쪽 화살촉
      if (k >= 1) { poly(tri(L, -1)); ctx.fill(); } // 끝 쪽 화살촉
      const tick = (s0) => poly([[s0 - hw * 0.6, -hw * 4.5], [s0 + hw * 0.6, -hw * 4.5], [s0 + hw * 0.6, hw * 4.5], [s0 - hw * 0.6, hw * 4.5]].map(([sv, wv]) => fromG(A.x + ux * sv - uy * wv, A.y + uy * sv + ux * wv)));
      ctx.fillStyle = '#ffffff'; tick(0); ctx.fill(); if (k >= 1) { tick(L); ctx.fill(); } // 양 끝 가로 표시 (흰색)
      ctx.restore();
      break;
    }
    case 'text': {
      const p = P(it.p);
      label(ctx, it.t, p.x, p.y, W, col, true);
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
      const op = P(it.p);
      if (CAL) { const g2 = CAL.S(op); const q = CAL.G(g2.x, g2.y + 10); it = { ...it, d: { x: (q.x - op.x) / W, y: (q.y - op.y) / ctx.canvas.height } }; }
      drawOffside(ctx, it, op, W, ctx.canvas.height, col, easeOut(prog));
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
export function drawMeasureLabel(ctx, it, P, W, items, resolve) {
  if (it.k !== 'measure') return;
  const a = P(it.a);
  const b = P(it.b);
  const m = it.m != null ? +it.m : meters(items, resolve(it.a), resolve(it.b));
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const lift = CAL ? 1.1 * pxPerM(CAL.S(mid)) : W / 45 * perspK(mid.y, ctx.canvas.height, it._hz); // 바닥에서 조금 띄워서
  label(ctx, m != null ? `${+m.toFixed(1)}m` : '? m', mid.x, mid.y - lift, W, it.color || PALETTE[0]);
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
