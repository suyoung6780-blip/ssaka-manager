import {
  db, functions, httpsCallable, collection, doc, getDoc, addDoc, setDoc, updateDoc, serverTimestamp, writeBatch,
} from '../fb.js';
import { PLAN, TOSS_CLIENT_KEY, FREE_MODE } from '../config.js';
import {
  esc, toast, fail, formData, options, pageHead, modal, fmtDate, CATEGORIES, ROLES,
} from '../ui.js';
import { state, loadContext, go, publicProfile, teamActive, hooks, compActive } from '../store.js';

// ───────── 팀 코드: 10자리, 대문자 · 소문자 · 숫자 섞어서, 매번 새로 ─────────
// 헷갈리는 글자(0 O o · 1 I l)는 뺌 — 손으로 옮겨 적어도 틀리지 않게
const UP = 'ABCDEFGHJKLMNPQRSTUVWXYZ', LO = 'abcdefghijkmnpqrstuvwxyz', NUM = '23456789';
const ALL = UP + LO + NUM;
const pick = (chars) => {
  const lim = 256 - (256 % chars.length); // 치우침 없이 고르기
  const b = new Uint8Array(1);
  do crypto.getRandomValues(b); while (b[0] >= lim);
  return chars[b[0] % chars.length];
};
export function genTeamCode() {
  const c = [pick(UP), pick(LO), pick(NUM), ...Array.from({ length: 7 }, () => pick(ALL))];
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
  return c.join('');
}

export function codeModal(code, title = '팀 코드가 만들어졌어요') {
  const m = modal(`<span class="eyebrow">TEAM CODE</span><h2>${title}</h2>
    <p>선수 · 코치에게 이 코드를 알려주세요. <strong>대문자 · 소문자를 구분</strong>합니다.</p>
    <div class="code-big" data-copy>${esc(code)}</div>
    <div class="row between"><small class="muted">팀 설정에서 언제든 다시 볼 수 있어요.</small><button class="btn" data-copy-btn>코드 복사</button></div>`);
  const copy = () => navigator.clipboard?.writeText(code).then(() => toast('팀 코드를 복사했습니다.'), () => {});
  m.el.querySelector('[data-copy]').onclick = copy;
  m.el.querySelector('[data-copy-btn]').onclick = copy;
  return m;
}

export function createTeam(el) {
  if (state.team) return go('/');
  el.innerHTML = `${pageHead('CREATE TEAM', '팀계정 만들기')}
  <form class="card narrow">
    <label>팀 이름<input name="name" required maxlength="30"></label>
    <label>팀 구분<select name="category" required>${options(CATEGORIES)}</select></label>
    <label>팀 소개<textarea name="intro" rows="3" maxlength="300"></textarea></label>
    <label class="switch"><input type="checkbox" name="isPublic" checked><span>팀 공개 — 다른 팀이 선수단·프로필을 볼 수 있어요</span></label>
    ${FREE_MODE ? `<div class="price-box"><span>이용료</span><strong>무료</strong><small>만들면 바로 10자리 팀 코드가 발급됩니다</small></div>
    <button class="btn full">팀 만들고 코드 받기</button>` : `
    <div class="price-box">
      <span>월 이용료</span><strong>₩${PLAN.price.toLocaleString()}</strong><small>${PLAN.days}일 · 결제 완료 시 팀 코드가 발급됩니다</small>
    </div>
    <button class="btn full">다음 — 결제하기</button>`}
  </form>`;
  const form = el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(form);
    const btn = form.querySelector('button.btn');
    btn.disabled = true;
    try {
      const info = { name: d.name.trim(), category: d.category, intro: d.intro, isPublic: !!d.isPublic,
        ownerUid: state.user.uid, ownerName: state.profile.name, createdAt: serverTimestamp() };
      if (!FREE_MODE) {
        const ref = await addDoc(collection(db, 'teams'), { ...info, status: 'pending' });
        await updateDoc(doc(db, 'users', state.user.uid), { teamId: ref.id });
        await loadContext();
        return go('/pay');
      }
      // 무료: 팀 · 팀 코드 · 대표 지도자 입장을 한 번에 (하나라도 실패하면 전부 취소)
      const teamRef = doc(collection(db, 'teams'));
      let code = '';
      for (let i = 0; i < 5 && !code; i++) {
        const c = genTeamCode();
        if (!(await getDoc(doc(db, 'teamCodes', c))).exists()) code = c;
      }
      if (!code) throw new Error('팀 코드를 만들지 못했습니다. 다시 시도해 주세요.');
      const b = writeBatch(db);
      b.set(teamRef, { ...info, status: 'active', free: true });
      b.set(doc(db, 'teamCodes', code), { teamId: teamRef.id, createdAt: serverTimestamp() });
      b.set(doc(db, 'teams', teamRef.id, 'private', 'billing'), { code, issuedAt: serverTimestamp() });
      b.set(doc(db, 'teams', teamRef.id, 'members', state.user.uid), {
        ...publicProfile(state.profile), role: 'coach', joinedAt: serverTimestamp(),
      });
      b.update(doc(db, 'users', state.user.uid), { teamId: teamRef.id });
      await b.commit();
      await loadContext();
      hooks.updateShell();
      go('/');
      codeModal(code);
    } catch (err) { btn.disabled = false; fail(err); }
  };
}

