// ─────────────────────────────────────────────────────────────
// hunters/daumCafe.js — 🟠 다음(DAUM) 카페 담당 기자
//
// ★합법성 확인(2026-07-27, 실제 호출로 검증):
//   카카오 공식 검색 API https://dapi.kakao.com/v2/search/cafe 가 실존하며
//   키 없이 부르면 401(인증 필요)을 돌려준다 = 공개 문서화된 정식 엔드포인트.
//   → 크롤링·로그인 우회 없이 ★공식 API만으로 다음 카페 공개 글을 읽는다.
//   인증: 헤더 Authorization: KakaoAK {REST_API_KEY}
//
// ★대표님 지시: ★카페만★ 붙인다. 다음 블로그(/v2/search/blog)는 만들지 않는다.
// ★게시 함수 없음 — 답글은 초안까지, 게시는 사람이 직접(규약이 등록 자체를 거부).
// ★개인정보: 카페 이름·제목·요약만 화면으로 흘려보내고 서버에 저장하지 않는다.
//
// 기대 수확: 다음 카페에는 신혼·결혼 준비 커뮤니티가 많아 대표님 타겟과 잘 맞는다.
//   단 홍보글도 섞이므로 경쟁자 필터가 걸러낸 수를 화면에서 확인하시라.
// ─────────────────────────────────────────────────────────────
'use strict';
const C = require('./_contract');
const S = require('./_scoring');
// ★카카오 전용 대기줄 — 네이버 줄과 별개다(서로 안 막는다). 속도 제한이면 쉬었다 재시도.
const Q = require('./_queue').makeQueue(
  Number(process.env.KAKAO_GAP_MS) || 300, 2,
  (r) => !!(r && r.errorType && /quota|limit|429|too many/i.test(String(r.message || '') + r.errorType)));

const KEY_ENV = 'KAKAO_REST_KEY';
const API = 'https://dapi.kakao.com/v2/search/cafe';

// ★대표님 타겟 키워드 — 신혼·30대·재무·목돈·연금
const agents = [
  { name: '다음카페AI-1', beat: ['신혼부부 재테크', '예비신혼 자금', '결혼 준비 비용'], persona: '공감형 — 결혼 준비의 막막함을 먼저 읽는다' },
  { name: '다음카페AI-2', beat: ['30대 재무상담', '맞벌이 목돈', '연금 준비 고민'], persona: '꼼꼼형 — 금액·시기가 적힌 글을 고른다' },
];

function probe() {
  const k = process.env[KEY_ENV];
  if (!k) {
    return { ok: false, off: true,
      reason: `${KEY_ENV} 미설정 — developers.kakao.com에서 앱 만들고 [REST API 키]를 Render에 넣으면 켜집니다.` };
  }
  return { ok: true, quotaNote: '카카오 검색 API(무료·앱당 일일 쿼터)' };
}

function _keywords(persona, agent, opts) {
  // ★tryfind 신호가 있을 때만 검색어 표가 beat를 이긴다(없으면 아래는 예전 그대로 · 밤샘 무접촉)
  if (opts && opts.useJobKeywords) { const jk = C.jobKeywords(persona, agent, 6); if (jk.length) return jk; }
  const beat = (agent && Array.isArray(agent.beat)) ? agent.beat : [];
  if (beat.length) return beat.slice(0, 4);
  const mine = ((persona && persona.키워드) || []).map((k) => String(k).replace(/^#/, '').trim()).filter(Boolean);
  return mine.length ? mine.slice(0, 3) : ['신혼부부 재테크', '30대 재무상담', '목돈 마련'];
}

// 카카오 응답도 <b>강조</b>·HTML 엔티티가 섞여 온다 → 사람이 읽는 글로 정리
function _clean(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/** 순회 — 공식 API로 공개 카페 글만 읽는다(읽기만). 판별·채점은 편집장이 한다. */
async function search(persona, opts) {
  opts = opts || {};
  const key = process.env[KEY_ENV];
  if (!key) return [];
  const out = [];
  const max = opts.max || 30;
  for (const kw of _keywords(persona, opts.agent, opts)) {
    let j;
    // ★줄 세워 보낸다(속도 제한 방지) + ★타임아웃 필수(매달리면 발굴 전체가 멈춘다)
    try {
      j = await Q.queued(() => C.fetchJson(`${API}?query=${encodeURIComponent(kw)}&size=20&sort=recency`, {
        headers: { Authorization: 'KakaoAK ' + key },
      }).catch((e) => ({ __thrown: e })));
      if (j && j.__thrown) throw j.__thrown;
    } catch (e) { if (/응답 없음/.test(e.message)) throw e; continue; }
    if (j && j.errorType) {
      const rl = /quota|limit|429|too many/i.test(String(j.message || '') + j.errorType);
      throw new Error(rl ? '카카오가 잠깐 속도를 제한했어요 — 잠시 뒤 다시 눌러주세요'
        : `카카오 API: ${j.message || j.errorType}`);
    }
    (j.documents || []).forEach((it) => {
      const title = _clean(it.title);
      const body = _clean(it.contents);
      // 제목+요약을 합쳐 판별·채점에 쓴다(고민이 제목에 많이 담긴다)
      const text = (title + (body ? (' — ' + body) : '')).slice(0, 300);
      if (!text) return;
      out.push(C.makeLead({
        id: C.makeId('DC', it.url || title),
        hunter: 'daumCafe', source: '다음 카페',
        author: _clean(it.cafename || ''),        // 카페 이름(개인 신원 아님)
        text,
        sourceUrl: it.url || '',
        postedAt: it.datetime || '',              // 카카오는 작성일을 준다 → 최신 글에 가점
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
  const pick = parts.find((s) => /(신혼|결혼|30대|맞벌이|고민|막막|어떻게|궁금|모르겠|추천|해야|얼마|걱정)/.test(s)) || parts[0] || t.slice(0, 60);
  return C.makeReason({
    why: sc.notes.length ? sc.notes.slice(0, 2).join(' · ') : '카페 고민글 = 답을 구하는 사람',
    evidence: pick,
    signals: sc.notes.concat(['다음 카페']),
    fitScore: sc.total,
  });
}

/** 답글 초안 가이드 — ★게시하지 않는다. 사람이 확인 후 직접 올린다. */
function draft(persona, lead) {
  const tone = (persona && persona.말투) || '따뜻하고 단정하게';
  const diff = (persona && persona.차별점) || '';
  return {
    guide: `${tone}. ${diff ? '차별점: ' + diff + '. ' : ''}카페 댓글체로 3~4문장. `
      + `질문에 먼저 직접 답하고 → 놓치기 쉬운 점 하나 → 무료 진단 제안 → [링크]. `
      + `광고 느낌·강매·전화번호 금지(카페는 홍보 댓글을 강하게 제재한다).`,
    lead,
  };
}

module.exports = { key: 'daumCafe', label: '🟠 다음 카페', agents, probe, search, enrich, reason, draft };
