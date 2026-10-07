// 축구 뉴스 RSS · 유튜브 채널 피드를 모아 JSON 으로 돌려줌 (dev-server.py 에 같은 로직의 파이썬 버전이 있음)
const SOURCES = require('./feed-sources.json');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1));
    return ENTITIES[e.toLowerCase()] ?? m;
  })
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};

// "2026-10-05 21:45:00"(시간대 없음 = KST) / RFC822 / ISO8601 → epoch ms
const TZ = { BST: '+0100', CEST: '+0200', CET: '+0100', EST: '-0500', EDT: '-0400', KST: '+0900' };
function parseDate(s) {
  s = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) return Date.parse(s.replace(' ', 'T') + '+09:00');
  s = s.replace(/\b(BST|CEST|CET|EST|EDT|KST)\b/, (z) => TZ[z]);
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 SSAKA-MANAGER' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function news(src) {
  const xml = await get(src.url);
  const kw = SOURCES.soccerKeywords;
  return (xml.match(/<item[\s>][\s\S]*?<\/item>/g) || [])
    .map((it) => ({
      src: src.id, srcName: src.name, lang: src.lang,
      title: decode(tag(it, 'title')),
      link: decode(tag(it, 'link')) || decode(tag(it, 'guid')),
      ts: parseDate(tag(it, 'pubDate') || tag(it, 'dc:date')),
    }))
    .filter((n) => n.title && n.link && (!src.soccerOnly || kw.some((k) => n.title.includes(k))));
}

async function videos(src) {
  const xml = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${src.channelId}`);
  return (xml.match(/<entry>[\s\S]*?<\/entry>/g) || []).map((e) => {
    const views = e.match(/<media:statistics views="(\d+)"/);
    return {
      src: src.id, srcName: src.name,
      id: decode(tag(e, 'yt:videoId')),
      title: decode(tag(e, 'title')),
      ts: parseDate(tag(e, 'published')),
      views: views ? +views[1] : null,
      shorts: /#shorts/i.test(tag(e, 'title')),
    };
  }).filter((v) => v.id);
}

async function collect() {
  const settle = (list, fn) => Promise.allSettled(list.map(fn)).then((rs) => ({
    items: rs.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
    failed: rs.map((r, i) => (r.status === 'rejected' ? list[i].id : null)).filter(Boolean),
  }));
  const [n, v] = await Promise.all([settle(SOURCES.news, news), settle(SOURCES.youtube, videos)]);
  const byTime = (a, b) => b.ts - a.ts;
  return {
    updatedAt: Date.now(),
    sources: {
      news: SOURCES.news.map(({ id, name, lang }) => ({ id, name, lang })),
      youtube: SOURCES.youtube.map(({ id, name }) => ({ id, name })),
    },
    failed: [...n.failed, ...v.failed],
    news: n.items.sort(byTime).slice(0, 300),
    videos: v.items.sort(byTime).slice(0, 150),
  };
}

module.exports = { collect };
