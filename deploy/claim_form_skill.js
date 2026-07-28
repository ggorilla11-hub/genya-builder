// ─────────────────────────────────────────────────────────────
// claim_form_skill.js — 🩹 보상비서 1단계: 삼성화재 보험금 청구서 자동 입력 (독립 모듈)
//
// 무엇을·왜: 고객 명단(마스터 시트)에서 고객 1명을 골라, 삼성화재 보험금 청구서의
//   "시트로 채울 수 있는 칸"만 자동으로 채우고, 나머지는 정직하게 "증빙에서 입력 필요"로 남긴다.
//   → 대표님이 청구서를 손으로 처음부터 쓰던 일이 "절반은 이미 채워진 상태"로 시작된다.
//
// ★절대 원칙 (이 파일이 지키는 것)
//   1) 제로 저장 — PDF를 디스크에 쓰지 않는다. 메모리 Buffer로 만들어 그대로 반환한다.
//      (main_server.js:2584 "SKILL_OUT은 개인정보 금지구역" 원칙 준수 — 이 모듈은 fs 쓰기가 아예 없다)
//   2) 지어내기 금지 — 시트에 없는 값은 절대 만들지 않는다. 빈칸은 빈칸이라고 적는다.
//   3) 로그에 값 금지 — 이름·계좌·연락처를 console에 찍지 않는다.
//   4) 기존 기능 무접촉 — 이 파일은 아무것도 수정하지 않는다. 읽기(loadTable 결과)만 받는다.
//
// 사용: const claim = require('./claim_form_skill');
//        const r = claim.buildClaim(table, '김철수');       // table = sheets_crud_skill.loadTable() 결과
//        const buf = await claim.renderClaimPdf(r);         // Buffer (디스크 0)
//
// 1단계 범위: 삼성화재 청구서 1개 양식 · 마스터 시트에서 채우는 필드만 · PDF 생성/미리보기.
//
// ★2차 지시(2026-07-29) — 자동채움 + 부족분 대화입력 + 명단 동시 업데이트
//   【1】 매핑 확장: 이메일 · (참고)보험사·증권번호
//   【2】 부족분을 지니야가 먼저 안내 ("명단 없어서 못 한다" 딴소리 금지 — 못 찾아도 틀은 만든다)
//   【3】 말/텍스트로 부족분 입력 → 명단 저장 + 청구서 반영 동시
//
//   ★★민감정보 분리 (대표님 결정 2026-07-29 · A안)
//     · 시트에 저장 O — 계좌은행·계좌번호·이메일·직업·연락처·보험사·증권번호 (다음에도 쓰는 정보)
//     · 시트에 저장 X — 주민등록번호·진단명·질병분류기호·병원명·사고일
//       → 지금 만드는 청구서 한 장에만 쓰고 버린다(화면 메모리에만 · 새로고침하면 사라짐).
//       → 서버·시트 어디에도 안 남는다. 사고가 나도 유출될 것이 없다.
// ─────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// ── 한글 폰트: OS별 후보 탐색(Windows 로컬 + 리눅스 배포). 없으면 기본폰트 폴백(크래시 방지) ──
//   pdf_skill.js와 같은 후보군. 그 파일을 수정하지 않기 위해 여기 독립적으로 둔다(무접촉 원칙).
function krFont() {
  const cands = [
    process.env.KR_FONT_PATH,
    'C:\\Windows\\Fonts\\malgun.ttf',
    '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJKkr-Regular.otf',
    path.join(__dirname, 'fonts', 'NanumGothic.ttf'),
  ].filter(Boolean);
  for (const p of cands) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 1. 양식 정의 — 삼성화재 보험금 청구서 4섹션
// ═══════════════════════════════════════════════════════════════
// src(출처) 종류:
//   'sheet' = 마스터 시트에서 채움(cands = 찾을 컬럼 이름 후보, 앞이 우선)
//   'fixed' = 기본값 고정(지시: 안내방법=문자메시지 · 청구유형=최초청구)
//   'proof' = 증빙(진단서·신분증)에서 확인해야 하는 칸. 대화로 받되 ★시트엔 저장하지 않는다.
//   'hand'  = 사람이 직접 손으로 쓰는 칸(서명·날짜)
// save: 'sheet' = 대화로 받으면 명단에도 저장(재사용 정보) · 'claim' = 이 청구서에만 쓰고 버림(민감정보)
// ref:  true    = 참고 표시용(청구 칸이 아니라 "어느 계약인지" 확인용)
const FORM = [
  {
    no: 1, title: '인적사항',
    fields: [
      { label: '피보험자 성명', src: 'sheet', save: 'sheet', cands: ['고객명', '이름', '성명', '성함', 'name'] },
      { label: '주민등록번호', src: 'proof', save: 'claim', why: '신분증에서 확인(민감정보)' },
      { label: '직업(직장명)', src: 'sheet', save: 'sheet', cands: ['직업', '직장명', '직장', '직종', '하는일', 'job'] },
      { label: '휴대폰', src: 'sheet', save: 'sheet', cands: ['연락처', '휴대폰', '핸드폰', '전화번호', '전화', 'phone', 'mobile', 'hp'] },
      { label: '이메일', src: 'sheet', save: 'sheet', cands: ['이메일', '메일', 'email', 'e-mail'] },
      { label: '보험계약자 성명', src: 'sheet', save: 'sheet', cands: ['고객명', '이름', '성명', '성함', 'name'] },
      { label: '보험사(참고)', src: 'sheet', save: 'sheet', ref: true, cands: ['보험사', '보험회사', '회사', 'insurer'] },
      { label: '증권번호(참고)', src: 'sheet', save: 'sheet', ref: true, cands: ['증권번호', '증권', '계약번호', 'policy'] },
    ],
  },
  {
    no: 2, title: '사고사항',
    fields: [
      { label: '청구유형', src: 'fixed', value: '최초청구' },
      { label: '사고일(발병일)', src: 'proof', save: 'claim', why: '진단서·영수증에서 확인' },
      { label: '진단명', src: 'proof', save: 'claim', why: '진단서에서 확인' },
      { label: '질병분류기호', src: 'proof', save: 'claim', why: '진단서(KCD 코드)에서 확인' },
      { label: '병원명', src: 'proof', save: 'claim', why: '진단서·영수증에서 확인' },
    ],
  },
  {
    no: 3, title: '보험금 수령 계좌',
    fields: [
      { label: '은행', src: 'sheet', save: 'sheet', cands: ['계좌은행', '은행', '은행명', '거래은행', '수령은행', 'bank'] },
      { label: '계좌번호', src: 'sheet', save: 'sheet', cands: ['계좌번호', '계좌', '입금계좌', 'account'] },
      { label: '예금주', src: 'sheet', save: 'sheet', cands: ['고객명', '이름', '성명', '성함', 'name'] },
      { label: '안내방법', src: 'fixed', value: '문자메시지' },
    ],
  },
  {
    no: 4, title: '청구인 확인·서명',
    fields: [
      { label: '청구인 성명', src: 'sheet', save: 'sheet', cands: ['고객명', '이름', '성명', '성함', 'name'] },
      { label: '청구일자', src: 'hand', why: '서명하는 날 직접 기재' },
      { label: '청구인 서명', src: 'hand', why: '고객 자필 서명 (인)' },
    ],
  },
];

/** 이 칸을 대화로 받았을 때 명단 시트에 저장해도 되는가 (민감정보는 false) */
function savesToSheet(label) {
  for (const s of FORM) for (const f of s.fields) if (f.label === label) return f.save === 'sheet';
  return false;
}
/** 이 칸을 시트에 쓸 때 쓸 컬럼 이름(대표 후보) */
function sheetColFor(label) {
  for (const s of FORM) for (const f of s.fields) if (f.label === label) return (f.cands || [])[0] || null;
  return null;
}

const NEED_MARK = '증빙에서 입력 필요';   // ★지시 문구 그대로. 지어내기 대신 이 표시를 남긴다.
const HAND_MARK = '직접 기재';

// ═══════════════════════════════════════════════════════════════
// 2. 컬럼 찾기 — 정확 일치 먼저, 그다음 부분 일치(이미 쓴 컬럼은 제외)
// ═══════════════════════════════════════════════════════════════
// 왜 이 순서인가: '계좌'라는 헤더가 있을 때 부분일치를 먼저 하면 '은행' 칸이 '계좌'를 집어간다.
//   전 필드에 대해 "정확 일치"를 먼저 한 바퀴 돌린 뒤에야 부분 일치를 허용한다.
function norm(x) { return String(x == null ? '' : x).trim().toLowerCase().replace(/\s+/g, ''); }

/** 헤더 배열에서 후보 이름들에 맞는 실제 컬럼명을 찾는다. exactOnly=true면 정확 일치만. */
function pickCol(header, cands, used, exactOnly) {
  const H = (header || []).map((h) => ({ raw: h, n: norm(h) }));
  for (const c of cands) {                                   // 1) 정확 일치 (후보 우선순위 순)
    const nc = norm(c);
    const hit = H.find((h) => h.n === nc);
    if (hit) return hit.raw;
  }
  if (exactOnly) return null;
  for (const c of cands) {                                   // 2) 부분 일치 (다른 필드가 안 쓴 컬럼만)
    const nc = norm(c);
    const hit = H.find((h) => h.n && !used.has(h.raw) && (h.n === nc || h.n.includes(nc) || nc.includes(h.n)));
    if (hit) return hit.raw;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 3. 이름으로 고객 1명 찾기
// ═══════════════════════════════════════════════════════════════
// 정확 일치 우선 → 없으면 부분 일치. 여러 명이면 고르라고 되묻는다(엉뚱한 사람 청구서 방지).
// ★"명단 없어서 못 한다" 딴소리 금지(2차 지시) — 명단에 없어도 청구서 틀은 만들고,
//   "명단에 없는 분"이라고 정직히 알린 뒤 대화로 채우게 한다. 없는 값을 지어내지는 않는다.
function findCustomer(table, name) {
  const n = norm(name);
  if (!n) return { error: '고객 이름을 알려주세요. 예: "김철수 청구서 만들어"' };
  const rows = (table && table.rows) || [];
  const nameCol = (table && table.nameCol) || ((table && table.header) || [])[0] || '고객명';
  const val = (r) => norm(r[nameCol]);
  let hit = rows.filter((r) => val(r) === n);                        // 정확 일치
  if (!hit.length) hit = rows.filter((r) => val(r) && val(r).includes(n)); // 부분 일치
  if (hit.length > 1) {
    return { error: `"${name}"으로 ${hit.length}명이 찾아져요. 한 분을 정확히 지정해 주세요.`,
             candidates: hit.slice(0, 10).map((r) => String(r[nameCol] || '')) };
  }
  if (!hit.length) {
    // 틀은 만든다(빈 행). 비슷한 이름이 있으면 같이 알려 오타를 잡아준다.
    const near = rows.map((r) => String(r[nameCol] || '')).filter((v) => v && (norm(v)[0] === n[0] || norm(v).includes(n.slice(0, 1)))).slice(0, 5);
    return { row: {}, nameCol, notFound: true, near: near };
  }
  return { row: hit[0], nameCol };
}

// ═══════════════════════════════════════════════════════════════
// 4. 청구서 채우기 (핵심)
// ═══════════════════════════════════════════════════════════════
/**
 * @param {object} table  sheets_crud_skill.loadTable() 결과 {header, rows, nameCol}
 * @param {string} name   고객 이름
 * @param {object} extras 대화로 방금 받은 값 {라벨: 값} — ★민감정보는 여기로만 오고 시트엔 안 간다
 * @returns {{ok:boolean, 고객명?:string, sections?:Array, 통계?:object, 안내문?:string, error?:string}}
 *   각 field = { label, value, status, why, from }
 *     status: 'filled'(채움) · 'need'(입력 필요) · 'hand'(직접 기재)
 *     from:   'sheet'(명단) · 'fixed'(기본값) · 'said'(방금 말씀하신 값)
 */
function buildClaim(table, name, extras) {
  extras = extras || {};
  const found = findCustomer(table, name);
  if (found.error) return { ok: false, error: found.error, candidates: found.candidates };
  const row = found.row;
  const header = (table && table.header) || [];

  // ── 컬럼 매핑: 전 필드 "정확 일치" 한 바퀴 → 남은 것만 "부분 일치" 한 바퀴 ──
  const used = new Set();
  const colOf = new Map();      // fieldKey → 실제 컬럼명(없으면 null)
  const sheetFields = [];
  FORM.forEach((sec) => sec.fields.forEach((f) => { if (f.src === 'sheet') sheetFields.push(sec.no + '|' + f.label); }));
  const specOf = (key) => {
    const [no, label] = key.split('|');
    const sec = FORM.find((s) => String(s.no) === no);
    return sec.fields.find((f) => f.label === label);
  };
  for (const key of sheetFields) {                          // 1차: 정확 일치
    const c = pickCol(header, specOf(key).cands, used, true);
    colOf.set(key, c || null); if (c) used.add(c);
  }
  for (const key of sheetFields) {                          // 2차: 부분 일치(빈 것만)
    if (colOf.get(key)) continue;
    const c = pickCol(header, specOf(key).cands, used, false);
    colOf.set(key, c || null); if (c) used.add(c);
  }

  // ── 값 채우기 ──
  //   우선순위: ①방금 말씀하신 값(extras) → ②명단 시트 → ③기본값 → ④빈칸(정직 표시)
  const said = (label) => { const v = extras[label]; return v == null ? '' : String(v).trim(); };
  const sections = FORM.map((sec) => ({
    no: sec.no, title: sec.title,
    fields: sec.fields.map((f) => {
      const base = { label: f.label, ref: !!f.ref };
      const s = said(f.label);
      if (s) return Object.assign(base, { value: s, status: 'filled', from: 'said', why: '방금 말씀하신 값' });
      if (f.src === 'fixed') return Object.assign(base, { value: f.value, status: 'filled', from: 'fixed', why: '기본값' });
      if (f.src === 'hand') return Object.assign(base, { value: '', status: 'hand', why: f.why });
      if (f.src === 'proof') return Object.assign(base, { value: '', status: 'need', why: f.why });
      // src === 'sheet'
      const col = colOf.get(sec.no + '|' + f.label);
      if (!col) return Object.assign(base, { value: '', status: 'need', why: `명단에 [${f.cands[0]}] 칸이 없어요` });
      const v = String(row[col] == null ? '' : row[col]).trim();
      if (!v) return Object.assign(base, { value: '', status: 'need', why: `명단 [${col}] 값이 비어 있어요` });
      return Object.assign(base, { value: v, status: 'filled', from: 'sheet', why: `명단 [${col}]` });
    }),
  }));

  const all = sections.reduce((a, s) => a.concat(s.fields), []);
  // ★읽은 칸 = 쓸 칸. 이 지도를 planSay가 그대로 써야 "저장은 됐는데 청구서엔 안 뜨는" 어긋남이 안 생긴다.
  const colMap = {};
  FORM.forEach((sec) => sec.fields.forEach((f) => { if (f.src === 'sheet') colMap[f.label] = colOf.get(sec.no + '|' + f.label) || null; }));
  const 고객명 = String(row[found.nameCol] || name).trim();
  const 채움 = all.filter((f) => f.status === 'filled' && f.from !== 'fixed');
  const 부족 = all.filter((f) => f.status === 'need');

  // ── 【2】 부족분 안내 — 지니야가 먼저 말한다. "명단 없어서 못 한다" 딴소리 금지 ──
  const 짧게 = (l) => l.replace(/\(.*?\)/g, '').replace(/^피보험자 /, '').replace(/^보험계약자 /, '계약자 ').trim();
  let 안내문 = `${고객명}님 청구서 1차 작성했어요.\n`;
  if (found.notFound) {
    안내문 = `${고객명}님은 명단에 없어서 빈 청구서 틀로 시작했어요.`
      + (found.near && found.near.length ? ` (명단에 있는 비슷한 이름: ${found.near.join(', ')})` : '')
      + '\n';
  }
  안내문 += `✅ 채워짐: ${채움.length ? 채움.map((f) => 짧게(f.label)).join('·') : '(아직 없음)'}\n`;
  안내문 += `⬜ 부족: ${부족.length ? 부족.map((f) => 짧게(f.label)).join('·') : '(없음 — 다 채웠어요)'}\n`;
  안내문 += 부족.length ? '부족한 걸 알려주시면 채우겠습니다.' : '이제 PDF로 뽑으시면 됩니다.';

  return {
    ok: true,
    고객명,
    notFound: !!found.notFound,
    near: found.near || [],
    rowNum: row._rowNum || null,        // 시트 저장용 행번호(명단에 있을 때만)
    colMap,                             // 청구서 칸 → 실제 시트 컬럼(없으면 null)
    sections,
    안내문,
    부족목록: 부족.map((f) => f.label),
    통계: {
      전체: all.length,
      자동입력: all.filter((f) => f.status === 'filled').length,
      입력필요: 부족.length,
      직접기재: all.filter((f) => f.status === 'hand').length,
    },
    안내: '지니야가 명단으로 채운 초안입니다. ★제출 전 반드시 검토하시고, 빈칸은 증빙을 보고 채워 주세요.',
  };
}

// ═══════════════════════════════════════════════════════════════
// 5. 【3】 말/텍스트로 부족분 입력 → 어느 칸에 무슨 값인지 읽어낸다
// ═══════════════════════════════════════════════════════════════
// ★규칙 기반(결정적) — AI 추측을 쓰지 않는다. 확실할 때만 채우고, 모르면 되묻는다(환각 금지).
//   예: "홍길동 계좌번호 국민 123-456이야" → 은행=국민은행 · 계좌번호=123-456

const BANKS = ['국민', 'KB국민', '신한', '우리', '하나', '농협', 'NH농협', '기업', 'IBK기업', '카카오뱅크', '카카오',
  '토스뱅크', '토스', '케이뱅크', '새마을금고', '새마을', '우체국', '수협', '산업', 'SC제일', '씨티', '한국씨티',
  '부산', '대구', '경남', '광주', '전북', '제주', '신협'];
const INSURERS = ['삼성화재', '현대해상', 'DB손해보험', 'DB손보', 'KB손해보험', 'KB손보', '메리츠화재', '메리츠',
  '한화손해보험', '한화손보', '롯데손해보험', '롯데손보', '흥국화재', 'MG손해보험', 'NH농협손해보험', '농협손보',
  '삼성생명', '한화생명', '교보생명', '신한라이프', '동양생명', 'ABL생명', 'KB라이프', '흥국생명', 'NH농협생명'];

/** 날짜 문자열 → YYYY-MM-DD (못 읽으면 null · 지어내지 않음) */
function _date(txt) {
  let m = txt.match(/(20\d{2})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})\s*일?/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = txt.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return `(연도확인)${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`; // ★연도는 지어내지 않는다
  return null;
}

/**
 * 자연어 한 줄 → 채울 칸들. 확실한 것만 담는다.
 * @returns {{fields:Array<{label,value,save}>, unknown:boolean}}
 */
function parseSay(text) {
  const t = String(text || '').trim();
  const out = [];
  const push = (label, value) => {
    if (!value) return;
    if (out.some((o) => o.label === label)) return;
    out.push({ label, value: String(value).trim(), save: savesToSheet(label) ? 'sheet' : 'claim' });
  };
  let rest = ' ' + t + ' ';
  const eat = (re) => { const m = rest.match(re); if (m) { rest = rest.replace(m[0], ' '); return m; } return null; };

  // 1) 이메일
  let m = eat(/[\w.+-]+@[\w-]+\.[\w.]{2,}/);
  if (m) push('이메일', m[0]);

  // 2) 주민등록번호 (6자리-7자리) — ★시트에 저장 안 하는 값
  m = eat(/\b(\d{6})\s*[-–]\s*(\d{7})\b/);
  if (m) push('주민등록번호', m[1] + '-' + m[2]);

  // 3) 휴대폰
  m = eat(/\b(01[016789])[-.\s]?(\d{3,4})[-.\s]?(\d{4})\b/);
  if (m) push('휴대폰', `${m[1]}-${m[2]}-${m[3]}`);

  // 4) 질병분류기호(KCD: 영문1 + 숫자2 [+ .숫자])
  m = eat(/\b([A-Z]\d{2}(?:\.\d{1,2})?)\b/);
  if (m) push('질병분류기호', m[1]);

  // 5) 은행 (계좌 문맥일 때만 — "국민연금" 같은 오인 방지는 은행명 목록으로 제한)
  for (const b of BANKS) {
    const i = rest.indexOf(b);
    if (i >= 0 && /계좌|은행|입금|송금/.test(t)) { push('은행', /은행|뱅크|금고|우체국|신협/.test(b) ? b : b + '은행'); rest = rest.slice(0, i) + ' ' + rest.slice(i + b.length); break; }
  }

  // 6) 보험사
  for (const s of INSURERS) if (rest.indexOf(s) >= 0) { push('보험사(참고)', s); rest = rest.replace(s, ' '); break; }

  // 7) 사고일 — 날짜 말이 나왔을 때만
  if (/사고|발병|다친|진단받|입원|수술|아프|날짜|일자/.test(t)) { const d = _date(rest); if (d) { push('사고일(발병일)', d); rest = rest.replace(/(20\d{2})?\s*[\d.\-\/년월일\s]{4,}/, ' '); } }

  // 8) 증권번호 — '증권' 뒤의 영숫자 덩어리
  m = eat(/증권\s*(?:번호)?\s*[은는이가:]?\s*([A-Za-z0-9][A-Za-z0-9-]{4,})/);
  if (m) push('증권번호(참고)', m[1]);

  // 9) 계좌번호 — 남은 것 중 숫자 6개 이상인 덩어리 (위에서 주민번호·전화는 이미 빼냄)
  if (/계좌|입금|송금|번호/.test(t)) {
    m = eat(/\b(\d[\d\s.\-]{4,}\d)\b/);
    if (m && (m[1].replace(/\D/g, '').length >= 6)) push('계좌번호', m[1].replace(/\s/g, ''));
  }

  // 10) 병원명
  m = eat(/([가-힣A-Za-z0-9]{2,20}(?:병원|의원|의료원|보건소))/);
  if (m) push('병원명', m[1]);

  // 11) 진단명 — 키워드 뒤 문구
  m = eat(/(?:진단명|병명|진단은|진단이|진단)\s*[은는이가:]?\s*([가-힣A-Za-z0-9()\s]{2,30}?)\s*(?:이야|이에요|예요|입니다|이고|랑|이랑|[,.]|$)/);
  if (m && m[1].trim()) push('진단명', m[1]);

  // 12) 직업
  m = eat(/(?:직업|직장명|직장|하는\s*일|직종)\s*[은는이가:]?\s*([가-힣A-Za-z0-9()\s]{1,20}?)\s*(?:이야|이에요|예요|입니다|이고|랑|이랑|[,.]|$)/);
  if (m && m[1].trim()) push('직업(직장명)', m[1]);

  return { fields: out, unknown: out.length === 0 };
}

/**
 * 말로 받은 값들을 어디에 넣을지 결정한다 (순수 함수 · 시트를 건드리지 않음 · 시험 가능).
 *   toSheet      = 명단에 저장할 것 (빈칸이라 자율로 채워도 되는 것)
 *   toClaim      = 청구서에만 쓸 것 (민감정보 · 명단에 없는 고객 · 시트 저장 대상 아님)
 *   needsConfirm = 이미 값이 있어 덮어써야 하는 것 → ★자율로 지우지 않고 되묻는다
 *   same         = 이미 같은 값이라 할 일 없음
 * @param {Array} fields  parseSay().fields
 * @param {object} claim  buildClaim() 결과 (colMap·rowNum 사용)
 * @param {object} row    명단에서 찾은 그 고객의 행 (없으면 {})
 */
function planSay(fields, claim, row) {
  row = row || {};
  const toSheet = [], toClaim = [], needsConfirm = [], same = [];
  (fields || []).forEach((f) => {
    if (f.save !== 'sheet') { toClaim.push({ label: f.label, value: f.value, 사유: '민감정보 — 명단에 저장하지 않음' }); return; }
    if (!claim || !claim.rowNum) { toClaim.push({ label: f.label, value: f.value, 사유: '명단에 없는 분이라 청구서에만 반영' }); return; }
    const col = (claim.colMap || {})[f.label] || null;
    const 기존 = col ? String(row[col] == null ? '' : row[col]).trim() : '';
    if (기존 && 기존 === f.value) { same.push({ label: f.label, column: col, value: f.value }); return; }
    if (기존) { needsConfirm.push({ 항목: f.label, 컬럼: col, 기존값: 기존, 새값: f.value }); return; }
    toSheet.push({ label: f.label, value: f.value, column: col || sheetColFor(f.label), op: col ? 'update' : 'add_column_set', before: '' });
  });
  return { toSheet, toClaim, needsConfirm, same };
}

// ═══════════════════════════════════════════════════════════════
// 7. PDF 생성 — ★메모리 Buffer로만. 디스크에 쓰지 않는다(제로 저장)
// ═══════════════════════════════════════════════════════════════
const NAVY = '#0B1F3A', LINE = '#C9D2DE', GREY = '#8A93A0', RED = '#C0392B', INK = '#1A1C1E', BAND = '#EEF2F7';

/** @param {object} claim buildClaim() 결과 → @returns {Promise<Buffer>} */
function renderClaimPdf(claim) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: '보험금 청구서', Author: '지니야' } });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));   // ★파일 저장 없음 — 메모리에서 바로 Buffer
      doc.on('error', reject);

      const f = krFont();
      if (f) { try { doc.registerFont('KR', f); doc.font('KR'); } catch (e) {} } // 폰트 없으면 기본폰트(크래시 방지)

      const L = doc.page.margins.left;
      const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const LBL = 118;              // 라벨 칸 너비
      const RH = 24;                // 한 줄 높이

      // ── 머리글 ──
      doc.fontSize(19).fillColor(NAVY).text('보험금 청구서', L, doc.y, { width: W, align: 'center' });
      doc.moveDown(0.25);
      doc.fontSize(10).fillColor(GREY).text('삼성화재해상보험 · 지니야 자동 입력 초안', { width: W, align: 'center' });
      doc.moveDown(0.15);
      doc.fontSize(9).fillColor(RED)
         .text('★제출 전 반드시 검토하세요 — 빈칸은 증빙을 보고 직접 채워 주십시오.', { width: W, align: 'center' });
      doc.moveDown(0.8);

      let y = doc.y;
      const nl = () => { if (y > doc.page.height - doc.page.margins.bottom - RH * 3) { doc.addPage(); y = doc.page.margins.top; } };

      // ── 섹션별 표 ──
      (claim.sections || []).forEach((sec) => {
        nl();
        doc.rect(L, y, W, RH).fill(NAVY);                                    // 섹션 머리띠
        doc.fillColor('#FFFFFF').fontSize(11).text(`${sec.no}. ${sec.title}`, L + 8, y + 7, { width: W - 16 });
        y += RH;

        (sec.fields || []).forEach((fd) => {
          nl();
          doc.rect(L, y, LBL, RH).fillAndStroke(BAND, LINE);                 // 라벨 칸
          doc.rect(L + LBL, y, W - LBL, RH).stroke(LINE);                    // 값 칸
          doc.fillColor(INK).fontSize(9.5).text(fd.label, L + 7, y + 7.5, { width: LBL - 12, ellipsis: true });
          if (fd.status === 'filled') {
            doc.fillColor(INK).fontSize(10.5).text(String(fd.value || ''), L + LBL + 9, y + 7, { width: W - LBL - 18, ellipsis: true });
          } else if (fd.status === 'hand') {
            doc.fillColor(GREY).fontSize(9.5).text(`(${HAND_MARK})`, L + LBL + 9, y + 7.5, { width: W - LBL - 18 });
          } else {
            doc.fillColor(RED).fontSize(9.5).text(`☐ ${NEED_MARK}`, L + LBL + 9, y + 7.5, { width: W - LBL - 18 });
          }
          y += RH;
        });
        y += 10;
      });

      // ── 꼬리말 ──
      nl();
      y += 4;
      doc.fontSize(8.5).fillColor(GREY).text(
        '본 청구서는 지니야가 고객 명단 정보로 자동 입력한 초안입니다. 진단명·질병분류기호·사고일·병원명·주민등록번호는 '
        + '증빙서류(진단서·영수증·신분증)를 확인하여 직접 기재해 주십시오. 최종 확인·서명은 청구인 본인이 합니다.',
        L, y, { width: W, lineGap: 2 });

      doc.end();
    } catch (e) { reject(e); }
  });
}

module.exports = {
  buildClaim, renderClaimPdf, parseSay, planSay, savesToSheet, sheetColFor,
  FORM, NEED_MARK, _pickCol: pickCol, _findCustomer: findCustomer,
};
