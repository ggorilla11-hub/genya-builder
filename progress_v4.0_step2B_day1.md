# progress · v4.0 · Step 2-B · Google Sheets CRUD · Day 1

- 담당: 엄마3 · 브랜치: `feature/step2-B-sheets-crud`
- 작업 위치: **git worktree** `C:\Users\user\Desktop\genya-b-2B` (3엄마 병렬 충돌 해결)
- 상태: **엔진 구현 + 단위검증 완료. 라이브 CRUD 실측은 배포 결재 대기.**

---

## 오늘 한 일

### 0. 병렬 충돌 발견·해결 (정직 짚어드림)
- 착수 직후 작업폴더 브랜치가 **엄마2의 `feature/step2-E-persona`로 바뀜** 발견.
- 근본원인: **폴더 1개 = 브랜치 1개** — 3엄마가 같은 폴더 공유 → 서로 체크아웃을 뺏음.
- 팀장 결재 → **git worktree 분리**. 제 몫을 별도 폴더(`genya-b-2B`)로 격리(엄마2 무접촉·비파괴).
- 손실 0(untracked 파일 무사), 엄마2 체크아웃 안 건드림.

### 1~4·9. 구현 완료
- **서브1 (Sheets API 확장):** 기존 `gateGoogle`(회원 토큰)·쓰기 스코프(`spreadsheets`) 재사용.
- **서브2 (스키마 자동 감지 · A):** 첫 행 헤더 자동 인식 + **동의어 매핑 13그룹**(이름→고객명, 전화번호→연락처, 거주지→주소 …). 이름 컬럼 자동 감지.
- **서브3 (도구 5개 · C):** `search_rows·read_row·create_row·update_row·delete_row` Claude 도구 등록.
- **서브4 (시스템 프롬프트):** 도구 사용 규칙(읽기 즉시·쓰기 미리보기·애매하면 되묻기·삭제 신중·쉬운 말투).
- **서브9 (B-8 훅):** 쓰기 성공 시 `crudEvents.emit('write')` — 엄마2가 `onWrite(cb)`로 Pinecone 재인덱싱 연결(개인정보 본문 없이 신호만). **벡터 무접촉.**

### 승인 게이트 (A · 무상태 HMAC)
- 모든 쓰기 = 미리보기 → 승인 → commit. **서버에 대기작업 저장 0**(HMAC 서명 토큰, 10분 만료).
- delete = **이중 확인**(commit에 `confirmed=true` 필요).

### 배선 (하이브리드 라우터 무접촉)
- `deploy/sheets_crud_skill.js` 신규(독립 엔진).
- `main_server.js`: require + init + 엔드포인트 2개(`POST /api/sheets/crud/chat`, `/commit`)만 **추가**. Step 2-1 라우터·기존 함수 무수정.

---

## 검증

### ✅ 단위테스트 14/14 통과 (`_test_crud_pure.js`, 구글 無)
- 동의어/부분/정확 컬럼 매핑, 이름 컬럼 감지(폴백 포함)
- HMAC 서명/검증 왕복 + **위변조 거부 + 20분 만료 거부**
- 도구 5개 등록 확인
- 문법 체크(`node --check`): 두 파일 OK

### ⏳ 라이브 실측 미완 (정직) — 배포 결재 대기
- **서브5~8 (READ·UPDATE·CREATE·DELETE 실 시나리오)** 는 코드 완성됐으나,
  실행에 **회장님 구글 로그인 토큰**이 필요(SA 폴백 없음 = 원칙1).
- 배포서버는 `main`을 돎 → 제 브랜치 실측하려면 **배포 결재**가 있어야 함(원칙3: main push 금지).
- ⇒ **결재 주시면**: main 병합·배포 후 회장님 로그인으로 T4("주소 인천으로")·T5("신규 이지혜 추가") 실측.

---

## 다음 (Day 2 예정)
1. 회장님·팀장 코드 리뷰 → 병합·배포 결재
2. 배포 후 회장님 로그인 T1~T5 실측(READ→UPDATE→CREATE→DELETE)
3. 실측 결과 반영·튜닝 → Step 2-C(결재함 백엔드) 착수 준비

*작성: 엄마3 · Step 2-B Day 1*
