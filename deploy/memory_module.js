// ─────────────────────────────────────────────────────────────
// memory_module.js — 🧠 MEM 기억 엔진 (지니야 정체성 #1 "기억하고 먼저 리딩"의 심장)
// 무엇을·왜: 회원이 지니야와 정한 것·약속·패턴을 회원 구글시트에 로그로 쌓고(MEM-1),
//   다음 대화 때 관련 기억을 읽어 "──하기로 하셨죠?"로 맥락 복원(MEM-2), 패턴 기억(MEM-3).
// 사용: const M = require('.../memory_module');
//        await M.saveMemory({type:'결정', subject:'김철수', text:'...'});
//        await M.recallMemory('김철수');  await M.recallRecent(5);  await M.deleteMemory(rowNumber);
//
// ★대원칙(절대): 기억은 오원트 서버에 저장 0 — 회원 본인 구글시트에만(제로 인그레스).
//   회원마다 자기 시트 = 회원 간 격리. 회원이 자기 기억 삭제 가능(deleteMemory).
// ★지금은 SA 데모(대표님 시트) / 제품은 회원 OAuth로 googleAuth만 교체. /parksugeun 무접촉.
// ─────────────────────────────────────────────────────────────
'use strict';
const { google } = require('googleapis');
const KEY_FILE = process.env.GOOGLE_SA_JSON || '{}';
const MEMBER_SHEET_TITLE = process.env.MEM_SHEET || '지니야빌더_데모_명단'; // 회원 본인 스프레드시트
const MEM_TAB = '지니야_기억';
const HEADER = ['일시', '종류', '대상', '내용'];

function googleAuth() { // SA 폴백(데모)
  return new google.auth.GoogleAuth({ credentials: JSON.parse(KEY_FILE), scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly'] });
}
// ★원칙3 전환: memberAuth(회원 OAuth)를 주면 회원 본인 구글시트, 없으면 SA. 회원마다 자기 기억(격리).
async function ctx(memberAuth) {
  const auth = memberAuth || googleAuth();
  const drive = google.drive({ version: 'v3', auth }), sheets = google.sheets({ version: 'v4', auth });
  const f = await drive.files.list({ q: `mimeType='application/vnd.google-apps.spreadsheet' and name='${MEMBER_SHEET_TITLE}' and trashed=false`, fields: 'files(id)' });
  const id = (f.data.files || [])[0] && f.data.files[0].id;
  if (!id) throw new Error(`회원 시트 '${MEMBER_SHEET_TITLE}' 없음 — 회원 구글에 시트 필요`);
  // 기억 탭 없으면 생성 + 헤더
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
  const has = (meta.data.sheets || []).some((s) => s.properties.title === MEM_TAB);
  if (!has) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title: MEM_TAB } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${MEM_TAB}!A1`, valueInputOption: 'RAW', requestBody: { values: [HEADER] } });
  }
  return { sheets, id };
}

// MEM-1: 기억 저장(회원 구글시트에 한 줄 append). ts는 호출부에서 넣거나 자동.
async function saveMemory(entry, memberAuth) {
  const { sheets, id } = await ctx(memberAuth);
  const ts = entry.ts || new Date().toISOString().slice(0, 16).replace('T', ' ');
  const row = [ts, entry.type || '메모', entry.subject || '', String(entry.text || '')];
  await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${MEM_TAB}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [row] } });
  return { saved: true, row };
}

async function _all(memberAuth) {
  const { sheets, id } = await ctx(memberAuth);
  const got = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${MEM_TAB}!A2:D` });
  return (got.data.values || []).map((r, i) => ({ rowNumber: i + 2, ts: r[0] || '', type: r[1] || '', subject: r[2] || '', text: r[3] || '' }));
}

// MEM-2: 기억 인출(대상/내용 매칭). 최근순.
async function recallMemory(query, memberAuth) {
  const q = String(query || '').trim();
  const all = await _all(memberAuth);
  const hits = q ? all.filter((m) => (m.subject + ' ' + m.text).includes(q)) : all;
  return hits.reverse();
}
async function recallRecent(n = 5, memberAuth) { return (await _all(memberAuth)).slice(-n).reverse(); }

// ★회원이 자기 기억 삭제 (행 내용 비움)
async function deleteMemory(rowNumber, memberAuth) {
  const { sheets, id } = await ctx(memberAuth);
  await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `${MEM_TAB}!A${rowNumber}:D${rowNumber}` });
  return { deleted: rowNumber };
}

// "──하기로 하셨죠?" 리딩 문장 생성(MEM-2 표현)
function leadLine(mem) {
  if (!mem) return null;
  const when = mem.ts.slice(0, 10);
  const body = String(mem.text || '');
  const lead = (mem.subject && !body.includes(mem.subject)) ? `${mem.subject}님 ${body}` : body;
  return `${when}에 ${lead} — 그거 이어서 할까요?`;
}

module.exports = { saveMemory, recallMemory, recallRecent, deleteMemory, leadLine, MEM_TAB };
