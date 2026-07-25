// ─────────────────────────────────────────────────────────────
// hunters/index.js — 🗞️ 편집장 (총괄 지니야의 발굴 지휘부)
//
// 신문사: 기자(hunters/*.js)가 취재 → 편집장이 근거 확인·선별·정렬 → 발행인(대표님)이 결재.
//
// 편집장이 하는 일:
//   1) 기자 자동 등록 — hunters/ 폴더의 파일을 읽어 규약 검사 후 등록(파일 하나 추가 = 채널 하나 추가)
//   2) 순회 — 등록된 기자를 돌며 후보 수집
//   3) ★판별 관문 — lead_filter 한 곳에서만(기자가 스스로 판별 못 함)
//   4) ★근거 검증 — evidence가 본문에 실제로 있나. 없으면 '근거 위조'로 반려
//   5) 채점·정렬 — 100점 채점표로 줄 세우기
//   6) 성과 집계 — 기자별 추천/반려/제외 수(★숫자만·개인정보 없음)
//
// ★개인정보: 리드 본문·작성자명은 화면으로 흘려보내고 서버에 저장하지 않는다.
//   성과 기록에 남는 것은 기자별 "숫자"뿐이다.
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./_contract');
const S = require('./_scoring');
const leadFilter = require('../lead_filter');

// ── 1) 기자 자동 등록 ──
let _hunters = null;
function hunters() {
  if (_hunters) return _hunters;
  _hunters = [];
  let files = [];
  try { files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && !f.startsWith('_') && f !== 'index.js'); } catch (e) {}
  files.forEach((f) => {
    try {
      const mod = require(path.join(__dirname, f));
      const v = C.validateHunter(mod);
      if (!v.ok) { console.log(`[🗞️편집장] 기자 등록 거부 ${f}: ${v.error}`); return; }
      _hunters.push(mod);
    } catch (e) { console.log(`[🗞️편집장] 기자 로드 실패 ${f}: ${e.message}`); }
  });
  return _hunters;
}
function roster() {
  return hunters().map((h) => {
    let p; try { p = h.probe(); } catch (e) { p = { ok: false, off: true, reason: e.message }; }
    return { key: h.key, label: h.label, on: !!(p && p.ok), reason: (p && p.reason) || '' };
  });
}

// ── 4) 근거 검증 ──
//   evidence가 본문에 실제로 있어야 한다. 없으면 지어낸 것이므로 반려.
function _norm(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }
function verifyReason(lead) {
  const r = lead.reason;
  if (!r || !String(r.why || '').trim()) return { ok: false, code: '근거없음', msg: '왜 추천했는지 설명이 없어요' };
  const ev = String(r.evidence || '').trim();
  if (!ev) return { ok: false, code: '근거없음', msg: '본문 근거 구절이 없어요' };
  // ★위조 검사: 근거 구절이 본문에 실제로 존재하는가
  if (_norm(lead.text).indexOf(_norm(ev)) < 0) return { ok: false, code: '근거위조', msg: '본문에 없는 내용을 근거로 댔어요' };
  return { ok: true };
}

// ── 2·3·5) 순회 → 판별 → 근거검증 → 채점 ──
/**
 * @param persona {키워드:[], 차별점, 말투, weights}
 * @returns {{leads[], stats, roster}}
 */
async function collect(persona, opts) {
  opts = opts || {};
  persona = persona || {};
  const weights = S.normalizeWeights(persona.weights);
  const stats = {};   // 기자별 숫자 — ★개인정보 없음
  const leads = [];
  for (const h of hunters()) {
    const st = stats[h.key] = { 기자: h.label, 수집: 0, 홍보자제외: 0, 근거반려: 0, 채택: 0, 확인필요: 0, 에러: '' };
    let raw = [];
    try {
      const p = h.probe();
      if (!p || !p.ok) { st.에러 = p && p.reason ? p.reason : '사용 불가'; continue; }
      raw = await h.search(persona, { max: opts.max || 30 });
    } catch (e) { st.에러 = e.message; continue; }
    st.수집 = raw.length;
    for (const item of raw) {
      const lead = (h.enrich ? h.enrich(item) : item);
      // ★판별은 여기 한 곳에서만 — 기자가 스스로 하지 않는다(경쟁자 오인 사고의 재발 방지)
      const scr = leadFilter.preScreen(lead.text, lead.context || {});
      if (scr.verdict === '공급자') { st.홍보자제외++; continue; }
      // ★근거 의무 — 기자가 근거를 만들고 편집장이 검증한다
      lead.reason = (h.reason ? h.reason(lead, persona) : null);
      const vr = verifyReason(lead);
      if (!vr.ok) { st.근거반려++; lead.rejected = vr; continue; }
      const sc = S.score(lead.text, { postedAt: lead.postedAt, hasUrl: !!lead.sourceUrl, persona, weights });
      lead.score = sc.total; lead.grade = sc.grade; lead.breakdown = sc.breakdown;
      lead.verdict = scr.verdict; lead.tier = leadFilter.tier(lead.text);
      if (scr.verdict === '애매') st.확인필요++;
      st.채택++;
      leads.push(lead);
    }
  }
  // 고객 먼저, 그다음 점수 높은 순
  const vOrd = { '고객': 0, '애매': 1 };
  leads.sort((a, b) => ((vOrd[a.verdict] != null ? vOrd[a.verdict] : 9) - (vOrd[b.verdict] != null ? vOrd[b.verdict] : 9)) || (b.score - a.score));
  return { leads, stats, roster: roster() };
}

module.exports = { hunters, roster, collect, verifyReason };
