// ─────────────────────────────────────────────────────────────
// sub_agents.js — 🤖 서브에이전트 오케스트레이션 (SUB-1·2·3) · 공통 자산
// SUB-1 봇 분리: 약관봇·문자봇·분석봇·발굴봇 (각자 한 가지 일에 특화, 실엔진 연결)
// SUB-2 공유 기억: 봇들이 함께 읽고 쓰는 작업 컨텍스트(익명 결과/결정 — 원본 고객데이터 아님)
// SUB-3 지니야 총괄: 자연어 작업을 맞는 봇(들)에 라우팅 → 결과 취합 → 공유기억 기록
// ★봇은 배포 실엔드포인트(genya-builder.onrender.com)를 호출 = 진짜 작동. 발굴봇은 서버 준비중 정직.
// ★발송·결제 등 되돌릴 수 없는 행동은 ComputerUse 창고 승인 게이트를 거친다(여기선 읽기·작성까지).
// ─────────────────────────────────────────────────────────────
'use strict';
const BASE = process.env.GENYA_BASE || 'https://genya-builder.onrender.com';

// ── SUB-2: 공유 기억 ──
function makeSharedMemory() {
  const store = [];
  return {
    write(bot, note) { store.push({ bot, note }); return note; },
    read(bot) { return store.filter((x) => !bot || x.bot === bot); },
    all() { return store.slice(); },
  };
}

// ── SUB-1: 봇 정의(각자 특화 + 실엔진) ──
const BOTS = {
  약관봇: {
    desc: '보험 약관을 근거·출처로 답', keywords: /약관|무보험|담보|보장.*(뭐|무엇|차이)|대물|자기신체|자동차상해/,
    async run(task) { const r = await fetch(`${BASE}/api/yakgwan?q=${encodeURIComponent(task)}`).then((x) => x.json()); return { text: (r.answer || '(응답 없음)'), sources: r.sources || [], ready: true }; },
  },
  문자봇: {
    desc: '고객 안내 문자 초안(발송 안 함)', keywords: /문자|안내|초안|메시지|만기.*(문자|안내)/,
    async run(task) { const r = await fetch(`${BASE}/api/draft/message?topic=${encodeURIComponent(task)}&rule=${encodeURIComponent('발송 전 확인')}`).then((x) => x.json()); return { text: (r.draft || '(초안 실패)'), ready: true, gate: '발송=사람 승인' }; },
  },
  분석봇: {
    desc: '증권/보장 분석(이미지 OCR)', keywords: /증권|보장.*분석|빈틈|재설계/,
    async run() { return { text: '증권 이미지(JPG·PNG)를 주시면 OCR로 담보를 읽어 분석해요. (POST /api/coverage/analyze)', ready: true, needs: '이미지' }; },
  },
  발굴봇: {
    desc: '유튜브 공개댓글 고객 발굴', keywords: /발굴|고객.*(찾|발굴)|리드|잠재고객/,
    async run() { return { text: '발굴봇은 배포 서버에 브라우저(playwright) 준비 중이에요. 로컬 발굴 엔진은 작동(정직 표시).', ready: false }; },
  },
};

// ── SUB-3: 지니야 총괄 오케스트레이션 ──
async function orchestrate(task, shared) {
  shared = shared || makeSharedMemory();
  let picked = Object.keys(BOTS).filter((name) => BOTS[name].keywords.test(task));
  if (!picked.length) picked = ['문자봇']; // 기본
  const results = [];
  for (const name of picked) {
    try { const r = await BOTS[name].run(task); shared.write(name, (r && r.text) || ''); results.push({ bot: name, ...r }); }
    catch (e) { results.push({ bot: name, text: '오류: ' + e.message, ready: false }); }
  }
  return { task, routedTo: picked, results, sharedMemory: shared.all() };
}

module.exports = { BOTS, makeSharedMemory, orchestrate };

// ── 자체 시연: 지니야가 여러 작업을 봇에 라우팅 + 공유기억 ──
if (require.main === module) {
  (async () => {
    console.log('🤖 서브에이전트 오케스트레이션 (SUB-1 봇분리 · SUB-2 공유기억 · SUB-3 지니야 총괄)\n');
    console.log('봇 목록:'); Object.keys(BOTS).forEach((n) => console.log(`  · ${n} — ${BOTS[n].desc}`));
    const shared = makeSharedMemory();
    const tasks = ['무보험차상해가 뭐야?', '만기 고객 안내 문자 초안 써줘', '새 고객 좀 발굴해줘'];
    for (const t of tasks) {
      console.log(`\n━ 작업: "${t}" ━`);
      const r = await orchestrate(t, shared);
      console.log(`  → 지니야가 라우팅: [${r.routedTo.join(', ')}]`);
      r.results.forEach((x) => console.log(`     ${x.bot}${x.ready ? '' : '(준비중)'}: ${String(x.text).slice(0, 70)}${x.sources && x.sources.length ? '  출처:' + x.sources[0] : ''}`));
    }
    console.log(`\n━ SUB-2 공유 기억(봇들이 함께 쌓음, ${shared.all().length}건) ━`);
    shared.all().forEach((m) => console.log(`  [${m.bot}] ${String(m.note).slice(0, 50)}`));
    console.log('\n★SUB-1/2/3 완료: 봇 분리 + 공유 기억 + 지니야 총괄 라우팅(배포 실엔드포인트 호출). 발송·결제는 승인 게이트(ComputerUse 창고).');
  })().catch((e) => { console.error('오류:', e.message); process.exit(1); });
}
