// ─────────────────────────────────────────────────────────────
// _test_sim_media.js — 🖼️🎙️ 시뮬레이터 포스터·오디오 배선 + ★미리보기 실물화 시험
//
// 왜: 이미지는 "그림 지시문까지", 오디오는 "아직 못 만들어요"였다. 그 두 칸을 진짜로 채웠다.
//     ★화면 일은 화면에서 확인해야 한다 — 코드에 함수가 있는 것과 실제로 눌리는 것은 다르다
//     (CLAUDE.md 6-8 ③). 그래서 ★진짜 브라우저를 띄우고 실제로 클릭한다.
//
// ★2026-08-04 갱신: 이미지 칸이 ★AI 사진(gpt-image-1) → ★캔버스 포스터로 바뀌었다(943a72e·e4d2055).
//   그래서 옛 시험 9개가 없어진 기능(서버 호출·2장·비용 176원)을 보고 있었다 → 포스터 기준으로 바꾼다.
//   ★가장 중요한 항목이 뒤집혔다: 예전엔 "서버로 POST가 갔다"가 통과였는데,
//     지금은 ★"서버를 아예 안 부른다"가 통과다(비용 0). 안 부르는 것이 기능이다.
//
// ★서버 API는 가로채(mock) 쓴다 — 진짜로 부르면 ①돈이 나가고 ②실패했을 때 뭐가 되는지 못 본다.
//   백엔드 자체는 _test_media_gen.js 27/27 + 소량 실측으로 이미 확인했다.
//
// 확인하는 것:
//   1. 원고가 있으면 포스터·오디오 칸이 ★열린다(안 열리면 만들기 버튼을 볼 수도 없다)
//   2. 만들기 전에는 ★"아직 안 만들었다"고 정직히 말한다
//   3. 포스터는 ★서버를 안 부르고 그 자리에서 그린다(비용 0) · 오디오는 /api/media/tts 로 간다
//   4. ★미리보기 실물화 — 포스터는 <img>로 보이고 오디오는 <audio>로 ★들을 수 있다
//   5. ★못 하는 것을 성공처럼 안 꾸민다(compliance 차단 · 교육생 차단)
//   6. 다른 칸(카드뉴스·쇼츠·뉴스레터)을 안 건드렸다
//
// 실행: node deploy/_test_sim_media.js
// ─────────────────────────────────────────────────────────────
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('../server/node_modules/playwright');

const PORT = 8092;
const URL = `http://localhost:${PORT}/downloads/promo_sim_v8.html`;

let pass = 0, fail = 0;
const t = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (got !== undefined ? '  → 실제: ' + JSON.stringify(got).slice(0, 200) : '')); }
};

// 1x1 PNG · 아주 짧은 mp3 흉내 (진짜 파일이 아니어도 화면이 렌더하는지는 확인된다)
const PNG1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const MP3FAKE = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00fake-mp3-body').toString('base64');

// 원고 12종 가짜 응답 — ★이미지원고엔 영어 프롬프트, 오디오원고엔 긴 대본을 넣는다
const KINDS = ['blog', 'cafe', 'brunch', 'linkedin', 'shorts', 'longform',
  'cardnews', 'infographic', 'image', 'threads', 'newsletter', 'podcast'];
const 본문 = (k) => {
  if (k === 'image') return '이미지 1 — 딥그린과 골드로 신뢰감을 줍니다.\n영어 프롬프트: A minimal editorial illustration in deep green and gold, abstract ascending curve, no human faces, clean flat design';
  if (k === 'podcast') return Array.from({ length: 120 }, (_, i) => `${i + 1}번 문단입니다. 노후 준비는 빠를수록 유리합니다.`).join('\n\n');
  return k + ' 원고 본문입니다.';
};
const fake = {
  ok: true, copy: '시험 카피', copyNo: 1, saved: 0, saveError: null,
  results: KINDS.map((k) => ({ kind: k, label: k, target: 500, chars: 100, text: 본문(k),
    url: 'https://ohwant.net/bootcamp?utm_source=' + k, error: null })),
};

