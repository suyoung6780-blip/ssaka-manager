// MY > 코치 노트 — 지도자 혼자 보는 축구 노트 (주기화 · 논문 · 전술 · 훈련 · 경기 리뷰 · 축구 생각)
// 저장: users/{uid}/notes (본인만 읽고 씀 — 팀 코치 · 선수 누구도 못 봄)
import {
  db, collection, doc, query, orderBy, limit, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp,
} from '../fb.js';
import { esc, text, toast, fail, modal, confirmBox, fmtDate, todayStr, pageHead } from '../ui.js';
import { state } from '../store.js';
import { createPad, blank } from '../tactic.js';

// 분류 — 짧은 영문 코드는 카드 왼쪽 표시 (이모지 대신)
const CATS = [
  { k: 'period', l: '주기화', en: 'PERIODIZATION', c: '#39e75f', hint: '주간 · 시즌 계획, 부하 관리' },
  { k: 'paper', l: '논문 · 자료', en: 'RESEARCH', c: '#4ea1ff', hint: '읽은 논문 · 책 · 강의 정리' },
  { k: 'tactic', l: '전술 아이디어', en: 'TACTICS', c: '#ffb020', hint: '게임모델 · 원칙 · 패턴' },
  { k: 'drill', l: '훈련 아이디어', en: 'SESSION', c: '#ff6b5a', hint: '해 보고 싶은 훈련 · 변형' },
  { k: 'review', l: '경기 리뷰', en: 'MATCH REVIEW', c: '#b48cff', hint: '경기 뒤 돌아보기' },
  { k: 'think', l: '축구 생각', en: 'THOUGHTS', c: '#cfd6d2', hint: '나의 축구 철학 · 고민' },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.k, c]));

// 주기화 — 한 주(마이크로 사이클) 기본 칸: 경기일(MD) 기준
const MD_ROWS = [
  ['MD+1', '회복'], ['MD+2', '휴식'], ['MD-4', '근력 · 소공간 (강도 높음)'], ['MD-3', '지구력 · 대공간'],
  ['MD-2', '스피드 · 전술'], ['MD-1', '활성화 · 세트피스'], ['MD', '경기'],
];
const LOADS = [[0, '휴식'], [1, '매우 낮음'], [2, '낮음'], [3, '보통'], [4, '높음'], [5, '매우 높음']];

