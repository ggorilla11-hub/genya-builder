// _test_policy_text.js — 📄 증권 텍스트 해석 1단계 검증
//
// 대표님 검증 항목 그대로:
//   1. 증권 텍스트 → 핵심 정확히 해석 ★★★
//   2. 해당 고객 명단에 연결
//   3. 다양한 증권 형식 이해 (성배)
//   4. ★환각 0 — 증권에 없는 값은 빈칸이어야 한다
//   5. 증권 얘기를 "말로만" 한 건 증권으로 오인하지 않는다
//
// ★채점 원칙: 정답을 두뇌에게 묻지 않는다. ★원문 글자에 실제로 있는 값과 대조한다.
// 실행: node deploy/_test_policy_text.js
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Anthropic = require('@anthropic-ai/sdk');

const policy = require('./policy_text_skill');
const gate = require('./roster_gate');
const crud = require('./sheets_crud_skill');
const filming = require('./filming_roster');

let 통과 = 0, 실패 = 0; const 실패목록 = [];
function ok(제목, 조건, 실측) {
  if (조건) { 통과++; console.log('  ✅ ' + 제목); }
  else { 실패++; 실패목록.push(제목); console.log('  ❌ ' + 제목 + (실측 !== undefined ? '   ← 실측: ' + 실측 : '')); }
}
const S = (x) => String(x == null ? '' : x).trim();
const 숫자만 = (x) => S(x).replace(/[^\d]/g, '');
const 담았나 = (값, 기대) => S(값).replace(/\s/g, '').includes(S(기대).replace(/\s/g, ''));

