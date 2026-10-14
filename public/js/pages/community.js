// 커뮤니티 — 다른 팀 코치들끼리: 자유 글 · 훈련 공유 · 연습경기 구해요 · 질문 (코치만 보고 씀, 선수에게는 안 보임)
import {
  db, collection, doc, query, orderBy, limit, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp,
} from '../fb.js';
import { esc, text, toast, fail, modal, confirmBox, pageHead, empty } from '../ui.js';
import { state, isCoach, isAdmin, go } from '../store.js';
import { createPad } from '../tactic.js';

// 세 칸: 훈련 공유 · 경기(연습경기 · 대회) · 지도자 게시판(자유). 예전 종류는 알맞은 칸으로
const CATS = ['훈련 공유', '경기', '지도자 게시판'];
const CAT_IC = { '훈련 공유': '📘', 경기: '⚽', '지도자 게시판': '📝' };
const SLUG = { training: '훈련 공유', match: '경기', talk: '지도자 게시판' };
const catOf = (x) => ({ 자유: '지도자 게시판', 질문: '지도자 게시판', 대화: '지도자 게시판', '연습경기 구해요': '경기' }[x.cat] || x.cat || '지도자 게시판');
const INTRO = {
  '훈련 공유': '우리 팀 훈련 프로그램을 다른 팀 지도자들과 나눠요. 마음에 드는 훈련은 우리 팀으로 바로 가져올 수 있어요.',
  경기: '연습경기 상대 구하기 · 대회 정보 · 경기 일정을 나눠요. 날짜 · 장소 · 연령 · 연락 방법을 적어 주세요.',
  '지도자 게시판': '지도자끼리 자유롭게 글을 쓰고 이야기해요. 궁금한 것, 소식, 무엇이든 좋아요.',
};
const col = () => collection(db, 'community');
const PER = 5; // 한 쪽에 5개씩
const pagerHtml = (cur, pages) => `<button type="button" class="btn ghost sm" data-pg="${cur - 1}" ${cur ? '' : 'disabled'}>‹ 이전</button>
  ${Array.from({ length: pages }, (_, i) => `<button type="button" class="pg ${i === cur ? 'on' : ''}" data-pg="${i}">${i + 1}</button>`).join('')}
  <button type="button" class="btn ghost sm" data-pg="${cur + 1}" ${cur < pages - 1 ? '' : 'disabled'}>다음 ›</button>`;
