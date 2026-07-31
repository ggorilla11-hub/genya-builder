// _test_sheets_filter.js — 🔪 1층(조건 필터) + 🧾 3층(칸 목록) 대량 검증
//
// 왜 이 시험이 필요한가:
//   지금까지 명단 검색이 "글자 찾기" 하나뿐이라 "생일이 8월" 을 시키면 '-08-' 를 20칸 전부에서
//   찾아 ★만기일·가입일이 섞였다. 이 시험은 그 사고가 다시 나는지를 ★실제 데이터로 확인한다.
//
// ★채점 원칙: 정답을 엔진에게 묻지 않는다. 명단 원본을 이 파일이 ★직접 세어 정답을 만들고,
//   도구가 낸 답과 맞춰 본다. (엔진이 스스로 채점하면 틀려도 통과한다)
//
// 실행: node deploy/_test_sheets_filter.js
'use strict';

let 통과 = 0, 실패 = 0;
const 실패목록 = [];
function ok(제목, 조건, 실측) {
  if (조건) { 통과++; console.log('  ✅ ' + 제목); }
  else { 실패++; 실패목록.push(제목); console.log('  ❌ ' + 제목 + (실측 !== undefined ? '   ← 실측: ' + 실측 : '')); }
}

const crud = require('./sheets_crud_skill');
const filming = require('./filming_roster');   // 구글을 안 부르는 80명 표본(실제 고객 명단 무접촉)

// ── 정답을 직접 세는 도구(엔진과 무관한 단순 계산) ─────────────────
const 월 = (v) => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? Number(m[2]) : null; };
const 연 = (v) => { const m = String(v || '').match(/^(\d{4})-/); return m ? Number(m[1]) : null; };
const 숫 = (v) => { const m = String(v || '').replace(/,/g, '').match(/\d+/); return m ? Number(m[0]) : null; };
const 만나이 = (v, 오늘) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return null;
  let a = 오늘.y - Number(m[1]);
  if (오늘.m < Number(m[2]) || (오늘.m === Number(m[2]) && 오늘.d < Number(m[3]))) a--;
  return a;
};

