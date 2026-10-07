// 영상 분석 엔진 — 프레임 분석(크로마키 마스크), 선수 트래킹, 원근 그리드(호모그래피), 그림 렌더링
// 모든 좌표는 영상 기준 0~1 정규화 좌표. 점은 {x, y} 또는 추적 대상에 붙은 {tr: id}.

export const GLASS = 'rgba(255,255,255,0.42)'; // 투명색 (반투명 흰색)
export const PALETTE = ['#ffd400', '#ff3b30', '#ffffff', '#00d1ff', '#34c759', GLASS];
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
    const m = this.mctx.createImageData(AW, AH);
    const md = m.data;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      md[p] = md[p + 1] = md[p + 2] = 255;
      md[p + 3] = isGrass(d[p], d[p + 1], d[p + 2], key) ? 255 : 0;
    }
    this.mctx.putImageData(m, 0, 0);
    this.ok = true;
    this.estimateCamera();
    return true;
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
    const md = this.mctx.getImageData(0, 0, AW, AH).data;
    for (let y = 0; y < AH; y += 2) {
      let n = 0;
      for (let x = 0; x < AW; x += 4) if (md[(y * AW + x) * 4 + 3]) n++;
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
    const VW = video.videoWidth;
    const VH = video.videoHeight;
    const box = Math.round(VH * 0.24);
    const x0 = Math.max(0, Math.round(cx - box / 2));
    const y0 = Math.max(0, Math.round(cy - box * 0.85));
    const w = Math.min(box, VW - x0);
    const h = Math.min(Math.round(box * 1.0), VH - y0);
    const { d } = this.read(video, x0, y0, w, h);
    const t = Math.max(2, Math.round(VH / 240)); // 720p 기준 3px
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
    const rows = new Float32Array(h);
    const rowsN = new Uint16Array(h);
    while (q.length) {
      const i = q.pop();
      const x = i % w; const y = (i / w) | 0;
      n++; sx += x; rows[y] += x; rowsN[y]++;
      if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
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
      const below = cy - hz * VH;
      if (below > 10) {
        const maxH = below * 0.8;
        const minH = below * 0.18;
        if (ph > maxH) { top = y2 + 1 - Math.round(maxH); ph = Math.round(maxH); } // 뒤쪽 사람들과 붙은 경우 아래쪽만
        if (ph < minH) { top = y2 + 1 - Math.round(minH); ph = Math.round(minH); }
      }
    }
    if (ph < 8 || x2 - x1 + 1 > ph * 1.8) return null;
    // 몸 중심: 아래쪽 2/3 행들의 가운데값
    const cs = [];
    for (let y = Math.max(top, y2 - Math.round(ph * 0.66)); y <= y2; y++) if (rowsN[y]) cs.push(rows[y] / rowsN[y]);
    cs.sort((a, b) => a - b);
    const mx = cs.length ? cs[cs.length >> 1] : sx / n;
    return { x: x0 + mx, y: y0 + y2 + 1, ph: Math.min(ph, box * 0.95) };
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
    const k = Math.min(1, 26 / st.ph);
    const r = this.read(video, x0, y0, x1 - x0, y1 - y0, k);
    const tw = Math.max(4, Math.round(b.tw * k));
    const th = Math.max(6, Math.round(b.th * k));
    const stp = Math.max(1, Math.round(tw / 6));
    const H = st.hist;
    let best = -1;
    let bx = -1;
    let by = -1;
    let bestBc = 0;
    for (let y = 0; y <= r.h - th; y += stp) {
      for (let x = 0; x <= r.w - tw; x += stp) {
        const { hst, n } = this.hist(r.d, r.w, x, y, tw, th, key);
        if (n < tw * th * 0.12) continue;
        let bc = 0;
        for (let i = 0; i < 96; i++) bc += Math.sqrt(hst[i] * H[i]);
        bc /= 2;
        const dist = Math.hypot(x0 + (x + tw / 2) / k - px, y0 + (y + th) / k - py) / Math.max(R, st.ph * 0.4);
        const score = bc - dist * 0.08;
        if (score > best) { best = score; bestBc = bc; bx = x; by = y; }
      }
    }
    if (bx < 0 || bestBc < 0.42) {
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
      if (Math.abs(m.ph - st.ph) < st.ph * 0.25) {
        const target = Math.min(st.ph * 1.01, Math.max(st.ph * 0.99, m.ph));
        st.ph = Math.min(st.ph0 * 1.6, Math.max(st.ph0 * 0.6, target));
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
      const cr = this.read(video, bb.x0, bb.y0, bb.tw, bb.th, Math.min(1, 26 / st.ph));
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
    // 수동으로 찍은 점 사이는 부드러운 곡선으로 (Catmull-Rom)
    const p0 = p[Math.max(0, lo - 1)];
    const p3 = p[Math.min(p.length - 1, hi + 1)];
    const cr = (q0, q1, q2, q3) => 0.5 * (2 * q1 + (-q0 + q2) * k + (2 * q0 - 5 * q1 + 4 * q2 - q3) * k * k + (-q0 + 3 * q1 - 3 * q2 + q3) * k * k * k);
    return { x: cr(p0[1], a[1], b[1], p3[1]), y: cr(p0[2], a[2], b[2], p3[2]), h };
  }
  return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k, h };
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
export const GROUND = new Set(['arrow', 'spot', 'poly', 'link', 'grid', 'measure']);
export const itemPoints = (it) => ({
  arrow: [it.a, it.b, it.c], spot: [it.p], poly: it.pts, link: it.pts, grid: it.q, measure: [it.a, it.b], text: [it.p], move: [it.b],
}[it.k] || []);

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
function ribbonArrow(ctx, pts, { W, H, hz, col, dash }) {
  if (pts.length < 2) return;
  const hzPx = (hz ?? 0.3) * H;
  const base = Math.max(9, W / 62);
  const widthAt = (p) => base * Math.min(1.3, Math.max(0.5, 0.25 + (p.y - hzPx) / Math.max(1, H - hzPx)));
  // 화살촉 길이만큼 몸통을 줄임
  const tip = pts[pts.length - 1];
  const headLen = widthAt(tip) * 2.8;
  let acc = 0;
  let cut = pts.length - 1;
  for (let i = pts.length - 1; i > 0; i--) { acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (acc >= headLen) { cut = i; break; } cut = i - 1; }
  const body = pts.slice(0, Math.max(1, cut) + 1);
  const neck = body[body.length - 1];
  const ang = Math.atan2(tip.y - neck.y, tip.x - neck.x);
  // 몸통 띠 (구간마다 법선 방향으로 폭만큼)
  const side = (arr, sgn) => arr.map((p, i) => {
    const q = arr[Math.min(arr.length - 1, i + 1)];
    const o = arr[Math.max(0, i - 1)];
    const a2 = Math.atan2(q.y - o.y, q.x - o.x);
    const w = widthAt(p) / 2;
    return { x: p.x + Math.cos(a2 + (Math.PI / 2) * sgn) * w, y: p.y + Math.sin(a2 + (Math.PI / 2) * sgn) * w };
  });
  const segs = [];
  if (dash && body.length > 2) {
    // 길이를 따라 띠를 끊기
    let run = 0; let on = true; let cur = [body[0]];
    const dashLen = base * 2.2; const gap = base * 1.3;
    for (let i = 1; i < body.length; i++) {
      run += Math.hypot(body[i].x - body[i - 1].x, body[i].y - body[i - 1].y);
      cur.push(body[i]);
      if (run >= (on ? dashLen : gap)) { if (on && cur.length > 1) segs.push(cur); on = !on; run = 0; cur = [body[i]]; }
    }
    if (on && cur.length > 1) segs.push(cur);
  } else segs.push(body);
  const hw = widthAt(tip) * 1.5;
  const head = [
    { x: tip.x, y: tip.y },
    { x: neck.x + Math.cos(ang + Math.PI / 2) * hw, y: neck.y + Math.sin(ang + Math.PI / 2) * hw },
    { x: neck.x + Math.cos(ang - Math.PI / 2) * hw, y: neck.y + Math.sin(ang - Math.PI / 2) * hw },
  ];
  const shapes = [...segs.map((sg) => [...side(sg, 1), ...side(sg, -1).reverse()]), head];
  const path = (poly) => { ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };
  ctx.save();
  // 그림자 (바닥에 살짝 아래로)
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.translate(0, base * 0.35);
  shapes.forEach((sh) => { path(sh); ctx.fill(); });
  ctx.restore();
  ctx.save();
  ctx.fillStyle = col;
  ctx.strokeStyle = col === GLASS ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.75)';
  ctx.lineWidth = Math.max(1, base * 0.14);
  ctx.lineJoin = 'round';
  shapes.forEach((sh) => { path(sh); ctx.fill(); ctx.stroke(); });
  // 가운데 밝은 줄 (입체 광택)
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, base * 0.18);
  segs.forEach((sg) => { ctx.beginPath(); sg.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y - widthAt(p) * 0.12) : ctx.moveTo(p.x, p.y - widthAt(p) * 0.12))); ctx.stroke(); });
  ctx.restore();
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
      const pts = quadPts(a, c, b, easeOut(prog), 48);
      ribbonArrow(ctx, pts, { W, H: ctx.canvas.height, hz: it._hz, col, dash: it.style === 'dash', solid: pts.length > 1 });
      if (prog >= 1 && (it.m != null || it.dist)) {
        const m = it.m != null ? it.m : meters(items, resolve(it.a), resolve(it.b));
        if (m != null) label(ctx, `${+(+m).toFixed(1)}m`, (a.x + b.x) / 2, (a.y + b.y) / 2 - lw * 6, W, col === GLASS ? '#ffffff' : col);
      }
      break;
    }
    case 'spot': {
      // 트래킹 선수 발밑을 따라다니는 원 (나타날 때 커지면서 등장)
      const p = P(it.p);
      const k = easeOut(prog);
      const rx = (it.size || 0.025) * W * 0.85 * k;
      if (rx < 1) break;
      const ry = rx * 0.36;
      ctx.globalAlpha = 0.22;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(2, rx * 0.12);
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = Math.max(1, rx * 0.04);
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rx * 0.84, ry * 0.84, 0, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'poly':
    case 'link': {
      let pts = it.pts.map(P);
      if (pts.length < 2) break;
      const fade = it.k === 'poly' ? easeOut(prog) : 1;
      if (it.k === 'link') pts = partialLine(pts, easeOut(prog));
      ctx.globalAlpha = fade;
      ctx.beginPath();
      if (it.shape === 'circle' && pts.length === 4) {
        const cx = (pts[0].x + pts[2].x) / 2; const cy = (pts[1].y + pts[3].y) / 2;
        ctx.ellipse(cx, cy, Math.max(1, Math.abs(pts[0].x - pts[2].x) / 2), Math.max(1, Math.abs(pts[1].y - pts[3].y) / 2), 0, 0, Math.PI * 2);
      } else if (it.shape === 'circle') smoothClosed(ctx, pts);
      else pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (it.k === 'poly') {
        ctx.closePath();
        ctx.globalAlpha = 0.18 * fade; ctx.fill(); ctx.globalAlpha = fade;
        ctx.fillStyle = hatch(ctx, col, lw * 5);
        ctx.fill();
      }
      ctx.lineWidth = lw * 1.3;
      ctx.stroke();
      ctx.fillStyle = col;
      if (!it.shape) pts.forEach((p) => { ctx.beginPath(); ctx.ellipse(p.x, p.y, lw * 2.6, lw * 1.2, 0, 0, Math.PI * 2); ctx.fill(); });
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
          ctx.globalAlpha = ((i + j) % 2 ? 0.1 : 0.26) * k;
          ctx.beginPath(); q.forEach((p, n) => (n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill();
        }
      }
      // 안쪽 선
      ctx.globalAlpha = 0.75 * k;
      ctx.lineWidth = lw * 0.7;
      ctx.beginPath();
      for (let i = 1; i < it.cols; i++) { const p1 = Q(i / it.cols, 0); const p2 = Q(i / it.cols, 1); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
      for (let j = 1; j < it.rows; j++) { const p1 = Q(0, j / it.rows); const p2 = Q(1, j / it.rows); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
      ctx.stroke();
      // 테두리
      ctx.globalAlpha = k;
      ctx.lineWidth = lw * 1.6;
      ctx.beginPath(); [Q(0, 0), Q(1, 0), Q(1, 1), Q(0, 1)].forEach((p, n) => (n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
      break;
    }
    case 'measure': {
      const a = P(it.a);
      const b = P(it.b);
      ctx.setLineDash([lw * 2, lw * 1.6]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      [a, b].forEach((p) => { ctx.beginPath(); ctx.ellipse(p.x, p.y, lw * 2.4, lw * 1.1, 0, 0, Math.PI * 2); ctx.fill(); });
      break;
    }
    case 'text': {
      const p = P(it.p);
      label(ctx, it.t, p.x, p.y, W, col, true);
      break;
    }
    default:
  }
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

// 거리 측정 라벨은 크로마키 위(가려지지 않게)에 그린다
export function drawMeasureLabel(ctx, it, P, W, items, resolve) {
  if (it.k !== 'measure') return;
  const a = P(it.a);
  const b = P(it.b);
  const m = it.m != null ? +it.m : meters(items, resolve(it.a), resolve(it.b));
  label(ctx, m != null ? `${+m.toFixed(1)}m` : '? m', (a.x + b.x) / 2, (a.y + b.y) / 2 - W / 90, W, it.color || PALETTE[0]);
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
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    if (isGrass(d[p], d[p + 1], d[p + 2], key)) d[p + 3] = 0;
  }
  // 가장자리 부드럽게
  g.putImageData(im, 0, 0);
  return { url: c.toDataURL('image/png'), wN: w / VW, hN: h / VH, footOff: (y0 + h - fy) / VH };
}
