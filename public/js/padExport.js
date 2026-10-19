// 작전판 → 이미지(PNG) · 영상(mp4 / webm) 내보내기
// 화면에 안 보이는 읽기 전용 작전판을 하나 만들어 그 그림을 캔버스에 옮겨 그림
import { createPad, isVertical } from './tactic.js';

const FONT = "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif";
const fileName = (s) => (String(s || '').trim() || '작전판').replace(/[\\/:*?"<>|]/g, '').slice(0, 60);

function offscreenPad(data) {
  const box = document.createElement('div');
  box.className = 'pad-export-host';
  box.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;pointer-events:none;opacity:0;';
  document.body.appendChild(box);
  const pad = createPad(box, data, { editable: false, play: false });
  return { pad, done: () => box.remove() };
}

// 로고 (svg 안에 넣으려면 data: 주소여야 함)
let markP = null;
const markData = () => (markP ||= fetch('icons/logo-mark.png').then((r) => r.blob()).then((b) => new Promise((res) => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); })).catch(() => ''));

// 싸카매니저 표시: 경기장 하프라인 원 안(없으면 가운데)에 흐린 로고 · 왼쪽 아래 TACTICAL PAD · 오른쪽 아래 SSAKA MANAGER
function watermark(c, data, mark) {
  const NS = 'http://www.w3.org/2000/svg';
  const f = data.field || {}; const w = +f.w || 105; const h = +f.h || 68;
  const vertical = f.orient ? f.orient === 'v' : isVertical(f.type);
  const [RW, RH] = vertical ? [h, w] : [w, h]; // 화면에 보이는 경기장 크기
  const mk = (tag, at, parent) => { const e = document.createElementNS(NS, tag); Object.entries(at).forEach(([k, v]) => e.setAttribute(k, v)); parent.appendChild(e); return e; };
  if (mark) {
    // 하프라인 원 안: 풀코트만 (반 코트 · 박스 · 그리드 훈련장은 가운데)
    const k = Math.min(w / 105, h / 68);
    // 다른 경기장 · 그리드도 하프라인 원 안 로고와 비슷한 크기 (짧은 쪽의 약 21%)
    const lw = f.type === 'full' ? 9.15 * k * 1.55 : Math.min(RW, RH) * 0.21;
    const lh = lw * (287 / 400);
    const world = c.querySelector('g[id$="-w"]');
    // 선수 · 그림 밑에 깔리게 경기장 선 바로 다음에 (세로 보기면 똑바로 서게 되돌려서)
    const host = world || c;
    const g = document.createElementNS(NS, 'g');
    if (world && vertical) g.setAttribute('transform', `matrix(0 1 -1 0 ${w} 0)`);
    host.insertBefore(g, world ? world.children[1] || null : null);
    mk('image', { href: mark, x: RW / 2 - lw / 2, y: RH / 2 - lh / 2, width: lw, height: lh, opacity: 0.13, preserveAspectRatio: 'xMidYMid meet' }, g);
  }
  // 글자: 경기장(그리드) 선 바깥, 아래 선 밑에 — 왼쪽 끝 TACTICAL PAD · 오른쪽 끝 SSAKA MANAGER
  const fs = Math.max(0.45, Math.min(RW, RH) * 0.022);
  const txt = (t, x, anchor) => { const e = mk('text', { x, y: RH + fs * 1.45, 'text-anchor': anchor, 'font-size': fs, 'font-weight': 900, 'letter-spacing': fs * 0.28, fill: '#ffffff', 'fill-opacity': 0.4 }, c); e.textContent = t; };
  txt('TACTICAL PAD', 0, 'start');
  txt('SSAKA MANAGER', RW, 'end');
  return RH + fs * 2.1; // 글자가 들어갈 아래 끝
}

