// 운영자 문의 — ① 팀 ↔ 운영자 대화방(팀마다 하나)  ② Q&A · 개선 제안 · 오류 신고 (운영자가 모아 보고 답변)
import {
  db, doc, collection, query, where, orderBy, limit, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp,
} from '../fb.js';
import { esc, toast, fail, pageHead, fmtDate, empty, confirmBox } from '../ui.js';
import { state, isCoach } from '../store.js';

const KINDS = ['질문', '개선 제안', '오류 신고'];
const STATUS = { 접수: '', '답변 완료': 'solid', '반영 완료': 'comp' };
const text = (s) => esc(s || '').replace(/\n/g, '<br>');

// ───────── 대화 상자 (팀 쪽 · 운영자 쪽 공통) ─────────
function thread(box, teamId, { asAdmin }) {
  box.innerHTML = `<div class="support-room">
    <div class="msgs" data-msgs><p class="muted center">불러오는 중…</p></div>
    <form class="chat-input"><input name="text" autocomplete="off" required placeholder="${asAdmin ? '팀에 답장' : '운영자에게 메시지'}"><button class="btn">전송</button></form>
  </div>`;
  const msgsBox = box.querySelector('[data-msgs]');
  const col = collection(db, 'support', teamId, 'messages');
  const draw = (s) => {
    msgsBox.innerHTML = s.docs.map((d) => {
      const m = d.data();
      const mine = asAdmin ? m.from === 'admin' : m.from !== 'admin';
      return `<div class="msg ${mine ? 'me' : ''}"><p>${text(m.text)}</p>
        <small>${m.from === 'admin' ? '운영자' : esc(m.name || '')} · ${fmtDate(m.createdAt, true).slice(5)}</small></div>`;
    }).join('') || `<p class="muted center">${asAdmin ? '아직 메시지가 없습니다.' : '궁금한 점, 불편한 점을 편하게 남겨주세요. 운영자가 확인 후 답장합니다.'}</p>`;
    msgsBox.scrollTop = msgsBox.scrollHeight;
  };
  const q = query(col, orderBy('createdAt'), limit(300));
  const unsub = onSnapshot(q, draw, fail);
  state.cleanup.push(unsub);
  // 읽음 표시
  updateDoc(doc(db, 'support', teamId), asAdmin ? { unreadAdmin: false } : { unreadTeam: false }).catch(() => {});

  const form = box.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const t = form.text.value.trim();
    if (!t) return;
    form.text.value = '';
    try {
      await addDoc(col, { text: t, uid: state.user.uid, name: state.profile.name, from: asAdmin ? 'admin' : 'team', createdAt: serverTimestamp() });
      await setDoc(doc(db, 'support', teamId), {
        teamId, ...(asAdmin ? {} : { teamName: state.team.name, category: state.team.category }),
        lastMessage: t.slice(0, 80), lastFrom: asAdmin ? 'admin' : 'team', updatedAt: serverTimestamp(),
        ...(asAdmin ? { unreadTeam: true, unreadAdmin: false } : { unreadAdmin: true, unreadTeam: false }),
      }, { merge: true });
      draw(await getDocs(q)); // 실시간 갱신이 늦어도 바로 보이게
    } catch (err) { fail(err); }
  };
  form.text.focus();
}

// ───────── Q&A · 개선 제안 쓰기 폼 ─────────
function feedbackForm() {
  return `<form class="card" data-fb>
    <h3>Q&A · 개선 제안 남기기</h3>
    <div class="pick-chips">${KINDS.map((k, i) => `<label><input type="radio" name="kind" value="${k}" ${i === 0 ? 'checked' : ''}><span>${k}</span></label>`).join('')}</div>
    <label>제목<input name="title" required maxlength="80" placeholder="예) 일지검사에서 학년별로 보고 싶어요"></label>
    <label>내용<textarea name="body" rows="4" required maxlength="2000" placeholder="어떤 화면에서, 무엇이 불편했는지 / 어떻게 바뀌면 좋을지 적어주세요."></textarea></label>
    <div class="row end"><button class="btn">보내기</button></div>
  </form>`;
}

