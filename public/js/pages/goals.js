// 목표 — 팀 목표(코치, 분야 · 기간 · 수치 기준 · 진행률) + 개인 목표(선수가 직접 작성, 코치 한마디)
import {
  db, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp,
} from '../fb.js';
import {
  esc, text, toast, fail, formData, modal, confirmBox, todayStr, pageHead, empty, options, avatar,
} from '../ui.js';
import { state, isCoach } from '../store.js';

const CATS = ['결과 · 성적', '경기력', '기술 · 전술', '체력', '태도 · 팀문화'];
const PERIODS = ['시즌', '분기', '월', '주'];
const MY_CATS = ['기술', '체력', '전술 이해', '마음가짐', '생활 습관', '기타'];
const STATUS = { doing: '진행 중', done: '달성', miss: '미달성' };

const gcol = () => collection(db, 'teams', state.team.id, 'goals');
const gdoc = (id) => doc(db, 'teams', state.team.id, 'goals', id);

// 예전 데이터(text · done) 호환
const norm = (g) => ({
  ...g,
  title: g.title || g.text || '',
  status: g.status || (g.done ? 'done' : 'doing'),
});

// 진행률(%): 수치 목표면 현재/목표, 아니면 직접 올린 progress, 달성이면 100
export function pct(g) {
  if (g.status === 'done') return 100;
  if (g.target > 0 && g.lower) { // 작을수록 좋은 목표 (순위 · 실점 등)
    const c = +g.current || 0;
    return c <= 0 ? 0 : c <= +g.target ? 100 : Math.round((+g.target / c) * 100);
  }
  if (g.target > 0) return Math.max(0, Math.min(100, Math.round(((+g.current || 0) / +g.target) * 100)));
  return Math.max(0, Math.min(100, +g.progress || 0));
}
const avgPct = (arr) => (arr.length ? Math.round(arr.reduce((s, g) => s + pct(g), 0) / arr.length) : 0);
const dday = (due) => {
  if (!due) return '';
  const d = Math.round((new Date(`${due}T00:00`) - new Date(`${todayStr()}T00:00`)) / 86400000);
  return d === 0 ? 'D-DAY' : d > 0 ? `D-${d}` : `D+${-d}`;
};

let tab = null;

