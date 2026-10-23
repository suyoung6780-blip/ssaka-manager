// AI 따라가기 — 고른 선수 + 그 주변 선수들을 함께 따라가며 서로 헷갈리지 않게
// · 겹칠 때: 한 덩어리로 잡히면 겹치기 전 움직임대로 이어 가고, 다시 갈라지면 움직임 · 유니폼 색으로 누가 누군지 가림
// · 작게 보일 때: 주변을 크게 확대해서 찾고, 못 찾으면 잔디와 다른 색 덩어리로 이어 감
// 색 닮음 0~1: 상의를 더 봄 (하의 · 양말은 두 팀이 같은 색인 경우가 많음)
const bcOf = (a, b) => { let t = 0; let u = 0; for (let i = 0; i < 15; i++) { t += Math.sqrt(a[i] * b[i]); u += Math.sqrt(a[i + 15] * b[i + 15]); } return t * 0.7 + u * 0.3; };

export class FollowAI {
  // pt: PlayerTracker (픽셀 읽기 · 유니폼 색 · 몸 재기), detect(src, region) → 사람 상자들
  constructor(pt, detect) { this.pt = pt; this.detect = detect; }

  // 유니폼 색: 몸 가운데 띠(잔디가 거의 안 섞임)를 위(상의) · 아래(하의) 15칸씩
  // 잔디 판정에 기대지 않음 — 밤 영상 · 노란/초록 유니폼도 색이 비지 않게
  appear(src, b) {
    try {
      const bh = b.y1 - b.y0; const bw = b.x1 - b.x0;
      const k = Math.min(1, 36 / Math.max(4, bh)); // 확대하지 않음 (압축 잡음까지 커짐)
      const r = this.pt.read(src, b.x0 + bw * 0.28, b.y0 + bh * 0.1, Math.max(2, bw * 0.44), Math.max(4, bh * 0.75), k);
      const h = new Float32Array(30); const n = [0, 0];
      for (let y = 0; y < r.h; y++) {
        const o = y < r.h * 0.5 ? 0 : 15;
        for (let x = 0; x < r.w; x++) {
          const p = (y * r.w + x) * 4;
          const R = r.d[p]; const G = r.d[p + 1]; const B = r.d[p + 2];
          const mx = Math.max(R, G, B); const mn = Math.min(R, G, B);
          // 흐린 영상에서 색이 칸 경계에서 흔들리지 않게 이웃 칸에 나눠 담음 (부드러운 칸)
          const sat = mx ? (mx - mn) / mx : 0;
          const wc = Math.max(0, Math.min(1, (sat - 0.12) / 0.2)) * Math.max(0, Math.min(1, (mx - 35) / 30));
          if (wc < 1) { // 무채색: 검정 · 회색 · 흰색 사이를 밝기로 나눔
            const g = 1 - wc; const v = mx / 255;
            const wb = Math.max(0, Math.min(1, (0.3 - v) / 0.15)); const ww = Math.max(0, Math.min(1, (v - 0.55) / 0.15));
            h[o] += g * wb; h[o + 1] += g * ww; h[o + 2] += g * Math.max(0, 1 - wb - ww);
          }
          if (wc > 0) {
            let hu = mx === R ? (G - B) / (mx - mn) : mx === G ? 2 + (B - R) / (mx - mn) : 4 + (R - G) / (mx - mn);
            hu = ((hu * 60 + 360) % 360) / 30 - 0.5;
            const i0 = Math.floor(hu); const f = hu - i0;
            h[o + 3 + ((i0 + 12) % 12)] += wc * (1 - f); h[o + 3 + ((i0 + 13) % 12)] += wc * f;
          }
          n[o ? 1 : 0]++;
        }
      }
      for (let i = 0; i < 30; i++) h[i] /= Math.max(1, n[i < 15 ? 0 : 1]);
      return h;
    } catch { return null; }
  }

  // 처음 고른 모습의 유니폼 색 (겹친 뒤에도 이 색으로 누가 누군지 가림) — 고른 장면에서 한 번
  prime(src, st) {
    const w0 = st.ph * 0.42;
    st.app0 = this.appear(src, { x0: st.x - w0 / 2, x1: st.x + w0 / 2, y0: st.y - st.ph, y1: st.y }) || new Float32Array(30).fill(1 / 15);
    st.app = Float32Array.from(st.app0);
    // 화면 끝에 몸이 잘린 채 고른 경우: 처음 몇 장면 동안 색을 다시 익힘
    const VW = src.videoWidth || src.width;
    st.edge = st.x - w0 < 2 || st.x + w0 > VW - 2 || st.y - st.ph < 2;
    st.age = 0;
  }

