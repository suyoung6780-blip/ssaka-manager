// ① Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹) 에서 복사한 값으로 바꿔주세요.
export const firebaseConfig = {
  apiKey: 'AIzaSyCgfjnUtcy6iicv9rFaYuVzjlm0BOFWBxs',
  authDomain: 'ssaka-manager.firebaseapp.com',
  projectId: 'ssaka-manager',
  storageBucket: 'ssaka-manager.firebasestorage.app',
  messagingSenderId: '217949834329',
  appId: '1:217949834329:web:bb793e7b655fe31be23548',
};

// Cloud Functions 리전 (functions/index.js 와 같아야 함)
export const FUNCTIONS_REGION = 'asia-northeast3';

// ② 토스페이먼츠 '결제위젯 연동 키'의 클라이언트 키 (토스 개발자센터 › API 키 › 결제위젯 연동 키)
//    아래는 토스 공식 문서용 공개 테스트 키 — 실제 돈이 나가지 않아요.
//    가맹점 심사 후 내 상점의 live_gck_... 로 바꾸고, Vercel 환경 변수 TOSS_SECRET_KEY 에 짝이 되는 live_gsk_... 를 넣으세요.
export const TOSS_CLIENT_KEY = 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm';

// ③ 요금제 — api/pay.py 의 PLANS 와 반드시 같은 값이어야 합니다 (서버가 금액을 다시 확인)
//    인원은 '승인된' 팀원 기준. 연 이용권 = 10개월 값으로 12개월 (365일)
export const PLANS = [
  { id: 'gaffer', name: '가퍼', sub: '지도자 전용', players: 0, coaches: 3, month: 14900, note: '선수 없이 지도자끼리 — 작전판 · 훈련 프로그램 · 분석실(부분 · 경기분석) · 게임모델 · 미팅룸 · 경기 기록실 · 코치 · 스카웃 노트 · 커뮤니티' },
  { id: 'rising', name: '라이징', sub: '작은 팀', players: 30, coaches: 3, month: 29000 },
  { id: 'pro', name: '프로', sub: '가장 많이 써요', players: 50, coaches: 6, month: 39000, best: true },
  { id: 'champion', name: '챔피언', sub: '큰 팀', players: 80, coaches: 10, month: 54900 },
];
export const LEGEND = { name: '레전드', sub: '클럽 · 아카데미', players: '81명 이상', price: '89,000원부터 · 상담' };
export const CYCLES = { month: { label: '1개월', days: 30, mult: 1 }, year: { label: '12개월', days: 365, mult: 10 } };
export const planPrice = (p, cycle) => p.month * CYCLES[cycle].mult;
// 새 팀 무료 체험 (팀을 만든 날부터) · 유료 전환 전에 만든 팀(free)의 무료 사용 마지막 날
export const TRIAL_DAYS = 10;
export const FREE_UNTIL = '2026-11-23T00:00:00+09:00';

// ④ 무료 운영 모드 — true: 지금은 모든 팀 무료 (베타). 요금 안내 · 결제 화면 · 환불정책은 그대로 보이고 결제도 됨 (토스 심사용)
//    false: 결제 사용 (새 팀은 체험 10일 뒤 결제 · 예전 팀은 FREE_UNTIL 까지 무료) — 바꾸기 30일 전에 회원에게 알리기
export const FREE_MODE = true;
// 지금 무료 기간 안내 카드 (요금 안내 맨 앞)
export const DEMO_PLAN = { name: '데모', sub: '지금 베타 기간', price: '무료', note: '유료로 바뀌기 30일 전에 알려 드려요' };
// 이 날짜부터 새로 가입한 계정은 이메일 인증을 해야 시작할 수 있어요 (그 전 가입자는 그대로)
export const EMAIL_VERIFY_FROM = '2026-10-12T00:00:00+09:00';

// ⑤ 축구 브리핑 피드 주소 — GitHub Actions(feedbot/)가 30분마다 만드는 feeds.json (무료)
//    예) 'https://raw.githubusercontent.com/<깃허브아이디>/ssaka-feeds/main/feeds.json'
//    비워두면 같은 사이트의 /api/feeds (로컬 dev-server.py 또는 유료 Cloud Functions) 를 씁니다.
export const FEEDS_URL = '';

// ⑥ 운영자 계정 이메일 — 전체 공지 · 전체 팀 관리. firestore.rules 의 isAdmin() 과 같아야 함
//    이 이메일로 가입한 뒤 '이메일 인증'까지 마쳐야 운영자 권한이 열립니다 (남이 먼저 가입해도 인증 못 하면 권한 없음)
export const ADMIN_EMAILS = ['suyoung6780@gmail.com'];

// ⑦ 개인정보 처리방침 — 보호책임자 연락처 · 시행일 (바꾸면 처리방침 화면에 바로 반영)
export const PRIVACY = { officer: '유수영 (대표)', email: 'suyoung6780@gmail.com', effective: '2026-10-23' };

// ⑧ 파일 저장소(Cloud Storage) — Firebase Blaze 요금제에서만 켤 수 있음.
//    false: 분석실은 '내 컴퓨터 영상'으로 분석 + 유튜브 공유, 미팅룸은 자료 링크로 (무료)
//    true : 분석실 영상 · 미팅룸 파일을 서버에 올림 (Blaze + Storage 켠 뒤)
export const STORAGE_ENABLED = false;

export const isConfigured = !firebaseConfig.apiKey.startsWith('YOUR_');

// 소셜 로그인 (구글: Firebase 콘솔 › Authentication › Google 사용 설정 · 카카오: Vercel 환경 변수 KAKAO_REST_KEY + /api/kakao)
export const SOCIAL_LOGIN = { google: true, kakao: true };
