// 수면 시간은 '분'으로 — 취침 · 기상 시간에서 계산 (예전 기록은 시간(sleep)을 분으로 바꿔서)
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
export function sleepMin(bed, wake) {
  if (!bed || !wake) return null;
  let diff = toMin(wake) - toMin(bed);
  if (diff <= 0) diff += 1440;
  return diff;
}
export const sleepOf = (l) => (l ? (l.sleepMin ?? sleepMin(l.bedtime, l.wakeTime) ?? (typeof l.sleep === 'number' ? Math.round(l.sleep * 60) : null)) : null);
export const fmtSleep = (m) => (m == null ? '-' : `${m}분`);
export const sleepLong = (m) => (m == null ? '-' : `${m}분 (${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''})`);
export const SHORT_SLEEP = 360; // 6시간 미만 = 주의
