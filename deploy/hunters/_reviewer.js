// ─────────────────────────────────────────────────────────────
// hunters/_reviewer.js — 🛡️ 검수AI (기자AI와 완전히 분리된 심사관)
//
// 왜 필요한가(대표님 지적, 실제 위험):
//   발굴 리드에 경쟁자와 잠재고객이 섞여 있었다.
//   ★경쟁자 글에 답글을 달면 민원 소지가 된다. 그래서 "먼저 판별, 통과한 것만 리드"로 순서를 강제한다.
//
// 역할 분리 (신문사):
//   기자AI  = 물어온다 (search)           — 자기가 물어온 걸 스스로 통과시킬 수 없다
//   검수AI  = 통과/탈락을 정한다 (여기)    — 기자와 다른 사람이 본다
//   발행인  = 대표님                       — 검수 통과분만 본다
//
// ★2중 게이트: 규칙(lead_filter)이 1차로 거르고, 검수AI가 2차로 본다.
//   규칙만으로는 "노후 막막하시죠? 제가 도와드립니다" 같은 교묘한 홍보를 다 못 잡는다.
//
// ★환각 금지 장치 (지어내면 통과가 안 되게 설계):
//   ① 검수AI에게 실제 글 본문만 준다(요약·추측 금지)
//   ② 판정 근거로 ★본문에 있는 구절을 그대로 인용하게 한다
//   ③ 그 인용이 본문에 실제로 없으면 → 판정 자체를 버리고 '검수불가'로 떨군다
//      (지어낸 근거로 통과시키는 길을 코드로 막는다)
//
// ★개인정보: 본문·작성자를 서버에 저장하지 않는다. 심사하고 화면으로 흘려보낸다.
// ★게시 함수 없음.
// ─────────────────────────────────────────────────────────────
'use strict';

let _ask = null;   // main_server가 주입하는 LLM 호출 함수(hunters가 API 키를 직접 다루지 않게)
function init(fn) { _ask = fn; }
function ready() { return typeof _ask === 'function'; }

const BATCH = 12;          // 한 번에 심사할 건수(길어지면 판정이 흐려진다)
const REVIEW_MS = Number(process.env.REVIEW_MS) || 15000;   // ★심사관이 안 답하면 여기서 끊는다
const PASS = ['고객'];     // 통과 판정

function _norm(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }

/** 검수 지시문 — 실제 글로만 판단하고, 근거를 본문에서 그대로 인용하게 한다 */
function buildPrompt(items) {
  return `너는 재무설계 회사의 리드 검수관이다. 아래 공개 글 각각을 심사해라.

[판정]
· 고객  = 자기 고민·상황을 말하고 답을 구하는 일반인. "어떻게 해야 할까요" "막막해요" "추천 부탁드려요"
· 공급자 = 자기가 도와주겠다는 사람(설계사·업체·홍보). 연락처·카톡·링크·직함을 남긴다.
          "상담해드립니다" "문의 주세요" "프로필 링크" "○○설계사입니다"
          ★교묘한 형태 주의: 고민에 공감하는 척 시작해 결국 자기 서비스를 권한다 → 공급자다.
· 애매  = 둘 다 아니거나 판단이 어렵다. 감상·잡담·무관한 내용·기사.

★확신이 없으면 '고객'으로 몰지 마라. '애매'로 둔다.
  경쟁자에게 답글을 달면 민원이 된다. 놓치는 것보다 잘못 통과시키는 게 훨씬 나쁘다.

[근거 규칙 — 반드시 지켜라]
"quote"에는 ★그 글에 실제로 적힌 문장을 그대로 복사해 넣어라.
요약·의역·창작 금지. 원문에 없는 글자가 들어가면 그 판정은 버려진다.

JSON 배열만 출력. 설명·인사말 금지.
[{"i":0,"verdict":"고객|공급자|애매","why":"20자 이내 판정 이유","quote":"본문에서 그대로 따온 구절"}]

[글 목록]
${items.map((x, i) => `${i}. ${String(x.text || '').slice(0, 250)}`).join('\n')}`;
}

