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
// ★은하 코드만 정확히 잘라낸다(앱 전체가 딸려 들어가면 검사가 엉뚱해진다).
const _s = gh.indexOf('/* ═══ 🎬 B-3 · 자비스 은하 홀로그램');
const _e = gh.indexOf('window.galaxyBig', _s);
if (_s < 0 || _e < 0) { console.log('★은하 코드를 못 찾음 — 시험 불가'); process.exit(1); }
const blk = gh.slice(_s, _e);

// ═══ [1] 은하 느낌 — 대표님 확정 사양 ═══
console.log('\n[1] ★★시안 코드가 화면에 실제로 들어갔는가 (파일만 있고 미반영 X)');
// ★대표님 지적: "파일을 폴더에 두는 것과 화면에 적용하는 것은 다르다."
//   그래서 시안 파일과 genya.html 을 ★줄 단위로 대조한다. 한 줄이라도 다르면 실패.
const 시안경로 = path.join(__dirname, 'jarvis_hologram_teal.html');
ok('시안 파일이 있다', fs.existsSync(시안경로), 시안경로);
const 시안 = fs.readFileSync(시안경로, 'utf8');
const sm = 시안.match(/<script>([\s\S]*?)<\/script>/);
ok('시안에서 코드를 뽑을 수 있다', !!sm);
const 시안줄 = sm[1].trim()
  .replace(/^\(function\(\)\{/, '').replace(/\}\)\(\);$/, '')
  .split('\n').map((l) => l.trim()).filter((l) => l);
