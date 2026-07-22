# progress_v4.0 · Step 2-E 팀장 페르소나 · Day 2 (엄마2)

- **작성일**: 2026-07-22
- **브랜치**: `feature/step2-E-persona` (로컬 · 미푸시)
- **상태**: 🟢 v0.2 **회장님 승인** · genyaPersona 배선 스펙 완비(통합 시 적용)

## 오늘
### v0.1 → v0.2 (3가지 개선 반영 · 승인 완료)
1. **A/B/C+⭐ 필수**: 옵션 2개↑면 A/B/C·한 줄 설명·추천⭐·"한 마디만" 요청 · **나열형 질문 금지, 추천안 하나 명확히 밀기**
2. **짚어드림 담백화**: 형식 "팀장의 정직 짚어드림 · [개수/구조]" · 완곡표현 지양 · **"—" 자제, "·" 활용**
3. **공감(5번째 원칙)**: 마음 이해·컨디션 걱정 자연스럽게·감사존중 · 따뜻함 · **오지랖·과잉걱정 지양, 존중 우선**
- **호칭 매핑 확정**: 기본 "대표님" · `ggorilla11@gmail.com`→"회장님" · 그 외 온보딩 지정
- 파일: `deploy/prompts/team_leader_persona.md` (커밋 `36691ad`)

## genyaPersona 배선 스펙 (통합 시 적용 · 바로 붙일 수 있게 완비)

> ⚠️ **왜 지금 배선 안 하나(정직)**: 브랜치 A(개인화 메모리)가 이미 `orderHandler`를 수정. 브랜치 E에서 같은 함수를 또 고치면 병합 충돌. → **A+E 통합 시점(결재 후) 한 번에** 적용이 안전. 아래 스펙은 그때 바로 적용.

**1) 호칭 자동 감지 헬퍼 (main_server.js에 추가)**
```js
function 호칭For(email, profile) {
  if (String(email || '').toLowerCase() === 'ggorilla11@gmail.com') return '회장님';
  return (profile && profile['호칭']) || '대표님';
}
```

**2) genyaPersona 확장 (옵션 호칭 인자 · 하위호환)**
```js
function genyaPersona(job, 호칭) {
  호칭 = 호칭 || '대표님';
  // ... 기존 지니야 원칙 유지 ...
  // + 팀장 5대 원칙(리딩·챙김·정직·짚어드림·공감) + A/B/C+⭐ 규칙 블록 추가
  //   (전문은 deploy/prompts/team_leader_persona.md의 SYSTEM PROMPT를 그대로 주입)
}
```

**3) 대표 워크스페이스 대화 배선 (order 일반/activeSkill 분기)**
```js
const 호칭 = 호칭For((sessionOf(req) || {}).email, /*profile*/ null);
const sysP = genyaPersona(job, 호칭) + (memCtx ? ('\n[대표님 기억]\n' + memCtx) : '');
```
- 기존 호출부(온보딩·extract 등)는 2번째 인자 없이 그대로 → "대표님" 기본(하위호환).

## 서브태스크 진척 (명세서 E-1~E-7)
| # | 태스크 | 상태 |
|---|---|---|
| E-1~E-5 | 페르소나·호칭·리딩·짚어드림·정직 | ✅ v0.2 승인 |
| (신규) | 공감 5번째 원칙 · A/B/C+⭐ | ✅ v0.2 |
| E-6 | few-shot(회장님·팀장 실제 대화) | ⬜ Day2 예정 |
| E-7 | 실측 자연스러움(T10) | ⬜ 회장님 실측 |

## Pinecone (Step 2-A 연동)
- 로컬 `.env` 키 **대기 중**. "넣었어" 오면 즉시: 인덱스 `ohwant-genya` 생성·검증 → A-6(문서 임베딩)·A-7(생성물 저장) → 시나리오2 "어제 만든 자료 뭐였지?" 실측.

## 절대유지 4원칙
❌ ohwant-homepage(엄마1) 무접촉 · ✅ Step2-1 프로덕션 그대로 · ❌ main push 금지(결재 후) · ❌ 엄마3 브랜치(2-B·2-C·2-D) 무접촉.

## 다음
1. **회장님**: Pinecone 키 로컬 복사 "넣었어" → Day 2 라이브(Step 2-A) 즉시
2. E-6 few-shot 보강 → E-7 실측
