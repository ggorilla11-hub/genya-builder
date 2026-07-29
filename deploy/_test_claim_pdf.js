// ─────────────────────────────────────────────────────────────
// _test_claim_pdf.js — 🩹 청구서 PDF 한글 깨짐 재발 방지 시험 (2026-07-29 긴급)
//
// 사고: 배포된 청구서 PDF의 한글이 전부 깨져 나왔다("¼ôÕØ®…").
//   Render(리눅스)에 한글 폰트가 하나도 없어 PDFKit 기본폰트로 떨어졌기 때문.
//   ★개발 PC는 Windows라 맑은고딕이 잡혀 로컬에선 멀쩡해 보였다 — 그래서 못 봤다.
//
// 이 시험은 "될 것이다"라고 믿지 않는다. ★진짜로 PDF를 만들고, ★글자를 도로 꺼내서 확인한다.
//   1) 번들 폰트가 실제로 파일로 있는가 (없으면 배포 즉시 깨진다)
//   2) OS 폰트를 다 지워도(=Render 상황) 폰트를 찾는가
//   3) PDF가 실제로 만들어지고, ★한글이 그대로 읽히는가 (pdf-parse로 역추출)
//   4) 4개 섹션·명단 값(이름·직업 등)이 안 깨지는가
//
// 실행: node deploy/_test_claim_pdf.js
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const claim = require('./claim_form_skill');

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + '  → ' + e.message); fail++; } };
const TA = async (n, f) => { try { await f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + '  → ' + e.message); fail++; } };
const ok = (c, m) => { if (!c) throw new Error(m || '조건 실패'); };
const has = (h, n) => ok(String(h).includes(n), `"${n}" 가 없음`);

// 실제 명단 모양 그대로 (한글 헤더·한글 값)
const table = {
  header: ['고객명', '직업', '연락처', '이메일', '계좌은행', '계좌번호', '보험사', '증권번호'],
  nameCol: '고객명',
  rows: [{
    _rowNum: 2, 고객명: '김철수', 직업: '자영업(음식점)', 연락처: '010-1234-5678',
    이메일: 'kim@example.com', 계좌은행: '국민은행', 계좌번호: '123456-01-789012',
    보험사: '삼성화재', 증권번호: 'A1234567',
  }],
};

(async function main() {

console.log('\n━━━ 1. 번들 한글 폰트가 실제로 있는가 (배포 안전) ━━━');
const 폰트경로 = path.join(__dirname, 'fonts', 'NanumGothic.ttf');
T('deploy/fonts/NanumGothic.ttf 파일이 존재한다', () => ok(fs.existsSync(폰트경로), '★폰트 파일이 없다 — 배포하면 한글이 깨진다'));
T('폰트 파일 크기가 정상이다(1MB 이상)', () => {
  const sz = fs.statSync(폰트경로).size;
  ok(sz > 1000000, '크기가 이상함: ' + sz + ' bytes (LFS 포인터만 커밋됐을 수 있음)');
});
T('진짜 TTF 파일이다(머리 4바이트 확인)', () => {
  const b = fs.readFileSync(폰트경로).slice(0, 4);
  ok(b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0, '머리=' + Array.from(b).join(','));
});
T('OFL 라이선스 파일이 함께 있다(재배포 조건)', () => ok(fs.existsSync(path.join(__dirname, 'fonts', 'OFL.txt'))));

console.log('\n━━━ 2. Render(리눅스) 상황에서도 폰트를 찾는가 ━━━');
T('★번들 폰트가 1순위다 — OS 폰트에 기대지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, 'claim_form_skill.js'), 'utf8');
  const i번들 = src.indexOf('BUNDLED_KR_FONT,');
  const i윈도 = src.indexOf("'C:\\\\Windows");
  ok(i번들 > 0 && i윈도 > 0 && i번들 < i윈도, '번들 폰트가 OS 폰트보다 뒤에 있음 — 로컬과 배포가 달라진다');
});
T('★실제로 고르는 폰트가 번들 폰트다 (Windows 맑은고딕이 아님)', () => {
  const 고른것 = claim._krFont();
  ok(고른것 === claim._BUNDLED_KR_FONT, '엉뚱한 폰트를 고름: ' + 고른것);
  // 이게 통과해야 "로컬에서 본 것 = Render에서 나오는 것"이 성립한다
});
T('★.ttc(폰트 모음)를 후보에서 뺐다 — 조용한 실패의 원인이었다', () => {
  const src = fs.readFileSync(path.join(__dirname, 'claim_form_skill.js'), 'utf8');
  ok(!/NotoSansCJK-Regular\.ttc/.test(src.split('function krFont')[1].split('}')[0] || ''), '.ttc 후보가 남아있음');
});

console.log('\n━━━ 3. ★진짜 PDF를 만들어 한글을 도로 꺼내 확인 ━━━');
const built = claim.buildClaim(table, '김철수', { 진단명: '반월상연골파열', 병원명: '서울정형외과의원' });
T('청구서 데이터가 만들어진다', () => ok(built.ok, built.error));

let buf = null, 텍스트 = '';
await TA('PDF Buffer가 실제로 만들어진다', async () => {
  buf = await claim.renderClaimPdf(built);
  ok(Buffer.isBuffer(buf), 'Buffer가 아님');
  ok(buf.length > 5000, 'PDF가 너무 작음: ' + buf.length);
  ok(buf.slice(0, 4).toString() === '%PDF', 'PDF 머리가 아님');
});
T('★한글 폰트가 실제로 등록됐다(조용한 실패 아님)', () => ok(built._한글폰트 === true, '폰트 등록 실패 — 기본폰트로 떨어졌다'));

await TA('PDF 안에서 한글 글자를 도로 읽어낸다', async () => {
  // ★main_server.js:2570과 똑같은 방식으로 읽는다(pdf-parse v2 = PDFParse 클래스)
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buf });
  const r = await parser.getText(); await parser.destroy();
  const raw = Array.isArray(r.pages) ? r.pages.map((p) => (p.text !== undefined ? p.text : p)).join(' ') : (r.text || '');
  텍스트 = String(raw).replace(/\s+/g, '');
  ok(텍스트.length > 30, '추출된 글자가 너무 적음: ' + 텍스트.length);
});

