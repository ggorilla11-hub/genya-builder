// ═══════════════════════════════════════════════════════════════════
// _embed_author_rag.js — 📚 대표님 자산(rag_chunks.json)을 Pinecone 에 넣는다 (일회성)
//
// 무엇을·왜: 원고가 일반 AI 수준이 아니라 ★대표님 책·상담·강의가 원천이 되게 한다.
//   새로 만들지 않는다 — 이미 검증된 2,766청크를 ★그대로 임베딩만 한다.
//
// ★임베딩 모델은 지니야가 쓰는 것과 ★반드시 같아야 한다.
//   personal_memory.js:22 · yakgwan_search.js:34 가 전부 text-embedding-3-small(1536차원).
//   다른 모델로 넣으면 검색이 0건이 된다. 그래서 아래에서 ★인덱스 차원까지 확인하고 시작한다.
//
// ★넣는 곳: ohwant-genya / author_knowledge  ← ★새 네임스페이스만 쓴다.
//   약관(genya-knowledge)·개인기억(owner_*)은 ★한 줄도 안 건드린다(인덱스를 아예 안 연다).
//
// ★개인정보: 상담사례 1,270개는 패턴 0으로 확인됐다. 책에 남은 주민번호·전화·이메일만
//   ★마스킹해서 넣는다(제로 인그레스 · CLAUDE.md 6-2 ④). 그런 숫자로 검색할 일이 없어 품질 손실 0.
//
// 실행: node deploy/_embed_author_rag.js            (deploy 폴더에서 · .env 필요)
//       node deploy/_embed_author_rag.js --dry      (넣지 않고 계획만 본다)
// ★같은 id 로 다시 넣으면 덮어쓴다 — 여러 번 돌려도 중복이 안 생긴다.
// ═══════════════════════════════════════════════════════════════════
'use strict';
try { require('dotenv').config(); } catch (e) {}
const fs = require('fs');
const path = require('path');
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

const INDEX = 'ohwant-genya';
const NS = 'author_knowledge';
const EMBED_MODEL = 'text-embedding-3-small';   // ★지니야와 같은 모델(1536차원)
const DIM = 1536;
const BATCH = 50;                                // 한 번에 임베딩할 청크 수
const SRC = path.join(__dirname, '..', 'rag_chunks.json');
const DRY = process.argv.includes('--dry');

// ── 개인정보 마스킹 ────────────────────────────────────────────────
//   주민번호·전화·이메일만 가린다. 사람 이름은 책 본문이라 손대지 않는다
//   (이름을 지우면 사례가 읽히지 않는다 — 상담사례에는 애초에 패턴이 0이었다).
function 마스킹(s) {
  return String(s == null ? '' : s)
    .replace(/\d{6}\s*[-–]\s*\d{7}/g, '******-*******')
    .replace(/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, '010-****-****')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g, '****@****');
}

