// 개인정보 처리방침 · 가입 동의 · 만 14세 미만 보호자 동의 · 회원 탈퇴
import {
  auth, db, doc, collection, query, where, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp,
  reauthenticateWithCredential, EmailAuthProvider, deleteUser, signOut,
} from '../fb.js';
import { esc, toast, fail, modal, confirmBox } from '../ui.js';
import { state, loadContext, go, isOwner } from '../store.js';
import { PRIVACY } from '../config.js';

export const POLICY_VER = PRIVACY.effective;
const brand = `<div class="brand"><span>SSAKA</span><span>MANAGER</span><small>축구팀을 위한 매니지먼트 플랫폼</small></div>`;

// ───────── 처리방침 본문 ─────────
const OVERSEAS = [
  ['Google LLC (Firebase)', '미국 등 Google 데이터센터 (데이터베이스는 서울 리전)', '계정(이메일 · 암호화된 비밀번호), 프로필, 팀 · 일지 · 건강 정보 등 서비스 이용 기록, 업로드한 영상 · 파일', '로그인 · 데이터 저장 · 파일 보관'],
  ['Vercel Inc.', '미국', '접속 기록(IP 주소, 접속 시각, 브라우저 정보)', '웹사이트 제공(호스팅)'],
];

export function policyHtml() {
  return `<div class="policy">
  <p>싸카매니저(이하 "서비스")는 「개인정보 보호법」에 따라 이용자의 개인정보를 보호하고, 관련 고충을 신속하게 처리하기 위해 다음과 같이 개인정보 처리방침을 둡니다.</p>

  <h3>1. 수집하는 개인정보 항목</h3>
  <table class="tbl"><tbody>
    <tr><th>모든 회원 (필수)</th><td>이메일, 비밀번호(암호화되어 보관), 이름, 계정 유형(지도자 · 선수)</td></tr>
    <tr><th>선수 (필수)</th><td>생년월일</td></tr>
    <tr><th>선수 (선택)</th><td>사진, 키, 몸무게, 포지션, 등번호, 주발, 소속(학교 · 학년 · 클럽), 소개</td></tr>
    <tr><th>지도자 (선택)</th><td>사진, 직책, 담당, 자격증, 출신학교, 지도 경력</td></tr>
    <tr><th>건강 정보 (민감정보, 선수 필수 · 별도 동의)</th><td>컨디션, 통증 · 부상 정도와 부위, 수면 시간, 운동 강도(RPE)</td></tr>
    <tr><th>서비스 이용 중 생성</th><td>훈련 · 경기 일지, 목표, 상담 내용, 대화 내용, 분석실 영상 · 그림, 스카우터 메모(지도자), 문의 · 개선 제안</td></tr>
    <tr><th>만 14세 미만 회원의 보호자</th><td>보호자 이름, 관계, 휴대폰 번호, 동의 일시</td></tr>
    <tr><th>자동 수집</th><td>접속 기록(IP 주소, 접속 시각, 브라우저 정보)</td></tr>
  </tbody></table>

  <h3>2. 개인정보의 이용 목적</h3>
  <ul><li>회원 가입 · 로그인 · 본인 확인, 비밀번호 재설정</li>
    <li>팀 운영 기능 제공: 훈련 안내, 공지 · 스케줄, 일지 작성과 지도자의 일지검사, 목표 · 상담, 영상 분석, 대화</li>
    <li>선수의 컨디션 · 부상 관리를 위한 건강 정보 기록과 소속 팀 지도자 열람</li>
    <li>만 14세 미만 회원의 법정대리인 동의 확인</li>
    <li>문의 응대, 서비스 개선, 부정 이용 방지</li></ul>

  <h3>3. 보유 및 이용 기간</h3>
  <p>회원 탈퇴 시까지 보유하며, 탈퇴하면 지체 없이 파기합니다. 다만 관련 법령에 따라 보존이 필요한 경우(예: 「통신비밀보호법」에 따른 접속 기록 3개월)에는 그 기간 동안 보관합니다.</p>

  <h3>4. 개인정보의 제3자 제공</h3>
  <p>서비스는 이용자의 개인정보를 외부에 제공하지 않습니다. 다만 서비스 기능상 다음 범위에서 다른 이용자에게 보입니다.</p>
  <ul><li>같은 팀 지도자: 소속 선수의 프로필, 일지, 건강 정보, 목표, 상담 내용</li>
    <li>같은 팀 구성원: 이름, 사진, 포지션 등 프로필(락커룸 · 선수단)</li>
    <li>만 14세 미만 선수의 보호자 정보(이름 · 관계 · 휴대폰 번호): 팀 대표가 입장 승인 때 보호자 동의를 확인하는 데 씁니다</li>
    <li>다른 팀: 팀이 '공개'로 설정한 경우에 한해 선수단 프로필(이름, 사진, 포지션, 키 · 몸무게, 소속 등). 일지 · 건강 정보는 보이지 않습니다.</li></ul>

  <h3>5. 개인정보 처리 위탁 및 국외 이전</h3>
  <p>서비스는 원활한 운영을 위해 아래와 같이 개인정보 처리를 위탁하며, 이 과정에서 개인정보가 국외로 이전됩니다. 이전은 서비스 이용 시 네트워크를 통해 수시로 이루어지며, 보유 기간은 회원 탈퇴 시 또는 위탁 계약 종료 시까지입니다.</p>
  <table class="tbl"><thead><tr><th>이전받는 자</th><th>국가</th><th>이전 항목</th><th>목적</th></tr></thead><tbody>
    ${OVERSEAS.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}
  </tbody></table>
  <p class="muted small">국외 이전을 원하지 않으면 동의하지 않을 수 있으나, 이 경우 서비스를 이용할 수 없습니다. 각 회사의 개인정보 보호 연락처: Google — policies.google.com/privacy, Vercel — privacy@vercel.com</p>

  <h3>6. 만 14세 미만 아동의 개인정보</h3>
  <p>만 14세 미만 아동의 개인정보는 법정대리인(보호자)의 동의를 받은 뒤에 처리합니다. 가입 시 보호자에게 동의 링크를 보내 보호자가 동의하고, 팀에 입장을 신청하면 팀 대표가 보호자 동의를 한 번 더 확인한 뒤 승인합니다. 두 가지가 끝나기 전에는 팀 내용 열람 · 일지 작성 등 서비스를 이용할 수 없습니다. 보호자는 아동의 개인정보 열람 · 정정 · 삭제를 요청할 수 있습니다.</p>

  <h3>7. 민감정보(건강 정보)의 처리</h3>
  <p>컨디션 · 통증 · 수면 등 건강 정보는 별도의 동의를 받아 처리하며, 본인과 소속 팀 지도자만 열람할 수 있습니다.</p>

  <h3>8. 파기 절차 및 방법</h3>
  <p>보유 기간이 끝나거나 회원이 탈퇴하면 데이터베이스에서 해당 정보를 삭제하여 복구할 수 없도록 합니다. 회원은 <b>내 프로필 → 회원 탈퇴</b>에서 직접 계정과 개인 기록을 삭제할 수 있습니다.</p>

  <h3>9. 이용자와 법정대리인의 권리</h3>
  <p>이용자(만 14세 미만은 보호자)는 언제든지 개인정보의 열람 · 정정 · 삭제 · 처리정지를 요청할 수 있습니다. 내 프로필에서 직접 수정하거나 탈퇴할 수 있고, 아래 보호책임자에게 요청할 수도 있습니다.</p>

  <h3>10. 안전성 확보 조치</h3>
  <ul><li>모든 통신은 암호화(HTTPS)되어 전송됩니다.</li>
    <li>비밀번호는 암호화되어 저장되며 운영자도 볼 수 없습니다.</li>
    <li>데이터베이스 접근 규칙으로 본인 · 소속 팀 지도자 외에는 개인 기록을 볼 수 없게 제한합니다.</li></ul>

  <h3>11. 개인정보 보호책임자</h3>
  <p>${esc(PRIVACY.officer)} · 이메일 ${esc(PRIVACY.email)}<br>서비스 안의 <b>운영자 문의</b>로도 요청할 수 있습니다.</p>

  <h3>12. 권익침해 구제 방법</h3>
  <p>개인정보침해 신고센터 (국번없이) 118 · 개인정보 분쟁조정위원회 1833-6972 · 대검찰청 사이버수사과 1301 · 경찰청 사이버수사국 182</p>

  <h3>13. 시행일</h3>
  <p>이 처리방침은 ${esc(PRIVACY.effective)}부터 적용됩니다.</p>
  </div>`;
}

