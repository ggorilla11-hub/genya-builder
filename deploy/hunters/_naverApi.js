// ─────────────────────────────────────────────────────────────
// hunters/_naverApi.js — 네이버 검색 API 공용 부품 (기자가 아님·_ 로 시작하므로 자동등록 제외)
//
// 네이버 검색 API는 지식iN·카페·블로그가 ★같은 키 한 세트를 쓴다.
//   지식iN  /v1/search/kin.json
//   카페    /v1/search/cafearticle.json
//   블로그  /v1/search/blog.json
// → 키 하나(NAVER_CLIENT_ID·NAVER_CLIENT_SECRET)면 채널 3개가 동시에 켜진다.
//
// ★합법: 공식 오픈API의 공개 검색 결과만 읽는다. 크롤링·로그인 우회 없음.
// ★게시 함수 없음 — 답글은 초안까지, 게시는 사람이 직접.
// ─────────────────────────────────────────────────────────────
'use strict';
const C = require('./_contract');
const S = require('./_scoring');

const ID_ENV = 'NAVER_CLIENT_ID';
const SECRET_ENV = 'NAVER_CLIENT_SECRET';

function creds() { return { id: process.env[ID_ENV], sec: process.env[SECRET_ENV] }; }

function probe() {
  const { id, sec } = creds();
  if (!id || !sec) {
    return { ok: false, off: true, reason: `${ID_ENV}·${SECRET_ENV} 미설정 — developers.naver.com에서 '검색' API 등록 후 Render에 넣으면 켜집니다.` };
  }
  return { ok: true, quotaNote: '검색 API 25,000회/일(무료·지식iN/카페/블로그 공용)' };
}

// 네이버 응답은 <b>강조</b>·HTML 엔티티가 섞여 온다 → 사람이 읽는 글로 정리
function clean(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/** 20260720 → 2026-07-20 (블로그만 작성일을 준다. 없으면 빈 문자열) */
function ymd(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** 검색어: 담당(beat) 우선 → 내 키워드 → 기본값 */
function keywords(persona, agent, fallback) {
  const beat = (agent && Array.isArray(agent.beat)) ? agent.beat : [];
  if (beat.length) return beat.slice(0, 4);
  const mine = ((persona && persona.키워드) || []).map((k) => String(k).replace(/^#/, '').trim()).filter(Boolean);
  return mine.length ? mine.slice(0, 3) : fallback;
}

/**
 * 네이버 채널 기자를 찍어내는 틀.
 * @param cfg {key, label, path, idPrefix, agents, fallbackKw, authorOf(item), postedAtOf(item), draftGuide}
 */
function makeNaverHunter(cfg) {
  const API = `https://openapi.naver.com/v1/search/${cfg.path}`;

  async function search(persona, opts) {
    opts = opts || {};
    const { id, sec } = creds();
    if (!id || !sec) return [];
    const out = [];
    const max = opts.max || 30;
    for (const kw of keywords(persona, opts.agent, cfg.fallbackKw)) {
      let j;
      try {
        const r = await fetch(`${API}?query=${encodeURIComponent(kw)}&display=20&sort=date`, {
          headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': sec },
        });
        j = await r.json();
      } catch (e) { continue; }
      if (j && j.errorCode) throw new Error(`네이버 API: ${j.errorMessage || j.errorCode}`);
      (j.items || []).forEach((it) => {
        const title = clean(it.title);
        const desc = clean(it.description);
        // 제목+요약을 합쳐 판별·채점에 쓴다(고민이 제목에 많이 담긴다)
        const text = (title + (desc ? (' — ' + desc) : '')).slice(0, 300);
        if (!text) return;
        out.push(C.makeLead({
          id: C.makeId(cfg.idPrefix, it.link || title),
          hunter: cfg.key, source: cfg.label.replace(/^\S+\s/, ''),
          author: cfg.authorOf ? cfg.authorOf(it) : '',
          text,
          sourceUrl: it.link || '',
          postedAt: cfg.postedAtOf ? cfg.postedAtOf(it) : '',
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
    const sc = S.score(t, { postedAt: lead.postedAt, hasUrl: !!lead.sourceUrl, persona });
    const parts = t.split(/[.!?\n—]/).map((x) => x.trim()).filter(Boolean);
    const pick = parts.find((s) => /(신혼|결혼|30대|고민|막막|어떻게|궁금|모르겠|추천|해야|얼마|걱정)/.test(s)) || parts[0] || t.slice(0, 60);
    return C.makeReason({
      why: sc.notes.length ? sc.notes.slice(0, 2).join(' · ') : cfg.defaultWhy,
      evidence: pick,
      signals: sc.notes.concat([cfg.signal]),
      fitScore: sc.total,
    });
  }

  /** 답글 초안 가이드 — ★게시하지 않는다. 사람이 확인 후 직접 올린다. */
  function draft(persona, lead) {
    const tone = (persona && persona.말투) || '따뜻하고 단정하게';
    const diff = (persona && persona.차별점) || '';
    return { guide: `${tone}. ${diff ? '차별점: ' + diff + '. ' : ''}${cfg.draftGuide}`, lead };
  }

  return { key: cfg.key, label: cfg.label, agents: cfg.agents, probe, search, enrich, reason, draft };
}

module.exports = { probe, clean, ymd, keywords, makeNaverHunter, ID_ENV, SECRET_ENV };
