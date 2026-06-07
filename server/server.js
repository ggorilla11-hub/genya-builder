// ============================================================
// server.js — 제니야 중계 서버 (3단계 1차: 뼈대)
// ------------------------------------------------------------
// 역할: 제니야.html(화면)이 보낸 말씀을 받아
//       클로드 API(두뇌)에 전달하고, 답을 화면으로 돌려준다.
// 보안: API 키는 이 코드에 없다. 금고(.env)에서만 읽는다.
// 배포: 로컬에서는 3000번 문(포트), Render 배포 시 PORT 환경변수를 따른다.
// 다음 단계: agents/ 폴더의 시스템 프롬프트 8개를 읽어
//            에이전트별 정체성을 입히고, 회의·호명 라우팅을 얹는다.
// ============================================================

require('dotenv').config();               // 금고(.env)를 연다
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// ── 기본 설정 ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const MODEL = 'claude-opus-4-8';          // 클로드 최신 최상위 모델

// ── 정체성 문서 읽기 (agents/ 폴더) ─────────────────────────
// 서버가 켜질 때 한 번 읽어 기억해 둔다.
// ※ agents/ 문서를 고치면 서버를 껐다 켜야 반영된다.
const AGENTS_DIR = path.join(__dirname, '..', 'agents');

function readDoc(fileName) {
  try {
    return fs.readFileSync(path.join(AGENTS_DIR, fileName), 'utf8');
  } catch (e) {
    console.warn(`⚠️  정체성 문서를 찾지 못했습니다: ${fileName}`);
    return '';
  }
}

// 모든 에이전트가 먼저 적용하는 공통 규칙(00)
const COMMON_RULES = readDoc('00_공통_규칙.md');

// 프로젝트 정의 (docs/프로젝트_정의.md) — 6개 프로젝트가 각각 무엇인지.
// 부트캠프=AI 에이전트 제작 과정(재무교육 아님!) 같은 맥락 착오를 막는다.
const DOCS_DIR = path.join(__dirname, '..', 'docs');
let PROJECT_DEFS = '';
try {
  PROJECT_DEFS = fs.readFileSync(path.join(DOCS_DIR, '프로젝트_정의.md'), 'utf8');
} catch (e) {
  console.warn('⚠️  docs/프로젝트_정의.md를 찾지 못했습니다. 프로젝트 정의 없이 답합니다.');
}

// 화면의 에이전트 id ↔ 전용 문서 연결표 (제니야.html의 명단표와 일치)
const AGENT_DOCS = {
  zenya:   { name: '총괄(제니야)', file: '01_총괄_제니야.md' },
  lead:    { name: '고객발굴',     file: '02_고객발굴.md' },
  care:    { name: '고객관리',     file: '03_고객관리.md' },
  mkt:     { name: '마케팅',       file: '04_마케팅.md' },
  design:  { name: '디자인',       file: '05_디자인.md' },
  dev:     { name: '개발',         file: '06_개발.md' },
  legal:   { name: '법무·보안',    file: '07_법무보안.md' },
  // 매출·재무는 아직 전용 문서가 없어 임시 정체성을 쓴다 (문서 생기면 file만 추가)
  finance: { name: '매출·재무',    file: null,
             fallback: '너는 오상열 대표님의 "매출·재무" 서브에이전트다. 매출·정산 시트 관리와 목표 대비 진척 보고를 담당한다. ' +
                       '말투: 냉정한 숫자 중심, 감정 빼고 팩트만("이번 달 목표 대비 62%, 부족분 3건"). 짧게 2~4문장.' }
};

// 서버 시작 시 전용 문서들도 모두 읽어 기억해 둔다
for (const id of Object.keys(AGENT_DOCS)) {
  const a = AGENT_DOCS[id];
  a.doc = a.file ? readDoc(a.file) : (a.fallback || '');
}
console.log(`📖 정체성 문서 로딩 완료 — 공통 규칙 ${COMMON_RULES ? 'O' : 'X'}, 에이전트 ${Object.keys(AGENT_DOCS).length}명`);

// ── 저장소 (server/data 폴더의 파일 — 대표님 컴퓨터 안에만 저장) ──
// 대화기록.json = 모든 대화 말풍선 / 영업일기.json = 에이전트가 한 일의 기록
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch (e) { return []; }
}
function saveJson(file, arr) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(arr, null, 2), 'utf8');
}

const HISTORY = loadJson('대화기록.json');   // [{ts, who, text, project}]
const DIARY   = loadJson('영업일기.json');   // [{ts, agentId, agentName, project, kind, entry}]
console.log(`💾 저장소 로딩 — 대화 ${HISTORY.length}건, 영업일기 ${DIARY.length}건`);

function appendHistory(msg) {
  HISTORY.push(msg);
  saveJson('대화기록.json', HISTORY);
}
function appendDiary(entry) {
  DIARY.push(entry);
  saveJson('영업일기.json', DIARY);
}

// 모닝브리핑/저녁보고용 — 해당 시간대의 영업일기를 글로 풀어준다
function diaryDigest(message) {
  const now = new Date();
  const from = new Date(now);
  if (message.includes('모닝브리핑')) {
    from.setDate(from.getDate() - 1);       // 어제 18:00부터 (밤사이 일 취합)
    from.setHours(18, 0, 0, 0);
  } else {
    from.setHours(6, 0, 0, 0);              // 오늘 06:00부터 (오전~오후 취합)
  }
  const entries = DIARY.filter((d) => new Date(d.ts) >= from).slice(-50);
  if (!entries.length) return '(해당 시간대 영업일기 없음 — 지어내지 말고 "기록 없음"으로 보고할 것)';
  return entries.map((d) =>
    `[${new Date(d.ts).toLocaleString('ko-KR')}] [${d.agentName} / ${d.project}] ${String(d.entry).slice(0, 300)}`
  ).join('\n');
}

