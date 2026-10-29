// 시제품 3.0: 선수 홈 맨 위 — 내 선수 카드(OVR · 포지션 · 등번호 · 능력치 6개) + 내 시즌 요약
// 한 사람(UID) 기준으로 성장 평가 · 경기 기록 · 훈련일지 · 목표를 모아서 보여 줌 (점수는 코치가 확정한 것만)
import { db, collection, doc, getDoc, getDocs, query, where } from '../fb.js';
import { state } from '../store.js';
import { esc, avatar } from '../ui.js';
import { pct, pace } from '../pages/goals.js';
import * as I from './idp.js';
import { loadLinks } from './links.js';
import { buildDigest, digestHtml, bodyOf } from './digest.js';
import { seasonDue, seasonPopup } from './season.js';

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const LINE_L = { GK: '골키퍼', DF: '수비', MF: '미드필더', FW: '공격' };

export async function homePlayerHero(box) {
  if (!box) return;
  const uid = state.user.uid; const t = state.team.id;
  box.innerHTML = '<section class="ph-hero ph-skel"><div class="ph-card"></div><div class="ph-side"></div></section>';
  try {
    const [meS, idpS, roster, goalS] = await Promise.all([
      getDoc(doc(db, 'teams', t, 'members', uid)),
      getDocs(query(collection(db, 'teams', t, 'idp'), where('uid', '==', uid))),
      getDocs(collection(db, 'teams', t, 'members')),
      getDocs(query(collection(db, 'teams', t, 'goals'), where('ownerUid', '==', uid))).catch(() => ({ docs: [] })),
    ]);
    const me = meS.exists() ? meS.data() : {};
    const list = idpS.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.month < b.month ? -1 : 1));
    const conf = list.filter((d) => d.status === 'confirmed');
    const last = conf[conf.length - 1]; const prev = conf.filter((d) => d.pg === last?.pg)[conf.filter((d) => d.pg === last?.pg).length - 2];
    const pos = I.normPos(list.filter((d) => d.pos).pop()?.pos) || I.normPos(me.position);
    const pg = last?.pg || (pos ? I.POS_GROUP(pos) : '');
    const line = I.lineOf(pos, pg);
    const hex = I.hexOf(pg);
    const sc = last?.coach?.scores || {};
    const ovr = I.ovrOf(last); const ovr0 = I.ovrOf(prev);
    const ranked = hex.filter((a) => sc[a.id] != null).sort((a, b) => sc[b.id] - sc[a.id]);
    const players = roster.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.role === 'player');
    const links = await loadLinks(uid, players).catch(() => ({ logs: [], mres: [] }));
    const goals = goalS.docs.map((d) => ({ id: d.id, ...d.data() })).filter((g) => g.scope === 'personal');
    // 내 시즌 숫자
    const today = new Date(); const from = new Date(today); from.setDate(today.getDate() - 29);
    const f = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    const l30 = links.logs.filter((l) => l.date >= f);
    const cond = avg(l30.map((l) => l.condition).filter((v) => v != null));
    const yr = links.mres.filter((x) => (x.m.date || '').startsWith(String(today.getFullYear())));
    const G = yr.reduce((a, x) => a + x.g, 0); const A = yr.reduce((a, x) => a + x.a, 0);
    const doing = goals.filter((g) => (g.status || 'doing') === 'doing');
    const gp = doing.length ? Math.round(avg(doing.map(pct))) : null;
    const behind = doing.filter((g) => ['behind', 'late'].includes(pace(g).k)).length;
    const stat = (a) => (sc[a.id] != null ? I.stat(sc[a.id]) : null);
    const body = bodyOf(list, links.logs, me);
    const dg = buildDigest({ logs: links.logs, idpList: list, member: me });
    const bd = (v, u) => (v != null ? `${v}<i>${u}</i>` : '-');
    // 새해(1~3월): 올해 학년 · 등번호 확인 (번호가 바뀌면 지난 기록은 그때 번호로 남음)
    const askNum = seasonDue();
    box.innerHTML = `${askNum ? `<section class="card ph-season"><div><span class="eyebrow">NEW SEASON</span><b>${today.getFullYear()} 시즌 학년 · 등번호를 확인해 주세요</b>
        <small>지금 ${esc(me.grade || '학년 없음')} · ${me.number ? `${esc(me.number)}번` : '등번호 없음'} · 바뀌어도 지난 경기 · 영상 기록은 그때 번호로 남아요</small></div>
        <div class="row"><button type="button" class="btn sm" data-season>확인하기</button></div></section>` : ''}<section class="ph-hero">
      <a class="ph-card l-${line || 'none'}" href="#/idp" title="내 성장 카드 열기">
        <div class="ph-top">
          <div class="ph-ovr"><b>${ovr ?? '-'}</b><small>OVR</small></div>
          <div class="ph-pos"><b>${esc(pos || '-')}</b><small>${esc(LINE_L[line] || '')}</small></div>
          <div class="ph-num">${esc(me.number || '')}</div>
        </div>
        <div class="ph-face">${avatar(me.photo, me.name, 'xl')}</div>
        <div class="ph-name">${esc(me.name || '')}</div>
        <div class="ph-team">${esc(state.team?.name || '')}</div>
        <div class="ph-body"><span><small>키</small><b>${bd(body.h, 'cm')}</b></span><span><small>몸무게</small><b>${bd(body.w, 'kg')}</b></span>${body.dh ? `<span><small>${esc(I.ymLabel(body.since))}부터</small><b class="up">${body.dh > 0 ? '+' : ''}${body.dh}<i>cm</i></b></span>` : ''}</div>
        <div class="ph-stats">${hex.map((a) => `<div><b>${stat(a) ?? '-'}</b><small>${esc(a.s)}</small></div>`).join('')}</div>
        <div class="ph-foot">${last ? `${I.ymLabel(last.month)} 코치 확정` : '코치가 확정하면 OVR이 생겨요'}${ovr != null && ovr0 != null ? ` · <span class="${ovr - ovr0 > 0 ? 'up' : ovr - ovr0 < 0 ? 'down' : ''}">${ovr - ovr0 > 0 ? '▲' : ovr - ovr0 < 0 ? '▼' : '−'} ${Math.abs(ovr - ovr0)}</span>` : ''}</div>
      </a>
      <div class="ph-side">
        <div class="ph-h"><span>MY SEASON</span><b>${today.getFullYear()} 시즌 요약</b></div>
        <div class="ph-kpi">
          <a href="#/records"><strong>${G}</strong><small>득점</small></a>
          <a href="#/records"><strong>${A}</strong><small>도움</small></a>
          <a href="#/records"><strong>${yr.length}</strong><small>공격포인트 경기</small></a>
          <a href="#/daily"><strong>${l30.length}<i>/30</i></strong><small>훈련일지 (30일)</small></a>
          <a href="#/daily"><strong>${cond == null ? '-' : cond.toFixed(1)}<i>/5</i></strong><small>평균 컨디션</small></a>
          <a href="#/goals"><strong>${gp ?? '-'}<i>%</i></strong><small>목표 진행${behind ? ` · 뒤처짐 ${behind}` : ''}</small></a>
        </div>
        ${ranked.length ? `<div class="ph-sw"><div><small>강점</small><b>${esc(ranked[0].l)}</b><em>${stat(ranked[0])}</em></div><div><small>보완</small><b>${esc(ranked[ranked.length - 1].l)}</b><em>${stat(ranked[ranked.length - 1])}</em></div></div>` : ''}
        ${digestHtml(dg, { full: false, title: '최근 30일 자동 정리', sub: '내 일지 · 자기평가 · 코치 피드백을 모아 정리 — 적을수록 쌓여요' })}
        <div class="ph-acts"><a class="btn sm" href="#/daily">오늘 기록 쓰기</a><a class="btn ghost sm" href="#/idp" data-ss-go>시즌 기록 보기</a><a class="btn ghost sm" href="#/idp">내 성장 카드</a><a class="btn ghost sm" href="#/me">프로필</a></div>
      </div>
    </section>`;
    box.querySelector('[data-ss-go]')?.addEventListener('click', () => { try { sessionStorage.setItem('ssaka.idp.tab', 'season'); } catch { /* */ } });
    box.querySelector('[data-season]')?.addEventListener('click', () => seasonPopup({ always: true, onDone: () => box.querySelector('.ph-season')?.remove() }));
  } catch (e) { console.warn(e); box.innerHTML = ''; }
}
