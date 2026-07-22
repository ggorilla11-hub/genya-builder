// 명단 임포트 단위테스트 — 파싱·중복검사·교체·추가 (실 구글 없음)
'use strict';
const roster = require('./roster_import');
const crud = require('./sheets_crud_skill');
let pass = 0, fail = 0;
function ok(n, c, x) { console.log((c ? '✅' : '❌') + ' ' + n + (c ? '' : '  ' + (x || ''))); c ? pass++ : fail++; }

// 기존 명단(홍길동 존재) — crud.loadTable 오버라이드
crud.loadTable = async () => ({ header: ['고객명', '연락처'], rows: [{ 고객명: '홍길동', 연락처: '010-0' }], nameCol: '고객명' });

// 가짜 시트(교체/추가 기록)
let store = []; const calls = [];
const fakeSheets = { spreadsheets: {
  values: {
    get: async ({ range }) => ({ data: { values: /A1:1/.test(range) ? (store.length ? [store[0]] : []) : store.map((r) => r.slice()) } }),
    update: async ({ range, requestBody }) => { calls.push('update'); if (/!A1$/.test(range)) { store = requestBody.values.map((r) => r.slice()); } return {}; },
    append: async ({ requestBody }) => { calls.push('append'); requestBody.values.forEach((r) => store.push(r.slice())); return {}; },
    clear: async () => { calls.push('clear'); store = []; return {}; },
  },
} };
roster.init({ getMemberSheet: async () => ({ id: 'x', sheets: fakeSheets }), ensureTab: async () => {} });

// CSV → base64 (헤더 고객명·연락처·만기일 / 홍길동=중복, 신규A·신규B=신규)
const csv = '고객명,연락처,만기일\n홍길동,010-1,2026-08\n신규A,010-9,2026-09\n신규B,010-8,2026-10\n';
const dataUrl = 'data:text/csv;base64,' + Buffer.from(csv, 'utf8').toString('base64');

(async () => {
  // 1) 파싱
  const p = roster.parse(dataUrl);
  ok('parse 헤더 3개', p.header.length === 3 && p.header[0] === '고객명', JSON.stringify(p.header));
  ok('parse 3행', p.rows.length === 3, 'rows=' + p.rows.length);

  // 2) 미리보기 — 신규 2 / 중복 1(홍길동)
  const pv = await roster.importRoster({}, { dataUrl });
  ok('미리보기 needsConfirm', pv.needsConfirm === true);
  ok('신규 2명', pv.신규 === 2, '신규=' + pv.신규);
  ok('중복 1명(홍길동)', pv.중복 === 1 && pv.중복명단[0] === '홍길동', JSON.stringify(pv.중복명단));

  // 3) 교체(replace) — clear 후 header+3행
  store = [['고객명', '연락처'], ['옛사람', '010-x']]; calls.length = 0;
  const rep = await roster.importRoster({}, { dataUrl, mode: 'replace', confirm: true });
  ok('replace ok·3명', rep.ok && rep.imported === 3, JSON.stringify(rep));
  ok('replace clear 호출', calls.includes('clear'));
  ok('replace 결과 4행(헤더+3)', store.length === 4 && store[0][0] === '고객명', 'len=' + store.length);
  ok('replace 옛사람 사라짐', !store.some((r) => r[0] === '옛사람'));

  // 4) 추가(append) — 기존 유지 + 3행 추가
  store = [['고객명', '연락처', '만기일'], ['기존', '010-z', '2026-01']]; calls.length = 0;
  const app = await roster.importRoster({}, { dataUrl, mode: 'append', confirm: true });
  ok('append ok·3명', app.ok && app.imported === 3);
  ok('append 결과 5행(헤더+기존+3)', store.length === 5, 'len=' + store.length);
  ok('append 기존 보존', store.some((r) => r[0] === '기존') && store.some((r) => r[0] === '신규A'));

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
