// 시제품 3.0: 해가 바뀌면 (1~3월) 학년 · 등번호를 바꾸라고 알림
// 선수: 앱을 열면 창으로 한 번 (작년 학년이면 다음 학년을 미리 채움) · 홈 카드 · 지도자: 홈에 확인 현황
// 번호가 바뀌어도 지난 경기 · 영상은 그때 번호로 남음 (numbers 기록 — store.js numberAt)
import { db, doc, updateDoc, collection, getDocs, query, where } from '../fb.js';
import { state, hasFeature, inTeam, isOwner, nextNumbers, publicProfile } from '../store.js';
import { esc, modal, toast, fail, confirmBox } from '../ui.js';
import { transferMember, removeMember } from '../pages/team.js';

// '초6으로' · '초2로' — 마지막 글자 받침 보고 (ㄹ 받침은 '로')
const ro = (w) => { const c = String(w).slice(-1); const dg = { 0: 1, 1: 0, 2: 0, 3: 1, 4: 0, 5: 0, 6: 1, 7: 0, 8: 0, 9: 0 }; const k = c.charCodeAt(0) - 0xac00;
  const b = /\d/.test(c) ? dg[c] : k >= 0 && k < 11172 ? (k % 28 && k % 28 !== 8 ? 1 : 0) : 0; return `${w}${b ? '으로' : '로'}`; };
export const GRADES = ['초1', '초2', '초3', '초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3', '대학', '성인'];
// 다음 학년 짐작 (고3부터는 졸업 · 진학이 달라서 그대로 두고 직접 고르게)
export const nextGrade = (g) => { const i = GRADES.indexOf(g); return i >= 0 && i < GRADES.indexOf('고3') ? GRADES[i + 1] : g || ''; };
const force = () => new URLSearchParams(location.search).has('newseason');
export const seasonYear = () => new Date().getFullYear();
export const inSeasonWindow = () => new Date().getMonth() < 3 || force();
// 이 선수가 올해 학년 · 등번호를 확인했는지
export const confirmed = (p) => +(p?.numYear || 0) === seasonYear();
export const seasonDue = () => hasFeature('proto3') && inTeam() && state.profile?.role === 'player' && inSeasonWindow() && !confirmed(state.profile);

// 올해 학년 칸에 미리 넣을 값: 작년에 적은 학년이면 한 학년 올려서
export const suggestGrade = (p) => (p?.grade && +(p.gradeYear || 0) < seasonYear() ? nextGrade(p.grade) : p?.grade || '');

export async function saveSeason({ grade, number }) {
  const yr = seasonYear(); const p = state.profile;
  const d = { grade: grade || '', gradeYear: yr, number: number || '', numYear: yr };
  if (p.grade && +(p.gradeYear || 0) < yr) d.gradePrev = p.grade; // 작년 학년 (졸업했는지 보려고)
  const h = nextNumbers(p, d.number); if (h) d.numbers = h;
  await updateDoc(doc(db, 'users', state.user.uid), d);
  Object.assign(p, d);
  await updateDoc(doc(db, 'teams', state.team.id, 'members', state.user.uid), publicProfile(p));
}

let shown = false;
export function seasonPopup({ always = false, onDone } = {}) {
  if (!always && (shown || !seasonDue())) return null;
  shown = true;
  // '나중에'를 누르면 하루 뒤에 다시 물어봄
  const LK = `ssaka.season.later.${state.user?.uid}`; const day = new Date().toDateString();
  try { if (!always && !force() && localStorage.getItem(LK) === day) return null; } catch { /* */ }
  const p = state.profile; const yr = seasonYear(); const g = suggestGrade(p);
  const m = modal(`<span class="eyebrow">NEW SEASON</span><h2>${yr}년이 됐어요</h2>
    <p class="muted small">새 시즌 <b>학년</b>과 <b>등번호</b>를 확인해 주세요. 번호가 바뀌어도 지난 경기 · 영상 기록은 그때 번호로 남아요.</p>
    <form class="ns-form">
      <div class="grid2">
        <label>학년<select name="grade"><option value="">-</option>${GRADES.map((x) => `<option ${x === g ? 'selected' : ''}>${x}</option>`).join('')}</select>
          ${p.grade && g !== p.grade ? `<small class="muted">작년 ${esc(p.grade)} → ${esc(ro(g))} 채워 뒀어요</small>` : ''}</label>
        <label>등번호<input name="number" type="number" min="0" max="99" inputmode="numeric" value="${esc(p.number || '')}">
          ${p.number ? `<small class="muted">지금 ${esc(p.number)}번</small>` : ''}</label>
      </div>
      <div class="row end ns-acts"><button type="button" class="btn ghost" data-later>나중에</button><button class="btn">${yr} 시즌으로 저장</button></div>
    </form>`);
  const f = m.el.querySelector('form');
  m.el.querySelector('[data-later]').onclick = () => { try { localStorage.setItem(LK, day); } catch { /* */ } m.close(); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await saveSeason({ grade: f.grade.value, number: String(f.number.value || '').trim() });
      m.close(); document.querySelectorAll('.ph-season').forEach((x) => x.remove()); toast(`${yr} 시즌 학년 · 등번호를 저장했어요.`); onDone?.();
    } catch (err) { fail(err); }
  };
  return m;
}

