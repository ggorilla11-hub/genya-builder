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
const crypto = require('crypto');

const INDEX_NAME = process.env.PINECONE_INDEX || 'ohwant-genya';
const EMBED_MODEL = 'text-embedding-3-small'; // 1536차원
const EMBED_DIM = 1536;
const DEFAULT_TOPK = 5;
const MIN_SCORE = 0.1; // 이 이하 유사도는 무관하다고 보고 버림(한국어 약연관도 반영 위해 낮춤)

let _pc = null, _index = null, _oa = null, _ready = false;

function configured() { return !!(_Pinecone && process.env.PINECONE_API_KEY && process.env.OPENAI_API_KEY); }
function _client() { if (!_pc && configured()) _pc = new _Pinecone({ apiKey: process.env.PINECONE_API_KEY }); return _pc; }
function _openai() { if (!_oa) _oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); return _oa; }

// ASCII 안전 슬러그(네임스페이스·id용). 대표=이메일앞부분, 고객=이름(홍길동) 또는 Sheets customer_id(hong-gd-01).
// ★한글안전: 예전 방식은 한글을 전부 버려서 "홍길동"·"김철수"가 모두 'unknown'으로 뭉개졌다(고객 분리 불가).
//   이제 비ASCII(한글 등)가 섞이면 원문 SHA1 앞 10자리를 붙여 이름마다 고유·안정 슬러그를 만든다.
//   예) '홍길동'→'h1a2b3c4d5' · '홍길동A'→'a-h...' · 순수 ASCII('ggorilla11')는 그대로(기존 데이터 호환).
function _slug(s) {
  const raw = String(s == null ? '' : s).trim();
  const ascii = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const hasNonAscii = /[^\x00-\x7F]/.test(raw);
  if (hasNonAscii || !ascii) {
    if (!raw) return 'unknown';
    const h = 'h' + crypto.createHash('sha1').update(raw).digest('hex').slice(0, 10);
    return (ascii ? ascii + '-' + h : h).slice(0, 64);
  }
  return ascii.slice(0, 64);
}
// 네임스페이스 규칙(명세서 2-2)
function ns(ownerId, scope, customerId) {
  const o = _slug(ownerId);
  if (scope === 'customer' && customerId) return `owner_${o}:customer:${_slug(customerId)}`;
  return `owner_${o}:representative`;
}