const 화면줄 = new Set(gh.split('\n').map((l) => l.trim()));
// ★대표님이 명시적으로 지시한 변경(크기·밝기)만 예외로 둔다.
//   그 외에는 여전히 한 줄이라도 다르면 실패시킨다 — "시안 그대로"를 지키려고.
const 승인된변경 = [
  /var breath=1, maxR=Math\.min\(W,H\)\*0\.375, spinMul=1, coreGlow=1;/,   // 크기
  /var y=CY\+Math\.sin\(st\.ang\)\*R\*0\.84;/,                              // 세로 압축 완화
  /if\(rNorm<0\.26\)\{ return 'rgba\('\+Math\.floor\(150\+b\*105\)/,          // 별 밝기
  /if\(rNorm<0\.52\)\{ return 'rgba\(60,'/,                                 // 별 밝기
  /return 'rgba\('\+Math\.floor\(90\+b\*60\)/,                              // 별 밝기
  /var bright=\(0\.3\+tw\*0\.7\)\*st\.depth;/,                              // 최소 밝기
  /var sz=st\.size\*\(0\.5\+\(1-st\.baseR\)\*0\.9\);/,                       // 별 크기
  /grd\.addColorStop\(0,'rgba\(90,224,200,'\+\(0\.24\*coreGlow\)\+'\)'\);/,   // 농도
  /grd\.addColorStop\(0\.16,'rgba\(50,180,180,'\+\(0\.12\*coreGlow\)\+'\)'\);/,
  /grd\.addColorStop\(0\.5,'rgba\(38,90,110,0\.05\)'\);/,
  /var cg=ctx\.createRadialGradient\(CX,CY,0,CX,CY,30\*breath\*coreGlow\);/, // 코어 강화
  /cg\.addColorStop\(0,'rgba\(200,255,240,'\+\(0\.9\*coreGlow\)\+'\)'\);/,
  /cg\.addColorStop\(0\.42,'rgba\(88,220,210,'\+\(0\.55\*coreGlow\)\+'\)'\);/,
  /ctx\.fillStyle=cg; ctx\.beginPath\(\); ctx\.arc\(CX,CY,30\*breath\*coreGlow,0,Math\.PI\*2\); ctx\.fill\(\);/,
];
const 빠진 = 시안줄.filter((l) => !화면줄.has(l) && !승인된변경.some((re) => re.test(l)));
ok('★★시안 코드가 (지시받은 크기·밝기 줄 빼고) 전부 그대로 있다', 빠진.length === 0,
  빠진.length + '줄 빠짐: ' + 빠진.slice(0, 3).join(' / '));

console.log('\n[1-3] ★크기 확대 · 존재감 강화 (대표님 2차 지시)');
const mr = gh.match(/maxR=Math\.min\(W,H\)\*(0\.\d+)/);
ok('★크기가 시안 원값(0.375)보다 확실히 큼', mr && Number(mr[1]) >= 0.47, mr ? mr[1] : '못 찾음');
// ★★"꽉 채워 잘리진 않게" — maxR 은 캔버스 반지름 대비 비율이라 0.5를 넘으면 무조건 잘린다.
ok('★★잘리지 않는다(maxR ≤ 0.5)', mr && Number(mr[1]) <= 0.5, mr ? mr[1] + ' → ' + (Number(mr[1]) * 200).toFixed(0) + '%' : '못 찾음');
// ★★대표님 지적: 은하 박스만 좌우 벽에 붙어 답답했다(음수 마진으로 열 여백을 상쇄했던 탓).
//   좌우 여백은 아래 다른 박스와 똑같아야 한다 → 음수 마진 금지.
ok('★★좌우 여백이 다른 박스와 같다(음수 마진 없음)',
  /id="galaxyWrap" style="display:none;margin:0 0 14px;"/.test(gh) && !/margin:0 -\d+px/.test(gh));
ok('★세로 압축 완화(0.84 → 0.89) — 더 원에 가깝게', /Math\.sin\(st\.ang\)\*R\*0\.89;/.test(gh));
ok('★별 밝기 강화(투명도 상향)', /Math\.min\(1,b\*1\.35\)/.test(gh) && /Math\.min\(1,b\*1\.25\)/.test(gh) && /Math\.min\(1,b\*1\.12\)/.test(gh));
ok('★흐린 별도 보이게 최소 밝기 상향', /var bright=\(0\.5\+tw\*0\.62\)\*\(0\.55\+st\.depth\*0\.55\);/.test(gh));
ok('★별 크기 확대(밀도감)', /\*1\.45;/.test(gh));
ok('★중심 코어 강화(크기 30→46 · 밝기 상향)', /var 코어R=46\*breath\*coreGlow;/.test(gh) && /Math\.min\(1,1\.0\*coreGlow\)/.test(gh));
ok('★은하 전체 농도 강화', /Math\.min\(1,0\.38\*coreGlow\)/.test(gh));

console.log('\n[1-4] ★건드리지 말라신 것은 그대로인가');
ok('★모양(원형 분포) 그대로', /var ang=Math\.random\(\)\*Math\.PI\*2;/.test(gh) && /var rr=Math\.pow\(Math\.random\(\),0\.62\);/.test(gh));
ok('★청록색 그대로', /rgba\(200,255,240,/.test(gh) && /rgba\(88,220,210,/.test(gh) && /,255,230,/.test(gh));
ok('★호흡 그대로', /breath=1\+Math\.sin\(t\*0\.9\)\*0\.02/.test(gh) && /breath=1\+\(slow\*0\.10\)\+\(mid\*0\.05\)/.test(gh));
ok('★회전 그대로(태극 변형 없음)', /st\.ang\+=st\.spin\*0\.0032\*spinMul;/.test(gh));
ok('★별 개수 2600 그대로', /var N=2600, stars=\[\];/.test(gh));
ok('★시안 canvas(jarvisHolo)가 화면에 있다', /<canvas id="jarvisHolo" width="600" height="440"/.test(gh));
ok('★시안이 요구한 상태 함수 setJarvisState 가 살아 있다', /window\.setJarvisState=function\(s\)\{ state=s; \};/.test(gh));
ok('★자체 제작 은하는 완전히 제거됨(중복 렌더 없음)',
  !/var STARS = /.test(gh) && !/galaxyCv/.test(gh) && !/차등 = 각/.test(gh));

console.log('\n[1-2] 시안이 확정한 사양 (원형 · 청록 · 2600개)');
ok('★별 2600개', /var N=2600, stars=\[\];/.test(blk));
ok('★원형 분포(각도 고르게) — 태극 아님', /var ang=Math\.random\(\)\*Math\.PI\*2;/.test(blk));
ok('★중앙 청록/시안 코어', /rgba\(200,255,240,|rgba\(88,220,210,/.test(blk));
ok('★바깥은 딥블루 별', /return 'rgba\('\+Math\.floor\(90\+b\*60\)\+','\+Math\.floor\(150\+b\*60\)\+',255,/.test(blk));
ok('★은하 회전', /st\.ang\+=st\.spin\*0\.0032\*spinMul;/.test(blk));

// ═══ [2] 음성 반응 — 잔잔한 호흡 (★심장 쿵쾅 금지) ═══
console.log('\n[2] ★말할 때 잔잔한 호흡 (어지럽지 않게)');
// ★시안이 정한 호흡을 그대로 검사한다(내 옛 방식이 아니라).
//   시안: t += 0.016 (60fps → 초당 0.96) · speak 일 때 breath = 1 + sin(t*1.6)*0.10 + sin(t*2.4)*0.4*0.05
const 증가 = blk.match(/t\+=(0\.\d+);/);
const 느린 = blk.match(/var slow=Math\.sin\(t\*(\d+(?:\.\d+)?)\)/);
ok('★말하기 호흡 파형이 있다(시안 원문)', !!(증가 && 느린) && /breath=1\+\(slow\*0\.10\)\+\(mid\*0\.05\)/.test(blk));
const 주기 = (증가 && 느린) ? (2 * Math.PI) / (Number(증가[1]) * 60 * Number(느린[1])) : 0;
ok('★호흡 주기가 사람 숨 범위(3~7초) — 심장 박동(1초)이 아니다', 주기 >= 3 && 주기 <= 7, 주기.toFixed(1) + '초');
ok('★중심으로 모였다 퍼진다(반지름이 호흡을 탄다)', /var effR=maxR\*breath;/.test(blk) && /var R=st\.baseR\*effR;/.test(blk));
ok('★대기 상태는 거의 안 움직인다(±2%)', /breath=1\+Math\.sin\(t\*0\.9\)\*0\.02/.test(blk));
ok('★작업 중에도 흔들림은 작다(±1.5%) — 어지럽지 않게', /breath=1\+Math\.sin\(t\*1\.2\)\*0\.015/.test(blk));

// ═══ [3] 4가지 상태 ═══
console.log('\n[3] 4가지 상태 (대기·듣기·작업·말하기)');
['idle', 'listen', 'think', 'speak'].forEach((s) => ok(`상태 ${s} 있음`, new RegExp("'" + s + "'").test(blk)));
ok('상태별로 회전 속도가 다름(시안 spinMul)',
  /state==='idle'\)\{ breath[\s\S]{0,60}spinMul=0\.3/.test(blk) && /spinMul=0\.5/.test(blk) && /spinMul=1\.9/.test(blk) && /spinMul=0\.75/.test(blk));

// ═══ [3-2] ★박스 문구 삭제 (대표님 지시) ═══
console.log('\n[3-2] ★박스 문구 전부 삭제 · 좌측엔 자비스만');
ok('★상태 문구("대기 중") 안 보임', /id="galaxyLbl" style="display:none"/.test(gh));
ok('★프로필 박스 묶음에 id 가 붙어 통째로 숨길 수 있음', /<div id="profileBoxes">/.test(gh));
[['온보딩에서 설계된 내 비서'], ['지니야 · 보험설계 전담'], ['23년차 맞춤'], ['genyaTags'], ['painBanner'], ['직업'], ['핵심 고민'], ['철칙']]
  .forEach(function (x) {
    var i = gh.indexOf('<div id="profileBoxes">'), j = gh.indexOf('</div>\n          <!-- 📅 일정관리', i);
    var 안 = gh.slice(i, j > i ? j : i + 2000);
    ok(`"${x[0]}" 이 숨김 대상 안에 있음`, 안.indexOf(x[0]) >= 0);
  });
ok('★촬영 모드에서 실제로 숨긴다', /getElementById\('profileBoxes'\); if\(pb\) pb\.style\.display='none';/.test(gh));
ok('★평소엔 안 숨긴다(촬영 켜기 안쪽에만 있음)',
  blk.indexOf("if(!window.__FILMING) return;") < blk.indexOf("getElementById('profileBoxes')"));
ok('★내용은 한 글자도 안 바꿈(감싸기만 함)', /<div class="sect-t">온보딩에서 설계된 내 비서<\/div>/.test(gh) && /<b>발송 전 승인<\/b>/.test(gh));

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
ok('★모니터 통째가 아님(좌측 열 안, 최대 250px)', /maxWidth = \(촬영 \? 250 : 168\) \+ 'px'/.test(gh) && !/position:\s*fixed/.test(blk));
ok('★촬영=크게(250) · 실제=작게(168)', /var 촬영 = true;/.test(gh) && /window\.galaxyBig = function\(on\)\{ 촬영 = !!on;/.test(gh));
// 명단은 이제 전체화면이 아니라 대화창 안 카드다 → 좌측 은하와 애초에 겹치지 않는다.
ok('★명단과 은하가 겹치지 않는다(명단=대화창 카드 · 은하=좌측 열)',
  !/id="fullRoster"/.test(gh) && /genya-roster-card/.test(gh) && !/galaxyWrap[^>]*z-index/.test(gh));

// ═══ [6] ★메인(교육생) 무접촉 ═══
console.log('\n[6] ★메인·교육생 기능 그대로');
ok('★촬영 모드에서만 켜진다(window.__FILMING)', /if\(!window\.__FILMING\) return;/.test(blk));
ok('★평소엔 화면에 자리도 안 차지(display:none 그대로)', /id="galaxyWrap" style="display:none/.test(gh));
ok('★__FILMING 은 서버가 넣어준다', /window\.__FILMING=' \+ \(FILMING \? 'true' : 'false'\)/.test(ms));
ok('★라이브면 false 가 들어간다(FILMING 은 환경변수로만 true)', /const FILMING = process\.env\.FILMING_MODE === '1';/.test(ms));
// ★촬영 아님 → return 이 시안 코드(별 생성 for문·frame())보다 ★위에 있어야 한다.
//   그래야 라이브에서 별 2600개 계산도, 애니메이션도 아예 시작되지 않는다.
const _게이트 = blk.indexOf('if(!window.__FILMING) return;');
ok('★평소엔 별 계산조차 안 함(게이트가 별 생성보다 위)',
  _게이트 >= 0 && _게이트 < blk.indexOf('for(var i=0;i<N;i++)'), '게이트=' + _게이트 + ' · 별생성=' + blk.indexOf('for(var i=0;i<N;i++)'));
ok('★평소엔 애니메이션도 시작 안 함(게이트가 frame() 호출보다 위)',
  _게이트 >= 0 && _게이트 < blk.lastIndexOf('frame();'));

// ═══ [7] 지어내지 않는가 (폐기된 홀로그램과 다른 점) ═══
console.log('\n[7] ★값을 지어내지 않는가 (2026-07-27 폐기 사고 재발 방지)');
ok('★은하는 고객 데이터를 아예 안 읽는다', !/loadTable|\/api\/order|고객명|만기일/.test(blk));
ok('★서버에 아무것도 요청하지 않는다', !/fetch\(/.test(blk));
ok('★숫자·이름을 만들어 표시하지 않는다(표시는 상태 이름뿐)', !/innerHTML/.test(blk));

// ═══ [8] 성능 (촬영 중 버벅이면 안 됨) ═══
console.log('\n[8] 촬영 중 버벅이지 않는가');
ok('점 찍기는 가장 가벼운 방식(fillRect)', /ctx\.fillRect\(x,y,sz,sz\);/.test(blk));
ok('별 2600개 = 촬영에 충분히 가벼운 수', /var N=2600/.test(blk));
ok('★캔버스가 화면 폭에 맞게 조정됨(시안 주석 3번)', /cv0\.width = cv0\.height = 560;/.test(gh));
ok('★촬영=250px · 실제=168px (시안 주석 4번)', /\(촬영 \? 250 : 168\) \+ 'px'/.test(gh));

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`통과 ${통과} · 실패 ${실패}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(실패 ? 1 : 0);
