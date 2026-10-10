import { FREE_MODE } from '../config.js';
import {
  db, collection, query, where, orderBy, limit, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp,
} from '../fb.js';
import { esc, fmtDate, todayStr, empty, fail } from '../ui.js';
import { state, inTeam, isSquad, isCoach, isOwner, teamActive, role } from '../store.js';
import { calcStats } from './team.js';
import { renderBriefing } from './briefing.js';
import { sleepOf, SHORT_SLEEP } from '../sleep.js';

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];

function greeting() {
  const r = role();
  if (r === 'player') return `${esc(state.profile.name)} 선수, 오늘도 한 걸음 더 성장하는 하루를 응원합니다.`;
  return '코치님, 오늘 하루도 꿈나무들을 위해서 일하시는 당신을 응원합니다.';
}

function morningHead(stats = []) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `
  <header class="morning">
    <div class="m-date">
      <span class="eyebrow">${d.getFullYear()} · ${DOW[d.getDay()]}</span>
      <strong>${p(d.getMonth() + 1)}.${p(d.getDate())} <small>${DOW_KO[d.getDay()]}요일</small></strong>
    </div>
    <div class="m-hello">
      <span class="m-clock" data-clock>${p(d.getHours())}:${p(d.getMinutes())}</span>
      <h1>${greeting()}</h1>
      ${state.team ? `<p>${esc(state.team.category)} · ${esc(state.team.name)}</p>` : ''}
    </div>
    ${stats.length ? `<div class="m-stats">${stats.map(([label, value, href]) => `
      <a href="#${href}"><small>${label}</small><strong>${value}</strong></a>`).join('')}</div>` : ''}
  </header>`;
}

function startClock(el) {
  const t = setInterval(() => {
    const c = el.querySelector('[data-clock]');
    if (!c) return clearInterval(t);
    const d = new Date();
    c.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }, 15000);
  state.cleanup.push(() => clearInterval(t));
}

// 할 일 메모장 — users/{uid}/todos (나만 보임)
async function todoPad(box) {
  const col = collection(db, 'users', state.user.uid, 'todos');
  let items = [];
  const draw = () => {
    const left = items.filter((t) => !t.done).length;
    box.innerHTML = `
      <section class="todo">
        <header class="todo-head">
          <div><span class="eyebrow">TO DO</span><h3>오늘 할 일</h3></div>
          <span class="count">${items.length ? `${left}개 남음` : ''}</span>
        </header>
        <form class="todo-add"><input name="text" maxlength="120" autocomplete="off" placeholder="할 일을 적고 Enter — 예) 오후 훈련 콘 세팅, 원정 버스 예약"><button class="btn sm">추가</button></form>
        <ul class="todo-list">${items.map((t) => `
          <li class="${t.done ? 'done' : ''}" data-id="${t.id}">
            <button class="check" data-toggle aria-label="완료">${t.done ? '✓' : ''}</button>
            <span>${esc(t.text)}</span>
            <button class="todo-x" data-del aria-label="삭제">✕</button>
          </li>`).join('')}</ul>
        ${items.some((t) => t.done) ? '<button class="link-btn small" data-clear>완료한 일 지우기</button>' : ''}
      </section>`;
    const form = box.querySelector('form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = form.text.value.trim();
      if (!text) return;
      form.text.value = '';
      try {
        const ref = await addDoc(col, { text, done: false, createdAt: serverTimestamp() });
        items.push({ id: ref.id, text, done: false });
        draw();
        box.querySelector('.todo-add input').focus();
      } catch (err) { fail(err); }
    };
    box.querySelectorAll('[data-id]').forEach((li) => {
      const t = items.find((x) => x.id === li.dataset.id);
      li.querySelector('[data-toggle]').onclick = async () => {
        try { await updateDoc(doc(col, t.id), { done: !t.done }); t.done = !t.done; draw(); } catch (err) { fail(err); }
      };
      li.querySelector('[data-del]').onclick = async () => {
        try { await deleteDoc(doc(col, t.id)); items = items.filter((x) => x !== t); draw(); } catch (err) { fail(err); }
      };
    });
    box.querySelector('[data-clear]')?.addEventListener('click', async () => {
      try {
        await Promise.all(items.filter((t) => t.done).map((t) => deleteDoc(doc(col, t.id))));
        items = items.filter((t) => !t.done);
        draw();
      } catch (err) { fail(err); }
    });
  };
  try {
    const snap = await getDocs(query(col, orderBy('createdAt')));
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) { fail(err); }
  draw();
}