// 지도자 홈: 새 시즌 확인 현황 (1~3월)
export function coachSeasonCard(players) {
  if (!hasFeature('proto3') || !inSeasonWindow() || !players.length) return '';
  const yr = seasonYear(); const not = players.filter((x) => !confirmed(x));
  // 올해 확인한 선수끼리 같은 번호
  const by = {}; players.filter((x) => confirmed(x) && x.number).forEach((x) => (by[x.number] ||= []).push(x.name || ''));
  const dup = Object.entries(by).filter(([, l]) => l.length > 1);
  const grads = isOwner() ? gradList(players) : [];
  if (!not.length && !dup.length && !grads.length) return '';
  return `<section class="card hcard ns-coach"><div class="card-head"><h3>${yr} 새 시즌 학년 · 등번호</h3><a href="#/team" class="more">선수단 →</a></div>
    <p><b>${players.length - not.length}</b><span class="muted">/${players.length}명 확인</span></p>
    ${not.length ? `<p class="small">아직 안 한 선수: ${not.slice(0, 8).map((x) => `${x.number ? `${esc(x.number)} ` : ''}${esc(x.name || '')}`).join(' · ')}${not.length > 8 ? ` 외 ${not.length - 8}명` : ''}</p>` : ''}
    ${grads.length ? `<p class="small ns-grad" data-gradn>졸업 <b>${grads.length}명</b> (${grads.slice(0, 5).map((x) => esc(x.name || '')).join(' · ')}) <button type="button" class="btn sm" data-gradfix>졸업 정리하기</button></p>` : ''}
    ${dup.length ? `<p class="small ns-dup">같은 번호: ${dup.map(([n, l]) => `<b>${esc(n)}번</b> ${l.map(esc).join(' · ')}`).join(' / ')}</p>` : ''}
    <p class="muted small">선수가 앱을 열면 창으로 알려요 · 작년 학년은 한 학년 올려서 미리 채워 줘요</p></section>`;
}

// ───────── 졸업 정리 (팀 대표) — 초6 · 중3 · 고3이 해를 넘기면 내보내기 또는 상급학교 팀으로 이적 ─────────
const LAST = { 초6: '중학교', 중3: '고등학교', 고3: '대학 · 성인' };
// 작년 학년이 졸업 학년이면 졸업 (올해 아직 안 고쳤으면 지금 학년으로, 고쳤으면 작년 학년으로 봄)
export function gradOf(m) {
  const yr = seasonYear();
  if (m.role !== 'player' || +(m.gradKeep || 0) === yr) return null;
  const prev = +(m.gradeYear || 0) < yr ? m.grade : +(m.gradeYear || 0) === yr ? m.gradePrev : '';
  return LAST[prev] && (+(m.gradeYear || 0) < yr || m.grade !== prev) ? { from: prev, to: LAST[prev] } : null;
}
const gradList = (ms) => ms.filter((m) => m.approved !== false && gradOf(m));

