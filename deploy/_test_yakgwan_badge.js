// ─────────────────────────────────────────────────────────────
// _test_yakgwan_badge.js — 📄 약관창고 출처 표시(뱃지) 시험 (2026-07-29)
//
// [사고] 약관 검색은 성공해 상품별 실제 조건까지 답했는데, 화면엔 그게 ★약관 근거라는 표시가 없었다.
//        서버는 kind='📄 약관창고'·sources를 보내는데 ★화면(genya.html)이 d.text만 꺼내 쓰고 버렸다.
//
// 이 시험은 화면 코드를 ★파일에서 꺼내 실제로 실행해 본다(눈으로 못 보는 대신 로직을 실측).
//   1. _yakBadge / _yakSources 가 genya.html에 실재하는가
//   2. 약관창고 응답이면 뱃지·근거가 나오는가
//   3. ★다른 기능 응답(고객명단·결재함 등)엔 아무것도 안 붙는가 (무접촉)
//   4. 응답 렌더링 자리에서 실제로 호출되는가 (함수만 있고 안 부르면 소용없다)
//
// 실행: node deploy/_test_yakgwan_badge.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + '  → ' + e.message); fail++; } };
const ok = (c, m) => { if (!c) throw new Error(m || '조건 실패'); };
const has = (h, n) => ok(String(h).includes(n), `"${n}" 가 없음`);
const hasNot = (h, n) => ok(!String(h).includes(n), `"${n}" 가 있으면 안 됨`);

const html = fs.readFileSync(path.join(__dirname, 'genya.html'), 'utf8');

// ── 화면 코드에서 두 함수를 그대로 꺼내 실행한다(복사본이 아니라 ★실물) ──
function 꺼내기(name) {
  const i = html.indexOf('function ' + name + '(');
  ok(i > 0, name + ' 함수가 genya.html에 없음');
  // 함수 시작부터 중괄호 균형이 맞을 때까지
  let depth = 0, started = false, end = i;
  for (let p = i; p < html.length; p++) {
    const c = html[p];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) { end = p + 1; break; } }
  }
  return html.slice(i, end);
}

const ctx = { _sEsc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') };
vm.createContext(ctx);

console.log('\n━━━ 1. 화면 코드에 함수가 실재하는가 ━━━');
T('_yakBadge 가 genya.html에 있다', () => { vm.runInContext(꺼내기('_yakBadge'), ctx); ok(typeof ctx._yakBadge === 'function'); });
T('_yakSources 가 genya.html에 있다', () => { vm.runInContext(꺼내기('_yakSources'), ctx); ok(typeof ctx._yakSources === 'function'); });

console.log('\n━━━ 2. 약관창고 응답이면 뱃지·근거가 붙는가 ━━━');
const 약관응답 = {
  kind: '📄 약관창고',
  text: '삼성화재 암보험 상품별 면책기간은…',
  sources: [
    '삼성화재 무배당 삼성화재 다이렉트 착!easy 암보험(2601.5) p.11',
    '삼성화재 무배당 삼성화재 간편보험 새로고침(2607.5) p.15',
  ],
};
T('★뱃지에 "📄 약관창고"가 나온다', () => has(ctx._yakBadge(약관응답), '📄 약관창고'));
T('★근거에 상품명이 나온다', () => has(ctx._yakSources(약관응답), '착!easy 암보험'));
T('★근거에 페이지가 나온다', () => { has(ctx._yakSources(약관응답), 'p.11'); has(ctx._yakSources(약관응답), 'p.15'); });
T('"근거 약관" 제목과 원문 확인 안내가 있다', () => {
  const s = ctx._yakSources(약관응답);
  has(s, '근거 약관'); has(s, '원문 확인');
});
T('같은 출처가 두 번 나오지 않는다', () => {
  const s = ctx._yakSources({ kind: '📄 약관창고', sources: ['삼성화재 A p.1', '삼성화재 A p.1', '삼성화재 B p.2'] });
  ok((s.match(/삼성화재 A p\.1/g) || []).length === 1, '중복 표시됨');
});
T('출처가 없으면 "지어내지 않습니다"라고 정직히 적는다', () => {
  const s = ctx._yakSources({ kind: '📄 약관창고', sources: [] });
  has(s, '지어내지 않습니다');
});
T('HTML 특수문자가 그대로 새지 않는다(이스케이프)', () => {
  const s = ctx._yakSources({ kind: '📄 약관창고', sources: ['<script>나쁜것</script> p.1'] });
  hasNot(s, '<script>'); has(s, '&lt;script&gt;');
});

console.log('\n━━━ 3. ★다른 기능 화면은 그대로 (무접촉) ━━━');
[
  ['🗂️ 고객명단', { kind: '🗂️ 고객명단', text: '명단 12명', sources: ['엉뚱한출처'] }],
  ['🗂️ 결재함', { kind: '🗂️ 결재함', text: '결재 대기 3건' }],
  ['💬 지니야', { kind: '💬 지니야', text: '안녕하세요' }],
  ['📇 고객명단', { kind: '📇 고객명단', text: '카드' }],
  ['kind 없음', { text: '그냥 답' }],
  ['빈 응답', null],
].forEach(([이름, d]) => T(`${이름} → 아무것도 안 붙는다`, () => {
  ok(ctx._yakBadge(d) === '', '뱃지가 붙음');
  ok(ctx._yakSources(d) === '', '근거가 붙음');
}));

console.log('\n━━━ 4. ★실제 렌더링 자리에서 불리는가 (함수만 있고 안 부르면 소용없다) ━━━');
T('pushMsg 렌더링에서 _yakBadge·_yakSources를 함께 쓴다', () => {
  const 줄 = html.split('\n').find((l) => l.includes("pushMsg('gen'") && l.includes('renderMd(reply)'));
  ok(줄, '응답 렌더링 줄을 못 찾음');
  has(줄, '_yakBadge(d)');
  has(줄, '_yakSources(d)');
});
T('★대화 기록에는 뱃지 HTML을 넣지 않는다(기록 오염 방지)', () => {
  const 줄 = html.split('\n').find((l) => l.includes("_HIST.push({role:'assistant',content:reply})"));
  ok(줄, '기록 저장 줄을 못 찾음');
  hasNot(줄, '_yakBadge');
});

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  통과 ${pass} · 실패 ${fail}   (전체 ${pass + fail})`);
console.log(`  ※ 화면 코드를 파일에서 꺼내 ★실제로 실행한 결과입니다(복사본 아님).`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
process.exit(fail ? 1 : 0);
