# Step 2-1 하이브리드 라우터 — 회장님 로컬 실측 가이드

> **왜 로컬?**: 프로덕션(genya-builder.onrender.com)을 **전혀 건드리지 않고**, 회장님 PC에서 잠깐 띄워 라우팅·폴백·비용을 눈으로 확인합니다. Render 콘솔 작업 없음.
> **결과가 좋으면**: 회장님 결재 → 개발팀장이 main 병합·배포 → 프로덕션 전환. **결재 없이 배포 안 합니다.**

---

## Step 1 · 준비 (Git Bash에서)

```bash
cd C:/Users/user/Desktop/genya-builder
git checkout feature/step2-1-hybrid-router     # 이 브랜치에 Step 2-1 코드가 있어요
cd deploy
```

## Step 2 · 환경변수 확인 (.env)

`deploy` 폴더에 `.env` 파일이 있어야 합니다. 아래 두 개가 **실제 값으로** 들어 있는지 확인:

```
ANTHROPIC_API_KEY=sk-ant-...      # Claude(지니야 두뇌)
OPENAI_API_KEY=sk-...             # gpt-4o(폴백)
LOCAL_STAGING=1                   # ★로컬 실측용 — 터미널에 대화별 비용(원) 표시
```

> `.env`가 없거나 키가 비었으면, **Render 대시보드 → genya-builder → Environment** 의 값을 그대로 복사해 `deploy/.env`에 붙여넣으세요. (키 실제 값은 채팅에 붙여넣지 마세요.)

## Step 3 · 실행

```bash
npm install        # 이미 설치돼 있으면 몇 초 만에 끝나요(필요 시)
node main_server.js
```

- 뜨면 터미널에 `http://localhost:8080/login ...` 같은 줄이 보입니다. → **로컬 서버 켜짐.**
- 끄려면 터미널에서 `Ctrl + C`.

## Step 4 · 시나리오 5개 실측 (로그인 불필요 — 주소창에 붙여넣기)

지니야 두뇌는 로그인 없이도 대답합니다. **브라우저 주소창**에 아래를 붙여넣고 Enter → 화면에 JSON이 뜹니다. **`engine` 값**을 확인하세요.

| # | 주소창에 붙여넣기 | 기대 `engine` |
|---|---|---|
| 1 · SIMPLE | `http://localhost:8080/api/order?q=안녕 지니야` | **claude-sonnet-5** |
| 2 · DEEP(키워드) | `http://localhost:8080/api/order?q=재무 설계 상담 어떻게 받아요?` | **claude-opus-4-8** |
| 3 · DEEP(길이) | `http://localhost:8080/api/order?q=` 뒤에 **300자 넘는 아무 긴 문장**을 붙여넣기 | **claude-opus-4-8** |
| 4 · 폴백 | 아래 "폴백 테스트" 먼저 → `http://localhost:8080/api/order?q=요즘 어때요` | **gpt-4o** |

**폴백 테스트(시나리오 4)**: 서버를 끄고(Ctrl+C), 아래처럼 켜면 Claude를 강제로 실패시켜 gpt-4o로 넘어갑니다.
```bash
SIMULATE_CLAUDE_FAIL=1 LOCAL_STAGING=1 node main_server.js
```
확인 끝나면 다시 그냥 `node main_server.js`로 켜세요(Claude 우선 복귀).

## Step 5 · 비용 확인 & 팀장 공유

- **터미널**을 보세요. `LOCAL_STAGING=1`이면 대화할 때마다 이렇게 찍힙니다:
  ```
  [usage] claude-opus-4-8 +18원 → 오늘 누적 92원 (5건)
  ```
- 5~10건 대화 후 **누적 원화**를 팀장에게 알려주세요.
- 공유할 3가지: ① 각 시나리오 `engine`이 표대로 나왔는지 ② 누적 원화(하루 3,000~5,000원 예상) ③ 폴백이 gpt-4o로 정상 전환됐는지.

---

## 다음 (실측 성공 시)

1. 회장님 **결재**
2. 개발팀장: `git checkout main` → `git merge feature/step2-1-hybrid-router` → `git push origin main`
3. Render 자동 재배포 → 프로덕션 전환 → **Step 2-2(Pinecone RAG)** 착수

> ❗ 결재 전에는 main에 올리지 않습니다. 로컬은 회장님 PC에서만 도니 프로덕션은 그대로입니다.
