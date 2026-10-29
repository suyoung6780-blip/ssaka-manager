// 전술보드 (코치만) — 택티컬(자유 작전판) · 훈련 프로그램(우리 팀 코치진이 만든 훈련) + 아이들에게 크게 보여주는 '보여주기 모드'
// (훈련장의 일일 훈련 · 코치 훈련 정리는 trainingDaily.js)
import {
  db, collection, doc, query, where, orderBy, limit, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp,
} from '../fb.js';
import {
  esc, text, toast, fail, formData, modal, confirmBox, fmtDate, todayStr, pageHead, empty, resizeImage, kpiStrip, toDate,
} from '../ui.js';
import { state, isCoach, go } from '../store.js';
import { createPad, blank, FULL_DEF } from '../tactic.js';
import { keepDraft, fillFields, draftStrip } from '../drafts.js';

const AGES = ['U8', 'U10', 'U12', 'U15', 'U18', '성인'];
const PEOPLE = [['', '전체 인원'], ['1-6', '6명 이하'], ['7-12', '7~12명'], ['13-18', '13~18명'], ['19-99', '19명 이상']];
const SORTS = [['new', '최신 등록순'], ['date', '훈련일순'], ['title', '제목순']];
const VIEW_KEY = 'ssaka.trainingView';

const lines = (s) => String(s || '').split('\n').map((l) => l.replace(/^\s*[-•·\d.)]+\s*/, '').trim()).filter(Boolean);

function thumb(p) {
  if (p.image) return `<img src="${esc(p.image)}" alt="">`;
  if (p.pad) return '<div data-thumb-pad></div>';
  return `<div class="thumb-link"><span>◉</span><b>${esc(p.topics?.[0] || '훈련')}</b></div>`;
}

const meta = (p) => [
  p.ages?.length ? p.ages.join(' · ') : '',
  p.players ? `${p.players}명` : '',
  p.duration ? `${p.duration}분` : '',
].filter(Boolean).join('  ');

// 훈련장 상단 탭 (일일 훈련 / 코치 훈련 정리) — 훈련 프로그램은 전술보드로 옮김
export function trainingTabs(active) {
  // 선수는 일일 훈련만 (훈련 프로그램은 코치가 일일 훈련에 넣어 둔 것만 그 안에서 봄)
  const tabs = [['/training', '일일 훈련'], ...(isCoach() ? [['/training/notes', '코치 훈련 정리']] : [])];
  return `<nav class="tabs">${tabs.map(([h, l]) => `<a href="#${h}" class="${h === active ? 'on' : ''}">${l}</a>`).join('')}</nav>`;
}

// 전술보드 상단 탭 (택티컬 / 훈련 프로그램)
export function tacticsTabs(active, n) {
  const tabs = [['/tactics', '택티컬'], ['/tactics/programs', `훈련 프로그램${n != null ? ` <small>${n}</small>` : ''}`]];
  return `<nav class="tabs">${tabs.map(([h, l]) => `<a href="#${h}" class="${h === active ? 'on' : ''}">${l}</a>`).join('')}</nav>`;
}

// 이미지 · 영상으로 저장 버튼
export async function exportPad(kind, data, title, btn) {
  const { savePadImage, savePadVideo, canVideo } = await import('../padExport.js');
  const old = btn?.innerHTML;
  const lab = btn?.querySelector('.plab') || btn; // 작전판 도구 버튼이면 글자 칸만 바꿈
  try {
    if (btn) btn.disabled = true;
    if (kind === 'image') { await savePadImage(data, title); toast('이미지로 저장했어요.'); return; }
    if (!canVideo()) { toast('이 브라우저는 영상 저장을 지원하지 않아요. 크롬이나 사파리 최신 버전에서 해 주세요.'); return; }
    await savePadVideo(data, title, (f) => { if (lab) lab.textContent = `${lab === btn ? '녹화 중 ' : ''}${Math.round(f * 100)}%`; });
    toast('영상으로 저장했어요.');
  } catch (e) { fail(e); } finally { if (btn) { btn.disabled = false; btn.innerHTML = old; } }
}
export const padMoves = (pd) => !!pd && ((pd.steps || []).length > 0 || (pd.items || []).some((x) => x.k === 'arrow')) && pd.anim !== false;