// 혼자 생각해 볼 질문 — 날마다 하나씩
const PROMPTS = [
  '우리 팀은 공을 잃은 뒤 5초 동안 무엇을 하나요? 그게 정말 우리가 원하는 모습인가요?',
  '이번 주 훈련에서 선수들이 가장 많이 한 "결정"은 무엇이었나요?',
  '상대가 우리 빌드업을 막는 가장 쉬운 방법은 무엇일까요?',
  '내가 가장 자주 하는 코칭 말 세 가지는? 선수들은 그걸 어떻게 이해하고 있을까요?',
  '좋은 훈련과 재미있는 훈련은 같은가요, 다른가요?',
  '우리 팀 게임모델을 한 문장으로 말한다면?',
  '지난 경기에서 실점 장면의 첫 원인은 공이 없는 곳에서 시작되지 않았나요?',
  '이 연령대 선수에게 지금 꼭 필요한 것 한 가지만 고른다면?',
  '경기 중 내가 벤치에서 해 줄 수 있는 가장 가치 있는 말은?',
  '우리 팀의 공격 전환은 몇 초 안에 끝나야 하나요?',
  '선수 한 명을 떠올려 보세요. 그 선수는 지금 무엇 때문에 성장이 멈춰 있나요?',
  '훈련의 강도는 거리 · 시간 · 공간 · 인원 중 무엇으로 조절하고 있나요?',
  '세트피스에서 우리가 가장 약한 순간은 언제인가요?',
  '내가 존경하는 지도자는 이 상황에서 어떻게 했을까요?',
  '우리 팀 센터백이 공을 잡았을 때 가장 먼저 봐야 할 것은 무엇인가요?',
  '상대가 롱볼만 찬다면 우리는 무엇을 바꿔야 할까요?',
  '이번 주 훈련 중 경기와 가장 닮은 훈련은 무엇이었나요?',
  '선수들이 내 말 없이도 스스로 해결한 장면이 있었나요?',
  '우리 팀 압박의 시작 신호는 무엇인가요? 선수들 모두 알고 있나요?',
  '풀백이 높이 올라갔을 때 뒷공간은 누가 책임지나요?',
  '경기에서 진 뒤 선수들에게 가장 먼저 할 말은?',
  '한 시즌 동안 꼭 남기고 싶은 우리 팀의 습관 하나는?',
  '공을 가진 선수 주변에 몇 명이 도와주고 있어야 할까요?',
  '세트피스 수비: 지역 · 대인 · 혼합 중 우리 팀에 맞는 것은? 왜?',
  '훈련에서 실수한 선수에게 나는 어떤 표정을 짓고 있나요?',
  '다음 경기 상대의 약점 한 가지를 고른다면?',
  '우리 팀 공격수는 언제 깊이 뛰고, 언제 내려와 받아야 하나요?',
  '부상에서 돌아온 선수의 첫 주 훈련은 어떻게 짤까요?',
  '소공간 게임에서 공간을 1m 줄이면 무엇이 달라질까요?',
  '선수들이 가장 즐거워하는 훈련은? 그 안에 배울 것도 있나요?',
  '우리 골키퍼는 빌드업에서 몇 번째 선수인가요?',
  '전반이 끝났을 때 하프타임 5분 동안 무엇을 말할까요?',
  '경기 중 상대가 포메이션을 바꾸면 우리는 몇 분 안에 알아차리나요?',
  '측면에서 2대1을 만드는 우리 팀만의 방법은?',
  '이 연령대에서 승리보다 더 중요한 것은 무엇이라고 생각하나요?',
  '내가 하루 훈련에서 가장 많이 쓰는 시간은 설명 · 연습 · 경기 중 어디인가요?',
  '출전 시간이 적은 선수에게 이번 주에 해 준 것은?',
  '우리 팀 미드필더는 공을 받기 전에 몇 번 고개를 드나요?',
  '수비 라인을 올리는 신호와 내리는 신호는 무엇인가요?',
  '상대 압박을 풀 때 가장 자주 쓰는 패턴은? 막히면 다음은?',
  '좋은 코칭 포인트는 몇 개까지가 적당할까요?',
  '경기 영상을 볼 때 나는 공을 보나요, 공 없는 선수를 보나요?',
  '이번 달 우리 팀이 가장 성장한 부분은?',
  '선수가 "왜요?"라고 물을 때 나는 어떻게 대답하나요?',
  '우리 팀에서 리더 역할을 하는 선수는 누구이고, 어떻게 키울까요?',
  '역습을 막는 첫 번째 방법은 공을 잃기 전에 있지 않나요?',
  '크로스 수비에서 니어 · 파 · 컷백 공간은 누가 맡나요?',
  '날씨 · 운동장 상태가 나쁠 때 훈련 계획은 어떻게 바꾸나요?',
  '선수들에게 "잘했어" 대신 쓸 수 있는 구체적인 칭찬은?',
  '우리 팀 경기 템포를 올리고 싶을 때 무엇부터 바꿀까요?',
  '1대1 수비에서 선수에게 가장 먼저 가르칠 것은?',
  '내 축구 철학을 세 단어로 말한다면?',
  '최근에 다른 팀 경기에서 훔치고 싶었던 장면은?',
  '선수가 같은 실수를 반복한다면 원인은 기술 · 판단 · 체력 중 무엇일까요?',
  '다음 시즌 우리 팀 게임모델에서 바꾸고 싶은 한 가지는?',
  '훈련 끝나고 선수들이 기억했으면 하는 한 문장은?',
  '점수를 이기고 있을 때 우리는 어떻게 경기해야 하나요?',
  '지고 있을 때 마지막 10분, 우리는 무엇을 바꾸나요?',
  '좋은 패스와 안전한 패스는 어떻게 다른가요?',
  '코치로서 이번 주에 내가 배운 것은?',
  '우리 팀이 가장 위험한 순간은 공을 가졌을 때인가요, 잃었을 때인가요?',
  '훈련 계획을 세울 때 가장 먼저 정하는 것은 무엇인가요?',
  '상대 진영에서 공을 뺏었을 때 첫 패스는 어디로 가야 하나요?',
  '우리 팀 윙어는 안으로 들어올 때와 바깥에 머물 때를 어떻게 구분하나요?',
  '선수들이 "이해했다"와 "할 수 있다"는 어떻게 다를까요?',
  '경기 전날 훈련에서 절대 하지 않는 것은?',
  '최근 읽은 책 · 논문 · 영상 중 현장에 바로 쓸 수 있는 것은?',
  '우리 팀 수비 간격은 몇 미터가 적당할까요? 선수들은 그 거리를 아나요?',
  '코치진끼리 같은 말을 하고 있나요? 서로 다른 신호를 주고 있지 않나요?',
  '경기 중 선수 교체의 기준은 무엇인가요?',
  '선수 한 명의 장점을 팀 전술로 키운다면 어떻게 할까요?',
  '공을 오래 소유하는 것과 빠르게 전진하는 것, 우리 팀은 어느 쪽인가요?',
  '훈련 강도를 숫자로 확인하고 있나요? 자각도 기록은 무엇을 말해 주나요?',
  '우리 팀 하프스페이스는 누가 쓰나요?',
  '골킥 때 상대가 강하게 압박하면 우리 약속은?',
  '지난주에 했던 코칭 중 다시 한다면 바꾸고 싶은 것은?',
  '선수가 경기장에서 스스로 판단하게 하려면 훈련에 무엇을 넣어야 할까요?',
  '우리 팀이 실점하는 패턴 세 가지를 적어 본다면?',
  '상대 에이스를 막는 방법: 한 명이 막나요, 팀이 막나요?',
  '이번 시즌 가장 기억에 남는 우리 팀의 골은? 왜 좋았나요?',
  '부모님 · 학교와 소통할 때 꼭 전하고 싶은 것은?',
  '선수가 슬럼프일 때 나는 무엇부터 확인하나요?',
  '우리 팀 훈련에서 경쟁과 협동의 비율은 어느 정도인가요?',
  '워밍업 시간에 전술 주제를 미리 넣을 수 있을까요?',
  '좋은 코치진 회의는 어떤 모습일까요?',
  '선수들에게 보여 줄 영상 클립 하나를 고른다면?',
  '경기에서 이기고도 마음에 들지 않았던 이유는?',
  '다음 달 훈련 주제를 한 단어로 정한다면?',
  '우리 팀이 5년 뒤 어떤 축구를 하고 있으면 좋을까요?',
  '오늘 하루, 나는 선수에게 어떤 코치였나요?',
];
const promptOfDay = () => { const d = new Date(); const n = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5); return PROMPTS[n % PROMPTS.length]; };

