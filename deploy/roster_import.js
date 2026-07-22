// ─────────────────────────────────────────────────────────────
// roster_import.js — 📇 Step 2-F · 명단 업로드→회원 시트 저장 (독립 모듈)
// 무엇을·왜: 회장님이 올린 고객명단(엑셀·CSV)을 "회원 본인 구글시트 명단"으로 저장.
//   → 그래야 Step 2-B(CRUD)·2-C(결재함)·만기관리가 "올린 그 명단"으로 일함(끊김 해소).
//
// ★설계 결재(A/A/B): 명단 업로드 = B) 회원 시트 저장.
// ★제로 인그레스: 파일은 서버 RAM에서 파싱만 하고, 회원 본인 구글시트에 write 후 폐기. 서버 저장 0.
// ★무접촉: 하이브리드 라우터·엄마2·엄마1(ohwant) 무접촉. main_server는 require+init+엔드포인트 추가만.
//
// 사용: const roster = require('./roster_import');
//        roster.init({ getMemberSheet, ensureTab, title, tab });
//        roster.importRoster(ma, { dataUrl, mode:'replace'|'append', confirm })
// ─────────────────────────────────────────────────────────────
'use strict';
const XLSX = require('xlsx');
const crud = require('./sheets_crud_skill'); // 기존 명단 조회·이름컬럼 감지 재사용(중복 검사용)

let _getMemberSheet = null; // (ma) => {id, sheets}
let _ensureTab = null;      // (sheets, id, title) => void
let _TITLE = '지니야빌더_데모_명단';
let _TAB = '고객명단';

function init(opts) {
  opts = opts || {};
  if (opts.getMemberSheet) _getMemberSheet = opts.getMemberSheet;
  if (opts.ensureTab) _ensureTab = opts.ensureTab;
  if (opts.title) _TITLE = opts.title;
  if (opts.tab) _TAB = opts.tab;
}

function _stripB64(dataUrl) { const s = String(dataUrl || ''); const i = s.indexOf('base64,'); return i >= 0 ? s.slice(i + 7) : s; }

// 엑셀(xlsx/xls)·CSV 모두 XLSX로 파싱. 첫 비어있지 않은 행 = 헤더.
//   ★인코딩: 엑셀=바이너리(PK/OLE 시그니처), CSV=UTF-8 텍스트로 읽어야 한글 안 깨짐(BOM 제거).
function parse(dataUrl) {
  const buf = Buffer.from(_stripB64(dataUrl), 'base64');
  const isXlsx = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4B;          // 'PK' = xlsx(zip)
  const isXls = buf.length >= 4 && buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0; // OLE = xls
  let wb;
  if (isXlsx || isXls) { wb = XLSX.read(buf, { type: 'buffer' }); }
  else { let s = buf.toString('utf8'); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); wb = XLSX.read(s, { type: 'string' }); } // CSV=UTF-8
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { header: [], rows: [] };
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const nonEmpty = aoa.filter((r) => r && r.some((c) => String(c == null ? '' : c).trim()));
  if (!nonEmpty.length) return { header: [], rows: [] };
  const header = nonEmpty[0].map((h) => String(h == null ? '' : h).trim());
  const width = header.length;
  const rows = nonEmpty.slice(1).map((r) => { const out = []; for (let i = 0; i < width; i++) out.push(String(r[i] == null ? '' : r[i]).trim()); return out; });
  return { header, rows };
}

// 업로드→저장. confirm 전엔 미리보기만. mode: 'replace'(교체) | 'append'(추가).
async function importRoster(ma, input) {
  input = input || {};
  const { header, rows } = parse(input.dataUrl);
  if (!header.length || !rows.length) return { ok: false, message: '파일에서 명단을 못 읽었어요. 엑셀·CSV 첫 줄이 컬럼 이름(고객명·연락처 등)인지 확인해 주세요.' };

  // 1) 미리보기(저장 안 함) — 신규/중복 검사로 대표가 안전하게 교체·추가 판단
  if (!input.confirm) {
    let 신규 = rows.length, 중복 = 0, 중복명단 = [];
    try {
      const existing = await crud.loadTable(ma);                 // 기존 명단(회원 시트)
      const upNameCol = crud.detectNameCol(header);              // 업로드 파일의 이름 컬럼
      const upIdx = header.indexOf(upNameCol);
      const existSet = new Set((existing.rows || []).map((r) => String(r[existing.nameCol] || '').trim()).filter(Boolean));
      if (existSet.size && upIdx >= 0) {
        중복 = 0; 신규 = 0;
        rows.forEach((r) => { const nm = String(r[upIdx] || '').trim(); if (nm && existSet.has(nm)) { 중복++; if (중복명단.length < 5) 중복명단.push(nm); } else 신규++; });
      }
    } catch (e) { /* 기존 명단 없음 = 전부 신규 */ }
    return { ok: true, needsConfirm: true, header, count: rows.length, 신규, 중복, 중복명단, preview: rows.slice(0, 5), message: `${rows.length}명을 읽었어요 (신규 ${신규}명, 이미 있음 ${중복}명). 새로 교체할까요, 기존에 추가할까요?` };
  }

  // 2) 저장
  const { id, sheets } = await _getMemberSheet(ma);
  await _ensureTab(sheets, id, _TAB);
  const mode = input.mode === 'append' ? 'append' : 'replace';

  if (mode === 'append') {
    let existing = [];
    try { const g = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${_TAB}!A1:1` }); existing = (g.data.values || [])[0] || []; } catch (e) {}
    if (!existing.length) { await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${_TAB}!A1`, valueInputOption: 'RAW', requestBody: { values: [header] } }); existing = header.slice(); }
    // 들어온 행을 기존 헤더 순서에 맞춰 매핑(컬럼 순서 달라도 안전)
    const mapped = rows.map((r) => { const o = {}; header.forEach((h, i) => o[h] = r[i]); return existing.map((h) => (o[h] != null ? o[h] : '')); });
    await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${_TAB}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: mapped } });
    return { ok: true, mode, imported: rows.length, header: existing, message: `${rows.length}명을 명단에 추가했어요.` };
  }

  // replace: 기존 내용 비우고 새로 씀
  try { await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `${_TAB}!A1:Z10000` }); } catch (e) {}
  await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${_TAB}!A1`, valueInputOption: 'RAW', requestBody: { values: [header].concat(rows) } });
  return { ok: true, mode, imported: rows.length, header, message: `명단을 새로 저장했어요(${rows.length}명).` };
}

module.exports = { init, parse, importRoster };
