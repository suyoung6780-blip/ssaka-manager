// 훈련장 > 훈련 프로그램 — 작전판 라이브러리 + 아이들에게 크게 보여주는 '보여주기 모드'
// (일일 훈련 · 코치 훈련 정리는 trainingDaily.js)
import {
  db, collection, doc, query, where, orderBy, limit, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp,
} from '../fb.js';
import {
  esc, text, toast, fail, formData, modal, confirmBox, fmtDate, todayStr, pageHead, empty, resizeImage,
} from '../ui.js';
import { state, isCoach } from '../store.js';
import { createPad, blank } from '../tactic.js';

const AGES = ['U8', 'U10', 'U12', 'U15', 'U18', '성인'];
const PEOPLE = [['', '전체 인원'], ['1-6', '6명 이하'], ['7-12', '7~12명'], ['13-18', '13~18명'], ['19-99', '19명 이상']];
const SORTS = [['new', '최신 등록순'], ['date', '훈련일순'], ['title', '제목순']];
const VIEW_KEY = 'ssaka.trainingView';

const lines = (s) => String(s || '').split('\n').map((l) => l.replace(/^\s*[-•·\d.)]+\s*/, '').trim()).filter(Boolean);

function thumb(p) {
  if (p.image) return `<img src="${esc(p.image)}" alt="">`;
  if (p.pad) return '<div data-thumb-pad></div>';
  return `<div class="thumb-link"><span>⚽</span><b>${esc(p.topics?.[0] || '훈련')}</b></div>`;
}

const meta = (p) => [
  p.ages?.length ? p.ages.join(' · ') : '',
  p.players ? `${p.players}명` : '',
  p.duration ? `${p.duration}분` : '',
].filter(Boolean).join('  ');

// 훈련장 상단 탭 (일일 훈련 / 코치 훈련 정리 / 훈련 프로그램)
export function trainingTabs(active) {
  // 선수는 일일 훈련만 (훈련 프로그램은 코치가 일일 훈련에 넣어 둔 것만 그 안에서 봄)
  const tabs = [['/training', '일일 훈련'], ...(isCoach() ? [['/training/notes', '코치 훈련 정리'], ['/training/library', '훈련 프로그램']] : [])];
  return `<nav class="tabs">${tabs.map(([h, l]) => `<a href="#${h}" class="${h === active ? 'on' : ''}">${l}</a>`).join('')}</nav>`;
}

export async function loadPrograms() {
  const snap = await getDocs(query(collection(db, 'teams', state.team.id, 'posts'), where('type', '==', 'training'), orderBy('createdAt', 'desc'), limit(300)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function library(el) {
  const all = await loadPrograms();
  knownTopics = all.flatMap((x) => x.topics || []);
  const refresh = () => library(el);
  const f = { q: '', age: '', people: '', sort: 'new', view: 'grid' };
  try { f.view = localStorage.getItem(VIEW_KEY) || 'grid'; } catch { /* */ }

  el.innerHTML = `${pageHead('TRAINING GROUND', '훈련장', isCoach() ? '<button class="btn" data-new>+ 프로그램 만들기</button>' : '')}
    ${trainingTabs('/training/library')}
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
      box.innerHTML = empty(all.length ? '조건에 맞는 훈련이 없습니다.' : '아직 등록된 훈련이 없습니다.');
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
      if (pad) createPad(pad, p.pad, { editable: false });
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
  el.querySelector('[data-new]')?.addEventListener('click', () => editor(null, refresh));
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
      <div class="row"><button class="btn" data-present>▶ 선수들에게 보여주기</button></div>
      ${p.body ? `<h4>훈련 방법</h4><div class="prose">${text(p.body)}</div>` : ''}
      ${pts.length ? `<h4>코칭 포인트</h4><ol class="points">${pts.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
      ${isCoach() ? '<div class="row end"><button class="btn ghost" data-del>삭제</button><button class="btn ghost" data-edit>수정</button></div>' : ''}
    </div>`, { wide: true });
  const padBox = m.el.querySelector('[data-pad]');
  if (padBox) createPad(padBox, p.pad, { editable: false });
  m.el.querySelector('[data-present]').onclick = () => present(p);
  m.el.querySelector('[data-edit]')?.addEventListener('click', () => { m.close(); editor(p, refresh); });
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
  if (padBox) createPad(padBox, p.pad, { editable: false });
  const close = () => {
    document.removeEventListener('keydown', onKey);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    wrap.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('[data-close]').onclick = close;
  wrap.requestFullscreen?.().catch(() => {});
  document.addEventListener('fullscreenchange', function f() {
    if (!document.fullscreenElement) { document.removeEventListener('fullscreenchange', f); if (wrap.isConnected) close(); }
  });
}

let knownTopics = [];

export function editor(p, refresh) {
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
      <label class="switch"><input type="checkbox" data-use-pad ${p.pad || !p.id ? 'checked' : ''}><span>작전판 그리기</span></label>
      <div data-pad></div>
      <label>훈련 방법<textarea name="body" rows="5" placeholder="조직 · 규칙 · 진행 순서">${esc(p.body || '')}</textarea></label>
      <label>코칭 포인트 <small class="muted">한 줄에 하나 — 보여주기 모드에서 크게 나옵니다</small>
        <textarea name="points" rows="4" placeholder="공 받기 전에 어깨 너머 확인하기&#10;첫 터치는 다음 패스 방향으로">${esc(p.points || '')}</textarea></label>
      <div class="row end"><button class="btn">${p.id ? '저장' : '올리기'}</button></div>
    </form>`, { wide: true });

  const form = m.el.querySelector('form');
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
  const syncPad = () => {
    if (usePad.checked && !pad) pad = createPad(padBox, p.pad || { ...blank('custom'), grid: { preset: 'none', cols: 0, rows: 0 } });
    padBox.hidden = !usePad.checked;
  };
  usePad.onchange = syncPad;
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
      pad: usePad.checked && pad ? pad.getData() : null,
    };
    try {
      const col = collection(db, 'teams', state.team.id, 'posts');
      if (p.id) await updateDoc(doc(col, p.id), { ...data, updatedAt: serverTimestamp() });
      else await addDoc(col, { ...data, authorUid: state.user.uid, authorName: state.profile.name, createdAt: serverTimestamp() });
      m.close();
      toast('저장했습니다.');
      refresh();
    } catch (err) { fail(err); btn.disabled = false; }
  };
}