const col = () => collection(db, 'users', state.user.uid, 'notes');
const toMs = (v) => (v?.toMillis ? v.toMillis() : v ? +new Date(v) : 0);
const plain = (n) => {
  const d = n.data || {};
  const bits = [n.body, d.goal, d.summary, d.apply, d.good, d.bad, ...(d.rows || []).map((r) => r.what)];
  return bits.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
};

let view = { cat: '', q: '', tag: '' };

export async function page(el) {
  const snap = await getDocs(query(col(), orderBy('updatedAt', 'desc'), limit(300)));
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const refresh = () => page(el);
  const prompt = promptOfDay();

  el.innerHTML = `${pageHead('COACH NOTEBOOK', '코치 노트', '<button class="btn" data-new>+ 새 노트</button>')}
    <section class="cn-hero">
      <div class="cn-hero-main">
        <span class="cn-lock">나만 보는 노트 · 팀 코치도 선수도 볼 수 없어요</span>
        <p class="cn-q-lab">오늘의 질문</p>
        <blockquote class="cn-q">${esc(prompt)}</blockquote>
        <button class="btn ghost sm" data-answer>이 질문으로 생각 적기</button>
      </div>
      <div class="cn-stats">
        <div><b>${all.length}</b><small>노트</small></div>
        <div><b>${all.filter((n) => toMs(n.updatedAt) > Date.now() - 7 * 864e5).length}</b><small>이번 주에 쓴 노트</small></div>
        <div><b>${new Set(all.flatMap((n) => n.tags || [])).size}</b><small>태그</small></div>
      </div>
    </section>
    <div class="cn-starts">${CATS.map((c) => `<button class="cn-start" data-start="${c.k}" style="--cc:${c.c}"><span>${c.en}</span><b>${c.l}</b><small>${c.hint}</small></button>`).join('')}</div>
    <div class="cn-bar">
      <nav class="cn-cats">${[['', '전체'], ...CATS.map((c) => [c.k, c.l])].map(([k, l]) => `<button class="chip ${view.cat === k ? 'on' : ''}" data-cat="${k}">${l} <small>${k ? all.filter((n) => n.cat === k).length : all.length}</small></button>`).join('')}</nav>
      <input type="search" placeholder="제목 · 내용 · 태그 검색" value="${esc(view.q)}" data-q>
    </div>
    <div class="cn-tags" data-tags></div>
    <div data-list></div>`;

  const draw = () => {
    const q = view.q.toLowerCase();
    const rows = all.filter((n) => (!view.cat || n.cat === view.cat) && (!view.tag || (n.tags || []).includes(view.tag))
      && (!q || [n.title, plain(n), (n.tags || []).join(' '), n.data?.authors, n.data?.source].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || toMs(b.updatedAt) - toMs(a.updatedAt));
    const tags = [...new Set(all.filter((n) => !view.cat || n.cat === view.cat).flatMap((n) => n.tags || []))].slice(0, 30);
    el.querySelector('[data-tags]').innerHTML = tags.length ? tags.map((t) => `<button class="cn-tag ${view.tag === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('') : '';
    el.querySelectorAll('[data-tag]').forEach((b) => (b.onclick = () => { view.tag = view.tag === b.dataset.tag ? '' : b.dataset.tag; draw(); }));
    const box = el.querySelector('[data-list]');
    if (!rows.length) {
      box.innerHTML = `<div class="cn-empty"><b>${all.length ? '찾는 노트가 없어요' : '첫 노트를 써 보세요'}</b><p class="muted">${all.length ? '검색어나 분류를 바꿔 보세요.' : '위에서 분류를 고르면 그에 맞는 틀이 나와요. 이번 주 계획, 읽은 논문, 떠오른 전술 아이디어부터 시작해 보세요.'}</p></div>`;
      return;
    }
    box.innerHTML = `<div class="cn-grid">${rows.map((n) => {
      const c = CAT[n.cat] || CAT.think;
      const ex = plain(n).slice(0, 150);
      return `<article class="cn-card" data-id="${n.id}" style="--cc:${c.c}">
        <header><span class="cn-cat">${c.en}</span>${n.pinned ? '<span class="cn-pin">고정</span>' : ''}${n.pad ? '<span class="cn-has">작전판</span>' : ''}</header>
        <h3>${esc(n.title || '제목 없음')}</h3>
        ${n.cat === 'paper' && (n.data?.authors || n.data?.year) ? `<p class="cn-cite">${esc([n.data.authors, n.data.year && `(${n.data.year})`, n.data.source].filter(Boolean).join(' '))}</p>` : ''}
        ${n.cat === 'period' && n.data?.rows?.length ? miniLoad(n.data.rows) : ''}
        ${ex ? `<p class="cn-ex">${esc(ex)}${plain(n).length > 150 ? '…' : ''}</p>` : ''}
        <footer><span>${(n.tags || []).slice(0, 3).map((t) => `#${esc(t)}`).join(' ')}</span><time>${esc(fmtDate(n.updatedAt || n.createdAt))}</time></footer>
      </article>`;
    }).join('')}</div>`;
    box.querySelectorAll('[data-id]').forEach((c) => (c.onclick = () => reader(all.find((x) => x.id === c.dataset.id), refresh)));
  };

  el.querySelector('[data-new]').onclick = () => editor({ cat: view.cat || 'think' }, refresh);
  el.querySelectorAll('[data-start]').forEach((b) => (b.onclick = () => editor({ cat: b.dataset.start }, refresh)));
  el.querySelector('[data-answer]').onclick = () => editor({ cat: 'think', title: prompt }, refresh);
  el.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => { view.cat = b.dataset.cat; view.tag = ''; el.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  el.querySelector('[data-q]').oninput = (e) => { view.q = e.target.value.trim(); draw(); };
  draw();
}

// 카드 안 작은 부하 막대 (주기화)
const miniLoad = (rows) => `<div class="cn-mini">${rows.map((r) => `<i style="--h:${(+r.load || 0) * 20}%" title="${esc(r.md)} · ${esc(LOADS[+r.load || 0][1])}"><b>${esc(r.md)}</b></i>`).join('')}</div>`;

// ───────── 읽기 ─────────
function reader(n, refresh) {
  const c = CAT[n.cat] || CAT.think;
  const d = n.data || {};
  const sec = (h, v) => (v ? `<section class="cn-sec"><h4>${h}</h4><div class="prose">${text(v)}</div></section>` : '');
  const body = {
    period: () => `${d.from || d.to ? `<p class="cn-range">${esc([d.from, d.to].filter(Boolean).join(' ~ '))}${d.phase ? ` · ${esc(d.phase)}` : ''}</p>` : d.phase ? `<p class="cn-range">${esc(d.phase)}</p>` : ''}
      ${sec('이번 사이클 목표', d.goal)}
      ${d.rows?.length ? `<section class="cn-sec"><h4>마이크로 사이클</h4><div class="cn-cycle">${d.rows.map((r) => `
        <div class="cn-day"><span class="cn-md">${esc(r.md)}</span>${r.day ? `<small>${esc(r.day)}</small>` : ''}
          <div class="cn-load"><i style="--h:${(+r.load || 0) * 20}%"></i></div><em>${esc(LOADS[+r.load || 0][1])}</em>
          <b>${esc(r.focus || '')}</b><p>${text(r.what || '')}</p></div>`).join('')}</div></section>` : ''}`,
    paper: () => `<div class="cn-ref">
        ${d.authors || d.year ? `<p><small>저자</small>${esc(d.authors || '')}${d.year ? ` (${esc(d.year)})` : ''}</p>` : ''}
        ${d.source ? `<p><small>출처</small>${esc(d.source)}</p>` : ''}
        ${d.link ? `<p><small>링크</small><a href="${esc(/^https?:\/\//.test(d.link) ? d.link : `https://${d.link}`)}" target="_blank" rel="noopener">${esc(d.link)}</a></p>` : ''}
      </div>${sec('핵심 요약', d.summary)}${sec('현장에 어떻게 쓸까', d.apply)}`,
    review: () => `${d.opp || d.score ? `<p class="cn-range">${esc([d.date, d.opp && `vs ${d.opp}`, d.score].filter(Boolean).join(' · '))}</p>` : ''}${sec('잘된 점', d.good)}${sec('보완할 점', d.bad)}${sec('다음 훈련으로', d.next)}`,
  }[n.cat]?.() || '';
  const m = modal(`<article class="cn-read" style="--cc:${c.c}">
      <span class="cn-cat">${c.en} · ${c.l}</span>
      <h2>${esc(n.title || '제목 없음')}</h2>
      <p class="cn-meta">${esc(fmtDate(n.updatedAt || n.createdAt, true))}${(n.tags || []).length ? ` · ${(n.tags || []).map((t) => `#${esc(t)}`).join(' ')}` : ''}</p>
      ${body}
      ${n.body ? `<section class="cn-sec"><h4>${n.cat === 'think' || n.cat === 'tactic' || n.cat === 'drill' ? '노트' : '메모'}</h4><div class="prose cn-prose">${text(n.body)}</div></section>` : ''}
      ${n.pad ? '<section class="cn-sec"><h4>작전판</h4><div data-pad></div></section>' : ''}
      <div class="row end"><button class="btn ghost" data-pin>${n.pinned ? '고정 풀기' : '맨 위 고정'}</button><button class="btn ghost" data-del>삭제</button><button class="btn" data-edit>수정</button></div>
    </article>`, { wide: true });
  if (n.pad) createPad(m.el.querySelector('[data-pad]'), n.pad, { editable: false });
  m.el.querySelector('[data-edit]').onclick = () => { m.close(); editor(n, refresh); };
  m.el.querySelector('[data-pin]').onclick = async () => {
    try { await updateDoc(doc(col(), n.id), { pinned: !n.pinned }); m.close(); refresh(); } catch (e) { fail(e); }
  };
  m.el.querySelector('[data-del]').onclick = async () => {
    if (!(await confirmBox('이 노트를 삭제할까요? 되돌릴 수 없어요.'))) return;
    try { await deleteDoc(doc(col(), n.id)); m.close(); toast('삭제했어요.'); refresh(); } catch (e) { fail(e); }
  };
}

// ───────── 쓰기 ─────────
function fieldsOf(cat, d) {
  const ta = (k, label, ph, rows = 4) => `<label>${label}<textarea data-f="${k}" rows="${rows}" placeholder="${esc(ph)}">${esc(d[k] || '')}</textarea></label>`;
  const inp = (k, label, ph, type = 'text') => `<label>${label}<input type="${type}" data-f="${k}" value="${esc(d[k] || '')}" placeholder="${esc(ph)}" maxlength="200"></label>`;
  if (cat === 'period') {
    const rows = d.rows?.length ? d.rows : MD_ROWS.map(([md, focus]) => ({ md, focus: '', ph: focus, load: '', what: '', day: '' }));
    return `<div class="grid3">${inp('phase', '시기', '예) 시즌 중 · 3주차 / 프리시즌')}${inp('from', '시작', '', 'date')}${inp('to', '끝', '', 'date')}</div>
      ${ta('goal', '이번 사이클 목표', '예) 수비 전환 속도 올리기 · 주말 경기 전 부하 낮추기', 2)}
      <div class="cn-rows-h"><b>마이크로 사이클</b><small class="muted">경기일(MD) 기준 · 강도를 누르면 막대로 보여요</small></div>
      <div class="cn-rows" data-rows>${rows.map((r, i) => rowHtml(r, i)).join('')}</div>
      <div class="row"><button type="button" class="btn ghost sm" data-addrow>+ 칸 추가</button></div>`;
  }
  if (cat === 'paper') {
    return `<div class="grid3">${inp('authors', '저자', '예) Martín-García 외')}${inp('year', '연도', '2018')}${inp('source', '출처 (학술지 · 책 · 강의)', '예) J Strength Cond Res')}</div>
      ${inp('link', '링크', 'https:// (DOI · PDF · 영상)')}
      ${ta('summary', '핵심 요약', '연구 대상 · 방법 · 결과 — 세 줄로', 5)}
      ${ta('apply', '현장에 어떻게 쓸까', '우리 팀 훈련 · 경기에 가져올 것', 3)}`;
  }
  if (cat === 'review') {
    return `<div class="grid3">${inp('date', '경기일', '', 'date')}${inp('opp', '상대', '예) 화이트 유나이티드')}${inp('score', '결과', '예) 2 : 1 승')}</div>
      ${ta('good', '잘된 점', '게임모델대로 된 장면 · 선수', 3)}${ta('bad', '보완할 점', '실점 · 놓친 장면의 원인', 3)}${ta('next', '다음 훈련으로', '이번 주 훈련에 넣을 것', 2)}`;
  }
  return '';
}
const rowHtml = (r, i) => `<div class="cn-row" data-row="${i}">
  <input class="cn-row-md" data-r="md" value="${esc(r.md || '')}" maxlength="8" placeholder="MD">
  <input data-r="day" value="${esc(r.day || '')}" maxlength="6" placeholder="요일">
  <input data-r="focus" value="${esc(r.focus || '')}" maxlength="40" placeholder="${esc(r.ph || '초점')}">
  <div class="cn-lv" data-r="load">${LOADS.map(([v, l]) => `<button type="button" class="${String(r.load) === String(v) ? 'on' : ''}" data-lv="${v}" title="${l}" style="--lv:${v}"></button>`).join('')}</div>
  <textarea data-r="what" rows="1" maxlength="400" placeholder="훈련 내용 · 시간 · 공간">${esc(r.what || '')}</textarea>
  <button type="button" class="icon-btn cn-row-x" data-rmrow aria-label="이 칸 지우기">✕</button>
</div>`;

const BODY_PH = {
  period: '부하 · 선수 상태 · 바꿀 점 등 자유롭게',
  paper: '읽으며 떠오른 생각 · 의문 · 인용',
  tactic: '원칙 · 상황 · 선수 역할 · 신호 (예: 상대 6번이 내려오면 우리 10번은…)',
  drill: '조직 · 규칙 · 변형 · 코칭 포인트 · 강도를 올리는 법',
  review: '그 밖의 메모',
  think: '생각나는 대로 — 아무도 보지 않아요',
};

export function editor(n, refresh) {
  n = { ...n };
  const d0 = { ...(n.data || {}) };
  if (n.cat === 'review' && !d0.date) d0.date = todayStr();
  const m = modal(`<form class="cn-edit" style="--cc:${(CAT[n.cat] || CAT.think).c}">
      <div class="cn-edit-top">
        <span class="eyebrow">COACH NOTEBOOK</span>
        <button type="button" class="btn ghost sm" data-focus title="다른 것은 가리고 쓰기에만">집중 모드</button>
      </div>
      <div class="cn-pick">${CATS.map((c) => `<button type="button" class="${c.k === n.cat ? 'on' : ''}" data-pcat="${c.k}" style="--cc:${c.c}">${c.l}</button>`).join('')}</div>
      <input class="cn-title" data-title value="${esc(n.title || '')}" maxlength="120" placeholder="제목" required>
      <div data-fields>${fieldsOf(n.cat, d0)}</div>
      <label>${n.cat === 'think' ? '노트' : '메모'}<textarea class="cn-body" data-body rows="${n.cat === 'think' || n.cat === 'tactic' || n.cat === 'drill' ? 12 : 4}" placeholder="${esc(BODY_PH[n.cat] || '')}">${esc(n.body || '')}</textarea></label>
      <label>태그 <small class="muted">쉼표(,)로 — 예) 전환, U15, 압박</small><input data-tagsin value="${esc((n.tags || []).join(', '))}" maxlength="120"></label>
      <label class="switch"><input type="checkbox" data-use-pad ${n.pad ? 'checked' : ''}><span>작전판 그림 넣기</span></label>
      <div data-pad ${n.pad ? '' : 'hidden'}></div>
      <div class="row end"><label class="mini-switch"><input type="checkbox" data-pinin ${n.pinned ? 'checked' : ''}> 맨 위 고정</label><button class="btn">${n.id ? '저장' : '노트 저장'}</button></div>
    </form>`, { wide: true });
  const form = m.el.querySelector('form');
  let pad = null;
  const padBox = form.querySelector('[data-pad]');
  const usePad = form.querySelector('[data-use-pad]');
  const syncPad = () => {
    if (usePad.checked && !pad) pad = createPad(padBox, n.pad || { ...blank('custom'), grid: { preset: 'none', cols: 0, rows: 0 } }, { motion: true });
    padBox.hidden = !usePad.checked;
  };
  usePad.onchange = syncPad;
  syncPad();

  // 분류 바꾸면 그 틀로 (이미 적은 공통 칸은 그대로)
  const collect = () => {
    const d = {};
    form.querySelectorAll('[data-fields] [data-f]').forEach((x) => { if (x.value.trim()) d[x.dataset.f] = x.value.trim(); });
    const rows = [...form.querySelectorAll('[data-row]')].map((r) => ({
      md: r.querySelector('[data-r=md]').value.trim(), day: r.querySelector('[data-r=day]').value.trim(), focus: r.querySelector('[data-r=focus]').value.trim(),
      load: r.querySelector('[data-lv].on')?.dataset.lv ?? '', what: r.querySelector('[data-r=what]').value.trim(),
    })).filter((r) => r.md || r.focus || r.what || r.load !== '');
    if (rows.length) d.rows = rows;
    return d;
  };
  const bindRows = () => {
    form.querySelectorAll('[data-lv]').forEach((b) => (b.onclick = () => { const on = b.classList.contains('on'); b.parentElement.querySelectorAll('[data-lv]').forEach((x) => x.classList.remove('on')); if (!on) b.classList.add('on'); }));
    form.querySelectorAll('[data-rmrow]').forEach((b) => (b.onclick = () => b.closest('[data-row]').remove()));
    form.querySelectorAll('.cn-row textarea').forEach((t) => { const fit = () => { t.style.height = 'auto'; t.style.height = `${Math.min(160, t.scrollHeight)}px`; }; t.oninput = fit; fit(); });
    form.querySelector('[data-addrow]')?.addEventListener('click', () => {
      const box = form.querySelector('[data-rows]');
      box.insertAdjacentHTML('beforeend', rowHtml({ md: '' }, box.children.length));
      bindRows();
    });
  };
  bindRows();
  form.querySelectorAll('[data-pcat]').forEach((b) => (b.onclick = () => {
    const keep = { ...d0, ...collect() };
    n.cat = b.dataset.pcat;
    form.style.setProperty('--cc', CAT[n.cat].c);
    form.querySelectorAll('[data-pcat]').forEach((x) => x.classList.toggle('on', x === b));
    form.querySelector('[data-fields]').innerHTML = fieldsOf(n.cat, keep);
    form.querySelector('[data-body]').placeholder = BODY_PH[n.cat];
    bindRows();
  }));
  form.querySelector('[data-focus]').onclick = (e) => {
    const on = m.el.classList.toggle('cn-focus');
    m.el.closest('.modal-wrap').classList.toggle('cn-focus-wrap', on);
    e.currentTarget.textContent = on ? '집중 모드 끄기' : '집중 모드';
    form.querySelector('[data-body]').focus();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button.btn:not([type])');
    const title = form.querySelector('[data-title]').value.trim();
    if (!title) { toast('제목을 적어 주세요.'); form.querySelector('[data-title]').focus(); return; }
    btn.disabled = true;
    const data = {
      cat: n.cat, title, body: form.querySelector('[data-body]').value,
      data: collect(),
      tags: [...new Set(form.querySelector('[data-tagsin]').value.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean))].slice(0, 10),
      pinned: form.querySelector('[data-pinin]').checked,
      pad: usePad.checked && pad ? pad.getData() : null,
      updatedAt: serverTimestamp(),
    };
    try {
      if (n.id) await updateDoc(doc(col(), n.id), data);
      else await addDoc(col(), { ...data, createdAt: serverTimestamp() });
      m.close();
      toast('노트를 저장했어요.');
      refresh();
    } catch (err) { fail(err); btn.disabled = false; }
  };
}
