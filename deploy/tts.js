// ═══════════════════════════════════════════════════════════════════════════
// 🎙️ tts.js — 오디오원고(텍스트) → 진짜 음성파일 mp3 (OpenAI tts-1)
//
// 왜: 지금까지 오디오는 "아직 못 만들어요(다음 단계)"였다(promo_sim_v8.html:788).
//     원고(팟캐스트 대본)까지만 나오고 소리가 안 났다.
//
// ★독립 모듈이다. main_server는 라우터를 ★꽂기만 한다(원칙7 · 기존 기능 무접촉).
//
// ── 이 파일이 지키는 것 ──
//   · 비용 게이트: 대표님(VIP) 계정만. ★서버가 판정한다.
//   · 디스크 0바이트: mp3를 파일로 안 쓴다. base64로 브라우저에 바로 넘긴다(원칙4).
//   · ★조각을 이으면 원문과 ★글자 하나까지 같다 — 인덱스로 자르고 버리는 글자가 없다.
//     (말로 "잘 잘랐다"가 아니라 시험이 원문 복원으로 확인한다)
//   · ★문장 중간에서 자르지 않는다 — 문단 > 문장 > 공백 순으로 경계를 찾는다.
//
// ── ★알고 계셔야 할 제약 (조사로 확인된 사실) ──
//   서버에 ffmpeg가 없다(promo_sim_v8.html:1183 "서버도 안 쓴다(ffmpeg 없음)").
//   그래서 조각 mp3를 ★하나로 이어붙일 수 없다. 조각별 mp3 그대로 드린다(대표님 승인).
//   팟캐스트 대본은 30분·3분할·파트당 5,000~6,000자(promo_prompts.js:65) →
//   전체 약 15,000자 → mp3 약 6~10개가 나오는 것이 ★정상이다.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const express = require('express');

const MODEL = 'tts-1';
const LIMIT = 4096;              // OpenAI TTS 1회 입력 상한(글자)
const DEFAULT_VOICE = 'nova';
const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const MAX_CHARS = 60000;         // 한 번에 받는 원고 상한(비용 폭주 방지)
const USD_PER_1M = 15;           // tts-1 공식 가격
const USD_KRW = 1400;

let _cfg = { isRep: () => false, bill: null };
function init(opts) { _cfg = Object.assign({}, _cfg, opts || {}); }

/**
 * 원고를 TTS 한도(limit)에 맞게 자른다.
 * ★핵심 규칙: 자른 조각을 그대로 이으면 원문과 ★똑같아야 한다(글자를 버리지 않는다).
 *   그래서 문자열을 "인덱스로 잘라내기"만 한다 — trim·replace를 하지 않는다.
 * 경계 우선순위: 문단(\n\n) > 문장 끝(. ! ? 。 ! ?) > 줄바꿈 > 공백 > (마지막 수단)글자
 */
function splitForTts(text, limit) {
  const L = Math.max(100, Number(limit) || LIMIT);
  const s = String(text == null ? '' : text);
  const out = [];
  let i = 0;
  while (i < s.length) {
    if (s.length - i <= L) { out.push(s.slice(i)); break; }
    const win = s.slice(i, i + L);
    let cut = -1;

    // ① 문단 경계
    const para = win.lastIndexOf('\n\n');
    if (para > L * 0.3) cut = para + 2;

    // ② 문장 끝(뒤따르는 공백·줄바꿈까지 포함해서 자른다)
    if (cut < 0) {
      let last = -1;
      const re = /[.!?。？！][\s]*/g;
      let m;
      while ((m = re.exec(win)) !== null) last = m.index + m[0].length;
      if (last > L * 0.3) cut = last;
    }

    // ③ 줄바꿈
    if (cut < 0) { const nl = win.lastIndexOf('\n'); if (nl > L * 0.3) cut = nl + 1; }
    // ④ 공백
    if (cut < 0) { const sp = win.lastIndexOf(' '); if (sp > L * 0.3) cut = sp + 1; }
    // ⑤ 마지막 수단 — 경계가 없는 긴 덩어리(한글은 공백 없이 이어질 수 있다)
    if (cut < 0) cut = L;

    out.push(s.slice(i, i + cut));
    i += cut;
  }
  return out.filter((x) => x.length > 0);
}

