// ─────────────────────────────────────────────────────────────
// roster_gate.js — 🛡️ 2층 안전망 (B안 · 2026-07-31 대표님 승인)
//
// 무엇을·왜:
//   지금까지 "이 말이 명단 질문인가"를 ★낱말표(정규식)로 골랐다. 그래서
//   "생년월일 8월인 사람" ✔ / "생일이 8월인 사람" ✘ 처럼 ★같은 뜻인데 낱말 하나로 갈렸다.
//   탈락하면 도구도 명단도 없는 일반 대화로 떨어져, 두뇌가 아무리 똑똑해도 할 수 있는 게 없었다.
//
// ★설계 원칙 (B안 = 덧대기):
//   - 관문(라우터의 기존 분기 조건)은 ★한 줄도 안 건드린다. 22블록 심장부 무접촉.
//   - 이 안전망은 ★이미 모든 분기에서 탈락한 말만 받는다 → 최악이어도 "지금과 같음"(바닥이 안 뚫린다).
//   - 판정은 낱말이 아니라 ★뜻으로 한다(LLM). 대표님 성배: "속도는 느릴지언정 똑똑함은 양보 못 한다."
//   - 판정 재료는 ★실제 시트의 칸 목록이다(하드코딩 아님) → 시트가 바뀌면 판정도 저절로 따라간다.
//   - 실패하면 조용히 false → 기존 일반 대화 그대로(안전망이 사고를 만들지 않는다).
//
// 사용(main_server):
//   const rosterGate = require('./roster_gate');
//   rosterGate.init({ anthropic, model, sheetsCrud });
//   } else if (await rosterGate.wants(q, { canSheet })) { out = await rosterGate.answer(q, {...}); }
// ─────────────────────────────────────────────────────────────
'use strict';
const _policy = require('./policy_text_skill');   // 📄 증권 텍스트 해석(독립 모듈)

let _anthropic = null;
let _MODEL = 'claude-sonnet-5';   // 판정은 짧고 빨라야 한다(YES/NO 한 낱말)
let _crud = null;
let _stats = { judged: 0, yes: 0, no: 0, err: 0, policy: 0 };
let _memo = { q: '', v: false, intent: 'none', name: '', at: 0 };   // 같은 요청에서 두 번 판정 안 하게(안전망이 두 자리)

function init(opts) {
  opts = opts || {};
  if (opts.anthropic) _anthropic = opts.anthropic;
  if (opts.model) _MODEL = opts.model;
  if (opts.sheetsCrud) _crud = opts.sheetsCrud;
  // 📄 증권 텍스트 해석(1단계)도 이 통로를 쓴다 — 라우터에 새 줄을 더 넣지 않기 위해 여기서 함께 준비한다.
  try { _policy.init({ anthropic: _anthropic, sheetsCrud: _crud }); } catch (e) {}
}
function stats() { return { ..._stats }; }

/** 판정에 쓰는 지시문. 칸 목록은 실제 시트에서 온다(없으면 칸 얘기 없이 판정). */
function judgePrompt(칸안내) {
  return `너는 분류기다. 보험설계사(대표)가 비서에게 한 말이 ★고객 명단(스프레드시트)을 조회하는 요청인지만 판정한다.
${칸안내 || ''}
[YES = 명단 조회]
· 조건으로 사람을 고르거나 세는 말. 예: "생일이 8월인 사람", "8월에 태어난 고객", "8월생 있어?", "태어난 달이 8월인 분",
  "서울 여자 고객", "서울 사는 여성분", "돈 많이 버는 고객", "연소득 높은 사람", "나이 많은 분", "40대", "몇 살들이야",
  "자동차보험 든 여성", "삼성화재 고객 몇 명", "만기 얼마 안 남은 사람", "우리 고객 몇 명이야", "무사고인 분들"
· 특정 고객의 값을 묻는 말. 예: "김철수 연락처", "이영희 만기 언제야"
· ★낱말이 달라도 뜻이 위와 같으면 YES 다. 대표는 자연스럽게 말한다.

[NO = 명단 조회가 아님]
· 인사·잡담. 예: "안녕", "고마워", "오늘 뭐 하지"
· 지식·상담 질문. 예: "보험이 뭐야", "자동차보험 추천해줘", "연금은 언제 받는 게 좋아", "요즘 금리 어때"
· 일정·캘린더. 예: "오늘 일정 뭐야", "내일 3시 미팅 잡아"
· 발송·결재. 예: "문자 보내줘", "결재함에 올려", "안내문 발송"
· 발굴·홍보·문서. 예: "발굴 돌려", "제안서 만들어줘", "인스타 글 써줘"
· 화면 조작. 예: "다음", "닫아", "새로고침"
· 업로드한 파일 얘기. 예: "이 파일 분석해줘"

★중요: 명단 칸과 같은 낱말이 들어 있어도 ★지식을 묻는 말이면 NO 다.
  예) "자동차보험 든 여성 알려줘" = YES(명단) · "자동차보험 뭐가 좋아?" = NO(지식)
★대표가 "우리 고객" 중에서 누군가를 지목·선별하려는 뜻이면 표현이 아무리 달라도 YES 다.
★정말로 어느 쪽인지 판단이 서지 않을 때만 NO 로 둔다.

[따로 보는 것 — policy_text]
말 안에 ★보험 증권(보험계약)의 내용이 실제로 들어 있으면 policy_text=true 로 표시한다.
· 보험사·상품명·증권번호·보장(담보)·가입금액·보험료·계약일/만기일 같은 것이 ★실제 값과 함께 적혀 있으면 증권이다.
· 표든 줄글이든 항목 나열이든 형식은 상관없다. 길이도 상관없다.
· "김철수 증권이야" 처럼 이름을 함께 말했으면 customer_name 에 그 이름을 적는다.
· ★증권 얘기를 말로만 하는 것은 false 다. 예) "증권 분석 되나요?", "증권 올리면 돼?" → false
· 증권이면 roster_query 는 false 로 둔다(둘은 다른 일이다).

판정 결과는 반드시 judge 도구로 넘겨라.`;
}

