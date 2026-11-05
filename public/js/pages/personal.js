import {
  db, collection, doc, query, where, orderBy, limit, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch,
} from '../fb.js';
import {
  esc, text, toast, fail, formData, modal, confirmBox, todayStr, pageHead, empty, avatar, ROLES, MATCH_TYPES, options, sortGroups, sortBar, bindSortBar, getSort } from '../ui.js';
import { state, inTeam, isOwner, loadContext, publicProfile, nextNumbers, go, hooks, hasFeature, isCoach, refreshFeatures, isPersonal, parentLinked } from '../store.js';
import { exportModal, dailyFields, SLEEP_Q } from '../wellness.js';
import { profileFields, bindPhoto, profileData } from './auth.js';
import { withdraw } from './privacy.js';
import { installButton, bindInstall } from '../install.js';
import { loadPrograms, present } from './training.js';
import { createPad, blank } from '../tactic.js';
import { sleepMin, sleepOf, fmtSleep, sleepLong, SHORT_SLEEP } from '../sleep.js';
import * as GL from '../proto/goalLog.js';
import { AGE_GROUPS } from './team.js';

// ───────── 프로필 ─────────
export function profile(el) {
  const p = state.profile;
  el.innerHTML = `${pageHead('PROFILE', '내 프로필')}
  ${hasFeature('proto3') && inTeam() && p.role === 'player' ? '<a class="card narrow p3-melink" href="#/idp"><b>내 성장 카드</b><span>OVR · 능력치 · 훈련일지 · 경기 기록 · 목표 · 경기 영상이 한 곳에 모여 있어요</span><em>열기 →</em></a>' : ''}
  ${p.role === 'player' && inTeam() && !isPersonal() ? `<section class="card narrow pl-card">
    <h3>개인 계정 연결 <small class="muted">(듀얼)</small></h3>
    ${state.parentLink ? `<div class="kv"><span>${state.parentLink.approved ? '연결됨' : '승인 대기'}</span><strong>${esc(state.parentLink.owner)} · ${esc(state.parentLink.name)}</strong></div>
      <p class="muted small">${state.parentLink.approved ? `${esc(state.team.name)}은(는) 그대로예요. 컨디션 · 수면 · 자각도 · 경기 기록(숫자)이 개인 계정에도 올라가요. 일지에 쓴 글은 올라가지 않아요. 일지마다 '개인 계정에도 올리기'를 끌 수 있어요.` : '보호자님이 승인하면 연결돼요.'}</p>
      <button type="button" class="link-btn small danger-link" data-unlink>연결 끊기</button>`
    : `<p class="muted small">보호자님이 <b>개인 계정</b>를 만들었다면, 받은 <b>보호자 코드</b>를 넣어 연결해요. ${esc(state.team.name)}은(는) 그대로예요.</p>
      <button type="button" class="btn ghost" data-link>개인 계정 연결하기</button>`}
  </section>` : ''}
  <form class="card narrow">
    <div class="kv"><span>계정 유형</span><strong>${p.parent ? '보호자' : ROLES[p.role]}</strong></div>
    <div class="kv"><span>이메일</span><strong>${esc(p.email)}</strong></div>
    ${profileFields(p)}
    <button class="btn full">저장</button>
    ${inTeam() && !isOwner() ? '<button type="button" class="link-btn small" data-leave>팀 나가기</button>' : ''}
    <div class="row between small me-foot"><a href="#/privacy" class="muted">개인정보 처리방침</a>${installButton()}<button type="button" class="link-btn small danger-link" data-withdraw>회원 탈퇴</button></div>
  </form>`;
  bindInstall(el);
  el.querySelector('[data-withdraw]').onclick = withdraw;
  el.querySelector('[data-link]')?.addEventListener('click', () => import('./onboard.js').then((m) => m.parentCodeModal()));
  el.querySelector('[data-unlink]')?.addEventListener('click', () => import('./onboard.js').then((m) => m.unlinkParent()));
  const form = el.querySelector('form');
  bindPhoto(form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = profileData(form);
    if (state.profile.role === 'player' && 'number' in d) { const h = nextNumbers(state.profile, d.number); if (h) d.numbers = h; d.numYear = new Date().getFullYear(); if (d.grade) d.gradeYear = d.numYear; }
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
// 듀얼: 개인 계정에는 일지 글(배운 점 · 세션 · 장면 그림 등)은 빼고, 기록으로 쌓을 수 있는 숫자만 올림
//  컨디션 · 자각도 · 수면 · 부상 · 훈련 시간 · 키 · 몸무게 + 경기(상대 · 점수 · 출전 시간 · 골 · 도움 개수 · 평점)
const RECORD_KEYS = ['date', 'uid', 'name', 'kind', 'condition', 'rpe', 'injury', 'hurt', 'sleep', 'sleepMin', 'bedtime', 'wakeTime', 'sleepQ', 'trainMin', 'absent', 'height', 'weight', 'submitted'];
const MATCH_KEYS = ['opponent', 'type', 'gf', 'ga', 'minutes', 'position', 'rating'];
// 개인 계정 칸에 올리기: 숫자 기록(+ share 면 일지 글까지)으로 통째로 바꿈 — 보호자가 단 한마디 · 확인 표시는 그대로 둠
//  (merge 로 올리면 예전에 보여준 글이 남으므로 매번 새로 씀)
async function pushToSpace(sid, data, share, extra = {}) {
  const pref = doc(db, 'teams', sid, 'logs', `${state.user.uid}_${data.date}`);
  let keep = {};
  try { const o = (await getDoc(pref)).data(); if (o) keep = Object.fromEntries(['checked', 'coachComment', 'checkedBy', 'checkedAt', 'answers'].filter((k) => o[k] !== undefined).map((k) => [k, o[k]])); } catch { /* 처음 */ }
  const { toParent: _t, ...full } = data;
  await setDoc(pref, { ...(share ? full : recordOnly(data)), ...keep, shared: !!share, ...extra, updatedAt: serverTimestamp() });
}
export function recordOnly(l) {
  const o = {};
  RECORD_KEYS.forEach((k) => { if (l[k] !== undefined) o[k] = l[k]; });
  if (l.match) {
    const m = {};
    MATCH_KEYS.forEach((k) => { if (l.match[k] !== undefined) m[k] = l.match[k]; });
    m.goals = (l.match.goals || []).map((g) => ({ min: g.min ?? null })); // 개수 · 분만 (장면 설명은 빼고)
    m.assistsMine = (l.match.assistsMine || []).map((a) => ({ min: a.min ?? null }));
    o.match = m;
  } else o.match = null;
  return o;
}
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

// 시간 고르기: [오전 | 오후] + 시 + 분 (휴대폰에서 누르기 쉽게) — 값은 숨은 칸에 'HH:MM' 그대로
function timePick(name, value, defPm) {
  const [h0, m0] = value ? value.split(':').map(Number) : [null, null];
  const pm = h0 == null ? defPm : h0 >= 12;
  const h12 = h0 == null ? '' : (h0 % 12) || 12;
  const mm = m0 == null ? '' : Math.round(m0 / 5) * 5 % 60;
  return `<div class="tpick" data-tpick="${name}">
    <input type="hidden" name="${name}" value="${esc(value || '')}">
    <div class="tpick-ap"><button type="button" class="${pm ? '' : 'on'}" data-ap="am">오전</button><button type="button" class="${pm ? 'on' : ''}" data-ap="pm">오후</button></div>
    <select data-th aria-label="시"><option value="">시</option>${Array.from({ length: 12 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${n === h12 ? 'selected' : ''}>${n}시</option>`).join('')}</select>
    <select data-tm aria-label="분">${Array.from({ length: 12 }, (_, i) => i * 5).map((n) => `<option value="${n}" ${n === mm ? 'selected' : ''}>${String(n).padStart(2, '0')}분</option>`).join('')}</select>
  </div>`;
}
function bindTimePicks(root, onChange) {
  root.querySelectorAll('[data-tpick]').forEach((w) => {
    const hid = w.querySelector('input[type=hidden]'); const th = w.querySelector('[data-th]'); const tm = w.querySelector('[data-tm]');
    const sync = () => {
      const pm = w.querySelector('[data-ap="pm"]').classList.contains('on');
      if (!th.value) { hid.value = ''; onChange(); return; }
      const h = (+th.value % 12) + (pm ? 12 : 0);
      hid.value = `${String(h).padStart(2, '0')}:${String(+tm.value || 0).padStart(2, '0')}`;
      onChange();
    };
    w.querySelectorAll('[data-ap]').forEach((b) => (b.onclick = () => { w.querySelectorAll('[data-ap]').forEach((x) => x.classList.toggle('on', x === b)); sync(); }));
    th.onchange = tm.onchange = sync;
  });
}

// 오늘 다친 경우: 자각도는 빼고 (끝까지 못 한 운동이라 강도 분석이 헷갈리지 않게)
export const HURT = { train: '훈련 중 부상', match: '경기 중 부상' };

const FOCUS = ['', '아쉬움', '조금', '보통', '잘함', '최고'];
const dailyTab = {}; // 날짜별로 보고 있던 탭 기억
const fmtTime = (v) => { const d = v?.toDate ? v.toDate() : null; return d ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''; };

// 세션 일지 입력칸 이름: s__{세션키}__{항목}
const sKey = (planId, i) => `${planId}-${i}`;

// 선수가 직접 쓰는 세션 일지 한 칸 (훈련 이름 · 한 내용 · 집중 · 잘된 점 · 어려운 점 · 다음엔 · 코치님께 질문)
// ans: 코치 답변 { text, by }
const newSceneKey = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function mySessCard(key, i, v = {}, ans = null) {
  const f = (k) => `s__${key}__${k}`;
  return `<article class="sess mine" data-skey="${key}">
    <div class="sess-main">
    <header><span class="bno">${i + 1}</span><input class="sess-name" name="${f('name')}" maxlength="40" value="${esc(v.name || '')}" placeholder="훈련 이름 (예: 써드맨 4v2 론도)"><button type="button" class="link-btn small" data-sdel>삭제</button></header>
    <label class="sess-did">무엇을 했나요?<textarea name="${f('did')}" rows="2" placeholder="예) 4명이 원을 만들고 2명이 가운데서 공을 뺏는 론도. 2터치 제한">${esc(v.did || '')}</textarea></label>
    <div class="sess-row"><span>얼마나 집중했나요?</span>${scale(f('focus'), 5, v.focus, FOCUS)}</div>
    <div class="grid3 sess-fields">
      <label>잘된 점<textarea name="${f('good')}" rows="2" placeholder="예) 첫 터치로 방향 전환">${esc(v.good || '')}</textarea></label>
      <label>어려웠던 점<textarea name="${f('hard')}" rows="2" placeholder="예) 압박 오면 공을 뺏겼어요">${esc(v.hard || '')}</textarea></label>
      <label>다음엔 이렇게<textarea name="${f('next')}" rows="2" placeholder="예) 받기 전에 어깨 너머 보기">${esc(v.next || '')}</textarea></label>
    </div>
    <div class="sess-padbox"><div data-spadbox></div></div>
    <label class="sess-ask">코치님께 질문 <small class="muted">(이 훈련에서 궁금한 점 — 코치님이 바로 아래에 답해 주세요)</small><textarea name="${f('ask')}" rows="2" placeholder="예) 압박이 올 때 몸을 어느 쪽으로 열어야 하나요?">${esc(v.ask || '')}</textarea></label>
    ${ans?.text ? `<div class="sess-ans"><span class="tag solid">코치 답변${ans.by ? ` · ${esc(ans.by)}` : ''}</span><p>${text(ans.text)}</p></div>` : v.ask ? '<p class="muted small sess-wait">코치님 답변을 기다리는 중이에요</p>' : ''}
    </div>
  </article>`;
}
const newSessKey = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
// 코치님이 올린 오늘 훈련 (참고로 보기만 — 기억이 안 날 때)
function planRef(plans, progMap) {
  if (!plans.length) return '';
  return `<details class="plan-ref" open><summary>코치님이 올린 오늘 훈련 <small class="muted">참고로 보면서 아래에 직접 적어요</small></summary>
    ${plans.map((p) => `<div class="jplan ref">
      <div class="jplan-head"><strong>${esc(p.title || '훈련')}</strong><small>${esc([p.time, p.place].filter(Boolean).join(' · '))}</small></div>
      ${p.goal ? `<div class="plan-goal"><small>오늘의 목표</small><p>${text(p.goal)}</p></div>` : ''}
      ${(p.blocks || []).map((b, i) => { const prog = progMap[b.programId]; const visual = prog && (prog.image || prog.pad); return `<div class="ref-block ${visual ? 'with-vis' : ''}">
        ${visual ? `<aside class="sess-vis" data-prog="${prog.id}" title="눌러서 크게 보기">${prog.image ? `<img src="${esc(prog.image)}" alt="">` : '<div data-sess-pad></div>'}<span>▶ 크게 보기</span></aside>` : ''}
        <div><b>${i + 1}. ${esc(b.name || '훈련')}</b>${b.min ? ` <small class="muted">${esc(b.min)}분</small>` : ''}${b.desc ? `<p class="muted small">${text(b.desc)}</p>` : ''}</div></div>`; }).join('')}
    </div>`).join('')}</details>`;
}

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
      <label>잘된 점<textarea name="${f('good')}" rows="2" placeholder="예) 첫 터치로 방향 전환">${esc(v.good || '')}</textarea></label>
      <label>어려웠던 점<textarea name="${f('hard')}" rows="2" placeholder="예) 압박 오면 공을 뺏겼어요">${esc(v.hard || '')}</textarea></label>
      <label>다음엔 이렇게<textarea name="${f('next')}" rows="2" placeholder="예) 받기 전에 어깨 너머 보기">${esc(v.next || '')}</textarea></label>
    </div>
    </div>
  </article>`;
}

