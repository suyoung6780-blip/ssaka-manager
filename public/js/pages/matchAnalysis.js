// 분석실 > 경기분석 — 영상을 보며 경기장을 탭해 장면 기록 → 상대(또는 우리) 공격 방향 · 슈팅 · 크로스 · 위험 지역 · 시간대 흐름 리포트
// + AI 포메이션 제안 (화면의 선수를 찾아 유니폼 색으로 팀을 나누고, 상대 선수들의 줄을 세어 4-4-2 같은 형태로)
import { db, doc, updateDoc, deleteDoc } from '../fb.js';
import { esc, toast, fail, modal, confirmBox, empty } from '../ui.js';
import { state, go } from '../store.js';
import { createPad, blank } from '../tactic.js';
import { loadAI, scanFrame } from '../detector.js';

const col = () => ['teams', state.team.id, 'posts'];
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const uid = () => Math.random().toString(36).slice(2, 9);

// 기록하는 장면 종류: [키, 이름, 단축키, 색]
export const KINDS = [
  ['attack', '공격 전개', 'A', '#4ea1ff'],
  ['shot', '슈팅', 'S', '#ffd400'],
  ['goal', '득점', 'G', '#34c759'],
  ['cross', '크로스', 'C', '#ff9f0a'],
  ['loss', '볼 뺏김', 'L', '#ff3b30'],
  ['win', '볼 탈취', 'W', '#bf5af2'],
  ['setpiece', '세트피스', 'P', '#64d2ff'],
  ['note', '메모', 'N', '#9a9a9a'],
];
const KIND = Object.fromEntries(KINDS.map(([k, l, key, c]) => [k, { l, key, c }]));
const TEAM = { opp: '상대', us: '우리' };
export const TARGETS = [['opp', '상대 팀'], ['us', '우리 팀'], ['both', '두 팀 다']];

// ───────── 포메이션 (작전판 없이: 포메이션 고르기 + 포지션별 번호) ─────────
export const FORMS = {
  11: ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '4-4-1-1', '4-3-1-2', '3-5-2', '3-4-3', '3-4-2-1', '5-3-2', '5-4-1'],
  8: ['2-3-2', '2-4-1', '3-3-1', '3-2-2', '2-3-1-1', '3-1-2-1'],
};
const PHASES = [['base', '기본'], ['att', '공격 시'], ['def', '수비 시']];
const validForm = (f, size) => /^\d(-\d){1,4}$/.test(f || '') && f.split('-').reduce((a, b) => a + +b, 0) === size - 1;
// 포메이션 → 자리(오른쪽으로 공격, y 0 = 왼쪽 측면) + 포지션 이름
export function positionsOf(f) {
  const lines = String(f).split('-').map(Number).filter((n) => n > 0);
  const L = lines.length;
  const out = [{ x: 0.06, y: 0.5, role: 'GK' }];
  lines.forEach((c, li) => {
    const x = L === 1 ? 0.5 : 0.25 + (li * (0.84 - 0.25)) / (L - 1);
    const type = li === 0 ? 'B' : li === L - 1 ? 'F' : L >= 4 && li === 1 ? 'DM' : L >= 4 && li === L - 2 ? 'AM' : 'M';
    for (let i = 0; i < c; i++) {
      const y = c === 1 ? 0.5 : 0.13 + (i * 0.74) / (c - 1);
      const side = c >= 3 && i === 0 ? 'L' : c >= 3 && i === c - 1 ? 'R' : '';
      let role = { B: 'CB', DM: 'DM', AM: 'AM', M: 'CM', F: 'ST' }[type];
      if (side && type === 'B') role = c >= 5 ? `${side}WB` : c >= 4 ? `${side}B` : 'CB';
      else if (side && type === 'M') role = c >= 4 ? `${side}M` : 'CM';
      else if (side && type === 'F') role = `${side}W`;
      else if (side && type === 'AM') role = `${side}W`;
      out.push({ x, y, role });
    }
  });
  return out;
}
// 포메이션 그림 (번호 보기 · 고치기)
export function lineupHtml(lu, { edit = false, color = '#e5484d', keys = [] } = {}) {
  if (!lu?.f) return '<p class="muted small">아직 정하지 않았어요.</p>';
  const star = new Set(keys.map((k) => String(k.num || '').trim()).filter(Boolean));
  return `<div class="lu-pitch" style="--c:${color}">${positionsOf(lu.f).map((p, i) => `<div class="lu-pos ${star.has(String(lu.nums?.[i] || '').trim()) ? 'key' : ''}" style="left:${p.x * 100}%;top:${p.y * 100}%">
    ${edit ? `<input data-lunum="${i}" value="${esc(lu.nums?.[i] || '')}" maxlength="3" inputmode="numeric" aria-label="${p.role} 번호">` : `<b>${esc(lu.nums?.[i] || '')}</b>`}<small>${p.role}</small></div>`).join('')}</div>`;
}
// 저장 좌표: x 0 = 그 팀 골문 쪽, 1 = 공격 방향 / y 0 = 공격하는 팀 기준 왼쪽, 1 = 오른쪽
const channel = (y) => (y < 1 / 3 ? '왼쪽' : y > 2 / 3 ? '오른쪽' : '가운데');
const third = (x) => (x < 1 / 3 ? '수비 1/3' : x > 2 / 3 ? '공격 1/3' : '중앙 1/3');
// 화면(카메라가 한쪽 사이드라인)에서 누른 곳 ↔ 저장 좌표
const attacksRight = (team, oppDir) => (team === 'opp' ? oppDir === 'right' : oppDir !== 'right');
const toStore = (sx, sy, team, oppDir) => (attacksRight(team, oppDir) ? [sx, sy] : [1 - sx, 1 - sy]);
const toScreen = (x, y, team, oppDir) => (attacksRight(team, oppDir) ? [x, y] : [1 - x, 1 - y]);
const r3 = (v) => Math.round(v * 1000) / 1000;

// 경기장 SVG (105 × 68)
function pitchSvg(inner = '', { half = false, cls = '' } = {}) {
  const vb = half ? '52.5 0 52.5 68' : '0 0 105 68';
  return `<svg class="ma-pitch ${cls}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="0" width="105" height="68" class="pf"/>
    <g class="pl"><rect x="0.5" y="0.5" width="104" height="67"/><line x1="52.5" y1="0.5" x2="52.5" y2="67.5"/><circle cx="52.5" cy="34" r="9.15"/>
      <rect x="0.5" y="13.85" width="16.5" height="40.3"/><rect x="88" y="13.85" width="16.5" height="40.3"/>
      <rect x="0.5" y="24.85" width="5.5" height="18.3"/><rect x="99" y="24.85" width="5.5" height="18.3"/>
      <line x1="35" y1="0.5" x2="35" y2="67.5" class="third"/><line x1="70" y1="0.5" x2="70" y2="67.5" class="third"/></g>
    ${inner}</svg>`;
}
const dot = (x, y, c, r = 1.3, extra = '') => `<circle cx="${(x * 105).toFixed(1)}" cy="${(y * 68).toFixed(1)}" r="${r}" fill="${c}" ${extra}/>`;

