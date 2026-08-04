// ═══════════════════════════════════════════════════════════════════
// _test_promo_url.js · 홍보 시뮬레이터 랜딩 URL 시험 (promo_sim_v8.html)
//
//   무엇을·왜: 예전엔 /bootcamp·/class·/expert 처럼 ★규칙으로 주소를 만들어 냈다.
//              그런 페이지가 실제로 없어서 전부 홈페이지로 떨어졌다 = 죽은 링크.
//              그래서 실주소 라이브러리로 바꿨고, 이 시험이 그것을 지킨다.
//
//   ★말이 아니라 숫자와 주소로 본다 —
//     ① 조합마다 화면의 자동 URL 이 ★실주소로 바뀌나
//     ② 그 주소가 ★진짜로 200 으로 열리나 (죽은 링크 0)
//     ③ [직접가기]가 새 탭으로 그 주소를 여나
//     ④ 그 주소가 ★원고 통(WON/WURL)으로 그대로 넘어가나
//
//   돌리는 법: node deploy/_test_promo_url.js
//              (이 시험은 스스로 작은 웹서버를 띄운다 · 앱 서버 필요 없음)
// ═══════════════════════════════════════════════════════════════════
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'server', 'node_modules', 'playwright'));

const FILE = path.join(__dirname, 'downloads', 'promo_sim_v8.html');
const PORT = 8794;

let pass = 0, fail = 0;
const t = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (got !== undefined ? '  → 실제: ' + JSON.stringify(got) : '')); }
};

const 오늘 = (() => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return (d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())).replace(/-/g, '').slice(2);
})();
const utm = '?utm=insta_' + 오늘;

// ★대표님 확정 실주소 (2026-08-04 배치5). 여기가 정답표다.
const 기대 = [
  ['강의', '부트캠프', '표준진단', 'https://genya-bootcamp.netlify.app'],
  ['강의', '일반인', '표준진단', 'https://ohwant-class.netlify.app/재테크아카데미_진단.html'],
  ['강의', '전문가', '표준진단', 'https://ohwant-class.netlify.app/전문가과정_진단.html'],
  ['상담', '재무상담', '표준진단', 'https://ohwant-class.netlify.app/consult.html'],
  ['상담', '재무상담', '연금', 'https://ohwant.net/pension'],
  ['상담', '재무상담', 'DESIRE', 'https://ohwant.net/debt'],
  ['상담', '재무상담', '수입지출', 'https://ohwant.net/saving'],
  ['상담', '재무상담', '자산부채', 'https://ohwant.net/asset'],
  ['상담', '재무상담', '세금', 'https://ohwant.net/tax'],
  ['상담', '재무상담', '부동산', 'https://ohwant.net/realestate'],
  ['상담', '재무상담', '보험', 'https://ohwant.net/insurance'],
  ['상담', '재무상담', '종합', 'https://ohwant.net/comprehensive'],
];
const 홈페이지 = 'https://ohwant.net';

const 고르기 = (대, 중, 소) => `
  cb1.value=${JSON.stringify(대)}; onCb1();
  cb2.value=${JSON.stringify(중)}; onCb2();
  cb3.value=${JSON.stringify(소)}; buildUrl();
  document.getElementById('autoUrl').textContent`;