export function page(el) {
  el.innerHTML = `${state.profile ? '' : brand}<article class="card policy-card">
    <span class="eyebrow">PRIVACY POLICY</span><h1>개인정보 처리방침</h1>${policyHtml()}
    ${state.user ? '' : '<div class="row end"><a class="btn ghost" href="#/signup">회원가입으로</a></div>'}
  </article>`;
}
export const showPolicy = () => modal(`<span class="eyebrow">PRIVACY POLICY</span><h2>개인정보 처리방침</h2>${policyHtml()}`, { wide: true });

// ───────── 가입 동의 (개인계정 만들기 화면) ─────────
export function agreeFields() {
  return `<fieldset class="agree"><legend>동의</legend>
    <label class="chk all"><input type="checkbox" data-agall> <b>모두 동의합니다</b></label>
    <label class="chk"><input type="checkbox" name="agPrivacy" required> [필수] 개인정보 수집 · 이용 동의 <button type="button" class="link-btn small" data-policy>보기</button></label>
    <label class="chk"><input type="checkbox" name="agOverseas" required> [필수] 개인정보 국외 이전 동의 (Google · Vercel, 미국) <button type="button" class="link-btn small" data-policy>보기</button></label>
    <div data-for="player"><label class="chk"><input type="checkbox" name="agHealth" required> [필수] 건강 정보(컨디션 · 통증 · 수면) 처리 동의 — 본인과 소속 팀 지도자만 봐요</label>
      <label class="birth">생년월일 <small class="muted">(만 14세 미만이면 보호자 동의가 필요해요)</small><input type="date" name="birth" required max="${new Date().toISOString().slice(0, 10)}"></label>
      <p class="muted small" data-agenote></p></div>
    <div data-for="coach"><label class="chk"><input type="checkbox" name="agAdult" required> [필수] 만 14세 이상입니다</label></div>
  </fieldset>`;
}
export const ageOf = (birth) => {
  const b = new Date(`${birth}T00:00`); const n = new Date();
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
};
export function bindAgree(form) {
  const boxes = () => [...form.querySelectorAll('.agree input[type=checkbox]:not([data-agall])')].filter((c) => !c.disabled);
  form.querySelector('[data-agall]').onchange = (e) => boxes().forEach((c) => { c.checked = e.target.checked; });
  form.querySelectorAll('[data-policy]').forEach((b) => (b.onclick = showPolicy));
  const note = form.querySelector('[data-agenote]');
  form.querySelector('[name=birth]').oninput = (e) => {
    const v = e.target.value;
    note.textContent = v ? (ageOf(v) < 14 ? `만 ${ageOf(v)}세 — 가입 후 보호자에게 동의 링크를 보내야 해요.` : `만 ${ageOf(v)}세`) : '';
  };
}
// 가입 저장 데이터: 동의 체크값은 빼고 동의 기록 · 나이 · 보호자 동의 대기 정보로
export function agreeData(d) {
  const player = d.role === 'player';
  const under14 = player && d.birth ? ageOf(d.birth) < 14 : false;
  const out = { ...d };
  ['agPrivacy', 'agOverseas', 'agHealth', 'agAdult'].forEach((k) => delete out[k]);
  out.agree = { ver: POLICY_VER, privacy: true, overseas: true, health: player, at: new Date().toISOString() };
  out.under14 = under14;
  if (player && d.birth && !d.birthYear) out.birthYear = d.birth.slice(0, 4);
  if (under14) { out.guardianOk = false; out.consentToken = token(); }
  return out;
}
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');
export const consentUrl = (tk) => `${location.origin}${location.pathname}#/consent/${tk}`;
export const needGuardian = () => !!state.profile?.under14 && !state.profile?.guardianOk;