// 훈련 그림: 올린 사진과 작전판을 같이 (둘 다 있으면 나란히)
const thumbHtml = (pg) => `<div class="cm-thumb ${pg?.image && pg?.pad ? 'two' : ''}">${pg?.image ? `<img src="${esc(pg.image)}" alt="">` : ''}${pg?.pad ? '<div data-thumb></div>' : ''}${!pg?.image && !pg?.pad ? '<span>📘</span>' : ''}</div>`;
const tms = (v) => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : 0);
const ago = (ms) => { if (!ms) return ''; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const mine = (x) => x.authorUid === state.user.uid;
let curCat = '전체';

export async function page(el, { cat: slug } = {}) {
  const cat = SLUG[slug] || '훈련 공유';
  if (!isCoach()) { el.innerHTML = `${pageHead('COMMUNITY', '커뮤니티')}${empty('커뮤니티는 지도자만 쓸 수 있어요.')}`; return; }
  const snap = await getDocs(query(col(), orderBy('createdAt', 'desc'), limit(120)));
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => catOf(x) === cat);
  const isTr = cat === '훈련 공유';
  let pageNo = 0;
  let qNow = '';
  const draw = (q = qNow) => {
    if (q !== qNow) { qNow = q; pageNo = 0; }
    const found = all.filter((x) => !q || [x.title, x.body, x.teamName, x.authorName, x.share?.program?.title, (x.share?.program?.topics || []).join(' ')].join(' ').toLowerCase().includes(q.toLowerCase()));
    const pages = Math.max(1, Math.ceil(found.length / PER));
    pageNo = Math.min(pageNo, pages - 1);
    const list = found.slice(pageNo * PER, pageNo * PER + PER);
    el.querySelector('[data-pager]').innerHTML = pages > 1 ? pagerHtml(pageNo, pages) : '';
    el.querySelector('[data-list]').innerHTML = list.length ? list.map((x) => {
      const pg = x.share?.program;
      return `<article class="cm-card ${isTr ? 'tr' : ''}" data-id="${x.id}">
        ${isTr ? thumbHtml(pg) : ''}
        <div class="cm-top"><span class="tag">${CAT_IC[cat]} ${esc(cat)}</span>${pg && !isTr ? '<span class="tag solid">훈련 첨부</span>' : ''}<small class="muted">${ago(tms(x.createdAt))}</small></div>
        <h3>${esc(x.title)}</h3>
        ${isTr && pg ? `<div class="lib-tags">${(pg.topics || []).slice(0, 3).map((t) => `<span class="ttag">${esc(t)}</span>`).join('')}</div>` : ''}
        ${x.body ? `<p class="cm-body">${esc(x.body.slice(0, 120))}${x.body.length > 120 ? '…' : ''}</p>` : ''}
        <div class="cm-foot"><span>${esc(x.teamCategory ? `${x.teamCategory} · ` : '')}<b>${esc(x.teamName || '')}</b> · ${esc(x.authorName || '')} 코치</span><span>💬 ${x.commentN || 0}</span></div>
      </article>`;
    }).join('') : empty(isTr ? '아직 공유된 훈련이 없어요. 우리 팀 훈련을 처음으로 공유해 보세요!' : '아직 글이 없어요. 첫 글을 써 보세요!');
    el.querySelectorAll('[data-id]').forEach((c) => {
      const x = all.find((y) => y.id === c.dataset.id);
      const tb = c.querySelector('[data-thumb]');
      if (tb && x.share?.program?.pad) createPad(tb, x.share.program.pad, { editable: false, play: false });
      c.onclick = () => openPost(x, () => page(el, { cat: slug }));
    });
    el.querySelectorAll('[data-pager] [data-pg]').forEach((b) => (b.onclick = () => { pageNo = +b.dataset.pg; draw(); el.querySelector('[data-list]').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  };
  el.innerHTML = `${pageHead('COMMUNITY', `${CAT_IC[cat]} ${cat}`, isTr ? '<button class="btn" data-pick>+ 내 훈련 공유하기</button>' : '<button class="btn" data-write>+ 글쓰기</button>')}
    <p class="lead">${INTRO[cat]} <b>지도자만</b> 보고 쓸 수 있어요 (선수에게는 안 보여요).</p>
    <div class="cm-bar"><input type="search" placeholder="${isTr ? '훈련 이름 · 주제 · 팀 이름 검색' : '제목 · 내용 · 팀 이름 검색'}" data-q></div>
    <div class="cm-list ${isTr ? 'tr' : ''}" data-list></div>
    <div class="cm-pager" data-pager></div>`;
  el.querySelector('[data-q]').oninput = (e) => draw(e.target.value);
  el.querySelector('[data-write]')?.addEventListener('click', () => write({ cat }, () => page(el, { cat: slug })));
  el.querySelector('[data-pick]')?.addEventListener('click', () => pickProgram());
  draw();
}

// 우리 팀 훈련 프로그램 중에서 골라 공유
async function pickProgram() {
  const snap = await getDocs(query(collection(db, 'teams', state.team.id, 'posts'), orderBy('createdAt', 'desc'), limit(200)));
  const progs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.type === 'training');
  const m = modal(`<span class="eyebrow">SHARE</span><h2>공유할 훈련 고르기</h2>
    ${progs.length ? '<ul class="list cm-pick" data-picks></ul><div class="cm-pager" data-pager></div>' : empty('우리 팀 훈련 프로그램이 없어요. 훈련장 → 훈련 프로그램에서 먼저 만들어 주세요.')}`, { wide: true });
  let pg = 0;
  const show = () => {
    const pages = Math.ceil(progs.length / PER);
    const box = m.el.querySelector('[data-picks]');
    if (!box) return;
    box.innerHTML = progs.slice(pg * PER, pg * PER + PER).map((p) => `<li data-pid="${p.id}">${thumbHtml(p)}<div><strong>${esc(p.title)}</strong><small>${esc([(p.topics || []).join(' · '), (p.ages || []).join(' · '), p.players && `${p.players}명`].filter(Boolean).join(' · '))}</small></div><button type="button" class="btn sm">공유</button></li>`).join('');
    box.querySelectorAll('[data-pid]').forEach((li) => {
      const p = progs.find((x) => x.id === li.dataset.pid);
      const tb = li.querySelector('[data-thumb]');
      if (tb && p.pad) createPad(tb, p.pad, { editable: false, play: false });
      li.querySelector('button').onclick = () => { m.close(); shareProgram(p); };
    });
    m.el.querySelector('[data-pager]').innerHTML = pages > 1 ? pagerHtml(pg, pages) : '';
    m.el.querySelectorAll('[data-pager] [data-pg]').forEach((b) => (b.onclick = () => { pg = +b.dataset.pg; show(); }));
  };
  show();
}

// 훈련 프로그램을 커뮤니티에 올리기 (훈련장 → 훈련 프로그램에서)
export async function shareProgram(p) {
  let image = p.image || '';
  if (image && image.length >= 450000) image = await shrink(image).catch(() => '');
  const snap = {
    title: p.title || '', topics: p.topics || [], ages: p.ages || [], players: p.players || '', duration: p.duration || '', space: p.space || '',
    body: p.body || '', points: p.points || '', pad: p.pad || null,
    ...(image && image.length < 450000 ? { image } : {}), // 문서 크기 한도 — 크면 줄여서
  };
  write({ cat: '훈련 공유', title: p.title || '', body: '', share: { kind: 'program', program: snap } }, () => go('/community/training'));
}

// 큰 사진은 가로 900px · JPEG 로 줄임
function shrink(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 900 / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = rej;
    img.src = src;
  });
}

