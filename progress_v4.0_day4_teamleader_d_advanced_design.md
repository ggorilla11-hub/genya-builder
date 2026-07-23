# Phase 팀장-D 심화 — 개인화 v2.0 설계 (구현·실측 아님 · 문서 보존)

> 회장님 판단: 오늘 밤 강행 X. **v2.0 자료로 남김.** 데이터 축적 후 구현.
> 이유(엄마3 정직): ①personal_memory.js=엄마2 담당(무접촉) ②톤·관심사 학습은 3주+ 실데이터 필요→오늘 실측 불가 ③핵심 회상은 이미 라이브(급하지 않음).

## 0. 현재(이미 라이브 · 손대지 않음)
`personal_memory.js`(엄마2)가 이미 제공: `recallSmart`(시간질의→최근순 세션횡단 / 주제→의미검색), `detectCustomer`(고객 스코프), Pinecone ownerId 영속. → "어제 뭐 했지"·"홍길동 요즘"·여러 세션 통합 = **완료**. v2.0은 이 위에 **요약·프로파일 계층**을 얹는다.

## 1. personal_memory 확장 스키마 (Pinecone 메타데이터 추가 필드)
기존 벡터 레코드 메타데이터에 아래를 **추가만**(기존 필드 무변경·하위호환):
```
{
  // 기존: ownerId, scope, customerId, source, text, summary, timestamp
  topics:   ["종부세","상속","연금"],   // 이 대화의 주제 태그(LLM 자동 추출, 3~5개)
  entities: ["김철수","삼성생명"],       // 언급된 고객/상품/기관
  intent:   "질문|설계|발송|불만|잡담",  // 대화 의도 분류
  tone:     { formality: 0.7, warmth: 0.6, length: "short" },  // 회장님 발화 톤 지표(0~1)
  weight:   1.0                          // 최근성/중요도 가중(오래되면 감쇠)
}
```
- 추출기: 저장 시 LLM 1콜(값싼 모델)로 topics/entities/intent/tone 산출 → 메타데이터에 부착. `saveMemory` 확장(엄마2 조율).

## 2. 프로파일 카드 JSON 구조 (owner/customer별 1장·주기 갱신)
세션 시작 시 이 카드를 시스템프롬프트에 주입 → 지니야가 "먼저 챙김".
```json
{
  "type": "ProfileCard",
  "ownerId": "ggorilla11@gmail.com",
  "updatedAt": "2026-07-23",
  "windowDays": 21,
  "interests": [
    { "topic": "종부세·부동산세제", "score": 0.82, "recentRefs": 7 },
    { "topic": "상속·증여 설계", "score": 0.64, "recentRefs": 4 }
  ],
  "activeProjects": [
    { "name": "김명란 상속설계", "lastTouch": "2026-07-21", "status": "진행" }
  ],
  "recentCustomers": ["김철수","홍길동","박수근"],
  "toneProfile": { "formality": 0.7, "warmth": 0.6, "preferredLength": "짧게·핵심" },
  "cadence": { "morningBrief": true, "activeHours": "09-18 KST" }
}
```
- 생성: 최근 windowDays 벡터를 집계 → 관심사(topics 빈도·최근성 가중 Top-N) + 활성 프로젝트(entities 클러스터) + 톤 평균. 하루 1회 배치(cron) 또는 세션 시작 시 캐시(1h TTL).
- 저장 위치: Pinecone 별도 네임스페이스 `profile:{ownerId}` 1레코드 or 회원 시트 프로파일탭(서버 저장 0 원칙 유지).

## 3. 톤·문체 벡터 축적 방식
- **신호 수집**: 매 대화에서 회장님 발화의 formality(존대/구어)·warmth·평균 길이·이모지 사용을 0~1 지표로 산출(§1 tone).
- **축적**: 지수이동평균(EMA)으로 프로파일 tone 갱신 — `tone_new = α·tone_today + (1-α)·tone_prev`, α=0.2(최근 반영·급변 방지).
- **활용**: ProfileCard.toneProfile를 시스템프롬프트에 주입 → 지니야가 회장님 톤에 맞춰 응답(짧게·핵심 선호면 간결하게). ※제품 페르소나(70대도 알아듣게)와 충돌 시 페르소나 우선.
- **주의**: 톤 학습은 최소 2~3주 축적돼야 안정 → v2.0에서 실데이터로 검증(오늘 실측 불가 사유).

## 4. 관심사 자동 학습 접근법
1. **추출**: 저장 시 topics 자동 태깅(§1).
2. **집계**: 최근 windowDays 내 topics 빈도 × 최근성 가중(오래될수록 감쇠) = 관심사 score.
3. **인식**: score Top-N을 ProfileCard.interests에 → 세션 시작 시 "요즘 종부세 많이 보시네요, 관련 새 소식 있으면 먼저 알려드릴까요?"처럼 능동 제안(옵션).
4. **연결**: 관심사 + 팀장-C 웹검색 결합 → "관심 주제 최신 뉴스 아침 브리핑"으로 확장 가능(모닝브리핑 계층과 연동).

## 5. 구현 로드맵(v2.0 · 데이터 축적 후)
- P0: §1 메타데이터 확장(엄마2 `saveMemory` 조율) — 하위호환·추가만.
- P1: §2 ProfileCard 생성 배치 + 세션 시작 주입(orderHandler, 엄마3 가능).
- P2: §3 톤 EMA + §4 관심사 집계 — 2~3주 데이터 후 실측 튜닝.
- P3: 관심사×웹검색 능동 브리핑.
- **실측 기준(정직)**: 각 단계는 실제 축적 데이터로 재현 검증 후 배포. 지어낸 통과 금지.

## 6. 원칙
- `personal_memory.js`=엄마2 담당 → §1 확장은 **엄마2 조율 또는 회장님 이관 지시** 후 착수.
- ProfileCard 주입(orderHandler)·집계 배치는 엄마3 영역 가능(엄마2 모듈 무접촉으로 read-only API 사용).
- 서버 저장 0 원칙 유지(프로파일도 회원 구글 or Pinecone owner 네임스페이스).
