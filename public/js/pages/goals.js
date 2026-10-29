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

// 진행률 도넛 (경기 기록실과 같은 모양)
const ring = (p, label) => {
  const R = 44; const C = 2 * Math.PI * R;
  return `<div class="rec-ring-fig"><svg class="rec-donut" viewBox="0 0 110 110" aria-hidden="true"><circle class="bg" r="${R}" cx="55" cy="55"/>${p > 0 ? `<circle class="w" r="${R}" cx="55" cy="55" stroke-dasharray="${(p / 100) * C} ${C}"/>` : ''}</svg>
    <div class="rec-ring-c"><strong>${p}<i>%</i></strong><small>${label}</small></div></div>`;
};
const soon = (g) => g.due && g.status === 'doing' && (() => { const d = Math.round((new Date(`${g.due}T00:00`) - new Date(`${todayStr()}T00:00`)) / 864e5); return d >= 0 && d <= 14; })();
// 위쪽 요약: 도넛 + 달성 / 진행 중 / 미달성 + 분야별 막대
function goalHero(goals, cats, label) {
  const n = (st) => goals.filter((g) => g.status === st).length;
  const near = goals.filter(soon).length;
  return `<section class="rec-hero goal-hero">
    <div class="rec-ring">${ring(avgPct(goals), label)}
      <ul class="rec-legend">
        <li class="w"><i></i><span>달성</span><b>${n('done')}</b><em>${goals.length ? Math.round((n('done') / goals.length) * 100) : 0}%</em></li>
        <li class="d"><i></i><span>진행</span><b>${n('doing')}</b><em>${goals.length ? Math.round((n('doing') / goals.length) * 100) : 0}%</em></li>
        <li class="l"><i></i><span>미달</span><b>${n('miss')}</b><em>${goals.length ? Math.round((n('miss') / goals.length) * 100) : 0}%</em></li>
        <li class="g"><span>목표 ${goals.length}개</span>${near ? `<b class="rec-streak warn">기한 2주 안 ${near}개</b>` : ''}</li>
      </ul>
    </div>
    <div class="rec-kpis goal-cats" style="--n:${Math.max(1, cats.length)}">${cats.map((c) => { const arr = goals.filter((g) => (g.category || cats[0]) === c); const v = avgPct(arr); return `<div class="rk ${arr.length ? '' : 'empty'}"><small>${esc(c)}</small><strong>${arr.length ? `${v}<i>%</i>` : '-'}</strong><div class="rk-prog g"><i style="width:${arr.length ? v : 0}%"></i></div><span>${arr.length ? `달성 <b>${arr.filter((g) => g.status === 'done').length}/${arr.length}</b>` : '목표 없음'}</span></div>`; }).join('')}</div>
  </section>`;
}
const nearList = (goals) => {
  const arr = goals.filter(soon).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6);
  return arr.length ? `<section class="card goal-near"><h3>기한이 가까운 목표</h3><ul>${arr.map((g) => `<li><span class="dday">${dday(g.due)}</span><b>${esc(g.title)}</b><div class="rk-prog g"><i style="width:${pct(g)}%"></i></div><em>${pct(g)}%</em></li>`).join('')}</ul></section>` : '';
};

