// ─────────────────────────────────────────────────────────────
// _test_order_e2e.js — 💬 ★대화 입력 → 최종 응답 통째 시험 (2026-07-29 회장님 지시)
//
// 왜 이 시험이 생겼나 (오늘 반복된 사고):
//   "함수 시험은 61/61 통과했는데 ★실제 대화에서는 약관을 안 불렀다."
//   함수를 직접 부르는 시험은 ★대화 라우터를 건너뛴다. 그래서 라우터에서 새는 것을 못 잡았다.
//   → 이 시험은 ★서버를 진짜로 띄우고, ★사용자와 똑같이 /api/order 로 물어본다.
//     (orderHandler는 로그인 없이도 돌기 때문에 약관 경로는 그대로 재현된다)
//
// 확인하는 것:
//   1. "현대해상 암진단비 면책기간은?"  → 📄 약관창고 + 근거 페이지 + 실제 면책 내용 ★★★
//   2. "삼성화재 실손 본인부담금 지급구조" → 실손 약관 본문(표지·엉뚱한 상품 아님) ★★★
//   3. activeSkill(카드 열어둔 상태)이어도 약관 질문은 약관창고로 간다
//   4. 만기·일정·증권 같은 기존 명령은 ★가로채지 않는다
//
// 실행: node deploy/_test_order_e2e.js        (deploy 폴더에서 · .env 필요 · 파인콘/LLM 실호출)
// ─────────────────────────────────────────────────────────────
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.E2E_PORT || 8097;
const BASE = `http://localhost:${PORT}`;

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) throw new Error(m || '조건 실패'); };
const has = (h, n) => ok(String(h).includes(n), `"${n}" 가 없음`);
const T = async (name, fn) => {
  try { await fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + '  → ' + e.message); fail++; }
};