/** 응답에서 JSON 배열만 뽑아낸다(앞뒤에 말이 붙어도 견디게) */
function parseVerdicts(raw) {
  const s = String(raw || '');
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  try { const j = JSON.parse(s.slice(a, b + 1)); return Array.isArray(j) ? j : null; } catch (e) { return null; }
}

/**
 * 리드 묶음을 심사한다.
 * @returns {{leads:[], stats:{심사, 통과, 탈락_공급자, 보류_애매, 검수불가}}}
 *   각 리드에 review = {verdict, why, quote, by:'검수AI'} 를 붙인다.
 *   ★검수AI가 없거나 실패하면 리드를 버리지 않고 '검수불가'로 표시해 넘긴다.
 *     (버리면 발굴이 0이 되고, 조용히 통과시키면 대표님이 검수된 줄 안다 → 둘 다 나쁘다)
 */
async function review(leads) {
  const stats = { 심사: 0, 통과: 0, 탈락_공급자: 0, 보류_애매: 0, 검수불가: 0 };
  if (!Array.isArray(leads) || !leads.length) return { leads: [], stats };
  if (!ready()) {
    leads.forEach((l) => { l.review = { verdict: '검수불가', why: '검수AI 미연결', quote: '', by: '검수AI' }; stats.검수불가++; });
    return { leads, stats };
  }
  // ★묶음을 동시에 심사한다 — 순차로 돌리면 리드 40건에 30초가 넘어 화면이 멈춘 것처럼 보인다.
  //   ★타임아웃 필수: 심사관이 응답을 안 주면 발굴 전체가 매달린다(2026-07-27 사고).
  const chunks = [];
  for (let i = 0; i < leads.length; i += BATCH) chunks.push(leads.slice(i, i + BATCH));
  const answers = await Promise.all(chunks.map((chunk) => {
    const guard = new Promise((res) => setTimeout(() => res(null), REVIEW_MS));
    return Promise.race([Promise.resolve(_ask(buildPrompt(chunk))).catch(() => null), guard]);
  }));
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const vs = parseVerdicts(answers[ci]);
    if (!vs) {
      chunk.forEach((l) => { l.review = { verdict: '검수불가', why: '심사 실패', quote: '', by: '검수AI' }; stats.검수불가++; });
      continue;
    }
    const byIdx = {};
    vs.forEach((v) => { if (v && Number.isInteger(v.i)) byIdx[v.i] = v; });
    chunk.forEach((l, n) => {
      const v = byIdx[n];
      stats.심사++;
      if (!v || !v.verdict) { l.review = { verdict: '검수불가', why: '판정 누락', quote: '', by: '검수AI' }; stats.검수불가++; stats.심사--; return; }
      // ★환각 차단 — 인용이 본문에 실제로 없으면 판정을 버린다(지어낸 근거로 통과 못 한다)
      const q = String(v.quote || '').trim();
      if (!q || _norm(l.text).indexOf(_norm(q)) < 0) {
        l.review = { verdict: '검수불가', why: '근거를 본문에서 못 찾음', quote: '', by: '검수AI' };
        stats.검수불가++; stats.심사--; return;
      }
      const vd = String(v.verdict).trim();
      l.review = { verdict: vd, why: String(v.why || '').slice(0, 30), quote: q.slice(0, 120), by: '검수AI' };
      if (PASS.indexOf(vd) >= 0) stats.통과++;
      else if (vd === '공급자') stats.탈락_공급자++;
      else stats.보류_애매++;
    });
  }
  return { leads, stats };
}

/** 화면에 내보낼 것만 남긴다 — ★공급자는 무조건 제외(민원 방지) */
function gate(leads) {
  return leads.filter((l) => !l.review || l.review.verdict !== '공급자');
}

module.exports = { init, ready, review, gate, buildPrompt, parseVerdicts, BATCH };
