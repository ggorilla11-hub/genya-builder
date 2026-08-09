// ─────────────────────────────────────────────────────────────
// hunters/naverKin.js — 🟢 네이버 지식iN 담당 기자
//
// 왜 1순위인가(실측 근거): 유튜브는 경쟁자 6건을 걸러내니 주식 댓글 1건만 남았다.
//   대표님 타겟(신혼·30대)이 거의 없다. 반면 지식iN은 재무 질문이 매일 올라오고,
//   ★질문 자체가 "답을 원한다"는 뜻이라 온도가 구조적으로 높다.
//
// ★합법: 네이버 공식 검색 API(developers.naver.com)만 사용.
//   크롤링·로그인 우회 없음. 공개 검색 결과만 읽는다.
//   게시 함수 없음(규약이 등록 자체를 거부) — 답글은 초안까지, 게시는 사람이 직접.
//
// ★개인정보: 지식iN 검색 API는 질문 제목·요약·링크만 준다(작성자 신원 없음).
//   서버에 저장하지 않고 화면으로 흘려보낸다.
// ─────────────────────────────────────────────────────────────
'use strict';
const C = require('./_contract');
const S = require('./_scoring');

const ID_ENV = 'NAVER_CLIENT_ID';
const SECRET_ENV = 'NAVER_CLIENT_SECRET';
const API = 'https://openapi.naver.com/v1/search/kin.json';

// ★한 채널에 AI 여러 명 — 담당(beat)이 다르면 검색이 겹치지 않는다.
//   대표님 타겟이 1·2번, 일반 재무가 3번.
const agents = [
  { name: '네이버지식인AI-1', beat: ['신혼 재무설계', '신혼부부 보험', '신혼집 대출'], persona: '공감형 — 결혼 준비의 막막함을 먼저 읽는다' },
  { name: '네이버지식인AI-2', beat: ['30대 재테크', '30대 노후준비', '결혼 준비 자금'], persona: '꼼꼼형 — 금액·시기를 구체적으로 본다' },
  { name: '네이버지식인AI-3', beat: ['목돈 마련', '연금저축', '재무상담'], persona: '탐색형 — 넓게 훑어 놓친 질문을 줍는다' },
];

function probe() {
  const id = process.env[ID_ENV], sec = process.env[SECRET_ENV];
  if (!id || !sec) {
    return { ok: false, off: true, reason: `${ID_ENV}·${SECRET_ENV} 미설정 — developers.naver.com에서 '검색' API 등록 후 Render에 넣으면 켜집니다.` };
  }
  return { ok: true, quotaNote: '검색 API 25,000회/일(무료)' };
}

/** 검색어: 담당(beat) 우선, 없으면 내 키워드 + 기본 */
function _keywords(persona, agent, opts) {
  // ★tryfind 신호가 있을 때만 검색어 표가 beat를 이긴다(없으면 아래는 예전 그대로 · 밤샘 무접촉)
  if (opts && opts.useJobKeywords) { const jk = C.jobKeywords(persona, agent, 6); if (jk.length) return jk; }
  const beat = (agent && Array.isArray(agent.beat)) ? agent.beat : [];
  if (beat.length) return beat.slice(0, 4);
  const mine = ((persona && persona.키워드) || []).map((k) => String(k).replace(/^#/, '').trim()).filter(Boolean);
  return mine.length ? mine.slice(0, 3) : ['신혼 재무설계', '30대 재테크', '목돈 마련'];
}

// 네이버 응답은 <b>강조</b>·HTML 엔티티가 섞여 온다 → 사람이 읽는 글로 정리
function _clean(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/** 순회 — 공식 검색 API로 공개 질문글 수집(읽기만). 판별·채점은 편집장이 한다. */
async function search(persona, opts) {
  opts = opts || {};
  const id = process.env[ID_ENV], sec = process.env[SECRET_ENV];
  if (!id || !sec) return [];
  const out = [];
  const max = opts.max || 30;
  for (const kw of _keywords(persona, opts.agent, opts)) {
    let j;
    try {
      const r = await fetch(`${API}?query=${encodeURIComponent(kw)}&display=20&sort=date`, {
        headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': sec },
      });
      j = await r.json();
    } catch (e) { continue; }
    if (j && j.errorCode) throw new Error(`네이버 API: ${j.errorMessage || j.errorCode}`);
    (j.items || []).forEach((it) => {
      const title = _clean(it.title);
      const desc = _clean(it.description);
      // 제목+본문요약을 합쳐 판별·채점에 쓴다(질문 의도가 제목에 많이 담긴다)
      const text = (title + (desc ? (' — ' + desc) : '')).slice(0, 300);
      if (!text) return;
      out.push(C.makeLead({
        id: C.makeId('NK', it.link || title),
        hunter: 'naverKin', source: '네이버 지식iN',
        author: '',                       // ★지식iN 검색 API는 작성자 신원을 주지 않는다(개인정보 최소)
        text,
        sourceUrl: it.link || '',
        postedAt: '',                     // 검색 API는 작성일을 안 준다(sort=date로 최신순만 보장)
        context: { keyword: kw, title },
      }));
    });
    if (out.length >= max) return out.slice(0, max);
  }
  return out.slice(0, max);
}

function enrich(lead) { return lead; }

/** ★추천 근거 — evidence는 반드시 본문에서 그대로 따온다(편집장이 원문 대조·위조면 반려) */
function reason(lead, persona) {
  const t = String(lead.text || '');
  const sc = S.score(t, { hasUrl: !!lead.sourceUrl, persona });
  const parts = t.split(/[.!?\n—]/).map((x) => x.trim()).filter(Boolean);
  const pick = parts.find((s) => /(신혼|결혼|30대|고민|막막|어떻게|궁금|모르겠|추천|해야|얼마)/.test(s)) || parts[0] || t.slice(0, 60);
  return C.makeReason({
    why: sc.notes.length ? sc.notes.slice(0, 2).join(' · ') : '지식iN 질문 = 답을 구하는 사람',
    evidence: pick,
    signals: sc.notes.concat(['지식iN 질문글']),
    fitScore: sc.total,
  });
}

/** 답글 초안 가이드 — ★게시하지 않는다. 사람이 확인 후 직접 올린다. */
function draft(persona, lead) {
  const tone = (persona && persona.말투) || '따뜻하고 단정하게';
  const diff = (persona && persona.차별점) || '';
  return {
    guide: `${tone}. ${diff ? '차별점: ' + diff + '. ' : ''}지식iN 답변체로 3~4문장. `
      + `질문에 먼저 직접 답하고 → 놓치기 쉬운 점 하나 → 무료 진단 제안 → [링크]. `
      + `광고 느낌·강매·전화번호 금지(지식iN은 홍보성 답변을 제재한다).`,
    lead,
  };
}

module.exports = { key: 'naverKin', label: '🟢 네이버 지식iN', agents, probe, search, enrich, reason, draft };
