// 미팅룸 · 공지사항 · 스케줄 — teams/{id}/posts 에 type 으로 구분해 저장 (훈련장은 training.js)
import {
  db, storage, collection, doc, query, where, orderBy, limit, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
  serverTimestamp, storageRef, uploadBytes, getDownloadURL,
} from '../fb.js';
import {
  esc, text, toast, fail, formData, modal, confirmBox, fmtDate, todayStr, pageHead, empty, options,
} from '../ui.js';
import { STORAGE_ENABLED } from '../config.js';
import { state, isCoach } from '../store.js';
import { createPad, formationData } from '../tactic.js';

const TYPES = {
  meeting: { en: 'MEETING ROOM', ko: '미팅룸', desc: '미팅 자료', files: true, dated: true },
  notice: { en: 'NOTICE', ko: '공지사항', desc: '' },
  schedule: { en: 'SCHEDULE', ko: '스케줄', desc: '훈련 · 경기 · 미팅 일정' },
};
const KINDS = ['훈련', '경기', '미팅', '휴식', '기타'];
// 스케줄 색은 세 가지만: 경기 · 훈련 · 그 외
const SCHED_COLORS = [['경기', '#ef4444'], ['훈련', '#3b82f6'], ['그 외', '#8a8a8a']];
const schedColor = (p) => (p.kind === '경기' ? '#ef4444' : p.kind === '훈련' ? '#3b82f6' : '#8a8a8a');
const schedKey = (p) => (p.kind === '경기' || p.kind === '훈련' ? p.kind : '그 외');


export const page = (type) => async (el) => {
  const cfg = TYPES[type];
  const col = collection(db, 'teams', state.team.id, 'posts');
  const q = type === 'schedule'
    ? query(col, where('type', '==', type), orderBy('date', 'desc'), limit(300))
    : query(col, where('type', '==', type), orderBy('createdAt', 'desc'), limit(60));
  const snap = await getDocs(q);
  const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const refresh = () => page(type)(el);

  el.innerHTML = `${pageHead(cfg.en, cfg.ko, isCoach() ? '<button class="btn" data-new>+ 새로 작성</button>' : '')}
    ${cfg.desc ? `<p class="lead">${cfg.desc}</p>` : ''}
    <div data-body></div>`;
  el.querySelector('[data-new]')?.addEventListener('click', () => editor(type, null, refresh));

  const body = el.querySelector('[data-body]');
  if (type === 'schedule') return renderSchedule(body, posts, refresh);

  if (type === 'notice') posts.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  body.innerHTML = posts.length ? `<div class="post-grid">${posts.map((p) => `
    <article class="post-card ${p.pinned ? 'pinned' : ''}" data-id="${p.id}">
      ${cfg.pad && p.pad ? '<div class="thumb-pad" data-thumb></div>' : ''}
      <div class="post-meta">${p.pinned ? '<span class="tag">고정</span>' : ''}${p.opponent ? `<span class="tag">vs ${esc(p.opponent)}</span>` : ''}<small>${esc(p.date || fmtDate(p.createdAt))}</small></div>
      <h3>${esc(p.title)}</h3>
      <p>${esc((p.body || '').slice(0, 90))}</p>
      ${p.files?.length ? `<small class="muted">첨부 ${p.files.length}개</small>` : ''}
    </article>`).join('')}</div>` : empty('아직 등록된 글이 없습니다.');

  body.querySelectorAll('.post-card').forEach((card) => {
    const p = posts.find((x) => x.id === card.dataset.id);
    const thumb = card.querySelector('[data-thumb]');
    if (thumb) createPad(thumb, p.pad, { editable: false, play: false });
    card.onclick = () => detail(type, p, refresh);
  });
};

