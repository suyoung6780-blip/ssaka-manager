// 팀별 추가 기능 '컨디션 엑셀' — 자각도(RPE) · 훈련 시간 · 수면 시간 · 수면 질을 기간별 엑셀(.xlsx)로
// 운영자가 전체 팀 → 기능 에서 켠 팀에만 보임 (system/features 문서)
import { db, collection, query, where, orderBy, getDocs } from './fb.js';
import { esc, toast, fail, modal, todayStr } from './ui.js';
import { state } from './store.js';

export const SLEEP_Q = ['', '매우 나쁨', '나쁨', '보통', '좋음', '매우 좋음'];
const XLSX_JS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const loadXlsx = () => new Promise((res, rej) => {
  if (window.XLSX) { res(); return; }
  const sc = document.createElement('script');
  sc.src = XLSX_JS; sc.onload = res; sc.onerror = () => rej(new Error('엑셀 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));
  document.head.appendChild(sc);
});
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const days = (from, to) => { const out = []; for (let d = new Date(`${from}T00:00`); ymd(d) <= to; d.setDate(d.getDate() + 1)) out.push(ymd(d)); return out; };
const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '');

export function exportModal() {
  const t = new Date();
  const pre = {
    '최근 7일': [ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6)), ymd(t)],
    '이번 달': [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)],
    '지난 달': [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))],
  };
  const m = modal(`<span class="eyebrow">EXCEL</span><h2>컨디션 엑셀 받기</h2>
    <p class="muted">선수 전체의 <b>자각도(RPE) · 훈련 시간 · 훈련 부하 · 수면 시간 · 수면 질</b>을 기간별 엑셀 파일로 받아요.</p>
    <div class="chips wrap">${Object.keys(pre).map((k) => `<button type="button" class="chip" data-pre="${k}">${k}</button>`).join('')}</div>
    <form class="stack"><div class="grid2">
      <label>시작일<input type="date" name="from" required value="${pre['최근 7일'][0]}" max="${todayStr()}"></label>
      <label>종료일<input type="date" name="to" required value="${pre['최근 7일'][1]}" max="${todayStr()}"></label></div>
      <p class="muted small">시트: 기록(날짜별 전체) · 선수별 평균 · 자각도 · 훈련시간 · 훈련부하 · 수면시간 · 수면질 (선수 × 날짜 표)</p>
      <div class="row end"><button class="btn">엑셀 받기</button></div></form>`);
  const f = m.el.querySelector('form');
  m.el.querySelectorAll('[data-pre]').forEach((b) => (b.onclick = () => { [f.from.value, f.to.value] = pre[b.dataset.pre]; }));
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (f.from.value > f.to.value) return toast('시작일이 종료일보다 늦어요.');
    if (days(f.from.value, f.to.value).length > 370) return toast('한 번에 1년까지 받을 수 있어요.');
    const btn = f.querySelector('.btn'); btn.disabled = true; btn.textContent = '만드는 중…';
    try { await makeExcel(f.from.value, f.to.value); m.close(); } catch (err) { fail(err); btn.disabled = false; btn.textContent = '엑셀 받기'; }
  };
}

