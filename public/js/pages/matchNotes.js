// MATCH > 경기 노트 — 지도자가 경기 중에 휴대폰으로 짧은 메모 (적기 시작한 순간의 경기 시각이 저절로 붙음)
// 저장: teams/{t}/matchNotes/{id} (상대 · 날짜 · 경기 방식 · 시계 · 연결한 기록실 경기 matchId) + items/{id} (메모 한 줄씩) — 우리 팀 지도자만 읽고 씀
//  메모에 선수 지정(uids) · [선수에게 보여주기]를 켠 메모만 그 선수가 읽음(seeUids) — 기록실 경기(matches.noteId)에서 봄
// 인터넷이 약해도: 메모는 바로 화면에 붙고 저장은 뒤에서 (안 된 건 '저장 중' 표시 · 이 기기에도 보관)
import {
  db, collection, doc, query, where, orderBy, limit, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, writeBatch,
} from '../fb.js';
import { esc, text, toast, fail, modal, confirmBox, todayStr, pageHead, empty } from '../ui.js';
import { state, go, isCoach } from '../store.js';

// 경기 방식 (경기 일지와 같은 이름)
const PERIODS = [[1, '통으로 한 번'], [2, '전반 · 후반 (2번)'], [3, '3쿼터'], [4, '4쿼터']];
const pName = (n, i) => (n === 1 ? '경기' : n === 2 ? ['전반', '후반'][i] : `${i + 1}쿼터`);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const fmtD = (d) => { const x = new Date(`${d}T00:00`); return `${x.getMonth() + 1}월 ${x.getDate()}일 (${DOW[x.getDay()]})`; };
const col = () => collection(db, 'teams', state.team.id, 'matchNotes');
const toMs = (v) => (v?.toMillis ? v.toMillis() : +v || 0);
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

// 지금 경기 시각 → 메모에 붙일 이름 ('전반 12′' · '전반 25+2′' · '하프타임' · '경기 전' · '경기 뒤')
function stamp(n, now = Date.now()) {
  const c = n.clock || { phase: 'before' };
  const P = n.periods || 2;
  if (c.phase === 'before') return { p: -1, m: 0, label: '경기 전' };
  if (c.phase === 'end') return { p: 99, m: 0, label: '경기 뒤' };
  if (c.phase === 'break') return { p: c.idx + 0.5, m: 0, label: P === 2 ? '하프타임' : '쉬는 시간' };
  const m = Math.floor((now - c.startAt) / 60000) + 1;
  const L = n.plen || 25;
  return { p: c.idx, m, label: `${pName(P, c.idx)} ${m > L ? `${L}+${m - L}` : m}′` };
}

