// 경기장 따라가기 — 경기장을 맞춘 장면에서 앞뒤로 영상을 넘기며 잔디 · 선 · 관중석 무늬를 따라가서
// 맞춘 네 점을 카메라가 움직인 만큼 옮김 (선수는 선수대로 · 경기장은 경기장대로)
// 카메라가 돌기만 하면(Veo · 삼각대 패닝 · 줌) 화면 사이는 원근 변환(호모그래피) 하나로 이어짐
// → 화면 곳곳의 무늬 점을 맞춰 보고, 움직이는 선수 · 화면에 붙은 로고는 RANSAC 으로 걸러 냄
import { homography, project } from './telestrator.js';

const AW = 480; // 따라가는 화면 너비 (px)
const PH = 6; // 무늬 조각 반지름 (13×13)
const GX = 12; const GY = 8; // 무늬 점을 고르는 칸

function gray(v, cv) {
  const AH = Math.round((AW * v.videoHeight) / v.videoWidth);
  if (cv.width !== AW || cv.height !== AH) { cv.width = AW; cv.height = AH; }
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(v, 0, 0, AW, AH);
  const d = c.getImageData(0, 0, AW, AH).data;
  const g = new Float32Array(AW * AH);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11;
  return { g, w: AW, h: AH };
}
// 반 크기 (넓게 찾을 때)
function half(im) {
  const w = im.w >> 1; const h = im.h >> 1; const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = 2 * y * im.w + 2 * x; g[y * w + x] = (im.g[i] + im.g[i + 1] + im.g[i + im.w] + im.g[i + im.w + 1]) / 4; }
  return { g, w, h };
}
// 칸마다 무늬가 가장 또렷한 점 (모서리처럼 두 방향으로 다 밝기가 바뀌는 곳)
function corners(im) {
  const { g, w, h } = im; const out = [];
  const score = (cx, cy) => {
    let a = 0; let b = 0; let c = 0;
    for (let y = cy - PH; y <= cy + PH; y += 2) for (let x = cx - PH; x <= cx + PH; x += 2) {
      const i = y * w + x; const gx = g[i + 1] - g[i - 1]; const gy = g[i + w] - g[i - w];
      a += gx * gx; b += gy * gy; c += gx * gy;
    }
    return (a + b) / 2 - Math.sqrt(((a - b) / 2) ** 2 + c * c); // 작은 고윳값
  };
  const m = PH + 30;
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const x0 = m + ((w - 2 * m) * i) / GX; const y0 = m + ((h - 2 * m) * j) / GY;
    const cw = (w - 2 * m) / GX; const ch = (h - 2 * m) / GY;
    let best = null;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const x = Math.round(x0 + (cw * (sx + 0.5)) / 3); const y = Math.round(y0 + (ch * (sy + 0.5)) / 3);
      const s = score(x, y); if (!best || s > best.s) best = { x, y, s };
    }
    if (best && best.s > 4000) out.push(best);
  }
  return out;
}
// a 의 (x,y) 조각을 b 에서 (px,py) 둘레 ±R 안에서 찾기 (밝기 평균을 빼고 비교)
function match(a, b, x, y, px, py, R, ph) {
  const n = (2 * ph + 1) ** 2; let ma = 0;
  for (let dy = -ph; dy <= ph; dy++) for (let dx = -ph; dx <= ph; dx++) ma += a.g[(y + dy) * a.w + x + dx];
  ma /= n;
  let best = null; const costs = new Map();
  for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
    const cx = px + ox; const cy = py + oy;
    if (cx - ph < 1 || cy - ph < 1 || cx + ph >= b.w - 1 || cy + ph >= b.h - 1) continue;
    let mb = 0;
    for (let dy = -ph; dy <= ph; dy += 2) for (let dx = -ph; dx <= ph; dx += 2) mb += b.g[(cy + dy) * b.w + cx + dx];
    mb /= ((ph + 1) ** 2);
    let s = 0;
    for (let dy = -ph; dy <= ph; dy++) { const ra = (y + dy) * a.w + x; const rb = (cy + dy) * b.w + cx; for (let dx = -ph; dx <= ph; dx++) s += Math.abs(a.g[ra + dx] - ma - (b.g[rb + dx] - mb)); }
    costs.set(`${ox},${oy}`, s);
    if (!best || s < best.s) best = { x: cx, y: cy, s, ox, oy };
  }
  if (!best) return null;
  // 반 픽셀까지
  const c0 = best.s; const cl = costs.get(`${best.ox - 1},${best.oy}`); const cr = costs.get(`${best.ox + 1},${best.oy}`); const cu = costs.get(`${best.ox},${best.oy - 1}`); const cd = costs.get(`${best.ox},${best.oy + 1}`);
  const sub = (l, r) => { if (l == null || r == null) return 0; const den = l - 2 * c0 + r; return den > 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den)) : 0; };
  return { x: best.x + sub(cl, cr), y: best.y + sub(cu, cd), s: best.s / n };
}
// 점 짝 여럿 → 원근 변환 (최소제곱, 정규화한 DLT 를 8×8 로)
function fitH(P, Q) {
  const A = Array.from({ length: 8 }, () => new Float64Array(8)); const B = new Float64Array(8);
  for (let i = 0; i < P.length; i++) {
    const { x, y } = P[i]; const { x: u, y: v } = Q[i];
    const r1 = [x, y, 1, 0, 0, 0, -u * x, -u * y]; const r2 = [0, 0, 0, x, y, 1, -v * x, -v * y];
    for (let a = 0; a < 8; a++) { for (let b = 0; b < 8; b++) A[a][b] += r1[a] * r1[b] + r2[a] * r2[b]; B[a] += r1[a] * u + r2[a] * v; }
  }
  const M = A.map((r, i) => [...r, B[i]]);
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < 8; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= 8; k++) M[r][k] -= f * M[c][k]; }
  }
  return [...M.map((r, i) => r[8] / r[i]), 1];
}
// 두 화면 사이 원근 변환 (a 화면 px → b 화면 px) · 못 찾으면 null (장면 전환 · 너무 흐림)
const memo = new WeakMap(); // 기준 화면은 여러 번 쓰니 무늬 점 · 반 크기를 한 번만
const prep = (im) => { let m = memo.get(im); if (!m) { m = { pts: corners(im), h: half(im) }; memo.set(im, m); } return m; };
function stepH(a, b, guess, R2 = 16) {
  const { pts, h: a2 } = prep(a); if (pts.length < 12) return null;
  const b2 = prep(b).h;
  const P = []; const Q = [];
  for (const p of pts) {
    const g0 = guess ? project(guess, p.x, p.y) : p;
    const c = match(a2, b2, p.x >> 1, p.y >> 1, Math.round(g0.x / 2), Math.round(g0.y / 2), R2, 3); if (!c) continue;
    const f = match(a, b, p.x, p.y, Math.round(c.x * 2), Math.round(c.y * 2), 2, PH); if (!f || f.s > 22) continue;
    P.push({ x: p.x, y: p.y }); Q.push({ x: f.x, y: f.y });
  }
  if (P.length < 10) return null;
  // RANSAC: 아무 네 짝으로 변환을 만들어 보고, 가장 많은 짝이 맞는 것 (선수 · 로고는 빠짐)
  let best = null; const N = P.length;
  for (let it = 0; it < 160; it++) {
    const ix = new Set(); while (ix.size < 4) ix.add((Math.random() * N) | 0);
    const s = [...ix]; const H = homography(s.map((i) => P[i]), s.map((i) => Q[i])); if (!H) continue;
    const inl = []; for (let i = 0; i < N; i++) { const r = project(H, P[i].x, P[i].y); if (Math.hypot(r.x - Q[i].x, r.y - Q[i].y) < 1.6) inl.push(i); }
    if (!best || inl.length > best.length) best = inl;
  }
  if (!best || best.length < Math.max(8, N * 0.35)) return null;
  const H = fitH(best.map((i) => P[i]), best.map((i) => Q[i])); if (H) { H.n = N; H.inl = best.length; } return H;
}
const mul = (A, B) => { // A·B (3×3, 행 우선)
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  return r.map((x) => x / r[8]);
};

