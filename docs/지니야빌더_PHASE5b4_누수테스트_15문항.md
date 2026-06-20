# PHASE 5b-4 — ★★ 데이터 격리 15문항 누수 테스트 (대표님 실행 가이드)

> **B3 합격 기준: 15문항 전부 O. 하나라도 X면 출시 중단.** 방식 ① = 대표님이 테스트 계정 2개로 직접 실증(실데이터로 진짜).
> 베이스 주소: **https://jenya.onrender.com**

## 준비물
- **OWNER 계정** = 대표님 구글(이미 OWNER_EMAIL 등록됨)
- **테스트 계정 2개** = 구글 계정 A, B (교육생 역할). 새 지메일 2개면 됨.
- **브라우저 분리** = 세 신원이 섞이지 않게: OWNER=평소 브라우저 / A=시크릿창1 / B=다른 브라우저(또는 시크릿창2 별도). ※같은 시크릿창은 탭끼리 쿠키 공유되니 신원당 창을 따로.
- **POST 항목**은 로그인된 그 브라우저에서 **F12 → Console 탭에 스니펫 붙여넣고 Enter**.

---

## A. 이미 통과 (엄마 서버측/대표 확인 — 재확인만)
| # | 문항 | 확인 방법 | 기대 | 상태 |
|---|---|---|---|---|
| 1 | 비로그인 dashboard | (로그아웃 상태) 열기: `/dashboard/all` | `gated:true`·데이터 0·프로필 null | ✅ (5b-2) |
| 9 | 쿠키 위조 | 가짜 `genya_session`으로 호출 | 거부(loggedIn:false) | ✅ (엄마 실측) |
| 10 | 쿼리 주입 | 열기: `/diary?tenant=t_fake` | 무시(tenant null·gated) | ✅ (5b-3) |
| 15 | OWNER 전체 | 대표 로그인 후 `/dashboard/all` | 전체 데이터(프로필·핫리드·발행) | ✅ (대표 확인) |

---

## B. A·B 세션 테스트 (대표님 실행)

### 1단계 — A 계정 준비 (시크릿창1)
- 열기: `https://jenya.onrender.com/auth/google` → **A 계정**으로 로그인 → "✅ 로그인 완료"
- A의 일기 심기 (F12 Console):
  ```js
  fetch('/diary/seed',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({entry:'A의 일기'})}).then(r=>r.json()).then(console.log)
  ```
  기대: `{ok:true, saved:"A의 일기", count:1}`

### 2단계 — B 계정 준비 (다른 브라우저/시크릿창2)
- 열기: `/auth/google` → **B 계정**으로 로그인
- B의 일기 심기 (Console):
  ```js
  fetch('/diary/seed',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({entry:'B의 일기'})}).then(r=>r.json()).then(console.log)
  ```
  기대: `{ok:true, saved:"B의 일기", count:1}`

### 3단계 — 15문항 본 검증

| # | 문항 | 누가/어디서 | 열 URL · 방법 | 기대 결과(O 조건) |
|---|---|---|---|---|
| 2 | dashboard 격리 | A창 | `/dashboard/all` | A 것만 — 대표 핫리드·발행·프로필 **안 보임**(gated/빈, 프로필 null) |
| 3 | **diary 격리(핵심)** | A창 | `/diary` | **"A의 일기"만**, "B의 일기"·대표 일기 **0** |
| 3' | diary 격리(B) | B창 | `/diary` | **"B의 일기"만**, "A의 일기"·대표 **0** |
| 4 | ytleads 격리 | A창 | `/ytleads/today` | 대표 핫리드(@…) **0**(빈) |
| 5 | 매출 격리 | A창 | `/campaign/stats` | revenue 0·applications 0 (대표 매출 **0**) |
| 6 | 알림 격리 | A창 | `/notify` | 대표 알림 **0**(list 빈) |
| 7 | 대화기록 격리 | A창 | `/history` | 대표 대화 **0**(빈) |
| 8 | 승인대기 격리 | A창 | `/care/pending` | 대표 승인대기 **0**(빈) |
| 11 | approve 거부 | A창 Console | `fetch('/care/approve',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:['x']})}).then(r=>console.log(r.status))` | **403** (A는 발송 승인 불가) |
| 12 | /me 본인만 | A창 | `/me` | A 본인 email·tenant만 (B/대표 정보 없음) |
| 13 | 로그아웃 | A창 | `/auth/logout` 열고 → `/me` | logout 후 `/me` = **loggedIn:false** |
| 14 | 세션 만료 | (코드 보장) | — | verifySession이 30일 경과 토큰 거부(서명+iat). 런타임 테스트는 30일 필요 → 코드 보장으로 갈음 |

### 4단계 — 재확인 (격리 양면)
- A창 `/diary` 다시 → 여전히 **"A의 일기"만** (B 것 0) = **A↔B 누수 0 증명**
- 대표창 `/diary` → 글로벌(대표 일기), A·B seed **안 섞임**

---

## 합격 판정
- **A 그룹(이미 통과) 4 + B 그룹 11 = 15문항 전부 O → B3 합격, 5c/다음 진행 가능.**
- 하나라도 X → **출시 중단**, 원인 격리 후 재검증.

## 발행 PROTECT
- 이 테스트는 읽기·seed(일기 1줄)만. 발송·발행 0(approve는 403로 막힘). 발행 파이프라인·자동발송 무관.
