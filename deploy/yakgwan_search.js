// ─────────────────────────────────────────────────────────────
// yakgwan_search.js — 📚 약관 공용 검색 엔진 (누구나 한 줄로 부르는 공동 자산)
//
// 무엇을·왜: 파인콘 약관 창고(genya-knowledge)에서 ★질문에 맞는 약관을 찾아 근거·페이지와 함께 돌려준다.
//   특정 기능에 묶이지 않는다. 보상비서·약관질문·상품추천·상담 어디서든 require 한 줄로 쓴다.
//
// ★★2026-07-29 이 파일이 생긴 이유 (사고 기록 — 지우지 말 것)
//   예전 yakgwan_module.js는 네임스페이스가 ★한 줄로 하드코딩돼 있었다:
//        const NAMESPACE = 'yakgwan_samsung_auto_2025';   // 575개
//   그런데 파인콘엔 실제로 ★631,026개(약관 68종·보험사 5곳)가 들어 있었다. 즉 ★0.09%만 쓰고 있었고,
//   실손·장기·현대해상을 물어도 "약관에 없어요"라고 ★거짓 안내를 해 왔다.
//   → 이제 네임스페이스를 ★자동으로 읽어 지도로 만든다. 약관이 늘어도 코드를 안 고친다.
//
// ★★함정 (설계의 핵심 — 반드시 유지)
//   "삼성화재 실손"은 이름에 indemnity가 없다. ★yakgwan_samsungfire_longterm_2026(장기) 안에 있다.
//   (실측: 무배당 삼성화재 다이렉트 실손의료비보험(2605.1) 등)
//   → 상품군 ★이름만 믿고 한 곳만 뒤지면 못 찾는다. 관련 후보를 ★여러 곳 뒤져 점수로 고른다.
//
// ★원칙
//   · 지어내기 0 — 못 찾으면 found=false. 어디를 찾아봤는지도 함께 알린다.
//   · 읽기 전용 — 쓰기·삭제 코드 없음.
//   · 개인정보 0 — 약관은 공개자료다. 개인 기억(owner_*) 네임스페이스는 ★쳐다보지도 않는다.
//   · 발송 0.
//
// 사용:
//   const yak = require('./yakgwan_search');
//   const r = await yak.search({ 질문: '실손 본인부담금', 보험사: '삼성화재', 상품군: '실손' });
//   r.발췌[0] → { 보험사, 상품, 페이지, 원문, 점수, 네임스페이스 }
// ─────────────────────────────────────────────────────────────
'use strict';
try { require('dotenv').config(); } catch (e) {}

const INDEX = 'genya-knowledge';
const EMBED_MODEL = 'text-embedding-3-small';   // ★벡터가 이 모델로 만들어졌다. 바꾸면 검색이 깨진다.
// ★★문턱값 — 2026-07-29 실측으로 정했다(짐작 아님). 시험이 "떡볶이 레시피"에도 약관 근거를
//   들이미는 것을 잡아냈다. 옛 값 0.28은 ★한 곳만 뒤질 때의 값이라, 68곳을 뒤지는 지금은 너무 낮다.
//   실측: 관련 질문 0.556~0.644(실손·과실상계·암진단비·무보험차)
//         무관 질문 0.336~0.403(떡볶이·파이썬·날씨·축구)
//         → 사이가 비어 있다. 0.45로 두면 잡음만 걸러지고 진짜 근거는 다 통과한다.
//   ★이 값을 낮추려면 위 실측을 다시 하고 근거를 남길 것.
const MIN_SCORE = 0.45;
const 기본후보수 = 6;                            // 한 번에 뒤질 네임스페이스 수
const 지도수명 = 10 * 60 * 1000;                 // 지도 캐시 10분(약관이 늘면 10분 안에 반영)

let _pc = null, _oa = null, _지도 = null, _지도시각 = 0;

function configured() { return !!(process.env.PINECONE_API_KEY && process.env.OPENAI_API_KEY); }
function _pine() {
  if (!_pc) _pc = new (require('@pinecone-database/pinecone').Pinecone)({ apiKey: process.env.PINECONE_API_KEY });
  return _pc;
}
function _openai() {
  if (!_oa) _oa = new (require('openai'))({ apiKey: process.env.OPENAI_API_KEY });
  return _oa;
}