// 최근 영업일기 — 평상시 대화용 실시간 현황.
// 총괄(zenya)은 전 팀의 기록을, 일반 에이전트는 자기 기록만 본다.
function recentDiary(agentId) {
  const from = Date.now() - 48 * 3600 * 1000;          // 최근 48시간
  let entries = DIARY.filter((d) => new Date(d.ts).getTime() >= from);
  if (agentId && agentId !== 'zenya') entries = entries.filter((d) => d.agentId === agentId);
  entries = entries.slice(-30);                         // 최대 30건 (토큰 절약)
  if (!entries.length) return '(최근 48시간 영업일기 없음 — 지어내지 말고 "기록 없음"이라고 답할 것)';
  return entries.map((d) =>
    `[${new Date(d.ts).toLocaleString('ko-KR')}] [${d.agentName} / ${d.project} / ${d.kind}] ${String(d.entry).slice(0, 200)}`
  ).join('\n');
}

// 시스템 프롬프트에 실시간 현황을 붙인다 (모든 창구에서 공용)
function withLiveStatus(system, agentId) {
  const isBoss = !agentId || agentId === 'zenya';
  return system
    + `\n\n=== 실시간 현황: 최근 영업일기 (${isBoss ? '전 팀' : '나의 활동'} · 최근 48시간) ===\n`
    + recentDiary(agentId)
    + '\n(팀 현황 질문에는 이 기록을 근거로 즉시 답하라. 기록 밖의 일은 지어내지 말 것)';
}

// 에이전트의 시스템 프롬프트 조립: 공통 규칙(00) + 전용 문서 + 현재 프로젝트 맥락
function buildSystemPrompt(agentId, projectName) {
  const a = AGENT_DOCS[agentId] || AGENT_DOCS.zenya;   // 모르는 id면 총괄이 받는다
  return [
    '=== 공통 규칙 (모든 에이전트가 먼저 적용) ===',
    COMMON_RULES,
    '',
    '=== 프로젝트 정의 (어느 프로젝트가 무엇인지 — 필독) ===',
    PROJECT_DEFS,
    '',
    '=== 너의 전용 시스템 프롬프트 ===',
    a.doc,
    '',
    '=== 대화 수칙 (절대 위반 금지) ===',
    '1. 너는 오직 너 자신(위 전용 프롬프트의 에이전트)으로서만 1인칭으로 말한다.',
    '2. 절대 대행 금지: 다른 에이전트의 의견을 대신 말하거나 요약하지 마라. "○○팀 관점을 정리하면" 같은 화법 금지. ' +
    '단, "그건 @○○팀장에게 물어봐 주세요" 안내는 대표님이 명시적으로 남의 일을 대신 말하라고 시킬 때만 짧게 한 번 한다. ' +
    '평소 답변이나 @전체 답변 끝에 이 안내를 습관처럼 붙이지 마라 — 네 몫만 답하고 깔끔하게 끝내라. ' +
    '(대행이 아닌 것 2가지: ① 총괄이 회의 종합 단계에서 회의록을 인용하는 것 ' +
    '② 총괄이 영업일기 기록에 근거해 팀 현황·숫자를 보고하는 것 — 이것은 총괄의 본업이다)',
    '3. 답변은 기본 2~4문장, 실제로 입으로 말하듯 구어체로. 마크다운 표·헤더·긴 목록·장문 서술 금지. ' +
    '대표님이 문서·표·상세 산출물을 명시적으로 요청할 때만 길게 써라.',
    '4. 보고는 숫자와 결과 중심(00 보고 원칙). "열심히 하겠습니다" 금지, "리드 47명·초안 8건"처럼. ' +
    '실데이터가 없으면 지어내지 말고 양식만 보여줘라.',
    '',
    '=== 정기보고·영업일기 체계 ===',
    '- 총괄(제니야)은 매일 두 번 대표님께 정기보고한다: 오전 6시 모닝브리핑(밤사이 각 팀이 한 일 취합), ' +
    '오후 6시 저녁보고(오전~오후 일 취합).',
    '- 대표님이 "모닝브리핑" 또는 "저녁보고"라고 하면, 총괄은 즉시 그 형식으로 취합 보고하라. ' +
    '이때는 보고 산출물이므로 01 문서의 브리핑 형식(어제 성과/오늘 우선순위/주의/대기 승인)을 써도 된다.',
    '- 영업일기: 모든 에이전트는 일을 마칠 때마다 "영업일기"를 남긴다. 형식: 무엇을 했나 / 왜 했나 / ' +
    '결과(숫자·파일·링크) / 다음 할 일. 총괄의 정기보고는 이 영업일기들의 취합이다.',
    '- ★ 정직 원칙: 영업일기는 서버에 자동 저장되고 있고, 시스템이 "실시간 현황" 또는 "영업일기 실데이터" ' +
    '섹션으로 너에게 보여준다. 보고는 오직 그 기록만 근거로 하라. 기록에 없는 일을 지어내지 말고, ' +
    '기록이 비어 있으면 "해당 기간 기록 없음"이라고 그대로 보고하라. "열심히 했습니다"식 거짓 보고 절대 금지. ' +
    '(외부 실데이터 연결 — CRM 시트·SNS 등 — 은 아직 전이라, 외부 숫자가 필요한 질문엔 그렇게 답하라)',
    '',
    '=== 현재 작업 맥락 ===',
    `지금 대표님은 "${projectName || '일반'}" 프로젝트 화면에서 너(${a.name})와 대화 중이다. ` +
    `위 프로젝트 정의에서 이 프로젝트의 목적·대상·메시지를 확인하고, 반드시 그 기준으로 답하라.`
  ].join('\n');
}

