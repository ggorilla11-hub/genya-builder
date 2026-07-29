// ─────────────────────────────────────────────────────────────
// yakgwan_module.js — 약관 창고(RAG) ★메인에 "꽂는" 부품
// 무엇을·왜: 약관 질문 → 근거 검색 → 쉽게 설명 + 출처(페이지).
//   창고에 없으면 지어내지 않고 "확인 필요". 어디서든 require 한 줄로 꽂아 쓴다.
//
// ★★2026-07-29 속을 갈아끼웠다 (대표님 승인 · 겉모습은 그대로)
//   [사고] 예전엔 네임스페이스가 한 줄로 박혀 있었다:
//            const NAMESPACE = 'yakgwan_samsung_auto_2025';   // 575개
//          그런데 파인콘엔 실제로 ★631,026개(약관 68종 · 보험사 5곳)가 있었다. ★0.09%만 쓰고 있었고,
//          실손·장기·현대해상을 물어도 "약관에 없어요"라고 ★거짓 안내를 해 왔다.
//   [수정] 검색을 공용 엔진 yakgwan_search.js 로 옮겼다. 이 파일은 ★겉모습만 유지하는 얇은 껍데기다.
//          → askYakgwan(질문)의 입력·출력이 예전과 같아서 ★호출하는 5곳을 하나도 고치지 않았다.
//            (main_server 2곳 · policy_analysis_skill · product_compare_skill · 대화 라우터)
//
// 사용: const { askYakgwan } = require('.../yakgwan_module'); const r = await askYakgwan('무보험차상해?');
//        r = { found, answer, sources:['삼성화재 … p.27'], pages:[27,…] }
//   ★새로 쓰는 곳은 공용 엔진을 바로 쓰는 편이 낫다(보험사·상품군 지정, 원문 발췌까지 받음):
//        const yak = require('./yakgwan_search'); await yak.search({ 질문, 보험사, 상품군 });
//
// ★공통 자산(전 회원 공유 지식) — 고객 데이터 아님. 공개약관·참조용·출처표시. /parksugeun 무접촉.
// ★격리: 인덱스 'genya-knowledge'의 ★약관 네임스페이스(yakgwan_*)만 읽는다.
//        개인 기억(owner_*)은 쳐다보지도 않는다. 쓰기·삭제 코드 없음(읽기 전용).
// ─────────────────────────────────────────────────────────────
'use strict';
try { require('dotenv').config(); } catch (e) {}

const yak = require('./yakgwan_search');   // 📚 공용 약관 검색 엔진(공동 자산)

// ★예전 이름 유지 — 이 값을 참조하는 곳이 있어도 깨지지 않게 둔다.
//   다만 이제 "창고 = 자동차보험 하나"가 아니다. 창고 전체를 뜻하는 이름으로 바꿨다.
const SOURCE = '보험 약관 창고(삼성화재·현대해상·KB손해보험·흥국화재·AXA)';
const NAMESPACE = 'yakgwan_*';             // ★더 이상 한 곳이 아니다(질문에 따라 자동 선택)

/**
 * 약관 질문 → 근거+출처 답. 창고에 없으면 found=false + "확인 필요".
 * ★입력·출력 모양은 예전과 같다(호출부 무접촉).
 * @param {string} question
 * @param {object} [opts] { 보험사, 상품군, topK } — 안 줘도 질문에서 알아서 찾는다
 */
async function askYakgwan(question, opts) {
  if (!question || !String(question).trim()) throw new Error('question 비어있음');
  return yak.ask(String(question), opts || {});
}

module.exports = {
  askYakgwan,
  SOURCE, NAMESPACE,
  // ★문 열어두기: 새로 만드는 기능은 이걸 바로 써도 된다(원문 발췌·보험사 지정 가능)
  search: yak.search, 창고요약: yak.창고요약, 지도: yak.지도,
};
