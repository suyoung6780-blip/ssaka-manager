import {
  auth, db, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, serverTimestamp, writeBatch,
} from '../fb.js';
import { PAY_TEST, FREE_MODE, PLANS, ALL_PLANS, LEGEND, WONDERKID, CYCLES, planPrice, TRIAL_DAYS, DEMO_PLAN, LAUNCH } from '../config.js';
import {
  esc, toast, fail, formData, options, pageHead, modal, confirmBox, fmtDate, CATEGORIES, normCat, ROLES,
} from '../ui.js';
import { state, loadContext, go, publicProfile, teamActive, teamPlan, hooks, compActive, freeMode, SPACES, spaceKind, loadParentLink } from '../store.js';

// ───────── 팀 코드: 10자리, 대문자 · 소문자 · 숫자 섞어서, 매번 새로 ─────────
// 헷갈리는 글자(0 O o · 1 I l)는 뺌 — 손으로 옮겨 적어도 틀리지 않게
const UP = 'ABCDEFGHJKLMNPQRSTUVWXYZ', LO = 'abcdefghijkmnpqrstuvwxyz', NUM = '23456789';
const ALL = UP + LO + NUM;
const pick = (chars) => {
  const lim = 256 - (256 % chars.length); // 치우침 없이 고르기
  const b = new Uint8Array(1);
  do crypto.getRandomValues(b); while (b[0] >= lim);
  return chars[b[0] % chars.length];
};
export function genTeamCode() {
  const c = [pick(UP), pick(LO), pick(NUM), ...Array.from({ length: 7 }, () => pick(ALL))];
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
  return c.join('');
}

// 코드 안내 문구 — 공간 종류마다 누구에게 알려 줄지
const CODE_TO = { team: '선수 · 코치에게 이 코드를 알려주세요.', gaffer: '함께할 지도자에게 이 코드를 알려주세요.', personal: '선수에게 이 코드를 알려주세요. 선수는 <b>선수 계정</b>으로 가입한 뒤 이 코드를 넣어요.' };
export function codeModal(code, title, kind = spaceKind()) {
  const sp = SPACES[kind] || SPACES.team;
  const m = modal(`<span class="eyebrow">CODE</span><h2>${title || `${sp.code}가 만들어졌어요`}</h2>
    <p>${CODE_TO[kind] || CODE_TO.team} <strong>대문자 · 소문자를 구분</strong>합니다.</p>
    <div class="code-big" data-copy>${esc(code)}</div>
    <div class="row between"><small class="muted">${kind === 'personal' ? '홈 · 설정' : '팀 설정'}에서 언제든 다시 볼 수 있어요.</small><button class="btn" data-copy-btn>코드 복사</button></div>`);
  const copy = () => (navigator.clipboard?.writeText(code) || Promise.reject()).then(() => toast(`${sp.code}를 복사했습니다.`), () => toast(`복사가 안 돼요 — ${sp.code}: ${code}`));
  m.el.querySelector('[data-copy]').onclick = copy;
  m.el.querySelector('[data-copy-btn]').onclick = copy;
  return m;
}

// 팀 · 팀 코드 · 대표 지도자 입장을 한 번에 (하나라도 실패하면 전부 취소)
async function makeTeam(info) {
  const teamRef = doc(collection(db, 'teams'));
  let code = '';
  for (let i = 0; i < 5 && !code; i++) {
    const c = genTeamCode();
    if (!(await getDoc(doc(db, 'teamCodes', c))).exists()) code = c;
  }
  if (!code) throw new Error('팀 코드를 만들지 못했습니다. 다시 시도해 주세요.');
  const b = writeBatch(db);
  b.set(teamRef, { ...info, status: 'active', ...(FREE_MODE ? { free: true } : { trial: true }) }); // 새 팀: 무료 체험으로 시작
  b.set(doc(db, 'teamCodes', code), { teamId: teamRef.id, createdAt: serverTimestamp() });
  b.set(doc(db, 'teams', teamRef.id, 'private', 'billing'), { code, issuedAt: serverTimestamp() });
  b.set(doc(db, 'teams', teamRef.id, 'members', state.user.uid), {
    ...publicProfile(state.profile), role: 'coach', joinedAt: serverTimestamp(),
  });
  b.update(doc(db, 'users', state.user.uid), { teamId: teamRef.id });
  await b.commit();
  await loadContext();
  hooks.updateShell();
  // 다음 화면으로 넘어간 뒤에 띄움 (화면이 바뀔 때 열린 창을 닫으므로) — 유료 모드면 바로 요금제 고르기로
  const next = FREE_MODE ? '/' : '/pay';
  if (location.hash === `#${next}`) { go(next); setTimeout(() => codeModal(code, undefined, info.kind || 'team'), 0); return; }
  const kind = info.kind || 'team';
  window.addEventListener('hashchange', () => setTimeout(() => codeModal(code, FREE_MODE ? undefined : `${SPACES[kind].code}가 만들어졌어요 · ${TRIAL_DAYS}일 무료 체험 시작`, kind), 0), { once: true });
  go(next);
}

