// ═══════════════════════════════════════════════════════════════════
// author_rag.js — 📚 대표님 자산 검색 (책·상담·강의 2,766청크)
//
// 무엇을·왜: 원고가 일반 AI 수준이 아니라 ★대표님 책·상담·강의가 원천이 되게 한다.
//   한 줄 메시지를 임베딩해 대표님 자산에서 가까운 대목을 찾아, 2번 통로(campaign.source)로 넘긴다.
//
// ★2번 통로 위에 얹는다 — 프롬프트 쪽은 이미 있는 sourceBlock 을 그대로 쓴다(새로 만들지 않는다).
// ★facts(사실자료)·환각차단과는 완전히 별개 통로다. 그쪽은 한 줄도 안 건드린다.
// ★약관(genya-knowledge)·개인기억(owner_*)은 열지도 않는다 — 이 파일이 여는 것은 author_knowledge 하나뿐.
//
// ★상한: 청크당 1,400자 × 4개 = 5,600자.
//   promo_prompts.SOURCE_MAX(6,000자) 안에 들어가야 한다. 넘으면 잘려서 마지막 청크가 통째로 사라진다.
//
// ★검색이 실패해도 원고는 나와야 한다. 모든 실패는 삼켜서 빈 결과로 돌린다(생성을 막지 않는다).
// ═══════════════════════════════════════════════════════════════════
'use strict';

const INDEX = 'ohwant-genya';
const NS = 'author_knowledge';
const EMBED_MODEL = 'text-embedding-3-small';   // ★지니야가 쓰는 것과 같은 모델(1536차원). 다르면 검색이 0건이 된다.
const TOPK = 4;
const PER_CHUNK = 1400;                         // 청크당 상한
// ★문턱 0.40 — 실측으로 정한 값이다(2026-08-03).
//   재무 주제 질의는 전부 0.405~0.654 로 들어왔다.
//   반면 "AI비서 만들기로 세일즈 업그레이드"처럼 ★자산에 없는 주제는 0.330~0.338 이었는데,
//   문턱이 낮으면 그 무관한 재무 내용 5,696자가 통째로 딸려 들어가 ★주제를 흐린다
//   (A/B 실측에서 이미 확인한 "주제 갈아타기" 사고와 같은 병).
//   → 못 찾으면 억지로 채우지 않고 ★0건으로 두고, 화면에 "못 찾았다"고 정직히 알린다.
const MIN_SCORE = 0.40;

let _idx = null, _oa = null;

function configured() {
  return !!(process.env.PINECONE_API_KEY && process.env.OPENAI_API_KEY);
}
function _openai() {
  if (!_oa) { const OpenAI = require('openai'); _oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }
  return _oa;
}
function _index() {
  if (!_idx) {
    const { Pinecone } = require('@pinecone-database/pinecone');
    _idx = new Pinecone({ apiKey: process.env.PINECONE_API_KEY }).index(INDEX);
  }
  return _idx;
}

/**
 * 대표님 자산에서 가까운 대목을 찾는다.
 * @returns {Promise<Array>} [{ book, content, score, chars }] · 실패하면 []
 */
async function search(query, topK) {
  const q = String(query || '').trim();
  if (!configured() || !q) return [];
  try {
    const emb = await _openai().embeddings.create({ model: EMBED_MODEL, input: q.slice(0, 4000) });
    const r = await _index().namespace(NS).query({
      vector: emb.data[0].embedding, topK: topK || TOPK, includeMetadata: true,
    });
    return (r.matches || [])
      .filter((m) => Number(m.score) >= MIN_SCORE)          // ★안 닮은 건 버린다
      .map((m) => {
        const md = m.metadata || {};
        return {
          book: String(md.book || ''),
          content: String(md.content || '').slice(0, PER_CHUNK),
          score: Number(m.score),
          chars: Number(md.char_count) || 0,
        };
      })
      .filter((c) => c.content.trim());
  } catch (e) {
    return [];                                              // ★검색 실패가 원고 생성을 막지 않는다
  }
}

/**
 * 검색 결과를 2번 통로(campaign.source)에 넣을 한 덩이 글로 만든다.
 * 출처(책 이름)를 붙여 준다 — 모델이 무엇을 근거로 쓰는지 알게.
 * @returns {Promise<{text:string, used:Array, chars:number}>}
 */
async function searchAsSource(query, topK) {
  const hits = await search(query, topK);
  if (!hits.length) return { text: '', used: [], chars: 0 };
  const text = hits
    .map((h) => '[대표님 「' + h.book + '」에서]\n' + h.content)
    .join('\n\n');
  return {
    text,
    used: hits.map((h) => ({ book: h.book, score: Math.round(h.score * 1000) / 1000, chars: h.content.length })),
    chars: text.length,
  };
}

module.exports = { search, searchAsSource, configured, INDEX, NS, EMBED_MODEL, TOPK, PER_CHUNK, MIN_SCORE };
