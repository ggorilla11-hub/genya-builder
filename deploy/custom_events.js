// ─────────────────────────────────────────────────────────────
// custom_events.js — ⭐ 대표가 직접 정의하는 이벤트 (독립 모듈)
//
// 무엇을·왜: 업종마다 챙기는 게 다르다(학원=등록기념일, 설계사=만기).
//   기본 6개 이벤트는 코드에 박혀 있어 개발자 없이는 못 늘렸다.
//   이 모듈은 "이벤트 이름"만 받아 → 유사어로 명단 컬럼을 찾고 → 대상자를 뽑고 → 문구를 만든다.
//
// ★설계 원칙
//   ①하이브리드 문구: LLM은 "저장할 때 딱 한 번"만 부른다. 문구 틀을 시트에 저장해 두고
//     대시보드는 틀에 이름·날짜만 끼운다 → 화면 즉시 표시 + 열 때마다 같은 문구(일관).
//     LLM이 실패해도 규칙 기반 폴백으로 반드시 저장된다(대표가 막히지 않게).
//   ②컬럼명 하드코딩 금지: client_mgmt_skill의 norm/mapFields/parseYMD를 그대로 재사용한다.
//     여기서 새로 만들면 감지 규칙이 둘로 갈라진다.
//   ③제로 인그레스: 정의는 회원 본인 구글시트('지니야_이벤트' 탭)에만 저장. 서버 저장 0.
//     회원마다 자기 시트라 "회원별 분리"는 구조적으로 자동 보장된다.
//   ④범위를 숫자로 적지 않는다: 시트 읽기 범위는 탭 이름만 준다(=전체).
//     A1:Z 같은 표기가 컬럼·행을 잘라 유령 데이터를 만든 사고가 반복됐다.
//   ⑤기본 6개 이벤트·발송 로직 무접촉. 이 모듈은 metrics 배열 뒤에 "이어붙이기"만 한다.
//
// 사용: const ce = require('./custom_events');
//        ce.init({ crud, mgmt, anthropic, model, ensureTab });
//        ce.list(ma) / ce.add(ma, name) / ce.setTemplate(ma, name, tpl) / ce.remove(ma, name)
//        ce.buildMetrics({ headers, rows, events, today })
// ─────────────────────────────────────────────────────────────
'use strict';

const TAB = '지니야_이벤트';
const HEADER = ['이벤트명', '유사어', '반복', '성격', '아이콘', '문구틀', '생성일'];
const MAX_EVENTS = 12;      // 대시보드 타일이 감당할 수 있는 현실적인 상한
const MAX_NAME = 20;

let _crud = null;           // sheets_crud_skill (loadTable → {id, sheets(서비스계정), header, rows})
let _mgmt = null;           // client_mgmt_skill (norm/mapFields/parseYMD …)
let _anthropic = null;
let _model = '';
let _ensureTab = null;      // (sheets, id, title) => void

function init(opts) {
  opts = opts || {};
  if (opts.crud) _crud = opts.crud;
  if (opts.mgmt) _mgmt = opts.mgmt;
  if (opts.anthropic) _anthropic = opts.anthropic;
  if (opts.model) _model = opts.model;
  if (opts.ensureTab) _ensureTab = opts.ensureTab;
}

// ── 규칙 기반 정의(폴백) — LLM이 없거나 실패해도 반드시 동작한다 ──
const _RE_축하 = /기념|생일|축하|주년|돌잔치|입학|졸업|승진|개업|명절/;
const _RE_안내 = /만기|만료|갱신|종료|마감|납입|납기|연장|재계약|검진|점검/;
function _ruleDefine(name) {
  const 성격 = _RE_축하.test(name) ? '축하' : (_RE_안내.test(name) ? '안내' : '관리');
  const 반복 = (성격 === '축하' || /기념일|생일/.test(name)) ? '매년' : '단발';
  // 유사어: 이름 그대로 + 흔한 꼬리말 제거형(결혼기념일 → 결혼기념, 결혼)
  const 유사어 = [name];
  const 짧게 = name.replace(/(일자|날짜|일|날)$/, '');
  if (짧게 && 짧게 !== name) 유사어.push(짧게);
  const 더짧게 = 짧게.replace(/(기념)$/, '');
  if (더짧게 && 유사어.indexOf(더짧게) < 0 && 더짧게.length >= 2) 유사어.push(더짧게);
  const 문구틀 = 성격 === '축하'
    ? `{이름}님, ${name} 진심으로 축하드립니다! 늘 건강하고 좋은 일 가득하시길 바랍니다. 편하실 때 안부 인사도 드릴게요.`
    : (성격 === '안내'
      ? `{이름}님, ${name}({날짜})이 {디데이} 다가와 미리 안내드려요. 필요하신 부분 도와드릴까요? 편하실 때 알려주세요.`
      : `{이름}님, ${name}({날짜}) 관련해 안부 겸 연락드려요. 궁금한 점 있으시면 언제든 편하게 말씀해 주세요.`);
  const 아이콘 = 성격 === '축하' ? '💝' : (성격 === '안내' ? '🟠' : '⭐');
  return { 이벤트명: name, 유사어, 반복, 성격, 아이콘, 문구틀 };
}