function write(pre = {}, done = () => {}) {
  const m = modal(`<span class="eyebrow">COMMUNITY</span><h2>${pre.id ? '글 고치기' : '글쓰기'}</h2>
    <form class="stack">
      ${pre.share ? '<input type="hidden" name="cat" value="훈련 공유">' : `<label>칸<select name="cat">${CATS.filter((c) => c !== '훈련 공유').map((c) => `<option ${c === catOf(pre) ? 'selected' : ''}>${c}</option>`).join('')}</select></label>`}
      <label>제목<input name="title" required maxlength="80" value="${esc(pre.title || '')}" placeholder="예) 10월 마지막 주 U15 연습경기 구해요 / 빌드업 훈련 어떻게 하세요?"></label>
      <label>내용<textarea name="body" rows="6" maxlength="3000" placeholder="${pre.share ? '이 훈련을 소개해 주세요 (어떤 상황에 좋은지 · 주의할 점)' : '자유롭게 적어요. 연습경기는 날짜 · 장소 · 연령 · 연락 방법을 적어 주세요'}">${esc(pre.body || '')}</textarea></label>
      ${pre.share ? `<div class="cm-attach">📘 훈련 첨부: <b>${esc(pre.share.program.title)}</b> <small class="muted">(${pre.share.program.image ? '사진 · ' : ''}작전판 · 방법 · 코칭 포인트가 같이 올라가요)</small></div>` : ''}
      <p class="muted small">우리 팀 이름(${esc(state.team?.name || '')})과 내 이름이 같이 보여요.</p>
      <div class="row end"><button class="btn">${pre.id ? '저장' : '올리기'}</button></div>
    </form>`);
  m.el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('.btn'); btn.disabled = true;
    const data = { cat: f.cat.value, title: f.title.value.trim(), body: f.body.value.trim() };
    try {
      if (pre.id) await updateDoc(doc(col(), pre.id), { ...data, updatedAt: serverTimestamp() });
      else {
        await addDoc(col(), {
          ...data, ...(pre.share ? { share: pre.share } : {}), commentN: 0,
          authorUid: state.user.uid, authorName: state.profile.name, teamId: state.team.id, teamName: state.team.name, teamCategory: state.team.category || '',
          createdAt: serverTimestamp(),
        });
      }
      m.close(); toast(pre.id ? '고쳤어요.' : '올렸어요!'); done();
    } catch (err) { fail(err); btn.disabled = false; }
  };
}

