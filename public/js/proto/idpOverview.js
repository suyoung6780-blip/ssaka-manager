// 시제품 3.0: 성장 평가 '한눈에' — 모든 선수의 OVR · 이번 달 자기평가 · 몸 기록 · 일지 · 컨디션 · 자동 정리 한 줄을 데이터실처럼 한 화면에
import { db, collection, getDocs } from '../fb.js';
import { state } from '../store.js';
import { esc } from '../ui.js';
import * as I from './idp.js';
import { matchesOf } from './links.js';
import { buildDigest } from './digest.js';

const LV = { bad: ['먼저 볼 선수', 'bad'], warn: ['살펴볼 선수', 'warn'], ok: ['좋아요', 'ok'], none: ['기록 부족', 'none'] };

export async function loadTeamLogs() {
  const t = state.team.id;
  const [ls, ms] = await Promise.all([getDocs(collection(db, 'teams', t, 'logs')).catch(() => null), getDocs(collection(db, 'teams', t, 'matches')).catch(() => null)]);
  return { logs: ls ? ls.docs.map((d) => d.data()) : [], matches: ms ? ms.docs.map((d) => ({ id: d.id, ...d.data() })) : [] };
}

// rows: 선수마다 한눈에 볼 숫자 · 상태 · 이유
export function overviewRows(players, all, { logs, matches }, ym) {
  const yr = String(new Date().getFullYear());
  return players.map((p) => {
    const list = all.filter((d) => d.uid === p.id).sort((a, b) => (a.month < b.month ? -1 : 1));
    const conf = list.filter((d) => d.status === 'confirmed');
    const last = conf[conf.length - 1]; const prev = conf.filter((d) => d.pg === last?.pg).slice(-2)[0];
    const ovr = I.ovrOf(last); const o0 = prev && prev !== last ? I.ovrOf(prev) : null;
    const d = list.find((x) => x.month === ym); const st = d?.status || 'none';
    const fl = st === 'submitted' ? I.flagsOf(d, conf.filter((x) => x.month < ym).pop()) : null;
    const myLogs = logs.filter((l) => l.uid === p.id).sort((a, b) => (a.date < b.date ? -1 : 1));
    const dg = buildDigest({ logs: myLogs, idpList: list, member: p });
    const mr = matchesOf(matches, p.id, players).filter((x) => (x.m.date || '').startsWith(yr));
    const G = mr.reduce((a, x) => a + x.g, 0); const A = mr.reduce((a, x) => a + x.a, 0);
    const pos = I.normPos(list.filter((x) => x.pos).pop()?.pos) || I.normPos(p.position);
    const line = I.lineOf(pos, last?.pg || (pos ? I.POS_GROUP(pos) : ''));
    // 왜 봐야 하는지 (먼저 볼 것부터)
    const why = []; let lv = 'ok';
    const up = (l) => { if (l === 'bad' || (l === 'warn' && lv !== 'bad')) lv = l; };
    if (st === 'submitted') { why.push(fl?.n ? `자기평가 검토 · 확인할 답 ${fl.n}개` : '자기평가 검토 대기'); up(fl?.n ? 'bad' : 'warn'); }
    if (dg.hurts) { why.push(`아프다고 적은 날 ${dg.hurts}일`); up('bad'); }
    if (ovr != null && o0 != null && ovr - o0 <= -5) { why.push(`OVR ${ovr - o0} 내려감`); up('bad'); }
    if (dg.condC != null && dg.condP != null && dg.condC - dg.condP <= -0.5) { why.push(`컨디션 ${(dg.condC - dg.condP).toFixed(1)}`); up('warn'); }
    if (st === 'none' || st === 'draft') { why.push(st === 'draft' ? '자기평가 작성 중' : '자기평가 안 씀'); up('warn'); }
    if (dg.logs < 8) { why.push(`최근 30일 일지 ${dg.logs}번`); if (!dg.logs && ovr == null) lv = lv === 'ok' ? 'none' : lv; else up('warn'); }
    if (ovr != null && o0 != null && ovr - o0 >= 5) why.push(`OVR +${ovr - o0} 올라감`);
    return { p, pos, line, ovr, o0, st, fl, dg, G, A, body: dg.body, lv, why, last };
  }).sort((a, b) => ['bad', 'warn', 'ok', 'none'].indexOf(a.lv) - ['bad', 'warn', 'ok', 'none'].indexOf(b.lv) || (+a.p.number || 99) - (+b.p.number || 99));
}

