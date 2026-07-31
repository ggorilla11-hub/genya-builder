// ★결재 대상 필터 시험 — "8월 생일자" 같은 조건이 발송 대상을 정확히 좁히는가
//   (2026-07-31 CTO 패치: 발송 필터를 두뇌 sheet_search 와 같은 엔진으로 통일)
//
//   ★이 시험의 원칙(CLAUDE.md 6-8 ③): 응답 글자가 아니라 ★실제로 몇 명이 잡혔나로 판정한다.
//     "좁혔어요"라고 말만 하고 전체가 잡히던 것이 바로 이번 사고였다.
//     숫자만 맞고 사람이 틀리는 것도 사고이므로 ★누가 잡혔는지까지 본다.
//   실 구글·실발송 없음. 가짜 명단·가짜 시트만 쓴다.
'use strict';
const approval = require('./approval_skill');
const crud = require('./sheets_crud_skill');

delete process.env.APPROVAL_LIVE_SEND;
delete process.env.SAFE_EMAIL_WHITELIST; delete process.env.SAFE_PHONE_WHITELIST;
delete process.env.APPROVAL_TEST_EMAIL; delete process.env.APPROVAL_TEST_TO;

let pass = 0, fail = 0;
function ok(name, cond, extra) { console.log('  ' + (cond ? '✅' : '❌') + ' ' + name + (cond ? '' : '  ' + (extra || ''))); cond ? pass++ : fail++; }

// ── 가짜 명단 — 대표님 실제 사고 그대로: 생일이 여러 달에 흩어져 있다 ──
const header = ['고객명', '연락처', '이메일', '생년월일', '만기일', '연소득'];
const rows = [
  { 고객명: '장종석', 연락처: '010-0000-0057', 이메일: 'jang@x.com', 생년월일: '1968-08-17', 만기일: '2026-11-01', 연소득: '4000' },
  { 고객명: '김철수', 연락처: '010-0000-0001', 이메일: 'kim@x.com',  생년월일: '1975-03-02', 만기일: '2026-08-10', 연소득: '8000' },
  { 고객명: '이영희', 연락처: '010-0000-0002', 이메일: 'lee@x.com',  생년월일: '1982-12-25', 만기일: '2026-08-21', 연소득: '5200' },
  { 고객명: '최동욱', 연락처: '010-0000-0003', 이메일: 'choi@x.com', 생년월일: '1990-08-03', 만기일: '2027-01-05', 연소득: '3000' },
  { 고객명: '신미경', 연락처: '010-0000-0004', 이메일: 'shin@x.com', 생년월일: '1958-05-11', 만기일: '2026-08-30', 연소득: '9000' },
];
crud.loadTable = async () => ({ id: 'sheetX', gid: 0, header, rows, nameCol: '고객명', sheets: null });

const store = [];
const fakeSheets = { spreadsheets: { values: {
  get: async () => ({ data: { values: store.map((r) => r.slice()) } }),
  update: async ({ range, requestBody }) => { const m = range.match(/!A(\d+)/); store[(m ? +m[1] : 1) - 1] = requestBody.values[0].slice(); return {}; },
  append: async ({ requestBody }) => { requestBody.values.forEach((r) => store.push(r.slice())); return {}; },
} } };
const sent = [];
approval.init({
  getMemberSheet: async () => ({ id: 'sheetX', sheets: fakeSheets }),
  ensureTab: async () => {},
  sendSms: async (ma, to, text) => { sent.push({ ch: 'sms', to, text }); return { ok: true, sent: true }; },
  sendGmail: async (ma, to, s, t) => { sent.push({ ch: 'gmail', to, subject: s, text: t }); return { ok: true, sent: true }; },
});

// 결재함에 실제로 올려서 ★대상수를 읽는다(말이 아니라 저장된 값).
async function 대상(criteria, 채널) {
  const c = await approval.create({}, { 요청내용: '시험', 채널: 채널 || 'sms', criteria, 템플릿: '#{고객명}님 안내드립니다.' });
  return { ok: c.ok, 수: c.approval ? c.approval.대상수 : undefined, 말: c.message || '', 원문: c };
}

// ★누가 잡혔는지 — 결재가 쓰는 것과 ★같은 엔진(crud._filter)을 직접 돌려 이름을 본다.
function 이름들(filters, mode) {
  const F = crud._filter; const today = F.todayKST();
  const prepared = [];
  for (const f of filters) {
    const col = crud.resolveColumn(f.column, header); if (!col) continue;
    const p = F.prep(col, f); if (p.error) continue;
    prepared.push(p.filter);
  }
  if (!prepared.length) return [];
  const or = String(mode || 'AND').toUpperCase() === 'OR';
  return rows.filter((r) => (or
    ? prepared.some((f) => F.match(r[f.col], f, today))
    : prepared.every((f) => F.match(r[f.col], f, today)))).map((r) => r.고객명);
}

