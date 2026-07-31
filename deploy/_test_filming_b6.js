// _test_filming_b6.js — 🎬 촬영 B-6 · 말로 항목 추가(승인·연결 없이 즉시 반영) 단위시험
'use strict';
const fs = require('fs'), path = require('path');
let 통과 = 0, 실패 = 0;
function ok(제목, 조건, 실측) {
  if (조건) { 통과++; console.log('  ✅ ' + 제목); }
  else { 실패++; console.log('  ❌ ' + 제목 + (실측 !== undefined ? '   ← 실측: ' + 실측 : '')); }
}
const ff = require('./filming_fullscreen');
const roster = require('./filming_roster');
const gh = fs.readFileSync(path.join(__dirname, 'genya.html'), 'utf8');
const ms = fs.readFileSync(path.join(__dirname, 'main_server.js'), 'utf8');
const NAMES = roster.table().rows.map((r) => r['고객명']);

// ═══ [1] 말귀 ═══
console.log('\n[1] "컬럼 추가해" 를 알아듣는가');
[['이영희 득남출산 컬럼 추가해 그냥 해', '득남출산', '이영희'],
 ['최동욱 출산했으니 컬럼 추가해서 오늘 날짜로', '출산', '최동욱'],
 ['결혼기념일 항목 추가해줘', '결혼기념일', ''],
 ['김철수 상담메모 칸 만들어', '상담메모', '김철수']].forEach(function (x) {
  const g = ff.wantsAddField(x[0], NAMES);
  ok(`"${x[0]}" → 칸=${x[1]} 대상=${x[2] || '(없음)'}`, g && g.칸 === x[1] && (g.대상 || '') === x[2], g ? JSON.stringify(g) : 'null');
});

// ═══ [2] ★발송은 절대 여기로 오면 안 된다 (승인 하드가드 보존) ═══
console.log('\n[2] ★발송은 여기로 안 온다 (승인 유지)');
['이영희님께 만기 안내 문자 보내줘', '김철수 메일 발송해', '알림톡 보내줘', '결재함에 올려줘', '카톡 보내줘']
  .forEach((q) => ok(`"${q}" → 항목추가 아님`, ff.wantsAddField(q, NAMES) === null, JSON.stringify(ff.wantsAddField(q, NAMES))));
console.log('\n   (다른 기능과도 안 겹치는가)');
['명단 띄워봐', '만기 8명 띄워', '다음', '우측으로 밀어봐', '김철수 카드 띄워']
  .forEach((q) => ok(`"${q}" → 항목추가 아님`, ff.wantsAddField(q, NAMES) === null, JSON.stringify(ff.wantsAddField(q, NAMES))));

// ═══ [3] ★실제로 데이터가 바뀌는가 (확인창이 아니라 진짜 변경) ═══
console.log('\n[3] ★실제 데이터 변경');
const 전칸 = roster.table().header.length;
const r1 = roster.addField('이영희', '테스트항목', '2026-07-31');
const 후 = roster.table();
ok('★칸이 실제로 늘어난다', 후.header.length === 전칸 + 1, 전칸 + ' → ' + 후.header.length);
ok('★새 칸은 맨 끝에(기존 칸 위치 안 건드림)', 후.header[후.header.length - 1] === '테스트항목', 후.header.slice(-1)[0]);
ok('★지목한 분에게만 값이 들어간다',
  후.rows.find((r) => r['고객명'] === '이영희')['테스트항목'] === '2026-07-31'
  && 후.rows.find((r) => r['고객명'] === '김철수')['테스트항목'] === '');
ok('★새 칸이라고 알려준다', r1.새칸 === true && r1.ok === true);
const r2 = roster.addField('최동욱', '테스트항목', '2026-08-01');
ok('★있는 칸이면 새로 안 만들고 값만 기록', r2.새칸 === false && roster.table().header.length === 전칸 + 1);
const r3 = roster.addField('없는사람', '테스트항목2', 'x');
ok('★명단에 없는 사람은 정직히 거절', r3.ok === false && /못 찾았어요/.test(r3.error), JSON.stringify(r3));

// ═══ [4] 서버 연결 ═══
console.log('\n[4] 서버가 승인·연결 없이 바로 반영하는가');
ok('★촬영 모드에서만 켜진다', /if \(FILMING && filmFull && !out\.action\) \{[\s\S]{0,600}wantsAddField/.test(ms));
ok('★★승인 버튼(pending)을 안 만든다', !/out\.pending[\s\S]{0,40}addField/.test(ms) && /out\.action = 'field_added'/.test(ms));
ok('★★"연결하라"를 지운다(구글 연결 요구로 새던 것)', /delete out\.needsConnect; delete out\.connectUrl;/.test(ms));
ok('★반영 결과를 사실대로 말한다', /바로 반영했습니다/.test(ms));
ok('★못 했으면 못 했다고 말한다', /out\.text = _r6\.error \|\| '항목을 추가하지 못했어요\.'/.test(ms));
ok('★지금 보는 고객을 대상으로 쓸 수 있다', /req\.body && req\.body\.filmCur/.test(ms));
ok('★화면이 지금 보는 고객을 보낸다(글·음성)', (gh.match(/filmCur:\(window\._FILM_CUR\|\|''\)/g) || []).length === 2);

// ═══ [5] 안전 (실제 고객·구글 무접촉) ═══
console.log('\n[5] ★안전');
const fr = fs.readFileSync(path.join(__dirname, 'filming_roster.js'), 'utf8');
ok('★촬영용 메모리 명단만 고친다(구글 안 부름)', !/googleapis|sheets\.spreadsheets/.test(fr));
ok('★CSV 원본 파일도 안 고친다', !/writeFileSync/.test(fr));
ok('★실제 고객 시트는 손대지 않는다(촬영 모드는 loadTable 자체가 샘플)', /crud\.setSource/.test(fr));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`통과 ${통과} · 실패 ${실패}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(실패 ? 1 : 0);
