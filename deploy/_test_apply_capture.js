// ═══════════════════════════════════════════════════════════════════
// _test_apply_capture.js · Phase 1-A 신청 캡처 시험
//
//   ★말이 아니라 ★숫자와 값으로 센다(CLAUDE.md 6-9).
//   ★오류 0이었는지도 센다 — 판정이 통째로 죽으면 시험이 저절로 통과한다(6-10 ⑤).
//   시트 실제 쓰기는 APPLY_SHEET_ID가 있어야 한다. 없으면 ★없다고 정직히 표시하고 건너뛴다.
// ═══════════════════════════════════════════════════════════════════
'use strict';
const A = require('./apply_sheet');

let pass = 0, fail = 0;
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${got !== undefined ? ' — 실제: ' + JSON.stringify(got) : ''}`); }
};

console.log('\n═══ ① rep 코드 (이메일 노출 0 · 재배포해도 같은 값) ═══');
const r1 = A.repCodeOf('ggorilla11@gmail.com');
const r2 = A.repCodeOf('GGorilla11@Gmail.com  ');
const r3 = A.repCodeOf('other@gmail.com');
t('같은 이메일 = 항상 같은 코드(저장 안 해도 됨)', r1 === r2, [r1, r2]);
t('대소문자·공백 달라도 같은 코드', r1 === r2);
t('다른 이메일 = 다른 코드', r1 !== r3, [r1, r3]);
t('코드에 이메일이 안 들어있다', !r1.includes('gorilla') && !r1.includes('@'), r1);
t('코드가 짧다(6자)', r1.length === 6, r1);
t('빈 이메일이면 빈 코드', A.repCodeOf('') === '');

console.log('\n═══ ② 연락처 정규화 (campaign_skill과 같은 규칙) ═══');
const ph = [
  ['010-9876-5432', '01098765432'], ['01098765432', '01098765432'],
  [1098765432, '01098765432'],                      // ★엑셀이 날린 앞 0
  ['+82 10 9876 5432', '01098765432'], ["'01098765432", '01098765432'],
];
ph.forEach(([inp, want]) => t(`정규화 ${JSON.stringify(inp)} → ${want}`, A.normPhone(inp) === want, A.normPhone(inp)));
t('유선번호는 휴대폰이 아니다', !A.isPhone(A.normPhone('02-123-4567')));
t('글자는 휴대폰이 아니다', !A.isPhone(A.normPhone('abc')));

console.log('\n═══ ③ 들어온 신청 검사 — 못 알아들으면 ★막는다(안 넓힌다) ═══');
const good = { name: '김노후', phone: '010-9876-5432', want: '상담', agree: true, ad: true,
  rep: 'r3f9a2', utm_source: 'shorts', utm_campaign: 'bootcamp8' };
const v = A.validate(good);
t('정상 신청은 통과', v.ok === true, v.error);
t('rep_id 그대로', v.ok && v.row.rep_id === 'r3f9a2', v.ok && v.row.rep_id);
t('연락처가 표준형으로 저장', v.ok && v.row.연락처 === '01098765432', v.ok && v.row.연락처);
t('광고동의 Y + 동의일시 같이', v.ok && /^Y \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/.test(v.row.광고수신동의), v.ok && v.row.광고수신동의);
t('발행번호는 비워둔다(지금 안 씀)', v.ok && v.row.발행번호 === '');
t('컬럼 9개', A.HEAD.length === 9, A.HEAD.length);

t('이름 없으면 거부', A.validate({ ...good, name: '' }).ok === false);
t('번호 이상하면 거부', A.validate({ ...good, phone: '02-123-4567' }).ok === false);
t('★관심이 목록 밖이면 거부(넓히지 않는다)', A.validate({ ...good, want: '아무거나' }).ok === false);
t('★관심이 비면 거부', A.validate({ ...good, want: '' }).ok === false);
t('필수 동의 없으면 거부', A.validate({ ...good, agree: false }).ok === false);
t('광고 미동의면 N', A.validate({ ...good, ad: false }).row.광고수신동의 === 'N');

console.log('\n═══ ④ rep 없이 들어온 신청 = ★미분류 (거부X · 대표귀속X) ═══');
const noRep = A.validate({ ...good, rep: '' });
t('rep 없어도 접수는 된다', noRep.ok === true);
t('rep_id = unassigned', noRep.ok && noRep.row.rep_id === 'unassigned', noRep.ok && noRep.row.rep_id);
t('대표님 코드로 몰래 안 넣는다', noRep.ok && noRep.row.rep_id !== A.repCodeOf('ggorilla11@gmail.com'));
const bad = A.validate({ ...good, rep: 'r3f9a2"; DROP--' });
t('rep에 이상한 글자는 걸러진다', bad.ok && /^[A-Za-z0-9_-]*$/.test(bad.row.rep_id), bad.ok && bad.row.rep_id);

console.log('\n═══ ⑤ 같은 사람 두 번 눌러도 한 줄 ═══');
t('첫 번째는 중복 아님', A.isDuplicate('rTEST1', '01011112222') === false);
t('바로 다시 누르면 중복', A.isDuplicate('rTEST1', '01011112222') === true);
t('다른 사람은 중복 아님', A.isDuplicate('rTEST1', '01033334444') === false);
t('다른 회원의 같은 번호는 별개', A.isDuplicate('rTEST2', '01011112222') === false);

console.log('\n═══ ⑥ 공개 쓰기 라우트 — 폭주 막기 ═══');
let 막힌회차 = 0;
for (let i = 0; i < 8; i++) if (A.rateLimited('9.9.9.9')) 막힌회차++;
t('1분에 5번까지만 받는다(6번째부터 막힘)', 막힌회차 === 3, `막힌 횟수 ${막힌회차}`);
t('다른 주소는 안 막힌다', A.rateLimited('8.8.8.8') === false);

console.log('\n═══ ⑦ 유입전환 목록에 얹기 — 기존 목록 무접촉 ═══');
const before = [{ id: 'AAA', tab: '*', title: '대표님 신청시트' }];
const saved = process.env.APPLY_SHEET_ID;
delete process.env.APPLY_SHEET_ID;
t('시트 미등록이면 목록을 안 건드린다', A.withApplySheet(before).length === 1);
process.env.APPLY_SHEET_ID = 'ZZZ_TEST';
const after = A.withApplySheet(before);
t('등록되면 뒤에 한 개 붙는다', after.length === 2 && after[1].id === 'ZZZ_TEST', after);
t('★기존 시트는 그대로 앞에 남는다', after[0].id === 'AAA');
t('두 번 불러도 안 겹친다', A.withApplySheet(after).length === 2);
if (saved) process.env.APPLY_SHEET_ID = saved; else delete process.env.APPLY_SHEET_ID;

console.log('\n═══ ⑧ 시트 실제 쓰기 (APPLY_SHEET_ID 있어야 함) ═══');
if (!process.env.APPLY_SHEET_ID) {
  console.log('  ⏸ 건너뜀 — APPLY_SHEET_ID가 없습니다. ★대표님이 시트를 만들어 서비스계정에 편집자로 공유하시면 그때 실측합니다.');
  console.log('     (여기서 "통과"라고 세지 않습니다 — 안 해본 것을 했다고 하지 않습니다)');
} else {
  console.log('  ⚠ APPLY_SHEET_ID가 있습니다 — 실제 시트에 쓰는 시험은 대표님 승인 후 따로 돌립니다(테스트 줄이 남으므로).');
}

console.log(`\n결과: ${pass}/${pass + fail} — ${fail === 0 ? '전부 통과' : fail + '개 실패'}`);
process.exit(fail === 0 ? 0 : 1);