// 만들 공간 종류 — 고르면 아래 입력 칸과 설명이 바뀜
const KIND_CARDS = [
  ['team', '팀 계정', '지도자 + 선수들이 함께 쓰는 팀', '만들면 <b>팀 코드</b>가 나와요. 팀 코드로 선수 · 지도자를 초대해요. 팀 검색에 나와요.'],
  ['gaffer', '지도자 계정', '선수 없이 지도자끼리', '만들면 <b>지도자 코드</b>가 나와요. 지도자 코드로 함께할 지도자를 초대해요. 작전판 · 훈련 프로그램 · 영상룸 · 커뮤니티. 팀 검색에는 안 나와요.'],
  ['personal', '개인 계정', '보호자 1명 + 선수 1명', '만들면 <b>보호자 코드</b>가 나와요. 보호자 코드로 개인 선수를 초대해요. 선수 영상 편집 · 기록 관리 · 목표. 팀 검색에는 안 나와요.'],
];
export function createTeam(el) {
  if (state.team) return go('/');
  // 보호자로 가입했으면 개인 계정만 · 지도자로 가입했으면 팀 계정 · 지도자 계정만
  const cards = KIND_CARDS.filter(([k]) => (state.profile?.parent ? k === 'personal' : k !== 'personal'));
  let kind = cards[0][0];
  el.innerHTML = `${pageHead('CREATE', '새로 만들기')}
  <form class="card narrow">
    <fieldset class="role-pick space-pick n${cards.length}"><legend>${cards.length > 1 ? '무엇을 만들까요?' : '만들 계정'}</legend>
      ${cards.map(([k, t, s2, d]) => `<label class="radio-card"><input type="radio" name="kind" value="${k}" ${k === kind ? 'checked' : ''}><strong>${t}</strong><small>${s2}</small><small class="muted">${d}</small></label>`).join('')}
    </fieldset>
    <div data-k="team"><label>팀 이름<input name="name" required minlength="2" maxlength="30" placeholder="예) 블랙 FC U15, 한빛초 축구부"></label>
      <p class="name-note">실제 팀 이름을 정확하게 적어 주세요. <b>'ㅇ', '축구교실'처럼 팀을 알아볼 수 없는 이름</b>은 운영자가 확인 후 <b>기능이 제한될 수 있어요.</b></p>
      <label>팀 구분<select name="category" required>${options(CATEGORIES)}</select></label>
      <p class="muted small">다른 팀에는 팀 이름 · 구분 · 대표 지도자 이름만 보여요. 선수단과 팀 안 내용은 우리 팀만 봐요.</p></div>
    <div data-k="gaffer"><label>모임 이름<input name="name" required minlength="2" maxlength="30" placeholder="예) 수원 유소년 지도자 모임"></label>
      <p class="muted small">함께할 지도자는 <b>지도자 코드</b>로 들어와요. 다른 팀에는 보이지 않아요.</p></div>
    <div data-k="personal"><label>선수 이름 <small class="muted">(실명)</small><input name="name" required minlength="2" maxlength="20" placeholder="예) 홍길동"></label>
      <label>선수 학년 · 연령<select name="category" required>${options(CATEGORIES)}</select></label>
      <p class="muted small">만들면 <b>보호자 코드</b>가 나와요. 선수가 자기 <b>선수 계정</b>으로 이 코드를 넣고 보호자가 승인하면 연결돼요. 선수가 클럽 팀에 있어도 팀은 그대로예요. 다른 팀에는 보이지 않아요.</p></div>
    ${FREE_MODE ? `<div class="price-box"><span>이용료</span><strong>무료</strong><small>만들면 바로 10자리 코드가 발급됩니다</small></div>
    <button class="btn full" data-go>만들고 코드 받기</button>` : `
    <div class="price-box"><span>처음 ${TRIAL_DAYS}일</span><strong>무료 체험</strong><small>만들면 바로 코드가 발급돼요 · 체험이 끝나면 요금제를 골라 결제해야 계속 쓸 수 있어요</small></div>
    <p class="muted small"><a href="#/pricing">요금 안내</a> · <a href="#/refund">환불정책</a></p>
    <button class="btn full" data-go>만들고 체험 시작</button>`}
  </form>`;
  const form = el.querySelector('form');
  // 고른 종류의 칸만 보이고 보냄 (숨긴 칸은 꺼서 필수 검사 · 제출에서 빠지게)
  const sync = () => {
    kind = form.querySelector('[name=kind]:checked').value;
    form.querySelectorAll('[data-k]').forEach((b) => { b.hidden = b.dataset.k !== kind; b.querySelectorAll('input, select').forEach((x) => { x.disabled = b.hidden; }); });
  };
  form.querySelectorAll('[name=kind]').forEach((r) => (r.onchange = sync));
  sync();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(form);
    const btn = form.querySelector('[data-go]');
    btn.disabled = true;
    try {
      const name = d.name.trim();
      const info = { name: kind === 'personal' ? `${name} 선수` : name, category: kind === 'gaffer' ? '지도자 계정' : d.category, intro: '', isPublic: false,
        ownerUid: state.user.uid, ownerName: state.profile.name, createdAt: serverTimestamp(),
        ...(kind !== 'team' ? { kind, hidden: true } : {}), ...(kind === 'personal' ? { childName: name } : {}) }; // 지도자 계정 · 개인은 팀 검색 · 팀 대화 목록에 안 나옴
      await makeTeam(info);
    } catch (err) { btn.disabled = false; fail(err); }
  };
}

