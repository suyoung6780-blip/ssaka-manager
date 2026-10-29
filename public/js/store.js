import { auth, db, doc, getDoc } from './fb.js';
import { ADMIN_EMAILS, FREE_MODE, FREE_UNTIL, TRIAL_DAYS } from './config.js';

// 전역 상태: 로그인 사용자, 내 프로필, 소속 팀, 팀 내 내 멤버 문서
export const state = { user: null, profile: null, team: null, member: null, features: {}, cleanup: [] };

export const role = () => state.profile?.role;
export const inTeam = () => !!(state.team && state.member);
export const isCoach = () => inTeam() && state.member.role === 'coach';
// 팀원 = 코치 · 선수 (팀 코드로 들어온 사람은 팀 대표가 승인한 뒤부터)
export const isSquad = () => inTeam() && state.member.approved !== false;
export const waitApproval = () => inTeam() && state.member.approved === false;
// 서비스 운영자 — 운영자 이메일 + 이메일 인증 완료
export const isAdminEmail = () => ADMIN_EMAILS.includes((state.user?.email || '').toLowerCase());
export const isAdmin = () => isAdminEmail() && !!state.user?.emailVerified;
export const isOwner = () => !!(state.team && state.user && state.team.ownerUid === state.user.uid);
// 운영자 무료 제공: compUntil 이 없으면 평생
// 운영자가 기능을 막은 팀 (운영자가 풀 때까지)
export const teamRestricted = () => state.team?.restricted === true;
export const compActive = (t) => t?.comp === true && (!t.compUntil || t.compUntil.toMillis() > Date.now());
// 체험 모드에서 주소 끝에 ?expired=1 → '이용기간이 끝난 팀'으로 미리 보기 (실제 사이트엔 영향 없음)
export const previewExpired = () => !!auth.demo && /[?&]expired=1/.test(location.search);
// 지금 결제 없이 모두 무료인지 (미리 보기 중엔 아님)
export const freeMode = () => FREE_MODE && !previewExpired();
const ms = (v) => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : v ? +new Date(v) : 0);
// 이 팀이 지금 무엇으로 쓰는지 · 언제까지 (until: 밀리초, 평생이면 Infinity)
//  paid 결제 · comp 운영자 무료 제공 · trial 새 팀 무료 체험 · free 유료 전환 전에 만든 팀 · none 결제 필요
export function teamPlan(t = state.team) {
  if (!t) return { kind: 'none', until: 0 };
  if (previewExpired()) return { kind: 'none', until: Date.now() - 3 * 864e5, plan: 'rising' };
  const now = Date.now();
  const paid = ms(t.paidUntil);
  if (paid > now) return { kind: 'paid', until: paid, plan: t.plan || '', cycle: t.planCycle || '' };
  if (compActive(t)) return { kind: 'comp', until: t.compUntil ? ms(t.compUntil) : Infinity };
  if (freeMode()) return { kind: 'free', until: Infinity }; // 베타: 모든 팀 무료
  if (t.free === true) { const u = +new Date(FREE_UNTIL); if (u > now) return { kind: 'free', until: u }; }
  if (t.trial === true) { const u = ms(t.createdAt) + TRIAL_DAYS * 864e5; if (u > now || !t.createdAt) return { kind: 'trial', until: t.createdAt ? u : now + TRIAL_DAYS * 864e5 }; }
  return { kind: 'none', until: paid || 0, plan: t.plan || '' };
}
// 이용 가능: 결제 기간 안 · 운영자 무료 제공 · 새 팀 체험 10일 · 예전 팀 무료 기간
export const teamActive = () => !!state.team && teamPlan().kind !== 'none';
export const teamPath = (...p) => ['teams', state.team.id, ...p].join('/');

// app.js 가 채워 넣는 훅 (순환 import 방지)
export const hooks = { route: () => {}, updateShell: () => {} };

export const go = (path) => {
  if (location.hash === '#' + path) hooks.route();
  else location.hash = '#' + path;
};

export async function loadContext() {
  const u = state.user;
  state.profile = state.team = state.member = null;
  state.features = {};
  if (!u) return;
  const p = await getDoc(doc(db, 'users', u.uid));
  state.profile = p.exists() ? { id: p.id, ...p.data() } : null;
  const teamId = state.profile?.teamId;
  if (!teamId) return;
  const t = await getDoc(doc(db, 'teams', teamId));
  if (!t.exists()) return;
  state.team = { id: t.id, ...t.data() };
  try {
    const m = await getDoc(doc(db, 'teams', teamId, 'members', u.uid));
    state.member = m.exists() ? { id: m.id, ...m.data() } : null;
  } catch { state.member = null; }
  // 운영자가 이 팀에만 켜 준 추가 기능 (system/features)
  try { state.features = (await getDoc(doc(db, 'system', 'features'))).data()?.teams?.[teamId] || {}; } catch { state.features = {}; }
}
// 3.0 기능(proto3)은 2026-10-29부터 모든 팀에 켬 — 다른 기능 스위치는 그대로 팀마다
export const hasFeature = (k) => k === 'proto3' || !!state.features?.[k];
// 운영자가 방금 켠 기능도 바로 보이도록 (오늘 기록 · 일지검사 들어갈 때 다시 읽음)
export async function refreshFeatures() {
  if (!state.team) return;
  try { state.features = (await getDoc(doc(db, 'system', 'features'))).data()?.teams?.[state.team.id] || {}; } catch { /* 그대로 */ }
}

// 등번호는 해(시즌)마다 바뀔 수 있음 — 바뀔 때마다 numbers: [{ no, from: 'YYYY-MM-DD' }] 로 남겨서
// 지난 경기 · 영상은 그 날짜의 번호로 봄 (기록은 모두 UID로 이어져 있어 번호가 바뀌어도 기록은 그대로)
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function numberAt(m, date) {
  const h = m?.numbers || [];
  if (!date || !h.length) return m?.number || '';
  const x = h.filter((e) => (e.from || '') <= String(date)).pop();
  return x ? x.no : '';
}
export function nextNumbers(prev, no) {
  const h = [...(prev?.numbers || [])];
  const old = h.length ? h[h.length - 1].no : prev?.number || '';
  if (String(old || '') === String(no || '')) return h.length ? h : null;
  if (!h.length && old) h.push({ no: String(old), from: '' }); // 처음 바꿀 때: 그 전 번호는 처음부터 쓰던 것
  const today = ymd();
  if (h.length && h[h.length - 1].from === today) h.pop(); // 같은 날 여러 번 바꾸면 마지막 것만
  h.push({ no: String(no || ''), from: today });
  return h;
}

// 프로필 변경 시 팀 멤버 문서(공개 프로필)에도 반영할 필드
export const publicProfile = (p) => ({
  name: p.name || '', photo: p.photo || '', position: p.position || '', number: p.number || '', ...(p.numbers ? { numbers: p.numbers } : {}), ...(p.numYear ? { numYear: p.numYear } : {}),
  grade: p.grade || '', ...(p.gradeYear ? { gradeYear: p.gradeYear } : {}),
  height: p.height || '', weight: p.weight || '', foot: p.foot || '', birthYear: p.birthYear || '', affiliation: p.affiliation || '',
  // 지도자
  coachTitle: p.coachTitle || '', duty: p.duty || '', licenses: p.licenses || '', licenseEtc: p.licenseEtc || '',
  school: p.school || '', career: p.career || '',
});
