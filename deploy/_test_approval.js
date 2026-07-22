// 결재함 통합 단위테스트 — 가짜 시트·가짜 발송(실 구글·실발송 없음)
'use strict';
const approval = require('./approval_skill');
const crud = require('./sheets_crud_skill');

let pass = 0, fail = 0;
function ok(name, cond, extra) { console.log((cond ? '✅' : '❌') + ' ' + name + (cond ? '' : '  ' + (extra || ''))); cond ? pass++ : fail++; }

// ── 가짜 명단(구글 대신 crud.loadTable 오버라이드) ──
const fakeHeader = ['고객명', '연락처', '이메일', '만기일', '보험사'];
const fakeRows = [
  { 고객명: '홍길동', 연락처: '010-1111-1111', 이메일: 'hong@x.com', 만기일: '2026-08-15', 보험사: '삼성' },
  { 고객명: '김철수', 연락처: '010-2222-2222', 이메일: 'kim@x.com', 만기일: '2026-08-20', 보험사: '현대' },
  { 고객명: '이영희', 연락처: '010-3333-3333', 이메일: 'lee@x.com', 만기일: '2026-09-05', 보험사: '삼성' },
];
crud.loadTable = async () => ({ id: 'sheetX', gid: 0, header: fakeHeader, rows: fakeRows, nameCol: '고객명', sheets: null });

// ── 가짜 결재함 시트(메모리 2D 배열) ──
const store = []; // rows
const fakeSheets = {
  spreadsheets: {
    values: {
      get: async ({ range }) => ({ data: { values: store.map((r) => r.slice()) } }),
      update: async ({ range, requestBody }) => {
        const m = range.match(/!A(\d+)/); const rn = m ? parseInt(m[1], 10) : 1;
        store[rn - 1] = requestBody.values[0].slice(); return {};
      },
      append: async ({ requestBody }) => { requestBody.values.forEach((r) => store.push(r.slice())); return {}; },
    },
  },
};
const sent = [];
approval.init({
  getMemberSheet: async () => ({ id: 'sheetX', sheets: fakeSheets }),
  ensureTab: async () => {},
  sendSms: async (ma, to, text) => { sent.push({ ch: 'sms', to, text }); return { ok: true, sent: true }; },
  sendGmail: async (ma, to, subject, text) => { sent.push({ ch: 'gmail', to, subject, text }); return { ok: true, sent: true }; },
});

(async () => {
  const ma = {}; // 가짜 인증

  // 1) 생성 — 8월 만기 대상(홍길동·김철수 = 2명)
  const c = await approval.create(ma, { 요청내용: '8월 만기 갱신 안내', 채널: 'sms', criteria: { 만기일: '2026-08' }, 템플릿: '#{고객명}님, #{만기일} 만기 갱신 안내드립니다.' });
  ok('create 성공', c.ok, JSON.stringify(c));
  ok('create 대상수=2', c.approval && c.approval.대상수 === 2, JSON.stringify(c.approval));
  ok('create 상태=대기', c.approval && c.approval.승인상태 === '대기');
  const id1 = c.approval.id;

  // 2) 조회 — 1건, 대기 1
  const l = await approval.list(ma);
  ok('list count=1', l.count === 1);
  ok('list 대기=1', l.대기 === 1);
  ok('list 기준JSON 비노출', l.items[0].기준JSON === undefined);

  // 3) 수정 — 요청내용 변경, 여전히 대기
  const e = await approval.act(ma, { id: id1, action: 'edit', edits: { 요청내용: '8월 만기 안내(수정)' } });
  ok('edit 성공·대기 유지', e.ok && e.approval.승인상태 === '대기' && e.approval.요청내용.includes('수정'));

  // 4) 승인 — 2명(대량 미만) 즉시 발송
  const a = await approval.act(ma, { id: id1, action: 'approve' });
  ok('approve 성공', a.ok, JSON.stringify(a));
  ok('발송 2건', sent.length === 2, 'sent=' + sent.length);
  ok('치환 확인(홍길동)', sent.some((s) => s.text.includes('홍길동님') && s.text.includes('2026-08-15')), JSON.stringify(sent[0]));
  ok('상태=완료', a.approval.승인상태 === '완료');
  ok('결과 2/2', /2\/2/.test(a.approval.결과), a.approval.결과);

  // 5) 이미 처리된 건 재승인 거부
  const a2 = await approval.act(ma, { id: id1, action: 'approve' });
  ok('재처리 차단', !a2.ok && /이미/.test(a2.message));

  // 6) 대량 이중확인 — 만기 조건 넓혀 3명 되게, BULK=10 미만이라 강제로 확인 로직만: criteria 전체(빈=3명)
  sent.length = 0;
  const cBulk = await approval.create(ma, { 요청내용: '전체 안내', 채널: 'sms', criteria: {}, 템플릿: '#{고객명}님 안내' });
  ok('전체 대상=3', cBulk.approval.대상수 === 3);

  // 7) 거부
  const r = await approval.act(ma, { id: cBulk.approval.id, action: 'reject' });
  ok('거부 성공·발송0', r.ok && r.approval.승인상태 === '거부' && sent.length === 0);

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