// ───────── 요금제 · 결제 ─────────
const won = (n) => `${n.toLocaleString()}원`;
const left = (until) => { const d = Math.ceil((until - Date.now()) / 864e5); return d <= 0 ? '오늘까지' : `${d}일 남음`; };
export const planLine = (pl = teamPlan()) => {
  if (pl.kind === 'paid') { const p = ALL_PLANS.find((x) => x.id === pl.plan); return `${p ? `${p.name} 요금제` : '결제'} · ${fmtDate(new Date(pl.until))}까지 (${left(pl.until)})`; }
  if (pl.kind === 'comp') return pl.until === Infinity ? '운영자 무료 제공 · 평생' : `운영자 무료 제공 · ${fmtDate(new Date(pl.until))}까지`;
  if (pl.kind === 'trial') return `무료 체험 · ${fmtDate(new Date(pl.until))}까지 (${left(pl.until)})`;
  if (pl.kind === 'free') return pl.until === Infinity ? `${DEMO_PLAN.name} 요금제 · 무료 (선수 · 지도자 제한 없음)` : `무료 기간 · ${fmtDate(new Date(pl.until))}까지 (${left(pl.until)})`;
  if (pl.until) { const p = ALL_PLANS.find((x) => x.id === pl.plan); return `${p ? `${p.name} 요금제 · ` : ''}${fmtDate(new Date(pl.until))}에 끝났어요 · 결제가 필요해요`; }
  return '결제가 필요해요';
};
// 요금표 (요금 안내 · 결제 화면 같이 씀)
// only: 이 요금제만 (개인 계정 결제 = 원더키드만)
const wasTag = (list) => `<small class="plan-was"><s>정식 ${list}</s><b>${LAUNCH.off}% 할인</b></small>`;
const was = (p, cycle) => (p.list ? wasTag(won(p.list * CYCLES[cycle].mult)) : '');
const launchNote = () => `<p class="plan-launch"><b>출시 기념가 ${LAUNCH.off}% 할인</b> — ${LAUNCH.until ? `${LAUNCH.until.replace(/-/g, '.')}까지` : '출시 기념 기간 동안'} 가입한 팀(개인 계정)은 <b>연장해도 계속 이 가격</b>이에요. 기간이 끝나면 새로 가입하는 팀부터 정식 가격이 적용돼요.</p>`;
function planCards(cycle, pick, need, only = null) {
  const demo = FREE_MODE ? `<div class="plan-card demo t-demo"><span class="plan-badge">지금</span><b class="plan-name">${DEMO_PLAN.name}</b><small class="plan-sub">${DEMO_PLAN.sub}</small>
    <strong class="plan-price">${DEMO_PLAN.price}</strong><small class="plan-save">모든 팀 · 결제 없이</small>
    <ul><li>선수 제한 없음</li><li>지도자 제한 없음</li><li>모든 기능</li><li class="muted">${DEMO_PLAN.note}</li></ul></div>` : '';
  // 원더키드(개인 계정)는 요금 안내에서만 — 팀 결제 화면(pick)에서는 팀 요금제만
  const wk = pick ? '' : `<div class="plan-card t-wonderkid"><b class="plan-name">${WONDERKID.name}</b><small class="plan-sub">${WONDERKID.sub}</small>
    ${was(WONDERKID, cycle)}<strong class="plan-price">${won(planPrice(WONDERKID, cycle))}<i>/${CYCLES[cycle].label}</i></strong><small class="plan-save">${cycle === 'year' ? `월 ${won(Math.round(planPrice(WONDERKID, cycle) / 12))} 꼴 · 2개월 무료` : '보호자가 만드는 개인 계정'}</small>
    <ul><li>선수 1명</li><li>보호자 1명</li><li class="muted">${WONDERKID.note}</li></ul></div>`;
  const list = only || PLANS;
  const n = only ? only.length : (FREE_MODE ? 1 : 0) + (pick ? 0 : 1) + PLANS.length + 1;
  return `<div class="plan-grid ${n === 6 ? 'six' : n === 7 ? 'seven' : n === 1 ? 'one' : ''}">${only ? '' : `${demo}${wk}`}${list.map((p) => {
    const fits = !need || (need.players <= p.players && need.coaches <= p.coaches);
    const price = planPrice(p, cycle);
    return `<label class="plan-card t-${p.id} ${p.best ? 'best' : ''} ${fits ? '' : 'small-fit'}">
      ${pick ? `<input type="radio" name="plan" value="${p.id}" ${fits ? '' : 'disabled'}>` : ''}
      ${p.best ? '<span class="plan-badge">추천</span>' : ''}
      <b class="plan-name">${p.name}</b><small class="plan-sub">${p.sub}</small>
      ${was(p, cycle)}<strong class="plan-price">${won(price)}<i>/${CYCLES[cycle].label}</i></strong>
      ${cycle === 'year' ? `<small class="plan-save">월 ${won(Math.round(price / 12))} 꼴 · 2개월 무료${p.players ? '' : ` · 지도자 1명당 월 ${won(Math.round(price / 12 / p.coaches))}`}</small>` : `<small class="plan-save">${p.players ? `선수 1명당 월 ${won(Math.round(p.month / p.players))}` : `지도자 1명당 월 ${won(Math.round(p.month / p.coaches))}`}</small>`}
      <ul><li>선수 ${p.players ? `${p.players}명까지` : '없음'}</li><li>${p.id === 'wonderkid' ? '보호자' : '지도자'} ${p.coaches}명까지</li><li>모든 기능</li>${p.note ? `<li class="muted">${p.note}</li>` : ''}</ul>
      ${need && !fits ? '<small class="plan-warn">지금 인원보다 작아요</small>' : ''}
    </label>`;
  }).join('')}
    ${only ? '' : `<div class="plan-card legend t-legend"><b class="plan-name">${LEGEND.name}</b><small class="plan-sub">${LEGEND.sub}</small>${wasTag(LEGEND.list)}<strong class="plan-price sm">${LEGEND.price}</strong><ul><li>선수 ${LEGEND.players}</li><li>지도자 여러 명 · 여러 팀</li></ul><a class="btn ghost sm" href="#/support">운영자에게 상담</a></div>`}
  </div>`;
}
const cycleSeg = (cycle) => `<div class="seg plan-cycle">${Object.entries(CYCLES).map(([k, c]) => `<button type="button" class="${k === cycle ? 'on' : ''}" data-cycle="${k}">${c.label}${k === 'year' ? ' <small>2개월 무료</small>' : ''}</button>`).join('')}</div>`;

