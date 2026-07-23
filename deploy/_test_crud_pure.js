// 순수 로직 단위테스트(구글 無) — 스키마 감지·동의어·컬럼레터·HMAC 서명/검증
'use strict';
const crud = require('./sheets_crud_skill');
crud.init({ signSecret: 'test-secret-123' });
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '✅' : '❌') + ' ' + name + (ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
}
const header = ['고객명', '연락처', '주소', '만기일', '보험사', '가입상품', '비고'];

// 1) 동의어/부분/정확 매핑
eq('resolve 이름→고객명', crud.resolveColumn('이름', header), '고객명');
eq('resolve 전화번호→연락처', crud.resolveColumn('전화번호', header), '연락처');
eq('resolve 거주지→주소', crud.resolveColumn('거주지', header), '주소');
eq('resolve 만기→만기일', crud.resolveColumn('만기', header), '만기일');
eq('resolve 비고(정확)', crud.resolveColumn('비고', header), '비고');
eq('resolve 없는항목→null', crud.resolveColumn('혈액형', header), null);

// 2) 이름 컬럼 감지
eq('detectNameCol', crud.detectNameCol(header), '고객명');
eq('detectNameCol(이름헤더)', crud.detectNameCol(['이름', '전화']), '이름');
eq('detectNameCol(폴백 첫컬럼)', crud.detectNameCol(['코드', '값']), '코드');

// 3) HMAC 서명/검증 왕복 + 위변조·만료
const action = { op: 'update', ts: Date.now(), rowNum: 5, column: '주소', value: '인천', name: '홍길동' };
const sig = crud.signAction(action);
eq('verify 정상', crud.verifyAction(action, sig).ok, true);
eq('verify 위변조값', crud.verifyAction(Object.assign({}, action, { value: '서울' }), sig).ok, false);
eq('verify 서명없음', crud.verifyAction(action, '').ok, false);
const stale = Object.assign({}, action, { ts: Date.now() - 20 * 60 * 1000 });
eq('verify 만료(20분전)', crud.verifyAction(stale, crud.signAction(stale)).ok, false);

// 4) 도구 6개 등록 확인(sheet_list 추가 + sheet_* 정합)
eq('도구 6개', crud.TOOLS.map((t) => t.name), ['sheet_list', 'sheet_search', 'sheet_read', 'sheet_create', 'sheet_update', 'sheet_delete']);

// 5) 후속개선: 유사이름 제안(오타·받침차이·부분·무관)
const roster = ['오정석', '오정서방', '김철수', '이영희', '이지혜'];
eq('유사제안 오타(오정서→오정석 포함)', crud.suggestNames(roster, '오정서').includes('오정석'), true);
eq('유사제안 부분(오정→후보 있음)', crud.suggestNames(roster, '오정').length >= 1, true);
eq('유사제안 무관(홍길동→없음)', crud.suggestNames(roster, '홍길동'), []);
eq('유사제안 정확(김철수 1순위)', crud.suggestNames(roster, '김철수')[0], '김철수');
eq('자모분해 받침(석→ㅅㅓㄱ)', crud.toJamo('석'), 'ㅅㅓㄱ');
eq('유사도 정확일치=1', crud.nameSimilarity('홍길동', '홍길동'), 1);

// 6) findByName: 공백·대소문자 무시(오타 흡수)
const _tbl = { nameCol: '고객명', rows: [{ 고객명: '홍 길동' }, { 고객명: '김철수' }] };
eq('findByName 공백무시(홍길동→홍 길동)', crud.findByName(_tbl, '홍길동').length, 1);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