const lines = (str) => String(str || '').split('\n').map((x) => x.replace(/^\s*[-•·\d.)]+\s*/, '').trim()).filter(Boolean);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const fmtDay = (d) => { const x = new Date(`${d}T00:00`); return `${x.getMonth() + 1}월 ${x.getDate()}일 (${DOW[x.getDay()]})`; };

export async function daily(el, _p, date0) {
  let date = date0;
  try { const d = sessionStorage.getItem('ssaka.daily.date'); sessionStorage.removeItem('ssaka.daily.date'); if (d && !date) date = d; } catch { /* */ }
  date ||= todayStr();
  await refreshFeatures();
  const tid = state.team.id;
  const base = ['teams', tid, 'logs'];
  // 개인 계정 선수: 일지 글은 나만 여는 칸(users/{uid}/journal)에 · 개인 계정에는 숫자 기록만 (보여주기를 켠 일지만 글까지)
  const privJ = isPersonal() && !isCoach();
  const jcol = privJ ? collection(db, 'users', state.user.uid, 'journal') : collection(db, ...base);
  const jdoc = (d) => (privJ ? doc(jcol, d) : doc(db, ...base, `${state.user.uid}_${d}`));
  const glOn = hasFeature('proto3');
  const [cur, hist, ps, programs, allPlans, ms, sc, mem, spaceLog] = await Promise.all([
    getDoc(jdoc(date)),
    getDocs(privJ ? query(jcol, orderBy('date', 'desc'), limit(60)) : query(jcol, where('uid', '==', state.user.uid), orderBy('date', 'desc'), limit(60))),
    getDocs(query(collection(db, 'teams', tid, 'posts'), where('type', '==', 'daily'), where('date', '==', date))),
    loadPrograms(),
    getDocs(query(collection(db, 'teams', tid, 'posts'), where('type', '==', 'daily'), orderBy('date', 'desc'), limit(120))),
    getDocs(query(collection(db, 'teams', tid, 'matches'), where('date', '==', date))),
    getDocs(query(collection(db, 'teams', tid, 'posts'), where('type', '==', 'schedule'), where('date', '==', date))),
    glOn ? getDocs(collection(db, 'teams', tid, 'members')).catch(() => null) : null,
    privJ ? getDoc(doc(db, ...base, `${state.user.uid}_${date}`)).catch(() => null) : null, // 보호자 한마디 · 확인 표시
  ]);
  const mates = mem ? mem.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.role === 'player' && m.approved !== false).sort((a, b) => (+a.number || 99) - (+b.number || 99)) : [];
  const l = { ...(cur.data() || {}), ...(spaceLog?.exists() ? Object.fromEntries(['checked', 'coachComment', 'checkedBy', 'checkedAt', 'answers'].map((k) => [k, spaceLog.data()[k]]).filter(([, v]) => v !== undefined)) : {}) };
  const myLogs = hist.docs.map((d) => d.data());
  const logs = myLogs.slice(0, 14).reverse();
  // 키는 매달 첫 기록에, 몸무게는 매주(월요일 시작) 첫 기록에 — 이미 적은 날이 있으면 안 물어봄
  const weekStart = (d) => { const x = new Date(`${d}T00:00`); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const others = myLogs.filter((x) => x.date !== date);
  const bodyNeed = {
    needHeight: !others.some((x) => x.height && x.date.slice(0, 7) === date.slice(0, 7)),
    needWeight: !others.some((x) => x.weight && weekStart(x.date) === weekStart(date)),
  };
  // 코치가 훈련장에 올린 이 날의 훈련 안내 (오전/오후 여러 개일 수 있음)
  const plans = ps.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const sessions = l.sessions || {};
  const progMap = Object.fromEntries(programs.map((x) => [x.id, x]));
  // 훈련 있는 날짜들 (이전/다음 훈련일 이동 · 최근 목록)
  const planDates = [...new Set(allPlans.docs.map((d) => d.data().date).filter(Boolean))].sort();
  const prevDate = [...planDates].reverse().find((d) => d < date);
  const games = ms.docs.map((d) => ({ id: d.id, ...d.data() }));
  const mj = l.match || {};
  // 출전: 뛰었어요 / 안 뛰었어요 · 전반 · 후반 뛴 분 (한쪽 시간은 지난 경기 일지에서 이어 받음, 처음엔 25분)
  const played0 = mj.played === false || (mj.played == null && mj.minutes === 0) ? 'no' : mj.played === true || mj.minutes > 0 ? 'yes' : '';
  // 경기 방식: 통으로 · 전반 · 후반 · 3쿼터 · 4쿼터 × 한 번 시간 (지난 경기 일지에서 이어 받음, 처음엔 2 × 25분)
  const lastFmt = myLogs.find((x) => x.date !== date && x.match?.periods)?.match || {};
  const per0 = +mj.periods || +lastFmt.periods || 2;
  const plen0 = +mj.plen || +lastFmt.plen || 25;
  const minIn = mj.mins || [];
  const oldMin = !mj.mins && mj.minutes > 0 ? mj.minutes : null; // 예전 '출전 시간' 칸 하나로 적은 일지 → 나눠서 새로 적게
  // 경기 있는 날: 기록실 경기 또는 스케줄의 '경기' 일정 → 경기 일지를 먼저 보여줌 (탭으로 훈련 일지도 가능)
  const matchSched = sc.docs.map((d) => d.data()).filter((x) => x.kind === '경기');
  const isMatchDay = games.length > 0 || matchSched.length > 0;
  const tabNow = dailyTab[date] || l.kind || (isMatchDay ? 'match' : 'train');
  const status = l.checked ? ['done', '코치 검사 완료'] : l.submitted ? ['sent', `제출함 · 코치 검사 대기`] : cur.exists() ? ['draft', '작성 중 (아직 제출 안 함)'] : ['none', '아직 작성 안 함'];
  const nextDate = planDates.find((d) => d > date);
  const hasPlan = plans.some((p) => (p.blocks || []).length);

  el.innerHTML = `${pageHead('DAILY', '오늘 기록')}
  <a class="jb-bar" href="#/journal"><span class="eyebrow">MY JOURNAL BOOK</span><b>내 일지 모아보기</b><small>지난 일지를 책처럼 한 장씩 넘겨 봐요 · 그날 뭐 했는지 · PDF로 저장</small><em>열기 ›</em></a>
  <section class="day-bar">
    <button class="btn ghost sm" data-go="${prevDate || ''}" ${prevDate ? '' : 'disabled'}>‹ 이전 훈련일</button>
    <div class="day-pick"><strong>${fmtDay(date)}</strong>${date === todayStr() ? ' <span class="tag solid">오늘</span>' : ''}
      <input type="date" value="${date}" data-date title="날짜를 고르면 그 날 훈련을 불러와요"></div>
    <button class="btn ghost sm" data-go="${nextDate || ''}" ${nextDate ? '' : 'disabled'}>다음 훈련일 ›</button>
    <button class="btn ghost sm" data-go="${todayStr()}">오늘</button>
    ${planDates.length ? `<div class="day-chips"><small>최근 훈련일</small>${[...planDates].reverse().slice(0, 8).map((d) => `<button class="chip ${d === date ? 'active' : ''}" data-go="${d}">${d.slice(5).replace('-', '.')}</button>`).join('')}</div>` : ''}
  </section>
  <nav class="dsteps" data-dsteps aria-label="오늘 기록 순서">
    <a href="javascript:void 0" data-step="body"><b>1</b><span>몸 상태<small data-st="body"></small></span></a>
    <a href="javascript:void 0" data-step="journal"><b>2</b><span>${tabNow === 'match' ? '경기 일지' : '훈련 일지'}<small data-st="journal"></small></span></a>
    <a href="javascript:void 0" data-step="submit"><b>3</b><span>제출<small data-st="submit"></small></span></a>
  </nav>
  <form class="daily">
    <div class="dbody">
      <section class="card" data-sec="body">
        <h3 class="dsec-h"><b>1</b>몸 상태</h3>
        <h4>오늘 컨디션</h4>
        ${scale('condition', 5, l.condition, CONDITION)}
        <div class="grid2">
          <div class="tpick-l"><span>취침 시간</span>${timePick('bedtime', l.bedtime, true)}</div>
          <div class="tpick-l"><span>기상 시간</span>${timePick('wakeTime', l.wakeTime, false)}</div>
        </div>
        <p class="muted small" data-sleep></p>
        ${hasFeature('wellness') ? `${dailyFields(l, plans.reduce((a, p) => a + (p.blocks || []).reduce((x, b) => x + (+b.min || 0), 0), 0), { ...bodyNeed, match: tabNow === 'match' })}${scale('sleepQ', 5, l.sleepQ, SLEEP_Q)}` : ''}
        <h4>오늘 다쳤나요? <small class="muted">훈련 · 경기 중에 다쳐서 끝까지 못 했으면 골라 주세요</small></h4>
        <div class="hurt-pick">${[['', '안 다쳤어요'], ['train', '훈련 중 부상'], ['match', '경기 중 부상']].map(([v, t]) => `<label><input type="radio" name="hurt" value="${v}" ${(l.hurt || '') === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
        <div class="hurt-box" data-hurt-box ${l.hurt ? '' : 'hidden'}>
          <label>언제 다쳤나요<input name="hurtWhen" maxlength="40" value="${esc(l.hurtWhen || '')}" placeholder="예) 전반 20분 · 훈련 30분째 · 경합하다 착지"></label>
          <p class="muted small">다친 날은 <b>자각도를 쓰지 않아요</b> — 코치님 데이터 분석에서도 이 날 자각도는 빠지고 <b>부상</b>으로 따로 표시돼요. 아래 부상도 · 부상 부위는 꼭 적어 주세요.</p>
        </div>
        <div data-rpe-box>
        <h4>자각도 <small class="muted">운동 강도를 스스로 느낀 정도 (RPE · 1 매우 쉬움 ~ 10 최대)</small></h4>
        ${scale('rpe', 10, l.rpe)}
        </div>
        <h4>부상도 <small class="muted">0 없음 ~ 10 출전 불가</small></h4>
        ${scale('injury', 11, l.injury ?? 0)}
        <label>부상 부위<input name="injuryPart" value="${esc(l.injuryPart || '')}" placeholder="예) 왼쪽 발목"></label>
      </section>
    </div>

    <section class="card journal" data-sec="journal">
      <h3 class="dsec-h"><b>2</b>오늘 일지 <small class="muted">훈련 또는 경기를 고르고 적어요</small></h3>
      <div class="jstatus ${status[0]}"><span>${status[1]}</span>${l.submittedAt ? `<small>제출 ${fmtTime(l.submittedAt)}</small>` : ''}</div>
      <div class="kind-pick"><span>오늘은</span>
        <label><input type="radio" name="kind" value="train" ${tabNow === 'train' ? 'checked' : ''} data-jtab="train"><b>훈련${hasPlan ? '<small>훈련 안내 있음</small>' : ''}</b></label>
        <label><input type="radio" name="kind" value="match" ${tabNow === 'match' ? 'checked' : ''} data-jtab="match"><b>경기${isMatchDay ? '<small>오늘 경기</small>' : ''}</b></label>
        <em>고른 일지만 제출돼요</em></div>
      <div data-part="train" ${tabNow === 'train' ? '' : 'hidden'}>
      ${planRef(plans, progMap)}
      <div class="card-head jsess-head"><h4>내 훈련 일지 <small class="muted">오늘 한 훈련을 하나씩 직접 적어요</small></h4><button type="button" class="btn sm" data-add-sess>+ 훈련 추가</button></div>
      <div data-mysess>${(Object.keys(sessions).length ? Object.entries(sessions) : [[newSessKey(), {}]]).map(([k, v], i) => mySessCard(k, i, v, (l.answers || {})[k])).join('')}</div>
      <button type="button" class="add-big" data-add-sess>＋ 훈련 하나 더 추가하기<small>오늘 한 훈련이 더 있으면 눌러서 적어요</small></button>
      ${l.training || l.good || l.improve ? `<details class="legacy"><summary class="muted small">예전 방식으로 쓴 내용</summary>
        <label>오늘 한 훈련<textarea name="training" rows="2">${esc(l.training || '')}</textarea></label>
        <label>잘한 점<textarea name="good" rows="2">${esc(l.good || '')}</textarea></label>
        <label>보완할 점<textarea name="improve" rows="2">${esc(l.improve || '')}</textarea></label></details>` : ''}
      <div class="jsum">
        <h4>오늘 전체 정리</h4>
        ${plans.some((p) => p.goal) ? `<div class="sess-row"><span>오늘의 목표를 얼마나 이뤘나요?</span>${scale('goalScore', 5, l.goalScore, FOCUS)}</div>` : ''}
        <div class="grid2">
          <label>오늘 배운 점<textarea name="learned" rows="2">${esc(l.learned || '')}</textarea></label>
          <label>내일 목표<textarea name="tomorrow" rows="2">${esc(l.tomorrow || '')}</textarea></label>
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
          </div><p class="muted small">기록실에 이 날 경기가 있으면 자동으로 불러와요.</p>`}
        ${glOn ? '<div data-gl-journal data-play="yes"></div>' : ''}
        <div class="kind-pick mj-play"><span>오늘 경기에</span>
          <label><input type="radio" name="m_played" value="yes" ${played0 === 'yes' ? 'checked' : ''}><b>뛰었어요</b></label>
          <label><input type="radio" name="m_played" value="no" ${played0 === 'no' ? 'checked' : ''}><b>안 뛰었어요<small>밖에서 봤어요</small></b></label>
          <em>꼭 골라 주세요</em></div>
        <div class="mj-min" data-play="yes">
          <div class="mj-min-h"><b>경기 방식</b><div class="mj-fmt"><select name="m_periods">${PERIODS.map(([n, lb]) => `<option value="${n}" ${n === per0 ? 'selected' : ''}>${lb}</option>`).join('')}</select><span>×</span><input type="number" name="m_plen" min="5" max="90" inputmode="numeric" value="${plen0}"><i>분</i></div></div>
          <b class="mj-min-t">내가 뛴 시간</b>
          ${[0, 1, 2, 3].map((i) => `<div class="mj-half" data-prow="${i}"><span data-pname>${periodName(per0, i)}</span><input type="number" name="m_p${i}" min="0" max="90" inputmode="numeric" value="${esc(minIn[i] ?? '')}" placeholder="0"><i>분</i><button type="button" class="chip" data-mfull="${i}">다 뛰었어요</button><button type="button" class="chip" data-mzero="${i}">0분</button></div>`).join('')}
          <p class="mj-sum" data-msum></p>${oldMin != null ? `<p class="muted small">예전에 적은 출전 시간: ${oldMin}분 — 나눠서 다시 적어 주세요</p>` : ''}
        </div>
        <div class="grid4" data-play="yes">
          <label>포지션<input name="m_position" maxlength="10" value="${esc(mj.position || state.profile.position || '')}"></label>
        </div>
        <div data-play="yes">
        <h4>나의 평점 <small class="muted">오늘 경기에서 나는 몇 점?</small></h4>
        ${scale('m_rating', 10, mj.rating)}
        </div>
        <div class="card-head jsess-head"><h4 data-play="yes">장면별 경기 일지 <small class="muted">기억나는 장면을 하나씩 그림 + 글로 적어요</small></h4><h4 data-play="no">밖에서 본 장면 <small class="muted">경기를 보며 기억나는 장면을 그림 + 글로 적어요</small></h4><button type="button" class="btn sm" data-add-scene>+ 장면 추가</button></div>
        <div data-scenes></div>
        <button type="button" class="add-big" data-add-scene>＋ 장면 하나 더 추가하기<small>기억나는 장면이 더 있으면 눌러서 그려요</small></button>
        ${mj.good || mj.bad ? `<details class="legacy"><summary class="muted small">예전 방식으로 쓴 내용</summary>
          <label>잘한 플레이<textarea name="m_good" rows="2">${esc(mj.good || '')}</textarea></label>
          <label>아쉬운 플레이<textarea name="m_bad" rows="2">${esc(mj.bad || '')}</textarea></label></details>` : ''}
        <div data-play="yes">
        <h4 class="jsum-h">경기 전체 정리</h4>
        <div class="grid2">
          <label>오늘 경기에서 배운 점<textarea name="m_learned" rows="2" placeholder="예) 수비 뒷공간은 첫 터치 방향이 중요해요">${esc(mj.learned || '')}</textarea></label>
          <label>다음 경기 각오<textarea name="m_next" rows="2" placeholder="예) 후반에도 끝까지 압박하기">${esc(mj.next || '')}</textarea></label>
        </div>
        </div>
        <div data-play="no">
        <h4 class="jsum-h">느낀 점</h4>
        <label>경기를 보며 느낀 점<textarea name="m_felt" rows="3" placeholder="예) 밖에서 보니 우리 팀이 왼쪽으로만 공격해서 오른쪽이 비어 있었어요">${esc(mj.felt || '')}</textarea></label>
        </div>
      </div>
      ${l.checked ? `<div class="coach-note"><span class="tag solid">코치 검사 완료</span>${l.coachComment ? `<p>${text(l.coachComment)}</p>` : ''}</div>` : ''}
    </section>
    <section class="card">
      <h3>최근 14일</h3>
      ${logs.length ? trend(logs) : empty('기록이 쌓이면 추이가 보입니다.')}
    </section>
    ${parentLinked() ? `<label class="mini-switch pl-send"><input type="checkbox" name="toParent" ${l.toParent === false ? '' : 'checked'}> 개인 계정에도 기록 올리기 <small class="muted">(${esc(parentLinked().owner)} · 숫자 기록만)</small></label>` : ''}
    ${parentLinked() || privJ ? `<label class="mini-switch pl-send"><input type="checkbox" name="shareText" ${l.shared ? 'checked' : ''}> 이 일지 글도 보호자님께 보여주기 <small class="muted">(꺼 두면 글은 나만 봐요)</small></label>` : ''}
    <div class="row end daily-save" data-sec="submit"><span class="dsave-st" data-save-st></span><button class="btn ghost" data-save>임시 저장</button><button class="btn" data-submit>${l.submitted ? '다시 제출' : '제출하기'}</button></div>
  </form>`;

  const form = el.querySelector('form');
  // 운동 불참: 사유 칸 보이기 · 운동시간 0
  const absentBox = form.querySelector('[data-absent]');
  absentBox?.addEventListener('change', () => {
    form.querySelector('[data-absent-why]').hidden = !absentBox.checked;
    const tm = form.querySelector('[name=trainMin]');
    if (tm) { tm.disabled = absentBox.checked; if (absentBox.checked) tm.value = 0; }
  });
  const upd = () => {
    const m = sleepMin(form.bedtime.value, form.wakeTime.value);
    el.querySelector('[data-sleep]').textContent = m ? `수면 ${sleepLong(m)}` : '';
  };
  bindTimePicks(form, upd);
  upd();
  const isMatch = () => form.querySelector('[name=kind]:checked')?.value === 'match';
  const benched = () => isMatch() && form.querySelector('[name=m_played]:checked')?.value === 'no';
  // 다쳤거나 경기에 안 뛰었으면 자각도 칸 감추기
  const syncHurt = () => {
    const h = form.querySelector('[name=hurt]:checked')?.value || '';
    form.querySelector('[data-hurt-box]').hidden = !h;
    form.querySelector('[data-rpe-box]').hidden = !!h || benched();
  };
  form.querySelectorAll('[name=hurt]').forEach((r) => r.addEventListener('change', syncHurt));
  syncHurt();
  // 경기 출전: 뛰었어요 / 안 뛰었어요에 맞는 칸만 · 전반 + 후반 합계 · 몸 상태의 '경기 시간'도 같은 값
  const halfOf = () => Math.max(5, Math.min(90, +form.m_plen.value || 25));
  const perOf = () => +form.m_periods.value || 2;
  const syncPlay = () => {
    const no = form.querySelector('[name=m_played]:checked')?.value === 'no';
    el.querySelectorAll('[data-part="match"] [data-play]').forEach((x) => { x.hidden = x.dataset.play !== (no ? 'no' : 'yes'); });
    el.querySelectorAll('[data-part="match"] [data-ph-yes]').forEach((x) => { x.placeholder = no ? x.dataset.phNo : x.dataset.phYes; });
    const hf = halfOf(); const n = perOf();
    el.querySelectorAll('[data-prow]').forEach((r) => { r.hidden = +r.dataset.prow >= n; r.querySelector('[data-pname]').textContent = periodName(n, +r.dataset.prow); });
    const vs = [...Array(n).keys()].map((i) => form[`m_p${i}`].value);
    const sum = vs.reduce((a, v) => a + (+v || 0), 0);
    const over = vs.some((v) => +v > hf);
    const ms = el.querySelector('[data-msum]');
    ms.className = `mj-sum ${over ? 'warn' : ''}`;
    ms.innerHTML = over ? `한 번 시간(${hf}분)보다 길게 적었어요` : vs.some((v) => v === '') ? `${n > 1 ? `${periodName(n, 0)} ~ ${periodName(n, n - 1)}을 모두` : '뛴 시간을'} 적어 주세요 <small>(안 뛴 쪽은 0분)</small>` : `합계 <b>${sum}분</b> / ${hf * n}분`;
    const tm = form.querySelector('[name=trainMin]');
    if (tm) {
      tm.readOnly = isMatch() && !form.querySelector('[data-absent]')?.checked;
      if (tm.readOnly) tm.value = no ? 0 : vs.every((v) => v === '') ? '' : sum;
      tm.title = tm.readOnly ? '경기 일지에 적은 출전 시간이 그대로 들어가요' : '';
    }
    syncHurt();
  };
  el.querySelectorAll('[data-mfull], [data-mzero]').forEach((b) => (b.onclick = () => {
    form[`m_p${b.dataset.mfull || b.dataset.mzero}`].value = b.dataset.mfull ? halfOf() : 0;
    syncPlay();
  }));
  form.addEventListener('input', syncPlay); form.addEventListener('change', syncPlay);
  syncPlay();
  el.querySelector('[data-date]').onchange = (e) => e.target.value && daily(el, _p, e.target.value);
  // 1 몸 상태 → 2 일지 → 3 제출: 어디까지 썼는지 위 단계와 아래 저장 줄에 보여 줌
  const syncSteps = () => {
    const on = (n) => !!form.querySelector(`[name="${n}"]:checked`);
    const kind = form.querySelector('[name=kind]:checked')?.value || 'train';
    const part = el.querySelector(`[data-part="${kind}"]`);
    const typed = (box) => [...box.querySelectorAll('textarea')].some((x) => x.value.trim());
    const body = on('condition') && form.bedtime.value && form.wakeTime.value;
    const jour = kind === 'match' ? on('m_played') || on('m_rating') || typed(part) || !!part.querySelector('.gl-row')
      : typed(part.querySelector('[data-mysess]') || part) || !!part.querySelector('[data-mysess] input[type=radio]:checked');
    const st = { body: [body, body ? '다 썼어요' : '컨디션 · 잠'], journal: [jour, jour ? '쓰는 중' : '아직'], submit: [!!l.submitted, l.checked ? '검사 완료' : l.submitted ? '제출함' : '아직'] };
    Object.entries(st).forEach(([k, [ok, t]]) => { const a = el.querySelector(`[data-step="${k}"]`); a.classList.toggle('ok', !!ok); a.querySelector('small').textContent = t; });
    const nxt = !body ? 'body' : !jour ? 'journal' : 'submit';
    el.querySelectorAll('[data-step]').forEach((a) => a.classList.toggle('now', a.dataset.step === nxt));
    el.querySelector('[data-step="journal"] span').firstChild.textContent = kind === 'match' ? '경기 일지' : '훈련 일지';
    const ss = el.querySelector('[data-save-st]');
    if (ss) ss.textContent = !body ? '1 몸 상태부터 적어요' : !jour ? `2 ${kind === 'match' ? '경기' : '훈련'} 일지를 적어요` : l.submitted ? '고쳤으면 다시 제출' : '다 쓰면 제출하기';
  };
  form.addEventListener('input', syncSteps); form.addEventListener('change', syncSteps); form.addEventListener('click', () => setTimeout(syncSteps, 0));
  el.querySelectorAll('[data-step]').forEach((a) => (a.onclick = () => el.querySelector(`[data-sec="${a.dataset.step}"]`)?.scrollIntoView({ behavior: 'smooth', block: a.dataset.step === 'submit' ? 'end' : 'start' })));
  el.querySelectorAll('[data-jtab]').forEach((a) => (a.onchange = () => {
    dailyTab[date] = a.value;
    el.querySelectorAll('[data-part]').forEach((x) => { x.hidden = x.dataset.part !== a.value; });
    // 경기를 고르면 '경기 시간', 훈련이면 '훈련 시간'
    const lb = el.querySelector('[data-tmin-label]'); if (lb) lb.textContent = a.value === 'match' ? '경기 시간' : '훈련 시간';
    const tm = form.querySelector('[name=trainMin]'); if (tm) tm.placeholder = a.value === 'match' ? '예) 60' : '예) 90';
  }));
  // 시제품 3.0: 골 · 도움 · 실점 장면 (경기 기록실로 모임)
  const glBox = el.querySelector('[data-gl-journal]');
  const getGL = glBox ? GL.mountJournal(glBox, { mj, players: mates, games, groups: AGE_GROUPS[state.team.category] || [], me: state.user.uid }) : null;
  // 경기 장면: 작전판 + 설명
  const scenes = [];
  const sceneBox = el.querySelector('[data-scenes]');
  const sAns = (sc) => {
    const a = (l.answers || {})[`m_${sc.key}`];
    return a?.text ? `<div class="sess-ans"><span class="tag solid">코치 답변${a.by ? ` · ${esc(a.by)}` : ''}</span><p>${text(a.text)}</p></div>` : sc.ask ? '<p class="muted small sess-wait">코치님 답변을 기다리는 중이에요</p>' : '';
  };
  // 장면 칸: 뛴 선수(내 플레이) · 안 뛴 선수(밖에서 본 경기)마다 이름 · 예시가 다름
  const sceneField = (k, v, cls = '') => {
    const [y, n] = SCENE_LB[k];
    return `<label class="${cls}"><span data-play="yes">${y[0]}</span><span data-play="no">${n[0]}</span><textarea rows="2" ${k === 'note' ? 'data-scene-note' : `data-sf="${k}"`} data-ph-yes="${y[1]}" data-ph-no="${n[1]}">${v}</textarea></label>`;
  };
  const addScene = (sc = {}) => {
    const wrap = document.createElement('div');
    wrap.className = 'mj-scene sess mine';
    wrap.innerHTML = `<header class="mj-scene-head"><span class="bno">${scenes.length + 1}</span><input class="sess-name" data-sf="title" maxlength="40" value="${esc(sc.title || '')}" placeholder="장면 이름 (예: 전반 20분 왼쪽 오버래핑)"><button type="button" class="link-btn small" data-rm-scene>빼기</button></header>
      <div data-scene-pad></div>
      ${sceneField('note', esc(sc.note || ''), 'sess-did')}
      <div class="grid3 sess-fields">${['good', 'bad', 'next'].map((k) => sceneField(k, esc(sc[k] || ''))).join('')}</div>
      <label class="sess-ask">코치님께 질문 <small class="muted">(이 장면에서 궁금한 점 — 코치님이 바로 아래에 답해 주세요)</small><textarea rows="2" data-scene-ask placeholder="예) 이 상황에서 나는 안쪽을 막아야 했나요, 바깥을 막아야 했나요?">${esc(sc.ask || '')}</textarea></label>
      ${sAns(sc)}`;
    sceneBox.appendChild(wrap);
    const entry = { wrap, key: sc.key || newSceneKey(), pad: createPad(wrap.querySelector('[data-scene-pad]'), sc.pad || { ...blank('full'), items: [] }) };
    scenes.push(entry);
    syncPlay?.();
    wrap.querySelector('[data-rm-scene]').onclick = () => { wrap.remove(); scenes.splice(scenes.indexOf(entry), 1); sceneBox.querySelectorAll('.bno').forEach((n, i) => { n.textContent = i + 1; }); };
  };
  (mj.scenes?.length ? mj.scenes : [{}]).forEach(addScene); // 처음엔 빈 장면 하나
  el.querySelectorAll('[data-add-scene]').forEach((b) => (b.onclick = () => { addScene(); scenes[scenes.length - 1].wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); scenes[scenes.length - 1].wrap.querySelector('.sess-name').focus({ preventScroll: true }); }));
  // 내 훈련 일지: 세션 추가 · 삭제 (번호 다시 매김)
  const sessBox = el.querySelector('[data-mysess]');
  const renumber = () => sessBox.querySelectorAll('.sess.mine .bno').forEach((n, i) => { n.textContent = i + 1; });
  const sessPads = new Map(); // 세션 키 → 작전판
  const openPad = (card, data) => {
    const k = card.dataset.skey;
    if (sessPads.has(k)) return;
    const box = card.querySelector('[data-spadbox]');
    sessPads.set(k, createPad(box, data || { ...blank('custom'), grid: { preset: 'none', cols: 0, rows: 0 } }, { motion: true }));
  };
  const bindSess = (card) => {
    openPad(card, sessions[card.dataset.skey]?.pad); // 작전판은 처음부터 펼쳐 둠 (필수)
    card.querySelector('[data-sdel]').onclick = () => { if (sessBox.children.length <= 1) { card.querySelectorAll('input:not([type=radio]), textarea').forEach((x) => { x.value = ''; }); card.querySelectorAll('input[type=radio]').forEach((x) => { x.checked = false; }); sessPads.delete(card.dataset.skey); card.querySelector('[data-spadbox]').innerHTML = ''; openPad(card); return; } sessPads.delete(card.dataset.skey); card.remove(); renumber(); }; };
  sessBox.querySelectorAll('.sess.mine').forEach(bindSess);
  el.querySelectorAll('[data-add-sess]').forEach((b) => (b.onclick = () => {
    sessBox.insertAdjacentHTML('beforeend', mySessCard(newSessKey(), sessBox.children.length, {}));
    const card = sessBox.lastElementChild; bindSess(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'start' }); card.querySelector('.sess-name').focus({ preventScroll: true });
  }));
  el.querySelectorAll('[data-go]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); if (b.dataset.go) daily(el, _p, b.dataset.go); }));
  // 세션 옆 훈련 그림: 작전판 그리기 + 누르면 크게 보기
  el.querySelectorAll('[data-prog]').forEach((v) => {
    const prog = progMap[v.dataset.prog];
    const padBox = v.querySelector('[data-sess-pad]');
    if (padBox && prog?.pad) createPad(padBox, prog.pad, { editable: false });
    v.onclick = () => present(prog);
  });
  syncSteps();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const submit = !!e.submitter?.hasAttribute('data-submit');
    const d = formData(form);
    // 경기 일지 모으기
    const match = {};
    for (const [k, v] of Object.entries(d)) {
      if (!k.startsWith('m_')) continue;
      delete d[k];
      match[k.slice(2)] = ['rating', 'minutes', 'gf', 'ga', 'periods', 'plen', 'p0', 'p1', 'p2', 'p3'].includes(k.slice(2)) ? (v === '' ? null : +v) : v;
    }
    // 출전: 안 뛰었으면 0분 · 평점 · 골 기록 · 경기 정리는 비움 / 뛰었으면 전반 + 후반 = 출전 시간
    match.played = match.played === 'yes' ? true : match.played === 'no' ? false : null;
    match.mins = [...Array(match.periods || 2).keys()].map((i) => match[`p${i}`] ?? null);
    [0, 1, 2, 3].forEach((i) => delete match[`p${i}`]);
    if (match.played === false) Object.assign(match, { mins: match.mins.map(() => 0), minutes: 0, rating: null, learned: '', next: '' });
    else Object.assign(match, { felt: '', minutes: match.mins.every((v) => v == null) ? null : match.mins.reduce((a, v) => a + (v || 0), 0) });
    if (getGL) { const g = getGL(); Object.assign(match, match.played === false ? Object.fromEntries(Object.entries(g).map(([k, v]) => [k, Array.isArray(v) ? [] : v])) : g); }
    const g0 = games.find((g) => g.id === match.gameId) || games[0];
    if (g0) Object.assign(match, { opponent: g0.opponent, type: g0.matchType, gf: +g0.gf, ga: +g0.ga });
    match.scenes = scenes.filter((x) => x.wrap.isConnected).map((x) => ({ key: x.key, pad: x.pad.getData(), note: x.wrap.querySelector('[data-scene-note]').value, ask: x.wrap.querySelector('[data-scene-ask]').value.trim(),
      ...Object.fromEntries([...x.wrap.querySelectorAll('[data-sf]')].map((f) => [f.dataset.sf, f.value.trim()])) }))
      .filter((sc) => sc.note.trim() || sc.ask || sc.title || sc.good || sc.bad || sc.next || (sc.pad?.items || []).length); // 빈 장면은 빼고
    // 세션별 입력 모으기
    const sess = {};
    for (const [k, v] of Object.entries(d)) {
      const m = k.match(/^s__(.+)__(focus|good|hard|next|name|did|ask)$/);
      if (!m) continue;
      delete d[k];
      (sess[m[1]] ||= {})[m[2]] = m[2] === 'focus' ? +v || null : v;
    }
    // 세션 작전판
    for (const [k, pad] of sessPads) { if (el.querySelector(`[data-skey="${k}"]`)) (sess[k] ||= {}).pad = pad.getData(); }
    // 아무것도 안 쓴 세션은 빼고 저장
    for (const [k, v] of Object.entries(sess)) if (!['name', 'did', 'good', 'hard', 'next', 'ask'].some((f) => (v[f] || '').trim()) && !v.focus && !(v.pad?.items || []).length) delete sess[k];
    // 제출할 때: 경기에 뛰었는지 · 전반 · 후반 뛴 시간은 필수 (안 뛰었으면 느낀 점)
    if (submit && d.kind === 'match') {
      const hf = +match.plen || 25;
      const bad = match.played == null ? ['.mj-play', '경기에 뛰었는지 먼저 골라 주세요.']
        : match.played && match.mins.some((v) => v == null) ? ['.mj-min', '뛴 시간을 모두 적어 주세요. (안 뛴 쪽은 0분)']
          : match.played && match.mins.some((v) => v > hf) ? ['.mj-min', `한 번 시간(${hf}분)보다 길게 적었어요. 다시 확인해 주세요.`]
            : match.played && !match.minutes ? ['.mj-min', '모두 0분이면 [안 뛰었어요]를 골라 주세요.']
              : match.played === false && !(match.felt || '').trim() ? ['[name=m_felt]', '경기를 보며 느낀 점을 적어 주세요.'] : null;
      if (bad) { el.querySelector(bad[0])?.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast(bad[1]); return; }
    }
    // 제출할 때: 쓴 장면마다 작전판 그림은 필수
    if (submit && d.kind === 'match') {
      const i = match.scenes.findIndex((sc) => !(sc.pad?.items || []).length);
      if (i >= 0) {
        const w = scenes.filter((x) => x.wrap.isConnected).find((x) => x.key === match.scenes[i].key)?.wrap;
        w?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast(`${w?.querySelector('.bno')?.textContent || i + 1}번 장면을 작전판에 그려 주세요. (그림은 필수예요 — 임시 저장은 그림 없이도 돼요)`);
        return;
      }
    }
    // 제출할 때: 쓴 훈련마다 작전판 그림은 필수
    if (submit && d.kind !== 'match') {
      const noPad = Object.entries(sess).find(([, v]) => !(v.pad?.items || []).length);
      if (noPad) {
        const card = el.querySelector(`[data-skey="${noPad[0]}"]`);
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast(`${card?.querySelector('.bno')?.textContent || ''}번 훈련을 작전판에 그려 주세요. (그림은 필수예요 — 임시 저장은 그림 없이도 돼요)`);
        return;
      }
    }
    const PL = parentLinked(); const toParent = !!PL && d.toParent === 'on'; const shareText = d.shareText === 'on'; delete d.toParent; delete d.shareText;
    const data = {
      ...d, date, uid: state.user.uid, name: state.profile.name, ...(PL ? { toParent } : {}), ...(PL || privJ ? { shared: shareText } : {}),
      condition: +d.condition || null, rpe: d.hurt || (d.kind === 'match' && match.played === false) ? null : +d.rpe || null, injury: +d.injury || 0, goalScore: +d.goalScore || null,
      hurt: d.hurt || '', hurtWhen: d.hurt ? (d.hurtWhen || '').trim() : '',
      sleep: sleepHours(d.bedtime, d.wakeTime), sleepMin: sleepMin(d.bedtime, d.wakeTime), updatedAt: serverTimestamp(),
      ...(hasFeature('wellness') ? {
        trainMin: d.absent ? 0 : d.kind === 'match' ? match.minutes : d.trainMin === '' || d.trainMin == null ? null : +d.trainMin, sleepQ: +d.sleepQ || null, // 경기 날은 출전 시간 그대로
        absent: !!d.absent, absentReason: d.absent ? (d.absentReason || '').trim() : '',
        ...(d.height ? { height: +(+d.height).toFixed(1) } : {}), ...(d.weight ? { weight: +(+d.weight).toFixed(1) } : {}),
        ...(d.absent ? { rpe: 0 } : {}),
      } : {}),
      sessions: sess,
      match,
      ...(submit ? { submitted: true, submittedAt: serverTimestamp() } : {}),
    };
    // 고른 일지만 남김 (다른 쪽은 지움)
    if (d.kind === 'match') Object.assign(data, { sessions: null, training: null, good: null, improve: null, goalScore: null, learned: null, tomorrow: null });
    else data.match = null;
    // 저장하는 동안: 두 번 누르지 않게 버튼을 막고 '저장 중' 표시 (휴대폰 인터넷이 느릴 때 멈춘 것처럼 보이지 않게)
    const btns = [...form.querySelectorAll('.daily-save .btn')];
    const label = e.submitter?.textContent;
    btns.forEach((b) => { b.disabled = true; });
    if (e.submitter) e.submitter.textContent = submit ? '제출하는 중…' : '저장하는 중…';
    try {
      // 한 번에 저장 (예전엔 두 번 따로 보내서 휴대폰에서 느렸음). 세션은 통째로 바꿈 (merge 는 지운 세션을 남겨 둠)
      const ref = jdoc(date);
      const b = writeBatch(db);
      b.set(ref, data, { merge: true });
      if (data.sessions) b.update(ref, { sessions: data.sessions });
      await b.commit();
      if (privJ) await pushToSpace(tid, data, shareText); // 개인 계정: 보호자가 보는 칸엔 숫자 기록 (+ 보여주기 켠 글)
      // 듀얼: 보호자 공간에도 같은 일지 (끄면 보낸 것도 지움) — 실패해도 팀 일지는 이미 저장됨
      let sent = false;
      if (PL) {
        const pref = doc(db, 'teams', PL.id, 'logs', `${state.user.uid}_${date}`);
        try {
          if (toParent) { await pushToSpace(PL.id, data, shareText, { fromTeam: state.team.name || '' }); sent = true; }
          else await deleteDoc(pref).catch(() => {});
        } catch { toast('개인 계정에는 올리지 못했어요. 잠시 뒤 다시 저장해 주세요.'); }
      }
      if (!(PL && toParent && !sent)) toast(`${submit ? '일지를 제출했어요! 코치님이 확인할 거예요.' : '임시 저장했어요. 다 쓰면 제출하기를 눌러주세요.'}${sent ? ' 개인 계정에도 올렸어요.' : ''}`);
      daily(el, _p, date);
    } catch (err) {
      fail(err);
      btns.forEach((x) => { x.disabled = false; });
      if (e.submitter && label) e.submitter.textContent = label;
    }
  };
}