export async function render(el) {
  const t = state.team;

  // 팀 없음 / 결제 대기
  if (!inTeam()) {
    const pending = t && isOwner();
    el.innerHTML = `${morningHead()}
      <div class="tiles">
        ${pending ? `<a class="tile" href="#/pay"><span class="eyebrow">PENDING</span><h3>${esc(t.name)} 결제하기</h3><p>결제가 완료되면 팀 코드가 발급되고 락커룸이 열립니다.</p></a>` : `
        ${role() === 'coach' ? `<a class="tile" href="#/team/new"><span class="eyebrow">CREATE</span><h3>팀계정 만들기</h3><p>${FREE_MODE ? '팀 정보 입력 → 바로 팀 코드 발급 (무료)' : '팀 정보 입력 → 월 이용료 결제 → 팀 코드 발급'}</p></a>` : ''}
        <a class="tile" href="#/team/join"><span class="eyebrow">JOIN</span><h3>팀 코드로 입장</h3><p>코치에게 받은 코드로 락커룸에 입장합니다.</p></a>`}
        <a class="tile" href="#/me"><span class="eyebrow">PROFILE</span><h3>내 프로필</h3><p>사진 · 키 · 몸무게 · 포지션</p></a>
      </div>
      <div data-todo></div>
      <div data-brief></div>`;
    startClock(el);
    todoPad(el.querySelector('[data-todo]'));
    await renderBriefing(el.querySelector('[data-brief]'));
    return;
  }

  const base = ['teams', t.id];
  const today = todayStr();
  const posts = collection(db, ...base, 'posts');
  const [n, s, m, myLog, logsToday, members, plansToday] = await Promise.all([
    getDocs(query(posts, where('type', '==', 'notice'), orderBy('createdAt', 'desc'), limit(4))),
    getDocs(query(posts, where('type', '==', 'schedule'), where('date', '>=', today), orderBy('date'), limit(8))),
    isSquad() ? getDocs(collection(db, ...base, 'matches')) : null,
    isSquad() ? getDoc(doc(db, ...base, 'logs', `${state.user.uid}_${today}`)) : null,
    isCoach() ? getDocs(query(collection(db, ...base, 'logs'), where('date', '==', today))) : null,
    isCoach() ? getDocs(collection(db, ...base, 'members')) : null,
    isSquad() ? getDocs(query(posts, where('type', '==', 'daily'), where('date', '==', today))) : null,
  ]);

  const st = m ? calcStats(m.docs.map((d) => d.data())) : null;
  const sched = s.docs.map((d) => d.data()).filter((x) => !x.isNote);
  const todays = sched.filter((x) => x.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const upcoming = sched.filter((x) => x.date > today).slice(0, 5);
  const plans = plansToday ? plansToday.docs.map((d) => d.data()) : [];
  const allMembers = members ? members.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  const waitingN = isOwner() ? allMembers.filter((x) => x.approved === false).length : 0; // 입장 승인 대기
  const players = allMembers.filter((x) => x.role === 'player' && x.approved !== false);
  const logs = logsToday ? logsToday.docs.map((d) => d.data()) : [];
  const submitted = logs.filter((l) => l.submitted);
  const alertLogs = logs.filter((l) => l.injury >= 5 || l.condition <= 2 || (sleepOf(l) != null && sleepOf(l) < SHORT_SLEEP));

  const stats = [
    ['오늘 일정', todays.length ? `${todays.length}건` : '없음', '/schedule'],
    ...(isCoach() ? [['일지 제출', `${submitted.length}/${players.length}`, '/journal-check'], ['주의 선수', `${alertLogs.length}명`, '/journal-check']] : []),
    ...(st ? [['시즌 성적', `${st.w}승 ${st.d}무 ${st.l}패`, '/records']] : []),
  ];

  // 오늘 일정 + 오늘 훈련 안내
  const todayCard = `<section class="card hcard">
    <div class="card-head"><h3>오늘 일정</h3><a href="#/schedule" class="more">스케줄 →</a></div>
    ${todays.length || plans.length ? `<ul class="list">
      ${todays.map((x) => `<li><span class="date-badge">${esc(x.time || '종일')}</span><div><strong>${esc(x.title)}</strong><small>${esc([x.kind, x.place].filter(Boolean).join(' · '))}</small></div>${x.kind === '경기' ? '<span class="tag solid">경기</span>' : ''}</li>`).join('')}
      ${plans.map((p) => `<li><span class="date-badge">${esc(p.time || '훈련')}</span><div><strong>${esc(p.title || '훈련')}</strong><small>${esc(p.goal ? `목표 · ${p.goal}` : `${(p.blocks || []).length}개 훈련`)}</small></div><a href="#/training" class="more">훈련장 →</a></li>`).join('')}
    </ul>` : empty('오늘은 일정이 없어요.')}
  </section>`;

  // 코치: 일지 현황 / 선수: 내 오늘 기록
  const l = myLog?.exists() ? myLog.data() : null;
  const journalCard = isCoach() ? `<section class="card hcard">
      <div class="card-head"><h3>오늘 일지</h3><a href="#/journal-check" class="more">일지검사 →</a></div>
      <div class="hbig"><strong>${submitted.length}<i>/${players.length}</i></strong><small>제출 · 검사 대기 ${submitted.filter((x) => !x.checked).length}</small></div>
      ${alertLogs.length ? `<div class="halert"><b>주의</b>${alertLogs.map((x) => esc(x.name)).join(', ')}</div>` : '<p class="muted small">주의할 선수가 없어요.</p>'}
    </section>`
    : isSquad() ? `<section class="card hcard">
      <div class="card-head"><h3>내 오늘 기록</h3></div>
      ${l ? `<div class="hbig"><strong>${l.checked ? '검사 완료' : l.submitted ? '제출함' : '작성 중'}</strong><small>컨디션 ${'●'.repeat(l.condition || 0)}${'○'.repeat(5 - (l.condition || 0))} · 수면 ${sleepOf(l) ?? '-'}분</small></div>
        ${l.coachComment ? `<div class="coach-note"><span class="tag solid">코치 한마디</span><p>${esc(l.coachComment)}</p></div>` : ''}`
        : '<p class="muted">아직 오늘 기록을 쓰지 않았어요.</p>'}
      <a href="#/daily" class="btn full">${l ? '오늘 기록 열기' : '오늘 기록 쓰기'}</a>
    </section>` : '';

  el.innerHTML = `${morningHead(stats)}
  ${!teamActive() ? `<div class="banner">팀 이용기간이 만료되었습니다. ${isOwner() ? '<a href="#/pay">연장 결제 →</a>' : '팀 관리자에게 문의하세요.'}</div>` : ''}
  ${waitingN ? `<a class="banner wait-banner" href="#/locker">🙋 입장 승인 대기 <b>${waitingN}명</b> — 락커룸에서 승인해 주세요 →</a>` : ''}
  <div class="home-sec"><span class="eyebrow">TODAY</span><h2>오늘</h2></div>
  <div class="home-grid ${journalCard ? '' : 'two'}">
    ${todayCard}
    <div data-todo></div>
    ${journalCard}
  </div>
  <div class="home-sec"><span class="eyebrow">TEAM</span><h2>팀 소식</h2></div>
  <div class="home-grid two">
    <section class="card hcard">
      <div class="card-head"><h3>공지사항</h3><a href="#/notice" class="more">전체 →</a></div>
      ${n.empty ? empty('공지가 없습니다.') : `<ul class="list">${n.docs.map((d) => { const x = d.data(); return `
        <li><div><strong>${x.pinned ? '📌 ' : ''}${esc(x.title)}</strong><small>${fmtDate(x.createdAt)}</small></div></li>`; }).join('')}</ul>`}
    </section>
    <section class="card hcard">
      <div class="card-head"><h3>다가오는 일정</h3><a href="#/schedule" class="more">전체 →</a></div>
      ${upcoming.length ? `<ul class="list">${upcoming.map((x) => `
        <li><span class="date-badge">${esc(x.date.slice(5).replace('-', '.'))}</span><div><strong>${esc(x.title)}</strong><small>${esc([x.time, x.kind, x.place].filter(Boolean).join(' · '))}</small></div></li>`).join('')}</ul>` : empty('예정된 일정이 없습니다.')}
    </section>
  </div>
  <div data-brief></div>`;
  startClock(el);
  todoPad(el.querySelector('[data-todo]'));
  await renderBriefing(el.querySelector('[data-brief]'));
}
