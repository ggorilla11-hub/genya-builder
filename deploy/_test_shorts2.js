// ═══════════════════════════════════════════════════════════════════
// _test_shorts2.js · 쇼츠 2안 「지니야 침투」 시험
//
//   ★말이 아니라 숫자와 좌표로 본다 —
//     [1] 장면 분석(shorts_scene) — 프롬프트에서 글자·얼굴 금지가 ★지켜지나
//     [2] covers 정리 — 자막이 ★하나도 안 빠지고 한 번씩만 들어가나
//     [3] 게이트 — 대표님이 아니면 ★두뇌를 아예 안 부르나(막고 나서 부르면 돈이 나간다)
//     [4] 화면 — 켄번즈 네모가 사진 ★밖으로 안 나가나(여백이 생기면 검은 띠가 뜬다)
//     [5] 폴백 — 배경이 없어도 ★쇼츠가 나오나 (이게 제일 중요하다)
//     [6] 세이프존 — 자막·CTA·서명이 플랫폼 UI 자리에 안 걸리나
//     [7] 오류 0건
//
//   돌리는 법: node deploy/_test_shorts2.js
//   ★돈이 드는 호출(Claude·gpt-image-1)은 ★한 번도 하지 않는다 — 가짜로 갈아 끼워 시험한다.
// ═══════════════════════════════════════════════════════════════════
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const S = require('./shorts_scene');
const { chromium } = require(path.join(__dirname, '..', 'server', 'node_modules', 'playwright'));

const FILE = path.join(__dirname, 'downloads', 'promo_sim_v8.html');
const PORT = 8796;

let pass = 0, fail = 0;
const t = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (got !== undefined ? '  → 실제: ' + JSON.stringify(got) : '')); }
};

// 가짜 두뇌 — 진짜 Claude를 안 부른다. 응답 모양만 같게 준다.
function 가짜두뇌(scenes) {
  return { messages: { create: async () => ({
    content: [{ type: 'tool_use', name: 'scenes', input: { scenes } }],
    usage: { input_tokens: 10, output_tokens: 10 },
  }) } };
}

