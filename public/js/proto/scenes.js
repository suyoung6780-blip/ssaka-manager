// 장면 후보 찾기 (실험 · 시제품) — 경기 영상에서 '다시 볼 곳' 후보만 만든다. 이벤트를 확정하지 않는다.
// 모두 브라우저 안에서 돌아감 (서버 · 유료 API 없음, 영상은 어디에도 올라가지 않음)
//  · whistle-v1: 소리 트랙에서 휘슬처럼 높고 맑은 소리 (mp4 · mov · m4v 만)
//  · motion-v1 : 화면을 0.5초마다 작게 떠서 카메라 이동을 빼고 남는 움직임 (선수가 거의 안 움직이는 구간 = 멈춤 후보)
// 새 방식(공 찾기 모델 · 서버 모델 등)은 DETECTORS 에 같은 모양으로 더하면 후보 검토 화면을 그대로 쓴다.
//  모양: { id, label, ver, needs: (probe) => '' | '이유', run: (src, probe, { onProgress, signal }) => 결과 }

// ───────── 파일 읽기: File(내 컴퓨터) 또는 주소(Range 요청) ─────────
export function readerOf(src) {
  if (src instanceof Blob) {
    return { size: src.size, name: src.name || '', read: async (off, len) => new Uint8Array(await src.slice(off, off + len).arrayBuffer()) };
  }
  let size = 0;
  return {
    get size() { return size; },
    name: String(src).split('/').pop(),
    async init() { const r = await fetch(src, { headers: { Range: 'bytes=0-0' } }); size = +(r.headers.get('Content-Range') || '').split('/')[1] || 0; },
    read: async (off, len) => new Uint8Array(await (await fetch(src, { headers: { Range: `bytes=${off}-${off + len - 1}` } })).arrayBuffer()),
  };
}

