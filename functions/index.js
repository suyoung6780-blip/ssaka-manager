const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const feeds = require('./feeds');

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

setGlobalOptions({ region: 'asia-northeast3' });

// 토스페이먼츠 시크릿 키 — `firebase functions:secrets:set TOSS_SECRET_KEY` 로 등록
const TOSS_SECRET_KEY = defineSecret('TOSS_SECRET_KEY');

// public/js/config.js 의 PLAN 과 같은 값이어야 합니다.
const PLAN_PRICE = 30000;
const PLAN_DAYS = 30;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O, 1/I 제외
const genCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

const PROFILE_KEYS = ['name', 'photo', 'position', 'number', 'height', 'weight', 'foot', 'birthYear'];

/**
 * 결제 승인 → 팀 활성화(이용기간 +30일) → 팀 코드 발급
 * 클라이언트는 토스 결제창 successUrl 로 받은 paymentKey/orderId/amount 를 넘깁니다.
 * orderId 형식: {teamId}-{timestamp}
 */
exports.confirmPayment = onCall({ secrets: [TOSS_SECRET_KEY] }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

  const { paymentKey, orderId, amount } = req.data || {};
  if (!paymentKey || !orderId) throw new HttpsError('invalid-argument', '결제 정보가 없습니다.');
  if (Number(amount) !== PLAN_PRICE) throw new HttpsError('invalid-argument', '결제 금액이 올바르지 않습니다.');

  const teamId = String(orderId).split('-')[0];
  const teamRef = db.doc(`teams/${teamId}`);
  const billingRef = teamRef.collection('private').doc('billing');
  const payRef = db.doc(`payments/${orderId}`);

  const team = await teamRef.get();
  if (!team.exists) throw new HttpsError('not-found', '팀을 찾을 수 없습니다.');
  if (team.data().ownerUid !== uid) throw new HttpsError('permission-denied', '팀 관리자만 결제할 수 있습니다.');

  // 이미 처리된 주문 (새로고침 등) → 기존 결과 반환
  if ((await payRef.get()).exists) {
    const b = (await billingRef.get()).data();
    return { code: b.code, paidUntil: b.paidUntil.toMillis() };
  }

  // 토스페이먼츠 결제 승인
  const res = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${TOSS_SECRET_KEY.value()}:`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ paymentKey, orderId, amount: PLAN_PRICE }),
  });
  const pay = await res.json();
  if (!res.ok) throw new HttpsError('failed-precondition', pay.message || '결제 승인에 실패했습니다.');

  return db.runTransaction(async (tx) => {
    const [teamSnap, billSnap, userSnap] = await Promise.all([
      tx.get(teamRef), tx.get(billingRef), tx.get(db.doc(`users/${uid}`)),
    ]);

    let code = billSnap.exists ? billSnap.data().code : null;
    for (let i = 0; !code && i < 20; i++) {
      const c = genCode();
      if (!(await tx.get(db.doc(`teamCodes/${c}`))).exists) code = c;
    }
    if (!code) throw new HttpsError('internal', '팀 코드 생성에 실패했습니다.');

    const current = teamSnap.data().paidUntil?.toMillis() || 0;
    const paidUntil = Timestamp.fromMillis(Math.max(Date.now(), current) + PLAN_DAYS * 86400000);
    const profile = userSnap.data() || {};

    tx.set(db.doc(`teamCodes/${code}`), { teamId });
    tx.update(teamRef, { status: 'active', paidUntil });
    tx.set(billingRef, { code, paidUntil, lastOrderId: orderId, lastPaidAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(payRef, {
      teamId, uid, amount: PLAN_PRICE, paymentKey, method: pay.method || '', approvedAt: pay.approvedAt || '',
      receiptUrl: pay.receipt?.url || '', createdAt: FieldValue.serverTimestamp(),
    });
    // 팀 생성자를 코치로 락커룸에 등록
    tx.set(teamRef.collection('members').doc(uid), {
      ...Object.fromEntries(PROFILE_KEYS.map((k) => [k, profile[k] || ''])),
      role: 'coach', joinedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(db.doc(`users/${uid}`), { teamId }, { merge: true });

    return { code, paidUntil: paidUntil.toMillis() };
  });
});

// 홈 "오늘의 축구 브리핑" 데이터 — Hosting 의 /api/feeds 로 연결됨 (firebase.json rewrites)
let feedCache = null;
exports.feeds = onRequest({ memory: '256MiB', timeoutSeconds: 30 }, async (req, res) => {
  if (!feedCache || Date.now() - feedCache.updatedAt > 10 * 60 * 1000) feedCache = await feeds.collect();
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  res.json(feedCache);
});