console.log('\n━━━ 3-2. 깨짐 없이 그대로 나오는가 ━━━');
T('머리글 "보험금 청구서"가 그대로 읽힌다 ★★★', () => has(텍스트, '보험금청구서'));
T('경고 문구가 그대로 읽힌다', () => has(텍스트, '제출 전 반드시 검토하세요'.replace(/\s+/g, '')));

console.log('\n━━━ 4. 명단 값(이름·직업 등)이 안 깨지는가 ━━━');
[['고객 이름', '김철수'], ['직업(괄호 포함)', '자영업(음식점)'], ['은행', '국민은행'], ['보험사', '삼성화재'],
 ['대화로 넣은 진단명', '반월상연골파열'], ['대화로 넣은 병원명', '서울정형외과의원']]
  .forEach(([라벨, 값]) => T(`${라벨} — "${값}"`, () => has(텍스트, 값.replace(/\s+/g, ''))));

console.log('\n━━━ 5. 4개 섹션이 다 나오는가 ━━━');
[['1. 인적사항', '인적사항'], ['2. 사고사항', '사고사항'], ['3. 보험금 수령 계좌', '보험금수령계좌'], ['4. 청구인 확인·서명', '청구인']]
  .forEach(([라벨, 값]) => T(`${라벨}`, () => has(텍스트, 값)));
T('빈칸 표시("증빙에서 입력 필요")도 한글로 나온다', () => has(텍스트, '증빙에서입력필요'));

console.log('\n━━━ 5-2. ★폰트가 진짜 PDF 안에 박혔는가 (글자 추출로는 알 수 없는 것) ━━━');
// ★2026-07-29 회장님 지적: pdf-parse가 "글자 읽힘"이라 해도 ★화면 렌더링은 깨질 수 있다.
//   글자 추출은 ToUnicode 표만 보므로, 폰트가 안 박혀도 통과할 수 있다.
//   → PDF 구조를 직접 뒤져서 "글자꼴이 실제로 들어있는지"를 확인한다.
T('★NanumGothic 이 PDF에 임베드돼 있다', () => {
  const s = buf.toString('latin1');
  const names = s.match(/[A-Z]{6}\+[A-Za-z0-9\-]+/g) || [];
  ok(names.some((n) => /NanumGothic/i.test(n)), '임베드된 폰트: ' + (names.join(', ') || '★없음'));
});
T('★FontFile2 — 트루타입 글자꼴이 실제로 파일에 삽입됐다', () => {
  ok(/FontFile2/.test(buf.toString('latin1')), '글자꼴이 안 들어있음 → 뷰어에서 깨진다');
});
T('★CIDFontType2 — 한글용 CID 인코딩으로 들어갔다', () => {
  ok(/CIDFontType2/.test(buf.toString('latin1')), '한글 CID 인코딩이 아님');
});
T('★본문이 기본폰트(Helvetica)로 떨어지지 않았다', () => {
  const s = buf.toString('latin1');
  const helv = (s.match(/BaseFont\s*\/Helvetica/g) || []).length;
  ok(helv === 0, 'Helvetica가 ' + helv + '곳 쓰임 — 그 자리 한글은 깨진다');
});

console.log('\n━━━ 6. 깨진 글자가 섞여 있지 않은가 ━━━');
T('★한글 자모가 깨진 라틴 문자로 바뀌지 않았다', () => {
  // 깨질 때 나타나는 전형적 문자들(¼ Õ Ø ® Á 등)이 본문에 섞이면 실패
  const 깨짐 = 텍스트.match(/[¼½¾ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß®©¿]/g);
  ok(!깨짐, '깨진 글자 발견: ' + (깨짐 || []).slice(0, 10).join(''));
});
T('한글이 실제로 상당수 들어 있다', () => {
  const 한글 = (텍스트.match(/[가-힣]/g) || []).length;
  ok(한글 > 50, '한글 글자 수가 너무 적음: ' + 한글);
});

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  통과 ${pass} · 실패 ${fail}   (전체 ${pass + fail})`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
process.exit(fail ? 1 : 0);

})();
