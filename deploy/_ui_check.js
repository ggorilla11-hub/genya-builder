#!/usr/bin/env node
/**
 * 🎨 _ui_check.js — 디자인 작업 전용 회귀 확인 (2026-07-29)
 *
 *   왜 만들었나: 기존 _regression_check.js는 ★기능만 본다(css·style 검색어 0회).
 *   디자인 작업은 genya.html의 스타일만 만지는데, 실수로 ★진입점·전역상태·발송가드를
 *   건드리면 시험은 통과하는데 화면이 죽는다. 그걸 잡는 도구다.
 *
 *   쓰는 법:
 *     node deploy/_ui_check.js              ← 현재 파일 검사 (배포 ★전★ 필수)
 *     node deploy/_ui_check.js --save       ← 지금 상태를 기준선으로 저장
 *     node deploy/_ui_check.js --diff       ← 기준선과 비교(무엇이 사라졌나)
 *
 *   ★이 파일은 ★읽기·검사만 한다. genya.html을 고치지 않는다. 발송·저장·네트워크 코드 없음.
 *   ★기준선 파일: deploy/_ui_baseline.json (숫자·이름만. 개인정보 0)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'genya.html');
const BASE = path.join(__dirname, '_ui_baseline.json');
const src = fs.readFileSync(SRC, 'utf8');

const 결과 = [];
function 확인(항목, 통과, 비고) { 결과.push({ 항목, 통과: !!통과, 비고: 비고 || '' }); }
const 있나 = (s) => src.indexOf(s) >= 0;
const 세기 = (re) => (src.match(re) || []).length;

// ═══════════════════════════════════════════════════════════════
// A. ★발송 하드가드 — 디자인 정리하다 지우면 안 되는 것 (최우선)
// ═══════════════════════════════════════════════════════════════
function 발송가드() {
  // ★주석에도 같은 단어가 나오므로 "실제 헤더 문자열" 형태로만 센다(주석은 안 센다).
  //   실측 형태: 'X-Human-Approval':'1'  /  _hdrs['X-Human-Approval']='1'
  const 헤더실사용 = 세기(/['"]X-Human-Approval['"]\s*[:\]]\s*=?\s*['"]1['"]/g);
  확인('★발송: X-Human-Approval 헤더 살아있음(주석 아닌 실코드)',
    헤더실사용 >= 2, '이벤트 승인 + 결재함 승인 두 곳 · 실사용 ' + 헤더실사용 + '회');
  확인('★발송: humanApproval:true 플래그 살아있음',
    세기(/humanApproval\s*:\s*true/g) >= 2, '이중 채널(헤더+본문) fail-closed');
  확인('★발송: 이벤트 승인 라우트', 있나('/api/events/approve-send'));
  확인('★발송: 결재함 승인 라우트', 있나('/api/approval/act'));
  확인('★발송: 대량 2차 확인 살아있음',
    /needsBulkConfirm/.test(src), '실수로 다수 발송 방지');
  확인('★발송: 안전모드 안내 문구 살아있음',
    있나('안전모드') && 있나('test 발송'), '실고객 아닌 본인에게만');
  확인('★발송: genyasend 되살아나지 않음(이벤트 경로)',
    !/events\/approve-send[\s\S]{0,400}genyasend/.test(src), '주석: 되살리지 말 것');
}

// ═══════════════════════════════════════════════════════════════
// B. ★진입점 — onclick 문자열이 부르는 함수가 실제로 있나
// ═══════════════════════════════════════════════════════════════
const 진입함수 = [
  // 상단·KPI
  'openPop', 'genyaHub', 'openDownload', 'openShare', 'openWatcher', 'nfOpen',
  // 발굴
  'discoveryPanel', 'prospectTab', 'prospectRunFind', 'prospectLoadFind',
  'findDraft', 'findDraftCopy', 'findVisited', 'findPickCh', 'prospectCopy',
  // 대시보드
  'managementDashboard', 'dashOpen', 'dashApprove', 'dashEditDraft', 'dashReject', 'dashCopy',
  'schedPop', 'openSchedule', 'sendDashboard',
  // 비서
  'openScenario', 'startFromCard', 'openWarehouse', 'openReminder', 'openClaim', 'openApproval',
  'openSolapiSetup', 'openPromo', 'openCompute',
  // 보상 (재설계분)
  'claimSheetFill', 'claimDocsAsk', 'claimAmtAsk', 'claimSay', 'claimSheetPdf',
  'claimPick', 'claimBuild', 'claimToApproval',
  // 결재함
  'apApprove', 'apReject', 'apEdit', 'apToggleLog',
  // 허브
  'ghClose', 'ghLoad', 'ghSolapiStatus', 'ghConnDetail', 'ghRowDetail',
  'ghToggle', 'ghDelFile', 'ghResetAll', 'ghPick', 'ghSave',
  // 껍데기·공통
  'showModal', 'closeModal', 'renderOnboarding', 'openCustomerCard',
];
function 진입점() {
  const 없는것 = 진입함수.filter((n) => {
    const 정의 = new RegExp('(function\\s+' + n + '\\s*\\(|window\\.' + n + '\\s*=)');
    return !정의.test(src);
  });
  확인('★진입점: 함수 ' + 진입함수.length + '개 전부 정의돼 있음',
    없는것.length === 0, 없는것.length ? '사라짐: ' + 없는것.join(', ') : '');

  // onclick 에서 부르는데 정의가 없는 함수 찾기
  // ★앞에 점(.)이 있으면 메서드 호출이다 — location.reload() 같은 것은 함수 정의를 찾지 않는다.
  const 부름 = new Set();
  const re = /onclick\s*=\s*(["'])([\s\S]*?)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const 본문 = m[2];
    const re2 = /(^|[^.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
    let m2; while ((m2 = re2.exec(본문))) 부름.add(m2[2]);
  }
  const 무시 = new Set(['if', 'for', 'while', 'return', 'typeof', 'alert', 'confirm', 'prompt',
    'event', 'this', 'function', 'try', 'catch', 'switch', 'var', 'let', 'const',
    'document', 'window', 'localStorage', 'sessionStorage', 'parseInt', 'parseFloat',
    'String', 'Number', 'Boolean', 'Array', 'Object', 'JSON', 'Date', 'Math', 'RegExp',
    'setTimeout', 'setInterval', 'encodeURIComponent', 'decodeURIComponent', 'new']);
  const 미정의 = [...부름].filter((n) => {
    if (무시.has(n)) return false;
    const 정의 = new RegExp('(function\\s+' + n + '\\s*\\(|window\\.' + n + '\\s*=|' + n + '\\s*=\\s*function|' + n + '\\s*:\\s*function)');
    return !정의.test(src);
  });
  확인('★진입점: onclick이 부르는 함수가 전부 존재',
    미정의.length === 0, 미정의.length ? '정의 없음: ' + 미정의.slice(0, 8).join(', ') : '');
}

// ═══════════════════════════════════════════════════════════════
// C. ★id — JS가 getElementById로 찾는 자리가 HTML에 있나
// ═══════════════════════════════════════════════════════════════
const 필수id = [
  'modalBox', 'modalBack', 'popBox', 'popBack', 'scBox', 'scBack',
  'discPanel', 'discTabs', 'prospectBody', 'findList', 'findRunBtn',
  'inflowBar', 'inflowBox', 'leadsList', 'rvBar',
  'dashCards', 'chatScroll', 'chatInput', 'chatChips',
  'ghOv', 'ghPanel', 'ghDetail', 'ghCount', 'ghList', 'ghFile', 'ghPv', 'ghConns', 'ghSolapi',
  'claimOut', 'claimFile', 'claimFormName', 'claimProofName', 'claimBuildBtn',
  'apList', 'apCount', 'apLog', 'rmIn', 'rmList', 'rmBtn',
  'kpiFind', 'kpiSched', 'kpiDue', 'kpiSend', 'probList', 'onbCard',
  'solKey', 'solSecret', 'solFrom', 'solapiStatus',
];
function id검사() {
  const 없는것 = 필수id.filter((n) => !(new RegExp('id\\s*=\\s*["\']' + n + '["\']')).test(src)
    && !(new RegExp("getElementById\\(['\"]" + n + "['\"]\\)")).test(src) ? true
    : !(new RegExp('id\\s*=\\s*["\']' + n + '["\']')).test(src) && !(new RegExp("id=['\"]?" + n)).test(src));
  확인('★id: 필수 ' + 필수id.length + '개 전부 살아있음',
    없는것.length === 0, 없는것.length ? '사라짐: ' + 없는것.join(', ') : '');
}

// ═══════════════════════════════════════════════════════════════
// D. ★전역 상태 — 여러 화면이 공유하는 변수
// ═══════════════════════════════════════════════════════════════
const 전역 = ['_FIND', '_FIND_CH', '_RENDER_FIND', '_DRAFTS', '_DASH', '_SCHED',
  '_GH_ROWMAP', '_CONN_HEALTH', '_ACTIVE_SKILL', '_PLEADS', '_SALES_STATS'];
function 전역상태() {
  const 없는것 = 전역.filter((n) => !src.includes('window.' + n));
  확인('★전역상태: ' + 전역.length + '개 전부 살아있음',
    없는것.length === 0, 없는것.length ? '사라짐: ' + 없는것.join(', ') : '');
  확인('★보상: 민감정보 화면메모리 변수(_claimExtras) 살아있음', 있나('_claimExtras'),
    '주민번호·진단명은 서버·시트 저장 안 함');
}

// ═══════════════════════════════════════════════════════════════
// E. ★XSS 이스케이프 — 디자인 정리하다 빼면 안 됨
// ═══════════════════════════════════════════════════════════════
function 이스케이프() {
  확인('★XSS: _escOb 정의', /function\s+_escOb\s*\(/.test(src));
  확인('★XSS: _sEsc 정의', /function\s+_sEsc\s*\(/.test(src));
  확인('★XSS: 허브 esc 정의', /function\s+esc\s*\(/.test(src));
  확인('★XSS: 이스케이프 사용 횟수 유지', 세기(/_escOb\(|_sEsc\(|[^a-zA-Z]esc\(/g) >= 200,
    '실제 사용 ' + 세기(/_escOb\(|_sEsc\(|[^a-zA-Z]esc\(/g) + '회');
}

// ═══════════════════════════════════════════════════════════════
// F. ★사고 대응 코드 — 주석에 이력이 있는 것
// ═══════════════════════════════════════════════════════════════
function 사고대응() {
  확인('★허브: 모바일 가로스크롤 수정(min-width:0)',
    세기(/min-width\s*:\s*0/g) >= 3, '지우면 드로어가 가로로 밀림');
  확인('★허브: 스크롤 축 분리(touch-action)', 있나('touch-action:pan-x pan-y'));
  확인('★발굴: 컬럼 하드코딩 금지(시트 헤더 동적)', 있나('rl.header'));
  확인('★허브: 삭제 2단계(needsConfirm)', 있나('needsConfirm'));
  확인('★캘린더: 자기 서버 호출(격리)', 있나("fetch('/api/calendar')"),
    '제니야 서버 부르면 대표님 일정이 교육생에게 샘');
  확인('★진단링크: 교육생 귀속 배관(?agent=)', 있나('?agent='));
  확인('★결재함: 출처 분류 키', 있나("출처:'보상'") && 있나("출처:'리마인더'"));
}

// ═══════════════════════════════════════════════════════════════
// G. 화면 뼈대 — 껍데기·컨테이너가 남아있나
// ═══════════════════════════════════════════════════════════════
function 뼈대() {
  ['_bizShell', '_whShell', '_jobShell', '_nightShell', '_connShell', '_schedShell'].forEach((n) => {
    확인('껍데기: ' + n, (new RegExp('function\\s+' + n + '\\s*\\(')).test(src));
  });
  확인('3단 컬럼(.cols grid)', /\.cols\{[^}]*display:grid/.test(src));
  확인('상단바(.topbar)', /\.topbar\{/.test(src));
  확인('KPI 카드(.kpi)', /\.kpi\{/.test(src));
  확인('비서 카드(.prob)', /\.prob\{/.test(src));
  확인('허브 드로어(#ghPanel)', /#ghPanel\{/.test(src));
  확인('팔레트(:root 변수)', /:root\{[\s\S]{0,400}--teal/.test(src));
}

// ═══════════════════════════════════════════════════════════════
// H. 지표 — 기준선과 비교할 숫자 (디자인이 얼마나 정리됐나)
// ═══════════════════════════════════════════════════════════════
function 지표() {
  const hex = (src.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((s) => s.toLowerCase());
  const uniq = [...new Set(hex.map((h) => (h.length === 4 ? '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3] : h)))];
  const inline = 세기(/style\s*=\s*"/g);
  let decl = 0; (src.match(/style\s*=\s*"([^"]*)"/g) || []).forEach((s) => { decl += (s.match(/:/g) || []).length; });
  const fs2 = [...new Set((src.match(/font-size\s*:\s*[0-9.]+px/g) || []))];
  const px = []; (src.match(/(?:padding|margin|gap)[a-z-]*\s*:\s*[^;}"']+/g) || []).forEach((s) => {
    (s.match(/([0-9]+)px/g) || []).forEach((p) => px.push(parseInt(p, 10)));
  });
  const m4 = px.filter((n) => n % 4 === 0).length;
  return {
    줄수: src.split('\n').length,
    바이트: src.length,
    고유색: uniq.length,
    var사용: 세기(/var\(--/g),
    인라인style: inline,
    인라인선언: decl,
    글자크기종류: fs2.length,
    여백px개수: px.length,
    여백4배수율: px.length ? Math.round((m4 * 100) / px.length) : 0,
    grid사용: 세기(/display\s*:\s*grid/g),
    flex사용: 세기(/display\s*:\s*flex/g),
    함수개수: 세기(/^function\s+/gm) + 세기(/^window\.[A-Za-z]+\s*=\s*(async\s+)?function/gm),
  };
}

// ═══════════════════════════════════════════════════════════════
// 실행
// ═══════════════════════════════════════════════════════════════
const 인자 = process.argv.slice(2);
const 저장 = 인자.includes('--save');
const 비교 = 인자.includes('--diff');

발송가드(); 진입점(); id검사(); 전역상태(); 이스케이프(); 사고대응(); 뼈대();
const now = 지표();

console.log('════════════════════════════════════════════════════');
console.log(' 🎨 디자인 회귀 확인 — genya.html');
console.log('════════════════════════════════════════════════════');
let 실패 = 0;
결과.forEach((r) => {
  if (!r.통과) 실패++;
  console.log((r.통과 ? ' ✅ ' : ' ❌ ') + r.항목 + (r.비고 ? '   — ' + r.비고 : ''));
});
console.log('');
console.log(' 합계: ' + (결과.length - 실패) + '/' + 결과.length + ' 통과' + (실패 ? '   ★' + 실패 + '건 실패 — 배포 금지' : ''));
console.log('');
console.log('──────────── 디자인 지표 ────────────');
Object.keys(now).forEach((k) => console.log('  ' + k.padEnd(14) + ' : ' + now[k]));

if (저장) {
  fs.writeFileSync(BASE, JSON.stringify({ 저장시각: new Date().toISOString(), 지표: now, 검사수: 결과.length }, null, 2), 'utf8');
  console.log('\n 💾 기준선 저장: ' + BASE);
}

if (비교 && fs.existsSync(BASE)) {
  const b = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  console.log('\n──────────── 기준선 대비 ────────────');
  console.log('  기준선 시각: ' + b.저장시각);
  Object.keys(now).forEach((k) => {
    const before = b.지표[k], after = now[k];
    if (before === after) return;
    const d = (typeof after === 'number' && typeof before === 'number') ? (after - before) : '';
    const 화살 = (typeof d === 'number') ? (d > 0 ? ' ▲+' + d : ' ▼' + d) : '';
    console.log('  ' + k.padEnd(14) + ' : ' + before + ' → ' + after + 화살);
  });
} else if (비교) {
  console.log('\n ⚠️ 기준선이 없어요 — 먼저 `node deploy/_ui_check.js --save` 를 돌리세요.');
}

process.exit(실패 ? 1 : 0);
