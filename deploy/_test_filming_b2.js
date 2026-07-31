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
ok('★맨 앞은 지시하신 5칸 순서 그대로', r.cols.slice(0, 5).join(',') === '번호,고객명,가입상품,보험사,만기일', r.cols.slice(0, 5).join(','));
ok('★칸을 전부 보낸다(가로로 밀어서 보게 · 2026-07-31 지시)', r.cols.length === table.header.length, r.cols.length + '칸');

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
ok('★화면: 여는 함수 추가됨', /function openFullRoster\(r\)/.test(gh));
ok('★화면: 텍스트 대화에서 열림', /if\(d && d\.action==='open_full_roster'\)/.test(gh));
ok('★화면: 음성에서도 열림', /if\(d\.action==='open_full_roster'\)/.test(gh));
ok('★신호가 없으면 안 열림(기존 화면 그대로)', (gh.match(/openFullRoster\(d\.roster\)/g) || []).length === 2);

// ═══ [7] ★하얀 표 카드 (2026-07-31 대표님 지시로 전체화면 딥네이비에서 바뀜) ═══
console.log('\n[7] ★하얀 표 카드 · 대화창 안 · 엑셀 느낌');
const _b = gh.indexOf('function openFullRoster(r)');
const blk = gh.slice(_b, gh.indexOf('function closeFullRoster', _b));
ok('★★전체 화면을 꽉 채우지 않는다(오버레이 제거)',
  !/id="fullRoster"/.test(gh) && !/position:fixed;inset:0;z-index:99999/.test(gh));
