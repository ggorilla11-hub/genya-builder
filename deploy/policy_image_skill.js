// ─────────────────────────────────────────────────────────────
// policy_image_skill.js — 📷 증권 "사진" 해석 (2단계 · 독립 모듈 · 2026-07-31 대표님 승인)
//
// 무엇을·왜:
//   설계사가 증권을 ★사진(또는 스캔 PDF)으로 올리면, 지니야가 눈으로 읽어 글자로 옮긴 뒤
//   ★1단계에서 만든 텍스트 해석(policy_text_skill)에 그대로 넘긴다.
//   = 사진 → 글자 → 해석 → 명단 연결. 해석·명단 연결 코드는 ★한 벌만 쓴다(두 길이 갈리지 않게).
//
// ★왜 두 단계로 나누나 (한 번에 시키지 않고):
//   ① 눈이 읽은 "글자"를 그대로 남겨두면, 지니야가 무엇을 보고 그렇게 말했는지 대표가 확인할 수 있다.
//   ② 안 보이는 글자를 [안 읽힘]으로 ★표시하게 만들 수 있다 → 해석 단계가 그 칸을 비워 둔다.
//      한 번에 시키면 모델이 흐린 글자를 "그럴듯하게" 메워 버린다(환각의 주된 통로).
//   ③ 사진이든 글이든 ★해석 결과가 똑같다(같은 함수를 타므로).
//
// ★환각 0 (대표님 원칙):
//   - 안 보이면 [안 읽힘]. 흐리면 흐리다고 말한다. 절대 추측해서 채우지 않는다.
//   - 읽은 글자에 없는 값은 해석 단계에서도 빈칸으로 남는다.
//
// ★제로 인그레스: 사진은 base64 로 받아 ★메모리에서만 지니야 눈에 넘기고 버린다. 서버 저장·캐시 0.
// ★무접촉: 라우터·22블록·발송·결재·명단 두뇌 안 건드림. 부르는 쪽에서 이 모듈만 호출한다.
// ─────────────────────────────────────────────────────────────
'use strict';
const _text = require('./policy_text_skill');   // 1단계 해석기 재활용(해석은 한 벌만)

let _anthropic = null;
let _MODEL = 'claude-opus-4-8';   // 눈으로 읽기 = 정확도 우선(대표님 성배: 속도보다 똑똑함)

function init(opts) {
  opts = opts || {};
  if (opts.anthropic) _anthropic = opts.anthropic;
  if (opts.model) _MODEL = opts.model;
  // 1단계 해석기도 아직 준비 안 됐으면 같이 준비시킨다(부르는 쪽이 하나만 init 해도 되게).
  try { if (opts.anthropic || opts.sheetsCrud) _text.init(opts); } catch (e) {}
}

const OK_IMAGE = /^image\/(png|jpe?g|gif|webp)$/i;
const IS_PDF = /pdf/i;

/** dataUrl(또는 base64)에서 순수 base64 와 mime 을 뽑는다 */
function _split(one) {
  let data = String((one && (one.data || one.dataUrl)) || '');
  let mime = String((one && one.mime) || '');
  const m = data.match(/^data:([^;]+);base64,(.*)$/s);
  if (m) { mime = mime || m[1]; data = m[2]; }
  return { data: data.replace(/\s/g, ''), mime: (mime || 'image/png').toLowerCase() };
}

function 전사프롬프트() {
  return `당신은 보험 증권을 눈으로 읽어 ★글자로 옮겨 적는 사람입니다. 해석·판단은 하지 않습니다.

[하는 일]
· 이미지에 보이는 글자를 ★있는 그대로 옮겨 적습니다. 표는 표처럼, 항목은 항목처럼 순서대로.
· 숫자·날짜·증권번호는 ★한 글자도 바꾸지 말고 그대로. 쉼표·하이픈·단위도 그대로.

[가장 중요한 원칙 — 지어내기 금지]
· 흐리거나 잘려서 ★확실하지 않은 글자는 절대 추측하지 마세요. 그 자리에 [안 읽힘] 이라고 적습니다.
· 일부만 보이면 보이는 만큼만 적고 나머지는 [안 읽힘] 으로 둡니다. 예) 증권번호: SF-2024-[안 읽힘]
· 이미지에 없는 항목을 "보통 이렇더라" 하고 채워 넣지 마세요. 없으면 안 적으면 됩니다.
· 보험사 이름·상품명이 흐릿하면 비슷한 이름으로 짐작하지 말고 [안 읽힘] 으로 두세요.

[맨 마지막 줄]
· 사진 상태를 한 줄로 적습니다. 예)
  [사진 상태] 선명 — 전부 읽힘
  [사진 상태] 일부 흐림 — 증권번호 뒷자리와 보험료가 안 읽힘
  [사진 상태] 기울어짐 — 아래쪽 보장 표 일부가 잘림

다른 말은 붙이지 말고, 옮겨 적은 글과 마지막 [사진 상태] 줄만 내보내세요.`;
}

