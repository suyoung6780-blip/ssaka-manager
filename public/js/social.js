// 구글 · 카카오로 가입 · 로그인
// - 구글: Firebase 기본 (팝업) — 같은 이메일로 이미 가입했으면 그 계정으로 이어짐
// - 카카오: /api/kakao 가 카카오 확인 → 같은 이메일의 계정(없으면 새 계정)으로 들어오는 열쇠(커스텀 토큰)를 돌려줌
// 로그인 뒤 개인계정이 없으면 기존 '개인계정 만들기'(실명 · 계정 유형 · 생년월일 · 약관 동의)로 이어짐
import { auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInWithCustomToken } from './fb.js';
import { toast, fail } from './ui.js';
import { SOCIAL_LOGIN } from './config.js';

const ERR = {
  'auth/account-exists-with-different-credential': '이 이메일은 이미 다른 방법으로 가입되어 있어요. 이메일 · 비밀번호로 로그인해 주세요.',
  'auth/operation-not-allowed': '구글 로그인을 아직 준비 중이에요. 이메일로 가입해 주세요.',
  'auth/unauthorized-domain': '이 주소에서는 구글 로그인을 쓸 수 없어요. 운영자에게 알려 주세요.',
  'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
};
const KAKAO_ERR = {
  email: '카카오 계정의 이메일 제공에 동의해 주세요. (카카오 로그인 화면에서 [이메일] 체크)',
  unverified: '카카오 계정 이메일이 인증되지 않았어요. 카카오에서 이메일 인증을 마친 뒤 다시 해 주세요.',
  cancel: '카카오 로그인을 취소했어요.',
  state: '로그인 시간이 지났어요. 다시 눌러 주세요.',
  config: '카카오 로그인을 아직 준비 중이에요. 이메일로 가입해 주세요.',
};

export const socialOn = () => SOCIAL_LOGIN.google || SOCIAL_LOGIN.kakao;

export function socialButtons(mode = 'login') {
  if (!socialOn()) return '';
  const verb = mode === 'signup' ? '가입' : '로그인';
  return `<div class="social-login">
    ${SOCIAL_LOGIN.kakao ? `<button type="button" class="soc-btn kakao" data-soc="kakao"><span class="soc-ic" aria-hidden="true"></span>카카오로 ${mode === 'signup' ? '시작하기' : '로그인'}</button>` : ''}
    ${SOCIAL_LOGIN.google ? `<button type="button" class="soc-btn google" data-soc="google"><span class="soc-ic" aria-hidden="true"></span>Google 계정으로 ${verb}</button>` : ''}
    <div class="soc-or"><span>또는 이메일로</span></div>
  </div>`;
}

export function bindSocial(root) {
  root.querySelector('[data-soc="google"]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const pv = new GoogleAuthProvider();
      pv.setCustomParameters({ prompt: 'select_account' });
      try { await signInWithPopup(auth, pv); } catch (err) {
        if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/operation-not-supported-in-this-environment') await signInWithRedirect(auth, pv);
        else throw err;
      }
      // 로그인되면 화면은 저절로 바뀜 (개인계정이 없으면 '개인계정 만들기')
    } catch (err) {
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') return;
      toast(ERR[err?.code] || err?.message || '구글 로그인에 실패했어요.');
    } finally { b.disabled = false; }
  });
  root.querySelector('[data-soc="kakao"]')?.addEventListener('click', () => {
    if (auth.demo) { toast('체험 모드에서는 구글 · 카카오 로그인을 쓸 수 없어요. 아래 데모 계정으로 들어가 보세요.'); return; }
    location.href = '/api/kakao?start=1';
  });
}

// 카카오에서 돌아왔을 때: 주소 # 뒤의 열쇠(kt) 또는 오류(kerr)
export async function kakaoReturn() {
  const h = location.hash;
  const m = h.match(/[?&](kt|kerr)=([^&]+)/);
  if (!m) return false;
  history.replaceState(null, '', `${location.pathname}${location.search}#/login`); // 주소창 · 기록에 열쇠를 남기지 않음
  if (m[1] === 'kerr') { toast(KAKAO_ERR[m[2]] || '카카오 로그인에 실패했어요.'); return false; }
  try { await signInWithCustomToken(auth, decodeURIComponent(m[2])); return true; } catch (err) { fail(err); return false; }
}
