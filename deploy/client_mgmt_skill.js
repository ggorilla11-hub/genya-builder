// ─────────────────────────────────────────────────────────────
// client_mgmt_skill.js — 📇 고객관리비서 · 관리-1(엑셀 리딩·있는것만 시작) + 관리-2(오늘 이벤트 대시보드)
// 무엇을·왜: 엑셀 헤더 진단→부족 리딩 + "있는 항목으로 가능한 관리" 판별. 대시보드는 실제 날짜 비교로
//   오늘 생일·이번주 만기·소개 적기 등을 결정적으로 계산(LLM 지어내기 0). 초안은 승인용 템플릿.
// ★Zero data ingress: 버퍼로만 파싱(디스크 저장 0). 대시보드 표시엔 주민번호 마스킹(전화는 연락용).
// 사용: analyzeManagement({file,headers}) / buildDashboard({file, today:'YYYY-MM-DD'})
// ─────────────────────────────────────────────────────────────
'use strict';
const XLSX = require('xlsx');

const STD = {
  기본: [
    { 항목: '이름', kw: ['이름', '성명', '고객명', 'name'], 영향: '고객 식별' },
    { 항목: '전화', kw: ['전화', '휴대폰', '핸드폰', '연락처', 'phone', 'tel', 'hp', 'mobile'], 영향: '연락' },
    { 항목: '이메일', kw: ['이메일', '메일', 'email', 'mail'], 영향: '이메일 안내' },
    { 항목: '생일', kw: ['생일', '생년', '생년월일', '출생', 'birth', 'dob'], 영향: '생일 관리' },
  ],
  핵심: [
    { 항목: '체결일', kw: ['체결', '계약일', '가입일', '청약'], 영향: '계약 히스토리·소개 타이밍' },
    { 항목: '만기·갱신일', kw: ['만기', '갱신', '만료', '재계약', 'expire', 'renew', 'maturity'], 영향: '만기·갱신 관리' },
    { 항목: '가입상품·보장', kw: ['상품', '보장', '담보', '증권', '플랜', 'product', 'plan'], 영향: '보장분석·업셀' },
    { 항목: '월납료', kw: ['월납', '보험료', '납입', '월보험', 'premium'], 영향: '유지·해지방어' },
    { 항목: '가족사항', kw: ['가족', '배우자', '자녀', '부양', 'family'], 영향: '가족 니즈·소개' },
  ],
  관계: [
    { 항목: '최근상담일', kw: ['상담일', '최근상담', '접촉', '미팅', '최근연락', '만난'], 영향: '접촉 주기 관리' },
    { 항목: '관심분야', kw: ['관심', '니즈', 'interest', 'needs'], 영향: '맞춤 제안' },
    { 항목: '특이사항', kw: ['특이', '메모', '비고', '참고', 'note', 'memo', 'remark'], 영향: '개인화 응대' },
    { 항목: '고객등급', kw: ['등급', 'vip', 'grade', 'tier', '우량'], 영향: '우선순위 관리' },
  ],
};
// 필드 키워드(대시보드 매핑용)
const FIELD_KW = {
  이름: STD.기본[0].kw, 전화: STD.기본[1].kw, 이메일: STD.기본[2].kw, 생일: STD.기본[3].kw,
  체결일: STD.핵심[0].kw, 만기: STD.핵심[1].kw, 상품: STD.핵심[2].kw, 월납료: STD.핵심[3].kw, 가족: STD.핵심[4].kw,
  최근상담: STD.관계[0].kw, 관심: STD.관계[1].kw, 특이: STD.관계[2].kw, 등급: STD.관계[3].kw,
};
function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\s·\-_()\/.]/g, ''); }
function hasKw(headers, kw) { const H = (headers || []).map(norm); return kw.some((k) => { const nk = norm(k); return H.some((h) => h.indexOf(nk) >= 0); }); }
function mapFields(headers) { const m = {}; (headers || []).forEach((h, i) => { const nh = norm(h); Object.keys(FIELD_KW).forEach((f) => { if (m[f] == null && FIELD_KW[f].some((k) => nh.indexOf(norm(k)) >= 0)) m[f] = i; }); }); return m; }