(async () => {
  const env = Object.assign({}, process.env, { PORT: String(PORT) });
  delete env.FILMING_MODE;
  // ★키가 없는 작업장(worktree)에서도 시험이 돌게 한다 — 서버가 뜨기만 하면 된다.
  //   이 시험은 서버 API를 전부 가로채(mock) 쓰므로 ★진짜 키를 쓸 일이 없다.
  //   (키가 있는 환경은 그대로 둔다 — 덮어쓰지 않는다)
  if (!env.OPENAI_API_KEY) env.OPENAI_API_KEY = 'test-dummy-not-a-real-key';
  const srv = spawn(process.execPath, [path.join(__dirname, 'main_server.js')], { cwd: __dirname, env, stdio: 'ignore' });
  const 정리 = () => { try { srv.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', 정리);

  console.log('\n🎨🎙️ 시뮬레이터 이미지·오디오 시험 — 진짜 브라우저로 (★비용 0)');
  let 떴나 = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/health`); if (r.ok) { 떴나 = true; break; } } catch (e) {}
    await new Promise((s) => setTimeout(s, 1000));
  }
  if (!떴나) { console.log('★서버가 안 떴습니다 — 시험 못 함(통과로 꾸미지 않음)'); 정리(); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const 오류 = [];
  page.on('pageerror', (e) => 오류.push('pageerror: ' + e.message));

  await page.route('**/api/promo2/expand12', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(fake) }));
  page.on('dialog', (d) => d.accept());   // confirm(비용 안내)을 자동으로 예

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.fill('#msgInput', '시험 카피');
  await page.click('#msgBtn');
  await page.waitForTimeout(1200);

  // ②콘텐츠생성은 부모 화면(genya.html) 함수가 필요해 여기선 못 돈다.
  // → 그 단계가 하는 일 중 ★우리가 바꾼 부분(켬 판정)만 같은 규칙으로 재현한다.
  const 켬결과 = await page.evaluate(() => {
    const 켬 = { '이미지파일': !!(WON['이미지원고'] || WON['인포그래픽']), '오디오파일': !!WON['오디오원고'] };
    document.querySelectorAll('#pb2 .item').forEach((it) => { if (켬[it.dataset.kind]) it.classList.add('done'); });
    return 켬;
  });

  console.log('\n[1] 칸이 열리는가 (안 열리면 버튼을 볼 수도 없다)');
  t('★원고가 있으면 이미지 칸이 켜진다', 켬결과['이미지파일'] === true, 켬결과);
  t('★원고가 있으면 오디오 칸이 켜진다', 켬결과['오디오파일'] === true, 켬결과);
  const src = await page.content();
  t("켬 판정에 '이미지파일'·'오디오파일'이 실제로 들어 있다",
    /'이미지파일':!!\(WON\['이미지원고'\]/.test(src) && /'오디오파일':!!WON\['오디오원고'\]/.test(src));

  console.log('\n[2] 만들기 전 — ★있는 척 안 한다');
  await page.click('#pb2 .item[data-kind="이미지파일"]');
  await page.waitForTimeout(250);
  const img0 = await page.locator('#c-이미지파일').innerHTML();
  t('포스터: 아직 그림이 없다(<img> 없음)', !/<img/.test(img0));
  t('포스터: [포스터 만들기] 버튼이 보인다', /genImgBtn/.test(img0) && /포스터 만들기/.test(img0));
  t('★포스터: 비용 0원이라고 알려준다', /비용 0원/.test(img0), img0.slice(0, 200));
  t('포스터: 고쳐 넣는 칸이 있다(큰제목·특징·주소)',
    /poEdit\('headline'/.test(img0) && /poEdit\('feat0'/.test(img0) && /poEdit\('url'/.test(img0));

  await page.click('#pb2 .item[data-kind="오디오파일"]');
  await page.waitForTimeout(250);
  const aud0 = await page.locator('#c-오디오파일').innerHTML();
  t('오디오: 아직 소리가 없다(<audio> 없음)', !/<audio/.test(aud0));
  t('오디오: [음성 만들기] 버튼이 보인다', /genAudBtn/.test(aud0) && /음성 만들기/.test(aud0));
  t('★오디오: "못 만들어요(다음 단계)" 문구가 사라졌다', !/못 만들어요/.test(aud0), aud0.slice(0, 120));

  console.log('\n[3] 포스터는 ★서버를 안 부른다(비용 0) · 오디오는 서버로 간다');
  let 이미지요청 = null, 음성요청 = null;
  // ★불리면 안 되는 통로다. 불리는지 지켜보기만 한다(불리면 그 자체가 실패).
  await page.route('**/api/media/image', (r) => {
    이미지요청 = { method: r.request().method() };
    r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ ok: false, error: '이 칸은 이제 서버를 안 부릅니다' }) });
  });
  await page.route('**/api/media/tts', (r) => {
    음성요청 = { method: r.request().method(), body: JSON.parse(r.request().postData() || '{}') };
    r.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({
      ok: true, 총글자: 5000, 조각수: 2, 만든조각: 2, 비용원: 11, 실패: [], 안내: '',
      parts: [{ index: 0, chars: 2500, text: '첫 조각입니다. 노후 준비는 빠를수록 유리합니다.', base64: MP3FAKE, mime: 'audio/mpeg' },
              { index: 1, chars: 2500, text: '둘째 조각입니다. 복리는 시간이 만드는 힘입니다.', base64: MP3FAKE, mime: 'audio/mpeg' }] }) });
  });

  // ★칸은 한 번에 하나만 열린다(위에서 오디오를 열어 이미지가 닫혔다) → 다시 연다.
  await page.click('#pb2 .item[data-kind="이미지파일"]');
  await page.waitForTimeout(250);
  await page.click('#genImgBtn');                       // [🖼️ 포스터 만들기]
  await page.waitForTimeout(1500);                      // 캔버스로 그리고 PNG로 굽는 시간
  t('★포스터: /api/media/image 를 아예 안 부른다(비용 0)', 이미지요청 === null, 이미지요청);
  t('포스터가 실제로 만들어졌다', await page.evaluate(() => !!(MADE.poster && MADE.poster.size > 10000)));

  console.log('\n[4] ★미리보기 실물화 — 진짜 그린 대로 보인다');
  const img1 = await page.locator('#c-이미지파일').innerHTML();
  t('★포스터가 <img> 로 실제 렌더된다', /<img[^>]+src="blob:/.test(img1), img1.slice(0, 160));
  t('포스터는 한 장이다', (await page.locator('#c-이미지파일 img').count()) === 1);
  t('크기를 정직히 말한다(1080×1440)', /1080×1440/.test(img1), img1.match(/1080[^<]*/));
  t('★비용 0원이라고 보여준다', /비용 0원/.test(img1));
  t('내려받기 버튼이 생겼다', /dlPoster\(\)/.test(img1));

  // ★주소를 넣고 [다시 그리기] → QR이 들어간다. 주소가 없으면 QR은 ★일부러 안 그린다(설계).
  await page.evaluate(() => { poEdit('url', 'ohwant.net/bootcamp'); });
  await page.click('#genImgBtn');                       // 이제 이 버튼은 [🔁 다시 그리기] = makePoster(true)
  await page.waitForTimeout(1500);
  const img2 = await page.locator('#c-이미지파일').innerHTML();
  t('★주소를 넣으면 진짜 스캔되는 QR이 들어간다', /QR 들어감/.test(img2), img2.match(/QR[^<]{0,40}/));
  t('★QR이 실제로 그려졌다(그림 안에 들어감)', await page.evaluate(() => !!(MADE.poster && MADE.poster.info && MADE.poster.info.qr)));

  await page.click('#pb2 .item[data-kind="오디오파일"]');
  await page.waitForTimeout(200);
  await page.click('#genAudBtn');
  await page.waitForTimeout(900);
  t('★오디오: /api/media/tts 로 POST 가 갔다', 음성요청 && 음성요청.method === 'POST', 음성요청);
  const aud1 = await page.locator('#c-오디오파일').innerHTML();
  t('★소리가 <audio> 플레이어로 나온다 (그 자리에서 들어보실 수 있다)', /<audio[^>]+controls/.test(aud1), aud1.slice(0, 160));
  t('★조각 2개가 각각 플레이어로 나온다', (await page.locator('#c-오디오파일 audio').count()) === 2);
  t('오디오: 조각마다 무슨 내용인지 앞부분을 보여준다', /첫 조각/.test(aud1));
  t('★이어붙일 수 없다는 것을 정직히 말한다', /하나로 못 이어요|ffmpeg/.test(aud1));
  t('내려받기 버튼이 생겼다', /dlAudio\(\)/.test(aud1));

  console.log('\n[5] ★못 하는 것을 성공처럼 안 꾸민다');
  // ① compliance — 결과를 약속하는 문구는 포스터에 못 들어간다. ★조용히 지우지 않고 멈춘다.
  const 이전이름 = await page.evaluate(() => MADE.poster && MADE.poster.name);
  await page.click('#pb2 .item[data-kind="이미지파일"]');   // (오디오를 여느라 닫혔을 수 있다)
  await page.waitForTimeout(250);
  await page.evaluate(() => { poEdit('headline', '수익 100% 보장합니다'); });
  await page.click('#genImgBtn');
  await page.waitForTimeout(1000);
  const 막힘 = await page.locator('#c-이미지파일').innerHTML();
  t('★compliance: 못 쓰는 문구라고 화면이 말한다', /못 씁니다/.test(막힘), 막힘.slice(-220));
  t('★compliance: 무엇이 왜 걸렸는지 알려준다', /100%|보장/.test(막힘));
  t('★compliance: 걸리면 아예 안 그린다(몰래 지우고 그리지 않는다)',
    (await page.evaluate(() => MADE.poster && MADE.poster.name)) === 이전이름);

  // ② 오디오는 여전히 대표님 계정만 — 막히면 정직히 말한다
  await page.unroute('**/api/media/tts');
  await page.route('**/api/media/tts', (r) => r.fulfill({ status: 403,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ ok: false, code: 'NOT_REP', error: '음성 만들기는 아직 대표님 계정에서만 됩니다.' }) }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.fill('#msgInput', '시험 카피'); await page.click('#msgBtn'); await page.waitForTimeout(1200);
  await page.evaluate(() => { document.querySelectorAll('#pb2 .item').forEach((it) => {
    if (it.dataset.kind === '이미지파일' || it.dataset.kind === '오디오파일') it.classList.add('done'); }); });
  await page.click('#pb2 .item[data-kind="오디오파일"]');
  await page.waitForTimeout(200);
  await page.click('#genAudBtn');
  await page.waitForTimeout(800);
  const 실패화면 = await page.locator('#c-오디오파일').innerHTML();
  t('★교육생 차단을 화면이 정직히 알려준다', /대표님 계정에서만/.test(실패화면), 실패화면.slice(-200));
  t('★실패인데 소리가 있는 척 하지 않는다', !/<audio/.test(실패화면));

  console.log('\n[6] 다른 칸 무접촉');
  const 전체 = await page.content();
  t('카드뉴스 미리보기 그대로', /실제로 그린 PNG/.test(전체));
  t('쇼츠 미리보기 그대로', /실제로 그려서 녹화한 세로 영상/.test(전체));
  t('뉴스레터 고쳐쓰기 그대로', /_nlSave\(\)/.test(전체));
  t('★자바스크립트 오류 0건', 오류.length === 0, 오류);

  console.log(`\n결과: ${pass}/${pass + fail} — ` + (fail ? `★${fail}개 실패` : '전부 통과'));
  await browser.close();
  정리();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('★시험 자체가 실패: ' + e.message); process.exit(1); });
