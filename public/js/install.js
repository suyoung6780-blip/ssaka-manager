// '앱으로 설치' — 안드로이드 · PC 크롬/엣지는 바로 설치 창, 아이폰 · 맥 사파리는 따라 하기 안내
import { modal, toast } from './ui.js';

let deferred = null; // 브라우저가 준 설치 기회 (크롬 · 엣지 · 삼성 인터넷)
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
window.addEventListener('appinstalled', () => { deferred = null; toast('싸카매니저 앱을 설치했어요!'); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // 아이패드도
const isAndroid = /Android/.test(ua);
const isSafariMac = /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua) && !isIOS;
const isSamsung = /SamsungBrowser/.test(ua);

export function installButton(cls = 'link-btn small') {
  return isStandalone() ? '' : `<button type="button" class="${cls}" data-install>📲 앱으로 설치하기</button>`;
}
export function bindInstall(root) {
  root.querySelectorAll('[data-install]').forEach((b) => (b.onclick = installApp));
}

export async function installApp() {
  if (isStandalone()) return toast('이미 앱으로 열려 있어요.');
  if (deferred) {
    deferred.prompt();
    const r = await deferred.userChoice.catch(() => null);
    deferred = null;
    if (r?.outcome === 'accepted') toast('설치하고 있어요. 홈 화면(바탕화면)에서 싸카매니저를 찾아보세요.');
    return;
  }
  const steps = isIOS ? [
    '<b>사파리</b>로 이 홈페이지를 열어요 (카톡 안에서 열었다면 오른쪽 아래 ⋯ → <b>다른 브라우저로 열기</b>)',
    '아래쪽(아이패드는 위쪽) <b>공유 버튼 □↑</b>을 눌러요',
    '목록을 내려서 <b>홈 화면에 추가</b>를 눌러요',
    '오른쪽 위 <b>추가</b>를 누르면 홈 화면에 싸카매니저 아이콘이 생겨요',
  ] : isAndroid ? [
    isSamsung ? '<b>삼성 인터넷</b> 아래 메뉴(≡) → <b>현재 페이지 추가</b> → <b>홈 화면</b>' : '<b>크롬</b> 오른쪽 위 메뉴(⋮)를 눌러요',
    isSamsung ? '홈 화면에 생긴 싸카매니저 아이콘으로 열면 돼요' : '<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러요',
    '카톡 안에서 열었다면 오른쪽 위 ⋮ → <b>다른 브라우저로 열기</b>(크롬) 후 다시 해 주세요',
  ] : isSafariMac ? [
    '사파리 위쪽 메뉴 <b>파일</b>을 눌러요',
    '<b>Dock에 추가…</b>를 누르고 <b>추가</b>를 눌러요 (macOS Sonoma 이상)',
    'Dock과 응용 프로그램에 싸카매니저가 생겨요',
  ] : [
    '<b>크롬</b>: 주소창 오른쪽의 <b>설치 아이콘(⊕ 모니터 모양)</b>을 누르거나, 메뉴(⋮) → <b>저장 및 공유</b> → <b>페이지를 앱으로 설치</b>',
    '<b>엣지</b>: 메뉴(⋯) → <b>앱</b> → <b>이 사이트를 앱으로 설치</b>',
    '설치하면 바탕화면 · 시작 메뉴(독)에서 싸카매니저를 앱처럼 열 수 있어요',
  ];
  const m = modal(`<span class="eyebrow">INSTALL APP</span><h2>싸카매니저를 앱처럼 설치하기</h2>
    <p class="muted">${isIOS ? '아이폰 · 아이패드' : isAndroid ? '안드로이드 휴대폰' : isSafariMac ? '맥 (사파리)' : '컴퓨터'}에서는 이렇게 해 주세요.</p>
    <ol class="guide-steps">${steps.map((x) => `<li>${x}</li>`).join('')}</ol>
    <p class="muted small">설치해도 용량은 거의 없고, 홈페이지가 바뀌면 앱도 자동으로 최신이 돼요.</p>
    <div class="row end"><button class="btn" data-ok>확인</button></div>`);
  m.el.querySelector('[data-ok]').onclick = m.close;
}
