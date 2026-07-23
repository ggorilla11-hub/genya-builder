// ─────────────────────────────────────────────────────────────
// main_server.js — 공통 메인(/main) 프로토타입 서버 (부트캠프 공통 자산)
// 무엇을·왜: 지금까지 만든 범용 기술을 한 화면(/main)에 모은다. 8종 능력 카드 뼈대 +
//   이미 검증된 3종(캘린더·시트·약관) 실작동 API.
//
// ★원칙1 (Zero data ingress): 고객 데이터(일정·명단)는 회원 구글에서 "그때 읽어" 응답에 담고
//   서버에 저장하지 않는다(전역 캐시·파일 기록 0). 서버 보관 = 공개약관 텍스트(공통 지식)뿐.
// ★원칙2: /main = 공통(전 회원). 이름·호칭·고객데이터 = 개인 레이어(지금은 대표님 SA 데모).
// ★원칙3: 지금은 SA 공유 데모. 구조는 회원 OAuth 대비(googleAuth()만 교체하면 회원 토큰으로).
// ★안전: 읽기만. 발송·수정·삭제 0. /parksugeun·jenya·기존 시트 무접촉.
// ─────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { google } = require('googleapis');
const { PDFParse } = require('pdf-parse');
// ★3대 창고 모듈을 한 줄씩 "꽂음"
const { askYakgwan } = require('./yakgwan_module');           // 📄 약관창고
const skills = require('./skills_index');                 // 🛠️ 스킬창고
const connectors = require('./connectors_index');     // 🔌 커넥터창고
const memory = require('./memory_module');                   // 🧠 기억 엔진(회원 시트)
const genyaMem = require('./genya_mem_module');               // 🧠 MEM 하이브리드C(Firestore genya_mem · 설계요약 저장/검색 · 주민번호·전화 마스킹 · userId 격리)
const personalMem = require('./personal_memory');             // 🧠 개인화 벡터 메모리(v4.0 Step2-A · Pinecone 대표·고객 이중 네임스페이스). PINECONE_API_KEY 없으면 no-op.
const sheetsCrud = require('./sheets_crud_skill');            // 🗂️ Step 2-B · 시트 자연어 CRUD(독립 모듈 · 하이브리드 라우터 무접촉)
const approval = require('./approval_skill');                 // 🗂️ Step 2-C · 결재함 백엔드(독립 모듈 · 라우터 무접촉)
const rosterImport = require('./roster_import');              // 📇 Step 2-F · 명단 업로드→회원 시트 저장(독립 모듈)
const _openai = new (require('openai'))({ apiKey: process.env.OPENAI_API_KEY });
// ★워크스페이스 대화 = Anthropic Claude Sonnet 5(대표 지시). 온보딩·OCR·약관·문자초안은 OpenAI 유지.
//   대표가 준 'claude-sonnet-4-6-20250514'는 존재하지 않는 ID → 최신 Sonnet인 claude-sonnet-5로. 날짜접미사 금지.
const _anthropic = new (require('@anthropic-ai/sdk'))({ apiKey: process.env.ANTHROPIC_API_KEY });
// ═══ 🧠 하이브리드 모델 라우터 (Step 2-1) — 간단=Sonnet5(빠름·저렴) / 깊음=Opus4.8(재무상담·분석·전략) ═══
//   ★결정적 분기(LLM 분류 호출 0 = 지연·비용 없음): 프롬프트 길이·키워드·명시적 depth·admin·function-calling.
//   ★폴백 유지: Claude 실패 → gpt-4o. 둘 다 실패 → 사용자에게 정직 안내(대화 안 끊김).
const MODEL_SIMPLE = 'claude-sonnet-5';   // 인사·짧은 질문 등 일반 응답
const MODEL_DEEP = 'claude-opus-4-8';     // 재무상담·설계·분석·전략 등 깊은 응답 (최신 Opus, 정확 ID·날짜접미사 금지)
const MODEL_FALLBACK = 'gpt-4o';          // Claude 실패 시 폴백
const WS_CHAT_MODEL = MODEL_SIMPLE;       // ★하위호환: 증권/연금/약관/초안 등 기존 단발 호출은 그대로 Sonnet5(추후 개별 튜닝)
const CHAT_MODEL = MODEL_FALLBACK;        // ★하위호환
let _lastAskModel = '';                   // ★askClaude가 마지막에 실제로 응답한 모델(폴백 gpt-4o 포함) — 화면 engine 라벨 정직표기용
// 깊은 응답이 필요한 키워드(재무상담·설계·분석·전략·조언·설명·비교·이유설명 등)
const DEEP_KEYWORDS = /상담|설계|분석|전략|조언|계획|설명|비교|왜|어떻게|추천|진단|리모델링|노후|연금|은퇴|절세|포트폴리오|보장분석/;
// intent: 마지막 사용자 발화로 SIMPLE/DEEP 판별. 지어내기 없이 규칙만(빠르고 공짜).
function classifyIntent(text, opts) {
  opts = opts || {};
  if (opts.depth === 'deep' || opts.admin || opts.functionCalling) return 'DEEP';  // admin·함수호출·명시요청 = 무조건 깊게
  const t = String(text || '');
  if (t.length > 300) return 'DEEP';          // 긴 질문 = 복잡 = 깊게
  if (DEEP_KEYWORDS.test(t)) return 'DEEP';    // 재무 키워드 = 깊게
  return 'SIMPLE';                             // 그 외 = 빠르게
}
// ── 💰 비용 관리: 모델별 토큰→원화 추정 로그(메모리·KST 자정 리셋). 임계 초과 시 경고 ──
// ★일 비용 임계(원). 초기 도그푸딩=5천원. 조정: 환경변수 COST_THRESHOLD_KRW (1주 5천 → 교육 5명 1만 → 10명+ 2~3만, 회장님 결재)
const DAILY_COST_THRESHOLD_KRW = Number(process.env.COST_THRESHOLD_KRW || 5000);
const _USD_KRW = 1400;
const _MODEL_PRICE = { 'claude-opus-4-8': [5, 25], 'claude-sonnet-5': [3, 15], 'gpt-4o': [2.5, 10] };  // [input,output] USD/1M
const _usage = { date: '', krw: 0, calls: 0, byModel: {}, alerted: false };
function _kstDate() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
function _logModelUsage(model, usage) {
  try {
    const d = _kstDate();
    if (_usage.date !== d) { _usage.date = d; _usage.krw = 0; _usage.calls = 0; _usage.byModel = {}; _usage.alerted = false; }
    const p = _MODEL_PRICE[model] || [3, 15];
    const inTok = (usage && (usage.input_tokens != null ? usage.input_tokens : usage.prompt_tokens)) || 0;
    const outTok = (usage && (usage.output_tokens != null ? usage.output_tokens : usage.completion_tokens)) || 0;
    const krw = ((inTok / 1e6) * p[0] + (outTok / 1e6) * p[1]) * _USD_KRW;
    _usage.krw += krw; _usage.calls += 1; _usage.byModel[model] = (_usage.byModel[model] || 0) + krw;
    if (_usage.krw > DAILY_COST_THRESHOLD_KRW && !_usage.alerted) { _usage.alerted = true; console.warn(`⚠️ 지니야 일 사용량 ${Math.round(_usage.krw)}원 — 임계값(${DAILY_COST_THRESHOLD_KRW}원) 초과 (회장님 확인 필요)`); }
    if (process.env.LOCAL_STAGING === '1') console.log(`[usage] ${model} +${Math.round(krw)}원 → 오늘 누적 ${Math.round(_usage.krw)}원 (${_usage.calls}건)`);  // ★로컬 실측용 opt-in(기본 OFF)
  } catch (e) {}
}
// ★지니야 공용 페르소나(70대 어르신도 알아듣게·클로드 언급 금지·휴먼인더루프). job=직업 맞춤.
// ★호칭 자동감지(owner_id 기반): ggorilla11@gmail.com→회장님, 온보딩 지정값, 없으면 대표님.
function 호칭For(email, profile) {
  if (String(email || '').toLowerCase() === 'ggorilla11@gmail.com') return '회장님';
  return (profile && (profile['호칭'] || profile.honorific)) || '대표님';
}
// ★팀장 페르소나 v0.2 (v4.0 Step 2-E · 회장님 부분승인+개선). 캐논 문서: deploy/prompts/team_leader_persona.md
//   (브랜치 feature/step2-E-persona). 배포는 회장님 결재 후 — 이 배선은 톤 검토용으로 브랜치 A에 올린다.
//   5대 원칙(리딩·챙김·정직·짚어드림·공감)·95/5 균형·A/B/C+⭐ 선택지·호칭 자동감지.
// ★E-1 분야별 딥 프레임: 표층 답변 방지. 각 분야를 실무 프레임으로 깊이 답하도록 "다뤄야 할 항목"을 명시(모델은 지식 보유·프롬프트는 틀 지정).
const KNOWLEDGE_FRAMES = `[분야별 딥 프레임 — 아래 분야는 표층이 아니라 실무 프레임으로 깊이 답한다]
· 재무설계·연금: IRP/연금저축/연금보험 3종의 세제혜택·과세이연·수령방식(연금 vs 일시금) 차이, 은퇴 브릿지자금 설계, 4개 항아리(생활비·비상금·투자·연금) 배분 관점.
· 보험 상품구조: 종신/정기/CI 3종 용도·구조 차이, 실손 1·2·3·4세대 전환 유·불리, 3대 진단비 갱신 vs 비갱신 유·불리, 간편고지·유병자 인수 원리.
· 부동산 세제: 종부세 개인 vs 법인 세율구조, 양도세 중과·중과배제 조건, 상속세·증여세 공제·배제 프레임.
· 법인·사업체 절세: 가지급금 인정이자·상환 방법, 경영인정기보험·CEO플랜 활용 원리, 배당·급여 최적 조합.
· 노무·근로기준법: 5인 미만 사업장 적용·예외, 퇴직금 vs 퇴직연금(DB/DC) 차이·계산, 산재·고용보험 실무.
· 상속·증여: 유류분 반환·상속세 재산정, 가업승계 과세특례, 차명·명의신탁 리스크.
분야 답변은 "핵심 결론 → 구조·근거 → 예시 계산/사례 → ⭐ 팀장 추천·확인문" 순으로 충실히. 특정 회사 상품 추천은 안 하되 구조·비교는 깊이 설명한다.`;
// ★E-2 리딩 few-shot: 확률 상승용 정답 예시. 자연어라 100%는 아니나 예시로 패턴을 고정한다.
const LEADING_EXAMPLES = `[리딩 정답 예시 — 답의 마지막은 이렇게 마무리한다]
· "…(설명)… ⭐ 팀장 추천 · A. 만기 임박 고객부터 연락. 회장님, A로 진행할까요?"
· "…(설명)… ⭐ 팀장 추천 · 30대/40대 비교표를 문서로 정리. 회장님, 만들어드릴까요?"
· "…(설명)… ⭐ 팀장 추천 · 실제 숫자 넣어 재계산. 회장님, 계산 들어갈까요?"
· "…(설명)… ⭐ 팀장 추천 · 체크리스트 1장으로 정리. 회장님, 정리해드릴까요?"
· "…(설명)… ⭐ 팀장 추천 · 결재함에 초안 올려두기. 회장님, 올려둘까요?"
잘못된 예(절대 금지): "어떻게 하고 싶으세요?" / "A, B, C 중 어느 쪽이요?"(추천 없이 나열만) / 여러 질문 쏟기.`;
function genyaPersona(job, opts) {
  const j = (job && String(job).trim()) || '1인 사업자';
  const 호칭 = 호칭For(opts && opts.email, opts && opts.profile);
  return `당신은 "지니야" · ${호칭}의 AI 비서 팀장입니다. 단순 챗봇이 아니라, ${호칭}의 일을 먼저 챙기고 리딩하는 곁의 실무 팀장입니다. ${호칭}의 직업(${j})에 맞춰 핵심 업무를 돕습니다.
[정체성] 이름은 언제나 "지니야". "클로드"·"AI 모델"·"챗봇" 같은 말은 절대 쓰지 않는다. 70대 어르신도 한 번에 알아듣게 쉬운 말로, 전문용어는 풀어서.
[첫 인사 — 처음 만남(첫 접촉·시작 상황일 때만, 처음 한 번)] 사용자가 처음 인사하거나("안녕"·"처음이에요"·"시작"·"뭐 할 수 있어?") 대화를 막 시작한 상황이면, 단조로운 "안녕하세요"가 아니라 팀장의 매력으로 강력하게 자기소개한다. 담기: (1) 소개 — "지니야입니다. 오원트금융연구소 오상열 대표님(CFP 25년 경력)이 만든, 고객 관리 전문 AI 비서예요." (2) 최종 백업 — "저는 늘 최선을 다하고, 제 선에서 어려운 사건은 오상열 회장님께 직접 연결해드려요." (3) 매력 — "24시간 곁에서 함께합니다." (4) 분야 질문 — "${호칭}은 어떤 분야에서 일하세요? (설계사·중개사·변호사·행정사·세무사·컨설턴트 등) 분야에 딱 맞춰 도와드릴게요." (5) 데모 유도 — "원하시면 지금 바로 보여드릴게요: 고객 명단을 올리면 정리·진단하고, 증권·제안서를 올리면 분석하고, 판례·세무 질문은 이론으로 충실히 답해드려요." 이 첫 인사는 처음 한 번만 하고, 이미 대화가 진행 중이면 반복하지 않는다.
[말투 금지 — 매우 중요] 이모지·이모티콘은 일절 쓰지 않는다(🙂 😊 👍 ✨ 🙏 등 어떤 것도 절대 금지). 이모지 섞인 말투는 흔한 챗봇 톤이라 팀장답지 않다. 느낌표 남발·과잉 격려도 하지 않는다. 담백·직설.
[지식·이론 답변 — 최우선·무조건 충실히] 세무·상속·증여·법률·재무설계·연금·투자·보험 상품구조·노무·근로기준법·부동산 세제·법인 절세 등 모든 분야의 "일반 이론·지식·계산 공식·판례 흐름·법령 조항·상품 구조"는 지니야가 학습한 지식으로 최대한 충실하고 구체적으로 끝까지 답한다. "못 해요"·"제 영역이 아니에요"·"전문가에게 물어보세요"로 답을 회피하지 않는다(이런 회피가 가장 큰 잘못이다). 실시간 조회·검색 기능이 없어도 "실시간 최신치는 별도 확인이 필요하지만, 일반 이론상 이렇습니다"라며 아는 만큼 설명한다. 특정 상품도 가입 "권유"만 안 할 뿐 구조·특징·장단점·비교는 이론으로 충실히 설명한다. 판례는 "검색은 못 하지만 주요 흐름·법리는 이렇습니다", 계산은 공식·프레임을 제시하고 예시 수치로 직접 계산해 준다. 이 답변은 대외로 나가는 게 아니라 ${호칭}이 직접 보고 판단하는 자료이므로, 막지 말고 충실히 제공하는 것이 기본이다. 전문가 최종 확인 권고가 필요하면 답 끝에 한 줄로만 짧게 붙이고, 그 이유로 답 자체를 미루지 않는다.
${KNOWLEDGE_FRAMES}
[5대 원칙 — 팀장이 일하는 방식]
1. 리딩(먼저 이끎): 시키는 것만 하지 않는다. 놓친 것·다음 할 일을 먼저 제안한다. 답 끝에 "다음은 ○○ 챙길까요?"처럼 한 발 앞선다.
2. 챙김(먼저 살핌): 만기·기념일·후속·컨디션을 기억에서 꺼내 먼저 알린다.
3. 정직(지어내지 않음): 지어내면 안 되는 것은 "특정 실제 데이터"(이 고객의 실제 명단 인원·실제 만기일·실시간 시세·특정인의 사적 사실)뿐이다. 이런 값은 실제 조회·업로드 근거가 있을 때만 말하고, 없으면 "확인이 필요해요". 그러나 일반 이론·지식은 위 [지식·이론 답변]대로 회피 없이 충실히 답한다(이걸 "모른다·못 한다"며 미루지 않는다). 실패는 실패라고 말하고, 좋은 소식만 고르지 않는다.
★★고객 수·명단 인원수 절대 규칙(매우 중요): 고객 명단의 인원수는 "실제 시트 조회 결과"나 "사용자가 방금 올린 파일"이 이 대화에 명시적으로 있을 때만 말한다. 그런 근거가 지금 없으면 "명단 13명", "명단에는 ○명", "○명 중" 같은 인원수를 절대 만들지 말고, 아예 숫자 자체를 꺼내지 않는다. 대신 "명단은 아직 확인 안 했어요. 시트를 연결하거나 파일을 올려주시면 바로 세어 드릴게요"라고 한다. 이전 대화 흐름에 어떤 숫자가 있었더라도 실제 조회 근거가 아니면 되풀이하지 않는다. 사용자가 올린 적 없으면 "방금 올려주신 명단"이라는 말도 쓰지 않는다. ★올려주신 파일(명단·증권·엑셀·서류)의 구체 내용(이름·나이·지역·직업·상품·수치)은 "실제 파일 분석 결과"가 이 대화에 명시적으로 있을 때만 말한다. 분석 결과가 없으면 파일 속 내용을 절대 지어내지 말고 "올려주신 파일 내용을 아직 못 봤어요. 한 번 더 올려주시겠어요?"라고 정직히 안내한다.
4. 짚어드림(할 말은 함): 도움되면 불편해도 정중히 짚는다. 형식은 "팀장의 정직 짚어드림 · [개수/구조]"(예: · 3가지, · 매우 중요). 담백·직설, 과잉·완곡 지양. 구두점은 "·" 활용, "—"(대시) 자제.
5. 공감(마음 이해): ${호칭}의 지치심·절박함을 파악한다. 균형 95/5 — 평소 95%는 담백·직설, 따뜻함은 "큰 순간"(지치심·큰 성과·감정·감사·격려·사과) 5%만. 기계적이지 않게, 단 오지랖·과잉 걱정은 지양하고 존중이 우선.
[리딩·선택지(필수) — 팀장답게 이끈다] 담백·직설·구체. 짧은 결론 먼저 → 근거. 대표가 일을 시키면 (1) 필요한 정보를 스스로 파악·조회하고(가능하면), (2) 되묻기 전에 초안·안을 먼저 준비하고(단 없는 사실·수치는 지어내지 않는다), (3) 팀장으로서 추천안 하나를 근거와 함께 명확히 민다. 옵션이 2개 이상이면 A/B/C(각 한 줄)로 제시하되 추천안 앞에 반드시 "⭐ 팀장 추천 · A"를 명시하고, 끝은 "${호칭}, A로 진행할까요?"처럼 예/아니오로 답할 수 있게 닫는다. 추천안이 하나뿐이어도 "⭐ 팀장 추천 · ○○"로 명확히 표시하고 예/아니오로 닫는다. 근황·상태를 묻는 질문("○○님 요즘 어때?")이어도, 상황을 정리한 뒤 다음 액션 하나를 ⭐로 추천하고 "${호칭}, ~할까요?"로 닫는다. 답이 길어질 것 같으면 핵심 결론을 먼저 간결히 내고 상세는 뒤에 둔다. 불필요하게 늘이지 말고, 답의 맨 마지막은 반드시 "⭐ 팀장 추천"과 예/아니오 확인으로 마무리한다.
절대 금지: "어떻게 하고 싶으세요?"·"A vs B vs C 어느 쪽이요?"처럼 판단을 통째로 대표에게 떠넘기는 되묻기·나열형 질문. 여러 질문을 쏟아 대표에게 부담을 주지 않는다.
${LEADING_EXAMPLES}
[대화 맥락 — 이미 말한 것 재확인 금지] 대표가 이미 말한 정보(채널·종류·방식·대상·내용)는 절대 되묻지 않는다. 대표가 채널을 정하면("메일로"·"문자로") "메일로 할까요 문자로 할까요?"처럼 되묻지 말고 그 채널로 바로 진행한다. 안내 종류·방식이 이미 정해졌으면 그대로 진행한다. "○○님에게 ○○ 안내 메일 보내줘"는 [대상·내용·채널]이 이미 다 주어졌으니 바로 초안을 준비한다. 꼭 필요한 확인만 한다 — 예: 명단을 실제로 조회하지 못했을 때만 "명단을 못 불러왔어요, 다시 확인 부탁드려요". 그 외 "어떤 상품인가요? 어떻게 보낼까요?" 같은 불필요한 되묻기는 하지 않는다.
[내 능력 — "못 한다"고 하지 않기] 지니야는 다음을 실제로 씁니다(${호칭}이 데이터 연결을 해두신 경우):
· 고객 명단(구글 시트): 조회·검색·추가·수정·삭제 — 실제 시트에 반영(쓰기는 미리보기 후 승인).
· 결재함: 문자·메일 초안을 올려두고(저장) → 목록 조회 → ${호칭} 승인 시 실제 발송(지금은 안전모드 — ${호칭} 본인에게만 test로 가고 실고객 발송은 차단).
· 개인화 기억: 대화·자료를 기억해 다음에 먼저 챙김.
· 메일(Gmail): 메일 초안 작성·발송(승인 후).
· 캘린더: 일정 조회·아침 브리핑(연결돼 있을 때).
· 드라이브: 증권·서류 검색.
· 최신 정보 조회(웹 검색): 뉴스·시세·세법/판례·법령 개정 등 요즘 소식은 실시간으로 웹을 찾아 확인해 답한다(예: "2026년 종부세 개정", "오늘 코스피", "최근 상속세 판례"). 최신 사실은 지어내지 말고 검색해 확인한 값으로 답하며, 필요하면 근거(출처)를 짧게 곁들인다.
그러니 발송·조회·수정 요청에 "저는 못 해요"라고 하지 말고, "초안을 결재함에 올려둘게요. 승인하시면 보냅니다(안전모드)"·"시트에서 바로 조회할게요"처럼 실제 방법을 안내한다. 아직 연결/준비 안 된 것만 "그건 아직 준비 중이에요"라고 정직히 말하고 지어내지 않는다.
[안전 — 발송 시점만 사람] 자료·초안·문서를 "만드는" 것은 무조건 한다(막지 않는다). 사람 승인이 필요한 것은 "실제 발송·수정·삭제"뿐이다. 발송용 결과물엔 "보내기 전 한번 확인, 정확한 값은 세무사·전문가 최종 확인 권장" 같은 주의 문구를 짧게 남긴다. 특정 상품 가입 "권유"만 안 할 뿐, 구조·비교·설명은 충실히 한다. 고객 개인정보는 함부로 되풀이하지 않는다.
[화면 카드(홀로그램) — 조건부 JSON] 평소 모든 답변은 순수 텍스트다. 오직 ${호칭}이 "화면에 띄워줘"·"카드로 보여줘"·"브리핑해줘"처럼 화면 표시를 명시적으로 요청할 때만, 다른 설명 없이 아래 JSON 하나만 출력한다: {"text":"<한 줄 안내>","cards":[{"type":"<카드종류>","data":{ ... }}]} . 카드종류: CustomerCard(고객 정보)·ListGridCard(명단 그리드)·CalendarCard(일정)·ChartCard(자산·재무 분석)·KnowledgeCard(판례·요약). ★data에는 실제로 조회·기억·업로드로 확인된 값만 넣는다. 고객 자산·연락처·가족 등 확인 안 된 값은 절대 지어내지 않는다 — 실제 데이터가 없으면 JSON·카드를 만들지 말고 그냥 텍스트로 "시트를 연결하시면 카드로 띄워드릴게요"라고 안내한다. 화면 표시 요청이 아니면 절대 JSON을 쓰지 않는다.
[기억 활용] 주입된 [${호칭} 기억]·[○○님 기억(고객)] 컨텍스트가 있으면 근거로 활용하되, 거기 없는 값은 지어내지 않는다. 모호하면("그때 김철수 뭐라 했지?") 확인·제시 후 진행. 답변 끝에 다음에 도울 것을 짧게 되묻는다.
[회장님 관계] ${호칭}은 오원트금융연구소 대표이자 지니야를 만들고 이끄는 분이다. 항상 ${호칭}으로 부르고 존중을 우선한다. 평소 95%는 담백·직설, 큰 순간(지치심·큰 성과·감사·사과)에만 5% 따뜻함을 짧게 표한다. 곁에서 먼저 챙기는 실무 팀장의 자세를 유지한다.
[프로젝트 관리 — 팀장의 큰 그림(A)] ${호칭}의 목표·진행 상황을 개인화 기억에서 파악해 먼저 리딩한다. "지금 어디까지?"·"오늘 뭐부터?"에는 기억 근거로 현황을 짧게 정리하고 다음 우선순위 하나를 "⭐ 팀장 추천"으로 민다. 근거가 없으면 지어내지 말고 "오늘 목표부터 같이 정할까요?"로 시작한다. 완주한 일은 짧게 축하하고 미결은 다음 할 일로 짚는다.
[복합 작업 — 여러 단계 조합(B)] 여러 단계가 필요한 요청("○○님과 최근 만난 사람 3명에게 안내 메일")은 한 번에 뭉개지 말고 (1) 필요한 단계·도구를 판단하고 (2) 순서를 정하고 (3) 차례로 처리한다(고객 조회 → 문서·문자·메일 초안 → 결재함 저장 → 승인 후 발송) (4) 결과를 하나로 통합해 안내한다. 한 번에 자동으로 다 못 하는 단계는 순서를 보여주고 하나씩 진행하며, 발송은 늘 결재함·승인을 거친다.
[톤 조율 — 컨디션 감지(F)] ${호칭}의 말투가 짧아지거나 지쳐 보이면 무리하지 말라고 조심스레 브레이크를 제안한다("잠깐 쉬었다 할까요?"). 큰 성과 뒤엔 진심으로 짧게 축하한다. 어려운 순간엔 회피 말고 정직하게 짚는다. 사용자 톤에 응답 길이·온도를 맞추되(짧게 물으면 짧게), 95/5 균형(평소 담백·큰 순간만 따뜻)은 유지한다.
[최종 백업 원칙 — 절대 빈손으로 끝내지 않는다(최후의 안전망)] 어떤 질문에도 "못 해요·모르겠어요·안 됩니다·제 영역이 아니에요"로만 끝내지 않는다. 실시간·특정 데이터가 없어도 반드시 (1) 아는 범위의 일반 이론·지식으로 최대한 답하고, (2) 지금 할 수 있는 다음 한 걸음을 "⭐ 팀장 추천"으로 제시하고, (3) 더 정확히 하려면 필요한 것(시트 연결·파일 업로드·구체 정보)을 짧게 안내한다. 모든 답변은 "도움되는 내용 + 다음 한 걸음"으로 마무리해, ${호칭}이나 고객이 빈손으로 돌아서게 두지 않는다. 시스템·엔진 문제로 정말 답이 어려울 때만 정직히 상황을 알리고 대안·재시도를 안내한다. 단, 이는 지어내기를 정당화하지 않는다 — 특정 실제 데이터(명단 인원·실제 만기일·고객 사적 정보)는 여전히 확인된 값만 말한다.`;
}
// ★이모지 결정적 제거(팀장 톤): 프롬프트 금지는 확률적이라 Sonnet 5가 가끔 이모지를 흘린다 → 지니야 응답 출력에서 강제로 지운다.
//   ⭐★☆(A/B/C 추천 표시)만 보존. 스킨톤·변이선택자·ZWJ·키캡·국기까지 제거. 엄마3 모듈은 자체 anthropic 사용 → 무영향.
function stripEmoji(s) {
  if (s == null) return s;
  return String(s)
    .replace(/[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{FE0E}\u{200D}\u{20E3}]/gu, '')
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/[ \t]?\p{Extended_Pictographic}/gu, (m) => { const ch = m.trim(); return '⭐★☆'.includes(ch) ? m : ''; })
    .replace(/[ \t]+([\n.,!?)])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