export function pay(el) {
  const t = state.team;
  const renew = teamActive();
  el.innerHTML = `${pageHead('PAYMENT', renew ? '이용기간 연장' : '팀 이용권 결제')}
  <div class="card narrow">
    <div class="kv"><span>팀</span><strong>${esc(t.name)} · ${esc(t.category)}</strong></div>
    <div class="kv"><span>상품</span><strong>${esc(PLAN.name)}</strong></div>
    ${t.paidUntil ? `<div class="kv"><span>현재 만료일</span><strong>${fmtDate(t.paidUntil)}</strong></div>` : ''}
    <div class="price-box"><span>결제 금액</span><strong>₩${PLAN.price.toLocaleString()}</strong></div>
    <button class="btn full" data-pay>카드로 결제하기</button>
    ${TOSS_CLIENT_KEY.startsWith('test_') ? '<p class="muted small center">테스트 모드 — 실제 출금되지 않습니다.</p>' : ''}
  </div>`;
  el.querySelector('[data-pay]').onclick = async () => {
    if (typeof window.TossPayments !== 'function') return toast('결제 모듈을 불러오지 못했습니다.');
    try {
      const toss = window.TossPayments(TOSS_CLIENT_KEY);
      const payment = toss.payment({ customerKey: state.user.uid });
      const back = location.origin + location.pathname;
      await payment.requestPayment({
        method: 'CARD',
        amount: { currency: 'KRW', value: PLAN.price },
        orderId: `${t.id}-${Date.now()}`,
        orderName: PLAN.name,
        successUrl: `${back}?pay=success`,
        failUrl: `${back}?pay=fail`,
        customerEmail: state.user.email,
        customerName: state.profile.name,
      });
    } catch (err) {
      if (err?.code !== 'USER_CANCEL') fail(err);
    }
  };
}

// 결제 성공 리다이렉트 후 서버(Cloud Functions)에서 승인 → 팀 활성화 + 팀 코드 발급
export async function confirmPayment(params) {
  const m = modal('<div class="loading">결제 승인 중…</div>');
  try {
    const res = await httpsCallable(functions, 'confirmPayment')(params);
    await loadContext();
    m.el.innerHTML = `<button class="modal-x">✕</button>
      <span class="eyebrow">PAYMENT COMPLETE</span><h2>결제 완료</h2>
      <p>팀 코드가 발급되었습니다. 선수들에게 이 코드를 공유하세요.</p>
      <div class="code-big">${esc(res.data.code)}</div>
      <p class="muted small">이용 만료일 ${fmtDate(res.data.paidUntil)}</p>`;
    location.hash = '#/settings';
  } catch (err) {
    m.close();
    fail(err);
  }
}

