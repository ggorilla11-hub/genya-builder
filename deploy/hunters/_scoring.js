// ─────────────────────────────────────────────────────────────
// hunters/_scoring.js — 📋 채점표 (리크루팅 인터뷰처럼 기준별 배점)
//
// 무엇을·왜: 예전엔 '핫/웜/콜드' 세 단계뿐이라 무엇이 더 뜨거운지 줄 세울 수 없었다.
//   기준별 점수를 매기면 ①왜 이 점수인지 설명할 수 있고 ②배분(대표님 우선·교육생 10명)이 가능하다.
//
// ★배점은 프로필에서 조정 가능하다(대표님이 실전 감각으로 바꿀 수 있게).
//   기본 배점: 간절함30 · 구체성20 · 시급성20 · 적합성20 · 접근가능성10 = 100
//   판정: 70+ 적극후보 / 50~70 검토 / 50↓ 보류
// ─────────────────────────────────────────────────────────────
'use strict';

const DEFAULT_WEIGHTS = { 간절함: 30, 구체성: 20, 시급성: 20, 적합성: 20, 접근가능성: 10 };

// ── 간절함: 도움을 구하는 강도(주는 쪽이 아니라 받는 쪽) ──
const R_URGENT = /(절실|급해|급하게|당장|막막|답답|모르겠|무섭|힘들|어떡|도와\s*주세요|살려)/;
const R_ASKING = /(고민|어떻게\s*(해야|하죠|하나요|할까)|궁금|여쭤|여쭙|조언|추천\s*(해\s*주|부탁)|알려\s*주세요|가능할까요|괜찮을까요|맞을까요)/;
// ── 구체성: 숫자·나이·상황이 들어 있나 ──
const R_NUM = /(\d{2,}\s*(만원|만|억|천만|살|세|년|개월))|((이십|삼십|사십|오십|육십)\s*대)|(\d+\s*%)/;
const R_SITU = /(퇴직|은퇴|결혼|출산|이직|창업|폐업|전세|대출|자녀|육아|암|수술|입원|상속|증여)/;
// ── 시급성: 지금 필요한가 ──
const R_NOW = /(지금|당장|이번\s*달|이달|올해\s*안|곧|다음\s*주|내년\s*초|얼마\s*안\s*남)/;
// ── 적합성: 재무·노후·연금 영역인가 ──
const R_FIT = /(재무|노후|연금|은퇴|보험|저축|투자|목돈|종잣돈|재테크|자산|세금|절세|상속|증여|퇴직금)/;
// ── 접근가능성: 공개 글이고 링크로 갈 수 있나(기본 충족), 최신일수록 가산 ──

function _clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * 리드 1건 채점.
 * @param text 본문
 * @param opts {postedAt, hasUrl, persona:{키워드:[]}, weights}
 * @returns {{total, breakdown, grade, notes[]}}
 */
function score(text, opts) {
  opts = opts || {};
  const t = String(text || '');
  const W = Object.assign({}, DEFAULT_WEIGHTS, opts.weights || {});
  const notes = [];
  const b = {};

  // 간절함 — 강한 표현이면 만점, 질문형이면 절반
  let eager = 0;
  if (R_URGENT.test(t)) { eager = 1; notes.push('간절한 표현'); }
  else if (R_ASKING.test(t)) { eager = 0.55; notes.push('도움을 구하는 질문'); }
  b.간절함 = Math.round(W.간절함 * eager);

  // 구체성 — 숫자와 생애사건이 둘 다 있으면 만점
  let conc = 0;
  if (R_NUM.test(t)) { conc += 0.6; notes.push('구체적 수치'); }
  if (R_SITU.test(t)) { conc += 0.4; notes.push('구체적 상황'); }
  if (t.length >= 60) conc += 0.15;                    // 길게 쓴 글 = 고민이 깊다
  b.구체성 = Math.round(W.구체성 * _clamp(conc, 0, 1));

  // 시급성 — 시점 표현 + 최신 글
  let urg = R_NOW.test(t) ? 0.7 : 0;
  if (opts.postedAt) {
    const days = (Date.now() - new Date(opts.postedAt).getTime()) / 864e5;
    if (days >= 0 && days <= 3) { urg += 0.3; notes.push('최근 3일 내'); }
    else if (days <= 14) urg += 0.15;
  }
  b.시급성 = Math.round(W.시급성 * _clamp(urg, 0, 1));

  // 적합성 — 우리 영역인가 + 내 정체성 키워드와 겹치나
  let fit = R_FIT.test(t) ? 0.7 : 0;
  const kws = (opts.persona && Array.isArray(opts.persona.키워드)) ? opts.persona.키워드 : [];
  const hit = kws.filter((k) => k && t.indexOf(String(k).replace(/^#/, '')) >= 0);
  if (hit.length) { fit += 0.3; notes.push('내 키워드 일치: ' + hit.slice(0, 2).join(',')); }
  b.적합성 = Math.round(W.적합성 * _clamp(fit, 0, 1));

  // 접근가능성 — 공개 글 링크가 있으면 충족
  b.접근가능성 = opts.hasUrl === false ? 0 : W.접근가능성;

  const total = Object.keys(b).reduce((s, k) => s + b[k], 0);
  const grade = total >= 70 ? '적극후보' : (total >= 50 ? '검토' : '보류');
  return { total, breakdown: b, grade, notes };
}

/** 프로필에서 배점을 조정할 수 있게 — 잘못된 값은 기본값으로 되돌린다 */
function normalizeWeights(raw) {
  const w = Object.assign({}, DEFAULT_WEIGHTS);
  Object.keys(DEFAULT_WEIGHTS).forEach((k) => {
    const v = Number(raw && raw[k]);
    if (Number.isFinite(v) && v >= 0 && v <= 100) w[k] = v;
  });
  return w;
}

module.exports = { score, normalizeWeights, DEFAULT_WEIGHTS };