// ───────── 분석: 진행 속도 (지금 진행률 vs 기간에 비해 와 있어야 할 진행률) ─────────
const PERIOD_DAYS = { 주: 7, 월: 30, 분기: 91, 시즌: 300 };
const msOf = (v) => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : v ? +new Date(v) : 0);
const dueMs = (g) => (g.due ? +new Date(`${g.due}T23:59`) : 0);
function startMs(g) {
  const c = msOf(g.createdAt); const d = dueMs(g);
  if (c && (!d || c < d)) return c;
  return d ? d - (PERIOD_DAYS[g.period] || 30) * 864e5 : 0;
}
export function pace(g) {
  const act = pct(g);
  if (g.status === 'done') return { act: 100, exp: 100, k: 'done', l: '달성' };
  if (g.status === 'miss') return { act, exp: 100, k: 'late', l: '미달성' };
  const d = dueMs(g);
  if (!d) return { act, exp: null, k: 'nodue', l: '기한 없음' };
  const s0 = startMs(g); const now = Date.now();
  if (now > d) return { act, exp: 100, k: 'late', l: '기한 지남' };
  const exp = Math.max(0, Math.min(100, Math.round(((now - s0) / Math.max(1, d - s0)) * 100)));
  const gap = act - exp;
  return { act, exp, k: gap >= 10 ? 'ahead' : gap >= -10 ? 'ok' : 'behind', l: gap >= 10 ? '앞서감' : gap >= -10 ? '순조' : '뒤처짐' };
}
// 진행률 기록 (바뀔 때마다 하루 한 점) → 작은 추세선
const pushHist = (g, next) => { const h = [...(g.hist || [])].filter((x) => x.d !== todayStr()); h.push({ d: todayStr(), v: pct(next) }); return h.slice(-30); };
const spark = (g) => {
  const h = g.hist || []; if (h.length < 2) return '';
  const W = 90; const H = 22;
  const pts = h.map((x, i) => `${((i / (h.length - 1)) * (W - 4) + 2).toFixed(1)},${(H - 2 - (x.v / 100) * (H - 4)).toFixed(1)}`).join(' ');
  return `<svg class="ga-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="진행률 기록"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
};
// 위쪽 숫자 줄
function kpiStrip(goals, label) {
  const ps = goals.map(pace);
  const n = (k) => ps.filter((p) => p.k === k).length;
  const in30 = goals.filter((g) => g.status === 'doing' && g.due && dueMs(g) - Date.now() <= 30 * 864e5 && dueMs(g) >= Date.now()).length;
  return `<section class="ga-kpis">
    <div class="ga-k main">${ring(avgPct(goals), label)}</div>
    <div class="ga-k"><small>달성</small><strong>${n('done')}<i>/${goals.length}</i></strong><span>${goals.length ? Math.round((n('done') / goals.length) * 100) : 0}% 달성</span></div>
    <div class="ga-k ok"><small>순조 · 앞서감</small><strong>${n('ok') + n('ahead')}</strong><span>기간에 맞게 가는 목표</span></div>
    <div class="ga-k bad"><small>뒤처짐 · 기한 지남</small><strong>${n('behind') + n('late')}</strong><span>${n('behind') + n('late') ? '아래 진행 속도에서 확인' : '없어요'}</span></div>
    <div class="ga-k"><small>30일 안 마감</small><strong>${in30}</strong><span>${goals.filter((g) => g.status === 'doing' && !g.due).length ? `기한 없는 목표 ${goals.filter((g) => g.status === 'doing' && !g.due).length}개` : '진행 중 목표 기준'}</span></div>
  </section>`;
}
// 진행 속도: 막대 = 지금 진행률 · 세로선 = 지금쯤 와 있어야 할 곳
function paceChart(goals, title = '진행 속도') {
  const list = goals.filter((g) => g.status !== 'done').map((g) => ({ g, p: pace(g) })).sort((a, b) => ({ late: 0, behind: 1, ok: 2, ahead: 3, nodue: 4 }[a.p.k] - { late: 0, behind: 1, ok: 2, ahead: 3, nodue: 4 }[b.p.k]));
  if (!list.length) return '';
  return `<section class="card ga-card"><div class="ga-h"><h3>${title}</h3><small class="muted">막대 = 지금 진행률 · <i class="ga-mk"></i> = 기간으로 보면 지금쯤 와 있어야 할 곳 · 뒤처진 목표가 위로</small></div>
    <ul class="ga-pace">${list.map(({ g, p }) => `<li class="k-${p.k}"><div class="ga-pt"><b>${esc(g.title)}</b><small>${esc(g.category || '')}${g.ownerName && g.scope === 'personal' ? ` · ${esc(g.ownerName)}` : ''}</small></div>
      <div class="ga-track"><i class="ga-fill" style="width:${p.act}%"></i>${p.exp != null ? `<i class="ga-exp" style="left:${p.exp}%"></i>` : ''}</div>
      <div class="ga-pv"><b>${p.act}%</b>${p.exp != null ? `<small>지금쯤 ${p.exp}%</small>` : ''}</div>
      <span class="ga-st k-${p.k}">${p.l}</span><span class="ga-dd">${g.due ? dday(g.due) : ''}</span></li>`).join('')}</ul></section>`;
}
// 분야별
function catChart(goals, cats) {
  const rows = cats.map((c) => { const arr = goals.filter((g) => (g.category || cats[0]) === c); return { c, arr, v: avgPct(arr), done: arr.filter((g) => g.status === 'done').length, bad: arr.filter((g) => ['behind', 'late'].includes(pace(g).k)).length }; }).filter((r) => r.arr.length);
  if (!rows.length) return '';
  return `<section class="card ga-card"><div class="ga-h"><h3>분야별</h3><small class="muted">평균 진행률 · 달성 · 뒤처짐</small></div>
    <ul class="ga-cat">${rows.map((r) => `<li><span>${esc(r.c)}</span><div class="ga-track"><i class="ga-fill" style="width:${r.v}%"></i></div><b>${r.v}%</b><small>${r.done}/${r.arr.length} 달성${r.bad ? ` · <em>뒤처짐 ${r.bad}</em>` : ''}</small></li>`).join('')}</ul></section>`;
}
// 마감 일정: 오늘부터 120일
function dueTimeline(goals) {
  const now = Date.now(); const span = 120 * 864e5;
  const list = goals.filter((g) => g.status === 'doing' && g.due).map((g) => ({ g, t: dueMs(g) })).filter((x) => x.t >= now - 864e5 && x.t <= now + span).sort((a, b) => a.t - b.t);
  if (!list.length) return '';
  const X = (t) => Math.max(0, Math.min(100, ((t - now) / span) * 100));
  const ticks = [0, 30, 60, 90, 120].map((d) => { const dt = new Date(now + d * 864e5); return `<span style="left:${(d / 120) * 100}%">${d ? `${dt.getMonth() + 1}/${dt.getDate()}` : '오늘'}</span>`; }).join('');
  return `<section class="card ga-card"><div class="ga-h"><h3>마감 일정</h3><small class="muted">앞으로 120일 · 점 = 목표 마감일 · 색 = 진행 속도</small></div>
    <div class="ga-tl"><div class="ga-tl-axis">${ticks}</div>${list.map(({ g, t }, i) => `<div class="ga-tl-row"><span class="ga-tl-name">${esc(g.title)}</span><div class="ga-tl-line"><i class="ga-tl-dot k-${pace(g).k}" style="left:${X(t)}%" title="${esc(g.due)}"></i></div><small>${dday(g.due)}</small></div>`).join('')}</div></section>`;
}

export async function page(el) {
  const [gs, ms] = await Promise.all([getDocs(gcol()), getDocs(collection(db, 'teams', state.team.id, 'members'))]);
  const all = gs.docs.map((d) => norm({ id: d.id, ...d.data() }));
  const members = ms.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.approved !== false);
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
  box.innerHTML = `
    ${isCoach() ? '<div class="row end ga-actions"><button class="btn" data-new>+ 팀 목표 추가</button></div>' : ''}
    ${goals.length ? `${kpiStrip(goals, '팀 진행률')}
    ${paceChart(goals)}
    <div class="ga-two">${catChart(goals, CATS)}${dueTimeline(goals)}</div>` : ''}
    ${goals.length ? CATS.map((c) => {
      const arr = goals.filter((g) => (g.category || CATS[0]) === c);
      if (!arr.length) return '';
      return `<h2 class="sec-title">${c} <small>${arr.length}</small></h2>
        <div class="goal-grid">${arr.map(teamCard).join('')}</div>`;
    }).join('') : empty(isCoach() ? '팀 목표를 추가해 주세요. 예) 리그 3위 이내 · 경기당 실점 1점 이하 · 빌드업 성공률 70%' : '아직 팀 목표가 없습니다.')}`;

  box.querySelector('[data-new]')?.addEventListener('click', () => teamEditor(null, refresh));
  box.querySelectorAll('[data-gid]').forEach((card) => {
    const g = goals.find((x) => x.id === card.dataset.gid);
    const save = async (patch) => { try { await updateDoc(gdoc(g.id), { ...patch, hist: pushHist(g, { ...g, ...patch }) }); refresh(); } catch (e) { fail(e); } };
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
    <div class="ga-cardpace"><span class="ga-st k-${pace(g).k}">${pace(g).l}</span>${pace(g).exp != null && g.status === 'doing' ? `<small>지금쯤 ${pace(g).exp}%</small>` : ''}${spark(g)}</div>
    <div class="gprog">
      <div class="bar"><i style="width:${p}%"></i></div>
      <div class="gnums">${g.target > 0
        ? `<strong>${+g.current || 0}${esc(g.unit || '')}</strong><span>목표 ${+g.target}${esc(g.unit || '')} ${g.lower ? '이하' : '이상'}</span>`
        : `<strong class="gpct">${p}<i>%</i></strong>`}
        ${isCoach() && g.target > 0 ? '<span class="gbtns"><button class="chip" data-dec>−</button><button class="chip" data-inc>+</button></span>' : ''}</div>
    </div>
    ${isCoach() ? `<footer><select data-status>${options(Object.entries(STATUS), g.status)}</select><button class="link-btn small" data-edit>수정</button></footer>` : ''}
  </article>`;
}

