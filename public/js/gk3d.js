// 3D (GK) — 키퍼랩 3D 작전판(js/gk3d/tactics3d.js · three.js r128)을 싸카매니저에서 씀
// 처음 열 때만 불러옴 (3D 선수 파일 약 4MB · /gk3d/). 저장하는 값은 작전판 상태(JSON) 그대로
import { toast } from './ui.js';
import { state, hasFeature, isCoach } from './store.js';
import { createPad } from './tactic.js';

// 팀 설정 team.gk3d: 'off' 안 씀 · 'gk' 골키퍼만(기본) · 'all' 모든 선수 — 지도자는 늘 씀 (시제품 3.0에서만)
export const GK3D_MODES = [['gk', '골키퍼만'], ['all', '모든 선수'], ['off', '쓰지 않음']];
export function gk3dAllowed() {
  if (!hasFeature('proto3')) return false;
  const mode = state.team?.gk3d || 'gk';
  if (mode === 'off') return false;
  return mode === 'all' || isCoach() || (state.member?.position || '') === 'GK';
}
const parse = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };
// 일지 장면 보기: 3D (GK) 장면이면 3D로, 아니면 원래 작전판
export function viewScene(box, sc) {
  if (!sc) return;
  if (sc.kind === 'gk3d') { if (sc.gk3d) mountGK3D(box, parse(sc.gk3d), { editable: false }); return; }
  if (sc.pad) createPad(box, sc.pad, { editable: false });
}
// 작은 칸(목록 · 훈련장 · 일지 옆)에 쓸 3D 그림 — 지금 보이는 3D를 줄인 JPEG (훈련 프로그램 gk3dImg)
export async function gk3dThumb(api, w = 640) {
  try {
    const blob = await api.snapshot(); if (!blob) return '';
    const bmp = await createImageBitmap(blob); const c = document.createElement('canvas');
    c.width = w; c.height = Math.round(w * bmp.height / bmp.width); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } catch { return ''; }
}
export const sceneTag = (sc) => (sc?.kind === 'gk3d' ? '<span class="gk3d-tag">3D (GK)</span>' : '');

