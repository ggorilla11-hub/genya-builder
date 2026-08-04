// ═══════════════════════════════════════════════════════════════════════════
// 🎬 shorts_scene.js — 쇼츠 원고 → ★배경 장면 2~3개 (지니야 침투)
//
// 왜: 쇼츠 배경이 늘 같은 딥그린 그라디언트였다. 무슨 말을 하든 같은 영상이다.
//     원고가 "신혼부부 재무"를 말하면 배경도 그 장면이어야 한다.
//     → 원고를 읽고 ★장면을 나눈 뒤, 장면마다 ★배경 사진 프롬프트를 만든다.
//       그 프롬프트는 기존 image_gen(/api/media/image)이 그대로 그림으로 바꾼다.
//
// ★독립 모듈이다. main_server는 라우터를 ★꽂기만 한다.
//   원고 엔진(promo_skill·promo_prompts)·RAG는 한 글자도 안 건드린다(danger zone).
//
// ── 지키는 것 ──
//   · 비용 게이트: 대표님(VIP)만. ★서버가 판정한다. 막힌 계정은 LLM을 ★아예 안 부른다
//     (CLAUDE.md 6-12 ⑦ — 응답만 막으면 돈은 이미 나간다).
//   · 답은 ★글자가 아니라 도구(구조화)로 받는다. 글자로 받으면 잘려서 빈 답이 온다(6-10 ④).
//   · ★지어내지 않는다: 장면을 못 만들면 "만들었다"고 하지 않고 정직히 실패한다.
//     화면은 그때 ★배경 없이 지금 방식으로 쇼츠를 만든다(고장 나도 영상은 나온다).
//   · 프롬프트에는 ★글자 금지·얼굴 금지를 항상 붙인다.
//       - 글자: 이미지 안 한글은 반드시 깨진다. 글자는 캔버스가 얹는다.
//       - 얼굴: 개인정보 · 그리고 gpt-image-1이 사람 얼굴 요구를 거부할 수 있다.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const express = require('express');

const MODEL = 'claude-sonnet-5';   // ★대표 절대규칙: 모든 LLM = Claude Sonnet. 날짜접미사 금지.
const MIN_SCENES = 2;
const MAX_SCENES = 3;              // image_gen 의 MAX_IMAGES 와 맞춘다(3장 이상은 안 만든다)
const MAX_PROMPT = 700;            // 프롬프트 상한(비용·오류 방지)

let _cfg = { isRep: () => false, anthropic: null };
function init(opts) { _cfg = Object.assign({}, _cfg, opts || {}); }

// ★모든 프롬프트 끝에 반드시 붙는 안전 꼬리표.
//   화면 위/아래는 자막과 CTA가 덮으므로 ★가운데에 주인공을 두게 한다.
const 꼬리표 = ', photorealistic, cinematic natural lighting, vertical 9:16 composition, '
  + 'main subject centered in the middle third, calm uncluttered space at the top and bottom, '
  + 'no text, no letters, no words, no numbers, no captions, no logo, no watermark, '
  + 'no human face, no recognizable person';

// 프롬프트에 이런 말이 들어오면 그림에 글자가 박힌다 — 들어오면 지운다.
const 위험어 = /\b(text|letters?|words?|caption|subtitle|typography|logo|watermark|sign(?:age)?|poster|billboard)\b/gi;

function _다듬기(p) {
  const s = String(p || '')
    .replace(위험어, '')
    // 낱말을 지우고 나면 "no  or numbers" 같은 부스러기가 남는다 — 그 조각째 정리한다.
    // (실측: 모델이 "no visible text or numbers" 라고 써서 가운데만 지워졌다)
    .replace(/\bno\s+(visible\s+)?(or\s+)?(numbers?|on covers)?\b(?=\s*[,.]|\s*$)/gi, '')
    .replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',')
    .replace(/[,\s]+$/, '').trim();
  if (!s) return '';
  return (s + 꼬리표).slice(0, MAX_PROMPT);
}