(async function main() {
  if (!process.env.PINECONE_API_KEY || !process.env.OPENAI_API_KEY) {
    console.log('★PINECONE_API_KEY / OPENAI_API_KEY 가 없습니다 — deploy 폴더에서 실행하세요');
    process.exit(1);
  }
  if (!fs.existsSync(SRC)) { console.log('★rag_chunks.json 을 못 찾았습니다: ' + SRC); process.exit(1); }

  const arr = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  console.log('\n════════ 대표님 자산 임베딩 ════════');
  console.log('  원본: ' + SRC);
  console.log('  청크: ' + arr.length + '개');

  // ★모델 일치 확인 — 인덱스 차원이 다르면 시작조차 하지 않는다
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const list = await pc.listIndexes();
  const meta = (list.indexes || []).find((i) => i.name === INDEX);
  if (!meta) { console.log('★인덱스 ' + INDEX + ' 가 없습니다'); process.exit(1); }
  console.log('  넣을 곳: ' + INDEX + ' / ' + NS);
  console.log('  인덱스 차원: ' + meta.dimension + ' · 거리: ' + meta.metric);
  if (meta.dimension !== DIM) {
    console.log('★차원이 안 맞습니다(' + meta.dimension + ' ≠ ' + DIM + ') — 넣으면 검색이 깨집니다. 중단합니다.');
    process.exit(1);
  }
  console.log('  임베딩 모델: ' + EMBED_MODEL + ' (지니야와 동일 ✓)');

  const idx = pc.index(INDEX);
  const before = await idx.describeIndexStats();
  const 기존 = (before.namespaces || {})[NS];
  console.log('  넣기 전 ' + NS + ': ' + (기존 ? (기존.recordCount != null ? 기존.recordCount : 기존.vectorCount) + '개' : '(없음 — 새로 만듭니다)'));
  console.log('  ★건드리지 않는 것: genya-knowledge(약관) · owner_*(개인기억) — 이 스크립트는 열지도 않습니다');

  // 마스킹 + 검증
  let 마스킹수 = 0, 빈것 = 0;
  const 준비 = arr.map((c) => {
    const 원 = String(c.content || '');
    const m = 마스킹(원);
    if (m !== 원) 마스킹수++;
    if (!m.trim()) 빈것++;
    return { id: String(c.id), book: String(c.book || ''), content: m, char_count: Number(c.char_count) || m.length };
  }).filter((c) => c.content.trim());

  console.log('  마스킹된 청크: ' + 마스킹수 + '개 · 빈 청크 제외: ' + 빈것 + '개');
  console.log('  실제로 넣을 청크: ' + 준비.length + '개');

  if (DRY) { console.log('\n(--dry 라서 여기까지만 합니다. 아무것도 넣지 않았습니다.)\n'); return; }

  const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let 넣음 = 0, 실패 = 0, 토큰 = 0;
  const t0 = Date.now();

  for (let i = 0; i < 준비.length; i += BATCH) {
    const 묶음 = 준비.slice(i, i + BATCH);
    try {
      const emb = await oa.embeddings.create({ model: EMBED_MODEL, input: 묶음.map((c) => c.content) });
      토큰 += (emb.usage && emb.usage.total_tokens) || 0;
      const vectors = 묶음.map((c, k) => ({
        id: c.id,
        values: emb.data[k].embedding,
        metadata: { book: c.book, content: c.content, char_count: c.char_count },  // ★지시하신 메타 보존
      }));
      await idx.namespace(NS).upsert(vectors);
      넣음 += vectors.length;
    } catch (e) {
      실패 += 묶음.length;
      console.log('  ★배치 실패(' + i + '~' + (i + 묶음.length - 1) + '): ' + e.message);
    }
    const 진행 = Math.round(((i + 묶음.length) / 준비.length) * 100);
    process.stdout.write('\r  진행 ' + 진행 + '%  (' + 넣음 + '/' + 준비.length + ')      ');
  }
  console.log('');

  // ★넣었다고 말하기 전에 ★다시 읽어 확인한다 (CLAUDE.md 6-10 ③)
  console.log('\n  Pinecone 반영을 기다립니다…');
  let 최종 = 0;
  for (let t = 0; t < 12; t++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await idx.describeIndexStats();
    const n = (st.namespaces || {})[NS];
    최종 = n ? (n.recordCount != null ? n.recordCount : n.vectorCount) : 0;
    process.stdout.write('\r  서버가 세어 준 개수: ' + 최종 + '      ');
    if (최종 >= 준비.length) break;
  }
  console.log('');

  console.log('\n════════ 결과 ════════');
  console.log('  보낸 청크: ' + 넣음 + '개' + (실패 ? ('  ★실패 ' + 실패 + '개') : ''));
  console.log('  ★서버가 실제로 가진 개수: ' + 최종 + '개  (목표 ' + 준비.length + '개)');
  console.log('  판정: ' + (최종 >= 준비.length ? '✅ 다 들어갔습니다' : '★모자랍니다 — 다시 돌리면 같은 id 라 덮어씁니다'));
  console.log('  임베딩 토큰: ' + 토큰.toLocaleString() + '  (약 $' + (토큰 / 1000000 * 0.02).toFixed(3) + ')');
  console.log('  걸린 시간: ' + Math.round((Date.now() - t0) / 1000) + '초\n');
})().catch((e) => { console.log('\n실패: ' + e.message); process.exit(1); });
