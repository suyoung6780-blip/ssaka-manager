// ① Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹) 에서 복사한 값으로 바꿔주세요.
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: '',
  appId: '',
};

// Cloud Functions 리전 (functions/index.js 와 같아야 함)
export const FUNCTIONS_REGION = 'asia-northeast3';

// ② 토스페이먼츠 클라이언트 키 (API 개별 연동 키).
//    아래는 토스 공식 문서용 테스트 키 — 실제 카드 결제 없이 테스트됩니다.
//    가맹점 심사 후 live_ck_... 로 교체하세요.
export const TOSS_CLIENT_KEY = 'test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq';

// ③ 요금제 — functions/index.js 의 PLAN_PRICE 와 반드시 같은 값이어야 합니다.
export const PLAN = { name: '싸카매니저 팀 이용권 (30일)', price: 30000, days: 30 };

// ④ 무료 운영 모드 — 결제 없이 지도자가 팀을 만들면 바로 팀 코드 발급 (Cloud Functions 불필요)
//    유료로 바꿀 때: false 로 바꾸고 firestore.rules 의 '무료 모드' 부분을 지우세요.
export const FREE_MODE = true;

// ⑤ 축구 브리핑 피드 주소 — GitHub Actions(feedbot/)가 30분마다 만드는 feeds.json (무료)
//    예) 'https://raw.githubusercontent.com/<깃허브아이디>/ssaka-feeds/main/feeds.json'
//    비워두면 같은 사이트의 /api/feeds (로컬 dev-server.py 또는 유료 Cloud Functions) 를 씁니다.
export const FEEDS_URL = '';

// ⑥ 운영자 계정 이메일 — 전체 공지 · 전체 팀 관리. firestore.rules 의 isAdmin() 과 같아야 함
//    이 이메일로 가입한 뒤 '이메일 인증'까지 마쳐야 운영자 권한이 열립니다 (남이 먼저 가입해도 인증 못 하면 권한 없음)
export const ADMIN_EMAILS = ['suyoung6780@gmail.com'];

export const isConfigured = !firebaseConfig.apiKey.startsWith('YOUR_');