export async function matchStudio(el, post, { canEdit, files, sample = false }) {
  const data = {
    events: post.events || [],
    formations: post.formations || [], // 예전 작전판 포메이션 (보기만)
    oppDir: post.oppDir || 'right',
    target: post.target || 'both', // 예전 분석은 두 팀 다
    size: post.size || 11,
    lineups: post.lineups || {},
    keys: post.keys || {}, // 키 플레이어 { opp: [{ id, num, pos, name, note }], us: [...] }
  };
  const teams = data.target === 'both' ? ['opp', 'us'] : [data.target];
  const main = teams[0];
  let tab = canEdit ? 'tag' : 'check';
  let kind = 'attack';
  let team = data.target === 'us' ? 'us' : 'opp';
  let saveT = null;
  let lastId = null; // 방금 기록한 장면
  const file = files.get(post.id);
  const vsrc = post.video?.url || (file ? URL.createObjectURL(file) : '');
  if (file) state.cleanup.push(() => URL.revokeObjectURL(vsrc));

  el.innerHTML = `<div class="studio ma">
    <header class="studio-top"><a href="#/analysis" class="icon-btn" aria-label="목록">‹</a>
      <div class="st-title"><strong>${esc(post.title)}</strong><small>경기분석 · ${esc([post.opponent && `vs ${post.opponent}`, post.date].filter(Boolean).join(' · '))}</small></div>
      <div class="st-actions"><span class="muted small" data-saved></span>${canEdit ? '<button class="btn ghost sm" data-del>삭제</button><button class="btn sm" data-savebtn>저장</button>' : ''}</div></header>
    ${sample ? '<div class="banner sample-banner">예시 리포트예요 — 실제 경기 기록이 아니라, 경기분석으로 이런 걸 볼 수 있다는 걸 보여 드려요.</div>' : ''}
    <nav class="tabs admin-tabs ma-tabs">${[...(canEdit ? [['tag', '기록하기']] : [['check', '체크 포인트']]), ['formation', '포메이션'], ['report', '리포트']].map(([k, l]) => `<a href="javascript:void 0" data-tab="${k}">${l}</a>`).join('')}</nav>
    <div class="ma-body">
      <div class="ma-video" ${canEdit ? '' : 'hidden'}>
        ${vsrc ? `<div class="ma-vwrap"><video playsinline preload="auto" crossorigin="anonymous" src="${esc(vsrc)}"></video><canvas class="ma-ai" hidden></canvas>${canEdit ? '<div class="ma-status" data-status></div>' : ''}</div>
          <div class="ma-ctl"><button class="icon-btn" data-play>▶</button><button class="icon-btn sm" data-step="-5">«</button><button class="icon-btn sm" data-step="5">»</button>
          <span class="st-time" data-time>0:00</span><span class="ma-seek"><input type="range" min="0" max="1000" value="0" data-seek><span class="ma-marks" data-marks></span></span>
          <select data-rate><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="1.5">1.5x</option><option value="2">2x</option></select></div>`
        : `<div class="card ma-novideo"><p>경기 영상을 열면 보면서 기록할 수 있어요. 영상은 서버에 올라가지 않아요.</p>
          <label class="btn file-btn">경기 영상 파일 열기<input type="file" accept="video/*" hidden data-file></label>
          <p class="muted small">영상 없이도 <b>포메이션 · 리포트</b>는 볼 수 있어요.</p></div>`}
      </div>
      <div class="ma-panel" data-panel></div>
    </div>
  </div>`;

  const video = el.querySelector('video');
  const panel = el.querySelector('[data-panel]');
  const t = () => video?.currentTime || 0;
  el.querySelector('[data-file]')?.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    files.set(post.id, f);
    matchStudio(el, post, { canEdit, files });
  });
  el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmBox('이 경기분석을 삭제할까요?'))) return;
    try { await deleteDoc(doc(db, ...col(), post.id)); go('/analysis'); } catch (err) { fail(err); }
  });

  // 저장: 바꿀 때마다 잠깐 기다렸다가 한 번에
  const payload = () => ({
    events: data.events, formations: data.formations, oppDir: data.oppDir, target: data.target, size: data.size, lineups: data.lineups, keys: data.keys,
    // 리포트 요약도 함께 (영상은 저장하지 않음)
    report: { opp: computeReport(data.events, 'opp').summary, us: computeReport(data.events, 'us').summary, n: data.events.length, at: new Date().toISOString() },
  });
  const stamp = (msg) => { const n = new Date(); el.querySelector('[data-saved]').textContent = `${msg} ${n.getHours()}:${String(n.getMinutes()).padStart(2, '0')}`; };
  const save = () => {
    if (sample) return;
    clearTimeout(saveT);
    el.querySelector('[data-saved]').textContent = '저장 중…';
    saveT = setTimeout(async () => {
      try {
        await updateDoc(doc(db, ...col(), post.id), payload());
        Object.assign(post, data);
        stamp('자동 저장됨');
      } catch (err) { fail(err); el.querySelector('[data-saved]').textContent = '저장 실패'; }
    }, 700);
  };
  el.querySelector('[data-savebtn]')?.addEventListener('click', async () => {
    clearTimeout(saveT);
    try {
      await updateDoc(doc(db, ...col(), post.id), payload());
      Object.assign(post, data);
      stamp('저장됨');
      toast(`저장했어요 — 기록 ${data.events.length}개 · 포메이션 ${data.formations.length}개 · 리포트 (영상은 저장되지 않아요)`);
    } catch (err) { fail(err); }
  });

  // 공격 방향 표시: 우리 팀만 분석하면 '우리 공격' 기준으로
  const dirLabel = () => (main === 'us' ? '우리 공격' : '상대 공격');
  const dirArrow = () => (attacksRight(main, data.oppDir) ? '→' : '←');

  // ── 기록 상태 표시: 영상이 자동으로 분석되지 않으니, 지금 기록 중인지 · 얼마나 기록했는지 늘 보이게 ──
  let idle = 0; // 마지막 기록 뒤 실제로 재생된 시간(초)
  let lastTU = null;
  let flash = null; // 방금 기록한 장면 (잠깐 표시)
  const drawStatus = () => {
    const box = el.querySelector('[data-status]');
    if (!box || !video) return;
    const n = data.events.length;
    let cls = ''; let html;
    if (flash && Date.now() - flash.at < 2500) { cls = 'ok'; html = `✓ 기록됨 · ${TEAM[flash.team]} ${KIND[flash.k].l} (${fmtT(flash.t)}) · 총 ${n}개`; }
    else if (video.paused) html = `⏸ 멈춤 · 기록 ${n}개 — 장면(종류)을 고르고 오른쪽 경기장을 누르면 기록돼요`;
    else if (idle >= 60) { cls = 'warn'; html = `⚠ ${Math.floor(idle / 60)}분 넘게 기록이 없어요 — 장면이 있었으면 <kbd>Space</kbd>로 멈추고 경기장을 눌러 주세요`; }
    else { cls = 'rec'; html = `<i></i>기록 중 · ${n}개 — 장면이 나오면 오른쪽 경기장을 누르세요`; }
    box.className = `ma-status ${cls}`;
    box.innerHTML = html;
  };
  const drawMarks = () => {
    const box = el.querySelector('[data-marks]');
    const d = video?.duration;
    if (!box || !d) return;
    box.innerHTML = data.events.filter((e) => e.t <= d).map((e) => `<i style="left:${(e.t / d) * 100}%;background:${KIND[e.k].c}"></i>`).join('');
  };
  const tagged = (e) => { idle = 0; flash = { ...e, at: Date.now() }; drawStatus(); drawMarks(); setTimeout(drawStatus, 2600); };

  // ── 영상 조작 ──
  if (video) {
    video.addEventListener('timeupdate', () => {
      const now = t();
      if (!video.paused && lastTU != null && now > lastTU && now - lastTU < 2) idle += now - lastTU;
      lastTU = now;
      drawStatus();
    });
    video.addEventListener('loadedmetadata', () => { drawMarks(); drawStatus(); });
    drawStatus();
    video.addEventListener('pause', drawStatus);
    const upd = () => {
      el.querySelector('[data-time]').textContent = `${fmtT(t())} / ${fmtT(video.duration || 0)}`;
      el.querySelector('[data-seek]').value = video.duration ? Math.round((t() / video.duration) * 1000) : 0;
      el.querySelector('[data-play]').textContent = video.paused ? '▶' : '❚❚';
      if (tab === 'tag') drawTagPitch();
    };
    video.addEventListener('timeupdate', upd);
    video.addEventListener('play', upd); video.addEventListener('pause', upd); video.addEventListener('loadedmetadata', upd);
    el.querySelector('[data-play]').onclick = () => (video.paused ? video.play() : video.pause());
    el.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => { video.currentTime = Math.max(0, t() + +b.dataset.step); }));
    el.querySelector('[data-seek]').oninput = (e) => { video.currentTime = (e.target.value / 1000) * (video.duration || 0); };
    el.querySelector('[data-rate]').onchange = (e) => { video.playbackRate = +e.target.value; };
    state.cleanup.push(() => video.pause());
  }

  // ── 탭 ──
  const setTab = (k) => {
    tab = k;
    el.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === k));
    el.querySelector('.ma-video').hidden = !(canEdit && (k === 'tag' || k === 'formation'));
    el.querySelector('.ma-body').classList.toggle('wide', !(canEdit && (k === 'tag' || k === 'formation')));
    if (k === 'tag') drawTag(); else if (k === 'check') drawCheck(); else if (k === 'formation') drawFormation(); else drawReport();
  };
  el.querySelectorAll('[data-tab]').forEach((a) => (a.onclick = () => setTab(a.dataset.tab)));

  // ───────── 기록하기 ─────────
  function drawTag() {
    panel.innerHTML = `
      <div class="ma-row">${teams.length > 1 ? `<div class="seg" data-team>${teams.map((k) => `<button class="${k === team ? 'on' : ''}" data-tm="${k}">${TEAM[k]} 팀</button>`).join('')}</div>` : `<span class="tag solid">${TEAM[main]} 팀 분석</span>`}
        <button class="btn ghost sm" data-dir title="하프타임에 바꿔 주세요">${dirLabel()} 방향 ${dirArrow()}</button></div>
      <div class="ma-kinds">${KINDS.map(([k, l, key, c]) => `<button class="${k === kind ? 'on' : ''}" data-kind="${k}" style="--c:${c}"><i></i>${l}<kbd>${key}</kbd></button>`).join('')}</div>
      <p class="muted small ma-hint">${video ? `영상은 자동으로 분석되지 않아요 — <b>코치님이 누른 장면</b>으로 리포트가 만들어져요.<br><b>${KIND[kind].l}</b>(${TEAM[team]})을 고른 채로 아래 경기장에서 <b>일어난 곳</b>을 누르세요 → 지금 영상 시각(${fmtT(t())})으로 기록돼요. 화면에 보이는 그대로 누르면 돼요.` : '영상을 열면 기록할 수 있어요.'}</p>
      <div class="ma-tagpitch" data-pitch></div>
      <div class="ma-keys muted small">단축키: <kbd>Space</kbd> 재생 · <kbd>←</kbd><kbd>→</kbd> 5초 · <kbd>Q</kbd> 상대/우리 · ${KINDS.map(([, l, key]) => `<kbd>${key}</kbd> ${l}`).join(' · ')}</div>
      <div class="ma-live" data-live></div>
      <section class="card kp-edit" data-kps>${keysEditHtml()}</section>
      <h4 class="ma-h">기록 <small>${data.events.length}개</small></h4>
      <ul class="list ma-log" data-log></ul>`;
    panel.querySelectorAll('[data-tm]').forEach((b) => (b.onclick = () => { team = b.dataset.tm; drawTag(); }));
    panel.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => { kind = b.dataset.kind; drawTag(); }));
    panel.querySelector('[data-dir]').onclick = () => { data.oppDir = data.oppDir === 'right' ? 'left' : 'right'; save(); drawTag(); };
    drawTagPitch();
    drawLog();
    drawLive();
    bindKeys();
  }
  // 키 플레이어 (기록하기에서 영상 보며 바로 적기) — 번호가 포메이션에 있으면 표시
  function keysEditHtml() {
    return `<h4>키 플레이어 <small class="muted">영상 보며 눈에 띄는 선수를 바로 적어요</small></h4>
      <datalist id="kp-pos">${['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LM', 'RM', 'LW', 'RW', 'ST'].map((x) => `<option value="${x}">`).join('')}</datalist>
      ${teams.map((tm) => `${teams.length > 1 ? `<p class="kp-team" style="--c:${tm === 'opp' ? '#e5484d' : '#4ea1ff'}">${TEAM[tm]} 팀</p>` : ''}
        ${(data.keys[tm] || []).map((k) => `<div class="kp-row" data-kt="${tm}" data-kid="${k.id}">
          <input data-k="num" value="${esc(k.num || '')}" placeholder="번호" maxlength="3" inputmode="numeric">
          <input data-k="pos" value="${esc(k.pos || '')}" placeholder="포지션" maxlength="6" list="kp-pos">
          <input data-k="name" value="${esc(k.name || '')}" placeholder="이름 (몰라도 돼요)" maxlength="12">
          <input data-k="note" value="${esc(k.note || '')}" placeholder="특징 예) 왼발 · 스피드 · 오른쪽 돌파" maxlength="60">
          <button type="button" class="link-btn small" data-kdel>✕</button></div>`).join('')}
        <button type="button" class="btn ghost sm" data-kadd="${tm}">+ ${teams.length > 1 ? `${TEAM[tm]} 팀 ` : ''}키 플레이어 추가</button>`).join('')}`;
  }
  function bindKeys() {
    const box = panel.querySelector('[data-kps]');
    if (!box) return;
    const redraw = (focusTm) => {
      box.innerHTML = keysEditHtml(); bindKeys();
      if (focusTm) box.querySelector(`.kp-row[data-kt="${focusTm}"]:last-of-type [data-k="num"]`)?.focus();
    };
    box.querySelectorAll('[data-kadd]').forEach((b) => (b.onclick = () => {
      const tm = b.dataset.kadd;
      data.keys = { ...data.keys, [tm]: [...(data.keys[tm] || []), { id: uid(), num: '', pos: '', name: '', note: '' }] };
      save(); redraw(tm);
    }));
    box.querySelectorAll('.kp-row').forEach((row) => {
      const tm = row.dataset.kt;
      const k = (data.keys[tm] || []).find((x) => x.id === row.dataset.kid);
      row.querySelectorAll('[data-k]').forEach((inp) => (inp.oninput = () => { k[inp.dataset.k] = inp.value.trim(); save(); }));
      row.querySelector('[data-kdel]').onclick = () => { data.keys[tm] = data.keys[tm].filter((x) => x !== k); save(); redraw(); };
    });
  }
  // 기록할 때마다 바로 바뀌는 미니 리포트 (상대 팀)
  function drawLive() {
    const box = panel.querySelector('[data-live]');
    if (box) box.innerHTML = liveHtml(data.events, main);
  }
  function drawTagPitch() {
    const box = panel.querySelector('[data-pitch]');
    if (!box) return;
    const now = t();
    // 최근 30초의 기록은 화면 방향 그대로 점으로
    const recent = data.events.filter((e) => Math.abs(e.t - now) <= 30).map((e) => {
      const [sx, sy] = toScreen(e.x, e.y, e.team, data.oppDir);
      return dot(sx, sy, KIND[e.k].c, 1.4, `stroke="${e.team === 'opp' ? '#fff' : '#000'}" stroke-width=".4"`);
    }).join('');
    const arrow = dirArrow() === '→' ? `${dirLabel()} →` : `← ${dirLabel()}`;
    box.innerHTML = `${pitchSvg(`${recent}<text x="52.5" y="4.5" class="ma-dirtxt">${arrow}</text>`, { cls: 'tag' })}`;
    const svg = box.querySelector('svg');
    svg.onclick = (ev) => {
      if (!video) return toast('먼저 경기 영상을 열어 주세요.');
      const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      const sx = Math.min(1, Math.max(0, p.x / 105)); const sy = Math.min(1, Math.max(0, p.y / 68));
      const [x, y] = toStore(sx, sy, team, data.oppDir);
      const e = { id: uid(), t: +t().toFixed(1), team, k: kind, x: r3(x), y: r3(y) };
      if (kind === 'note') { const s = prompt('메모'); if (!s) return; e.text = s.slice(0, 80); }
      data.events.push(e);
      data.events.sort((a, b) => a.t - b.t);
      lastId = e.id;
      save(); drawTagPitch(); drawLog(); drawLive();
      el.querySelector('.ma-h small').textContent = `${data.events.length}개`;
      tagged(e);
    };
  }
  function drawLog() {
    const box = panel.querySelector('[data-log]');
    if (!box) return;
    const list = [...data.events].reverse().slice(0, 300);
    box.innerHTML = list.map((e) => `<li data-ev="${e.id}" class="${e.id === lastId ? 'new' : ''}"><button class="link-btn" data-go="${e.t}">${fmtT(e.t)}</button>
      <span class="ma-tag" style="--c:${KIND[e.k].c}">${KIND[e.k].l}</span><b>${TEAM[e.team]}</b>
      <small>${third(e.x)} · ${channel(e.y)}${e.text ? ` · ${esc(e.text)}` : ''}</small>${canEdit ? '<button class="link-btn small" data-rm>✕</button>' : ''}</li>`).join('') || '<li class="muted">아직 기록이 없어요.</li>';
    // 새 기록이 보이게 — 페이지 전체가 아니라 기록 목록 안에서만 스크롤 (영상이 화면 밖으로 밀리지 않게)
    const li = box.querySelector('li.new');
    if (li && box.scrollHeight > box.clientHeight) box.scrollTop += li.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 2;
    box.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { if (video) { video.currentTime = Math.max(0, +b.dataset.go - 3); video.play(); } }));
    box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => {
      const id = b.closest('li').dataset.ev;
      data.events = data.events.filter((x) => x.id !== id);
      save(); drawTag(); drawMarks(); drawStatus();
    }));
  }

  // 단축키
  const onKey = (e) => {
    if (tab !== 'tag' || e.target.closest?.('input, textarea, select') || document.querySelector('.modal-wrap')) return;
    const k = e.key.toUpperCase();
    if (e.key === ' ' && video) { e.preventDefault(); video.paused ? video.play() : video.pause(); return; }
    if (e.key === 'ArrowRight' && video) { video.currentTime = t() + 5; return; }
    if (e.key === 'ArrowLeft' && video) { video.currentTime = Math.max(0, t() - 5); return; }
    if (k === 'Q' && teams.length > 1) { team = team === 'opp' ? 'us' : 'opp'; drawTag(); return; }
    const hit = KINDS.find(([, , key]) => key === k);
    if (hit) { kind = hit[0]; drawTag(); }
  };
  if (canEdit) { document.addEventListener('keydown', onKey); state.cleanup.push(() => document.removeEventListener('keydown', onKey)); }

  // ───────── 포메이션 ─────────
  const luPhase = { opp: 'base', us: 'base' };
  const keysView = (tm) => {
    const ks = (data.keys[tm] || []).filter((k) => k.num || k.name || k.note);
    return ks.length ? `<div class="kp-list">${ks.map((k) => `<div class="kp-card" style="--c:${tm === 'opp' ? '#e5484d' : '#4ea1ff'}">
      <b class="kp-num">${esc(k.num || '?')}</b><div><strong>${esc(k.name || `${k.num || ''}번`)}${k.pos ? ` <small>${esc(k.pos)}</small>` : ''}</strong>${k.note ? `<p>${esc(k.note)}</p>` : ''}</div></div>`).join('')}</div>` : '';
  };
  function drawFormation() {
    const old = data.formations;
    const lu = (tm, ph) => data.lineups?.[tm]?.[ph];
    panel.innerHTML = `
      ${canEdit ? `<div class="ma-row"><span class="muted small">경기 인원</span><div class="seg">${[11, 8].map((n) => `<button class="${data.size === n ? 'on' : ''}" data-size="${n}">${n} vs ${n}</button>`).join('')}</div>
        ${video ? '<button class="btn ghost sm" data-fai>AI로 잡기 (지금 화면)</button>' : ''}</div>
        <p class="muted small">포메이션을 고르고 자리마다 <b>등번호</b>만 적으면 돼요. 공격할 때 · 수비할 때 서는 모양이 다르면 <b>공격 시 · 수비 시</b>도 따로 정해요 (비워 두면 기본과 같아요). AI가 못 알아보면 직접 골라 주세요.</p>` : ''}
      <div class="lu-cards">${teams.map((tm) => {
        if (!canEdit) {
          const set = PHASES.filter(([ph]) => lu(tm, ph)?.f);
          return `<section class="card lu-card"><h3>${TEAM[tm]} 팀 포메이션 <small class="muted">${data.size} vs ${data.size}</small></h3>
            ${keysView(tm)}
            ${set.length ? `<div class="lu-views">${set.map(([ph, l]) => `<div><h4>${l} · <b>${esc(lu(tm, ph).f)}</b></h4>${lineupHtml(lu(tm, ph), { color: tm === 'opp' ? '#e5484d' : '#4ea1ff', keys: data.keys[tm] || [] })}</div>`).join('')}</div>` : '<p class="muted">아직 포메이션이 없어요.</p>'}</section>`;
        }
        const ph = luPhase[tm];
        const cur = lu(tm, ph) || {};
        const opts = FORMS[data.size];
        const custom = cur.f && !opts.includes(cur.f);
        return `<section class="card lu-card" data-lut="${tm}"><h3>${TEAM[tm]} 팀 포메이션</h3>
          <div class="seg sm lu-phase">${PHASES.map(([k, l]) => `<button class="${k === ph ? 'on' : ''}" data-luph="${k}">${l}${lu(tm, k)?.f ? ` · ${esc(lu(tm, k).f)}` : ''}</button>`).join('')}</div>
          <div class="lu-row"><select data-luf><option value="">포메이션 고르기</option>${opts.map((f) => `<option ${f === cur.f ? 'selected' : ''}>${f}</option>`).join('')}<option value="custom" ${custom ? 'selected' : ''}>직접 입력…</option></select>
            <input data-lucustom placeholder="${data.size === 8 ? '예) 2-2-2-1' : '예) 4-1-2-3'}" value="${custom ? esc(cur.f) : ''}" ${custom ? '' : 'hidden'}>
            ${cur.f ? '<button class="link-btn small" data-luclear>지우기</button>' : ''}</div>
          ${lineupHtml(cur.f ? cur : null, { edit: true, color: tm === 'opp' ? '#e5484d' : '#4ea1ff', keys: data.keys[tm] || [] })}
        </section>`;
      }).join('')}</div>
      ${old.length ? `<details class="lu-old"><summary>예전에 작전판으로 저장한 포메이션 ${old.length}개</summary><div class="ma-forms">${old.map((f) => `<section class="card ma-form" data-fid="${f.id}">
        <div class="card-head"><h3>${esc(TEAM[f.team] || '상대')} · ${esc(f.name || '')}</h3><small class="muted">${esc(f.label || '')}</small></div>
        <div data-fpad></div>${canEdit ? '<div class="row end"><button class="link-btn small" data-fdel>삭제</button></div>' : ''}</section>`).join('')}</div></details>` : ''}`;
    panel.querySelectorAll('.ma-form').forEach((c) => {
      const f = old.find((x) => x.id === c.dataset.fid);
      createPad(c.querySelector('[data-fpad]'), f.pad, { editable: false });
      c.querySelector('[data-fdel]')?.addEventListener('click', async () => {
        if (!(await confirmBox('이 포메이션을 지울까요?'))) return;
        data.formations = data.formations.filter((x) => x.id !== f.id); save(); drawFormation();
      });
    });
    panel.querySelectorAll('[data-size]').forEach((b) => (b.onclick = async () => {
      const n = +b.dataset.size;
      if (n === data.size) return;
      // 인원이 바뀌면 맞지 않는 포메이션은 지움 (확인 후)
      const bad = Object.values(data.lineups || {}).some((t) => Object.values(t).some((x) => x?.f && !validForm(x.f, n)));
      if (bad && !(await confirmBox(`${n} vs ${n}로 바꾸면 지금 정한 포메이션은 지워져요. 바꿀까요?`))) return;
      data.size = n;
      Object.values(data.lineups || {}).forEach((t) => Object.keys(t).forEach((ph) => { if (t[ph]?.f && !validForm(t[ph].f, n)) delete t[ph]; }));
      save(); drawFormation();
    }));
    panel.querySelector('[data-fai]')?.addEventListener('click', aiFormation);
    panel.querySelectorAll('[data-lut]').forEach((card) => {
      const tm = card.dataset.lut;
      const setLu = (v) => {
        data.lineups = { ...data.lineups, [tm]: { ...(data.lineups[tm] || {}) } };
        if (v) data.lineups[tm][luPhase[tm]] = v; else delete data.lineups[tm][luPhase[tm]];
        save();
      };
      const cur = () => data.lineups?.[tm]?.[luPhase[tm]] || {};
      card.addEventListener('pointerdown', () => { luPhase.lastTeam = tm; });
      card.querySelectorAll('[data-luph]').forEach((b) => (b.onclick = () => { luPhase[tm] = b.dataset.luph; drawFormation(); }));
      card.querySelector('[data-luf]').onchange = (e) => {
        const v = e.target.value;
        if (v === 'custom') { card.querySelector('[data-lucustom]').hidden = false; card.querySelector('[data-lucustom]').focus(); return; }
        if (v) setLu({ f: v, nums: cur().nums || [] }); else setLu(null);
        drawFormation();
      };
      card.querySelector('[data-lucustom]').onchange = (e) => {
        const f = e.target.value.trim().replace(/\s/g, '');
        if (!validForm(f, data.size)) { toast(`필드 선수 ${data.size - 1}명이 되게 적어 주세요 (예: ${data.size === 8 ? '2-3-2' : '4-2-3-1'})`); return; }
        setLu({ f, nums: cur().nums || [] }); drawFormation();
      };
      card.querySelector('[data-luclear]')?.addEventListener('click', () => { setLu(null); drawFormation(); });
      card.querySelectorAll('[data-lunum]').forEach((inp) => (inp.oninput = () => {
        const nums = [...(cur().nums || [])];
        nums[+inp.dataset.lunum] = inp.value.trim().slice(0, 3);
        setLu({ ...cur(), nums });
        card.querySelector('[data-luph].on').innerHTML = `${PHASES.find(([k]) => k === luPhase[tm])[1]} · ${esc(cur().f)}`;
      }));
    });
  }

  // AI: 지금 화면에서 선수를 찾고 → 유니폼 색으로 팀 나누기 → 상대 선수 한 명을 누르면 → 줄을 세어 포메이션
  async function aiFormation() {
    video.pause();
    const aiTeam = teams.length > 1 ? (luPhase.lastTeam || 'opp') : main;
    const cv = el.querySelector('.ma-ai');
    const wrap = el.querySelector('.ma-vwrap');
    const VW = video.videoWidth; const VH = video.videoHeight;
    let boxes;
    try {
      toast('AI가 화면의 선수들을 찾는 중… (처음엔 10초 정도)');
      await loadAI();
      boxes = await scanFrame(video);
    } catch (err) { fail(err); return; }
    if (boxes.length < 6) return toast(`선수를 ${boxes.length}명밖에 못 찾았어요. 선수들이 넓게 보이는 장면에서 다시 해 주세요.`);
    // 상의 색 (잔디 빼고 평균)
    const snap = document.createElement('canvas'); snap.width = VW; snap.height = VH;
    const sx = snap.getContext('2d', { willReadFrequently: true }); sx.drawImage(video, 0, 0, VW, VH);
    const colorOf = (b) => {
      const w = b.x1 - b.x0; const h = b.y1 - b.y0;
      const x0 = Math.round(b.x0 + w * 0.28); const y0 = Math.round(b.y0 + h * 0.18);
      const ww = Math.max(2, Math.round(w * 0.44)); const hh = Math.max(2, Math.round(h * 0.3));
      const d = sx.getImageData(x0, y0, ww, hh).data;
      let r = 0; let g = 0; let bl = 0; let n = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 1] > d[i] + 12 && d[i + 1] > d[i + 2] + 12) continue; r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
      return n ? [r / n, g / n, bl / n] : [d[0], d[1], d[2]];
    };
    boxes.forEach((b) => { b.col = colorOf(b); });
    // 색으로 3묶음 (두 팀 + 심판 · 골키퍼)
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    let cents = [boxes[0].col];
    while (cents.length < 3) cents.push(boxes.reduce((best, b) => (Math.min(...cents.map((c) => dist(c, b.col))) > Math.min(...cents.map((c) => dist(c, best.col))) ? b : best), boxes[0]).col);
    for (let it = 0; it < 10; it++) {
      boxes.forEach((b) => { b.g = cents.map((c) => dist(c, b.col)).indexOf(Math.min(...cents.map((c) => dist(c, b.col)))); });
      cents = cents.map((c, i) => { const m = boxes.filter((b) => b.g === i); return m.length ? [0, 1, 2].map((j) => m.reduce((a, b) => a + b.col[j], 0) / m.length) : c; });
    }
    // 화면 위에 상자 그리고 '상대 선수 한 명을 누르세요'
    cv.width = wrap.clientWidth; cv.height = video.clientHeight; cv.style.width = `${video.clientWidth}px`; cv.style.height = `${video.clientHeight}px`;
    cv.hidden = false;
    const k = cv.width / VW;
    const cx = cv.getContext('2d');
    const paint = (sel = -1) => {
      cx.clearRect(0, 0, cv.width, cv.height);
      boxes.forEach((b) => { cx.lineWidth = 2; cx.strokeStyle = sel < 0 ? `rgb(${b.col.map(Math.round).join(',')})` : b.g === sel ? '#ff3b30' : 'rgba(255,255,255,.35)'; cx.strokeRect(b.x0 * k, b.y0 * k, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k); });
      cx.fillStyle = 'rgba(0,0,0,.65)'; cx.fillRect(8, 8, 300, 26); cx.fillStyle = '#fff'; cx.font = '700 13px sans-serif';
      cx.fillText(sel < 0 ? `${TEAM[aiTeam]} 팀 선수 한 명을 누르세요` : '이 팀이 맞으면 잠시 후 포메이션이 나와요', 16, 26);
    };
    paint();
    cv.onclick = (ev) => {
      const r = cv.getBoundingClientRect();
      const px = (ev.clientX - r.left) / k; const py = (ev.clientY - r.top) / k;
      const hitB = boxes.reduce((best, b) => { const d = Math.hypot((b.x0 + b.x1) / 2 - px, (b.y0 + b.y1) / 2 - py); return !best || d < best.d ? { b, d } : best; }, null)?.b;
      if (!hitB) return;
      paint(hitB.g);
      setTimeout(() => {
        cv.hidden = true; cv.onclick = null;
        const grp = boxes.filter((b) => b.g === hitB.g);
        const res = shapeFrom(grp, VW, VH, attacksRight(aiTeam, data.oppDir));
        if (res.count < 5) return toast(`선수를 ${res.count}명만 찾았어요. 선수들이 더 많이 보이는 장면에서 해 보세요.`);
        // 인원에 맞으면 지금 고른 칸(기본 · 공격 시 · 수비 시)에 바로 넣고, 아니면 직접 고르도록
        if (validForm(res.name, data.size)) {
          data.lineups = { ...data.lineups, [aiTeam]: { ...(data.lineups[aiTeam] || {}), [luPhase[aiTeam]]: { f: res.name, nums: [], ai: true } } };
          save(); drawFormation();
          toast(`AI가 ${TEAM[aiTeam]} 팀을 ${res.name}로 봤어요. 틀리면 목록에서 직접 고쳐 주세요.`);
        } else {
          drawFormation();
          toast(`AI가 ${res.name} (${res.count}명)로 봤는데 ${data.size}명 기준과 안 맞아요. 화면에 안 보인 선수가 있을 수 있어요 — 목록에서 직접 골라 주세요.`);
        }
      }, 600);
    };
  }

  // ───────── 선수용: 체크 포인트 (이번 상대, 이것만 기억하자) ─────────
  function drawCheck() {
    const r = computeReport(data.events, main);
    const lu = data.lineups?.[main]?.base;
    const opp = !lu && data.formations.find((f) => f.team === main || (main === 'opp' && f.team !== 'us'));
    panel.innerHTML = r.summary.length || lu || keysView(main) ? `
      <section class="card ma-check big"><h3>${main === 'opp' ? '이번 상대, 이것만 기억하자' : '우리 경기, 이것만 기억하자'} ${post.opponent ? `<small>vs ${esc(post.opponent)}</small>` : ''}</h3>
        ${r.summary.length ? `<ol>${r.summary.slice(0, 3).map((x) => `<li>${x}</li>`).join('')}</ol>` : '<p class="muted">기록이 쌓이면 체크 포인트가 나와요.</p>'}</section>
      ${keysView(main) ? `<section class="card"><h3>${main === 'opp' ? '조심할 선수' : '키 플레이어'}</h3>${keysView(main)}</section>` : ''}
      <div class="ma-grid">
        ${liveHtml(data.events, main).replace('실시간 리포트', `${TEAM[main]} 공격 방향`)}
        <section class="card"><h4>${main === 'opp' ? '조심할 곳' : '우리 공격이 많았던 곳'} <small>${TEAM[main]} 공격이 많이 일어난 곳 · → 방향</small></h4>${pitchSvg(r.heatSvg)}</section>
        ${lu?.f ? `<section class="card"><h4>${TEAM[main]} 포메이션 <small>${esc(lu.f)}</small></h4>${lineupHtml(lu, { color: main === 'opp' ? '#e5484d' : '#4ea1ff', keys: data.keys[main] || [] })}</section>` : ''}
        ${opp ? `<section class="card ma-form"><h4>${TEAM[main]} 포메이션 <small>${esc(opp.name || '')}</small></h4><div data-fpad></div></section>` : ''}
      </div>
      <div class="row"><button class="btn ghost sm" data-goto="formation">포메이션 자세히 ›</button><button class="btn ghost sm" data-goto="report">전체 리포트 ›</button></div>`
      : empty('코치님이 아직 이 경기를 기록하는 중이에요. 기록이 쌓이면 체크 포인트가 나와요.');
    if (opp) createPad(panel.querySelector('[data-fpad]'), opp.pad, { editable: false });
    panel.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => setTab(b.dataset.goto)));
  }

  // ───────── 리포트 ─────────
  let rteam = main;
  function drawReport() {
    const { ev, other, atk, ch, pct, shots, goals, crosses, losses, set, wins, flow, heatSvg, oursSide, summary } = computeReport(data.events, rteam);
    const bar = (l, n) => `<div class="ma-bar"><span>${l}${rteam === 'opp' && l !== '가운데' ? `<small>${oursSide(l)}</small>` : ''}</span><div><i style="width:${pct(n)}%"></i></div><b>${pct(n)}%</b><small>${n}</small></div>`;

    panel.innerHTML = `
      <div class="ma-row">${teams.length > 1 ? `<div class="seg">${teams.map((k) => `<button class="${k === rteam ? 'on' : ''}" data-rt="${k}">${TEAM[k]} 팀</button>`).join('')}</div>` : ''}
        <span class="muted small">모든 그림은 <b>${TEAM[rteam]} 팀이 오른쪽(→)으로 공격</b>하는 방향으로 맞춰서 보여줘요</span></div>
      ${data.lineups?.[rteam] && Object.keys(data.lineups[rteam]).length ? `<p class="ma-luline">${TEAM[rteam]} 포메이션 · ${PHASES.filter(([ph]) => data.lineups[rteam][ph]?.f).map(([ph, l]) => `${l} <b>${esc(data.lineups[rteam][ph].f)}</b>`).join(' · ')} <button class="link-btn small" data-goto-f>자세히</button></p>` : ''}
      ${keysView(rteam) ? `<section class="card"><h3>${TEAM[rteam]} 키 플레이어</h3>${keysView(rteam)}</section>` : ''}
      ${data.events.length ? '' : empty('아직 기록이 없어요. 기록하기에서 장면을 기록하면 리포트가 자동으로 만들어져요.')}
      <section class="card ma-sum"><h3>요약</h3>${summary.length ? `<ul>${summary.map((s) => `<li>${s}</li>`).join('')}</ul>` : '<p class="muted">기록이 더 쌓이면 요약이 나와요.</p>'}
        <div class="ma-counts">${[['공격 전개', ev.filter((e) => e.k === 'attack').length], ['슈팅', shots.length], ['득점', goals.length], ['크로스', crosses.length], ['볼 뺏김', losses.length], ['볼 탈취', wins.length], ['세트피스', set.length]].map(([l, n]) => `<div><span>${l}</span><b>${n}</b></div>`).join('')}</div></section>
      <div class="ma-grid">
        <section class="card"><h3>공격 방향 <small>공격 전개 · 크로스 · 슈팅 ${atk.length}개</small></h3>${bar('왼쪽', ch['왼쪽'])}${bar('가운데', ch['가운데'])}${bar('오른쪽', ch['오른쪽'])}</section>
        <section class="card"><h3>위험 지역 <small>공격이 많이 일어난 곳</small></h3>${pitchSvg(heatSvg)}</section>
        <section class="card"><h3>슈팅 · 득점 지도 <small>● 슈팅 ★ 득점</small></h3>${pitchSvg(shots.map((e) => (e.k === 'goal' ? `<text x="${(e.x * 105).toFixed(1)}" y="${(e.y * 68 + 1.6).toFixed(1)}" class="star">★</text>` : dot(e.x, e.y, '#ffd400', 1.2))).join(''), { half: true })}</section>
        <section class="card"><h3>크로스 위치</h3>${pitchSvg(crosses.map((e) => dot(e.x, e.y, '#ff9f0a', 1.2)).join(''), { half: true })}</section>
        <section class="card"><h3>공을 잃은 곳 <small>${rteam === 'opp' ? '압박 포인트' : '보완할 곳'}</small></h3>${pitchSvg(losses.map((e) => dot(e.x, e.y, '#ff3b30', 1.2)).join(''))}</section>
        <section class="card"><h3>시간대별 공격 <small>15분 단위 · ${TEAM[rteam]} / ${TEAM[other]}</small></h3>
          <div class="ma-flow">${flow.map(([i, es]) => { const a = es.filter((e) => e.team === rteam).length; const b = es.filter((e) => e.team === other).length; const mx = Math.max(1, ...flow.map(([, x]) => x.length)); return `<div><div class="cols"><i class="a" style="height:${(a / mx) * 100}%"></i><i class="b" style="height:${(b / mx) * 100}%"></i></div><small>${i * 15}′</small></div>`; }).join('')}</div></section>
      </div>
      ${data.formations.length ? `<p class="muted small">포메이션은 <b>포메이션</b> 탭에서 볼 수 있어요 (${data.formations.length}개).</p>` : ''}`;
    panel.querySelectorAll('[data-rt]').forEach((b) => (b.onclick = () => { rteam = b.dataset.rt; drawReport(); }));
    panel.querySelector('[data-goto-f]')?.addEventListener('click', () => setTab('formation'));
  }

  setTab(tab);
  if (canEdit && !sample) {
    try {
      if (!localStorage.getItem('ssaka.ma.tour')) {
        localStorage.setItem('ssaka.ma.tour', '1');
        setTimeout(() => tour([
          ['.ma-kinds', '① 먼저 <b>어떤 장면</b>인지 고르세요 (공격 전개 · 슈팅 · 크로스 …)'],
          ['.ma-tagpitch', '② 영상을 보다가 그 장면이 <b>일어난 곳</b>을 경기장에서 누르세요. 화면에 보이는 그대로요!'],
          ['[data-live]', '③ 누를 때마다 <b>리포트가 바로</b> 쌓여요. 다 하면 위 <b>리포트</b> 탭에서 전체를 봐요'],
        ]), 500);
      }
    } catch { /* */ }
  }
}

