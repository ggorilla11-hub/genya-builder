// _test_filming_b3.js — 🎬 촬영 B-3 · 자비스 은하 홀로그램 단위시험
// 화면 효과라 "그림이 예쁜가"는 시험으로 못 잡는다 → ★대표님이 확정하신 사양이
// 코드에 실제로 들어갔는지, 그리고 ★메인이 안 바뀌는지를 못 박는다. 눈으로 볼 것은 스크린샷으로 따로 확인.
'use strict';
const fs = require('fs'), path = require('path');

let 통과 = 0, 실패 = 0;
function ok(제목, 조건, 실측) {
  if (조건) { 통과++; console.log('  ✅ ' + 제목); }
  else { 실패++; console.log('  ❌ ' + 제목 + (실측 !== undefined ? '   ← 실측: ' + 실측 : '')); }
}
const gh = fs.readFileSync(path.join(__dirname, 'genya.html'), 'utf8');
const ms = fs.readFileSync(path.join(__dirname, 'main_server.js'), 'utf8');
// ★은하 코드만 정확히 잘라낸다. (처음엔 주석 첫 등장부터 파일 끝까지 잘라서
//   앱 전체 코드가 딸려 들어갔고, "고객 데이터를 안 읽는가" 시험이 엉뚱하게 실패했다.)
const _s = gh.indexOf('  var STARS = ');
const _e = gh.indexOf('})();', _s);
if (_s < 0 || _e < 0) { console.log('★은하 코드를 못 찾음 — 시험 불가'); process.exit(1); }
const blk = gh.slice(_s, _e);

// ═══ [1] 은하 느낌 — 대표님 확정 사양 ═══
console.log('\n[1] 은하 느낌 (촘촘 · 황금 중심)');
ok('★별 2600개 이상', /var STARS = (\d+);/.test(blk) && Number(blk.match(/var STARS = (\d+);/)[1]) >= 2600,
  blk.match(/var STARS = (\d+);/) ? blk.match(/var STARS = (\d+);/)[1] + '개' : '못 찾음');
ok('★안으로 갈수록 촘촘해짐(제곱 분포)', /Math\.pow\(Math\.random\(\), 1\.75\)/.test(blk));
ok('★나선 팔이 있음(은하수 모양)', /arm\*\(Math\.PI\*2\/3\)/.test(blk) && /나선/.test(blk));
ok('★중앙 황금 코어', /255,232,170|255,196,90/.test(blk) && /코어/.test(blk));
ok('★바깥은 푸른빛', /var g = \[255, 205, 110\], b = \[90, 165, 255\]/.test(blk));
ok('★은하가 회전함', /각 \+= 회전/.test(blk));
ok('안쪽이 더 빨리 도는 차등 회전(진짜 은하처럼)', /차등 = 각 \* \(1\.7 - st\.t\*0\.95\)/.test(blk));

// ═══ [2] 음성 반응 — 잔잔한 호흡 (★심장 쿵쾅 금지) ═══
console.log('\n[2] ★말할 때 잔잔한 호흡 (어지럽지 않게)');
// ★주기를 숫자로 못 박는다 — "잔잔한 호흡"인지 눈이 아니라 계산으로 확인.
//   숨 += 0.016(60fps → 초당 0.96) × 배수 = 각속도. 주기 = 2π / 각속도.
const 증가 = blk.match(/숨 \+= (0\.\d+);/), 배수 = blk.match(/Math\.sin\(숨\*(\d+(?:\.\d+)?)\)/);
ok('호흡 파형이 있다', !!(증가 && 배수));
const 주기 = (증가 && 배수) ? (2 * Math.PI) / (Number(증가[1]) * 60 * Number(배수[1])) : 0;
ok('★호흡 주기가 사람 숨 범위(3~7초) — 심장 박동(1초)이 아니다', 주기 >= 3 && 주기 <= 7, 주기.toFixed(1) + '초');
const 진폭 = blk.match(/호흡 \* (0\.\d+) \* \(0\.5 \+ 에너지\*0\.5\)/);
ok('★진폭이 작다(±6% 이하 — 쿵쾅거리지 않음)', 진폭 && Number(진폭[1]) <= 0.06, 진폭 ? '±' + (Number(진폭[1]) * 100).toFixed(1) + '%' : '못 찾음');
ok('★중심으로 모였다 퍼진다', /var t = st\.t \* \(1 - 모임\)/.test(blk));
ok('★상태가 튀지 않고 부드럽게 따라감', /에너지 \+= \(목표에너지 - 에너지\) \* 0\.06/.test(blk));
ok('애니메이션 줄이기 설정을 존중(어지럼 배려)', /prefers-reduced-motion/.test(blk));

// ═══ [3] 4가지 상태 ═══
console.log('\n[3] 4가지 상태 (대기·듣기·작업·말하기)');
['idle', 'listen', 'think', 'speak'].forEach((s) => ok(`상태 ${s} 있음`, new RegExp("'" + s + "'").test(blk)));
ok('★상태 이름이 한국어로 화면에 표시', /대기 중.*듣는 중.*생각하는 중.*말하는 중/.test(blk.replace(/\n/g, ' ')));
ok('상태별로 회전 속도가 다름', /상태==='think' \? 0\.0042 : 상태==='listen' \? 0\.0018 : 0\.0011/.test(blk));

