// ═══════════════════════════════════════════════════════════════════
// _test_sim_wire.js · 시뮬레이터 실전 배선 시험 (promo_sim_v8.html)
//
//   ★엔진(/api/promo2/expand12)은 이미 12/12로 실측됐다. 여기서 보는 것은 ★배선이다:
//     ①확정을 누르면 진짜 요청이 나가나(주소·방식·몸통·세션)
//     ②로그인 없으면 "로그인 필요"라고 하나
//     ③응답이 오면 12종이 화면에 실제로 채워지나 · 눌러서 원고가 보이나
//     ④가짜 데모 흔적이 남아 있지 않나
//
//   ★③은 응답을 시험용으로 가로채 넣는다(엔진은 이미 검증됨 · 여기선 ★채우는 쪽만 본다).
//     엔진까지 함께 도는 진짜 확인은 ★로그인한 대표님 화면에서 해야 한다 — 그건 따로 보고한다.
//
//   쓰는 법: node _test_sim_wire.js      (서버가 PORT=3583 으로 떠 있어야 함)
// ═══════════════════════════════════════════════════════════════════
'use strict';
const { chromium } = require('../server/node_modules/playwright');

const BASE = process.env.TEST_BASE || 'http://localhost:3583';
const URL = BASE + '/downloads/promo_sim_v8.html';