function renderSchedule(body, all, refresh) {
  let cur = new Date();
  cur.setDate(1);
  let only = ''; // 범례에서 고른 종류만 보기
  let pickDate = todayStr();
  const notes = all.filter((p) => p.isNote); // 달별 비고
  const posts = all.filter((p) => !p.isNote);
  const groups = [...new Set(posts.map((p) => p.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const draw = () => {
    const y = cur.getFullYear();
    const m = cur.getMonth();
    const month = `${y}-${String(m + 1).padStart(2, '0')}`;
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const key = (d) => todayStr(new Date(y, m, d));
    const shown = posts.filter((p) => !only || schedKey(p) === only);
    const byDay = {};
    shown.forEach((p) => { (byDay[p.date] ||= []).push(p); });
    const cells = [];
    for (let i = 0; i < first; i++) cells.push('<div class="cal-cell off"></div>');
    for (let d = 1; d <= days; d++) {
      const items = (byDay[key(d)] || []).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      cells.push(`<div class="cal-cell ${key(d) === todayStr() ? 'today' : ''} ${key(d) === pickDate ? 'picked' : ''}" data-day="${key(d)}"><span class="d">${d}</span>
        ${items.map((p) => `<button class="cal-item" style="--c:${schedColor(p)}" data-id="${p.id}">${esc(p.time || '')} ${p.group ? `[${esc(p.group)}] ` : ''}${esc(p.title)}</button>`).join('')}</div>`);
    }
    const monthList = shown.filter((p) => p.date?.startsWith(month))
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const note = notes.find((x) => x.month === month);
    body.innerHTML = `
      <div class="sched-bar">
        <div class="legend">${SCHED_COLORS.map(([l, c]) => `<button class="lg ${only === l ? 'on' : ''}" data-only="${l}"><i style="background:${c}"></i>${l}</button>`).join('')}
          ${only ? '<button class="link-btn small" data-only="">전체 보기</button>' : ''}</div>
      </div>
      <div class="cal-head"><button class="icon-btn" data-prev>‹</button><h2>${y}. ${m + 1}</h2><button class="icon-btn" data-next>›</button></div>
      <div class="cal">${['일', '월', '화', '수', '목', '금', '토'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}${cells.join('')}</div>
      <section class="card sched-note">
        <div class="card-head"><h3>비고 · ${m + 1}월</h3>${note?.updatedBy ? `<small class="muted">${esc(note.updatedBy)} 작성</small>` : ''}</div>
        ${isCoach() ? `<textarea rows="4" data-note placeholder="이 달 스케줄과 같이 볼 내용을 적어주세요. 예) 10/14 우천 시 실내 훈련 · 원정 버스 7:30 출발 · 시험 기간 훈련 조정">${esc(note?.body || '')}</textarea>
          <div class="row end"><button class="btn sm" data-save-note>비고 저장</button></div>`
          : note?.body ? `<div class="prose">${text(note.body)}</div>` : '<p class="muted">이 달 비고가 없습니다.</p>'}
      </section>
      <h2 class="sec-title">${m + 1}월 일정 <small>${monthList.length}</small></h2>
      <ul class="list sched-list">${monthList.map((p) => `
        <li data-id="${p.id}" style="--c:${schedColor(p)}"><span class="date-badge">${esc(p.date.slice(5).replace('-', '.'))}</span>
        <div><strong>${p.group ? `[${esc(p.group)}] ` : ''}${esc(p.title)}</strong><small>${esc([p.time, p.kind, p.place].filter(Boolean).join(' · '))}${p.body ? ` · ${esc(p.body.slice(0, 40))}` : ''}</small></div></li>`).join('') || '<li class="muted">이번 달 일정이 없습니다.</li>'}</ul>
      ${isCoach() ? `<form class="card sched-add">
        <div class="card-head"><h3>스케줄 작성</h3><small class="muted">달력에서 날짜를 누르면 그 날짜로 바뀌어요</small></div>
        <div class="sched-add-grid">
          <label>날짜<input type="date" name="date" required value="${pickDate}"></label>
          <label>시간<input type="time" name="time"></label>
          <label>종류<select name="kind">${options(KINDS)}</select></label>
          <label>학년 · 그룹<input name="group" maxlength="12" list="sched-groups" placeholder="예) U12 · 5학년"></label>
          <label class="wide">제목<input name="title" required maxlength="60" placeholder="예) 리그 7라운드 vs 수원FC"></label>
          <label class="wide">장소<input name="place" maxlength="40"></label>
          <label class="full">메모<textarea name="body" rows="2" placeholder="집합 시간 · 준비물 · 이동 방법 등"></textarea></label>
        </div>
        <datalist id="sched-groups">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
        <div class="row end"><button class="btn">스케줄 추가</button></div>
      </form>` : ''}`;
    body.querySelector('[data-prev]').onclick = () => { cur.setMonth(cur.getMonth() - 1); draw(); };
    body.querySelector('[data-next]').onclick = () => { cur.setMonth(cur.getMonth() + 1); draw(); };
    body.querySelectorAll('[data-only]').forEach((b) => (b.onclick = () => { only = only === b.dataset.only ? '' : b.dataset.only; draw(); }));
    body.querySelectorAll('[data-id]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); detail('schedule', posts.find((p) => p.id === b.dataset.id), refresh); }));
    body.querySelectorAll('[data-day]').forEach((c) => (c.onclick = () => {
      pickDate = c.dataset.day;
      body.querySelectorAll('.cal-cell.picked').forEach((x) => x.classList.remove('picked'));
      c.classList.add('picked');
      const f = body.querySelector('.sched-add');
      if (f) { f.date.value = pickDate; f.title.focus(); }
    }));
    body.querySelector('[data-save-note]')?.addEventListener('click', async () => {
      const text2 = body.querySelector('[data-note]').value;
      try {
        // 달마다 문서 하나 (팀 전체가 봄, 달력에는 안 나옴)
        await setDoc(doc(db, 'teams', state.team.id, 'posts', `note-${month}`), {
          type: 'schedule', isNote: true, month, date: `${month}-00`, title: `${m + 1}월 비고`, body: text2,
          updatedBy: state.profile.name, updatedAt: serverTimestamp(),
        }, { merge: true });
        const ex = notes.find((x) => x.month === month);
        if (ex) ex.body = text2; else notes.push({ month, body: text2, updatedBy: state.profile.name });
        toast('비고를 저장했습니다.');
      } catch (err) { fail(err); }
    });
    const form = body.querySelector('.sched-add');
    if (form) form.onsubmit = async (e) => {
      e.preventDefault();
      const d = formData(form);
      try {
        await addDoc(collection(db, 'teams', state.team.id, 'posts'), {
          type: 'schedule', date: d.date, time: d.time, kind: d.kind, group: d.group.trim(), title: d.title.trim(), place: d.place.trim(), body: d.body,
          authorUid: state.user.uid, authorName: state.profile.name, createdAt: serverTimestamp(),
        });
        toast('스케줄을 추가했습니다.');
        refresh();
      } catch (err) { fail(err); }
    };
  };
  draw();
}

function detail(type, p, refresh) {
  const cfg = TYPES[type];
  const m = modal(`
    <span class="eyebrow">${cfg.en}${p.kind ? ` · ${esc(p.kind)}` : ''}</span>
    <h2>${esc(p.title)}</h2>
    <div class="post-meta"><small>${esc([p.date, p.time, p.place].filter(Boolean).join(' · ') || fmtDate(p.createdAt))}</small>${p.opponent ? `<span class="tag">vs ${esc(p.opponent)}</span>` : ''}<small>${esc(p.authorName || '')}</small></div>
    ${p.body ? `<div class="prose">${text(p.body)}</div>` : ''}
    ${p.pad ? '<div data-pad></div>' : ''}
    ${p.files?.length ? `<ul class="files">${p.files.map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">↓ ${esc(f.name)}</a></li>`).join('')}</ul>` : ''}
    ${p.link ? `<p><a href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.link)} ↗</a></p>` : ''}
    ${p.links?.length ? `<ul class="files">${p.links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">🔗 ${esc(l.name || l.url)}</a></li>`).join('')}</ul>` : ''}
    ${isCoach() ? '<div class="row end"><button class="btn ghost" data-del>삭제</button><button class="btn" data-edit>수정</button></div>' : ''}`, { wide: !!p.pad });

  if (p.pad) createPad(m.el.querySelector('[data-pad]'), p.pad, { editable: false });
  m.el.querySelector('[data-edit]')?.addEventListener('click', () => { m.close(); editor(type, p, refresh); });
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmBox('삭제할까요?'))) return;
    try { await deleteDoc(doc(db, 'teams', state.team.id, 'posts', p.id)); m.close(); refresh(); } catch (e) { fail(e); }
  });
}

