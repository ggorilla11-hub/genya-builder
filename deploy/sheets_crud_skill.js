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
const { getServiceAuth } = require('./service_auth'); // 🔑 시트 접근은 서비스 계정으로(로그인 OAuth는 사용자 인증용으로 유지)

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

// ── 🎬 촬영 모드 훅 (2026-07-31 대표님 승인 · 촬영 B-1) ──
// 명단을 읽는 관문(loadTable)을 통째로 다른 데이터로 바꾼다. 부르는 40여 곳은 손대지 않는다.
// _SOURCE 가 null 이면(=평소·라이브) 아래 코드는 아무 영향이 없다.
let _SOURCE = null;
let _WRITE_SOURCE = null;   // 촬영 명단에 실제로 쓰는 함수(commit이 여기로 넘긴다)
function setSource(fn, writeFn) {
  _SOURCE = (typeof fn === 'function') ? fn : null;
  _WRITE_SOURCE = (typeof writeFn === 'function') ? writeFn : null;
}
function isFilming() { return !!_SOURCE; }

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
// ── 🧾 3층: 칸 목록 기억 (2026-07-31) ──────────────────────────
//  왜: 두뇌가 "이 명단에 무슨 칸이 있는지" 모른 채 도구를 불러 '8월' vs '-08-' 같은
//      형식을 잘못 골랐다. → 칸 이름과 ★값 생김새만 기억해 시작할 때 알려준다.
//  ★제로 인그레스: 실제 고객 값은 절대 남기지 않는다. 저장하는 건 칸 이름과 "YYYY-MM-DD" 같은 ★꼴뿐.
const _SCHEMA = { header: [], formats: {} };
function _shapeOf(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'YYYY-MM-DD (날짜)';
  if (/^\d{4}[.\/]\d{1,2}[.\/]\d{1,2}$/.test(s)) return 'YYYY.MM.DD (날짜)';
  if (/^\d{8}$/.test(s)) return 'YYYYMMDD (날짜)';
  if (/^\d{2,3}-\d{3,4}-\d{4}$/.test(s)) return '전화번호꼴';
  if (/@/.test(s)) return '이메일꼴';
  if (/^[\d,]+원$/.test(s)) return '숫자+원 (쉼표 있음)';
  if (/^\d+만원$/.test(s)) return '숫자+만원';
  if (/^[\d,]+$/.test(s)) return '숫자';
  if (/^(남|여)$/.test(s)) return "'남' 또는 '여'";
  return '글자';
}
function _rememberSchema(t) {
  if (!t || !Array.isArray(t.header) || !t.header.length) return;
  const fmt = {};
  for (const h of t.header) {
    const row = (t.rows || []).find((r) => String(r[h] || '').trim());
    fmt[h] = row ? _shapeOf(row[h]) : '(비어 있음)';
  }
  _SCHEMA.header = t.header.slice();
  _SCHEMA.formats = fmt;
}
/** 두뇌에게 보여줄 재료창고 목록 (칸 이름 + 값 생김새). 아직 한 번도 못 읽었으면 빈 문자열. */
function schemaHint() {
  if (!_SCHEMA.header.length) return '';
  const lines = _SCHEMA.header.map((h) => `  · ${h} — ${_SCHEMA.formats[h] || '글자'}`).join('\n');
  return `\n[이 명단의 칸 ${_SCHEMA.header.length}개 — 값이 어떻게 생겼는지까지]\n${lines}\n`
    + `★날짜 칸이 여럿이다(생년월일·가입일·만기일 등). "몇 월"을 물으면 ★어느 칸인지 반드시 지정하라 — 안 그러면 생일 물었는데 만기가 섞인다.\n`;
}