async function makeExcel(from, to) {
  const tid = state.team.id;
  const [ms, ls] = await Promise.all([
    getDocs(collection(db, 'teams', tid, 'members')),
    getDocs(query(collection(db, 'teams', tid, 'logs'), where('date', '>=', from), where('date', '<=', to), orderBy('date'))),
    loadXlsx(),
  ]);
  const players = ms.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.role === 'player' && p.approved !== false)
    .sort((a, b) => (+a.number || 99) - (+b.number || 99) || String(a.name).localeCompare(b.name, 'ko'));
  const logs = ls.docs.map((d) => d.data()).filter((l) => players.some((p) => p.id === l.uid));
  const byKey = Object.fromEntries(logs.map((l) => [`${l.uid}_${l.date}`, l]));
  const load = (l) => (l.rpe && l.trainMin ? l.rpe * l.trainMin : '');
  const X = window.XLSX;
  const wb = X.utils.book_new();
  const sheet = (name, rows, widths) => { const ws = X.utils.aoa_to_sheet(rows); ws['!cols'] = widths.map((w) => ({ wch: w })); X.utils.book_append_sheet(wb, ws, name); };

  // 1) 기록: 날짜별 한 줄
  const nameOf = (uid) => players.find((p) => p.id === uid);
  sheet('기록', [
    ['날짜', '이름', '등번호', '포지션', '자각도(RPE 1~10)', '훈련 시간(분)', '훈련 부하(RPE×분)', '취침', '기상', '수면 시간(시간)', '수면 질(1~5)', '컨디션(1~5)', '통증(0~10)', '통증 부위', '제출'],
    ...logs.map((l) => { const p = nameOf(l.uid); return [l.date, p?.name || l.name, p?.number || '', p?.position || '', l.rpe || '', l.trainMin ?? '', load(l), l.bedtime || '', l.wakeTime || '', l.sleep ?? '', l.sleepQ || '', l.condition || '', l.injury ?? '', l.injuryPart || '', l.submitted ? 'O' : '작성 중']; }),
  ], [11, 10, 7, 8, 15, 13, 17, 7, 7, 14, 12, 11, 11, 12, 8]);

  // 2) 선수별 평균 (기록이 없는 선수도 포함)
  sheet('선수별 평균', [
    ['이름', '등번호', '포지션', '기록한 날', '평균 자각도', '총 훈련 시간(분)', '총 훈련 부하', '평균 수면 시간', '평균 수면 질', '평균 컨디션'],
    ...players.map((p) => {
      const mine = logs.filter((l) => l.uid === p.id);
      const nums = (k) => mine.map((l) => l[k]).filter((v) => typeof v === 'number' && !Number.isNaN(v));
      return [p.name, p.number || '', p.position || '', mine.length, avg(nums('rpe')), nums('trainMin').reduce((a, b) => a + b, 0) || '',
        mine.map(load).filter(Boolean).reduce((a, b) => a + b, 0) || '', avg(nums('sleep')), avg(nums('sleepQ')), avg(nums('condition'))];
    }),
  ], [10, 7, 8, 10, 11, 15, 13, 14, 12, 11]);

  // 3~7) 선수 × 날짜 표 (전체 인원)
  const dates = days(from, to);
  const grid = (name, get) => sheet(name, [
    ['이름', '등번호', ...dates.map((d) => d.slice(5).replace('-', '/'))],
    ...players.map((p) => [p.name, p.number || '', ...dates.map((d) => { const l = byKey[`${p.id}_${d}`]; const v = l ? get(l) : ''; return v ?? ''; })]),
  ], [10, 7, ...dates.map(() => 6)]);
  grid('자각도', (l) => l.rpe || '');
  grid('훈련시간', (l) => l.trainMin ?? '');
  grid('훈련부하', load);
  grid('수면시간', (l) => l.sleep ?? '');
  grid('수면질', (l) => l.sleepQ || '');

  const file = `${(state.team.name || 'team').replace(/[\\/:*?"<>|]/g, '')}_컨디션_${from}~${to}.xlsx`;
  X.writeFile(wb, file);
  toast(`엑셀을 저장했어요 — 선수 ${players.length}명 · 기록 ${logs.length}개`);
}

// 오늘 기록에 들어가는 칸 (기능이 켜진 팀만)
export function dailyFields(l, planMin) {
  return `<div class="grid2 wellness-fields">
      <label>훈련 시간 <small class="muted">(분)</small><input type="number" name="trainMin" min="0" max="600" step="5" inputmode="numeric" value="${esc(l.trainMin ?? (planMin || ''))}" placeholder="예) 90"></label>
    </div>
    <h4>수면 질 <small class="muted">어젯밤 얼마나 푹 잤나요?</small></h4>`;
}