// 우리 팀 요금제 고르기: 선수 수 구간과 지도자 수 구간 중 높은 쪽 (선수 없이 지도자 3명까지는 가퍼)
const TIERS = PLANS.filter((p) => p.players > 0);
export function recommend(players, coaches) {
  if (players === 0 && coaches <= PLANS[0].coaches) return { plan: PLANS[0], why: `선수 없이 지도자 ${coaches}명 → 지도자 전용` };
  const by = (key, n) => { const i = TIERS.findIndex((t) => n <= t[key]); return i < 0 ? TIERS.length : i; };
  const ip = players ? by('players', players) : 0; const ic = by('coaches', coaches);
  const i = Math.max(ip, ic);
  const name = (k) => (k >= TIERS.length ? LEGEND.name : TIERS[k].name);
  const why = `${players ? `선수 ${players}명 → ${name(ip)}` : '선수 없음'} · 지도자 ${coaches}명 → ${name(ic)}${ic > ip && players ? ' (지도자 수 때문에 한 단계 위)' : ''}`;
  return { plan: i >= TIERS.length ? null : TIERS[i], why };
}
const perHead = (p, players, cycle) => (players ? Math.round(planPrice(p, cycle) / (cycle === 'year' ? 12 : 1) / players) : 0);
// '우리 팀은?' 결과 칸
function teamResult(players, coaches, cycle) {
  const r = recommend(players, coaches);
  if (!r.plan) return `<div class="plan-result t-legend"><span class="eyebrow">우리 팀 요금제</span><b>${LEGEND.name}</b><strong>${LEGEND.price}</strong><small>${esc(r.why)} — 운영자에게 상담해 주세요</small></div>`;
  const price = planPrice(r.plan, cycle);
  return `<div class="plan-result t-${r.plan.id}"><span class="eyebrow">우리 팀 요금제</span><b>${r.plan.name}</b>
    <strong>${won(price)}<i>/${CYCLES[cycle].label}</i></strong>
    <small>${esc(r.why)}</small>
    ${players ? `<p class="plan-per">선수 한 명당 <b>월 ${won(perHead(r.plan, players, cycle))}</b>${cycle === 'year' ? ' (12개월 결제 기준)' : ''}</p>` : `<p class="plan-per">지도자 한 명당 <b>월 ${won(Math.round(price / (cycle === 'year' ? 12 : 1) / Math.max(1, coaches)))}</b>${cycle === 'year' ? ' (12개월 결제 기준)' : ''}</p>`}</div>`;
}
// 구간별 선수 한 명당 (시작 · 중간 · 꽉 찼을 때)
function perTable() {
  const rows = [...TIERS.map((t, i) => { const lo = i ? TIERS[i - 1].players + 1 : 10; const mid = Math.round((lo + t.players) / 2); return [t.name, `${i ? `${lo}~` : '~'}${t.players}명`, won(t.month), [lo, mid, t.players].map((n) => `${n}명 → ${won(Math.round(t.month / n))}`), won(Math.round((t.month * 10) / 12 / t.players))]; }),
    [LEGEND.name, '81명~', '99,900원~', [81, 100, 120].map((n) => `${n}명 → ${won(Math.round(99900 / n))}`), '상담']];
  return `<div class="tbl-wrap"><table class="tbl per-tbl"><thead><tr><th>요금제</th><th>선수</th><th>월 요금</th><th>구간 시작</th><th>중간</th><th>꽉 찼을 때</th><th>12개월 · 꽉 찼을 때</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="t-${i < TIERS.length ? TIERS[i].id : 'legend'}"><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td>${r[3].map((x) => `<td>${x}</td>`).join('')}<td>${r[4]}</td></tr>`).join('')}</tbody></table></div>`;
}
const countRules = `<ul class="plan-rules">
  <li><b>승인된 사람만</b> 세요 — 락커룸에서 승인 대기 중인 사람은 안 세요.</li>
  <li><b>둘 중 높은 쪽</b> — 선수 수 구간과 지도자 수 구간 중 높은 쪽으로 정해져요.</li>
  <li><b>선수가 있으면 넌리그부터</b> — 선수 없이 지도자 3명까지는 가퍼, 보호자 1명 + 선수 1명은 원더키드(개인 계정)예요.</li>
  <li><b>넘어도 바로 막지 않아요</b> — 다음 결제 때 맞는 요금제로 바꾸면 돼요.</li></ul>`;

// 공개 요금 안내 (로그인 없이도) — 선수 · 지도자 수를 움직여 우리 팀 요금 보기
export function pricing(el) {
  let cycle = 'month'; let pN = 25; let cN = 3;
  const draw = () => {
    el.innerHTML = `${state.profile ? '' : '<div class="brand"><span>SSAKA</span><span>MANAGER</span><small>축구팀을 위한 매니지먼트 플랫폼</small></div>'}
    ${pageHead('PRICING', '요금 안내')}
    ${FREE_MODE ? '<p class="plan-free-note"><b>지금은 베타 기간이라 모든 팀이 무료예요.</b> 유료로 바뀌기 30일 전에 미리 알려 드리고, 그 전에는 결제하지 않아도 모든 기능을 쓸 수 있어요.</p>' : ''}
    <p class="muted">요금은 <b>팀 단위</b>예요. 선수 수에 따라 구간이 정해지고, 지도자는 구간마다 정해진 인원까지 포함돼요. <b>선수 한 명당 한 달 천 원 정도</b>예요. ${FREE_MODE ? '유료로 바뀐 뒤 새로 만드는 팀' : '팀을 만들면'} <b>${TRIAL_DAYS}일 무료</b>로 모든 기능을 써 볼 수 있어요. 금액은 부가세 포함이에요.</p>
    ${launchNote()}
    ${cycleSeg(cycle)}
    <section class="card plan-calc">
      <h3>우리 팀은 어떤 요금제?</h3>
      <p class="muted small">승인된 선수 · 지도자 수를 움직여 보세요.</p>
      <div class="calc-grid">
        <div class="calc-in">
          <label><span>선수 <b data-pv>${pN}</b>명</span><input type="range" min="0" max="100" value="${pN}" data-p></label>
          <label><span>지도자 <b data-cv>${cN}</b>명</span><input type="range" min="1" max="12" value="${cN}" data-c></label>
        </div>
        <div data-res>${teamResult(pN, cN, cycle)}</div>
      </div>
    </section>
    ${planCards(cycle, false)}
    <section class="card"><h3>선수 한 명당으로 보면</h3><p class="muted small">같은 구간 안에서는 선수가 많을수록 한 명당 금액이 내려가요.</p>${perTable()}</section>
    <section class="card pricing-faq">
      <h3>인원은 이렇게 세요</h3>${countRules}
      <h3>알아 두세요</h3>
      <ul>
        <li>자동 결제가 아니에요. 이용기간이 끝나기 전에 팀 대표가 직접 연장 결제해요 (남은 기간에 이어서 늘어나요).</li>
        <li>12개월 결제는 10개월 값이에요 — 두 달이 무료인 셈이에요.</li>
        <li>결제는 KG이니시스(포트원 결제 연동)로 안전하게 처리돼요 (신용 · 체크카드).</li>
        <li>결제하지 않아도 팀 기록은 지워지지 않아요. 다시 결제하면 그대로 이어서 써요.</li>
        <li>환불은 <a href="#/refund">환불정책</a>을 따라요 — 결제 후 7일 안에 쓰지 않았으면 전액 환불돼요.</li>
      </ul>
      <div class="row">${state.user ? (state.team ? '<a class="btn" href="#/pay">우리 팀 결제하기</a>' : '<a class="btn" href="#/team/new">팀 만들고 무료 체험</a>') : '<a class="btn" href="#/signup">가입하고 무료 체험</a>'}<a class="btn ghost" href="#/refund">환불정책</a></div>
    </section>`;
    el.querySelectorAll('[data-cycle]').forEach((b) => (b.onclick = () => { cycle = b.dataset.cycle; draw(); }));
    const upd = () => { pN = +el.querySelector('[data-p]').value; cN = +el.querySelector('[data-c]').value; el.querySelector('[data-pv]').textContent = pN; el.querySelector('[data-cv]').textContent = cN; el.querySelector('[data-res]').innerHTML = teamResult(pN, cN, cycle); };
    el.querySelectorAll('[data-p], [data-c]').forEach((r) => (r.oninput = upd));
  };
  draw();
}

export async function pay(el) {
  const t = state.team;
  const pl = teamPlan();
  // 지금 인원 (승인된 사람만)
  let need = { players: 0, coaches: 1 };
  try {
    const snap = await getDocs(collection(db, 'teams', t.id, 'members'));
    const ok = snap.docs.map((d) => d.data()).filter((m) => m.approved !== false);
    need = { players: ok.filter((m) => m.role === 'player').length, coaches: Math.max(1, ok.filter((m) => m.role === 'coach').length) };
  } catch { /* 못 읽으면 제한 없이 */ }
  const personal = spaceKind(t) === 'personal'; // 개인 계정은 원더키드만
  const rec = personal ? WONDERKID : recommend(need.players, need.coaches).plan;
  let cycle = 'month';
  const pool = personal ? [WONDERKID] : PLANS;
  let chosen = personal ? WONDERKID.id : (pl.kind === 'paid' && PLANS.find((p) => p.id === pl.plan && need.players <= p.players && need.coaches <= p.coaches)?.id) || rec?.id || null;
  const cur = () => { const p = pool.find((x) => x.id === chosen); return p ? { p, price: planPrice(p, cycle) } : null; };
  const fmtTel = (d) => (d.length > 7 ? `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}` : d);
  let payTel = fmtTel(String(state.profile?.payPhone || ''));
  const draw = () => {
    const c = cur();
    const start = Math.max(Date.now(), pl.kind === 'paid' ? pl.until : 0);
    const end = start + CYCLES[cycle].days * 864e5;
    el.innerHTML = `${pageHead('PAYMENT', pl.kind === 'paid' ? '이용기간 연장' : '요금제 고르기 · 결제')}
    <section class="card plan-now ${pl.kind === 'none' ? 'need' : ''}">
      <div class="kv"><span>팀</span><strong>${esc(t.name)} · ${esc(t.category)}</strong></div>
      <div class="kv"><span>지금</span><strong>${esc(planLine(pl))}</strong></div>
      ${pl.kind === 'none' ? '<p class="plan-alert">이용기간이 끝났어요. 결제하면 바로 다시 쓸 수 있어요 (기록은 그대로 남아 있어요).</p>' : ''}
      ${pl.kind === 'comp' ? '<p class="muted small">운영자 무료 제공 팀이라 결제하지 않아도 돼요.</p>' : ''}
      ${freeMode() && pl.kind !== 'paid' ? '<p class="plan-free-note">지금은 베타 기간이라 <b>결제하지 않아도 모든 기능을 무료로</b> 쓸 수 있어요. 유료로 바뀌기 30일 전에 알려 드려요.</p>' : ''}
    </section>
    ${cycleSeg(cycle)}
    ${personal ? '' : `<section class="card plan-calc">
      <h3>우리 팀 인원</h3>
      <div class="calc-grid">
        <div class="calc-in fixed"><div class="kv"><span>승인된 선수</span><strong>${need.players}명</strong></div><div class="kv"><span>승인된 지도자</span><strong>${need.coaches}명</strong></div>
          <p class="muted small">락커룸에서 승인된 사람만 세요. 인원이 늘면 다음 결제 때 맞는 요금제로 바꾸면 돼요.</p></div>
        <div>${teamResult(need.players, need.coaches, cycle)}</div>
      </div>
    </section>`}
    <form data-planform>${planCards(cycle, true, personal ? null : need, personal ? [WONDERKID] : null)}</form>
    ${!rec ? '<p class="plan-alert">인원이 프리미어 요금제보다 많아요 — 인빈시블 요금제는 운영자에게 상담해 주세요.</p>' : ''}
    <section class="card pay-sum">
      <div class="kv"><span>요금제</span><strong>${c ? `${c.p.name} · ${CYCLES[cycle].label}` : '위에서 골라 주세요'}</strong></div>
      <div class="kv"><span>이용기간</span><strong>${c ? `${fmtDate(new Date(start))} ~ ${fmtDate(new Date(end))}${pl.kind === 'paid' ? ' (남은 기간에 이어서)' : ''}` : '-'}</strong></div>
      ${c && need.players ? `<div class="kv"><span>선수 한 명당</span><strong>월 ${won(perHead(c.p, need.players, cycle))}</strong></div>` : ''}
      <div class="price-box"><span>결제 금액 (부가세 포함)</span><strong>${c ? won(c.price) : '-'}</strong></div>
      <label class="pay-tel">구매자 휴대폰 번호 <small class="muted">(필수 · 결제 확인 · 영수증 안내용, KG이니시스 · 포트원에 전달)</small>
        <input type="tel" inputmode="numeric" autocomplete="tel" maxlength="13" placeholder="010-1234-5678" data-paytel value="${esc(payTel)}"></label>
      <label class="pay-agree"><input type="checkbox" data-agree> <span>[필수] 결제 내용 · <a href="#/terms" target="_blank">이용약관</a> · <a href="#/refund" target="_blank">환불정책</a>을 확인했고 동의합니다</span></label>
      <p class="muted small">자동 결제가 아니에요 — 한 번만 결제되고, 끝나기 전에 직접 연장해요. 결제 후 7일 안에 쓰지 않았으면 전액 환불돼요.</p>
      <button type="button" class="btn full" data-paybtn ${c ? '' : 'disabled'}>${c ? `${won(c.price)} 결제하기` : '요금제를 골라 주세요'}</button>
      ${PAY_TEST ? '<p class="muted small center">테스트 모드 — 실제로 돈이 나가지 않아요.</p>' : ''}
    </section>
    <p class="muted small center"><a href="#/pricing">요금 안내</a> · <a href="#/refund">환불정책</a> · <a href="#/support">결제 문의</a></p>`;
    el.querySelectorAll('[data-cycle]').forEach((b) => (b.onclick = () => { cycle = b.dataset.cycle; draw(); }));
    el.querySelectorAll('[name=plan]').forEach((r) => { r.checked = r.value === chosen; r.onchange = () => { chosen = r.value; draw(); }; });
    const telIn = el.querySelector('[data-paytel]');
    telIn.oninput = () => { const d = telIn.value.replace(/\D/g, '').slice(0, 11); telIn.value = d.length > 7 ? `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d; payTel = telIn.value; };
    el.querySelector('[data-paybtn]').onclick = (e) => {
      if (!cur()) return;
      const tel = payTel.replace(/\D/g, '');
      if (!/^01[016789]\d{7,8}$/.test(tel)) { el.querySelector('[data-paytel]').focus(); return toast('구매자 휴대폰 번호를 확인해 주세요 (예: 010-1234-5678).'); }
      if (!el.querySelector('[data-agree]').checked) return toast('결제 내용 · 이용약관 · 환불정책 동의에 체크해 주세요.');
      if (tel !== String(state.profile.payPhone || '')) { state.profile.payPhone = tel; updateDoc(doc(db, 'users', state.user.uid), { payPhone: tel }).catch(() => {}); } // 다음 결제 때 미리 채움 (본인 · 운영자만 보는 개인 계정에만)
      portoneCheckout(t, cur(), cycle, e.currentTarget);
    };
  };
  draw();
}

