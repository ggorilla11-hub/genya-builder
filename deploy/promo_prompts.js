// ═══════════════════════════════════════════════════════════════════
// promo_prompts.js · 홍보마케팅비서 · 12종 원고 프롬프트 (스펙 B-2)
//
//   무엇을·왜: 1차 실측에서 글자 수가 제각각이었다(66%~401%).
//              원인 두 가지 — ① 목표치가 산술적으로 불가능했다(쇼츠·이미지)
//                             ② 길게 쓸수록 미달했다(팟캐스트 66%)
//              그래서 "몇 자 써라" 대신 "구조 + 항목별 상한"으로 바꿨다.
//              실측: ±20% 안에 든 것 7/12 → 12/12
//
//   ★데이터만 있는 파일이다. API 호출·시트 접근 없음.
// ═══════════════════════════════════════════════════════════════════
'use strict';

// ── 12종 규칙 ──────────────────────────────────────────────────────
//   target : 목표 글자수(산술적으로 성립하는 값으로 재계산함)
//   max    : max_tokens. ★아래 _fitMax() 로 여유를 다시 보장한다
//   rule   : 구조 + 항목별 상한. 개수를 세는 방식이 글자수 지시보다 정확했다
const KINDS = [
  { id: 1,  key: 'blog',        label: '블로그 롱폼(SEO)',    target: 1500, max: 4000,
    rule: 'SEO 롱폼. 구성은 정확히 이렇게: 제목 1줄(40자 이내) + 소제목 4개(각 소제목 아래 본문 330~360자) + 마무리 CTA 문단(120자 이내). 핵심 키워드를 제목·소제목·본문에 반복.' },
  { id: 2,  key: 'cafe',        label: '카페 글(커뮤니티)',   target: 700,  max: 2000,
    rule: '커뮤니티 경험담. 문단 정확히 4개, 각 문단 170~180자. 홍보 티 안 나게. 존댓말. 마지막에 링크 1줄.' },
  { id: 3,  key: 'brunch',      label: '브런치 스토리(감성)', target: 1000, max: 3000,
    rule: '감성 에세이. 장면 정확히 6개, 각 장면 160~170자. 첫 장면은 시각적 묘사로 시작. 문단 짧게.' },
  { id: 4,  key: 'linkedin',    label: '링크드인 롱폼(B2B)',  target: 800,  max: 2400,
    rule: 'B2B 인사이트. 단락 4개 — 후킹(100자 이내) / 문제(250자) / 통찰(300자) / 행동(150자).' },
  { id: 5,  key: 'shorts',      label: '쇼츠 스크립트(60초)', target: 240,  max: 1500,
    rule: '60초 세로쇼츠. 정확히 5씬. 각 씬은 두 줄 — [자막] 16자 이내 / [화면] 25자 이내. 그 외 문장 금지.' },
  { id: 6,  key: 'longform',    label: '롱폼 스크립트(10분)', target: 2000, max: 5000,
    rule: '10분 낭독 대본. 인트로(200자) + 본론 3개(각 500자) + 아웃트로(300자). 구어체.' },
  // 7번 팟캐스트는 3분할이라 아래 PODCAST 로 따로 다룬다
  { id: 8,  key: 'cardnews',    label: '카드뉴스(10장)',      target: 380,  max: 1200,
    rule: '정확히 10장. "1장: (문구 30자 이내)" 형식으로 장마다 한 줄. 1장 후킹, 10장 CTA. 그 외 설명 금지.' },
  { id: 9,  key: 'infographic', label: '인포그래픽 텍스트',   target: 400,  max: 1500,
    rule: '제목(30자 이내) + 숫자 지표 4개(각 "라벨 : 수치 : 한줄설명" 80자 이내) + 결론 1줄(50자 이내). ★수치는 사실자료에 있는 것만 쓴다. 없으면 숫자 대신 상태를 말로 쓴다.' },
  { id: 10, key: 'image',       label: '이미지 생성 프롬프트', target: 1500, max: 3000,
    rule: '미드저니·DALL-E용 프롬프트 정확히 3개. 각 프롬프트는 한국어 설명(150자 내외) + 영어 프롬프트(250자 내외). 사람 얼굴·실존인물 묘사 금지.' },
  { id: 11, key: 'threads',     label: '스레드 포스트',        target: 320,  max: 900,
    rule: '본문 280자 이내 단문(첫 문장이 후킹) + 해시태그 3개. 본문과 해시태그 외 다른 문장 금지.' },
  { id: 12, key: 'newsletter',  label: '이메일 뉴스레터',      target: 900,  max: 2600,
    rule: '메일 제목 1줄(40자 이내) + 본문 4단락 — 인사(120자) / 문제(250자) / 해결(350자) / CTA 문구(140자). 각 단락 분량을 반드시 채울 것.' },
];

// ★max_tokens 안전 마진 — 목표자수 × 1.6(한글 토큰비 실측) + 1,200 여유
//   1차에서 이미지·쇼츠가 91%까지 차서 잘릴 뻔했다.
function _fitMax(target, cur) { return Math.max(cur, Math.ceil(target * 1.6) + 1200); }
KINDS.forEach((k) => { k.max = _fitMax(k.target, k.max); });

