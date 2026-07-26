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

  // ★2026-07-27 "발굴 중…에서 멈춤" 사고 대응 — 3중 안전장치
  //   ① 병렬: 11명이 동시에 나간다(순차면 채널 6개 도는 데만 1~2분)
  //   ② 개별 격리: 한 AI가 느리거나 죽어도 나머지 결과는 그대로 나온다
  //   ③ 시간 상한: 정해진 시간이 지나면 늦은 AI는 두고 지금까지 모은 걸로 발행한다
  const AGENT_MS = Number(opts.agentMs) || 20000;   // AI 한 명이 쓸 수 있는 최대 시간
  const withCap = (p, ms, onLate) => new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; onLate(); resolve(null); } }, ms);
    p.then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
     .catch((e) => { if (!done) { done = true; clearTimeout(t); resolve({ __err: e && e.message ? e.message : String(e) }); } });
  });

  // 순회 대상(기자 × AI)을 먼저 펼친다
  const jobs = [];
  for (const h of hunters()) {
    if (skip.has(h.key)) continue;
    // ★한 채널에 AI 여러 명. 없으면 기본 1명(자동 이름).
    const agents = (Array.isArray(h.agents) && h.agents.length) ? h.agents : [{ name: C.autoName(h.key) }];
    for (const agent of agents) jobs.push({ h, agent });
  }
  // ★동시에 내보낸다 — 전체 시간 = 가장 느린 한 명(순차 합계가 아니다)
  const harvest = await Promise.all(jobs.map(({ h, agent }) => {
    const aiName = `${agent.name}(${h.label})`;
    const st = stats[h.key + '::' + agent.name] = { AI: aiName, 채널: h.label, 담당: (agent.beat || []).join(','), 수집: 0, 홍보자제외: 0, 근거반려: 0, 채택: 0, 확인필요: 0, 에러: '' };
    let p;
    try {
      const pr = h.probe();
      if (!pr || !pr.ok) { st.에러 = pr && pr.reason ? pr.reason : '사용 불가'; return Promise.resolve({ h, agent, aiName, st, raw: [] }); }
      p = Promise.resolve(h.search(persona, { max: opts.max || 30, agent }));
    } catch (e) { st.에러 = e.message; return Promise.resolve({ h, agent, aiName, st, raw: [] }); }
    return withCap(p, AGENT_MS, () => { st.에러 = `시간 초과(${Math.round(AGENT_MS / 1000)}초) — 다음엔 나올 수 있어요`; })
      .then((raw) => {
        if (raw && raw.__err) { st.에러 = raw.__err; raw = []; }
        return { h, agent, aiName, st, raw: Array.isArray(raw) ? raw : [] };
      });
  }));

  // 수확물을 한 곳에서 판별·채점한다(판별을 기자별로 흩뜨리지 않는다)
  for (const { h, aiName, st, raw } of harvest) {
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
  // ── 6) ★선담기 후검수 (2026-07-27 대표님 결정) ──
  //    전에는 여기서 검수AI를 다 돌린 뒤에야 화면에 보냈다. 250건이면 몇 분이 걸려 화면이 멈춘 것처럼 보였다.
  //    이제 발굴은 "담기"까지만 하고 바로 돌려준다. 검수는 화면이 뜬 뒤 백그라운드로 진행한다.
  //    ★한 건도 버리지 않는다 — 다 담고 다 검수한다(저점도 접어서 보여줄 뿐 지우지 않는다).
  //    ★담긴 리드는 아직 '미검수'다 → 화면에서 답글 버튼이 잠긴다(경쟁자에게 답글 다는 사고 방지).
  leads.sort((a, b) => {
    const vOrd = { '고객': 0, '애매': 1 };
    return ((vOrd[a.verdict] != null ? vOrd[a.verdict] : 9) - (vOrd[b.verdict] != null ? vOrd[b.verdict] : 9))
      || ((b.score || 0) - (a.score || 0));
  });
  return { leads, stats, roster: roster(), review: { 담김: leads.length, 검수: '대기' } };
}

/**
 * 🛡️ 사후 검수 — 화면이 담아둔 리드를 조금씩 보내 판정만 받아간다.
 *   ★서버에 리드를 쌓아두지 않는다(제로 인그레스). 판정하고 그 자리에서 버린다.
 *   @param items [{i, text}]
 *   @returns [{i, verdict, why, quote}]
 */
async function reviewBatch(items) {
  const arr = (items || []).filter((x) => x && String(x.text || '').trim()).slice(0, R.BATCH);
  if (!arr.length) return [];
  const tmp = arr.map((x) => ({ text: String(x.text).slice(0, 300) }));
  await R.review(tmp);
  return arr.map((x, n) => Object.assign({ i: x.i }, tmp[n].review || { verdict: '검수불가', why: '판정 없음', quote: '' }));
}

module.exports = { hunters, roster, collect, reviewBatch, verifyReason, reviewer: R };