// 지금 그려진 svg 한 장 → 이미지
function svgImage(svg, data, mark) {
  const vb = (svg.getAttribute('viewBox') || '0 0 100 60').split(/\s+/).map(Number);
  const c = svg.cloneNode(true);
  c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  c.removeAttribute('style'); c.removeAttribute('class');
  const NS = 'http://www.w3.org/2000/svg';
  if (data) { const bottom = watermark(c, data, mark); if (bottom > vb[1] + vb[3]) vb[3] = bottom - vb[1]; } // 글자 자리만큼 아래를 늘림
  c.setAttribute('viewBox', vb.join(' '));
  c.setAttribute('width', vb[2]); c.setAttribute('height', vb[3]);
  const bg = document.createElementNS(NS, 'rect');
  ['x', 'y', 'width', 'height'].forEach((k, i) => bg.setAttribute(k, vb[i]));
  bg.setAttribute('fill', svg.style.background || '#1b1d1f');
  const st = document.createElementNS(NS, 'style');
  st.textContent = `text{font-family:${FONT}}`;
  c.prepend(bg); c.prepend(st);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(c))}`;
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res({ img, ratio: vb[3] / vb[2] }); img.onerror = rej; img.src = url; });
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// 이미지: 장면이 여러 개면 한 장에 장면 1 · 2 · 3 … 차례로 (2칸씩)
export async function savePadImage(data, title) {
  const { pad, done } = offscreenPad(data);
  try {
    const mark = await markData();
    const n = pad.scenes();
    const shots = [];
    for (let k = 0; k < n; k++) { pad.setScene(k); shots.push(await svgImage(pad.svgEl(), data, mark)); }
    const cols = n > 1 ? 2 : 1;
    const cw = n > 1 ? 1000 : 1600; const chh = Math.round(cw * shots[0].ratio);
    const lab = n > 1 ? 52 : 0; const gap = n > 1 ? 16 : 0;
    const rows = Math.ceil(n / cols);
    const W = cols * cw + (cols + 1) * gap; const H = rows * (chh + lab) + (rows + 1) * gap;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0b0c0d'; ctx.fillRect(0, 0, W, H);
    shots.forEach((s, i) => {
      const x = gap + (i % cols) * (cw + gap); const y = gap + Math.floor(i / cols) * (chh + lab + gap);
      if (lab) { ctx.fillStyle = '#39e75f'; ctx.font = `700 26px ${FONT}`; ctx.textBaseline = 'middle'; ctx.fillText(`장면 ${i + 1}`, x + 4, y + lab / 2); }
      ctx.drawImage(s.img, x, y + lab, cw, chh);
    });
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    download(blob, `${fileName(title)}.png`);
  } finally { done(); }
}

export const canVideo = () => typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;

// 영상: 장면 1 → 끝까지 움직임을 실제 속도로 녹화 (앞 0.8초 · 끝 1.5초 멈춤)
export async function savePadVideo(data, title, onProg = () => {}) {
  const { pad, done } = offscreenPad(data);
  try {
    const plan = pad.motionPlan();
    if (!plan) throw new Error('움직임(장면 2 이상 · 화살표)이 있어야 영상으로 저장할 수 있어요.');
    plan.at(0);
    const mark = await markData();
    const first = await svgImage(pad.svgEl(), data, mark);
    const W = 1280; const H = Math.round((W * first.ratio) / 2) * 2;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const draw = (img) => { ctx.fillStyle = '#0b0c0d'; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H); };
    draw(first.img);
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const type = types.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const rec = new MediaRecorder(c.captureStream(30), { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 6e6 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.start(250);
    const PRE = 800; const POST = 1500; const total = PRE + plan.total + POST;
    const t0 = performance.now();
    for (;;) {
      const t = performance.now() - t0;
      if (t >= total) break;
      plan.at(t - PRE);
      draw((await svgImage(pad.svgEl(), data, mark)).img);
      onProg(Math.min(1, t / total));
      await new Promise((r) => requestAnimationFrame(r));
    }
    rec.stop(); await stopped; plan.end();
    const mime = rec.mimeType || type || 'video/webm';
    download(new Blob(chunks, { type: mime }), `${fileName(title)}.${mime.includes('mp4') ? 'mp4' : 'webm'}`);
  } finally { done(); }
}
