// 홈 "오늘의 축구 브리핑" — 뉴스 · 유튜브 · 인스타그램 창
import { esc, modal } from '../ui.js';
import { FEEDS_URL } from '../config.js';

const PREF_KEY = 'ssaka.briefing';
// 기본 인스타그램: 대한축구협회 · 더유스필드 · 라이징스타 축구유망주
const DEFAULT_IG = ['thekfa', 'theyouthfield', 'risingstar_football'];
const IG_VER = 2; // 기본 목록을 바꾸면 올림 — 예전 기본 목록을 저장해 둔 사람도 새 목록으로
const RANGES = [[24, '24시간'], [72, '3일'], [168, '1주']];

function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { /* 저장소 사용 불가 */ }
  if (p.igVer !== IG_VER) { p.ig = DEFAULT_IG; p.igSel = 0; p.igVer = IG_VER; }
  return { range: 24, newsTab: 'ko', newsOff: [], ytOff: [], hideShorts: true, ig: DEFAULT_IG, igSel: 0, read: [], ...p };
}
function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...p, read: p.read.slice(-400) })); } catch { /* */ }
}

export function ago(ts) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

let feedPromise = null;
function loadFeeds(force = false) {
  if (!feedPromise || force) {
    feedPromise = fetch((FEEDS_URL || '/api/feeds') + (force ? `?t=${Date.now()}` : ''), { cache: force ? 'reload' : 'default' })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch((e) => { feedPromise = null; throw e; });
  }
  return feedPromise;
}

const win = (key, title, en, body, tools = '') => `
  <section class="win win-${key}" data-win="${key}">
    <header class="win-bar">
      <div class="win-title"><span class="eyebrow">${en}</span><h3>${title}</h3></div>
      <div class="win-tools">${tools}<button class="icon-btn sm" data-pop="${key}" title="크게 보기" aria-label="크게 보기">⤢</button></div>
    </header>
    <div class="win-body">${body}</div>
  </section>`;

