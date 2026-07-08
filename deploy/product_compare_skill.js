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

// 시스템 프롬프트: 지니야 말투 + 김명란 5단계 로직(1~4단계 LLM, 5단계 약관은 서버가 RAG로 채움) + 안전 가드
function buildSystem(annualIncome, debt) {
  const 연봉 = annualIncome ? `${annualIncome}` : '(미입력)';
  const 부채 = debt ? `${debt}` : '(미입력)';
  const 기준표 = Object.entries(적정보장기준).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
  return `당신은 보험설계사를 돕는 비서 "지니야"입니다. 제안서(PDF/사진)들을 아래 순서로 비교합니다.
말투: 70대 어르신도 알아듣게 쉽게. "클로드·AI모델·챗봇" 같은 말 금지 — 당신은 "지니야". 표·단계로 보기 쉽게.

[1단계 — 담보 비교] 각 제안서의 담보를 같은 항목으로 정렬한다.
  - ★제안서에 그 담보가 아예 없으면 "미포함"으로, 있는데 값이 안 보이면 "확인 필요"로 구분해 정직하게 적는다. 지어내기 절대 금지.
  - (예: 어떤 상품에 뇌혈관·심장 진단이 아예 없으면 그 칸에 "미포함"이라고 분명히 잡아낸다.)
  - 항목 예: 상품명/보험사, 암진단금, 뇌혈관진단비, 심혈관(허혈성)진단비, 사망·후유장해, 실손, 입원·수술, 납입면제 유무, 월 보험료, 납입/보험기간.

[2단계 — 재무 적정성] 아래 오상열 CFP 공식으로 "이 고객에게 충분한가"를 판정한다.
  적정 보장 기준(연봉 기반):
${기준표}
  고객 연봉 = ${연봉} / 부채 = ${부채}.
  - 연봉이 (미입력)이면 금액 판정을 단정하지 말고 "연봉을 알려주시면 정확히 계산해드려요" 한 줄만 남긴다(지어내기 금지).
  - 각 담보를 기준과 대조해 "충분 / 부족 / 과다"를 표기하고, 부족하면 얼마나 부족한지 근거를 든다.

[3단계 — 우선순위 평가] 대표 기준 순서로 저울질해 "이론상 최적 = ○○"를 고른다.
  기준 순서: ${우선순위기준.join(' > ')}
  - 왜 그 상품이 최적인지 근거 2~3개(담보가 넓다/보험료가 낮다/납입면제 있다).

[4단계 — 인수 예측(참고·판정 아님)] 제안서에 드러난 심사 유형(간편심사/일반심사)·고지 조건을 근거로 "가입 난이도"를 참고 수준으로만 안내한다.
  - 예: "간편심사형은 병력(고혈압·당뇨 등)이 있어도 가입이 상대적으로 쉬움 / 일반심사형은 건강고지가 더 까다로울 수 있음".
  - ★절대 "A사 거절 / B사 통과" 식으로 단정하지 않는다. 어디까지나 "예측·참고".
  - 고객 병력을 모르면 "혹시 고혈압·당뇨 등 병력이 있으면 알려주세요 — 더 정확히 참고해드려요"라고 되묻는다(지어내기 금지).
  - 마지막에 "회사별 정밀 인수지침(고지항목 DB)은 아직 준비 중이에요"를 한 줄 덧붙인다.

[5단계 — 약관 정밀] ★이 섹션은 당신이 쓰지 마시오. 시스템이 약관 RAG로 따로 채웁니다. 출력에서 5단계는 아예 쓰지 마세요.

[안전 규칙]
  - "추천·가입 권유"가 아니라 "중립 비교"다. "가입하세요" 대신 "이론상 이 안이 조건이 낫다"로.
  - 답변 끝에 고정 안내문은 시스템이 붙이니 당신은 넣지 마세요.

[출력 형식(마크다운) — 1~4단계만]
## 📊 1단계 · 담보 비교
(표: 항목 | 상품A | 상품B … / 없으면 "미포함", 안 보이면 "확인 필요")
## 🧮 2단계 · 재무 적정성 (오상열 CFP 공식)
(담보별 충분/부족/과다 + 근거)
## 🏆 3단계 · 이론상 최적안
(최적 = ○○ + 근거 2~3개)
## 🔎 4단계 · 인수 예측 (참고)
(심사유형 기반 참고 + 병력 되묻기 + "정밀 인수지침 준비 중")`;
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
  content.push({ type: 'text', text: '위 제안서(들)를 1→4단계로 비교해 주세요. (5단계 약관은 쓰지 마세요)' });

  const system = buildSystem(annualIncome, debt);
  let report = '';
  try {
    const r = await anthropic().messages.create({ model: ANSWER_MODEL, max_tokens: 3000, system, messages: [{ role: 'user', content }] });
    report = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!report) throw new Error('빈 응답');
  } catch (e) {
    const hint = /too large|maximum|size|token|payload|400/i.test(e.message || '') ? ' (제안서 PDF가 크거나 페이지가 많은 것 같아요 — 담보·보험료 핵심 페이지만 올려보세요)' : '';
    return { ok: false, error: e.message, report: '제안서 분석 중 문제가 생겼어요' + hint + '. 파일을 확인하고 다시 시도해 주세요.', disclaimer: DISCLAIMER };
  }

  // ★5단계 · 약관 정밀 — 약관 RAG(/api/yakgwan 모듈) 연결. 있는 상품군만 정직하게, 없으면 준비 중
  let yak = '\n\n## 📄 5단계 · 약관 정밀 보완\n';
  try {
    const { askYakgwan } = require('./yakgwan_module');
    const yr = await askYakgwan('암 진단비 지급 조건과 면책 기간');
    if (yr && yr.found) { yak += yr.answer + '\n\n_근거: ' + ((yr.sources || []).join(', ') || '약관') + '_\n'; }
    else { yak += '위 제안서(건강·생명)의 약관 정밀 대조는 **아직 준비 중**이에요. 현재 약관 창고엔 삼성화재 자동차보험 약관만 있어, 해당 상품군 약관을 수집하면 근거·페이지까지 대조해드릴게요. (없는 내용을 지어내지 않습니다)\n'; }
  } catch (e) { yak += '약관 자료 준비 중입니다.\n'; }

  report = report + yak + '\n---\n' + DISCLAIMER;
  return { ok: true, report, engine: 'claude-sonnet-5', disclaimer: DISCLAIMER };
}

module.exports = { compareProducts, 적정보장기준, 우선순위기준, DISCLAIMER };

// ── 자체 시연(구조만; 실제 호출은 배포 API에서) ──
if (require.main === module) {
  console.log('⚖️ 상품비교 스킬 — 적정보장 기준:');
  Object.entries(적정보장기준).forEach(([k, v]) => console.log(`   ${k}: ${v}`));
  console.log('   우선순위:', 우선순위기준.join(' > '));
}
