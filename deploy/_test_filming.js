// _test_filming.js — 🎬 촬영 모드 B-1 단위시험
// 대표님 검증 5개 항목을 그대로 시험한다.
//   1) 촬영 모드에서 명단 = 80명
//   2) 8월 만기 8명이 상단(1~8번), 그 이름 그대로
//   3) ★실제 고객 명단 무접촉 — 구글을 아예 안 부름 + 촬영 끄면 원래대로
//   4) 메인(교육생) 기능 그대로 — 환경변수 없으면 촬영 코드가 안 켜짐
//   5) 촬영 모드에선 시트 쓰기·실제 발송 차단
'use strict';
const path = require('path');

let 통과 = 0, 실패 = 0;
function ok(제목, 조건, 실측) {
  if (조건) { 통과++; console.log('  ✅ ' + 제목); }
  else { 실패++; console.log('  ❌ ' + 제목 + (실측 !== undefined ? '   ← 실측: ' + 실측 : '')); }
}

const crud = require('./sheets_crud_skill');
const filming = require('./filming_roster');

const AUG8 = ['김철수', '이영희', '최동욱', '신미경', '강수연', '정우진', '한지민', '오세훈'];

// ═══ [0] 켜기 전 = 평소 상태 (메인 무영향) ═══
console.log('\n[0] 촬영 모드를 안 켠 상태 = 평소와 같은가');
ok('★촬영 모드 꺼져 있음(기본값)', crud.isFilming() === false, crud.isFilming());

// ═══ [1] 촬영 모드 켜기 → 80명 ═══
console.log('\n[1] 촬영 모드에서 "명단 띄워봐" → 80명');
filming.enable(crud);
ok('★촬영 모드 켜짐', crud.isFilming() === true);