// ★판정을 ★도구로 받는다(2026-07-31 실측 교훈):
//   글자로 "YES/NO만 답해라"라고 시켰더니 모델이 설명을 쓰다가 잘려 ★빈 답이 왔고,
//   빈 답 = 판정 실패 = 전부 NO 로 떨어졌다. 도구로 받으면 어떤 말투로 생각하든 결과는 항상 참/거짓이다.
const JUDGE_TOOL = {
  name: 'judge',
  description: '방금 들은 말이 무엇을 시키는 말인지 판정한 결과를 넘긴다.',
  input_schema: {
    type: 'object',
    properties: {
      roster_query: { type: 'boolean', description: '고객 명단에서 사람을 찾거나·세거나·조건으로 거르거나·특정 고객 값을 확인하려는 요청이면 true' },
      policy_text: { type: 'boolean', description: '★말 안에 보험 증권(보험증권·보험계약)의 내용이 실제로 들어 있으면 true. 증권을 읽어달라고 붙여넣은 경우다. 증권 얘기를 "말로만" 하는 것(예: "증권 분석 되나요?")은 false' },
      customer_name: { type: 'string', description: '증권이면, 말에서 드러난 고객 이름(예: "김철수 증권이야" → 김철수). 없으면 빈칸' },
      why: { type: 'string', description: '그렇게 본 이유 한 문장(짧게)' },
    },
    required: ['roster_query'],
  },
};

/**
 * 판정 결과에 ★안전장치를 건다 (판정을 새로 하든, 기억을 쓰든 ★매번 똑같이 건다).
 *  - 증권 텍스트: 언제나 통과(다른 일이라 기존 분기가 대신 처리해 주지 못한다).
 *  - 명단 조회: 도구 의도(발송·결재·시트수정)나 만기 질문이면 ★기존 길에 양보한다.
 */
function _게이트통과(intent, opts, 말) {
  opts = opts || {};
  if (intent === 'policy') return true;
  if (intent !== 'roster') return false;
  if (opts.toolIntent) { console.log(`[🛡️2층안전망] q="${String(말).slice(0, 24)}" → 도구 의도라 기존 길로 넘김`); return false; }
  if (opts.expiryWord) { console.log(`[🛡️2층안전망] q="${String(말).slice(0, 24)}" → 만기 질문이라 기존 길로 넘김`); return false; }
  return true;
}

/** 📄 증권 텍스트일 때만 true — 라우터 ★맨 앞자리에서 쓴다(카드·명단 분기보다 먼저). */
function looksLikePolicyText(q) {
  const s = String(q || '');
  if (s.trim().length < 40) return false;                                  // 짧은 말은 증권일 수 없다(비용 낭비 방지)
  if (/(결재|발송|알림톡|승인|보내줘|보내 주세요)/.test(s)) return false;   // ★발송·결재가 섞인 말은 기존 길 우선(안전)
  return /(보험|증권|담보|보장|가입금액|특약|피보험자|계약자|policy|insur)/i.test(s);
}
async function wantsPolicy(q, opts) {
  if (!looksLikePolicyText(q)) return false;   // ★여기서 걸러진 말은 판정 자체를 안 한다 = 라우터 맨 앞이어도 부담 0
  const v = await wants(q, Object.assign({ canSheet: true }, opts || {}));
  return v === true && _memo.intent === 'policy';
}

/**
 * 이 말이 명단 조회인가 — ★뜻으로 판정(LLM).
 * @returns {Promise<boolean>} 확실할 때만 true. 실패·애매하면 false(=기존 동작 그대로).
 */
