// 단체카톡 (B) 얇은 로컬 하드가드 체커 — 대표 PC에서 실행.
// ★안전 헌법: 읽기·교집합만 / 봇 로그인·발송 X / allowlist는 로컬 only(서버 0 업로드).
// ★하는 일: 엔진 export 명단 ∩ 로컬 allowlist(기존 대화방 있는 사람) → 교집합만 = 오토톡에 줄 "안전 명단".
//   allowlist에 없는 사람(=기존 대화방 미확인) → 제외(새 채팅방 0). 1번 원칙 최종 집행.
// ★dryRun: 발송 0 — 누가 포함/제외되는지 미리보기 + safe-list.json 생성만. 실제 발송은 오토톡 + 사람 1클릭(다음 단계).
//
// 사용: node check.js <export.json> <allowlist.csv>
//   export.json   = 엔진 POST /bulk/approve 응답(JSON 저장). export.recipients=[{name,phone}], export.message
//   allowlist.csv = 대표가 카톡 "기존 대화방 있음" 확인한 번호(로컬 only). 한 줄에 "이름,번호" 또는 "번호".
const fs = require('fs');

function phoneKey(p) { let d = String(p || '').replace(/\D/g, ''); if (d.length === 10 && d.startsWith('10')) d = '0' + d; return d.length >= 9 ? d : ''; }
function mask(p) { const d = String(p || '').replace(/\D/g, ''); return d.length < 7 ? '***' : d.slice(0, 3) + '-****-' + d.slice(-4); }

const exportPath = process.argv[2], allowPath = process.argv[3];
if (!exportPath || !allowPath) { console.error('사용: node check.js <export.json> <allowlist.csv>'); process.exit(1); }

const readText = (p) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');   // BOM 제거(엑셀·메모장 저장 대비)
let ex; try { ex = JSON.parse(readText(exportPath)); } catch (e) { console.error('export.json 읽기 실패:', e.message); process.exit(1); }
const exp = ex.export || ex;                       // /bulk/approve 응답 통째 또는 export만 둘 다 허용
const recipients = Array.isArray(exp.recipients) ? exp.recipients : [];
const message = exp.message || '';

let allowRaw; try { allowRaw = readText(allowPath); } catch (e) { console.error('allowlist 읽기 실패:', e.message); process.exit(1); }
const allow = new Set();
for (const line of allowRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
  const parts = line.split(',');
  const k = phoneKey(parts[parts.length - 1]);     // 마지막 칸을 번호로(이름,번호 또는 번호)
  if (k) allow.add(k);
}

const included = [], excluded = [];
for (const r of recipients) {
  const k = phoneKey(r.phone);
  if (k && allow.has(k)) included.push(r);
  else excluded.push({ name: r.name || '', reason: k ? 'allowlist 없음(기존 대화방 미확인 → 새 방 0)' : '번호 이상' });
}

console.log('=== (B) dryRun — ★발송 0, 미리보기만 ===');
console.log('문구:', String(message).slice(0, 60));
console.log(`export 명단 ${recipients.length}명  ∩  allowlist ${allow.size}명`);
console.log(`★보낼(교집합): ${included.length}명`);
included.slice(0, 10).forEach((r) => console.log('   [보냄]', r.name || '', mask(r.phone)));
if (included.length > 10) console.log(`   …외 ${included.length - 10}명`);
console.log(`제외: ${excluded.length}명 (allowlist 없음=기존 대화방 미확인)`);
excluded.slice(0, 10).forEach((r) => console.log('   [제외]', r.name, '—', r.reason));
if (excluded.length > 10) console.log(`   …외 ${excluded.length - 10}명`);

fs.writeFileSync('safe-list.json', JSON.stringify({ message, recipients: included }, null, 2), 'utf8');
console.log(`\n안전 명단 → safe-list.json (${included.length}명). ★발송 0 — 실제 발송은 오토톡 + 사람 1클릭(다음 단계). allowlist 없는 사람은 영영 제외(새 방 0).`);