/**
 * 사진·PDF → ★글자 (해석하지 않는다. 읽기만 한다)
 * @param {Array} images [{ data(base64 또는 dataUrl), mime }]
 * @returns {Promise<{ok, text, 상태, message?}>}
 */
async function transcribe(images) {
  if (!_anthropic) return { ok: false, message: '읽기 엔진이 준비되지 않았어요.' };
  const list = (Array.isArray(images) ? images : [images]).filter(Boolean).map(_split).filter((x) => x.data);
  if (!list.length) return { ok: false, message: '읽을 사진이 없어요.' };

  const content = [];
  for (const im of list) {
    if (IS_PDF.test(im.mime)) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: im.data } });
    else if (OK_IMAGE.test(im.mime)) content.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } });
    else return { ok: false, message: `${im.mime} 형식은 아직 못 읽어요. 사진(JPG·PNG)이나 PDF로 올려 주세요.` };
  }
  content.push({ type: 'text', text: '위 증권을 글자 그대로 옮겨 적어 주세요. 확실하지 않은 글자는 [안 읽힘] 으로 두세요.' });

  try {
    const r = await _anthropic.messages.create({
      model: _MODEL, max_tokens: 4000,
      system: 전사프롬프트(),
      messages: [{ role: 'user', content }],
    });
    const 글 = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!글) return { ok: false, message: '사진에서 글자를 못 읽었어요. 더 밝고 또렷하게 다시 찍어 주시겠어요?' };
    const m = 글.match(/\[사진 상태\]\s*(.+)$/m);
    console.log(`[📷증권사진] ${list.length}장 · 옮겨적은 글 ${글.length}자 · 상태=${m ? m[1].slice(0, 40) : '(표시 없음)'}`);
    return { ok: true, text: 글, 상태: m ? m[1].trim() : '' };
  } catch (e) {
    console.log('[📷증권사진] 읽기 실패: ' + e.message);
    return { ok: false, message: '사진을 읽는 중에 문제가 있었어요. 잠시 후 다시 올려 주세요.' };
  }
}

/** 읽은 글에서 못 읽은 곳이 몇 군데인지 (정직하게 알리기 위한 숫자) */
function 안읽힌수(글) { return (String(글 || '').match(/\[안 읽힘\]/g) || []).length; }

/**
 * 사진 한 건을 끝까지 — 읽기 → ★1단계 해석 → 명단 연결.
 * @param {Array} images
 * @param {object} opts { ma, 이름힌트 }
 */
async function analyzeImages(images, opts) {
  opts = opts || {};
  const t = await transcribe(images);
  if (!t.ok) return { kind: '📷 증권 사진', text: t.message };

  // ★1단계 텍스트 해석을 그대로 재활용 — 사진이든 글이든 같은 길, 같은 결과.
  const out = await _text.analyzeText(t.text, opts);

  // 사진이라서 생기는 사정(흐림·잘림)을 ★정직하게 덧붙인다.
  const 못읽음 = 안읽힌수(t.text);
  let 알림 = '';
  if (못읽음 > 0) {
    알림 = `\n\n사진에서 ${못읽음}군데가 흐리거나 잘려서 확인이 어려웠어요. 그 값은 ★비워 뒀습니다 — 짐작해서 채우지 않았습니다.`
      + (t.상태 ? `\n(사진 상태: ${t.상태})` : '')
      + '\n그 부분만 다시 찍어 주시거나 글로 알려 주시면 채워 드릴게요.';
  } else if (t.상태) {
    알림 = `\n\n(사진 상태: ${t.상태})`;
  }

  return Object.assign({}, out, {
    kind: '📷 증권 사진',
    text: String(out.text || '') + 알림,
    전사글: t.text,          // ★무엇을 보고 그렇게 말했는지 — 대표가 확인할 수 있게(응답에만, 저장 0)
    사진상태: t.상태 || '',
    안읽힌곳: 못읽음,
    viaImage: true,
  });
}

module.exports = { init, transcribe, analyzeImages, 전사프롬프트, 안읽힌수 };