// '결제하기'를 누르면: 포트원(PortOne V2) 결제창 — KG이니시스 채널 (포트원 콘솔에서 테스트 채널 → 심사 후 실연동 채널)
//  서버가 주문을 먼저 만들고(금액은 서버가 정함) → 결제창 → 끝나면 서버가 포트원에서 결제를 직접 읽어 확인 · 이용기간 연장
//  PC: 이 화면 위의 결제창 · 휴대폰 · 태블릿: 결제 화면으로 넘어갔다가 ?pay=portone 으로 돌아옴
const PORTONE_SDK = 'https://cdn.portone.io/v2/browser-sdk.js';
const loadScript = (src) => new Promise((ok, no) => {
  if ([...document.scripts].some((s) => s.src === src)) return ok();
  const s = document.createElement('script'); s.src = src; s.onload = () => ok(); s.onerror = () => no(new Error('결제 모듈을 불러오지 못했어요. 새로고침해 주세요.'));
  document.head.appendChild(s);
});
async function portoneCheckout(t, { p }, cycle, btn) {
  // 체험 모드: 이 컴퓨터의 데모 서버에서만 포트원 테스트 결제창까지 열어 봄 (기간 연장 없음)
  if (auth.demo && !/^(localhost|127\.)/.test(location.hostname)) return toast('체험 모드에서는 결제되지 않아요.');
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '결제창 여는 중…'; }
  try {
    const token = auth.demo ? 'demo' : await auth.currentUser.getIdToken();
    const [r] = await Promise.all([
      fetch('/api/pay?step=start', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ teamId: t.id, plan: p.id, cycle }) }),
      loadScript(PORTONE_SDK),
    ]);
    const o = await r.json().catch(() => ({}));
    if (!r.ok || !o.ok) throw new Error(o.message || '결제창을 열지 못했어요. 잠시 후 다시 해 주세요.');
    if (typeof window.PortOne?.requestPayment !== 'function') throw new Error('결제 모듈을 불러오지 못했어요. 새로고침해 주세요.');
    const res = await window.PortOne.requestPayment({
      storeId: o.storeId, channelKey: o.channelKey, paymentId: o.paymentId,
      orderName: o.orderName, totalAmount: o.totalAmount, currency: 'KRW', payMethod: 'CARD',
      // KG이니시스: 이름 필수 · PC는 휴대폰 번호 · 이메일도 필수
      customer: { fullName: state.profile.name || '지도자', phoneNumber: (state.profile.payPhone || '').replace(/\D/g, ''), email: state.user.email || undefined },
      redirectUrl: `${location.origin}${location.pathname}?pay=portone#/pay`, // 휴대폰: 결제 화면에서 이 주소로 돌아옴
    });
    if (!res) return; // 휴대폰은 위 주소로 넘어감
    if (res.code) throw new Error(res.message || '결제가 취소되었어요.');
    if (auth.demo) return toast('체험 모드라 결제창까지만 확인했어요 (기간 연장은 실제 사이트에서). 테스트 결제는 포트원이 자동으로 취소해요.');
    await confirmPayment({ paymentId: o.paymentId });
  } catch (err) {
    fail(err);
  } finally {
    if (btn?.isConnected) { btn.disabled = false; btn.textContent = label; }
  }
}

