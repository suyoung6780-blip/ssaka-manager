import {
  db, collection, doc, query, where, orderBy, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch,
} from '../fb.js';
import {
  esc, text, toast, fail, formData, modal, confirmBox, fmtDate, todayStr, pageHead, empty, options, avatar,
  ROLES, MATCH_TYPES, sortGroups, sortBar, bindSortBar, getSort, byName } from '../ui.js';
import { state, isCoach, isOwner } from '../store.js';
import { createPad, formationData, is8 } from '../tactic.js';
import { keepDraft, fillFields, draftStrip } from '../drafts.js';

const tcol = (...p) => collection(db, 'teams', state.team.id, ...p);
const tdoc = (...p) => doc(db, 'teams', state.team.id, ...p);

// all: 입장 승인 대기 멤버까지 (락커룸 승인 목록용)
async function members(all = false) {
  const s = await getDocs(tcol('members'));
  return s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => all || m.approved !== false);
}
const nameOf = (list, id) => list.find((m) => m.id === id)?.name || '';

// ───────── 게임모델 ─────────
const PATTERN_CATS = ['빌드업', '공격', '수비', '전환', '세트피스', '기타'];
let patCat = '전체';
const MODEL_FIELDS = [
  ['philosophy', '팀 철학 · 스타일'],
  ['inPossession', '공격 원칙 (In Possession)'],
  ['outPossession', '수비 원칙 (Out of Possession)'],
  ['transition', '전환 (공격↔수비)'],
  ['setPieces', '세트피스'],
  ['rules', '팀 규칙'],
];

