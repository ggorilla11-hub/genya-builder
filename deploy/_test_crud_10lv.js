// ─────────────────────────────────────────────────────────────
// _test_crud_10lv.js — 🫀 명단 데이터 추가·수정·추출 10레벨 시험
//
// ★대표님 선언: 고객 명단은 설계사의 심장. 재료창고가 튼튼해야 모든 요리가 산다.
//   이건 촬영용이 아니라 지니야의 핵심 서비스다. 그래서 최고 강도로 시험한다.
//
// ★8레벨(조용한 실패 잡기)이 이 시험의 심장이다.
//   "됐다"는 ★말이 아니라 ★실제 데이터 전후를 비교한다.
//   지니야가 "바꿨어요"라고 말했는데 데이터가 그대로면 → ★실패로 잡는다.
//
// 실행: node deploy/_test_crud_10lv.js   (서버를 실제로 띄우고 사용자처럼 /api/order 로 말한다)
// ─────────────────────────────────────────────────────────────
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.CRUD10_PORT || 8093;
let pass = 0, fail = 0;
const 실패목록 = [];
function ok(층, 제목, 조건, 실측) {
  if (조건) { pass++; console.log(`  ✅ [L${층}] ${제목}`); }
  else { fail++; 실패목록.push(`L${층} ${제목}`); console.log(`  ❌ [L${층}] ${제목}` + (실측 !== undefined ? `\n        실측: ${실측}` : '')); }
}

function 서버띄우기() {
  const env = Object.assign({}, process.env, { PORT: String(PORT), FILMING_MODE: '1' });
  return spawn(process.execPath, [path.join(__dirname, 'main_server.js')], { cwd: __dirname, env, stdio: 'ignore' });
}
async function 깨어남(초) {
  for (let i = 0; i < 초; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/health`); if (r.ok) return true; } catch (e) {}
    await new Promise((s) => setTimeout(s, 1000));
  }
  return false;
}
async function 말하기(q, history) {
  const r = await fetch(`http://localhost:${PORT}/api/order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(history ? { q, history } : { q }),
  });
  return r.json();
}
/** ★실제 데이터를 그대로 읽어온다(응답 문구가 아니라 이걸로 판정한다) */
async function 명단() {
  const r = await fetch(`http://localhost:${PORT}/api/roster/list`);
  const j = await r.json();
  return { 칸: (j.header || []).filter((h) => h !== '소스파일' && h !== '업로드일'), 행: j.rows || [] };
}
const 값 = (t, 이름, 칸) => { const r = t.행.find((x) => x['고객명'] === 이름); return r ? String(r[칸] == null ? '' : r[칸]) : '(없는고객)'; };
const 있나 = (t, 칸) => t.칸.includes(칸);

