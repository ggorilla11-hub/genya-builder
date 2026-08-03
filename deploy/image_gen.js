// ═══════════════════════════════════════════════════════════════════════════
// 🎨 image_gen.js — 이미지원고(텍스트) → 진짜 이미지 파일 (OpenAI gpt-image-1)
//
// 왜: 지금까지 "이미지원고"는 ★미드저니·DALL-E에 붙여 쓰라는 안내문까지만이었다
//     (genya.html:3662 · promo_prompts.js:46 10번 원고). 대표님이 매번 다른 도구로
//     옮겨 붙이셔야 했다. 그 손을 없앤다.
//
// ★독립 모듈이다. main_server는 라우터를 ★꽂기만 한다(원칙7 · 기존 기능 무접촉).
//   원고 생성 로직(promo_skill·promo_prompts)·RAG(author_rag)는 한 글자도 안 건드린다.
//
// ── 지키는 것 ──
//   · 비용 게이트: 대표님(VIP) 계정만. ★서버가 판정한다 — 화면 게이트는 우회되므로 믿지 않는다.
//   · 디스크 0바이트: 만든 이미지를 파일로 쓰지 않는다. base64로 브라우저에 바로 넘긴다(원칙4).
//   · 순차 처리: 3장을 한꺼번에 던지지 않는다(rate limit). 1장씩, 약 1분.
//   · ★지어내지 않는다: 원고에서 프롬프트를 못 뽑으면 "뽑았다"고 하지 않고 정직히 실패하고
//     원문을 그대로 돌려준다. 대표님이 직접 고르거나 고쳐 넣으실 수 있게.
//     (CLAUDE.md 6-10 ②: 못 쓰면 넓히지 말고 멈춘다)
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const express = require('express');

const MODEL = 'gpt-image-1';
const SIZE = '1024x1536';      // 세로 — 쇼츠·카드뉴스와 같은 비율
const QUALITY = 'medium';
const MAX_IMAGES = 3;          // 이미지원고가 프롬프트 3개를 만든다(promo_prompts.js:48)
const USD_PER_IMAGE = 0.063;   // 1024x1536 · medium (OpenAI 공식 가격표)
const USD_KRW = 1400;

let _cfg = { isRep: () => false, bill: null };
function init(opts) { _cfg = Object.assign({}, _cfg, opts || {}); }

const HAS_HANGUL = /[가-힣]/;
const HANGUL_G = /[가-힣]/g;

// "라벨: 내용"에서 라벨이 한글이면 라벨을 떼고, 따옴표·글머리표를 정리한다.
function _clean(line) {
  let s = String(line == null ? '' : line).replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
  const m = s.match(/^([^:：]{0,40})[:：]\s*(.+)$/);
  if (m && HAS_HANGUL.test(m[1])) s = m[2].trim();
  return s.replace(/^["'`“”]+|["'`“”]+$/g, '').trim();
}

// 영어 프롬프트로 볼 수 있나. ★느슨하게 잡으면 한국어 설명까지 프롬프트로 보내 엉뚱한 그림이 나온다.
function _looksEnglishPrompt(s) {
  if (s.length < 40) return false;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  const hangul = (s.match(HANGUL_G) || []).length;
  return letters >= 30 && (hangul / s.length) < 0.08;
}

/**
 * 이미지원고 → 영어 프롬프트 배열(최대 3개).
 * ★못 뽑으면 빈 배열을 돌려준다. 억지로 만들어내지 않는다.
 */
function extractPrompts(text, max) {
  const cap = Math.max(1, Math.min(Number(max) || MAX_IMAGES, MAX_IMAGES));
  const out = [];
  const seen = new Set();
  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    const s = _clean(raw);
    if (!_looksEnglishPrompt(s)) continue;
    const key = s.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.slice(0, 1000)); // 프롬프트 상한(비용·오류 방지)
    if (out.length >= cap) break;
  }
  return out;
}

