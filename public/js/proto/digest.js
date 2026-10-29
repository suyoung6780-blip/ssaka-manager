// 시제품 3.0: 자동 정리 리포트 — 한 선수의 훈련일지 · 성장 자기평가 · 코치 피드백 · 키/몸무게를 모아 문장으로 정리
// 돈 드는 AI(API)는 쓰지 않음: 숫자 흐름 · 자주 쓴 말 · 자기평가와 코치 점수 차이를 규칙으로 계산 (브라우저 안에서만)
import { esc } from '../ui.js';
import * as I from './idp.js';

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const dstr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// 받침 보고 조사 고르기 (패스가 · 압박이 · 패스를 · 압박을)
const jong = (w) => { const c = String(w).trim().slice(-1).charCodeAt(0); return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : false; };
const jo = (w, a, b) => `${w}${jong(w.replace(/<[^>]+>/g, '')) ? a : b}`;
const sign = (v, f = 1) => (v > 0 ? `+${v.toFixed(f)}` : v.toFixed(f));

// ── 자주 쓴 말: 조사 · 어미를 떼고 2글자 이상 낱말만 셈 ──
const STOP = new Set(['오늘', '그리고', '그래서', '조금', '많이', '너무', '정말', '진짜', '다음', '이번', '했다', '했어요', '했음', '있었다', '없었다', '같다', '같아요', '하는', '하기', '해서', '하고', '된다', '됐다', '있다', '없다', '것', '때', '더', '잘', '못', '안', '좀', '제가', '나는', '내가', '우리', '훈련', '경기']);
const TAIL = ['에서는', '에서', '으로', '에게', '한테', '까지', '부터', '처럼', '보다', '이랑', '하고', '하는', '하기', '해서', '했다', '했고', '했어요', '했음', '입니다', '이다', '은', '는', '이', '가', '을', '를', '에', '로', '도', '만', '과', '와', '의', '랑'];
function words(t) {
  return String(t || '').replace(/[^0-9a-zA-Z가-힣\s]/g, ' ').split(/\s+/).map((w) => {
    let x = w.trim();
    for (const s of TAIL) if (x.length > s.length + 1 && x.endsWith(s)) { x = x.slice(0, -s.length); break; }
    return x;
  }).filter((x) => x.length >= 2 && !STOP.has(x) && !/^\d+$/.test(x));
}
function topWords(texts, n = 4) {
  const c = new Map();
  texts.forEach((t) => new Set(words(t)).forEach((w) => c.set(w, (c.get(w) || 0) + 1)));
  return [...c.entries()].filter(([, k]) => k >= 2).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w, k]) => ({ w, k }));
}
// 일지 한 장의 글: 훈련(세션)별 잘된 점 · 어려웠던 점 · 다음엔 + 예전 형식
function logTexts(l) {
  const good = []; const hard = []; const next = [];
  Object.values(l.sessions || {}).forEach((s) => { if (s?.good) good.push(s.good); if (s?.hard) hard.push(s.hard); if (s?.next) next.push(s.next); });
  if (l.good) good.push(l.good); if (l.improve) hard.push(l.improve); if (l.tomorrow) next.push(l.tomorrow);
  if (l.match) { if (l.match.good) good.push(l.match.good); if (l.match.bad || l.match.hard) hard.push(l.match.bad || l.match.hard); if (l.match.next) next.push(l.match.next); }
  return { good, hard, next };
}

// 키 · 몸무게: 자기평가(매달) → 일지 → 프로필 순서로 가장 최근 값 · 달마다 흐름
export function bodyOf(idpList, logs, member) {
  const pts = [];
  idpList.forEach((d) => { if (d.body?.h || d.body?.w) pts.push({ ym: d.month, h: +d.body.h || null, w: +d.body.w || null, src: 'idp' }); });
  logs.forEach((l) => { if (l.height || l.weight) pts.push({ ym: (l.date || '').slice(0, 7), h: +l.height || null, w: +l.weight || null, src: 'log', date: l.date }); });
  const byM = new Map();
  pts.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : a.src === 'idp' ? 1 : -1)).forEach((p) => { const o = byM.get(p.ym) || {}; byM.set(p.ym, { ym: p.ym, h: p.h ?? o.h ?? null, w: p.w ?? o.w ?? null }); });
  const months = [...byM.values()].sort((a, b) => (a.ym < b.ym ? -1 : 1));
  const lastH = [...months].reverse().find((m) => m.h)?.h ?? (+member?.height || null);
  const lastW = [...months].reverse().find((m) => m.w)?.w ?? (+member?.weight || null);
  const firstH = months.find((m) => m.h); const firstW = months.find((m) => m.w);
  return { months, h: lastH, w: lastW, dh: firstH && lastH ? +(lastH - firstH.h).toFixed(1) : null, dw: firstW && lastW ? +(lastW - firstW.w).toFixed(1) : null, since: months[0]?.ym || null };
}

