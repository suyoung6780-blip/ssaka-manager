import {
  db, collection, doc, query, where, orderBy, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, serverTimestamp,
} from '../fb.js';
import {
  esc, text, toast, fail, formData, modal, confirmBox, fmtDate, todayStr, pageHead, empty, options, avatar,
  ROLES, MATCH_TYPES,
} from '../ui.js';
import { state, isCoach, isOwner } from '../store.js';
import { createPad, formationData } from '../tactic.js';

const tcol = (...p) => collection(db, 'teams', state.team.id, ...p);
const tdoc = (...p) => doc(db, 'teams', state.team.id, ...p);

// all: 입장 승인 대기 멤버까지 (락커룸 승인 목록용)
async function members(all = false) {
  const s = await getDocs(tcol('members'));
  return s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => all || m.approved !== false);
}
const nameOf = (list, id) => list.find((m) => m.id === id)?.name || '';

// ───────── 게임모델 ─────────
const MODEL_FIELDS = [
  ['philosophy', '팀 철학 · 스타일'],
  ['inPossession', '공격 원칙 (In Possession)'],
  ['outPossession', '수비 원칙 (Out of Possession)'],
  ['transition', '전환 (공격↔수비)'],
  ['setPieces', '세트피스'],
  ['rules', '팀 규칙'],
];

export async function gameModel(el) {
  const [snap, list] = await Promise.all([getDoc(tdoc('private', 'gameModel')), members()]);
  const gm = snap.data() || {};
  const players = list.filter((m) => m.role === 'player');

  const view = () => {
    el.innerHTML = `${pageHead('GAME MODEL', '게임모델', isCoach() ? '<button class="btn" data-edit>편집</button>' : '')}
    <div class="gm">
      <section class="card">
        <div class="card-head"><h3>기본 포메이션 ${esc(gm.formation || '')}</h3></div>
        <div data-pad></div>
      </section>
      <section class="card">
        <h3>주장단</h3>
        <div class="captains">
          ${[['captain', '주장', 'C'], ['viceCaptain', '부주장', 'VC']].map(([k, l, b]) => {
            const m = list.find((x) => x.id === gm[k]);
            return `<div class="captain">${m ? avatar(m.photo, m.name, 'lg') : '<span class="avatar lg">-</span>'}<span class="badge">${b}</span><strong>${esc(m?.name || '미지정')}</strong><small>${l}</small></div>`;
          }).join('')}
        </div>
        ${MODEL_FIELDS.map(([k, l]) => gm[k] ? `<h4>${l}</h4><div class="prose">${text(gm[k])}</div>` : '').join('')}
        ${!MODEL_FIELDS.some(([k]) => gm[k]) ? empty('아직 게임모델이 작성되지 않았습니다.') : ''}
      </section>
    </div>`;
    createPad(el.querySelector('[data-pad]'), gm.pad || formationData(gm.formation || '4-3-3', false), { editable: false });
    el.querySelector('[data-edit]')?.addEventListener('click', edit);
  };

  const edit = () => {
    el.innerHTML = `${pageHead('GAME MODEL', '게임모델 편집')}
    <form class="stack">
      <section class="card"><h3>포메이션 · 배치</h3><div data-pad></div></section>
      <section class="card">
        <div class="grid2">
          <label>주장<select name="captain"><option value="">-</option>${options(players.map((p) => [p.id, p.name]), gm.captain)}</select></label>
          <label>부주장<select name="viceCaptain"><option value="">-</option>${options(players.map((p) => [p.id, p.name]), gm.viceCaptain)}</select></label>
        </div>
        ${MODEL_FIELDS.map(([k, l]) => `<label>${l}<textarea name="${k}" rows="3">${esc(gm[k] || '')}</textarea></label>`).join('')}
        <div class="row end"><button type="button" class="btn ghost" data-cancel>취소</button><button class="btn">저장</button></div>
      </section>
    </form>`;
    const pad = createPad(el.querySelector('[data-pad]'), gm.pad || formationData('4-3-3', false));
    el.querySelector('[data-cancel]').onclick = view;
    el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const d = formData(e.target);
      const padData = pad.getData();
      const next = { ...d, pad: padData, formation: padData.formation || '', updatedAt: serverTimestamp() };
      try {
        await setDoc(tdoc('private', 'gameModel'), next);
        Object.assign(gm, next);
        toast('저장했습니다.');
        view();
      } catch (err) { fail(err); }
    };
  };
  view();
}

