# progress · v4.0 · Step 2-B · Google Sheets CRUD · Day 2

- 담당: 엄마3 · 브랜치 `feature/step2-B-sheets-crud` · 워크트리 `genya-b-2B`
- 상태: **로컬 실측 준비 100% 완료 — 회장님 로그인·클릭 테스트 대기.**

---

## 오늘 한 일 — 로컬 실측 환경 완비

### 1. 로컬 서버 가동 (프로덕션 무접촉)
- 포트 **8090** (프로덕션 8080과 분리 · `_isLocalDev`가 809x만 로컬 인정 → 8090 필수).
- 회장님이 로컬 `.env`에 `GOOGLE_OAUTH_CLIENT_ID`·`GOOGLE_OAUTH_CLIENT_SECRET` 주입 → 서버 재시작.
- **검증:**
  - `/api/status` → `googleOAuth: active` ✅ (재시작 전엔 no-key)
  - 부팅 로그 `OAuth ON` ✅
  - `/login` HTTP 200, 미설정 경고 없음 ✅
  - `/auth/google` 리다이렉트 `redirect_uri = http://localhost:8090/auth/google/callback` ✅ (로컬 정확)

### 2. 클릭 테스트 콘솔
- `http://localhost:8090/crud-test` — 비개발자용. 빠른버튼 5개 + 입력창.
- 쓰기는 미리보기→[승인], 삭제는 이중확인(1차→최종). 시트 미연결 시 "구글 연결" 링크 자동 표시.

### 3. 회장님 가이드
- `docs/step2B_로컬_실측_가이드.md` — 5시나리오(T4~T8)·예상결과·합격기준·문제해결.

---

## 회장님 실측 순서 (지금 바로 가능)
1. **http://localhost:8090/login** → 구글 로그인(ggorilla11@gmail.com)
2. **http://localhost:8090/crud-test** → 처음 쓰면 "구글 연결" 한 번(시트·드라이브 허용)
3. 빠른버튼으로 T4~T8 클릭 테스트

## 합격 기준
- 읽기(T4·T8) = 승인 없이 사실 응답 / 쓰기(T5·T6·T7) = 미리보기→승인 후에만 반영 / 삭제(T7) = 두 번 확인 / 동의어("주소") 인식.

## 통과 후
회장님 **"프로덕션 결재"** → main 병합 → push → Render 배포 → 라이브 재검증.
실측 실패해도 **프로덕션 안전**(로컬만 수정).

## 정직 짚어드림
- 로그인은 신원(openid/email)만 먼저 받고, 시트 권한은 콘솔 첫 사용 때 **"구글 연결" 한 번** 더 눌러 허용하는 2단계입니다(콘솔이 자동 안내).
- 만약 로그인에서 `redirect_uri_mismatch`가 뜨면 GCP OAuth 클라이언트에 위 콜백 URI 등록만 하면 됩니다.

*작성: 엄마3 · Step 2-B Day 2 · 로컬 실측 준비 완료*
