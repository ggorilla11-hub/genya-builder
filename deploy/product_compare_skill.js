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
//   4단계(인수판단)·5단계(약관정밀)는 이번 버전 미제공 → "준비 중"으로만 표시(예측·단정 금지).
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

// 시스템 프롬프트: 지니야 말투 + 1·2·3단계 로직 + 안전 가드
function buildSystem(annualIncome, debt) {
  const 연봉 = annualIncome ? `${annualIncome}` : '(미입력)';
  const 부채 = debt ? `${debt}` : '(미입력)';
  const 기준표 = Object.entries(적정보장기준).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
  return `당신은 보험설계사를 돕는 비서 "지니야"입니다. 아래 순서로 제안서(사진)를 비교합니다.
말투: 70대 어르신도 알아듣게 쉽게. "클로드·AI모델·챗봇" 같은 말 금지 — 당신은 "지니야". 표·단계로 보기 쉽게.

[1단계 — 담보 분석] 사진에 보이는 담보만 뽑아 상품끼리 같은 항목으로 정렬한다.
  - 반드시 사진에 있는 값만. 안 보이면 "사진에서 확인 안 됨"으로 표기(지어내기 절대 금지).
  - 항목 예: 상품명/보험사, 암진단금, 뇌혈관진단비, 심혈관(허혈성)진단비, 사망·후유장해, 실손, 입원·수술, 납입면제 유무, 월 보험료, 납입/보험기간.

[2단계 — 재무 적정성] 아래 오상열 CFP 공식으로 "이 고객에게 충분한가"를 판정한다.
  적정 보장 기준(연봉 기반):
${기준표}
  고객 연봉 = ${연봉} / 부채 = ${부채}.
  - 연봉이 (미입력)이면 금액 판정을 단정하지 말고 "연봉을 알려주시면 정확히 계산" 한 줄만 남긴다.
  - 각 담보를 기준과 대조해 "충분 / 부족 / 과다"를 표기하고, 부족하면 얼마나 부족한지 근거를 든다.

[3단계 — 우선순위 평가] 대표 기준 순서로 두 상품을 저울질해 "이론상 최적 = ○○"를 고른다.
  기준 순서: ${우선순위기준.join(' > ')}
  - 왜 그 상품이 최적인지 근거 2~3개(어느 담보가 넓다/보험료가 낮다/납입면제 있다).

[4·5단계 — 준비 중] "④ 인수 판단(병력→회사별 예측)"과 "⑤ 약관 정밀 보완"은 준비 중이라고만 짧게 표시한다.
  - 절대 인수 가능/거절을 단정하지 않는다.

[안전 규칙]
  - 특정 상품 "추천·가입 권유"가 아니라 "중립 비교"다. "가입하세요" 대신 "이론상 이 안이 조건이 낫다"로.
  - 구체 지급조건·특약 세부는 "약관 확인 필요"로 남긴다(약관 정밀은 준비 중).
  - 답변 맨 끝에 다음 문장을 그대로 붙인다: "${DISCLAIMER}"

[출력 형식(마크다운)]
## 📊 담보 비교
(표: 항목 | 상품A | 상품B)
## 🧮 재무 적정성 (오상열 CFP 공식)
(담보별 충분/부족/과다 + 근거)
## 🏆 이론상 최적안
(최적 = ○○ + 근거 2~3개)
## ⏳ 다음 단계 (준비 중)
- ④ 인수 판단(병력→회사별 예측) · ⑤ 약관 정밀 보완
(마지막 줄: 위 고정 안내문)`;
}

/** 제안서 사진(들) → 1·2·3단계 비교 리포트. images=[{data:base64, mime}] */
async function compareProducts(input) {
  const { images, annualIncome, debt } = input || {};
  const imgs = Array.isArray(images) ? images.filter((x) => x && x.data) : [];
  if (!imgs.length) throw new Error('제안서 사진(images)이 비어있음');

  // 사진·PDF → Claude content 블록(메모리에서만; 저장 0)
  const content = [];
  imgs.forEach((im, i) => {
    const mime = String(im.mime || 'image/jpeg').toLowerCase();
    if (mime === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: im.data } });
    } else {
      const mt = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime) ? mime : 'image/jpeg';
      content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: im.data } });
    }
    content.push({ type: 'text', text: `— 위는 제안서 ${i + 1} 입니다.` });
  });
  content.push({ type: 'text', text: '위 제안서(들)를 1→2→3단계로 비교해 주세요.' });

  const system = buildSystem(annualIncome, debt);
  let report = '';
  try {
    const r = await anthropic().messages.create({
      model: ANSWER_MODEL,
      max_tokens: 2500,
      system,
      messages: [{ role: 'user', content }],
    });
    report = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!report) throw new Error('빈 응답');
  } catch (e) {
    return { ok: false, error: e.message, report: '지금 제안서 분석이 잠깐 어려워요 — 잠시 후 다시 시도해 주세요.', disclaimer: DISCLAIMER };
  }
  return { ok: true, report, engine: 'claude-sonnet-5', disclaimer: DISCLAIMER };
}

module.exports = { compareProducts, 적정보장기준, 우선순위기준, DISCLAIMER };

// ── 자체 시연(구조만; 실제 호출은 배포 API에서) ──
if (require.main === module) {
  console.log('⚖️ 상품비교 스킬 — 적정보장 기준:');
  Object.entries(적정보장기준).forEach(([k, v]) => console.log(`   ${k}: ${v}`));
  console.log('   우선순위:', 우선순위기준.join(' > '));
}
