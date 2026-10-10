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
  PALETTE, uid, FrameAnalyzer, PlayerTracker, trackerPos, setTrackerAt, setKeyAt, delKeyAt, thinPath, stampH, GROUND, itemPoints, drawItem, drawMeasureLabel, cutPlayer, meters, label,
} from '../telestrator.js';
import { ai, loadAI, detectAround, scanFrame, pickNear } from '../detector.js';
import { STORAGE_ENABLED } from '../config.js';
import { matchStudio, sampleMatch, computeReport } from './matchAnalysis.js';

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
      <nav class="tabs admin-tabs">${[['match', '📊 경기분석'], ['clip', '✏️ 부분분석']].map(([k, l]) => `<a href="javascript:void 0" class="${k === listTab ? 'active' : ''}" data-ltab="${k}">${l} <small>${all.filter((p) => (k === 'match' ? isMatch(p) : !isMatch(p))).length}</small></a>`).join('')}</nav>
      ${rows.length ? libGrid(rows) : empty(listTab === 'match' ? '아직 경기분석이 없어요. 위에서 영상을 넣고 시작해 보세요.' : '아직 부분분석이 없어요.')}` : ''}`
    : `${pageHead('ANALYSIS ROOM', '분석실')}
    <p class="lead">코치님이 만든 <b>경기분석</b>이에요. 상대 팀의 <b>체크 포인트 → 포메이션 → 리포트</b> 순서로 보면 돼요.</p>
    ${rows.length ? libGrid(rows) : `${empty('아직 올라온 경기분석이 없어요.')}
      <div class="row center"><button class="btn ghost sm" data-sample>📊 경기분석은 이렇게 생겼어요 (예시)</button></div>`}`;
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
  const r = computeReport(p.events || [], 'opp');
  const f = (p.formations || []).find((x) => x.team !== 'us');
  return `<div class="lib-thumb ma-thumb">
    <div class="ma-thumb-top"><span>📊 경기분석 · 기록 ${(p.events || []).length}</span>${f?.name ? `<b>${esc(f.name)}</b>` : ''}</div>
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
      <div class="an-htext"><span class="eyebrow">✏️ 부분분석</span><h3>장면 하나를 그림으로 설명</h3>
        <p>선수를 누르면 <b>AI가 끝까지 따라가고</b>, 화살표 · 영역 · 거리를 그려서 <b>mp4 영상</b>으로 카톡에 보내요.</p>
</div>
    </div>
    <div class="an-hcard">
      <div class="an-hill two"><svg viewBox="0 0 160 90">${pitch}
        ${[[120, 70], [132, 62], [126, 78], [140, 55], [104, 66], [146, 46], [96, 30]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${i % 3 === 2 ? '#ff9f0a' : '#4ea1ff'}" stroke="#fff" stroke-width=".5" class="an-tap" style="animation-delay:${i * 0.45}s"/>`).join('')}
        <text x="80" y="11" class="an-dir">상대 공격 →</text></svg>
        <div class="an-hbars">${[['왼쪽', 18], ['가운데', 27], ['오른쪽', 55]].map(([l, v], i) => `<div><span>${l}</span><i style="--w:${v}%;animation-delay:${i * 0.2}s"></i><b>${v}%</b></div>`).join('')}
          <p class="an-type">“상대는 오른쪽 55% → 우리 왼쪽 수비 대비”</p></div></div>
      <div class="an-htext"><span class="eyebrow">📊 경기분석</span><h3>경기 하나로 상대 팀 리포트</h3>
        <p>영상을 보며 <b>경기장을 탭</b>만 하면 공격 방향 · 위험 지역 · 슈팅 지도 · <b>AI 포메이션</b>까지 자동으로 완성돼요. 선수들은 <b>체크 포인트</b>로 봐요.</p>
        <button class="link-btn small" data-sample>완성된 예시 리포트 보기 ›</button></div>
    </div>
  </section>`;
}
// 영상을 넣으면(또는 + 새 분석): 부분분석 / 경기분석 고르기
function chooseMode(file) {
  const m = modal(`<span class="eyebrow">NEW ANALYSIS</span><h2>어떤 분석을 할까요?</h2>
    ${file ? `<p class="muted">${esc(file.name)} · ${Math.round(file.size / 1e6)}MB — 서버에 올리지 않아요</p>` : ''}
    <div class="an-choose">
      <button data-m="clip"><b>✏️ 부분분석</b><span>장면을 골라 트래킹 · 화살표로 설명하고 mp4로 공유</span></button>
      <button data-m="match"><b>📊 경기분석</b><span>경기를 보며 기록해서 상대 팀 리포트 · 포메이션 만들기</span></button>
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
      ${preset ? `<p class="muted small">영상: <b>${esc(preset.name)}</b></p>` : '<label>경기 영상 <small class="muted">내 컴퓨터에서 열어요 (서버에 안 올림) · 나중에 열어도 돼요</small><input type="file" name="file" accept="video/*"></label>'}
      <label>전반에 영상에서 <b>상대</b>가 공격하는 방향<select name="oppDir"><option value="right">오른쪽 →</option><option value="left">← 왼쪽</option></select></label>
      <div class="row end"><button class="btn">만들기</button></div>
    </form>`);
  const form = m.el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(form);
    const file = preset || form.file?.files[0];
    try {
      const ref = await addDoc(col(), {
        type: 'analysis', mode: 'match', title: (d.title || `vs ${d.opponent} 경기분석`).trim(), opponent: d.opponent.trim(), date: d.date,
        oppDir: d.oppDir, events: [], formations: [], videoUrl: '',
        ...(file ? { video: { local: true, name: file.name, size: file.size, type: file.type } } : {}),
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
      <label>또는 YouTube 링크 <small class="muted">재생 + 타임라인 메모만 가능</small><input type="url" name="videoUrl"></label>
      <div class="upload-bar" hidden><i></i><span></span></div>
      <div class="row end"><button class="btn">만들기</button></div>
    </form>`);
  const form = m.el.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(form);
    const file = form.file.files[0] || preset;
    if (!file && !d.videoUrl) return toast('영상 파일이나 YouTube 링크를 넣어주세요.');
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