// ── 7번 팟캐스트 · 3분할 ────────────────────────────────────────────
//   왜 나누나: 한 번에 5,000자를 시키면 3,321자(66%)에서 멈췄다.
//              1,700자씩 세 번으로 나누니 4,695자(94%)가 됐다.
const PODCAST = { id: 7, key: 'podcast', label: '팟캐스트(30분)', target: 5000, max: 6000 };
const PODCAST_PARTS = [
  { no: 1, name: '도입',   chars: 1700, job: '청취자의 상황 공감 → 오늘 다룰 주제 예고. 결론은 아직 말하지 않는다.' },
  { no: 2, name: '본론',   chars: 1700, job: '주제를 구체적으로 짚어준다. 도입에서 던진 질문에 답한다.' },
  { no: 3, name: '마무리', chars: 1600, job: '정리 + 행동 유도. 새 주제를 꺼내지 않는다.' },
];

// ── 공통 규칙 (12종 전부 동일) ──────────────────────────────────────
function _common(url) {
  return [
    '공통: ① 과장·허위·확정수익 표현 금지(금융 콘텐츠다) ② 한줄카피에 없는 사실을 지어내지 않는다',
    '③ 쉬운 말. 70대도 알아듣게',
    `④ 마지막에 CTA를 넣는다. 도착지 주소: ${url} · CTA 문구는 "1분 무료 진단" 중심.`,
    '⑤ 결과물만 출력한다. 인사말·설명 금지.',
  ];
}

/**
 * 한 종류의 시스템 프롬프트를 만든다.
 * @param {object} kind  KINDS 항목
 * @param {object} ctx   { service, content, tone, url, factBlock }
 */
function systemFor(kind, ctx) {
  const lines = [
    `너는 오원트금융연구소의 홍보 콘텐츠 작가다. 서비스는 "${ctx.service}", 내용은 "${ctx.content}"이다.`,
    `톤앤매너: ${ctx.tone}`,
    `만들 것: ${kind.label}. 구성 규칙: ${kind.rule}`,
    `★분량은 위 구성 규칙의 각 항목 글자수를 지켜서 채운다. 전체 합계는 약 ${kind.target}자다. 짧게 끝내지 말 것.`,
  ];
  if (ctx.factBlock) lines.push(ctx.factBlock);   // ★환각 차단(B-1)
  return lines.concat(_common(ctx.url)).join('\n');
}

/**
 * 팟캐스트 Part N 의 시스템 프롬프트.
 * @param {object} part   PODCAST_PARTS 항목
 * @param {object} ctx    systemFor 와 동일
 * @param {string[]} prev 앞 Part 들의 본문(중복 방지에 끝 200자만 쓴다)
 */
function systemForPodcastPart(part, ctx, prev) {
  const tail = (prev && prev.length)
    ? prev.map((t, i) => `[Part ${i + 1} 마지막 200자] ...${String(t).slice(-200)}`).join('\n')
    : '(없음 · 첫 부분)';
  const lines = [
    `너는 오원트금융연구소 팟캐스트 대본 작가다. 서비스 "${ctx.service}", 내용 "${ctx.content}".`,
    `톤앤매너: ${ctx.tone}`,
    `30분 오디오 대본을 3부분으로 나눠 쓴다. 지금은 ★Part ${part.no}/3 (${part.name})★ 을 쓴다.`,
    `이 부분의 역할: ${part.job}`,
    `★분량: ${part.chars}자. 짧게 끝내지 말 것.`,
    '★중복 방지: 아래 "앞부분 끝"에 이미 나온 표현·문장·인사말을 다시 쓰지 마라.',
    '  이어지는 것처럼 자연스럽게 시작하되 다시 인사하지 마라.',
    `앞부분 끝:\n${tail}`,
    '구어체, 문장 짧게. 숫자는 읽는 대로. 지문·효과음 표시 금지.',
  ];
  if (ctx.factBlock) lines.push(ctx.factBlock);   // ★환각 차단(B-1)
  lines.push(part.no === 3
    ? `마지막에 CTA를 넣는다. 도착지: ${ctx.url} · "1분 무료 진단" 중심.`
    : '이 부분에는 CTA를 넣지 마라(Part 3에서 한다).');
  lines.push('과장·허위·확정수익 표현 금지. 결과물만 출력.');
  return lines.join('\n');
}

/**
 * 목표 ±20% 를 벗어났을 때 1회만 보내는 보정 지시.
 * @returns {string} 사용자 메시지로 보낼 문장
 */
function fixInstruction(kind, text) {
  const len = text.length;
  const short = len < kind.target;
  return short
    ? `아래 원고가 ${kind.target}자 목표보다 ${kind.target - len}자 짧다. 구성 규칙의 각 항목 분량을 채워 ${kind.target}자에 맞춰 다시 써라. 내용을 새로 지어내지 말고 기존 내용을 더 자세히 풀어라.\n\n---\n${text}`
    : `아래 원고가 ${kind.target}자 목표보다 ${len - kind.target}자 길다. 핵심을 유지한 채 ${kind.target}자에 맞춰 줄여라.\n\n---\n${text}`;
}

// 목표 ±20% 안인가
function inRange(kind, text) {
  const n = (text || '').length;
  return n >= kind.target * 0.8 && n <= kind.target * 1.2;
}

module.exports = {
  KINDS, PODCAST, PODCAST_PARTS,
  systemFor, systemForPodcastPart, fixInstruction, inRange,
};
