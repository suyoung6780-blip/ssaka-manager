import {
  db, collection, doc, query, where, orderBy, limit, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp,
} from '../fb.js';
import { $, esc, text, toast, fail, fmtDate, pageHead, empty, avatar, modal, confirmBox, CATEGORIES, normCat } from '../ui.js';
import { state, go, isCoach } from '../store.js';

// ───────── 오른쪽 팀 검색 패널 ─────────
let teamCache = null;

export function searchPanel(el) {
  let cat = '전체';
  let q = '';
  el.innerHTML = `
    <div class="search-head"><span class="eyebrow">TEAM SEARCH</span><h3>팀 검색</h3></div>
    <input type="search" placeholder="팀 이름 검색" data-q>
    <div class="chips wrap" data-cats>${['전체', ...CATEGORIES].map((c) => `<button class="chip ${c === cat ? 'active' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>
    <ul class="team-results" data-results><li class="muted">불러오는 중…</li></ul>`;

  const draw = () => {
    const list = (teamCache || [])
      .filter((t) => (cat === '전체' || normCat(t.category) === cat) && (!q || t.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    el.querySelector('[data-results]').innerHTML = list.length ? list.map((t) => `
      <li><a href="#/teams/${t.id}"><span class="cat">${esc(normCat(t.category))}</span><strong>${esc(t.name)}</strong>
      <span class="lock"></span></a></li>`).join('') : '<li class="muted">검색 결과가 없습니다.</li>';
  };
  el.querySelector('[data-q]').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  el.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => {
    cat = b.dataset.cat;
    el.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('active', x === b));
    draw();
  }));

  getDocs(query(collection(db, 'teams'), where('status', '==', 'active')))
    .then((s) => { teamCache = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => !t.hidden || t.id === state.team?.id); draw(); }) // 숨긴 팀(심사 · 시험용)은 목록에 안 나옴
    .catch(fail);
}

// ───────── 스카우트 대상: 바로 아래 연령 팀 선수만 ─────────
const scoutCol = () => collection(db, 'teams', state.team.id, 'scouts');

// ───────── 다른 팀 보기: 팀 이름 · 대표 · 연락하기만 (선수단 · 팀 안 내용은 서로 못 봄) ─────────
export async function teamView(el, { id }) {
  const t = await getDoc(doc(db, 'teams', id));
  if (!t.exists()) { el.innerHTML = empty('존재하지 않는 팀입니다.'); return; }
  const team = { id, ...t.data() };
  const mine = state.team?.id === id;
  const me = state.user.uid;
  // 다른 팀과는 '팀 계정'(팀 대표)으로만 연락 — 코치만
  const canContact = !mine && isCoach() && team.ownerUid && team.ownerUid !== me;
  el.innerHTML = `<header class="hero team-hero">
    <span class="eyebrow">${esc(normCat(team.category))}</span>
    <h1>${esc(team.name)}</h1>
    <div class="kv"><span>팀 대표</span><strong>${esc(team.ownerName || '-')}${team.ownerName ? ' 지도자' : ''}</strong></div>
    ${canContact ? '<div class="row"><button class="btn" data-contact>팀에 연락하기</button></div>' : ''}
    ${mine ? '<div class="row"><a class="btn ghost" href="#/locker">우리 팀 락커룸 보기 →</a></div>' : ''}
  </header>
  ${!mine ? '<p class="muted small">다른 팀의 선수단과 팀 안 내용은 볼 수 없어요. 연락하기를 누르면 그 팀 대표 지도자와 1:1 대화가 열려요.</p>' : ''}`;
  el.querySelector('[data-contact]')?.addEventListener('click', () => startTeamChat(team));
}

// ───────── 스카웃 노트 — 우리 팀 지도자끼리만 보는 선수 메모 (상대 선수 · 팀에는 아무것도 안 감) ─────────
const SC_STATUS = [['review', '검토 중'], ['confirm', '확정'], ['hold', '보류'], ['drop', '제외']];
const SC_LABEL = Object.fromEntries(SC_STATUS);
let scFilter = 'all';

export async function scout(el) {
  const s = await getDocs(query(scoutCol(), orderBy('createdAt', 'desc')));
  const list = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  const stOf = (m) => (SC_LABEL[m.status] ? m.status : 'review');
  const cnt = (k) => list.filter((m) => stOf(m) === k).length;
  el.innerHTML = `${pageHead('SCOUT NOTE', '스카웃 노트', '<button class="btn" data-new>+ 선수 추가</button>')}
    <p class="lead">눈여겨본 선수의 이름 · 소속 · 장점 · 단점을 적어 두고 <b>확정 · 보류</b>를 체크해요. <b>우리 팀 지도자끼리만</b> 보이고, 선수나 다른 팀에는 아무것도 가지 않아요.</p>
    <div class="chips wrap sc-filter" data-scf>${[['all', '전체', list.length], ...SC_STATUS.map(([k, l]) => [k, l, cnt(k)])].map(([k, l, n]) => `<button type="button" class="chip ${scFilter === k ? 'active' : ''}" data-f="${k}">${l} <b>${n}</b></button>`).join('')}</div>
    <div class="scout-list" data-list></div>`;
  const draw = () => {
    const rows = list.filter((m) => scFilter === 'all' || stOf(m) === scFilter);
    el.querySelectorAll('[data-scf] [data-f]').forEach((b) => b.classList.toggle('active', b.dataset.f === scFilter));
    el.querySelector('[data-list]').innerHTML = rows.length ? rows.map((m) => `
      <article class="card scout st-${stOf(m)}" data-id="${m.id}">
        <div class="scout-body">
          <div class="sc-top"><h3>${esc(m.name)} ${m.position ? `<small>${esc(m.position)}</small>` : ''}</h3><span class="sc-badge">${SC_LABEL[stOf(m)]}</span></div>
          <small class="muted">${[m.affiliation || m.teamName, m.birthYear && `${m.birthYear}년생`, m.height && `${m.height}cm`, m.weight && `${m.weight}kg`].filter(Boolean).map(esc).join(' · ') || '소속 미입력'}</small>
          ${m.strengths ? `<p><b>장점</b> ${text(m.strengths)}</p>` : ''}
          ${m.weaknesses ? `<p><b>단점 · 보완점</b> ${text(m.weaknesses)}</p>` : ''}
          ${m.note ? `<p><b>메모</b> ${text(m.note)}</p>` : ''}
          <div class="sc-status" role="group" aria-label="상태">${SC_STATUS.map(([k, l]) => `<button type="button" class="chip ${stOf(m) === k ? 'active' : ''}" data-st="${k}">${l}</button>`).join('')}</div>
          <small class="muted">${esc(m.updatedBy || m.noteBy || m.by || '')} · ${fmtDate(m.updatedAt || m.noteAt || m.createdAt, true)}</small>
        </div>
        <div class="scout-actions"><button class="btn ghost sm" data-edit>고치기</button><button class="link-btn small" data-del>삭제</button></div>
      </article>`).join('') : empty(list.length ? '이 상태의 선수가 없어요.' : '아직 적어 둔 선수가 없어요. <b>+ 선수 추가</b>로 첫 선수를 적어 보세요.');
    el.querySelectorAll('.scout').forEach((c) => {
      const m = list.find((x) => x.id === c.dataset.id);
      c.querySelectorAll('[data-st]').forEach((b) => (b.onclick = async () => {
        try {
          await updateDoc(doc(scoutCol(), m.id), { status: b.dataset.st, updatedBy: state.profile.name, updatedAt: serverTimestamp() });
          m.status = b.dataset.st; m.updatedBy = state.profile.name; m.updatedAt = { toMillis: () => Date.now() };
          toast(`${m.name} 선수: ${SC_LABEL[b.dataset.st]}`); scout(el);
        } catch (err) { fail(err); }
      }));
      c.querySelector('[data-edit]').onclick = () => scoutForm(m, () => scout(el));
      c.querySelector('[data-del]').onclick = async () => {
        if (!(await confirmBox(`${m.name} 선수 노트를 지울까요? 되돌릴 수 없어요.`))) return;
        try { await deleteDoc(doc(scoutCol(), m.id)); scout(el); } catch (err) { fail(err); }
      };
    });
  };
  el.querySelectorAll('[data-scf] [data-f]').forEach((b) => (b.onclick = () => { scFilter = b.dataset.f; draw(); }));
  el.querySelector('[data-new]').onclick = () => scoutForm({}, () => scout(el));
  draw();
}

function scoutForm(m, done) {
  const md = modal(`<span class="eyebrow">SCOUT NOTE</span><h2>${m.id ? '선수 노트 고치기' : '선수 추가'}</h2>
    <form class="stack">
      <div class="grid2">
        <label>이름<input name="name" required maxlength="30" value="${esc(m.name || '')}" placeholder="예) 김민준"></label>
        <label>소속<input name="affiliation" maxlength="40" value="${esc(m.affiliation || m.teamName || '')}" placeholder="예) 한빛초 6학년 · OO FC U12"></label>
        <label>포지션<input name="position" maxlength="10" value="${esc(m.position || '')}" placeholder="예) LW"></label>
        <label>출생연도<input name="birthYear" inputmode="numeric" maxlength="4" value="${esc(m.birthYear || '')}" placeholder="예) 2014"></label>
      </div>
      <label>장점<textarea name="strengths" rows="3" maxlength="1000" placeholder="예) 왼발 드리블, 1v1 자신감, 스피드">${esc(m.strengths || '')}</textarea></label>
      <label>단점 · 보완점<textarea name="weaknesses" rows="3" maxlength="1000" placeholder="예) 수비 가담 부족, 오른발 약함">${esc(m.weaknesses || '')}</textarea></label>
      <label>메모 <small class="muted">(본 경기 · 연락 계획 등)</small><textarea name="note" rows="2" maxlength="1000">${esc(m.note || '')}</textarea></label>
      <fieldset><legend>상태</legend><div class="pick-chips">${SC_STATUS.map(([k, l]) => `<label><input type="radio" name="status" value="${k}" ${(m.status || 'review') === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
      <div class="row end"><button class="btn">${m.id ? '저장' : '추가'}</button></div>
    </form>`);
  md.el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const data = {
      name: f.name.value.trim(), affiliation: f.affiliation.value.trim(), position: f.position.value.trim(), birthYear: f.birthYear.value.trim(),
      strengths: f.strengths.value.trim(), weaknesses: f.weaknesses.value.trim(), note: f.note.value.trim(), status: f.status.value,
      updatedBy: state.profile.name, updatedAt: serverTimestamp(),
    };
    try {
      if (m.id) await updateDoc(doc(scoutCol(), m.id), data);
      else await addDoc(scoutCol(), { ...data, by: state.profile.name, createdAt: serverTimestamp() });
      md.close(); toast(m.id ? '고쳤어요.' : `${data.name} 선수를 추가했어요.`); done();
    } catch (err) { fail(err); }
  };
}

