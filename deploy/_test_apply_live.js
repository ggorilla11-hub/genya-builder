// ═══════════════════════════════════════════════════════════════════
// _test_apply_live.js · Phase 1-A 실측 3개 (★진짜 시트에 쓰고 다시 읽는다)
//
//   ①신청이 시트에 rep_id로 쌓이나  ②회원별로 갈리나(격리)  ③재배포해도 남나
//
//   ★필요한 것(둘 다 있어야 돈다):
//        APPLY_SHEET_ID               — 대표님이 만드신 「신청수집」 시트
//        GOOGLE_SERVICE_ACCOUNT_JSON  — 서비스계정(그 시트에 ★편집자로 공유돼 있어야 함)
//   ★없으면 "통과"라고 세지 않고 ★없다고 말하고 멈춘다(안 해본 걸 했다고 하지 않는다).
//
//   ★시험 줄은 이름을 「시험-지우세요」로 넣는다 — 끝나고 대표님이 지우시기 쉽게.
//     ★지우는 것은 승인 사항이라 이 시험은 ★스스로 지우지 않는다(CLAUDE.md 6-4).
//
//   쓰는 법:  node _test_apply_live.js            (서버를 직접 띄우고 시험)
// ═══════════════════════════════════════════════════════════════════
'use strict';
require('dotenv').config();

const { google } = require('googleapis');
const { spawn } = require('child_process');
const A = require('./apply_sheet');
const { getServiceAuth } = require('./service_auth');

const PORT = 3581;
const BASE = `http://localhost:${PORT}`;
const 표식 = '시험-지우세요';