export function overviewHtml(rows, ym, filter = 'all', view = 'card', cards = null) {
  const n = (f) => rows.filter(f).length;
  const ovrs = rows.map((r) => r.ovr).filter((v) => v != null);
  const teamOvr = ovrs.length ? Math.round(ovrs.reduce((a, x) => a + x, 0) / ovrs.length) : null;
  const sub = n((r) => r.st === 'submitted' || r.st === 'confirmed');
  const F = [['all', '전체', rows.length], ['bad', '먼저 볼 선수', n((r) => r.lv === 'bad')], ['review', '검토 대기', n((r) => r.st === 'submitted')], ['miss', '안 씀', n((r) => r.st === 'none' || r.st === 'draft')], ['hurt', '아픈 선수', n((r) => r.dg.hurts)]];
  const pass = (r) => filter === 'all' || (filter === 'bad' && r.lv === 'bad') || (filter === 'review' && r.st === 'submitted') || (filter === 'miss' && (r.st === 'none' || r.st === 'draft')) || (filter === 'hurt' && r.dg.hurts);
  const shown = rows.filter(pass);
  // 줄별 평균 OVR (골키퍼 · 수비 · 미드 · 공격)
  const LN = I.LINES.map(([k, l]) => { const v = rows.filter((r) => r.line === k && r.ovr != null).map((r) => r.ovr); return { k, l, n: rows.filter((r) => r.line === k).length, v: v.length ? Math.round(v.reduce((a, x) => a + x, 0) / v.length) : null }; });
  const ST = { none: ['안 씀', 'miss'], draft: ['작성 중', 'draft'], submitted: ['검토 대기', 'wait'], confirmed: ['확정', 'done'] };
  return `<section class="card p3-card ov-top">
      <div class="ov-h"><div><span>GROWTH OVERVIEW</span><b>${I.ymLabel(ym)} 한눈에 보기</b><small>성장 평가 · 훈련일지 · 경기 기록 · 몸 기록을 선수마다 모았어요 · 먼저 볼 선수부터</small></div>
        <div class="ov-k">
          <div class="k-ok"><strong>${teamOvr ?? '-'}</strong><small>팀 OVR</small></div>
          <div><strong>${sub}<i>/${rows.length}</i></strong><small>자기평가 제출</small></div>
          <div class="k-warn"><strong>${n((r) => r.st === 'submitted')}</strong><small>검토 대기</small></div>
          <div class="k-bad"><strong>${n((r) => r.lv === 'bad')}</strong><small>먼저 볼 선수</small></div>
        </div></div>
      <div class="ov-lines">${LN.map((x) => `<span class="l-${x.k}"><i></i>${esc(x.l)} <b>${x.v ?? '-'}</b><small>${x.n}명</small></span>`).join('')}</div>
      <div class="ov-bar"><div class="seg ov-view"><button type="button" class="${view === 'card' ? 'on' : ''}" data-ovv="card">선수 카드</button><button type="button" class="${view === 'need' ? 'on' : ''}" data-ovv="need">먼저 볼 순서</button></div>
      <div class="ov-f">${F.map(([k, l, c]) => `<button type="button" class="chip ${filter === k ? 'on' : ''}" data-ovf="${k}">${l} <b>${c}</b></button>`).join('')}</div></div>
    </section>
    ${view === 'card' && cards ? cards(shown) : view === 'line'
    ? I.LINES.map(([k, l]) => { const g = shown.filter((r) => r.line === k).sort((x, y) => (y.ovr ?? -1) - (x.ovr ?? -1)); return g.length ? `<h4 class="ov-gh l-${k}"><i></i>${esc(l)} <small>${g.length}명</small></h4><div class="ov-grid">${g.map(card).join('')}</div>` : ''; }).join('') + (shown.some((r) => !r.line) ? `<h4 class="ov-gh"><i></i>포지션 없음</h4><div class="ov-grid">${shown.filter((r) => !r.line).map(card).join('')}</div>` : '')
    : `<div class="ov-grid">${shown.map(card).join('') || '<p class="muted">해당하는 선수가 없어요.</p>'}</div>`}`;
  function card(r) {
      const d = r.ovr != null && r.o0 != null ? r.ovr - r.o0 : null;
      return `<a class="ov-card lv-${r.lv} l-${r.line || 'none'}" href="#/idp/${esc(r.p.id)}">
        <div class="ov-c-h"><span class="ov-num">${esc(r.p.number || '')}</span><b>${esc(r.p.name || '')}</b><small>${esc(r.pos || '')}</small><span class="ov-tag t-${LV[r.lv][1]}">${LV[r.lv][0]}</span></div>
        <div class="ov-c-k">
          <div><small>OVR</small><strong>${r.ovr ?? '-'}</strong>${d != null ? `<em class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d}</em>` : ''}</div>
          <div><small>${I.ymLabel(ym)}</small><span class="ov-st s-${ST[r.st][1]}">${ST[r.st][0]}</span></div>
          <div><small>일지 30일</small><strong>${r.dg.logs}</strong></div>
          <div><small>컨디션</small><strong>${r.dg.condC == null ? '-' : r.dg.condC.toFixed(1)}</strong></div>
          <div><small>키 · 몸무게</small><strong class="sm">${r.body.h ?? '-'}<i>cm</i> ${r.body.w ?? '-'}<i>kg</i></strong></div>
          <div><small>득점 · 도움</small><strong class="sm">${r.G} · ${r.A}</strong></div>
        </div>
        <p class="ov-why">${r.why.length ? r.why.slice(0, 2).map(esc).join(' · ') : '특이 사항 없어요'}</p>
        ${r.dg.kwHard.length ? `<p class="ov-kw">어려워한 것 <b>${r.dg.kwHard.slice(0, 2).map((x) => esc(x.w)).join(' · ')}</b></p>` : ''}
      </a>`; }

}
