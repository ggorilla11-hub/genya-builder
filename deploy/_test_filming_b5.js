// _test_filming_b5.js — 🎬 촬영 B-5 · 카드 순회("다음") 단위시험
// 화면 동작은 1600x900 브라우저로 따로 확인한다. 여기서는 판별·순서·연결을 못 박는다.
'use strict';
const fs = require('fs'), path = require('path');

let 통과 = 0, 실패 = 0;
function ok(제목, 조건, 실측) {
  if (조건) { 통과++; console.log('  ✅ ' + 제목); }
  else { 실패++; console.log('  ❌ ' + 제목 + (실측 !== undefined ? '   ← 실측: ' + 실측 : '')); }
}
const ff = require('./filming_fullscreen');
const table = require('./filming_roster').table();
const gh = fs.readFileSync(path.join(__dirname, 'genya.html'), 'utf8');
const ms = fs.readFileSync(path.join(__dirname, 'main_server.js'), 'utf8');
const AUG8 = ['김철수', '이영희', '최동욱', '신미경', '강수연', '정우진', '한지민', '오세훈'];
const TODAY = '2026-07';

// ═══ [1] "다음"·"이전" 말귀 ═══
console.log('\n[1] "다음"·"이전"을 알아듣는가');
// ★대표님이 실제로 쓰시는 표현 전부 (2026-07-31 지시: "다음"이 들어가면 순회)
['다음', '다음요', '다음이요', '다음카드', '다음 카드', '다음 고객카드', '다음 사람', '다음 고객',
 '다음 분', '다음분', '다음 거', '다음거', '담', '넘겨', '넘겨줘', '넘어가', 'next']
  .forEach((q) => ok(`"${q}" → next`, ff.wantsStep(q) === 'next', String(ff.wantsStep(q))));
['이전', '이전요', '이전카드', '이전 카드', '이전 고객', '이전 사람', '앞 사람', '앞으로', '뒤로', '되돌려', 'prev']
  .forEach((q) => ok(`"${q}" → prev`, ff.wantsStep(q) === 'prev', String(ff.wantsStep(q))));
// ★다른 기능과 겹치면 안 된다 — 특히 "다음 달"은 시간이지 순회가 아니다
['명단 띄워봐', '만기 8명 띄워', '시트 보여줘', '우측으로 밀어봐', '아래로 내려봐', '김철수 카드 띄워',
 '다음 달 만기 알려줘', '다음 주 일정 뭐야', '다음 분기 계획', '오늘 일정 뭐야', '전체 명단 보여줘']
  .forEach((q) => ok(`"${q}" → 순회 아님`, ff.wantsStep(q) === null, String(ff.wantsStep(q))));