const jKind = (x) => x.kind || (x.match && (x.match.opponent || x.match.good) ? 'match' : 'train');
const jbChip = (label, v) => (v == null || v === '' ? '' : `<span class="jb-chip"><small>${label}</small><b>${v}</b></span>`);
// 하루 한 장 (내 일지 책 · 쭉 보기 · 일지검사 몰아보기 같이 씀) — coachView: 지도자가 봄 · head: 위에 붙일 줄(선수 이름 등)
export function dayPageHtml(x, coachView = false, head = '') {
  const dt = new Date(`${x.date}T00:00`); const k = jKind(x); const sl = sleepOf(x);
  const body = `${journalHtml(x) ? `<h4>훈련 일지</h4>${journalHtml(x)}` : ''}${matchHtml(x)}`;
  return `${head}<div class="jb-date"><b>${dt.getMonth() + 1}월 ${dt.getDate()}일</b><span>${DOW[dt.getDay()]}요일 · ${dt.getFullYear()}</span>
      <span class="tag ${k === 'match' ? 'solid' : ''}">${k === 'match' ? `경기${x.match?.opponent ? ` vs ${esc(x.match.opponent)}` : ''}` : '훈련'}</span>${x.shared ? '<span class="tag pl-tag">보호자님께 보여줌</span>' : ''}</div>
    <div class="jb-chips">${jbChip('컨디션', x.condition != null ? `${x.condition}/5` : null)}${jbChip('수면', sl != null ? sleepLong(sl) : null)}${jbChip('자각도', x.rpe != null ? `${x.rpe}/10` : null)}${jbChip(k === 'match' ? '출전' : '훈련 시간', x.match?.played === false ? '안 뜀' : x.match?.minutes != null ? `${x.match.minutes}분${x.match.mins?.length > 1 ? ` <small>(${x.match.mins.join('+')})</small>` : ''}` : x.trainMin != null ? `${x.trainMin}분` : null)}${jbChip('평점', x.match?.rating ? `${x.match.rating}/10` : null)}</div>
    ${body || '<p class="muted jb-empty">이 날은 몸 상태만 적었어요.</p>'}
    ${x.coachComment ? `<div class="coach-note"><span class="tag solid">${isPersonal() ? '보호자 한마디' : '코치 한마디'}</span><p>${text(x.coachComment)}</p></div>` : ''}
    <div class="row end"><button type="button" class="link-btn small" data-pdf1>이 장 PDF로 저장</button><button type="button" class="link-btn small" data-edit>${coachView ? '이 날 검사 창 열기' : '이 날 일지 열기 (고치기)'}</button></div>`;
}
export function bindDayPage(page, x, coachView = false) {
  page.querySelectorAll('[data-view-pad]').forEach((box) => { const sc = x.match?.scenes?.[+box.dataset.viewPad]; if (sc?.pad) createPad(box, sc.pad, { editable: false }); });
  page.querySelectorAll('[data-view-spad]').forEach((box) => { const sp2 = x.sessions?.[box.dataset.viewSpad]?.pad; if (sp2) createPad(box, sp2, { editable: false }); });
  page.querySelector('[data-pdf1]').onclick = () => saveJournalsPdf([x]);
  page.querySelector('[data-edit]').onclick = () => {
    try { sessionStorage.setItem(coachView ? 'ssaka.jc.open' : 'ssaka.daily.date', coachView ? JSON.stringify({ date: x.date, uid: x.uid }) : x.date); } catch { /* */ }
    go(coachView ? '/journal-check' : '/daily');
  };
}

