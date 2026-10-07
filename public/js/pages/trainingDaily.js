// 훈련장 > 일일 훈련 (선수들에게 날짜별 훈련 안내) · 코치 훈련 정리 (코치만)
import {
  db, collection, doc, query, where, orderBy, limit, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp,
} from '../fb.js';
import { esc, text, toast, fail, formData, modal, confirmBox, todayStr, pageHead, empty, options } from '../ui.js';
import { state, isCoach } from '../store.js';
import { createPad } from '../tactic.js';
import { trainingTabs, loadPrograms, present } from './training.js';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const fmtDay = (s) => { const d = new Date(`${s}T00:00`); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`; };
const addDays = (s, n) => { const d = new Date(`${s}T00:00`); d.setDate(d.getDate() + n); return todayStr(d); };
const weekStart = (s) => { const d = new Date(`${s}T00:00`); return addDays(s, -((d.getDay() + 6) % 7)); }; // 월요일 시작

// 주간 날짜 선택 바 — 기록 있는 날에 점 표시
function weekNav(box, { selected, marked, onPick }) {
  const draw = (anchor) => {
    const start = weekStart(anchor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const today = todayStr();
    box.innerHTML = `
      <div class="week">
        <button class="icon-btn" data-wk="-7" aria-label="이전 주">‹</button>
        <div class="week-days">${days.map((d) => `
          <button class="wday ${d === selected ? 'on' : ''} ${d === today ? 'today' : ''}" data-day="${d}">
            <small>${DOW[new Date(`${d}T00:00`).getDay()]}</small><b>${+d.slice(8)}</b><i class="${marked.has(d) ? 'dot' : ''}"></i>
          </button>`).join('')}</div>
        <button class="icon-btn" data-wk="7" aria-label="다음 주">›</button>
        <div class="week-jump"><button class="btn ghost sm" data-today>오늘</button><input type="date" value="${selected}" data-jump></div>
      </div>`;
    box.querySelectorAll('[data-wk]').forEach((b) => (b.onclick = () => draw(addDays(anchor, +b.dataset.wk))));
    box.querySelectorAll('[data-day]').forEach((b) => (b.onclick = () => onPick(b.dataset.day)));
    box.querySelector('[data-today]').onclick = () => onPick(today);
    box.querySelector('[data-jump]').onchange = (e) => e.target.value && onPick(e.target.value);
  };
  draw(selected);
}

const recentList = (rows, label, sel) => (rows.length ? `
  <h2 class="sec-title">${label}</h2>
  <ul class="list day-list">${rows.map((r) => `
    <li data-go="${r.date}" class="${r.date === sel ? 'on' : ''}"><span class="date-badge">${esc(r.date.slice(5).replace('-', '.'))}</span>
      <div><strong>${esc(r.title || r.summary || '')}</strong><small>${esc(r.sub || '')}</small></div></li>`).join('')}</ul>` : '');

// ───────── 일일 훈련 (선수용) ─────────
let dailySel = null;

export async function daily(el) {
  const tid = state.team.id;
  const [snap, programs] = await Promise.all([
    getDocs(query(collection(db, 'teams', tid, 'posts'), where('type', '==', 'daily'), orderBy('date', 'desc'), limit(200))),
    loadPrograms(),
  ]);
  const plans = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const progMap = Object.fromEntries(programs.map((p) => [p.id, p]));
  const refresh = () => daily(el);
  dailySel ||= todayStr();

  el.innerHTML = `${pageHead('TRAINING GROUND', '훈련장')}
    ${trainingTabs('/training')}
    <div data-week></div>
    <div data-dayview></div>
    <div data-recent></div>`;

  const draw = () => {
    weekNav(el.querySelector('[data-week]'), {
      selected: dailySel, marked: new Set(plans.map((p) => p.date)), onPick: (d) => { dailySel = d; draw(); },
    });
    const todays = plans.filter((p) => p.date === dailySel).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const box = el.querySelector('[data-dayview]');
    box.innerHTML = `
      <div class="day-head"><h2>${fmtDay(dailySel)}${dailySel === todayStr() ? ' <span class="tag solid">오늘</span>' : ''}</h2>
        ${isCoach() ? '<button class="btn" data-new>+ 이 날 훈련 쓰기</button>' : ''}</div>
      ${todays.length ? todays.map((p) => planCard(p, progMap)).join('') : empty(isCoach() ? '이 날 훈련 안내가 없습니다. 선수들이 볼 훈련 내용을 적어주세요.' : '이 날은 등록된 훈련이 없습니다.')}`;
    box.querySelectorAll('[data-plan]').forEach((card) => {
      const p = plans.find((x) => x.id === card.dataset.plan);
      card.querySelectorAll('[data-board]').forEach((b) => {
        const prog = progMap[b.dataset.board];
        if (prog?.pad) createPad(b, prog.pad, { editable: false });
      });
      card.querySelectorAll('[data-show]').forEach((b) => (b.onclick = () => present(progMap[b.dataset.show])));
      card.querySelector('[data-edit]')?.addEventListener('click', () => planEditor(p, programs, refresh));
      card.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmBox('이 훈련 안내를 삭제할까요?'))) return;
        try { await deleteDoc(doc(db, 'teams', tid, 'posts', p.id)); refresh(); } catch (e) { fail(e); }
      });
    });
    box.querySelector('[data-new]')?.addEventListener('click', () => planEditor({ date: dailySel }, programs, refresh));

    const recent = el.querySelector('[data-recent]');
    recent.innerHTML = recentList(plans.slice(0, 20).map((p) => ({
      date: p.date, title: p.title, sub: [p.time, p.place, `${(p.blocks || []).length}개 훈련`].filter(Boolean).join(' · '),
    })), '훈련 일지', dailySel);
    recent.querySelectorAll('[data-go]').forEach((li) => (li.onclick = () => { dailySel = li.dataset.go; draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  };
  draw();
}

function planCard(p, progMap) {
  const total = (p.blocks || []).reduce((s, b) => s + (+b.min || 0), 0);
  return `
  <article class="plan" data-plan="${p.id}">
    <header class="plan-head">
      <div>
        <h3>${esc(p.title || '훈련')}</h3>
        <div class="plan-meta">${[p.time && `⏰ ${p.time}`, p.place && `📍 ${p.place}`, total && `총 ${total}분`].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
      </div>
      ${isCoach() ? '<div class="row"><button class="btn ghost sm" data-edit>수정</button><button class="btn ghost sm" data-del>삭제</button></div>' : ''}
    </header>
    ${p.goal ? `<div class="plan-goal"><small>오늘의 목표</small><p>${text(p.goal)}</p></div>` : ''}
    ${(p.blocks || []).length ? `<ol class="blocks">${p.blocks.map((b, i) => {
      const prog = progMap[b.programId];
      return `<li>
        <span class="bno">${i + 1}</span>
        <div class="bmain">
          <div class="btitle"><strong>${esc(b.name || prog?.title || '')}</strong>${b.min ? `<span class="tag">${esc(b.min)}분</span>` : ''}</div>
          ${b.desc ? `<p>${text(b.desc)}</p>` : ''}
          ${prog ? `<button class="link-btn small" data-show="${prog.id}">▶ 크게 보기</button>` : ''}
        </div>
        ${prog?.image ? `<img class="bthumb" src="${esc(prog.image)}" alt="">` : prog?.pad ? `<div class="bthumb" data-board="${prog.id}"></div>` : ''}
      </li>`;
    }).join('')}</ol>` : ''}
    ${p.gear || p.memo ? `<div class="plan-foot">
      ${p.gear ? `<div><small>준비물</small><p>${text(p.gear)}</p></div>` : ''}
      ${p.memo ? `<div><small>전달 사항</small><p>${text(p.memo)}</p></div>` : ''}
    </div>` : ''}
  </article>`;
}

function planEditor(p, programs, refresh) {
  const blocks = p.blocks?.length ? p.blocks : [{}];
  const progOpts = [['', '— 훈련 프로그램 불러오기 (선택) —'], ...programs.map((x) => [x.id, x.title])];
  const blockRow = (b = {}) => `
    <div class="brow">
      <div class="brow-top">
        <select data-prog>${options(progOpts, b.programId || '')}</select>
        <input data-name placeholder="훈련 이름" value="${esc(b.name || '')}">
        <input data-min type="number" min="1" max="180" placeholder="분" value="${esc(b.min || '')}">
        <button type="button" class="icon-btn sm" data-rm aria-label="빼기">✕</button>
      </div>
      <textarea data-desc rows="2" placeholder="선수들이 알아야 할 설명">${esc(b.desc || '')}</textarea>
    </div>`;
  const m = modal(`
    <span class="eyebrow">DAILY TRAINING</span><h2>${p.id ? '훈련 안내 수정' : '훈련 안내 쓰기'}</h2>
    <p class="muted small">선수들이 훈련장 &gt; 일일 훈련에서 날짜별로 봅니다.</p>
    <form class="stack">
      <div class="grid4">
        <label>날짜<input type="date" name="date" required value="${esc(p.date || todayStr())}"></label>
        <label>집합 시간<input type="time" name="time" value="${esc(p.time || '')}"></label>
        <label class="span2c">장소<input name="place" maxlength="40" value="${esc(p.place || '')}"></label>
      </div>
      <label>제목<input name="title" required maxlength="60" value="${esc(p.title || '')}" placeholder="예) 화요일 오후 훈련 — 빌드업 집중"></label>
      <label>오늘의 목표<textarea name="goal" rows="2" placeholder="예) 압박 받을 때 몸 열고 받기">${esc(p.goal || '')}</textarea></label>
      <fieldset><legend>훈련 순서</legend>
        <div data-blocks>${blocks.map(blockRow).join('')}</div>
        <button type="button" class="btn ghost sm" data-add>+ 훈련 추가</button>
      </fieldset>
      <div class="grid2">
        <label>준비물<textarea name="gear" rows="2" placeholder="예) 축구화, 정강이 보호대, 물">${esc(p.gear || '')}</textarea></label>
        <label>전달 사항<textarea name="memo" rows="2">${esc(p.memo || '')}</textarea></label>
      </div>
      <div class="row end"><button class="btn">${p.id ? '저장' : '올리기'}</button></div>
    </form>`, { wide: true });

  const form = m.el.querySelector('form');
  const list = form.querySelector('[data-blocks]');
  form.querySelector('[data-add]').onclick = () => list.insertAdjacentHTML('beforeend', blockRow());
  list.addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.brow').remove(); });
  // 프로그램을 고르면 이름·시간·설명 채우기
  list.addEventListener('change', (e) => {
    if (!e.target.matches('[data-prog]')) return;
    const prog = programs.find((x) => x.id === e.target.value);
    const row = e.target.closest('.brow');
    if (!prog) return;
    if (!row.querySelector('[data-name]').value) row.querySelector('[data-name]').value = prog.title;
    if (!row.querySelector('[data-min]').value && prog.duration) row.querySelector('[data-min]').value = prog.duration;
    if (!row.querySelector('[data-desc]').value && prog.points) row.querySelector('[data-desc]').value = prog.points;
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(form);
    const data = {
      type: 'daily', date: d.date, time: d.time, place: d.place.trim(), title: d.title.trim(), goal: d.goal, gear: d.gear, memo: d.memo,
      blocks: [...list.querySelectorAll('.brow')].map((r) => ({
        programId: r.querySelector('[data-prog]').value,
        name: r.querySelector('[data-name]').value.trim(),
        min: r.querySelector('[data-min]').value,
        desc: r.querySelector('[data-desc]').value,
      })).filter((b) => b.name || b.programId || b.desc),
    };
    try {
      const col = collection(db, 'teams', state.team.id, 'posts');
      if (p.id) await updateDoc(doc(col, p.id), { ...data, updatedAt: serverTimestamp() });
      else await addDoc(col, { ...data, authorUid: state.user.uid, authorName: state.profile.name, createdAt: serverTimestamp() });
      dailySel = data.date;
      m.close();
      toast('저장했습니다.');
      refresh();
    } catch (err) { fail(err); }
  };
}

// ───────── 코치 훈련 정리 (코치만) ─────────
let noteSel = null;
const NOTE_FIELDS = [
  ['done', '진행한 훈련'],
  ['good', '잘된 점'],
  ['improve', '보완할 점'],
  ['players', '선수 메모 (칭찬 · 부상 · 특이사항)'],
  ['next', '다음 훈련에 반영할 것'],
];

export async function notes(el) {
  const tid = state.team.id;
  const [ns, ps] = await Promise.all([
    getDocs(query(collection(db, 'teams', tid, 'coachNotes'), orderBy('date', 'desc'), limit(200))),
    getDocs(query(collection(db, 'teams', tid, 'posts'), where('type', '==', 'daily'), orderBy('date', 'desc'), limit(200))),
  ]);
  const list = ns.docs.map((d) => ({ id: d.id, ...d.data() }));
  const plans = ps.docs.map((d) => ({ id: d.id, ...d.data() }));
  const refresh = () => notes(el);
  noteSel ||= todayStr();

  el.innerHTML = `${pageHead('TRAINING GROUND', '훈련장')}
    ${trainingTabs('/training/notes')}
    <p class="lead">코치들만 볼 수 있는 훈련 정리 공간입니다. 선수에게는 보이지 않습니다.</p>
    <div data-week></div>
    <div data-dayview></div>
    <div data-recent></div>`;

  const draw = () => {
    weekNav(el.querySelector('[data-week]'), {
      selected: noteSel, marked: new Set(list.map((n) => n.date)), onPick: (d) => { noteSel = d; draw(); },
    });
    const dayNotes = list.filter((n) => n.date === noteSel);
    const dayPlans = plans.filter((p) => p.date === noteSel);
    const box = el.querySelector('[data-dayview]');
    box.innerHTML = `
      <div class="day-head"><h2>${fmtDay(noteSel)}</h2><button class="btn" data-new>+ 훈련 정리 쓰기</button></div>
      ${dayPlans.length ? `<div class="plan-ref"><small>이 날 선수 안내</small>${dayPlans.map((p) => `<span><b>${esc(p.title)}</b> : ${(p.blocks || []).map((b) => esc(b.name)).filter(Boolean).join(' → ')}</span>`).join('')}</div>` : ''}
      ${dayNotes.length ? dayNotes.map((n) => `
        <article class="note" data-note="${n.id}">
          <header class="plan-head"><div><h3>${esc(n.authorName)} 코치</h3>
            <div class="plan-meta">${[n.attend && `참가 ${n.attend}명`, n.intensity && `강도 ${n.intensity}/10 ${'■'.repeat(Math.min(10, +n.intensity))}${'□'.repeat(Math.max(0, 10 - n.intensity))}`].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div></div>
            <div class="row"><button class="btn ghost sm" data-edit>수정</button><button class="btn ghost sm" data-del>삭제</button></div></header>
          <div class="note-grid">${NOTE_FIELDS.filter(([k]) => n[k]).map(([k, l]) => `<div><small>${l}</small><p>${text(n[k])}</p></div>`).join('')}</div>
        </article>`).join('') : empty('이 날 작성한 훈련 정리가 없습니다.')}`;
    box.querySelector('[data-new]').onclick = () => noteEditor({ date: noteSel }, dayPlans, refresh);
    box.querySelectorAll('[data-note]').forEach((c) => {
      const n = list.find((x) => x.id === c.dataset.note);
      c.querySelector('[data-edit]').onclick = () => noteEditor(n, plans.filter((p) => p.date === n.date), refresh);
      c.querySelector('[data-del]').onclick = async () => {
        if (!(await confirmBox('이 훈련 정리를 삭제할까요?'))) return;
        try { await deleteDoc(doc(db, 'teams', tid, 'coachNotes', n.id)); refresh(); } catch (e) { fail(e); }
      };
    });
    const recent = el.querySelector('[data-recent]');
    recent.innerHTML = recentList(list.slice(0, 20).map((n) => ({
      date: n.date, title: (n.done || '').split('\n')[0] || '훈련 정리', sub: `${n.authorName} 코치${n.attend ? ` · 참가 ${n.attend}명` : ''}`,
    })), '지난 훈련 정리', noteSel);
    recent.querySelectorAll('[data-go]').forEach((li) => (li.onclick = () => { noteSel = li.dataset.go; draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  };
  draw();
}

function noteEditor(n, dayPlans, refresh) {
  const prefill = n.done ?? dayPlans.flatMap((p) => (p.blocks || []).map((b) => b.name)).filter(Boolean).join('\n');
  const m = modal(`
    <span class="eyebrow">COACH NOTE</span><h2>${n.id ? '훈련 정리 수정' : '훈련 정리'}</h2>
    <form class="stack">
      <div class="grid2">
        <label>날짜<input type="date" name="date" required value="${esc(n.date || todayStr())}"></label>
        <label>참가 인원<input type="number" name="attend" min="0" max="99" value="${esc(n.attend || '')}"></label>
      </div>
      <fieldset><legend>훈련 강도 <small class="muted">1 회복 · 3 가벼움 · 5 보통 · 7 높음 · 10 최고</small></legend>
        <div class="scale">${Array.from({ length: 10 }, (_, i) => i + 1).map((v) => `
          <label><input type="radio" name="intensity" value="${v}" ${String(n.intensity) === String(v) ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
      </fieldset>
      ${NOTE_FIELDS.map(([k, l]) => `<label>${l}<textarea name="${k}" rows="${k === 'done' ? 3 : 2}">${esc(k === 'done' ? prefill : n[k] || '')}</textarea></label>`).join('')}
      <div class="row end"><button class="btn">저장</button></div>
    </form>`, { wide: true });
  m.el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    try {
      const col = collection(db, 'teams', state.team.id, 'coachNotes');
      if (n.id) await updateDoc(doc(col, n.id), { ...d, updatedAt: serverTimestamp() });
      else await addDoc(col, { ...d, authorUid: state.user.uid, authorName: state.profile.name, createdAt: serverTimestamp() });
      noteSel = d.date;
      m.close();
      toast('저장했습니다.');
      refresh();
    } catch (err) { fail(err); }
  };
}