// ───────── 동의 받기 (처리방침이 생기기 전에 가입한 회원 — 한 번만) ─────────
export const needAgree = () => !!state.profile && !state.profile.agree;
export function agreeGate(el) {
  const player = state.profile.role === 'player';
  el.innerHTML = `${brand}<form class="card auth-card wide">
    <h2>개인정보 처리 동의</h2>
    <p class="muted">싸카매니저에 <b>개인정보 처리방침</b>이 새로 생겼어요. 계속 쓰려면 아래 내용에 한 번 동의해 주세요.</p>
    <fieldset class="agree"><legend>동의</legend>
      <label class="chk all"><input type="checkbox" data-agall> <b>모두 동의합니다</b></label>
      <label class="chk"><input type="checkbox" required> [필수] 개인정보 수집 · 이용 동의 <button type="button" class="link-btn small" data-policy>보기</button></label>
      <label class="chk"><input type="checkbox" required> [필수] 개인정보 국외 이전 동의 (Google · Vercel, 미국) <button type="button" class="link-btn small" data-policy>보기</button></label>
      ${player ? '<label class="chk"><input type="checkbox" required> [필수] 건강 정보(컨디션 · 통증 · 수면) 처리 동의</label>' : '<label class="chk"><input type="checkbox" required> [필수] 만 14세 이상입니다</label>'}
    </fieldset>
    <button class="btn full">동의하고 계속하기</button>
    <div class="row between small"><a href="#/privacy">개인정보 처리방침</a><button type="button" class="link-btn" data-out>로그아웃 (동의하지 않으면 탈퇴를 요청할 수 있어요)</button></div>
  </form>`;
  const form = el.querySelector('form');
  form.querySelector('[data-agall]').onchange = (e) => form.querySelectorAll('.agree input:not([data-agall])').forEach((c) => { c.checked = e.target.checked; });
  form.querySelectorAll('[data-policy]').forEach((b) => (b.onclick = showPolicy));
  el.querySelector('[data-out]').onclick = () => signOut(auth);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await updateDoc(doc(db, 'users', state.user.uid), { agree: { ver: POLICY_VER, privacy: true, overseas: true, health: player, at: new Date().toISOString(), late: true } });
      await loadContext();
      toast('동의해 주셔서 감사합니다.');
      go(location.hash.slice(1) || '/');
    } catch (err) { fail(err); }
  };
}

