// ─────────────────────────────────────────────────────────────
// listening_connector.js — 🔌커넥터창고: 소셜 리스닝(공개 커뮤니티 보험 고민 탐지) (독립 모듈)
// 무엇을·왜: 공개 커뮤니티/Q&A의 "보험 고민 글"을 탐지 → Hot🔥/Warm🌤 분류(발굴과 동일 방식).
// ★탐지 소스 = 검색엔진 기반 공개 결과. ★네이버 지식인 등 robots가 AI봇을 금지한 소스는 제외(실측).
//   ★인스타 해시태그는 실패검증됨 → 제외. 과도한 크롤링 안 함(검색 질의만). 고객 데이터 저장 0.
// 사용: const L = require('.../listening_connector'); const g = await L.classifyPosts(posts);
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

function anthropicKey() {
  const env = 'ANTHROPIC_API_KEY=' + (process.env.ANTHROPIC_API_KEY || '');
  const m = env.split(/\r?\n/).find((l) => l.startsWith('ANTHROPIC_API_KEY='));
  return m ? m.slice('ANTHROPIC_API_KEY='.length).trim() : '';
}

const SOURCES_NOTE = '탐지=검색엔진 기반 공개결과. 네이버 지식인(AI봇 robots 차단)·인스타 해시태그(실패검증) 제외. 프로덕션=검색API.';

// 검색엔진으로 실제 탐지한 공개 글(2026-07-04 WebSearch, 실측). 제목/출처만(공개).
const DETECTED = [
  { src: '아하 Q&A', title: '자동차보험 갱신이 나은가요 신규가 나은가요?', url: 'a-ha.io' },
  { src: '마일모아 게시판', title: '자동차 보험 매번 옮겨다니기 vs 한곳 유지하기', url: 'milemoa.com' },
  { src: 'Threads', title: '내 실손보험 2013년 전후 확인… 4세대로 갈아타는 게 나은지 봐봐', url: 'threads.com' },
  { src: '블로그', title: '1세대 실손보험 갱신 폭탄, 노후 가계 타격', url: 'eolith.co.kr' },
  { src: '한경 기사', title: '종신보험 갈아탈까 했는데… 이거 몰랐으면 큰일 날 뻔', url: 'hankyung.com' },
  { src: '한경 기사', title: '종신보험에 7200만원 넣은 60대 남성, 노후 걱정', url: 'hankyung.com' },
];

const SYS = `너는 보험설계사 조수다. 공개 커뮤니티/Q&A의 글 제목을 보고 "보험 잠재고객(사람의 고민)"으로 분류.
- HOT: 본인이 지금 보험을 갈아탈지/가입할지/갱신할지 직접 고민·질문(개인). - WARM: 노후·실손·연금·병원비 불안/관심(개인이지만 직접 결정 문의는 아님). - SKIP: 언론 기사·블로그·정보성 글(개인 고민 아님).
JSON 배열만: [{"i":인덱스,"tier":"HOT|WARM|SKIP","reason":"짧은근거"}]. 다른 말 금지.`;

async function classifyPosts(posts) {
  const client = new Anthropic({ apiKey: anthropicKey() });
  const listText = posts.map((p, i) => `${i}. [${p.src}] ${p.title}`).join('\n');
  const resp = await client.messages.create({ model: 'claude-opus-4-8', max_tokens: 1200, system: SYS, messages: [{ role: 'user', content: `글 목록:\n${listText}` }] });
  const raw = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const cls = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
  const groups = { HOT: [], WARM: [], SKIP: [] };
  cls.forEach((c) => { const it = posts[c.i]; if (it && groups[c.tier]) groups[c.tier].push({ ...it, reason: c.reason }); });
  return groups;
}

/** 🔌 리스닝: 탐지된 공개글 분류. (연락은 사람) */
async function listen() { return { detected: DETECTED.length, note: SOURCES_NOTE, groups: await classifyPosts(DETECTED) }; }

module.exports = { classifyPosts, listen, DETECTED, SOURCES_NOTE };

if (require.main === module) {
  (async () => {
    const r = await listen();
    console.log(`[리스닝] 공개글 ${r.detected}건 탐지 → 분류\n(${r.note})\n`);
    const tag = { HOT: '🔥 Hot', WARM: '🌤 Warm', SKIP: '· Skip(기사·정보성)' };
    ['HOT', 'WARM', 'SKIP'].forEach((t) => {
      console.log(`━ ${tag[t]} (${r.groups[t].length}) ━`);
      r.groups[t].forEach((p) => console.log(`  [${p.src}] ${p.title}  → ${p.reason}`));
    });
    console.log('\n★연락은 사람(설계사). 리스닝은 탐지·분류까지만.');
  })().catch((e) => { console.error('오류:', e.message); process.exit(1); });
}