// API 키 확인 — 금고가 비어 있으면 시작하면서 바로 알려준다
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠️  금고(.env)에 ANTHROPIC_API_KEY가 비어 있습니다. 키를 넣기 전까지 /chat은 안내 메시지만 반환합니다.');
}

const anthropic = new Anthropic();        // 키는 환경변수에서 자동으로 읽는다
const app = express();
app.use(cors());                          // 화면(파일로 연 제니야.html)에서의 요청 허용
app.use(express.json());

// ── 제니야 화면 내보내기 ───────────────────────────────────
// 배포(Render)에서는 이 서버 하나가 화면+두뇌를 모두 담당한다.
// 주소(/)로 들어오면 제니야.html을 보여준다. (다른 폴더는 노출하지 않음)
app.get('/', (req, res) => {
  // 캐시 금지 — 폰·브라우저가 항상 최신 화면을 받게 한다 (수정이 즉시 반영)
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', '제니야.html'));
});

// ── 살아있는지 확인용 창구 ─────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, name: 'jenya-server', message: '제니야 중계 서버가 켜져 있습니다.' });
});

// ── /chat 창구: 말씀을 받아 클로드에 중계 ──────────────────
// 받는 것: { message: "대표님 말씀", project: "부트캠프", agent: "고객발굴" }
// 주는 것: { reply: "에이전트의 답" }
app.post('/chat', async (req, res) => {
  try {
    const { message, project, agentId } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message(말씀 내용)가 필요합니다.' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: '서버 금고(.env)에 API 키가 아직 없습니다. 키를 넣고 서버를 다시 켜 주세요.' });
    }

    // ── 진짜 정체성: 공통 규칙(00) + 에이전트 전용 문서 + 프로젝트 맥락 ──
    let system = buildSystemPrompt(agentId, project);

    // 보고 요청(모닝브리핑/저녁보고/현황/대시보드)이면 취합용 일기 전체를,
    // 평상시 대화면 실시간 현황(최근 48시간 일기)을 항상 붙인다 → 언제 물어도 즉답
    const isBriefing = (!agentId || agentId === 'zenya') && /모닝브리핑|저녁보고|현황|대시보드/.test(message);
    if (isBriefing) {
      system += '\n\n=== 영업일기 실데이터 (취합 대상 — 오직 이 기록만 근거로 팀별 숫자 요약을 보고하라) ===\n'
              + diaryDigest(message);
    } else {
      system = withLiveStatus(system, agentId);
    }

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },     // 어려운 질문이면 스스로 깊이 생각한다
      system: system,
      messages: [{ role: 'user', content: message }],
    });

    // 답변에서 글 부분만 추려 화면으로 보낸다
    const reply = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    // 저장: 답변은 대화기록에, 에이전트의 활동은 영업일기에 (브리핑 자체는 일기에서 제외)
    const a = AGENT_DOCS[agentId] || AGENT_DOCS.zenya;
    const ts = new Date().toISOString();
    appendHistory({ ts, who: agentId || 'zenya', text: reply, project: project || '일반' });
    if (!isBriefing) {
      appendDiary({ ts, agentId: agentId || 'zenya', agentName: a.name, project: project || '일반', kind: 'chat', entry: reply });
    }

    res.json({ reply });
  } catch (err) {
    console.error('[/chat 오류]', err.message);
    res.status(500).json({ error: '중계 중 문제가 생겼습니다: ' + err.message });
  }
});

// ── /meeting/speak 창구: 회의 발언 한 개를 만든다 ──────────
// 화면(제니야.html)이 회의를 지휘하며 발언자마다 이 창구를 한 번씩 부른다.
// 받는 것: { topic: 주제, project: 프로젝트명, agentId: 발언자,
//           phase: 'round1'(첫 의견) | 'round2'(자유 반응) | 'summary'(의장 종합),
//           transcript: [{agent: 이름, text: 발언}, ...] 지금까지의 회의록 }
// 주는 것: { reply: 발언 내용 }
const PHASE_GUIDE = {
  round1:
    '지금은 멀티 에이전트 회의 1라운드(첫 의견)다. 회의 주제에 대해 너의 전문 관점에서 핵심 의견을 말하라. ' +
    '반드시 2~4문장, 실제 회의에서 입으로 말하듯 구어체로. 마크다운·표·목록·헤더 절대 금지. ' +
    '이미 발언한 팀장과 겹치는 얘기는 피하고, 너만 볼 수 있는 한 가지를 던져라. 다른 팀 의견 대행 금지.',
  round2:
    '지금은 회의 2라운드(자유 반응)다. 회의록에서 다른 팀장의 발언을 하나 이상 골라, 그 팀장 이름을 ' +
    '직접 부르며 동의·반박·추가·질문하라. 무조건 동의하지 말고 네 관점에서 걸리면 분명히 반박하라. ' +
    '반드시 2~4문장 구어체. 마크다운·표·목록 절대 금지.',
  summary:
    '너는 이 회의의 의장(총괄 제니야)이다. 이 종합 단계에서만 다른 팀장의 발언 인용이 허용된다. ' +
    '합의된 것, 엇갈린 쟁점과 너의 판단, 결론, 대표님 승인이 필요한 다음 액션을 보고하라. ' +
    '표·목록·헤더 없이 짧은 문단의 대화체로, 10문장 이내.'
};

