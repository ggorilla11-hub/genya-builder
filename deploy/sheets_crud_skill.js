// ─────────────────────────────────────────────────────────────
// sheets_crud_skill.js — 🗂️ Step 2-B · Google Sheets 자연어 CRUD (독립 모듈)
// 무엇을·왜: 대표가 말로 "홍길동 주소 인천으로 바꿔줘" → 미리보기 → 승인 → 시트 반영.
//
// ★설계 결재(A/C/A):
//   - 스키마: A) 첫 행(헤더) 자동 감지 + 동의어 매핑
//   - 도구:   C) 5개 (search·read·create·update·delete)
//   - 승인:   A) 모든 쓰기 승인 필수. delete·대량(10건+)은 이중 확인.
//
// ★절대원칙 준수:
//   - 원칙1(제로 인그레스): 시트를 "그때 읽어" 응답에 담고 서버 저장 0.
//     승인 대기 작업도 서버 DB에 안 쌓음 → HMAC 서명 토큰(무상태).
//   - 원칙2·4(무접촉): 프로덕션 하이브리드 라우터·엄마2 페르소나 파일 안 건드림.
//     이 모듈은 자체 Claude 도구호출 루프를 돎(독립).
//   - B-8(Pinecone 재인덱싱)은 엄마2 몫 → 쓰기 성공 시 이벤트 emit만(벡터 무접촉).
//
// 사용: const crud = require('./sheets_crud_skill');
//        crud.init({ anthropic, model, signSecret, demoTitle, sheetTab });
//        await crud.runChat(ma, messages)  → { ok, reply, pending? }
//        await crud.commit(ma, action, sig) → { ok, result, reindex }
//        crud.onWrite(cb)  // 엄마2: 재인덱싱 훅 구독
// ─────────────────────────────────────────────────────────────
'use strict';
const crypto = require('crypto');
const { google } = require('googleapis');
const { EventEmitter } = require('events');

// ── 주입 설정(main_server가 init으로 넘김) ──
let _anthropic = null;
let _MODEL = 'claude-opus-4-8';            // 도구호출 = 정확도 우선(Opus)
let _SIGN_SECRET = 'genya-crud-fallback';  // HMAC 서명 키(env 주입 권장)
let _DEMO_TITLE = '지니야빌더_데모_명단';
let _SHEET_TAB = '고객명단';
const _TTL_MS = 10 * 60 * 1000;            // 승인 토큰 만료 10분
const BULK_THRESHOLD = 10;                 // 대량(이중 확인) 기준

const crudEvents = new EventEmitter();     // 🔌 B-8 훅: 'write' 이벤트(엄마2 구독)

function init(opts) {
  opts = opts || {};
  if (opts.anthropic) _anthropic = opts.anthropic;
  if (opts.model) _MODEL = opts.model;
  if (opts.signSecret) _SIGN_SECRET = String(opts.signSecret);
  if (opts.demoTitle) _DEMO_TITLE = opts.demoTitle;
  if (opts.sheetTab) _SHEET_TAB = opts.sheetTab;
}
function onWrite(cb) { crudEvents.on('write', cb); }

