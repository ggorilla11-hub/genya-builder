// ─────────────────────────────────────────────────────────────
// skills_index.js — 🛠️스킬창고 (독립 모듈 4종 통합) ★v4 스킬창고에 "꽂는" 진입점
// 무엇을·왜: 약관창고(askYakgwan)처럼, 스킬창고도 한 줄 require로 4개 스킬을 꽂는다.
// 사용: const skills = require('.../skills_index');
//        await skills.pdf.makePdf(...); skills.excel.makeSheet(...);
//        skills.list  // v4 🛠️스킬창고 카드가 "4개 스킬 장착됨"으로 표시할 메타
// ★공통 자산(전 회원 공유·도구). 고객 데이터 아님. /parksugeun 무접촉.
// ─────────────────────────────────────────────────────────────
'use strict';

const pdf = require('./pdf_skill');     // { readPdf, makePdf }
const excel = require('./excel_skill'); // { readXlsx, makeSheet }
const ppt = require('./ppt_skill');     // { makeDeck }
const doc = require('./doc_skill');     // { makeDoc }
const compare = require('./product_compare_skill'); // { compareProducts } ★S-5 상품비교(제안서 담보비교+적정성+우선순위)
const policy = require('./policy_analysis_skill'); // { analyzePolicy } ★배선A 증권분석비서(유형판별+보장분석+제안+HTML)
const pension = require('./pension_analysis_skill'); // { analyzePension } ★배선B 연금분석제안비서(설계서2개→표지있는 연금 제안서)
const manage = require('./client_mgmt_skill');     // { analyzeManagement } ★고객관리비서 관리-1(엑셀 헤더→부족 관리항목 리딩·결정적)

const list = [
  { id: 'pdf', ico: '📄', name: 'PDF 스킬', desc: '증권·약관·청구서 읽기 + 생성', fns: Object.keys(pdf) },
  { id: 'excel', ico: '📊', name: '엑셀 스킬', desc: '고객명단·3사 비교표 자동 제작', fns: Object.keys(excel) },
  { id: 'ppt', ico: '📽️', name: 'PPT 스킬', desc: '세미나·제안서 슬라이드', fns: Object.keys(ppt) },
  { id: 'doc', ico: '📝', name: '문서 스킬', desc: '상담 보고서·안내문', fns: Object.keys(doc) },
  { id: 'compare', ico: '⚖️', name: '상품비교 스킬', desc: '제안서 담보 비교 + 적정성·우선순위(이론상 최적)', fns: Object.keys(compare) },
  { id: 'policy', ico: '🛡️', name: '증권분석비서', desc: '증권 유형 자동판별 + 보장분석(필요·준비·부족) + 상품제안 + 코치 완성본 HTML', fns: Object.keys(policy) },
  { id: 'pension', ico: '📊', name: '연금분석제안비서', desc: '변액연금 설계서 2개 → 표지 있는 연금 제안서(노후공백·2상품비교·수령 시뮬 그래프·성향추천)', fns: Object.keys(pension) },
  { id: 'manage', ico: '📇', name: '고객관리비서', desc: '엑셀 명단 헤더 진단 → 부족 관리항목 리딩(만기·체결일·생일·상품·월납료·가족 등)', fns: Object.keys(manage) },
];

module.exports = { pdf, excel, ppt, doc, compare, policy, pension, manage, list };

if (require.main === module) {
  console.log('🛠️ 스킬창고 — 장착된 스킬 ' + list.length + '종:');
  list.forEach((s) => console.log(`  ${s.ico} ${s.name} — ${s.desc}  [${s.fns.join(', ')}]`));
}
