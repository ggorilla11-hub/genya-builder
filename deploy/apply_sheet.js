// ═══════════════════════════════════════════════════════════════════
// apply_sheet.js · Phase 1-A 신청 캡처 — 공개 폼이 보낸 신청을 「신청수집」 시트에 받아 적는다
//
//   무엇을·왜: 지금까지 지니야빌더는 신청을 ★읽어 집계만 했다. 받아 적는 곳이 없어
//              "이 신청이 누구(회원)의 것인지" 가릴 수 없었다. 그 입구를 만든다.
//
//   ★독립 모듈이다. main_server.js 는 require + init + app.use 몇 줄만 바뀐다(CLAUDE.md 6-2 ⑦).
//   ★회원 격리 명단(sheets_crud·회원 OAuth·drive.file)은 한 글자도 안 건드린다.
//     이 파일은 ★서비스계정(SA)으로 ★신청수집 시트 한 개만 다룬다.
//   ★서버 저장 0(제로 인그레스 · 6-2 ④): 받아서 시트에 쓰고 즉시 버린다.
//     로그에도 이름·번호를 찍지 않는다(마스킹만).
//   ★발송 코드 없음. 이 파일은 받아 적기만 한다.
//
//   ★시트 생성은 SA 권한(drive.readonly)으로 불가하다 — service_auth.js 실측.
//     대표님이 시트를 만들고 SA 이메일에 ★편집자로 공유 → APPLY_SHEET_ID 등록.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');
const express = require('express');
const { google } = require('googleapis');
const { getServiceAuth } = require('./service_auth');

const SHEET_ID = () => process.env.APPLY_SHEET_ID || '';
const TAB = '신청수집';

// 컬럼 9개 — 2026-08-02 대표님 확정(8개 → 9개, 광고 수신동의 추가)
const HEAD = ['발행번호', 'rep_id', '이름', '연락처', '관심', 'utm_source', 'utm_campaign', '시각', '광고수신동의'];

// ★관심은 이 셋만 받는다(허용목록).
//   CLAUDE.md 6-9: 조건을 못 알아들으면 ★넓히지 말고 멈춘다. 넓히면 "전부"가 되어 사고가 난다.
const WANTS = ['강의', '상담', '진단'];

// rep 없이 들어온 신청 — 2026-08-02 대표님 확정: 거부도 대표 귀속도 아닌 ★미분류로 담아둔다
const UNASSIGNED = 'unassigned';

// ═══ [1] 회원 코드(rep_id) ══════════════════════════════════════════
//   왜 해시인가: ①이메일이 공개 주소에 노출되면 안 된다(개인정보)
//               ②따로 저장할 표가 없어야 재배포해도 안 날아간다(항상 같은 값이 나온다)
//   ★되돌릴 수 없다 — 코드에서 이메일을 복원할 수 없다(단방향).
function repCodeOf(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return '';
  return 'r' + crypto.createHash('sha256').update(e).digest('hex').slice(0, 5);
}