export async function renderBriefing(el) {
  const prefs = loadPrefs();
  el.innerHTML = `
    <div class="brief-head">
      <div><span class="eyebrow">TODAY'S FOOTBALL</span><h2>오늘의 축구 브리핑</h2></div>
      <div class="brief-tools">
        <div class="seg" data-range>${RANGES.map(([h, l]) => `<button data-h="${h}" class="${h === prefs.range ? 'on' : ''}">${l}</button>`).join('')}</div>
        <button class="btn ghost sm" data-refresh>↻ 새로고침</button>
      </div>
    </div>
    <div class="brief-grid">
      ${win('news', '뉴스', 'NEWS', '<div class="skeleton"></div>')}
      ${win('yt', '유튜브', 'YOUTUBE', '<div class="skeleton"></div>')}
      ${win('ig', '인스타그램', 'INSTAGRAM', '')}
    </div>
    <p class="brief-foot" data-foot></p>`;

  let data = null;
  const within = (ts) => Date.now() - ts < prefs.range * 3600000;
  const set = (k, v) => { prefs[k] = v; savePrefs(prefs); };

  // ── 뉴스 ──
  function drawNews(box = el.querySelector('[data-win="news"] .win-body'), max = 40) {
    if (!data) return;
    const srcs = data.sources.news.filter((s) => prefs.newsTab === 'all' || s.lang === prefs.newsTab);
    const items = data.news.filter((n) => within(n.ts) && (prefs.newsTab === 'all' || n.lang === prefs.newsTab) && !prefs.newsOff.includes(n.src));
    const read = new Set(prefs.read);
    box.innerHTML = `
      <div class="win-sub">
        <div class="seg sm" data-tab>${[['ko', '국내'], ['en', '해외'], ['all', '전체']].map(([k, l]) => `<button data-k="${k}" class="${prefs.newsTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="count">${items.length}건</span>
      </div>
      <div class="src-chips">${srcs.map((s) => `<button class="src ${prefs.newsOff.includes(s.id) ? 'off' : ''}" data-src="${s.id}">${esc(s.name)}</button>`).join('')}</div>
      <ol class="news-list">${items.slice(0, max).map((n) => `
        <li class="${read.has(n.link) ? 'read' : ''}"><a href="${esc(n.link)}" target="_blank" rel="noopener" data-link="${esc(n.link)}">
          <span class="news-meta"><b>${esc(n.srcName)}</b>${ago(n.ts)}</span>
          <span class="news-title">${esc(n.title)}</span></a></li>`).join('') || '<li class="none">이 기간에 올라온 뉴스가 없습니다.</li>'}
      </ol>
      ${items.length > max ? `<button class="more-btn" data-more>${items.length - max}건 더 보기</button>` : ''}`;
    box.querySelectorAll('[data-tab] button').forEach((b) => (b.onclick = () => { set('newsTab', b.dataset.k); drawNews(box, max); }));
    box.querySelectorAll('[data-src]').forEach((b) => (b.onclick = () => {
      const id = b.dataset.src;
      set('newsOff', prefs.newsOff.includes(id) ? prefs.newsOff.filter((x) => x !== id) : [...prefs.newsOff, id]);
      drawNews(box, max);
    }));
    box.querySelectorAll('[data-link]').forEach((a) => (a.onclick = () => {
      if (!prefs.read.includes(a.dataset.link)) set('read', [...prefs.read, a.dataset.link]);
      a.parentElement.classList.add('read');
    }));
    box.querySelector('[data-more]')?.addEventListener('click', () => drawNews(box, max + 40));
  }

  // ── 유튜브 ──
  function drawYt(box = el.querySelector('[data-win="yt"] .win-body'), big = false) {
    if (!data) return;
    const items = data.videos.filter((v) => within(v.ts) && !prefs.ytOff.includes(v.src) && !(prefs.hideShorts && v.shorts));
    const cur = items[0];
    box.innerHTML = `
      <div class="yt-player">${cur ? `<iframe src="https://www.youtube.com/embed/${cur.id}?rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="${esc(cur.title)}"></iframe>` : '<div class="none">이 기간에 올라온 영상이 없습니다.</div>'}</div>
      ${cur ? `<div class="yt-now"><b>${esc(cur.srcName)}</b> · ${ago(cur.ts)}<p>${esc(cur.title)}</p></div>` : ''}
      <div class="win-sub">
        <label class="mini-switch"><input type="checkbox" data-shorts ${prefs.hideShorts ? 'checked' : ''}> 쇼츠 숨기기</label>
        <span class="count">${items.length}개</span>
      </div>
      <div class="src-chips">${data.sources.youtube.map((s) => `<button class="src ${prefs.ytOff.includes(s.id) ? 'off' : ''}" data-src="${s.id}">${esc(s.name)}</button>`).join('')}</div>
      <div class="yt-list ${big ? 'big' : ''}">${items.map((v, i) => `
        <button class="yt-item ${i === 0 ? 'on' : ''}" data-vid="${v.id}">
          <span class="yt-thumb"><img loading="lazy" src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" alt=""></span>
          <span class="yt-info"><b>${esc(v.srcName)}</b><span>${esc(v.title)}</span><small>${ago(v.ts)}${v.views ? ` · 조회 ${v.views.toLocaleString()}` : ''}</small></span>
        </button>`).join('')}</div>`;
    box.querySelectorAll('[data-vid]').forEach((b) => (b.onclick = () => {
      const v = items.find((x) => x.id === b.dataset.vid);
      box.querySelector('.yt-player').innerHTML = `<iframe src="https://www.youtube.com/embed/${v.id}?autoplay=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="${esc(v.title)}"></iframe>`;
      box.querySelector('.yt-now').innerHTML = `<b>${esc(v.srcName)}</b> · ${ago(v.ts)}<p>${esc(v.title)}</p>`;
      box.querySelectorAll('.yt-item').forEach((x) => x.classList.toggle('on', x === b));
    }));
    box.querySelector('[data-shorts]').onchange = (e) => { set('hideShorts', e.target.checked); drawYt(box, big); };
    box.querySelectorAll('[data-src]').forEach((b) => (b.onclick = () => {
      const id = b.dataset.src;
      set('ytOff', prefs.ytOff.includes(id) ? prefs.ytOff.filter((x) => x !== id) : [...prefs.ytOff, id]);
      drawYt(box, big);
    }));
  }

  // ── 인스타그램 (공식 프로필 임베드) ──
  function drawIg(box = el.querySelector('[data-win="ig"] .win-body')) {
    const list = prefs.ig;
    const sel = Math.min(prefs.igSel, list.length - 1);
    const user = list[sel];
    box.innerHTML = `
      <div class="src-chips ig-tabs">${list.map((u, i) => `<button class="src ${i === sel ? 'on' : ''}" data-i="${i}">@${esc(u)}</button>`).join('')}
        <button class="src add" data-add>+ 계정</button></div>
      ${user ? `<div class="ig-frame"><iframe src="https://www.instagram.com/${encodeURIComponent(user)}/embed/" loading="lazy" title="@${esc(user)}"></iframe></div>
      <div class="win-sub"><a href="https://www.instagram.com/${encodeURIComponent(user)}/" target="_blank" rel="noopener">인스타그램에서 열기 ↗</a>
        <button class="link-btn small" data-rm>이 계정 빼기</button></div>` : '<div class="none">계정을 추가하세요.</div>'}`;
    box.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { set('igSel', +b.dataset.i); drawIg(box); }));
    box.querySelector('[data-add]').onclick = () => {
      const v = (prompt('인스타그램 계정 아이디 (예: kleague)') || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '');
      if (!/^[\w.]{1,30}$/.test(v)) return;
      if (!list.includes(v)) set('ig', [...list, v]);
      set('igSel', prefs.ig.indexOf(v));
      drawIg(box);
    };
    box.querySelector('[data-rm]')?.addEventListener('click', () => {
      set('ig', list.filter((u) => u !== user));
      set('igSel', 0);
      drawIg(box);
    });
  }

  // ── 크게 보기 (창 띄우기) ──
  el.querySelectorAll('[data-pop]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.pop;
    const m = modal(`<div class="pop-win"><span class="eyebrow">${{ news: 'NEWS', yt: 'YOUTUBE', ig: 'INSTAGRAM' }[k]}</span>
      <h2>${{ news: '뉴스', yt: '유튜브', ig: '인스타그램' }[k]}</h2><div class="win-body pop-${k}"></div></div>`, { wide: true });
    const box = m.el.querySelector('.win-body');
    if (k === 'news') drawNews(box, 200);
    if (k === 'yt') drawYt(box, true);
    if (k === 'ig') drawIg(box);
  }));

  el.querySelectorAll('[data-range] button').forEach((b) => (b.onclick = () => {
    set('range', +b.dataset.h);
    el.querySelectorAll('[data-range] button').forEach((x) => x.classList.toggle('on', x === b));
    drawNews();
    drawYt();
  }));

  const foot = el.querySelector('[data-foot]');
  async function load(force) {
    try {
      data = await loadFeeds(force);
      drawNews();
      drawYt();
      const t = new Date(data.updatedAt);
      foot.textContent = `업데이트 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} · 기사 제목과 링크만 표시하며 원문은 각 언론사 사이트에서 열립니다.`
        + (data.failed.length ? ` (불러오지 못한 출처 ${data.failed.length}곳)` : '');
    } catch {
      const msg = '<div class="none">브리핑을 불러오지 못했습니다. 잠시 후 새로고침하세요.</div>';
      el.querySelector('[data-win="news"] .win-body').innerHTML = msg;
      el.querySelector('[data-win="yt"] .win-body').innerHTML = msg;
    }
  }
  el.querySelector('[data-refresh]').onclick = () => load(true);
  drawIg();
  await load(false);
}
