// 팀별 추가 기능 '컨디션 엑셀' — 자각도(RPE) · 훈련 시간 · 수면 시간 · 수면 질을 기간별 엑셀(.xlsx)로
// 운영자가 전체 팀 → 기능 에서 켠 팀에만 보임 (system/features 문서)
import { db, collection, query, where, orderBy, getDocs } from './fb.js';
import { esc, toast, fail, modal, todayStr } from './ui.js';
import { state } from './store.js';
import { sleepOf } from './sleep.js';

export const SLEEP_Q = ['', '매우 나쁨', '나쁨', '보통', '좋음', '매우 좋음'];
// 칸 색 · 글꼴까지 넣을 수 있는 엑셀 도구 (SheetJS 와 같은 사용법)
const XLSX_JS = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
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
      <p class="muted small">첫 시트 <b>설문지 응답</b>: 타임스탬프 · 이름 · 수면시간(분) · 수면질 체크 · 운동강도 · 운동시간(분) · 불참 사유 (· 키 · 몸무게)<br>그 밖에: 기록 · 선수별 평균 · 선수 × 날짜 표</p>
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

  const nameOf = (uid) => players.find((p) => p.id === uid);
  // 0) 설문지 응답: 구글 설문 응답 시트와 같은 모양 (제출한 기록을 제출 시각 순으로)
  const tsOf = (l) => (l.submittedAt?.toDate ? l.submittedAt.toDate() : l.updatedAt?.toDate ? l.updatedAt.toDate() : null);
  const fmtTs = (d) => {
    if (!d) return '';
    const h = d.getHours(); const ap = h < 12 ? '오전' : '오후'; const h12 = h % 12 || 12;
    return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()} ${ap} ${h12}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };
  const resp = logs.filter((l) => l.submitted).sort((a, b) => (tsOf(a)?.getTime() || 0) - (tsOf(b)?.getTime() || 0) || a.date.localeCompare(b.date));
  const withBody = resp.some((l) => l.height || l.weight);
  const head = ['타임스탬프', '이름', '수면시간', '수면질 체크', '운동강도', '운동시간', '불참 사유', ...(withBody ? ['키(cm)', '몸무게(kg)'] : [])];
  const rows = resp.map((l) => {
    const p = nameOf(l.uid);
    return [fmtTs(tsOf(l)) || l.date, p?.name || l.name, sleepOf(l) ?? '', l.sleepQ ?? '', l.absent ? 0 : (l.rpe ?? ''), l.absent ? 0 : (l.trainMin ?? ''), l.absent ? (l.absentReason || '불참') : '',
      ...(withBody ? [l.height ?? '', l.weight ?? ''] : [])];
  });
  {
    const ws = X.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = [24, 10, 10, 11, 10, 10, 20, ...(withBody ? [9, 11] : [])].map((w) => ({ wch: w }));
    ws['!rows'] = [{ hpt: 24 }];
    ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: head.length - 1 } }) };
    const line = { style: 'thin', color: { rgb: 'D9D6E3' } };
    for (let c = 0; c < head.length; c++) {
      const hc = ws[X.utils.encode_cell({ r: 0, c })];
      hc.s = { fill: { fgColor: { rgb: '5B3E8F' } }, font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 }, alignment: { vertical: 'center' }, border: { bottom: line } };
      for (let r = 1; r <= rows.length; r++) {
        const cell = ws[X.utils.encode_cell({ r, c })];
        if (!cell) continue;
        cell.s = { fill: { fgColor: { rgb: r % 2 ? 'FFFFFF' : 'F3F2F7' } }, font: { sz: 10 }, border: { bottom: line }, alignment: { vertical: 'center', horizontal: typeof cell.v === 'number' ? 'right' : 'left' } };
      }
    }
    X.utils.book_append_sheet(wb, ws, '설문지 응답');
  }

  // 1) 기록: 날짜별 한 줄
  sheet('기록', [
    ['날짜', '이름', '등번호', '포지션', '자각도(RPE 1~10)', '훈련 시간(분)', '훈련 부하(RPE×분)', '취침', '기상', '수면 시간(분)', '수면 질(1~5)', '컨디션(1~5)', '통증(0~10)', '통증 부위', '제출'],
    ...logs.map((l) => { const p = nameOf(l.uid); return [l.date, p?.name || l.name, p?.number || '', p?.position || '', l.rpe || '', l.trainMin ?? '', load(l), l.bedtime || '', l.wakeTime || '', sleepOf(l) ?? '', l.sleepQ || '', l.condition || '', l.injury ?? '', l.injuryPart || '', l.submitted ? 'O' : '작성 중']; }),
  ], [11, 10, 7, 8, 15, 13, 17, 7, 7, 14, 12, 11, 11, 12, 8]);

  // 2) 선수별 평균 (기록이 없는 선수도 포함)
  sheet('선수별 평균', [
    ['이름', '등번호', '포지션', '기록한 날', '평균 자각도', '총 훈련 시간(분)', '총 훈련 부하', '평균 수면 시간(분)', '평균 수면 질', '평균 컨디션'],
    ...players.map((p) => {
      const mine = logs.filter((l) => l.uid === p.id);
      const nums = (k) => mine.map((l) => l[k]).filter((v) => typeof v === 'number' && !Number.isNaN(v));
      return [p.name, p.number || '', p.position || '', mine.length, avg(nums('rpe')), nums('trainMin').reduce((a, b) => a + b, 0) || '',
        mine.map(load).filter(Boolean).reduce((a, b) => a + b, 0) || '', avg(mine.map(sleepOf).filter((v) => v != null)), avg(nums('sleepQ')), avg(nums('condition'))];
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
  grid('수면시간(분)', (l) => sleepOf(l) ?? '');
  grid('수면질', (l) => l.sleepQ || '');

  const file = `${(state.team.name || 'team').replace(/[\\/:*?"<>|]/g, '')}_컨디션_${from}~${to}.xlsx`;
  X.writeFile(wb, file);
  toast(`엑셀을 저장했어요 — 선수 ${players.length}명 · 기록 ${logs.length}개`);
}

// 오늘 기록에 들어가는 칸 (기능이 켜진 팀만)
// needHeight: 이번 달 첫 기록(아직 키를 안 적음) · needWeight: 이번 주(월요일 시작) 첫 기록
export function dailyFields(l, planMin, { needHeight = false, needWeight = false } = {}) {
  return `<div class="grid2 wellness-fields">
      <label>훈련 시간 <small class="muted">(분)</small><input type="number" name="trainMin" min="0" max="600" step="5" inputmode="numeric" value="${esc(l.trainMin ?? (planMin || ''))}" placeholder="예) 90" ${l.absent ? 'disabled' : ''}></label>
      ${needHeight || l.height ? `<label>키 <small class="muted">(cm · 이번 달 첫 기록)</small><input type="number" name="height" min="100" max="230" step="0.1" inputmode="decimal" value="${esc(l.height ?? '')}" placeholder="예) 165.4"></label>` : ''}
      ${needWeight || l.weight ? `<label>몸무게 <small class="muted">(kg · 이번 주 첫 기록)</small><input type="number" name="weight" min="20" max="150" step="0.1" inputmode="decimal" value="${esc(l.weight ?? '')}" placeholder="예) 52.3"></label>` : ''}
    </div>
    <label class="mini-switch wellness-absent"><input type="checkbox" name="absent" ${l.absent ? 'checked' : ''} data-absent> 오늘 운동 불참 <small class="muted">(운동강도 · 운동시간은 0으로)</small></label>
    <label data-absent-why ${l.absent ? '' : 'hidden'}>불참 사유<input name="absentReason" maxlength="60" value="${esc(l.absentReason || '')}" placeholder="예) 휴식 · 오른쪽 무릎 골절 · 개인사정"></label>
    <h4>수면 질 <small class="muted">어젯밤 얼마나 푹 잤나요?</small></h4>`;
}
