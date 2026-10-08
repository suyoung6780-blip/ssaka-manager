import { isConfigured, FREE_MODE } from './config.js';
import { installButton, bindInstall } from './install.js';
import { attachHelp } from './help.js';
import { auth, onAuthStateChanged, signOut } from './fb.js';
import { $, $$, esc, avatar, ROLES, toast } from './ui.js';
import {
  state, hooks, go, loadContext, role, inTeam, isCoach, isSquad, isOwner, isAdmin, isAdminEmail, teamActive, waitApproval,
} from './store.js';
import * as authPages from './pages/auth.js';
import * as admin from './pages/admin.js';
import * as support from './pages/support.js';
import * as privacy from './pages/privacy.js';
import * as home from './pages/home.js';
import * as onboard from './pages/onboard.js';
import * as team from './pages/team.js';
import * as board from './pages/board.js';
import * as training from './pages/training.js';
import * as trainingDaily from './pages/trainingDaily.js';
import * as analysis from './pages/analysis.js';
import * as goals from './pages/goals.js';
import * as personal from './pages/personal.js';
import * as social from './pages/social.js';

const app = $('#app');

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
  ['/counsel', team.counsel, 'squad'],
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
  ['/chat', social.chatList],
  ['/chat/:id', social.chatRoom],
  ['/admin', admin.page, 'admin'],
  ['/admin/teams', admin.teams, 'admin'],
  ['/admin/users', admin.users, 'admin'],
  ['/admin/verify', admin.verify, 'adminEmail'],
  ['/admin/inbox', support.inbox, 'admin'],
  ['/admin/inbox/qna', support.inbox, 'admin'],
  ['/admin/inbox/:id', support.inbox, 'admin'],
  ['/privacy', privacy.page, 'any'],
  ['/consent/:token', privacy.consentPage, 'any'],
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

async function route() {
  state.cleanup.forEach((f) => f());
  state.cleanup = [];
  const path = location.hash.slice(1) || '/';
  const r = match(path) || match('/');

  if (r.guard === 'public') {
    if (state.user) return go('/');
    app.innerHTML = '<div class="bare" id="view"></div>';
    return r.fn($('#view'), r.params);
  }
  // 로그인 없이도 보는 화면 (처리방침 · 보호자 동의 링크)
  if (r.guard === 'any' && (!state.user || !state.profile || privacy.needGuardian())) {
    app.innerHTML = '<div class="bare" id="view"></div>';
    return r.fn($('#view'), r.params);
  }
  if (!state.user) return go('/login');
  if (!state.profile) {
    app.innerHTML = '<div class="bare" id="view"></div>';
    return authPages.completeProfile($('#view'));
  }
  // 처리방침이 생기기 전에 가입한 회원: 한 번 동의 받기
  if (privacy.needAgree() && r.guard !== 'any') {
    app.innerHTML = '<div class="bare" id="view"></div>';
    return privacy.agreeGate($('#view'));
  }
  // 만 14세 미만: 보호자 동의 전에는 동의 안내 화면만
  if (privacy.needGuardian()) {
    app.innerHTML = '<div class="bare" id="view"></div>';
    return privacy.guardianWait($('#view'));
  }
  // 팀 코드로 들어온 뒤 팀 대표 승인 전
  if (waitApproval() && r.guard !== 'any') {
    app.innerHTML = '<div class="bare" id="view"></div>';
    return privacy.approvalWait($('#view'));
  }
  if (!allowed(r.guard)) return go('/');

  if (!$('.shell')) renderShell();
  updateShell(path);
  const view = $('#view');
  view.innerHTML = '<div class="loading">LOADING</div>';
  $('.shell').classList.remove('nav-open', 'search-open');
  try {
    await r.fn(view, r.params);
    if (view.isConnected) attachHelp(view, path);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty">페이지를 불러오지 못했습니다.<br><small>${esc(e.message)}</small></div>`;
  }
  window.scrollTo(0, 0);
}

function navItems() {
  const items = [];
  const sec = (title, list) => list.length && items.push({ title, list });
  sec('TEAM', isSquad() ? [
    ['/', '홈'], ['/gamemodel', '게임모델'], ['/locker', '락커룸'], ['/training', '훈련장'],
    ['/meeting', '미팅룸'], ['/analysis', '분석실'], ['/counsel', '상담실'], ['/goals', '목표'], ['/records', '기록실'],
  ] : [['/', '홈']]);
  sec('MY', [
    ['/me', '프로필'],
    ...(isSquad() ? [['/daily', '오늘 기록']] : []),
    ...(isCoach() ? [['/journal-check', '일지검사']] : []),
  ]);
  sec('NOTICE', inTeam() ? [['/notice', '공지사항'], ['/schedule', '스케줄']] : []);
  sec('NETWORK', [...(isCoach() ? [['/scout', '스카우터']] : []), ['/chat', '대화'], ['/support', '운영자 문의']]);
  if (isAdmin()) sec('운영자', [['/admin', '전체 공지'], ['/admin/teams', '전체 팀'], ['/admin/users', '전체 인원'], ['/admin/inbox', '문의함']]);
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
    <main class="main-col"><div id="sys-notice"></div><div id="view"></div></main>
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
  app.innerHTML = '<div class="bare" id="view"></div>';
  (q.get('mode') === 'resetPassword' ? authPages.resetPage : authPages.verifyEmailPage)($('#view'), q.get('oobCode') || '');
} else {
  let first = true;
  onAuthStateChanged(auth, async (u) => {
    state.user = u;
    await loadContext();
    if (first && u) { first = false; await handlePaymentReturn(); }
    app.innerHTML = '';
    route();
  });
  window.addEventListener('hashchange', route);
}
