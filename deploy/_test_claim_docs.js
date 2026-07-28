// ─────────────────────────────────────────────────────────────
// _test_claim_docs.js — 🩹 보상비서 2단계(서류 안내) 단위 시험
//
// 회장님 검증 6가지를 그대로 시험으로 옮긴 것:
//   1. "김철수 무릎수술 삼성화재 실손" → 필요 서류 정확히 안내 ★★★
//   2. 담보별로 다른 서류가 나오는지
//   3. 진단명 필수 · 100만원 원본 안내
//   4. 고객 안내문 자동 생성
//   5. ★금지 4가지가 코드로 막혀 있는지 (지어내기·발송·금액산정·무접촉)
//   6. 삼성화재 외 보험사는 "확인 필요"라고 정직히 말하는지
//
// 실행: node deploy/_test_claim_docs.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const docs = require('./claim_docs_skill');

let pass = 0, fail = 0;
const T = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '  → ' + e.message); fail++; }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg || '조건 실패'); };
const has = (haystack, needle) => ok(String(haystack).includes(needle), `"${needle}" 가 없음`);
const hasNot = (haystack, needle) => ok(!String(haystack).includes(needle), `"${needle}" 가 있으면 안 됨`);

console.log('\n━━━ 1. 회장님 시나리오 (★★★ 핵심) ━━━');
const r1 = docs.guide('김철수 무릎수술로 입원했어. 삼성화재 실손.');
T('ok=true 로 안내가 나온다', () => ok(r1.ok, JSON.stringify(r1.error)));
T('고객명 = 김철수', () => ok(r1.고객명 === '김철수', '고객명=' + r1.고객명));
T('보험사 = 삼성화재 · 확정 보험사', () => { ok(r1.보험사 === '삼성화재'); ok(r1.보험사확정 === true); });
T('담보 = 실손의료비', () => ok(JSON.stringify(r1.담보) === '["실손의료비"]', JSON.stringify(r1.담보)));
T('서류에 영수증·세부내역서가 있다', () => {
  const d = r1.서류[0].서류.join('|');
  has(d, '진료비 영수증'); has(d, '진료비 세부내역서');
});
T('진단명(질병분류코드) 안내가 있다', () => has(r1.진단명안내, '질병분류코드'));
T('"수술"·"입원" 언급 → 수술비·입원일당 담보를 제안한다(확정 아님)', () => {
  const a = r1.알림.join(' ');
  has(a, '수술비'); has(a, '입원일당');
});

console.log('\n━━━ 2. 담보별로 서류가 달라진다 ━━━');
const 담보표 = [
  ['박영희 입원일당 청구할게요', '입원일당', '입퇴원확인서'],
  ['이철수 진단비', '진단비', '진단서'],
  ['최민수 수술비 청구', '수술비', '수술기록지'],
  ['정다혜 후유장해', '후유장해', '후유장해진단서'],
];
담보표.forEach(([문장, 담보, 서류]) => {
  T(`${담보} → ${서류}`, () => {
    const r = docs.guide(문장);
    ok(r.ok, JSON.stringify(r.error));
    ok(r.담보.includes(담보), '담보=' + JSON.stringify(r.담보));
    has(r.서류.map((x) => x.서류.join('|')).join('|'), 서류);
  });
});
T('실손과 진단비의 서류가 서로 다르다', () => {
  const a = docs.guide('김철수 삼성화재 실손').서류[0].서류.join('|');
  const b = docs.guide('김철수 삼성화재 진단비').서류[0].서류.join('|');
  ok(a !== b, '두 담보의 서류가 같으면 안 됨');
});

console.log('\n━━━ 3. 공통 원칙 안내 (진단명 필수 · 100만원 원본 · 실손24) ━━━');
T('100만원 초과 원본 안내가 있다', () => has(r1.확인사항.join(' '), '100만원'));
T('원본 제출이라고 명시한다', () => has(r1.확인사항.join(' '), '원본'));
T('실손24 참여병원 안내가 있다', () => has(r1.확인사항.join(' '), '실손24'));
T('실손24 기준일(2024.10.25)이 있다', () => has(r1.확인사항.join(' '), '2024.10.25'));
T('진단명 인정 서류 6종이 다 있다', () => {
  ['진단서', '통원확인서', '처방전', '소견서', '수술확인서', '진료차트']
    .forEach((d) => has(r1.진단명안내, d));
});

console.log('\n━━━ 4. 고객 안내문 자동 생성 ━━━');
T('안내문이 "김철수님"으로 시작한다', () => ok(r1.안내문.startsWith('김철수님'), r1.안내문.slice(0, 20)));
T('안내문에 보험사·담보가 들어간다', () => { has(r1.안내문, '삼성화재'); has(r1.안내문, '실손의료비'); });
T('안내문에 서류 목록이 들어간다', () => { has(r1.안내문, '진료비 영수증'); has(r1.안내문, '진료비 세부내역서'); });
T('안내문에 확인사항(100만원·실손24)이 들어간다', () => { has(r1.안내문, '100만원'); has(r1.안내문, '실손24'); });
T('★안내문 끝에 법적 문구가 반드시 붙는다', () => has(r1.안내문, docs.LEGAL));
T('이름을 못 찾아도 "고객님"으로 만든다(지어내지 않는다)', () => {
  const r = docs.guide('삼성화재 실손 청구');
  ok(r.ok); ok(r.고객명 === null, '고객명=' + r.고객명);
  has(r.안내문, '고객님');
});
T('서류가 겹쳐도 중복 없이 한 번만 나온다', () => {
  const r = docs.guide('김철수 삼성화재 실손 입원일당');
  const 개수 = (r.안내문.match(/진료비 영수증/g) || []).length;
  ok(개수 === 1, '진료비 영수증이 ' + 개수 + '번 나옴');
});

