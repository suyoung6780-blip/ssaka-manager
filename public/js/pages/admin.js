// 운영자 — 모든 팀 · 모든 사용자 화면 맨 위에 띄우는 '전체 공지' (system/notice 문서 하나)
import {
  auth, db, doc, getDoc, setDoc, getDocs, addDoc, deleteDoc, updateDoc, collection, query, where, serverTimestamp, writeBatch, Timestamp, sendEmailVerification,
} from '../fb.js';
import { esc, toast, fail, pageHead, fmtDate, CATEGORIES, normCat, confirmBox, modal } from '../ui.js';
import { genTeamCode } from './onboard.js';
import { state, go, hooks, compActive } from '../store.js';

const tabs = (cur) => `<div class="tabs admin-tabs">${[['/admin', '전체 공지'], ['/admin/teams', '전체 팀'], ['/admin/users', '전체 인원']].map(([h, l]) => `<a href="#${h}" class="${h === cur ? 'active' : ''}">${l}</a>`).join('')}</div>`;

const ref = () => doc(db, 'system', 'notice');
const text = (s) => esc(s).replace(/\n/g, '<br>');

const bannerHtml = (n, { preview = false } = {}) => `
  <div class="sys-notice ${n.level === 'important' ? 'important' : ''}">
    <span class="sys-tag">${n.level === 'important' ? '중요' : '공지'}</span>
    <div class="sys-body"><strong>${esc(n.title || '')}</strong>${n.body ? `<p>${text(n.body)}</p>` : ''}</div>
  </div>`;

// 화면 맨 위 배너 — 닫으면 이 공지(버전)는 다시 안 뜸, 운영자가 새로 저장하면 다시 뜸
export async function loadBanner(box) {
  if (!box) return;
  let n = null;
  try { const s = await getDoc(ref()); n = s.exists() ? s.data() : null; } catch { /* 읽기 실패 시 배너 없음 */ }
  // 운영자가 내릴 때까지 모두에게 계속 보임 (사용자가 닫을 수 없음)
  if (!n?.on || !n.title) { box.innerHTML = ''; return; }
  box.innerHTML = bannerHtml(n);
}

export async function page(el) {
  const [s, ts] = await Promise.all([getDoc(ref()), getDocs(collection(db, 'teams'))]);
  const n = s.exists() ? s.data() : { on: false, level: 'info', title: '', body: '' };
  const teams = ts.docs.map((d) => d.data());
  const free = teams.filter((t) => t.free).length;

  el.innerHTML = `${pageHead('ADMIN', '운영자')}${tabs('/admin')}
    <p class="lead">여기서 쓴 공지는 <strong>모든 팀 · 모든 사용자</strong>(지도자 · 선수, 팀 없는 사람 포함)의 화면 맨 위에 뜹니다. 사용자는 닫을 수 없고, 여기서 <b>공지 내리기</b>를 눌러야 사라져요.</p>
    <div class="admin-stats">
      <div><span>전체 팀</span><strong>${teams.length}</strong></div>
      <div><span>무료(시범) 팀</span><strong>${free}</strong></div>
      <a href="#/admin/teams" class="admin-more">팀 목록 보기 →</a>
    </div>
    <section class="card usage-card">
      <div class="card-head"><h3>오늘 Firebase 사용량 <small class="muted">모든 팀이 함께 쓰는 무료 한도</small></h3><button type="button" class="link-btn small" data-urefresh>새로고침</button></div>
      <div data-ubody class="muted small">불러오는 중…</div>
    </section>
    <form class="card">
      <div class="card-head"><h3>공지 쓰기</h3><span class="tag ${n.on ? 'solid' : ''}">${n.on ? '지금 띄우는 중' : '내려간 상태'}</span></div>
      <fieldset><legend>종류</legend><div class="pick-chips">
        <label><input type="radio" name="level" value="info" ${n.level !== 'important' ? 'checked' : ''}><span>일반 공지</span></label>
        <label><input type="radio" name="level" value="important" ${n.level === 'important' ? 'checked' : ''}><span>중요 (빨간 띠)</span></label>
      </div></fieldset>
      <label>제목<input name="title" required maxlength="80" value="${esc(n.title || '')}" placeholder="예) 12월 1일부터 유료로 전환됩니다"></label>
      <label>내용<textarea name="body" rows="4" maxlength="600" placeholder="예) 시범 운영에 참여해 주셔서 감사합니다. 기존 팀은 12월 31일까지 무료로 이용할 수 있어요.">${esc(n.body || '')}</textarea></label>
      <h3 class="sub">미리보기</h3>
      <div data-preview></div>
      <div class="row end">
        ${n.on ? '<button type="button" class="btn ghost" data-off>공지 내리기</button>' : ''}
        <button class="btn">${n.on ? '수정해서 다시 띄우기' : '모두에게 띄우기'}</button>
      </div>
      ${n.updatedAt ? `<p class="muted small">마지막 저장 ${fmtDate(n.updatedAt, true)} · ${esc(n.by || '')}</p>` : ''}
    </form>`;
  loadUsage(el);
  el.querySelector('[data-urefresh]').onclick = () => loadUsage(el);

  const form = el.querySelector('form');
  const val = () => ({ level: form.level.value, title: form.title.value.trim(), body: form.body.value.trim() });
  const preview = () => { el.querySelector('[data-preview]').innerHTML = bannerHtml({ ...val(), title: val().title || '(제목)' }, { preview: true }); };
  form.oninput = preview;
  preview();
  const save = async (on) => {
    try {
      await setDoc(ref(), { ...val(), on, ver: Date.now(), by: state.profile.name, updatedAt: serverTimestamp() });
      toast(on ? '모든 사용자 화면에 공지를 띄웠습니다.' : '공지를 내렸습니다.');
      await loadBanner(document.getElementById('sys-notice'));
      page(el);
    } catch (err) { fail(err); }
  };
  form.onsubmit = (e) => { e.preventDefault(); save(true); };
  el.querySelector('[data-off]')?.addEventListener('click', () => save(false));
}