app.post('/meeting/speak', async (req, res) => {
  try {
    const { topic, project, agentId, phase, transcript } = req.body || {};

    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'topic(회의 주제)이 필요합니다.' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: '서버 금고(.env)에 API 키가 없습니다.' });
    }

    // 지금까지의 회의록을 글로 풀어 발언자에게 보여준다
    const minutes = (Array.isArray(transcript) && transcript.length)
      ? transcript.map((t) => `[${t.agent}]\n${t.text}`).join('\n\n')
      : '(아직 발언 없음 — 네가 첫 발언자다)';

    // 정체성(공통규칙+프로젝트정의+전용문서+맥락) + 자기 활동기록 위에 회의 역할을 얹는다
    const system = withLiveStatus(buildSystemPrompt(agentId, project), agentId)
      + '\n\n=== 회의 모드 ===\n'
      + (PHASE_GUIDE[phase] || PHASE_GUIDE.round1);

    const userMsg =
      `회의 주제: ${topic}\n\n` +
      `=== 지금까지의 회의록 ===\n${minutes}\n\n` +
      `이제 너의 발언 차례다. 발언만 출력하라(이름표·인사말 없이 본론부터).`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: system,
      messages: [{ role: 'user', content: userMsg }],
    });

    const reply = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    // 저장: 회의 발언도 대화기록 + 영업일기에 남는다
    const speaker = AGENT_DOCS[agentId] || AGENT_DOCS.zenya;
    const ts = new Date().toISOString();
    appendHistory({ ts, who: agentId || 'zenya', text: reply, project: project || '일반' });
    appendDiary({ ts, agentId: agentId || 'zenya', agentName: speaker.name, project: project || '일반', kind: 'meeting', entry: `(회의 발언/${phase}) ${reply}` });

    res.json({ reply });
  } catch (err) {
    console.error('[/meeting/speak 오류]', err.message);
    res.status(500).json({ error: '발언 생성 중 문제: ' + err.message });
  }
});

// ── 음성 호명 라우팅 보조 ───────────────────────────────────
// 통화별로 "지금 누구와 대화 중인지"를 기억한다 (통화가 끝나면 자연 소멸)
const CALL_AGENTS = new Map();   // callId → { agentId, ts }

// 원칙(2026-06-08 대표님 지시): 팀장을 "이름으로 직접 부를 때"만 전환한다.
// 주제만 말하거나("마케팅 어떻게 할까") 3인칭으로 언급하면("마케팅팀장이 한 일") 절대 바뀌지 않는다.
//
// 직접 호명으로 인정하는 신호 3가지:
//   ① 말이 "○○팀장(님)"으로 끝남 — "마케팅팀장!", "개발팀장님?"
//   ② 이름 바로 뒤에 부르는 말 — "○○팀장 불러줘 / 나와봐 / 바꿔줘 / 연결해 / 대답해"
//   ③ 문장 첫머리에서 부름 — "마케팅팀장, 쇼츠 어떻게 됐어?"
// 이름 뒤에 조사(이/가/은/는/한테/에게…)가 붙으면 3인칭 언급 → 호명 아님.
const CALL_VERB_RE = /^[\s,~!?.]*(좀\s*|한번\s*|잠깐\s*)?(불러|나와|나오|바꿔|바꾸|연결|호출|대답|답해|부탁)/;
const REF_PARTICLE_RE = /^(이|가|은|는|을|를|의|도|만|와|과|랑|하고|한테|에게|께서|께|보다|처럼|부터|까지|라는|이라)/;
const LEAD_FILLER_RE = /^(어|음|자|그|그럼|이제|네|좋아|오케이|그래|이번엔|이번에는|다음은|다음)[\s,]+/;

