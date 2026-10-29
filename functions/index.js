const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const feeds = require('./feeds');

setGlobalOptions({ region: 'asia-northeast3' });

// 결제는 Vercel 서버 함수 api/pay.py (KG이니시스) 가 처리해요.

// 홈 "오늘의 축구 브리핑" 데이터 — Hosting 의 /api/feeds 로 연결됨 (firebase.json rewrites)
let feedCache = null;
exports.feeds = onRequest({ memory: '256MiB', timeoutSeconds: 30 }, async (req, res) => {
  if (!feedCache || Date.now() - feedCache.updatedAt > 10 * 60 * 1000) feedCache = await feeds.collect();
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  res.json(feedCache);
});