// 팀별로 켤 수 있는 추가 기능 목록 — 새 기능을 만들면 여기에 추가
const TEAM_FEATURES = [
  ['wellness', '컨디션 엑셀', '오늘 기록에 훈련 시간 · 수면 질 칸 추가 + 일지검사에서 자각도 · 훈련 시간 · 훈련 부하 · 수면 시간 · 수면 질 엑셀 받기'],
];

// ───────── 전체 팀 목록 (운영자) ─────────
function usage(t) {
  if (t.comp) {
    if (!t.compUntil) return ['무료 제공 · 평생', 'comp'];
    return compActive(t) ? [`무료 제공 ~${fmtDate(t.compUntil)}`, 'comp'] : ['무료 제공 끝남', 'warn'];
  }
  if (t.free) return ['무료(시범)', ''];
  if (t.status === 'pending') return ['결제 대기', 'warn'];
  const until = t.paidUntil?.toMillis?.() || 0;
  return until > Date.now() ? [`유료 ~${fmtDate(t.paidUntil)}`, ''] : ['만료', 'warn'];
}

export async function teams(el) {
  el.innerHTML = `${pageHead('ADMIN', '운영자')}${tabs('/admin/teams')}<div class="loading">LOADING</div>`;
  const [ts, us] = await Promise.all([
    getDocs(collection(db, 'teams')),
    getDocs(collection(db, 'users')).catch(() => null),
  ]);
  let feats = {};
  try { feats = (await getDoc(doc(db, 'system', 'features'))).data()?.teams || {}; } catch { /* */ }
  const list = await Promise.all(ts.docs.map(async (d) => {
    const t = { id: d.id, ...d.data() };
    try { t.code = (await getDoc(doc(db, 'teams', d.id, 'private', 'billing'))).data()?.code || ''; } catch { t.code = ''; }
    try {
      const ms = (await getDocs(collection(db, 'teams', d.id, 'members'))).docs.map((m) => m.data());
      t.coaches = ms.filter((m) => m.role === 'coach').length;
      t.players = ms.filter((m) => m.role === 'player').length;
    } catch { t.coaches = t.players = null; }
    return t;
  }));
  const users = us ? us.docs.map((d) => d.data()) : null;
  const sum = (k) => list.reduce((a, t) => a + (t[k] || 0), 0);
  let q = '';
  let cat = '전체';

  el.innerHTML = `${pageHead('ADMIN', '운영자')}${tabs('/admin/teams')}
    <div class="admin-stats" data-stats></div>
    <div class="row admin-filter">
      <input type="search" placeholder="팀 이름 · 대표 이름 · 팀 코드(10자리) 검색" data-q>
      <select data-cat>${['전체', ...CATEGORIES].map((c) => `<option>${c}</option>`).join('')}</select>
    </div>
    <p class="muted small">'무료 제공'은 1 · 3 · 5 · 12개월 또는 평생으로 줄 수 있어요. 그 기간에는 유료로 바뀌어도 결제 없이 이용합니다.</p>
    <div class="card admin-table-wrap"><table class="tbl admin-table">
      <thead><tr><th>팀</th><th>구분</th><th>대표</th><th>지도자 · 선수</th><th>공개</th><th>팀 코드</th><th>이용</th><th>만든 날</th><th></th></tr></thead>
      <tbody data-rows></tbody></table></div>`;

  const draw = () => {
    el.querySelector('[data-stats]').innerHTML = `
      <div><span>전체 팀</span><strong>${list.length}</strong></div>
      <div><span>무료(시범)</span><strong>${list.filter((t) => t.free && !compActive(t)).length}</strong></div>
      <div><span>무료 제공(홍보)</span><strong>${list.filter((t) => compActive(t)).length}</strong></div>
      <div><span>팀 소속 지도자</span><strong>${sum('coaches')}</strong></div>
      <div><span>팀 소속 선수</span><strong>${sum('players')}</strong></div>
      ${users ? `<div><span>전체 가입자</span><strong>${users.length}</strong><small>팀 없음 ${users.filter((u) => !u.teamId).length}</small></div>` : ''}
`;
    const rows = list
      .filter((t) => (cat === '전체' || normCat(t.category) === cat)
        && (!q || `${t.name} ${t.ownerName || ''}`.toLowerCase().includes(q.toLowerCase()) || t.code === q))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    el.querySelector('[data-rows]').innerHTML = rows.map((t) => {
      const [u, cls] = usage(t);
      return `<tr>
        <td data-l="팀"><a href="#/teams/${t.id}"><strong>${esc(t.name)}</strong></a>${t.restricted ? '<br><span class="tag danger">기능 제한</span>' : ''}${t.nameWarn ? '<br><span class="tag warn">팀명 주의 중</span>' : ''}</td>
        <td data-l="구분">${esc(t.category || '')}</td>
        <td data-l="대표">${esc(t.ownerName || '-')}</td>
        <td data-l="지도자 · 선수">${t.coaches == null ? '-' : `${t.coaches} · ${t.players}`}</td>
        <td data-l="팀 코드"><code class="tcode">${esc(t.code || '-')}</code></td>
        <td data-l="이용"><span class="tag ${cls}">${u}</span></td>
        <td data-l="만든 날">${fmtDate(t.createdAt) || '-'}</td>
        <td data-l=""><div class="acts"><button class="btn ghost sm" data-feat="${t.id}">기능${Object.values(feats[t.id] || {}).filter(Boolean).length ? ` <b class="dot-n">${Object.values(feats[t.id]).filter(Boolean).length}</b>` : ''}</button>
          <button class="btn ${t.comp ? 'ghost' : ''} sm" data-comp="${t.id}">${t.comp ? '무료 제공 변경' : '무료 제공'}</button>
          <button class="btn ${t.nameWarn ? '' : 'ghost'} sm" data-nwarn="${t.id}">${t.nameWarn ? '팀명 주의 풀기' : '팀명 주의'}</button>
          <button class="btn ${t.restricted ? '' : 'ghost'} sm" data-restrict="${t.id}">${t.restricted ? '제한 풀기' : '기능 제한'}</button></div></td></tr>`;
    }).join('') || '<tr><td colspan="9" class="muted center">조건에 맞는 팀이 없습니다.</td></tr>';
    el.querySelectorAll('[data-comp]').forEach((b) => (b.onclick = () => toggleComp(list.find((t) => t.id === b.dataset.comp))));
    el.querySelectorAll('[data-feat]').forEach((b) => (b.onclick = () => featModal(list.find((t) => t.id === b.dataset.feat))));
    el.querySelectorAll('[data-nwarn]').forEach((b) => (b.onclick = () => nameWarn(list.find((t) => t.id === b.dataset.nwarn))));
    el.querySelectorAll('[data-restrict]').forEach((b) => (b.onclick = () => restrict(list.find((t) => t.id === b.dataset.restrict))));
  };

  // 팀 이름 주의: 팀 화면 위에 알림 띠 + 운영자 문의방에 메시지 (팀이 이름을 바꾸면 띠는 저절로 사라짐)
  async function nameWarn(t) {
    if (t.nameWarn) { // 이미 주의 중이면 풀기
      if (!(await confirmBox(`${t.name} 팀의 팀명 주의를 풀까요? 전체 팀 목록의 표시만 사라져요.`))) return;
      try { await updateDoc(doc(db, 'teams', t.id), { nameWarn: null }); t.nameWarn = null; toast('팀명 주의를 풀었어요.'); draw(); } catch (err) { fail(err); }
      return;
    }
    const msg = `[운영자 안내] 팀 이름 '${t.name}'(으)로는 어떤 팀인지 알아보기 어려워요. 팀 설정에서 실제 팀 이름(예: OO FC U15, OO초 축구부)으로 고쳐 주세요. 고치지 않으면 기능이 제한될 수 있어요.`;
    const m = modal(`<span class="eyebrow">NAME WARNING</span><h2>${esc(t.name)} 팀명 주의 보내기</h2>
      <p class="muted small">이 팀의 운영자 문의방에 아래 메시지가 가요. 전체 팀 목록에는 <b>팀명 주의 중</b> 표시가 남아요.</p>
      <label>보낼 메시지<textarea rows="4" data-msg maxlength="1000">${esc(msg)}</textarea></label>
      <div class="row end"><button class="btn" data-send>보내기</button></div>`);
    m.el.querySelector('[data-send]').onclick = async () => {
      const text = m.el.querySelector('[data-msg]').value.trim();
      if (!text) return;
      try {
        await updateDoc(doc(db, 'teams', t.id), { nameWarn: { name: t.name, at: Timestamp.fromMillis(Date.now()) } });
        await addDoc(collection(db, 'support', t.id, 'messages'), { text, uid: state.user.uid, name: state.profile.name, from: 'admin', createdAt: serverTimestamp() });
        await setDoc(doc(db, 'support', t.id), { teamId: t.id, teamName: t.name, category: t.category || '', lastMessage: text.slice(0, 80), lastFrom: 'admin', updatedAt: serverTimestamp(), unreadTeam: true, unreadAdmin: false }, { merge: true });
        t.nameWarn = { name: t.name };
        m.close(); toast(`${t.name} 팀에 팀명 주의를 보냈어요.`); draw();
      } catch (err) { fail(err); }
    };
  }

  // 기능 제한: 홈 · 팀 설정 · 운영자 문의 · 내 프로필 말고는 못 씀
  async function restrict(t) {
    const on = !t.restricted;
    if (!(await confirmBox(on ? `${t.name} 팀의 기능을 제한할까요? 이 팀은 홈 · 팀 설정 · 운영자 문의 · 내 프로필만 쓸 수 있어요.` : `${t.name} 팀의 기능 제한을 풀까요?`))) return;
    try {
      await updateDoc(doc(db, 'teams', t.id), { restricted: on, restrictedAt: Timestamp.fromMillis(Date.now()) });
      t.restricted = on;
      toast(on ? `${t.name} 팀의 기능을 제한했어요.` : `${t.name} 팀의 제한을 풀었어요.`); draw();
    } catch (err) { fail(err); }
  }

  // 팀별 추가 기능 켜기 · 끄기 (system/features — 이 팀 사람들에게만 보임)
  function featModal(t) {
    const cur = feats[t.id] || {};
    const m = modal(`<span class="eyebrow">TEAM FEATURES</span><h2>${esc(t.name)} 추가 기능</h2>
      <p class="muted">켠 기능은 이 팀 사람들에게만 보여요. 다른 팀은 바뀌지 않아요.</p>
      <div class="stack">${TEAM_FEATURES.map(([k, l, d]) => `<label class="feat-row"><input type="checkbox" data-k="${k}" ${cur[k] ? 'checked' : ''}><span><b>${l}</b><small>${d}</small></span></label>`).join('')}</div>
      <div class="row end"><button class="btn" data-save>저장</button></div>`);
    m.el.querySelector('[data-save]').onclick = async () => {
      const next = Object.fromEntries([...m.el.querySelectorAll('[data-k]')].map((c) => [c.dataset.k, c.checked]));
      try {
        await setDoc(doc(db, 'system', 'features'), { teams: { [t.id]: next } }, { merge: true });
        feats[t.id] = next; m.close(); toast(`${t.name}: 기능을 저장했어요.`); draw();
      } catch (err) { fail(err); }
    };
  }

  // 홍보용 무료 제공: 1 · 3 · 5 · 12개월 / 평생 (오늘부터), 해제
  const PERIODS = [[1, '1개월'], [3, '3개월'], [5, '5개월'], [12, '12개월'], [0, '평생']];
  function toggleComp(t) {
    const cur = t.comp ? (t.compMonths ?? 0) : 1;
    const m = modal(`<span class="eyebrow">FREE PASS</span><h2>${esc(t.name)} 무료 제공</h2>
      <p class="muted">${t.comp ? `지금: <strong>${usage(t)[0]}</strong>. 새로 고르면 <b>오늘부터</b> 다시 계산해요.` : '고른 기간 동안 결제 없이 이용합니다. 오늘부터 계산해요.'}</p>
      <div class="pick-chips comp-periods">${PERIODS.map(([n, l]) => `<label><input type="radio" name="months" value="${n}" ${n === cur ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <p class="muted small" data-until></p>
      <div class="row between">
        ${t.comp ? '<button class="btn ghost" data-off>무료 제공 해제</button>' : '<span></span>'}
        <button class="btn" data-ok>${t.comp ? '변경하기' : '무료 제공하기'}</button>
      </div>`);
    const months = () => +m.el.querySelector('[name=months]:checked').value;
    const untilOf = (n) => { if (!n) return null; const d = new Date(); d.setMonth(d.getMonth() + n); d.setHours(23, 59, 59, 0); return d; };
    const showUntil = () => { const u = untilOf(months()); m.el.querySelector('[data-until]').textContent = u ? `${fmtDate(u)} 까지 무료` : '기간 제한 없이 계속 무료'; };
    m.el.querySelectorAll('[name=months]').forEach((r) => (r.onchange = showUntil));
    showUntil();
    m.el.querySelector('[data-ok]').onclick = () => { m.close(); saveComp(t, months(), untilOf(months())); };
    m.el.querySelector('[data-off]')?.addEventListener('click', async () => {
      m.close();
      if (!(await confirmBox(`${t.name} 팀의 무료 제공을 해제할까요? ${t.free ? '무료(시범) 기간에는 그대로 이용합니다.' : '결제해야 이용할 수 있게 됩니다.'}`))) return;
      saveComp(t, null, null, false);
    });
  }

  async function saveComp(t, months, until, on = true) {
    try {
      const b = writeBatch(db);
      const patch = { comp: on, compMonths: on ? months : null, compUntil: on && until ? Timestamp.fromMillis(until.getTime()) : null,
        compBy: state.profile.name, compAt: serverTimestamp() };
      if (on && t.status === 'pending') patch.status = 'active';
      b.update(doc(db, 'teams', t.id), patch);
      let code = t.code;
      if (on && !code) { // 코드가 없는 팀(유료 모드의 결제 대기 팀)이면 코드도 발급
        for (let i = 0; i < 5 && !code; i++) { const c = genTeamCode(); if (!(await getDoc(doc(db, 'teamCodes', c))).exists()) code = c; }
        b.set(doc(db, 'teamCodes', code), { teamId: t.id, createdAt: serverTimestamp() });
        b.set(doc(db, 'teams', t.id, 'private', 'billing'), { code, issuedAt: serverTimestamp() });
      }
      await b.commit();
      Object.assign(t, patch, { code, status: patch.status || t.status });
      toast(on ? `${t.name}: ${usage(t)[0]}` : `${t.name} 팀의 무료 제공을 해제했습니다.`);
      draw();
    } catch (err) { fail(err); }
  }
  el.querySelector('[data-q]').oninput = (e) => { q = e.target.value.trim(); draw(); };
  el.querySelector('[data-cat]').onchange = (e) => { cat = e.target.value; draw(); };
  draw();
}

// ───────── 운영자 인증 (운영자 이메일로 가입했지만 아직 이메일 인증 전) ─────────
export function verify(el) {
  el.innerHTML = `${pageHead('ADMIN', '운영자 인증')}
    <div class="card narrow">
      <p>운영자 이메일(<strong>${esc(state.user.email)}</strong>)로 로그인했어요. 운영자 기능을 열려면 <b>이메일 인증</b>이 한 번 필요합니다.
        다른 사람이 이 이메일로 먼저 가입하더라도, 메일함을 열 수 없으니 운영자가 될 수 없어요.</p>
      <ol class="guide-steps">
        <li>아래 <b>인증 메일 보내기</b>를 눌러요</li>
        <li>메일함에서 인증 링크를 눌러요<small>안 보이면 스팸함도 확인해 주세요.</small></li>
        <li>돌아와서 <b>인증했어요</b>를 누르면 운영자 메뉴가 열려요</li>
      </ol>
      <div class="row end"><button class="btn ghost" data-send>인증 메일 보내기</button><button class="btn" data-done>인증했어요</button></div>
    </div>`;
  el.querySelector('[data-send]').onclick = async () => {
    try { await sendEmailVerification(auth.currentUser, { url: location.origin + location.pathname }); toast('인증 메일을 보냈습니다.'); } catch (err) { fail(err); }
  };
  el.querySelector('[data-done]').onclick = async () => {
    try {
      await auth.currentUser.reload();
      if (!auth.currentUser.emailVerified) return toast('아직 인증되지 않았어요. 메일의 링크를 먼저 눌러주세요.');
      await auth.currentUser.getIdToken(true); // 서버 규칙이 '인증됨'을 알도록 토큰 새로 받기
      state.user = auth.currentUser;
      hooks.updateShell();
      toast('운영자 권한이 열렸습니다.');
      go('/admin');
    } catch (err) { fail(err); }
  };
}

// ───────── 전체 인원: 가입한 지도자 (선수는 빼고) ─────────
export async function users(el) {
  el.innerHTML = `${pageHead('ADMIN', '운영자')}${tabs('/admin/users')}<div class="loading">LOADING</div>`;
  const [us, ts] = await Promise.all([
    getDocs(query(collection(db, 'users'), where('role', '==', 'coach'))),
    getDocs(collection(db, 'teams')),
  ]);
  const teamName = Object.fromEntries(ts.docs.map((d) => [d.id, d.data().name]));
  const ownerOf = new Set(ts.docs.map((d) => d.data().ownerUid));
  const list = us.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  let q = '';
  let only = '전체';

  el.innerHTML = `${pageHead('ADMIN', '운영자')}${tabs('/admin/users')}
    <div class="admin-stats" data-stats></div>
    <div class="row admin-filter">
      <input type="search" placeholder="이름 · 이메일 · 팀 이름 검색" data-q>
      <select data-only>${['전체', '팀 대표', '팀 소속', '팀 없음'].map((o) => `<option>${o}</option>`).join('')}</select>
    </div>
    <p class="muted small">가입한 <b>지도자</b>만 보여요. 선수는 나오지 않아요.</p>
    <div class="card admin-table-wrap"><table class="tbl admin-table">
      <thead><tr><th>이름</th><th>이메일</th><th>직책 · 담당</th><th>소속 팀</th><th>자격증</th><th>가입일</th></tr></thead>
      <tbody data-rows></tbody></table></div>`;

  const draw = () => {
    el.querySelector('[data-stats]').innerHTML = `
      <div><span>가입한 지도자</span><strong>${list.length}</strong></div>
      <div><span>팀 대표</span><strong>${list.filter((u) => ownerOf.has(u.id)).length}</strong></div>
      <div><span>팀 소속</span><strong>${list.filter((u) => u.teamId && teamName[u.teamId]).length}</strong></div>
      <div><span>팀 없음</span><strong>${list.filter((u) => !u.teamId || !teamName[u.teamId]).length}</strong></div>`;
    const rows = list.filter((u) => {
      const tn = teamName[u.teamId] || '';
      if (only === '팀 대표' && !ownerOf.has(u.id)) return false;
      if (only === '팀 소속' && !tn) return false;
      if (only === '팀 없음' && tn) return false;
      return !q || `${u.name} ${u.email} ${tn}`.toLowerCase().includes(q);
    });
    el.querySelector('[data-rows]').innerHTML = rows.map((u) => {
      const tn = teamName[u.teamId];
      return `<tr>
        <td data-l="이름"><strong>${esc(u.name || '-')}</strong>${ownerOf.has(u.id) ? ' <span class="tag comp">대표</span>' : ''}</td>
        <td data-l="이메일">${esc(u.email || '-')}</td>
        <td data-l="직책 · 담당">${esc([u.coachTitle, u.duty].filter(Boolean).join(' · ') || '-')}</td>
        <td data-l="소속 팀">${tn ? `<a href="#/teams/${u.teamId}">${esc(tn)}</a>` : '<span class="muted">없음</span>'}</td>
        <td data-l="자격증">${esc([u.licenses, u.licenseEtc].filter(Boolean).join(', ') || '-')}</td>
        <td data-l="가입일">${fmtDate(u.createdAt) || '-'}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="muted center">조건에 맞는 지도자가 없습니다.</td></tr>';
  };
  el.querySelector('[data-q]').oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  el.querySelector('[data-only]').onchange = (e) => { only = e.target.value; draw(); };
  draw();
}

// ── 오늘 Firebase 사용량 (운영자만) — /api/usage 가 Google Cloud Monitoring 에서 읽어 옴 ──
const USAGE_NAMES = { read: '읽기', write: '쓰기', delete: '삭제' };
async function loadUsage(el) {
  const box = el.querySelector('[data-ubody]');
  if (!box) return;
  box.textContent = '불러오는 중…';
  let d;
  try {
    const tok = await auth.currentUser?.getIdToken?.();
    const r = await fetch('/api/usage', { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
    d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  } catch (e) { box.innerHTML = `<p>사용량을 불러오지 못했어요: ${esc(e.message || e)}</p>`; return; }
  if (!d.configured) {
    box.innerHTML = `<p><b>아직 연결 설정이 안 됐어요.</b> Google Cloud 에서 '모니터링 뷰어' 서비스 계정 키를 만들어 Vercel 환경 변수 <code>GOOGLE_SA_JSON</code> 에 넣으면 여기서 보여요.</p>`;
    return;
  }
  if (d.needBilling) {
    box.innerHTML = `<p><b>무료 요금제(Spark)에서는 여기서 숫자를 볼 수 없어요.</b> Google 이 사용량 읽기를 결제 계정이 연결된(종량제 Blaze) 프로젝트에만 열어 줘요 — 종량제로 바꾸면 따로 설정 없이 바로 보여요.</p>
      <p>그 전까지는 <a href="https://console.firebase.google.com/project/ssaka-manager/firestore/databases/-default-/usage" target="_blank" rel="noopener">Firebase 콘솔 → Firestore → 사용량 ↗</a> 에서 확인하세요. (하루 한도: 읽기 5만 · 쓰기 2만 · 삭제 2만)</p>`;
    return;
  }
  if (d.error) { box.innerHTML = `<p>사용량을 읽는 중 문제가 생겼어요: ${esc(d.error)}</p>`; return; }
  const reset = new Date(d.reset); const at = new Date(d.at);
  const left = Math.max(0, reset - Date.now());
  const hm = `${Math.floor(left / 3600000)}시간 ${Math.floor((left % 3600000) / 60000)}분`;
  const kst = (x) => x.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' });
  const rows = Object.keys(USAGE_NAMES).map((k) => {
    const used = d.used[k] || 0; const lim = d.limits[k];
    const pct = Math.min(100, Math.round((used / lim) * 100));
    const lv = pct >= 85 ? 'hot' : pct >= 60 ? 'warm' : 'ok';
    return `<div class="usage-row ${lv}"><div class="usage-top"><b>${USAGE_NAMES[k]}</b><span>${used.toLocaleString()} / ${lim.toLocaleString()} <small>(${pct}%)</small></span><em>남은 ${Math.max(0, lim - used).toLocaleString()}번</em></div>
      <div class="usage-bar"><i style="width:${pct}%"></i></div></div>`;
  }).join('');
  const worst = Math.max(...Object.keys(USAGE_NAMES).map((k) => (d.used[k] || 0) / d.limits[k]));
  box.innerHTML = `${worst >= 0.85 ? '<p class="usage-warn">⚠️ 곧 무료 한도가 다 차요 — 다 차면 모든 사용자가 불러오기 · 저장을 못 해요. 종량제(Blaze)로 바꾸는 걸 생각해 보세요.</p>' : ''}
    ${rows}
    <p class="muted small">한국 시간 <b>${kst(reset)}</b>에 다시 채워져요 (${hm} 남음) · ${kst(at)} 기준 · 숫자는 몇 분 늦게 반영돼요${d.demo ? ' · 데모 예시 숫자' : ''}</p>`;
}