console.log('\n━━━ 5. ★금지 4가지 — 코드로 막혀 있는가 ━━━');
const src = fs.readFileSync(path.join(__dirname, 'claim_docs_skill.js'), 'utf8');
T('[지어내기 금지] 담보를 못 알아들으면 되묻는다', () => {
  const r = docs.guide('김철수 아파요');
  ok(r.ok === false && r.unknown === true, '되묻지 않음');
  ok(Array.isArray(r.선택지) && r.선택지.length >= 5, '선택지를 안 줌');
});
T('[지어내기 금지] 표에 없는 담보는 서류를 만들지 않는다', () => {
  const d = docs.docsFor(['있지도않은담보']);
  ok(d.항목.length === 0, '없는 담보로 서류를 만들어냄');
  ok(d.모르는담보.length === 1);
});
T('[지어내기 금지] 사고유형이 애매하면 null (추측 안 함)', () => {
  ok(docs._사고유형('무릎수술로 입원') === null, '애매한데 사고유형을 정해버림');
  ok(docs._사고유형('교통사고 났어요') === '교통');
});
T('[발송 금지] 소스에 발송 코드가 없다', () => {
  [/solapi/i, /sendMessage/i, /nodemailer/i, /sendSms/i, /\/api\/approval/i, /발송\s*\(/].forEach((re) =>
    ok(!re.test(src), '발송 흔적: ' + re));
});
T('[금액 산정 금지] 소스에 금액 계산 코드가 없다', () => {
  // 숫자 곱하기·나누기·합산으로 보험금을 계산하는 코드가 아예 없어야 한다
  [/보험금\s*=/, /지급액/, /산정\(/, /calcAmount/i, /\*\s*0\.\d/].forEach((re) =>
    ok(!re.test(src), '금액 계산 흔적: ' + re));
});
T('[무접촉] 소스에 파일 쓰기·시트 쓰기·서버 상태 접근이 없다', () => {
  [/fs\.write/, /appendFile/, /spreadsheets\.values\.update/, /require\('\.\/main_server/].forEach((re) =>
    ok(!re.test(src), '무접촉 위반: ' + re));
});
T('[제로 인그레스] 소스에 console 로그가 없다(고객 값 유출 방지)', () => {
  ok(!/console\.(log|info|warn)/.test(src), 'console 출력이 있음');
});

console.log('\n━━━ 6. 삼성화재 외 보험사 — 정직 표시 ━━━');
const r6 = docs.guide('김철수 흥국생명 실손 청구');
T('흥국생명도 안내는 나온다(공통 기준)', () => ok(r6.ok));
T('보험사확정 = false', () => ok(r6.보험사확정 === false));
T('★"확인 필요"라고 정직히 말한다', () => { has(r6.알림.join(' '), '흥국생명'); has(r6.알림.join(' '), '확인'); });
T('현재 확정 보험사(삼성화재)를 알려준다', () => has(r6.알림.join(' '), '삼성화재'));
T('보험사를 아예 안 말하면 공통 기준이라고 알린다', () => {
  const r = docs.guide('김철수 실손');
  ok(r.ok); has(r.알림.join(' '), '공통 기준');
});

console.log('\n━━━ 7. 법적 안전 문구 ━━━');
T('LEGAL에 "정보 제공"이 있다', () => has(docs.LEGAL, '정보 제공'));
T('LEGAL에 "산정·청구 대리가 아니"라고 있다', () => { has(docs.LEGAL, '산정'); has(docs.LEGAL, '대리가 아니'); });
T('LEGAL에 "보험사·약관을 확인"이 있다', () => has(docs.LEGAL, '보험사·약관'));
T('성공 응답에 법적문구가 있다', () => ok(r1.법적문구 === docs.LEGAL));
T('실패(되묻기) 응답에도 법적문구가 있다', () => ok(docs.guide('김철수 아파요').법적문구 === docs.LEGAL));
T('빈 입력에도 법적문구가 있다', () => ok(docs.guide('').법적문구 === docs.LEGAL));

console.log('\n━━━ 8. 보험사·이름 읽기 정확도 ━━━');
T('긴 이름 우선 — DB손해보험이 DB손보에 안 먹힌다', () => ok(docs._보험사('DB손해보험 실손') === 'DB손해보험'));
T('"고객님"을 사람 이름으로 오인하지 않는다', () => ok(docs._고객명('고객님 실손 청구') === null));
T('"대표님"을 사람 이름으로 오인하지 않는다', () => ok(docs._고객명('대표님 실손') === null));
T('"김철수님" 형태를 읽는다', () => ok(docs._고객명('오늘 김철수님 실손 건') === '김철수'));

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  통과 ${pass} · 실패 ${fail}   (전체 ${pass + fail})`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
process.exit(fail ? 1 : 0);
