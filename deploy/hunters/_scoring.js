// ─────────────────────────────────────────────────────────────
// hunters/_scoring.js — 📋 채점표 (대표님 골든 프로필 기준)
//
// ★대표님이 실전에서 정한 "진짜 상담 오는 사람":
//   신혼·예비신혼 35 · 30대 추정 25 · 간절함 15 · 구체성 10 · 적합성 10 · 접근가능성 5 = 100
//   → 신혼 + 30대면 그것만으로 60점. 여기에 간절함이 붙으면 자동으로 🔥핫 상위로 올라온다.
//   판정: 70+ 🔥핫 / 50~70 🌤웜 / 50↓ 보류
//
// ★배점·판정선은 프로필에서 조정 가능(대표님이 감각으로 바꿀 수 있게).
// ─────────────────────────────────────────────────────────────
'use strict';

const DEFAULT_WEIGHTS = { 신혼: 35, 삼십대: 25, 간절함: 15, 구체성: 10, 적합성: 10, 접근가능성: 5 };

// ── ★신혼·예비신혼 (대표님 1순위 타겟) ──
const R_WED_STRONG = /(신혼|예비\s*신혼|결혼\s*준비|결혼\s*앞두|곧\s*결혼|내년\s*결혼|상견례|혼수|예단|신혼집|집\s*장만|전셋집\s*구하|신접살림)/;
const R_WED_SOFT = /(결혼|웨딩|청첩|프러포즈|맞벌이\s*시작|신혼부부)/;
// ── ★30대 추정 ──
const R_30_STRONG = /(30대|삼십\s*대|3[0-9]\s*살|3[0-9]\s*세)/;
const R_30_SOFT = /(직장인|사회\s*초년|입사\s*\d년|결혼\s*적령|또래|신입\s*벗어|이직\s*준비)/;
// ── 간절함 ──
const R_URGENT = /(절실|급해|급하게|당장|막막|답답|모르겠|무섭|힘들|어떡|도와\s*주세요|살려|고민이\s*많)/;
const R_ASKING = /(고민|어떻게\s*(해야|하죠|하나요|할까)|궁금|여쭤|여쭙|조언|추천\s*(해\s*주|부탁)|알려\s*주세요|가능할까요|괜찮을까요|맞을까요)/;
// ── 구체성 ──
const R_NUM = /(\d{2,}\s*(만원|만|억|천만|살|세|년|개월))|((이십|삼십|사십|오십|육십)\s*대)|(\d+\s*%)/;
const R_SITU = /(퇴직|은퇴|출산|임신|이직|창업|전세|월세|대출|자녀|육아|내집|청약)/;
// ── 적합성 ──
const R_FIT = /(재무|목돈|종잣돈|저축|투자|재테크|연금|보험|자산|노후|청약|대출|절세|세금)/;

function _clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * 리드 1건 채점.
 * @param text 본문
 * @param opts {postedAt, hasUrl, persona:{키워드:[]}, weights, cuts:{hot,warm}}
 */
function score(text, opts) {
  opts = opts || {};
  const t = String(text || '');
  const W = Object.assign({}, DEFAULT_WEIGHTS, opts.weights || {});
  const cuts = Object.assign({ hot: 70, warm: 50 }, opts.cuts || {});
  const notes = [];
  const b = {};

  // ★신혼 — 명시적 신호면 만점, 결혼 언급만이면 절반
  let wed = 0;
  if (R_WED_STRONG.test(t)) { wed = 1; notes.push('신혼·결혼 준비'); }
  else if (R_WED_SOFT.test(t)) { wed = 0.5; notes.push('결혼 관련 언급'); }
  b.신혼 = Math.round(W.신혼 * wed);

  // ★30대 — 나이 직접 언급이면 만점, 정황이면 절반
  let age = 0;
  if (R_30_STRONG.test(t)) { age = 1; notes.push('30대 명시'); }
  else if (R_30_SOFT.test(t)) { age = 0.5; notes.push('30대 정황'); }
  // 신혼 신호가 강하면 30대일 확률이 높다(대표님 실전 감각)
  else if (wed >= 1) { age = 0.4; notes.push('신혼 → 30대 추정'); }
  b.삼십대 = Math.round(W.삼십대 * age);

  let eager = 0;
  if (R_URGENT.test(t)) { eager = 1; notes.push('간절한 표현'); }
  else if (R_ASKING.test(t)) { eager = 0.6; notes.push('도움을 구하는 질문'); }
  b.간절함 = Math.round(W.간절함 * eager);

  let conc = 0;
  if (R_NUM.test(t)) { conc += 0.6; notes.push('구체적 수치'); }
  if (R_SITU.test(t)) { conc += 0.4; notes.push('구체적 상황'); }
  if (t.length >= 60) conc += 0.15;
  b.구체성 = Math.round(W.구체성 * _clamp(conc, 0, 1));

  let fit = R_FIT.test(t) ? 0.7 : 0;
  const kws = (opts.persona && Array.isArray(opts.persona.키워드)) ? opts.persona.키워드 : [];
  const hit = kws.filter((k) => k && t.indexOf(String(k).replace(/^#/, '')) >= 0);
  if (hit.length) { fit += 0.3; notes.push('내 키워드 일치: ' + hit.slice(0, 2).join(',')); }
  b.적합성 = Math.round(W.적합성 * _clamp(fit, 0, 1));

  b.접근가능성 = opts.hasUrl === false ? 0 : W.접근가능성;

  const total = Object.keys(b).reduce((s, k) => s + b[k], 0);
  const grade = total >= cuts.hot ? '🔥핫' : (total >= cuts.warm ? '🌤웜' : '보류');
  return { total, breakdown: b, grade, notes };
}

/** 프로필에서 배점 조정 — 잘못된 값은 기본값 유지 */
function normalizeWeights(raw) {
  const w = Object.assign({}, DEFAULT_WEIGHTS);
  Object.keys(DEFAULT_WEIGHTS).forEach((k) => {
    const v = Number(raw && raw[k]);
    if (Number.isFinite(v) && v >= 0 && v <= 100) w[k] = v;
  });
  return w;
}

module.exports = { score, normalizeWeights, DEFAULT_WEIGHTS };