// ───────── 락커룸 ─────────
export async function locker(el) {
  const list = await members(true);
  let code = '';
  if (isCoach()) {
    try { code = (await getDoc(tdoc('private', 'billing'))).data()?.code || ''; } catch { /* */ }
  }
  const group = (r) => list.filter((m) => m.role === r && m.approved !== false).sort((a, b) => (+a.number || 99) - (+b.number || 99));
  const waiting = isOwner() ? list.filter((m) => m.approved === false) : []; // 팀 대표만 승인

  el.innerHTML = `${pageHead('LOCKER ROOM', '락커룸', code ? `<button class="btn ghost" data-code>팀 코드 ${esc(code)} 복사</button>` : '')}
    <p class="lead">선수 · 지도자는 팀 코드로 입장을 신청하고, 팀 대표가 승인하면 락커룸에 들어옵니다.</p>
    ${waiting.length ? `<section class="card wait-box"><h3>입장 승인 대기 <small>${waiting.length}명</small></h3>
      <p class="muted small">팀 코드로 들어온 사람이에요. 우리 팀 선수 · 지도자가 맞는지 확인하고 승인해 주세요. 승인 전에는 팀 내용을 볼 수 없어요.
        만 14세 미만은 보호자 동의 내용도 확인해 주세요.</p>
      <ul class="list">${waiting.map((m) => `<li><div><strong>${esc(m.name)} <span class="tag">${esc(ROLES[m.role] || '')}</span>${m.under14 ? ' <span class="tag warn">만 14세 미만</span>' : ''}</strong>
        <small>${esc([m.position, m.number && `${m.number}번`, m.affiliation, m.coachTitle].filter(Boolean).join(' · ') || '')}</small>
        ${m.under14 ? `<small data-g="${esc(m.consentToken || '')}">보호자 정보 불러오는 중…</small>` : ''}</div>
        <span><button class="btn sm" data-gok="${m.id}">승인</button> <button class="link-btn small" data-gno="${m.id}">거절</button></span></li>`).join('')}</ul></section>` : ''}
    ${['coach', 'player'].map((r) => {
      const g = group(r);
      if (!g.length) return '';
      return `<h2 class="sec-title">${ROLES[r]} <small>${g.length}</small></h2>
      <div class="roster">${g.map((m) => playerCard(m, { manage: isOwner() && m.id !== state.user.uid })).join('')}</div>`;
    }).join('')}`;

  el.querySelector('[data-code]')?.addEventListener('click', () => navigator.clipboard.writeText(code).then(() => toast('팀 코드를 복사했습니다.')));
  // 만 14세 미만: 보호자 정보(이름 · 관계 · 연락처)
  el.querySelectorAll('[data-g]').forEach(async (sm) => {
    try {
      const c = sm.dataset.g && (await getDoc(doc(db, 'consents', sm.dataset.g))).data();
      sm.textContent = c?.status === 'agreed' ? `보호자 ${c.guardianName} (${c.relation}) · ${c.phone.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3')} · 온라인 동의함` : '보호자 온라인 동의 기록 없음 — 직접 확인해 주세요';
    } catch { sm.textContent = '보호자 정보를 불러오지 못했어요'; }
  });
  el.querySelectorAll('[data-gok]').forEach((b) => (b.onclick = async () => {
    try {
      await updateDoc(tdoc('members', b.dataset.gok), { approved: true, approvedBy: state.profile.name, approvedAt: serverTimestamp() });
      toast('승인했어요. 이제 팀 내용을 볼 수 있어요.'); locker(el);
    } catch (e) { fail(e); }
  }));
  el.querySelectorAll('[data-gno]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('입장을 거절할까요? 거절하면 팀에서 빠지고, 다시 팀 코드로 신청할 수 있어요.'))) return;
    try { await deleteDoc(tdoc('members', b.dataset.gno)); locker(el); } catch (e) { fail(e); }
  }));
  el.querySelectorAll('[data-pid]').forEach((c) => (c.onclick = (e) => {
    const m = list.find((x) => x.id === c.dataset.pid);
    if (e.target.closest('[data-kick]')) return kick(m);
    profileModal(m);
  }));

  async function kick(m) {
    if (!(await confirmBox(`${m.name}님을 팀에서 내보낼까요?`))) return;
    try { await deleteDoc(tdoc('members', m.id)); toast('내보냈습니다.'); locker(el); } catch (e) { fail(e); }
  }
}

