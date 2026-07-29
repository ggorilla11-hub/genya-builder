// ─────────────────────────────────────────────────────────────
// _test_claim_amount.js — 🩹 보상비서 3단계(지급 구조 안내) 단위 시험
//
// 회장님 검증 9가지를 그대로 시험으로 옮긴 것:
//   1. 지급 구조 안내가 나오는지        2. ★면책 문구 강제 부착(지울 수 없게)
//   3. "산정·확정" 금지어 필터 작동      4. 진료비 입력 → 범위 · ★추측 안 함
//   5. 자동차보험 약관 실제 참고(파인콘)  6. 없는 약관 = "없어요" 정직
//   7. 설계사 전용 표시                 8·9는 회귀 검사(_regression_check.js)가 본다
//
// 실행: node deploy/_test_claim_amount.js
//   · 파인콘·OpenAI 키가 있으면 ★실제 약관 조회까지 한다(검증 5).
//   · 키가 없으면 그 부분은 건너뛰고 "미실행"이라고 정직히 적는다(통과로 꾸미지 않는다).
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const amt = require('./claim_amount_skill');   // ★require 시점에 .env가 읽힌다

// 실제 조회 시험용으로 키를 잠시 보관 → 오프라인 시험을 위해 지웠다가 되돌린다
const KEYS = { PINECONE_API_KEY: process.env.PINECONE_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
const 키있음 = !!(KEYS.PINECONE_API_KEY && KEYS.OPENAI_API_KEY);

let pass = 0, fail = 0, skip = 0;
const T = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '  → ' + e.message); fail++; }
};
const TA = async (name, fn) => {
  try { await fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '  → ' + e.message); fail++; }
};
const SKIP = (name, why) => { console.log('  SKIP  ' + name + '  (' + why + ')'); skip++; };
const ok = (c, m) => { if (!c) throw new Error(m || '조건 실패'); };
const has = (h, n) => ok(String(h).includes(n), `"${n}" 가 없음`);
const hasNot = (h, n) => ok(!String(h).includes(n), `"${n}" 가 있으면 안 됨`);

const src = fs.readFileSync(path.join(__dirname, 'claim_amount_skill.js'), 'utf8');