// ═══════════════════════════════════════════════════════════════
// 1. 네임스페이스 지도 — ★자동 생성 (하드코딩 0)
// ═══════════════════════════════════════════════════════════════
// 이름 규칙: yakgwan_<보험사>_<상품군>_<연도>   예) yakgwan_samsungfire_longterm_2026
const 보험사코드 = {
  samsungfire: '삼성화재', samsung: '삼성화재', hyundai: '현대해상',
  kb: 'KB손해보험', heungkuk: '흥국화재', axa: 'AXA손해보험',
};
const 상품군코드 = {
  health: '건강·질병', longterm: '장기', general: '일반', auto: '자동차',
  annuity: '연금', savings: '저축', driver: '운전자', indemnity: '실손', care: '간병·케어',
};

/** 약관 네임스페이스 지도를 파인콘에서 직접 읽어 만든다(캐시 10분) */
async function 지도(강제새로) {
  const now = Date.now();
  if (!강제새로 && _지도 && (now - _지도시각) < 지도수명) return _지도;
  const st = await _pine().index(INDEX).describeIndexStats();
  const ns = st.namespaces || {};
  const out = [];
  Object.keys(ns).forEach((k) => {
    if (!k.startsWith('yakgwan_')) return;                       // ★약관만. 개인 기억은 안 본다.
    const p = k.replace('yakgwan_', '').split('_');
    const 코드 = p[0];
    const 군 = p[1] || '';
    const 연도 = p.slice(2).join('_') || 'undated';
    const n = ns[k].recordCount != null ? ns[k].recordCount : ns[k].vectorCount;
    out.push({
      네임스페이스: k, 보험사코드: 코드, 보험사: 보험사코드[코드] || 코드,
      상품군코드: 군, 상품군: 상품군코드[군] || 군,
      연도: 연도, 연도숫자: /^\d{4}$/.test(연도) ? Number(연도) : 0, 개수: n,
    });
  });
  _지도 = out; _지도시각 = now;
  return out;
}

// ═══════════════════════════════════════════════════════════════
// 2. 질문에서 보험사·상품군 알아채기 (규칙 기반 · 확실할 때만)
// ═══════════════════════════════════════════════════════════════
const 보험사별칭 = [
  ['삼성화재', /삼성화재|삼성\s*손보|애니카/], ['현대해상', /현대해상|현대\s*손보|하이카|Hi\d/i],
  ['KB손해보험', /KB\s*손[해보]|KB손보|LIG/i], ['흥국화재', /흥국/], ['AXA손해보험', /AXA|악사/i],
];
function 보험사찾기(q) {
  const t = String(q || '');
  for (const [이름, re] of 보험사별칭) if (re.test(t)) return 이름;
  return null;                                   // ★못 찾으면 지어내지 않는다(전체에서 찾는다)
}

