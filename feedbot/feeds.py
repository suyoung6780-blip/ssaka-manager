#!/usr/bin/env python3
"""싸카매니저 축구 브리핑 수집기 (파이썬 기본 라이브러리만 사용)

  python3 feeds.py              # feed-sources.json 의 뉴스 · 블로그 · 유튜브를 모아 feeds.json 저장

GitHub Actions 가 30분마다 이 파일을 실행해 feeds.json 을 갱신합니다 (.github/workflows/feeds.yml).
앱은 config.js 의 FEEDS_URL 로 그 feeds.json 을 읽습니다 — 서버 · 결제 없이 무료.
로컬 dev-server.py 의 /api/feeds 도 이 모듈을 씁니다.
"""
import html
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCES = json.loads((HERE / 'feed-sources.json').read_text(encoding='utf-8'))
KST = timezone(timedelta(hours=9))
TZ = {'BST': '+0100', 'CEST': '+0200', 'CET': '+0100', 'EST': '-0500', 'EDT': '-0400', 'KST': '+0900'}


def decode(s):
    s = re.sub(r'<!\[CDATA\[([\s\S]*?)\]\]>', r'\1', s or '')
    s = html.unescape(s)
    s = re.sub(r'<[^>]+>', '', s)
    return re.sub(r'\s+', ' ', s).strip()


def tag(xml, name):
    m = re.search(rf'<{name}(?:\s[^>]*)?>([\s\S]*?)</{name}>', xml, re.I)
    return m.group(1) if m else ''


def parse_date(s):
    s = (s or '').strip()
    try:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?', s):
            return int(datetime.fromisoformat(s).replace(tzinfo=KST).timestamp() * 1000)
        if re.match(r'\d{4}-\d{2}-\d{2}T', s):
            return int(datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
        s = re.sub(r'\b(BST|CEST|CET|EST|EDT|KST)\b', lambda m: TZ[m.group(1)], s)
        return int(parsedate_to_datetime(s).timestamp() * 1000)
    except Exception:
        return 0


def get(url, tries=3):
    # 유튜브 RSS 는 가끔 404 · 500 을 잠깐 돌려줌 → 조금 쉬었다가 다시
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 SSAKA-MANAGER'})
            with urllib.request.urlopen(req, timeout=8) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception:  # noqa: BLE001
            if i == tries - 1:
                raise
            time.sleep(0.6 * (i + 1))


def news(src):
    xml = get(src['url'])
    out = []
    for it in re.findall(r'<item[\s>][\s\S]*?</item>', xml):
        n = {
            'src': src['id'], 'srcName': src['name'], 'lang': src.get('lang', 'ko'),
            'title': decode(tag(it, 'title')),
            'link': decode(tag(it, 'link')) or decode(tag(it, 'guid')),
            'ts': parse_date(tag(it, 'pubDate') or tag(it, 'dc:date')),
        }
        if n['title'] and n['link'] and (not src.get('soccerOnly') or any(k in n['title'] for k in SOURCES['soccerKeywords'])):
            out.append(n)
    return out


def videos(src):
    xml = get(f"https://www.youtube.com/feeds/videos.xml?channel_id={src['channelId']}")
    out = []
    for e in re.findall(r'<entry>[\s\S]*?</entry>', xml):
        views = re.search(r'<media:statistics views="(\d+)"', e)
        title = decode(tag(e, 'title'))
        vid = decode(tag(e, 'yt:videoId'))
        if vid:
            out.append({
                'src': src['id'], 'srcName': src['name'], 'id': vid, 'title': title,
                'ts': parse_date(tag(e, 'published')),
                'views': int(views.group(1)) if views else None,
                'shorts': '#shorts' in title.lower(),
            })
    return out


def collect():
    # 블로그는 뉴스와 같은 RSS — 뉴스 목록에 '블로그 · 이름' 으로 섞어 보여줌
    blogs = [{**b, 'name': f"블로그 · {b['name']}", 'lang': 'ko'} for b in SOURCES.get('blogs', [])]
    text_sources = SOURCES['news'] + blogs
    failed, news_items, video_items = [], [], []
    with ThreadPoolExecutor(max_workers=12) as ex:
        jobs = [(s, ex.submit(news, s), news_items) for s in text_sources]
        jobs += [(s, ex.submit(videos, s), video_items) for s in SOURCES['youtube']]
        for s, fut, bucket in jobs:
            try:
                bucket.extend(fut.result())
            except Exception as e:  # noqa: BLE001
                print('feed failed:', s['id'], e)
                failed.append(s['id'])
    return {
        'updatedAt': int(time.time() * 1000),
        'sources': {
            'news': [{k: s[k] for k in ('id', 'name', 'lang')} for s in text_sources],
            'youtube': [{k: s[k] for k in ('id', 'name')} for s in SOURCES['youtube']],
        },
        'failed': failed,
        'news': sorted(news_items, key=lambda x: -x['ts'])[:300],
        'videos': sorted(video_items, key=lambda x: -x['ts'])[:150],
    }


if __name__ == '__main__':
    data = collect()
    (HERE / 'feeds.json').write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    print(f"news {len(data['news'])} · videos {len(data['videos'])} · failed {data['failed']}")
