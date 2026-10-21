import { FREE_MODE } from '../config.js';
import {
  db, collection, query, where, orderBy, limit, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp,
} from '../fb.js';
import { esc, fmtDate, todayStr, fail } from '../ui.js';
import { state, inTeam, isSquad, isCoach, isOwner, teamActive, role } from '../store.js';
import { calcStats } from './team.js';
import { coachDesk, answersCard, recentLogs, teamMembers, quickBar, deskSkeleton } from './homeCoach.js';
import { sleepOf } from '../sleep.js';

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];

// 인사말: 날마다 한 줄씩 바뀜 (같은 날엔 같은 문장) — 코치 · 선수 각 60개, 두 달마다 한 바퀴
const HELLO_COACH = [
  '코치님, 오늘 훈련장에서 나올 좋은 장면을 기대합니다.',
  '코치님, 오늘의 한마디가 선수의 내일을 바꿉니다.',
  '코치님, 좋은 팀은 매일의 작은 약속에서 만들어집니다.',
  '코치님, 오늘도 휘슬 하나에 팀이 하나로 움직이길.',
  '코치님, 준비한 만큼 경기장에서 보입니다. 오늘도 좋은 준비를.',
  '코치님, 선수들은 코치님의 열정을 보고 자랍니다.',
  '코치님, 오늘도 한 경기 한 훈련, 차근차근 쌓아가요.',
  '코치님, 오늘 훈련의 목표 하나만 분명하면 충분합니다.',
  '코치님, 선수의 눈빛이 달라지는 순간을 놓치지 마세요.',
  '코치님, 오늘도 운동장에서 가장 먼저 웃는 사람이 되어 주세요.',
  '코치님, 작은 칭찬 하나가 선수의 하루를 바꿉니다.',
  '코치님, 좋은 질문이 좋은 선수를 만듭니다.',
  '코치님, 오늘 훈련이 경기와 닮을수록 경기가 쉬워집니다.',
  '코치님, 선수들은 코치님의 말보다 행동을 기억합니다.',
  '코치님, 실수를 허락하는 팀이 결국 도전하는 팀이 됩니다.',
  '코치님, 오늘도 공 하나로 선수들의 꿈을 키워 주세요.',
  '코치님, 완벽한 훈련보다 꾸준한 훈련이 강합니다.',
  '코치님, 이기는 법과 함께 성장하는 법도 가르치고 계십니다.',
  '코치님, 오늘 한 명의 선수에게 특별한 한마디를 건네 보세요.',
  '코치님, 좋은 팀 분위기는 코치님의 첫인사에서 시작됩니다.',
  '코치님, 휴식도 계획입니다. 선수들의 몸 상태를 살펴 주세요.',
  '코치님, 오늘 그린 작전 하나가 주말 경기의 골이 됩니다.',
  '코치님, 선수가 스스로 답을 찾게 기다려 주는 것도 코칭입니다.',
  '코치님, 어제의 경기는 오늘 훈련의 가장 좋은 교과서입니다.',
  '코치님, 오늘도 선수들의 이름을 한 번씩 불러 주세요.',
  '코치님, 강한 팀은 힘든 순간에 서로를 봅니다.',
  '코치님, 훈련장의 공기는 코치님이 만듭니다.',
  '코치님, 오늘의 기록이 내일의 계획이 됩니다.',
  '코치님, 공 없는 움직임까지 보는 하루 되세요.',
  '코치님, 결과보다 과정을 칭찬하면 과정이 좋아집니다.',
  '코치님, 오늘 훈련 끝에 선수들이 웃으며 돌아가길.',
  '코치님, 하나를 가르쳐도 끝까지 가르치는 하루 되세요.',
  '코치님, 선수의 성장은 매일 보이지 않아도 매일 일어납니다.',
  '코치님, 좋은 수비는 좋은 습관에서 나옵니다.',
  '코치님, 빠른 판단은 많은 경험에서 나옵니다. 오늘도 경험을 선물해 주세요.',
  '코치님, 선수들에게 오늘의 한 문장을 남겨 주세요.',
  '코치님, 지는 날에도 배우는 팀이 결국 이깁니다.',
  '코치님, 오늘도 축구를 사랑하게 만드는 하루 되세요.',
  '코치님, 기본기는 화려하지 않지만 배신하지 않습니다.',
  '코치님, 선수들의 컨디션 기록에 오늘의 답이 있습니다.',
  '코치님, 오늘 경기장에서 가장 많이 뛰는 건 코치님의 마음입니다.',
  '코치님, 팀의 약속을 지키는 선수를 꼭 알아봐 주세요.',
  '코치님, 오늘 훈련은 짧고 강하게, 그리고 즐겁게.',
  '코치님, 좋은 패스처럼 좋은 피드백도 타이밍이 중요합니다.',
  '코치님, 한 걸음 물러서서 보면 경기가 더 잘 보입니다.',
  '코치님, 선수들은 믿어 주는 만큼 자랍니다.',
  '코치님, 오늘의 땀이 시즌 끝의 웃음이 됩니다.',
  '코치님, 전술은 선수가 이해할 때 비로소 완성됩니다.',
  '코치님, 오늘도 휘슬을 불 수 있음에 감사하는 하루 되세요.',
  '코치님, 작은 공간에서의 자신감이 큰 경기의 침착함이 됩니다.',
  '코치님, 선수 한 명 한 명의 이야기에 귀 기울여 주세요.',
  '코치님, 반복은 지루하지 않게, 변화는 어렵지 않게.',
  '코치님, 팀은 경기장 밖에서도 만들어집니다.',
  '코치님, 오늘 훈련이 끝나면 코치님도 꼭 쉬어 가세요.',
  '코치님, 준비된 코치 뒤에 준비된 팀이 있습니다.',
  '코치님, 오늘의 작은 변화가 한 달 뒤 큰 차이가 됩니다.',
  '코치님, 공을 뺏긴 뒤의 5초, 오늘 한 번 더 강조해 볼까요?',
  '코치님, 경기의 흐름을 읽는 눈을 선수들에게 나눠 주세요.',
  '코치님, 오늘도 우리 팀만의 축구를 한 장면 더 만들어 가요.',
  '코치님, 좋은 지도자는 매일 배우는 사람입니다.',
];
const HELLO_PLAYER = [
  '{n} 선수, 오늘 터치 하나가 내일의 무기가 됩니다.',
  '{n} 선수, 어제보다 한 발 더 뛰는 하루로 만들어 봐요.',
  '{n} 선수, 좋은 선수는 공이 없을 때도 생각합니다.',
  '{n} 선수, 오늘 기록 한 줄이 성장의 증거예요.',
  '{n} 선수, 실수는 괜찮아요. 다시 시도하는 게 실력입니다.',
  '{n} 선수, 오늘도 즐겁게, 그리고 끝까지.',
  '{n} 선수, 몸 관리도 훈련이에요. 오늘 컨디션 기록 잊지 마세요.',
  '{n} 선수, 오늘 첫 터치는 다음 패스 방향으로!',
  '{n} 선수, 공 받기 전에 어깨 너머 한 번 더 보기.',
  '{n} 선수, 잘하는 것은 더 잘하게, 못하는 것은 조금씩.',
  '{n} 선수, 오늘 훈련에서 하나만 배워 와도 성공이에요.',
  '{n} 선수, 동료를 부르는 목소리도 실력이에요.',
  '{n} 선수, 힘들 때 한 번 더 뛰는 사람이 경기를 바꿉니다.',
  '{n} 선수, 오늘은 약한 발로 한 번 더 차 봐요.',
  '{n} 선수, 잘 먹고 잘 자는 것도 훈련이에요.',
  '{n} 선수, 공을 뺏기면 바로 다시 뺏으러 가기!',
  '{n} 선수, 코치님 말씀 중 오늘 기억할 한 문장을 적어 봐요.',
  '{n} 선수, 패스 하나에도 마음을 담아 보세요.',
  '{n} 선수, 오늘의 땀은 거짓말하지 않아요.',
  '{n} 선수, 자신 있게 시도하는 모습이 가장 멋져요.',
  '{n} 선수, 경기는 90분, 집중은 끝까지!',
  '{n} 선수, 동료가 실수하면 먼저 괜찮다고 말해 주세요.',
  '{n} 선수, 좋은 선수는 쉬운 것을 정확하게 합니다.',
  '{n} 선수, 오늘도 축구를 즐기는 하루 되세요.',
  '{n} 선수, 몸이 아프면 숨기지 말고 코치님께 꼭 말해요.',
  '{n} 선수, 스트레칭 5분이 부상을 막아 줘요.',
  '{n} 선수, 오늘 목표 하나를 정하고 운동장에 들어가요.',
  '{n} 선수, 상대보다 한 발 먼저 생각하기!',
  '{n} 선수, 넘어져도 바로 일어나는 게 진짜 실력이에요.',
  '{n} 선수, 물 자주 마시는 것 잊지 마세요.',
  '{n} 선수, 오늘 배운 것을 일지에 꼭 남겨 봐요.',
  '{n} 선수, 꿈은 크게, 오늘 할 일은 작게 하나씩.',
  '{n} 선수, 공이 없을 때 어디에 서 있는지가 중요해요.',
  '{n} 선수, 오늘은 어제의 나와 경쟁해 봐요.',
  '{n} 선수, 패스를 받으면 고맙다고, 주면 잘 받으라고!',
  '{n} 선수, 좋은 습관이 좋은 선수를 만들어요.',
  '{n} 선수, 오늘 컨디션은 몇 점인가요? 기록해 두면 도움이 돼요.',
  '{n} 선수, 슈팅은 자신 있게, 패스는 정확하게.',
  '{n} 선수, 훈련 끝나고 공 정리도 팀워크예요.',
  '{n} 선수, 오늘 하루도 최선을 다한 나를 칭찬해 주세요.',
  '{n} 선수, 수비는 발보다 눈이 먼저예요.',
  '{n} 선수, 질문하는 선수가 빨리 성장해요.',
  '{n} 선수, 오늘도 한 번 더 웃으며 뛰어요.',
  '{n} 선수, 작은 성공을 쌓으면 큰 자신감이 돼요.',
  '{n} 선수, 동료의 좋은 플레이에 박수를 보내 주세요.',
  '{n} 선수, 오늘 연습한 것이 경기에서 나와요.',
  '{n} 선수, 일찍 자면 내일 더 빨라져요.',
  '{n} 선수, 포기하지 않는 마음이 가장 강한 무기예요.',
  '{n} 선수, 경기 전에는 긴장해도 괜찮아요. 준비한 대로만!',
  '{n} 선수, 오늘 가장 많이 한 터치는 몇 번일까요?',
  '{n} 선수, 팀을 위해 뛰는 선수가 결국 빛나요.',
  '{n} 선수, 오늘의 실수는 내일의 연습 과제예요.',
  '{n} 선수, 고개를 들고 플레이하는 하루!',
  '{n} 선수, 좋아하는 선수의 장면을 따라 해 봐요.',
  '{n} 선수, 오늘도 끝까지 해낸 나에게 박수!',
  '{n} 선수, 훈련은 진지하게, 축구는 즐겁게.',
  '{n} 선수, 오늘 기록이 쌓이면 내 성장이 보여요.',
  '{n} 선수, 한 번 더 시도한 사람이 결국 성공해요.',
  '{n} 선수, 공을 사랑하는 만큼 실력이 늘어요.',
  '{n} 선수, 오늘도 멋진 하루 만들어 봐요.',
];
function greeting() {
  const d = new Date();
  const day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  if (role() === 'player') return HELLO_PLAYER[day % HELLO_PLAYER.length].replace('{n}', esc(state.profile.name));
  return HELLO_COACH[day % HELLO_COACH.length];
}