// ═══ [2] 연락처 정규화 ══════════════════════════════════════════════
//   ★campaign_skill.js:34 와 ★같은 규칙이다(엑셀이 날린 앞 0·국가번호·하이픈).
//   그 파일은 22블록이라 손대지 않으므로 여기 같은 규칙을 둔다.
//   ※규칙이 갈리면 한쪽만 낡는다(6-10 ②) — 고칠 때는 두 곳을 같이 본다.
function normPhone(p) {
  let s = String(p == null ? '' : p).trim();
  s = s.replace(/^['"`\s]+/, '');
  s = s.replace(/[^\d+]/g, '');
  if (/^\+?82/.test(s)) s = '0' + s.replace(/^\+?82/, '');
  s = s.replace(/\D/g, '');
  if (s.length === 10 && /^1[016789]/.test(s)) s = '0' + s;
  return s;
}
const isPhone = (s) => /^01[016789]\d{7,8}$/.test(String(s || ''));
const mask = (p) => { const s = String(p || '').replace(/[^0-9]/g, ''); return s.length < 7 ? '***' : s.slice(0, 3) + '****' + s.slice(-4); };

function kstNow() {   // 시트에 쌓는 형식 — 한국시간 분 단위
  return new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16);
}

// ═══ [3] 들어온 신청 검사 — 통과 못 하면 ★막는다(넓히지 않는다) ════
/**
 * @returns {{ok:true, row:object} | {ok:false, error:string}}
 */
function validate(body) {
  const b = body || {};
  const name = String(b.name || '').trim().slice(0, 40);
  const phone = normPhone(b.phone);
  const want = String(b.want || '').trim();
  const rep = String(b.rep || '').trim().slice(0, 24).replace(/[^A-Za-z0-9_-]/g, '');
  const src = String(b.utm_source || '').trim().slice(0, 40);
  const cmp = String(b.utm_campaign || '').trim().slice(0, 60);

  if (!name) return { ok: false, error: '이름을 넣어 주세요.' };
  if (!isPhone(phone)) return { ok: false, error: '연락처를 다시 확인해 주세요 (010으로 시작하는 휴대폰 번호).' };
  if (WANTS.indexOf(want) < 0) return { ok: false, error: '관심을 강의·상담·진단 중에서 골라 주세요.' };
  if (b.agree !== true) return { ok: false, error: '개인정보 수집·이용 동의(필수)에 체크해 주세요.' };

  const at = kstNow();
  // 광고 수신동의 — Y면 ★동의일시를 같이 남긴다(정보통신망법 제50조 근거 자료)
  const adYes = b.ad === true;
  return {
    ok: true,
    row: {
      발행번호: '',                       // ★2026-08-02 대표님 확정: 지금은 안 쓴다. 캠페인 구분은 utm_campaign.
      rep_id: rep || UNASSIGNED,          // ★rep 없으면 미분류 — 남의 것으로 잘못 귀속시키지 않는다
      이름: name,
      연락처: phone,
      관심: want,
      utm_source: src,
      utm_campaign: cmp,
      시각: at,
      광고수신동의: adYes ? `Y (${at})` : 'N',
    },
  };
}

// ═══ [4] 시트 읽기·쓰기 ═════════════════════════════════════════════
async function _sheets() {
  if (!SHEET_ID()) {
    throw new Error('APPLY_SHEET_ID가 없어요 — 대표님이 만드신 「신청수집」 시트 ID를 Render 환경변수에 넣어 주세요');
  }
  const auth = await getServiceAuth();
  return google.sheets({ version: 'v4', auth });
}

// 탭이 없으면 만들고 머리글을 넣는다(있으면 아무것도 안 함)
async function ensureTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID() });
  const has = (meta.data.sheets || []).some((s) => s.properties.title === TAB);
  if (has) return false;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID(),
    requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID(), range: `${TAB}!A1`,
    valueInputOption: 'RAW', requestBody: { values: [HEAD] },
  });
  return true;
}

async function appendApply(row) {
  const sheets = await _sheets();
  await ensureTab(sheets);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(), range: `${TAB}!A1`,
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [HEAD.map((h) => String(row[h] == null ? '' : row[h]))] },
  });
  return true;
}

// ═══ [5] 같은 사람이 두 번 눌렀을 때 ════════════════════════════════
//   ★서버에 저장하는 게 아니다 — 번호를 ★지문(sha256 앞 12자)으로만 잠깐 들고 있다가 버린다.
//   10분 안에 같은 rep+번호면 시트에 두 줄 쓰지 않는다(대표님이 같은 사람에게 두 번 연락하지 않게).
const _recent = new Map();               // 지문 → 시각(ms)
const DUP_MS = 10 * 60e3;
function _fingerprint(rep, phone) {
  return crypto.createHash('sha256').update(rep + '|' + phone).digest('hex').slice(0, 12);
}
function isDuplicate(rep, phone) {
  const k = _fingerprint(rep, phone);
  const now = Date.now();
  for (const [key, t] of _recent) if (now - t > DUP_MS) _recent.delete(key);   // 오래된 건 버린다
  if (_recent.has(k)) return true;
  _recent.set(k, now);
  return false;
}

// ═══ [6] 공개 라우트라서 — 폭주 막기 ════════════════════════════════
//   ★로그인 게이트가 없는 ★쓰기 라우트는 이 서버에서 처음이다. 봇이 두드릴 수 있다.
//   한 주소에서 1분에 5번, 1시간에 30번까지만 받는다. 서버 메모리라 재배포하면 초기화된다(스팸 방지용이라 무방).
const _hits = new Map();                 // ip → [시각ms, ...]
function rateLimited(ip) {
  const now = Date.now();
  const arr = (_hits.get(ip) || []).filter((t) => now - t < 3600e3);
  arr.push(now);
  _hits.set(ip, arr);
  if (_hits.size > 5000) _hits.clear();  // 메모리 폭주 방지
  const 분 = arr.filter((t) => now - t < 60e3).length;
  return 분 > 5 || arr.length > 30;
}

