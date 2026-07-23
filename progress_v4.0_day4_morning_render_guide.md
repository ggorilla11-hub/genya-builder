# 📮 모닝 브리핑 매일 07:00 자동 발송 — 회장님 5분 설정 (스크린샷 스타일)

지니야가 **매일 아침 7시, 회장님 시트의 오늘 일정을 요약해 Gmail로** 보내드립니다.
코드·배포는 이미 라이브(`/api/cron/morning-brief`). 회장님은 아래 **2단계**만 하시면 끝입니다.

> 준비: genya-builder에 **구글 로그인 + [구글 연결]** 한 번(Task A로 이제 계속 유지됨).

---

## 🔑 1단계 — Render에 비밀열쇠 넣기 (2분)

```
① https://dashboard.render.com  접속
② 서비스 목록에서  ▶ genya-builder  클릭
③ 왼쪽 메뉴  ▶ Environment  클릭
④ [ + Add Environment Variable ]  버튼
⑤  ┌───────────────┬──────────────────────────────┐
   │ Key           │ CRON_SECRET                  │
   ├───────────────┼──────────────────────────────┤
   │ Value         │ (아무 긴 암호. 예: myGenya07am2026x) │
   └───────────────┴──────────────────────────────┘
⑥ [ Save Changes ]  →  자동 재배포(2~3분)
```
※ Value는 남에게 안 알려주는 비밀번호. 아래 2단계에 똑같이 씁니다.

---

## ⏰ 2단계 — 매일 07:00 알람 예약 (3분 · 무료)

지니야빌더는 웹서버라 "스스로 알람"이 없어, 무료 알람 사이트로 매일 7시에 주소 한 번 눌러줍니다.

```
① https://cron-job.org  가입(구글로 가능)
② [ Create cronjob ]  클릭
③  ┌───────────┬─────────────────────────────────────────────────────────┐
   │ Title     │ 지니야 모닝브리핑                                          │
   ├───────────┼─────────────────────────────────────────────────────────┤
   │ URL       │ https://genya-builder.onrender.com/api/cron/morning-brief│
   │           │ ?key=여기에_1단계_CRON_SECRET_값                          │
   ├───────────┼─────────────────────────────────────────────────────────┤
   │ Schedule  │ Every day  07:00                                         │
   │ Timezone  │ Asia/Seoul (KST)                                         │
   └───────────┴─────────────────────────────────────────────────────────┘
④ [ Create ]  →  끝!
```

### (대안) Render 자체 Cron Job이면
- Schedule(UTC): `0 22 * * *`  ← **07:00 KST = 전날 22:00 UTC**
- Command: `curl -s "https://genya-builder.onrender.com/api/cron/morning-brief?key=$CRON_SECRET"`

---

## ✅ 지금 바로 테스트 (수동 1회 발송)
브라우저 주소창에 붙여넣고 엔터:
```
https://genya-builder.onrender.com/api/cron/morning-brief?key=회장님_CRON_SECRET_값
```
| 화면에 뜨는 것 | 뜻 |
|---|---|
| `{"ok":true, ...}` + Gmail 도착 | ✅ 성공 |
| `{"ok":false,"error":"forbidden"}` | key가 1단계 값과 다름 |
| `{"ok":false,"error":"회장님 구글 토큰이 저장돼 있지 않아요"}` | 준비(로그인+연결) 한 번 필요 |

---

## 요약
1. Render Environment → `CRON_SECRET` 추가
2. cron-job.org → 매일 07:00(KST) 위 URL 예약
3. 끝 — 매일 아침 브리핑 자동 발송

사양: `GET /api/cron/morning-brief?key=<CRON_SECRET>` · 인증=저장된 회장님 refresh_token(Task A durable) · 소스 `deploy/morning_brief.js` · 단위 9/9 · 라이브.
