// 분석실 > 경기분석 — 영상을 보며 경기장을 탭해 장면 기록 → 상대(또는 우리) 공격 방향 · 슈팅 · 크로스 · 위험 지역 · 시간대 흐름 리포트
// + 코치가 직접 정하는 포메이션(등번호) · 키 플레이어 → 저장하면 기록 · 자동 분석 · 포메이션 · 키 플레이어가 한 리포트로
import { db, doc, updateDoc, deleteDoc, collection, getDocs } from '../fb.js';
import { esc, toast, fail, modal, confirmBox, empty } from '../ui.js';
import { state, go, numberAt } from '../store.js';
import { createPad, blank } from '../tactic.js';
import { protoOn, loadWork, saveWork, workTimer, fmtDur } from '../proto/work.js';
import { probe as probeVideo, DETECTORS, buildCands, CAND_TYPE } from '../proto/scenes.js';

// 시제품(3.0): 분석 목적별 템플릿 — 그 목적에 쓰는 장면만 진하게 (다른 키도 그대로 눌러져요)
export const TEMPLATES = [
  ['all', '전체', null],
  ['att', '공격', ['attack', 'through', 'long', 'dribble', 'cross', 'shot', 'goal', 'loss', 'counter', 'corner', 'freekick', 'note']],
  ['def', '수비', ['press', 'win', 'clear', 'save', 'duel', 'loss', 'gegen', 'foul', 'shot', 'goal', 'note']],
  ['tr', '전환', ['win', 'loss', 'counter', 'gegen', 'press', 'shot', 'note']],
  ['set', '세트피스', ['corner', 'freekick', 'penalty', 'shot', 'goal', 'clear', 'save', 'foul', 'note']],
  ['player', '선수 한 명', null],
  ['gk', '골키퍼', ['save', 'clear', 'long', 'attack', 'corner', 'freekick', 'penalty', 'goal', 'note']],
];
const hasXY = (e) => e.x != null && e.y != null; // 위치 없이 빠르게 기록한 장면은 지도 · 위치 통계에서 빠져요

// 손가락으로 쓰는 화면(휴대폰 · 태블릿)
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const col = () => ['teams', state.team.id, 'posts'];
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const uid = () => Math.random().toString(36).slice(2, 9);

