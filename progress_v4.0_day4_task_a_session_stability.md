# v4.0 Day4 · Task A — 세션 안정성(재로그인 커넥터 자동 유지) ✅ 프로덕션 배포·라이브 실측 완료

## 회장님 이슈
> "이렇게 연결되었다가 로그인이 다시 되면 또 연결이 끊기는 듯한 느낌"

## 진단(요청 4항목 답변)
1. **access_token 저장 위치·수명**: 서버 메모리 세션(`sessions` Map)에만. access_token 자체는 저장 안 함 — googleapis OAuth2 클라이언트가 refresh_token으로 매 호출 시 자동 재발급(수명 관리 라이브러리 담당).
2. **refresh_token 자동 갱신 로직**: `oaClient()`가 client_id/secret 보유 → `setCredentials({refresh_token})`만으로 access_token 자동 갱신됨(라이브러리 기본). **문제는 갱신이 아니라 refresh_token 자체의 가용성**이었음.
3. **세션 쿠키 재접속 유지**: `genya_sid`(세션ID) + `genya_rt`(암호화된 refresh_token, Max-Age 1년) 쿠키. 콜드스타트/재배포로 메모리 세션이 비어도 미들웨어가 `genya_rt`에서 복원. **단, 쿠키 단일계층이 약점.**
4. **시트·캘린더·드라이브 재접속 후 상태**: `memberAuth(req)`가 세션 tokens로 통일 처리 → refresh_token만 살아있으면 세 커넥터 모두 복원. 반대로 rt가 유실되면 셋 다 동시에 끊김.

## 근본 원인
커넥터 영속이 **`genya_rt` 암호화 쿠키 단일 계층**. `saveMemberToken`/`loadMemberToken`(이메일키 refresh_token Firestore 영속)이 **정의만 되고 로그인 경로에 미배선**(VIP 모닝브리핑만 사용). 따라서:
- 쿠키 유실(브라우저 정리) · 좁아짐 · **타 기기 로그인** · TOKEN_ENC_KEY 회전 시 → 재로그인해도 rt 회복 경로 없음 → 커넥터 끊김.
- 로그인은 rt를 재발급하지 않으므로(`prompt: select_account`) 한 번 유실되면 [구글 연결] 재동의 전까진 복구 불가.

## 수정(main_server.js OAuth 구간만)
이미 검증된 durable 저장소를 **로그인 경로에 3중 복원으로 배선**:
1. **콜백**(`/auth/google/callback`): 구글이 rt 실발급(=연결 동의) 시 `saveMemberToken(email, rt, scope)`로 이메일키 Firestore 영속. rt 없으면 `loadMemberToken`으로 복원(복원순서: 세션 `_old` → durable). 최광 스코프 채택. 저장은 fresh rt일 때만(중복문서 방지).
2. **세션복원 미들웨어**: 쿠키에 email만 있고 rt 없으면 `loadMemberToken`으로 durable 복원 → 재배포·콜드스타트·타기기에도 커넥터 자동 유지.
3. **진단 엔드포인트** `/api/diag/token-store`: durable 저장→복원 왕복 실측(토큰 실값 0노출).
- 전부 try/catch 베스트에포트 → durable 실패해도 로그인 절대 안 끊김.

## 실측(Real API)
- 로컬 부팅 스모크: 기동 무오류 · `/login` 200(async 미들웨어 통과) · 신규 엔드포인트 정상 실행 · `/me` 정상.
- **프로덕션 라이브** `/api/diag/token-store`: `TOKEN_ENC_KEY:true · SA설정:true · 저장:true · 복원:true · 일치:true · 스코프복원:true` → **✅ durable 복원 실작동**.
- 배포 회귀 스모크: `/login /me /crud-test /approval-test /api/diag/persist /api/conn/status` 전부 200.

## 효과(회장님 목표 달성)
- 한 번 [구글 연결]한 이메일이면 **재로그인·타기기·재배포·쿠키유실에도 커넥터 자동 유지**.
- refresh_token 자동 갱신 = 라이브러리 기본, durable이 rt 가용성 보장으로 완성.
- 재로그인 시 커넥터 즉시 복원.

## 무접촉 원칙 준수
라우터(Step 2-1) · genya.html(엄마1) · personal_memory(엄마2) 전부 무접촉. main_server.js OAuth 콜백·세션미들웨어·진단 3곳만.

## 배포
- 커밋 3d5bfed, origin/main 위 리베이스(충돌0) → `git push origin HEAD:main`(e0fabb9→3d5bfed) → Render 자동배포 라이브.
- node --check 통과.

## 잔여 메모
- durable 진단이 더미문서(diag-taska@genya.local) 1건 잔존(무해). SA 삭제권한 제약으로 유지.
- 완전 종단 실측(회장님 실제 재로그인→커넥터 배지 유지)은 회장님 브라우저 실측이 최종 확인.
