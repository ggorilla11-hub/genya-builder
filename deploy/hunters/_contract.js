// ─────────────────────────────────────────────────────────────
// hunters/_contract.js — 📰 기자 수칙 (모든 채널 AI가 지킬 공통 규약)
//
// 신문사 비유: 채널 AI = 기자 / 총괄 지니야 = 편집장 / 대표님 = 발행인
//   기자는 취재만 한다. 판별·선별·게시는 기자의 권한이 아니다.
//
// ★이 수칙이 있는 이유(실제 사고):
//   유튜브 AI가 "상담 문의는 카톡 주세요"라고 광고하는 경쟁자를 🔥핫 1순위로 올렸다.
//   원인은 ①판별을 기자가 스스로 했고 ②왜 추천했는지 근거를 댈 의무가 없었기 때문이다.
//   → 판별은 lead_filter 한 곳으로, 추천에는 반드시 근거를 붙인다.
//
// 기자 1명 = 파일 1개. 아래 4개 함수만 구현하면 편집장이 자동으로 인식한다.
//   probe()            지금 취재 가능한가(키·인증·할당량). 안 되면 정직하게 off
//   search(persona)    홍보대사 정체성으로 공개 글 순회 → 후보 수집(읽기만)
//   enrich(item)       채널 고유 맥락 부착(작성자 채널ID 등). 판별은 안 함
//   draft(persona,lead) 답글 초안. ★게시 함수는 만들지 않는다
// ─────────────────────────────────────────────────────────────
'use strict';

// ★기자가 절대 하지 않는 것 — 코드 리뷰·검사에서 이 목록을 기준으로 본다
const FORBIDDEN = [
  '자동 게시·댓글·DM·메일 발송',      // 게시는 언제나 사람이 직접
  '로그인 우회·스크래핑',              // 공개 API/공개 페이지만
  'robots.txt·이용약관 우회',
  '개인정보 서버 저장',                // 메모리 → 화면 → 폐기
  '기자 자체 판별 규칙',               // 판별은 lead_filter 한 곳
];

// ★2026-07-27 사고: "발굴 중…"에서 영원히 멈춤. 리드도 에러도 안 떴다.
//   원인 = Node의 fetch는 ★기본 타임아웃이 없다. 상대 서버가 응답을 안 주면 무한 대기한다.
//   한 채널이 매달리면 발굴 전체가 멈춘다 → 모든 외부 호출은 반드시 이 함수를 쓴다.
const FETCH_MS = Number(process.env.HUNTER_FETCH_MS) || 7000;
async function fetchJson(url, opts, ms) {
  const timeout = ms || FETCH_MS;
  const o = Object.assign({}, opts || {});
  let timer = null;
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    o.signal = AbortSignal.timeout(timeout);
  } else {                                   // 구버전 Node 대비
    const ac = new AbortController(); o.signal = ac.signal;
    timer = setTimeout(() => ac.abort(), timeout);
  }
  // ★2중 안전: AbortSignal은 "fetch가 신호를 지켜줄 때만" 듣는다.
  //   무시하는 구현을 만나면 그대로 매달리므로, 밖에서도 시계를 하나 더 건다.
  const LATE = Symbol('late');
  let guardTimer = null;
  const guard = new Promise((res) => { guardTimer = setTimeout(() => res(LATE), timeout + 500); });
  try {
    const r = await Promise.race([fetch(url, o), guard]);
    if (r === LATE) throw new Error(`응답 없음(${Math.round(timeout / 1000)}초 초과)`);
    const j = await Promise.race([r.json(), guard]);
    if (j === LATE) throw new Error(`응답 없음(${Math.round(timeout / 1000)}초 초과)`);
    return j;
  } catch (e) {
    const nm = String((e && e.name) || '');
    if (nm === 'TimeoutError' || nm === 'AbortError') throw new Error(`응답 없음(${Math.round(timeout / 1000)}초 초과)`);
    throw e;
  } finally { if (timer) clearTimeout(timer); if (guardTimer) clearTimeout(guardTimer); }
}

