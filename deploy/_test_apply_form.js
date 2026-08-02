// ═══════════════════════════════════════════════════════════════════
// _test_apply_form.js · Phase 1-A 공개 폼 실측 (★진짜 브라우저로 화면을 조작한다)
//
//   왜 이렇게까지: 함수·API 시험이 통과해도 ★화면에서 안 눌리면 소용없다(CLAUDE.md 6-8 ③).
//   그래서 실제 브라우저로 /apply 를 열고, 사람처럼 채우고 누른 뒤
//   ★구글 시트를 직접 읽어 진짜 쌓였는지 확인한다.
//
//   필요: APPLY_SHEET_ID · GOOGLE_SERVICE_ACCOUNT_JSON · 서버가 떠 있어야 함(PORT 지정)
//   쓰는 법:  node _test_apply_form.js            (기본 http://localhost:3580)
//
//   ★시험 줄은 이름을 「시험-지우세요」로 넣는다. 지우는 것은 승인 사항이라 스스로 안 지운다(6-4).
// ═══════════════════════════════════════════════════════════════════
'use strict';
require('dotenv').config();

const { chromium } = require('../server/node_modules/playwright');
const { google } = require('googleapis');
const { getServiceAuth } = require('./service_auth');
const A = require('./apply_sheet');

const BASE = process.env.TEST_BASE || 'http://localhost:3580';
// ★회차마다 이름을 다르게 만든다 — 안 그러면 find()가 ★지난 회차 줄을 집어
//   멀쩡한 코드가 실패로 보인다(실제로 1회차만 통과하는 흔들리는 시험이 됐었다).
const RUN = String(Date.now()).slice(-6);
const 표식 = '시험-지우세요';
const 이름 = (s) => `${표식}-${s}-${RUN}`;