// ═══════════════════════════════════════════════════════════════
// 1. 스키마 자동 감지 (A: 첫 행 + 동의어 매핑)
// ═══════════════════════════════════════════════════════════════
// 말과 컬럼이 다를 때를 잇는 동의어 사전(가벼움 · 확장 가능). key=대표어, value=말투 변형들.
const SYNONYMS = {
  '고객명': ['이름', '성명', '고객', '고객이름', 'name', '성함'],
  '연락처': ['전화', '전화번호', '휴대폰', '핸드폰', '폰번호', '연락', 'phone', '번호'],
  '주소': ['거주지', '사는곳', '집주소', 'address', '거주'],
  '생년월일': ['생일', '생년', '태어난날', 'birth', 'birthday'],
  '결혼기념일': ['기념일', '결혼일', '혼인일'],
  '만기일': ['만기', '만료일', '종료일', '갱신일', 'expiry'],
  '보험사': ['보험회사', '회사', '보험', 'insurer'],
  '가입상품': ['상품', '상품명', '가입', 'product'],
  '직업': ['하는일', '업', 'job', '직종'],
  '상태': ['상태값', 'status', '고객상태'],
  '메모': ['비고', '노트', '특이사항', 'memo', 'note', '참고'],
  '이메일': ['메일', 'email', 'e-mail'],
  '연소득(만원)': ['연소득', '소득', '수입', '연봉'],
};
// 말한 필드명 → 실제 컬럼명 해석. (1)정확 (2)동의어 (3)부분일치
function resolveColumn(spoken, header) {
  if (!spoken) return null;
  const s = String(spoken).trim().toLowerCase().replace(/\s+/g, '');
  const norm = (x) => String(x).trim().toLowerCase().replace(/\s+/g, '');
  // 1) 정확 일치
  for (const h of header) if (norm(h) === s) return h;
  // 2) 동의어 그룹
  for (const [canon, alts] of Object.entries(SYNONYMS)) {
    const group = [canon, ...alts].map(norm);
    if (group.includes(s)) {
      for (const h of header) if (norm(h) === norm(canon)) return h;        // 대표어가 헤더에 있으면
      for (const h of header) if (group.includes(norm(h))) return h;        // 변형이 헤더에 있으면
    }
  }
  // 3) 부분 일치(양방향)
  for (const h of header) { const nh = norm(h); if (nh.includes(s) || s.includes(nh)) return h; }
  return null;
}
// 신원(이름) 컬럼 자동 감지
function detectNameCol(header) {
  const pref = ['고객명', '이름', '성명', '성함', 'name'];
  const norm = (x) => String(x).trim().toLowerCase().replace(/\s+/g, '');
  for (const p of pref) for (const h of header) if (norm(h) === norm(p)) return h;
  return header[0]; // 못 찾으면 첫 컬럼
}
function colLetter(idx) { // 0-based → A,B,...,Z,AA
  let s = ''; idx += 1;
  while (idx > 0) { const r = (idx - 1) % 26; s = String.fromCharCode(65 + r) + s; idx = Math.floor((idx - 1) / 26); }
  return s;
}

