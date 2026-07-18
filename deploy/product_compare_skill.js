// ─────────────────────────────────────────────────────────────
// product_compare_skill.js — S-5 상품비교 스킬 (독립 모듈, 한 줄 호출) ★v4 🛠️스킬창고 부품
// 무엇을·왜: 보험 제안서 사진(들) → ①담보 분석(Vision) ②재무 적정성(오상열 CFP 공식)
//   ③우선순위 평가(담보>보험료>납입면제) → "이론상 최적안" 근거와 함께 제시.
// 사용: const { compareProducts } = require('.../product_compare_skill');
//        const r = await compareProducts({ images:[{data:base64, mime:'image/jpeg'}], annualIncome, debt });
//        r = { ok, report(마크다운), engine, disclaimer }
//
// ★공통 자산(전 회원 공유·도구). 고객 데이터 아님(도구). /parksugeun·jenya·기존 시트 무접촉.
// ★원칙1(Zero data ingress): 제안서 사진은 호출 인자로만 받아 메모리에서 지니야 눈에 넘기고 버린다.
//   이 모듈은 파일 저장·전역 캐시 0. (서버 디스크에 고객 사진을 쓰지 않는다.)
// ★불변 원칙: 특정 상품 "추천·가입권유" 아님 — 중립 비교. 실제 인수는 청약·심사에서 확정(휴먼인더루프).
//   5단계 완결: 1담보비교(미포함 정직)·2재무적정성(AFPK)·3우선순위·4인수예측(참고·단정금지)·5약관정밀(RAG 연결, 없으면 준비중).
//   4·5단계 재료(인수지침DB·건강약관) 부족분은 "준비 중" 정직 표시. PDF=문서모드, 이미지=Vision.
// ─────────────────────────────────────────────────────────────
'use strict';
try { require('dotenv').config(); } catch (e) {}

const ANSWER_MODEL = 'claude-sonnet-5'; // ★모든 LLM = Claude Sonnet(대표 절대규칙). 날짜접미사 금지.

// ── 2단계 재료: 오상열 CFP 적정 보장 공식 (moneya rag_formulas.json INSURANCE-001/002 원문 — 지어내기 0) ──
//   출처: 오상열CFP_공식집_2026. 수천 청크 이식 대신 "판정에 쓰는 핵심 공식만" 프롬프트에 내장(대표 지시).
const 적정보장기준 = {
  '사망·장해': '연봉 × 3배 + 부채',
  '암 진단금': '연봉 × 2배',
  '뇌혈관 진단금': '연봉 × 1배',
  '심혈관 진단금': '연봉 × 1배',
  '실손의료비': '5,000만원 (이상=있음/미만=없음)',
  '치매·간병': '특약 체크',
  '적정 보험료': '월급여의 8~10% (미혼 1인 5%)',
};
// ── 3단계 재료: 대표님 우선순위 기준 ──
const 우선순위기준 = ['① 담보(보장 충분·넓음)', '② 보험료(같은 보장이면 싼 것)', '③ 납입면제·특약'];

// ★결과물 하단 고정 안내(휴먼인더루프·심사 확정)
const DISCLAIMER =
  '이 비교는 제안서에 보이는 정보 기준의 "이론상 비교"입니다. 실제 인수 가능 여부(정상·할증·거절)는 청약·심사에서 확정되며, 최종 판단·발송은 담당 설계사가 검토해야 합니다.';