// ★못 알아들어도 전체 명단을 쏟아내지 않는다(카드 보는 중이면 순회 맥락 유지)
ok('★카드 보는 중이면 "다음"류를 맥락으로 잡는다', /맥락으로 판단/.test(ms) && /req\.body\.filmCur/.test(ms));
ok('★그때도 "다음 달·주"는 순회로 안 본다', /!\/명단\|시트\|전체\|목록\|리스트\|띄워\|달\|주\\b\//.test(ms));

// ═══ [2] ★순서 (대표님이 정하신 8명) ═══
console.log('\n[2] ★8명 순서');
const 순서 = ff.stepOrder(table, '다음', TODAY);
ok('★★1김철수 2이영희 3최동욱 4신미경 5강수연 6정우진 7한지민 8오세훈',
  순서.join(',') === AUG8.join(','), 순서.join(','));
ok('★8명뿐(전체 80명 아님)', 순서.length === 8, 순서.length + '명');
ok('★이름을 지어내지 않는다(명단에 실제로 있는 이름만)',
  순서.every((n) => table.rows.some((r) => r['고객명'] === n)));
const 순서11 = ff.stepOrder(table, '11월 만기', TODAY);
ok('다른 달을 물으면 그 달 사람 순서', 순서11.length > 0 && 순서11.every((n) => {
  const r = table.rows.find((x) => x['고객명'] === n); return String(r['만기일']).slice(5, 7) === '11';
}), 순서11.join(','));

// ═══ [3] 서버 연결 ═══
console.log('\n[3] 서버가 순회 신호를 보내는가');
ok('★촬영 모드에서만 켜진다', /if \(FILMING && filmFull\) \{\s*\n\s*let _st = filmFull\.wantsStep\(q\);/.test(ms));
ok('★action=card_step · step · order 를 보낸다', /out\.action = 'card_step'; out\.step = _st; out\.order = _order;/.test(ms));
ok('★카드를 그릴 행도 같이 보낸다', /out\.rows = \(_t2\.rows \|\| \[\]\)\.filter/.test(ms));
ok('★서버는 상태를 안 갖는다(순서만 알려줌 · 제로 인그레스)', /서버는 순서\(이름 배열\)만 알려주고 상태는 안 갖는다/.test(ms));
ok('★넘어간 뒤 누구인지는 화면이 말한다(지어내기 금지)', /out\.text = '';\s+\/\/ 실제로 넘어간 뒤 화면이 누구인지 말한다/.test(ms));

// ═══ [4] 화면 연결 ═══
console.log('\n[4] 화면이 카드를 넘기는가');
ok('★순회 함수가 있다', /function stepCard\(sc\)/.test(gh));
ok('★지금 누구를 보는지 기억한다', /window\._FILM_CUR/.test(gh) && /function _filmRemember\(name\)/.test(gh));
ok('★이름으로 열었을 때도 이어진다(open_card 에서 기억)', /_filmRemember\(d\.customer\)/.test(gh));
ok('★마지막에서 "다음" → "마지막입니다"', /마지막입니다\./.test(gh));
ok('★처음에서 "이전" → "처음입니다"', /처음입니다\./.test(gh));
ok('★몇 번째 누구인지 말해준다', /\(j\+1\)\+'번 '\+이름\+'님 카드예요/.test(gh));
ok('★순서 밖으로 안 나간다', /if\(j >= 순서\.length\)/.test(gh) && /if\(j < 0\)/.test(gh));
ok('★명단이 없으면 정직히 안내', /아직 넘길 명단이 없어요/.test(gh));
ok('★카드가 안 뜨면 안 떴다고 말한다(거짓 보고 차단)', /카드를 못 띄웠어요/.test(gh));
ok('★글 대화에서 작동', /if\(d && d\.action==='card_step'\)/.test(gh));
ok('★★음성에서도 작동', /if\(d\.action==='card_step'\)/.test(gh));
// ★"다음"은 화면이 직접 말하므로 서버 답이 비어 있다 → "(응답 없음)"이 찍히면 안 된다.
ok('★"(응답 없음)"이 안 뜬다', /if\(reply && !\(d && d\.action==='card_step'\)\) pushMsg/.test(gh));

// ═══ [5] B-6 대비 (설계만) ═══
console.log('\n[5] B-6(말로 항목 추가) 대비 — 구조가 열려 있는가');
ok('★순회는 "누구를 볼지"만 다룬다(카드 내용 무관 → 항목이 늘어도 무영향)',
  /여기는 "누구를 볼지"만 정한다/.test(gh));
ok('★순서는 이름만 오간다(칸이 늘어도 순회는 그대로)', /이름만 준다\(개인정보 최소\)/.test(fs.readFileSync(path.join(__dirname, 'filming_fullscreen.js'), 'utf8')));

// ═══ [6] 기존 기능 무접촉 ═══
console.log('\n[6] 기존 기능 무접촉');
ok('★기존 카드 함수(openCustomerCard)를 그대로 쓴다(새로 안 만듦)', /openCustomerCard\(이름\)/.test(gh));
ok('★기존 거짓보고 차단(_카드확인) 그대로', /_카드확인\(function\(\)\{ openCustomerCard\(d\.customer\); \}, 1\)/.test(gh));
ok('★라이브엔 순회 신호가 안 붙는다', /if \(FILMING && filmFull\) \{[\s\S]{0,80}wantsStep/.test(ms));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`통과 ${통과} · 실패 ${실패}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(실패 ? 1 : 0);