// ───────── 내 일지 모아보기: 지난 일지를 책처럼 하루 한 장씩 (그날 뭐 했지) + 아래 전체 목록 · PDF ─────────
//  ‹ › 버튼 · 키보드 ← → · 휴대폰은 옆으로 밀기 · 위 달 버튼 · 아래 목록에서 날짜 바로 가기
// 지도자: 일지검사 → 선수 한 명의 역대 일지 (/journal-check/:uid) — 같은 책 화면, 고치기 대신 검사 창
export async function journalPage(el, p = {}) {
  const coachView = !!p.uid && isCoach();
  const uid = coachView ? p.uid : state.user.uid; const tid = state.team.id;
  const privJ = isPersonal() && !isCoach();
  const who = coachView ? await getDoc(doc(db, 'teams', tid, 'members', uid)).then((d) => d.data() || {}).catch(() => ({})) : null;
  const [js, sp] = await Promise.all([
    getDocs(privJ ? query(collection(db, 'users', uid, 'journal'), orderBy('date', 'desc'), limit(400))
      : query(collection(db, 'teams', tid, 'logs'), where('uid', '==', uid), orderBy('date', 'desc'), limit(400))),
    privJ ? getDocs(query(collection(db, 'teams', tid, 'logs'), where('uid', '==', uid))).catch(() => null) : null, // 보호자 한마디
  ]);
  const cc = new Map((sp?.docs || []).map((d) => [d.data().date, d.data()]));
  const desc = js.docs.map((d) => { const x = d.data(); const c = cc.get(x.date); return c?.coachComment ? { ...x, coachComment: c.coachComment } : x; }).filter((x) => x.date);
  const logs = [...desc].reverse(); // 책 순서: 오래된 날 → 최근
  const back = coachView ? '<a class="btn ghost" href="#/journal-check">일지검사로</a>' : '<a class="btn ghost" href="#/daily">오늘 기록으로</a>';
  const title = coachView ? `${who.number ? `${esc(who.number)} ` : ''}${esc(who.name || desc[0]?.name || '선수')} 지난 일지` : '내 일지 모아보기';
  if (!logs.length) { el.innerHTML = `${pageHead('JOURNAL BOOK', title, back)}${empty(coachView ? '이 선수는 아직 쓴 일지가 없어요.' : '아직 쓴 일지가 없어요. 오늘 기록에서 일지를 쓰면 여기에 한 장씩 모여요.')}`; return; }
  let i = logs.length - 1;
  if (!coachView) try { const d = sessionStorage.getItem('ssaka.jb.at'); const n = logs.findIndex((x) => x.date === d); if (n >= 0) i = n; } catch { /* */ }
  const months = [...new Set(logs.map((x) => x.date.slice(0, 7)))];
  const W = ['일', '월', '화', '수', '목', '금', '토'];
  const kindOf = (x) => x.kind || (x.match && (x.match.opponent || x.match.good) ? 'match' : 'train');
  el.innerHTML = `${pageHead('JOURNAL BOOK', title, back)}
    <div class="jb-viewbar"><div class="seg sm"><button type="button" data-jv="roll">쭉 보기</button><button type="button" data-jv="book">한 장씩</button></div>
      <div class="chips" data-rk>${[['all', '전체'], ['train', '훈련'], ['match', '경기']].map(([k, lb]) => `<button type="button" class="chip" data-k="${k}">${lb} <b>${k === 'all' ? desc.length : desc.filter((x) => kindOf(x) === k).length}</b></button>`).join('')}</div></div>
    <div class="jb-roll" data-roll hidden>
      <div class="jb-months">${[...months].reverse().map((mo) => `<button type="button" class="chip" data-rmo="${mo}">${mo.slice(2, 4)}년 ${+mo.slice(5)}월</button>`).join('')}</div>
      <div data-rlist></div>
    </div>
    <div class="jbook" tabindex="-1">
      <div class="jb-months">${months.map((mo) => `<button type="button" class="chip" data-mo="${mo}">${mo.slice(2, 4)}년 ${+mo.slice(5)}월</button>`).join('')}</div>
      <div class="jb-page" data-page></div>
      <footer class="jb-foot"><button type="button" class="btn ghost" data-prev>‹ 이전 날</button><span data-jcnt></span><button type="button" class="btn ghost" data-next>다음 날 ›</button></footer>
    </div>
    <section class="card mylogs">
      <div class="card-head"><h3>모든 일지</h3><small class="muted">${desc.length}개 · 누르면 위에서 그 날로 가요</small></div>
      <div class="ml-tools">
        <button type="button" class="chip" data-pickall>전체 선택</button>
        <button type="button" class="chip" data-pick10>최근 10개</button>
        <button type="button" class="chip" data-picknone>선택 해제</button>
        <button type="button" class="btn sm" data-pdf disabled>PDF로 저장</button>
      </div>
      <ul class="mylog-list">${desc.map((x) => {
        const st = x.checked ? '검사 완료' : x.submitted ? '제출함' : '작성 중';
        return `<li data-mylog="${x.date}">
          <label class="ml-check" title="PDF로 저장할 일지 고르기"><input type="checkbox" data-pick="${x.date}"></label>
          <span class="date-badge">${esc(x.date.slice(5).replace('-', '.'))}</span>
          <div><strong>${kindOf(x) === 'match' ? `경기${x.match?.opponent ? ` vs ${esc(x.match.opponent)}` : ''}` : '훈련'}${x.shared ? ' <span class="tag pl-tag">보호자님께 보여줌</span>' : ''}</strong>
            <small class="${x.coachComment ? 'ml-cc' : ''}">${x.coachComment ? `${isPersonal() ? '보호자' : '코치'} 한마디: ${esc(x.coachComment.slice(0, 60))}` : st}</small></div>
          <span class="tag ${x.checked ? 'solid' : ''}">${st}</span></li>`;
      }).join('')}</ul>
    </section>`;
  const pageHtml = (x) => dayPageHtml(x, coachView);
  const bindPage = (page, x) => bindDayPage(page, x, coachView);
  const draw = (dir = 0) => {
    const x = logs[i];
    if (!coachView) try { sessionStorage.setItem('ssaka.jb.at', x.date); } catch { /* */ }
    const page = el.querySelector('[data-page]');
    page.className = `jb-page ${dir > 0 ? 'in-r' : dir < 0 ? 'in-l' : ''}`;
    page.innerHTML = pageHtml(x);
    bindPage(page, x);
    el.querySelector('[data-jcnt]').textContent = `${i + 1} / ${logs.length}`;
    el.querySelector('[data-prev]').disabled = i === 0;
    el.querySelector('[data-next]').disabled = i === logs.length - 1;
    el.querySelectorAll('[data-mo]').forEach((b) => b.classList.toggle('active', b.dataset.mo === x.date.slice(0, 7)));
    el.querySelectorAll('[data-mylog]').forEach((li) => li.classList.toggle('on', li.dataset.mylog === x.date));
  };
  const goTo = (n) => { n = Math.max(0, Math.min(logs.length - 1, n)); if (n === i) return; const d = n > i ? 1 : -1; i = n; draw(d); };
  el.querySelector('[data-prev]').onclick = () => goTo(i - 1);
  el.querySelector('[data-next]').onclick = () => goTo(i + 1);
  el.querySelectorAll('[data-mo]').forEach((b) => (b.onclick = () => goTo(logs.findIndex((x) => x.date.startsWith(b.dataset.mo)))));
  el.querySelectorAll('[data-mylog]').forEach((li) => (li.onclick = (e) => {
    if (e.target.closest('.ml-check')) return; // 체크칸은 고르기만
    if (view === 'roll') { if (rk !== 'all') el.querySelector('[data-rk] [data-k="all"]').click(); el.querySelector(`[data-rlist] [data-rd="${li.dataset.mylog}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    goTo(logs.findIndex((x) => x.date === li.dataset.mylog));
    el.querySelector('.jbook').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  // 쭉 보기: 최근 날부터 위에서 아래로 (작전판 그림은 화면에 가까워지면 그림) · 훈련 / 경기만 골라 보기
  let view = 'book'; let rk = 'all';
  try { view = localStorage.getItem(`ssaka.jb.view.${coachView ? 'c' : 'p'}`) || (coachView ? 'roll' : 'book'); } catch { view = coachView ? 'roll' : 'book'; }
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return; io.unobserve(e.target); const x = desc[+e.target.dataset.ri]; bindPage(e.target, x);
  }), { rootMargin: '600px 0px' }) : null;
  state.cleanup.push(() => io?.disconnect());
  const drawRoll = () => {
    const box = el.querySelector('[data-rlist]');
    io?.disconnect();
    const list = desc.map((x, n) => [x, n]).filter(([x]) => rk === 'all' || kindOf(x) === rk);
    box.innerHTML = list.length ? list.map(([x, n]) => `<article class="jb-page roll" data-ri="${n}" data-rd="${x.date}">${pageHtml(x)}</article>`).join('') : '<p class="muted center">이 종류의 일지가 없어요.</p>';
    box.querySelectorAll('[data-ri]').forEach((a) => (io ? io.observe(a) : bindPage(a, desc[+a.dataset.ri])));
    el.querySelectorAll('[data-rmo]').forEach((b) => { b.hidden = !list.some(([x]) => x.date.startsWith(b.dataset.rmo)); });
  };
  const setView = (v) => {
    view = v; try { localStorage.setItem(`ssaka.jb.view.${coachView ? 'c' : 'p'}`, v); } catch { /* */ }
    el.querySelectorAll('[data-jv]').forEach((b) => b.classList.toggle('on', b.dataset.jv === v));
    el.querySelector('[data-roll]').hidden = v !== 'roll';
    el.querySelector('[data-rk]').hidden = v !== 'roll';
    el.querySelector('.jbook').hidden = v === 'roll';
    if (v === 'roll' && !el.querySelector('[data-rlist]').children.length) drawRoll();
  };
  el.querySelectorAll('[data-jv]').forEach((b) => (b.onclick = () => setView(b.dataset.jv)));
  el.querySelectorAll('[data-rk] [data-k]').forEach((b) => (b.onclick = () => { rk = b.dataset.k; el.querySelectorAll('[data-rk] [data-k]').forEach((c) => c.classList.toggle('active', c === b)); drawRoll(); }));
  el.querySelector('[data-rk] [data-k="all"]').classList.add('active');
  el.querySelectorAll('[data-rmo]').forEach((b) => (b.onclick = () => el.querySelector(`[data-rlist] [data-rd^="${b.dataset.rmo}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  const key = (e) => { if (view === 'roll' || e.target.closest?.('input, textarea, select')) return; if (e.key === 'ArrowLeft') goTo(i - 1); if (e.key === 'ArrowRight') goTo(i + 1); };
  document.addEventListener('keydown', key);
  state.cleanup.push(() => document.removeEventListener('keydown', key));
  // 휴대폰: 옆으로 밀어서 넘기기 (그림 위에서는 넘기지 않음)
  let sx = null; const pg = el.querySelector('[data-page]');
  pg.addEventListener('touchstart', (e) => { sx = e.target.closest('canvas') ? null : e.touches[0].clientX; }, { passive: true });
  pg.addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 60) goTo(i + (dx < 0 ? 1 : -1)); }, { passive: true });
  // PDF: 여러 개를 골라 한 파일로
  const picks = () => [...el.querySelectorAll('[data-pick]:checked')].map((c) => c.dataset.pick);
  const syncPdf = () => { const n = picks().length; const b = el.querySelector('[data-pdf]'); b.disabled = !n; b.textContent = n ? `PDF로 저장 (${n}개)` : 'PDF로 저장'; };
  const setPicks = (fn) => { el.querySelectorAll('[data-pick]').forEach((c, n) => { c.checked = fn(n); }); syncPdf(); };
  el.querySelectorAll('[data-pick]').forEach((c) => (c.onchange = syncPdf));
  el.querySelector('[data-pickall]').onclick = () => setPicks(() => true);
  el.querySelector('[data-pick10]').onclick = () => setPicks((n) => n < 10);
  el.querySelector('[data-picknone]').onclick = () => setPicks(() => false);
  el.querySelector('[data-pdf]').onclick = () => { const ds = picks(); saveJournalsPdf(logs.filter((x) => ds.includes(x.date))); };
  draw();
  setView(view);
}

// 출전 표시: '안 뜀' · '37분 출전 (전반 25 · 후반 12)' · 예전 일지는 '37분 출전'
export const playLabel = (m = {}) => (m.played === false ? '안 뜀 (밖에서 봄)'
  : m.minutes != null ? `${m.minutes}분 출전${m.mins?.length > 1 ? ` (${m.mins.map((v, i) => `${periodName(m.mins.length, i)} ${v ?? '-'}`).join(' · ')})` : ''}${m.plen ? ` · ${m.periods || 2}×${m.plen}분 경기` : ''}` : '');
// 장면 칸 이름: [입력 칸 이름, 예시, 읽기 화면 이름] — 뛴 선수 / 안 뛴 선수
const SCENE_LB = {
  note: [['어떤 상황이었나요?', '예) 상대 7번이 안쪽으로 들어올 때 내가 따라가지 않아서 공간이 생겼어요', '상황'], ['어떤 장면이었나요?', '예) 전반 15분, 상대가 오른쪽 뒷공간으로 길게 찼어요', '본 장면']],
  good: [['잘된 점', '예) 첫 터치로 수비를 제쳤어요', '잘된 점'], ['우리 팀이 잘한 점', '예) 공 뺏기면 바로 둘이서 압박했어요', '팀이 잘한 점']],
  bad: [['아쉬웠던 점', '예) 마크를 놓쳐서 실점했어요', '아쉬웠던 점'], ['아쉬웠던 점', '예) 오른쪽이 비어서 계속 뚫렸어요', '아쉬웠던 점']],
  next: [['다음엔 이렇게', '예) 공 보기 전에 내 선수 먼저 확인', '다음엔'], ['내가 뛰었다면', '예) 나는 오른쪽에서 먼저 내려와 공간을 막았을 거예요', '내가 뛰었다면']],
};
// 경기 방식
const PERIODS = [[1, '통으로 한 번'], [2, '전반 · 후반 (2번)'], [3, '3쿼터'], [4, '4쿼터']];
const periodName = (n, i) => (n === 1 ? '경기' : n === 2 ? ['전반', '후반'][i] : `${i + 1}쿼터`);

// 경기 일지 (코치 보기)
export function matchHtml(l, coachAns = false) {
  if (l.kind === 'train') return '';
  const m = l.match || {};
  const has = m.good || m.bad || m.learned || m.next || m.felt || m.rating || m.played != null || m.minutes != null || (m.scenes || []).length || (m.goals || []).length || (m.conceded || []).length || (m.assistsMine || []).length;
  if (!has) return '';
  const bench = m.played === false;
  return `<h4>경기 일지</h4>
    <div class="mj-game"><span class="tag solid">${esc(m.type || '경기')}</span><strong>vs ${esc(m.opponent || '-')}</strong><b>${m.gf ?? '-'} : ${m.ga ?? '-'}</b><small>${playLabel(m)} ${bench ? '' : esc(m.position || '')}</small></div>
    ${bench ? '<p class="mj-bench">이 경기는 뛰지 않았어요 — 밖에서 경기를 보며 쓴 일지예요</p>' : ''}
    ${m.felt ? `<p><b>경기를 보며 느낀 점</b><br>${text(m.felt)}</p>` : ''}
    ${m.rating ? `<div class="kv"><span>나의 평점</span><strong>${m.rating} / 10</strong></div>` : ''}
    ${GL.journalSummary(m)}
    ${m.good ? `<p><b>잘한 플레이</b><br>${text(m.good)}</p>` : ''}${m.bad ? `<p><b>아쉬운 플레이</b><br>${text(m.bad)}</p>` : ''}
    ${m.learned ? `<p><b>배운 점</b><br>${text(m.learned)}</p>` : ''}${m.next ? `<p><b>다음 경기 각오</b><br>${text(m.next)}</p>` : ''}
    ${(m.scenes || []).map((sc, i) => `<div class="mj-scene read"><strong>${bench ? '본 장면' : '장면'} ${i + 1}${sc.title ? ` · ${esc(sc.title)}` : ''}</strong><div data-view-pad="${i}"></div>${['note', 'good', 'bad', 'next'].map((k) => (sc[k] ? `<p><b>${SCENE_LB[k][bench ? 1 : 0][2]}</b> ${text(sc[k])}</p>` : '')).join('')}${askBlock(sc.ask, sc.key ? `m_${sc.key}` : '', l.answers || {}, coachAns)}</div>`).join('')}`;
}

// 질문 + 답변 (코치 화면이면 답변 칸, 아니면 읽기)
function askBlock(ask, key, ans, coachAns) {
  if (!ask || !key) return '';
  return `<div class="sess-q"><p><b>질문</b> ${text(ask)}</p>
    ${coachAns ? `<label class="sess-a">답변<textarea rows="2" data-ans="${esc(key)}" placeholder="이 질문에 대한 답을 적어 주세요">${esc(ans[key]?.text || '')}</textarea></label>`
      : ans[key]?.text ? `<div class="sess-ans"><span class="tag solid">코치 답변${ans[key].by ? ` · ${esc(ans[key].by)}` : ''}</span><p>${text(ans[key].text)}</p></div>` : ''}</div>`;
}

// 코치 일지검사 · 미리보기용: 세션 일지를 읽기 좋게
// coachAns: 코치 화면이면 true → 질문마다 바로 아래에 답변 칸
export function journalHtml(l, coachAns = false) {
  if (l.kind === 'match') return '';
  const ss = Object.entries(l.sessions || {}).map(([k, x]) => ({ ...x, _k: k })).filter((x) => x.good || x.hard || x.next || x.focus || x.did || x.ask || (x.pad?.items || []).length); // 쓴 세션만
  if (!ss.length && !l.training && !l.good && !l.improve && !l.goalScore && !l.learned && !l.tomorrow) return '';
  const stars = (n) => (n ? `${'●'.repeat(n)}${'○'.repeat(5 - n)}` : '-');
  const ans = l.answers || {};
  return `${ss.length ? ss.map((x) => `
    <div class="sess read"><header><strong>${esc(x.name || '훈련')}</strong><span class="muted small">집중 ${stars(x.focus)}</span></header>
      ${x.did ? `<p><b>한 것</b> ${text(x.did)}</p>` : ''}
      ${(x.pad?.items || []).length ? `<div class="sess-viewpad" data-view-spad="${esc(x._k)}"></div>` : ''}
      ${x.good ? `<p><b>잘된 점</b> ${text(x.good)}</p>` : ''}${x.hard ? `<p><b>어려웠던 점</b> ${text(x.hard)}</p>` : ''}${x.next ? `<p><b>다음엔</b> ${text(x.next)}</p>` : ''}
      ${askBlock(x.ask, x._k, ans, coachAns)}
      </div>`).join('') : `
    ${l.training ? `<h4>오늘 한 훈련</h4><div class="prose">${text(l.training)}</div>` : ''}
    ${l.good ? `<h4>잘한 점</h4><div class="prose">${text(l.good)}</div>` : ''}
    ${l.improve ? `<h4>보완할 점</h4><div class="prose">${text(l.improve)}</div>` : ''}`}
    ${l.goalScore ? `<div class="kv"><span>오늘의 목표 달성도</span><strong>${stars(l.goalScore)}</strong></div>` : ''}
    ${l.learned ? `<h4>오늘 배운 점</h4><div class="prose">${text(l.learned)}</div>` : ''}
    ${l.tomorrow ? `<h4>내일 목표</h4><div class="prose">${text(l.tomorrow)}</div>` : ''}`;
}

// 일지검사 상세: 선수가 오늘 기록에 적은 몸 상태 전부 (적은 것만)
function bodyGrid(l) {
  const t = (label, v, cls = '') => (v == null || v === '' ? '' : `<div class="jb ${cls}"><small>${label}</small><b>${v}</b></div>`);
  const load = l.rpe && l.trainMin ? l.rpe * l.trainMin : null;
  return `<div class="jb-grid">
    ${t('컨디션', l.condition != null ? `${l.condition}<i>/5</i>` : '-')}
    ${t('수면', sleepOf(l) != null ? sleepLong(sleepOf(l)) : '-')}
    ${t('취침 · 기상', l.bedtime || l.wakeTime ? `${esc(l.bedtime || '-')} → ${esc(l.wakeTime || '-')}` : null)}
    ${t('수면 질', l.sleepQ ? `${l.sleepQ}<i>/5</i> <em>${esc(SLEEP_Q[l.sleepQ] || '')}</em>` : null)}
    ${l.hurt ? t('오늘 부상', `${HURT[l.hurt]}${l.hurtWhen ? ` <em>${esc(l.hurtWhen)}</em>` : ''}`, 'hot') : t('자각도 (RPE)', l.absent ? '불참' : l.rpe != null ? `${l.rpe}<i>/10</i>` : '-')}
    ${t(l.kind === 'match' ? '경기 시간' : '훈련 시간', l.absent ? '0<i>분</i>' : l.trainMin != null ? `${l.trainMin}<i>분</i>` : null)}
    ${t(l.kind === 'match' ? '경기 부하' : '훈련 부하', load != null && !l.hurt ? `${load}<i>RPE×분</i>` : null)}
    ${t('부상도', `${l.injury ?? 0}<i>/10</i>${l.injuryPart ? ` <em>${esc(l.injuryPart)}</em>` : ''}`, (l.injury || 0) >= 5 ? 'hot' : '')}
    ${l.absent ? t('운동 불참', esc(l.absentReason || '사유 없음'), 'hot') : ''}
    ${t('키', l.height ? `${l.height}<i>cm</i>` : null)}
    ${t('몸무게', l.weight ? `${l.weight}<i>kg</i>` : null)}
  </div>`;
}

function trend(logs0) {
  const logs = logs0.map((l) => ({ ...l, sleepM: sleepOf(l) }));
  const row = (label, key, max, fmt = (v) => v) => `
    <div class="trend"><span>${label}</span><div class="bars">
      ${logs.map((l) => `<i title="${l.date} · ${l[key] ?? '-'}" style="height:${Math.max(4, ((+l[key] || 0) / max) * 100)}%"></i>`).join('')}
    </div><strong>${fmt(avg(logs, key))}</strong></div>`;
  return `${row('컨디션', 'condition', 5)}${row('수면(분)', 'sleepM', 720, (v) => (v === '-' ? v : Math.round(v)))}${row('자각도', 'rpe', 10)}${row('부상도', 'injury', 10)}
    <div class="trend-dates"><span>${logs[0].date.slice(5)}</span><span>${logs.at(-1).date.slice(5)}</span></div>`;
}

const avg = (arr, k) => {
  const v = arr.map((x) => x[k]).filter((n) => n !== null && n !== undefined && n !== '').map(Number).filter((n) => !isNaN(n));
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '-';
};

// ───────── 일지검사 (코치) ─────────
let jFilter = 'all'; // 일지검사 보기: all · sub · draft · none

export async function journalCheck(el, _p, date0) {
  // 홈 '답 안 한 질문'에서 누르면 그 날짜 · 그 선수 일지를 바로 엶
  let openUid = null;
  try { const o = JSON.parse(sessionStorage.getItem('ssaka.jc.open') || 'null'); sessionStorage.removeItem('ssaka.jc.open'); if (o && !date0) { date0 = o.date; openUid = o.uid; } } catch { /* */ }
  const date = date0 || todayStr();
  await refreshFeatures();
  const tid = state.team.id;
  const [ms, ls] = await Promise.all([
    getDocs(collection(db, 'teams', tid, 'members')),
    getDocs(query(collection(db, 'teams', tid, 'logs'), where('date', '==', date))),
  ]);
  const players = ms.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.role === 'player' && m.approved !== false)
    .sort((a, b) => (+a.number || 99) - (+b.number || 99));
  const logs = Object.fromEntries(ls.docs.map((d) => [d.data().uid, { id: d.id, ...d.data() }]));
  const done = players.filter((p) => logs[p.id]?.submitted); // 제출한 선수만 '제출'
  const drafting = players.filter((p) => logs[p.id] && !logs[p.id].submitted);
  const waiting = done.filter((p) => !logs[p.id].checked).length;
  const alerts = players.filter((p) => logs[p.id]).filter((p) => logs[p.id].hurt || logs[p.id].injury >= 5 || logs[p.id].condition <= 2 || (sleepOf(logs[p.id]) != null && sleepOf(logs[p.id]) < SHORT_SLEEP));
  const all = Object.values(logs).map((l) => ({ ...l, sleepM: sleepOf(l) }));

  el.innerHTML = `${pageHead('JOURNAL CHECK', '일지검사', `<a class="btn sm" href="#/journal-roll">일지 몰아보기</a>${hasFeature('wellness') && isCoach() ? '<button class="btn ghost sm" data-xlsx>엑셀로 받기</button>' : ''}<input type="date" value="${date}" max="${todayStr()}" data-date>`)}
  <section class="stat-board small">
    <div><small>제출 · 검사 대기</small><strong>${done.length}<i>/${players.length}</i></strong><small>검사 대기 ${waiting} · 작성 중 ${drafting.length}</small></div>
    <div><small>평균 컨디션</small><strong style="color:var(--accent)">${avg(all, 'condition')}</strong></div>
    <div><small>평균 수면</small><strong>${avg(all, 'sleepM') === '-' ? '-' : Math.round(avg(all, 'sleepM'))}<i>분</i></strong></div>
    <div><small>평균 자각도</small><strong>${avg(all, 'rpe')}</strong></div>
    <div><small>주의 선수</small><strong style="${alerts.length ? 'color:#ff453a' : ''}">${alerts.length}</strong></div>
  </section>
  ${alerts.length ? `<div class="banner">주의: ${alerts.map((p) => `${esc(p.name)}(${[
    logs[p.id].hurt && `${HURT[logs[p.id].hurt]}${logs[p.id].hurtWhen ? ` ${esc(logs[p.id].hurtWhen)}` : ''}`,
    logs[p.id].injury >= 5 && `부상 ${logs[p.id].injury}${logs[p.id].injuryPart ? ` ${esc(logs[p.id].injuryPart)}` : ''}`,
    logs[p.id].condition <= 2 && `컨디션 ${logs[p.id].condition}`,
    sleepOf(logs[p.id]) != null && sleepOf(logs[p.id]) < SHORT_SLEEP && `수면 ${fmtSleep(sleepOf(logs[p.id]))}`,
  ].filter(Boolean).join(', ')})`).join(' · ')}</div>` : ''}
  <div class="sec-row jsort"><div class="chips jfilter" data-jf>${[['all', '전체', players.length], ['sub', '제출함', done.length], ['draft', '작성 중', drafting.length], ['none', '안 씀', players.length - done.length - drafting.length]].map(([k, lb, n]) => `<button type="button" class="chip ${jFilter === k ? 'active' : ''}" data-f="${k}">${lb} <b>${n}</b></button>`).join('')}</div>${sortBar('journal', getSort('journal'))}</div>
  <div class="jcards">
    ${sortGroups(players, getSort('journal')).map(([gt, ps]) => `${gt ? `<h3 class="sort-h">${esc(gt)} <small>${ps.length}명</small></h3>` : ''}${ps.map((p) => {
      const l = logs[p.id];
      const st = !l ? ['none', '작성 안 함'] : !l.submitted ? ['draft', '작성 중 · 미제출'] : l.checked ? ['done', '검사 완료'] : ['sent', '제출함 · 검사 대기'];
      const warn = l && (l.hurt || l.injury >= 5 || l.condition <= 2 || (sleepOf(l) != null && sleepOf(l) < SHORT_SLEEP));
      const wrote = l?.sessions ? Object.values(l.sessions).filter((x) => x.good || x.hard || x.next || x.did).length : 0;
      const asks = [...Object.entries(l?.sessions || {}), ...(l?.match?.scenes || []).filter((sc) => sc.key).map((sc) => [`m_${sc.key}`, sc])].filter(([k, x]) => x.ask && !(l.answers || {})[k]?.text).length;
      const kind = l?.kind || (l?.match && (l.match.good || l.match.bad || (l.match.scenes || []).length) ? 'match' : 'train');
      return `<article class="jcard ${st[0]} ${warn ? 'warn' : ''}" data-st="${!l ? 'none' : l.submitted ? 'sub' : 'draft'}" ${l ? `data-uid="${p.id}"` : ''}>
        <header>${avatar(p.photo, p.name, 'lg')}<div><strong>${p.number ? `<span class="num">${esc(p.number)}</span> ` : ''}${esc(p.name)}</strong><small>${esc(p.position || '')}</small><a class="jc-hist" href="#/journal-check/${esc(p.id)}">지난 일지 전부 ›</a></div></header>
        ${l ? `<div class="jstats">
          <div><small>컨디션</small><b>${l.condition ?? '-'}<i>/5</i></b>${l.condition ? `<span class="dots">${'●'.repeat(l.condition)}${'○'.repeat(5 - l.condition)}</span>` : ''}</div>
          <div><small>수면</small><b>${sleepOf(l) ?? '-'}<i>분</i></b></div>
          <div class="${l.hurt ? 'hot' : ''}"><small>자각도</small><b>${l.hurt ? '<span class="hurt-tag">부상</span>' : l.rpe ?? '-'}</b></div>
          <div class="${l.injury >= 5 || l.hurt ? 'hot' : ''}"><small>부상</small><b>${l.injury ?? 0}</b>${l.injuryPart ? `<em>${esc(l.injuryPart)}</em>` : ''}</div>
        </div>
        <div class="jmeta"><span class="jbadge ${st[0]}">${st[1]}</span><p class="jwhat">${kind === 'match' ? `<span class="tag solid">경기 일지</span>${l.match?.played === false ? ' <span class="tag">안 뜀</span>' : l.match?.minutes != null ? ` <span class="tag">${l.match.minutes}분 출전</span>` : ''}${asks ? ` <span class="tag warn">질문 ${asks}</span>` : ''}` : `<span class="tag solid">훈련 일지</span>${l.sessions ? ` <span class="tag">세션 ${wrote}</span>` : ''}${asks ? ` <span class="tag warn">질문 ${asks}</span>` : ''}`}</p></div>` : `<p class="muted">아직 오늘 기록을 쓰지 않았어요.</p><div class="jmeta"><span class="jbadge ${st[0]}">${st[1]}</span></div>`}
        ${l?.submitted ? `<button class="btn full ${l.checked ? 'ghost' : ''}" data-open>${l.checked ? '검사 완료 · 다시 보기' : '일지 검사하기'}</button>` : l ? '<button class="btn ghost full" data-open>쓰는 중인 기록 보기</button>' : ''}
      </article>`;
    }).join('')}`).join('')}
  </div>
  ${players.length ? '' : empty('선수가 없습니다.')}`;

  // 제출함 · 작성 중 · 안 씀 골라 보기 (버튼 하나로)
  const applyF = () => {
    el.querySelectorAll('[data-jf] [data-f]').forEach((b) => b.classList.toggle('active', b.dataset.f === jFilter));
    el.querySelectorAll('.jcards .jcard').forEach((c) => { c.hidden = jFilter !== 'all' && c.dataset.st !== jFilter; });
    el.querySelectorAll('.jcards .sort-h').forEach((h) => {
      let n = h.nextElementSibling, any = false;
      while (n && !n.classList.contains('sort-h')) { if (!n.hidden) any = true; n = n.nextElementSibling; }
      h.hidden = !any;
    });
    const none = el.querySelector('[data-jfnone]');
    if (none) none.hidden = !!el.querySelector('.jcards .jcard:not([hidden])') || !players.length;
  };
  el.querySelector('.jcards').insertAdjacentHTML('afterend', '<p class="muted center" data-jfnone hidden>이 조건에 맞는 선수가 없어요.</p>');
  el.querySelectorAll('[data-jf] [data-f]').forEach((b) => (b.onclick = () => { jFilter = b.dataset.f; applyF(); }));
  applyF();
  el.querySelector('[data-date]').onchange = (e) => journalCheck(el, _p, e.target.value);
  bindSortBar(el, 'journal', () => journalCheck(el, _p, date));
  el.querySelector('[data-xlsx]')?.addEventListener('click', exportModal);
  if (openUid) setTimeout(() => el.querySelector(`[data-uid="${openUid}"] [data-open]`)?.click(), 0);
  el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => {
    const l = logs[b.closest('[data-uid]').dataset.uid];
    const m = modal(`<span class="eyebrow">JOURNAL · ${esc(l.date)}</span><h2>${esc(l.name)} <a class="jc-hist inline" href="#/journal-check/${esc(l.uid)}">지난 일지 전부 ›</a></h2>
      ${l.submitted ? '' : '<p class="jc-draft">아직 제출하지 않은 기록이에요 — 선수가 지금까지 적은 내용이 보여요.</p>'}
      ${bodyGrid(l)}
      ${journalHtml(l) ? `<h4>훈련 일지</h4>${journalHtml(l, true)}` : ''}${matchHtml(l, true)}
      ${!journalHtml(l) && !matchHtml(l) ? '<p class="muted">일지 내용이 없습니다.</p>' : ''}
      ${l.submitted ? `<form class="stack"><label>코치 코멘트<textarea name="coachComment" rows="3">${esc(l.coachComment || '')}</textarea></label>
      <div class="row end"><button class="btn">검사 완료</button></div></form>` : ''}`, { wide: true });
    m.el.querySelector('.jc-hist')?.addEventListener('click', () => m.close());
    // 경기 장면 작전판 (읽기 전용)
    m.el.querySelectorAll('[data-view-pad]').forEach((box) => { const sc = l.match.scenes[+box.dataset.viewPad]; if (sc?.pad) createPad(box, sc.pad, { editable: false }); });
    m.el.querySelectorAll('[data-view-spad]').forEach((box) => { const sp = l.sessions?.[box.dataset.viewSpad]?.pad; if (sp) createPad(box, sp, { editable: false }); });
    if (m.el.querySelector('form')) m.el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        // 세션별 질문 답변 (적은 것만)
        const answers = { ...(l.answers || {}) };
        m.el.querySelectorAll('[data-ans]').forEach((ta) => {
          const v = ta.value.trim();
          if (v) answers[ta.dataset.ans] = { text: v, by: state.profile.name };
          else delete answers[ta.dataset.ans];
        });
        await updateDoc(doc(db, 'teams', tid, 'logs', l.id), {
          checked: true, coachComment: e.target.coachComment.value, checkedBy: state.profile.name, checkedAt: serverTimestamp(), answers,
        });
        (await import('./homeCoach.js')).dropHomeCache(); // 홈 '답 안 한 질문'을 새로
        m.close();
        journalCheck(el, _p, date);
      } catch (err) { fail(err); }
    };
  }));
}