// 손가락 안내: 차례로 한 곳씩 밝히고 말풍선
export function tour(steps) {
  let i = 0;
  const bub = document.createElement('div');
  bub.className = 'tour-bubble';
  document.body.appendChild(bub);
  const end = () => { document.querySelectorAll('.tour-on').forEach((x) => x.classList.remove('tour-on')); bub.remove(); };
  const show = () => {
    document.querySelectorAll('.tour-on').forEach((x) => x.classList.remove('tour-on'));
    const [sel, text] = steps[i];
    const target = document.querySelector(sel);
    if (!target) { end(); return; }
    target.classList.add('tour-on');
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    bub.innerHTML = `<p>${text}</p><div class="row between"><small>${i + 1} / ${steps.length}</small><span><button class="link-btn small" data-skip>건너뛰기</button> <button class="btn sm" data-next>${i === steps.length - 1 ? '시작하기' : '다음'}</button></span></div>`;
    setTimeout(() => {
      const r = target.getBoundingClientRect();
      const top = r.bottom + 12 + 160 < innerHeight ? r.bottom + 12 : Math.max(12, r.top - 150);
      bub.style.top = `${top}px`;
      bub.style.left = `${Math.min(innerWidth - 340, Math.max(12, r.left))}px`;
    }, 350);
    bub.querySelector('[data-next]').onclick = () => { i++; if (i >= steps.length) end(); else show(); };
    bub.querySelector('[data-skip]').onclick = end;
  };
  show();
}

