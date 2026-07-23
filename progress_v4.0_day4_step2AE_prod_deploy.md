# progress_v4.0 · Day4 · Step 2-A+2-E 프로덕션 배포 · 엄마2

- **작성일**: 2026-07-23
- **대상**: `genya-builder.onrender.com` (Render · main push 자동 재배포)
- **상태**: 🟢 **회장님 결재("배포해") → main FF 푸시 완료** · Render 재배포

## 배포 내용 (회장님 승인)
- **Task 1 · 고객 스코프**: 한글안전 `_slug`(홍길동↔김철수 분리) · `detectCustomer` · 대화 고객 네임스페이스 라우팅. T-1 라이브 실측 통과(저장→회상→격리).
- **Task 2 · 팀장 페르소나 v0.2**: `genyaPersona(job,opts)` 5대원칙·95/5·A/B/C+⭐ · `호칭For`(회장님 자동). T-10 톤샘플 4종 통과.

## 병합·배포 절차 (안전)
1. 브랜치와 main 갈림 확인 — 그 사이 엄마3가 **2-B·2-C**를 main에 올림(origin/main `1ef882c`).
2. **정직 짚음**: 곧바로 FF 불가(diverged) → main을 내 브랜치에 먼저 병합해 충돌 해결.
3. 엄마3 로컬 사본 2개(untracked)는 **백업 후** 이동, 커밋된 정본 채택(엄마3 커밋 무접촉).
4. 충돌 1곳(main_server.js require 블록) — **양쪽 다 살림**(personalMem + sheetsCrud + approval).
5. 병합 커밋 `e55c1df` → `merge-base --is-ancestor`로 FF 안전확인 → **main FF 푸시** `1ef882c..e55c1df`.
6. 4개 모듈 `node --check` 통과 · 내 코드(호칭·페르소나·고객스코프)와 엄마3 코드(시트CRUD·결재함·B8훅) 공존 확인.

## 프로덕션 검증
- 배포 전 baseline: `GET /` → 200 OK.
- 재배포 후 헬스: (아래 실측)
- **T-1/T-10 authed 실측**: 회장님 로그인 세션 필요(챗 엔드포인트 gateGoogle). 엔진 코드는 로컬에서 동일 Pinecone(ohwant-genya) 상대로 이미 검증됨 → 회장님 앱에서 "홍길동님 요즘 어때?" 첫 사용으로 최종 확인.

## 다음 (메모)
- 엄마3가 `main_server.js:198`에 남긴 `sheetsCrud.onWrite(cb)` 훅 자리 = **시트 쓰기→Pinecone 재인덱싱** 연결점(엄마2 향후 과제, customer_id 확정 시).
- A·E 브랜치 페르소나 단일화 정리.

## 절대유지
✅ ohwant-homepage 무접촉 · Step2-1 라우터 그대로 · 엄마3 2-B/2-C/2-F 커밋·브랜치 무접촉(정본 보존·FF) · 키값 출력금지
