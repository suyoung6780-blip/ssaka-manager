// 데이터실 — 선수들이 매일 적은 오늘 기록(컨디션 · 자각도 · 수면 · 부상 …)을 그래프 · 표로 한눈에
// + AI 컨디션 리포트: 최근 7일 vs 4주 데이터를 보고 바로 분석 (훈련 부하 급증 · 강도 · 부상 위험 · 수면 · 컨디션)
// 코치: 팀 전체 + 선수별 / 선수: 내 기록만
import { db, collection, query, where, orderBy, limit, getDocs } from '../fb.js';
import { esc, pageHead, empty, todayStr } from '../ui.js';
import { state, isCoach } from '../store.js';
import { sleepOf } from '../sleep.js';

// [키, 이름, 최대, 좋고 나쁨(good: 높을수록 좋음 · bad: 높을수록 나쁨 · '' 중립), 단위]
const METRICS = [
  ['condition', '컨디션', 5, 'good', '/5'],
  ['rpe', '자각도(RPE)', 10, '', '/10'],
  ['sleep', '수면 시간', 720, 'good', '분'],
  ['sleepQ', '수면 질', 5, 'good', '/5'],
  ['trainMin', '훈련 시간', null, '', '분'],
  ['load', '훈련 부하', null, '', ''],
  ['injury', '부상도', 10, 'bad', '/10'],
];
const RANGES = [[7, '7일'], [14, '14일'], [30, '30일'], [60, '60일']];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => ymd(new Date(new Date(`${s}T00:00`).getTime() + n * 864e5));
const dayList = (from, to) => { const out = []; for (let d = new Date(`${from}T00:00`); ymd(d) <= to; d.setDate(d.getDate() + 1)) out.push(ymd(d)); return out; };
const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
const val = (l, k) => {
  if (!l) return null;
  if (k === 'sleep') return sleepOf(l);
  if (k === 'load') return num(l.rpe) && num(l.trainMin) != null ? l.rpe * l.trainMin : null;
  return num(l[k]);
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const avg = (a) => { const m = mean(a); return m == null ? null : Math.round(m * 10) / 10; };
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) : 0; };
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`;
const r1 = (v) => Math.round(v * 10) / 10;
const hm = (m) => { const t = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

let range = 14;
let custom = null; // [from, to]
let mode = 'team';
let metric = 'condition';
let who = '';

export async function page(el) {
  const coach = isCoach();
  if (!coach) { mode = 'player'; who = state.user.uid; }
  const to = custom ? custom[1] : todayStr();
  const from = custom ? custom[0] : addDays(to, -(range - 1));
  const from28 = [from, addDays(to, -27)].sort()[0]; // AI 분석은 최근 4주가 필요
  const dates = dayList(from, to);
  const tid = state.team.id;

  let players = [];
  let all = [];
  if (coach) {
    const [ms, ls] = await Promise.all([
      getDocs(collection(db, 'teams', tid, 'members')),
      getDocs(query(collection(db, 'teams', tid, 'logs'), where('date', '>=', from28), where('date', '<=', to), orderBy('date'))),
    ]);
    players = ms.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.role === 'player' && p.approved !== false)
      .sort((a, b) => (+a.number || 99) - (+b.number || 99) || String(a.name).localeCompare(b.name, 'ko'));
    all = ls.docs.map((d) => d.data()).filter((l) => players.some((p) => p.id === l.uid));
  } else {
    const ls = await getDocs(query(collection(db, 'teams', tid, 'logs'), where('uid', '==', state.user.uid), orderBy('date', 'desc'), limit(400)));
    all = ls.docs.map((d) => d.data()).filter((l) => l.date >= from28 && l.date <= to);
    players = [{ id: state.user.uid, name: state.profile?.name || '나' }];
  }
  if (coach && !players.some((p) => p.id === who)) who = players[0]?.id || '';
  const logs = all.filter((l) => l.date >= from);
  const byKey = Object.fromEntries(all.map((l) => [`${l.uid}_${l.date}`, l]));
  // 기록이 하나라도 있는 항목만 (수면 질 · 훈련 시간은 기능을 켠 팀만 있음)
  const mets = METRICS.filter(([k]) => logs.some((l) => val(l, k) != null) || ['condition', 'rpe', 'sleep', 'injury'].includes(k));
  if (!mets.some(([k]) => k === metric)) metric = 'condition';
  const report = Object.fromEntries(players.map((p) => [p.id, analyze(p, byKey, to)]));
  const ctx = { players, logs, dates, byKey, mets, coach, el, report, to };

  el.innerHTML = `${pageHead('DATA ROOM', '데이터실')}
    <div class="dr-bar">
      ${coach ? `<div class="seg">${[['team', '팀 전체'], ['player', '선수별']].map(([k, l]) => `<button class="${k === mode ? 'on' : ''}" data-mode="${k}">${l}</button>`).join('')}</div>` : ''}
      <div class="seg">${RANGES.map(([n, l]) => `<button class="${!custom && n === range ? 'on' : ''}" data-range="${n}">${l}</button>`).join('')}</div>
      <span class="dr-dates"><input type="date" data-from value="${from}" max="${todayStr()}"> ~ <input type="date" data-to value="${to}" max="${todayStr()}"></span>
    </div>
    <div data-body></div>`;

  el.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { mode = b.dataset.mode; page(el); }));
  el.querySelectorAll('[data-range]').forEach((b) => (b.onclick = () => { range = +b.dataset.range; custom = null; page(el); }));
  const setCustom = () => {
    const f = el.querySelector('[data-from]').value;
    const t = el.querySelector('[data-to]').value;
    if (f && t && f <= t && dayList(f, t).length <= 370) { custom = [f, t]; page(el); }
  };
  el.querySelector('[data-from]').onchange = setCustom;
  el.querySelector('[data-to]').onchange = setCustom;

  const body = el.querySelector('[data-body]');
  if (!players.length) { body.innerHTML = empty('아직 팀에 선수가 없어요.'); return; }
  if (mode === 'team') teamView(body, ctx);
  else playerView(body, ctx);
}

// ───────── AI 컨디션 분석 (규칙 기반 — 스포츠과학에서 쓰는 기준) ─────────
// 급성:만성 부하 비율(ACWR) · 자각도 수준 · 훈련 단조로움 · 부상도 · 수면 양/규칙성 · 컨디션 흐름 · 기록 빈도
const GROUPS = [
  ['risk', '🚨 부상 위험', 'high'],
  ['down', '⬇️ 강도 낮추기', 'mid'],
  ['up', '⬆️ 강도 올려도 돼요', 'low'],
  ['sleep', '🌙 수면', 'mid'],
  ['cond', '📉 컨디션', 'mid'],
  ['log', '📝 기록 부족', 'info'],
];
function analyze(p, byKey, to) {
  const d7 = dayList(addDays(to, -6), to).map((d) => byKey[`${p.id}_${d}`]).filter(Boolean);
  const d28 = dayList(addDays(to, -27), to).map((d) => byKey[`${p.id}_${d}`]).filter(Boolean);
  const out = [];
  const add = (g, text, tip, lv = 0) => out.push({ g, text, tip, lv });
  if (!d28.length) { add('log', '최근 4주 동안 기록이 없어요', '오늘 기록을 매일 쓰도록 이야기해 주세요'); return out; }
  // 세션 부하 = 자각도 × 훈련 시간(없으면 60분으로 봄)
  const load = (l) => (num(l.rpe) ? l.rpe * (num(l.trainMin) ?? 60) : null);
  const a7 = mean(d7.map(load).filter((v) => v != null));
  const c28 = mean(d28.map(load).filter((v) => v != null));
  const rpe7 = mean(d7.map((l) => num(l.rpe)).filter((v) => v != null));
  const cond7 = mean(d7.map((l) => num(l.condition)).filter((v) => v != null));
  const inj7 = d7.map((l) => l.injury || 0);
  const parts = d7.filter((l) => (l.injury || 0) > 0 && l.injuryPart).map((l) => l.injuryPart.trim());
  const part = parts.length ? Object.entries(parts.reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0][0] : '';
  const acwr = a7 && c28 && d7.length >= 3 && d28.length >= 8 ? a7 / c28 : null;

  // 부상 위험
  const maxInj = Math.max(0, ...inj7);
  const painDays = inj7.filter((v) => v >= 3).length;
  if (maxInj >= 5) add('risk', `최근 7일 부상도 최고 <b>${maxInj}</b>${part ? ` (${esc(part)})` : ''}`, '훈련 참여 여부를 확인하고, 필요하면 쉬게 하거나 치료를 권해요', 2);
  else if (painDays >= 3) add('risk', `통증(부상도 3 이상)이 7일 중 ${painDays}일 이어져요${part ? ` — ${esc(part)}` : ''}`, '같은 부위 통증이 반복돼요. 부하를 줄이고 상태를 지켜봐요', 1);
  if (acwr && acwr > 1.5 && maxInj > 0) add('risk', `부하가 갑자기 늘었는데(평소의 ${r1(acwr)}배) 통증도 있어요`, '부상으로 이어지기 쉬운 조합이에요. 이번 주는 강도를 확 낮춰요', 2);

  // 강도
  if (acwr && acwr > 1.5) add('down', `최근 7일 훈련 부하가 4주 평균의 <b>${r1(acwr)}배</b>로 급증`, '부하가 1.5배 넘게 갑자기 늘면 부상 위험이 커져요. 강도 · 시간을 줄여요', 1);
  else if (acwr && acwr > 1.3) add('down', `훈련 부하가 평소의 ${r1(acwr)}배로 늘고 있어요`, '조금씩만 늘리고, 회복 훈련을 섞어요');
  else if (rpe7 != null && rpe7 >= 7.5) add('down', `최근 7일 자각도 평균 <b>${r1(rpe7)}</b> — 매번 힘들게 느껴요`, '회복 훈련 · 휴식일을 넣어 주세요');
  const daily = d7.map(load).filter((v) => v != null);
  // 단조로움: 쉬는 날 없이 높은 강도가 매일 비슷하게 (다른 강도 경고가 없을 때만)
  if (!out.some((x) => x.g === 'down') && daily.length >= 6 && sd(daily) > 0 && mean(daily) / sd(daily) > 2.5 && rpe7 >= 6.5) add('down', '매일 비슷한 강도로만 훈련하고 있어요 (단조로움)', '강한 날 · 가벼운 날을 섞으면 피로가 덜 쌓여요');
  if (acwr && acwr < 0.8 && maxInj < 3 && (cond7 ?? 3) >= 3) add('up', `최근 7일 훈련 부하가 평소의 ${r1(acwr)}배로 적어요`, '컨디션이 괜찮아요. 강도를 조금 올려도 돼요');
  else if (rpe7 != null && rpe7 <= 3.5 && d7.length >= 3 && (cond7 ?? 3) >= 3.5) add('up', `자각도 평균 ${r1(rpe7)} — 훈련이 쉽게 느껴져요`, '도전적인 과제나 강도를 더해 봐요');

  // 수면 (청소년 권장 8~10시간 = 480분 이상)
  const sl = d7.map(sleepOf).filter((v) => v != null);
  if (sl.length >= 3) {
    const sAvg = Math.round(mean(sl));
    const sSd = Math.round(sd(sl));
    if (sAvg < 420) add('sleep', `평균 수면 <b>${sAvg}분</b> — 권장(480분 이상)보다 부족`, '잠드는 시간을 30분 당기도록 이야기해 주세요', sAvg < 360 ? 1 : 0);
    if (sSd >= 60) add('sleep', `수면 시간이 일정하지 않아요 (날마다 ±${sSd}분, ${Math.min(...sl)}~${Math.max(...sl)}분)`, '매일 비슷한 시간에 자고 일어나는 게 회복에 좋아요');
    const beds = d7.filter((l) => l.bedtime).map((l) => { const [h, m] = l.bedtime.split(':').map(Number); const t = h * 60 + m; return t < 720 ? t + 1440 : t; });
    if (beds.length >= 3 && sd(beds) >= 60 && sSd < 60) add('sleep', `잠드는 시간이 들쭉날쭉해요 (${hm(Math.min(...beds))} ~ ${hm(Math.max(...beds))})`, '취침 시간을 일정하게 맞춰요');
  }
  // 컨디션 흐름
  const conds = d7.map((l) => num(l.condition)).filter((v) => v != null);
  if (conds.length >= 4) {
    const first = mean(conds.slice(0, Math.floor(conds.length / 2)));
    const last = mean(conds.slice(-2));
    if (first - last >= 1) add('cond', `컨디션이 떨어지고 있어요 (${r1(first)} → ${r1(last)})`, '피로 · 고민이 있는지 대화해 보세요', 1);
    else if (cond7 <= 2.5) add('cond', `최근 컨디션 평균 ${r1(cond7)} / 5 로 낮아요`, '휴식 · 수면 · 식사를 챙겨 주세요');
  }
  // 기록 부족
  if (d7.length < 4) add('log', `최근 7일 중 ${d7.length}일만 기록했어요`, '매일 기록해야 분석이 정확해요');
  return out;
}
// 선수 본인 화면에서는 '나에게 하는 말'로
const ME_TIP = {
  '오늘 기록을 매일 쓰도록 이야기해 주세요': '오늘 기록을 매일 써 주세요',
  '훈련 참여 여부를 확인하고, 필요하면 쉬게 하거나 치료를 권해요': '무리하지 말고 코치님께 꼭 말씀드리고, 필요하면 치료를 받아요',
  '같은 부위 통증이 반복돼요. 부하를 줄이고 상태를 지켜봐요': '같은 곳이 계속 아파요. 코치님께 알리고 무리하지 마세요',
  '부상으로 이어지기 쉬운 조합이에요. 이번 주는 강도를 확 낮춰요': '부상으로 이어지기 쉬워요. 코치님과 이번 주 훈련량을 상의해요',
  '부하가 1.5배 넘게 갑자기 늘면 부상 위험이 커져요. 강도 · 시간을 줄여요': '갑자기 많이 늘면 다치기 쉬워요. 회복 · 스트레칭을 꼭 챙겨요',
  '조금씩만 늘리고, 회복 훈련을 섞어요': '스트레칭 · 수면으로 회복을 챙겨요',
  '회복 훈련 · 휴식일을 넣어 주세요': '힘든 게 계속되면 코치님께 말씀드려요',
  '강한 날 · 가벼운 날을 섞으면 피로가 덜 쌓여요': '쉬는 날엔 확실히 쉬어요',
  '컨디션이 괜찮아요. 강도를 조금 올려도 돼요': '컨디션이 좋아요. 훈련에서 한 단계 더 도전해 봐요',
  '도전적인 과제나 강도를 더해 봐요': '훈련에서 한 단계 더 도전해 봐요',
  '잠드는 시간을 30분 당기도록 이야기해 주세요': '오늘부터 30분 일찍 자 봐요',
  '매일 비슷한 시간에 자고 일어나는 게 회복에 좋아요': '매일 비슷한 시간에 자고 일어나 봐요',
  '취침 시간을 일정하게 맞춰요': '잠드는 시간을 매일 비슷하게 맞춰 봐요',
  '피로 · 고민이 있는지 대화해 보세요': '힘든 일이 있으면 상담실에서 코치님께 이야기해요',
  '휴식 · 수면 · 식사를 챙겨 주세요': '잘 자고 잘 먹고 충분히 쉬어요',
  '매일 기록해야 분석이 정확해요': '매일 기록해야 분석이 정확해요',
};
const levelOf = (items) => (items.some((x) => x.g === 'risk' || x.lv >= 2) ? 'high' : items.some((x) => ['down', 'sleep', 'cond'].includes(x.g)) ? 'mid' : items.some((x) => x.g === 'log') ? 'info' : 'good');
const LEVEL = { high: ['위험', '#ff453a'], mid: ['주의', '#ff9f0a'], info: ['기록 부족', '#8e8e93'], good: ['좋음', '#30d158'] };

function aiCard(players, report, to, coach) {
  const total = players.length;
  const lv = Object.fromEntries(players.map((p) => [p.id, levelOf(report[p.id])]));
  const cnt = (k) => players.filter((p) => lv[p.id] === k).length;
  const good = players.filter((p) => lv[p.id] === 'good');
  const head = cnt('high') ? `<b>${cnt('high')}명</b>은 부상 위험 신호가 있어요.` : cnt('mid') ? `부상 위험 신호는 없지만 <b>${cnt('mid')}명</b>은 관리가 필요해요.` : '팀 전체 컨디션이 안정적이에요.';
  return `<section class="card dr-ai">
    <div class="dr-ai-head"><div><span class="eyebrow">AI CONDITION REPORT</span><h3>🤖 AI 컨디션 리포트</h3>
      <p class="muted small">${md(to)} 기준 · 최근 7일을 4주 평균과 비교해서 바로 분석해요</p></div>
      <div class="dr-ai-sum">${['high', 'mid', 'good'].map((k) => `<span style="--c:${LEVEL[k][1]}"><b>${cnt(k)}</b>${LEVEL[k][0]}</span>`).join('')}</div></div>
    <p class="dr-ai-lead">${head} ${good.length && good.length < total ? `<span class="muted">좋음: ${good.map((p) => esc(p.name)).join(', ')}</span>` : ''}</p>
    <div class="dr-ai-groups">${GROUPS.map(([g, title, l]) => {
      const rows = players.flatMap((p) => report[p.id].filter((x) => x.g === g).map((x) => ({ p, x })));
      if (!rows.length) return '';
      return `<div class="dr-ai-g ${l}"><h4>${title} <small>${new Set(rows.map((r) => r.p.id)).size}명</small></h4>
        <ul>${rows.map(({ p, x }) => `<li ${coach ? `data-pl="${p.id}"` : ''}><strong>${esc(p.name)}</strong><span>${x.text}</span><em>→ ${x.tip}</em></li>`).join('')}</ul></div>`;
    }).join('') || '<p class="muted">특별히 살펴볼 선수가 없어요. 👍</p>'}</div>
    <p class="muted small dr-ai-note">훈련 부하(자각도 × 훈련 시간)의 급변(최근 7일 ÷ 4주 평균), 자각도 · 부상도 · 수면(청소년 권장 480분 이상) · 컨디션 흐름을 기준으로 자동 분석해요. 최종 판단은 코치님이 선수와 이야기해서 정해 주세요.</p>
  </section>`;
}

// ───────── 팀 전체 ─────────
function teamView(box, ctx) {
  const { players, logs, dates, byKey, mets, report, to, coach } = ctx;
  const [, label, max, tone, unit] = METRICS.find(([k]) => k === metric);
  const daily = dates.map((d) => avg(logs.filter((l) => l.date === d).map((l) => val(l, metric)).filter((v) => v != null)));
  const last7 = dayList(addDays(to, -6), to);

  box.innerHTML = `
    ${aiCard(players, report, to, coach)}
    <h3 class="dr-h">선수 상태 <small class="muted">최근 7일 평균 · 누르면 자세히</small></h3>
    <div class="dr-players">${players.map((p) => {
      const l7 = last7.map((d) => byKey[`${p.id}_${d}`]).filter(Boolean);
      const a = (k) => avg(l7.map((l) => val(l, k)).filter((v) => v != null));
      const lv = levelOf(report[p.id]);
      const s = a('sleep');
      return `<article class="dr-pc" data-pl="${p.id}" style="--c:${LEVEL[lv][1]}">
        <header><strong>${p.number ? `<i>${esc(p.number)}</i>` : ''}${esc(p.name)}</strong><span class="dr-badge">${LEVEL[lv][0]}</span></header>
        <div class="dr-pc-m"><div><small>컨디션</small><b>${a('condition') ?? '-'}</b></div><div><small>자각도</small><b>${a('rpe') ?? '-'}</b></div>
          <div><small>수면</small><b>${s == null ? '-' : `${Math.round(s)}<i>분</i>`}</b></div><div class="${(a('injury') || 0) >= 3 ? 'hot' : ''}"><small>부상도</small><b>${a('injury') ?? '-'}</b></div></div>
        ${sparkline(dates.map((d) => val(byKey[`${p.id}_${d}`], 'condition')), 5)}
        ${report[p.id][0] ? `<p class="dr-pc-why">${report[p.id][0].text}</p>` : '<p class="dr-pc-why ok">특이사항 없음</p>'}
      </article>`;
    }).join('')}</div>
    <h3 class="dr-h">항목별 그래프</h3>
    <div class="chips wrap">${mets.map(([k, l]) => `<button class="chip ${k === metric ? 'on' : ''}" data-met="${k}">${l}</button>`).join('')}</div>
    <section class="card"><h3>${label} <small class="muted">날짜별 팀 평균</small></h3>
      ${lineChart(dates, [{ pts: daily, color: '#4ea1ff', fill: true }], max)}</section>
    <section class="card"><h3>이름 × 날짜 <small class="muted">${label}</small></h3>
      ${heatTable(players, dates, byKey, metric, max, tone, unit)}
      <p class="muted small">${tone === 'good' ? '초록 = 좋음 · 빨강 = 나쁨' : tone === 'bad' ? '빨강이 진할수록 아파요' : '파랑이 진할수록 높아요'} · 빈칸 = 기록 없음 · 이름을 누르면 그 선수 그래프</p></section>`;
  box.querySelectorAll('[data-met]').forEach((b) => (b.onclick = () => { metric = b.dataset.met; teamView(box, ctx); }));
  box.querySelectorAll('[data-pl]').forEach((c) => (c.onclick = () => { who = c.dataset.pl; mode = 'player'; page(ctx.el); }));
}

// ───────── 선수별 ─────────
function playerView(box, ctx) {
  const { players, logs, dates, byKey, mets, coach, report, to } = ctx;
  const p = players.find((x) => x.id === who) || players[0];
  const mine = dates.map((d) => byKey[`${p.id}_${d}`]);
  const hurts = mine.filter((l) => l && (l.injury || 0) > 0);
  const items = report[p.id];
  const lv = levelOf(items);
  const grp = (g) => GROUPS.find(([k]) => k === g);
  box.innerHTML = `
    ${coach ? `<div class="dr-who"><select data-who>${players.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${x.number ? `${esc(x.number)}. ` : ''}${esc(x.name)}${x.position ? ` · ${esc(x.position)}` : ''}</option>`).join('')}</select>
      <span class="muted small">기록 ${mine.filter(Boolean).length}일 / ${dates.length}일 · 그래프 점선 = 팀 평균</span></div>` : `<p class="muted small">기록 ${mine.filter(Boolean).length}일 / ${dates.length}일</p>`}
    <section class="card dr-ai one" style="--c:${LEVEL[lv][1]}"><span class="eyebrow">AI CONDITION REPORT · ${md(to)} 기준</span>
      <h3>🤖 ${coach ? `${esc(p.name)} 분석` : '내 컨디션 분석'} <span class="dr-badge">${LEVEL[lv][0]}</span></h3>
      ${items.length ? `<ul class="dr-ai-list">${items.map((x) => `<li class="${grp(x.g)[2]}"><span>${grp(x.g)[1]}</span><div>${x.text}<em>→ ${coach ? x.tip : ME_TIP[x.tip] || x.tip}</em></div></li>`).join('')}</ul>`
        : '<p>최근 7일 데이터에서 특별한 위험 신호가 없어요. 지금처럼 꾸준히! 👍</p>'}</section>
    <div class="dr-grid">${mets.map(([k, l, max, , unit]) => {
      const pts = mine.map((x) => val(x, k));
      const a = avg(pts.filter((v) => v != null));
      const series = [{ pts, color: k === 'injury' ? '#ff453a' : '#4ea1ff', fill: true }];
      if (coach) series.push({ pts: dates.map((d) => avg(logs.filter((x) => x.date === d).map((x) => val(x, k)).filter((v) => v != null))), color: 'rgba(160,160,160,.9)', dash: true });
      return `<section class="card"><div class="card-head"><h4>${l}</h4><b class="dr-avg">${a == null ? '-' : k === 'sleep' || k === 'load' || k === 'trainMin' ? Math.round(a) : a}<i>${unit}</i></b></div>${lineChart(dates, series, max, true)}</section>`;
    }).join('')}</div>
    <section class="card"><h3>부상 · 통증 기록</h3>
      ${hurts.length ? `<ul class="list">${hurts.reverse().map((l) => `<li><span>${esc(l.date)}</span><strong class="${l.injury >= 5 ? 'hot' : ''}">부상도 ${l.injury}</strong><span>${esc(l.injuryPart || '')}</span></li>`).join('')}</ul>` : '<p class="muted">이 기간에는 부상 · 통증 기록이 없어요.</p>'}</section>`;
  box.querySelector('[data-who]')?.addEventListener('change', (e) => { who = e.target.value; playerView(box, ctx); });
}

