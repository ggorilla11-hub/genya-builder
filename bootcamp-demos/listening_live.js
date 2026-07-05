// ─────────────────────────────────────────────────────────────
// listening_live.js — 지시6: 소셜 리스닝(공개 웹·게시판 보험/재테크 고민 탐지) LIVE
// 무엇을·왜: ①웹검색 기반 ②로그인 없는 공개 게시판(아하 Q&A) 에서 "돈관리 고민·재테크 상담"
//   개인 고민 글을 탐지 → Hot🔥/Warm🌤/Skip 분류 → 상담 타이밍 포착.
// ★공개 글만·읽기만·저장0. 인스타 해시태그 제외(실패검증). 개인 DM·비공개 무접근.
// ★탐지 = 지니야가 웹검색(공개결과)로 수집. 아래 DETECTED는 2026-07-05 실제 웹검색 결과(아하 공개 Q&A 등).
//   프로덕션에선 이 배열을 매번 실검색으로 채운다(여기선 오늘자 실측 스냅샷).
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const Anthropic = require('C:\\Users\\user\\Desktop\\genya-builder\\server\\node_modules\\@anthropic-ai\\sdk');

function loadKey() {
  const env = fs.readFileSync('C:\\Users\\user\\Desktop\\genya-builder\\server\\.env', 'utf8');
  const m = env.split(/\r?\n/).find((l) => l.startsWith('ANTHROPIC_API_KEY='));
  return m ? m.slice('ANTHROPIC_API_KEY='.length).trim() : '';
}

// 2026-07-05 실제 웹검색 탐지(공개). 개인 고민 = 아하 공개 Q&A / 정보성 = 블로그·기사.
const DETECTED = [
  { src: '아하 공개Q&A', title: '자동차보험을 중간에 다른 보험사로 갈아타려면 어떻게 해야하고 손해는 없을까요?' },
  { src: '아하 공개Q&A', title: '2013년 실비 보험인데 갈아타는것이 맞을까요' },
  { src: '아하 공개Q&A', title: '예전 실손이 엄청 올랐는데 유지해야하나요?' },
  { src: '아하 공개Q&A', title: '건강한 50대 초반 어떤 보험을 준비하는 것이 좋을까요?' },
  { src: '아하 공개Q&A', title: '보험이 하나도 없는데 괜찮을까요?' },
  { src: '아하 공개Q&A', title: '20대 후반 필수 보험은 어떤 게 있을까요?' },
  { src: '아하 공개Q&A', title: '만63세 부모님의 보험을 알아보고 있습니다' },
  { src: '아하 공개Q&A', title: '노후준비가 안된 부모님은 어떻게 해드려야할까요?' },
  { src: '블로그/기사', title: '자동차보험 갱신 언제 어떻게 해야 가장 안전할까 (정보성 글)' },
  { src: '블로그/기사', title: '4세대 실손 전환의 득과 실 (오피니언 기고)' },
];

const SYS = `너는 보험설계사 조수다. 공개 커뮤니티/Q&A/웹의 글 제목을 보고 "보험 잠재고객(사람의 실제 고민)"으로 분류한다.
- HOT: 본인/가족이 지금 보험을 갈아탈지·가입할지·갱신할지 직접 고민·질문(개인, 결정 임박).
- WARM: 노후·실손·연금·병원비 불안/관심(개인이지만 직접 결정 문의까지는 아님).
- SKIP: 언론 기사·블로그·정보성 글(개인 고민 아님).
반드시 JSON 배열만: [{"i":인덱스,"tier":"HOT|WARM|SKIP","reason":"짧은근거","timing":"설계사가 접근할 타이밍/한마디"}]. 다른 말 금지.`;

async function main() {
  const key = loadKey();
  if (!key) throw new Error('ANTHROPIC_API_KEY 없음');
  const client = new Anthropic({ apiKey: key });
  const listText = DETECTED.map((p, i) => `${i}. [${p.src}] ${p.title}`).join('\n');
  const resp = await client.messages.create({ model: 'claude-opus-4-8', max_tokens: 1800, system: SYS, messages: [{ role: 'user', content: `글 목록:\n${listText}` }] });
  const raw = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const cls = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));

  const tag = { HOT: '🔥 Hot(즉시 상담)', WARM: '🌤 Warm(관심)', SKIP: '· Skip(정보성)' };
  const groups = { HOT: [], WARM: [], SKIP: [] };
  cls.forEach((c) => { const it = DETECTED[c.i]; if (it && groups[c.tier]) groups[c.tier].push({ ...it, reason: c.reason, timing: c.timing }); });

  console.log(`[소셜 리스닝] 공개글 ${DETECTED.length}건 탐지(오늘 웹검색·아하 공개Q&A) → 분류\n`);
  ['HOT', 'WARM', 'SKIP'].forEach((t) => {
    console.log(`━━━ ${tag[t]} (${groups[t].length}건) ━━━`);
    groups[t].forEach((p) => { console.log(`  [${p.src}] ${p.title}`); console.log(`     → ${p.reason}${p.timing ? '  ⏱ ' + p.timing : ''}`); });
    console.log('');
  });
  console.log('★공개 글만·탐지/요약까지만. 실제 접근·상담은 사람(설계사)이.');
}
main().catch((e) => { console.error('오류:', e.message); process.exit(1); });
