// ─────────────────────────────────────────────────────────────
// hunters/youtube.js — 📺 유튜브 담당 기자 (규약의 첫 사례)
//
// ★기능 변화 0: 기존 findYouTubeLeads()가 하던 일을 그대로 한다.
//   달라진 것은 "규약 위에서 돈다"는 것뿐 — 판별은 lead_filter, 채점은 _scoring에 위임.
//   덕분에 다음 채널(네이버·내채널)은 이 파일을 본떠 파일 하나만 추가하면 된다.
//
// ★합법 원칙: 공식 YouTube Data API v3만 사용. 공개 댓글만 읽는다.
//   게시·댓글·DM 함수는 만들지 않는다(규약이 등록 자체를 거부한다).
// ─────────────────────────────────────────────────────────────
'use strict';
const C = require('./_contract');
const S = require('./_scoring');

const KEY_ENV = 'YOUTUBE_API_KEY';
const EXCLUDE_CH = process.env.FIND_EXCLUDE_CHANNEL || 'UCQxyqyUyMpNzHZvK0V_mOGQ'; // 내 채널은 ②통합검색에서 제외(①전용 기자가 따로 맡는다)
const BASE_KEYWORDS = ['재테크', '노후준비', '연금저축', '목돈 마련', '퇴직연금', '보험 리모델링', '종잣돈', '재무설계', '10억 모으기', '투자 초보'];

/** 지금 취재 가능한가 — 안 되면 정직하게 off(가짜로 도는 척 하지 않는다) */
function probe() {
  const key = process.env[KEY_ENV];
  if (!key) return { ok: false, off: true, reason: `${KEY_ENV} 미설정 — Render 환경변수에 넣으면 켜집니다.` };
  return { ok: true, quotaNote: '검색 100 units/회 · 하루 10,000' };
}

