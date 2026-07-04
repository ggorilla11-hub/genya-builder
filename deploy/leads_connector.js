// ─────────────────────────────────────────────────────────────
// leads_connector.js — 🔌커넥터창고: 발굴(유튜브 공개 댓글) 커넥터 (독립 모듈)
// 무엇을·왜: 공개 댓글 수집(Playwright) + Hot🔥/Warm🌤 분류(Anthropic). 연락은 사람.
// 사용: const L = require('.../leads_connector');
//        const cmts = await L.collectComments('영상ID');  const groups = await L.classifyLeads(cmts);
// ★공개 댓글만·표시명만·분류/명단까지만(발송·연락 0). 서버 저장 0. /parksugeun 무접촉.
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
let chromium = null; try { chromium = require('playwright').chromium; } catch (e) {} // ★배포: playwright 미설치 시 발굴 브라우저 비활성(안내만)
const Anthropic = require('@anthropic-ai/sdk');

function anthropicKey() {
  const env = 'ANTHROPIC_API_KEY=' + (process.env.ANTHROPIC_API_KEY || '');
  const m = env.split(/\r?\n/).find((l) => l.startsWith('ANTHROPIC_API_KEY='));
  return m ? m.slice('ANTHROPIC_API_KEY='.length).trim() : '';
}

async function collectComments(videoId, want = 25) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ locale: 'ko-KR' }).then((c) => c.newPage());
  await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  let texts = [];
  for (let i = 0; i < 12 && texts.length < want; i++) {
    await page.mouse.wheel(0, 2500); await page.waitForTimeout(1500);
    texts = await page.$$eval('ytd-comment-thread-renderer #content-text', (els) => els.map((e) => e.innerText.trim()).filter(Boolean));
  }
  const authors = await page.$$eval('ytd-comment-thread-renderer #author-text', (els) => els.map((e) => e.innerText.trim()));
  await browser.close();
  return texts.slice(0, want).map((text, i) => ({ author: authors[i] || '(익명)', text }));
}

const SYS = `너는 보험설계사 조수다. 유튜브(금융/노후) 공개 댓글을 "보험 잠재고객"으로 분류.
- HOT: 보험 직접 알아보거나 가입·상담 의향. - WARM: 노후·병원비·은퇴·돈 미래 불안/관심(직접 문의 아님). - SKIP: 칭찬·구독·투자 등 무관.
JSON 배열만: [{"i":인덱스,"tier":"HOT|WARM|SKIP","reason":"짧은근거"}]. 다른 말 금지.`;

async function classifyLeads(comments) {
  const client = new Anthropic({ apiKey: anthropicKey() });
  const listText = comments.map((c, i) => `${i}. ${c.text}`).join('\n');
  const resp = await client.messages.create({ model: 'claude-opus-4-8', max_tokens: 1500, system: SYS, messages: [{ role: 'user', content: `댓글:\n${listText}` }] });
  const raw = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const cls = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
  const groups = { HOT: [], WARM: [], SKIP: [] };
  cls.forEach((c) => { const it = comments[c.i]; if (it && groups[c.tier]) groups[c.tier].push({ ...it, reason: c.reason }); });
  return groups;
}

/** 🔌 발굴: 수집→분류 한 번에. (연락은 사람) */
async function discover(videoId) {
  const comments = await collectComments(videoId);
  const groups = await classifyLeads(comments);
  return { collected: comments.length, groups };
}

module.exports = { collectComments, classifyLeads, discover };
