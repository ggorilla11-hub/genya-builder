// ─────────────────────────────────────────────────────────────
// computeruse_warehouse.js — 🖥️ Computer Use 창고 (독립 모듈 · 공통 자산)
// 무엇을·왜: 지니야가 "사람처럼 화면을 조작"해 일하는 능력 창고. 카톡 발송은 그 중 하나일 뿐.
//   웹 열기·읽기·검색·화면캡처·양식작성·공개파일 수집 등 여러 일을 한다.
// ★안전 심장(대표 대원칙): 발송·제출·결제·삭제 등 '되돌릴 수 없는 행동'은
//   사람 승인(approval 토큰) 없이는 절대 실행 안 됨. 그 앞(작성·열기·읽기)까지만 자유.
// ★공개 데이터만·로그인 우회 금지. 감사로그는 메모리/화면만(서버 저장 0).
// 사용: const CU = require('./computeruse_warehouse'); const g = CU.gate('kakao.send', {approved:true, approvedItem:'김영희 만기안내'});
// ─────────────────────────────────────────────────────────────
'use strict';

// 능력 카탈로그. risk: 'safe'(자유) | 'approval'(사람 승인 필수)
const CAPABILITIES = [
  // ── 안전(승인 불필요): 관찰·작성까지 ──
  { id: 'web.open',       title: '웹페이지 열기',        risk: 'safe',     desc: '공개 URL을 브라우저로 연다' },
  { id: 'web.read',       title: '화면 내용 읽기',        risk: 'safe',     desc: '열린 화면의 글/표/숫자를 읽어온다' },
  { id: 'web.screenshot', title: '화면 캡처',            risk: 'safe',     desc: '지금 화면을 이미지로 남긴다(증거·보고용)' },
  { id: 'web.search',     title: '공개 웹 검색',          risk: 'safe',     desc: '검색해 공개 결과를 가져온다(리스닝·조사)' },
  { id: 'form.fill',      title: '양식 입력(제출 전)',     risk: 'safe',     desc: '입력칸을 채우되 제출은 하지 않는다' },
  { id: 'file.download',  title: '공개 파일 내려받기',      risk: 'safe',     desc: '공개 약관·문서 PDF를 받는다(참조용·재배포 아님)' },
  { id: 'app.open',       title: '데스크톱 앱 열기',       risk: 'safe',     desc: '카톡·엑셀 등 앱 창을 연다(발송 아님)' },
  // ── 승인 게이트(사람 확인 필수): 되돌릴 수 없는 한 걸음 ──
  { id: 'kakao.send',     title: '카톡 메시지 발송',       risk: 'approval', desc: '데스크톱 카톡으로 승인된 메시지 1건 발송' },
  { id: 'mail.send',      title: '메일 발송',             risk: 'approval', desc: '작성한 메일을 실제 발송' },
  { id: 'form.submit',    title: '양식 제출',             risk: 'approval', desc: '작성한 양식을 실제 제출' },
  { id: 'file.delete',    title: '파일 삭제',             risk: 'approval', desc: '파일/데이터 삭제' },
  { id: 'pay.execute',    title: '결제·이체 실행',         risk: 'approval', desc: '결제/이체 실행' },
];

function find(id) { return CAPABILITIES.find((c) => c.id === id); }

// ★게이트: safe는 통과. approval은 approved===true + 승인대상(approvedItem) 있을 때만 통과.
function gate(id, ctx = {}) {
  const cap = find(id);
  if (!cap) return { ok: false, reason: `알 수 없는 능력: ${id}` };
  if (cap.risk === 'safe') return { ok: true, cap };
  if (ctx.approved === true && ctx.approvedItem) return { ok: true, cap, approvedItem: ctx.approvedItem };
  return { ok: false, blocked: true, cap, reason: `★사람 승인 필요 — "${cap.title}"은(는) 승인 없이는 실행하지 않습니다` };
}

// 무차별 방지: approval 능력은 한 번에 1건만(대량 발송 금지)
function gateBatch(id, items, ctx = {}) {
  const cap = find(id);
  if (cap && cap.risk === 'approval' && Array.isArray(items) && items.length > 1) {
    return { ok: false, blocked: true, reason: `★대량 금지 — "${cap.title}"은 한 번에 1건만. (요청 ${items.length}건)` };
  }
  return gate(id, ctx);
}

module.exports = { CAPABILITIES, find, gate, gateBatch };

// ── 자체 점검(모듈 단독 실행 시): 게이트가 실제로 막고/여는지 ──
if (require.main === module) {
  const show = (t, r) => console.log(`  ${r.ok ? '✅ 실행' : '⛔ 차단'} | ${t} — ${r.reason || (r.cap && r.cap.title)}`);
  console.log('🖥️ Computer Use 창고 — 능력 ' + CAPABILITIES.length + '개 (safe ' + CAPABILITIES.filter(c=>c.risk==='safe').length + ' / 승인필요 ' + CAPABILITIES.filter(c=>c.risk==='approval').length + ')\n');
  console.log('[안전 능력 — 승인 없이 실행]');
  show('web.open (공개 사이트 열기)', gate('web.open'));
  show('web.read (화면 읽기)', gate('web.read'));
  show('web.screenshot (화면 캡처)', gate('web.screenshot'));
  console.log('\n[승인 게이트 — 승인 없으면 차단]');
  show('kakao.send (승인 없이 발송 시도)', gate('kakao.send'));
  show('mail.send (승인 없이 발송 시도)', gate('mail.send'));
  show('pay.execute (승인 없이 결제 시도)', gate('pay.execute'));
  console.log('\n[승인 후 — 사람이 "네" 한 1건만 통과]');
  show('kakao.send (승인:김영희 만기안내 1건)', gate('kakao.send', { approved: true, approvedItem: '김영희 만기안내' }));
  console.log('\n[무차별 대량 차단]');
  show('kakao.send (승인했어도 30명 대량)', gateBatch('kakao.send', new Array(30).fill('x'), { approved: true, approvedItem: '대량' }));
  console.log('\n★결론: 관찰·작성은 자유, 되돌릴 수 없는 한 걸음(발송·제출·결제·삭제)만 사람 승인. 대량 발송 원천 차단.');
}
