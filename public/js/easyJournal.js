// 휴대폰 쉬운 쓰기: 오늘 기록(훈련 일지)을 한 장에 질문 하나씩 넘기며 쓰기
// 원래 일지 칸을 그대로 쓰고 지금 장에 해당하는 칸만 보여 줌 → 저장 · 제출 · 검사 · 작전판은 personal.js 그대로
import { esc } from './ui.js';

const PHONE = '(max-width: 700px)';
const OFF = 'ssaka-ez-off'; // 전체 보기를 고른 사람 (이 기기에서 기억)
const POS = (d) => `ssaka-ez-step:${d}`;
const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* */ } } };
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* */ } } };

// 눌러서 고르기 (글 칸에 그대로 이어 씀 — 코치님이 받는 일지는 똑같은 글)
const CHIPS = {
  good: ['첫 터치', '패스 정확도', '압박 벗어나기', '위치 잡기', '말로 소통', '수비 전환', '슈팅', '끝까지 뛰기'],
  hard: ['압박 올 때', '약한 발', '공 없을 때 움직임', '빠른 판단', '체력', '1대1 수비'],
  part: ['발목', '무릎', '허벅지 뒤', '허벅지 앞', '종아리', '허리', '손 · 손가락', '머리'],
};
const MIC = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const Speech = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export function mountEasy(el, form, o) {
  if (!window.matchMedia?.(PHONE).matches) return;
  const kindNow = () => form.querySelector('[name=kind]:checked')?.value || 'train';
  const fire = () => form.dispatchEvent(new Event('input', { bubbles: true }));

  // 전체 보기 ↔ 쉬운 쓰기 바꾸는 줄 (늘 맨 위)
  const sw = document.createElement('div');
  sw.className = 'ez-switch';
  el.querySelector('.page-head')?.after(sw);
  const drawSwitch = () => {
    const on = el.classList.contains('ez');
    sw.innerHTML = on ? '' : '<span>휴대폰에서는 한 장씩 쓰는 게 편해요</span><button type="button" class="btn sm" data-ez-on>쉬운 쓰기로</button>';
    sw.querySelector('[data-ez-on]')?.addEventListener('click', () => { ls.set(OFF, null); start(); });
  };

  const top = document.createElement('div'); top.className = 'ez-top';
  const nav = document.createElement('div'); nav.className = 'ez-nav';
  let steps = []; let i = 0;

  // 지금 일지에 맞는 장 목록 (훈련 수 · 다쳤는지에 따라 달라짐)
  const build = () => {
    const has = (k) => !!form.querySelector(`[data-ez="${k}"]`);
    const out = [
      { id: 'cond', q: '오늘 몸 상태는 어때요?' },
      { id: 'sleep', q: '어젯밤 몇 시에 자고, 몇 시에 일어났어요?' },
      ...(has('well') ? [{ id: 'well', q: '운동 시간 · 잠은 어땠어요?' }] : []),
      { id: 'hurt', q: '오늘 다친 곳이 있나요?' },
      ...(form.querySelector('[data-rpe-box]')?.hidden ? [] : [{ id: 'rpe', q: `오늘 ${kindNow() === 'match' ? '경기' : '훈련'}, 얼마나 힘들었어요?` }]),
    ];
    if (kindNow() === 'match') { // 경기 일지
      const played = form.querySelector('[name=m_played]:checked')?.value;
      out.push({ id: 'mplay', q: '오늘 경기에 뛰었어요?', sub: '안 뛰었으면 밖에서 본 장면을 적어요.' });
      if (played !== 'no') {
        out.push({ id: 'mmin', q: '몇 분 뛰었어요?', sub: '다 뛰었으면 [다 뛰었어요], 안 뛴 쪽은 [0분]을 눌러요.' });
        if (has('mgoal')) out.push({ id: 'mgoal', q: '골 · 도움 · 실점을 적어요', sub: '없으면 그냥 다음으로 넘어가요.' });
        out.push({ id: 'mrate', q: '오늘 경기에서 나는 몇 점?' });
      }
      const sc = [...form.querySelectorAll('[data-scenes] .mj-scene')];
      sc.forEach((c, n) => {
        const k = c.dataset.skey; const no = `${n + 1}번 장면 · `;
        out.push(
          { id: `c:${k}:pad`, card: c, part: 'pad', q: `${no}기억나는 장면을 그려요`, sub: '장면 이름을 적고 [장면 추가]를 눌러 그려요.' },
          { id: `c:${k}:note`, card: c, part: 'note', q: `${no}${played === 'no' ? '밖에서 보니 어땠어요?' : '그때 어땠어요?'}` },
          { id: `c:${k}:ask`, card: c, part: 'ask', q: `${no}코치님께 묻고 싶은 게 있나요?`, sub: '없으면 그냥 다음으로 넘어가요.', last: n === sc.length - 1, scene: true },
        );
      });
      out.push(played === 'no' ? { id: 'mfelt', q: '경기를 보며 느낀 점은?' } : { id: 'mwrap', q: '오늘 경기를 정리해요' });
      out.push({ id: 'send', q: '다 썼어요! 확인하고 보내요' });
      return out;
    }
    const cards = [...form.querySelectorAll('[data-mysess] .sess.mine')];
    cards.forEach((c, n) => {
      const k = c.dataset.skey; const no = cards.length > 1 ? `${n + 1}번 훈련 · ` : '';
      out.push(
        { id: `s:${k}:what`, card: c, part: 'what', q: `${no}오늘 어떤 훈련을 했어요?` },
        { id: `s:${k}:pad`, card: c, part: 'pad', q: `${no}그림으로 그려 봐요`, sub: '[장면 추가]를 누르면 그림판이 열려요. 그림은 꼭 그려요.' },
        { id: `s:${k}:good`, card: c, part: 'good', q: `${no}잘된 건 뭐예요?`, sub: '눌러서 고르고, 하고 싶은 말을 더 적어요.' },
        { id: `s:${k}:hard`, card: c, part: 'hard', q: `${no}어려웠던 건 뭐예요?` },
        { id: `s:${k}:ask`, card: c, part: 'ask', q: `${no}코치님께 묻고 싶은 게 있나요?`, sub: '없으면 그냥 다음으로 넘어가요.', last: n === cards.length - 1 },
      );
    });
    if (has('wrap')) out.push({ id: 'wrap', q: '오늘을 정리해요' });
    out.push({ id: 'send', q: '다 썼어요! 확인하고 보내요' });
    return out;
  };

  // 칸 꾸미기: 고르기 버튼 · 말로 쓰기 (한 번만)
  const decorate = (root) => {
    root.querySelectorAll('[data-ezchips]:not([data-ez-done])').forEach((lb) => {
      lb.dataset.ezDone = '1';
      const f = lb.querySelector('textarea, input'); const list = CHIPS[lb.dataset.ezchips];
      const row = document.createElement('div'); row.className = 'ez-chips';
      if (lb.dataset.ezp) row.dataset.ezp = lb.dataset.ezp; // 같은 장에서만 보이게
      row.innerHTML = [...list, '기타'].map((c) => `<button type="button" class="ez-chip" data-v="${esc(c)}">${esc(c)}</button>`).join('');
      lb.before(row);
      const sync = () => row.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v !== '기타' && f.value.includes(b.dataset.v)));
      row.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        const v = b.dataset.v;
        if (v === '기타') { f.focus(); return; } // 직접 적기
        if (f.value.includes(v)) f.value = f.value.replace(new RegExp(`(^|, )${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=, |$)`), '').replace(/^, /, '');
        else f.value = f.value.trim() ? `${f.value.trim().replace(/[,.]$/, '')}, ${v}` : v;
        sync(); fire();
      });
      f.addEventListener('input', sync); sync();
    });
    if (!Speech) return;
    root.querySelectorAll('textarea:not([data-ez-mic])').forEach((t) => {
      t.dataset.ezMic = '1';
      const w = document.createElement('div'); w.className = 'ez-say';
      t.before(w); w.append(t);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ez-mic'; b.innerHTML = `${MIC}<span>말로 쓰기</span>`; b.setAttribute('aria-label', '말로 쓰기');
      w.append(b);
      let rec = null;
      b.onclick = () => {
        if (rec) { rec.stop(); return; }
        try { rec = new Speech(); } catch { rec = null; return; }
        rec.lang = 'ko-KR'; rec.interimResults = true; rec.continuous = false;
        const base = t.value.trim();
        rec.onresult = (e) => { const said = [...e.results].map((r) => r[0].transcript).join(''); t.value = base ? `${base} ${said}` : said; fire(); };
        const end = () => { rec = null; b.classList.remove('live'); b.querySelector('span').textContent = '말로 쓰기'; };
        rec.onend = end; rec.onerror = (e) => { end(); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') b.querySelector('span').textContent = '마이크 꺼짐'; };
        b.classList.add('live'); b.querySelector('span').textContent = '듣는 중';
        try { rec.start(); } catch { end(); }
      };
    });
  };

  // 훈련 고르기 (코치님이 올린 훈련 · 내가 전에 한 훈련 · 팀 훈련 프로그램)
  const pickBox = (card) => {
    let box = card.querySelector('.ez-pick');
    if (box) return;
    const grp = (title, list, kind) => (list.length ? `<span class="ez-lbl">${title}</span><div class="ez-chips">${list.map((x, n) => `<button type="button" class="ez-chip" data-pick="${kind}:${n}">${esc(x.name)}</button>`).join('')}</div>` : '');
    box = document.createElement('div'); box.className = 'ez-pick'; box.dataset.ezp = 'what';
    box.innerHTML = o.coach.length
      ? `${grp('코치님이 올린 오늘 훈련', o.coach, 'coach')}${grp('내가 전에 한 훈련', o.recent, 'recent')}`
      : `<p class="ez-none">오늘은 코치님이 올린 훈련이 없어요. 아래에서 고르거나 직접 적어요.</p>${grp('내가 전에 한 훈련', o.recent, 'recent')}${grp('우리 팀 훈련 프로그램', o.progs, 'progs')}`;
    box.insertAdjacentHTML('beforeend', '<span class="ez-lbl">목록에 없으면 아래에 직접 적어요</span>');
    card.querySelector('.sess-main > header').before(box);
    const name = card.querySelector('.sess-name');
    const mark = () => box.querySelectorAll('[data-pick]').forEach((b) => b.classList.toggle('on', b.textContent === name.value.trim()));
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      const [kind, n] = b.dataset.pick.split(':');
      o.pick(card, o[kind][+n]); mark();
    });
    name.addEventListener('input', mark); mark();
  };

  const show = (n) => {
    steps = build();
    i = Math.max(0, Math.min(steps.length - 1, n));
    const st = steps[i];
    ss.set(POS(o.date), st.id);
    form.querySelectorAll('.ez-cur').forEach((x) => x.classList.remove('ez-cur'));
    form.querySelectorAll('.ez-card').forEach((x) => x.classList.remove('ez-card'));
    if (st.card) {
      st.card.classList.add('ez-card');
      if (st.part === 'what') pickBox(st.card);
      decorate(st.card);
      st.card.querySelectorAll(`[data-ezp="${st.part}"]`).forEach((x) => x.classList.add('ez-cur'));
      // 코치님 훈련 안내는 접어서 (고르기 버튼으로 충분 · 펼치면 그림까지 보임)
      if (st.part === 'what') form.querySelectorAll('[data-ez="ref"]').forEach((x) => { x.classList.add('ez-cur'); if (!x.dataset.ezFold) { x.dataset.ezFold = '1'; x.open = false; } });
      if (st.part === 'pad') setTimeout(() => window.dispatchEvent(new Event('resize')), 0); // 숨어 있던 작전판 크기 다시 맞춤
    } else {
      form.querySelectorAll(`[data-ez="${st.id}"]`).forEach((x) => { decorate(x); x.classList.add('ez-cur'); });
    }
    const sendList = st.id === 'send' ? `<div class="ez-sum">${steps.slice(0, -1).map((s, n) => `<button type="button" data-ez-go="${n}"><span>${esc(s.q)}</span><em class="${filled(s) ? 'ok' : ''}">${filled(s) ? '씀' : '비어 있음'}</em></button>`).join('')}</div>` : '';
    top.innerHTML = `<div class="ez-row"><span class="ez-date">${kindNow() === 'match' ? '경기' : '훈련'} 일지 · ${esc(o.dateLabel)}</span><button type="button" class="ez-full" data-ez-off>전체 보기</button></div>
      <div class="ez-bars">${steps.map((_, n) => `<i class="${n <= i ? 'd' : ''}"></i>`).join('')}</div>
      <span class="ez-count">${i + 1} / ${steps.length}</span>
      <h2 class="ez-q">${esc(st.q)}</h2>${st.sub ? `<p class="ez-sub">${esc(st.sub)}</p>` : ''}
      ${i === 0 ? `<button type="button" class="ez-link" data-ez-kind>${kindNow() === 'match' ? '오늘은 훈련이었어요 · 훈련 일지 쓰기' : '오늘은 경기였어요 · 경기 일지 쓰기'}</button>` : ''}${
      st.last && st.scene && form.querySelector('[data-add-scene3d]') ? '<button type="button" class="ez-link" data-ez-more3>3D (GK) 장면으로 하나 더</button>' : ''}${sendList}`;
    nav.innerHTML = `<button type="button" class="btn ghost" data-ez-prev ${i === 0 ? 'disabled' : ''}>이전</button>${
      st.last ? `<button type="button" class="btn ghost" data-ez-more>${st.scene ? '장면 더 있어요' : '훈련 더 있어요'}</button>` : ''}${
      st.id === 'send' ? '' : `<button type="button" class="btn" data-ez-next>${steps[i + 1]?.id === 'send' ? '다 썼어요' : '다음'}</button>`}`;
    nav.classList.toggle('three', !!st.last);
    window.scrollTo({ top: 0 });
  };

  // 다 썼는지 (확인 장에 표시)
  const val = (sel, root = form) => [...root.querySelectorAll(sel)].some((x) => (x.type === 'radio' || x.type === 'checkbox' ? x.checked : (x.value || '').trim()));
  const filled = (s) => {
    if (s.card) {
      if (s.part === 'pad') return s.scene || s.card.classList.contains('mj-scene') ? o.hasScenePad(s.card) : o.hasPad(s.card);
      return val(`[data-ezp="${s.part}"] textarea, [data-ezp="${s.part}"] input`, s.card);
    }
    if (s.id === 'sleep') return !!(form.bedtime?.value && form.wakeTime?.value);
    if (s.id === 'mmin') return [...form.querySelectorAll('[data-prow]:not([hidden]) input')].every((x) => x.value !== '');
    return val(`[data-ez="${s.id}"] input, [data-ez="${s.id}"] textarea`);
  };

  const start = () => {
    el.classList.add('ez');
    el.prepend(top); el.append(nav);
    drawSwitch();
    const saved = ss.get(POS(o.date)); steps = build();
    const at = steps.findIndex((s) => s.id === saved);
    show(at >= 0 ? at : o.submitted ? steps.length - 1 : 0);
  };
  const stop = (remember) => {
    if (remember) ls.set(OFF, '1');
    el.classList.remove('ez'); top.remove(); nav.remove();
    form.querySelectorAll('.ez-cur, .ez-card').forEach((x) => x.classList.remove('ez-cur', 'ez-card'));
    drawSwitch();
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ez-prev], [data-ez-next], [data-ez-off], [data-ez-go], [data-ez-more], [data-ez-more3], [data-ez-kind]');
    if (!b || !el.classList.contains('ez')) return;
    if (b.hasAttribute('data-ez-prev')) show(i - 1);
    else if (b.hasAttribute('data-ez-next')) show(i + 1);
    else if (b.hasAttribute('data-ez-go')) show(+b.dataset.ezGo);
    else if (b.hasAttribute('data-ez-off')) stop(true);
    else if (b.hasAttribute('data-ez-more') || b.hasAttribute('data-ez-more3')) {
      const m = kindNow() === 'match';
      const add = b.hasAttribute('data-ez-more3') ? form.querySelector('[data-add-scene3d]') : m ? form.querySelector('.add-big[data-add-scene]') : form.querySelector('.add-big[data-add-sess]');
      add?.click();
      const last = [...form.querySelectorAll(m ? '[data-scenes] .mj-scene' : '[data-mysess] .sess.mine')].pop();
      steps = build(); show(steps.findIndex((s) => s.card === last && s.part === (m ? 'pad' : 'what')));
    } else if (b.hasAttribute('data-ez-kind')) {
      const r = form.querySelector(`[name=kind][value=${kindNow() === 'match' ? 'train' : 'match'}]`);
      if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      show(0);
    }
  });
  // 다쳤다고 고르면 자각도 장이 빠지고, 안 뛰었다고 고르면 뛴 시간 · 골 · 평점 장이 빠짐 → 목록 새로
  form.querySelectorAll('[name=hurt], [name=m_played]').forEach((r) => r.addEventListener('change', () => { if (el.classList.contains('ez')) { const id = steps[i]?.id; steps = build(); setTimeout(() => show(Math.max(0, build().findIndex((s) => s.id === id))), 0); } }));

  // 작은 그림을 누르면: 바로 화면 가득 그리기 (작은 화면에서 잘못 그리지 않게)
  form.addEventListener('pointerdown', (e) => {
    if (!el.classList.contains('ez')) return;
    const pad = e.target.closest('.pad');
    if (!pad || pad.classList.contains('pad-full') || !e.target.closest('.pad-svg')) return;
    e.preventDefault(); e.stopPropagation();
    pad.querySelector('[data-act="full"]')?.click();
  }, true);
  form.addEventListener('click', (e) => {
    if (!el.classList.contains('ez') || !e.target.closest('[data-submit]')) return;
    steps = build();
    const need = (s) => (s.id === 'mplay' && !filled(s)) || (s.id === 'mmin' && !filled(s))
      || (s.part === 'pad' && !filled(s) && [...s.card.querySelectorAll('textarea, .sess-name')].some((x) => x.value.trim())); // 뭔가 적었는데 그림이 없는 훈련 · 장면
    const at = steps.findIndex(need);
    if (at >= 0) setTimeout(() => show(at), 0);
  }, true);

  if (ls.get(OFF)) drawSwitch(); else start();
}