const VER = '20261124a';
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
let loading = null;
const script = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('3D 엔진을 불러오지 못했어요')); document.head.appendChild(s); });
export function loadGK3D() {
  loading ||= (async () => {
    if (!document.querySelector('link[data-gk3d]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `css/gk3d.css?v=${VER}`; l.dataset.gk3d = '1'; document.head.appendChild(l); }
    if (!window.THREE) await script(THREE_URL);
    window.GK3D_BASE = 'gk3d/';
    if (!window.Tactics3D) await script(`js/gk3d/tactics3d.js?v=${VER}`);
    if (!window.Tactics3D) throw new Error('3D 엔진을 불러오지 못했어요');
    return window.Tactics3D;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('저장했어요 · 다운로드 폴더를 확인해 주세요');
}

// 상자 안에 3D (GK) 작전판 붙이기 — editable:false 면 보기만 (재생 · 크게 · 이미지 저장)
// 돌려주는 것: { getData, isEmpty, refresh } (불러오는 동안은 initial 그대로 돌려줌)
export function mountGK3D(box, initial = null, { editable = true, onChange = null, title = '3D (GK)' } = {}) {
  box.innerHTML = `<div class="gk3d ${editable ? '' : 'view'}">
    <div class="pad2-top"><div class="pitch-picker" data-k="angles" role="radiogroup" aria-label="경기장 각도"></div><div class="seg" data-k="turf" role="radiogroup" aria-label="경기장 색"></div></div>
    <div class="pad2-bar" role="toolbar" aria-label="3D 작전판 도구">
      <button type="button" class="tool tool-text" data-k="undo" data-k-edit title="되돌리기 (Ctrl+Z)">↶ 되돌리기</button>
      <button type="button" class="tool tool-text" data-k="redo" data-k-edit title="다시 하기 (Ctrl+Shift+Z)">↷ 다시</button>
      <span class="bar-sep" data-k-edit></span>
      <button type="button" class="tool tool-text play-btn" data-k="play" title="순서대로 재생 (Space)">▶ 재생</button>
      <button type="button" class="tool tool-text" data-k="full" title="크게 보기 (ESC로 나가기)">크게 보기</button>
      <span class="bar-grow"></span>
      <button type="button" class="tool tool-text" data-k="clear" data-k-edit>전체 지우기</button>
      <span class="bar-sep" data-k-edit></span>
      <button type="button" class="tool tool-text" data-k="shot" title="지금 보이는 보드를 사진(PNG)으로 저장">이미지 저장</button>
      <button type="button" class="tool tool-text" data-k="rec" data-k-edit title="움직임을 처음부터 재생하면서 영상으로 저장">영상 저장</button>
    </div>
    <div class="pad-stage" data-k="stage"><p class="pad-hint" data-k="hint"></p><div class="pad-fallback" data-k="fb">3D 선수 불러오는 중…</div></div>
    <div class="pad-palette" data-k="pal"></div>
  </div>`;
  initial = parse(initial);
  const root = box.firstElementChild, $k = (k) => root.querySelector(`[data-k="${k}"]`);
  let pad = null, T3 = null, active = false;
  const api = { getData: () => (pad ? pad.getState() : initial), isEmpty: () => (pad ? pad.isEmpty() : !initial || !(initial.items || []).length), refresh: () => pad?.refresh(), snapshot: () => pad?.snapshot(), ready: null };

  const syncUndo = () => { if (!pad) return; $k('undo').disabled = !pad.canUndo; $k('redo').disabled = !pad.canRedo; };
  const renderSegs = () => {
    if (!pad) return;
    const st = pad.state;
    $k('angles').innerHTML = Object.entries(T3.ANGLES).map(([id, a]) => `<button type="button" role="radio" aria-checked="${st.angle === id}" data-angle="${id}" title="${a.name}"><img src="${T3.boardImage({ angle: id, turf: st.turf }, 240, 150)}" alt="" /><span>${a.name}</span></button>`).join('');
    $k('turf').innerHTML = Object.entries(T3.TURFS).map(([id, n]) => `<button type="button" role="radio" data-turf="${id}" aria-checked="${st.turf === id}">${n}</button>`).join('');
    syncUndo();
  };
  const setFull = (on) => {
    root.classList.toggle('is-full', on); document.body.classList.toggle('gk3d-full', on);
    $k('full').textContent = on ? '작게 보기' : '크게 보기';
    requestAnimationFrame(() => pad?.refresh()); setTimeout(() => pad?.refresh(), 250);
  };

  api.ready = loadGK3D().then((t3) => {
    T3 = t3;
    $k('fb').hidden = true;
    pad = T3.createPad({
      stage: $k('stage'), palette: $k('pal'), hint: $k('hint'),
      onPlayChange: (on) => { $k('play').textContent = on ? '■ 정지' : '▶ 재생'; $k('play').classList.toggle('is-active', on); },
      onChange: () => { syncUndo(); onChange?.(); },
    });
    if (initial) { try { pad.load(initial); } catch { /* 예전 모양이면 빈 판 */ } }
    renderSegs();
    T3.ready.then(() => renderSegs());
    return api;
  }).catch((e) => { $k('fb').textContent = `${e.message} · 인터넷 연결을 확인한 뒤 새로고침해 주세요`; $k('fb').hidden = false; });

  root.addEventListener('pointerdown', () => { active = true; });
  document.addEventListener('pointerdown', (e) => { if (!root.contains(e.target)) active = false; }, true);
  $k('angles').addEventListener('click', (e) => { const b = e.target.closest('[data-angle]'); if (b && pad) { pad.setAngle(b.dataset.angle); renderSegs(); onChange?.(); } });
  $k('turf').addEventListener('click', (e) => { const b = e.target.closest('[data-turf]'); if (b && pad) { pad.setTurf(b.dataset.turf); renderSegs(); onChange?.(); } });
  $k('undo').onclick = () => { if (pad) { pad.undo(); renderSegs(); } };
  $k('redo').onclick = () => { if (pad) { pad.redo(); renderSegs(); } };
  $k('clear').onclick = () => pad?.clear();
  $k('full').onclick = () => setFull(!root.classList.contains('is-full'));
  $k('play').onclick = () => { if (!pad || pad.isRecording) return; if (!pad.play()) toast('선수나 공을 누르고 ＋ 다음 위치를 눌러, 움직일 순서를 먼저 만들어 주세요'); };
  $k('shot').onclick = async () => {
    if (!pad || pad.isRecording) return;
    if (pad.isEmpty()) { toast('먼저 보드에 선수나 선을 놓아 주세요'); return; }
    const blob = await pad.snapshot(); if (blob) saveFile(blob, `싸카매니저-3D-${stamp()}.png`);
  };
  $k('rec').onclick = async () => {
    if (!pad || pad.isRecording) return;
    if (!pad.canRecord()) { toast('이 브라우저는 영상 저장을 지원하지 않아요. 크롬이나 사파리 최신 버전에서 해 주세요'); return; }
    const job = pad.record();
    if (!job) { toast('선수나 공을 누르고 ＋ 다음 위치를 눌러, 움직일 순서를 먼저 만들어 주세요'); return; }
    const b = $k('rec'); b.disabled = true; b.textContent = '● 녹화 중…';
    const blob = await job; b.disabled = false; b.textContent = '영상 저장';
    saveFile(blob, `싸카매니저-3D-${stamp()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
  };
  // 단축키: 이 작전판을 마지막으로 눌렀을 때만
  const onKey = (e) => {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'Escape' && root.classList.contains('is-full')) { setFull(false); return; }
    if (!pad || !editable || !active || e.target.closest?.('input, textarea, select')) return;
    const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey;
    if (mod && k === 'z') { e.preventDefault(); (e.shiftKey ? pad.redo() : pad.undo()); renderSegs(); return; }
    if (mod && k === 'd') { e.preventDefault(); pad.duplicateSelected(); return; }
    if (mod && k === 'c' && !window.getSelection().toString()) { if (pad.copyToClip()) { e.preventDefault(); toast('복사했어요 · Ctrl+V로 붙여넣기'); } return; }
    if (mod && k === 'v') { e.preventDefault(); pad.pasteClip(); return; }
    if (k === ' ') { e.preventDefault(); $k('play').click(); return; }
    if (k === 'escape') { pad.escape(); return; }
    if ((k === 'delete' || k === 'backspace') && pad.hasSelection()) { e.preventDefault(); pad.deleteSelected(); }
  };
  document.addEventListener('keydown', onKey);
  return api;
}

// 화면 전체를 덮는 3D (GK) 창 — 전술보드 [3D (GK)] 버튼 · 보관은 이 기기에만 (그리던 것 이어 그리기)
export function openGK3DLayer({ keepKey = null, title = '3D (GK)', sub = '골키퍼 장면을 3D로 그려요 · 이미지 · 영상으로 저장' } = {}) {
  let init = null;
  if (keepKey) { try { init = JSON.parse(localStorage.getItem(keepKey) || 'null'); } catch { /* */ } }
  const layer = document.createElement('div');
  layer.className = 'gk3d-layer';
  layer.innerHTML = `<header><b>${title}</b><span class="muted">${sub}</span><span style="flex:1"></span><button type="button" class="btn ghost sm" data-close>닫기</button></header><div class="gk3d-body"><div data-box></div></div>`;
  document.body.appendChild(layer); document.body.style.overflow = 'hidden';
  let t = null;
  const keep = () => { if (!keepKey) return; clearTimeout(t); t = setTimeout(() => { try { localStorage.setItem(keepKey, JSON.stringify(api.getData())); } catch { /* */ } }, 400); };
  const api = mountGK3D(layer.querySelector('[data-box]'), init, { onChange: keep });
  const close = () => { keep(); if (keepKey && api.getData()) { try { localStorage.setItem(keepKey, JSON.stringify(api.getData())); } catch { /* */ } } layer.remove(); document.body.style.overflow = ''; document.body.classList.remove('gk3d-full'); removeEventListener('hashchange', close); };
  layer.querySelector('[data-close]').onclick = close;
  addEventListener('hashchange', close);
  return api;
}