// ───────── mp4 · mov 상자 읽기 (소리 트랙만 필요) ─────────
const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const str4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
function* kids(b, s, e) {
  let o = s;
  while (o + 8 <= e) {
    let sz = u32(b, o); const ty = str4(b, o + 4); let hl = 8;
    if (sz === 1) { sz = u32(b, o + 8) * 2 ** 32 + u32(b, o + 12); hl = 16; }
    if (sz === 0) sz = e - o;
    if (sz < hl) return;
    yield { ty, s: o + hl, e: Math.min(e, o + sz) };
    o += sz;
  }
}
const find = (b, s, e, path) => {
  let cur = { s, e };
  for (const ty of path) { cur = [...kids(b, cur.s, cur.e)].find((k) => k.ty === ty); if (!cur) return null; }
  return cur;
};
async function topBoxes(rd) {
  const out = []; let o = 0;
  while (o + 8 <= rd.size && out.length < 64) {
    const h = await rd.read(o, 16);
    let sz = u32(h, 0); const ty = str4(h, 4);
    if (sz === 1) sz = u32(h, 8) * 2 ** 32 + u32(h, 12);
    if (sz === 0) sz = rd.size - o;
    if (sz < 8 || !/^[\x20-\x7e]{4}$/.test(ty)) break;
    out.push({ ty, off: o, size: sz }); o += sz;
  }
  return out;
}
// 오디오 설정(esds 안의 AudioSpecificConfig)
function ascOf(b, s, e) {
  for (let i = s; i < e - 4; i++) {
    if (str4(b, i) !== 'esds') continue;
    let p = i + 8; const end = Math.min(e, i - 4 + u32(b, i - 4));
    const len = () => { let n = 0; for (let k = 0; k < 4; k++) { const c = b[p++]; n = (n << 7) | (c & 0x7f); if (!(c & 0x80)) break; } return n; };
    while (p < end) {
      const tag = b[p++]; const n = len();
      if (tag === 0x03) { p += 3; continue; } // ES_ID(2) + flags(1)
      if (tag === 0x04) { p += 13; continue; } // objectType · streamType · buffer · bitrate
      if (tag === 0x05) return b.slice(p, p + n);
      p += n;
    }
  }
  return null;
}
export async function audioTrack(rd) {
  const tops = await topBoxes(rd);
  const mv = tops.find((x) => x.ty === 'moov');
  if (!mv) return { ok: false, why: 'mp4 · mov 형식이 아니거나 영상 정보(moov)를 찾지 못했어요.' };
  const b = await rd.read(mv.off, mv.size);
  for (const tk of kids(b, 8, b.length)) {
    if (tk.ty !== 'trak') continue;
    const hd = find(b, tk.s, tk.e, ['mdia', 'hdlr']);
    if (!hd || str4(b, hd.s + 8) !== 'soun') continue;
    const md = find(b, tk.s, tk.e, ['mdia', 'mdhd']);
    const v1 = b[md.s] === 1;
    const ts = u32(b, md.s + (v1 ? 20 : 12));
    const stbl = find(b, tk.s, tk.e, ['mdia', 'minf', 'stbl']);
    const box = (ty) => [...kids(b, stbl.s, stbl.e)].find((k) => k.ty === ty);
    const stsd = box('stsd');
    const ent = [...kids(b, stsd.s + 8, stsd.e)][0];
    if (!ent || ent.ty !== 'mp4a') return { ok: false, why: `소리 형식(${ent?.ty || '?'})은 아직 분석하지 못해요. AAC(mp4a)만 돼요.` };
    const ver = (b[ent.s + 8] << 8) | b[ent.s + 9];
    const ch = (b[ent.s + 16] << 8) | b[ent.s + 17];
    const sr = (b[ent.s + 24] << 8) | b[ent.s + 25];
    const asc = ascOf(b, ent.s + 28 + (ver === 1 ? 16 : ver === 2 ? 36 : 0) - 8, ent.e);
    if (!asc) return { ok: false, why: '소리 설정(esds)을 찾지 못했어요.' };
    // 샘플 위치 = 덩어리(chunk) 시작 + 앞 샘플 크기 합
    const stsz = box('stsz'); const fixed = u32(b, stsz.s + 4); const n = u32(b, stsz.s + 8);
    const sizes = new Uint32Array(n); for (let i = 0; i < n; i++) sizes[i] = fixed || u32(b, stsz.s + 12 + i * 4);
    // 조각이 아주 작으면(평균 24바이트 미만) 소리가 비어 있는 것 — 녹화 장비가 무음 트랙만 넣은 경우 (예: 일부 자동 촬영 영상)
    const avg = sizes.reduce((a, x) => a + x, 0) / Math.max(1, n);
    if (n && avg < 24) return { ok: false, silent: true, why: '소리 트랙은 있지만 비어 있어요(무음). 휘슬 소리로는 찾을 수 없어요.' };
    const co = box('stco') || box('co64'); const big = co.ty === 'co64'; const nc = u32(b, co.s + 4);
    const offs = new Float64Array(nc); for (let i = 0; i < nc; i++) offs[i] = big ? u32(b, co.s + 8 + i * 8) * 2 ** 32 + u32(b, co.s + 12 + i * 8) : u32(b, co.s + 8 + i * 4);
    const sc = box('stsc'); const ns = u32(b, sc.s + 4); const runs = [];
    for (let i = 0; i < ns; i++) runs.push([u32(b, sc.s + 8 + i * 12) - 1, u32(b, sc.s + 12 + i * 12)]);
    const chunks = []; let si = 0;
    for (let c = 0; c < nc; c++) {
      let per = runs[0][1]; for (const [first, p] of runs) { if (first <= c) per = p; else break; }
      let len = 0; const from = si; for (let k = 0; k < per && si < n; k++) len += sizes[si++];
      chunks.push({ off: offs[c], len, from, count: si - from });
    }
    const aot = asc[0] >> 3;
    return { ok: true, ts, sr: sr || 48000, ch: ch || 2, asc, codec: `mp4a.40.${aot || 2}`, sizes, chunks, samples: n, dur: n * 1024 / (sr || 48000) };
  }
  return { ok: false, why: '이 영상에는 소리 트랙이 없어요.' };
}

// ───────── 영상 확인: 형식 · 길이 · 화면 크기 · 소리 ─────────
export async function probe(src) {
  const rd = readerOf(src); if (rd.init) await rd.init();
  const head = await rd.read(0, 12);
  const kind = str4(head, 4) === 'ftyp' ? (str4(head, 8).startsWith('qt') ? 'mov' : 'mp4') : head[0] === 0x1a && head[1] === 0x45 ? 'webm' : 'other';
  const url = src instanceof Blob ? URL.createObjectURL(src) : src;
  const meta = await new Promise((res) => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'metadata';
    const done = (ok) => { res(ok ? { w: v.videoWidth, h: v.videoHeight, dur: v.duration } : null); v.removeAttribute('src'); v.load(); };
    v.onloadedmetadata = () => done(true); v.onerror = () => done(false); v.src = url;
    setTimeout(() => done(false), 15000);
  });
  if (src instanceof Blob) URL.revokeObjectURL(url);
  let audio = { ok: false, why: kind === 'webm' ? 'webm 영상은 소리 분석을 아직 못 해요 (mp4 · mov 는 돼요).' : '' };
  if (kind === 'mp4' || kind === 'mov') { try { audio = await audioTrack(rd); } catch (e) { audio = { ok: false, why: `소리 정보를 읽지 못했어요 (${e.message})` }; } }
  return { kind, sizeMB: Math.round(rd.size / 1e6), name: rd.name, ...(meta || {}), playable: !!meta, audio, hasAudio: !!audio.ok };
}

