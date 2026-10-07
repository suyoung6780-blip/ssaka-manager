import {
  db, collection, doc, query, where, orderBy, limit, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp,
} from '../fb.js';
import { $, esc, toast, fail, fmtDate, pageHead, empty, avatar, CATEGORIES } from '../ui.js';
import { state, go, isCoach, isAdmin, publicProfile } from '../store.js';
import { playerCard, profileModal } from './team.js';

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
      .filter((t) => (cat === '전체' || t.category === cat) && (!q || t.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    el.querySelector('[data-results]').innerHTML = list.length ? list.map((t) => `
      <li><a href="#/teams/${t.id}"><span class="cat">${esc(t.category)}</span><strong>${esc(t.name)}</strong>
      <span class="lock">${t.isPublic ? '' : '비공개'}</span></a></li>`).join('') : '<li class="muted">검색 결과가 없습니다.</li>';
  };
  el.querySelector('[data-q]').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  el.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => {
    cat = b.dataset.cat;
    el.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('active', x === b));
    draw();
  }));

  getDocs(query(collection(db, 'teams'), where('status', '==', 'active')))
    .then((s) => { teamCache = s.docs.map((d) => ({ id: d.id, ...d.data() })); draw(); })
    .catch(fail);
}

// ───────── 스카우트 대상: 바로 아래 연령 팀 선수만 ─────────
export const SCOUT_TARGET = { U15: 'U12', U18: 'U15', U22: 'U18' };
const scoutTarget = () => SCOUT_TARGET[state.team?.category] || '';
const scoutCol = () => collection(db, 'teams', state.team.id, 'scouts');

// ───────── 다른 팀 보기 (공개 팀: 선수단 · 프로필) ─────────
export async function teamView(el, { id }) {
  const t = await getDoc(doc(db, 'teams', id));
  if (!t.exists()) { el.innerHTML = empty('존재하지 않는 팀입니다.'); return; }
  const team = { id, ...t.data() };
  const mine = state.team?.id === id;
  const me = state.user.uid;
  // 다른 팀과는 '팀 계정'(팀 대표)으로만 연락 — 코치만
  const canContact = !mine && isCoach() && team.ownerUid && team.ownerUid !== me;
  const contactBtn = canContact ? '<button class="btn" data-contact>팀에 연락하기</button>' : '';

  const head = `<header class="hero">
    <span class="eyebrow">${esc(team.category)} · ${team.isPublic ? 'PUBLIC' : 'PRIVATE'}</span>
    <h1>${esc(team.name)}</h1>${team.isPublic && team.intro ? `<p>${esc(team.intro)}</p>` : ''}
    ${contactBtn ? `<div class="row">${contactBtn}</div>` : ''}</header>`;
  const bindContact = () => el.querySelector('[data-contact]')?.addEventListener('click', () => startTeamChat(team));

  if (!team.isPublic && !mine && !isAdmin()) { // 운영자는 비공개 팀 선수단도 확인
    el.innerHTML = `${head}<div class="card narrow center"><h3>비공개 팀</h3><p class="muted">이 팀은 선수단을 공개하지 않습니다.</p></div>`;
    bindContact();
    return;
  }

  const ms = await getDocs(collection(db, 'teams', id, 'members'));
  const list = ms.docs.map((d) => ({ id: d.id, ...d.data(), teamName: team.name }))
    .sort((a, b) => (a.role === b.role ? (+a.number || 99) - (+b.number || 99) : a.role === 'coach' ? -1 : 1));
  // 찜: 우리 팀 코치만, 바로 아래 연령 팀 선수만. 상대에게는 알림 없음
  const canScout = !mine && isCoach() && scoutTarget() && team.category === scoutTarget();
  let scouted = new Set();
  if (canScout) scouted = new Set((await getDocs(scoutCol())).docs.map((d) => d.id));

  const draw = () => {
    el.innerHTML = `${head}
      ${canScout ? `<p class="lead">☆ 찜은 우리 팀 코치끼리만 보여요. 선수와 상대 팀에는 알림이 가지 않습니다.</p>` : ''}
      <h2 class="sec-title">선수단 <small>${list.length}</small></h2>
      <div class="roster">${list.map((m) => {
        const btns = [
          canScout && m.role === 'player' ? `<button class="chip ${scouted.has(m.id) ? 'active' : ''}" data-scout>${scouted.has(m.id) ? '★ 찜' : '☆ 찜'}</button>` : '',
          mine && m.id !== me ? '<button class="chip" data-chat>대화</button>' : '', // 대화는 우리 팀원끼리만
        ].join('');
        return playerCard(m, { extra: btns ? `<div class="pcard-actions">${btns}</div>` : '' });
      }).join('') || empty('선수가 없습니다.')}</div>`;
    bindContact();
    el.querySelectorAll('[data-pid]').forEach((c) => (c.onclick = async (e) => {
      const m = list.find((x) => x.id === c.dataset.pid);
      if (e.target.closest('[data-chat]')) return startChat(m);
      if (e.target.closest('[data-scout]')) {
        try {
          if (scouted.has(m.id)) { await deleteDoc(doc(scoutCol(), m.id)); scouted.delete(m.id); toast('찜을 해제했습니다.'); }
          else { await saveScout(m, team); scouted.add(m.id); toast(`${m.name} 선수를 찜했습니다. 스카우터에서 메모를 남겨보세요.`); }
          draw();
        } catch (err) { fail(err); }
        return;
      }
      const md = profileModal(m, mine && m.id !== me ? '<button class="btn" data-chat>대화하기</button>' : '');
      md.el.querySelector('[data-chat]')?.addEventListener('click', () => { md.close(); startChat(m); });
    }));
  };
  draw();
}

