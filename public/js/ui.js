export const CATEGORIES = ['U12', 'U15', 'U18', 'U22', 'K5', 'K6', 'K7', '학교동아리', '아마추어 조기회'];
export const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'];
export const ROLES = { coach: '코치', player: '선수' };
export const MATCH_TYPES = ['리그', '토너먼트', '친선', '연습경기'];

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// 줄바꿈 유지 + 이스케이프
export const text = (s) => esc(s).replace(/\n/g, '<br>');

export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

export function fail(e) {
  console.error(e);
  const msg = {
    'permission-denied': '권한이 없습니다.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/email-already-in-use': '이미 가입된 이메일입니다.',
    'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
    'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
    'auth/missing-email': '이메일을 입력하세요.',
    'auth/too-many-requests': '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
    'auth/expired-action-code': '재설정 링크가 만료되었습니다. 메일을 다시 받아주세요.',
    'auth/invalid-action-code': '이미 사용했거나 잘못된 재설정 링크입니다. 메일을 다시 받아주세요.',
  }[e?.code];
  toast(msg || e?.message || '오류가 발생했습니다.');
}

export function modal(html, { wide = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><button class="modal-x" aria-label="닫기">✕</button>${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.modal-x')) close(); });
  return { el: wrap.querySelector('.modal'), close };
}

export function confirmBox(msg) {
  return new Promise((resolve) => {
    const m = modal(`<p class="confirm-msg">${esc(msg)}</p>
      <div class="row end"><button class="btn ghost" data-no>취소</button><button class="btn" data-yes>확인</button></div>`);
    m.el.querySelector('[data-yes]').onclick = () => { m.close(); resolve(true); };
    m.el.querySelector('[data-no]').onclick = () => { m.close(); resolve(false); };
  });
}

export const formData = (form) => Object.fromEntries(new FormData(form).entries());

export function toDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  return new Date(v);
}

export function fmtDate(v, withTime = false) {
  const d = toDate(v);
  if (!d || isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  const s = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  return withTime ? `${s} ${p(d.getHours())}:${p(d.getMinutes())}` : s;
}

export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function avatar(photo, name, cls = '') {
  return photo
    ? `<img class="avatar ${cls}" src="${esc(photo)}" alt="">`
    : `<span class="avatar ${cls}">${esc((name || '?').slice(0, 1))}</span>`;
}

export const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;

export function pageHead(en, ko, actions = '') {
  return `<header class="page-head"><div><span class="eyebrow">${esc(en)}</span><h1>${esc(ko)}</h1></div><div class="actions">${actions}</div></header>`;
}

export const options = (list, selected) => list
  .map((v) => (Array.isArray(v) ? v : [v, v]))
  .map(([val, label]) => `<option value="${esc(val)}" ${String(val) === String(selected ?? '') ? 'selected' : ''}>${esc(label)}</option>`)
  .join('');

// 이미지를 줄여 dataURL 로 변환 (Firestore 문서에 바로 저장). 프로필 사진은 흑백.
export function resizeImage(file, max = 320, gray = true) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      const g = c.getContext('2d');
      if (gray) g.filter = 'grayscale(1)';
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function youtubeId(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}
