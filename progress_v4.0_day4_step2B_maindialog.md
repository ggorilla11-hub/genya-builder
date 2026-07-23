# v4.0 Day4 · Task 1 · Step 2-B 시트 CRUD 메인 대화 통합 리포트

## 결론
지니야 메인 대화에서 **"김철수 정보 알려줘"·"홍길동 자녀 수 2명 변경" 같은 시트 조회·수정이 실제로 작동**하도록 통합. 실제 Anthropic API로 자체 실측 4시나리오 통과 → 배포(main **6084eac**).

## 근본 문제(결재함과 동일)
`sheets_crud`에 도구 루프(`runChat`)·도구 5개가 있었으나 `/crud-test` 콘솔에만 붙어 있고 **메인 대화(`orderHandler`)와 미연결** → 지니야가 "시트 못 본다"고 답하던 구조.

## 수정
- `main_server.js` `orderHandler`: **개별 고객 조회·시트 수정 의도 라우팅** 추가 → `sheetsCrud.runChat(ma, ...)`
  - 발송 분기(결재함) 다음, 약관/만기요약 앞에 배치 (발송>시트편집>약관 우선순위)
- `sheets_crud_skill.js` `systemPrompt`: **"핵심 능력 — 절대 '못 한다' 금지"** 문구 강화
- **도구 5개(Function Calling, 전부 영문 키):** `search_rows`(조회·필터) · `read_row`(상세) · `create_row`(추가) · `update_row`(수정) · `delete_row`(삭제·이중확인)
  - ※대표님 명명(sheet_search/read/create/update/delete)과 1:1 기능 대응. 도구명만 기존 유지(리네임은 리스크라 별도 요청 시).
- **한글 property 키 400 함정 없음** — 시트 도구는 원래 영문 키(column·contains·keyword·name·fields·field·value).

## 자체 실측(실제 Anthropic API · google mock)
| 시나리오 | 도구 | 결과 |
|---|---|---|
| "김철수 정보 알려줘" | read_row | 실제 정보 표시 ✅ 에러0 |
| "홍길동 자녀 수 2명으로 변경" | read_row+update_row | 미리보기(3→2) 승인대기 ✅ |
| "8월 만기 고객 알려줘" | search_rows | 필터 조회 ✅ |
| "명단 몇 명이야?" | search_rows | 3명 ✅ |

## 안전·원칙
- 쓰기(수정·추가·삭제)는 **미리보기+승인 게이트 유지**(HMAC 서명·삭제 이중확인). 읽기는 즉시.
- 하이브리드 라우터·엄마1·2 모듈 무접촉. 리베이스로 엄마 이모지 게이트와 충돌 0 병합.
- 단위테스트 유지: 결재 28/28, 시트 순수로직 21/21.

## 배포
리베이스(엄마 b4862bf 위) → FF 푸시 `b4862bf..6084eac` → Render 자동배포.