export async function gameModel(el) {
  const [snap, list] = await Promise.all([getDoc(tdoc('private', 'gameModel')), members()]);
  const gm = snap.data() || {};
  const players = list.filter((m) => m.role === 'player');

  const view = () => {
    el.innerHTML = `${pageHead('GAME MODEL', '게임모델', isCoach() ? '<button class="btn" data-edit>편집</button>' : '')}
    <div class="gm">
      <section class="card">
        <div class="card-head"><h3>기본 포메이션 ${esc(gm.formation || '')}${is8(gm.formation) ? ' <small class="muted">8대8</small>' : ''}</h3></div>
        <div data-pad></div>
      </section>
      <section class="card">
        <h3>주장단</h3>
        <div class="captains">
          ${[['captain', '주장', 'C'], ['viceCaptain', '부주장', 'VC'], ['viceCaptain2', '부주장', 'VC']].map(([k, l, b]) => {
            const m = list.find((x) => x.id === gm[k]);
            return `<div class="captain">${m ? avatar(m.photo, m.name, 'lg') : '<span class="avatar lg">-</span>'}<span class="badge">${b}</span><strong>${esc(m?.name || '미지정')}</strong><small>${l}</small></div>`;
          }).join('')}
        </div>
        ${MODEL_FIELDS.map(([k, l]) => gm[k] ? `<h4>${l}</h4><div class="prose">${text(gm[k])}</div>` : '').join('')}
        ${!MODEL_FIELDS.some(([k]) => gm[k]) ? empty('아직 게임모델이 작성되지 않았습니다.') : ''}
      </section>
    </div>
    <section class="gm-pats">
      <div class="card-head"><h2>패턴 · 작전판 <small class="muted">${(gm.patterns || []).length}개</small></h2>${isCoach() ? '<button class="btn sm" data-padd>+ 패턴 만들기</button>' : ''}</div>
      <div class="chips wrap">${['전체', ...PATTERN_CATS].map((c) => `<button class="chip ${c === patCat ? 'on' : ''}" data-pcat="${c}">${c}${c !== '전체' ? ` <small>${(gm.patterns || []).filter((x) => x.cat === c).length}</small>` : ''}</button>`).join('')}</div>
      ${isCoach() ? '<div data-pdrafts hidden></div>' : ''}<div class="pat-grid" data-pats></div>
    </section>`;
    createPad(el.querySelector('[data-pad]'), gm.pad || formationData(gm.formation || '4-3-3', false), { editable: false });
    el.querySelector('[data-edit]')?.addEventListener('click', edit);
    drawPats();
    el.querySelectorAll('[data-pcat]').forEach((b) => (b.onclick = () => { patCat = b.dataset.pcat; view(); }));
    el.querySelector('[data-padd]')?.addEventListener('click', () => patEditor(null));
    mountDrafts();
  };
  // 만들다 만 패턴 (새로 만들 때마다 따로 남음)
  let drawDrafts = () => {};
  const PSCOPE = () => `${state.team.id}/pattern`;
  const mountDrafts = () => {
    const box = el.querySelector('[data-pdrafts]');
    if (!box) return;
    drawDrafts = draftStrip(box, PSCOPE(), {
      label: '만들다 만 패턴',
      onResume: (d) => {
        const x = d.id.startsWith('new') ? null : (gm.patterns || []).find((p) => p.id === d.id);
        patEditor(x, d);
      },
    });
  };

  // ───────── 패턴 (세트피스 · 빌드업 등 작전판 여러 개) ─────────
  const savePats = async (patterns) => {
    await setDoc(tdoc('private', 'gameModel'), { patterns, updatedAt: serverTimestamp() }, { merge: true });
    gm.patterns = patterns;
  };
  function drawPats() {
    const box = el.querySelector('[data-pats]');
    const list = (gm.patterns || []).filter((x) => patCat === '전체' || x.cat === patCat);
    box.innerHTML = list.length ? list.map((x) => `<article class="pat-card" data-pid="${x.id}">
        <div data-pthumb></div>
        <div class="pat-body"><span class="tag">${esc(x.cat)}</span>${x.pad?.steps?.length ? ' <span class="tag">움직임</span>' : ''}<strong>${esc(x.title)}</strong></div></article>`).join('')
      : empty(isCoach() ? '아직 패턴이 없어요. [+ 패턴 만들기]로 코너킥 · 프리킥 · 빌드업 같은 약속을 작전판으로 남겨 보세요.' : '아직 등록된 패턴이 없어요.');
    box.querySelectorAll('[data-pid]').forEach((c) => {
      const x = gm.patterns.find((p) => p.id === c.dataset.pid);
      createPad(c.querySelector('[data-pthumb]'), x.pad, { editable: false, play: false });
      c.onclick = () => patView(x);
    });
  }
  function patView(x) {
    const m = modal(`<span class="eyebrow">${esc(x.cat)}</span><h2>${esc(x.title)}</h2>
      <div data-vpad></div>
      ${x.note ? `<div class="prose">${text(x.note)}</div>` : ''}
      ${isCoach() ? '<div class="row end"><button class="btn ghost sm" data-pdel>삭제</button><button class="btn sm" data-pedit>수정</button></div>' : ''}`, { wide: true });
    const vpad = createPad(m.el.querySelector('[data-vpad]'), x.pad, { editable: false });
    const onKey = (e) => {
      if (!m.el.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (!vpad.hasMotion() || e.target.closest?.('input, textarea, select')) return;
      if ([' ', 'Enter', 'ArrowRight'].includes(e.key)) { e.preventDefault(); vpad.play(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); vpad.reset(); }
    };
    document.addEventListener('keydown', onKey);
    m.el.querySelector('[data-pedit]')?.addEventListener('click', () => { m.close(); patEditor(x); });
    m.el.querySelector('[data-pdel]')?.addEventListener('click', async () => {
      if (!(await confirmBox(`'${x.title}' 패턴을 삭제할까요?`))) return;
      try { await savePats(gm.patterns.filter((p) => p.id !== x.id)); m.close(); toast('삭제했어요.'); view(); } catch (err) { fail(err); }
    });
  }
  function patEditor(x, dr = null) {
    const m = modal(`<span class="eyebrow">PATTERN</span><h2>${x ? '패턴 수정' : '패턴 만들기'}</h2>
      <form class="stack">
        <div class="grid2"><label>제목<input name="title" required maxlength="40" value="${esc(x?.title || '')}" placeholder="예) 오른쪽 코너킥 — 니어 포스트 런"></label>
          <label>종류<select name="cat">${PATTERN_CATS.map((c) => `<option ${c === (x?.cat || patCat) ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
        <div data-epad></div>
        <label>설명 <small class="muted">누가 · 언제 · 어떻게 (선수들이 함께 봐요)</small><textarea name="note" rows="3" maxlength="1500">${esc(x?.note || '')}</textarea></label>
        <div class="row end"><button type="button" class="btn ghost" data-cancel>취소</button><button class="btn">저장</button></div>
      </form>`, { wide: true });
    const form = m.el.querySelector('form');
    if (dr) fillFields(form, dr.fields);
    let keep = null;
    const pad = createPad(m.el.querySelector('[data-epad]'), dr?.pad || x?.pad || formationData('4-3-3', true), { motion: true, onChange: () => keep?.touch() });
    keep = keepDraft(form, { scope: PSCOPE(), id: x?.id, key: dr?.key, getPad: () => pad.getData() });
    m.onClose = () => { keep.close(); drawDrafts(); };
    m.el.querySelector('[data-cancel]').onclick = m.close;
    m.el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const d = formData(e.target);
      const item = { id: x?.id || `p${Date.now().toString(36)}`, title: d.title.trim(), cat: d.cat, note: d.note.trim(), pad: pad.getData() };
      const all = gm.patterns || [];
      const next = x ? all.map((p) => (p.id === x.id ? item : p)) : [...all, item];
      try { await savePats(next); keep.clear(); pad.clearDraft(); m.close(); toast('저장했어요.'); view(); } catch (err) { fail(err); }
    };
  }

  const edit = () => {
    el.innerHTML = `${pageHead('GAME MODEL', '게임모델 편집')}
    <form class="stack">
      <section class="card"><h3>포메이션 · 배치</h3><div data-pad></div></section>
      <section class="card">
        <div class="grid2">
          <label>주장<select name="captain"><option value="">-</option>${options(players.map((p) => [p.id, p.name]), gm.captain)}</select></label>
          <label>부주장 1<select name="viceCaptain"><option value="">-</option>${options(players.map((p) => [p.id, p.name]), gm.viceCaptain)}</select></label>
          <label>부주장 2<select name="viceCaptain2"><option value="">-</option>${options(players.map((p) => [p.id, p.name]), gm.viceCaptain2)}</select></label>
        </div>
        ${MODEL_FIELDS.map(([k, l]) => `<label>${l}<textarea name="${k}" rows="3">${esc(gm[k] || '')}</textarea></label>`).join('')}
        <div class="row end"><button type="button" class="btn ghost" data-cancel>취소</button><button class="btn">저장</button></div>
      </section>
    </form>`;
    const pad = createPad(el.querySelector('[data-pad]'), gm.pad || formationData('4-3-3', false), { motion: true, draft: `${state.team.id}/gamemodel` });
    el.querySelector('[data-cancel]').onclick = view;
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const d = formData(e.target);
      const padData = pad.getData();
      const next = { ...d, pad: padData, formation: padData.formation || '', patterns: gm.patterns || [], updatedAt: serverTimestamp() };
      try {
        await setDoc(tdoc('private', 'gameModel'), next);
        Object.assign(gm, next);
        pad.clearDraft();
        toast('저장했습니다.');
        view();
      } catch (err) { fail(err); }
    };
  };
  view();
}

// ───────── 락커룸 ─────────
export async function locker(el) {
  const list = await members(true);
  let code = '';
  if (isCoach()) {
    try { code = (await getDoc(tdoc('private', 'billing'))).data()?.code || ''; } catch { /* */ }
  }
  const group = (r) => list.filter((m) => m.role === r && m.approved !== false).sort((a, b) => (+a.number || 99) - (+b.number || 99));
  const waiting = isOwner() ? list.filter((m) => m.approved === false) : []; // 팀 대표만 승인

  el.innerHTML = `${pageHead('LOCKER ROOM', '락커룸', code ? `<button class="btn ghost" data-code>팀 코드 ${esc(code)} 복사</button>` : '')}
    <p class="lead">선수 · 지도자는 팀 코드로 입장을 신청하고, 팀 대표가 승인하면 락커룸에 들어옵니다.</p>
    ${waiting.length ? `<section class="card wait-box"><h3>입장 승인 대기 <small>${waiting.length}명</small></h3>
      <p class="muted small">팀 코드로 들어왔거나 다른 팀에서 이적해 온 사람이에요. 우리 팀 선수 · 지도자가 맞는지 확인하고 승인해 주세요. 승인 전에는 팀 내용을 볼 수 없어요.
        만 14세 미만은 보호자 동의 내용도 확인해 주세요.</p>
      <ul class="list">${waiting.map((m) => `<li><div><strong>${esc(m.name)} <span class="tag">${esc(ROLES[m.role] || '')}</span>${m.transferFrom ? ` <span class="tag solid">이적 · ${esc(m.transferFromName || '')}에서</span>` : ''}${m.under14 ? ' <span class="tag warn">만 14세 미만</span>' : ''}</strong>
        <small>${esc([m.position, m.number && `${m.number}번`, m.affiliation, m.coachTitle].filter(Boolean).join(' · ') || '')}</small>
        ${m.under14 ? `<small data-g="${esc(m.consentToken || '')}">보호자 정보 불러오는 중…</small>` : ''}</div>
        <span><button class="btn sm" data-gok="${m.id}">승인</button> <button class="link-btn small" data-grole="${m.id}">${m.role === 'coach' ? '선수로 바꾸기' : '지도자로 바꾸기'}</button> <button class="link-btn small" data-gno="${m.id}">거절</button></span></li>`).join('')}</ul></section>` : ''}
    ${['coach', 'player'].map((r) => {
      const g = group(r);
      if (!g.length) return '';
      const mode = getSort('locker');
      const card = (m) => playerCard(m);
      return `<div class="sec-row"><h2 class="sec-title">${ROLES[r]} <small>${g.length}</small></h2>${r === 'player' ? sortBar('locker', mode) : ''}</div>
      ${r === 'player' ? sortGroups(g, mode).map(([t, ps]) => `${t ? `<h3 class="sort-h">${esc(t)} <small>${ps.length}명</small></h3>` : ''}<div class="roster">${ps.map(card).join('')}</div>`).join('')
        : `<div class="roster">${g.map(card).join('')}</div>`}`;
    }).join('')}`;
  bindSortBar(el, 'locker', () => locker(el));

  el.querySelector('[data-code]')?.addEventListener('click', () => (navigator.clipboard?.writeText(code) || Promise.reject()).then(() => toast('팀 코드를 복사했습니다.'), () => toast(`복사가 안 돼요 — 팀 코드: ${code}`)));
  // 만 14세 미만: 보호자 정보(이름 · 관계 · 연락처)
  el.querySelectorAll('[data-g]').forEach(async (sm) => {
    try {
      const c = sm.dataset.g && (await getDoc(doc(db, 'consents', sm.dataset.g))).data();
      sm.textContent = c?.status === 'agreed' ? `보호자 ${c.guardianName} (${c.relation}) · ${c.phone.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3')} · 온라인 동의함` : '보호자 온라인 동의 기록 없음 — 직접 확인해 주세요';
    } catch { sm.textContent = '보호자 정보를 불러오지 못했어요'; }
  });
  el.querySelectorAll('[data-gok]').forEach((b) => (b.onclick = async () => {
    try {
      await updateDoc(tdoc('members', b.dataset.gok), { approved: true, approvedBy: state.profile.name, approvedAt: serverTimestamp() });
      toast('승인했어요. 이제 팀 내용을 볼 수 있어요.'); locker(el);
    } catch (e) { fail(e); }
  }));
  el.querySelectorAll('[data-grole]').forEach((b) => (b.onclick = () => changeRole(waiting.find((m) => m.id === b.dataset.grole))));
  el.querySelectorAll('[data-gno]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('입장을 거절할까요? 거절하면 팀에서 빠지고, 다시 팀 코드로 신청할 수 있어요.'))) return;
    try { await deleteDoc(tdoc('members', b.dataset.gno)); locker(el); } catch (e) { fail(e); }
  }));
  el.querySelectorAll('[data-pid]').forEach((c) => (c.onclick = (e) => {
    const m = list.find((x) => x.id === c.dataset.pid);
    // 팀 대표: 카드를 누르면 열리는 창 아래에서 계정 유형 바꾸기 · 이적 · 내보내기
    const canFix = isOwner() && m.id !== state.user.uid;
    const md = profileModal(m, canFix ? `<div class="mgr">
      <details class="role-edit"><summary>계정 유형 바꾸기</summary>
        <p class="muted small">지금은 <b>${ROLES[m.role]}</b> 계정이에요. 잘못 골라 가입했으면 바꿔 주세요. 그 사람은 새로고침하거나 다시 로그인하면 바뀐 화면을 써요.</p>
        <button type="button" class="btn sm" data-role>${m.role === 'coach' ? '선수로 바꾸기' : '지도자로 바꾸기'}</button></details>
      <details class="role-edit" data-tr><summary>다른 팀으로 이적</summary>
        <p class="muted small">보낼 팀을 찾아서 <b>이적 보내기</b>를 눌러요. 우리 팀에서 빠지고, 받는 팀 대표가 <b>승인</b>하면 그 팀에 들어가요. 우리 팀에서 쓴 일지 · 기록은 우리 팀에 남아요.</p>
        <input type="search" placeholder="팀 이름 · 대표 이름 검색" data-tq><ul class="team-results" data-tres></ul></details>
      <details class="role-edit"><summary>팀에서 내보내기</summary>
        <p class="muted small">내보내면 우리 팀에서 빠져요. 다시 들어오려면 팀 코드로 신청해야 해요.</p>
        <button type="button" class="btn ghost sm" data-kick>내보내기</button></details></div>` : '');
    md.el.querySelector('[data-role]')?.addEventListener('click', () => { md.close(); changeRole(m); });
    md.el.querySelector('[data-kick]')?.addEventListener('click', () => { md.close(); kick(m); });
    let teams = null;
    md.el.querySelector('[data-tq]')?.addEventListener('input', async (ev) => {
      const q = ev.target.value.trim().toLowerCase();
      const box = md.el.querySelector('[data-tres]');
      if (!q) { box.innerHTML = ''; return; }
      if (!teams) {
        box.innerHTML = '<li class="muted small">불러오는 중…</li>';
        try { teams = (await getDocs(query(collection(db, 'teams'), where('status', '==', 'active')))).docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => t.id !== state.team.id); } catch (err) { box.innerHTML = `<li class="muted small">${esc(err.message || err)}</li>`; return; }
      }
      const hit = teams.filter((t) => `${t.name || ''} ${t.ownerName || ''}`.toLowerCase().includes(q)).slice(0, 8);
      box.innerHTML = hit.length ? hit.map((t) => `<li class="talk"><a href="javascript:void 0"><span class="cat">${esc(t.category || '')}</span><strong>${esc(t.name)}</strong><span class="lock">${esc(t.ownerName || '')}</span></a><button type="button" class="btn sm" data-to="${t.id}">이적 보내기</button></li>`).join('') : '<li class="muted small">검색 결과가 없어요.</li>';
      box.querySelectorAll('[data-to]').forEach((b) => (b.onclick = () => transfer(m, teams.find((t) => t.id === b.dataset.to), md)));
    });
  }));

  // 계정 유형 바로잡기 (지도자가 선수로 잘못 가입했을 때 등) — 팀 대표만
  async function changeRole(m) {
    const to = m.role === 'coach' ? 'player' : 'coach';
    if (!(await confirmBox(`${m.name}님을 ${ROLES[m.role]} → ${ROLES[to]}(으)로 바꿀까요? 그 사람은 새로고침하거나 다시 로그인하면 ${ROLES[to]} 화면을 써요.`))) return;
    try {
      await updateDoc(tdoc('members', m.id), { role: to });
      await updateDoc(doc(db, 'users', m.id), { role: to });
      toast(`${m.name}님을 ${ROLES[to]}(으)로 바꿨어요.`); locker(el);
    } catch (e) { fail(e); }
  }

  // 이적: 받는 팀에 '승인 대기'로 넣고 우리 팀에서 뺌 (한 번에)
  async function transfer(m, to, md) {
    if (!(await confirmBox(`${m.name}님을 ${to.name} 팀으로 이적 보낼까요? 우리 팀에서 바로 빠지고, ${to.name} 대표가 승인하면 그 팀에 들어가요.`))) return;
    try {
      const old = (await getDoc(tdoc('members', m.id))).data() || {};
      const nm = { ...old };
      ['approvedBy', 'approvedAt', 'code', 'transferFrom', 'transferFromName'].forEach((k) => delete nm[k]);
      const b = writeBatch(db);
      b.set(doc(db, 'transfers', m.id), {
        uid: m.id, name: m.name || '', role: m.role, fromTeam: state.team.id, fromTeamName: state.team.name,
        toTeam: to.id, toTeamName: to.name, by: state.user.uid, byName: state.profile.name, at: serverTimestamp(),
      });
      b.set(doc(db, 'teams', to.id, 'members', m.id), { ...nm, approved: false, joinedAt: serverTimestamp(), transferFrom: state.team.id, transferFromName: state.team.name });
      b.update(doc(db, 'users', m.id), { teamId: to.id });
      b.delete(tdoc('members', m.id));
      await b.commit();
      md?.close();
      toast(`${m.name}님을 ${to.name} 팀으로 보냈어요. 그 팀 대표가 승인하면 들어가요.`);
      locker(el);
    } catch (e) { fail(e); }
  }

  async function kick(m) {
    if (!(await confirmBox(`${m.name}님을 팀에서 내보낼까요?`))) return;
    try { await deleteDoc(tdoc('members', m.id)); toast('내보냈습니다.'); locker(el); } catch (e) { fail(e); }
  }
}

