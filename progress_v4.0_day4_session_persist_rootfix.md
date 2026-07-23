# progress_v4.0 · Day4 · 세션 uid 영속 근본수정("치매 비서") · 엄마2

- 작성일: 2026-07-24
- 계기: 회장님 진단 URL `/api/_diag/gatekeeper` → `{ loggedIn:false, pineconeReady:true }`. UI 로그인 상태인데도 다른 API에서 세션 uid 없음 = 근본. (모달 uid로 저장 / 지니야 uid로 조회 → 못 찾음. 재로그인·회상 3이슈 전부 이 하나가 근본)
- 상태: 🟢 근본 확정·수정 완료·배포 · ⬜ 회장님 재실측(최종 관문)

## 근본 확정 (진짜 근본)
1. `genya_sid` 쿠키 = **세션 쿠키(Max-Age 없음)** → 브라우저 닫거나 조건 따라 소멸 (line 1787).
2. `genya_rt` 쿠키 = 1년 영속(email·refresh_token).
3. 세션 복원 미들웨어(line 328)는 `if (sid && !sessions.get(sid))` = **genya_sid가 있어야만 복원**.
4. → **genya_sid(세션쿠키) 소멸 시, genya_rt(1년치 email)가 있어도 복원 불가** → `sessionOf` null → uid 소멸 → 개인화(수문장·recallSmart·recordEvent) 전부 실패 = "치매 비서".
- ※ 제 Pinecone 수문장은 uid만 오면 작동(Real API 실측 통과). 근본은 **세션 인프라**(엄마들 공통 "Task A" 영역)였음.

## 수정 (2중 근본)
1. **`genya_sid` 영속화**(2곳: 로그인 콜백 1787·1847): `Max-Age=31536000` 추가 → 브라우저 닫아도 유지.
2. **복원 미들웨어 강건화**(325): `if (!(sid && sessions.get(sid)))` — 세션이 없으면 genya_rt(email)로 복원하고, **sid가 유실됐으면 새로 발급·영속 재설정** → uid 항상 유지(브라우저 닫힘·재배포·세션쿠키 소멸에도).

## 효과 (3이슈 자동 해결)
- 명단 업로드 uid ≡ 지니야 조회 uid → "방금 올린 명단" 인지.
- 재로그인/재배포/브라우저 닫힘에도 uid(email) 유지 → 명단·기억 안 사라짐.
- 이전 대화 회상 유지 → "평생 기억 비서".

## 정직 짚어드림
- 이건 **로그인/세션 인프라(공통·엄마3 Task A 관여)** 수정입니다. 근본이라 수정했고 main FF로 안전하게 올렸으나, **인증 핵심**이라 회장님 실측이 최종 관문입니다.
- 회장님이 **한 번 재로그인**하면 새 영속 genya_sid + genya_rt로 완전 정착. (기존 genya_rt가 남아있으면 재로그인 없이도 복원되어 loggedIn:true 나와야 함.)

## 회장님 재실측 (최종 관문)
1. `https://genya-builder.onrender.com/api/_diag/gatekeeper` 열기 → **loggedIn:true · uid 표시**되는지 (안 되면 한 번 재로그인 후 다시)
2. 📇 명단 업로드 → 지니야 "방금 올린 명단 뭐야?" → **13명 인지** 확인
3. 로그아웃/브라우저 닫고 재로그인 → 명단·기억 유지 확인

## 절대유지
✅ main FF · 서버 저장 0(토큰만 암호화) · 키 하드코딩 0 · 자기답변 배제(회장님 실측이 최종)
