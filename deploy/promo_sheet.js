// ═══════════════════════════════════════════════════════════════════
// promo_sheet.js · 홍보마케팅비서 · 전용 구글시트 읽기·쓰기 (Day 1-2)
//
//   무엇을·왜: 캠페인·한줄카피·원고를 시트에 둔다. 시트가 진실의 출처다.
//              회장님이 시트에서 고치면 화면에 그대로 반영된다.
//
//   ★제니야(jenya) 시트·서버 무접촉(회장님 지시). 지니야 전용 시트만 쓴다.
//   ★서버 저장 0. 읽어서 화면으로 보내고, 결과는 시트에 쓰고 끝.
//   ★개인정보 없음 — 캠페인·카피·원고뿐. 고객 이름·연락처 칸은 아예 만들지 않는다.
//   ★시트 생성은 서비스계정 권한(drive.readonly)으로 불가.
//     회장님이 만들고 서비스계정에 편집자 공유 → PROMO_SHEET_ID 등록.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { google } = require('googleapis');
const { getServiceAuth } = require('./service_auth');

const SHEET_ID = () => process.env.PROMO_SHEET_ID || '';

// 탭 이름과 머리글 — 스펙 B-4 그대로
const TABS = {
  캠페인:   ['캠페인키', '서비스', '내용', '코드', '진단URL', '랜딩URL', '톤앤매너', '내용_사실자료', '상태', '생성일시'],
  한줄카피: ['캠페인키', '번호', '카피', '상태', '등록일시'],
  원고:     ['캠페인키', '카피번호', '원고종류', '라벨', '본문', '글자수', '달성률', '보정', '금지표현', '모델', '생성일시'],
};

function _now() {  // KST 분 단위
  return new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
}

async function _sheets() {
  if (!SHEET_ID()) {
    throw new Error('PROMO_SHEET_ID가 없어요 — 회장님이 만드신 시트 ID를 Render 환경변수에 넣어 주세요');
  }
  const auth = await getServiceAuth();
  return google.sheets({ version: 'v4', auth });
}

// 탭이 없으면 만들고 머리글을 넣는다(있으면 아무것도 안 함)
async function ensureTab(sheets, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID() });
  const has = (meta.data.sheets || []).some((s) => s.properties.title === title);
  if (has) return false;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID(),
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID(),
    range: `${title}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [TABS[title]] },
  });
  return true;   // 새로 만들었음
}

// 탭 하나를 머리글 기준 객체 배열로 읽는다
async function readTab(title) {
  const sheets = await _sheets();
  await ensureTab(sheets, title);
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(), range: `${title}!A1:Z10000`,
  });
  const rows = r.data.values || [];
  if (rows.length < 2) return [];
  const head = rows[0];
  return rows.slice(1).map((row, i) => {
    const o = { _행: i + 2 };
    head.forEach((h, j) => { o[h] = (row[j] != null ? String(row[j]) : ''); });
    return o;
  });
}

// ── 캠페인 ──────────────────────────────────────────────────────────
async function readCampaigns() {
  const rows = await readTab('캠페인');
  return rows
    .filter((r) => r['캠페인키'])
    .map((r) => ({
      campaignKey: r['캠페인키'],
      service: r['서비스'] || '',
      content: r['내용'] || '',
      code: r['코드'] || '',
      landing: r['진단URL'] || '',
      landingFinal: r['랜딩URL'] || '',
      tone: r['톤앤매너'] || '',
      facts: r['내용_사실자료'] || '',      // ★환각 차단용(B-1)
      status: r['상태'] || '',
      _행: r._행,
    }));
}

async function findCampaign(key) {
  const list = await readCampaigns();
  const hit = list.find((c) => c.campaignKey === key);
  if (!hit) throw new Error(`캠페인을 못 찾았어요: ${key} — 시트 「캠페인」 탭을 확인해 주세요`);
  return hit;
}

// ── 한줄카피 ────────────────────────────────────────────────────────
async function readCopies(campaignKey) {
  const rows = await readTab('한줄카피');
  return rows
    .filter((r) => r['캠페인키'] === campaignKey && r['카피'])
    .map((r) => ({ no: Number(r['번호']) || 0, copy: r['카피'], status: r['상태'] || '', _행: r._행 }))
    .sort((a, b) => a.no - b.no);
}

async function appendCopies(campaignKey, copies) {
  const sheets = await _sheets();
  await ensureTab(sheets, '한줄카피');
  const now = _now();
  const values = copies.map((c, i) => [campaignKey, String(c.no != null ? c.no : i + 1), c.copy, '대기', now]);
  if (!values.length) return 0;
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(), range: '한줄카피!A1',
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  return values.length;
}

// ── 원고 ────────────────────────────────────────────────────────────
/**
 * 생성 결과 12종을 「원고」 탭에 붙인다.
 * @param {string} campaignKey
 * @param {number} copyNo
 * @param {Array}  results  promo_skill.generateAll() 의 results
 * @param {string} model
 */
async function appendScripts(campaignKey, copyNo, results, model) {
  const sheets = await _sheets();
  await ensureTab(sheets, '원고');
  const now = _now();
  const values = results.map((r) => [
    campaignKey, String(copyNo), r.kind, r.label,
    r.text || '', String(r.chars || 0), String(r.rate || 0) + '%',
    r.fixed || '—', r.banned || '', model || '', now,
  ]);
  if (!values.length) return 0;
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(), range: '원고!A1',
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  return values.length;
}

async function readScripts(campaignKey, copyNo) {
  const rows = await readTab('원고');
  return rows.filter((r) => r['캠페인키'] === campaignKey
    && (copyNo == null || String(r['카피번호']) === String(copyNo)));
}

// ── 진단 창구 (★실제와 같은 함수를 탄다 · CLAUDE.md 6-7) ────────────
async function diag() {
  const out = { 시트ID설정: !!SHEET_ID(), 탭: {}, 오류: null };
  try {
    const sheets = await _sheets();
    for (const t of Object.keys(TABS)) {
      const made = await ensureTab(sheets, t);
      const rows = await readTab(t);
      out.탭[t] = { 새로만듦: made, 줄수: rows.length };
    }
  } catch (e) { out.오류 = e.message; }
  return out;
}

module.exports = {
  TABS, readTab, ensureTab,
  readCampaigns, findCampaign,
  readCopies, appendCopies,
  appendScripts, readScripts,
  diag,
};
