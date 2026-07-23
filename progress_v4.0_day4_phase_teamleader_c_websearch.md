# Phase 팀장-C — 실시간 웹검색(지니야 web_search) ✅ 프로덕션 배포·라이브 실측 완료

## 목표
지니야에 Anthropic `web_search` 서버도구를 통합해 뉴스·시세·판례·법령 등 **최신 정보를 실시간 조회**. 팀장(클로드 코드)의 웹검색 능력을 제품에서 재현.

## 정확한 스펙(claude-api 스킬 근거 · 메모리로 답하지 않음)
- `web_search`는 **Anthropic 서버측 도구** — 클라이언트 실행 루프 불필요, 결과가 같은 응답에 블록으로 옴. **베타 헤더 불필요.**
- 우리 모델(MODEL_SIMPLE=claude-sonnet-5, MODEL_DEEP=claude-opus-4-8)은 **최신 변형 `web_search_20260209`**(동적 필터링) 지원. → 회장님이 주신 `web_search_20250305`(구형)이 아니라 최신 변형 채택.
- 서버도구는 반복 한도 시 `stop_reason:"pause_turn"` → **어시스턴트 응답 원문 재전송으로 자동 재개**(트레일링 server_tool_use=프리필 아님·정상 resume, "이어서" 유저턴 추가 금지).

## 구현(main_server.js 3곳)
1. **askClaude**: `opts.webSearch`면 `tools:[web_search_20260209 · max_uses:3]` 부착. 루프에 `pause_turn` 재개 배선. max_uses=3=최신성 확보+응답지연 상한(무거운 DEEP 질문 2분+ 방지).
2. **orderHandler 일반대화(💬 지니야) 경로 2곳**(activeSkill 맥락·메인)에 `webSearch:true` — 도구/시트/약관/커넥터에 안 걸린 일반 질문이 여기로 오며 최신 정보를 검색.
3. **페르소나**: "최신 정보 조회(웹검색) 가능 · 지어내지 말고 검색해 확인 · 근거 곁들임" 안내 추가.

## 실측(Real Anthropic API)
- **로컬 Real API**: Sonnet5(오늘 코스피) `searched=true`·실데이터 823자 / Opus4.8(2026 종부세) `searched=true`·실데이터 852자. node --check 통과.
- **프로덕션 라이브** `/api/order`: "요즘 원달러 환율 수준이 궁금해" → 💬 지니야(claude-sonnet-5)·**18초**·실제 환율(1,481.61 개장가·52주범위·최근 1470원대 보도) 응답. 웹검색 종단 작동 확인.
- 회귀: `/login`·`/결재함`·`/api/roster/import` 전부 200.

## 라우팅 교훈(정직)
- 첫 라이브 테스트 "…확인해서 알려줘"가 시트-고객조회 정규식(`알려`)에 가로채여 데이터연결 분기로 감. → 트리거 단어 없는 질문은 정상적으로 일반대화 경로+웹검색 도달. (기존 라우팅 특성·웹검색 결함 아님.)
- 무거운 DEEP+다중검색(종부세)은 120초+ 소요 → max_uses 5→3으로 지연 상한. 프런트(genya.html·엄마1)는 무접촉.

## 무접촉 원칙
라우터 분기 로직·genya.html(엄마1)·personal_memory(엄마2) 전부 무접촉. main_server.js askClaude+persona+orderHandler 일반대화 경로만.

## 배포
- 커밋(웹검색 ec9aa34 · max_uses 튜닝 후속) → origin/main 리베이스 → FF push → Render 자동배포.
