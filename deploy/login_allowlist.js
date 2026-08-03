// ═══════════════════════════════════════════════════════════════════════════
// 🔐 login_allowlist.js — 허용계정 게이트 (등록된 계정만 로그인) · 2026-08-03
//
// 왜: 구글 OAuth를 프로덕션으로 전환하면 ★아무 구글 계정이나 로그인할 수 있다.
//     고객 명단(개인정보)을 다루는 서비스라 "등록된 사람만" 들어와야 한다.
//     (OAuth 테스트 사용자 목록은 프로덕션 전환 때 삭제됐고 복구도 안 된다 → 우리 게이트가 그 역할을 한다)
//
// ★독립 모듈이다. main_server는 이 파일을 ★부르기만 한다(기존 기능 무접촉·원칙7).
//
// ── 판정 순서 ──
//   ① ALLOWLIST_SHEET_ID 없음 → ★게이트 꺼짐(전원 통과)
//        배포 순서가 꼬여도 아무도 안 잠기게. 시트 ID를 넣는 순간 자동으로 켜진다.
//   ② VIP(대표님) → ★항상 통과. 어떤 고장에도 대표님은 잠기지 않는다.
//   ③ 명단에 있음 → 통과 / 없음 → 차단
//   ④ 시트를 못 읽음 → ★마지막으로 성공한 명단으로 판정(미등록자는 그대로 차단)
//   ⑤ 그 캐시마저 없음 → VIP만 통과(fail-closed)
//
// ── ★이메일을 "열 번호"로 찾지 않는 이유 (2026-08-03 실측) ──
//   지시는 "A열 이메일"이었는데 실제 시트는 A열=이름 · B열=이메일이었다.
//   A열만 읽었다면 이메일 0개 → ★교육생 전원 차단이 됐다.
//   (CLAUDE.md 6-9: "조건이 안 먹으면 0명이 아니라 전체가 된다" — 여기선 반대로 전원 차단이 된다)
//   → 열을 고정하지 않는다. ★모든 칸에서 이메일 모양을 찾는다.
//     대표님이 열 순서를 바꾸거나 칸을 추가해도 안 깨진다. 머리글("이름"·"이메일")은 이메일이 아니라 저절로 걸러진다.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const { google } = require('googleapis');

const TTL_MS = 60 * 1000;        // 명단 캐시 60초 — 대표님이 시트를 고치면 1분 안에 반영된다
const RETRY_MS = 10 * 1000;      // 읽기 실패했을 땐 10초 뒤 다시 시도(60초씩 기다리지 않게)
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

let _vipEmail = '';
let _cache = { at: 0, list: null, ok: false, err: '', sa: '', envName: '', title: '' };
let _lastGood = null;            // 마지막으로 성공한 명단 — 시트가 죽어도 이걸로 버틴다

function init(opts) { _vipEmail = String((opts && opts.vipEmail) || '').toLowerCase(); }
function sheetId() { return String(process.env.ALLOWLIST_SHEET_ID || '').trim(); }
function configured() { return !!sheetId(); }

// 서비스계정 키가 환경변수 이름 두 가지로 쓰인다(GOOGLE_SA_JSON / GOOGLE_SERVICE_ACCOUNT_JSON).
// ★둘 다 시도한다 — 2026-07-02에 "로컬 키와 Render 키가 다른 계정"이라 같은 곳에서 막혔다(6-11 ①).
function _saCandidates() {
  const out = [];
  for (const k of ['GOOGLE_SA_JSON', 'GOOGLE_SERVICE_ACCOUNT_JSON']) {
    const raw = process.env[k];
    if (!raw || raw === '{}') continue;
    try { const o = JSON.parse(raw); if (o.client_email) out.push({ envName: k, creds: o }); } catch (e) {}
  }
  return out;
}