function isDirectCall(text, nameRe) {
  const re = new RegExp(nameRe.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    let after = text.slice(m.index + m[0].length);
    after = after.replace(/^(님|이?요)/, '');               // "팀장님/팀장요" 허용
    if (REF_PARTICLE_RE.test(after)) continue;              // 조사가 붙음 → 3인칭 언급, 호명 아님
    if (after.replace(/[\s,~!?."']/g, '') === '') return true;   // ① 이름으로 말이 끝남
    if (CALL_VERB_RE.test(after)) return true;                    // ② 바로 뒤에 부르는 말
    const before = text.slice(0, m.index).replace(LEAD_FILLER_RE, '').trim();
    if (before === '' && /^[\s,!?]/.test(after)) return true;     // ③ 문장 첫머리 호명
  }
  return false;
}

// 대표님 말에서 "직접 호명"만 찾아낸다. 'ALL'=전체 호출, null=호명 없음(현재 에이전트 유지)
function detectVoiceTarget(text) {
  if (!text) return null;
  // 전체 릴레이: "다같이/모든 팀/전체"가 부르는 말(보고해·나와·모여·회의…)과 함께일 때만
  if (/(다\s?같이|모든\s?팀|전체(?!적)|전\s?팀|전원)/.test(text)
      && /(불러|나와|나오|모여|모이|보고|회의|대답|답해|호출|호명)/.test(text)) return 'ALL';
  const patterns = [
    ['lead',    /발굴\s?팀장/],
    ['care',    /관리\s?팀장/],
    ['mkt',     /마케팅\s?팀장/],
    ['design',  /디자인\s?팀장/],
    ['dev',     /개발\s?팀장/],
    ['legal',   /법무\s?팀장|보안\s?팀장/],
    ['finance', /재무\s?팀장|매출\s?팀장/],
    ['zenya',   /제니야|총괄(?!적)/],
  ];
  for (const [id, re] of patterns) if (isDirectCall(text, re)) return id;
  return null;
}

// 음성 공통 지침
const VOICE_RULES =
  '\n\n=== 음성 통화 모드 ===\n'
  + '지금은 대표님과 음성 통화 중이다. 최종 답만 1~3문장으로 아주 짧게, 귀로 듣기 좋은 구어체로 말하라. '
  + '마크다운·기호·이모지·목록·괄호 절대 금지. 숫자는 읽기 쉽게.';

// 전체 호출 모드: 7명 팀장이 차례로 1~2문장씩 릴레이 보고 (음성판 @전체)
function buildAllVoicePrompt(project) {
  const docs = ['lead', 'care', 'mkt', 'design', 'dev', 'legal', 'finance']
    .map((id) => `[${AGENT_DOCS[id].name}]\n${AGENT_DOCS[id].doc}`).join('\n\n');
  return COMMON_RULES
    + '\n\n=== 프로젝트 정의 ===\n' + PROJECT_DEFS
    + '\n\n=== 전체 호출 모드 (음성판 @전체 — 정해진 보고 형식이므로 대행 금지의 예외) ===\n'
    + '대표님이 전체 팀장을 호출했다. 아래 7명 팀장이 발굴→관리→마케팅→디자인→개발→법무보안→매출재무 순서로, '
    + '각자 "○○팀장입니다"라고 자기를 밝히고 1~2문장씩 구어체로 답하는 릴레이 보고를 만들어라. '
    + '각 팀장은 자기 문서의 말투·관점을 따른다.\n\n' + docs
    + '\n\n=== 최근 영업일기 (전 팀) ===\n' + recentDiary('zenya')
    + `\n\n현재 프로젝트: ${project}`
    + VOICE_RULES;
}

// ── /vapi 창구: 음성 통화의 두뇌 ────────────────────────────
// Vapi(귀·입)가 대표님 말씀(글로 변환됨)을 OpenAI 형식으로 보내오면,
// 텍스트와 똑같은 정체성(공통규칙+에이전트 문서+프로젝트 정의)으로
// 클로드 답을 만들어 실시간 스트리밍으로 돌려준다. Vapi가 그걸 음성으로 읽는다.
// (경로 3개 등록: Vapi 설정 방식에 따라 어느 쪽으로 와도 받게)
app.post(['/vapi', '/vapi/chat/completions', '/vapi/chat/completions/chat/completions'], async (req, res) => {
  try {
    const body = req.body || {};
    // Vapi 요청 도착 로그 — Render Logs 화면에서 "🎙️ Vapi 요청"이 보이면 연결 성공
    console.log(`🎙️ Vapi 요청 도착 — ${new Date().toLocaleString('ko-KR')} / 메시지 ${Array.isArray(body.messages) ? body.messages.length : 0}개`);
    const inMsgs = Array.isArray(body.messages) ? body.messages : [];

    // Vapi 대시보드 시스템 프롬프트에 심어둔 마커에서 시작 맥락을 읽는다
    const sysText = inMsgs.filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    const project = (sysText.match(/\[PROJECT:([^\]]*)\]/) || [])[1] || '일반';
    let markerAgent = (sysText.match(/\[AGENT:([^\]]*)\]/) || [])[1] || 'zenya';
    if (!AGENT_DOCS[markerAgent]) markerAgent = 'zenya';

    // 대화 이력 정리: user/assistant만, 클로드 규칙(첫 메시지=user)에 맞게
    let conv = inMsgs
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));
    while (conv.length && conv[0].role === 'assistant') conv.shift();
    if (!conv.length) conv = [{ role: 'user', content: '(인사해줘)' }];

    // ── 음성 호명 라우팅: "○○팀장 불러줘"처럼 직접 부를 때만 전환 (주제 언급으론 안 바뀜) ──
    const callId = (body.call && body.call.id) || 'default';
    if (CALL_AGENTS.size > 200) {   // 오래된 통화 기억 청소
      for (const [k, v] of CALL_AGENTS) if (Date.now() - v.ts > 2 * 3600 * 1000) CALL_AGENTS.delete(k);
    }
    const lastUserText = ([...conv].reverse().find((m) => m.role === 'user') || {}).content || '';
    const target = detectVoiceTarget(lastUserText);
    const allMode = (target === 'ALL');
    let agentId = (target && !allMode) ? target
                : (CALL_AGENTS.get(callId) || {}).agentId || markerAgent;
    const prevAgent = (CALL_AGENTS.get(callId) || {}).agentId || markerAgent;
    const switched = (target && !allMode && target !== prevAgent);
    CALL_AGENTS.set(callId, { agentId, ts: Date.now() });
    if (target) console.log(`🎙️ 호명 감지: ${allMode ? '전체 호출' : AGENT_DOCS[agentId].name} (통화 ${callId.slice(0, 8)})`);

    // 시스템 프롬프트: 전체 호출이면 릴레이 보고, 아니면 현재 에이전트 정체성
    let system;
    if (allMode) {
      system = buildAllVoicePrompt(project);
    } else {
      system = withLiveStatus(buildSystemPrompt(agentId, project), agentId) + VOICE_RULES;
      if (switched) {
        system += '\n방금 대표님이 너를 호명해 대화 상대가 너로 바뀌었다. 첫 마디에 "네 대표님, ○○팀장입니다"처럼 짧게 자기를 밝히고 답하라.';
      }
    }

    // OpenAI 호환 SSE 스트리밍 응답
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const chunkId = 'chatcmpl-' + Date.now();
    const send = (delta, finish) => {
      res.write('data: ' + JSON.stringify({
        id: chunkId, object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000), model: 'zenya',
        choices: [{ index: 0, delta: delta, finish_reason: finish || null }],
      }) + '\n\n');
    };

    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 1000,            // 음성은 짧게 — 속도 우선
      system: system,
      messages: conv,
    });
    stream.on('text', (t) => send({ content: t }));
    const finalMsg = await stream.finalMessage();
    send({}, 'stop');
    res.write('data: [DONE]\n\n');
    res.end();

    // 저장: 음성 대화도 대화기록 + 영업일기에 (화면은 표시만, 저장은 여기서)
    // 전체 호출 릴레이 보고는 총괄(zenya) 이름으로 기록한다
    const saveAs = allMode ? 'zenya' : agentId;
    const reply = finalMsg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const lastUser = [...conv].reverse().find((m) => m.role === 'user');
    const sp = AGENT_DOCS[saveAs];
    const ts = new Date().toISOString();
    if (lastUser && lastUser.content !== '(인사해줘)') {
      appendHistory({ ts, who: 'u', text: '🎤 ' + lastUser.content, project });
    }
    appendHistory({ ts, who: saveAs, text: reply, project });
    appendDiary({ ts, agentId: saveAs, agentName: sp.name, project, kind: 'voice', entry: reply });
  } catch (err) {
    console.error('[/vapi 오류]', err.message);
    try { res.status(500).json({ error: err.message }); } catch (e) {}
  }
});

