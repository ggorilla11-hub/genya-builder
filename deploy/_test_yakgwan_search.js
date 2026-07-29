// ─────────────────────────────────────────────────────────────
// _test_yakgwan_search.js — 📚 약관 공용 검색 엔진 시험 (2026-07-29)
//
// 회장님 검증 7가지를 그대로 옮긴 것:
//   1. "삼성화재 실손 지급 구조" → 실손 약관 찾음 ★★★ (★장기에 숨은 것까지)
//   2. "현대해상 실손" → 현대 실손 찾음
//   3. 약관 질문 기능(askYakgwan)이 실손·장기·현대 다 찾음
//   4. 못 찾는 건 "없다" 정직
//   5. 금액은 면책·설계사 전용 유지 (3단계 무너지지 않았나)
//   6. 개인정보 노출 0 (개인 기억 네임스페이스를 쳐다보지 않는가)
//   7. ★공용 함수라 나중에 다른 기능이 쓸 수 있는 구조
//
// 실행: node deploy/_test_yakgwan_search.js   (deploy 폴더에서 — .env를 읽어야 실조회)
//   키가 없으면 실조회는 건너뛰고 "미실행"이라 적는다(통과로 꾸미지 않는다).
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const yak = require('./yakgwan_search');
const mod = require('./yakgwan_module');
const amt = require('./claim_amount_skill');

let pass = 0, fail = 0, skip = 0;
const T = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + '  → ' + e.message); fail++; } };
const TA = async (n, f) => { try { await f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + '  → ' + e.message); fail++; } };
const SKIP = (n, w) => { console.log('  SKIP  ' + n + '  (' + w + ')'); skip++; };
const ok = (c, m) => { if (!c) throw new Error(m || '조건 실패'); };
const has = (h, n) => ok(String(h).includes(n), `"${n}" 가 없음`);

const 키있음 = yak.configured();
const src검색 = fs.readFileSync(path.join(__dirname, 'yakgwan_search.js'), 'utf8');

