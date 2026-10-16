// 만들다 만 것 임시 보관 (이 기기에만) — 새로 만들 때마다 따로 남아서, 여러 개를 만들다 나가도 전부 이어서 할 수 있어요
// 보관: localStorage 'ssaka-draft:{scope}/{id}' = { at, fields: 입력칸 값, pad: 작전판 }
// 예전 방식(작전판만 'ssaka-pad:{scope}/{id}')으로 남은 것도 같이 보여줘요
import { esc } from './ui.js';

const P = 'ssaka-draft:';
const LEGACY = 'ssaka-pad:';

export function listDrafts(scope) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const pre = [P, LEGACY].find((x) => k.startsWith(`${x}${scope}/`));
      if (!pre) continue;
      const v = JSON.parse(localStorage.getItem(k) || 'null');
      if (!v) continue;
      const id = k.slice(`${pre}${scope}/`.length);
      out.push(pre === P ? { key: k, id, at: v.at, fields: v.fields || {}, pad: v.pad || null } : { key: k, id, at: v.at, fields: {}, pad: v.data || null });
    }
  } catch { /* 저장소를 못 쓰면 빈 목록 */ }
  return out.sort((a, b) => b.at - a.at);
}

export function dropDraft(key) {
  try { localStorage.removeItem(key); } catch { /* */ }
}

// 입력칸 값 읽기 · 채우기 (체크박스는 고른 값 목록)
function readFields(form) {
  const f = {};
  form.querySelectorAll('input[name], select[name], textarea[name]').forEach((x) => {
    if (x.type === 'file' || x.type === 'submit') return;
    if (x.type === 'checkbox') { (f[x.name] ||= []); if (x.checked) f[x.name].push(x.value); return; }
    if (x.type === 'radio') { if (x.checked) f[x.name] = x.value; return; }
    f[x.name] = x.value;
  });
  return f;
}
export function fillFields(form, f = {}) {
  Object.entries(f).forEach(([name, v]) => {
    form.querySelectorAll(`[name="${CSS.escape(name)}"]`).forEach((x) => {
      if (x.type === 'checkbox') x.checked = Array.isArray(v) && v.includes(x.value);
      else if (x.type === 'radio') x.checked = x.value === v;
      else if (x.type !== 'file') x.value = v ?? '';
    });
  });
}

// 폼(+작전판)을 고칠 때마다 보관 · 저장하면 clear()
// key: 이어서 하는 임시저장의 key (없으면 새 칸) · id: 기존 글 id (없으면 새로 만들기)
export function keepDraft(form, { scope, id = null, key = null, getPad = null }) {
  const k = key && key.startsWith(P) ? key : `${P}${scope}/${id || `new-${Date.now().toString(36)}`}`;
  if (key && key !== k) dropDraft(key); // 예전 방식 → 새 방식으로 옮김
  let t = null;
  let dirty = !!key; // 이어서 하는 중이면 닫을 때도 다시 보관
  let done = false;
  const save = () => {
    clearTimeout(t); t = null;
    if (!dirty || done) return;
    try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), fields: readFields(form), pad: getPad?.() || null })); } catch { /* 보관 못 해도 그냥 진행 */ }
  };
  const touch = () => { if (done) return; dirty = true; clearTimeout(t); t = setTimeout(save, 700); };
  form.addEventListener('input', touch);
  form.addEventListener('change', touch);
  window.addEventListener('pagehide', save);
  return {
    key: k, touch, save,
    clear: () => { done = true; clearTimeout(t); dropDraft(k); window.removeEventListener('pagehide', save); },
    close: () => { save(); done = true; window.removeEventListener('pagehide', save); }, // 창을 닫을 때: 마지막으로 보관하고 끝
  };
}

// 목록 위 '임시저장' 줄: [제목 · 시간] [이어서] [버리기]
export function draftStrip(box, scope, { titleOf = (d) => d.fields.title, onResume, label = '임시저장' }) {
  const render = () => {
    const ds = listDrafts(scope);
    box.hidden = !ds.length;
    if (!ds.length) { box.innerHTML = ''; return; }
    const when = (at) => { const t = new Date(at); return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };
    box.innerHTML = `<div class="draft-strip"><b>${label} ${ds.length}개</b><small class="muted">저장하지 않고 나간 것 · 이 기기에만 남아 있어요</small>
      <ul>${ds.map((d) => `<li><span>${esc((titleOf(d) || '').trim() || '(제목 없음)')}${d.id.startsWith('new') ? '' : ' <span class="tag">수정 중</span>'}</span><small class="muted">${when(d.at)}</small>
        <button type="button" class="chip on" data-dres="${esc(d.key)}">이어서</button><button type="button" class="chip" data-ddel="${esc(d.key)}">버리기</button></li>`).join('')}</ul></div>`;
    box.querySelectorAll('[data-dres]').forEach((b) => (b.onclick = () => onResume(ds.find((d) => d.key === b.dataset.dres))));
    box.querySelectorAll('[data-ddel]').forEach((b) => (b.onclick = () => { dropDraft(b.dataset.ddel); render(); }));
  };
  render();
  return render;
}
