// ─────────────────────────────────────────────────────────────
// genya_mem_module.js — 🧠 MEM 기억(하이브리드 C) · Firestore(genya_mem) 저장/검색
// 무엇을·왜: 설계 "요약"만 서버 Firestore에 저장 → "예전 ○○ 설계 불러줘" 검색·재현.
//   ★제로 인그레스: 주민번호·전화 등 민감정보는 저장 전 마스킹. 원본·개인정보 서버 저장 X(검색용 요약만).
//   ★멀티테넌트: userId(회원 이메일)로 격리 — 각자 자기 데이터만.
//   ★새 의존성 없음: 기존 SA(moneya-72fe6) + googleapis firestore v1 REST 사용.
// 사용: const mem=require('./genya_mem_module');
//        await mem.saveMem(auth, {userId, 고객명, skill, summary, 담보금액});
//        const rows=await mem.searchMem(auth, {userId, 고객명, date});
//   auth = googleAuth(['https://www.googleapis.com/auth/datastore']) (main_server의 googleAuth 재사용)
// ─────────────────────────────────────────────────────────────
'use strict';
const { google } = require('googleapis');

const PROJECT = process.env.GENYA_MEM_PROJECT || 'moneya-72fe6';
const COLL = 'genya_mem';
const DB = `projects/${PROJECT}/databases/(default)/documents`;
const SCOPE = 'https://www.googleapis.com/auth/datastore';

// ★민감정보 마스킹: 주민번호·전화번호를 저장 전 제거(원본 서버 유입 차단)
function mask(s) {
  return String(s == null ? '' : s)
    .replace(/\d{6}\s*[-–]\s*[1-4]\d{6}/g, '[주민번호 마스킹]')      // 주민등록번호 000000-0000000
    .replace(/\b\d{6}[1-4]\d{6}\b/g, '[주민번호 마스킹]')            // 하이픈 없는 13자리
    .replace(/01[016789]\s*[-–\s]?\s*\d{3,4}\s*[-–\s]?\s*\d{4}/g, '[전화 마스킹]') // 휴대폰
    .replace(/\b0\d{1,2}\s*[-–]\s*\d{3,4}\s*[-–]\s*\d{4}\b/g, '[전화 마스킹]');    // 일반전화 02-xxx-xxxx
}

function fsClient(auth) { return google.firestore({ version: 'v1', auth }); }

// JS 객체 → Firestore typed fields
function toFields(obj) {
  const f = {};
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if (v == null) f[k] = { nullValue: null };
    else if (typeof v === 'number' && Number.isInteger(v)) f[k] = { integerValue: String(v) };
    else if (typeof v === 'number') f[k] = { doubleValue: v };
    else f[k] = { stringValue: String(v) };
  });
  return f;
}
function fromFields(f) {
  const o = {};
  Object.keys(f || {}).forEach((k) => {
    const v = f[k] || {};
    o[k] = 'stringValue' in v ? v.stringValue
      : 'integerValue' in v ? Number(v.integerValue)
      : 'doubleValue' in v ? v.doubleValue
      : 'nullValue' in v ? null : '';
  });
  return o;
}

/** 설계 요약 저장(마스킹 후). m={userId, 고객명(별칭), skill, summary, 담보금액} */
async function saveMem(auth, m) {
  m = m || {};
  const doc = {
    userId: String(m.userId || ''),                 // ★격리 키(마스킹 안 함 — 이메일은 회원 식별자)
    date: String(m.date || new Date().toISOString().slice(0, 10)),
    고객명: mask(m.고객명 || ''),                   // 별칭이지만 혹시 모를 민감정보 방어 마스킹
    skill: String(m.skill || ''),
    summary: mask(m.summary || ''),                 // ★핵심 요약(주민번호·전화 제거)
    담보금액: mask(m.담보금액 || ''),
    timestamp: new Date().toISOString(),
  };
  if (!doc.userId) throw new Error('userId 필수(격리)');
  await fsClient(auth).projects.databases.documents.createDocument({ parent: DB, collectionId: COLL, requestBody: { fields: toFields(doc) } });
  return doc;
}

/** 과거 설계 검색. userId로 격리 후 고객명/날짜 부분매칭. (userId 단일 등가필터 → 복합색인 불필요, 정렬·필터는 코드에서) */
async function searchMem(auth, q) {
  q = q || {};
  if (!q.userId) throw new Error('userId 필수(격리)');
  const res = await fsClient(auth).projects.databases.documents.runQuery({
    parent: DB,
    requestBody: {
      structuredQuery: {
        from: [{ collectionId: COLL }],
        where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: String(q.userId) } } },
        limit: 300,
      },
    },
  });
  let rows = (res.data || []).filter((r) => r.document).map((r) => Object.assign({ _id: String(r.document.name || '').split('/').pop() }, fromFields(r.document.fields)));
  rows.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  if (q.고객명) rows = rows.filter((r) => (String(r.고객명 || '') + String(r.summary || '')).indexOf(q.고객명) >= 0);
  if (q.date) rows = rows.filter((r) => String(r.date || '').indexOf(q.date) >= 0);
  return rows.slice(0, q.limit || 10);
}

/** 설계 요약 삭제. q={userId, id}. ★userId 소유 확인 후 삭제(남의 기록 삭제 방지) */
async function deleteMem(auth, q) {
  q = q || {};
  if (!q.userId) throw new Error('userId 필수(격리)');
  if (!q.id) throw new Error('id 필수');
  const name = `${DB}/${COLL}/${q.id}`;
  const g = await fsClient(auth).projects.databases.documents.get({ name });
  const owner = ((g.data && g.data.fields && g.data.fields.userId) || {}).stringValue || '';
  if (owner !== String(q.userId)) throw new Error('권한 없음(다른 회원의 기록)');
  await fsClient(auth).projects.databases.documents.delete({ name });
  return { deleted: true, id: q.id };
}

module.exports = { saveMem, searchMem, deleteMem, mask, SCOPE, COLL, PROJECT };

if (require.main === module) {
  console.log('🧠 MEM 모듈 — Firestore', PROJECT + '/' + COLL, '· userId 격리 · 저장 전 주민번호/전화 마스킹');
  ['홍길동 901201-1234567 연락 010-1234-5678', '02-555-1234 문의'].forEach((s) => console.log('  mask:', s, '→', mask(s)));
}