// ───────── 목록 ─────────
export async function page(el, p = {}) {
  if (!isCoach()) return mine(el); // 선수: 나에게 온 경기 피드백
  if (p.id) return live(el, p.id);
  const today = todayStr();
  const [ns, gm, sc] = await Promise.all([
    getDocs(query(col(), orderBy('date', 'desc'), limit(100))),
    getDocs(query(collection(db, 'teams', state.team.id, 'matches'), where('date', '==', today))).catch(() => null),
    getDocs(query(collection(db, 'teams', state.team.id, 'posts'), where('type', '==', 'schedule'), where('date', '==', today))).catch(() => null),
  ]);
  const notes = ns.docs.map((d) => ({ id: d.id, ...d.data() }));
  // 오늘 경기 (기록실 · 스케줄) → 바로 시작
  // 기록실 경기는 '오늘 vs 상대' · 스케줄 경기는 일정 이름 그대로 (상대 칸은 비워 두고 시작 창에서 적음)
  const todayGames = [...(gm?.docs || []).filter((d) => d.data().opponent && !d.data().noteId).map((d) => [`오늘 vs ${d.data().opponent}`, d.data().opponent, d.id]),
    ...(sc?.docs || []).map((d) => d.data()).filter((x) => x.kind === '경기').map((x) => [`오늘 ${[x.time, x.title].filter(Boolean).join(' ')}`.trim(), x.opponent || '', ''])];
  const started = new Set(notes.filter((x) => x.date === today).map((x) => x.opponent));
  const seen = new Set();
  el.innerHTML = `${pageHead('MATCH NOTES', '경기 노트', '<button class="btn" data-new>+ 새 경기 노트</button>')}
    <p class="muted mn-intro">경기 중에 휴대폰으로 짧게 적으면 <b>경기 시각이 저절로</b> 붙어요 (전반 12′ 처럼). 우리 팀 지도자끼리만 보고, 같이 적을 수 있어요.</p>
    ${todayGames.filter(([lb, o]) => !(o && started.has(o)) && !seen.has(lb) && seen.add(lb)).map(([lb, o, mid]) => `<button class="mn-today" data-quick="${esc(o)}" data-mid="${esc(mid)}"><span class="eyebrow">TODAY</span><b>${esc(lb)}</b><em>경기 노트 시작 ›</em></button>`).join('')}
    <div class="mn-list">${notes.length ? notes.map((x) => `<a class="mn-row" href="#/match-notes/${esc(x.id)}">
      <span class="date-badge">${esc(x.date.slice(5).replace('-', '.'))}</span>
      <div><strong>vs ${esc(x.opponent || '상대')}</strong><small>${esc(PERIODS.find(([k]) => k === (x.periods || 2))?.[1] || '')} · ${x.plen || 25}분 · 메모 ${x.count || 0}개</small></div>
      ${x.matchId ? '<span class="tag">기록실</span>' : ''}${x.clock?.phase === 'run' ? '<span class="tag solid">경기 중</span>' : x.clock?.phase === 'end' ? '<span class="tag">끝</span>' : ''}</a>`).join('') : empty('아직 경기 노트가 없어요. [+ 새 경기 노트]로 시작해요.')}</div>`;
  const last = notes[0] || {};
  el.querySelector('[data-new]').onclick = () => newNote({ periods: last.periods, plen: last.plen });
  el.querySelectorAll('[data-quick]').forEach((b) => (b.onclick = () => newNote({ periods: last.periods, plen: last.plen, opponent: b.dataset.quick, matchId: b.dataset.mid })));
}