async function openPost(x, refresh) {
  const pg = x.share?.program;
  const m = modal(`<div class="cm-post">
    <span class="eyebrow">${CAT_IC[catOf(x)] || ''} ${esc(catOf(x))} · ${ago(tms(x.createdAt))}</span>
    <h2>${esc(x.title)}</h2>
    <p class="muted small">${esc(x.teamCategory ? `${x.teamCategory} · ` : '')}<b>${esc(x.teamName || '')}</b> · ${esc(x.authorName || '')} 코치</p>
    ${x.body ? `<div class="prose">${text(x.body)}</div>` : ''}
    ${pg ? `<section class="cm-prog">
      <h3>📘 ${esc(pg.title)}</h3>
      <div class="lib-tags">${(pg.topics || []).map((t) => `<span class="ttag">${esc(t)}</span>`).join('')}</div>
      <div class="tr-facts">${[['연령', (pg.ages || []).join(' · ')], ['인원', pg.players && `${pg.players}명`], ['시간', pg.duration && `${pg.duration}분`], ['공간', pg.space]].filter(([, v]) => v).map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('')}</div>
      ${pg.pad ? '<div data-cmpad></div>' : ''}${pg.image ? `<img class="cm-img" src="${esc(pg.image)}" alt="훈련 그림">` : ''}
      ${pg.body ? `<h4>훈련 방법</h4><div class="prose">${text(pg.body)}</div>` : ''}
      ${lines(pg.points).length ? `<h4>코칭 포인트</h4><ol class="points">${lines(pg.points).map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
      <div class="row"><button class="btn" data-import>📥 우리 팀 훈련 프로그램으로 가져오기</button></div>
    </section>` : ''}
    <div class="row">
      ${x.teamId && x.teamId !== state.team?.id ? `<a class="btn ghost sm" href="#/teams/${esc(x.teamId)}">🏟 ${esc(x.teamName || '이 팀')} 페이지 · 연락하기</a>` : ''}
      ${mine(x) ? '<button class="btn ghost sm" data-edit>고치기</button>' : ''}
      ${mine(x) || isAdmin() ? '<button class="btn ghost sm" data-del>삭제</button>' : ''}
    </div>
    <h4>댓글 <small class="muted" data-cn>${x.commentN || 0}</small></h4>
    <ul class="cm-comments" data-comments><li class="muted small">불러오는 중…</li></ul>
    <form class="cm-cform" data-cform><textarea name="body" rows="2" maxlength="1000" required placeholder="댓글을 남겨요"></textarea><button class="btn sm">등록</button></form>
  </div>`, { wide: !!pg });
  const padBox = m.el.querySelector('[data-cmpad]');
  if (padBox && pg?.pad) createPad(padBox, pg.pad, { editable: false });
  const ccol = collection(db, 'community', x.id, 'comments');
  const loadComments = async () => {
    const cs = await getDocs(query(ccol, orderBy('createdAt')));
    const list = cs.docs.map((d) => ({ id: d.id, ...d.data() }));
    m.el.querySelector('[data-comments]').innerHTML = list.length ? list.map((c) => `<li>
      <div class="cm-c-h"><b>${esc(c.name || '')} 코치</b> <small class="muted">${esc(c.teamName || '')} · ${ago(tms(c.createdAt))}</small>
        ${c.uid === state.user.uid || isAdmin() ? `<button class="link-btn small" data-cdel="${c.id}">삭제</button>` : ''}</div>
      <p>${text(c.body)}</p></li>`).join('') : '<li class="muted small">첫 댓글을 남겨 보세요.</li>';
    m.el.querySelectorAll('[data-cdel]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox('댓글을 지울까요?'))) return;
      try { await deleteDoc(doc(ccol, b.dataset.cdel)); await loadComments(); } catch (err) { fail(err); }
    }));
  };
  loadComments().catch(fail);
  m.el.querySelector('[data-cform]').onsubmit = async (e) => {
    e.preventDefault();
    const body = e.target.body.value.trim();
    if (!body) return;
    try {
      await addDoc(ccol, { body, uid: state.user.uid, name: state.profile.name, teamId: state.team.id, teamName: state.team.name, createdAt: serverTimestamp() });
      x.commentN = (x.commentN || 0) + 1;
      await updateDoc(doc(col(), x.id), { commentN: x.commentN, lastAt: serverTimestamp() }).catch(() => {});
      m.el.querySelector('[data-cn]').textContent = x.commentN;
      e.target.reset();
      await loadComments();
    } catch (err) { fail(err); }
  };
  m.el.querySelector('[data-import]')?.addEventListener('click', async () => {
    try {
      await addDoc(collection(db, 'teams', state.team.id, 'posts'), {
        type: 'training', ...pg, title: `${pg.title}`, sharedFrom: { team: x.teamName || '', coach: x.authorName || '', postId: x.id },
        authorUid: state.user.uid, authorName: state.profile.name, createdAt: serverTimestamp(),
      });
      toast('우리 팀 훈련 프로그램에 넣었어요 — 훈련장 → 훈련 프로그램');
    } catch (err) { fail(err); }
  });
  m.el.querySelector('[data-edit]')?.addEventListener('click', () => { m.close(); write({ ...x }, refresh); });
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmBox('이 글을 지울까요?'))) return;
    try { await deleteDoc(doc(col(), x.id)); m.close(); refresh(); } catch (err) { fail(err); }
  });
}
