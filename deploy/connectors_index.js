// ─────────────────────────────────────────────────────────────
// connectors_index.js — 🔌커넥터창고 통합 진입점 ★v4 커넥터창고에 "꽂는" 한 줄
// 무엇을·왜: 약관(askYakgwan)·스킬(skills_index)처럼, 커넥터도 한 줄 require로 꽂는다.
// 사용: const C = require('.../connectors_index');
//        await C.calendar();  await C.sheet();  await C.drive('김철수 증권');  await C.discover('영상ID');
//        C.list  // v4 🔌커넥터창고 카드가 "N개 연결됨"으로 표시할 메타(상태 포함)
// ★공통 자산. 발송·결제·수정 = 사람 승인 게이트. 고객 데이터 서버 저장 0. /parksugeun 무접촉.
// ─────────────────────────────────────────────────────────────
'use strict';
const google = require('./google_connector');   // calendarToday, rosterFilter, driveSearch, drivePolicyRead
const leads = require('./leads_connector');      // collectComments, classifyLeads, discover
const listening = require('./listening_connector'); // classifyPosts, listen
const web = require('./web_research_connector');  // research(question, sources)
const gmail = require('./gmail_connector');      // status, draftMail

// 한 줄 호출 진입점
const api = {
  calendar: google.calendarToday,
  sheet: google.rosterFilter,
  drive: google.driveSearch,
  driveRead: google.drivePolicyRead,
  discover: leads.discover,
  classify: leads.classifyLeads,
  listen: listening.listen,
  research: web.research,
  gmail,
};

// v4 🔌커넥터창고 메타(상태 정직 표시)
const list = [
  { id: 'calendar', ico: '📅', name: '구글 캘린더', status: '연결됨', gate: '읽기' },
  { id: 'sheet', ico: '📊', name: '구글 시트', status: '연결됨', gate: '읽기' },
  { id: 'drive', ico: '📁', name: '구글 드라이브', status: '연결됨', gate: '읽기' },
  { id: 'discover', ico: '🎯', name: '발굴(유튜브 댓글)', status: '준비 중(서버 브라우저 미설치)', gate: '분류·명단(연락은 사람)' },
  { id: 'listening', ico: '👂', name: '소셜 리스닝(공개 커뮤니티)', status: '준비 중(검색API 연동 예정)', gate: '탐지·분류(연락은 사람)' },
  { id: 'web', ico: '🌐', name: '웹 조사(실시간 상품·약관·시세)', status: '준비 중(검색API 연동 예정)', gate: '근거+출처' },
  { id: 'gmail', ico: '📧', name: 'Gmail', status: '인증 대기', gate: '읽기·초안(발송 게이트)' },
  { id: 'kakao', ico: '💬', name: '카톡', status: '미장착', gate: '승인 후 발송(게이트)' },
  { id: 'notion', ico: '📓', name: 'Notion(C-1)', status: '미연결(통합토큰 필요)', gate: '쓰기=승인 게이트' },
  { id: 'canva', ico: '🎨', name: 'Canva(C-2)', status: '미연결(API키 필요)', gate: '-' },
  { id: 'zapier', ico: '⚡', name: 'Zapier(C-3)', status: '미연결(OAuth/키 필요)', gate: '-' },
  { id: 'stripe', ico: '💳', name: 'Stripe(C-4)', status: '미연결(API키 필요)', gate: '★결제=반드시 사람 승인' },
];

const connectedCount = list.filter((c) => c.status === '연결됨').length;

module.exports = Object.assign(api, { list, connectedCount });

// ── 자체 시연: 연결된 커넥터 실호출 + 목록 ──
if (require.main === module) {
  (async () => {
    console.log(`🔌 커넥터창고 — 연결됨 ${connectedCount} / 전체 ${list.length}`);
    list.forEach((c) => console.log(`  ${c.ico} ${c.name}: ${c.status} [${c.gate}]`));

    console.log('\n[.calendar()]');
    const cal = await api.calendar();
    cal.forEach((e) => console.log(`  ${e.time} ${e.title}${e.prep.length ? ' → ' + e.prep[0] : ''}`));

    console.log('[.sheet()]');
    const s = await api.sheet();
    console.log(`  7월만기 ${s.july만기.length}명 · 임박순 ${s.임박순.join(' → ')} · 자산가 ${s.자산가.join(', ')}`);

    console.log('[.drive("김철수 증권")]');
    const d = await api.drive('김철수 증권');
    d.forEach((f) => console.log(`  ${f.name}`));

    console.log('[.classify(샘플)] (발굴 분류 모듈 확인 — 브라우저 수집은 지난 턴 실측)');
    const g = await api.classify([{ author: '@a', text: '실손보험 알아보고 있어요 추천 좀' }, { author: '@b', text: '영상 잘봤어요 구독!' }]);
    console.log(`  HOT ${g.HOT.length} / WARM ${g.WARM.length} / SKIP ${g.SKIP.length} (HOT: ${g.HOT.map((x) => x.author).join(',')})`);

    console.log('[.gmail.status()]', api.gmail.status().note);
  })().catch((e) => { console.error('오류:', e.message); process.exit(1); });
}
