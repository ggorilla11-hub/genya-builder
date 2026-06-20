// B-2 발송 스타일 dryRun (★발송 0 · 카톡 무접촉 · 시뮬만).
// B-2 흐름: 한 명씩 "○○님" 표시 → 공통인사 + 개인문구 → 엔터 → 지니야가 카톡 자동전송(검색→기존대화방→주입→전송).
//   실제 사용 = 사람이 화면에서 개인문구+엔터(발송주체=사람). 이 dryRun = 그 흐름 + 내용 자체점검을 카톡 무접촉으로 미리보기.
// 사용: node b2-dryrun.js <safe-list.json> ["공통인사({이름} 변수 가능)"] [개인문구파일.txt]
//   개인문구파일 = 한 줄에 한 사람 개인문구(순서=safe-list 순). 없으면 "[입력칸]"으로 표시(실행 시 사람이 작성).
const fs = require('fs');

function mask(p) { const d = String(p || '').replace(/\D/g, ''); return d.length < 7 ? '***' : d.slice(0, 3) + '-****-' + d.slice(-4); }
const readText = (p) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');

// ⑨ 내용 자체점검 — 스팸/광고/홍보/판매 필터
const AD_WORDS = ['광고', '홍보', '판매', '구매', '할인', '특가', '이벤트', '무료', '쿠폰', '적립', '세일', '프로모'];
const SPAM_WORDS = ['대출', '도박', '카지노', '코인', '원금보장', '투자수익'];
function contentCheck(text) {
  const t = String(text || '');
  const ad = AD_WORDS.filter((w) => t.includes(w));
  const spam = SPAM_WORDS.filter((w) => t.includes(w));
  const flags = [];
  if (spam.length) flags.push('★규제/스팸 의심 키워드: ' + spam.join(',') + ' → 발송 재검토');
  if (ad.length && !t.includes('(광고)')) flags.push('광고성 의심(' + ad.join(',') + ') → (광고)표시·수신거부·야간금지 필요(정보통신망법)');
  return flags;
}

const safePath = process.argv[2];
const greeting = process.argv[3] || '안녕하세요 {이름}님, 잘 지내시죠?';
const linePath = process.argv[4] || '';
if (!safePath) { console.error('사용: node b2-dryrun.js <safe-list.json> ["공통인사"] [개인문구파일]'); process.exit(1); }

let safe; try { safe = JSON.parse(readText(safePath)); } catch (e) { console.error('safe-list 읽기 실패:', e.message); process.exit(1); }
const recipients = Array.isArray(safe.recipients) ? safe.recipients : [];
const lines = linePath ? readText(linePath).split(/\r?\n/) : [];

console.log('=== B-2 dryRun — ★발송 0 · 카톡 무접촉 · 한 명씩 흐름 시뮬 ===');
console.log('공통인사 템플릿:', greeting);
console.log(`대상 ${recipients.length}명 · 발송주체=사람(매 건 개인문구+엔터) · 40초+지터(실발송 시)\n`);

recipients.slice(0, 20).forEach((r, i) => {
  const name = r.name || '고객';
  const hello = greeting.replace(/\{이름\}/g, name);
  const personal = lines[i] !== undefined && lines[i] !== '' ? lines[i] : '[개인문구 입력칸 — 실행 시 사람이 작성]';
  const full = hello + '\n' + personal;
  const flags = contentCheck(full);
  console.log(`[${i + 1}/${recipients.length}] ${name}님  (${mask(r.phone)})`);
  console.log('   공통:', hello);
  console.log('   개인:', personal);
  console.log('   내용점검:', flags.length ? '⚠ ' + flags.join(' / ') : 'OK(스팸·광고 패턴 없음)');
  console.log('   → 엔터 시: 카톡 자동(검색 "' + name + '"→기존 대화방 열기→텍스트 주입→전송) ★dryRun 발송 0\n');
});
if (recipients.length > 20) console.log(`…외 ${recipients.length - 20}명\n`);

console.log('★ 발송 0 · 카톡 무접촉. 실제 전송은 핸즈온 검증 → pywinauto → 본인 1건 → 극소량 파일럿.');
console.log('★ 새 채팅방 0: "기존 대화방 열기"만, 검색결과에 기존 방 없으면 건너뜀(+(B) 반자동 allowlist 병행).');
console.log('★ 발송 주체 = 사람(매 건 개인문구+엔터). 면책 동의·킬스위치·이상정지는 실발송 단계.');
