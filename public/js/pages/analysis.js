// 분석실 — 경기 영상 업로드 + 분석 스튜디오 (트래킹 · 크로마키 · 원근 그리드 · 화살표 · 영역 · 거리)
import {
  db, storage, collection, doc, query, where, orderBy, limit, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  serverTimestamp, storageRef, uploadBytesResumable, getDownloadURL,
} from '../fb.js';
import {
  esc, toast, fail, formData, modal, confirmBox, fmtDate, todayStr, pageHead, empty, youtubeId,
} from '../ui.js';
import { state, isCoach, go } from '../store.js';
import {
  PALETTE, STYLE_COLORS, GLASS, uid, FrameAnalyzer, PlayerTracker, trackerPos, setTrackerAt, setKeyAt, delKeyAt, thinPath, stampH, GROUND, itemPoints, offsideGeom, drawItem, drawMeasureLabel, drawAngleLabel, nameTag, setGroundTex, steadyPos, TEAM_COLORS, CAL_TPL, calFrom, setCal, getCal, drawCalGuide, angleDeg, cutPlayer, cutBox, meters, label,
} from '../telestrator.js';
import { ai, loadAI, detectAround, detectIn, scanFrame, pickNear } from '../detector.js';
import { FollowAI } from '../follow.js';
import { STORAGE_ENABLED } from '../config.js';
import { matchStudio, sampleMatch, computeReport, TARGETS, linkOf, LINK_HELP, VEO_HELP } from './matchAnalysis.js';

// 손가락으로 쓰는 화면(휴대폰 · 태블릿)
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// 무료(파일 저장소 없음): 영상은 코치 컴퓨터에서 바로 열어 분석 — 이 창을 닫기 전까지만 기억
const localFiles = new Map(); // 분석 id → File

const col = () => collection(db, 'teams', state.team.id, 'posts');
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtT1 = (s) => `${fmtT(s)}.${Math.floor((s * 10) % 10)}`; // 0:12.5

// ───────── 목록 ─────────
// 코치: 움직이는 소개 카드(부분분석 · 경기분석) + 내 분석 목록 · 선수: 경기분석만
let listTab = 'match';
export async function list(el) {
  const snap = await getDocs(query(col(), where('type', '==', 'analysis'), orderBy('createdAt', 'desc'), limit(100)));
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const coach = isCoach();
  const isMatch = (p) => p.mode === 'match';
  if (!coach) listTab = 'match';
  const rows = all.filter((p) => (listTab === 'match' ? isMatch(p) : !isMatch(p)));
  el.innerHTML = coach ? `${pageHead('ANALYSIS ROOM', '분석실', '<button class="btn" data-new>+ 새 분석</button>')}
    ${heroHtml(all.length > 0)}
    ${all.length ? `<h2 class="an-libh">내 분석</h2>
      <nav class="tabs admin-tabs">${[['match', '경기분석'], ['clip', '부분분석']].map(([k, l]) => `<a href="javascript:void 0" class="${k === listTab ? 'active' : ''}" data-ltab="${k}">${l} <small>${all.filter((p) => (k === 'match' ? isMatch(p) : !isMatch(p))).length}</small></a>`).join('')}</nav>
      ${rows.length ? libGrid(rows) : empty(listTab === 'match' ? '아직 경기분석이 없어요. 위에서 영상을 넣고 시작해 보세요.' : '아직 부분분석이 없어요.')}` : ''}`
    : `${pageHead('ANALYSIS ROOM', '분석실')}
    <p class="lead">코치님이 만든 <b>경기분석</b>이에요. 상대 팀의 <b>체크 포인트 → 포메이션 → 리포트</b> 순서로 보면 돼요.</p>
    ${rows.length ? libGrid(rows) : `${empty('아직 올라온 경기분석이 없어요.')}
      <div class="row center"><button class="btn ghost sm" data-sample>경기분석은 이렇게 생겼어요 (예시)</button></div>`}`;
  el.querySelectorAll('[data-id]').forEach((c) => (c.onclick = () => go(`/analysis/${c.dataset.id}`)));
  el.querySelectorAll('[data-ltab]').forEach((a) => (a.onclick = () => { listTab = a.dataset.ltab; list(el); }));
  el.querySelector('[data-sample]')?.addEventListener('click', () => go('/analysis/sample'));
  el.querySelector('[data-new]')?.addEventListener('click', () => chooseMode(null));
}

// 분석 카드 — 경기분석은 공격 방향 막대 · 포메이션 · 기록 수를 미리 보여 줌
function libGrid(rows) {
  return `<div class="lib-grid">${rows.map((p) => `
      <article class="lib-card" data-id="${p.id}">
        ${p.mode === 'match' ? matchThumb(p) : `<div class="lib-thumb">${p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : youtubeId(p.videoUrl) ? `<img src="https://img.youtube.com/vi/${youtubeId(p.videoUrl)}/hqdefault.jpg" alt="">` : '<div class="thumb-link"><span>▶</span><b>경기 영상</b></div>'}
          ${p.tele?.items?.length ? `<span class="thumb-badge">그림 ${p.tele.items.length}</span>` : ''}</div>`}
        <div class="lib-body">
          <h3>${esc(p.title)}</h3>
          <div class="lib-tags">${p.opponent ? `<span class="ttag">vs ${esc(p.opponent)}</span>` : ''}<span class="lib-meta">${esc(p.date || fmtDate(p.createdAt))}</span></div>
          <div class="lib-foot"><span>${esc(p.authorName || '')}</span><span>${p.mode === 'match' ? '' : p.video?.local ? (p.shareUrl ? '유튜브 공유됨' : '공유 전') : p.video ? '업로드 영상' : p.videoUrl ? 'YouTube' : ''}</span></div>
        </div>
      </article>`).join('')}</div>`;
}
function matchThumb(p) {
  const tm = p.target === 'us' ? 'us' : 'opp';
  const r = computeReport(p.events || [], tm);
  const f = p.lineups?.[tm]?.base ? { name: p.lineups[tm].base.f } : (p.formations || []).find((x) => x.team !== 'us');
  return `<div class="lib-thumb ma-thumb">
    <div class="ma-thumb-top"><span>경기분석 · 기록 ${(p.events || []).length}</span>${f?.name ? `<b>${esc(f.name)}</b>` : ''}</div>
    ${r.atk.length ? ['왼쪽', '가운데', '오른쪽'].map((l) => `<div class="ma-tbar"><span>${l}</span><i style="width:${r.pct(r.ch[l])}%"></i><b>${r.pct(r.ch[l])}%</b></div>`).join('') : '<p class="muted small">아직 기록 전이에요</p>'}
</div>`;
}

// 코치 첫 화면: 움직이는 두 카드 — 무엇을 하는지 보자마자 알 수 있게
function heroHtml(compact) {
  const pitch = '<rect width="160" height="90" rx="6" fill="#2f6b31"/><g fill="none" stroke="rgba(255,255,255,.5)" stroke-width=".8"><rect x="4" y="4" width="152" height="82"/><line x1="80" y1="4" x2="80" y2="86"/><circle cx="80" cy="45" r="12"/><rect x="4" y="25" width="18" height="40"/><rect x="138" y="25" width="18" height="40"/></g>';
  const run = 'M40 62 C 60 58, 70 50, 92 46';
  return `<section class="an-hero ${compact ? 'compact' : ''}">
    <div class="an-hcard">
      <div class="an-hill"><svg viewBox="0 0 160 90">${pitch}
        <circle cx="118" cy="30" r="3.2" fill="#ff3b30"/><circle cx="112" cy="60" r="3.2" fill="#ff3b30"/><circle cx="30" cy="28" r="3.2" fill="#fff"/>
        <g><animateMotion dur="4s" repeatCount="indefinite" path="${run}" keyPoints="0;1;1" keyTimes="0;.55;1" calcMode="linear"/>
          <ellipse cx="0" cy="3.6" rx="6" ry="2" fill="none" stroke="#ffd400" stroke-width=".8"/><circle r="3.2" fill="#fff"/><path d="M-4 -12 L4 -12 L0 -6 Z" fill="#ffd400" class="an-bob"/>
          <text y="-14" class="an-tag">AI</text></g>
        <path class="an-draw" d="M96 44 C 110 38, 122 36, 136 40" fill="none" stroke="#ffd400" stroke-width="2"/><path class="an-draw-head" d="M136 40 l-6 -3.5 l.5 6.5 z" fill="#ffd400"/>
        <path class="an-zone" d="M100 52 L146 52 L150 80 L96 80 Z" fill="rgba(78,161,255,.25)" stroke="#4ea1ff" stroke-width=".6" stroke-dasharray="2 1.5"/></svg></div>
      <div class="an-htext"><span class="eyebrow">부분분석</span><h3>장면 하나를 그림으로 설명</h3>
        <p>선수를 누르면 <b>AI가 끝까지 따라가고</b>, 화살표 · 영역 · 거리를 그려서 <b>mp4 영상</b>으로 카톡에 보내요.</p>
</div>
    </div>
    <div class="an-hcard">
      <div class="an-hill two"><svg viewBox="0 0 160 90">${pitch}
        ${[[120, 70], [132, 62], [126, 78], [140, 55], [104, 66], [146, 46], [96, 30]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${i % 3 === 2 ? '#ff9f0a' : '#4ea1ff'}" stroke="#fff" stroke-width=".5" class="an-tap" style="animation-delay:${i * 0.45}s"/>`).join('')}
        <text x="80" y="11" class="an-dir">상대 공격 →</text></svg>
        <div class="an-hbars">${[['왼쪽', 18], ['가운데', 27], ['오른쪽', 55]].map(([l, v], i) => `<div><span>${l}</span><i style="--w:${v}%;animation-delay:${i * 0.2}s"></i><b>${v}%</b></div>`).join('')}
          <p class="an-type">“상대는 오른쪽 55% → 우리 왼쪽 수비 대비”</p></div></div>
      <div class="an-htext"><span class="eyebrow">경기분석</span><h3>경기 하나로 한 장짜리 리포트</h3>
        <p>영상(내 파일 · 유튜브 · Veo)을 보며 <b>코치님이 직접</b> 단축키로 장면을 고르고 경기장을 누르면, 그 기록으로 리포트가 정리돼요. <b>AI가 대신 기록하지 않아서</b> 누른 만큼 정확해요.</p>
        <ol class="an-steps"><li><b>킥오프</b> 순간 버튼 → 전반 · 후반 경기 시간이 정확히</li><li>장면이 나오면 <kbd>Space</kbd> 멈춤 → <b>단축키</b>(1~5 · Q~T · A~G · Z~B) → <b>경기장</b> 누르기</li><li>잘못 누르면 <kbd>Del</kbd> → 그 점 누르기</li><li><b>저장</b> → 자동 분석 · 전반/후반 비교 · 포메이션 · 키 플레이어가 한 장에</li></ol>
        <button class="link-btn small" data-sample>완성된 예시 리포트 보기 ›</button></div>
    </div>
  </section>`;
}
// 영상을 넣으면(또는 + 새 분석): 부분분석 / 경기분석 고르기
function chooseMode(file) {
  const m = modal(`<span class="eyebrow">NEW ANALYSIS</span><h2>어떤 분석을 할까요?</h2>
    ${file ? `<p class="muted">${esc(file.name)} · ${Math.round(file.size / 1e6)}MB — 서버에 올리지 않아요</p>` : ''}
    <div class="an-choose">
      <button data-m="clip"><b>부분분석</b><span>장면을 골라 트래킹 · 화살표로 설명하고 mp4로 공유</span></button>
      <button data-m="match"><b>경기분석</b><span>경기를 보며 기록해서 상대 팀 리포트 · 포메이션 만들기</span></button>
    </div>`);
  m.el.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { m.close(); listTab = b.dataset.m; if (b.dataset.m === 'match') createMatchModal(file); else createModal(file); }));
}

// 경기분석 만들기: 상대 · 날짜 · 영상(내 컴퓨터) · 전반에 상대가 공격하는 방향
function createMatchModal(preset = null) {
  const m = modal(`<span class="eyebrow">MATCH ANALYSIS</span><h2>경기 분석 만들기</h2>
    <form class="stack">
      <div class="grid2"><label>상대팀<input name="opponent" required maxlength="30" placeholder="예) 성남FC U15"></label>
        <label>경기일<input type="date" name="date" value="${todayStr()}"></label></div>
      <label>제목<input name="title" maxlength="80" placeholder="비우면 'vs 상대팀 경기분석'"></label>
      <div class="grid2"><label>분석할 팀<select name="target">${TARGETS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label>경기 인원<select name="size"><option value="11">11 vs 11</option><option value="8">8 vs 8 (초등부)</option></select></label></div>
      ${preset ? `<p class="muted small">영상: <b>${esc(preset.name)}</b></p>` : `<fieldset class="ma-src"><legend>경기 영상 <small class="muted">둘 중 하나 · 나중에 넣어도 돼요</small></legend>
        <label>내 컴퓨터 파일 <small class="muted">서버에 안 올라가요</small><input type="file" name="file" accept="video/*"></label>
        <label>또는 영상 링크 <small class="muted">유튜브 · Veo · mp4 주소 — 분석에 저장돼서 다음에도 바로 열려요</small><input type="url" name="link" placeholder="https://youtu.be/… 또는 https://app.veo.co/matches/…"></label>
        <p class="muted small">Veo는 공개(링크 공유)된 경기만 열려요.</p></fieldset>`}
      <label>전반에 영상에서 <b>상대</b>가 공격하는 방향<select name="oppDir"><option value="right">오른쪽 →</option><option value="left">← 왼쪽</option></select></label>
      <div class="row end"><button class="btn">만들기</button></div>
    </form>`);
  const form = m.el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(form);
    const file = preset || form.file?.files[0];
    let link = null;
    if (!file && d.link?.trim()) {
      link = linkOf(d.link);
      if (link?.kind === 'veo-bad') { toast(VEO_HELP); return; }
      if (!link) { toast(`영상 링크를 확인해 주세요. ${LINK_HELP}`); return; }
    }
    try {
      const ref = await addDoc(col(), {
        type: 'analysis', mode: 'match', title: (d.title || `vs ${d.opponent} 경기분석`).trim(), opponent: d.opponent.trim(), date: d.date,
        oppDir: d.oppDir, target: d.target || 'opp', size: +d.size || 11, lineups: {}, events: [], formations: [], videoUrl: '',
        ...(file ? { video: { local: true, name: file.name, size: file.size, type: file.type } } : {}),
        ...(link ? { link, youtube: link.kind === 'youtube' ? link.id : '' } : {}),
        authorUid: state.user.uid, authorName: state.profile.name, createdAt: serverTimestamp(),
      });
      if (file) localFiles.set(ref.id, file);
      m.close();
      go(`/analysis/${ref.id}`);
    } catch (err) { fail(err); }
  };
}

function createModal(preset = null) {
  const m = modal(`
    <span class="eyebrow">NEW ANALYSIS</span><h2>영상 분석 만들기</h2>
    <form class="stack">
      ${preset ? `<p class="muted small">영상: <b>${esc(preset.name)}</b></p>` : ''}
      <label>제목<input name="title" required maxlength="80" placeholder="예) 27R vs 화성FC 전반 빌드업"></label>
      <div class="grid2">
        <label>상대팀<input name="opponent" maxlength="30"></label>
        <label>경기일<input type="date" name="date" value="${todayStr()}"></label>
      </div>
      ${STORAGE_ENABLED ? `<label>영상 파일 <small class="muted">mp4 · mov · webm — 트래킹/크로마키는 업로드 영상에서만 됩니다 (최대 1GB)</small>
        <input type="file" name="file" accept="video/*"></label>` : `<label>영상 파일 <small class="muted">내 컴퓨터의 영상을 바로 열어요 — 서버에 올리지 않아요 (AI 트래킹 · 그림 모두 가능)</small>
        <input type="file" name="file" accept="video/*"></label>
        <p class="muted small">분석한 뒤 <b>영상으로 내보내기</b> → 유튜브에 '일부 공개'로 올리고 링크를 붙이면 선수들이 볼 수 있어요.</p>`}
      <div class="upload-bar" hidden><i></i><span></span></div>
      <div class="row end"><button class="btn">만들기</button></div>
    </form>`);
  const form = m.el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(form);
    const file = form.file.files[0] || preset;
    if (!file) return toast('영상 파일을 넣어 주세요.');
    if (file && STORAGE_ENABLED && file.size > 1024 * 1024 * 1024) return toast('1GB 이하 영상만 올릴 수 있습니다.');
    const btn = form.querySelector('.btn');
    btn.disabled = true;
    try {
      const ref = await addDoc(col(), {
        type: 'analysis', title: d.title.trim(), opponent: d.opponent.trim(), date: d.date, videoUrl: file ? '' : d.videoUrl,
        authorUid: state.user.uid, authorName: state.profile.name, createdAt: serverTimestamp(),
        ...(file && !STORAGE_ENABLED ? { video: { local: true, name: file.name, size: file.size, type: file.type } } : {}),
      });
      if (file && !STORAGE_ENABLED) localFiles.set(ref.id, file);
      else if (file) {
        const bar = form.querySelector('.upload-bar');
        bar.hidden = false;
        const path = `teams/${state.team.id}/analysis/${ref.id}_${file.name.replace(/[^\w.\-가-힣]/g, '_')}`;
        const r = storageRef(storage, path);
        await new Promise((resolve, reject) => {
          const task = uploadBytesResumable(r, file, { contentType: file.type });
          task.on('state_changed', (s) => {
            const pct = Math.round((s.bytesTransferred / s.totalBytes) * 100);
            bar.querySelector('i').style.width = `${pct}%`;
            bar.querySelector('span').textContent = `업로드 ${pct}%`;
          }, reject, resolve);
        });
        await updateDoc(doc(col(), ref.id), { video: { url: await getDownloadURL(r), path, name: file.name, size: file.size } });
      }
      m.close();
      go(`/analysis/${ref.id}`);
    } catch (err) { fail(err); btn.disabled = false; }
  };
}

// ───────── 저장 안 한 수정 임시 보관 (이 컴퓨터의 브라우저 · IndexedDB) ─────────
// 뒤로가기 · 새로고침 · 창 닫힘으로 날아가지 않게, 수정 중엔 몇 초마다 자동으로 보관 → 다시 열면 이어서
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('ssaka-drafts', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('d');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const draftKey = (id) => `${state.team?.id}/${id}`;
async function draftGet(id) {
  try { const db = await idb(); return await new Promise((res) => { const q = db.transaction('d').objectStore('d').get(draftKey(id)); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; }
}
async function draftSet(id, v) {
  try { const db = await idb(); await new Promise((res) => { const tx = db.transaction('d', 'readwrite'); tx.objectStore('d').put(v, draftKey(id)); tx.oncomplete = res; tx.onerror = res; }); } catch { /* 보관 실패는 조용히 */ }
}
async function draftDel(id) {
  try { const db = await idb(); db.transaction('d', 'readwrite').objectStore('d').delete(draftKey(id)); } catch { /* */ }
}
const fmtClock = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// ───────── 스튜디오 ─────────
const TOOLS = [
  ['track', '선수 표시', '◎', 1],
  ['arrow', '화살표', '↗', 1], // 실선(패스) · 점선(움직임)은 고른 뒤 설정에서
  ['link', '선수 연결', '⟋', 1],
  ['shape', '영역', '▦', 1],
  ['text', '글자', 'T', 1],
  ['measure', '거리', '↔', 1], // 경기장 맞추기와 한 묶음: 안 맞춘 장면이면 먼저 맞추기가 나옴
  ['vision', '시야', '◁'],
  ['move', '선수 옮기기', '⇄'],
  ['zoom', '돋보기', '◯'],
  ['light', '스포트라이트', '◐'],
  ['offside', '오프사이드', '⫼'],
  ['freeze', '화면 멈춤', '❚❚'], // 누르면 지금 장면에 '멈춤'을 넣음 (그림 없이)
  ['slow', '천천히', '½'], // 누르면 지금부터 몇 초를 느리게
];
// 앞에 둘 도구 (코치마다 · 이 컴퓨터에 보관) — 기본은 많이 쓰는 6개
const FAV_K = 'ssaka.st.favs';
const toolFavs = () => { try { const v = JSON.parse(localStorage.getItem(FAV_K) || 'null'); if (Array.isArray(v) && v.length) return v.filter((k) => TOOLS.some((x) => x[0] === k)); } catch { /* */ } return TOOLS.filter((x) => x[3]).map((x) => x[0]); };
// 도구 아이콘 (같은 굵기 선 아이콘)
const SVG = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const TOOL_SVG = {
  track: SVG('<ellipse cx="12" cy="18" rx="8" ry="3"/><path d="M12 4v10"/><path d="M8.5 7.5L12 4l3.5 3.5"/>'),
  arrow: SVG('<path d="M4 19c4-8 9-11 15-13"/><path d="M13 5.5L19 6l-1.6 5.7"/>'),
  link: SVG('<circle cx="5" cy="17" r="2.2"/><circle cx="12" cy="6.5" r="2.2"/><circle cx="19" cy="15.5" r="2.2"/><path d="M6.3 15.2l4.4-6.8M13.5 8.3l4.3 5.4M7.2 16.8l9.6-1"/>'),
  shape: SVG('<path d="M4 16.5L9.5 5l10.5 4-3.5 10.5z"/>'),
  text: SVG('<path d="M5 6.5h14M12 6.5V19M9 19h6"/>'),
  measure: SVG('<path d="M3 12h18"/><path d="M6.5 8.5L3 12l3.5 3.5M17.5 8.5L21 12l-3.5 3.5"/><path d="M8 5.5v2M12 5.5v2M16 5.5v2"/>'),
  vision: SVG('<circle cx="6" cy="17" r="2"/><path d="M7.6 15.6L19 7M7.8 17.6l12.7-2.2"/>'),
  move: SVG('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
  zoom: SVG('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>'),
  light: SVG('<path d="M9 3h6l3 12H6z"/><ellipse cx="12" cy="18.5" rx="7" ry="2.5"/>'),
  offside: SVG('<path d="M12 3v18"/><path d="M4 8h5M4 12h5M4 16h5" opacity=".5"/>'),
  freeze: SVG('<path d="M8.5 5v14M15.5 5v14"/>'),
  slow: SVG('<circle cx="12" cy="13" r="7.5"/><path d="M12 13V9M12 13l3 2M10 3h4"/>'),
  more: SVG('<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>'),
};
const HINT = {
  link: '다 누르면 Enter · 첫 선수를 다시 누르면 도형',
  move: '① 네모로 감싸기 ② 끌어서 놓기',
  pitch: '1단계 경기장 맞추기 — 흰 점 4개를 경기장 선(박스 · 골라인)에 맞추고 [✓ 저장]',
  measure: '두 선수(또는 두 점) 사이를 끌면 거리(m)가 나와요',
  angle: '꼭짓점에서 끌기',
};

// 보기: #/analysis/:id  ·  수정(코치만): #/analysis/:id/edit — 처음 만든(아직 저장 안 한) 분석은 바로 수정 화면
export const studioEdit = (el, p) => studio(el, { ...p, mode: 'edit' });
export async function studio(el, { id, mode }) {
  if (id === 'sample') { // 소개용 예시 리포트 (저장 안 됨)
    const shell = document.querySelector('.shell');
    shell?.classList.add('wide');
    state.cleanup.push(() => shell?.classList.remove('wide'));
    return matchStudio(el, sampleMatch(), { canEdit: false, files: localFiles, sample: true });
  }
  const ds = await getDoc(doc(col(), id));
  if (!ds.exists()) { el.innerHTML = empty('분석을 찾을 수 없습니다.'); return; }
  const post = { id, ...ds.data() };
  const canEdit = isCoach(); // 저장 · 수정 · 삭제는 코치만. 선수는 보기 + 영상으로 내보내기
  const edit = canEdit && (mode === 'edit' || !post.tele);
  const shell = document.querySelector('.shell');
  shell?.classList.add('wide');
  state.cleanup.push(() => shell?.classList.remove('wide', 'focus'));

  // 경기분석 (장면 기록 · 리포트 · 포메이션)
  if (post.mode === 'match') return matchStudio(el, post, { canEdit, files: localFiles });
  // 선수 화면엔 경기분석만
  if (!canEdit) { el.innerHTML = `${empty('선수 화면에서는 경기분석만 볼 수 있어요.')}<div class="row center"><a class="btn ghost sm" href="#/analysis">분석실로</a></div>`; return; }
  // YouTube 는 픽셀 분석이 불가 → 재생 + 타임라인만
  if (!post.video) return youtubeView(el, post);
  // 내 컴퓨터 영상: 코치는 파일을 다시 열어야 함 · 선수는 코치가 공유한 유튜브 영상을 봄
  if (post.video.local && (!canEdit || !localFiles.has(id))) return localGate(el, post, canEdit, mode);
  const vsrc = post.video.local ? URL.createObjectURL(localFiles.get(id)) : post.video.url;
  if (post.video.local) state.cleanup.push(() => URL.revokeObjectURL(vsrc));

  const tele = {
    items: post.tele?.items || [],
    trackers: (post.tele?.trackers || []).map((t) => ({ ...t, path: t.path || [] })),
    set: { chroma: true, hue: 100, hueManual: false, tol: 40, dur: 5, durEnd: false, hold: 2, autoTrack: true, cals: [], ...(post.tele?.set || {}) },
  };
  // 저장 안 하고 나갔던 수정이 있으면 이어서 하기
  const savedAt = post.updatedAt?.toMillis ? post.updatedAt.toMillis() : 0;
  const draft0 = await draftGet(id);
  let restored = false;
  if (draft0 && draft0.at > savedAt) {
    if (!edit) toast(`저장하지 않은 수정 내용이 남아 있어요 (${fmtClock(draft0.at)}) — ✎ 수정을 누르면 이어서 할 수 있어요`);
    else if (await confirmBox(`저장하지 않은 수정 내용이 있어요 (${fmtClock(draft0.at)} · 그림 ${draft0.tele.items.length}개). 이어서 할까요? ([취소]를 누르면 버려요)`)) {
      tele.items = draft0.tele.items || [];
      tele.trackers = (draft0.tele.trackers || []).map((x) => ({ ...x, path: x.path || [] }));
      tele.set = { ...tele.set, ...(draft0.tele.set || {}) };
      restored = true;
    } else draftDel(id);
    if (!el.isConnected) return; // 묻는 동안 다른 화면으로 갔으면 그만
  }

  el.innerHTML = `
  <div class="studio v2">
    <header class="studio-top">
      <a href="#/analysis" class="icon-btn" aria-label="목록">‹</a>
      <div class="st-title"><strong>${esc(post.title)}</strong><small>${esc([post.opponent && `vs ${post.opponent}`, post.date].filter(Boolean).join(' · '))}</small></div>
      <div class="st-actions">
        <button class="btn ghost sm st-ph-only" data-ph-tl>타임라인</button>${edit ? '<button class="btn ghost sm st-ph-only" data-ph-side>설정</button>' : ''}
        ${edit ? `<button type="button" class="btn ghost sm st-fullbtn" data-full title="전체 화면 편집 ↔ 창으로 보기"></button><span class="st-mode">수정 중</span>
          <div class="st-more"><button type="button" class="btn ghost sm st-morebtn" data-hmore aria-label="더보기" title="더보기">${TOOL_SVG.more}</button>
            <div class="st-menu" data-hmenu hidden>${post.tele ? '<button type="button" data-cancel>수정 취소 (저장한 상태로)</button>' : ''}<button type="button" class="danger" data-del>이 분석 삭제</button></div></div>
          <button class="btn ghost sm" data-save>저장</button><button class="btn sm st-primary" data-export>영상으로 내보내기</button>`
          : `<button class="btn ghost sm" data-export>영상으로 내보내기</button>${canEdit && post.video.local ? `<button class="btn ghost sm" data-share>${post.shareUrl ? '공유 링크 바꾸기' : '선수에게 공유'}</button>` : ''}${canEdit ? '<button class="btn sm" data-edit>✎ 수정</button>' : ''}`}
      </div>
    </header>
    <div class="studio-main ${edit ? '' : 'view-only'}">
      ${edit ? `<aside class="st-tools">${toolFavs().map((k) => TOOLS.find((x) => x[0] === k)).filter(Boolean).map(([k, l, ic]) => `<button class="st-tool fav" data-tool="${k}" title="${l} — 오른쪽 클릭 · 길게 누르면 더보기로"><b>${TOOL_SVG[k] || ic}</b><span>${l}</span></button>`).join('')}
        <button class="st-tool st-moretg" data-moretg><b>${TOOL_SVG.more}</b><span>더보기</span></button>
        <div class="st-moretools" data-moretools hidden>${TOOLS.filter((x) => !toolFavs().includes(x[0])).map(([k, l, ic]) => `<button class="st-tool" data-tool="${k}" title="${l} — 오른쪽 클릭 · 길게 누르면 앞에 두기"><b>${TOOL_SVG[k] || ic}</b><span>${l}</span></button>`).join('')}<p class="st-favhint">오른쪽 클릭 · 길게 누르면 앞에 둬요</p></div>
</aside>` : ''}
      <div class="st-stage">
        <div class="st-canvas-wrap"><video class="st-video" playsinline preload="auto" crossorigin="anonymous" src="${esc(vsrc)}"></video><canvas class="st-canvas"></canvas><div class="st-hint" data-hint></div><div class="st-aiwait" data-aiwait hidden></div>
          <div class="st-shapes" data-shapes hidden>${[['circle', '◯', '동그라미'], ['tri', '△', '세모'], ['rect', '▭', '네모'], ['penta', '⬠', '오각형'], ['hexa', '⬡', '육각형']].map(([k, ic, l], i) => `<button data-shape="${k}" class="${i ? '' : 'on'}" title="${l}">${ic}<small>${l}</small></button>`).join('')}</div><div class="st-rec" hidden>● REC</div></div>
        <div class="st-transport">
          <button class="icon-btn" data-play aria-label="재생">▶</button>
          <button class="icon-btn sm" data-scene="-1" title="이전 그림 장면 (Shift+←)">⏮</button>
          <button class="icon-btn sm" data-step="-5" title="-5초">«</button>
          <button class="icon-btn sm" data-step="-0.04" title="이전 프레임 (←)">‹</button>
          <button class="icon-btn sm" data-step="0.04" title="다음 프레임 (→)">›</button>
          <button class="icon-btn sm" data-step="5" title="+5초">»</button>
          <button class="icon-btn sm" data-scene="1" title="다음 그림 장면 (Shift+→)">⏭</button>
          <span class="st-time" data-time>0:00 / 0:00</span>
          <div class="st-timeline"><input type="range" min="0" max="1000" value="0" data-seek><div class="st-marks" data-marks></div></div>
          <select data-rate title="재생 속도"><option value="0.25">0.25x</option><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option></select>
        </div>
        <div class="st-aipanel" data-aipanel hidden></div>
        <div class="tl" data-tl><div class="tl-rz" data-tlrz title="끌어서 타임라인 · 영상 크기 조절"></div>
          <div class="tl-bar"><b>타임라인</b><small data-count></small>
            <span class="seg sm tl-mode"><button type="button" data-tlmode="scene">장면</button><button type="button" data-tlmode="detail">자세히</button></span>
            
            <span class="tl-zoom"><button type="button" class="chip" data-tz="-1" title="줄이기">−</button><button type="button" class="chip" data-tz="0" title="그림 있는 곳에 맞추기">맞춤</button><button type="button" class="chip" data-tz="1" title="늘리기">+</button></span></div>
          <div class="tl-flow" data-flow></div>
          <div class="tl-scenes" data-scenes></div>
          <div class="tl-body" data-tlbody>
            <div class="tl-heads"><div class="tl-corner"></div><div data-heads></div></div>
            <div class="tl-scroll" data-tls><div class="tl-inner" data-tli><div class="tl-ruler" data-ruler></div><div data-rows></div><div class="tl-play" data-playhead></div></div></div>
          </div>
        </div>
      </div>
      ${edit ? '<aside class="st-side"><section class="st-sec st-propsec" data-props></section></aside>' : ''}
    </div>
  </div>`;

  shell?.classList.add('focus'); // 분석실에서는 사이트 메뉴를 접고 영상을 크게
  const hMenu = el.querySelector('[data-hmenu]');
  el.querySelector('[data-hmore]')?.addEventListener('click', (e) => { e.stopPropagation(); hMenu.hidden = !hMenu.hidden; });
  const closeMenu = () => { if (hMenu) hMenu.hidden = true; };
  document.addEventListener('click', closeMenu); state.cleanup.push(() => document.removeEventListener('click', closeMenu));
  const video = el.querySelector('video');
  const canvas = el.querySelector('.st-canvas');
  const ctx = canvas.getContext('2d');
  const ground = document.createElement('canvas');
  const gctx = ground.getContext('2d');
  const fa = new FrameAnalyzer(640);
  // 그림 하나에서 오류가 나도 나머지 그림 · 재생 · 내보내기가 멈추지 않게
  const drawSafe = (c, ...rest) => { c.save(); try { drawItem(c, ...rest); } catch (e) { console.warn('[분석실] 그림 오류', rest[0]?.k, e); } finally { c.restore(); } };
  // 선수가 그림 앞에 서는지: 그림마다 고를 수 있고, 기본은 면(영역 · 면 채우기)만 — 선 · 화살표는 잘리지 않게
  // 카메라 움직임 기록: 영상을 이어서 재생 · 내보내는 동안 화면이 얼마나 옆 · 위아래로 움직였는지 (정규화 좌표 누적)
  // → 선수에 붙지 않은 그림도 카메라를 따라 잔디 위 같은 자리에 머물게
  let camLog = []; // [t, x, y]
  const camAt = (tt) => {
    if (!camLog.length) return null;
    if (tt <= camLog[0][0]) return camLog[0];
    for (let i = camLog.length - 1; i >= 0; i--) if (camLog[i][0] <= tt) return camLog[i];
    return camLog[0];
  };
  const camShift = (t0) => { const a = camAt(t0); const b = camAt(t()); return a && b ? { x: b[1] - a[1], y: b[2] - a[2] } : null; };
  const shiftPt = (q, d) => (!q || q.tr ? q : { ...q, x: q.x + d.x, y: q.y + d.y });
  function camFollow(it) {
    if (!(isLive(it) || (it.span && it.t1 != null)) || it.k === 'slow') return it; // 재생 중에도 보이는 고정 그림도 카메라를 따라 바닥에 붙어 있게
    const d = camShift(it.t0);
    if (!d || (Math.abs(d.x) < 1e-4 && Math.abs(d.y) < 1e-4)) return it;
    const o = { ...it };
    for (const k of ['a', 'b', 'c', 'p']) if (o[k]) o[k] = shiftPt(o[k], d);
    if (o.pts) o.pts = o.pts.map((q) => shiftPt(q, d));
    if (o.q) o.q = o.q.map((q) => shiftPt(q, d));
    return o;
  }
  // 시야가 향하는 각도 (화면 기준, 0° = 오른쪽 · 90° = 아래/카메라 쪽)
  const vDir = (it) => { const A = resolve(it.a); const B = resolve(it.b); const d = (Math.atan2((B.y - A.y) * H(), (B.x - A.x) * W()) * 180) / Math.PI; return (d + 360) % 360; };
  const occDefault = (it) => it.k !== 'spot'; // 선수는 기본으로 그림 앞에 (발밑 동그라미 · 공중 화살표는 위에) — 자세히 설정에서 그림마다 바꿀 수 있음
  // 지금 영상 시각의 재생 속도 (천천히 구간이면 ×0.5 · ×0.25)
  const speedAt = (m) => { let sp = 1; for (const it of tele.items) if (it.k === 'slow' && m >= it.t0 - 1e-3 && m < (it.t1 ?? it.t0 + 3)) sp = Math.min(sp, it.speed || 0.5); return sp; };
  const pt = new PlayerTracker();
  const follow = new FollowAI(pt, (src, r) => detectIn(src, r, 0.3)); // AI 정밀 추적: 고른 선수 + 주변 선수를 함께 따라가며 겹쳐도 안 헷갈리게
  const trk = new Map(); // tracker id → 추적 상태 (템플릿 · 속도, 메모리에만)
  let cands = null; // '다시 잡기': AI가 찾은 선수 후보들 { tr, boxes }
  let man = null; // 수동 트래킹 { tr, step, auto }
  let busy = null; // AI 작업 진행 { msg, p, stop }
  let aiLive = false; // 재생 중 AI 보정 1건씩
  let tool = 'select';
  let shape = 'circle';
  let color = PALETTE[0];
  // 내 스타일 (이 컴퓨터에 보관) — 색 · 안쪽 색 · 글자 배경 · 굵기 · 크기
  const STY_K = 'ssaka.st.styles';
  const DEF_STYLES = [{ name: '우리 팀', color: '#ffd400', fill: '#ffffff' }, { name: '상대 강조', color: '#ff3b30', fill: '#ffd0cc' }, { name: '수비 라인', color: '#4ea1ff', fill: '#cfe6ff' }];
  const loadStyles = () => { try { const v = JSON.parse(localStorage.getItem(STY_K) || 'null'); return Array.isArray(v) && v.length ? v : DEF_STYLES; } catch { return DEF_STYLES; } };
  const saveStyles = (v) => { try { localStorage.setItem(STY_K, JSON.stringify(v)); } catch { /* */ } };
  const sameStyle = (it, x) => (it.color || PALETTE[0]) === x.color && (!x.fill || it.fill === x.fill);
  const applyStyle = (it, x) => {
    it.color = x.color;
    if (x.fill && (it.k === 'spot')) it.fill = x.fill;
    if (x.bg && it.k === 'text') it.bg = x.bg;
    if (x.weight && it.k === 'arrow') it.weight = x.weight;
    if (x.asz && it.k === 'arrow') it.asz = x.asz;
    if (x.scale && it.k === 'spot') it.scale = x.scale;
    if (x.glow === false && it.k === 'spot') it.glow = false;
  };
  let stylePref = null; // 마지막에 고른 스타일 → 새 그림에도
  let sel = null;
  let draft = null; // 만드는 중인 그림
  let drag = null;
  let lastProcessed = -1;
  let dirty = restored; // 이어서 하는 수정은 저장 전까지 '바뀜'
  let recording = null; // 내보내는 중 (실시간 녹화 또는 hq: 한 프레임씩 만들기)
  let vclock = null; // 한 프레임씩 만들 때의 가상 시계(ms) — 멈춤 효과가 정확히 그 길이만큼 들어가게
  const clock = () => (vclock != null ? vclock : performance.now());
  let seeking = false;
  let autoHued = false;
  const history = [];
  const snapshot = () => { history.push(JSON.stringify({ items: tele.items, trackers: tele.trackers, cals: tele.set.cals || [] })); if (history.length > 60) history.shift(); dirty = true; queueDraft(); };
  // 자동 임시 보관: 바뀌면 1.5초 뒤 · 그 외에도 8초마다 · 화면을 나갈 때
  let draftT = null;
  const saveDraft = () => {
    clearTimeout(draftT); draftT = null;
    if (!edit || !dirty) return;
    draftSet(id, { at: Date.now(), tele: JSON.parse(JSON.stringify({ items: tele.items, trackers: tele.trackers.map(({ lost, ...x }) => x), set: tele.set })) });
  };
  function queueDraft() { if (edit && !draftT) draftT = setTimeout(saveDraft, 1500); }
  if (edit) {
    const iv = setInterval(saveDraft, 8000);
    const onHide = () => { if (document.visibilityState === 'hidden') saveDraft(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', saveDraft);
    // 마우스 옆 버튼(뒤로 · 앞으로)으로 실수로 나가지 않게
    const noSideBtn = (e) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener('mouseup', noSideBtn, true);
    window.addEventListener('auxclick', noSideBtn, true);
    // 뒤로가기 · 다른 메뉴로 이동할 때 확인 (app.js 의 화면 이동에서 물어봄)
    state.leaveGuard = () => dirty;
    state.cleanup.push(() => {
      saveDraft();
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', saveDraft);
      window.removeEventListener('mouseup', noSideBtn, true);
      window.removeEventListener('auxclick', noSideBtn, true);
      state.leaveGuard = null;
    });
  }

  // ── 좌표 ──
  let vtime = null; // 영상 파일을 직접 풀어 만들 때의 지금 시각(초)
  let frameSrc = null; // 그때 쓰는 프레임 (원본 크기 캔버스)
  const SRC = () => frameSrc || video;
  const t = () => (vtime != null ? vtime : video.currentTime || 0);
  // 선수 표시를 실제 몸의 정중앙 · 발끝에 맞춤 (트래킹 점이 조금 어긋나도 동그라미 · 머리 위 표시가 선수 가운데로)
  // 같은 장면에서는 한 번만 계산 · 갑자기 튀지 않게 조금씩 따라감
  const ctrCache = new Map();
  function centered(tr, q) {
    const key = `${tr.id}@${t().toFixed(3)}@${tr.path.length}@${tr.path[0]?.[3] ?? ''}`; // 길이 바뀌면(AI가 새로 계산 · 네모 다시 맞춤) 다시 계산
    if (ctrCache.has(key)) return ctrCache.get(key);
    const live = !video.paused || !!recording;
    const fresh = fa.ok && !(fa.lastT != null && Math.abs(fa.lastT - t()) > 0.12); // 지금 장면을 분석했으면 몸 중앙 찾기
    // 몸 중앙 보정은 '차이'만 아주 천천히 반영 (장면마다 몸 모양이 달라져도 표시가 떨리지 않게). 멈춰서 볼 땐 바로
    if (fresh) {
      const c = centerRaw(tr, q);
      const d = { x: c.x - q.x, y: c.y - q.y };
      tr._off = live && tr._off ? { x: tr._off.x + (d.x - tr._off.x) * 0.08, y: tr._off.y + (d.y - tr._off.y) * 0.08 } : d;
      if (c.h) tr._hc = c.h;
    }
    const off = tr._off || { x: 0, y: 0 };
    // 몸에서 잰 키는 트래킹 키와 비슷할 때만 (선수를 막 고른 순간 잰 큰 덩어리 키가 남아 동그라미가 커지지 않게)
    const r0 = { ...q, x: q.x + off.x, y: q.y + off.y, ...(tr._hc && (!q.h || Math.abs(tr._hc / q.h - 1) < 0.3) ? { h: tr._hc } : {}) };
    const out = steady(tr, r0, live);
    if (ctrCache.size > 400) ctrCache.clear();
    ctrCache.set(key, out);
    return out;
  }
  // 잔움직임 거르기 (트래킹을 따라가는 모든 효과 공통)
  //  천천히 움직이거나 제자리에서 흔들릴 땐 강하게 눌러 주고, 빨리 뛰면 늦지 않게 바로 따라감 (One Euro 필터)
  //  재생 · 영상 만들기 때만 (멈춰서 고칠 땐 실제 자리 그대로)
  const lp = (cut, dt) => { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); };
  //  카메라 움직임은 빼고 거름 (카메라가 빨리 돌아도 표시가 늦게 따라가지 않게) → 거른 뒤 다시 더함
  // 카메라 누적 이동 (장면 사이는 이어서 · 계단처럼 끊기면 표시가 떨림)
  const camSmooth = (tt) => {
    const n = camLog.length; if (!n) return null;
    let i = n - 1; while (i > 0 && camLog[i][0] > tt) i--;
    const a = camLog[i]; const b = camLog[Math.min(n - 1, i + 1)];
    const k = b[0] > a[0] ? Math.max(0, Math.min(1, (tt - a[0]) / (b[0] - a[0]))) : 0;
    // 카메라 속도 (최근 0.3초, 화면 비율/초) — 빨리 돌 때만 카메라를 빼고 거름
    let j = i; while (j > 0 && camLog[j][0] > a[0] - 0.3) j--;
    const sp = a[0] > camLog[j][0] ? Math.hypot(a[1] - camLog[j][1], a[2] - camLog[j][2]) / (a[0] - camLog[j][0]) : 0;
    return [tt, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, sp];
  };
  // 같은 거르기를 화면 좌표 · 카메라를 뺀 좌표 두 가지로 해 두고, 카메라가 빨리 돌수록 뒤쪽을 씀
  const euro = (f, wx, wy, dt) => {
    const vx = (wx - f.x) / dt; const vy = (wy - f.y) / dt;
    const ad = lp(1.0, dt);
    const svx = f.vx + (vx - f.vx) * ad; const svy = f.vy + (vy - f.vy) * ad;
    const cut = 0.35 + 0.45 * Math.hypot(svx, svy); // 느리면 0.6Hz(아주 부드럽게) · 빠르면 높게(바로 따라감)
    const a = lp(cut, dt);
    return { x: f.x + (wx - f.x) * a, y: f.y + (wy - f.y) * a, vx: svx, vy: svy };
  };
  function steady(tr, r, live) {
    const hh = tr.h || r.h || 0.08; // 단위 (키) — 바뀌지 않는 값으로
    const cm = camSmooth(t());
    const cx0 = cm ? cm[1] : 0; const cy0 = cm ? cm[2] : 0;
    const sx = r.x / hh; const sy = r.y / hh; // 화면 좌표
    const gx = (r.x - cx0) / hh; const gy = (r.y - cy0) / hh; // 카메라를 뺀 좌표
    const f = tr._sw;
    const dt = f ? t() - f.t : 0;
    if (!live || !f || dt <= 0 || dt > 0.35 || f.cl !== camLog[0]) {
      tr._sw = { s: { x: sx, y: sy, vx: 0, vy: 0 }, g: { x: gx, y: gy, vx: 0, vy: 0 }, t: t(), cl: camLog[0] };
      return r;
    }
    const s2 = euro(f.s, sx, sy, dt); const g2 = euro(f.g, gx, gy, dt);
    tr._sw = { s: s2, g: g2, t: t(), cl: camLog[0] };
    // 카메라가 키의 0.6배/초보다 빨리 돌기 시작하면 카메라를 뺀 쪽으로 (1.6배/초면 완전히)
    const cw = cm ? Math.max(0, Math.min(1, (cm[3] / hh - 0.6) / 1.0)) : 0;
    const ox = s2.x * hh * (1 - cw) + (g2.x * hh + cx0) * cw; const oy = s2.y * hh * (1 - cw) + (g2.y * hh + cy0) * cw;
    return { ...r, x: ox, y: oy };
  }
  function centerRaw(tr, q) {
    const hh = q.h || tr.h || 0.08; // 그 순간의 키 (트래킹 길에 기록된 값이 더 정확)
    const c = fa.centerAt(q.x, q.y, hh);
    let out = q;
    if (c && Math.abs(c.x - q.x) < hh * 0.4 && Math.abs(c.y - q.y) < hh * 0.22) {
      // 발 높이: 아래로는 거의 안 내림 (그림자 · 잔디 결까지 발로 잡혀 동그라미가 발밑보다 내려가지 않게 — AI가 잰 발끝을 믿음)
      const tx = c.x; const ty = c.y > q.y ? q.y + Math.min(c.y - q.y, hh * 0.04) : c.y;
      const th = hh;
      out = { ...q, x: tx, y: ty, ...(c.h > th * 0.9 && c.h < th * 1.3 ? { h: c.h } : {}) }; // 실제 키 (머리 위 표시 · 동그라미 크기)
    }
    return out;
  }
  const resolve = (p) => {
    if (!p) return { x: 0, y: 0 };
    if (p.tr) {
      const tr = tele.trackers.find((x) => x.id === p.tr);
      const q = (tr && (steadyPos(tr, t()) || trackerPos(tr, t()))) || { x: 0.5, y: 0.5 };
      return tr ? centered(tr, q) : q;
    }
    return p;
  };
  const W = () => canvas.width;
  const H = () => canvas.height;
  const P = (p) => { const r = resolve(p); return { x: r.x * W(), y: r.y * H() }; };
  const cutOff = (it) => {
    void it;
    return false; // 장면이 바뀌어도 숨기지 않고 계속 따라감
  };
  // 트래킹 · 연결선은 재생 중에도 보이고, 나머지 그림은 그 장면에서 멈춰 있을 때만 보임
  // 재생되면 선수를 따라가는 그림. still = 따라가지 않고 그 장면에서 멈춤 동안만 보여줌
  const isLive = (it) => it.k === 'slow' || (it.k === 'arrow' && it.live) || (!it.still && (it.k === 'spot' || it.k === 'link' || ((it.k === 'light' || it.k === 'offside') && !!it.p?.tr)));
  let followPref = true;
  let arrowLivePref = true;
  let arrowBold = (() => { try { return localStorage.getItem('ssaka.st.abold') !== '0'; } catch { return true; } })(); // 새 화살표 굵게 (기본)
  let arrowDash = (() => { try { return localStorage.getItem('ssaka.st.adash') === '1'; } catch { return false; } })(); // 새 화살표: 점선(움직임)인지
  let arrowSz = (() => { try { const v = +localStorage.getItem('ssaka.st.asz'); return v >= 0.4 && v <= 2 ? v : 1; } catch { return 1; } })(); // 새 화살표 크기 (마지막에 고른 크기)
  let advOpen = false; // 오른쪽 '자세히 설정' 열어 둠 // 화살표: 멈추지 않고 재생 중에 그어지기 (마지막에 고른 값)
  let visionPref = 50; // 시야 넓이 기본값 (마지막에 고른 값) // 트래킹 · 스포트라이트를 새로 만들 때 '따라가기' 기본값 (마지막에 고른 값)
  // 고정 그림도 '재생하는 동안에도 보이기'를 켜면 시작~끝 동안 계속 보임 (다른 그림과 시간이 겹쳐도 각자 시간대로)
  const spanOn = (it) => !!it.span && it.t1 != null && !isLive(it);
  const inSpan = (it) => t() >= it.t0 - 0.02 && t() <= it.t1 + 0.02;
  const visible = (it) => (isLive(it)
    ? t() >= it.t0 - 0.02 && (it.t1 == null || t() <= it.t1 + 0.02) && !cutOff(it)
    : (spanOn(it) && inSpan(it)) || (recording?.hq ? !!freeze?.items.includes(it) : freeze ? freeze.items.includes(it) : video.paused && Math.abs(t() - it.t0) < 0.06)); // 멈춤 중엔 같은 장면으로 묶인 그림 모두 (내보낸 영상과 똑같이)
  const toNorm = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  // 손가락 화면(휴대폰 · 태블릿)은 누르는 범위를 1.6배로 (모든 '가까운 점 잡기'에 함께 적용)
  const pxDist = (a, b) => Math.hypot((a.x - b.x) * canvas.clientWidth, (a.y - b.y) * canvas.clientHeight) / (COARSE ? 1.6 : 1);
  const snap = (n) => {
    const inBox = boxAt(n);
    if (inBox) return { tr: inBox.tr.id };
    const tr = tele.trackers.find((x) => { const q = trackerPos(x, t()); return q && pxDist(q, n) < 16; });
    return tr ? { tr: tr.id } : { x: +n.x.toFixed(4), y: +n.y.toFixed(4) };
  };

  // ── 경기장 맞추기: 지금 장면에 맞춘 원근 (그 장면 ±0.35초 · '카메라 고정'이면 영상 전체) ──
  function calNow() {
    const cs = tele.set.cals || [];
    const near = cs.filter((c) => !c.fixed && Math.abs(t() - c.t) < 0.35).sort((a, b) => Math.abs(t() - a.t) - Math.abs(t() - b.t))[0];
    return near || cs.find((c) => c.fixed) || null;
  }
  // 화면에 쓰는 맞춤: 맞춘 장면이면 그대로, 맞춘 두 장면 사이면 네 점을 시간에 따라 이어서 (카메라가 움직여도 따라감)
  // 맞춘 장면 앞뒤 1초까지는 그 장면 그대로 · 두 장면이 20초 넘게 떨어져 있으면 잇지 않음
  const CAL_HOLD = 1; const CAL_GAP = 20;
  function calAt(tt = t()) {
    const cs = tele.set.cals || [];
    const fixed = cs.find((c) => c.fixed);
    const keys = cs.filter((c) => !c.fixed).sort((a, b) => a.t - b.t);
    const exact = keys.filter((c) => Math.abs(tt - c.t) < 0.35).sort((a, b) => Math.abs(tt - a.t) - Math.abs(tt - b.t))[0];
    if (exact) return exact;
    let prev = null; let next = null;
    for (const c of keys) { if (c.t <= tt) prev = c; else { next = c; break; } }
    if (prev && next && next.t - prev.t <= CAL_GAP && prev.tpl === next.tpl && (prev.tpl !== 'rect' || (prev.w === next.w && prev.h === next.h))) {
      const k = (tt - prev.t) / (next.t - prev.t);
      return { ...prev, id: null, auto: true, t: tt, q: prev.q.map((a, i) => ({ x: a.x + (next.q[i].x - a.x) * k, y: a.y + (next.q[i].y - a.y) * k })) };
    }
    const hold = [prev, next].filter((c) => c && Math.abs(tt - c.t) <= CAL_HOLD).sort((a, b) => Math.abs(tt - a.t) - Math.abs(tt - b.t))[0];
    return hold || fixed || null;
  }
  // 이 선수(점)의 화면 키(px) — 수비 라인 벽 높이
  const trailOf = (it) => {
    const tr = it.p?.tr && tele.trackers.find((x) => x.id === it.p.tr);
    if (!tr || it.trail === false) return undefined;
    const now = t(); const from = Math.max(it.t0, now - 1.5); // 최근 1.5초만 — 선수 뒤에 붙어 다니는 꼬리
    if (now - from < 0.15) return undefined;
    const out = [];
    for (let s2 = from; s2 <= now + 1e-6; s2 += 0.05) { const q = steadyPos(tr, s2); if (q) out.push({ x: q.x, y: q.y }); }
    const q = steadyPos(tr, now); if (q) out.push({ x: q.x, y: q.y });
    return out.length > 2 ? out : undefined;
  };
  const atTime = (q, tt) => { const tr = q?.tr && tele.trackers.find((x) => x.id === q.tr); return tr ? (steadyPos(tr, tt) || trackerPos(tr, tt) || q) : q; };
  const liveArrow = (it) => (it.k === 'arrow' && it.live ? { a: atTime(it.a, it.t0), b: atTime(it.b, it.t0 + animSec(it)) } : {});
  const phOf = (q) => { const tr = q?.tr && tele.trackers.find((x) => x.id === q.tr); const hh = tr && ((steadyPos(tr, t()) || trackerPos(tr, t()))?.h || tr.h); return hh ? hh * H() : null; };

  // ───────── 휴대폰 · 태블릿 ─────────
  // 가로로 들면: 영상이 화면 가득 · 도구는 왼쪽 세로 줄 · 타임라인 · 설정은 누를 때만 (st-phone)
  const studio = el.querySelector('.studio');
  const landQ = matchMedia('(orientation: landscape)');
  const PH_OK = 'ssaka.st.portraitOk';
  const portraitHint = COARSE ? Object.assign(document.createElement('div'), { className: 'st-rotate', innerHTML: '<span><b>⟲ 가로로 돌리면</b> 영상이 화면 가득 커지고 도구가 옆에 붙어요</span><button type="button" class="btn ghost sm" data-strot-no>이대로 보기</button>' }) : null;
  if (portraitHint) {
    el.querySelector('.st-stage').prepend(portraitHint);
    portraitHint.querySelector('[data-strot-no]').onclick = () => { try { localStorage.setItem(PH_OK, '1'); } catch { /* */ } portraitHint.hidden = true; };
  }
  function syncPhone() {
    if (!studio.isConnected) { landQ.removeEventListener('change', syncPhone); return; }
    const on = COARSE && landQ.matches;
    studio.classList.toggle('st-phone', on);
    if (!on) studio.classList.remove('st-tl-open', 'st-side-open');
    syncPhBtns();
    document.documentElement.classList.toggle('pad-locked', on);
    if (portraitHint) { let ok = false; try { ok = localStorage.getItem(PH_OK) === '1'; } catch { /* */ } portraitHint.hidden = on || ok; }
    requestAnimationFrame(() => fit());
  }
  landQ.addEventListener('change', syncPhone);
  state.cleanup.push(() => { landQ.removeEventListener('change', syncPhone); document.documentElement.classList.remove('pad-locked'); loupeEl?.remove(); });
  el.querySelector('[data-ph-tl]').onclick = () => { studio.classList.toggle('st-tl-open'); studio.classList.remove('st-side-open'); syncPhBtns(); requestAnimationFrame(() => drawSide()); };
  el.querySelector('[data-ph-side]')?.addEventListener('click', () => { studio.classList.toggle('st-side-open'); studio.classList.remove('st-tl-open'); syncPhBtns(); });
  const syncPhBtns = () => { el.querySelector('[data-ph-tl]').classList.toggle('on', studio.classList.contains('st-tl-open')); el.querySelector('[data-ph-side]')?.classList.toggle('on', studio.classList.contains('st-side-open')); };
  const openSide = () => { if (studio.classList.contains('st-phone')) { studio.classList.add('st-side-open'); studio.classList.remove('st-tl-open'); syncPhBtns(); } };

  // ───────── 전체 화면 편집 (컴퓨터): 수정 화면은 화면 전체가 편집기 — 가운데 영상 · 왼쪽 도구 · 오른쪽 설정 · 아래 타임라인 ─────────
  const FULL_K = 'ssaka.st.full';
  const tlEl = el.querySelector('[data-tl]');
  const mainEl = el.querySelector('.studio-main');
  const stageEl = el.querySelector('.st-stage');
  function setFull(on) {
    const can = edit && !COARSE && window.innerWidth > 860;
    on = on && can;
    studio.classList.toggle('st-full', on);
    document.documentElement.classList.toggle('st-lock', on);
    // 타임라인: 전체 화면에선 맨 아래 가로로 길게 (도구 · 영상 · 설정 밑), 창 모드에선 영상 밑
    if (on && tlEl.parentElement !== mainEl) mainEl.appendChild(tlEl);
    if (!on && tlEl.parentElement !== stageEl) stageEl.appendChild(tlEl);
    const b = el.querySelector('[data-full]');
    if (b) { b.hidden = !can; b.innerHTML = on ? '<span aria-hidden="true">⤡</span> 창으로' : '<span aria-hidden="true">⤢</span> 전체 화면'; }
    requestAnimationFrame(() => { fit(); drawSide(); });
  }
  let full0 = true; try { full0 = localStorage.getItem(FULL_K) !== '0'; } catch { /* */ }
  el.querySelector('[data-full]')?.addEventListener('click', () => { const on = !studio.classList.contains('st-full'); try { localStorage.setItem(FULL_K, on ? '1' : '0'); } catch { /* */ } setFull(on); });
  const onWinResize = () => { let want = true; try { want = localStorage.getItem(FULL_K) !== '0'; } catch { /* */ } if (studio.isConnected) setFull(want); };
  window.addEventListener('resize', onWinResize);
  state.cleanup.push(() => { window.removeEventListener('resize', onWinResize); document.documentElement.classList.remove('st-lock'); });
  setFull(full0);
  // 영상 ↔ 타임라인 경계 끌기 (전체 화면): 타임라인 높이를 직접 정함 (기억)
  const TLH_K = 'ssaka.st.tlh';
  const applyTlH = (hpx) => { if (hpx) tlEl.style.setProperty('--tl-h', `${hpx}px`); else tlEl.style.removeProperty('--tl-h'); tlEl.classList.toggle('sized', !!hpx); };
  try { const v0 = +localStorage.getItem(TLH_K); if (v0 > 80) applyTlH(v0); } catch { /* */ }
  const rz = el.querySelector('[data-tlrz]');
  rz?.addEventListener('pointerdown', (e) => {
    if (!studio.classList.contains('st-full')) return;
    e.preventDefault(); const y0 = e.clientY; const h0 = tlEl.getBoundingClientRect().height;
    try { rz.setPointerCapture(e.pointerId); } catch { /* */ }
    rz.onpointermove = (ev) => { const v = Math.round(Math.max(90, Math.min(window.innerHeight * 0.7, h0 + (y0 - ev.clientY)))); applyTlH(v); };
    rz.onpointerup = () => { rz.onpointermove = null; rz.onpointerup = null; const v = Math.round(tlEl.getBoundingClientRect().height); try { localStorage.setItem(TLH_K, String(v)); } catch { /* */ } };
  });
  rz?.addEventListener('dblclick', () => { applyTlH(0); try { localStorage.removeItem(TLH_K); } catch { /* */ } }); // 두 번 누르면 원래대로

  // 두 손가락 확대 · 이동 (영상 + 그림을 같이 키움 — 좌표는 화면 위치로 계산해서 그대로 맞음)
  let zoom = { k: 1, x: 0, y: 0 };
  const zoomChip = Object.assign(document.createElement('button'), { type: 'button', className: 'st-zoom', hidden: true });
  el.querySelector('.st-canvas-wrap').appendChild(zoomChip);
  zoomChip.onclick = () => resetZoom();
  function applyZoom() {
    const tf = zoom.k > 1.001 ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.k})` : '';
    video.style.transform = canvas.style.transform = tf;
    video.style.transformOrigin = canvas.style.transformOrigin = '0 0';
    zoomChip.hidden = zoom.k <= 1.001;
    if (!zoomChip.hidden) zoomChip.innerHTML = `<b>${Math.round(zoom.k * 100)}%</b> 전체 보기`;
  }
  function resetZoom() { zoom = { k: 1, x: 0, y: 0 }; applyZoom(); }
  const fingers = new Map();
  let pz = null;
  let fingerMark = 0;
  const restoreTo = (n) => { // 첫 손가락으로 시작한 그림 · 이동은 취소
    while (history.length > n) { const h = JSON.parse(history.pop()); tele.items = h.items; tele.trackers = h.trackers; tele.set.cals = h.cals || []; }
    draft = null; drag = null; sel = null; drawSide(); render();
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 1) fingerMark = history.length;
    if (fingers.size === 2) {
      e.stopImmediatePropagation(); e.preventDefault();
      hideLoupe();
      if (history.length > fingerMark || draft || drag) restoreTo(fingerMark);
      const [a, b] = [...fingers.values()];
      pz = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), k0: zoom.k, x0: zoom.x, y0: zoom.y, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    } else if (fingers.size > 2) e.stopImmediatePropagation();
  }, true);
  canvas.addEventListener('pointermove', (e) => {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pz) return;
    e.stopImmediatePropagation();
    if (fingers.size < 2) return;
    const [a, b] = [...fingers.values()];
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const W0 = canvas.clientWidth; const H0 = canvas.clientHeight;
    const k = Math.min(4, Math.max(1, (pz.k0 * Math.hypot(a.x - b.x, a.y - b.y)) / pz.d0));
    // 손가락 가운데 아래의 영상 지점이 그대로 손가락 가운데에 오게
    const lx = (pz.m0.x - (canvas.getBoundingClientRect().left - zoom.x) - pz.x0) / pz.k0;
    const ly = (pz.m0.y - (canvas.getBoundingClientRect().top - zoom.y) - pz.y0) / pz.k0;
    const ox = canvas.getBoundingClientRect().left - zoom.x; const oy = canvas.getBoundingClientRect().top - zoom.y;
    let x = m.x - ox - lx * k; let y = m.y - oy - ly * k;
    x = Math.min(0, Math.max(W0 * (1 - k), x)); y = Math.min(0, Math.max(H0 * (1 - k), y));
    zoom = { k, x, y };
    if (k < 1.03) zoom = { k: 1, x: 0, y: 0 };
    applyZoom();
  }, true);
  const liftFinger = (e) => {
    if (!fingers.has(e.pointerId)) return;
    fingers.delete(e.pointerId);
    if (pz) { e.stopImmediatePropagation(); if (fingers.size < 2) pz = null; }
  };
  canvas.addEventListener('pointerup', liftFinger, true);
  canvas.addEventListener('pointercancel', liftFinger, true);

  // 돋보기: 손가락으로 그리거나 끄는 동안 손가락 위에 크게 (영상 + 그림)
  let loupeEl = null;
  function showLoupe(e) {
    if (!video.videoWidth) return;
    if (!loupeEl) {
      loupeEl = document.createElement('div'); loupeEl.className = 'pad-loupe';
      loupeEl.innerHTML = '<canvas width="224" height="224" style="width:100%;height:100%;display:block"></canvas><i></i>';
      document.body.appendChild(loupeEl);
    }
    const n = toNorm(e); const r = canvas.getBoundingClientRect();
    const S = 112; const Z = 2.2; const span = S / Z; // 화면에서 보는 영역(px)
    const lc = loupeEl.firstChild.getContext('2d');
    lc.fillStyle = '#000'; lc.fillRect(0, 0, 224, 224);
    const vw = video.videoWidth; const vh = video.videoHeight;
    const sw = (span / r.width) * vw; const sh = (span / r.height) * vh;
    try { lc.drawImage(video, n.x * vw - sw / 2, n.y * vh - sh / 2, sw, sh, 0, 0, 224, 224); } catch { /* 픽셀 못 읽는 영상 */ }
    const cw = (span / r.width) * canvas.width; const ch = (span / r.height) * canvas.height;
    lc.drawImage(canvas, n.x * canvas.width - cw / 2, n.y * canvas.height - ch / 2, cw, ch, 0, 0, 224, 224);
    let top = e.clientY - S - 54; if (top < 6) top = e.clientY + 54;
    loupeEl.style.left = `${Math.min(innerWidth - S - 6, Math.max(6, e.clientX - S / 2))}px`;
    loupeEl.style.top = `${top}px`;
    loupeEl.hidden = false;
  }
  function hideLoupe() { if (loupeEl) loupeEl.hidden = true; }
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch' && !pz && (drag || draft)) showLoupe(e); });
  canvas.addEventListener('pointerup', hideLoupe);
  canvas.addEventListener('pointercancel', hideLoupe);
  syncPhone();

  // ── 크기 ──
  function fit() {
    if (!video.videoWidth || recording?.hq) return; // 내보내는 중엔 원본 크기 유지
    const wrap = el.querySelector('.st-canvas-wrap');
    const maxW = wrap.clientWidth;
    // 영상 · 재생바 · 타임라인이 한 화면에 다 들어오게
    let maxH = window.innerHeight * 0.55;
    if (window.innerWidth > 860) {
      const top = wrap.getBoundingClientRect().top + window.scrollY;
      const below = ['.st-transport', '[data-tl]'].reduce((a, q) => a + (el.querySelector(q)?.offsetHeight || 0), 0) + 24;
      maxH = window.innerHeight - top - below;
    }
    maxH = Math.max(220, maxH);
    const phoneFit = studio.classList.contains('st-phone') || studio.classList.contains('st-full'); // 전체 화면: 영상 칸 높이에 꽉
    if (phoneFit) maxH = Math.max(120, wrap.clientHeight);
    let w = maxW;
    let h = (w * video.videoHeight) / video.videoWidth;
    if (h > maxH) { h = maxH; w = (h * video.videoWidth) / video.videoHeight; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    video.style.width = canvas.style.width = `${w}px`;
    video.style.height = canvas.style.height = `${h}px`;
    canvas.style.left = `${(maxW - w) / 2}px`;
    const topOff = phoneFit ? Math.max(0, (wrap.clientHeight - h) / 2) : 0;
    canvas.style.top = `${topOff}px`; video.style.marginTop = `${topOff}px`;
    resetZoom();
    canvas.width = ground.width = Math.round(w * dpr);
    canvas.height = ground.height = Math.round(h * dpr);
    render();
  }
  let fitQueued = false;
  const ro = new ResizeObserver(() => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fit(); }); }); // 크기 변경은 다음 프레임에 한 번만
  ro.observe(el.querySelector('.st-canvas-wrap'));
  if (el.querySelector('[data-tl]')) ro.observe(el.querySelector('[data-tl]')); // 타임라인 높이가 바뀌면 영상 크기도 다시 (영상을 최대한 크게)
  state.cleanup.push(() => ro.disconnect());

  // ── 프레임 처리: 크로마키 마스크 + 트래킹 ──
  let hzAt = 0;
  const maskSoft = document.createElement('canvas'); // 경계를 살짝 부드럽게 한 마스크
  maskSoft.width = 640; maskSoft.height = 360;
  const msctx = maskSoft.getContext('2d');
  msctx.filter = 'blur(0.8px)';
  function needAnalysis(now) {
    for (const it of tele.items) {
      if (!visible(it)) continue;
      if (GROUND.has(it.k)) return true;
    }
    return tele.trackers.some((tr) => {
      if (tr.manual) return false;
      const lastT = tr.path.length ? tr.path[tr.path.length - 1][0] : -1;
      return lastT <= now + 0.001 && now <= trackUntil(tr) && tele.items.some((it) => itemPoints(it).some((p) => p && p.tr === tr.id));
    });
  }
  let frameCost = 0; // 한 프레임 처리에 걸린 시간(ms) — 무거우면 다음 프레임은 건너뜀
  let skipTill = 0;
  function processFrame(playing) {
    const now = t();
    if (Math.abs(now - lastProcessed) < 0.001) return;
    if (playing && performance.now() < skipTill) return; // 렉이 걸리지 않게 쉬어 감
    const t0p = performance.now();
    try { processFrameInner(playing, now); } finally {
      frameCost = performance.now() - t0p;
      if (playing && frameCost > 22) skipTill = performance.now() + Math.min(120, frameCost * 1.5);
    }
  }
  function processFrameInner(playing, now) {
    const dt = now - lastProcessed;
    const forward = playing && dt > 0 && dt < 0.6;
    lastProcessed = now;
    // 재생 중엔 필요할 때만 분석 (따라갈 선수 · 바닥 그림이 없으면 건너뛰어 영상이 끊기지 않게)
    if (playing && !needAnalysis(now)) return;
    if (!fa.grab(SRC(), tele.set)) return;
    fa.lastT = now;
    // 카메라 움직임 누적 (이어서 재생할 때만 · 장면 전환(컷)이나 건너뛰면 새로 시작)
    if (!camLog.length || fa.cut || Math.abs(dt) > 0.6) camLog = [[now, 0, 0]];
    else if (dt > 0) { const l = camLog[camLog.length - 1]; camLog.push([now, l[1] + fa.cam.dx, l[2] + fa.cam.dy]); if (camLog.length > 20000) camLog.splice(0, 5000); }
    else { while (camLog.length > 1 && camLog[camLog.length - 1][0] > now + 1e-3) camLog.pop(); } // 한 칸 뒤로
    if (!fa.hz || performance.now() - hzAt > 500) { fa.hz = fa.horizon(); hzAt = performance.now(); }
    msctx.clearRect(0, 0, maskSoft.width, maskSoft.height);
    msctx.drawImage(fa.mask, 0, 0, maskSoft.width, maskSoft.height);
    if (!tele.set.hueManual && !autoHued) {
      autoHued = true;
      const h = fa.autoHue();
      if (h != null && Math.abs(h - tele.set.hue) > 3) { tele.set.hue = h; fa.grab(SRC(), tele.set); }
    }
    if (!forward || !tele.set.autoTrack) return;
    // 화면이 크게 바뀌어도(카메라 급회전 · 줌 · 편집 컷) 멈추지 않고 계속 따라감 — 예측 속도만 초기화
    if (fa.cut) for (const st of trk.values()) { st.vx = 0; st.vy = 0; st.miss = Math.max(st.miss, 2); }
    for (const tr of tele.trackers) {
      if (tr.manual || tr.bg) continue; // 수동으로 찍은 선수는 찍은 점대로 · 뒤에서 AI가 계산 중인 선수는 AI 결과대로
      const lastT = tr.path.length ? tr.path[tr.path.length - 1][0] : -1;
      if (lastT > now + 0.001) continue; // 이미 기록된 구간은 기록대로 재생
      if (now - lastT > 0.75) continue; // 영상을 크게 건너뛴 경우 (다시 맞추면 이어감)
      if (now > trackUntil(tr)) continue; // 이 선수에 붙은 그림의 표시 시간이 끝나면 더 따라가지 않음
      try {
        let st = trk.get(tr.id);
        if (!st) { const q = trackerPos(tr, lastT); st = pt.init(SRC(), q.x, q.y, tele.set, fa.horizon()); trk.set(tr.id, st); }
        const r = pt.step(SRC(), st, tele.set, dt, fa.cut ? { dx: 0, dy: 0 } : fa.cam);
        tr.lost = !r.ok;
        if (!r.ok) {
          // 놓친 동안: 구간으로 기록 (화면 밖으로 나갔으면 '화면 밖' — 그동안 표시를 숨기고 나간 자리에서 기다림)
          const out = holdAtEdge(st, video.videoWidth, video.videoHeight);
          if (st.gapFrom == null) st.gapFrom = Math.max(lastT, now - dt);
          markGap(tr, st.gapFrom, now, out ? 'out' : 'lost');
          if (out) { r.x = st.x / video.videoWidth; r.y = st.y / video.videoHeight; }
        } else if (st.gapFrom != null) { closeGap(tr, st.gapFrom, now); st.gapFrom = null; }
        tr.h = +(st.ph / video.videoHeight).toFixed(4);
        if (now - lastT >= 1 / 15) tr.path.push([+now.toFixed(3), +r.x.toFixed(4), +r.y.toFixed(4), tr.h]);
        // 재생 중엔 AI 보정을 돌리지 않음 (영상이 끊기고 화면이 멈추는 원인) — 정확하게는 [AI 정밀 추적]
      } catch { tr.lost = true; }
    }
  }

  // 지금 장면에 있는 트래킹 선수들(기록된 길 안) → 그 네모 안은 선수가 그림 앞에
  function occludeTracked(now) {
    const boxes = [];
    for (const tr of tele.trackers) {
      const p = tr.path;
      if (!p.length || now < p[0][0] - 0.05 || now > p[p.length - 1][0] + 0.3) continue;
      const b = trBox(tr);
      if (b) boxes.push(b);
    }
    fa.occludeBoxes(boxes);
  }

  // 이 선수를 쓰는 그림들 중 가장 늦게 끝나는 시각
  function trackUntil(tr) {
    let until = -1;
    for (const it of tele.items) {
      if (!itemPoints(it).some((p) => p && p.tr === tr.id)) continue;
      until = Math.max(until, it.still ? it.t0 : it.t1 == null ? Infinity : it.t1);
    }
    return until < 0 ? Infinity : until;
  }

  // 나타나는 효과 진행도: 강조 멈춤 중이면 멈춘 뒤 흐른 시간, 재생 중이면 영상 시간 기준 (0.7초에 걸쳐)
  // 화살표 · 연결선은 1.6초에 걸쳐 그어지고, 나머지는 0.8초에 걸쳐 나타남 (그림마다 바꿀 수 있음)
  const animSec = (it) => it.anim ?? (it.k === 'arrow' || it.k === 'move' ? 1.6 : it.k === 'spot' ? 1.1 : it.k === 'link' ? 1.2 : 0.8);
  // 흐르는 빛 시계: 강조 멈춤 중엔 멈춘 뒤 흐른 시간, 그 밖엔 영상 시간 (내보내기에서도 똑같이)
  const flowT = () => (freeze ? clock() / 1000 : video.paused && !recording ? undefined : t()); // 멈춰서 고칠 땐 빛 없이
  function appear(it) {
    const sec = animSec(it);
    if (sec <= 0) return 1; // 0초 = 바로 보임
    if (it.k === 'arrow' && it.live) return video.paused && !recording && !freeze ? 1 : Math.min(1, Math.max(0, (t() - it.t0) / sec)); // 재생 · 내보내기 땐 영상 시간대로 그어짐, 멈춰서 고칠 땐 다 보임
    const dl = it.dl || 0; // 같은 장면 안에서 늦게 나오기 (초)
    if (freeze && freeze.items.includes(it)) return Math.min(1, Math.max(0, ((clock() - freeze.start) / 1000 - dl) / sec));
    // 강조 멈춤이 있는 그림은 멈춤 동안 이미 다 나타났으니, 다시 재생될 때 처음부터 다시 그리지 않음 (툭 끊기는 느낌 없이 이어짐)
    if (it.hold > 0 && !it.live && t() >= it.t0 - 0.02) return 1;
    if (!video.paused || recording) return Math.min(1, Math.max(0, (t() - it.t0 - dl) / sec));
    return 1;
  }

  // ── 선수 이동 ──
  const imgCache = new Map();
  const imgOf = (url) => {
    if (!imgCache.has(url)) { const im = new Image(); im.onload = () => render(); im.src = url; imgCache.set(url, im); }
    return imgCache.get(url);
  };
  // 옮긴 자리의 원근: 잔디 시작선에서 멀수록(화면 아래) 크게
  function moveScale(it) {
    const hz = fa.hz ?? 0.3;
    const b = resolve(it.b);
    const r = (b.y - hz) / Math.max(0.02, it.a.y - hz);
    return Math.min(2.2, Math.max(0.45, r));
  }
  // 선수 이동: 원래 자리에서 새 자리까지 실제로 걸어가듯 움직임 (잔상 · 그림자 · 점선 길), 멈춤이 끝날 땐 부드럽게 사라짐
  const easeIO = (x) => { const v = Math.min(1, Math.max(0, x)); return v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2; };
  function drawMove(it, w, h) {
    const im = imgOf(it.img);
    if (!im.complete || !im.naturalWidth) return;
    const prog = Math.min(1, it._prog ?? 1);
    const k = easeIO(prog);
    const fade = it._fade ?? 1;
    const a = { x: it.a.x * w, y: it.a.y * h };
    const bN = resolve(it.b);
    const bt = { x: bN.x * w, y: bN.y * h };
    const at = (kk) => ({ x: a.x + (bt.x - a.x) * kk, y: a.y + (bt.y - a.y) * kk, s: 1 + (moveScale(it) - 1) * kk });
    const iw = it.wN * w;
    const ih = it.hN * h;
    const foot = (it.foot || 0) * h;
    const col = it.color || PALETTE[0];
    const put = (p, alpha) => { ctx.globalAlpha = alpha; ctx.drawImage(im, p.x - (iw * p.s) / 2, p.y - (ih - foot) * p.s, iw * p.s, ih * p.s); };
    ctx.save();
    // 원래 자리: 선수를 지우고 주변 잔디로 메움 (예전 그림은 어두운 자국) + 옅은 윤곽으로 '여기 있었다' 표시
    const plate = it.bg && imgOf(it.bg);
    const leave = Math.min(1, prog * 2.5) * fade;
    if (plate && plate.complete && plate.naturalWidth) {
      // 잔디로 확실히 덮음: 조금 크게 · 가장자리는 흐리게 (원래 선수가 비쳐 보이지 않게) → 그 위에 옅은 '흔적'
      ctx.globalAlpha = leave;
      ctx.filter = 'blur(2px)'; ctx.drawImage(plate, a.x - iw * 0.62, a.y - ih * 1.08 + foot, iw * 1.24, ih * 1.14);
      ctx.filter = 'none'; ctx.drawImage(plate, a.x - iw / 2, a.y - ih + foot, iw, ih);
      ctx.filter = 'brightness(2.4) grayscale(1) blur(0.6px)';
      put({ ...a, s: 1 }, (it.ghost ?? 0.28) * leave);
      ctx.filter = 'none';
    } else {
      ctx.filter = 'brightness(0.3) saturate(0.3)';
      put({ ...a, s: 1 }, 0.85 * leave);
      ctx.filter = 'none';
    }
    // 지나온 길 (점선) — 움직인 만큼만
    const cur = at(k);
    ctx.globalAlpha = 0.9 * fade;
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, w / 300); ctx.setLineDash([w / 120, w / 180]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(cur.x, cur.y); ctx.stroke();
    ctx.setLineDash([]);
    // 잔상: 움직이는 동안 뒤에 옅게 몇 개 (움직임이 확실히 보이게)
    if (prog > 0 && prog < 1) for (let j = 3; j >= 1; j--) { const kj = easeIO(prog - j * 0.07); if (kj > 0 && kj < k - 0.01) put(at(kj), (0.32 - j * 0.08) * fade); }
    // 새 자리: 발밑 그림자 + 고리 + 선수 (살짝 그림자를 줘서 영상에 붙어 보이게)
    ctx.globalAlpha = 0.35 * fade;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(cur.x, cur.y, iw * cur.s * 0.45, iw * cur.s * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, w / 400);
    ctx.beginPath(); ctx.ellipse(cur.x, cur.y, iw * cur.s * 0.55, iw * cur.s * 0.18, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = Math.max(2, ih * cur.s * 0.04);
    put(cur, fade);
    ctx.restore();
  }

  // ── 선수 다듬기: 오려낸 선수 그림에서 딸려온 것을 잘라내기(네모) · 지우개 ──
  // 그림 크기는 그대로 두고(발 위치가 안 바뀌게) 투명하게만 만듦
  function trimModal(it) {
    const m = modal(`<span class="eyebrow">TRIM</span><h2>선수 다듬기</h2>
      <p class="muted small"><b>✂ 자르기</b>: 남길 부분(선수)을 네모로 끌어서 감싸면 바깥은 잘려요 · <b>지우개</b>: 딸려온 부분을 문질러 지워요</p>
      <div class="trim-bar"><div class="seg sm"><button type="button" class="on" data-tm="crop">✂ 자르기</button><button type="button" data-tm="erase">지우개</button></div>
        <label class="trim-size" hidden>지우개 크기 <input type="range" min="4" max="60" value="16" data-tbr></label>
        <span class="row"><button type="button" class="chip" data-tundo>되돌리기</button><button type="button" class="chip" data-treset>처음으로</button></span></div>
      <div class="trim-stage"><canvas data-tc></canvas></div>
      <div class="row end"><button type="button" class="btn ghost" data-tcancel>취소</button><button type="button" class="btn" data-tok>적용</button></div>`, { wide: true });
    const cv = m.el.querySelector('[data-tc]');
    const g = cv.getContext('2d');
    const orig = new Image();
    let mode = 'crop';
    let brush = 16;
    const hist = [];
    let box = null;
    orig.onload = () => {
      cv.width = orig.naturalWidth; cv.height = orig.naturalHeight;
      g.drawImage(orig, 0, 0);
      // 화면에서 크게 보이게 (최대 높이 60vh)
      const k = Math.max(1, Math.min(8, (window.innerHeight * 0.6) / cv.height, (m.el.clientWidth - 40) / cv.width));
      cv.style.width = `${cv.width * k}px`; cv.style.height = `${cv.height * k}px`;
    };
    orig.src = it.img;
    const at = (e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height }; };
    const push = () => { hist.push(g.getImageData(0, 0, cv.width, cv.height)); if (hist.length > 30) hist.shift(); };
    let base = null;
    const erase = (p) => { g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(p.x, p.y, (brush / 2) * (cv.width / cv.getBoundingClientRect().width), 0, Math.PI * 2); g.fill(); g.restore(); };
    cv.onpointerdown = (e) => {
      cv.setPointerCapture(e.pointerId);
      push();
      const p = at(e);
      if (mode === 'erase') { erase(p); box = { erasing: true }; return; }
      base = g.getImageData(0, 0, cv.width, cv.height);
      box = { a: p, b: p };
    };
    cv.onpointermove = (e) => {
      if (!box) return;
      const p = at(e);
      if (box.erasing) { erase(p); return; }
      box.b = p;
      g.putImageData(base, 0, 0);
      const x = Math.min(box.a.x, p.x); const y = Math.min(box.a.y, p.y);
      g.save(); g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, cv.width, cv.height); g.clearRect(x, y, Math.abs(p.x - box.a.x), Math.abs(p.y - box.a.y)); g.restore();
      g.putImageData(base, 0, 0, x, y, Math.abs(p.x - box.a.x), Math.abs(p.y - box.a.y));
      g.save(); g.strokeStyle = '#ffd400'; g.lineWidth = Math.max(1, cv.width / 120); g.setLineDash([4, 3]); g.strokeRect(x, y, Math.abs(p.x - box.a.x), Math.abs(p.y - box.a.y)); g.restore();
    };
    cv.onpointerup = () => {
      if (box && !box.erasing) {
        g.putImageData(base, 0, 0);
        const x = Math.round(Math.min(box.a.x, box.b.x)); const y = Math.round(Math.min(box.a.y, box.b.y));
        const w = Math.round(Math.abs(box.b.x - box.a.x)); const h = Math.round(Math.abs(box.b.y - box.a.y));
        if (w > 3 && h > 3) {
          // 네모 바깥을 투명하게
          g.save(); g.globalCompositeOperation = 'destination-in'; g.fillRect(x, y, w, h); g.restore();
        } else hist.pop(); // 그냥 누르기만 함
      }
      box = null;
    };
    m.el.querySelectorAll('[data-tm]').forEach((b) => (b.onclick = () => {
      mode = b.dataset.tm;
      m.el.querySelectorAll('[data-tm]').forEach((x) => x.classList.toggle('on', x === b));
      m.el.querySelector('.trim-size').hidden = mode !== 'erase';
      cv.style.cursor = mode === 'erase' ? 'cell' : 'crosshair';
    }));
    m.el.querySelector('[data-tbr]').oninput = (e) => { brush = +e.target.value; };
    m.el.querySelector('[data-tundo]').onclick = () => { const h = hist.pop(); if (h) g.putImageData(h, 0, 0); };
    m.el.querySelector('[data-treset]').onclick = () => { push(); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(orig, 0, 0); };
    m.el.querySelector('[data-tcancel]').onclick = m.close;
    m.el.querySelector('[data-tok]').onclick = () => {
      snapshot();
      it.img = cv.toDataURL('image/png');
      m.close();
      drawSide(); render();
      toast('선수 그림을 다듬었어요.');
    };
  }

  // ── 돋보기: 그 자리 영상(+바닥 그림)을 ×2 · ×3 · ×4 로 확대해서 동그라미 · 네모 안에 ──
  function drawZoom(it, w, h) {
    const vw = video.videoWidth; const vh = video.videoHeight;
    if (!vw || video.readyState < 2) return;
    const c = P(it.p);
    const prog = it._prog == null ? 1 : it._prog;
    const R = (it.r || 0.1) * w * (0.35 + 0.65 * Math.min(1, prog));
    const z = it.z || 2;
    const half = R / z;
    const lw = Math.max(3, w / 320);
    const path = () => {
      ctx.beginPath();
      if (it.shape === 'rect') ctx.roundRect(c.x - R, c.y - R * 0.72, R * 2, R * 1.44, R * 0.1);
      else ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
    };
    const hh = it.shape === 'rect' ? half * 0.72 : half; // 네모는 영상 비율에 가깝게 (가로가 긴 모양)
    const H2 = it.shape === 'rect' ? R * 0.72 : R;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = lw * 5; ctx.fillStyle = '#000';
    path(); ctx.fill();
    ctx.restore();
    ctx.save();
    path(); ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(SRC(), (c.x - half) * (vw / w), (c.y - hh) * (vh / h), 2 * half * (vw / w), 2 * hh * (vh / h), c.x - R, c.y - H2, 2 * R, 2 * H2);
    ctx.drawImage(ground, c.x - half, c.y - hh, 2 * half, 2 * hh, c.x - R, c.y - H2, 2 * R, 2 * H2);
    ctx.restore();
    ctx.save();
    ctx.lineWidth = lw * 1.6; ctx.strokeStyle = '#ffffff'; path(); ctx.stroke();
    ctx.lineWidth = lw * 0.7; ctx.strokeStyle = it.color || PALETTE[0]; path(); ctx.stroke();
    ctx.restore();
  }

  // ── 렌더 ──
  function render() {
    if (!canvas.width) return;
    const w = W();
    const h = H();
    ctx.clearRect(0, 0, w, h); // 영상은 아래 <video> 가 원본 화질로 재생
    const cNow = tool === 'pitch' && edit ? (calNow() || calAt()) : calAt();
    setCal(cNow ? calFrom(cNow, w, h) : null);
    // 멈춤이 끝나기 0.4초 전부터 선수 이동은 서서히 사라짐 (영상으로 돌아갈 때 툭 끊기지 않게)
    const fadeOut = freeze && freeze.until ? Math.min(1, Math.max(0, (freeze.until - clock()) / 400)) : 1;
    const vis = tele.items.filter(visible).filter((it) => !(it.k === 'spot' && it.p?.tr && trHid(it.p.tr))).map(camFollow).map((it0) => {
      const it = it0.k === 'link' ? { ...it0, pts: it0.pts.filter((q) => !q?.tr || !trHid(q.tr)) } : it0; // 화면 밖 선수는 빼고 잇기
      return it;
    }).map((it) => ({ ...withSpotSize(it), _prog: it.k === 'spot' && it.p?.tr ? Math.min(appear(it), backIn(it.p.tr, animSec(it))) : appear(it), _src: it, _hz: fa.hz, _ph: it.k === 'arrow' ? phAt(it.a) : undefined, _fade: it.k === 'move' ? fadeOut : 1, _phs: it.k === 'link' ? it.pts.map(phOf) : undefined, _flow: it.k === 'link' || it.k === 'spot' ? flowT() : undefined, _trail: it.k === 'spot' ? trailOf(it) : undefined, ...liveArrow(it) })).filter((it) => !(it._src?.dl > 0) || it._prog > 0); // 늦게 나오는 그림은 차례가 오기 전엔 안 보임
    // 바닥 레이어 (크로마키 대상)
    setGroundTex(fa.ok ? SRC() : null); // 면 채우기가 잔디 결을 살려 물들 수 있게 (영상 픽셀을 읽을 수 있을 때만)
    gctx.clearRect(0, 0, w, h);
    // 선수 뒤로 숨는 그림은 그림마다 켠 것만 (기본은 잘리지 않고 선수 위에 그대로). 휘어진(공중) 화살표는 항상 위에
    const behind = (it) => !(it.k === 'arrow' && it.c) && (it.occ ?? occDefault(it));
    vis.filter((it) => GROUND.has(it.k) && behind(it)).forEach((it) => drawSafe(gctx, it, P, w, tele.items, resolve));
    // 발밑 동그라미(선수 표시 · 연결선): 먼 쪽 반 · 그림자 · 바닥 빛은 바닥 레이어(선수 다리 뒤로), 가까운 쪽 반은 발 앞 → 바닥에 깔린 입체 느낌
    const front = [];
    const footRing = (sp, inGround) => {
      if (inGround) { drawSafe(gctx, sp, P, w, tele.items, resolve); return; }
      if (!fa.ok) { front.push(sp); return; } // 선수 모양을 모를 때는 통째로 위에
      drawSafe(gctx, { ...sp, _part: 'back' }, P, w, tele.items, resolve);
      front.push({ ...sp, _part: 'front' });
    };
    vis.filter((it) => it.k === 'spot' && !behind(it)).forEach((it) => footRing(it, false));
    // 연결선으로 이은 선수 발밑에도 원
    [...vis.filter((it) => it.k === 'link'), ...(draft?.k === 'link' ? [draft] : [])].forEach((it) => it.pts.forEach((p) => {
      if (!p.tr || trHid(p.tr)) return;
      const pulse = it._flow != null && it.flow !== false && (it._prog ?? 1) >= 1 ? 1 + 0.07 * Math.sin(it._flow * 4.2) : 1; // 발밑 원이 숨 쉬듯
      footRing({ ...withSpotSize({ k: 'spot', p, scale: 0.9 * pulse }), color: it.color, _prog: it._prog ?? 1, _flow: it._flow }, false); // 연결선 발밑 원도 앞쪽 반은 항상 보이게 (작게 붙어 있는 선수 뒤로 통째로 숨지 않게)
    }));
    if (fa.ok) {
      gctx.save();
      gctx.globalCompositeOperation = 'destination-in';
      gctx.drawImage(maskSoft, 0, 0, w, h);
      gctx.restore();
    }
    ctx.drawImage(ground, 0, 0);
    // 선수 뒤로 숨기지 않는 바닥 그림 (기본) — 잘리거나 구멍 나지 않음
    vis.filter((it) => GROUND.has(it.k) && !behind(it) && it.k !== 'spot').forEach((it) => drawSafe(ctx, it, P, w, tele.items, resolve));
    front.forEach((sp) => drawSafe(ctx, sp, P, w, tele.items, resolve));
    if (draft && GROUND.has(draft.k)) drawSafe(ctx, { ...withSpotSize(draft), _hz: fa.hz }, P, w, tele.items, resolve);
    // 위 레이어 (가려지지 않음)
    [...vis.filter((it) => it.k === 'move'), ...(draft?.k === 'move' ? [{ ...draft, _prog: 1 }] : [])].forEach((it) => drawMove(it, w, h));
    if (draft && (draft.k === 'trackbox' || draft.k === 'cutbox')) {
      const a = P(draft.a); const b = P(draft.b);
      ctx.save(); ctx.strokeStyle = draft.k === 'cutbox' ? '#ffd400' : '#4ea1ff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.restore();
    }
    vis.filter((it) => it.k === 'zoom').forEach((it) => drawZoom(it, w, h));
    drawLights([...vis.filter((it) => it.k === 'light'), ...(draft?.k === 'light' ? [{ ...draft, _prog: 1 }] : [])], w, h);
    vis.forEach((it) => {
      if (it.k === 'text') drawSafe(ctx, it, P, w, tele.items, resolve);
      if (it.k === 'measure') drawMeasureLabel(ctx, it, P, w, tele.items, resolve);
      if (it.k === 'angle') drawAngleLabel(ctx, it, P, w);
      if (it.k === 'spot') spotTop(it, w);
    });
    if (draft && draft.k === 'measure') drawMeasureLabel(ctx, draft, P, w, tele.items, resolve);
    if (draft && draft.k === 'angle') drawAngleLabel(ctx, draft, P, w);
    // 편집 표시
    if (edit && !recording) {
      if (cNow && tool === 'pitch') drawCalGuide(ctx, cNow, w, h, true);
      else if (cNow) label(ctx, cNow.fixed ? '경기장 맞춤 · 전체' : cNow.auto ? '경기장 맞춤 · 사이 자동' : `경기장 맞춤 · ${fmtT1(cNow.t)}`, w * 0.09, h - w / 40, w, '#00d1ff');
      if (man && boxesShown()) drawKeys(man.tr, w, h);
      if (gman && boxesShown()) drawKeys(gman.tr, w, h);
      if (boxesShown()) shownTrackers().forEach((tr) => {
        if (trHid(tr.id) && gman?.tr !== tr) return; // 화면 밖에 있는 동안은 네모도 숨김
        const b = drag?.box?.tr === tr ? drag.b : trBox(tr);
        if (!b) return;
        const x0 = b.x0 * w; const y0 = b.y0 * h; const x1 = b.x1 * w; const y1 = b.y1 * h;
        ctx.save();
        const c = tr.manual ? '#ff9f0a' : tr.lost ? '#ff3b30' : '#4ea1ff';
        ctx.strokeStyle = c;
        const dpr = w / canvas.clientWidth;
        ctx.lineWidth = 1.2 * dpr; ctx.globalAlpha = 0.75;
        ctx.setLineDash([5 * dpr, 4 * dpr]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        const s = Math.max(5 * dpr, w / 260);
        for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { ctx.fillRect(x - s / 2, y - s / 2, s, s); ctx.strokeRect(x - s / 2, y - s / 2, s, s); }
        // 테두리 가운데 손잡이 (가로 · 세로 크기만 바꾸기)
        const e1 = s * 0.55; const e2 = s * 1.6;
        for (const [x, y, vw, vh] of [[x0, (y0 + y1) / 2, e1, e2], [x1, (y0 + y1) / 2, e1, e2], [(x0 + x1) / 2, y0, e2, e1]]) { ctx.fillRect(x - vw / 2, y - vh / 2, vw, vh); ctx.strokeRect(x - vw / 2, y - vh / 2, vw, vh); }
        ctx.fillStyle = '#fff';
        ctx.restore();
      });
      const target = sel && tele.items.includes(sel) && visible(sel) ? sel : draft && draft.k !== 'trackbox' ? draft : null;
      if (target) {
        itemPoints(target).forEach((pt, pi) => {
          if (!pt) return;
          const p = P(pt);
          ctx.save();
          if (target.k === 'vision' && pi === 1) { ctx.fillStyle = 'rgba(78,161,255,.9)'; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(5 * (w / canvas.clientWidth), w / 240), 0, Math.PI * 2); ctx.fill(); } // 방향 · 길이 손잡이
          const dpr0 = w / canvas.clientWidth; const rr = Math.max(5 * dpr0, w / 240);
          ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 3.5 * dpr0;
          ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = pt.tr ? '#4ea1ff' : '#fff'; ctx.lineWidth = 1.8 * dpr0;
          ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        });
        if (target.k === 'offside' && !getCal()) { // 선 기울기 손잡이 (원근을 맞춘 장면은 골라인과 나란히 자동)
          const a = P(target.p); const q = P(offHandle(target)); const s = Math.max(9, w / 110);
          ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#4ea1ff'; ctx.strokeStyle = '#000'; ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s); ctx.strokeRect(q.x - s / 2, q.y - s / 2, s, s);
          ctx.restore();
        }
      }
    }
    if (cands && !recording) drawCands(w, h);
    if (freeze && !recording) {
      const left = Math.max(0, (freeze.until - performance.now()) / 1000);
      label(ctx, `⏸ ${left.toFixed(1)}초`, w - w / 14, w / 30, w, '#ffffff');
    }
    if (!fa.ok && tele.set.chroma && video.readyState >= 2) {
      label(ctx, '이 영상은 픽셀을 읽을 수 없어 크로마키·트래킹이 꺼져 있습니다 (저장소 CORS 설정 필요)', w / 2, h - w / 40, w, '#ffd400');
    }
    updateTime();
    if (recording && !recording.hq) composite(); // 고화질 내보내기는 프레임마다 따로 합성
  }

  // ── 스포트라이트: 비춘 곳만 밝게, 나머지는 어둡게 ──
  const lightC = document.createElement('canvas');
  const lctx = lightC.getContext('2d');
  const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
  function lightShape(it) {
    const p = P(it.p);
    const tr = it.p?.tr && tele.trackers.find((x) => x.id === it.p.tr);
    if (tr) { // 선수 몸 전체를 감싸는 세로 타원
      const ph = ((steadyPos(tr, t()) || trackerPos(tr, t()))?.h || tr.h || 0.08) * H();
      const ry = ph * 0.78 * (it.scale || 1);
      return { x: p.x, y: p.y - ph * 0.48, rx: ry * 0.62, ry };
    }
    const rx = (it.r || 0.06) * W();
    return { x: p.x, y: p.y, rx, ry: rx };
  }
  function drawLights(list, w, h) {
    if (!list.length) return;
    if (lightC.width !== w || lightC.height !== h) { lightC.width = w; lightC.height = h; }
    const k = ease(Math.max(...list.map((it) => it._prog ?? 1)));
    const dim = Math.max(...list.map((it) => it.dim ?? 0.68));
    lctx.clearRect(0, 0, w, h);
    lctx.fillStyle = `rgba(0,0,0,${(dim * k).toFixed(3)})`;
    lctx.fillRect(0, 0, w, h);
    lctx.globalCompositeOperation = 'destination-out';
    list.forEach((it) => {
      const sh = lightShape(it);
      const g = lctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.78, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.save(); lctx.translate(sh.x, sh.y); lctx.scale(sh.rx * 1.15, sh.ry * 1.15);
      lctx.fillStyle = g; lctx.beginPath(); lctx.arc(0, 0, 1, 0, Math.PI * 2); lctx.fill(); lctx.restore();
    });
    lctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(lightC, 0, 0);
    list.forEach((it) => {
      if (it.ring !== true) return; // 색 테두리는 켠 것만 (기본은 없음)
      const sh = lightShape(it);
      ctx.save(); ctx.globalAlpha = 0.65 * k; ctx.strokeStyle = it.color || PALETTE[0]; ctx.lineWidth = Math.max(1.5, w / 650);
      ctx.shadowColor = it.color || PALETTE[0]; ctx.shadowBlur = w / 120;
      ctx.beginPath(); ctx.ellipse(sh.x, sh.y, sh.rx, sh.ry, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    });
  }
  // 오프사이드 선 기울기 손잡이 위치 (기준점에서 선 방향으로 조금 떨어진 곳)
  function offHandle(it) {
    const a = resolve(it.p);
    const d = it.d || { x: 0, y: 1 };
    const len = Math.hypot(d.x * W(), d.y * H()) || 1;
    const L = Math.min(W(), H()) * 0.2;
    return { x: a.x + ((d.x * W()) / len) * (L / W()), y: a.y + ((d.y * H()) / len) * (L / H()) };
  }

  // 이 자리에 서 있는 선수의 화면 키(캔버스 px): 선수에 붙어 있으면 그 선수, 아니면 지금 보이는 트래킹 선수로 원근 계산
  function phAt(pt) {
    const now = t();
    if (pt?.tr) {
      const tr = tele.trackers.find((x) => x.id === pt.tr);
      const q = tr && trackerPos(tr, now);
      const h = (q && q.h) || tr?.h;
      if (h) return h * H();
    }
    const p = resolve(pt);
    let best = null;
    for (const tr of tele.trackers) {
      const path = tr.path;
      if (!path.length || now < path[0][0] - 0.1 || now > path[path.length - 1][0] + 0.5) continue;
      const q = trackerPos(tr, now); const h = (q && q.h) || tr.h;
      if (!q || !h) continue;
      const d = Math.abs(q.y - p.y);
      if (!best || d < best.d) best = { d, h, y: q.y };
    }
    if (!best) return undefined; // 기준이 될 선수가 없으면 예전처럼 화면 크기로
    const hz = fa.hz;
    const k = hz != null && best.y - hz > 0.02 && p.y - hz > 0.02 ? Math.min(2, Math.max(0.4, (p.y - hz) / (best.y - hz))) : 1;
    return best.h * k * H();
  }

  // 트래킹 선수의 실제 키에 맞춰 ▼ 표시 크기 결정 (멀리 있으면 작게, 가까우면 크게)
  function playerPx(it) {
    const tr = it.p?.tr && tele.trackers.find((x) => x.id === it.p.tr);
    const h = tr && (resolve(it.p).h || (steadyPos(tr, t()) || trackerPos(tr, t()))?.h || tr.h);
    return h ? h * H() : null;
  }
  function withSpotSize(it) {
    if (it.k !== 'spot') return it;
    const ph = playerPx(it);
    return ph ? { ...it, size: ((ph * 0.48) / W()) * (it.scale || 1) } : it;
  }
  // 크로마키 위 레이어: 트래킹 선수 머리 위 ▼ 표시 · 이름표
  function spotTop(it, w) {
    const p = P(it.p);
    const r = (it.size || 0.025) * w;
    const ph = playerPx(it) || r / 0.48;
    const head = p.y - ph * 0.96; // AI 상자 키는 실제 몸보다 조금 커서 (머리 위 표시가 떠 보이지 않게)
    const col = it.color || PALETTE[0];
    ctx.save();
    if (it.marker !== false) {
      const s = Math.max(6, r * 0.55);
      const y = head - s * 0.4;
      // 머리 위 작은 역삼각형 (테두리 없이 은은한 빛)
      ctx.fillStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = s * 0.9;
      ctx.beginPath(); ctx.moveTo(p.x - s * 0.55, y - s * 0.85); ctx.lineTo(p.x + s * 0.55, y - s * 0.85); ctx.lineTo(p.x, y); ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    const tagA = Math.min(1, Math.max(0, ((it._prog ?? 1) - 0.55) / 0.45));
    if (it.name && tagA > 0) { ctx.save(); ctx.globalAlpha = tagA; }
    if (it.name && tagA > 0) nameTag(ctx, it.name, p.x, head - Math.max(6, r * 0.55) * (it.marker !== false ? 1.9 : 0.6), w, col, it.fill);
    if (it.name && tagA > 0) ctx.restore();
  }

  // 같은 장면(0.6초 안)에 나타나는 그림들은 한 번만 멈춤 — 멈춤 시간은 그중 가장 긴 것 (도구 수만큼 늘어나지 않게)
  const HOLD_GROUP = 1.0;
  // 같은 장면 안의 순서: 그림마다 순서 번호(ord, 같은 번호는 같이) · 장면마다 간격(gap 초) → 늦게 나오기(dl) = (순서-1) × 간격
  const sceneGap = (items) => (items.find((x) => x.gap != null)?.gap ?? 0.8);
  function applyOrder(items) {
    const gap = sceneGap(items);
    items.forEach((x) => { const o = x.ord || 1; if (o > 1) x.dl = +((o - 1) * gap).toFixed(2); else delete x.dl; x.gap = gap; });
  }
  // 멈춤 길이: 가장 긴 멈춤 · 늦게 나오는 그림이 다 그려지고 잠깐 보일 때까지
  const holdLen = (hits) => Math.max(...hits.map((it) => it.hold || 0), ...hits.map((it) => (it.dl || 0) + (animSec(it) || 0) + 1));
  const holdGroup = (hits, pool) => { const t0 = Math.min(...hits.map((x) => x.t0)); return pool.filter((x) => x.hold > 0 && !x.live && x.t0 >= t0 - 1e-3 && x.t0 <= t0 + HOLD_GROUP); };
  // ── 효과 강조 멈춤: 그림이 나타나는 순간 정해진 초만큼 멈췄다가 다시 재생 ──
  let freeze = null;
  let prevPlayT = null;
  function checkHold() {
    const now = t();
    if (prevPlayT == null || now < prevPlayT) { prevPlayT = now; return false; }
    const hits = tele.items.filter((it) => it.hold > 0 && !it.live && prevPlayT < it.t0 - 0.001 && it.t0 <= now + 0.02);
    prevPlayT = now;
    if (!hits.length) return false;
    const grp = holdGroup(hits, tele.items);
    holdAt(grp, Math.min(...grp.map((it) => it.t0)), Math.max(...grp.map((it) => it.t0)));
    return true;
  }
  // 그림이 나타나는 장면에서 영상을 멈추고, 멈춤 시간 동안 그림을 보여준 뒤 다시 재생
  function holdAt(hits, at, last = at) {
    freeze = { start: performance.now(), items: hits, until: performance.now() + holdLen(hits) * 1000 };
    el.querySelector('[data-play]').textContent = '❚❚';
    video.pause();
    if (Math.abs(video.currentTime - at) > 0.02) video.currentTime = at; // 그림이 나타나는 정확한 장면에서 멈춤
    const tick = () => {
      if (!freeze) return;
      render();
      if (performance.now() >= freeze.until) { freeze = null; prevPlayT = last + 0.001; video.play(); return; }
      requestAnimationFrame(tick); // 멈춘 동안에도 계속 그려야 녹화 영상에 멈춤이 들어감
    };
    requestAnimationFrame(tick);
  }

  // 녹화 · 썸네일용 합성 캔버스 (영상 원본 해상도, 최대 1920px)
  const comp = document.createElement('canvas');
  const cctx = comp.getContext('2d');
  function composite() {
    const k = Math.min(1, 1920 / (video.videoWidth || 1280));
    comp.width = Math.round((video.videoWidth || 1280) * k);
    comp.height = Math.round((video.videoHeight || 720) * k);
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(video, 0, 0, comp.width, comp.height);
    cctx.drawImage(canvas, 0, 0, comp.width, comp.height);
    return comp;
  }

  // ── 재생 루프 ──
  const onFrame = () => {
    if (recording?.hq) return; // 영상 만드는 중엔 만들기 쪽에서 직접 그림
    try { onFrameInner(); } catch (e) { console.error('[분석실] 화면 그리기 오류', e); if (!video.paused) schedule(); } // 한 번 오류가 나도 재생 · 타임라인이 멈추지 않게
  };
  const onFrameInner = () => {
    if (!video.paused && checkHold()) return;
    if (!video.paused) { const r0 = baseRate * speedAt(t()); if (Math.abs(video.playbackRate - r0) > 1e-3) video.playbackRate = r0; } // 천천히 구간
    processFrame(!video.paused);
    render();
    if (!video.paused) schedule();
  };
  const schedule = () => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(onFrame) : requestAnimationFrame(onFrame));
  video.addEventListener('play', () => { el.querySelector('[data-play]').textContent = '❚❚'; if (prevPlayT == null) prevPlayT = t(); schedule(); });
  video.addEventListener('pause', () => {
    el.querySelector('[data-play]').textContent = freeze ? '❚❚' : '▶';
    if (freeze || recording?.hq) return; // 강조 멈춤 · 영상 만드는 중에는 그대로
    onFrame();
    if (edit && !busy && tele.trackers.some((tr) => tr.gaps)) { drawMarks(); drawSide(); } // 재생 중 생긴 놓친 구간을 바로 보여줌
    if (recording) recording.stop();
  });
  video.addEventListener('seeking', () => { if (!freeze) prevPlayT = null; });
  video.addEventListener('seeked', () => {
    if (busy) return;
    processFrame(false); render();
    // 브라우저가 새 장면을 실제로 그린 뒤에 한 번 더 읽음 — 예전 장면의 선수 자리가 구멍처럼 남지 않게
    const again = () => { if (busy || !video.paused) return; lastProcessed = -1; processFrame(false); render(); };
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(again);
    setTimeout(again, 180);
  });
  video.addEventListener('loadeddata', () => {
    fa.resize(video.videoWidth, video.videoHeight);
    fit();
    processFrame(false);
    render();
    // 브라우저로 녹화한 webm 은 길이가 Infinity → 끝으로 한 번 이동해서 길이 확정
    if (!Number.isFinite(video.duration)) {
      video.addEventListener('durationchange', function fix() {
        if (!Number.isFinite(video.duration)) return;
        video.removeEventListener('durationchange', fix);
        video.currentTime = 0;
        drawMarks();
        tlFit();
      });
      video.currentTime = 1e7;
    } else { drawMarks(); tlFit(); }
  });
  video.addEventListener('ended', () => recording?.stop());
  video.addEventListener('play', () => { if (flowSel != null) { flowSel = null; drawScenes(); } });
  video.addEventListener('error', () => toast('영상을 불러오지 못했습니다.'));
  state.cleanup.push(() => { video.pause(); video.removeAttribute('src'); video.load(); });

  function updateTime() {
    const d = video.duration || 0;
    el.querySelector('[data-time]').textContent = `${fmtT(t())} / ${fmtT(d)}`;
    if (!seeking) el.querySelector('[data-seek]').value = d ? Math.round((t() / d) * 1000) : 0;
    movePlayhead();
    moveFlowHead();
  }
  function drawMarks() {
    const d = video.duration || 0;
    el.querySelector('[data-marks]').innerHTML = d ? tele.items.map((it) => `<i style="left:${(it.t0 / d) * 100}%;width:${(((it.t1 ?? d) - it.t0) / d) * 100}%;background:${it.color || PALETTE[0]}"></i>`).join('')
      + (man ? man.tr.path.map((q) => `<b style="left:${(q[0] / d) * 100}%"></b>`).join('') : '')
      + tele.trackers.flatMap((tr) => gapsOf(tr).map((g) => `<u class="${g.k}" style="left:${(g.a / d) * 100}%;width:${((g.b - g.a) / d) * 100}%"></u>`)).join('')
      + (tele.set.cals || []).filter((c) => !c.fixed).map((c) => `<em class="cal" style="left:${(c.t / d) * 100}%" title="경기장 맞춤 ${fmtT1(c.t)}"></em>`).join('') : '';
  }

  const seek = el.querySelector('[data-seek]');
  seek.oninput = () => { seeking = true; video.currentTime = (seek.value / 1000) * (video.duration || 0); };
  seek.onchange = () => { seeking = false; };
  el.querySelector('[data-play]').onclick = () => {
    if (freeze) { freeze = null; video.pause(); return; } // 강조 멈춤 중에 누르면 그 자리에서 정지
    playSmart();
  };
  el.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => { video.pause(); video.currentTime = Math.max(0, Math.min(video.duration || 0, t() + +b.dataset.step)); }));
  let baseRate = 1;
  el.querySelector('[data-rate]').onchange = (e) => { baseRate = +e.target.value; video.playbackRate = baseRate * speedAt(t()); };
  el.querySelectorAll('[data-scene]').forEach((b) => (b.onclick = () => jumpScene(+b.dataset.scene)));
  video.addEventListener('seeked', () => markHere());
  video.addEventListener('pause', () => markHere());
  video.addEventListener('play', () => markHere());

  // ── 그림 목록 · 속성 ──
  const NAMES = { vision: '시야', angle: '각도', zoom: '돋보기', move: '선수 옮기기', shape: '영역', arrow: '화살표', spot: '선수 표시', poly: '영역', link: '선수 연결', grid: '그리드', measure: '거리', text: '글자', light: '스포트라이트', offside: '오프사이드 라인', freeze: '화면 멈춤', slow: '천천히' };
  const ICONS = { ...Object.fromEntries(TOOLS.map(([k, , ic]) => [k, ic])), spot: '◎', poly: '⬠' };
  // 같은 순간(0.06초 안)에 나타나는 그림끼리 한 장면으로
  function scenes() {
    const out = [];
    [...tele.items].sort((a, b) => a.t0 - b.t0).forEach((it) => {
      const g = out[out.length - 1];
      if (g && Math.abs(it.t0 - g.t) < 0.06) g.items.push(it); else out.push({ t: it.t0, items: [it] });
    });
    return out;
  }
  const atScene = (tt) => video.paused && Math.abs(t() - tt) < 0.06;
  const goScene = (tt) => { freeze = null; video.pause(); video.currentTime = tt + 0.01; };
  function jumpScene(dir) {
    const now = t();
    const ts = scenes().map((g) => g.t);
    const tt = dir > 0 ? ts.find((x) => x > now + 0.07) : [...ts].reverse().find((x) => x < now - 0.07);
    if (tt == null) { toast(dir > 0 ? '뒤에 그림이 있는 장면이 없어요.' : '앞에 그림이 있는 장면이 없어요.'); return; }
    goScene(tt);
  }
  const markHere = () => movePlayhead();
  function dupItem(it) {
    snapshot();
    const c = JSON.parse(JSON.stringify(it));
    c.id = uid();
    itemPoints(c).forEach((q) => { if (q && !q.tr) { q.x = +Math.min(0.99, q.x + 0.02).toFixed(4); q.y = +Math.min(0.99, q.y + 0.02).toFixed(4); } });
    tele.items.push(c);
    sel = c;
    drawSide(); render();
  }
  const delItem = (it) => { snapshot(); tele.items = tele.items.filter((x) => x !== it); if (sel === it) sel = null; drawSide(); render(); };
  function itemInfo(it) {
    if (isLive(it)) return `따라감 ${it.t1 == null ? '끝까지' : `${+(it.t1 - it.t0).toFixed(1)}초`}`;
    if (it.k === 'text') return `"${esc(it.t)}"`;
    if (it.k === 'arrow') return it.style === 'dash' ? '점선' : '실선';
    if (it.k === 'light') return '이 자리 비추기';
    if (it.k === 'offside') return '고정된 선';
    return '';
  }
  // ── 타임라인: 영상 편집 프로그램처럼 그림 하나 = 한 줄. 클립을 끌어 나오는 때 · 오른쪽 끝으로 길이 ──
  const tlS = el.querySelector('[data-tls]');
  const tlI = el.querySelector('[data-tli]');
  let pps = 0; // 1초 = 몇 px
  let tlRows = -1;
  let tlList = []; // 타임라인 줄 순서 (나오는 때 순)
  let tlVAt = 0;
  const dur = () => (video.duration && Number.isFinite(video.duration) ? video.duration : Math.max(10, ...tele.items.map((x) => (x.t1 ?? x.t0) + 5)));
  const spanOf = (it) => (isLive(it) ? Math.max(0.2, (it.t1 ?? dur()) - it.t0) : Math.max(0.3, it.hold ?? 0));
  const minPps = () => (tlS.clientWidth || 600) / dur();
  function tlFit() {
    const w = tlS.clientWidth || 600;
    const its = tele.items;
    let a = t() - 10; let b = t() + 10;
    if (its.length) { a = Math.min(...its.map((x) => x.t0)); b = Math.max(...its.map((x) => x.t0 + spanOf(x))); }
    a = Math.max(0, a - 2); b = Math.min(dur(), b + 2);
    pps = Math.min(300, Math.max(minPps(), w / Math.max(4, b - a)));
    drawTimeline();
    tlS.scrollLeft = a * pps;
  }
  function tlZoom(k) {
    const w = tlS.clientWidth;
    const at = t();
    pps = Math.min(300, Math.max(minPps(), pps * k));
    drawTimeline();
    tlS.scrollLeft = at * pps - w / 2; // 재생 위치를 가운데에 두고
  }
  function movePlayhead() {
    if (!pps) return;
    const x = t() * pps;
    el.querySelector('[data-playhead]').style.left = `${x}px`;
    if (!video.paused && (x < tlS.scrollLeft || x > tlS.scrollLeft + tlS.clientWidth - 30)) tlS.scrollLeft = x - 40; // 재생 중엔 따라감
    // 그림이 많으면 지금 나오는 그림 줄이 보이게 위아래로도 따라감 (0.3초마다 한 번만 확인)
    const nowMs = performance.now();
    if (tlList.length > 6 && nowMs - tlVAt > 300) {
      tlVAt = nowMs;
      const now = t();
      const i = tlList.findIndex((it) => now >= it.t0 - 0.1 && now <= it.t0 + spanOf(it) + 0.1);
      const body = el.querySelector('[data-tlbody]');
      if (i >= 0 && body) {
        const rowH = 25; const top = 20 + i * rowH;
        if (top < body.scrollTop + 20 || top + rowH > body.scrollTop + body.clientHeight) body.scrollTop = Math.max(0, top - 24);
      }
    }
  }
  const clipText = (it) => (it.k === 'slow' ? `천천히 ×${it.speed || 0.5} · ${+((it.t1 ?? it.t0 + 3) - it.t0).toFixed(1)}초` : it.k === 'freeze' ? `❚❚ 멈춤 ${it.hold ?? 0}초` : isLive(it) ? `⏸${it.hold ?? 0} · 따라감 ${it.t1 == null ? '끝까지' : `${+(it.t1 - it.t0).toFixed(1)}초`}` : `⏸ 멈춤 ${it.hold ?? 0}초`);
  const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  // ── 장면 카드: 같은 때(0.6초 안)에 나오는 그림을 한 장면으로 묶어 카드로 ──
  let tlMode = 'scene';
  try { tlMode = localStorage.getItem('ssaka.st.tlmode') || 'scene'; } catch { /* */ }
  const thumbs = new Map(); // 장면 시각(0.1초 단위) → 작은 사진
  const sceneKey = (t0) => Math.round(t0 * 10);
  function grabThumb(t0) {
    if (!video.videoWidth || Math.abs(t() - t0) > 0.08) return;
    try {
      const c = document.createElement('canvas'); c.width = 160; c.height = Math.round(160 * video.videoHeight / video.videoWidth);
      const x = c.getContext('2d'); x.drawImage(video, 0, 0, c.width, c.height); x.drawImage(canvas, 0, 0, c.width, c.height);
      thumbs.set(sceneKey(t0), c.toDataURL('image/jpeg', 0.6));
    } catch { /* 영상 픽셀을 못 읽으면 사진 없이 */ }
  }
  function scenesOf() {
    const list = [...tele.items].sort((a, b) => a.t0 - b.t0);
    const out = [];
    for (const it of list) {
      const last = out[out.length - 1];
      if (last && it.t0 - last.t0 <= HOLD_GROUP) last.items.push(it); else out.push({ t0: it.t0, items: [it] });
    }
    return out;
  }

  // ── 완성 영상 흐름: 내보내면 실제로 어떻게 흘러가는지 (그냥 재생 · 멈춤 · 천천히) + 선수별 추적 줄 ──
  let flowSel = null; // 아래에 펼쳐 보는 장면(시각)
  let legendOpen = (() => { try { return localStorage.getItem('ssaka.st.flq') === '1'; } catch { return false; } })();
  function flowModel() {
    const D = dur() || 0;
    const stops = scenesOf().map((g) => {
      const still = g.items.filter((x) => x.hold > 0 && !x.live && x.k !== 'slow');
      return still.length ? { t: g.t0, g, hold: Math.max(...still.map((x) => x.hold || 0)), len: holdLen(still), draws: g.items.filter((x) => x.k !== 'freeze' && x.k !== 'slow') } : null;
    }).filter(Boolean);
    const slows = tele.items.filter((x) => x.k === 'slow').map((x) => ({ a: x.t0, b: Math.min(D, x.t1 ?? D), sp: x.speed || 0.5, it: x }));
    const cuts = [...new Set([0, D, ...stops.map((x) => x.t), ...slows.flatMap((x) => [x.a, x.b])].filter((v) => v >= 0 && v <= D).map((v) => +v.toFixed(3)))].sort((a, b) => a - b);
    const blocks = [];
    for (let i = 0; i < cuts.length; i++) {
      const u = cuts[i];
      const st = stops.find((x) => Math.abs(x.t - u) < 1e-3);
      if (st) blocks.push({ k: 'stop', a: u, b: u, len: st.len, st });
      if (i === cuts.length - 1) break;
      const v = cuts[i + 1];
      if (v - u < 1e-3) continue;
      const sl = slows.find((x) => u >= x.a - 1e-3 && v <= x.b + 1e-3);
      const last = blocks[blocks.length - 1];
      if (!sl && last && last.k === 'play') { last.b = v; last.len += v - u; } else blocks.push({ k: sl ? 'slow' : 'play', a: u, b: v, len: (v - u) / (sl ? sl.sp : 1), sl });
    }
    return { D, blocks, total: blocks.reduce((x, b) => x + b.len, 0), stops, slows };
  }
  // 필름 줄: 원본 영상을 장면 사진 24장으로 (따로 연 영상에서 한 번만 · 그동안 화면은 그대로)
  let filmUrl = null; let filmBusy = false;
  async function makeFilm() {
    if (filmUrl || filmBusy || !studio.isConnected) return;
    filmBusy = true;
    try {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = video.currentSrc || video.src;
      await new Promise((r, j) => { v.onloadeddata = r; v.onerror = j; setTimeout(r, 8000); });
      const D = v.duration || dur(); if (!D || !v.videoWidth) throw new Error('no video');
      const N = 24; const tw = 96; const th = Math.round((tw * v.videoHeight) / v.videoWidth);
      const c = document.createElement('canvas'); c.width = tw * N; c.height = th; const cx2 = c.getContext('2d');
      for (let i = 0; i < N && studio.isConnected; i++) {
        await new Promise((r) => { const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); r(); }; const to = setTimeout(done, 2500); v.addEventListener('seeked', done); v.currentTime = Math.min(D - 0.05, ((i + 0.5) * D) / N); });
        cx2.drawImage(v, i * tw, 0, tw, th);
      }
      filmUrl = c.toDataURL('image/jpeg', 0.72);
      v.removeAttribute('src'); v.load();
      drawFlow();
    } catch { filmUrl = ''; } // 픽셀을 못 읽는 영상(다른 사이트 주소)은 필름 줄 없이
    filmBusy = false;
  }
  // 지금 영상 시각 → 완성 영상에서의 위치(초)
  const outAt = (m, now) => { let o = 0; for (const b of m.blocks) { if (b.k === 'stop') { if (now > b.a + 1e-3) o += b.len; continue; } if (now >= b.b) o += b.len; else if (now > b.a) { o += (now - b.a) * (b.len / (b.b - b.a)); break; } else break; } return o; };
  function drawFlow() {
    const box = el.querySelector('[data-flow]');
    if (!box) return;
    if (tlMode !== 'scene') { box.innerHTML = ''; return; }
    const m = flowModel();
    if (!m.D) { box.innerHTML = ''; return; }
    const nStop = m.stops.length; const nSlow = m.slows.length;
    const lab = (x) => `<i style="--c:${x.color || PALETTE[0]}">${NAMES[x.k]}${x.k === 'text' ? ` ${esc((x.t || '').slice(0, 6))}` : ''}</i>`;
    const blocksHtml = m.blocks.map((b, i) => {
      if (b.k === 'stop') {
        const on = flowSel != null ? Math.abs(flowSel - b.a) < 1e-3 : false;
        const kf = b.st.draws.filter((x) => (x.dl || 0) > 0).map((x) => `<em style="left:${Math.min(92, ((x.dl || 0) / b.len) * 100)}%"></em>`).join('');
        return `<button type="button" class="fl-b stop ${on ? 'on' : ''}" style="flex:${b.len} 0 0" data-fb="${i}" title="${fmtT1(b.a)} 장면 · ${b.st.hold}초 멈춤 — 눌러서 이 장면 설정 · 끝을 끌어 길이 조절"><b>❚❚ ${+b.len.toFixed(1)}초</b><span class="fl-tags">${b.st.draws.slice(0, 4).map(lab).join('')}${b.st.draws.length > 4 ? `<i>+${b.st.draws.length - 4}</i>` : ''}</span>${kf ? `<span class="fl-kf">${kf}</span>` : ''}${edit ? '<span class="fl-grip" data-fgrip></span>' : ''}</button>`;
      }
      if (b.k === 'slow') return `<button type="button" class="fl-b slow" style="flex:${b.len} 0 0" data-fb="${i}" title="${fmtT1(b.a)} → ${fmtT1(b.b)} 천천히 ×${b.sl.sp}"><b>½ 천천히</b><span class="fl-sub">×${b.sl.sp}</span></button>`;
      return `<button type="button" class="fl-b play" style="flex:${b.len} 0 0" data-fb="${i}" title="${fmtT1(b.a)} → ${fmtT1(b.b)} 그냥 재생"><span class="fl-sub">${b.len > 2.5 ? `▶ ${fmtT(b.a)}` : ''}</span></button>`;
    }).join('');
    // 선수 줄 (영상 시각 기준): 기록된 길 · AI로 계산한 구간 · 놓친/화면 밖 구간
    const used = tele.trackers.filter((tr) => tele.items.some((it) => itemPoints(it).some((q) => q && q.tr === tr.id)));
    const pct = (v) => `${Math.max(0, Math.min(100, (v / m.D) * 100)).toFixed(2)}%`;
    const lanes = used.map((tr) => {
      const p0 = tr.path[0]?.[0]; const p1 = lastT(tr);
      if (p0 == null) return '';
      const aiEnd = Math.min(p1, tr.aiTo ?? -1);
      const gs = gapsOf(tr);
      return `<div class="fl-lane"><span class="fl-nm" title="${esc(tr.name)}">${esc(tr.name)}</span><div class="fl-cv">
        <i class="col" style="left:${pct(p0)};width:${pct(p1 - p0)}" title="재생하며 색으로 따라간 구간"></i>
        ${aiEnd > p0 ? `<i class="ai" style="left:${pct(p0)};width:${pct(aiEnd - p0)}" title="AI로 정확히 따라간 구간"></i>` : ''}
        ${gs.map((g, gi) => `<i class="gap ${g.k}" style="left:${pct(g.a)};width:${pct(Math.max(g.b - g.a, m.D * 0.004))}" data-fgap="${tr.id}:${gi}" title="${g.k === 'out' ? '화면 밖' : '놓친 구간 — 눌러서 그 장면으로'} ${fmtT1(g.a)} → ${fmtT1(g.b)}"></i>`).join('')}
        <b class="ph" style="left:${pct(t())}"></b></div></div>`;
    }).join('');
    box.innerHTML = `<div class="fl-head"><span class="fl-tot">${fmtT1(m.D)} 영상 → <em>${fmtT1(m.total)}</em> 완성</span><span class="fl-meta">${nStop ? `멈춤 ${nStop}번` : '멈춤 없음'}${nSlow ? ` · 천천히 ${nSlow}번` : ''}</span><button type="button" class="fl-q ${legendOpen ? 'on' : ''}" data-flq title="색 설명 보기">색 설명</button></div>
      ${filmUrl ? `<div class="fl-row"><span class="fl-lab">영상</span><div class="fl-film" data-ffilm style="background-image:url(${filmUrl})">${m.stops.map((x) => `<em style="left:${pct(x.t)}" title="${fmtT1(x.t)} 멈춤"></em>`).join('')}${m.slows.map((x) => `<u style="left:${pct(x.a)};width:${pct(x.b - x.a)}"></u>`).join('')}<b class="ph" style="left:${pct(t())}"></b></div></div>` : ''}
      <div class="fl-row"><span class="fl-lab">완성 영상</span><div class="fl-blocks" data-fblocks>${blocksHtml}<b class="fl-ph" data-fph style="left:${((outAt(m, t()) / (m.total || 1)) * 100).toFixed(2)}%"></b></div></div>
      ${lanes ? `<div class="fl-row lanes"><span class="fl-lab">선수</span><div class="fl-lanes">${lanes}</div></div>` : ''}
      <div class="fl-legend" ${legendOpen ? '' : 'hidden'}><span><i class="play"></i>그냥 재생</span><span><i class="stop"></i>멈춰서 그림 보여주기${edit ? ' (끝을 끌어 길이)' : ''}</span><span><i class="slow"></i>천천히</span>${lanes ? '<span><i class="ai"></i>AI로 정확히</span><span><i class="col"></i>재생하며 색으로</span><span><i class="gap"></i>놓침</span>' : ''}</div>`;
    box.querySelector('[data-flq]').onclick = () => { legendOpen = !legendOpen; try { localStorage.setItem('ssaka.st.flq', legendOpen ? '1' : '0'); } catch { /* */ } drawFlow(); };
    const film = box.querySelector('[data-ffilm]');
    if (film) film.onclick = (e) => { const r = film.getBoundingClientRect(); flowSel = null; freeze = null; video.pause(); video.currentTime = Math.max(0, Math.min(m.D, ((e.clientX - r.left) / r.width) * m.D)); };
    if (filmUrl == null && !filmBusy) setTimeout(makeFilm, 1200);
    const blocksEl = box.querySelector('[data-fblocks]');
    box.querySelectorAll('[data-fb]').forEach((elB) => {
      const b = m.blocks[+elB.dataset.fb];
      elB.onclick = (e) => {
        if (elB._dragged) { elB._dragged = false; return; }
        if (b.k === 'stop') { flowSel = b.a; goScene(b.a); setTimeout(() => { drawSide(); render(); }, 120); return; }
        const r = elB.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        flowSel = null; freeze = null; video.pause(); video.currentTime = b.a + (b.b - b.a) * f;
      };
      const grip = elB.querySelector('[data-fgrip]');
      if (grip && b.k === 'stop') grip.onpointerdown = (e) => {
        e.stopPropagation(); e.preventDefault();
        const pxPerSec = blocksEl.clientWidth / (m.total || 1);
        const still = b.st.g.items.filter((x) => x.hold > 0 && !x.live && x.k !== 'slow');
        const h0 = b.st.hold; const x0 = e.clientX; snapshot();
        try { grip.setPointerCapture(e.pointerId); } catch { /* */ }
        grip.onpointermove = (ev) => { const v = Math.max(0.5, Math.min(30, Math.round((h0 + (ev.clientX - x0) / pxPerSec) * 2) / 2)); still.forEach((x) => { x.hold = v; }); elB.querySelector('b').textContent = `❚❚ ${v}초`; setHint(`멈춤 ${v}초`); };
        grip.onpointerup = () => { grip.onpointermove = null; grip.onpointerup = null; elB._dragged = true; dirty = true; setHint(); drawSide(); render(); };
      };
    });
    box.querySelectorAll('[data-fgap]').forEach((g) => (g.onclick = (e) => {
      e.stopPropagation();
      const [id, gi] = g.dataset.fgap.split(':'); const tr = tele.trackers.find((x) => x.id === id); const gp = tr && gapsOf(tr)[+gi];
      if (!gp) return;
      freeze = null; video.pause(); video.currentTime = gp.a + 0.01; sel = null; setTool('select');
      toast(`${tr.name}을(를) ${fmtT1(gp.a)}에서 놓쳤어요 — 오른쪽 선수 칸에서 [AI로 다시 잡기] · [직접 찍기]`);
    }));
  }
  let lastPickKey = '';
  function moveFlowHead() {
    const ph = el.querySelector('[data-fph]');
    if (!ph) return;
    // 지금 장면이 바뀌면 아래 장면 설정 칸도 바꿈 (흐름에서 고른 장면이 없을 때)
    if (flowSel == null) { const now = t(); const g = scenesOf().find((x) => now >= x.t0 - 0.06 && now <= x.t0 + HOLD_GROUP); const key = g ? String(g.t0) : ''; if (key !== lastPickKey) { lastPickKey = key; drawScenes(); return; } }
    const m = flowModel();
    ph.style.left = `${((outAt(m, t()) / (m.total || 1)) * 100).toFixed(2)}%`;
    el.querySelectorAll('.fl-cv .ph, .fl-film .ph').forEach((b) => { b.style.left = `${Math.max(0, Math.min(100, (t() / (m.D || 1)) * 100)).toFixed(2)}%`; });
  }
  function drawScenes() {
    const box = el.querySelector('[data-scenes]');
    if (!box) return;
    el.querySelector('[data-tl]').classList.toggle('scene-mode', tlMode === 'scene');
    el.querySelectorAll('[data-tlmode]').forEach((b) => b.classList.toggle('on', b.dataset.tlmode === tlMode));
    drawFlow();
    if (tlMode !== 'scene') { box.innerHTML = ''; return; }
    const sc = scenesOf();
    const now = t();
    // 펼쳐 볼 장면: 흐름에서 누른 장면 → 아니면 지금 시각의 장면 (나머지는 위 '완성 영상' 막대에서)
    const pickI = (() => { const byT = (tt) => sc.findIndex((g) => Math.abs(g.t0 - tt) < 1e-3); const a = flowSel != null ? byT(flowSel) : -1; if (a >= 0) return a; return sc.findIndex((g) => now >= g.t0 - 0.06 && now <= g.t0 + HOLD_GROUP); })();
    box.innerHTML = sc.map((g, i) => {
      if (i !== pickI) return '';
      const hold = Math.max(0, ...g.items.filter((x) => !x.live && x.k !== 'slow').map((x) => x.hold || 0));
      const slow = g.items.find((x) => x.k === 'slow');
      const on = now >= g.t0 - 0.06 && now <= g.t0 + HOLD_GROUP;
      const th = thumbs.get(sceneKey(g.t0));
      const draws = g.items.filter((x) => x.k !== 'freeze' && x.k !== 'slow').sort((a, b) => (a.ord || 1) - (b.ord || 1));
      const seq = draws.some((x) => (x.ord || 1) > 1);
      const gap = sceneGap(draws);
      const ics = draws.map((x) => `<span title="${NAMES[x.k]}${seq ? ` · ${x.ord || 1}번째 (${x.dl || 0}초 뒤) — 눌러서 순서 바꾸기` : ''}" style="--c:${x.color || PALETTE[0]}" data-ord="${tele.items.indexOf(x)}">${seq ? `<i>${x.ord || 1}</i>` : ''}${ICONS[x.k] || '•'}</span>`).join('');
      return `<div class="sc-card ${on ? 'on' : ''}" data-sc="${i}">
        <div class="sc-thumb">${th ? `<img src="${th}" alt="">` : `<b>${fmtT1(g.t0)}</b>`}<em>${fmtT1(g.t0)}</em></div>
        <div class="sc-ics">${ics || '<small>그림 없음</small>'}</div>
        <div class="sc-row">${edit ? `<button type="button" class="st-mini" data-hm title="멈춤 줄이기">−</button><span>${hold ? `❚❚ ${hold}초` : '멈춤 없음'}</span><button type="button" class="st-mini" data-hp title="멈춤 늘리기">+</button>` : `<span>${hold ? `❚❚ ${hold}초` : ''}</span>`}</div>
        ${edit && draws.length > 1 ? `<div class="sc-row"><button type="button" class="chip sm ${seq ? 'on' : ''}" data-seq title="같이 나오기 / 차례로 나오기">${seq ? '차례로 나옴' : '같이 나옴'}</button></div>` : ''}
        ${edit && seq ? `<div class="sc-row"><button type="button" class="st-mini" data-gm title="간격 줄이기">−</button><span>간격 ${gap}초</span><button type="button" class="st-mini" data-gp title="간격 늘리기">+</button></div>` : ''}
        ${edit ? `<div class="sc-row"><button type="button" class="chip sm ${slow ? 'on' : ''}" data-slow>½ 천천히${slow ? ` ×${slow.speed || 0.5}` : ''}</button></div>` : ''}
      </div>`;
    }).join('') + (edit ? '<button type="button" class="sc-add" data-scadd title="지금 장면에 멈춤 넣기">＋<small>지금 장면</small></button>' : '') + (!sc.length ? '<p class="muted small sc-empty">그림을 그리면 위 \'완성 영상\' 막대에 멈춤 블록이 생겨요. 블록을 누르면 그 장면 설정이 여기 나와요.</p>' : pickI < 0 ? '<p class="muted small sc-empty">위 막대의 노란 멈춤 블록을 누르면 그 장면 설정(멈춤 길이 · 나오는 순서 · 천천히)이 여기 나와요.</p>' : '');
    box.querySelectorAll('[data-sc]').forEach((card) => {
      const g = sc[+card.dataset.sc];
      const setHold = (d) => { snapshot(); const still = g.items.filter((x) => !x.live && x.k !== 'slow'); const cur = Math.max(0, ...still.map((x) => x.hold || 0)); const v = Math.max(0, Math.min(30, cur + d)); still.forEach((x) => { x.hold = v; }); if (!still.length && v > 0) tele.items.push({ id: uid(), k: 'freeze', t0: g.t0, hold: v, color: '#ffffff' }); dirty = true; drawSide(); render(); };
      card.querySelector('[data-hm]')?.addEventListener('click', (e) => { e.stopPropagation(); setHold(-1); });
      card.querySelector('[data-hp]')?.addEventListener('click', (e) => { e.stopPropagation(); setHold(+1); });
      const draws = g.items.filter((x) => x.k !== 'freeze' && x.k !== 'slow').sort((a, b) => (a.ord || 1) - (b.ord || 1));
      const done = () => { applyOrder(draws); dirty = true; drawSide(); render(); };
      // 같이 ↔ 차례로 (지금 순서대로 1, 2, 3 …)
      card.querySelector('[data-seq]')?.addEventListener('click', (e) => {
        e.stopPropagation(); snapshot();
        const seq = draws.some((x) => (x.ord || 1) > 1);
        draws.forEach((x, n) => { if (seq) delete x.ord; else x.ord = n + 1; });
        done();
      });
      // 간격 (0.2초 ~ 5초)
      const setGap = (d) => { snapshot(); const g0 = sceneGap(draws); const v = +Math.max(0.2, Math.min(5, g0 + d)).toFixed(1); draws.forEach((x) => { x.gap = v; }); done(); };
      card.querySelector('[data-gm]')?.addEventListener('click', (e) => { e.stopPropagation(); setGap(-0.2); });
      card.querySelector('[data-gp]')?.addEventListener('click', (e) => { e.stopPropagation(); setGap(+0.2); });
      // 차례로일 때 아이콘을 누르면 그 그림의 순서 번호가 1 → 2 → … → (그림 수) → 1 로 바뀜 (같은 번호는 같이 나옴)
      card.querySelectorAll('[data-ord]').forEach((ic) => ic.addEventListener('click', (e) => {
        if (!draws.some((x) => (x.ord || 1) > 1)) return;
        e.stopPropagation(); snapshot();
        const it0 = tele.items[+ic.dataset.ord];
        it0.ord = ((it0.ord || 1) % draws.length) + 1;
        done();
      }));
      card.querySelector('[data-slow]')?.addEventListener('click', (e) => {
        e.stopPropagation(); snapshot();
        const s0 = g.items.find((x) => x.k === 'slow');
        if (!s0) tele.items.push({ id: uid(), k: 'slow', t0: g.t0, t1: +Math.min(dur() || g.t0 + 3, g.t0 + 3).toFixed(2), speed: 0.5, hold: 0, color: '#4ea1ff' });
        else if ((s0.speed || 0.5) === 0.5) s0.speed = 0.25; else tele.items = tele.items.filter((x) => x !== s0);
        dirty = true; drawSide(); render();
      });
      // 누르면 그 장면으로 · 옆으로 끌면 장면(그림 전부)의 시각을 옮김
      card.onpointerdown = (e) => {
        if (e.target.closest('button')) return;
        const o = { x: e.clientX, t0: g.t0, ts: g.items.map((x) => [x, x.t0, x.t1]) };
        let moved = false;
        try { card.setPointerCapture(e.pointerId); } catch { /* */ }
        card.onpointermove = (ev) => {
          if (!edit) return;
          const dx = ev.clientX - o.x;
          if (!moved && Math.abs(dx) < 6) return;
          if (!moved) { moved = true; snapshot(); }
          const d = +(Math.max(-o.t0, Math.min((dur() || 0) - o.t0, dx / 40 * 0.5))).toFixed(1); // 40px = 0.5초
          o.ts.forEach(([x, a, b]) => { x.t0 = +(a + d).toFixed(2); if (b != null) x.t1 = +(b + d).toFixed(2); });
          card.querySelector('.sc-thumb em').textContent = fmtT1(o.t0 + d);
          setHint(`장면 시각 ${fmtT1(o.t0 + d)} — 놓으면 그 장면으로 가요`);
        };
        card.onpointerup = () => {
          card.onpointermove = null; card.onpointerup = null; setHint();
          const t0 = g.items[0].t0;
          goScene(t0);
          if (edit) { sel = g.items.find((x) => x.k !== 'freeze' && x.k !== 'slow') || g.items[0]; drawSide(); }
          setTimeout(() => { grabThumb(t0); drawScenes(); }, 450);
          render();
        };
      };
    });
    box.querySelector('[data-scadd]')?.addEventListener('click', () => addTimeItem('freeze'));
    // 지금 멈춰 있는 장면의 사진이 없으면 찍어 둠
    if (video.paused) for (const g of sc) if (!thumbs.has(sceneKey(g.t0)) && Math.abs(now - g.t0) < 0.08) { grabThumb(g.t0); }
  }
  el.querySelectorAll('[data-tlmode]').forEach((b) => (b.onclick = () => { tlMode = b.dataset.tlmode; try { localStorage.setItem('ssaka.st.tlmode', tlMode); } catch { /* */ } drawScenes(); requestAnimationFrame(fit); }));
  function drawTimeline() {
    drawScenes();
    if (!pps) { tlFit(); return; }
    const D = dur();
    tlI.style.width = `${Math.ceil(D * pps) + 60}px`;
    const step = STEPS.find((x) => x * pps >= 70) || 300;
    let ticks = '';
    for (let x = 0; x <= D + 1e-6; x += step) ticks += `<i style="left:${x * pps}px"><span>${step < 1 ? fmtT1(x) : fmtT(x)}</span></i>`;
    el.querySelector('[data-ruler]').innerHTML = ticks;
    const list = [...tele.items].sort((x, y) => x.t0 - y.t0);
    tlList = list;
    el.querySelector('[data-heads]').innerHTML = list.map((it) => `<div class="tl-head ${it === sel ? 'on' : ''}" data-i="${tele.items.indexOf(it)}" title="${fmtT1(it.t0)}">
        <span class="dot" style="background:${it.color || PALETTE[0]}"></span><span class="st-ic">${ICONS[it.k] || '•'}</span><b>${NAMES[it.k]}${it.name ? ` · ${esc(it.name)}` : ''}${it.k === 'text' ? ` "${esc(it.t)}"` : ''}</b>
        ${edit ? '<button type="button" class="st-mini" data-dup title="복제 (Ctrl+D)">⧉</button><button type="button" class="st-mini" data-idel title="삭제 (Delete)">✕</button>' : ''}</div>`).join('')
      || '<div class="tl-empty"></div>';
    el.querySelector('[data-rows]').innerHTML = list.map((it) => `<div class="tl-row ${it === sel ? 'on' : ''}"><div class="tl-clip ${isLive(it) ? 'live' : 'still'} ${it === sel ? 'on' : ''}" data-i="${tele.items.indexOf(it)}"
        style="left:${it.t0 * pps}px;width:${Math.max(16, spanOf(it) * pps)}px;--c:${it.color || PALETTE[0]}"><span>${clipText(it)}</span>${edit ? '<em class="tl-grip" data-grip title="끌어서 길이 조절"></em>' : ''}</div></div>`).join('')
      || '<div class="tl-row"></div>';
    el.querySelector('[data-count]').textContent = tele.items.length ? `${tele.items.length}개` : '';
    if (list.length !== tlRows) { tlRows = list.length; requestAnimationFrame(fit); }
    bindTimeline();
    movePlayhead();
  }
  function bindTimeline() {
    el.querySelectorAll('[data-heads] .tl-head').forEach((hd) => {
      const it = tele.items[+hd.dataset.i];
      hd.onclick = (e) => {
        if (e.target.closest('[data-dup]')) { dupItem(it); return; }
        if (e.target.closest('[data-idel]')) { delItem(it); return; }
        if (!atScene(it.t0)) goScene(it.t0);
        if (edit) { sel = it; drawSide(); render(); }
        tlS.scrollLeft = Math.max(0, it.t0 * pps - 60);
      };
    });
    el.querySelectorAll('[data-rows] .tl-clip').forEach((cl) => {
      const it = tele.items[+cl.dataset.i];
      cl.onpointerdown = (e) => {
        e.stopPropagation();
        if (!edit) { goScene(it.t0); return; }
        try { cl.setPointerCapture(e.pointerId); } catch { /* */ }
        const mode = e.target.closest('[data-grip]') ? 'len' : 'move';
        const o = { x: e.clientX, t0: it.t0, t1: it.t1, hold: it.hold ?? 0 };
        let moved = false;
        const others = tele.items.filter((x) => x !== it).map((x) => x.t0);
        cl.onpointermove = (ev) => {
          const dx = ev.clientX - o.x;
          if (!moved && Math.abs(dx) < 3) return;
          if (!moved) { moved = true; snapshot(); }
          const dt = dx / pps;
          if (mode === 'move') {
            let n0 = Math.max(0, Math.min(dur() - 0.05, o.t0 + dt));
            // 재생 위치 · 다른 그림 시작에 착 붙기
            for (const c of [t(), ...others]) if (Math.abs((n0 - c) * pps) < 8) { n0 = c; break; }
            it.t0 = +n0.toFixed(2);
            if (o.t1 != null) it.t1 = +(o.t1 + (it.t0 - o.t0)).toFixed(2);
            cl.style.left = `${it.t0 * pps}px`;
            setHint(`나오는 때 ${fmtT1(it.t0)} — 놓으면 그 장면으로 이동해요`);
          } else if (isLive(it)) {
            it.t1 = +Math.max(it.t0 + 0.2, Math.min(dur(), (o.t1 ?? dur()) + dt)).toFixed(2);
            cl.style.width = `${Math.max(16, spanOf(it) * pps)}px`;
            cl.querySelector('span').textContent = clipText(it);
          } else {
            it.hold = Math.max(0, Math.min(30, Math.round((o.hold + dt) * 2) / 2));
            cl.style.width = `${Math.max(16, spanOf(it) * pps)}px`;
            cl.querySelector('span').textContent = clipText(it);
          }
        };
        cl.onpointerup = () => {
          cl.onpointermove = null; cl.onpointerup = null;
          sel = it;
          if (!moved || mode === 'move') goScene(it.t0);
          setHint();
          drawSide(); render();
        };
      };
    });
  }
  // 눈금 · 빈 곳을 누르거나 끌면 영상 이동 (스크럽)
  tlI.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tl-clip')) return;
    try { tlI.setPointerCapture(e.pointerId); } catch { /* */ }
    const seekX = (ev) => { const r = tlI.getBoundingClientRect(); freeze = null; video.pause(); video.currentTime = Math.max(0, Math.min(dur(), (ev.clientX - r.left) / pps)); };
    seekX(e);
    tlI.onpointermove = (ev) => seekX(ev);
    tlI.onpointerup = () => { tlI.onpointermove = null; tlI.onpointerup = null; };
  });
  // 위아래로 내려도 시간 눈금은 맨 위에 (가로 스크롤 칸 안이라 sticky 가 안 먹어서 직접 붙임)
  const tlBody = el.querySelector('[data-tlbody]');
  tlBody.addEventListener('scroll', () => { el.querySelector('[data-ruler]').style.transform = `translateY(${tlBody.scrollTop}px)`; });
  tlS.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); tlZoom(e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
  el.querySelectorAll('[data-tz]').forEach((b) => (b.onclick = () => (+b.dataset.tz ? tlZoom(+b.dataset.tz > 0 ? 1.6 : 1 / 1.6) : tlFit())));

  function drawSide() {
    if (!el.isConnected || !el.querySelector('[data-ruler]')) return; // 다른 화면으로 나간 뒤 (AI 준비가 늦게 끝난 경우)
    drawTimeline();
    if (edit) drawProps();
    drawMarks();
  }

  function drawProps() {
    const box = el.querySelector('[data-props]');
    const cNow = tool === 'pitch' ? calNow() : null;
    if (tool === 'pitch' && edit && !cNow) {
      // 맞춘 장면이 아닌 곳으로 옮겼을 때: 여기서 한 번 더 맞추기
      box.innerHTML = `<h4>경기장 맞추기</h4><p class="muted small">${calAt() ? '지금은 앞뒤에 맞춘 장면을 <b>자동으로 이어서</b> 보여주는 중이에요. 어긋나 보이면 여기서 한 번 더 맞추세요.' : '이 장면은 아직 맞추지 않았어요.'}</p>
        <div class="row st-btnrow"><button type="button" class="btn sm" data-cnew>이 장면에서 맞추기</button></div>`;
      box.querySelector('[data-cnew]').onclick = () => setTool('pitch');
      return;
    }
    if (cNow) {
      const c = cNow;
      box.innerHTML = `${afterCal === 'measure' ? '<div class="st-steps"><b class="on">1 경기장 맞추기</b><span>→</span><b>2 거리 재기</b></div>' : ''}<h4>경기장 맞추기</h4>

        <div class="st-num"><span>기준</span><div class="seg sm">${Object.entries(CAL_TPL).map(([k, v]) => `<button type="button" class="${c.tpl === k ? 'on' : ''}" data-ctpl="${k}">${v.l}</button>`).join('')}</div></div>
        ${c.tpl === 'rect' ? `<div class="grid2 st-gridin"><label>골라인 쪽 길이(m)<input type="number" min="1" max="110" step="0.1" value="${c.h || 20}" data-ch></label><label>앞으로 깊이(m)<input type="number" min="1" max="110" step="0.1" value="${c.w || 20}" data-cw></label></div>` : ''}
        <div class="row st-btnrow"><button type="button" class="btn ghost sm" data-crot>↻ 골라인 바꾸기</button><button type="button" class="btn ghost sm" data-ct>지금 장면</button></div>
        <label class="mini-switch"><input type="checkbox" data-cfix ${c.fixed ? 'checked' : ''}> 모든 장면에 적용 (고정 카메라)</label>

        ${tele.set.cals.length > 1 ? `<div class="st-num"><span>맞춘 장면 ${tele.set.cals.length}개</span></div><div class="row st-btnrow" style="flex-wrap:wrap">${[...tele.set.cals].sort((a, b) => a.t - b.t).map((x) => `<button type="button" class="chip ${x === c ? 'on' : ''}" data-cgo="${x.t}">${fmtT1(x.t)}</button>`).join('')}</div>` : ''}
        <p class="muted small" style="margin:6px 0 0">카메라가 움직여 경기장이 어긋나면, 그 장면에서 <b>한 번 더 맞추고 저장</b>하세요. 맞춘 장면 사이는 <b>시간에 따라 자동으로 이어져요</b>.</p>
        <div class="row st-btnrow"><button type="button" class="btn sm" data-csave>✓ 저장</button><button type="button" class="btn ghost sm" data-cdel>맞추기 지우기</button></div>`;
      const ch = (fn) => () => { snapshot(); fn(); drawSide(); render(); };
      box.querySelectorAll('[data-ctpl]').forEach((b) => (b.onclick = ch(() => { c.tpl = b.dataset.ctpl; })));
      box.querySelector('[data-ch]')?.addEventListener('change', ch(() => { c.h = Math.max(1, +box.querySelector('[data-ch]').value || 20); }));
      box.querySelector('[data-cw]')?.addEventListener('change', ch(() => { c.w = Math.max(1, +box.querySelector('[data-cw]').value || 20); }));
      box.querySelector('[data-crot]').onclick = ch(() => { c.q = [c.q[1], c.q[2], c.q[3], c.q[0]]; });
      box.querySelector('[data-ct]').onclick = ch(() => { c.t = +t().toFixed(2); });
      box.querySelector('[data-cfix]').onchange = ch(() => { c.fixed = !c.fixed; if (c.fixed) tele.set.cals.forEach((x) => { if (x !== c) delete x.fixed; }); });
      box.querySelector('[data-cdel]').onclick = ch(() => { tele.set.cals = tele.set.cals.filter((x) => x !== c); });
      box.querySelector('[data-csave]').onclick = () => {
        dirty = true; queueDraft();
        const n = (tele.set.cals || []).filter((x) => !x.fixed).length;
        const next = afterCal; afterCal = null;
        if (next === 'measure') { setTool('measure'); drawMarks(); toast('경기장을 맞췄어요 — 이제 두 선수(또는 두 점) 사이를 끌어 거리를 재세요'); return; }
        setTool('select'); drawMarks();
        toast(c.fixed ? '경기장 맞춤을 저장했어요 (모든 장면)' : `${fmtT1(c.t)} 경기장 맞춤을 저장했어요${n > 1 ? ` — 맞춘 장면 ${n}개 사이는 자동으로 이어져요` : ' — 카메라가 움직이면 그 장면에서 한 번 더 맞추세요'}`);
      };
      box.querySelectorAll('[data-cgo]').forEach((b) => (b.onclick = () => { goScene(+b.dataset.cgo); setTimeout(() => { drawSide(); render(); }, 150); }));
      return;
    }
    if (!sel) {
      box.innerHTML = !tele.trackers.length ? '' : `<h4>추적 중인 선수 <small>${tele.trackers.length}명</small></h4>${aiLine()}${tele.trackers.length ? `<ul class="st-items st-trs">${tele.trackers.map((tr) => trRow(tr)).join('')}</ul>` : ''}`;
      bindTr(box);
      box.querySelectorAll('[data-trdel]').forEach((b) => (b.onclick = () => {
        snapshot();
        const id = b.dataset.trdel;
        const pos = trackerPos(tele.trackers.find((x) => x.id === id), t());
        tele.trackers = tele.trackers.filter((x) => x.id !== id);
        // 이 선수에 붙어 있던 점은 현재 위치로 고정
        tele.items.forEach((it) => itemPoints(it).forEach((p) => { if (p && p.tr === id) { delete p.tr; p.x = pos.x; p.y = pos.y; } }));
        drawSide(); render();
      }));
      return;
    }
    const it = sel;
    const trOf = (q) => q?.tr && tele.trackers.find((x) => x.id === q.tr);
    // 색: 지금 색 동그라미 하나 → 누르면 고를 색이 펼쳐짐
    const colorPick = (list, attr, cur, colAttr, fallback, label = '') => `<div class="st-cpick">${label ? `<span class="st-clab">${label}</span>` : ''}<button type="button" class="st-cdot${cur === 'none' ? ' none' : ''}" style="--c:${cur === 'none' ? 'transparent' : cur || fallback}" data-cdot aria-label="색 바꾸기"></button>
      <div class="st-cswatch" hidden>${list.map((c) => `<button type="button" style="--c:${c === 'none' ? 'transparent' : c}" data-${attr}="${c}" class="${cur === c ? 'on' : ''}${c === 'none' ? ' none' : ''}" aria-label="${c === 'none' ? '투명' : '색'}" title="${c === 'none' ? '투명 (배경 없음)' : c}"></button>`).join('')}${colAttr ? `<input type="color" value="${/^#[0-9a-f]{6}$/i.test(cur || '') ? cur : fallback}" data-${colAttr} title="직접 고르기">` : ''}</div></div>`;
    const teamCols = (attr, cur, colAttr, fallback, label) => colorPick(STYLE_COLORS.filter((c) => c !== GLASS), attr, cur, colAttr, fallback, label);
    const sw = (attr, on, txt) => `<label class="mini-switch"><input type="checkbox" data-${attr} ${on ? 'checked' : ''}> ${txt}</label>`;
    // 꼭 필요한 것만 위에 · 나머지는 '자세히 설정' 안에
    const main = {
      spot: () => `<div class="seg sm st-wide"><button type="button" class="${it.still ? '' : 'on'}" data-tmode="live">▶ 재생하며 따라가기</button><button type="button" class="${it.still ? 'on' : ''}" data-tmode="hold">⏸ 멈추고 표시만</button></div>
        <label class="st-range">이름 <input data-pname value="${esc(it.name || '')}" maxlength="14" placeholder="예) 7 손흥민"></label>
        <div class="st-crow">${teamCols('tout', it.color, 'toutc', '#ffd400', '바깥')}${teamCols('tin', it.fill, 'tinc', '#ffffff', '안쪽')}</div>
        ${trOf(it.p) ? `<ul class="st-items st-trs">${trRow(trOf(it.p), false)}</ul>${aiLine()}` : ''}`,
      arrow: () => `<div class="seg sm st-wide"><button type="button" class="${it.style === 'dash' ? '' : 'on'}" data-astyle="solid">━ 실선 · 패스</button><button type="button" class="${it.style === 'dash' ? 'on' : ''}" data-astyle="dash">┅ 점선 · 움직임</button><button type="button" class="${it.style === 'dribble' ? 'on' : ''}" data-astyle="dribble">〰 물결 · 드리블</button></div>
        <div class="seg sm st-wide"><button type="button" class="${it.live ? 'on' : ''}" data-amode="live">▶ 재생하며</button><button type="button" class="${it.live ? '' : 'on'}" data-amode="hold">⏸ 멈추고</button></div>
        <label class="st-range">화살표 크기 <b data-aszv>${Math.round((it.asz || 1) * 100)}%</b><input type="range" min="40" max="200" step="10" value="${Math.round((it.asz || 1) * 100)}" data-asz></label>`,
      link: () => {
        const trs = it.pts.map(trOf).filter(Boolean);
        return `<div class="seg sm st-wide"><button type="button" class="${it.still ? '' : 'on'}" data-tmode="live">▶ 재생하며 따라가기</button><button type="button" class="${it.still ? 'on' : ''}" data-tmode="hold">⏸ 멈추고 표시만</button></div>
        <div class="st-num"><span>모양</span><div class="seg sm"><button type="button" class="${it.closed ? '' : 'on'}" data-lshape="open">선</button><button type="button" class="${it.closed ? 'on' : ''}" data-lshape="closed" ${it.pts.length < 3 ? 'disabled title="선수 3명부터"' : 'title="마지막 선수와 첫 선수를 이어 도형으로"'}>도형</button></div></div>
          <div class="st-num"><span>선</span><div class="seg sm"><button type="button" class="${it.lstyle !== 'dash' ? 'on' : ''}" data-lst="solid">실선</button><button type="button" class="${it.lstyle === 'dash' ? 'on' : ''}" data-lst="dash">점선</button></div></div>
          ${trs.length ? `<div class="st-lab">이은 선수 ${trs.length}명</div><ul class="st-items st-trs">${trs.map((tr) => trRow(tr, false)).join('')}</ul>${aiLine()}<button type="button" class="btn ghost sm full" data-linkprec>모두 AI 정밀 추적</button>` : ''}`;
      },
      text: () => `<label class="st-range">글자 <input data-ptext value="${esc(it.t)}" maxlength="30"></label>
        <label class="st-range">글자 크기 <b data-tfsv>${Math.round((it.fs || 1) * 100)}%</b><input type="range" min="50" max="300" step="10" value="${Math.round((it.fs || 1) * 100)}" data-tfs></label>`,
      move: () => `<button type="button" class="btn ghost sm full" data-trim>✂ 선수 다듬기</button>
        <label class="st-range">원래 자리 흔적 <b data-ghv>${Math.round((it.ghost ?? 0.28) * 100)}%</b><input type="range" min="0" max="70" step="5" value="${Math.round((it.ghost ?? 0.28) * 100)}" data-ghost></label>
        <p class="muted small st-note">원래 자리는 잔디로 덮고, 그 위에 '여기 있었다' 흔적을 이만큼 옅게 남겨요 (0%면 흔적 없음).</p>`,
      zoom: () => `<div class="st-num"><span>모양</span><div class="seg sm">${[['circle', '◯'], ['rect', '▢']].map(([k, l]) => `<button type="button" class="${(it.shape || 'circle') === k ? 'on' : ''}" data-zshape="${k}">${l}</button>`).join('')}</div></div>
        <div class="st-num"><span>배율</span><div class="seg sm">${[2, 3, 4].map((v) => `<button type="button" class="${(it.z || 2) === v ? 'on' : ''}" data-zz="${v}">×${v}</button>`).join('')}</div></div>`,
      vision: () => `<div class="st-num"><span>넓이</span><div class="seg sm">${[[30, '좁게'], [50, '보통'], [80, '넓게']].map(([v, l]) => `<button type="button" class="${(it.spread || 50) === v ? 'on' : ''}" data-vsp="${v}">${l}</button>`).join('')}</div></div>
        <label class="st-range">넓이 <b data-vspv>${it.spread || 50}°</b><input type="range" min="8" max="170" step="1" value="${it.spread || 50}" data-vspr></label>
        <label class="st-range">방향 <b data-vdirv>${Math.round(vDir(it))}°</b><input type="range" min="0" max="359" step="1" value="${Math.round(vDir(it))}" data-vdir></label>
        <div class="st-num"><span>바라보는 쪽</span><div class="seg sm">${[[270, '↑ 앞'], [90, '↓ 카메라 쪽'], [180, '← 왼쪽'], [0, '→ 오른쪽']].map(([v, l]) => `<button type="button" data-vdq="${v}">${l}</button>`).join('')}</div></div>
        <label class="st-range">진하기 <b data-vopv>${Math.round((it.vop ?? 0.55) * 100)}%</b><input type="range" min="10" max="95" step="5" value="${Math.round((it.vop ?? 0.55) * 100)}" data-vop></label>
        ${sw('vfade', it.vfade !== false, '끝으로 갈수록 옅게')}${sw('vedge', !!it.vedge, '양쪽 테두리 선')}
        <p class="muted small st-note">시야 끝의 점을 끌면 길이 · 방향이 바뀌어요.</p>`,
      light: () => `<label class="st-range">${it.p?.tr ? '빛 크기' : '크기'} <input type="range" min="${it.p?.tr ? 50 : 10}" max="${it.p?.tr ? 250 : 400}" value="${it.p?.tr ? Math.round((it.scale || 1) * 100) : Math.round((it.r || 0.06) * 1000)}" data-lsize></label>
        <label class="st-range">주변 어둡게 <input type="range" min="20" max="95" value="${Math.round((it.dim ?? 0.68) * 100)}" data-ldim></label>
        ${trOf(it.p) ? `<ul class="st-items st-trs">${trRow(trOf(it.p), false)}</ul>${aiLine()}` : ''}
        ${!it.p?.tr ? '<button type="button" class="btn ghost sm full" data-lfollow>◎ 가운데 선수 따라가기</button>' : '<button type="button" class="btn ghost sm full" data-lfree>이 자리에 고정</button>'}`,
      offside: () => '<button type="button" class="btn ghost sm full" data-oside>◐ 어두운 쪽 바꾸기</button>',
    }[it.k];
    const adv = [
      `<div class="st-num"><span>시작</span><input type="number" min="0" step="0.1" value="${(+it.t0).toFixed(1)}" data-pt0n><i>초</i><button class="chip" data-t0>지금으로</button></div>`,
      !isLive(it) && it.k !== 'move' ? `${sw('pspan', !!it.span, '재생하는 동안에도 보이기 (시작 ~ 끝)')}${it.span ? `<div class="st-num"><span>끝</span><input type="number" min="0" step="0.1" value="${(+(it.t1 ?? it.t0 + 5)).toFixed(1)}" data-pt1n><i>초</i><button class="chip" data-t1now>지금으로</button></div>` : ''}` : '',
      isLive(it) ? `<div class="st-num"><span>끝</span><input type="number" min="0" step="0.1" value="${it.t1 == null ? '' : (+it.t1).toFixed(1)}" placeholder="끝까지" data-pt1n ${it.t1 == null ? 'disabled' : ''}><i>초</i><button class="chip" data-t1now ${it.t1 == null ? 'disabled' : ''}>지금으로</button></div>` : '',
      `<div class="st-num"><span>나오는 순서</span><input type="number" min="1" max="20" step="1" value="${it.ord || 1}" data-pord><i>번째</i></div><p class="muted small st-note">같은 장면에서 같은 번호끼리는 같이 나와요. 간격은 장면 카드에서 바꿔요 (지금 ${it.gap ?? 0.8}초).</p>`,
      `<div class="st-num"><span>멈춰서 보여주기</span><input type="number" min="0" max="30" step="0.5" value="${it.hold ?? 4}" data-phold><i>초</i></div>`,
      it.k === 'light' && it.p?.tr ? sw('pfollow', !it.still, '재생되면 선수 따라가기') : '',
      isLive(it) ? `<div class="st-num"><span>보여주는 시간</span><input type="number" min="0" max="600" step="0.5" value="${it.t1 == null ? '' : +(it.t1 - it.t0).toFixed(1)}" placeholder="끝까지" data-pdur ${it.t1 == null ? 'disabled' : ''}><i>초</i><label class="mini-switch"><input type="checkbox" data-pend ${it.t1 == null ? 'checked' : ''}> 끝까지</label></div>` : '',
      it.k === 'arrow' || it.k === 'spot' || it.k === 'link' ? `<div class="st-num"><span>${it.k === 'spot' ? '나타나는 시간' : '그어지는 시간'}</span><input type="number" min="0" max="6" step="0.1" value="${animSec(it)}" data-panim><i>초</i></div>` : '',
      it.k === 'arrow' ? sw('pbold', it.weight === 'bold', '굵게') : '',
      it.k === 'measure' ? '<button type="button" class="btn ghost sm full" data-recal>경기장 다시 맞추기</button>' : '',
      it.k === 'arrow' || it.k === 'measure' ? `<div class="st-num"><span>거리 표시</span><input type="number" min="0" max="200" step="0.1" value="${it.m ?? ''}" placeholder="${it.k === 'arrow' ? '없음' : '?'}" data-pm><i>m</i></div>` : '',
      it.k === 'spot' ? `${sw('ptrail', it.trail !== false, '이동 꼬리')}${sw('pglow', it.glow !== false, '빛 기둥 (입체)')}${sw('pmarker', it.marker !== false, '머리 위 ▼')}<label class="st-range">링 크기 <input type="range" min="50" max="220" value="${Math.round((it.scale || 1) * 100)}" data-pscale></label>` : '',
      it.k === 'link' ? `${sw('parea', it.area, '면 채우기')}${sw('pwall', it.wall, '수비 라인 벽')}${sw('pflow', it.flow !== false, '흐르는 빛')}` : '',
      GROUND.has(it.k) && !(it.k === 'arrow' && it.c) ? `${sw('pocc', it.occ ?? occDefault(it), '선수가 이 그림 앞에 서기')}<p class="muted small st-note">켜면 선수가 그림 위로 지나가요 (자동 인식이라 영상에 따라 그림이 잘릴 수 있어요). 끄면 잘리지 않아요.</p>` : '',
      it.k === 'zoom' ? `<label class="st-range">돋보기 크기 <input type="range" min="40" max="220" value="${Math.round((it.r || 0.1) * 1000)}" data-zr></label>` : '',
      it.k === 'light' ? sw('lring', it.ring === true, '색 테두리 넣기') : '',
      it.k === 'offside' ? `<label class="st-range">밝기 차이 <input type="range" min="0" max="100" value="${Math.round((it.dim ?? 0.5) * 100)}" data-odim></label><button type="button" class="btn ghost sm" data-overt>┃ 세로로</button>` : '',
      it.k === 'grid' ? `<div class="grid2 st-gridin"><label>세로칸<input type="number" min="1" max="20" value="${it.cols}" data-pcols></label><label>가로칸<input type="number" min="1" max="20" value="${it.rows}" data-prows></label>
        <label>실제 가로(m)<input type="number" min="1" max="120" value="${it.wM}" data-pwm></label><label>실제 세로(m)<input type="number" min="1" max="90" value="${it.hM}" data-phm></label></div>` : '',
      it.k === 'angle' ? `<div class="st-num"><span>각도</span><b>${Math.round(angleDeg(P(it.a), P(it.b), P(it.c)))}°</b><input type="number" min="0" max="180" step="1" value="${it.deg ?? ''}" placeholder="직접" data-adeg><i>°</i></div>` : '',
    ].filter(Boolean).join('');
    if (it.k === 'freeze' || it.k === 'slow') {
      const len = +((it.t1 ?? it.t0 + 3) - it.t0).toFixed(1);
      box.innerHTML = `<h4 class="st-ptitle">${ICONS[it.k]} ${NAMES[it.k]}</h4>
        <div class="st-num"><span>시작</span><b>${fmtT1(it.t0)}</b><button class="chip" data-t0>지금으로</button></div>
        ${it.k === 'freeze' ? `<div class="st-num"><span>멈추는 시간</span><input type="number" min="0.5" max="30" step="0.5" value="${it.hold ?? 3}" data-phold><i>초</i></div>
          <p class="muted small st-note">재생하다 이 장면에서 멈췄다가 다시 재생해요 (영상으로 내보낼 때도 그대로).</p>`
        : `<div class="st-num"><span>속도</span><div class="seg sm">${[[0.5, '×0.5'], [0.25, '×0.25']].map(([v, l]) => `<button type="button" class="${(it.speed || 0.5) === v ? 'on' : ''}" data-sp="${v}">${l}</button>`).join('')}</div></div>
          <div class="st-num"><span>길이</span><input type="number" min="0.5" max="60" step="0.5" value="${len}" data-slen><i>초</i></div>
          <p class="muted small st-note">이 구간만 느리게 재생해요 (영상으로 내보낼 때도 느리게 들어가요).</p>`}
        <div class="row st-btnrow"><button class="btn ghost sm" data-pdup>⧉ 복제</button><button class="btn ghost sm" data-pdel>삭제</button></div>`;
      const ch2 = (fn) => () => { snapshot(); fn(); drawSide(); render(); };
      box.querySelector('[data-t0]').onclick = ch2(() => { const l = (it.t1 ?? it.t0) - it.t0; it.t0 = +t().toFixed(2); if (it.k === 'slow') it.t1 = +(it.t0 + l).toFixed(2); });
      box.querySelector('[data-phold]')?.addEventListener('change', ch2(() => { it.hold = Math.max(0.5, Math.min(30, +box.querySelector('[data-phold]').value || 3)); }));
      box.querySelector('[data-slen]')?.addEventListener('change', ch2(() => { it.t1 = +(it.t0 + Math.max(0.5, Math.min(60, +box.querySelector('[data-slen]').value || 3))).toFixed(2); }));
      box.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = ch2(() => { it.speed = +b.dataset.sp; })));
      box.querySelector('[data-pdel]').onclick = ch2(() => { tele.items = tele.items.filter((x) => x !== it); sel = null; });
      box.querySelector('[data-pdup]').onclick = () => dupItem(it);
      return;
    }
    const myStyles = loadStyles();
    box.innerHTML = `<h4 class="st-ptitle">${ICONS[it.k] || ''} ${NAMES[it.k]}</h4>
      <div class="st-styles" aria-label="내 스타일">${myStyles.map((x, i) => `<button type="button" class="st-sty ${sameStyle(it, x) ? 'on' : ''}" data-sty="${i}" title="${esc(x.name)} — 누르면 이 그림에 적용 · 새 그림도 이 스타일로"><i style="--a:${x.color};--b:${x.fill || x.color}"></i>${esc(x.name)}</button>`).join('')}<button type="button" class="st-sty add" data-stysave title="지금 이 그림의 색 · 모양을 내 스타일로 저장">+ 저장</button></div>
      <div class="st-stysave" data-stybox hidden><input data-styname maxlength="12" placeholder="스타일 이름 (예: 우리 팀)"><button type="button" class="btn sm" data-styok>저장</button>${myStyles.length > 3 ? '<button type="button" class="btn ghost sm" data-stydel title="고른 스타일 지우기">지우기</button>' : ''}</div>
      ${it.k === 'spot' ? '' : `<div class="st-crow">${colorPick(STYLE_COLORS, 'pcolor', it.color || PALETTE[0], 'pcolorc', '#ffd400', it.k === 'text' ? '글자 색' : '색')}${it.k === 'text' ? colorPick(['none', ...STYLE_COLORS.filter((c) => c !== GLASS)], 'tbg', it.bg ?? 'rgba(0,0,0,.72)', 'tbgc', '#000000', '배경') : ''}</div>`}
      ${main ? main() : ''}
      <details class="st-adv" ${advOpen ? 'open' : ''}><summary>자세히 설정 <small class="muted">시간 · 멈춤 · 선수 앞 · 크기</small></summary>${adv}</details>
      <div class="row st-btnrow"><button class="btn ghost sm" data-pdup>⧉ 복제</button><button class="btn ghost sm" data-pdel>삭제</button></div>`;
    box.querySelector('.st-adv').addEventListener('toggle', (e) => { advOpen = e.target.open; });
    bindTr(box);
    const ch = (fn) => () => { snapshot(); fn(); drawSide(); render(); };
    box.querySelectorAll('[data-cdot]').forEach((b) => (b.onclick = () => { const w = b.nextElementSibling; const open = w.hidden; box.querySelectorAll('.st-cswatch').forEach((x) => { x.hidden = true; }); w.hidden = !open; }));
    box.querySelectorAll('[data-pcolor]').forEach((b) => (b.onclick = ch(() => { it.color = b.dataset.pcolor; color = it.color; })));
    // 내 스타일: 누르면 이 그림에 적용 + 새 그림 기본값 · '+ 저장'은 지금 모양을 저장 (이 컴퓨터에 보관)
    box.querySelectorAll('[data-sty]').forEach((b) => (b.onclick = ch(() => { const x = myStyles[+b.dataset.sty]; applyStyle(it, x); stylePref = x; color = x.color; })));
    box.querySelector('[data-stysave]').onclick = () => { const w = box.querySelector('[data-stybox]'); w.hidden = !w.hidden; if (!w.hidden) box.querySelector('[data-styname]').focus(); };
    box.querySelector('[data-styok]').onclick = () => {
      const name = (box.querySelector('[data-styname]').value || '').trim() || `내 스타일 ${myStyles.length + 1}`;
      const x = { name, color: it.color || PALETTE[0], ...(it.fill ? { fill: it.fill } : {}), ...(it.bg ? { bg: it.bg } : {}), ...(it.weight ? { weight: it.weight } : {}), ...(it.asz ? { asz: it.asz } : {}), ...(it.scale ? { scale: it.scale } : {}), ...(it.glow === false ? { glow: false } : {}) };
      saveStyles([...myStyles.filter((y) => y.name !== name), x].slice(-10)); stylePref = x; toast(`'${name}' 스타일을 저장했어요 — 새 그림에도 이 스타일이 들어가요`); drawSide();
    };
    box.querySelector('[data-stydel]')?.addEventListener('click', () => { const on = myStyles.findIndex((x) => sameStyle(it, x)); if (on < 0) { toast('지울 스타일을 먼저 누르세요'); return; } const nm = myStyles[on].name; saveStyles(myStyles.filter((_, i) => i !== on)); toast(`'${nm}' 스타일을 지웠어요`); drawSide(); });
    box.querySelector('[data-pcolorc]')?.addEventListener('change', ch(() => { it.color = box.querySelector('[data-pcolorc]').value; color = it.color; }));
    box.querySelector('[data-t0]').onclick = ch(() => {
      const len = it.t1 == null ? null : it.t1 - it.t0;
      it.t0 = +t().toFixed(2);
      if (len != null) it.t1 = +(it.t0 + len).toFixed(2);
    });
    // 시작 · 끝을 숫자로 (그림마다 자기 시간대로 · 다른 그림과 겹쳐도 됨)
    box.querySelector('[data-pt0n]')?.addEventListener('change', ch(() => {
      const v = Math.max(0, Math.min(dur() || 1e9, +box.querySelector('[data-pt0n]').value || 0));
      const len = it.t1 == null ? null : it.t1 - it.t0;
      it.t0 = +v.toFixed(2); if (len != null) it.t1 = +(it.t0 + Math.max(0.2, len)).toFixed(2);
    }));
    box.querySelector('[data-pt1n]')?.addEventListener('change', ch(() => { const v = +box.querySelector('[data-pt1n]').value; if (v > it.t0) it.t1 = +Math.min(dur() || 1e9, v).toFixed(2); else toast('끝은 시작보다 뒤여야 해요'); }));
    box.querySelector('[data-t1now]')?.addEventListener('click', ch(() => { if (t() > it.t0 + 0.1) it.t1 = +t().toFixed(2); else toast('끝은 시작보다 뒤여야 해요 — 영상을 끝낼 장면으로 옮기고 누르세요'); }));
    box.querySelector('[data-pspan]')?.addEventListener('change', ch(() => { it.span = !it.span; if (it.span && (it.t1 == null || it.t1 <= it.t0)) it.t1 = +(it.t0 + (+tele.set.dur || 5)).toFixed(2); }));
    box.querySelector('[data-pdur]')?.addEventListener('change', ch(() => { const v0 = box.querySelector('[data-pdur]').value; const v = +v0; if (v0 !== '' && v >= 0) it.t1 = +(it.t0 + v).toFixed(2); }));
    box.querySelector('[data-pend]')?.addEventListener('change', ch(() => { it.t1 = box.querySelector('[data-pend]').checked ? null : +(it.t0 + (+tele.set.dur || 5)).toFixed(2); }));
    box.querySelector('[data-panim]')?.addEventListener('change', ch(() => { const v0 = box.querySelector('[data-panim]').value; it.anim = Math.max(0, Math.min(6, v0 === '' ? 1.6 : +v0)); if (it.live) it.t1 = +(it.t0 + it.anim + 1.5).toFixed(2); }));
    box.querySelector('[data-pflow]')?.addEventListener('change', ch(() => { if (box.querySelector('[data-pflow]').checked) delete it.flow; else it.flow = false; }));
    box.querySelector('[data-pocc]')?.addEventListener('change', ch(() => { it.occ = box.querySelector('[data-pocc]').checked; }));
    box.querySelector('[data-pord]')?.addEventListener('change', ch(() => {
      const v = Math.max(1, Math.min(20, Math.round(+box.querySelector('[data-pord]').value || 1)));
      if (v > 1) it.ord = v; else delete it.ord;
      const grp = tele.items.filter((x) => x.k !== 'freeze' && x.k !== 'slow' && Math.abs(x.t0 - it.t0) <= HOLD_GROUP);
      applyOrder(grp);
    }));
    box.querySelector('[data-phold]').onchange = ch(() => { const v = box.querySelector('[data-phold]').value; it.hold = Math.max(0, Math.min(30, v === '' ? 4 : +v)); });
    box.querySelector('[data-pdel]').onclick = ch(() => { tele.items = tele.items.filter((x) => x !== it); sel = null; });
    box.querySelector('[data-pdup]').onclick = () => dupItem(it);
    box.querySelectorAll('[data-vsp]').forEach((b) => (b.onclick = ch(() => { it.spread = +b.dataset.vsp; visionPref = it.spread; })));
    // 시야 방향: 시작점(선수)을 중심으로 끝점을 돌림 (길이는 그대로) — 카메라 쪽을 보는 선수도 바로 맞춤
    const setDir = (deg) => {
      const A = resolve(it.a); const B = resolve(it.b);
      const ax = A.x * W(); const ay = A.y * H(); const L = Math.max(30, Math.hypot(B.x * W() - ax, B.y * H() - ay));
      const r = (deg * Math.PI) / 180;
      it.b = { x: +Math.min(1, Math.max(0, (ax + Math.cos(r) * L) / W())).toFixed(4), y: +Math.min(1, Math.max(0, (ay + Math.sin(r) * L) / H())).toFixed(4) };
    };
    box.querySelector('[data-vdir]')?.addEventListener('pointerdown', () => snapshot(), { once: true });
    box.querySelector('[data-vdir]')?.addEventListener('input', (e) => { setDir(+e.target.value); box.querySelector('[data-vdirv]').textContent = `${e.target.value}°`; dirty = true; render(); });
    box.querySelectorAll('[data-vdq]').forEach((b) => (b.onclick = ch(() => setDir(+b.dataset.vdq))));
    box.querySelector('[data-ghost]')?.addEventListener('input', (e) => { it.ghost = e.target.value / 100; box.querySelector('[data-ghv]').textContent = `${e.target.value}%`; dirty = true; render(); });
    box.querySelector('[data-vspr]')?.addEventListener('pointerdown', () => snapshot(), { once: true });
    box.querySelector('[data-vspr]')?.addEventListener('input', (e) => { it.spread = +e.target.value; visionPref = it.spread; box.querySelector('[data-vspv]').textContent = `${it.spread}°`; dirty = true; render(); });
    box.querySelector('[data-vop]')?.addEventListener('input', (e) => { it.vop = e.target.value / 100; box.querySelector('[data-vopv]').textContent = `${e.target.value}%`; dirty = true; render(); });
    box.querySelector('[data-vfade]')?.addEventListener('change', ch(() => { it.vfade = box.querySelector('[data-vfade]').checked; }));
    box.querySelector('[data-vedge]')?.addEventListener('change', ch(() => { it.vedge = box.querySelector('[data-vedge]').checked; }));
    box.querySelector('[data-adeg]')?.addEventListener('change', ch(() => { const v = box.querySelector('[data-adeg]').value; if (v === '') delete it.deg; else it.deg = Math.max(0, Math.min(180, +v)); }));
    box.querySelectorAll('[data-tmode]').forEach((b) => (b.onclick = ch(() => {
      if (b.dataset.tmode === 'live') { delete it.still; if (it.t1 != null && it.t1 <= it.t0) it.t1 = +(it.t0 + (+tele.set.dur || 5)).toFixed(2); } else it.still = true;
      if (it.k === 'spot') followPref = !it.still;
    })));
    box.querySelector('[data-pfollow]')?.addEventListener('change', ch(() => {
      const on = box.querySelector('[data-pfollow]').checked;
      if (it.k !== 'link') followPref = on;
      if (on) { delete it.still; if (it.t1 != null && it.t1 <= it.t0) it.t1 = +(it.t0 + (+tele.set.dur || 5)).toFixed(2); } else it.still = true;
    }));
    box.querySelector('[data-lsize]')?.addEventListener('input', (e) => { if (it.p?.tr) it.scale = e.target.value / 100; else it.r = e.target.value / 1000; dirty = true; render(); });
    box.querySelector('[data-ldim]')?.addEventListener('input', (e) => { it.dim = e.target.value / 100; dirty = true; render(); });
    box.querySelector('[data-lring]')?.addEventListener('change', ch(() => { if (box.querySelector('[data-lring]').checked) it.ring = true; else delete it.ring; }));
    box.querySelector('[data-lfollow]')?.addEventListener('click', () => {
      snapshot();
      const c = resolve(it.p);
      it.p = trackAt(c); // 동그라미 가운데 선수를 잡아 따라감
      delete it.r;
      if (it.t1 == null || it.t1 <= it.t0) it.t1 = +(it.t0 + (+tele.set.dur || 5)).toFixed(2);
      drawSide(); render();
      toast('가운데 선수를 잡았어요 — ▶ 재생하면 따라가며 비춰요');
    });
    box.querySelector('[data-lfree]')?.addEventListener('click', ch(() => { const c = resolve(it.p); it.p = { x: +c.x.toFixed(4), y: +c.y.toFixed(4) }; it.r = 0.06; }));
    box.querySelector('[data-oside]')?.addEventListener('click', ch(() => { it.side = it.side === -1 ? 1 : -1; }));
    box.querySelector('[data-overt]')?.addEventListener('click', ch(() => { it.d = { x: 0, y: 1 }; }));
    box.querySelector('[data-odim]')?.addEventListener('input', (e) => { it.dim = e.target.value / 100; dirty = true; render(); });
    // 실선(패스) · 점선(움직임): 다음 화살표도 같은 모양으로
    box.querySelectorAll('[data-astyle]').forEach((b) => (b.onclick = () => {
      snapshot(); it.style = b.dataset.astyle; arrowDash = it.style === 'dash';
      try { localStorage.setItem('ssaka.st.adash', arrowDash ? '1' : '0'); } catch { /* */ }
      drawSide(); render();
    }));
    box.querySelector('[data-pm]')?.addEventListener('change', ch(() => { const v = box.querySelector('[data-pm]').value; if (v === '') delete it.m; else it.m = +(+v).toFixed(1); }));
    box.querySelector('[data-psize]')?.addEventListener('input', (e) => { it.size = e.target.value / 1000; dirty = true; render(); });
    box.querySelector('[data-pscale]')?.addEventListener('input', (e) => { it.scale = e.target.value / 100; dirty = true; render(); });
    // 화살표 크기: 끄는 동안 바로 보이고, 놓으면 되돌리기에 남김 · 다음 화살표도 이 크기로
    const aszIn = box.querySelector('[data-asz]');
    if (aszIn) {
      aszIn.addEventListener('pointerdown', () => snapshot(), { once: true });
      aszIn.addEventListener('input', (e) => { const v = e.target.value / 100; if (v === 1) delete it.asz; else it.asz = v; arrowSz = v; try { localStorage.setItem('ssaka.st.asz', String(v)); } catch { /* */ } box.querySelector('[data-aszv]').textContent = `${e.target.value}%`; dirty = true; render(); });
    }
    box.querySelector('[data-pmarker]')?.addEventListener('change', ch(() => { it.marker = it.marker === false; }));
    box.querySelector('[data-pname]')?.addEventListener('change', ch(() => { it.name = box.querySelector('[data-pname]').value.trim(); }));
    box.querySelectorAll('[data-amode]').forEach((b) => (b.onclick = ch(() => {
      it.live = b.dataset.amode === 'live'; arrowLivePref = it.live;
      if (it.live) { it.hold = 0; it.t1 = +(it.t0 + animSec(it) + 1.5).toFixed(2); } else { it.hold = 4; it.t1 = +(it.t0 + (+tele.set.dur || 5)).toFixed(2); }
    })));
    box.querySelector('[data-plive]')?.addEventListener('change', ch(() => {
      it.live = !it.live; arrowLivePref = it.live;
      if (it.live) { it.hold = 0; it.t1 = +(it.t0 + animSec(it) + 1.5).toFixed(2); } else { it.hold = 4; it.t1 = +(it.t0 + (+tele.set.dur || 5)).toFixed(2); }
    }));
    box.querySelector('[data-pbold]')?.addEventListener('change', ch(() => { it.weight = it.weight === 'bold' ? 'thin' : 'bold'; arrowBold = it.weight === 'bold'; try { localStorage.setItem('ssaka.st.abold', arrowBold ? '1' : '0'); } catch { /* */ } }));
    box.querySelectorAll('[data-tout]').forEach((b) => (b.onclick = ch(() => { it.color = b.dataset.tout; })));
    box.querySelectorAll('[data-tin]').forEach((b) => (b.onclick = ch(() => { it.fill = b.dataset.tin; })));
    box.querySelector('[data-toutc]')?.addEventListener('change', ch(() => { it.color = box.querySelector('[data-toutc]').value; }));
    box.querySelector('[data-tinc]')?.addEventListener('change', ch(() => { it.fill = box.querySelector('[data-tinc]').value; }));
    box.querySelector('[data-ptrail]')?.addEventListener('change', ch(() => { it.trail = it.trail === false; }));
    box.querySelector('[data-pglow]')?.addEventListener('change', ch(() => { it.glow = it.glow === false; }));
    box.querySelectorAll('[data-lst]').forEach((b) => (b.onclick = ch(() => { it.lstyle = b.dataset.lst; })));
    box.querySelectorAll('[data-lshape]').forEach((b) => (b.onclick = ch(() => { if (b.dataset.lshape === 'closed') { it.closed = true; it.area = true; } else { delete it.closed; delete it.area; } })));
    box.querySelector('[data-linkprec]')?.addEventListener('click', async () => {
      const trs = it.pts.map((q) => q.tr && tele.trackers.find((x) => x.id === q.tr)).filter(Boolean);
      for (const [i, tr] of trs.entries()) { const ok = await preciseTrack(tr); if (!ok) { if (i < trs.length - 1) toast(`${tr.name}에서 멈췄어요 — 고친 뒤 다시 누르면 이어서 해요`); break; } }
      drawSide(); render();
    });
    box.querySelector('[data-parea]')?.addEventListener('change', ch(() => { it.area = !it.area; }));
    box.querySelector('[data-pwall]')?.addEventListener('change', ch(() => { it.wall = !it.wall; }));
    box.querySelector('[data-recal]')?.addEventListener('click', () => { afterCal = 'measure'; setTool('pitch'); });
    box.querySelector('[data-ptext]')?.addEventListener('change', ch(() => { it.t = box.querySelector('[data-ptext]').value || it.t; }));
    box.querySelector('[data-tfs]')?.addEventListener('input', (e) => { it.fs = +e.target.value / 100; box.querySelector('[data-tfsv]').textContent = `${e.target.value}%`; dirty = true; render(); });
    box.querySelector('[data-tfs]')?.addEventListener('change', () => { snapshot(); });
    box.querySelectorAll('[data-tbg]').forEach((b) => (b.onclick = ch(() => { it.bg = b.dataset.tbg; })));
    box.querySelector('[data-tbgc]')?.addEventListener('change', ch(() => { it.bg = box.querySelector('[data-tbgc]').value; }));
    box.querySelector('[data-ptext]')?.addEventListener('input', () => { const v = box.querySelector('[data-ptext]').value; if (v) { it.t = v.slice(0, 30); render(); } });
    box.querySelector('[data-trim]')?.addEventListener('click', () => trimModal(it));
    // 돋보기: 고른 모양 · 배율 · 크기는 다음 돋보기에도 그대로
    box.querySelectorAll('[data-zshape]').forEach((b) => (b.onclick = ch(() => { it.shape = b.dataset.zshape; zoomPref.shape = it.shape; })));
    box.querySelectorAll('[data-zz]').forEach((b) => (b.onclick = ch(() => { it.z = +b.dataset.zz; zoomPref.z = it.z; })));
    box.querySelector('[data-zr]')?.addEventListener('input', (e) => { it.r = e.target.value / 1000; zoomPref.r = it.r; dirty = true; render(); });
    [['pcols', 'cols', 1, 20], ['prows', 'rows', 1, 20], ['pwm', 'wM', 1, 120], ['phm', 'hM', 1, 90]].forEach(([a, k, lo, hi]) => {
      box.querySelector(`[data-${a}]`)?.addEventListener('change', ch(() => { it[k] = Math.min(hi, Math.max(lo, +box.querySelector(`[data-${a}]`).value || it[k])); }));
    });
  }

  // ── 설정 ──
  if (edit) {
    el.querySelectorAll('[data-color]').forEach((b) => (b.onclick = () => {
      color = b.dataset.color;
      el.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
      if (sel) { snapshot(); sel.color = color; drawSide(); render(); } // 선택한 그림이 있으면 그 색도 바꿈
    }));
    el.querySelectorAll('[data-shape]').forEach((b) => (b.onclick = () => {
      shape = b.dataset.shape;
      el.querySelectorAll('[data-shape]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    // 더보기: 자주 안 쓰는 도구 (열어 둔 상태 기억)
    const moreBox = el.querySelector('[data-moretools]');
    const setMore = (on) => { moreBox.hidden = !on; el.querySelector('[data-moretg] span').textContent = on ? '접기' : '더보기'; try { localStorage.setItem('ssaka.st.more', on ? '1' : '0'); } catch { /* */ } };
    let more0 = false; try { more0 = localStorage.getItem('ssaka.st.more') === '1'; } catch { /* */ }
    setMore(more0);
    el.querySelector('[data-moretg]').onclick = () => setMore(moreBox.hidden);
    // 같은 도구를 다시 누르면 해제 → 마우스로 바로 옮기기 상태
    el.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => { if (b.dataset.tool === 'freeze' || b.dataset.tool === 'slow') { addTimeItem(b.dataset.tool); return; } setTool(tool === b.dataset.tool ? 'select' : b.dataset.tool); }));
    // 도구를 앞에 두기 · 더보기로 보내기: 오른쪽 클릭 또는 길게 누르기 (순서는 이 컴퓨터에 기억)
    const favToggle = (b) => {
      const k = b.dataset.tool; const favs = toolFavs(); const on = favs.includes(k);
      const next = on ? favs.filter((x) => x !== k) : [...favs, k];
      if (!next.length) { toast('도구 하나는 앞에 있어야 해요'); return; }
      try { localStorage.setItem(FAV_K, JSON.stringify(next)); } catch { /* */ }
      const rail = el.querySelector('.st-tools'); const moreBtn = el.querySelector('[data-moretg]'); const moreBox = el.querySelector('[data-moretools]');
      if (on) { moreBox.insertBefore(b, moreBox.querySelector('.st-favhint')); b.classList.remove('fav'); } else { rail.insertBefore(b, moreBtn); b.classList.add('fav'); }
      const l = TOOLS.find((x) => x[0] === k)?.[1] || '';
      b.title = `${l} — 오른쪽 클릭 · 길게 누르면 ${on ? '앞에 두기' : '더보기로'}`;
      toast(on ? `'${l}'을(를) 더보기로 옮겼어요` : `'${l}'을(를) 앞에 뒀어요`);
    };
    el.querySelectorAll('[data-tool]').forEach((b) => {
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); favToggle(b); });
      let lt = null; let longDone = false;
      b.addEventListener('pointerdown', () => { longDone = false; lt = setTimeout(() => { longDone = true; favToggle(b); }, 600); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(lt)));
      b.addEventListener('click', (e) => { if (longDone) { e.stopImmediatePropagation(); longDone = false; } }, true);
    });
  }


  let afterCal = null; // 경기장 맞추기가 끝나면 넘어갈 도구 (거리)
  function setTool(k) {
    // 거리: 이 장면에 경기장 맞춤이 없으면 먼저 맞추기 → 저장하면 거리 재기로
    if (k === 'measure' && edit && !calAt()) { afterCal = 'measure'; setTool('pitch'); toast('거리를 재려면 먼저 경기장을 맞춰요 — 흰 점 4개를 박스 · 골라인에 맞추고 [✓ 저장]'); return; }
    if (k !== 'pitch') afterCal = null;
    if (cands?.multi && k !== 'link') cands = null;
    tool = k;
    if ((k === 'track' || k === 'link') && edit) loadAI().then(() => drawSide()).catch(() => drawSide());
    if (k !== 'select' && !video.paused) { freeze = null; video.pause(); } // 도구를 고르면 영상 멈춤
    draft = null;
    if (k !== 'select') sel = null;
    el.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === k || (k === 'pitch' && b.dataset.tool === 'measure'))); // 경기장 맞추기는 거리 도구 안의 1단계
    if (!man && !cands) el.querySelector('[data-hint]').textContent = HINT[k] || '';
    el.querySelector('[data-shapes]').hidden = k !== 'shape';
    if (k === 'pitch' && edit && !calNow()) {
      snapshot();
      const prev = calAt() || [...(tele.set.cals || [])].sort((a, b) => Math.abs(t() - a.t) - Math.abs(t() - b.t))[0];
      (tele.set.cals ||= []).push(prev
        ? { id: uid(), t: +t().toFixed(2), tpl: prev.tpl, w: prev.w, h: prev.h, q: prev.q.map((q) => ({ ...q })) }
        : { id: uid(), t: +t().toFixed(2), tpl: 'box', q: [{ x: 0.3, y: 0.4 }, { x: 0.58, y: 0.4 }, { x: 0.7, y: 0.8 }, { x: 0.18, y: 0.8 }] });
      if (prev) toast(prev.auto ? '앞뒤에 맞춘 장면을 이어서 가져왔어요 — 어긋난 점만 옮기고 [저장]' : `${fmtT1(prev.t)} 장면에서 맞춘 모양을 가져왔어요 — 카메라가 움직였으면 점을 조금만 옮기고 [저장]`);
    }
    drawSide();
    drawPanel();
    render();
  }

  const zoomPref = { shape: 'circle', z: 2, r: 0.1 }; // 돋보기 기본값 (마지막에 고른 값 기억)
  const newItem = (k, extra) => {
    let t0 = +t().toFixed(2);
    // 1초 안에 이미 멈춤이 있는 장면이 있으면 그 장면에 붙임 — 같은 장면 그림들은 한 번만 멈추게 (조금 넘기고 그려도)
    const near = tele.items.filter((x) => x.hold > 0 && !x.live && Math.abs(x.t0 - t0) <= HOLD_GROUP).sort((a, b) => Math.abs(a.t0 - t0) - Math.abs(b.t0 - t0))[0];
    if (near) t0 = near.t0;
    const dur = +tele.set.dur || 5;
    // 모든 그림: 나타나는 장면에서 4초 멈춤 (그림마다 수정 가능). 트래킹 · 연결선은 멈춘 뒤 따라가는 시간 동안 따라감
    const o = { id: uid(), k, color, t0, t1: tele.set.durEnd ? null : +(t0 + dur).toFixed(2), hold: 4, ...((k === 'spot' || k === 'light') && !followPref ? { still: true } : {}), ...extra };
    if (stylePref && o.color === stylePref.color) applyStyle(o, stylePref); // 고른 스타일의 안쪽 색 · 굵기 등도 같이
    return o;
  };
  // 화면 멈춤 · 천천히: 그림 없이 시간만 — 지금 장면에서 시작
  function addTimeItem(k) {
    const t0 = +t().toFixed(2);
    const it = k === 'freeze' ? { id: uid(), k, t0, hold: 3, color: '#ffffff' } : { id: uid(), k, t0, t1: +Math.min(dur() || t0 + 3, t0 + 3).toFixed(2), speed: 0.5, hold: 0, color: '#4ea1ff' };
    commit(it);
    openSide?.();
    toast(k === 'freeze' ? '지금 장면에서 3초 멈춰요 — 오른쪽에서 시간을 바꿀 수 있어요' : '지금부터 3초를 천천히(×0.5) 재생해요 — 오른쪽에서 길이 · 속도를 바꿀 수 있어요');
  }
  // 만든 뒤에는 바로 '선택'으로 돌아가서 끌어 옮길 수 있게
  const commit = (it) => { snapshot(); tele.items.push(it); draft = null; sel = it; setTool('select'); sel = it; drawSide(); render(); };

  // ── 히트 테스트 ──
  function hit(n) {
    const vis = tele.items.filter(visible).reverse();
    if (sel?.k === 'offside' && !getCal() && vis.includes(sel) && pxDist(offHandle(sel), n) < 16) return { it: sel, h: 1 };
    for (const it of vis) {
      const pts = itemPoints(it);
      let hr = it.k === 'poly' && it.shape ? 14 : 22;
      // 시야가 작으면 두 손잡이가 겹쳐 몸통을 못 잡음 → 손잡이를 작게, 가운데는 몸통(통째로 옮기기)
      if (it.k === 'vision' && pts[0] && pts[1]) hr = Math.max(9, Math.min(22, pxDist(resolve(pts[0]), resolve(pts[1])) * 0.3));
      // 가장 가까운 손잡이 (첫 번째 것만 잡히지 않게)
      let bi = -1; let bd = hr;
      for (let i = 0; i < pts.length; i++) { if (!pts[i]) continue; const d = pxDist(resolve(pts[i]), n); if (d < bd || (d === bd && i > bi)) { bd = d; bi = i; } }
      if (bi >= 0) return { it, h: bi };
    }
    for (const it of vis) {
      const pts = itemPoints(it).filter(Boolean).map(resolve);
      if (it.k === 'spot' && pxDist(pts[0], n) < Math.max(26, (withSpotSize(it).size || 0) * canvas.clientWidth * 1.2)) return { it, h: null };
      if (it.k === 'text' && pxDist(pts[0], n) < Math.max(30, (canvas.clientWidth / 52) * (it.fs || 1) * 1.6)) return { it, h: null }; // 큰 글자는 잡는 범위도 넓게
      if (it.k === 'zoom' && pxDist(pts[0], n) < (it.r || 0.1) * canvas.clientWidth) return { it, h: null };
      if (it.k === 'vision' && (segDist(pts[0], pts[1], n) < 14 || inVision(it, pts, n))) return { it, h: null };
      if (it.k === 'angle' && (segDist(pts[0], pts[1], n) < 14 || segDist(pts[0], pts[2], n) < 14)) return { it, h: null };
      if (it.k === 'light') {
        const sh = lightShape(it); const k = canvas.clientWidth / W();
        if ((((n.x * canvas.clientWidth) - sh.x * k) / (sh.rx * k)) ** 2 + (((n.y * canvas.clientHeight) - sh.y * k) / (sh.ry * k)) ** 2 <= 1) return { it, h: null };
      }
      if (it.k === 'offside') {
        const a = pts[0]; const d = it.d || { x: 0, y: 1 };
        const cw = canvas.clientWidth; const chh = canvas.clientHeight;
        const dx = d.x * cw; const dy = d.y * chh; const len = Math.hypot(dx, dy) || 1;
        if (Math.abs(((n.x - a.x) * cw * dy - (n.y - a.y) * chh * dx) / len) < 10) return { it, h: null };
      }
      if (it.k === 'move') {
        const s2 = moveScale(it);
        const b = resolve(it.b);
        if (Math.abs(n.x - b.x) < (it.wN * s2) / 2 && n.y < b.y + 0.01 && n.y > b.y - it.hN * s2) return { it, h: null };
      }
      if (['arrow', 'measure', 'link'].includes(it.k)) {
        const seq = it.k === 'arrow' ? [pts[0], pts[2] || pts[0], pts[1]] : pts;
        for (let i = 0; i < seq.length - 1; i++) if (segDist(seq[i], seq[i + 1], n) < 14) return { it, h: null };
      }
      if (it.k === 'poly' && it.shape === 'circle' && pts.length === 4) {
        const cx = (pts[0].x + pts[2].x) / 2; const cy = (pts[1].y + pts[3].y) / 2;
        const rx = Math.abs(pts[0].x - cx) || 1e-4; const ry = Math.abs(pts[1].y - cy) || 1e-4;
        if (((n.x - cx) / rx) ** 2 + ((n.y - cy) / ry) ** 2 <= 1) return { it, h: null };
        continue;
      }
      if ((it.k === 'poly' || it.k === 'grid') && inside(pts, n)) return { it, h: null };
    }
    return null;
  }
  // 시야 쐐기 안쪽(조금 넉넉하게)을 누르면 그 시야를 잡음
  const inVision = (it, pts, n) => {
    const cw = canvas.clientWidth; const chh = canvas.clientHeight;
    const ax = pts[0].x * cw; const ay = pts[0].y * chh;
    const L = Math.hypot((pts[1].x - pts[0].x) * cw, (pts[1].y - pts[0].y) * chh);
    const px = n.x * cw - ax; const py = n.y * chh - ay; const d = Math.hypot(px, py);
    if (d > L + 16 || d < 4) return d < 4;
    let da = Math.atan2(py, px) - Math.atan2((pts[1].y - pts[0].y) * chh, (pts[1].x - pts[0].x) * cw);
    da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
    return da <= ((it.spread || 50) * Math.PI) / 360 + Math.min(0.6, 16 / Math.max(1, d));
  };
  const segDist = (a, b, p) => {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const ax = a.x * cw; const ay = a.y * ch; const bx = b.x * cw; const by = b.y * ch; const px = p.x * cw; const py = p.y * ch;
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const k = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
    return Math.hypot(px - (ax + k * (bx - ax)), py - (ay + k * (by - ay)));
  };
  const inside = (pts, p) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if ((pts[i].y > p.y) !== (pts[j].y > p.y) && p.x < ((pts[j].x - pts[i].x) * (p.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) c = !c;
    }
    return c;
  };

  // 연결선: 누른 곳의 선수를 트래킹 (이미 트래킹 중인 선수면 그 선수 사용)
  function trackAt(n) {
    const s0 = snap(n);
    if (s0.tr) return s0;
    const tr = { id: uid(), name: `선수 ${tele.trackers.length + 1}`, path: [] };
    let at = n;
    try {
      const st = pt.init(video, n.x, n.y, tele.set, fa.hz);
      trk.set(tr.id, st);
      at = { x: st.x / video.videoWidth, y: st.y / video.videoHeight };
      tr.h = +(st.ph / video.videoHeight).toFixed(4);
    } catch { /* 픽셀 접근 불가 */ }
    setTrackerAt(tr, t(), at.x, at.y);
    tele.trackers.push(tr);
    aiSnap(tr, null);
    return { tr: tr.id };
  }

  // 끈 범위 → 바닥에 눕힌 도형의 꼭짓점들 (위아래로 납작하게 = 원근)
  function shapePts(a, b, kind) {
    const cal = getCal();
    if (cal) {
      const A = cal.S({ x: a.x * W(), y: a.y * H() }); const B = cal.S({ x: b.x * W(), y: b.y * H() });
      const N = (X, Y) => { const q = cal.G(X, Y); return { x: +(q.x / W()).toFixed(4), y: +(q.y / H()).toFixed(4) }; };
      if (kind === 'rect') return [N(A.x, A.y), N(B.x, A.y), N(B.x, B.y), N(A.x, B.y)];
      const C = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }; const R = Math.max(0.5, Math.hypot(B.x - A.x, B.y - A.y) / 2);
      if (kind === 'circle') return [N(C.x + R, C.y), N(C.x, C.y + R), N(C.x - R, C.y), N(C.x, C.y - R)];
      const nn = { tri: 3, penta: 5, hexa: 6 }[kind] || 10;
      return Array.from({ length: nn }, (_, i) => { const an = -Math.PI / 2 + (i * 2 * Math.PI) / nn; return N(C.x + Math.cos(an) * R, C.y + Math.sin(an) * R); });
    }
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rx = Math.max(0.005, Math.abs(b.x - a.x) / 2);
    const ry = Math.max(rx * (W() / H()) * 0.42, Math.abs(b.y - a.y) / 2);
    const r = (v) => +v.toFixed(4);
    if (kind === 'circle') return [{ x: r(cx + rx), y: r(cy) }, { x: r(cx), y: r(cy + ry) }, { x: r(cx - rx), y: r(cy) }, { x: r(cx), y: r(cy - ry) }];
    if (kind === 'rect') return gridQuad(a, b); // 네모는 바닥에 눕힌 사다리꼴 (멀리 있는 쪽이 좁게 = 원근)
    const n = { circle: 10, tri: 3, penta: 5, hexa: 6 }[kind] || 10;
    const start = kind === 'hexa' ? 0 : -Math.PI / 2;
    return Array.from({ length: n }, (_, i) => {
      const ang = start + (i * 2 * Math.PI) / n;
      return { x: r(cx + Math.cos(ang) * rx), y: r(cy + Math.sin(ang) * ry) };
    });
  }

  // 트래킹 선수의 네모 (발 위치 · 키 · 가로세로 비율로 계산)
  function trBox(tr) {
    const q = trackerPos(tr, t());
    if (!q) return null;
    const h = q.h || tr.h || 0.08;
    const wN = (h * video.videoHeight * (tr.ar || 0.5)) / video.videoWidth;
    return { x0: q.x - wN / 2, y0: q.y - h * 1.04, x1: q.x + wN / 2, y1: q.y + h * 0.04 };
  }
  // 지금 장면에서 쓰이는 트래킹 선수들
  const activeTrackers = () => tele.trackers.filter((tr) => tele.items.some((it) => visible(it) && itemPoints(it).some((p) => p && p.tr === tr.id)));
  const boxesShown = () => edit && video.paused && !freeze && !recording; // 편집할 때만 (강조 멈춤 · 녹화 중엔 숨김)
  // 트래킹 네모: 안쪽을 잡으면 통째로 옮기기, 모서리 · 테두리(바깥쪽 12px 까지)를 잡으면 크기 조절
  function boxAt(n) {
    if (!boxesShown()) return null;
    const cw = canvas.clientWidth; const chh = canvas.clientHeight;
    const px = n.x * cw; const py = n.y * chh;
    let inBox = null;
    for (const tr of focusTrackers()) {
      const b = trBox(tr);
      if (!b) continue;
      const X0 = b.x0 * cw; const X1 = b.x1 * cw; const Y0 = b.y0 * chh; const Y1 = b.y1 * chh;
      const m = X1 - X0 >= 40 ? 6 : 0; // 큰 네모는 테두리 안쪽 6px 도 크기 조절, 작은 네모는 바깥쪽만
      const deep = px > X0 + m && px < X1 - m && py > Y0 + m && py < Y1 - m;
      if (!deep) {
        const cs = [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]];
        for (let i = 0; i < 4; i++) if (Math.hypot(px - cs[i][0], py - cs[i][1]) < 16) return { tr, mode: 'corner', i, b };
        const R = 12;
        if (py > Y0 && py < Y1 && Math.abs(px - X0) < R) return { tr, mode: 'edge', side: 'l', b };
        if (py > Y0 && py < Y1 && Math.abs(px - X1) < R) return { tr, mode: 'edge', side: 'r', b };
        if (px > X0 && px < X1 && Math.abs(py - Y0) < R) return { tr, mode: 'edge', side: 't', b };
        if (px > X0 && px < X1 && Math.abs(py - Y1) < R) return { tr, mode: 'edge', side: 'b', b };
      }
      if (!inBox && px > X0 && px < X1 && py > Y0 && py < Y1) inBox = { tr, mode: 'move', b };
    }
    return inBox;
  }
  // 네모를 다시 맞추면 그 장면에서 선수 모습을 다시 익히고 그 지점부터 따라감
  function applyBox(tr, b) {
    const VW = video.videoWidth; const VH = video.videoHeight;
    if (tr.manual) {
      setKeyAt(tr, t(), (b.x0 + b.x1) / 2, b.y1 - (b.y1 - b.y0) * 0.04);
      tr.h = +((b.y1 - b.y0) / 1.08).toFixed(4);
      tr.ar = +(((b.x1 - b.x0) * VW) / (tr.h * VH)).toFixed(3);
      tr.lost = false;
      stampH(tr, t());
      return;
    }
    try {
      const st = pt.initBox(video, { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 - (b.y1 - b.y0) * 0.04 }, tele.set, fa.hz);
      trk.set(tr.id, st);
      setTrackerAt(tr, t(), st.x / VW, st.y / VH);
    } catch { setTrackerAt(tr, t(), (b.x0 + b.x1) / 2, b.y1); }
    tr.h = +((b.y1 - b.y0) / 1.08).toFixed(4);
    tr.ar = +(((b.x1 - b.x0) * VW) / (tr.h * VH)).toFixed(3);
    tr.lost = false;
    stampH(tr, t());
    clearGaps(tr, t(), fix?.tr === tr && !fix.open ? fix.b : Infinity);
    if (tr.endAt != null && t() >= tr.endAt) delete tr.endAt;
    queueBg(tr, t()); // 네모를 맞추면(선수를 고르면) 뒤에서 AI가 바로 끝까지 따라감
  }

  // ───────── AI 선수 인식 · 다시 잡기 · 정밀 추적 · 수동 ─────────
  const VWH = () => [video.videoWidth, video.videoHeight];
  const setHint = (m) => { el.querySelector('[data-hint]').textContent = m ?? (man ? manHint() : HINT[tool] || ''); };
  const placeAt = (tr, x, y) => (tr.manual ? setKeyAt(tr, t(), x, y) : setTrackerAt(tr, t(), x, y));
  // 네모는 트래킹 도구를 쓸 때 · 수동일 때 · 그 선수에 붙은 그림을 골랐을 때만 (평소엔 링이 가려지지 않게)
  const focusTrackers = () => {
    if (tool === 'track' || man) return activeTrackers();
    if (!sel) return [];
    const ids = new Set(itemPoints(sel).filter((q) => q?.tr).map((q) => q.tr));
    return activeTrackers().filter((tr) => ids.has(tr.id));
  };
  const shownTrackers = () => { const a = focusTrackers(); if (man && !a.includes(man.tr)) a.push(man.tr); return a; };
  // AI 상자(영상 px, 머리~발) → 트래킹 네모(정규화)
  const aiToBox = (b) => { const [VW, VH] = VWH(); const hh = (b.y1 - b.y0) / VH; return { x0: b.x0 / VW, x1: b.x1 / VW, y0: b.y1 / VH - hh * 1.04, y1: b.y1 / VH + hh * 0.04 }; };
  // ───────── 뒤에서 AI 추적: 선수를 고르면 바로 시작 · 그동안 그리기 · 재생 그대로 (따로 연 영상으로 계산) ─────────
  const bgQ = []; let bgRun = null; let bgVideo = null; const faB = new FrameAnalyzer(640);
  const bgSrc = () => {
    if (!bgVideo) { bgVideo = document.createElement('video'); bgVideo.muted = true; bgVideo.playsInline = true; bgVideo.preload = 'auto'; bgVideo.crossOrigin = 'anonymous'; bgVideo.src = video.currentSrc || video.src; }
    return bgVideo;
  };
  state.cleanup.push(() => { bgQ.length = 0; if (bgRun) bgRun.cancel = true; if (bgVideo) { bgVideo.removeAttribute('src'); bgVideo.load(); } });
  const bgSeek = (v, sec) => new Promise((res) => { const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); res(); }; const to = setTimeout(done, 3000); v.addEventListener('seeked', done); v.currentTime = sec; });
  function queueBg(tr, from) {
    if (!edit || !fa.ok || !tr || tr.manual || recording) return;
    if (bgRun?.tr === tr) bgRun.cancel = true;
    const i = bgQ.findIndex((x) => x.tr === tr); if (i >= 0) bgQ.splice(i, 1);
    bgQ.push({ tr, from });
    if (!bgRun) runBg();
  }
  async function runBg() {
    while (bgQ.length && studio.isConnected) {
      const job = bgQ.shift(); bgRun = job; job.t0w = performance.now(); drawWait();
      try { await loadAI(); await bgTrackOne(job); } catch (e) { console.warn('[AI 추적]', e); }
      if (job.tr.bg) delete job.tr.bg;
      bgRun = null; dirty = true; queueDraft?.(); drawSide(); drawMarks(); drawWait();
    }
    drawWait();
    if (pendingPlay && studio.isConnected) { pendingPlay = false; toast('AI가 끝까지 따라갔어요 — 재생할게요'); playSmart(); }
  }
  let pendingPlay = false; let waitSkip = false;
  function drawWait() {
    const w = el.querySelector('[data-aiwait]'); if (!w) return;
    const on = !!(bgRun || bgQ.length) && edit;
    w.hidden = !on;
    if (!on) return;
    const r = bgRun?.tr.bg; const pc = r ? Math.round(((r.at - r.from) / Math.max(0.1, r.until - r.from)) * 100) : 0;
    let eta = '';
    if (r && bgRun.t0w && r.at > r.from + 0.3) { const rate = (r.at - r.from) / ((performance.now() - bgRun.t0w) / 1000); const left = ((r.until - r.at) / Math.max(0.05, rate)) + bgQ.length * 8; eta = ` · 남은 시간 약 ${Math.max(1, Math.round(left))}초`; }
    w.innerHTML = `<div class="aw-card"><span class="aw-spin"></span><div class="aw-txt"><b>AI가 ${esc(bgRun?.tr.name || '선수')}을(를) 따라가는 중이에요 · ${pc}%</b><small>${pendingPlay ? '끝나면 바로 재생할게요' : '잠시만 기다려 주세요 — 그동안 다른 그림은 그려도 돼요'}${eta}${bgQ.length ? ` · 다음 ${bgQ.length}명` : ''}</small></div>
      ${pendingPlay ? '<button type="button" class="btn ghost sm" data-awskip>기다리지 않고 재생</button>' : ''}<button type="button" class="btn ghost sm" data-awstop>멈추기</button><i style="width:${pc}%"></i></div>`;
    w.querySelector('[data-awskip]')?.addEventListener('click', () => { pendingPlay = false; waitSkip = true; drawWait(); video.play(); setTimeout(() => { waitSkip = false; }, 300); });
    w.querySelector('[data-awstop]').onclick = () => { bgQ.length = 0; if (bgRun) bgRun.cancel = true; pendingPlay = false; toast('AI 따라가기를 멈췄어요 — 여기까지 계산한 곳은 그대로 써요'); drawWait(); };
  }
  const waitBg = async () => { while (bgRun || bgQ.length) await new Promise((r) => setTimeout(r, 200)); };
  async function bgTrackOne(job) {
    const { tr } = job; const v = bgSrc();
    if (v.readyState < 1) await new Promise((r) => { v.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 5000); });
    const VW = v.videoWidth; const VH = v.videoHeight; if (!VW) return;
    if (faB._vw !== VW) { faB.resize(VW, VH); faB._vw = VW; }
    const from = Math.max(0, job.from ?? (tr.path[0]?.[0] ?? t()));
    const tu = trackUntil(tr);
    const until = Math.min(v.duration || from + 30, Number.isFinite(tu) ? tu : from + 30, from + 60);
    if (until - from < 0.1) return;
    await bgSeek(v, from); faB.grab(v, tele.set);
    const q = trackerPos(tr, from); if (!q) return;
    const h = q.h || tr.h || 0.08; const wN = (h * VH * (tr.ar || 0.45)) / VW;
    const st = pt.initBox(v, { x: q.x - wN / 2, y: q.y - h * 1.04 }, { x: q.x + wN / 2, y: q.y }, tele.set, faB.horizon());
    st.x = q.x * VW; st.y = q.y * VH; st.ph = h * VH; st.ph0 = st.ph;
    follow.prime(v, st);
    Object.defineProperty(tr, 'bg', { value: { from, until, at: from }, writable: true, configurable: true, enumerable: false }); // 저장 · 되돌리기에 안 들어가게
    tr.path = tr.path.filter((p) => p[0] < from - 1e-3); clearGaps(tr, from, Infinity);
    tr.path.push([+from.toFixed(3), +q.x.toFixed(4), +q.y.toFixed(4), +h.toFixed(4)]);
    let prev = from; let missRun = 0; let missFrom = null; let amb = false; let outRun = 0; let n = 0;
    while (prev < until - 1e-3) {
      if (job.cancel || !studio.isConnected || !tele.trackers.includes(tr) || tr.manual) break;
      const nt = Math.min(until, prev + (missRun || amb ? 1 / 24 : 1 / 12));
      await bgSeek(v, nt); faB.grab(v, tele.set);
      if (job.cancel) break;
      if (faB.cut) { st.nb = []; st.vx = 0; st.vy = 0; }
      const out = missRun > 0 && holdAtEdge(st, VW, VH);
      const r = await follow.step(v, st, tele.set, nt - prev, faB.cut ? { dx: 0, dy: 0 } : faB.cam, out ? 3 : 1);
      if (job.cancel) break;
      amb = r.amb || r.occ;
      if (r.ok || r.occ || r.amb) { if (missFrom != null) closeGap(tr, missFrom, nt); missRun = 0; missFrom = null; outRun = 0; }
      else { missRun++; if (missFrom == null) missFrom = prev; if (out) outRun++; markGap(tr, missFrom, nt, out ? 'out' : 'lost'); }
      tr.h = +(st.ph / VH).toFixed(4);
      tr.path.push([+nt.toFixed(3), +(st.x / VW).toFixed(4), +(st.y / VH).toFixed(4), tr.h]);
      tr.aiTo = +nt.toFixed(3); tr.bg.at = nt; tr.lost = missRun > 3;
      prev = nt;
      if (missFrom != null && nt - missFrom >= (outRun ? 10 : 1.5)) { tr.lost = true; break; }
      if (++n % 4 === 0) { drawWait(); if (n % 8 === 0) drawSide(); if (video.paused && !freeze) render(); }
    }
  }
  const bgLine = () => {
    const jobs = [bgRun, ...bgQ].filter(Boolean);
    if (!jobs.length) return '';
    const r = bgRun?.tr.bg; const pc = r ? Math.round(((r.at - r.from) / Math.max(0.1, r.until - r.from)) * 100) : 0;
    return `<div class="bg-line"><span class="bg-dot"></span><b>AI가 ${esc(bgRun?.tr.name || '')} 따라가는 중 ${pc}%</b>${bgQ.length ? `<small>다음 ${bgQ.length}명</small>` : ''}<i style="width:${pc}%"></i></div>`;
  };
  const aiLine = () => bgLine() + (!fa.ok && video.readyState >= 2 ? '<p class="ai-line warn">이 영상은 픽셀을 읽을 수 없어 AI를 쓸 수 없어요</p>'
    : `<p class="ai-line ${ai.status}">${{ idle: 'AI 선수 인식 · 트래킹을 시작하면 준비돼요', loading: 'AI 준비 중… (처음 한 번 10초 정도)', ready: 'AI 선수 인식 준비됨', failed: 'AI를 불러오지 못해 색으로만 따라가요 (인터넷 확인)' }[ai.status]}</p>`);

  // ───────── 놓친 구간 · 화면 밖 구간 ─────────
  // tr.gaps: [{ a, b, k: 'lost'(놓침) | 'out'(화면 밖), hide }] — 이 구간만 골라서 고칠 수 있게
  const GAP_MIN = 0.25; // 이보다 짧게 놓친 건 무시 (잠깐 가려진 정도)
  const gapsOf = (tr) => (tr.gaps || []).filter((g) => g.b - g.a >= GAP_MIN);
  function markGap(tr, a, b, k) {
    const gs = tr.gaps || (tr.gaps = []);
    const g = gs.find((x) => a <= x.b + 0.15 && b >= x.a - 0.15);
    if (g) { g.a = +Math.min(g.a, a).toFixed(3); g.b = +Math.max(g.b, b).toFixed(3); if (k === 'out') g.k = 'out'; } else gs.push({ a: +a.toFixed(3), b: +b.toFixed(3), k });
    gs.sort((p, q) => p.a - q.a);
  }
  // 다시 찾았을 때: 너무 짧게 놓친 구간은 지움
  function closeGap(tr, a, b) {
    if (!tr.gaps) return;
    tr.gaps = tr.gaps.filter((g) => !(g.a >= a - 0.16 && g.b <= b + 0.01 && g.b - g.a < GAP_MIN));
    if (!tr.gaps.length) delete tr.gaps;
  }
  function clearGaps(tr, a, b = Infinity) {
    if (!tr.gaps) return;
    const out = [];
    for (const g of tr.gaps) {
      if (g.b <= a || g.a >= b) { out.push(g); continue; }
      if (g.a < a) out.push({ ...g, b: +a.toFixed(3) });
      if (g.b > b) out.push({ ...g, a: +b.toFixed(3) });
    }
    tr.gaps = out.filter((g) => g.b - g.a > 0.05);
    if (!tr.gaps.length) delete tr.gaps;
  }
  const gapAt = (tr, tt) => gapsOf(tr).find((g) => tt >= g.a && tt <= g.b);
  // 지금 이 선수를 숨겨야 하나 (화면 밖 · 숨기기로 한 구간)
  const trHid = (id) => {
    const tr = tele.trackers.find((x) => x.id === id);
    const g = tr && !tr.manual && gapAt(tr, t());
    return !!g && (g.k === 'out' || g.hide);
  };
  // 숨겼던 선수가 다시 나오면 링이 처음처럼 펼쳐지며 나타남
  const backIn = (id, sec) => {
    const tr = tele.trackers.find((x) => x.id === id);
    if (!tr || tr.manual) return 1;
    const now = t();
    const g = gapsOf(tr).find((x) => (x.k === 'out' || x.hide) && now > x.b && now < x.b + sec);
    return g ? Math.max(0, (now - g.b) / sec) : 1;
  };
  // 예상 위치가 화면 가장자리 밖이면 '화면 밖' — 나간 자리(가장자리)에 멈춰서 다시 들어오기를 기다림
  function holdAtEdge(st, VW, VH) {
    const m = st.ph * 0.25;
    const out = st.x < m || st.x > VW - m || st.y > VH - st.ph * 0.04 || st.y < st.ph * 0.35;
    if (!out) return false;
    st.x = Math.max(m, Math.min(VW - m, st.x));
    st.y = Math.max(st.ph * 0.35, Math.min(VH - st.ph * 0.04, st.y));
    st.vx = 0; st.vy = 0;
    return true;
  }
  function gapList(tr, gs) {
    const p0 = tr.path[0]?.[0] ?? 0; const p1 = Math.max(lastT(tr), ...gs.map((g) => g.b));
    const span = Math.max(0.1, p1 - p0);
    const bar = `<div class="tr-gbar" title="${fmtT1(p0)} → ${fmtT1(p1)} 따라간 구간 (빨강 = 놓침, 회색 = 화면 밖)">${gs.map((g) => `<i class="${g.k}${g.hide ? ' hid' : ''}" style="left:${((g.a - p0) / span) * 100}%;width:${Math.max(1.5, ((g.b - g.a) / span) * 100)}%"></i>`).join('')}</div>`;
    const end = lastT(tr);
    const rows = gs.slice(0, 4).map((g, i) => {
      const open = g.b >= end - 0.05;
      const k = `${tr.id}:${i}`;
      const acts = g.k === 'out'
        ? `${open ? `<button class="chip" data-gfix="${k}:back" title="선수가 다시 보이는 장면으로 옮긴 뒤 누르세요">다시 나온 장면에서 잡기</button>` : ''}<button class="chip" data-gfix="${k}:go">보기</button>`
        : `<button class="chip pri" data-gfix="${k}:ai">AI로 다시 잡기</button><button class="chip" data-gfix="${k}:hand">직접 찍기</button><button class="chip" data-gfix="${k}:hide">${g.hide ? '보이기' : '숨기기'}</button>`;
      return `<div class="tr-gap"><span class="gk ${g.k}">${g.k === 'out' ? '화면 밖' : g.hide ? '숨김' : '놓침'}</span><b>${fmtT1(g.a)} → ${open && g.k === 'out' ? '끝' : fmtT1(g.b)}</b><small>${(g.b - g.a).toFixed(1)}초${g.k === 'out' ? ' · 이 동안 표시를 숨겨요' : ''}</small><span class="tr-gacts">${acts}</span></div>`;
    }).join('');
    return `<div class="tr-gaps">${bar}${rows}${gs.length > 4 ? `<small class="muted">외 ${gs.length - 4}곳 — 앞에서부터 고치면 나머지가 보여요</small>` : ''}</div>`;
  }

  // 놓친 구간 고치기: 그 구간 처음으로 바로 가서 고치고, 끝나면 원래 보던 장면으로 돌아옴
  let fix = null; // { tr, a, b, open, back, tail }
  let gman = null; // 직접 찍기 { tr, a, b, step, back, n, open }
  const endFix = () => { fix = null; };
  async function fixGap(tr, g, how) {
    if (busy) return;
    video.pause(); freeze = null;
    if (man) endManual();
    const back = t();
    const open = g.b >= lastT(tr) - 0.05;
    if (how === 'go') { await seekTo(g.a); render(); return; }
    if (how === 'hide') { snapshot(); g.hide = !g.hide; drawMarks(); drawSide(); render(); toast(g.hide ? '이 구간 동안 표시를 숨겨요' : '이 구간도 다시 보여요'); return; }
    if (how === 'hand') { startGapHand(tr, g, back, open); return; }
    const at = how === 'back' ? back : g.a;
    if (how === 'back' && at <= g.a + 0.05) { toast('선수가 다시 보이는 장면으로 옮긴 뒤 누르세요 (아래 재생바)'); return; }
    fix = { tr, a: at, b: how === 'back' ? at : g.b, open: open || how === 'back', back, tail: tr.path.filter((q) => q[0] > g.b + 0.001) };
    if (how === 'back') clearGaps(tr, g.a, at), markGap(tr, g.a, at, 'out');
    await seekTo(at);
    await reacquire(tr);
    if (cands) setHint(`${fmtT1(at)} 장면 · 맞는 선수를 누르세요 — 고치고 나면 ${fmtT1(back)}로 돌아가요 · Esc 취소`);
  }
  // 다시 잡은 뒤: 놓친 구간 끝까지만 AI로 따라가고 그 뒤 기록은 그대로 → 원래 장면으로
  async function afterRecatch(tr) {
    const f = fix; fix = null;
    if (!f.open && f.tail.length) tr.path = [...tr.path.filter((q) => q[0] <= f.b), ...f.tail].sort((p, q) => p[0] - q[0]);
    drawSide(); render();
    await preciseTrack(tr, f.open ? { quiet: true } : { to: f.b, quiet: true });
    await seekTo(f.back);
    lastProcessed = t();
    const left = gapsOf(tr).filter((g) => g.a < f.b + 0.05 && g.b > f.a - 0.05 && g.k === 'lost');
    toast(left.length ? '아직 못 잡은 부분이 있어요 — [직접 찍기]로 마무리하세요' : `${fmtT1(f.a)} 구간을 고쳤어요 — 보던 장면(${fmtT1(f.back)})으로 돌아왔어요`);
    drawMarks(); drawSide(); render();
  }
  async function startGapHand(tr, g, back, open) {
    setTool('select'); cands = null;
    snapshot();
    const step = g.b - g.a < 1.5 ? 0.2 : 0.5;
    tr.path = tr.path.filter((q) => q[0] <= g.a + 0.001 || q[0] >= g.b - 0.001); // 틀린 점은 지우고 찍은 점으로 이음
    trk.delete(tr.id);
    gman = { tr, a: g.a, b: g.b, step, back, n: 0, open };
    await seekTo(Math.min(g.b, g.a + step));
    setHint(`${tr.name} 발밑을 누르세요 · ←/→ ${step}초 이동 · Enter 완료`);
    drawPanel(); render();
  }
  function gapHandKey(n) {
    const g = gman; const now = t();
    const q = trackerPos(g.tr, now);
    setKeyAt(g.tr, now, +n.x.toFixed(4), +n.y.toFixed(4), q?.h || g.tr.h, 0.02);
    g.n++; g.upto = Math.max(g.upto ?? g.a, now);
    const next = +(now + g.step).toFixed(3);
    if (g.open ? now >= g.b - 0.001 : next >= g.b - g.step * 0.3) { finishGapHand(); return; }
    seekTo(Math.min(g.b, next)).then(() => { drawPanel(); render(); });
    drawPanel(); render();
  }
  async function finishGapHand() {
    const g = gman; gman = null;
    if (g.n) clearGaps(g.tr, g.a, g.open || (g.upto ?? g.a) < g.b - g.step ? (g.upto ?? g.a) : g.b);
    trk.delete(g.tr.id); g.tr.lost = false;
    await seekTo(g.back);
    lastProcessed = t();
    setHint(); drawPanel(); drawMarks(); drawSide(); render();
    toast(g.n ? `점 ${g.n}개로 이 구간을 이었어요 — 보던 장면으로 돌아왔어요` : '찍은 점이 없어 그대로 두었어요');
  }

  function trRow(tr, withDel = true) {
    const gs = tr.manual ? [] : gapsOf(tr);
    const nLost = gs.filter((g) => g.k === 'lost').length;
    const status = tr.bg ? `AI가 따라가는 중 · ${fmtT1(tr.bg.at)}까지` : tr.manual ? `수동 · 점 ${tr.path.length}개` : nLost ? `놓친 구간 ${nLost}곳 — 아래에서 그 구간만 고치세요` : tr.lost ? '놓침 — [다시 잡기]를 누르세요' : `AI 추적 · ${fmtT(tr.path[0]?.[0] || 0)}부터`;
    return `<li class="tr-row"><span class="dot" style="background:${tr.manual ? '#ff9f0a' : tr.lost ? '#ff3b30' : '#4ea1ff'}"></span>
      <div><b>${esc(tr.name)}</b><small>${status}</small></div>
      ${withDel ? `<button class="link-btn small" data-trdel="${tr.id}">삭제</button>` : ''}
      <div class="tr-acts">
        <button class="chip" data-tracq="${tr.id}" title="AI가 화면의 선수들을 찾아 보여줘요">다시 잡기</button>
        <button class="chip" data-trprec="${tr.id}" title="멈춘 채로 한 장면씩 AI로 확인하며 따라가요">AI 정밀 추적</button>
        ${tr.manual ? `<button class="chip" data-trman="${tr.id}">점 고치기</button><button class="chip" data-trauto="${tr.id}">AI로 바꾸기</button>`
          : `<button class="chip" data-trman="${tr.id}" title="초 단위로 직접 위치를 찍어요">수동</button><button class="chip" data-trbad="${tr.id}" title="AI가 다른 선수를 따라가기 시작한 장면에서 누르세요">여기부터 틀림</button>`}
      </div>${gs.length ? gapList(tr, gs) : ''}</li>`;
  }
  function bindTr(box) {
    const find = (id) => tele.trackers.find((x) => x.id === id);
    box.querySelectorAll('[data-tracq]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); reacquire(find(b.dataset.tracq)); }));
    box.querySelectorAll('[data-trprec]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); preciseTrack(find(b.dataset.trprec)); }));
    box.querySelectorAll('[data-trman]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); startManual(find(b.dataset.trman)); }));
    box.querySelectorAll('[data-trbad]').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const tr = find(b.dataset.trbad); const now = t(); const end = lastT(tr);
      if (end - now < 0.1) { toast('이 장면 뒤로는 아직 따라간 기록이 없어요'); return; }
      snapshot(); markGap(tr, now, end, 'lost'); drawMarks(); drawSide(); render();
      toast(`${fmtT1(now)} → ${fmtT1(end)}를 놓친 구간으로 표시했어요 — 아래에서 [AI로 다시 잡기] · [직접 찍기]`);
    }));
    box.querySelectorAll('[data-gfix]').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const [id, i, how] = b.dataset.gfix.split(':');
      const tr = find(id); const g = tr && gapsOf(tr)[+i];
      if (g) fixGap(tr, g, how);
    }));
    box.querySelectorAll('[data-trauto]').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const tr = find(b.dataset.trauto);
      snapshot(); tr.manual = false; trk.delete(tr.id);
      // 지금 시점까지의 점은 그대로, 이후는 재생하면 AI가 따라감
      tr.path = tr.path.filter((q) => q[0] <= t() + 0.001);
      if (man?.tr === tr) endManual();
      toast('지금부터는 ▶ 재생하면 AI가 따라갑니다'); drawSide(); render();
    }));
  }

  // 새로 잡은 선수를 AI로 정확히 맞추기 (감싼 네모 user 가 있으면 그와 가장 많이 겹치는 사람)
  async function aiSnap(tr, user) {
    if (!fa.ok) return;
    const at = t();
    setHint('AI가 선수를 찾는 중…');
    try {
      await loadAI();
      const [VW, VH] = VWH();
      const q = trackerPos(tr, at);
      if (!q) return;
      const ph = (q.h || tr.h || 0.08) * VH;
      const boxes = await detectAround(video, q.x * VW, q.y * VH, ph);
      if (Math.abs(t() - at) > 0.01 || !tele.trackers.includes(tr)) return; // 그 사이 장면이 바뀜
      let b = null;
      if (user) {
        const U = { x0: user.x0 * VW, x1: user.x1 * VW, y0: user.y0 * VH, y1: user.y1 * VH };
        let bi = 0.15;
        for (const c of boxes) {
          const iw = Math.max(0, Math.min(U.x1, c.x1) - Math.max(U.x0, c.x0)); const ih = Math.max(0, Math.min(U.y1, c.y1) - Math.max(U.y0, c.y0));
          const i = (iw * ih) / ((U.x1 - U.x0) * (U.y1 - U.y0) + (c.x1 - c.x0) * (c.y1 - c.y0) - iw * ih || 1);
          if (i > bi) { bi = i; b = c; }
        }
      }
      if (!b) b = pickNear(boxes, q.x * VW, q.y * VH, ph, 0.9);
      if (b) { applyBox(tr, aiToBox(b)); toast('AI가 선수를 잡았어요 — 뒤에서 AI가 끝까지 따라가요 (그동안 계속 그려도 돼요)'); }
      else { toast('AI가 이 선수를 못 찾았어요 — 네모를 직접 맞추거나 [다시 잡기] · [수동]을 쓰세요'); queueBg(tr, at); }
    } catch { toast('AI를 쓸 수 없어 색으로만 따라갑니다'); } finally { setHint(); drawSide(); render(); }
  }

  // AI 후보 중 이 선수 고르기: 가까움 + 키 + '처음 고른 선수와 유니폼 색이 같은지'까지 봄 (상대 팀 · 옆 선수로 안 넘어가게)
  const bcOf = (a, b) => { let v = 0; for (let i = 0; i < 96; i++) v += Math.sqrt(a[i] * b[i]); return v / 2; };
  // 후보 상자 중 이 선수: 처음 잡았을 때 유니폼 색(hist0)을 더 믿고, 예상 위치 · 키 · 모양(두 명이 합쳐진 넓은 상자는 감점)
  // 겹쳐서 비슷한 후보가 둘이면 amb = true (그 순간엔 함부로 옮겨 타지 않음)
  function pickBest(boxes, st, maxDist, withAmb = false) {
    if (!st.hist0) st.hist0 = Float32Array.from(st.hist);
    const scored = [];
    for (const b of boxes) {
      const bw = b.x1 - b.x0; const bh = b.y1 - b.y0;
      const d = Math.hypot((b.x0 + b.x1) / 2 - st.x, b.y1 - st.y) / Math.max(8, st.ph);
      if (d > maxDist) continue;
      let bc = 0.5;
      try {
        const r = pt.read(video, b.x0, b.y0, bw, bh, Math.min(1, 26 / bh));
        const hh = pt.hist(r.d, r.w, 0, 0, r.w, r.h, tele.set).hst;
        bc = bcOf(hh, st.hist0) * 0.6 + bcOf(hh, st.hist) * 0.4;
      } catch { /* 픽셀 못 읽음 → 위치로만 */ }
      const size = Math.abs(Math.log(Math.max(4, bh) / Math.max(4, st.ph)));
      const wide = Math.max(0, bw / Math.max(1, bh) - 0.75) * 1.5;
      scored.push({ b, bc, sc: bc * 1.4 + b.score * 0.3 - d * 0.6 - size * 0.5 - wide });
    }
    scored.sort((p, q) => q.sc - p.sc);
    const top = scored[0];
    const ok = top && top.bc >= 0.38 ? top.b : null; // 색이 너무 다르면 다른 선수 → 이번엔 보정 안 함
    if (!withAmb) return ok;
    const sec = scored[1];
    const amb = !!(ok && sec && top.sc - sec.sc < 0.12
      && Math.hypot((sec.b.x0 + sec.b.x1 - top.b.x0 - top.b.x1) / 2, sec.b.y1 - top.b.y1) < st.ph * 0.9);
    return { b: ok, amb, alt: amb ? sec.b : null };
  }

  // 재생 중 AI 보정: 0.4초마다(놓쳤으면 더 자주) 주변에서 사람을 찾아 위치 · 크기를 바로잡음
  function aiCorrect(tr, st) {
    if (aiLive || ai.status !== 'ready' || !fa.ok) return;
    const now = t();
    if (now - (st.aiAt ?? -9) < (st.miss ? 0.15 : 0.4)) return;
    aiLive = true; st.aiAt = now;
    const qx = st.x; const qy = st.y; const qph = st.ph;
    const [VW, VH] = VWH();
    detectAround(video, qx, qy, qph, st.miss ? 1.8 : 1).then((boxes) => {
      if (!tele.trackers.includes(tr) || tr.manual) return;
      const pk = pickBest(boxes, { ...st, x: qx, y: qy, ph: qph, hist: st.hist, hist0: st.hist0 || (st.hist0 = Float32Array.from(st.hist)) }, st.miss ? 2.2 : 0.9, true);
      const b = pk.b;
      if (!b || pk.amb) return; // 겹친 순간엔 색 추적에 맡김
      const dx = (b.x0 + b.x1) / 2 - qx; const dy = b.y1 - qy;
      if (Math.hypot(dx, dy) > qph * 0.12) {
        st.x += dx; st.y += dy;
        // 그 순간 이후 기록도 같이 바로잡기
        for (const q of tr.path) if (q[0] >= now - 0.001) { q[1] = +(q[1] + dx / VW).toFixed(4); q[2] = +(q[2] + dy / VH).toFixed(4); }
      }
      const bh = b.y1 - b.y0;
      if (bh > 6) {
        st.ph = st.ph * 0.6 + bh * 0.4; st.ph0 = st.ph0 * 0.8 + st.ph * 0.2; tr.h = +(st.ph / VH).toFixed(4);
        for (const q of tr.path) if (q[0] >= now - 0.001) q[3] = tr.h;
      }
      st.miss = 0; tr.lost = false;
    }).catch(() => {}).finally(() => { aiLive = false; });
  }

  // 지금 장면이 이 선수를 고칠 수 있는 곳인지 (영상 끝 · 표시 시간 뒤 · 시작 전이면 아님)
  const trStart = (tr) => tr.path?.[0]?.[0] ?? 0;
  const inTrRange = (tr, x) => x >= trStart(tr) - 0.05 && x < Math.min((video.duration || Infinity) - 0.15, trackUntil(tr) - 0.1);
  // 다시 분석할 곳: 놓친 구간이 있으면 그 바로 앞 → 놓침이면 놓친 자리 → 아니면 처음 잡은 곳
  function troubleAt(tr) {
    const g = gapsOf(tr)[0] || (tr.gaps || [])[0];
    if (g) return Math.max(trStart(tr), g.a - 0.5);
    if (tr.lost && tr.path?.length) return tr.path[tr.path.length - 1][0];
    return trStart(tr);
  }
  // 버튼을 누르면 영상을 처음으로 안 돌려도 되게: 지금 자리가 안 맞으면 고칠 곳으로 바로 이동
  async function goTrouble(tr, force = false) {
    if (!force && inTrRange(tr, t())) return false;
    const at = troubleAt(tr);
    if (Math.abs(t() - at) > 0.01) await seekTo(at);
    return true;
  }

  // 다시 잡기: 화면 전체에서 선수 후보를 찾아 번호로 보여줌 → 맞는 선수를 누르면 그 선수로
  async function reacquire(tr) {
    if (!tr) return;
    video.pause(); freeze = null;
    if (await goTrouble(tr)) { toast(`${fmtT(t())} 장면에서 ${tr.name}을(를) 다시 잡아요`); render(); }
    if (!fa.ok) { toast('이 영상은 AI로 분석할 수 없어요 — 네모로 직접 감싸세요'); cands = { tr, boxes: [] }; setHint('네모로 선수를 직접 감싸세요 · Esc 취소'); drawPanel(); return; }
    if (man) endManual();
    setTool('select');
    busy = { msg: `${tr.name} — AI가 화면의 선수들을 찾는 중`, p: 0 };
    drawPanel(); render();
    try {
      await loadAI();
      const boxes = await scanFrame(video, null, (pp) => { busy.p = pp; drawPanel(); });
      const q = trackerPos(tr, t());
      const [VW, VH] = VWH();
      if (q) boxes.sort((a, b) => Math.hypot((a.x0 + a.x1) / 2 - q.x * VW, a.y1 - q.y * VH) - Math.hypot((b.x0 + b.x1) / 2 - q.x * VW, b.y1 - q.y * VH));
      cands = { tr, boxes };
    } catch { cands = { tr, boxes: [] }; toast('AI를 불러오지 못했어요 — 네모로 직접 감싸세요'); }
    busy = null;
    setHint(cands.boxes.length ? `${tr.name}: 맞는 선수를 누르세요 (초록 1번이 마지막 위치에서 가장 가까움) · 없으면 네모로 직접 감싸기 · Esc 취소`
      : 'AI가 이 장면에서 선수를 못 찾았어요 → 네모로 직접 감싸세요 · Esc 취소');
    drawPanel(); render();
  }
  // 여러 선수 한 번에: 화면 전체에서 AI로 선수를 찾아 번호 상자로 → 이을 순서대로 누르기 → 한꺼번에 잇고 뒤에서 AI 추적
  async function findMulti() {
    if (busy) return;
    freeze = null; video.pause();
    busy = { msg: 'AI가 화면의 선수를 찾는 중…', p: 0 }; drawPanel();
    try {
      await loadAI();
      const boxes = await scanFrame(video, null, (pp) => { busy.p = pp; drawPanel(); });
      cands = { multi: true, boxes, picked: [] };
    } catch { cands = null; toast('AI를 불러오지 못했어요 — 선수를 하나씩 눌러 주세요'); }
    busy = null; setHint(cands?.boxes.length ? '이을 순서대로 선수 상자를 누르세요 · 다 고르면 [N명 잇고 따라가기] · 첫 선수를 다시 누르면 도형' : undefined); drawPanel(); render();
  }
  function finishMulti(closed) {
    if (!cands?.multi || cands.picked.length < 2) return;
    snapshot();
    const pts = cands.picked.map((b) => {
      const tr = { id: uid(), name: `선수 ${tele.trackers.length + 1}`, path: [] };
      tele.trackers.push(tr);
      applyBox(tr, aiToBox(b)); // → 뒤에서 AI가 바로 따라감
      return { tr: tr.id };
    });
    const it = newItem('link', { pts, ...(closed && pts.length >= 3 ? { closed: true, area: true } : {}) });
    cands = null; setHint(); drawPanel();
    commit(it);
    toast(`${pts.length}명을 이었어요 — 뒤에서 AI가 한 명씩 끝까지 따라가요`);
  }
  function pickCand(n) {
    const [VW, VH] = VWH();
    const px = n.x * VW; const py = n.y * VH;
    const pad = 6 * (VW / canvas.clientWidth);
    const hitB = cands.boxes.find((b) => px >= b.x0 - pad && px <= b.x1 + pad && py >= b.y0 - pad && py <= b.y1 + pad);
    if (cands.multi) {
      if (!hitB) return;
      const i = cands.picked.indexOf(hitB);
      if (i === 0 && cands.picked.length >= 3) { finishMulti(true); return; } // 첫 선수를 다시 누르면 도형으로 닫기
      if (i >= 0) cands.picked.splice(i, 1); else cands.picked.push(hitB);
      drawPanel(); render();
      return;
    }
    if (hitB) {
      snapshot();
      const tr = cands.tr;
      tr.manual = false;
      applyBox(tr, aiToBox(hitB));
      cands = null; setHint(); drawPanel();
      if (fix?.tr === tr) { afterRecatch(tr); return; }
      toast(`${tr.name}을(를) 다시 잡았어요 — ▶ 재생하거나 [AI 정밀 추적]`);
      drawSide(); render();
      return;
    }
    draft = { k: 'trackbox', a: n, b: n, target: cands.tr }; // 후보 밖을 끌면 직접 감싸기
    drag = { creating: true };
    render();
  }
  function drawCands(w, h) {
    const [VW, VH] = VWH();
    // 여러 선수: 고른 순서대로 선을 미리 보여줌
    if (cands.multi && cands.picked.length > 1) {
      ctx.save(); ctx.strokeStyle = 'rgba(255,212,0,.85)'; ctx.lineWidth = Math.max(2, w / 400); ctx.setLineDash([w / 120, w / 200]); ctx.beginPath();
      cands.picked.forEach((b, k) => { const x = (((b.x0 + b.x1) / 2) / VW) * w; const y = (b.y1 / VH) * h; if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke(); ctx.restore();
    }
    cands.boxes.forEach((b, i) => {
      const x0 = (b.x0 / VW) * w; const y0 = (b.y0 / VH) * h; const x1 = (b.x1 / VW) * w; const y1 = (b.y1 / VH) * h;
      const pk = cands.multi ? cands.picked.indexOf(b) : -2;
      if (cands.multi) {
        ctx.save(); const sel2 = pk >= 0; const c2 = sel2 ? '#ffd400' : 'rgba(255,255,255,.55)';
        ctx.strokeStyle = c2; ctx.lineWidth = Math.max(sel2 ? 2.5 : 1.5, w / (sel2 ? 420 : 700)); if (!sel2) ctx.setLineDash([w / 160, w / 260]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]);
        if (sel2) { const fs = Math.max(11, w / 70); ctx.font = `800 ${fs}px Pretendard Variable, sans-serif`; const tw = ctx.measureText(String(pk + 1)).width + fs * 0.6; ctx.fillStyle = c2; ctx.fillRect(x0, y0 - fs * 1.3, tw, fs * 1.3); ctx.fillStyle = '#000'; ctx.textBaseline = 'middle'; ctx.fillText(String(pk + 1), x0 + fs * 0.3, y0 - fs * 0.62); }
        ctx.restore(); return;
      }
      const c = i === 0 ? '#34c759' : '#ffd400';
      ctx.save();
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(2, w / 500);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      const fs = Math.max(11, w / 70);
      ctx.font = `800 ${fs}px Pretendard Variable, sans-serif`;
      const tw = ctx.measureText(String(i + 1)).width + fs * 0.6;
      ctx.fillStyle = c; ctx.fillRect(x0, y0 - fs * 1.3, tw, fs * 1.3);
      ctx.fillStyle = '#000'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x0 + fs * 0.3, y0 - fs * 0.62);
      ctx.restore();
    });
  }

  // AI 정밀 추적: 영상을 멈춘 채 1/12초씩 넘기며 매 장면 AI로 확인 → 놓치지 않고 끝까지
  const seekTo = (sec) => new Promise((res) => {
    const done = () => { video.removeEventListener('seeked', done); clearTimeout(to); res(); };
    const to = setTimeout(done, 3000);
    video.addEventListener('seeked', done);
    video.currentTime = sec;
  });
  // opt.from: 이 시점부터 계산 · opt.quiet: 재생 전 자동 계산(알림 줄임) · opt.cap: 최대 계산 길이(초)
  // 돌려주는 값: true = 끝까지 함(또는 AI 없이 재생해도 됨), false = 멈춤 · 놓침
  // 휴대폰에서 무거운 작업을 시작할 때 한 번 알려줌 (계속할 수 있음)
  async function heavyOk(what) {
    if (!COARSE) return true;
    try { if (sessionStorage.getItem('ssaka.st.heavyOk') === '1') return true; } catch { /* */ }
    const ok = await confirmBox(`${what}은(는) 컴퓨터 · 태블릿이 더 빨라요. 휴대폰에서는 시간이 오래 걸리고 배터리를 많이 써요.\n\n휴대폰에서 계속할까요?`);
    if (ok) try { sessionStorage.setItem('ssaka.st.heavyOk', '1'); } catch { /* */ }
    return ok;
  }
  async function preciseTrack(tr, opt = {}) {
    if (!tr) return false;
    if (bgRun?.tr === tr) { bgRun.cancel = true; await waitBg(); } // 뒤에서 하던 계산은 멈추고 이걸로
    if (!opt.quiet && !(await heavyOk('AI 정밀 추적'))) return false;
    if (!fa.ok) { if (!opt.quiet) toast('이 영상은 AI로 분석할 수 없어요'); return !!opt.quiet; }
    video.pause(); freeze = null; cands = null;
    if (man) endManual();
    const [VW, VH] = VWH();
    // 영상이 끝났거나 이 선수 구간을 지났으면: 처음으로 돌릴 필요 없이 잘못 잡힌 곳부터 다시
    if (opt.from == null && !opt.quiet && !inTrRange(tr, t())) { opt = { ...opt, from: troubleAt(tr) }; toast(`${fmtT(opt.from)}부터 ${tr.name}을(를) 다시 분석해요`); }
    busy = { msg: '', p: 0, stop: false };
    if (opt.from != null && Math.abs(t() - opt.from) > 0.01) await seekTo(opt.from);
    const start = t();
    const u = trackUntil(tr);
    const full = Math.min(video.duration || start + 30, Number.isFinite(u) ? u : start + 30, opt.cap ? start + opt.cap : Infinity);
    let until = opt.to != null ? Math.min(full, opt.to) : full; // opt.to: 이 시각까지만 다시 따라가고 그 뒤 기록은 그대로
    if (until - start < 0.1) { busy = null; drawPanel(); if (!opt.quiet) toast('이 선수의 표시 시간이 끝났어요 — 트래킹 그림의 따라가는 시간을 늘리세요'); return true; }
    snapshot();
    busy.msg = opt.quiet ? `▶ 재생 준비 — AI가 ${tr.name}의 움직임을 계산하는 중 (${fmtT(start)} → ${fmtT(until)})` : `${tr.name} AI 정밀 추적 (${fmtT(start)} → ${fmtT(until)})`;
    drawPanel();
    let ok = true;
    try {
      await loadAI();
      const b0 = trBox(tr);
      let st = b0 ? pt.initBox(video, { x: b0.x0, y: b0.y0 }, { x: b0.x1, y: b0.y1 - (b0.y1 - b0.y0) * 0.04 }, tele.set, fa.hz)
        : pt.init(video, trackerPos(tr, start).x, trackerPos(tr, start).y, tele.set, fa.hz);
      follow.prime(video, st);
      tr.manual = false;
      let tail = opt.to != null ? tr.path.filter((q) => q[0] > until + 0.001) : [];
      tr.path = tr.path.filter((q) => q[0] < start - 0.001);
      clearGaps(tr, start, opt.to != null ? until : Infinity);
      tr.h = +(st.ph / VH).toFixed(4);
      tr.path.push([+start.toFixed(3), +(st.x / VW).toFixed(4), +(st.y / VH).toFixed(4), tr.h]);
      fa.grab(video, tele.set);
      let prev = start;
      let missRun = 0;
      let missFrom = null; // 놓치기 시작한 때
      let amb = false;
      let outRun = 0; // 화면 밖에 나가 있는 장면 수
      const VHc = VH;
      while (!busy.stop && prev < until - 1e-3) {
        // 평소 1/12초, 겹치거나 놓친 동안은 1/24초씩 더 촘촘히
        const nt = Math.min(until, prev + (missRun || amb ? 1 / 24 : 1 / 12));
        await seekTo(nt);
        fa.grab(video, tele.set);
        if (fa.cut) { st.nb = []; st.vx = 0; st.vy = 0; } // 편집 컷: 주변 선수 · 움직임 처음부터
        // 화면 밖으로 나감: 나간 자리(가장자리)에서 기다리며 다시 들어오는지 넓게 찾음
        const out = missRun > 0 && holdAtEdge(st, VW, VHc);
        const r = await follow.step(video, st, tele.set, nt - prev, fa.cut ? { dx: 0, dy: 0 } : fa.cam, out ? 3 : 1);
        amb = r.amb || r.occ; // 헷갈리거나 겹친 동안은 더 촘촘히
        if (r.ok || r.occ || r.amb) {
          if (missFrom != null) closeGap(tr, missFrom, nt);
          missRun = 0; missFrom = null; outRun = 0;
        } else {
          missRun++; if (missFrom == null) missFrom = prev;
          if (out) outRun++;
          markGap(tr, missFrom, nt, out ? 'out' : 'lost');
        }
        tr.lost = missRun > 3;
        tr.h = +(st.ph / VHc).toFixed(4);
        tr.path.push([+nt.toFixed(3), +(st.x / VW).toFixed(4), +(st.y / VHc).toFixed(4), tr.h]);
        prev = nt;
        busy.p = (nt - start) / (until - start);
        drawPanel(); render();
        // 화면 밖이면 10초까지 기다림, 화면 안에서 1.5초 동안 못 찾으면 멈추고 그 구간만 고치게 함
        if (missFrom != null && nt - missFrom >= (outRun ? 10 : 1.5)) {
          busy.stop = true;
          tr.lost = true;
          missRun = 18;
          tail = [];
          toast(outRun ? `${tr.name}이(가) 화면 밖으로 나갔어요 — 다시 보이는 장면에서 [다시 나온 장면에서 잡기]`
            : `${tr.name}을(를) ${fmtT(missFrom)}에서 놓쳤어요 — 선수 칸의 [AI로 다시 잡기] · [직접 찍기]로 그 구간만 고치세요`);
        }
        // 구간 끝까지 왔는데 뒤 기록과 이어지지 않으면(뒤도 틀림) 끝까지 계속
        if (!busy.stop && opt.to != null && prev >= until - 1e-3 && tail.length) {
          const q = tail[0];
          if (Math.hypot(q[1] * VW - st.x, q[2] * VHc - st.y) > st.ph * 0.9) { tail = []; until = full; busy.msg = `${tr.name} 뒤 기록도 이어서 고치는 중 (→ ${fmtT(full)})`; }
        }
      }
      if (tail.length) tr.path.push(...tail);
      tr.aiTo = +Math.max(tr.aiTo ?? -1, tail.length ? Math.max(prev, lastT(tr)) : prev).toFixed(3); // 여기까지는 AI로 계산함 (내보내기 전 자동 계산 판단)
      ok = !busy.stop;
      if (missRun < 18 && !opt.quiet) toast(busy.stop ? '여기까지 따라갔어요 — 이어서 하려면 [AI 정밀 추적]' : 'AI 정밀 추적을 마쳤어요 — ▶ 재생해서 확인하세요');
    } catch (err) {
      // AI 를 못 쓰면: 직접 누른 경우엔 알리고, 재생 전 자동 계산이면 색 추적으로 그냥 재생
      toast(opt.quiet ? 'AI를 쓸 수 없어 색으로만 따라갑니다' : `정밀 추적을 할 수 없어요: ${err.message || err}`);
      ok = !!opt.quiet;
    }
    if (busy?.byUser) userStop = true;
    busy = null;
    trk.delete(tr.id);
    lastProcessed = t();
    drawPanel(); drawSide(); render();
    return ok;
  }

  // ▶ 재생 전에: 곧 따라가야 할 선수들의 움직임을 AI로 먼저 계산 (재생 중 계산보다 정확 — 프레임을 건너뛰지 않음)
  const lastT = (tr) => (tr.path.length ? tr.path[tr.path.length - 1][0] : -1);
  // all: 저장 전 — 지금 위치와 상관없이 모든 선수를 끝까지 (보는 사람은 계산된 길만 봄)
  const pendingTracks = (all) => {
    const now = t();
    return tele.trackers.filter((tr) => !tr.manual
      && tele.items.some((it) => itemPoints(it).some((p) => p && p.tr === tr.id))
      && (all || (lastT(tr) >= now - 0.75 && lastT(tr) <= now + 30))
      && Math.min(trackUntil(tr), lastT(tr) + (all ? 120 : 30)) - lastT(tr) > 0.15);
  };
  // AI로 아직 계산 안 한(재생 중 색으로만 따라간) 선수 — 내보내기 전에 AI로 정확히
  const aiPending = (from, to) => tele.trackers.filter((tr) => !tr.manual && tr.path.length
    && tele.items.some((it) => itemPoints(it).some((p) => p && p.tr === tr.id))
    && Math.min(to, trackUntil(tr)) > Math.max(from, tr.aiTo ?? -1, tr.path[0][0]) + 0.3);
  let userStop = false;
  async function aiBeforeExport(from, to) {
    if (bgRun || bgQ.length) { busy = { msg: 'AI가 선수 따라가기를 마치는 중…', p: 0, stop: false }; drawPanel(); await waitBg(); busy = null; drawPanel(); }
    for (const tr of aiPending(from, to)) {
      const s0 = Math.max(tr.path[0][0], tr.aiTo ?? -1, Math.min(from, lastT(tr)));
      userStop = false;
      await preciseTrack(tr, { from: s0, to: Math.max(s0 + 0.2, Math.min(to + 0.5, trackUntil(tr), dur() || Infinity)), quiet: true }); // 내보낼 구간 끝까지 · 그 뒤 기록은 그대로
      if (userStop) return false; // 직접 멈췄을 때만 그만둠 — 한 선수를 놓쳐도 나머지는 계속, 영상은 끝까지 만듦
    }
    return true;
  }
  async function prepTracks(all = false) {
    if (!edit || !fa.ok) return true;
    const now = t();
    const need = pendingTracks(all);
    if (!need.length) return true;
    for (const tr of need) {
      if (!(await preciseTrack(tr, { from: Math.max(0, lastT(tr)), quiet: true, cap: all ? 120 : 30 }))) return false;
    }
    busy = { msg: '', p: 1 }; // 되돌아가는 동안 화면 처리 막기
    await seekTo(now);
    busy = null; drawPanel();
    lastProcessed = t();
    return true;
  }
  async function playSmart() {
    if (busy) return;
    if (freeze) { freeze = null; video.pause(); render(); return; } // 그림 보여주는 중에 누르면 그 자리에서 멈춤
    if (!video.paused) { video.pause(); return; }
    // 뒤에서 AI가 선수를 따라가는 중이면: 끝날 때까지 기다렸다가 재생 (먼저 재생하면 아직 계산 안 된 곳으로 가서 표시가 어긋남)
    if ((bgRun || bgQ.length) && !waitSkip) { pendingPlay = true; drawWait(); toast('AI가 선수를 따라가는 중이에요 — 끝나면 바로 재생할게요'); return; }
    // ▶ 는 바로 재생 (AI 계산을 저절로 돌리지 않음 — 렉 방지). 정확하게 하려면 [AI 정밀 추적]
    // 지금 장면에 그림이 있으면(방금 그렸으면) 먼저 그 그림을 멈춤 시간만큼 보여주고 재생
    const now = t();
    const hits = tele.items.filter((it) => it.hold > 0 && Math.abs(it.t0 - now) < 0.08);
    if (hits.length) { holdAt(hits, Math.min(...hits.map((it) => it.t0))); return; }
    video.play();
  }

  // 수동 트래킹: 선수 발 밑을 누르면 그 시점에 점이 찍히고 step 초 뒤로 넘어감. 점 사이는 부드럽게 이어짐
  const manHint = () => `수동 · ${man.tr.name}: 선수 발 밑을 누르세요 (누른 채 끌면 위치 다듬기) → 손을 떼면 ${man.step}초 뒤로 · ←/→ ${man.step}초 이동 · Backspace 점 지우기 · Enter 완료`;
  function startManual(tr) {
    if (!tr) return;
    video.pause(); freeze = null; cands = null;
    setTool('select');
    snapshot();
    const wasAuto = !tr.manual;
    man = { tr, step: man?.step || 1, auto: man?.auto ?? true };
    if (wasAuto) { tr.manual = true; thinPath(tr, man.step); trk.delete(tr.id); }
    if (wasAuto && tr.path.length > 2) toast(`AI가 따라간 길을 ${man.step}초 간격 점으로 바꿨어요 — 틀린 곳만 고치면 됩니다`);
    setHint(); drawPanel(); drawMarks(); drawSide(); render();
  }
  function endManual() {
    man = null;
    setHint(); drawPanel(); drawMarks(); drawSide(); render();
  }
  // 이 시점 점 찍기 (가까운 점은 바꿈 — 앞뒤로 오가다 같은 자리에 점이 겹쳐 지그재그가 되지 않게)
  const keyTol = () => Math.min(0.2, man.step * 0.4);
  function setManKey(n) {
    const now = t();
    setKeyAt(man.tr, now, +n.x.toFixed(4), +n.y.toFixed(4), trackerPos(man.tr, now)?.h || man.tr.h, keyTol());
    man.tr.lost = false;
    // 이 선수에 붙은 그림의 표시 시간보다 뒤에 찍으면 표시 시간도 늘림
    tele.items.forEach((it) => { if (it.t1 != null && it.t1 < now && itemPoints(it).some((q) => q && q.tr === man.tr.id)) it.t1 = +(now + 0.05).toFixed(2); });
  }
  function placeKey(n, stay = false) {
    snapshot();
    setManKey(n);
    drawMarks(); drawSide(); render(); drawPanel();
    if (man.auto && !stay) stepMan(1);
  }
  function stepMan(dir) {
    video.pause();
    video.currentTime = Math.max(0, Math.min(video.duration || 0, t() + dir * man.step));
  }
  function delKey() {
    snapshot();
    if (delKeyAt(man.tr, t(), keyTol())) toast('이 시점의 점을 지웠어요'); else toast('이 시점에는 점이 없어요');
    drawMarks(); drawSide(); render(); drawPanel();
  }
  function jumpKey(dir) {
    const now = t();
    const ks = man.tr.path.map((q) => q[0]);
    const k = dir > 0 ? ks.find((x) => x > now + 0.02) : [...ks].reverse().find((x) => x < now - 0.02);
    if (k != null) { video.pause(); video.currentTime = k; }
  }
  // 수동 점들: 앞뒤 3초의 점과 길을 화면에 보여줌
  function drawKeys(tr, w, h) {
    const now = t();
    const ks = tr.path.filter((q) => Math.abs(q[0] - now) <= 3);
    if (!ks.length) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,159,10,.55)'; ctx.lineWidth = Math.max(1.5, w / 700); ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let s2 = Math.max(tr.path[0][0], now - 3); s2 <= Math.min(tr.path[tr.path.length - 1][0], now + 3); s2 += 0.05) {
      const q = trackerPos(tr, s2); if (!q) continue;
      if (s2 === Math.max(tr.path[0][0], now - 3)) ctx.moveTo(q.x * w, q.y * h); else ctx.lineTo(q.x * w, q.y * h);
    }
    ctx.stroke(); ctx.setLineDash([]);
    for (const q of ks) {
      const cur = Math.abs(q[0] - now) < 0.03;
      ctx.fillStyle = cur ? '#ff9f0a' : 'rgba(255,159,10,.6)';
      const dpr = w / canvas.clientWidth;
      ctx.beginPath(); ctx.arc(q[1] * w, q[2] * h, cur ? Math.max(9 * dpr, w / 120) : Math.max(6 * dpr, w / 200), 0, Math.PI * 2); ctx.fill();
      if (cur) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    ctx.restore();
  }

  // 재생바 아래 패널: 진행률 / 후보 고르기 / 수동 도구
  function drawPanel() {
    const box = el.querySelector('[data-aipanel]');
    if (!box) return;
    if (busy) {
      box.hidden = false;
      box.innerHTML = `<div class="ai-row"><b>${esc(busy.msg)}</b><span>${Math.round(busy.p * 100)}%</span>${busy.stop !== undefined ? '<button class="btn ghost sm" data-aistop>멈추기 (Esc)</button>' : ''}</div>
        <div class="st-prog"><i style="width:${Math.round(busy.p * 100)}%"></i></div>`;
      box.querySelector('[data-aistop]')?.addEventListener('click', () => { busy.stop = true; busy.byUser = true; });
      return;
    }
    if (cands?.multi) {
      box.hidden = false;
      const n = cands.picked.length;
      box.innerHTML = `<div class="ai-row"><b>여러 선수 한 번에</b><small>${cands.boxes.length ? `AI가 찾은 선수 ${cands.boxes.length}명 — 이을 순서대로 누르세요${n ? ` · ${n}명 고름` : ''}` : 'AI가 이 장면에서 선수를 못 찾았어요'}</small>
        <button class="btn ghost sm" data-mcancel>취소</button><button class="btn sm" data-mdone ${n >= 2 ? '' : 'disabled'}>${n >= 2 ? `${n}명 잇고 따라가기` : '2명부터'}</button></div>`;
      box.querySelector('[data-mcancel]').onclick = () => { cands = null; setHint(); drawPanel(); render(); };
      box.querySelector('[data-mdone]').onclick = () => finishMulti(false);
      return;
    }
    if (tool === 'link' && edit && !draft && fa.ok) {
      box.hidden = false;
      box.innerHTML = `<div class="ai-row"><b>선수 연결</b><small>선수를 하나씩 누르거나, AI로 화면의 선수를 한 번에 찾아 여러 명을 골라요</small><button class="btn sm" data-mfind>AI로 선수 찾기</button></div>`;
      box.querySelector('[data-mfind]').onclick = findMulti;
      return;
    }
    if (cands) {
      box.hidden = false;
      box.innerHTML = `<div class="ai-row"><b>다시 잡기 · ${esc(cands.tr.name)}</b><small>${cands.boxes.length ? `AI가 찾은 선수 ${cands.boxes.length}명 — 맞는 선수를 누르세요` : 'AI가 못 찾았어요 — 네모로 직접 감싸세요'}</small>
        <button class="btn ghost sm" data-ccancel>취소</button></div>`;
      box.querySelector('[data-ccancel]').onclick = () => { cands = null; endFix(); setHint(); drawPanel(); render(); };
      return;
    }
    if (gman) {
      box.hidden = false;
      box.innerHTML = `<div class="ai-row"><b>직접 찍기 · ${esc(gman.tr.name)}</b><small>${fmtT1(gman.a)} → ${fmtT1(gman.b)} 구간 · 선수 발밑을 누르면 ${gman.step}초 뒤로 넘어가요 (${gman.n}점)</small><button class="btn sm" data-gdone>완료</button></div>
        <div class="ai-row man-ctl"><button class="chip" data-gstep="-1">◀ ${gman.step}초</button><button class="chip" data-gstep="1">${gman.step}초 ▶</button>
        <select data-gstepv>${[0.2, 0.5, 1].map((v) => `<option value="${v}" ${v === gman.step ? 'selected' : ''}>${v}초 간격</option>`).join('')}</select></div>`;
      box.querySelector('[data-gdone]').onclick = finishGapHand;
      box.querySelectorAll('[data-gstep]').forEach((b) => (b.onclick = () => seekTo(Math.max(gman.a, Math.min(gman.b, t() + +b.dataset.gstep * gman.step)))));
      box.querySelector('[data-gstepv]').onchange = (e) => { gman.step = +e.target.value; drawPanel(); };
      return;
    }
    if (man) {
      const n = man.tr.path.length;
      box.hidden = false;
      box.innerHTML = `<div class="ai-row"><b>수동 트래킹 · ${esc(man.tr.name)}</b><small>점 ${n}개</small><button class="btn sm" data-mdone>완료</button></div>
        <div class="ai-row man-ctl">
          <button class="chip" data-mjump="-1" title="이전 점">⇤ 점</button>
          <button class="chip" data-mstep="-1">◀ ${man.step}초</button>
          <button class="chip" data-mstep="1">${man.step}초 ▶</button>
          <button class="chip" data-mjump="1" title="다음 점">점 ⇥</button>
          <select data-mstepv title="간격">${[0.2, 0.5, 1, 2].map((v) => `<option value="${v}" ${v === man.step ? 'selected' : ''}>${v}초 간격</option>`).join('')}</select>
          <label class="mini-switch"><input type="checkbox" data-mauto ${man.auto ? 'checked' : ''}> 찍으면 자동으로 넘기기</label>
          <button class="chip" data-mdel>이 시점 점 지우기</button>
        </div>`;
      box.querySelector('[data-mdone]').onclick = endManual;
      box.querySelectorAll('[data-mstep]').forEach((b) => (b.onclick = () => stepMan(+b.dataset.mstep)));
      box.querySelectorAll('[data-mjump]').forEach((b) => (b.onclick = () => jumpKey(+b.dataset.mjump)));
      box.querySelector('[data-mstepv]').onchange = (e) => { man.step = +e.target.value; setHint(); drawPanel(); };
      box.querySelector('[data-mauto]').onchange = (e) => { man.auto = e.target.checked; };
      box.querySelector('[data-mdel]').onclick = delKey;
      return;
    }
    box.hidden = true;
    box.innerHTML = '';
  }
  if (edit && tele.trackers.length) loadAI().then(() => drawSide()).catch(() => drawSide()); // 이미 트래킹이 있으면 AI 미리 준비

  // 화면에서 끈 네모 → 바닥에 깔린 사다리꼴 (잔디 시작선에 가까운 위쪽 변은 원근만큼 좁게)
  function gridQuad(a, b) {
    const x1 = Math.min(a.x, b.x); const x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y); const y2 = Math.max(a.y, b.y);
    const hz = fa.hz ?? 0.3;
    const f = y2 > hz + 0.02 ? Math.min(1, Math.max(0.3, (y1 - hz) / (y2 - hz))) : 0.7;
    const cx = (x1 + x2) / 2;
    const hw = (x2 - x1) / 2;
    const r = (v) => +v.toFixed(4);
    return [{ x: r(cx - hw * f), y: r(y1) }, { x: r(cx + hw * f), y: r(y1) }, { x: r(x2), y: r(y2) }, { x: r(x1), y: r(y2) }];
  }

  // 지금 누른 곳에 잡을 수 있는 것: 도구를 쓰는 중이어도 그림을 누르면 바로 잡힘.
  // 단, 그리기 도구일 때는 선수 네모 안과 넓은 면(그리드 · 도형 안쪽)은 '거기서 새로 그리기'가 우선
  function pickable(n) {
    const drawing = tool !== 'select' && tool !== 'track';
    // 잘라낸 선수(선수 이동) · 지금 고른 그림은 트래킹 네모보다 먼저 잡힘
    if (!drawing) {
      const h0 = hit(n);
      const bound0 = h0 && itemPoints(h0.it).some((q) => q?.tr); // 선수에 붙은 그림은 네모로 움직임
      if (h0 && !bound0 && (h0.it.k === 'move' || h0.it === sel)) return { it: h0.it, h: h0.h };
    }
    const bx = boxAt(n);
    if (bx) return drawing ? null : { box: bx }; // 그리기 도구일 때는 네모(안 · 모서리)를 누르면 그 선수에서 그리기 시작
    const h = hit(n);
    const pt = h && h.h != null ? itemPoints(h.it)[h.h] : null;
    if (drawing) {
      if (h && (pt?.tr || (h.h == null && ['grid', 'poly', 'spot', 'light', 'offside', 'vision', 'angle'].includes(h.it.k)))) return null;
    }
    if (h) {
      const bound = pt?.tr || (h.it.k === 'spot' && h.it.p?.tr);
      if (bound) return { it: h.it, tracker: tele.trackers.find((x) => x.id === bound) };
      return { it: h.it, h: h.h };
    }
    return null;
  }
  function grab(n) {
    const g = pickable(n);
    if (!g) return false;
    snapshot();
    if (g.it) sel = g.it;
    if (g.box) { drag = { box: g.box, start: n, b: { ...g.box.b }, keep: sel, keepStill: sel?.still }; return true; } // 크기 조절 뒤에도 고르던 그림 · '멈추고 표시만' 그대로
    drag = g.tracker ? { tracker: g.tracker } : { it: g.it, h: g.h, start: n, orig: JSON.parse(JSON.stringify(g.it)) };
    return true;
  }

  // ── 포인터 ──
  if (edit) {
    canvas.addEventListener('pointerdown', (e) => {
      const n = toNorm(e);
      canvas.setPointerCapture(e.pointerId);
      if (busy) return;
      if (cands) { pickCand(n); return; }
      if (gman) { gapHandKey(n); return; }
      if (tool === 'pitch') {
        const c = calNow();
        if (!c) return;
        const i = c.q.findIndex((q) => pxDist(q, n) < 24);
        if (i >= 0) { snapshot(); drag = { cal: c, h: i }; return; }
        if (inside(c.q, n)) { snapshot(); drag = { cal: c, h: null, start: n, orig: c.q.map((q) => ({ ...q })) }; }
        return;
      }
      if (man && !draft) {
        const bx = boxAt(n);
        if (!(bx && bx.tr === man.tr && (bx.mode === 'corner' || bx.mode === 'edge'))) {
          // 앞뒤에 보이는 다른 점을 누르면 그 점의 시간으로 가서 그 점을 옮김
          const near = man.tr.path.filter((q) => Math.abs(q[0] - t()) <= 3 && Math.abs(q[0] - t()) > keyTol())
            .map((q) => ({ q, d: pxDist({ x: q[1], y: q[2] }, n) })).filter((o) => o.d < 16).sort((p, q) => p.d - q.d)[0];
          if (near) { video.pause(); video.currentTime = near.q[0]; }
          placeKey(n, true); drag = { manKey: true, keep: !!near }; return;
        } // 누른 채 끌면 위치 다듬기, 떼면 다음으로 (모서리는 키 조절)
      }
      if (!draft && grab(n)) { drawSide(); render(); return; }
      if (tool === 'select') { sel = null; drawSide(); render(); return; }
      if (tool === 'track') {
        draft = { k: 'trackbox', a: n, b: n };
        drag = { creating: true };
        render();
        return;
      }
      if (tool === 'move') { // ① 옮길 선수를 네모로 감싸서 직접 자르기
        draft = { k: 'cutbox', a: n, b: n };
        drag = { creating: true };
        render();
        return;
      }
      if (tool === 'vision') {
        draft = newItem('vision', { a: snap(n), b: { x: +n.x.toFixed(4), y: +n.y.toFixed(4) }, spread: visionPref });
        drag = { creating: true, start: n };
        render();
        return;
      }
      if (tool === 'angle') {
        draft = newItem('angle', { a: snap(n), b: { x: n.x, y: n.y }, c: { x: n.x, y: n.y } });
        drag = { creating: true, start: n };
        render();
        return;
      }
      if (tool === 'light') {
        draft = newItem('light', { p: { x: +n.x.toFixed(4), y: +n.y.toFixed(4) }, r: 0.004, dim: 0.68, span: true }); // 고정 스포트라이트도 정한 시간 동안 보이게
        drag = { creating: true, start: n };
        render();
        return;
      }
      if (tool === 'offside') {
        draft = newItem('offside', { p: snap(n), d: { x: 0, y: 1 }, side: 1, dim: 0.5, color: color === PALETTE[0] ? '#ffffff' : color });
        drag = { creating: true, start: n };
        render();
        return;
      }
      if (tool === 'zoom') {
        commit(newItem('zoom', { p: { x: +n.x.toFixed(4), y: +n.y.toFixed(4) }, ...zoomPref }));
        return;
      }
      if (tool === 'text') {
        // 그 자리에 '글자'를 놓고 설정의 글자 칸으로 바로 (쓰는 대로 영상에 보임)
        commit(newItem('text', { p: { x: n.x, y: n.y }, t: '글자' }));
        openSide();
        setTimeout(() => { const inp = el.querySelector('[data-ptext]'); if (inp) { inp.focus(); inp.select(); } }, 0);
        return;
      }
      if (tool === 'arrow' || tool === 'dash' || tool === 'measure') {
        const k = tool === 'measure' ? 'measure' : 'arrow';
        draft = newItem(k, { a: snap(n), b: { x: n.x, y: n.y }, ...(k === 'arrow' ? { style: tool === 'dash' || (tool === 'arrow' && arrowDash) ? 'dash' : 'solid', ...(arrowSz !== 1 ? { asz: arrowSz } : {}), weight: arrowBold ? 'bold' : 'thin', ...(arrowLivePref ? { live: true, hold: 0, t1: +(t() + 1.6 + 1.5).toFixed(2) } : {}) } : {}) });
        drag = { creating: true };
        render();
        return;
      }
      if (tool === 'shape') {
        draft = newItem('poly', { shape, pts: shapePts(n, n, shape) });
        drag = { creating: true, start: n };
        render();
        return;
      }
      if (tool === 'link') {
        // 첫 선수를 다시 누르면 도형으로 닫고 끝 (삼각형 · 사각형 …)
        const p0 = draft?.pts[0];
        if (p0 && draft.pts.length >= 3 && ((p0.tr && snap(n).tr === p0.tr) || Math.hypot(n.x - p0.x, n.y - p0.y) < 0.025)) { draft.closed = true; draft.area = true; commit(draft); return; } // 도형은 안을 색으로 채움
        const pt = trackAt(n);
        if (!draft) draft = newItem('link', { pts: [pt] });
        else draft.pts.push(pt);
        render();
        return;
      }
      if (tool === 'grid') {
        draft = newItem('grid', { q: gridQuad(n, n), cols: 5, rows: 3, wM: 40, hM: 25, t1: null, color: '#ffffff' });
        drag = { creating: true, start: n };
        render();
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const n = toNorm(e);
      if (drag?.cal) {
        const c = drag.cal; const r = (v) => +v.toFixed(4);
        if (drag.h != null) c.q[drag.h] = { x: r(n.x), y: r(n.y) };
        else c.q = drag.orig.map((q) => ({ x: r(q.x + n.x - drag.start.x), y: r(q.y + n.y - drag.start.y) }));
        render(); return;
      }
      if (tool === 'pitch' && !drag) { const c = calNow(); canvas.style.cursor = c && c.q.some((q) => pxDist(q, n) < 24) ? 'grab' : c && inside(c.q, n) ? 'move' : 'default'; return; }
      if (drag?.manKey && man) { setManKey(n); render(); return; }
      if (!drag && !draft) {
        const g = pickable(n);
        const CUR = { l: 'ew-resize', r: 'ew-resize', t: 'ns-resize', b: 'ns-resize' };
        canvas.style.cursor = g?.box ? (g.box.mode === 'move' ? 'move' : g.box.mode === 'edge' ? CUR[g.box.side] : (g.box.i % 2 ? 'nesw-resize' : 'nwse-resize'))
          : g ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
      }
      if (draft && (draft.k === 'arrow' || draft.k === 'measure' || draft.k === 'trackbox' || draft.k === 'cutbox' || draft.k === 'move') && drag?.creating) { draft.b = { x: +n.x.toFixed(4), y: +n.y.toFixed(4) }; render(); return; }
      if (draft && draft.k === 'grid' && drag?.creating) { draft.q = gridQuad(drag.start, n); render(); return; }
      if (draft && draft.k === 'vision' && drag?.creating) { draft.b = { x: +n.x.toFixed(4), y: +n.y.toFixed(4) }; render(); return; }
      if (draft && draft.k === 'angle' && drag?.creating) {
        // 두 번째 선은 첫 선에서 35° 돌린 자리에 (놓은 뒤 끌어서 맞춤)
        const a = resolve(draft.a); const dx = (n.x - a.x) * W(); const dy = (n.y - a.y) * H(); const r = 35 * Math.PI / 180;
        draft.b = { x: +n.x.toFixed(4), y: +n.y.toFixed(4) };
        draft.c = { x: +(a.x + (dx * Math.cos(r) - dy * Math.sin(r)) / W()).toFixed(4), y: +(a.y + (dx * Math.sin(r) + dy * Math.cos(r)) / H()).toFixed(4) };
        render(); return;
      }
      if (draft && draft.k === 'light' && drag?.creating) { draft.r = +Math.max(0.004, Math.hypot(n.x - drag.start.x, ((n.y - drag.start.y) * H()) / W())).toFixed(4); render(); return; }
      if (draft && draft.k === 'offside' && drag?.creating) { if (pxDist(drag.start, n) > 8) draft.d = { x: +(n.x - drag.start.x).toFixed(4), y: +(n.y - drag.start.y).toFixed(4) }; render(); return; }
      if (draft && draft.k === 'poly' && draft.shape && drag?.creating) { draft.pts = shapePts(drag.start, n, draft.shape); render(); return; }
      if (!drag) return;
      if (drag.box) {
        const { box: bx, start, b } = drag;
        const nb = { ...bx.b };
        if (bx.mode === 'move') {
          const dx = n.x - start.x; const dy = n.y - start.y;
          Object.assign(nb, { x0: bx.b.x0 + dx, x1: bx.b.x1 + dx, y0: bx.b.y0 + dy, y1: bx.b.y1 + dy });
        } else if (bx.mode === 'edge') {
          if (bx.side === 'l') nb.x0 = n.x; else if (bx.side === 'r') nb.x1 = n.x; else if (bx.side === 't') nb.y0 = n.y; else nb.y1 = n.y;
        } else {
          if (bx.i === 0 || bx.i === 3) nb.x0 = n.x; else nb.x1 = n.x;
          if (bx.i === 0 || bx.i === 1) nb.y0 = n.y; else nb.y1 = n.y;
        }
        Object.assign(b, { x0: Math.min(nb.x0, nb.x1), x1: Math.max(nb.x0, nb.x1), y0: Math.min(nb.y0, nb.y1), y1: Math.max(nb.y0, nb.y1) });
        placeAt(bx.tr, (b.x0 + b.x1) / 2, b.y1 - (b.y1 - b.y0) * 0.04); // 원 · ▼ 이 바로 따라오게
        bx.tr.h = +((b.y1 - b.y0) / 1.08).toFixed(4);
        bx.tr.ar = +(((b.x1 - b.x0) * video.videoWidth) / (bx.tr.h * video.videoHeight)).toFixed(3);
        stampH(bx.tr, t());
        render();
        return;
      }
      if (drag.tracker) {
        placeAt(drag.tracker, n.x, n.y);
        drag.tracker.lost = false;
        render();
        return;
      }
      const { it, h, start, orig } = drag;
      if (h != null) {
        if (it.k === 'offside' && h === 1) { const a = resolve(it.p); it.d = { x: +(n.x - a.x).toFixed(4), y: +(n.y - a.y).toFixed(4) }; } else
        if (it.k === 'arrow' && h === 2) it.c = { x: n.x, y: n.y };
        else {
          const np = { x: +n.x.toFixed(4), y: +n.y.toFixed(4) };
          if (it.k === 'arrow') it[h ? 'b' : 'a'] = np;
          else if (it.k === 'spot') it.p = np;
          else if (it.k === 'measure') it[h ? 'b' : 'a'] = np;
          else if (it.k === 'text' || it.k === 'zoom' || it.k === 'light' || it.k === 'offside') it.p = np;
          else if (it.k === 'vision' || it.k === 'angle') it[['a', 'b', 'c'][h]] = np;
          else if (it.k === 'move') it.b = np;
          else if (it.k === 'poly' && it.shape === 'circle' && it.pts.length === 4) {
            // 동그라미: 끈 점 방향으로 가로/세로 반지름만 바꾸고 항상 타원 유지
            const cx = (it.pts[0].x + it.pts[2].x) / 2; const cy = (it.pts[1].y + it.pts[3].y) / 2;
            let rx = Math.abs(it.pts[0].x - cx); let ry = Math.abs(it.pts[1].y - cy);
            if (h % 2 === 0) rx = Math.max(0.005, Math.abs(np.x - cx)); else ry = Math.max(0.005, Math.abs(np.y - cy));
            const r = (v) => +v.toFixed(4);
            it.pts = [{ x: r(cx + rx), y: r(cy) }, { x: r(cx), y: r(cy + ry) }, { x: r(cx - rx), y: r(cy) }, { x: r(cx), y: r(cy - ry) }];
          } else (it.k === 'grid' ? it.q : it.pts)[h] = np;
        }
      } else {
        const dx = n.x - start.x;
        const dy = n.y - start.y;
        const op = itemPoints(orig);
        itemPoints(it).forEach((p, i) => { if (p && !p.tr && op[i]) { p.x = +(op[i].x + dx).toFixed(4); p.y = +(op[i].y + dy).toFixed(4); } });
      }
      render();
    });

    const up = (e) => {
      if (drag?.cal) { drag = null; drawSide(); render(); return; }
      if (drag?.manKey) { const keep = drag.keep; drag = null; if (man) { drawMarks(); drawPanel(); if (man.auto && !keep) stepMan(1); } return; }
      if (drag?.box) {
        const { box: bx, b } = drag;
        const drag0 = drag;
        drag = null;
        // 수동 모드에서 모서리를 끌지 않고 톡 누르기만 했으면 → 점 찍기
        if (man && bx.tr === man.tr && Math.abs(b.x0 - bx.b.x0) + Math.abs(b.y0 - bx.b.y0) + Math.abs(b.x1 - bx.b.x1) + Math.abs(b.y1 - bx.b.y1) < 0.002) { placeKey(toNorm(e)); return; }
        if (b.x1 - b.x0 > 0.003 && b.y1 - b.y0 > 0.006) applyBox(bx.tr, b);
        const kept = drag0?.keep;
        if (kept && tele.items.includes(kept)) { sel = kept; if (drag0.keepStill) kept.still = true; }
        drawSide(); render();
        return;
      }
      if (draft && draft.k === 'cutbox' && drag?.creating) {
        const n = toNorm(e);
        const a0 = draft.a;
        draft = null; drag = null;
        const VW = video.videoWidth; const VH = video.videoHeight;
        let cut;
        try {
          if (pxDist(a0, n) > 12) {
            cut = cutBox(video, { x0: Math.min(a0.x, n.x) * VW, x1: Math.max(a0.x, n.x) * VW, y0: Math.min(a0.y, n.y) * VH, y1: Math.max(a0.y, n.y) * VH }, tele.set);
          } else { // 톡 누름: 예전처럼 선수 크기를 재서 자동으로 자르기
            let m = null;
            try { m = pt.measure(video, n.x * VW, n.y * VH, tele.set, fa.hz); } catch { /* */ }
            const fx = m ? m.x : n.x * VW; const fy = m ? m.y : n.y * VH; const ph = m ? m.ph : VH * 0.08;
            const c = cutPlayer(video, fx, fy, ph, tele.set);
            cut = { url: c.url, bg: c.bg, wN: c.wN, hN: c.hN, fx, fy, foot: c.footOff };
          }
        } catch { toast('이 영상은 선수를 오려낼 수 없습니다.'); render(); return; }
        const a = { x: +(cut.fx / VW).toFixed(4), y: +(cut.fy / VH).toFixed(4) };
        commit(newItem('move', { a, b: { ...a }, img: cut.url, bg: cut.bg, wN: cut.wN, hN: cut.hN, foot: cut.foot || 0 }));
        setHint('✂ 잘랐어요 — ② 이제 잘린 선수를 끌어서 옮길 곳에 놓으세요 (덜 잘렸으면 오른쪽 ✂ 선수 다듬기)');
        return;
      }
      if (draft && draft.k === 'light' && drag?.creating) {
        const n = toNorm(e);
        const it = draft;
        drag = null;
        if (pxDist(it.p, n) <= 12) { // 톡 누름 → 그 선수를 잡아 따라가며 비춤
          draft = null;
          it.p = trackAt(n);
          delete it.r;
        }
        commit(it);
        return;
      }
      if (draft && draft.k === 'offside' && drag?.creating) { drag = null; commit(draft); return; }
      if (draft && (draft.k === 'vision' || draft.k === 'angle') && drag?.creating) {
        drag = null;
        if (pxDist(resolve(draft.a), draft.b) > 12) commit(draft); else { draft = null; render(); }
        if (tool === 'select' && sel?.k === 'angle') setHint('두 번째 선 끝 점(흰 점)을 끌어서 맞추세요 — 각도가 바로 바뀌어요');
        return;
      }
      if (draft && draft.k === 'trackbox' && drag?.creating && draft.target) {
        // '다시 잡기'에서 AI 후보 대신 직접 감싼 네모
        const n = toNorm(e);
        const a0 = draft.a;
        const tr = draft.target;
        draft = null; drag = null;
        if (pxDist(a0, n) > 12) {
          snapshot();
          const y1 = Math.max(a0.y, n.y); const hh = Math.abs(n.y - a0.y);
          applyBox(tr, { x0: Math.min(a0.x, n.x), x1: Math.max(a0.x, n.x), y0: y1 - hh * 1.04, y1: y1 + hh * 0.04 });
          cands = null; setHint(); drawPanel();
          if (fix?.tr === tr) { afterRecatch(tr); return; }
          toast(`${tr.name}을(를) 다시 잡았어요 — ▶ 재생하거나 [AI 정밀 추적]`);
        }
        drawSide(); render();
        return;
      }
      if (draft && draft.k === 'trackbox' && drag?.creating) {
        const n = toNorm(e);
        const a0 = draft.a;
        const box = pxDist(a0, n) > 12;
        draft = null;
        snapshot();
        const tr = { id: uid(), name: `선수 ${tele.trackers.length + 1}`, path: [] };
        let at = n;
        try {
          const st = box ? pt.initBox(video, a0, n, tele.set, fa.hz) : pt.init(video, n.x, n.y, tele.set, fa.hz);
          trk.set(tr.id, st);
          at = { x: st.x / video.videoWidth, y: st.y / video.videoHeight };
          tr.h = +(st.ph / video.videoHeight).toFixed(4);
          tr.ar = box ? +((Math.abs(n.x - a0.x) * video.videoWidth) / (Math.abs(n.y - a0.y) * video.videoHeight)).toFixed(3) : 0.5;
        } catch { /* 픽셀 접근 불가 */ }
        setTrackerAt(tr, t(), at.x, at.y);
        tele.trackers.push(tr);
        drag = null;
        commit(newItem('spot', { p: { tr: tr.id }, size: 0.025, scale: 1, marker: true }));
        aiSnap(tr, box ? { x0: Math.min(a0.x, n.x), x1: Math.max(a0.x, n.x), y0: Math.min(a0.y, n.y), y1: Math.max(a0.y, n.y) } : null);
        return;
      }
      if (draft && draft.k === 'poly' && draft.shape && drag?.creating) {
        const n = toNorm(e);
        draft.pts = shapePts(drag.start, n, draft.shape);
        const big = pxDist(drag.start, n) > 12;
        drag = null;
        if (big) commit(draft); else { draft = null; render(); }
        return;
      }
      if (draft && draft.k === 'grid' && drag?.creating) {
        const n = toNorm(e);
        draft.q = gridQuad(drag.start, n);
        drag = null;
        if (pxDist(draft.q[0], draft.q[2]) > 30) commit(draft); else { draft = null; render(); }
        return;
      }
      if (draft && drag?.creating) {
        const n = toNorm(e);
        draft.b = snap(n);
        const a = resolve(draft.a);
        if (pxDist(a, n) > 10) {
          if (draft.k === 'arrow') draft.c = { x: (a.x + n.x) / 2, y: (a.y + n.y) / 2 };
          if (draft.k === 'measure') {
            const auto = meters(tele.items, resolve(draft.a), resolve(draft.b));
            const v = prompt('거리를 입력하세요 (m)', auto != null ? auto.toFixed(1) : '');
            if (v !== null && v.trim() !== '' && !isNaN(+v)) draft.m = +(+v).toFixed(1);
          }
          commit(draft);
        } else { draft = null; render(); }
      } else if (drag?.tracker?.manual) {
        render(); drawSide();
      } else if (drag?.tracker) {
        // 위치를 다시 잡으면 그 지점부터 새로 따라가도록 선수 모습을 다시 익힘
        const q = trackerPos(drag.tracker, t());
        try {
          const st = pt.init(video, q.x, q.y, tele.set, fa.horizon());
          trk.set(drag.tracker.id, st);
          drag.tracker.h = +(st.ph / video.videoHeight).toFixed(4);
          setTrackerAt(drag.tracker, t(), st.x / video.videoWidth, st.y / video.videoHeight);
          if (drag.tracker.endAt != null && t() >= drag.tracker.endAt) delete drag.tracker.endAt;
        } catch { trk.delete(drag.tracker.id); }
        render();
        drawSide();
      } else if (drag?.it && drag.h != null && !drag.tracker) {
        // 놓은 자리 근처에 트래킹 선수가 있으면 붙이기
        const { it, h } = drag;
        const n = toNorm(e);
        const s = snap(n);
        if (s.tr && it.k !== 'grid' && !(it.k === 'arrow' && h === 2)) {
          if (it.k === 'arrow') it[h ? 'b' : 'a'] = s;
          else if (it.k === 'spot') it.p = s;
          else if ((it.k === 'light' || it.k === 'offside') && h === 0) it.p = s;
          else if ((it.k === 'vision' || it.k === 'angle') && h === 0) it.a = s;
          else if (it.k === 'link') it.pts[h] = s; // 영역(poly)은 바닥에 고정 — 선수에 붙지 않음
        }
        render();
      }
      drag = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('dblclick', () => {
      if (draft && (draft.k === 'poly' || draft.k === 'link')) {
        draft.pts.pop(); // 더블클릭의 두 번째 클릭으로 들어간 점
        if (draft.pts.length >= 2) commit(draft);
      }
    });
    canvas.addEventListener('pointercancel', up);

    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      if (busy) { if (e.key === 'Escape') { busy.stop = true; busy.byUser = true; } return; }
      if (cands && e.key === 'Escape') { cands = null; endFix(); setHint(); drawPanel(); render(); return; }
      if (gman) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(Math.max(gman.a, t() - gman.step)); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(Math.min(gman.b, t() + gman.step)); return; }
        if (e.key === 'Escape' || e.key === 'Enter') { finishGapHand(); return; }
      }
      if (man) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); stepMan(e.key === 'ArrowRight' ? 1 : -1); return; }
        if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); delKey(); return; }
        if (e.key === 'Escape' || e.key === 'Enter') { endManual(); return; }
      }
      if (e.key === ' ') { e.preventDefault(); playSmart(); }
      if (e.key === 'Enter' && cands?.multi) { finishMulti(false); return; }
      if (e.key === 'Escape' && cands?.multi) { cands = null; setHint(); drawPanel(); render(); return; }
      if (e.key === 'Enter' && draft && (draft.k === 'poly' || draft.k === 'link') && draft.pts.length >= 2) commit(draft);
      if (e.key === 'Escape') { if (draft) { draft = null; render(); } else setTool('select'); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { snapshot(); tele.items = tele.items.filter((x) => x !== sel); sel = null; drawSide(); render(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && history.length) {
        const h = JSON.parse(history.pop());
        tele.items = h.items; tele.trackers = h.trackers; tele.set.cals = h.cals || []; sel = null; drawSide(); render();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D') && sel) { e.preventDefault(); dupItem(sel); return; }
      if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); jumpScene(e.key === 'ArrowRight' ? 1 : -1); return; }
      if (e.key === 'ArrowRight') { video.pause(); video.currentTime = t() + 0.04; }
      if (e.key === 'ArrowLeft') { video.pause(); video.currentTime = Math.max(0, t() - 0.04); }
    };
    document.addEventListener('keydown', onKey);
    state.cleanup.push(() => document.removeEventListener('keydown', onKey));

    // ── 저장 ──
    el.querySelector('[data-save]').onclick = async () => {
      if (busy) return;
      video.pause();
      const pend = fa.ok ? pendingTracks(true) : [];
      if (pend.length && await confirmBox(`아직 끝까지 계산하지 않은 트래킹이 ${pend.length}명 있어요. 저장하기 전에 AI로 끝까지 계산할까요? (시간이 걸려요 · [취소]를 누르면 지금까지 된 것만 저장)`)) {
        if (!(await prepTracks(true))
          && !(await confirmBox('트래킹 계산이 끝나지 않았어요 (멈추거나 선수를 놓친 곳이 있음). 지금까지 된 것만 저장할까요?'))) return;
      }
      const thumb = document.createElement('canvas');
      thumb.width = 480;
      thumb.height = Math.round((480 * canvas.height) / canvas.width) || 270;
      const was = sel; sel = null; render();
      thumb.getContext('2d').drawImage(composite(), 0, 0, thumb.width, thumb.height);
      sel = was; render();
      let thumbUrl = '';
      try { thumbUrl = thumb.toDataURL('image/jpeg', 0.75); } catch { /* CORS */ }
      try {
        await updateDoc(doc(col(), id), {
          tele: JSON.parse(JSON.stringify({ items: tele.items, trackers: tele.trackers.map(({ lost, ...x }) => x), set: tele.set })),
          ...(thumbUrl ? { thumb: thumbUrl } : {}),
          updatedAt: serverTimestamp(),
        });
        dirty = false;
        draftDel(id);
        toast('분석을 저장했습니다.');
        go(`/analysis/${id}`); // 저장하면 보기 화면으로
      } catch (err) { fail(err); }
    };
    el.querySelector('[data-cancel]')?.addEventListener('click', async () => {
      if (dirty && !(await confirmBox('저장하지 않은 수정 내용이 사라집니다. 수정을 취소할까요?'))) return;
      dirty = false;
      draftDel(id);
      go(`/analysis/${id}`);
    });
    el.querySelector('[data-del]').onclick = async () => {
      if (!(await confirmBox('이 분석을 삭제할까요?'))) return;
      try { await deleteDoc(doc(col(), id)); dirty = false; draftDel(id); go('/analysis'); } catch (err) { fail(err); }
    };
    const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    state.cleanup.push(() => window.removeEventListener('beforeunload', beforeUnload));
  }

  el.querySelector('[data-edit]')?.addEventListener('click', () => go(`/analysis/${id}/edit`));
  el.querySelector('[data-share]')?.addEventListener('click', () => shareModal(post));

  // ── 영상으로 내보내기 ──
  // 고화질: 영상을 한 프레임씩 넘기며 그림을 원본 해상도로 그려 H.264(mp4)로 굽기 — 프레임이 빠지지 않고, 멈춤도 정확히
  // (WebCodecs 를 못 쓰는 브라우저는 예전처럼 실시간 녹화)
  const MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.min.js';
  const loadMuxer = () => (window.Mp4Muxer ? Promise.resolve() : new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = MUXER; sc.onload = res; sc.onerror = () => rej(new Error('영상 모듈을 불러오지 못했어요'));
    document.head.appendChild(sc);
  }));
  const canHQ = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
  function exportRange() { // 기본: 첫 그림 2초 전 ~ 마지막 그림 끝 2초 뒤
    const D = dur();
    if (!tele.items.length) return [t(), Math.min(D, t() + 10)];
    const a = Math.min(...tele.items.map((x) => x.t0));
    const b = Math.max(...tele.items.map((x) => (isLive(x) ? (x.t1 ?? D) : x.t0 + 0.5)));
    return [Math.max(0, a - 2), Math.min(D, b + 2)];
  }
  async function pickCodec(w, h, fps, bitrate) {
    // 컴퓨터의 영상 압축 칩(하드웨어)을 먼저 — 몇 배 빠름. 안 되면 소프트웨어로
    for (const hw of ['prefer-hardware', null]) {
      for (const codec of ['avc1.640033', 'avc1.640028', 'avc1.4d0033', 'avc1.42003e', 'avc1.42001f']) {
        const cfg = { codec, width: w, height: h, bitrate, bitrateMode: 'variable', framerate: fps, latencyMode: 'quality', avc: { format: 'avc' }, ...(hw ? { hardwareAcceleration: hw } : {}) };
        try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch { /* 다음 */ }
      }
    }
    return null;
  }
  // ── 빠른 방식: mp4 를 직접 풀기 (mp4box.js 로 꺼내 → 브라우저 하드웨어 디코더) ──
  // 못 쓰는 파일(회전 정보 · 지원 안 되는 코덱 등)이면 'none' 을 돌려주고 재생 방식으로
  const MP4BOX = 'https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js';
  const loadMp4box = () => (window.MP4Box ? Promise.resolve() : new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = MP4BOX; sc.onload = res; sc.onerror = () => rej(new Error('mp4box 를 불러오지 못했어요'));
    document.head.appendChild(sc);
  }));
  async function decodeExport({ from, to, fps, emit, VW, VH }) {
    if (typeof VideoDecoder === 'undefined') return 'none';
    await loadMp4box();
    const blob = post.video.local ? localFiles.get(id) : await (await fetch(vsrc)).blob();
    if (!blob) return 'none';
    const mp4 = window.MP4Box.createFile();
    let info = null; let demuxErr = null;
    mp4.onReady = (i) => { info = i; };
    mp4.onError = (e) => { demuxErr = e; };
    let off = 0; const CH = 8 << 20;
    let seq = false; // 정보를 다 읽은 뒤에는 앞에서부터 차례로 (중간을 건너뛰지 않게)
    const feed = async () => {
      const buf = await blob.slice(off, off + CH).arrayBuffer();
      if (!buf.byteLength) { off = blob.size; return; }
      buf.fileStart = off;
      const next = mp4.appendBuffer(buf);
      // 처음엔 파일 정보(moov)를 찾으러 건너뛰어도 되지만, 프레임을 꺼낼 땐 차례로 읽어야 함
      off = !seq && typeof next === 'number' && next > off ? next : off + buf.byteLength;
    };
    while (!info && !demuxErr && off < blob.size) await feed();
    if (!info || demuxErr) return 'none';
    const tr = info.videoTracks?.[0];
    if (!tr) return 'none';
    // 회전 · 비율이 다른 영상은 화면과 다르게 풀리므로 재생 방식으로
    const ident = !tr.matrix || [65536, 0, 0, 0, 65536, 0].every((v, i) => tr.matrix[i] === v);
    if (!ident || tr.video.width !== VW || tr.video.height !== VH) return 'none';
    const trak = mp4.getTrackById(tr.id);
    // 편집 목록(elst): 재생기는 앞부분을 건너뛰거나(media_time) 늦게 시작(빈 구간) → 같은 시각이 되게 맞춤
    let tShift = 0;
    for (const e of trak.edts?.elst?.entries || []) {
      if (e.media_time === -1) tShift += e.segment_duration / info.timescale; // 빈 구간 = 늦게 시작
      else { tShift -= e.media_time / trak.mdia.mdhd.timescale; break; }
    }
    const entry = trak.mdia.minf.stbl.stsd.entries[0];
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    let description;
    if (box) { const ds = new window.DataStream(undefined, 0, window.DataStream.BIG_ENDIAN); box.write(ds); description = new Uint8Array(ds.buffer, 8); }
    const dcfg = { codec: tr.codec, codedWidth: tr.video.width, codedHeight: tr.video.height, description, hardwareAcceleration: 'prefer-hardware' };
    let sup = false;
    try { sup = (await VideoDecoder.isConfigSupported(dcfg)).supported; } catch { sup = false; }
    if (!sup) { delete dcfg.hardwareAcceleration; try { sup = (await VideoDecoder.isConfigSupported(dcfg)).supported; } catch { sup = false; } }
    if (!sup) return 'none';

    const src = document.createElement('canvas');
    src.width = VW; src.height = VH; src.videoWidth = VW; src.videoHeight = VH;
    const sctx = src.getContext('2d', { willReadFrequently: true });
    const queue = []; let decErr = null;
    const dec = new VideoDecoder({ output: (f) => queue.push(f), error: (e) => { decErr = e; } });
    dec.configure(dcfg);
    let samplesDone = false;
    mp4.onSamples = (tid, _u, samples) => {
      // 소리 등 다른 트랙: 꺼낸 즉시 버림 (안 꺼내면 읽은 원본 조각이 메모리에서 안 지워져 파일 크기만큼 쌓임)
      if (tid !== tr.id) { if (samples.length) mp4.releaseUsedSamples(tid, samples[samples.length - 1].number + 1); return; }
      for (const sm of samples) {
        const ts = (sm.cts * 1e6) / sm.timescale + tShift * 1e6;
        if (ts / 1e6 > to + 1.5) { samplesDone = true; break; }
        dec.decode(new EncodedVideoChunk({ type: sm.is_sync ? 'key' : 'delta', timestamp: ts, duration: (sm.duration * 1e6) / sm.timescale, data: sm.data }));
      }
      if (samples.length) mp4.releaseUsedSamples(tid, samples[samples.length - 1].number + 1);
      if (samplesDone) mp4.stop();
    };
    mp4.setExtractionOptions(tr.id, null, { nbSamples: 30 });
    for (const tk of info.tracks || []) if (tk.id !== tr.id) mp4.setExtractionOptions(tk.id, null, { nbSamples: 200 });
    const sk = mp4.seek(Math.max(0, from - tShift - 0.05), true); // 시작점 바로 앞 키프레임부터
    off = sk.offset;
    seq = true;
    mp4.start();
    // (빠른 모드로 바뀌어도 문구는 그대로)
    drawPanel();
    frameSrc = src;
    const done = new Set();
    let lastM = from - 1e-3; let ticks = 0; let flushed = false; let finished = false;
    const t0w = performance.now();
    const pf = { proc: 0, render: 0, emit: 0, n: 0, held: 0, draw: 0, wait: 0, skip: 0 }; // 프레임당 시간 (느릴 때 원인 찾기용)
    let outT = 0; let prevM = from; // 만든 영상의 시간 (천천히 구간은 영상 시간보다 길게)
    const frameAt = async (m) => {
      vtime = m;
      const hits = tele.items.filter((it) => it.hold > 0 && !done.has(it) && it.t0 > lastM && it.t0 <= m + 1e-3);
      if (hits.length) {
        hits.splice(0, hits.length, ...holdGroup(hits, tele.items).filter((x) => !done.has(x)));
        hits.forEach((it) => done.add(it));
        processFrameInner(true, m);
        const hold = holdLen(hits);
        freeze = { start: 0, items: hits, until: hold * 1000 };
        for (let f = 0; f < Math.round(hold * fps) && !busy.stop; f++) { vclock = (f * 1000) / fps; let q = performance.now(); render(); pf.render += performance.now() - q; q = performance.now(); await emit(); pf.emit += performance.now() - q; pf.held++; }
        freeze = null; vclock = null;
      }
      // 원본이 결과 영상보다 장면이 많으면(40 · 60fps → 30fps) 결과에 안 들어갈 장면은 분석 · 그리기를 건너뜀 (멈춤 장면은 위에서 따로)
      const outNext = outT + Math.max(0, m - prevM) / speedAt((m + prevM) / 2);
      if (!(ticks / fps <= outNext + 1e-4 && m <= to + 1e-4)) { outT = outNext; prevM = m; lastM = m; pf.skip++; return; }
      let q = performance.now();
      processFrameInner(true, m);
      pf.proc += performance.now() - q; q = performance.now();
      render();
      pf.render += performance.now() - q; q = performance.now();
      outT += Math.max(0, m - prevM) / speedAt((m + prevM) / 2); prevM = m;
      while (ticks / fps <= outT + 1e-4 && m <= to + 1e-4) { await emit(); ticks++; }
      pf.emit += performance.now() - q; pf.n++;
      lastM = m;
      busy.p = (m - from) / Math.max(0.01, to - from);
      if (ticks % 10 === 0) drawPanel();
    };
    try {
      lastProcessed = from - 1 / fps;
      while (!finished) {
        if (decErr) throw decErr;
        if (busy.stop) break;
        if (queue.length) {
          const f = queue.shift();
          const m = f.timestamp / 1e6;
          if (m >= from - 1e-3 && m <= to + 1e-3) { const q0 = performance.now(); sctx.drawImage(f, 0, 0, VW, VH); f.close(); pf.draw += performance.now() - q0; await frameAt(m); } else f.close();
          if (m > to) finished = true;
          continue;
        }
        if (samplesDone || off >= blob.size) {
          if (!flushed) { flushed = true; await dec.flush(); continue; }
          break;
        }
        if (dec.decodeQueueSize > 24) { const q0 = performance.now(); await new Promise((r) => setTimeout(r, 1)); pf.wait += performance.now() - q0; continue; }
        { const q0 = performance.now(); await feed(); pf.wait += performance.now() - q0; }
      }
      if (ticks === 0) return 'none';
      console.info('[영상 만들기] 빠른 방식', `${ticks}프레임 · ${((performance.now() - t0w) / 1000).toFixed(1)}초 · 시각 보정 ${tShift.toFixed(3)}초 · 마지막 ${lastM.toFixed(2)}`, JSON.stringify({ held: pf.held, proc: +(pf.proc / Math.max(1, pf.n)).toFixed(1), render: +(pf.render / Math.max(1, pf.n + pf.held)).toFixed(1), emit: +(pf.emit / Math.max(1, pf.n + pf.held)).toFixed(1), draw: +(pf.draw / Math.max(1, pf.n)).toFixed(1), wait: +(pf.wait / Math.max(1, pf.n)).toFixed(1), skip: pf.skip }));
      // 끝까지 못 갔으면(파일을 다 못 읽음 등) 남은 부분은 재생 방식으로 이어서
      if (!busy.stop && lastM < to - 0.2) return { partial: true, lastM, ticks, done, outT };
      return 'done';
    } finally {
      queue.forEach((f) => f.close());
      try { dec.close(); } catch { /* */ }
      try { mp4.stop(); mp4.flush?.(); } catch { /* */ }
      frameSrc = null; vtime = null;
    }
  }
  // 내보낸 영상 오른쪽 아래: 작은 로고 + 이름 (흐리게)
  const BRAND_TEXT = 'SSAKA MANAGER';
  let brandMark = null;
  const loadBrand = () => new Promise((r) => { if (brandMark) { r(); return; } const i = new Image(); i.onload = () => { brandMark = i; r(); }; i.onerror = () => r(); i.src = 'icons/logo-mark.png'; });
  function drawBrand(c, W, H) {
    const lh = Math.round(H * 0.026); const pad = Math.round(H * 0.024);
    c.save();
    c.font = `900 ${Math.round(lh * 0.62)}px Pretendard Variable, Pretendard, sans-serif`;
    try { c.letterSpacing = `${Math.round(lh * 0.12)}px`; } catch { /* */ }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    const tw = c.measureText(BRAND_TEXT).width;
    const cy = H - pad - lh / 2;
    c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = lh * 0.35;
    c.globalAlpha = 0.72; c.fillStyle = '#ffffff';
    c.fillText(BRAND_TEXT, W - pad, cy);
    if (brandMark) { const mw = lh * (brandMark.width / brandMark.height); c.drawImage(brandMark, W - pad - tw - lh * 0.4 - mw, cy - lh / 2, mw, lh); }
    c.restore();
  }
  async function exportHQ({ from, to, maxH, fps, fileHandle = null }) {
    await loadMuxer();
    await loadBrand();
    const VW = video.videoWidth; const VH = video.videoHeight;
    const k = Math.min(1, maxH / VH);
    const outW = Math.round((VW * k) / 2) * 2; const outH = Math.round((VH * k) / 2) * 2; // H.264 는 짝수 크기
    const bitrate = Math.min(80e6, Math.round(outW * outH * fps * 0.45)); // 1080p30 ≈ 28Mbps (잔디 결이 뭉개지지 않게)
    const cfg = await pickCodec(outW, outH, fps, bitrate);
    if (!cfg) throw new Error('이 브라우저는 고화질 mp4 를 만들 수 없어요');
    // 고른 파일에 바로 써 내려감 → 긴 영상도 메모리가 쌓이지 않음 (못 고르는 브라우저는 메모리에 모았다가 저장)
    const ws = fileHandle ? await fileHandle.createWritable() : null;
    // 쓰기를 직접 챙김: 파일에 다 써질 때까지 기다린 양(queued)이 많으면 만들기를 잠깐 멈춤 → 메모리가 쌓이지 않음
    let queued = 0; let writeErr = null; let writing = Promise.resolve();
    const fileTarget = ws && new window.Mp4Muxer.StreamTarget({
      chunked: true, chunkSize: 8 << 20,
      onData: (data, position) => {
        const copy = data.slice();
        queued += copy.byteLength;
        writing = writing.then(() => ws.write({ type: 'write', position, data: copy })).then(() => { queued -= copy.byteLength; }, (e) => { writeErr = e; });
      },
    });
    const muxer = new window.Mp4Muxer.Muxer({
      target: ws ? fileTarget : new window.Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: outW, height: outH, frameRate: fps },
      fastStart: ws ? false : 'in-memory',
    });
    let closed = false;
    let encErr = null;
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
    enc.configure(cfg);
    // 그림을 원본 해상도로 그리도록 캔버스를 키움 (화면에 보이는 크기는 그대로)
    const was = sel; sel = null;
    recording = { hq: true, stop() {} };
    canvas.width = ground.width = outW; canvas.height = ground.height = outH;
    comp.width = outW; comp.height = outH;
    const us = 1e6 / fps;
    let n = 0;
    const emit = async () => {
      cctx.imageSmoothingQuality = 'high';
      cctx.drawImage(SRC(), 0, 0, outW, outH);
      cctx.drawImage(canvas, 0, 0);
      drawBrand(cctx, outW, outH);
      const vf = new VideoFrame(comp, { timestamp: Math.round(n * us), duration: Math.round(us) });
      enc.encode(vf, { keyFrame: n % (fps * 2) === 0 });
      vf.close();
      n++;
      while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      while (queued > (48 << 20) && !writeErr) await new Promise((r) => setTimeout(r, 5)); // 파일 쓰기가 밀리면 기다림
      if (writeErr) throw writeErr;
    };
    busy = { msg: `고화질 영상 만드는 중 (${outW}×${outH} · ${fps}fps) — ${fmtT(from)} → ${fmtT(to)}`, p: 0, stop: false };
    drawPanel();
    freeze = null; video.pause();
    const muted0 = video.muted; const rate0 = video.playbackRate;
    let watchdog = null;
    let onVis = null;
    try {
      // 1순위: 영상 파일을 직접 풀어서(디코딩) 프레임을 바로 꺼내 씀 — 재생을 기다리지 않아 몇 배 빠름
      let fast = 'none';
      try { fast = await decodeExport({ from, to, fps, emit, VW, VH, onFail: () => n === 0 }); } catch (e) { if (n > 0) throw e; console.info('[영상 만들기] 빠른 방식 실패 → 재생 방식', e?.message || e); fast = 'none'; }
      const cont = fast && fast.partial ? fast : null; // 빠른 방식이 중간까지 한 경우 거기서 이어감
      if (cont) console.info('[영상 만들기] 빠른 방식이 중간에 끝나서 재생 방식으로 이어감', cont.lastM.toFixed(2));
      if (fast === 'none' || cont) {
      await seekTo(cont ? cont.lastM + 0.001 : from);
      lastProcessed = t(); prevPlayT = from;
      // 탐색(건너뛰기)을 쓰지 않음: 실제로 재생하면서 새 프레임이 나올 때마다 잠깐 멈추고 그려서 굽기
      // → 긴 영상 · 무거운 파일에서도 영상이 멈추지 않음 (예전엔 탐색이 밀리면 화면이 멈춘 채 그림만 나왔음)
      // 다음 프레임을 기다리는 시간이 대부분이라 빠르게 넘김 (프레임마다 멈추므로 빠뜨리진 않음). 밀리면 자동으로 느리게
      let rateNow = 4;
      video.muted = true; video.playbackRate = rateNow;
      const done = cont ? cont.done : new Set();
      let lastM = cont ? cont.lastM : from - 1e-3;
      let ticks = cont ? cont.ticks : 0; // 영상 시간 기준으로 낸 프레임 수 (멈춤 프레임 제외)
      let outT2 = cont ? cont.outT : 0; let prevM2 = cont ? cont.lastM : from; // 만든 영상의 시간 (천천히 구간은 더 길게)
      let lastCb = performance.now();
      let lastFrameAt = cont ? cont.lastM : from;
      let fixes = 0;
      const prf = { wait: 0, proc: 0, render: 0, emit: 0, n: 0, playAt: performance.now() };
      await new Promise((resolve, reject) => {
        let finished = false;
        const finish = (err) => { if (finished) return; finished = true; clearInterval(watchdog); video.pause(); if (err) reject(err); else resolve(); };
        let srcStep = 1 / 24; // 원본 프레임 간격 (지나가며 추정)
        let retry = 0;
        const resume = async () => {
          if (finished) return;
          if (document.hidden) { waiting = true; busy.msg = busy.msg.replace(/^(⏸ 다른 창에 있어서 잠깐 멈춤 — )?/, '⏸ 다른 창에 있어서 잠깐 멈춤 — '); drawPanel(); return; } // 다른 창이면 돌아올 때까지 기다림
          prf.playAt = performance.now();
          video.requestVideoFrameCallback(onCb);
          // 버퍼링 중엔 '재생'과 '잠깐 멈춤'이 겹쳐 재생 요청이 취소될 수 있음 → 오류로 보지 않음 (안 넘어가면 감시가 다시 재생)
          video.play().catch(() => {});
        };
        let waiting = false;
        onVis = () => { if (!document.hidden && waiting && !finished) { waiting = false; busy.msg = busy.msg.replace('⏸ 다른 창에 있어서 잠깐 멈춤 — ', ''); lastCb = performance.now(); resume().catch(finish); } };
        document.addEventListener('visibilitychange', onVis);
        const onCb = async (_now, md) => {
          if (finished) return;
          video.pause(); // 그리는 동안 영상은 그 프레임에 멈춰 둠 (프레임이 빠지지 않게)
          lastCb = performance.now();
          const m = md?.mediaTime ?? video.currentTime;
          try {
            const step = m - lastM;
            if (step > 1e-4 && step < srcStep && lastM >= from) srcStep = step;
            // 영상이 몇 프레임을 건너뛰었으면 되돌아가서 그 프레임부터 다시 (같은 장면으로 채우지 않음)
            if (lastM >= from && step > Math.max(3 / fps, srcStep * 2.5) && retry < 3) {
              retry++; fixes++;
              if (rateNow > 1) { rateNow = Math.max(1, rateNow / 2); video.playbackRate = rateNow; } // 컴퓨터가 못 따라가면 속도 낮춤
              await seekTo(lastM + srcStep * 0.5);
              await resume();
              return;
            }
            retry = 0;
            // 이 사이에 나타나는 그림 → 그 장면에서 멈춤 시간만큼 같은 장면 반복 (그림이 그려지는 효과 포함)
            const hits = tele.items.filter((it) => it.hold > 0 && !done.has(it) && it.t0 > lastM && it.t0 <= m + 1e-3);
            if (hits.length) {
              hits.splice(0, hits.length, ...holdGroup(hits, tele.items).filter((x) => !done.has(x)));
              hits.forEach((it) => done.add(it));
              processFrameInner(true, m);
              const hold = holdLen(hits);
              freeze = { start: 0, items: hits, until: hold * 1000 };
              for (let f = 0; f < Math.round(hold * fps) && !busy.stop; f++) { vclock = (f * 1000) / fps; render(); await emit(); }
              freeze = null; vclock = null;
            }
            let q0 = performance.now();
            prf.wait += q0 - prf.playAt;
            processFrameInner(true, m);
            let q1 = performance.now(); prf.proc += q1 - q0;
            render();
            q0 = performance.now(); prf.render += q0 - q1;
            // 영상 시간에 맞춰 프레임 내기 (원본이 30fps 이고 60fps 로 만들면 같은 장면을 두 번)
            outT2 += Math.max(0, m - prevM2) / speedAt((m + prevM2) / 2); prevM2 = m;
            while (ticks / fps <= outT2 + 1e-4 && m <= to + 1e-4) { await emit(); ticks++; }
            prf.emit += performance.now() - q0; prf.n++;
            lastM = m; lastFrameAt = m;
            busy.p = (m - from) / Math.max(0.01, to - from);
            if (ticks % 6 === 0) drawPanel();
            if (m >= to - 1e-3 || busy.stop || encErr || video.ended) { finish(encErr); return; }
            await resume();
          } catch (e) { finish(e); }
        };
        // 다음 프레임이 한참 안 나오면 다시 재생 · 그래도 안 되면 멈춘 곳까지 저장
        watchdog = setInterval(() => {
          if (finished) return;
          const idle = performance.now() - lastCb;
          if (video.ended || lastFrameAt >= to - 0.05) { finish(); return; }
          if (document.hidden || waiting) { lastCb = performance.now(); return; } // 다른 창에 있는 동안은 기다림
          if (idle > 4000 && video.paused) resume().catch(() => {});
          if (idle > 15000) { busy.stop = true; toast(`${fmtT(lastFrameAt)}에서 영상이 더 진행되지 않아 거기까지 저장해요`); finish(); }
        }, 1000);
        video.requestVideoFrameCallback(onCb);
        video.play().catch(() => {});
      });
      console.info('[영상 만들기] 재생 방식 · 건너뛴 프레임 바로잡음', fixes, '· 프레임당 ms', JSON.stringify(Object.fromEntries(['wait', 'proc', 'render', 'emit'].map((k) => [k, +(prf[k] / Math.max(1, prf.n)).toFixed(1)]))));
      }
      await enc.flush();
      if (encErr) throw encErr;
      muxer.finalize();
      if (ws) {
        await writing;
        if (writeErr) throw writeErr;
        await ws.close(); closed = true;
        const f = await fileHandle.getFile();
        toast(`${busy.stop ? '멈춘 곳까지' : '고화질 영상을'} 저장했어요 — ${fileHandle.name} (${Math.round(f.size / 1e6)}MB)`);
      } else {
        const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${post.title || 'analysis'}.mp4`;
        a.click();
        toast(busy.stop ? '멈춘 곳까지 영상으로 저장했어요' : `고화질 영상을 저장했어요 (${Math.round(blob.size / 1e6)}MB)`);
      }
      return true;
    } finally {
      try { enc.close(); } catch { /* */ }
      if (ws && !closed) { try { await ws.abort(); } catch { /* */ } }
      clearInterval(watchdog);
      if (onVis) document.removeEventListener('visibilitychange', onVis);
      video.muted = muted0; video.playbackRate = rate0; video.pause();
      recording = null; freeze = null; vclock = null; vtime = null; frameSrc = null; busy = null; sel = was;
      drawPanel(); fit(); render();
    }
  }
  // 영상 만들기 전 점검: 만들고 나서 틀린 걸 발견하지 않게 — 문제될 장면을 미리 모아 보여줌
  function exportChecks(a, b) {
    const out = [];
    const used = tele.trackers.filter((tr) => tele.items.some((it) => itemPoints(it).some((q) => q && q.tr === tr.id)));
    for (const tr of used) {
      for (const g of gapsOf(tr)) {
        if (g.b < a || g.a > b || g.hide) continue;
        out.push({ sev: g.k === 'lost' ? 'bad' : 'warn', t: g.a, title: g.k === 'lost' ? `${tr.name}을(를) 놓친 구간이 있어요` : `${tr.name}이(가) 화면 밖으로 나가요`, sub: `${fmtT1(g.a)} → ${fmtT1(g.b)} · ${g.k === 'lost' ? '이 동안 표시가 엉뚱한 곳에 그려질 수 있어요' : '이 동안 표시는 숨겨져요'}`, act: 'go' });
      }
    }
    const ids = new Set(tele.trackers.map((x) => x.id));
    tele.items.forEach((it) => { if (itemPoints(it).some((q) => q && q.tr && !ids.has(q.tr))) out.push({ sev: 'bad', t: it.t0, title: `선수가 지워진 ${NAMES[it.k]}이 있어요`, sub: `${fmtT1(it.t0)} · 지운 선수에 붙어 있던 그림이에요`, act: 'del', it }); });
    // 멈춤이 연달아 (1~2.5초 사이) 두 번 — 같은 장면이면 묶기
    const st = scenesOf().filter((g) => g.items.some((x) => x.hold > 0 && !x.live && x.k !== 'slow') && g.t0 >= a - 0.05 && g.t0 <= b);
    for (let i = 1; i < st.length; i++) {
      const d = st[i].t0 - st[i - 1].t0;
      if (d <= 2.5) out.push({ sev: 'warn', t: st[i].t0, title: `${fmtT1(st[i - 1].t0)} · ${fmtT1(st[i].t0)}에서 멈춤이 연달아 두 번 들어가요`, sub: `두 장면이 ${d.toFixed(1)}초 떨어져 있어요 — 같은 장면이면 묶어서 한 번만 멈추게 할 수 있어요`, act: 'merge', g0: st[i - 1], g1: st[i] });
    }
    if (bgRun || bgQ.length) out.push({ sev: 'info', title: 'AI가 아직 선수를 따라가는 중이에요', sub: '만들기를 누르면 다 끝난 뒤에 만들어요' });
    const pend = fa.ok ? aiPending(a, b) : [];
    if (pend.length) out.push({ sev: 'info', title: `AI로 계산 안 된 선수 ${pend.length}명`, sub: '아래 [만들기 전에 AI로 계산]을 켜 두면 자동으로 계산해요' });
    if (!out.length) out.push({ sev: 'ok', title: '문제가 없어요', sub: `그림 ${tele.items.length}개 · 선수 ${used.length}명 확인` });
    return out;
  }
  function exportModal() {
    const [a0, b0] = exportRange();
    const checks = exportChecks(a0, b0);
    const VH = video.videoHeight || 720;
    const opts = [...(VH > 1080 ? [[1080, '1080p (추천 · 빠름)']] : []), [VH, `원본 화질 (${VH}p)${VH > 1080 ? ' · 오래 걸림' : ''}`], ...[1080, 720].filter((h) => h < VH && !(h === 1080 && VH > 1080)).map((h) => [h, `${h}p (파일이 더 작음)`])];
    const m = modal(`<span class="eyebrow">EXPORT</span><h2>영상으로 내보내기</h2>
      <div class="xchk"><b class="xchk-h">만들기 전 점검</b>${checks.map((c, i) => `<div class="xchk-row ${c.sev}"><i></i><div><b>${esc(c.title)}</b><small>${esc(c.sub)}</small></div>${c.act === 'go' ? `<button type="button" class="btn ghost sm" data-xck="${i}">${fmtT1(c.t)} 보기</button>` : c.act === 'del' ? `<button type="button" class="btn ghost sm" data-xck="${i}">지우기</button>` : c.act === 'merge' ? `<button type="button" class="btn ghost sm" data-xck="${i}">한 장면으로 묶기</button>` : ''}</div>`).join('')}</div>
      <p class="muted small">한 프레임씩 그려서 mp4로 만들어요 — 원본 해상도 그대로, 끊김 없이, 멈춤도 정확히 들어가요. 만드는 동안 영상이 천천히 넘어가요 (소리는 꺼져요).</p>
      <div class="grid2">
        <label>시작<input type="text" value="${fmtT1(a0)}" data-xa placeholder="0:00.0"></label>
        <label>끝<input type="text" value="${fmtT1(b0)}" data-xb placeholder="0:00.0"></label>
      </div>
      <div class="row st-btnrow" style="margin:-6px 0 12px"><button type="button" class="chip" data-xnow="a">시작 = 지금 위치</button><button type="button" class="chip" data-xnow="b">끝 = 지금 위치</button><button type="button" class="chip" data-xall>영상 전체</button></div>
      <div class="grid2">
        <label>화질<select data-xq>${opts.map(([h, l]) => `<option value="${h}">${l}</option>`).join('')}</select></label>
        <label>부드러움<select data-xf><option value="30">30fps (보통)</option><option value="60">60fps (더 부드럽게 · 2배 오래 걸림)</option></select></label>
      </div>
      ${fa.ok && aiPending(a0, b0).length ? `<label class="mini-switch"><input type="checkbox" data-xai checked> 만들기 전에 AI로 선수 위치를 정확히 계산 <small class="muted">(${aiPending(a0, b0).length}명 · 추천 — 재생하며 따라간 위치는 카메라가 빨리 돌면 늦어요)</small></label>` : ''}
      <p class="muted small">※ [만들기]를 누르면 <b>저장할 곳</b>을 먼저 골라요 — 만드는 동안 그 파일에 바로 저장돼서 긴 영상도 괜찮아요.<br>※ 만드는 동안 <b>이 창을 띄워 두세요</b> — 다른 창으로 가면 잠깐 멈췄다가 돌아오면 이어서 해요.<br>※ 트래킹이 정확하지 않으면 먼저 [AI 정밀 추적]을 해 두세요 (만들 때는 화면에서 본 그대로 들어가요).<br>※ 소리는 들어가지 않아요.</p>
      <div class="row end"><button class="btn" data-xgo>만들기</button></div>`);
    const toSec = (v) => { const p = String(v).trim().split(':').map(Number); return p.some(isNaN) ? NaN : p.reduce((x, y) => x * 60 + y, 0); };
    m.el.querySelectorAll('[data-xck]').forEach((bt) => (bt.onclick = () => {
      const c = checks[+bt.dataset.xck];
      if (c.act === 'go') { m.close(); freeze = null; video.pause(); video.currentTime = c.t + 0.01; toast('그 장면이에요 — 오른쪽 선수 칸에서 [AI로 다시 잡기] · [직접 찍기]로 고친 뒤 다시 [영상으로 내보내기]'); return; }
      if (c.act === 'del') { snapshot(); tele.items = tele.items.filter((x) => x !== c.it); }
      if (c.act === 'merge') { snapshot(); const d = c.g0.t0 - c.g1.t0; c.g1.items.forEach((x) => { x.t0 = +(x.t0 + d).toFixed(2); if (x.t1 != null) x.t1 = +(x.t1 + d).toFixed(2); }); }
      dirty = true; drawSide(); render(); m.close(); exportModal(); // 고친 뒤 점검을 다시 보여줌
    }));
    m.el.querySelectorAll('[data-xnow]').forEach((b) => (b.onclick = () => { m.el.querySelector(b.dataset.xnow === 'a' ? '[data-xa]' : '[data-xb]').value = fmtT1(t()); }));
    m.el.querySelector('[data-xall]').onclick = () => { m.el.querySelector('[data-xa]').value = fmtT1(0); m.el.querySelector('[data-xb]').value = fmtT1(dur()); };
    m.el.querySelector('[data-xgo]').onclick = async () => {
      const from = toSec(m.el.querySelector('[data-xa]').value); const to = toSec(m.el.querySelector('[data-xb]').value);
      if (!(from >= 0) || !(to > from)) { toast('시작 · 끝 시간을 확인해 주세요 (예: 3:15.0)'); return; }
      const maxH = +m.el.querySelector('[data-xq]').value; const fps = +m.el.querySelector('[data-xf]').value;
      // 저장할 곳을 먼저 고름 → 만드는 동안 그 파일에 바로 씀 (긴 영상도 컴퓨터 메모리가 버팀)
      let fileHandle = null;
      if (window.showSaveFilePicker) {
        try {
          fileHandle = await window.showSaveFilePicker({ suggestedName: `${(post.title || 'analysis').replace(/[\\/:*?"<>|]/g, '_')}.mp4`, types: [{ description: 'MP4 영상', accept: { 'video/mp4': ['.mp4'] } }] });
        } catch (e) { if (e?.name === 'AbortError') return; fileHandle = null; } // 취소하면 그만
      }
      const wantAI = !!m.el.querySelector('[data-xai]')?.checked;
      m.close();
      try {
        if (wantAI && !(await aiBeforeExport(from, Math.min(dur(), to)))) { toast('AI 계산을 멈췄어요 — 다시 [영상으로 내보내기]를 눌러 주세요'); return; }
        await exportHQ({ from, to: Math.min(dur(), to), maxH, fps, fileHandle });
      } catch (err) { toast(`영상을 만들 수 없어요: ${err.message || err}`); }
    };
  }
  el.querySelector('[data-export]').onclick = async () => {
    if (busy || recording) return;
    if (!canHQ() || !video.requestVideoFrameCallback) { toast('이 브라우저에서는 영상 만들기를 할 수 없어요 — 크롬이나 엣지에서 해 주세요'); return; }
    if (!(await heavyOk('영상으로 내보내기'))) return;
    exportModal(); // 만들기 전에 AI 계산을 돌리지 않음 (느려지는 원인) — 화면에서 본 트래킹 그대로
  };

  if (edit) setTool('select'); else drawSide();

}

// ───────── 내 컴퓨터 영상 분석: 파일 다시 열기 · 공유 영상 ─────────
const fmtSize = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)}GB` : `${Math.round(b / 1e6)}MB`);
function localGate(el, post, canEdit, mode) {
  if (!canEdit) {
    // 선수 · 보기: 코치가 올린 유튜브 영상
    if (post.shareUrl && youtubeId(post.shareUrl)) return youtubeView(el, { ...post, videoUrl: post.shareUrl });
    el.innerHTML = `<div class="studio"><header class="studio-top"><a href="#/analysis" class="icon-btn">‹</a><div class="st-title"><strong>${esc(post.title)}</strong></div></header>
      ${empty('코치님이 아직 이 분석 영상을 공유하지 않았어요.')}</div>`;
    return;
  }
  el.innerHTML = `<div class="studio"><header class="studio-top"><a href="#/analysis" class="icon-btn">‹</a>
      <div class="st-title"><strong>${esc(post.title)}</strong><small>${esc([post.opponent && `vs ${post.opponent}`, post.date].filter(Boolean).join(' · '))}</small></div>
      <div class="st-actions"><button class="btn ghost sm" data-del>삭제</button></div></header>
    <div class="local-gate">
      <section class="card">
        <h3>영상 파일 열기</h3>
        <p class="muted">이 분석의 영상은 서버에 올리지 않고 <b>코치님 컴퓨터</b>에 있어요. 같은 파일을 열면 분석(트래킹 · 그림)을 이어서 하거나 볼 수 있어요.</p>
        <div class="kv"><span>원본 파일</span><strong>${esc(post.video.name || '')} · ${fmtSize(post.video.size || 0)}</strong></div>
        <label class="btn full file-btn">영상 파일 선택<input type="file" accept="video/*" hidden data-file></label>
      </section>
      <section class="card">
        <h3>선수 공유 영상</h3>
        ${post.shareUrl && youtubeId(post.shareUrl) ? `<div class="video"><iframe src="https://www.youtube.com/embed/${youtubeId(post.shareUrl)}" allowfullscreen></iframe></div><p class="muted small">선수들은 이 영상을 봐요.</p>`
          : '<p class="muted">아직 공유 전이에요. 분석을 마치고 <b>영상으로 내보내기</b> → 유튜브에 올린 뒤 링크를 넣으면 선수들이 볼 수 있어요.</p>'}
        <button class="btn ghost" data-share>${post.shareUrl ? '공유 링크 바꾸기' : '공유 링크 넣기'}</button>
      </section>
    </div></div>`;
  el.querySelector('[data-file]').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (post.video.name && (f.name !== post.video.name || f.size !== post.video.size)
      && !(await confirmBox(`처음 분석한 파일(${post.video.name})과 다른 파일 같아요. 그래도 열까요? 영상이 다르면 그림 위치가 안 맞아요.`))) return;
    localFiles.set(post.id, f);
    studio(el, { id: post.id, mode });
  };
  el.querySelector('[data-share]').onclick = () => shareModal(post);
  el.querySelector('[data-del]').onclick = async () => {
    if (!(await confirmBox('이 분석을 삭제할까요?'))) return;
    try { await deleteDoc(doc(col(), post.id)); go('/analysis'); } catch (err) { fail(err); }
  };
}

function shareModal(post) {
  const m = modal(`<span class="eyebrow">SHARE</span><h2>선수에게 공유하기</h2>
    <ol class="guide-steps">
      <li><b>영상으로 내보내기</b>로 그림이 들어간 영상을 저장해요<small>파일이 다운로드 폴더에 생겨요 (.mp4). 이 파일을 카톡방에 바로 보내도 돼요.</small></li>
      <li>사이트 안에서 보게 하려면 유튜브에 올려요 → 공개 범위는 <b>일부 공개</b><small>링크를 아는 사람만 볼 수 있어요. 검색에 안 나와요.</small></li>
      <li>유튜브 링크를 아래에 붙여 넣고 저장하면 끝!<small>선수들은 분석실에서 이 영상을 봐요.</small></li>
    </ol>
    <form class="stack"><label>유튜브 링크<input name="url" type="url" required placeholder="https://youtu.be/…" value="${esc(post.shareUrl || '')}"></label>
      <div class="row end"><button type="button" class="btn ghost" data-close>나중에</button><button class="btn">저장</button></div></form>`);
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const url = e.target.url.value.trim();
    if (!youtubeId(url)) return toast('유튜브 영상 링크를 넣어 주세요.');
    try { await updateDoc(doc(col(), post.id), { shareUrl: url }); post.shareUrl = url; m.close(); toast('선수들에게 공유됐어요.'); } catch (err) { fail(err); }
  };
}

// ───────── YouTube (재생 + 타임라인) ─────────
function youtubeView(el, post) {
  const vid = youtubeId(post.videoUrl);
  const timeline = (post.timeline || '').split('\n').map((l) => l.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/)).filter(Boolean);
  const toSec = (s) => s.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
  el.innerHTML = `
    <div class="studio">
      <header class="studio-top"><a href="#/analysis" class="icon-btn">‹</a>
        <div class="st-title"><strong>${esc(post.title)}</strong><small>${esc([post.opponent && `vs ${post.opponent}`, post.date].filter(Boolean).join(' · '))}</small></div>
        <div class="st-actions">${isCoach() ? '<button class="btn ghost sm" data-del>삭제</button>' : ''}</div></header>
      <div class="yt-analysis">
        ${vid ? `<div class="video"><iframe src="https://www.youtube.com/embed/${vid}" allowfullscreen allow="autoplay; encrypted-media"></iframe></div>` : `<p><a href="${esc(post.videoUrl)}" target="_blank" rel="noopener">영상 열기 ↗</a></p>`}
        <p class="muted small">YouTube 영상은 트래킹·크로마키를 쓸 수 없습니다. 영상 파일을 올리면 분석 도구를 모두 쓸 수 있어요.</p>
        <h4>타임라인 메모</h4>
        ${timeline.length ? `<ul class="timeline">${timeline.map(([, tm, d]) => `<li><button class="chip" data-t="${toSec(tm)}">${esc(tm)}</button>${esc(d)}</li>`).join('')}</ul>` : ''}
        ${isCoach() ? `<textarea rows="5" data-tl placeholder="한 줄에 하나 — 예) 12:30 왼쪽 측면 전환 타이밍">${esc(post.timeline || '')}</textarea><div class="row end"><button class="btn sm" data-savetl>메모 저장</button></div>` : ''}
      </div>
    </div>`;
  el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { el.querySelector('iframe').src = `https://www.youtube.com/embed/${vid}?start=${b.dataset.t}&autoplay=1`; }));
  el.querySelector('[data-savetl]')?.addEventListener('click', async () => {
    try { await updateDoc(doc(col(), post.id), { timeline: el.querySelector('[data-tl]').value }); toast('저장했습니다.'); youtubeView(el, { ...post, timeline: el.querySelector('[data-tl]').value }); } catch (e) { fail(e); }
  });
  el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmBox('이 분석을 삭제할까요?'))) return;
    try { await deleteDoc(doc(col(), post.id)); go('/analysis'); } catch (e) { fail(e); }
  });
}