const inv = (m) => { // 3×3 역행렬
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h; const B = -(d * i - f * g); const C = d * h - e * g;
  const det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return null;
  const r = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((x) => x / det);
  return r.map((x) => x / r[8]);
};
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// 영상 v 에서 t0 장면의 네 점(0~1)을 t1 쪽으로 따라감 → [{ t, q }] (step 초마다 · 못 따라가면 거기까지)
//  seek(t): 그 장면으로 넘기는 함수 · job.cancel 이면 멈춤 · onStep(비율)
//  어긋남이 쌓이지 않게: 바로 앞 화면이 아니라 '기준 화면'(최대 1초 전)과 맞춤 → 기준을 바꿀 때만 조금씩 쌓임
export async function followField(v, seek, q0, t0, t1, job = {}, step = 0.1, onStep) {
  const cv = document.createElement('canvas');
  const dir = t1 >= t0 ? 1 : -1; const n = Math.floor(Math.abs(t1 - t0) / step + 1e-6);
  await seek(t0); let prev = gray(v, cv);
  const W0 = prev.w; const H0 = prev.h;
  let K = prev; let HK = I3; let tK = t0; // 기준 화면 · 처음 화면 → 기준 화면
  let rel = I3; let relPrev = I3; let Hc = I3; // 기준 → 바로 앞 화면 · 처음 → 바로 앞 화면
  const out = [];
  for (let i = 1; i <= n; i++) {
    if (job.cancel) break;
    if (job.yield) await job.yield(); // 다른 계산(AI 선수 추적 · 영상 만들기)이 먼저 — 그동안 잠깐 쉼
    const tt = +(t0 + dir * i * step).toFixed(3);
    await seek(tt); const cur = gray(v, cv);
    const ip = inv(relPrev); const D = ip ? mul(rel, ip) : I3; // 바로 전 걸음만큼 또 움직였다고 보고 찾기
    let H = stepH(K, cur, mul(D, rel)) || stepH(K, cur, mul(D, rel), 28);
    if (!H) { // 기준 화면과 너무 달라졌으면: 바로 앞 화면을 기준으로 → 그래도 안 되면 반 걸음씩
      K = prev; HK = Hc; tK = tt - dir * step; rel = I3;
      H = stepH(K, cur, D, 28);
      if (!H) {
        await seek(tt - (dir * step) / 2); const mid = gray(v, cv);
        const h1 = stepH(K, mid, null, 24); const h2 = h1 && stepH(mid, cur, h1, 24);
        if (!h1 || !h2) break;
        H = mul(h2, h1);
      }
    }
    job.log?.push([tt, H.n, H.inl, +H[2].toFixed(1), +H[5].toFixed(1), +H[0].toFixed(3)]);
    relPrev = rel; rel = H; Hc = mul(rel, HK); prev = cur;
    const q = q0.map((p) => { const r = project(Hc, p.x * W0, p.y * H0); return { x: +(r.x / W0).toFixed(4), y: +(r.y / H0).toFixed(4) }; });
    if (q.some((p) => !Number.isFinite(p.x) || Math.abs(p.x) > 30 || Math.abs(p.y) > 30)) break;
    out.push({ t: tt, q });
    // 기준 화면 바꾸기: 1초 지났거나 맞는 점이 적어졌을 때 (지금 화면을 새 기준으로)
    if (Math.abs(tt - tK) >= 1 - 1e-6 || (H.inl || 99) < Math.max(16, (H.n || 0) * 0.45)) { const ir = inv(rel); K = cur; HK = Hc; tK = tt; relPrev = ir ? mul(relPrev, ir) : I3; rel = I3; }
    onStep?.(i / n);
  }
  return out;
}
