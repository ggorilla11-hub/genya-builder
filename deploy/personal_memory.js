'use strict';
// ─────────────────────────────────────────────────────────────
// personal_memory.js — 개인화 벡터 메모리 (v4.0 Step 2-A)
// 무엇을·왜: 대표(레이어1)와 대표의 각 고객(레이어2)을 "네임스페이스"로 완전 분리해
//   Pinecone 벡터DB에 대화·문서·생성물을 저장하고, 매 대화 때 유사한 기억을 Top-K로 꺼내
//   시스템 프롬프트에 주입한다 → "홍길동님 요즘 어때?" / "어제 만든 자료 뭐였지?"에 응답.
//
// ★네임스페이스: owner_{ownerId}:representative  /  owner_{ownerId}:customer:{customerId}
//   예) owner_ggorilla11:representative · owner_ggorilla11:customer:hong-gd-01
// ★임베딩: OpenAI text-embedding-3-small (1536차원, 저렴) · 메트릭 cosine
// ★인덱스: ohwant-genya (serverless aws us-east-1) · 최초 사용 시 자동 생성(ensureIndex)
// ★안전: PINECONE_API_KEY 없으면 전부 no-op(대화 안 끊김). 저장 실패도 대화를 막지 않음(fire-and-forget).
// ★분리 원칙(명세서 8-1): 네임스페이스로 대표·고객 강제 분리. 서로 접근 불가.
// ─────────────────────────────────────────────────────────────

let _Pinecone = null;
try { _Pinecone = require('@pinecone-database/pinecone').Pinecone; } catch (e) { /* SDK 없으면 no-op */ }
const OpenAI = require('openai');

const INDEX_NAME = process.env.PINECONE_INDEX || 'ohwant-genya';
const EMBED_MODEL = 'text-embedding-3-small'; // 1536차원
const EMBED_DIM = 1536;
const DEFAULT_TOPK = 5;
const MIN_SCORE = 0.2; // 이 이하 유사도는 무관하다고 보고 버림

let _pc = null, _index = null, _oa = null, _ready = false;

function configured() { return !!(_Pinecone && process.env.PINECONE_API_KEY && process.env.OPENAI_API_KEY); }
function _client() { if (!_pc && configured()) _pc = new _Pinecone({ apiKey: process.env.PINECONE_API_KEY }); return _pc; }
function _openai() { if (!_oa) _oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); return _oa; }

// ASCII 안전 슬러그(네임스페이스·id용). 대표=이메일앞부분, 고객=Sheets customer_id(예 hong-gd-01) 가정.
function _slug(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'unknown';
}
// 네임스페이스 규칙(명세서 2-2)
function ns(ownerId, scope, customerId) {
  const o = _slug(ownerId);
  if (scope === 'customer' && customerId) return `owner_${o}:customer:${_slug(customerId)}`;
  return `owner_${o}:representative`;
}

// 인덱스 준비(없으면 생성). 최초 1회만 실제 호출.
async function ensureIndex() {
  if (_ready) return _index;
  const pc = _client(); if (!pc) throw new Error('PINECONE_API_KEY 미설정');
  const list = await pc.listIndexes();
  const exists = (list.indexes || []).some((x) => x.name === INDEX_NAME);
  if (!exists) {
    await pc.createIndex({
      name: INDEX_NAME, dimension: EMBED_DIM, metric: 'cosine',
      spec: { serverless: { cloud: 'aws', region: 'us-east-1' } }, waitUntilReady: true,
    });
  }
  _index = pc.index(INDEX_NAME); _ready = true; return _index;
}

async function embed(text) {
  const r = await _openai().embeddings.create({ model: EMBED_MODEL, input: String(text || '').slice(0, 8000) });
  return r.data[0].embedding;
}

// ── 저장: 매 대화/문서/생성물 → 벡터 저장. 비동기 fire-and-forget 권장(응답 지연 0). ──
//   scope: 'representative' | 'customer'  ·  source: 'dialog' | 'upload' | 'generated'
async function saveMemory({ ownerId, scope, customerId, text, source, summary, id }) {
  if (!configured() || !text || !ownerId) return null;
  try {
    const idx = await ensureIndex();
    const vector = await embed(summary || text);
    const meta = {
      owner_id: _slug(ownerId), scope: scope || 'representative',
      customer_id: customerId ? _slug(customerId) : '', source: source || 'dialog',
      timestamp: new Date().toISOString(), summary: String(summary || text).slice(0, 500),
      text: String(text).slice(0, 1500),
    };
    const vid = id || (Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    await idx.namespace(ns(ownerId, scope, customerId)).upsert([{ id: vid, values: vector, metadata: meta }]);
    return { id: vid, ns: ns(ownerId, scope, customerId) };
  } catch (e) { return null; } // 저장 실패가 대화를 막지 않는다
}
// 응답 지연 0: 호출부는 await 없이 이 래퍼로 던지고 잊는다.
function saveMemoryAsync(args) { try { saveMemory(args).catch(function () {}); } catch (e) {} }

// ── 조회: 사용자 입력과 유사한 기억 Top-K → 프롬프트 주입용 컨텍스트 문자열 ──
async function recallContext({ ownerId, scope, customerId, query, topK }) {
  if (!configured() || !query || !ownerId) return '';
  try {
    const idx = await ensureIndex();
    const vector = await embed(query);
    const res = await idx.namespace(ns(ownerId, scope, customerId)).query({ vector, topK: topK || DEFAULT_TOPK, includeMetadata: true });
    const rows = (res.matches || []).filter((m) => (m.score || 0) >= MIN_SCORE);
    if (!rows.length) return '';
    return rows.map((m) => { const md = m.metadata || {}; return `· [${String(md.timestamp || '').slice(0, 10)}·${md.source || ''}] ${md.summary || md.text || ''}`; }).join('\n');
  } catch (e) { return ''; }
}

module.exports = { configured, ns, ensureIndex, embed, saveMemory, saveMemoryAsync, recallContext, INDEX_NAME, EMBED_MODEL, EMBED_DIM, DEFAULT_TOPK };

// ── 자체 점검(로컬): node personal_memory.js ──
if (require.main === module) {
  console.log('personal_memory 자체점검');
  console.log('  configured:', configured(), '(PINECONE_API_KEY', process.env.PINECONE_API_KEY ? '있음' : '없음, 코드만 준비됨)');
  console.log('  ns(대표):', ns('ggorilla11', 'representative'));
  console.log('  ns(고객):', ns('ggorilla11', 'customer', 'hong-gd-01'));
  console.log('  index:', INDEX_NAME, '· dim', EMBED_DIM, '· model', EMBED_MODEL);
}
