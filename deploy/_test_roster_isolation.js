// _test_roster_isolation.js — 🔒 각자 명단 격리 검증 (2026-08-01)
//
// 무엇을 보나: "A는 A 시트, B는 B 시트, 비로그인은 SA" 가 ★코드에서 실제로 갈리는가.
// 어떻게: 구글을 부르지 않는다. googleapis의 drive·sheets 만드는 자리를 가로채
//        ★"어느 인증(auth)으로 붙으러 갔는지"를 그대로 붙잡아 확인한다.
//        (진짜 구글 계정 2개 시험은 대표님이 브라우저로 하신다 — 이건 그 전에 코드가 맞는지 보는 것)
//
// 실행: node deploy/_test_roster_isolation.js
'use strict';
const gapi = require('googleapis');

let pass = 0, fail = 0;
const ok = (c, n, d) => { if (c) { pass++; console.log('  ✅ ' + n + (d ? ' — ' + d : '')); } else { fail++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };

// ── 구글 붙는 자리 가로채기(네트워크 0) ──
let 붙은인증 = [];
let 던진질의 = [];                                                                        // files.list 에 실제로 보낸 검색식
const 빈드라이브 = { files: { list: async (o) => { 던진질의.push((o || {}).q || ''); return { data: { files: [] } }; } } }; // 시트 못 찾음 = id null
const 빈시트 = {
  spreadsheets: {
    get: async () => ({ data: { sheets: [] } }),
    values: { get: async () => ({ data: { values: [] } }) },
  },
};
gapi.google.drive = (o) => { 붙은인증.push({ api: 'drive', auth: (o || {}).auth }); return 빈드라이브; };
gapi.google.sheets = (o) => { 붙은인증.push({ api: 'sheets', auth: (o || {}).auth }); return 빈시트; };

// ── 로그 가로채기(어느 갈래로 갔는지 한 줄로 말해준다) ──
const _log = console.log;
let 로그 = [];
const 로그켜기 = () => { 로그 = []; console.log = (...a) => { 로그.push(a.join(' ')); }; };
const 로그끄기 = () => { console.log = _log; return 로그.join('\n'); };

// ── 서비스계정도 가로채기 ──
//   ★반드시 sheets_crud_skill 을 require 하기 ★전에 바꾼다.
//     그 모듈이 불러오는 순간 getServiceAuth 를 꺼내 들고 가기 때문(나중에 바꾸면 안 먹는다).
//   ★로컬엔 GOOGLE_SERVICE_ACCOUNT_JSON 이 없어 진짜 getServiceAuth 는 던진다 →
//     "로그가 안 찍혔다"가 코드 잘못으로 오독된다. 가짜 SA로 갈아끼워 ★어느 인증을 골랐는지로 판정한다.
const sa = require('./service_auth');
const 가짜SA = { _who: 'SA' };
let SA호출 = 0;
sa.getServiceAuth = async () => { SA호출++; return 가짜SA; };

const crud = require('./sheets_crud_skill');
const roster = require('./roster_import');

// 학생A·학생B의 "회원 토큰"인 척하는 서로 다른 물건(진짜 토큰 아님)
const 학생A = { _who: 'A' };
const 학생B = { _who: 'B' };

(async () => {
  console.log('\n🔒 각자 명단 격리 — 코드 검증\n');

  console.log('── ① 읽기: 누구 토큰으로 붙는가 ──');
  붙은인증 = []; 던진질의 = []; 로그켜기();
  await crud.loadTable(학생A).catch(() => {});
  let L = 로그끄기();
  const A붙음 = 붙은인증.filter((x) => x.auth === 학생A).length;
  ok(A붙음 >= 1, '학생A로 부르면 ★학생A 토큰으로 붙는다', `drive·sheets ${A붙음}곳`);
  ok(!붙은인증.some((x) => x.auth === 학생B), '★학생A 호출에 학생B 토큰이 안 섞인다');
  ok(/회원 본인 토큰/.test(L), '로그가 "회원 본인 토큰 (각자 명단 격리)"', L.split('\n').find((x) => /🔑인증/.test(x)) || '(없음)');
  ok(던진질의.length === 1 && /'me' in owners/.test(던진질의[0]), "★회원 검색식에 \"'me' in owners\" 가 붙는다(남이 공유한 동명 시트 차단)", 던진질의[0] || '(질의 없음)');

  붙은인증 = []; 로그켜기();
  await crud.loadTable(학생B).catch(() => {});
  L = 로그끄기();
  ok(붙은인증.some((x) => x.auth === 학생B), '학생B로 부르면 ★학생B 토큰으로 붙는다');
  ok(!붙은인증.some((x) => x.auth === 학생A), '★★학생B 호출에 학생A 토큰이 안 섞인다 (A↔B 격리)');

  console.log('\n── ② 비로그인·데모는 예전 그대로(SA) ──');
  ok(SA호출 === 0, '★회원 경로에서는 서비스계정을 아예 안 부른다', `SA 호출 ${SA호출}회`);
  붙은인증 = []; 던진질의 = []; 로그켜기();
  await crud.loadTable(null).catch(() => {});
  L = 로그끄기();
  ok(SA호출 === 1, '비로그인이면 ★서비스계정을 부른다', `SA 호출 ${SA호출}회`);
  ok(던진질의.length === 1 && !/'me' in owners/.test(던진질의[0]), "★★SA 경로엔 \"'me' in owners\" 가 안 붙는다 — 붙이면 ★공유받은 데모 시트가 통째로 안 잡혀 비로그인이 깨진다", 던진질의[0] || '(질의 없음)');
  ok(붙은인증.some((x) => x.auth === 가짜SA), '★비로그인은 SA 인증으로 붙는다(예전 경로 그대로)');
  ok(/서비스 계정 \(공유 데모\)/.test(L), '로그가 "서비스 계정 (공유 데모)"', L.split('\n').find((x) => /🔑인증/.test(x)) || '(없음)');
  ok(!붙은인증.some((x) => x.auth === 학생A || x.auth === 학생B), '비로그인 경로에 회원 토큰이 안 섞인다');

  console.log('\n── ③ 첫 업로드: 회원 시트를 ★회원 토큰으로 새로 만드는가 ──');
  const 엑셀 = require('xlsx');
  const wb = 엑셀.utils.book_new();
  엑셀.utils.book_append_sheet(wb, 엑셀.utils.aoa_to_sheet([['고객명', '연락처'], ['홍길동', '010-1']]), 'S');
  const dataUrl = 'data:x;base64,' + 엑셀.write(wb, { type: 'buffer', bookType: 'xlsx' }).toString('base64');

  let 생성호출 = [];
  const 가짜시트클라 = {
    spreadsheets: {
      get: async () => ({ data: { sheets: [{ properties: { title: '고객명단' } }] } }),
      values: { get: async () => ({ data: { values: [] } }), clear: async () => ({}), update: async () => ({}) },
    },
  };
  roster.init({
    getMemberSheet: async (ma) => { 생성호출.push(ma); return { id: 'NEW_' + (ma && ma._who), sheets: 가짜시트클라 }; },
    ensureTab: async () => {},
    title: '지니야빌더_데모_명단', tab: '고객명단',
  });
  const _origLoad = crud.loadTable;
  crud.loadTable = async (ma) => ({ id: null, gid: null, header: [], rows: [], nameCol: null, sheets: 가짜시트클라 }); // 시트 아직 없음

  로그켜기();
  const rA = await roster.importRoster(학생A, { dataUrl, mode: 'replace', confirm: true });
  로그끄기();
  ok(rA && rA.ok === true, '학생A 첫 업로드가 ★성공한다(예전엔 "시트를 찾지 못했어요"로 막혔다)', rA && rA.message);
  ok(생성호출.length === 1 && 생성호출[0] === 학생A, '★학생A 토큰으로 시트를 만든다', `호출 ${생성호출.length}회`);

  생성호출 = [];
  const rB = await roster.importRoster(학생B, { dataUrl, mode: 'replace', confirm: true });
  ok(생성호출.length === 1 && 생성호출[0] === 학생B, '★학생B는 학생B 토큰으로 만든다(A 것 재사용 안 함)');

  console.log('\n── ④ 비로그인은 시트를 만들지 않는다(기존 SA 경로 보존) ──');
  생성호출 = [];
  const rN = await roster.importRoster(null, { dataUrl, mode: 'replace', confirm: true });
  ok(생성호출.length === 0, '★비로그인이면 시트 생성을 ★안 부른다');
  ok(rN && rN.ok === false, '비로그인은 예전처럼 정직하게 실패', rN && rN.message);

  crud.loadTable = _origLoad;
  console.log(`\n결과: ${pass}/${pass + fail} 통과` + (fail ? ` — ★${fail}개 실패` : ''));
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.log = _log; console.log('실행 실패:', e && e.stack || e); process.exitCode = 1; });
