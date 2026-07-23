# Task D — 모닝브리핑 매일 07:00 자동 발송 설정 (회장님 5분 가이드)

지니야가 **매일 아침 7시, 회장님 시트의 오늘 일정을 요약해 Gmail로** 보내드리는 기능입니다.
코드·배포는 이미 라이브(`/api/cron/morning-brief`). 회장님은 아래 두 가지만 하시면 됩니다.

---

## 준비: 딱 한 번
회장님이 지니야빌더에 **구글 로그인 + [구글 연결](캘린더·시트)** 을 한 번 해두시면 됩니다.
(Task A 수정으로 이제 한 번 연결하면 재로그인해도 계속 유지됩니다.)

---

## 1단계 — Render에 비밀열쇠(CRON_SECRET) 넣기 (2분)

무단 호출을 막는 자물쇠입니다.

1. https://dashboard.render.com 접속 → **genya-builder** 서비스 클릭
2. 왼쪽 메뉴 **Environment** 클릭
3. **Add Environment Variable** 버튼
4. 입력:
   - **Key**: `CRON_SECRET`
   - **Value**: 아무거나 긴 암호처럼 (예: 영문+숫자 20자 이상. 남에게 안 알려주는 값)
5. **Save Changes** → 자동 재배포(2~3분)

> ※ 이 값은 회장님만 아는 비밀번호입니다. 아래 2단계 주소에 똑같이 넣습니다.

---

## 2단계 — 매일 07:00 자동 호출 예약 (3분)

지니야빌더는 웹서버라 "스스로 알람"이 없어, **매일 정해진 시각에 주소를 한 번 눌러줄** 무료 알람 서비스를 씁니다.

### 가장 쉬운 방법 — cron-job.org (무료·카드 불필요)
1. https://cron-job.org 가입(구글로 가능)
2. **Create cronjob** 클릭
3. 입력:
   - **Title**: `지니야 모닝브리핑`
   - **URL**:
     ```
     https://genya-builder.onrender.com/api/cron/morning-brief?key=여기에_1단계_CRON_SECRET_값
     ```
   - **Schedule**: Every day, **07:00** / Timezone: **Asia/Seoul (KST)**
4. **Create** → 끝

### (대안) Render 자체 Cron Job을 쓰는 경우
- Schedule(UTC 기준): `0 22 * * *`  ← **07:00 KST = 전날 22:00 UTC**
- Command: `curl -s "https://genya-builder.onrender.com/api/cron/morning-brief?key=$CRON_SECRET"`

---

## 확인 — 지금 바로 테스트
브라우저 주소창에 아래를 넣어 엔터(=수동으로 한 번 발송):
```
https://genya-builder.onrender.com/api/cron/morning-brief?key=회장님_CRON_SECRET_값
```
- `{"ok":true, ...}` + Gmail 도착 → ✅ 성공
- `{"ok":false,"error":"forbidden"}` → key(비밀열쇠)가 1단계 값과 다름
- `{"ok":false,"error":"회장님 구글 토큰이 저장돼 있지 않아요"}` → 준비(로그인+연결) 한 번 필요

---

## 요약
1. Render Environment에 `CRON_SECRET` 추가
2. cron-job.org에서 매일 07:00(KST)에 위 URL 호출 예약
3. 끝 — 매일 아침 브리핑 자동 발송

기술 사양: `GET /api/cron/morning-brief?key=<CRON_SECRET>` · 인증=저장된 회장님 refresh_token(durable) · 소스 `deploy/morning_brief.js` · 단위 9/9.