async function loadTable(ma) {
  const _t = await _loadTableRaw(ma);
  try { _rememberSchema(_t); } catch (e) {}   // 실패해도 조회는 그대로 진행(부가 기능)
  return _t;
}
async function _loadTableRaw(ma) {
  // 🎬 촬영 모드(FILMING_MODE=1)에서만 켜지는 갈림길. 평소엔 _SOURCE=null 이라 아래 원래 코드 그대로 탄다.
  //    켜지면 구글을 아예 안 부른다 → 실제 고객 시트 접근 0(섞일 길이 없음).
  if (_SOURCE) return _SOURCE(ma);
  // 🔑 시트 접근 인증 — ★2026-08-01 각자 명단 격리(대표님 지시).
  //   전에는 ★무조건 서비스계정(SA)이었다 → SA에 공유된 시트 하나를 ★모든 회원이 같이 봤다.
  //   (service_auth.js:4 주석이 "회원이 여럿이 되면 반드시 바꿔야 한다"고 미리 경고하던 그 문제)
  //   이제: 회원 토큰이 있으면 ★그 회원 본인 드라이브를 본다 → A는 A 명단, B는 B 명단.
  //   비로그인·데모는 SA 그대로 → 기존 공유 데모 경로 무접촉.
  //   ★아래 drive·sheets 클라이언트가 이 auth를 그대로 쓰므로 읽기·쓰기가 함께 격리된다.
  const _useMember = !!ma;
  const auth = _useMember ? ma : await getServiceAuth();
  console.log(_useMember ? '[🔑인증] 시트 접근: 회원 본인 토큰 (각자 명단 격리)' : '[🔑인증] 시트 접근: 서비스 계정 (공유 데모)');
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });
  // ★공유된 남의 시트 함정 차단(2026-08-01 대표님 지시 ①):
  //   회원 토큰으로 이름만 찾으면, 남이 같은 이름 시트를 공유해 뒀을 때 ★그게 잡힐 수 있다
  //   (그리고 여러 개면 첫 번째가 잡혀 ★비결정적이다). "본인이 소유한 것"으로 못 박는다.
  //   ★단 SA(비로그인·데모) 경로에는 붙이면 안 된다 — 데모 시트는 SA 소유가 아니라
  //     SA에 ★공유된 것이라, 'me' in owners 를 붙이면 데모가 통째로 안 잡힌다(기존 경로 보존).
  const _ownerOnly = _useMember ? " and 'me' in owners" : '';
  const f = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.spreadsheet' and name='${_DEMO_TITLE}' and trashed=false${_ownerOnly}`,
    fields: 'files(id)',
  });
  const id = (f.data.files || [])[0] && f.data.files[0].id;
  if (!id) return { id: null, gid: null, header: [], rows: [], nameCol: null, sheets };
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(title,sheetId)' });
  const tab = (meta.data.sheets || []).find((s) => s.properties.title === _SHEET_TAB);
  const gid = tab ? tab.properties.sheetId : 0;
  // 행 제한 해제: A1:Z200(=199행)에서 어피티 뒷부분이 잘리던 버그 → 전체 행 읽기.
  // ★컬럼 제한도 해제(2026-07-25): A1:Z는 26컬럼이 한계라 실무 양식(기본정보·가족/재무·보험상품·상담관리 = 26컬럼 초과)의
  //   27번째 컬럼부터가 통째로 안 읽혔다. 안 읽히면 화면에도 안 뜨고 재작성 때 지워진다. CZ(104컬럼)로 확장.
  const got = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${_SHEET_TAB}!A1:CZ` });
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
  // ★컬럼명 예측 불가(고객명·이름·성명·Name·담당자·대표자…) → 특정 이름컬럼에 한정하지 않고 "모든 컬럼 값"에서 검색. 하드코딩·후보리스트 없음.
  const scan = (r, test) => Object.keys(r).some((k) => k !== '_rowNum' && test(normName(r[k])));
  const exact = table.rows.filter((r) => scan(r, (v) => v === n));       // 정확 일치 우선
  if (exact.length) return exact;
  return table.rows.filter((r) => scan(r, (v) => v && v.includes(n)));   // 없으면 부분 일치
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
// 2-B. 🔪 조건 필터 엔진 (1층 · 2026-07-31 대표님 승인)
// ═══════════════════════════════════════════════════════════════
//  왜: 지금까지 명단 검색이 "글자 찾기" 하나뿐이라(국자 하나) 두뇌가 조건을 정확히
//      이해해도 실행할 수가 없었다. "생년월일이 8월"을 시키면 '-08-'를 20칸 전부에서
//      찾아 ★만기일·가입일이 섞였다. → 칸 지정·비교·범위·결합을 도구에 쥐어준다.
//  ★계산은 코드가 한다(두뇌가 세지 않는다) → 인원수 환각이 구조적으로 0.
//  ★기존 길(column/contains/keyword)은 그대로 살려둔다 — 지금 되는 것은 안 깨진다.

/** 한국 오늘 (나이 계산 기준) */
function _todayKST() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
/** 값에서 숫자만 뽑는다. '14,000원'→14000 · '11060만원'→11060 · 빈칸→null */
function _toNum(v) {
  const s = String(v == null ? '' : v).replace(/[,\s]/g, '');
  if (!s) return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
/** 날짜 해석. '1990-08-19' · '2026.08' · '20260817' · '8월 19일'(연도 없음) 모두 받는다. */
function _toDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-.\/년]\s*(\d{1,2})(?:[-.\/월]\s*(\d{1,2}))?/);
  if (m) return { y: +m[1], mo: +m[2], d: m[3] ? +m[3] : null };
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})월\s*(\d{1,2})?\s*일?$/);           // 연도 없는 '8월 19일'
  if (m) return { y: null, mo: +m[1], d: m[2] ? +m[2] : null };
  return null;
}
/** 날짜를 비교용 숫자로. 일이 없으면 lo=1일 / hi=31일 (달 단위 비교를 정확히) */
function _ymd(dt, edge) { if (!dt || !dt.y) return null; return dt.y * 10000 + dt.mo * 100 + (dt.d != null ? dt.d : (edge === 'hi' ? 31 : 1)); }
/** 만 나이 (생일이 안 지났으면 한 살 뺀다) */
function _age(v, today) {
  const b = _toDate(v);
  if (!b || !b.y) return null;
  let a = today.y - b.y;
  if (today.m < b.mo || (today.m === b.mo && b.d != null && today.d < b.d)) a--;
  return a;
}
/** 말로 온 연산자를 표준형으로 (두뇌가 한글로 줘도 받는다) */
const _OPS = {
  '포함': 'contains', 'contains': 'contains', 'like': 'contains', '들어감': 'contains',
  '미포함': 'not_contains', 'not_contains': 'not_contains', '제외': 'not_contains', '아님': 'not_equals',
  '=': 'equals', '==': 'equals', 'eq': 'equals', 'equals': 'equals', '같음': 'equals', '일치': 'equals',
  '!=': 'not_equals', 'ne': 'not_equals', 'not_equals': 'not_equals',
  '>': 'gt', 'gt': 'gt', '초과': 'gt',
  '>=': 'gte', 'gte': 'gte', '이상': 'gte',
  '<': 'lt', 'lt': 'lt', '미만': 'lt',
  '<=': 'lte', 'lte': 'lte', '이하': 'lte',
  'between': 'between', '범위': 'between', '사이': 'between',
  'month': 'month', '월': 'month',
  'year': 'year', '년': 'year', '연도': 'year',
  'age_between': 'age_between', '나이': 'age_between', '나이범위': 'age_between',
  'empty': 'empty', '빈칸': 'empty', '없음': 'empty',
  'not_empty': 'not_empty', '있음': 'not_empty', '채워짐': 'not_empty',
};
const _NEED_VALUE = new Set(['contains', 'not_contains', 'equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'month', 'year', 'age_between']);

/** 필터 1개를 검사 가능한 형태로 (틀리면 error 를 돌려 두뇌가 고쳐 부르게 한다) */
function _prepFilter(col, f) {
  const raw = String(f.op == null || f.op === '' ? 'contains' : f.op).trim().toLowerCase();
  const op = _OPS[raw];
  if (!op) return { error: `'${f.op}' 는 모르는 조건이에요. 쓸 수 있는 것: 포함·같음·이상·이하·초과·미만·범위(between)·월(month)·년(year)·나이(age_between)·빈칸(empty)·있음(not_empty)` };
  const v = f.value == null ? '' : f.value;
  if (_NEED_VALUE.has(op) && String(v).trim() === '') return { error: `'${col}' 조건에 값이 없어요.` };
  if ((op === 'between' || op === 'age_between') && (f.value2 == null || String(f.value2).trim() === '')) {
    return { error: `'${col}' 범위 조건에는 value 와 value2 가 둘 다 필요해요.` };
  }
  if (op === 'month') { const n = _toNum(v); if (!(n >= 1 && n <= 12)) return { error: `월은 1~12 로 주세요 (받은 값: ${v}).` }; }
  return { filter: { col, op, value: v, value2: f.value2 } };
}

/** 이 값이 날짜 조건인가 — 조건 값이 날짜꼴이면 날짜로, 아니면 숫자로 비교한다 */
function _isDateLike(v) { return /^\d{4}([-.\/]\d{1,2})/.test(String(v).trim()) || /^\d{8}$/.test(String(v).trim()); }

/** 셀 1개가 필터 1개를 만족하는가 */
function _matchOne(cell, f, today) {
  const s = String(cell == null ? '' : cell).trim();
  const norm = (x) => String(x == null ? '' : x).trim().toLowerCase();
  switch (f.op) {
    case 'empty': return s === '';
    case 'not_empty': return s !== '';
    case 'contains': return norm(s).includes(norm(f.value));
    case 'not_contains': return !norm(s).includes(norm(f.value));
    case 'equals': {
      const a = _toNum(s), b = _toNum(f.value);
      if (a != null && b != null && !_isDateLike(s) && !_isDateLike(f.value)) return a === b;
      return norm(s) === norm(f.value);
    }
    case 'not_equals': return !_matchOne(cell, { ...f, op: 'equals' }, today);
    case 'month': { const d = _toDate(s); return !!d && d.mo === _toNum(f.value); }
    case 'year': { const d = _toDate(s); return !!d && d.y === _toNum(f.value); }
    case 'age_between': {
      const a = _age(s, today);
      if (a == null) return false;
      const lo = _toNum(f.value), hi = _toNum(f.value2);
      return a >= Math.min(lo, hi) && a <= Math.max(lo, hi);
    }
    case 'gt': case 'gte': case 'lt': case 'lte': case 'between': {
      const 날짜 = _isDateLike(f.value) || (f.op === 'between' && _isDateLike(f.value2));
      if (날짜) {
        const c = _ymd(_toDate(s), 'lo');
        if (c == null) return false;
        if (f.op === 'between') {
          const lo = _ymd(_toDate(f.value), 'lo'), hi = _ymd(_toDate(f.value2), 'hi');
          if (lo == null || hi == null) return false;
          return c >= Math.min(lo, hi) && c <= Math.max(lo, hi);
        }
        const b = _ymd(_toDate(f.value), f.op === 'gt' || f.op === 'gte' ? 'lo' : 'hi');
        if (b == null) return false;
        return f.op === 'gt' ? c > b : f.op === 'gte' ? c >= b : f.op === 'lt' ? c < b : c <= b;
      }
      const c = _toNum(s);
      if (c == null) return false;
      if (f.op === 'between') {
        const lo = _toNum(f.value), hi = _toNum(f.value2);
        if (lo == null || hi == null) return false;
        return c >= Math.min(lo, hi) && c <= Math.max(lo, hi);
      }
      const b = _toNum(f.value);
      if (b == null) return false;
      return f.op === 'gt' ? c > b : f.op === 'gte' ? c >= b : f.op === 'lt' ? c < b : c <= b;
    }
    default: return false;
  }
}
/** 무슨 기준으로 걸렀는지 사람 말로 (지니야가 근거를 밝히게 — 환각 차단) */
function _describe(f) {
  switch (f.op) {
    case 'contains': return `${f.col}에 '${f.value}' 포함`;
    case 'not_contains': return `${f.col}에 '${f.value}' 없음`;
    case 'equals': return `${f.col}이(가) '${f.value}'`;
    case 'not_equals': return `${f.col}이(가) '${f.value}' 아님`;
    case 'month': return `${f.col}이(가) ${_toNum(f.value)}월`;
    case 'year': return `${f.col}이(가) ${_toNum(f.value)}년`;
    case 'age_between': return `나이(${f.col} 기준·만 나이) ${f.value}~${f.value2}세`;
    case 'between': return `${f.col}이(가) ${f.value} ~ ${f.value2}`;
    case 'gt': return `${f.col}이(가) ${f.value} 초과`;
    case 'gte': return `${f.col}이(가) ${f.value} 이상`;
    case 'lt': return `${f.col}이(가) ${f.value} 미만`;
    case 'lte': return `${f.col}이(가) ${f.value} 이하`;
    case 'empty': return `${f.col}이(가) 빈칸`;
    case 'not_empty': return `${f.col}이(가) 채워져 있음`;
    default: return f.col;
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. 읽기 동작 (즉시 실행 · 승인 불필요)
// ═══════════════════════════════════════════════════════════════
async function doSearch(ma, args) {
  const table = await loadTable(ma);
  if (!table.id) return { ok: false, message: `'${_DEMO_TITLE}' 시트를 찾지 못했어요.` };
  const header = table.header || [];
  let hits = table.rows;
  let col = null, 조건 = '(조건 없음 · 전체 명단)', 검색범위 = '전체';

  // ── ★새 길: filters (칸·비교·범위·결합). 두뇌가 조건을 주면 코드가 정확히 거른다.
  const filters = Array.isArray(args.filters) ? args.filters.filter((f) => f && f.column) : [];
  if (filters.length) {
    const prepared = [];
    for (const f of filters) {
      const c = resolveColumn(f.column, header);
      if (!c) return { ok: false, 오류: `'${f.column}' 칸이 명단에 없어요.`, 칸목록: header, 안내: '아래 칸목록에 있는 이름으로 다시 불러 주세요. 지어내지 마세요.' };
      const p = _prepFilter(c, f);
      if (p.error) return { ok: false, 오류: p.error, 칸목록: header };
      prepared.push(p.filter);
    }
    const mode = String(args.match || 'AND').trim().toUpperCase() === 'OR' ? 'OR' : 'AND';
    const today = _todayKST();
    hits = hits.filter((r) => (mode === 'OR'
      ? prepared.some((f) => _matchOne(r[f.col], f, today))
      : prepared.every((f) => _matchOne(r[f.col], f, today))));
    조건 = prepared.map(_describe).join(mode === 'OR' ? ' 또는 ' : ' 그리고 ');
    검색범위 = prepared.map((f) => f.col).join(', ') + ' 칸만';
    col = prepared[0].col;
  } else {
    // ── 기존 길(하위호환): contains/keyword. ★단 칸을 지정했고 그 칸이 실제로 있으면 그 칸만 본다.
    //    (예전엔 칸을 무시하고 20칸을 다 훑어 생년월일 대신 만기일·가입일이 섞였다)
    col = args.column ? resolveColumn(args.column, header) : null;
    const needle = String(args.contains || args.keyword || '').trim();
    if (needle) {
      if (col && !args.keyword) {
        hits = hits.filter((r) => String(r[col]).includes(needle));
        조건 = `${col}에 '${needle}' 포함`; 검색범위 = `${col} 칸만`;
      } else {
        // 칸을 안 줬거나 못 알아본 칸이면 예전처럼 전체 칸에서 찾는다(빈손 방지 안전망)
        hits = hits.filter((r) => header.some((h) => String(r[h]).includes(needle)));
        조건 = `전체 칸에 '${needle}' 포함`; 검색범위 = '전체 칸';
      }
    }
  }

  // ★count 는 ★전체 건수다(matches 는 화면용 30건만). 이 둘을 헷갈려
  //   "상위 30명 기준으로는 8명"처럼 ★틀린 수를 말하던 것을 막는다.
  return {
    ok: true,
    count: hits.length,
    전체건수: hits.length,
    조건: 조건,                 // ★무슨 기준으로 걸렀는지 — 지니야는 이 말 그대로 근거를 밝힌다
    검색범위: 검색범위,
    안내: `조건에 맞는 고객은 총 ${hits.length}명입니다. 아래 matches 는 그중 앞 ${Math.min(30, hits.length)}명만 보여준 것이니, ★인원수를 말할 때는 반드시 ${hits.length} 을(를) 쓰세요.`
      + (hits.length === 0 ? ' ★0명이면 "없다"고 정직히 말하고, 조건을 바꿔 지어내지 마세요.' : ''),
    column: col,
    칸목록: header,             // ★두뇌가 칸을 잘못 골랐으면 스스로 고쳐 다시 부를 수 있게
    matches: hits.slice(0, 30).map((r) => slim(r, header)),
  };
}
// 회장님 드라이브의 스프레드시트(시트 파일) 목록 조회 — sheet_list 도구. 최신순 최대 30개.
async function doListSheets(ma) {
  const drive = google.drive({ version: 'v3', auth: ma });
  const f = await drive.files.list({ q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false", fields: 'files(id,name,modifiedTime)', orderBy: 'modifiedTime desc', pageSize: 30 });
  const files = f.data.files || [];
  return { ok: true, count: files.length, sheets: files.map((x) => ({ name: x.name, modified: (x.modifiedTime || '').slice(0, 10) })) };
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
// ═══════════════════════════════════════════════════════════════
// 4-B. 🆕 컬럼 추가(구조 변경) 보조 — 2026-07-26
//   왜: 명단에 없는 항목(결혼기념일 등)은 값 수정이 아예 막혀 있었다("컬럼에서 못 찾았어요").
//   ★안전 3원칙: ①격자 자동 확장 ②반영 전후 실측 ③유사어 중복 차단.
//   ★맨 끝에만 추가한다. 기존 컬럼·순서·데이터는 절대 건드리지 않는다.
// ═══════════════════════════════════════════════════════════════
// 컬럼 비교용 정규화 — 공백·중점·하이픈·괄호까지 제거해 '결혼기념일'과 '결혼 기념일'을 같게 본다.
function _normCol(x) { return String(x == null ? '' : x).toLowerCase().replace(/[\s·\-_()/.]/g, ''); }
// 이미 있는 비슷한 컬럼 찾기(하드코딩 금지 · 동의어 + 정규화 + 부분포함 양방향)
//   → 결혼기념일 / 결혼 기념일 / 결혼기념 이 따로 생겨 명단이 누더기가 되는 걸 막는다.
function findSimilarColumn(name, header) {
  // ★길이 가드가 맨 앞에 있어야 한다. 뒤에 두면 resolveColumn이 먼저 '일'→'생년월일' 같은 오탐을 낸다(실측 확인).
  const n = _normCol(name);
  if (n.length < 2) return null;
  const direct = resolveColumn(name, header);
  if (direct) return direct;
  for (const h of header) if (_normCol(h) === n) return h;
  for (const h of header) { const nh = _normCol(h); if (nh.length >= 2 && (nh.indexOf(n) >= 0 || n.indexOf(nh) >= 0)) return h; }
  return null;
}
// 서울 기준 올해 — "7월 27일"처럼 연도를 안 말했을 때 채운다(서버가 UTC라 연말에 1년 밀리는 것 방지)
function _seoulYear() {
  try { return +new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()); }
  catch (e) { return new Date().getFullYear(); }
}
const _pad2 = (n) => String(n).padStart(2, '0');
// 값 정규화: 날짜처럼 보이면 YYYY-MM-DD로. 날짜가 아니면 원문 그대로(자유 텍스트도 허용).
function _normValue(v) {
  const s = String(v == null ? '' : v).trim(); if (!s) return s;
  let m;
  if ((m = s.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D*$/))) return `${m[1]}-${_pad2(+m[2])}-${_pad2(+m[3])}`;
  if ((m = s.match(/^(\d{1,2})\s*[월/.\-]\s*(\d{1,2})\s*일?$/))) return `${_seoulYear()}-${_pad2(+m[1])}-${_pad2(+m[2])}`;
  return s;
}
// 컬럼 추가 계획 공통 검사
function _planColumn(table, columnName) {
  const name = String(columnName || '').trim().replace(/\s+/g, ' ');
  if (!name) return { error: '추가할 항목 이름을 알려주세요.' };
  if (_normCol(name).length < 2) return { error: '항목 이름은 두 글자 이상으로 해주세요.' }; // 한 글자는 중복 검사가 무의미해 막는다
  if (name.length > 20) return { error: '항목 이름은 20자 이내로 해주세요.' };
  const dup = findSimilarColumn(name, table.header);
  if (dup) return { error: `이미 '${dup}' 항목이 명단에 있어요. 새로 만들지 않고 거기에 기록할까요?`, existing: dup };
  return { name };
}
// ★①격자 한계 자동 확장: 구글 시트는 격자(columnCount)를 넘겨 쓰면 "exceeds grid limits"로 실패한다.
//   새 시트 기본이 26컬럼이라 22 → 27번째부터 터진다. 필요하면 미리 넓힌다(여유 4칸).
async function _ensureGridWidth(sheets, id, need) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties(sheetId,title,gridProperties.columnCount)' });
  const tab = (meta.data.sheets || []).find((s) => s.properties.title === _SHEET_TAB);
  if (!tab) return { ok: false, message: `'${_SHEET_TAB}' 탭을 찾지 못했어요.` };
  const cur = (tab.properties.gridProperties || {}).columnCount || 0;
  if (cur >= need) return { ok: true, expanded: 0, columnCount: cur };
  const add = (need - cur) + 4;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [
    { appendDimension: { sheetId: tab.properties.sheetId, dimension: 'COLUMNS', length: add } },
  ] } });
  return { ok: true, expanded: add, columnCount: cur + add };
}

// 쓰기 작업 → 미리보기 + 서명(실행 안 함). op: update|create|delete|add_column|add_column_set
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
    // ★없는 항목에 기록하라고 하면 거부하지 말고 ★항목을 만들면서 기록한다(2026-07-31).
    //   전엔 "그 항목을 못 찾았어요"로 끝나 값이 안 들어갔다. 대표 뜻은 "그 항목에 남겨라"로 분명하다.
    if (!col && String(raw.field || '').trim() && String(raw.value || '').trim()) {
      return planWrite(ma, 'add_column_set', { column: raw.field, name: raw.name, value: raw.value });
    }
    if (!col) return { ok: false, message: `'${raw.field}' 항목을 시트 컬럼에서 못 찾았어요. (컬럼: ${table.header.join(', ')})` };
    const target = hits[0];
    action.rowNum = target._rowNum; action.column = col; action.value = String(raw.value);
    action.name = target[table.nameCol]; action.before = (target[col] != null ? String(target[col]) : ''); // ★변경 전 값(commit 실값 보고용·서명에 포함)
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
  } else if (op === 'add_column' || op === 'add_column_set') {
    // 🆕 구조 변경: 맨 끝에 새 항목(컬럼) 추가. add_column_set은 값 기록까지 한 번에 처리.
    const c = _planColumn(table, raw.column);
    // ★이미 있는 항목이면 거부하지 말고 ★수정(update)으로 자동 전환한다(2026-07-31).
    //   전엔 "이미 '비고' 항목이 있어요. 거기에 기록할까요?" 하고 되묻기만 해서
    //   대표가 두 번 말해야 했고, 값이 끝내 안 들어가는 일이 잦았다. 뜻은 이미 분명하다.
    if (c.error && op === 'add_column_set' && String(raw.name || '').trim()) {
      const 있는칸 = c.existing || resolveColumn(raw.column, table.header) || raw.column;
      if (있는칸) return planWrite(ma, 'update', { name: raw.name, field: 있는칸, value: raw.value });
    }
    if (c.error) return { ok: false, message: c.error, existing: c.existing };
    action.column = c.name;
    action.colIndex = table.header.length;      // 맨 끝(0-based)
    action.beforeCols = table.header.length;    // 실측 대조용
    action.beforeRows = table.rows.length;
    preview = { 작업: '항목(컬럼) 추가', 새항목: c.name, 위치: '명단 맨 끝', 항목수: `${table.header.length}개 → ${table.header.length + 1}개` };
    if (op === 'add_column_set') {
      const hits = findByName(table, raw.name);
      if (hits.length === 0) { const nf = notFoundMsg(table, raw.name); return { ok: false, suggestions: nf.suggestions, message: nf.message }; }
      if (hits.length > 1) return { ok: false, candidates: hits.map((r) => r[table.nameCol]), message: `'${raw.name}' 후보가 여럿이에요: ${hits.map((r) => r[table.nameCol]).join(', ')}. 누구인지 정확히 말씀해 주세요.` };
      const target = hits[0];
      action.rowNum = target._rowNum;
      action.name = target[table.nameCol];
      action.value = _normValue(raw.value);     // "7월 27일" → "2026-07-27" (미리보기에 그대로 보여 눈으로 확인)
      preview.대상 = action.name;
      preview.기록할값 = action.value;
    }
    warning = '항목 추가는 구조 변경이라 되돌리기 어려워요. 기존 항목과 데이터는 건드리지 않고 맨 끝에만 추가합니다.';
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
  // ★내부 명단 수정은 대표 지시로 즉시 반영한다(2026-07-31 승인).
  //   되돌릴 수 있는 일(수정·추가·항목추가)은 서명 없이도 진행. 되돌릴 수 없는 삭제는 그대로 확인받는다.
  //   ★고객에게 나가는 발송은 여기 오지 않는다(approval_skill 하드가드 무접촉).
  if (!opts.즉시) {
    const v = verifyAction(action, sig);
    if (!v.ok) return { ok: false, message: v.reason };
  }
  if (action.op === 'delete' && !opts.confirmed) return { ok: false, needsDoubleConfirm: true, message: '삭제는 한 번 더 확인이 필요해요.' };

  // 🎬 촬영 모드: 구글 대신 ★촬영 명단(메모리)에 그대로 쓴다.
  //   전엔 쓰기를 거부해서, 촬영에서 "추가·수정"을 하려면 별도 지름길을 파야 했다 →
  //   그 지름길이 본 기능과 충돌해 오인식·승인창 잔재·연결 요구를 만들었다. 이제 길은 하나다.
  if (_SOURCE && _WRITE_SOURCE) return _WRITE_SOURCE(action);

  const table = await loadTable(ma);
  if (!table.id) return { ok: false, message: `'${_DEMO_TITLE}' 시트를 찾지 못했어요.` };
  const sheets = table.sheets, id = table.id;
  let result;

  if (action.op === 'update') {
    const colIdx = table.header.indexOf(action.column);
    if (colIdx < 0) return { ok: false, message: `'${action.column}' 컬럼이 사라졌어요.` };
    const a1 = `${_SHEET_TAB}!${colLetter(colIdx)}${action.rowNum}`;
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: a1, valueInputOption: 'RAW', requestBody: { values: [[action.value]] } });
    result = { op: 'update', name: action.name, 항목: action.column, 기존값: (action.before != null ? action.before : ''), 새값: action.value, 행: action.rowNum };
  } else if (action.op === 'create') {
    const rowArr = table.header.map((h) => action.fields[h] || '');
    await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${_SHEET_TAB}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [rowArr] } });
    result = { op: 'create', fields: action.fields };
  } else if (action.op === 'delete') {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ deleteDimension: { range: { sheetId: table.gid, dimension: 'ROWS', startIndex: action.rowNum - 1, endIndex: action.rowNum } } }] } });
    result = { op: 'delete', name: action.name };
  } else if (action.op === 'add_column' || action.op === 'add_column_set') {
    // ★③유사어 중복 재확인: 승인을 기다리는 사이 같은 항목이 생겼을 수 있다(누더기 방지).
    const dup = findSimilarColumn(action.column, table.header);
    if (dup) return { ok: false, message: `이미 '${dup}' 항목이 있어서 추가하지 않았어요. 그 항목에 기록할까요?` };
    const beforeCols = table.header.length, beforeRows = table.rows.length;
    const colIdx = beforeCols;                    // ★언제나 맨 끝. 기존 컬럼 위치는 절대 안 건드린다.
    // ★①격자 자동 확장 — 26컬럼 벽에서 터지지 않게 먼저 넓힌다.
    const g = await _ensureGridWidth(sheets, id, colIdx + 1);
    if (!g.ok) return { ok: false, message: g.message };
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${_SHEET_TAB}!${colLetter(colIdx)}1`, valueInputOption: 'RAW', requestBody: { values: [[action.column]] } });
    let 기록 = null;
    if (action.op === 'add_column_set') {
      await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${_SHEET_TAB}!${colLetter(colIdx)}${action.rowNum}`, valueInputOption: 'RAW', requestBody: { values: [[action.value]] } });
      기록 = { 대상: action.name, 값: action.value, 행: action.rowNum };
    }
    // ★②반영 전후 실측 — "했다"고 말하기 전에 시트를 다시 읽어 진짜 그렇게 됐는지 확인한다.
    //   어제 "성공했다는데 실제론 반쪽"이었던 사고를 여기서 끊는다. 하나라도 어긋나면 완료 보고 금지.
    const after = await loadTable(ma);
    const 기존유지 = table.header.every((h, i) => after.header[i] === h);   // 기존 컬럼 순서·이름 그대로인가
    if (!기존유지) return { ok: false, message: '기존 항목 순서가 달라졌어요. 반영을 완료로 보고하지 않습니다 — 시트를 확인해 주세요.' };
    if (after.header.indexOf(action.column) !== colIdx) return { ok: false, message: `'${action.column}' 항목이 시트에서 확인되지 않았어요. 완료로 보고하지 않습니다 — 시트를 확인해 주세요.` };
    if (after.rows.length !== beforeRows) return { ok: false, message: `고객 수가 달라졌어요(${beforeRows}명 → ${after.rows.length}명). 완료로 보고하지 않습니다 — 시트를 확인해 주세요.` };
    if (기록) {
      const row = (after.rows || []).filter((r) => r._rowNum === action.rowNum)[0];
      if (!row || String(row[action.column] || '') !== String(action.value)) {
        return { ok: false, message: `'${action.column}' 항목은 만들었는데 ${action.name}님 값이 기록되지 않았어요. 시트를 확인해 주세요.` };
      }
    }
    console.log(`[🆕항목추가] "${action.column}" · 항목 ${beforeCols}→${after.header.length} · 고객 ${beforeRows}→${after.rows.length} · 격자확장 ${g.expanded}칸` + (기록 ? ` · ${기록.대상}=${기록.값}` : ''));
    result = { op: action.op, 새항목: action.column, 위치: '맨 끝', 항목수: `${beforeCols} → ${after.header.length}`, 고객수: after.rows.length, 기존유지: true, 기록: 기록 };
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
  { name: 'sheet_list', description: '회장님 구글 드라이브에 있는 스프레드시트(시트 파일) 목록을 조회한다. "내 구글 시트에 어떤 시트들이 있어?", "시트 목록 알려줘", "무슨 시트 있지?" 등에 사용. ★실제로 조회 가능하니 절대 "연동 안 됐다/지어낸다"고 답하지 말 것.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'sheet_search', description: `고객명단에서 ★어떤 조건으로든 사람을 찾는다. 조건은 filters 로 준다(권장) — 칸을 지정하고 비교·범위·결합까지 된다. 계산은 시스템이 하니 인원수를 네가 세지 마라.
[filters 쓰는 법] filters:[{column, op, value, value2}] · match:"AND"(기본) 또는 "OR"
  op 종류: contains(포함·기본) · not_contains · equals · not_equals · gt(초과) · gte(이상) · lt(미만) · lte(이하) · between(범위·value~value2) · month(그 칸의 날짜가 몇 월) · year(몇 년) · age_between(만 나이 범위·생년월일 칸에) · empty(빈칸) · not_empty
[예시]
  "생년월일이 8월인 사람" → filters:[{column:"생년월일", op:"month", value:8}]     ★'-08-' 같은 글자 찾기를 쓰지 마라(만기일·가입일이 섞인다)
  "8월 만기"            → filters:[{column:"만기일", op:"month", value:8}]
  "연소득 5천만원 이상"   → filters:[{column:"연소득", op:"gte", value:5000}]        (칸 단위가 '만원'이면 만원 단위 숫자로)
  "자동차보험 여성"      → filters:[{column:"가입상품", op:"contains", value:"자동차"},{column:"성별", op:"equals", value:"여"}], match:"AND"
  "40대"               → filters:[{column:"생년월일", op:"age_between", value:40, value2:49}]
  "2026년 하반기 만기"   → filters:[{column:"만기일", op:"between", value:"2026-07", value2:"2026-12"}]
(옛 방식 column/contains/keyword 도 아직 받지만, 조건이 조금이라도 정교하면 반드시 filters 를 써라)`,
    input_schema: { type: 'object', properties: {
      filters: { type: 'array', description: '조건 목록(권장). 각 항목 {column, op, value, value2}', items: { type: 'object', properties: {
        column: { type: 'string', description: '★반드시 명단에 실제로 있는 칸 이름(예: 생년월일, 만기일, 가입일, 성별, 연소득, 월보험료, 보험사, 가입상품, 주소)' },
        op: { type: 'string', description: 'contains·equals·gte·lte·gt·lt·between·month·year·age_between·empty·not_empty' },
        value: { type: 'string', description: '비교할 값. month 면 1~12, age_between 이면 시작 나이' },
        value2: { type: 'string', description: 'between·age_between 의 끝 값' },
      }, required: ['column'] } },
      match: { type: 'string', description: '조건이 여럿일 때 AND(기본) 또는 OR' },
      column: { type: 'string', description: '(옛 방식) 필터할 컬럼명' },
      contains: { type: 'string', description: '(옛 방식) column에 포함될 값' },
      keyword: { type: 'string', description: '(옛 방식) 전체 컬럼 대상 키워드 검색' },
    } } },
  { name: 'sheet_read', description: '한 고객의 상세 정보 전체를 읽는다. 이름으로 조회.',
    input_schema: { type: 'object', properties: { name: { type: 'string', description: '고객 이름' } }, required: ['name'] } },
  { name: 'sheet_create', description: '신규 고객 1명을 명단에 추가한다. 대표 지시로 즉시 반영된다(승인 버튼 없음).',
    input_schema: { type: 'object', properties: { fields: { type: 'object', description: '항목:값 (예: {"이름":"이지혜","연락처":"010-1234-5678"})' } }, required: ['fields'] } },
  { name: 'sheet_update', description: '한 고객의 특정 항목을 수정한다. 대표 지시로 즉시 반영된다(승인 버튼 없음).',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, field: { type: 'string', description: '수정할 항목(예: 주소, 자녀수)' }, value: { type: 'string', description: '새 값' } }, required: ['name', 'field', 'value'] } },
  { name: 'sheet_delete', description: '한 고객을 명단에서 삭제한다. 되돌릴 수 없어 한 번 더 확인한다.',
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'sheet_add_column', description: '고객명단에 없는 새 항목(컬럼)을 맨 끝에 추가한다. 예) "결혼기념일 항목 추가해줘", "등록기념일 컬럼 만들어줘". 명단에 없는 항목은 값을 기록할 수 없으므로 먼저 이 도구로 항목을 만든다. 기존 항목·데이터는 건드리지 않는다. 대표 지시로 즉시 반영된다(승인 버튼 없음).',
    input_schema: { type: 'object', properties: { column: { type: 'string', description: '새로 만들 항목 이름(예: 결혼기념일)' } }, required: ['column'] } },
  { name: 'sheet_add_column_and_set', description: '명단에 없는 새 항목(컬럼)을 맨 끝에 만들고 특정 고객의 값까지 한 번에 기록한다. 예) "결혼기념일 추가하고 김철수 7월 27일 기록해줘". 승인 1회로 항목 생성과 값 기록을 함께 처리한다. ★이미 있는 항목이면 이 도구가 아니라 sheet_update를 쓴다. 대표 지시로 즉시 반영된다(승인 버튼 없음).',
    input_schema: { type: 'object', properties: { column: { type: 'string', description: '새로 만들 항목 이름' }, name: { type: 'string', description: '고객 이름' }, value: { type: 'string', description: '기록할 값(예: 7월 27일). 연도를 안 말했으면 그대로 넘기면 시스템이 올해로 채운다' } }, required: ['column', 'name', 'value'] } },
];
const READ_TOOLS = new Set(['sheet_list', 'sheet_search', 'sheet_read']);
const WRITE_OP = { sheet_create: 'create', sheet_update: 'update', sheet_delete: 'delete', sheet_add_column: 'add_column', sheet_add_column_and_set: 'add_column_set' };

function systemPrompt() {
  const 오늘 = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);  // 한국 날짜(사실)
  return `당신은 "지니야" — 대표님의 고객명단(구글 시트)을 돌보는 비서입니다.
[오늘 날짜] ${오늘} (한국 시간). "오늘"·"오늘 날짜로"라고 하면 이 값을 쓴다.
[핵심 능력 — 절대 "못 한다"고 말하지 마세요]
당신은 실제로 구글 시트를 다룰 수 있습니다: 시트 목록 조회(sheet_list), 명단 조회·검색(sheet_search/sheet_read), 추가·수정·삭제(sheet_create/update/delete). 예) "내 구글 시트에 어떤 시트들이 있어?" → sheet_list로 실제 목록 조회, "김철수 정보 알려줘" → sheet_read, "홍길동 주소 바꿔줘" → sheet_update 미리보기. 절대 "연동이 안 잡혀 있다/지어내는 게 된다/시트를 못 본다"고 답하지 마세요 — 도구로 실제 조회하세요.
${schemaHint()}[조건 검색 원칙 — ★어떤 조건이든 sheet_search 로 실행한다]
· 대표가 말한 조건은 ★반드시 filters 로 옮겨 담아 sheet_search 를 부른다. "그건 못 찾는다"는 말은 하지 않는다.
· ★어느 칸인지 반드시 지정한다. 명단에는 날짜 칸이 여럿이라(생년월일·가입일·만기일) 칸을 안 정하면 엉뚱한 게 섞인다.
  "생일이 8월" = 생년월일 칸의 month=8 이다. 만기일이 아니다.