// 결제창이 끝나면 (PC: 바로 · 휴대폰: ?pay=portone&paymentId= 로 돌아온 뒤): 서버가 포트원에서 확인 · 이용기간 연장 → 결과 창
export async function confirmPayment({ paymentId }) {
  const m = modal('<div class="loading">결제 확인 중… 창을 닫지 마세요</div>');
  try {
    const token = await auth.currentUser.getIdToken();
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const c = await fetch('/api/pay?step=complete', { method: 'POST', headers: h, body: JSON.stringify({ paymentId }) });
    const cr = await c.json().catch(() => ({}));
    if (!c.ok || !cr.ok) throw new Error(cr.message || '결제를 확인하지 못했어요. 돈이 나갔다면 운영자에게 문의해 주세요.');
    const r = await fetch(`/api/pay?step=result&paymentId=${encodeURIComponent(paymentId || '')}`, { headers: h });
    const res = await r.json().catch(() => ({}));
    if (!r.ok || !res.ok) throw new Error(res.message || '결제 결과를 확인하지 못했어요. 돈이 나갔다면 운영자에게 문의해 주세요.');
    await loadContext();
    m.close();
    await hooks.route(); // 막혀 있던 화면이 풀리게 다시 그림
    const done = modal('');
    done.el.innerHTML = `<button class="modal-x">✕</button>
      <span class="eyebrow">PAYMENT COMPLETE</span><h2>결제 완료</h2>
      <p>${esc(res.planName || '')} 요금제로 <b>${esc(res.until || '')}</b>까지 쓸 수 있어요.</p>
      ${res.receiptUrl ? `<p><a href="${esc(res.receiptUrl)}" target="_blank" rel="noopener">영수증 보기</a></p>` : ''}
      <div class="row end"><a class="btn" href="#/">홈으로</a></div>`;
    done.el.querySelector('.modal-x').onclick = () => done.close();
    done.el.querySelector('a.btn').onclick = () => done.close();
  } catch (err) {
    m.close();
    fail(err);
  }
}

// ───────── 듀얼: 클럽 팀 선수가 보호자 코드로 보호자 공간에도 연결 (소속 팀은 그대로) ─────────
export function parentCodeModal() {
  const club = state.team?.name || '지금 팀';
  const m = modal(`<span class="eyebrow">CONNECT</span><h2>개인 계정 연결</h2>
    <p>보호자님이 <b>개인 계정</b>을 만들면 나오는 10자리 <b>보호자 코드</b>를 넣어요. <b>${esc(club)}</b>은(는) 그대로이고, 컨디션 · 수면 · 자각도 · 경기 기록(숫자)이 개인 계정에도 올라가요. 일지에 쓴 글은 올라가지 않아요.</p>
    <form class="stack"><input name="code" class="code-input" minlength="10" maxlength="10" required autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="10자리 보호자 코드">
    <label class="chk pl-agree"><input type="checkbox" name="agree" required> <span>[필수] 내 컨디션 · 수면 · 자각도 · 부상 · 경기 기록(숫자)을 연결한 보호자가 보는 데 동의해요 <small class="muted">(건강 정보 포함 · 일지 글은 내가 보여주기를 켠 것만 · 연결 끊기로 언제든 그만둘 수 있어요)</small></span></label>
    <button class="btn full">개인 계정 연결하기</button></form>`);
  const f = m.el.querySelector('form');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const code = f.code.value.replace(/\s/g, '');
    if (!/^[A-Za-z0-9]{10}$/.test(code)) return toast('보호자 코드는 영문 · 숫자 10자리예요.');
    try {
      const c = await getDoc(doc(db, 'teamCodes', code));
      if (!c.exists()) return toast('없는 코드예요. 대문자 · 소문자를 확인해 주세요.');
      const tid = c.data().teamId;
      const t = (await getDoc(doc(db, 'teams', tid))).data() || {};
      if (spaceKind(t) !== 'personal') return toast('보호자 코드가 아니에요. 팀 코드는 팀을 옮길 때만 써요.');
      if (!(await confirmBox(`${t.ownerName || '보호자'}님의 개인 계정(${t.name || ''})에 연결할까요?\n\n${club}은(는) 그대로예요. 연결되면 컨디션 · 수면 · 자각도 · 경기 기록(숫자)이 개인 계정에도 올라가요. 일지에 쓴 글은 올라가지 않아요. (일지마다 끌 수 있어요)`))) return;
      const b = writeBatch(db);
      b.set(doc(db, 'teams', tid, 'members', state.user.uid), { ...publicProfile(state.profile), role: state.profile.role, code, joinedAt: serverTimestamp(), approved: false, dual: true, shareAgreedAt: serverTimestamp() });
      b.update(doc(db, 'users', state.user.uid), { parentSpace: tid });
      await b.commit();
      state.profile.parentSpace = tid;
      await loadParentLink();
      hooks.updateShell();
      m.close();
      toast('개인 계정 연결을 신청했어요. 보호자님이 승인하면 연결돼요.');
      hooks.route();
    } catch (err) { fail(err.code === 'permission-denied' ? { message: '연결할 수 없어요. (코드를 확인하거나 보호자님께 문의해 주세요)' } : err); }
  };
}
export async function unlinkParent() {
  const L = state.parentLink; if (!L) return;
  if (!(await confirmBox(`개인 계정(${L.owner}) 연결을 끊을까요? 지금까지 올린 일지는 개인 계정에 그대로 남아요. 다시 연결하려면 보호자 코드가 필요해요.`))) return;
  try {
    const b = writeBatch(db);
    b.delete(doc(db, 'teams', L.id, 'members', state.user.uid));
    b.update(doc(db, 'users', state.user.uid), { parentSpace: null });
    await b.commit();
    state.profile.parentSpace = null; state.parentLink = null;
    hooks.updateShell(); toast('개인 계정 연결을 끊었어요.'); hooks.route();
  } catch (err) { fail(err); }
}