(async () => {
  filming.enable(crud);
  const t = await crud.loadTable(null);
  const rows = t.rows;
  const H = (이름) => crud.resolveColumn(이름, t.header);   // 실제 칸 이름 해석(CSV 바뀌어도 견디게)
  const C생일 = H('생년월일'), C만기 = H('만기일'), C가입 = H('가입일');
  const C소득 = H('연소득'), C보험료 = H('월보험료'), C성별 = H('성별');
  const C상품 = H('가입상품'), C보험사 = H('보험사'), C주소 = H('주소');
  const 오늘 = crud._filter.todayKST();

  console.log('\n════════ 재료창고 확인 ════════');
  ok('명단 80명 · 칸 20개', rows.length === 80 && t.header.length === 20, rows.length + '명/' + t.header.length + '칸');
  ok('필요한 칸이 전부 잡힘', [C생일, C만기, C가입, C소득, C보험료, C성별, C상품, C보험사, C주소].every(Boolean),
    [C생일, C만기, C가입, C소득, C보험료, C성별, C상품, C보험사, C주소].join('|'));

  const S = (args) => crud.doSearch(null, args);

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [A] 날짜 — 생일·만기·가입 각각 · 월/년/범위 ════════');
  // ★이 사건의 핵심: 생일 8월 vs 만기 8월이 갈리는가
  const 정답_생일8 = rows.filter((r) => 월(r[C생일]) === 8).length;
  const 정답_만기8 = rows.filter((r) => 월(r[C만기]) === 8).length;
  const 정답_가입8 = rows.filter((r) => 월(r[C가입]) === 8).length;
  console.log(`   (원본 직접 계산: 생일 8월 ${정답_생일8}명 · 만기 8월 ${정답_만기8}명 · 가입 8월 ${정답_가입8}명)`);
  ok('★세 칸의 8월 인원이 서로 다르다 = 섞이면 반드시 틀린다',
    new Set([정답_생일8, 정답_만기8, 정답_가입8]).size > 1, `${정답_생일8}/${정답_만기8}/${정답_가입8}`);

  let s = await S({ filters: [{ column: '생년월일', op: 'month', value: 8 }] });
  ok(`★★"생일이 8월인 사람" → ${정답_생일8}명 (사고의 원인이던 바로 그 질문)`, s.ok && s.count === 정답_생일8, s.count + '명');
  ok('  └ 무슨 기준으로 걸렀는지 밝힌다', /생년월일.*8월/.test(String(s.조건 || '')), s.조건);
  ok('  └ 걸린 사람 전원이 진짜 8월생', (s.matches || []).every((r) => 월(r[C생일]) === 8),
    (s.matches || []).map((r) => r[C생일]).slice(0, 5).join(','));

  s = await S({ filters: [{ column: '만기일', op: 'month', value: 8 }] });
  ok(`"8월 만기" → ${정답_만기8}명`, s.ok && s.count === 정답_만기8, s.count + '명');
  s = await S({ filters: [{ column: '가입일', op: 'month', value: 8 }] });
  ok(`"8월에 가입한 사람" → ${정답_가입8}명`, s.ok && s.count === 정답_가입8, s.count + '명');

  const 정답_만기2026 = rows.filter((r) => 연(r[C만기]) === 2026).length;
  s = await S({ filters: [{ column: '만기일', op: 'year', value: 2026 }] });
  ok(`"2026년 만기" → ${정답_만기2026}명`, s.ok && s.count === 정답_만기2026, s.count + '명');

  const 정답_하반기 = rows.filter((r) => { const v = String(r[C만기] || ''); return v >= '2026-07' && v <= '2026-12-31'; }).length;
  s = await S({ filters: [{ column: '만기일', op: 'between', value: '2026-07', value2: '2026-12' }] });
  ok(`"2026년 하반기 만기"(범위) → ${정답_하반기}명`, s.ok && s.count === 정답_하반기, s.count + '명');

  const 정답_만기지남 = rows.filter((r) => String(r[C만기] || '') < '2026-07-31').length;
  s = await S({ filters: [{ column: '만기일', op: 'lt', value: '2026-07-31' }] });
  ok(`"만기 지난 사람"(날짜 미만) → ${정답_만기지남}명`, s.ok && s.count === 정답_만기지남, s.count + '명');

  const 정답_40대 = rows.filter((r) => { const a = 만나이(r[C생일], 오늘); return a != null && a >= 40 && a <= 49; }).length;
  s = await S({ filters: [{ column: '생년월일', op: 'age_between', value: 40, value2: 49 }] });
  ok(`"40대"(만 나이) → ${정답_40대}명`, s.ok && s.count === 정답_40대, s.count + '명');

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [B] 숫자 — 연소득·보험료 이상/이하/범위 ════════');
  const 정답_소득5천 = rows.filter((r) => (숫(r[C소득]) || 0) >= 5000).length;
  s = await S({ filters: [{ column: '연소득', op: 'gte', value: 5000 }] });
  ok(`"연소득 5천(만원) 이상" → ${정답_소득5천}명`, s.ok && s.count === 정답_소득5천, s.count + '명');

  const 정답_보험료3만 = rows.filter((r) => (숫(r[C보험료]) || 0) >= 30000).length;
  s = await S({ filters: [{ column: '월보험료', op: 'gte', value: 30000 }] });
  ok(`"월보험료 3만원 이상"(쉼표 있는 값) → ${정답_보험료3만}명`, s.ok && s.count === 정답_보험료3만, s.count + '명');

  const 정답_보험료이하 = rows.filter((r) => (숫(r[C보험료]) || 0) <= 10000).length;
  s = await S({ filters: [{ column: '월보험료', op: 'lte', value: 10000 }] });
  ok(`"월보험료 1만원 이하" → ${정답_보험료이하}명`, s.ok && s.count === 정답_보험료이하, s.count + '명');

  const 정답_소득범위 = rows.filter((r) => { const n = 숫(r[C소득]) || 0; return n >= 3000 && n <= 6000; }).length;
  s = await S({ filters: [{ column: '연소득', op: 'between', value: 3000, value2: 6000 }] });
  ok(`"연소득 3천~6천" → ${정답_소득범위}명`, s.ok && s.count === 정답_소득범위, s.count + '명');

  const 정답_초과 = rows.filter((r) => (숫(r[C소득]) || 0) > 5000).length;
  s = await S({ filters: [{ column: '연소득', op: 'gt', value: 5000 }] });
  ok(`"연소득 5천 초과"(이상과 달라야 정상)`, s.ok && s.count === 정답_초과, `초과 ${s.count} vs 이상 ${정답_소득5천}`);

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [C] 텍스트 — 상품·보험사·지역·성별 ════════');
  const 정답_여 = rows.filter((r) => String(r[C성별]).trim() === '여').length;
  s = await S({ filters: [{ column: '성별', op: 'equals', value: '여' }] });
  ok(`"여성 고객" → ${정답_여}명`, s.ok && s.count === 정답_여, s.count + '명');

  const 정답_서울 = rows.filter((r) => String(r[C주소]).includes('서울')).length;
  s = await S({ filters: [{ column: '주소', op: 'contains', value: '서울' }] });
  ok(`"서울 사는 고객" → ${정답_서울}명`, s.ok && s.count === 정답_서울, s.count + '명');

  const 첫보험사 = String(rows[0][C보험사] || '');
  const 정답_보험사 = rows.filter((r) => String(r[C보험사]) === 첫보험사).length;
  s = await S({ filters: [{ column: '보험사', op: 'equals', value: 첫보험사 }] });
  ok(`"${첫보험사} 고객" → ${정답_보험사}명`, s.ok && s.count === 정답_보험사, s.count + '명');

  const 정답_건강 = rows.filter((r) => String(r[C상품]).includes('건강')).length;
  s = await S({ filters: [{ column: '가입상품', op: 'contains', value: '건강' }] });
  ok(`"건강보험 가입자" → ${정답_건강}명`, s.ok && s.count === 정답_건강, s.count + '명');

  const 정답_비여 = rows.filter((r) => String(r[C성별]).trim() !== '여').length;
  s = await S({ filters: [{ column: '성별', op: 'not_equals', value: '여' }] });
  ok(`"여성이 아닌 고객" → ${정답_비여}명`, s.ok && s.count === 정답_비여, s.count + '명');

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [D] 결합 — 2개·3개 · AND/OR ════════');
  const 정답_여서울 = rows.filter((r) => String(r[C성별]).trim() === '여' && String(r[C주소]).includes('서울')).length;
  s = await S({ filters: [{ column: '성별', op: 'equals', value: '여' }, { column: '주소', op: 'contains', value: '서울' }] });
  ok(`"서울 사는 여성"(2개 AND) → ${정답_여서울}명`, s.ok && s.count === 정답_여서울, s.count + '명');

  const 정답_3개 = rows.filter((r) => String(r[C성별]).trim() === '여' && (숫(r[C소득]) || 0) >= 5000 && 월(r[C만기]) === 8).length;
  s = await S({ filters: [
    { column: '성별', op: 'equals', value: '여' },
    { column: '연소득', op: 'gte', value: 5000 },
    { column: '만기일', op: 'month', value: 8 },
  ] });
  ok(`"8월 만기 · 연소득 5천 이상 · 여성"(3개 AND) → ${정답_3개}명`, s.ok && s.count === 정답_3개, s.count + '명');

  const 정답_or = rows.filter((r) => 월(r[C만기]) === 8 || 월(r[C생일]) === 8).length;
  s = await S({ match: 'OR', filters: [{ column: '만기일', op: 'month', value: 8 }, { column: '생년월일', op: 'month', value: 8 }] });
  ok(`"8월 만기 ★또는★ 8월 생일"(OR) → ${정답_or}명`, s.ok && s.count === 정답_or, s.count + '명');
  ok('  └ OR가 AND보다 많거나 같다(합집합)', s.count >= Math.max(정답_만기8, 정답_생일8), `${s.count} vs ${정답_만기8}/${정답_생일8}`);

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [E] 엣지 — 없는 조건·빈 결과·모순·잘못된 지시 ════════');
  s = await S({ filters: [{ column: '혈액형', op: 'equals', value: 'A' }] });
  ok('없는 칸 → 지어내지 않고 "그 칸 없다" + 칸목록을 돌려준다', s.ok === false && /혈액형/.test(String(s.오류)) && Array.isArray(s.칸목록), JSON.stringify(s).slice(0, 80));

  s = await S({ filters: [{ column: '생년월일', op: 'month', value: 13 }] });
  ok('월 13 → 값이 틀렸다고 알려준다(조용히 0명 아님)', s.ok === false && /1~12/.test(String(s.오류)), JSON.stringify(s).slice(0, 80));

  s = await S({ filters: [{ column: '성별', op: '거꾸로', value: '여' }] });
  ok('모르는 연산자 → 쓸 수 있는 것들을 알려준다', s.ok === false && /모르는 조건/.test(String(s.오류)), JSON.stringify(s).slice(0, 80));

  s = await S({ filters: [{ column: '연소득', op: 'between', value: 3000 }] });
  ok('범위인데 끝값 누락 → 값이 더 필요하다고 알려준다', s.ok === false && /value2/.test(String(s.오류)), JSON.stringify(s).slice(0, 80));

  s = await S({ filters: [{ column: '생년월일', op: 'month' }] });
  ok('값 없음 → 값이 없다고 알려준다', s.ok === false && /값이 없어요/.test(String(s.오류)), JSON.stringify(s).slice(0, 80));

  s = await S({ filters: [{ column: '보험사', op: 'equals', value: '없는보험사주식회사' }] });
  ok('진짜로 없는 값 → 0명 + "없다고 정직히 말하라" 안내', s.ok === true && s.count === 0 && /정직히/.test(String(s.안내)), s.count + '명');

  s = await S({ filters: [{ column: '성별', op: 'equals', value: '남' }, { column: '성별', op: 'equals', value: '여' }] });
  ok('모순 조건(남 AND 여) → 0명 (억지로 사람을 만들지 않음)', s.ok === true && s.count === 0, s.count + '명');

  s = await S({ filters: [{ column: '비고', op: 'not_empty' }] });
  const 정답_비고 = rows.filter((r) => String(r[H('비고')] || '').trim() !== '').length;
  ok(`"비고가 채워진 사람"(빈칸 여부) → ${정답_비고}명`, s.ok && s.count === 정답_비고, s.count + '명');

  s = await S({});
  ok('조건 없이 부르면 → 전체 80명 (예전과 같음)', s.ok && s.count === 80, s.count + '명');

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [F] ★기존에 되던 것이 안 깨졌는가 (하위호환) ════════');
  // ★'2026-08'은 "그 해 그 달"이고, 위 month:8 은 "연도 무관 8월"이라 답이 다른 게 정상이다.
  const 정답_2026_08 = rows.filter((r) => String(r[C만기] || '').startsWith('2026-08')).length;
  s = await S({ column: '만기일', contains: '2026-08' });
  ok(`★기존 시험(_test_filming.js:53) 그대로: {column:'만기일', contains:'2026-08'} → ${정답_2026_08}명`,
    s.ok && s.count === 정답_2026_08, s.count + '명');
  ok('  └ 연도 무관 8월(month)과 그 해 8월(2026-08)은 다른 답이 나온다 = 칸·조건이 정밀하다는 뜻',
    정답_만기8 !== 정답_2026_08, `month8=${정답_만기8} vs 2026-08=${정답_2026_08}`);

  s = await S({ keyword: 첫보험사 });
  const 정답_kw = rows.filter((r) => t.header.some((h) => String(r[h]).includes(첫보험사))).length;
  ok('★keyword(전체 칸 검색)는 예전 그대로 전체를 훑는다', s.ok && s.count === 정답_kw, s.count + '명');

  s = await S({ column: '없는칸이름', contains: '2026-08' });
  ok('★못 알아본 칸이면 예전처럼 전체 검색으로 폴백(빈손 방지 안전망 유지)', s.ok && s.count > 0, s.count + '명');

  s = await S({ column: '생년월일', contains: '-08-' });
  ok(`★★사고 재현 방지: 옛 방식으로 생년월일에 '-08-' → 만기 섞이지 않고 ${정답_생일8}명`,
    s.ok && s.count === 정답_생일8, s.count + '명 (예전엔 만기·가입일이 섞여 틀렸다)');

  const r1 = await crud.doRead(null, { name: rows[0][t.nameCol] });
  ok('★sheet_read(개별 조회) 그대로 작동', r1.ok && r1.found === 1, JSON.stringify({ found: r1.found }));

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [G] 🧾 3층 — 셰프가 재료 목록을 보는가 ════════');
  const hint = crud.schemaHint();
  ok('칸 목록이 만들어짐', !!hint && hint.length > 50);
  ok('칸 20개가 전부 들어 있음', t.header.every((h) => hint.includes(h)), hint.slice(0, 60));
  ok('★날짜 형식(YYYY-MM-DD)을 알려준다 → "8월" vs "-08-" 착오 방지', /YYYY-MM-DD/.test(hint));
  ok('★날짜 칸이 여럿이니 칸을 지정하라고 못 박음', /칸인지 반드시 지정/.test(hint));
  ok('★실제 고객 값은 안 들어감(제로 인그레스)',
    !hint.includes(String(rows[0][t.nameCol])) && !hint.includes(String(rows[0][C생일])),
    hint.slice(0, 80));
  const sp = crud.systemPrompt();
  ok('★두뇌 지침에 칸 목록이 실제로 붙음(만들어만 놓고 안 쓰는 것 방지)', sp.includes(C생일) && /조건 검색 원칙/.test(sp));
  ok('★"인원수는 네가 세지 마라"가 지침에 있음(숫자 환각 차단)', /인원수는 네가 세지 않는다/.test(sp));

  // ═══════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(58));
  console.log(`  결과: ✅ ${통과}개 통과 · ❌ ${실패}개 실패`);
  if (실패) { console.log('  실패 항목:'); 실패목록.forEach((x) => console.log('    · ' + x)); }
  console.log('═'.repeat(58) + '\n');
  process.exit(실패 ? 1 : 0);
})().catch((e) => { console.error('시험 도중 오류:', e); process.exit(1); });
