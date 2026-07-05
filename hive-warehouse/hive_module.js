// ─────────────────────────────────────────────────────────────
// hive_module.js — 🐝 HIVE-1 지혜 순환 "패턴 수집 씨앗" (독립 모듈)
// 무엇을·왜: 개별 지니야가 일하며 발견한 ★익명 패턴·지혜만 "총괄 지식 저장소"에 기록.
//   원본 고객 데이터(이름·증권·상담원문)는 절대 안 올림 — 회원 구글에만. 익명 통계·패턴만.
// 사용: const H = require('.../hive_module');
//        H.recordPattern({layer:'개별', job:'보험설계사', category:'문구성과', pattern:'만기 안내는 목요일 발송이 응답률 높음'});
//        H.listPatterns({job:'보험설계사'});
//
// ★심장 = 익명화 검증(anonymize): 개인정보(이름님·증권번호·전화·이메일·주민번호·계좌)가
//   한 톨이라도 섞이면 기록을 "거부"한다. 개인정보 0을 코드로 강제.
// ★지금은 씨앗 = 기록 틀 + 계층 라벨 체계만(실제 취합은 HIVE-2). /parksugeun 무접촉.
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, 'hive_patterns.json'); // 공통 저장소(익명 패턴만 — 고객 데이터 아님)
// 계층 라벨 체계(씨앗): 개별 → 직업총괄 → 총괄 → 제니야(최상위)
const LAYERS = ['개별', '직업총괄', '총괄', '제니야'];
const CATEGORIES = ['문구성과', '설명효과', '문제발견', '기능사용', '타이밍', '기타'];

// ── ★익명화 검증: 개인정보(PII) 탐지 → 있으면 거부 ──
const GENERIC = ['고객', '회원', '대표', '설계사', '선생', '사장', '원장', '과장', '부장', '팀장', '직원'];
function detectPII(text) {
  const s = String(text || '');
  const hits = [];
  if (/01[016789]-?\d{3,4}-?\d{4}/.test(s)) hits.push('전화번호');
  if (/[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/.test(s)) hits.push('이메일');
  if (/\d{6}-?[1-4]\d{6}/.test(s)) hits.push('주민번호');
  if (/[A-Za-z]{2}\d{3,4}-\d{5,}/.test(s) || /증권번호/.test(s)) hits.push('증권번호');
  if (/\d{10,}/.test(s)) hits.push('장기 숫자열(계좌·카드 등)');
  // 특정 인물 호칭: [가-힣]2~3자+님 (단, 고객/회원 등 일반 호칭은 제외)
  const nameM = s.match(/([가-힣]{2,3})님/g) || [];
  nameM.forEach((m) => { const stem = m.replace('님', ''); if (!GENERIC.includes(stem)) hits.push(`개인 호칭(${m})`); });
  return hits;
}

/** 🐝 익명 패턴 기록. PII 감지 시 거부(개인정보 0 강제). */
function recordPattern(p) {
  if (!p || !p.pattern) return { ok: false, reason: 'pattern 비어있음' };
  const layer = p.layer || '개별';
  if (!LAYERS.includes(layer)) return { ok: false, reason: `layer는 ${LAYERS.join('/')} 중 하나` };
  // ★익명화 검증: 모든 텍스트 필드 스캔
  const pii = detectPII([p.pattern, p.job, p.category, p.evidence].join(' '));
  if (pii.length) return { ok: false, rejected: true, reason: `개인정보 감지 → 기록 거부: ${pii.join(', ')}` };

  const entry = {
    ts: new Date().toISOString().slice(0, 16).replace('T', ' '),
    layer,
    job: p.job || '공통',
    category: CATEGORIES.includes(p.category) ? p.category : '기타',
    pattern: String(p.pattern),
  };
  const all = _load();
  all.push(entry);
  fs.writeFileSync(STORE, JSON.stringify(all, null, 2), 'utf8');
  return { ok: true, recorded: entry };
}

function _load() { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (e) { return []; } }
function listPatterns(filter = {}) {
  return _load().filter((e) => (!filter.job || e.job === filter.job) && (!filter.layer || e.layer === filter.layer) && (!filter.category || e.category === filter.category));
}

// ── 🐝 HIVE-2/3 취합(구조): 직업별 롤업 → 회원 늘면 베스트 패턴 선별의 토대 ──
function rollup() {
  const all = _load();
  const byJob = {};
  all.forEach((e) => { (byJob[e.job] = byJob[e.job] || []).push(e); });
  const jobs = Object.keys(byJob).map((job) => {
    const pats = byJob[job];
    const categories = {};
    pats.forEach((e) => { (categories[e.category] = categories[e.category] || []).push(e.pattern); });
    return { job, count: pats.length, categories };
  });
  return { totalPatterns: all.length, jobCount: jobs.length, jobs };
}

// ── ★HIVE-4(구조): 제니야(대표님 개인 지니야)용 "지난밤 그룹 전체" 아침 보고 ──
//   회원이 늘수록 자동으로 풍부해짐. 지금은 씨앗 데이터 위에서 동일 구조로 동작.
function zenyaReport() {
  const r = rollup();
  const lines = [`🐝 지난밤 그룹 전체 요약 — 익명 패턴 ${r.totalPatterns}건 · 직업 ${r.jobCount}종`];
  r.jobs.forEach((j) => {
    lines.push(`\n· ${j.job} (${j.count}건)`);
    Object.keys(j.categories).forEach((cat) => {
      const list = j.categories[cat];
      lines.push(`   [${cat}] ${list[0]}${list.length > 1 ? ` 외 ${list.length - 1}건` : ''}`);
    });
  });
  if (!r.totalPatterns) lines.push('아직 수집된 패턴이 없어요. 회원 지니야들이 일하며 익명 패턴을 쌓으면 매일 아침 보고드릴게요.');
  return { generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), text: lines.join('\n'), rollup: r };
}