let pass = 0, fail = 0;
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${got !== undefined ? ' — 실제: ' + JSON.stringify(got) : ''}`); }
};

// 엔진이 실제로 주는 모양 그대로(실측 응답 구조와 같은 칸)
const KINDS = ['blog', 'cafe', 'brunch', 'linkedin', 'shorts', 'longform',
  'cardnews', 'infographic', 'image', 'threads', 'newsletter', 'podcast'];
const fake = {
  ok: true, copy: '시험 카피', copyNo: 1, saved: 0, saveError: null,
  results: KINDS.map((k) => ({
    kind: k, label: k, target: 500,
    text: k === 'cardnews'
      ? ['1장: 첫 장', '2장: 둘째 장', '3장: 셋째 장'].join('\n')
      : `[${k}] 이것은 시험용 원고 본문입니다.`,
    chars: 30, rate: 100, inRange: true, fixed: '—', banned: null, ms: 1,
    url: `https://ohwant.net/bootcamp?utm_source=${k}`, error: null,
  })),
  요약: { 성공: 12, 실패: 0 },
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const 오류 = [];
  page.on('pageerror', (e) => 오류.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401|Failed to load resource/.test(m.text())) 오류.push(m.text()); });

  console.log('\n═══ ① 화면이 열리고 자바스크립트가 안 죽나 ═══');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  t('시뮬레이터 열림', (await page.title()).length > 0, await page.title());
  t('한줄메시지 칸 있음', await page.locator('#msgInput').isVisible());
  t('저장·확정 버튼 있음', await page.locator('#msgBtn').isVisible());
  t('★자바스크립트 오류 0건', 오류.length === 0, 오류);

  console.log('\n═══ ② 가짜 데모 흔적이 지워졌나 ═══');
  const won = await page.evaluate(() => ({ keys: Object.keys(WON).length, hasWurl: typeof WURL === 'object' }));
  t('원고 통이 비어 있다(예시 원고 없음)', won.keys === 0, won);
  t('꼬리표 통이 생겼다', won.hasWurl === true);
  const 씬 = await page.content();
  t('가짜 "씬1 ▶" 미리보기가 코드에서 사라졌다', !/씬'\+i\+'<br>▶/.test(씬));

  console.log('\n═══ ③ 확정을 누르면 ★진짜 요청이 나가나 ═══');
  let req = null;
  page.on('request', (r) => { if (r.url().includes('/api/promo2/expand12')) req = r; });
  await page.fill('#msgInput', '엑셀도 버거운데, AI 비서를 직접 만든다고요?');
  await page.click('#msgBtn');
  await page.waitForTimeout(2500);
  t('요청이 나갔다', !!req);
  t('주소가 /api/promo2/expand12', req && req.url().includes('/api/promo2/expand12'), req && req.url());
  t('POST 로 보낸다', req && req.method() === 'POST', req && req.method());
  let body = {};
  try { body = JSON.parse((req && req.postData()) || '{}'); } catch (e) {}
  t('한줄카피를 실어 보낸다', /엑셀도 버거운데/.test(body.copy || ''), body.copy);
  t('copyNo 를 보낸다', body.copyNo === 1, body.copyNo);
  t('campaign.landing 을 보낸다(시트 없이도 돌게)', /^https?:\/\//.test((body.campaign || {}).landing || ''), (body.campaign || {}).landing);
  t('campaign.service 를 보낸다', !!(body.campaign || {}).service, (body.campaign || {}).service);

  console.log('\n═══ ④ 로그인 안 됐으면 "로그인 필요"라고 하나 ═══');
  //   ★진짜 서버가 401을 준다(가짜로 만든 상황이 아니다)
  const st1 = await page.locator('#st1').innerText();
  t('상태가 "로그인 필요"', /로그인 필요/.test(st1), st1);
  t('버튼이 다시 눌리게 풀렸다', (await page.locator('#msgBtn').innerText()).includes('저장'), await page.locator('#msgBtn').innerText());
  t('★원고를 만든 척하지 않는다(항목 0개 done)', (await page.locator('#pb1 .item.done').count()) === 0);

  console.log('\n═══ ⑤ 응답이 오면 12종이 실제로 채워지나 ═══');
  //   ★엔진은 이미 검증됨 — 여기선 ★받아서 채우는 쪽만 본다(응답을 시험용으로 가로챈다)
  await page.route('**/api/promo2/expand12', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(fake) }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.fill('#msgInput', '시험 카피');
  await page.click('#msgBtn');
  await page.waitForTimeout(2500);

  const done = await page.locator('#pb1 .item.done').count();
  t('★12종이 전부 채워졌다', done === 12, `${done}개`);
  t('상태가 완료로 바뀐다', /완료/.test(await page.locator('#st1').innerText()), await page.locator('#st1').innerText());
  t('진행률 바가 사라진다', !(await page.locator('#prog1').evaluate((e) => e.classList.contains('show'))));

  // 눌러서 진짜 원고가 보이나
  await page.click('#pb1 .item[data-kind="장문"]');
  await page.waitForTimeout(400);
  const 본문 = await page.locator('#w-장문').innerText();
  t('★누르면 진짜 원고 본문이 보인다', /\[blog\] 이것은 시험용 원고/.test(본문), 본문.slice(0, 60));
  t('꼬리표(UTM) 주소도 같이 보인다', /utm_source=blog/.test(본문), 본문.slice(-80));
  t('복사 버튼이 있다', /복사/.test(본문));

  // 화면에 없던 6종도 붙었나
  for (const s of ['카페글', '브런치', '링크드인', '롱폼대본', '인포그래픽', '뉴스레터']) {
    t(`새 항목 "${s}" 이 붙었다`, (await page.locator(`#pb1 .item[data-kind="${s}"]`).count()) === 1);
  }

  console.log('\n═══ ⑥ ② 콘텐츠 — 지니야빌더 밖에서는 정직하게 막나 ═══');
  //   이 시험은 iframe 밖(단독)이라 부모의 기존 생성 함수가 없다 → ★없다고 말해야 한다
  page.on('dialog', async (d) => { page._lastDialog = d.message(); await d.dismiss(); });
  await page.click('#pb2 >> xpath=../div[@class="ph"]').catch(() => {});
  await page.evaluate(() => runStage2Real());
  await page.waitForTimeout(600);
  t('★"지니야빌더 화면 안에서" 라고 정직히 안내', /지니야빌더 화면 안/.test(page._lastDialog || ''), page._lastDialog);

  console.log('\n═══ ⑦ 화면 오류 ═══');
  t('★자바스크립트 오류 0건', 오류.length === 0, 오류);

  await page.screenshot({ path: 'sim_wire_done.png', fullPage: true });
  await browser.close();

  console.log(`\n결과: ${pass}/${pass + fail} — ${fail === 0 ? '전부 통과' : fail + '개 실패'}`);
  console.log('\n★여기서 못 한 것: 엔진까지 함께 도는 진짜 원고 생성(로그인 필요).');
  console.log('   → 로그인한 대표님 화면에서 확인해야 합니다.');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('\n★시험이 도중에 죽었습니다: ' + e.message); process.exit(1); });
