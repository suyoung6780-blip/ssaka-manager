// 사용 설명서 (고객지원) — 화면마다 '사용법'을 챕터로 모아 코치용 · 선수용으로 (찾기 · 이 화면으로 가기)
// 내용은 help.js 의 HELP 그대로 씀 (한 곳만 고치면 '사용법' 창과 설명서가 같이 바뀜)
import { esc, pageHead } from '../ui.js';
import { isCoach, isPersonal } from '../store.js';
import { HELP } from '../help.js';

// 처음 쓰는 사람용 순서
const START = {
  coach: ['회원가입 → 계정 유형 <b>지도자</b> → 이메일 인증',
    '<b>팀 만들기</b>: 팀 이름 · 구분(U12 · U15 …)을 적으면 팀 대표가 돼요',
    '<b>락커룸 › 초대 메시지 보내기</b>로 카톡방에 초대 글(가입 순서 + 팀 코드)을 보내요 → 들어오면 <b>락커룸 › 입장 승인 대기</b>에서 승인 · 홈 맨 위 <b>시작하기 3단계</b>를 따라가도 돼요',
    '<b>스케줄</b>에 훈련 · 경기 일정 → <b>훈련장</b>에 그날 훈련(전술보드 그림 넣기) → 선수들이 <b>오늘 기록</b>을 써요',
    '다음 날 <b>일지검사</b>에서 일지를 읽고 코치 한마디 → 선수 홈 <b>코치님 피드백</b>에 바로 보여요',
    '경기가 끝나면 <b>기록실</b>에 점수 · 득점 · 도움 → 선수 <b>시즌 기록</b>에 쌓여요 · 득점 · 실점 장면은 <b>분석실</b> · 영상은 <b>영상룸</b>에서',
    '한 달에 한 번 <b>성장 평가</b>: 선수 자기평가 → 코치 확정 → OVR · 능력치',
    '선수 한 명을 자세히 보려면 <b>성장 평가 › 성장 카드</b>: 몸 상태 · 능력치 비교 · 목표 · 경기 · 일지가 한 화면에'],
  player: ['회원가입 → 계정 유형 <b>선수</b> → 이메일 인증 (만 14세 미만은 보호자 동의)',
    '코치님께 받은 <b>팀 코드 10자리</b>로 팀 입장 → 코치님이 승인하면 시작',
    '매일 <b>오늘 기록</b>: <b>1 몸 상태 → 2 훈련 · 경기 일지 → 3 제출</b> (경기 날엔 골 · 도움 · 실점도)',
    '다음 날 <b>홈 › 코치님 피드백</b>에서 코치님 코멘트 · 질문 답변을 확인해요',
    '<b>목표</b>에 내 목표를 적고 진행률을 올려요 · 한 달에 한 번 <b>성장 평가</b> 자기평가',
    '<b>시즌 기록</b>(홈 › 시즌 기록 보기)에서 내 출전 · 득점 · 도움 · 평점 · OVR을 시즌 · 대회 · 월별로 봐요',
    '<b>내 일지</b>(오늘 기록 맨 위 · 메뉴)에서 지난 일지를 책처럼 넘겨 봐요',
    '보호자님이 <b>개인 계정</b>을 만들었다면 <b>프로필 › 개인 계정 연결하기</b>에 보호자 코드를 넣어요 — 팀은 그대로, 컨디션 · 수면 · 경기 숫자만 같이 올라가요'],
  guardian: ['회원가입 → 계정 유형 <b>보호자</b> → 이메일 인증',
    '<b>개인 계정 만들기</b>: 선수 이름 · 학년을 적으면 <b>보호자 코드</b>가 나와요',
    '선수가 자기 <b>선수 계정</b>으로 보호자 코드를 넣으면 → 홈 · 선수 연결에서 <b>승인</b> (선수가 클럽 팀에 있어도 팀은 그대로)',
    '선수가 쓰는 <b>컨디션 · 수면 · 자각도 · 경기 기록</b>이 데이터실 · 기록실에 쌓여요 · 일지 글은 선수가 <b>보여주기</b>를 켠 것만',
    '<b>영상룸</b>에서 선수 영상을 편집하고, <b>전술보드</b>로 움직임을 그려 설명해요',
    '<b>목표</b>에서 선수와 함께 목표를 정하고 이룬 만큼 올려요'],
};
// 챕터 순서 (메뉴 묶음과 같게)
const CHAPTERS = [
  ['HOME', ['/', '/daily', '/journal']],
  ['TEAM', ['/notice', '/schedule', '/locker']],
  ['TRAINING', ['/gamemodel', '/training', '/training/notes', '/tactics', '/tactics/programs', '/analysis', '/meeting']],
  ['MATCH', ['/records', '/analysis/goals']],
  ['GROWTH', ['/idp', '/goals', '/data', '/journal-check']],
  ['MY', ['/me']],
  ['MANAGE', ['/settings', '/pay']],
  ['SUPPORT', ['/support']],
];
// 선수 메뉴에 없는 화면 (선수용 설명서에서는 뺌)
// 코치 메뉴에 없는 화면 (코치용 설명서에서는 뺌) · 오늘 기록은 선수만 써요
const PLAYER_ONLY = new Set(['/daily', '/journal']);
const COACH_ONLY = new Set(['/training/notes', '/tactics', '/tactics/programs', '/journal-check', '/settings', '/pay']);