// ───────── 일지 몰아보기 (지도자): 기간 · 선수 · 종류 · 상태를 골라 여러 일지를 위아래로 쭉 — 날짜별로 묶거나 선수별로 묶어 봄 ─────────
let rollF = null; // 이 화면을 다시 열면 고른 조건 그대로 (새로고침하면 처음부터)
export async function journalRoll(el) {
  const tid = state.team.id;
  const ms = await getDocs(collection(db, 'teams', tid, 'members'));
  const players = ms.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.role === 'player' && m.approved !== false)
    .sort((a, b) => (+a.number || 99) - (+b.number || 99));
  const pOf = Object.fromEntries(players.map((x) => [x.id, x]));
  const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return todayStr(d); };
  const RANGES = [['today', '오늘', 0], ['w', '최근 7일', 6], ['m', '최근 30일', 29], ['q', '최근 3달', 89]];
  let f = rollF || { by: 'date', range: 'w', from: ago(6), to: todayStr(), uid: '', kind: 'all', st: 'all' };
  try { const o = JSON.parse(sessionStorage.getItem('ssaka.roll.uid') || 'null'); sessionStorage.removeItem('ssaka.roll.uid'); if (o) f = { ...f, uid: o, by: 'player', range: 'q', from: ago(89) }; } catch { /* */ }
  el.innerHTML = `${pageHead('JOURNAL ROLL', '일지 몰아보기', '<a class="btn ghost" href="#/journal-check">일지검사로</a>')}
  <section class="card jr-filter">
    <div class="jr-row"><span>묶어 보기</span><div class="seg sm" data-by><button type="button" data-v="date">날짜별</button><button type="button" data-v="player">선수별</button></div></div>
    <div class="jr-row"><span>기간</span><div class="chips" data-range>${RANGES.map(([k, lb]) => `<button type="button" class="chip" data-v="${k}">${lb}</button>`).join('')}</div>
      <div class="jr-dates"><input type="date" data-from max="${todayStr()}"><i>~</i><input type="date" data-to max="${todayStr()}"></div></div>
    <div class="jr-row"><span>선수</span><select data-uid><option value="">전체 선수 (${players.length}명)</option>${players.map((x) => `<option value="${esc(x.id)}">${x.number ? `${esc(x.number)} ` : ''}${esc(x.name)}</option>`).join('')}</select></div>
    <div class="jr-row"><span>종류</span><div class="chips" data-kind>${[['all', '전체'], ['train', '훈련'], ['match', '경기']].map(([k, lb]) => `<button type="button" class="chip" data-v="${k}">${lb}</button>`).join('')}</div></div>
    <div class="jr-row"><span>상태</span><div class="chips" data-st>${[['all', '전체'], ['wait', '검사 대기'], ['done', '검사 완료'], ['draft', '작성 중']].map(([k, lb]) => `<button type="button" class="chip" data-v="${k}">${lb}</button>`).join('')}</div></div>
  </section>
  <div class="jr-sum"><p data-jrsum class="muted"></p><button type="button" class="btn sm ghost" data-jrpdf disabled>보이는 일지 PDF로</button></div>
  <div class="jr-jump" data-jump></div>
  <div class="jr-list" data-list><p class="muted center">불러오는 중…</p></div>`;
  const $ = (q) => el.querySelector(q);
  let logs = []; let shown = []; let loadedKey = ''; let seq = 0; // seq: 조건을 빨리 바꿔도 마지막 것만 그림
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return; io.unobserve(e.target); bindDayPage(e.target, shown[+e.target.dataset.ri], true);
  }), { rootMargin: '600px 0px' }) : null;
  state.cleanup.push(() => io?.disconnect());
  const syncUi = () => {
    $('[data-by]').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === f.by));
    [['[data-range]', f.range], ['[data-kind]', f.kind], ['[data-st]', f.st]].forEach(([q, v]) => $(q).querySelectorAll('.chip').forEach((b) => b.classList.toggle('active', b.dataset.v === v)));
    $('[data-from]').value = f.from; $('[data-to]').value = f.to; $('[data-uid]').value = f.uid;
  };
  const stOf = (x) => (!x.submitted ? 'draft' : x.checked ? 'done' : 'wait');
  // 읽기: 선수 한 명이면 그 선수 일지 전부에서 기간만 · 전체면 기간으로 (최대 600개)
  const load = async () => {
    const key = `${f.uid}|${f.uid ? '' : `${f.from}~${f.to}`}`;
    if (key === loadedKey) return true;
    const my = seq;
    $('[data-list]').innerHTML = '<p class="muted center">불러오는 중…</p>';
    const snap = f.uid
      ? await getDocs(query(collection(db, 'teams', tid, 'logs'), where('uid', '==', f.uid), orderBy('date', 'desc'), limit(400)))
      : await getDocs(query(collection(db, 'teams', tid, 'logs'), where('date', '>=', f.from), where('date', '<=', f.to), limit(600)));
    if (my !== seq) return false;
    logs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.date && (pOf[x.uid] || f.uid));
    loadedKey = key;
    return true;
  };
  const draw = async () => {
    rollF = f; syncUi(); seq += 1; const my = seq;
    try { if (!(await load()) || my !== seq) return; } catch (err) { if (my === seq) { $('[data-list]').innerHTML = ''; fail(err); } return; }
    io?.disconnect();
    shown = logs.filter((x) => x.date >= f.from && x.date <= f.to && (f.kind === 'all' || jKind(x) === f.kind) && (f.st === 'all' || stOf(x) === f.st));
    const num = (x) => +pOf[x.uid]?.number || 99;
    shown.sort(f.by === 'date' ? (a, b) => b.date.localeCompare(a.date) || num(a) - num(b) : (a, b) => num(a) - num(b) || (pOf[a.uid]?.name || '').localeCompare(pOf[b.uid]?.name || '') || b.date.localeCompare(a.date));
    const gk = (x) => (f.by === 'date' ? x.date : x.uid);
    const groups = [];
    shown.forEach((x, i) => { const k = gk(x); if (groups.at(-1)?.k !== k) groups.push({ k, items: [] }); groups.at(-1).items.push([x, i]); });
    const gTitle = (g) => { if (f.by === 'date') { const d = new Date(`${g.k}T00:00`); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`; } const pp = pOf[g.k] || {}; return `${pp.number ? `${esc(pp.number)} ` : ''}${esc(pp.name || g.items[0][0].name || '선수')}`; };
    const who = (x) => { const pp = pOf[x.uid] || {}; return `<div class="jr-who">${avatar(pp.photo, pp.name || x.name, 'sm')}<b>${pp.number ? `<span class="num">${esc(pp.number)}</span> ` : ''}${esc(pp.name || x.name || '')}</b><small>${esc(pp.position || '')}</small><span class="jbadge ${stOf(x) === 'wait' ? 'sent' : stOf(x)}">${{ wait: '검사 대기', done: '검사 완료', draft: '작성 중' }[stOf(x)]}</span></div>`; };
    const wrote = new Set(shown.map((x) => x.uid));
    $('[data-jrsum]').innerHTML = shown.length ? `일지 <b>${shown.length}개</b> · 선수 <b>${wrote.size}명</b>${f.by === 'date' ? ` · 날짜 <b>${groups.length}일</b>` : ''}${!f.uid && logs.length >= 600 ? ' · <span class="warn">너무 많아서 600개까지만 불러왔어요 — 기간을 줄여 주세요</span>' : ''}` : '';
    $('[data-jrpdf]').disabled = !shown.length;
    $('[data-jump]').innerHTML = groups.length > 1 ? groups.map((g, gi) => `<button type="button" class="chip" data-g="${gi}">${f.by === 'date' ? `${+g.k.slice(5, 7)}/${+g.k.slice(8)}` : gTitle(g)} <b>${g.items.length}</b></button>`).join('') : '';
    $('[data-list]').innerHTML = shown.length ? groups.map((g, gi) => `<section class="jr-group" data-gi="${gi}"><h3 class="jr-gh">${gTitle(g)} <small>${g.items.length}개${f.by === 'date' ? ` · ${players.length - new Set(g.items.map(([x]) => x.uid)).size ? `안 쓴 선수 ${players.length - new Set(g.items.map(([x]) => x.uid)).size}명` : '모두 씀'}` : ''}</small></h3>
      ${g.items.map(([x, i]) => `<article class="jb-page roll" data-ri="${i}">${dayPageHtml(x, true, f.by === 'date' ? who(x) : '')}</article>`).join('')}</section>`).join('')
      : `<p class="muted center">${f.uid || f.kind !== 'all' || f.st !== 'all' ? '이 조건에 맞는 일지가 없어요.' : '이 기간에 쓴 일지가 없어요.'}</p>`;
    $('[data-list]').querySelectorAll('[data-ri]').forEach((a) => (io ? io.observe(a) : bindDayPage(a, shown[+a.dataset.ri], true)));
    $('[data-jump]').querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => el.querySelector(`[data-gi="${b.dataset.g}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  };
  $('[data-by]').querySelectorAll('button').forEach((b) => (b.onclick = () => { f = { ...f, by: b.dataset.v }; draw(); }));
  $('[data-range]').querySelectorAll('.chip').forEach((b) => (b.onclick = () => { const n = RANGES.find((r) => r[0] === b.dataset.v)[2]; f = { ...f, range: b.dataset.v, from: ago(n), to: todayStr() }; draw(); }));
  [['[data-from]', 'from'], ['[data-to]', 'to']].forEach(([q, k]) => ($(q).onchange = (e) => { if (!e.target.value) return; f = { ...f, [k]: e.target.value, range: '' }; if (f.from > f.to) f = { ...f, from: f.to, to: f.from }; draw(); }));
  $('[data-uid]').onchange = (e) => { f = { ...f, uid: e.target.value }; draw(); };
  $('[data-kind]').querySelectorAll('.chip').forEach((b) => (b.onclick = () => { f = { ...f, kind: b.dataset.v }; draw(); }));
  $('[data-st]').querySelectorAll('.chip').forEach((b) => (b.onclick = () => { f = { ...f, st: b.dataset.v }; draw(); }));
  $('[data-jrpdf]').onclick = async () => { if (shown.length > 60 && !(await confirmBox(`일지 ${shown.length}개를 PDF로 만들면 시간이 걸려요. 계속할까요?`))) return; saveJournalsPdf(shown); };
  draw();
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
  const sleep = sleepOf(x);
  const body = [x.condition && ['컨디션', `${x.condition} / 5 ${CONDITION[x.condition] ? `(${CONDITION[x.condition]})` : ''}`],
    sleep && ['수면', `${sleepLong(sleep)}${x.bedtime ? ` · ${x.bedtime} ~ ${x.wakeTime || ''}` : ''}`],
    x.hurt ? ['오늘 부상', `${HURT[x.hurt]}${x.hurtWhen ? ` · ${x.hurtWhen}` : ''}`] : x.rpe && ['운동 강도(RPE)', `${x.rpe} / 10`], x.injury != null && ['통증 · 부상', x.injury ? `${x.injury} / 10` : '없음']].filter(Boolean);
  return `<article class="pdf-page">
    <header class="pdf-head"><span class="pdf-brand">SSAKA MANAGER</span><span>${esc(state.profile?.name || '')}${state.team ? ` · ${esc(state.team.name)}` : ''} · ${todayStr()} 저장</span></header>
    <h1>${isCoach() && x.name ? `${esc(x.name)} · ` : ''}${x.date.slice(0, 4)}년 ${fmtDay(x.date)} · ${k === 'match' ? `경기 일지${x.match?.opponent ? ` vs ${esc(x.match.opponent)}` : ''}` : '훈련 일지'}</h1>
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
      wrap.querySelectorAll('[data-view-spad]').forEach((box) => { const sp = x.sessions?.[box.dataset.viewSpad]?.pad; if (sp) createPad(box, sp, { editable: false }); });
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
