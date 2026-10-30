// 선수 한 명(UID) 기준 연동 — 훈련일지 · 경기 기록 · 목표 · 경기 영상 장면 · 성장 평가를 한 곳에서
// 원칙: 모두 '참고'로 보여 주기만 하고, 성장 평가 점수를 자동으로 바꾸지 않음
import { db, collection, getDocs, query, where } from '../fb.js';
import { state, isCoach } from '../store.js';
import { esc } from '../ui.js';
import { pct, pace } from '../pages/goals.js';
import { sleepOf } from '../sleep.js';
import * as I from './idp.js';

const ymOfDate = (s) => String(s || '').slice(0, 7);
// 경기 기록실: 득점 · 도움에서 이 선수 (UID로 저장된 것 + 예전 기록은 이름이 한 명과만 맞으면)
export function matchesOf(matches, uid, roster) {
  const me = roster.find((m) => m.id === uid);
  const sameName = me ? roster.filter((m) => m.name === me.name).length : 0;
  const mine = (s) => s.uid === uid || (!s.uid && me && sameName === 1 && s.name === me.name);
  return matches.map((m) => {
    const g = (m.scorers || []).filter(mine).reduce((a, s) => a + (+s.goals || 0), 0);
    const as = (m.assists || []).filter(mine).reduce((a, s) => a + (+s.goals || 0), 0);
    return { m, g, a: as };
  }).filter((x) => x.g || x.a);
}
export async function loadLinks(uid, roster) {
  const t = state.team.id;
  const [ls, ms] = await Promise.all([
    getDocs(query(collection(db, 'teams', t, 'logs'), where('uid', '==', uid))).catch(() => null),
    getDocs(collection(db, 'teams', t, 'matches')).catch(() => null),
  ]);
  const logs = ls ? ls.docs.map((d) => d.data()).sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
  const matches = ms ? ms.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  return { logs, mres: matchesOf(matches, uid, roster), games: matches };
}
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
// 연결된 기록 칸 (성장 카드 위쪽)
// opts.tabs: 선수 한눈에 요약 — 누르면 다른 화면 대신 그 칸으로
export function hubHtml({ logs, mres }, goals, evid, uid, opts = {}) {
  const go = (k, href) => (opts.tabs ? `href="javascript:void 0" data-goto="${k}"` : `href="#${href}"`);
  const coach = isCoach();
  const today = new Date(); const from = new Date(today); from.setDate(today.getDate() - 29);
  const f = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
  const l30 = logs.filter((l) => l.date >= f);
  const cond = avg(l30.map((l) => l.condition).filter((v) => v != null));
  const sleep = avg(l30.map((l) => sleepOf(l)).filter((v) => v != null));
  const train = l30.reduce((a, l) => a + (+l.trainMin || 0), 0);
  const lastC = [...logs].reverse().find((l) => l.coachComment);
  // 컨디션 30일 막대
  const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(from); d.setDate(from.getDate() + i); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return logs.find((l) => l.date === k); });
  const condBars = `<div class="lk-cond">${days.map((l) => `<i class="${l ? '' : 'lk-no'}" style="height:${l?.condition ? l.condition * 20 : 6}%" title="${l ? `${l.date} 컨디션 ${l.condition ?? '-'}` : '기록 없음'}"></i>`).join('')}</div>`;
  const year = String(today.getFullYear());
  const yr = mres.filter((x) => (x.m.date || '').startsWith(year));
  const G = yr.reduce((a, x) => a + x.g, 0); const A = yr.reduce((a, x) => a + x.a, 0);
  // 출전 시간: 올해 경기 일지에 적은 출전 시간(분)
  const apps = logs.filter((l) => (l.date || '').startsWith(year) && l.match && l.match.minutes != null && l.match.minutes !== '' && +l.match.minutes > 0);
  const mins = apps.reduce((a, l) => a + +l.match.minutes, 0);
  const doing = goals.filter((g) => (g.status || 'doing') === 'doing');
  const behind = doing.filter((g) => ['behind', 'late'].includes(pace(g).k));
  const posts = [...new Set(evid.map((e) => e.post))];
  return `<section class="card p3-card p3-links"><h3>${opts.tabs ? '최근 30일 한눈에 <small class="muted">칸을 누르면 자세히 · 참고만 — 성장 평가 점수를 자동으로 바꾸지 않아요</small>' : '연결된 기록 <small class="muted">한 사람(UID) 기준으로 모든 기록이 여기 모여요 · 참고만 — 성장 평가 점수를 자동으로 바꾸지 않아요</small>'}</h3>
    <div class="lk-grid">
      <a class="lk" ${go('body', coach ? '/journal-check' : '/daily')}><div class="lk-h"><b>${opts.tabs ? '몸 상태 · 일지' : '훈련일지'}</b><small>최근 30일</small></div>
        <div class="lk-k"><div><strong>${l30.length}<i>일</i></strong><small>작성</small></div><div><strong>${cond == null ? '-' : cond.toFixed(1)}<i>/5</i></strong><small>평균 컨디션</small></div><div><strong>${sleep == null ? '-' : (sleep / 60).toFixed(1)}<i>시간</i></strong><small>평균 수면</small></div><div><strong>${train}<i>분</i></strong><small>훈련 · 경기</small></div></div>
        ${condBars}${lastC ? `<p class="lk-note">코치 한마디 · ${esc(lastC.coachComment)} <small class="muted">${esc(lastC.date)}</small></p>` : ''}</a>
      <a class="lk" ${go('season', '/records')}><div class="lk-h"><b>경기 기록</b><small>${year}년 · 경기 기록실</small></div>
        <div class="lk-k"><div><strong>${G}</strong><small>득점</small></div><div><strong>${A}</strong><small>도움</small></div><div><strong>${mins}<i>분</i></strong><small>출전 ${apps.length}경기</small></div><div><strong>${apps.length ? Math.round(mins / apps.length) : '-'}<i>분</i></strong><small>평균 출전</small></div></div>
        ${yr.length ? `<ul class="lk-list">${[...yr].sort((a, b) => (a.m.date < b.m.date ? 1 : -1)).slice(0, 3).map((x) => `<li><small>${esc((x.m.date || '').slice(5).replace('-', '/'))}</small><span>vs ${esc(x.m.opponent || '')} ${x.m.gf ?? ''}:${x.m.ga ?? ''}</span><b>${x.g ? `${x.g}골` : ''}${x.g && x.a ? ' ' : ''}${x.a ? `${x.a}도움` : ''}</b></li>`).join('')}</ul>` : '<p class="muted small">올해 득점 · 도움 기록이 없어요.</p>'}</a>
      <a class="lk" ${go('goal', '/goals')}><div class="lk-h"><b>목표</b><small>진행 중 ${doing.length}개</small></div>
        <div class="lk-k"><div><strong>${doing.length ? Math.round(avg(doing.map(pct))) : '-'}<i>%</i></strong><small>평균 진행률</small></div><div><strong class="${behind.length ? 'bad' : ''}">${behind.length}</strong><small>뒤처짐</small></div><div><strong>${goals.filter((g) => g.idp).length}</strong><small>IDP 추천 목표</small></div></div>
        ${doing.length ? `<ul class="lk-list">${doing.slice(0, 3).map((g) => `<li><span>${esc(g.title)}</span><b>${pct(g)}%</b><em class="ga-st k-${pace(g).k}">${pace(g).l}</em></li>`).join('')}</ul>` : '<p class="muted small">진행 중인 목표가 없어요.</p>'}</a>
      <a class="lk" href="${posts[0] ? `#/analysis/${esc(posts[0])}` : '#/analysis'}"><div class="lk-h"><b>경기 영상</b><small>확정된 장면</small></div>
        <div class="lk-k"><div><strong>${evid.length}</strong><small>연결 장면</small></div><div><strong>${posts.length}</strong><small>경기</small></div><div><strong>${evid.filter((e) => e.k === 'shot' || e.k === 'goal').length}</strong><small>슈팅 · 득점</small></div></div>
        <p class="muted small">${evid.length ? '필름룸에서 이 선수로 연결한 장면이에요.' : '필름룸 경기 영상에서 우리 팀 기록에 선수를 연결하면 모여요.'}</p></a>
    </div></section>`;
}
// 월별 표 아래: 그 달의 훈련일지 · 경기 기록 (같은 달끼리 나란히)
export function monthLinkRows(months, { logs, mres }) {
  const r = (label, f) => `<tr class="lk-row"><td>${label}</td>${months.map((m) => `<td>${f(m)}</td>`).join('')}<td></td></tr>`;
  const lm = (m) => logs.filter((l) => ymOfDate(l.date) === m);
  return r('훈련일지 작성', (m) => `${lm(m).length}일`)
    + r('평균 컨디션', (m) => { const v = avg(lm(m).map((l) => l.condition).filter((x) => x != null)); return v == null ? '-' : v.toFixed(1); })
    + r('득점 · 도움', (m) => { const x = mres.filter((y) => ymOfDate(y.m.date) === m); const g = x.reduce((a, y) => a + y.g, 0); const a = x.reduce((s, y) => s + y.a, 0); return g || a ? `${g} · ${a}` : '-'; });
}
export const LINKS_TPL = I.TPL_VER;
