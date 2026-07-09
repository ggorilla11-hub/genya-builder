// ─────────────────────────────────────────────────────────────
// client_mgmt_skill.js — 📇 고객관리비서 · 관리-1(엑셀 리딩) 스킬
// 무엇을·왜: 설계사 엑셀(xlsx/csv) 헤더를 읽어 "관리 표준 항목" 대조 → 부족 항목 리딩
//   ("관리하려면 이게 더 필요합니다"). ★결정적 로직(LLM 지어내기 0). 값 아닌 "컬럼 유무"만 본다.
// 사용: const { analyzeManagement } = require('./client_mgmt_skill');
//        const r = analyzeManagement({ file:base64, mime });  // 또는 { headers:[], rowCount }
//        r = { ok, present[], missing[{그룹,항목,영향}], rowCount, headerCount, 리딩, 표준 }
// ★Zero data ingress: 버퍼로만 파싱(디스크 저장 0). 고객 값은 읽지 않고 헤더(컬럼명)만 진단.
// ─────────────────────────────────────────────────────────────
'use strict';
const XLSX = require('xlsx');

// 관리 항목 표준(대표 지정): 기본/핵심/관계. kw=컬럼명 매칭 키워드, 영향=없으면 못 하는 관리
const STD = {
  기본: [
    { 항목: '이름', kw: ['이름', '성명', '고객명', 'name'], 영향: '고객 식별' },
    { 항목: '전화', kw: ['전화', '휴대폰', '핸드폰', '연락처', 'phone', 'tel', 'hp', 'mobile'], 영향: '연락' },
    { 항목: '이메일', kw: ['이메일', '메일', 'email', 'mail'], 영향: '이메일 안내' },
    { 항목: '생일', kw: ['생일', '생년', '생년월일', '출생', 'birth', 'dob'], 영향: '생일 관리' },
  ],
  핵심: [
    { 항목: '체결일', kw: ['체결', '계약일', '가입일', '청약', '계약체결'], 영향: '계약 히스토리·소개 타이밍' },
    { 항목: '만기·갱신일', kw: ['만기', '갱신', '만료', '재계약', 'expire', 'renew', 'maturity'], 영향: '만기·갱신 관리' },
    { 항목: '가입상품·보장', kw: ['상품', '보장', '담보', '증권', '플랜', '가입상품', 'product', 'plan'], 영향: '보장분석·업셀' },
    { 항목: '월납료', kw: ['월납', '보험료', '납입', '월보험', '월납입', 'premium'], 영향: '유지·해지방어' },
    { 항목: '가족사항', kw: ['가족', '배우자', '자녀', '부양', 'family'], 영향: '가족 니즈·소개' },
  ],
  관계: [
    { 항목: '최근상담일', kw: ['상담일', '최근상담', '접촉', '미팅', '최근연락', '만난'], 영향: '접촉 주기 관리' },
    { 항목: '관심분야', kw: ['관심', '니즈', '관심분야', 'interest', 'needs'], 영향: '맞춤 제안' },
    { 항목: '특이사항', kw: ['특이', '메모', '비고', '참고', 'note', 'memo', 'remark'], 영향: '개인화 응대' },
    { 항목: '고객등급', kw: ['등급', 'vip', 'grade', 'tier', '우량', '고객등급'], 영향: '우선순위 관리' },
  ],
};

function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\s·\-_()\/.]/g, ''); }

// 엑셀/CSV 버퍼 → 헤더·행수 (디스크 미기록). ★CSV는 한글 인코딩 안전 위해 수동 UTF-8 파싱, xlsx(zip)는 XLSX.read
function readHeaders(b64) {
  const buf = Buffer.from(String(b64 || ''), 'base64');
  const isZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4B; // 'PK' = xlsx/zip
  if (!isZip) {
    const txt = buf.toString('utf8').replace(/^﻿/, '');
    const lines = txt.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length) {
      const sep = ((lines[0].match(/\t/g) || []).length > (lines[0].match(/,/g) || []).length) ? '\t' : ',';
      const headers = lines[0].split(sep).map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
      if (headers.length) return { headers, rowCount: Math.max(0, lines.length - 1) };
    }
  }
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headers = (rows[0] || []).map((x) => String(x == null ? '' : x).trim()).filter(Boolean);
  const rowCount = rows.slice(1).filter((r) => (r || []).some((c) => String(c == null ? '' : c).trim())).length;
  return { headers, rowCount };
}

/** 엑셀 헤더 → 관리 표준 대조 → 부족 항목 리딩(결정적) */
function analyzeManagement(input) {
  input = input || {};
  let headers = input.headers, rowCount = input.rowCount || 0;
  if ((!headers || !headers.length) && input.file) {
    try { const p = readHeaders(input.file); headers = p.headers; rowCount = p.rowCount; }
    catch (e) { return { ok: false, error: 'read_fail', 리딩: '엑셀을 읽지 못했어요. xlsx 또는 csv 파일로, 첫 줄에 항목명(이름·전화 등)이 있게 올려주세요.' }; }
  }
  const H = (headers || []).map(norm);
  const present = [], missing = [];
  Object.keys(STD).forEach((group) => STD[group].forEach((f) => {
    const hit = f.kw.some((k) => { const nk = norm(k); return H.some((h) => h.indexOf(nk) >= 0); });
    if (hit) present.push({ 그룹: group, 항목: f.항목 }); else missing.push({ 그룹: group, 항목: f.항목, 영향: f.영향 });
  }));
  let 리딩 = `📇 고객 명단을 읽었어요 — 총 ${rowCount}명 · 컬럼 ${(headers || []).length}개.\n\n`;
  if (!missing.length) {
    리딩 += '✅ 관리에 필요한 표준 항목이 모두 있어요! 바로 "오늘 이벤트 대시보드"로 관리를 시작할 수 있어요.';
  } else {
    리딩 += '관리하려면 이게 더 필요합니다:\n' + missing.map((m) => `• ${m.항목} 없음 → ${m.영향} 어려움`).join('\n');
    리딩 += `\n\n(있는 항목: ${present.map((p) => p.항목).join(', ') || '없음'})\n이 항목들을 채우면 만기·생일·보장·소개까지 자동 관리해드려요. 지금은 있는 항목으로 먼저 시작할 수 있어요.`;
  }
  return { ok: true, present, missing, rowCount, headerCount: (headers || []).length, 리딩, 표준: Object.keys(STD) };
}

module.exports = { analyzeManagement, readHeaders, STD };

if (require.main === module) {
  // 자체 시연(더미 헤더 — 이름·전화만 있는 흔한 케이스)
  const demo = analyzeManagement({ headers: ['이름', '휴대폰번호', '메모'], rowCount: 3 });
  console.log('부족 항목 수:', demo.missing.length);
  console.log(demo.리딩);
}
