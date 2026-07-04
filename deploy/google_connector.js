// ─────────────────────────────────────────────────────────────
// google_connector.js — 🔌커넥터창고: 구글(캘린더·시트·드라이브) 커넥터 (독립 모듈)
// 무엇을·왜: 회원 구글에서 오늘 일정·명단·증권을 "읽어" 반환. ★원칙1: 서버 저장 0(읽고 버림).
// 사용: const g = require('.../google_connector');
//        await g.calendarToday(); await g.rosterFilter(); await g.driveSearch('김철수 증권');
// ★공통 자산(도구). 지금은 SA 공유 데모 / 제품은 회원 OAuth(googleAuth만 교체). /parksugeun 무접촉.
// ─────────────────────────────────────────────────────────────
'use strict';
const { google } = require('googleapis');
const { PDFParse } = require('pdf-parse');
const KEY_FILE = process.env.GOOGLE_SA_JSON || '{}';
const DEMO_TITLE = '지니야빌더_데모_명단';
const SHEET_TAB = '고객명단';
const CAL_ID = process.env.CAL_ID || 'ggorilla11@gmail.com';

// ★원칙3 전환: auth(회원 OAuth 클라이언트)를 주면 회원 토큰으로, 없으면 SA 폴백(데모).
//   = "googleAuth만 교체"가 이 한 줄. 로그인하면 회원 본인 데이터, 아니면 SA 데모.
function googleAuth(scopes) { return new google.auth.GoogleAuth({ credentials: JSON.parse(KEY_FILE), scopes }); }
function useAuth(auth, scopes) { return auth || googleAuth(scopes); }

async function readRoster(memberAuth) {
  const auth = useAuth(memberAuth, ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly']);
  const drive = google.drive({ version: 'v3', auth }), sheets = google.sheets({ version: 'v4', auth });
  const f = await drive.files.list({ q: `mimeType='application/vnd.google-apps.spreadsheet' and name='${DEMO_TITLE}' and trashed=false`, fields: 'files(id)' });
  const id = (f.data.files || [])[0] && f.data.files[0].id; if (!id) return [];
  const got = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${SHEET_TAB}!A1:T50` });
  const [H, ...body] = got.data.values || [[]];
  return body.filter((r) => r && r.length).map((r) => { const o = {}; H.forEach((h, i) => o[h] = r[i] || ''); return o; });
}
function prepFor(c) {
  if (!c) return [];
  const n = [];
  if (c['가입상품'] === '자동차보험' && String(c['만기일']).startsWith('2026-07')) n.push(`7월 자동차 만기(${c['만기일']}) → 보험사 비교표 준비`);
  if (String(c['비고']).includes('자산가')) n.push(`자산가 → ${String(c['비고']).replace('자산가, ', '')} 준비`);
  if (!n.length && c['비고']) n.push(c['비고']);
  return n;
}

/** 🔌 구글 캘린더: 오늘 일정 + 명단 자동 연결(준비물). 읽기·저장0. (memberAuth=회원토큰/없으면 SA) */
async function calendarToday(memberAuth) {
  const roster = await readRoster(memberAuth); const byName = {}; roster.forEach((c) => byName[c['고객명']] = c);
  const auth = useAuth(memberAuth, ['https://www.googleapis.com/auth/calendar.readonly']);
  const cal = google.calendar({ version: 'v3', auth });
  const now = new Date(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  // 회원 토큰이면 본인 기본 캘린더('primary'), SA면 공유 데모 캘린더(CAL_ID)
  const calId = memberAuth ? 'primary' : CAL_ID;
  const ev = await cal.events.list({ calendarId: calId, timeMin: new Date(y, m, d, 0, 0, 0).toISOString(), timeMax: new Date(y, m, d, 23, 59, 59).toISOString(), singleEvents: true, orderBy: 'startTime' });
  return (ev.data.items || []).map((e) => {
    const s = (e.start || {}).dateTime || (e.start || {}).date || '';
    const name = Object.keys(byName).find((n) => (e.summary || '').includes(n));
    return { time: s.length >= 16 ? s.slice(11, 16) : '종일', title: e.summary || '', prep: prepFor(byName[name]) };
  });
}
/** 🔌 구글 시트: 명단 필터(7월만기·임박순·자산가). 읽기·저장0. (memberAuth=회원토큰) */
async function rosterFilter(memberAuth) {
  const r = await readRoster(memberAuth);
  const july = r.filter((o) => o['가입상품'] === '자동차보험' && String(o['만기일']).startsWith('2026-07'));
  return {
    total: r.length,
    july만기: july.map((o) => ({ 고객명: o['고객명'], 만기일: o['만기일'], 보험사: o['보험사'] })),
    임박순: [...july].sort((a, b) => String(a['만기일']).localeCompare(b['만기일'])).map((o) => o['고객명'] + '(' + o['만기일'] + ')'),
    자산가: r.filter((o) => String(o['비고']).includes('자산가') || Number(o['연소득(만원)']) >= 15000).map((o) => o['고객명'] + '(' + o['직업'] + ')'),
  };
}
/** 🔌 구글 드라이브: 증권 검색 / 열어서 보장 읽기(메모리, 저장0). (memberAuth=회원토큰) */
async function driveSearch(q, memberAuth) {
  const auth = useAuth(memberAuth, ['https://www.googleapis.com/auth/drive.readonly']);
  const drive = google.drive({ version: 'v3', auth });
  const terms = String(q || '증권').split(/\s+/).filter(Boolean);
  const qstr = terms.map((t) => `name contains '${t.replace(/'/g, '')}'`).join(' and ') + ' and trashed=false';
  const r = await drive.files.list({ q: qstr, fields: 'files(id,name,webViewLink)' });
  return (r.data.files || []).map((f) => ({ id: f.id, name: f.name, link: f.webViewLink }));
}
async function drivePolicyRead(fileId, memberAuth) {
  const auth = useAuth(memberAuth, ['https://www.googleapis.com/auth/drive.readonly']);
  const drive = google.drive({ version: 'v3', auth });
  const meta = await drive.files.get({ fileId, fields: 'name' });
  const dl = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  const parser = new PDFParse({ data: Buffer.from(dl.data) });
  const r = await parser.getText(); await parser.destroy();
  const flat = (Array.isArray(r.pages) ? r.pages.map((p) => p.text !== undefined ? p.text : p).join(' ') : r.text || '').replace(/\s+/g, ' ');
  const covers = [];
  ['대물', '자기신체사고', '대인배상', '무보험', '긴급출동', '자기차량'].forEach((k) => { const i = flat.indexOf(k); if (i >= 0) covers.push(`${k}: ${flat.slice(i, i + 30).trim()}`); });
  return { name: meta.data.name, covers, note: '메모리에서 읽고 버림 — 서버 저장 0' };
}

module.exports = { calendarToday, rosterFilter, driveSearch, drivePolicyRead };
