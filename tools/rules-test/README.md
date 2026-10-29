# 보안 규칙 시험 (로컬 에뮬레이터 · 실제 Firebase에 닿지 않음)
1. ~/firebase-test 에 firebase(standalone)와 jre 가 있어야 함
2. cp firestore.rules ~/firebase-test/proj/ && cd ~/firebase-test/proj && JAVA_HOME=~/firebase-test/jre/Contents/Home ../firebase emulators:start --only firestore --project demo-ssaka
3. 다른 창: python3 tools/rules-test/rules_test.py  → "43/43 통과"
