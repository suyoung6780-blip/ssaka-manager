import { PRIVACY, isConfigured, FREE_MODE } from './config.js';
import { installButton, bindInstall } from './install.js';
import { attachHelp } from './help.js';
import { versionLabel, CHANGELOG, VERSION } from './version.js';
import { privacyNotice } from './pages/privacy.js';
import { seasonPopup, gradPopup } from './proto/season.js';
import { startNews, stopNews, markSeen, paint } from './news.js';
import { auth, onAuthStateChanged, signOut } from './fb.js';
import { $, $$, esc, avatar, ROLES, pageHead, toast, modal, isQuota, quotaNotice, quotaHooks } from './ui.js';
import {
  state, hooks, go, loadContext, role, inTeam, isCoach, isSquad, isOwner, isAdmin, isAdminEmail, teamActive, freeMode, waitApproval, teamRestricted, hasFeature,
} from './store.js';
import * as authPages from './pages/auth.js';
import * as admin from './pages/admin.js';
import * as support from './pages/support.js';
import * as guide from './pages/guide.js';
import * as privacy from './pages/privacy.js';
import * as community from './pages/community.js';
import * as home from './pages/home.js';
import * as onboard from './pages/onboard.js';
import * as team from './pages/team.js';
import * as board from './pages/board.js';
import * as training from './pages/training.js';
import * as data from './pages/data.js';
import * as trainingDaily from './pages/trainingDaily.js';
import * as analysis from './pages/analysis.js';
import * as goalAna from './proto/goalAna.js';
import * as goals from './pages/goals.js';
import * as idp from './pages/idp.js'; // 시제품 3.0 (팀 기능 proto3)
import { refreshIdpFlag, homeIdpCard } from './proto/idpStatus.js';
import * as personal from './pages/personal.js';
import * as social from './pages/social.js';
import * as notes from './pages/notes.js';
import * as terms from './pages/terms.js';
import * as refund from './pages/refund.js';
import { kakaoReturn } from './social.js';

const app = $('#app');
const PLAYER_DEMO = /[?&]as=player/.test(location.search); // 체험 모드: 선수로 보는 중
const RESTRICT_OK = ['/', '/settings', '/support', '/support/qna', '/support/guide', '/me', '/privacy', '/terms', '/pay', '/pricing', '/refund'];
// 결제 전 · 이용기간이 끝난 팀에서도 열 수 있는 곳
const PAY_OK = ['/settings', '/support', '/support/qna', '/support/guide', '/me', '/privacy', '/terms', '/pay', '/pricing', '/refund'];

// guard: auth(기본) / squad(팀원: 코치·선수) / coach / member / owner
const routes = [
  ['/login', authPages.login, 'public'],
  ['/signup', authPages.signup, 'public'],
  ['/', home.render],
  ['/team/new', onboard.createTeam, 'coachRole'],
  ['/team/join', onboard.joinTeam],
  ['/pay', onboard.pay, 'owner'],
  ['/settings', onboard.settings, 'owner'],
  ['/gamemodel', team.gameModel, 'squad'],
  ['/locker', team.locker, 'squad'],
  ['/goals', goals.page, 'squad'],
  ['/idp', idp.page, 'squad'],
  ['/idp/:uid', idp.page, 'squad'],
  ['/records', team.records, 'squad'],
  ['/data', data.page, 'squad'],
  ['/training', trainingDaily.daily, 'squad'],
  ['/training/notes', trainingDaily.notes, 'coach'],
  ['/training/library', () => go('/tactics/programs'), 'coach'], // 예전 주소 → 전술보드
  ['/tactics', training.board, 'coach'],
  ['/tactics/programs', training.library, 'coach'],
  ['/notes', notes.page, 'coach'],
  ['/meeting', board.page('meeting'), 'squad'],
  ['/analysis', analysis.list, 'squad'],
  ['/analysis/goals', goalAna.page, 'squad'], // 시제품 3.0: 득점 · 실점 분석
  ['/analysis/:id', analysis.studio, 'squad'],
  ['/analysis/:id/edit', analysis.studioEdit, 'squad'],
  ['/notice', board.page('notice'), 'member'],
  ['/schedule', board.page('schedule'), 'member'],
  ['/me', personal.profile],
  ['/daily', personal.daily, 'player'], // 오늘 기록은 선수만
  ['/journal-check', personal.journalCheck, 'coach'],
  ['/scout', social.scout, 'coach'],
  ['/teams/:id', social.teamView],
  ['/chat', social.chatList, 'coach'],
  ['/chat/:id', social.chatRoom, 'coach'],
  ['/admin', admin.page, 'admin'],
  ['/admin/teams', admin.teams, 'admin'],
  ['/admin/users', admin.users, 'admin'],
  ['/admin/verify', admin.verify, 'adminEmail'],
  ['/admin/inbox', support.inbox, 'admin'],
  ['/admin/inbox/qna', support.inbox, 'admin'],
  ['/admin/inbox/:id', support.inbox, 'admin'],
  ['/privacy', privacy.page, 'any'],
  ['/terms', terms.page, 'any'],
  ['/refund', refund.page, 'any'],
  ['/pricing', onboard.pricing, 'any'],
  ['/consent/:token', privacy.consentPage, 'any'],
  ['/community', (el) => community.page(el, { cat: 'training' }), 'coach'],
  ['/community/:cat', community.page, 'coach'],
  ['/support', support.page],
  ['/support/qna', support.qna],
  ['/support/guide', guide.guide],
];