(async function main() {

console.log('\n━━━ 2. ★면책 문구 — 회장님 문안 그대로 · 강제 부착 ━━━');
T('면책에 "AI 추정치"가 있다', () => has(amt.면책, 'AI 추정치'));
T('면책에 "약관·심사·개별 상황"이 있다', () => has(amt.면책, '약관·심사·개별 상황'));
T('면책에 "손해사정·보험사 확인"이 있다', () => has(amt.면책, '손해사정·보험사 확인'));
T('면책 자체에는 금지어가 없다', () => ok(!amt._금지어남음(amt.면책), '면책에 산정/확정이 있음'));

console.log('\n━━━ 7. 설계사 전용 표시 ━━━');
T('설계사 참고용이라고 명시한다', () => has(amt.설계사전용, '설계사 참고용'));
T('고객에게 그대로 주지 말라고 한다', () => has(amt.설계사전용, '고객에게 그대로 전달하지 마세요'));

console.log('\n━━━ 3. ★"산정·확정" 금지어 필터 ━━━');
T('"산정" → "참고 추정" 으로 바뀐다', () => {
  const r = amt._금지어정리('보험금을 산정합니다');
  hasNot(r, '산정'); has(r, '참고 추정');
});
T('"확정" → "추정" 으로 바뀐다', () => {
  const r = amt._금지어정리('지급액이 확정됩니다');
  hasNot(r, '확정'); has(r, '추정');
});
T('둘 다 섞여 있어도 전부 걸러낸다', () => {
  const r = amt._금지어정리('산정하여 확정하고 다시 산정합니다');
  hasNot(r, '산정'); hasNot(r, '확정');
});
T('★"손해사정"의 "사정"은 건드리지 않는다(면책 문구 보호)', () => {
  has(amt._금지어정리('손해사정·보험사 확인'), '손해사정');
});
T('_금지어남음 이 실제로 잡아낸다', () => {
  ok(amt._금지어남음('산정') === true);
  ok(amt._금지어남음('추정 범위입니다') === false);
});

console.log('\n━━━ 4. 진료비 — 설계사 입력만 · ★추측 안 함 ━━━');
T('숫자로 직접 넣으면 그대로 읽는다', () => ok(amt.진료비읽기('', 3000000) === 3000000));
T('"3,000,000" 처럼 콤마가 있어도 읽는다', () => ok(amt.진료비읽기('', '3,000,000') === 3000000));
T('문장의 "진료비 300만원"을 읽는다', () => ok(amt.진료비읽기('진료비 300만원 나왔어', null) === 3000000));
T('"손해액 5,000,000원"을 읽는다', () => ok(amt.진료비읽기('손해액 5,000,000원', null) === 5000000));
T('★진료비 얘기가 없으면 null — 지어내지 않는다', () => ok(amt.진료비읽기('김철수 무릎수술 실손 얼마 나와?', null) === null));
T('0이나 이상한 값은 null', () => { ok(amt.진료비읽기('', 0) === null); ok(amt.진료비읽기('', 'abc') === null); });

console.log('\n━━━ 4-2. 참고 범위 — ★약관 숫자가 있을 때만 ━━━');
const 가짜발췌 = [{ page: 12, text: '보험회사는 실제 치료비의 80%를 보상합니다. 다만 1회 사고당 3,000만원을 한도로 합니다.' }];
T('발췌에서 비율(80%)을 뽑는다', () => {
  const b = amt.비율뽑기(가짜발췌);
  ok(b.length === 1 && b[0].값 === 80, JSON.stringify(b));
  ok(b[0].page === 12);
});
T('발췌에서 한도(3,000만원)를 뽑는다', () => {
  const h = amt.한도뽑기(가짜발췌);
  ok(h.some((x) => x.원 === 30000000), JSON.stringify(h.map((x) => x.원)));
});
T('중복 문장은 후보에서 한 번만 나온다', () => {
  const 중복 = [{ page: 28, text: '자기부담금 20% 입니다.' }, { page: 28, text: '자기부담금 20% 입니다.' }];
  ok(amt.비율뽑기(중복).length === 1, '중복 제거 안 됨');
});
T('★★설계사가 비율을 안 고르면 계산하지 않는다 (2026-07-29 사고 재발 방지)', () => {
  const r = amt.참고범위(3000000, null, 0, 0);
  ok(r.있음 === false, '비율을 안 골랐는데 금액이 나옴');
  has(r.사유, '설계사');
  has(r.사유, '임의로 고르지 않습니다');
});
T('설계사가 80%를 고르면 그때 계산한다 — 300만 × 80% = 240만', () => {
  const r = amt.참고범위(3000000, 80, 0, 0);
  ok(r.있음 === true); ok(r.최소 === 2400000, r.최소);
  has(r.계산식, '80%');
});
T('자기부담금을 넣으면 먼저 뺀다 — (300만 − 50만) × 80% = 200만', () => {
  const r = amt.참고범위(3000000, 80, 500000, 0);
  ok(r.최소 === 2000000, r.최소);
  has(r.계산식, '500,000원');
});
T('설계사가 고른 한도가 있으면 위를 자른다', () => {
  const r = amt.참고범위(100000000, 80, 0, 30000000);
  ok(r.최소 === 30000000, r.최소);
  ok(r.한도적용 === 30000000);
});
T('★진료비가 없으면 금액을 내지 않는다', () => {
  const r = amt.참고범위(null, 80, 0, 0);
  ok(r.있음 === false); has(r.사유, '진료비');
});
T('비율이 0·100 초과면 계산하지 않는다', () => {
  ok(amt.참고범위(3000000, 0, 0, 0).있음 === false);
  ok(amt.참고범위(3000000, 150, 0, 0).있음 === false);
});

console.log('\n━━━ 6. 약관 없을 때 — "없어요" 정직 · ★금액 안 냄 ━━━');
delete process.env.PINECONE_API_KEY; delete process.env.OPENAI_API_KEY;   // 창고 연결 끊긴 상황
await TA('약관 근거 없으면 약관근거=false', async () => {
  const r = await amt.explain('김철수 무릎수술 삼성화재 실손, 대략 얼마 나와?', 3000000);
  ok(r.ok === true); ok(r.약관근거 === false, '약관근거=' + r.약관근거);
});
await TA('★진료비를 넣어도 금액을 내지 않는다', async () => {
  const r = await amt.explain('실손 얼마', 3000000);
  ok(r.참고범위.있음 === false, '약관 없는데 금액이 나옴');
  has(r.참고범위.사유, '지어내지 않음');
});
await TA('무엇을 알아야 하는지(필요정보)를 알려준다', async () => {
  const r = await amt.explain('실손 얼마', null);
  ok(r.필요정보.length >= 5, '필요정보=' + r.필요정보.length);
  has(r.필요정보.join('|'), '본인부담금');
  has(r.필요정보.join('|'), '보상 비율');
});
await TA('★필요정보에 구체 수치를 넣지 않는다(지어내기 0)', async () => {
  const r = await amt.explain('실손 얼마', null);
  ok(!/\d+\s*%/.test(r.필요정보.join(' ')), '필요정보에 %가 들어감');
});
await TA('실손 약관이 아직 없다고 정직히 말한다', async () => {
  const r = await amt.explain('실손 얼마', null);
  has(r.알림.join(' '), '실손');
  has(r.알림.join(' '), '아직');
});
await TA('★면책·설계사전용이 이때도 붙는다', async () => {
  const r = await amt.explain('실손 얼마', null);
  ok(r.면책 === amt.면책); ok(r.설계사전용 === amt.설계사전용);
});
await TA('빈 입력이어도 면책·설계사전용이 붙는다', async () => {
  const r = await amt.explain('', null);
  ok(r.ok === false);
  ok(r.면책 === amt.면책); ok(r.설계사전용 === amt.설계사전용);
});
process.env.PINECONE_API_KEY = KEYS.PINECONE_API_KEY; process.env.OPENAI_API_KEY = KEYS.OPENAI_API_KEY;

console.log('\n━━━ 5. ★파인콘 자동차보험 약관 실제 참고 ━━━');
if (!키있음) {
  SKIP('실제 약관 조회', 'PINECONE/OPENAI 키 없음 — 통과로 꾸미지 않음');
} else {
  await TA('자동차보험 약관에서 실제 발췌를 찾아온다', async () => {
    const r = await amt.약관발췌('자기신체사고 보험금은 어떻게 정해지나요');
    ok(r.found === true, '발췌를 못 찾음: ' + (r.사유 || ''));
    ok(r.발췌.length > 0);
    ok(r.발췌[0].text.length > 10, '발췌 원문이 비었음');
  });
  await TA('출처에 삼성화재 자동차보험 + 페이지가 붙는다', async () => {
    const r = await amt.약관발췌('대인배상 보험금 지급 기준');
    ok(r.found === true, r.사유 || '');
    has(r.sources.join('|'), '삼성화재 개인용 자동차보험');
    ok(/p\.\d+/.test(r.sources[0]), '페이지 표기가 없음: ' + r.sources[0]);
  });
  await TA('explain 이 실제 약관 근거로 답한다(구조 안내)', async () => {
    const r = await amt.explain('삼성화재 자기신체사고 지급 구조 알려줘', null);
    ok(r.ok === true);
    ok(r.약관근거 === true, '약관 근거를 못 씀: ' + (r.사유 || ''));
    ok(r.출처 && r.출처.length > 0);
    ok(r.발췌 && r.발췌.length > 0 && r.발췌[0].원문.length > 10, '원문 발췌가 비었음');
  });
  await TA('★실제 응답에도 금지어가 남지 않는다', async () => {
    const r = await amt.explain('삼성화재 대인배상 지급 구조', null);
    const 본문 = [r.구조설명 || '', (r.알림 || []).join(' ')].join(' ');
    ok(!amt._금지어남음(본문), '응답에 산정/확정이 남음: ' + 본문.slice(0, 120));
  });
  await TA('★★진료비를 넣어도 비율을 안 고르면 금액이 안 나온다 (실물 사고 재발 방지)', async () => {
    const r = await amt.explain('삼성화재 자기신체사고 지급 구조', { 진료비: 3000000 });
    ok(r.약관근거 === true, '약관 근거를 못 씀');
    ok(r.참고범위.있음 === false, '★비율을 고르지 않았는데 금액이 나옴 — 2026-07-29 사고 재발');
    has(r.알림.join(' '), '스스로 고르지 않습니다');
  });
  await TA('약관에서 찾은 비율은 "후보"로 문장과 함께 보여준다', async () => {
    const r = await amt.explain('삼성화재 자기차량손해 자기부담금', { 진료비: 3000000 });
    ok(Array.isArray(r.비율후보), '비율후보가 없음');
    if (r.비율후보.length) {
      ok(r.비율후보[0].약관문장 && r.비율후보[0].약관문장.length > 5, '후보에 약관 문장이 없음');
      ok(r.비율후보[0].page > 0, '후보에 페이지가 없음');
    }
  });
  await TA('설계사가 비율을 고르면 그때 참고 범위가 나온다', async () => {
    const r = await amt.explain('삼성화재 자기차량손해', { 진료비: 3000000, 적용비율: 80, 자기부담금: 500000 });
    ok(r.참고범위.있음 === true, '고른 비율로도 계산이 안 됨');
    ok(r.참고범위.최소 === 2000000, r.참고범위.최소);
    has(r.참고범위.표기, '추정');
  });
}

console.log('\n━━━ 소스 검사 — 금지 항목이 코드에 아예 없는가 ━━━');
T('[발송 금지] 발송 코드가 없다', () => {
  [/solapi/i, /sendMessage/i, /nodemailer/i, /sendSms/i, /\/api\/approval/i].forEach((re) =>
    ok(!re.test(src), '발송 흔적: ' + re));
});
T('[무접촉] yakgwan_module 을 수정하지 않는다(require도 안 함)', () => {
  ok(!/require\(['"]\.\/yakgwan_module/.test(src), 'yakgwan_module 을 끌어씀');
});
T('[무접촉] 파일 쓰기·시트 쓰기가 없다', () => {
  [/fs\.write/, /appendFile/, /spreadsheets\.values\.update/].forEach((re) =>
    ok(!re.test(src), '무접촉 위반: ' + re));
});
T('[제로 인그레스] console 출력이 없다', () => ok(!/console\.(log|info|warn)/.test(src)));
T('[지어내기 금지] 비율·한도가 코드에 하드코딩돼 있지 않다', () => {
  // 약관에서 뽑아야 한다. 코드 안에 "80" 같은 보상비율 상수가 박혀 있으면 안 된다.
  ok(!/보상비율\s*=\s*\d/.test(src), '보상비율이 하드코딩됨');
  ok(!/DEFAULT_RATE|기본비율/.test(src), '기본 비율이 있음');
});

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  통과 ${pass} · 실패 ${fail} · 미실행 ${skip}   (전체 ${pass + fail + skip})`);
if (skip) console.log(`  ※ 미실행 ${skip}건은 통과가 아닙니다 — 키가 있는 곳에서 다시 돌려야 합니다.`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
process.exit(fail ? 1 : 0);

})();