export async function page(el) {
  const [gs, ms] = await Promise.all([getDocs(gcol()), getDocs(collection(db, 'teams', state.team.id, 'members'))]);
  const all = gs.docs.map((d) => norm({ id: d.id, ...d.data() }));
  const members = ms.docs.map((d) => ({ id: d.id, ...d.data() }));
  const refresh = () => page(el);
  tab ||= isCoach() ? 'team' : 'mine';

  const tabs = [['team', '팀 목표'], [isCoach() ? 'players' : 'mine', isCoach() ? '선수 개인 목표' : '나의 목표']];
  el.innerHTML = `${pageHead('GOALS', '목표')}
    <nav class="tabs">${tabs.map(([k, l]) => `<a href="javascript:void 0" data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div data-body></div>`;
  el.querySelectorAll('[data-tab]').forEach((a) => (a.onclick = () => { tab = a.dataset.tab; refresh(); }));
  const body = el.querySelector('[data-body]');
  if (tab === 'team') teamView(body, all.filter((g) => g.scope === 'team'), refresh);
  else if (tab === 'mine') mineView(body, all.filter((g) => g.scope === 'personal' && g.ownerUid === state.user.uid), refresh);
  else playersView(body, all.filter((g) => g.scope === 'personal'), members, refresh);
}

// ───────── 팀 목표 ─────────
function teamView(box, goals, refresh) {
  const total = avgPct(goals);
  const done = goals.filter((g) => g.status === 'done').length;
  box.innerHTML = `
    <section class="goal-summary">
      <div class="gs-main"><small>팀 목표 전체 진행률</small><strong>${total}<i>%</i></strong><div class="bar"><i style="width:${total}%"></i></div>
        <small>목표 ${goals.length}개 · 달성 ${done}개 · 진행 중 ${goals.filter((g) => g.status === 'doing').length}개</small></div>
      ${CATS.map((c) => { const arr = goals.filter((g) => g.category === c); return `<div><small>${c}</small><strong>${arr.length ? `${avgPct(arr)}<i>%</i>` : '-'}</strong><small>${arr.length}개</small></div>`; }).join('')}
    </section>
    ${isCoach() ? '<div class="row end"><button class="btn" data-new>+ 팀 목표 추가</button></div>' : ''}
    ${goals.length ? CATS.map((c) => {
      const arr = goals.filter((g) => (g.category || CATS[0]) === c);
      if (!arr.length) return '';
      return `<h2 class="sec-title">${c} <small>${arr.length}</small></h2>
        <div class="goal-grid">${arr.map(teamCard).join('')}</div>`;
    }).join('') : empty(isCoach() ? '팀 목표를 추가해 주세요. 예) 리그 3위 이내 · 경기당 실점 1점 이하 · 빌드업 성공률 70%' : '아직 팀 목표가 없습니다.')}`;

  box.querySelector('[data-new]')?.addEventListener('click', () => teamEditor(null, refresh));
  box.querySelectorAll('[data-gid]').forEach((card) => {
    const g = goals.find((x) => x.id === card.dataset.gid);
    const save = async (patch) => { try { await updateDoc(gdoc(g.id), patch); refresh(); } catch (e) { fail(e); } };
    card.querySelector('[data-inc]')?.addEventListener('click', () => save({ current: (+g.current || 0) + 1 }));
    card.querySelector('[data-dec]')?.addEventListener('click', () => save({ current: Math.max(0, (+g.current || 0) - 1) }));
    card.querySelector('[data-status]')?.addEventListener('change', (e) => save({ status: e.target.value }));
    card.querySelector('[data-edit]')?.addEventListener('click', () => teamEditor(g, refresh));
  });
}

function teamCard(g) {
  const p = pct(g);
  return `<article class="goal-card ${g.status}" data-gid="${g.id}">
    <header><span class="tag">${esc(g.period || '시즌')}</span>${g.due ? `<span class="dday">${dday(g.due)}</span>` : ''}
      <span class="gstatus ${g.status}">${STATUS[g.status]}</span></header>
    <h3>${esc(g.title)}</h3>
    ${g.desc ? `<p>${text(g.desc)}</p>` : ''}
    <div class="gprog">
      <div class="bar"><i style="width:${p}%"></i></div>
      <div class="gnums">${g.target > 0
        ? `<strong>${+g.current || 0}${esc(g.unit || '')}</strong><span>목표 ${+g.target}${esc(g.unit || '')} ${g.lower ? '이하' : '이상'}</span>`
        : `<strong>${p}%</strong>`}
        ${isCoach() && g.target > 0 ? '<span class="gbtns"><button class="chip" data-dec>−</button><button class="chip" data-inc>+</button></span>' : ''}</div>
    </div>
    ${isCoach() ? `<footer><select data-status>${options(Object.entries(STATUS), g.status)}</select><button class="link-btn small" data-edit>수정</button></footer>` : ''}
  </article>`;
}

function teamEditor(g, refresh) {
  g ||= {};
  const m = modal(`
    <span class="eyebrow">TEAM GOAL</span><h2>${g.id ? '팀 목표 수정' : '팀 목표 추가'}</h2>
    <form class="stack">
      <label>목표<input name="title" required maxlength="80" value="${esc(g.title || '')}" placeholder="예) 경기당 실점 1점 이하"></label>
      <div class="grid4">
        <label>분야<select name="category">${options(CATS, g.category)}</select></label>
        <label>기간<select name="period">${options(PERIODS, g.period)}</select></label>
        <label class="span2c">기한<input type="date" name="due" value="${esc(g.due || '')}"></label>
      </div>
      <fieldset><legend>숫자로 잴 수 있다면 <small class="muted">(비우면 진행률 %로 관리)</small></legend>
        <div class="grid4">
          <label>목표 값<input type="number" name="target" min="0" step="0.1" value="${esc(g.target ?? '')}" placeholder="10"></label>
          <label>현재 값<input type="number" name="current" min="0" step="0.1" value="${esc(g.current ?? '')}" placeholder="0"></label>
          <label class="span2c">단위<input name="unit" maxlength="10" value="${esc(g.unit || '')}" placeholder="경기 · 골 · % · 점"></label>
        </div>
        <label class="switch"><input type="checkbox" name="lower" ${g.lower ? 'checked' : ''}><span>작을수록 좋음 (순위 · 실점 · 지각 횟수 등)</span></label>
        <label>진행률 (숫자 목표가 아닐 때, %)<input type="range" name="progress" min="0" max="100" step="5" value="${esc(g.progress ?? 0)}"></label>
      </fieldset>
      <label>설명 · 실천 방법<textarea name="desc" rows="3" placeholder="어떻게 달성할지, 무엇을 볼지">${esc(g.desc || '')}</textarea></label>
      <div class="row end">${g.id ? '<button type="button" class="btn ghost" data-del>삭제</button>' : ''}<button class="btn">${g.id ? '저장' : '추가'}</button></div>
    </form>`, { wide: true });
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmBox('이 목표를 삭제할까요?'))) return;
    try { await deleteDoc(gdoc(g.id)); m.close(); refresh(); } catch (e) { fail(e); }
  });
  m.el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const data = {
      scope: 'team', title: d.title.trim(), category: d.category, period: d.period, due: d.due, desc: d.desc,
      target: d.target === '' ? null : +d.target, current: d.current === '' ? 0 : +d.current, unit: d.unit.trim(), progress: +d.progress, lower: !!d.lower,
    };
    try {
      if (g.id) await updateDoc(gdoc(g.id), data);
      else await addDoc(gcol(), { ...data, status: 'doing', ownerUid: state.user.uid, ownerName: state.profile.name, createdAt: serverTimestamp() });
      m.close();
      toast('저장했습니다.');
      refresh();
    } catch (err) { fail(err); }
  };
}

// ───────── 나의 목표 (선수) ─────────
function mineView(box, goals, refresh) {
  box.innerHTML = `
    <section class="my-goal-hero">
      <div><span class="eyebrow">MY GOALS</span><h2>${esc(state.profile.name)}의 목표</h2><p>스스로 정한 목표를 적고, 노력한 만큼 진행률을 올려보세요. 코치님이 응원 한마디를 남겨줘요.</p></div>
      <button class="btn" data-new>+ 내 목표 적기</button>
    </section>
    ${goals.length ? `<div class="goal-grid">${goals.map((g) => myCard(g, true)).join('')}</div>` : empty('아직 목표가 없어요. "내 목표 적기"를 눌러 첫 목표를 적어보세요!')}`;
  box.querySelector('[data-new]').onclick = () => myEditor(null, refresh);
  bindMyCards(box, goals, refresh);
}

function myCard(g, mine) {
  const p = pct(g);
  return `<article class="goal-card my ${g.status}" data-gid="${g.id}">
    <header><span class="tag">${esc(g.category || '기타')}</span>${g.due ? `<span class="dday">${dday(g.due)}</span>` : ''}
      ${g.status === 'done' ? '<span class="gstatus done">달성!</span>' : ''}${g.coachChecked ? '<span class="stamp">코치 확인</span>' : ''}</header>
    <h3>${esc(g.title)}</h3>
    ${g.why ? `<p><b>왜?</b> ${text(g.why)}</p>` : ''}
    ${g.how ? `<p><b>어떻게?</b> ${text(g.how)}</p>` : ''}
    <div class="gprog">
      <div class="bar"><i style="width:${p}%"></i></div>
      <div class="gnums"><strong>${p}%</strong>
        ${mine && g.status !== 'done' ? '<span class="gbtns"><button class="chip" data-p="-10">−10</button><button class="chip" data-p="10">+10</button><button class="chip on" data-done>달성!</button></span>' : ''}</div>
    </div>
    ${g.coachComment ? `<div class="coach-note"><span class="tag solid">코치 한마디</span><p>${text(g.coachComment)}</p></div>` : ''}
    ${mine ? '<footer><button class="link-btn small" data-edit>수정</button></footer>' : ''}
  </article>`;
}

function bindMyCards(box, goals, refresh) {
  box.querySelectorAll('[data-gid]').forEach((card) => {
    const g = goals.find((x) => x.id === card.dataset.gid);
    const save = async (patch) => { try { await updateDoc(gdoc(g.id), patch); refresh(); } catch (e) { fail(e); } };
    card.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => save({ progress: Math.max(0, Math.min(100, (+g.progress || 0) + +b.dataset.p)) })));
    card.querySelector('[data-done]')?.addEventListener('click', () => { save({ status: 'done', progress: 100 }); toast('목표 달성! 정말 잘했어요 👏'); });
    card.querySelector('[data-edit]')?.addEventListener('click', () => myEditor(g, refresh));
  });
}

function myEditor(g, refresh) {
  g ||= {};
  const m = modal(`
    <span class="eyebrow">MY GOAL</span><h2>${g.id ? '내 목표 고치기' : '내 목표 적기'}</h2>
    <form class="stack kid-form">
      <label>🎯 무엇을 이룰까요?<input name="title" required maxlength="60" value="${esc(g.title || '')}" placeholder="예) 왼발로 정확하게 패스하기"></label>
      <fieldset><legend>어떤 분야인가요?</legend>
        <div class="pick-chips">${MY_CATS.map((c) => `<label><input type="radio" name="category" value="${c}" ${(g.category || MY_CATS[0]) === c ? 'checked' : ''}><span>${c}</span></label>`).join('')}</div>
      </fieldset>
      <label>💡 왜 이 목표를 정했나요?<textarea name="why" rows="2" maxlength="200" placeholder="예) 왼쪽에서 공을 받으면 자꾸 오른발로 바꿔서 늦어요">${esc(g.why || '')}</textarea></label>
      <label>💪 어떻게 노력할까요?<textarea name="how" rows="2" maxlength="200" placeholder="예) 매일 벽 패스 왼발 50개">${esc(g.how || '')}</textarea></label>
      <label>📅 언제까지 할까요?<input type="date" name="due" value="${esc(g.due || '')}"></label>
      <div class="row end">${g.id ? '<button type="button" class="btn ghost" data-del>지우기</button>' : ''}<button class="btn">${g.id ? '저장' : '올리기'}</button></div>
    </form>`);
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmBox('이 목표를 지울까요?'))) return;
    try { await deleteDoc(gdoc(g.id)); m.close(); refresh(); } catch (e) { fail(e); }
  });
  m.el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const data = { scope: 'personal', title: d.title.trim(), category: d.category, why: d.why, how: d.how, due: d.due };
    try {
      if (g.id) await updateDoc(gdoc(g.id), data);
      else await addDoc(gcol(), { ...data, status: 'doing', progress: 0, ownerUid: state.user.uid, ownerName: state.profile.name, createdAt: serverTimestamp() });
      m.close();
      toast(g.id ? '저장했어요.' : '목표를 올렸어요! 화이팅 💪');
      refresh();
    } catch (err) { fail(err); }
  };
}

// ───────── 선수 개인 목표 (코치) ─────────
function playersView(box, goals, members, refresh) {
  const players = members.filter((m) => m.role === 'player').sort((a, b) => (+a.number || 99) - (+b.number || 99));
  const by = (uid) => goals.filter((g) => g.ownerUid === uid);
  const written = players.filter((p) => by(p.id).length).length;
  box.innerHTML = `
    <p class="lead">선수들이 직접 적어 올린 목표입니다. 목표를 눌러 코치 한마디를 남기고 확인 도장을 찍어주세요. (작성 ${written}/${players.length}명)</p>
    ${players.length ? `<div class="pgoal-list">${players.map((p) => {
      const arr = by(p.id);
      return `<section class="pgoal">
        <header>${avatar(p.photo, p.name, 'sm')}<strong>${p.number ? `${esc(p.number)} ` : ''}${esc(p.name)}</strong>
          <small>${arr.length ? `목표 ${arr.length}개 · 평균 ${avgPct(arr)}%` : '아직 작성 안 함'}</small>
          ${arr.some((g) => !g.coachChecked) ? '<span class="tag solid">새 목표</span>' : ''}</header>
        ${arr.length ? `<div class="goal-grid">${arr.map((g) => myCard(g, false)).join('')}</div>` : ''}
      </section>`;
    }).join('')}</div>` : empty('선수가 없습니다.')}`;
  box.querySelectorAll('[data-gid]').forEach((card) => {
    const g = goals.find((x) => x.id === card.dataset.gid);
    card.classList.add('clickable');
    card.onclick = () => {
      const m = modal(`<span class="eyebrow">${esc(g.ownerName)} · ${esc(g.category || '')}</span><h2>${esc(g.title)}</h2>
        ${g.why ? `<p><b>왜?</b> ${text(g.why)}</p>` : ''}${g.how ? `<p><b>어떻게?</b> ${text(g.how)}</p>` : ''}
        <form class="stack">
          <label>코치 한마디<textarea name="coachComment" rows="3" placeholder="예) 좋은 목표야! 훈련 끝나고 5분씩 같이 해보자">${esc(g.coachComment || '')}</textarea></label>
          <label class="switch"><input type="checkbox" name="coachChecked" ${g.coachChecked ? 'checked' : ''}><span>확인 도장 찍기</span></label>
          <label>상태<select name="status">${options(Object.entries(STATUS), g.status)}</select></label>
          <div class="row end"><button class="btn">저장</button></div>
        </form>`);
      m.el.querySelector('form').onsubmit = async (e) => {
        e.preventDefault();
        const d = formData(e.target);
        try {
          await updateDoc(gdoc(g.id), { coachComment: d.coachComment, coachChecked: !!d.coachChecked, status: d.status, ...(d.status === 'done' ? { progress: 100 } : {}) });
          m.close();
          toast('저장했습니다.');
          refresh();
        } catch (err) { fail(err); }
      };
    };
  });
}
