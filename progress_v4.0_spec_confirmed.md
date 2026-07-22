# progress_v4.0 · 명세서 이해 확인 (엄마2)

- **작성일**: 2026-07-22
- **근거**: `docs/지니야_LAMT_AI에이전트_완전명세서_v1.0.docx` 전문 정독
- **결론**: 이해 완료 → Step 2-A + 2-E 즉시 착수

## 핵심 재정의 (제가 오해했던 것)
- **이전 오해**: Step 2 = Claude 모델 업그레이드 + RAG 검색
- **진짜**: **LAMT** = Listen·Act·Memory·Trigger = 개인화·컨텍스트·CRUD·리마인더·리딩. 지식은 이미 Opus4.8로 확보, **차별화는 챙김·기억·자율**.

## 제 담당(엄마2) 확인
- **Step 2-A 개인화 메모리** (Pinecone+Sheets 이중, 대표·고객 네임스페이스 분리) — 착수
- **Step 2-E 팀장 페르소나** (리딩·챙김·정직·짚어드림, 호칭 자동) — 병렬 착수
- 판정 시나리오 숙지: 1(고객기억)·2(문서기억)·3(대화컨텍스트)·10(문서생성연결) + T1~T10

## 아키텍처 확인
- 네임스페이스: `owner_{id}:representative` / `owner_{id}:customer:{cid}` (완전 분리)
- 인덱스: `ohwant-genya` · 1536차원(text-embedding-3-small) · cosine · aws us-east-1
- 이중 저장: Pinecone(벡터) + Sheets(구조) · Sheets→Pinecone 동기화
- 소통 3층: 카톡 알림톡 → SMS 폴백 → 웹앱 결재함

## 절대유지 재확인
❌ ohwant-homepage(엄마1) 무접촉 · ❌ main 직접 push 금지(결재 후) · ✅ 프로덕션 Step2-1 안정화 유지 · ❌ 결재 없이 배포 금지 · 📝 매일 progress 리포트

## 3엄마 병렬 체제
엄마1(UI·결재함) / **엄마2=나(Step2-A+2-E)** / 엄마3(Step2-B CRUD+2-C 백엔드). 브랜치 분리로 충돌 회피.