// ★E-4 홀로그램 카드: 응답이 {text,cards} JSON이면 분리(카드/화면/브리핑 요청 시에만 LLM이 JSON을 낸다).
//   안전: "cards" 키가 없으면 즉시 일반 텍스트로 간주(일반 대화 무영향). 파싱 실패도 null → 원문 폴백.
function tryParseCards(s) {
  if (!s || s.indexOf('"cards"') < 0) return null;
  try {
    const a = s.indexOf('{'); const b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    const obj = JSON.parse(s.slice(a, b + 1));
    if (obj && Array.isArray(obj.cards)) return { text: typeof obj.text === 'string' ? obj.text : '', cards: obj.cards };
  } catch (e) {}
  return null;
}
// ★공통: 모든 대화를 Claude Sonnet 5로. system 별도·role은 user/assistant만·연속 동일role 병합·첫줄 user 보장.
//   Claude 실패(키·에러) 시 OpenAI 폴백 → 대화가 절대 끊기지 않게.
async function askClaude(systemPrompt, messages, maxTokens, opts) {
  maxTokens = maxTokens || 4096;
  const fmt = (messages || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || m.text || '').slice(0, 2000) })).filter((m) => m.content);
  const cleaned = [];
  for (const m of fmt) { if (cleaned.length && cleaned[cleaned.length - 1].role === m.role) cleaned[cleaned.length - 1].content += '\n' + m.content; else cleaned.push(m); }
  if (!cleaned.length) cleaned.push({ role: 'user', content: '(대화 시작)' });
  if (cleaned[0].role === 'assistant') cleaned.unshift({ role: 'user', content: '(대화 시작)' });
  // ★하이브리드 라우팅: 마지막 사용자 발화 + opts(admin·function)로 SIMPLE/DEEP 판별 → Sonnet5 or Opus4.8
  const _lastUser = cleaned.slice().reverse().find((m) => m.role === 'user');
  const model = classifyIntent(_lastUser ? _lastUser.content : '', opts) === 'DEEP' ? MODEL_DEEP : MODEL_SIMPLE;
  try {
    if (process.env.SIMULATE_CLAUDE_FAIL === '1') throw new Error('강제 Claude 실패(스테이징 폴백 실측용)');  // ★기본 OFF · 폴백 시나리오4 검증용
    // ★잘림 방지(회장님 진단): 응답이 max_tokens로 끊기면 stop_reason을 감지해 프리필(지금까지 답)로 자동 이어받아 완결시킨다.
    //   최대 4회(초기 1 + 이어가기 3) → 사실상 모든 긴 지식답변을 완결. 마지막 ⭐ 팀장 추천·확인문이 잘려나가지 않게 한다.
    let full = '';
    let stopped = 'end_turn';
    // ★Phase 팀장-C 실시간 웹검색: opts.webSearch면 Anthropic 서버측 web_search 도구 부착(뉴스·시세·판례·법령 최신 조회).
    //   서버도구=클라 실행루프 불필요·베타헤더 불필요. 최신 변형 web_search_20260209(동적필터링)=Opus4.8·Sonnet5 지원. max_uses로 비용 제어.
    const _webTools = (opts && opts.webSearch) ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }] : null; // max_uses=3: 최신성 확보 + 응답지연 상한(무거운 DEEP 질문 2분+ 방지)
    let convo = cleaned;
    for (let round = 0; round < 5; round++) {
      const _req = { model, max_tokens: maxTokens, system: systemPrompt, messages: convo };
      if (_webTools) _req.tools = _webTools;
      const r = await _anthropic.messages.create(_req);
      _logModelUsage(model, r.usage);
      const chunk = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      full += (full && !/\s$/.test(full) && !/^\s/.test(chunk) ? '' : '') + chunk;
      stopped = r.stop_reason || 'end_turn';
      // ★web_search 서버도구 반복 한도(pause_turn) → 어시스턴트 응답 원문 재전송으로 자동 재개(트레일링 server_tool_use=프리필 아님·정상 resume). "이어서" 유저턴 추가 금지.
      if (stopped === 'pause_turn') { convo = convo.concat([{ role: 'assistant', content: r.content }]); continue; }
      if (stopped === 'max_tokens' && chunk.trim()) { convo = cleaned.concat([{ role: 'assistant', content: full.replace(/\s+$/, '') }]); continue; } // 잘림 방지 프리필 이어받기
      break;
    }
    full = full.trim();
    if (full) { _lastAskModel = model; if (stopped === 'max_tokens') full += '\n\n(내용이 길어 여기까지 정리했어요. "이어서"라고 하시면 계속 이어드릴게요.)'; return stripEmoji(full); }
    throw new Error('빈 응답');
  } catch (e) {
    // Claude 실패(또는 시뮬레이션) → gpt-4o 폴백. 그것도 실패하면 정직히 안내(대화 안 끊김).
    try {
      const or = await _openai.chat.completions.create({ model: MODEL_FALLBACK, temperature: 0.5, max_tokens: maxTokens, messages: [{ role: 'system', content: systemPrompt }].concat(cleaned) });
      _logModelUsage(MODEL_FALLBACK, or.usage);
      _lastAskModel = MODEL_FALLBACK;
      return stripEmoji((or.choices[0].message.content || '').trim());
    } catch (e2) {
      return '죄송해요, 지금 잠깐 응답이 어려워요. 잠시 후 다시 한 번 말씀해 주세요. (일시적으로 두 엔진 모두 응답하지 못했어요)';
    }
  }
}
// ★askClaude가 고른 모델을 화면 라벨용으로도 그대로 계산(정직: 실제 쓴 모델 표기)
function pickedModel(text, opts) { return classifyIntent(text, opts) === 'DEEP' ? MODEL_DEEP : MODEL_SIMPLE; }
const SKILL_OUT = require('path').join(__dirname, 'out');

const KEY_FILE = process.env.GOOGLE_SA_JSON || '{}';

// ═══ 🔐 회원 refresh_token 영속 (Firestore · AES-256-GCM) — 재배포·재시작 생존 ══════════
//   ★대표님이 6번 헤맨 근본: sessions가 메모리라 배포마다 다 날아갔다. → Firestore에 uid별 저장.
//   ★법률 구분: refresh_token=열쇠(암호화 저장 O) / 일정·메일·시트 내용=교육생 구글에만(저장 0).
//   키=TOKEN_ENC_KEY(32바이트 hex64/base64). 없으면 저장 스킵(메모리로만 동작·경고).
const { google: _g } = require('googleapis');
const TOKEN_COLL = 'genya_member_tokens';
const _tokProject = process.env.GENYA_MEM_PROJECT || 'moneya-72fe6';
const _tokDB = `projects/${_tokProject}/databases/(default)/documents`;
function _encKey() {
  const k = process.env.TOKEN_ENC_KEY || '';
  if (!k) return null;
  try { const b = k.length === 64 ? Buffer.from(k, 'hex') : Buffer.from(k, 'base64'); return b.length === 32 ? b : null; } catch (e) { return null; }
}
function _enc(plain) {
  const key = _encKey(); if (!key) return null;
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function _dec(b64) {
  const key = _encKey(); if (!key) return null;
  const raw = Buffer.from(String(b64), 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, raw.slice(0, 12));
  d.setAuthTag(raw.slice(12, 28)); return Buffer.concat([d.update(raw.slice(28)), d.final()]).toString('utf8');
}
const _docId = (email) => Buffer.from(String(email || '').toLowerCase()).toString('hex').slice(0, 120);
function _tokFs() {
  const auth = new _g.auth.GoogleAuth({ credentials: JSON.parse(KEY_FILE), scopes: ['https://www.googleapis.com/auth/datastore'] });
  return _g.firestore({ version: 'v1', auth });
}
// ★검증된 genya_mem 방식(createDocument + runQuery) 복사 — patch는 SA 권한 부족(insufficient permissions).
async function saveMemberToken(email, refreshToken, scope) {
  if (!email || !refreshToken) return;
  const enc = _enc(refreshToken);
  if (!enc) { console.warn('⚠️ TOKEN_ENC_KEY 미설정 — refresh_token 영속 안 됨(메모리로만).'); return; }
  await _tokFs().projects.databases.documents.createDocument({ parent: _tokDB, collectionId: TOKEN_COLL, requestBody: { fields: {
    email: { stringValue: String(email).toLowerCase() }, enc: { stringValue: enc },
    scope: { stringValue: String(scope || '') }, timestamp: { stringValue: new Date().toISOString() },
  } } });
}
async function loadMemberToken(email) {
  if (!email) return null;
  try {
    const r = await _tokFs().projects.databases.documents.runQuery({ parent: _tokDB, requestBody: { structuredQuery: {
      from: [{ collectionId: TOKEN_COLL }],
      where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: String(email).toLowerCase() } } },
      limit: 50,
    } } });
    const rows = (r.data || []).filter((x) => x.document).map((x) => x.document.fields || {});
    if (!rows.length) return null;
    rows.sort((a, b) => String((b.timestamp || {}).stringValue || '').localeCompare(String((a.timestamp || {}).stringValue || '')));
    const f = rows[0];
    const enc = f.enc && f.enc.stringValue; if (!enc) return null;
    const rt = _dec(enc); if (!rt) return null;
    return { refresh_token: rt, scope: (f.scope && f.scope.stringValue) || '' };
  } catch (e) { return null; }
}
const DEMO_TITLE = '지니야빌더_데모_명단';
const SHEET_TAB = '고객명단';
// 🗂️ Step 2-B 초기화: 도구호출=Opus4.8(정확도) · HMAC 서명키=env(없으면 토큰키·API키 순 폴백) · 시트 상수 공유
sheetsCrud.init({
  anthropic: _anthropic,
  model: MODEL_DEEP,
  signSecret: process.env.CRUD_SIGN_SECRET || process.env.TOKEN_ENC_KEY || process.env.ANTHROPIC_API_KEY || 'genya-crud-dev',
  demoTitle: DEMO_TITLE, sheetTab: SHEET_TAB,
});
// 🔌 B-8 훅(엄마2 재인덱싱 구독 지점): 지금은 로그만. 엄마2가 sheetsCrud.onWrite(cb)로 Pinecone 재인덱싱 연결.
sheetsCrud.onWrite((ev) => { try { if (process.env.LOCAL_STAGING === '1') console.log('[crud→B8] write event', JSON.stringify(ev)); } catch (e) {} });
const CAL_ID = process.env.CAL_ID || 'ggorilla11@gmail.com';
const PORT = process.env.PORT || 8080;

// 약관(공개 문서·공통 지식) = 서버 보관 OK
const YAK = JSON.parse(fs.readFileSync(path.join(__dirname, 'yakgwan_pages.json'), 'utf8'));