· "몇 월"은 글자 찾기(-08-)가 아니라 op:"month" 로 한다. 숫자 크기 비교는 gte/lte, 기간은 between 을 쓴다.
· ★인원수는 네가 세지 않는다. 도구가 돌려준 count(전체건수) 를 그대로 말한다. matches 는 앞 30명 미리보기일 뿐이다.
· 답할 때 도구가 돌려준 '조건' 문장을 근거로 함께 밝힌다. 예) "생년월일이 8월인 분 10명이에요."
· 0명이면 "없어요"라고 정직하게 말한다. 조건을 몰래 바꿔 억지로 사람을 만들어내지 않는다.
· 칸 이름을 잘못 불러 오류가 오면, 함께 온 칸목록에서 맞는 칸을 골라 ★다시 부른다(포기하지 않는다).
[도구 사용 규칙]
1. 대표가 명단을 물으면(누구 정보·이번 주 만기 등) search_rows/read_row로 확인해 사실만 답한다. 지어내지 않는다. ★고객을 찾을 때 특정 컬럼('고객명' 등)에 한정하지 말고, 이름이 어느 컬럼에 있든 전체 데이터에서 검색한다(파일마다 컬럼명이 다를 수 있다: 고객명·이름·성명·Name·담당자 등).
2. 정보를 바꾸는 일(추가·수정·삭제)은 create_row/update_row/delete_row 도구를 부른다. 단, 실제 반영은 대표 승인 후에만 되며, 도구 호출은 "미리보기 준비"까지만이다.
3. 수정·삭제는 대상이 한 명으로 특정될 때만 도구를 부른다. 애매하면 먼저 되묻는다.
4. 삭제는 특히 신중히. 되돌릴 수 없음을 알린다.
4-1. ★내부 명단 수정(추가·수정·항목 만들기)은 ★대표 지시로 바로 반영된다. 승인 버튼을 요구하지 마라.
     "승인해 주세요"·"이대로 할까요?" 라고 되묻지 말고 도구를 불러 실행한 뒤, 무엇이 어떻게 바뀌었는지 사실대로 말한다.
     (되돌릴 수 없는 삭제만 예외로 한 번 더 확인한다)
