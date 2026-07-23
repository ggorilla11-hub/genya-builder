# progress_v4.0 · Day4 · 수문장 지니야 · 이벤트 브릿지 · 엄마2

- 작성일: 2026-07-23
- 계기: 회장님 진단 — "변방(Step 2-F 명단 업로드 모달)에서 오랑캐 쳐들어와도 중앙(지니야 대화)은 모르는 형국". 명단 13명 업로드 성공했으나 지니야가 "파일이 안 보여요"(수문장 원칙 위배).
- 상태: 🟢 근본 해결 · Real API 실측 통과 · 배포
- 핵심 가치: "수문장 지니야" = 회장님 550만원 가치 핵심 · CES 2027 금상 목표

## 근본 원인
- 변방: Step 2-F 명단 업로드(`/api/roster/import`) — 프론트 모달·별도 API·시트 저장.
- 중앙: 지니야 대화(orderHandler) — 개인화 기억(Pinecone) 회상.
- **두 시스템 사이 이벤트 브릿지 없음** → 지니야가 이 방에서 일어난 일을 모름.

## 해결 (엄마2 Pinecone 담당)
### personal_memory.js
- `recordEvent({ownerId,type,summary,data,source})` — 이 방 실제 이벤트를 Pinecone에 기록(대표 네임스페이스). `recordEventAsync`(응답지연0).
- `recallRecentEvents({ownerId,limit})` — 최근순(source 무관) 이벤트 회상 → 대화 주입용.

### main_server.js (라우트 훅 · 엄마3 모듈 무접촉)
- `/api/roster/import` 성공 후 → `recordEventAsync(roster_upload, "명단 N명 업로드")`. (엄마3 rosterImport 모듈은 안 건드리고 라우트에서 알림만 받아 기록)
- `/api/vapi-context` → `recordEventAsync(voice_call, "음성 통화 시작")`.
- orderHandler 대화: 매 대화에 **[지금 이 방에서 최근 일어난 일 — 실제 발생]** 주입 → "방금 올린/만든/한 것"을 지니야가 자동 인지("안 보인다" 금지). 단 파일 속 개별 세부는 실제 분석 있을 때만(환각 vs 수문장 균형).

## Real API 실측 (실제 Pinecone + Sonnet 5)
- 명단 업로드 이벤트 기록 → 회상 → "방금 올린 명단 분석해줄래?" →
  지니야: "방금 올려주신 명단 확인했어요. 샘플3_고객명단.xlsx, 13명 기록됐어요. 다만 개별 내용은 실제 분석 없으니 지어내지 않을게요. ⭐ 다시 올려주시면 실제 값으로 분석."
- 판정: **인지 ✅ · "안 보여요" 사라짐 ✅ · 개별내용 환각 0 ✅ · 이모지 0 ✅.**

## 정직 짚어드림 (남은 이벤트 훅)
- 현재 훅: roster_upload · voice_call · (기존) file_attach(coverage/analyze upload) · generated(문서생성 A-7) · dialog(대화 A-4).
- **다음**: sheet_create/update · customer_add/delete · approval_send · login — 엄마3 sheetsCrud/approval 모듈 반환 shape 확인 후 라우트 훅 추가(엄마3 협업). recordEvent 인프라는 완성돼 있어 훅 한 줄씩만 추가하면 됨.

## 절대유지
✅ 엄마1·엄마3 무접촉(엄마3 API 성공 알림만 라우트에서 받음) · main FF · Real API 실측 통과 후 배포 · 지어내기 0 유지
