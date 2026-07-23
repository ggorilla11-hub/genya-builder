# v4.0 Day4 · Task 1 근본수정 · activeSkill 가로채기 (정직 재작업)

## 정직 인정
이전 "Task 1 완주" 보고는 **`sheetsCrud.runChat`을 직접 호출한 부분 실측**이었다(실제 Anthropic API였으나 Mock 아님). **회장님 질문 → `orderHandler` 라우팅 → runChat 전체 경로를 실측하지 않았다.** 그래서 리포트("라이브")와 회장님 실제 실패가 어긋났다. 배포·scope는 정상이었고, 문제는 라우팅이었다.

## 근본 원인 (100% 확정)
- `genya.html`이 `/api/order`에 `activeSkill`(=`window._ACTIVE_SKILL`)을 실어 보내고, **localStorage로 복원**한다(line 2662·2479·2642).
- 회장님이 한 번이라도 카드(예: 고객관리)를 클릭하면 `_ACTIVE_SKILL`이 계속 남아 모든 대화에 실린다.
- `orderHandler` 첫 분기 `if (activeSkill && SKILL_CTX[activeSkill])`에 걸려 **도구 없는 askClaude**로 가고, 시트·발송 분기를 못 탄다 → LLM이 "시트 연결 안 됨" 생성.

## 실측 (Mock 아님 · 실제 /api/order kind 판정)
로그인 없이 라우팅을 kind로 판정(도구 분기 도달 여부):
| 케이스 | 수정 전 | 수정 후(로컬) | 프로덕션 |
|---|---|---|---|
| activeSkill + 시트질문 | 💬 지니야(가로챔) | 🔗 데이터연결(도구분기) | 🔗 데이터연결 ✅ |
| activeSkill + 메일보내 | 💬 지니야 | 🔗 데이터연결 | 🔗 데이터연결 ✅ |
| activeSkill + 일반질문 | 💬 지니야 | 💬 지니야(맥락유지) | — |
| activeSkill 없음 + 시트질문 | 🔗 | 🔗 | — |

→ `🔗`는 로컬/무세션에서 도구 분기에 **도달했다는 증거**(회장님 로그인 세션이면 실제 시트 목록·결재 실행).

## 수정
`main_server.js` orderHandler: **명확한 도구 의도(`_toolIntent`)면 activeSkill 무시하고 도구 분기 우선.**
```
const _toolIntent = /보내|발송|알림톡|결재|승인|시트\s*(목록|...)|어떤\s*시트|내\s*(구글\s*)?시트|명단\s*(...)|고객\s*(...)|([가-힣]{2,4})\s*님?\s*(정보|...)/.test(q);
if (activeSkill && SKILL_CTX[activeSkill] && !_toolIntent) { ...askClaude... }
```
- 일반 대화의 카드 맥락은 유지(회귀 없음). 엄마1·2 무접촉(main_server만).

## 남은 최종 검증 (회장님)
로그인 세션 전체 경로(실제 시트 목록 응답)는 **회장님 로그인 실측**이 있어야 확인 가능(로그인 OAuth는 자동화 불가). 배포 main **83f011a** 라이브.