export function playerCard(m, { manage = false, extra = '' } = {}) {
  return `<article class="pcard" data-pid="${m.id}">
    ${avatar(m.photo, m.name, 'card')}
    <div class="pcard-body">
      <div class="pcard-top">${m.role === 'coach'
        ? `<span class="pos">${esc(m.coachTitle || ROLES.coach)}</span>`
        : `${m.number ? `<span class="num">${esc(m.number)}</span>` : ''}<span class="pos">${esc(m.position || ROLES[m.role] || '')}</span>`}</div>
      <strong>${esc(m.name)}</strong>
      <small>${(m.role === 'coach'
        ? [m.duty, licenseText(m).split(', ')[0]]
        : [m.height && `${m.height}cm`, m.weight && `${m.weight}kg`]).filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</small>
      ${extra}
      ${manage ? '<button class="link-btn small" data-kick>내보내기</button>' : ''}
    </div>
  </article>`;
}

const licenseText = (m) => [m.licenses, m.licenseEtc].filter(Boolean).join(', ');

export function profileModal(m, actions = '') {
  const coach = m.role === 'coach';
  const kv = (k, v) => `<div class="kv"><span>${k}</span><strong>${esc(v || '-')}</strong></div>`;
  const rows = coach
    ? [kv('직책', m.coachTitle), kv('담당', m.duty), kv('자격증', licenseText(m)), kv('출신학교', m.school),
      m.career ? `<div class="kv top"><span>지도 경력</span><strong class="pre">${esc(m.career)}</strong></div>` : '']
    : [kv('소속', m.affiliation), kv('포지션', m.position), kv('키 · 몸무게', `${m.height || '-'}cm · ${m.weight || '-'}kg`),
      kv('주발', { R: '오른발', L: '왼발', B: '양발' }[m.foot]), kv('출생연도', m.birthYear)];
  return modal(`
    <div class="profile-view">
      ${avatar(m.photo, m.name, 'xl')}
      <div>
        <span class="eyebrow">${esc(m.teamName || '')} ${esc(ROLES[m.role] || '')}</span>
        <h2>${m.number && !coach ? `<span class="num">${esc(m.number)}</span> ` : ''}${esc(m.name)}</h2>
        ${rows.join('')}
      </div>
    </div>
    ${actions ? `<div class="row end">${actions}</div>` : ''}`);
}

