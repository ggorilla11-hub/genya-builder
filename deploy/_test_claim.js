// _test_claim.js — 🩹 보상비서 1단계 단위시험 (구글 연결 없이 · 가짜 명단으로 실물 검증)
// 실행: node deploy/_test_claim.js
// 확인하는 것: ①시트 값이 정확한 칸에 들어가는가 ②빈칸이 "증빙에서 입력 필요"로 정직한가
//              ③지어내기 0 ④PDF가 진짜 만들어지는가 ⑤★디스크에 안 남는가(제로 저장)
'use strict';
const fs = require('fs');
const path = require('path');
const claim = require('./claim_form_skill');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' → ' + extra : ''}`); }
}
const F = (r, label) => r.sections.reduce((a, s) => a.concat(s.fields), []).find((f) => f.label === label);

// ── 가짜 명단(구글 시트 대신). loadTable() 반환 모양 그대로 ──
const 표준 = {
  header: ['고객명', '연락처', '직업', '계좌은행', '계좌번호', '만기일'],  // 실제 시트 컬럼명(청구서 칸 이름과 다름 — 그래도 매핑돼야 한다)
  nameCol: '고객명',
  rows: [
    { _rowNum: 2, 고객명: '김철수', 연락처: '010-1234-5678', 직업: '자영업', 계좌은행: '국민은행', 계좌번호: '123456-01-789012', 만기일: '2026-09-01' },
    { _rowNum: 3, 고객명: '이영희', 연락처: '010-2222-3333', 직업: '', 계좌은행: '', 계좌번호: '', 만기일: '2026-10-05' },
    { _rowNum: 4, 고객명: '김철민', 연락처: '010-9999-0000', 직업: '회사원', 계좌은행: '신한은행', 계좌번호: '110-222-333444', 만기일: '2026-11-11' },
  ],
};

console.log('\n🩹 보상비서 1단계 — 삼성화재 청구서 자동 입력 시험\n');

// ═══ 1. 시트 값이 정확한 칸에 들어가는가 ═══
console.log('[1] 시트 → 청구서 칸 매핑');
const r1 = claim.buildClaim(표준, '김철수');
ok('고객 찾음', r1.ok, r1.error);
ok('피보험자 성명 = 김철수', F(r1, '피보험자 성명').value === '김철수', F(r1, '피보험자 성명').value);
ok('직업 = 자영업', F(r1, '직업(직장명)').value === '자영업', F(r1, '직업(직장명)').value);
ok('휴대폰 = 010-1234-5678', F(r1, '휴대폰').value === '010-1234-5678', F(r1, '휴대폰').value);
ok('보험계약자 성명 = 김철수', F(r1, '보험계약자 성명').value === '김철수', F(r1, '보험계약자 성명').value);
ok('은행 = 국민은행 (계좌번호를 집어가지 않음)', F(r1, '은행').value === '국민은행', F(r1, '은행').value);
ok('계좌번호 = 123456-01-789012', F(r1, '계좌번호').value === '123456-01-789012', F(r1, '계좌번호').value);
ok('예금주 = 김철수', F(r1, '예금주').value === '김철수', F(r1, '예금주').value);
ok('안내방법 = 문자메시지(기본값)', F(r1, '안내방법').value === '문자메시지', F(r1, '안내방법').value);
ok('청구유형 = 최초청구(기본값)', F(r1, '청구유형').value === '최초청구', F(r1, '청구유형').value);
ok('4섹션 구조', r1.sections.length === 4 && r1.sections.map((s) => s.title).join('/') === '인적사항/사고사항/보험금 수령 계좌/청구인 확인·서명', r1.sections.map((s) => s.title).join('/'));

// ═══ 2. 지어내기 0 — OCR 단계 필드는 반드시 빈칸 ═══
console.log('\n[2] 지어내기 금지 (OCR 다음 단계 필드는 빈칸)');
['주민등록번호', '사고일(발병일)', '진단명', '질병분류기호', '병원명'].forEach((lb) => {
  const f = F(r1, lb);
  ok(`${lb} = 빈칸 + "증빙에서 입력 필요"`, f.status === 'need' && f.value === '', `status=${f.status} value="${f.value}"`);
});
ok('주민등록번호를 시트에서 채우려 시도조차 안 함', /민감정보/.test(F(r1, '주민등록번호').why), F(r1, '주민등록번호').why);

// ═══ 3. 시트 값이 비었을 때 정직 표시 ═══
console.log('\n[3] 시트 값이 비었을 때 — 정직하게 "입력 필요"');
const r2 = claim.buildClaim(표준, '이영희');
ok('이영희 찾음', r2.ok, r2.error);
ok('직업 비어 있음 → need', F(r2, '직업(직장명)').status === 'need' && F(r2, '직업(직장명)').value === '', `${F(r2, '직업(직장명)').status}/"${F(r2, '직업(직장명)').value}"`);
ok('빈칸 사유를 정직히 밝힘', /비어 있어요/.test(F(r2, '직업(직장명)').why), F(r2, '직업(직장명)').why);
ok('은행 비어 있음 → need', F(r2, '은행').status === 'need', F(r2, '은행').why);
ok('채워진 건 그대로(휴대폰)', F(r2, '휴대폰').value === '010-2222-3333', F(r2, '휴대폰').value);

// ═══ 4. 명단에 컬럼 자체가 없을 때 ═══
console.log('\n[4] 명단에 계좌 칸 자체가 없을 때');
const 계좌없음 = { header: ['이름', '휴대폰', '하는일'], nameCol: '이름',
  rows: [{ _rowNum: 2, 이름: '박수근', 휴대폰: '010-5555-6666', 하는일: '화가' }] };
const r3 = claim.buildClaim(계좌없음, '박수근');
ok('컬럼 이름이 달라도(이름/휴대폰/하는일) 매핑됨', F(r3, '피보험자 성명').value === '박수근' && F(r3, '휴대폰').value === '010-5555-6666' && F(r3, '직업(직장명)').value === '화가',
   `${F(r3, '피보험자 성명').value}/${F(r3, '휴대폰').value}/${F(r3, '직업(직장명)').value}`);
ok('은행 → "칸이 없어요"로 정직', F(r3, '은행').status === 'need' && /칸이 없어요/.test(F(r3, '은행').why), F(r3, '은행').why);
ok('없는 계좌를 지어내지 않음', F(r3, '계좌번호').value === '', F(r3, '계좌번호').value);

// ═══ 5. 사람 못 찾음 / 여러 명 ═══
console.log('\n[5] 고객 선택 안전장치');
const r4 = claim.buildClaim(표준, '홍길동');
ok('★명단에 없어도 틀은 만든다 ("명단 없어서 못 한다" 딴소리 금지)', r4.ok === true && r4.notFound === true, JSON.stringify(r4.error));
ok('명단에 없다고 정직히 알림', /명단에 없어서/.test(r4.안내문||''), (r4.안내문||'').split('\n')[0]);
ok('명단에 없으면 값을 지어내지 않음', F(r4, '휴대폰').value === '' && F(r4, '은행').value === '', F(r4, '휴대폰').value);
const r5 = claim.buildClaim(표준, '김철');
ok('여러 명 → 되묻기(엉뚱한 사람 청구서 방지)', r5.ok === false && r5.candidates && r5.candidates.length === 2, JSON.stringify(r5.candidates));
const r6 = claim.buildClaim(표준, '');
ok('이름 없음 → 되묻기', r6.ok === false, r6.error);

// ═══ 5-2. 【2】 부족분 안내 (2차 지시) ═══
console.log('\n[5-2] 부족분 안내 — 지니야가 먼저 말한다');
ok('안내문 있음', !!r1.안내문, r1.안내문);
ok('✅ 채워짐 줄 있음', /✅ 채워짐: .*성명/.test(r1.안내문), (r1.안내문||'').split('\n')[1]);
ok('⬜ 부족 줄 있음', /⬜ 부족: .*주민번호|⬜ 부족: .*주민등록번호/.test(r1.안내문), (r1.안내문||'').split('\n')[2]);
ok('"부족한 걸 알려주시면" 유도', /알려주시면 채우겠습니다/.test(r1.안내문), '');
ok('★"명단 없어서 못 한다" 류 문구 없음', !/못 한다|못 해요|못합니다|불가/.test(r1.안내문), r1.안내문);
ok('부족목록 배열 제공', Array.isArray(r1.부족목록) && r1.부족목록.length === r1.통계.입력필요, JSON.stringify(r1.부족목록));

// ═══ 5-3. 【1】 매핑 확장 — 이메일·보험사·증권번호 ═══
console.log('\n[5-3] 매핑 확장 (이메일·보험사·증권번호)');
const 확장 = { header: ['고객명','연락처','직업','이메일','보험사','증권번호','계좌은행','계좌번호'], nameCol: '고객명',
  rows: [{ _rowNum: 2, 고객명:'최민수', 연락처:'010-7777-8888', 직업:'교사', 이메일:'choi@test.com', 보험사:'삼성화재', 증권번호:'SF-2024-001', 계좌은행:'우리은행', 계좌번호:'1002-333-444555' }] };
const r8 = claim.buildClaim(확장, '최민수');
ok('이메일 ← 시트[이메일]', F(r8,'이메일').value === 'choi@test.com', F(r8,'이메일').value);
ok('보험사(참고) ← 시트[보험사]', F(r8,'보험사(참고)').value === '삼성화재', F(r8,'보험사(참고)').value);
ok('증권번호(참고) ← 시트[증권번호]', F(r8,'증권번호(참고)').value === 'SF-2024-001', F(r8,'증권번호(참고)').value);
ok('참고 칸은 ref 표시', F(r8,'보험사(참고)').ref === true && F(r8,'피보험자 성명').ref === false, '');
ok('은행/계좌 동시에 정확', F(r8,'은행').value === '우리은행' && F(r8,'계좌번호').value === '1002-333-444555', F(r8,'은행').value+'/'+F(r8,'계좌번호').value);

// ═══ 5-4. 【3】 말로 입력 → 어느 칸인지 읽어내기 (결정적·환각 0) ═══
console.log('\n[5-4] 말/텍스트 해석 (parseSay)');
const P = (t) => claim.parseSay(t);
const get = (p, l) => (p.fields.find((f) => f.label === l) || {}).value;
let p = P('홍길동 계좌번호 국민 123-456이야');
ok('★지시 예시: "계좌번호 국민 123-456" → 은행+계좌 동시', get(p,'은행') === '국민은행' && get(p,'계좌번호') === '123-456', JSON.stringify(p.fields));
p = P('이메일 hong@naver.com 이고 휴대폰 010-1111-2222야');
ok('이메일+휴대폰 동시', get(p,'이메일') === 'hong@naver.com' && get(p,'휴대폰') === '010-1111-2222', JSON.stringify(p.fields));
p = P('주민번호 900101-1234567');
ok('주민번호 읽음', get(p,'주민등록번호') === '900101-1234567', JSON.stringify(p.fields));
ok('★주민번호는 시트 저장 대상 아님(save=claim)', p.fields[0].save === 'claim', p.fields[0].save);
p = P('진단명은 급성심근경색이고 질병분류기호 I21이야');
ok('진단명 읽음', get(p,'진단명') === '급성심근경색', JSON.stringify(p.fields));
ok('질병분류기호 읽음', get(p,'질병분류기호') === 'I21', get(p,'질병분류기호'));
ok('★진단명도 시트 저장 안 함', p.fields.every((f) => f.save === 'claim'), JSON.stringify(p.fields.map((f)=>f.save)));
p = P('서울아산병원에서 진료받았어');
ok('병원명 읽음', get(p,'병원명') === '서울아산병원', JSON.stringify(p.fields));
p = P('사고일은 2026년 5월 3일이야');
ok('사고일 읽음(YYYY-MM-DD)', get(p,'사고일(발병일)') === '2026-05-03', get(p,'사고일(발병일)'));
p = P('직업은 회사원이야');
ok('직업 읽음 · ★시트 저장 대상(save=sheet)', get(p,'직업(직장명)') === '회사원' && p.fields[0].save === 'sheet', JSON.stringify(p.fields));
p = P('보험사 현대해상이고 증권번호 HD-9988-77');
ok('보험사+증권번호 읽음', get(p,'보험사(참고)') === '현대해상' && get(p,'증권번호(참고)') === 'HD-9988-77', JSON.stringify(p.fields));
p = P('음 그러니까 그거 있잖아');
ok('★못 알아들으면 지어내지 않고 unknown', p.unknown === true && p.fields.length === 0, JSON.stringify(p.fields));
p = P('');
ok('빈 입력 → unknown', p.unknown === true, '');

// ═══ 5-5. 말한 값이 청구서에 반영 ═══
console.log('\n[5-5] 말한 값 → 청구서 반영 (extras)');
const r9 = claim.buildClaim(표준, '이영희', { '주민등록번호':'880202-2345678', '진단명':'급성충수염', '직업(직장명)':'간호사' });
ok('말한 주민번호가 청구서에 채워짐', F(r9,'주민등록번호').value === '880202-2345678' && F(r9,'주민등록번호').status === 'filled', F(r9,'주민등록번호').value);
ok('출처가 "방금 말씀하신 값"으로 표시', F(r9,'주민등록번호').from === 'said', F(r9,'주민등록번호').from);
ok('말한 값이 빈 시트 값을 이김', F(r9,'직업(직장명)').value === '간호사', F(r9,'직업(직장명)').value);
ok('안 말한 칸은 여전히 빈칸(지어내기 0)', F(r9,'병원명').value === '' && F(r9,'은행').value === '', '');
ok('부족 개수가 줄어듦', r9.통계.입력필요 < r2.통계.입력필요, `${r2.통계.입력필요} → ${r9.통계.입력필요}`);

// ═══ 5-6. 명단 저장 판단 (planSay) — ★민감정보 차단 · 덮어쓰기 되묻기 ═══
console.log('\n[5-6] 명단에 저장할지 판단 (planSay)');
const 이영희 = 표준.rows[1];
const c영희 = claim.buildClaim(표준, '이영희');
let pl = claim.planSay(claim.parseSay('계좌 국민 123-456').fields, c영희, 이영희);
ok('빈칸이라 자율로 명단 저장 (은행+계좌)', pl.toSheet.length === 2 && pl.needsConfirm.length === 0, JSON.stringify(pl.toSheet));
ok('★읽는 칸과 쓰는 칸이 같음 (계좌은행/계좌번호)', pl.toSheet.map((s)=>s.column).sort().join(',') === '계좌번호,계좌은행', JSON.stringify(pl.toSheet.map((s)=>s.column)));
pl = claim.planSay(claim.parseSay('주민번호 880202-2345678 진단명 급성충수염').fields, c영희, 이영희);
ok('★민감정보는 명단 저장 대상에서 아예 빠짐', pl.toSheet.length === 0 && pl.toClaim.length === 2, JSON.stringify(pl));
ok('민감정보 제외 사유를 밝힘', /민감정보/.test(pl.toClaim[0].사유), pl.toClaim[0].사유);

const 김철수 = 표준.rows[0];
const c철수 = claim.buildClaim(표준, '김철수');
pl = claim.planSay(claim.parseSay('계좌 신한 999-888-777').fields, c철수, 김철수);
ok('★이미 값이 있으면 자율로 안 덮어쓰고 되묻기', pl.toSheet.length === 0 && pl.needsConfirm.length === 2, JSON.stringify(pl.needsConfirm));
ok('되묻기에 기존값·새값 둘 다 보여줌', pl.needsConfirm[0].기존값 && pl.needsConfirm[0].새값, JSON.stringify(pl.needsConfirm[0]));
pl = claim.planSay(claim.parseSay('계좌 국민 123456-01-789012').fields, c철수, 김철수);
ok('같은 값이면 시트 안 건드림', pl.toSheet.length === 0 && pl.same.length >= 1, JSON.stringify(pl.same));

const c수근 = claim.buildClaim(계좌없음, '박수근');
pl = claim.planSay(claim.parseSay('계좌 하나 111-222-333').fields, c수근, 계좌없음.rows[0]);
ok('명단에 계좌 칸이 없으면 → 칸을 새로 만들어 저장(add_column_set)', pl.toSheet.length === 2 && pl.toSheet.every((s) => s.op === 'add_column_set'), JSON.stringify(pl.toSheet));
ok('새로 만들 칸 이름이 [계좌은행]/[계좌번호]', pl.toSheet.map((s)=>s.column).sort().join(',') === '계좌번호,계좌은행', JSON.stringify(pl.toSheet.map((s)=>s.column)));

const c없는사람 = claim.buildClaim(표준, '홍길동');
pl = claim.planSay(claim.parseSay('계좌 국민 123-456').fields, c없는사람, {});
ok('명단에 없는 분 → 명단 저장 안 하고 청구서에만', pl.toSheet.length === 0 && pl.toClaim.length === 2, JSON.stringify(pl.toClaim));
ok('그 사유도 정직히 밝힘', /명단에 없는/.test(pl.toClaim[0].사유), pl.toClaim[0].사유);

// ═══ 6. PDF 실제 생성 + ★제로 저장 확인 ═══
console.log('\n[6] PDF 생성 · ★제로 저장');
(async () => {
  const before = fs.existsSync(path.join(__dirname, 'out')) ? fs.readdirSync(path.join(__dirname, 'out')) : [];
  const buf = await claim.renderClaimPdf(r1);
  ok('PDF Buffer 반환', Buffer.isBuffer(buf) && buf.length > 1000, `${buf && buf.length} bytes`);
  ok('진짜 PDF 파일 형식(%PDF 시그니처)', buf.slice(0, 4).toString() === '%PDF', buf.slice(0, 8).toString());
  const after = fs.existsSync(path.join(__dirname, 'out')) ? fs.readdirSync(path.join(__dirname, 'out')) : [];
  ok('★서버 디스크에 파일 안 남음 (out 폴더 변화 0)', before.length === after.length, `${before.length}→${after.length}`);
  ok('★모듈에 파일쓰기 코드 자체가 없음', !/fs\.(writeFile|createWriteStream|appendFile)/.test(fs.readFileSync(path.join(__dirname, 'claim_form_skill.js'), 'utf8')), 'fs 쓰기 발견');

  // 통계
  console.log(`\n  📊 김철수 청구서: 전체 ${r1.통계.전체}칸 중 자동입력 ${r1.통계.자동입력} · 입력필요 ${r1.통계.입력필요} · 직접기재 ${r1.통계.직접기재}`);
  ok('★"절반 자동 완성" 달성 (자동입력 ≥ 입력필요)', r1.통계.자동입력 >= r1.통계.입력필요, `${r1.통계.자동입력} vs ${r1.통계.입력필요}`);

  // 눈으로 볼 샘플이 필요하면 --save (시험용 가짜 데이터만 · 기본은 저장 안 함)
  if (process.argv.includes('--save')) {
    const p = path.join(require('os').tmpdir(), '_claim_sample.pdf');
    fs.writeFileSync(p, buf); console.log(`  📄 (시험용 가짜데이터 샘플) ${p}`);
  }

  console.log(`\n${fail === 0 ? '✅ 전부 통과' : '❌ 실패 있음'} — ${pass}통과 / ${fail}실패\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('오류:', e.message); process.exit(1); });
