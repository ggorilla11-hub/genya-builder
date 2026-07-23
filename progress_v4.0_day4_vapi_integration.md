# progress_v4.0 · Day4 · genya-builder Vapi 음성 통합(골격) · 엄마2

- 작성일: 2026-07-23
- 인계: 엄마1 Task 26(`C:\Users\user\ohwant-homepage\progress_v4.0_day4_genya_builder_vapi.md`·`ai.html`) 참고, genya-builder는 엄마2 실행
- 상태: 🟡 골격 배선 완료(라이브 안전) · 키·Render env 넣으면 즉시 작동

## 목표
genya-builder 지니야 대화 페이지에 마이크 → Vapi 음성. **통화 지니야 = 텍스트 지니야(같은 뇌·기억).**

## 배선 (엄마2 · main_server.js + genya.html)
### 백엔드 (main_server.js)
- `GET /api/vapi-config` → `{ ready, publicKey, assistantId }` (Render env·하드코딩 0. Vapi Public Key는 클라이언트 공개용이라 반환 OK). 키 없으면 ready:false.
- `GET /api/vapi-context` → `{ user_id, user_name, session_id, recall }` — 로그인 세션(gateGoogle) + **Pinecone recallSmart(엄마2)** 조립 → 통화 지니야에 주입할 개인화.

### 프론트 (genya.html)
- head: Vapi Web SDK 동적 import(`@vapi-ai/web@2.5.2`) → `window.VapiClass`·`vapi-ready`.
- 마이크 버튼(#vdMic, 기존 버튼 배선) → `vapiToggle()` 토글.
- `startCall/stopCall` (원본 4함수 이식: `_vapiConnecting` 중복차단·기존 인스턴스 정리·`new Vapi`·`.on`·`vapi.start(assistantId,{variableValues})`·cleanup beforeunload/pagehide/visibilitychange).
- 상태 6종 매핑: call-start🟡·speech-start🔴·speech-end🟡·message🟢·call-end⚪·error❌ (마이크 색/펄스 CSS).
- 실시간 STT: `message`(transcript final) → 기존 말풍선 `pushMsg`(user/assistant)에 주입.
- ★한 지니야 뇌: `variableValues:{user_id,user_name,session_id,recall}` = 세션+Pinecone → 통화 지니야가 텍스트 지니야와 같은 기억.

## 남은 것 (회장님)
1. **Render env 추가**: `genya-builder` → Environment → `VAPI_PUBLIC_KEY`·`VAPI_ASSISTANT_ID` (회장님 발급분). 저장 시 자동 재배포 → 마이크 작동.
2. **Vapi Assistant 설정**(대시보드): LLM=Claude Sonnet·시스템프롬프트(텍스트 지니야와 동일)·음성 Elliot·변수 `{{recall}}` 등을 프롬프트에서 활용해야 개인화 반영. (엄마1/회장님 영역)

## 정직 짚어드림
- 키 없으면 마이크는 "음성은 곧 열려요"로 안전 안내(대화·페이지 무영향). 실제 음성 통화 실측은 키+Render env+회장님 통화(과금) 필요.
- `recall` 변수는 백엔드가 전달까지 완료. Vapi Assistant 프롬프트가 그 변수를 써야 실제 음성 답변에 개인화 반영됨(대시보드 설정).

## 절대유지
✅ 엄마1(ai.html·ohwant-homepage)·financial-house-building(기존자산) 읽기만·무접촉 · 엄마3 무접촉 · main FF · 키 하드코딩 0