let gShown = false;
export async function gradPopup({ always = false, onDone } = {}) {
  if (!always && (gShown || !hasFeature('proto3') || !inTeam() || !isOwner() || !inSeasonWindow())) return null;
  gShown = true;
  const LK = `ssaka.grad.later.${state.user?.uid}`; const day = new Date().toDateString();
  try { if (!always && !force() && localStorage.getItem(LK) === day) return null; } catch { /* */ }
  let list;
  try { list = gradList((await getDocs(collection(db, 'teams', state.team.id, 'members'))).docs.map((d) => ({ id: d.id, ...d.data() }))); } catch { return null; }
  if (!list.length) return null;
  const yr = seasonYear();
  const m = modal(`<span class="eyebrow">GRADUATION</span><h2>졸업한 선수가 있어요 <small class="muted" data-gcnt>${list.length}명</small></h2>
    <p class="muted small">${yr}년이 되면서 학교가 바뀌는 선수예요. <b>상급학교 팀으로 이적</b>을 보내거나 <b>내보내기</b>를 해 주세요. 우리 팀에서 쓴 일지 · 기록은 우리 팀에 남아요.</p>
    <ul class="list gr-list">${list.map((x) => { const g = gradOf(x); return `<li data-gid="${esc(x.id)}"><div class="gr-who"><b>${x.number ? `${esc(x.number)} ` : ''}${esc(x.name || '')}</b><small>작년 ${esc(g.from)} → ${esc(g.to)}</small></div>
      <div class="row gr-acts"><button type="button" class="btn sm" data-gtr>상급학교로 이적</button><button type="button" class="btn ghost sm" data-gkick>내보내기</button><button type="button" class="link-btn small" data-gkeep>우리 팀에 그대로</button></div>
      <div class="gr-tbox" hidden><input type="search" placeholder="보낼 팀 이름 · 대표 이름 검색" data-gq><ul class="team-results" data-gres></ul></div></li>`; }).join('')}</ul>
    <div class="row end ns-acts"><button type="button" class="btn ghost" data-later>나중에</button></div>`, { wide: true });
  m.el.querySelector('[data-later]').onclick = () => { try { localStorage.setItem(LK, day); } catch { /* */ } m.close(); };
  const done = (li, msg) => { li.remove(); toast(msg); onDone?.(); const c = m.el.querySelectorAll('[data-gid]').length; const h = m.el.querySelector('[data-gcnt]'); if (h) h.textContent = `${c}명`; if (!m.el.querySelector('[data-gid]')) { m.close(); toast('졸업 정리를 마쳤어요.'); } };
  let teams = null;
  m.el.querySelectorAll('[data-gid]').forEach((li) => {
    const x = list.find((y) => y.id === li.dataset.gid);
    li.querySelector('[data-gtr]').onclick = () => { const b = li.querySelector('.gr-tbox'); b.hidden = !b.hidden; if (!b.hidden) b.querySelector('input').focus(); };
    li.querySelector('[data-gkick]').onclick = async () => {
      if (!(await confirmBox(`${x.name}님을 팀에서 내보낼까요? 다시 들어오려면 팀 코드로 신청해야 해요.`))) return;
      try { await removeMember(x); done(li, `${x.name}님을 내보냈어요.`); } catch (e) { fail(e); }
    };
    li.querySelector('[data-gkeep]').onclick = async () => {
      try { await updateDoc(doc(db, 'teams', state.team.id, 'members', x.id), { gradKeep: yr }); done(li, `${x.name}님은 우리 팀에 그대로 있어요.`); } catch (e) { fail(e); }
    };
    li.querySelector('[data-gq]').oninput = async (ev) => {
      const q = ev.target.value.trim().toLowerCase(); const box = li.querySelector('[data-gres]');
      if (!q) { box.innerHTML = ''; return; }
      if (!teams) {
        box.innerHTML = '<li class="muted small">불러오는 중…</li>';
        try { teams = (await getDocs(query(collection(db, 'teams'), where('status', '==', 'active')))).docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => t.id !== state.team.id && !t.hidden); } catch (e) { box.innerHTML = `<li class="muted small">${esc(e.message || e)}</li>`; return; }
      }
      const hit = teams.filter((t) => `${t.name || ''} ${t.ownerName || ''}`.toLowerCase().includes(q)).slice(0, 6);
      box.innerHTML = hit.length ? hit.map((t) => `<li class="talk"><a href="javascript:void 0"><span class="cat">${esc(t.category || '')}</span><strong>${esc(t.name)}</strong><span class="lock">${esc(t.ownerName || '')}</span></a><button type="button" class="btn sm" data-to="${esc(t.id)}">이적 보내기</button></li>`).join('') : '<li class="muted small">검색 결과가 없어요.</li>';
      box.querySelectorAll('[data-to]').forEach((b) => (b.onclick = async () => {
        const to = teams.find((t) => t.id === b.dataset.to);
        if (!(await confirmBox(`${x.name}님을 ${to.name} 팀으로 이적 보낼까요? 우리 팀에서 바로 빠지고, ${to.name} 대표가 승인하면 그 팀에 들어가요.`))) return;
        try { await transferMember(x, to); done(li, `${x.name}님을 ${to.name} 팀으로 보냈어요. 그 팀 대표가 승인하면 들어가요.`); } catch (e) { fail(e); }
      }));
    };
  });
  return m;
}
// 지도자 홈 카드의 '졸업 정리하기' 버튼
document.addEventListener('click', (e) => { if (e.target.closest?.('[data-gradfix]')) gradPopup({ always: true, onDone: () => document.querySelector('[data-gradn]')?.remove() }); });