function match(path) {
  for (const [pattern, fn, guard] of routes) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    const m = path.match(re);
    if (m) return { fn, guard, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

function allowed(guard) {
  switch (guard) {
    case 'squad': return isSquad();
    case 'player': return isSquad() && !isCoach();
    case 'coach': return isCoach();
    case 'member': return inTeam();
    case 'coachRole': return role() === 'coach';
    case 'owner': return isOwner();
    case 'any': return true;
    case 'admin': return isAdmin();
    case 'adminEmail': return isAdminEmail();
    default: return true;
  }
}

// 맨 밑 회사 정보 (결제사 · 카드사 심사에서 보는 항목 — 통신판매업 신고번호가 나오면 '신고 진행 중' 자리에)
const FOOTER = `
<footer class="site-foot">
  <div class="sf-top">
    <div class="sf-brand">
      <strong>SSAKA MANAGER</strong>
      <span>축구팀을 위한 매니지먼트 플랫폼</span>
    </div>
    <nav class="sf-links">
      <a href="#/pricing">요금 안내</a>
      <a href="#/terms">이용약관</a>
      <a href="#/refund">환불정책</a>
      <a href="#/privacy"><b>개인정보처리방침</b>${privacyNotice() ? ' <small class="sf-new">개정 예정</small>' : ''}</a>
      <a href="#/support/guide">사용 설명서</a>
      <a href="#/support">운영자 문의</a>
    </nav>
  </div>
  <div class="sf-info2">
    <div class="sf-biz">
      <p class="sf-name">싸카매니저</p>
      <p><span><em>대표 · 개인정보 보호책임자</em>유수영</span><span><em>사업자등록번호</em>451-15-03077</span></p>
      <p><span><em>통신판매업 신고</em>신고 진행 중</span><span><em>이메일</em><a href="mailto:${PRIVACY.email}">${PRIVACY.email}</a></span></p>
      <p><span><em>주소</em>경기도 안산시 단원구 사세충열로4길 6</span></p>
    </div>
    <div class="sf-cs">
      <span class="sf-cs-h">CS CENTER</span>
      <a class="sf-tel" href="tel:05068858701">050-6885-8701</a>
      <dl class="sf-hours"><div><dt>상담 시간</dt><dd>평일 오전 10시 - 오후 7시</dd></div><div><dt>점심 시간</dt><dd>오후 12시 - 1시</dd></div><div><dd>주말 · 공휴일 휴무</dd></div></dl>
    </div>
  </div>
  <div class="sf-bottom">
    <span>© ${new Date().getFullYear()} 싸카매니저. All rights reserved. <button type="button" class="sf-ver" data-ver title="업데이트 내역">${versionLabel()}</button></span>
    <span class="sf-mark">SSAKA MANAGER</span>
  </div>
</footer>`;

async function route() {
  state.cleanup.forEach((f) => f());
  state.cleanup = [];
  document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); // 이전 화면에서 열린 창은 닫기
  document.documentElement.classList.remove('pad-locked'); // 작전판 전체화면 중에 뒤로가기 → 화면 스크롤 풀기
  document.querySelectorAll('.pad-loupe, .pad-mini').forEach((m) => m.remove());
  const path = location.hash.slice(1) || '/';
  const r = match(path) || match('/');

  if (r.guard === 'public') {
    if (state.user) return go('/');
    app.innerHTML = '<div class="bare" id="view"></div>' + FOOTER;
    return r.fn($('#view'), r.params);
  }
  // 로그인 없이도 보는 화면 (처리방침 · 보호자 동의 링크)
  if (r.guard === 'any' && (!state.user || !state.profile || privacy.needGuardian())) {
    app.innerHTML = '<div class="bare" id="view"></div>' + FOOTER;
    return r.fn($('#view'), r.params);
  }
  if (!state.user) return go('/login');
  // 새 가입자: 이메일 인증 먼저
  if (authPages.needVerify() && r.guard !== 'any') {
    app.innerHTML = '<div class="bare" id="view"></div>' + FOOTER;
    return authPages.verifyGate($('#view'));
  }
  if (!state.profile) {
    app.innerHTML = '<div class="bare" id="view"></div>' + FOOTER;
    return authPages.completeProfile($('#view'));
  }
  // 처리방침이 생기기 전에 가입한 회원: 한 번 동의 받기
  if (privacy.needAgree() && r.guard !== 'any') {
    app.innerHTML = '<div class="bare" id="view"></div>' + FOOTER;
    return privacy.agreeGate($('#view'));
  }
  // 만 14세 미만: 보호자 동의 전에는 동의 안내 화면만
  if (privacy.needGuardian()) {
    app.innerHTML = '<div class="bare" id="view"></div>' + FOOTER;
    return privacy.guardianWait($('#view'));
  }
  // 팀 코드로 들어온 뒤 팀 대표 승인 전
  if (waitApproval() && r.guard !== 'any') {
    app.innerHTML = '<div class="bare" id="view"></div>' + FOOTER;
    return privacy.approvalWait($('#view'));
  }
  if (!allowed(r.guard)) return go('/');

  if (!$('.shell')) renderShell();
  startNews();
  refreshIdpFlag(); // 시제품: 성장 평가 메뉴 점
  document.documentElement.toggleAttribute('data-p3', hasFeature('proto3')); // 시제품: 작전판 새 도구 · 3D
  markSeen(path);
  updateShell(path);
  const view = $('#view');
  // 운영자가 기능을 제한한 팀: 홈 · 팀 설정 · 운영자 문의 · 내 프로필만
  if (teamRestricted() && !isAdmin() && !RESTRICT_OK.includes(path)) {
    view.innerHTML = `${pageHead('LIMITED', '기능이 제한된 팀이에요')}<section class="card"><p>운영자가 이 팀의 기능을 제한했어요. 운영자에게 문의해 주세요.</p>
      <div class="row"><a class="btn" href="#/support">운영자에게 문의하기</a></div></section>`;
    window.scrollTo(0, 0);
    return;
  }
  // 결제 전 · 이용기간이 끝난 팀: 결제 · 설정 · 문의 · 내 프로필만 (기록은 그대로 남아 있음)
  if (!freeMode() && state.team && state.member && state.member.approved !== false && !teamActive() && !isAdmin() && !PAY_OK.includes(path)) {
    view.innerHTML = `${pageHead('PAYMENT', '이용기간이 끝났어요')}<section class="card pay-gate">
      <p><b>${esc(state.team.name)}</b>의 ${state.team.trial ? '무료 체험' : state.team.free ? '무료 기간' : '이용기간'}이 끝났어요. ${isOwner() ? '요금제를 골라 결제하면 바로 다시 쓸 수 있어요.' : '팀 대표 지도자가 결제하면 다시 쓸 수 있어요.'}</p>
      <p class="muted small">팀 기록(일지 · 분석 · 작전판 등)은 지워지지 않고 그대로 남아 있어요.</p>
      <div class="row">${isOwner() ? '<a class="btn" href="#/pay">요금제 고르기 · 결제</a>' : ''}<a class="btn ghost" href="#/pricing">요금 안내</a><a class="btn ghost" href="#/support">운영자 문의</a></div></section>`;
    window.scrollTo(0, 0);
    return;
  }
  view.innerHTML = '<div class="loading">LOADING</div>';
  $('.shell').classList.remove('nav-open', 'search-open');
  try {
    await r.fn(view, r.params);
    if (view.isConnected) attachHelp(view, path);
  } catch (e) {
    console.error(e);
    if (isQuota(e)) { quotaNotice(); view.innerHTML = `<div class="empty">${isAdmin() ? 'Firebase 무료 사용량이 다 차서 불러올 수 없어요 (맨 위 안내 참고).' : '지금 연결이 원활하지 않아요.<br><small>잠시 후 다시 시도해 주세요.</small>'}</div>`; }
    else view.innerHTML = `<div class="empty">페이지를 불러오지 못했습니다.<br><small>${esc(e.message)}</small></div>`;
  }
  window.scrollTo(0, 0);
}

function navItems() {
  const items = [];
  const sec = (title, list) => list.length && items.push({ title, list });
  const coach = isCoach(); const squad = isSquad(); const player = squad && !coach;
  // 메뉴 묶음 (영어 이름으로 통일) — 일하는 순서: 팀 운영 → 훈련 → 경기 → 성장 · 선수는 오늘 기록을 맨 위에
  sec('HOME', [['/', '홈'], ...(player ? [['/daily', '오늘 기록']] : [])]);
  sec('TEAM', inTeam() ? [['/notice', '공지사항'], ['/schedule', '스케줄'], ...(squad ? [['/locker', '락커룸']] : []), ...(coach ? [['/chat', '팀 대화']] : [])] : []);
  sec('TRAINING', squad ? [['/gamemodel', '게임모델'], ['/training', '훈련장'], ...(coach ? [['/tactics', '전술보드']] : []), ...(hasFeature('proto3') ? [['/analysis', '필름룸']] : []), ['/meeting', '미팅룸']] : []);
  sec('MATCH', squad ? (hasFeature('proto3') ? [['/records', '기록실'], ['/analysis/goals', '분석실']] : [['/records', '경기 기록실'], ['/analysis', '분석실']]) : []);
  sec('GROWTH', squad ? [...(hasFeature('proto3') ? [['/idp', '성장 평가']] : []), ['/goals', '목표'], ['/data', '데이터실'], ...(coach ? [['/journal-check', '일지검사']] : [])] : []);
  sec('MY', [['/me', '프로필'], ...(coach ? [['/notes', '코치 노트'], ['/scout', '스카웃 노트']] : [])]);
  sec('COMMUNITY', coach ? [['/community/training', '훈련 공유'], ['/community/talk', '지도자 게시판']] : []);
  sec('SUPPORT', [...(isOwner() ? [['/settings', freeMode() ? '팀 설정' : '팀 설정 · 결제']] : []), ['/support/guide', '사용 설명서'], ['/support', '운영자 문의']]);
  if (isAdmin()) sec('ADMIN', [['/admin', '전체 공지'], ['/admin/teams', '전체 팀'], ['/admin/users', '전체 인원'], ['/admin/inbox', '소통']]);
  else if (isAdminEmail()) sec('ADMIN', [['/admin/verify', '운영자 인증']]);
  return items;
}

function renderShell() {
  app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <button class="icon-btn" data-toggle="nav-open" aria-label="메뉴">☰</button>
      <a href="#/" class="logo-sm"><img src="icons/logo-h.png" alt="SSAKA MANAGER"></a>
      <button class="icon-btn" data-toggle="search-open" aria-label="팀 검색">⌕</button>
    </header>
    <aside class="nav">
      <a href="#/" class="logo"><img src="icons/logo-h.png" alt="SSAKA MANAGER"><small>싸카매니저</small></a>
      <div class="team-chip"></div>
      <nav class="nav-list"></nav>
      <div class="me-box"></div>
    </aside>
    <main class="main-col">${auth.demo ? `<div class="demo-bar"><b>체험 모드</b><span>예시 팀 · 가짜 데이터예요. 바꾼 내용은 이 창을 닫으면 사라져요.</span><a href="${PLAYER_DEMO ? 'demo.html' : 'demo.html?as=player'}">${PLAYER_DEMO ? '지도자 화면으로' : '선수 화면으로'}</a><a class="btn sm" href="./#/signup">실제로 시작하기</a></div>` : ''}<div id="sys-notice"></div><div id="team-notice"></div><div id="view"></div>${FOOTER}</main>
    <aside class="search-panel" id="search-panel"></aside>
    <div class="scrim"></div>
  </div>`;
  $$('[data-toggle]').forEach((b) => (b.onclick = () => $('.shell').classList.toggle(b.dataset.toggle)));
  $('.scrim').onclick = () => $('.shell').classList.remove('nav-open', 'search-open');
  social.searchPanel($('#search-panel'));
  admin.loadBanner($('#sys-notice')); // 운영자 전체 공지
}

function updateShell(path = location.hash.slice(1) || '/') {
  if (!$('.shell')) return;
  const t = state.team;
  $('.team-chip').innerHTML = inTeam()
    ? `<span class="cat">${esc(t.category)}</span><strong>${esc(t.name)}</strong>${teamActive() ? '' : '<em>이용기간 만료</em>'}`
    : '<span class="cat">NO TEAM</span><strong>소속 팀 없음</strong>';
  const items = navItems();
  // 지금 주소에 가장 길게 맞는 메뉴 하나만 선택 (예: /admin/teams 면 '전체 팀'만, '전체 공지'는 아님)
  const cur = items.flatMap((s) => s.list.map(([h]) => h))
    .filter((h) => path === h || (h !== '/' && path.startsWith(h + '/')))
    .sort((a, b) => b.length - a.length)[0]
    // 메뉴가 하위 주소만 가리킬 때 (분석실 → /analysis/goals): 그 위 주소에서도 선택
    || items.flatMap((s) => s.list.map(([h]) => h)).find((h) => path !== '/' && h.startsWith(path + '/'));
  $('.nav-list').innerHTML = items.map((s) => `
    <div class="nav-sec"><span>${s.title}</span>
      ${s.list.map(([href, label]) => `<a href="#${href}" class="${href === cur ? 'active' : ''}">${label}</a>`).join('')}
    </div>`).join('');
  const p = state.profile;
  $('.me-box').innerHTML = `
    <a href="#/me" class="me">${avatar(p.photo, p.name)}<span><strong>${esc(p.name)}</strong><small>${ROLES[p.role]}</small></span></a>
    <span class="me-acts">${installButton('link-btn')}<button class="link-btn" data-logout>로그아웃</button></span>`;
  $('[data-logout]').onclick = () => signOut(auth);
  bindInstall($('.me-box'));
  // 팀 알림 띠: 기능 제한 · 팀 이름 주의
  $('#team-notice').innerHTML = inTeam() && teamRestricted()
    ? '<div class="banner danger">운영자가 이 팀의 기능을 제한했어요. <a href="#/support">운영자에게 문의하기 →</a></div>' : '';
  paint();
}

// 맨 아래 버전을 누르면 업데이트 내역
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('[data-ver]')) return;
  modal(`<span class="eyebrow">UPDATES</span><h2>업데이트 내역 <small class="muted">${versionLabel()}</small></h2>
    <p class="muted small">지금은 무료로 시험 운영하는 <b>베타</b>예요. 유료 정식 출시 때 1.0이 돼요.</p>
    <div class="ver-list">${CHANGELOG.map((c) => `<section><div class="ver-h"><b>v${esc(c.ver)}</b><small>${esc(c.date.replace(/-/g, '.'))}</small></div>
      <ul>${c.items.map((x) => (Array.isArray(x) ? `<li class="ver-it"><b>${esc(x[0])}</b><span>${esc(x[1])}</span></li>` : `<li>${esc(x)}</li>`)).join('')}</ul></section>`).join('')}</div>`);
});

// 새 버전이 올라간 뒤 처음 열면 '업데이트 되었어요' 창 (버전마다 한 번 · 처음 온 사람에겐 안 띄움)
let verChecked = false;
function updatePopup() {
  if (verChecked) return null; verChecked = true;
  const K = 'ssaka-seen-ver'; const force = new URLSearchParams(location.search).has('verpop');
  let seen = null; try { seen = localStorage.getItem(K); localStorage.setItem(K, VERSION.no); } catch { return null; }
  if (!force && (!seen || seen === VERSION.no)) return null;
  const cmp = (a, b) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
  const fresh = CHANGELOG.filter((c) => force || cmp(c.ver, seen) > 0).slice(0, force ? 1 : 3);
  if (!fresh.length) return null;
  const m = modal(`<span class="eyebrow">UPDATE</span><h2>업데이트 되었어요 <small class="muted">${versionLabel()}</small></h2>
    <p class="muted small">${seen && !force ? `지난번(v${esc(seen)}) 이후 바뀐 점이에요.` : '새로 바뀐 점이에요.'}</p>
    <div class="ver-list ver-pop">${fresh.map((c) => `<section><div class="ver-h"><b>v${esc(c.ver)}</b><small>${esc(c.date.replace(/-/g, '.'))}</small></div>
      <ul>${c.items.map((x) => (Array.isArray(x) ? `<li class="ver-it"><b>${esc(x[0])}</b><span>${esc(x[1])}</span></li>` : `<li>${esc(x)}</li>`)).join('')}</ul></section>`).join('')}</div>
    <div class="row end ver-acts"><button type="button" class="btn ghost" data-ver>전체 내역</button><button type="button" class="btn" data-ok>확인</button></div>`);
  m.el.querySelector('[data-ok]').onclick = () => m.close();
  m.el.querySelector('[data-ver]').addEventListener('click', () => m.close());
  return m;
}

hooks.route = route;
hooks.updateShell = updateShell;

async function handlePaymentReturn() {
  // 휴대폰: 포트원 결제 화면에서 ?pay=portone&paymentId=…(&code=…&message=…) 로 돌아옴
  const q = new URLSearchParams(location.search);
  if (!q.has('pay')) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (q.get('code') || !q.get('paymentId')) {
    toast(`결제가 취소되었거나 실패했습니다. ${q.get('message') || ''}`);
    return;
  }
  if (auth.demo) { toast('체험 모드라 결제창까지만 확인했어요 (기간 연장은 실제 사이트에서).'); return; }
  await onboard.confirmPayment({ paymentId: q.get('paymentId') });
}

if (!isConfigured) {
  app.innerHTML = `<div class="setup">
    <h1>SSAKA MANAGER</h1>
    <p>Firebase 설정이 아직 없습니다.</p>
    <p><code>public/js/config.js</code> 의 <code>firebaseConfig</code> 를 Firebase 콘솔 값으로 바꾼 뒤 새로고침하세요.<br>자세한 순서는 <code>README.md</code> 를 참고하세요.</p>
  </div>`;
} else if (['resetPassword', 'verifyEmail'].includes(new URLSearchParams(location.search).get('mode'))) {
  // 인증 메일의 링크로 들어온 경우 — 비밀번호 재설정 / 이메일 인증
  const q = new URLSearchParams(location.search);
  app.innerHTML = '<div class="bare" id="view"></div>' + FOOTER;
  (q.get('mode') === 'resetPassword' ? authPages.resetPage : authPages.verifyEmailPage)($('#view'), q.get('oobCode') || '');
} else {
  let first = true;
  kakaoReturn(); // 카카오에서 돌아왔으면 그 열쇠로 로그인 (주소에서 바로 지움)
  onAuthStateChanged(auth, async (u) => {
    state.user = u;
    if (!u) stopNews();
    await loadContext();
    app.innerHTML = '';
    await route();
    // 결제창에서 돌아왔으면: 화면을 그린 뒤에 승인 (화면이 바뀔 때 창이 닫히지 않게)
    if (first && u) { first = false; await handlePaymentReturn(); }
    const um = updatePopup();
    const next = () => seasonPopup() || gradPopup(); // 새 시즌: 선수는 학년 · 등번호, 팀 대표는 졸업 정리
    if (um) um.onClose = next; else next();
  });
  quotaHooks.isAdmin = isAdmin;
  // 어디서 났든 무료 사용량 초과 오류면 위에 안내 (운영자에게만)
  window.addEventListener('unhandledrejection', (e) => { if (isQuota(e.reason)) quotaNotice(); });
  // 화면 이동(뒤로가기 포함) 전에, 저장 안 한 수정이 있는 화면이면 한 번 물어봄
  let lastHash = location.hash;
  let skipNext = false;
  window.addEventListener('hashchange', () => {
    if (skipNext) { skipNext = false; lastHash = location.hash; return; }
    if (state.leaveGuard?.() && !window.confirm('저장하지 않은 수정 내용이 있어요. 이 화면을 나갈까요?\n\n(나가도 이 컴퓨터에 임시로 보관돼서, 다시 열면 이어서 할 수 있어요)')) {
      skipNext = true;
      location.hash = lastHash; // 원래 화면으로 되돌림
      return;
    }
    lastHash = location.hash;
    route();
  });
}
