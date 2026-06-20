// 단체카톡 자체 발송 컴포넌트 — dryRun (★발송 0 · 카톡 무접촉 · 미리보기/시뮬만).
// 안전 헌법: 읽기·시뮬만 / 봇 로그인·발송 X / 면책 고지 / 본인 1클릭은 실발송 단계에서.
// safe-list(check.js 산출 = 교집합·안전필터된 명단)를 받아 "보낼 순서·40초+지터 스케줄·예상 소요·이미지 참조"를 미리보기.
// ★카카오톡을 전혀 건드리지 않는다(실제 발송은 다음 단계, 핸즈온·pywinauto·극소량 파일럿).
//
// 사용: node dryrun.js <safe-list.json> [이미지경로] [건당초]
const fs = require('fs');

function mask(p) { const d = String(p || '').replace(/\D/g, ''); return d.length < 7 ? '***' : d.slice(0, 3) + '-****-' + d.slice(-4); }
function fmt(sec) { const m = Math.floor(sec / 60), s = sec % 60; return (m ? m + '분 ' : '') + s + '초'; }

const safePath = process.argv[2];
const imagePath = process.argv[3] || '';
const perMsgSec = Math.max(20, Number(process.argv[4]) || 40);   // 건당 최소 간격(기본 40초)
if (!safePath) { console.error('사용: node dryrun.js <safe-list.json> [이미지경로] [건당초]'); process.exit(1); }

let safe; try { safe = JSON.parse(fs.readFileSync(safePath, 'utf8').replace(/^﻿/, '')); } catch (e) { console.error('safe-list 읽기 실패:', e.message); process.exit(1); }
const recipients = Array.isArray(safe.recipients) ? safe.recipients : [];
const message = safe.message || '';

console.log('================ ★ 면책 고지 (실발송 전 1회 동의 필요) ================');
console.log(' · 회색지대: 카카오 공식 인정 아님 · 100% 보장 없음 · 계정 제한 가능');
console.log(' · 책임 귀속: 발송은 본인 카톡·본인 1클릭·본인 책임. 오원트는 도구만 제공·면책');
console.log(' · 안전 조건: 대화이력 고객만 · 소량 · 관계형 · 광고성이면 (광고)표시·수신거부·야간금지');
console.log(' · 포지셔닝: 대량 스팸기 X → "대화이력 고객 관계관리 보조"');
console.log('=====================================================================\n');

console.log('=== dryRun — ★발송 0 · 카톡 무접촉 · 시뮬레이션만 ===');
console.log('문구:', String(message).slice(0, 80));
if (imagePath) console.log('이미지 첨부(참조만, 바이트 미보관):', imagePath, fs.existsSync(imagePath) ? '(파일 있음)' : '(★파일 없음 — 경로 확인)');
console.log(`대상: ${recipients.length}명 · 건당 ${perMsgSec}초 + 지터 · 야간(21~08) 차단(실발송 시)`);
const totalMin = Math.ceil(recipients.length * perMsgSec / 60);
console.log(`예상 소요(지터 제외): 약 ${totalMin}분\n`);

let t = 0;
recipients.slice(0, 20).forEach((r, i) => {
  const jitter = (i === 0) ? 0 : perMsgSec + Math.floor(Math.random() * 11) - 5;   // ±5초 지터(시뮬)
  t += jitter;
  console.log(`  [보낼 예정] ${String(r.name || '').padEnd(8)} ${mask(r.phone)}  (T+${fmt(t)})`);
});
if (recipients.length > 20) console.log(`  …외 ${recipients.length - 20}명`);

console.log('\n★ 발송 0 — 실제 카톡 발송은 다음 단계(핸즈온 검증 → pywinauto → 본인 1건 → 극소량 파일럿).');
console.log('★ 새 채팅방 0: 실발송기는 "기존 대화방 있을 때만" 보내고 없으면 건너뜀. (B) 반자동 allowlist 병행으로 이중 안전.');