4-2. ★값을 안 말했어도 되묻지 말고 진행한다 — 이런 일이 언제 있었는지가 곧 값이기 때문이다.
     "출산·이사·갱신완료·득남·결혼·입원·퇴사" 처럼 ★일어난 일(이벤트) 항목은 값을 안 주면 ★오늘 날짜를 넣는다.
     그 외 항목도 값이 없으면 'O' 로 표시한다. 넣은 값이 무엇인지는 반드시 말해 준다.
     ★날짜는 사실이므로 지어내는 것이 아니다. 다만 ★고객의 실제 정보(연락처·금액 등)는 절대 지어내지 않는다.
     예) "이영희 출산 항목 추가해" → sheet_add_column_and_set(column:'출산', name:'이영희', value: 오늘 날짜)
4-3. 대표가 "그냥 해"·"바로 해"·"승인 없이" 라고 하면 두말 말고 즉시 도구를 부른다.
5. 말투: 70대 어르신도 알아듣게 따뜻하고 쉽게. '클로드'·'AI' 같은 말은 쓰지 않는다. ★이모지·이모티콘(😊 📋 ⭐ 등)은 절대 쓰지 않는다(장식 기호 금지).
6. 항목 이름은 대표가 말한 대로 도구에 넘긴다(주소·연락처 등). 시스템이 실제 컬럼에 맞춰준다.
7. 선택지가 여럿이면 가장 알맞은 하나를 추천으로 명시하고("추천: ○○"), "회장님, 이걸로 진행할까요?"처럼 확인을 받는다. 없는 정보는 지어내지 않는다.
9. ★명단에 없는 항목도 만들 수 있다: 대표가 명단에 없는 항목(예: 결혼기념일·등록기념일)을 기록해 달라고 하면 "그런 항목이 없다"고 끝내지 말고 sheet_add_column(항목만) 또는 sheet_add_column_and_set(항목+값 한 번에)을 부른다. 항목은 명단 맨 끝에 추가되고 기존 항목·데이터는 그대로다. 비슷한 항목이 이미 있으면 시스템이 알려주니 그때는 기존 항목에 sheet_update로 기록하자고 제안한다.
8. ★★균형(거짓 완료·거짓 무능 둘 다 금지): 너는 시트 수정·추가·삭제를 실제로 할 수 있다 — "기능이 없다/연동 안 됐다/직접 하세요"라고 절대 말하지 마라. 수정 요청은 반드시 도구(update_row/create_row/delete_row)를 불러 미리보기를 만들고, 답은 "이렇게 바꿀까요? 승인하시면 반영합니다"로 물어라(아직 완료 아님 — 완료형 금지). 실제 반영은 대표 승인 후 시스템이 처리하며 그때 실값(전→후·시트 행)으로 보고한다. 대표가 "응/바꿔줘/승인"이라고 하면 승인으로 처리된다.`;
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

  // 🧾 3층: 칸 목록을 아직 한 번도 못 읽었으면(서버 부팅 후 첫 대화) 한 번만 읽어 둔다.
  //   두 번째부터는 기억하고 있어 추가 조회가 없다. 실패해도 대화는 그대로 진행한다.
  if (!_SCHEMA.header.length) { try { await loadTable(ma); } catch (e) {} }

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

      // ★내부 명단 수정은 대표 지시로 ★즉시 반영한다(2026-07-31 승인).
      //   되돌릴 수 있는 일(수정·추가·항목추가)만 해당. ★삭제는 되돌릴 수 없어 그대로 확인받는다.
      //   ★고객에게 나가는 발송은 이 모듈에 없다(approval_skill 하드가드 무접촉).
      if (op !== 'delete') {
        const done = await commit(ma, p.action, p.sig, { 즉시: true });
        trace.push({ commit: op, ok: done.ok });
        if (!done.ok) return { ok: true, reply: done.message || '반영하지 못했어요.', trace };
        // ★"됐다"는 말이 아니라 ★실제로 바뀐 값을 그대로 읽어 말한다(조용한 실패 차단).
        const rs = done.result || {};
        let reply;
        if (op === 'update') reply = `${rs.name}님 ${rs.항목}을(를) ${rs.기존값 ? `'${rs.기존값}' → ` : ''}'${rs.새값}' 로 바꿨어요. 바로 반영했습니다.`;
        else if (op === 'create') reply = `명단에 새로 추가했어요. 바로 반영했습니다.`;
        else reply = `'${rs.새항목}' 항목을 ${rs.새칸 === false ? '' : '새로 '}만들었어요.`
          + (rs.기록 ? ` ${rs.기록.대상}님 값은 '${rs.기록.값}' 로 넣었습니다.` : '')
          + ` 바로 반영했습니다.`;
        return { ok: true, reply, applied: rs, trace };
      }

      return { ok: true, reply: `삭제 미리보기예요. ${p.warning}\n아래 내용을 지울까요? 확인하시면 한 번 더 여쭤볼게요.`, pending: p, trace };
    }

    // 읽기 도구 → 즉시 실행하고 결과를 모델에 되돌려 대화 이어감
    conv.push({ role: 'assistant', content: r.content });
    const results = [];
    for (const t of toolUses) {
      let out;
      if (t.name === 'sheet_search') out = await doSearch(ma, t.input || {});
      else if (t.name === 'sheet_read') out = await doRead(ma, t.input || {});
      else if (t.name === 'sheet_list') out = await doListSheets(ma);
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
  setSource, isFilming,   // 🎬 촬영 모드 훅(평소 미사용)
  runChat, commit,
  // 하위 유닛(엔드포인트/테스트용)
  doSearch, doRead, doListSheets, planWrite,
  loadTable, resolveColumn, detectNameCol, signAction, verifyAction,
  findByName, suggestNames, nameSimilarity, toJamo, TOOLS,
  // 🔪 1층 조건 필터 엔진 + 🧾 3층 칸 목록 (단위시험용 · 동작은 doSearch/systemPrompt 안에서만 쓴다)
  schemaHint, systemPrompt,
  _filter: { toNum: _toNum, toDate: _toDate, age: _age, prep: _prepFilter, match: _matchOne, describe: _describe, todayKST: _todayKST, shapeOf: _shapeOf },
  // 🆕 컬럼 추가 보조(내보내기만 추가 · 동작 변경 없음). 단위테스트와 재사용용.
  findSimilarColumn, colLetter,
  _internals: { normValue: _normValue, planColumn: _planColumn, ensureGridWidth: _ensureGridWidth, normCol: _normCol },
};