// ───────── 보호자 동의 기다리는 화면 (만 14세 미만 · 동의 전) ─────────
export async function guardianWait(el) {
  const p = state.profile;
  const url = consentUrl(p.consentToken);
  const msg = `[싸카매니저] ${p.name} 선수의 가입에 보호자 동의가 필요합니다. 아래 링크에서 확인해 주세요.\n${url}`;
  el.innerHTML = `${brand}<div class="card auth-card wide guardian">
    <h2>보호자 동의가 필요해요</h2>
    <p>만 14세 미만은 법에 따라 <b>보호자(부모님)의 동의</b>를 받아야 싸카매니저를 쓸 수 있어요. 아래 링크를 부모님께 보내 주세요.</p>
    <div class="consent-link"><input readonly value="${esc(url)}"><button type="button" class="btn sm" data-copy>복사</button></div>
    <div class="row">
      <a class="btn ghost" href="sms:?&body=${encodeURIComponent(msg)}">문자로 보내기</a>
      ${navigator.share ? '<button type="button" class="btn ghost" data-share>카카오톡 등으로 공유</button>' : ''}
    </div>
    <ol class="guide-steps"><li>부모님이 링크를 열어 내용을 확인하고 <b>동의</b>를 눌러요</li><li>그다음 아래 <b>동의 확인</b>을 누르면 시작할 수 있어요</li></ol>
    <button class="btn full" data-check>보호자가 동의했어요 — 확인하기</button>
    <div class="row between small"><a href="#/privacy">개인정보 처리방침</a><button type="button" class="link-btn" data-out>로그아웃</button></div>
  </div>`;
  el.querySelector('[data-copy]').onclick = () => navigator.clipboard?.writeText(url).then(() => toast('링크를 복사했어요.'), () => {});
  el.querySelector('[data-share]')?.addEventListener('click', () => navigator.share({ title: '싸카매니저 보호자 동의', text: msg }).catch(() => {}));
  el.querySelector('[data-out]').onclick = () => signOut(auth);
  el.querySelector('[data-check]').onclick = async () => {
    try {
      const c = (await getDoc(doc(db, 'consents', p.consentToken))).data();
      if (c?.status !== 'agreed') return toast('아직 보호자 동의 전이에요. 부모님께 링크를 보내 주세요.');
      await updateDoc(doc(db, 'users', state.user.uid), { guardianOk: true });
      await loadContext();
      toast('보호자 동의가 확인됐어요!');
      go(state.profile.role === 'player' && !state.team ? '/team/join' : '/');
    } catch (err) { fail(err); }
  };
}