// 조각 하나 → mp3(base64). 실패는 실패로 돌려준다.
async function speakOne(chunk, voice, key) {
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: MODEL, voice: voice, input: chunk, response_format: 'mp3' }),
  });
  if (!r.ok) {
    let msg = 'OpenAI 오류 ' + r.status;
    try { const j = await r.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) {}
    throw new Error(msg);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  // ★빈 파일을 "성공"으로 넘기지 않는다.
  if (!buf.length) throw new Error('음성이 오지 않았어요(빈 파일)');
  return buf.toString('base64');
}

const router = express.Router();

// 🩺 상태 확인 — 비용 안 나감. 몇 조각으로 나뉘는지 미리 볼 수도 있다(생성은 안 함).
router.get('/tts/diag', (req, res) => {
  const text = String(req.query.text || '');
  const parts = text ? splitForTts(text, LIMIT) : [];
  res.json({
    모델: MODEL, 한도: LIMIT, 목소리: VOICES, 기본목소리: DEFAULT_VOICE,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    권한: _cfg.isRep(req) ? '대표님(사용 가능)' : '대표님만 사용 가능(현재 계정은 불가)',
    가격: `${USD_PER_1M} USD / 100만 자 (약 ${Math.round(USD_PER_1M * USD_KRW / 10000)}원/만 자)`,
    이어붙이기: '★불가(서버에 ffmpeg 없음) — 조각별 mp3로 드립니다',
    저장: '서버 디스크 0바이트 — base64로 브라우저에 바로 전달',
    미리보기: text ? { 글자수: text.length, 조각수: parts.length, 조각별글자: parts.map((p) => p.length) } : '(text= 를 붙이면 몇 조각인지 미리 봅니다)',
  });
});

router.post('/tts', async (req, res) => {
  try {
    if (!_cfg.isRep(req)) {
      return res.status(403).json({ ok: false, error: '음성 생성은 아직 대표님 계정에서만 됩니다.', code: 'NOT_REP' });
    }
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(503).json({ ok: false, error: 'OPENAI_API_KEY 미설정 — 음성 생성을 켤 수 없어요', code: 'NO_KEY' });

    const b = req.body || {};
    const text = String(b.text || '');
    if (!text.trim()) return res.status(400).json({ ok: false, error: '원고가 비어 있어요', code: 'EMPTY' });
    if (text.length > MAX_CHARS) {
      return res.status(413).json({ ok: false, code: 'TOO_LONG',
        error: `원고가 너무 길어요(${text.length}자). 한 번에 ${MAX_CHARS}자까지만 만들어요 — 파트를 나눠 주세요.` });
    }
    const voice = VOICES.includes(String(b.voice || '')) ? String(b.voice) : DEFAULT_VOICE;

    const chunks = splitForTts(text, LIMIT);
    const parts = [];
    const 실패 = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const b64 = await speakOne(chunks[i], voice, key);
        parts.push({ index: i, chars: chunks[i].length, text: chunks[i], base64: b64, mime: 'audio/mpeg' });
        if (typeof _cfg.bill === 'function') { try { _cfg.bill(MODEL, (chunks[i].length / 1e6) * USD_PER_1M * USD_KRW); } catch (e) {} }
      } catch (e) {
        실패.push({ index: i, chars: chunks[i].length, error: e.message });
      }
    }
    const 만든글자 = parts.reduce((a, p) => a + p.chars, 0);
    console.log(`[🎙️음성] ${text.length}자 → ${chunks.length}조각 · 성공 ${parts.length} · 실패 ${실패.length} · 약 ${Math.round((만든글자 / 1e6) * USD_PER_1M * USD_KRW)}원`);

    if (!parts.length) {
      return res.status(502).json({ ok: false, code: 'ALL_FAILED', error: '음성을 만들지 못했어요', 실패 });
    }
    res.json({
      ok: true, model: MODEL, voice,
      총글자: text.length, 조각수: chunks.length, 만든조각: parts.length,
      비용원: Math.round((만든글자 / 1e6) * USD_PER_1M * USD_KRW),
      이어붙이기: '서버에 ffmpeg가 없어 조각별 mp3로 드려요(순서대로 이으시면 됩니다)',
      parts, 실패,
      안내: parts.length < chunks.length ? `${chunks.length}조각 중 ${parts.length}조각만 만들었어요` : '',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = { init, router, splitForTts, speakOne, MODEL, LIMIT, VOICES, DEFAULT_VOICE, MAX_CHARS, USD_PER_1M };
