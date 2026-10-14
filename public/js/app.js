import { isConfigured, FREE_MODE } from './config.js';
import { installButton, bindInstall } from './install.js';
import { attachHelp } from './help.js';
import { startNews, stopNews, markSeen, paint } from './news.js';
import { auth, onAuthStateChanged, signOut } from './fb.js';
import { $, $$, esc, avatar, ROLES, pageHead, toast, isQuota, quotaNotice, quotaHooks } from './ui.js';
import {
  state, hooks, go, loadContext, role, inTeam, isCoach, isSquad, isOwner, isAdmin, isAdminEmail, teamActive, waitApproval, teamRestricted,
} from './store.js';
import * as authPages from './pages/auth.js';
import * as admin from './pages/admin.js';
import * as support from './pages/support.js';
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
import * as goals from './pages/goals.js';
import * as personal from './pages/personal.js';
import * as social from './pages/social.js';

const app = $('#app');
const RESTRICT_OK = ['/', '/settings', '/support', '/support/qna', '/me', '/privacy', '/pay'];

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
  ['/records', team.records, 'squad'],
  ['/data', data.page, 'squad'],
  ['/training', trainingDaily.daily, 'squad'],
  ['/training/notes', trainingDaily.notes, 'coach'],
  ['/training/library', training.library, 'coach'],
  ['/meeting', board.page('meeting'), 'squad'],
  ['/analysis', analysis.list, 'squad'],
  ['/analysis/:id', analysis.studio, 'squad'],
  ['/analysis/:id/edit', analysis.studioEdit, 'squad'],
  ['/notice', board.page('notice'), 'member'],
  ['/schedule', board.page('schedule'), 'member'],
  ['/me', personal.profile],
  ['/daily', personal.daily, 'squad'],
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
  ['/consent/:token', privacy.consentPage, 'any'],
  ['/community', (el) => community.page(el, { cat: 'training' }), 'coach'],
  ['/community/:cat', community.page, 'coach'],
  ['/support', support.page],
  ['/support/qna', support.qna],
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

// 맨 밑 회사 정보 (통신판매업 신고번호는 나오면 여기에 추가)
const FOOTER = `
<footer class="site-foot">
  <div class="sf-top">
    <div class="sf-brand">
      <strong>SSAKA MANAGER</strong>
      <span>축구팀을 위한 매니지먼트 플랫폼</span>
    </div>
    <nav class="sf-links">
      <a href="#/privacy"><b>개인정보처리방침</b></a>
      <a href="#/support">운영자 문의</a>
    </nav>
  </div>
  <dl class="sf-info">
    <div><dt>상호</dt><dd>KEEPER LAB</dd></div>
    <div><dt>대표</dt><dd>유수영</dd></div>
    <div><dt>사업자등록번호</dt><dd>451-15-03077</dd></div>
    <div><dt>주소</dt><dd>경기도 안산시 단원구 사세충열로4길 6</dd></div>
  </dl>
  <div class="sf-bottom">
    <span>© ${new Date().getFullYear()} KEEPER LAB. All rights reserved.</span>
    <span class="sf-mark">KEEPER LAB</span>
  </div>
</footer>`;

async function route() {
  state.cleanup.forEach((f) => f());
  state.cleanup = [];
  document.querySelectorAll('.modal-wrap').forEach((m) => m.remove()); // 이전 화면에서 열린 창은 닫기
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
  sec('TEAM', isSquad() ? [
    ['/', '홈'], ['/gamemodel', '게임모델'], ['/locker', '락커룸'], ['/training', '훈련장'],
    ['/meeting', '미팅룸'], ['/analysis', '분석실'], ['/goals', '목표'], ['/records', '경기 기록실'], ['/data', '데이터실'],
  ] : [['/', '홈']]);
  sec('MY', [
    ['/me', '프로필'],
    ...(isSquad() ? [['/daily', '오늘 기록']] : []),
    ...(isCoach() ? [['/journal-check', '일지검사']] : []),
  ]);
  sec('NOTICE', inTeam() ? [['/notice', '공지사항'], ['/schedule', '스케줄']] : []);
  sec('COMMUNITY', isCoach() ? [['/community/training', '훈련 공유'], ['/community/talk', '지도자 게시판'], ['/chat', '팀 대화']] : []);
  sec('NETWORK', [...(isCoach() ? [['/scout', '스카웃 노트']] : []), ['/support', '운영자 문의']]);
  if (isAdmin()) sec('운영자', [['/admin', '전체 공지'], ['/admin/teams', '전체 팀'], ['/admin/users', '전체 인원'], ['/admin/inbox', '소통']]);
  else if (isAdminEmail()) sec('운영자', [['/admin/verify', '운영자 인증']]);
  if (isOwner()) sec('ADMIN', [['/settings', FREE_MODE ? '팀 설정' : '팀 설정 · 결제']]);
  return items;
}

function renderShell() {
  app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <button class="icon-btn" data-toggle="nav-open" aria-label="메뉴">☰</button>
      <a href="#/" class="logo-sm">SSAKA MANAGER</a>
      <button class="icon-btn" data-toggle="search-open" aria-label="팀 검색">⌕</button>
    </header>
    <aside class="nav">
      <a href="#/" class="logo"><span>SSAKA</span><span>MANAGER</span><small>싸카매니저</small></a>
      <div class="team-chip"></div>
      <nav class="nav-list"></nav>
      <div class="me-box"></div>
    </aside>
    <main class="main-col"><div id="sys-notice"></div><div id="team-notice"></div><div id="view"></div>${FOOTER}</main>
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
    .sort((a, b) => b.length - a.length)[0];
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

hooks.route = route;
hooks.updateShell = updateShell;

// 토스페이먼츠 successUrl / failUrl 로 돌아왔을 때 처리
async function handlePaymentReturn() {
  const q = new URLSearchParams(location.search);
  if (!q.has('pay')) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (q.get('pay') === 'fail') {
    toast(`결제가 취소되었거나 실패했습니다. ${q.get('message') || ''}`);
    return;
  }
  await onboard.confirmPayment({
    paymentKey: q.get('paymentKey'), orderId: q.get('orderId'), amount: Number(q.get('amount')),
  });
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
  onAuthStateChanged(auth, async (u) => {
    state.user = u;
    if (!u) stopNews();
    await loadContext();
    if (first && u) { first = false; await handlePaymentReturn(); }
    app.innerHTML = '';
    route();
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