(async () => {
  const srv = http.createServer((q, s) => {
    s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    s.end(fs.readFileSync(FILE));
  });
  await new Promise((r) => srv.listen(PORT, r));

  const br = await chromium.launch();
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('http://localhost:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(400);

  console.log('\n═══ ① 처음 열었을 때 ═══');
  const 초기 = await pg.evaluate(() => document.getElementById('autoUrl').textContent);
  t('기본 조합(강의·부트캠프·표준진단) = 부트캠프 실주소',
    초기 === 'https://genya-bootcamp.netlify.app' + utm, 초기);
  t('3단계 기본값 = 표준진단 ("없음"이 아니다)',
    (await pg.evaluate(() => cb3.value)) === '표준진단');

  console.log('\n═══ ② 조합마다 실주소가 뜨나 (홈페이지로 안 떨어지나) ═══');
  for (const [대, 중, 소, 주소] of 기대) {
    const got = await pg.evaluate(고르기(대, 중, 소));
    t(`${대}·${중}·${소} → ${주소.replace('https://', '')}`, got === 주소 + utm, got);
  }

  console.log('\n═══ ③ 3단계 목록이 조합을 따라가나 ═══');
  const 강의목록 = await pg.evaluate(`cb1.value='강의';onCb1();cb2.value='부트캠프';onCb2();
    [...cb3.options].map(o=>o.value||o.textContent)`);
  t('강의는 표준진단 1개뿐 (+추가)', JSON.stringify(강의목록) === JSON.stringify(['표준진단', '추가']), 강의목록);
  const 상담목록 = await pg.evaluate(`cb1.value='상담';onCb1();cb2.value='재무상담';onCb2();
    [...cb3.options].map(o=>o.value||o.textContent)`);
  t('상담은 표준진단 + 진단 8종 (+추가)', 상담목록.length === 10 && 상담목록[0] === '표준진단', 상담목록);

  console.log('\n═══ ④ 표에 없는 조합은 지어내지 않고 홈페이지로 ═══');
  const 모름 = await pg.evaluate(`cb1.value='상담';onCb1();
    const o=document.createElement('option');o.textContent='없는항목';o.selected=true;
    cb2.insertBefore(o,cb2.querySelector('[value="추가"]'));onCb2();
    document.getElementById('autoUrl').textContent`);
  t('모르는 조합 → 홈페이지(가짜 주소 안 만듦)', 모름 === 홈페이지 + utm, 모름);

  console.log('\n═══ ⑤ [직접가기]가 새 탭으로 그 주소를 여나 ═══');
  await pg.evaluate(고르기('강의', '부트캠프', '표준진단'));
  const [새탭] = await Promise.all([
    pg.context().waitForEvent('page', { timeout: 10000 }).catch(() => null),
    pg.evaluate(() => document.querySelector('.urlrow button').click()),
  ]);
  t('새 탭 열림', !!새탭);
  if (새탭) {
    await 새탭.waitForLoadState('domcontentloaded').catch(() => {});
    t('새 탭 주소 = 부트캠프 실주소', 새탭.url().indexOf('genya-bootcamp.netlify.app') >= 0, 새탭.url());
    await 새탭.close();
  }

  console.log('\n═══ ⑥ 그 주소가 원고 통(WON/WURL)으로 넘어가나 ═══');
  const 넘김 = await pg.evaluate(`
    cb1.value='상담'; onCb1(); cb2.value='재무상담'; onCb2(); cb3.value='연금'; buildUrl();
    const landing=(document.getElementById('autoUrl').textContent||'').trim();
    WON['단문']='시험 원고'; WURL['단문']=landing;
    ({landing:landing, won:WON['단문'], wurl:WURL['단문']})`);
  t('화면 URL = 연금 실주소', 넘김.landing === 'https://ohwant.net/pension' + utm, 넘김.landing);
  t('WURL 에 그 주소가 그대로 박힌다', 넘김.wurl === 넘김.landing, 넘김.wurl);
  t('WON 통도 살아 있다', 넘김.won === '시험 원고');

  console.log('\n═══ ⑦ 자바스크립트 오류 ═══');
  t('오류 0건', errs.length === 0, errs);

  await br.close();
  srv.close();

  console.log('\n═══ ⑧ ★죽은 링크 0 — 실제로 열어 본다 ═══');
  const 주소들 = [...new Set(기대.map((r) => r[3]).concat([홈페이지]))];
  for (const u of 주소들) {
    try {
      const r = await fetch(encodeURI(u));
      const m = (await r.text()).match(/<title>([^<]*)<\/title>/i);
      t(`${r.status} ${u.replace('https://', '')}  ::  ${m ? m[1].slice(0, 40) : ''}`, r.status === 200, r.status);
    } catch (e) { t(u + ' 열림', false, e.message); }
  }

  console.log('\n결과: ' + pass + '/' + (pass + fail) + (fail ? '  ★' + fail + '개 실패' : ' — 전부 통과'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('★시험이 도중에 죽었습니다: ' + e.message); process.exit(1); });