// 미니 리포트 HTML (상대 팀) — 기록하기 · 체험하기에서 실시간으로
export function liveHtml(events, tm = 'opp') {
  const r = computeReport(events, tm);
  const n = r.atk.length;
  const bar = (l) => `<div class="ma-bar"><span>${l}${l !== '가운데' ? `<small>${r.oursSide(l)}</small>` : ''}</span><div><i style="width:${r.pct(r.ch[l])}%"></i></div><b>${r.pct(r.ch[l])}%</b><small>${r.ch[l]}</small></div>`;
  return `<div class="card ma-livecard"><h4>실시간 리포트 <small>${TEAM[tm]} 팀 · 기록 ${events.filter((e) => e.team === tm).length}개</small></h4>
    ${n ? `${bar('왼쪽')}${bar('가운데')}${bar('오른쪽')}${r.summary[0] ? `<p class="ma-livesum">${r.summary[0]}</p>` : ''}` : '<p class="muted small">상대 공격 · 크로스 · 슈팅을 기록하면 여기서 바로 공격 방향이 계산돼요.</p>'}</div>`;
}

export function computeReport(events, rteam) {
    const ev = events.filter((e) => e.team === rteam);
  const other = rteam === 'opp' ? 'us' : 'opp';
  const atk = ev.filter((e) => ['attack', 'cross', 'shot', 'goal'].includes(e.k));
  const ch = { 왼쪽: 0, 가운데: 0, 오른쪽: 0 };
  atk.forEach((e) => { ch[channel(e.y)]++; });
  const pct = (n) => (atk.length ? Math.round((n / atk.length) * 100) : 0);
  const shots = ev.filter((e) => e.k === 'shot' || e.k === 'goal');
  const goals = ev.filter((e) => e.k === 'goal');
  const crosses = ev.filter((e) => e.k === 'cross');
  const losses = ev.filter((e) => e.k === 'loss');
  const set = ev.filter((e) => e.k === 'setpiece');
  const wins = ev.filter((e) => e.k === 'win');
  const inBox = shots.filter((e) => e.x > 0.843 && e.y > 0.204 && e.y < 0.796).length;
  // 시간대 (15분)
  const maxT = Math.max(5400, ...events.map((e) => e.t));
  const bins = Math.ceil(maxT / 900);
  const flow = Array.from({ length: bins }, (_, i) => [i, events.filter((e) => e.t >= i * 900 && e.t < (i + 1) * 900 && ['attack', 'shot', 'goal', 'cross'].includes(e.k))]);
  const peak = flow.reduce((b, [i, es]) => { const n = es.filter((e) => e.team === rteam).length; return n > b.n ? { i, n } : b; }, { i: -1, n: 0 });
  // 위험 지역: 공격 1/3에서의 공격 · 크로스 · 슈팅 (6 × 4 칸)
  const heat = Array.from({ length: 4 }, () => Array(6).fill(0));
  atk.forEach((e) => { heat[Math.min(3, Math.floor(e.y * 4))][Math.min(5, Math.floor(e.x * 6))]++; });
  const hmax = Math.max(1, ...heat.flat());
  const heatSvg = heat.map((row, yi) => row.map((v, xi) => `<rect x="${xi * 17.5}" y="${yi * 17}" width="17.5" height="17" fill="rgba(255,59,48,${(v / hmax) * 0.75})"/>${v ? `<text x="${xi * 17.5 + 8.75}" y="${yi * 17 + 10}" class="hv">${v}</text>` : ''}`).join('')).join('');
  // 상대 기준 왼쪽/오른쪽 → 우리 수비 기준 (반대)
  const oursSide = (c) => (c === '왼쪽' ? '우리 오른쪽' : c === '오른쪽' ? '우리 왼쪽' : '가운데');
  const main = Object.entries(ch).sort((a, b) => b[1] - a[1])[0];
  const crossSide = crosses.length ? Object.entries(crosses.reduce((a, e) => ({ ...a, [channel(e.y)]: (a[channel(e.y)] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0] : null;
  const lossZone = losses.length ? Object.entries(losses.reduce((a, e) => { const z = `${third(e.x)} ${channel(e.y)}`; return { ...a, [z]: (a[z] || 0) + 1 }; }, {})).sort((a, b) => b[1] - a[1])[0] : null;
  const summary = [];
  if (atk.length) summary.push(`${TEAM[rteam]} 공격은 <b>${main[0]}</b>이 ${pct(main[1])}%로 가장 많아요${rteam === 'opp' && main[0] !== '가운데' ? ` → <b>${oursSide(main[0])} 측면 수비</b>를 대비해야 해요` : ''}.`);
  if (crossSide) summary.push(`크로스 ${crosses.length}개 중 ${crossSide[1]}개가 <b>${crossSide[0]}</b>에서 올라왔어요${rteam === 'opp' ? ` (${oursSide(crossSide[0])})` : ''}.`);
  if (shots.length) summary.push(`슈팅 ${shots.length}개 중 박스 안 ${inBox}개 (${Math.round((inBox / shots.length) * 100)}%)${inBox / shots.length < 0.4 ? ' — 중거리 슈팅이 많아요' : ' — 박스 안까지 들어와서 때려요'}.`);
  if (peak.n >= 3) summary.push(`<b>${peak.i * 15}~${peak.i * 15 + 15}분</b>에 공격이 가장 많았어요 (${peak.n}번).`);
  if (lossZone) summary.push(`${TEAM[rteam]}가 공을 가장 많이 잃은 곳: <b>${lossZone[0]}</b> (${lossZone[1]}번)${rteam === 'opp' ? ' → 이곳에서 압박하면 효과적이에요' : ' → 이곳 빌드업을 보완해요'}.`);
  if (set.length) summary.push(`세트피스 ${set.length}번${goals.length ? ` · 득점 ${goals.length}골` : ''}.`);
  return { ev, other, atk, ch, pct, shots, goals, crosses, losses, set, wins, inBox, flow, heatSvg, oursSide, summary };
}

// 상대 선수 위치(화면) → 줄 나누기 → 포메이션 이름 + 작전판 배치
export function shapeFrom(boxes, VW, VH, oppRight) {
  // 깊이(자기 골문에서 얼마나 앞에 있나) = 화면 가로, 폭 = 화면 세로(발 위치). 상대가 ←로 공격하면 뒤집음
  let pts = boxes.map((b) => {
    const fx = ((b.x0 + b.x1) / 2) / VW; const fy = b.y1 / VH;
    return oppRight ? { d: fx, w: fy } : { d: 1 - fx, w: 1 - fy };
  }).sort((a, b) => a.d - b.d);
  // 골키퍼: 가장 깊은 선수가 다른 선수들과 많이 떨어져 있으면 따로
  let gk = null;
  if (pts.length >= 7 && pts[1].d - pts[0].d > 0.08) gk = pts.shift();
  pts = pts.slice(0, 10);
  const n = pts.length;
  // 1차원으로 줄 나누기: 3줄 · 4줄 중 줄 안 흩어짐이 작은 쪽 (4줄은 조금 더 엄격)
  const splitInto = (k) => {
    const gaps = pts.slice(1).map((p, i) => [p.d - pts[i].d, i + 1]).sort((a, b) => b[0] - a[0]).slice(0, k - 1).map(([, i]) => i).sort((a, b) => a - b);
    const lines = []; let s = 0;
    [...gaps, n].forEach((e) => { lines.push(pts.slice(s, e)); s = e; });
    const sse = lines.reduce((a, l) => { const m = l.reduce((x, p) => x + p.d, 0) / l.length; return a + l.reduce((x, p) => x + (p.d - m) ** 2, 0); }, 0);
    return { lines, sse };
  };
  const three = splitInto(Math.min(3, n));
  const four = n >= 6 ? splitInto(4) : null;
  const best = four && four.sse < three.sse * 0.45 && four.lines.every((l) => l.length >= 1) ? four : three;
  const name = best.lines.map((l) => l.length).join('-');
  // 작전판 (105 × 68, 상대 팀이 오른쪽으로 공격): 깊이 · 폭을 펼쳐서
  const dmin = Math.min(...pts.map((p) => p.d)); const dmax = Math.max(...pts.map((p) => p.d));
  const wmin = Math.min(...pts.map((p) => p.w)); const wmax = Math.max(...pts.map((p) => p.w));
  const pad = blank('full');
  pad.formation = name;
  pad.items = [{ k: 'player', team: 'c', n: '1', x: 5, y: 34 }];
  let num = 2;
  void dmin; void dmax; void wmin; void wmax;
  best.lines.forEach((l, li) => {
    const lx = 18 + (li / Math.max(1, best.lines.length - 1)) * 32; // 줄마다 18m ~ 50m
    // 같은 줄은 폭 순서대로 고르게 (화면에 일부만 보여도 모양이 또렷하게)
    l.sort((a, b) => a.w - b.w).forEach((p, i) => {
      const y = 6 + ((i + 0.5) / l.length) * 56;
      pad.items.push({ k: 'player', team: 'c', n: String(num++), x: Math.round(lx * 10) / 10, y: Math.round(y * 10) / 10 });
    });
  });
  void gk;
  return { name, count: n + (gk ? 1 : 0), pad };
}

// 분석실 소개용 예시 경기 (저장하지 않음) — 상대가 오른쪽(우리 왼쪽) 측면 · 크로스가 많고 후반에 몰아침
export function sampleMatch() {
  let sd = 11; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const ev = []; const add = (t, team, k, x, y) => ev.push({ id: `s${ev.length}`, t: Math.round(t), team, k, x: +x.toFixed(3), y: +y.toFixed(3) });
  for (let i = 0; i < 64; i++) add(rnd() < 0.6 ? 2700 + rnd() * 2700 : rnd() * 2700, 'opp', 'attack', 0.45 + rnd() * 0.45, rnd() < 0.5 ? 0.8 + rnd() * 0.18 : rnd() < 0.5 ? 0.4 + rnd() * 0.2 : rnd() * 0.3);
  for (let i = 0; i < 13; i++) add(rnd() * 5400, 'opp', 'cross', 0.78 + rnd() * 0.18, rnd() < 0.75 ? 0.86 + rnd() * 0.12 : 0.04 + rnd() * 0.1);
  for (let i = 0; i < 11; i++) add(rnd() * 5400, 'opp', 'shot', rnd() < 0.55 ? 0.86 + rnd() * 0.1 : 0.7 + rnd() * 0.12, 0.25 + rnd() * 0.5);
  add(3100, 'opp', 'goal', 0.93, 0.56); add(4380, 'opp', 'goal', 0.9, 0.43);
  for (let i = 0; i < 15; i++) add(rnd() * 5400, 'opp', 'loss', 0.15 + rnd() * 0.3, rnd() < 0.6 ? rnd() * 0.33 : 0.33 + rnd() * 0.6);
  for (let i = 0; i < 5; i++) add(rnd() * 5400, 'opp', 'setpiece', rnd() < 0.5 ? 0.99 : 0.75, rnd() < 0.5 ? 0.02 : 0.95);
  for (let i = 0; i < 38; i++) add(rnd() * 5400, 'us', 'attack', 0.45 + rnd() * 0.45, rnd());
  for (let i = 0; i < 8; i++) add(rnd() * 5400, 'us', 'shot', 0.75 + rnd() * 0.2, 0.3 + rnd() * 0.4);
  add(1500, 'us', 'goal', 0.92, 0.5);
  for (let i = 0; i < 12; i++) add(rnd() * 5400, 'us', 'loss', 0.2 + rnd() * 0.5, rnd());
  ev.sort((a, b) => a.t - b.t);
  return { id: 'sample', mode: 'match', title: '예시) vs 상대 FC 경기분석', opponent: '상대 FC', date: '', oppDir: 'right', events: ev, target: 'both', size: 11,
    lineups: { opp: { base: { f: '4-4-2', nums: ['1', '2', '4', '5', '3', '7', '8', '6', '11', '9', '10'] }, att: { f: '2-3-5', nums: [] }, def: { f: '4-5-1', nums: [] } } },
    keys: { opp: [{ id: 'k1', num: '10', pos: 'ST', name: '', note: '왼발 · 박스 앞 중거리 슈팅' }, { id: 'k2', num: '7', pos: 'LM', name: '', note: '스피드 · 오른쪽으로 꺾어 크로스' }] }, formations: [] };
}