module.exports = { recordPattern, listPatterns, detectPII, rollup, zenyaReport, LAYERS, CATEGORIES };

// ── 자체 시연: 익명 패턴 기록(허용) + PII 섞인 것(거부) + 목록 ──
if (require.main === module) {
  try { fs.unlinkSync(STORE); } catch (e) {} // 데모 깨끗이
  console.log('🐝 HIVE-1 패턴 수집 씨앗\n계층 라벨:', LAYERS.join(' → '), '\n');

  console.log('━ [1] 익명 패턴 기록(허용) ━');
  [
    { layer: '개별', job: '보험설계사', category: '타이밍', pattern: '만기 안내는 목요일 발송이 응답률 높음' },
    { layer: '개별', job: '보험설계사', category: '설명효과', pattern: '실손 4세대 질문엔 "자기부담금 vs 보험료" 비교로 설명하면 잘 통함' },
    { layer: '직업총괄', job: '보험설계사', category: '문제발견', pattern: '약관 무보험차상해 조항을 헷갈려하는 회원 많음' },
  ].forEach((p) => { const r = recordPattern(p); console.log(`  ${r.ok ? '✅ 기록' : '❌ ' + r.reason}: ${p.pattern.slice(0, 40)}`); });

  console.log('\n━ [2] ★개인정보 섞인 패턴(거부되어야 함) ━');
  [
    { layer: '개별', job: '보험설계사', category: '문구성과', pattern: '김철수님 증권 SF2025-0847213 만기 안내함' },
    { layer: '개별', job: '보험설계사', category: '기타', pattern: '고객 010-2345-6789로 연락함' },
  ].forEach((p) => { const r = recordPattern(p); console.log(`  ${r.rejected ? '🛡️ 거부됨' : '⚠️ 통과(문제!)'}: ${r.reason || 'OK'}`); });

  console.log('\n━ [3] 저장된 익명 패턴(개인정보 0) ━');
  listPatterns({ job: '보험설계사' }).forEach((e) => console.log(`  [${e.layer}·${e.category}] ${e.pattern}`));

  console.log('\n━ [4] ★HIVE-4 제니야 아침보고(구조 확장 가능) ━');
  console.log(zenyaReport().text);
  console.log('\n★HIVE-1 완료: 익명 기록 틀+계층 라벨+PII 거부 + 롤업/제니야보고 구조. 실제 취합은 회원 늘면 자동 풍부화(HIVE-2~5).');
}