// ═══════════════════════════════════════════════════════════════
// 2. 시트 로드 (제로 인그레스: 읽어서 메모리에만)
// ═══════════════════════════════════════════════════════════════
async function loadTable(ma) {
  const drive = google.drive({ version: 'v3', auth: ma });
  const sheets = google.sheets({ version: 'v4', auth: ma });
  const f = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.spreadsheet' and name='${_DEMO_TITLE}' and trashed=false`,
    fields: 'files(id)',
  });
  const id = (f.data.files || [])[0] && f.data.files[0].id;
  if (!id) return { id: null, gid: null, header: [], rows: [], nameCol: null, sheets };
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(title,sheetId)' });
  const tab = (meta.data.sheets || []).find((s) => s.properties.title === _SHEET_TAB);
  const gid = tab ? tab.properties.sheetId : 0;
  const got = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${_SHEET_TAB}!A1:Z200` });
  const values = got.data.values || [];
  const header = values[0] || [];
  const nameCol = detectNameCol(header);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i]; if (!r || !r.some((c) => String(c || '').trim())) continue;
    const o = { _rowNum: i + 1 }; // 1-based 시트 행번호(헤더=1)
    header.forEach((h, j) => { o[h] = r[j] || ''; });
    rows.push(o);
  }
  return { id, gid, header, rows, nameCol, sheets };
}
// 이름 정규화(공백 제거·소문자) — 오타·띄어쓰기 흔들림 흡수
function normName(x) { return String(x || '').trim().toLowerCase().replace(/\s+/g, ''); }
// 이름으로 행 찾기(정확 → 부분). 공백·대소문자 무시.
function findByName(table, name) {
  const n = normName(name);
  if (!n) return [];
  const exact = table.rows.filter((r) => normName(r[table.nameCol]) === n);
  if (exact.length) return exact;
  return table.rows.filter((r) => normName(r[table.nameCol]).includes(n));
}
function slim(r, header) { const o = {}; header.forEach((h) => { if (r[h] !== undefined && r[h] !== '') o[h] = r[h]; }); return o; }

// ── 유사 이름 제안(오타·받침 차이·부분일치) ────────────────────────
// 한글 음절을 초·중·종성 자모로 분해 → 받침 1개 차이(오정서↔오정석)도 "거의 같음"으로 잡는다.
const _CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const _JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const _JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
function _decompose(ch) {
  const code = ch.charCodeAt(0) - 0xAC00;
  if (code < 0 || code > 11171) return ch;
  return _CHO[Math.floor(code / 588)] + _JUNG[Math.floor((code % 588) / 28)] + _JONG[code % 28];
}
function toJamo(s) { return String(s).split('').map(_decompose).join(''); }
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}
// 두 이름의 닮음 정도(0~1). 정확=1, 포함=0.8 이상, 자모 편집거리로 오타 흡수.
function nameSimilarity(a, b) {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ja = toJamo(na), jb = toJamo(nb);
  const d = levenshtein(ja, jb);
  let score = 1 - d / (Math.max(ja.length, jb.length) || 1);
  if (na.includes(nb) || nb.includes(na)) score = Math.max(score, 0.8); // 부분일치 보너스
  return score;
}
// 명단(이름 배열)에서 query와 비슷한 이름 최대 max개 추천(닮음순).
function suggestNames(names, query, opts) {
  opts = opts || {};
  const max = opts.max || 3;
  const threshold = opts.threshold != null ? opts.threshold : 0.55;
  const seen = new Set(); const scored = [];
  for (const nm of names || []) {
    const name = String(nm || '').trim();
    if (!name || seen.has(name)) continue; seen.add(name);
    const s = nameSimilarity(name, query);
    if (s >= threshold) scored.push({ name, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((x) => x.name);
}
// 못 찾았을 때 친절 문구(비슷한 이름 제안 포함)
function notFoundMsg(table, name) {
  const sugg = suggestNames(table.rows.map((r) => r[table.nameCol]), name, { max: 3 });
  const msg = sugg.length
    ? `'${name}'님은 명단에서 못 찾았어요. 혹시 ${sugg.map((s) => `'${s}'`).join(', ')} 님을 찾으시나요?`
    : `'${name}'님을 명단에서 못 찾았어요.`;
  return { suggestions: sugg, message: msg };
}

// ═══════════════════════════════════════════════════════════════
// 3. 읽기 동작 (즉시 실행 · 승인 불필요)
// ═══════════════════════════════════════════════════════════════
async function doSearch(ma, args) {
  const table = await loadTable(ma);
  if (!table.id) return { ok: false, message: `'${_DEMO_TITLE}' 시트를 찾지 못했어요.` };
  let hits = table.rows;
  const col = args.column ? resolveColumn(args.column, table.header) : null;
  const needle = String(args.contains || args.keyword || '').trim();
  if (col && needle) hits = hits.filter((r) => String(r[col]).includes(needle));
  else if (needle) hits = hits.filter((r) => table.header.some((h) => String(r[h]).includes(needle)));
  return { ok: true, count: hits.length, column: col, matches: hits.slice(0, 30).map((r) => slim(r, table.header)) };
}
async function doRead(ma, args) {
  const table = await loadTable(ma);
  if (!table.id) return { ok: false, message: `'${_DEMO_TITLE}' 시트를 찾지 못했어요.` };
  const hits = findByName(table, args.name);
  if (!hits.length) { const nf = notFoundMsg(table, args.name); return { ok: true, found: 0, suggestions: nf.suggestions, message: nf.message }; }
  if (hits.length > 1) return { ok: true, found: hits.length, candidates: hits.map((r) => r[table.nameCol]), message: `'${args.name}'과(와) 비슷한 분이 여럿이에요. 누구인지 골라 주세요.` };
  return { ok: true, found: 1, row: slim(hits[0], table.header) };
}

// ═══════════════════════════════════════════════════════════════
// 4. 승인 게이트 — HMAC 서명 토큰(무상태 · 서버 저장 0)
// ═══════════════════════════════════════════════════════════════
function canonical(action) { // 서명 대상 정규화(키 정렬)
  return JSON.stringify(action, Object.keys(action).sort());
}
function signAction(action) {
  return crypto.createHmac('sha256', _SIGN_SECRET).update(canonical(action)).digest('hex');
}
function verifyAction(action, sig) {
  if (!action || !sig) return { ok: false, reason: '승인 토큰이 없어요.' };
  if (!action.ts || (Date.now() - Number(action.ts)) > _TTL_MS) return { ok: false, reason: '승인 시간이 지났어요(10분). 다시 요청해 주세요.' };
  const expect = signAction(action);
  const a = Buffer.from(expect), b = Buffer.from(String(sig));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: '승인 토큰이 올바르지 않아요.' };
  return { ok: true };
}
// 쓰기 작업 → 미리보기 + 서명(실행 안 함). op: update|create|delete
async function planWrite(ma, op, raw) {
  const table = await loadTable(ma);
  if (!table.id) return { ok: false, message: `'${_DEMO_TITLE}' 시트를 찾지 못했어요.` };
  const action = { op, ts: Date.now() };
  let preview, doubleConfirm = false, warning = '';

  if (op === 'update') {
    const hits = findByName(table, raw.name);
    if (hits.length === 0) { const nf = notFoundMsg(table, raw.name); return { ok: false, suggestions: nf.suggestions, message: nf.message }; }
    if (hits.length > 1) return { ok: false, candidates: hits.map((r) => r[table.nameCol]), message: `'${raw.name}' 후보가 여럿이에요: ${hits.map((r) => r[table.nameCol]).join(', ')}. 누구인지 정확히 말씀해 주세요.` };
    const col = resolveColumn(raw.field, table.header);
    if (!col) return { ok: false, message: `'${raw.field}' 항목을 시트 컬럼에서 못 찾았어요. (컬럼: ${table.header.join(', ')})` };
    const target = hits[0];
    action.rowNum = target._rowNum; action.column = col; action.value = String(raw.value);
    action.name = target[table.nameCol];
    preview = { 대상: action.name, 항목: col, 기존값: target[col] || '(빈칸)', 새값: action.value };
  } else if (op === 'create') {
    const fields = {};
    Object.entries(raw.fields || {}).forEach(([k, v]) => { const c = resolveColumn(k, table.header); if (c) fields[c] = String(v); });
    if (!Object.keys(fields).length) return { ok: false, message: '추가할 정보를 못 알아들었어요. (예: 이름·연락처)' };
    const name = fields[table.nameCol] || '';
    if (name && findByName(table, name).length) warning = `'${name}'님이 이미 명단에 있어요. 중복 추가가 될 수 있어요.`;
    action.fields = fields;
    preview = fields;
  } else if (op === 'delete') {
    const hits = findByName(table, raw.name);
    if (hits.length === 0) { const nf = notFoundMsg(table, raw.name); return { ok: false, suggestions: nf.suggestions, message: nf.message }; }
    if (hits.length > 1) return { ok: false, candidates: hits.map((r) => r[table.nameCol]), message: `'${raw.name}' 후보가 여럿이에요: ${hits.map((r) => r[table.nameCol]).join(', ')}. 누구인지 정확히 말씀해 주세요.` };
    const target = hits[0];
    action.rowNum = target._rowNum; action.name = target[table.nameCol];
    doubleConfirm = true; // ★삭제는 무조건 이중 확인
    warning = '삭제는 되돌릴 수 없어요. 한 번 더 확인해 주세요.';
    preview = slim(target, table.header);
  } else {
    return { ok: false, message: '알 수 없는 작업이에요.' };
  }

  const sig = signAction(action);
  return { ok: true, pending: { action, sig, preview, doubleConfirm, warning } };
}

// ═══════════════════════════════════════════════════════════════
// 5. 실행(commit) — 승인된 서명 검증 후에만 시트 반영
// ═══════════════════════════════════════════════════════════════
async function commit(ma, action, sig, opts) {
  opts = opts || {};
  const v = verifyAction(action, sig);
  if (!v.ok) return { ok: false, message: v.reason };
  if (action.op === 'delete' && !opts.confirmed) return { ok: false, needsDoubleConfirm: true, message: '삭제는 한 번 더 확인이 필요해요.' };

  const table = await loadTable(ma);
  if (!table.id) return { ok: false, message: `'${_DEMO_TITLE}' 시트를 찾지 못했어요.` };
  const sheets = table.sheets, id = table.id;
  let result;

  if (action.op === 'update') {
    const colIdx = table.header.indexOf(action.column);
    if (colIdx < 0) return { ok: false, message: `'${action.column}' 컬럼이 사라졌어요.` };
    const a1 = `${_SHEET_TAB}!${colLetter(colIdx)}${action.rowNum}`;
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: a1, valueInputOption: 'RAW', requestBody: { values: [[action.value]] } });
    result = { op: 'update', name: action.name, 항목: action.column, 새값: action.value };
  } else if (action.op === 'create') {
    const rowArr = table.header.map((h) => action.fields[h] || '');
    await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${_SHEET_TAB}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [rowArr] } });
    result = { op: 'create', fields: action.fields };
  } else if (action.op === 'delete') {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ deleteDimension: { range: { sheetId: table.gid, dimension: 'ROWS', startIndex: action.rowNum - 1, endIndex: action.rowNum } } }] } });
    result = { op: 'delete', name: action.name };
  } else {
    return { ok: false, message: '알 수 없는 작업이에요.' };
  }

  // 🔌 B-8 훅: 쓰기 성공 → 엄마2 Pinecone 재인덱싱 이벤트(개인정보 본문 없이 신호만)
  try { crudEvents.emit('write', { op: action.op, sheet: _DEMO_TITLE, tab: _SHEET_TAB, rowKey: action.name || (action.fields && action.fields[detectNameCol(table.header)]) || '', at: new Date().toISOString() }); } catch (e) {}

  return { ok: true, result, reindex: { emitted: true, note: 'B-8 재인덱싱은 엄마2가 이벤트 구독으로 처리' } };
}

// ═══════════════════════════════════════════════════════════════
// 6. Function Calling · 도구 5개 (C안)
// ═══════════════════════════════════════════════════════════════
const TOOLS = [
  { name: 'search_rows', description: '고객명단에서 조건으로 여러 행을 찾는다. 예) 이번 달 만기, 특정 보험사, 자산가 등. column(찾을 컬럼)과 contains(포함 값), 또는 keyword(전체 검색)를 준다.',
    input_schema: { type: 'object', properties: { column: { type: 'string', description: '필터할 컬럼명(예: 만기일, 보험사). 생략 가능' }, contains: { type: 'string', description: 'column에 포함될 값(예: 2026-07)' }, keyword: { type: 'string', description: '전체 컬럼 대상 키워드 검색' } } } },
  { name: 'read_row', description: '한 고객의 상세 정보 전체를 읽는다. 이름으로 조회.',
    input_schema: { type: 'object', properties: { name: { type: 'string', description: '고객 이름' } }, required: ['name'] } },
  { name: 'create_row', description: '신규 고객 1명을 명단에 추가한다. 반드시 대표 승인 후 실제 반영됨(여기서는 미리보기만).',
    input_schema: { type: 'object', properties: { fields: { type: 'object', description: '항목:값 (예: {"이름":"이지혜","연락처":"010-1234-5678"})' } }, required: ['fields'] } },
  { name: 'update_row', description: '한 고객의 특정 항목을 수정한다. 반드시 대표 승인 후 실제 반영됨(여기서는 미리보기만).',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, field: { type: 'string', description: '수정할 항목(예: 주소)' }, value: { type: 'string', description: '새 값' } }, required: ['name', 'field', 'value'] } },
  { name: 'delete_row', description: '한 고객을 명단에서 삭제한다. 되돌릴 수 없어 이중 확인 필요(여기서는 미리보기만).',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
];
const READ_TOOLS = new Set(['search_rows', 'read_row']);
const WRITE_OP = { create_row: 'create', update_row: 'update', delete_row: 'delete' };

function systemPrompt() {
  return `당신은 "지니야" — 대표님의 고객명단(구글 시트)을 돌보는 비서입니다.