(async () => {
  console.log('\n═══ [1] 프롬프트 안전 — 글자·얼굴이 안 들어가나 ═══');
  const 더러운 = 'A dining table with a big TEXT sign, letters on the wall, a logo, watermark, a smiling face';
  const 깨끗 = S._다듬기(더러운);
  // ★꼬리표에는 "no text"처럼 그 낱말이 일부러 들어간다 → ★본문 쪽만 본다
  const 본문 = 깨끗.split(', photorealistic')[0];
  t('본문에서 text·letters·logo·watermark 낱말이 지워진다',
    !/\b(text|letters?|logo|watermark)\b/i.test(본문), 본문.slice(0, 90));
  t('꼬리표에 "no text" 가 붙는다', /no text/.test(깨끗));
  t('꼬리표에 "no human face" 가 붙는다', /no human face/.test(깨끗));
  t('실사풍 지시가 붙는다', /photorealistic/.test(깨끗));
  t('위아래 여백 지시가 붙는다', /top and bottom/.test(깨끗));
  t('빈 프롬프트는 빈 문자열로 (지어내지 않는다)', S._다듬기('') === '' && S._다듬기(null) === '');
  t('상한 700자를 넘지 않는다', S._다듬기('x'.repeat(3000)).length <= 700);

  console.log('\n═══ [2] covers — 자막이 빠지지도 겹치지도 않나 ═══');
  const c1 = S._covers정리([{ covers: [1, 2] }, { covers: [4] }], 5);
  const 모은것 = c1.flatMap((s) => s.covers).sort((a, b) => a - b);
  t('빠진 번호(3,5)가 채워진다 → 1~5 전부', JSON.stringify(모은것) === '[1,2,3,4,5]', 모은것);
  const c2 = S._covers정리([{ covers: [1, 1, 2] }, { covers: [2, 3] }], 3);
  const 모은2 = c2.flatMap((s) => s.covers);
  t('겹친 번호는 한 번만 쓴다', new Set(모은2).size === 모은2.length, 모은2);
  const c3 = S._covers정리([{ covers: [] }, { covers: [] }], 2);
  t('아무 것도 안 준 경우도 전부 덮인다', c3.flatMap((s) => s.covers).length === 2, c3);
  const c4 = S._covers정리([{ covers: [9, 0, -1, 'x'] }], 2);
  t('없는 번호는 버린다(1~2만 남는다)', JSON.stringify(c4[0].covers) === '[1,2]', c4[0].covers);

  console.log('\n═══ [2-b] ★실측에서 겪은 것 — 모델이 배열 대신 JSON 글자로 답할 때 ═══');
  const 정상 = [{ label: 'a', covers: [1], prompt: 'p' }];
  t('배열이면 그대로', S._풀기({ scenes: 정상 }).length === 1);
  t('★JSON 글자로 와도 받는다(실제로 겪음)', S._풀기({ scenes: JSON.stringify({ scenes: 정상 }) }).length === 1);
  t('한 겹 더 싸여도 받는다', S._풀기(JSON.stringify({ scenes: 정상 })).length === 1);
  t('모양이 아예 다르면 ★넓히지 않고 빈 배열', S._풀기({ 뭔가: 1 }).length === 0 && S._풀기('망가진 글자').length === 0);

  console.log('\n═══ [3] 비용 게이트 — 막힌 계정은 두뇌를 안 부른다 ═══');
  let 불렸나 = false;
  S.init({ isRep: () => false, anthropic: { messages: { create: async () => { 불렸나 = true; return {}; } } } });
  const app = require('express')();
  app.use(require('express').json());
  app.use('/api/media', S.router);
  const srv2 = app.listen(8797);
  const r403 = await fetch('http://localhost:8797/api/media/shorts/scenes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ 자막들: ['가'] }) });
  t('대표님이 아니면 403', r403.status === 403, r403.status);
  t('★두뇌를 아예 안 불렀다(돈 0)', 불렸나 === false);
  const diag = await fetch('http://localhost:8797/api/media/shorts/scenes/diag').then((r) => r.json());
  // ★참/거짓으로 본다 — 문구로 판정하면 "대표님만 사용 가능(불가)" 안의 "사용 가능"에 걸려 뒤집힌다
  t('진단 창구가 사용가능=false 라고 말한다', diag.사용가능 === false, diag);
  srv2.close();

  console.log('\n═══ [3-b] 대표님이면 정상 분석 ═══');
  S.init({ isRep: () => true, anthropic: 가짜두뇌([
    { label: '식탁 위 가계부', covers: [1, 2], prompt: 'A dining table with an open ledger and two coffee cups' },
    { label: '통장과 열쇠', covers: [3, 4, 5], prompt: 'A bankbook and a new house key on a wooden desk' },
  ]) });
  const out = await S.analyze(['가', '나', '다', '라', '마'], '한줄카피');
  t('장면 2개를 받는다', out.scenes.length === 2, out.scenes.length);
  t('모든 자막이 덮인다', JSON.stringify(out.scenes.flatMap((s) => s.covers).sort()) === '[1,2,3,4,5]');
  t('두 프롬프트 다 안전 꼬리표가 붙었다', out.scenes.every((s) => /no text/.test(s.prompt) && /no human face/.test(s.prompt)));
  let 죽었나 = '';
  S.init({ isRep: () => true, anthropic: 가짜두뇌([]) });
  await S.analyze(['가'], '').catch((e) => { 죽었나 = e.message; });
  t('★장면이 0개면 "만들었다"고 안 한다(정직히 실패)', !!죽었나, 죽었나);

  console.log('\n═══ [4]~[7] 화면 — 켄번즈·폴백·세이프존 ═══');
  const srv = http.createServer((q, s) => {
    s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); s.end(fs.readFileSync(FILE)); });
  await new Promise((r) => srv.listen(PORT, r));
  const br = await chromium.launch();
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('http://localhost:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(400);

  // [4] 켄번즈 — 잘라낼 네모가 사진 밖으로 나가지 않나 (1024×1536 사진 기준)
  const ken = await pg.evaluate(`
    const img={naturalWidth:1024,naturalHeight:1536};
    const bad=[]; let minH=1e9;
    for(let z=1; z<=1+SH.KEN_Z+0.001; z+=0.01){
      for(let py=-SH.KEN_P; py<=SH.KEN_P+0.001; py+=0.05){
        const r=_shCover(img,z,py);
        if(r[0]<0||r[1]<0||r[0]+r[2]>1024.001||r[1]+r[3]>1536.001) bad.push([z.toFixed(2),py.toFixed(2),r]);
        minH=Math.min(minH, SH.W/ (r[2]/1) );
      }
    }
    ({bad:bad.slice(0,3), badN:bad.length});`);
  t('★켄번즈 네모가 사진 밖으로 안 나간다(검은 띠 0)', ken.badN === 0, ken.bad);
  const cover = await pg.evaluate(`
    const r=_shCover({naturalWidth:1024,naturalHeight:1536},1,0);
    ({r, 덮나:(1080/r[2])>=(1920/r[3])-0.001});`);
  t('줌 1.0에서도 화면을 꽉 덮는다', cover.덮나, cover.r);

  // [5] ★폴백 — 배경 없이도 한 프레임이 그려지나 (이게 제일 중요하다)
  const fb = await pg.evaluate(`
    WON['쇼츠원고']='[자막] 첫 문장\\n[자막] 둘째\\n[자막] 셋째';
    const scenes=_shScenes(WON['쇼츠원고']);
    const plan=_shPlan(scenes); plan.bg=[]; plan.cta='ohwant.net/pension';
    const cv=document.createElement('canvas'); cv.width=SH.W; cv.height=SH.H;
    const ctx=cv.getContext('2d');
    let err=''; try{ _shFrame(ctx,plan,0.1,2); _shFrame(ctx,plan,plan.total-0.01,2); }catch(e){ err=e.message; }
    const d=ctx.getImageData(0,0,SH.W,SH.H).data;
    let 칠해짐=0; for(let i=3;i<d.length;i+=4000) if(d[i]>0) 칠해짐++;
    ({err, 씬수:scenes.length, 칠해짐, 총길이:Math.round(plan.total*10)/10});`);
  t('★배경 사진이 없어도 프레임이 그려진다(폴백)', fb.err === '' && fb.칠해짐 > 0, fb);
  t('폴백에서도 길이가 20~28초', fb.총길이 >= 20 && fb.총길이 <= 28, fb.총길이);

  // 배경이 "있을 때"도 그려지나 — 가짜 사진(초록 캔버스)으로
  const wb = await pg.evaluate(`(function(){
    const c=document.createElement('canvas'); c.width=1024; c.height=1536;
    const g=c.getContext('2d'); g.fillStyle='#3A7'; g.fillRect(0,0,1024,1536);
    return new Promise(res=>{
      const im=new Image();
      im.onload=()=>{
        const scenes=_shScenes(WON['쇼츠원고']);
        const plan=_shPlan(scenes); plan.cta='ohwant.net/pension';
        plan.bg=[{img:im,covers:[1,2],dir:1},{img:im,covers:[3],dir:-1}];
        _shBgTimes(plan);
        const cv=document.createElement('canvas'); cv.width=SH.W; cv.height=SH.H;
        const ctx=cv.getContext('2d');
        let err=''; try{ for(let k=0;k<=10;k++) _shFrame(ctx,plan,plan.total*k/10,2); }catch(e){ err=e.message; }
        const d=ctx.getImageData(0,0,SH.W,SH.H).data;
        let 투명=0; for(let i=3;i<d.length;i+=4000) if(d[i]===0) 투명++;
        res({err, 투명, t0:plan.bg.map(b=>[Math.round(b.t0*10)/10,Math.round(b.t1*10)/10])});
      };
      im.src=c.toDataURL();
    });
  })()`);
  t('★사진 배경으로도 프레임이 그려진다', wb.err === '', wb.err);
  t('★빈 곳(투명)이 한 점도 없다 — 검은 띠 0', wb.투명 === 0, wb.투명);
  t('배경마다 보이는 구간이 정해진다', Array.isArray(wb.t0) && wb.t0.length === 2, wb.t0);

  // [6] 세이프존 — 자막·CTA·서명이 UI 자리에 안 걸리나
  const sz = await pg.evaluate(`({
    자막위:SH.TXT_TOP, 자막아래:SH.TXT_TOP+SH.TXT_H,
    CTA:SH.CTA_Y, 서명:SH.H-SH.BOT-30, 아래세이프:SH.H-SH.BOT, 위세이프:SH.TOP });`);
  t('자막이 위 세이프존(150) 아래에서 시작', sz.자막위 >= sz.위세이프, sz);
  t('★CTA 주소가 하단 세이프존(1520) 위에 있다', sz.CTA + 40 <= sz.아래세이프, sz);
  t('CTA와 서명이 안 겹친다', Math.abs(sz.CTA - sz.서명) >= 70, sz);
  t('자막 블록과 CTA가 안 겹친다', sz.자막아래 <= sz.CTA - 40, sz);

  // CTA 주소는 배치5 URL에서 온다
  const cta = await pg.evaluate(`
    cb1.value='상담';onCb1();cb2.value='재무상담';onCb2();cb3.value='연금';buildUrl();
    const u=(document.getElementById('autoUrl').textContent||'').trim();
    u.split('?')[0].replace(/^https?:\\/\\//,'').replace(/\\/$/,'');`);
  t('★하단 CTA = 배치5 실주소(꼬리표 없이)', cta === 'ohwant.net/pension', cta);

  // [7] 오류
  t('자바스크립트 오류 0건', errs.length === 0, errs);

  await br.close(); srv.close();
  console.log('\n결과: ' + pass + '/' + (pass + fail) + (fail ? '  ★' + fail + '개 실패' : ' — 전부 통과'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('★시험이 도중에 죽었습니다: ' + e.message); process.exit(1); });
