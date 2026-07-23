// 모닝 브리핑 단위테스트 — 오늘 이벤트 필터·이모지0 (구글·발송 없음)
'use strict';
const mb = require('./morning_brief');
let pass = 0, fail = 0;
function ok(n, c) { console.log((c ? '✅' : '❌') + ' ' + n); c ? pass++ : fail++; }

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(5, 10);
const [mm, dd] = today.split('-');
const header = ['고객명', '연락처', '만기일', '생년월일', '상담예정'];
const rows = [
  { 고객명: '김철수', 만기일: '2026-' + mm + '-' + dd },      // 오늘 만기
  { 고객명: '홍길동', 생년월일: '1975-' + mm + '-' + dd },    // 오늘 생일
  { 고객명: '이영희', 상담예정: '2026-' + mm + '-' + dd },    // 오늘 상담
  { 고객명: '박영수', 만기일: '2026-01-01' },                 // 무관
];
const loadTable = async () => ({ header, rows, nameCol: '고객명' });

(async () => {
  ok('mmdd YYYY-MM-DD', mb.mmdd('2026-08-20') === '08-20');
  ok('mmdd MM/DD', mb.mmdd('8/9') === '08-09');
  const b = await mb.build(loadTable, {});
  ok('오늘 만기 김철수', /김철수/.test(b.text));
  ok('오늘 생일 홍길동', /홍길동/.test(b.text));
  ok('오늘 상담 이영희', /이영희/.test(b.text));
  ok('무관 박영수 제외', !/박영수/.test(b.text));
  ok('count=3', b.count === 3);
  ok('이모지 0', !/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]/u.test(b.text));
  const b0 = await mb.build(async () => ({ header, rows: [{ 고객명: '박영수', 만기일: '2026-01-01' }], nameCol: '고객명' }), {});
  ok('이벤트0 정직 안내', b0.count === 0 && /없습니다/.test(b0.text));
  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
