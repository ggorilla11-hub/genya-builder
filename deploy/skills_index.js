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

const list = [
  { id: 'pdf', ico: '📄', name: 'PDF 스킬', desc: '증권·약관·청구서 읽기 + 생성', fns: Object.keys(pdf) },
  { id: 'excel', ico: '📊', name: '엑셀 스킬', desc: '고객명단·3사 비교표 자동 제작', fns: Object.keys(excel) },
  { id: 'ppt', ico: '📽️', name: 'PPT 스킬', desc: '세미나·제안서 슬라이드', fns: Object.keys(ppt) },
  { id: 'doc', ico: '📝', name: '문서 스킬', desc: '상담 보고서·안내문', fns: Object.keys(doc) },
];

module.exports = { pdf, excel, ppt, doc, list };

if (require.main === module) {
  console.log('🛠️ 스킬창고 — 장착된 스킬 ' + list.length + '종:');
  list.forEach((s) => console.log(`  ${s.ico} ${s.name} — ${s.desc}  [${s.fns.join(', ')}]`));
}
