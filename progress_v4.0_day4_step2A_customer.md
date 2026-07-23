# progress_v4.0 · Day4 · Step 2-A 고객스코프 연동 · 엄마2

- **작성일**: 2026-07-23
- **브랜치**: `feature/step2-A-personalization` (원격 백업 푸시 완료)
- **상태**: 🟢 **고객 스코프 라이브 작동** · T-1 실측 통과 · 격리 확인

## 오늘 한 일 (Task 1 · customer 스코프 연동)

### 정직하게 짚은 선행조건 문제 2개
1. **엄마3 Step 2-B는 고객을 "이름(고객명)"으로 식별** — 별도 ASCII `customer_id` 필드가 아직 없음.
2. **더 근본적 블로커:** 기존 `_slug()`가 **한글을 전부 제거** → `홍길동`·`김철수`가 모두 `unknown`으로 뭉개져 고객 분리 불가.

### 해결 (회장님 결정: "내 모듈에서 한글안전 slug")
- `personal_memory._slug()` **한글안전화**: 비ASCII(한글)가 섞이면 원문 SHA1 앞 10자리를 붙여 이름마다 **고유·안정 슬러그** 생성.
  - `홍길동` → `h8413234fa2` · `김철수` → `h76f72e21be` (서로 다름 = 분리 ✅)
  - 순수 ASCII(`ggorilla11`, `hong-gd-01`)는 **그대로** → 기존 대표 데이터 100% 호환(마이그레이션 불필요).
- `detectCustomer(q)` 신규: 대화에서 `"홍길동님"` 지칭 감지, 호칭성 단어(대표/회장/고객 등) 제외.
- `main_server.js` 대화 배선: 고객 지칭 시 그 고객 네임스페이스로 **회상·저장 라우팅**(없으면 대표). 프롬프트 라벨도 "홍길동님 기억"으로.

### 변경 파일 (2개, 엄마3 브랜치 무접촉)
- `deploy/personal_memory.js` — `_slug` 한글안전 + `detectCustomer` 추가 + export + 자체점검.
- `deploy/main_server.js` — 대화 else 브랜치: `cust=detectCustomer(q)` → `scope/customerId` 라우팅.

## 라이브 실측 (실제 Pinecone ohwant-genya)
| 항목 | 결과 |
|---|---|
| 저장 | `홍길동` → `owner_ggorilla11:customer:h8413234fa2` |
| T-1 회상 | "홍길동님 요즘 어떻게 지내요?" → ✅ 홍길동님 상담내용 회상 |
| 격리 | 대표 스코프에 오늘 고객상담(학자금·종신보험 리모델링) **미유출 ✅** |

## 남은 것 / 결재 대기
- **프로덕션 배포(main push)** — 대화 라우팅이 바뀌므로 **회장님·팀장 결재 후** 진행.
- **Task 2 (Step 2-E genyaPersona 통합)** — 현재 `genyaPersona()`는 인라인 문자열, E브랜치는 `team_leader_persona.md` 파일. 통합 방식 설계 결재 필요.
- **엄마3 ASCII customer_id 필드** 나오면 → 이름 대신 그 id를 customerId로 넘기면 그대로 호환(코드 수정 불필요). 그때 이름↔id 매핑만 배선.

## 절대유지
✅ ohwant-homepage 무접촉 · Step2-1 프로덕션 그대로 · main push 금지(결재 대기) · 엄마3 2-B/2-C/2-D/2-F 브랜치 무접촉
