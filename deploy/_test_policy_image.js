// _test_policy_image.js — 📷 증권 사진 해석 2단계 검증
//
// 대표님 검증 항목 그대로:
//   1. 증권 사진 → 글자 읽어 해석 ★★★
//   2. 다양한 사진 (선명·흐림·기울어짐)
//   3. ★환각 0 — 안 읽히면 빈칸·정직 (지어내면 실패)
//   4. 1단계 텍스트 해석과 연결됨 (같은 함수를 탄다)
//   5. 명단 대조·연결
//
// ★채점 원칙: 정답을 두뇌에게 묻지 않는다. _fixtures/policy_image_truth.json 의 ★원문 값과 대조한다.
//   ★흐림 사진에서는 "맞히는 것"이 아니라 ★안 지어내는 것을 본다. 가려진 값을 답에 쓰면 실패다.
//
// 시험 사진: deploy/_fixtures/증권_{선명,흐림,기울어짐}.png (증권 문서를 실제로 렌더링해 찍은 이미지)
// 실행: node deploy/_test_policy_image.js
'use strict';
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Anthropic = require('@anthropic-ai/sdk');

const img = require('./policy_image_skill');
const crud = require('./sheets_crud_skill');
const filming = require('./filming_roster');

let 통과 = 0, 실패 = 0; const 실패목록 = [];
function ok(제목, 조건, 실측) {
  if (조건) { 통과++; console.log('  ✅ ' + 제목); }
  else { 실패++; 실패목록.push(제목); console.log('  ❌ ' + 제목 + (실측 !== undefined ? '   ← 실측: ' + 실측 : '')); }
}
const FIX = path.join(__dirname, '_fixtures');
const 원문 = JSON.parse(fs.readFileSync(path.join(FIX, 'policy_image_truth.json'), 'utf8'));
const 사진 = (이름) => ({ data: fs.readFileSync(path.join(FIX, 이름)).toString('base64'), mime: 'image/png' });
const 담았나 = (a, b) => String(a || '').replace(/\s/g, '').includes(String(b || '').replace(/\s/g, ''));
const 숫자만 = (x) => String(x || '').replace(/[^\d]/g, '');

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.log('ANTHROPIC_API_KEY 없음 — 건너뜁니다.'); process.exit(0); }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  crud.init({ anthropic, model: 'claude-opus-4-8' });
  filming.enable(crud);
  await crud.loadTable(null);
  img.init({ anthropic, sheetsCrud: crud });     // 1단계 해석기도 함께 준비된다

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [1] 선명한 사진 — 글자를 그대로 읽는가 ════════');
  const t1 = await img.transcribe([사진('증권_선명.png')]);
  ok('사진을 읽었다', t1.ok === true, t1.message);
  if (t1.ok) {
    ok(`보험사(${원문.보험사})가 전사글에 있다`, 담았나(t1.text, 원문.보험사), t1.text.slice(0, 60));
    ok(`증권번호(${원문.증권번호})를 정확히 읽었다`, 담았나(t1.text, 원문.증권번호));
    ok(`만기일(${원문.만기일})을 정확히 읽었다`, 담았나(t1.text, 원문.만기일));
    ok(`보험료(${원문.보험료})를 정확히 읽었다`, 숫자만(t1.text).includes(숫자만(원문.보험료)));
    ok('보장 5개를 모두 읽었다', 원문.보장.every((b) => 담았나(t1.text, b[0])),
      원문.보장.filter((b) => !담았나(t1.text, b[0])).map((b) => b[0]).join(','));
    ok('선명한 사진엔 [안 읽힘]이 없다', img.안읽힌수(t1.text) === 0, img.안읽힌수(t1.text) + '군데');
  }

  console.log('\n── 해석까지 (1단계 재활용) ──');
  const a1 = await img.analyzeImages([사진('증권_선명.png')], {});
  ok('★해석 결과가 1단계와 같은 형식으로 나온다', a1.viaImage === true && /증권 내용을 읽었어요/.test(String(a1.text)), String(a1.text).slice(0, 70));
  ok('  보험사 정확', 담았나(a1.text, 원문.보험사));
  ok('  상품명 정확', 담았나(a1.text, 원문.상품명), String(a1.text).slice(0, 120));
  ok('  증권번호 정확', 담았나(a1.text, 원문.증권번호));
  ok('  만기일 정확', 담았나(a1.text, 원문.만기일));
  ok('  보장 5개 모두 답에 있다', 원문.보장.every((b) => 담았나(a1.text, b[0])));
  ok('  설계사 핵심 정리가 있다', /핵심 정리/.test(String(a1.text)));
  ok('  ★무엇을 보고 말했는지(전사글)를 함께 돌려준다', String(a1.전사글 || '').length > 100);

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [2] ★흐린 사진 — 안 읽히면 지어내지 않는가 (환각 0) ════════');
  const t2 = await img.transcribe([사진('증권_흐림.png')]);
  ok('사진을 읽었다', t2.ok === true, t2.message);
  if (t2.ok) {
    ok('★가려진 곳을 [안 읽힘]으로 표시한다', img.안읽힌수(t2.text) >= 1, img.안읽힌수(t2.text) + '군데 · ' + (t2.상태 || '(상태 없음)'));
    ok(`★★가려진 증권번호(${원문.증권번호})를 ★지어내지 않았다`, !담았나(t2.text, 원문.증권번호),
      '전사글에 증권번호가 들어감 = 환각');
    ok(`★★가려진 보험료(${원문.보험료})를 ★지어내지 않았다`, !숫자만(t2.text).includes(숫자만(원문.보험료)),
      '전사글에 보험료가 들어감 = 환각');
    ok('안 가려진 보험사는 제대로 읽었다', 담았나(t2.text, 원문.보험사));
    ok('안 가려진 만기일은 제대로 읽었다', 담았나(t2.text, 원문.만기일));
    ok('안 가려진 보장 5개는 제대로 읽었다', 원문.보장.every((b) => 담았나(t2.text, b[0])));
    ok('사진 상태를 말한다', String(t2.상태 || '').length > 0, t2.상태);
  }

  console.log('\n── 해석까지 ──');
  const a2 = await img.analyzeImages([사진('증권_흐림.png')], {});
  ok('★흐린 곳이 있다고 정직하게 알린다', /흐리거나 잘려서|확인이 어려|안 읽/.test(String(a2.text)), String(a2.text).slice(-160));
  ok('★★답에도 가려진 증권번호를 안 만든다', !담았나(a2.text, 원문.증권번호));
  ok('★★답에도 가려진 보험료를 안 만든다', !숫자만(String(a2.text)).includes(숫자만(원문.보험료)));
  ok('읽힌 값(보험사·만기일)은 제대로 답한다', 담았나(a2.text, 원문.보험사) && 담았나(a2.text, 원문.만기일));
  ok('못 읽은 곳 수를 센다', typeof a2.안읽힌곳 === 'number' && a2.안읽힌곳 >= 1, String(a2.안읽힌곳));

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [3] 기울어진 사진 ════════');
  const t3 = await img.transcribe([사진('증권_기울어짐.png')]);
  ok('사진을 읽었다', t3.ok === true, t3.message);
  if (t3.ok) {
    ok('기울어져도 보험사를 읽는다', 담았나(t3.text, 원문.보험사));
    ok('기울어져도 증권번호를 읽는다', 담았나(t3.text, 원문.증권번호), t3.text.slice(0, 80));
    ok('기울어져도 만기일을 읽는다', 담았나(t3.text, 원문.만기일));
    ok('기울어져도 보장 5개를 읽는다', 원문.보장.every((b) => 담았나(t3.text, b[0])),
      원문.보장.filter((b) => !담았나(t3.text, b[0])).map((b) => b[0]).join(','));
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [4] 명단 대조·연결 ════════');
  {
    const t = await crud.loadTable(null);
    const 있는이름 = t.rows[0][t.nameCol];
    const b = await img.analyzeImages([사진('증권_선명.png')], { 이름힌트: 있는이름 });
    ok(`명단에 있는 고객(${있는이름}) → 찾아 연결하고 대조표를 보여준다`,
      b.명단 === '있음' && /지금 명단/.test(String(b.text)), b.명단 + ' / ' + String(b.text).slice(-100));
    ok('  반영할지 물어본다(제 맘대로 안 씀)', /반영할까요/.test(String(b.text)));

    const c = await img.analyzeImages([사진('증권_선명.png')], { 이름힌트: 원문.계약자 });
    ok(`명단에 없는 고객(${원문.계약자}) → 없다고 말하고 추가 제안`, c.명단 === '없음' && /추가할까요/.test(String(c.text)),
      c.명단 + ' / ' + String(c.text).slice(-80));
  }

  // ═══════════════════════════════════════════════════════════
  console.log('\n════════ [5] 안전 장치 ════════');
  {
    const e1 = await img.transcribe([]);
    ok('사진이 없으면 정직하게 말한다', e1.ok === false && /없어요/.test(e1.message), JSON.stringify(e1));
    const e2 = await img.transcribe([{ data: 'AAAA', mime: 'text/plain' }]);
    ok('못 다루는 형식이면 정직하게 말한다', e2.ok === false && /형식/.test(e2.message), JSON.stringify(e2));
    ok('★해석은 1단계 모듈 한 벌만 쓴다(길이 갈리지 않게)',
      /require\('\.\/policy_text_skill'\)/.test(fs.readFileSync(path.join(__dirname, 'policy_image_skill.js'), 'utf8')));
    ok('★사진을 서버에 저장하는 코드가 없다(제로 인그레스)',
      !/writeFileSync|createWriteStream/.test(fs.readFileSync(path.join(__dirname, 'policy_image_skill.js'), 'utf8')));
  }

  console.log('\n' + '═'.repeat(58));
  console.log(`  결과: ✅ ${통과}개 통과 · ❌ ${실패}개 실패`);
  if (실패) { console.log('  실패 항목:'); 실패목록.forEach((x) => console.log('    · ' + x)); }
  console.log('═'.repeat(58) + '\n');
  process.exit(실패 ? 1 : 0);
})().catch((e) => { console.error('시험 도중 오류:', e); process.exit(1); });