(async function main() {
  const srv = 서버띄우기();
  const 정리 = () => { try { srv.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', 정리);

  console.log('\n서버를 실제로 띄웁니다 (사용자와 같은 길로 말하기 위해)…');
  if (!await 깨어남(60)) { console.log('★서버가 안 떴습니다 — 시험 못 함(통과로 꾸미지 않음)'); 정리(); process.exit(1); }
  console.log('준비됨\n');

  // ═══ L1 · 말투 8종 — 어떻게 말해도 실제로 반영되는가 ═══
  console.log('━━━ L1 · 말투 8종 (실제 데이터 전후 비교) ━━━');
  const 말투 = [
    ['이영희 출산 항목 추가해', '출산', '이영희'],
    ['최동욱 유병자 칸 만들어', '유병자', '최동욱'],
    ['신미경 이사 항목에 기록해줘', '이사', '신미경'],
    ['강수연 갱신완료 컬럼 넣어줘', '갱신완료', '강수연'],
    // ★내용이 필요한 항목은 값을 같이 준다(값을 안 주면 되묻는 게 맞다 — 아래에서 따로 시험).
    ['정우진 상담메모 항목에 재무상담 희망이라고 적어줘', '상담메모', '정우진'],
    ['한지민 결혼기념일 항목 추가해서 2015-05-20 으로 업데이트해줘', '결혼기념일', '한지민'],
  ];
  for (const [q, 칸, 누구] of 말투) {
    const 전 = await 명단();
    const d = await 말하기(q);
    const 후 = await 명단();
    // ★말이 아니라 데이터로 판정
    ok(1, `"${q}" → 칸 '${칸}' 이 실제로 생김`, 있나(후, 칸), `칸 ${전.칸.length}→${후.칸.length} · 답="${String(d.text || '').slice(0, 60)}"`);
    ok(1, `   └ ${누구}님 값이 실제로 들어감`, 값(후, 누구, 칸) !== '' && 값(후, 누구, 칸) !== '(없는고객)', `값="${값(후, 누구, 칸)}"`);
    ok(1, `   └ ★승인창 잔재 없음`, !d.pending, JSON.stringify(d.pending || null));
    ok(1, `   └ ★"연결하라" 안 나옴`, !d.needsConnect && !/연결(하|해)|업로드해/.test(String(d.text || '')), String(d.text || '').slice(0, 80));
  }

  // ★값을 지어내지 않는가 — 내용이 필요한 항목은 되물어야 한다(환각 금지)
  console.log('\n   ── 값을 지어내지 않는가 (내용 항목은 되물어야 정상) ──');
  {
    const 전 = await 명단();
    const d = await 말하기('오세훈 통화메모 항목 적어줘');
    const 후 = await 명단();
    const 되물음 = /무엇|어떤|뭐라고|내용|알려주|말씀/.test(String(d.text || ''));
    const 값들어감 = 값(후, '오세훈', '통화메모');
    ok(1, '★내용을 안 주면 지어내지 않고 되묻는다', 되물음 || 값들어감 === '' || 값들어감 === '(없는고객)',
      `답="${String(d.text || '').slice(0, 70)}" 값="${값들어감}"`);
  }

  // ═══ L2 · 이름 오인식 — 칸 이름이 정확한가 ═══
  console.log('\n━━━ L2 · 이름 오인식 (★"출산했으니" 같은 오인식 금지) ━━━');
  {
    const 전 = await 명단();
    await 말하기('오세훈 이사했으니 이사 항목 추가해서 오늘 날짜로');
    const 후 = await 명단();
    const 새칸 = 후.칸.filter((c) => !전.칸.includes(c));
    ok(2, '"이사했으니" 가 칸 이름이 되지 않음', !새칸.some((c) => /했으니|해서|추가/.test(c)), '새 칸: ' + JSON.stringify(새칸));
    ok(2, '이사 항목에 오세훈 값이 있음', 값(후, '오세훈', '이사') !== '', `값="${값(후, '오세훈', '이사')}"`);
  }

  // ═══ L3 · 여러 고객 연속 지목 ═══
  console.log('\n━━━ L3 · 여러 고객 연속 ━━━');
  for (const 이름 of ['김철수', '이영희', '최동욱']) {
    await 말하기(`${이름} 갱신완료 항목에 완료로 기록해줘`);
  }
  {
    const t = await 명단();
    ['김철수', '이영희', '최동욱'].forEach((n) => ok(3, `${n} 갱신완료 값 들어감`, 값(t, n, '갱신완료') !== '', `값="${값(t, n, '갱신완료')}"`));
    ok(3, '★엉뚱한 사람에게 안 들어감', 값(t, '오세훈', '갱신완료') === '' || 값(t, '오세훈', '갱신완료') === '(없는고객)', `오세훈="${값(t, '오세훈', '갱신완료')}"`);
  }

  // ═══ L4 · 멀티턴 (앞 대화 쌓인 상태) ═══
  console.log('\n━━━ L4 · 멀티턴 ━━━');
  {
    const hist = [
      { role: 'user', content: '고객 몇 명이야?' },
      { role: 'assistant', content: '총 80명입니다.' },
      { role: 'user', content: '8월 만기는?' },
      { role: 'assistant', content: '8명입니다.' },
    ];
    const 전 = await 명단();
    const d = await 말하기('신미경 특이사항 항목 추가해서 VIP로 기록해줘', hist);
    const 후 = await 명단();
    ok(4, '앞 대화가 쌓여 있어도 정확히 반영', 있나(후, '특이사항') && 값(후, '신미경', '특이사항') !== '',
      `칸=${있나(후, '특이사항')} 값="${값(후, '신미경', '특이사항')}" 답="${String(d.text || '').slice(0, 60)}"`);
  }

  // ═══ L5 · 엣지 케이스 ═══
  console.log('\n━━━ L5 · 엣지 (없는 고객·중복 칸·빈 값) ━━━');
  {
    const 전 = await 명단();
    const d1 = await 말하기('홍길동전우치 출산 항목에 기록해줘');
    const 후1 = await 명단();
    ok(5, '★없는 고객 → 데이터를 안 건드림', 후1.행.length === 전.행.length, `${전.행.length}→${후1.행.length}`);
    ok(5, '★없는 고객 → 정직하게 말함(못 찾았다)',
      /못 찾|없어|없습니다|명단에 없|안 보입|안보입|검색되지|찾지 못|확인되지/.test(String(d1.text || '')), String(d1.text || '').slice(0, 90));

    const 전2 = await 명단();
    await 말하기('이영희 출산 항목 또 추가해줘');
    const 후2 = await 명단();
    ok(5, '★중복 칸을 두 번 만들지 않음', 후2.칸.filter((c) => c === '출산').length === 1, `'출산' ${후2.칸.filter((c) => c === '출산').length}개 · 칸 ${전2.칸.length}→${후2.칸.length}`);
  }

  // ═══ L6 · 추가 후 추출 (넣은 게 실제 보이나) ═══
  console.log('\n━━━ L6 · 추가 후 추출 ━━━');
  {
    await 말하기('강수연 특약메모 항목 추가해서 운전자특약으로 기록해줘');
    const d = await 말하기('강수연님 정보 알려줘');
    const t = await 명단();
    const 실제 = 값(t, '강수연', '특약메모');
    ok(6, '데이터에 실제로 있음', 실제 !== '' && 실제 !== '(없는고객)', `값="${실제}"`);
    ok(6, '★추출(조회)에도 그 값이 나옴', String(d.text || '').includes(실제) || /특약메모/.test(String(d.text || '')),
      `답="${String(d.text || '').replace(/\n/g, ' ').slice(0, 120)}"`);
  }

  // ═══ L7 · 수정 후 추출 (바꾼 게 실제 반영되나) ═══
  console.log('\n━━━ L7 · 수정 후 추출 ━━━');
  {
    const 전 = await 명단();
    const 전값 = 값(전, '김철수', '주소');
    const d = await 말하기('김철수 주소를 서울시 강남구 테헤란로로 바꿔줘');
    const 후 = await 명단();
    const 후값 = 값(후, '김철수', '주소');
    ok(7, '★주소가 실제로 바뀜(전후 다름)', 후값 !== 전값 && /테헤란/.test(후값), `"${전값}" → "${후값}"`);
    ok(7, '★승인창 없이 즉시', !d.pending, JSON.stringify(d.pending || null));
    const d2 = await 말하기('김철수님 주소 알려줘');
    ok(7, '★추출에도 바뀐 값이 나옴', /테헤란/.test(String(d2.text || '')), String(d2.text || '').replace(/\n/g, ' ').slice(0, 100));
    ok(7, '★다른 사람 주소는 안 바뀜', 값(후, '이영희', '주소') === 값(전, '이영희', '주소'));
  }

  // ═══ L8 · ★조용한 실패 잡기 (이 시험의 심장) ═══
  console.log('\n━━━ L8 · ★조용한 실패 잡기 ("됐다"는 말 ≠ 실제 반영) ━━━');
  {
    const 전 = await 명단();
    const d = await 말하기('정우진 무사고여부를 무사고10년으로 수정해줘');
    const 후 = await 명단();
    const 됐다고말함 = /반영|바꿨|수정했|기록했|완료|했어요|넣었/.test(String(d.text || ''));
    const 진짜바뀜 = 값(후, '정우진', '무사고여부') !== 값(전, '정우진', '무사고여부');
    ok(8, '★"됐다"고 말했으면 ★반드시 실제로 바뀌어 있어야 한다',
      !됐다고말함 || 진짜바뀜,
      `말="${String(d.text || '').slice(0, 70)}" / 데이터 "${값(전, '정우진', '무사고여부')}" → "${값(후, '정우진', '무사고여부')}"`);
    ok(8, '★실제로 바뀌었으면 그렇다고 말해야 한다', !진짜바뀜 || 됐다고말함, `말="${String(d.text || '').slice(0, 70)}"`);
    ok(8, '★값이 정확히 지시대로', 값(후, '정우진', '무사고여부') === '무사고10년', `"${값(후, '정우진', '무사고여부')}"`);
  }

  // ═══ L9 · 발송이 섞여도 승인 유지 ═══
  console.log('\n━━━ L9 · ★발송은 승인 유지 (내부 수정과 구분) ━━━');
  {
    for (const q of ['이영희님께 만기 안내 문자 보내줘', '김철수 메일 발송해줘', '8월 만기 고객들한테 알림톡 보내줘']) {
      const 전 = await 명단();
      const d = await 말하기(q);
      const 후 = await 명단();
      ok(9, `"${q}" → 명단이 안 바뀐다`, JSON.stringify(전.행.length) === JSON.stringify(후.행.length) && 전.칸.length === 후.칸.length,
        `행 ${전.행.length}→${후.행.length} · 칸 ${전.칸.length}→${후.칸.length}`);
    }
    const r = await fetch(`http://localhost:${PORT}/api/send/sms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-human-approval': '1' },
      body: JSON.stringify({ humanApproval: true, to: '010-0000-0001', text: 't' }),
    });
    ok(9, '★실제 발송 경로는 그대로 막혀 있다', r.status === 403, 'HTTP ' + r.status);
  }

  // ═══ L10 · 추출 — 표·조건 조회 ═══
  console.log('\n━━━ L10 · 추출 (표·조건) ━━━');
  {
    const d1 = await 말하기('시트 보여줘');
    ok(10, '"시트 보여줘" → 표가 뜬다', d1.action === 'open_full_roster' && d1.roster && d1.roster.rows.length > 0,
      `action=${d1.action} rows=${d1.roster ? d1.roster.rows.length : 0}`);
    const t = await 명단();
    ok(10, '★표에 새로 만든 칸들이 다 들어 있다',
      ['출산', '유병자', '이사', '갱신완료'].every((c) => d1.roster.cols.includes(c)),
      '표 칸: ' + d1.roster.cols.join(','));
    const d2 = await 말하기('만기 8명 띄워');
    ok(10, '"만기 8명 띄워" → 8명만', d2.roster && d2.roster.rows.length === 8, d2.roster ? d2.roster.rows.length + '명' : '표 없음');
    const d3 = await 말하기('삼성화재 고객 몇 명이야?');
    const 삼성 = t.행.filter((r) => String(r['보험사'] || '').includes('삼성화재')).length;
    ok(10, `조건 조회가 실제 수(${삼성}명)와 맞다`, String(d3.text || '').includes(String(삼성)),
      `실제 ${삼성}명 · 답="${String(d3.text || '').replace(/\n/g, ' ').slice(0, 90)}"`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  통과 ${pass} · 실패 ${fail}   (전체 ${pass + fail})`);
  if (실패목록.length) console.log('  실패: ' + 실패목록.join(' / '));
  console.log('  ※ 판정 기준은 응답 문구가 아니라 ★실제 명단 데이터의 전후 비교입니다.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  정리();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('시험 자체가 터짐:', e); process.exit(1); });