export function joinTeam(el) {
  if (state.team && state.member) return go('/');
  el.innerHTML = `${pageHead('JOIN TEAM', '팀 코드로 입장')}
  <form class="card narrow">
    <p class="muted">팀 대표 지도자에게 받은 10자리 팀 코드를 입력하세요. (보호자에게 받은 <b>보호자 코드</b> · <b>지도자 코드</b>도 여기에) <strong>대문자 · 소문자를 구분</strong>합니다. ${ROLES[state.profile.role]} 계정으로 입장합니다.</p>
    <input name="code" class="code-input" minlength="10" maxlength="10" required autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="10자리 코드">
    <button class="btn full">팀 찾기</button>
    <p class="muted small center">아직 코드가 없나요? 팀 대표 지도자에게 받으면 돼요. <a href="#/">나중에 입력할게요 →</a></p>
  </form>`;
  const form = el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const code = form.code.value.replace(/\s/g, '');
    if (!/^[A-Za-z0-9]{10}$/.test(code)) return toast('팀 코드는 영문 · 숫자 10자리입니다.');
    try {
      const c = await getDoc(doc(db, 'teamCodes', code));
      if (!c.exists()) return toast('존재하지 않는 코드입니다.');
      const teamId = c.data().teamId;
      const t = await getDoc(doc(db, 'teams', teamId));
      const team = t.data();
      const kind = spaceKind(team);
      if (kind === 'personal' && state.profile.role !== 'player') return toast('보호자 코드는 선수 계정으로만 연결할 수 있어요.');
      if (kind === 'gaffer' && state.profile.role !== 'coach') return toast('지도자 코드는 지도자 계정으로만 들어갈 수 있어요.');
      const m = modal(`<span class="eyebrow">${esc(kind === 'team' ? team.category : SPACES[kind].name)}</span><h2>${esc(team.name)}</h2>
        <p>${kind === 'personal' ? '보호자와 <strong>연결</strong>할까요? 보호자가 승인하면 기록 · 영상을 함께 볼 수 있어요.' : `이 ${kind === 'gaffer' ? '모임' : '팀'}에 <strong>${ROLES[state.profile.role]}</strong>(으)로 입장할까요?`}</p>
        ${kind === 'personal' ? '<label class="chk pl-agree"><input type="checkbox" data-agree> <span>[필수] 내 컨디션 · 수면 · 자각도 · 부상 · 경기 기록(숫자)을 보호자가 보는 데 동의해요 <small class="muted">(건강 정보 포함 · 일지 글은 내가 보여주기를 켠 것만)</small></span></label>' : ''}
        <div class="row end"><button class="btn" data-ok>${kind === 'personal' ? '연결하기' : '입장하기'}</button></div>`);
      m.el.querySelector('[data-ok]').onclick = async () => {
        if (kind === 'personal' && !m.el.querySelector('[data-agree]')?.checked) { toast('보호자가 볼 기록 범위에 동의해야 연결할 수 있어요.'); return; }
        try {
          await setDoc(doc(db, 'teams', teamId, 'members', state.user.uid), {
            ...publicProfile(state.profile), role: state.profile.role, code, joinedAt: serverTimestamp(),
            approved: false, // 팀 대표가 승인해야 팀 내용을 볼 수 있음
            ...(state.profile.under14 ? { under14: true, consentToken: state.profile.consentToken } : {}),
            ...(kind === 'personal' ? { shareAgreedAt: serverTimestamp() } : {}),
          });
          await updateDoc(doc(db, 'users', state.user.uid), { teamId });
          m.close();
          await loadContext();
          toast(`${team.name} 락커룸에 입장했습니다.`);
          go('/');
        } catch (err) {
          fail(err.code === 'permission-denied' ? { message: '입장할 수 없습니다. (팀 이용기간 만료 또는 코드 오류)' } : err);
        }
      };
    } catch (err) { fail(err); }
  };
}