// 기록하는 장면: [키, 이름, 단축키, 색, 묶음] — 코치가 영상을 보며 직접 세분화해서 기록
export const KINDS = [
  ['attack', '공격 전개', '1', '#4ea1ff', 'att'],
  ['through', '스루패스', '2', '#4ea1ff', 'att'],
  ['long', '롱볼', '3', '#4ea1ff', 'att'],
  ['dribble', '돌파', '4', '#4ea1ff', 'att'],
  ['cross', '크로스 · 컷백', '5', '#4ea1ff', 'att'],
  ['shot', '슈팅', 'Q', '#4ea1ff', 'att'],
  ['goal', '득점', 'W', '#4ea1ff', 'att'],
  ['press', '압박', 'E', '#ff453a', 'def'],
  ['win', '볼 탈취', 'R', '#ff453a', 'def'],
  ['clear', '클리어링', 'T', '#ff453a', 'def'],
  ['save', '선방', 'A', '#ff453a', 'def'],
  ['duel', '경합 · 태클', 'S', '#ff453a', 'def'],
  ['loss', '볼 뺏김', 'D', '#30d158', 'tr'],
  ['counter', '역습', 'F', '#30d158', 'tr'],
  ['gegen', '역압박', 'G', '#30d158', 'tr'],
  ['corner', '코너킥', 'Z', '#ffd60a', 'set'],
  ['freekick', '프리킥', 'X', '#ffd60a', 'set'],
  ['penalty', '페널티킥', 'C', '#ffd60a', 'set'],
  ['foul', '파울', 'V', '#ff9f0a', 'etc'],
  ['note', '메모', '6', '#ff9f0a', 'etc'],
  ['offside', '오프사이드', 'B', '#ff9f0a', 'etc'],
];
// 예전에 기록한 장면 종류 (버튼엔 없지만 리포트에는 그대로 나옴)
const OLD_KINDS = [
  ['buildup', '빌드업', '', '#4ea1ff', 'att'], ['prog', '전진 패스', '', '#4ea1ff', 'att'], ['cutback', '컷백', '', '#4ea1ff', 'att'], ['chance', '결정적 찬스', '', '#4ea1ff', 'att'],
  ['intercept', '인터셉트', '', '#ff453a', 'def'], ['throw', '스로인', '', '#ffd60a', 'set'], ['setpiece', '세트피스', '', '#ffd60a', 'set'], ['card', '경고 · 퇴장', '', '#ff9f0a', 'etc'],
];
export const KGROUPS = [['att', '공격'], ['def', '수비'], ['tr', '전환'], ['set', '세트피스'], ['etc', '기타']];
// 묶음 색: 공격 파랑 · 수비 빨강 · 전환 초록 · 세트피스 노랑 · 기타 주황 — 같은 묶음 안은 단축키 글자로 구분
export const GCOLOR = { att: '#4ea1ff', def: '#ff453a', tr: '#30d158', set: '#ffd60a', etc: '#ff9f0a' };
const KIND0 = Object.fromEntries([...KINDS, ...OLD_KINDS].map(([k, l, key, c, g]) => [k, { l, key, c, g }]));
const KIND = new Proxy(KIND0, { get: (o, k) => o[k] || o.note }); // 모르는 종류는 메모처럼
// 기록한 뒤 바로 아래에서 고르는 자세한 내용
const DETAIL = {
  res: ['결과', [['ok', '성공'], ['fail', '실패']]],
  shotRes: ['결과', [['goal', '골'], ['on', '유효 슈팅'], ['off', '빗나감'], ['block', '막힘'], ['post', '골대']]],
  foot: ['발', [['L', '왼발'], ['R', '오른발'], ['H', '헤더']]],
  height: ['높이', [['high', '높게'], ['low', '낮게'], ['ground', '땅볼']]],
  setRes: ['결과', [['shot', '슈팅까지'], ['danger', '위험했음'], ['none', '무산']]],
  card: ['카드', [['Y', '경고'], ['R', '퇴장']]],
  how: ['어떻게', [['press', '압박당해'], ['mistake', '패스 실수'], ['duel', '경합 패배'], ['dribble', '드리블 실패']]],
};
const DETAILS_OF = {
  buildup: ['res'], attack: ['res'], prog: ['res'], through: ['res'], long: ['res'], dribble: ['res'], counter: ['res'],
  cross: ['res', 'foot', 'height'], cutback: ['res', 'foot'], chance: ['foot'], shot: ['shotRes', 'foot'], goal: ['foot'],
  press: ['res'], duel: ['res'], loss: ['how'],
  corner: ['setRes', 'foot'], freekick: ['setRes', 'foot'], throw: ['setRes'], penalty: ['shotRes', 'foot'], setpiece: ['setRes'],
  card: ['card'], foul: ['card'], gegen: ['res'],
};
const DLABEL = Object.fromEntries(Object.values(DETAIL).flatMap(([, o]) => o));
// 끝 지점(공이 간 곳)도 찍을 수 있는 장면
const LINE_KINDS = ['buildup', 'attack', 'prog', 'through', 'long', 'dribble', 'cross', 'cutback', 'counter'];
// 단축키: 키보드 자리(Q W E …)로 — 한글 입력 상태여도 같은 자리면 됨
const KEY_OF = Object.fromEntries(KINDS.map(([k, , key]) => [/\d/.test(key) ? `Digit${key}` : `Key${key}`, k]));
const fieldOf = (d) => (d === 'shotRes' || d === 'setRes' ? 'res' : d);
const detailText = (e) => [...(DETAILS_OF[e.k] || []).map((d) => DLABEL[e[fieldOf(d)]]).filter(Boolean), e.num && `${e.num}번`].filter(Boolean).join(' · ');
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
  // 줄마다 옆으로 벌리는 폭: 투톱 · 두 명 수미는 가운데에 붙이고, 4 · 5명 줄만 넓게
  const SPREAD = { B: { 2: 0.4, 3: 0.5, 4: 0.74, 5: 0.82 }, M: { 2: 0.3, 3: 0.44, 4: 0.74, 5: 0.84 }, AM: { 2: 0.34, 3: 0.62 }, F: { 2: 0.28, 3: 0.62, 4: 0.7 } };
  lines.forEach((c, li) => {
    const x = L === 1 ? 0.5 : 0.25 + (li * (0.84 - 0.25)) / (L - 1);
    let type = li === 0 ? 'B' : li === L - 1 ? 'F' : 'M';
    // 4줄 이상: 수비 바로 앞 1~2명 = 수비형 미드, 공격수 바로 뒤 1~3명 = 공격형 (4-2-3-1 · 4-1-4-1 · 4-3-1-2)
    if (type === 'M' && L >= 4) type = li === 1 && c <= 2 ? 'DM' : li === L - 2 && c <= 3 ? 'AM' : 'M';
    const sp = (SPREAD[type === 'DM' ? 'M' : type][c]) ?? Math.min(0.84, 0.2 * (c - 1));
    for (let i = 0; i < c; i++) {
      const y = c === 1 ? 0.5 : 0.5 - sp / 2 + (i * sp) / (c - 1);
      const side = (i === 0 ? 'L' : i === c - 1 ? 'R' : '');
      let role;
      if (type === 'B') role = side && c >= 5 ? `${side}WB` : side && c === 4 ? `${side}B` : 'CB';
      else if (type === 'F') role = c >= 3 && side ? `${side}W` : c === 1 || c === 2 ? 'ST' : 'CF';
      else if (type === 'DM') role = 'DM';
      else if (type === 'AM') role = c >= 3 && side ? `${side}W` : 'AM';
      else role = side && c >= 5 ? `${side}WB` : side && c === 4 ? `${side}M` : 'CM';
      out.push({ x, y, role });
    }
  });
  return out;
}
// 포메이션 그림 (번호 보기 · 고치기)
export function lineupHtml(lu, { edit = false, color = '#e5484d', keys = [] } = {}) {
  if (!lu?.f) return edit ? '<p class="muted small lu-empty">위에서 <b>포메이션을 고르면</b> 경기장에 자리마다 번호 칸이 생겨요.</p>' : '<p class="muted small">아직 정하지 않았어요.</p>';
  const star = new Set(keys.map((k) => String(k.num || '').trim()).filter(Boolean));
  return `<div class="lu-pitch" style="--c:${color}">${positionsOf(lu.f).map((p, i) => `<div class="lu-pos ${star.has(String(lu.nums?.[i] || '').trim()) ? 'key' : ''}" style="left:${4 + p.x * 90}%;top:${5 + p.y * 84}%">
    ${edit ? `<input data-lunum="${i}" value="${esc(lu.nums?.[i] || '')}" maxlength="3" inputmode="numeric" placeholder="번호" aria-label="${p.role} 번호">` : `<b>${esc(lu.nums?.[i] || '')}</b>`}<small>${p.role}</small></div>`).join('')}</div>`;
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

// ───────── 유튜브 영상 (IFrame API) — <video> 처럼 쓰게 감쌈: currentTime · paused · play() · 이벤트 ─────────
export function ytIdOf(url) {
  const u = String(url || '').trim();
  const m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : /^[A-Za-z0-9_-]{11}$/.test(u) ? u : '';
}
// 영상 링크: 유튜브 · Veo(공개 경기) · 영상 파일 주소(mp4 등) — 비메오도 몰래 지원
export const LINK_NAME = { youtube: '유튜브', vimeo: '비메오', veo: 'Veo', file: '링크' };
export function linkOf(raw) {
  const u = String(raw || '').trim();
  if (!u) return null;
  const y = ytIdOf(u);
  if (y) return { kind: 'youtube', id: y };
  const v = u.match(/vimeo\.com\/(?:video\/|channels\/[^/]+\/)?(\d+)/i);
  if (v) return { kind: 'vimeo', id: v[1], url: u };
  const vo = u.match(/veo\.co\/matches\/([A-Za-z0-9_-]{6,200})/i);
  if (vo) return { kind: 'veo', slug: vo[1], url: u.split('?')[0] };
  if (/veo\.co|veo\.com/i.test(u)) return { kind: 'veo-bad' };
  if (/^https?:\/\/\S+\.(mp4|webm|mov|m4v)(\?\S*)?$/i.test(u)) return { kind: 'file', url: u };
  return null;
}
export const LINK_HELP = '유튜브 · Veo 경기 링크, 또는 mp4 같은 영상 파일 주소를 붙여 주세요.';
export const VEO_HELP = 'Veo는 경기 페이지 주소(app.veo.co/matches/…)를 붙여 주세요. 경기가 공개(링크 공유)로 되어 있어야 열려요.';
// 장면 시각으로 바로 가는 주소 (리포트에서 누르면 새 창)
const timeUrl = (lk, sec) => (lk?.kind === 'youtube' ? `https://youtu.be/${lk.id}?t=${sec}` : lk?.kind === 'vimeo' ? `${(lk.url || `https://vimeo.com/${lk.id}`).split('#')[0]}#t=${sec}s` : '');
let vmApi = null;
const loadVimeo = () => (vmApi ||= new Promise((res, rej) => {
  if (window.Vimeo?.Player) { res(window.Vimeo); return; }
  const sc = document.createElement('script'); sc.src = 'https://player.vimeo.com/api/player.js';
  sc.onload = () => res(window.Vimeo); sc.onerror = rej; document.head.appendChild(sc);
}));
function vimeoPlayer(box, lk) {
  const ls = {}; let p = null; let cur = 0; let dur = 0; let paused = true; let rate = 1;
  const emit = (type) => (ls[type] || []).forEach((f) => f());
  const api = {
    yt: true,
    get currentTime() { return cur; },
    set currentTime(v) { cur = Math.max(0, v); p?.setCurrentTime(cur).catch(() => {}); emit('timeupdate'); },
    get paused() { return paused; },
    get duration() { return dur; },
    get playbackRate() { return rate; },
    set playbackRate(v) { rate = v; p?.setPlaybackRate(v).catch(() => toast('이 비메오 영상은 재생 속도를 바꿀 수 없어요.')); },
    play() { p?.play().catch(() => {}); return Promise.resolve(); },
    pause() { p?.pause().catch(() => {}); },
    addEventListener(type, f) { (ls[type] ||= []).push(f); },
    destroy() { try { p?.destroy(); } catch { /* */ } },
  };
  loadVimeo().then((V) => {
    if (!box.isConnected) return;
    p = new V.Player(box, { url: lk.url || `https://vimeo.com/${lk.id}`, responsive: true });
    p.on('timeupdate', (d) => { cur = d.seconds; dur = d.duration || dur; emit('timeupdate'); });
    p.on('seeked', (d) => { cur = d.seconds; emit('timeupdate'); });
    p.on('play', () => { paused = false; emit('play'); });
    p.on('pause', () => { paused = true; emit('pause'); });
    p.on('ended', () => { paused = true; emit('pause'); });
    p.ready().then(() => p.getDuration()).then((d) => { dur = d; emit('loadedmetadata'); emit('timeupdate'); })
      .catch(() => { box.innerHTML = '<p class="ma-yterr">이 비메오 영상을 열 수 없어요. 비공개이거나 다른 사이트에서 재생을 막아 둔 영상이에요.</p>'; });
  }).catch(() => toast('비메오 플레이어를 불러오지 못했어요.'));
  return api;
}
let ytApi = null;
const loadYT = () => (ytApi ||= new Promise((res) => {
  if (window.YT?.Player) { res(window.YT); return; }
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => { prev?.(); res(window.YT); };
  const sc = document.createElement('script'); sc.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(sc);
}));
function ytPlayer(box, id) {
  const ls = {}; let p = null; let paused = true; let dur = 0; let rate = 1; let tick = 0; let want = null;
  const emit = (type) => (ls[type] || []).forEach((f) => f());
  const api = {
    yt: true,
    get currentTime() { return p?.getCurrentTime?.() || 0; },
    set currentTime(v) { if (p?.seekTo) { p.seekTo(Math.max(0, v), true); setTimeout(() => emit('timeupdate'), 120); } else want = v; },
    get paused() { return paused; },
    get duration() { return dur || p?.getDuration?.() || 0; },
    get playbackRate() { return rate; },
    set playbackRate(v) { rate = v; p?.setPlaybackRate?.(v); },
    play() { p?.playVideo?.(); return Promise.resolve(); },
    pause() { p?.pauseVideo?.(); },
    addEventListener(type, f) { (ls[type] ||= []).push(f); },
    destroy() { clearInterval(tick); try { p?.destroy?.(); } catch { /* */ } },
  };
  loadYT().then((YT) => {
    if (!box.isConnected) return;
    p = new YT.Player(box, {
      videoId: id, width: '100%', height: '100%',
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onReady: () => { dur = p.getDuration() || 0; if (want != null) p.seekTo(want, true); emit('loadedmetadata'); emit('timeupdate'); },
        onStateChange: (e) => {
          const was = paused;
          paused = e.data !== YT.PlayerState.PLAYING;
          if (!dur) dur = p.getDuration() || 0;
          if (was !== paused) emit(paused ? 'pause' : 'play');
          emit('timeupdate');
        },
      },
    });
    tick = setInterval(() => { if (!box.isConnected && !document.contains(p?.getIframe?.())) { clearInterval(tick); return; } if (!paused) emit('timeupdate'); }, 250);
  });
  return api;
}

export async function matchStudio(el, post, { canEdit, files, sample = false }) {
  const data = {
    events: post.events || [],
    formations: post.formations || [], // 예전 작전판 포메이션 (보기만)
    oppDir: post.oppDir || 'right',
    target: post.target || 'both', // 예전 분석은 두 팀 다
    size: post.size || 11,
    lineups: post.lineups || {},
    keys: post.keys || {}, // 키 플레이어 { opp: [{ id, num, pos, name, note }], us: [...] }
    halfStart: post.halfStart || {}, // 영상에서 하프가 시작하는 시각(초) { 1: 0, 2: 3120 }
  };
  let half = data.events.length && halfOf(data.events[data.events.length - 1]) === 2 ? 2 : 1; // 지금 기록하는 하프
  const flipDir = (d) => (d === 'right' ? 'left' : 'right');
  // 경기 시간: 하프 킥오프 시각 기준 — 영상의 실제 재생 위치로 계산해서 1.5x · 2x로 봐도 정확해요
  const matchMin = (e, mf = minuteFn(data.events, data.halfStart)) => `${HALF[halfOf(e)]} ${Math.floor(mf(e))}′`;
  const fmtMatch = (vt) => { const st = data.halfStart[half]; if (st == null) return `영상 ${fmtT(vt)}`; const m = Math.max(0, vt - st); return `${HALF[half]} ${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')}`; };
  let delMode = false; // 지우기: Del 키(또는 Backspace) → 경기장의 점을 누르면 지워짐
  const dirOf = (h) => (h === 2 ? flipDir(data.oppDir) : data.oppDir); // 후반은 자동으로 반대 방향
  const teams = data.target === 'both' ? ['opp', 'us'] : [data.target];
  const main = teams[0];
  let tab = sample ? 'report' : canEdit ? 'tag' : 'check';
  let kind = 'attack';
  let team = data.target === 'us' ? 'us' : 'opp';
  let saveT = null;
  let lastId = null; // 방금 기록한 장면
  // ── 시제품(3.0): 팀 기능 'proto3'가 켜진 팀의 코치에게만 ──
  const P = canEdit && !sample && protoOn();
  const work = P ? await loadWork(post.id) : {};
  work.log ||= []; work.sessions ||= [];
  let roster = []; // 우리 팀 선수 (UID 연결)
  if (P) {
    try { roster = (await getDocs(collection(db, 'teams', state.team.id, 'members'))).docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.role === 'player').sort((a, b) => (+a.number || 99) - (+b.number || 99)); } catch { roster = []; }
  }
  const nameOf = (id) => roster.find((m) => m.id === id)?.name || '';
  const ls0 = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  let tpl = P ? ls0('ssaka.p3.tpl', 'all') : 'all'; // 분석 목적 템플릿
  let tplUid = P ? ls0('ssaka.p3.tplUid', '') : ''; // '선수 한 명' 템플릿의 선수
  let quick = P ? ls0('ssaka.p3.quick', false) : false; // 빠른 기록: 키만 누르면 바로 기록 (위치는 나중에 · 안 찍어도 됨)
  let skipDead = P ? ls0('ssaka.p3.skip', false) : false; // 멈춤 구간 건너뛰며 보기
  // 되돌리기: 기록 + AI 후보 상태(맞음 · 아님)를 함께 저장했다가 되돌림
  const undoS = []; const redoS = [];
  const snapState = () => JSON.stringify({ e: data.events, c: (work.scan?.cands || []).map((c) => [c.id, c.state, c.ev || null]) });
  const restore = (s) => {
    const o = JSON.parse(s); data.events = o.e;
    const m = new Map(o.c.map(([id, st, ev]) => [id, [st, ev]]));
    (work.scan?.cands || []).forEach((c) => { const v = m.get(c.id); if (!v) return; c.state = v[0]; if (v[1]) c.ev = v[1]; else delete c.ev; });
  };
  const snap = () => { if (!P) return; undoS.push(snapState()); if (undoS.length > 80) undoS.shift(); redoS.length = 0; };
  const W = P ? workTimer() : null;
  if (W) state.cleanup.push(() => { W.stop(); pushSession(); });
  const logEdit = (what, e, extra = {}) => { if (P) work.log.push({ at: new Date().toISOString(), what, id: e?.id, k: e?.k, t: e?.t, ...extra }); };
  let curCand = null; // 후보 검토: 지금 보는 후보
  function pushSession() {
    if (!W || W.s.sec < 5) return;
    const s = { ...W.s, end: new Date().toISOString(), videoSec: Math.round(video?.duration || 0) };
    const i = work.sessions.findIndex((x) => x.start === s.start);
    if (i >= 0) work.sessions[i] = s; else work.sessions.push(s);
    saveWork(post.id, work).catch(() => {});
  }
  if (W) { const iv = setInterval(pushSession, 30000); state.cleanup.push(() => clearInterval(iv)); }
  const file = files.get(post.id);
  const vsrc = post.video?.url || (file ? URL.createObjectURL(file) : '');
  if (file) state.cleanup.push(() => URL.revokeObjectURL(vsrc));
  const linkNow = () => (post.link?.kind ? post.link : post.youtube ? { kind: 'youtube', id: post.youtube } : null);
  const lk = vsrc ? null : linkNow(); // 내 컴퓨터 영상을 열지 않았으면 저장해 둔 영상 링크
  const ctlHtml = `<div class="ma-ctl"><button class="icon-btn" data-play>▶</button><button class="icon-btn sm" data-step="-5">«</button><button class="icon-btn sm" data-step="5">»</button>
          <span class="st-time" data-time>0:00</span><span class="ma-seek"><input type="range" min="0" max="1000" value="0" data-seek><span class="ma-marks" data-marks></span></span>
          <select data-rate><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="1.5">1.5x</option><option value="2">2x</option></select></div>`;

  el.innerHTML = `<div class="studio ma">
    <header class="studio-top"><a href="#/analysis" class="icon-btn" aria-label="목록">‹</a>
      <div class="st-title"><strong>${esc(post.title)}</strong><small>경기분석 · ${esc([post.opponent && `vs ${post.opponent}`, post.date].filter(Boolean).join(' · '))}</small></div>
      <div class="st-actions"><span class="muted small" data-saved></span>${canEdit ? '<button class="btn ghost sm" data-full title="영상 · 단축키 · 경기장 · 자세히 칸을 한 화면에 (Esc로 나가기)">전체화면으로 기록</button><button class="btn ghost sm" data-del>삭제</button><button class="btn sm" data-savebtn>저장</button>' : ''}</div></header>
    ${sample ? '<div class="banner sample-banner">예시 리포트예요 — 코치님이 영상을 보며 단축키로 직접 기록하면(전반 · 후반 · 킥오프 · 결과 · 발 · 번호) 이렇게 한 장으로 정리돼요. 위 [전체 · 전반 · 후반]도 눌러 보세요.</div>' : ''}
    ${P ? '<div class="banner p3-banner"><b>시제품 3.0</b> 이 팀에만 켜 둔 시험 기능이 있어요 — 목적별 템플릿 · 빠른 기록 · 실행 취소 · 선수 연결 · <b>AI 후보 (실험)</b> · 작업 시간 재기</div>' : ''}
    <nav class="tabs admin-tabs ma-tabs">${[...(canEdit ? [['tag', '기록하기']] : [['check', '체크 포인트']]), ...(P ? [['review', 'AI 후보 (실험)']] : []), ['formation', '포메이션'], ['report', '리포트']].map(([k, l]) => `<a href="javascript:void 0" data-tab="${k}">${l}</a>`).join('')}</nav>
    <div class="ma-body">
      <div class="ma-video" ${canEdit ? '' : 'hidden'}>
        ${vsrc ? `<div class="ma-vwrap"><video playsinline preload="auto" crossorigin="anonymous" src="${esc(vsrc)}"></video>${canEdit ? '<div class="ma-status" data-status></div>' : ''}</div>
          ${ctlHtml}`
        : lk ? `<div class="ma-vwrap ${['file', 'veo'].includes(lk.kind) ? '' : 'yt'}">${lk.kind === 'file' ? `<video playsinline preload="auto" src="${esc(lk.url)}"></video>` : lk.kind === 'veo' ? '<video playsinline preload="metadata" data-veo></video><p class="ma-veoload" data-veomsg>Veo 경기 영상을 불러오는 중…</p>' : '<div class="ma-yt" data-yt></div>'}${canEdit ? '<div class="ma-status" data-status></div>' : ''}</div>
          ${ctlHtml}${canEdit ? `<div class="ma-ytbar"><span class="muted small">${LINK_NAME[lk.kind]} 영상으로 기록 중</span><button type="button" class="link-btn small" data-ytoff>다른 영상 열기</button></div>` : ''}`
        : `<div class="card ma-novideo"><p>경기 영상을 열면 보면서 기록할 수 있어요.</p>
          <label class="btn file-btn">내 컴퓨터 영상 파일 열기<input type="file" accept="video/*" hidden data-file></label>
          <p class="muted small">파일은 서버에 올라가지 않아요.</p>
          <div class="ma-ytin"><input type="url" placeholder="영상 링크 붙여넣기 (유튜브 · Veo · mp4 주소)" data-yturl><button type="button" class="btn" data-ytgo>링크로 열기</button></div>
          <p class="muted small">링크는 이 분석에 저장돼서 다음에도 바로 열려요. 유튜브는 <b>공개 · 일부 공개</b>, Veo는 <b>공개(링크 공유)</b>된 경기만 돼요.</p>
          <p class="muted small">영상 없이도 <b>포메이션 · 리포트</b>는 볼 수 있어요.</p></div>`}
      ${canEdit ? '<div class="ma-kb" data-kb></div><div class="card ma-tips" data-tips></div>' : ''}
      </div>
      <div class="ma-panel" data-panel></div>
    </div>
  </div>`;

  const video = el.querySelector('video') || (lk?.kind === 'youtube' ? ytPlayer(el.querySelector('[data-yt]'), lk.id) : lk?.kind === 'vimeo' ? vimeoPlayer(el.querySelector('[data-yt]'), lk) : null);
  if (video?.yt) state.cleanup.push(() => video.destroy());
  // Veo: 공개 경기의 원본 영상 주소를 서버 함수로 찾아서 바로 재생 (주소는 열 때마다 새로 받음)
  const veoV = el.querySelector('[data-veo]');
  if (veoV && lk?.slug) {
    fetch(`/api/veo?m=${encodeURIComponent(lk.slug)}`).then((r) => r.json().then((j) => [r.ok, j])).then(([ok, j]) => {
      const msg = el.querySelector('[data-veomsg]');
      if (!ok || !j.url) { if (msg) msg.textContent = j.error === 'not public' ? 'Veo 경기가 공개되어 있지 않아 열 수 없어요. Veo에서 경기 공유(공개)를 켜거나, 영상을 다운로드해서 파일로 열어 주세요.' : 'Veo 영상을 찾지 못했어요. 링크를 확인해 주세요.'; return; }
      veoV.src = j.url; msg?.remove();
    }).catch(() => { const msg = el.querySelector('[data-veomsg]'); if (msg) msg.textContent = 'Veo 영상을 불러오지 못했어요. 잠시 뒤 다시 해 주세요.'; });
  }
  // 영상 링크 붙여넣기 → 이 분석에 저장하고 다시 그림
  el.querySelector('[data-ytgo]')?.addEventListener('click', async () => {
    const l = linkOf(el.querySelector('[data-yturl]').value);
    if (l?.kind === 'veo-bad') return toast(VEO_HELP);
    if (!l) return toast(`영상 링크를 확인해 주세요. ${LINK_HELP}`);
    post.link = l; post.youtube = l.kind === 'youtube' ? l.id : '';
    if (!sample) { try { await updateDoc(doc(db, ...col(), post.id), { link: l, youtube: post.youtube }); } catch (err) { fail(err); } }
    files.delete(post.id);
    matchStudio(el, post, { canEdit, files });
  });
  el.querySelector('[data-yturl]')?.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') el.querySelector('[data-ytgo]').click(); });
  el.querySelector('[data-ytoff]')?.addEventListener('click', async () => {
    if (!(await confirmBox('지금 영상 링크를 빼고 다른 영상을 열까요? 기록은 그대로 남아요.'))) return;
    post.youtube = ''; post.link = null;
    if (!sample) { try { await updateDoc(doc(db, ...col(), post.id), { youtube: '', link: null }); } catch (err) { fail(err); } }
    matchStudio(el, post, { canEdit, files });
  });
  const panel = el.querySelector('[data-panel]');
  const t = () => video?.currentTime || 0;
  el.querySelector('[data-file]')?.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    files.set(post.id, f);
    matchStudio(el, post, { canEdit, files });
  });
  // 전체화면 기록: 영상 · 키보드 그림 · 경기장 · 자세히 칸만 한 화면에
  const studioEl = el.querySelector('.studio');
  const setFull = (on) => {
    studioEl.classList.toggle('ma-full', on);
    const b = el.querySelector('[data-full]'); if (b) b.textContent = on ? '전체화면 나가기' : '전체화면으로 기록';
    if (on && tab !== 'tag') setTab('tag');
    try { if (on && !document.fullscreenElement) studioEl.requestFullscreen?.().catch(() => {}); if (!on && document.fullscreenElement) document.exitFullscreen?.(); } catch { /* */ }
  };
  el.querySelector('[data-full]')?.addEventListener('click', (ev) => { ev.currentTarget.blur(); setFull(!studioEl.classList.contains('ma-full')); });
  // 유튜브 화면을 누르면 키보드가 유튜브로 넘어가서 단축키가 안 먹음 → 잠시 뒤 다시 이 화면으로 (재생 · 멈춤 클릭은 그대로 됨)
  if (video?.yt) {
    const back = () => setTimeout(() => { if (document.activeElement?.tagName === 'IFRAME' && tab === 'tag') { document.activeElement.blur(); window.focus(); } }, 250);
    window.addEventListener('blur', back);
    state.cleanup.push(() => window.removeEventListener('blur', back));
  }
  const onFs = () => { if (!document.fullscreenElement && studioEl.classList.contains('ma-full')) setFull(false); };
  document.addEventListener('fullscreenchange', onFs);
  state.cleanup.push(() => { document.removeEventListener('fullscreenchange', onFs); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); });
  el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmBox('이 경기분석을 삭제할까요?'))) return;
    try { await deleteDoc(doc(db, ...col(), post.id)); go('/analysis'); } catch (err) { fail(err); }
  });

  // 저장: 바꿀 때마다 잠깐 기다렸다가 한 번에
  const payload = () => ({
    events: data.events, formations: data.formations, oppDir: data.oppDir, target: data.target, size: data.size, lineups: data.lineups, keys: data.keys, halfStart: data.halfStart,
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
      toast(`리포트로 저장했어요 — 기록 ${data.events.length}개 · 자동 분석 · 포메이션 · 키 플레이어 (영상은 저장되지 않아요)`);
      setTab('report');
    } catch (err) { fail(err); }
  });

  // 공격 방향 표시: 우리 팀만 분석하면 '우리 공격' 기준으로
  const dirLabel = () => (main === 'us' ? '우리 공격' : '상대 공격');
  const dirArrow = () => (attacksRight(main, dirOf(half)) ? '→' : '←');

  // ── 기록 상태 표시: 영상이 자동으로 분석되지 않으니, 지금 기록 중인지 · 얼마나 기록했는지 늘 보이게 ──
  let idle = 0; // 마지막 기록 뒤 실제로 재생된 시간(초)
  let lastTU = null;
  let flash = null; // 방금 기록한 장면 (잠깐 표시)
  const drawStatus = () => {
    const box = el.querySelector('[data-status]');
    if (!box || !video) return;
    let cls = ''; let html;
    if (flash && Date.now() - flash.at < 2500) { cls = flash.del ? 'warn' : 'ok'; html = flash.del ? `지웠어요 · ${TEAM[flash.team]} ${KIND[flash.k].l} (${matchMin(flash)})` : `<b class="sthalf h${halfOf(flash)}">${HALF[halfOf(flash)]}</b> 기록함 · ${TEAM[flash.team]} ${KIND[flash.k].l} (${matchMin(flash)}) · ${HALF[half]} ${data.events.filter((e) => halfOf(e) === half).length}개`; }
    else if (delMode) { cls = 'warn'; html = '지우기 — 오른쪽 경기장에서 <b>지울 점</b>을 누르세요 (Esc 취소)'; }
    else if (video.paused) html = `<b class="sthalf h${half}">${HALF[half]}</b> 멈춤 — 단축키로 장면을 고르고 경기장을 누르면 기록돼요`;
    else if (idle >= 120) { cls = 'warn'; html = `<b class="sthalf h${half}">${HALF[half]}</b> 재생 중 · ${Math.floor(idle / 60)}분 넘게 누른 기록이 없어요 — 장면이 있었으면 <kbd>Space</kbd>로 멈추고 눌러 주세요`; }
    else { html = `<b class="sthalf h${half}">${HALF[half]}</b> 재생 중 · ${fmtMatch(t())} — 장면이 나오면 <kbd>Space</kbd>로 멈추고 단축키 → 경기장`; }
    box.className = `ma-status ${cls}`;
    box.innerHTML = html;
  };
  const drawMarks = () => {
    const box = el.querySelector('[data-marks]');
    const d = video?.duration;
    if (!box || !d) return;
    box.innerHTML = data.events.filter((e) => e.t <= d && halfOf(e) === half).map((e) => `<i style="left:${(e.t / d) * 100}%;background:${KIND[e.k].c}"></i>`).join('');
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
      if (!el.querySelector('[data-time]')) return; // 화면을 떠난 뒤 늦게 온 신호
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
    el.querySelector('[data-rate]').onchange = (e) => { video.playbackRate = +e.target.value; e.target.blur(); };
    state.cleanup.push(() => video.pause());
    if (W) {
      W.bindPlaying(() => !video.paused);
      // 멈춤 구간 건너뛰기: 찾아 둔 '선수가 거의 안 움직인 구간' 안에 들어오면 끝나기 2초 전으로
      video.addEventListener('timeupdate', () => {
        if (!skipDead || video.paused || !work.scan?.dead?.length) return;
        const now = t();
        const d = work.scan.dead.find((x) => now > x.t0 + 1 && now < x.t1 - 2.5);
        if (d) { W.count('skipSec', Math.round(d.t1 - 2 - now)); video.currentTime = d.t1 - 2; toast(`멈춤 구간 ${Math.round(d.t1 - 2 - now)}초 건너뜀`); }
      });
    }
  }
  if (W) {
    el.addEventListener('pointerdown', () => W.count('clicks'));
    el.addEventListener('keydown', () => W.touch());
  }

  // ── 탭 ──
  const setTab = (k) => {
    tab = k;
    document.querySelectorAll('.tour-bubble').forEach((x) => x.remove()); document.querySelectorAll('.tour-on').forEach((x) => x.classList.remove('tour-on'));
    el.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === k));
    el.querySelector('.ma-video').hidden = !(canEdit && (k === 'tag' || k === 'formation' || k === 'review'));
    el.querySelectorAll('[data-kb], [data-tips]').forEach((x) => { x.hidden = k !== 'tag' && !(k === 'review' && x.matches('[data-kb]')); });
    el.querySelector('.ma-body').classList.toggle('wide', !(canEdit && (k === 'tag' || k === 'formation' || k === 'review')));
    if (k === 'tag') drawTag(); else if (k === 'review') drawReview(); else if (k === 'check') drawCheck(); else if (k === 'formation') drawFormation(); else drawReport();
    syncMaPhone();
  };
  el.querySelectorAll('[data-tab]').forEach((a) => (a.onclick = () => setTab(a.dataset.tab)));

  // ───────── 휴대폰을 가로로 들고 기록할 때: 왼쪽 영상 · 오른쪽 큰 버튼판 (ma-phone) ─────────
  const landQ = matchMedia('(orientation: landscape)');
  let maPh = null;
  const maHint = COARSE && canEdit ? Object.assign(document.createElement('div'), { className: 'st-rotate ma-rotate', innerHTML: '<span><b>⟲ 가로로 돌리면</b> 영상 옆에 큰 버튼판이 나와서 엄지로 기록하기 편해요</span><button type="button" class="btn ghost sm" data-marot-no>이대로 쓰기</button>' }) : null;
  if (maHint) {
    el.querySelector('.ma-body').before(maHint);
    maHint.querySelector('[data-marot-no]').onclick = () => { try { localStorage.setItem('ssaka.ma.portraitOk', '1'); } catch { /* */ } maHint.hidden = true; };
  }
  function syncMaPhone() {
    if (!studioEl.isConnected) { landQ.removeEventListener('change', syncMaPhone); return; }
    const has = !!el.querySelector('.ma-vwrap');
    const on = COARSE && canEdit && landQ.matches && tab === 'tag' && has;
    if (maHint) { let ok = false; try { ok = localStorage.getItem('ssaka.ma.portraitOk') === '1'; } catch { /* */ } maHint.hidden = on || ok || !has || tab !== 'tag'; }
    if (on === !!maPh) return;
    if (on) {
      const L = document.createElement('div'); L.className = 'ma-ph-left';
      const R = document.createElement('div'); R.className = 'ma-ph-right';
      const marks = [];
      const mv = (n, to) => { if (!n) return; const m = document.createComment('ma'); n.before(m); to.appendChild(n); marks.push([m, n]); };
      const v = el.querySelector('.ma-video');
      [...v.querySelectorAll(':scope > .ma-vwrap, :scope > .ma-ctl, :scope > .ma-ytbar')].forEach((n) => mv(n, L));
      mv(v.querySelector(':scope > .ma-kb'), R);
      mv(panel, R);
      el.querySelector('.ma-body').append(L, R);
      maPh = { L, R, marks };
    } else {
      maPh.marks.reverse().forEach(([m, n]) => m.replaceWith(n));
      maPh.L.remove(); maPh.R.remove(); maPh = null;
    }
    studioEl.classList.toggle('ma-phone', on);
    document.documentElement.classList.toggle('pad-locked', on);
  }
  landQ.addEventListener('change', syncMaPhone);
  state.cleanup.push(() => { landQ.removeEventListener('change', syncMaPhone); document.documentElement.classList.remove('pad-locked'); });

  // ───────── 기록하기 ─────────
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };
  let detailOn = ls('ssaka.ma.detail2', true); // 기록 뒤 자세히 칸
  let pending = null; // 끝 지점을 기다리는 장면
  function drawTag() {
    if (!KINDS.some(([k]) => k === kind)) kind = 'attack';
    panel.innerHTML = `
      <div class="ma-row">${teams.length > 1 ? `<div class="seg" data-team>${teams.map((k) => `<button class="${k === team ? 'on' : ''}" data-tm="${k}">${TEAM[k]} 팀</button>`).join('')}</div>` : `<span class="tag solid">${TEAM[main]} 팀 분석</span>`}
        <div class="seg ma-half" data-half>${[1, 2].map((h) => `<button class="hb${h} ${h === half ? 'on' : ''}" data-h="${h}">${HALF[h]} <small>${data.events.filter((e) => halfOf(e) === h).length}</small></button>`).join('')}</div>
        <button class="btn ghost sm" data-kickoff title="영상에서 ${HALF[half]}이 시작하는 순간에 누르세요 — 리포트의 '몇 분'이 정확해져요">${data.halfStart[half] != null ? `${HALF[half]} 시작 ${fmtT(data.halfStart[half])}` : `지금이 ${HALF[half]} 킥오프`}</button>
        ${half === 1 ? '<button class="btn sm" data-start2 title="영상에서 후반이 시작하는 순간에 누르세요">후반 시작</button>' : ''}
        <button class="btn ghost sm" data-dir title="${half === 2 ? '후반은 전반과 반대로 자동으로 바뀌어요' : '전반에 화면에서 공격하는 방향'}">${dirLabel()} ${dirArrow()}</button>
</div>
      ${P ? p3Bar() : ''}
      <div class="ma-halfbar h${half}"><b>${HALF[half]}</b> 기록하는 중<span>${half === 1 ? '후반이 되면 위 <b>후반 시작</b>을 누르세요' : '전반 기록은 위 <b>전반</b>을 누르면 다시 보여요'}</span></div>
      ${data.halfStart[half] == null ? `<p class="ma-kowarn">${HALF[half]} 킥오프 시각을 아직 안 맞췄어요 — 영상에서 <b>휘슬이 울리는 순간</b> 위 <b>지금이 ${HALF[half]} 킥오프</b>를 누르면 리포트 시간(예: ${HALF[half]} 15분)이 정확해져요.</p>` : ''}
      <p class="muted small ma-hint" data-hint></p>
      <div class="ma-tagpitch h${half}" data-pitch></div>
      <div class="ma-detail" data-detail></div>
      <div class="ma-moderow"><label class="switch sm"><input type="checkbox" data-detailon ${detailOn ? 'checked' : ''}><span>기록 뒤 자세히 칸 (결과 · 발 · 번호)</span></label></div>
      <section class="card kp-edit" data-kps>${keysEditHtml()}</section>
      <div class="ma-live" data-live></div>
      <h4 class="ma-h">${HALF[half]} 기록 <small>${data.events.filter((e) => halfOf(e) === half).length}개</small> <span class="muted small">${HALF[3 - half]} ${data.events.filter((e) => halfOf(e) !== half).length}개는 위 <b>${HALF[3 - half]}</b>을 누르면 다시 보여요</span></h4>
      <ul class="list ma-log" data-log></ul>`;
    panel.querySelectorAll('[data-tm]').forEach((b) => (b.onclick = () => pickTeam(b.dataset.tm)));
    panel.querySelector('[data-dir]').onclick = () => { data.oppDir = flipDir(data.oppDir); save(); drawTag(); };
    panel.querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => {
      const h = +b.dataset.h;
      if (h === half) return;
      half = h; pending = null; lastId = null;
      // 그 하프의 첫 기록(없으면 킥오프 시각)으로 영상 이동
      const first = data.events.filter((e) => halfOf(e) === h).sort((a, c) => a.t - c.t)[0];
      const to = first ? Math.max(0, first.t - 3) : data.halfStart[h];
      if (video && to != null) { video.pause(); video.currentTime = to; toast(`${HALF[h]}${first ? ` 첫 기록(${fmtT(first.t)})` : ' 시작'}으로 돌아갔어요.`); }
      drawTag(); drawMarks();
    }));
    // 후반 시작: 지금 영상 시각을 후반 킥오프로 → 새 경기장에서 후반 기록 (전반 기록은 그대로 저장돼 있고 '전반'을 누르면 다시 보여요)
    panel.querySelector('[data-start2]')?.addEventListener('click', async () => {
      if (!video) return toast('먼저 경기 영상을 열어 주세요.');
      if (!(await confirmBox(`지금(${fmtT(t())})부터 후반으로 기록할까요? 전반 기록 ${data.events.filter((e) => halfOf(e) === 1).length}개는 따로 저장돼 있고, 위 '전반'을 누르면 다시 볼 수 있어요.`))) return;
      data.halfStart = { ...data.halfStart, 2: +t().toFixed(1) };
      half = 2; pending = null; lastId = null;
      save(); drawTag(); drawMarks();
      toast('후반 시작! 새 경기장에서 기록해요. 공격 방향도 자동으로 바뀌었어요.');
    });
    panel.querySelector('[data-kickoff]').onclick = async () => {
      if (!video) return toast('먼저 경기 영상을 열어 주세요.');
      if (data.halfStart[half] != null && !(await confirmBox(`${HALF[half]} 시작을 지금(${fmtT(t())})으로 바꿀까요?`))) return;
      data.halfStart = { ...data.halfStart, [half]: +t().toFixed(1) };
      save(); drawTag(); toast(`${HALF[half]} 킥오프를 ${fmtT(t())}로 맞췄어요.`);
    };
    panel.querySelector('[data-detailon]').onchange = (e) => { detailOn = e.target.checked; lsSet('ssaka.ma.detail2', detailOn); drawDetail(); drawHint(); };
    if (P) bindP3(panel);
    drawHint();
    drawTagPitch();
    drawDetail();
    drawLog();
    drawLive();
    bindKeys();
    drawKb();
  }
  // ───────── 시제품(3.0) 도구: 템플릿 · 빠른 기록 · 되돌리기 · 건너뛰기 ─────────
  const tplKinds = () => { const t0 = TEMPLATES.find(([k]) => k === tpl); return t0?.[2] ? new Set(t0[2]) : null; };
  const playerOpts = (sel) => roster.map((m) => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.number ? `${m.number}번 ` : '')}${esc(m.name || '')}${m.position ? ` · ${esc(m.position)}` : ''}</option>`).join('');
  function p3Bar() {
    return `<div class="p3-bar">
      <label class="p3-f">분석 목적<select data-p3tpl>${TEMPLATES.map(([k, l]) => `<option value="${k}" ${k === tpl ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${(tpl === 'player' || tpl === 'gk') && roster.length ? `<label class="p3-f">선수<select data-p3uid><option value="">선수 고르기</option>${playerOpts(tplUid)}</select></label>` : ''}
      <label class="switch sm" title="단축키를 누르면 지금 시각으로 바로 기록돼요. 위치는 6초 안에 경기장을 누르면 붙고, 안 눌러도 돼요"><input type="checkbox" data-p3quick ${quick ? 'checked' : ''}><span>빠른 기록 (위치는 선택)</span></label>
      ${work.scan?.dead?.length ? `<label class="switch sm" title="AI 후보 찾기에서 찾은 '선수가 거의 안 움직인 구간'을 재생할 때 넘어가요"><input type="checkbox" data-p3skip ${skipDead ? 'checked' : ''}><span>멈춤 구간 건너뛰기 (${work.scan.dead.length}곳)</span></label>` : ''}
      <span class="p3-undo"><button type="button" class="btn ghost sm" data-p3undo ${undoS.length ? '' : 'disabled'} title="Ctrl(⌘) + Z">되돌리기</button><button type="button" class="btn ghost sm" data-p3redo ${redoS.length ? '' : 'disabled'} title="Ctrl(⌘) + Shift + Z">다시 하기</button></span>
    </div>`;
  }
  const redrawCur = () => { if (tab === 'review') drawReview(); else if (tab === 'tag') drawTag(); drawMarks(); };
  function bindP3(box) {
    box.querySelector('[data-p3tpl]')?.addEventListener('change', (e) => {
      tpl = e.target.value; lsSet('ssaka.p3.tpl', tpl);
      if ((tpl === 'player' || tpl === 'gk') && teams.includes('us') && team !== 'us') pickTeam('us');
      redrawCur(); drawKb();
    });
    box.querySelector('[data-p3uid]')?.addEventListener('change', (e) => { tplUid = e.target.value; lsSet('ssaka.p3.tplUid', tplUid); e.target.blur(); toast(tplUid ? `이제 우리 팀 기록은 ${nameOf(tplUid)} 선수로 연결돼요.` : '선수 연결을 껐어요.'); });
    box.querySelector('[data-p3quick]')?.addEventListener('change', (e) => { quick = e.target.checked; lsSet('ssaka.p3.quick', quick); e.target.blur(); drawHint(); });
    box.querySelector('[data-p3skip]')?.addEventListener('change', (e) => { skipDead = e.target.checked; lsSet('ssaka.p3.skip', skipDead); e.target.blur(); });
    box.querySelector('[data-p3undo]')?.addEventListener('click', (ev) => { ev.currentTarget.blur(); undo(); });
    box.querySelector('[data-p3redo]')?.addEventListener('click', (ev) => { ev.currentTarget.blur(); redo(); });
  }
  function afterChange() {
    if (lastId && !data.events.some((x) => x.id === lastId)) lastId = null;
    save(); saveWork(post.id, work).catch(() => {}); redrawCur(); drawStatus();
  }
  function undo() {
    if (!undoS.length) { toast('되돌릴 기록이 없어요.'); return; }
    redoS.push(snapState()); restore(undoS.pop()); W?.count('undos'); logEdit('undo'); afterChange(); toast('되돌렸어요.');
  }
  function redo() {
    if (!redoS.length) return;
    undoS.push(snapState()); restore(redoS.pop()); logEdit('redo'); afterChange();
  }
  let quickAt = 0; // 빠른 기록 시각 (이 뒤 6초 안에 경기장을 누르면 위치가 붙음)
  function quickAdd(k) {
    if (!video) { toast('먼저 경기 영상을 열어 주세요.'); return; }
    const e = { id: uid(), t: +t().toFixed(1), half, team, k, x: null, y: null };
    if (k === 'note') { const s0 = prompt('메모'); if (!s0) return; e.text = s0.slice(0, 80); }
    quickAt = Date.now();
    addEvent(e);
  }

  // ───────── AI 후보 (실험): 영상 확인 → 후보 찾기 → 검토 → 확정한 것만 기록 ─────────
  let scanning = null; // { ctl, label, p }
  const cands = () => work.scan?.cands || [];
  const evOf = (c) => data.events.find((x) => x.id === c.ev);
  const scanSrc = () => file || post.video?.url || (lk?.kind === 'file' ? lk.url : null);
  const fmtWhen = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const KIND_HINT = { whistle: ['foul', 'freekick', 'offside', 'corner', 'goal'], restart: ['corner', 'freekick', 'penalty', 'goal'], long: ['goal', 'note'] };
  function probeHtml(p) {
    if (!p) return '<p class="muted small">영상 파일의 형식 · 길이 · 화면 크기 · 소리를 확인하고, 어떤 방식으로 후보를 찾을 수 있는지 알려 줘요.</p>';
    const row = (l, v) => `<div><small>${l}</small><b>${v}</b></div>`;
    return `<div class="p3-probe">${row('형식', esc(p.kind.toUpperCase()))}${row('화면', p.w ? `${p.w} × ${p.h}` : '-')}${row('길이', p.dur ? fmtT(p.dur) : '-')}${row('크기', `${p.sizeMB.toLocaleString()}MB`)}${row('소리', p.hasAudio ? '있음' : '<span class="p3-no">분석 못 함</span>')}</div>
      ${p.audio?.why ? `<p class="small p3-why">${esc(p.audio.why)}</p>` : ''}
      <ul class="p3-can">${DETECTORS.map((d) => { const why = d.needs(p); return `<li class="${why ? 'off' : 'on'}"><b>${d.label}</b> ${why ? `— 쓸 수 없음: ${esc(why)}` : '— 쓸 수 있어요'}</li>`; }).join('')}</ul>`;
  }
  function detsHtml(p) {
    const sel = ls0('ssaka.p3.dets', DETECTORS.map((d) => d.id));
    return DETECTORS.map((d) => { const why = p ? d.needs(p) : ''; return `<label class="p3-det ${why ? 'off' : ''}"><input type="checkbox" data-det value="${d.id}" ${sel.includes(d.id) && !why ? 'checked' : ''} ${why || !p ? 'disabled' : ''}><span><b>${d.label}</b> <small class="muted">${d.ver}</small><br><small class="muted">${esc(d.hint)}</small></span></label>`; }).join('');
  }
  function curHtml() {
    const c = cands().find((x) => x.id === curCand);
    if (!c) return '<p class="muted small"><kbd>L</kbd>(또는 아래 목록의 시각)을 누르면 첫 후보부터 영상이 그 장면 몇 초 앞에서 재생돼요.</p>';
    const e = evOf(c);
    return `<div class="p3-curhead"><span class="p3-type t-${c.type}">${CAND_TYPE[c.type]}</span><b>${fmtT(c.t)}</b><small class="muted">${esc(c.why)} · 믿을 만한 정도 ${Math.round(c.score * 100)}%</small>${c.state === 'ok' ? `<span class="tag solid">맞음 · ${esc(KIND[e?.k]?.l || '')}</span>` : c.state === 'no' ? '<span class="tag">아님</span>' : ''}</div>
      <div class="p3-curbtns">${KIND_HINT[c.type].map((k) => `<button type="button" class="kb-key g-${KIND[k].g}" style="--c:${KIND[k].c}" data-ck="${k}"><b>${KIND[k].key}</b><span>${KIND[k].l}</span></button>`).join('')}
        <button type="button" class="kb-key fn" data-cno><b>N</b><span>아님</span></button><button type="button" class="kb-key fn" data-crep><b>H</b><span>다시 보기</span></button><button type="button" class="kb-key fn" data-cnext><b>L</b><span>다음</span></button></div>
      <p class="muted small">다른 장면이면 영상 밑 단축키를 그대로 누르세요 · 팀은 <kbd>Tab</kbd> (지금 ${TEAM[team]})</p>`;
  }
  const candRow = (c) => `<li class="p3-c ${c.state} ${c.id === curCand ? 'cur' : ''}" data-cid="${c.id}"><button type="button" class="link-btn ma-min" data-cgo>${fmtT(c.t)}</button><span class="p3-type t-${c.type}">${CAND_TYPE[c.type]}</span><small>${esc(c.why)}</small><span class="p3-score" title="믿을 만한 정도 ${Math.round(c.score * 100)}%"><i style="width:${Math.round(c.score * 100)}%"></i></span><b class="p3-st">${c.state === 'ok' ? `맞음 · ${esc(KIND[evOf(c)?.k]?.l || '')}` : c.state === 'no' ? '아님' : ''}</b></li>`;
  function drawReview() {
    const cs = cands(); const ok = cs.filter((c) => c.state === 'ok').length; const no = cs.filter((c) => c.state === 'no').length;
    const sc = work.scan; const src = scanSrc();
    panel.innerHTML = `
      <div class="banner p3-warn"><b>실험 기능</b> 실제 유소년 경기에서 정확도가 검증되지 않았어요. AI 후보는 <b>리포트에 들어가지 않고</b>, 코치님이 맞다고 고른 것만 기록이 돼요.</div>
      ${p3Bar()}
      <section class="card p3-card"><h4>1. 영상 확인 <small class="muted">촬영 환경 · 분석할 수 있는지</small></h4>${probeHtml(sc?.probe)}
        ${src ? `<div class="row"><button type="button" class="btn sm ${sc?.probe ? 'ghost' : ''}" data-p3probe>${sc?.probe ? '다시 확인' : '영상 확인하기'}</button></div>` : '<p class="muted small p3-why">내 컴퓨터 영상 파일(또는 mp4 주소)로 연 경기만 확인할 수 있어요. 유튜브 · 비메오 · Veo 링크는 영상을 직접 읽을 수 없어요.</p>'}</section>
      <section class="card p3-card"><h4>2. 장면 후보 찾기 <small class="muted">이 컴퓨터 안에서만 · 영상은 어디에도 올라가지 않아요</small></h4>
        <div class="p3-dets">${detsHtml(sc?.probe)}</div>
        <div class="row p3-scanrow" data-scanrow>${scanning ? `<div class="p3-prog"><i style="width:${Math.round((scanning.p || 0) * 100)}%"></i></div><span class="small" data-scanlbl>${esc(scanning.label)} ${Math.round((scanning.p || 0) * 100)}%</span><button type="button" class="btn ghost sm" data-p3stop>멈추기</button>`
          : `<button type="button" class="btn sm" data-p3scan ${sc?.probe && src ? '' : 'disabled'}>${sc?.cands ? '다시 찾기' : '후보 찾기 시작'}</button>${sc?.ranAt ? `<span class="muted small">${fmtWhen(sc.ranAt)} · 걸린 시간 ${fmtDur(sc.ms / 1000)} · ${esc((sc.used || []).join(' · ') || '-')}</span>` : '<span class="muted small">25분 영상에 몇 분 걸릴 수 있어요 — 그동안 기록하기 탭을 써도 돼요</span>'}`}</div>
        ${sc?.camera ? `<p class="small">촬영 방식 짐작: <b>${esc(sc.camera.label)}</b> <span class="muted">(카메라가 움직인 시간 ${sc.camera.moving}%)</span></p>` : ''}
        ${sc?.dead ? `<p class="small">선수가 거의 안 움직인 구간 <b>${sc.dead.length}곳 · 모두 ${fmtDur(sc.dead.reduce((a, d) => a + d.t1 - d.t0, 0))}</b> — 위 <b>멈춤 구간 건너뛰기</b>를 켜면 재생할 때 넘어가요. 먼 곳에서 벌어진 장면도 움직임이 작게 보여 섞일 수 있어요.</p>` : ''}
      </section>
      <section class="card p3-card"><h4>3. 후보 검토 <small class="muted">후보 ${cs.length} · 맞음 ${ok} · 아님 ${no} · 남음 ${cs.length - ok - no}${ok + no ? ` · 지금까지 맞은 비율 ${Math.round((ok / (ok + no)) * 100)}%` : ''}</small></h4>
        ${cs.length ? `<p class="muted small p3-keys"><kbd>L</kbd> 다음 후보 · <kbd>J</kbd> 이전 · <kbd>H</kbd> 다시 보기 · 맞으면 <b>장면 단축키</b> (예: <kbd>Z</kbd> 코너킥 · <kbd>X</kbd> 프리킥 · <kbd>V</kbd> 파울 · <kbd>W</kbd> 득점) · 아니면 <kbd>N</kbd> · 잘못 누르면 <kbd>Ctrl</kbd>+<kbd>Z</kbd></p>
          <div class="p3-cur" data-cur>${curHtml()}</div>
          <ol class="list p3-cands" data-cands>${cs.map(candRow).join('')}</ol>`
          : '<p class="muted small">아직 후보가 없어요. 위에서 영상 확인 → 후보 찾기를 해 주세요. 후보 없이도 기록하기 탭에서 그대로 기록할 수 있어요.</p>'}
      </section>
      ${linkHtml()}`;
    bindP3(panel); bindReview(); drawKb();
  }
  function bindReview() {
    panel.querySelector('[data-p3probe]')?.addEventListener('click', async (ev) => {
      ev.currentTarget.blur(); const b = ev.currentTarget; b.disabled = true; b.textContent = '확인 중…';
      try { const p = await probeVideo(scanSrc()); work.scan = { ...(work.scan || {}), probe: { ...p, audio: { ok: p.audio.ok, why: p.audio.why || '', silent: !!p.audio.silent } } }; logEdit('probe'); await saveWork(post.id, work); } catch (err) { fail(err); }
      drawReview();
    });
    panel.querySelectorAll('[data-det]').forEach((c) => (c.onchange = () => { lsSet('ssaka.p3.dets', [...panel.querySelectorAll('[data-det]:checked')].map((x) => x.value)); c.blur(); }));
    panel.querySelector('[data-p3scan]')?.addEventListener('click', (ev) => { ev.currentTarget.blur(); runScan(); });
    panel.querySelector('[data-p3stop]')?.addEventListener('click', () => scanning?.ctl.abort());
    panel.querySelectorAll('[data-cgo]').forEach((b) => (b.onclick = () => { b.blur(); goCand(cands().find((c) => c.id === b.closest('li').dataset.cid)); }));
    panel.querySelectorAll('[data-ck]').forEach((b) => (b.onclick = () => { b.blur(); confirmCand(b.dataset.ck); }));
    panel.querySelector('[data-cno]')?.addEventListener('click', (ev) => { ev.currentTarget.blur(); rejectCand(); });
    panel.querySelector('[data-crep]')?.addEventListener('click', (ev) => { ev.currentTarget.blur(); const c = cands().find((x) => x.id === curCand); if (c) goCand(c); });
    panel.querySelector('[data-cnext]')?.addEventListener('click', (ev) => { ev.currentTarget.blur(); stepCand(1); });
    bindLinks();
  }
  async function runScan() {
    const src = scanSrc(); const p = work.scan?.probe;
    if (!src || !p) return;
    const sel = [...panel.querySelectorAll('[data-det]:checked')].map((x) => x.value);
    const use = DETECTORS.filter((d) => sel.includes(d.id) && !d.needs(p));
    if (!use.length) { toast('쓸 수 있는 방식을 하나 이상 골라 주세요.'); return; }
    if (cands().some((c) => c.state !== 'open') && !(await confirmBox('다시 찾으면 후보 목록이 새로 만들어져요. 이미 확정한 기록은 그대로 남아요. 다시 찾을까요?'))) return;
    const ctl = new AbortController(); scanning = { ctl, label: '', p: 0 }; drawReview();
    const T = performance.now(); const res = {};
    try {
      for (const d of use) {
        scanning.label = d.label; scanning.p = 0;
        res[d.id] = await d.run(src, p, {
          signal: ctl.signal,
          onProgress: (x) => { scanning.p = x; const r = panel.querySelector('[data-scanrow]'); if (!r) return; const i = r.querySelector('.p3-prog i'); if (i) i.style.width = `${Math.round(x * 100)}%`; const s = r.querySelector('[data-scanlbl]'); if (s) s.textContent = `${d.label} ${Math.round(x * 100)}%`; },
        });
      }
      const cs = buildCands(res);
      work.scan = { probe: p, ranAt: new Date().toISOString(), ms: Math.round(performance.now() - T), used: use.map((d) => d.label), vers: use.map((d) => d.ver),
        dead: res.motion?.dead || null, camera: res.motion?.camera || null, whistle: res.whistle ? { th: res.whistle.th, n: res.whistle.hits.length } : null, cands: cs };
      curCand = null; W.s.mode = 'assist'; logEdit('scan', null, { n: cs.length, vers: work.scan.vers });
      await saveWork(post.id, work);
      toast(`후보 ${cs.length}개를 찾았어요 (${fmtDur(work.scan.ms / 1000)}).`);
    } catch (err) { if (err?.name === 'AbortError') toast('후보 찾기를 멈췄어요.'); else fail(err); }
    scanning = null;
    if (tab === 'review') drawReview();
  }
  function goCand(c, play = true) {
    if (!c) return;
    curCand = c.id;
    if (video) { video.currentTime = Math.max(0, c.t0); if (play) video.play(); }
    if (tab === 'review') drawReview();
  }
  function stepCand(d) {
    const cs = cands(); if (!cs.length) return;
    const i = cs.findIndex((c) => c.id === curCand);
    if (d > 0) { const nx = cs.slice(i + 1).find((c) => c.state === 'open') || cs[i + 1]; if (nx) goCand(nx); else toast('마지막 후보예요. 남은 장면은 기록하기 탭에서 단축키로 더해요.'); }
    else if (i > 0) goCand(cs[i - 1]);
  }
  function confirmCand(k) {
    const c = cands().find((x) => x.id === curCand);
    if (!c) { toast('먼저 L 키(또는 목록의 시각)로 후보로 가세요.'); return; }
    snap();
    const old = evOf(c);
    if (c.state === 'ok' && old) { old.k = k; W.count('edits'); logEdit('cand-kind', old, { cand: c.id }); save(); }
    else {
      const now = t(); const at = now >= c.t0 - 1 && now <= c.t1 + 8 ? now : c.t; // 영상을 그 장면에서 멈췄으면 그 시각
      const e = { id: uid(), t: +at.toFixed(1), half, team, k, x: null, y: null, src: 'ai', cand: c.id };
      if (k === 'note') { const s0 = prompt('메모'); if (!s0) { undoS.pop(); return; } e.text = s0.slice(0, 80); }
      c.state = 'ok'; c.ev = e.id; W.count('candOk'); logEdit('cand-ok', e, { cand: c.id });
      addEvent(e, { nosnap: true });
    }
    W.s.mode = 'assist'; saveWork(post.id, work).catch(() => {});
    toast(`${KIND[k].l}(으)로 확정했어요 · L 다음 후보`);
    if (tab === 'review') drawReview();
  }
  function rejectCand() {
    const c = cands().find((x) => x.id === curCand);
    if (!c) return;
    snap();
    if (c.state === 'ok' && evOf(c)) { data.events = data.events.filter((x) => x.id !== c.ev); delete c.ev; save(); }
    c.state = 'no'; W.count('candNo'); W.s.mode = 'assist'; logEdit('cand-no', null, { cand: c.id });
    saveWork(post.id, work).catch(() => {});
    stepCand(1);
    if (tab === 'review') drawReview();
  }
  // 후보 검토 화면의 키: J 이전 · L 다음 · H 다시 보기 · N(또는 Backspace) 아님
  function reviewKey(e) {
    const c = e.code;
    if (c === 'KeyL') { e.preventDefault(); stepCand(1); return true; }
    if (c === 'KeyJ') { e.preventDefault(); stepCand(-1); return true; }
    if (c === 'KeyH') { e.preventDefault(); const cc = cands().find((x) => x.id === curCand); if (cc) goCand(cc); return true; }
    if (c === 'KeyN' || e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); rejectCand(); return true; }
    return false;
  }
  // 선수 연결 (UID): 우리 팀 기록 중 선수가 없는 것만 모아서 번호로 빠르게
  // 번호는 이 경기 날짜에 쓰던 번호로 찾음 (해가 바뀌어 번호가 바뀌어도 지난 영상은 그때 번호로)
  const numOf = (m) => String(numberAt(m, post.date) || '');
  const byNum = (n) => { const ms = roster.filter((m) => numOf(m) === String(n || '').trim()); return ms.length === 1 ? ms[0] : null; };
  function linkHtml() {
    if (!roster.length || !teams.includes('us')) return '';
    const us = data.events.filter((e) => e.team === 'us'); const no = us.filter((e) => !e.uid);
    return `<section class="card p3-card"><h4>선수 연결 <small class="muted">우리 팀 기록 ${us.length}개 중 ${us.length - no.length}개 연결 · 번호만 적고 Enter</small></h4>
      ${!us.length ? '<p class="muted small">우리 팀 기록이 아직 없어요. 기록하면 여기서 번호로 선수와 연결해요.</p>' : no.length ? `<ul class="list p3-link">${no.slice(0, 40).map((e) => `<li data-lev="${e.id}"><button type="button" class="link-btn ma-min" data-go="${e.t}">${fmtT(e.t)}</button><span class="ma-tag" style="--c:${KIND[e.k].c}">${KIND[e.k].l}</span><input data-lnum inputmode="numeric" maxlength="3" placeholder="번호" value="${esc(e.num || '')}"><small data-lname class="muted">${e.num && byNum(e.num) ? esc(byNum(e.num).name) : ''}</small></li>`).join('')}</ul>${no.length > 40 ? `<p class="muted small">… ${no.length - 40}개 더 (위부터 채우면 이어서 보여요)</p>` : ''}` : '<p class="muted small">우리 팀 기록이 모두 선수와 연결됐어요.</p>'}</section>`;
  }
  function bindLinks() {
    panel.querySelectorAll('.p3-link li').forEach((li) => {
      const e = data.events.find((x) => x.id === li.dataset.lev); const inp = li.querySelector('[data-lnum]');
      li.querySelector('[data-go]').onclick = (ev) => { ev.currentTarget.blur(); if (video) { video.currentTime = Math.max(0, e.t - 3); video.play(); } };
      inp.oninput = () => { const m = byNum(inp.value); li.querySelector('[data-lname]').textContent = inp.value ? (m ? m.name : '이 번호의 선수가 없어요') : ''; };
      inp.onkeydown = (ev) => {
        ev.stopPropagation();
        if (ev.key !== 'Enter') return;
        const m = byNum(inp.value); if (!m) { toast('명단에 없는 번호예요.'); return; }
        snap(); e.uid = m.id; e.num = numOf(m); W.count('edits'); logEdit('uid', e, { uid: m.id }); save();
        const nx = li.nextElementSibling?.querySelector('[data-lnum]');
        li.remove(); nx?.focus();
        const h = panel.querySelector('.p3-link')?.closest('.p3-card')?.querySelector('h4 small');
        if (h) { const us = data.events.filter((x) => x.team === 'us'); h.textContent = `우리 팀 기록 ${us.length}개 중 ${us.filter((x) => x.uid).length}개 연결 · 번호만 적고 Enter`; }
      };
    });
  }
  // 리포트 위: 확정 기록 기준 · 작업 시간 · 선수별(UID)
  function p3ReportHtml() {
    const ev = data.events; const ai = ev.filter((e) => e.src === 'ai').length; const nl = ev.filter((e) => !hasXY(e)).length;
    const us = ev.filter((e) => e.team === 'us'); const linked = us.filter((e) => e.uid);
    const ss = work.sessions.filter((s) => s.sec >= 5);
    const vs = Math.round(video?.duration || ss.find((s) => s.videoSec)?.videoSec || 0);
    const by = (m) => ss.filter((s) => s.mode === m).reduce((a, s) => a + s.sec, 0);
    const cs = cands(); const ok = cs.filter((c) => c.state === 'ok').length; const no = cs.filter((c) => c.state === 'no').length;
    const per = {};
    linked.forEach((e) => { const b = (per[e.uid] ||= { n: 0, shot: 0, goal: 0, win: 0, loss: 0, ok: 0, fail: 0 }); b.n++; if (SHOT_KS.includes(e.k)) b.shot++; if (e.k === 'goal' || e.res === 'goal') b.goal++; if (WIN_KS.includes(e.k)) b.win++; if (e.k === 'loss') b.loss++; if (e.res === 'ok') b.ok++; if (e.res === 'fail') b.fail++; });
    const rows = Object.entries(per).sort((a, b) => b[1].n - a[1].n);
    return `<section class="card p3-rep"><h3>확정 기록 기준 <small class="muted">AI 후보 중 코치님이 맞다고 고른 것만 들어가요</small></h3>
      <div class="rp-kpis"><div><b>${ev.length}</b><small>확정 기록</small></div><div><b>${ev.length - ai}</b><small>직접 기록</small></div><div><b>${ai}</b><small>AI 후보에서 확정</small></div><div><b>${nl}</b><small>위치 없음 (지도에서 빠짐)</small></div><div><b>${linked.length}/${us.length}</b><small>우리 팀 선수 연결</small></div>${cs.length ? `<div><b>${ok + no ? `${Math.round((ok / (ok + no)) * 100)}%` : '-'}</b><small>후보 맞은 비율 (${ok}/${ok + no})</small></div>` : ''}</div>
      <h4>작업 시간 <small class="muted">영상이 재생 중이거나 45초 안에 손을 댄 시간만 · 이 화면에서 잰 값</small></h4>
      ${ss.length ? `<table class="tbl p3-tbl"><tr><th>시작</th><th>방식</th><th>작업 시간</th><th>키 · 클릭</th><th>기록 추가 · 고침 · 지움</th><th>후보 맞음 · 아님</th><th>건너뛴 시간</th></tr>
        ${ss.slice(-8).reverse().map((s) => `<tr><td>${fmtWhen(s.start)}</td><td>${s.mode === 'assist' ? '후보 검토' : '직접 기록'}</td><td><b>${fmtDur(s.sec)}</b></td><td>${s.keys} · ${s.clicks}</td><td>${s.adds} · ${s.edits} · ${s.dels}</td><td>${s.candOk} · ${s.candNo}</td><td>${fmtDur(s.skipSec || 0)}</td></tr>`).join('')}</table>
        <p class="small">모두 <b>${fmtDur(by('manual') + by('assist'))}</b>${vs ? ` · 영상 ${fmtT(vs)} 기준 영상 1분당 <b>${((by('manual') + by('assist')) / (vs / 60)).toFixed(1)}분</b>` : ''}${by('manual') && by('assist') ? ` · 직접 기록 ${fmtDur(by('manual'))} / 후보 검토 ${fmtDur(by('assist'))}` : ''}</p>
        <p class="muted small">비교는 같은 길이의 경기를 한 번은 직접 기록, 한 번은 후보 검토로 해 봐야 정확해요. 한 경기 안의 숫자만으로는 줄었다고 말할 수 없어요.</p>` : '<p class="muted small">아직 잰 작업 시간이 없어요. 기록하기 · AI 후보 탭에서 작업하면 자동으로 재요.</p>'}
      ${rows.length ? `<h4>선수별 (연결된 기록) <small class="muted">선수를 누르면 그 선수의 성장 카드(IDP)로 가요</small></h4><table class="tbl p3-tbl"><tr><th>선수</th><th>관여</th><th>슈팅</th><th>골</th><th>성공/실패</th><th>탈취</th><th>뺏김</th></tr>${rows.map(([id, b]) => `<tr><td><a href="#/idp/${esc(id)}">${esc(nameOf(id) || id)}</a></td><td>${b.n}</td><td>${b.shot}</td><td>${b.goal}</td><td>${b.ok}/${b.fail}</td><td>${b.win}</td><td>${b.loss}</td></tr>`).join('')}</table>` : ''}
    </section>`;
  }

  // 영상 밑 키보드 그림: 실제 키보드 자리 그대로 · 눌러도 장면이 골라짐
  const KB_SHORT = { cross: '크로스 · 컷백', duel: '경합 · 태클', penalty: '페널티킥', offside: '오프사이드' };
  const KB_ROWS = [['1', '2', '3', '4', '5', '6'], ['Q', 'W', 'E', 'R', 'T'], ['A', 'S', 'D', 'F', 'G'], ['Z', 'X', 'C', 'V', 'B']];
  function drawKb() {
    const kb = el.querySelector('[data-kb]');
    const tips = el.querySelector('[data-tips]');
    if (!kb) return;
    const tk = P ? tplKinds() : null;
    kb.innerHTML = `<div class="kb-head"><b>단축키</b><span class="muted small">${P && tab === 'review' ? '후보가 맞으면 그 장면 키를 누르세요 · <b>N</b> 아님 · <b>L</b> 다음' : '한글 · 영어 상관없이 이 자리를 누르면 돼요 · 그림을 눌러도 골라져요'}${tk ? ` · 목적 <b>${TEMPLATES.find(([k]) => k === tpl)[1]}</b>에 쓰는 키만 진하게` : ''}</span></div>
      ${KB_ROWS.map((row, i) => `<div class="kb-row r${i}">${row.map((key) => { const k = KINDS.find((x) => x[2] === key); return k ? `<button type="button" class="kb-key g-${k[4]} ${k[0] === kind ? 'on' : ''} ${tk && !tk.has(k[0]) ? 'p3-dim' : ''}" data-kind="${k[0]}" style="--c:${k[3]}" title="${k[1]}"><b>${key}</b><span>${KB_SHORT[k[0]] || k[1]}</span></button>` : ''; }).join('')}</div>`).join('')}
      <div class="kb-row r4"><button type="button" class="kb-key fn" data-kbtab ${teams.length > 1 ? '' : 'disabled'}><b>Tab</b><span>${teams.length > 1 ? `지금 ${TEAM[team]} · 바꾸기` : `${TEAM[main]} 팀`}</span></button>
        <button type="button" class="kb-key fn space" data-kbplay><b>Space</b><span>재생 · 멈춤</span></button>
        <button type="button" class="kb-key fn" data-kbesc><b>Esc</b><span>취소</span></button>
        <button type="button" class="kb-key fn del ${delMode ? 'on' : ''}" data-kbdel><b>Del</b><span>기록 지우기</span></button></div>
      <div class="kb-legend">${KGROUPS.map(([g, gl]) => `<span><i style="background:${GCOLOR[g]}"></i>${gl}</span>`).join('')}<span class="muted">경기장 점에도 이 글자가 찍혀요 · ← → 5초 이동</span></div>`;
    kb.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => {
      b.blur();
      if (P && tab === 'review') { confirmCand(b.dataset.kind); return; }
      pickKind(b.dataset.kind);
      if (P && quick) quickAdd(b.dataset.kind);
    }));
    kb.querySelector('[data-kbtab]').onclick = (ev) => { if (teams.length > 1) pickTeam(team === 'opp' ? 'us' : 'opp'); ev.currentTarget.blur(); };
    kb.querySelector('[data-kbplay]').onclick = (ev) => { if (video) (video.paused ? video.play() : video.pause()); ev.currentTarget.blur(); };
    kb.querySelector('[data-kbesc]').onclick = (ev) => { pending = null; delMode = false; drawHint(); drawTagPitch(); drawStatus(); ev.currentTarget.blur(); };
    kb.querySelector('[data-kbdel]').onclick = (ev) => { toggleDel(); ev.currentTarget.blur(); };
    if (tips && !tips.innerHTML) tips.innerHTML = `<h4>이렇게 하면 빨라요</h4>
      <ol><li><b>Space</b>로 영상 재생 — 아래 속도를 <b>1.5x · 2x</b>로 올려 봐도 돼요</li>
        <li>장면이 나오면 <b>Space로 멈춤</b></li>
        <li>위 키보드 그림대로 <b>단축키</b>를 눌러 장면 고르기 (예: <kbd>Q</kbd> 슈팅 · <kbd>D</kbd> 볼 뺏김)</li>
        <li>오른쪽 경기장에서 <b>일어난 곳</b>을 누르기 — 패스 · 크로스 · 돌파는 <b>누른 채 공이 간 곳까지 끌어서</b> 놓으면 화살표로 남아요</li>
        <li>필요하면 결과 · 선수 번호만 고르고 <b>Space로 다시 재생</b></li>
        <li>잘못 눌렀으면 <kbd>Del</kbd>(또는 Backspace) → 경기장에서 <b>그 점</b>을 누르면 지워져요</li></ol>
      <p class="muted small"><b>시간</b>: 기록 시각은 영상의 실제 재생 위치로 저장돼서 <b>1.5x · 2x로 봐도 정확</b>해요. 하프마다 <b>킥오프 시각</b>만 맞춰 두면 리포트에 '전반 15분'처럼 경기 시간으로 나와요.</p>
      <p class="muted small"><b>전반 · 후반</b>: 하프가 시작하는 순간 <b>지금이 킥오프</b>를 눌러 두면 그 뒤 기록은 자동으로 나뉘고, 후반엔 공격 방향도 자동으로 바뀌어요.</p>
      <p class="muted small">유튜브 화면 안을 누르면 단축키가 유튜브로 가요 — 경기장이나 키보드 그림을 한 번 누르면 다시 돼요.</p>`;
  }
  function drawHint() {
    el.querySelector('[data-kbdel]')?.classList.toggle('on', delMode);
    const box = panel.querySelector('[data-hint]');
    if (!box) return;
    const lineK = LINE_KINDS.includes(kind);
    box.innerHTML = !video ? '영상을 열면 기록할 수 있어요.'
      : delMode ? '<b class="ma-delhint">지우기</b> — 경기장에서 <b>지울 점</b>을 누르세요 (최근 30초 안의 기록이 보여요 · 예전 기록은 아래 목록의 ✕) · <kbd>Esc</kbd> 취소'
      : pending ? `<b>끝 지점</b>을 누르세요 — 공(또는 선수)이 간 곳 · <kbd>Esc</kbd> 취소`
      : P && quick ? `<b>빠른 기록</b> — 단축키를 누르면 지금 영상 시각(${fmtT(t())})으로 <b>바로 기록</b>돼요. 위치를 남기려면 <b>6초 안에</b> 아래 경기장을 누르세요 (안 눌러도 돼요 · 지도에서만 빠져요)${(tpl === 'player' || tpl === 'gk') && tplUid ? ` · 우리 팀 기록은 <b>${esc(nameOf(tplUid))}</b> 선수로 연결` : ''}.`
        : `<b>${KIND[kind].l}</b>(${TEAM[team]})을 고른 채로 아래 경기장에서 <b>일어난 곳</b>을 누르세요${lineK ? ' — 공이 간 곳까지 보여 주려면 <b>누른 채 끝 지점까지 끌어서</b> 놓으세요' : ''}. 지금 영상 시각(${fmtT(t())})으로 기록돼요${detailOn ? ' — 아래에서 결과 · 발 · 번호를 더 고를 수 있어요' : ''}.`;
  }
  // 방금 기록한 장면: 결과 · 발 · 높이 · 번호를 바로 고름 (안 골라도 돼요)
  function drawDetail() {
    const box = panel.querySelector('[data-detail]');
    if (!box) return;
    const e = data.events.find((x) => x.id === lastId);
    if (!e || (!detailOn && !box.dataset.force)) { box.innerHTML = ''; delete box.dataset.force; return; }
    delete box.dataset.force;
    const ds = DETAILS_OF[e.k] || [];
    box.innerHTML = `<div class="ma-dhead"><span class="ma-tag" style="--c:${KIND[e.k].c}">${KIND[e.k].l}</span><b>${TEAM[e.team]}</b><small>${matchMin(e)} · ${hasXY(e) ? `${third(e.x)} · ${channel(e.y)}` : '위치 없음'}${e.x2 != null ? ' · 끝 지점 있음' : ''}${e.src === 'ai' ? ' · AI 후보에서 확정' : ''}</small><span class="muted small">방금 기록 — 더 자세히 (안 골라도 돼요)</span></div>
      ${ds.map((d) => `<div class="ma-drow"><span>${DETAIL[d][0]}</span>${DETAIL[d][1].map(([v, l]) => `<button type="button" class="chip ${e[fieldOf(d)] === v ? 'active' : ''}" data-dv="${d}:${v}">${l}</button>`).join('')}</div>`).join('')}
      <div class="ma-drow"><span>선수 번호</span><input data-dnum value="${esc(e.num || '')}" maxlength="3" inputmode="numeric" placeholder="예) 7"><span class="muted small">${e.team === 'us' ? '우리' : '상대'} 선수 번호를 적으면 리포트에 선수별로 모여요${P && e.team === 'us' && roster.length ? ' · 우리 팀은 번호가 명단과 맞으면 선수와 자동 연결' : ''}</span></div>
      ${P && e.team === 'us' && roster.length ? `<div class="ma-drow p3-who"><span>선수 연결</span>${roster.map((m) => `<button type="button" class="chip ${e.uid === m.id ? 'active' : ''}" data-duid="${m.id}">${esc(numOf(m) ? `${numOf(m)} ` : '')}${esc(m.name || '')}</button>`).join('')}</div>` : ''}
      ${e.k === 'note' || e.text ? `<div class="ma-drow"><span>메모</span><input data-dtext value="${esc(e.text || '')}" maxlength="80" placeholder="메모"></div>` : ''}`;
    box.querySelectorAll('[data-dv]').forEach((b) => (b.onclick = () => {
      const [d, v] = b.dataset.dv.split(':'); const f = fieldOf(d);
      snap(); W?.count('edits');
      if (e[f] === v) delete e[f]; else e[f] = v;
      logEdit('detail', e, { [f]: e[f] ?? null });
      save(); drawDetail(); drawLog(); drawLive();
    }));
    box.querySelectorAll('[data-duid]').forEach((b) => (b.onclick = () => {
      snap(); W.count('edits');
      const m = roster.find((x) => x.id === b.dataset.duid);
      if (e.uid === m.id) { delete e.uid; } else { e.uid = m.id; if (numOf(m)) e.num = numOf(m); }
      logEdit('uid', e, { uid: e.uid || null }); save(); drawDetail(); drawLog();
    }));
    const ni = box.querySelector('[data-dnum]');
    ni.onfocus = () => snap();
    ni.oninput = () => {
      const v = ni.value.trim().slice(0, 3); if (v) e.num = v; else delete e.num;
      if (P && e.team === 'us') { const m = byNum(v); if (m) e.uid = m.id; else if (e.uid && !v) delete e.uid; }
      save(); drawLog();
    };
    ni.onkeydown = (ev) => { if (ev.key === 'Enter') ni.blur(); ev.stopPropagation(); };
    const ti = box.querySelector('[data-dtext]');
    if (ti) { ti.oninput = () => { e.text = ti.value.trim().slice(0, 80); save(); drawLog(); }; ti.onkeydown = (ev) => ev.stopPropagation(); }
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
    if (box) box.innerHTML = liveHtml(data.events.filter((e) => halfOf(e) === half), main, HALF[half]);
  }
  const lineSvg = (x1, y1, x2, y2, c) => `<line x1="${(x1 * 105).toFixed(1)}" y1="${(y1 * 68).toFixed(1)}" x2="${(x2 * 105).toFixed(1)}" y2="${(y2 * 68).toFixed(1)}" stroke="${c}" stroke-width=".55" stroke-linecap="round" marker-end="url(#ma-ah)" opacity=".9"/>`;
  function drawTagPitch() {
    const box = panel.querySelector('[data-pitch]');
    if (!box) return;
    const now = t();
    // 최근 30초의 기록은 화면 방향 그대로 점으로 (끝 지점이 있으면 화살표)
    const shown = () => data.events.filter((e) => hasXY(e) && halfOf(e) === half && Math.abs(e.t - t()) <= 30);
    const shownEv = shown();
    const recent = shownEv.map((e) => {
      const d0 = dirOf(halfOf(e));
      const [sx, sy] = toScreen(e.x, e.y, e.team, d0);
      const ln = e.x2 != null ? (() => { const [ex, ey] = toScreen(e.x2, e.y2, e.team, d0); return lineSvg(sx, sy, ex, ey, KIND[e.k].c); })() : '';
      return ln + dot(sx, sy, KIND[e.k].c, 1.5, `stroke="${e.team === 'opp' ? '#fff' : '#000'}" stroke-width=".3"`) + (KIND[e.k].key ? `<text x="${(sx * 105).toFixed(1)}" y="${(sy * 68 + 0.68).toFixed(1)}" class="ma-mk">${KIND[e.k].key}</text>` : '');
    }).join('');
    const pend = pending ? (() => { const [sx, sy] = toScreen(pending.x, pending.y, pending.team, dirOf(pending.half)); return dot(sx, sy, KIND[pending.k].c, 2, 'stroke="#fff" stroke-width=".6" class="ma-pend"'); })() : '';
    const arrow = dirArrow() === '→' ? `${dirLabel()} →` : `← ${dirLabel()}`;
    // 경기장은 한 번만 그리고, 재생 중엔 점만 바꿈 (다시 그리면 누르는 도중 클릭이 사라졌음)
    let svg = box.querySelector('svg.tag');
    const fresh = !svg;
    if (fresh) {
      box.innerHTML = pitchSvg('<defs><marker id="ma-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill="#fff"/></marker></defs><g data-dots></g>', { cls: 'tag' });
      svg = box.querySelector('svg');
    }
    svg.querySelector('[data-dots]').innerHTML = `${recent}${pend}<text x="52.5" y="4.5" class="ma-dirtxt">${arrow}</text>`;
    svg.classList.toggle('wait-end', !!pending); svg.classList.toggle('del-mode', !!delMode);
    if (!fresh) return;
    // 누르기 = 그 자리 기록 · 누른 채 끌어서 놓기 = 시작점 → 공이 간 끝 지점까지 한 번에
    const toPitch = (ev) => { const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const p = pt.matrixTransform(svg.getScreenCTM().inverse()); return [Math.min(1, Math.max(0, p.x / 105)), Math.min(1, Math.max(0, p.y / 68))]; };
    let down = null; let rubber = null;
    svg.onpointerdown = (ev) => {
      if (ev.button !== 0) return;
      down = toPitch(ev);
      try { svg.setPointerCapture(ev.pointerId); } catch { /* */ }
    };
    svg.onpointermove = (ev) => {
      if (!down || delMode) return;
      const [mx, my] = toPitch(ev);
      if (Math.hypot((mx - down[0]) * 105, (my - down[1]) * 68) < 2.5) return;
      if (!rubber) { rubber = document.createElementNS('http://www.w3.org/2000/svg', 'line'); rubber.setAttribute('class', 'ma-rubber'); svg.appendChild(rubber); }
      rubber.setAttribute('x1', down[0] * 105); rubber.setAttribute('y1', down[1] * 68); rubber.setAttribute('x2', mx * 105); rubber.setAttribute('y2', my * 68);
      rubber.setAttribute('stroke', KIND[kind].c);
    };
    svg.onpointercancel = () => { down = null; rubber?.remove(); rubber = null; };
    svg.onpointerup = (ev) => {
      if (!down) return;
      const start = down; down = null; rubber?.remove(); rubber = null;
      const [ex, ey] = toPitch(ev);
      const dragged = Math.hypot((ex - start[0]) * 105, (ey - start[1]) * 68) >= 2.5;
      tapAt(start[0], start[1], dragged ? [ex, ey] : null);
    };
    const tapAt = (sx, sy, end) => {
      if (!video) return toast('먼저 경기 영상을 열어 주세요.');
      if (delMode) { // 지우기: 누른 곳에서 가장 가까운 점 (지금 보이는 기록 중)
        const near = shown().map((e) => { const [ex, ey] = toScreen(e.x, e.y, e.team, dirOf(halfOf(e))); return { e, d: Math.hypot((ex - sx) * 105, (ey - sy) * 68) }; }).sort((a, b) => a.d - b.d)[0];
        delMode = false;
        if (!near || near.d > 4) { toast('그 자리에 지울 점이 없어요. 점을 정확히 눌러 주세요.'); drawHint(); drawTagPitch(); drawStatus(); return; }
        snap(); W?.count('dels'); logEdit('del', near.e);
        data.events = data.events.filter((x) => x.id !== near.e.id);
        if (lastId === near.e.id) lastId = null;
        save(); drawHint(); drawTagPitch(); drawDetail(); drawLog(); drawLive(); drawMarks();
        el.querySelector('.ma-h small').textContent = `${data.events.filter((x) => halfOf(x) === half).length}개`;
        flash = { ...near.e, del: true, at: Date.now() }; drawStatus(); setTimeout(drawStatus, 2600);
        return;
      }
      // 빠른 기록 뒤 6초 안: 방금 기록에 위치만 붙임
      if (P && lastId && Date.now() - quickAt < 6000) {
        const le = data.events.find((x0) => x0.id === lastId);
        if (le && !hasXY(le)) {
          snap();
          const [lx, ly] = toStore(sx, sy, le.team, dirOf(halfOf(le))); le.x = r3(lx); le.y = r3(ly);
          if (end) { const [x2, y2] = toStore(end[0], end[1], le.team, dirOf(halfOf(le))); le.x2 = r3(x2); le.y2 = r3(y2); }
          quickAt = 0; W.count('edits'); logEdit('loc', le);
          save(); drawHint(); drawTagPitch(); drawDetail(); drawLog(); drawLive();
          return;
        }
      }
      const [x, y] = toStore(sx, sy, team, dirOf(half));
      const e = { id: uid(), t: +t().toFixed(1), half, team, k: kind, x: r3(x), y: r3(y) };
      if (end) { const [x2, y2] = toStore(end[0], end[1], team, dirOf(half)); e.x2 = r3(x2); e.y2 = r3(y2); } // 끌어서 놓은 곳 = 공이 간 끝 지점
      if (kind === 'note') { const s0 = prompt('메모'); if (!s0) return; e.text = s0.slice(0, 80); }
      addEvent(e);
    };
  }
  function addEvent(e, { nosnap = false } = {}) {
    if (P) {
      if (!nosnap) snap();
      // '선수 한 명' · '골키퍼' 템플릿: 우리 팀 기록은 고른 선수로 바로 연결
      if ((tpl === 'player' || tpl === 'gk') && tplUid && e.team === 'us' && !e.uid) { e.uid = tplUid; const m = roster.find((x) => x.id === tplUid); if (m && numOf(m)) e.num = numOf(m); }
      W.count('adds'); if (e.src !== 'ai') logEdit('add', e);
    }
    // 후반 킥오프 시각을 맞춰 뒀으면 영상 시각으로 전반 · 후반을 자동으로
    const h2 = data.halfStart[2];
    if (h2 != null && h2 > (data.halfStart[1] || 0)) { e.half = e.t >= h2 ? 2 : 1; if (e.half !== half) { half = e.half; setTimeout(drawTag, 0); } }
    data.events.push(e);
    data.events.sort((a, b) => a.t - b.t);
    lastId = e.id;
    save(); drawHint(); drawTagPitch(); drawDetail(); drawLog(); drawLive();
    const hc = el.querySelector('.ma-h small'); if (hc) hc.textContent = `${data.events.filter((x) => halfOf(x) === half).length}개`;
    if (P) { const u = el.querySelector('[data-p3undo]'); if (u) u.disabled = false; }
    tagged(e);
  }
  function drawLog() {
    const box = panel.querySelector('[data-log]');
    if (!box) return;
    const list = data.events.filter((e) => halfOf(e) === half).reverse().slice(0, 300); // 지금 하프 기록만 (다른 하프는 위 전반 · 후반으로)
    const mf = minuteFn(data.events, data.halfStart);
    box.innerHTML = list.map((e) => `<li data-ev="${e.id}" class="${e.id === lastId ? 'new' : ''}"><i class="ma-hf h${halfOf(e)}">${HALF[halfOf(e)][0]}</i><button class="link-btn ma-min" data-go="${e.t}" title="영상 ${fmtT(e.t)}">${Math.floor(mf(e))}′</button>
      <span class="ma-tag" style="--c:${KIND[e.k].c}">${KIND[e.k].l}</span><b>${TEAM[e.team]}</b>
      <small>${hasXY(e) ? `${third(e.x)} · ${channel(e.y)}` : '위치 없음'}${detailText(e) ? ` · ${esc(detailText(e))}` : ''}${e.text ? ` · ${esc(e.text)}` : ''}${e.uid && nameOf(e.uid) ? ` · <b class="p3-name">${esc(nameOf(e.uid))}</b>` : ''}${e.src === 'ai' ? ' · <i class="p3-src">AI 후보에서</i>' : ''}</small>${canEdit ? '<button class="link-btn small" data-pick>고치기</button><button class="link-btn small" data-rm>✕</button>' : ''}</li>`).join('') || '<li class="muted">아직 기록이 없어요.</li>';
    // 새 기록이 보이게 — 페이지 전체가 아니라 기록 목록 안에서만 스크롤 (영상이 화면 밖으로 밀리지 않게)
    const li = box.querySelector('li.new');
    if (li && box.scrollHeight > box.clientHeight) box.scrollTop += li.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 2;
    box.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { if (video) { video.currentTime = Math.max(0, +b.dataset.go - 3); video.play(); } }));
    box.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { lastId = b.closest('li').dataset.ev; panel.querySelector('[data-detail]').dataset.force = '1'; drawDetail(); drawLog(); panel.querySelector('[data-detail]').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }));
    box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => {
      const id = b.closest('li').dataset.ev;
      snap(); W?.count('dels'); logEdit('del', data.events.find((x) => x.id === id));
      data.events = data.events.filter((x) => x.id !== id);
      save(); drawTag(); drawMarks(); drawStatus();
    }));
  }

  // 단축키
  // 장면 · 팀 고르기는 화면 전체를 다시 그리지 않고 표시만 바꿈 (단축키가 바로바로 먹게)
  const pickKind = (k) => {
    kind = k; pending = null;
    el.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === k));
    drawHint(); drawTagPitch();
  };
  const pickTeam = (tm) => {
    team = tm; pending = null;
    panel.querySelectorAll('[data-tm]').forEach((b) => b.classList.toggle('on', b.dataset.tm === tm));
    const tb = el.querySelector('[data-kbtab] span'); if (tb) tb.textContent = `지금 ${TEAM[team]} · 바꾸기`;
    drawHint(); drawTagPitch();
  };
  const toggleDel = () => { delMode = !delMode; pending = null; drawHint(); drawTagPitch(); drawStatus(); };
  const typing = (t0) => !!t0?.closest?.('textarea, [contenteditable], input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button])');
  const onKey = (e) => {
    if (!(tab === 'tag' || (P && tab === 'review')) || typing(e.target) || document.querySelector('.modal-wrap')) return;
    // 시제품: Ctrl(⌘)+Z 되돌리기 · Ctrl(⌘)+Shift+Z 또는 Ctrl+Y 다시 하기
    if (P && (e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) { e.preventDefault(); if (e.code === 'KeyY' || e.shiftKey) redo(); else undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    W?.count('keys');
    // 체크박스 · 속도 선택 · 버튼에 남은 포커스가 단축키를 먹지 않게
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae.matches?.('button, select, input[type=checkbox], input[type=range]')) ae.blur();
    if (e.key === ' ' || e.code === 'Space') { if (!video) return; e.preventDefault(); if (!e.repeat) (video.paused ? video.play() : video.pause()); return; }
    if (e.key === 'ArrowRight' && video) { e.preventDefault(); video.currentTime = t() + 5; return; }
    if (e.key === 'ArrowLeft' && video) { e.preventDefault(); video.currentTime = Math.max(0, t() - 5); return; }
    if (P && tab === 'review' && reviewKey(e)) return;
    if (e.key === 'Escape' && (pending || delMode)) { pending = null; delMode = false; drawHint(); drawTagPitch(); drawStatus(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); toggleDel(); return; }
    if (e.key === 'Tab') { e.preventDefault(); if (teams.length > 1 && !e.repeat) { pickTeam(team === 'opp' ? 'us' : 'opp'); if (P && tab === 'review') { const c = panel.querySelector('[data-cur]'); if (c) c.innerHTML = curHtml(); bindReview(); } } return; }
    const hit = KEY_OF[e.code]; // e.code: 한글 자판이어도 'KeyQ'
    if (hit) {
      e.preventDefault();
      if (P && tab === 'review') { if (!e.repeat) confirmCand(hit); return; }
      if (P && quick) { if (!e.repeat) { pickKind(hit); quickAdd(hit); } return; }
      if (hit !== kind || pending) pickKind(hit);
    }
  };
  if (canEdit) { document.addEventListener('keydown', onKey, true); state.cleanup.push(() => document.removeEventListener('keydown', onKey, true)); }

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
        </div>
        <p class="muted small">코치님이 직접 정해요: <b>포메이션을 고르면</b> 자리마다 칸이 생겨요 → 칸에 <b>등번호</b>를 적어요. 공격할 때 · 수비할 때 서는 모양이 다르면 <b>공격 시 · 수비 시</b>도 따로 정해요 (비워 두면 기본과 같아요).</p>` : ''}
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

  // ───────── 리포트: 기록 · 자동 분석 · 포메이션 · 키 플레이어를 한 번에 ─────────
  let rteam = main;
  let rhalf = 'all'; // 리포트: 전체 · 전반(1) · 후반(2)
  function drawReport() {
    const evs = rhalf === 'all' ? data.events : data.events.filter((e) => halfOf(e) === rhalf);
    const A = deepAnalysis(evs, rteam, { hs: data.halfStart, view: rhalf });
    const { ev, other, atk, ch, pct, shots, goals, crosses, losses, set, wins, flow, heatSvg, oursSide } = A.R;
    const opp = rteam === 'opp';
    const col = opp ? '#e5484d' : '#4ea1ff';
    const bar = (l, n) => `<div class="ma-bar"><span>${l}${opp && l !== '가운데' ? `<small>${oursSide(l)}</small>` : ''}</span><div><i style="width:${pct(n)}%"></i></div><b>${pct(n)}%</b><small>${n}</small></div>`;
    const gOf = (tm, h) => data.events.filter((e) => e.team === tm && (e.k === 'goal' || e.res === 'goal') && (!h || halfOf(e) === h)).length;
    const gUs = gOf('us'); const gOpp = gOf('opp');
    // 전반 vs 후반 한눈에
    const cmp = [1, 2].map((h) => { const r0 = computeReport(data.events.filter((e) => halfOf(e) === h), rteam); return { h, atk: r0.atk.length, sh: r0.shots.length, g: r0.goals.length, xg: r0.xg, win: r0.wins.length, loss: r0.losses.length, set: r0.set.length, n: r0.ev.length }; });
    const lus = PHASES.filter(([ph]) => data.lineups?.[rteam]?.[ph]?.f);
    const lineMap = (list, c) => list.filter((e) => hasXY(e) && e.x2 != null).map((e) => `<line x1="${(e.x * 105).toFixed(1)}" y1="${(e.y * 68).toFixed(1)}" x2="${(e.x2 * 105).toFixed(1)}" y2="${(e.y2 * 68).toFixed(1)}" stroke="${c}" stroke-width=".5" marker-end="url(#rp-ah)" opacity=".85"/>`).join('') + list.filter(hasXY).map((e) => dot(e.x, e.y, c, 1)).join('');
    const ah = '<defs><marker id="rp-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill="#fff"/></marker></defs>';
    const ranked = A.sections.find((x) => x.table)?.table || [];
    const rmf = minuteFn(data.events, data.halfStart); // 기록 목록: 경기 시간(킥오프 기준)
    panel.innerHTML = `
      <div class="ma-row">${teams.length > 1 ? `<div class="seg">${teams.map((k) => `<button class="${k === rteam ? 'on' : ''}" data-rt="${k}">${TEAM[k]} 팀 리포트</button>`).join('')}</div>` : ''}
        <div class="seg">${[['all', '전체'], [1, '전반'], [2, '후반']].map(([k, l]) => `<button class="${k === rhalf ? 'on' : ''}" data-rh="${k}">${l}</button>`).join('')}</div>
        <span class="muted small">그림은 모두 <b>${TEAM[rteam]} 팀이 오른쪽(→)으로 공격</b>하는 방향이에요</span>${canEdit ? '<button class="btn ghost sm" data-print>PDF · 인쇄</button>' : ''}</div>
      <section class="card rp-head" style="--c:${col}">
        <div><span class="eyebrow">MATCH REPORT</span><h2>${esc(post.title || '경기분석')}</h2><p class="muted small">${esc([post.opponent && `vs ${post.opponent}`, post.date, `${data.size} vs ${data.size}`].filter(Boolean).join(' · '))} · 기록 ${data.events.length}개</p></div>
        ${data.target === 'both' ? `<div class="rp-score"><span>우리</span><b>${gUs} : ${gOpp}</b><span>상대</span><small>전반 ${gOf('us', 1)}:${gOf('opp', 1)} · 후반 ${gOf('us', 2)}:${gOf('opp', 2)}</small></div>` : ''}
      </section>
      ${P ? p3ReportHtml() : ''}
      ${!data.events.length ? empty('아직 기록이 없어요. 기록하기에서 장면을 기록하면 리포트가 자동으로 만들어져요.') : ''}
      ${rhalf === 'all' && data.events.length ? `<section class="card rp-cmp"><h3>전반 vs 후반 <small class="muted">${TEAM[rteam]} 팀</small></h3>
        <table class="tbl"><tr><th></th>${[['공격 장면', 'atk'], ['슈팅', 'sh'], ['득점', 'g'], ['기대 득점', 'xg'], ['공 따냄', 'win'], ['공 잃음', 'loss'], ['세트피스', 'set']].map(([l]) => `<th>${l}</th>`).join('')}</tr>
        ${cmp.map((c) => `<tr><td><b>${HALF[c.h]}</b></td>${['atk', 'sh', 'g', 'xg', 'win', 'loss', 'set'].map((k) => { const o = cmp.find((x) => x.h !== c.h)[k]; const v = c[k]; const better = k === 'loss' ? v < o : v > o; return `<td class="${v !== o && better ? 'up' : ''}">${k === 'xg' ? v.toFixed(1) : v}</td>`; }).join('')}</tr>`).join('')}</table></section>` : ''}
      <section class="rp-ai">
        <div class="rp-aihead"><h3>자동 분석</h3><small class="muted">기록한 장면 ${A.n}개로 계산했어요 · 결과 · 발 · 번호 · 끝 지점을 적을수록 더 정확해져요</small></div>
        <div class="rp-sw">
          <div class="rp-swc good"><h4>${opp ? '상대 강점' : '우리 강점'}</h4>${A.strong.length ? `<ul>${[...new Set(A.strong)].map((x) => `<li>${x}</li>`).join('')}</ul>` : '<p class="muted small">기록이 더 쌓이면 나와요</p>'}</div>
          <div class="rp-swc bad"><h4>${opp ? '상대 약점 · 우리 기회' : '우리 약점'}</h4>${A.weak.length ? `<ul>${[...new Set(A.weak)].map((x) => `<li>${x}</li>`).join('')}</ul>` : '<p class="muted small">기록이 더 쌓이면 나와요</p>'}</div>
          <div class="rp-swc todo"><h4>${opp ? '우리가 준비할 것' : '훈련 추천'}</h4>${A.todo.length ? `<ol>${[...new Set(A.todo)].map((x) => `<li>${x}</li>`).join('')}</ol>` : '<p class="muted small">기록이 더 쌓이면 나와요</p>'}</div>
        </div>
        <div class="rp-secs">${A.sections.map((x, i) => `<article class="card rp-sec ${x.items.length ? '' : 'empty'}">
          <header><span class="rp-no">${i + 1}</span><h4>${x.t}</h4></header>
          ${x.k ? `<div class="rp-kpis">${x.k.map(([l, v]) => `<div><b>${v}</b><small>${l}</small></div>`).join('')}</div>` : ''}
          ${x.items.length ? `<ul class="rp-points">${x.items.map((it) => `<li>${it}</li>`).join('')}</ul>` : '<p class="muted small">이 부분은 아직 기록이 없어요</p>'}
        </article>`).join('')}</div>
      </section>
      <div class="ma-grid rp-two">
        <section class="card"><h3>${TEAM[rteam]} 포메이션 <small>${data.size} vs ${data.size}</small></h3>
          ${lus.length ? `<div class="lu-views">${lus.map(([ph, l]) => `<div><h4>${l} · <b>${esc(data.lineups[rteam][ph].f)}</b></h4>${lineupHtml(data.lineups[rteam][ph], { color: col, keys: data.keys[rteam] || [] })}</div>`).join('')}</div>` : `<p class="muted small">아직 포메이션이 없어요.${canEdit ? ' <button class="link-btn small" data-goto-f>포메이션 정하기</button>' : ''}</p>`}</section>
        <section class="card"><h3>${TEAM[rteam]} 키 플레이어</h3>${keysView(rteam) || '<p class="muted small">아직 적은 키 플레이어가 없어요. 기록하기 아래에서 적어요.</p>'}
          ${ranked.length ? `<h4>선수별 기록 <small class="muted">번호를 적은 장면만</small></h4><table class="tbl rp-ptbl"><tr><th>번호</th><th>관여</th><th>슈팅</th><th>골</th><th>성공/실패</th><th>뺏김</th><th>탈취</th></tr>${ranked.slice(0, 12).map(([n, b]) => `<tr><td><b>${esc(n)}</b></td><td>${b.n}</td><td>${b.shot}</td><td>${b.goal}</td><td>${b.ok}/${b.fail}</td><td>${b.loss}</td><td>${b.win}</td></tr>`).join('')}</table>` : ''}</section>
      </div>
      <div class="ma-grid">
        <section class="card"><h3>공격 방향 <small>공격 장면 ${atk.length}개</small></h3>${bar('왼쪽', ch['왼쪽'])}${bar('가운데', ch['가운데'])}${bar('오른쪽', ch['오른쪽'])}</section>
        <section class="card"><h3>위험 지역 <small>공격이 많이 일어난 곳</small></h3>${pitchSvg(heatSvg)}</section>
        <section class="card"><h3>슈팅 지도 <small>● 크기 = 기대 득점 · ★ 득점</small></h3>${pitchSvg(shots.filter(hasXY).map((e) => (e.k === 'goal' || e.res === 'goal' ? `<text x="${(e.x * 105).toFixed(1)}" y="${(e.y * 68 + 1.6).toFixed(1)}" class="star">★</text>` : dot(e.x, e.y, ['on', 'post'].includes(e.res) ? '#ffd400' : '#9a8a3a', 0.8 + xgOf(e) * 4))).join(''), { half: true })}</section>
        <section class="card"><h3>크로스 · 컷백 <small>끝 지점을 찍은 건 화살표</small></h3>${pitchSvg(ah + lineMap(crosses, '#ff9f0a'), { half: true })}</section>
        <section class="card"><h3>패스 · 돌파 경로 <small>끝 지점을 찍은 장면</small></h3>${pitchSvg(ah + lineMap(ev.filter((e) => [...PASS_KS, 'dribble', 'counter'].includes(e.k) && e.x2 != null), '#4ea1ff'))}</section>
        <section class="card"><h3>공을 잃은 곳 <small>${opp ? '압박 포인트' : '보완할 곳'}</small></h3>${pitchSvg(losses.filter(hasXY).map((e) => dot(e.x, e.y, '#ff3b30', 1.2)).join(''))}</section>
        <section class="card"><h3>공을 따낸 곳 <small>압박 · 탈취 · 인터셉트</small></h3>${pitchSvg(wins.filter(hasXY).map((e) => dot(e.x, e.y, '#bf5af2', 1.2)).join(''))}</section>
        <section class="card"><h3>시간대별 공격 <small>${rhalf === 'all' ? '하프마다 15분' : `${HALF[rhalf]} 5분`} 단위 · ${TEAM[rteam]} / ${TEAM[other]}</small></h3>
          <div class="ma-flow">${flow.map((f, i) => { const a0 = f.es.filter((e) => e.team === rteam).length; const b0 = f.es.filter((e) => e.team === other).length; const mx = Math.max(1, ...flow.map((x) => x.es.length)); return `<div class="${i && f.h !== flow[i - 1].h ? 'ht' : ''}"><div class="cols"><i class="a" style="height:${(a0 / mx) * 100}%"></i><i class="b" style="height:${(b0 / mx) * 100}%"></i></div><small>${rhalf === 'all' ? `${f.from === 0 ? `${HALF[f.h]} ` : ''}${f.from}′` : `${f.from}′`}</small></div>`; }).join('')}</div></section>
      </div>
      <details class="card rp-log" ${canEdit ? '' : 'open'}><summary><b>전체 기록</b> <small class="muted">${ev.length}개 · ${TEAM[rteam]} 팀</small></summary>
        <ul class="list ma-log rp-loglist">${ev.map((e) => `<li>${timeUrl(linkNow(), 0) ? `<a class="small ma-min" href="${esc(timeUrl(linkNow(), Math.max(0, Math.floor(e.t) - 3)))}" target="_blank" rel="noopener" title="영상 ${fmtT(e.t)} — 눌러서 이 장면 보기">${Math.floor(rmf(e))}′ ↗</a>` : `<span class="small ma-min" title="영상 ${fmtT(e.t)}">${Math.floor(rmf(e))}′</span>`}<i class="ma-hf h${halfOf(e)}">${HALF[halfOf(e)][0]}</i><span class="ma-tag" style="--c:${KIND[e.k].c}">${KIND[e.k].l}</span><small>${hasXY(e) ? `${third(e.x)} · ${channel(e.y)}` : '위치 없음'}${detailText(e) ? ` · ${esc(detailText(e))}` : ''}${e.text ? ` · ${esc(e.text)}` : ''}</small></li>`).join('') || '<li class="muted">기록이 없어요.</li>'}</ul></details>`;
    panel.querySelectorAll('[data-rt]').forEach((b) => (b.onclick = () => { rteam = b.dataset.rt; drawReport(); }));
    panel.querySelectorAll('[data-rh]').forEach((b) => (b.onclick = () => { rhalf = b.dataset.rh === 'all' ? 'all' : +b.dataset.rh; drawReport(); }));
    panel.querySelector('[data-goto-f]')?.addEventListener('click', () => setTab('formation'));
    panel.querySelector('[data-print]')?.addEventListener('click', () => window.print());
  }

  setTab(tab);
  if (canEdit && !sample) {
    try {
      if (!localStorage.getItem('ssaka.ma.tour')) {
        localStorage.setItem('ssaka.ma.tour', '1');
        setTimeout(() => tour([
          ['.ma-kb', '① 영상 아래 <b>키보드 그림</b>대로 단축키를 누르거나 그림을 눌러 <b>어떤 장면</b>인지 고르세요'],
          ['.ma-tagpitch', '② 영상을 보다가 그 장면이 <b>일어난 곳</b>을 경기장에서 누르세요. 화면에 보이는 그대로요!'],
          ['[data-live]', '③ 누른 뒤 아래 칸에서 <b>결과 · 발 · 선수 번호</b>를 더 고르면 리포트가 더 자세해져요. <b>저장</b>하면 리포트로 한 번에 정리돼요'],
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
export function liveHtml(events, tm = 'opp', label = '') {
  const r = computeReport(events, tm);
  const n = r.atkL.length;
  const bar = (l) => `<div class="ma-bar"><span>${l}${l !== '가운데' ? `<small>${r.oursSide(l)}</small>` : ''}</span><div><i style="width:${r.pct(r.ch[l])}%"></i></div><b>${r.pct(r.ch[l])}%</b><small>${r.ch[l]}</small></div>`;
  return `<div class="card ma-livecard"><h4>실시간 리포트 <small>${label ? `${label} · ` : ''}${TEAM[tm]} 팀 · 기록 ${events.filter((e) => e.team === tm).length}개</small></h4>
    ${n ? `${bar('왼쪽')}${bar('가운데')}${bar('오른쪽')}${r.summary[0] ? `<p class="ma-livesum">${r.summary[0]}</p>` : ''}` : '<p class="muted small">상대 공격 · 크로스 · 슈팅을 기록하면 여기서 바로 공격 방향이 계산돼요.</p>'}</div>`;
}

// 슈팅 기대 득점 (거리 · 각도로 어림, 헤더는 낮게 · 페널티킥 0.76)
export function xgOf(e) {
  if (e.k === 'penalty') return 0.76;
  const dx = Math.max(0.5, (1 - e.x) * 105); const dy = (e.y - 0.5) * 68;
  const d = Math.hypot(dx, dy);
  const ang = Math.atan2(7.32 * dx, dx * dx + dy * dy - (7.32 / 2) ** 2);
  let v = 1 / (1 + Math.exp(-(-1.2 + 1.6 * (ang < 0 ? ang + Math.PI : ang) - 0.09 * d)));
  if (e.foot === 'H') v *= 0.6;
  return Math.min(0.95, Math.max(0.01, v));
}
// 전반 · 후반: 기록할 때 고른 하프 (예전 기록은 45분 넘으면 후반으로 봄)
export const halfOf = (e) => e.half || (e.t >= 2700 ? 2 : 1);
const HALF = { 1: '전반', 2: '후반' };
// 하프 안에서 몇 분: 킥오프 시각(hs)이 있으면 그 기준, 없으면 전반은 영상 처음 · 후반은 후반 첫 기록 기준
function minuteFn(events, hs = {}) {
  const f2 = Math.min(Infinity, ...events.filter((e) => halfOf(e) === 2).map((e) => e.t));
  return (e) => { const h = halfOf(e); const base = hs?.[h] != null ? hs[h] : h === 1 ? 0 : (isFinite(f2) ? f2 : 0); return Math.max(0, (e.t - base) / 60); };
}
const ATTACK_KS = ['attack', 'cross', 'cutback', 'shot', 'goal', 'dribble', 'through', 'chance', 'counter'];
const SHOT_KS = ['shot', 'goal', 'penalty'];
const SET_KS = ['corner', 'freekick', 'throw', 'penalty', 'setpiece'];
const PASS_KS = ['buildup', 'prog', 'through', 'long', 'attack'];
const WIN_KS = ['win', 'intercept'];

export function computeReport(events, rteam, { hs = {}, view = 'all' } = {}) {
  const ev = events.filter((e) => e.team === rteam);
  const other = rteam === 'opp' ? 'us' : 'opp';
  const atk = ev.filter((e) => ATTACK_KS.includes(e.k));
  const atkL = atk.filter(hasXY); // 위치를 찍은 공격 장면만 방향 · 지도에
  const ch = { 왼쪽: 0, 가운데: 0, 오른쪽: 0 };
  atkL.forEach((e) => { ch[channel(e.y)]++; });
  const pct = (n) => (atkL.length ? Math.round((n / atkL.length) * 100) : 0);
  const shots = ev.filter((e) => SHOT_KS.includes(e.k));
  const shotsL = shots.filter(hasXY);
  const goals = ev.filter((e) => e.k === 'goal' || (SHOT_KS.includes(e.k) && e.res === 'goal'));
  const crosses = ev.filter((e) => e.k === 'cross' || e.k === 'cutback');
  const losses = ev.filter((e) => e.k === 'loss');
  const set = ev.filter((e) => SET_KS.includes(e.k));
  const wins = ev.filter((e) => WIN_KS.includes(e.k) || (['press', 'duel', 'gegen'].includes(e.k) && e.res === 'ok'));
  const inBox = shotsL.filter((e) => e.x > 0.843 && e.y > 0.204 && e.y < 0.796).length;
  // 시간대: 전체는 하프마다 15분씩, 전반 · 후반만 볼 땐 5분씩
  const minOf = minuteFn(events, hs);
  const step = view === 'all' ? 15 : 5;
  const flow = [];
  (view === 'all' ? [1, 2] : [view]).forEach((h) => {
    const es = events.filter((e) => halfOf(e) === h && ATTACK_KS.includes(e.k));
    const n = 45 / step;
    for (let i = 0; i < n; i++) flow.push({ h, from: i * step, to: (i + 1) * step, label: `${HALF[h]} ${i * step}′`, es: es.filter((e) => Math.min(n - 1, Math.floor(minOf(e) / step)) === i) });
  });
  const peak = flow.reduce((b, f) => { const n0 = f.es.filter((e) => e.team === rteam).length; return n0 > b.n ? { f, n: n0 } : b; }, { f: null, n: 0 });
  // 위험 지역: 공격 · 크로스 · 슈팅 (6 × 4 칸)
  const heat = Array.from({ length: 4 }, () => Array(6).fill(0));
  atkL.forEach((e) => { heat[Math.min(3, Math.floor(e.y * 4))][Math.min(5, Math.floor(e.x * 6))]++; });
  const hmax = Math.max(1, ...heat.flat());
  const heatSvg = heat.map((row, yi) => row.map((v, xi) => `<rect x="${xi * 17.5}" y="${yi * 17}" width="17.5" height="17" fill="rgba(255,59,48,${(v / hmax) * 0.75})"/>${v ? `<text x="${xi * 17.5 + 8.75}" y="${yi * 17 + 10}" class="hv">${v}</text>` : ''}`).join('')).join('');
  const oursSide = (c) => (c === '왼쪽' ? '우리 오른쪽' : c === '오른쪽' ? '우리 왼쪽' : '가운데');
  const mainCh = Object.entries(ch).sort((a, b) => b[1] - a[1])[0];
  const crossSide = crosses.length ? Object.entries(crosses.reduce((a, e) => ({ ...a, [channel(e.y)]: (a[channel(e.y)] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0] : null;
  const lossZone = losses.filter(hasXY).length ? Object.entries(losses.filter(hasXY).reduce((a, e) => { const z = `${third(e.x)} ${channel(e.y)}`; return { ...a, [z]: (a[z] || 0) + 1 }; }, {})).sort((a, b) => b[1] - a[1])[0] : null;
  const xg = shotsL.reduce((a, e) => a + xgOf(e), 0); // 위치 없는 슈팅은 기대 득점에서 빠짐
  const summary = [];
  if (atkL.length) summary.push(`${TEAM[rteam]} 공격은 <b>${mainCh[0]}</b>이 ${pct(mainCh[1])}%로 가장 많아요${rteam === 'opp' && mainCh[0] !== '가운데' ? ` → <b>${oursSide(mainCh[0])} 측면 수비</b>를 대비해야 해요` : ''}.`);
  if (crossSide) summary.push(`크로스 ${crosses.length}개 중 ${crossSide[1]}개가 <b>${crossSide[0]}</b>에서 올라왔어요${rteam === 'opp' ? ` (${oursSide(crossSide[0])})` : ''}.`);
  if (shots.length) summary.push(`슈팅 ${shots.length}개${shotsL.length ? ` · 위치를 찍은 ${shotsL.length}개 중 박스 안 ${inBox}개 (${Math.round((inBox / shotsL.length) * 100)}%) · 기대 득점 <b>${xg.toFixed(1)}</b>` : ''} · 실제 ${goals.length}골.`);
  if (peak.n >= 3) summary.push(`<b>${HALF[peak.f.h]} ${peak.f.from}~${peak.f.to}분</b>에 공격이 가장 많았어요 (${peak.n}번).`);
  if (lossZone) summary.push(`${TEAM[rteam]}가 공을 가장 많이 잃은 곳: <b>${lossZone[0]}</b> (${lossZone[1]}번)${rteam === 'opp' ? ' → 이곳에서 압박하면 효과적이에요' : ' → 이곳 빌드업을 보완해요'}.`);
  if (set.length) summary.push(`세트피스 ${set.length}번${set.filter((e) => e.res === 'shot').length ? ` · 슈팅까지 ${set.filter((e) => e.res === 'shot').length}번` : ''}.`);
  return { ev, other, atk, atkL, ch, pct, shots, shotsL, goals, crosses, losses, set, wins, inBox, flow, heatSvg, oursSide, summary, xg };
}

// ───────── 자동 분석 (기록한 장면만으로 아주 자세히) ─────────
// 반환: [{ t: 제목, items: [문장 html] }] — 기록이 적으면 그 칸은 '기록이 더 필요해요'
export function deepAnalysis(events, rteam, opt = {}) {
  const R = computeReport(events, rteam, opt);
  const { ev, other } = R;
  const T = TEAM[rteam]; const O = TEAM[other];
  const opp = rteam === 'opp';
  const side = (c) => (opp && c !== '가운데' ? `${c}(${R.oursSide(c)})` : c);
  const P = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const rate = (list) => { const d = list.filter((e) => e.res === 'ok' || e.res === 'fail'); return d.length ? { n: d.length, ok: d.filter((e) => e.res === 'ok').length, p: P(d.filter((e) => e.res === 'ok').length, d.length) } : null; };
  const of = (...ks) => ev.filter((e) => ks.includes(e.k));
  const top = (list, key) => { const m = {}; list.forEach((e) => { const k = key(e); if (k) m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const S = [];
  const strong = []; const weak = []; const todo = [];

  // 1. 공격 경로 · 빌드업
  const it1 = [];
  const passes = of(...PASS_KS); const longs = of('long'); const builds = of('buildup'); const progs = of('prog', 'through');
  if (passes.length) {
    it1.push(`패스로 공격을 만든 장면 ${passes.length}번: 빌드업 ${builds.length} · 전진 패스 ${of('prog').length} · 스루패스 ${of('through').length} · 롱볼 ${longs.length}.`);
    if (longs.length >= 3 && longs.length / passes.length >= 0.35) { it1.push(`롱볼 비율이 <b>${P(longs.length, passes.length)}%</b>로 높아요 — 짧게 만들기보다 <b>뒷공간 · 공중볼</b>로 바로 넘겨요.`); (opp ? strong : weak).push(opp ? '롱볼로 바로 넘기는 공격' : '롱볼 의존이 커요'); }
    else if (builds.length + progs.length >= 4) it1.push(`짧은 패스로 <b>차근차근 만들어 가는</b> 팀이에요 (빌드업 · 전진 패스 ${builds.length + progs.length}번).`);
    const rp = rate(passes);
    if (rp && rp.n >= 4) { it1.push(`패스 연결 성공률 <b>${rp.p}%</b> (${rp.ok}/${rp.n}).`); if (rp.p < 60) { weak.push(`패스 연결 성공률 ${rp.p}%`); if (!opp) todo.push('압박 속 짧은 패스 · 몸 방향 만들기 훈련 (론도 · 4v2)'); } else if (rp.p >= 80) strong.push(`패스 연결이 안정적 (${rp.p}%)`); }
    const lines = passes.filter((e) => e.x2 != null);
    if (lines.length >= 3) {
      const fw = lines.filter((e) => e.x2 - e.x > 0.08).length;
      const sw = lines.filter((e) => Math.abs(e.y2 - e.y) > 0.3).length;
      it1.push(`끝 지점까지 찍은 패스 ${lines.length}개 중 앞으로 간 패스 ${P(fw, lines.length)}% · 반대쪽으로 크게 바꾼 전환 패스 ${sw}개.`);
      if (sw >= 3) it1.push(`<b>사이드 전환</b>이 잦아요 — ${opp ? '반대쪽 측면 커버를 빨리 해야 해요' : '반대쪽 공간을 잘 써요'}.`);
    }
  }
  const lossBy = top(R.losses.filter((e) => hasXY(e) && e.x < 1 / 3), () => '수비 1/3');
  if (lossBy.length && lossBy[0][1] >= 3) { it1.push(`<b>자기 진영(수비 1/3)</b>에서 공을 ${lossBy[0][1]}번 잃었어요 — ${opp ? '높은 압박이 통해요' : '빌드업 첫 패스가 불안해요'}.`); weak.push('자기 진영에서 볼 손실'); todo.push(opp ? '상대 빌드업 첫 패스에 높은 압박' : '골키퍼 · 센터백 빌드업 패턴 연습 (압박 탈출 3가지)'); }
  const rp0 = rate(passes);
  S.push({ t: '공격 경로 · 빌드업', items: it1, k: [['패스로 만든 공격', passes.length], ['패스 성공률', rp0 ? `${rp0.p}%` : '-'], ['롱볼 비율', passes.length ? `${P(longs.length, passes.length)}%` : '-'], ['자기 진영 볼 손실', R.losses.filter((e) => hasXY(e) && e.x < 1 / 3).length]] });

  // 2. 측면 · 크로스 · 돌파
  const it2 = [];
  const atkN = R.atkL.length;
  if (atkN) it2.push(`공격 방향: 왼쪽 ${R.pct(R.ch['왼쪽'])}% · 가운데 ${R.pct(R.ch['가운데'])}% · 오른쪽 ${R.pct(R.ch['오른쪽'])}% (공격 장면 ${atkN}개).`);
  const mainSide = Object.entries(R.ch).sort((a, b) => b[1] - a[1])[0];
  if (atkN >= 6 && mainSide[1] / atkN >= 0.45) { it2.push(`<b>${side(mainSide[0])}</b>으로 쏠려요 (${R.pct(mainSide[1])}%).`); if (opp) todo.push(`${R.oursSide(mainSide[0])} 측면 수비 2v1 · 커버 연습`); }
  const drb = of('dribble'); const rd = rate(drb);
  if (drb.length) { it2.push(`돌파 ${drb.length}번${rd ? ` · 성공률 ${rd.p}%` : ''}${top(drb, (e) => (hasXY(e) ? channel(e.y) : ''))[0] ? ` · 주로 ${side(top(drb, (e) => (hasXY(e) ? channel(e.y) : ''))[0][0])}` : ''}.`); if (rd && rd.n >= 4 && rd.p >= 60) strong.push(`1v1 돌파 (${rd.p}%)`); }
  const cr = R.crosses; const rc = rate(cr);
  if (cr.length) {
    const ft = top(cr, (e) => DLABEL[e.foot]); const hg = top(cr, (e) => DLABEL[e.height]);
    it2.push(`크로스 · 컷백 ${cr.length}번 (컷백 ${of('cutback').length})${rc ? ` · 연결 ${rc.p}%` : ''}${ft[0] ? ` · ${ft[0][0]} ${ft[0][1]}번` : ''}${hg[0] ? ` · ${hg[0][0]}가 많음` : ''}.`);
    if (rc && rc.n >= 4 && rc.p < 35) { weak.push(`크로스 연결 ${rc.p}%`); if (!opp) todo.push('크로스 정확도 · 박스 안 침투 타이밍 훈련'); }
    if (opp && cr.length >= 4) todo.push(`${hg[0]?.[0] === '높게' ? '공중볼 경합 · 니어 포스트 수비' : '컷백 · 땅볼 크로스 대비 (박스 앞 커버)'}`);
  }
  S.push({ t: '측면 · 크로스 · 돌파', items: it2, k: [['왼쪽 · 가운데 · 오른쪽 (%)', atkN ? `${R.pct(R.ch['왼쪽'])}·${R.pct(R.ch['가운데'])}·${R.pct(R.ch['오른쪽'])}` : '-'], ['돌파 성공률', rd ? `${rd.p}%` : '-'], ['크로스 · 컷백', cr.length], ['크로스 연결', rc ? `${rc.p}%` : '-']] });

  // 3. 마무리 · 슈팅
  const it3 = [];
  const sh = R.shots;
  if (sh.length) {
    const on = sh.filter((e) => e.k === 'goal' || ['on', 'post', 'goal'].includes(e.res)).length;
    const decided = sh.filter((e) => e.k === 'goal' || e.res).length;
    it3.push(`슈팅 ${sh.length}개 · 박스 안 ${R.inBox}개 (${P(R.inBox, R.shotsL.length)}%) · 득점 ${R.goals.length} · 기대 득점 <b>${R.xg.toFixed(2)}</b>.`);
    if (decided >= 3) it3.push(`유효 슈팅 비율 <b>${P(on, decided)}%</b> (${on}/${decided}).`);
    const ft = top(sh, (e) => DLABEL[e.foot]);
    if (ft.length) it3.push(`슈팅 발: ${ft.map(([k, n]) => `${k} ${n}`).join(' · ')}${ft[0][0] === '왼발' && ft[0][1] >= 3 ? ' — <b>왼발</b> 슈팅이 많아요' : ''}.`);
    if (R.goals.length - R.xg >= 1) it3.push(`기대보다 <b>${(R.goals.length - R.xg).toFixed(1)}골 더</b> 넣었어요 — 결정력이 좋았어요.`);
    else if (R.xg - R.goals.length >= 1) { it3.push(`기대 득점보다 <b>${(R.xg - R.goals.length).toFixed(1)}골 적게</b> 넣었어요 — 찬스를 놓쳤어요.`); if (!opp) { weak.push('결정력 (기대 득점보다 적은 골)'); todo.push('박스 안 원터치 마무리 · 침착성 훈련'); } }
    if (sh.length >= 4 && P(R.inBox, R.shotsL.length) < 40) it3.push(`박스 밖 <b>중거리 슈팅</b>이 많아요 — ${opp ? '박스 앞 선수에게 슈팅 각을 주지 마세요' : '박스 안까지 더 들어가야 해요'}.`);
  }
  const chances = of('chance');
  if (chances.length) it3.push(`결정적 찬스 ${chances.length}번.`);
  const on0 = sh.filter((e) => e.k === 'goal' || ['on', 'post', 'goal'].includes(e.res)).length; const dec0 = sh.filter((e) => e.k === 'goal' || e.res).length;
  S.push({ t: '마무리 · 슈팅', items: it3, k: [['슈팅', sh.length], ['유효 슈팅', dec0 ? `${P(on0, dec0)}%` : '-'], ['박스 안', sh.length ? `${P(R.inBox, R.shotsL.length)}%` : '-'], ['득점 / 기대 득점', `${R.goals.length} / ${R.xg.toFixed(1)}`]] });

  // 4. 수비 · 압박
  const it4 = [];
  const pr = of('press'); const rpr = rate(pr); const du = of('duel'); const rdu = rate(du);
  if (R.wins.length) {
    const zone = top(R.wins, (e) => (hasXY(e) ? third(e.x) : ''));
    it4.push(`공을 따낸 장면 ${R.wins.length}번 (탈취 ${of('win').length} · 인터셉트 ${of('intercept').length})${zone[0] ? ` · 주로 <b>${zone[0][0]}</b>` : ''}.`);
    const high = R.wins.filter((e) => hasXY(e) && e.x > 2 / 3).length;
    if (high >= 3) { it4.push(`상대 진영(공격 1/3)에서 ${high}번 따냈어요 — <b>높은 압박</b>이 통했어요.`); strong.push('높은 위치 볼 탈취'); }
  }
  if (rpr) it4.push(`압박 ${pr.length}번 · 성공 ${rpr.p}%.`);
  if (rdu) { it4.push(`경합 · 태클 ${du.length}번 · 이긴 비율 ${rdu.p}%.`); if (rdu.n >= 4 && rdu.p < 45) { weak.push(`경합 승률 ${rdu.p}%`); if (!opp) todo.push('1v1 수비 자세 · 몸싸움 훈련'); } }
  if (of('clear').length) it4.push(`클리어링 ${of('clear').length}번.`);
  if (of('save').length) it4.push(`골키퍼 선방 ${of('save').length}번.`);
  S.push({ t: '수비 · 압박', items: it4, k: [['공 따냄', R.wins.length], ['높은 위치 탈취', R.wins.filter((e) => hasXY(e) && e.x > 2 / 3).length], ['압박 성공', rpr ? `${rpr.p}%` : '-'], ['경합 승률', rdu ? `${rdu.p}%` : '-']] });

  // 5. 공수 전환 (공을 잃은 뒤 · 따낸 뒤 15초)
  const it5 = [];
  const within = (a, list, sec = 15) => list.some((e) => e.t > a.t && e.t - a.t <= sec);
  const oppShots = events.filter((e) => e.team === other && SHOT_KS.includes(e.k));
  const myShots = R.shots;
  if (R.losses.length) {
    const danger = R.losses.filter((l) => within(l, oppShots)).length;
    const how = top(R.losses, (e) => DLABEL[e.how]);
    it5.push(`공을 잃은 장면 ${R.losses.length}번${how.length ? ` (${how.map(([k, n]) => `${k} ${n}`).join(' · ')})` : ''} · 그 뒤 15초 안에 ${O} 슈팅 <b>${danger}번</b>.`);
    if (danger >= 2) { weak.push(`볼 손실 뒤 ${O} 슈팅 ${danger}번`); todo.push(opp ? '공을 따내면 바로 역습 (상대 전환이 느려요)' : '공 잃은 직후 5초 재압박 (게겐프레싱) 훈련'); }
  }
  const gain = R.wins;
  if (gain.length) { const fast = gain.filter((w) => within(w, myShots)).length; it5.push(`공을 따낸 뒤 15초 안에 슈팅까지 간 장면 <b>${fast}번</b>.`); if (fast >= 2) strong.push(`빠른 역습 (${fast}번 슈팅까지)`); }
  const ct = of('counter'); const rct = rate(ct);
  if (ct.length) it5.push(`역습 ${ct.length}번${rct ? ` · 성공 ${rct.p}%` : ''}.`);
  S.push({ t: '공수 전환', items: it5, k: [['공 잃음', R.losses.length], ['잃은 뒤 상대 슈팅', R.losses.filter((l) => within(l, oppShots)).length], ['따낸 뒤 슈팅', gain.filter((w) => within(w, myShots)).length], ['역습', ct.length]] });

  // 6. 세트피스
  const it6 = [];
  if (R.set.length) {
    const byK = top(R.set, (e) => KIND[e.k].l);
    it6.push(`세트피스 ${R.set.length}번: ${byK.map(([k, n]) => `${k} ${n}`).join(' · ')}.`);
    const res = top(R.set, (e) => DLABEL[e.res]);
    if (res.length) it6.push(`결과: ${res.map(([k, n]) => `${k} ${n}`).join(' · ')}.`);
    const setGoals = R.goals.filter((g) => R.set.some((sp) => g.t >= sp.t && g.t - sp.t <= 12)).length;
    if (setGoals) { it6.push(`세트피스 뒤 12초 안에 득점 <b>${setGoals}번</b>.`); (opp ? todo : strong).push(opp ? '세트피스 수비 (마크 · 지역 정하기)' : '세트피스 득점력'); }
    const cn = of('corner'); if (cn.length >= 3) { const ft = top(cn, (e) => DLABEL[e.foot]); if (ft[0]) it6.push(`코너킥은 주로 ${ft[0][0]}로 차요.`); }
  }
  S.push({ t: '세트피스', items: it6, k: [['세트피스', R.set.length], ['코너킥', of('corner').length], ['프리킥', of('freekick').length], ['슈팅까지', R.set.filter((e) => e.res === 'shot').length]] });

  // 7. 시간대 흐름
  const it7 = [];
  const tm = R.flow.map((f) => [f, f.es.filter((e) => e.team === rteam).length, f.es.filter((e) => e.team === other).length]);
  const used = tm.filter(([, a, b]) => a + b > 0);
  const fl = (f) => `${HALF[f.h]} ${f.from}~${f.to}분`;
  if (used.length >= 2) {
    const best = [...tm].sort((a, b) => (b[1] - b[2]) - (a[1] - a[2]))[0]; const worst = [...tm].sort((a, b) => (a[1] - a[2]) - (b[1] - b[2]))[0];
    it7.push(`가장 좋았던 시간 <b>${fl(best[0])}</b> (공격 ${best[1]} : ${best[2]}) · 가장 밀린 시간 <b>${fl(worst[0])}</b> (${worst[1]} : ${worst[2]}).`);
    const h1 = ev.filter((e) => halfOf(e) === 1 && ATTACK_KS.includes(e.k)).length; const h2 = ev.filter((e) => halfOf(e) === 2 && ATTACK_KS.includes(e.k)).length;
    if (h1 + h2 >= 6) { it7.push(`전반 공격 ${h1} · 후반 ${h2}${h2 > h1 * 1.4 ? ' — <b>후반에 몰아쳐요</b>' : h1 > h2 * 1.4 ? ' — <b>후반에 힘이 떨어져요</b>' : ''}.`); if (h1 > h2 * 1.4) { weak.push('후반에 공격이 줄어요'); todo.push(opp ? '후반에 더 밀어붙이기' : '후반 체력 · 집중력 (고강도 인터벌)'); } }
  }
  S.push({ t: '시간대 흐름', items: it7, k: [['전반 공격', ev.filter((e) => halfOf(e) === 1 && ATTACK_KS.includes(e.k)).length], ['후반 공격', ev.filter((e) => halfOf(e) === 2 && ATTACK_KS.includes(e.k)).length]] });

  // 8. 선수별
  const it8 = [];
  const byNum = {};
  ev.filter((e) => e.num).forEach((e) => { const b = (byNum[e.num] ||= { n: 0, shot: 0, goal: 0, ok: 0, fail: 0, loss: 0, win: 0 }); b.n++; if (SHOT_KS.includes(e.k)) b.shot++; if (e.k === 'goal') b.goal++; if (e.res === 'ok') b.ok++; if (e.res === 'fail') b.fail++; if (e.k === 'loss') b.loss++; if (WIN_KS.includes(e.k)) b.win++; });
  const ranked = Object.entries(byNum).sort((a, b) => b[1].n - a[1].n);
  if (ranked.length) {
    it8.push(`가장 많이 관여한 선수: ${ranked.slice(0, 3).map(([n, b]) => `<b>${esc(n)}번</b> ${b.n}번`).join(' · ')}.`);
    const scorer = ranked.filter(([, b]) => b.shot).sort((a, b) => b[1].shot - a[1].shot)[0];
    if (scorer) it8.push(`슈팅이 가장 많은 선수 <b>${esc(scorer[0])}번</b> (${scorer[1].shot}개${scorer[1].goal ? ` · ${scorer[1].goal}골` : ''})${opp ? ' — 집중 마크' : ''}.`);
    const lost = ranked.filter(([, b]) => b.loss >= 2).sort((a, b) => b[1].loss - a[1].loss)[0];
    if (lost) it8.push(`공을 가장 많이 잃은 선수 <b>${esc(lost[0])}번</b> (${lost[1].loss}번)${opp ? ' — 이 선수에게 압박을 몰아요' : ''}.`);
  }
  S.push({ t: '선수별', items: it8, table: ranked, k: [['번호 적은 선수', ranked.length], ['가장 많이 관여', ranked[0] ? `${ranked[0][0]}번` : '-']] });

  return { sections: S, strong, weak, todo, n: ev.length, R };
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

// 분석실 소개용 예시 경기 (저장하지 않음) — 지금 기록 방식 그대로: 전반 · 후반 · 킥오프 · 세분화 장면 · 결과 · 발 · 번호 · 끝 지점
// 이야기: 상대는 오른쪽(우리 왼쪽) 7번의 크로스 · 10번 왼발 중거리가 무기, 자기 진영에서 공을 자주 잃고, 후반 15~30분에 몰아침
export function sampleMatch() {
  let sd = 11; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const HS = { 1: 15, 2: 2955 }; // 영상에서 전반 · 후반 킥오프
  const ev = [];
  const add = (half, min, team, k, x, y, more = {}) => ev.push({ id: `s${ev.length}`, t: Math.round(HS[half] + min * 60 + rnd() * 50), half, team, k, x: +Math.min(0.99, Math.max(0.01, x)).toFixed(3), y: +Math.min(0.99, Math.max(0.01, y)).toFixed(3), ...more });
  const halfMin = (h) => (h === 2 && rnd() < 0.55 ? 15 + rnd() * 15 : rnd() * 44); // 후반 15~30분에 몰림
  for (const h of [1, 2]) {
    const n = h === 1 ? 1 : 1.5;
    // 상대 공격
    for (let i = 0; i < 26 * n; i++) { const right = rnd() < 0.55; add(h, halfMin(h), 'opp', 'attack', 0.45 + rnd() * 0.4, right ? 0.72 + rnd() * 0.25 : rnd() < 0.5 ? 0.4 + rnd() * 0.2 : rnd() * 0.3, { res: rnd() < 0.62 ? 'ok' : 'fail' }); }
    for (let i = 0; i < 6 * n; i++) add(h, halfMin(h), 'opp', 'long', 0.2 + rnd() * 0.15, 0.3 + rnd() * 0.4, { res: rnd() < 0.45 ? 'ok' : 'fail', x2: 0.72 + rnd() * 0.15, y2: 0.6 + rnd() * 0.35, num: pick(['4', '5']) });
    for (let i = 0; i < 4 * n; i++) add(h, halfMin(h), 'opp', 'through', 0.55 + rnd() * 0.15, 0.4 + rnd() * 0.3, { res: rnd() < 0.5 ? 'ok' : 'fail', x2: 0.8 + rnd() * 0.12, y2: 0.45 + rnd() * 0.3, num: '10' });
    for (let i = 0; i < 5 * n; i++) add(h, halfMin(h), 'opp', 'dribble', 0.65 + rnd() * 0.2, 0.8 + rnd() * 0.17, { res: rnd() < 0.6 ? 'ok' : 'fail', num: '7', x2: 0.8 + rnd() * 0.12, y2: 0.82 + rnd() * 0.12 });
    for (let i = 0; i < 7 * n; i++) add(h, halfMin(h), 'opp', 'cross', 0.8 + rnd() * 0.17, rnd() < 0.75 ? 0.86 + rnd() * 0.12 : 0.03 + rnd() * 0.1, { res: rnd() < 0.38 ? 'ok' : 'fail', foot: 'R', height: rnd() < 0.7 ? 'high' : 'ground', num: rnd() < 0.7 ? '7' : '2', x2: 0.9 + rnd() * 0.06, y2: 0.4 + rnd() * 0.2 });
    for (let i = 0; i < 6 * n; i++) { const far = rnd() < 0.55; add(h, halfMin(h), 'opp', 'shot', far ? 0.7 + rnd() * 0.12 : 0.86 + rnd() * 0.1, 0.3 + rnd() * 0.4, { res: pick(['on', 'off', 'off', 'block']), foot: far ? 'L' : pick(['R', 'L', 'H']), num: far ? '10' : pick(['9', '11', '7']) }); }
    for (let i = 0; i < 8 * n; i++) add(h, halfMin(h), 'opp', 'loss', 0.12 + rnd() * 0.25, rnd() < 0.6 ? rnd() * 0.33 : 0.33 + rnd() * 0.6, { how: pick(['press', 'press', 'mistake', 'duel']), num: pick(['3', '5', '6']) });
    for (let i = 0; i < 4 * n; i++) add(h, halfMin(h), 'opp', 'press', 0.55 + rnd() * 0.3, rnd(), { res: rnd() < 0.4 ? 'ok' : 'fail' });
    for (let i = 0; i < 3; i++) add(h, halfMin(h), 'opp', 'corner', 0.99, rnd() < 0.5 ? 0.02 : 0.97, { res: pick(['shot', 'danger', 'none', 'none']), foot: 'R' });
    for (let i = 0; i < 2; i++) add(h, halfMin(h), 'opp', 'freekick', 0.66 + rnd() * 0.1, 0.3 + rnd() * 0.4, { res: pick(['shot', 'none']), foot: 'L', num: '10' });
    for (let i = 0; i < 3; i++) add(h, halfMin(h), 'opp', 'foul', 0.3 + rnd() * 0.4, rnd(), { ...(rnd() < 0.3 ? { card: 'Y' } : {}), num: pick(['4', '6', '8']) });
    // 우리 공격
    for (let i = 0; i < 18 * (h === 1 ? 1.2 : 0.8); i++) add(h, halfMin(h), 'us', 'attack', 0.45 + rnd() * 0.4, rnd(), { res: rnd() < 0.55 ? 'ok' : 'fail' });
    for (let i = 0; i < 4; i++) add(h, halfMin(h), 'us', 'cross', 0.8 + rnd() * 0.15, rnd() < 0.5 ? 0.9 : 0.1, { res: rnd() < 0.3 ? 'ok' : 'fail', foot: pick(['R', 'L']), num: pick(['11', '7']) });
    for (let i = 0; i < 5 * (h === 1 ? 1.2 : 0.7); i++) add(h, halfMin(h), 'us', 'shot', 0.78 + rnd() * 0.18, 0.3 + rnd() * 0.4, { res: pick(['on', 'off', 'block']), foot: pick(['R', 'L']), num: pick(['9', '10', '11']) });
    for (let i = 0; i < 6; i++) add(h, halfMin(h), 'us', 'loss', 0.2 + rnd() * 0.5, rnd(), { how: pick(['press', 'mistake']) });
    for (let i = 0; i < 7; i++) add(h, halfMin(h), 'us', 'win', 0.55 + rnd() * 0.4, rnd(), { num: pick(['8', '6', '10']) });
    add(h, halfMin(h), 'us', 'corner', 0.99, 0.97, { res: 'danger', foot: 'L' });
  }
  add(1, 23, 'us', 'goal', 0.92, 0.5, { foot: 'R', num: '9' });
  add(2, 18, 'opp', 'goal', 0.93, 0.56, { foot: 'H', num: '9' });
  add(2, 27, 'opp', 'goal', 0.74, 0.44, { foot: 'L', num: '10' });
  ev.sort((a, b) => a.t - b.t);
  return { id: 'sample', mode: 'match', title: '예시) vs 상대 FC 경기분석', opponent: '상대 FC', date: '', oppDir: 'right', events: ev, target: 'both', size: 11, halfStart: HS,
    lineups: { opp: { base: { f: '4-2-3-1', nums: ['1', '2', '4', '5', '3', '6', '8', '11', '10', '7', '9'] }, def: { f: '4-4-1-1', nums: [] } }, us: { base: { f: '4-3-3', nums: ['1', '2', '4', '5', '3', '6', '8', '10', '11', '9', '7'] } } },
    keys: { opp: [{ id: 'k1', num: '10', pos: 'AM', name: '', note: '왼발 · 박스 앞 중거리 · 프리킥 키커' }, { id: 'k2', num: '7', pos: 'RW', name: '', note: '스피드 · 오른쪽 돌파 뒤 높은 크로스' }], us: [{ id: 'k3', num: '9', pos: 'ST', name: '', note: '침투 · 첫 골' }] }, formations: [] };
}