function newNote(d = {}) {
  const per = d.periods || 2; const len = d.plen || 25;
  const m = modal(`<span class="eyebrow">MATCH NOTE</span><h2>새 경기 노트</h2>
    <form class="stack">
      <label>상대 팀<input name="opponent" required maxlength="30" value="${esc(d.opponent || '')}" placeholder="예) 수원 U12"></label>
      <label>날짜<input type="date" name="date" required value="${todayStr()}"></label>
      <div class="grid2"><label>경기 방식<select name="periods">${PERIODS.map(([k, lb]) => `<option value="${k}" ${k === per ? 'selected' : ''}>${lb}</option>`).join('')}</select></label>
        <label>한 번 시간 (분)<input type="number" name="plen" min="5" max="90" inputmode="numeric" value="${len}"></label></div>
      <button class="btn full">만들고 시작하기</button>
    </form>`);
  m.el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const ref = doc(col());
    try {
      await setDoc(ref, { opponent: f.opponent.value.trim(), date: f.date.value, periods: +f.periods.value || 2, plen: Math.max(5, Math.min(90, +f.plen.value || 25)),
        clock: { phase: 'before' }, count: 0, matchId: d.matchId || '', by: state.profile.name || '', byUid: state.user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      if (d.matchId) await updateDoc(doc(db, 'teams', state.team.id, 'matches', d.matchId), { noteId: ref.id }).catch(() => {});
      m.close();
      go(`/match-notes/${ref.id}`);
    } catch (err) { fail(err); }
  };
}

// ───────── 경기 중: 시계 + 메모 ─────────
async function live(el, id) {
  const ref = doc(col(), id);
  const snap = await getDoc(ref);
  if (!snap.exists()) { el.innerHTML = `${pageHead('MATCH NOTE', '경기 노트', '<a class="btn ghost" href="#/match-notes">목록</a>')}${empty('지워졌거나 없는 경기 노트예요.')}`; return; }
  let n = { id, ...snap.data() };
  const P = () => n.periods || 2;
  const [mem, gms] = await Promise.all([
    getDocs(collection(db, 'teams', state.team.id, 'members')).catch(() => null),
    getDocs(query(collection(db, 'teams', state.team.id, 'matches'), where('date', '==', n.date))).catch(() => null),
  ]);
  const players = (mem?.docs || []).map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.role === 'player' && m.approved !== false).sort((a, b) => (+a.number || 99) - (+b.number || 99));
  const pOf = Object.fromEntries(players.map((x) => [x.id, x]));
  const pLabel = (u) => { const x = pOf[u]; return x ? `${x.number ? `${x.number} ` : ''}${x.name}` : ''; };
  const games = (gms?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
  const BK = `ssaka.mn.${id}`; // 이 기기 보관 (저장이 안 된 메모)
  let items = new Map(); // id → 메모 (서버 + 아직 저장 중)
  try { (JSON.parse(localStorage.getItem(BK) || '[]')).forEach((x) => items.set(x.id, { ...x, pending: true })); } catch { /* */ }
  el.innerHTML = `${pageHead('MATCH NOTE', `vs ${esc(n.opponent || '상대')}`, '<a class="btn ghost sm" href="#/match-notes">목록</a><button class="btn ghost sm" data-copy>글로 복사</button><button class="btn ghost sm" data-del>지우기</button>')}
    <p class="muted small mn-sub">${esc(fmtD(n.date))} · ${esc(PERIODS.find(([k]) => k === P())?.[1] || '')} × ${n.plen || 25}분</p>
    <div class="mn-link" data-link></div>
    <section class="card mn-clock" data-clock></section>
    <div class="mn-items" data-items></div>
    <form class="mn-input" data-form>
      <span class="mn-at" data-at></span>
      ${players.length ? `<div class="mn-pl" data-pl>${players.map((x) => `<button type="button" class="chip" data-u="${esc(x.id)}">${x.number ? `<b>${esc(x.number)}</b> ` : ''}${esc(x.name)}</button>`).join('')}</div>
      <label class="mini-switch mn-share" data-sharebox hidden><input type="checkbox" data-share> 고른 선수에게 보여주기 <small class="muted">(그 선수만 기록실에서 봐요)</small></label>` : ''}
      <textarea name="t" rows="2" maxlength="300" placeholder="한 줄로 적어요 — 예) 왼쪽 뒷공간 계속 뚫림 · 7번 첫 터치 좋음" enterkeyhint="send"></textarea>
      <div class="mn-btns"><button type="button" class="btn ghost mn-penbtn" data-pen aria-pressed="false" title="태블릿 펜으로 손글씨 → 글자">펜</button><button class="btn" data-send>적기</button></div>
      <p class="mn-penhelp muted small" data-penhelp hidden><b>펜으로 쓰면 글자로 바뀌어요.</b> 아이패드: 설정 › Apple Pencil › <b>손글씨 입력</b> 켜기 · 갤럭시: S펜을 칸에 대면 나오는 <b>펜으로 입력</b> (또는 삼성 키보드의 필기 입력) — 다 쓰면 [적기]</p>
    </form>`;
  const $ = (q) => el.querySelector(q);
  const form = $('[data-form]'); const ta = form.t;

  // 시계
  let tick = 0;
  const drawClock = () => {
    const c = n.clock || { phase: 'before' };
    const L = n.plen || 25;
    const next = c.phase === 'before' ? ['start', `${pName(P(), 0)} 시작`] : c.phase === 'run' ? ['stop', c.idx === P() - 1 ? '경기 끝' : `${pName(P(), c.idx)} 끝`] : c.phase === 'break' ? ['start', `${pName(P(), c.idx + 1)} 시작`] : null;
    const el2 = c.phase === 'run' ? Date.now() - c.startAt : 0;
    $('[data-clock]').innerHTML = `<div class="mn-ph"><span class="mn-st ${c.phase}">${c.phase === 'run' ? pName(P(), c.idx) : c.phase === 'break' ? `${pName(P(), c.idx)} 끝 · ${stamp(n).label}` : stamp(n).label}</span>
        ${c.phase === 'run' ? `<b class="mn-time ${el2 > L * 60000 ? 'over' : ''}">${mmss(el2)}</b><small data-over>/ ${L}:00${el2 > L * 60000 ? ` · 추가 시간 ${mmss(el2 - L * 60000)}` : ''}</small>` : ''}</div>
      <div class="mn-acts">${next ? `<button type="button" class="btn ${next[0] === 'start' ? '' : 'ghost'}" data-next="${next[0]}">${next[1]}</button>` : '<span class="muted small">경기가 끝났어요 — 메모는 계속 적을 수 있어요</span>'}
        ${c.phase === 'run' ? '<button type="button" class="link-btn small" data-fix>시계 고치기</button>' : ''}${c.phase === 'end' ? '<button type="button" class="link-btn small" data-reopen>다시 열기</button>' : ''}</div>`;
    $('[data-next]')?.addEventListener('click', () => step($('[data-next]').dataset.next));
    $('[data-fix]')?.addEventListener('click', fixClock);
    $('[data-reopen]')?.addEventListener('click', () => saveClock({ phase: 'run', idx: P() - 1, startAt: Date.now() - (n.plen || 25) * 60000 }));
    if (!ta.value) $('[data-at]').textContent = `${stamp(n).label}에 적어요`;
  };
  const saveClock = (clock) => {
    n = { ...n, clock };
    drawClock(); wake();
    updateDoc(ref, { clock, updatedAt: serverTimestamp() }).catch(() => toast('시계를 저장하지 못했어요. 인터넷을 확인해 주세요.'));
  };
  const step = (k) => {
    const c = n.clock || { phase: 'before' };
    if (k === 'start') saveClock({ phase: 'run', idx: c.phase === 'before' ? 0 : c.idx + 1, startAt: Date.now() });
    else saveClock(c.idx >= P() - 1 ? { phase: 'end', idx: c.idx } : { phase: 'break', idx: c.idx });
  };
  const fixClock = async () => {
    const c = n.clock;
    const m = modal(`<span class="eyebrow">CLOCK</span><h2>시계 고치기</h2><p class="muted">${pName(P(), c.idx)}이 지금 몇 분 지났나요? (시작 버튼을 늦게 눌렀을 때)</p>
      <form class="stack"><label>지난 시간 (분)<input type="number" name="m" min="0" max="120" inputmode="numeric" value="${Math.floor((Date.now() - c.startAt) / 60000)}"></label><button class="btn full">이 시간으로 맞추기</button></form>`);
    m.el.querySelector('form').onsubmit = (e) => { e.preventDefault(); saveClock({ ...c, startAt: Date.now() - (+e.target.m.value || 0) * 60000 }); m.close(); };
  };
  // 경기 중엔 화면이 꺼지지 않게 (되는 기기에서만)
  let lock = null;
  const wake = async () => {
    const run = n.clock?.phase === 'run' || n.clock?.phase === 'break';
    try { if (run && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener?.('release', () => { lock = null; }); } else if (!run && lock) { await lock.release(); lock = null; } } catch { lock = null; }
  };
  const onVis = () => { if (document.visibilityState === 'visible') { lock = null; wake(); drawClock(); } };
  document.addEventListener('visibilitychange', onVis);
  // 1초마다 시간 글자만 바꿈 (버튼은 그대로 — 누르는 중에 다시 그려져 놓치지 않게)
  tick = setInterval(() => {
    if (n.clock?.phase !== 'run') return;
    const t = $('[data-clock] .mn-time'); if (!t) return;
    const L = (n.plen || 25) * 60000; const e2 = Date.now() - n.clock.startAt;
    t.textContent = mmss(e2); t.classList.toggle('over', e2 > L);
    $('[data-over]').textContent = `/ ${n.plen || 25}:00${e2 > L ? ` · 추가 시간 ${mmss(e2 - L)}` : ''}`;
    if (!ta.value) $('[data-at]').textContent = `${stamp(n).label}에 적어요`;
  }, 1000);
  state.cleanup.push(() => { clearInterval(tick); document.removeEventListener('visibilitychange', onVis); lock?.release?.().catch?.(() => {}); });

  // 메모 목록 (시각 순서 · 맨 아래가 최신)
  const drawItems = () => {
    const rows = [...items.values()].sort((a, b) => a.at - b.at);
    const box = $('[data-items]');
    const atBottom = box.getBoundingClientRect().bottom - innerHeight < 80;
    let lastP = null;
    box.innerHTML = rows.length ? rows.map((x) => {
      const head = x.p !== lastP ? `<h4 class="mn-gh">${x.p === -1 ? '경기 전' : x.p === 99 ? '경기 뒤' : x.p % 1 ? (P() === 2 ? '하프타임' : `${pName(P(), Math.floor(x.p))} 뒤 쉬는 시간`) : pName(P(), x.p)}</h4>` : '';
      lastP = x.p;
      const who = (x.uids || []).map(pLabel).filter(Boolean);
      return `${head}<div class="mn-item ${x.pending ? 'pending' : ''}" data-i="${esc(x.id)}"><span class="mn-t">${esc(x.label)}</span><p>${who.length ? `<span class="mn-who">${who.map((w) => `<b>${esc(w)}</b>`).join('')}${x.shared ? '<em>선수에게 보임</em>' : ''}</span>` : ''}${text(x.text)}</p>
        <small>${x.byUid !== state.user.uid && x.by ? esc(x.by) : ''}${x.pending ? ' 저장 중…' : ''}</small></div>`;
    }).join('') : '<p class="muted center mn-empty">아래 칸에 적으면 여기에 시각과 함께 쌓여요.</p>';
    box.querySelectorAll('[data-i]').forEach((r) => (r.onclick = () => editItem(items.get(r.dataset.i))));
    if (atBottom) form.scrollIntoView({ block: 'end' });
  };
  // 선수 지정 · 보여주기: seeUids = 보여주기를 켠 메모의 선수만 (선수는 이 칸에 자기가 있는 메모만 읽음)
  const whoData = (uids = [], shared = false, sharedAt = 0) => ({ uids, shared: !!(shared && uids.length), seeUids: shared ? uids : [], sharedAt: shared && uids.length ? sharedAt || Date.now() : 0 });
  // 노트에도 '보여 준 메모가 있는 선수' 목록 (선수 경기 노트 화면이 자기 노트만 찾게) — 메모 전체로 다시 계산
  //  seenAtBy: 선수마다 마지막으로 보여 준 시각 (선수 홈 '새 소식')
  let seen0 = JSON.stringify(n.seenAtBy || {});
  const syncSeen = () => {
    const by = {};
    [...items.values()].forEach((x) => (x.seeUids || []).forEach((u) => { by[u] = Math.max(by[u] || 0, x.sharedAt || x.at || 0); }));
    const key = JSON.stringify(Object.fromEntries(Object.entries(by).sort()));
    if (key === seen0) return;
    seen0 = key;
    updateDoc(ref, { seenUids: Object.keys(by).sort(), seenAtBy: by }).catch(() => {});
  };
  const keepLocal = () => { try { localStorage.setItem(BK, JSON.stringify([...items.values()].filter((x) => x.pending).map(({ pending, ...x }) => x))); } catch { /* */ } };
  const itemCol = collection(db, 'teams', state.team.id, 'matchNotes', id, 'items');
  const push = (x) => {
    setDoc(doc(itemCol, x.id), { p: x.p, m: x.m, label: x.label, text: x.text, at: x.at, by: x.by, byUid: x.byUid, ...whoData(x.uids, x.shared, x.sharedAt), createdAt: serverTimestamp() })
      .then(() => { const y = items.get(x.id); if (y) { y.pending = false; keepLocal(); drawItems(); } updateDoc(ref, { count: items.size, updatedAt: serverTimestamp() }).catch(() => {}); syncSeen(); })
      .catch(() => { toast('메모를 아직 저장하지 못했어요 — 인터넷이 되면 다시 보내요.'); });
  };
  [...items.values()].filter((x) => x.pending).forEach(push); // 지난번에 못 보낸 것
  const unsub = onSnapshot(query(itemCol, orderBy('at'), limit(500)), (s) => {
    s.docs.forEach((d) => items.set(d.id, { id: d.id, ...d.data(), pending: false })); // 서버에 있으면 저장 끝
    keepLocal(); drawItems();
  }, () => {});
  state.cleanup.push(() => unsub?.());

  // 선수 고르기 (여러 명) · 고르면 '보여주기' 스위치가 나옴
  const picked = new Set();
  const syncPick = (box, set, shareBox) => {
    box?.querySelectorAll('[data-u]').forEach((b) => b.classList.toggle('active', set.has(b.dataset.u)));
    if (shareBox) shareBox.hidden = !set.size;
  };
  $('[data-pl]')?.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => {
    if (picked.has(b.dataset.u)) picked.delete(b.dataset.u); else picked.add(b.dataset.u);
    if (!at0 && picked.size) { at0 = { ...stamp(n), at: Date.now() }; $('[data-at]').textContent = `${at0.label}에 적는 중`; } // 선수부터 눌러도 그 순간 시각
    syncPick($('[data-pl]'), picked, $('[data-sharebox]'));
  }));
  // 적기: 적기 시작한 순간의 시각을 붙임 (다 쓰는 동안 시간이 흘러도)
  let at0 = null;
  ta.addEventListener('input', () => {
    if (!ta.value.trim()) { at0 = null; drawClock(); return; }
    if (!at0) { at0 = { ...stamp(n), at: Date.now() }; $('[data-at]').textContent = `${at0.label}에 적는 중`; }
  });
  // 펜 모드: 넓은 공책 칸 (아이패드 손글씨 입력 · 갤럭시 S펜 필기가 글자로 바꿔 넣음) — Enter 로 바로 보내지 않음(여러 줄)
  const PENK = 'ssaka.mn.pen';
  const setPen = (on) => {
    form.classList.toggle('pen', on); $('[data-pen]').setAttribute('aria-pressed', String(on)); $('[data-penhelp]').hidden = !on;
    ta.rows = on ? 6 : 2; ta.placeholder = on ? '여기에 펜으로 쓰세요 — 글자로 바뀌어요' : '한 줄로 적어요 — 예) 왼쪽 뒷공간 계속 뚫림 · 7번 첫 터치 좋음';
    try { localStorage.setItem(PENK, on ? '1' : ''); } catch { /* */ }
  };
  $('[data-pen]').onclick = () => { setPen(!form.classList.contains('pen')); ta.focus(); };
  try { if (localStorage.getItem(PENK)) setPen(true); } catch { /* */ }
  // 펜이 칸에 닿으면: 펜 모드로 · 그 순간 시각을 붙임 (손글씨가 글자로 바뀌기 전에)
  ta.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'pen') return;
    if (!form.classList.contains('pen')) setPen(true);
    if (!at0) { at0 = { ...stamp(n), at: Date.now() }; $('[data-at]').textContent = `${at0.label}에 적는 중`; }
  });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !form.classList.contains('pen')) { e.preventDefault(); form.requestSubmit(); } });
  form.onsubmit = (e) => {
    e.preventDefault();
    const t = ta.value.trim(); if (!t) return;
    const s = at0 || { ...stamp(n), at: Date.now() };
    const share = !!$('[data-share]')?.checked;
    const x = { id: doc(itemCol).id, ...s, text: t, by: state.profile.name || '', byUid: state.user.uid, ...whoData([...picked], share), pending: true };
    items.set(x.id, x); keepLocal();
    ta.value = ''; at0 = null; picked.clear(); if ($('[data-share]')) $('[data-share]').checked = false; syncPick($('[data-pl]'), picked, $('[data-sharebox]'));
    drawClock(); drawItems(); ta.focus();
    push(x);
  };
  const editItem = (x) => {
    if (!x) return;
    const sel = new Set(x.uids || []);
    const m = modal(`<span class="eyebrow">${esc(x.label)}</span><h2>메모 고치기</h2>
      <form class="stack"><textarea name="t" rows="3" maxlength="300">${esc(x.text)}</textarea>
      ${players.length ? `<div><h4>선수</h4><div class="mn-pl in-modal" data-epl>${players.map((pp) => `<button type="button" class="chip" data-u="${esc(pp.id)}">${pp.number ? `<b>${esc(pp.number)}</b> ` : ''}${esc(pp.name)}</button>`).join('')}</div></div>
      <label class="mini-switch" data-eshare ${sel.size ? '' : 'hidden'}><input type="checkbox" name="share" ${x.shared ? 'checked' : ''}> 고른 선수에게 보여주기</label>` : ''}
      <div class="row between"><button type="button" class="btn ghost danger" data-rm>지우기</button><button class="btn">고치기</button></div></form>`);
    const epl = m.el.querySelector('[data-epl]');
    syncPick(epl, sel, m.el.querySelector('[data-eshare]'));
    epl?.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => { if (sel.has(b.dataset.u)) sel.delete(b.dataset.u); else sel.add(b.dataset.u); syncPick(epl, sel, m.el.querySelector('[data-eshare]')); }));
    m.el.querySelector('form').onsubmit = (e) => {
      e.preventDefault(); const t = e.target.t.value.trim(); if (!t) return;
      const w = whoData([...sel], !!e.target.share?.checked, x.shared ? x.sharedAt : 0);
      Object.assign(x, { text: t, ...w }); drawItems(); m.close();
      updateDoc(doc(itemCol, x.id), { text: t, ...w }).then(syncSeen).catch((err) => fail(err));
    };
    m.el.querySelector('[data-rm]').onclick = async () => {
      if (!(await confirmBox('이 메모를 지울까요?'))) return;
      items.delete(x.id); keepLocal(); drawItems(); m.close();
      deleteDoc(doc(itemCol, x.id)).then(() => { updateDoc(ref, { count: items.size }).catch(() => {}); syncSeen(); }).catch((err) => fail(err));
    };
  };
  // 글로 복사 (카톡 · 코치 노트에 붙여 넣기)
  $('[data-copy]').onclick = () => {
    const rows = [...items.values()].sort((a, b) => a.at - b.at);
    const out = [`[경기 노트] vs ${n.opponent || ''} · ${fmtD(n.date)}`, ...rows.map((x) => `${x.label}  ${(x.uids || []).map(pLabel).filter(Boolean).map((w) => `[${w}] `).join('')}${x.text}`)].join('\n');
    (navigator.clipboard?.writeText(out) || Promise.reject()).then(() => toast('경기 노트를 글로 복사했어요.'), () => toast('복사가 안 돼요 — 이 기기에서는 길게 눌러 복사해 주세요.'));
  };
  $('[data-del]').onclick = async () => {
    if (!(await confirmBox(`vs ${n.opponent || ''} 경기 노트를 지울까요? 메모 ${items.size}개가 모두 지워져요.`))) return;
    try {
      const b = writeBatch(db);
      [...items.keys()].forEach((k) => b.delete(doc(itemCol, k)));
      if (n.matchId) b.update(doc(db, 'teams', state.team.id, 'matches', n.matchId), { noteId: '' });
      b.delete(ref);
      await b.commit();
      try { localStorage.removeItem(BK); } catch { /* */ }
      toast('경기 노트를 지웠어요.');
      go('/match-notes');
    } catch (err) { fail(err); }
  };
  // 기록실 경기와 연결 (그 경기를 누르면 이 메모가 보임 · 선수는 자기에게 보여 준 메모만)
  const drawLink = () => {
    const g = games.find((x) => x.id === n.matchId);
    $('[data-link]').innerHTML = g ? `<span class="tag solid">기록실</span> <b>vs ${esc(g.opponent || '')}</b> ${g.gf != null ? `${+g.gf} : ${+g.ga}` : ''} 경기와 연결됐어요 <button type="button" class="link-btn small" data-unlink>연결 끊기</button>`
      : games.length ? `<span class="muted small">기록실 경기와 연결하면 그 경기에서 메모를 봐요</span> <select data-pick><option value="">기록실 경기 고르기</option>${games.map((x) => `<option value="${esc(x.id)}">vs ${esc(x.opponent || '')} ${x.gf != null ? `${+x.gf}:${+x.ga}` : ''}${x.noteId && x.noteId !== id ? ' (다른 노트와 연결됨)' : ''}</option>`).join('')}</select>`
        : '<span class="muted small">이 날 기록실에 경기를 저장하면 여기서 연결할 수 있어요 (그 경기에서 메모를 봐요)</span>';
    $('[data-pick]')?.addEventListener('change', (e) => link(e.target.value));
    $('[data-unlink]')?.addEventListener('click', () => link(''));
  };
  const link = async (mid) => {
    const old = n.matchId;
    try {
      const b = writeBatch(db);
      if (old) b.update(doc(db, 'teams', state.team.id, 'matches', old), { noteId: '' });
      if (mid) b.update(doc(db, 'teams', state.team.id, 'matches', mid), { noteId: id });
      b.update(ref, { matchId: mid });
      await b.commit();
      n = { ...n, matchId: mid };
      games.forEach((g) => { if (g.id === old) g.noteId = ''; if (g.id === mid) g.noteId = id; });
      toast(mid ? '기록실 경기와 연결했어요.' : '연결을 끊었어요.');
      drawLink();
    } catch (err) { fail(err); }
  };
  drawLink();
  drawClock(); drawItems(); wake();
}