// 리포트 만들기 · ym: 기준 달(없으면 오늘 기준 최근 30일)
export function buildDigest({ logs = [], idpList = [], member = {}, ym = null }) {
  const end = ym ? new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0) : new Date();
  const start = ym ? new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1) : new Date(end.getTime() - 29 * 864e5);
  const pStart = new Date(start.getTime() - (end - start) - 864e5);
  const S = dstr(start); const E = dstr(end); const PS = dstr(pStart);
  const cur = logs.filter((l) => l.date >= S && l.date <= E);
  const prev = logs.filter((l) => l.date >= PS && l.date < S);
  const condC = avg(cur.map((l) => +l.condition).filter(Boolean)); const condP = avg(prev.map((l) => +l.condition).filter(Boolean));
  const sleepC = avg(cur.map((l) => +l.sleep).filter(Boolean));
  const rpeC = avg(cur.map((l) => +l.rpe).filter(Boolean));
  const mins = cur.reduce((a, l) => a + (+l.trainMin || 0), 0);
  const hurts = cur.filter((l) => l.hurt || +l.injury > 0).length;
  const T = { good: [], hard: [], next: [] };
  cur.forEach((l) => { const t = logTexts(l); T.good.push(...t.good); T.hard.push(...t.hard); T.next.push(...t.next); });
  const kwGood = topWords(T.good); const kwHard = topWords(T.hard); const kwNext = topWords(T.next, 3);
  // 코치 피드백: 일지 코치 한마디 · 질문 답 · 성장 평가 확정 이유 · 이번 달 한마디
  const fb = [];
  cur.filter((l) => l.coachComment).forEach((l) => fb.push({ at: l.date, t: l.coachComment, from: '일지' }));
  cur.forEach((l) => Object.values(l.answers || {}).forEach((a) => { if (a?.text) fb.push({ at: l.date, t: a.text, from: '질문 답' }); }));
  const conf = idpList.filter((d) => d.status === 'confirmed');
  const mDoc = ym ? idpList.find((d) => d.month === ym) : conf[conf.length - 1];
  if (mDoc?.coach?.feedback) fb.push({ at: mDoc.month, t: mDoc.coach.feedback, from: '성장 평가' });
  if (mDoc?.coach?.goalHint?.text) fb.push({ at: mDoc.month, t: `다음 달 목표 · ${mDoc.coach.goalHint.text}`, from: '목표 추천' });
  Object.entries(mDoc?.coach?.reasons || {}).forEach(([ab, r]) => { if (r) fb.push({ at: mDoc.month, t: `${I.hexOf(mDoc.pg).find((a) => a.id === ab)?.l || ab}: ${r}`, from: '점수 이유' }); });
  fb.sort((a, b) => (a.at < b.at ? 1 : -1));
  // 자기평가 vs 코치: 차이가 큰 능력
  let gap = null;
  if (mDoc?.coach?.scores) {
    const self = I.draftScores(mDoc);
    I.hexOf(mDoc.pg).forEach((a) => { const s = self[a.id]; const c = mDoc.coach.scores[a.id]; if (s == null || c == null) return; const d = s - c; if (!gap || Math.abs(d) > Math.abs(gap.d)) gap = { l: a.l, s, c, d }; });
    if (gap && Math.abs(gap.d) < 1) gap = null;
  }
  // OVR 흐름 (확정만)
  const series = conf.filter((d) => d.pg === conf[conf.length - 1]?.pg).slice(-3).map((d) => ({ ym: d.month, v: I.ovrOf(d) })).filter((x) => x.v != null);
  const body = bodyOf(idpList, logs, member);
  // 문장 만들기
  const lines = [];
  if (cur.length) lines.push(`일지 <b>${cur.length}번</b> 썼어요${condC != null ? ` · 평균 컨디션 <b>${condC.toFixed(1)}</b>${condP != null ? ` (그 전보다 ${sign(condC - condP)})` : ''}` : ''}${sleepC != null ? ` · 수면 <b>${sleepC.toFixed(1)}시간</b>` : ''}${mins ? ` · 훈련 <b>${mins}분</b>` : ''}.`);
  else lines.push('이 기간에 쓴 훈련일지가 없어요.');
  if (kwGood.length) lines.push(`잘된 점에 ${jo(`<b>${kwGood.map((x) => esc(x.w)).join(' · ')}</b>`, '이', '가')} 자주 나와요.`);
  if (kwHard.length) lines.push(`어려웠던 점은 <b>${kwHard.map((x) => esc(x.w)).join(' · ')}</b> 쪽이 많아요${kwNext.length ? ` — 다음엔 ${jo(`<b>${kwNext.map((x) => esc(x.w)).join(' · ')}</b>`, '을', '를')} 신경 쓰겠다고 적었어요` : ''}.`);
  if (hurts) lines.push(`아프다고 적은 날이 <b>${hurts}일</b> 있어요.`);
  if (series.length >= 2) { const d = series[series.length - 1].v - series[0].v; lines.push(`OVR은 ${series.map((x) => `${I.ymLabel(x.ym)} ${x.v}`).join(' → ')} (${d > 0 ? '+' : ''}${d})로 ${d > 0 ? '오르고 있어요' : d < 0 ? '내려갔어요' : '그대로예요'}.`); }
  if (gap) lines.push(`자기평가에서 ${jo(`<b>${esc(gap.l)}</b>`, '을', '를')} 코치 점수보다 ${gap.d > 0 ? '높게' : '낮게'} 봤어요 (내 답 ${gap.s} · 코치 ${gap.c}).`);
  if (body.h || body.w) lines.push(`키 <b>${body.h ?? '-'}cm</b> · 몸무게 <b>${body.w ?? '-'}kg</b>${body.since && (body.dh || body.dw) ? ` (${I.ymLabel(body.since)}부터 ${body.dh ? `키 ${sign(body.dh)}cm` : ''}${body.dh && body.dw ? ' · ' : ''}${body.dw ? `몸무게 ${sign(body.dw)}kg` : ''})` : ''}.`);
  return { range: [S, E], logs: cur.length, condC, condP, sleepC, rpeC, mins, hurts, kwGood, kwHard, kwNext, fb, gap, series, body, lines };
}

