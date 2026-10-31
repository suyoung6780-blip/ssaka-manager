// 운영자 전체 공지 배너 — 모든 화면 맨 위 (운영자 화면은 무거워서 따로, 공지 배너만 늘 불러옴)
import { db, doc, getDoc } from '../fb.js';
import { esc } from '../ui.js';

export const ref = () => doc(db, 'system', 'notice');
export const text = (s) => esc(s).replace(/\n/g, '<br>');

export const bannerHtml = (n, { preview = false } = {}) => `
  <div class="sys-notice ${n.level === 'important' ? 'important' : ''}">
    <span class="sys-tag">${n.level === 'important' ? '중요' : '공지'}</span>
    <div class="sys-body"><strong>${esc(n.title || '')}</strong>${n.body ? `<p>${text(n.body)}</p>` : ''}</div>
  </div>`;

// 화면 맨 위 배너 — 닫으면 이 공지(버전)는 다시 안 뜸, 운영자가 새로 저장하면 다시 뜸
export async function loadBanner(box) {
  if (!box) return;
  let n = null;
  try { const s = await getDoc(ref()); n = s.exists() ? s.data() : null; } catch { /* 읽기 실패 시 배너 없음 */ }
  // 운영자가 내릴 때까지 모두에게 계속 보임 (사용자가 닫을 수 없음)
  if (!n?.on || !n.title) { box.innerHTML = ''; return; }
  box.innerHTML = bannerHtml(n);
}

