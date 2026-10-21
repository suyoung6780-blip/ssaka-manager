// 홈 — 코치 데스크 (다음 경기 · 선수 상태 · 답 안 한 질문 · 오늘 훈련 · 준비물 · 빠른 실행) + 선수 '코치님 답변'
// 읽기 아끼기: 최근 7일 일지 · 팀원 목록 · 내 답변은 이 기기에 몇 분 보관해서 다시 씀
import { auth, db, collection, query, where, orderBy, limit, getDocs, doc, getDoc } from '../fb.js';
import { esc, todayStr, empty } from '../ui.js';
import { state, go } from '../store.js';
import { sleepOf, SHORT_SLEEP } from '../sleep.js';
import { calcStats } from './team.js';

const addDays = (s, n) => { const d = new Date(`${s}T00:00`); d.setDate(d.getDate() + n); return todayStr(d); };
const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8)}`;
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const dday = (s) => { const n = Math.round((new Date(`${s}T00:00`) - new Date(`${todayStr()}T00:00`)) / 864e5); return n === 0 ? 'D-DAY' : `D-${n}`; };
const cut = (s, n = 42) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

// 일지 하나에서 질문 꺼내기 (세션 질문 · 경기 장면 질문)
export function questionsOf(l, id) {
  const ans = l.answers || {};
  const out = [];
  // 그 날 고른 일지(훈련 / 경기)의 질문만 — 일지검사 화면에 보이는 것과 같게
  if (l.kind !== 'match') Object.entries(l.sessions || {}).forEach(([k, x]) => { if (x?.ask) out.push({ key: k, ask: x.ask, where: x.name || '훈련', ans: ans[k] }); });
  if (l.kind !== 'train') (l.match?.scenes || []).forEach((sc, i) => { if (sc?.ask && sc.key) out.push({ key: `m_${sc.key}`, ask: sc.ask, where: `경기 장면 ${i + 1}`, ans: ans[`m_${sc.key}`] }); });
  return out.map((q) => ({ ...q, id, uid: l.uid, name: l.name, date: l.date }));
}

// 최근 7일 팀 일지 (5분 보관)
export async function recentLogs(tid) {
  const k = `ssaka.home7.${tid}`;
  if (!auth.demo) try { const c = JSON.parse(sessionStorage.getItem(k) || 'null'); if (c && Date.now() - c.at < 5 * 60e3 && c.day === todayStr()) return c.logs; } catch { /* */ }
  const from = addDays(todayStr(), -6);
  const snap = await getDocs(query(collection(db, 'teams', tid, 'logs'), where('date', '>=', from))).catch(() => null);
  const logs = snap ? snap.docs.map((d) => {
    const x = d.data();
    return { id: d.id, uid: x.uid, name: x.name, date: x.date, condition: x.condition, injury: x.injury, injuryPart: x.injuryPart, hurt: x.hurt, sleep: sleepOf(x), rpe: x.rpe, trainMin: x.trainMin, submitted: !!x.submitted, q: questionsOf(x, d.id).filter((q) => !q.ans?.text).map(({ key, ask, where }) => ({ key, ask, where })) };
  }) : [];
  try { sessionStorage.setItem(k, JSON.stringify({ at: Date.now(), day: todayStr(), logs })); } catch { /* */ }
  return logs;
}
// 팀원 목록 (3분 보관 · 이름 · 번호 · 역할만)
export async function teamMembers(tid) {
  const k = `ssaka.homeMem.${tid}`;
  if (!auth.demo) try { const c = JSON.parse(sessionStorage.getItem(k) || 'null'); if (c && Date.now() - c.at < 3 * 60e3) return c.list; } catch { /* */ }
  const snap = await getDocs(collection(db, 'teams', tid, 'members')).catch(() => null);
  const list = snap ? snap.docs.map((d) => { const x = d.data(); return { id: d.id, name: x.name, number: x.number, role: x.role, approved: x.approved }; }) : [];
  try { sessionStorage.setItem(k, JSON.stringify({ at: Date.now(), list })); } catch { /* */ }
  return list;
}
export const dropHomeCache = () => { try { Object.keys(sessionStorage).filter((x) => x.startsWith('ssaka.home')).forEach((x) => sessionStorage.removeItem(x)); } catch { /* */ } };

// 작전판에서 준비물 세기 (훈련마다 가장 많이 쓰는 수 — 같은 기구는 다시 씀)
const GEAR = [['cone', '콘'], ['marker', '마커'], ['gmarker', '접시 마커'], ['pole', '폴대'], ['hurdle', '허들'], ['ladder', '사다리'], ['minigoal', '미니골대'], ['goal', '골대'], ['gymball', '짐볼'], ['bosu', '보수볼'], ['ball', '공']];
function gearOf(pads) {
  const need = {}; let bibs = 0; let people = 0;
  pads.forEach((pd) => {
    const items = pd?.items || [];
    const cnt = {};
    items.forEach((x) => { cnt[x.k] = (cnt[x.k] || 0) + 1; });
    GEAR.forEach(([k]) => { if (cnt[k]) need[k] = Math.max(need[k] || 0, cnt[k]); });
    const pl = items.filter((x) => x.k === 'player' && !x.role);
    const colors = new Set(pl.map((x) => x.pc || x.team));
    bibs = Math.max(bibs, colors.size > 1 ? colors.size : 0);
    people = Math.max(people, pl.length);
  });
  return { list: GEAR.filter(([k]) => need[k]).map(([k, l]) => [l, need[k]]), bibs, people };
}

// 코치 홈 위쪽 빠른 실행 · 카드 자리 (읽는 동안)
export const quickBar = () => `<nav class="cd-quick">
  <a href="#/training">오늘 훈련 쓰기</a><a href="#/tactics">작전판</a><a href="#/records">경기 기록</a><a href="#/notice">공지 쓰기</a><a href="#/journal-check">일지검사</a>