// ───────── 스튜디오 ─────────
const TOOLS = [
  ['track', '트래킹', '◎'],
  ['arrow', '화살표', '↗'],
  ['dash', '이동(점선)', '⇢'],
  ['shape', '도형', '⬠'],
  ['link', '연결선', '⟋'],
  ['grid', '그리드', '▦'],
  ['measure', '거리', '↔'],
  ['text', '글자', 'T'],
  ['move', '선수 이동', '⇄'],
];
const HINT = {
  select: '그림을 끌어서 옮기고 점을 끌어 모양을 고치세요 · Delete 삭제 · 왼쪽에서 도구를 고르면 그리기 (한 번 그리면 자동 해제)',
  track: '선수를 누르거나 네모로 감싸세요 → AI가 선수를 정확히 잡고, ▶ 재생하면 따라갑니다 (안 맞으면 오른쪽 [다시 잡기] · [수동])',
  arrow: '끌어서 화살표 · 선택 후 가운데 점을 끌면 곡선',
  dash: '끌어서 이동 경로(점선)',
  shape: '위에서 모양을 고르고 바닥에 끌어서 그리세요 · 꼭짓점을 끌면 모양이 바뀝니다',
  link: '이을 선수들을 차례로 누르세요 (누른 선수는 자동으로 트래킹) → Enter 또는 더블클릭으로 완성',
  grid: '바닥에 깔 범위를 끌어서 정하세요 → 원근에 맞춰 입체 그리드가 깔립니다 (모서리 점으로 조절)',
  measure: '끌어서 거리 재기 (그리드가 있으면 m로 표시)',
  text: '글자를 놓을 곳을 누르세요',
  move: '옮길 선수를 누른 채 원하는 자리로 끌어 놓으세요 (원래 자리는 어둡게 남습니다)',
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
  state.cleanup.push(() => shell?.classList.remove('wide'));

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
    set: { chroma: true, hue: 100, hueManual: false, tol: 40, dur: 5, durEnd: false, hold: 2, autoTrack: true, ...(post.tele?.set || {}) },
  };

  el.innerHTML = `
  <div class="studio">
    <header class="studio-top">
      <a href="#/analysis" class="icon-btn" aria-label="목록">‹</a>
      <div class="st-title"><strong>${esc(post.title)}</strong><small>${esc([post.opponent && `vs ${post.opponent}`, post.date].filter(Boolean).join(' · '))}</small></div>
      <div class="st-actions">
        ${edit ? `<span class="st-mode">수정 중</span><button class="btn ghost sm" data-export>⏺ 영상으로 내보내기</button><button class="btn ghost sm" data-del>삭제</button>
          ${post.tele ? '<button class="btn ghost sm" data-cancel>수정 취소</button>' : ''}<button class="btn sm" data-save>저장</button>`
          : `<button class="btn ghost sm" data-export>⏺ 영상으로 내보내기</button>${canEdit && post.video.local ? `<button class="btn ghost sm" data-share>🔗 ${post.shareUrl ? '공유 링크 바꾸기' : '선수에게 공유'}</button>` : ''}${canEdit ? '<button class="btn sm" data-edit>✎ 수정</button>' : ''}`}
      </div>
    </header>
    <div class="studio-main ${edit ? '' : 'view-only'}">
      ${edit ? `<aside class="st-tools">${TOOLS.map(([k, l, ic]) => `<button class="st-tool" data-tool="${k}" title="${l}"><b>${ic}</b><span>${l}</span></button>`).join('')}
        <div class="st-palette">${PALETTE.map((c, i) => `<button style="--c:${c}" data-color="${c}" class="${i ? '' : 'on'}" aria-label="그림 색"></button>`).join('')}</div></aside>` : ''}
      <div class="st-stage">
        <div class="st-canvas-wrap"><video class="st-video" playsinline preload="auto" crossorigin="anonymous" src="${esc(vsrc)}"></video><canvas class="st-canvas"></canvas><div class="st-hint" data-hint></div>
          <div class="st-shapes" data-shapes hidden>${[['circle', '◯', '동그라미'], ['tri', '△', '세모'], ['rect', '▭', '네모'], ['penta', '⬠', '오각형'], ['hexa', '⬡', '육각형']].map(([k, ic, l], i) => `<button data-shape="${k}" class="${i ? '' : 'on'}" title="${l}">${ic}<small>${l}</small></button>`).join('')}</div><div class="st-rec" hidden>● REC</div></div>
        <div class="st-transport">
          <button class="icon-btn" data-play aria-label="재생">▶</button>
          <button class="icon-btn sm" data-step="-5" title="-5초">«</button>
          <button class="icon-btn sm" data-step="-0.04" title="이전 프레임">‹</button>
          <button class="icon-btn sm" data-step="0.04" title="다음 프레임">›</button>
          <button class="icon-btn sm" data-step="5" title="+5초">»</button>
          <span class="st-time" data-time>0:00 / 0:00</span>
          <div class="st-timeline"><input type="range" min="0" max="1000" value="0" data-seek><div class="st-marks" data-marks></div></div>
          <select data-rate title="재생 속도"><option value="0.25">0.25x</option><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option></select>
        </div>
        <div class="st-aipanel" data-aipanel hidden></div>
      </div>
      <aside class="st-side">
        ${edit ? `
        <section class="st-sec" data-props></section>` : ''}
        <section class="st-sec">
          <h4>그림 <small data-count></small></h4>
          <ul class="st-items" data-items></ul>
        </section>
      </aside>
    </div>
  </div>`;

  const video = el.querySelector('video');
  const canvas = el.querySelector('.st-canvas');
  const ctx = canvas.getContext('2d');
  const ground = document.createElement('canvas');
  const gctx = ground.getContext('2d');
  const fa = new FrameAnalyzer(640);
  const pt = new PlayerTracker();
  const trk = new Map(); // tracker id → 추적 상태 (템플릿 · 속도, 메모리에만)
  let cands = null; // '다시 잡기': AI가 찾은 선수 후보들 { tr, boxes }
  let man = null; // 수동 트래킹 { tr, step, auto }
  let busy = null; // AI 작업 진행 { msg, p, stop }
  let aiLive = false; // 재생 중 AI 보정 1건씩
  let tool = 'select';
  let shape = 'circle';
  let color = PALETTE[0];
  let sel = null;
  let draft = null; // 만드는 중인 그림
  let drag = null;
  let lastProcessed = -1;
  let dirty = false;
  let recording = null;
  let seeking = false;
  let autoHued = false;
  const history = [];
  const snapshot = () => { history.push(JSON.stringify({ items: tele.items, trackers: tele.trackers })); if (history.length > 60) history.shift(); dirty = true; };

  // ── 좌표 ──
  const t = () => video.currentTime || 0;
  const resolve = (p) => {
    if (!p) return { x: 0, y: 0 };
    if (p.tr) {
      const tr = tele.trackers.find((x) => x.id === p.tr);
      return (tr && trackerPos(tr, t())) || { x: 0.5, y: 0.5 };
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
  const isLive = (k) => k === 'spot' || k === 'link';
  const visible = (it) => (isLive(it.k)
    ? t() >= it.t0 - 0.02 && (it.t1 == null || t() <= it.t1 + 0.02) && !cutOff(it)
    : video.paused && Math.abs(t() - it.t0) < 0.06);
  const toNorm = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const pxDist = (a, b) => Math.hypot((a.x - b.x) * canvas.clientWidth, (a.y - b.y) * canvas.clientHeight);
  const snap = (n) => {
    const inBox = boxAt(n);
    if (inBox) return { tr: inBox.tr.id };
    const tr = tele.trackers.find((x) => { const q = trackerPos(x, t()); return q && pxDist(q, n) < 16; });
    return tr ? { tr: tr.id } : { x: +n.x.toFixed(4), y: +n.y.toFixed(4) };
  };

  // ── 크기 ──
  function fit() {
    if (!video.videoWidth) return;
    const wrap = el.querySelector('.st-canvas-wrap');
    const maxW = wrap.clientWidth;
    const maxH = Math.max(240, window.innerHeight - 230);
    let w = maxW;
    let h = (w * video.videoHeight) / video.videoWidth;
    if (h > maxH) { h = maxH; w = (h * video.videoWidth) / video.videoHeight; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    video.style.width = canvas.style.width = `${w}px`;
    video.style.height = canvas.style.height = `${h}px`;
    canvas.style.left = `${(maxW - w) / 2}px`;
    canvas.width = ground.width = Math.round(w * dpr);
    canvas.height = ground.height = Math.round(h * dpr);
    render();
  }
  let fitQueued = false;
  const ro = new ResizeObserver(() => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fit(); }); }); // 크기 변경은 다음 프레임에 한 번만
  ro.observe(el.querySelector('.st-canvas-wrap'));
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
  function processFrame(playing) {
    const now = t();
    if (Math.abs(now - lastProcessed) < 0.001) return;
    const dt = now - lastProcessed;
    const forward = playing && dt > 0 && dt < 0.6;
    lastProcessed = now;
    // 재생 중엔 필요할 때만 분석 (따라갈 선수 · 바닥 그림이 없으면 건너뛰어 영상이 끊기지 않게)
    if (playing && !needAnalysis(now)) return;
    if (!fa.grab(video, tele.set)) return;
    if (!fa.hz || performance.now() - hzAt > 500) { fa.hz = fa.horizon(); hzAt = performance.now(); }
    msctx.clearRect(0, 0, maskSoft.width, maskSoft.height);
    msctx.drawImage(fa.mask, 0, 0, maskSoft.width, maskSoft.height);
    if (!tele.set.hueManual && !autoHued) {
      autoHued = true;
      const h = fa.autoHue();
      if (h != null && Math.abs(h - tele.set.hue) > 3) { tele.set.hue = h; fa.grab(video, tele.set); }
    }
    if (!forward || !tele.set.autoTrack) return;
    // 화면이 크게 바뀌어도(카메라 급회전 · 줌 · 편집 컷) 멈추지 않고 계속 따라감 — 예측 속도만 초기화
    if (fa.cut) for (const st of trk.values()) { st.vx = 0; st.vy = 0; st.miss = Math.max(st.miss, 2); }
    for (const tr of tele.trackers) {
      if (tr.manual) continue; // 수동으로 찍은 선수는 찍은 점대로
      const lastT = tr.path.length ? tr.path[tr.path.length - 1][0] : -1;
      if (lastT > now + 0.001) continue; // 이미 기록된 구간은 기록대로 재생
      if (now - lastT > 0.75) continue; // 영상을 크게 건너뛴 경우 (다시 맞추면 이어감)
      if (now > trackUntil(tr)) continue; // 이 선수에 붙은 그림의 표시 시간이 끝나면 더 따라가지 않음
      try {
        let st = trk.get(tr.id);
        if (!st) { const q = trackerPos(tr, lastT); st = pt.init(video, q.x, q.y, tele.set, fa.horizon()); trk.set(tr.id, st); }
        const r = pt.step(video, st, tele.set, dt, fa.cut ? { dx: 0, dy: 0 } : fa.cam);
        tr.lost = !r.ok;
        tr.h = +(st.ph / video.videoHeight).toFixed(4);
        if (now - lastT >= 1 / 15) tr.path.push([+now.toFixed(3), +r.x.toFixed(4), +r.y.toFixed(4), tr.h]);
        aiCorrect(tr, st);
      } catch { tr.lost = true; }
    }
  }

  // 이 선수를 쓰는 그림들 중 가장 늦게 끝나는 시각
  function trackUntil(tr) {
    let until = -1;
    for (const it of tele.items) {
      if (!itemPoints(it).some((p) => p && p.tr === tr.id)) continue;
      until = Math.max(until, it.t1 == null ? Infinity : it.t1);
    }
    return until < 0 ? Infinity : until;
  }

  // 나타나는 효과 진행도: 강조 멈춤 중이면 멈춘 뒤 흐른 시간, 재생 중이면 영상 시간 기준 (0.7초에 걸쳐)
  // 화살표 · 연결선은 1.6초에 걸쳐 그어지고, 나머지는 0.8초에 걸쳐 나타남 (그림마다 바꿀 수 있음)
  const animSec = (it) => it.anim ?? (it.k === 'arrow' ? 1.6 : 0.8);
  function appear(it) {
    if (it.k === 'link') return 1; // 연결선은 그어지는 과정 없이 바로 보임
    const sec = animSec(it);
    if (freeze && freeze.items.includes(it)) return Math.min(1, (performance.now() - freeze.start) / (sec * 1000));
    if (!video.paused || recording) return Math.min(1, Math.max(0, (t() - it.t0) / sec));
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
  function drawMove(it, w, h) {
    const im = imgOf(it.img);
    if (!im.complete || !im.naturalWidth) return;
    const k = 1 - (1 - Math.min(1, it._prog ?? 1)) ** 3;
    const a = { x: it.a.x * w, y: it.a.y * h };
    const bN = resolve(it.b);
    const bt = { x: bN.x * w, y: bN.y * h };
    const cur = { x: a.x + (bt.x - a.x) * k, y: a.y + (bt.y - a.y) * k };
    const s1 = 1 + (moveScale(it) - 1) * k;
    const iw = it.wN * w;
    const ih = it.hN * h;
    const foot = (it.foot || 0) * h;
    ctx.save();
    // 원래 자리: 같은 선수를 어둡게 덮어서 '떠난 자리' 표시
    ctx.filter = 'brightness(0.32) saturate(0.4)';
    ctx.globalAlpha = 0.9;
    ctx.drawImage(im, a.x - iw / 2, a.y - ih + foot, iw, ih);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    // 이동 경로 (점선)
    const col = it.color || PALETTE[0];
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = Math.max(2, w / 300);
    ctx.setLineDash([w / 120, w / 180]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(cur.x, cur.y); ctx.stroke();
    ctx.setLineDash([]);
    // 새 자리: 발밑 그림자 + 선수
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(cur.x, cur.y, iw * s1 * 0.45, iw * s1 * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(2, w / 400);
    ctx.beginPath(); ctx.ellipse(cur.x, cur.y, iw * s1 * 0.55, iw * s1 * 0.18, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.drawImage(im, cur.x - (iw * s1) / 2, cur.y - (ih - foot) * s1, iw * s1, ih * s1);
    ctx.restore();
  }

  // ── 렌더 ──
  function render() {
    if (!canvas.width) return;
    const w = W();
    const h = H();
    ctx.clearRect(0, 0, w, h); // 영상은 아래 <video> 가 원본 화질로 재생
    const vis = tele.items.filter(visible).map((it) => ({ ...withSpotSize(it), _prog: appear(it), _src: it, _hz: fa.hz }));
    // 바닥 레이어 (크로마키 대상)
    gctx.clearRect(0, 0, w, h);
    vis.filter((it) => GROUND.has(it.k)).forEach((it) => drawItem(gctx, it, P, w, tele.items, resolve));
    // 연결선으로 이은 선수 발밑에도 원
    [...vis.filter((it) => it.k === 'link'), ...(draft?.k === 'link' ? [draft] : [])].forEach((it) => it.pts.forEach((p) => {
      if (!p.tr) return;
      drawItem(gctx, { ...withSpotSize({ k: 'spot', p, scale: 0.9 }), color: it.color, _prog: it._prog ?? 1 }, P, w, tele.items, resolve);
    }));
    if (draft && GROUND.has(draft.k)) drawItem(gctx, { ...withSpotSize(draft), _hz: fa.hz }, P, w, tele.items, resolve);
    if (tele.set.chroma && fa.ok) {
      gctx.save();
      gctx.globalCompositeOperation = 'destination-in';
      gctx.drawImage(maskSoft, 0, 0, w, h);
      gctx.restore();
    }
    ctx.drawImage(ground, 0, 0);
    // 위 레이어 (가려지지 않음)
    [...vis.filter((it) => it.k === 'move'), ...(draft?.k === 'move' ? [{ ...draft, _prog: 1 }] : [])].forEach((it) => drawMove(it, w, h));
    if (draft && draft.k === 'trackbox') {
      const a = P(draft.a); const b = P(draft.b);
      ctx.save(); ctx.strokeStyle = '#4ea1ff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.restore();
    }
    vis.forEach((it) => {
      if (it.k === 'text') drawItem(ctx, it, P, w, tele.items, resolve);
      if (it.k === 'measure') drawMeasureLabel(ctx, it, P, w, tele.items, resolve);
      if (it.k === 'spot') spotTop(it, w);
    });
    if (draft && draft.k === 'measure') drawMeasureLabel(ctx, draft, P, w, tele.items, resolve);
    // 편집 표시
    if (edit && !recording) {
      if (man && boxesShown()) drawKeys(man.tr, w, h);
      if (boxesShown()) shownTrackers().forEach((tr) => {
        const b = drag?.box?.tr === tr ? drag.b : trBox(tr);
        if (!b) return;
        const x0 = b.x0 * w; const y0 = b.y0 * h; const x1 = b.x1 * w; const y1 = b.y1 * h;
        ctx.save();
        const c = tr.manual ? '#ff9f0a' : tr.lost ? '#ff3b30' : '#4ea1ff';
        ctx.strokeStyle = c;
        ctx.lineWidth = Math.max(1.5, w / 600);
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.setLineDash([]);
        ctx.fillStyle = '#fff';
        const s = Math.max(5, w / 220);
        for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { ctx.fillRect(x - s / 2, y - s / 2, s, s); ctx.strokeRect(x - s / 2, y - s / 2, s, s); }
        ctx.restore();
      });
      const target = sel && tele.items.includes(sel) && visible(sel) ? sel : draft && draft.k !== 'trackbox' ? draft : null;
      if (target) {
        itemPoints(target).filter(Boolean).forEach((pt) => {
          const p = P(pt);
          ctx.save();
          ctx.fillStyle = pt.tr ? '#4ea1ff' : '#fff';
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(6, w / 150), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.restore();
        });
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
    if (recording) composite();
  }

  // 트래킹 선수의 실제 키에 맞춰 ▼ 표시 크기 결정 (멀리 있으면 작게, 가까우면 크게)
  function playerPx(it) {
    const tr = it.p?.tr && tele.trackers.find((x) => x.id === it.p.tr);
    const h = tr && (trackerPos(tr, t())?.h || tr.h);
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
    const head = p.y - ph * 1.08;
    const col = it.color || PALETTE[0];
    ctx.save();
    if (it.marker !== false) {
      const s = Math.max(6, r * 0.55);
      const y = head - s * 0.5;
      ctx.fillStyle = col;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(1.5, s * 0.16);
      ctx.beginPath(); ctx.moveTo(p.x - s * 0.7, y - s); ctx.lineTo(p.x + s * 0.7, y - s); ctx.lineTo(p.x, y); ctx.closePath();
      ctx.stroke(); ctx.fill();
    }
    ctx.restore();
    if (it.name) label(ctx, it.name, p.x, head - Math.max(6, r * 0.55) * 2.4, w, col);
  }

  // ── 효과 강조 멈춤: 그림이 나타나는 순간 정해진 초만큼 멈췄다가 다시 재생 ──
  let freeze = null;
  let prevPlayT = null;
  function checkHold() {
    const now = t();
    if (prevPlayT == null || now < prevPlayT) { prevPlayT = now; return false; }
    const hits = tele.items.filter((it) => it.hold > 0 && prevPlayT < it.t0 - 0.001 && it.t0 <= now + 0.02);
    prevPlayT = now;
    if (!hits.length) return false;
    const at = Math.min(...hits.map((it) => it.t0));
    freeze = { start: performance.now(), items: hits, until: performance.now() + Math.max(...hits.map((it) => it.hold)) * 1000 };
    video.pause();
    if (Math.abs(video.currentTime - at) > 0.02) video.currentTime = at; // 그림이 나타나는 정확한 장면에서 멈춤
    const tick = () => {
      if (!freeze) return;
      render();
      if (performance.now() >= freeze.until) { freeze = null; prevPlayT = at + 0.001; video.play(); return; }
      requestAnimationFrame(tick); // 멈춘 동안에도 계속 그려야 녹화 영상에 멈춤이 들어감
    };
    requestAnimationFrame(tick);
    return true;
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
    if (!video.paused && checkHold()) return;
    processFrame(!video.paused);
    render();
    if (!video.paused) schedule();
  };
  const schedule = () => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(onFrame) : requestAnimationFrame(onFrame));
  video.addEventListener('play', () => { el.querySelector('[data-play]').textContent = '❚❚'; if (prevPlayT == null) prevPlayT = t(); schedule(); });
  video.addEventListener('pause', () => {
    el.querySelector('[data-play]').textContent = freeze ? '❚❚' : '▶';
    if (freeze) return; // 강조 멈춤 중에는 녹화 계속
    onFrame();
    if (recording) recording.stop();
  });
  video.addEventListener('seeking', () => { if (!freeze) prevPlayT = null; });
  video.addEventListener('seeked', () => { if (busy) return; processFrame(false); render(); });
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
      });
      video.currentTime = 1e7;
    } else drawMarks();
  });
  video.addEventListener('ended', () => recording?.stop());
  video.addEventListener('error', () => toast('영상을 불러오지 못했습니다.'));
  state.cleanup.push(() => { video.pause(); video.removeAttribute('src'); video.load(); });

  function updateTime() {
    const d = video.duration || 0;
    el.querySelector('[data-time]').textContent = `${fmtT(t())} / ${fmtT(d)}`;
    if (!seeking) el.querySelector('[data-seek]').value = d ? Math.round((t() / d) * 1000) : 0;
  }
  function drawMarks() {
    const d = video.duration || 0;
    el.querySelector('[data-marks]').innerHTML = d ? tele.items.map((it) => `<i style="left:${(it.t0 / d) * 100}%;width:${(((it.t1 ?? d) - it.t0) / d) * 100}%;background:${it.color || PALETTE[0]}"></i>`).join('')
      + (man ? man.tr.path.map((q) => `<b style="left:${(q[0] / d) * 100}%"></b>`).join('') : '') : '';
  }

  const seek = el.querySelector('[data-seek]');
  seek.oninput = () => { seeking = true; video.currentTime = (seek.value / 1000) * (video.duration || 0); };
  seek.onchange = () => { seeking = false; };
  el.querySelector('[data-play]').onclick = () => {
    if (freeze) { freeze = null; video.pause(); return; } // 강조 멈춤 중에 누르면 그 자리에서 정지
    playSmart();
  };
  el.querySelectorAll('[data-step]').forEach((b) => (b.onclick = () => { video.pause(); video.currentTime = Math.max(0, Math.min(video.duration || 0, t() + +b.dataset.step)); }));
  el.querySelector('[data-rate]').onchange = (e) => { video.playbackRate = +e.target.value; };

  // ── 그림 목록 · 속성 ──
  const NAMES = { move: '선수 이동', shape: '도형', arrow: '화살표', spot: '트래킹', poly: '도형', link: '연결선', grid: '그리드', measure: '거리', text: '글자' };
  function drawSide() {
    el.querySelector('[data-count]').textContent = tele.items.length ? `${tele.items.length}개` : '';
    el.querySelector('[data-items]').innerHTML = tele.items.map((it, i) => `
      <li class="${it === sel ? 'on' : ''}" data-i="${i}">
        <span class="dot" style="background:${it.color || PALETTE[0]}"></span>
        <div><b>${NAMES[it.k]}${it.k === 'text' ? ` "${esc(it.t)}"` : ''}${it.name ? ` · ${esc(it.name)}` : ''}</b>
        <small>${fmtT1(it.t0)} · 멈춤 ${it.hold ?? 0}초${isLive(it.k) ? ` · 따라감 ${it.t1 == null ? '끝까지' : `${+(it.t1 - it.t0).toFixed(1)}초`}` : ''}</small></div>
        <button class="link-btn small" data-goto>이동</button>
      </li>`).join('') || '<li class="muted">아직 그림이 없습니다.</li>';
    el.querySelectorAll('[data-items] li[data-i]').forEach((li) => {
      const it = tele.items[+li.dataset.i];
      li.onclick = (e) => {
        if (e.target.closest('[data-goto]')) { video.pause(); video.currentTime = it.t0 + 0.01; }
        if (edit) { sel = it; drawSide(); render(); }
      };
    });
    if (edit) drawProps();
    drawMarks();
  }

  function drawProps() {
    const box = el.querySelector('[data-props]');
    if (!sel) {
      box.innerHTML = `<h4>추적 중인 선수 <small>${tele.trackers.length}명</small></h4>${aiLine()}${tele.trackers.length ? `<ul class="st-items st-trs">${tele.trackers.map((tr) => trRow(tr)).join('')}</ul>` : '<p class="muted small">◎ 트래킹 도구로 선수를 누르거나 네모로 감싸세요.</p>'}`;
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
    box.innerHTML = `<h4>선택한 그림 · ${NAMES[it.k]}</h4>
      <div class="st-colors">${PALETTE.map((c) => `<button style="--c:${c}" data-pcolor="${c}" class="${(it.color || PALETTE[0]) === c ? 'on' : ''}" aria-label="색"></button>`).join('')}</div>
      <div class="st-num"><span>시작</span><b>${fmtT1(it.t0)}</b><button class="chip" data-t0>지금으로</button></div>
      <div class="st-num"><span>멈춰서 보여줄 시간</span><input type="number" min="0" max="30" step="0.5" value="${it.hold ?? 4}" data-phold><i>초</i></div>
      ${isLive(it.k) ? `<div class="st-num"><span>따라가는 시간</span><input type="number" min="0.5" max="600" step="0.5" value="${it.t1 == null ? '' : +(it.t1 - it.t0).toFixed(1)}" placeholder="끝까지" data-pdur ${it.t1 == null ? 'disabled' : ''}><i>초</i>
        <label class="mini-switch"><input type="checkbox" data-pend ${it.t1 == null ? 'checked' : ''}> 끝까지</label></div>
      <p class="muted small">이 장면에서 멈췄다가, 재생되면 따라가는 시간 동안 선수를 따라갑니다.</p>`
      : '<p class="muted small">이 장면에서 영상을 멈추고 보여준 뒤, 재생되면 사라집니다.</p>'}
      ${it.k === 'arrow' ? `<div class="st-num"><span>그어지는 시간</span><input type="number" min="0.2" max="6" step="0.1" value="${animSec(it)}" data-panim><i>초</i></div>` : ''}
      ${it.k === 'spot' ? '<p class="muted small">트래킹은 표시 시간 동안만 선수를 따라갑니다.</p>' : ''}
      ${it.k === 'spot' && it.p?.tr && tele.trackers.find((x) => x.id === it.p.tr) ? `<ul class="st-items st-trs">${trRow(tele.trackers.find((x) => x.id === it.p.tr), false)}</ul>${aiLine()}` : ''}
      ${it.k === 'arrow' ? `<label class="mini-switch"><input type="checkbox" data-pdash ${it.style === 'dash' ? 'checked' : ''}> 점선</label>` : ''}
      ${it.k === 'arrow' || it.k === 'measure' ? `<div class="st-num"><span>거리 표시</span><input type="number" min="0" max="200" step="0.1" value="${it.m ?? ''}" placeholder="${it.k === 'arrow' ? '없음' : '?'}" data-pm><i>m</i></div>` : ''}
      ${it.k === 'spot' ? `<label class="st-range">▼ 표시 크기 <input type="range" min="50" max="220" value="${Math.round((it.scale || 1) * 100)}" data-pscale></label>
        <label class="mini-switch"><input type="checkbox" data-pmarker ${it.marker !== false ? 'checked' : ''}> 머리 위 ▼ 표시</label>
        <label class="st-range">이름표 <input data-pname value="${esc(it.name || '')}" maxlength="12" placeholder="예) 7 손흥민"></label>` : ''}
      ${it.k === 'grid' ? `<div class="grid2 st-gridin"><label>세로칸<input type="number" min="1" max="20" value="${it.cols}" data-pcols></label><label>가로칸<input type="number" min="1" max="20" value="${it.rows}" data-prows></label>
        <label>실제 가로(m)<input type="number" min="1" max="120" value="${it.wM}" data-pwm></label><label>실제 세로(m)<input type="number" min="1" max="90" value="${it.hM}" data-phm></label></div>` : ''}
      ${it.k === 'text' ? `<label class="st-range">글자 <input data-ptext value="${esc(it.t)}" maxlength="30"></label>` : ''}
      <div class="row"><button class="btn ghost sm" data-pdel>그림 삭제</button></div>`;
    bindTr(box);
    const ch = (fn) => () => { snapshot(); fn(); drawSide(); render(); };
    box.querySelectorAll('[data-pcolor]').forEach((b) => (b.onclick = ch(() => { it.color = b.dataset.pcolor; })));
    box.querySelector('[data-t0]').onclick = ch(() => {
      const len = it.t1 == null ? null : it.t1 - it.t0;
      it.t0 = +t().toFixed(2);
      if (len != null) it.t1 = +(it.t0 + len).toFixed(2);
    });
    box.querySelector('[data-pdur]')?.addEventListener('change', ch(() => { const v = +box.querySelector('[data-pdur]').value; if (v > 0) it.t1 = +(it.t0 + v).toFixed(2); }));
    box.querySelector('[data-pend]')?.addEventListener('change', ch(() => { it.t1 = box.querySelector('[data-pend]').checked ? null : +(it.t0 + (+tele.set.dur || 5)).toFixed(2); }));
    box.querySelector('[data-panim]')?.addEventListener('change', ch(() => { it.anim = Math.max(0.2, Math.min(6, +box.querySelector('[data-panim]').value || 1.6)); }));
    box.querySelector('[data-phold]').onchange = ch(() => { const v = box.querySelector('[data-phold]').value; it.hold = Math.max(0, Math.min(30, v === '' ? 4 : +v)); });
    box.querySelector('[data-pdel]').onclick = ch(() => { tele.items = tele.items.filter((x) => x !== it); sel = null; });
    box.querySelector('[data-pdash]')?.addEventListener('change', ch(() => { it.style = it.style === 'dash' ? 'solid' : 'dash'; }));
    box.querySelector('[data-pm]')?.addEventListener('change', ch(() => { const v = box.querySelector('[data-pm]').value; if (v === '') delete it.m; else it.m = +(+v).toFixed(1); }));
    box.querySelector('[data-psize]')?.addEventListener('input', (e) => { it.size = e.target.value / 1000; dirty = true; render(); });
    box.querySelector('[data-pscale]')?.addEventListener('input', (e) => { it.scale = e.target.value / 100; dirty = true; render(); });
    box.querySelector('[data-pmarker]')?.addEventListener('change', ch(() => { it.marker = it.marker === false; }));
    box.querySelector('[data-pname]')?.addEventListener('change', ch(() => { it.name = box.querySelector('[data-pname]').value.trim(); }));
    box.querySelector('[data-ptext]')?.addEventListener('change', ch(() => { it.t = box.querySelector('[data-ptext]').value || it.t; }));
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
    // 같은 도구를 다시 누르면 해제 → 마우스로 바로 옮기기 상태
    el.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(tool === b.dataset.tool ? 'select' : b.dataset.tool)));
  }


  function setTool(k) {
    tool = k;
    if ((k === 'track' || k === 'link') && edit) loadAI().then(() => drawSide()).catch(() => drawSide());
    if (k !== 'select' && !video.paused) { freeze = null; video.pause(); } // 도구를 고르면 영상 멈춤
    draft = null;
    if (k !== 'select') sel = null;
    el.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === k));
    if (!man && !cands) el.querySelector('[data-hint]').textContent = HINT[k] || '';
    el.querySelector('[data-shapes]').hidden = k !== 'shape';
    drawSide();
    render();
  }

  const newItem = (k, extra) => {
    const t0 = +t().toFixed(2);
    const dur = +tele.set.dur || 5;
    // 모든 그림: 나타나는 장면에서 4초 멈춤 (그림마다 수정 가능). 트래킹 · 연결선은 멈춘 뒤 따라가는 시간 동안 따라감
    return { id: uid(), k, color, t0, t1: tele.set.durEnd ? null : +(t0 + dur).toFixed(2), hold: 4, ...extra };
  };
  // 만든 뒤에는 바로 '선택'으로 돌아가서 끌어 옮길 수 있게
  const commit = (it) => { snapshot(); tele.items.push(it); draft = null; sel = it; setTool('select'); sel = it; drawSide(); render(); };

  // ── 히트 테스트 ──
  function hit(n) {
    const vis = tele.items.filter(visible).reverse();
    for (const it of vis) {
      const pts = itemPoints(it);
      const hr = it.k === 'poly' && it.shape ? 11 : 18;
      for (let i = 0; i < pts.length; i++) if (pts[i] && pxDist(resolve(pts[i]), n) < hr) return { it, h: i };
    }
    for (const it of vis) {
      const pts = itemPoints(it).filter(Boolean).map(resolve);
      if (it.k === 'spot' && pxDist(pts[0], n) < Math.max(26, (withSpotSize(it).size || 0) * canvas.clientWidth * 1.2)) return { it, h: null };
      if (it.k === 'text' && pxDist(pts[0], n) < 30) return { it, h: null };
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
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rx = Math.max(0.005, Math.abs(b.x - a.x) / 2);
    const ry = Math.max(rx * (W() / H()) * 0.42, Math.abs(b.y - a.y) / 2);
    const r = (v) => +v.toFixed(4);
    if (kind === 'circle') return [{ x: r(cx + rx), y: r(cy) }, { x: r(cx), y: r(cy + ry) }, { x: r(cx - rx), y: r(cy) }, { x: r(cx), y: r(cy - ry) }];
    if (kind === 'rect') return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: r(cx + u * rx), y: r(cy + v * ry) }));
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
  function boxAt(n) {
    if (!boxesShown()) return null;
    for (const tr of activeTrackers()) {
      const b = trBox(tr);
      if (!b) continue;
      const cs = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
      for (let i = 0; i < 4; i++) if (pxDist({ x: cs[i][0], y: cs[i][1] }, n) < 12) return { tr, mode: 'corner', i, b };
      if (n.x > b.x0 && n.x < b.x1 && n.y > b.y0 && n.y < b.y1) return { tr, mode: 'move', b };
    }
    return null;
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
    if (tr.endAt != null && t() >= tr.endAt) delete tr.endAt;
  }

  // ───────── AI 선수 인식 · 다시 잡기 · 정밀 추적 · 수동 ─────────
  const VWH = () => [video.videoWidth, video.videoHeight];
  const setHint = (m) => { el.querySelector('[data-hint]').textContent = m ?? (man ? manHint() : HINT[tool] || ''); };
  const placeAt = (tr, x, y) => (tr.manual ? setKeyAt(tr, t(), x, y) : setTrackerAt(tr, t(), x, y));
  const shownTrackers = () => { const a = activeTrackers(); if (man && !a.includes(man.tr)) a.push(man.tr); return a; };
  // AI 상자(영상 px, 머리~발) → 트래킹 네모(정규화)
  const aiToBox = (b) => { const [VW, VH] = VWH(); const hh = (b.y1 - b.y0) / VH; return { x0: b.x0 / VW, x1: b.x1 / VW, y0: b.y1 / VH - hh * 1.04, y1: b.y1 / VH + hh * 0.04 }; };
  const aiLine = () => (!fa.ok && video.readyState >= 2 ? '<p class="ai-line warn">이 영상은 픽셀을 읽을 수 없어 AI를 쓸 수 없어요</p>'
    : `<p class="ai-line ${ai.status}">${{ idle: 'AI 선수 인식 · 트래킹을 시작하면 준비돼요', loading: 'AI 준비 중… (처음 한 번 10초 정도)', ready: 'AI 선수 인식 준비됨', failed: 'AI를 불러오지 못해 색으로만 따라가요 (인터넷 확인)' }[ai.status]}</p>`);

  function trRow(tr, withDel = true) {
    const status = tr.manual ? `수동 · 점 ${tr.path.length}개` : tr.lost ? '놓침 — [다시 잡기]를 누르세요' : `AI 추적 · ${fmtT(tr.path[0]?.[0] || 0)}부터`;
    return `<li class="tr-row"><span class="dot" style="background:${tr.manual ? '#ff9f0a' : tr.lost ? '#ff3b30' : '#4ea1ff'}"></span>
      <div><b>${esc(tr.name)}</b><small>${status}</small></div>
      ${withDel ? `<button class="link-btn small" data-trdel="${tr.id}">삭제</button>` : ''}
      <div class="tr-acts">
        <button class="chip" data-tracq="${tr.id}" title="AI가 화면의 선수들을 찾아 보여줘요">다시 잡기</button>
        <button class="chip" data-trprec="${tr.id}" title="멈춘 채로 한 장면씩 AI로 확인하며 따라가요">AI 정밀 추적</button>
        ${tr.manual ? `<button class="chip" data-trman="${tr.id}">점 고치기</button><button class="chip" data-trauto="${tr.id}">AI로 바꾸기</button>`
          : `<button class="chip" data-trman="${tr.id}" title="초 단위로 직접 위치를 찍어요">수동</button>`}
      </div></li>`;
  }
  function bindTr(box) {
    const find = (id) => tele.trackers.find((x) => x.id === id);
    box.querySelectorAll('[data-tracq]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); reacquire(find(b.dataset.tracq)); }));
    box.querySelectorAll('[data-trprec]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); preciseTrack(find(b.dataset.trprec)); }));
    box.querySelectorAll('[data-trman]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); startManual(find(b.dataset.trman)); }));
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
      if (b) { applyBox(tr, aiToBox(b)); toast('AI가 선수를 잡았어요 — ▶ 재생하면 따라갑니다'); }
      else toast('AI가 이 선수를 못 찾았어요 — 네모를 직접 맞추거나 [다시 잡기] · [수동]을 쓰세요');
    } catch { toast('AI를 쓸 수 없어 색으로만 따라갑니다'); } finally { setHint(); drawSide(); render(); }
  }

  // AI 후보 중 이 선수 고르기: 가까움 + 키 + '처음 고른 선수와 유니폼 색이 같은지'까지 봄 (상대 팀 · 옆 선수로 안 넘어가게)
  const bcOf = (a, b) => { let v = 0; for (let i = 0; i < 96; i++) v += Math.sqrt(a[i] * b[i]); return v / 2; };
  function pickBest(boxes, st, maxDist) {
    if (!st.hist0) st.hist0 = Float32Array.from(st.hist);
    let best = null; let bs = -Infinity; let bbc = 0;
    for (const b of boxes) {
      const bw = b.x1 - b.x0; const bh = b.y1 - b.y0;
      const d = Math.hypot((b.x0 + b.x1) / 2 - st.x, b.y1 - st.y) / Math.max(8, st.ph);
      if (d > maxDist) continue;
      let bc = 0.5;
      try {
        const r = pt.read(video, b.x0, b.y0, bw, bh, Math.min(1, 26 / bh));
        const hh = pt.hist(r.d, r.w, 0, 0, r.w, r.h, tele.set).hst;
        bc = Math.max(bcOf(hh, st.hist0), bcOf(hh, st.hist));
      } catch { /* 픽셀 못 읽음 → 위치로만 */ }
      const size = Math.abs(Math.log(Math.max(4, bh) / Math.max(4, st.ph)));
      const sc = bc * 1.4 + b.score * 0.3 - d * 0.5 - size * 0.5;
      if (sc > bs) { bs = sc; best = b; bbc = bc; }
    }
    return best && bbc >= 0.38 ? best : null; // 색이 너무 다르면 다른 선수 → 이번엔 보정 안 함
  }

  // 재생 중 AI 보정: 0.4초마다(놓쳤으면 더 자주) 주변에서 사람을 찾아 위치 · 크기를 바로잡음
  function aiCorrect(tr, st) {
    if (aiLive || ai.status !== 'ready' || !fa.ok) return;
    const now = t();
    if (now - (st.aiAt ?? -9) < (st.miss ? 0.15 : 0.4)) return;
    aiLive = true; st.aiAt = now;
    const qx = st.x; const qy = st.y; const qph = st.ph;
    const [VW, VH] = VWH();
    detectAround(video, qx, qy, qph).then((boxes) => {
      if (!tele.trackers.includes(tr) || tr.manual) return;
      const b = pickBest(boxes, { ...st, x: qx, y: qy, ph: qph, hist: st.hist, hist0: st.hist0 || (st.hist0 = Float32Array.from(st.hist)) }, st.miss ? 2.2 : 0.9);
      if (!b) return;
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

  // 다시 잡기: 화면 전체에서 선수 후보를 찾아 번호로 보여줌 → 맞는 선수를 누르면 그 선수로
  async function reacquire(tr) {
    if (!tr) return;
    if (!fa.ok) { toast('이 영상은 AI로 분석할 수 없어요 — 네모로 직접 감싸세요'); cands = { tr, boxes: [] }; setHint('네모로 선수를 직접 감싸세요 · Esc 취소'); drawPanel(); return; }
    video.pause(); freeze = null;
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
  function pickCand(n) {
    const [VW, VH] = VWH();
    const px = n.x * VW; const py = n.y * VH;
    const pad = 6 * (VW / canvas.clientWidth);
    const hitB = cands.boxes.find((b) => px >= b.x0 - pad && px <= b.x1 + pad && py >= b.y0 - pad && py <= b.y1 + pad);
    if (hitB) {
      snapshot();
      const tr = cands.tr;
      tr.manual = false;
      applyBox(tr, aiToBox(hitB));
      cands = null; setHint(); drawPanel();
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
    cands.boxes.forEach((b, i) => {
      const x0 = (b.x0 / VW) * w; const y0 = (b.y0 / VH) * h; const x1 = (b.x1 / VW) * w; const y1 = (b.y1 / VH) * h;
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
  async function preciseTrack(tr, opt = {}) {
    if (!tr) return false;
    if (!fa.ok) { if (!opt.quiet) toast('이 영상은 AI로 분석할 수 없어요'); return !!opt.quiet; }
    video.pause(); freeze = null; cands = null;
    if (man) endManual();
    const [VW, VH] = VWH();
    busy = { msg: '', p: 0, stop: false };
    if (opt.from != null && Math.abs(t() - opt.from) > 0.01) await seekTo(opt.from);
    const start = t();
    const u = trackUntil(tr);
    const until = Math.min(video.duration || start + 30, Number.isFinite(u) ? u : start + 30, opt.cap ? start + opt.cap : Infinity);
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
      tr.manual = false;
      tr.path = tr.path.filter((q) => q[0] < start - 0.001);
      tr.h = +(st.ph / VH).toFixed(4);
      tr.path.push([+start.toFixed(3), +(st.x / VW).toFixed(4), +(st.y / VH).toFixed(4), tr.h]);
      fa.grab(video, tele.set);
      let prev = start;
      let missRun = 0;
      while (!busy.stop && prev < until - 1e-3) {
        const nt = Math.min(until, prev + 1 / 12);
        await seekTo(nt);
        fa.grab(video, tele.set);
        pt.step(video, st, tele.set, nt - prev, fa.cut ? { dx: 0, dy: 0 } : fa.cam);
        const boxes = await detectAround(video, st.x, st.y, st.ph);
        const b = pickBest(boxes, st, st.miss ? 2.2 : 0.9);
        if (b) {
          st.x = (b.x0 + b.x1) / 2; st.y = b.y1;
          const bh = b.y1 - b.y0;
          if (bh > 6) { st.ph = st.ph * 0.5 + bh * 0.5; st.ph0 = st.ph; }
          st.miss = 0; missRun = 0;
        } else missRun++;
        tr.lost = missRun > 3;
        tr.h = +(st.ph / VH).toFixed(4);
        tr.path.push([+nt.toFixed(3), +(st.x / VW).toFixed(4), +(st.y / VH).toFixed(4), tr.h]);
        prev = nt;
        busy.p = (nt - start) / (until - start);
        drawPanel(); render();
        if (missRun === 18) { // 1.5초 동안 못 찾음 → 멈추고 다시 잡기 권함
          busy.stop = true;
          tr.lost = true;
          toast(`${tr.name}을(를) ${fmtT(nt)}에서 놓쳤어요 — [다시 잡기]로 맞춘 뒤 ▶ 를 누르면 이어서 갑니다`);
        }
      }
      ok = !busy.stop;
      if (missRun < 18 && !opt.quiet) toast(busy.stop ? '여기까지 따라갔어요 — 이어서 하려면 [AI 정밀 추적]' : 'AI 정밀 추적을 마쳤어요 — ▶ 재생해서 확인하세요');
    } catch (err) {
      // AI 를 못 쓰면: 직접 누른 경우엔 알리고, 재생 전 자동 계산이면 색 추적으로 그냥 재생
      toast(opt.quiet ? 'AI를 쓸 수 없어 색으로만 따라갑니다' : `정밀 추적을 할 수 없어요: ${err.message || err}`);
      ok = !!opt.quiet;
    }
    busy = null;
    trk.delete(tr.id);
    lastProcessed = t();
    drawPanel(); drawSide(); render();
    return ok;
  }

  // ▶ 재생 전에: 곧 따라가야 할 선수들의 움직임을 AI로 먼저 계산 (재생 중 계산보다 정확 — 프레임을 건너뛰지 않음)
  const lastT = (tr) => (tr.path.length ? tr.path[tr.path.length - 1][0] : -1);
  // all: 저장 전 — 지금 위치와 상관없이 모든 선수를 끝까지 (보는 사람은 계산된 길만 봄)
  async function prepTracks(all = false) {
    if (!edit || !fa.ok) return true;
    const now = t();
    const need = tele.trackers.filter((tr) => !tr.manual
      && tele.items.some((it) => itemPoints(it).some((p) => p && p.tr === tr.id))
      && (all || (lastT(tr) >= now - 0.75 && lastT(tr) <= now + 30))
      && Math.min(trackUntil(tr), lastT(tr) + (all ? 120 : 30)) - lastT(tr) > 0.15);
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
    if (!video.paused) { video.pause(); return; }
    if (await prepTracks()) video.play();
    else render();
  }

  // 수동 트래킹: 선수 발 밑을 누르면 그 시점에 점이 찍히고 step 초 뒤로 넘어감. 점 사이는 부드럽게 이어짐
  const manHint = () => `수동 · ${man.tr.name}: 선수 발 밑을 누르세요 → 점이 찍히고 ${man.step}초 뒤로 넘어갑니다 · ←/→ ${man.step}초 이동 · Backspace 점 지우기 · Enter 완료`;
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
  function placeKey(n) {
    snapshot();
    setKeyAt(man.tr, t(), n.x, n.y, trackerPos(man.tr, t())?.h || man.tr.h);
    man.tr.lost = false;
    drawMarks(); drawSide(); render(); drawPanel();
    if (man.auto) stepMan(1);
  }
  function stepMan(dir) {
    video.pause();
    video.currentTime = Math.max(0, Math.min(video.duration || 0, t() + dir * man.step));
  }
  function delKey() {
    snapshot();
    if (delKeyAt(man.tr, t(), Math.min(0.25, man.step / 2))) toast('이 시점의 점을 지웠어요'); else toast('이 시점에는 점이 없어요');
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
      ctx.beginPath(); ctx.arc(q[1] * w, q[2] * h, cur ? Math.max(6, w / 160) : Math.max(3.5, w / 300), 0, Math.PI * 2); ctx.fill();
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
      box.querySelector('[data-aistop]')?.addEventListener('click', () => { busy.stop = true; });
      return;
    }
    if (cands) {
      box.hidden = false;
      box.innerHTML = `<div class="ai-row"><b>다시 잡기 · ${esc(cands.tr.name)}</b><small>${cands.boxes.length ? `AI가 찾은 선수 ${cands.boxes.length}명 — 맞는 선수를 누르세요` : 'AI가 못 찾았어요 — 네모로 직접 감싸세요'}</small>
        <button class="btn ghost sm" data-ccancel>취소</button></div>`;
      box.querySelector('[data-ccancel]').onclick = () => { cands = null; setHint(); drawPanel(); render(); };
      return;
    }
    if (man) {
      const n = man.tr.path.length;
      box.hidden = false;
      box.innerHTML = `<div class="ai-row"><b>✋ 수동 트래킹 · ${esc(man.tr.name)}</b><small>점 ${n}개</small><button class="btn sm" data-mdone>완료</button></div>
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
    const bx = boxAt(n);
    if (bx) return drawing ? null : { box: bx }; // 그리기 도구일 때는 네모(안 · 모서리)를 누르면 그 선수에서 그리기 시작
    const h = hit(n);
    const pt = h && h.h != null ? itemPoints(h.it)[h.h] : null;
    if (drawing) {
      if (h && (pt?.tr || (h.h == null && ['grid', 'poly', 'spot'].includes(h.it.k)))) return null;
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
    if (g.box) { drag = { box: g.box, start: n, b: { ...g.box.b } }; return true; }
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
      if (man && !draft) {
        const bx = boxAt(n);
        if (!(bx && bx.tr === man.tr && bx.mode === 'corner')) { placeKey(n); return; } // 모서리는 키 조절, 나머지는 점 찍기
      }
      if (!draft && grab(n)) { drawSide(); render(); return; }
      if (tool === 'select') { sel = null; drawSide(); render(); return; }
      if (tool === 'track') {
        draft = { k: 'trackbox', a: n, b: n };
        drag = { creating: true };
        render();
        return;
      }
      if (tool === 'move') {
        let m = null;
        try { m = pt.measure(video, n.x * video.videoWidth, n.y * video.videoHeight, tele.set, fa.hz); } catch { /* */ }
        const VW = video.videoWidth; const VH = video.videoHeight;
        const fx = m ? m.x : n.x * VW; const fy = m ? m.y : n.y * VH; const ph = m ? m.ph : VH * 0.08;
        let cut = null;
        try { cut = cutPlayer(video, fx, fy, ph, tele.set); } catch { toast('이 영상은 선수를 오려낼 수 없습니다.'); return; }
        const a = { x: +(fx / VW).toFixed(4), y: +(fy / VH).toFixed(4) };
        draft = newItem('move', { a, b: { ...a }, ph: +(ph / VH).toFixed(4), img: cut.url, wN: cut.wN, hN: cut.hN, foot: cut.footOff });
        drag = { creating: true };
        render();
        return;
      }
      if (tool === 'text') {
        const s = prompt('영상에 쓸 글자');
        if (s) commit(newItem('text', { p: { x: n.x, y: n.y }, t: s.slice(0, 30) }));
        return;
      }
      if (tool === 'arrow' || tool === 'dash' || tool === 'measure') {
        const k = tool === 'measure' ? 'measure' : 'arrow';
        draft = newItem(k, { a: snap(n), b: { x: n.x, y: n.y }, ...(k === 'arrow' ? { style: tool === 'dash' ? 'dash' : 'solid' } : {}) });
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
      if (!drag && !draft) {
        canvas.style.cursor = pickable(n) ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
      }
      if (draft && (draft.k === 'arrow' || draft.k === 'measure' || draft.k === 'trackbox' || draft.k === 'move') && drag?.creating) { draft.b = { x: +n.x.toFixed(4), y: +n.y.toFixed(4) }; render(); return; }
      if (draft && draft.k === 'grid' && drag?.creating) { draft.q = gridQuad(drag.start, n); render(); return; }
      if (draft && draft.k === 'poly' && draft.shape && drag?.creating) { draft.pts = shapePts(drag.start, n, draft.shape); render(); return; }
      if (!drag) return;
      if (drag.box) {
        const { box: bx, start, b } = drag;
        const nb = { ...bx.b };
        if (bx.mode === 'move') {
          const dx = n.x - start.x; const dy = n.y - start.y;
          Object.assign(nb, { x0: bx.b.x0 + dx, x1: bx.b.x1 + dx, y0: bx.b.y0 + dy, y1: bx.b.y1 + dy });
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
        if (it.k === 'arrow' && h === 2) it.c = { x: n.x, y: n.y };
        else {
          const np = { x: +n.x.toFixed(4), y: +n.y.toFixed(4) };
          if (it.k === 'arrow') it[h ? 'b' : 'a'] = np;
          else if (it.k === 'spot') it.p = np;
          else if (it.k === 'measure') it[h ? 'b' : 'a'] = np;
          else if (it.k === 'text') it.p = np;
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
      if (drag?.box) {
        const { box: bx, b } = drag;
        drag = null;
        // 수동 모드에서 모서리를 끌지 않고 톡 누르기만 했으면 → 점 찍기
        if (man && bx.tr === man.tr && Math.abs(b.x0 - bx.b.x0) + Math.abs(b.y0 - bx.b.y0) + Math.abs(b.x1 - bx.b.x1) + Math.abs(b.y1 - bx.b.y1) < 0.002) { placeKey(toNorm(e)); return; }
        if (b.x1 - b.x0 > 0.003 && b.y1 - b.y0 > 0.006) applyBox(bx.tr, b);
        drawSide(); render();
        return;
      }
      if (draft && draft.k === 'move' && drag?.creating) {
        drag = null;
        if (pxDist(draft.a, draft.b) > 10) commit(draft); else { draft = null; render(); }
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
          else if (it.k === 'poly' || it.k === 'link') it.pts[h] = s;
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
      if (busy) { if (e.key === 'Escape') busy.stop = true; return; }
      if (cands && e.key === 'Escape') { cands = null; setHint(); drawPanel(); render(); return; }
      if (man) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); stepMan(e.key === 'ArrowRight' ? 1 : -1); return; }
        if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); delKey(); return; }
        if (e.key === 'Escape' || e.key === 'Enter') { endManual(); return; }
      }
      if (e.key === ' ') { e.preventDefault(); playSmart(); }
      if (e.key === 'Enter' && draft && (draft.k === 'poly' || draft.k === 'link') && draft.pts.length >= 2) commit(draft);
      if (e.key === 'Escape') { if (draft) { draft = null; render(); } else setTool('select'); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { snapshot(); tele.items = tele.items.filter((x) => x !== sel); sel = null; drawSide(); render(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && history.length) {
        const h = JSON.parse(history.pop());
        tele.items = h.items; tele.trackers = h.trackers; sel = null; drawSide(); render();
      }
      if (e.key === 'ArrowRight') { video.pause(); video.currentTime = t() + 0.04; }
      if (e.key === 'ArrowLeft') { video.pause(); video.currentTime = Math.max(0, t() - 0.04); }
    };
    document.addEventListener('keydown', onKey);
    state.cleanup.push(() => document.removeEventListener('keydown', onKey));

    // ── 저장 ──
    el.querySelector('[data-save]').onclick = async () => {
      if (busy) return;
      video.pause();
      if (!(await prepTracks(true))
        && !(await confirmBox('트래킹 계산이 끝나지 않았어요 (멈추거나 선수를 놓친 곳이 있음). 지금까지 된 것만 저장할까요? 놓친 곳은 [다시 잡기] · [수동]으로 고친 뒤 다시 저장하면 됩니다.'))) return;
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
        toast('분석을 저장했습니다.');
        go(`/analysis/${id}`); // 저장하면 보기 화면으로
      } catch (err) { fail(err); }
    };
    el.querySelector('[data-cancel]')?.addEventListener('click', async () => {
      if (dirty && !(await confirmBox('저장하지 않은 수정 내용이 사라집니다. 수정을 취소할까요?'))) return;
      dirty = false;
      go(`/analysis/${id}`);
    });
    el.querySelector('[data-del]').onclick = async () => {
      if (!(await confirmBox('이 분석을 삭제할까요?'))) return;
      try { await deleteDoc(doc(col(), id)); go('/analysis'); } catch (err) { fail(err); }
    };
    const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    state.cleanup.push(() => window.removeEventListener('beforeunload', beforeUnload));
  }

  el.querySelector('[data-edit]')?.addEventListener('click', () => go(`/analysis/${id}/edit`));
  el.querySelector('[data-share]')?.addEventListener('click', () => shareModal(post));

  // ── 영상으로 내보내기 (그림 포함 녹화) ──
  el.querySelector('[data-export]').onclick = async () => {
    if (recording) { video.pause(); return; }
    if (busy) return;
    if (!comp.captureStream || typeof MediaRecorder === 'undefined') return toast('이 브라우저는 녹화를 지원하지 않습니다.');
    if (!(await prepTracks())) return; // 녹화 전에 트래킹을 먼저 다 계산 (녹화 중에 멈추지 않게)
    // mp4 를 먼저 (휴대폰 · 카톡에서 잘 열림), 안 되는 브라우저는 webm
    const type = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((x) => MediaRecorder.isTypeSupported(x));
    const isMp4 = !!type && type.startsWith('video/mp4');
    composite();
    const rec = new MediaRecorder(comp.captureStream(30), type ? { mimeType: type, videoBitsPerSecond: 16e6 } : undefined);
    const chunks = [];
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    rec.onstop = () => {
      recording = null;
      el.querySelector('.st-rec').hidden = true;
      el.querySelector('[data-export]').textContent = '⏺ 영상으로 내보내기';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(chunks, { type: isMp4 ? 'video/mp4' : 'video/webm' }));
      a.download = `${post.title || 'analysis'}.${isMp4 ? 'mp4' : 'webm'}`;
      a.click();
      render();
      if (canEdit && post.video.local) setTimeout(() => shareModal(post), 600); // 내보낸 영상을 유튜브에 올려 공유하도록 안내
    };
    recording = rec;
    sel = null;
    rec.start(250);
    el.querySelector('.st-rec').hidden = false;
    el.querySelector('[data-export]').textContent = '■ 녹화 멈추고 저장';
    toast('지금 위치부터 녹화합니다. 멈추면 파일로 저장됩니다.');
    video.play();
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
        <button class="btn ghost" data-share>🔗 ${post.shareUrl ? '공유 링크 바꾸기' : '공유 링크 넣기'}</button>
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