// ═══ 서로 다르게 생긴 증권 5종 (성배: 형식이 달라도 이해해야 한다) ═══
const 증권들 = [
  {
    이름: 'A. 표 형식(파이프 표)',
    글: `보험증권
| 항목 | 내용 |
| 보험회사 | 삼성화재해상보험 |
| 상품명 | 무배당 삼성화재 마이헬스파트너 종합보험 |
| 증권번호 | SF-2024-5123357 |
| 계약자 | 김철수 |
| 피보험자 | 김철수 |
| 계약일자 | 2024-08-20 |
| 만기일자 | 2044-08-20 |
| 납입기간 | 20년납 |
| 보험료 | 118,000원 (월납) |
| 갱신여부 | 비갱신형 |
보장내용
| 담보 | 가입금액 |
| 암진단비 | 5,000만원 |
| 뇌혈관질환진단비 | 2,000만원 |
| 허혈성심장질환진단비 | 2,000만원 |
| 수술비 | 300만원 |`,
    기대: { 보험사: '삼성화재', 증권번호: 'SF-2024-5123357', 만기일: '2044-08-20', 보험료숫자: '118000', 담보수최소: 4, 담보포함: '암진단비' },
  },
  {
    이름: 'B. 줄글(문장으로만)',
    글: `이영희 고객님 증권 내용입니다. DB손해보험의 참좋은운전자보험에 2021년 3월 5일에 가입하셨고,
증권번호는 DB-2021-77120 입니다. 매달 4만 3천원씩 20년간 납입하시며 만기는 2041년 3월 5일입니다.
보장은 교통사고처리지원금 2억원, 변호사선임비용 5천만원, 자동차사고 벌금 3천만원이 들어 있습니다.
갱신형이 아닙니다.`,
    기대: { 보험사: 'DB손해보험', 증권번호: 'DB-2021-77120', 담보포함: '교통사고처리지원금', 담보수최소: 3 },
  },
  {
    이름: 'C. 항목 나열(콜론 구분)',
    글: `[보험 가입 확인서]
보험사: 현대해상
상품: 굿앤굿어린이CI보험
증권번호: HD-2019-33401
피보험자: 박서준 (2015-04-11)
계약일: 2019-05-02
납입: 30년납 / 월 62,000원
만기: 2049-05-02
주요보장
 - 어린이CI진단비 3,000만원
 - 입원일당 3만원
 - 골절진단금 50만원
특약: 실손의료비특약, 치아보존치료특약`,
    기대: { 보험사: '현대해상', 증권번호: 'HD-2019-33401', 보험료숫자: '62000', 특약포함: '실손', 담보수최소: 3 },
  },
  {
    이름: 'D. 영문 혼합',
    글: `POLICY CERTIFICATE
Insurer: MetLife Korea (메트라이프생명)
Product: Whole Life Plan (무배당 종신보험)
Policy No: ML-2018-99001
Insured: Choi Min Ho / 최민호
Issue Date: 2018-11-15
Maturity: Whole Life (종신)
Premium: KRW 210,000 per month, 20-year payment
Coverage
 - Death Benefit: 300,000,000 KRW
 - Disability Rider: 50,000,000 KRW`,
    기대: { 보험사포함: '메트라이프', 증권번호: 'ML-2018-99001', 보험료숫자: '210000', 담보수최소: 2 },
  },
  {
    이름: 'E. 값이 많이 빠진 증권 (★환각 검사)',
    글: `보험증권
보험사: KB손해보험
상품명: 무배당 KB건강보험
보장: 암진단비 3,000만원`,
    기대: { 보험사: 'KB손해보험', 빈칸이어야: ['증권번호', '만기일', '보험료', '계약일'], 담보수최소: 1 },
  },
];

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.log('ANTHROPIC_API_KEY 없음 — 건너뜁니다.'); process.exit(0); }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  crud.init({ anthropic, model: 'claude-opus-4-8' });
  filming.enable(crud);
  await crud.loadTable(null);
  gate.init({ anthropic, model: 'claude-sonnet-5', sheetsCrud: crud });   // policy 모듈도 여기서 함께 준비됨

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [1] 다양한 증권 형식을 읽어내는가 (성배) ════════');
  const 결과들 = await Promise.all(증권들.map((c) => policy.extract(c.글).then((r) => ({ c, r }))));
  for (const { c, r } of 결과들) {
    console.log(`\n── ${c.이름}`);
    if (!r.ok) { ok(`${c.이름} 해석됨`, false, r.message); continue; }
    const f = r.fields || {};
    const e = c.기대;
    ok('  해석됨', true);
    if (e.보험사) ok(`  보험사 = ${e.보험사}`, 담았나(f.보험사, e.보험사), S(f.보험사));
    if (e.보험사포함) ok(`  보험사에 '${e.보험사포함}' 들어감`, 담았나(f.보험사, e.보험사포함), S(f.보험사));
    if (e.증권번호) ok(`  증권번호 = ${e.증권번호}`, 담았나(f.증권번호, e.증권번호), S(f.증권번호));
    if (e.만기일) ok(`  만기일 = ${e.만기일}`, 담았나(f.만기일, e.만기일), S(f.만기일));
    if (e.보험료숫자) ok(`  보험료 숫자 = ${e.보험료숫자}`, 숫자만(f.보험료).includes(e.보험료숫자), S(f.보험료));
    if (e.담보수최소) {
      const n = (f.보장내역 || []).filter((x) => S(x && x.담보명)).length;
      ok(`  보장 ${e.담보수최소}개 이상 읽음`, n >= e.담보수최소, n + '개');
    }
    if (e.담보포함) {
      const 다 = (f.보장내역 || []).map((x) => S(x && x.담보명)).join(' ');
      ok(`  보장에 '${e.담보포함}' 있음`, 담았나(다, e.담보포함), 다.slice(0, 60));
    }
    if (e.특약포함) ok(`  특약에 '${e.특약포함}' 있음`, 담았나((f.특약 || []).join(' '), e.특약포함), (f.특약 || []).join(','));
    ok('  설계사 요약을 만들었다', S(f.설계사요약).length > 20, S(f.설계사요약).slice(0, 50));
    // ★환각 검사 — 증권에 없는 값을 채우지 않았는가
    if (e.빈칸이어야) {
      for (const 칸 of e.빈칸이어야) {
        ok(`  ★없는 값 '${칸}' 을(를) 지어내지 않음`, S(f[칸]) === '', S(f[칸]));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [2] ★환각 0 — 원문에 없는 숫자가 답에 끼지 않는가 ════════');
  {
    const r = 결과들[4].r;      // E번(값이 많이 빠진 증권)
    const f = (r && r.fields) || {};
    const 답 = await policy.analyzeText(증권들[4].글, {});
    // ★가짜 통과 차단: 해석이 실패해 오류 문구만 와도 "없는 값을 안 만들었다"로 보인다 → 먼저 성공을 확인한다.
    ok('★해석이 실제로 성공했는가(실패 문구면 아래 검사는 무의미)', 답.viaPolicy === true && /증권 내용을 읽었어요/.test(String(답.text)), String(답.text).slice(0, 80));
    ok('없는 증권번호를 답에도 안 만든다', !/증권번호\s*\|\s*\S/.test(String(답.text)), String(답.text).slice(0, 120));
    ok('보험사·상품명은 제대로 나온다', /KB손해보험/.test(String(답.text)), String(답.text).slice(0, 80));
    ok('보장(암진단비 3,000만원)은 나온다', /암진단비/.test(String(답.text)));
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [3] 해당 고객 명단에 연결 ════════');
  {
    const t = await crud.loadTable(null);
    const 있는이름 = t.rows[0][t.nameCol];
    const a = await policy.analyzeText(증권들[0].글, { 이름힌트: 있는이름 });
    ok(`명단에 있는 고객(${있는이름}) → 찾아서 연결`, a.명단 === '있음', a.명단 + ' / ' + String(a.text).slice(0, 60));
    ok('  반영할지 물어본다(제 맘대로 안 씀)', /반영할까요|반영해줘/.test(String(a.text)), String(a.text).slice(-90));
    ok('  지금 명단 값과 증권 값을 나란히 보여준다', /지금 명단/.test(String(a.text)));

    const b = await policy.analyzeText(증권들[2].글, { 이름힌트: '박서준' });
    ok('명단에 없는 고객(박서준) → 없다고 말하고 추가를 제안', b.명단 === '없음' && /추가할까요/.test(String(b.text)), b.명단 + ' / ' + String(b.text).slice(-80));

    const c = await policy.analyzeText(증권들[4].글, {});
    ok('이름을 안 밝힌 증권 → 누구 것인지 되묻는다', /어느 고객|이름을 알려/.test(String(c.text)), String(c.text).slice(-80));
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [4] 관문 판정 — 증권인지 아닌지 가리는가 ════════');
  {
    const 증권말 = await gate.wants('김철수 증권이야\n' + 증권들[0].글, { canSheet: true });
    ok('★증권 텍스트를 붙여넣으면 통과한다', 증권말 === true);
    const 말뿐1 = await gate.wants('증권 분석 되나요?', { canSheet: true });
    ok('"증권 분석 되나요?"(말뿐) → 증권으로 오인 안 함', 말뿐1 === false, String(말뿐1));
    const 말뿐2 = await gate.wants('증권 올리면 돼?', { canSheet: true });
    ok('"증권 올리면 돼?"(말뿐) → 오인 안 함', 말뿐2 === false, String(말뿐2));
    const st = gate.stats();
    ok('★판정이 실제로 돌았다(오류 0)', st.err === 0, JSON.stringify(st));
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [5] 기존 명단 기능 안 깨짐 ════════');
  {
    const s = await crud.doSearch(null, { column: '만기일', contains: '2026-08' });
    ok('★"만기 2026-08" 검색 여전히 8명', s.ok && s.count === 8, s.count + '명');
    const 명단질문 = await gate.wants('서울 여자 고객', { canSheet: true });
    ok('★명단 질문은 그대로 명단으로 간다', 명단질문 === true);
  }

  console.log('\n' + '═'.repeat(58));
  console.log(`  결과: ✅ ${통과}개 통과 · ❌ ${실패}개 실패`);
  if (실패) { console.log('  실패 항목:'); 실패목록.forEach((x) => console.log('    · ' + x)); }
  console.log('═'.repeat(58) + '\n');
  process.exit(실패 ? 1 : 0);
})().catch((e) => { console.error('시험 도중 오류:', e); process.exit(1); });
