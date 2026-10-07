# 싸카매니저 축구 브리핑 피드

`feeds.py` 가 `feed-sources.json` 의 뉴스 · 블로그 · 유튜브 RSS 를 모아 `feeds.json` 을 만듭니다.
GitHub Actions 가 30분마다 자동 실행합니다. 앱은 이 파일을 읽어 홈의 '오늘의 축구 브리핑'에 보여줍니다.

블로그 추가: `feed-sources.json` 의 `blogs` 에
`{ "id": "myblog", "name": "블로그 이름", "url": "https://rss.blog.naver.com/<아이디>.xml" }` 처럼 넣으세요.
(티스토리: `https://<아이디>.tistory.com/rss`)