// ───────── 휘슬 소리 (whistle-v1) ─────────
function fft(re, im) { // 제자리 radix-2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len; const wr = Math.cos(a); const wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1; let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k; const q = p + len / 2;
        const xr = re[q] * cr - im[q] * ci; const xi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - xr; im[q] = im[p] - xi; re[p] += xr; im[p] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// 소리를 풀어서 21ms마다 '2~4.8kHz 안의 가장 큰 봉우리 ÷ 그 대역 중간값'(맑은 높은 소리일수록 큼)
export async function whistleSeries(rd, at, { onProgress, signal } = {}) {
  if (typeof AudioDecoder === 'undefined') throw new Error('이 브라우저는 소리 분석(WebCodecs)을 지원하지 않아요. 크롬 · 엣지 최신 버전에서 해 주세요.');
  const N = 2048; const HOP = 1024;
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const lo = Math.floor((2000 / at.sr) * N); const hi = Math.ceil((4800 / at.sr) * N);
  const ton = []; const lvl = [];
  let buf = new Float32Array(0);
  const re = new Float32Array(N); const im = new Float32Array(N); const band = new Float32Array(hi - lo);
  const push = (pcm) => {
    const nb = new Float32Array(buf.length + pcm.length); nb.set(buf); nb.set(pcm, buf.length); buf = nb;
    let o = 0;
    while (o + N <= buf.length) {
      let e = 0;
      for (let i = 0; i < N; i++) { const s = buf[o + i]; re[i] = s * win[i]; im[i] = 0; e += s * s; }
      fft(re, im);
      let pk = 0;
      for (let k = lo; k < hi; k++) { const m = Math.hypot(re[k], im[k]); band[k - lo] = m; if (m > pk) pk = m; }
      const sorted = Float32Array.from(band).sort();
      ton.push(pk / (sorted[sorted.length >> 1] + 1e-6)); lvl.push(Math.sqrt(e / N));
      o += HOP;
    }
    buf = buf.slice(o);
  };
  let err = null;
  const dec = new AudioDecoder({
    output: (ad) => {
      const n = ad.numberOfFrames; const out = new Float32Array(n);
      try { ad.copyTo(out, { planeIndex: 0, format: 'f32-planar' }); } catch { const tmp = new Float32Array(n * ad.numberOfChannels); ad.copyTo(tmp, { planeIndex: 0 }); for (let i = 0; i < n; i++) out[i] = tmp[i * ad.numberOfChannels]; }
      ad.close(); push(out);
    },
    error: (e) => { err = e; },
  });
  dec.configure({ codec: at.codec, sampleRate: at.sr, numberOfChannels: at.ch, description: at.asc });
  let ts = 0; const usPer = (1024 / at.sr) * 1e6;
  for (let c = 0; c < at.chunks.length; c++) {
    if (signal?.aborted) { dec.close(); throw new DOMException('멈춤', 'AbortError'); }
    if (err) throw err;
    const ck = at.chunks[c]; if (!ck.len) continue;
    const data = await rd.read(ck.off, ck.len);
    let p = 0;
    for (let k = 0; k < ck.count; k++) {
      const sz = at.sizes[ck.from + k];
      dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(ts), data: data.subarray(p, p + sz) }));
      p += sz; ts += usPer;
    }
    while (dec.decodeQueueSize > 64) await new Promise((r) => setTimeout(r, 0));
    if (c % 40 === 0) onProgress?.(c / at.chunks.length);
  }
  await dec.flush(); dec.close();
  return { ton, lvl, hop: HOP / at.sr };
}
export function whistleHits({ ton, lvl, hop }) {
  // 기준: 이 영상 안에서 맑은 높은 소리가 아주 드문 수준(상위 0.6%) 이상 + 너무 조용하지 않음
  const srt = Float32Array.from(ton).sort();
  const th = Math.max(9, srt[Math.floor(srt.length * 0.994)] || 9);
  const lsrt = Float32Array.from(lvl).sort(); const lmin = lsrt[Math.floor(lsrt.length * 0.2)] || 0;
  const hits = []; let s = -1; let gap = 0; let sum = 0;
  for (let i = 0; i <= ton.length; i++) {
    const on = i < ton.length && ton[i] >= th && lvl[i] >= lmin;
    if (on) { if (s < 0) { s = i; sum = 0; } gap = 0; sum += ton[i]; }
    else if (s >= 0 && ++gap > 6) { // 0.13초 넘게 끊기면 한 소리 끝
      const e = i - gap; const len = (e - s + 1) * hop;
      if (len >= 0.12) hits.push({ t: +(s * hop).toFixed(2), dur: +len.toFixed(2), score: +(sum / (e - s + 1) / th).toFixed(2) });
      s = -1;
    }
  }
  return { th: +th.toFixed(1), hits };
}

