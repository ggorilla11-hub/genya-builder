// ─────────────────────────────────────────────────────────────
// _test_entry_gate.js — 🚪 진입 관문(로그인·온보딩·세션) ★통째 시험 (2026-08-03)
//
// 왜 이 시험이 있나:
//   2026-08-02 부트캠프에서 대표님과 교육생 전원이 온보딩을 반복해 교육이 진행되지 못했다.
//   범인은 둘이었다.
//     범인1 = genya_rt 쿠키(만료 1년)가 로그인 화면을 ★조용히 건너뛰고 이전 세션을 자동 복원 →
//             대표님은 계정을 고를 기회조차 없었다.
//     범인2 = DEMO_FRESH_EMAIL('ggorilla66@gmail.com')이 '체험용=항상 온보딩'으로 코드에 박혀 있었다.
//             범인1이 대표님을 범인2에게 계속 배달했다.
//   교육생 쪽 원인은 별개였다 — 온보딩 여부를 ★구글시트로 판정해서, 시트를 못 읽으면 곧바로 온보딩이었다.
//
// 이 시험은 ★서버를 진짜로 띄우고, 브라우저가 보내는 것과 똑같은 쿠키를 손으로 만들어 /api/boot 에 묻는다.
//   (CLAUDE.md 6-8 ③ — "함수 시험 통과 ≠ 실제로 작동". 코드 문자열 검사만으로는 배포하지 않는다)
//
// 확인하는 것:
//   1. 이메일 하드코딩 제거 — ggorilla66이 교육생과 ★한 글자도 다르지 않게 취급되는가
//   2. VIP(ggorilla11)는 그대로 살아 있는가
//   3. 절대 30일 / 유휴 7일이 실제로 잘리는가
//   4. ★발급시각 없는 옛 쿠키가 안 끊기는가 (배포해도 전원 로그아웃 없음 — 대표님 승인 조건)
//   5. ★조회 실패가 '온보딩'이 아니라 '오류'로 가는가 (교육생 증상의 핵심)
//   6. 만료된 쿠키가 실제로 폐기(Set-Cookie)되는가
//
// 실행: node deploy/_test_entry_gate.js
//   ※ 로컬엔 GOOGLE_SA_JSON이 없다 → durable 조회가 실패한다. 그래서 로컬에서는 정상 계정이
//     route:'error'(FETCH_FAILED)로 나오는 것이 ★정답이다. 이것 자체가 5번의 실증이 된다.
// ─────────────────────────────────────────────────────────────
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

let pass = 0, fail = 0;
const T = async (name, fn) => {
  try { await fn(); console.log('  ✅ ' + name); pass++; }
  catch (e) { console.log('  ❌ ' + name + '  → ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '조건 실패'); };

const PORT = 8097;
const KEY = crypto.randomBytes(32);              // 이 시험 전용 임시 키(서버에도 같은 값을 넘긴다)
const 일 = 24 * 60 * 60 * 1000;

// 서버의 _enc()와 ★같은 형식으로 genya_rt를 만든다: base64(iv12 + tag16 + 암호문)
function 쿠키만들기(payload) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()]);
  const enc = Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  return 'genya_rt=' + encodeURIComponent(enc);
}
async function boot(cookie) {
  const r = await fetch(`http://localhost:${PORT}/api/boot`, { headers: cookie ? { Cookie: cookie } : {} });
  return { json: await r.json(), setCookie: r.headers.get('set-cookie') || '' };
}
const 신선 = (email, extra) => Object.assign({ email, scope: 'openid email profile', rt: '1//test-' + email, iat: Date.now(), la: Date.now() }, extra || {});