const fbItem = (f, { admin = false } = {}) => `
  <article class="card fb ${f.reply ? 'answered' : ''}" data-id="${f.id}">
    <header><span class="tag">${esc(f.kind)}</span><span class="tag ${STATUS[f.status] ?? ''}">${esc(f.status)}</span>
      <strong>${esc(f.title)}</strong></header>
    <small class="muted">${admin ? `${esc(f.name)} · ${esc(f.role === 'coach' ? '지도자' : '선수')}${f.teamName ? ` · ${esc(f.teamName)}` : ''} · ` : ''}${fmtDate(f.createdAt, true)}</small>
    <p>${text(f.body)}</p>
    ${f.reply && !admin ? `<div class="fb-reply"><span class="eyebrow">운영자 답변 · ${fmtDate(f.repliedAt, true)}</span><p>${text(f.reply)}</p></div>` : ''}
    ${admin ? `<div class="fb-admin">
      <textarea rows="2" data-reply placeholder="답변 (쓰면 작성자에게 보여요)">${esc(f.reply || '')}</textarea>
      <div class="row between"><select data-status>${Object.keys(STATUS).map((s) => `<option ${s === f.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <span><button type="button" class="link-btn small" data-del>삭제</button> <button type="button" class="btn sm" data-save>저장</button></span></div>
    </div>` : (f.status === '접수' ? '<div class="row end"><button type="button" class="link-btn small" data-del>삭제</button></div>' : '')}
  </article>`;

// ───────── 사용자 쪽: #/support ─────────
export async function page(el, { tab } = {}) {
  const canTalk = isCoach(); // 팀 지도자(팀 대표 포함)
  const cur = tab || (canTalk ? 'talk' : 'qna');
  el.innerHTML = `${pageHead('SUPPORT', '운영자 문의')}
    <div class="tabs admin-tabs">
      ${canTalk ? `<a href="#/support" class="${cur === 'talk' ? 'active' : ''}">운영자와 대화</a>` : ''}
      <a href="#/support/qna" class="${cur === 'qna' ? 'active' : ''}">Q&A · 개선 제안</a>
    </div>
    <div data-body></div>`;
  const body = el.querySelector('[data-body]');

  if (cur === 'talk') {
    body.innerHTML = `<p class="lead">${esc(state.team.name)} 팀과 운영자의 1:1 대화방입니다. 우리 팀 지도자들이 함께 보고, 다른 팀은 볼 수 없어요.</p><div data-thread></div>`;
    thread(body.querySelector('[data-thread]'), state.team.id, { asAdmin: false });
    return;
  }

  const s = await getDocs(query(collection(db, 'feedback'), where('uid', '==', state.user.uid), orderBy('createdAt', 'desc'), limit(50)));
  const mine = s.docs.map((d) => ({ id: d.id, ...d.data() }));
  body.innerHTML = `<p class="lead">질문, 불편한 점, 이렇게 바뀌면 좋겠다는 의견을 남겨주세요. 운영자만 볼 수 있고, 답변은 여기서 확인할 수 있어요.</p>
    ${feedbackForm()}
    <h2 class="sec-title">내가 남긴 글 <small>${mine.length}</small></h2>
    <div class="fb-list">${mine.map((f) => fbItem(f)).join('') || empty('아직 남긴 글이 없습니다.')}</div>`;
  const form = body.querySelector('[data-fb]');
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'feedback'), {
        kind: form.kind.value, title: form.title.value.trim(), body: form.body.value.trim(), status: '접수',
        uid: state.user.uid, name: state.profile.name, role: state.profile.role,
        teamId: state.team?.id || null, teamName: state.team?.name || '', createdAt: serverTimestamp(),
      });
      toast('운영자에게 보냈습니다. 고맙습니다!');
      page(el, { tab: 'qna' });
    } catch (err) { fail(err); }
  };
  body.querySelectorAll('.fb [data-del]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('이 글을 삭제할까요?'))) return;
    try { await deleteDoc(doc(db, 'feedback', b.closest('.fb').dataset.id)); page(el, { tab: 'qna' }); } catch (err) { fail(err); }
  }));
}
export const qna = (el) => page(el, { tab: 'qna' });

// ───────── 운영자 쪽: #/admin/inbox ─────────
export async function inbox(el, { id } = {}) {
  const [ts, fs] = await Promise.all([
    getDocs(query(collection(db, 'support'), orderBy('updatedAt', 'desc'), limit(200))),
    getDocs(query(collection(db, 'feedback'), orderBy('createdAt', 'desc'), limit(300))),
  ]);
  const threads = ts.docs.map((d) => ({ id: d.id, ...d.data() }));
  const fbs = fs.docs.map((d) => ({ id: d.id, ...d.data() }));
  const tab = id ? 'talk' : (location.hash.includes('qna') ? 'qna' : 'talk');
  const unread = threads.filter((t) => t.unreadAdmin).length;
  const open = fbs.filter((f) => f.status === '접수').length;

  el.innerHTML = `${pageHead('ADMIN', '문의함')}
    <div class="tabs admin-tabs">
      <a href="#/admin/inbox" class="${tab === 'talk' ? 'active' : ''}">팀 대화 ${unread ? `<b class="dot-n">${unread}</b>` : ''}</a>
      <a href="#/admin/inbox/qna" class="${tab === 'qna' ? 'active' : ''}">Q&A · 개선 제안 ${open ? `<b class="dot-n">${open}</b>` : ''}</a>
    </div>
    <div data-body></div>`;
  const body = el.querySelector('[data-body]');

  if (tab === 'talk') {
    const cur = threads.find((t) => t.id === id);
    body.innerHTML = `<div class="inbox ${cur ? 'has-cur' : ''}">
      <ul class="list chats inbox-list">${threads.map((t) => `
        <li class="${t.id === id ? 'on' : ''}"><a href="#/admin/inbox/${t.id}">
          <div><strong>${esc(t.teamName || t.teamId)}</strong> <small>${esc(t.category || '')}</small>
          <small class="last">${t.lastFrom === 'admin' ? '나: ' : ''}${esc(t.lastMessage || '')}</small></div>
          <small>${t.unreadAdmin ? '<b class="dot-n">새 글</b>' : ''}${fmtDate(t.updatedAt, true).slice(5)}</small></a></li>`).join('') || '<li class="muted">아직 팀에서 온 대화가 없습니다.</li>'}</ul>
      <div class="inbox-room">${cur ? `<div class="chat-head"><a href="#/admin/inbox" class="icon-btn">‹</a><div><strong>${esc(cur.teamName)}</strong><small>${esc(cur.category || '')} · <a href="#/teams/${cur.id}">팀 보기</a></small></div></div><div data-thread></div>` : '<p class="muted center">왼쪽에서 팀을 고르세요.</p>'}</div>
    </div>`;
    if (cur) thread(body.querySelector('[data-thread]'), cur.id, { asAdmin: true });
    return;
  }

  let filter = '전체';
  const draw = () => {
    const list = fbs.filter((f) => filter === '전체' || f.kind === filter || f.status === filter);
    body.innerHTML = `<div class="chips wrap">${['전체', ...KINDS, '접수'].map((k) => `<button class="chip ${k === filter ? 'active' : ''}" data-f="${k}">${k === '접수' ? '답변 안 한 글' : k}</button>`).join('')}</div>
      <div class="fb-list">${list.map((f) => fbItem(f, { admin: true })).join('') || empty('글이 없습니다.')}</div>`;
    body.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { filter = b.dataset.f; draw(); }));
    body.querySelectorAll('.fb').forEach((c) => {
      const f = fbs.find((x) => x.id === c.dataset.id);
      c.querySelector('[data-save]').onclick = async () => {
        const reply = c.querySelector('[data-reply]').value.trim();
        let status = c.querySelector('[data-status]').value;
        if (reply && status === '접수') status = '답변 완료';
        try {
          const patch = { reply, status, ...(reply !== (f.reply || '') ? { repliedAt: serverTimestamp() } : {}) };
          await updateDoc(doc(db, 'feedback', f.id), patch);
          Object.assign(f, patch);
          toast('저장했습니다.');
          draw();
        } catch (err) { fail(err); }
      };
      c.querySelector('[data-del]').onclick = async () => {
        if (!(await confirmBox('이 글을 삭제할까요?'))) return;
        try { await deleteDoc(doc(db, 'feedback', f.id)); fbs.splice(fbs.indexOf(f), 1); draw(); } catch (err) { fail(err); }
      };
    });
  };
  draw();
}