// 기록실 경기 → 이 경기 노트 메모 (지도자: 전부 · 선수: 나에게 보여 준 것만)
export async function memosFor(noteId, coach) {
  const c = collection(db, 'teams', state.team.id, 'matchNotes', noteId, 'items');
  const s = await getDocs(coach ? query(c, orderBy('at'), limit(500)) : query(c, where('seeUids', 'array-contains', state.user.uid), limit(200)));
  return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.at - b.at);
}

// ───────── 선수: 나에게 온 경기 피드백 (코치님이 [선수에게 보여주기]를 켠 메모 중 나를 지정한 것) ─────────
export async function mine(el) {
  const uid = state.user.uid;
  el.innerHTML = `${pageHead('MATCH NOTES', '경기 노트')}<p class="muted mn-intro">경기 중에 코치님이 나에게 남긴 피드백이에요. 경기마다 시각 순서로 모여요.</p><div data-mine class="muted">불러오는 중…</div>`;
  const box = el.querySelector('[data-mine]');
  try {
    const ns = await getDocs(query(col(), where('seenUids', 'array-contains', uid), limit(100)));
    const notes = ns.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const [lists, games] = await Promise.all([
      Promise.all(notes.map((x) => getDocs(query(collection(db, 'teams', state.team.id, 'matchNotes', x.id, 'items'), where('seeUids', 'array-contains', uid), limit(100)))
        .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.at - b.at)).catch(() => []))),
      Promise.all(notes.map((x) => (x.matchId ? getDoc(doc(db, 'teams', state.team.id, 'matches', x.matchId)).then((d) => d.data()).catch(() => null) : null))),
    ]);
    const cards = notes.map((x, i) => [x, lists[i], games[i]]).filter(([, l]) => l.length);
    const total = cards.reduce((a, [, l]) => a + l.length, 0);
    box.className = '';
    box.innerHTML = cards.length ? `<p class="mn-mine-sum">피드백 <b>${total}개</b> · 경기 <b>${cards.length}개</b></p>
      ${cards.map(([x, l, g]) => `<section class="card mn-mine">
        <header><span class="date-badge">${esc(x.date.slice(5).replace('-', '.'))}</span><div><strong>vs ${esc(x.opponent || g?.opponent || '상대')}</strong><small>${esc(fmtD(x.date))}${g ? ` · ${+g.gf} : ${+g.ga}` : ''}</small></div><span class="tag">${l.length}개</span></header>
        <div class="mn-items read">${l.map((m) => `<div class="mn-item"><span class="mn-t">${esc(m.label)}</span><p>${text(m.text)}</p><small>${esc(m.by || '코치님')}</small></div>`).join('')}</div>
      </section>`).join('')}`
      : empty('아직 코치님이 남긴 경기 피드백이 없어요. 경기 중에 코치님이 나에게 메모를 보여 주면 여기에 모여요.');
  } catch (err) { box.innerHTML = ''; fail(err); }
}
