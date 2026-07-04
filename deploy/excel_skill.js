// ─────────────────────────────────────────────────────────────
// excel_skill.js — S-2 엑셀 스킬 (독립 모듈, 한 줄 호출) ★v4 🛠️스킬창고 부품
// 무엇을·왜: 고객명단 "읽기" + 3사 비교표/명단 엑셀 "자동 제작".
// 사용: const { readXlsx, makeSheet } = require('.../excel_skill');
//        const rows = readXlsx('명단.xlsx');
//        makeSheet({title, headers, rows}, 'out.xlsx');
// ★공통 자산(도구, 고객 데이터 아님). 값은 설계사가 실제 견적으로 채우는 "템플릿". /parksugeun 무접촉.
// ─────────────────────────────────────────────────────────────
'use strict';
const path = require('path');
const XLSX = require('xlsx');

/** 엑셀 읽기 → 객체 배열(첫 행=헤더) */
function readXlsx(file) {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const [H, ...body] = rows;
  return body.filter((r) => r.length).map((r) => { const o = {}; H.forEach((h, i) => o[h] = r[i]); return o; });
}

/** 엑셀 생성: {title, headers:[], rows:[[...],[...]]} → xlsx 파일 */
function makeSheet(spec, outPath) {
  const aoa = [spec.headers, ...(spec.rows || [])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = spec.headers.map((h, i) => ({ wch: i === 0 ? 22 : 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, spec.title || 'Sheet1');
  XLSX.writeFile(wb, outPath);
  return outPath;
}

module.exports = { readXlsx, makeSheet };

// ── 자체 시연: 3사 자동차보험 비교표 템플릿 생성 ──
if (require.main === module) {
  const out = path.join(__dirname, 'out', 'S2_자동차보험_3사비교표.xlsx');
  const headers = ['항목', '삼성화재', 'DB손해보험', '현대해상'];
  const rows = [
    ['대물배상 한도', '3억(권장)', '3억', '3억'],
    ['대인배상 II', '무한', '무한', '무한'],
    ['자기신체/자동차상해', '자동차상해 전환', '자동차상해', '자기신체'],
    ['무보험차상해', '2억', '2억', '2억'],
    ['긴급출동 서비스', '포함', '포함', '옵션'],
    ['자차 자기부담금', '20%(20~50만)', '20%', '20%'],
    ['마일리지/블랙박스 할인', '적용', '적용', '적용'],
    ['월 보험료(예시)', '설계사 견적 입력', '설계사 견적 입력', '설계사 견적 입력'],
  ];
  makeSheet({ title: '3사비교(예시템플릿)', headers, rows }, out);
  // 검증: 다시 읽어 행수 확인
  const back = readXlsx(out);
  const fs = require('fs');
  console.log(`[S-2 생성] ${out} (${Math.round(fs.statSync(out).size / 1024)}KB)`);
  console.log(`[S-2 검증] 다시 읽음 ${back.length}행, 헤더=${Object.keys(back[0]).join(' | ')}`);
  console.log(`  예: 대물 → 삼성 ${back[0]['삼성화재']} / DB ${back[0]['DB손해보험']} / 현대 ${back[0]['현대해상']}`);
  console.log('  ※ 값은 예시 템플릿 — 실제 견적은 설계사가 채움(지어낸 특정 보험료 아님).');
}
