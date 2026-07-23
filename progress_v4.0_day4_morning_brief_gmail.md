# v4.0 Day4 · Task 5 · 모닝 브리핑 Gmail 스케줄러 리포트

## 결론
매일 아침, 회장님 고객명단 시트에서 **오늘 만기·생일·상담예정**을 자동으로 뽑아 **Gmail로 요약 발송**하는 자율 브리핑. 로직 단위 9/9 통과(이모지 0), 엔드포인트 배선 실측 완료 → 배포(main **18724a1**).

## 구현
- **독립 모듈 `morning_brief.js`** — `build(loadTable, ma)`: 오늘(KST) 이벤트 필터 → 브리핑 텍스트. 이모지 0, 서버 저장 0.
  - `mmdd()`: YYYY-MM-DD/ MM-DD/ MM.DD 등 다양한 날짜형식 → 'MM-DD' 정규화.
  - 컬럼 동의어 자동 감지(만기·생년월일/생일·상담/예정/미팅).
- **엔드포인트 `GET /api/cron/morning-brief`** (main_server):
  - `CRON_SECRET`로 보호(무단 호출 차단, 403).
  - 세션 없이 `adminAuth()` = 저장된 회장님 refresh_token(Firestore·AES)으로 인증.
  - `sheetsCrud.loadTable`로 시트 조회 → `morning_brief.build` → `_sendGmailFor(회장님)`.
  - `?dry=1`: 발송 없이 미리보기(테스트용).

## 자체 실측
- 단위테스트 **9/9**: 오늘 만기(김철수)·생일(홍길동)·상담(이영희) 추출, 무관 제외, count=3, **이모지 0**, 이벤트0 정직 안내.
- 로컬 엔드포인트 dry 호출: 인증 게이트 통과 → (로컬 토큰 없음) "로그인 1회 필요" 정직 응답 → 배선·에러처리 정상 확인.
- 프로덕션에선 회장님 로그인 토큰으로 실제 시트 조회·발송.

## 회장님/대표님 설정 필요 (배포 후 1회)
1. **Render 웹서비스 env 추가:** `CRON_SECRET` = (임의 긴 문자열)
2. **Cron 설정** (택1):
   - Render Cron Job: 명령 `curl "https://genya-builder.onrender.com/api/cron/morning-brief?key=<CRON_SECRET>"`, 스케줄 `0 22 * * *` (UTC 22시 = 한국 오전 7시)
   - 또는 외부 무료 cron(cron-job.org)에서 같은 URL을 매일 07:00 KST 호출
3. 회장님이 프로덕션에 **1회 로그인**(구글 데이터 연결)해 refresh_token이 저장돼 있어야 함.

## 원칙
- 이모지 0. 서버 저장 0(그때 읽어 요약). 라우터·엄마1·2 무접촉. main FF 안전.