// 팀 목표 작성: 예시로 시작 → 재는 방법 하나만 고르기 → 분야 · 기간 · 기한은 눌러서 → 아래 한 줄 요약으로 확인
const TEAM_PRESETS = [
  { title: '리그 순위 3위 이내', category: '결과 · 성적', period: '시즌', target: 3, unit: '위', lower: true },
  { title: '경기당 실점 1점 이하', category: '경기력', period: '시즌', target: 1, unit: '점', lower: true },
  { title: '클린시트 10경기', category: '결과 · 성적', period: '시즌', target: 10, unit: '경기' },
  { title: '공식전 30골', category: '경기력', period: '시즌', target: 30, unit: '골' },
  { title: '훈련 출석률 90%', category: '태도 · 팀문화', period: '월', target: 90, unit: '%' },
  { title: '빌드업으로 슈팅까지 경기당 5번', category: '기술 · 전술', period: '분기', target: 5, unit: '번' },
];
const ymd0 = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// 기간 → 기본 기한 (이번 주 일요일 · 이번 달 말 · 이번 분기 말 · 올해 말)
const dueOf = (period) => {
  const n = new Date();
  if (period === '주') { const d = new Date(n); d.setDate(n.getDate() + ((7 - n.getDay()) % 7)); return ymd0(d); }
  if (period === '월') return ymd0(new Date(n.getFullYear(), n.getMonth() + 1, 0));
  if (period === '분기') return ymd0(new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3 + 3, 0));
  return ymd0(new Date(n.getFullYear(), 11, 31));
};
const chipRadios = (name, list, cur) => `<div class="gf-chips">${list.map(([v, l]) => `<label><input type="radio" name="${name}" value="${esc(v)}" ${String(cur) === String(v) ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>`;

function teamEditor(g, refresh) {
  g ||= {};
  const numeric = g.id ? g.target > 0 : true;
  const m = modal(`
    <span class="eyebrow">TEAM GOAL</span><h2>${g.id ? '팀 목표 수정' : '팀 목표 추가'}</h2>
    <form class="gform">
      ${g.id ? '' : `<div class="gf-presets"><small>예시로 시작</small>${TEAM_PRESETS.map((p, i) => `<button type="button" class="chip" data-preset="${i}">${esc(p.title)}</button>`).join('')}</div>`}
      <label class="gf-title">목표<input name="title" required maxlength="80" value="${esc(g.title || '')}" placeholder="예) 경기당 실점 1점 이하"></label>
      <div class="gf-row"><span class="gf-k">어떻게 잴까요</span>${chipRadios('mode', [['num', '숫자로 재기'], ['pct', '진행률 (%)']], numeric ? 'num' : 'pct')}</div>
      <div class="gf-num" data-num ${numeric ? '' : 'hidden'}>
        <label>목표<input type="number" name="target" min="0" step="0.1" value="${esc(g.target ?? '')}" placeholder="10"></label>
        <label>단위<input name="unit" maxlength="10" value="${esc(g.unit || '')}" placeholder="골 · 경기 · % · 위"></label>
        <div class="gf-dir">${chipRadios('dir', [['up', '이상'], ['down', '이하']], g.lower ? 'down' : 'up')}</div>
        <label>지금<input type="number" name="current" min="0" step="0.1" value="${esc(g.current ?? '')}" placeholder="0"></label>
      </div>
      <div class="gf-pcthelp" data-pct ${numeric ? 'hidden' : ''}><label>지금 진행률 <b data-pv>${+g.progress || 0}%</b><input type="range" name="progress" min="0" max="100" step="5" value="${esc(g.progress ?? 0)}"></label><p class="muted small">숫자로 재기 어려운 목표예요 (예: 빌드업 약속 지키기). 수정에서 진행률을 올려 가요.</p></div>
      <div class="gf-row"><span class="gf-k">분야</span>${chipRadios('category', CATS.map((c) => [c, c]), g.category || CATS[0])}</div>
      <div class="gf-row"><span class="gf-k">기간</span>${chipRadios('period', PERIODS.map((c) => [c, c]), g.period || '시즌')}<input type="date" name="due" class="gf-due" value="${esc(g.due || dueOf(g.period || '시즌'))}" aria-label="기한"></div>
      <details class="gf-more" ${g.desc ? 'open' : ''}><summary>실천 방법 · 메모 (선택)</summary><textarea name="desc" rows="3" placeholder="예) 수비 라인 간격 10m 유지 · 매주 세트피스 수비 20분">${esc(g.desc || '')}</textarea></details>
      <p class="gf-sum" data-sum></p>
      <div class="row end">${g.id ? '<button type="button" class="btn ghost" data-del>삭제</button>' : ''}<button class="btn">${g.id ? '저장' : '추가'}</button></div>
    </form>`, { wide: true });
  const f = m.el.querySelector('form');
  const val = (n) => f.querySelector(`[name="${n}"]:checked`)?.value ?? f.elements[n]?.value ?? '';
  const sum = () => {
    const num = val('mode') === 'num'; const tg = f.elements.target.value;
    const due = f.elements.due.value;
    f.querySelector('[data-sum]').innerHTML = f.elements.title.value.trim()
      ? `<b>${esc(f.elements.title.value.trim())}</b> · ${num && tg !== '' ? `${esc(tg)}${esc(f.elements.unit.value.trim())} ${val('dir') === 'down' ? '이하' : '이상'}` : '진행률로 관리'} · ${esc(val('category'))} · ${esc(val('period'))}${due ? ` · ${esc(due)} (${dday(due)})` : ''}`
      : '<span class="muted">목표를 적으면 여기에 한 줄로 정리돼요.</span>';
  };
  f.addEventListener('input', (e) => { if (e.target.name === 'progress') f.querySelector('[data-pv]').textContent = `${e.target.value}%`; sum(); }); f.addEventListener('change', (e) => {
    if (e.target.name === 'mode') { const num = val('mode') === 'num'; f.querySelector('[data-num]').hidden = !num; f.querySelector('[data-pct]').hidden = num; }
    if (e.target.name === 'period') f.elements.due.value = dueOf(val('period'));
    sum();
  });
  f.querySelectorAll('[data-preset]').forEach((b) => (b.onclick = () => {
    const p = TEAM_PRESETS[+b.dataset.preset];
    f.elements.title.value = p.title; f.elements.target.value = p.target; f.elements.unit.value = p.unit; f.elements.current.value = '';
    f.querySelector(`[name="mode"][value="num"]`).checked = true; f.querySelector(`[name="dir"][value="${p.lower ? 'down' : 'up'}"]`).checked = true;
    f.querySelector(`[name="category"][value="${p.category}"]`).checked = true; f.querySelector(`[name="period"][value="${p.period}"]`).checked = true;
    f.elements.due.value = dueOf(p.period); f.querySelector('[data-num]').hidden = false; f.querySelector('[data-pct]').hidden = true;
    sum(); f.elements.target.focus();
  }));
  sum();
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmBox('이 목표를 삭제할까요?'))) return;
    try { await deleteDoc(gdoc(g.id)); m.close(); refresh(); } catch (e) { fail(e); }
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const num = d.mode === 'num' && d.target !== '';
    const data = {
      scope: 'team', title: d.title.trim(), category: d.category, period: d.period, due: d.due, desc: d.desc || '',
      target: num ? +d.target : null, current: num && d.current !== '' ? +d.current : num ? (+g.current || 0) : 0, unit: num ? d.unit.trim() : '', lower: num && d.dir === 'down',
      progress: num ? (+g.progress || 0) : +(d.progress || 0),
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
    ${goals.length ? `${kpiStrip(goals, '내 진행률')}${paceChart(goals, '내 목표 진행 속도')}` : ''}
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
    <div class="ga-cardpace"><span class="ga-st k-${pace(g).k}">${pace(g).l}</span>${pace(g).exp != null && g.status === 'doing' ? `<small>지금쯤 ${pace(g).exp}%</small>` : ''}${g.idp ? '<span class="tag">IDP 추천</span>' : ''}${spark(g)}</div>
    <div class="gprog">
      <div class="bar"><i style="width:${p}%"></i></div>
      <div class="gnums"><strong class="gpct">${p}<i>%</i></strong>
        ${mine && g.status !== 'done' ? '<span class="gbtns"><button class="chip" data-p="-10">−10</button><button class="chip" data-p="10">+10</button><button class="chip on" data-done>달성!</button></span>' : ''}</div>
    </div>
    ${g.coachComment ? `<div class="coach-note"><span class="tag solid">코치 한마디</span><p>${text(g.coachComment)}</p></div>` : ''}
    ${mine ? '<footer><button class="link-btn small" data-edit>수정</button></footer>' : ''}
  </article>`;
}