export async function settings(el) {
  const t = state.team;
  let billing = {};
  try {
    const b = await getDoc(doc(db, 'teams', t.id, 'private', 'billing'));
    billing = b.data() || {};
  } catch { /* 결제 전 */ }

  const kind = spaceKind(); const SP = SPACES[kind];
  const word = kind === 'team' ? '팀' : kind === 'gaffer' ? '모임' : '공간';
  el.innerHTML = `${pageHead('SETTINGS', freeMode() ? `${kind === 'team' ? '팀 ' : ''}설정` : `${kind === 'team' ? '팀 ' : ''}설정 · 결제`)}
  <div class="grid2 top">
    <section class="card">
      <h3>${SP.code}</h3>
      ${billing.code
        ? `<div class="code-big" data-copy>${esc(billing.code)}</div><p class="muted small">클릭하면 복사됩니다. ${kind === 'personal' ? '선수가 선수 계정으로 이 코드를 넣어 연결해요' : kind === 'gaffer' ? '지도자가 이 코드로 들어와요' : '선수 · 코치가 이 코드로 입장합니다'}. 대문자 · 소문자를 구분해요.</p>`
        : '<p class="muted">결제 완료 후 발급됩니다.</p>'}
      ${freeMode() ? `<h3>이용</h3><div class="kv"><span>상태</span><strong>${esc(planLine())}</strong></div>
      <p class="muted small">지금은 베타 기간이라 모든 팀이 데모(무료)예요. 유료로 바뀌기 30일 전에 알려 드려요.</p>
      <a class="btn ghost full" href="#/pay">요금제 · 결제 화면</a>
      <p class="muted small"><a href="#/pricing">요금 안내</a> · <a href="#/refund">환불정책</a></p>` : `<h3>이용권</h3>
      <div class="kv"><span>상태</span><strong>${esc(planLine())}</strong></div>
      ${compActive(t) ? '' : `<a class="btn full" href="#/pay">${teamPlan().kind === 'paid' ? '연장 결제' : '요금제 고르기 · 결제'}</a>`}
      <p class="muted small"><a href="#/pricing">요금 안내</a> · <a href="#/refund">환불정책</a></p>`}
    </section>
    <form class="card">
      <h3>${word} 정보</h3>
      <label>${kind === 'personal' ? '이름' : `${word} 이름`}<input name="name" required minlength="2" maxlength="30" value="${esc(t.name)}" placeholder="${kind === 'personal' ? '예) 홍길동 선수' : '예) 블랙 FC U15, 한빛초 축구부'}"></label>
      ${kind === 'team' ? `<p class="name-note${t.nameWarn ? ' on' : ''}">팀을 알아볼 수 있게 실제 팀 이름을 정확하게 적어 주세요. 알아볼 수 없는 이름은 기능이 제한될 수 있어요.</p>` : ''}
      ${kind === 'gaffer' ? `<input type="hidden" name="category" value="${esc(t.category || '지도자 계정')}">` : `<label>${kind === 'personal' ? '선수 학년 · 연령' : '팀 구분 <small class="muted">(연령 · 리그 — 바꾸면 팀 검색에서 이 구분으로 보여요)</small>'}<select name="category">${options(CATEGORIES, normCat(t.category))}</select></label>`}
      <p class="muted small">${kind === 'team' ? '다른 팀에는 팀 이름 · 구분 · 대표 지도자 이름만 보여요. 선수단과 팀 안 내용은 우리 팀만 봐요.' : '팀 검색 · 팀 대화 목록에 나오지 않아요.'}</p>
      <button class="btn">저장</button>
    </form>
    <section class="card">
      <h3>종류 바꾸기</h3>
      <p class="muted small">지금은 <b>${SP.name}</b>이에요. 다른 종류로 옮기고 싶으면 신청해 주세요. 운영자가 확인한 뒤 옮겨 드리고, 요금제도 그 종류에 맞게 바뀌어요. 기록 · 영상은 그대로 이어져요.</p>
      <div class="row"><select data-tokind>${Object.entries(SPACES).filter(([k]) => k !== kind).map(([k, v]) => `<option value="${k}">${v.name}(으)로</option>`).join('')}</select>
        <button type="button" class="btn ghost" data-kindreq>신청하기</button></div>
    </section>
    ${kind === 'personal' ? '' : `<section class="card">
      <h3>대표 넘기기</h3>
      <p class="muted small">팀 대표(입장 승인 · 팀 설정 · 내보내기)를 우리 팀의 다른 지도자에게 넘겨요. 넘기면 나는 일반 지도자가 되고, 되돌리려면 새 대표가 다시 넘겨줘야 해요.</p>
      <div data-owner><p class="muted small">지도자 목록 불러오는 중…</p></div>
    </section>`}
  </div>`;
  el.querySelector('[data-kindreq]').onclick = async () => {
    const to = el.querySelector('[data-tokind]').value;
    if (!(await confirmBox(`${SP.name} → ${SPACES[to].name}(으)로 옮기기를 신청할까요? 운영자가 확인한 뒤 연락드려요.`))) return;
    try {
      await addDoc(collection(db, 'feedback'), {
        kind: '종류 변경', title: `종류 바꾸기 신청: ${SP.name} → ${SPACES[to].name}`, body: `${t.name} (${t.id}) — ${SPACES[to].name}(으)로 옮기고 싶어요.`, status: '접수',
        uid: state.user.uid, name: state.profile.name, role: state.profile.role, teamId: t.id, teamName: t.name || '', toKind: to, createdAt: serverTimestamp(),
      });
      toast('신청했어요. 운영자 문의 → 내가 남긴 글에서 답변을 볼 수 있어요.');
    } catch (err) { fail(err); }
  };
  // 대표 넘기기: 승인된 우리 팀 지도자에게만
  if (kind !== 'personal') getDocs(collection(db, 'teams', t.id, 'members')).then((ms) => {
    const coaches = ms.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.role === 'coach' && m.approved !== false && m.id !== state.user.uid);
    const box = el.querySelector('[data-owner]');
    if (!box) return;
    if (!coaches.length) { box.innerHTML = '<p class="muted small">넘겨줄 지도자가 없어요. 다른 지도자가 팀 코드로 들어와 승인되면 여기서 고를 수 있어요.</p>'; return; }
    box.innerHTML = `<div class="row"><select data-newowner>${coaches.map((c) => `<option value="${c.id}">${esc(c.name)}${c.coachTitle ? ` · ${esc(c.coachTitle)}` : ''}</option>`).join('')}</select>
      <button type="button" class="btn ghost" data-transfer>대표 넘기기</button></div>`;
    box.querySelector('[data-transfer]').onclick = async () => {
      const c = coaches.find((x) => x.id === box.querySelector('[data-newowner]').value);
      if (!c || !(await confirmBox(`${c.name} 지도자에게 팀 대표를 넘길까요? 넘긴 뒤에는 나는 팀 설정 · 입장 승인을 할 수 없어요.`))) return;
      try {
        await updateDoc(doc(db, 'teams', t.id), { ownerUid: c.id, ownerName: c.name || '' });
        toast(`${c.name} 지도자가 이제 팀 대표예요.`);
        await loadContext();
        go('/');
      } catch (err) { fail(err); }
    };
  }).catch(() => {});
  el.querySelector('[data-copy]')?.addEventListener('click', () => {
    (navigator.clipboard?.writeText(billing.code) || Promise.reject()).then(() => toast(`${SP.code}를 복사했습니다.`), () => toast(`복사가 안 돼요 — ${SP.code}: ${billing.code}`));
  });
  const form = el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(form);
    const patch = { name: d.name.trim(), category: d.category };
    try {
      await updateDoc(doc(db, 'teams', t.id), patch);
      Object.assign(state.team, patch);
      hooks.updateShell();
      toast('저장했습니다.');
    } catch (err) { fail(err); }
  };
}
