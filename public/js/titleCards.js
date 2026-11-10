// 영상 첫 화면(제목 · 선수 소개) 디자인 — 영상룸 편집기의 [+ 첫 화면]
// it: { tpl, name, number, team, pos, sub } · p: 0~1 나타나는 정도 (첫 0.5초 동안)
export const TEMPLATES = [['bold', '번호 크게'], ['center', '가운데'], ['band', '띠'], ['minimal', '깔끔하게']];
const F = 'Pretendard Variable, Pretendard, sans-serif';
const G = '#39e75f';

function bg(c, W, H, glow = true) {
  c.fillStyle = '#090b0d'; c.fillRect(0, 0, W, H);
  if (!glow) return;
  const g = c.createRadialGradient(W * 0.85, H * 1.1, 0, W * 0.85, H * 1.1, W * 0.6);
  g.addColorStop(0, 'rgba(57,231,95,.16)'); g.addColorStop(1, 'rgba(57,231,95,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
}
function brand(c, x, y, u, logo, align = 'left') {
  c.font = `800 ${30 * u}px ${F}`; c.fillStyle = 'rgba(255,255,255,.85)'; c.textAlign = 'left';
  const tw = c.measureText('SSAKA MANAGER').width; const lw = logo ? 54 * u * (logo.width / logo.height) : 0;
  const x0 = align === 'center' ? x - (lw + 22 * u + tw) / 2 : x;
  if (logo) c.drawImage(logo, x0, y - 40 * u, lw, 54 * u);
  c.fillText('SSAKA MANAGER', x0 + (logo ? lw + 22 * u : 0), y);
}
// 이름이 칸보다 길면 줄여서
function fit(c, s, w8, size, maxW, u) { let fs = size; c.font = `${w8} ${fs * u}px ${F}`; while (fs > 40 && c.measureText(s).width > maxW) { fs -= 6; c.font = `${w8} ${fs * u}px ${F}`; } return fs; }

export function drawTitle(c, W, H, it = {}, logo = null, p = 1) {
  const u = H / 1080; const tpl = it.tpl || 'bold';
  const nm = it.name || '선수 이름'; const meta = [it.team, it.pos].filter(Boolean).join('  ·  ');
  c.save(); c.textBaseline = 'alphabetic';
  if (tpl === 'center') {
    bg(c, W, H);
    c.globalAlpha = p; c.textAlign = 'center';
    brand(c, W / 2, 170 * u, u, logo, 'center');
    if (it.number) { c.font = `900 ${110 * u}px ${F}`; c.fillStyle = G; c.textAlign = 'center'; c.fillText(String(it.number), W / 2, 430 * u); }
    c.fillStyle = '#fff'; fit(c, nm, 900, 170, W - 240 * u, u); c.textAlign = 'center'; c.fillText(nm, W / 2, (it.number ? 640 : 590) * u);
    if (meta) { c.font = `700 ${44 * u}px ${F}`; c.fillStyle = 'rgba(255,255,255,.8)'; c.fillText(meta, W / 2, (it.number ? 730 : 690) * u); }
    c.fillStyle = G; c.fillRect(W / 2 - 80 * u * p, 790 * u, 160 * u * p, 6 * u);
    if (it.sub) { c.font = `600 ${38 * u}px ${F}`; c.fillStyle = 'rgba(255,255,255,.6)'; c.fillText(it.sub, W / 2, 880 * u); }
  } else if (tpl === 'band') {
    bg(c, W, H, false);
    const bh = 360 * u; const by = H / 2 - bh / 2;
    c.fillStyle = G; c.fillRect(0, by, W * Math.min(1, p * 1.2), bh);
    c.globalAlpha = p;
    brand(c, 120 * u, 150 * u, u, logo);
    c.fillStyle = '#07130a'; c.textAlign = 'left';
    const x = 140 * u;
    if (it.number) { c.font = `900 ${250 * u}px ${F}`; c.fillText(String(it.number), x, by + bh - 70 * u); }
    const nx = x + (it.number ? c.measureText(String(it.number)).width + 60 * u : 0);
    if (meta) { c.font = `800 ${42 * u}px ${F}`; c.fillText(meta, nx, by + 110 * u); }
    fit(c, nm, 900, 150, W - nx - 120 * u, u); c.fillText(nm, nx, by + 260 * u);
    if (it.sub) { c.font = `600 ${40 * u}px ${F}`; c.fillStyle = 'rgba(255,255,255,.75)'; c.fillText(it.sub, x, by + bh + 110 * u); }
  } else if (tpl === 'minimal') {
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    c.globalAlpha = p; c.textAlign = 'left';
    const x = 160 * u;
    c.fillStyle = 'rgba(255,255,255,.55)'; c.font = `600 ${40 * u}px ${F}`;
    c.fillText([it.number && `#${it.number}`, meta].filter(Boolean).join('   '), x, 470 * u);
    c.fillStyle = '#fff'; fit(c, nm, 800, 130, W - 320 * u, u); c.fillText(nm, x, 610 * u);
    c.fillStyle = G; c.fillRect(x, 660 * u, 100 * u * p, 4 * u);
    if (it.sub) { c.fillStyle = 'rgba(255,255,255,.6)'; c.font = `500 ${36 * u}px ${F}`; c.fillText(it.sub, x, 740 * u); }
    c.globalAlpha = p * 0.6; c.font = `800 ${24 * u}px ${F}`; c.fillStyle = '#fff'; c.textAlign = 'right'; c.fillText('SSAKA MANAGER', W - 80 * u, H - 70 * u);
  } else { // bold: 번호 크게 (테두리) + 이름
    bg(c, W, H);
    c.globalAlpha = p; c.textAlign = 'left';
    const x = 140 * u; const dx = (1 - p) * 40 * u;
    brand(c, x, 150 * u, u, logo);
    if (it.number) { c.font = `900 ${300 * u}px ${F}`; c.lineWidth = 4 * u; c.strokeStyle = 'rgba(57,231,95,.85)'; c.strokeText(String(it.number), x + dx, 620 * u); }
    const nx = x + (it.number ? c.measureText(String(it.number)).width + 50 * u : 0) + dx;
    c.fillStyle = G; c.font = `700 ${40 * u}px ${F}`; c.fillText(meta, nx, 450 * u);
    c.fillStyle = '#fff'; fit(c, nm, 900, 150, W - nx - 120 * u, u); c.fillText(nm, nx, 600 * u);
    if (it.sub) { c.fillStyle = 'rgba(255,255,255,.7)'; c.font = `600 ${40 * u}px ${F}`; c.fillText(it.sub, x + dx, 800 * u); }
    c.fillStyle = G; c.fillRect(x, 850 * u, 160 * u * p, 6 * u);
  }
  c.restore();
}
// 디자인 고르기 칸 (작은 미리보기 그림 버튼) — 고른 뒤 [data-tpl] 로 읽음
export function tplPicker(cur, it, logo) {
  const wrap = document.createElement('div'); wrap.className = 'tc-pick';
  TEMPLATES.forEach(([k, l]) => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.tpl = k; b.className = k === cur ? 'on' : '';
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180; drawTitle(cv.getContext('2d'), 320, 180, { ...it, tpl: k }, logo);
    b.append(cv, Object.assign(document.createElement('span'), { textContent: l }));
    wrap.append(b);
  });
  return wrap;
}
export const loadLogo = () => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = 'icons/logo-mark.png'; });