// 도구(구조화) 정의 — ★칸 이름은 영문만. 한글 키는 400을 맞는다(6-10 ④).
const TOOL = {
  name: 'scenes',
  description: '쇼츠 배경 장면 2~3개',
  input_schema: {
    type: 'object',
    properties: {
      scenes: {
        type: 'array',
        minItems: MIN_SCENES,
        maxItems: MAX_SCENES,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: '이 장면이 무엇인지 한국어 한 줄(대표님이 읽는 설명)' },
            covers: { type: 'array', items: { type: 'integer' }, description: '이 배경이 덮을 씬 번호(1부터)' },
            prompt: { type: 'string', description: '영어 배경 사진 프롬프트. 사물·장소·상황을 구체적으로.' },
          },
          required: ['label', 'covers', 'prompt'],
        },
      },
    },
    required: ['scenes'],
  },
};

function systemFor(자막들, 카피) {
  return [
    '너는 세로 쇼츠 영상의 ★배경 사진을 고르는 감독이다.',
    `한줄카피: ${카피 || '(없음)'}`,
    '아래 자막들은 한 편의 쇼츠다. 이 자막들을 ' + MIN_SCENES + '~' + MAX_SCENES + '개의 ★장면 덩이로 묶어라.',
    '',
    '자막:',
    자막들.map((t, i) => `  ${i + 1}. ${t}`).join('\n'),
    '',
    '장면마다 ★배경 사진 한 장을 영어 프롬프트로 적는다. 규칙:',
    '① ★자막이 말하는 주제를 눈에 보이는 장면으로 적는다 — 그 주제에 실제로 나오는',
    '   사물·장소·상황을 이름 붙여 적어라(예: 신혼부부 재무 = 식탁 위 가계부와 커피 두 잔,',
    '   달력에 동그라미 친 월급날, 통장과 새 집 열쇠).',
    '② ★추상적인 것 금지 — 불꽃·빛 덩어리·색만 흐르는 그라데이션·의미 없는 도형.',
    '③ ★글자를 그리지 마라. 간판·문서의 글씨·숫자도 안 된다(자막은 나중에 따로 얹는다).',
    '④ ★사람 얼굴 금지. 얼굴이 안 보이는 손·뒷모습·사물 중심으로.',
    '⑤ 실사 사진처럼. 화면 ★가운데에 주인공을 두고 위아래는 여유를 둔다.',
    '⑥ covers 는 이 배경이 덮을 자막 번호다. 모든 자막 번호가 ★빠짐없이 한 번씩 들어가야 한다.',
    '',
    '반드시 scenes 도구로만 답한다.',
  ].join('\n');
}

// covers 를 정리한다 — 빠진 번호는 앞 장면에 붙이고, 없는 번호는 버린다.
//   ★못 알아들으면 넓히지 않는다. 순서대로 균등하게 나눈 것으로 되돌린다(6-9).
function _covers정리(scenes, n) {
  const 쓴것 = new Set();
  scenes.forEach((s) => {
    // ★한 배열 안에서 겹친 번호도 걸러야 한다 — 거르면서 바로 표시한다.
    //   (나중에 한꺼번에 표시하면 [1,1,2] 의 두 번째 1이 그대로 통과한다)
    s.covers = (Array.isArray(s.covers) ? s.covers : []).map(Number).filter((v) => {
      if (!Number.isInteger(v) || v < 1 || v > n || 쓴것.has(v)) return false;
      쓴것.add(v); return true;
    });
  });
  for (let v = 1; v <= n; v++) {                 // 빠진 번호는 바로 앞 장면에 붙인다
    if (쓴것.has(v)) continue;
    const 앞 = scenes.filter((s) => s.covers.length && Math.max.apply(null, s.covers) < v).pop();
    (앞 || scenes[0]).covers.push(v);
    쓴것.add(v);
  }
  scenes.forEach((s) => s.covers.sort((a, b) => a - b));
  // 아무것도 안 덮는 장면이 남으면 버린다(빈 배경은 쓸모가 없다)
  return scenes.filter((s) => s.covers.length);
}