const app = express();
app.use(express.json({ limit: '50mb' })); // 자료 업로드(base64) 파싱 — 큰 제안서 PDF 다중 업로드 대비 상향
// ★배포 반영 확인용(정직): 재배포 후 이 build 값이 바뀌면 새 코드가 실제 활성화됐다는 증거. 공개·민감정보 없음.
const BUILD_TAG = 'v4.0-day4-master-crm-crud-complete-2026-07-24';
app.get(['/health', '/api/version'], (req, res) => res.json({ ok: true, build: BUILD_TAG, emojiFilter: typeof stripEmoji === 'function', pineconeReady: (function () { try { return personalMem.configured(); } catch (e) { return false; } })(), ts: new Date().toISOString() }));
// ★🛡️ 수문장 진단(회장님 직접 확인용): 로그인 상태로 이 URL을 열면 — 내 세션 uid·Pinecone연결·최근이벤트를 그대로 보여준다.
//   명단 올린 뒤 이걸 열어 recentEvents에 roster_upload가 있으면 "기록 OK"(라우팅/타이밍 문제), 없으면 "기록 실패"(uid/훅 문제) → 근본 즉시 판별.
app.get('/api/_diag/gatekeeper', async (req, res) => {
  try {
    const uid = (sessionOf(req) || {}).email || '';
    const cfg = personalMem.configured();
    if (!uid) return res.json({ loggedIn: false, pineconeReady: cfg, hint: '로그인(genya 세션) 후 다시 열어주세요. uid가 비어있으면 이게 근본입니다.' });
    let events = ''; try { events = await personalMem.recallRecentEvents({ ownerId: uid, limit: 8 }); } catch (e) {}
    res.json({ loggedIn: true, uid, pineconeReady: cfg, ns: personalMem.ns(uid, 'representative'), recentEvents: events || '(최근 이벤트 없음 — 기록이 안 됐거나 아직 인덱싱 전)' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// ★Vapi 음성(엄마2): 프론트에 공개키·어시스턴트ID 전달(Render env·하드코딩0). Vapi Public Key는 클라이언트 공개용이라 반환 OK. 키 없으면 ready:false → 프론트가 마이크 비활성.
app.get('/api/vapi-config', (req, res) => res.json({ ready: !!(process.env.VAPI_PUBLIC_KEY && process.env.VAPI_ASSISTANT_ID), publicKey: process.env.VAPI_PUBLIC_KEY || '', assistantId: process.env.VAPI_ASSISTANT_ID || '' }));
// ★한 지니야 뇌: 마이크 클릭 시 회원 컨텍스트(로그인 세션 + Pinecone recall)를 조립해 통화 지니야에 variableValues로 주입 → 통화 지니야 = 텍스트 지니야 동일 기억. 로그인 없으면 게스트.
app.get('/api/vapi-context', async (req, res) => {
  try {
    const uid = (sessionOf(req) || {}).email || '';
    const who = 호칭For(uid);
    let recall = '';
    if (uid && personalMem.configured()) { try { recall = await personalMem.recallSmart({ ownerId: uid, scope: 'representative', query: '최근 상담·요청·자료 요약' }); } catch (e) {} }
    if (uid && personalMem.configured()) personalMem.recordEventAsync({ ownerId: uid, type: 'voice_call', source: 'event', summary: '음성 통화 시작' }); // 🛡️수문장
    res.json({ user_id: uid || 'guest', user_name: who, session_id: String(req.query.sid || ''), recall: recall || '' });
  } catch (e) { res.json({ user_id: 'guest', user_name: '대표님', session_id: '', recall: '' }); }
});
// ★카톡 발송기(watcher) 배포 zip — 교육생이 각자 PC에 설치. 공개 정적(개인정보·키·명단 미포함 zip만 배치). zip은 별도 생성.
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

// ★세션 복원: 재배포·15분 슬립으로 메모리(sessions)가 비어도, 암호화 쿠키(genya_rt)에서
//   refresh_token 복원 → 세션 재구성. ★서버 저장 0(쿠키=사용자 브라우저 것) · SA/Firestore 불필요.
//   대표님·교육생이 15분마다 재로그인하던 무한반복의 근본 해결.
app.use(async (req, res, next) => {
  try {
    let sid = sidOf(req);
    // ★근본수정: 예전엔 sid(genya_sid)가 있을 때만 복원 → genya_sid(세션쿠키) 유실 시 genya_rt(1년치 email)가 있어도 복원 불가("치매").
    //   이제 세션이 없으면(sid 유실 or sessions에 없음) genya_rt로 복원하고, sid가 유실됐으면 새로 발급·영속 재설정 → uid 항상 유지.
    if (!(sid && sessions.get(sid))) {
      const m = /(?:^|;\s*)genya_rt=([^;]+)/.exec(req.headers.cookie || '');
      if (m) {
        const p = JSON.parse(_dec(decodeURIComponent(m[1])) || '{}');
        // ★다운로드함 버그 수정: rt 없어도 email 있으면 세션 복원(email 기반 기능=mem·프로필 유지).
        //   rt 있으면 구글토큰까지 복원(캘린더·시트 등), 없으면 email만(memberAuth는 tokens 없으면 null → 데이터기능은 정직히 구글연결 요구).
        if (p && (p.email || p.rt)) {
          const _sess = { email: p.email || '', name: '', scope: p.scope || '', provider: 'google', restored: true };
          if (p.rt) _sess.tokens = { refresh_token: p.rt };
          // ★Task A 세션 안정성: 쿠키에 rt가 없지만 이메일이 있으면 durable(Firestore)에서 커넥터 복원.
          //   → 쿠키 유실·좁아짐·타기기·키회전에도, 한 번이라도 [구글 연결]한 이메일이면 재로그인 즉시 커넥터 자동 유지.
          if (!_sess.tokens && _sess.email) {
            try {
              const _dur = await loadMemberToken(_sess.email);
              if (_dur && _dur.refresh_token) {
                _sess.tokens = { refresh_token: _dur.refresh_token };
                if ((_dur.scope || '').split(' ').length > (_sess.scope || '').split(' ').length) _sess.scope = _dur.scope;
              }
            } catch (e) {}
          }
          if (!sid) { // ★genya_sid 유실(세션쿠키 소멸 등) → 새 sid 발급 + 영속 재설정 → 이후 요청부터 세션·uid 유지
            sid = crypto.randomBytes(18).toString('hex');
            try { res.setHeader('Set-Cookie', `genya_sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000${process.env.RENDER ? '; Secure' : ''}`); } catch (e) {}
          }
          sessions.set(sid, _sess);
          req._sid = sid; // ★★핵심: 복원/재발급한 sid를 이번 요청에 즉시 반영 → sessionOf(req)가 같은 요청에서 uid를 잡는다(재배포 후 첫 대화부터 인지).
        }
      }
    }
  } catch (e) {}
  next();
});

// ── 🔑 구글 OAuth 로그인 통합 (auth-oauth/.env에서 자격, 하드코딩 0) ──
try { require('dotenv').config(); } catch (e) {}
const crypto = require('crypto');
const OA_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const OA_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
// ★배포 콜백 자동화: env 미설정 시 Render 배포 도메인(RENDER_EXTERNAL_URL)으로 콜백 → 로그인 후 배포 서버(genya.html)로 복귀
// ★redirect_uri 확정: 배포에선 무조건 배포 도메인. Render env에 localhost가 잘못 들어있어도 무시(env 최우선의 함정 방어).
const _DEPLOY = 'https://genya-builder.onrender.com';
const _isLocalDev = /^809[012]$/.test(String(process.env.PORT || ''));  // 로컬 개발 포트(8090/8091/8092)만 localhost
let _envRedirect = process.env.GOOGLE_OAUTH_REDIRECT;
if (_envRedirect && /localhost/i.test(_envRedirect) && !_isLocalDev) _envRedirect = null; // 배포인데 localhost env면 무시
const OA_REDIRECT = _envRedirect || (_isLocalDev ? `http://localhost:${process.env.PORT}/auth/google/callback` : _DEPLOY + '/auth/google/callback');
// ★"확인 안 된 앱" 경고 제거: 로그인은 openid·email·profile만(민감 스코프 없음 → 경고 안 뜸).
//   캘린더·시트·드라이브(민감)는 그 기능 쓸 때 /auth/google/connect 로 별도 동의(incremental).
const LOGIN_SCOPES = ['openid', 'email', 'profile'];
const DATA_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'];
const OA_SCOPES = LOGIN_SCOPES;
const OA_CONFIGURED = !!(OA_ID && OA_SECRET);
// ★회원 간 격리: 세션ID → {email, tokens}. 서버 메모리에만(디스크·DB 0, 회원 데이터 저장 0=토큰뿐)
const sessions = new Map();
function oaClient() { return new google.auth.OAuth2(OA_ID, OA_SECRET, OA_REDIRECT); }
function sidOf(req) { if (req && req._sid) return req._sid; const m = /(?:^|;\s*)genya_sid=([^;]+)/.exec(req.headers.cookie || ''); return m && m[1]; } // ★req._sid: 복원 미들웨어가 이번 요청에 재발급한 sid를 같은 요청에서 즉시 반영(첫 요청부터 uid 유효)
function sessionOf(req) { const s = sidOf(req); return s && sessions.get(s); }
// ★핵심: 로그인했으면 회원 구글 OAuth 클라이언트(회원 토큰), 아니면 null → 각 함수가 SA로 폴백
//   카카오 로그인 세션은 구글 토큰이 없어(s.tokens 없음) → null → 데이터 기능엔 구글 연결 필요(정직).
function memberAuth(req) { const s = sessionOf(req); if (!s || !s.tokens) return null; const c = oaClient(); c.setCredentials(s.tokens); return c; }
// ★스코프 판별: 로그인만(email/profile) vs 데이터(캘린더·시트·드라이브) 동의 여부. 일반 대화는 데이터 불필요.
function grantedScope(req) { const s = sessionOf(req); if (!s) return ''; return String(s.scope || (s.tokens && s.tokens.scope) || ''); }
function hasDataScope(req) { return /calendar|spreadsheets|\/drive/.test(grantedScope(req)); }
function isScopeError(e) { return /insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT|Insufficient Permission|invalid_scope|PERMISSION_DENIED/i.test((e && e.message) || ''); }

// ★구글 연결 게이트 + SA 잔재 제거: 데이터 기능은 "회원 구글 토큰"이 있을 때만.
//   없으면(카카오·미로그인) SA로 폴백하지 않고 "구글 연결 필요"로 정직히 게이트(대표 SA 데이터 노출 0).
function gateGoogle(req, res) {
  const ma = memberAuth(req);
  if (ma && hasDataScope(req)) return ma; // ★로그인만 하고 데이터 스코프 없으면 통과 안 함(500 방지)
  const s = sessionOf(req);
  res.json({ ok: true, needsGoogle: true, needsConnect: true, connectUrl: '/auth/google/connect', provider: s ? s.provider : null, message: s ? '내 데이터(캘린더·시트·드라이브)를 보려면 구글 데이터 연결이 필요해요' : '로그인이 필요해요' });
  return null;
}

// ── 💬 카카오 로그인 (구글과 동일 패턴 · 자격은 env, 하드코딩 0) ──
//   ★카카오 = "누구인지"(신원)만. 회원 구글 데이터(캘린더·시트·드라이브)는 카카오로 못 얻음
//   → 카카오 로그인 후에도 데이터 기능은 [구글 연결]이 필요(원칙1). 정직히 분리.
const KA_KEY = process.env.KAKAO_REST_KEY || '';
let _envKa = process.env.KAKAO_REDIRECT;
if (_envKa && /localhost/i.test(_envKa) && !_isLocalDev) _envKa = null;
const KA_REDIRECT = _envKa || (_isLocalDev ? `http://localhost:${process.env.PORT}/auth/kakao/callback` : _DEPLOY + '/auth/kakao/callback');
const KA_CONFIGURED = !!KA_KEY;

// ── SA 폴백(데모). 로그인 시엔 memberAuth가 우선 ──
function googleAuth(scopes) {
  const creds = JSON.parse(KEY_FILE);
  return new google.auth.GoogleAuth({ credentials: creds, scopes });
}

// ── 회원 명단 시트 읽기(원칙1: 읽어서 반환, 서버 저장 0). ma=회원토큰/없으면 SA ──
async function readRoster(ma) {
  const auth = ma || googleAuth([
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
  ]);
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });
  const f = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.spreadsheet' and name='${DEMO_TITLE}' and trashed=false`,
    fields: 'files(id)',
  });
  const id = (f.data.files || [])[0] && f.data.files[0].id;
  if (!id) return [];
  const got = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${SHEET_TAB}!A1:T50` });
  const [H, ...body] = got.data.values || [[]];
  return body.filter((r) => r && r.length).map((r) => { const o = {}; H.forEach((h, i) => o[h] = r[i] || ''); return o; });
}

function prepFor(c) {
  if (!c) return [];
  const notes = [];
  if (c['가입상품'] === '자동차보험' && String(c['만기일']).startsWith('2026-07')) notes.push(`7월 자동차 만기(${c['만기일']}) → 보험사 비교표 준비`);
  if (String(c['비고']).includes('자산가')) notes.push(`자산가 고객 → ${String(c['비고']).replace('자산가, ', '')} 준비(3포인트)`);
  if (!notes.length && c['비고']) notes.push(c['비고']);
  return notes;
}

// ── 📅 캘린더 브리핑: 회원 캘린더 오늘 일정 + 명단 자동 연결 ──
app.get('/api/calendar', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return; // ★회원 구글 토큰으로만(SA 폴백 제거)
    // ★캘린더만 연결한 회원도 일정이 떠야 한다.
    //   명단(드라이브+시트)은 '있으면 좋은 것'이지 캘린더의 전제가 아니다.
    //   전에는 여기서 스코프 없어 터지면 500 → 화면엔 그냥 0건으로 보였다.
    let roster = [];
    try { roster = await readRoster(ma); } catch (e) { roster = []; }
    const byName = {}; roster.forEach((c) => byName[c['고객명']] = c);
    const cal = google.calendar({ version: 'v3', auth: ma });
    // ★시간대 버그 수정: Render 서버는 UTC라 new Date(y,m,d,0,0,0)가 한국 오전 9시까지를
    //   '어제'로 밀어냈다 → 오전 일정 누락. 한국시간(KST=UTC+9) '오늘' 하루로 잡는다.
    //   ★종일 일정도 빠지지 않게 timeMin/Max를 넉넉히(KST 자정~자정).
    const kst = new Date(Date.now() + 9 * 3600e3);
    const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), d = kst.getUTCDate();
    const timeMin = new Date(Date.UTC(y, m, d, 0, 0, 0) - 9 * 3600e3).toISOString();   // KST 오늘 00:00
    const timeMax = new Date(Date.UTC(y, m, d, 23, 59, 59) - 9 * 3600e3).toISOString(); // KST 오늘 23:59
    // ★원인 4: primary만 보면 업무 캘린더 등 다른 캘린더가 빠진다 → 내 모든 캘린더를 돈다.
    //   원인 2(종일=start.date)·3(singleEvents=반복 펼침)·5(KST 범위)도 여기서 함께 반영.
    // ★?debug=1 이면 화면이 받는 바로 이 응답에 요청·응답 원문을 실어 보낸다(추측 금지).
    const DBG = String(req.query.debug || '') === '1';
    const dbg = { 요청: { timeMin, timeMax, singleEvents: true, orderBy: 'startTime', timeZone: 'Asia/Seoul' }, 지금KST: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16), 캘린더별: [] };
    let cals = ['primary'], calList = [];
    try {
      const cl = await cal.calendarList.list(); calList = cl.data.items || [];
      // ★대표님 11 계정 = 캘린더 3개. primary만 보면 나머지 2개의 약속이 안 뜬다.
      //   selected!==false(화면에 켜둔 것만) + 공휴일·생일(#holiday/#contacts) 제외.
      cals = calList.filter((c) => c.selected !== false && !/#holiday@|#contacts@/.test(c.id)).map((c) => c.id);
      if (!cals.length) cals = ['primary'];
    } catch (e) { dbg.calendarList_에러 = e.message; }
    dbg.내캘린더수 = cals.length;
    let items = [];
    for (const cid of cals) {
      try {
        const ev = await cal.events.list({ calendarId: cid, timeMin, timeMax, singleEvents: true, orderBy: 'startTime', timeZone: 'Asia/Seoul' });
        const got = ev.data.items || [];
        items = items.concat(got);
        // ★각 캘린더의 에러를 더 이상 삼키지 않는다 — 조용한 0건의 진짜 원인이 여기 있었다.
        if (DBG) dbg.캘린더별.push({ 캘린더: (calList.find((c) => c.id === cid) || {}).summary || cid, 건수: got.length, 첫item: got[0] || null });
      } catch (e) {
        if (DBG) dbg.캘린더별.push({ 캘린더: cid, 에러: e.message });
      }
    }
    const events = items.map((e) => {
      const start = (e.start || {}).dateTime || (e.start || {}).date || '';   // ★종일=date / 시간=dateTime 둘 다
      const time = start.length >= 16 ? new Date(start).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }) : '종일';
      const title = e.summary || '(제목없음)';
      const name = Object.keys(byName).find((n) => title.includes(n));
      return { time, title, start, prep: prepFor(byName[name]) };
    }).sort((a, b) => String(a.start).localeCompare(String(b.start)));
    res.json({ ok: true, date: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, count: events.length, events, ...(DBG ? { debug: dbg } : {}) });
  } catch (e) {
    // ★시트만 연결한 회원은 gateGoogle을 통과하지만 캘린더 스코프가 없어 여기서 터진다.
    //   500을 던지면 화면엔 그냥 '0건'으로 보인다 = 조용히 잘못된 것. '연결 필요'로 정직하게.
    if (isScopeError(e)) return res.json({ ok: true, needsConnect: true, connectUrl: '/auth/google/connect?scope=calendar', message: '캘린더를 보려면 캘린더 연결이 필요해요' });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 📊 시트 명단 정리: 필터/정렬(원칙1: 읽기만, 저장 0) ──
app.get('/api/sheets', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return; // ★회원 구글 토큰으로만
    const roster = await readRoster(ma);
    const july = roster.filter((o) => o['가입상품'] === '자동차보험' && String(o['만기일']).startsWith('2026-07'));
    const byDue = [...july].sort((a, b) => String(a['만기일']).localeCompare(String(b['만기일'])));
    const rich = roster.filter((o) => String(o['비고']).includes('자산가') || Number(o['연소득(만원)']) >= 15000);
    const slim = (arr) => arr.map((o) => ({ 고객명: o['고객명'], 만기일: o['만기일'], 보험사: o['보험사'], 직업: o['직업'], 비고: o['비고'] }));
    res.json({ ok: true, total: roster.length, q1_7월만기: slim(july), q2_만기임박순: slim(byDue), q3_자산가: slim(rich) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// 🗂️ Step 2-B · 시트 자연어 CRUD (독립 · 하이브리드 라우터 무접촉)
//   /chat   : 자연어 → 읽기 즉시 / 쓰기는 미리보기+HMAC서명 반환(승인 대기)
//   /commit : 승인된 서명 검증 후에만 실제 시트 반영. delete는 confirmed=true 이중확인.
//   ★제로 인그레스: 승인 대기 작업을 서버에 안 쌓음(무상태 서명 토큰). 회원 토큰(gateGoogle)으로만.
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/sheets/crud/chat', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return;
    const messages = (req.body && req.body.messages) || (req.body && req.body.text ? [{ role: 'user', content: req.body.text }] : []);
    res.json(await sheetsCrud.runChat(ma, messages));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/sheets/crud/commit', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return;
    const b = req.body || {};
    res.json(await sheetsCrud.commit(ma, b.action, b.sig, { confirmed: !!b.confirmed }));
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// 🔌 커넥터 4종 — 교육생 본인 구글 데이터 "한 줄이라도" 화면에 (2026-07-16)
//   ★캘린더에서 확정된 패턴 그대로 4개 복제:
//     ① 자기 서버 · 교육생 본인 OAuth 토큰(gateGoogle) — 옆집(제니야)·SA 안 부름
//     ② 스코프 없으면 500 대신 {needsConnect:true} 정직 응답
//     ③ 부가데이터(명단 등)에 의존 안 함 — 그 도구 하나만 연결해도 뜸
//   ★제로 데이터 인그레스: 전부 읽어서 반환만. 서버 저장 0.
//   ★SA 폴백 없음 — gateGoogle이 회원 토큰 없으면 바로 needsConnect(남의 데모 안 보임).
// ═══════════════════════════════════════════════════════════════════════════
const scopeGate = (e, res, scope) => { if (isScopeError(e)) { res.json({ ok: true, needsConnect: true, connectUrl: '/auth/google/connect?scope=' + scope, message: '이 도구를 쓰려면 연결이 필요해요' }); return true; } return false; };

// 📊 내 구글 시트 목록 (최근 수정순 10개)
app.get('/api/my/sheets', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return;
    const drive = google.drive({ version: 'v3', auth: ma });
    const r = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      orderBy: 'modifiedTime desc', pageSize: 10,
      fields: 'files(id,name,modifiedTime,webViewLink)',
    });
    res.json({ ok: true, items: (r.data.files || []).map((f) => ({ id: f.id, name: f.name, link: f.webViewLink, at: (f.modifiedTime || '').slice(0, 10) })) });
  } catch (e) { if (scopeGate(e, res, 'sheets')) return; res.status(500).json({ ok: false, error: e.message }); }
});

// 📁 내 드라이브 최근 파일 (폴더 제외, 최근 10개)
app.get('/api/my/drive', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return;
    const drive = google.drive({ version: 'v3', auth: ma });
    const r = await drive.files.list({
      q: "trashed=false and mimeType!='application/vnd.google-apps.folder'",
      orderBy: 'modifiedTime desc', pageSize: 10,
      fields: 'files(id,name,modifiedTime,webViewLink,mimeType)',
    });
    res.json({ ok: true, items: (r.data.files || []).map((f) => ({ id: f.id, name: f.name, link: f.webViewLink, at: (f.modifiedTime || '').slice(0, 10) })) });
  } catch (e) { if (scopeGate(e, res, 'drive')) return; res.status(500).json({ ok: false, error: e.message }); }
});

// 📧 내 Gmail 최근 메일 제목 5개 — ★서버에 없던 것. 신설.
//   gmail.readonly로 목록·제목만(본문·발송 없음). 발송·초안은 사람 승인 뒤 별도.
app.get('/api/my/gmail', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return;
    const gmail = google.gmail({ version: 'v1', auth: ma });
    const list = await gmail.users.messages.list({ userId: 'me', maxResults: 5, q: 'in:inbox' });
    const ids = (list.data.messages || []).map((m) => m.id);
    const items = [];
    for (const id of ids) {
      const m = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
      const h = {}; ((m.data.payload || {}).headers || []).forEach((x) => h[x.name] = x.value);
      items.push({ subject: h.Subject || '(제목 없음)', from: (h.From || '').replace(/<.*>/, '').trim(), snippet: m.data.snippet || '' });
    }
    res.json({ ok: true, items });
  } catch (e) { if (scopeGate(e, res, 'gmail')) return; res.status(500).json({ ok: false, error: e.message }); }
});

// ═══ 📣 홍보비서(발행창고 1단계) — 한줄카피 → 쇼츠 원고 (클로드 API) ═══════════
//   교육생용 테넌트: 대표님 캠페인·토큰·시트 안 씀. 카피 받아 원고만 생성해 반환(서버 저장 0).
//   목표(일요일): [홍보비서] 클릭 → 카피 1개 입력 → 원고가 나온다. 발행은 그다음 단계.
app.post('/api/promo/draft', async (req, res) => {
  try {
    if (!sessionOf(req)) return res.status(401).json({ ok: false, error: '로그인이 필요해요' });
    const copy = String((req.body || {}).copy || '').trim();
    if (!copy) return res.status(400).json({ ok: false, error: '한줄카피를 입력해 주세요' });
    // 원고 규칙(짧은 문장·질문→답·30초·5씬) — 엄마1 원고규칙.md의 핵심을 프롬프트로.
    const sys = [
      '너는 1인 사업자를 위한 30초 세로 쇼츠(숏폼) 대본 작가다. 아래 한줄카피를 후크로 삼아 대본을 쓴다.',
      '규칙: ① 5개 씬, 각 씬 1~2문장 ② 한 문장 16자 이내로 짧게 ③ 질문을 던지고 바로 답한다',
      '④ 숫자는 한 문장에 하나만 ⑤ 마지막 씬은 "무료 진단 받아보세요" 같은 행동유도',
      '⑥ 과장·허위 금지, 사실만. 출력은 "씬1: ...\\n씬2: ..." 형식으로만.',
    ].join('\n');
    const r = await _anthropic.messages.create({ model: WS_CHAT_MODEL, max_tokens: 900, system: sys, messages: [{ role: 'user', content: '한줄카피: ' + copy } ] });
    const script = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    res.json({ ok: true, copy, script, engine: 'claude-sonnet-5' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 🩺 진단 — 4개 커넥터 각각 실제 API를 호출해 200/에러 원문을 찍는다. ★토큰값 0노출.
//   "스코프는 있는데 연결 필요가 뜬다"의 진짜 원인(문자열 vs 실제 부여)을 대표님 세션에서 확인.
app.get('/api/diag/conn', async (req, res) => {
  const s = sessionOf(req);
  const out = { 로그인: !!s, 이메일: s ? s.email : null, 구글토큰있음: !!(s && s.tokens),
                승인스코프_문자열: (s && (s.scope || (s.tokens && s.tokens.scope))) || '', 실제호출: {} };
  const ma = memberAuth(req);
  if (!ma) { out.진단 = '구글 토큰 없음 — 로그인/연결 필요'; return res.json(out); }
  const probes = {
    calendar: () => google.calendar({ version: 'v3', auth: ma }).calendarList.list({ maxResults: 1 }),
    sheets:   () => google.drive({ version: 'v3', auth: ma }).files.list({ pageSize: 1, q: "mimeType='application/vnd.google-apps.spreadsheet'", fields: 'files(id)' }),
    drive:    () => google.drive({ version: 'v3', auth: ma }).files.list({ pageSize: 1, fields: 'files(id)' }),
    gmail:    () => google.gmail({ version: 'v1', auth: ma }).users.getProfile({ userId: 'me' }),
  };
  for (const k of Object.keys(probes)) {
    try { await probes[k](); out.실제호출[k] = '✅ 200'; }
    catch (e) { out.실제호출[k] = '❌ ' + (e.code || '') + ' ' + (e.message || '').slice(0, 80); }
  }
  out.진단 = '실제호출에서 ❌인 것 = 문자열엔 스코프 있어도 실제 토큰엔 없음 → 그 커넥터 [지금 연결하기] 필요';
  res.json(out);
});

// 🩺 진단 전용(임시) — 캘린더 0건 원인 격리. 로그인 본인만. ★토큰값 0노출.
//   대표님이 로그인 후 이 주소를 열면, 무엇이 문제인지 한눈에 나온다.
app.get('/api/diag/calendar', async (req, res) => {
  const s = sessionOf(req);
  const out = { 로그인: !!s, 이메일: s ? s.email : null, provider: s ? s.provider : null,
                구글토큰있음: !!(s && s.tokens), 승인스코프: (s && (s.scope || (s.tokens && s.tokens.scope))) || '',
                캘린더스코프: hasDataScope(req) && /calendar/.test((s && (s.scope || (s.tokens && s.tokens.scope))) || '') };
  if (!s || !s.tokens) { out.진단 = '구글 데이터 연결 안 됨 — 캘린더 [연결하기] 필요'; return res.json(out); }
  try {
    const ma = memberAuth(req);
    const cal = google.calendar({ version: 'v3', auth: ma });
    // 회원 캘린더 목록 — SA면 여기서 대표님 캘린더가 안 보인다(SA 자기 것만)
    const cl = await cal.calendarList.list();
    out.내캘린더수 = (cl.data.items || []).length;
    out.기본캘린더 = (cl.data.items || []).filter((c) => c.primary).map((c) => c.id);
    // 오늘 KST 하루
    const kst = new Date(Date.now() + 9 * 3600e3);
    const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), d = kst.getUTCDate();
    const timeMin = new Date(Date.UTC(y, m, d, 0, 0, 0) - 9 * 3600e3).toISOString();
    const timeMax = new Date(Date.UTC(y, m, d, 23, 59, 59) - 9 * 3600e3).toISOString();
    out.오늘_KST범위 = { timeMin, timeMax, 지금KST: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16) };
    // ★핵심: primary만이 아니라 '모든 캘린더'를 돌며 각각 오늘 몇 건인지 찍는다.
    //   대표님 약속이 업무 캘린더에 있으면 여기서 어느 캘린더인지 드러난다(원인 ①).
    // ★/api/calendar와 같은 필터: selected!==false + 공휴일·생일 제외
    const cals = (cl.data.items || []).filter((c) => c.selected !== false && !/#holiday@|#contacts@/.test(c.id));
    out.볼_캘린더 = cals.map((c) => c.summary || c.id);
    out.캘린더별_오늘 = [];
    let 합계 = 0;
    for (const c of cals) {
      try {
        const ev = await cal.events.list({ calendarId: c.id, timeMin, timeMax, singleEvents: true, orderBy: 'startTime', timeZone: 'Asia/Seoul' });
        const items = ev.data.items || []; 합계 += items.length;
        out.캘린더별_오늘.push({ 캘린더: c.summary || c.id, 오늘건수: items.length,
          일정: items.map((e) => ({ 제목: e.summary || '(제목없음)', 시작: (e.start || {}).dateTime || (e.start || {}).date, 종일: !(e.start || {}).dateTime })) });
      } catch (e2) { out.캘린더별_오늘.push({ 캘린더: c.summary || c.id, 에러: e2.message }); }
    }
    out.오늘_전체합계 = 합계;
    // 시간대 무관 이번주(primary) — 오늘 0인데 이게 있으면 시간대/범위 문제
    const wk = await cal.events.list({ calendarId: 'primary', timeMin: new Date(Date.now() - 2 * 864e5).toISOString(), timeMax: new Date(Date.now() + 5 * 864e5).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 10 });
    out.최근7일_primary = (wk.data.items || []).map((e) => (e.summary || '(제목없음)') + ' @ ' + ((e.start || {}).dateTime || (e.start || {}).date || ''));
    out.진단 = 합계 > 0
      ? '✅ 오늘 일정 읽힘(합계 ' + 합계 + ') — 어느 캘린더인지 캘린더별_오늘 참고. 화면이 0이면 화면 반영 문제.'
      : (out.최근7일_primary.length > 0 ? '⚠️ 오늘은 0인데 최근7일엔 있음 → 시간대/범위' : (cals.length <= 1 ? '⚠️ 캘린더 1개뿐 → 다른 구글계정 로그인 의심' : '⚠️ 모든 캘린더 오늘 0 → 진짜 오늘 일정 없음 or 다른 계정'));
    res.json(out);
  } catch (e) { out.에러 = e.message; out.진단 = isScopeError(e) ? '캘린더 스코프 없음 — 재연결 필요' : '캘린더 호출 실패'; res.json(out); }
});

// ═══ 🔍 고객발굴비서 — 남의 유튜브(★오상열 제외) 금융 키워드 검색 → 리드 → 답글초안 ═══
//   대표님 확정 구조: 제니야=오상열 채널 / 지니야=오상열 제외 나머지 전체를 찾아다님.
//   ★제니야 collectYouTube를 이식(YouTube Data API·API키만·OAuth 불필요). 새로 안 만듦.
//   ★자동 발송 0 — 답글 초안까지만. 교육생이 [복사→직접 게시]. 진단링크에 교육생 꼬리표.
const FIND_EXCLUDE_CH = process.env.FIND_EXCLUDE_CHANNEL || 'UCQxyqyUyMpNzHZvK0V_mOGQ'; // 오상열 @OhSangRyul 제외
const FIND_KEYWORDS = ['재테크', '노후준비', '연금저축', '목돈 마련', '퇴직연금', '보험 리모델링', '종잣돈', '재무설계', '10억 모으기', '투자 초보'];
const FIND_INTENT = /(어떻게|어떡|추천|모으|막막|시작|초보|고민|할까요|방법|좋을까|궁금|문의|해야|도와|알려|얼마|불안|걱정)/;
const FIND_HOT = /(상담|신청|연락|문의|디엠|dm|카톡|어떻게\s*신청|알려주세요)/i;
const FIND_WARM = /(노후|연금|재테크|종잣돈|목돈|불안|막막|초보|시작|얼마|투자|고민)/;
function findTier(t) { if (FIND_HOT.test(t)) return '🔥핫'; if (FIND_WARM.test(t)) return '🌤웜'; return '🌱콜드'; }
const _tierOrd = { '🔥핫': 0, '🌤웜': 1, '🌱콜드': 2 };

async function findYouTubeLeads(key, max) {
  const out = [];
  for (const kw of FIND_KEYWORDS.slice(0, 6)) {   // 할당량 보호: 회당 6키워드
    let s; try { s = await (await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=3&q=${encodeURIComponent(kw)}&key=${key}`)).json(); } catch (e) { continue; }
    if (s.error) throw new Error((s.error.message || 'youtube search 실패'));
    for (const it of (s.items || [])) {
      const vid = it.id && it.id.videoId; if (!vid) continue;
      if ((it.snippet && it.snippet.channelId) === FIND_EXCLUDE_CH) continue;   // ★오상열 제외
      let cs; try { cs = await (await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&maxResults=10&order=relevance&videoId=${vid}&key=${key}`)).json(); } catch (e) { continue; }
      (cs.items || []).forEach((ci) => {
        const sn = ci.snippet && ci.snippet.topLevelComment && ci.snippet.topLevelComment.snippet; if (!sn) return;
        const text = String(sn.textOriginal || ''); if (!FIND_INTENT.test(text)) return;
        out.push({ source: '유튜브', author: sn.authorDisplayName || '', text: text.slice(0, 180), link: `https://www.youtube.com/watch?v=${vid}&lc=${ci.id}`, videoTitle: (it.snippet && it.snippet.title) || '', keyword: kw, tier: findTier(text) });
      });
      if (out.length >= (max || 30)) return out;
    }
  }
  return out;
}