async function _fetchList() {
  const id = sheetId();
  const cands = _saCandidates();
  if (!cands.length) throw new Error('서비스계정 키가 없습니다(GOOGLE_SA_JSON / GOOGLE_SERVICE_ACCOUNT_JSON)');
  let lastErr = null;
  for (const c of cands) {
    try {
      const auth = new google.auth.GoogleAuth({ credentials: c.creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
      const sheets = google.sheets({ version: 'v4', auth });
      const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'properties.title,sheets.properties.title' });
      const tab = (((meta.data.sheets || [])[0] || {}).properties || {}).title || '시트1';
      const g = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${tab}!A1:Z2000` });
      const set = new Set();
      (g.data.values || []).forEach((row) => (row || []).forEach((cell) => {
        const m = String(cell == null ? '' : cell).trim().toLowerCase().match(EMAIL_RE);
        if (m) set.add(m[0]);
      }));
      return { set, sa: c.creds.client_email, envName: c.envName, title: (meta.data.properties || {}).title || '' };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('알 수 없는 실패');
}

async function _ensure() {
  const now = Date.now();
  if (_cache.list && (now - _cache.at) <= TTL_MS) return;
  try {
    const r = await _fetchList();
    _cache = { at: now, list: r.set, ok: true, err: '', sa: r.sa, envName: r.envName, title: r.title };
    _lastGood = r.set;
  } catch (e) {
    // 실패해도 곧 다시 시도하도록 시각을 앞당겨 둔다
    _cache = { at: now - (TTL_MS - RETRY_MS), list: null, ok: false, err: e.message, sa: '', envName: '', title: '' };
  }
}

// 판정. { allowed, source, reason }
//   source = off | vip | sheet | cache | fail-closed | no-email
async function check(email) {
  const em = String(email || '').trim().toLowerCase();
  if (!configured()) return { allowed: true, source: 'off', reason: 'ALLOWLIST_SHEET_ID 미설정 — 게이트 꺼짐(전원 통과)' };
  if (em && _vipEmail && em === _vipEmail) return { allowed: true, source: 'vip', reason: '대표님 계정 — 항상 통과' };
  if (!em) return { allowed: false, source: 'no-email', reason: '로그인 계정을 확인하지 못했어요' };
  await _ensure();
  if (_cache.ok && _cache.list) {
    return _cache.list.has(em)
      ? { allowed: true, source: 'sheet' }
      : { allowed: false, source: 'sheet', reason: '허용 명단에 없는 계정입니다' };
  }
  if (_lastGood) {
    return _lastGood.has(em)
      ? { allowed: true, source: 'cache' }
      : { allowed: false, source: 'cache', reason: '허용 명단에 없는 계정입니다(직전 명단 기준)' };
  }
  return { allowed: false, source: 'fail-closed', reason: '허용 명단을 읽지 못했어요 — 잠시 뒤 다시 시도해 주세요' };
}

// 진단창구용 상태(개인정보 최소: 이메일 목록은 안 내보내고 ★인원수만).
async function diag() {
  const out = {
    게이트: configured() ? '켜짐' : '꺼짐(ALLOWLIST_SHEET_ID 미설정 → 전원 통과)',
    시트ID설정: configured(),
    VIP: _vipEmail ? '설정됨' : '(없음)',
    시도가능한_서비스계정: _saCandidates().map((c) => c.envName + ' → ' + c.creds.client_email),
  };
  if (!configured()) { out.진단 = '⚠️ 게이트가 꺼져 있습니다 — 아무 구글 계정이나 로그인됩니다'; return out; }
  await _ensure();
  out.시트읽기 = _cache.ok;
  out.문서제목 = _cache.title || '';
  out.읽은_서비스계정 = _cache.sa || '';
  out.허용인원 = _cache.ok && _cache.list ? _cache.list.size : (_lastGood ? _lastGood.size : 0);
  out.판정근거 = _cache.ok ? '시트(실시간)' : (_lastGood ? '★직전 명단 캐시(시트 오류 중)' : '★캐시 없음 — 대표님만 통과');
  if (_cache.err) out.오류 = _cache.err;
  out.진단 = _cache.ok
    ? (out.허용인원 > 0 ? `✅ 허용 명단 ${out.허용인원}명 실작동` : '⚠️ 시트는 읽혔는데 ★이메일이 0개입니다 — 전원 차단됩니다(시트 내용 확인 필요)')
    : (_lastGood ? '⚠️ 시트를 못 읽어 직전 명단으로 버티는 중' : '❌ 시트도 캐시도 없음 — 대표님 외 전원 차단 중');
  return out;
}

const _esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 차단 화면. ★어떤 계정으로 시도했는지 반드시 보여준다 —
//   2026-08-02 사고의 본질이 "내가 어떤 계정으로 들어와 있는지 알 수 없었다"였다.
function blockedHtml(email, reason) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>등록되지 않은 계정</title>
<body style="margin:0;background:#0B1F3A;color:#e8f0f8;font-family:Pretendard,'맑은 고딕',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;">
<div style="max-width:420px;text-align:center;">
  <div style="font-size:42px;line-height:1;margin-bottom:16px;">🚫</div>
  <h1 style="font-size:20px;margin:0 0 12px;font-weight:700;">등록되지 않은 계정입니다</h1>
  <div style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:13px;margin:0 0 16px;">
    <div style="font-size:11.5px;color:#8fa9c4;margin-bottom:5px;">시도하신 계정</div>
    <div style="font-size:14px;font-weight:600;word-break:break-all;">${_esc(email) || '(확인 안 됨)'}</div>
  </div>
  <p style="font-size:13px;line-height:1.75;color:#a9c2db;margin:0 0 22px;">
    부트캠프에 <b style="color:#dbe7f5;">신청하신 계정</b>으로 로그인해 주세요.<br>
    ${_esc(reason || '')}
  </p>
  <a href="/switch" style="display:block;padding:13px;border-radius:12px;background:#1F7A8C;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">다른 계정으로 로그인</a>
  <p style="margin-top:18px;font-size:12px;color:#7e9bb8;line-height:1.7;">
    등록이 필요하시면 오상열 대표에게 문의해 주세요.<br>
    <a href="mailto:ggorilla11@gmail.com" style="color:#8fa9c4;">ggorilla11@gmail.com</a>
  </p>
</div></body>`;
}

module.exports = { init, configured, check, diag, blockedHtml, _internals: { sheetId } };