export function playerCard(m, { manage = false, extra = '' } = {}) {
  return `<article class="pcard" data-pid="${m.id}">
    ${avatar(m.photo, m.name, 'card')}
    <div class="pcard-body">
      <div class="pcard-top">${m.role === 'coach'
        ? `<span class="pos">${esc(m.coachTitle || ROLES.coach)}</span>`
        : `${m.number ? `<span class="num">${esc(m.number)}</span>` : ''}<span class="pos">${esc(m.position || ROLES[m.role] || '')}</span>`}</div>
      <strong>${esc(m.name)}</strong>
      <small>${(m.role === 'coach'
        ? [m.duty, licenseText(m).split(', ')[0]]
        : [m.height && `${m.height}cm`, m.weight && `${m.weight}kg`]).filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</small>
      ${extra}
      ${manage ? '<button class="link-btn small" data-kick>내보내기</button>' : ''}
    </div>
  </article>`;
}

const licenseText = (m) => [m.licenses, m.licenseEtc].filter(Boolean).join(', ');

export function profileModal(m, actions = '') {
  const coach = m.role === 'coach';
  const kv = (k, v) => `<div class="kv"><span>${k}</span><strong>${esc(v || '-')}</strong></div>`;
  const rows = coach
    ? [kv('직책', m.coachTitle), kv('담당', m.duty), kv('자격증', licenseText(m)), kv('출신학교', m.school),
      m.career ? `<div class="kv top"><span>지도 경력</span><strong class="pre">${esc(m.career)}</strong></div>` : '']
    : [kv('소속', m.affiliation), kv('포지션', m.position), kv('키 · 몸무게', `${m.height || '-'}cm · ${m.weight || '-'}kg`),
      kv('주발', { R: '오른발', L: '왼발', B: '양발' }[m.foot]), kv('출생연도', m.birthYear)];
  return modal(`
    <div class="profile-view">
      ${avatar(m.photo, m.name, 'xl')}
      <div>
        <span class="eyebrow">${esc(m.teamName || '')} ${esc(ROLES[m.role] || '')}</span>
        <h2>${m.number && !coach ? `<span class="num">${esc(m.number)}</span> ` : ''}${esc(m.name)}</h2>
        ${rows.join('')}
      </div>
    </div>
    ${actions ? `<div class="row end">${actions}</div>` : ''}`);
}

// ───────── 기록실 ─────────
export function calcStats(ms) {
  const games = ms.length;
  const w = ms.filter((m) => +m.gf > +m.ga).length;
  const d = ms.filter((m) => +m.gf === +m.ga).length;
  const l = games - w - d;
  const gf = ms.reduce((s, m) => s + (+m.gf || 0), 0);
  const ga = ms.reduce((s, m) => s + (+m.ga || 0), 0);
  const pct = (n) => (games ? Math.round((n / games) * 1000) / 10 : 0);
  return {
    games, w, d, l, gf, ga, gd: gf - ga,
    winRate: pct(w), drawRate: pct(d), lossRate: pct(l),
    cleanSheets: ms.filter((m) => +m.ga === 0).length, csRate: pct(ms.filter((m) => +m.ga === 0).length),
    gfAvg: games ? (gf / games).toFixed(2) : '0.00', gaAvg: games ? (ga / games).toFixed(2) : '0.00',
    points: w * 3 + d,
  };
}