// 이미지 1장 생성. 실패는 실패로 돌려준다(빈 이미지를 성공으로 꾸미지 않는다).
async function generateOne(prompt, key) {
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: MODEL, prompt, size: SIZE, quality: QUALITY, n: 1 }),
  });
  let j = null;
  try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok) throw new Error((j && j.error && j.error.message) || ('OpenAI 오류 ' + r.status));
  const b64 = j && j.data && j.data[0] && j.data[0].b64_json;
  // ★빈 응답을 "성공·0장"으로 넘기지 않는다. 그건 조용한 실패다.
  if (!b64) throw new Error('이미지가 오지 않았어요(빈 응답)');
  return b64;
}

const router = express.Router();

// 🩺 상태 확인 — 키·게이트가 켜져 있나(비용 안 나감)
router.get('/image/diag', (req, res) => {
  res.json({
    모델: MODEL, 크기: SIZE, 품질: QUALITY,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    권한: _cfg.isRep(req) ? '대표님(사용 가능)' : '대표님만 사용 가능(현재 계정은 불가)',
    장당비용: `약 ${Math.round(USD_PER_IMAGE * USD_KRW)}원`,
    저장: '서버 디스크 0바이트 — base64로 브라우저에 바로 전달',
  });
});

router.post('/image', async (req, res) => {
  try {
    // ── 비용 게이트: ★서버가 판정한다 ──
    if (!_cfg.isRep(req)) {
      return res.status(403).json({ ok: false, error: '이미지 생성은 아직 대표님 계정에서만 됩니다.', code: 'NOT_REP' });
    }
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(503).json({ ok: false, error: 'OPENAI_API_KEY 미설정 — 이미지 생성을 켤 수 없어요', code: 'NO_KEY' });

    const b = req.body || {};
    const text = String(b.text || '');
    // 화면이 프롬프트를 직접 준 경우(대표님이 고쳐 넣은 것)를 우선한다.
    let prompts = Array.isArray(b.prompts) ? b.prompts.map((p) => String(p || '').trim()).filter(Boolean).slice(0, MAX_IMAGES) : [];
    if (!prompts.length) prompts = extractPrompts(text, b.max);

    // ★못 뽑았으면 지어내지 않는다. 원문을 돌려주고 사람이 고르게 한다.
    if (!prompts.length) {
      return res.status(422).json({
        ok: false, code: 'NO_PROMPT',
        error: '이미지원고에서 영어 프롬프트를 찾지 못했어요. 원문을 확인하시고 프롬프트를 직접 넣어 주세요.',
        원문: text.slice(0, 4000),
      });
    }

    // ── 순차 생성(rate limit) ──
    const images = [];
    const 실패 = [];
    for (let i = 0; i < prompts.length; i++) {
      try {
        const b64 = await generateOne(prompts[i], key);
        images.push({ index: i, prompt: prompts[i], base64: b64, mime: 'image/png' });
        if (typeof _cfg.bill === 'function') { try { _cfg.bill(MODEL, USD_PER_IMAGE * USD_KRW); } catch (e) {} }
      } catch (e) {
        실패.push({ index: i, prompt: prompts[i].slice(0, 80), error: e.message });
      }
    }
    console.log(`[🎨이미지] 요청 ${prompts.length}장 → 성공 ${images.length} · 실패 ${실패.length} · 약 ${Math.round(images.length * USD_PER_IMAGE * USD_KRW)}원`);

    // ★한 장도 못 만들었으면 200(성공)으로 내보내지 않는다.
    if (!images.length) {
      return res.status(502).json({ ok: false, code: 'ALL_FAILED', error: '이미지를 만들지 못했어요', 실패 });
    }
    res.json({
      ok: true, model: MODEL, size: SIZE, quality: QUALITY,
      만든장수: images.length, 요청장수: prompts.length,
      비용원: Math.round(images.length * USD_PER_IMAGE * USD_KRW),
      images, 실패,
      안내: images.length < prompts.length ? `${prompts.length}장 중 ${images.length}장만 만들었어요` : '',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = { init, router, extractPrompts, generateOne, MODEL, SIZE, QUALITY, MAX_IMAGES, USD_PER_IMAGE };