// ───────── 그래프 (SVG) ─────────
function sparkline(pts, max) {
  const n = pts.length; const W = 200; const H = 34;
  const xy = pts.map((v, i) => (v == null ? null : [n === 1 ? W / 2 : (i / (n - 1)) * W, H - 3 - (v / max) * (H - 6)]));
  const segs = []; let cur = [];
  xy.forEach((q) => { if (!q) { if (cur.length) segs.push(cur); cur = []; } else cur.push(q); });
  if (cur.length) segs.push(cur);
  return `<svg class="dr-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${segs.map((s) => (s.length > 1 ? `<polyline points="${s.map((q) => q.join(',')).join(' ')}" fill="none" stroke="var(--c)" stroke-width="2" vector-effect="non-scaling-stroke"/>` : `<circle cx="${s[0][0]}" cy="${s[0][1]}" r="2" fill="var(--c)"/>`)).join('')}</svg>`;
}

function lineChart(dates, series, max, small = false) {
  const W = small ? 380 : 640; const H = small ? 170 : 230; const L = 34; const R = 22; const T = 12; const B = 24;
  const vals = series.flatMap((s) => s.pts).filter((v) => v != null);
  const top = max || Math.max(1, ...vals) * 1.1;
  const n = dates.length;
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const every = Math.ceil(n / (small ? 6 : 10));
  const grid = [0, top / 2, top].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="dr-gl"/><text x="${L - 6}" y="${y(v) + 4}" class="dr-yt">${Math.round(v)}</text>`).join('');
  const xt = dates.map((d, i) => ((i % every === 0 && n - 1 - i >= every / 2) || i === n - 1 ? `<text x="${x(i)}" y="${H - 6}" class="dr-xt">${md(d)}</text>` : '')).join('');
  const lines = series.map((s) => {
    // 기록이 없는 날은 선을 끊음
    const segs = []; let cur = [];
    s.pts.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(i), y(v)]); });
    if (cur.length) segs.push(cur);
    return segs.map((sg) => `${s.fill && sg.length > 1 ? `<path d="M${sg[0][0]} ${y(0)} ${sg.map(([a, b]) => `L${a} ${b}`).join(' ')} L${sg[sg.length - 1][0]} ${y(0)} Z" fill="${s.color}" opacity=".12"/>` : ''}
      <polyline points="${sg.map(([a, b]) => `${a},${b}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.2" ${s.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>
      ${s.dash ? '' : sg.map(([a, b]) => `<circle cx="${a}" cy="${b}" r="${n > 40 ? 1.8 : 3}" fill="${s.color}"/>`).join('')}`).join('');
  }).join('');
  return vals.length ? `<svg class="dr-chart" viewBox="0 0 ${W} ${H}">${grid}${xt}${lines}</svg>` : '<p class="muted small">이 기간에 기록이 없어요.</p>';
}

function heatTable(players, dates, byKey, k, max, tone, unit) {
  const top = max || Math.max(1, ...players.flatMap((p) => dates.map((d) => val(byKey[`${p.id}_${d}`], k))).filter((v) => v != null));
  const color = (v) => {
    // 1부터 시작하는 점수(컨디션 · 수면 질)는 1 = 가장 나쁨 · 수면은 240분 이하 빨강 ~ 540분 이상 초록
    let t = Math.max(0, Math.min(1, ['condition', 'sleepQ'].includes(k) ? (v - 1) / (top - 1) : v / top));
    if (k === 'sleep') t = Math.max(0, Math.min(1, (v - 240) / 300));
    if (tone === 'good') return `hsl(${Math.round(t * 120)} 65% ${30 + t * 8}%)`;
    if (tone === 'bad') return v ? `rgba(255,69,58,${0.2 + t * 0.75})` : 'transparent';
    return `rgba(78,161,255,${0.15 + t * 0.75})`;
  };
  const big = ['sleep', 'load', 'trainMin'].includes(k);
  return `<div class="dr-scroll"><table class="dr-heat ${big ? 'wide' : ''}">
    <thead><tr><th></th>${dates.map((d) => `<th>${md(d)}</th>`).join('')}<th>평균</th></tr></thead>
    <tbody>${players.map((p) => {
      const vs = dates.map((d) => val(byKey[`${p.id}_${d}`], k));
      const a = avg(vs.filter((v) => v != null));
      return `<tr data-pl="${p.id}"><th>${esc(p.name)}</th>${vs.map((v) => `<td style="${v != null ? `background:${color(v)}` : ''}">${v != null ? v : ''}</td>`).join('')}<td class="avg">${a == null ? '-' : big ? Math.round(a) : a}${a != null ? `<i>${unit.startsWith('/') ? '' : unit}</i>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}