// 상품군 → ★관련 후보군(이름만 믿지 않는다. 삼성 실손이 longterm에 숨은 함정 대응)
const 군확장 = {
  실손: ['indemnity', 'longterm', 'health'],
  건강: ['health', 'longterm', 'care', 'indemnity'],
  자동차: ['auto'],
  운전자: ['driver', 'auto'],
  연금: ['annuity', 'savings'],
  저축: ['savings', 'annuity'],
  간병: ['care', 'health', 'longterm'],
  장기: ['longterm', 'health', 'indemnity'],
  일반: ['general'],
};
const 군별칭 = [
  ['실손', /실손|실비|의료비|본인부담|통원|입원의료/],
  ['운전자', /운전자|교통사고처리|벌금|변호사선임/],
  ['자동차', /자동차보험|대인배상|대물배상|자기차량|자차|무보험차|애니카/],
  ['간병', /간병|치매|장기요양|케어/],
  ['연금', /연금|퇴직|노후/],
  ['저축', /저축|목돈|만기환급/],
  ['건강', /암|진단비|수술비|입원일당|후유장해|질병|건강보험|뇌|심장/],
  ['장기', /장기보험|갱신형|납입면제/],
];
function 상품군찾기(q) {
  const t = String(q || '');
  for (const [이름, re] of 군별칭) if (re.test(t)) return 이름;
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 3. 후보 네임스페이스 고르기
// ═══════════════════════════════════════════════════════════════
/**
 * @returns {Array} 뒤질 네임스페이스 목록(개수·최신 연도 우선)
 * ★한 곳만 고르지 않는다. 관련 후보를 여러 개 골라 점수로 판정한다.
 */
function 후보고르기(맵, 보험사, 상품군, 후보수) {
  let 목록 = 맵.slice();
  if (보험사) {
    const 좁힘 = 목록.filter((x) => x.보험사 === 보험사);
    if (좁힘.length) 목록 = 좁힘;               // 그 보험사 약관이 하나도 없으면 전체로 둔다(정직히 알림)
  }
  if (상품군 && 군확장[상품군]) {
    const 군들 = 군확장[상품군];
    const 좁힘 = 목록.filter((x) => 군들.includes(x.상품군코드));
    if (좁힘.length) {
      // ★관련 군 안에서 고르되, 확장 목록 앞쪽(더 정확한 군)을 우선한다
      목록 = 좁힘.sort((a, b) => {
        const d = 군들.indexOf(a.상품군코드) - 군들.indexOf(b.상품군코드);
        if (d !== 0) return d;
        if (b.연도숫자 !== a.연도숫자) return b.연도숫자 - a.연도숫자;
        return b.개수 - a.개수;
      });
      return 목록.slice(0, 후보수);
    }
  }
  // 상품군을 못 정했으면 ★큰 것·최신 것 위주로 넓게 훑는다(점수가 걸러준다)
  목록.sort((a, b) => (b.연도숫자 - a.연도숫자) || (b.개수 - a.개수));
  return 목록.slice(0, 후보수);
}

// ═══════════════════════════════════════════════════════════════
// 4. 검색 — 여러 네임스페이스를 한 번에 뒤져 점수로 병합
// ═══════════════════════════════════════════════════════════════
/**
 * @param {object} o { 질문, 보험사?, 상품군?, topK?, 후보수? }
 * @returns {{found, 발췌:Array, 출처:Array, 페이지:Array, 찾아본곳:Array, 보험사, 상품군, 사유?}}
 *   발췌 = [{ 보험사, 상품, 페이지, 원문, 점수, 네임스페이스 }]
 */
async function search(o) {
  o = o || {};
  const 질문 = String(o.질문 || '').trim();
  const topK = o.topK || 4;
  const 후보수 = o.후보수 || 기본후보수;
  const 빈결과 = (사유, 찾아본곳) => ({ found: false, 발췌: [], 출처: [], 페이지: [], 찾아본곳: 찾아본곳 || [], 보험사: null, 상품군: null, 사유 });

  if (!질문) return 빈결과('무엇을 찾을지 알려주세요');
  if (!configured()) return 빈결과('약관 창고가 연결되어 있지 않아요(키 미설정)');

  let 맵;
  try { 맵 = await 지도(); }
  catch (e) { return 빈결과('약관 창고 목록을 못 읽었어요'); }
  if (!맵.length) return 빈결과('약관 창고가 비어 있어요');

  const 보험사 = o.보험사 || 보험사찾기(질문);
  const 상품군 = o.상품군 || 상품군찾기(질문);
  const 후보 = 후보고르기(맵, 보험사, 상품군, 후보수);
  const 찾아본곳 = 후보.map((x) => x.네임스페이스);
  if (!후보.length) return 빈결과('찾아볼 약관이 없어요', 찾아본곳);

  // 임베딩은 ★한 번만 만들고 모든 네임스페이스에 재사용한다(비용·속도)
  let vec;
  try {
    const emb = await _openai().embeddings.create({ model: EMBED_MODEL, input: [질문] });
    vec = emb.data[0].embedding;
  } catch (e) { return 빈결과('질문을 벡터로 바꾸지 못했어요', 찾아본곳); }

  const idx = _pine().index(INDEX);
  const 결과 = await Promise.all(후보.map(async (c) => {
    try {
      const r = await idx.namespace(c.네임스페이스).query({ vector: vec, topK, includeMetadata: true });
      return (r.matches || []).map((m) => ({ m, c }));
    } catch (e) { return []; }
  }));

  const 합침 = [];
  결과.forEach((arr) => arr.forEach(({ m, c }) => {
    const md = m.metadata || {};
    if (!md.text) return;
    합침.push({
      보험사: String(md.insurer || c.보험사 || ''),
      상품: String(md.product || ''),
      페이지: md.page != null ? md.page : null,
      원문: String(md.text),
      점수: m.score,
      네임스페이스: c.네임스페이스,
      상품군: c.상품군,
      연도: c.연도,
    });
  }));

  합침.sort((a, b) => b.점수 - a.점수);
  const 통과 = 합침.filter((x) => x.점수 >= MIN_SCORE).slice(0, topK);
  if (!통과.length) {
    return Object.assign(빈결과('찾아본 약관에서는 근거를 못 찾았어요 (지어내지 않습니다)', 찾아본곳), { 보험사, 상품군 });
  }

  return {
    found: true,
    보험사, 상품군,
    발췌: 통과,
    출처: 통과.map((x) => `${x.보험사}${x.상품 ? ' ' + x.상품 : ''}${x.페이지 != null ? ' p.' + x.페이지 : ''}`),
    페이지: 통과.map((x) => x.페이지).filter((p) => p != null),
    찾아본곳,
  };
}

// ═══════════════════════════════════════════════════════════════
// 5. 설명까지 — 약관 발췌를 근거로 쉽게 풀어준다
// ═══════════════════════════════════════════════════════════════
// ★기존 yakgwan_module.js의 말투·규칙을 그대로 옮겼다(기능이 바뀌면 안 되므로).
const ANSWER_MODEL = 'claude-sonnet-5';   // 대표 절대규칙: 모든 LLM은 Claude Sonnet
const SYS = `너는 보험설계사를 돕는 비서 "지니야"다. 아래 [약관 발췌]만 근거로 질문에 쉽게(비유 곁들여) 답한다.
규칙: ① 발췌에 있는 내용만 사용, 절대 지어내지 않는다. ② 발췌에 답이 없으면 "이 약관 발췌에는 없어요 — 원문 확인이 필요해요"라고만 답한다. ③ 구체 수치·지급조건은 발췌 그대로. 출처 페이지는 프론트가 붙이니 본문엔 넣지 마라.`;

let _an = null;
function _claude() {
  if (!_an) { try { _an = new (require('@anthropic-ai/sdk'))({ apiKey: process.env.ANTHROPIC_API_KEY }); } catch (e) { _an = null; } }
  return _an;
}

/**
 * 질문 → 근거 기반 답 + 출처. ★기존 askYakgwan()과 같은 모양으로 돌려준다(호출부 무접촉).
 * @returns {{found, answer, sources, pages, 발췌?, 찾아본곳?, 보험사?, 상품군?}}
 */
async function ask(question, opts) {
  const o = opts || {};
  const r = await search({ 질문: question, 보험사: o.보험사, 상품군: o.상품군, topK: o.topK || 4, 후보수: o.후보수 });
  if (!r.found) {
    return {
      found: false, score: null,
      answer: `${r.사유 || '근거를 못 찾았어요'} — 원문 확인이 필요해요. (지어내지 않음)`,
      sources: [], pages: [], 찾아본곳: r.찾아본곳,
    };
  }
  const ctx = r.발췌.map((x, i) => `(${i + 1}) [${x.보험사} ${x.상품} p.${x.페이지}] ${x.원문}`).join('\n\n');
  let answer = '';
  const an = _claude();
  for (let 시도 = 0; 시도 < 2 && !answer; 시도++) {
    try {
      if (!an) break;
      const ar = await an.messages.create({
        model: ANSWER_MODEL, max_tokens: 시도 === 0 ? 600 : 480, system: SYS,
        messages: [{ role: 'user', content: `[질문] ${question}\n\n[약관 발췌]\n${ctx}` }],
      });
      answer = (ar.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    } catch (e) { /* 한 번 더 시도 */ }
  }
  if (!answer) answer = '지금 약관 답변 생성이 잠깐 어려워요 — 잠시 후 다시 시도해 주세요. (약관 근거 검색은 정상입니다)';
  return {
    found: true, score: r.발췌[0].점수, answer,
    sources: r.출처, pages: r.페이지,
    발췌: r.발췌, 찾아본곳: r.찾아본곳, 보험사: r.보험사, 상품군: r.상품군,
  };
}

/** 창고에 뭐가 있는지 한눈에(진단·안내용 · 개인정보 없음) */
async function 창고요약() {
  const 맵 = await 지도();
  const 보험사 = {};
  맵.forEach((x) => {
    보험사[x.보험사] = 보험사[x.보험사] || { 합계: 0, 종수: 0, 상품군: new Set() };
    보험사[x.보험사].합계 += x.개수; 보험사[x.보험사].종수 += 1; 보험사[x.보험사].상품군.add(x.상품군);
  });
  return {
    약관수: 맵.length,
    총청크: 맵.reduce((a, b) => a + b.개수, 0),
    보험사: Object.entries(보험사).sort((a, b) => b[1].합계 - a[1].합계)
      .map(([이름, v]) => ({ 보험사: 이름, 청크: v.합계, 약관종수: v.종수, 상품군: [...v.상품군] })),
  };
}

module.exports = {
  search, ask, 지도, 창고요약, configured,
  보험사찾기, 상품군찾기, 후보고르기,
  INDEX, MIN_SCORE, 보험사코드, 상품군코드, 군확장,
};
