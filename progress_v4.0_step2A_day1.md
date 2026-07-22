# progress_v4.0 · Step 2-A 개인화 메모리 · Day 1 (엄마2)

- **작성일**: 2026-07-22
- **브랜치**: `feature/step2-A-personalization` (로컬 · 미푸시)
- **상태**: 🟢 코어 모듈 완비 + 대화 배선 (키 주입 후 활성)

## 현실 확인
- `PINECONE_API_KEY`: ⬜ **없음** → 실제 인덱스 생성·라이브 테스트는 **키 주입 후**.
- `OPENAI_API_KEY`·`@pinecone-database/pinecone`: ✅ 있음 → **코드는 지금 완비**, 키 없으면 안전 no-op.

## 오늘 심은 것
### `deploy/personal_memory.js` (신규 · 코어)
- `configured()` — PINECONE·OpenAI 키 유무. 없으면 전부 no-op.
- `ns(ownerId, scope, customerId)` — 네임스페이스 규칙 (검증: `owner_ggorilla11:representative`, `owner_ggorilla11:customer:hong-gd-01`)
- `ensureIndex()` — `ohwant-genya`(1536·cosine·aws us-east-1) 최초 사용 시 자동 생성
- `embed(text)` — OpenAI **text-embedding-3-small** (1536차원)
- `saveMemory / saveMemoryAsync` — 대화·문서·생성물 저장. 메타데이터 `owner_id·scope·customer_id·source·timestamp·summary·text`. **비동기(응답 지연 0)** · 실패해도 대화 안 끊김.
- `recallContext({query})` — 유사 Top-K(5, score≥0.2) → 프롬프트 주입 문자열.

### `deploy/main_server.js` (배선 · 키없으면 no-op)
- 워크스페이스 대화(일반 분기)에 개인화 기억 배선:
  - 로그인 대표면 `recallContext`(대표 네임스페이스) → 시스템 프롬프트에 `[대표님 기억]` 주입
  - 응답 후 `saveMemoryAsync`로 이 대화 저장(비동기)
- **`configured()` 가드** → 키 없으면 동작 100% 불변(프로덕션 Step2-1 안정화 유지).

### `deploy/.env.example`
- `PINECONE_INDEX=ohwant-genya` 추가 (인덱스 자동생성 안내)

## 서브태스크 진척 (명세서 A-1~A-7)
| # | 태스크 | 상태 |
|---|---|---|
| A-1 | Pinecone 인덱스 신규(ohwant-genya) | 🟡 코드 완비(`ensureIndex`) · **키 주입 시 자동생성** |
| A-2 | 네임스페이스 owner:scope:customer | ✅ `ns()` 완료·검증 |
| A-3 | 임베딩 통합(text-embedding-3-small) | ✅ `embed()` |
| A-4 | 대화 자동 벡터저장 미들웨어 | ✅ 배선(대표 스코프·비동기) |
| A-5 | 매 대화 유사 Top-K 주입 | ✅ 배선(대표 스코프) |
| A-6 | 문서·업로드 파싱·임베딩 | ⬜ Day2 (기존 coverage/analyze에 `source:'upload'` 훅) |
| A-7 | 생성물 자동 저장 | ⬜ Day2 (compare/policy/pension 결과 `source:'generated'` 훅) |

## 검증
- `node --check` (모듈·서버) 통과 · `node personal_memory.js` 자체점검(네임스페이스 명세서 일치)

## 다음(Day 2)
1. **회장님**: `PINECONE_API_KEY` 발급 → Render + 로컬 `.env` 주입 → 인덱스 자동생성·라이브 테스트
2. 고객 스코프(홍길동 등) 저장·조회 (Step 2-B CRUD의 customer_id와 연결 — 엄마3 협업)
3. A-6/A-7 문서·생성물 자동 임베딩 훅
4. 실측: "어제 만든 자료 뭐였지?"(시나리오2) / "홍길동님 요즘 어때?"(시나리오1)

> ⚠️ 미푸시·미배포. 결재 전 main 무접촉.
