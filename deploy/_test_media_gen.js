// ─────────────────────────────────────────────────────────────
// _test_media_gen.js — 🎨🎙️ 이미지·음성 생성 ★통째 시험 (2026-08-03)
//
// 왜 가짜 응답을 쓰나:
//   이건 ★돈이 나가는 API다. 진짜 키로만 시험하면 ①비용이 들고 ②정작 중요한
//   "고장났을 때 어떻게 되나"를 영원히 못 본다(오류·빈 응답·형식 깨짐).
//   그래서 fetch를 가로채 고장을 만들어 놓고, 진짜 실측은 ★소량으로 따로 한다.
//
// 확인하는 것 (대표님 지시 5가지 포함):
//   1. 이미지원고에서 영어 프롬프트를 실제로 뽑는가 / ★형식이 깨지면 지어내지 않고 실패하는가
//   2. ★문장 중간에서 자르지 않는가 + 조각을 이으면 ★원문과 글자 하나까지 같은가
//   3. ★교육생 계정은 차단되는가 (비용 게이트 — 대표님 돈)
//   4. ★서버가 파일을 디스크에 쓰지 않는가
//   5. ★오류·빈 응답을 "성공"으로 꾸미지 않는가
//
// 실행: node deploy/_test_media_gen.js   (★비용 0 — 진짜 API를 부르지 않는다)
// ─────────────────────────────────────────────────────────────
'use strict';
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
const T = async (name, fn) => {
  try { await fn(); console.log('  ✅ ' + name); pass++; }
  catch (e) { console.log('  ❌ ' + name + '  → ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '조건 실패'); };

// ── 가짜 OpenAI ─────────────────────────────────────────────
let 응답 = null;            // () => {ok, json, buf}  또는 throw
const 부른것 = [];
const _origFetch = global.fetch;
global.fetch = async (url, opt) => {
  부른것.push({ url: String(url), body: opt && opt.body ? JSON.parse(opt.body) : null });
  const r = 응답();
  return {
    ok: r.ok !== false,
    status: r.status || (r.ok === false ? 500 : 200),
    json: async () => r.json || {},
    arrayBuffer: async () => (r.buf || Buffer.alloc(0)).buffer.slice((r.buf || Buffer.alloc(0)).byteOffset, (r.buf || Buffer.alloc(0)).byteOffset + (r.buf || Buffer.alloc(0)).byteLength),
  };
};

const IMG = require('./image_gen');
const TTS = require('./tts');

// 라우터를 직접 부르기 위한 최소 req/res
function 호출(router, method, url, body, req0) {
  return new Promise((resolve) => {
    const req = Object.assign({ method, url, originalUrl: url, body: body || {}, query: {}, headers: {} }, req0 || {});
    let code = 200;
    const res = {
      status(c) { code = c; return this; },
      json(j) { resolve({ code, json: j }); },
      set() { return this; },
    };
    router.handle(req, res, () => resolve({ code: 404, json: { ok: false, error: 'no route' } }));
  });
}

const 대표 = { _rep: true };
const 교육생 = { _rep: false };

(async function main() {
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  IMG.init({ isRep: (r) => !!r._rep, bill: null });
  TTS.init({ isRep: (r) => !!r._rep, bill: null });

  console.log('\n🎨🎙️ 이미지·음성 생성 시험 — 가짜 응답으로 고장까지 재현 (★비용 0)\n');

  // ── [1] 프롬프트 추출 ─────────────────────────────────────
  console.log('[1] 이미지원고 → 영어 프롬프트 뽑기');
  const 정상원고 = [
    '이미지 1 — 딥그린 배경에 골드 포인트로 신뢰감을 주는 구성입니다. 사람 얼굴은 넣지 않습니다.',
    '영어 프롬프트: A minimal financial illustration in deep green and gold, abstract shapes representing growth and stability, no human faces, clean editorial style, high contrast',
    '',
    '이미지 2 — 시간의 흐름과 복리를 시각적으로 대비시킵니다.',
    '영어 프롬프트: Deep green background with golden ascending curve, abstract compound growth visualization, minimal editorial poster design, no text, no human faces',
    '',
    '이미지 3 — 준비된 사람과 준비 안 된 사람의 대비.',
    '영어 프롬프트: Split composition in deep green and gold tones, contrast between empty and full vessels, symbolic financial preparation, minimal flat illustration, no faces',
  ].join('\n');

  await T('★영어 프롬프트 3개를 실제로 뽑는다', () => {
    const p = IMG.extractPrompts(정상원고);
    ok(p.length === 3, '3개가 아님: ' + p.length);
    ok(p.every((x) => /^[A-Z]/.test(x)), '라벨("영어 프롬프트:")이 안 떨어짐: ' + JSON.stringify(p[0].slice(0, 40)));
  });
  await T('★한국어 설명은 프롬프트로 안 뽑는다 (엉뚱한 그림 방지)', () => {
    const p = IMG.extractPrompts(정상원고);
    ok(!p.some((x) => /[가-힣]/.test(x.slice(0, 30))), '한국어가 섞임: ' + JSON.stringify(p));
  });
  await T('글머리표·번호·따옴표가 붙어 있어도 뽑는다', () => {
    const p = IMG.extractPrompts('1) "A calm deep green editorial illustration about retirement savings, abstract, no human faces, gold accents"');
    ok(p.length === 1 && p[0].startsWith('A calm'), JSON.stringify(p));
  });
  await T('★형식이 깨져 프롬프트가 없으면 ★지어내지 않는다(빈 배열)', () => {
    const p = IMG.extractPrompts('이미지 아이디어 세 가지를 생각해 봤습니다. 첫째는 나무, 둘째는 계단, 셋째는 시계입니다.');
    ok(p.length === 0, '★없는 프롬프트를 만들어냄: ' + JSON.stringify(p));
  });
  await T('★프롬프트를 못 뽑으면 422로 정직히 실패하고 원문을 돌려준다', async () => {
    응답 = () => ({ ok: true, json: { data: [{ b64_json: 'AAAA' }] } });
    const r = await 호출(IMG.router, 'POST', '/image', { text: '한글만 있는 원고입니다. 그림 세 개를 만들어 주세요.' }, 대표);
    ok(r.code === 422, 'code=' + r.code + ' ' + JSON.stringify(r.json));
    ok(r.json.code === 'NO_PROMPT', JSON.stringify(r.json));
    ok(!!r.json.원문, '원문을 안 돌려줌 — 대표님이 고칠 수가 없다');
    ok(부른것.length === 0, '★프롬프트도 없는데 API를 불러 돈을 씀');
  });

  // ── [2] 비용 게이트 ───────────────────────────────────────
  console.log('\n[2] ★비용 게이트 — 대표님 돈');
  await T('★교육생 계정은 이미지 생성 차단', async () => {
    부른것.length = 0;
    const r = await 호출(IMG.router, 'POST', '/image', { text: 정상원고 }, 교육생);
    ok(r.code === 403 && r.json.code === 'NOT_REP', JSON.stringify(r.json));
    ok(부른것.length === 0, '★차단했다면서 API를 부름 = 돈이 나감');
  });
  await T('★교육생 계정은 음성 생성 차단', async () => {
    부른것.length = 0;
    const r = await 호출(TTS.router, 'POST', '/tts', { text: '안녕하세요' }, 교육생);
    ok(r.code === 403 && r.json.code === 'NOT_REP', JSON.stringify(r.json));
    ok(부른것.length === 0, '★차단했다면서 API를 부름 = 돈이 나감');
  });
  await T('대표님 계정은 통과한다', async () => {
    응답 = () => ({ ok: true, json: { data: [{ b64_json: 'QUJD' }] } });
    const r = await 호출(IMG.router, 'POST', '/image', { text: 정상원고, max: 1 }, 대표);
    ok(r.code === 200 && r.json.ok === true, JSON.stringify(r.json).slice(0, 200));
  });

  // ── [3] 오류를 성공으로 안 꾸미기 ──────────────────────────
  console.log('\n[3] ★오류·빈 응답을 성공으로 꾸미지 않는다');
  await T('★OpenAI가 오류를 주면 502로 실패 (200으로 안 넘김)', async () => {
    응답 = () => ({ ok: false, status: 429, json: { error: { message: 'Rate limit reached' } } });
    const r = await 호출(IMG.router, 'POST', '/image', { text: 정상원고, max: 1 }, 대표);
    ok(r.code === 502 && r.json.ok === false, 'code=' + r.code + ' ' + JSON.stringify(r.json).slice(0, 200));
    ok(/Rate limit/.test(JSON.stringify(r.json.실패 || '')), '진짜 원인을 안 알려줌: ' + JSON.stringify(r.json));
  });
  await T('★이미지가 빈 응답이면 실패로 센다 (빈 파일을 성공으로 안 함)', async () => {
    응답 = () => ({ ok: true, json: { data: [{}] } });
    const r = await 호출(IMG.router, 'POST', '/image', { text: 정상원고, max: 1 }, 대표);
    ok(r.code === 502 && r.json.ok === false, JSON.stringify(r.json).slice(0, 200));
  });
  await T('★음성이 빈 파일이면 실패로 센다', async () => {
    응답 = () => ({ ok: true, buf: Buffer.alloc(0) });
    const r = await 호출(TTS.router, 'POST', '/tts', { text: '안녕하세요 반갑습니다' }, 대표);
    ok(r.code === 502 && r.json.ok === false, JSON.stringify(r.json).slice(0, 200));
  });
  await T('★3장 중 1장만 성공하면 "3장 만들었다"고 하지 않는다', async () => {
    let n = 0;
    응답 = () => { n++; return n === 1 ? { ok: true, json: { data: [{ b64_json: 'QUJD' }] } } : { ok: false, status: 500, json: { error: { message: '서버 오류' } } }; };
    const r = await 호출(IMG.router, 'POST', '/image', { text: 정상원고 }, 대표);
    ok(r.json.만든장수 === 1 && r.json.요청장수 === 3, JSON.stringify({ 만든: r.json.만든장수, 요청: r.json.요청장수 }));
    ok(/3장 중 1장/.test(r.json.안내 || ''), '부족하다는 안내가 없음: ' + r.json.안내);
  });

  // ── [4] 문장 자르기 ───────────────────────────────────────
  console.log('\n[4] ★원고 자르기 — 문장 중간 금지 · 원문 복원');
  const 긴원고 = Array.from({ length: 400 }, (_, i) =>
    `${i + 1}번 문단입니다. 노후 준비는 빠를수록 유리합니다. 복리는 시간이 만드는 힘이니까요.`).join('\n\n');

  await T('4,096자 이하면 조각을 안 낸다', () => {
    const p = TTS.splitForTts('짧은 원고입니다.', 4096);
    ok(p.length === 1, '조각수=' + p.length);
  });
  await T('★조각을 이으면 원문과 글자 하나까지 같다 (버리는 글자 0)', () => {
    const p = TTS.splitForTts(긴원고, 4096);
    ok(p.join('') === 긴원고, '★원문이 복원되지 않음 = 글자를 버렸다');
  });
  await T('모든 조각이 한도를 넘지 않는다', () => {
    const p = TTS.splitForTts(긴원고, 4096);
    const 초과 = p.filter((x) => x.length > 4096);
    ok(초과.length === 0, `한도 초과 조각 ${초과.length}개`);
  });
  await T('★문장 중간에서 자르지 않는다 (조각 끝이 문장부호·줄바꿈)', () => {
    const p = TTS.splitForTts(긴원고, 4096);
    const 나쁜 = p.slice(0, -1).filter((x) => !/[.!?。？！\n]\s*$/.test(x));
    ok(나쁜.length === 0, `★문장 중간에서 잘린 조각 ${나쁜.length}개: ` + JSON.stringify((나쁜[0] || '').slice(-40)));
  });
  await T('공백·문장부호가 아예 없는 긴 덩어리도 멈추지 않는다(무한루프 없음)', () => {
    const 덩어리 = '가'.repeat(10000);
    const p = TTS.splitForTts(덩어리, 4096);
    ok(p.join('') === 덩어리, '원문 복원 실패');
    ok(p.length === 3, '조각수=' + p.length);
  });
  await T('★팟캐스트 15,000자가 실제로 여러 조각이 된다 (조사한 실제 분량)', () => {
    const p = TTS.splitForTts(긴원고.slice(0, 15000), 4096);
    ok(p.length >= 4, '조각수=' + p.length + ' (15,000자면 최소 4조각이어야 함)');
  });
  await T('원고가 너무 길면 만들기 전에 막는다(비용 폭주 방지)', async () => {
    부른것.length = 0;
    const r = await 호출(TTS.router, 'POST', '/tts', { text: '가'.repeat(TTS.MAX_CHARS + 1) }, 대표);
    ok(r.code === 413 && r.json.code === 'TOO_LONG', JSON.stringify(r.json));
    ok(부른것.length === 0, '★막았다면서 API를 부름');
  });

  // ── [5] 실제 호출 파라미터 ─────────────────────────────────
  console.log('\n[5] 실제로 보내는 값이 승인받은 값인가');
  await T('★이미지는 gpt-image-1 · 1024x1536 · medium 으로 부른다', async () => {
    부른것.length = 0;
    응답 = () => ({ ok: true, json: { data: [{ b64_json: 'QUJD' }] } });
    await 호출(IMG.router, 'POST', '/image', { text: 정상원고, max: 1 }, 대표);
    const b = 부른것[0].body;
    ok(b.model === 'gpt-image-1', 'model=' + b.model);
    ok(b.size === '1024x1536', 'size=' + b.size);
    ok(b.quality === 'medium', 'quality=' + b.quality);
  });
  await T('★이미지는 한꺼번에 안 던지고 1장씩 순차로 부른다 (rate limit)', async () => {
    부른것.length = 0;
    응답 = () => ({ ok: true, json: { data: [{ b64_json: 'QUJD' }] } });
    await 호출(IMG.router, 'POST', '/image', { text: 정상원고 }, 대표);
    ok(부른것.length === 3, '호출 횟수=' + 부른것.length);
    ok(부른것.every((c) => c.body.n === 1), '★n을 1보다 크게 보냄(한꺼번에 던짐)');
  });
  await T('★음성은 tts-1 · mp3 로 부른다', async () => {
    부른것.length = 0;
    응답 = () => ({ ok: true, buf: Buffer.from('ID3fake') });
    await 호출(TTS.router, 'POST', '/tts', { text: '안녕하세요 반갑습니다.' }, 대표);
    const b = 부른것[0].body;
    ok(b.model === 'tts-1', 'model=' + b.model);
    ok(b.response_format === 'mp3', 'format=' + b.response_format);
  });
  await T('이상한 목소리 이름을 주면 기본 목소리로 되돌린다', async () => {
    부른것.length = 0;
    응답 = () => ({ ok: true, buf: Buffer.from('ID3fake') });
    await 호출(TTS.router, 'POST', '/tts', { text: '안녕하세요.', voice: '<script>' }, 대표);
    ok(TTS.VOICES.includes(부른것[0].body.voice), 'voice=' + 부른것[0].body.voice);
  });

  // ── [6] 디스크 0바이트 ────────────────────────────────────
  console.log('\n[6] ★서버 디스크에 파일을 안 쓴다 (원칙4)');
  await T('★코드에 파일 쓰기(writeFile·createWriteStream)가 아예 없다', () => {
    for (const f of ['image_gen.js', 'tts.js']) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      ok(!/writeFile|createWriteStream|appendFile|\bmkdir/.test(src), `★${f} 에 파일 쓰기 코드가 있다`);
    }
  });
  await T('★실제로 생성해도 폴더에 새 파일이 안 생긴다', async () => {
    const 전 = fs.readdirSync(__dirname).length;
    응답 = () => ({ ok: true, buf: Buffer.from('ID3fake') });
    await 호출(TTS.router, 'POST', '/tts', { text: '안녕하세요 반갑습니다.' }, 대표);
    응답 = () => ({ ok: true, json: { data: [{ b64_json: 'QUJD' }] } });
    await 호출(IMG.router, 'POST', '/image', { text: 정상원고, max: 1 }, 대표);
    ok(fs.readdirSync(__dirname).length === 전, '★새 파일이 생겼다 = 디스크에 씀');
  });
  await T('결과는 base64로 돌려준다 (브라우저가 바로 내려받게)', async () => {
    응답 = () => ({ ok: true, buf: Buffer.from('ID3fake') });
    const r = await 호출(TTS.router, 'POST', '/tts', { text: '안녕하세요 반갑습니다.' }, 대표);
    ok(r.json.parts[0].base64 && r.json.parts[0].mime === 'audio/mpeg', JSON.stringify(r.json.parts[0]).slice(0, 120));
  });

  // ── [7] 키 없음 ──────────────────────────────────────────
  console.log('\n[7] 키가 없을 때');
  await T('OPENAI_API_KEY 없으면 정직히 503 (되는 척 안 함)', async () => {
    const keep = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
    const r = await 호출(IMG.router, 'POST', '/image', { text: 정상원고 }, 대표);
    process.env.OPENAI_API_KEY = keep;
    ok(r.code === 503 && r.json.code === 'NO_KEY', JSON.stringify(r.json));
  });

  console.log(`\n결과: ${pass}/${pass + fail} — ` + (fail ? `★${fail}개 실패` : '전부 통과'));
  global.fetch = _origFetch;
  process.exit(fail ? 1 : 0);
})();