// ── LLM 1회 호출: 유사어·성격·문구 틀 생성. 실패하면 조용히 규칙 폴백 ──
function _prompt(name) {
  return `보험설계사·학원원장 같은 자영업자용 고객관리 프로그램을 만들고 있어.
사용자가 챙기고 싶은 이벤트 이름으로 "${name}"을(를) 입력했다.

이 이벤트를 처리하기 위해 아래 JSON만 출력해. 설명·인사말·코드블록 금지, JSON 하나만.

{
  "유사어": ["엑셀 명단에서 이 이벤트 날짜가 들어있을 법한 컬럼 이름 후보 3~6개. 한글 위주, 영어 1~2개. 예: 결혼기념일 → 결혼기념일, 결혼기념, 결혼일, wedding, anniversary"],
  "반복": "매년 또는 단발. 매년=생일·기념일처럼 해마다 돌아옴. 단발=만기·만료처럼 한 번 지나면 끝",
  "성격": "축하 또는 안내 또는 관리",
  "아이콘": "이모지 1개",
  "문구틀": "고객에게 보낼 한국어 문자 한 통. 2~3문장."
}

문구틀 규칙(중요):
- 반드시 {이름} 을 포함해 시작. 날짜를 쓰려면 {날짜}, 남은 기간은 {디데이} 를 그대로 써라(나중에 실제 값으로 바뀐다).
- 존댓말, 따뜻하지만 과장 없이. 이모지·느낌표 남발 금지.
- 축하 성격이면 축하 인사, 안내 성격이면 미리 알려주는 안내 톤.
- 영업 압박·할인 유도 표현 금지. 마지막은 부담 없이 답하기 쉽게.
- AI·챗봇·클로드 같은 단어 절대 금지. 담당자가 직접 보내는 문자처럼.`;
}

async function _define(name) {
  const fb = _ruleDefine(name);
  if (!_anthropic || !_model) return fb;
  try {
    const r = await _anthropic.messages.create({
      model: _model, max_tokens: 700,
      messages: [{ role: 'user', content: _prompt(name) }],
    });
    const txt = (r.content || []).map((c) => c.text || '').join('');
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return fb;
    const j = JSON.parse(m[0]);
    const 유사어 = Array.isArray(j.유사어) ? j.유사어.map((s) => String(s || '').trim()).filter(Boolean) : [];
    // 이벤트 이름 자체는 항상 유사어에 포함(LLM이 빠뜨려도 컬럼을 찾게)
    if (유사어.indexOf(name) < 0) 유사어.unshift(name);
    const 문구틀 = String(j.문구틀 || '').trim();
    return {
      이벤트명: name,
      유사어: 유사어.length ? 유사어.slice(0, 8) : fb.유사어,
      반복: (String(j.반복 || '').indexOf('매년') >= 0) ? '매년' : (String(j.반복 || '').indexOf('단발') >= 0 ? '단발' : fb.반복),
      성격: ['축하', '안내', '관리'].indexOf(String(j.성격 || '').trim()) >= 0 ? String(j.성격).trim() : fb.성격,
      아이콘: String(j.아이콘 || '').trim().slice(0, 4) || fb.아이콘,
      // 문구틀에 {이름}이 없으면 개인화가 깨지므로 폴백
      문구틀: (문구틀 && 문구틀.indexOf('{이름}') >= 0) ? 문구틀 : fb.문구틀,
    };
  } catch (e) { return fb; }
}

// ── 시트 I/O (서비스계정) ──
//   ★범위는 탭 이름만 = 그 탭 전체. 숫자 범위로 좁히지 말 것.
async function _open(ma) {
  const t = await _crud.loadTable(ma);
  return { id: t.id, sheets: t.sheets };
}
async function _readRaw(t) {
  try {
    const g = await t.sheets.spreadsheets.values.get({ spreadsheetId: t.id, range: TAB });
    return g.data.values || [];
  } catch (e) { return []; } // 탭이 아직 없음 = 이벤트 0개
}
function _toObj(values) {
  const H = values[0] || [];
  return values.slice(1)
    .filter((r) => r && String(r[0] || '').trim())
    .map((r, i) => {
      const o = { _row: i + 2 }; // 시트 행번호(헤더=1)
      H.forEach((h, j) => { o[h] = r[j] || ''; });
      o.유사어 = String(o.유사어 || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!o.유사어.length) o.유사어 = [o.이벤트명];
      return o;
    });
}

