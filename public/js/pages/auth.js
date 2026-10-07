import {
  auth, db, doc, setDoc, serverTimestamp,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut,
  verifyPasswordResetCode, confirmPasswordReset, applyActionCode,
} from '../fb.js';
import { esc, toast, fail, formData, options, POSITIONS, ROLES, resizeImage, avatar, modal } from '../ui.js';
import { state, loadContext, go } from '../store.js';
import { FREE_MODE } from '../config.js';

// 회원가입 안내: 계정 유형 · 팀이 만들어지는 방식 · 역할별 권한
const Y = '<span class="ok">✔</span>', N = '<span class="no">—</span>';
const GUIDE_ROWS = [
  [FREE_MODE ? '팀 만들기 · 팀 코드 · 팀 설정 · 팀원 관리' : '팀 만들기 · 결제 · 팀 설정 · 팀원 관리', Y, N, N],
  ['게임모델 · 훈련장 · 미팅룸 · 분석실 · 기록실', '작성', '작성', '보기'],
  ['공지사항 · 스케줄 · 비고', '작성', '작성', '보기'],
  ['훈련 노트 (코치 전용)', Y, Y, N],
  ['오늘 기록 · 개인 목표 · 상담 신청', Y, Y, '본인 것'],
  ['팀 목표 · 일지검사 · 상담 답변', Y, Y, N],
  ['스카우터 (아래 연령 선수 찜 · 메모)', Y, Y, N],
  ['대화 — 우리 팀원', Y, Y, Y],
  ['대화 — 다른 팀에 연락', Y, Y, N],
];

