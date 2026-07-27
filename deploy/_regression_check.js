#!/usr/bin/env node
/**
 * 🛡️ 배포 전 회귀 확인 — CLAUDE.md 6-6-2 의무 규칙 도구 (2026-07-27)
 *
 *   왜 만들었나: 새 기능을 넣을 때마다 기존 기능이 깨졌는데, 시험이 ★새 기능만 보고
 *   기존 전체를 안 봐서 "통과"라고 보고됐다(그날 로그아웃 수정이 캘린더를 깼다).
 *
 *   쓰는 법:
 *     node deploy/_regression_check.js          ← 로컬(코드 차원) 확인. 배포 ★전★ 필수.
 *     node deploy/_regression_check.js --live   ← 배포 ★후★ 라이브 진단창구로 확인.
 *
 *   ★이 파일은 ★읽기·검사만 한다. 발송·저장·수정 코드는 한 줄도 없다.
 */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, 'main_server.js');
const src = fs.readFileSync(SRC, 'utf8');
const LIVE_HOST = 'genya-builder.onrender.com';

const 결과 = [];
function 확인(항목, 통과, 비고) { 결과.push({ 항목, 통과: !!통과, 비고: 비고 || '' }); }

/** 소스에서 함수 하나를 그대로 떼어 온다(복사본이 아니라 ★진짜 코드로 시험) */
function 떼어오기(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); } }
  return null;
}
const 있나 = (re) => re.test(src);

