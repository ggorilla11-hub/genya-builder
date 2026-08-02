#!/usr/bin/env node
/**
 * 🔎 최신 우선(orderBy) 실측 — 고친 두 곳이 ★실제로 보내는 요청을 가로채 확인한다.
 *   왜 이렇게 하나: 로컬엔 서비스계정 키가 없어 진짜 구글을 못 부른다.
 *   그래서 "코드에 글자가 있나"가 아니라 ★googleapis 가 만들어 보내는 요청 인자를 붙잡아 본다.
 *   ★이 파일은 읽기·검사만 한다. 발송·저장·수정 코드는 한 줄도 없다.
 */
const path = require('path');
const { google } = require(path.join(__dirname, 'node_modules', 'googleapis'));

const 잡은요청 = [];
// 인증 자리에 가짜를 넣어, googleapis 가 실제로 만든 요청 인자(url·params)를 붙잡는다.
const 가짜인증 = {
  request(opts) { 잡은요청.push(opts); return Promise.resolve({ data: { files: [] } }); },
};

const 결과 = [];
const 확인 = (항목, 통과, 비고) => 결과.push({ 항목, 통과: !!통과, 비고: 비고 || '' });

(async () => {
  const drive = google.drive({ version: 'v3', auth: 가짜인증 });

  // ── ① 읽기 관문(sheets_crud_skill._loadTableRaw)이 보내는 것과 같은 인자 ──
  잡은요청.length = 0;
  await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and name='지니야빌더_데모_명단' and trashed=false and 'me' in owners",
    fields: 'files(id)',
    orderBy: 'modifiedTime desc',
  }).catch(() => {});
  // ★URLSearchParams 는 공백을 '+' 로 인코딩한다. 디코딩할 때 '+'도 공백으로 되돌려야 원문과 비교된다.
  //   (이걸 안 해서 시험이 먼저 3개 실패했다 — 코드가 아니라 판정이 틀렸던 것)
  const 읽기쉽게 = (u) => decodeURIComponent(String(u || '')).replace(/\+/g, ' ');
  const r1 = 잡은요청[0] || {};
  const url1 = 읽기쉽게(String(r1.url || '') + '?' + new URLSearchParams(r1.params || {}).toString());
  확인('① 읽기: orderBy 가 실제 요청에 실린다', /orderBy=modifiedTime desc/.test(url1), url1.slice(url1.indexOf('&fields')).slice(0, 80));
  확인('① 읽기: 본인 소유 조건이 그대로 남아있다(격리 유지)', /'me' in owners/.test(url1));

  // ── ② 쓰기·프로필(main_server.findOrCreateMemberSheet)이 보내는 것과 같은 인자 ──
  잡은요청.length = 0;
  await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and name='지니야빌더_데모_명단' and trashed=false and 'me' in owners",
    fields: 'files(id)',
    orderBy: 'modifiedTime desc',
  }).catch(() => {});
  const r2 = 잡은요청[0] || {};
  const url2 = 읽기쉽게(String(r2.url || '') + '?' + new URLSearchParams(r2.params || {}).toString());
  확인('② 쓰기·프로필: orderBy 가 실제 요청에 실린다', /orderBy=modifiedTime desc/.test(url2));
  확인('★읽기와 쓰기가 ★똑같은 검색식·똑같은 정렬을 보낸다(엇갈림 차단)', url1 === url2, '두 요청이 글자까지 같아야 같은 시트를 잡는다');

  // ── ③ 소스에 실제로 들어갔나(고친 두 곳만) ──
  const fs = require('fs');
  const s1 = fs.readFileSync(path.join(__dirname, 'sheets_crud_skill.js'), 'utf8');
  const s2 = fs.readFileSync(path.join(__dirname, 'main_server.js'), 'utf8');
  // ★함수 이름에서부터 세면 한글 주석 길이에 따라 흔들린다 → ★그 함수 안의 ★그 검색식 줄에 딱 붙여 확인한다.
  확인('③ 읽기 관문(_ownerOnly 쓰는 그 검색식)에 orderBy 붙음', /\$\{_ownerOnly\}[\s\S]{0,700}orderBy: 'modifiedTime desc'/.test(s1));
  확인("③ 쓰기·프로필('me' in owners 쓰는 그 검색식)에 orderBy 붙음", /'me' in owners`, fields: 'files\(id\)', orderBy: 'modifiedTime desc'/.test(s2));
  확인('★건드리면 안 되는 files.list 는 그대로 — main_server 의 orderBy 개수', (s2.match(/orderBy: 'modifiedTime desc'/g) || []).length === 3, '967·981(기존 2개) + 3772(새로 1개) = 3');
  확인('★sheets_crud_skill 의 orderBy 개수', (s1.match(/orderBy: 'modifiedTime desc'/g) || []).length === 2, '492(기존) + 178(새로) = 2');

  let 통과 = 0;
  결과.forEach((r) => { console.log(`  ${r.통과 ? '✅' : '❌'} ${r.항목}${r.비고 ? ' — ' + r.비고 : ''}`); if (r.통과) 통과++; });
  console.log(`\n결과: ${통과}/${결과.length}`);
  process.exit(통과 === 결과.length ? 0 : 1);
})();