// 화면 조각: full=false면 홈용 짧은 판 (문장 3줄 + 코치 한마디 1개)
export function digestHtml(dg, { full = true, title = '자동 정리', sub = '' } = {}) {
  const lines = full ? dg.lines : dg.lines.slice(0, 3);
  const fb = dg.fb.slice(0, full ? 4 : 1);
  const chips = (arr, cls) => arr.map((x) => `<span class="dg-chip ${cls}">${esc(x.w)}<i>${x.k}</i></span>`).join('');
  return `<section class="dg ${full ? '' : 'dg-mini'}">
    <div class="dg-h"><b>${title}</b><small>${sub || '일지 · 자기평가 · 코치 피드백을 모아 정리했어요 · 무료 자동 정리 (점수를 바꾸지 않아요)'}</small></div>
    <ul class="dg-lines">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
    ${full && (dg.kwGood.length || dg.kwHard.length) ? `<div class="dg-kw">${dg.kwGood.length ? `<div><small>잘된 점</small>${chips(dg.kwGood, 'g')}</div>` : ''}${dg.kwHard.length ? `<div><small>어려웠던 점</small>${chips(dg.kwHard, 'h')}</div>` : ''}</div>` : ''}
    ${fb.length ? `<div class="dg-fb"><small>코치 피드백</small>${fb.map((f) => `<p><em>${esc(f.from)}</em>${esc(f.t)}</p>`).join('')}</div>` : ''}
  </section>`;
}
