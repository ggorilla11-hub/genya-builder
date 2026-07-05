// ─────────────────────────────────────────────────────────────
// yakgwan_module.js — 약관 창고(RAG) 독립 모듈 ★메인에 "꽂는" 부품
// 무엇을·왜: 약관 질문 → Pinecone 약관 네임스페이스에서 근거 검색 → 쉽게 설명 + 출처(페이지).
//   창고에 없으면 지어내지 않고 "확인 필요". 어디서든 require 한 줄로 꽂아 쓴다.
// 사용: const { askYakgwan } = require('.../yakgwan_module'); const r = await askYakgwan('무보험차상해?');
//        r = { found, answer, sources:['삼성화재 … p.27'], pages:[27,…] }
//
// ★공통 자산(전 회원 공유 지식) — 고객 데이터 아님. 공개약관·참조용·출처표시. /parksugeun 무접촉.
// ★격리: 인덱스 'genya-knowledge'의 약관 전용 네임스페이스만 읽음(직업지식 네임스페이스 무접촉).
// ─────────────────────────────────────────────────────────────
'use strict';
const RAGSRV = '';
try{require('dotenv').config();}catch(e){}
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

const INDEX = 'genya-knowledge';
const NAMESPACE = 'yakgwan_samsung_auto_2025';
const EMBED_MODEL = 'text-embedding-3-small';   // ★임베딩은 OpenAI 유지(Pinecone 벡터가 이 모델로 만들어짐 — 바꾸면 검색 깨짐)
const CHAT_MODEL = 'gpt-4o-mini';               // 답변생성 폴백용(Claude 실패 시)
const ANSWER_MODEL = 'claude-sonnet-5';         // ★답변 생성 = Claude Sonnet 5
const SOURCE = '삼성화재 개인용 자동차보험 2025-08-16';
const MIN_SCORE = 0.28;

let _oa = null, _ix = null, _an = null;
function clients() {
  if (!_oa) _oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  if (!_ix) _ix = new Pinecone({ apiKey: process.env.PINECONE_API_KEY }).index(INDEX).namespace(NAMESPACE);
  if (!_an) { try { _an = new (require('@anthropic-ai/sdk'))({ apiKey: process.env.ANTHROPIC_API_KEY }); } catch (e) { _an = null; } }
  return { oa: _oa, ix: _ix, an: _an };
}

const SYS = `너는 보험설계사를 돕는 비서 "지니야"다. 아래 [약관 발췌]만 근거로 질문에 쉽게(비유 곁들여) 답한다.
규칙: ① 발췌에 있는 내용만 사용, 절대 지어내지 않는다. ② 발췌에 답이 없으면 "이 약관 발췌에는 없어요 — 원문 확인이 필요해요"라고만 답한다. ③ 구체 수치·지급조건은 발췌 그대로. 출처 페이지는 프론트가 붙이니 본문엔 넣지 마라.`;

/** 약관 질문 → 근거+출처 답. 창고에 없으면 found=false + "확인 필요". */
async function askYakgwan(question) {
  if (!question || !String(question).trim()) throw new Error('question 비어있음');
  const { oa, ix, an } = clients();
  const emb = await oa.embeddings.create({ model: EMBED_MODEL, input: [String(question)] });
  const res = await ix.query({ vector: emb.data[0].embedding, topK: 4, includeMetadata: true });
  const matches = (res.matches || []).filter((m) => m.metadata && m.metadata.text);
  const top = matches[0];

  if (!top || top.score < MIN_SCORE) {
    return { found: false, score: top ? top.score : null, answer: '이 약관 창고(삼성화재 자동차보험)에서는 근거를 못 찾았어요 — 원문 확인이 필요해요. (지어내지 않음)', sources: [], pages: [] };
  }
  const context = matches.map((m, i) => `(${i + 1}) [p.${m.metadata.page}] ${m.metadata.text}`).join('\n\n');
  const userMsg = `[질문] ${question}\n\n[약관 발췌]\n${context}`;
  let answer = '';
  try {
    // ★답변 생성 = Claude Sonnet 5 (system은 별도 파라미터)
    if (!an) throw new Error('anthropic 미설정');
    const ar = await an.messages.create({ model: ANSWER_MODEL, max_tokens: 600, system: SYS, messages: [{ role: 'user', content: userMsg }] });
    answer = (ar.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!answer) throw new Error('빈 응답');
  } catch (e) {
    // ★폴백: OpenAI gpt-4o-mini — 약관 답변이 끊기지 않게
    const r = await oa.chat.completions.create({
      model: CHAT_MODEL, temperature: 0.3, max_tokens: 480,
      messages: [{ role: 'system', content: SYS }, { role: 'user', content: userMsg }],
    });
    answer = (r.choices[0].message.content || '').trim();
  }
  return {
    found: true,
    score: top.score,
    answer: answer,
    sources: matches.map((m) => `${SOURCE} p.${m.metadata.page}`),
    pages: matches.map((m) => m.metadata.page),
  };
}

module.exports = { askYakgwan, SOURCE, NAMESPACE };