function editor(type, p, refresh) {
  const cfg = TYPES[type];
  p ||= {};
  const m = modal(`
    <span class="eyebrow">${cfg.en}</span><h2>${p.id ? '수정' : '새로 작성'}</h2>
    <form class="stack">
      ${type === 'schedule' ? `
        <div class="grid2">
          <label>날짜<input type="date" name="date" required value="${esc(p.date || todayStr())}"></label>
          <label>시간<input type="time" name="time" value="${esc(p.time || '')}"></label>
          <label>구분<select name="kind">${options(KINDS, p.kind)}</select></label>
          <label>장소<input name="place" value="${esc(p.place || '')}"></label>
          <label>학년 · 그룹 <small class="muted">(선택)</small><input name="group" maxlength="12" value="${esc(p.group || '')}" placeholder="예) U12 · 5학년 · 1군"></label>
        </div>` : ''}
      <label>제목<input name="title" required maxlength="80" value="${esc(p.title || '')}"></label>
      ${cfg.dated ? `<label>날짜<input type="date" name="date" value="${esc(p.date || todayStr())}"></label>` : ''}
      <label>내용<textarea name="body" rows="6">${esc(p.body || '')}</textarea></label>
      ${type === 'notice' ? `<label class="switch"><input type="checkbox" name="pinned" ${p.pinned ? 'checked' : ''}><span>상단 고정</span></label>` : ''}
      ${cfg.files ? `
        ${STORAGE_ENABLED ? `
        <label>링크<input name="link" type="url" value="${esc(p.link || '')}" placeholder="구글 드라이브 등"></label>
        <label>파일 첨부 (PDF · PPT · 이미지 등, 각 50MB 이하)<input type="file" name="files" multiple></label>
        ${p.files?.length ? `<small class="muted">기존 첨부 ${p.files.length}개 유지</small>` : ''}` : `
        <fieldset class="links-box"><legend>자료 링크 <small class="muted">구글 드라이브 · 원드라이브 · 유튜브 등 — 링크를 받은 사람만 열 수 있게 공유 설정</small></legend>
          <div data-links>${[...(p.links || []), ...(p.link ? [{ name: '', url: p.link }] : []), {}].map((l) => `<div class="link-row"><input name="lname" placeholder="이름 (예: 전술 PPT)" value="${esc(l.name || '')}"><input name="lurl" type="url" placeholder="https://drive.google.com/…" value="${esc(l.url || '')}"></div>`).join('')}</div>
          <button type="button" class="link-btn small" data-addlink>+ 링크 추가</button>
        </fieldset>`}` : ''}
      ${cfg.pad ? `
        <label class="switch"><input type="checkbox" data-use-pad ${p.pad ? 'checked' : ''}><span>텍티컬 패드 사용</span></label>
        <div data-pad></div>` : ''}
      <div class="row end"><button class="btn">${p.id ? '저장' : '등록'}</button></div>
    </form>`, { wide: !!cfg.pad });

  let pad = null;
  const padBox = m.el.querySelector('[data-pad]');
  const usePad = m.el.querySelector('[data-use-pad]');
  const syncPad = () => {
    if (usePad.checked && !pad) pad = createPad(padBox, p.pad || formationData('4-3-3', false));
    padBox.hidden = !usePad.checked;
  };
  if (usePad) { usePad.onchange = syncPad; syncPad(); }
  m.el.querySelector('[data-addlink]')?.addEventListener('click', () => {
    m.el.querySelector('[data-links]').insertAdjacentHTML('beforeend', '<div class="link-row"><input name="lname" placeholder="이름 (예: 전술 PPT)"><input name="lurl" type="url" placeholder="https://drive.google.com/…"></div>');
  });

  const form = m.el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button.btn');
    btn.disabled = true;
    const d = formData(form);
    delete d.files; delete d.lname; delete d.lurl;
    if (cfg.files && !STORAGE_ENABLED) {
      const names = [...form.querySelectorAll('[name=lname]')].map((x) => x.value.trim());
      d.links = [...form.querySelectorAll('[name=lurl]')].map((x, i) => ({ name: names[i], url: x.value.trim() })).filter((l) => /^https?:\/\//.test(l.url));
      d.link = '';
    }
    const data = { ...d, type, pinned: !!d.pinned };
    if (cfg.pad) data.pad = usePad.checked && pad ? pad.getData() : null;
    try {
      if (cfg.files && STORAGE_ENABLED) {
        const uploaded = [];
        for (const f of form.files.files) {
          if (f.size > 50 * 1024 * 1024) { toast(`${f.name}: 50MB 초과`); continue; }
          const r = storageRef(storage, `teams/${state.team.id}/meeting/${Date.now()}_${f.name}`);
          await uploadBytes(r, f);
          uploaded.push({ name: f.name, size: f.size, url: await getDownloadURL(r) });
        }
        data.files = [...(p.files || []), ...uploaded];
      }
      const col = collection(db, 'teams', state.team.id, 'posts');
      if (p.id) await updateDoc(doc(col, p.id), { ...data, updatedAt: serverTimestamp() });
      else await addDoc(col, { ...data, authorUid: state.user.uid, authorName: state.profile.name, createdAt: serverTimestamp() });
      m.close();
      toast('저장했습니다.');
      refresh();
    } catch (err) { fail(err); btn.disabled = false; }
  };
}