// ───────── 기록실 ─────────
export function calcStats(ms) {
  const games = ms.length;
  const w = ms.filter((m) => +m.gf > +m.ga).length;
  const d = ms.filter((m) => +m.gf === +m.ga).length;
  const l = games - w - d;
  const gf = ms.reduce((s, m) => s + (+m.gf || 0), 0);
  const ga = ms.reduce((s, m) => s + (+m.ga || 0), 0);
  const pct = (n) => (games ? Math.round((n / games) * 1000) / 10 : 0);
  return {
    games, w, d, l, gf, ga, gd: gf - ga,
    winRate: pct(w), drawRate: pct(d), lossRate: pct(l),
    cleanSheets: ms.filter((m) => +m.ga === 0).length, csRate: pct(ms.filter((m) => +m.ga === 0).length),
    gfAvg: games ? (gf / games).toFixed(2) : '0.00', gaAvg: games ? (ga / games).toFixed(2) : '0.00',
    points: w * 3 + d,
  };
}

const result = (m) => (+m.gf > +m.ga ? 'W' : +m.gf === +m.ga ? 'D' : 'L');

// 팀 구분별 학년(연령) — 기록실에서 경기마다 고르고, 학년별로 모아 봄
export const AGE_GROUPS = { U12: ['U12', 'U11', 'U10', 'U9'], U15: ['U15', 'U14', 'U13'], U18: ['U18', 'U17', 'U16'], U22: ['U22', 'U21', 'U20', 'U19'] };

