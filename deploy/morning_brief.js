// ─────────────────────────────────────────────────────────────
// morning_brief.js — 📮 모닝 브리핑(Render Cron 자율) 텍스트 생성 (독립 모듈)
// 무엇을·왜: 매일 아침, 회장님 고객명단 시트에서 "오늘" 만기·생일·상담예정을 뽑아
//   Gmail로 보낼 요약 텍스트를 만든다. 발송·인증은 main_server가 담당(이 모듈은 순수 텍스트).
// ★이모지 0 (합격기준). ★서버 저장 0 — 그때 읽어 요약만.
// ─────────────────────────────────────────────────────────────
'use strict';

// 날짜 문자열 → 'MM-DD'. YYYY-MM-DD 우선, 아니면 MM-DD.
function mmdd(s) {
  s = String(s || '');
  const full = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (full) return full[2].padStart(2, '0') + '-' + full[3].padStart(2, '0');
  const short = s.match(/(\d{1,2})[-\/.](\d{1,2})/);
  if (short) return short[1].padStart(2, '0') + '-' + short[2].padStart(2, '0');
  return '';
}
// 헤더에서 후보 키워드를 포함하는 컬럼명 찾기(동의어)
function colOf(header, cands) {
  const norm = (x) => String(x).replace(/\s+/g, '');
  for (const c of cands) for (const h of header || []) if (norm(h).includes(c)) return h;
  return null;
}

// loadTable(ma) 주입 → 오늘(KST) 만기·생일·상담 브리핑. opts.today='MM-DD'로 테스트 고정 가능.
async function build(loadTable, ma, opts) {
  opts = opts || {};
  const today = opts.today || new Date(Date.now() + 9 * 3600e3).toISOString().slice(5, 10);
  const table = await loadTable(ma);
  const header = table.header || [];
  const name = table.nameCol || header[0];
  const pick = (col) => (col ? (table.rows || []).filter((r) => mmdd(r[col]) === today).map((r) => String(r[name] || '')).filter(Boolean) : []);
  const 만기 = pick(colOf(header, ['만기']));
  const 생일 = pick(colOf(header, ['생년월일', '생일', '생년']));
  const 상담 = pick(colOf(header, ['상담', '예정', '미팅', '약속']));
  const count = 만기.length + 생일.length + 상담.length;
  const lines = ['회장님, 오늘 아침 브리핑입니다.', ''];
  if (만기.length) lines.push('[오늘 만기] ' + 만기.join(', '));
  if (생일.length) lines.push('[오늘 생일] ' + 생일.join(', '));
  if (상담.length) lines.push('[오늘 상담 예정] ' + 상담.join(', '));
  if (!count) lines.push('오늘 챙길 만기·생일·상담 예정은 없습니다. 편안한 하루 되세요.');
  else lines.push('', '제출·연락 전 한 번 더 확인하시고, 필요하면 말씀만 주세요.');
  return { text: lines.join('\n'), count, 만기: 만기.length, 생일: 생일.length, 상담: 상담.length };
}

module.exports = { build, mmdd, colOf };