// ═══ [4] ★실제 음성(Vapi) 연동 — 촬영=실제 ═══
console.log('\n[4] ★실제 음성(Vapi)에 진짜 붙었는가');
ok('★Vapi 상태가 모이는 micState 에서 은하를 바꾼다', /window\.galaxyState\) window\.galaxyState\(s\);/.test(gh));
ok('★micState 는 Vapi 이벤트가 실제로 부르는 함수다(연결·녹음·종료)',
  /vapi\.on\('call-start'[\s\S]{0,80}micState\('connecting'\)/.test(gh)
  && /vapi\.on\('speech-start'[\s\S]{0,60}micState\('recording'\)/.test(gh)
  && /vapi\.on\('call-end'[\s\S]{0,60}micState\(''\)/.test(gh));
ok('★지니야가 음성으로 말하면 호흡 시작', /galaxySpeak\(Math\.min\(9000, 900\+t\.length\*95\)\)/.test(gh));
ok('글로 대화할 때도 작동(생각하는 중)', /window\.galaxyState\('connecting'\); \}catch\(e\)\{\}   \/\* 🎬 은하: 생각하는 중/.test(gh));
ok('글로 답할 때도 호흡', /galaxySpeak\(Math\.min\(9000, 900\+String\(reply\)\.length\*55\)\)/.test(gh));
ok('★음성 신호를 못 받아도 대화가 안 끊긴다(try·catch로 감쌈)',
  (gh.match(/try\{ if\(window\.galaxy(State|Speak)\)/g) || []).length >= 4);

// ═══ [5] 배치·크기 ═══
console.log('\n[5] 좌측 상단 배치 · 명단 안 가림');
ok('★좌측 열 맨 위에 있다', gh.indexOf('id="galaxyWrap"') < gh.indexOf('온보딩에서 설계된 내 비서'));
ok('★띄우는 게 아니라 자리를 차지하며 흐른다(아무것도 안 가림)', !/id="galaxyWrap"[^>]*position:\s*(fixed|absolute)/.test(gh));
ok('★모니터 통째가 아님(좌측 열 폭 안에서만)', /Math\.min\(w, 250\)/.test(blk) && /Math\.min\(w, 168\)/.test(blk));
ok('★촬영=크게(250) · 실제=작게(168)', /크게 \? Math\.min\(w, 250\) : Math\.min\(w, 168\)/.test(blk));
ok('★전체화면 명단이 뜨면 그 아래로 들어간다(명단을 안 가림)',
  /id="fullRoster"[^>]*z-index:99999/.test(gh) && !/galaxyWrap[^>]*z-index/.test(gh));

// ═══ [6] ★메인(교육생) 무접촉 ═══
console.log('\n[6] ★메인·교육생 기능 그대로');
ok('★촬영 모드에서만 켜진다(window.__FILMING)', /if\(!window\.__FILMING\) return;/.test(blk));
ok('★평소엔 화면에 자리도 안 차지(display:none 그대로)', /id="galaxyWrap" style="display:none/.test(gh));
ok('★__FILMING 은 서버가 넣어준다', /window\.__FILMING=' \+ \(FILMING \? 'true' : 'false'\)/.test(ms));
ok('★라이브면 false 가 들어간다(FILMING 은 환경변수로만 true)', /const FILMING = process\.env\.FILMING_MODE === '1';/.test(ms));
ok('★평소엔 그리기 자체를 시작 안 함(별 계산도 안 함)',
  blk.indexOf('if(!window.__FILMING) return;') < blk.indexOf('만들기(); 맞추기();'));

// ═══ [7] 지어내지 않는가 (폐기된 홀로그램과 다른 점) ═══
console.log('\n[7] ★값을 지어내지 않는가 (2026-07-27 폐기 사고 재발 방지)');
ok('★은하는 고객 데이터를 아예 안 읽는다', !/loadTable|\/api\/order|고객명|만기일/.test(blk));
ok('★서버에 아무것도 요청하지 않는다', !/fetch\(/.test(blk));
ok('★숫자·이름을 만들어 표시하지 않는다(표시는 상태 이름뿐)', !/innerHTML/.test(blk));

// ═══ [8] 성능 (촬영 중 버벅이면 안 됨) ═══
console.log('\n[8] 촬영 중 버벅이지 않는가');
ok('점 찍기는 가장 가벼운 방식(fillRect)', /ctx\.fillRect\(x, y, sz, sz\)/.test(blk));
ok('안 보이는 별은 건너뜀', /if \(a <= 0\.02\) continue;/.test(blk));
ok('탭이 가려지면 그리기 정지(발열·배터리)', /visibilitychange/.test(blk));
ok('고해상도 화면 배율 상한(2배)', /Math\.min\(window\.devicePixelRatio\|\|1, 2\)/.test(blk));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`통과 ${통과} · 실패 ${실패}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(실패 ? 1 : 0);
