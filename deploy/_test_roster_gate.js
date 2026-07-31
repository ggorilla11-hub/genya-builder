// _test_roster_gate.js — 🛡️ 2층 안전망 검증 (표현이 달라도 뜻으로 통과하는가)
//
// 왜: 관문이 낱말표라 "생년월일 8월인 사람" ✔ / "생일이 8월인 사람" ✘ 로 갈렸다.
//     안전망이 ★뜻으로 판정하는지, 그리고 ★엉뚱한 말까지 끌어가지 않는지를 함께 본다.
//     (한쪽만 보면 안 된다 — 다 통과시키면 일반 대화가 망가진다)
//
// 실행: node deploy/_test_roster_gate.js
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Anthropic = require('@anthropic-ai/sdk');

const gate = require('./roster_gate');
const crud = require('./sheets_crud_skill');
const filming = require('./filming_roster');

let 통과 = 0, 실패 = 0; const 실패목록 = [];
function ok(제목, 조건, 실측) {
  if (조건) { 통과++; console.log('  ✅ ' + 제목); }
  else { 실패++; 실패목록.push(제목); console.log('  ❌ ' + 제목 + (실측 !== undefined ? '   ← 실측: ' + 실측 : '')); }
}

// ★대표님이 실제로 쓰실 법한 말들. 같은 뜻인데 표현만 다르게.
const 명단질문 = [
  '생일이 8월인 사람',          // ★사고의 원인이던 바로 그 말 (예전엔 관문 탈락)
  '생일 8월 모두 보여줘',
  '8월에 태어난 고객',
  '8월생 있어?',
  '태어난 달이 8월인 분',
  '서울 여자 고객',
  '서울 사는 여성분들 알려줘',
  '돈 많이 버는 고객이 누구야',
  '연소득 높은 사람 좀 뽑아줘',
  '나이 많은 분들 누구야',
  '40대 고객 몇 명이야',
  '자동차보험 든 여성',
  '삼성화재 고객 몇 명이야',
  '우리 고객 몇 명이야',
  '무사고인 분들 알려줘',
  '월보험료 3만원 넘는 사람',
];
// ★이건 절대 끌어가면 안 되는 말들(끌어가면 일반 대화·다른 기능이 망가진다)
const 명단아님 = [
  '안녕',
  '고마워',
  '보험이 뭐야',
  '자동차보험 뭐가 좋아?',
  '연금은 언제 받는 게 좋아',
  '요즘 금리 어때',
  '오늘 일정 뭐야',
  '문자 보내줘',
  '결재함에 올려줘',
  '발굴 돌려',
  '제안서 만들어줘',
  '다음',
  '이 파일 분석해줘',
];

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.log('ANTHROPIC_API_KEY 가 없어 판정 시험을 건너뜁니다.'); process.exit(0); }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  crud.init({ anthropic, model: 'claude-opus-4-8' });
  filming.enable(crud);                       // 구글 접근 0 · 80명 표본
  await crud.loadTable(null);                 // 칸 목록을 안전망 판정에 쓰게 미리 읽어둠
  gate.init({ anthropic, model: 'claude-sonnet-5', sheetsCrud: crud });

  console.log('\n════════ [1] 명단 질문인가 — ★표현이 달라도 통과해야 한다 ════════');
  const r1 = await Promise.all(명단질문.map((q) => gate.wants(q, { canSheet: true }).then((v) => ({ q, v }))));
  for (const x of r1) ok(`"${x.q}"`, x.v === true, '탈락(일반 대화로 샘)');

  console.log('\n════════ [2] 명단 질문이 아닌 것 — ★끌어가면 안 된다 ════════');
  const r2 = await Promise.all(명단아님.map((q) => gate.wants(q, { canSheet: true }).then((v) => ({ q, v }))));
  for (const x of r2) ok(`"${x.q}" → 그대로 둔다`, x.v === false, '명단으로 끌어감(사고)');

  // ★★가짜 통과 차단(2026-07-31 실제로 당함): 판정이 전부 오류로 죽으면 [2]가 통째로 ✅ 로 보인다.
  //    "안 끌어감"과 "판정 자체를 못 함"은 완전히 다른 일이다 — 오류가 하나라도 있으면 실패로 본다.
  const st1 = gate.stats();
  ok('★판정이 실제로 돌았는가(오류 0) — 전부 죽으면 [2]가 가짜로 통과한다', st1.err === 0, JSON.stringify(st1));

  console.log('\n════════ [3] 안전 장치 ════════');
  ok('시트 권한 없으면 안전망도 안 켜짐', (await gate.wants('생일이 8월인 사람', { canSheet: false })) === false);
  ok('빈 말은 판정조차 안 함', (await gate.wants('', { canSheet: true })) === false);
  ok('한 글자도 판정 안 함', (await gate.wants('응', { canSheet: true })) === false);

  console.log('\n════════ [4] 통과한 말이 ★정확한 답까지 가는가 (도구 실행) ════════');
  const t = await crud.loadTable(null);
  const 월 = (v) => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? Number(m[2]) : null; };
  const 정답_생일8 = t.rows.filter((r) => 월(r['생년월일']) === 8).length;
  const 정답_서울여 = t.rows.filter((r) => r['성별'] === '여' && String(r['주소']).includes('서울')).length;
  console.log(`   (원본 직접 계산: 8월 생일 ${정답_생일8}명 · 서울 여성 ${정답_서울여}명)`);

  const a1 = await gate.answer('생일이 8월인 사람', {});
  const n1 = String(a1.text || '').match(/(\d+)\s*(명|분)/);
  ok(`★★"생일이 8월인 사람" → 실제 답이 ${정답_생일8}명 (예전엔 만기 8월을 줬다)`,
    !!a1.text && (n1 ? Number(n1[1]) === 정답_생일8 : /한\s*(분|명)|1명/.test(a1.text) && 정답_생일8 === 1),
    String(a1.text || '').replace(/\n/g, ' ').slice(0, 100));

  const a2 = await gate.answer('서울 여자 고객', {});
  const n2 = String(a2.text || '').match(/(\d+)\s*(명|분)/);
  ok(`"서울 여자 고객" → ${정답_서울여}명`, n2 && Number(n2[1]) === 정답_서울여,
    String(a2.text || '').replace(/\n/g, ' ').slice(0, 100));

  console.log('\n' + '═'.repeat(58));
  console.log(`  결과: ✅ ${통과}개 통과 · ❌ ${실패}개 실패   (판정 통계: ${JSON.stringify(gate.stats())})`);
  if (실패) { console.log('  실패 항목:'); 실패목록.forEach((x) => console.log('    · ' + x)); }
  console.log('═'.repeat(58) + '\n');
  process.exit(실패 ? 1 : 0);
})().catch((e) => { console.error('시험 도중 오류:', e); process.exit(1); });