// 맨 위 요약 칸 아이콘 (선 그림)
const SI = {
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M12 14h2M16 14h0"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  chart: '<path d="M4 20h16M7 17v-5M12 17V7M17 17v-8"/>',
};
const statIcon = (label) => `<svg class="m-ic" viewBox="0 0 24 24" aria-hidden="true">${SI[label.includes('일정') ? 'cal' : label.includes('일지') ? 'doc' : 'chart']}</svg>`;

// '코치님,' · '박선수 선수,' 는 윗줄, 나머지는 아랫줄
const helloLines = (t) => { const i = t.indexOf(', '); return i > 0 && i < 16 ? `<span class="m-who">${t.slice(0, i + 1)}</span><span class="m-msg">${t.slice(i + 2)}</span>` : t; };

// 맨 위 사진: 시간대별 (아침 5~10시 · 낮 10~16시 · 노을 16~19시 · 밤)
const timeOfDay = (d) => { const h = d.getHours(); return h >= 5 && h < 10 ? 'morning' : h < 16 && h >= 10 ? 'day' : h >= 16 && h < 19 ? 'dusk' : 'night'; };

function morningHead(stats = []) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `
  <header class="morning m-hero t-${timeOfDay(d)}${role() === 'player' ? ' pl' : ''}">
    <div class="m-date">
      <span class="eyebrow">${d.getFullYear()} · ${DOW[d.getDay()]}</span>
      <strong>${p(d.getMonth() + 1)}.${p(d.getDate())} <small>${DOW_KO[d.getDay()]}요일</small></strong>
    </div>
    <div class="m-hello">
      <span class="m-clock" data-clock>${p(d.getHours())}:${p(d.getMinutes())}</span>
      <h1>${helloLines(greeting())}</h1>
      ${state.team ? `<p>${esc(state.team.category)} · ${esc(state.team.name)}</p>` : ''}
    </div>
    ${stats.length ? `<div class="m-stats">${stats.map(([label, value, href]) => `
      <a href="#${href}">${statIcon(label)}<span><small>${label}</small><strong>${value}</strong></span></a>`).join('')}</div>` : ''}
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
      <div data-todo></div>`;
    startClock(el);
    todoPad(el.querySelector('[data-todo]'));
    return;
  }

  const base = ['teams', t.id];
  const today = todayStr();
  const posts = collection(db, ...base, 'posts');
  // 이번 주 (월요일 시작)
  const wd = new Date(`${today}T00:00`); wd.setDate(wd.getDate() - ((wd.getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => { const x = new Date(wd); x.setDate(wd.getDate() + i); return todayStr(x); });
  const coach = isCoach();
  // 읽기 아끼기: 겹치는 것은 한 번만 (이번 주 + 앞으로의 일정 한 번 · 이번 주 훈련 안내 한 번 · 최근 경기 40개까지)
  // 코치: 최근 7일 일지 · 팀원 목록은 이 기기에 몇 분 보관해서 다시 씀
  const [n, sc, wkPlans, m, myLog, members, logs7] = await Promise.all([
    getDocs(query(posts, where('type', '==', 'notice'), orderBy('createdAt', 'desc'), limit(3))),
    getDocs(query(posts, where('type', '==', 'schedule'), where('date', '>=', weekDays[0]), orderBy('date'), limit(30))).catch(() => null),
    isSquad() ? getDocs(query(posts, where('type', '==', 'daily'), where('date', '>=', weekDays[0]), where('date', '<=', weekDays[6]), orderBy('date'))).catch(() => null) : null,
    isSquad() ? getDocs(query(collection(db, ...base, 'matches'), orderBy('date', 'desc'), limit(40))).catch(() => null) : null,
    isSquad() && !coach ? getDoc(doc(db, ...base, 'logs', `${state.user.uid}_${today}`)).catch(() => null) : null,
    coach ? teamMembers(t.id) : null,
    coach ? recentLogs(t.id) : null,
  ]);

  const year = today.slice(0, 4);
  const allMatches = m ? m.docs.map((d) => d.data()) : [];
  const st = allMatches.length ? calcStats(allMatches.filter((x) => (x.date || '').startsWith(year))) : null;
  const schedAll = sc ? sc.docs.map((d) => d.data()).filter((x) => !x.isNote) : [];
  const todays = schedAll.filter((x) => x.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const wPlans = wkPlans ? wkPlans.docs.map((d) => d.data()) : [];
  const plans = wPlans.filter((x) => x.date === today);
  const allMembers = members || [];
  const waitingN = isOwner() ? allMembers.filter((x) => x.approved === false).length : 0; // 입장 승인 대기
  const players = allMembers.filter((x) => x.role === 'player' && x.approved !== false);
  const logsToday = (logs7 || []).filter((l) => l.date === today);
  const submitted = logsToday.filter((l) => l.submitted);

  const stats = [
    ['오늘 일정', todays.length + plans.length ? `${todays.length + plans.length}건` : '없음', '/schedule'],
    ...(coach ? [['일지 제출', `${submitted.length}/${players.length}`, '/journal-check']] : []),
    ...(st && st.games ? [[`${year} 성적`, `${st.w}승 ${st.d}무 ${st.l}패`, '/records']] : []),
  ];

  // ── 이번 주 한눈에 ──
  const KC = { 경기: 'k-match', 훈련: 'k-train' };
  const wSched = schedAll.filter((x) => x.date <= weekDays[6]);
  const weekCard = `<section class="card week-card">
    <div class="card-head"><h3>이번 주 <small class="muted">${weekDays[0].slice(5).replace('-', '.')} ~ ${weekDays[6].slice(5).replace('-', '.')}</small></h3><a href="#/schedule" class="more">스케줄 →</a></div>
    <div class="wk">${weekDays.map((d, i) => {
      const its = [...wSched.filter((x) => x.date === d).map((x) => ({ t: x.time || '', title: x.title, c: KC[x.kind] || 'k-etc' })),
        ...wPlans.filter((x) => x.date === d).map((x) => ({ t: x.time || '', title: x.title || '훈련', c: 'k-plan' }))]
        .sort((a, b) => a.t.localeCompare(b.t));
      return `<a class="wk-day ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}" href="#${d === today ? '/training' : '/schedule'}">
        <div class="wk-h"><b>${DOW_KO[(i + 1) % 7]}</b><span>${+d.slice(8)}</span></div>
        ${its.length ? its.map((x) => `<div class="wk-it ${x.c}"><small>${esc(x.t)}</small><span>${esc(x.title)}</span></div>`).join('') : '<div class="wk-none">-</div>'}
      </a>`;
    }).join('')}</div>
    <div class="wk-legend"><span class="k-match">경기</span><span class="k-train">훈련 일정</span><span class="k-plan">훈련장 안내</span><span class="k-etc">그 외</span></div>
  </section>`;

  // 공지 (작게)
  const noticeCard = `<section class="card hcard">
    <div class="card-head"><h3>공지사항</h3><a href="#/notice" class="more">전체 →</a></div>
    ${n.empty ? '<p class="muted small">공지가 없어요.</p>' : `<ul class="list">${n.docs.map((d) => { const x = d.data(); return `
      <li><div><strong>${x.pinned ? '<span class="tag">고정</span> ' : ''}${esc(x.title)}</strong><small>${fmtDate(x.createdAt)}</small></div></li>`; }).join('')}</ul>`}
  </section>`;

  // 선수: 내 오늘 기록 + 오늘 일정 · 훈련
  const l = myLog?.exists?.() ? myLog.data() : null;
  const todayCard = `<section class="card hcard">
    <div class="card-head"><h3>오늘</h3><a href="#/training" class="more">훈련장 →</a></div>
    ${todays.length || plans.length ? `<ul class="list">
      ${todays.map((x) => `<li><span class="date-badge">${esc(x.time || '종일')}</span><div><strong>${esc(x.title)}</strong><small>${esc([x.kind, x.place].filter(Boolean).join(' · '))}</small></div>${x.kind === '경기' ? '<span class="tag solid">경기</span>' : ''}</li>`).join('')}
      ${plans.map((p) => `<li><span class="date-badge">${esc(p.time || '훈련')}</span><div><strong>${esc(p.title || '훈련')}</strong><small>${esc(p.goal ? `목표 · ${p.goal}` : `${(p.blocks || []).length}개 훈련`)}</small></div></li>`).join('')}
    </ul>` : '<p class="muted small">오늘은 일정이 없어요.</p>'}
  </section>`;
  const myCard = `<section class="card hcard">
    <div class="card-head"><h3>내 오늘 기록</h3></div>
    ${l ? `<div class="hbig"><strong>${l.checked ? '검사 완료' : l.submitted ? '제출함' : '작성 중'}</strong><small>컨디션 ${'●'.repeat(l.condition || 0)}${'○'.repeat(5 - (l.condition || 0))} · 수면 ${sleepOf(l) ?? '-'}분</small></div>
      ${l.coachComment ? `<div class="coach-note"><span class="tag solid">코치 한마디</span><p>${esc(l.coachComment)}</p></div>` : ''}`
      : '<p class="muted">아직 오늘 기록을 쓰지 않았어요.</p>'}
    <a href="#/daily" class="btn full">${l ? '오늘 기록 열기' : '오늘 기록 쓰기'}</a>
  </section>`;

  const head = `${morningHead(stats)}
  ${!teamActive() ? `<div class="banner">팀 이용기간이 만료되었습니다. ${isOwner() ? '<a href="#/pay">연장 결제 →</a>' : '팀 관리자에게 문의하세요.'}</div>` : ''}
  ${waitingN ? `<a class="banner wait-banner" href="#/locker">입장 승인 대기 <b>${waitingN}명</b> — 락커룸에서 승인해 주세요 →</a>` : ''}`;

  if (coach) {
    // 코치: 빠른 실행 → 오늘 할 것 4칸 (오늘 훈련 · 준비물 / 선수 상태 · 일지 / 답 안 한 질문 / 다음 경기) → 이번 주 → 할 일 · 공지
    el.innerHTML = `${head}
    ${quickBar()}
    <div class="home-grid cd-grid" data-desk>${deskSkeleton()}</div>
    ${weekCard}
    <div class="home-grid two"><div data-todo></div>${noticeCard}</div>`;
    startClock(el);
    todoPad(el.querySelector('[data-todo]'));
    await coachDesk(el.querySelector('[data-desk]'), { sched: schedAll, matches: allMatches, plans, players, logs: logs7 || [], todaySubmitted: submitted.length });
    return;
  }
  // 선수: 오늘 · 내 오늘 기록 · 코치님 답변 → 이번 주 → 할 일 · 공지
  el.innerHTML = `${head}
  <div class="home-grid two">${todayCard}${myCard}</div>
  <div data-answers></div>
  ${weekCard}
  <div class="home-grid two"><div data-todo></div>${noticeCard}</div>`;
  startClock(el);
  todoPad(el.querySelector('[data-todo]'));
  if (isSquad()) await answersCard(el.querySelector('[data-answers]'));
}