// ───────── 팀 대표 승인 기다리기 (팀 코드로 입장 신청 후) ─────────
export function approvalWait(el) {
  el.innerHTML = `${brand}<div class="card auth-card wide center">
    <h2>팀 대표 승인을 기다리고 있어요</h2>
    <p><b>${esc(state.team?.name || '')}</b>에 입장을 신청했어요. <b>팀 대표</b>가 락커룸에서 승인하면 팀 내용을 볼 수 있어요.</p>
    <p class="muted small">팀 대표(감독 · 코치)님께 "락커룸에서 승인해 주세요"라고 말씀드려 주세요.</p>
    <button class="btn full" data-re>승인됐는지 다시 보기</button>
    <button type="button" class="link-btn small" data-cancel>신청 취소하고 다른 팀 코드 넣기</button>
    <div class="row between small"><a href="#/privacy">개인정보 처리방침</a><button type="button" class="link-btn" data-out>로그아웃</button></div>
  </div>`;
  el.querySelector('[data-out]').onclick = () => signOut(auth);
  el.querySelector('[data-re]').onclick = async () => {
    await loadContext();
    if (state.member?.approved === false) toast('아직 승인 전이에요.');
    else if (!state.member) { toast('입장이 거절됐어요. 팀 코드를 다시 확인해 주세요.'); go('/team/join'); } else { toast('승인됐어요! 시작해요.'); go('/'); }
  };
  el.querySelector('[data-cancel]').onclick = async () => {
    if (!(await confirmBox('입장 신청을 취소할까요?'))) return;
    try {
      await deleteDoc(doc(db, 'teams', state.team.id, 'members', state.user.uid));
      await updateDoc(doc(db, 'users', state.user.uid), { teamId: null });
      await loadContext(); go('/team/join');
    } catch (err) { fail(err); }
  };
}

// ───────── 보호자 동의 페이지 (#/consent/:token, 로그인 없이 열림) ─────────
export async function consentPage(el, { token: tk }) {
  let c = null;
  try { c = (await getDoc(doc(db, 'consents', tk))).data(); } catch { /* */ }
  if (!c) { el.innerHTML = `${brand}<div class="card auth-card center"><h2>링크를 찾을 수 없어요</h2><p class="muted">링크가 잘못됐거나 만료됐어요. 아이에게 링크를 다시 받아 주세요.</p></div>`; return; }
  if (c.status === 'agreed') { el.innerHTML = `${brand}<div class="card auth-card center"><h2>이미 동의하셨어요</h2><p class="muted">${esc(c.childName)} 선수의 가입 동의가 완료되었습니다.</p></div>`; return; }
  el.innerHTML = `${brand}<form class="card auth-card wide consent">
    <span class="eyebrow">GUARDIAN CONSENT</span>
    <h2>보호자 동의</h2>
    <p><b>${esc(c.childName)}</b> 선수가 축구팀 관리 서비스 <b>싸카매니저</b>에 가입하려고 해요. 만 14세 미만이라 보호자의 동의가 필요합니다.</p>
    <div class="consent-sum">
      <div><span>수집 항목</span><p>이름, 이메일, 생년월일, 프로필(키 · 몸무게 · 포지션 등, 선택), 훈련 · 경기 일지, <b>건강 정보</b>(컨디션 · 통증 · 수면)</p></div>
      <div><span>이용 목적</span><p>팀 훈련 안내, 일지 작성과 지도자 피드백, 컨디션 · 부상 관리</p></div>
      <div><span>보는 사람</span><p>본인과 소속 팀 지도자 (일지 · 건강 정보). 팀이 공개 설정이면 다른 팀에 프로필만 보임</p></div>
      <div><span>국외 이전</span><p>Google(Firebase) · Vercel — 미국 서버에 보관 · 처리</p></div>
      <div><span>보유 기간</span><p>회원 탈퇴 시까지 (탈퇴하면 바로 삭제)</p></div>
    </div>
    <p class="small"><button type="button" class="link-btn" data-policy>개인정보 처리방침 전체 보기</button></p>
    <div class="grid2">
      <label>보호자 이름<input name="guardianName" required maxlength="20"></label>
      <label>관계<select name="relation"><option>부</option><option>모</option><option>조부모</option><option>기타 법정대리인</option></select></label>
    </div>
    <label>보호자 휴대폰 번호<input name="phone" type="tel" required inputmode="tel" pattern="[0-9\\-]{10,13}" placeholder="010-1234-5678"></label>
    <fieldset class="agree"><legend>동의</legend>
      <label class="chk"><input type="checkbox" required> [필수] 아이의 개인정보 수집 · 이용에 동의합니다</label>
      <label class="chk"><input type="checkbox" required> [필수] 아이의 건강 정보(민감정보) 처리에 동의합니다</label>
      <label class="chk"><input type="checkbox" required> [필수] 개인정보 국외 이전(Google · Vercel, 미국)에 동의합니다</label>
      <label class="chk"><input type="checkbox" required> 본인은 ${esc(c.childName)}의 법정대리인입니다</label>
    </fieldset>
    <button class="btn full">동의합니다</button>
  </form>`;
  el.querySelector('[data-policy]').onclick = showPolicy;
  const form = el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await updateDoc(doc(db, 'consents', tk), {
        status: 'agreed', guardianName: form.guardianName.value.trim(), relation: form.relation.value,
        phone: form.phone.value.replace(/[^0-9]/g, ''), agreedAt: serverTimestamp(), ver: POLICY_VER,
      });
      el.innerHTML = `${brand}<div class="card auth-card center"><h2>동의해 주셔서 감사합니다</h2>
        <p class="muted">${esc(c.childName)} 선수에게 앱에서 <b>"보호자가 동의했어요 — 확인하기"</b>를 누르라고 알려 주세요.</p></div>`;
    } catch (err) { fail(err); }
  };
}