// ── /dashboard 창구: 팀별 활동 숫자 (화면 상단 대시보드용) ──
// 영업일기에서 팀별로 "오늘 건수 / 48시간 건수 / 마지막 활동 시각"을 계산해 준다.
// 실데이터(시트·SNS)가 연결되기 전까지는 활동 건수가 가장 정직한 숫자다.
app.get('/dashboard', (req, res) => {
  const now = Date.now();
  const todayStr = new Date().toDateString();
  const teams = Object.keys(AGENT_DOCS).map((id) => {
    const mine = DIARY.filter((d) => d.agentId === id);
    return {
      id,
      name: AGENT_DOCS[id].name,
      today: mine.filter((d) => new Date(d.ts).toDateString() === todayStr).length,
      h48:   mine.filter((d) => now - new Date(d.ts).getTime() <= 48 * 3600 * 1000).length,
      total: mine.length,
      last:  mine.length ? mine[mine.length - 1].ts : null,
    };
  });
  res.json({ teams });
});

// ── 대화기록 창구: 불러오기 + 대표님 말씀 저장 ──────────────
// GET  /history → 저장된 대화 전체 (화면이 열릴 때 불러간다)
// POST /history → 말풍선 하나 저장 (화면이 대표님 말씀을 보낼 때 사용)
app.get('/history', (req, res) => {
  res.json({ messages: HISTORY });
});

app.post('/history', (req, res) => {
  const { who, text, project } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text가 필요합니다.' });
  }
  appendHistory({ ts: new Date().toISOString(), who: who || 'u', text, project: project || '일반' });
  res.json({ ok: true });
});

// ============================================================
// 고객관리 손 — 첫 번째 실제 도구 (2026-06-08)
// 흐름: 구글폼 신청 → 리드 시트 적재(구글 기본 기능)
//      → /care/new   신규 신청자 선별 (발송상태가 빈 사람)
//      → /care/draft 감사+강의안내 문자 초안 생성 (고객관리 에이전트)
//      → /care/approve 대표님 승인 → Solapi 발송 → 시트에 발송완료 기록
// 원칙: 발송은 반드시 대표님 승인 후(휴먼인더루프).
//      고객 개인정보는 대표님 구글시트에만 — 서버에는 발송대기 목록만 임시 보관.
// ============================================================
const { google } = require('googleapis');
const { SolapiMessageService } = require('solapi');

// 시트 주소(ID)는 비밀이 아니라서 코드에 기본값으로 둔다 (환경변수로 바꿀 수도 있음)
const LEAD_SHEET_ID  = process.env.LEAD_SHEET_ID || '1L15eUgHO81MN5rTYj5351a5RbFGptxNSMnTzMQLDRmk';
const LEAD_SHEET_TAB = process.env.LEAD_SHEET_TAB || '';   // 비우면 "응답" 탭 → 첫 탭 순서로 자동 선택
const SOLAPI_SENDER  = (process.env.SOLAPI_SENDER || '').replace(/\D/g, '');  // 발신번호 (Solapi에 등록된 번호)
// 강의 수강료 결제 링크 (페이플) — 안내문의 수강료 다음 줄에 들어간다
const CARE_PAY_LINK  = process.env.CARE_PAY_LINK || 'https://link.payple.kr/NzcxOjc3NTQwNTcxNzMzMTMy';