(async () => {
  console.log('\n━━━ 결재 대상 필터 — 실제로 몇 명이·누가 잡히나 ━━━');

  console.log('\n[1] ★사고 그대로: "8월 생일자" — 8월생만 잡혀야 한다');
  const f1 = [{ column: '생년월일', op: 'month', value: 8 }];
  const a = await 대상({ filters: f1 });
  const n1 = 이름들(f1);
  ok('생성 성공', a.ok, JSON.stringify(a.원문));
  ok('★대상 2명(장종석 8/17 · 최동욱 8/3)', a.수 === 2, '실제=' + a.수);
  ok('★전체 5명으로 안 넓혀짐(이게 이번 사고)', a.수 !== 5, '실제=' + a.수);
  ok('★잡힌 사람이 정확히 그 둘', n1.join(',') === '장종석,최동욱', n1.join(','));
  ok('★8월 생일 아닌 사람은 한 명도 안 섞임', !n1.some((x) => ['김철수', '이영희', '신미경'].includes(x)), n1.join(','));
  ok('★대상수와 실제 이름 수가 같다(숫자만 맞는 착시 차단)', a.수 === n1.length, a.수 + ' vs ' + n1.length);

  console.log('\n[2] 옛 방식({칸:값} 부분일치)도 그대로 된다 — 하위호환');
  const b = await 대상({ 만기일: '2026-08' });
  ok('★8월 만기 3명(김철수·이영희·신미경)', b.수 === 3, '실제=' + b.수);

  console.log('\n[3] 이름 한 명 지정 — 예전처럼 정확히 한 명');
  const c = await 대상({ 고객명: '장종석' });
  ok('★딱 1명', c.수 === 1, '실제=' + c.수);

  console.log('\n[4] 숫자 범위 — "연소득 5천 이상"');
  const f4 = [{ column: '연소득', op: 'gte', value: 5000 }];
  const d = await 대상({ filters: f4 });
  ok('★3명', d.수 === 3, '실제=' + d.수);
  ok('★그 3명이 김철수·이영희·신미경', 이름들(f4).join(',') === '김철수,이영희,신미경', 이름들(f4).join(','));

  console.log('\n[5] 조건 두 개 AND — "8월 생일 + 연소득 5천 이상" = 아무도 없다');
  const f5 = [{ column: '생년월일', op: 'month', value: 8 }, { column: '연소득', op: 'gte', value: 5000 }];
  const e = await 대상({ match: 'AND', filters: f5 });
  ok('★0명이라고 정직히(억지로 채우지 않는다)', e.수 === 0, '실제=' + e.수);
  ok('★엔진도 0명', 이름들(f5, 'AND').length === 0, 이름들(f5, 'AND').join(','));

  console.log('\n[6] 조건 두 개 OR — "8월 생일 또는 연소득 9천 이상"');
  const f6 = [{ column: '생년월일', op: 'month', value: 8 }, { column: '연소득', op: 'gte', value: 9000 }];
  const f = await 대상({ match: 'OR', filters: f6 });
  ok('★3명(장종석·최동욱·신미경)', f.수 === 3, '실제=' + f.수);
  ok('★그 3명이 맞다', 이름들(f6, 'OR').join(',') === '장종석,최동욱,신미경', 이름들(f6, 'OR').join(','));

  console.log('\n[7] 전체({}) — 넓혀야 할 때는 제대로 넓힌다');
  const g = await 대상({});
  ok('★5명 전원', g.수 === 5, '실제=' + g.수);

  console.log('\n[8] ★없는 칸을 조건으로 줘도 안 터진다');
  const h = await 대상({ filters: [{ column: '없는칸', op: 'month', value: 8 }] });
  ok('★터지지 않고 응답한다', h.ok === true, JSON.stringify(h.원문));

  console.log('\n[9] ★★발송 하드가드 — 필터를 고쳐도 발송은 여전히 [승인] 버튼만');
  // ★결재함에 ★실제로 올라가 있는 건을 대상으로 눌러야 하드가드를 진짜로 시험하는 것이다
  //   (없는 id를 주면 "못 찾았어요"가 먼저 나와, 하드가드를 통과한 척 착각한다)
  const 실제id = (store[store.length - 1] || [])[0];
  ok('★시험할 결재 건이 실제로 결재함에 있다', !!실제id, '결재함 줄수=' + store.length);
  const 강제 = await approval.act({}, { id: 실제id, action: 'approve' });
  ok('★버튼 없이(humanApproval 없이) 승인하면 거부', 강제.ok === false && 강제.blockedNoHuman === true, JSON.stringify(강제));
  ok('★시험 내내 실제 발송 0건', sent.length === 0, '나간 건수=' + sent.length);
  ok('★대화 도구에 발송 도구가 없다', !approval.TOOLS.some((t) => /send/.test(t.name)), approval.TOOLS.map((t) => t.name).join(','));

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('통과 ' + pass + ' · 실패 ' + fail);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(fail ? 1 : 0);
})();