export function joinTeam(el) {
  if (state.team && state.member) return go('/');
  el.innerHTML = `${pageHead('JOIN TEAM', '팀 코드로 입장')}
  <form class="card narrow">
    <p class="muted">팀 대표 지도자에게 받은 10자리 팀 코드를 입력하세요. <strong>대문자 · 소문자를 구분</strong>합니다. ${ROLES[state.profile.role]} 계정으로 입장합니다.</p>
    <input name="code" class="code-input" minlength="10" maxlength="10" required autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="10자리 코드">
    <button class="btn full">팀 찾기</button>
    <p class="muted small center">아직 코드가 없나요? 팀 대표 지도자에게 받으면 돼요. <a href="#/">나중에 입력할게요 →</a></p>
  </form>`;
  const form = el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const code = form.code.value.replace(/\s/g, '');
    if (!/^[A-Za-z0-9]{10}$/.test(code)) return toast('팀 코드는 영문 · 숫자 10자리입니다.');
    try {
      const c = await getDoc(doc(db, 'teamCodes', code));
      if (!c.exists()) return toast('존재하지 않는 코드입니다.');
      const teamId = c.data().teamId;
      const t = await getDoc(doc(db, 'teams', teamId));
      const team = t.data();
      const m = modal(`<span class="eyebrow">${esc(team.category)}</span><h2>${esc(team.name)}</h2>
        <p>이 팀에 <strong>${ROLES[state.profile.role]}</strong>(으)로 입장할까요?</p>
        <div class="row end"><button class="btn" data-ok>입장하기</button></div>`);
      m.el.querySelector('[data-ok]').onclick = async () => {
        try {
          await setDoc(doc(db, 'teams', teamId, 'members', state.user.uid), {
            ...publicProfile(state.profile), role: state.profile.role, code, joinedAt: serverTimestamp(),
            approved: false, // 팀 대표가 승인해야 팀 내용을 볼 수 있음
            ...(state.profile.under14 ? { under14: true, consentToken: state.profile.consentToken } : {}),
          });
          await updateDoc(doc(db, 'users', state.user.uid), { teamId });
          m.close();
          await loadContext();
          toast(`${team.name} 락커룸에 입장했습니다.`);
          go('/');
        } catch (err) {
          fail(err.code === 'permission-denied' ? { message: '입장할 수 없습니다. (팀 이용기간 만료 또는 코드 오류)' } : err);
        }
      };
    } catch (err) { fail(err); }
  };
}

export async function settings(el) {
  const t = state.team;
  let billing = {};
  try {
    const b = await getDoc(doc(db, 'teams', t.id, 'private', 'billing'));
    billing = b.data() || {};
  } catch { /* 결제 전 */ }

  el.innerHTML = `${pageHead('SETTINGS', FREE_MODE ? '팀 설정' : '팀 설정 · 결제')}
  <div class="grid2 top">
    <section class="card">
      <h3>팀 코드</h3>
      ${billing.code
        ? `<div class="code-big" data-copy>${esc(billing.code)}</div><p class="muted small">클릭하면 복사됩니다. 선수 · 코치가 이 코드로 입장합니다. 대문자 · 소문자를 구분해요.</p>`
        : '<p class="muted">결제 완료 후 발급됩니다.</p>'}
      ${compActive(t) ? `<h3>이용</h3><div class="kv"><span>상태</span><strong>무료 제공 팀 · ${t.compUntil ? `${fmtDate(t.compUntil)} 까지` : '평생'} (결제 필요 없음)</strong></div>` : FREE_MODE ? '' : `<h3>이용권</h3>
      <div class="kv"><span>상태</span><strong>${teamActive() ? '이용 중' : t.status === 'pending' ? '결제 대기' : '만료'}</strong></div>
      ${t.paidUntil ? `<div class="kv"><span>만료일</span><strong>${fmtDate(t.paidUntil)}</strong></div>` : ''}
      <a class="btn full" href="#/pay">${t.paidUntil ? '30일 연장 결제' : '결제하기'}</a>`}
    </section>
    <form class="card">
      <h3>팀 정보</h3>
      <label>팀 이름<input name="name" required maxlength="30" value="${esc(t.name)}"></label>
      <label>팀 구분<select name="category">${options(CATEGORIES, t.category)}</select></label>
      <label>팀 소개<textarea name="intro" rows="3" maxlength="300">${esc(t.intro || '')}</textarea></label>
      <label class="switch"><input type="checkbox" name="isPublic" ${t.isPublic ? 'checked' : ''}><span>팀 공개 (비공개면 다른 팀은 아무것도 볼 수 없어요)</span></label>
      <button class="btn">저장</button>
    </form>
  </div>`;
  el.querySelector('[data-copy]')?.addEventListener('click', () => {
    navigator.clipboard.writeText(billing.code).then(() => toast('팀 코드를 복사했습니다.'));
  });
  const form = el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(form);
    const patch = { name: d.name.trim(), category: d.category, intro: d.intro, isPublic: !!d.isPublic };
    try {
      await updateDoc(doc(db, 'teams', t.id), patch);
      Object.assign(state.team, patch);
      hooks.updateShell();
      toast('저장했습니다.');
    } catch (err) { fail(err); }
  };
}
