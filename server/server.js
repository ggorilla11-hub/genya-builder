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
    '(대행의 유일한 예외: 총괄이 회의 종합 단계에서 회의록을 인용할 때)',
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
    '- ★ 정직 원칙: 영업일기 실제 저장은 아직 연결 전이다. 저장된 일기가 없는데 한 일을 지어내지 마라. ' +
    '데이터가 없으면 "아직 영업일기 저장이 연결되지 않아 보고할 실데이터가 없습니다"라고 밝히고, ' +
    '보고 형식의 틀만 보여줘라. "열심히 했습니다"식 거짓 보고 절대 금지.',
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

    // 총괄에게 모닝브리핑/저녁보고를 시키면 영업일기 실데이터를 함께 준다
    const isBriefing = (!agentId || agentId === 'zenya') && /모닝브리핑|저녁보고/.test(message);
    if (isBriefing) {
      system += '\n\n=== 영업일기 실데이터 (취합 대상 — 오직 이 기록만 근거로 숫자 보고하라) ===\n'
              + diaryDigest(message);
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

    // 정체성(공통규칙+프로젝트정의+전용문서+맥락) 위에 회의 역할을 얹는다
    const system = buildSystemPrompt(agentId, project)
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

    // Vapi 대시보드 시스템 프롬프트에 심어둔 마커에서 현재 맥락을 읽는다
    const sysText = inMsgs.filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    const project = (sysText.match(/\[PROJECT:([^\]]*)\]/) || [])[1] || '일반';
    let agentId = (sysText.match(/\[AGENT:([^\]]*)\]/) || [])[1] || 'zenya';
    if (!AGENT_DOCS[agentId]) agentId = 'zenya';

    // 대화 이력 정리: user/assistant만, 클로드 규칙(첫 메시지=user)에 맞게
    let conv = inMsgs
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));
    while (conv.length && conv[0].role === 'assistant') conv.shift();
    if (!conv.length) conv = [{ role: 'user', content: '(인사해줘)' }];

    const system = buildSystemPrompt(agentId, project)
      + '\n\n=== 음성 통화 모드 ===\n'
      + '지금은 대표님과 음성 통화 중이다. 최종 답만 1~3문장으로 아주 짧게, 귀로 듣기 좋은 구어체로 말하라. '
      + '마크다운·기호·이모지·목록·괄호 절대 금지. 숫자는 읽기 쉽게.';

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
    const reply = finalMsg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const lastUser = [...conv].reverse().find((m) => m.role === 'user');
    const sp = AGENT_DOCS[agentId];
    const ts = new Date().toISOString();
    if (lastUser && lastUser.content !== '(인사해줘)') {
      appendHistory({ ts, who: 'u', text: '🎤 ' + lastUser.content, project });
    }
    appendHistory({ ts, who: agentId, text: reply, project });
    appendDiary({ ts, agentId, agentName: sp.name, project, kind: 'voice', entry: reply });
  } catch (err) {
    console.error('[/vapi 오류]', err.message);
    try { res.status(500).json({ error: err.message }); } catch (e) {}
  }
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

// ── 서버 켜기 ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ 제니야 중계 서버 가동 — http://localhost:${PORT}`);
});
