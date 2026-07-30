// _test_filming_b2.js — 🎬 촬영 B-2 · 전체 화면 명단 단위시험
// 대표님 검증 항목을 그대로 시험한다(화면 실물은 E2E + 브라우저 스크린샷에서 확인).
'use strict';
const path = require('path'), fs = require('fs');

let 통과 = 0, 실패 = 0;
function ok(제목, 조건, 실측) {
  if (조건) { 통과++; console.log('  ✅ ' + 제목); }
  else { 실패++; console.log('  ❌ ' + 제목 + (실측 !== undefined ? '   ← 실측: ' + 실측 : '')); }
}

const ff = require('./filming_fullscreen');
const roster = require('./filming_roster');
const table = roster.table();

// ═══ [1] "명단 띄워봐" 말귀를 알아듣는가 ═══
console.log('\n[1] 어떤 말에 전체 화면을 여는가');
['명단 띄워봐', '명단 띄워줘', '고객 명단 보여줘', '명단 크게 보여줘', '8월 만기 띄워봐', '만기 명단 열어봐', '명단 전체 화면으로'].forEach((q) => {
  ok(`"${q}" → 연다`, ff.wantsRoster(q) === true);
});
['명단 몇 명이야', '김철수님 정보 알려줘', '오늘 일정 뭐야', '현대해상 암 면책기간'].forEach((q) => {
  ok(`"${q}" → 안 연다(기존대로 말로 답함)`, ff.wantsRoster(q) === false);
});

// ═══ [2] 표가 제대로 만들어지는가 ═══
// ★날짜를 2026-07로 고정한다 — 오늘이 바뀌어도 시험 결과가 흔들리지 않게(흔들리는 시험은 버그를 가린다).
const TODAY = '2026-07';
console.log('\n[2] 화면에 그릴 표 (오늘=2026-07 고정)');
const r = ff.build(table, '명단 띄워봐', TODAY);
ok('표가 만들어짐', !!r);
ok('★80명 전부 들어감(스크롤로 다 보임)', r.rows.length === 80, r.rows.length + '명');
ok('전체 인원 표기', r.subtitle === '전체 80명', r.subtitle);
ok('★지시하신 핵심 5칸', r.cols.join(',') === '번호,고객명,가입상품,보험사,만기일', r.cols.join(','));
ok('20칸을 다 넣지 않음(좁아서 안 읽히는 것 방지)', r.cols.length === 5, r.cols.length + '칸');

// ═══ [3] 8월 만기 8명 상단 강조 ═══
console.log('\n[3] ★8월 만기 8명 상단 강조');
const AUG8 = ['김철수', '이영희', '최동욱', '신미경', '강수연', '정우진', '한지민', '오세훈'];
const 상단8 = r.rows.slice(0, 8).map((x) => x['고객명']);
ok('★1~8번이 지시하신 8명, 순서 그대로', 상단8.join(',') === AUG8.join(','), 상단8.join(','));
ok('★그 8명이 전부 강조 표시(_hi)', r.rows.slice(0, 8).every((x) => x._hi === true));
ok('★강조는 딱 8명 (9번부터는 강조 아님)', r.rows.filter((x) => x._hi).length === 8, r.rows.filter((x) => x._hi).length + '명');
ok('강조 이름표에 "8월 만기 8명"', /8월 만기 8명/.test(r.focusLabel || ''), r.focusLabel);

// ═══ [4] "8월 만기 띄워봐" — 특정 달 지목 ═══
console.log('\n[4] "8월 만기 띄워봐" (음성으로도 같은 길)');
const r8 = ff.build(table, '8월 만기 띄워봐', TODAY);
ok('8월을 알아들음', ff.wantsMonth('8월 만기 띄워봐', table.rows, TODAY) === '2026-08', String(ff.wantsMonth('8월 만기 띄워봐', table.rows, TODAY)));
ok('★8월 만기 8명이 강조되어 맨 위', r8.rows.slice(0, 8).every((x) => x._hi) && r8.rows.filter((x) => x._hi).length === 8);
ok('전체 80명은 그대로 스크롤로 볼 수 있음', r8.rows.length === 80, r8.rows.length + '명');
const r11 = ff.build(table, '11월 만기 띄워봐', TODAY);
ok('다른 달(11월)을 물으면 그 달이 강조됨', (r11.focusLabel || '').indexOf('11월') === 0, r11.focusLabel);