</nav>`;
export const deskSkeleton = () => Array.from({ length: 4 }, () => '<section class="card hcard cd-skel"></section>').join('');

export async function coachDesk(box, { sched, matches, plans, players, logs, todaySubmitted = 0 }) {
  const tid = state.team.id;
  const today = todayStr();
  // 오늘 훈련에 넣은 훈련 프로그램 (작전판) — 필요한 것만 읽음
  const progIds = [...new Set(plans.flatMap((p) => (p.blocks || []).map((b) => b.programId).filter(Boolean)))].slice(0, 8);
  const progs = await Promise.all(progIds.map((id) => getDoc(doc(db, 'teams', tid, 'posts', id)).then((d) => (d.exists() ? { id, ...d.data() } : null)).catch(() => null)));

  // ── 다음 경기 ──
  const next = sched.filter((x) => x.kind === '경기' && x.date >= today).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))[0];
  const oppOf = (x) => (x.opponent || (String(x.title || '').match(/vs\.?\s*([^\s·,()]+(?:\s[^\s·,()]+)?)/i) || [])[1] || '').trim();
  const opp = next ? oppOf(next) : '';
  const vs = opp ? matches.filter((m) => m.opponent && (m.opponent.includes(opp) || opp.includes(m.opponent))) : [];
  const h2h = vs.length ? calcStats(vs) : null;
  const nextCard = `<section class="card hcard cd-next">
    <div class="card-head"><h3>다음 경기</h3><a href="#/schedule" class="more">스케줄 →</a></div>
    ${next ? `<div class="cd-next-top"><b class="cd-dday">${dday(next.date)}</b><div><strong>${esc(next.title)}</strong>
        <small>${md(next.date)} (${DOW_KO[new Date(`${next.date}T00:00`).getDay()]}) ${esc(next.time || '')}${next.place ? ` · ${esc(next.place)}` : ''}</small></div></div>
      ${h2h ? `<div class="cd-h2h"><span>vs ${esc(opp)} 지난 전적</span><b>${h2h.w}승 ${h2h.d}무 ${h2h.l}패</b><small>득 ${h2h.gf} · 실 ${h2h.ga}</small></div>` : opp ? `<p class="muted small">vs ${esc(opp)} — 지난 경기 기록이 없어요.</p>` : ''}
      <div class="cd-links"><a class="chip" href="#/meeting">미팅 자료</a><a class="chip" href="#/gamemodel">세트피스 · 패턴</a><a class="chip" href="#/records">경기 기록실</a></div>`
      : empty('예정된 경기가 없어요. 스케줄에 경기를 넣으면 여기에 나와요.')}
  </section>`;

  // ── 선수 상태: 부상 · 컨디션 · 수면 (최근 기록 기준) ──
  const byUid = {};
  logs.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((l) => { (byUid[l.uid] ||= []).push(l); });
  const pName = (uid, f) => { const p = players.find((x) => x.id === uid); return `${p?.number ? `${esc(p.number)} ` : ''}${esc(p?.name || f || '')}`; };
  const hurtNow = []; const watch = [];
  Object.entries(byUid).forEach(([uid, arr]) => {
    const last = arr[arr.length - 1];
    if ((last.injury || 0) >= 3 || last.hurt) {
      let days = 0; for (let i = arr.length - 1; i >= 0 && ((arr[i].injury || 0) >= 3 || arr[i].hurt); i--) days++;
      hurtNow.push({ uid, name: last.name, part: last.injuryPart, lv: last.injury || 0, days, hurt: last.hurt });
      return;
    }
    const r3 = arr.filter((l) => l.date >= addDays(today, -2));
    const why = [];
    if (r3.some((l) => l.condition != null && l.condition <= 2)) why.push('컨디션 낮음');
    if (r3.filter((l) => l.sleep != null && l.sleep < SHORT_SLEEP).length >= 2) why.push('수면 부족');
    if (r3.some((l) => l.rpe >= 9)) why.push('자각도 높음');
    if (why.length) watch.push({ uid, name: last.name, why });
  });
  const statusCard = `<section class="card hcard cd-status">
    <div class="card-head"><h3>선수 상태 <small class="muted">최근 7일</small></h3><a href="#/data" class="more">데이터실 →</a></div>
    <a class="cd-sub" href="#/journal-check"><span>오늘 일지 제출</span><b>${todaySubmitted}<i>/${players.length}</i></b></a>
    ${hurtNow.length || watch.length ? `<ul class="cd-list">
      ${hurtNow.map((x) => `<li class="hot"><span class="cd-tag hurt">부상</span><b>${pName(x.uid, x.name)}</b><small>${esc(x.part || (x.hurt ? (x.hurt === 'match' ? '경기 중' : '훈련 중') : ''))}${x.lv ? ` · ${x.lv}/10` : ''} · ${x.days}일째</small></li>`).join('')}
      ${watch.map((x) => `<li><span class="cd-tag">주의</span><b>${pName(x.uid, x.name)}</b><small>${x.why.join(' · ')}</small></li>`).join('')}
    </ul>` : '<p class="muted small">다친 선수 · 주의할 선수가 없어요.</p>'}
  </section>`;

  // ── 답 안 한 질문 ──
  const qs = logs.filter((l) => l.submitted).flatMap((l) => (l.q || []).map((q) => ({ ...q, uid: l.uid, name: l.name, date: l.date }))).sort((a, b) => b.date.localeCompare(a.date));
  const qCard = `<section class="card hcard cd-q">
    <div class="card-head"><h3>답 안 한 질문 ${qs.length ? `<b class="cd-badge">${qs.length}</b>` : ''}</h3><a href="#/journal-check" class="more">일지검사 →</a></div>
    ${qs.length ? `<ul class="cd-list">${qs.slice(0, 5).map((q) => `<li class="cd-qi" data-q="${esc(q.date)}|${esc(q.uid)}"><b>${pName(q.uid, q.name)}</b><small>${md(q.date)} · ${esc(q.where)}</small><p>"${esc(cut(q.ask))}"</p></li>`).join('')}</ul>${qs.length > 5 ? `<p class="muted small">외 ${qs.length - 5}개</p>` : ''}`
      : '<p class="muted small">선수 질문에 모두 답했어요.</p>'}
  </section>`;

  // ── 오늘 훈련 · 준비물 ──
  const todays = sched.filter((x) => x.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const pads = progs.filter(Boolean).map((p) => p.pad).filter(Boolean);
  const gear = gearOf(pads);
  const mins = plans.reduce((a, p) => a + (p.blocks || []).reduce((x, b) => x + (+b.min || 0), 0), 0);
  const trainCard = `<section class="card hcard cd-train">
    <div class="card-head"><h3>오늘</h3><a href="#/training" class="more">훈련장 →</a></div>
    ${todays.length ? `<ul class="cd-today">${todays.map((x) => `<li><span>${esc(x.time || '종일')}</span><b>${esc(x.title)}</b>${x.place ? `<small>${esc(x.place)}</small>` : ''}</li>`).join('')}</ul>` : ''}
    ${plans.length ? `<div class="cd-plan">${plans.map((p) => `<div><strong>${esc(p.title || '훈련')}</strong><small>${esc([p.time, `${(p.blocks || []).length}개 훈련`, mins ? `${mins}분` : ''].filter(Boolean).join(' · '))}</small></div>`).join('')}</div>
      ${gear.list.length || gear.bibs ? `<div class="cd-gear"><span class="cd-gear-h">준비물 <small>작전판에서 셌어요</small></span>
        <ul>${gear.list.map(([l, n]) => `<li><b>${n}</b>${esc(l)}</li>`).join('')}${gear.bibs ? `<li><b>${gear.bibs}</b>색 조끼</li>` : ''}</ul></div>`
        : '<p class="muted small">훈련 프로그램 작전판을 넣으면 콘 · 공 · 조끼 같은 준비물을 세어 드려요.</p>'}
      ${progs.filter(Boolean).length ? `<div class="cd-links">${progs.filter(Boolean).map((p) => `<button type="button" class="chip" data-present="${esc(p.id)}">발표 · ${esc(cut(p.title, 14))}</button>`).join('')}</div>` : ''}`
      : `<p class="muted small">${todays.length ? '오늘 훈련 안내는 아직 없어요.' : '오늘은 일정 · 훈련이 없어요.'}</p>`}
  </section>`;

  box.innerHTML = `${trainCard}${statusCard}${qCard}${nextCard}`;

  box.querySelectorAll('[data-q]').forEach((li) => (li.onclick = () => {
    const [date, uid] = li.dataset.q.split('|');
    try { sessionStorage.setItem('ssaka.jc.open', JSON.stringify({ date, uid })); } catch { /* */ }
    go('/journal-check');
  }));
  box.querySelectorAll('[data-present]').forEach((b) => (b.onclick = async () => {
    const p = progs.find((x) => x?.id === b.dataset.present);
    if (p) (await import('./training.js')).present(p);
  }));
}

// ───────── 선수 홈: 코치님 답변 ─────────
const SEEN = () => `ssaka.ans.${state.user.uid}`;
export async function answersCard(box) {
  const tid = state.team.id;
  // 최근 10개 일지만 · 5분 보관
  const ck = `ssaka.homeAns.${tid}.${state.user.uid}`;
  let qs = null;
  if (!auth.demo) try { const c = JSON.parse(sessionStorage.getItem(ck) || 'null'); if (c && Date.now() - c.at < 5 * 60e3) qs = c.qs; } catch { /* */ }
  if (!qs) {
    const snap = await getDocs(query(collection(db, 'teams', tid, 'logs'), where('uid', '==', state.user.uid), orderBy('date', 'desc'), limit(10))).catch(() => null);
    qs = snap ? snap.docs.flatMap((d) => questionsOf(d.data(), d.id)) : [];
    try { sessionStorage.setItem(ck, JSON.stringify({ at: Date.now(), qs })); } catch { /* */ }
  }
  const answered = qs.filter((q) => q.ans?.text);
  const waiting = qs.filter((q) => !q.ans?.text);
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(SEEN()) || '[]'); } catch { /* */ }
  const sk = (q) => `${q.id}:${q.key}`;
  const fresh = answered.filter((q) => !seen.includes(sk(q)));
  if (!qs.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<section class="card hcard cd-ans">
    <div class="card-head"><h3>코치님 답변 ${fresh.length ? `<b class="cd-badge">${fresh.length}</b>` : ''}</h3>${waiting.length ? `<small class="muted">답변 기다리는 중 ${waiting.length}</small>` : ''}</div>
    ${answered.length ? `<ul class="cd-chat">${answered.slice(0, 4).map((q) => `<li class="${seen.includes(sk(q)) ? '' : 'new'}" data-go="${esc(q.date)}">
      <small>${md(q.date)} · ${esc(q.where)}${seen.includes(sk(q)) ? '' : ' <b class="cd-new">새 답변</b>'}</small>
      <p class="me">${esc(cut(q.ask, 60))}</p><p class="coach"><b>${esc(q.ans.by || '코치')}</b> ${esc(cut(q.ans.text, 90))}</p></li>`).join('')}</ul>`
      : '<p class="muted small">아직 답변이 온 질문이 없어요. 코치님이 곧 답해 주실 거예요.</p>'}
  </section>`;
  // 보면 '새 답변' 표시는 다음부터 없어짐
  try { localStorage.setItem(SEEN(), JSON.stringify([...new Set([...seen, ...answered.map(sk)])].slice(-200))); } catch { /* */ }
  box.querySelectorAll('[data-go]').forEach((li) => (li.onclick = () => {
    try { sessionStorage.setItem('ssaka.daily.date', li.dataset.go); } catch { /* */ }
    go('/daily');
  }));
}