// ───────── 화면 움직임 (motion-v1) ─────────
const MW = 96; const MH = 54;
function gray(ctx) {
  const d = ctx.getImageData(0, 0, MW, MH).data; const g = new Float32Array(MW * MH);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  for (let y = 0; y < 7; y++) for (let x = 0; x < MW; x++) g[y * MW + x] = 0; // 위 점수판 가림
  return g;
}
// 두 장면 사이 카메라 이동(dx, dy)을 찾고, 그만큼 맞춘 뒤 남는 차이(선수 움직임)
function camRes(a, b) {
  const R = 6; let best = [0, 0, Infinity];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    let s = 0;
    for (let y = 10; y < MH - 8; y += 2) for (let x = 10; x < MW - 10; x += 2) s += Math.abs(b[(y + dy) * MW + x + dx] - a[y * MW + x]);
    if (s < best[2]) best = [dx, dy, s];
  }
  const [dx, dy] = best; let moved = 0; let all = 0;
  for (let y = 10; y < MH - 8; y++) for (let x = 10; x < MW - 10; x++) { all++; if (Math.abs(b[(y + dy) * MW + x + dx] - a[y * MW + x]) > 18) moved++; }
  return { cam: Math.hypot(dx, dy), res: (moved / all) * 100 };
}
async function motionSeries(url, { step = 0.5, onProgress, signal } = {}) {
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('영상을 열지 못했어요.')); });
  const cv = document.createElement('canvas'); cv.width = MW; cv.height = MH;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const seek = (t) => new Promise((res) => { const on = () => { v.removeEventListener('seeked', on); res(); }; v.addEventListener('seeked', on); v.currentTime = t; });
  const out = []; let prev = null;
  for (let t = 0; t < v.duration - 0.2; t += step) {
    if (signal?.aborted) throw new DOMException('멈춤', 'AbortError');
    await seek(t);
    ctx.drawImage(v, 0, 0, MW, MH);
    const g = gray(ctx);
    if (prev) { const r = camRes(prev, g); out.push({ t: +t.toFixed(2), cam: +r.cam.toFixed(2), res: +r.res.toFixed(2) }); }
    prev = g;
    if (out.length % 20 === 0) onProgress?.(t / v.duration);
  }
  v.removeAttribute('src'); v.load();
  return out;
}
const smooth = (a, n = 7) => a.map((_, i) => { let s = 0; let c = 0; for (let k = i - (n >> 1); k <= i + (n >> 1); k++) if (k >= 0 && k < a.length) { s += a[k]; c++; } return s / c; });
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))] || 0; };
export function deadSegments(series, { minLen = 8 } = {}) {
  if (series.length < 10) return { dead: [], th: 0 };
  const rs = smooth(series.map((x) => x.res)); const cs = smooth(series.map((x) => x.cam));
  const th = pct(rs, 0.3); const ct = pct(cs, 0.7);
  const dead = []; let s = -1;
  for (let i = 0; i <= rs.length; i++) {
    const low = i < rs.length && rs[i] < th && cs[i] < ct;
    if (low && s < 0) s = i;
    if (!low && s >= 0) { const t0 = series[s].t; const t1 = series[i - 1].t; if (t1 - t0 >= minLen) dead.push({ t0, t1 }); s = -1; }
  }
  return { dead, th: +th.toFixed(2) };
}
// 촬영 방식 짐작 (대략): 카메라가 얼마나 자주 · 얼마나 흔들리며 움직이나
export function cameraGuess(series) {
  if (series.length < 20) return null;
  const moving = series.filter((x) => x.cam >= 1).length / series.length;
  const jit = series.slice(1).reduce((a, x, i) => a + Math.abs(x.cam - series[i].cam), 0) / series.length;
  const kind = moving < 0.1 ? 'fixed' : jit > 1.6 ? 'hand' : 'follow';
  return { kind, moving: Math.round(moving * 100), jitter: +jit.toFixed(2), label: { fixed: '고정 카메라 (거의 안 움직임)', hand: '손으로 든 촬영 (흔들림 많음)', follow: '공을 따라 움직이는 카메라' }[kind] };
}

