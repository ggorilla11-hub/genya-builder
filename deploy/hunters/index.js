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
const R = require('./_reviewer');            // 🛡️ 검수AI — 기자와 분리된 심사관
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

/** "2026년 7월 26일 14시, 나래(📺 유튜브)가 발굴" — 사람이 읽는 발굴 서명(서울 시각) */
function _foundLabel(aiName, iso) {
  const p = {};
  try {
    new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false })
      .formatToParts(new Date(iso)).forEach((x) => { p[x.type] = x.value; });
  } catch (e) { return `${aiName}가 발굴`; }
  return `${p.year}년 ${p.month}월 ${p.day}일 ${p.hour}시, ${aiName}가 발굴`;
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
  const skip = new Set(opts.exclude || []);   // 이미 다른 경로로 처리한 채널은 건너뛴다(중복 방지)
  for (const h of hunters()) {
    if (skip.has(h.key)) continue;
    // ★한 채널에 AI 여러 명. 없으면 기본 1명(자동 이름).
    const agents = (Array.isArray(h.agents) && h.agents.length) ? h.agents : [{ name: C.autoName(h.key) }];
    for (const agent of agents) {
    const aiName = `${agent.name}(${h.label})`;
    const st = stats[h.key + '::' + agent.name] = { AI: aiName, 채널: h.label, 담당: (agent.beat || []).join(','), 수집: 0, 홍보자제외: 0, 근거반려: 0, 채택: 0, 확인필요: 0, 에러: '' };
    let raw = [];
    try {
      const p = h.probe();
      if (!p || !p.ok) { st.에러 = p && p.reason ? p.reason : '사용 불가'; continue; }
      raw = await h.search(persona, { max: opts.max || 30, agent });
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
      // ★모든 발굴에 "누가·언제" 새긴다 — 상벌제의 근거가 된다
      //   예: "2026년 7월 26일 14시, 나래(📺 유튜브)가 발굴"
      lead.foundBy = aiName;
      lead.foundAt = new Date().toISOString();
      lead.foundLabel = _foundLabel(aiName, lead.foundAt);
      if (scr.verdict === '애매') st.확인필요++;
      st.채택++;
      leads.push(lead);
    }
    }
  }
  // ── 7) ★검수AI 게이트 — 기자가 물어온 것을 "심사한 뒤에만" 발행인께 올린다 ──
  //    순서 강제: 수집 → 규칙필터 → 근거검증 → 채점 → ★검수AI → 화면
  //    경쟁자 글에 답글을 달면 민원이 되므로, 공급자 판정은 화면에서 제외한다.
  let review = { 심사: 0, 통과: 0, 탈락_공급자: 0, 보류_애매: 0, 검수불가: 0 };
  let passed = leads;
  if (leads.length) {
    try {
      const rv = await R.review(leads);
      review = rv.stats;
      // AI별 성적표에도 검수 결과를 남긴다(누가 물어온 게 잘 통과하는지 = 상벌제 근거)
      leads.forEach((l) => {
        const st = Object.values(stats).find((s) => s.AI === l.foundBy);
        if (!st || !l.review) return;
        if (l.review.verdict === '공급자') st.검수탈락 = (st.검수탈락 || 0) + 1;
        else if (l.review.verdict === '고객') st.검수통과 = (st.검수통과 || 0) + 1;
      });
      passed = R.gate(leads);          // ★공급자 제외
    } catch (e) {
      // 검수가 통째로 실패해도 발굴을 0으로 만들지 않는다 — 대신 "검수 안 됨"을 정직하게 남긴다
      console.log('[🛡️검수AI] 실패: ' + e.message);
      leads.forEach((l) => { if (!l.review) l.review = { verdict: '검수불가', why: '검수 실패', quote: '', by: '검수AI' }; });
      review.검수불가 = leads.length;
    }
  }
  // 검수 통과 먼저 → 규칙 판정 → 점수 높은 순
  const rOrd = { '고객': 0, '애매': 1, '검수불가': 2 };
  const vOrd = { '고객': 0, '애매': 1 };
  passed.sort((a, b) => {
    const ra = rOrd[(a.review || {}).verdict] != null ? rOrd[(a.review || {}).verdict] : 9;
    const rb = rOrd[(b.review || {}).verdict] != null ? rOrd[(b.review || {}).verdict] : 9;
    return (ra - rb)
      || ((vOrd[a.verdict] != null ? vOrd[a.verdict] : 9) - (vOrd[b.verdict] != null ? vOrd[b.verdict] : 9))
      || (b.score - a.score);
  });
  return { leads: passed, stats, roster: roster(), review };
}

module.exports = { hunters, roster, collect, verifyReason, reviewer: R };
