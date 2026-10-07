import {
  db, collection, doc, query, where, orderBy, limit, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from '../fb.js';
import {
  esc, text, toast, fail, formData, modal, confirmBox, todayStr, pageHead, empty, avatar, ROLES, MATCH_TYPES, options,
} from '../ui.js';
import { state, inTeam, isOwner, loadContext, publicProfile, go, hooks } from '../store.js';
import { profileFields, bindPhoto, profileData } from './auth.js';
import { loadPrograms, present } from './training.js';
import { createPad, blank } from '../tactic.js';

// ───────── 프로필 ─────────
export function profile(el) {
  const p = state.profile;
  el.innerHTML = `${pageHead('PROFILE', '내 프로필')}
  <form class="card narrow">
    <div class="kv"><span>계정 유형</span><strong>${ROLES[p.role]}</strong></div>
    <div class="kv"><span>이메일</span><strong>${esc(p.email)}</strong></div>
    ${profileFields(p)}
    <button class="btn full">저장</button>
    ${inTeam() && !isOwner() ? '<button type="button" class="link-btn small" data-leave>팀 나가기</button>' : ''}
  </form>`;
  const form = el.querySelector('form');
  bindPhoto(form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = profileData(form);
    try {
      await updateDoc(doc(db, 'users', state.user.uid), d);
      Object.assign(state.profile, d);
      if (inTeam()) await updateDoc(doc(db, 'teams', state.team.id, 'members', state.user.uid), publicProfile(state.profile));
      hooks.updateShell();
      toast('저장했습니다.');
    } catch (err) { fail(err); }
  };
  el.querySelector('[data-leave]')?.addEventListener('click', async () => {
    if (!(await confirmBox(`${state.team.name} 팀에서 나갈까요?`))) return;
    try {
      await deleteDoc(doc(db, 'teams', state.team.id, 'members', state.user.uid));
      await updateDoc(doc(db, 'users', state.user.uid), { teamId: null });
      await loadContext();
      go('/');
    } catch (err) { fail(err); }
  });
}

// ───────── 오늘 기록 (자각도 · 취침시간 · 컨디션 · 부상도 · 일지) ─────────
export function sleepHours(bed, wake) {
  if (!bed || !wake) return null;
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  let diff = toMin(wake) - toMin(bed);
  if (diff <= 0) diff += 1440;
  return Math.round((diff / 60) * 10) / 10;
}

const CONDITION = ['', '최악', '나쁨', '보통', '좋음', '최고'];

const scale = (name, max, value, labels = []) => `<div class="scale" data-scale="${name}">
  ${Array.from({ length: max }, (_, i) => i + (name === 'injury' ? 0 : 1)).map((n) => `
    <label><input type="radio" name="${name}" value="${n}" ${String(value) === String(n) ? 'checked' : ''}><span>${n}${labels[n] ? `<small>${labels[n]}</small>` : ''}</span></label>`).join('')}
</div>`;

const FOCUS = ['', '아쉬움', '조금', '보통', '잘함', '최고'];
const dailyTab = {}; // 날짜별로 보고 있던 탭 기억
const fmtTime = (v) => { const d = v?.toDate ? v.toDate() : null; return d ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''; };

// 세션 일지 입력칸 이름: s__{세션키}__{항목}
const sKey = (planId, i) => `${planId}-${i}`;

function sessionCard(key, b, i, v = {}, prog = null) {
  const f = (k) => `s__${key}__${k}`;
  const visual = prog && (prog.image || prog.pad);
  return `<article class="sess ${visual ? 'with-vis' : ''}">
    ${visual ? `<aside class="sess-vis" data-prog="${prog.id}" title="눌러서 크게 보기">
      ${prog.image ? `<img src="${esc(prog.image)}" alt="">` : '<div data-sess-pad></div>'}
      <span>▶ 크게 보기</span>
      ${lines(prog.points).length ? `<ol>${lines(prog.points).slice(0, 3).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
    </aside>` : ''}
    <div class="sess-main">
    <header><span class="bno">${i + 1}</span><div><strong>${esc(b.name || '훈련')}</strong>${b.min ? `<small>${esc(b.min)}분</small>` : ''}</div></header>
    ${b.desc ? `<p class="sess-desc">${text(b.desc)}</p>` : ''}
    <div class="sess-row"><span>얼마나 집중했나요?</span>${scale(f('focus'), 5, v.focus, FOCUS)}</div>
    <div class="grid3 sess-fields">
      <label>👍 잘된 점<textarea name="${f('good')}" rows="2" placeholder="예) 첫 터치로 방향 전환">${esc(v.good || '')}</textarea></label>
      <label>😓 어려웠던 점<textarea name="${f('hard')}" rows="2" placeholder="예) 압박 오면 공을 뺏겼어요">${esc(v.hard || '')}</textarea></label>
      <label>➡️ 다음엔 이렇게<textarea name="${f('next')}" rows="2" placeholder="예) 받기 전에 어깨 너머 보기">${esc(v.next || '')}</textarea></label>
    </div>
    </div>
  </article>`;
}

const lines = (str) => String(str || '').split('\n').map((x) => x.replace(/^\s*[-•·\d.)]+\s*/, '').trim()).filter(Boolean);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const fmtDay = (d) => { const x = new Date(`${d}T00:00`); return `${x.getMonth() + 1}월 ${x.getDate()}일 (${DOW[x.getDay()]})`; };

export async function daily(el, _p, date = todayStr()) {
  const tid = state.team.id;
  const base = ['teams', tid, 'logs'];
  const [cur, hist, ps, programs, allPlans, ms, sc] = await Promise.all([
    getDoc(doc(db, ...base, `${state.user.uid}_${date}`)),
    getDocs(query(collection(db, ...base), where('uid', '==', state.user.uid), orderBy('date', 'desc'), limit(60))),
    getDocs(query(collection(db, 'teams', tid, 'posts'), where('type', '==', 'daily'), where('date', '==', date))),
    loadPrograms(),
    getDocs(query(collection(db, 'teams', tid, 'posts'), where('type', '==', 'daily'), orderBy('date', 'desc'), limit(120))),
    getDocs(query(collection(db, 'teams', tid, 'matches'), where('date', '==', date))),
    getDocs(query(collection(db, 'teams', tid, 'posts'), where('type', '==', 'schedule'), where('date', '==', date))),
  ]);
  const l = cur.data() || {};
  const myLogs = hist.docs.map((d) => d.data());
  const logs = myLogs.slice(0, 14).reverse();
  // 코치가 훈련장에 올린 이 날의 훈련 안내 (오전/오후 여러 개일 수 있음)
  const plans = ps.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const sessions = l.sessions || {};
  const progMap = Object.fromEntries(programs.map((x) => [x.id, x]));
  // 훈련 있는 날짜들 (이전/다음 훈련일 이동 · 최근 목록)
  const planDates = [...new Set(allPlans.docs.map((d) => d.data().date).filter(Boolean))].sort();
  const prevDate = [...planDates].reverse().find((d) => d < date);
  const games = ms.docs.map((d) => ({ id: d.id, ...d.data() }));
  const mj = l.match || {};
  // 경기 있는 날: 기록실 경기 또는 스케줄의 '경기' 일정 → 경기 일지를 먼저 보여줌 (탭으로 훈련 일지도 가능)
  const matchSched = sc.docs.map((d) => d.data()).filter((x) => x.kind === '경기');
  const isMatchDay = games.length > 0 || matchSched.length > 0;
  const tabNow = dailyTab[date] || l.kind || (isMatchDay ? 'match' : 'train');
  const status = l.checked ? ['done', '코치 검사 완료'] : l.submitted ? ['sent', `제출함 · 코치 검사 대기`] : cur.exists() ? ['draft', '작성 중 (아직 제출 안 함)'] : ['none', '아직 작성 안 함'];
  const nextDate = planDates.find((d) => d > date);
  const hasPlan = plans.some((p) => (p.blocks || []).length);

  el.innerHTML = `${pageHead('DAILY', '오늘 기록')}
  <section class="day-bar">
    <button class="btn ghost sm" data-go="${prevDate || ''}" ${prevDate ? '' : 'disabled'}>‹ 이전 훈련일</button>
    <div class="day-pick"><strong>${fmtDay(date)}</strong>${date === todayStr() ? ' <span class="tag solid">오늘</span>' : ''}
      <input type="date" value="${date}" data-date title="날짜를 고르면 그 날 훈련을 불러와요"></div>
    <button class="btn ghost sm" data-go="${nextDate || ''}" ${nextDate ? '' : 'disabled'}>다음 훈련일 ›</button>
    <button class="btn ghost sm" data-go="${todayStr()}">오늘</button>
    ${planDates.length ? `<div class="day-chips"><small>최근 훈련일</small>${[...planDates].reverse().slice(0, 8).map((d) => `<button class="chip ${d === date ? 'active' : ''}" data-go="${d}">${d.slice(5).replace('-', '.')}</button>`).join('')}</div>` : ''}
  </section>
  <form class="daily">
    <div class="grid2 top">
      <section class="card">
        <h3>몸 상태</h3>
        <h4>오늘 컨디션</h4>
        ${scale('condition', 5, l.condition, CONDITION)}
        <div class="grid2">
          <label>취침 시간<input type="time" name="bedtime" value="${esc(l.bedtime || '')}"></label>
          <label>기상 시간<input type="time" name="wakeTime" value="${esc(l.wakeTime || '')}"></label>
        </div>
        <p class="muted small" data-sleep></p>
        <h4>자각도 <small class="muted">운동 강도를 스스로 느낀 정도 (RPE · 1 매우 쉬움 ~ 10 최대)</small></h4>
        ${scale('rpe', 10, l.rpe)}
        <h4>부상도 <small class="muted">0 없음 ~ 10 출전 불가</small></h4>
        ${scale('injury', 11, l.injury ?? 0)}
        <label>부상 부위<input name="injuryPart" value="${esc(l.injuryPart || '')}" placeholder="예) 왼쪽 발목"></label>
      </section>
      <section class="card">
        <h3>최근 14일</h3>
        ${logs.length ? trend(logs) : empty('기록이 쌓이면 추이가 보입니다.')}
      </section>
    </div>

    <section class="card journal">
      <div class="jstatus ${status[0]}"><span>${status[1]}</span>${l.submittedAt ? `<small>제출 ${fmtTime(l.submittedAt)}</small>` : ''}</div>
      <div class="kind-pick"><span>오늘은</span>
        <label><input type="radio" name="kind" value="train" ${tabNow === 'train' ? 'checked' : ''} data-jtab="train"><b>🏃 훈련</b>${hasPlan ? '<small>훈련 안내 있음</small>' : ''}</label>
        <label><input type="radio" name="kind" value="match" ${tabNow === 'match' ? 'checked' : ''} data-jtab="match"><b>⚽ 경기</b>${isMatchDay ? '<small>오늘 경기</small>' : ''}</label>
        <em>고른 일지만 제출돼요</em></div>
      <div data-part="train" ${tabNow === 'train' ? '' : 'hidden'}>
      ${hasPlan ? '<p class="muted small">코치님이 올린 오늘 훈련을 불러왔어요. 세션마다 하나씩 적어보세요.</p>' : ''}
      ${hasPlan ? plans.map((p) => `
        <div class="jplan">
          <div class="jplan-head"><strong>${esc(p.title || '훈련')}</strong><small>${esc([p.time, p.place].filter(Boolean).join(' · '))}</small></div>
          ${p.goal ? `<div class="plan-goal"><small>오늘의 목표</small><p>${text(p.goal)}</p></div>` : ''}
          ${(p.blocks || []).map((b, i) => sessionCard(sKey(p.id, i), b, i, sessions[sKey(p.id, i)], progMap[b.programId])).join('')}
        </div>`).join('') : `
        <p class="muted small">이 날 훈련장에 올라온 훈련 안내가 없어서 자유롭게 적어요.</p>
        <label>오늘 한 훈련<textarea name="training" rows="2">${esc(l.training || '')}</textarea></label>
        <label>잘한 점<textarea name="good" rows="2">${esc(l.good || '')}</textarea></label>
        <label>보완할 점<textarea name="improve" rows="2">${esc(l.improve || '')}</textarea></label>`}
      <div class="jsum">
        <h4>오늘 전체 정리</h4>
        ${plans.some((p) => p.goal) ? `<div class="sess-row"><span>오늘의 목표를 얼마나 이뤘나요?</span>${scale('goalScore', 5, l.goalScore, FOCUS)}</div>` : ''}
        <div class="grid2">
          <label>📚 오늘 배운 점<textarea name="learned" rows="2">${esc(l.learned || '')}</textarea></label>
          <label>🎯 내일 목표<textarea name="tomorrow" rows="2">${esc(l.tomorrow || '')}</textarea></label>
        </div>
      </div>
      </div>
      <div data-part="match" ${tabNow === 'match' ? '' : 'hidden'}>
        ${matchSched.length && !games.length ? `<div class="mj-game"><span class="tag solid">일정</span><strong>${matchSched.map((x) => esc([x.time, x.title, x.place].filter(Boolean).join(' · '))).join(' / ')}</strong><small>스케줄의 경기 일정</small></div>` : ''}
        ${games.length ? games.map((g) => `<div class="mj-game"><span class="tag solid">${esc(g.matchType || '경기')}</span><strong>vs ${esc(g.opponent)}</strong><b>${+g.gf} : ${+g.ga}</b><small>${esc(g.venue === 'home' ? '홈' : g.venue === 'away' ? '원정' : '')}</small></div>`).join('')
          : `<div class="grid4">
            <label>상대팀<input name="m_opponent" value="${esc(mj.opponent || '')}"></label>
            <label>경기 형태<select name="m_type">${options(MATCH_TYPES, mj.type)}</select></label>
            <label>우리 득점<input type="number" min="0" name="m_gf" value="${esc(mj.gf ?? '')}"></label>
            <label>상대 득점<input type="number" min="0" name="m_ga" value="${esc(mj.ga ?? '')}"></label>
          </div><p class="muted small">기록실에 이 날 경기가 등록되어 있으면 자동으로 불러와요.</p>`}
        <div class="grid4">
          <label>출전 시간 (분)<input type="number" min="0" max="120" name="m_minutes" value="${esc(mj.minutes ?? '')}"></label>
          <label>포지션<input name="m_position" maxlength="10" value="${esc(mj.position || state.profile.position || '')}"></label>
        </div>
        <h4>나의 평점 <small class="muted">오늘 경기에서 나는 몇 점?</small></h4>
        ${scale('m_rating', 10, mj.rating)}
        <div class="grid2">
          <label>👍 잘한 플레이<textarea name="m_good" rows="3" placeholder="예) 전반 20분 왼쪽 오버래핑 후 크로스">${esc(mj.good || '')}</textarea></label>
          <label>😓 아쉬운 플레이<textarea name="m_bad" rows="3" placeholder="예) 실점 장면에서 마크를 놓쳤어요">${esc(mj.bad || '')}</textarea></label>
          <label>📚 배운 점<textarea name="m_learned" rows="2">${esc(mj.learned || '')}</textarea></label>
          <label>🔥 다음 경기 각오<textarea name="m_next" rows="2">${esc(mj.next || '')}</textarea></label>
        </div>
        <div class="card-head"><h4>장면 설명 <small class="muted">경기장에 선수 · 화살표를 그려서 설명해요</small></h4><button type="button" class="btn ghost sm" data-add-scene>+ 장면 추가</button></div>
        <div data-scenes></div>
      </div>
      ${l.checked ? `<div class="coach-note"><span class="tag solid">코치 검사 완료</span>${l.coachComment ? `<p>${text(l.coachComment)}</p>` : ''}</div>` : ''}
    </section>
    <section class="card mylogs">
      <div class="card-head"><h3>내 일지 모아보기</h3><small class="muted">${myLogs.length}개</small></div>
      ${myLogs.length ? `<div class="ml-tools">
        <button type="button" class="chip" data-pickall>전체 선택</button>
        <button type="button" class="chip" data-pick10>최근 10개</button>
        <button type="button" class="chip" data-picknone>선택 해제</button>
        <button type="button" class="btn sm" data-pdf disabled>PDF로 저장</button>
      </div>` : ''}
      ${myLogs.length ? `<ul class="mylog-list">${myLogs.map((x) => {
        const k = x.kind || (x.match && (x.match.good || x.match.bad) ? 'match' : 'train');
        const st = x.checked ? '검사 완료' : x.submitted ? '제출함' : '작성 중';
        return `<li data-mylog="${x.date}" class="${x.date === date ? 'on' : ''}">
          <label class="ml-check" title="PDF로 저장할 일지 고르기"><input type="checkbox" data-pick="${x.date}"></label>
          <span class="date-badge">${esc(x.date.slice(5).replace('-', '.'))}</span>
          <div><strong>${k === 'match' ? `⚽ 경기${x.match?.opponent ? ` vs ${esc(x.match.opponent)}` : ''}` : '🏃 훈련'}</strong>
            <small>${st}${x.coachComment ? ` · 코치 한마디: ${esc(x.coachComment.slice(0, 40))}` : ''}</small></div>
          <span class="tag ${x.checked ? 'solid' : ''}">${st}</span></li>`;
      }).join('')}</ul>` : empty('아직 쓴 일지가 없어요.')}
    </section>
    <div class="row end daily-save"><button class="btn ghost" data-save>임시 저장</button><button class="btn" data-submit>${l.submitted ? '다시 제출' : '제출하기'}</button></div>
  </form>`;

  const form = el.querySelector('form');
  const upd = () => {
    const h = sleepHours(form.bedtime.value, form.wakeTime.value);
    el.querySelector('[data-sleep]').textContent = h ? `수면 ${h}시간` : '';
  };
  form.bedtime.oninput = form.wakeTime.oninput = upd;
  upd();
  el.querySelector('[data-date]').onchange = (e) => e.target.value && daily(el, _p, e.target.value);
  // 내 일지: 누르면 그 날 일지 보기
  el.querySelectorAll('[data-mylog]').forEach((li) => (li.onclick = (e) => {
    if (e.target.closest('.ml-check')) return; // 체크칸은 고르기만
    const x = myLogs.find((y) => y.date === li.dataset.mylog);
    const m = modal(`<span class="eyebrow">MY JOURNAL · ${esc(x.date)}</span><h2>${fmtDay(x.date)} 일지</h2>
      ${journalHtml(x) ? `<h4>훈련 일지</h4>${journalHtml(x)}` : ''}${matchHtml(x)}
      ${x.coachComment ? `<div class="coach-note"><span class="tag solid">코치 한마디</span><p>${text(x.coachComment)}</p></div>` : ''}
      <div class="row end"><button class="btn ghost" data-pdf1>PDF로 저장</button><button class="btn ghost" data-open-day>이 날 일지 열기 (수정)</button></div>`, { wide: true });
    m.el.querySelector('[data-pdf1]').onclick = () => saveJournalsPdf([x]);
    m.el.querySelectorAll('[data-view-pad]').forEach((box) => { const sc = x.match?.scenes?.[+box.dataset.viewPad]; if (sc?.pad) createPad(box, sc.pad, { editable: false }); });
    m.el.querySelector('[data-open-day]').onclick = () => { m.close(); daily(el, _p, x.date); window.scrollTo(0, 0); };
  }));
  // PDF: 여러 개를 골라 한 파일로
  const picks = () => [...el.querySelectorAll('[data-pick]:checked')].map((c) => c.dataset.pick);
  const syncPdf = () => {
    const n = picks().length;
    const b = el.querySelector('[data-pdf]');
    if (b) { b.disabled = !n; b.textContent = n ? `PDF로 저장 (${n}개)` : 'PDF로 저장'; }
  };
  const setPicks = (fn) => { el.querySelectorAll('[data-pick]').forEach((c, i) => { c.checked = fn(i); }); syncPdf(); };
  el.querySelectorAll('[data-pick]').forEach((c) => (c.onchange = syncPdf));
  el.querySelector('[data-pickall]')?.addEventListener('click', () => setPicks(() => true));
  el.querySelector('[data-pick10]')?.addEventListener('click', () => setPicks((i) => i < 10));
  el.querySelector('[data-picknone]')?.addEventListener('click', () => setPicks(() => false));
  el.querySelector('[data-pdf]')?.addEventListener('click', () => {
    const ds = picks();
    saveJournalsPdf(myLogs.filter((x) => ds.includes(x.date)).sort((a, b) => a.date.localeCompare(b.date)));
  });
  el.querySelectorAll('[data-jtab]').forEach((a) => (a.onchange = () => {
    dailyTab[date] = a.value;
    el.querySelectorAll('[data-part]').forEach((x) => { x.hidden = x.dataset.part !== a.value; });
  }));
  // 경기 장면: 작전판 + 설명
  const scenes = [];
  const sceneBox = el.querySelector('[data-scenes]');
  const addScene = (sc = {}) => {
    const wrap = document.createElement('div');
    wrap.className = 'mj-scene';
    wrap.innerHTML = `<div class="mj-scene-head"><strong>장면 ${scenes.length + 1}</strong><button type="button" class="link-btn small" data-rm-scene>빼기</button></div>
      <div data-scene-pad></div>
      <label>이 장면 설명<textarea rows="2" data-scene-note placeholder="예) 상대 7번이 안쪽으로 들어올 때 내가 따라가지 않아서 공간이 생겼어요">${esc(sc.note || '')}</textarea></label>`;
    sceneBox.appendChild(wrap);
    const entry = { wrap, pad: createPad(wrap.querySelector('[data-scene-pad]'), sc.pad || { ...blank('full'), items: [] }) };
    scenes.push(entry);
    wrap.querySelector('[data-rm-scene]').onclick = () => { wrap.remove(); scenes.splice(scenes.indexOf(entry), 1); };
  };
  (mj.scenes || []).forEach(addScene);
  el.querySelector('[data-add-scene]').onclick = () => addScene();
  el.querySelectorAll('[data-go]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); if (b.dataset.go) daily(el, _p, b.dataset.go); }));
  // 세션 옆 훈련 그림: 작전판 그리기 + 누르면 크게 보기
  el.querySelectorAll('[data-prog]').forEach((v) => {
    const prog = progMap[v.dataset.prog];
    const padBox = v.querySelector('[data-sess-pad]');
    if (padBox && prog?.pad) createPad(padBox, prog.pad, { editable: false });
    v.onclick = () => present(prog);
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const submit = !!e.submitter?.hasAttribute('data-submit');
    const d = formData(form);
    // 경기 일지 모으기
    const match = {};
    for (const [k, v] of Object.entries(d)) {
      if (!k.startsWith('m_')) continue;
      delete d[k];
      match[k.slice(2)] = ['rating', 'minutes', 'gf', 'ga'].includes(k.slice(2)) ? (v === '' ? null : +v) : v;
    }
    if (games.length) Object.assign(match, { opponent: games[0].opponent, type: games[0].matchType, gf: +games[0].gf, ga: +games[0].ga });
    match.scenes = scenes.filter((x) => x.wrap.isConnected).map((x) => ({ pad: x.pad.getData(), note: x.wrap.querySelector('[data-scene-note]').value }));
    // 세션별 입력 모으기
    const sess = {};
    for (const [k, v] of Object.entries(d)) {
      const m = k.match(/^s__(.+)__(focus|good|hard|next)$/);
      if (!m) continue;
      delete d[k];
      (sess[m[1]] ||= {})[m[2]] = m[2] === 'focus' ? +v || null : v;
    }
    plans.forEach((p) => (p.blocks || []).forEach((b, i) => { const k = sKey(p.id, i); if (sess[k]) Object.assign(sess[k], { name: b.name || '훈련', plan: p.title || '' }); }));
    const data = {
      ...d, date, uid: state.user.uid, name: state.profile.name,
      condition: +d.condition || null, rpe: +d.rpe || null, injury: +d.injury || 0, goalScore: +d.goalScore || null,
      sleep: sleepHours(d.bedtime, d.wakeTime), updatedAt: serverTimestamp(),
      ...(hasPlan ? { sessions: sess } : {}),
      match,
      ...(submit ? { submitted: true, submittedAt: serverTimestamp() } : {}),
    };
    // 고른 일지만 남김 (다른 쪽은 지움)
    if (d.kind === 'match') Object.assign(data, { sessions: null, training: null, good: null, improve: null, goalScore: null, learned: null, tomorrow: null });
    else data.match = null;
    try {
      await setDoc(doc(db, ...base, `${state.user.uid}_${date}`), data, { merge: true });
      toast(submit ? '일지를 제출했어요! 코치님이 확인할 거예요.' : '임시 저장했어요. 다 쓰면 제출하기를 눌러주세요.');
      daily(el, _p, date);
    } catch (err) { fail(err); }
  };
}

// 경기 일지 (코치 보기)
export function matchHtml(l) {
  if (l.kind === 'train') return '';
  const m = l.match || {};
  const has = m.good || m.bad || m.learned || m.next || m.rating || (m.scenes || []).length;
  if (!has) return '';
  return `<h4>경기 일지</h4>
    <div class="mj-game"><span class="tag solid">${esc(m.type || '경기')}</span><strong>vs ${esc(m.opponent || '-')}</strong><b>${m.gf ?? '-'} : ${m.ga ?? '-'}</b><small>${m.minutes != null ? `${m.minutes}분 출전` : ''} ${esc(m.position || '')}</small></div>
    ${m.rating ? `<div class="kv"><span>나의 평점</span><strong>${m.rating} / 10</strong></div>` : ''}
    ${m.good ? `<p><b>👍 잘한 플레이</b><br>${text(m.good)}</p>` : ''}${m.bad ? `<p><b>😓 아쉬운 플레이</b><br>${text(m.bad)}</p>` : ''}
    ${m.learned ? `<p><b>📚 배운 점</b><br>${text(m.learned)}</p>` : ''}${m.next ? `<p><b>🔥 다음 경기 각오</b><br>${text(m.next)}</p>` : ''}
    ${(m.scenes || []).map((sc, i) => `<div class="mj-scene read"><strong>장면 ${i + 1}</strong><div data-view-pad="${i}"></div>${sc.note ? `<p>${text(sc.note)}</p>` : ''}</div>`).join('')}`;
}

// 코치 일지검사 · 미리보기용: 세션 일지를 읽기 좋게
export function journalHtml(l) {
  if (l.kind === 'match') return '';
  const ss = Object.values(l.sessions || {}).filter((x) => x.good || x.hard || x.next || x.focus); // 쓴 세션만
  if (!ss.length && !l.training && !l.good && !l.improve && !l.goalScore && !l.learned && !l.tomorrow) return '';
  const stars = (n) => (n ? `${'●'.repeat(n)}${'○'.repeat(5 - n)}` : '-');
  return `${ss.length ? ss.map((x) => `
    <div class="sess read"><header><strong>${esc(x.name)}</strong><span class="muted small">집중 ${stars(x.focus)}</span></header>
      ${x.good ? `<p><b>👍</b> ${text(x.good)}</p>` : ''}${x.hard ? `<p><b>😓</b> ${text(x.hard)}</p>` : ''}${x.next ? `<p><b>➡️</b> ${text(x.next)}</p>` : ''}
      </div>`).join('') : `
    ${l.training ? `<h4>오늘 한 훈련</h4><div class="prose">${text(l.training)}</div>` : ''}
    ${l.good ? `<h4>잘한 점</h4><div class="prose">${text(l.good)}</div>` : ''}
    ${l.improve ? `<h4>보완할 점</h4><div class="prose">${text(l.improve)}</div>` : ''}`}
    ${l.goalScore ? `<div class="kv"><span>오늘의 목표 달성도</span><strong>${stars(l.goalScore)}</strong></div>` : ''}
    ${l.learned ? `<h4>오늘 배운 점</h4><div class="prose">${text(l.learned)}</div>` : ''}
    ${l.tomorrow ? `<h4>내일 목표</h4><div class="prose">${text(l.tomorrow)}</div>` : ''}`;
}

function trend(logs) {
  const row = (label, key, max, fmt = (v) => v) => `
    <div class="trend"><span>${label}</span><div class="bars">
      ${logs.map((l) => `<i title="${l.date} · ${l[key] ?? '-'}" style="height:${Math.max(4, ((+l[key] || 0) / max) * 100)}%"></i>`).join('')}
    </div><strong>${fmt(avg(logs, key))}</strong></div>`;
  return `${row('컨디션', 'condition', 5)}${row('수면(h)', 'sleep', 12)}${row('자각도', 'rpe', 10)}${row('부상도', 'injury', 10)}
    <div class="trend-dates"><span>${logs[0].date.slice(5)}</span><span>${logs.at(-1).date.slice(5)}</span></div>`;
}

const avg = (arr, k) => {
  const v = arr.map((x) => x[k]).filter((n) => n !== null && n !== undefined && n !== '').map(Number).filter((n) => !isNaN(n));
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '-';
};

// ───────── 일지검사 (코치) ─────────
export async function journalCheck(el, _p, date = todayStr()) {
  const tid = state.team.id;
  const [ms, ls] = await Promise.all([
    getDocs(collection(db, 'teams', tid, 'members')),
    getDocs(query(collection(db, 'teams', tid, 'logs'), where('date', '==', date))),
  ]);
  const players = ms.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.role === 'player')
    .sort((a, b) => (+a.number || 99) - (+b.number || 99));
  const logs = Object.fromEntries(ls.docs.map((d) => [d.data().uid, { id: d.id, ...d.data() }]));
  const done = players.filter((p) => logs[p.id]?.submitted); // 제출한 선수만 '제출'
  const drafting = players.filter((p) => logs[p.id] && !logs[p.id].submitted);
  const waiting = done.filter((p) => !logs[p.id].checked).length;
  const alerts = players.filter((p) => logs[p.id]).filter((p) => logs[p.id].injury >= 5 || logs[p.id].condition <= 2 || (logs[p.id].sleep && logs[p.id].sleep < 6));
  const all = Object.values(logs);

  el.innerHTML = `${pageHead('JOURNAL CHECK', '일지검사', `<input type="date" value="${date}" max="${todayStr()}" data-date>`)}
  <section class="stat-board small">
    <div><small>제출 · 검사 대기</small><strong>${done.length}<i>/${players.length}</i></strong><small>검사 대기 ${waiting} · 작성 중 ${drafting.length}</small></div>
    <div><small>평균 컨디션</small><strong>${avg(all, 'condition')}</strong></div>
    <div><small>평균 수면</small><strong>${avg(all, 'sleep')}<i>h</i></strong></div>
    <div><small>평균 자각도</small><strong>${avg(all, 'rpe')}</strong></div>
    <div><small>주의 선수</small><strong>${alerts.length}</strong></div>
  </section>
  ${alerts.length ? `<div class="banner">주의: ${alerts.map((p) => `${esc(p.name)}(${[
    logs[p.id].injury >= 5 && `부상 ${logs[p.id].injury}${logs[p.id].injuryPart ? ` ${esc(logs[p.id].injuryPart)}` : ''}`,
    logs[p.id].condition <= 2 && `컨디션 ${logs[p.id].condition}`,
    logs[p.id].sleep && logs[p.id].sleep < 6 && `수면 ${logs[p.id].sleep}h`,
  ].filter(Boolean).join(', ')})`).join(' · ')}</div>` : ''}
  <div class="jcards">
    ${players.map((p) => {
      const l = logs[p.id];
      const st = !l ? ['none', '작성 안 함'] : !l.submitted ? ['draft', '작성 중 · 미제출'] : l.checked ? ['done', '검사 완료'] : ['sent', '제출함 · 검사 대기'];
      const warn = l && (l.injury >= 5 || l.condition <= 2 || (l.sleep && l.sleep < 6));
      const wrote = l?.sessions ? Object.values(l.sessions).filter((x) => x.good || x.hard || x.next).length : 0;
      const kind = l?.kind || (l?.match && (l.match.good || l.match.bad || (l.match.scenes || []).length) ? 'match' : 'train');
      return `<article class="jcard ${st[0]} ${warn ? 'warn' : ''}" ${l?.submitted ? `data-uid="${p.id}"` : ''}>
        <header>${avatar(p.photo, p.name, 'lg')}<div><strong>${p.number ? `<span class="num">${esc(p.number)}</span> ` : ''}${esc(p.name)}</strong><small>${esc(p.position || '')}</small></div></header>
        ${l ? `<div class="jstats">
          <div><small>컨디션</small><b>${l.condition ?? '-'}<i>/5</i></b>${l.condition ? `<span class="dots">${'●'.repeat(l.condition)}${'○'.repeat(5 - l.condition)}</span>` : ''}</div>
          <div><small>수면</small><b>${l.sleep ?? '-'}<i>h</i></b></div>
          <div><small>자각도</small><b>${l.rpe ?? '-'}</b></div>
          <div class="${l.injury >= 5 ? 'hot' : ''}"><small>부상</small><b>${l.injury ?? 0}</b>${l.injuryPart ? `<em>${esc(l.injuryPart)}</em>` : ''}</div>
        </div>
        <div class="jmeta"><span class="jbadge ${st[0]}">${st[1]}</span><p class="jwhat">${kind === 'match' ? '<span class="tag solid">⚽ 경기 일지</span>' : `<span class="tag solid">🏃 훈련 일지</span>${l.sessions ? ` <span class="tag">세션 ${wrote}/${Object.keys(l.sessions).length}</span>` : ''}`}</p></div>` : `<p class="muted">아직 오늘 기록을 쓰지 않았어요.</p><div class="jmeta"><span class="jbadge ${st[0]}">${st[1]}</span></div>`}
        ${l?.submitted ? `<button class="btn full ${l.checked ? 'ghost' : ''}" data-open>${l.checked ? '검사 완료 · 다시 보기' : '일지 검사하기'}</button>` : ''}
      </article>`;
    }).join('')}
  </div>
  ${players.length ? '' : empty('선수가 없습니다.')}`;

  el.querySelector('[data-date]').onchange = (e) => journalCheck(el, _p, e.target.value);
  el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => {
    const l = logs[b.closest('[data-uid]').dataset.uid];
    const m = modal(`<span class="eyebrow">JOURNAL · ${esc(l.date)}</span><h2>${esc(l.name)}</h2>
      <div class="kv"><span>컨디션</span><strong>${l.condition ?? '-'} / 5</strong></div>
      <div class="kv"><span>취침 · 기상 · 수면</span><strong>${esc(l.bedtime || '-')} · ${esc(l.wakeTime || '-')} · ${l.sleep ?? '-'}h</strong></div>
      <div class="kv"><span>자각도</span><strong>${l.rpe ?? '-'} / 10</strong></div>
      <div class="kv"><span>부상도</span><strong>${l.injury ?? 0} / 10 ${esc(l.injuryPart || '')}</strong></div>
      ${journalHtml(l) ? `<h4>훈련 일지</h4>${journalHtml(l)}` : ''}${matchHtml(l)}
      ${!journalHtml(l) && !matchHtml(l) ? '<p class="muted">일지 내용이 없습니다.</p>' : ''}
      <form class="stack"><label>코치 코멘트<textarea name="coachComment" rows="3">${esc(l.coachComment || '')}</textarea></label>
      <div class="row end"><button class="btn">검사 완료</button></div></form>`, { wide: !!(l.match?.scenes || []).length });
    // 경기 장면 작전판 (읽기 전용)
    m.el.querySelectorAll('[data-view-pad]').forEach((box) => { const sc = l.match.scenes[+box.dataset.viewPad]; if (sc?.pad) createPad(box, sc.pad, { editable: false }); });
    m.el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await updateDoc(doc(db, 'teams', tid, 'logs', l.id), {
          checked: true, coachComment: e.target.coachComment.value, checkedBy: state.profile.name, checkedAt: serverTimestamp(),
        });
        m.close();
        journalCheck(el, _p, date);
      } catch (err) { fail(err); }
    };
  }));
}

// ───────── 일지 PDF (여러 개를 한 파일로, 일지마다 새 쪽) ─────────
const H2C = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const loadScript = (src) => new Promise((res, rej) => {
  if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
  const sc = document.createElement('script');
  sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error('PDF 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));
  document.head.appendChild(sc);
});

function pdfPage(x) {
  const k = x.kind || (x.match && (x.match.good || x.match.bad) ? 'match' : 'train');
  const st = x.checked ? '코치 검사 완료' : x.submitted ? '제출함' : '작성 중';
  const sleep = sleepHours(x.bedtime, x.wakeTime) ?? x.sleep;
  const body = [x.condition && ['컨디션', `${x.condition} / 5 ${CONDITION[x.condition] ? `(${CONDITION[x.condition]})` : ''}`],
    sleep && ['수면', `${sleep}시간${x.bedtime ? ` (${x.bedtime} ~ ${x.wakeTime || ''})` : ''}`],
    x.rpe && ['운동 강도(RPE)', `${x.rpe} / 10`], x.injury != null && ['통증 · 부상', x.injury ? `${x.injury} / 10` : '없음']].filter(Boolean);
  return `<article class="pdf-page">
    <header class="pdf-head"><span class="pdf-brand">SSAKA MANAGER</span><span>${esc(state.profile?.name || '')}${state.team ? ` · ${esc(state.team.name)}` : ''} · ${todayStr()} 저장</span></header>
    <h1>${x.date.slice(0, 4)}년 ${fmtDay(x.date)} · ${k === 'match' ? `경기 일지${x.match?.opponent ? ` vs ${esc(x.match.opponent)}` : ''}` : '훈련 일지'}</h1>
    <p class="pdf-st">${st}</p>
    ${body.length ? `<div class="pdf-body-state">${body.map(([a, b]) => `<div><span>${a}</span><b>${esc(String(b))}</b></div>`).join('')}</div>` : ''}
    ${journalHtml(x)}${matchHtml(x)}
    ${x.coachComment ? `<div class="coach-note"><span class="tag solid">코치 한마디</span><p>${text(x.coachComment)}</p></div>` : ''}
  </article>`;
}

export async function saveJournalsPdf(list) {
  if (!list.length) return;
  const prog = modal(`<span class="eyebrow">PDF</span><h2>PDF 만드는 중…</h2><p class="muted" data-pp>준비 중</p>`);
  const wrap = document.createElement('div');
  wrap.className = 'pdf-wrap';
  document.body.appendChild(wrap);
  try {
    await Promise.all([loadScript(H2C), loadScript(JSPDF)]);
    await document.fonts?.ready;
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const PW = 210; const PH = 297; const M = 12;
    for (let i = 0; i < list.length; i++) {
      prog.el.querySelector('[data-pp]').textContent = `${i + 1} / ${list.length}개`;
      const x = list[i];
      wrap.innerHTML = pdfPage(x);
      wrap.querySelectorAll('[data-view-pad]').forEach((box) => { const sc = x.match?.scenes?.[+box.dataset.viewPad]; if (sc?.pad) createPad(box, sc.pad, { editable: false }); });
      await new Promise((r) => setTimeout(r, 80));
      const page = wrap.firstElementChild;
      const cv = await window.html2canvas(page, { scale: 2, backgroundColor: '#ffffff', logging: false });
      // 한 쪽보다 길면 여러 쪽으로 — 글 줄이 잘리지 않게 덩어리(제목 · 칸 · 장면) 사이에서만 나눔
      const pxPerMm = cv.width / (PW - M * 2);
      const pageH = Math.floor((PH - M * 2) * pxPerMm);
      const k = cv.width / page.offsetWidth;
      const ends = [...page.children].map((c) => Math.round((c.offsetTop + c.offsetHeight + 6) * k));
      for (let y = 0, first = true; y < cv.height - 2; first = false) {
        if (i > 0 || !first) pdf.addPage();
        const fit = ends.filter((e) => e > y + 40 && e <= y + pageH);
        const cut = y + pageH >= cv.height ? cv.height : (fit.length ? Math.max(...fit) : y + pageH);
        const h = cut - y;
        const part = document.createElement('canvas');
        part.width = cv.width; part.height = h;
        const pc = part.getContext('2d');
        pc.fillStyle = '#fff'; pc.fillRect(0, 0, part.width, h);
        pc.drawImage(cv, 0, y, cv.width, h, 0, 0, cv.width, h);
        pdf.addImage(part.toDataURL('image/jpeg', 0.9), 'JPEG', M, M, PW - M * 2, h / pxPerMm);
        y = cut;
      }
    }
    const who = (state.profile?.name || '내').replace(/[\\/:*?"<>|]/g, '');
    const range = list.length === 1 ? list[0].date : `${list[0].date}~${list[list.length - 1].date}`;
    pdf.save(`${who}_일지_${range}${list.length > 1 ? `_${list.length}개` : ''}.pdf`);
    toast(`일지 ${list.length}개를 PDF로 저장했어요.`);
  } catch (err) { fail(err); } finally { wrap.remove(); prog.close(); }
}