let t = null;
(async () => {
  t = await crud.loadTable(null);
  ok('★명단 80명', t.rows.length === 80, t.rows.length + '명');
  ok('칸 20개', t.header.length === 20, t.header.length + '칸: ' + t.header.join('·'));
  ok('이름 칸 인식', t.nameCol === '고객명', t.nameCol);
  // ★칸 이름은 단위(만원·원)가 붙어 올 수 있다(CTO CSV: '연소득(만원)'·'월보험료(원)') → 앞부분만 본다.
  ok('지시하신 20개 칸 그대로',
    ['번호', '고객명', '생년월일', '성별', '연락처', '이메일', '주소', '가족사항', '직업', '연소득',
      '가입상품', '보험사', '증권번호', '월보험료', '가입일', '만기일', '주요보장', '특약', '무사고여부', '비고']
      .every((h) => t.header.some((x) => String(x).startsWith(h))), t.header.join(','));

  // ═══ [2] 8월 만기 8명 상단 ═══
  console.log('\n[2] 8월 만기 8명이 맨 위인가');
  const 상단8 = t.rows.slice(0, 8).map((r) => r['고객명']);
  ok('★1~8번이 지시하신 8명, 순서까지 그대로', 상단8.join(',') === AUG8.join(','), 상단8.join(','));
  ok('★그 8명 전원 만기일이 2026-08', t.rows.slice(0, 8).every((r) => String(r['만기일']).startsWith('2026-08')),
    t.rows.slice(0, 8).map((r) => r['만기일']).join(','));
  const 팔월 = t.rows.filter((r) => String(r['만기일']).startsWith('2026-08'));
  ok('★8월 만기는 딱 8명 (9번 이후엔 8월이 없음)', 팔월.length === 8, 팔월.length + '명');

  // 실제 대화가 쓰는 검색 도구로도 8명이 나오는가 (함수 통과 ≠ 실제 작동 방지)
  const s = await crud.doSearch(null, { column: '만기일', contains: '2026-08' });
  ok('★도구(sheet_search)로 "2026-08" 찾으면 8명', s.ok && s.count === 8, JSON.stringify({ ok: s.ok, count: s.count }));
  const r1 = await crud.doRead(null, { name: '김철수' });
  ok('★도구(sheet_read)로 김철수 조회됨', r1.ok && r1.found === 1, JSON.stringify({ found: r1.found }));

  // ═══ [3] 실제 고객 명단 무접촉 ═══
  console.log('\n[3] ★실제 고객 명단에 손대지 않는가');
  ok('★촬영 명단의 시트 ID가 실제 시트가 아님(가짜 표식)', t.id === '__FILMING_SAMPLE__', t.id);
  ok('★구글 API 객체 자체가 없음(쓰려야 쓸 수 없음)', t.sheets === null, String(t.sheets));
  ok('★촬영 데이터 파일이 구글 라이브러리를 안 부름',
    !/require\(['"]googleapis['"]\)/.test(require('fs').readFileSync(path.join(__dirname, 'filming_roster.js'), 'utf8')));
  // ★연락처·이메일: 어떤 명단을 쓰느냐에 따라 달라진다.
  //   내장 80명 = 010-0000-XXXX(미배정 번호대) · @example.com(예시 전용) → 실존 인물과 절대 무관.
  //   CTO CSV   = 실제로 있을 법한 번호·gmail 주소일 수 있다 → 화면에 뜨면 실존 번호일 위험.
  //   그래서 "무해한 값인가"를 판정하지 않고, ★사실을 그대로 세어 알린다(지어내지 않는다).
  const 안전번호 = t.rows.filter((r) => /^010-0000-/.test(String(r['연락처'] || ''))).length;
  const 안전메일 = t.rows.filter((r) => /@example\.com$/.test(String(r['이메일'] || ''))).length;
  if (안전번호 === t.rows.length && 안전메일 === t.rows.length) {
    ok('★연락처·이메일이 실존 불가능한 값(미배정 번호대·예시 도메인)', true);
  } else {
    console.log(`  ⚠️  주의 — 이 명단의 연락처·이메일은 실존할 수 있는 형식입니다.`);
    console.log(`      실존불가 번호 ${안전번호}/${t.rows.length} · 예시 도메인 ${안전메일}/${t.rows.length} (예: ${t.rows[0]['연락처']} / ${t.rows[0]['이메일']})`);
    console.log(`      → 촬영 화면(전체 명단)에는 연락처·이메일 칸이 없어 노출되지 않습니다. 개별 카드를 열면 보일 수 있으니 확인하세요.`);
  }
  // ★그래서 더 중요한 것: 촬영 전체 화면에 연락처·이메일이 아예 안 들어가는가
  const 촬영칸 = require('./filming_fullscreen').SHOW_COLS;
  ok('★촬영 전체 화면에는 연락처·이메일 칸이 없다', !촬영칸.includes('연락처') && !촬영칸.includes('이메일'), 촬영칸.join(','));

  // ═══ [5] 쓰기 차단 ═══
  console.log('\n[5] 촬영 모드에서 시트 쓰기·발송이 막히는가');
  // ★2026-07-31 방법1(길 합치기): 촬영에서도 ★본 CRUD로 실제 수정한다(촬영 명단에만).
  //   전엔 쓰기를 막아서 별도 지름길을 파야 했고, 그 지름길이 본 기능과 충돌했다.
  const 전 = (await crud.loadTable(null)).rows.find((r) => r['고객명'] === '김철수')['주소'];
  const act = { op: 'update', name: '김철수', column: '주소', value: '촬영테스트', rowNum: 2, ts: Date.now() };
  const c = await crud.commit(null, act, crud.signAction(act));
  const 후 = (await crud.loadTable(null)).rows.find((r) => r['고객명'] === '김철수')['주소'];
  ok('★촬영 명단에는 실제로 써진다(길이 하나)', c.ok === true && 후 === '촬영테스트', `"${전}" → "${후}"`);
  ok('★구글은 안 부른다(촬영 명단은 시트 객체가 없음)', (await crud.loadTable(null)).sheets === null);

  const ms = require('fs').readFileSync(path.join(__dirname, 'main_server.js'), 'utf8');
  ok('★발송 차단막이 서버에 있음(문자·메일·캠페인·결재함·알림톡)',
    /_FILM_SEND_BLOCK/.test(ms) && /send\\\/sms\|gmail\\\/send\|campaign\\\/\(send\|test\)\|approval\\\/act\|events\\\/approve-send\|alimtalk\\\/send/.test(ms));

  // ═══ [4] 메인 무영향 — 끄면 원래대로 ═══
  console.log('\n[4] 메인(교육생) 기능 그대로인가');
  crud.setSource(null);
  ok('★촬영 모드 끄면 다시 평소 상태', crud.isFilming() === false);
  ok('★촬영 코드는 FILMING_MODE=1 일 때만 켜짐(라이브엔 그 변수 없음)',
    /const FILMING = process\.env\.FILMING_MODE === '1';/.test(ms) && /if \(FILMING\) \{ require\('\.\/filming_roster'\)\.enable\(sheetsCrud\);/.test(ms));
  ok('★평소엔 촬영 파일을 require조차 안 함(if 안에 있음)',
    !/^const filmingRoster = require/m.test(ms));
  // loadTable 원래 코드가 살아 있는가 (갈림길만 추가, 본문 무접촉)
  const cs = require('fs').readFileSync(path.join(__dirname, 'sheets_crud_skill.js'), 'utf8');
  ok('★원래 시트 읽기 코드 그대로 살아 있음', /const auth = await getServiceAuth\(\);/.test(cs) && /A1:CZ/.test(cs));
  ok('★갈림길은 딱 한 줄(_SOURCE)', (cs.match(/if \(_SOURCE\) return _SOURCE\(ma\);/g) || []).length === 1);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`통과 ${통과} · 실패 ${실패}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(실패 ? 1 : 0);
})().catch((e) => { console.error('시험 자체가 터짐:', e); process.exit(1); });