let _an = null;
function anthropic() {
  if (!_an) _an = new (require('@anthropic-ai/sdk'))({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _an;
}

// 시스템 프롬프트: 지니야 두뇌가 "데이터(JSON)"만 뽑는다. 화면 골격·표·색은 서버(renderFixedReport)가 코드로 고정 조립.
//   ★왜 JSON인가: LLM이 매번 다른 마크다운을 뱉으면 HTML이 흔들린다 → 데이터만 받아 항상 같은 템플릿에 채운다(고정 템플릿).
function buildSystem(annualIncome, debt) {
  const 연봉 = annualIncome ? `${annualIncome}` : '(미입력)';
  const 부채 = debt ? `${debt}` : '(미입력)';
  const 기준표 = Object.entries(적정보장기준).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
  return `당신은 보험설계사를 돕는 비서 "지니야"입니다. 제안서(PDF/사진)들을 읽고 비교 데이터를 추출합니다.
★출력은 오직 아래 JSON 하나입니다. 설명·인사·마크다운·코드펜스(\`\`\`) 없이 JSON만 출력하세요. "클로드·AI모델·챗봇" 금지 — 당신은 "지니야".

[추출 규칙]
- ★제안서에 그 담보가 아예 없으면 값에 "미포함", 있는데 숫자가 안 보이면 "확인 필요"로 적는다. 지어내기 절대 금지.
- coverage 항목은 이 순서로 채운다(있는 것만): 암진단금, 뇌혈관진단비, 심혈관(허혈성)진단비, 사망·후유장해, 실손의료비, 입원·수술, 납입면제, 그리고 kind="보험료"의 월 보험료, kind="환급"의 해지환급금(환급률·무해지 구분).
- kind는 보장 항목="보장", 월 보험료="보험료", 해지환급금="환급" 셋 중 하나. (행 정렬·색은 시스템이 처리하니 순서는 신경쓰지 말 것)
- vals 배열의 길이·순서는 products 배열과 정확히 일치시킨다.

[2단계 재무 적정성 — 오상열 CFP 공식]
  적정 보장 기준(연봉 기반):
${기준표}
  고객 연봉 = ${연봉} / 부채 = ${부채}.
  - 연봉이 (미입력)이면 adequacy는 빈 배열 []로 두고, adequacyNote에 "연봉을 알려주시면 정확히 계산해드려요"만 넣는다(지어내기 금지).
  - 각 담보를 기준과 대조해 verdict를 "충분"/"부족"/"과다" 중 하나로, reason에 근거를 넣는다.

[3단계 우선순위 — 대표 기준] ${우선순위기준.join(' > ')}
  - best.pick = 이론상 최적 상품명(products 중 하나), best.reasons = 근거 2~3개 배열.
  - "추천·가입권유"가 아니라 "중립 비교"다("가입하세요" 금지, "이론상 이 안이 조건이 낫다").

[4단계 인수 예측 — 참고·판정 아님] underwriting(문자열)에:
  - 심사유형(간편/일반) 기반 참고만. ★"A사 거절/B사 통과" 식 단정 금지. 병력 모르면 "고혈압·당뇨 등 병력이 있으면 알려주세요"라고 되묻기.

[출력 JSON 스키마]
{
  "products": ["상품명/보험사1", "상품명/보험사2"],
  "coverage": [
    {"item": "암진단금", "kind": "보장", "vals": ["5,000만원", "3,000만원"]},
    {"item": "월 보험료", "kind": "보험료", "vals": ["12.4만원", "9.8만원"]},
    {"item": "해지환급금", "kind": "환급", "vals": ["무해지(0원)", "환급률 82%"]}
  ],
  "adequacy": [{"item": "암진단금", "verdict": "부족", "reason": "연봉×2배 기준 대비 부족"}],
  "adequacyNote": "",
  "best": {"pick": "상품명1", "reasons": ["보장이 넓다", "암진단금이 크다"]},
  "underwriting": "두 상품 모두 일반심사형 — 병력이 있으면 알려주세요."
}
★JSON만 출력. 다른 텍스트 절대 금지.`;
}

// ── JSON → 고정 골격 마크다운 (결정론·코드 조립). LLM 순서 무관하게 항상 같은 표·섹션·행순서 ──
function renderFixedReport(data) {
  const d = data || {};
  const products = Array.isArray(d.products) && d.products.length ? d.products : ['상품A', '상품B'];
  const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '/').replace(/\n/g, ' ').trim();
  const n = products.length;
  const out = [];

  // 1단계 · 담보 비교 (행 순서 고정: 보장 → 보험료 → 환급)
  out.push('## 📊 1단계 · 담보 비교');
  out.push('| 항목 | ' + products.map(esc).join(' | ') + ' |');
  out.push('|---|' + products.map(() => '---').join('|') + '|');
  const cov = Array.isArray(d.coverage) ? d.coverage : [];
  const order = { '보장': 0, '보험료': 1, '환급': 2 };
  const rows = cov.slice().sort((a, b) => (order[(a && a.kind) || '보장'] ?? 0) - (order[(b && b.kind) || '보장'] ?? 0));
  if (!rows.length) {
    out.push('| _제안서에서 담보를 읽지 못했어요_ | ' + products.map(() => '확인 필요').join(' | ') + ' |');
  } else {
    rows.forEach((r) => {
      const vals = Array.isArray(r.vals) ? r.vals.slice(0, n) : [];
      while (vals.length < n) vals.push('확인 필요');
      out.push('| ' + esc(r.item) + ' | ' + vals.map(esc).join(' | ') + ' |');
    });
  }

  // 2단계 · 재무 적정성
  out.push('\n## 🧮 2단계 · 재무 적정성 (오상열 CFP 공식)');
  const adq = Array.isArray(d.adequacy) ? d.adequacy : [];
  if (adq.length) {
    out.push('| 담보 | 판정 | 근거 |');
    out.push('|---|---|---|');
    adq.forEach((a) => out.push('| ' + esc(a.item) + ' | ' + esc(a.verdict) + ' | ' + esc(a.reason) + ' |'));
  } else {
    out.push(esc(d.adequacyNote) || '연봉을 알려주시면 담보가 충분한지 정확히 계산해드려요.');
  }

  // 3단계 · 이론상 최적안
  out.push('\n## 🏆 3단계 · 이론상 최적안');
  const best = d.best || {};
  out.push('**이론상 최적 = ' + (esc(best.pick) || '판단 보류') + '**');
  const reasons = Array.isArray(best.reasons) ? best.reasons : [];
  if (reasons.length) reasons.forEach((r) => out.push('- ' + esc(r)));
  else out.push('- 근거를 정리하지 못했어요 — 담보·보험료를 다시 확인해 주세요.');

  // 4단계 · 인수 예측
  out.push('\n## 🔎 4단계 · 인수 예측 (참고)');
  out.push((esc(d.underwriting) || '심사유형 정보가 부족해요. 병력(고혈압·당뇨 등)이 있으면 알려주시면 더 정확히 참고해드려요.'));
  out.push('_회사별 정밀 인수지침(고지항목 DB)은 아직 준비 중이에요._');

  return out.join('\n');
}

// JSON 추출(코드펜스·앞뒤 잡텍스트 방어) → 파싱. 실패 시 null
function _extractJson(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const s = t.indexOf('{'); const e = t.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch (err) { return null; }
}

/** 제안서(PDF·이미지)들 → 김명란 5단계 비교 리포트. images=[{data:base64, mime}] */
async function compareProducts(input) {
  const { images, annualIncome, debt } = input || {};
  const imgs = Array.isArray(images) ? images.filter((x) => x && x.data) : [];
  if (!imgs.length) throw new Error('제안서 파일(images)이 비어있음');

  // ★크기 가드(대표 실패 케이스: 큰 PDF). base64 char*0.75 ≈ bytes. Claude 요청 한계 방어
  const totalMB = imgs.reduce((s, im) => s + (im.data ? im.data.length * 0.75 : 0), 0) / (1024 * 1024);
  if (totalMB > 20) {
    return { ok: false, report: `제안서 파일이 너무 커요(총 약 ${Math.round(totalMB)}MB). 담보·보험료가 보이는 핵심 페이지만 골라서 올려주시면 바로 비교해드릴게요.`, disclaimer: DISCLAIMER };
  }

  // 파일별 종류 그대로: PDF→문서모드, 이미지→Vision. 못 읽는 형식은 정직하게 표시
  const content = []; const bad = [];
  imgs.forEach((im, i) => {
    const mime = String(im.mime || 'image/jpeg').toLowerCase();
    if (mime === 'application/pdf' || /pdf/.test(mime)) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: im.data } });
    } else if (/^image\//.test(mime)) {
      const mt = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime) ? mime : 'image/jpeg';
      content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: im.data } });
    } else { bad.push(`제안서 ${i + 1}(${mime || '알 수 없음'})`); return; }
    content.push({ type: 'text', text: `— 위는 제안서 ${i + 1} 입니다.` });
  });
  if (!content.some((c) => c.type === 'document' || c.type === 'image')) {
    return { ok: false, report: `올려주신 파일을 읽지 못했어요(${bad.join(', ')}). 제안서는 이미지(jpg·png)나 PDF로 올려주세요.`, disclaimer: DISCLAIMER };
  }
  content.push({ type: 'text', text: '위 제안서(들)를 읽고, 시스템이 지정한 JSON 스키마 하나만 출력해 주세요. (JSON 외 텍스트·코드펜스 금지)' });

  const system = buildSystem(annualIncome, debt);
  let report = '';
  try {
    const r = await anthropic().messages.create({ model: ANSWER_MODEL, max_tokens: 8000, system, messages: [{ role: 'user', content }] });
    const raw = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!raw) throw new Error('빈 응답');
    // ★고정 템플릿: JSON 데이터 → 코드로 항상 같은 골격 마크다운 조립. 파싱 실패 시에만 원문 폴백(양식은 흔들려도 내용은 살림)
    const data = _extractJson(raw);
    report = data ? renderFixedReport(data) : raw;
  } catch (e) {
    const hint = /too large|maximum|size|token|payload|400/i.test(e.message || '') ? ' (제안서 PDF가 크거나 페이지가 많은 것 같아요 — 담보·보험료 핵심 페이지만 올려보세요)' : '';
    return { ok: false, error: e.message, report: '제안서 분석 중 문제가 생겼어요' + hint + '. 파일을 확인하고 다시 시도해 주세요.', disclaimer: DISCLAIMER };
  }

  // ★5단계 · 약관 정밀 — 약관 RAG(/api/yakgwan 모듈) 연결. 있는 상품군만 정직하게, 없으면 준비 중
  let yak = '\n\n## 📄 5단계 · 약관 정밀 보완\n';
  try {
    const { askYakgwan } = require('./yakgwan_module');
    const yr = await askYakgwan('암 진단비 지급 조건과 면책 기간');
    // ★현재 약관 창고=자동차보험만. 건강·생명 제안서엔 매칭 안 됨 → 미스매치 답(자동차/없어요) 노출 금지, 깔끔히 "준비 중". 관련 약관 생기면 자동으로 근거 표시
    const 관련없음 = !yr || !yr.found || /없어요|원문 확인이 필요|관련이 없|자동차보험|자동차보험/.test(yr.answer || '');
    if (!관련없음) { yak += yr.answer + '\n\n_근거: ' + ((yr.sources || []).join(', ') || '약관') + '_\n'; }
    else { yak += '위 제안서(건강·생명)의 약관 정밀 대조는 **아직 준비 중**이에요. 현재 약관 창고엔 삼성화재 자동차보험 약관만 있어, 해당 상품군 약관을 수집하면 근거·페이지까지 대조해드릴게요. (없는 내용을 지어내지 않습니다)\n'; }
  } catch (e) { yak += '약관 자료 준비 중입니다.\n'; }

  report = report + yak + '\n---\n' + DISCLAIMER;
  return { ok: true, report, engine: 'claude-sonnet-5', disclaimer: DISCLAIMER };
}

module.exports = { compareProducts, renderFixedReport, _extractJson, 적정보장기준, 우선순위기준, DISCLAIMER };

// ── 자체 시연(구조만; 실제 호출은 배포 API에서) ──
if (require.main === module) {
  console.log('⚖️ 상품비교 스킬 — 적정보장 기준:');
  Object.entries(적정보장기준).forEach(([k, v]) => console.log(`   ${k}: ${v}`));
  console.log('   우선순위:', 우선순위기준.join(' > '));
}