let pass = 0, fail = 0;
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${got !== undefined ? ' — 실제: ' + JSON.stringify(got) : ''}`); }
};

// ── 시트를 직접 읽는다(서버 말이 아니라 ★시트의 진짜 값으로 확인) ──
async function readSheet() {
  const auth = await getServiceAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  let r;
  try {
    r = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.APPLY_SHEET_ID, range: `${A.TAB}!A1:I10000`,
    });
  } catch (e) {
    // ★첫 시험이면 「신청수집」 탭이 아직 없다 — 빈 것으로 본다(없는 걸 있다고 하지 않는다)
    if (/Unable to parse range|not found/i.test(e.message || '')) return { head: [], rows: [], 탭없음: true };
    throw e;
  }
  const rows = r.data.values || [];
  if (rows.length < 2) return { head: rows[0] || [], rows: [] };
  const head = rows[0];
  return { head, rows: rows.slice(1).map((x) => {
    const o = {}; head.forEach((h, i) => { o[h] = String(x[i] == null ? '' : x[i]); }); return o;
  }) };
}

function startServer() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['main_server.js'], {
      cwd: __dirname, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
    });
    const t0 = Date.now();
    const tick = async () => {
      try { const r = await fetch(BASE + '/health'); if (r.ok) return resolve(p); } catch (e) {}
      if (Date.now() - t0 > 40000) return reject(new Error('서버가 안 떴어요'));
      setTimeout(tick, 800);
    };
    setTimeout(tick, 1500);
  });
}
const stop = (p) => new Promise((r) => { p.on('exit', r); p.kill(); setTimeout(r, 3000); });

async function submit(body) {
  const r = await fetch(BASE + '/api/apply/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}

(async () => {
  if (!process.env.APPLY_SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.log('\n⏸ 실측을 할 수 없습니다 — 다음이 없습니다:');
    if (!process.env.APPLY_SHEET_ID) console.log('   · APPLY_SHEET_ID (대표님이 만드신 「신청수집」 시트 ID)');
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) console.log('   · GOOGLE_SERVICE_ACCOUNT_JSON (서비스계정 열쇠)');
    console.log('   → deploy/.env 에 넣어 주세요(이 파일은 git에 안 올라갑니다).');
    console.log('   ★없는 것을 "통과"로 세지 않습니다.\n');
    process.exit(2);
  }

  // 두 회원을 흉내 낸다 — 서로의 신청이 안 보여야 한다
  const repA = A.repCodeOf('ggorilla11@gmail.com');
  const repB = A.repCodeOf('someone-else@example.com');
  const 번호A = '0102' + String(Date.now()).slice(-7);
  const 번호B = '0103' + String(Date.now()).slice(-7);
  const 번호C = '0104' + String(Date.now()).slice(-7);

  console.log('\n═══ 준비: 서버 띄우기 ═══');
  let srv = await startServer();
  console.log('  ✅ 부팅 200');

  const before = await readSheet();
  console.log(`  · 시험 전 시트 줄 수: ${before.rows.length}${before.탭없음 ? ' (「신청수집」 탭이 아직 없음 — 첫 신청 때 만들어져야 한다)' : ''}`);

  console.log('\n═══ ① 신청이 시트에 rep_id로 쌓이나 ═══');
  const s1 = await submit({ name: 표식 + '-A', phone: 번호A, want: '상담', agree: true, ad: true,
    rep: repA, utm_source: 'shorts', utm_campaign: 'bootcamp8' });
  t('회원A 신청 접수 200', s1.status === 200 && s1.j.ok === true, s1);

  const s2 = await submit({ name: 표식 + '-B', phone: 번호B, want: '강의', agree: true, ad: false, rep: repB });
  t('회원B 신청 접수 200', s2.status === 200 && s2.j.ok === true, s2);

  const s3 = await submit({ name: 표식 + '-미분류', phone: 번호C, want: '진단', agree: true });
  t('rep 없는 신청도 접수 200', s3.status === 200 && s3.j.ok === true, s3);

  const after = await readSheet();
  t('★탭·머리글 9칸이 자동으로 만들어졌다', after.head.length === 9 && after.head[1] === 'rep_id', after.head);
  const 새줄 = after.rows.filter((x) => String(x['이름'] || '').startsWith(표식));
  t('★시트에 3줄이 실제로 쌓였다', 새줄.length === 3, `${새줄.length}줄`);

  const rowA = 새줄.find((x) => x['이름'] === 표식 + '-A');
  const rowC = 새줄.find((x) => x['이름'] === 표식 + '-미분류');
  t('A줄의 rep_id가 회원A 코드', rowA && rowA['rep_id'] === repA, rowA && rowA['rep_id']);
  t('A줄 연락처가 표준형', rowA && rowA['연락처'] === 번호A, rowA && rowA['연락처']);
  t('A줄 관심 = 상담', rowA && rowA['관심'] === '상담', rowA && rowA['관심']);
  t('A줄 utm_source = shorts', rowA && rowA['utm_source'] === 'shorts', rowA && rowA['utm_source']);
  t('A줄 utm_campaign = bootcamp8', rowA && rowA['utm_campaign'] === 'bootcamp8', rowA && rowA['utm_campaign']);
  t('A줄 광고동의 Y + 동의일시', rowA && /^Y \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/.test(rowA['광고수신동의'] || ''), rowA && rowA['광고수신동의']);
  t('★rep 없는 줄은 unassigned(대표 귀속 아님)', rowC && rowC['rep_id'] === A.UNASSIGNED, rowC && rowC['rep_id']);
  t('★발행번호는 비어 있다(지금 안 씀)', rowA && !rowA['발행번호'], rowA && rowA['발행번호']);

  console.log('\n═══ ② 회원별로 갈리나 (격리) ═══');
  //   유입전환이 쓰는 것과 ★같은 기준으로 센다: rep_id 칸이 있으면 그 칸으로 가른다.
  const mineA = after.rows.filter((x) => x['rep_id'] === repA);
  const mineB = after.rows.filter((x) => x['rep_id'] === repB);
  t('회원A 눈에는 A줄이 보인다', mineA.some((x) => x['이름'] === 표식 + '-A'));
  t('★회원A 눈에 B줄이 안 보인다', !mineA.some((x) => x['이름'] === 표식 + '-B'));
  t('★회원B 눈에 A줄이 안 보인다', !mineB.some((x) => x['이름'] === 표식 + '-A'));
  t('★미분류는 어느 회원에게도 안 간다', !mineA.concat(mineB).some((x) => x['이름'] === 표식 + '-미분류'));
  t('두 회원 코드가 서로 다르다', repA !== repB, [repA, repB]);

  console.log('\n═══ ③ 재배포해도 남나 (서버를 껐다 켠다) ═══');
  await stop(srv);
  console.log('  · 서버 껐음(재배포와 같은 상태 — 메모리 전부 날아감)');
  srv = await startServer();
  console.log('  · 다시 띄웠음');
  const revived = await readSheet();
  const 살아남음 = revived.rows.filter((x) => String(x['이름'] || '').startsWith(표식));
  t('★껐다 켜도 3줄 그대로 있다', 살아남음.length === 3, `${살아남음.length}줄`);
  t('★rep_id도 그대로', 살아남음.some((x) => x['rep_id'] === repA));
  t('★회원 코드는 다시 계산해도 같은 값', A.repCodeOf('ggorilla11@gmail.com') === repA);

  const d = await fetch(BASE + '/api/apply/diag').then((r) => r.json());
  t('진단창구가 시트를 실제로 읽는다', d.ok === true && d.줄수 >= 3, d);
  await stop(srv);

  console.log(`\n결과: ${pass}/${pass + fail} — ${fail === 0 ? '전부 통과' : fail + '개 실패'}`);
  console.log(`\n★시트에 남은 시험 줄 ${새줄.length}개(이름이 「${표식}」로 시작) — 대표님이 지워 주세요.`);
  console.log('   (지우는 것은 승인 사항이라 시험이 스스로 지우지 않습니다)');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('\n★시험이 도중에 죽었습니다: ' + e.message); process.exit(1); });
