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

// ★2026-07-27 "Rate limit exceeded" 사고 (블로그·뉴스가 통째로 실패)
//   원인: 네이버 4채널(지식iN·카페·블로그·뉴스)이 ★키 한 세트를 공유하는데
//         AI 8명이 동시에 나가면서 순간 속도를 넘겼다. 하루 한도(25,000)는 넉넉하다 — 초당 속도만 문제다.
//   해법: 네이버로 나가는 모든 호출을 ★한 줄로 세우고 사이에 간격을 둔다.
//         채널이 몇 개든, AI가 몇 명이든 네이버에는 한 번에 하나씩만 나간다.
const GAP_MS = Number(process.env.NAVER_GAP_MS) || 300;   // 호출 사이 간격
const RETRY = 2;                                          // 그래도 걸리면 쉬었다 다시
let _chain = Promise.resolve();                           // 모든 네이버 호출이 이 줄에 선다
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 네이버 호출 한 건을 줄 세워 보낸다(간격 + 속도제한 시 재시도) */
function queued(fn) {
  const run = _chain.then(async () => {
    for (let t = 0; t <= RETRY; t++) {
      const r = await fn();
      // 속도 제한이면 조금 더 쉬었다 다시 — 실패로 버리지 않는다
      if (r && r.errorCode && /rate|limit|429|과도/i.test(String(r.errorMessage || '') + r.errorCode)) {
        if (t < RETRY) { await _sleep(GAP_MS * (t + 2) * 3); continue; }
      }
      return r;
    }
  });
  // 다음 호출은 이 호출이 끝나고 GAP_MS 뒤에 (실패해도 줄은 계속 흐른다)
  _chain = run.then(() => _sleep(GAP_MS), () => _sleep(GAP_MS));
  return run;
}

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
      // ★줄 세워 보낸다(속도 제한 방지) + ★타임아웃 필수(매달리면 발굴 전체가 멈춘다)
      try {
        j = await queued(() => C.fetchJson(`${API}?query=${encodeURIComponent(kw)}&display=20&sort=date`, {
          headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': sec },
        }).catch((e) => ({ __thrown: e })));
        if (j && j.__thrown) throw j.__thrown;
      } catch (e) { if (/응답 없음/.test(e.message)) throw e; continue; }
      if (j && j.errorCode) {
        // 사람이 읽는 말로 — "무엇을 해야 하나"까지
        const rl = /rate|limit|429|과도/i.test(String(j.errorMessage || '') + j.errorCode);
        throw new Error(rl ? '네이버가 잠깐 속도를 제한했어요 — 잠시 뒤 다시 눌러주세요'
          : `네이버 API: ${j.errorMessage || j.errorCode}`);
      }
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