// 버퍼 → {headers, rows(array-of-arrays)}. CSV=수동 UTF-8, xlsx(zip)=XLSX.read(cellDates)
function readSheet(b64) {
  const buf = Buffer.from(String(b64 || ''), 'base64');
  const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4B;
  if (!isZip) {
    const txt = buf.toString('utf8').replace(/^﻿/, '');
    const lines = txt.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length) {
      const sep = ((lines[0].match(/\t/g) || []).length > (lines[0].match(/,/g) || []).length) ? '\t' : ',';
      const rows = lines.map((l) => l.split(sep).map((s) => s.trim().replace(/^"|"$/g, '')));
      const headers = rows[0].filter(Boolean);
      if (headers.length) return { headers: rows[0], rows: rows.slice(1) };
    }
  }
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  return { headers: (aoa[0] || []).map((x) => String(x == null ? '' : x).trim()), rows: aoa.slice(1).filter((r) => (r || []).some((c) => String(c == null ? '' : c).trim())) };
}
function readHeaders(b64) { const s = readSheet(b64); return { headers: s.headers.filter(Boolean), rowCount: s.rows.length }; }

// ── 날짜 파싱·계산(결정적) ──
function nowYMD() { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; }
function parseToday(s) { const m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
function parseYMD(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  const s = String(v).trim(); let m;
  if ((m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/))) return { y: +m[1], m: +m[2], d: +m[3] };
  if ((m = s.match(/^(\d{2})\D+(\d{1,2})\D+(\d{1,2})$/))) return { y: 2000 + +m[1], m: +m[2], d: +m[3] };
  if ((m = s.match(/^(\d{1,2})\D+(\d{1,2})$/))) return { y: null, m: +m[1], d: +m[2] }; // 월/일(생일)
  return null;
}
function daysUntil(ymd, t) { if (!ymd || !ymd.y) return null; return Math.round((Date.UTC(ymd.y, ymd.m - 1, ymd.d) - Date.UTC(t.y, t.m - 1, t.d)) / 86400000); }
function daysUntilAnnual(ymd, t) { if (!ymd) return null; let b = Date.UTC(t.y, ymd.m - 1, ymd.d); const a = Date.UTC(t.y, t.m - 1, t.d); if (b < a) b = Date.UTC(t.y + 1, ymd.m - 1, ymd.d); return Math.round((b - a) / 86400000); }

/** 관리-1: 헤더 진단 → 부족 리딩 + "있는 항목으로 가능한 관리/잠긴 관리" (강제 X, 즉시 시작 가능) */
function analyzeManagement(input) {
  input = input || {};
  let headers = input.headers, rowCount = input.rowCount || 0;
  if ((!headers || !headers.length) && input.file) {
    try { const p = readHeaders(input.file); headers = p.headers; rowCount = p.rowCount; }
    catch (e) { return { ok: false, error: 'read_fail', 리딩: '엑셀을 읽지 못했어요. xlsx 또는 csv로, 첫 줄에 항목명(이름·전화 등)이 있게 올려주세요.' }; }
  }
  headers = (headers || []).map(String);
  const present = [], missing = [];
  Object.keys(STD).forEach((group) => STD[group].forEach((f) => {
    if (hasKw(headers, f.kw)) present.push({ 그룹: group, 항목: f.항목 }); else missing.push({ 그룹: group, 항목: f.항목, 영향: f.영향 });
  }));
  const has = (f) => hasKw(headers, FIELD_KW[f]);
  const 가능 = [], 잠금 = [];
  [
    { label: '연락 관리', ok: has('전화'), need: '전화' },
    { label: '생일 관리', ok: has('생일'), need: '생일' },
    { label: '만기·갱신 관리', ok: has('만기'), need: '만기·갱신일' },
    { label: '보장 관리', ok: has('상품'), need: '가입상품·보장' },
    { label: '소개 타이밍', ok: has('체결일'), need: '체결일' },
    { label: '접촉 주기 관리', ok: has('최근상담'), need: '최근상담일' },
  ].forEach((c) => { if (c.ok) 가능.push(c.label); else 잠금.push({ label: c.label, need: c.need }); });

  let 리딩 = `📇 고객 명단을 읽었어요 — 총 ${rowCount}명 · 컬럼 ${headers.length}개.\n\n`;
  리딩 += `✅ 지금 바로 되는 관리: ${가능.join(', ') || '(연락처가 없어 최소 관리도 어려워요)'}\n`;
  if (missing.length) 리딩 += `🔒 잠긴 관리(항목 채우면 켜져요): ${잠금.map((l) => l.label + '←' + l.need).join(', ')}\n`;
  리딩 += `\n항목을 강제로 다 채우지 않아도 돼요 — 있는 것만으로 지금 시작할 수 있어요.`;
  const canStart = has('이름') || has('전화'); // 최소 이름/전화면 시작
  return { ok: true, present, missing, 가능, 잠금, canStart, rowCount, headerCount: headers.length, 리딩, 표준: Object.keys(STD) };
}

