// 음성 호명 감지 일회성 검증 스크립트 — node test-호명.js
// server.js에서 호명 감지 부분만 그대로 뽑아 와서 실제 코드 그대로 테스트한다.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, 'server.js'), 'utf8');
const start = src.indexOf('const CALL_VERB_RE');
const end = src.indexOf('// 음성 공통 지침');
eval(src.slice(start, end));

const cases = [
  // [말, 기대 결과] — null = 전환 없음(현재 에이전트 유지)
  // ── 전환되면 안 되는 것 (주제·3인칭 언급) ──
  ['마케팅 쪽은 어떻게 진행할까?', null],
  ['발굴 이야기 좀 하자', null],
  ['마케팅팀장이 해야 할 일이 뭐지?', null],
  ['발굴팀장한테 시킬 일을 정리해줘', null],
  ['개발팀장은 지금 뭐 하고 있어?', null],
  ['어제 마케팅팀장 보고 받았는데 어땠어?', null],
  ['총괄적으로 정리해줘', null],
  ['전체적으로 보고해줘', null],
  ['팀들이 다같이 하면 좋겠다', null],
  ['재무팀장의 의견은 어때?', null],
  // ── 전환되어야 하는 것 (직접 호명) ──
  ['마케팅팀장', 'mkt'],
  ['마케팅팀장님?', 'mkt'],
  ['마케팅팀장 나와봐', 'mkt'],
  ['개발팀장 불러줘', 'dev'],
  ['그럼 발굴팀장 좀 불러줘', 'lead'],
  ['관리 팀장 바꿔줘', 'care'],
  ['디자인팀장, 포스터 어떻게 됐어?', 'design'],
  ['법무팀장 연결해줘', 'legal'],
  ['재무팀장 대답해봐', 'finance'],
  ['제니야, 다시 너랑 얘기할게', 'zenya'],
  ['총괄 나와줘', 'zenya'],
  // ── 전체 릴레이 ──
  ['다같이 보고해봐', 'ALL'],
  ['전체 팀장 나와서 보고해', 'ALL'],
  ['모든 팀 오늘 한 일 대답해', 'ALL'],
];

let fail = 0;
for (const [text, want] of cases) {
  const got = detectVoiceTarget(text);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? '✅' : '❌'} "${text}" → ${got} (기대: ${want})`);
}
console.log(fail ? `\n실패 ${fail}건` : '\n전부 통과');
process.exit(fail ? 1 : 0);