let pass = 0, fail = 0;
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${got !== undefined ? ' — 실제: ' + JSON.stringify(got) : ''}`); }
};

async function readSheet() {
  const auth = await getServiceAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.APPLY_SHEET_ID, range: `${A.TAB}!A1:I10000`,
  });
  const rows = r.data.values || [];
  const head = rows[0] || [];
  return rows.slice(1).map((x) => {
    const o = {}; head.forEach((h, i) => { o[h] = String(x[i] == null ? '' : x[i]); }); return o;
  });
}

// 화면을 사람처럼 채운다
async function fill(page, { name, phone, want, agree, ad }) {
  await page.fill('#fName', name);
  await page.fill('#fPhone', phone);
  if (want) await page.click(`.pick button[data-v="${want}"]`);
  if (agree) await page.check('#fAgree');
  if (ad) await page.check('#fAd');
}
const msgOf = (page) => page.locator('#msg').innerText().catch(() => '');
const doneTitle = (page) => page.locator('#dTitle').innerText().catch(() => '');
const isDone = (page) => page.locator('#doneArea').isVisible();

(async () => {
  if (!process.env.APPLY_SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.log('\n⏸ 실측 불가 — APPLY_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_JSON 이 없습니다.');
    console.log('   ★없는 것을 "통과"로 세지 않습니다.\n');
    process.exit(2);
  }

  const repA = A.repCodeOf('ggorilla11@gmail.com');
  const 번호 = '0107' + String(Date.now()).slice(-7);
  const 번호2 = '0108' + String(Date.now()).slice(-7);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const 콘솔오류 = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) 콘솔오류.push(m.text()); });

  const before = await readSheet();
  console.log(`\n시험 전 시트 줄 수: ${before.length}`);

  console.log('\n═══ ① GET /apply 가 열리고 꼬리표를 잡나 ═══');
  await page.goto(`${BASE}/apply?rep=${repA}&utm_source=shorts&utm_campaign=bootcamp8&debug=1`, { waitUntil: 'domcontentloaded' });
  t('페이지 제목이 신청 페이지', (await page.title()).includes('신청'), await page.title());
  t('이름·연락처 칸이 보인다', await page.locator('#fName').isVisible() && await page.locator('#fPhone').isVisible());
  t('관심 버튼 3개', (await page.locator('.pick button').count()) === 3);
  t('rep 코드를 화면이 잡았다', (await page.locator('#vRep').innerText()) === repA, await page.locator('#vRep').innerText());
  t('utm_source 잡았다', (await page.locator('#vSrc').innerText()) === 'shorts');
  t('utm_campaign 잡았다', (await page.locator('#vCmp').innerText()) === 'bootcamp8');

  console.log('\n═══ ② 필수동의 안 하면 막히나 ═══');
  await fill(page, { name: 이름('동의없음'), phone: 번호, want: '상담', agree: false });
  await page.click('#goBtn');
  await page.waitForTimeout(800);
  t('막혔다(완료 화면으로 안 넘어감)', !(await isDone(page)));
  t('사유가 화면에 보인다', /동의/.test(await msgOf(page)), await msgOf(page));
  const s동의 = await readSheet();
  t('★시트에 안 쌓였다', s동의.length === before.length, `${s동의.length}줄`);

  console.log('\n═══ ③ 관심이 강의·상담·진단 밖이면 막히나 (서버 판정) ═══');
  //   화면 버튼으로는 셋뿐이라 만들 수 없다 → ★나쁜 값을 억지로 넣어 서버가 막는지, 그 사유가 화면에 뜨는지 본다
  const 관심밖이름 = 이름('관심밖');
  const bad = await page.evaluate(async (nm) => {
    const r = await fetch('/api/apply/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ name: nm, phone: '01077778888', want: '아무거나', agree: true, rep: 'zzz' }),
    });
    return { status: r.status, j: await r.json() };
  }, 관심밖이름);
  t('서버가 400으로 막는다', bad.status === 400, bad);
  t('사유가 관심 때문이라고 말한다', /관심/.test((bad.j || {}).error || ''), bad.j);
  const s관심 = await readSheet();
  t('★시트에 안 쌓였다', s관심.length === before.length, `${s관심.length}줄`);
  // ★위 400은 ★이 시험이 일부러 낸 것이다 — 브라우저가 콘솔에 찍는 게 정상이라 ⑦에서 뺀다.
  //   (판정을 넓히는 게 아니라, 시험이 스스로 만든 소음만 지운다. 아래부터 나는 오류는 그대로 잡힌다)
  콘솔오류.length = 0;

  console.log('\n═══ ④ 정상 제출 → ★시트에 rep_id로 진짜 쌓이나 ═══');
  await page.goto(`${BASE}/apply?rep=${repA}&utm_source=shorts&utm_campaign=bootcamp8`, { waitUntil: 'domcontentloaded' });
  const 폼이름 = 이름('폼');
  await fill(page, { name: 폼이름, phone: 번호, want: '상담', agree: true, ad: true });
  await page.click('#goBtn');
  await page.waitForTimeout(2500);
  t('완료 화면이 떴다', await isDone(page));
  t('"접수됐습니다"라고 나온다', /접수됐습니다/.test(await doneTitle(page)), await doneTitle(page));

  const s정상 = await readSheet();
  const 새줄 = s정상.find((x) => x['이름'] === 폼이름);
  t('★시트에 새 줄이 생겼다', !!새줄, `${s정상.length}줄`);
  t('★rep_id가 회원 코드', 새줄 && 새줄['rep_id'] === repA, 새줄 && 새줄['rep_id']);
  t('연락처가 표준형으로 저장', 새줄 && 새줄['연락처'] === 번호, 새줄 && 새줄['연락처']);
  t('관심 = 상담', 새줄 && 새줄['관심'] === '상담', 새줄 && 새줄['관심']);
  t('utm_source = shorts', 새줄 && 새줄['utm_source'] === 'shorts', 새줄 && 새줄['utm_source']);
  t('utm_campaign = bootcamp8', 새줄 && 새줄['utm_campaign'] === 'bootcamp8', 새줄 && 새줄['utm_campaign']);
  t('광고동의 Y + 동의일시', 새줄 && /^Y \(/.test(새줄['광고수신동의'] || ''), 새줄 && 새줄['광고수신동의']);

  console.log('\n═══ ⑤ 같은 번호로 또 누르면 — 두 줄 안 쌓이나 ═══');
  await page.goto(`${BASE}/apply?rep=${repA}`, { waitUntil: 'domcontentloaded' });
  await fill(page, { name: 이름('중복'), phone: 번호, want: '상담', agree: true });
  await page.click('#goBtn');
  await page.waitForTimeout(2500);
  t('"이미 접수됐어요"라고 정직히 말한다', /이미 접수/.test(await doneTitle(page)), await doneTitle(page));
  const s중복 = await readSheet();
  t('★시트 줄 수가 안 늘었다', s중복.length === s정상.length, `${s중복.length}줄`);

  console.log('\n═══ ⑥ rep 없이 들어오면 → 미분류로 담기나 ═══');
  await page.goto(`${BASE}/apply`, { waitUntil: 'domcontentloaded' });
  const 무주이름 = 이름('rep없음');
  await fill(page, { name: 무주이름, phone: 번호2, want: '진단', agree: true });
  await page.click('#goBtn');
  await page.waitForTimeout(2500);
  t('접수는 된다', await isDone(page));
  const s미분류 = await readSheet();
  const 무주 = s미분류.find((x) => x['이름'] === 무주이름);
  t('★시트에 쌓였다', !!무주);
  t('★rep_id = unassigned', 무주 && 무주['rep_id'] === A.UNASSIGNED, 무주 && 무주['rep_id']);
  t('★대표님 코드로 몰래 안 넣었다', 무주 && 무주['rep_id'] !== repA);

  console.log('\n═══ ⑦ 화면 오류 ═══');
  t('★브라우저 콘솔 오류 0건', 콘솔오류.length === 0, 콘솔오류);

  await page.screenshot({ path: 'apply_form_done.png', fullPage: true });
  await browser.close();

  console.log(`\n결과: ${pass}/${pass + fail} — ${fail === 0 ? '전부 통과' : fail + '개 실패'}`);
  const 남은 = (await readSheet()).filter((x) => String(x['이름'] || '').startsWith(표식)).length;
  console.log(`\n★시트에 남은 시험 줄 ${남은}개(이름이 「${표식}」로 시작) — 대표님이 지워 주세요.`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('\n★시험이 도중에 죽었습니다: ' + e.message); process.exit(1); });
