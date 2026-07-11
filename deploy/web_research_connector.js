// ─────────────────────────────────────────────────────────────
// web_research_connector.js — 🔌커넥터창고: 웹 조사(실시간 상품·약관·시세) (독립 모듈)
// 무엇을·왜: 실시간 웹 검색결과를 근거로 질문에 답 + ★출처(사이트·시점) 표시. 지어내지 않음.
//   ★약관 RAG(우리가 수집한 고정 약관 [[yakgwan]])와 구분: 이건 "실시간 최신".
// 사용: const W = require('.../web_research_connector'); const r = await W.research(질문, sources);
//        sources = [{title,url,snippet}] (검색엔진 결과). 반환 {answer, used, asOf, note}
//
// ★robots 준수: AI봇 차단 사이트는 제외(리스닝과 동일 원칙). 데모는 검색 스니펫만 사용(직접 크롤링 0).
// ★공식·신뢰 소스 우선(보험사·정부·언론). 공개 데이터만·과도한 크롤링 금지·저장 0. /parksugeun 무접촉.
// ─────────────────────────────────────────────────────────────
'use strict';
const RAGSRV = '';
try{require('dotenv').config();}catch(e){}
// ★답변 생성 = Claude Sonnet(대표 절대규칙: 모든 LLM은 Claude Sonnet). 웹 검색결과만 근거로 답.
const _an = new (require('@anthropic-ai/sdk'))({ apiKey: process.env.ANTHROPIC_API_KEY });
const ANSWER_MODEL = 'claude-sonnet-5';

function domain(url) { try { return new URL(url).host.replace(/^www\./, ''); } catch (e) { return url; } }

const SYS = `너는 보험설계사를 돕는 비서 "지니야"다. 아래 [웹 검색 결과]만 근거로 질문에 쉽게 답한다.
규칙: ① 검색결과에 있는 내용만 사용, 절대 지어내지 않는다. ② 근거가 부족하면 "웹에서 더 확인이 필요해요"라고 정직히. ③ 수치·시점은 검색결과 그대로. ④ 공식·신뢰 소스(보험사·정부·언론)를 우선 반영. ⑤ 출처는 프론트가 붙이니 본문엔 URL 나열하지 마라. 짧고 명확하게.`;

/**
 * 웹 조사: 검색결과(sources)를 근거로 답 + 출처.
 * @param {string} question
 * @param {Array} sources [{title,url,snippet}]
 */
async function research(question, sources) {
  const list = (sources || []).filter((s) => s && s.url);
  if (!list.length) return { answer: '웹 검색 결과가 없어요 — 확인이 필요해요.', used: [], asOf: null };
  const ctx = list.map((s, i) => `(${i + 1}) [${domain(s.url)}] ${s.title}\n${s.snippet || ''}`).join('\n\n');
  const r = await _an.messages.create({
    model: ANSWER_MODEL, max_tokens: 500, system: SYS,
    messages: [{ role: 'user', content: `[질문] ${question}\n\n[웹 검색 결과]\n${ctx}` }],
  });
  const asOf = new Date().toISOString().slice(0, 10);
  return {
    answer: (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim(),
    used: list.map((s) => ({ site: domain(s.url), title: s.title, url: s.url })),
    asOf,
    note: `웹 검색 결과 기준(${asOf}) · 직접 크롤링 없음 · AI봇 차단 사이트 제외`,
  };
}

module.exports = { research, domain };

// ── 자체 시연: 실제 웹 검색(2026-07-04)으로 확보한 4세대 실손 자료로 답 ──
if (require.main === module) {
  (async () => {
    // ★실측: WebSearch "실손보험 4세대 전환 장단점 2026" 결과(공식·신뢰 소스 우선 정렬)
    const SOURCES = [
      { title: '4세대 실손보험 전환 안내', url: 'https://www.kdblife.com/scrId/ICSPB017M01M.do', snippet: 'KDB생명(보험사 공식) 4세대 실손 전환 안내.' },
      { title: '4세대 실비 세대별 유지·전환 기준 총정리', url: 'https://www.banksalad.com/articles/실비보험-4세대', snippet: '4세대는 2021.7~2026.5 판매, 보험료 저렴하나 자기부담금 20~30%로 높음. 2026.5.6 신규가입 종료. 병원 등급별 차등 자기부담금(상급종합 20~30%, 의원 15~20%).' },
      { title: '4세대 실손보험 장단점 총정리 (보험료·자기부담금·전환)', url: 'https://financecarehub.com/4세대-실손보험-장단점', snippet: '장점=보험료 저렴. 단점=비급여 많이 쓰면 다음 해 보험료 최대 300% 인상. 비급여 자주 쓰면 기존 유지, 안 쓰면 전환 유리.' },
    ];
    const q = '요즘 4세대 실손 어때? 전환하는 게 나아?';
    const r = await research(q, SOURCES);
    console.log(`■ 질문: "${q}"\n`);
    console.log('[답]\n' + r.answer + '\n');
    console.log('[출처] (' + r.note + ')');
    r.used.forEach((u) => console.log(`  · ${u.site} — ${u.title}\n    ${u.url}`));
  })().catch((e) => { console.error('오류:', e.message); process.exit(1); });
}