async function wants(q, opts) {
  opts = opts || {};
  const 말 = String(q || '').trim();
  if (!말 || 말.length < 2) return false;
  if (opts.canSheet === false) return false;        // 시트를 볼 권한이 없으면 안전망도 무의미
  if (!_anthropic) return false;                    // 엔진 없으면 조용히 지나간다

  // 같은 말을 한 요청 안에서 두 번 판정하지 않게(안전망이 세 자리에 있다) — 10초 메모.
  //   ★기억을 쓸 때도 안전장치(도구 의도·만기)는 ★매번 다시 건다. 안 그러면 기억이 안전장치를 건너뛴다.
  if (_memo.q === 말 && (Date.now() - _memo.at) < 10000) return _게이트통과(_memo.intent, opts, 말);

  let 칸안내 = '';
  try { if (_crud && typeof _crud.schemaHint === 'function') 칸안내 = _crud.schemaHint(); } catch (e) {}

  try {
    _stats.judged++;
    const r = await _anthropic.messages.create({
      // ★temperature 는 최신 모델에서 폐기됐다(붙이면 400) — 넣지 않는다.
      // ★max_tokens 를 넉넉히 준다. 짧게 주면 모델이 생각을 적다가 잘려 ★빈 답이 온다(실측).
      model: _MODEL, max_tokens: 700,
      system: judgePrompt(칸안내),
      messages: [{ role: 'user', content: 말 }],
      tools: [JUDGE_TOOL],
      tool_choice: { type: 'tool', name: 'judge' },   // ★반드시 판정을 내놓게 강제
    });
    const tu = (r.content || []).find((b) => b.type === 'tool_use' && b.name === 'judge');
    let intent = 'none', 이름 = '', 이유 = '';
    if (tu && tu.input && typeof tu.input.roster_query === 'boolean') {
      이유 = String(tu.input.why || '');
      // 📄 증권 텍스트면 명단 조회보다 우선한다(다른 일이다). "만기" 낱말이 증권 안에 있어도 여기서 받는다.
      if (tu.input.policy_text === true) { intent = 'policy'; 이름 = String(tu.input.customer_name || '').trim(); }
      else if (tu.input.roster_query === true) intent = 'roster';
    } else {
      // 도구가 안 왔으면(모델·버전 차이) 글자에서라도 읽는다. 그것도 없으면 ★판정 실패로 본다(조용한 NO 금지).
      const 답 = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim().toUpperCase();
      if (/\bYES\b/.test(답)) intent = 'roster';
      else if (!/\bNO\b/.test(답)) { _stats.err++; console.log(`[🛡️2층안전망] 판정 못 읽음(기존 대화 그대로) · stop=${r.stop_reason}`); return false; }
    }
    if (intent === 'policy') _stats.policy++;
    if (intent !== 'none') _stats.yes++; else _stats.no++;
    _memo = { q: 말, v: intent !== 'none', intent, name: 이름, at: Date.now() };
    console.log(`[🛡️2층안전망] q="${말.slice(0, 30)}" → 판정=${intent === 'policy' ? '증권 텍스트' + (이름 ? '(' + 이름 + ' 님)' : '') : intent === 'roster' ? '명단 조회' : '해당 없음'}${이유 ? ' · ' + 이유.slice(0, 50) : ''}`);
    return _게이트통과(intent, opts, 말);
  } catch (e) {
    _stats.err++;
    console.log('[🛡️2층안전망] 판정 실패(기존 대화 그대로 진행): ' + e.message);
    return false;                                    // ★실패는 무해하게 — 예전 길로 간다
  }
}

/**
 * 명단 조회로 판정된 말을 ★도구(sheets_crud)에 실제로 넘긴다.
 * @returns {Promise<object>} 라우터가 그대로 쓸 out 객체 (null 을 돌려주지 않는다)
 */
async function answer(q, opts) {
  opts = opts || {};
  const hist = Array.isArray(opts.history) ? opts.history.slice(-10) : [];

  // 📄 방금 판정이 "증권 텍스트"였으면 증권 해석 모듈로 보낸다(명단 도구가 아니라).
  if (_memo.q === String(q || '').trim() && _memo.intent === 'policy' && (Date.now() - _memo.at) < 60000) {
    console.log('[🛡️2층안전망→증권해석] 이름힌트=' + (_memo.name || '(없음)'));
    return _policy.analyzeText(String(q || ''), { ma: opts.ma || null, 이름힌트: _memo.name });
  }

  if (!_crud || typeof _crud.runChat !== 'function') {
    return { kind: '🗂️ 고객명단', text: '명단을 볼 준비가 아직 안 됐어요. 잠시 후 다시 말씀해 주세요.' };
  }
  try {
    const rc = await _crud.runChat(opts.ma || null, hist.concat([{ role: 'user', content: String(q || '') }]));
    const 답 = rc && rc.reply ? String(rc.reply).trim() : '';
    console.log(`[🛡️2층안전망→명단도구] reply="${답.replace(/\n/g, ' ').slice(0, 120)}"`);
    if (!답) return { kind: '🗂️ 고객명단', text: '명단에서 찾지 못했어요. 조건을 조금 더 알려주시겠어요?' };
    return { kind: '🗂️ 고객명단', text: 답, pending: (rc && rc.pending) || null, engine: _MODEL, viaGate: true };
  } catch (e) {
    console.log('[🛡️2층안전망→명단도구] 실패: ' + e.message);
    return { kind: '🗂️ 고객명단', text: '명단을 불러오는 중에 문제가 있었어요. 잠시 후 다시 말씀해 주세요.' };
  }
}

module.exports = { init, wants, wantsPolicy, looksLikePolicyText, answer, judgePrompt, stats };