// ★도구로 받아도 모양이 한 가지가 아니다 — ★실측에서 확인한 것들을 전부 받아 준다.
//   ① scenes 가 배열 (정상)
//   ② scenes 가 ★JSON 글자 — 그 안에 다시 {"scenes":[...]} 가 들어 있었다(실제로 겪음)
//   ③ input 자체가 배열
//   못 알아보면 ★넓히지 않는다. 빈 배열을 돌려주고 위에서 정직히 실패한다.
function _풀기(input) {
  let v = input;
  for (let i = 0; i < 3; i++) {                 // 겹겹이 싸여 있어도 세 겹까지만 벗긴다
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') { v = v.scenes; continue; }
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch (e) { return []; }
      continue;
    }
    return [];
  }
  return Array.isArray(v) ? v : [];
}

async function analyze(자막들, 카피) {
  if (!_cfg.anthropic) throw new Error('두뇌가 연결되지 않았어요(anthropic 미설정)');
  const list = (자막들 || []).map((t) => String(t || '').trim()).filter(Boolean);
  if (!list.length) throw new Error('자막이 비어 있어요');

  const r = await _cfg.anthropic.messages.create({
    model: MODEL, max_tokens: 1600,
    system: systemFor(list, 카피),
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: '이 쇼츠의 배경 장면을 나눠 줘.' }],
  });
  const use = (r.content || []).find((c) => c.type === 'tool_use');
  if (!use || !use.input) throw new Error('장면을 받지 못했어요');
  const 받은것 = _풀기(use.input);
  if (!받은것.length) throw new Error('장면을 받지 못했어요');

  let scenes = 받은것
    .map((s) => ({ label: String(s.label || '').trim(), covers: s.covers, prompt: _다듬기(s.prompt) }))
    .filter((s) => s.prompt)
    .slice(0, MAX_SCENES);
  if (!scenes.length) throw new Error('쓸 수 있는 배경 프롬프트가 없어요');

  scenes = _covers정리(scenes, list.length);
  return { scenes, 씬수: list.length, model: MODEL,
           inTok: r.usage ? r.usage.input_tokens : 0, outTok: r.usage ? r.usage.output_tokens : 0 };
}

const router = express.Router();

// 🩺 상태 확인 — 게이트가 켜져 있나(비용 안 나감)
router.get('/shorts/scenes/diag', (req, res) => {
  res.json({
    모델: MODEL, 장면수: `${MIN_SCENES}~${MAX_SCENES}`,
    두뇌연결: !!_cfg.anthropic,
    // ★화면은 이 ★참/거짓만 본다. 안내 문구로 판정하면 "사용 가능"이 "불가" 문장 안에도 들어 있어 뒤집힌다.
    사용가능: !!_cfg.isRep(req),
    권한: _cfg.isRep(req) ? '대표님(사용 가능)' : '대표님만 쓸 수 있어요(현재 계정은 불가)',
    안내: '여기서 나온 프롬프트를 /api/media/image 에 넣으면 배경 사진이 됩니다',
  });
});

router.post('/shorts/scenes', async (req, res) => {
  // ── 비용 게이트: ★서버가 판정한다. 막힌 계정은 두뇌를 아예 안 부른다 ──
  if (!_cfg.isRep(req)) {
    return res.status(403).json({ ok: false, code: 'NOT_REP',
      error: '쇼츠 배경 만들기는 아직 대표님 계정에서만 됩니다.' });
  }
  try {
    const b = req.body || {};
    const out = await analyze(b.자막들 || b.subs, b.한줄카피 || b.copy);
    console.log(`[🎬쇼츠장면] 자막 ${out.씬수}줄 → 배경 ${out.scenes.length}장면`);
    res.json(Object.assign({ ok: true }, out));
  } catch (e) {
    // ★지어내지 않는다 — 실패는 실패라고 말한다. 화면은 배경 없이 쇼츠를 만든다.
    res.status(502).json({ ok: false, code: 'ANALYZE_FAILED', error: e.message });
  }
});

module.exports = { init, router, analyze, _다듬기, _covers정리, _풀기, systemFor, MODEL, MIN_SCENES, MAX_SCENES };