// ═══ [4-2] ★지난 만기를 "챙길 고객"으로 강조하지 않는가 (시험이 잡아낸 결함) ═══
console.log('\n[4-2] ★지난 만기를 강조하지 않는가');
const 지난 = table.rows.filter((x) => String(x['만기일'] || '') < '2026-07');
ok(`명단에 지난 만기가 실제로 있다(${지난.length}명) — 이게 있어야 이 시험이 의미 있다`, 지난.length > 0, 지난.length + '명');
ok('★강조된 사람 중 지난 만기는 0명', r.rows.filter((x) => x._hi).every((x) => String(x['만기일']) >= '2026-07'),
  r.rows.filter((x) => x._hi && String(x['만기일']) < '2026-07').map((x) => x['고객명'] + '(' + x['만기일'] + ')').join(','));
ok('★"8월 만기"가 2021·2022년 8월을 집어오지 않음', ff.wantsMonth('8월 만기 띄워봐', table.rows, TODAY) >= '2026-07');

// ═══ [5] 지어내지 않는가 ═══
console.log('\n[5] 환각 차단');
ok('명단에 없는 칸은 안 만듦', r.cols.every((c) => table.header.includes(c)));
const 빈표 = ff.build({ header: ['고객명'], rows: [], nameCol: '고객명' }, '명단 띄워봐');
ok('명단이 비면 표를 안 만듦(빈 화면 억지로 안 띄움)', 빈표 === null, String(빈표));

// ═══ [6] 메인·라이브 무접촉 ═══
console.log('\n[6] ★메인(교육생) 무접촉');
const ms = fs.readFileSync(path.join(__dirname, 'main_server.js'), 'utf8');
ok('★전체화면 신호는 FILMING 일 때만 붙음', /if \(FILMING && filmFull && filmFull\.wantsRoster\(q\)\)/.test(ms));
ok('★촬영 모듈은 FILMING 일 때만 require', /if \(FILMING\) \{ require\('\.\/filming_roster'\)\.enable\(sheetsCrud\); filmFull = require\('\.\/filming_fullscreen'\); \}/.test(ms));
ok('★평소엔 filmFull=null 이라 블록이 안 켜짐', /let filmFull = null;/.test(ms));

const gh = fs.readFileSync(path.join(__dirname, 'genya.html'), 'utf8');
ok('★화면: 전체화면 명단 DOM 추가됨', /id="fullRoster"/.test(gh));
ok('★화면: 여는 함수 추가됨', /function openFullRoster\(r\)/.test(gh));
ok('★화면: 텍스트 대화에서 열림', /if\(d && d\.action==='open_full_roster'\)/.test(gh));
ok('★화면: 음성에서도 열림', /if\(d\.action==='open_full_roster'\)/.test(gh));
ok('★신호가 없으면 안 열림(기존 화면 그대로)', (gh.match(/openFullRoster\(d\.roster\)/g) || []).length === 2);

// ═══ [7] 촬영 가독성(큰 글씨) ═══
console.log('\n[7] 뒤에서 촬영해도 읽힐 크기인가');
const blk = gh.slice(gh.indexOf('id="fullRoster"'));
ok('★표 글씨 26px 이상', /font-size:2[6-9]px|font-size:[3-9]\dpx/.test(blk.slice(0, 3000)));
ok('★제목 34px', /font-size:34px/.test(blk.slice(0, 2000)));
ok('★전체 화면(position:fixed;inset:0)', /position:fixed;inset:0/.test(blk.slice(0, 500)));
ok('★어두운 자비스 톤(딥네이비 #0F1A35)', /background:#0F1A35/.test(blk.slice(0, 500)));
ok('★강조는 형광 초록(#3DDC97)', /#3DDC97/.test(blk));
ok('머리행 고정(스크롤해도 칸 이름 보임)', /position:sticky;top:0/.test(blk));
ok('★다시 열면 항상 맨 위부터(스크롤 자리 안 남음)', /parentNode\.scrollTop = 0/.test(blk));
ok('ESC 로 닫힘', /e\.key==='Escape'/.test(blk));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`통과 ${통과} · 실패 ${실패}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(실패 ? 1 : 0);