let who = null; // 'coach' | 'player'
let q = '';
let cur = 'start'; // 지금 보는 챕터

// 보호자 메뉴에 있는 화면만 (보호자 줄이 없으면 지도자 줄로 — 영상룸 · 전술보드 · 성장 평가처럼 쓰는 법이 같은 곳)
const GUARDIAN_OK = new Set(['/', '/locker', '/analysis', '/tactics', '/records', '/data', '/idp', '/goals', '/settings', '/pay', '/me', '/support']);
const linesFor = (h, w) => (w === 'guardian' ? [...(h.guardian || h.coach || []).map((x) => ['', x]), ...(h.all || []).map((x) => ['', x])] : w === 'coach'
  ? [...(h.coach || []).map((x) => ['', x]), ...(h.owner || []).map((x) => ['팀 대표', x]), ...(h.all || []).map((x) => ['', x])]
  : [...(h.player || []).map((x) => ['', x]), ...(h.all || []).map((x) => ['', x])]);
const plain = (s) => String(s).replace(/<[^>]+>/g, '');

// 한 번에 한 챕터만 — PC: 왼쪽 목록 · 오른쪽 설명 / 휴대폰: 위에서 고르기 · 아래 설명 · 이전 · 다음
export function guide(el) {
  if (!who) who = isPersonal() && isCoach() ? 'guardian' : isCoach() ? 'coach' : 'player';
  const draw = () => {
    const ql = q.trim().toLowerCase();
    const has = (txt) => !ql || plain(txt).toLowerCase().includes(ql);
    const all = [{ k: 'start', sec: 'START', title: '처음 시작하기', intro: who === 'guardian' ? '개인 계정을 만들고 선수와 연결해 쓰는 순서예요.' : who === 'coach' ? '팀을 만들고 하루를 굴리는 순서예요.' : '팀에 들어가서 매일 쓰는 순서예요.', lines: START[who].map((x) => ['', x]) },
      ...CHAPTERS.flatMap(([sec, keys]) => keys.filter((k) => HELP[k] && (who === 'guardian' ? GUARDIAN_OK.has(k) : who === 'player' ? !COACH_ONLY.has(k) : !PLAYER_ONLY.has(k)))
        .map((k) => ({ k, sec, title: (who === 'guardian' && HELP[k].gtitle) || HELP[k].title, intro: HELP[k].intro, lines: linesFor(HELP[k], who) })).filter((c) => c.lines.length))];
    const list = all.filter((c) => has(`${c.title} ${c.intro} ${c.lines.map((x) => x[1]).join(' ')}`));
    if (!list.some((c) => c.k === cur)) cur = list[0]?.k || 'start';
    const secs = [...new Set(list.map((x) => x.sec))];
    el.innerHTML = `${pageHead('SUPPORT', '사용 설명서')}
      <div class="tabs admin-tabs"><a href="#/support/guide" class="active">사용 설명서</a>${isCoach() ? '<a href="#/support">운영자와 대화</a>' : ''}<a href="#/support/qna">Q&A · 개선 제안</a></div>
      <div class="gd">
        <aside class="gd-side">
          <div class="seg gd-who"><button type="button" data-who="coach" class="${who === 'coach' ? 'on' : ''}">코치용</button><button type="button" data-who="player" class="${who === 'player' ? 'on' : ''}">선수용</button><button type="button" data-who="guardian" class="${who === 'guardian' ? 'on' : ''}">보호자용</button></div>
          <input type="search" class="gd-q" placeholder="찾기 (예: 팀 코드)" value="${esc(q)}" data-q>
          <select class="gd-pick" data-pick>${secs.map((sc) => `<optgroup label="${sc}">${list.filter((x) => x.sec === sc).map((x) => `<option value="${esc(x.k)}" ${x.k === cur ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</optgroup>`).join('')}</select>
          <nav class="gd-nav">${secs.map((sc) => `<div class="gd-ns"><span>${sc}</span>${list.filter((x) => x.sec === sc).map((x) => `<a href="javascript:void 0" data-k="${esc(x.k)}" class="${x.k === cur ? 'on' : ''}">${esc(x.title)}</a>`).join('')}</div>`).join('')}</nav>
        </aside>
        <article class="card gd-main" data-main></article>
      </div>
      <p class="muted small center">화면마다 오른쪽 위 <b>사용법</b>을 눌러도 같은 설명이 나와요</p>`;
    el.querySelectorAll('[data-who]').forEach((b) => (b.onclick = () => { who = b.dataset.who; draw(); }));
    // 챕터 바꾸기: 오른쪽 설명만 새로 (왼쪽 목록 · 화면 위치는 그대로)
    const main = el.querySelector('[data-main]');
    const show = (k, fromPager) => {
      cur = k;
      const j = list.findIndex((x) => x.k === k); const c = list[j];
      main.innerHTML = c ? `<span class="eyebrow">${c.sec}</span>
        <div class="gd-ch-h"><h2>${esc(c.title)}</h2>${c.k !== 'start' ? `<a class="btn ghost sm" href="#${c.k}">이 화면으로 가기 →</a>` : ''}</div>
        <p class="muted gd-intro">${c.intro}</p>
        <ol class="guide-steps">${c.lines.map(([tag, x]) => `<li>${tag ? `<span class="tag">${tag}</span> ` : ''}${x}</li>`).join('')}</ol>
        <div class="gd-pager">${j > 0 ? `<button type="button" class="btn ghost sm" data-k="${esc(list[j - 1].k)}">← ${esc(list[j - 1].title)}</button>` : '<span></span>'}${j < list.length - 1 ? `<button type="button" class="btn ghost sm" data-k="${esc(list[j + 1].k)}">${esc(list[j + 1].title)} →</button>` : ''}</div>`
        : '<p class="muted">찾는 내용이 없어요. 다른 말로 찾아보거나 <a href="#/support/qna">Q&A</a>에 물어봐 주세요.</p>';
      el.querySelectorAll('.gd-nav [data-k]').forEach((a) => a.classList.toggle('on', a.dataset.k === k));
      const pick = el.querySelector('[data-pick]'); if (pick && pick.value !== k) pick.value = k;
      main.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => show(b.dataset.k, true)));
      // 이전 · 다음 · 휴대폰: 새 설명의 맨 위가 보이게 (이미 보이면 그대로)
      if (fromPager) { const t = main.getBoundingClientRect().top; if (t < 0 || t > innerHeight * 0.6) main.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      // 왼쪽 목록에서 고른 줄이 목록 밖이면 그 줄만 보이게 (목록 전체가 맨 위로 가지 않게)
      const on = el.querySelector('.gd-nav a.on'); const nav = el.querySelector('.gd-nav');
      if (on && nav) { const r = on.getBoundingClientRect(); const n = nav.getBoundingClientRect(); if (r.top < n.top || r.bottom > n.bottom) nav.scrollTop += r.top - n.top - n.height / 3; }
    };
    el.querySelectorAll('.gd-nav [data-k]').forEach((b) => (b.onclick = () => show(b.dataset.k, innerWidth < 900)));
    el.querySelector('[data-pick]').onchange = (e) => show(e.target.value, true);
    show(cur);
    const qi = el.querySelector('[data-q]');
    qi.oninput = () => { const pos = qi.selectionStart; q = qi.value; draw(); const n = el.querySelector('[data-q]'); n.focus(); n.setSelectionRange(pos, pos); };
  };
  draw();
}
