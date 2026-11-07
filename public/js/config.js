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

// ② 결제: 포트원(PortOne V2) · KG이니시스 채널 — 서버 api/pay.py 가 Vercel 환경 변수
//    PORTONE_STORE_ID · PORTONE_CHANNEL_KEY · PORTONE_API_SECRET 을 읽음 (테스트 채널 → 심사 후 실연동 채널 키로 바꿈)
//    실연동 채널로 바꾸면 아래도 false 로 (결제 화면의 '테스트 모드' 안내가 사라짐)
export const PAY_TEST = true;

// ③ 요금제 — api/pay.py 의 PLANS 와 반드시 같은 값이어야 합니다 (서버가 금액을 다시 확인)
//    인원은 '승인된' 팀원 기준. 연 이용권 = 10개월 값으로 12개월 (365일)
export const PLANS = [
  { id: 'gaffer', name: '가퍼', sub: '지도자 1인', players: 0, coaches: 1, month: 14900, list: 21900, note: '선수 없이 지도자 혼자 — 작전판 · 훈련 프로그램 · 영상룸(선수 영상 · 경기 영상) · 게임모델 · 미팅룸 · 기록실 · 분석실 · 코치 · 스카웃 노트 · 커뮤니티' },
  { id: 'grassroots', name: '그래스루츠', sub: '레슨 · 소그룹', players: 10, coaches: 1, month: 19900, list: 28900 },
  { id: 'rising', name: '넌리그', sub: '작은 팀', players: 30, coaches: 3, month: 29900, list: 42900 },
  { id: 'pro', name: '챔피언십', sub: '가장 많이 써요', players: 50, coaches: 6, month: 44900, list: 64900, best: true },
  { id: 'champion', name: '프리미어', sub: '큰 팀', players: 80, coaches: 10, month: 59900, list: 85900 },
];
// 요금제 이름 — 영국 축구 단계: 원더키드(개인) · 가퍼(지도자 1인) → 그래스루츠(레슨) → 넌리그 → 챔피언십 → 프리미어 → 인빈시블 (id 는 그대로라 결제 기록과 상관없음)
export const WONDERKID = { id: 'wonderkid', name: '원더키드', sub: '개인 계정 · 보호자 1명 + 선수 1명', players: 1, coaches: 1, month: 9900, list: 14900, note: '영상룸(선수 영상) · 전술보드 · 기록실 · 데이터실 · 성장 평가 · 목표 · 내 일지' };
export const ALL_PLANS = [WONDERKID, ...PLANS]; // 이름 찾기용 (팀 요금제 고르기 · 추천에는 PLANS 만)
export const LEGEND = { name: '인빈시블', sub: '클럽 · 아카데미', players: '81명 이상', price: '99,900원부터 · 상담', list: '142,900원부터' };
// 출시 기념가 — month 가 지금 받는 기념가, list 는 정식 가격 (실제 할인이 모두 off% 이상이 되게 맞춤)
// 기념가로 가입한 팀은 연장해도 기념가 그대로. until 에 'YYYY-MM-DD' 를 넣으면 화면에 마감일이 나옴
export const LAUNCH = { off: 30, until: '2027-07-31' };
export const CYCLES = { month: { label: '1개월', days: 30, mult: 1 }, year: { label: '12개월', days: 365, mult: 10 } };
export const planPrice = (p, cycle) => p.month * CYCLES[cycle].mult;
// 새 팀 무료 체험 (팀을 만든 날부터) · 유료 전환 전에 만든 팀(free)의 무료 사용 마지막 날
export const TRIAL_DAYS = 14; // 한 아이디(이메일)당 한 번 — firestore.rules 의 14d 와 같게
export const FREE_UNTIL = '2026-11-23T00:00:00+09:00';

// ④ 무료 운영 모드 — true: 지금은 모든 팀 무료 (베타). 요금 안내 · 결제 화면 · 환불정책은 그대로 보이고 결제도 됨 (결제사 심사용)
//    false: 결제 사용 (새 팀은 체험 14일 뒤 결제 · 예전 팀은 FREE_UNTIL 까지 무료) — 바꾸기 30일 전에 회원에게 알리기
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
// 개인정보처리방침: 바꿀 때는 notice(공지일) · effective(시행일, 공지 7일 뒤) · changes(바뀌는 내용)를 같이 — 시행일 전까지 방침 맨 위 · 맨 아래 링크에 '개정 예정' 안내
export const PRIVACY = {
  officer: '유수영 (대표)', email: 'suyoung6780@gmail.com', effective: '2026-11-05', notice: '2026-10-29',
  changes: ['결제 처리 위탁 업체: 토스페이먼츠(주) → (주)케이지이니시스 · 코리아포트원 주식회사(포트원)', '유료 이용권 결제 때 구매자 휴대폰 번호를 받아요 (결제 확인 · 영수증 안내, 결제사에 전달)'],
};

// ⑧ 파일 저장소(Cloud Storage) — Firebase Blaze 요금제에서만 켤 수 있음.
//    false: 분석실은 '내 컴퓨터 영상'으로 분석 + 유튜브 공유, 미팅룸은 자료 링크로 (무료)
//    true : 분석실 영상 · 미팅룸 파일을 서버에 올림 (Blaze + Storage 켠 뒤)
export const STORAGE_ENABLED = false;

export const isConfigured = !firebaseConfig.apiKey.startsWith('YOUR_');

// 소셜 로그인 (구글: Firebase 콘솔 › Authentication › Google 사용 설정 · 카카오: Vercel 환경 변수 KAKAO_REST_KEY + /api/kakao)
export const SOCIAL_LOGIN = { google: true, kakao: true };