ok('★★대화창 본문 안에 카드로 뜬다', /chatScroll/.test(blk) && /appendChild\(d\)/.test(blk));
ok('★하얀 배경 카드(우측 카드와 같은 --card)', /background:var\(--card\)/.test(blk));
ok('★헤더만 옅은 색(엑셀·구글시트 느낌)', /background:#f7f9fb/.test(blk));
ok('★촌스러운 형광초록 안 씀', !/#3DDC97/.test(blk) && !/rgba\(61,220,151/.test(blk));
ok('★강조는 은은한 민트(옅은 배경 + 볼드 + 왼쪽 띠)',
  /background:'\+bg/.test(blk) && /var\(--teal-l\)/.test(blk) && /var\(--teal-d\);font-weight:700/.test(blk) && /border-left:3px solid '\+\(hi\?'var\(--teal\)'/.test(blk));
ok('★가로형 표 — 컬럼이 가로(thead), 행이 세로로 쌓임(tbody)', /<thead><tr>/.test(blk) && /<tbody>/.test(blk));
ok('줄무늬로 읽기 쉽게', /ri % 2 \? '#fbfcfd' : '#fff'/.test(blk));
ok('머리행 고정(스크롤해도 칸 이름 보임)', /position:sticky;top:0/.test(blk));
ok('★카드 높이 제한 — 대화창을 안 밀어냄', /max-height:340px;overflow:auto/.test(blk));
ok('★말로도 밀 수 있다고 안내', /말로 "우측으로 밀어봐"·"아래로 내려봐" 하셔도 됩니다/.test(blk));

// ═══ [7-2] ★본문 폭 꽉 + 가로 스크롤 (2026-07-31 지시) ═══
console.log('\n[7-2] ★본문 폭 꽉 채우고 가로 스크롤');
ok('★★말풍선 폭 제한(88%)을 벗어나 본문을 꽉 채운다',
  /d\.style\.maxWidth = '100%'/.test(blk) && /chatScroll/.test(blk) && !/pushMsg\('gen', card\)/.test(blk));
ok('★★가로 스크롤이 실제로 생긴다(표가 폭보다 넓어야 스크롤바가 뜬다)',
  /width:max-content;min-width:100%/.test(blk) && /max-height:340px;overflow:auto/.test(blk));
ok('★칸 값이 줄바꿈으로 눌리지 않는다', /white-space:nowrap/.test(blk));
ok('★밀어도 번호·고객명은 왼쪽에 고정(어느 줄인지 안 놓치게)',
  /position:sticky;left:0/.test(blk) && /position:sticky;left:46px/.test(blk));
ok('★우측 카드와 같은 색 변수를 쓴다(톤앤매너 통일)',
  /var\(--line\)/.test(blk) && /var\(--ink\)/.test(blk) && /var\(--gray\)/.test(blk)
  && /var\(--teal-l\)/.test(blk) && /var\(--teal-d\)/.test(blk));
ok('★임의로 고른 색을 안 쓴다(우측 카드 톤에서 벗어난 값 없음)',
  !/#F5F7FA/.test(blk) && !/#2FB27C/.test(blk) && !/#0B6B4F/.test(blk) && !/#F2FBF7/.test(blk));

// ═══ [7-3] ★칸 20개 전부 (2026-07-31 지시) ═══
console.log('\n[7-3] ★칸을 전부 보낸다 (가로로 넘겨보게)');
const 전부 = ff.build(table, '명단 띄워봐', TODAY);
ok('★★핵심 5칸만이 아니라 명단의 칸을 전부 보낸다', 전부.cols.length === table.header.length,
  전부.cols.length + '칸 / 명단 ' + table.header.length + '칸');
ok('★앞 5칸은 지시하신 순서 그대로', 전부.cols.slice(0, 5).join(',') === '번호,고객명,가입상품,보험사,만기일', 전부.cols.slice(0, 5).join(','));
ok('★나머지 칸도 빠짐없이(중복 없이)', new Set(전부.cols).size === 전부.cols.length && table.header.every((h) => 전부.cols.includes(h)));
ok('★명단에 없는 칸은 만들지 않음', 전부.cols.every((c) => table.header.includes(c)));

// ═══ [7-5] ★본문 폭 안에만 · 공중에 뜬 느낌 (2026-07-31 지시) ═══
console.log('\n[7-5] ★우측 구글 4종 침범 금지 · 부양감');
ok('★★카드가 본문 폭을 절대 안 넘는다', /max-width:100%;box-sizing:border-box;/.test(blk));
ok('★★감싼 자리도 폭에 묶여 있다(삐져나옴 차단)',
  /d\.style\.width = '100%'/.test(blk) && /d\.style\.boxSizing = 'border-box'/.test(blk) && /d\.style\.overflow = 'hidden'/.test(blk));
ok('★넘치는 칸은 카드 안쪽 가로 스크롤로 처리', /genya-roster-scroll" style="max-width:100%;max-height:340px;overflow:auto/.test(blk));
ok('★★살짝 공중에 뜬 느낌(큰 그림자 두 겹)',
  /box-shadow:0 10px 26px rgba\(11,31,58,\.13\), 0 3px 8px rgba\(11,31,58,\.07\)/.test(blk));
ok('★본문에 딱 붙지 않게 위아래 여백', /margin:12px 0 16px/.test(blk));

// ═══ [7-6] ★말로 명단 밀기 (2026-07-31 지시) ═══
console.log('\n[7-6] ★"우측으로 밀어봐"·"아래로 내려봐" — 말로 조작');
[['우측으로 밀어봐', 'right'], ['오른쪽으로 밀어봐', 'right'], ['아래로 내려봐', 'down'], ['밑으로 내려봐', 'down'],
 ['위로 올려봐', 'up'], ['왼쪽으로 밀어봐', 'left'], ['맨 끝까지 밀어봐', 'end'], ['맨 아래로 내려봐', 'bottom'],
 ['더 밀어봐', 'right']].forEach(function (x) {
  const g = ff.wantsScroll(x[0]);
  ok(`"${x[0]}" → ${x[1]}`, g && g.dir === x[1], g ? g.dir : '못 알아들음');
});
[['명단 띄워봐'], ['김철수님 정보 알려줘'], ['오늘 일정 뭐야'], ['발굴 돌려'], ['8월 만기 고객 몇 명이야']].forEach(function (x) {
  ok(`"${x[0]}" → 안 민다(엉뚱하게 반응 안 함)`, ff.wantsScroll(x[0]) === null, JSON.stringify(ff.wantsScroll(x[0])));
});
ok('★화면에 미는 함수가 있다', /function scrollRoster\(sc\)/.test(gh));
// ★CSS의 behavior:'smooth' 는 환경에 따라 통째로 무시돼 ★아예 안 움직였다(실측으로 잡음).
//   그래서 rAF 로 직접 그린다 — 어디서든 똑같이 부드럽게 움직인다.
ok('★부드럽게 민다(직접 애니메이션 — 환경 타지 않음)',
  /requestAnimationFrame\(한칸\)/.test(gh) && /var 시작 = null, 총 = 420;/.test(gh));
ok('★끝을 넘어가지 않게 잘라준다', /가로 = Math\.max\(0, Math\.min\(최대가로, 가로\)\);/.test(gh));
ok('★이미 끝이면 조용히 넘어간다', /if\(Math\.abs\(가로-시작가로\) < 1 && Math\.abs\(세로-시작세로\) < 1\) return true;/.test(gh));
ok('★가장 최근에 뜬 명단을 민다', /표들\[표들\.length - 1\]/.test(gh));
ok('★표가 없으면 아무 일도 안 한다', /if\(!표들\.length\) return false;/.test(gh));
ok('★글 대화에서 작동', /if\(d && d\.action==='scroll_roster'\)/.test(gh));
ok('★★음성에서도 작동', /if\(d\.action==='scroll_roster'\)/.test(gh));
ok('★명단 띄우기가 우선(둘 다 걸리면 띄우기)', /if \(FILMING && filmFull && !out\.action\) \{/.test(ms));
ok('★라이브엔 스크롤 신호가 안 붙는다', /FILMING && filmFull && !out\.action/.test(ms));

// ═══ [7-4] ★촬영 모드는 크롬으로 열린다 (2026-07-31 지시) ═══
console.log('\n[7-4] ★촬영모드_켜기.bat → 크롬으로 열림');
const ob = fs.readFileSync(path.join(__dirname, '_filming_open.bat'), 'utf8');
ok('★★크롬 경로를 직접 찾아 실행한다', /Google\\Chrome\\Application\\chrome\.exe/.test(ob) && /start "" "%CHROME%"/.test(ob));
ok('설치 위치 3곳을 다 본다(64비트·32비트·사용자)',
  /%ProgramFiles%/.test(ob) && /%ProgramFiles\(x86\)%/.test(ob) && /%LocalAppData%/.test(ob));
ok('★크롬이 없으면 기본 브라우저로라도 열어 촬영이 안 멈춘다', /Chrome not found/.test(ob) && /start "" "http:\/\/localhost:8080\/"/.test(ob));
ok('★본 파일이 이 열기 파일을 부른다', /start "" \/min "%~dp0_filming_open\.bat"/.test(fs.readFileSync(path.join(__dirname, '촬영모드_켜기.bat'), 'latin1')));
ok('옛 닫기 호출이 남아 있어도 안 터진다', /function closeFullRoster\(\)\{\}/.test(gh));
// (ESC 닫기는 전체화면일 때만 의미가 있었다. 카드는 대화 기록의 일부라 닫을 게 없다.)

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`통과 ${통과} · 실패 ${실패}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(실패 ? 1 : 0);