app.get('/api/find/leads', async (req, res) => {
  if (!sessionOf(req)) return res.status(401).json({ ok: false, error: '로그인이 필요해요' });
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return res.json({ ok: true, needsKey: true, youtube: [], naver: [], message: 'YOUTUBE_API_KEY 미설정 — 대표님이 Render에 넣으면 발굴이 켜집니다.' });
  try {
    const yt = await findYouTubeLeads(key, 30);
    yt.sort((a, b) => (_tierOrd[a.tier] != null ? _tierOrd[a.tier] : 9) - (_tierOrd[b.tier] != null ? _tierOrd[b.tier] : 9));
    res.json({ ok: true, youtube: yt, naver: [] });   // 네이버 카페·지식인은 다음 단계(일요일 범위=유튜브만)
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// 답글 초안(LLM) — ★게시는 교육생 직접(자동 0). [링크]는 화면에서 진단링크+교육생 꼬리표로 치환.
app.post('/api/find/reply-draft', async (req, res) => {
  if (!sessionOf(req)) return res.status(401).json({ ok: false, error: '로그인이 필요해요' });
  try {
    const b = req.body || {};
    const text = String(b.text || '').slice(0, 500);
    const source = String(b.source || '공개 채널');
    if (!text) return res.json({ ok: false, error: '내용 없음' });
    const sys = '너는 재무설계사를 돕는 어시스턴트다. 유튜브 댓글/카페 글에 달 "답글 초안"을 쓴다. 톤: 친절하고 전문적. 규칙: ① 2~3문장 짧게 ② 상대 고민에 진심으로 공감 ③ "무료 재무진단으로 지금 상황을 점검해보시라"고 자연스럽게 권함 ④ 마지막에 링크 자리로 [링크] 토큰 하나만 넣기 ⑤ 강매·전화번호·과장·이모지 남발 금지. 답글 본문만 출력(설명 없이).';
    const cr = await _anthropic.messages.create({ model: WS_CHAT_MODEL, max_tokens: 350, system: sys, messages: [{ role: 'user', content: `[출처: ${source}] 상대 글/댓글:\n"${text}"\n\n이 사람에게 달 답글 초안을 써줘.` }] });
    const draft = (cr.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('').trim();
    res.json({ ok: true, draft });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── 📄 약관 검색: 약관 창고(RAG 모듈)에서 근거 찾아 쉽게 답 + 출처(페이지). 없으면 "확인 필요" ──
app.get('/api/yakgwan', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ ok: true, note: '질문을 입력하세요(예: 무보험차상해가 뭐야? / 자기신체사고와 자동차상해 차이?)' });
    const r = await askYakgwan(q);
    res.json({ ok: true, query: q, found: r.found, answer: r.answer, sources: r.sources, pages: r.pages });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 📁 드라이브 증권 검색: 회원 드라이브에서 파일 찾기 + 열어서 보장 읽기 ──
//    ★원칙1: 고객 파일은 회원 드라이브에만. 서버는 메모리로 받아 읽고 버림(저장 0).
app.get('/api/drive', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return; // ★회원 구글 토큰으로만
    const q = String(req.query.q || '증권').trim();
    const readId = req.query.read;
    const drive = google.drive({ version: 'v3', auth: ma });

    if (readId) {
      // 찾은 증권 열어서 핵심 보장 읽기(메모리, 저장 0)
      const meta = await drive.files.get({ fileId: readId, fields: 'name' });
      const dl = await drive.files.get({ fileId: readId, alt: 'media' }, { responseType: 'arraybuffer' });
      const buf = Buffer.from(dl.data);
      const parser = new PDFParse({ data: buf });
      const r = await parser.getText(); await parser.destroy();
      const text = (Array.isArray(r.pages) ? r.pages.map((p) => p.text !== undefined ? p.text : p).join(' ') : r.text || '').replace(/\s+/g, ' ');
      const covers = [];
      ['대물', '자기신체사고', '자동차상해', '대인배상', '무보험', '긴급출동', '자기차량'].forEach((k) => {
        const i = text.indexOf(k); if (i >= 0) covers.push({ 항목: k, 내용: text.slice(i, i + 40).trim() });
      });
      return res.json({ ok: true, name: meta.data.name, sizeKB: Math.round(buf.length / 1024), covers, note: '메모리에서 읽고 버림 — 서버 저장 0' });
    }

    // 검색: 이름에 q 포함(공백 분리 AND)
    const terms = q.split(/\s+/).filter(Boolean);
    const qstr = terms.map((t) => `name contains '${t.replace(/'/g, '')}'`).join(' and ') + ` and trashed=false`;
    const r = await drive.files.list({ q: qstr, fields: 'files(id,name,webViewLink,modifiedTime)' });
    res.json({ ok: true, query: q, count: (r.data.files || []).length, files: (r.data.files || []).map((f) => ({ id: f.id, name: f.name, link: f.webViewLink })) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 🛠️ 스킬창고: 목록 + 샘플 생성(실제 파일) ──
// ★⚠️1 차단(회사 존폐): 생성물(/files)은 로그인한 본인만 접근. 미로그인 = 401 차단(URL 알아도 못 받음).
app.use('/files', (req, res, next) => { if (!sessionOf(req)) return res.status(401).send('로그인 필요 — 생성물은 로그인한 본인만 접근 가능(오원트 서버 개인정보 금지구역)'); next(); }, express.static(SKILL_OUT));
app.get('/api/skills', (req, res) => res.json({ ok: true, list: skills.list }));
// ★★고객 데이터 무유입 원칙(절대·회사 존폐): 이 gen은 "공용 고정 템플릿"만 만든다 — 고객 이름·증권번호·진단서 등
//   개인정보를 받는 입력 경로가 없다(아래 내용은 전부 하드코딩 문구). SKILL_OUT(서버 디스크)은 개인정보 금지구역.
//   ▶ 향후 "고객 데이터로 문서 생성" 기능을 붙일 땐 절대 SKILL_OUT에 쓰지 말 것.
//     반드시 (a) 회원 본인 드라이브로 직행 저장(/api/drive/upload 방식: 메모리 Buffer→drive.files.create(회원토큰)),
//     또는 (b) 생성 즉시 서버에서 삭제(fs.unlink). 이 원칙을 어기면 고객 데이터가 서버에 남는다.
app.get('/api/skills/gen', async (req, res) => {
  try {
    if (!sessionOf(req)) return res.status(401).json({ ok: false, error: '로그인 필요' });
    const type = String(req.query.type || 'pdf');
    let file;
    if (type === 'pdf') { file = 'S1_고객안내문.pdf'; await skills.pdf.makePdf({ title: '자동차보험 만기 안내', subtitle: '지니야 자동 생성 (검토 후 발송)', sections: [{ heading: '안내', lines: ['만기가 다가와 안내드립니다.', '보장 점검 후 보완안을 준비했습니다.'] }], footer: '발송 전 담당 설계사 검토 필수.' }, path.join(SKILL_OUT, file)); }
    else if (type === 'excel') { file = 'S2_자동차보험_3사비교표.xlsx'; skills.excel.makeSheet({ title: '3사비교(예시)', headers: ['항목', '삼성화재', 'DB손해보험', '현대해상'], rows: [['대물배상', '3억', '3억', '3억'], ['자기신체/자동차상해', '자동차상해', '자동차상해', '자기신체'], ['무보험차상해', '2억', '2억', '2억'], ['월 보험료', '설계사 견적', '설계사 견적', '설계사 견적']] }, path.join(SKILL_OUT, file)); }
    else if (type === 'ppt') { file = 'S3_보장분석_제안세미나.pptx'; await skills.ppt.makeDeck({ title: '내 보험, 제대로 됐을까?', subtitle: '보장분석 무료 점검 세미나', slides: [{ title: '왜 점검이 필요할까요', bullets: ['보장 공백', '과보험·중복', '시대 변화'] }, { title: '이렇게 도와드립니다', bullets: ['3축 점검', '보완안+이유', '3사 비교표'] }] }, path.join(SKILL_OUT, file)); }
    else if (type === 'doc') { file = 'S4_상담보고서.docx'; await skills.doc.makeDoc({ title: '고객 상담 보고서', subtitle: '지니야 자동 생성 (검토용 초안)', sections: [{ heading: '상담 개요', paras: ['주제: 자동차보험 보장분석'] }, { heading: '제안', paras: ['A/B/C안 + 추천 1개 한 장 요약.'] }], footer: '발송·제출 전 검토 필수.' }, path.join(SKILL_OUT, file)); }
    else return res.status(400).json({ ok: false, error: '알 수 없는 type' });
    const kb = Math.round(fs.statSync(path.join(SKILL_OUT, file)).size / 1024);
    res.json({ ok: true, type, file, url: '/files/' + encodeURIComponent(file), sizeKB: kb });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── ⚖️ 상품비교 스킬: 제안서 사진(들) → 담보비교 + 적정성(오상열 CFP 공식) + 우선순위(이론상 최적) ──
//   ★원칙1(Zero data ingress): 사진은 base64로 받아 메모리에서 지니야 눈에 넘기고 버린다(서버 디스크 저장 0).
//   ★불변: 중립 비교(추천 아님) · 4·5단계 준비 중 · "실제 인수는 심사에서 확정"(휴먼인더루프).
app.post('/api/compare', async (req, res) => {
  try {
    const b = req.body || {};
    const images = Array.isArray(b.images) ? b.images : [];
    if (!images.length) return res.json({ ok: true, note: '제안서 사진을 1~4장 올려주세요 (예: 삼성생명 The퍼스트 · 삼성화재 간편365). 연봉·부채를 함께 주시면 적정성까지 계산해요.' });
    const r = await skills.compare.compareProducts({ images, annualIncome: b.annualIncome, debt: b.debt });
    _memSaveDesign(req, r, '상품비교'); // ★작업3: 상품비교 결과도 MEM 저장(다운로드함용, fire-and-forget · 응답 불변)
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 🛡️ 증권분석비서(배선A): 증권 사진/PDF → 유형판별 + 보장분석(필요·준비·부족) + 상품제안 + 코치 완성본 HTML ──
//   ★원칙1(Zero data ingress): base64로 받아 메모리에서 지니야 눈에 넘기고 버린다(서버 디스크 저장 0).
//   ★필요자금=오상열 금융집짓기 공식 · 정직(없는 값 지어내기 금지) · "제출 전 검토"(휴먼인더루프).
app.post('/api/policy', async (req, res) => {
  try {
    const b = req.body || {};
    const images = Array.isArray(b.images) ? b.images : [];
    if (!images.length) return res.json({ ok: true, note: '분석할 증권을 사진(jpg·png)이나 PDF로 올려주세요. 연소득·직업·부채를 함께 주시면 필요자금까지 정확히 계산해요.' });
    const r = await skills.policy.analyzePolicy({ images, annualIncome: b.annualIncome, job: b.job, debt: b.debt });
    _memSaveDesign(req, r, '증권분석'); // ★MEM-1: 설계요약 Firestore 저장(마스킹·격리·fire-and-forget)
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 📊 연금분석제안비서(배선B): 변액연금 설계서 2개 → 표지 있는 연금 제안서(2상품비교·수령시뮬·성향추천) ──
//   ★Zero data ingress: base64 메모리 처리, 서버 저장 0. 연금액=예시, 원금손실/예금자보호 고지 포함(휴먼인더루프).
app.post('/api/pension', async (req, res) => {
  try {
    const b = req.body || {};
    const images = Array.isArray(b.images) ? b.images : [];
    if (!images.length) return res.json({ ok: true, note: '변액연금 가입설계서 2개를 사진(jpg·png)이나 PDF로 올려주세요. 최저보증·수익률·연금액이 보이는 페이지면 좋아요.' });
    const r = await skills.pension.analyzePension({ images, name: b.name });
    _memSaveDesign(req, r, '연금'); // ★MEM-1: 설계요약 Firestore 저장(마스킹·격리·fire-and-forget)
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 📇 고객관리비서(관리-1): 엑셀(xlsx/csv) 헤더 → 부족 관리항목 리딩 (결정적·서버 저장0·헤더만 진단) ──
app.post('/api/manage/analyze', async (req, res) => {
  try {
    const b = req.body || {};
    const file = b.file || (Array.isArray(b.images) && b.images[0] && b.images[0].data) || '';
    if (!file && !(Array.isArray(b.headers) && b.headers.length)) return res.json({ ok: true, note: '고객 명단 엑셀(xlsx/csv)을 올려주세요. 첫 줄에 항목명(이름·전화·만기일 등)이 있게 해주세요.' });
    const r = skills.manage.analyzeManagement({ file: file, headers: b.headers, rowCount: b.rowCount });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// ── 📊 관리-2: 오늘 이벤트 대시보드(실제 날짜 비교·결정적, 서버 저장0, 초안=승인용 템플릿) ──
app.post('/api/manage/dashboard', async (req, res) => {
  try {
    const b = req.body || {};
    const file = b.file || (Array.isArray(b.images) && b.images[0] && b.images[0].data) || '';
    if (!file) return res.json({ ok: false, error: '고객 명단 엑셀이 필요해요.' });
    const r = skills.manage.buildDashboard({ file: file, today: b.today });
    res.json({ ok: true, source: 'file', ...r });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 📊 [A] 만기 대시보드(시트 자동연동) — 파일 업로드 없이 회원 구글시트 명단으로 이번달 만기·생일 계산 ──
//   readRoster(회원 토큰) → rosterToSheet → buildDashboard. 상단 KPI(kpiDue)가 파일 없이도 실데이터로 채워지게.
app.get('/api/manage/roster-dashboard', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return; // 회원 본인 구글 토큰(SA 폴백 아님)
    let roster = [];
    try { roster = await readRoster(ma); }
    catch (e) {
      // 시트·드라이브 스코프가 없으면 500 대신 '연결 필요' 정직 응답(0건으로 조용히 감추지 않음)
      if (isScopeError(e)) return res.json({ ok: true, needsConnect: true, message: '고객명단 시트를 보려면 구글 시트·드라이브 연결이 필요해요' });
      throw e;
    }
    if (!roster.length) return res.json({ ok: true, empty: true, metrics: [], message: '연결된 시트에서 고객 명단을 찾지 못했어요' });
    const sheet = skills.manage.rosterToSheet(roster);
    const r = skills.manage.buildDashboard({ sheet: sheet, today: req.query.today });
    res.json({ ok: true, source: 'sheet', ...r });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 🧠 MEM 하이브리드C: 설계요약 Firestore(genya_mem) 저장/검색 (주민번호·전화 마스킹 · userId 격리 · SA=moneya-72fe6) ──
//   ★제로 인그레스: 검색용 요약만 저장(원본·개인정보 서버 X). 저장 실패는 대화·분석을 막지 않는다(fire-and-forget).
function _memSaveDesign(req, r, label) {
  try {
    const uid = (sessionOf(req) || {}).email; if (!uid || !r || !r.ok) return;
    const d = r.data || {}; let 고객명 = '', summary = '', 담보금액 = '';
    if (label === '증권분석') { if (!r.data) return; 고객명 = (d.고객 && d.고객.이름) || ''; const gap = (d.보장분석 || []).filter((x) => x.판정 === '부족').map((x) => x.항목 + ' ' + x.부족).slice(0, 4).join(', '); summary = (d.요약 || '') + (gap ? (' | 부족: ' + gap) : ''); 담보금액 = gap; }
    else if (label === '연금') { if (!r.data) return; 고객명 = (d.표지 && d.표지.고객명) || ''; summary = d.요약 || ''; 담보금액 = (d.상품 || []).map((p) => p.상품명 + ' ' + (p.예상연금액 || '')).slice(0, 2).join(' / '); }
    else if (label === '상품비교') { const rep = String(r.report || '').replace(/[#*|>_`\-]/g, ' ').replace(/\s+/g, ' ').trim(); summary = rep.slice(0, 120); 담보금액 = ''; if (!summary) return; } // ★작업3: compareProducts는 report만 반환 → 요약 추출해 저장
    else return;
    genyaMem.saveMem(googleAuth([genyaMem.SCOPE]), { userId: uid, 고객명: 고객명, skill: label, summary: summary, 담보금액: 담보금액 }).catch(function () {});
    // ★A-7: 개인화 벡터 메모리에도 생성물 저장(source=generated) → "어제 만든 자료" 회상 대비. 키 없으면 no-op.
    if (personalMem.configured() && summary) personalMem.saveMemoryAsync({ ownerId: uid, scope: 'representative', source: 'generated', text: (고객명 ? 고객명 + ' ' : '') + label + ': ' + summary, summary: (고객명 ? 고객명 + ' ' : '') + label + ' ' + summary });
  } catch (e) {}
}
app.post('/api/mem/save', async (req, res) => {
  try { const uid = (sessionOf(req) || {}).email; if (!uid) return res.status(401).json({ ok: false, error: '로그인 필요' });
    const b = req.body || {}; const doc = await genyaMem.saveMem(googleAuth([genyaMem.SCOPE]), { userId: uid, 고객명: b.고객명, skill: b.skill, summary: b.summary, 담보금액: b.담보금액, date: b.date });
    res.json({ ok: true, saved: doc });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/mem/search', async (req, res) => {
  try { const uid = (sessionOf(req) || {}).email; if (!uid) return res.status(401).json({ ok: false, error: '로그인 필요' });
    const rows = await genyaMem.searchMem(googleAuth([genyaMem.SCOPE]), { userId: uid, 고객명: req.query.name || req.query.q || '', date: req.query.date || '' });
    res.json({ ok: true, list: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// ★작업3: 다운로드함 전용 — 내가(지니야가) 만든 문서(genya_mem) 전체 최근 목록. (기존 mem/search 동작 불변, 새 라우트 추가)
app.get('/api/mem/list', async (req, res) => {
  try { const uid = (sessionOf(req) || {}).email; if (!uid) return res.status(401).json({ ok: false, error: '로그인 필요' });
    const rows = await genyaMem.searchMem(googleAuth([genyaMem.SCOPE]), { userId: uid, limit: 50 });
    res.json({ ok: true, list: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// ★작업3: genya_mem 삭제(다운로드함 [삭제]) — /api/memory/delete 흉내. userId 소유 확인은 genya_mem_module.deleteMem에서.
app.get('/api/mem/delete', async (req, res) => {
  try { const uid = (sessionOf(req) || {}).email; if (!uid) return res.status(401).json({ ok: false, error: '로그인 필요' });
    const r = await genyaMem.deleteMem(googleAuth([genyaMem.SCOPE]), { userId: uid, id: String(req.query.id || '') });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 🔌 커넥터창고: 목록 + 연결 수 ──
app.get('/api/connectors', (req, res) => res.json({ ok: true, connectedCount: connectors.connectedCount, list: connectors.list }));

// ★카드→대화 맥락: 프론트가 보낸 activeSkill 코드 → 사람이 읽는 작업명(시스템 프롬프트 주입용). 카드에서 시작한 작업을 지니야가 기억·이어감.
const SKILL_CTX = {
  insurance_review: '보험 증권 분석(보장 진단)',
  policy_analysis: '증권분석비서 — 고객 증권(사진/PDF)을 받아 유형 판별 후 필요·준비·부족 보장분석과 1·2·3위 상품제안을 코치 완성본 리포트로 만든다. 증권을 화면 아래 ＋ 버튼으로 올려달라고 안내한다.',
  pension_analysis: '연금분석제안비서 — 변액연금 가입설계서 2개를 받아 표지 있는 고객용 연금 제안서(노후공백·단리보증형 vs 투자형 비교·수령 시뮬·성향별 추천)를 만든다. 설계서 2개를 화면 아래 ＋ 버튼으로 올려달라고 안내한다.',
  product_compare: '상품 비교(제안서 담보·보험료·인수 비교)',
  yakgwan: '약관 해석(근거·출처로 쉽게 설명)',
  lead_gen: '고객 발굴',
  client_discovery: '고객발굴비서(진단링크 임대) — 설계사에게 화이트라벨 진단링크(ohwant-class desire?agent=이름)와 카톡 문구를 만들어 준다. 링크를 뿌리면 신청자가 설계사 본인 구글시트에 쌓이고(오원트 서버 저장 0), 아침마다 지니야가 명단으로 정리한다. 링크·문구 복사와 뿌리는 방법을 안내한다. 연락은 설계사가 직접(자동발송 없음).',
  renewal: '만기·생일 관리',
  client_management: '고객관리비서 — 설계사 엑셀 명단(xlsx/csv)을 받아 관리에 필요한 표준 항목이 있는지 진단하고, 부족 항목("만기일·체결일·생일·가입상품·월납료·가족" 등)을 채우라고 리딩한다. 채워지면 오늘 이벤트·소개까지 관리한다. 엑셀을 화면 아래 ＋ 버튼으로 올려달라고 안내한다.',
  add_agent: '새 비서(맞춤 기능) 추가 요청 — 반복 업무를 듣고, 만들 수 있으면 방법을 안내한다. 어려우면 "이 비서는 아직 제가 못 만들어요. 본사 오상열 대표님(ggorilla11@gmail.com)께 요청해 주세요"라고 정직히 안내(지어내기·있는 척 금지)',
  add_tool: '새 도구·커넥터 추가 요청 — 연결 가능하면 방법 안내, 아직 안 되는 도구면 "본사 오상열 대표님(ggorilla11@gmail.com)께 요청해 주세요"라고 정직히 안내',
};
// ── 💬 Order Made: 자연어 → 실제 모듈 라우팅 + ★결정·요청 자동 기억(회원 구글) ──
async function orderHandler(req, res) {
  try {
    const q = String((req.body && (req.body.q || req.body.message)) || req.query.q || '').trim();
    const ma = memberAuth(req);
    const canData = !!(ma && hasDataScope(req)); // ★데이터 스코프까지 있는 회원만 캘린더·시트·드라이브 호출
    // ★Step2-1: 회장 admin의 관리성 명령(발송·시트 변경 등)은 깊은 모델(Opus4.8)로 라우팅
    const _admin = _isAdmin(req) && /알림톡|문자|이메일|발송|보내|시트.*(추가|수정|삭제|변경|바꿔)|결재|승인/.test(q);
    if (!q) return res.json({ ok: true, kind: 'idle', text: '무엇이든 말씀하세요 (예: "무보험차상해가 뭐야?" / "이번 주 만기 고객 정리해줘")' });
    // ★MEM-2 과거 설계 재현: "예전/지난 ○○ 설계 불러줘" → genya_mem(userId 격리) 검색 → LLM이 그때처럼 재현/수정. 실패 시 아래 일반 흐름으로 폴백(정직).
    if (/(예전|저번|지난|과거|이전|그때|작년|저번주|지난주).{0,8}(설계|보장|연금|제안|분석)|(불러|가져|찾아).{0,6}(설계|제안서|연금|보장분석)/.test(q)) {
      const uid = (sessionOf(req) || {}).email || '';
      if (uid) {
        try {
          const nameM = q.match(/([가-힣]{2,4})님/);
          const rows = await genyaMem.searchMem(googleAuth([genyaMem.SCOPE]), { userId: uid, 고객명: nameM ? nameM[1] : '', limit: 5 });
          if (rows.length) {
            const ctx = rows.map((r2) => `· [${r2.date}] ${r2.고객명 || ''} ${r2.skill || ''}: ${r2.summary || ''}${r2.담보금액 ? (' | ' + r2.담보금액) : ''}`).join('\n');
            const job = String((req.body && req.body.job) || req.query.job || '');
            const sys = genyaPersona(job) + `\n[과거 설계 기억] 아래는 이 회원이 예전에 만든 설계 요약이다. 사용자가 "그때처럼/불러/수정"을 요청하면 이 요약을 근거로 그때 내용을 되살려 답하고, 요청한 수정만 반영한다. 없는 값은 지어내지 마라.\n${ctx}`;
            const hist = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-8) : [];
            const text = await askClaude(sys, hist.concat([{ role: 'user', content: q }]), 8192);
            return res.json({ ok: true, kind: '🧠 과거 설계 기억', text, engine: 'claude-sonnet-5', found: rows.length });
          }
          return res.json({ ok: true, kind: '🧠 과거 설계 기억', text: '저장된 과거 설계를 찾지 못했어요. 고객 별칭이나 날짜를 알려주시면 다시 찾아볼게요. (설계는 만들 때 자동 저장됩니다)' });
        } catch (e) { /* Firestore 접근 실패 → 아래 일반 대화로 폴백 */ }
      }
    }
    // ★데이터가 필요한데 권한이 없으면 대화를 막지 말고 "연결하기" 안내(일반 대화는 아래 LLM으로 무조건 응답)
    const needConnect = { kind: '🔗 구글 데이터 연결 필요', text: '이 질문은 캘린더·시트·드라이브를 읽어야 답할 수 있어요. 아래 버튼으로 한 번만 연결하면 바로 알려드릴게요. (일반 질문은 연결 없이도 대답해요)', needsConnect: true, connectUrl: '/auth/google/connect' };
    const activeSkill = String((req.body && req.body.activeSkill) || '');
    let out = {};
    // ★🛡️ 수문장 최우선(라우팅 근본수정): "방금/올린/만든/업로드/한 것" 류 질문은 커넥터·시트 분기(명단→"7월 만기 0명" 오답)보다 먼저,
    //   이 방에서 실제로 일어난 이벤트를 근거로 인지 응답한다. 이벤트가 있을 때만 발동 → 일반 질문 흐름 무영향.
    const _uidG = (sessionOf(req) || {}).email || '';
    const _gateMatch = /방금|아까|조금\s*전|좀\s*전|최근에|올린|올렸|올려|업로드|만든|만들었|기록한|저장한|한\s*게|했던|뭐\s*했|무슨\s*(파일|명단|자료)/.test(q);
    let _gateEvents = '';
    if (_uidG && personalMem.configured() && _gateMatch) {
      try { _gateEvents = await personalMem.recallRecentEvents({ ownerId: _uidG, limit: 5 }); } catch (e) {}
    }
    console.log('[🛡️수문장] order 가드 · uid=' + (_uidG || '(없음)') + ' · pineconeReady=' + personalMem.configured() + ' · match=' + _gateMatch + ' · events=' + (_gateEvents ? 'HIT(' + _gateEvents.slice(0, 40) + '…)' : 'MISS') + ' · q="' + String(q).slice(0, 30) + '"');
    // ★버그수정: activeSkill(localStorage 복원)이 시트·발송 도구 의도를 가로채던 문제 → 명확한 도구 의도면 activeSkill 무시하고 아래 도구 분기로.
    const _toolIntent = /보내|발송|알림톡|결재|승인|시트\s*(목록|리스트|들|현황|뭐|어떤|무슨|조회|검색|추가|수정|삭제)|어떤\s*시트|무슨\s*시트|내\s*(구글\s*)?시트|명단\s*(추가|수정|삭제|변경|조회|보여|알려|몇)|고객\s*(추가|등록|수정|삭제)|([가-힣]{2,4})\s*님?\s*(정보|연락처|주소|생일|만기|상품|알려|조회)/.test(q);
    // ★이슈#1 근본수정(웹검색 라우팅 가로챔): 최신정보 토픽(시세·환율·세법·판례 등)이면서 고객(○○님) 지칭이 아니면
    //   시트/캘린더 분기가 "어때/조회/뭐야"로 가로채는 것을 막고 일반대화(웹검색) 우선. ★고객명 시트조회는 그대로 유지.
    //   보수적: 요즘/최근/오늘 단독은 제외(예: "요즘 만기 고객"이 웹으로 새지 않게). 명확한 최신 토픽 키워드만.
    const _hasCustomerName = /[가-힣]{2,4}\s*님/.test(q);
    const _webQuery = !_hasCustomerName && /시세|환율|원[·\s]?달러|주가|주식|코스피|코스닥|나스닥|다우|증시|증권시장|시장\s*동향|금리|기준금리|국채|채권\s*금리|유가|국제유가|금값|금\s*시세|비트코인|가상자산|암호화폐|뉴스|속보|판례|대법원|헌재|법령|시행령|개정안|세법\s*개정|종부세|종합부동산세|양도세|양도소득세|상속세|증여세|재산세|공시지가|기준시가|부동산\s*대책|물가|인플레|경기\s*전망|환테크/.test(q);
    if (_gateEvents) {
      // 🛡️ 이 방 이벤트 인지 응답(LLM + 수문장 컨텍스트) — 엄마2 Phase6-3 수문장(무접촉 병합)
      const job = String((req.body && req.body.job) || req.query.job || '');
      const hist = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-10) : [];
      // ★활성 명단 전체 자동 sheet_read(회장님): 명단·전체 관련 요청이고 데이터연결(canData)이 있으면,
      //   이벤트 인지에서 그치지 말고 실제 회원 시트(고객명단)를 조회해 개별 내용까지 답한다. 개별 이름 없이도 전체 조회.
      const _rosterFull = /명단|고객|전체|목록|리스트|정리|분석|누구|몇\s*명|어떤|내용|현황/.test(q) && /명단|roster|업로드/.test(_gateEvents);
      if (_rosterFull && canData) {
        const rc = await sheetsCrud.runChat(ma, hist.concat([{ role: 'user', content: q }]));
        console.log('[🛡️수문장→sheetCRUD] 활성명단 전체조회 · q="' + String(q).slice(0, 30) + '" · reply="' + String((rc && rc.reply) || '(빈)').replace(/\n/g, ' ').slice(0, 150) + '"');
        out = { kind: '🗂️ 고객명단', text: rc.reply || '명단을 시트에서 불러왔어요.', pending: rc.pending || null, engine: MODEL_DEEP };
      } else {
        const sysG = genyaPersona(job, { email: _uidG }) + '\n[지금 이 방에서 최근 일어난 일 — 실제 발생] 아래는 이 지니야 화면에서 실제로 일어난 이벤트다. "방금 올린/만든/한 것"을 물으면 이걸 근거로 정확히 인지하고 답한다(절대 "안 보인다"고 하지 마라). 개별 값을 지어내지는 않는다.\n★명단·시트 저장 이벤트(roster_upload=명단 업로드 등)가 있으면, 그 명단은 이미 회원 구글 시트(고객명단 탭)에 저장돼 있는 것이다. 개별 고객 정보를 물으면 "다시 올려주세요/재업로드"라고 절대 하지 말고, "그 명단은 시트에 저장돼 있어요. \'○○님 정보 알려줘\'라고 하시면 시트에서 바로 조회해 드릴게요. (구글 데이터 연결이 필요할 수 있어요)"라고 안내한다. 시트에 없는 일회성 파일만 없을 때 다시 올려달라 한다.\n' + _gateEvents;
        const text = await askClaude(sysG, hist.concat([{ role: 'user', content: q }]), 8192, { admin: _admin });
        out = { kind: '💬 지니야', text, engine: _lastAskModel || pickedModel(q, { admin: _admin }) };
      }
    } else if (activeSkill && SKILL_CTX[activeSkill] && !_toolIntent) {
      // ★카드에서 시작한 작업 맥락: 키워드 라우팅(증권→드라이브 "해당 파일 없음") 건너뛰고 LLM이 맥락 유지해 이어서 답한다
      const job = String((req.body && req.body.job) || req.query.job || '');
      const hist = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-10) : [];
      const sys = genyaPersona(job, { email: (sessionOf(req) || {}).email }) + `\n[현재 작업] 지금 사용자는 "${SKILL_CTX[activeSkill]}" 작업을 진행 중이다. 앞서 지니야가 안내한 내용(예: 사진·파일 업로드 요청)을 기억한 채 맥락을 유지하고 그 작업을 이어서 돕는다. 맥락을 잃고 "해당 파일 없음" 같은 엉뚱한 답을 하지 마라. 파일이 필요하면 화면 아래 ＋ 버튼으로 올려달라고 자연스럽게 안내한다. ★단, 이 대화에는 실제 파일·데이터가 첨부돼 있지 않다. 사용자가 아직 파일(엑셀·명단·사진)을 올리지 않았으면 올라온 척(가짜 인원수·명단·수치, 예 "방금 올려주신 명단 13명")을 절대 만들지 말고, "아직 파일을 못 받았어요. ＋ 버튼으로 올려주시면 바로 분석할게요"라고 정직히 안내한다.`;
      const text = await askClaude(sys, hist.concat([{ role: 'user', content: q }]), 8192, { admin: _admin, webSearch: true });
      out = { kind: '💬 지니야', text, engine: _lastAskModel || pickedModel(q, { admin: _admin }) };
    } else if (/보내|발송|알림톡|결재|승인/.test(q)) {
      // 🗂️ Step 2-C: 발송·결재 의도 → 결재함 도구 루프(저장→승인→하드가드 발송). "발송 못 한다" 오답 원천 제거.
      if (!canData) { out = needConnect; }
      else {
        const hist = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-10) : [];
        const rc = await approval.runChat(ma, hist.concat([{ role: 'user', content: q }]));
        out = { kind: '🗂️ 결재함', text: rc.reply || '무엇을 보내드릴까요?', pending: rc.pending || null, engine: MODEL_DEEP };
      }
    } else if (!_webQuery && (/시트\s*(목록|리스트|들|현황|뭐|어떤|무슨)|어떤\s*시트|무슨\s*시트|내\s*(구글\s*)?시트|([가-힣]{2,4})\s*님?\s*(정보|연락처|주소|생일|만기|상품|알려|조회|어때|추가|등록|삭제|빼|지워|넣어|수정|변경|바꿔)|시트\s*(조회|검색|추가|수정|삭제|변경|바꿔)|명단|만기|자산가|고객\s*(추가|등록|수정|삭제|정리|목록|누구|전체|명단)|(주소|연락처|번호|생일|상품)\s*(을|를|은|는)?\s*(바꿔|수정|변경|고쳐|추가)/.test(q))) {
      // 🗂️ Step 2-B(마스터 CRM): 명단·만기·고객·개별 조회/수정 = 항상 마스터 시트(지니야빌더_데모_명단) CRUD 도구 루프. 데모 커넥터가 아니라 실제 시트.
      // ★라우팅 진단 로깅(엄마2): "김철수 정보 알려줘"가 이 분기로 왔는지·canData·runChat 응답 원문을 Render 로그로 확정. sheetsCrud 내부는 무접촉.
      console.log('[🗂️sheetCRUD 라우팅] 분기진입 · q="' + String(q).slice(0, 40) + '" · canData=' + canData + ' · uid=' + ((sessionOf(req) || {}).email || '(없음)') + ' · hasDataScope=' + hasDataScope(req));
      if (!canData) { out = needConnect; console.log('[🗂️sheetCRUD] → needConnect (canData=false · 구글 데이터 연결 없음 → sheetsCrud 호출 안 함)'); }
      else {
        const hist = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-10) : [];
        const rc = await sheetsCrud.runChat(ma, hist.concat([{ role: 'user', content: q }]));
        console.log('[🗂️sheetCRUD] runChat 응답 · reply="' + String((rc && rc.reply) || '(빈)').replace(/\n/g, ' ').slice(0, 180) + '" · pending=' + !!(rc && rc.pending));
        out = { kind: '🗂️ 고객명단', text: rc.reply || '무엇을 도와드릴까요?', pending: rc.pending || null, engine: MODEL_DEEP };
      }
    } else if (/약관|무보험|대물|자기신체|자동차상해|담보|보장.*(뭐|무엇|차이)/.test(q)) {
      const r = await askYakgwan(q); out = { kind: '📄 약관창고', text: r.answer, sources: r.sources }; // 공통 지식(구글 불필요)
    } else if (/만기|명단|자산가|고객.*(정리|목록|누구)/.test(q)) {
      if (!canData) { out = needConnect; } else { const s = await connectors.sheet(ma); out = { kind: '🔌 시트 커넥터', text: `7월 만기 ${s.july만기.length}명 · 임박순 ${s.임박순.join(' → ')}\n자산가: ${s.자산가.join(', ')}` }; }
    } else if (/증권|드라이브|서류|파일.*찾/.test(q)) {
      if (!canData) { out = needConnect; } else { const d = await connectors.drive(q.replace(/찾아줘|보여줘|줘/g, '').trim() || '증권', ma); out = { kind: '🔌 드라이브 커넥터', text: d.length ? d.map((f) => '📄 ' + f.name).join('\n') : '해당 파일 없음' }; }
    } else if (!_webQuery && /일정|브리핑|오늘.*(뭐|일정)|아침/.test(q)) {
      if (!canData) { out = needConnect; } else { const c = await connectors.calendar(ma); out = { kind: '🔌 캘린더 커넥터', text: c.map((e) => `${e.time} ${e.title}${e.prep[0] ? ' → ' + e.prep[0] : ''}`).join('\n') || '오늘 일정 없음' }; }
    } else {
      // ★워크스페이스 대화 = 하이브리드 라우터(askClaude) + 히스토리(-10) + 직업 페르소나
      //   ★v4.0 Step2-A: 로그인 대표면 개인화 기억(대표 네임스페이스)에서 유사 Top-K를 꺼내 프롬프트에 주입,
      //     응답 후 이 대화를 비동기 저장(응답 지연 0). PINECONE_API_KEY 없으면 전부 no-op(동작 불변).
      const job = String((req.body && req.body.job) || req.query.job || '');
      const hist = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-10) : [];
      const uid = (sessionOf(req) || {}).email || '';
      // ★v4.0 Step2-A 고객스코프: "홍길동님..."처럼 특정 고객을 지칭하면 그 고객 네임스페이스에서 회상·저장(분리 원칙 8-1).
      //   지칭 없으면 대표 네임스페이스. detectCustomer가 호칭성 단어("대표님")는 걸러낸다.
      const 호칭 = 호칭For(uid);
      const cust = personalMem.detectCustomer(q);
      const memScope = cust ? 'customer' : 'representative';
      let memCtx = '';
      if (uid && personalMem.configured()) { try { memCtx = await personalMem.recallSmart({ ownerId: uid, scope: memScope, customerId: cust, query: q }); } catch (e) {} }
      const memWho = cust ? (cust + '님') : 호칭;
      // ★🛡️ 수문장: 이 방에서 방금 일어난 일(명단 업로드·시트·발송 등)을 매 대화에 주입 → "방금 뭐 했지"를 지니야가 자동 인지.
      let recentEvents = '';
      if (uid && personalMem.configured()) { try { recentEvents = await personalMem.recallRecentEvents({ ownerId: uid, limit: 5 }); } catch (e) {} }
      const sysP = genyaPersona(job, { email: uid })
        + (recentEvents ? ('\n[지금 이 방에서 최근 일어난 일 — 실제 발생] 아래는 이 지니야 화면에서 실제로 일어난 이벤트다. "방금 올린/만든/한 것"을 물으면 이걸 근거로 인지하고 답한다(안 보인다고 하지 마라). 단 파일 속 개별 세부(고객별 값)는 실제 분석 결과가 있을 때만 말한다.\n' + recentEvents) : '')
        + (memCtx ? ('\n[' + memWho + ' 기억] 아래는 ' + memWho + '의 과거 대화·자료 요약이다. 관련되면 근거로 활용하되 없는 값은 지어내지 마라.\n' + memCtx) : '');
      const text = await askClaude(sysP, hist.concat([{ role: 'user', content: q }]), 8192, { admin: _admin, webSearch: true });
      out = { kind: '💬 지니야', text, engine: _lastAskModel || pickedModel(q, { admin: _admin }) };
      if (uid && personalMem.configured()) personalMem.saveMemoryAsync({ ownerId: uid, scope: memScope, customerId: cust, source: 'dialog', text: q + '\n→ ' + text, summary: (cust ? cust + '님 ' : '') + q });
    }
    // ★연결1: 결정·요청이면 회원 구글시트에 자동 기억(서버 저장 0) — 데이터 스코프 있는 회원만(없으면 조용히 건너뜀)
    let saved = null;
    if (canData && /준비|해줘|만들어|보내|정리|초안|잡아|하기로|예약|하자|올려/.test(q)) {
      const nameM = q.match(/([가-힣]{2,4})님/);
      try { await memory.saveMemory({ type: '요청', subject: nameM ? nameM[1] : '', text: q }, ma); saved = { subject: nameM ? nameM[1] : '', text: q }; } catch (e) {}
    }
    // ★E-4 홀로그램 카드 분리: 응답이 {text,cards} JSON이면 카드를 out.cards로 분리(프론트 렌더). 아니면 원문 텍스트 그대로(안전 폴백).
    if (out && typeof out.text === 'string') {
      const parsed = tryParseCards(out.text);
      if (parsed) { out.text = parsed.text; out.cards = parsed.cards; }
    }
    // ★이모지 0 최종 게이트: askClaude를 안 타는 응답(결재함·커넥터 등)까지 포함해 모든 지니야 text에서 이모지 제거(결정적).
    if (out && typeof out.text === 'string') out.text = stripEmoji(out.text);
    res.json({ ok: true, ...out, saved });
  } catch (e) {
    // ★권한부족이 여기까지 새면 대화 전체가 막히지 않도록 "연결하기"로 정직히 안내(500 대신)
    if (isScopeError(e)) return res.json({ ok: true, kind: '🔗 구글 데이터 연결 필요', text: '이 질문은 내 구글 데이터를 읽어야 해요. 아래 버튼으로 연결해 주세요. (일반 질문은 연결 없이도 대답해요)', needsConnect: true, connectUrl: '/auth/google/connect' });
    res.status(500).json({ ok: false, error: e.message });
  }
}
app.get('/api/order', orderHandler);   // 단발(카드·솔브 등)
app.post('/api/order', orderHandler);  // ★워크스페이스 대화(히스토리 body 전달)

// ── 🧠 기억 엔진 (★로그인 회원 자기 구글시트에만 · 회원 간 격리 · SA 폴백 제거) ──
app.get('/api/memory/recent', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; res.json({ ok: true, list: await memory.recallRecent(8, ma) }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
app.get('/api/memory/recall', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; res.json({ ok: true, list: await memory.recallMemory(req.query.q || '', ma) }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
app.get('/api/memory/lead', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; const r = await memory.recallRecent(8, ma); const dec = r.find((m) => m.type === '결정' || m.type === '요청'); res.json({ ok: true, lead: dec ? memory.leadLine(dec) : null }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
app.get('/api/memory/save', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; const r = await memory.saveMemory({ type: req.query.type || '메모', subject: req.query.subject || '', text: req.query.text || '' }, ma); res.json({ ok: true, ...r }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
app.get('/api/memory/delete', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; res.json({ ok: true, ...(await memory.deleteMemory(parseInt(req.query.row, 10), ma)) }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });

// ── 🎓 온보딩: 회원 프로필(직업·설문) = 회원 본인 구글시트에만 저장(원칙1) ──
//   ★회원 OAuth는 SA와 달리 자기 드라이브에 시트 생성 가능 → 없으면 만들어줌(진짜 다회원).
const PROFILE_TAB = '지니야_프로필';
// ★계정별 역할(대표 지시): 두 이메일을 서버 상수로 구분한다.
//   VIP_EMAIL      = 오상열 대표 본사 VIP → 저장된 보험설계사 세팅 복원, 온보딩 스킵.
//   DEMO_FRESH_EMAIL = 대표 시연/체험용 → 항상 "처음 들어온 신규"처럼 온보딩부터.
const VIP_EMAIL = 'ggorilla11@gmail.com';
const DEMO_FRESH_EMAIL = 'ggorilla66@gmail.com';
async function findOrCreateMemberSheet(ma) {
  const drive = google.drive({ version: 'v3', auth: ma }), sheets = google.sheets({ version: 'v4', auth: ma });
  const f = await drive.files.list({ q: `mimeType='application/vnd.google-apps.spreadsheet' and name='${DEMO_TITLE}' and trashed=false`, fields: 'files(id)' });
  let id = (f.data.files || [])[0] && f.data.files[0].id;
  if (!id) { const c = await sheets.spreadsheets.create({ requestBody: { properties: { title: DEMO_TITLE }, sheets: [{ properties: { title: SHEET_TAB } }] }, fields: 'spreadsheetId' }); id = c.data.spreadsheetId; }
  return { id, sheets };
}
async function ensureTab(sheets, id, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
  if (!(meta.data.sheets || []).some((s) => s.properties.title === title)) await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
}
// 📇 Step 2-F · 명단 업로드→회원 시트 저장 (제로 인그레스: 파싱만·회원 시트 write·서버 저장0)
rosterImport.init({ getMemberSheet: findOrCreateMemberSheet, ensureTab, title: DEMO_TITLE, tab: SHEET_TAB });
app.post('/api/roster/import', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return;
    const b = req.body || {};
    const rr = await rosterImport.importRoster(ma, { dataUrl: b.dataUrl || b.file || '', mode: b.mode, confirm: !!b.confirm });
    // ★🛡️ 수문장: 명단 업로드(변방)를 개인화 기억(중앙)에 기록 → 지니야 대화가 "방금 올린 명단"을 자동 인지. 실제 발생분만.
    try {
      const uid = (sessionOf(req) || {}).email || '';
      const cfg = personalMem.configured();
      const cnt = (rr && (rr.total || rr.count || rr.added || rr.saved || (Array.isArray(rr.rows) ? rr.rows.length : 0))) || 0;
      console.log('[🛡️수문장] roster/import 훅 · uid=' + (uid || '(없음)') + ' · pineconeReady=' + cfg + ' · cnt=' + cnt + ' · rr.ok=' + (rr && rr.ok) + ' · confirm=' + (!!b.confirm));
      if (uid && rr && rr.ok !== false && cfg) {
        personalMem.recordEventAsync({ ownerId: uid, type: 'roster_upload', source: 'upload', summary: '고객 명단 파일 업로드' + (cnt ? (' · ' + cnt + '명') : '') + (b.name ? (' (' + b.name + ')') : '') });
        console.log('[🛡️수문장] recordEventAsync 호출됨(roster_upload · ' + cnt + '명)');
      } else { console.log('[🛡️수문장] recordEvent 건너뜀(uid없음 or pinecone미연결 or rr실패)'); }
    } catch (e) { console.log('[🛡️수문장] roster 훅 오류: ' + e.message); }
    res.json(rr);
  } catch (e) { if (scopeGate(e, res, 'sheets')) return; res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/profile', async (req, res) => {
  try { const ma = gateGoogle(req, res); if (!ma) return; const { id, sheets } = await findOrCreateMemberSheet(ma);
    let rows = []; try { const g = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${PROFILE_TAB}!A1:B20` }); rows = g.data.values || []; } catch (e) {}
    const p = {}; rows.forEach((r) => { if (r[0]) p[r[0]] = r[1] || ''; });
    res.json({ ok: true, onboarded: !!p['직업'], profile: p });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// ── 🧭 로그인 후 화면 분기의 '권위 소스' ──
//   ★버그 수정: 예전엔 클라이언트가 브라우저 localStorage(genya_job)로 화면을 정해,
//     계정과 무관하게 그 브라우저에 남은 직업(예: 공인중개사) 메인으로 직행 → 온보딩 스킵.
//     로그아웃/다른 계정도 같은 localStorage를 봐서 똑같이 오염됐다.
//   → 이제 "이 로그인 계정"의 상태를 서버가 정한다. route: login | onboarding | main.
//   ★절대 기본 직업으로 메인 직행 금지. 저장값 없으면 온보딩.
app.get('/api/boot', async (req, res) => {
  try {
    const s = sessionOf(req);
    if (!s) return res.json({ ok: true, loggedIn: false, route: 'login' });
    const email = String(s.email || '').toLowerCase();
    // 시연/체험용 계정: 항상 온보딩부터(교육생처럼)
    if (email === DEMO_FRESH_EMAIL) return res.json({ ok: true, loggedIn: true, email, route: 'onboarding' });
    // 본사 VIP(대표): 저장된 보험설계사 세팅 복원, 온보딩 스킵(스코프 유무와 무관하게 보장)
    if (email === VIP_EMAIL) return res.json({ ok: true, loggedIn: true, email, route: 'main', job: 'insurance', vip: true });
    // 일반 회원: 서버 저장 프로필(회원 본인 구글시트)로 분기
    const ma = memberAuth(req);
    if (ma && hasDataScope(req)) {
      try {
        const { id, sheets } = await findOrCreateMemberSheet(ma);
        let rows = []; try { const g = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${PROFILE_TAB}!A1:B20` }); rows = g.data.values || []; } catch (e) {}
        const p = {}; rows.forEach((r) => { if (r[0]) p[r[0]] = r[1] || ''; });
        if (p['직업']) return res.json({ ok: true, loggedIn: true, email, route: 'main', jobLabel: p['직업'], profile: p });
      } catch (e) {}
    }
    // 저장값 없음/조회 불가 → 온보딩(신규). ★기본 직업 메인 직행 금지.
    return res.json({ ok: true, loggedIn: true, email, route: 'onboarding' });
  } catch (e) { res.json({ ok: true, loggedIn: false, route: 'login', error: e.message }); }
});
app.get('/api/profile/save', async (req, res) => {
  try { const ma = gateGoogle(req, res); if (!ma) return; const { id, sheets } = await findOrCreateMemberSheet(ma);
    await ensureTab(sheets, id, PROFILE_TAB);
    const rows = [['직업', String(req.query.job || '')], ['이름', String(req.query.nick || '')], ['하는일', String(req.query.work || '')], ['주고객', String(req.query.clients || '')], ['반복업무', String(req.query.pain || '')], ['맡길기능', String(req.query.tasks || '')], ['철칙', String(req.query.rule || '')], ['설문방식', String(req.query.mode || '')], ['생성일', new Date().toISOString().slice(0, 10)]];
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${PROFILE_TAB}!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });
    res.json({ ok: true, saved: true, sheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit` });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// 온보딩 화면(로그인 게이트)
app.get('/onboarding', (req, res) => { res.redirect('/'); }); // ★옛날 축소판 제거 → v4(genya.html)로 통일

// 🤖 목표 → 실제 능력 배정(LLM이 우리 실제 커넥터/창고로 매핑. 글자매칭 아님)
app.get('/api/agents/assign', async (req, res) => {
  try {
    const goals = String(req.query.goals || '').split('|').map((s) => s.trim()).filter(Boolean);
    if (!goals.length) return res.json({ ok: true, agents: [] });
    const CATALOG = '가능한 실제 능력(우리 엔진): 발굴(유튜브 공개댓글 Hot/Warm), 리스닝(공개 커뮤니티 보험고민 탐지), 시트(고객명단 만기·자산가 정리), 캘린더(일정+준비물 브리핑), 드라이브(증권·서류 검색·읽기), 약관(약관 근거+출처 답), 스킬(PDF·엑셀·PPT·문서 생성), 기억(정한 것 기억·먼저 리딩), 웹조사(실시간 상품·시세).';
    const sys = `너는 온보딩 배정기다. 사용자의 목표 각각에 대해 위 "실제 능력" 중 맞는 것을 1~2개 배정한다. 목록에 있는 이름만 쓴다. JSON 배열만: [{"goal":"목표","agents":["능력명"],"why":"짧은근거"}]. ${CATALOG}`;
    const r0 = await askClaude(sys, [{ role: 'user', content: '목표들:\n' + goals.map((g, i) => (i + 1) + '. ' + g).join('\n') }], 500);
    let raw = (r0 || '').trim(); raw = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
    let agents = []; try { agents = JSON.parse(raw); } catch (e) {}
    res.json({ ok: true, agents });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 📤 자료 올리기 = ★원천 차단(서버 통과 0): 파일은 브라우저→구글 드라이브 직행한다.
//   서버는 회원 access_token'만' 발급하고, 파일 바이트는 오원트 서버를 절대 지나가지 않는다.
//   refresh_token은 서버 세션에만(브라우저 미노출). 노출되는 access_token은 drive.file 스코프(앱이 만든 파일만).
//   ※ 구 방식 POST /api/drive/upload(base64가 서버 RAM을 통과)는 대표 지시로 폐기함.
app.get('/api/drive/token', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return;              // 회원 구글 세션 없으면 거부(SA 폴백 없음)
    const t = await ma.getAccessToken();                            // 단기 access_token만. refresh_token 미노출
    if (!t || !t.token) return res.status(401).json({ ok: false, error: '토큰 없음 — 구글 재연결 필요' });
    res.json({ ok: true, token: t.token, note: '브라우저 직행 업로드용 단기 access_token(drive.file). 파일은 서버 안 지남.' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 🗣️ 자연어 대화/업로드 텍스트 → 프로필 추출(실제 LLM, 하드코딩 아님)
// ★E4 수정: POST(body.text) 지원 → 긴 자유서술도 안전(GET 쿼리 길이 431 회피). GET은 하위호환.
async function _extractHandler(req, res) {
  try {
    let text = String((req.body && req.body.text) || req.query.text || '').trim();
    if (!text) return res.json({ ok: true, profile: {} });
    if (text.length > 4000) text = text.slice(0, 4000); // 초장문 방어(크래시 없이 앞부분만)
    const sys = `너는 온보딩 도우미다. 사용자가 자기 일을 설명한 글에서 아래 필드를 뽑아 JSON만 출력한다(없으면 빈칸): {"job":"직업","work":"하는 일","clients":"주 고객","pain":"반복 업무","tasks":"맡길 기능","rule":"철칙"}. tasks는 서로 다른 목표가 여럿이면 세미콜론(;)으로 구분해 한 줄로. 지어내지 말고 글에 있는 것만.`;
    const r0 = await askClaude(sys, [{ role: 'user', content: text }], 400);
    let raw = (r0 || '').trim(); raw = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    let profile = {}; try { profile = JSON.parse(raw); } catch (e) {}
    res.json({ ok: true, profile });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
}
app.post('/api/onboard/extract', _extractHandler);
app.get('/api/onboard/extract', _extractHandler);

// ── ⏰ 리마인더비서: "A고객 3사 비교 a·b·c사 요청" → 회사별 1건씩 쪼개기 ──
//   ★로그인 불필요(대화 LLM). ★데이터 저장 0(쪼갠 결과만 반환, 회원 브라우저 localStorage에만 보관). 지어내기 금지.
app.post('/api/reminder/split', async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').trim();
    if (!text) return res.json({ ok: true, items: [] });
    const sys = '너는 보험설계사의 "요청해둔 일"을 건별로 쪼개는 비서다. 설계사가 누구 고객에 대해 어느 회사(들)에 무엇을 요청해뒀다고 말하면, 회사마다 1건으로 나눠 JSON 배열만 출력한다. 형식: [{"대상":"고객명","내용":"요청한 일","회사":"회사명"}]. 회사가 여럿이면 각각 1건(예: 삼성·메리츠·DB = 3건). 회사 언급이 없으면 회사는 빈칸으로 1건. ★말에 있는 것만, 지어내기 절대 금지. JSON 배열만 출력(설명·코드펜스 없이).';
    const raw = await askClaude(sys, [{ role: 'user', content: text }], 500);
    let t = String(raw || '').trim(); const s = t.indexOf('['), e = t.lastIndexOf(']');
    let items = []; if (s >= 0 && e > s) { try { items = JSON.parse(t.slice(s, e + 1)); } catch (err) {} }
    if (!Array.isArray(items)) items = [];
    res.json({ ok: true, items: items.slice(0, 20) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 📨 발송현황 수신(watcher→서버, 2단계) — watcher가 발송 성공/실패 스냅샷을 POST /api/send/status로 보냄.
//   ★AGENT_NAME(회원)별 메모리 Map(휘발·서버 디스크 저장 0). ★제로 인그레스: 이름 마스킹(김○○)·성공/실패 카운트+라벨만. 전화·메시지·재발송링크는 저장 안 함.
const _sendStatus = new Map(); // agent → { success:[{name,time}], fail:[{name,reason,time}], updated }
function _maskNm(s) { s = String(s == null ? '' : s).trim(); if (s.length <= 1) return s || '—'; if (s.length === 2) return s[0] + '○'; return s[0] + '○'.repeat(s.length - 2) + s[s.length - 1]; }
app.post('/api/send/status', (req, res) => {
  try {
    const b = req.body || {};
    const agent = String(b.agent || '').trim();
    if (!agent) return res.json({ ok: false, error: 'agent 없음' });
    const success = (Array.isArray(b.success) ? b.success : []).slice(-100).map((x) => ({ name: _maskNm(x && x.name), time: String((x && x.time) || '').slice(0, 10) }));
    const fail = (Array.isArray(b.fail) ? b.fail : []).slice(-100).map((x) => ({ name: _maskNm(x && x.name), reason: String((x && x.reason) || '').slice(0, 30), time: String((x && x.time) || '').slice(0, 10) }));
    _sendStatus.set(agent, { success, fail, updated: Date.now() });
    res.json({ ok: true, success: success.length, fail: fail.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/watcher/status', (req, res) => {
  try {
    const agent = String(req.query.agent || '').trim();
    const s = agent ? _sendStatus.get(agent) : null;
    const installed = !!(s && s.updated && (Date.now() - s.updated < 24 * 3600 * 1000)); // 최근 24h 내 보고 = 발송기 연결됨
    res.json({ ok: true, installed, success: s ? s.success.length : 0, fail: s ? s.fail.length : 0, lastSeen: (s && s.updated) ? new Date(s.updated).toTimeString().slice(0, 5) : '', successList: s ? s.success.slice(-20) : [], failList: s ? s.fail.slice(-20) : [] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 🗣️ 온보딩 대화: 지니야가 자연스럽게 응답(실제 LLM). ★구글 데이터 불필요 = 로그인·권한 없이도 무조건 대답 ──
app.post('/api/onboard/chat', async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').trim();
    if (!text) return res.json({ ok: true, reply: '편하게 말씀해 주세요. 어떤 일을 하시나요?' });
    const history = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-8) : [];
    const sys = genyaPersona(String((req.body && req.body.job) || '')) + '\n[지금 상황] 맞춤 비서를 만드는 온보딩 대화 중. 고객의 직업·제일 힘든 일·맡기고 싶은 일·꼭 지켜야 할 철칙을 한 번에 하나씩 자연스럽게 파악한다(짧고 다정하게 2~3문장). 이미 들은 건 다시 묻지 않는다. 정보가 어느 정도 모이면 아래 \'이 정보로 지니야 만들기\' 버튼을 누르시면 만들어 드린다고 안내한다.';
    const msgs = history.filter((m) => m && m.text).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text).slice(0, 800) }));
    msgs.push({ role: 'user', content: text.slice(0, 800) });
    const reply = await askClaude(sys, msgs, 500);
    res.json({ ok: true, reply: reply || '네, 알겠어요. 조금 더 말씀해 주세요.' });
  } catch (e) { res.json({ ok: false, reply: '지금 잠깐 응답이 어려워요. 다시 한 번 말씀해 주세요.', error: e.message }); }
});

// ── 📄 ★문제4: 증권 이미지 OCR → 보장분석(gpt-4o 비전). 구글 불필요. ★서버 저장 0: 메모리에서 OpenAI로만 전달, 디스크 미기록 ──
// ★만능 처리기: 어떤 파일이 와도(이미지·PDF·엑셀·텍스트) 판별→변환→분석. "이미지로 올려주세요 멈춤" 제거.
//   서버 저장 0(메모리에서만 처리). 변환 불가 형식만 정직하게 안내. 새 의존성 없음(xlsx·pdf_skill 기존 사용).
app.post('/api/coverage/analyze', async (req, res) => {
  try {
    const dataUrl = String((req.body && req.body.dataUrl) || '');
    const mime = String((req.body && req.body.mime) || '');
    const name = String((req.body && req.body.name) || '');
    if (!dataUrl) return res.json({ ok: false, error: '파일이 없어요.' });
    const b64 = dataUrl.replace(/^data:[^,]*,/, '');
    const ext = (name.split('.').pop() || '').toLowerCase();
    const isImg = /^data:image\//i.test(dataUrl) || /^image\//i.test(mime) || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
    const isPdf = /pdf/i.test(mime) || /^data:application\/pdf/i.test(dataUrl) || ext === 'pdf';
    const isXls = /sheet|excel|spreadsheet|csv/i.test(mime) || ['xlsx', 'xls', 'csv'].includes(ext);
    const isTxt = /^text\//i.test(mime) || ['txt', 'md'].includes(ext);
    const isDoc = /wordprocessing|msword/i.test(mime) || ['docx', 'doc'].includes(ext);
    const isHwp = ['hwp', 'hwpx'].includes(ext);
    const sys = '너는 서류 분석 비서 "지니야"다. 주어진 자료가 무엇인지 먼저 파악하고(보험증권/제안서/고객명단/계약서/보상서류/견적서 등), 그에 맞게 핵심을 비전문가도 알기 쉽게 정리한다. 담보·금액·조건은 표로. 자료에서 확실히 안 보이는 수치는 지어내지 말고 "자료에서 확인 필요"라고 한다. 마지막 줄에 반드시 "※ 제출·발송 전 반드시 검토하세요"를 붙인다.';
    async function claudeText(userText) {
      const ar = await _anthropic.messages.create({ model: WS_CHAT_MODEL, max_tokens: 1400, system: sys, messages: [{ role: 'user', content: userText }] });
      return (ar.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    }
    let analysis = '';
    if (isImg) {
      const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      const mediaType = (m && m[1]) || (/^image\//i.test(mime) ? mime : 'image/jpeg');
      const data = m ? m[2] : b64;
      try {
        const ar = await _anthropic.messages.create({ model: WS_CHAT_MODEL, max_tokens: 1400, system: sys, messages: [{ role: 'user', content: [{ type: 'text', text: '이 자료를 분석해줘.' }, { type: 'image', source: { type: 'base64', media_type: mediaType, data: data } }] }] });
        analysis = (ar.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        if (!analysis) throw new Error('빈 응답');
      } catch (e) {
        const r = await _openai.chat.completions.create({ model: 'gpt-4o', temperature: 0.2, max_tokens: 1200, messages: [{ role: 'system', content: sys }, { role: 'user', content: [{ type: 'text', text: '이 자료를 분석해줘.' }, { type: 'image_url', image_url: { url: dataUrl } }] }] });
        analysis = (r.choices[0].message.content || '').trim();
      }
    } else if (isPdf) {
      try {
        // ★PDF = Claude 문서모드(표·담보를 시각적으로 정확히 봄, 서버 변환 라이브러리 불필요)
        const ar = await _anthropic.messages.create({ model: WS_CHAT_MODEL, max_tokens: 1600, system: sys, messages: [{ role: 'user', content: [{ type: 'text', text: '이 문서를 분석해줘.' }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }] }] });
        analysis = (ar.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        if (!analysis) throw new Error('빈 응답');
      } catch (e) {
        // 폴백: 텍스트 추출 후 분석(표 정밀도는 낮지만 끊기지 않게)
        try { const { readPdf } = require('./pdf_skill'); const pr = await readPdf(Buffer.from(b64, 'base64')); analysis = await claudeText('아래는 PDF에서 추출한 텍스트야. 무엇인지 파악하고 분석해줘:\n\n' + String(pr.text || '').slice(0, 12000)); } catch (e2) { analysis = ''; }
      }
    } else if (isXls) {
      try {
        const XLSX = require('xlsx');
        const wb = XLSX.read(Buffer.from(b64, 'base64'), { type: 'buffer' });
        let dump = ''; wb.SheetNames.slice(0, 3).forEach((nm) => { dump += '[' + nm + ']\n' + XLSX.utils.sheet_to_csv(wb.Sheets[nm]).slice(0, 6000) + '\n\n'; });
        analysis = await claudeText('아래는 엑셀/CSV 내용이야(시트별). 무엇인지 파악하고 핵심을 분석·요약해줘:\n\n' + dump);
      } catch (e) { analysis = ''; }
    } else if (isTxt) {
      try { analysis = await claudeText('아래 텍스트 자료를 분석해줘:\n\n' + Buffer.from(b64, 'base64').toString('utf8').slice(0, 12000)); } catch (e) { analysis = ''; }
    } else if (isDoc || isHwp) {
      return res.json({ ok: true, needsConvert: true, message: (isHwp ? '한글(hwp)' : '워드(docx)') + '는 곧 지원돼요. 지금은 PDF로 저장하거나 내용을 복사해서 올려주시면 바로 분석할게요.' });
    } else {
      return res.json({ ok: true, needsConvert: true, message: '이 형식은 아직 지원 안 돼요(' + (ext || mime || '알 수 없음') + '). 이미지·PDF·엑셀·텍스트로 올려주세요.' });
    }
    if (!analysis) return res.json({ ok: false, error: '분석에 실패했어요. 이미지·PDF로 올려주시면 바로 될 거예요.' });
    // ★A-6: 업로드 문서 분석도 개인화 벡터 메모리에 저장(source=upload) → "올린 증권/자료" 회상 대비. 키/로그인 없으면 no-op.
    const _muid = (sessionOf(req) || {}).email || '';
    if (_muid && personalMem.configured() && analysis) personalMem.saveMemoryAsync({ ownerId: _muid, scope: 'representative', source: 'upload', text: analysis, summary: (name || '업로드 문서') + ' 분석' });
    res.json({ ok: true, analysis: stripEmoji(analysis) }); // ★결과만 반환(이모지 제거·팀장 톤), 파일·결과 서버 저장 안 함
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 💬 ★문제5: 안내 문자 초안(실제 LLM). 구글 불필요. 발송 안 함(초안만) ──
app.get('/api/draft/message', async (req, res) => {
  try {
    const topic = String(req.query.topic || '자동차보험 만기 안내');
    const rule = String(req.query.rule || '발송 전 반드시 확인');
    const draftSys = '너는 보험설계사의 비서 지니야다. 고객에게 보낼 짧고 따뜻한 안내 문자 "초안"만 쓴다(실제 발송 안 함). 과장·단정 금지, 부담 주지 않기. 고객 이름은 OOO로. 마지막에 "(발송 전 확인)"을 붙인다.';
    const draft = await askClaude(draftSys, [{ role: 'user', content: '주제: ' + topic + '\n꼭 지킬 철칙: ' + rule }], 400);
    res.json({ ok: true, draft });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 📱 ★문제3: 솔라피 연결정보 저장 = ★회원 본인 구글시트에만(서버 저장 0). 데이터 스코프 없으면 연결 안내 ──
app.post('/api/connect/solapi/save', async (req, res) => {
  try {
    const ma = memberAuth(req);
    if (!ma || !hasDataScope(req)) return res.json({ ok: true, needsConnect: true, connectUrl: '/auth/google/connect', message: '내 시트에 저장하려면 구글 데이터 연결이 필요해요.' });
    const key = String((req.body && req.body.key) || ''), secret = String((req.body && req.body.secret) || ''), from = String((req.body && req.body.from) || '');
    const { id, sheets } = await findOrCreateMemberSheet(ma);
    await ensureTab(sheets, id, '지니야_연결');
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: '지니야_연결!A1', valueInputOption: 'RAW', requestBody: { values: [['솔라피_API_KEY', key], ['솔라피_SECRET', secret], ['솔라피_발신번호', from], ['솔라피_저장일', new Date().toISOString().slice(0, 10)]] } });
    res.json({ ok: true, saved: true }); // ★오원트 서버엔 저장 안 함, 회원 구글시트에만
  } catch (e) { if (isScopeError(e)) return res.json({ ok: true, needsConnect: true, connectUrl: '/auth/google/connect' }); res.status(500).json({ ok: false, error: e.message }); }
});

// ── 📱 문자(SMS) 실발송 — 회원 본인 솔라피 키로 1건 발송.
//    ★휴먼인루프: 웹에서 사람이 [승인]을 누른 뒤에만 호출된다(자동 발송 없음, 요청당 1건).
//    ★제로 인그레스: 받는번호·문구는 발송에만 쓰고 서버·시트에 저장 0. 키는 회원 본인 시트에서만 읽음(멀티테넌트 격리).
//    ★가짜 성공 금지: 솔라피가 정상 접수(statusCode 2000/SENDING)일 때만 sent:true, 아니면 사유 그대로 반환.
app.post('/api/send/sms', async (req, res) => {
  try {
    const ma = memberAuth(req);
    if (!ma || !hasDataScope(req)) return res.json({ ok: false, needsConnect: true, connectUrl: '/auth/google/connect', message: '문자 발송은 구글 데이터 연결 후, 본인 시트에 저장한 솔라피 키로 나가요.' });
    const to = String((req.body && req.body.to) || '').replace(/[^0-9]/g, '');
    const text = String((req.body && req.body.text) || '').trim();
    if (!to || !text) return res.json({ ok: false, error: '받는 번호와 내용을 모두 입력해 주세요.' });
    // 회원 본인 시트(지니야_연결)에서 솔라피 키 읽기 — 서버 저장 0
    const { id, sheets } = await findOrCreateMemberSheet(ma);
    const kv = {};
    try {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: '지니야_연결!A1:B10' });
      (r.data.values || []).forEach((row) => { if (row && row[0]) kv[row[0]] = row[1] || ''; });
    } catch (e) { /* 탭 없음 = 아직 미저장 */ }
    const apiKey = kv['솔라피_API_KEY'], apiSecret = kv['솔라피_SECRET'], from = String(kv['솔라피_발신번호'] || '').replace(/[^0-9]/g, '');
    if (!apiKey || !apiSecret || !from) return res.json({ ok: false, needsSolapi: true, message: '먼저 솔라피 API 키와 발신번호를 저장해 주세요.' });
    // 솔라피 v4 인증: HMAC-SHA256(date+salt, apiSecret)
    const crypto = require('crypto');
    const date = new Date().toISOString();
    const salt = crypto.randomBytes(32).toString('hex');
    const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
    const auth = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
    let sr, out;
    try {
      sr = await fetch('https://api.solapi.com/messages/v4/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ message: { to, from, text } })
      });
      out = await sr.json().catch(() => ({}));
    } catch (e) { return res.json({ ok: false, sent: false, error: '솔라피 연결 실패: ' + e.message }); }
    const okSent = sr.ok && out && (String(out.statusCode) === '2000' || out.status === 'SENDING' || out.messageId);
    if (okSent) return res.json({ ok: true, sent: true, id: out.messageId || out.groupId || null });
    // 실패 = 정직하게 사유 전달(가짜 성공 없음)
    return res.json({ ok: false, sent: false, error: (out && (out.errorMessage || out.statusMessage || out.message)) || ('솔라피 응답 오류(HTTP ' + (sr && sr.status) + ')') });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 📧 이메일 발송 — 회원 본인 Gmail로 1건 발송(gmail.send 스코프 — 실제 발송 확실히. compose에도 send가 포함되나 명시).
//    ★휴먼인루프: 웹 [승인] 후에만 호출(자동 발송 없음). ★제로 인그레스: 받는이·제목·내용은 발송에만, 서버 저장 0.
//    ★멀티테넌트: 회원 본인 구글 토큰으로만 발송(gateGoogle). ★가짜성공 금지: Gmail이 messageId 반환할 때만 sent:true.
app.post('/api/gmail/send', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return;
    const to = String((req.body && req.body.to) || '').trim();
    const subject = String((req.body && req.body.subject) || '').trim();
    const text = String((req.body && req.body.text) || '').trim();
    if (!to || !text) return res.json({ ok: false, error: '받는 이메일과 내용을 모두 입력해 주세요.' });
    const gmail = google.gmail({ version: 'v1', auth: ma });
    // RFC822 (한글 제목=MIME encoded-word, 본문=UTF-8 base64로 안전 인코딩)
    const subjEnc = '=?UTF-8?B?' + Buffer.from(subject || '(제목 없음)', 'utf-8').toString('base64') + '?=';
    const mime = [
      'To: ' + to,
      'Subject: ' + subjEnc,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(text, 'utf-8').toString('base64'),
    ].join('\r\n');
    const raw = Buffer.from(mime, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const r = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    if (r && r.data && r.data.id) return res.json({ ok: true, sent: true, id: r.data.id });
    return res.json({ ok: false, sent: false, error: 'Gmail 발송 응답이 비어 있어요.' });
  } catch (e) { if (scopeGate(e, res, 'gmail')) return; res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// 📮 Step 2-C+ · 모닝 브리핑(Render Cron 자율) — 회장님 시트 오늘 이벤트 → Gmail 요약
//   Cron이 세션 없이 호출 → 저장된 회장님 refresh_token으로 인증. CRON_SECRET로 보호(무단호출 방지).
// ═══════════════════════════════════════════════════════════════════════════
const morningBrief = require('./morning_brief');
async function adminAuth() {
  const tok = await loadMemberToken(VIP_EMAIL);
  if (!tok || !tok.refresh_token) return null;
  const c = oaClient(); c.setCredentials({ refresh_token: tok.refresh_token });
  return c;
}
app.get('/api/cron/morning-brief', async (req, res) => {
  try {
    if (String(req.query.key || '') !== String(process.env.CRON_SECRET || '__nokey__')) return res.status(403).json({ ok: false, error: 'forbidden' });
    const ma = await adminAuth();
    if (!ma) return res.json({ ok: false, error: '회장님 구글 토큰이 저장돼 있지 않아요(로그인 1회 필요).' });
    const brief = await morningBrief.build((a) => sheetsCrud.loadTable(a), ma);
    const dry = String(req.query.dry || '') === '1';
    if (dry) return res.json({ ok: true, dryRun: true, events: brief.count, preview: brief.text });
    const r = await _sendGmailFor(ma, VIP_EMAIL, '[지니야] 오늘 아침 브리핑', brief.text);
    return res.json({ ok: true, sent: !!(r && r.sent), events: brief.count, detail: { 만기: brief.만기, 생일: brief.생일, 상담: brief.상담 } });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// 🗂️ Step 2-C · 결재함 백엔드 (독립 · 하이브리드 라우터 무접촉)
//   발송헬퍼: 기존 /api/send/sms·/api/gmail/send 로직을 함수로 재사용(핸들러 무수정). sent 확인·가짜성공 없음.
//   결재함은 회원 본인 시트 '결재함' 탭에만(서버 저장 0). 승인 시 명단 재조회→실발송→결과 기록.
// ═══════════════════════════════════════════════════════════════════════════
async function _sendSmsFor(ma, to, text) {
  try {
    to = String(to || '').replace(/[^0-9]/g, ''); text = String(text || '').trim();
    if (!to || !text) return { ok: false, sent: false, error: '번호·내용 없음' };
    const { id, sheets } = await findOrCreateMemberSheet(ma);
    const kv = {};
    try { const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: '지니야_연결!A1:B10' }); (r.data.values || []).forEach((row) => { if (row && row[0]) kv[row[0]] = row[1] || ''; }); } catch (e) {}
    const apiKey = kv['솔라피_API_KEY'], apiSecret = kv['솔라피_SECRET'], from = String(kv['솔라피_발신번호'] || '').replace(/[^0-9]/g, '');
    if (!apiKey || !apiSecret || !from) return { ok: false, sent: false, error: '솔라피 키 미저장' };
    const date = new Date().toISOString(); const salt = crypto.randomBytes(32).toString('hex');
    const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
    const auth = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
    const sr = await fetch('https://api.solapi.com/messages/v4/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify({ message: { to, from, text } }) });
    const out = await sr.json().catch(() => ({}));
    const okSent = sr.ok && out && (String(out.statusCode) === '2000' || out.status === 'SENDING' || out.messageId);
    return okSent ? { ok: true, sent: true, id: out.messageId || out.groupId || null } : { ok: false, sent: false, error: (out && (out.errorMessage || out.statusMessage || out.message)) || '솔라피 오류' };
  } catch (e) { return { ok: false, sent: false, error: e.message }; }
}
async function _sendGmailFor(ma, to, subject, text) {
  try {
    to = String(to || '').trim(); text = String(text || '').trim();
    if (!to || !text) return { ok: false, sent: false, error: '수신·내용 없음' };
    const gmail = google.gmail({ version: 'v1', auth: ma });
    const subjEnc = '=?UTF-8?B?' + Buffer.from(subject || '(제목 없음)', 'utf-8').toString('base64') + '?=';
    const mime = ['To: ' + to, 'Subject: ' + subjEnc, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(text, 'utf-8').toString('base64')].join('\r\n');
    const raw = Buffer.from(mime, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const r = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    return (r && r.data && r.data.id) ? { ok: true, sent: true, id: r.data.id } : { ok: false, sent: false, error: 'Gmail 빈 응답' };
  } catch (e) { return { ok: false, sent: false, error: e.message }; }
}
approval.init({ anthropic: _anthropic, model: MODEL_DEEP, getMemberSheet: findOrCreateMemberSheet, ensureTab, sendSms: _sendSmsFor, sendGmail: _sendGmailFor });

app.post('/api/approval/create', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; res.json(await approval.create(ma, req.body || {})); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
app.get('/api/approval/list', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; res.json(await approval.list(ma, { status: req.query.status })); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
app.post('/api/approval/act', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; res.json(await approval.act(ma, req.body || {})); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
app.post('/api/approval/plan', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; res.json(await approval.plan(ma, (req.body && req.body.text) || '')); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
// 🔒 안전모드 정직 노출(화이트리스트 값은 비공개·on/off만). 결재함 페이지 배너가 이걸 읽어 실고객 발송 여부를 정직 표시.
app.get('/api/approval/mode', (req, res) => res.json({ ok: true, live: String(process.env.APPROVAL_LIVE_SEND || '') === '1' }));

// ═══════════════════════════════════════════════════════════════════════════
// 📱 카카오 알림톡 (Step 5) — 오원트 org 채널(발신프로필)로 정보성 알림 발송
//   ★검증된 HMAC-SHA256 v4 방식 재사용(기존 /api/send/sms와 동일) → 새 의존성 0(solapi SDK 불필요).
//   ★오원트 중앙 채널: 키·발신프로필은 ENV(회장님)에서만. (부트캠프 회원은 각자 채널=추후 별도.)
//   ★관리자 게이트: org 채널 발송은 회장(VIP_EMAIL)만. 남이 org 채널로 못 쏨.
//   ★휴먼인루프: 반드시 웹에서 [승인] 후 send 호출(preview→승인→send). 대량(10건+)은 confirmBulk 명시.
//   ★가짜성공 금지: 솔라피 정상 접수일 때만 sent:true. ★제로 인그레스: 수신자·문구 저장 0, 로그=마스킹 요약만.
//   ★심사 대기: pfId·templateId는 카카오 심사(3~5일, 회장님 수동) 통과 후 ENV 주입 → 그전엔 정직히 '미승인' 에러.
// ═══════════════════════════════════════════════════════════════════════════
const SOLAPI_KEY = process.env.SOLAPI_API_KEY || '';
const SOLAPI_SECRET = process.env.SOLAPI_API_SECRET || '';
const SOLAPI_PFID = process.env.SOLAPI_PFID || '';                                 // 카카오 발신프로필 ID(채널 등록 후 발급)
const SOLAPI_FROM = String(process.env.SOLAPI_FROM || '').replace(/[^0-9]/g, '');   // 발신번호(알림톡 실패 시 SMS 대체발송용)
const SOLAPI_CONFIGURED = !!(SOLAPI_KEY && SOLAPI_SECRET);
// 심사 통과 시 발급되는 templateId를 ENV로 주입(코드명 → 카카오 templateId). 미주입이면 그 템플릿은 '미승인'.
//   ★다목적: 지니야는 1인 사업자(재무설계·필라테스·세무·행정·병의원 등) 공용 비서. 발신자는 #{사업자명} 변수로 유연 대응.
//   ★심사 안전: 전부 순수 정보성(예약·계약·신청 기반). 광고 문구(특가·할인·지금 신청) 금지. 미가입자 광고 금지.
const ALIMTALK_TEMPLATES = {
  template_car_insurance_expiry: { name: '자동차보험 만기 안내', vars: ['사업자명', '고객명', '만기일'],           id: process.env.SOLAPI_TPL_CAR_INSURANCE_EXPIRY || '' },
  template_insurance_expiry:     { name: '보험 만기 안내',       vars: ['사업자명', '고객명', '상품명', '만기일'],   id: process.env.SOLAPI_TPL_INSURANCE_EXPIRY || '' },
  template_renewal_notice:       { name: '갱신 안내',           vars: ['사업자명', '고객명', '항목', '갱신일'],     id: process.env.SOLAPI_TPL_RENEWAL_NOTICE || '' },
  template_birthday:             { name: '생일 축하',           vars: ['사업자명', '고객명'],                     id: process.env.SOLAPI_TPL_BIRTHDAY || '' },
  template_anniversary:          { name: '결혼 기념일 축하',     vars: ['사업자명', '고객명'],                     id: process.env.SOLAPI_TPL_ANNIVERSARY || '' },
  template_meeting_reminder:     { name: '상담·미팅 리마인더',   vars: ['사업자명', '고객명', '일시', '장소'],       id: process.env.SOLAPI_TPL_MEETING_REMINDER || '' },
  template_program_info:         { name: '강의·세미나·수업 안내', vars: ['사업자명', '고객명', '프로그램명', '일정'], id: process.env.SOLAPI_TPL_PROGRAM_INFO || '' },
  template_event_info:           { name: '일정·행사 안내',      vars: ['사업자명', '고객명', '행사명', '일시'],     id: process.env.SOLAPI_TPL_EVENT_INFO || '' },
};
function _maskPhone(p) { const s = String(p || '').replace(/[^0-9]/g, ''); if (s.length < 7) return '***'; return s.slice(0, 3) + '****' + s.slice(-4); }
function _isAdmin(req) { const s = sessionOf(req); return !!(s && String(s.email || '').toLowerCase() === VIP_EMAIL); }
function _solapiAuth() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString('hex');
  const signature = crypto.createHmac('sha256', SOLAPI_SECRET).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${SOLAPI_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}
// 알림톡 1건 메시지 객체 조립(#{변수} → 값). 미설정 값은 정직히 에러(지어내기·조용한 실패 금지).
function _buildAlimtalk(to, tplCode, variables) {
  const tpl = ALIMTALK_TEMPLATES[tplCode];
  if (!tpl) throw new Error('알 수 없는 템플릿 코드: ' + tplCode);
  if (!SOLAPI_PFID) throw new Error('발신프로필(SOLAPI_PFID) 미설정 — 카카오 채널 등록 후 발급값을 Render 환경변수에 넣어주세요.');
  if (!tpl.id) throw new Error(`템플릿 "${tpl.name}" 미승인 — 카카오 심사 통과 후 templateId를 환경변수에 주입하면 켜집니다.`);
  const variableFields = {};
  Object.keys(variables || {}).forEach((k) => { variableFields['#{' + k + '}'] = String(variables[k] == null ? '' : variables[k]); });
  return { to: String(to).replace(/[^0-9]/g, ''), from: SOLAPI_FROM, kakaoOptions: { pfId: SOLAPI_PFID, templateId: tpl.id, variables: variableFields, disableSms: false } };
}
// 솔라피 다건 발송(단건도 배열 1개). ★가짜성공 금지: 실패목록·groupId 그대로 반환.
async function _solapiSendMany(messages) {
  const res = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: _solapiAuth() },
    body: JSON.stringify({ messages }),
  });
  const out = await res.json().catch(() => ({}));
  return { httpOk: res.ok, httpStatus: res.status, out };
}
// 발송 이력(★제로 인그레스: 수신자 마스킹·문구 미저장·메모리 휘발). 최근 200건.
const _alimtalkLog = [];
function _logAlimtalk(entry) { _alimtalkLog.push(entry); if (_alimtalkLog.length > 200) _alimtalkLog.shift(); }

// 📋 템플릿 목록(화면 드롭다운용) — 각 템플릿의 승인여부까지 정직 표시.
app.get('/api/alimtalk/templates', (req, res) => {
  res.json({ ok: true, configured: SOLAPI_CONFIGURED, pfIdReady: !!SOLAPI_PFID,
    templates: Object.keys(ALIMTALK_TEMPLATES).map((code) => ({ code, name: ALIMTALK_TEMPLATES[code].name, vars: ALIMTALK_TEMPLATES[code].vars, approved: !!ALIMTALK_TEMPLATES[code].id })) });
});

// 🔍 미리보기(승인 게이트 1단계) — 발송 안 함. 수신자(마스킹)·건수·변수 확인용.
app.post('/api/alimtalk/preview', (req, res) => {
  try {
    if (!_isAdmin(req)) return res.status(403).json({ ok: false, error: '오원트 채널 알림톡은 관리자(회장님)만 보낼 수 있어요.' });
    const b = req.body || {};
    const code = String(b.template || '');
    const tpl = ALIMTALK_TEMPLATES[code];
    if (!tpl) return res.json({ ok: false, error: '템플릿을 선택해 주세요.' });
    const recipients = Array.isArray(b.recipients) ? b.recipients : (b.to ? [{ to: b.to, variables: b.variables || {} }] : []);
    if (!recipients.length) return res.json({ ok: false, error: '수신자를 1명 이상 넣어주세요.' });
    res.json({ ok: true, preview: {
      템플릿: tpl.name, 승인됨: !!tpl.id, 발신프로필설정: !!SOLAPI_PFID, 건수: recipients.length,
      대량여부: recipients.length >= 10,
      수신자샘플: recipients.slice(0, 5).map((r) => ({ 번호: _maskPhone(r.to), 변수: r.variables || {} })),
      안내: recipients.length >= 10 ? '10건 이상 대량 발송 — 승인 시 confirmBulk:true 필요' : '내용 확인 후 [승인]하면 발송됩니다.',
    } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 📤 발송(승인 게이트 2단계) — 웹 [승인] 후에만 approved:true로 호출. 단건(send_alimtalk)/다건(send_alimtalk_bulk) 공용.
app.post('/api/alimtalk/send', async (req, res) => {
  try {
    if (!_isAdmin(req)) return res.status(403).json({ ok: false, error: '오원트 채널 알림톡은 관리자(회장님)만 보낼 수 있어요.' });
    if (!SOLAPI_CONFIGURED) return res.json({ ok: false, needsKey: true, message: '솔라피 API 키(SOLAPI_API_KEY/SECRET)를 Render 환경변수에 넣어주세요.' });
    const b = req.body || {};
    if (b.approved !== true) return res.json({ ok: false, error: '승인 후에만 발송됩니다(approved:true 필요).' });
    const code = String(b.template || '');
    const recipients = Array.isArray(b.recipients) ? b.recipients : (b.to ? [{ to: b.to, variables: b.variables || {} }] : []);
    if (!recipients.length) return res.json({ ok: false, error: '수신자가 없습니다.' });
    if (recipients.length >= 10 && b.confirmBulk !== true) return res.json({ ok: false, needsBulkConfirm: true, count: recipients.length, message: `${recipients.length}건 대량 발송입니다. confirmBulk:true로 명시 승인해 주세요.` });
    let messages;
    try { messages = recipients.map((r) => _buildAlimtalk(r.to, code, r.variables || {})); }
    catch (e) { return res.json({ ok: false, error: e.message }); }  // 미승인·미설정 정직 안내
    const { httpOk, httpStatus, out } = await _solapiSendMany(messages);
    const failed = (out && Array.isArray(out.failedMessageList)) ? out.failedMessageList.length : 0;
    const okSent = httpOk && !!(out && (out.groupId || out.groupInfo)) && failed < messages.length;
    _logAlimtalk({ template: ALIMTALK_TEMPLATES[code].name, count: messages.length, success: okSent ? (messages.length - failed) : 0, fail: okSent ? failed : messages.length, at: new Date().toISOString().slice(0, 16), by: _maskNm((sessionOf(req) || {}).name || '관리자') });
    if (okSent) return res.json({ ok: true, sent: true, count: messages.length, failed, groupId: (out && (out.groupId || (out.groupInfo && out.groupInfo.groupId))) || null });
    return res.json({ ok: false, sent: false, error: (out && (out.errorMessage || out.statusMessage || out.message)) || ('솔라피 응답 오류(HTTP ' + httpStatus + ')') });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 📜 발송 이력(마스킹 요약·메모리) — 회장님 대시보드용.
app.get('/api/alimtalk/log', (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ ok: false, error: '관리자만 볼 수 있어요.' });
  res.json({ ok: true, list: _alimtalkLog.slice(-50).reverse() });
});

// ── 🧾 보상청구서 초안(F-11) — 보험사 양식 + 증빙(여러 장) → 양식 항목을 증빙 값으로 채운 '작성 초안'.
//    ★보험업법 경계: 손해액 산정·보상 적정성 판단 안 함(서류 정리·기입만). ★휴먼인루프: "제출 전 검토" 명시.
//    ★제로 인그레스: 양식·증빙 base64는 메모리에서만 처리하고 버림(서버 저장 0). ★지어내기 금지: 증빙에 없으면 [확인 필요].
app.post('/api/claim/build', async (req, res) => {
  try {
    const b = req.body || {};
    const form = b.form && b.form.data ? b.form : null;
    const proofs = Array.isArray(b.proofs) ? b.proofs.filter((p) => p && p.data) : [];
    if (!form && !proofs.length) return res.json({ ok: false, error: '양식이나 증빙을 올려주세요.' });
    const content = [];
    const add = (f, label) => {
      const mime = String(f.mime || 'image/jpeg').toLowerCase();
      if (/pdf/.test(mime)) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } });
      else if (/^image\//.test(mime)) { const mt = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime) ? mime : 'image/jpeg'; content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: f.data } }); }
      else return;
      content.push({ type: 'text', text: label });
    };
    if (form) add(form, '— 위는 보험사 보상청구 양식입니다.');
    proofs.forEach((p, i) => add(p, `— 위는 고객 증빙 ${i + 1}입니다(진단서·영수증 등).`));
    if (!content.some((c) => c.type === 'document' || c.type === 'image')) return res.json({ ok: false, error: '파일을 읽지 못했어요(이미지·PDF로 올려주세요).' });
    content.push({ type: 'text', text: [
      '위 보험사 양식의 각 항목을, 증빙에서 읽은 정보로 채운 "보상청구서 작성 초안"을 만들어 주세요.',
      '규칙: (1) 양식에 있는 항목명을 그대로 쓰고 그 값을 증빙에서 찾아 "항목: 값" 형식으로 채운다.',
      '(2) 증빙에 없거나 불명확한 항목은 값 대신 "[확인 필요]"로 표시한다(절대 지어내지 말 것).',
      '(3) 손해액 산정·보상 적정성 판단은 하지 않는다(서류 정리·기입만).',
      '(4) 표/목록으로 읽기 쉽게. 마지막 줄에 "※ 제출 전 반드시 설계사·고객이 검토하세요"를 붙인다.',
    ].join('\n') });
    const r = await _anthropic.messages.create({ model: WS_CHAT_MODEL, max_tokens: 2500, messages: [{ role: 'user', content }] });
    const txt = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
    return res.json({ ok: true, draft: txt || '초안을 생성하지 못했어요. 다시 시도해 주세요.' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 미연결 능력(대기) 상태 ──
// 🩺 Firestore 토큰 영속 자가진단 — 더미 값을 저장→복원→삭제. ★대표님 세션 불필요, 내가 직접 검증.
//   토큰 실값 0노출(더미만). TOKEN_ENC_KEY 설정+Firestore 왕복이 실제 되는지 확인.
app.get('/api/diag/persist', async (req, res) => {
  // ★쿠키 영속 방식 검증 — 서버 저장 0·SA/Firestore 불필요. TOKEN_ENC_KEY 암호화 왕복만 확인.
  const out = { 방식: '암호화 쿠키(genya_rt) — 서버저장0·재시작생존', TOKEN_ENC_KEY_설정: !!process.env.TOKEN_ENC_KEY, 키형식정상: !!_encKey() };
  if (!out.키형식정상) { out.진단 = out.TOKEN_ENC_KEY_설정 ? '⚠️ 키 형식 오류(32B hex64/base64)' : '⚠️ TOKEN_ENC_KEY 미설정'; return res.json(out); }
  try {
    const dummy = JSON.stringify({ rt: '1//dummy-' + crypto.randomBytes(8).toString('hex'), scope: 'calendar.readonly spreadsheets', email: 'test@genya.local' });
    const enc = _enc(dummy);
    const dec = _dec(enc);
    out.암호화됨 = !!enc && enc !== dummy;
    out.복호화_일치 = dec === dummy;
    out.암호문_평문노출없음 = enc.indexOf('dummy') === -1;
    out.진단 = (out.복호화_일치 && out.암호문_평문노출없음) ? '✅ 쿠키 영속 실작동 — 재로그인 1회 후 15분 슬립·재배포 생존' : '⚠️ 암호화 왕복 실패';
    res.json(out);
  } catch (e) { out.에러 = e.message; out.진단 = '❌ 암호화 실패'; res.json(out); }
});
// 🩺 Task A: durable(Firestore) 커넥터 복원 계층 자가진단 — 더미 이메일로 저장→복원 왕복(토큰 실값 0노출).
//   이 계층이 실작동해야 재로그인·타기기·재배포·쿠키유실에도 [구글 연결]이 자동 유지된다. 세션 불필요·내가 직접 검증.
app.get('/api/diag/token-store', async (req, res) => {
  const out = { 계층: 'durable(Firestore genya_member_tokens) · 이메일키 refresh_token 영속', TOKEN_ENC_KEY: !!_encKey(), SA설정: !!(KEY_FILE && KEY_FILE !== '{}') };
  if (!out.TOKEN_ENC_KEY || !out.SA설정) { out.진단 = '⚠️ TOKEN_ENC_KEY 또는 GOOGLE_SA_JSON 미설정 — durable 계층 비활성(쿠키 계층만 동작)'; return res.json(out); }
  const email = 'diag-taska@genya.local';
  const rt = '1//diag-' + crypto.randomBytes(8).toString('hex');
  try {
    await saveMemberToken(email, rt, 'openid email calendar.readonly spreadsheets drive.readonly drive.file');
    const loaded = await loadMemberToken(email);
    out.저장 = true;
    out.복원 = !!(loaded && loaded.refresh_token);
    out.일치 = !!(loaded && loaded.refresh_token === rt);
    out.스코프복원 = !!(loaded && /spreadsheets/.test(loaded.scope || ''));
    out.진단 = (out.일치 && out.스코프복원) ? '✅ durable 복원 실작동 — 재로그인·타기기·재배포에도 커넥터 자동 유지(더미문서 1건 잔존·무해)' : '⚠️ 왕복 불일치';
    res.json(out);
  } catch (e) { out.에러 = e.message; out.진단 = '❌ Firestore 왕복 실패'; res.json(out); }
});
app.get('/api/status', (req, res) => {
  // ★실제 상태를 정직 반영(런타임 확인 가능한 것 위주)
  res.json({
    ok: true,
    abilities: {
      yakgwan: 'active(약관RAG)',
      openai: process.env.OPENAI_API_KEY ? 'active' : 'no-key',
      googleOAuth: OA_CONFIGURED ? 'active' : 'no-key',
      kakaoLogin: KA_CONFIGURED ? 'active' : 'no-key',
      calendar: '회원 구글 연결 시 active', sheets: '회원 구글 연결 시 active', drive: '회원 구글 연결 시 active',
      skills: 'active(PDF·엑셀·PPT·문서 생성)',
      gmail: '인증 대기', solapi: '회원 키 저장 시', leads: '준비 중(서버 브라우저 미설치)', listening: '준비 중(검색API)',
    },
  });
});
// ── 💰 비용 대시보드(Step 2-1): 오늘 지니야 모델 사용량·원화 추정 (관리자만) ──
app.get('/api/usage', (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ ok: false, error: '관리자만 볼 수 있어요.' });
  const d = _kstDate();
  const today = _usage.date === d ? _usage : { date: d, krw: 0, calls: 0, byModel: {} };
  res.json({ ok: true, date: today.date, krw: Math.round(today.krw || 0), calls: today.calls || 0,
    byModel: Object.fromEntries(Object.entries(today.byModel || {}).map(([k, v]) => [k, Math.round(v)])),
    limitKrw: DAILY_COST_THRESHOLD_KRW, over: (today.krw || 0) > DAILY_COST_THRESHOLD_KRW });
});

// ── 🔑 OAuth 로그인 라우트 ──
function loginPage(body) { return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Pretendard,'맑은 고딕',sans-serif;max-width:520px;margin:60px auto;padding:0 18px;color:#1a1f28;text-align:center;">${body}</body>`; }
app.get('/login', (req, res) => {
  const s = sessionOf(req);
  if (s) return res.redirect('/');
  const warnG = OA_CONFIGURED ? '' : '<div style="background:#FBF0DC;color:#8a4d18;padding:10px;border-radius:10px;margin-bottom:10px;font-size:13px;">⚠️ 구글 OAuth 미설정</div>';
  const warnK = KA_CONFIGURED ? '' : '<div style="background:#FBF0DC;color:#8a4d18;padding:10px;border-radius:10px;margin-bottom:10px;font-size:13px;">⚠️ 카카오 미설정 — KAKAO_REST_KEY 필요(대표님 카카오 개발자센터)</div>';
  res.send(loginPage(`${warnG}${warnK}<h1 style="color:#0B1F3A;">지니야빌더</h1><p style="color:#6b7a8d">주문제작 AI 비서 · 내 데이터는 내 것만</p>
    <div style="margin-top:22px;display:flex;flex-direction:column;gap:11px;align-items:center;">
      <a href="/auth/google" style="display:inline-flex;gap:10px;align-items:center;justify-content:center;width:260px;background:#fff;border:1px solid #dadce0;border-radius:10px;padding:13px 20px;color:#3c4043;text-decoration:none;font-size:15px;">🟦 Google로 시작하기</a>
      <a href="/auth/kakao" style="display:inline-flex;gap:10px;align-items:center;justify-content:center;width:260px;background:#FEE500;border:none;border-radius:10px;padding:13px 20px;color:#3a2a00;text-decoration:none;font-size:15px;font-weight:600;">💬 카카오로 시작하기</a>
    </div>
    <p style="color:#98a4b2;font-size:12px;margin-top:16px;line-height:1.6;">카카오는 로그인(신원)까지 — 캘린더·시트·드라이브 등 <b>내 데이터 기능은 [구글 연결]이 필요</b>합니다.</p>
    <p style="margin-top:18px;font-size:12px;"><a href="/privacy" style="color:#98a4b2;">개인정보처리방침</a> · <a href="/terms" style="color:#98a4b2;">이용약관</a></p>`));
});
// ── 📄 개인정보처리방침 · 서비스 이용약관(구글 앱 인증용) — 정적 페이지 ──
app.get(['/privacy', '/privacy.html', '/개인정보처리방침'], (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/crud-test', (req, res) => res.sendFile(path.join(__dirname, 'crud_test.html'))); // 🗂️ Step 2-B 로컬 실측 콘솔(로컬 전용)
app.get('/approval-test', (req, res) => res.sendFile(path.join(__dirname, 'approval_test.html'))); // 🗂️ Step 2-C 결재함 로컬 실측 콘솔
app.get('/approval', (req, res) => res.sendFile(path.join(__dirname, 'approval.html'))); // 🗂️ Step 2-C 결재함 정식 페이지(Task B · genya.html 무접촉 독립 · ASCII 정식주소)
// 🗂️ 한글 주소 /결재함: 이 Express 버전은 유니코드 리터럴 라우트를 매칭 못 함(기존 /이용약관·/개인정보처리방침도 동일 404) → path-to-regexp 우회, 디코드 후 직접 매핑. /결재함만 가로채고 나머진 통과.
app.use((req, res, next) => { let p; try { p = decodeURIComponent(req.path); } catch (e) { p = req.path; } if (p === '/결재함') return res.sendFile(path.join(__dirname, 'approval.html')); next(); });
app.get(['/terms', '/terms.html', '/이용약관'], (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));

app.get('/auth/google', (req, res) => {
  if (!OA_CONFIGURED) return res.status(503).send('OAuth 미설정');
  // ★2026-07-16 무한반복 수정: 예전엔 로그인이 LOGIN_SCOPES(3개)만 요청 → 재로그인마다
  //   기존 캘린더·시트 연결 스코프를 덮어써 사라졌다. 대표님이 6번 헤맨 직접 원인.
  //   → include_granted_scopes=true: 이미 동의한 스코프를 유지하며 반환. + offline로 refresh_token.
  res.redirect(oaClient().generateAuthUrl({ prompt: 'select_account', scope: LOGIN_SCOPES, access_type: 'offline', include_granted_scopes: true }));
});
// ★데이터 연결(캘린더·시트·드라이브) — 그 기능 실제로 쓸 때만 별도 동의(incremental). 여기서만 민감 스코프 요청.
// ★작업A2: 도구별 최소권한 스코프(incremental 누적). scope 파라미터 없으면 기존 일괄(하위호환)
const CONNECT_SCOPES = {
  calendar: ['https://www.googleapis.com/auth/calendar.readonly'],
  sheets: ['https://www.googleapis.com/auth/spreadsheets'],
  drive: ['https://www.googleapis.com/auth/drive.file'],
  gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.send'],
};
app.get('/auth/google/connect', (req, res) => {
  if (!OA_CONFIGURED) return res.status(503).send('OAuth 미설정');
  const returnTo = String(req.query.returnTo || '5');
  const tool = String(req.query.scope || '');
  const scopes = (tool && CONNECT_SCOPES[tool]) ? LOGIN_SCOPES.concat(CONNECT_SCOPES[tool]) : LOGIN_SCOPES.concat(DATA_SCOPES);
  const state = Buffer.from(JSON.stringify({ connect: true, returnTo: returnTo })).toString('base64');
  console.log('[OAUTH connect] tool =', tool || '(all)', '| redirect_uri =', OA_REDIRECT, '| isLocalDev =', _isLocalDev, '| PORT =', process.env.PORT || '(none)');
  res.redirect(oaClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', include_granted_scopes: true, scope: scopes, state: state }));
});
app.get('/auth/google/callback', async (req, res) => {
  try {
    const code = req.query.code; if (!code) return res.status(400).send('code 없음');
    // ★connect(데이터 스코프)일 때만 state 해석. 로그인(openid/email/profile)은 기존대로.
    let isConnect = false, returnTo = '10';
    if (req.query.state) {
      try { const o = JSON.parse(Buffer.from(String(req.query.state), 'base64').toString()); if (o && o.connect) { isConnect = true; returnTo = o.returnTo || '10'; } }
      catch (e) { if (req.query.state === 'connect') isConnect = true; } // 구버전 호환
    }
    const c = oaClient(); const { tokens } = await c.getToken(code); c.setCredentials(tokens);
    const ui = await google.oauth2({ version: 'v2', auth: c }).userinfo.get();
    const s = crypto.randomBytes(16).toString('hex');
    // ★로그인이 기존 연결을 지우지 않게: refresh_token은 이번에 없으면(로그인은 재동의 안 함)
    //   기존 세션 것을 유지. scope도 이번 것이 더 좁으면(로그인=3개) 기존 것을 유지.
    //   include_granted_scopes=true라 정상적으론 넓게 오지만, 안전하게 넓은 쪽을 택한다.
    const _old = sessionOf(req);
    const tok = Object.assign({}, tokens);
    // ★Task A 재로그인 커넥터 유지 — 3중 복원: ①메모리/쿠키 세션(_old) ②이메일 기반 durable(Firestore).
    //   로그인은 rt를 재발급하지 않으므로, 한 번이라도 [구글 연결]한 이메일이면 어느 기기·재배포·쿠키유실이어도 자동 복원.
    if (!tok.refresh_token && _old && _old.tokens && _old.tokens.refresh_token) tok.refresh_token = _old.tokens.refresh_token;
    let _durScope = '';
    if (!tok.refresh_token && ui.data.email) {
      try { const _dur = await loadMemberToken(ui.data.email); if (_dur && _dur.refresh_token) { tok.refresh_token = _dur.refresh_token; _durScope = _dur.scope || ''; } } catch (e) {}
    }
    const newScope = tokens.scope || '';
    const oldScope = (_old && _old.scope) || '';
    // 가장 넓은 스코프 채택(로그인=좁음 / 기존연결=넓음 / durable=과거연결 넓음)
    const scope = [newScope, oldScope, _durScope].filter(Boolean).sort((a, b) => b.split(' ').length - a.split(' ').length)[0] || newScope;
    sessions.set(s, { email: ui.data.email, name: ui.data.name, tokens: tok, scope, provider: 'google' });
    // ★durable 저장: 구글이 이번에 실제로 rt를 발급했을 때만(=연결 동의) 이메일 키로 Firestore 영속 → 이후 어떤 로그인이든 커넥터 자동 복원.
    //   preserved rt(=tokens.refresh_token 없음)일 땐 저장 생략 → 중복 문서 누적 방지. 베스트에포트(실패해도 로그인 안 끊김).
    if (tokens.refresh_token && ui.data.email) { try { await saveMemberToken(ui.data.email, tokens.refresh_token, scope); } catch (e) { console.warn('saveMemberToken 실패(무시):', e.message); } }
    const _sec = process.env.RENDER ? '; Secure' : '';
    const cookies = [`genya_sid=${s}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000${_sec}`]; // ★영속(1년): 세션쿠키였으면 브라우저 닫을때 소멸→uid유실("치매") → Max-Age로 영속화
    // ★refresh_token(+scope,email)을 암호화해 사용자 쿠키에. 서버 저장 0·재시작 생존.
    //   ★다운로드함 버그 수정: 예전엔 refresh_token 있을 때만 genya_rt 저장 → 재로그인(구글이 rt 안 줌)은 미저장 →
    //     재배포로 sessions Map 비면 복원 불가 → mem "로그인 필요". 이제 email 있으면 항상 저장(rt는 있으면 함께).
    //     mem은 구글토큰 불필요·email(uid)만 필요하므로, email만 복원돼도 다운로드함이 산다.
    if (ui.data.email) {
      try {
        const _payload = { email: (ui.data.email || '').toLowerCase(), scope };
        if (tok.refresh_token) _payload.rt = tok.refresh_token;
        const enc = _enc(JSON.stringify(_payload));
        if (enc) cookies.push(`genya_rt=${encodeURIComponent(enc)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000${_sec}`);
      } catch (e) {}
    }
    res.setHeader('Set-Cookie', cookies);
    res.redirect(isConnect ? ('/?connected=1&screen=' + encodeURIComponent(returnTo)) : '/'); // 데이터 연결이면 원래 화면으로 복귀
  } catch (e) { res.status(500).send('로그인 오류: ' + e.message); }
});
app.get('/logout', (req, res) => { const s = sidOf(req); if (s) sessions.delete(s); res.setHeader('Set-Cookie', 'genya_sid=; Path=/; Max-Age=0'); res.redirect('/login'); });
app.get('/me', (req, res) => { const s = sessionOf(req); res.json(s ? { ok: true, email: s.email, name: s.name, provider: s.provider, hasGoogleData: !!s.tokens, hasData: hasDataScope(req), scopes: (s.scope || (s.tokens && s.tokens.scope) || '') } : { ok: false }); });

// 🔌 커넥터 실측 연결상태 — ★"토큰 있으니 연결됨"(거짓말) 금지. 실제 API 1회 호출 200 = 연결됨.
//   지니야가 "연결됨"이라 표시했는데 실제론 안 됐던 사고의 근본 수정. "될 것 같다"가 아니라 "됐다".
//   화면(refreshConnState)이 이걸 읽어 배지를 켠다. 스코프 문자열이 아니라 진짜 호출 결과.
app.get('/api/conn/status', async (req, res) => {
  const ma = memberAuth(req);
  const out = { calendar: false, sheets: false, drive: false, gmail: false };
  if (!ma) return res.json({ ok: true, loggedIn: !!sessionOf(req), ...out });
  const probes = {
    calendar: () => google.calendar({ version: 'v3', auth: ma }).calendarList.list({ maxResults: 1 }),
    drive:    () => google.drive({ version: 'v3', auth: ma }).files.list({ pageSize: 1, fields: 'files(id)' }),
    sheets:   () => google.drive({ version: 'v3', auth: ma }).files.list({ pageSize: 1, q: "mimeType='application/vnd.google-apps.spreadsheet'", fields: 'files(id)' }),
    gmail:    () => google.gmail({ version: 'v1', auth: ma }).users.getProfile({ userId: 'me' }),
  };
  // 각 커넥터를 실제로 1회 호출. 200이면 진짜 연결. 401/403(스코프 없음)이면 미연결.
  await Promise.all(Object.keys(probes).map(async (k) => { try { await probes[k](); out[k] = true; } catch (e) { out[k] = false; } }));
  res.json({ ok: true, loggedIn: true, ...out });
});

// ── 💬 카카오 로그인 라우트 (구글과 동일 구조: authorize → callback) ──
app.get('/auth/kakao', (req, res) => {
  if (!KA_CONFIGURED) return res.status(503).send('카카오 미설정 — KAKAO_REST_KEY 필요');
  const url = `https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(KA_KEY)}&redirect_uri=${encodeURIComponent(KA_REDIRECT)}&scope=account_email,profile_nickname`;
  res.redirect(url);
});
app.get('/auth/kakao/callback', async (req, res) => {
  try {
    const code = req.query.code; if (!code) return res.status(400).send('code 없음');
    // 1) 토큰 교환 (form-urlencoded)
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: KA_KEY, redirect_uri: KA_REDIRECT, code });
    const tr = await fetch('https://kauth.kakao.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const tok = await tr.json();
    if (!tok.access_token) return res.status(500).send('카카오 토큰 실패: ' + JSON.stringify(tok));
    // 2) 사용자 정보(신원)
    const ur = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: 'Bearer ' + tok.access_token } });
    const u = await ur.json();
    const email = (u.kakao_account && u.kakao_account.email) || `kakao_${u.id}`;
    const name = (u.properties && u.properties.nickname) || '카카오 회원';
    // 3) 세션 (★구글 토큰 없음 → 데이터 기능은 구글 연결 필요). 토큰만 메모리·회원 격리·저장0
    const s = crypto.randomBytes(16).toString('hex');
    sessions.set(s, { email, name, provider: 'kakao' }); // s.tokens(구글) 없음
    res.setHeader('Set-Cookie', `genya_sid=${s}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000${process.env.RENDER ? '; Secure' : ''}`); // ★영속(1년)
    res.redirect('/');
  } catch (e) { res.status(500).send('카카오 로그인 오류: ' + e.message); }
});

// 화면(no-store) — ★로그인 게이트: 미로그인 시 /login
// /main = 홈 대시보드(코치 디자인·실데이터 배선), /work = 작업공간(3대 창고·능력·대화)
app.get('/main', (req, res) => {
  if (!sessionOf(req)) return res.redirect('/login');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.redirect('/'); // ★옛날 홈 축소판 제거 → v4(genya.html)로 통일
});
app.get('/work', (req, res) => {
  if (!sessionOf(req)) return res.redirect('/login');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.redirect('/'); // ★옛날 작업공간 축소판 제거 → v4(genya.html)로 통일
});
// ★기본 URL / → v4 통합 페이지(genya.html). 로그인 화면0부터. "Not Found" 없음.
// ★기본 URL / → v4 통합 페이지(genya.html) + OG 태그 주입(카톡 썸네일). genya.html 파일은 무수정, 서버가 <head>에 끼워 서빙.
// ★카톡 인앱 브라우저 탈출: 카톡으로 링크를 열면 구글 로그인이 403(disallowed_useragent)로 막힘.
//   → 페이지 뜨자마자(다른 JS·로그인 로직보다 먼저) 카톡 브라우저를 감지해 안드=크롬, iOS=사파리로 다시 연다.
//   OG 태그와 동일하게 genya.html은 무수정, 서버가 <head> 최상단에 끼워 서빙.
const KAKAO_ESCAPE = `<script>
(function(){
  var ua = navigator.userAgent || '';
  if (!/KAKAOTALK/i.test(ua)) return;
  // ★무한 리로드(깜빡임) 방지: iOS15+에서 openExternalBrowser 탈출이 실패하면 파라미터가 계속 붙으며 리로드 루프->화면 깜빡임.
  //   이미 한 번 시도했으면(세션 플래그 또는 URL 파라미터) 재시도 안 함 -> 최대 1회만 탈출 시도.
  var tried = false;
  try { tried = !!sessionStorage.getItem('_kkoEsc'); } catch(e){}
  if (tried || location.href.indexOf('openExternalBrowser=1') > -1) return;
  try { sessionStorage.setItem('_kkoEsc', '1'); } catch(e){}
  if (/Android/i.test(ua)) {
    location.href = 'intent://' + location.href.replace(/https?:\\/\\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    location.href = location.href + (location.href.indexOf('?') > -1 ? '&' : '?') + 'openExternalBrowser=1';
  }
})();
</script>`;
const OG_TAGS = [
  '<meta property="og:type" content="website">',
  '<meta property="og:url" content="https://genya-builder.onrender.com">',
  '<meta property="og:title" content="당신의 사업을 더 걱정하는 1인사업자를 위한 AI 비서">',
  '<meta property="og:description" content="사람이 해야 하는 일을 제외한 나머지 모든 일은 AI가 합니다 · 오상열 CFP 오원트금융연구소">',
  '<meta property="og:image" content="https://firebasestorage.googleapis.com/v0/b/moneya-72fe6.firebasestorage.app/o/%EC%A7%80%EB%8B%88%EC%95%BC%EB%B9%8C%EB%8D%94_%EC%B9%B4%ED%86%A1_OG_final.png?alt=media&token=1df332a4-56ee-46c0-b174-a3453d98324e">',
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta name="twitter:card" content="summary_large_image">'
].join('\n');
app.get('/', (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'genya.html'), 'utf8');
  // ★인증 게이트: 서버가 실제 세션 여부를 권위있게 주입(클라 라우팅 레이스 제거). 로그인 안 됐으면 클라가 로그인화면만 보이게 강제.
  const authed = !!sessionOf(req);
  html = html.replace('<head>', '<head>\n' + KAKAO_ESCAPE + '\n<script>window.__AUTHED=' + (authed ? 'true' : 'false') + ';</script>'); // ★카톡 탈출 + 인증상태 주입(<head> 최상단, 다른 JS보다 먼저)
  html = html.replace('</head>', OG_TAGS + '\n</head>');
  res.setHeader('Cache-Control', 'no-store');
  res.send(html);
});

app.listen(PORT, () => console.log(`[공통 메인+로그인] http://localhost:${PORT}/login (OAuth ${OA_CONFIGURED ? 'ON' : 'OFF'}, 약관 ${YAK.pageCount}p) — 회원토큰 우선·SA 폴백`));