(async function main() {

console.log('\n━━━ 0. 규칙 기반 판별 (키 없이도 되는 것) ━━━');
T('질문에서 보험사를 알아챈다', () => {
  ok(yak.보험사찾기('삼성화재 실손 얼마') === '삼성화재');
  ok(yak.보험사찾기('현대해상 암진단비') === '현대해상');
  ok(yak.보험사찾기('KB손보 운전자') === 'KB손해보험');
});
T('보험사를 안 쓰면 null (지어내지 않는다)', () => ok(yak.보험사찾기('실손 얼마') === null));
T('질문에서 상품군을 알아챈다', () => {
  ok(yak.상품군찾기('실손 본인부담금') === '실손');
  ok(yak.상품군찾기('암 진단비 면책') === '건강');
  ok(yak.상품군찾기('대인배상 과실상계') === '자동차');
});
T('★실손은 후보군이 3개다 (indemnity·longterm·health) — 장기에 숨은 함정 대응', () => {
  const g = yak.군확장['실손'];
  ok(g.includes('indemnity') && g.includes('longterm') && g.includes('health'), JSON.stringify(g));
});
T('★후보를 여러 개 고른다 (한 곳만 보지 않는다)', () => {
  const 가짜맵 = [
    { 네임스페이스: 'yakgwan_samsungfire_longterm_2026', 보험사: '삼성화재', 상품군코드: 'longterm', 연도숫자: 2026, 개수: 46824 },
    { 네임스페이스: 'yakgwan_samsungfire_health_2026', 보험사: '삼성화재', 상품군코드: 'health', 연도숫자: 2026, 개수: 173858 },
    { 네임스페이스: 'yakgwan_hyundai_indemnity_2026', 보험사: '현대해상', 상품군코드: 'indemnity', 연도숫자: 2026, 개수: 4413 },
  ];
  const c = yak.후보고르기(가짜맵, '삼성화재', '실손', 6);
  ok(c.length === 2, '삼성화재 후보 수=' + c.length);
  ok(c[0].상품군코드 === 'longterm', '실손은 longterm이 먼저 와야 한다: ' + c[0].상품군코드);
});

console.log('\n━━━ 6·7. 개인정보 0 · 공용 구조 ━━━');
T('★개인 기억(owner_*)은 쳐다보지도 않는다', () => {
  ok(/startsWith\('yakgwan_'\)/.test(src검색), '약관만 거르는 코드가 없음');
  ok(!/owner_/.test(src검색.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')), '코드에 owner_ 접근이 있음');
});
T('쓰기·삭제 코드가 없다(읽기 전용)', () => {
  [/\.upsert\(/, /\.deleteAll\(/, /\.deleteMany\(/, /\.update\(/].forEach((re) => ok(!re.test(src검색), '쓰기 흔적: ' + re));
});
T('발송 코드가 없다', () => {
  [/solapi/i, /sendMessage/i, /nodemailer/i].forEach((re) => ok(!re.test(src검색), '발송 흔적: ' + re));
});
T('★공용 구조 — search·ask·지도·창고요약이 밖으로 열려 있다', () => {
  ['search', 'ask', '지도', '창고요약', 'configured'].forEach((k) => ok(typeof yak[k] === 'function', k + ' 없음'));
});
T('★특정 기능에 종속되지 않는다 (보상비서·청구서를 끌어쓰지 않음)', () => {
  ok(!/require\(['"]\.\/claim_/.test(src검색), '보상비서를 끌어씀');
  ok(!/require\(['"]\.\/main_server/.test(src검색), '메인 서버를 끌어씀');
});
// ★주석은 빼고 본다 — 사고 기록 주석에 옛 이름이 남아 있는 건 정상(오히려 남겨야 한다)
const 코드만 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
T('★네임스페이스 하드코딩이 없다 (약관 늘면 자동 반영)', () => {
  ok(!/yakgwan_samsung_auto_2025/.test(코드만(src검색)), '옛 하드코딩이 코드에 남아있음');
  ok(/describeIndexStats/.test(src검색), '지도를 자동 생성하지 않음');
});
T('기존 껍데기(yakgwan_module)가 겉모습을 지킨다 — 호출부 무접촉', () => {
  ok(typeof mod.askYakgwan === 'function');
  const s = fs.readFileSync(path.join(__dirname, 'yakgwan_module.js'), 'utf8');
  ok(/require\('\.\/yakgwan_search'\)/.test(s), '공용 엔진을 안 씀');
  ok(!/yakgwan_samsung_auto_2025/.test(코드만(s)), '옛 하드코딩이 코드에 남아있음');
});
T('★문턱값이 실측 근거와 함께 적혀 있다 (짐작으로 바꾸지 못하게)', () => {
  ok(yak.MIN_SCORE >= 0.45, 'MIN_SCORE=' + yak.MIN_SCORE + ' — 잡음이 통과한다');
  has(src검색, '실측');
});

console.log('\n━━━ 5. 금액 경계 (3단계가 무너지지 않았나) ━━━');
T('면책 문구 그대로', () => { has(amt.면책, 'AI 추정치'); has(amt.면책, '손해사정·보험사 확인'); });
T('설계사 전용 표시 그대로', () => has(amt.설계사전용, '고객에게 그대로 전달하지 마세요'));
T('금지어 필터 그대로', () => { ok(!amt._금지어남음(amt._금지어정리('산정 확정'))); });
T('★비율을 안 고르면 여전히 금액을 안 낸다', () => {
  const r = amt.참고범위(3000000, null, 0, 0);
  ok(r.있음 === false); has(r.사유, '임의로 고르지 않습니다');
});

if (!키있음) {
  console.log('\n━━━ 1~4. 실제 파인콘 조회 ━━━');
  SKIP('실조회 전체', 'PINECONE/OPENAI 키 없음 — deploy 폴더에서 실행하세요');
} else {

  console.log('\n━━━ 창고 현황 (실조회) ━━━');
  let 요약 = null;
  await TA('창고요약이 보험사 5곳·약관 60종 이상을 본다', async () => {
    요약 = await yak.창고요약();
    ok(요약.약관수 >= 60, '약관수=' + 요약.약관수);
    ok(요약.총청크 > 500000, '총청크=' + 요약.총청크);
    ok(요약.보험사.length >= 5, '보험사=' + 요약.보험사.length);
  });
  T('삼성화재·현대해상·KB가 다 보인다', () => {
    const 이름 = 요약.보험사.map((x) => x.보험사).join('|');
    ['삼성화재', '현대해상', 'KB손해보험'].forEach((n) => has(이름, n));
  });

  console.log('\n━━━ 1. ★★★ "삼성화재 실손 지급 구조" → 실손 약관 (장기에 숨은 것까지) ━━━');
  await TA('실손 약관 발췌를 찾아온다', async () => {
    const r = await yak.search({ 질문: '삼성화재 실손 본인부담금과 보상 비율은 어떻게 되나요', topK: 5 });
    ok(r.found === true, '못 찾음: ' + (r.사유 || ''));
    ok(r.보험사 === '삼성화재', '보험사=' + r.보험사);
    ok(r.상품군 === '실손', '상품군=' + r.상품군);
    const 상품 = r.발췌.map((x) => x.상품).join(' | ');
    ok(/실손|의료비/.test(상품), '실손 상품이 안 나옴: ' + 상품.slice(0, 120));
  });
  await TA('★장기(longterm) 네임스페이스에서 찾아낸다 — 옛 코드로는 불가능했던 것', async () => {
    const r = await yak.search({ 질문: '삼성화재 실손의료비 통원 자기부담금', topK: 5 });
    ok(r.found === true);
    const ns = r.발췌.map((x) => x.네임스페이스).join(',');
    ok(/longterm|indemnity/.test(ns), '실손이 있는 네임스페이스가 아님: ' + ns);
  });

  console.log('\n━━━ 2. "현대해상 실손" → 현대 실손 ━━━');
  await TA('현대해상 실손을 찾는다', async () => {
    const r = await yak.search({ 질문: '현대해상 실손의료비 보장 입원 급여 의료비', topK: 5 });
    ok(r.found === true, r.사유 || '');
    ok(r.보험사 === '현대해상', '보험사=' + r.보험사);
    const s = r.발췌.map((x) => x.보험사 + ' ' + x.상품).join(' | ');
    has(s, '현대해상');
  });
  await TA('보험사를 지정하면 그 보험사만 본다', async () => {
    const r = await yak.search({ 질문: '암 진단비 지급 조건', 보험사: '현대해상', topK: 4 });
    ok(r.found === true, r.사유 || '');
    ok(r.찾아본곳.every((n) => n.includes('hyundai')), '다른 보험사가 섞임: ' + r.찾아본곳.join(','));
  });

  console.log('\n━━━ 3. 약관 질문 기능(askYakgwan)도 다 찾는다 ━━━');
  await TA('askYakgwan이 실손을 찾는다 (예전엔 "없어요"라고 했다)', async () => {
    const r = await mod.askYakgwan('삼성화재 실손의료비 본인부담금');
    ok(r.found === true, '못 찾음: ' + r.answer);
    ok(r.sources.length > 0, '출처 없음');
    ok(/p\.\d+/.test(r.sources[0]), '페이지 표기 없음: ' + r.sources[0]);
  });
  await TA('askYakgwan 출력 모양이 예전과 같다 (호출부 무접촉)', async () => {
    const r = await mod.askYakgwan('대인배상 과실상계');
    ['found', 'answer', 'sources', 'pages'].forEach((k) => ok(k in r, k + ' 없음'));
    ok(Array.isArray(r.sources) && Array.isArray(r.pages));
    ok(typeof r.answer === 'string' && r.answer.length > 0);
  });
  await TA('askYakgwan이 자동차보험도 그대로 찾는다 (기존 기능 보존)', async () => {
    const r = await mod.askYakgwan('무보험차상해 보상 기준');
    ok(r.found === true, '자동차 약관을 못 찾음 — 기존 기능 회귀: ' + r.answer);
  });

  console.log('\n━━━ 4. 못 찾는 건 "없다" 정직 ━━━');
  await TA('창고에 없는 주제는 found=false', async () => {
    const r = await yak.search({ 질문: '떡볶이 맛있게 만드는 법 고추장 비율', topK: 3 });
    ok(r.found === false, '엉뚱한 질문에 근거를 만들어냄');
    ok(Array.isArray(r.찾아본곳) && r.찾아본곳.length > 0, '어디를 찾아봤는지 안 알려줌');
  });
  await TA('askYakgwan도 "지어내지 않음"이라 말한다', async () => {
    const r = await mod.askYakgwan('떡볶이 황금 레시피');
    ok(r.found === false);
    has(r.answer, '지어내지 않음');
  });
  await TA('없는 보험사를 지정해도 지어내지 않는다', async () => {
    const r = await yak.search({ 질문: '보험금 지급', 보험사: '없는손해보험', topK: 3 });
    ok(r.찾아본곳.length > 0, '찾아본 곳을 안 알려줌');
  });

  console.log('\n━━━ 5-2. 보상비서 3단계가 실손을 살렸나 ━━━');
  await TA('★3단계가 삼성화재 실손 약관 근거로 답한다', async () => {
    const r = await amt.explain('삼성화재 실손의료비 본인부담금 지급 구조', null);
    ok(r.ok === true);
    ok(r.약관근거 === true, '★여전히 약관을 못 찾음 — 연결 실패: ' + (r.사유 || ''));
    ok(r.출처 && r.출처.length > 0, '출처 없음');
  });
  await TA('3단계도 면책·설계사전용을 계속 붙인다', async () => {
    const r = await amt.explain('삼성화재 실손 지급 구조', null);
    ok(r.면책 === amt.면책); ok(r.설계사전용 === amt.설계사전용);
  });
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  통과 ${pass} · 실패 ${fail} · 미실행 ${skip}   (전체 ${pass + fail + skip})`);
if (skip) console.log(`  ※ 미실행은 통과가 아닙니다.`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
process.exit(fail ? 1 : 0);

})();