// ───────── 택티컬: 마음대로 그리는 작전판 → 저장하면 훈련 프로그램으로 ─────────
const BOARD_KEY = () => `${state.team.id}/board`;
export async function board(el) {
  let n = null;
  try { n = (await loadPrograms()).length; } catch { /* */ }
  let init = null;
  try { init = JSON.parse(localStorage.getItem(`ssaka-pad:${BOARD_KEY()}`) || 'null')?.data || null; } catch { /* */ }
  el.innerHTML = `${pageHead('TACTICS BOARD', '전술보드')}
    ${tacticsTabs('/tactics', n)}
    <div class="tb-bar">
      <p class="muted small">마음대로 그리고 <b>훈련 프로그램으로 저장</b>하면 옆 칸 [훈련 프로그램]에 들어가요 · 그리던 것은 자동으로 보관돼요</p>
      <div class="tb-acts">
        <button class="btn ghost sm" data-tb-img>이미지로 저장</button>
        <button class="btn ghost sm" data-tb-vid>영상으로 저장</button>
        <button class="btn sm" data-tb-save>훈련 프로그램으로 저장</button>
      </div>
    </div>
    <div class="tb-pad" data-pad></div>`;
  const box = el.querySelector('[data-pad]');
  const fresh = () => { const d = blank('full'); [d.field.w, d.field.h] = FULL_DEF.h; return d; }; // 처음엔 경기장 전체 100×70 (경기장 버튼으로 반 코트 · 직접 크기)
  let pad = createPad(box, init || fresh(), { motion: true, draft: BOARD_KEY(), exportTitle: '작전판' });
  const vidBtn = el.querySelector('[data-tb-vid]');

  el.querySelector('[data-tb-img]').onclick = async (e) => {
    const img3d = await pad.image3d?.(); // 3D 보기면 3D 그림 그대로 저장
    if (img3d) { const a = document.createElement('a'); a.href = img3d; a.download = '작전판 (중계 화면).png'; document.body.appendChild(a); a.click(); a.remove(); toast('중계 화면 그대로 이미지로 저장했어요.'); return; }
    exportPad('image', pad.getData(), '작전판', e.currentTarget);
  };
  vidBtn.onclick = (e) => {
    if (!padMoves(pad.getData())) { toast('영상은 움직임이 있어야 해요 — 장면을 2개 이상 만들거나 화살표를 그려 주세요.'); return; }
    if (pad.video3d?.('작전판', e.currentTarget)) return; // 중계 화면이면 그대로 녹화
    exportPad('video', pad.getData(), '작전판', e.currentTarget);
  };
  el.querySelector('[data-tb-save]').onclick = () => editor({ pad: pad.getData() }, () => { pad.clearDraft(); go('/tactics/programs'); }, null, { lockPad: true });
}