// ───────── 방식 목록 ─────────
export const DETECTORS = [
  {
    id: 'whistle', label: '휘슬 소리', ver: 'whistle-v1',
    hint: '심판 휘슬처럼 높고 맑은 소리를 찾아요. 파울 · 프리킥 · 오프사이드 · 득점 뒤 킥오프 후보가 돼요.',
    needs: (p) => (p.hasAudio ? '' : p.audio?.why || '소리 트랙이 없어요.'),
    run: async (src, p, opt) => { const rd = readerOf(src); if (rd.init) await rd.init(); const s = await whistleSeries(rd, p.audio, opt); return { ...whistleHits(s), frames: s.ton.length }; },
  },
  {
    id: 'motion', label: '화면 움직임', ver: 'motion-v1',
    hint: '선수들이 거의 안 움직이는 구간(공이 나간 뒤 · 부상 · 교체)을 찾아요. 건너뛰며 보기에 써요.',
    needs: (p) => (p.playable ? '' : '이 브라우저에서 재생되지 않는 영상이에요.'),
    run: async (src, p, opt) => { const url = src instanceof Blob ? URL.createObjectURL(src) : src; try { const s = await motionSeries(url, opt); return { series: s, ...deadSegments(s), camera: cameraGuess(s) }; } finally { if (src instanceof Blob) URL.revokeObjectURL(url); } },
  },
];

// ───────── 후보 만들기: 휘슬 · 멈춤을 합쳐서 '다시 볼 곳' 목록 ─────────
// type: whistle(휘슬) · restart(멈춘 뒤 다시 시작) · long(긴 멈춤 35초+ — 득점 · 부상 · 교체?)
export const CAND_TYPE = { whistle: '휘슬', restart: '다시 시작', long: '긴 멈춤' };
export function buildCands(res) {
  const out = [];
  const W = (res.whistle?.hits || []).slice();
  const D = res.motion?.dead || [];
  // 휘슬이 0.8초 안에 여러 번 = 한 번
  const ws = []; W.forEach((h) => { const l = ws[ws.length - 1]; if (l && h.t - (l.t + l.dur) < 0.8) { l.dur = +(h.t + h.dur - l.t).toFixed(2); l.score = Math.max(l.score, h.score); } else ws.push({ ...h }); });
  ws.forEach((h) => {
    const d = D.find((x) => h.t >= x.t0 - 6 && h.t <= x.t1 + 2); // 휘슬 뒤 멈춤이 이어지면 더 믿을 만
    out.push({ type: 'whistle', t: h.t, t0: Math.max(0, h.t - 8), t1: h.t + 4, score: Math.min(1, 0.45 + 0.15 * h.score + (d ? 0.25 : 0)), why: `휘슬 같은 소리 ${h.dur}초${d ? ' · 뒤에 멈춤' : ''}`, srcs: ['whistle', ...(d ? ['motion'] : [])] });
  });
  D.forEach((d) => {
    const len = d.t1 - d.t0;
    const near = out.find((c) => c.type === 'whistle' && c.t >= d.t1 - 4 && c.t <= d.t1 + 3);
    if (near) { near.why += ' · 멈춘 뒤 다시 시작'; return; }
    out.push({ type: len >= 35 ? 'long' : 'restart', t: d.t1, t0: Math.max(0, d.t1 - 6), t1: d.t1 + 6, score: Math.min(0.8, 0.3 + len / 120), why: `${Math.round(len)}초 동안 움직임이 적었다가 다시 시작`, srcs: ['motion'] });
  });
  out.sort((a, b) => a.t - b.t);
  return out.map((c, i) => ({ id: `c${i + 1}`, ...c, score: +c.score.toFixed(2), state: 'open' }));
}