export function accountGuide() {
  const m = modal(`
    <div class="guide">
      <span class="eyebrow">ACCOUNT GUIDE</span>
      <h2>계정은 이렇게 이루어져요</h2>
      <p class="muted">회원가입 때 <strong>지도자</strong> 또는 <strong>선수</strong> 중 하나를 고릅니다. 팀은 지도자가 만들어요.</p>
      <ol class="guide-steps">
        <li><strong>지도자</strong>가 가입 → <b>팀 만들기</b>${FREE_MODE ? '' : ' → 결제'}<small>10자리 팀 코드가 바로 발급되고, 만든 지도자가 <b>팀 대표</b>가 됩니다.</small></li>
        <li><strong>다른 지도자 · 선수</strong>가 가입 → <b>팀 코드 입력</b><small>팀 대표에게 받은 코드로 팀에 들어옵니다.</small></li>
        <li><strong>다른 팀과 연락</strong>은 팀 대표에게 갑니다<small>다른 팀 페이지의 '팀에 연락하기'는 그 팀 대표 지도자와 대화로 연결돼요.</small></li>
      </ol>
      <h3>역할별 권한</h3>
      <div class="guide-table"><table class="tbl">
        <thead><tr><th></th><th>팀 대표</th><th>지도자</th><th>선수</th></tr></thead>
        <tbody>${GUIDE_ROWS.map(([k, ...v]) => `<tr><td>${k}</td>${v.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small">다른 팀은 공개 팀의 선수단 · 프로필만 볼 수 있고, 팀 안의 내용은 볼 수 없습니다. 스카우터 찜은 상대 선수 · 팀에 알려지지 않아요.</p>
      <div class="row end"><button class="btn" data-ok>확인했어요</button></div>
    </div>`, { wide: true });
  m.el.querySelector('[data-ok]').onclick = m.close;
  return m;
}

const brand = `<div class="brand"><span>SSAKA</span><span>MANAGER</span><small>축구팀을 위한 매니지먼트 플랫폼</small></div>`;

export function login(el) {
  el.innerHTML = `${brand}
  <form class="card auth-card">
    <h2>로그인</h2>
    ${auth.demo ? '<p class="muted small">데모 계정: 코치 <b>c@x.com</b> / <b>coach123</b> · 선수 <b>p@x.com</b> / <b>player123</b> — 직접 가입한 계정도 됩니다.</p>' : ''}
    <label>이메일 (아이디)<input name="email" type="email" required autocomplete="email"></label>
    <label>비밀번호<input name="password" type="password" required autocomplete="current-password"></label>
    <button class="btn full">로그인</button>
    <div class="row between small">
      <button type="button" class="link-btn" data-reset>비밀번호 찾기</button>
      <a href="#/signup">회원가입 →</a>
    </div>
  </form>`;
  const form = el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const { email, password } = formData(form);
    try { await signInWithEmailAndPassword(auth, email, password); } catch (err) { fail(err); }
  };
  el.querySelector('[data-reset]').onclick = async () => {
    const email = form.email.value.trim();
    if (!email) { form.email.focus(); return toast('위에 가입한 이메일을 먼저 입력하세요.'); }
    await sendReset(email);
  };
}

export function signup(el) {
  el.innerHTML = `${brand}
  <form class="card auth-card">
    <h2>회원가입</h2>
    <label>이메일 <small class="muted">(로그인 아이디로 쓰여요)</small><input name="email" type="email" required autocomplete="email" placeholder="example@naver.com"></label>
    <p class="muted small field-hint">이메일이 없는 선수는 부모님 이메일로 가입해도 돼요. 비밀번호를 잊으면 이 이메일로 재설정 링크가 갑니다.</p>
    <div class="field-error" data-dup hidden>이미 가입된 이메일이에요. 이 이메일로 로그인하거나, 비밀번호가 기억나지 않으면 재설정 메일을 받으세요.
      <div class="row"><a class="btn sm" href="#/login">로그인하기</a><button type="button" class="btn ghost sm" data-reset>비밀번호 재설정 메일 받기</button></div></div>
    <label>비밀번호 (6자 이상)<input name="password" type="password" minlength="6" required autocomplete="new-password"></label>
    <label>비밀번호 확인<input name="password2" type="password" minlength="6" required autocomplete="new-password"></label>
    <button class="btn full">다음 — 개인계정 만들기</button>
    <div class="row between small"><button type="button" class="link-btn" data-guide>계정 유형 · 권한 안내</button><a href="#/login">이미 계정이 있어요</a></div>
  </form>`;
  const form = el.querySelector('form');
  el.querySelector('[data-guide]').onclick = accountGuide;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const { email, password, password2 } = formData(form);
    if (password !== password2) return toast('비밀번호가 일치하지 않습니다.');
    dup.hidden = true;
    try { await createUserWithEmailAndPassword(auth, email, password); } catch (err) {
      // 같은 이메일로 이미 가입된 경우: 칸 바로 아래에 안내 + 로그인 / 재설정 바로가기
      if (err?.code === 'auth/email-already-in-use') { dup.hidden = false; form.email.focus(); return; }
      fail(err);
    }
  };
  const dup = form.querySelector('[data-dup]');
  form.email.oninput = () => { dup.hidden = true; };
  dup.querySelector('[data-reset]').onclick = async () => {
    await sendReset(form.email.value.trim());
  };
}

// 개인계정 — 공통(사진 · 이름 · 계정 유형) + 선수용 / 지도자용 항목
export const COACH_TITLES = ['감독', '수석코치', '코치', '골키퍼 코치', '피지컬 코치', '전력분석관', '트레이너'];
export const LICENSES = ['KFA P급', 'KFA A급', 'KFA B급', 'KFA C급', 'KFA D급', 'GK 1급', 'GK 2급', 'GK 3급'];

const playerFields = (p) => `
    <div class="grid2">
      <label>키 (cm)<input name="height" type="number" min="80" max="230" value="${esc(p.height || '')}"></label>
      <label>몸무게 (kg)<input name="weight" type="number" min="15" max="150" value="${esc(p.weight || '')}"></label>
      <label>포지션<select name="position"><option value="">-</option>${options(POSITIONS, p.position)}</select></label>
      <label>등번호<input name="number" type="number" min="0" max="99" value="${esc(p.number || '')}"></label>
      <label>주발<select name="foot">${options([['', '-'], ['R', '오른발'], ['L', '왼발'], ['B', '양발']], p.foot)}</select></label>
      <label>출생연도<input name="birthYear" type="number" min="1940" max="2025" value="${esc(p.birthYear || '')}"></label>
    </div>
    <label>소속 <small class="muted">(학교 · 학년 · 클럽)</small><input name="affiliation" maxlength="40" placeholder="예) OO초등학교 6학년, OO중 축구부" value="${esc(p.affiliation || '')}"></label>
    <label>소개<textarea name="bio" rows="2" maxlength="200">${esc(p.bio || '')}</textarea></label>`;

const coachFields = (p) => {
  const has = new Set((p.licenses || '').split(',').map((x) => x.trim()).filter(Boolean));
  return `
    <div class="grid2">
      <label>직책<select name="coachTitle">${options([['', '선택'], ...COACH_TITLES], p.coachTitle)}</select></label>
      <label>담당 <small class="muted">(학년 · 파트)</small><input name="duty" maxlength="30" placeholder="예) U12 담당, 공격 파트" value="${esc(p.duty || '')}"></label>
    </div>
    <fieldset><legend>자격증</legend>
      <div class="pick-chips">${LICENSES.map((l) => `<label><input type="checkbox" name="licenses" value="${l}" ${has.has(l) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <input name="licenseEtc" maxlength="60" placeholder="그 외 자격증 — 예) 생활스포츠지도사 2급, AFC 피트니스" value="${esc(p.licenseEtc || '')}">
    </fieldset>
    <label>출신학교<input name="school" maxlength="60" placeholder="예) OO중 - OO고 - OO대" value="${esc(p.school || '')}"></label>
    <label>지도 경력<textarea name="career" rows="2" maxlength="300" placeholder="예) 2019~2022 OO FC U12 코치&#10;2023~ OO FC U15 수석코치">${esc(p.career || '')}</textarea></label>`;
};

export function profileFields(p = {}, { withRole = false } = {}) {
  const r = p.role || 'player';
  return `
    <div class="photo-pick">
      <span data-preview>${avatar(p.photo, p.name || '?', 'xl')}</span>
      <label class="btn ghost sm">사진 선택<input type="file" accept="image/*" hidden data-photo></label>
      <input type="hidden" name="photo" value="${esc(p.photo || '')}">
    </div>
    ${withRole ? `
    <fieldset class="role-pick"><legend>계정 유형</legend>
      ${Object.entries(ROLES).map(([k, v]) => `
        <label class="radio-card"><input type="radio" name="role" value="${k}" ${k === r ? 'checked' : ''}>
          <strong>${k === 'coach' ? '지도자 (코치)' : v}</strong><small>${{ coach: '팀 만들기 · 훈련 · 공지 작성 · 일지검사 · 스카우터', player: '팀 코드로 입장 · 오늘 기록 · 개인 목표' }[k]}</small>
        </label>`).join('')}
      <button type="button" class="link-btn small guide-link" data-guide>어떤 계정을 골라야 하나요? 권한 보기</button>
    </fieldset>` : ''}
    <label>이름<input name="name" required maxlength="20" value="${esc(p.name || '')}"></label>
    ${withRole
      ? `<div data-for="player" ${r === 'player' ? '' : 'hidden'}>${playerFields(p)}</div><div data-for="coach" ${r === 'coach' ? '' : 'hidden'}>${coachFields(p)}</div>`
      : r === 'coach' ? coachFields(p) : playerFields(p)}`;
}

// 계정 유형을 바꾸면 해당 항목만 보이게 (숨긴 칸은 제출되지 않음)
export function bindRoleFields(form) {
  const sync = () => {
    const r = form.querySelector('[name=role]:checked')?.value;
    form.querySelectorAll('[data-for]').forEach((box) => {
      box.hidden = box.dataset.for !== r;
      box.querySelectorAll('input, select, textarea').forEach((i) => (i.disabled = box.hidden));
    });
  };
  form.querySelectorAll('[name=role]').forEach((i) => (i.onchange = sync));
  sync();
}

// 폼 → 프로필 데이터 (자격증 체크박스는 여러 개라 따로 모음)
export function profileData(form) {
  const d = formData(form);
  if (form.querySelector('[name=licenses]:not(:disabled)')) {
    d.licenses = new FormData(form).getAll('licenses').join(', ');
  }
  return d;
}

export function bindPhoto(form) {
  form.querySelector('[data-photo]').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const url = await resizeImage(f);
    form.photo.value = url;
    form.querySelector('[data-preview]').innerHTML = avatar(url, '', 'xl');
  };
}

export function completeProfile(el) {
  el.innerHTML = `${brand}
  <form class="card auth-card wide">
    <h2>개인계정 만들기</h2>
    <p class="muted small">${esc(state.user.email)}</p>
    ${profileFields({}, { withRole: true })}
    <button class="btn full">시작하기</button>
    <button type="button" class="link-btn small" data-out>다른 계정으로 로그인</button>
  </form>`;
  const form = el.querySelector('form');
  bindPhoto(form);
  bindRoleFields(form);
  el.querySelector('[data-out]').onclick = () => signOut(auth);
  el.querySelector('[data-guide]').onclick = accountGuide;
  accountGuide(); // 계정 유형을 고르기 전에 한 번 보여주기
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = profileData(form);
    try {
      await setDoc(doc(db, 'users', state.user.uid), {
        ...d, email: state.user.email, teamId: null, createdAt: serverTimestamp(),
      });
      await loadContext();
      go(d.role === 'player' ? '/team/join' : '/');
    } catch (err) { fail(err); }
  };
}

// ───────── 비밀번호 재설정 ─────────
// 1) 메일 보내기: Firebase 가 그 이메일로 재설정 링크를 보냄 (무료)
export async function sendReset(email) {
  try {
    await sendPasswordResetEmail(auth, email, { url: location.origin + location.pathname });
  } catch (err) { fail(err); return false; }
  const m = modal(`<span class="eyebrow">PASSWORD RESET</span><h2>메일을 보냈어요</h2>
    <p><strong>${esc(email)}</strong> 로 비밀번호 재설정 링크를 보냈습니다.</p>
    <ol class="guide-steps">
      <li>메일함에서 <b>싸카매니저 비밀번호 재설정</b> 메일을 여세요<small>몇 분 안에 오지 않으면 <b>스팸함 · 프로모션함</b>도 확인해 주세요.</small></li>
      <li>메일 속 링크를 누르면 새 비밀번호를 정하는 화면이 열려요<small>링크는 한 번만 쓸 수 있고 약 1시간 뒤 만료돼요.</small></li>
      <li>새 비밀번호로 로그인하면 끝!</li>
    </ol>
    <div class="row end"><button class="btn" data-ok>확인</button></div>`);
  m.el.querySelector('[data-ok]').onclick = m.close;
  return true;
}

// 2) 메일 속 링크로 열리는 화면 (?mode=resetPassword&oobCode=…) — 새 비밀번호 정하기
export async function resetPage(el, code) {
  el.innerHTML = `${brand}<div class="card auth-card"><p class="muted center">링크 확인 중…</p></div>`;
  // 재설정 링크의 ?mode=…&oobCode=… 는 지우고 로그인 화면으로 (데모 ?out 은 유지)
  const toLogin = () => { location.replace(location.pathname + (new URLSearchParams(location.search).has('out') ? '?out' : '') + '#/login'); };
  let email;
  try {
    email = await verifyPasswordResetCode(auth, code);
  } catch (err) {
    // 만료 · 이미 사용한 링크 → 메일 다시 받기
    el.innerHTML = `${brand}<form class="card auth-card">
      <h2>링크를 쓸 수 없어요</h2>
      <p class="muted">${err?.code === 'auth/expired-action-code' ? '재설정 링크가 만료되었습니다.' : '이미 사용했거나 잘못된 링크입니다.'} 메일을 다시 받아주세요.</p>
      <label>가입한 이메일<input name="email" type="email" required autocomplete="email"></label>
      <button class="btn full">재설정 메일 다시 받기</button>
      <div class="row end small"><button type="button" class="link-btn" data-login>로그인으로 →</button></div>
    </form>`;
    const f = el.querySelector('form');
    f.onsubmit = (e) => { e.preventDefault(); sendReset(f.email.value.trim()); };
    el.querySelector('[data-login]').onclick = toLogin;
    return;
  }
  el.innerHTML = `${brand}<form class="card auth-card">
    <h2>새 비밀번호 정하기</h2>
    <p class="muted small">${esc(email)}</p>
    <label>새 비밀번호 (6자 이상)<input name="password" type="password" minlength="6" required autocomplete="new-password"></label>
    <label>새 비밀번호 확인<input name="password2" type="password" minlength="6" required autocomplete="new-password"></label>
    <button class="btn full">비밀번호 바꾸기</button>
  </form>`;
  const form = el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const { password, password2 } = formData(form);
    if (password !== password2) return toast('비밀번호가 일치하지 않습니다.');
    try {
      await confirmPasswordReset(auth, code, password);
      el.innerHTML = `${brand}<div class="card auth-card center">
        <h2>비밀번호를 바꿨어요</h2>
        <p class="muted">${esc(email)}<br>새 비밀번호로 로그인하세요.</p>
        <button class="btn full" data-login>로그인하러 가기</button></div>`;
      el.querySelector('[data-login]').onclick = toLogin;
    } catch (err) { fail(err); }
  };
}

// 3) 이메일 인증 메일의 링크 (?mode=verifyEmail&oobCode=…)
export async function verifyEmailPage(el, code) {
  const back = location.pathname + (new URLSearchParams(location.search).has('out') ? '?out' : '');
  let ok = true;
  try { await applyActionCode(auth, code); } catch { ok = false; }
  el.innerHTML = `${brand}<div class="card auth-card center">
    <h2>${ok ? '이메일 인증 완료' : '링크를 쓸 수 없어요'}</h2>
    <p class="muted">${ok ? '이제 앱으로 돌아가 로그인하면 됩니다.' : '이미 인증했거나 만료된 링크입니다. 앱에서 인증 메일을 다시 받아주세요.'}</p>
    <a class="btn full" href="${back}#/">앱으로 가기</a></div>`;
}