// ═══════════════ A. 로컬(코드) 회귀 — 배포 전 필수 ═══════════════
function 로컬확인() {
  // ── 1) 로그인 / 로그아웃 ──
  확인('로그인·로그아웃: 로그아웃이 genya_rt까지 지움',
    /killSession/.test(src) && /genya_rt=; HttpOnly/.test(src), '쿠키 2개 + 서버 세션');
  확인('로그인·로그아웃: 다른 계정이면 이전 토큰 승계 안 함(격리)',
    /_sameUser \? _prevSess : null/.test(src), '교육생이 대표님 데이터 보면 안 됨');
  확인('로그인·로그아웃: 교육생 구제 통로(/switch)', /app\.get\('\/switch'/.test(src));

  // ── 2) ★권한(캘린더·시트) — 오늘 깨진 곳 ──
  확인('★캘린더·시트 권한: 재로그인 때 영속 저장소에서 권한 복원',
    /if \(ui\.data\.email\) \{[\s\S]{0,400}loadMemberToken\(ui\.data\.email\)/.test(src),
    '토큰 유무와 상관없이 durable scope를 읽어야 함(안 그러면 캘린더 막힘)');
  확인('★캘린더·시트 권한: 세션 복원 때도 권한 좁으면 보강',
    /_hasData[\s\S]{0,200}loadMemberToken/.test(src), '쿠키에 토큰 있어도 scope 좁으면 durable로 보강');
  확인('★캘린더: 진단창구가 영속 권한까지 보여줌',
    /영속저장_캘린더권한/.test(src), '"왜 안 되나"를 대표님이 직접 볼 수 있어야 함');

  // ── 2-2) 캘린더가 대화 두뇌에 전달되나 (2026-07-27 사고: 서버는 읽는데 대화가 "없다"고 함) ──
  확인('★캘린더: 대화 두뇌 주입(_calCtx) 존재', !!떼어오기('_calCtx'), '발굴 _findCtx와 같은 방식');
  확인('★캘린더: 일반 대화 경로에 실제로 붙어 있음',
    /genyaPersona\(job, \{ email: uid \}\) \+ calCtx/.test(src), '만들어만 두고 안 붙이면 소용없다');
  const rg = 떼어오기('_schedRange');
  if (rg) {
    const f = new Function(rg + '\nreturn _schedRange;')();
    확인('캘린더: 범위 판정(오늘/이번 주/내일)',
      f('오늘 일정?') === 'today' && f('이번 주 일정?') === 'week' && f('내일 일정?') === 'tomorrow');
  } else 확인('캘린더: 범위 판정', false, '_schedRange 없음');
  확인('캘린더: 일정 분기도 같은 범위 함수를 씀', /const _rg = _schedRange\(q\)/.test(src), '진단과 실제가 달라지면 안 됨');
  확인('★캘린더: "오늘 일정?"이 일정 분기로 감(의문사 없어도)', /_reSchedWord\.test\(q\)/.test(src),
    '의문사 없으면 일반 대화로 새던 사고');
  확인('★캘린더: 진단창구가 ★대화가 쓰는 함수도 돌려 본다',
    /_readCalendar\(ma, req, 'today'\)[\s\S]{0,300}out\.대화가_보는_오늘/.test(src)
    && /out\.두뇌주입/.test(src) && /_calCtx\(ma, req, '오늘 일정'\)/.test(src),
    'CLAUDE.md 6-7 — 진단이 "된다"는데 대화는 안 되는 일이 없게');

  // ── 2-3) 캘린더 쓰기 · Gmail 발송 권한 (2026-07-27 추가) ──
  확인('캘린더 쓰기: calendar.events 권한이 연결에 포함', /auth\/calendar\.events/.test(src));
  확인('캘린더 쓰기: 일정 등록 코드(events.insert) 있음', /events\.insert/.test(src));
  확인('★캘린더 쓰기: 초대 메일 안 나감(sendUpdates none)', /sendUpdates: 'none'/.test(src),
    '권한이 생겨도 밖으로 나가는 메일은 0이어야 함');
  확인('★캘린더 쓰기: 참석자(attendees)를 아예 안 만듦', !/attendees\s*:/.test(src),
    'attendees가 생기면 구글이 초대 메일을 보낸다');
  확인('★Gmail: send 권한은 [연결] 버튼에만(로그인·전체연결에 없음)',
    !/DATA_SCOPES[^;]*gmail/.test(src) && !/LOGIN_SCOPES\s*=\s*\[[^\]]*gmail/.test(src),
    '로그인에 넣으면 "확인 안 된 앱" 경고 부활');
  확인('★Gmail: 발송은 결재함 승인 경로에만 연결', /approval\.init\([^)]*sendGmail: _sendGmailFor/.test(src),
    '자동 발송 0 — 승인 버튼만');
  const 일정파서 = 떼어오기('_parseNewEvent');
  if (일정파서) {
    const f = new Function(일정파서 + '\nreturn _parseNewEvent;')();
    확인('일정 등록: "내일 3시 상담 일정 등록해줘" 읽음', !!f('내일 3시 상담 일정 등록해줘'));
    확인('★일정 등록: 발송 말은 절대 안 받음',
      !f('김철수님께 메일 보내줘') && !f('내일 3시 문자 보내줘'), '발송이 캘린더로 새면 안 됨');
    확인('일정 등록: 시간 없으면 지어내지 않음', !f('일정 잡아줘'), '시간 모르면 되묻는다');
  } else 확인('일정 등록 파서', false, '_parseNewEvent 없음');

  // ── 3) 카드 (명단·여러 명·만기) ──
  const rowsFor = 떼어오기('_rowsForNames'), rowName = 떼어오기('_rowName');
  확인('카드: _rowsForNames가 모듈 최상위에 있음', !!rowsFor, '블록 안 const면 _rowsFor is not defined 재발');
  if (rowsFor && rowName) {
    const f = new Function(rowName + '\n' + rowsFor + '\nreturn _rowsForNames;')();
    const t = { rows: [{ 고객명: '강수연', _rowNum: 2 }, { 고객명: '오정서', _rowNum: 3 }] };
    const r = f(t, ['강수연', '오정서']);
    확인('카드: 여러 명 카드 내용 생성', r.length === 2 && r[0]._rowNum === undefined, '내부 행번호는 빠져야 함');
  } else 확인('카드: 여러 명 카드 내용 생성', false, '함수를 못 떼어옴');

  const nameShow = 떼어오기('_nameShowNamesOf');
  if (nameShow && rowName) {
    const f = new Function(rowName + '\n' + nameShow + '\nreturn _nameShowNamesOf;')();
    const t = { rows: [{ 고객명: '강수연' }, { 고객명: '오정서' }] };
    확인('카드: 이름만 말해도 카드("강수연 오정서 보여줘")', f('강수연 오정서 보여줘', t, []).length === 2);
    확인('카드: 발송 말은 절대 카드로 안 감', f('강수연 님한테 문자 보내줘', t, []).length === 0, '★발송 침범 0');
  } else 확인('카드: 이름만 말해도 카드', false, '함수를 못 떼어옴');

  const expiry = 떼어오기('_expiryPick'), wantList = 떼어오기('_wantsTextList');
  if (expiry && rowName && wantList) {
    const f = new Function(rowName + '\n' + expiry + '\nreturn _expiryPick;')();
    const g = new Function(wantList + '\nreturn _wantsTextList;')();
    const 미래 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const 과거 = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const t = { rows: [{ 고객명: '가나다', 만기일: 미래 }, { 고객명: '라마바', 만기일: 과거 }] };
    const 남은 = f('만기 남은 고객', t);
    확인('카드: "만기 남은"을 30일 임박으로 안 좁힘', 남은 && 남은.names.length === 1 && 남은.label === '만기 남은');
    확인('카드: "만기 지난"은 지난 것만', (f('만기 지난 고객', t) || {}).names?.length === 1);
    확인('명단 조회: "명단 알려줘"는 글 목록', g('7월 만기 명단 알려줘') === true);
    확인('명단 조회: "카드 보여줘"는 카드', g('만기 카드 보여줘') === false);
  } else 확인('카드/명단: 만기 범위·목록 판정', false, '함수를 못 떼어옴');

  // ── 4) 보여줘(핫리드·매출) ──
  try {
    const sc = require('./show_cards');
    확인('보여줘: 핫 리드', (sc.parse('핫 리드 보여줘') || {}).종류 === 'lead_hot');
    확인('보여줘: 매출', /sales/.test((sc.parse('이번 달 매출 보여줘') || {}).종류 || ''));
    확인('보여줘: ★발송 말은 절대 안 받음', sc.parse('알림톡 발송해') === null, '발송 하드가드');
  } catch (e) { 확인('보여줘 비서', false, e.message); }

  // ── 5) 발굴 · 답글 초안 · 밤샘 · 유입전환 (라우트·모듈 생존) ──
  확인('발굴: 실행 라우트 살아있음', 있나(/app\.(get|post)\('\/api\/find\/leads'/));
  확인('발굴: 검수 라우트 살아있음', 있나(/app\.post\('\/api\/find\/review'/));
  확인('답글 초안: 초안 경로 살아있음', 있나(/draft_leads/) || 있나(/답글\s*초안/));
  확인('밤샘 발굴: cron 라우트 + 열쇠 검사', 있나(/app\.get\('\/api\/cron\/find'/) && 있나(/CRON_SECRET/));
  확인('밤샘 발굴: ★발송 코드 없음', !/nightFind[\s\S]{0,80}send/i.test(src), '밤샘은 발굴·기록만');
  확인('유입전환 매출: 진단창구 살아있음', 있나(/diag\/inflow/) || 있나(/유입\s*전환/));

  // ── 6) 시트 조회/수정 ──
  확인('시트: 조회(loadTable) 살아있음', 있나(/sheetsCrud\.loadTable/));
  확인('시트: 수정(미리보기→승인) 라우트 살아있음',
    있나(/app\.post\('\/api\/sheets\/crud\/chat'/) && 있나(/app\.post\('\/api\/sheets\/crud\/commit'/));

  // ── 7) ★발송 하드가드 (절대 풀리면 안 됨) ──
  확인('★발송: 하드가드 문구 살아있음', 있나(/발송은 네가 절대 하지 않는다/), '프롬프트 안전장치');
  확인('★발송: 승인 라우트만이 유일 경로', 있나(/api\/approval\/act/));
  확인('★발송: humanApproval 가드 살아있음', 있나(/humanApproval/));

  // ── 8) 22블록 핵심 함수 생존 ──
  for (const fn of ['cardFlags', '_resolveCardGroup', '_isExpired', '_rowName'])
    확인('22블록: ' + fn + ' 함수 살아있음', !!떼어오기(fn));
}

// ═══════════════ B. 라이브(배포 후) — 진단창구로 실제 확인 ═══════════════
function 가져오기(경로) {
  return new Promise((resolve) => {
    require('https').get({ host: LIVE_HOST, path: encodeURI(경로), headers: { 'User-Agent': 'regression-check' } },
      (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve({ code: r.statusCode, body: b })); })
      .on('error', (e) => resolve({ code: 0, body: 'ERR ' + e.message }));
  });
}
async function 라이브확인() {
  const j = async (p) => { const r = await 가져오기(p); try { return JSON.parse(r.body); } catch (e) { return { _code: r.code }; } };
  확인('라이브: 로그인 화면 200', (await 가져오기('/login')).code === 200);
  확인('라이브: 로그아웃 → /login', (await 가져오기('/logout')).code === 302);
  확인('라이브: 교육생 구제 /switch', (await 가져오기('/switch')).code === 302);
  const cal = await j('/api/diag/calendar');
  확인('라이브: 캘린더 진단창구 응답', cal && cal.진단 !== undefined, cal && cal.진단);
  const card = await j('/api/diag/card?q=만기 카드 보여줘');
  확인('라이브: 카드 엔진(만기)', card && card['★행첨부'] > 0, card && ('묶음=' + card.묶음판정 + ' · ' + card['★행첨부'] + '행'));
  const show = await j('/api/diag/show?q=7월 만기 명단 알려줘');
  const 실제 = show && show.실제실행;
  확인('라이브: 명단 = 글 목록', !!(실제 && /글 목록/.test(실제.표시방식 || '')), 실제 && 실제.만기범위);
  const hot = await j('/api/diag/show?q=핫 리드 보여줘');
  확인('라이브: 보여줘(핫리드)', !!(hot && hot.판정), hot && hot.보여줄것);
  const ch = await j('/api/diag/channels');
  확인('라이브: 발굴 채널 진단', ch && ch._code !== 0);
}

(async () => {
  const live = process.argv.includes('--live');
  console.log(live ? '🛡️ 라이브 회귀 확인 (배포 후)\n' : '🛡️ 로컬 회귀 확인 (배포 전 필수)\n');
  if (live) await 라이브확인(); else 로컬확인();
  let 통과 = 0;
  for (const r of 결과) { if (r.통과) 통과++; console.log((r.통과 ? '  ✅ ' : '  ❌ ') + r.항목 + (r.비고 ? ' — ' + r.비고 : '')); }
  const 실패 = 결과.length - 통과;
  console.log('\n결과: ' + 통과 + '/' + 결과.length + (실패 ? ' — ★' + 실패 + '개 깨짐 → 배포 금지' : ' — 전부 통과'));
  process.exit(실패 ? 1 : 0);
})();