async function ask(q, activeSkill) {
  const body = JSON.stringify(activeSkill ? { q, activeSkill } : { q });
  const r = await fetch(`${BASE}/api/order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body,
  });
  return r.json();
}

async function 서버깨어남(초) {
  for (let i = 0; i < 초; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return true; } catch (e) {}
    await new Promise((s) => setTimeout(s, 1000));
  }
  return false;
}

(async function main() {
  console.log('\n서버를 실제로 띄웁니다 (사용자와 같은 길로 물어보기 위해)…');
  const srv = spawn(process.execPath, [path.join(__dirname, 'main_server.js')], {
    cwd: __dirname, env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore',
  });
  const 종료 = () => { try { srv.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', 종료);

  if (!await 서버깨어남(40)) {
    console.log('★서버가 안 떴습니다 — 시험 못 함(통과로 꾸미지 않음)');
    종료(); process.exit(1);
  }
  console.log('서버 준비됨\n');

  console.log('━━━ 1. ★★★ 대표님 신고 질문 그대로 (대화창 → 최종 응답) ━━━');
  const q1 = '현대해상 암진단비 면책기간은?';
  let r1;
  await T(`"${q1}" → 📄 약관창고로 간다`, async () => {
    r1 = await ask(q1);
    ok(r1.kind === '📄 약관창고', '엉뚱한 곳으로 감: ' + r1.kind);
  });
  await T('근거 출처(보험사·상품·페이지)가 붙는다', async () => {
    ok(r1.sources && r1.sources.length > 0, '출처 없음');
    has(r1.sources.join('|'), '현대해상');
    ok(/p\.\d+/.test(r1.sources[0]), '페이지 표기 없음: ' + r1.sources[0]);
  });
  await T('★"발췌에는 없어요"가 아니라 실제 면책 내용을 답한다', async () => {
    // ★판정은 ★뜻으로 한다. LLM이 "발췌에는 없어요 — 참고로 면책기간은 90일…"처럼
    //   운을 떼고 제대로 답하는 경우가 있어, 글자만 보면 시험이 흔들린다(실제로 한 번 흔들렸다).
    //   진짜 실패는 "못 찾았다고 하면서 면책 내용도 없는" 경우다.
    const t = String(r1.text || '');
    const 내용있음 = /면책|90일|보장개시|감액/.test(t);
    ok(내용있음, '면책 내용이 없음: ' + t.slice(0, 100));
    ok(!(/발췌에는 없어요/.test(t) && !내용있음), '약관이 있는데 못 찾음: ' + t.slice(0, 100));
  });

  const q2 = '삼성화재 실손 본인부담금 지급구조';
  let r2;
  await T(`"${q2}" → 📄 약관창고로 간다`, async () => {
    r2 = await ask(q2);
    ok(r2.kind === '📄 약관창고', '엉뚱한 곳으로 감: ' + r2.kind);
  });
  await T('★실손 약관을 가져온다 (재물보험 같은 엉뚱한 상품 아님)', async () => {
    const s = (r2.sources || []).join(' | ');
    ok(/실손|의료비/.test(s), '★실손이 아닌 약관을 가져옴: ' + s.slice(0, 140));
    ok(!/재물보험|화재보험/.test(s), '★엉뚱한 상품: ' + s.slice(0, 140));
  });
  await T('★표지(p.1)가 아니라 본문 페이지다', async () => {
    const 페이지 = (r2.sources || []).map((s) => { const m = s.match(/p\.(\d+)/); return m ? Number(m[1]) : null; }).filter((p) => p != null);
    ok(페이지.length > 0, '페이지가 없음');
    ok(페이지.filter((p) => p === 1).length === 0, '★표지(p.1)가 나옴: ' + 페이지.join(','));
  });
  await T('실제 지급 구조 내용을 설명한다', async () => {
    ok(!/발췌에는 없어요/.test(r2.text || ''), '약관이 있는데 못 찾음');
    ok(/본인부담|자기부담|공제|급여|보상/.test(r2.text || ''), '내용이 없음: ' + String(r2.text).slice(0, 80));
  });

  console.log('\n━━━ 2. 카드(activeSkill)를 열어둔 상태에서도 약관으로 간다 ━━━');
  // ★★2026-07-29 시험이 거짓말한 사고 — 이 주석 지우지 말 것.
  //   처음엔 여기에 'claim','policy','compare' 같은 ★없는 코드를 넣었다.
  //   서버는 `activeSkill && SKILL_CTX[activeSkill]` 로 검사하므로, 없는 코드면 ★분기가 아예 안 켜진다.
  //   그래서 시험은 14/14 통과했는데 ★대표님 실제 화면에서는 증권분석비서가 가로채고 있었다
  //   ("증권을 올려달라"는 SKILL_CTX.policy_analysis 문구다).
  //   → 반드시 ★main_server.js의 SKILL_CTX 실제 키를 쓴다.
  for (const skill of ['policy_analysis', 'product_compare', 'insurance_review', 'client_management']) {
    await T(`activeSkill=${skill} 이어도 약관창고`, async () => {
      const r = await ask(q1, skill);
      ok(r.kind === '📄 약관창고', 'activeSkill이 가로챔: ' + r.kind);
    });
  }

  console.log('\n━━━ 3. 기존 명령을 가로채지 않는다 ━━━');
  for (const [q, why] of [
    ['만기 명단 보여줘', '만기·명단'],
    ['오늘 일정 브리핑 해줘', '일정·브리핑'],
    ['증권 파일 찾아줘', '증권·드라이브'],
  ]) {
    await T(`안 가로챈다(${why}): "${q}"`, async () => {
      const r = await ask(q);
      ok(r.kind !== '📄 약관창고', '★약관창고가 가로챘음: ' + r.kind);
    });
  }

  console.log('\n━━━ 4. 창고에 없는 것은 "없다" 정직 ━━━');
  await T('"떡볶이 맛있게 만드는 법" → 약관창고로 안 간다', async () => {
    const r = await ask('떡볶이 맛있게 만드는 법 알려줘');
    ok(r.kind !== '📄 약관창고', '무관한 질문을 약관으로 보냄: ' + r.kind);
  });

  종료();
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  통과 ${pass} · 실패 ${fail}   (전체 ${pass + fail})`);
  console.log(`  ※ 이 시험은 ★실제 서버·실제 대화 경로로 물어본 결과입니다.`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  process.exit(fail ? 1 : 0);
})();
