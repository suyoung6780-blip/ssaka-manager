import { db, doc, getDoc } from './fb.js';
import { ADMIN_EMAILS } from './config.js';

// 전역 상태: 로그인 사용자, 내 프로필, 소속 팀, 팀 내 내 멤버 문서
export const state = { user: null, profile: null, team: null, member: null, cleanup: [] };

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
export const compActive = (t) => t?.comp === true && (!t.compUntil || t.compUntil.toMillis() > Date.now());
// 이용 가능: 무료(시범) · 운영자 무료 제공(홍보) · 결제 기간 안
export const teamActive = () => !!state.team && (state.team.free === true || compActive(state.team) || (!!state.team.paidUntil && state.team.paidUntil.toMillis() > Date.now()));
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
}

// 프로필 변경 시 팀 멤버 문서(공개 프로필)에도 반영할 필드
export const publicProfile = (p) => ({
  name: p.name || '', photo: p.photo || '', position: p.position || '', number: p.number || '',
  height: p.height || '', weight: p.weight || '', foot: p.foot || '', birthYear: p.birthYear || '', affiliation: p.affiliation || '',
  // 지도자
  coachTitle: p.coachTitle || '', duty: p.duty || '', licenses: p.licenses || '', licenseEtc: p.licenseEtc || '',
  school: p.school || '', career: p.career || '',
});
