// AI 선수 인식 — TensorFlow.js COCO-SSD (브라우저 안에서 돌아감 · 무료 · 서버 불필요)
// 경기 영상의 선수는 작기 때문에, 화면을 잘게 잘라 확대해서 찾는다.
const TF = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const SSD = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js';
const MODEL_IN = 320; // 잘라낸 조각을 이 크기로 맞춰 모델에 넣음 (모델 내부 입력 300px)

let modelP = null;
export const ai = { status: 'idle' }; // idle · loading · ready · failed

const loadScript = (src) => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
  const s = document.createElement('script');
  s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error('AI 모듈을 불러오지 못했습니다.'));
  document.head.appendChild(s);
});

// 처음 한 번만 받아옴 (이후 브라우저에 저장)
export function loadAI() {
  if (!modelP) {
    ai.status = 'loading';
    modelP = (async () => {
      await loadScript(TF);
      await loadScript(SSD);
      const m = await window.cocoSsd.load({ base: 'mobilenet_v2' });
      ai.status = 'ready';
      return m;
    })().catch((e) => { ai.status = 'failed'; modelP = null; throw e; });
  }
  return modelP;
}

const cv = document.createElement('canvas');
cv.width = cv.height = MODEL_IN;
const cx = cv.getContext('2d', { willReadFrequently: true });

const iou = (a, b) => {
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const i = w * h;
  return i / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i || 1);
};
// 겹친 상자 정리: 많이 겹치면 점수 높은 것만
export function nms(boxes, th = 0.45) {
  const out = [];
  for (const b of [...boxes].sort((p, q) => q.score - p.score)) {
    if (out.every((o) => iou(o, b) < th && !(contains(o, b) && b.score < o.score))) out.push(b);
  }
  return out;
}
const contains = (o, b) => b.x0 >= o.x0 - 2 && b.x1 <= o.x1 + 2 && b.y0 >= o.y0 - 2 && b.y1 <= o.y1 + 2;

// 영상의 한 영역(영상 픽셀)을 잘라 확대해서 사람 찾기 → 영상 픽셀 좌표의 상자들
// 영역을 그리는 순간의 프레임을 쓰므로, 결과가 늦게 와도 '그 순간' 기준
export async function detectIn(video, r, minScore = 0.3) {
  const model = await loadAI();
  const VW = video.videoWidth; const VH = video.videoHeight;
  const x = Math.max(0, Math.min(VW - 4, r.x)); const y = Math.max(0, Math.min(VH - 4, r.y));
  const w = Math.max(4, Math.min(VW - x, r.w)); const h = Math.max(4, Math.min(VH - y, r.h));
  const s = MODEL_IN / Math.max(w, h);
  cx.fillStyle = '#000';
  cx.fillRect(0, 0, MODEL_IN, MODEL_IN);
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(video, x, y, w, h, 0, 0, w * s, h * s);
  const res = await model.detect(cv, 30, minScore);
  return res.filter((d) => d.class === 'person').map((d) => {
    const [bx, by, bw, bh] = d.bbox;
    return { x0: x + bx / s, y0: y + by / s, x1: x + (bx + bw) / s, y1: y + (by + bh) / s, score: d.score };
  }).filter((b) => b.x1 - b.x0 > 2 && b.y1 - b.y0 > 4 && (b.y1 - b.y0) > (b.x1 - b.x0) * 0.6); // 서 있는 사람 모양만
}

// 한 점 주변(선수 키 ph 기준)에서 찾기 — 트래킹 시작 · 보정용
export function detectAround(video, x, y, ph) {
  const VH = video.videoHeight;
  const side = Math.max(Math.min(VH * 0.5, ph * 4.2), Math.min(VH * 0.18, 260));
  return detectIn(video, { x: x - side / 2, y: y - ph * 0.5 - side / 2, w: side, h: side });
}

// 화면 전체를 겹치게 나눠 훑기 — '다시 잡기'에서 모든 선수 후보 보여주기
// 1차: 화면 전체를 큰 조각으로 / 2차: 멀리 있는(작게 보이는) 선수가 있는 위쪽 띠를 작은 조각으로 더 확대해서
export async function scanFrame(video, region = null, onProgress = () => {}) {
  const VW = video.videoWidth; const VH = video.videoHeight;
  const R = region || { x: 0, y: 0, w: VW, h: VH };
  // 영상을 한 번 복사해 두고(같은 순간) 그 위에서 조각내기
  const snap = document.createElement('canvas');
  snap.width = VW; snap.height = VH;
  snap.getContext('2d').drawImage(video, 0, 0, VW, VH);
  const src = snapProxy({ videoWidth: VW, videoHeight: VH, __img: snap });
  const tiles = (r, tile) => {
    tile = Math.min(tile, r.w, r.h);
    const stepT = Math.round(tile * 0.7);
    const xs = []; const ys = [];
    for (let x = r.x; ; x += stepT) { xs.push(Math.min(x, r.x + r.w - tile)); if (x + tile >= r.x + r.w) break; }
    for (let y = r.y; ; y += stepT) { ys.push(Math.min(y, r.y + r.h - tile)); if (y + tile >= r.y + r.h) break; }
    return ys.flatMap((y) => xs.map((x) => ({ x: Math.max(0, x), y: Math.max(0, y), w: tile, h: tile })));
  };
  const far = { x: R.x, y: Math.max(R.y, R.y + R.h * 0.22), w: R.w, h: Math.min(R.h * 0.42, R.h) };
  const jobs = [...tiles(R, Math.max(240, Math.round(VH / 3.2))), ...(region ? [] : tiles(far, Math.max(150, Math.round(VH / 5))))];
  const all = [];
  for (let i = 0; i < jobs.length; i++) {
    all.push(...await detectIn(src, jobs[i], 0.35));
    onProgress((i + 1) / jobs.length);
  }
  return nms(all);
}
// drawImage 가 캔버스를 받도록: videoWidth/Height 를 가진 캔버스
function snapProxy(src) {
  const c = src.__img;
  c.videoWidth = src.videoWidth; c.videoHeight = src.videoHeight;
  return c;
}

// 후보들 중 이 선수에 가장 맞는 상자: 예상 발 위치와 가깝고, 키가 비슷하고, 점수 높은 것
export function pickNear(boxes, x, y, ph, maxDist = 1.2) {
  let best = null; let bs = -Infinity;
  for (const b of boxes) {
    const fx = (b.x0 + b.x1) / 2; const fy = b.y1; const bh = b.y1 - b.y0;
    const d = Math.hypot(fx - x, fy - y) / Math.max(8, ph);
    if (d > maxDist) continue;
    const size = Math.abs(Math.log(Math.max(4, bh) / Math.max(4, ph)));
    const s = b.score - d * 0.55 - size * 0.6;
    if (s > bs) { bs = s; best = b; }
  }
  return best;
}
