// AI 선수 인식 (YOLOX · Apache-2.0) — 브라우저 안에서 돌아감 · 무료 · 서버 불필요
// 작고 흐린 선수(유소년 경기 · 멀리서 찍은 영상)를 COCO-SSD 보다 훨씬 잘 찾는다.
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js';
let sessP = null;
let MODEL = '/models/yolox_tiny.onnx';
export const setYoloxModel = (u) => { MODEL = u; sessP = null; };
const SIZE = 416;

const loadScript = (src) => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) { if (window.ort) res(); else document.querySelector(`script[src="${src}"]`).addEventListener('load', res); return; }
  const s = document.createElement('script');
  s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error('AI 모듈을 불러오지 못했습니다.'));
  document.head.appendChild(s);
});

export function loadYolox() {
  if (!sessP) {
    sessP = (async () => {
      await loadScript(ORT);
      const ort = window.ort;
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
      ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
      return ort.InferenceSession.create(MODEL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    })().catch((e) => { sessP = null; throw e; });
  }
  return sessP;
}

// 격자 (출력 → 화면 좌표)
let GRID = null;
function grid() {
  if (GRID) return GRID;
  const g = [];
  for (const st of [8, 16, 32]) { const n = SIZE / st; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g.push(x, y, st); }
  GRID = Int32Array.from(g);
  return GRID;
}

const cv = document.createElement('canvas');
cv.width = cv.height = SIZE;
const cx = cv.getContext('2d', { willReadFrequently: true });
const buf = new Float32Array(3 * SIZE * SIZE);

// 영상(또는 캔버스)의 한 영역 r(영상 픽셀)에서 사람 찾기 → 영상 픽셀 상자들 {x0,y0,x1,y1,score}
// 한 번에 하나씩 (뒤에서 도는 추적과 화면에서 누른 '잡기'가 겹쳐도 AI가 엉키지 않게)
let lock = Promise.resolve();
export function yoloxIn(src, r, minScore = 0.25) {
  const run = lock.then(() => yoloxOnce(src, r, minScore));
  lock = run.catch(() => {});
  return run;
}
async function yoloxOnce(src, r, minScore) {
  const sess = await loadYolox();
  const VW = src.videoWidth || src.width; const VH = src.videoHeight || src.height;
  const x = Math.max(0, Math.min(VW - 4, r.x)); const y = Math.max(0, Math.min(VH - 4, r.y));
  const w = Math.max(4, Math.min(VW - x, r.w)); const h = Math.max(4, Math.min(VH - y, r.h));
  const s = SIZE / Math.max(w, h);
  cx.fillStyle = 'rgb(114,114,114)';
  cx.fillRect(0, 0, SIZE, SIZE);
  cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
  cx.drawImage(src, x, y, w, h, 0, 0, w * s, h * s);
  const d = cx.getImageData(0, 0, SIZE, SIZE).data;
  const N = SIZE * SIZE;
  for (let i = 0, p = 0; i < N; i++, p += 4) { buf[i] = d[p + 2]; buf[N + i] = d[p + 1]; buf[2 * N + i] = d[p]; } // BGR · 0~255
  const ort = window.ort;
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', buf, [1, 3, SIZE, SIZE]) });
  const o = out[sess.outputNames[0]].data; // [1, A, 85]
  const g = grid(); const A = g.length / 3; const C = o.length / A;
  const boxes = [];
  for (let a = 0; a < A; a++) {
    const q = a * C;
    const sc = o[q + 4] * o[q + 5]; // 사람(0번) 점수
    if (sc < minScore) continue;
    const st = g[a * 3 + 2];
    const bx = (o[q] + g[a * 3]) * st; const by = (o[q + 1] + g[a * 3 + 1]) * st;
    const bw = Math.exp(o[q + 2]) * st; const bh = Math.exp(o[q + 3]) * st;
    const b = { x0: x + (bx - bw / 2) / s, y0: y + (by - bh / 2) / s, x1: x + (bx + bw / 2) / s, y1: y + (by + bh / 2) / s, score: sc };
    // 잘라낸 영역 밖(회색 여백)으로 나간 것 · 너무 작은 것 · 누운 모양은 버림
    if (b.x1 - b.x0 < 2 || b.y1 - b.y0 < 4 || (b.y1 - b.y0) < (b.x1 - b.x0) * 0.6) continue;
    boxes.push(b);
  }
  return nmsY(boxes);
}

const iou = (a, b) => {
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const i = w * h;
  return i / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i || 1);
};
// 겹친 상자 정리 — 같은 사람의 윗몸만 따로 잡힌 작은 상자(안에 들어간 것)도 지움
function nmsY(boxes, th = 0.45) {
  const out = [];
  for (const b of boxes.sort((p, q) => q.score - p.score)) {
    if (out.every((o) => iou(o, b) < th && !inside(b, o))) out.push(b);
  }
  return out;
}
const inside = (b, o) => {
  const w = Math.max(0, Math.min(o.x1, b.x1) - Math.max(o.x0, b.x0));
  const h = Math.max(0, Math.min(o.y1, b.y1) - Math.max(o.y0, b.y0));
  // 큰 상자 위쪽에 들어간 작은 상자 = 같은 사람의 윗몸 (겹쳐 선 다른 선수는 발 높이가 달라 남김)
  return w * h > (b.x1 - b.x0) * (b.y1 - b.y0) * 0.8 && b.y1 < o.y1 - (o.y1 - o.y0) * 0.25;
};