// ═══ [7] 라우터 ═════════════════════════════════════════════════════
const router = express.Router();
let _sessionOf = null;                   // main_server 의 sessionOf 를 주입받는다(직접 require 안 함)

function init(opts) {
  if (opts && opts.sessionOf) _sessionOf = opts.sessionOf;
}

// ★① 공개 신청 접수 — 로그인 없음(방문자용). 이 서버에서 유일한 공개 쓰기 라우트.
router.post('/submit', async (req, res) => {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  if (rateLimited(ip)) {
    return res.status(429).json({ ok: false, error: '잠시 뒤에 다시 시도해 주세요.' });
  }
  const v = validate(req.body);
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

  if (isDuplicate(v.row.rep_id, v.row.연락처)) {
    // 사용자에겐 정상으로 보이되, 시트에 두 줄 쓰지 않는다. ★거짓말은 안 한다(중복=true로 알려준다)
    console.log(`[📥신청] 중복 무시 · rep=${v.row.rep_id} · ${mask(v.row.연락처)}`);
    return res.json({ ok: true, 중복: true, 안내: '이미 접수됐어요. 곧 연락드릴게요.' });
  }

  try {
    await appendApply(v.row);
    // ★로그에 이름·번호 원문 금지 — 마스킹만(제로 인그레스)
    console.log(`[📥신청] 1건 저장 · rep=${v.row.rep_id} · 관심=${v.row.관심} · ${mask(v.row.연락처)} · src=${v.row.utm_source || '-'}`);
    res.json({ ok: true, 중복: false, 안내: '접수됐습니다. 담당자가 곧 연락드립니다.' });
  } catch (e) {
    // ★실패를 성공으로 둔갑시키지 않는다(6-7). 방문자에겐 쉬운 말, 서버 로그엔 진짜 이유.
    console.error('[📥신청] 저장 실패 — ' + (e && e.message));
    res.status(500).json({ ok: false, error: '접수가 저장되지 않았어요. 잠시 뒤 다시 시도해 주세요.' });
  }
});

// ★② 회원이 자기 신청 링크를 받아 가는 곳 — 로그인 필요
router.get('/my-link', (req, res) => {
  const s = typeof _sessionOf === 'function' ? _sessionOf(req) : null;
  if (!s) return res.status(401).json({ ok: false, error: '로그인이 필요해요' });
  const rep = repCodeOf(s.email);
  res.json({ ok: true, rep, 안내: '이 코드가 붙은 주소로 들어온 신청만 내 신청으로 잡혀요.' });
});

// ★③ 진단 창구 — ★실제와 같은 함수를 탄다(6-7). 개인정보·이름·번호 0노출(줄 수만).
router.get('/diag', async (req, res) => {
  const out = { 시트ID설정: !!SHEET_ID(), 탭: TAB, 컬럼수: HEAD.length, 줄수: null, 미분류: null, 오류: null };
  try {
    const sheets = await _sheets();
    const made = await ensureTab(sheets);
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID(), range: `${TAB}!A1:I10000` });
    const rows = r.data.values || [];
    out.새로만듦 = made;
    out.줄수 = Math.max(0, rows.length - 1);
    out.미분류 = rows.slice(1).filter((x) => String(x[1] || '') === UNASSIGNED).length;
  } catch (e) { out.오류 = e.message; }
  res.json({ ok: !out.오류, ...out });
});

// ═══ [8] 유입전환이 이 시트를 함께 읽게 — 목록에 한 줄 얹는다 ═══════
//   ★기존 목록은 그대로 두고 ★뒤에 붙이기만 한다(회원이 붙인 시트는 손대지 않는다).
function withApplySheet(list) {
  const id = SHEET_ID();
  if (!id) return list;
  if ((list || []).some((x) => x.id === id)) return list;
  return (list || []).concat([{ id, tab: '*', title: '신청수집' }]);
}

module.exports = {
  init, router,
  repCodeOf, normPhone, isPhone, validate, withApplySheet,
  isDuplicate, rateLimited, appendApply,
  HEAD, TAB, WANTS, UNASSIGNED,
};
