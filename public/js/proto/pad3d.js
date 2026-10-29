// 작전판 3D 보기 (시제품) — three.js(MIT)로 경기장 · 관중석 · 골대 · 선수 말 · 공 · 기구를 입체로 그림
// 편집은 위에 투명하게 겹친 원래 SVG가 그대로 받음 (CSS 기울기와 같은 카메라라서 누른 자리가 맞음)
// 경기장: 결 있는 잔디 + 경기장을 빙 둘러싼 둥근 관중석(계단 · 통로 · 지붕) — 화면 끝까지 채움
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
let THREEP = null;
const loadThree = () => (THREEP ||= import(THREE_URL));

const BRAND = 'SSAKA MANAGER';
const rnd = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// 관중석 윗면: 어두운 좌석 위 촘촘한 관중 (여러 색 옷 · 머리)
function crowdTexture(T) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'); const R = rnd(7);
  g.fillStyle = '#25282e'; g.fillRect(0, 0, 512, 512);
  const cols = ['#e9e6df', '#c8c2b6', '#1d1f24', '#3a3f4b', '#b8232c', '#2d5bb8', '#d9b43a', '#5d6470', '#7a2a2a', '#f2f2f2', '#2b2b2b', '#8a8f99'];
  for (let y = 2; y < 512; y += 7) for (let x = 1; x < 512; x += 5) {
    if (R() < 0.18) continue;
    g.fillStyle = cols[Math.floor(R() * cols.length)];
    const dx = (R() - 0.5) * 1.6; const dy = (R() - 0.5) * 1.6;
    g.fillRect(x + dx, y + dy, 3.4, 3.8);
    if (R() < 0.6) { g.fillStyle = R() < 0.5 ? '#2a1c14' : '#5a3a22'; g.fillRect(x + dx + 0.6, y + dy - 1.4, 2.2, 1.6); }
  }
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return t;
}
function boardTexture(T) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#1546b8' : '#ffffff'; g.fillRect(i * 256, 0, 256, 64);
    g.fillStyle = i % 2 ? '#ffffff' : '#1546b8'; g.font = '800 24px Pretendard, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(BRAND, i * 256 + 128, 33);
  }
  const t = new T.CanvasTexture(c); t.wrapS = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return t;
}
// 번호판: 원판 윗면(disc) · 유니폼 위 번호(shirt)
const texCache = new Map();
// 축구공 무늬 (한 번만 만들어 씀): 실제 공처럼 오각형 12개(검정) + 육각형 20개(흰색) · 칸 경계에 이음선
// 칸 = 정이십면체 꼭짓점 12곳(오각형) + 면 가운데 20곳(육각형) 중 가장 가까운 곳 (깎은 정이십면체와 같은 모양)
let ballTex = null;
function ballTexture(T) {
  if (ballTex) return ballTex;
  const W = 512; const H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); const img = g.createImageData(W, H);
  const f = (1 + Math.sqrt(5)) / 2;
  const nz = ([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
  const dot = (a, b2) => a[0] * b2[0] + a[1] * b2[1] + a[2] * b2[2];
  const V = [[0, 1, f], [0, -1, f], [0, 1, -f], [0, -1, -f], [1, f, 0], [-1, f, 0], [1, -f, 0], [-1, -f, 0], [f, 0, 1], [-f, 0, 1], [f, 0, -1], [-f, 0, -1]].map(nz);
  const F = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) {
    if (dot(V[i], V[j]) > 0.4 && dot(V[i], V[k]) > 0.4 && dot(V[j], V[k]) > 0.4) F.push(nz([V[i][0] + V[j][0] + V[k][0], V[i][1] + V[j][1] + V[k][1], V[i][2] + V[j][2] + V[k][2]]));
  }
  const C = [...V.map((v) => [v, 1]), ...F.map((v) => [v, 0])]; // [방향, 오각형?]
  for (let y = 0; y < H; y++) {
    const th = ((y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const ph = ((x + 0.5) / W) * Math.PI * 2;
      const d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      let b1 = -2; let b2 = -2; let pent = 0;
      for (const [v, isP] of C) { const t = dot(v, d); if (t > b1) { b2 = b1; b1 = t; pent = isP; } else if (t > b2) b2 = t; }
      const seam = b1 - b2 < 0.012;
      const col = seam ? 70 : pent ? 18 : 248;
      const o = (y * W + x) * 4;
      img.data[o] = col; img.data[o + 1] = col; img.data[o + 2] = col; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  ballTex = new T.CanvasTexture(c); ballTex.colorSpace = T.SRGBColorSpace; ballTex.anisotropy = 8;
  return ballTex;
}

function numTexture(T, kind, n, fill, ink, sp, pc2) {
  const pat = kind === 'disc' && (sp === 'h' || sp === 'v') && pc2;
  const k = `${kind}|${n}|${fill}|${ink}|${pat ? sp + pc2 : ''}`;
  if (texCache.has(k)) return texCache.get(k);
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'); g.scale(4, 4);
  const s = String(n ?? '');
  if (kind === 'num') { g.fillStyle = fill; g.fillRect(0, 0, 128, 128); g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 120); }
  if (kind === 'disc') {
    const gr = g.createRadialGradient(52, 46, 6, 64, 64, 64); gr.addColorStop(0, shade(fill, 0.18)); gr.addColorStop(1, fill);
    g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 63, 0, Math.PI * 2); g.fill();
    if (pat) { // 두 번째 색: 가로(아래 반) · 세로(가운데 줄)
      g.save(); g.beginPath(); g.arc(64, 64, 63, 0, Math.PI * 2); g.clip(); g.fillStyle = pc2;
      if (sp === 'h') g.fillRect(0, 64, 128, 64); else g.fillRect(64 - 21, 0, 42, 128);
      g.restore();
      const light = sp === 'v' ? lum(pc2) > 0.42 : lum(fill) > 0.42; ink = light ? '#000000' : '#ffffff';
    }
    g.strokeStyle = lum(fill) > 0.7 ? 'rgba(20,24,30,.85)' : 'rgba(255,255,255,.95)'; g.lineWidth = 9; g.beginPath(); g.arc(64, 64, 55, 0, Math.PI * 2); g.stroke();
  }
  g.font = `900 ${kind === 'shirt' ? (s.length > 2 ? 54 : 74) : s.length > 2 ? 46 : 64}px Pretendard, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (kind === 'shirt' || pat) { g.lineWidth = 9; g.lineJoin = 'round'; g.strokeStyle = lum(ink) > 0.5 ? 'rgba(0,0,0,.8)' : 'rgba(255,255,255,.85)'; g.strokeText(s, 64, 70); } // 무늬 위에서도 번호가 보이게
  g.fillStyle = ink; g.fillText(s, 64, 70);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 16;
  if (kind === 'disc') { t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; } // 원판 윗면 방향에 맞춤
  texCache.set(k, t); return t;
}
function lum(c) { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim()); if (!m) return 0.5; const v = parseInt(m[1], 16); return (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255; }
function shade(c, a) { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim()); if (!m) return c; const v = parseInt(m[1], 16); const f = (x) => Math.round(x + (255 - x) * a); return `rgb(${f(v >> 16)},${f((v >> 8) & 255)},${f(v & 255)})`; }

// 잔디: 결(가로 · 세로 깎은 줄) + 잔 무늬 + 선 밖은 조금 어둡게
function paintGrass(g, Wc, Hc, w, h, R) {
  const sx = Wc / (w + 2 * R);
  g.fillStyle = '#3d7b34'; g.fillRect(0, 0, Wc, Hc);
  const n = Math.max(8, Math.round(w / 7)); const bw = w / n;
  for (let i = -4; i < n + 4; i++) { g.fillStyle = i % 2 ? 'rgba(0,0,0,.075)' : 'rgba(255,255,255,.055)'; g.fillRect((R + i * bw) * sx, 0, bw * sx + 1, Hc); }
  const m = Math.max(5, Math.round(h / 8)); const bh = h / m;
  for (let j = -4; j < m + 4; j++) if (j % 2) { g.fillStyle = 'rgba(0,0,0,.035)'; g.fillRect(0, (R + j * bh) * sx, Wc, bh * sx + 1); }
  const id = g.getImageData(0, 0, Wc, Hc); const d = id.data; const Rn = rnd(99);
  for (let i = 0; i < d.length; i += 4) { const v = (Rn() - 0.5) * 22; d[i] += v * 0.55; d[i + 1] += v; d[i + 2] += v * 0.4; }
  g.putImageData(id, 0, 0);
  // 선 밖 · 가장자리 그늘
  g.fillStyle = 'rgba(10,30,10,.16)';
  g.fillRect(0, 0, Wc, R * sx * 0.7); g.fillRect(0, Hc - R * sx * 0.7, Wc, R * sx * 0.7); g.fillRect(0, 0, R * sx * 0.7, Hc); g.fillRect(Wc - R * sx * 0.7, 0, R * sx * 0.7, Hc);
  const vg = g.createRadialGradient(Wc / 2, Hc / 2, Math.min(Wc, Hc) * 0.3, Wc / 2, Hc / 2, Math.max(Wc, Hc) * 0.75);
  vg.addColorStop(0, 'rgba(255,255,230,.05)'); vg.addColorStop(1, 'rgba(0,0,0,.18)'); g.fillStyle = vg; g.fillRect(0, 0, Wc, Hc);
}

export function createPad3D(container) {
  let T = null; let renderer = null; let scene = null; let camera = null; let root = null; let dyn = null;
  let stage = null; let groundTex = null; let groundMat = null; let ready = false; let failed = false; let pending = null;
  const canvas = document.createElement('canvas'); canvas.className = 'pad-3dgl';
  container.appendChild(canvas);
  const groundCanvas = document.createElement('canvas');
  let lastStage = ''; let lastGround = ''; let fieldMark = null; let logoImg = null; let expR = null; let expC = null; let crowd = null; let boards = null; // expR · expC: 저장 전용 그림판 · 카메라

  async function init() {
    try {
      T = await loadThree();
      renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
      renderer.setClearColor(0x0b0d10, 1);
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
      scene = new T.Scene();
      camera = new T.PerspectiveCamera(40, 1, 1, 100000);
      scene.add(new T.HemisphereLight(0xf2f6ff, 0x26331f, 1.0));
      const sun = new T.DirectionalLight(0xfff6e8, 1.6); sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
      scene.add(sun); scene.add(sun.target); scene.userData.sun = sun;
      root = new T.Group(); scene.add(root);
      crowd = crowdTexture(T); boards = boardTexture(T);
      ready = true;
      if (pending) update(pending);
    } catch (e) { failed = true; window.__p3dInitErr = String(e?.stack || e); container.classList.remove('pad-3dgl-on'); console.warn('중계 화면을 열지 못했어요', e); }
  }
  init();

  const shared = new Set();
  const disposeTree = (o) => { o.traverse((x) => { x.geometry?.dispose?.(); if (x.material) [].concat(x.material).forEach((m) => { if (m.map && !shared.has(m.map) && m.map !== groundTex && m.map !== ballTex) m.map.dispose?.(); if (!shared.has(m)) m.dispose?.(); }); }); };

  function update(st) { try { update0(st); } catch (e) { window.__p3dErr = String(e.stack || e); console.warn(e); } }
  // st: { W, H, left, top, CW, CH, ox, oy, tx, ty, P, k, tilt, A:[a,b,c,d,e,f] (미터 → 요소 px), fw, fh, R, lineSvg, goals, items }
  function update0(st) {
    if (failed) return;
    if (!ready) { pending = st; return; }
    pending = null; container.classList.add('pad-3dgl-on');
    const { ox, oy, P, tilt, k, A } = st;
    // 캔버스 = 작전판 전체 · 카메라 중심 = 기울이는 중심 + 옮김 (작전판 안 좌표)
    const CW = Math.max(1, st.CW); const CH = Math.max(1, st.CH);
    canvas.style.width = `${CW}px`; canvas.style.height = `${CH}px`; canvas.style.left = '0px'; canvas.style.top = '0px';
    renderer.setSize(CW, CH, false);
    const pcx = st.left + ox + st.tx; const pcy = st.top + oy + st.ty;
    const fw = 2 * Math.max(pcx, CW - pcx, 1); const fh = 2 * Math.max(pcy, CH - pcy, 1);
    camera.fov = (2 * Math.atan(fh / 2 / P) * 180) / Math.PI;
    camera.setViewOffset(fw, fh, fw / 2 - pcx, fh / 2 - pcy, CW, CH);
    camera.position.set(0, 0, P); camera.zoom = k; camera.near = P * 0.2; camera.far = P * 8; camera.updateProjectionMatrix();
    root.rotation.set(-tilt, 0, 0);
    const S = Math.hypot(A[0], A[1]) || 1; // 1m = S px
    const M = (mx, my, z = 0) => new T.Vector3(A[0] * mx + A[2] * my + A[4] - ox, -(A[1] * mx + A[3] * my + A[5] - oy), z);
    const { fw: w, fh: h, R } = st;
    const corners = [M(-R, -R), M(w + R, -R), M(w + R, h + R), M(-R, h + R)];
    fieldMark = { c: M(w / 2, h / 2), a: M(0, h / 2), b: M(w, h / 2), p: M(w / 2, 0), q: M(w / 2, h), k: [M(0, 0), M(w, 0), M(0, h), M(w, h)] }; // 저장 이미지 워터마크 자리
    const G = { x0: Math.min(...corners.map((p) => p.x)), x1: Math.max(...corners.map((p) => p.x)), y0: Math.min(...corners.map((p) => p.y)), y1: Math.max(...corners.map((p) => p.y)) };
    const big = Math.max(G.x1 - G.x0, G.y1 - G.y0);

    // ── 잔디 그림 (경기장 크기 · 선이 바뀔 때만) ──
    const gk = `${w}|${h}|${R}|${st.lineSvg}`;
    if (gk !== lastGround) {
      lastGround = gk;
      const Wc = 2048; const Hc = Math.round((Wc * (h + 2 * R)) / (w + 2 * R));
      groundCanvas.width = Wc; groundCanvas.height = Hc;
      const g = groundCanvas.getContext('2d');
      paintGrass(g, Wc, Hc, w, h, R);
      groundTex?.dispose(); groundTex = new T.CanvasTexture(groundCanvas); groundTex.colorSpace = T.SRGBColorSpace; groundTex.anisotropy = 16;
      if (groundMat) { groundMat.map = groundTex; groundMat.needsUpdate = true; }
      const img = new Image();
      img.onload = () => { if (lastGround !== gk) return; g.drawImage(img, 0, 0, Wc, Hc); groundTex.needsUpdate = true; draw(); };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(st.lineSvg)}`;
    }

    // ── 고정 무대 (경기장 자리가 바뀔 때만 다시) ──
    const sk = [ox, oy, ...A.map((v) => v.toFixed(3)), w, h, R, JSON.stringify(st.goals || [])].join('|');
    if (sk !== lastStage) {
      lastStage = sk;
      if (stage) { root.remove(stage); disposeTree(stage); }
      stage = new T.Group(); root.add(stage);
      const cx = (G.x0 + G.x1) / 2; const cy = (G.y0 + G.y1) / 2;
      const sun = scene.userData.sun; sun.position.set(cx - big * 0.45, cy + big * 0.6, big * 1.8); sun.target.position.set(cx, cy, 0);
      Object.assign(sun.shadow.camera, { left: -big * 1.2, right: big * 1.2, top: big * 1.2, bottom: -big * 1.2, near: 1, far: big * 6 }); sun.shadow.camera.updateProjectionMatrix();
      // 잔디 판 (미터 → 3D 네 귀퉁이)
      const gg = new T.BufferGeometry();
      gg.setAttribute('position', new T.Float32BufferAttribute(corners.flatMap((p) => [p.x, p.y, 0]), 3));
      gg.setAttribute('uv', new T.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
      gg.setIndex([0, 1, 2, 0, 2, 3]); gg.computeVertexNormals();
      groundMat = new T.MeshStandardMaterial({ map: groundTex, roughness: 0.92, side: T.DoubleSide });
      const grass = new T.Mesh(gg, groundMat); grass.receiveShadow = true; stage.add(grass);
      // 잔디 밖 둘레 (어두운 잔디 · 둥근 모서리까지)
      const track = big * 0.025; const rad0 = big * 0.06;
      const B = { x0: G.x0 - track, x1: G.x1 + track, y0: G.y0 - track, y1: G.y1 + track };
      const apron = new T.Mesh(new T.PlaneGeometry((B.x1 - B.x0) + big * 3, (B.y1 - B.y0) + big * 3), new T.MeshStandardMaterial({ color: 0x0b0d10, roughness: 1 }));
      apron.position.set(cx, cy, -0.6); apron.receiveShadow = true; stage.add(apron);
      { const tg = new T.Shape(); const pad = track + big * 0.004; tg.moveTo(G.x0 - pad, G.y0 - pad); tg.lineTo(G.x1 + pad, G.y0 - pad); tg.lineTo(G.x1 + pad, G.y1 + pad); tg.lineTo(G.x0 - pad, G.y1 + pad);
        const tm = new T.Mesh(new T.ShapeGeometry(tg), new T.MeshStandardMaterial({ color: 0x1f4a24, roughness: 1 })); tm.position.z = -0.3; tm.receiveShadow = true; stage.add(tm); } // 잔디 둘레 띠
      // 광고판 (네 변)
      const bh = Math.max(3, 0.9 * S); const gap = track * 0.45;
      [[G.x1 - G.x0, cx, G.y1 + gap, 0], [G.x1 - G.x0, cx, G.y0 - gap, 0], [G.y1 - G.y0, G.x0 - gap, cy, Math.PI / 2], [G.y1 - G.y0, G.x1 + gap, cy, Math.PI / 2]].forEach(([len, x, y, rz]) => {
        const tex = boards.clone(); tex.needsUpdate = true; tex.repeat.set(Math.max(1, len / (bh * 20)), 1);
        const face = new T.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0x111111 }); const dark = new T.MeshStandardMaterial({ color: 0x0c1016 });
        const m = new T.Mesh(new T.BoxGeometry(len * 0.92, bh * 0.12, bh), [dark, dark, face, face, dark, dark]);
        m.position.set(x, y, bh / 2); m.rotation.z = rz; m.castShadow = true; stage.add(m);
      });
      // 둥근 관중석: 경기장을 빙 두른 계단 고리 여러 줄 + 가운데 통로 + 지붕
      // 관중석 폭 = 화면 둘레 여유(mg)만큼 → 네 면이 같은 폭 · 그 밖은 어두운 바깥
      // 관중석은 화면 끝까지 채움 (경기장을 크게 맞추고 남는 곳은 모두 관중석)
      const N = 22; const depth = big * 0.8; const rowD = depth / (N + 2); const rise = rowD * 0.42;
      const rrect = (o, holeOf) => {
        const x0 = B.x0 - o; const x1 = B.x1 + o; const y0 = B.y0 - o; const y1 = B.y1 + o; const r = rad0 + o;
        const p = holeOf ? new T.Path() : new T.Shape();
        p.moveTo(x0 + r, y0); p.lineTo(x1 - r, y0); p.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
        p.lineTo(x1, y1 - r); p.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
        p.lineTo(x0 + r, y1); p.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
        p.lineTo(x0, y0 + r); p.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
        return p;
      };
      const ring = (a, b, z, mats) => {
        const sh = rrect(b); sh.holes.push(rrect(a, true));
        const geo = new T.ExtrudeGeometry(sh, { depth: z, bevelEnabled: false, curveSegments: 10 });
        const m = new T.Mesh(geo, mats); m.receiveShadow = true; m.castShadow = true; stage.add(m); return m;
      };
      const tex = crowd.clone(); tex.needsUpdate = true; tex.repeat.set(1 / (rowD * 5), 1 / (rowD * 5)); shared.add(crowd);
      const seatTop = new T.MeshStandardMaterial({ map: tex, roughness: 0.95 });
      const riser = new T.MeshStandardMaterial({ color: 0x1b1d22, roughness: 1 });
      const concrete = new T.MeshStandardMaterial({ color: 0x4a4e56, roughness: 1 });
      const roofM = new T.MeshStandardMaterial({ color: 0x16181c, roughness: 0.7, metalness: 0.3 });
      ring(0, rowD * 0.6, rise * 2.2, [concrete, riser]); // 앞 벽
      let o = rowD * 0.6; let z = rise * 2.2; const tiers = [];
      for (let i = 0; i < N; i++) {
        const mid = i === Math.floor(N / 2);
        if (mid) { ring(o, o + rowD * 1.2, z + rise * 2.5, [concrete, riser]); o += rowD * 1.2; z += rise * 3.2; }
        z += rise; ring(o, o + rowD, z, [seatTop, riser]); tiers.push([o, z]); o += rowD;
      }
      // 지붕 (바깥 고리) + 안쪽 흰 테두리
      ring(o, o + rowD * 4.5, z + rise * 7, [roofM, roofM]);
      ring(o - rowD * 0.05, o + rowD * 0.25, z + rise * 7.3, [new T.MeshBasicMaterial({ color: 0xd6dbe2 }), riser]);
      // 통로 계단: 네 변의 곧은 부분에 바깥쪽으로 (한 번에 그리는 InstancedMesh)
      const sides = [['t', B.x1 - B.x0 - rad0 * 0.4], ['b', B.x1 - B.x0 - rad0 * 0.4], ['l', B.y1 - B.y0 - rad0 * 0.4], ['r', B.y1 - B.y0 - rad0 * 0.4]];
      const per = sides.map(([, L]) => Math.max(3, Math.round(L / (big * 0.13))));
      const total = per.reduce((s, n) => s + n, 0) * tiers.length;
      const aisle = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ color: 0x5a5f68, roughness: 1 }), total);
      const mtx = new T.Matrix4(); let idx = 0; const aw = rowD * 0.45;
      sides.forEach(([sd, L], si) => {
        const n = per[si];
        for (let q = 0; q < n; q++) {
          const t = (q + 0.5) / n - 0.5;
          tiers.forEach(([oo, zz]) => {
            const d = oo + rowD / 2;
            let x; let y; let sx; let sy;
            if (sd === 't') { x = cx + t * L; y = B.y1 + d; sx = aw; sy = rowD; }
            if (sd === 'b') { x = cx + t * L; y = B.y0 - d; sx = aw; sy = rowD; }
            if (sd === 'l') { x = B.x0 - d; y = cy + t * L; sx = rowD; sy = aw; }
            if (sd === 'r') { x = B.x1 + d; y = cy + t * L; sx = rowD; sy = aw; }
            mtx.makeScale(sx, sy, zz + 0.4).setPosition(x, y, (zz + 0.4) / 2); aisle.setMatrixAt(idx++, mtx);
          });
        }
      });
      aisle.receiveShadow = true; stage.add(aisle);
      // 골대
      (st.goals || []).forEach(([gx, gy, dir, gk2]) => goal(T, stage, M, S, gx, gy, dir, gk2));
    }

    // ── 움직이는 것: 선수 · 공 · 기구 ──
    if (dyn) { root.remove(dyn); disposeTree(dyn); }
    dyn = new T.Group(); root.add(dyn);
    st.items.forEach((it, idx) => {
      const p = M(it.x, it.y);
      const r = it.r * S;
      const lift = (idx % 24) * r * 0.012; // 선수마다 살짝 다른 높이 → 겹쳐도 윗면이 깨지지 않음
      p.z = lift;
      if (it.k === 'player') {
        if (it.shirt) shirt3d(T, dyn, p, r, it); else disc3d(T, dyn, p, r, it);
        if (it.hl) {
          const hc = it.hlc || 0xffd400;
          const ringM = new T.Mesh(new T.TorusGeometry(r * 1.7, r * 0.13, 10, 64), new T.MeshBasicMaterial({ color: hc })); ringM.position.set(p.x, p.y, 0.6 + p.z); dyn.add(ringM);
          const glow = new T.Mesh(new T.CircleGeometry(r * 2.3, 48), new T.MeshBasicMaterial({ color: hc, transparent: true, opacity: 0.25, depthWrite: false })); glow.position.set(p.x, p.y, 0.4 + p.z); dyn.add(glow);
          const beam = new T.Mesh(new T.CylinderGeometry(r * 1.2, r * 1.6, r * 7, 32, 1, true), new T.MeshBasicMaterial({ color: hc, transparent: true, opacity: 0.14, side: T.DoubleSide, depthWrite: false }));
          beam.rotation.x = Math.PI / 2; beam.position.set(p.x, p.y, r * 3.5); dyn.add(beam);
        }
        if (it.sel) { const sr = new T.Mesh(new T.TorusGeometry(r * 1.4, r * 0.08, 8, 48), new T.MeshBasicMaterial({ color: 0x4ea1ff })); sr.position.set(p.x, p.y, 0.7 + p.z); dyn.add(sr); }
      } else if (it.k === 'num') {
        const side = r * 2; const h = r * 0.35;
        const tex = numTexture(T, 'num', it.n, it.c, it.ink); shared.add(tex);
        const body = new T.MeshStandardMaterial({ color: it.c, roughness: 0.5 });
        const box = new T.Mesh(new T.BoxGeometry(side, side, h), [body, body, body, body, new T.MeshBasicMaterial({ map: tex, toneMapped: false }), body]);
        box.position.set(p.x, p.y, h / 2 + 0.15 + p.z); box.castShadow = true; dyn.add(box);
      } else if (it.k === 'ball') {
        // 축구공: 흰 바탕 + 검은 오각형 12개 + 이음선 (흰 구슬처럼 안 보이게) · 조금 크게
        const br = r * 1.25;
        const ball = new T.Mesh(new T.SphereGeometry(br, 40, 28), new T.MeshStandardMaterial({ map: ballTexture(T), roughness: 0.42, metalness: 0 }));
        ball.position.set(p.x, p.y, br + 0.2); ball.rotation.set(0.6, 0.35, 0.2); ball.castShadow = true; dyn.add(ball);
      } else if (it.k === 'cone') {
        const c = new T.Mesh(new T.ConeGeometry(r, r * 2.2, 20), new T.MeshStandardMaterial({ color: it.c || 0xff8a00, roughness: 0.5 }));
        c.rotation.x = Math.PI / 2; c.position.set(p.x, p.y, r * 1.1); c.castShadow = true; dyn.add(c);
      } else if (it.k === 'pole') {
        const c = new T.Mesh(new T.CylinderGeometry(r * 0.12, r * 0.12, r * 3, 12), new T.MeshStandardMaterial({ color: it.c || 0xffd400 }));
        c.rotation.x = Math.PI / 2; c.position.set(p.x, p.y, r * 1.5); c.castShadow = true; dyn.add(c);
      } else {
        const c = new T.Mesh(new T.CylinderGeometry(r, r * 1.1, r * 0.5, 20), new T.MeshStandardMaterial({ color: it.c || 0xf5c400, roughness: 0.6 }));
        c.rotation.x = Math.PI / 2; c.position.set(p.x, p.y, r * 0.25); c.castShadow = true; dyn.add(c);
      }
    });
    // 화살표 · 연결선 · 그리기: 바닥에 깔린 입체 선 + 입체 화살촉 (선수 말보다 낮아서 번호를 가리지 않음)
    (st.strokes || []).forEach((sk) => {
      const rad = Math.max(0.35, (sk.w * S) / 2);
      const P3 = sk.pts.map(([x, y]) => M(x, y, rad + 0.3));
      const mat = new T.MeshStandardMaterial({ color: sk.c, emissive: sk.c, emissiveIntensity: 0.25, roughness: 0.45 });
      const pieces = [];
      if (sk.dash) {
        const [on, off] = sk.dash; let acc = 0; let cur = [P3[0]]; let drawing = true;
        for (let q = 1; q < P3.length; q++) {
          const d = P3[q].distanceTo(P3[q - 1]) / S; acc += d;
          if (drawing) cur.push(P3[q]);
          if (acc >= (drawing ? on : off)) { if (drawing && cur.length > 1) pieces.push(cur); drawing = !drawing; acc = 0; cur = [P3[q]]; }
        }
        if (drawing && cur.length > 1) pieces.push(cur);
      } else pieces.push(P3);
      pieces.forEach((pp) => {
        const curve = new T.CatmullRomCurve3(pp, false, 'centripetal');
        const tube = new T.Mesh(new T.TubeGeometry(curve, Math.max(4, pp.length * 2), rad, 8, false), mat);
        tube.castShadow = true; dyn.add(tube);
      });
      const head = (a, b) => { // b 쪽 끝에 화살촉
        const dir = b.clone().sub(a).normalize(); const hl = rad * 6.5;
        const cone = new T.Mesh(new T.ConeGeometry(rad * 3, hl, 18), mat);
        cone.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
        cone.position.copy(b).addScaledVector(dir, -hl * 0.35); cone.castShadow = true; dyn.add(cone);
      };
      const n = P3.length;
      if (sk.head && n > 1) head(P3[Math.max(0, n - 3)], P3[n - 1]);
      if (sk.tail && n > 1) head(P3[Math.min(n - 1, 2)], P3[0]);
    });
    // 화살촉: 끝(tip)을 향한 입체 촉 (선과 같은 높이)
    (st.heads || []).forEach((hd) => {
      const tip = M(...hd.tip); const A2 = M(...hd.a); const B2 = M(...hd.b);
      const base = A2.clone().add(B2).multiplyScalar(0.5);
      const len = tip.distanceTo(base); const hw = A2.distanceTo(B2) / 2; if (!(len > 0.5)) return;
      const z = Math.max(0.35, hw * 0.35) + 0.3; tip.z = z; base.z = z;
      const dir = tip.clone().sub(base).normalize();
      const mat = new T.MeshStandardMaterial({ color: hd.c, emissive: hd.c, emissiveIntensity: 0.25, roughness: 0.45 });
      const cone = new T.Mesh(new T.ConeGeometry(hw, len, 24), mat);
      cone.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
      cone.position.copy(base).addScaledVector(dir, len / 2); cone.castShadow = true; dyn.add(cone);
    });
    // 글자: 바닥 위 판 (화면 쪽으로 바로 읽히게)
    (st.texts || []).forEach((tx) => {
      const Q = tx.pts.map(([x, y]) => M(x, y, 0.5));
      const wM = Q[0].distanceTo(Q[1]); const hM = Q[0].distanceTo(Q[2]); if (!(wM > 0 && hM > 0)) return;
      const c = document.createElement('canvas'); const ch = 96; c.height = ch; c.width = Math.max(32, Math.min(2048, Math.round((ch * wM) / hM)));
      const g = c.getContext('2d'); g.font = `${tx.bold} ${ch * 0.82}px Pretendard, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = ch * 0.1; g.lineJoin = 'round'; g.strokeStyle = lum(tx.c) > 0.5 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.6)'; g.strokeText(tx.t, c.width / 2, ch * 0.54);
      g.fillStyle = tx.c; g.fillText(tx.t, c.width / 2, ch * 0.54);
      const tt = new T.CanvasTexture(c); tt.colorSpace = T.SRGBColorSpace; tt.anisotropy = 8;
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute([Q[0], Q[1], Q[3], Q[2]].flatMap((v) => [v.x, v.y, v.z]), 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2)); geo.setIndex([0, 1, 2, 0, 2, 3]);
      dyn.add(new T.Mesh(geo, new T.MeshBasicMaterial({ map: tt, transparent: true, depthWrite: false, side: T.DoubleSide })));
    });
    draw();
  }

  // 원판 말: 광택 있는 두께 + 윗면 번호판(테두리 링)
  function disc3d(T, parent, p, r, it) {
    const h = r * 0.42;
    const body = new T.MeshPhysicalMaterial({ color: it.fill, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.18 });
    const tex = numTexture(T, 'disc', it.n, it.fill, it.ink, it.sp, it.pc2); shared.add(tex);
    const top = new T.MeshStandardMaterial({ map: tex, roughness: 0.5 });
    // 번호는 원판 윗면에 바로 입힘 (겹친 판이 없어 깨지지 않음)
    const puck = new T.Mesh(new T.CylinderGeometry(r * 0.97, r, h, 64), [body, top, body]);
    puck.rotation.x = Math.PI / 2; puck.position.set(p.x, p.y, h / 2 + 0.2 + p.z); puck.castShadow = true; parent.add(puck);
  }
  // 유니폼 말: 셔츠 모양 두께 + 두 번째 색 + 번호
  function shirt3d(T, parent, p, r, it) {
    // 유니폼 폭 ≈ 원판 지름보다 조금 넓게
    const q = (r / 2.1) * 0.9; const P = (dx, dy) => [p.x + dx * q, p.y - dy * q];
    const sh = new T.Shape();
    const pts = [[-1.15, -2.1], [-2.5, -1.45], [-2.9, 0], [-1.75, 0.45], [-1.75, 2.2], [1.75, 2.2], [1.75, 0.45], [2.9, 0], [2.5, -1.45], [1.15, -2.1]];
    sh.moveTo(...P(...pts[0])); pts.slice(1).forEach((v) => sh.lineTo(...P(...v)));
    sh.quadraticCurveTo(...P(0, -1.2), ...P(-1.15, -2.1));
    const th = r * 0.32;
    const geo = new T.ExtrudeGeometry(sh, { depth: th, bevelEnabled: true, bevelSize: r * 0.06, bevelThickness: r * 0.06, bevelSegments: 2, curveSegments: 8 });
    const mat = new T.MeshPhysicalMaterial({ color: it.fill, roughness: 0.55, sheen: 1, sheenRoughness: 0.6 });
    const m = new T.Mesh(geo, mat); m.position.z = 0.2 + p.z; m.castShadow = true; parent.add(m);
    const zt = th + r * 0.06 + 0.25 + p.z;
    if ((it.sp === 'h' || it.sp === 'v') && it.pc2) {
      const m2 = new T.MeshStandardMaterial({ color: it.pc2, roughness: 0.6 });
      const band = (x0, y0, x1, y1) => { const b = new T.Mesh(new T.PlaneGeometry((x1 - x0) * q, (y1 - y0) * q), m2); b.position.set(p.x + ((x0 + x1) / 2) * q, p.y - ((y0 + y1) / 2) * q, zt); parent.add(b); };
      if (it.sp === 'h') band(-1.75, 0.5, 1.75, 2.2);
      else { band(-0.58, -1.35, 0.58, 2.2); band(-1.75, -1.0, -1.05, 2.2); band(1.05, -1.0, 1.75, 2.2); }
    }
    const tex = numTexture(T, 'shirt', it.n, it.fill, it.ink); shared.add(tex);
    const num = new T.Mesh(new T.PlaneGeometry(q * 3.4, q * 3.4), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    num.position.set(p.x, p.y - q * 0.3, zt + 0.05); parent.add(num);
  }

  function draw() { if (ready) renderer.render(scene, camera); }
  const api = {
    update,
    clear() { pending = null; container.classList.remove('pad-3dgl-on'); },
    get ok() { return ready && !failed; },
    get failed() { return failed; },
    get scene() { return scene; },
    get cam() { return camera; },
    // 저장 이미지: 중계 화면 그림 + 싸카매니저 표시 (경기장 가운데 흐린 로고 · 아래 TACTICAL PAD / SSAKA MANAGER) — 평면 저장과 같은 표시
    async png() { const out = await this.frame(); try { return out ? out.toDataURL('image/png') : null; } catch { return null; } },
    // 한 장면 그림 → out 캔버스 (영상 녹화 때 같은 캔버스에 계속 그림) · maxW: 가로 최대 픽셀
    // 저장 전용 카메라로 다시 찍음: 경기장을 한가운데 · 네 면 관중석이 같은 폭 (작전판 화면 크기와 상관없이)
    async frame(out, maxW = 1600) {
      if (!ready || !fieldMark) return null;
      expR ||= new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
      Object.assign(expR, { outputColorSpace: renderer.outputColorSpace, toneMapping: renderer.toneMapping, toneMappingExposure: renderer.toneMappingExposure });
      expR.shadowMap.enabled = true; expR.shadowMap.type = T.PCFSoftShadowMap; expR.setClearColor(0x0b0d10, 1); expR.setPixelRatio(1);
      expC ||= new T.PerspectiveCamera();
      expC.fov = camera.fov; expC.near = camera.near; expC.far = camera.far; expC.position.copy(camera.position); expC.quaternion.copy(camera.quaternion); expC.updateMatrixWorld(true); expC.zoom = 1; expC.aspect = 1; expC.clearViewOffset(); expC.updateProjectionMatrix();
      root.updateMatrixWorld(true);
      const ndc = (v) => { const q = v.clone(); root.localToWorld(q); q.project(expC); return [q.x, q.y]; };
      const P = fieldMark.k.map(ndc);
      const x0 = Math.min(...P.map((q) => q[0])); const x1 = Math.max(...P.map((q) => q[0]));
      const y0 = Math.min(...P.map((q) => q[1])); const y1 = Math.max(...P.map((q) => q[1]));
      const M = Math.max(x1 - x0, y1 - y0) * 0.1; // 둘레 관중석 폭 (네 면 같게)
      const F = 2000; const rw = ((x1 - x0 + 2 * M) / 2) * F; const rh = ((y1 - y0 + 2 * M) / 2) * F;
      expC.setViewOffset(F, F, ((x0 - M + 1) / 2) * F, ((1 - (y1 + M)) / 2) * F, rw, rh); expC.updateProjectionMatrix();
      const W = Math.round(Math.min(maxW, 2400) / 2) * 2; const H = Math.round((W * rh) / rw / 2) * 2;
      if (expR.domElement.width !== W || expR.domElement.height !== H) expR.setSize(W, H, false);
      expR.render(scene, expC);
      out ||= document.createElement('canvas');
      if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
      const g = out.getContext('2d'); g.drawImage(expR.domElement, 0, 0, W, H);
      const proj = (v) => { const q = v.clone(); root.localToWorld(q); q.project(expC); return [((q.x + 1) / 2) * W, ((1 - q.y) / 2) * H]; };
      logoImg ||= await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(false); im.src = 'icons/logo-mark.png'; });
      if (logoImg) {
        const [cx, cy] = proj(fieldMark.c);
        const dist = (a, b) => { const A = proj(a); const B = proj(b); return Math.hypot(A[0] - B[0], A[1] - B[1]); };
        const lw = Math.min(dist(fieldMark.a, fieldMark.b), dist(fieldMark.p, fieldMark.q)) * 0.24; const lh = lw * (logoImg.naturalHeight / logoImg.naturalWidth || 287 / 400);
        g.globalAlpha = 0.16; g.drawImage(logoImg, cx - lw / 2, cy - lh / 2, lw, lh); g.globalAlpha = 1;
      }
      const fs = Math.max(12, Math.round(Math.min(W, H) * 0.024)); const pad = fs * 1.2;
      g.save(); g.font = `900 ${fs}px Pretendard, sans-serif`; g.textBaseline = 'alphabetic';
      if (g.letterSpacing !== undefined) g.letterSpacing = `${fs * 0.28}px`;
      g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = fs * 0.4; g.fillStyle = 'rgba(255,255,255,.62)';
      g.textAlign = 'left'; g.fillText('TACTICAL PAD', pad, H - pad);
      g.textAlign = 'right'; g.fillText('SSAKA MANAGER', W - pad, H - pad); g.restore();
      return out;
    },
    destroy() { try { renderer?.dispose(); expR?.dispose(); } catch { /* */ } canvas.remove(); },
  };
  container.__p3d = () => api;
  return api;
}

// 골대: 기둥 2 · 크로스바 · 그물 (골라인 x = gx, 바깥 방향 dir)
function goal(T, parent, M, S, gx, gy, dir, gk = 1) {
  const half = 3.66 * gk; const hgt = 2.44 * gk * S; const back = 2.0 * gk;
  const a = M(gx, gy - half); const b = M(gx, gy + half);
  const a2 = M(gx + dir * back, gy - half); const b2 = M(gx + dir * back, gy + half);
  const mat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const r = Math.max(0.6, 0.09 * S);
  const post = (p) => { const m = new T.Mesh(new T.CylinderGeometry(r, r, hgt, 12), mat); m.rotation.x = Math.PI / 2; m.position.set(p.x, p.y, hgt / 2); m.castShadow = true; parent.add(m); };
  post(a); post(b);
  const bar = new T.Mesh(new T.CylinderGeometry(r, r, a.distanceTo(b), 12), mat);
  bar.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, hgt); bar.rotation.z = Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2; bar.castShadow = true; parent.add(bar);
  const pts = [];
  const top = (t) => new T.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, hgt);
  const btm = (t) => new T.Vector3(a2.x + (b2.x - a2.x) * t, a2.y + (b2.y - a2.y) * t, 0);
  for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push(top(t), btm(t)); }
  for (let j = 0; j <= 8; j++) { const f = j / 8; for (let i = 0; i < 20; i++) { pts.push(top(i / 20).lerp(btm(i / 20), f), top((i + 1) / 20).lerp(btm((i + 1) / 20), f)); } }
  [a, b].forEach((p, i) => { const q = i ? b2 : a2; for (let j = 0; j <= 8; j++) { const f = j / 8; pts.push(new T.Vector3(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, 0), new T.Vector3(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, hgt * (1 - f))); } });
  parent.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })));
}