// ───────── 회원 탈퇴 ─────────
export function withdraw() {
  if (isOwner()) {
    modal(`<h2>팀 대표는 바로 탈퇴할 수 없어요</h2><p>팀 대표가 탈퇴하면 팀 전체가 관리자를 잃어요. 팀을 정리하거나 다른 지도자에게 넘기려면 <b>운영자 문의</b>로 알려 주세요.</p>
      <div class="row end"><a class="btn" href="#/support">운영자 문의</a></div>`);
    return;
  }
  const m = modal(`<span class="eyebrow">WITHDRAW</span><h2>회원 탈퇴</h2>
    <p>탈퇴하면 아래 정보가 <b>바로 삭제되고 되돌릴 수 없어요.</b></p>
    <ul class="small"><li>계정(이메일 · 비밀번호)과 프로필</li><li>내 오늘 기록 · 일지 (건강 정보 포함)</li><li>내 개인 목표 · 할 일 메모</li><li>팀 멤버 정보 (팀에서 나가짐)</li></ul>
    <p class="muted small">대화방 메시지, 상담 답변 등 다른 사람이 함께 쓴 기록은 남을 수 있어요.</p>
    <form class="stack"><label>비밀번호 확인<input type="password" name="pw" required autocomplete="current-password"></label>
      <div class="row end"><button type="button" class="btn ghost" data-no>취소</button><button class="btn danger">탈퇴하기</button></div></form>`);
  m.el.querySelector('[data-no]').onclick = m.close;
  const form = m.el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!(await confirmBox('정말 탈퇴할까요? 모든 기록이 삭제됩니다.'))) return;
    const u = auth.currentUser;
    try {
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, form.pw.value));
      const uid = u.uid;
      const b = writeBatch(db);
      if (state.team) {
        const t = state.team.id;
        (await getDocs(query(collection(db, 'teams', t, 'logs'), where('uid', '==', uid)))).docs.forEach((d) => b.delete(d.ref));
        (await getDocs(query(collection(db, 'teams', t, 'goals'), where('ownerUid', '==', uid), where('scope', '==', 'personal')))).docs.forEach((d) => b.delete(d.ref));
        b.delete(doc(db, 'teams', t, 'members', uid));
      }
      (await getDocs(collection(db, 'users', uid, 'todos'))).docs.forEach((d) => b.delete(d.ref));
      if (state.profile?.consentToken) b.delete(doc(db, 'consents', state.profile.consentToken));
      b.delete(doc(db, 'users', uid));
      await b.commit();
      await deleteUser(u);
      m.close();
      toast('탈퇴가 완료되었습니다. 그동안 고마웠어요.');
    } catch (err) {
      fail(err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' ? { message: '비밀번호가 맞지 않아요.' } : err);
    }
  };
}