// ── 고객 지칭 감지: 대화에서 "홍길동님" 같은 특정 고객 언급 → 고객 이름 반환(없으면 ''). ──
//   ★분리 원칙(명세서 8-1): 고객이 지칭되면 그 고객 네임스페이스로 회상·저장을 라우팅한다.
//   ★호칭성 단어(대표/회장/고객 등)는 고객이 아니므로 제외 → "대표님"을 고객으로 오인하지 않는다.
const _HONORIFIC_STOP = /^(대표|회장|사장|선생|고객|손님|여러분|사모|실장|부장|과장|팀장|이사|의원|기사|사부|어머|아버|당신|본인|우리|저희)/;
function detectCustomer(q) {
  const m = String(q || '').match(/([가-힣]{2,4})님/);
  if (!m) return '';
  const name = m[1];
  if (_HONORIFIC_STOP.test(name)) return '';
  return name;
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

// ── 🛡️ 수문장(이벤트 브릿지): 이 방에서 실제 일어난 이벤트(명단 업로드·시트 생성/수정·로그인·발송·음성 등)를
//    개인화 기억에 기록 → 매 대화에서 지니야가 "방금 뭐 했지"를 자동 인지. 실제 발생분만 기록(지어내기 아님).
//    type: roster_upload|file_attach|sheet_create|sheet_update|customer_add|customer_delete|login|voice_call|approval_send|generated 등
async function recordEvent({ ownerId, type, summary, data, source }) {
  if (!configured() || !ownerId || !type) return null;
  const desc = summary || (String(type) + (data ? (' ' + JSON.stringify(data).slice(0, 300)) : ''));
  return saveMemory({ ownerId, scope: 'representative', source: source || 'event', text: '[이벤트·' + type + '] ' + desc, summary: '[이 방 이벤트] ' + desc });
}
function recordEventAsync(args) { try { recordEvent(args).catch(function () {}); } catch (e) {} }
// ── 🛡️ 최근 이벤트 회상: 매 대화에 주입할 "지금 이 방에서 최근 일어난 일"(source 무관·최근순). ──
async function recallRecentEvents({ ownerId, limit }) {
  if (!configured() || !ownerId) return '';
  try {
    const idx = await ensureIndex();
    const vector = await embed('방금 최근에 이 방에서 일어난 일·업로드·생성·수정·발송');
    const res = await idx.namespace(ns(ownerId, 'representative')).query({ vector, topK: (limit || 5) * 4, includeMetadata: true });
    const rows = (res.matches || []).map((m) => m.metadata || {})
      .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
      .slice(0, limit || 5);
    if (!rows.length) return '';
    return rows.map((md) => `· [${String(md.timestamp || '').slice(0, 16).replace('T', ' ')}·${md.source || ''}] ${md.summary || md.text || ''}`).join('\n');
  } catch (e) { return ''; }
}

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

// ── 최근순 조회 (시나리오2 "어제 만든 자료 뭐였지?"): 순수 유사도가 아니라 최근순 정렬 ──
//   ★"어제/최근/만든 자료" 같은 시간·회상 질의는 의미검색이 약함 → source 필터 + timestamp 내림차순.
const RECENCY_RE = /(어제|저번|지난|과거|이전|그때|최근|방금|아까|만든|만들었?|작성한|생성)/;
function isRecencyQuery(q) { return RECENCY_RE.test(String(q || '')); }
async function recallRecent({ ownerId, scope, customerId, query, source, limit }) {
  if (!configured() || !ownerId) return '';
  try {
    const idx = await ensureIndex();
    const vector = await embed(query || '자료');
    const filter = source ? { source: { '$eq': source } } : undefined;
    const res = await idx.namespace(ns(ownerId, scope, customerId)).query({ vector, topK: (limit || DEFAULT_TOPK) * 4, includeMetadata: true, filter });
    const rows = (res.matches || []).map((m) => m.metadata || {})
      .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
      .slice(0, limit || DEFAULT_TOPK);
    if (!rows.length) return '';
    return rows.map((md) => `· [${String(md.timestamp || '').slice(0, 10)}·${md.source || ''}] ${md.summary || md.text || ''}`).join('\n');
  } catch (e) { return ''; }
}
// ★스마트 조회: 시간·회상 질의면 최근순(생성물 우선), 아니면 의미검색. 대화 배선에서 이걸 쓴다.
async function recallSmart({ ownerId, scope, customerId, query, topK }) {
  if (isRecencyQuery(query)) {
    // 출처 감지: "올린/업로드"→upload, "만든/생성/결과지"→generated, 그 외→전체 최근순
    let src;
    if (/올린|올렸|업로드|받은|받았/.test(String(query || ''))) src = 'upload';
    else if (/만든|만들|생성|작성|제안서|결과지|리포트|초안/.test(String(query || ''))) src = 'generated';
    const r = await recallRecent({ ownerId, scope, customerId, query, source: src, limit: topK });
    if (r) return r;
    return recallRecent({ ownerId, scope, customerId, query, limit: topK }); // 못 찾으면 전체 최근순
  }
  return recallContext({ ownerId, scope, customerId, query, topK });
}

module.exports = { configured, ns, detectCustomer, ensureIndex, embed, saveMemory, saveMemoryAsync, recordEvent, recordEventAsync, recallRecentEvents, recallContext, recallRecent, recallSmart, isRecencyQuery, INDEX_NAME, EMBED_MODEL, EMBED_DIM, DEFAULT_TOPK };

// ── 자체 점검(로컬): node personal_memory.js ──
if (require.main === module) {
  console.log('personal_memory 자체점검');
  console.log('  configured:', configured(), '(PINECONE_API_KEY', process.env.PINECONE_API_KEY ? '있음' : '없음, 코드만 준비됨)');
  console.log('  ns(대표):', ns('ggorilla11', 'representative'));
  console.log('  ns(고객 ASCII):', ns('ggorilla11', 'customer', 'hong-gd-01'));
  console.log('  ns(고객 한글 홍길동):', ns('ggorilla11', 'customer', '홍길동'));
  console.log('  ns(고객 한글 김철수):', ns('ggorilla11', 'customer', '김철수'), '← 홍길동과 달라야 정상(분리)');
  console.log('  detectCustomer("홍길동님 요즘 어때?"):', JSON.stringify(detectCustomer('홍길동님 요즘 어때?')));
  console.log('  detectCustomer("대표님 안녕?") [호칭제외]:', JSON.stringify(detectCustomer('대표님 안녕?')));
  console.log('  index:', INDEX_NAME, '· dim', EMBED_DIM, '· model', EMBED_MODEL);
}