  // 한 장면 진행. st: 따라가는 선수 상태(영상 픽셀: 발 x · y, 키 ph, 속도 vx · vy, 유니폼 색 hist · hist0)
  // 돌려줌: { ok: 이번에 확실히 찾음, amb: 헷갈려서 이번엔 예측대로, occ: 다른 선수와 겹침 }
  async step(src, st, key, dt, cam = { dx: 0, dy: 0 }, zoom = 1) {
    const VW = src.videoWidth || src.width; const VH = src.videoHeight || src.height;
    const t = Math.min(dt, 0.5);
    const camX = cam.dx * VW; const camY = cam.dy * VH;
    if (!st.app0) this.prime(src, st);
    st.nb = st.nb || [];
    st.miss = st.miss || 0;
    const tracks = [st, ...st.nb];
    // 1) 예측: 카메라 이동 + 각자 움직임 (겹친 동안엔 겹치기 전 움직임을 조금씩 줄이며)
    for (const k of tracks) {
      const damp = k.occ ? 0.97 : 1;
      k.vx = (k.vx || 0) * damp; k.vy = (k.vy || 0) * damp;
      k.px = k.x + camX + k.vx * t; k.py = k.y + camY + k.vy * t;
    }
    // 2) 주변에서 사람 찾기 — 선수가 작을수록 좁게 잘라 크게 확대
    const z = Math.max(zoom, st.miss >= 6 ? 3 : st.miss >= 2 ? 1.8 : 1);
    const side = Math.min(VH * 0.7, Math.max(st.ph * 5 * z, Math.min(VH * 0.13, 160) * Math.min(z, 2)));
    const cx = st.px; const cy = st.py - st.ph * 0.5;
    let dets = [];
    try { dets = await this.detect(src, { x: cx - side / 2, y: cy - side / 2, w: side, h: side }); } catch { dets = []; }
    for (const d of dets) { d.fx = (d.x0 + d.x1) / 2; d.fy = d.y1; d.h = d.y1 - d.y0; d.w = d.x1 - d.x0; d.app = this.appear(src, d); }

    // 3) 누가 어느 상자인지 한꺼번에 정함 (모든 짝을 따져 가장 자연스러운 조합)
    const cost = (k, d, isT) => {
      const s = Math.max(6, k.ph);
      const dp = Math.hypot(d.fx - k.px, (d.fy - k.py) * 1.2) / s;
      const gate = isT ? 0.75 + 0.45 * Math.min(k.miss, 8) * z + (k.occRun ? 0.45 : 0) : 0.9 + 0.3 * Math.min(k.miss || 0, 4);
      if (dp > gate) return null;
      const ds = Math.abs(Math.log(Math.max(4, d.h) / s));
      if (ds > 0.8 && !(isT && k.miss > 3)) return null;
      let app = 0.15;
      if (d.app) {
        const bc = isT ? bcOf(d.app, k.app0) * 0.6 + bcOf(d.app, k.app) * 0.4 : k.app ? bcOf(d.app, k.app) : 0.65;
        if (isT) d.bcT = bc;
        // 유니폼 색이 확 다르면 다른 사람 (상대 팀 · 심판 · 코치로 옮겨 타지 않게)
        if (isT && bc < 0.15 && k.miss < 6) return null; // 완전히 다른 색만 막음 (흐린 영상은 같은 선수도 색 점수가 낮게 나옴)
        // 색 점수는 영상 화질에 따라 기준이 다름 (흐리면 같은 선수도 0.5쯤) → 이 선수의 평소 점수보다 얼마나 낮은지로 봄
        app = Math.max(0, (isT ? k.selfBc ?? 0.75 : 0.7) - bc) * 1.4;
      }
      const wide = Math.max(0, d.w / Math.max(1, d.h) - 0.7) * 1.2; // 두 사람이 붙은 넓은 상자
      // 겹침이 막 풀린 때는 유니폼 색을 더 믿음 (겹친 동안 위치 예측은 틀어지기 쉬움)
      const aw = isT && k.occRun ? 2.8 : 1.8;
      return dp * 1.0 + ds * 0.6 + app * aw + wide;
    };
    const C = tracks.map((k, i) => dets.map((d) => cost(k, d, i === 0)));
    const UN = [1.6 + 0.2 * Math.min(st.miss, 6), ...st.nb.map(() => 1.4)]; // 짝 없이 두는 값
    const best = assign(C, UN);
    let a = best.a[0];
    // 고른 선수가 다른 상자로 가는 조합과 점수 차이가 작으면 = 헷갈림
    let amb = false;
    if (a >= 0) {
      const alt = assign(C, UN, 0, a);
      if (alt.cost - best.cost < 0.18) {
        const d0 = dets[a]; const d1 = alt.a[0] >= 0 ? dets[alt.a[0]] : null;
        // 둘 다 예측 자리 바로 옆이면 가까운 쪽, 아니면 이번엔 옮기지 않음
        if (!d1 || Math.hypot(d1.fx - d0.fx, d1.fy - d0.fy) > st.ph * 0.25) amb = true;
      }
    }
    // 오래 헷갈리면(예측만으로 너무 오래 가면 더 틀어짐) 가장 그럴듯한 쪽으로 정함
    st.ambRun = amb ? (st.ambRun || 0) + 1 : 0;
    if (st.ambRun > 8) amb = false;
    // 4) 겹침: 바로 옆에 '방금까지 보이던' 선수가 있는데
    //   · 고른 선수 상자가 없거나(뒤에 가려짐) · 내 상자가 두 사람이 붙은 넓은 상자이거나 · 그 선수 상자가 사라져 내 상자 하나로 합쳐졌으면
    const close = st.nb.filter((k) => (k.miss || 0) <= 1 && Math.abs(k.px - st.px) < st.ph * 0.55 && Math.abs(k.py - st.py) < st.ph * 0.45);
    let occ = false;
    if (close.length) {
      const own = a >= 0 ? dets[a] : null;
      const merged = own && close.some((k) => best.a[tracks.indexOf(k)] < 0 && cost(k, own, false) != null);
      if (!own || merged || own.w > own.h * 0.72) occ = true;
    }
    // 너무 오래 겹친 채로 예측만 하면 틀어짐 → 1초쯤 지나면 보이는 상자로 정함
    st.occRun = occ ? (st.occRun || 0) + 1 : st.occ ? 1 : 0; // 겹침이 풀린 바로 다음 한 번은 표시해 둠(색을 더 믿게)
    if (occ && st.occRun > 14 && a >= 0) occ = false;
    let ok = false;
    const prevX = st.x; const prevY = st.y;
    if (a >= 0 && !amb && !occ) {
      const d = dets[a];
      st.x = d.fx; st.y = d.fy;
      // AI 상자 아래변은 발끝보다 조금 아래일 때가 많음 → 혼자 있으면 몸 모양을 재서 발끝에 정확히 맞춤
      if (!close.length) {
        try {
          const m = this.pt.measure(src, d.fx, d.fy - d.h * 0.2, key, st.hz);
          if (m && Math.abs(m.y - d.fy) < d.h * 0.15 && Math.abs(m.x - d.fx) < d.w * 0.4 && Math.abs(Math.log(m.ph / d.h)) < 0.35) { st.x = m.x; st.y = m.y; }
        } catch { /* */ }
      }
      const r = Math.max(0.85, Math.min(1.15, d.h / st.ph));
      st.ph = st.ph * 0.6 + st.ph * r * 0.4;
      ok = true;
    } else if (occ) {
      // 겹친 동안: 겹치기 전 움직임대로 이어 감. 내 상자(합쳐진 상자)가 있으면 그 밖으로는 안 나감
      const own = a >= 0 ? dets[a] : null;
      st.x = st.px; st.y = st.py;
      if (own) { st.x = Math.max(own.x0 + own.w * 0.15, Math.min(own.x1 - own.w * 0.15, st.x)); st.y = st.y * 0.7 + own.y1 * 0.3; }
      // 내 상자 없이 예측만 하는 건 잠깐만 (오래 가면 놓친 것으로 보고 넓게 다시 찾음)
      ok = !!own || st.occRun <= 8;
    } else if (amb) {
      st.x = st.px; st.y = st.py;
    } else {
      // AI가 못 찾음: 주변에 다른 선수가 없을 때만 잔디와 다른 색 덩어리(몸)를 재서 이어 감
      st.x = st.px; st.y = st.py;
      const nearOther = st.nb.some((k) => Math.hypot(k.px - st.px, k.py - st.py) < st.ph * 1.2);
      if (!nearOther) {
        const m = this.pt.measure(src, st.px, st.py - st.ph * 0.15, key, st.hz);
        if (m && Math.abs(Math.log(m.ph / st.ph)) < 0.4 && Math.hypot(m.x - st.px, m.y - st.py) < st.ph * 0.5) { st.x = m.x; st.y = m.y; ok = true; }
      }
    }
    // 움직임(속도) — 확실히 찾았을 때만 갱신 (겹친 동안엔 겹치기 전 움직임 유지)
    if (ok && !occ && dt > 0) {
      const lim = st.ph * 6;
      const ivx = Math.max(-lim, Math.min(lim, (st.x - prevX - camX) / dt));
      const ivy = Math.max(-lim, Math.min(lim, (st.y - prevY - camY) / dt));
      st.vx = st.vx * 0.5 + ivx * 0.5; st.vy = st.vy * 0.5 + ivy * 0.5;
    }
    st.occ = occ;
    st.age = (st.age || 0) + 1;
    if (ok && !occ && !close.length && st.edge && st.age < 8 && dets[a]?.app) st.app0 = Float32Array.from(dets[a].app);
    if (!occ && st.occRun && ok) st.occRun = st.occRun > 1 ? 1 : 0;
    st.miss = ok || amb ? 0 : st.miss + 1;
    if (!ok && !occ && !amb) { st.vx *= 0.8; st.vy *= 0.8; }
    // 확실하고 혼자일 때만 유니폼 색을 천천히 갱신 (그늘 · 조명 변화)
    if (ok && !occ && a >= 0 && dets[a].bcT != null && !close.length) st.selfBc = (st.selfBc ?? 0.75) * 0.8 + dets[a].bcT * 0.2;
    if (ok && !occ && !close.length && dets[a]?.app && (dets[a].bcT ?? 0) > (st.selfBc ?? 0.75) - 0.1) for (let i = 0; i < 30; i++) st.app[i] = st.app[i] * 0.9 + dets[a].app[i] * 0.1;

    // 5) 주변 선수 갱신 · 새로 들어온 사람 추가 · 멀어진 사람 정리
    st.nb.forEach((k, i) => {
      const j = best.a[i + 1];
      if (j >= 0 && j !== a) {
        const d = dets[j];
        const ox = k.x; const oy = k.y;
        k.x = d.fx; k.y = d.fy; k.ph = k.ph * 0.6 + d.h * 0.4;
        if (dt > 0) { k.vx = k.vx * 0.5 + ((k.x - ox - camX) / dt) * 0.5; k.vy = k.vy * 0.5 + ((k.y - oy - camY) / dt) * 0.5; }
        if (d.app) k.app = k.app ? k.app.map((v, q) => v * 0.85 + d.app[q] * 0.15) : d.app;
        k.miss = 0; k.occ = false;
      } else {
        k.x = k.px; k.y = k.py; k.miss = (k.miss || 0) + 1;
        k.occ = Math.hypot(k.px - st.x, k.py - st.y) < st.ph * 0.6;
      }
    });
    const used = new Set(best.a.filter((j) => j >= 0));
    dets.forEach((d, j) => {
      if (used.has(j)) return;
      if (Math.hypot(d.fx - st.x, d.fy - st.y) < st.ph * (a < 0 ? 0.8 : 0.3)) return; // 고른 선수와 같은 자리(중복 상자 · 이번에 못 짝지은 고른 선수 자신)
      if (st.nb.some((k) => Math.hypot(d.fx - k.x, d.fy - k.y) < k.ph * 0.3)) return;
      st.nb.push({ x: d.fx, y: d.fy, ph: d.h, vx: 0, vy: 0, miss: 0, app: d.app });
    });
    st.nb = st.nb.filter((k) => k.miss <= 5 && Math.hypot(k.x - st.x, k.y - st.y) < st.ph * 4).slice(-8);
    return { x: st.x / VW, y: st.y / VH, ok, amb, occ, n: dets.length };
  }
}