function saveScout(m, team) {
  return setDoc(doc(scoutCol(), m.id), {
    ...publicProfile(m), uid: m.id, teamId: team.id, teamName: team.name, category: team.category,
    note: '', by: state.profile.name, createdAt: serverTimestamp(),
  });
}

// ───────── 스카우터 (찜 목록 · 메모) — 코치 전용 ─────────
export async function scout(el) {
  const target = scoutTarget();
  if (!target) {
    el.innerHTML = `${pageHead('SCOUTER', '스카우터')}
      <div class="card narrow center"><h3>스카우터를 쓸 수 없는 팀이에요</h3>
      <p class="muted">스카우터는 바로 아래 연령 선수를 찜하는 기능입니다.<br>U15 팀은 U12 · U18 팀은 U15 · U22 팀은 U18 선수를 찜할 수 있어요.</p></div>`;
    return;
  }
  const [s, ts] = await Promise.all([
    getDocs(query(scoutCol(), orderBy('createdAt', 'desc'))),
    getDocs(query(collection(db, 'teams'), where('status', '==', 'active'), where('category', '==', target))),
  ]);
  const list = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  const teams = ts.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => t.isPublic)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  el.innerHTML = `${pageHead('SCOUTER', '스카우터')}
    <p class="lead">${esc(state.team.category)} 팀은 <strong>${target}</strong> 선수를 찜할 수 있어요. 찜과 메모는 우리 팀 코치끼리만 보이고, 선수나 상대 팀에는 알림이 가지 않습니다.</p>
    <h2 class="sec-title">${target} 팀 둘러보기 <small>${teams.length}</small></h2>
    <div class="chips wrap scout-teams">${teams.map((t) => `<a class="chip" href="#/teams/${t.id}">${esc(t.name)}</a>`).join('') || `<span class="muted">공개된 ${target} 팀이 아직 없습니다.</span>`}</div>
    <h2 class="sec-title">찜한 선수 <small>${list.length}</small></h2>
    ${list.length ? `<div class="scout-list">${list.map((m) => `
      <article class="card scout" data-id="${m.id}">
        ${avatar(m.photo, m.name, 'lg')}
        <div class="scout-body">
          <span class="eyebrow">${esc(m.category)} · <a href="#/teams/${m.teamId}">${esc(m.teamName)}</a></span>
          <h3>${m.number ? `<span class="num">${esc(m.number)}</span> ` : ''}${esc(m.name)} <small>${esc(m.position || '')}</small></h3>
          <small class="muted">${[m.affiliation, m.height && `${m.height}cm`, m.weight && `${m.weight}kg`, m.birthYear && `${m.birthYear}년생`].filter(Boolean).join(' · ')}</small>
          <textarea rows="3" placeholder="스카우팅 메모 — 장점, 보완점, 본 경기, 연락 계획 등" data-note>${esc(m.note || '')}</textarea>
          <small class="muted" data-meta>${m.noteBy ? `${esc(m.noteBy)} · ${fmtDate(m.noteAt, true)} 수정` : `${esc(m.by || '')} 찜`}</small>
        </div>
        <div class="scout-actions">
          <button class="btn sm" data-save>메모 저장</button>
          <button class="link-btn small" data-del>찜 해제</button>
        </div>
      </article>`).join('')}</div>` : empty('찜한 선수가 없습니다. 위에서 팀을 골라 선수 카드의 ☆ 찜을 눌러보세요.')}`;

  el.querySelectorAll('.scout').forEach((c) => {
    const m = list.find((x) => x.id === c.dataset.id);
    const save = () => updateDoc(doc(scoutCol(), m.id), { note: c.querySelector('[data-note]').value, noteBy: state.profile.name, noteAt: serverTimestamp() })
      .then(() => { c.querySelector('[data-meta]').textContent = `${state.profile.name} · 방금 수정`; toast('메모를 저장했습니다.'); }).catch(fail);
    c.querySelector('[data-save]').onclick = save;
    c.querySelector('[data-del]').onclick = async () => {
      if (!confirm(`${m.name} 선수 찜을 해제할까요? 메모도 함께 지워집니다.`)) return;
      try { await deleteDoc(doc(scoutCol(), m.id)); c.remove(); } catch (err) { fail(err); }
    };
  });
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
  const members = state.team
    ? (await getDocs(collection(db, 'teams', state.team.id, 'members'))).docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.id !== me)
    : [];
  el.innerHTML = `${pageHead('MESSAGES', '대화')}
    <p class="lead">우리 팀 선수 · 코치와 대화할 수 있어요.${isCoach() ? ' 다른 팀과는 팀 페이지의 <strong>팀에 연락하기</strong>로 그 팀 계정과 대화합니다.' : ''}</p>
    <a class="card support-link" href="#/support"><span class="eyebrow">SUPPORT</span><strong>${isCoach() ? '운영자와 대화 · Q&A · 개선 제안' : 'Q&A · 개선 제안'}</strong><small>싸카매니저 운영자에게 질문하거나 불편한 점을 알려주세요 →</small></a>
    ${members.length ? `<h2 class="sec-title">우리 팀 <small>${members.length}</small></h2>
    <div class="chips wrap chat-members">${members.map((m) => `<button class="chip" data-mid="${m.id}">${esc(m.name)}${m.role === 'coach' ? ' 코치' : ''}</button>`).join('')}</div>` : ''}
    <h2 class="sec-title">대화 목록</h2>
    <ul class="list chats" data-list><li class="muted">불러오는 중…</li></ul>`;
  el.querySelectorAll('[data-mid]').forEach((b) => (b.onclick = () => startChat(members.find((m) => m.id === b.dataset.mid))));
  const unsub = onSnapshot(
    query(collection(db, 'chats'), where('participants', 'array-contains', me), orderBy('updatedAt', 'desc'), limit(50)),
    (s) => {
      const box = el.querySelector('[data-list]');
      if (!box) return;
      box.innerHTML = s.empty ? '<li class="muted">대화가 없습니다.</li>' : s.docs.map((d) => {
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
    <header class="chat-head"><a href="#/chat" class="icon-btn">‹</a>${avatar(c.photos?.[other], c.names?.[other])}
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
      await updateDoc(doc(db, 'chats', id), { lastMessage: t.slice(0, 60), updatedAt: serverTimestamp() });
    } catch (err) { fail(err); }
  };
  form.text.focus();
}
