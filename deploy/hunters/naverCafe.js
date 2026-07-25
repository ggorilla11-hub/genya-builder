// hunters/naverCafe.js — 🟩 네이버 카페 담당 기자
// ★합법: 네이버 공식 검색 API(cafearticle)의 공개 글만 읽는다. 크롤링·로그인 우회 없음.
// ★게시 함수 없음 — 답글은 초안까지, 게시는 사람이 직접.
// 기대 수확: 카페는 "고민 상담 글"이 많아 지식iN 다음으로 리드 밀도가 높다.
//   단 신혼·재테크 카페엔 설계사 홍보글도 많다 → 경쟁자 필터가 걸러낸 수를 화면에서 확인하시라.
'use strict';
const N = require('./_naverApi');

const agents = [
  { name: '네이버카페AI-1', beat: ['신혼부부 재테크 고민', '결혼 준비 비용', '신혼집 자금'], persona: '공감형 — 카페 고민글의 막막함을 먼저 읽는다' },
  { name: '네이버카페AI-2', beat: ['30대 재무상담', '목돈 모으기', '보험 리모델링 고민'], persona: '꼼꼼형 — 금액·시기가 적힌 글을 고른다' },
];

module.exports = N.makeNaverHunter({
  key: 'naverCafe',
  label: '🟩 네이버 카페',
  path: 'cafearticle.json',
  idPrefix: 'NC',
  agents,
  fallbackKw: ['신혼부부 재테크 고민', '30대 재무상담', '목돈 모으기'],
  authorOf: (it) => N.clean(it.cafename || ''),   // 카페 이름(개인 신원 아님)
  postedAtOf: () => '',                            // 카페 검색은 작성일을 안 준다(sort=date로 최신순만 보장)
  defaultWhy: '카페 고민글 = 답을 구하는 사람',
  signal: '카페 고민글',
  draftGuide: '카페 댓글체로 3~4문장. 질문에 먼저 직접 답하고 → 놓치기 쉬운 점 하나 → 무료 진단 제안 → [링크]. '
    + '광고 느낌·강매·전화번호 금지(카페는 홍보 댓글을 강하게 제재한다).',
});