export async function records(el) {
  const [snap, list] = await Promise.all([getDocs(query(tcol('matches'), orderBy('date', 'desc'))), members()]);
  const ms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const players = list.filter((m) => m.role === 'player');
  const groups = AGE_GROUPS[state.team.category] || [];
  const years = [...new Set(ms.map((m) => (m.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const flt = { year: '전체', type: '전체', age: '전체' };
  const pass = (m, skip) => (skip === 'year' || flt.year === '전체' || (m.date || '').startsWith(flt.year))
    && (skip === 'type' || flt.type === '전체' || m.matchType === flt.type)
    && (skip === 'age' || flt.age === '전체' || m.ageGroup === flt.age);
  const statTable = (title, label, pairs) => `<section class="card"><h3>${title}</h3>${pairs.length ? `<table class="tbl"><tr><th>${label}</th><th>경기</th><th>승-무-패</th><th>승률</th><th>득/실</th></tr>
    ${pairs.map(([t, x]) => `<tr><td>${esc(t)}</td><td>${x.games}</td><td>${x.w}-${x.d}-${x.l}</td><td>${x.winRate}%</td><td>${x.gf}/${x.ga}</td></tr>`).join('')}</table>` : empty('기록 없음')}</section>`;

  const draw = () => {
    const rows = ms.filter((m) => pass(m));
    const st = calcStats(rows);
    const scorers = {};
    const assists = {};
    rows.forEach((m) => {
      (m.scorers || []).forEach((s) => { scorers[s.name] = (scorers[s.name] || 0) + (+s.goals || 0); assists[s.name] ||= 0; });
      (m.assists || []).forEach((s) => { assists[s.name] = (assists[s.name] || 0) + (+s.goals || 0); });
    });
    const topS = Object.entries(scorers).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topA = Object.entries(assists).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const typeList = [...MATCH_TYPES, ...new Set(ms.map((m) => m.matchType).filter((t) => t && !MATCH_TYPES.includes(t)))];
    const byType = typeList.map((t) => [t, calcStats(ms.filter((m) => pass(m, 'type') && m.matchType === t))]).filter(([, x]) => x.games);
    const byYear = years.map((y) => [`${y}년`, calcStats(ms.filter((m) => pass(m, 'year') && (m.date || '').startsWith(y)))]).filter(([, x]) => x.games);
    const byAge = [...groups, ...(ms.some((m) => !m.ageGroup) ? ['(학년 미지정)'] : [])]
      .map((g) => [g, calcStats(ms.filter((m) => pass(m, 'age') && (g === '(학년 미지정)' ? !m.ageGroup : m.ageGroup === g)))]).filter(([, x]) => x.games);
    const opp = {};
    rows.forEach((m) => (opp[m.opponent] ||= []).push(m));

    el.innerHTML = `${pageHead('RECORDS', '경기 기록실', isCoach() ? '<button class="btn" data-new>+ 경기 기록</button>' : '')}
    <div class="rec-filters">
      <div class="chips"><span class="chip-label">년도</span>${['전체', ...years].map((t) => `<button class="chip ${t === flt.year ? 'active' : ''}" data-f="year" data-v="${t}">${t === '전체' ? t : `${t}년`}</button>`).join('')}</div>
      <div class="chips"><span class="chip-label">경기</span>${['전체', ...MATCH_TYPES].map((t) => `<button class="chip ${t === flt.type ? 'active' : ''}" data-f="type" data-v="${t}">${t}</button>`).join('')}</div>
      ${groups.length ? `<div class="chips"><span class="chip-label">학년</span>${['전체', ...groups].map((t) => `<button class="chip ${t === flt.age ? 'active' : ''}" data-f="age" data-v="${t}">${t}</button>`).join('')}</div>` : ''}
    </div>
    <section class="stat-board">
      <div class="big"><small>승률</small><strong>${st.winRate}<i>%</i></strong>
        <div class="wdl"><i style="flex:${st.w}" class="w"></i><i style="flex:${st.d}" class="d"></i><i style="flex:${st.l}" class="l"></i></div>
        <small>${st.w}승 ${st.d}무 ${st.l}패 · ${st.games}경기</small></div>
      <div><small>득점</small><strong>${st.gf}</strong><small>경기당 ${st.gfAvg}</small></div>
      <div><small>실점</small><strong>${st.ga}</strong><small>경기당 ${st.gaAvg}</small></div>
      <div><small>골득실</small><strong>${st.gd > 0 ? '+' : ''}${st.gd}</strong><small>승점 ${st.points}</small></div>
      <div><small>클린시트</small><strong>${st.cleanSheets}</strong><small>${st.csRate}%</small></div>
      <div class="duo-cell"><small>무승부율 · 패배율</small><strong class="duo"><span><em>무</em>${st.drawRate}<i>%</i></span><span class="sep">/</span><span><em>패</em>${st.lossRate}<i>%</i></span></strong></div>
    </section>
    <div class="form-line">최근 경기 ${rows.slice(0, 10).map((m) => `<span class="res ${result(m)}">${result(m)}</span>`).join('') || '-'}</div>
    <div class="grid2 top">
      <section class="card"><h3>득점 순위</h3>${topS.length ? `<ol class="rank">${topS.map(([n, g]) => `<li><span>${esc(n)}</span><strong>${g}</strong></li>`).join('')}</ol>` : empty('기록 없음')}</section>
      <section class="card"><h3>도움 순위</h3>${topA.length ? `<ol class="rank">${topA.map(([n, g]) => `<li><span>${esc(n)}</span><strong>${g}</strong></li>`).join('')}</ol>` : empty('기록 없음')}</section>
    </div>
    <div class="rec-tables">
      ${statTable('년도별', '년도', byYear)}
      ${statTable('경기별', '형태', byType)}
      ${groups.length ? statTable('학년별', '학년', byAge) : ''}
    </div>
    <section class="card">
      <h3>상대 전적</h3>
      ${Object.keys(opp).length ? `<table class="tbl"><tr><th>상대</th><th>경기</th><th>승-무-패</th><th>승률</th><th>득/실</th></tr>
        ${Object.entries(opp).map(([o, arr]) => { const s = calcStats(arr); return `<tr><td>${esc(o)}</td><td>${s.games}</td><td>${s.w}-${s.d}-${s.l}</td><td>${s.winRate}%</td><td>${s.gf}/${s.ga}</td></tr>`; }).join('')}</table>` : empty('기록 없음')}
    </section>
    <section class="card">
      <h3>경기 목록</h3>
      ${rows.length ? `<table class="tbl matches"><tr><th>날짜</th><th>형태</th>${groups.length ? '<th>학년</th>' : ''}<th>상대</th><th>스코어</th><th>득점</th><th></th></tr>
        ${rows.map((m) => `<tr data-mid="${m.id}"><td>${esc(m.date)}</td><td>${esc(m.matchType)}</td>${groups.length ? `<td>${esc(m.ageGroup || '-')}</td>` : ''}<td>${esc(m.opponent)}${m.venue ? ` <small>(${m.venue === 'home' ? '홈' : '원정'})</small>` : ''}</td>
          <td><span class="res ${result(m)}">${result(m)}</span> <strong>${+m.gf} : ${+m.ga}</strong></td>
          <td><small>${(m.scorers || []).map((s) => `${esc(s.name)}${+s.goals > 1 ? `(${s.goals})` : ''}`).join(', ')}</small></td>
          <td>${isCoach() ? '<button class="link-btn small" data-edit>수정</button>' : ''}</td></tr>`).join('')}</table>` : empty('경기 기록이 없습니다.')}
    </section>`;

    el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { flt[b.dataset.f] = b.dataset.v; draw(); }));
    el.querySelector('[data-new]')?.addEventListener('click', () => matchForm());
    el.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => matchForm(ms.find((m) => m.id === b.closest('tr').dataset.mid))));
  };

  // 선수별 골/도움 입력 줄
  const pickRows = (label, key, arr = []) => `
    <fieldset class="picks" data-key="${key}"><legend>${label}</legend>
      <div data-rows>${arr.map((s) => pickRow(s)).join('')}</div>
      <button type="button" class="link-btn small" data-add>+ 추가</button>
    </fieldset>`;
  const pickRow = (s = {}) => `<div class="pick"><select><option value="">선수 선택</option>${options([...players].sort(byName).map((p) => p.name), s.name)}<option value="자책골" ${s.name === '자책골' ? 'selected' : ''}>상대 자책골</option></select>
    <input type="number" min="1" max="20" value="${esc(s.goals || 1)}"><button type="button" class="link-btn" data-rm>✕</button></div>`;

  function matchForm(m = {}) {
    const md = modal(`
      <span class="eyebrow">MATCH</span><h2>${m.id ? '경기 수정' : '경기 기록'}</h2>
      <form class="stack">
        <div class="grid2">
          <label>날짜<input type="date" name="date" required value="${esc(m.date || todayStr())}"></label>
          <label>경기 형태<select name="matchType">${options(MATCH_TYPES, m.matchType)}</select></label>
          ${groups.length ? `<label>학년<select name="ageGroup">${options([['', '선택'], ...groups], m.ageGroup || (flt.age !== '전체' ? flt.age : ''))}</select></label>` : ''}
          <label>상대팀<input name="opponent" required value="${esc(m.opponent || '')}"></label>
          <label>홈/원정<select name="venue">${options([['home', '홈'], ['away', '원정'], ['neutral', '중립']], m.venue)}</select></label>
          <label>득점<input type="number" name="gf" min="0" required value="${esc(m.gf ?? 0)}"></label>
          <label>실점<input type="number" name="ga" min="0" required value="${esc(m.ga ?? 0)}"></label>
        </div>
        ${pickRows('득점자', 'scorers', m.scorers)}
        ${pickRows('도움', 'assists', m.assists)}
        <label>메모<textarea name="memo" rows="3">${esc(m.memo || '')}</textarea></label>
        <div class="row end">${m.id ? '<button type="button" class="btn ghost" data-del>삭제</button>' : ''}<button class="btn">저장</button></div>
      </form>`);
    const f = md.el.querySelector('form');
    f.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => b.previousElementSibling.insertAdjacentHTML('beforeend', pickRow())));
    f.addEventListener('click', (e) => { if (e.target.matches('[data-rm]')) e.target.parentElement.remove(); });
    md.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmBox('경기 기록을 삭제할까요?'))) return;
      try { await deleteDoc(tdoc('matches', m.id)); md.close(); records(el); } catch (err) { fail(err); }
    });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = formData(f);
      const read = (key) => [...f.querySelectorAll(`[data-key="${key}"] .pick`)]
        .map((r) => ({ name: r.querySelector('select').value, goals: +r.querySelector('input').value || 1 }))
        .filter((s) => s.name);
      const data = { ...d, gf: +d.gf, ga: +d.ga, scorers: read('scorers'), assists: read('assists') };
      try {
        if (m.id) await updateDoc(tdoc('matches', m.id), data);
        else await addDoc(tcol('matches'), { ...data, createdAt: serverTimestamp() });
        md.close();
        records(el);
      } catch (err) { fail(err); }
    };
  }

  draw();
}