/** 리드 1건의 표준 모양. 여기서 벗어나면 편집장이 반려한다. */
function makeLead(o) {
  return {
    id: String(o.id || ''),                 // 추적용 ID(개인정보 아님) 예: YT_a1b2c3
    hunter: String(o.hunter || ''),         // 어느 기자가 물어왔나
    source: String(o.source || ''),         // 유튜브 / 지식인 …
    author: String(o.author || ''),         // 화면 표시용(서버 저장 안 함)
    text: String(o.text || '').slice(0, 600),   // ★2026-08-09 300→600 (판별관문이 연락처·직함을 보게)
    sourceUrl: String(o.sourceUrl || ''),   // ★발행인이 직접 가서 확인할 링크(필수)
    postedAt: o.postedAt || '',
    context: o.context || {},               // 판별에 필요한 맥락(작성자 채널ID 등)
    reason: o.reason || null,               // ★추천 근거(아래 makeReason) — 없으면 반려
  };
}

/**
 * ★추천 근거 — 기자는 "왜 이 사람인지" 반드시 대야 한다.
 * evidence는 반드시 본문에 실제로 있는 구절이어야 한다(편집장이 원문 대조로 검증).
 * 본문에 없는 말을 근거로 대면 '근거 위조'로 반려되고 기자 성적에 남는다.
 */
function makeReason(o) {
  return {
    why: String(o.why || '').slice(0, 60),          // 왜 이 사람인가(한 줄)
    evidence: String(o.evidence || '').slice(0, 200), // ★본문에서 그대로 따온 구절
    signals: Array.isArray(o.signals) ? o.signals.slice(0, 5) : [],
    fitScore: Math.max(0, Math.min(100, Number(o.fitScore) || 0)), // 내 정체성 적합도
  };
}

/** 리드 ID 만들기 — 개인정보를 넣지 않는다(채널 약어 + 원본 식별자 해시) */
function makeId(hunterKey, raw) {
  const crypto = require('crypto');
  const h = crypto.createHash('sha1').update(String(raw || '')).digest('hex').slice(0, 8);
  return String(hunterKey || 'X').toUpperCase().slice(0, 3) + '_' + h;
}

// ★AI 명명 — 기자에게 이름을 준다.
//   왜: 상벌제는 "누가 잘했나"를 사람이 말할 수 있어야 굴러간다.
//   'youtube'라는 키보다 '유진'이 성적표·회의록에서 훨씬 잘 읽힌다(사람 직원처럼).
//   이름은 각 기자 파일이 name으로 선언하고, 없으면 채널 키에서 자동 생성한다.
const NAME_POOL = ['유진', '나래', '가온', '다온', '이든', '하람', '시온', 'れ온'];
function autoName(key) {
  let h = 0; const s = String(key || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return NAME_POOL[h % NAME_POOL.length];
}
/** 기자 표시용 이름 — "유진(📺 유튜브)" */
function displayName(mod) {
  const nm = (mod && mod.name) || autoName(mod && mod.key);
  return `${nm}(${(mod && mod.label) || mod.key})`;
}

/** 기자 파일이 규약을 지켰는지 확인(편집장이 등록 시 1회 검사) */
function validateHunter(mod) {
  const miss = ['key', 'label', 'probe', 'search', 'draft'].filter((k) => !mod || mod[k] == null);
  if (miss.length) return { ok: false, error: '기자 규약 누락: ' + miss.join(', ') };
  // ★게시 함수를 가진 기자는 등록 자체를 거부한다(있으면 언젠가 눌린다)
  const banned = ['post', 'send', 'reply', 'comment', 'publish', 'dm'].filter((k) => typeof mod[k] === 'function');
  if (banned.length) return { ok: false, error: '게시 함수 금지(수칙 위반): ' + banned.join(', ') };
  return { ok: true };
}

module.exports = { FORBIDDEN, makeLead, makeReason, makeId, validateHunter, autoName, displayName, fetchJson, FETCH_MS };