/** 회원이 정의한 이벤트 목록. 없으면 빈 배열(에러 아님). */
async function list(ma) {
  const t = await _open(ma);
  if (!t.id) return [];
  return _toObj(await _readRaw(t));
}

/** 이벤트 추가 — LLM 1회로 유사어·성격·문구틀 생성 후 시트에 저장 */
async function add(ma, rawName) {
  const name = String(rawName || '').trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: '이벤트 이름을 입력해 주세요.' };
  if (name.length > MAX_NAME) return { ok: false, error: `이벤트 이름은 ${MAX_NAME}자 이내로 해주세요.` };
  const t = await _open(ma);
  if (!t.id) return { ok: false, error: '명단 시트를 찾지 못했어요. [명단·연결]에서 명단을 먼저 올려주세요.' };
  const cur = _toObj(await _readRaw(t));
  if (cur.some((e) => String(e.이벤트명).trim() === name)) return { ok: false, error: `'${name}' 이벤트는 이미 있어요.` };
  if (cur.length >= MAX_EVENTS) return { ok: false, error: `이벤트는 ${MAX_EVENTS}개까지 만들 수 있어요. 안 쓰는 것을 지우고 다시 시도해 주세요.` };
  const def = await _define(name);
  if (_ensureTab) await _ensureTab(t.sheets, t.id, TAB);
  const raw = await _readRaw(t);
  if (!raw.length) { // 헤더가 없으면 먼저 만든다
    await t.sheets.spreadsheets.values.update({ spreadsheetId: t.id, range: `${TAB}!A1`, valueInputOption: 'RAW', requestBody: { values: [HEADER] } });
  }
  const day = new Date().toISOString().slice(0, 10);
  const line = [def.이벤트명, def.유사어.join(', '), def.반복, def.성격, def.아이콘, def.문구틀, day];
  await t.sheets.spreadsheets.values.append({ spreadsheetId: t.id, range: `${TAB}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [line] } });
  return { ok: true, event: def };
}

/** 문구 틀만 수정 — 대표가 직접 다듬을 수 있게 */
async function setTemplate(ma, rawName, tpl) {
  const name = String(rawName || '').trim();
  const 문구틀 = String(tpl || '').trim();
  if (!name) return { ok: false, error: '이벤트 이름이 없어요.' };
  if (!문구틀) return { ok: false, error: '문구를 입력해 주세요.' };
  if (문구틀.indexOf('{이름}') < 0) return { ok: false, error: '문구에 {이름}을 넣어주세요 — 고객 이름이 들어갈 자리예요.' };
  const t = await _open(ma);
  if (!t.id) return { ok: false, error: '시트를 찾지 못했어요.' };
  const raw = await _readRaw(t);
  const H = raw[0] || HEADER;
  const col = H.indexOf('문구틀');
  const hit = _toObj(raw).filter((e) => String(e.이벤트명).trim() === name)[0];
  if (!hit || col < 0) return { ok: false, error: `'${name}' 이벤트를 찾지 못했어요.` };
  const a1 = _colLetter(col) + hit._row;
  await t.sheets.spreadsheets.values.update({ spreadsheetId: t.id, range: `${TAB}!${a1}`, valueInputOption: 'RAW', requestBody: { values: [[문구틀]] } });
  return { ok: true, 이벤트명: name, 문구틀 };
}
function _colLetter(idx) { let s = ''; idx += 1; while (idx > 0) { const r = (idx - 1) % 26; s = String.fromCharCode(65 + r) + s; idx = Math.floor((idx - 1) / 26); } return s; }

/** 이벤트 삭제 — 해당 행만 제거(행 단위). 기본 6개는 애초에 여기 없으므로 지워지지 않는다. */
async function remove(ma, rawName) {
  const name = String(rawName || '').trim();
  if (!name) return { ok: false, error: '이벤트 이름이 없어요.' };
  const t = await _open(ma);
  if (!t.id) return { ok: false, error: '시트를 찾지 못했어요.' };
  const hit = _toObj(await _readRaw(t)).filter((e) => String(e.이벤트명).trim() === name)[0];
  if (!hit) return { ok: false, error: `'${name}' 이벤트를 찾지 못했어요.` };
  const meta = await t.sheets.spreadsheets.get({ spreadsheetId: t.id, fields: 'sheets.properties(title,sheetId)' });
  const tab = (meta.data.sheets || []).find((s) => s.properties.title === TAB);
  if (!tab) return { ok: false, error: '이벤트 탭을 찾지 못했어요.' };
  await t.sheets.spreadsheets.batchUpdate({ spreadsheetId: t.id, requestBody: { requests: [
    { deleteDimension: { range: { sheetId: tab.properties.sheetId, dimension: 'ROWS', startIndex: hit._row - 1, endIndex: hit._row } } },
  ] } });
  return { ok: true, removed: name };
}

// ── 대상자 추출 + 문구 렌더 ──
function _findCol(headers, kws) {
  const H = (headers || []).map(_mgmt.norm);
  for (let i = 0; i < H.length; i++) {
    if (!H[i]) continue;
    if ((kws || []).some((k) => { const nk = _mgmt.norm(k); return nk && H[i].indexOf(nk) >= 0; })) return i;
  }
  return null;
}
function _render(tpl, 이름, 날짜, dd) {
  const dl = dd === 0 ? '오늘' : (dd > 0 ? ('D-' + dd) : ((-dd) + '일 전'));
  return String(tpl || '').replace(/\{이름\}/g, 이름).replace(/\{날짜\}/g, 날짜).replace(/\{디데이\}/g, dl);
}
const _p2 = (n) => String(n).padStart(2, '0');

/**
 * 커스텀 이벤트 → 대시보드 metrics(기본 6개와 같은 모양). 기본 배열 뒤에 이어붙여 쓴다.
 * ★기간 기준(승인): "이번달" 전체 + 오늘 해당자는 맨 앞·🔴 강조.
 *   기념일은 미리 준비할 시간이 필요해 당일만 띄우면 놓친다.
 */
function buildMetrics(input) {
  input = input || {};
  const headers = input.headers || [];
  const rows = input.rows || [];
  const events = input.events || [];
  const today = (typeof input.today === 'string' ? _mgmt.parseToday(input.today) : input.today) || _mgmt.nowYMD();
  const F = _mgmt.mapFields(headers);
  return events.map((ev) => {
    const label = String(ev.이벤트명 || '').trim();
    const base = { key: 'custom:' + label, custom: true, color: ev.아이콘 || '⭐', label: label, 성격: ev.성격 || '관리', 문구틀: ev.문구틀 || '' };
    const idx = _findCol(headers, ev.유사어);
    // 컬럼이 없으면 숨기지 않고 🔒로 정직하게 알린다(기본 6개의 locked 패턴 그대로)
    if (idx == null) return Object.assign(base, { count: 0, locked: true, need: `명단에 '${label}' 컬럼`, cards: [] });
    const 매년 = String(ev.반복 || '매년') !== '단발';
    const cards = [];
    rows.forEach((row) => {
      const 이름 = String(F.이름 != null ? (row[F.이름] || '') : '').trim(); if (!이름) return;
      const 전화 = String(F.전화 != null ? (row[F.전화] || '') : '').trim();
      const d = _mgmt.parseYMD(row[idx]); if (!d) return;
      // 매년 반복(기념일)은 연도 무시, 단발(만기형)은 연도까지 일치해야 이번달
      const inMonth = (매년 || !d.y) ? (d.m === today.m) : (d.y === today.y && d.m === today.m);
      if (!inMonth) return;
      const dd = d.d - today.d;  // 같은 달이므로 일자 차이 = D-day (음수면 지남)
      const 날짜 = `${(매년 ? today.y : (d.y || today.y))}-${_p2(d.m)}-${_p2(d.d)}`;
      cards.push({
        이름: 이름, 전화: 전화, 날짜: 날짜, 오늘: dd === 0,
        왜: label + (dd === 0 ? ' · 오늘' : ' · 이번달'),
        언제: dd === 0 ? '오늘' : (dd > 0 ? ('D-' + dd) : ((-dd) + '일 지남')),
        초안: _render(ev.문구틀, 이름, 날짜, dd),
      });
    });
    // 오늘 → 다가올 순 → 지난 순
    cards.sort((a, b) => {
      if (a.오늘 !== b.오늘) return a.오늘 ? -1 : 1;
      const na = Number(String(a.언제).replace(/[^0-9-]/g, '')) || 0;
      const nb = Number(String(b.언제).replace(/[^0-9-]/g, '')) || 0;
      const pa = String(a.언제).indexOf('지남') >= 0 ? 1 : 0, pb = String(b.언제).indexOf('지남') >= 0 ? 1 : 0;
      return pa !== pb ? pa - pb : na - nb;
    });
    return Object.assign(base, { count: cards.length, locked: false, 오늘수: cards.filter((c) => c.오늘).length, cards: cards });
  });
}

module.exports = { init, list, add, setTemplate, remove, buildMetrics, TAB, MAX_EVENTS };