(async function main() {
  const env = Object.assign({}, process.env, { PORT: String(PORT), TOKEN_ENC_KEY: KEY.toString('hex') });
  delete env.FILMING_MODE;
  const srv = spawn(process.execPath, [path.join(__dirname, 'main_server.js')], { cwd: __dirname, env, stdio: 'ignore' });
  const 정리 = () => { try { srv.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', 정리);

  console.log('\n🚪 진입 관문 시험 — 서버를 실제로 띄웁니다 …');
  let 떴나 = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/health`); if (r.ok) { 떴나 = true; break; } } catch (e) {}
    await new Promise((s) => setTimeout(s, 1000));
  }
  if (!떴나) { console.log('★서버가 안 떴습니다 — 시험 못 함(통과로 꾸미지 않음)'); 정리(); process.exit(1); }
  console.log('서버 준비됨\n');

  // ── [1] 이메일 하드코딩 제거 ─────────────────────────────────
  console.log('[1] 이메일 하드코딩 제거 — ggorilla66 = 교육생');
  await T('쿠키 없으면 로그인 화면 (자동 복원 없음)', async () => {
    const { json } = await boot(null);
    ok(json.loggedIn === false, '로그인 안 된 상태여야 함: ' + JSON.stringify(json));
    ok(json.route === 'login', 'route=login이어야 함, 실제=' + json.route);
  });
  await T('★ggorilla66이 더는 "항상 온보딩"으로 박혀 있지 않다', async () => {
    const { json } = await boot(쿠키만들기(신선('ggorilla66@gmail.com')));
    ok(json.route !== 'onboarding',
      '66이 여전히 온보딩으로 고정됨(하드코딩 잔존). 실제=' + JSON.stringify(json));
  });
  await T('★ggorilla66과 교육생의 응답이 이메일만 빼고 완전히 같다 (100% 동일 취급)', async () => {
    const a = (await boot(쿠키만들기(신선('ggorilla66@gmail.com')))).json;
    const b = (await boot(쿠키만들기(신선('student-abc@gmail.com')))).json;
    delete a.email; delete b.email;
    ok(JSON.stringify(a) === JSON.stringify(b),
      '66과 교육생 취급이 다름\n    66      =' + JSON.stringify(a) + '\n    교육생  =' + JSON.stringify(b));
  });

  // ── [2] VIP 유지 ────────────────────────────────────────────
  console.log('\n[2] VIP(ggorilla11) 유지 — 절대 지우면 안 되는 것');
  await T('★ggorilla11은 로그인 후 무조건 메인 (온보딩 없음)', async () => {
    const { json } = await boot(쿠키만들기(신선('ggorilla11@gmail.com')));
    ok(json.route === 'main', 'VIP가 메인으로 안 감. 실제=' + JSON.stringify(json));
    ok(json.vip === true, 'vip 표시 사라짐: ' + JSON.stringify(json));
  });
  await T('★VIP도 로그인 관문 자체는 똑같이 통과해야 한다 (쿠키 없으면 로그인 화면)', async () => {
    const { json } = await boot(null);
    ok(json.route === 'login', 'VIP라고 로그인을 건너뛰면 안 됨');
  });

  // ── [3] 세션 수명: 절대 30일 / 유휴 7일 ──────────────────────
  console.log('\n[3] 세션 수명 — 절대 30일 / 유휴 7일(슬라이딩)');
  await T('절대만료: 최초 로그인 31일 전 → 재로그인 요구', async () => {
    const { json } = await boot(쿠키만들기(신선('a@gmail.com', { iat: Date.now() - 31 * 일, la: Date.now() })));
    ok(json.loggedIn === false && json.route === 'login', '31일 지난 세션이 살아있음: ' + JSON.stringify(json));
  });
  await T('유휴만료: 마지막 접속 8일 전 → 재로그인 요구', async () => {
    const { json } = await boot(쿠키만들기(신선('b@gmail.com', { iat: Date.now() - 10 * 일, la: Date.now() - 8 * 일 })));
    ok(json.loggedIn === false && json.route === 'login', '8일 미접속 세션이 살아있음: ' + JSON.stringify(json));
  });
  await T('유효: 20일 전 로그인 + 어제 접속 → 그대로 유지 (매일 쓰면 안 끊긴다)', async () => {
    const { json } = await boot(쿠키만들기(신선('c@gmail.com', { iat: Date.now() - 20 * 일, la: Date.now() - 1 * 일 })));
    ok(json.loggedIn === true, '멀쩡한 세션이 끊김: ' + JSON.stringify(json));
  });
  await T('경계: 29일차 + 6일 미접속 → 아직 유효 (하루 차이로 안 끊김)', async () => {
    const { json } = await boot(쿠키만들기(신선('d@gmail.com', { iat: Date.now() - 29 * 일, la: Date.now() - 6 * 일 })));
    ok(json.loggedIn === true, '경계 안쪽인데 끊김: ' + JSON.stringify(json));
  });
  await T('★만료된 쿠키는 말만 하지 않고 실제로 폐기된다 (Set-Cookie)', async () => {
    const { setCookie } = await boot(쿠키만들기(신선('e@gmail.com', { iat: Date.now() - 40 * 일 })));
    ok(/genya_rt=;/.test(setCookie), '만료인데 쿠키를 안 지움. Set-Cookie=' + (setCookie || '(없음)'));
    ok(/Max-Age=0/.test(setCookie), '쿠키 폐기 지시가 없음: ' + setCookie);
  });

  // ── [4] 기존 사용자 구제 (배포해도 전원 로그아웃 없음) ─────────
  console.log('\n[4] 기존 쿠키 구제 — 배포해도 아무도 안 끊긴다 (대표님 승인 조건)');
  await T('★발급시각이 없는 옛 쿠키(1년짜리)도 그대로 살려 준다', async () => {
    const 옛쿠키 = 쿠키만들기({ email: 'old@gmail.com', scope: 'openid email profile', rt: '1//old' }); // iat·la 없음
    const { json } = await boot(옛쿠키);
    ok(json.loggedIn === true, '기존 사용자가 배포 즉시 로그아웃됨(승인 조건 위반): ' + JSON.stringify(json));
  });
  await T('★옛 쿠키에 이번 접속으로 시각이 새겨진다 (여기서부터 30일/7일 기산)', async () => {
    const 옛쿠키 = 쿠키만들기({ email: 'old2@gmail.com', scope: 'openid email profile', rt: '1//old2' });
    const { setCookie } = await boot(옛쿠키);
    ok(/genya_rt=/.test(setCookie) && !/genya_rt=;/.test(setCookie),
      '옛 쿠키에 시각을 안 새김 → 다음에도 계속 옛 쿠키. Set-Cookie=' + (setCookie || '(없음)'));
  });

  // ── [5] 조회 실패 ≠ 온보딩 ──────────────────────────────────
  console.log('\n[5] ★조회 실패는 온보딩이 아니다 — 교육생 증상의 핵심');
  await T('★온보딩 기록을 못 읽으면 오류 화면으로 간다 (온보딩으로 떨어지지 않는다)', async () => {
    // 로컬엔 GOOGLE_SA_JSON이 없어 durable 조회가 실제로 실패한다 = 진짜 실패 상황 재현
    const { json } = await boot(쿠키만들기(신선('student-xyz@gmail.com')));
    ok(json.route === 'error', 'route=error 여야 함. 실제=' + JSON.stringify(json));
    ok(json.error === 'FETCH_FAILED', 'error=FETCH_FAILED 여야 함: ' + JSON.stringify(json));
    ok(json.route !== 'onboarding', '★조회 실패가 온보딩으로 감 = 사고 재현');
  });
  await T('오류일 때도 로그인 상태는 유지된다 (로그인 화면으로 튕기지 않는다)', async () => {
    const { json } = await boot(쿠키만들기(신선('student-xyz2@gmail.com')));
    ok(json.loggedIn === true, '오류인데 로그아웃시킴: ' + JSON.stringify(json));
    ok(!!json.email, '어떤 계정에서 난 오류인지 안 알려줌: ' + JSON.stringify(json));
  });

  // ── [6] 탈출구 ─────────────────────────────────────────────
  console.log('\n[6] 로그인 화면 탈출구 — 공용 PC·교육장');
  await T('/switch 가 계정 선택창으로 보낸다', async () => {
    const r = await fetch(`http://localhost:${PORT}/switch`, {
      redirect: 'manual', headers: { Cookie: 쿠키만들기(신선('someone@gmail.com')) },
    });
    ok(r.status >= 300 && r.status < 400, '리다이렉트가 아님: ' + r.status);
    const loc = r.headers.get('location') || '';
    ok(/\/auth\/google|\/login/.test(loc), 'location이 이상함: ' + loc);
  });
  await T('★/switch 는 남은 genya_rt를 실제로 지운다 (자동 복원 건너뛰기)', async () => {
    const r = await fetch(`http://localhost:${PORT}/switch`, {
      redirect: 'manual', headers: { Cookie: 쿠키만들기(신선('someone2@gmail.com')) },
    });
    const sc = r.headers.get('set-cookie') || '';
    ok(/genya_rt=;/.test(sc), '/switch가 쿠키를 안 지움: ' + (sc || '(없음)'));
  });
  await T('로그인 화면에 [다른 계정으로 로그인] 버튼이 실제로 있다', async () => {
    const html = await (await fetch(`http://localhost:${PORT}/`)).text();
    ok(/다른 계정으로 로그인/.test(html), '버튼 문구가 화면에 없음');
    ok(/location\.href='\/switch'/.test(html), '버튼이 /switch로 안 감');
  });
  await T('★로그인 ID 배지가 화면에 있다 (지금 어떤 계정인지 항상 보이게)', async () => {
    const html = await (await fetch(`http://localhost:${PORT}/`)).text();
    ok(/id="whoBadge"/.test(html), '로그인 ID 배지가 없음');
    ok(/_paintWho\(d\.email\)/.test(html), '배지에 실제 이메일을 안 채움');
  });

  console.log(`\n결과: ${pass}/${pass + fail} — ` + (fail ? `★${fail}개 실패` : '전부 통과'));
  정리();
  process.exit(fail ? 1 : 0);
})();