const result = (m) => (+m.gf > +m.ga ? 'W' : +m.gf === +m.ga ? 'D' : 'L');

// 팀 구분별 학년(연령) — 기록실에서 경기마다 고르고, 학년별로 모아 봄
export const AGE_GROUPS = { U12: ['U12', 'U11', 'U10', 'U9'], U15: ['U15', 'U14', 'U13'], U18: ['U18', 'U17', 'U16'], U22: ['U22', 'U21', 'U20', 'U19'] };

export async function records(el) {
  const [snap, list] = await Promise.all([getDocs(query(tcol('matches'), orderBy('date', 'desc'))), members()]);
  const ms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const players = list.filter((m) => m.role === 'player');
  const groups = AGE_GROUPS[state.team.category] || [];
  const years = [...new Set(ms.map((m) => (m.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const flt = { year: '전체', type: '전체', age: '전체' };
  const pass = (m, skip) => (skip === 'year' || flt.year === '전체' || (m.date || '').startsWith(flt.year))
    && (skip === 'type' || flt.type === '전체' || m.matchType === flt.type)
    && (skip === 'age' || flt.age === '전체' || m.ageGroup === flt.age);
  const statTable = (title, label, pairs) => `<section class="card"><h3>${title}</h3>${pairs.length ? `<table class="tbl"><tr><th>${label}</th><th>경기</th><th>승-무-패</th><th>승률</th><th>득/실</th></tr>
    ${pairs.map(([t, x]) => `<tr><td>${esc(t)}</td><td>${x.games}</td><td>${x.w}-${x.d}-${x.l}</td><td>${x.winRate}%</td><td>${x.gf}/${x.ga}</td></tr>`).join('')}</table>` : empty('기록 없음')}</section>`;

  const draw = () => {
    const rows = ms.filter((m) => pass(m));
    const st = calcStats(rows);
    const scorers = {};
    const assists = {};
    rows.forEach((m) => {
      (m.scorers || []).forEach((s) => { scorers[s.name] = (scorers[s.name] || 0) + (+s.goals || 0); assists[s.name] ||= 0; });
      (m.assists || []).forEach((s) => { assists[s.name] = (assists[s.name] || 0) + (+s.goals || 0); });
    });
    const topS = Object.entries(scorers).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topA = Object.entries(assists).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const typeList = [...MATCH_TYPES, ...new Set(ms.map((m) => m.matchType).filter((t) => t && !MATCH_TYPES.includes(t)))];
    const byType = typeList.map((t) => [t, calcStats(ms.filter((m) => pass(m, 'type') && m.matchType === t))]).filter(([, x]) => x.games);
    const byYear = years.map((y) => [`${y}년`, calcStats(ms.filter((m) => pass(m, 'year') && (m.date || '').startsWith(y)))]).filter(([, x]) => x.games);
    const byAge = [...groups, ...(ms.some((m) => !m.ageGroup) ? ['(학년 미지정)'] : [])]
      .map((g) => [g, calcStats(ms.filter((m) => pass(m, 'age') && (g === '(학년 미지정)' ? !m.ageGroup : m.ageGroup === g)))]).filter(([, x]) => x.games);
    const opp = {};
    rows.forEach((m) => (opp[m.opponent] ||= []).push(m));

    el.innerHTML = `${pageHead('RECORDS', '기록실', isCoach() ? '<button class="btn" data-new>+ 경기 기록</button>' : '')}
    <div class="rec-filters">
      <div class="chips"><span class="chip-label">년도</span>${['전체', ...years].map((t) => `<button class="chip ${t === flt.year ? 'active' : ''}" data-f="year" data-v="${t}">${t === '전체' ? t : `${t}년`}</button>`).join('')}</div>
      <div class="chips"><span class="chip-label">경기</span>${['전체', ...MATCH_TYPES].map((t) => `<button class="chip ${t === flt.type ? 'active' : ''}" data-f="type" data-v="${t}">${t}</button>`).join('')}</div>
      ${groups.length ? `<div class="chips"><span class="chip-label">학년</span>${['전체', ...groups].map((t) => `<button class="chip ${t === flt.age ? 'active' : ''}" data-f="age" data-v="${t}">${t}</button>`).join('')}</div>` : ''}
    </div>
    <section class="stat-board">
      <div class="big"><small>승률</small><strong>${st.winRate}<i>%</i></strong>
        <div class="wdl"><i style="flex:${st.w}" class="w"></i><i style="flex:${st.d}" class="d"></i><i style="flex:${st.l}" class="l"></i></div>
        <small>${st.w}승 ${st.d}무 ${st.l}패 · ${st.games}경기</small></div>
      <div><small>득점</small><strong>${st.gf}</strong><small>경기당 ${st.gfAvg}</small></div>
      <div><small>실점</small><strong>${st.ga}</strong><small>경기당 ${st.gaAvg}</small></div>
      <div><small>골득실</small><strong>${st.gd > 0 ? '+' : ''}${st.gd}</strong><small>승점 ${st.points}</small></div>
      <div><small>클린시트</small><strong>${st.cleanSheets}</strong><small>${st.csRate}%</small></div>
      <div><small>무승부율 · 패배율</small><strong>${st.drawRate}<i>/</i>${st.lossRate}</strong><small>%</small></div>
    </section>
    <div class="form-line">최근 경기 ${rows.slice(0, 10).map((m) => `<span class="res ${result(m)}">${result(m)}</span>`).join('') || '-'}</div>
    <div class="grid2 top">
      <section class="card"><h3>득점 순위</h3>${topS.length ? `<ol class="rank">${topS.map(([n, g]) => `<li><span>${esc(n)}</span><strong>${g}</strong></li>`).join('')}</ol>` : empty('기록 없음')}</section>
      <section class="card"><h3>도움 순위</h3>${topA.length ? `<ol class="rank">${topA.map(([n, g]) => `<li><span>${esc(n)}</span><strong>${g}</strong></li>`).join('')}</ol>` : empty('기록 없음')}</section>
    </div>
    <div class="rec-tables">
      ${statTable('년도별', '년도', byYear)}
      ${statTable('경기별', '형태', byType)}
      ${groups.length ? statTable('학년별', '학년', byAge) : ''}
    </div>
    <section class="card">
      <h3>상대 전적</h3>
      ${Object.keys(opp).length ? `<table class="tbl"><tr><th>상대</th><th>경기</th><th>승-무-패</th><th>승률</th><th>득/실</th></tr>
        ${Object.entries(opp).map(([o, arr]) => { const s = calcStats(arr); return `<tr><td>${esc(o)}</td><td>${s.games}</td><td>${s.w}-${s.d}-${s.l}</td><td>${s.winRate}%</td><td>${s.gf}/${s.ga}</td></tr>`; }).join('')}</table>` : empty('기록 없음')}
    </section>
    <section class="card">
      <h3>경기 목록</h3>
      ${rows.length ? `<table class="tbl matches"><tr><th>날짜</th><th>형태</th>${groups.length ? '<th>학년</th>' : ''}<th>상대</th><th>스코어</th><th>득점</th><th></th></tr>
        ${rows.map((m) => `<tr data-mid="${m.id}"><td>${esc(m.date)}</td><td>${esc(m.matchType)}</td>${groups.length ? `<td>${esc(m.ageGroup || '-')}</td>` : ''}<td>${esc(m.opponent)}${m.venue ? ` <small>(${m.venue === 'home' ? '홈' : '원정'})</small>` : ''}</td>
          <td><span class="res ${result(m)}">${result(m)}</span> <strong>${+m.gf} : ${+m.ga}</strong></td>
          <td><small>${(m.scorers || []).map((s) => `${esc(s.name)}${+s.goals > 1 ? `(${s.goals})` : ''}`).join(', ')}</small></td>
          <td>${isCoach() ? '<button class="link-btn small" data-edit>수정</button>' : ''}</td></tr>`).join('')}</table>` : empty('경기 기록이 없습니다.')}
    </section>`;

    el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { flt[b.dataset.f] = b.dataset.v; draw(); }));
    el.querySelector('[data-new]')?.addEventListener('click', () => matchForm());
    el.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => matchForm(ms.find((m) => m.id === b.closest('tr').dataset.mid))));
  };

  // 선수별 골/도움 입력 줄
  const pickRows = (label, key, arr = []) => `
    <fieldset class="picks" data-key="${key}"><legend>${label}</legend>
      <div data-rows>${arr.map((s) => pickRow(s)).join('')}</div>
      <button type="button" class="link-btn small" data-add>+ 추가</button>
    </fieldset>`;
  const pickRow = (s = {}) => `<div class="pick"><select><option value="">선수 선택</option>${options(players.map((p) => p.name), s.name)}<option value="자책골" ${s.name === '자책골' ? 'selected' : ''}>상대 자책골</option></select>
    <input type="number" min="1" max="20" value="${esc(s.goals || 1)}"><button type="button" class="link-btn" data-rm>✕</button></div>`;

  function matchForm(m = {}) {
    const md = modal(`
      <span class="eyebrow">MATCH</span><h2>${m.id ? '경기 수정' : '경기 기록'}</h2>
      <form class="stack">
        <div class="grid2">
          <label>날짜<input type="date" name="date" required value="${esc(m.date || todayStr())}"></label>
          <label>경기 형태<select name="matchType">${options(MATCH_TYPES, m.matchType)}</select></label>
          ${groups.length ? `<label>학년<select name="ageGroup">${options([['', '선택'], ...groups], m.ageGroup || (flt.age !== '전체' ? flt.age : ''))}</select></label>` : ''}
          <label>상대팀<input name="opponent" required value="${esc(m.opponent || '')}"></label>
          <label>홈/원정<select name="venue">${options([['home', '홈'], ['away', '원정'], ['neutral', '중립']], m.venue)}</select></label>
          <label>득점<input type="number" name="gf" min="0" required value="${esc(m.gf ?? 0)}"></label>
          <label>실점<input type="number" name="ga" min="0" required value="${esc(m.ga ?? 0)}"></label>
        </div>
        ${pickRows('득점자', 'scorers', m.scorers)}
        ${pickRows('도움', 'assists', m.assists)}
        <label>메모<textarea name="memo" rows="3">${esc(m.memo || '')}</textarea></label>
        <div class="row end">${m.id ? '<button type="button" class="btn ghost" data-del>삭제</button>' : ''}<button class="btn">저장</button></div>
      </form>`);
    const f = md.el.querySelector('form');
    f.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => b.previousElementSibling.insertAdjacentHTML('beforeend', pickRow())));
    f.addEventListener('click', (e) => { if (e.target.matches('[data-rm]')) e.target.parentElement.remove(); });
    md.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmBox('경기 기록을 삭제할까요?'))) return;
      try { await deleteDoc(tdoc('matches', m.id)); md.close(); records(el); } catch (err) { fail(err); }
    });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = formData(f);
      const read = (key) => [...f.querySelectorAll(`[data-key="${key}"] .pick`)]
        .map((r) => ({ name: r.querySelector('select').value, goals: +r.querySelector('input').value || 1 }))
        .filter((s) => s.name);
      const data = { ...d, gf: +d.gf, ga: +d.ga, scorers: read('scorers'), assists: read('assists') };
      try {
        if (m.id) await updateDoc(tdoc('matches', m.id), data);
        else await addDoc(tcol('matches'), { ...data, createdAt: serverTimestamp() });
        md.close();
        records(el);
      } catch (err) { fail(err); }
    };
  }

  draw();
}