// 구글 열쇠: ① server/google-key.json 파일(로컬) ② GOOGLE_SERVICE_ACCOUNT_JSON 환경변수(Render)
function googleCreds() {
  const keyFile = path.join(__dirname, 'google-key.json');
  try {
    if (fs.existsSync(keyFile)) return JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch (e) { console.warn('⚠️ 구글 열쇠를 읽지 못했습니다:', e.message); }
  return null;
}
function sheetsClient() {
  const creds = googleCreds();
  if (!creds) return null;
  // ※ 옛 방식(new google.auth.JWT(이메일, null, 키, …))은 최신 googleapis에서 키가 안 실려
  //   "unregistered callers" 거부가 난다. 반드시 GoogleAuth 옵션 객체 방식으로.
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Solapi(문자/카톡) — 키가 있을 때만 켜진다
const solapi = (process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET)
  ? new SolapiMessageService(process.env.SOLAPI_API_KEY, process.env.SOLAPI_API_SECRET)
  : null;

// 전화번호 정리: "010-1234-5678" → "01012345678" (한국 휴대폰만 인정)
function cleanPhone(v) {
  const p = String(v || '').replace(/\D/g, '');
  return /^01[016789]\d{7,8}$/.test(p) ? p : null;
}
// 열 번호(0부터) → 시트 열 글자 (0→A, 25→Z, 26→AA)
function colLetter(n) {
  let s = '';
  for (n = n + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// 시트에서 신청자 명단을 읽는다.
// 머리줄(1행)에서 이름·연락처·발송상태 열을 자동으로 찾고, 발송상태 열이 없으면 만들어 준다.
async function readApplicants() {
  const sheets = sheetsClient();
  if (!sheets) throw new Error('구글 열쇠가 아직 없습니다. (server/google-key.json 또는 GOOGLE_SERVICE_ACCOUNT_JSON)');

  // 탭 고르기: 지정값 → "응답"이 들어간 탭(구글폼 응답) → 첫 탭
  const meta = await sheets.spreadsheets.get({ spreadsheetId: LEAD_SHEET_ID });
  const tabs = meta.data.sheets.map((s) => s.properties.title);
  const tab = LEAD_SHEET_TAB && tabs.includes(LEAD_SHEET_TAB) ? LEAD_SHEET_TAB
            : tabs.find((t) => t.includes('응답')) || tabs[0];
  const range = `'${tab.replace(/'/g, "''")}'!A1:ZZ`;

  const got = await sheets.spreadsheets.values.get({ spreadsheetId: LEAD_SHEET_ID, range });
  const rows = got.data.values || [];
  if (!rows.length) return { tab, header: [], applicants: [], statusCol: -1, sheets };

  const header = rows[0].map((h) => String(h || '').trim());
  const findCol = (words) => header.findIndex((h) => words.some((w) => h.includes(w)));
  const nameCol  = findCol(['이름', '성함', '성명']);
  const phoneCol = findCol(['연락처', '전화', '휴대폰', '핸드폰']);
  let statusCol  = findCol(['발송상태']);
  if (phoneCol < 0) throw new Error(`시트 "${tab}" 1행에서 연락처 열을 못 찾았습니다. (머리줄에 "연락처" 또는 "전화번호"가 필요)`);

  // 발송상태 열이 없으면 머리줄 끝에 만들어 준다
  if (statusCol < 0) {
    statusCol = header.length;
    await sheets.spreadsheets.values.update({
      spreadsheetId: LEAD_SHEET_ID,
      range: `'${tab.replace(/'/g, "''")}'!${colLetter(statusCol)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['발송상태']] },
    });
  }

  const applicants = [];
  for (let i = 1; i < rows.length; i++) {
    const phone = cleanPhone(rows[i][phoneCol]);
    if (!phone) continue;                       // 연락처 없는 줄은 건너뜀
    applicants.push({
      row: i + 1,                               // 시트의 실제 행 번호
      name: String((nameCol >= 0 && rows[i][nameCol]) || '').trim() || '고객',
      phone,
      status: String(rows[i][statusCol] || '').trim(),
    });
  }
  return { tab, header, applicants, statusCol, sheets };
}

// 발송 대기 명단 (server/data/발송대기.json) — 승인 전 초안 보관소
let PENDING = loadJson('발송대기.json');   // [{id, name, phone, text, ts, status}]
const savePending = () => saveJson('발송대기.json', PENDING);

// ── /care/status: 손 상태 점검 (뭐가 연결됐고 뭐가 빠졌는지) ──
app.get('/care/status', async (req, res) => {
  const out = {
    googleKey: !!googleCreds(),
    solapi: !!solapi,
    sender: !!SOLAPI_SENDER,
    sheet: null, newCount: 0,
    pendingCount: PENDING.filter((p) => p.status === '대기').length,
  };
  if (out.googleKey) {
    try {
      const { tab, applicants } = await readApplicants();
      out.sheet = tab;
      out.newCount = applicants.filter((a) => !a.status).length;
    } catch (e) { out.sheetError = e.message; }
  }
  res.json(out);
});

// ── /care/new: 신규 신청자(발송상태가 빈 사람) 명단 ──────────
app.get('/care/new', async (req, res) => {
  console.log('📨 /care/new 요청 도착 —', new Date().toLocaleString('ko-KR'));
  try {
    const { tab, applicants } = await readApplicants();
    console.log(`📨 /care/new 결과 — 탭 "${tab}", 연락처 있는 ${applicants.length}명, 신규 ${applicants.filter((a) => !a.status).length}명`);
    const fresh = applicants.filter((a) => !a.status);
    res.json({ tab, total: applicants.length, fresh });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /care/draft: 신규 신청자용 안내문 초안 생성 (승인 대기로 적재) ──
// 받는 것: { project, guide } — guide = 대표님이 안내문에 꼭 넣으라는 내용(강의 일시·링크 등)
app.post('/care/draft', async (req, res) => {
  console.log('📨 /care/draft 요청 도착 —', new Date().toLocaleString('ko-KR'));
  try {
    const { project, guide } = req.body || {};
    const { applicants } = await readApplicants();
    const queued = new Set(PENDING.filter((p) => p.status === '대기').map((p) => p.phone));
    const fresh = applicants.filter((a) => !a.status && !queued.has(a.phone));
    if (!fresh.length) return res.json({ template: null, added: 0, pending: PENDING.filter((p) => p.status === '대기') });

    // 고객관리 에이전트가 안내문 틀을 쓴다 ({이름} 자리에 각자 이름이 들어감)
    const system = buildSystemPrompt('care', project || '머니트레이닝랩');
    const ask =
      '강의 신청자에게 보낼 "감사 + 강의 안내" 문자 한 통을 써라.\n'
      + '- 받는 사람 이름 자리는 반드시 {이름} 으로 표기 (예: "{이름}님, 신청 감사합니다")\n'
      + '- 이번 강의: 10억 목돈마련 절대법칙 (비대면 강의)\n'
      + (guide ? `- 대표님이 꼭 넣으라는 내용: ${guide}\n` : '- 일시·접속링크 등 확정 정보가 없으면 "확정되는 대로 다시 안내드립니다"로 처리\n')
      + `- 수강료 안내 바로 다음 줄에 결제 안내 한 줄을 넣어라: "결제하기: ${CARE_PAY_LINK}" (링크 주소는 한 글자도 바꾸지 말 것)\n`
      + '- 문자이므로 마크다운·이모지 없이 일반 글로, 300자 이내, 따뜻하고 신뢰감 있게\n'
      + '- 발신: 오원트금융연구소 오상열 대표\n'
      + '- 문자 본문만 출력 (설명·따옴표 없이)';
    const r = await anthropic.messages.create({
      model: MODEL, max_tokens: 1000, system,
      messages: [{ role: 'user', content: ask }],
    });
    const template = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

    const ts = new Date().toISOString();
    for (const a of fresh) {
      PENDING.push({
        id: 'p' + Date.now() + '_' + a.row,
        name: a.name, phone: a.phone,
        text: template.replace(/\{이름\}/g, a.name),
        ts, status: '대기',
      });
    }
    savePending();
    appendDiary({ ts, agentId: 'care', agentName: '고객관리', project: project || '머니트레이닝랩', kind: 'hand',
      entry: `[손] 신규 신청자 ${fresh.length}명 선별, 안내문 초안 ${fresh.length}건 생성 — 대표님 승인 대기` });

    res.json({ template, added: fresh.length, pending: PENDING.filter((p) => p.status === '대기') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /care/pending: 승인 대기 목록 ────────────────────────────
app.get('/care/pending', (req, res) => {
  res.json({ pending: PENDING.filter((p) => p.status === '대기') });
});

// ── /care/approve: 대표님 승인 → Solapi 발송 → 시트에 기록 ──
// 받는 것: { ids: ['p123_2', ...] }  (휴먼인더루프 — 이 창구 없이는 절대 발송 안 됨)
app.post('/care/approve', async (req, res) => {
  console.log('📨 /care/approve 요청 도착 —', new Date().toLocaleString('ko-KR'), '/ 항목', ((req.body || {}).ids || []).length, '건');
  try {
    const ids = (req.body || {}).ids;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids(승인할 항목)가 필요합니다.' });
    if (!solapi) return res.status(503).json({ error: 'Solapi 키가 아직 없습니다. (.env의 SOLAPI_API_KEY/SOLAPI_API_SECRET)' });
    if (!SOLAPI_SENDER) return res.status(503).json({ error: '발신번호가 아직 없습니다. (.env의 SOLAPI_SENDER)' });

    const items = PENDING.filter((p) => ids.includes(p.id) && p.status === '대기');
    if (!items.length) return res.status(400).json({ error: '승인할 대기 항목이 없습니다.' });

    // 시트를 다시 읽어 행·발송상태 열 위치를 정확히 잡는다 (그 사이 줄이 늘었을 수 있음)
    const { tab, applicants, statusCol, sheets } = await readApplicants();
    const stamp = new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const results = [];
    for (const item of items) {
      try {
        await solapi.send({ to: item.phone, from: SOLAPI_SENDER, text: item.text });
        item.status = '발송완료 ' + stamp;
        // 시트의 같은 전화번호 행에 발송완료 도장
        const hit = applicants.find((a) => a.phone === item.phone);
        if (hit) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: LEAD_SHEET_ID,
            range: `'${tab.replace(/'/g, "''")}'!${colLetter(statusCol)}${hit.row}`,
            valueInputOption: 'RAW',
            requestBody: { values: [['발송완료 ' + stamp]] },
          });
        }
        results.push({ id: item.id, name: item.name, ok: true });
      } catch (e) {
        item.status = '실패: ' + e.message;
        results.push({ id: item.id, name: item.name, ok: false, error: e.message });
      }
    }
    savePending();

    const okN = results.filter((r) => r.ok).length;
    const failN = results.length - okN;
    appendDiary({
      ts: new Date().toISOString(), agentId: 'care', agentName: '고객관리', project: '머니트레이닝랩', kind: 'hand',
      entry: `[손] 대표님 승인으로 강의안내 문자 발송 ${okN}건 완료${failN ? `, 실패 ${failN}건` : ''} — 시트에 발송완료 기록`,
    });
    res.json({ results, sent: okN, failed: failN });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /care/reject: 보류(대기 목록에서 빼기 — 발송 안 함) ──────
app.post('/care/reject', (req, res) => {
  const ids = (req.body || {}).ids;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids가 필요합니다.' });
  let n = 0;
  for (const p of PENDING) if (ids.includes(p.id) && p.status === '대기') { p.status = '보류'; n++; }
  savePending();
  res.json({ rejected: n });
});

// ── 서버 켜기 ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ 제니야 중계 서버 가동 — http://localhost:${PORT}`);
  console.log(`📨 고객관리 손 — 구글열쇠 ${googleCreds() ? 'O' : 'X'} / Solapi ${solapi ? 'O' : 'X'} / 발신번호 ${SOLAPI_SENDER ? 'O' : 'X'}`);
});