/** 홍보대사 정체성으로 검색어를 만든다 — 내 키워드가 있으면 섞어서 내 색깔의 사람을 찾는다 */
//   agent.beat(담당 영역)이 있으면 그 AI는 자기 담당만 돈다 — 여러 명이 겹치지 않게.
function _keywords(persona, agent) {
  const beat = (agent && Array.isArray(agent.beat)) ? agent.beat : [];
  if (beat.length) return beat.slice(0, 4);
  const mine = ((persona && persona.키워드) || []).map((k) => String(k).replace(/^#/, '').trim()).filter(Boolean);
  return mine.length ? mine.slice(0, 3).concat(BASE_KEYWORDS.slice(0, 3)) : BASE_KEYWORDS.slice(0, 6);
}

/**
 * 순회 — 공개 영상의 공개 댓글에서 후보를 모은다(읽기만).
 * 판별·채점은 하지 않는다. 편집장이 관문에서 처리한다.
 */
async function search(persona, opts) {
  opts = opts || {};
  const key = process.env[KEY_ENV];
  if (!key) return [];
  const out = [];
  const max = opts.max || 30;
  // ★2026-07-27 수확 개선: 예전엔 order=date로 "방금 올라온 영상 3개"만 봤다.
  //   갓 올라온 영상은 댓글이 0~2개라 아무리 돌려도 리드가 안 나왔다(유튜브가 비어 보이던 진짜 원인).
  //   → 최근 90일 안에서 ★조회수 높은 영상을 본다. 사람이 모인 곳에 고민 댓글이 있다.
  //   ★비용은 거의 그대로: 검색은 maxResults와 무관하게 1회 100 units, 댓글 조회만 영상당 1 unit.
  //     영상 3→6, 댓글 10→20이면 댓글 풀이 4배인데 비용은 3 units만 는다.
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  for (const kw of _keywords(persona, opts.agent)) {
    let s;
    // ★타임아웃 필수 — 유튜브가 매달리면 발굴 전체가 멈춘다(2026-07-27 사고)
    try {
      s = await C.fetchJson('https://www.googleapis.com/youtube/v3/search?part=snippet&type=video'
        + '&order=viewCount&maxResults=6&relevanceLanguage=ko&regionCode=KR'
        + `&publishedAfter=${encodeURIComponent(since)}&q=${encodeURIComponent(kw)}&key=${key}`);
    } catch (e) { if (/응답 없음/.test(e.message)) throw e; continue; }
    if (s.error) throw new Error(s.error.message || 'youtube search 실패');
    for (const it of (s.items || [])) {
      const vid = it.id && it.id.videoId; if (!vid) continue;
      const vCh = (it.snippet && it.snippet.channelId) || '';
      if (vCh === EXCLUDE_CH) continue;   // 내 채널은 ① 전용 기자 담당
      let cs;
      try { cs = await C.fetchJson(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&maxResults=20&order=relevance&videoId=${vid}&key=${key}`); }
      catch (e) { continue; }   // 댓글이 꺼진 영상은 흔하다 — 건너뛰고 다음 영상으로
      (cs.items || []).forEach((ci) => {
        const sn = ci.snippet && ci.snippet.topLevelComment && ci.snippet.topLevelComment.snippet; if (!sn) return;
        out.push(C.makeLead({
          id: C.makeId('YT', ci.id),
          hunter: 'youtube', source: '유튜브',
          author: sn.authorDisplayName || '',
          text: sn.textOriginal || '',
          sourceUrl: `https://www.youtube.com/watch?v=${vid}&lc=${ci.id}`,
          postedAt: sn.publishedAt || '',
          context: {
            authorChannelId: (sn.authorChannelId && sn.authorChannelId.value) || '',
            videoChannelId: vCh,
            videoTitle: (it.snippet && it.snippet.title) || '',
            keyword: kw,
          },
        }));
      });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** 채널 고유 맥락 — 유튜브는 search에서 이미 채웠다(다른 채널은 여기서 보강) */
function enrich(lead) { return lead; }

/**
 * ★추천 근거 — "왜 이 사람인가"를 반드시 만든다.
 *   evidence는 반드시 본문에서 그대로 따온다(편집장이 원문 대조로 검증 → 위조면 반려).
 */
function reason(lead, persona) {
  const t = String(lead.text || '');
  const sc = S.score(t, { postedAt: lead.postedAt, hasUrl: !!lead.sourceUrl, persona });
  // 본문에서 근거 구절 뽑기 — 고민·질문이 담긴 문장을 그대로
  const sentences = t.split(/[.!?\n。]/).map((x) => x.trim()).filter(Boolean);
  const pick = sentences.find((s) => /(고민|막막|어떻게|궁금|모르겠|조언|추천|불안|걱정|여쭤|해야)/.test(s)) || sentences[0] || t.slice(0, 60);
  return C.makeReason({
    why: sc.notes[0] ? (sc.notes.slice(0, 2).join(' · ')) : '수요 신호 확인',
    evidence: pick,                      // ★본문에 실제로 있는 구절
    signals: sc.notes,
    fitScore: sc.total,
  });
}

/** 답글 초안 — ★게시하지 않는다. 사람이 복사해 직접 올린다. */
function draft(persona, lead) {
  const who = (persona && persona.말투) || '따뜻하고 단정하게';
  const diff = (persona && persona.차별점) || '';
  return {
    guide: `${who}. ${diff ? '차별점: ' + diff + '. ' : ''}2~3문장. 공감 → 도움 제안 → [링크]. 강매·전화번호·이모지 남발 금지.`,
    lead,
  };
}

// ★한 채널에 AI 여러 명 배치 — 성과 좋은 채널에 인원을 더 넣을 수 있다.
//   각 AI는 고유 이름 + 담당 키워드를 갖는다. 발굴 보고에 "누가 찾았는지"가 남아 상벌제로 이어진다.
//   agents가 없으면 편집장이 기본 1명으로 돌린다.
const agents = [
  { name: '유진', beat: ['재테크', '목돈 마련', '종잣돈'] },
  { name: '나래', beat: ['신혼 재테크', '결혼 준비 비용', '신혼부부 자금'] },   // ★대표님 1순위 타겟 전담
];

module.exports = { key: 'youtube', label: '📺 유튜브', agents, probe, search, enrich, reason, draft };
