// ─────────────────────────────────────────────────────────────
// _test_filming_e2e.js — 🎬 촬영 모드 ★대화 통째 시험 (2026-07-31)
//
// 왜: "함수 시험 61/61 통과했는데 실제 대화에선 안 됐다"는 사고가 반복됐다(CLAUDE.md 6-8 ③).
//     그래서 이 시험은 ★서버를 진짜로 띄우고, 대표님이 촬영 때 말할 문장 그대로 /api/order 로 묻는다.
//
// 확인하는 것:
//   1. 촬영 모드 서버에서 "명단 띄워봐" → 촬영용 샘플(김철수 등)이 나온다
//   2. "8월 만기 고객 알려줘" → 지시하신 8명이 나온다
//   3. ★평소 모드(FILMING_MODE 없음) 서버에서는 같은 질문에 샘플이 안 나온다 = 라이브로 안 샌다
//   4. 촬영 모드에서 실제 발송 라우트가 막혀 있다
//
// 실행: node deploy/_test_filming_e2e.js       (.env 필요 · LLM 실호출)
// ─────────────────────────────────────────────────────────────
'use strict';
const { spawn } = require('child_process');
const path = require('path');

let pass = 0, fail = 0;
const T = async (name, fn) => {
  try { await fn(); console.log('  ✅ ' + name); pass++; }
  catch (e) { console.log('  ❌ ' + name + '  → ' + e.message); fail++; }
};
const ok = (c, m) => { if (!c) throw new Error(m || '조건 실패'); };

function 서버띄우기(port, filming) {
  const env = Object.assign({}, process.env, { PORT: String(port) });
  if (filming) env.FILMING_MODE = '1'; else delete env.FILMING_MODE;
  return spawn(process.execPath, [path.join(__dirname, 'main_server.js')], { cwd: __dirname, env, stdio: 'ignore' });
}
async function 깨어남(port, 초) {
  for (let i = 0; i < 초; i++) {
    try { const r = await fetch(`http://localhost:${port}/health`); if (r.ok) return true; } catch (e) {}
    await new Promise((s) => setTimeout(s, 1000));
  }
  return false;
}
async function ask(port, q) {
  const r = await fetch(`http://localhost:${port}/api/order`, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ q }),
  });
  return r.json();
}
const 글자 = (o) => JSON.stringify(o);

const AUG8 = ['김철수', '이영희', '최동욱', '신미경', '강수연', '정우진', '한지민', '오세훈'];
const P_FILM = 8098, P_LIVE = 8099;

(async function main() {
  const s1 = 서버띄우기(P_FILM, true);
  const s2 = 서버띄우기(P_LIVE, false);
  const 정리 = () => { try { s1.kill('SIGKILL'); } catch (e) {} try { s2.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', 정리);

  console.log('\n서버 두 대를 실제로 띄웁니다 (🎬촬영 모드 / 평소 모드) …');
  if (!await 깨어남(P_FILM, 60) || !await 깨어남(P_LIVE, 60)) {
    console.log('★서버가 안 떴습니다 — 시험 못 함(통과로 꾸미지 않음)');
    정리(); process.exit(1);
  }
  console.log('두 대 다 준비됨\n');

  console.log('━━━ 1. 🎬촬영 모드에서 대표님이 말할 문장 그대로 ━━━');
  let r1;
  await T('"명단 띄워봐" → 촬영용 샘플이 나온다', async () => {
    r1 = await ask(P_FILM, '명단 띄워봐');
    const t = 글자(r1);
    ok(AUG8.some((n) => t.includes(n)), '샘플 이름이 하나도 없음: ' + t.slice(0, 300));
  });
  await T('"명단 몇 명이야" → 80명이라고 답한다', async () => {
    const r = await ask(P_FILM, '명단 전체 몇 명이야?');
    ok(/80/.test(글자(r)), '80이 안 보임: ' + 글자(r).slice(0, 300));
  });
  let r3;
  await T('★"8월 만기 고객 알려줘" → 지시하신 8명이 나온다', async () => {
    r3 = await ask(P_FILM, '8월 만기 고객 명단 알려줘');
    const t = 글자(r3);
    const 나온이름 = AUG8.filter((n) => t.includes(n));
    ok(나온이름.length >= 6, `8명 중 ${나온이름.length}명만 나옴 (${나온이름.join(',')}) — 응답: ` + t.slice(0, 400));
  });

  console.log('\n━━━ 2. ★평소 모드(교육생·라이브)에는 샘플이 안 샌다 ━━━');
  await T('★평소 서버에 "명단 띄워봐" → 촬영 샘플 안 나옴', async () => {
    const r = await ask(P_LIVE, '명단 띄워봐');
    const t = 글자(r);
    // 촬영 샘플에만 있는 표식(가짜 번호대·예시 도메인·가짜 시트ID)이 하나도 없어야 한다
    ok(!/010-0000-/.test(t), '★촬영용 가짜 번호가 라이브 응답에 나옴: ' + t.slice(0, 300));
    ok(!/@example\.com/.test(t), '★촬영용 가짜 이메일이 라이브 응답에 나옴');
    ok(!/__FILMING_SAMPLE__/.test(t), '★촬영 시트 표식이 라이브 응답에 나옴');
  });
  await T('★★평소 서버는 로그인 없이 못 들어간다 (/me 는 여전히 ok:false)', async () => {
    const m = await (await fetch(`http://localhost:${P_LIVE}/me`)).json();
    ok(m.ok === false, '★로그인 안 했는데 통과됨 — 라이브 인증이 뚫림: ' + 글자(m));
  });
  await T('★★평소 서버 /api/boot 은 여전히 로그인 화면으로 보낸다', async () => {
    const b = await (await fetch(`http://localhost:${P_LIVE}/api/boot`)).json();
    ok(b.loggedIn === false && b.route === 'login', '★라이브가 로그인 없이 메인으로 감: ' + 글자(b));
  });
  await T('🎬촬영 서버는 로그인 없이 바로 메인 (촬영용 신분)', async () => {
    const b = await (await fetch(`http://localhost:${P_FILM}/api/boot`)).json();
    ok(b.loggedIn === true && b.route === 'main', 글자(b));
  });
  await T('★평소 서버는 촬영 모드 꺼짐(/health)', async () => {
    const h = await (await fetch(`http://localhost:${P_LIVE}/health`)).json();
    ok(h.filming !== true, 'filming=' + h.filming);
  });
  await T('🎬촬영 서버는 촬영 모드 켜짐(/health) — 어느 쪽인지 눈으로 확인', async () => {
    const h = await (await fetch(`http://localhost:${P_FILM}/health`)).json();
    ok(h.filming === true, 'filming=' + h.filming);
  });

  console.log('\n━━━ 3. 촬영 모드에서 실제 발송이 막히는가 ━━━');
  for (const url of ['/api/send/sms', '/api/gmail/send', '/api/campaign/send', '/api/approval/act', '/api/alimtalk/send']) {
    await T(`★${url} 차단됨`, async () => {
      const r = await fetch(`http://localhost:${P_FILM}${url}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-human-approval': '1' },
        body: JSON.stringify({ humanApproval: true, 본문: '테스트', to: '010-0000-0001' }),
      });
      const j = await r.json().catch(() => ({}));
      ok(r.status === 403 && j.filming === true, `status=${r.status} body=${글자(j).slice(0, 160)}`);
    });
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`통과 ${pass} · 실패 ${fail}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  정리();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('시험 자체가 터짐:', e); process.exit(1); });