function bindMyCards(box, goals, refresh) {
  box.querySelectorAll('[data-gid]').forEach((card) => {
    const g = goals.find((x) => x.id === card.dataset.gid);
    const save = async (patch) => { try { await updateDoc(gdoc(g.id), { ...patch, hist: pushHist(g, { ...g, ...patch }) }); refresh(); } catch (e) { fail(e); } };
    card.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => save({ progress: Math.max(0, Math.min(100, (+g.progress || 0) + +b.dataset.p)) })));
    card.querySelector('[data-done]')?.addEventListener('click', () => { save({ status: 'done', progress: 100 }); toast('목표 달성! 정말 잘했어요'); });
    card.querySelector('[data-edit]')?.addEventListener('click', () => myEditor(g, refresh));
  });
}

// 나의 목표 작성: 분야 고르기 → 예시 누르면 채워짐 → 실천 방법 한 줄 → 기한은 2주 · 1달 · 3달
const MY_PRESETS = {
  기술: ['왼발로 정확하게 패스하기', '첫 터치를 다음 방향으로', '슈팅을 골문 안으로 10개 중 6개'],
  체력: ['30m 달리기 기록 0.2초 줄이기', '경기 끝까지 같은 속도로 뛰기', '훈련 뒤 스트레칭 10분'],
  '전술 이해': ['공 받기 전 어깨 너머 2번 보기', '공 잃으면 5초 안에 압박', '수비할 때 내 자리 빨리 찾기'],
  마음가짐: ['실수해도 다음 공을 달라고 하기', '경기 중 동료에게 콜 많이 하기'],
  '생활 습관': ['밤 11시 전에 자기', '하루 물 2리터 마시기', '훈련 일지 매일 쓰기'],
  기타: [],
};
const HOW_HINT = { 기술: '예) 훈련 끝나고 벽 패스 왼발 50개', 체력: '예) 주 2번 30m 달리기 5세트', '전술 이해': '예) 경기 영상에서 내 장면 3개 찾아보기', 마음가짐: '예) 경기 전 다짐 한 줄 쓰기', '생활 습관': '예) 10시 반에 휴대폰 끄기', 기타: '예) 매일 · 매주 무엇을 할지' };
function myEditor(g, refresh) {
  g ||= {};
  const cat0 = g.category || MY_CATS[0];
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd0(d); };
  const m = modal(`
    <span class="eyebrow">MY GOAL</span><h2>${g.id ? '내 목표 고치기' : '내 목표 적기'}</h2>
    <form class="gform">
      <div class="gf-row"><span class="gf-k">분야</span>${chipRadios('category', MY_CATS.map((c) => [c, c]), cat0)}</div>
      <div class="gf-presets" data-presets></div>
      <label class="gf-title">무엇을 이룰까요<input name="title" required maxlength="60" value="${esc(g.title || '')}" placeholder="예) 왼발로 정확하게 패스하기"></label>
      <label>어떻게 할까요 <small class="muted">매일 · 매주 하는 일 한 가지</small><input name="how" maxlength="200" value="${esc(g.how || '')}" placeholder="${esc(HOW_HINT[cat0])}"></label>
      <div class="gf-row"><span class="gf-k">언제까지</span>${chipRadios('span', [['14', '2주'], ['30', '1달'], ['90', '3달'], ['', '직접']], g.id ? '' : '30')}<input type="date" name="due" class="gf-due" value="${esc(g.due || addDays(30))}" aria-label="기한"></div>
      <details class="gf-more" ${g.why ? 'open' : ''}><summary>왜 이 목표인가요 (선택)</summary><textarea name="why" rows="2" maxlength="200" placeholder="예) 왼쪽에서 공을 받으면 오른발로 바꾸느라 늦어요">${esc(g.why || '')}</textarea></details>
      <p class="gf-sum" data-sum></p>
      <div class="row end">${g.id ? '<button type="button" class="btn ghost" data-del>지우기</button>' : ''}<button class="btn">${g.id ? '저장' : '올리기'}</button></div>
    </form>`);
  const f = m.el.querySelector('form');
  const cat = () => f.querySelector('[name="category"]:checked')?.value || MY_CATS[0];
  const drawPresets = () => {
    const list = MY_PRESETS[cat()] || [];
    f.querySelector('[data-presets]').innerHTML = list.length ? `<small>예시</small>${list.map((t) => `<button type="button" class="chip" data-gp="${esc(t)}">${esc(t)}</button>`).join('')}` : '';
    f.querySelectorAll('[data-gp]').forEach((b) => (b.onclick = () => { f.elements.title.value = b.dataset.gp; sum(); f.elements.how.focus(); }));
    f.elements.how.placeholder = HOW_HINT[cat()] || '';
  };
  const sum = () => {
    const t = f.elements.title.value.trim(); const due = f.elements.due.value;
    f.querySelector('[data-sum]').innerHTML = t ? `<b>${esc(t)}</b> · ${esc(cat())}${f.elements.how.value.trim() ? ` · ${esc(f.elements.how.value.trim())}` : ''}${due ? ` · ${esc(due)}까지 (${dday(due)})` : ''}` : '<span class="muted">목표를 적으면 여기에 한 줄로 정리돼요.</span>';
  };
  f.addEventListener('input', sum);
  f.addEventListener('change', (e) => {
    if (e.target.name === 'category') drawPresets();
    if (e.target.name === 'span' && e.target.value) f.elements.due.value = addDays(+e.target.value);
    if (e.target.name === 'due') { const r = f.querySelector('[name="span"][value=""]'); if (r) r.checked = true; }
    sum();
  });
  drawPresets(); sum();
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmBox('이 목표를 지울까요?'))) return;
    try { await deleteDoc(gdoc(g.id)); m.close(); refresh(); } catch (e) { fail(e); }
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const data = { scope: 'personal', title: d.title.trim(), category: d.category, why: d.why || '', how: d.how || '', due: d.due };
    try {
      if (g.id) await updateDoc(gdoc(g.id), data);
      else await addDoc(gcol(), { ...data, status: 'doing', progress: 0, ownerUid: state.user.uid, ownerName: state.profile.name, createdAt: serverTimestamp() });
      m.close();
      toast(g.id ? '저장했어요.' : '목표를 올렸어요! 화이팅');
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
    <section class="rec-hero goal-hero">
      <div class="rec-ring">${ring(players.length ? Math.round((written / players.length) * 100) : 0, '작성률')}
        <ul class="rec-legend">
          <li class="w"><i></i><span>작성</span><b>${written}</b><em>명</em></li>
          <li class="d"><i></i><span>안 씀</span><b>${players.length - written}</b><em>명</em></li>
          <li class="g"><span>선수 ${players.length}명</span>${goals.some((g) => !g.coachChecked) ? `<b class="rec-streak warn">확인 대기 ${goals.filter((g) => !g.coachChecked).length}개</b>` : ''}</li>
        </ul>
      </div>
      <div class="rec-kpis">
        <div class="rk"><small>평균 진행률</small><strong>${avgPct(goals)}<i>%</i></strong><div class="rk-prog g"><i style="width:${avgPct(goals)}%"></i></div><span>목표 <b>${goals.length}</b>개</span></div>
        <div class="rk"><small>달성</small><strong>${goals.filter((g) => g.status === 'done').length}</strong><span>${goals.length ? Math.round((goals.filter((g) => g.status === 'done').length / goals.length) * 100) : 0}%</span></div>
        <div class="rk"><small>코치 확인</small><strong>${goals.filter((g) => g.coachChecked).length}<i>/${goals.length}</i></strong><div class="rk-prog"><i style="width:${goals.length ? (goals.filter((g) => g.coachChecked).length / goals.length) * 100 : 0}%"></i></div><span>목표를 눌러 한마디 · 도장</span></div>
      </div>
    </section>
    ${goals.length ? `<div class="ga-two">${catChart(goals, MY_CATS)}${playerBars(players, goals)}</div>${paceChart(goals.filter((g) => ['behind', 'late'].includes(pace(g).k)), '도움이 필요한 목표 (뒤처짐 · 기한 지남)')}` : ''}
    <p class="lead">선수들이 직접 적어 올린 목표입니다. 목표를 눌러 코치 한마디를 남기고 확인 도장을 찍어주세요.</p>
    ${players.length ? `<div class="pgoal-list">${players.map((p) => {
      const arr = by(p.id);
      return `<section class="pgoal">
        <header>${avatar(p.photo, p.name, 'sm')}<strong>${p.number ? `${esc(p.number)} ` : ''}${esc(p.name)}</strong>
          <small>${arr.length ? `목표 ${arr.length}개 · 평균 ${avgPct(arr)}%` : '아직 작성 안 함'}</small>${arr.length ? `<div class="rk-prog g pg-bar"><i style="width:${avgPct(arr)}%"></i></div>` : ''}
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

// 코치: 선수별 평균 진행률 · 목표 수 · 뒤처짐 (등번호 순)
function playerBars(players, goals) {
  const rows = players.map((p) => { const arr = goals.filter((g) => g.ownerUid === p.id); return { p, arr, v: avgPct(arr), bad: arr.filter((g) => ['behind', 'late'].includes(pace(g).k)).length }; });
  return `<section class="card ga-card"><div class="ga-h"><h3>선수별</h3><small class="muted">평균 진행률 · 목표 수 · 뒤처짐</small></div>
    <ul class="ga-cat">${rows.map((r) => `<li><span>${esc(r.p.number ? `${r.p.number} ` : '')}${esc(r.p.name || '')}</span><div class="ga-track"><i class="ga-fill" style="width:${r.arr.length ? r.v : 0}%"></i></div><b>${r.arr.length ? `${r.v}%` : '-'}</b><small>${r.arr.length ? `목표 ${r.arr.length}${r.bad ? ` · <em>뒤처짐 ${r.bad}</em>` : ''}` : '아직 없음'}</small></li>`).join('')}</ul></section>`;
}