// 짝 정하기: C[트랙][상자] (null = 안 됨), UN[트랙] = 짝 없이 둘 때 값
// 트랙 forceT 는 상자 banD 를 못 고르게(다른 조합 비교용). 작은 문제라 모두 따져 봄 (많으면 가까운 것부터 차례로)
function assign(C, UN, forceT = -1, banD = -1) {
  const T = C.length; const D = T ? C[0].length : 0;
  const a = new Array(T).fill(-1);
  const usedD = new Uint8Array(D);
  let bestCost = Infinity; let bestA = a.slice();
  if (T <= 5 && D <= 7) {
    const rec = (i, acc) => {
      if (acc >= bestCost) return;
      if (i === T) { bestCost = acc; bestA = a.slice(); return; }
      a[i] = -1; rec(i + 1, acc + UN[i]);
      for (let j = 0; j < D; j++) {
        if (usedD[j] || C[i][j] == null || (i === forceT && j === banD)) continue;
        usedD[j] = 1; a[i] = j; rec(i + 1, acc + C[i][j]); usedD[j] = 0; a[i] = -1;
      }
    };
    rec(0, 0);
    return { a: bestA, cost: bestCost };
  }
  const pairs = [];
  for (let i = 0; i < T; i++) for (let j = 0; j < D; j++) if (C[i][j] != null && !(i === forceT && j === banD) && C[i][j] < UN[i]) pairs.push([C[i][j], i, j]);
  pairs.sort((p, q) => p[0] - q[0]);
  let cost = 0;
  for (const [c, i, j] of pairs) if (a[i] < 0 && !usedD[j]) { a[i] = j; usedD[j] = 1; cost += c; }
  for (let i = 0; i < T; i++) if (a[i] < 0) cost += UN[i];
  return { a, cost };
}
