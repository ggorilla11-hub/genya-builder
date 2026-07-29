// ─────────────────────────────────────────────────────────────
// _diag_pinecone.js — 📊 파인콘(벡터 창고) 전체 내용 조회 (읽기 전용 · 진단 도구)
//
// 무엇을·왜: "우리 파인콘에 뭐가 들어 있나"를 정확히 본다. 추측 금지.
//   인덱스 → 네임스페이스 → 개수 → (공개자료만) 내용 표본.
//
// ★개인정보 보호 (CLAUDE.md 6-2 ④ 제로 인그레스)
//   · 약관 같은 ★공개자료 네임스페이스만 내용을 보여준다.
//   · 개인 기억(owner_*) 네임스페이스는 ★개수·구조만 보고 내용은 안 찍는다.
//   · 그래도 새어나올 수 있는 값은 마스킹한다(전화·이메일·주민번호).
// ★읽기 전용 — 쓰기·삭제 코드 없음.
//
// 실행: node deploy/_diag_pinecone.js        (deploy 폴더에서 실행해야 .env를 읽는다)
// ─────────────────────────────────────────────────────────────
'use strict';
try { require('dotenv').config(); } catch (e) {}
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

const 공개자료 = /^yakgwan_/;            // 약관 = 공개자료 → 내용 표본 OK
const 개인기억 = /^owner_/;              // 개인 기억 → 개수만

function 마스킹(s) {
  return String(s == null ? '' : s)
    .replace(/\b\d{6}\s*[-–]\s*\d{7}\b/g, '******-*******')
    .replace(/\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '010-****-****')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g, '****@****');
}

(async function main() {
  if (!process.env.PINECONE_API_KEY) {
    console.log('★PINECONE_API_KEY 없음 — deploy 폴더에서 실행하세요');
    process.exit(1);
  }
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

  console.log('\n════════ 1. 인덱스 목록 ════════');
  const list = await pc.listIndexes();
  const idxs = list.indexes || [];
  if (!idxs.length) { console.log('★인덱스가 하나도 없습니다'); process.exit(0); }
  idxs.forEach((i) => {
    console.log(`\n  📦 ${i.name}`);
    console.log(`     차원 ${i.dimension} · 거리 ${i.metric} · ${i.spec && i.spec.serverless ? i.spec.serverless.cloud + '/' + i.spec.serverless.region : '?'}`);
    console.log(`     상태 ${i.status && i.status.ready ? '준비됨' : '준비중'}`);
  });

  for (const meta of idxs) {
    console.log(`\n\n════════ 2. [${meta.name}] 안에 뭐가 있나 ════════`);
    const idx = pc.index(meta.name);
    let stats;
    try { stats = await idx.describeIndexStats(); }
    catch (e) { console.log('  조회 실패:', e.message); continue; }

    console.log(`  총 벡터 수: ${stats.totalRecordCount != null ? stats.totalRecordCount : '?'}`);
    const ns = stats.namespaces || {};
    const keys = Object.keys(ns);
    if (!keys.length) { console.log('  ★네임스페이스 없음 (비어 있음)'); continue; }

    console.log(`  네임스페이스 ${keys.length}개:`);
    keys.sort().forEach((k) => {
      const n = ns[k].recordCount != null ? ns[k].recordCount : ns[k].vectorCount;
      const 종류 = 공개자료.test(k) ? '📄 공개자료(약관)' : (개인기억.test(k) ? '🔒 개인기억' : '❓ 기타');
      console.log(`    · ${k || '(기본)'}  —  ${n}개  ${종류}`);
    });

    // ── 공개자료(약관)만 내용 표본을 본다 ──
    const 공개 = keys.filter((k) => 공개자료.test(k));
    for (const k of 공개) {
      console.log(`\n  ── 📄 [${k}] 내용 표본 ──`);
      try {
        const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const emb = await oa.embeddings.create({ model: 'text-embedding-3-small', input: ['보험금 지급'] });
        const r = await idx.namespace(k).query({ vector: emb.data[0].embedding, topK: 3, includeMetadata: true });
        (r.matches || []).forEach((m, i) => {
          const md = m.metadata || {};
          console.log(`   ${i + 1}) id=${m.id} · page=${md.page != null ? md.page : '?'} · 점수 ${Number(m.score).toFixed(3)}`);
          console.log(`      메타 항목: ${Object.keys(md).join(', ')}`);
          console.log(`      본문: ${String(md.text || '').slice(0, 120).replace(/\s+/g, ' ')}…`);
        });
        // 페이지 범위 파악
        const wide = await idx.namespace(k).query({ vector: emb.data[0].embedding, topK: 100, includeMetadata: true });
        const pages = (wide.matches || []).map((m) => m.metadata && m.metadata.page).filter((p) => p != null);
        if (pages.length) console.log(`      (표본 ${pages.length}건의 페이지 범위: ${Math.min.apply(null, pages)} ~ ${Math.max.apply(null, pages)})`);
      } catch (e) { console.log('   표본 조회 실패:', e.message); }
    }

    // ── 개인 기억: ★내용 안 봄. 구조(메타 항목 이름)만 확인 ──
    const 개인 = keys.filter((k) => 개인기억.test(k));
    if (개인.length) {
      console.log(`\n  ── 🔒 개인기억 ${개인.length}개 — ★내용은 보지 않습니다(제로 인그레스) ──`);
      개인.slice(0, 20).forEach((k) => {
        const n = ns[k].recordCount != null ? ns[k].recordCount : ns[k].vectorCount;
        console.log(`    · ${k} — ${n}개`);
      });
      if (개인.length > 20) console.log(`    … 외 ${개인.length - 20}개`);
      // ★2026-07-29 수정: 처음엔 표본 한 줄을 마스킹해 찍었는데, 마스킹은 전화·이메일만 가리고
      //   ★고객 이름은 못 가렸다(실제로 고객 이름이 화면에 찍혔다). 개인기억은 ★내용을 아예 안 본다.
      console.log('    (내용·구조 모두 조회하지 않습니다 — 개인 기억은 개수만 봅니다)');
    }

    // ── 기타(분류 안 된) 네임스페이스 ──
    const 기타 = keys.filter((k) => !공개자료.test(k) && !개인기억.test(k));
    if (기타.length) {
      console.log(`\n  ── ❓ 기타 네임스페이스 ${기타.length}개 ──`);
      for (const k of 기타.slice(0, 10)) {
        const n = ns[k].recordCount != null ? ns[k].recordCount : ns[k].vectorCount;
        console.log(`    · ${k || '(기본)'} — ${n}개`);
        try {
          const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const emb = await oa.embeddings.create({ model: 'text-embedding-3-small', input: ['무엇'] });
          const r = await idx.namespace(k).query({ vector: emb.data[0].embedding, topK: 1, includeMetadata: true });
          const md = (r.matches && r.matches[0] && r.matches[0].metadata) || {};
          console.log(`      메타 항목: ${Object.keys(md).join(', ') || '(없음)'}`);
          console.log(`      표본(마스킹): ${마스킹(String(md.text || md.content || '')).slice(0, 100).replace(/\s+/g, ' ')}…`);
        } catch (e) { console.log('      표본 실패:', e.message); }
      }
    }
  }
  console.log('\n════════ 끝 ════════\n');
})().catch((e) => { console.log('실패:', e.message); process.exit(1); });
