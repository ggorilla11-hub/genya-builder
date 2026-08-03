// ─────────────────────────────────────────────────────────────
// _test_allowlist.js — 🔐 허용계정 게이트 ★통째 시험 (2026-08-03)
//
// 왜: 구글 OAuth 프로덕션 전환으로 ★아무 구글 계정이나 로그인할 수 있게 됐다.
//     고객 명단(개인정보)을 다루므로 "등록된 사람만" 들어와야 한다.
//     ★그런데 이 게이트는 잘못 만들면 ★교육생 전원이 못 들어온다 — 개강 당일 사고가 된다.
//     그래서 "막히나"만이 아니라 "★열려야 할 사람이 열리나"를 같은 무게로 시험한다.
//
// ★실제 시트를 쓰지 않는다 — 가짜 시트를 붙여 ★고장 상황(권한 오류·이메일 0개)까지 재현한다.
//   진짜 시트로만 시험하면 "오류일 때 어떻게 되나"를 영원히 못 본다.
//
// 실행: node deploy/_test_allowlist.js
// ─────────────────────────────────────────────────────────────
'use strict';
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
const T = async (name, fn) => {
  try { await fn(); console.log('  ✅ ' + name); pass++; }
  catch (e) { console.log('  ❌ ' + name + '  → ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '조건 실패'); };

// ── 가짜 구글 시트 ──────────────────────────────────────────
//   googleapis를 가로채 우리가 정한 값/오류를 돌려준다. 네트워크·실키 없이 모든 갈래를 만든다.
let 시트동작 = null; // () => rows  또는  throw
const 가짜 = {
  auth: { GoogleAuth: class { constructor() {} } },
  sheets: () => ({
    spreadsheets: {
      get: async () => {
        if (typeof 시트동작 !== 'function') throw new Error('시트 미설정');
        시트동작(); // 오류를 내야 하면 여기서 던진다
        return { data: { properties: { title: '지니야_허용계정_명단' }, sheets: [{ properties: { title: '시트1' } }] } };
      },
      values: { get: async () => ({ data: { values: 시트동작() } }) },
    },
  }),
};
const _origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'googleapis') return { google: 가짜 };
  return _origLoad.apply(this, arguments);
};

const VIP = 'ggorilla11@gmail.com';
const 교육생 = 'psklby100@gmail.com';
const 미등록 = 'stranger@gmail.com';
const 정상시트 = [['이름', '이메일'], ['오상열', VIP], ['오상열', 'ggorilla66@gmail.com'], ['박수근', 교육생]];

// 캐시(60초)를 우회하려고 판정할 때마다 모듈을 새로 읽는다.
function 새게이트() {
  delete require.cache[require.resolve('./login_allowlist')];
  const a = require('./login_allowlist');
  a.init({ vipEmail: VIP });
  return a;
}

(async function main() {
  process.env.GOOGLE_SA_JSON = JSON.stringify({ client_email: 'jenya-server@moneya-72fe6.iam.gserviceaccount.com' });
  process.env.ALLOWLIST_SHEET_ID = 'TEST_SHEET';

  console.log('\n🔐 허용계정 게이트 시험 — 가짜 시트로 고장까지 재현합니다\n');

  console.log('[1] 통과해야 할 사람 (★이게 막히면 개강이 멈춘다)');
  await T('★대표(11) 통과', async () => {
    시트동작 = () => 정상시트;
    const r = await 새게이트().check(VIP);
    ok(r.allowed, '대표님이 막힘: ' + JSON.stringify(r));
  });
  await T('★교육생(명단에 있음) 통과', async () => {
    시트동작 = () => 정상시트;
    const r = await 새게이트().check(교육생);
    ok(r.allowed, '교육생이 막힘: ' + JSON.stringify(r));
    ok(r.source === 'sheet', '시트로 판정한 게 아님: ' + JSON.stringify(r));
  });
  await T('대문자·공백이 섞여도 통과 (사람이 손으로 넣는 시트라 반드시 필요)', async () => {
    시트동작 = () => [['이름', '이메일'], ['박수근', '  PSKLBY100@Gmail.com  ']];
    const r = await 새게이트().check('psklby100@gmail.com');
    ok(r.allowed, '대소문자·공백 때문에 막힘: ' + JSON.stringify(r));
  });
  await T('★이메일이 A열이 아니어도 찾는다 (실제 시트가 A=이름·B=이메일이었다)', async () => {
    시트동작 = () => [['이름', '이메일'], ['박수근', 교육생]];
    const r = await 새게이트().check(교육생);
    ok(r.allowed, '★열 위치 때문에 막힘 = 전원 차단 사고: ' + JSON.stringify(r));
  });
  await T('열 순서를 바꿔도 찾는다 (대표님이 시트를 편집해도 안 깨짐)', async () => {
    시트동작 = () => [['이메일', '이름'], [교육생, '박수근']];
    ok((await 새게이트().check(교육생)).allowed, '열을 바꾸니 막힘');
  });

  console.log('\n[2] 막아야 할 사람');
  await T('★미등록 계정 차단', async () => {
    시트동작 = () => 정상시트;
    const r = await 새게이트().check(미등록);
    ok(!r.allowed, '★아무나 들어옴 = 게이트 무효: ' + JSON.stringify(r));
  });
  await T('머리글("이메일")을 계정으로 오인하지 않는다', async () => {
    시트동작 = () => 정상시트;
    ok(!(await 새게이트().check('이메일')).allowed, '머리글이 통과됨');
  });
  await T('이메일이 없으면 차단', async () => {
    시트동작 = () => 정상시트;
    ok(!(await 새게이트().check('')).allowed, '빈 이메일이 통과됨');
  });

  console.log('\n[3] ★시트가 고장났을 때 — 대표님은 절대 안 잠긴다');
  await T('★시트 권한 오류인데 대표(11)는 통과', async () => {
    시트동작 = () => { throw new Error('The caller does not have permission'); };
    const r = await 새게이트().check(VIP);
    ok(r.allowed, '★대표님이 잠김 = 최악: ' + JSON.stringify(r));
    ok(r.source === 'vip', 'VIP 경로가 아님: ' + JSON.stringify(r));
  });
  await T('시트 오류 + 캐시 없음 → 나머지는 차단(fail-closed)', async () => {
    시트동작 = () => { throw new Error('The caller does not have permission'); };
    const r = await 새게이트().check(교육생);
    ok(!r.allowed, '읽지도 못했는데 통과시킴: ' + JSON.stringify(r));
    ok(r.source === 'fail-closed', JSON.stringify(r));
  });
  await T('★캐시 폴백: 한 번 읽은 뒤 시트가 죽으면 ★직전 명단으로 교육생을 살린다', async () => {
    const a = 새게이트();
    시트동작 = () => 정상시트;
    ok((await a.check(교육생)).allowed, '1차 판정부터 실패');
    시트동작 = () => { throw new Error('시트 서버 오류'); };
    await new Promise((s) => setTimeout(s, 1100)); // 캐시 만료 유도용 여유
    const r = await a.check(교육생);
    ok(r.allowed, '★시트가 죽자 교육생이 잠김 = 개강 중단: ' + JSON.stringify(r));
  });
  await T('캐시 폴백이어도 ★미등록자는 여전히 차단(보안 안 풀림)', async () => {
    const a = 새게이트();
    시트동작 = () => 정상시트;
    await a.check(교육생);
    시트동작 = () => { throw new Error('시트 서버 오류'); };
    const r = await a.check(미등록);
    ok(!r.allowed, '★고장을 틈타 아무나 들어옴: ' + JSON.stringify(r));
  });

  console.log('\n[4] ★게이트 자체를 끄고 켜기 (배포 순서가 꼬여도 안 잠기게)');
  await T('★ALLOWLIST_SHEET_ID 없으면 게이트 꺼짐 = 전원 통과', async () => {
    delete process.env.ALLOWLIST_SHEET_ID;
    const a = 새게이트();
    const r = await a.check(미등록);
    ok(r.allowed && r.source === 'off', '★시트ID 없는데 사람을 막음 = 배포 즉시 전원 잠김: ' + JSON.stringify(r));
    process.env.ALLOWLIST_SHEET_ID = 'TEST_SHEET';
  });
  await T('시트ID를 넣으면 자동으로 켜진다', async () => {
    시트동작 = () => 정상시트;
    ok(!(await 새게이트().check(미등록)).allowed, '켜지지 않음');
  });

  console.log('\n[5] 진단창구 — 대표님이 눈으로 확인하는 곳');
  await T('정상이면 허용 인원수를 알려준다 (이메일은 안 내보낸다)', async () => {
    시트동작 = () => 정상시트;
    const d = await 새게이트().diag();
    ok(d.허용인원 === 3, '인원수가 틀림: ' + JSON.stringify(d));
    ok(!JSON.stringify(d).includes(교육생), '★진단창구에 이메일이 노출됨: ' + JSON.stringify(d));
  });
  await T('★시트는 읽히는데 이메일 0개면 ★경고한다 (조용히 전원 차단되는 걸 막는다)', async () => {
    시트동작 = () => [['이름'], ['박수근'], ['오상열']]; // 이메일 칸이 통째로 없다
    const d = await 새게이트().diag();
    ok(d.허용인원 === 0, JSON.stringify(d));
    ok(/이메일이 0개|전원 차단/.test(d.진단 || ''), '★0개인데 경고를 안 함 = 조용한 전원차단: ' + JSON.stringify(d));
  });
  await T('게이트가 꺼져 있으면 진단이 그것을 분명히 말한다', async () => {
    delete process.env.ALLOWLIST_SHEET_ID;
    const d = await 새게이트().diag();
    ok(/꺼/.test(d.게이트 || '') && /아무 구글 계정/.test(d.진단 || ''), JSON.stringify(d));
    process.env.ALLOWLIST_SHEET_ID = 'TEST_SHEET';
  });

  console.log('\n[6] 차단 화면');
  await T('★시도한 계정을 화면에 보여준다 (이번 사고의 본질)', async () => {
    const html = 새게이트().blockedHtml(미등록, '허용 명단에 없는 계정입니다');
    ok(html.includes(미등록), '어떤 계정으로 막혔는지 안 보여줌');
    ok(/등록되지 않은 계정/.test(html), '차단 문구 없음');
    ok(/\/switch/.test(html), '다른 계정으로 로그인 통로가 없음');
  });
  await T('화면에 넣는 값은 이스케이프한다(태그 주입 방지)', async () => {
    const html = 새게이트().blockedHtml('<script>bad()</script>@x.com', '');
    ok(!/<script>bad/.test(html), '★스크립트가 그대로 들어감');
  });

  // ── [7] ★서버를 진짜로 띄워 확인 — 진짜 시트·진짜 SA ────────────
  //   위 시험은 전부 가짜 시트다. "모듈은 되는데 서버에선 안 붙었다"를 막으려면
  //   ★실제 서버가 실제 시트를 보고 막는지까지 확인해야 한다(CLAUDE.md 6-8 ③).
  console.log('\n[7] ★서버 통째 — 진짜 시트로 (SA 키 필요)');
  Module._load = _origLoad; // 가짜 googleapis 해제(자식 프로세스엔 원래 영향 없음)
  const fsMod = require('fs');
  const { spawn } = require('child_process');
  const crypto = require('crypto');
  const SA_PATH = path.join(__dirname, '..', '..', 'genya-builder', 'server', 'google-key.json');
  let SA = null;
  try { SA = fsMod.readFileSync(SA_PATH, 'utf8'); JSON.parse(SA); } catch (e) { SA = null; }
  const REAL_SHEET = '1nZPn0NJyIsrT39AgdpFqvNsuDceZ9x4zoV_pf86ybGY';
  if (!SA) {
    console.log('  ⚠️ SA 키가 없어 [7]을 건너뜁니다 — ★통과로 세지 않습니다.');
  } else {
    const PORT = 8093;
    const KEY = crypto.randomBytes(32);
    const env = Object.assign({}, process.env, {
      PORT: String(PORT), TOKEN_ENC_KEY: KEY.toString('hex'),
      GOOGLE_SA_JSON: SA, ALLOWLIST_SHEET_ID: REAL_SHEET,
    });
    delete env.FILMING_MODE;
    const srv = spawn(process.execPath, [path.join(__dirname, 'main_server.js')], { cwd: __dirname, env, stdio: 'ignore' });
    const 정리 = () => { try { srv.kill('SIGKILL'); } catch (e) {} };
    process.on('exit', 정리);
    let 떴나 = false;
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`http://localhost:${PORT}/health`); if (r.ok) { 떴나 = true; break; } } catch (e) {}
      await new Promise((s) => setTimeout(s, 1000));
    }
    if (!떴나) { console.log('  ★서버가 안 떴습니다 — [7] 시험 못 함(통과로 꾸미지 않음)'); fail++; }
    else {
      const 쿠키 = (email) => {
        const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
        const p = JSON.stringify({ email, scope: 'openid email profile', rt: '1//x-' + email, iat: Date.now(), la: Date.now() });
        const ct = Buffer.concat([c.update(p, 'utf8'), c.final()]);
        return 'genya_rt=' + encodeURIComponent(Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'));
      };
      const boot = async (em) => {
        const r = await fetch(`http://localhost:${PORT}/api/boot`, { headers: { Cookie: 쿠키(em) } });
        return { json: await r.json(), setCookie: r.headers.get('set-cookie') || '' };
      };

      await T('★진짜 시트를 실제로 읽는다 (SA 권한·시트 공유 실증)', async () => {
        const d = await (await fetch(`http://localhost:${PORT}/api/diag/allowlist`)).json();
        ok(d.시트읽기 === true, '★라이브에서 시트를 못 읽음 — 배포하면 전원 차단: ' + JSON.stringify(d));
        ok(d.허용인원 >= 1, '★허용 인원 0명 = 전원 차단: ' + JSON.stringify(d));
        console.log('       (허용 ' + d.허용인원 + '명 · ' + d.문서제목 + ' · 읽은 SA ' + d.읽은_서비스계정 + ')');
      });
      await T('★★미등록자는 쿠키가 있어도 복원되지 않는다 (게이트의 진짜 관문)', async () => {
        const { json, setCookie } = await boot(미등록);
        ok(json.loggedIn === false, '★쿠키만 있으면 그대로 들어옴 = 게이트 무효: ' + JSON.stringify(json));
        ok(/genya_rt=;/.test(setCookie), '차단했는데 쿠키를 안 지움: ' + (setCookie || '(없음)'));
      });
      await T('★명단에 있는 교육생은 쿠키로 정상 복원된다 (막히면 개강 중단)', async () => {
        const { json } = await boot(교육생);
        ok(json.loggedIn === true, '★교육생이 잠김: ' + JSON.stringify(json));
      });
      await T('★대표(11)도 정상 복원된다', async () => {
        const { json } = await boot(VIP);
        ok(json.loggedIn === true, '★대표님이 잠김 = 최악: ' + JSON.stringify(json));
      });
      await T('게이트가 A(온보딩 라우팅)를 깨지 않았다', async () => {
        const r = await fetch(`http://localhost:${PORT}/api/boot`);
        const j = await r.json();
        ok(j.route === 'login' && j.loggedIn === false, 'A의 미로그인 판정이 바뀜: ' + JSON.stringify(j));
      });
      정리();
    }
  }

  console.log(`\n결과: ${pass}/${pass + fail} — ` + (fail ? `★${fail}개 실패` : '전부 통과'));
  Module._load = _origLoad;
  process.exit(fail ? 1 : 0);
})();