/** roster(객체 배열) → {headers, rows} 변환. 시트 자동연동(readRoster 결과)을 buildDashboard에 태우기 위함 */
function rosterToSheet(roster) {
  const arr = Array.isArray(roster) ? roster.filter((o) => o && typeof o === 'object') : [];
  if (!arr.length) return { headers: [], rows: [] };
  const headers = []; arr.forEach((o) => Object.keys(o).forEach((k) => { if (headers.indexOf(k) < 0) headers.push(k); }));
  const rows = arr.map((o) => headers.map((h) => (o[h] == null ? '' : o[h])));
  return { headers, rows };
}

/** 관리-2: 오늘 이벤트 대시보드(실제 날짜 비교·결정적). input={file, today} 또는 {sheet:{headers,rows}, today} */
function buildDashboard(input) {
  input = input || {};
  const today = parseToday(input.today) || nowYMD();
  let sheet;
  if (input.sheet && Array.isArray(input.sheet.headers)) { sheet = input.sheet; }        // ★[A] 시트 자동연동: 이미 파싱된 headers/rows 직접 사용(파일 없이)
  else { try { sheet = readSheet(input.file); } catch (e) { return { ok: false, error: 'read_fail' }; } }
  const F = mapFields(sheet.headers);
  const get = (row, f) => (F[f] != null ? row[F[f]] : '');
  const cards = { contact: [], maturity: [], birthday: [], intro: [] };
  sheet.rows.forEach((row) => {
    const name = String(get(row, '이름') || '').trim(); if (!name) return;
    const phone = String(get(row, '전화') || '').trim();
    if (F.생일 != null) { const by = parseYMD(get(row, '생일')); if (by) { const d = daysUntilAnnual(by, today); if (d === 0) cards.birthday.push({ 이름: name, 전화: phone }); } }
    if (F.만기 != null) { const mt = parseYMD(get(row, '만기')); if (mt) {
      const inMonth = mt.y ? (mt.y === today.y && mt.m === today.m) : (mt.m === today.m); // ★이번달(현재 월) 만기 = 1일~말일 다 포함
      if (inMonth) { const dd = mt.y ? daysUntil(mt, today) : daysUntilAnnual(mt, today); const mstr = `${mt.y || today.y}-${String(mt.m).padStart(2, '0')}-${String(mt.d).padStart(2, '0')}`; cards.maturity.push({ 이름: name, 전화: phone, dday: dd, 만기일: mstr }); } } }
    if (F.체결일 != null) { const c = parseYMD(get(row, '체결일')); if (c && c.y) { const since = daysUntil(c, today) * -1; if (since >= 80 && since <= 100) cards.intro.push({ 이름: name, 전화: phone, since: since }); } }
    if (F.최근상담 != null) { const lc = parseYMD(get(row, '최근상담')); if (lc && lc.y) { const gap = daysUntil(lc, today) * -1; if (gap >= 90) cards.contact.push({ 이름: name, 전화: phone, gap: gap }); } }
  });
  // 승인용 초안(결정적 템플릿 — 지니야는 대상·타이밍·초안만, 발송은 설계사 승인)
  const draftB = (n) => `${n}님, 생일 축하드립니다! 늘 건강하고 좋은 일 가득하시길 바랍니다. 편하실 때 안부 인사도 드릴게요. — 담당 설계사 드림`;
  const draftM = (n, d) => (d != null && d < 0)
    ? `${n}님, 가입하신 보험 만기일이 ${-d}일 전 지났어요. 갱신·보장 점검 지금도 도와드릴 수 있으니 편하실 때 알려주세요.`
    : `${n}님, 가입하신 보험 만기가 ${d === 0 ? '오늘' : 'D-' + d} 다가와 안내드려요. 갱신·보장 점검 도와드릴까요? 편하실 때 알려주세요.`;
  const draftI = (n) => `${n}님, 그동안 잘 이용해 주셔서 감사합니다. 혹시 주변에 보험 점검이 필요한 분 계시면 편하게 소개해 주세요 — 정성껏 도와드리겠습니다.`;
  const draftC = (n, g) => `${n}님, 오랜만에 안부 인사드려요(마지막 연락 ${g}일 전). 잘 지내시죠? 보험 관련 궁금한 점 있으면 언제든 편하게 연락 주세요.`;
  const listB = cards.birthday.map((c) => ({ 이름: c.이름, 왜: '오늘 생일', 언제: '오늘', 전화: c.전화, 초안: draftB(c.이름) }));
  const ddLabelM = (d) => d == null ? '' : (d === 0 ? '오늘 만기' : (d > 0 ? 'D-' + d : (-d) + '일 지남'));
  const listM = cards.maturity
    .sort((a, b) => { const ka = a.dday < 0 ? 1 : 0, kb = b.dday < 0 ? 1 : 0; return ka !== kb ? ka - kb : Math.abs(a.dday) - Math.abs(b.dday); }) // 다가올 순 먼저, 지난 건 뒤
    .map((c) => ({ 이름: c.이름, 왜: '이번달 만기', 언제: ddLabelM(c.dday), 만기일: c.만기일, 전화: c.전화, 초안: draftM(c.이름, c.dday) }));
  const listI = cards.intro.map((c) => ({ 이름: c.이름, 왜: '계약 3개월·안정기(소개 적기)', 언제: c.since + '일차', 전화: c.전화, 초안: draftI(c.이름) }));
  const listC = cards.contact.sort((a, b) => b.gap - a.gap).map((c) => ({ 이름: c.이름, 왜: '장기 미접촉', 언제: c.gap + '일 미접촉', 전화: c.전화, 초안: draftC(c.이름, c.gap) }));
  const metrics = [
    { key: 'newproduct', color: '✨', label: '신상품·제도 대상자', count: 0, locked: true, need: '가입상품·보장', cards: [] },
    { key: 'maturity', color: '🟡', label: '이번달 만기·갱신', count: listM.length, locked: F.만기 == null, need: '만기·갱신일', cards: listM },
    { key: 'birthday', color: '🔵', label: '오늘 생일', count: listB.length, locked: F.생일 == null, need: '생일', cards: listB },
    { key: 'contact', color: '🔴', label: '오늘 연락할 고객', count: listC.length, locked: F.최근상담 == null, need: '최근상담일', cards: listC },
    { key: 'intro', color: '🤝', label: '소개 요청 적기', count: listI.length, locked: F.체결일 == null, need: '체결일', cards: listI },
    { key: 'imminent', color: '🟢', label: '계약 체결 임박', count: 0, locked: true, need: '상담 파이프라인 데이터', cards: [] },
  ];
  const todayStr = `${today.y}-${String(today.m).padStart(2, '0')}-${String(today.d).padStart(2, '0')}`;
  return { ok: true, today: todayStr, rowCount: sheet.rows.length, metrics, 우선순위: ['신상품·제도', '만기·갱신', '생일', '소개', '전체공지'] };
}

module.exports = { analyzeManagement, buildDashboard, rosterToSheet, readHeaders, readSheet, STD };

if (require.main === module) {
  const demo = analyzeManagement({ headers: ['이름', '휴대폰', '생일', '만기일'], rowCount: 3 });
  console.log('가능:', demo.가능, '| 잠금:', demo.잠금.map((l) => l.label), '| canStart:', demo.canStart);
}