[핵심 능력 — 절대 "못 한다"고 말하지 마세요]
당신은 실제로 고객명단 시트를 조회·추가·수정·삭제할 수 있습니다. 예) "김철수 정보 알려줘" → read_row로 실제 조회, "홍길동 주소 인천으로 바꿔줘" → update_row로 미리보기 준비. 절대 "시트를 직접 못 본다/못 바꾼다"고 답하지 마세요.
[도구 사용 규칙]
1. 대표가 명단을 물으면(누구 정보·이번 주 만기 등) search_rows/read_row로 확인해 사실만 답한다. 지어내지 않는다.
2. 정보를 바꾸는 일(추가·수정·삭제)은 create_row/update_row/delete_row 도구를 부른다. 단, 실제 반영은 대표 승인 후에만 되며, 도구 호출은 "미리보기 준비"까지만이다.
3. 수정·삭제는 대상이 한 명으로 특정될 때만 도구를 부른다. 애매하면 먼저 되묻는다.
4. 삭제는 특히 신중히. 되돌릴 수 없음을 알린다.
5. 말투: 70대 어르신도 알아듣게 따뜻하고 쉽게. '클로드'·'AI' 같은 말은 쓰지 않는다.
6. 항목 이름은 대표가 말한 대로 도구에 넘긴다(주소·연락처 등). 시스템이 실제 컬럼에 맞춰준다.`;
}

// ═══════════════════════════════════════════════════════════════
// 7. 대화 루프 — 자체 Claude 도구호출(프로덕션 라우터 무접촉)
// ═══════════════════════════════════════════════════════════════
//   읽기 도구 → 즉시 실행 후 대화 이어감. 쓰기 도구 → 미리보기+서명 반환하고 멈춤(승인 대기).
async function runChat(ma, messages, opts) {
  opts = opts || {};
  if (!_anthropic) return { ok: false, reply: '엔진이 초기화되지 않았어요.' };
  const conv = (messages || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || m.text || '') })).filter((m) => m.content);
  if (!conv.length) return { ok: false, reply: '무엇을 도와드릴까요?' };

  const trace = [];
  for (let hop = 0; hop < 5; hop++) {
    let r;
    try {
      r = await _anthropic.messages.create({ model: _MODEL, max_tokens: 1200, system: systemPrompt(), tools: TOOLS, messages: conv });
    } catch (e) { return { ok: false, reply: '지금 잠깐 응답이 어려워요. 잠시 후 다시 말씀해 주세요.', error: e.message }; }

    const toolUses = (r.content || []).filter((b) => b.type === 'tool_use');
    const textOut = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

    if (!toolUses.length) return { ok: true, reply: textOut || '네, 말씀하세요.', trace };

    // 쓰기 도구가 있으면 → 첫 쓰기를 미리보기로 잡고 멈춤(승인 게이트)
    const writeUse = toolUses.find((t) => WRITE_OP[t.name]);
    if (writeUse) {
      const op = WRITE_OP[writeUse.name];
      const planned = await planWrite(ma, op, writeUse.input || {});
      trace.push({ tool: writeUse.name, op });
      if (!planned.ok) return { ok: true, reply: planned.message, trace };
      const p = planned.pending;
      const reply = op === 'delete'
        ? `삭제 미리보기예요. ${p.warning}\n아래 내용을 지울까요? 확인하시면 한 번 더 여쭤볼게요.`
        : op === 'create'
          ? `추가 미리보기예요.${p.warning ? ' ' + p.warning : ''} 이대로 명단에 넣을까요?`
          : `수정 미리보기예요. 이대로 바꿀까요?`;
      return { ok: true, reply, pending: p, trace };
    }

    // 읽기 도구 → 즉시 실행하고 결과를 모델에 되돌려 대화 이어감
    conv.push({ role: 'assistant', content: r.content });
    const results = [];
    for (const t of toolUses) {
      let out;
      if (t.name === 'search_rows') out = await doSearch(ma, t.input || {});
      else if (t.name === 'read_row') out = await doRead(ma, t.input || {});
      else out = { ok: false, message: '알 수 없는 도구' };
      trace.push({ tool: t.name, out });
      results.push({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(out) });
    }
    conv.push({ role: 'user', content: results });
  }
  return { ok: true, reply: '요청이 조금 복잡해요. 한 가지씩 다시 말씀해 주시겠어요?', trace };
}

module.exports = {
  init, onWrite, crudEvents,
  runChat, commit,
  // 하위 유닛(엔드포인트/테스트용)
  doSearch, doRead, planWrite,
  loadTable, resolveColumn, detectNameCol, signAction, verifyAction,
  findByName, suggestNames, nameSimilarity, toJamo,
  TOOLS,
};
