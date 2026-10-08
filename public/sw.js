// 싸카매니저 서비스 워커 — '앱으로 설치'를 위해 필요. 화면은 항상 최신(네트워크 먼저)으로,
// 인터넷이 끊겼을 때만 안내 화면을 보여줌. (파일을 따로 저장해 두지 않아서 업데이트가 바로 반영됨)
const OFFLINE = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>싸카매니저</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0f0f;color:#f4f4f4;font-family:sans-serif;text-align:center">
<div><h1 style="font-weight:900;letter-spacing:-.03em">SSAKA MANAGER</h1><p>인터넷에 연결되어 있지 않아요.<br>연결된 뒤 다시 열어 주세요.</p>
<button onclick="location.reload()" style="padding:10px 18px;border-radius:8px;border:0;font-weight:700">다시 시도</button></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // 화면 이동만 처리, 나머지는 브라우저 기본
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
