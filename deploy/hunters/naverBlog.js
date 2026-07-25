// hunters/naverBlog.js — 🔵 네이버 블로그 담당 기자
// ★합법: 네이버 공식 검색 API(blog)의 공개 글만 읽는다. 크롤링·로그인 우회 없음.
// ★게시 함수 없음 — 답글은 초안까지, 게시는 사람이 직접.
// 기대 수확: 낮다. 블로그는 상당수가 업체·설계사 홍보글이라 경쟁자 필터에서 많이 걸러진다.
//   대신 "결혼 준비 일기·가계부 기록" 같은 개인 기록에서 진짜 고민이 나온다 → 그쪽을 노린다.
'use strict';
const N = require('./_naverApi');

const agents = [
  { name: '네이버블로그AI-1', beat: ['신혼 살림 준비 기록', '결혼 준비 가계부', '신혼부부 월급 관리'], persona: '기록형 — 홍보글이 아닌 개인 기록을 고른다' },
  { name: '네이버블로그AI-2', beat: ['30대 재테크 고민', '노후 준비 걱정', '연금저축 고민'], persona: '탐색형 — 넓게 훑어 놓친 고민을 줍는다' },
];

module.exports = N.makeNaverHunter({
  key: 'naverBlog',
  label: '🔵 네이버 블로그',
  path: 'blog.json',
  idPrefix: 'NB',
  agents,
  fallbackKw: ['신혼 살림 준비 기록', '30대 재테크 고민', '노후 준비 걱정'],
  authorOf: (it) => N.clean(it.bloggername || ''),
  postedAtOf: (it) => N.ymd(it.postdate),          // 블로그만 작성일을 준다 → 최신 글에 가점
  defaultWhy: '개인 기록에 드러난 재무 고민',
  signal: '블로그 개인기록',
  draftGuide: '블로그 댓글체로 2~3문장. 글 내용을 먼저 짚어 공감하고 → 도움될 한 가지 → 무료 진단 제안 → [링크]. '
    + '광고 느낌·강매·전화번호 금지.',
});