// ───────── 대화: 우리 팀원끼리 · 다른 팀은 팀 계정과만 ─────────
const chatIdOf = (a, b) => [a, b].sort().join('_');

async function openChat(other, extra) {
  const me = state.user.uid;
  const id = chatIdOf(me, other.id);
  try {
    await setDoc(doc(db, 'chats', id), {
      participants: [me, other.id].sort(),
      names: { [me]: state.profile.name, [other.id]: other.name },
      photos: { [me]: state.profile.photo || '', [other.id]: other.photo || '' },
      teams: { [me]: state.team?.name || '', [other.id]: other.teamName || '' },
      ...extra,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    go(`/chat/${id}`);
  } catch (err) { fail(err); }
}

// 우리 팀 선수 · 코치
export function startChat(m) {
  if (!state.team) return toast('팀에 들어간 뒤 대화할 수 있습니다.');
  return openChat({ id: m.id, name: m.name, photo: m.photo, teamName: state.team.name }, { kind: 'member', teamId: state.team.id });
}

// 다른 팀 → 그 팀 계정(대표 코치)
export function startTeamChat(team) {
  return openChat({ id: team.ownerUid, name: team.name, photo: team.logo || '', teamName: '팀 계정' },
    { kind: 'team', teamId: team.id, fromTeamId: state.team.id });
}

export async function chatList(el) {
  const me = state.user.uid;
  // 다른 팀과 대화 (팀 대표 지도자에게 연결) — 우리 팀 선수와의 대화는 없음
  const teams = (await getDocs(query(collection(db, 'teams'), where('status', '==', 'active')))).docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => t.id !== state.team?.id && !t.hidden && t.ownerUid && t.ownerUid !== me).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  el.innerHTML = `${pageHead('COMMUNITY', '팀 대화')}
    <p class="lead">다른 팀 지도자와 1:1로 대화해요. 팀을 고르면 그 팀 <b>대표 지도자</b>와 대화가 열려요. 오른쪽 <b>팀 검색</b>에서 팀을 눌러 <b>팀에 연락하기</b>로도 시작할 수 있어요.</p>
    <div class="cm-bar"><input type="search" placeholder="대화할 팀 이름 검색" data-tq></div>
    <ul class="team-results chat-teams" data-teams></ul>
    <h2 class="sec-title">대화 목록</h2>
    <ul class="list chats" data-list><li class="muted">불러오는 중…</li></ul>`;
  const drawTeams = (q = '') => {
    const list = q ? teams.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
    el.querySelector('[data-teams]').innerHTML = !q ? '' : list.length ? list.map((t) => `<li class="talk"><a href="#/teams/${t.id}"><span class="cat">${esc(normCat(t.category))}</span><strong>${esc(t.name)}</strong><span class="lock">${esc(t.ownerName || '')}</span></a><button class="btn sm" data-talk="${t.id}">대화하기</button></li>`).join('') : '<li class="muted">검색 결과가 없습니다.</li>';
    el.querySelectorAll('[data-talk]').forEach((b) => (b.onclick = () => startTeamChat(teams.find((t) => t.id === b.dataset.talk))));
  };
  el.querySelector('[data-tq]').oninput = (e) => drawTeams(e.target.value.trim());
  const unsub = onSnapshot(
    query(collection(db, 'chats'), where('participants', 'array-contains', me), orderBy('updatedAt', 'desc'), limit(50)),
    (s) => {
      const box = el.querySelector('[data-list]');
      if (!box) return;
      const docs = s.docs.filter((d) => d.data().kind === 'team'); // 팀끼리 대화만
      box.innerHTML = !docs.length ? '<li class="muted">아직 대화가 없어요. 위에서 팀을 찾아 대화를 시작해 보세요.</li>' : docs.map((d) => {
        const c = d.data();
        const other = c.participants.find((p) => p !== me);
        return `<li><a href="#/chat/${d.id}">${avatar(c.photos?.[other], c.names?.[other])}
          <div><strong>${esc(c.names?.[other] || '알 수 없음')}</strong> ${c.kind === 'team' ? '<span class="tag">팀</span>' : ''} <small>${esc(c.teams?.[other] || '')}</small>
          <small class="last">${esc(c.lastMessage || '')}</small></div><small>${fmtDate(c.updatedAt, true)}</small></a></li>`;
      }).join('');
    },
    fail,
  );
  state.cleanup.push(unsub);
}
export async function chatRoom(el, { id }) {
  const me = state.user.uid;
  let c;
  try { c = (await getDoc(doc(db, 'chats', id))).data(); } catch { c = null; }
  if (!c) { el.innerHTML = empty('대화방을 찾을 수 없습니다.'); return; }
  const other = c.participants.find((p) => p !== me);

  el.innerHTML = `<div class="chat-room">
    <header class="chat-head"><a href="#/chat" class="icon-btn" aria-label="팀 대화로">‹</a>${avatar(c.photos?.[other], c.names?.[other])}
      <div><strong>${esc(c.names?.[other])}</strong><small>${esc(c.teams?.[other] || '')}</small></div></header>
    <div class="msgs" data-msgs></div>
    <form class="chat-input"><input name="text" autocomplete="off" required placeholder="메시지 입력"><button class="btn">전송</button></form>
  </div>`;

  const box = el.querySelector('[data-msgs]');
  const unsub = onSnapshot(query(collection(db, 'chats', id, 'messages'), orderBy('createdAt'), limit(300)), (s) => {
    box.innerHTML = s.docs.map((d) => {
      const m = d.data();
      return `<div class="msg ${m.uid === me ? 'me' : ''}"><p>${esc(m.text)}</p><small>${fmtDate(m.createdAt, true).slice(5)}</small></div>`;
    }).join('') || '<p class="muted center">첫 메시지를 보내보세요.</p>';
    box.scrollTop = box.scrollHeight;
  }, fail);
  state.cleanup.push(unsub);

  const form = $('.chat-input', el);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const t = form.text.value.trim();
    if (!t) return;
    form.text.value = '';
    try {
      await addDoc(collection(db, 'chats', id, 'messages'), { uid: me, text: t, createdAt: serverTimestamp() });
      await updateDoc(doc(db, 'chats', id), { lastMessage: t.slice(0, 60), lastFrom: me, lastAt: serverTimestamp(), updatedAt: serverTimestamp() });
    } catch (err) { fail(err); }
  };
  form.text.focus();
}
