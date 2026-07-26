// ─────────────────────────────────────────────────────────────
// hunters/googleSearch.js — 🔎 구글 검색 담당 기자
//
// ★합법: 구글 공식 Custom Search JSON API만 사용. 크롤링·스크래핑 없음.
// ★게시 함수 없음 — 답글은 초안까지, 게시는 사람이 직접.
//
// ★정직한 기대치: 구글 검색 결과는 상당수가 업체·블로그 홍보 페이지다.
//   경쟁자 필터에서 많이 걸러진다. 구글의 쓸모는 ★네이버가 놓친 커뮤니티
//   (디시·클리앙·뽐뿌 등 공개 게시글)를 검색으로 주워오는 것이다.
//
// ★비용 주의: 무료 100회/일. AI 1명 × 키워드 4개 = 1회 발굴에 4회 소모 → 하루 25회 발굴.
//   그래서 AI를 1명만 둔다(네이버는 무료 25,000회라 여러 명 둘 수 있다).
// ─────────────────────────────────────────────────────────────
'use strict';
const C = require('./_contract');
const S = require('./_scoring');

const KEY_ENV = 'GOOGLE_CSE_KEY';
const CX_ENV = 'GOOGLE_CSE_CX';
const API = 'https://www.googleapis.com/customsearch/v1';

const agents = [
  { name: '구글검색AI-1', beat: ['신혼부부 재테크 고민 후기', '30대 재무상담 받아본', '목돈 모으기 조언 부탁', '연금 준비 막막'], persona: '탐색형 — 네이버가 못 보는 커뮤니티 글을 줍는다' },
];

function probe() {
  const k = process.env[KEY_ENV], cx = process.env[CX_ENV];
  if (!k || !cx) {
    return { ok: false, off: true, reason: `${KEY_ENV}·${CX_ENV} 미설정 — 구글 클라우드에서 'Custom Search API' 키 + programmablesearchengine.google.com에서 검색엔진 ID를 만들어 Render에 넣으면 켜집니다.` };
  }
  return { ok: true, quotaNote: 'Custom Search 100회/일(무료)' };
}

function _keywords(persona, agent) {
  const beat = (agent && Array.isArray(agent.beat)) ? agent.beat : [];
  if (beat.length) return beat.slice(0, 4);
  const mine = ((persona && persona.키워드) || []).map((k) => String(k).replace(/^#/, '').trim()).filter(Boolean);
  return mine.length ? mine.slice(0, 3) : ['신혼부부 재테크 고민', '30대 재무상담', '목돈 모으기 조언'];
}

function _clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

async function search(persona, opts) {
  opts = opts || {};
  const k = process.env[KEY_ENV], cx = process.env[CX_ENV];
  if (!k || !cx) return [];
  const out = [];
  const max = opts.max || 30;
  for (const kw of _keywords(persona, opts.agent)) {
    let j;
    // ★타임아웃 필수 — 구글이 매달리면 발굴 전체가 멈춘다(2026-07-27 사고)
    try {
      // lr=lang_ko 한국어만 · dateRestrict=m3 최근 3개월 · num=10 (무료 한도 아끼기)
      j = await C.fetchJson(`${API}?key=${encodeURIComponent(k)}&cx=${encodeURIComponent(cx)}`
        + `&q=${encodeURIComponent(kw)}&num=10&lr=lang_ko&dateRestrict=m3`);
    } catch (e) { if (/응답 없음/.test(e.message)) throw e; continue; }
    if (j && j.error) throw new Error(`구글 API: ${(j.error && j.error.message) || 'error'}`);
    (j.items || []).forEach((it) => {
      const title = _clean(it.title);
      const snip = _clean(it.snippet);
      const text = (title + (snip ? (' — ' + snip) : '')).slice(0, 300);
      if (!text) return;
      out.push(C.makeLead({
        id: C.makeId('GS', it.link || title),
        hunter: 'googleSearch', source: '구글 검색',
        author: _clean(it.displayLink || ''),   // 도메인(개인 신원 아님)
        text,
        sourceUrl: it.link || '',
        postedAt: '',
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
  const pick = parts.find((s) => /(신혼|결혼|30대|고민|막막|어떻게|궁금|모르겠|추천|해야|얼마|걱정)/.test(s)) || parts[0] || t.slice(0, 60);
  return C.makeReason({
    why: sc.notes.length ? sc.notes.slice(0, 2).join(' · ') : '검색으로 찾은 공개 고민글',
    evidence: pick,
    signals: sc.notes.concat(['구글 검색']),
    fitScore: sc.total,
  });
}

function draft(persona, lead) {
  const tone = (persona && persona.말투) || '따뜻하고 단정하게';
  const diff = (persona && persona.차별점) || '';
  return {
    guide: `${tone}. ${diff ? '차별점: ' + diff + '. ' : ''}해당 커뮤니티 말투에 맞춰 3문장. `
      + `글 내용을 먼저 짚어 공감 → 도움될 한 가지 → 무료 진단 제안 → [링크]. `
      + `★사이트마다 홍보 규정이 다르다. 올리기 전에 그 커뮤니티 규정을 꼭 확인하세요.`,
    lead,
  };
}

module.exports = { key: 'googleSearch', label: '🔎 구글 검색', agents, probe, search, enrich, reason, draft };