export async function loadPrograms() {
  const snap = await getDocs(query(collection(db, 'teams', state.team.id, 'posts'), where('type', '==', 'training'), orderBy('createdAt', 'desc'), limit(300)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

let redrawDrafts = () => {}; // 훈련장 목록의 '만들다 만 훈련' 다시 그리기
export async function library(el) {
  const all = await loadPrograms();
  knownTopics = all.flatMap((x) => x.topics || []);
  const refresh = () => library(el);
  const f = { q: '', age: '', people: '', sort: 'new', view: 'grid' };
  try { f.view = localStorage.getItem(VIEW_KEY) || 'grid'; } catch { /* */ }

  el.innerHTML = `${pageHead('TACTICS BOARD', '전술보드')}
    ${tacticsTabs('/tactics/programs', all.length)}
    ${all.length ? (() => {
      const ym = todayStr().slice(0, 7);
      const tops = Object.entries(all.flatMap((x) => x.topics || []).reduce((m, t) => ({ ...m, [t]: (m[t] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const durs = all.map((x) => +x.duration).filter((x) => x > 0);
      return kpiStrip([
        { l: '훈련 프로그램', v: all.length, u: '개', s: `움직임 있는 것 <b>${all.filter((x) => (x.pad?.steps || []).length).length}</b>개` },
        { l: '이번 달 추가', v: all.filter((x) => { const d = toDate(x.createdAt); return d && todayStr(d).startsWith(ym); }).length, u: '개', c: 'var(--accent)' },
        { l: '평균 시간', v: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : '-', u: durs.length ? '분' : '' },
        { l: '많이 쓴 주제', v: tops[0] ? esc(tops[0][0]) : '-', s: tops.slice(1).map(([t, n]) => `${esc(t)} <b>${n}</b>`).join(' · ') || '&nbsp;' },
      ]);
    })() : ''}
    ${isCoach() ? '<div data-tdrafts hidden></div>' : ''}
    <div class="lib-bar">
      <input type="search" placeholder="제목 · 주제 · 내용 · 코칭 포인트 검색" data-q>
      <div class="lib-selects">
        <select data-age><option value="">전체 연령</option>${AGES.map((a) => `<option>${a}</option>`).join('')}</select>
        <select data-people>${PEOPLE.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <select data-sort>${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <div class="seg" data-view><button data-v="grid" title="카드">▦</button><button data-v="list" title="목록">☰</button></div>
      </div>
    </div>
    <p class="lib-count" data-count></p>
    <div data-list></div>`;

  const draw = () => {
    const q = f.q.toLowerCase();
    const [lo, hi] = f.people ? f.people.split('-').map(Number) : [0, 999];
    let rows = all.filter((p) => (!f.age || p.ages?.includes(f.age))
      && (!f.people || (+p.players >= lo && +p.players <= hi))
      && (!q || [p.title, (p.topics || []).join(' '), p.body, p.points, p.authorName].join(' ').toLowerCase().includes(q)));
    if (f.sort === 'date') rows = [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (f.sort === 'title') rows = [...rows].sort((a, b) => a.title.localeCompare(b.title, 'ko'));

    el.querySelector('[data-count]').textContent = `훈련 ${rows.length}개`;
    el.querySelectorAll('[data-view] button').forEach((b) => b.classList.toggle('on', b.dataset.v === f.view));
    const box = el.querySelector('[data-list]');
    if (!rows.length) {
      box.innerHTML = all.length ? empty('조건에 맞는 훈련이 없습니다.')
        : `<div class="tb-empty"><b>아직 훈련 프로그램이 없어요</b><p class="muted">[택티컬]에서 훈련을 그리고 <b>훈련 프로그램으로 저장</b>을 누르면 여기에 모여요. 만든 훈련은 일일 훈련에 넣거나 커뮤니티에 공유할 수 있어요.</p><a class="btn sm" href="#/tactics">택티컬에서 그리기</a></div>`;
      return;
    }
    box.innerHTML = f.view === 'grid'
      ? `<div class="lib-grid">${rows.map((p) => `
        <article class="lib-card" data-id="${p.id}">
          <div class="lib-thumb">${thumb(p)}</div>
          <div class="lib-body">
            <h3>${esc(p.title)}</h3>
            <div class="lib-tags">${(p.topics || []).slice(0, 2).map((t) => `<span class="ttag">${esc(t)}</span>`).join('')}${p.topics?.length > 2 ? `<span class="ttag more">+${p.topics.length - 2}</span>` : ''}<span class="lib-meta">${esc(meta(p))}</span></div>
            <div class="lib-foot"><span>${esc(p.authorName || '')}</span><span>${esc(p.date || fmtDate(p.createdAt))}</span></div>
          </div>
        </article>`).join('')}</div>`
      : `<ul class="lib-rows">${rows.map((p) => `
        <li data-id="${p.id}">
          <span class="date-badge">${esc((p.date || '').slice(5).replace('-', '.') || '-')}</span>
          <div><strong>${esc(p.title)}</strong><small>${esc((p.topics || []).join(' · '))}${meta(p) ? `  ·  ${esc(meta(p))}` : ''}</small></div>
        </li>`).join('')}</ul>`;
    box.querySelectorAll('[data-id]').forEach((c) => {
      const p = all.find((x) => x.id === c.dataset.id);
      const pad = c.querySelector('[data-thumb-pad]');
      if (pad) createPad(pad, p.pad, { editable: false, play: false });
      c.onclick = () => detail(p, refresh);
    });
  };

  el.querySelector('[data-q]').oninput = (e) => { f.q = e.target.value.trim(); draw(); };
  el.querySelector('[data-age]').onchange = (e) => { f.age = e.target.value; draw(); };
  el.querySelector('[data-people]').onchange = (e) => { f.people = e.target.value; draw(); };
  el.querySelector('[data-sort]').onchange = (e) => { f.sort = e.target.value; draw(); };
  el.querySelectorAll('[data-view] button').forEach((b) => (b.onclick = () => {
    f.view = b.dataset.v;
    try { localStorage.setItem(VIEW_KEY, f.view); } catch { /* */ }
    draw();
  }));
  const dbox = el.querySelector('[data-tdrafts]');
  redrawDrafts = () => {};
  if (dbox) redrawDrafts = draftStrip(dbox, `${state.team.id}/program`, {
    label: '만들다 만 훈련',
    onResume: (d) => editor(d.id.startsWith('new') ? null : all.find((x) => x.id === d.id) || null, refresh, d),
  });
  draw();
}

function visual(p, cls = '') {
  if (p.image) return `<img class="${cls}" src="${esc(p.image)}" alt="">`;
  if (p.pad) return `<div class="${cls}" data-pad></div>`;
  return '';
}

export function detail(p, refresh) {
  const pts = lines(p.points);
  const m = modal(`
    <div class="tr-detail">
      <span class="eyebrow">TRAINING · ${esc(p.date || fmtDate(p.createdAt))}</span>
      <h2>${esc(p.title)}</h2>
      <div class="lib-tags">${(p.topics || []).map((t) => `<span class="ttag">${esc(t)}</span>`).join('')}</div>
      <div class="tr-facts">
        ${p.ages?.length ? `<div><small>연령</small><b>${esc(p.ages.join(' · '))}</b></div>` : ''}
        ${p.players ? `<div><small>인원</small><b>${esc(p.players)}명</b></div>` : ''}
        ${p.duration ? `<div><small>시간</small><b>${esc(p.duration)}분</b></div>` : ''}
        ${p.space ? `<div><small>공간</small><b>${esc(p.space)}</b></div>` : ''}
      </div>
      ${visual(p, 'tr-visual')}
      <div class="row"><button class="btn" data-present>▶ 선수들에게 보여주기</button>${p.pad ? `<button class="btn ghost" data-ximg>이미지로 저장</button>${padMoves(p.pad) ? '<button class="btn ghost" data-xvid>영상으로 저장</button>' : ''}` : ''}</div>
      ${p.body ? `<h4>훈련 방법</h4><div class="prose">${text(p.body)}</div>` : ''}
      ${pts.length ? `<h4>코칭 포인트</h4><ol class="points">${pts.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
      ${isCoach() ? '<div class="row end"><button class="btn ghost" data-share-cm>커뮤니티에 공유</button><button class="btn ghost" data-del>삭제</button><button class="btn ghost" data-edit>수정</button></div>' : ''}
    </div>`, { wide: true });
  const padBox = m.el.querySelector('[data-pad]');
  if (padBox) createPad(padBox, p.pad, { editable: false });
  m.el.querySelector('[data-present]').onclick = () => present(p);
  m.el.querySelector('[data-ximg]')?.addEventListener('click', (e) => exportPad('image', p.pad, p.title, e.currentTarget));
  m.el.querySelector('[data-xvid]')?.addEventListener('click', (e) => exportPad('video', p.pad, p.title, e.currentTarget));
  m.el.querySelector('[data-edit]')?.addEventListener('click', () => { m.close(); editor(p, refresh); });
  m.el.querySelector('[data-share-cm]')?.addEventListener('click', async () => { m.close(); (await import('./community.js')).shareProgram(p); });
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmBox('이 훈련을 삭제할까요?'))) return;
    try { await deleteDoc(doc(db, 'teams', state.team.id, 'posts', p.id)); m.close(); refresh(); } catch (e) { fail(e); }
  });
}

// 보여주기 모드 — 전체화면, 큰 그림 + 큰 글씨
export function present(p) {
  const pts = lines(p.points);
  const wrap = document.createElement('div');
  wrap.className = 'present';
  wrap.innerHTML = `
    <header><div><span class="eyebrow">${esc((p.topics || []).join(' · ') || 'TRAINING')}</span><h1>${esc(p.title)}</h1></div>
      <div class="present-facts">${[p.players && `${p.players}명`, p.duration && `${p.duration}분`, p.space].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
      <button class="icon-btn" data-close aria-label="닫기">✕</button></header>
    <div class="present-body ${visual(p) ? '' : 'no-visual'}">
      ${visual(p) ? `<div class="present-visual">${visual(p)}</div>` : ''}
      <div class="present-side">
        ${pts.length ? `<h2>이것만 기억하자!</h2><ol>${pts.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
        ${!pts.length && p.body ? `<div class="present-text">${text(p.body)}</div>` : ''}
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const padBox = wrap.querySelector('[data-pad]');
  const pad = padBox ? createPad(padBox, p.pad, { editable: false }) : null;
  if (pad?.hasMotion()) wrap.insertAdjacentHTML('beforeend', '<div class="present-keys"><kbd>Space</kbd> · <kbd>Enter</kbd> · <kbd>→</kbd> 움직임 재생 · <kbd>←</kbd> 처음으로</div>');
  const close = () => {
    document.removeEventListener('keydown', onKey);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    wrap.remove();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (!pad?.hasMotion()) return;
    if ([' ', 'Enter', 'ArrowRight', 'ArrowDown'].includes(e.key)) { e.preventDefault(); pad.play(); }
    else if (['ArrowLeft', 'ArrowUp'].includes(e.key)) { e.preventDefault(); pad.reset(); }
  };
  document.addEventListener('keydown', onKey);
  state.cleanup.push(close); // 뒤로가기 · 다른 화면으로 가면 같이 닫힘 (아이폰은 전체 화면이 없어서 남아 있던 문제)
  wrap.querySelector('[data-close]').onclick = close;
  wrap.requestFullscreen?.().catch(() => {});
  document.addEventListener('fullscreenchange', function f() {
    if (!document.fullscreenElement) { document.removeEventListener('fullscreenchange', f); if (wrap.isConnected) close(); }
  });
}

let knownTopics = [];

// lockPad: 택티컬에서 그린 그림을 그대로 저장 (여기서는 미리보기만 — 고치기는 훈련 프로그램에서 [수정])
export function editor(p, refresh, dr = null, { lockPad = false } = {}) {
  p ||= {};
  const m = modal(`
    <span class="eyebrow">TRAINING</span><h2>${p.id ? '훈련 수정' : '훈련 올리기'}</h2>
    <form class="stack">
      <label>제목<input name="title" required maxlength="80" value="${esc(p.title || '')}" placeholder="예) 써드맨 4v2 론도"></label>
      <label>훈련 주제 <small class="muted">쉼표(,)로 여러 개 — 예) 론도, 압박 탈출, 빌드업</small>
        <input name="topics" maxlength="120" value="${esc((p.topics || []).join(', '))}" list="topic-suggest" autocomplete="off"></label>
      <datalist id="topic-suggest">${[...new Set(knownTopics)].map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      <fieldset><legend>연령</legend>
        <div class="pick-chips">${AGES.map((a) => `<label><input type="checkbox" name="ages" value="${a}" ${p.ages?.includes(a) ? 'checked' : ''}><span>${a}</span></label>`).join('')}</div>
      </fieldset>
      <div class="grid4">
        <label>훈련일<input type="date" name="date" value="${esc(p.date || todayStr())}"></label>
        <label>인원<input type="number" name="players" min="1" max="99" value="${esc(p.players || '')}"></label>
        <label>시간 (분)<input type="number" name="duration" min="1" max="240" value="${esc(p.duration || '')}"></label>
        <label>공간<input name="space" maxlength="30" value="${esc(p.space || '')}" placeholder="20×30m"></label>
      </div>
      <div class="img-pick">
        <div data-img-preview>${p.image ? `<img src="${esc(p.image)}" alt="">` : ''}</div>
        <div><label class="btn ghost sm">그림 올리기<input type="file" accept="image/*" hidden data-img></label>
          <small class="muted">사진·이미지 (선택) — 올리면 작전판 대신 썸네일과 보여주기 화면에 나옵니다</small>
          ${p.image ? '<button type="button" class="link-btn small" data-img-rm>그림 빼기</button>' : ''}</div>
      </div>
      ${lockPad ? '<div class="tb-preview"><small class="muted">택티컬에서 그린 그림</small><div data-pad-lock></div></div>' : `<label class="switch"><input type="checkbox" data-use-pad ${p.pad || !p.id ? 'checked' : ''}><span>작전판 그리기</span></label>
      <div data-pad></div>`}
      <label>훈련 방법<textarea name="body" rows="5" placeholder="조직 · 규칙 · 진행 순서">${esc(p.body || '')}</textarea></label>
      <label>코칭 포인트 <small class="muted">한 줄에 하나 — 보여주기 모드에서 크게 나옵니다</small>
        <textarea name="points" rows="4" placeholder="공 받기 전에 어깨 너머 확인하기&#10;첫 터치는 다음 패스 방향으로">${esc(p.points || '')}</textarea></label>
      <div class="row end"><button class="btn">${p.id ? '저장' : '올리기'}</button></div>
    </form>`, { wide: true });

  const form = m.el.querySelector('form');
  if (dr) fillFields(form, dr.fields);
  let image = p.image || '';
  form.querySelector('[data-img]').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    image = await resizeImage(file, 1024, false);
    form.querySelector('[data-img-preview]').innerHTML = `<img src="${image}" alt="">`;
  };
  form.querySelector('[data-img-rm]')?.addEventListener('click', (e) => {
    image = '';
    form.querySelector('[data-img-preview]').innerHTML = '';
    e.target.remove();
  });

  let pad = null;
  const padBox = form.querySelector('[data-pad]');
  const usePad = form.querySelector('[data-use-pad]');
  const lockBox = form.querySelector('[data-pad-lock]');
  if (lockBox) createPad(lockBox, p.pad, { editable: false, play: false });
  const padNow = () => (lockPad ? p.pad : usePad.checked && pad ? pad.getData() : null);
  const syncPad = () => {
    if (!usePad) return;
    if (usePad.checked && !pad) pad = createPad(padBox, dr?.pad || p.pad || { ...blank('custom'), grid: { preset: 'none', cols: 0, rows: 0 } }, { motion: true, onChange: () => keep.touch(), exportTitle: () => form.querySelector('[name=title]').value.trim() || '훈련' });
    padBox.hidden = !usePad.checked;
  };
  if (dr && dr.pad && usePad) usePad.checked = true;
  const keep = keepDraft(form, { scope: `${state.team.id}/program`, id: p.id, key: dr?.key, getPad: padNow });
  // 닫으면 바로 보관 · 목록의 '만들다 만 훈련' 새로 그림
  m.onClose = () => { keep.close(); if (document.querySelector('[data-tdrafts]')?.isConnected) redrawDrafts(); };
  if (usePad) usePad.onchange = syncPad;
  syncPad();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button.btn:not([type])');
    btn.disabled = true;
    const d = formData(form);
    const data = {
      type: 'training', title: d.title.trim(), date: d.date, players: d.players, duration: d.duration, space: d.space,
      body: d.body, points: d.points, image,
      topics: [...new Set(d.topics.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 8),
      ages: [...form.querySelectorAll('[name=ages]:checked')].map((x) => x.value),
      pad: padNow(),
    };
    try {
      const col = collection(db, 'teams', state.team.id, 'posts');
      if (p.id) await updateDoc(doc(col, p.id), { ...data, updatedAt: serverTimestamp(), updatedBy: state.profile.name });
      else await addDoc(col, { ...data, authorUid: state.user.uid, authorName: state.profile.name, createdAt: serverTimestamp() });
      keep.clear();
      pad?.clearDraft();
      m.close();
      toast(lockPad ? '훈련 프로그램에 저장했어요.' : '저장했습니다.');
      refresh();
    } catch (err) { fail(err); btn.disabled = false; }
  };
}