// ───────── 상담실 ─────────
export async function counsel(el) {
  const q = isCoach()
    ? query(tcol('counsel'), orderBy('createdAt', 'desc'))
    : query(tcol('counsel'), where('authorUid', '==', state.user.uid), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  const threads = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  el.innerHTML = `${pageHead('COUNSEL ROOM', '상담실', isCoach() ? '' : '<button class="btn" data-new>+ 상담 신청</button>')}
    <p class="lead">${isCoach() ? '선수들의 상담 요청입니다. 작성자와 코치만 볼 수 있습니다.' : '코치에게만 공개됩니다. 편하게 이야기하세요.'}</p>
    ${threads.length ? `<ul class="list threads">${threads.map((t) => `
      <li data-id="${t.id}"><div><strong>${esc(t.title)}</strong>
      <small>${isCoach() ? `${esc(t.authorName)} · ` : ''}${fmtDate(t.createdAt, true)}</small></div>
      <span class="tag ${t.status === 'answered' ? 'solid' : ''}">${t.status === 'answered' ? '답변 완료' : '대기'}</span></li>`).join('')}</ul>`
    : empty('상담 내역이 없습니다.')}`;

  el.querySelector('[data-new]')?.addEventListener('click', () => {
    const m = modal(`<span class="eyebrow">COUNSEL</span><h2>상담 신청</h2>
      <form class="stack">
        <label>주제<select name="topic">${options(['훈련', '경기', '부상·몸상태', '진로', '학업', '팀생활', '기타'])}</select></label>
        <label>제목<input name="title" required maxlength="60"></label>
        <label>내용<textarea name="body" rows="6" required></textarea></label>
        <div class="row end"><button class="btn">보내기</button></div>
      </form>`);
    m.el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await addDoc(tcol('counsel'), {
          ...formData(e.target), authorUid: state.user.uid, authorName: state.profile.name, status: 'open', createdAt: serverTimestamp(),
        });
        m.close();
        counsel(el);
      } catch (err) { fail(err); }
    };
  });

  el.querySelectorAll('[data-id]').forEach((li) => (li.onclick = async () => {
    const t = threads.find((x) => x.id === li.dataset.id);
    const rs = await getDocs(query(tcol('counsel', t.id, 'replies'), orderBy('createdAt')));
    const m = modal(`<span class="eyebrow">COUNSEL · ${esc(t.topic || '')}</span><h2>${esc(t.title)}</h2>
      <div class="bubbles">
        <div class="bubble"><small>${esc(t.authorName)} · ${fmtDate(t.createdAt, true)}</small>${text(t.body)}</div>
        ${rs.docs.map((d) => { const r = d.data(); return `<div class="bubble ${r.uid === state.user.uid ? 'me' : ''}"><small>${esc(r.name)} · ${fmtDate(r.createdAt, true)}</small>${text(r.body)}</div>`; }).join('')}
      </div>
      <form class="inline-form"><textarea name="body" rows="2" required placeholder="${isCoach() ? '답변 작성' : '추가로 남길 말'}"></textarea><button class="btn">전송</button></form>`);
    m.el.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await addDoc(tcol('counsel', t.id, 'replies'), {
          body: e.target.body.value, uid: state.user.uid, name: state.profile.name, createdAt: serverTimestamp(),
        });
        await updateDoc(tdoc('counsel', t.id), { status: isCoach() ? 'answered' : 'open', updatedAt: serverTimestamp() });
        m.close();
        toast('전송했습니다.');
        counsel(el);
      } catch (err) { fail(err); }
    };
  }));
}
