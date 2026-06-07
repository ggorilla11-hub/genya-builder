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

// ── 알림함 (대표님이 꼭 봐야 할 것 모음) ──────────────────────
// 한곳에 모이는 것: 신규 신청자·결제·수신거부·발송 완료·중요 보고.
//   kind: apply(신규신청자) pay(결제) optout(수신거부) sent(발송완료) report(중요보고)
// 저장: server/data/알림.json — [{id, ts, kind, title, body, agentId, read}]
let NOTIFY = loadJson('알림.json');
const saveNotify = () => saveJson('알림.json', NOTIFY);
// 이미 알림을 띄운 신청자 전화번호 (같은 사람에 두 번 알리지 않기) — 재시작해도 유지
let NOTIFY_SEEN = loadJson('알림_본신청자.json');
const saveSeen = () => saveJson('알림_본신청자.json', NOTIFY_SEEN);

// 알림 하나를 알림함에 올린다 (화면이 /notify로 가져가 소리·빨간점으로 알린다)
function pushNotify(n) {
  const item = {
    id: 'n' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    ts: new Date().toISOString(),
    kind: n.kind || 'report',
    title: n.title || '알림',
    body: n.body || '',
    agentId: n.agentId || 'zenya',
    read: false,
  };
  NOTIFY.push(item);
  if (NOTIFY.length > 500) NOTIFY = NOTIFY.slice(-500);   // 너무 쌓이면 오래된 것 정리
  saveNotify();
  return item;
}

// 시트에서 읽은 사람들 중 "처음 보는 신규 신청자"가 있으면 알림 하나로 묶어 띄운다.
// (앱을 열 때마다 /care/status가 시트를 읽으므로, 새 신청이 들어오면 자동으로 알림이 생긴다)
function notifyNewApplicants(applicants, label) {
  const fresh = (applicants || []).filter((a) => !a.status && a.phone);
  const seen = new Set(NOTIFY_SEEN);
  const newOnes = fresh.filter((a) => !seen.has(a.phone));
  if (!newOnes.length) return 0;
  newOnes.forEach((a) => seen.add(a.phone));
  NOTIFY_SEEN = [...seen].slice(-5000);                   // 메모리 보호: 최근 5천 명만 기억
  saveSeen();
  const names = newOnes.map((a) => a.name).filter(Boolean).slice(0, 5).join(', ');
  pushNotify({
    kind: 'apply', agentId: 'care',
    title: `새 ${label || '강의'} 신청 ${newOnes.length}명`,
    body: (names || '신규 신청자')
        + (newOnes.length > 5 ? ` 외 ${newOnes.length - 5}명` : '')
        + ' — 「고객관리 손」에서 안내문 발송을 준비하세요.',
  });
  return newOnes.length;
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
    } else {
      // 모닝브리핑/저녁보고 같은 정기보고는 "중요 보고"로 알림함에도 남긴다
      pushNotify({ kind: 'report', agentId: 'zenya', title: '제니야 정기보고 도착',
        body: String(reply).replace(/\s+/g, ' ').slice(0, 90) + '…' });
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
// 날짜 키(YYYY-MM-DD)를 한국시간 기준으로 만든다 (Render는 UTC라 반드시 변환).
// 이게 "날짜별 보관"의 기준 — 같은 날의 대화는 같은 키로 묶인다.
function dayKey(ts) {
  return new Date(ts || Date.now()).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

// GET /history?date=YYYY-MM-DD → 그 날짜의 대화만. date 없으면 오늘 대화만.
// (날짜가 바뀌면 오늘은 자연히 빈 화면, 어제까지는 그 날짜로 보관되어 그대로 남는다)
app.get('/history', (req, res) => {
  const date = req.query.date || dayKey();
  const messages = HISTORY.filter((m) => dayKey(m.ts) === date);
  res.json({ messages, date, today: dayKey() });
});

// GET /history/days → 대화가 있는 날짜 목록(오름차순) + 오늘. 날짜 넘겨보기용.
app.get('/history/days', (req, res) => {
  const set = new Set(HISTORY.map((m) => dayKey(m.ts)));
  set.add(dayKey());                                  // 오늘은 비어 있어도 항상 포함
  res.json({ days: [...set].sort(), today: dayKey() });
});

app.post('/history', (req, res) => {
  const { who, text, project } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text가 필요합니다.' });
  }
  appendHistory({ ts: new Date().toISOString(), who: who || 'u', text, project: project || '일반' });
  res.json({ ok: true });
});

// ── 알림함 창구 ───────────────────────────────────────────────
// GET  /notify        → 최근 알림 목록(최신순) + 안 읽은 수 (화면이 주기적으로 가져간다)
// POST /notify/read   → 확인 처리 ({id} 한 개 또는 {all:true} 전체) → 빨간점이 사라진다
// POST /notify        → 외부/수동 알림 등록 입구 (결제 웹훅·수신거부 연동이 나중에 여기로 꽂는다)
app.get('/notify', (req, res) => {
  const list = NOTIFY.slice(-100).reverse();           // 최신순, 최대 100개
  const unread = NOTIFY.filter((n) => !n.read).length;
  res.json({ list, unread });
});

app.post('/notify/read', (req, res) => {
  const { id, all } = req.body || {};
  let n = 0;
  NOTIFY.forEach((x) => { if (!x.read && (all || x.id === id)) { x.read = true; n++; } });
  if (n) saveNotify();
  res.json({ ok: true, marked: n, unread: NOTIFY.filter((x) => !x.read).length });
});

app.post('/notify', (req, res) => {
  const { kind, title, body, agentId } = req.body || {};
  if (!title || typeof title !== 'string') return res.status(400).json({ error: 'title(알림 제목)이 필요합니다.' });
  const item = pushNotify({ kind, title, body, agentId });
  res.json({ ok: true, item });
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

// 시트에서 사람 명단(이름·연락처·발송상태)을 읽는다 — 신청자·CRM 공용.
// 머리줄(1행)에서 이름·연락처·발송상태 열을 자동으로 찾고, 발송상태 열이 없으면 만들어 준다.
async function readPeople(sheetId, tabPref) {
  const sheets = sheetsClient();
  if (!sheets) throw new Error('구글 열쇠가 아직 없습니다. (server/google-key.json 또는 GOOGLE_SERVICE_ACCOUNT_JSON)');
  if (!sheetId) throw new Error('시트 ID가 아직 없습니다.');

  // 탭 고르기: 지정값 → "응답"이 들어간 탭(구글폼 응답) → 첫 탭
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const tabs = meta.data.sheets.map((s) => s.properties.title);
  const tab = tabPref && tabs.includes(tabPref) ? tabPref
            : tabs.find((t) => t.includes('응답')) || tabs[0];
  const range = `'${tab.replace(/'/g, "''")}'!A1:ZZ`;

  const got = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  const rows = got.data.values || [];
  if (!rows.length) return { tab, header: [], applicants: [], statusCol: -1, sheets };

  const header = rows[0].map((h) => String(h || '').trim());
  const findCol = (words) => header.findIndex((h) => words.some((w) => h.includes(w)));
  const nameCol  = findCol(['이름', '성함', '성명']);
  const phoneCol = findCol(['연락처', '전화', '휴대폰', '핸드폰']);
  const roleCol  = findCol(['역할']);
  let statusCol  = findCol(['발송상태']);
  if (phoneCol < 0) throw new Error(`시트 "${tab}" 1행에서 연락처 열을 못 찾았습니다. (머리줄에 "연락처" 또는 "전화번호"가 필요)`);

  // 발송상태 열이 없으면 머리줄 끝에 만들어 준다
  if (statusCol < 0) {
    statusCol = header.length;
    // 시트 격자가 꽉 차 있으면(예: 열 10개를 다 쓰는 CRM) 열을 먼저 늘린다
    const props = meta.data.sheets.find((s) => s.properties.title === tab).properties;
    if (statusCol >= props.gridProperties.columnCount) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [{ appendDimension: { sheetId: props.sheetId, dimension: 'COLUMNS', length: statusCol - props.gridProperties.columnCount + 1 } }] },
      });
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
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
      role: String((roleCol >= 0 && rows[i][roleCol]) || '').trim(),
      status: String(rows[i][statusCol] || '').trim(),
    });
  }
  return { tab, header, applicants, statusCol, sheets };
}

// 신청자(리드) 시트 읽기 — 기존 고객관리 손이 쓰는 입구
const readApplicants = () => readPeople(LEAD_SHEET_ID, LEAD_SHEET_TAB);

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
      notifyNewApplicants(applicants, '강의');   // 처음 본 신규 신청자가 있으면 알림함에 올린다
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
    notifyNewApplicants(applicants, '강의');   // 처음 본 신규 신청자가 있으면 알림함에 올린다
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
    if (okN || failN) pushNotify({
      kind: 'sent', agentId: 'care',
      title: `강의 안내 문자 발송 완료 ${okN}건`,
      body: failN ? `실패 ${failN}건 — 대화창에서 실패 사유를 확인하세요.` : '신규 신청자에게 감사·안내 문자가 나갔습니다.',
    });
    res.json({ results, sent: okN, failed: failN });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// CRM 홍보 문자 손 — 세 번째 실제 도구 (2026-06-08)
// 역할: 기존 고객 CRM 시트(4,366명)에게 강의 홍보 문자를 "하루치씩 나눠" 보낸다.
// 법적 요건(광고성 정보, 정보통신망법): 코드가 강제한다 —
//   ① 맨 앞 (광고) 표기  ② 맨 끝 무료수신거부 080 안내  ③ 야간(21시~08시) 발송 차단
// 안전장치: 대표님이 "오늘치 발송 승인"을 누른 분량만 발송. 승인 없이는 절대 안 나감.
//          이미 보낸 사람(시트 발송상태 도장)은 다시 안 보냄. 같은 번호 중복 제거.
// ============================================================
const CRM_SHEET_ID      = process.env.CRM_SHEET_ID || '';        // ★ 엑셀→구글시트 변환 후 새 ID를 넣는다
const CRM_SHEET_TAB     = process.env.CRM_SHEET_TAB || '';
const PROMO_DAILY_LIMIT = Number(process.env.PROMO_DAILY_LIMIT || 500);   // 하루치 기본 인원
const PROMO_UNIT_PRICE  = Number(process.env.PROMO_UNIT_PRICE || 33);     // 건당 예상 단가(원, LMS 기준 — Solapi 요금에 맞게 조정)
const PROMO_OPTOUT      = '무료수신거부 080-500-4233';                     // Solapi 제공 080 번호

// CRM 홍보 대상 상품 (2026-06-08 대표님 결정: CRM은 대부분 보험설계사 → 설계사 전문가 과정으로)
// ★ PROMO_FACTS가 비어 있으면 홍보 준비가 거부된다 — 사실 정보 없이 지어내서 보내는 것 방지
const PROMO_PRODUCT = process.env.PROMO_PRODUCT || '금융집짓기 상담전문가 과정 (7월 과정)';
const PROMO_FACTS   = process.env.PROMO_FACTS ||
  '강의명: 금융집짓기 상담전문가 과정(7월 과정) / '
  + '일정: 2026년 7월 4·11·18·25일(매주 토요일, 4주 과정), 13시~18시 대면 + 수료 후 1년 온라인 프로그램 / '
  + '수강료: 110만원(카드 결제 가능) / '
  + '혜택: 금융집짓기 상담전문가 자격증, 우수자 1:1 멘토링 / '
  + '특징: 보험상품 판매가 아니라 고객 재정안정을 위해 집 짓듯 순서대로 상담하는 특허받은 재무설계법 / '
  + '강사: 오원트금융연구소 오상열 대표(CFP 25년)';
// 이 과정 전용 결제 링크 (10억 강의의 CARE_PAY_LINK와 다름)
const PROMO_PAY_LINK = process.env.PROMO_PAY_LINK || 'https://link.payple.kr/NzcxOjc3NTQwNTc0OTgzOTg0';
// 발송 제외 역할 (2026-06-08 결정): 기자·경쟁사·일반인에게 설계사 전문가과정 광고는 부적절
const PROMO_EXCLUDE_ROLES = (process.env.PROMO_EXCLUDE_ROLES || '언론,경쟁자,일반인').split(',').map((s) => s.trim()).filter(Boolean);

// 한국 시간 기준 시(時) — 야간 광고 발송 금지 판정용 (Render는 UTC라 꼭 변환)
function koreaHour() {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }));
}

// 법적 요건을 코드로 강제 + 군더더기 제거:
//   (광고) 머리말은 맨 앞에, 080 수신거부는 맨 끝에 오게 하고,
//   그 앞/뒤에 에이전트가 붙인 잡담("대표님, 0자로 맞췄습니다" 등)은 잘라낸다.
function enforceAdRules(text) {
  let t = String(text || '').trim();
  const adIdx = t.indexOf('(광고)');
  if (adIdx > 0) t = t.slice(adIdx).trim();        // (광고) 앞의 군더더기 제거
  else if (adIdx < 0) t = '(광고) ' + t;            // 아예 없으면 머리말 붙임
  const opIdx = t.indexOf(PROMO_OPTOUT);
  if (opIdx >= 0) t = t.slice(0, opIdx + PROMO_OPTOUT.length).trim();   // 수신거부 뒤 군더더기 제거
  else t = t + '\n' + PROMO_OPTOUT;                 // 없으면 꼬리말 붙임
  return t;
}

// 홍보 발송 묶음 보관소 (server/data/홍보대기.json) — [{batchId, ts, text, items, status}]
let PROMO = loadJson('홍보대기.json');
const savePromo = () => saveJson('홍보대기.json', PROMO);

// ── /promo/status: CRM 손 상태 + 비용 예상 ───────────────────
app.get('/promo/status', async (req, res) => {
  const out = {
    crmSheet: !!CRM_SHEET_ID, solapi: !!solapi, sender: !!SOLAPI_SENDER,
    dailyLimit: PROMO_DAILY_LIMIT, unitPrice: PROMO_UNIT_PRICE,
    pendingBatches: PROMO.filter((b) => b.status === '대기').map((b) => ({
      batchId: b.batchId, count: b.items.length, cost: b.items.length * PROMO_UNIT_PRICE, ts: b.ts, text: b.text,
    })),
  };
  if (CRM_SHEET_ID && googleCreds()) {
    try {
      const { tab, applicants } = await readPeople(CRM_SHEET_ID, CRM_SHEET_TAB);
      const seen = new Set();
      const fresh = applicants.filter((a) => !a.status && !PROMO_EXCLUDE_ROLES.includes(a.role)
                                          && !seen.has(a.phone) && seen.add(a.phone));
      out.crmTab = tab; out.total = applicants.length; out.remaining = fresh.length;
      out.remainingCost = fresh.length * PROMO_UNIT_PRICE;
    } catch (e) { out.crmError = e.message; }
  }
  res.json(out);
});

// ── /promo/draft: 오늘치 묶음 준비 (발송 아님 — 승인 대기로만) ──
// 받는 것: { limit, guide } — limit 기본 500 (하루치), guide = 대표님 추가 지시
app.post('/promo/draft', async (req, res) => {
  console.log('📨 /promo/draft 요청 도착 —', new Date().toLocaleString('ko-KR'));
  try {
    if (!CRM_SHEET_ID) {
      return res.status(503).json({ error: 'CRM 시트가 아직 연결 안 됐습니다. ① 엑셀 파일을 열어 "파일→Google Sheets로 저장" ② 새 시트를 jenya-server 서비스 계정에 편집자 공유 ③ 새 시트 주소의 ID를 환경변수 CRM_SHEET_ID에 넣고 서버 재시작.' });
    }
    const limit = Math.max(1, Math.min(Number((req.body || {}).limit) || PROMO_DAILY_LIMIT, 1000));
    const guide = (req.body || {}).guide;

    // 보낼 사람 고르기: 발송상태 빈 사람 + 제외 역할 빼기 + 번호 중복 제거 + 이미 대기 묶음에 든 사람 제외
    const { applicants } = await readPeople(CRM_SHEET_ID, CRM_SHEET_TAB);
    const queued = new Set(PROMO.filter((b) => b.status === '대기').flatMap((b) => b.items.map((i) => i.phone)));
    const seen = new Set();
    const targets = applicants
      .filter((a) => !a.status && !PROMO_EXCLUDE_ROLES.includes(a.role)
                  && !queued.has(a.phone) && !seen.has(a.phone) && seen.add(a.phone))
      .slice(0, limit);
    if (!targets.length) return res.json({ batch: null, message: '보낼 사람이 없습니다. (전원 발송완료 또는 대기 중)' });

    // 사실 정보 없이는 못 보낸다 (정직 원칙 — 일정·가격을 지어내는 사고 방지)
    if (!PROMO_FACTS) {
      return res.status(503).json({ error: `홍보 대상 "${PROMO_PRODUCT}"의 확정 정보(일정·기간·수강료·마감)가 아직 등록 안 됐습니다. 대표님이 정보를 주시면 등록 후 바로 준비됩니다.` });
    }

    // 홍보 문구: 마케팅 손의 "카톡 채널 안내글" 톤 + 법적 요건은 아래 enforceAdRules가 한 번 더 강제
    const system = buildSystemPrompt('care', '머니트레이닝랩');
    const ask =
      '기존 고객(대부분 보험설계사)에게 보낼 교육과정 홍보 "광고 문자" 한 통을 써라.\n'
      + `- 홍보 대상: ${PROMO_PRODUCT}\n`
      + '- 각도(가장 중요): 받는 사람은 보험설계사다. "설계사 본인의 상담 전문성을 높이고, 고객에게 신뢰받는 재무상담 무기를 갖는 과정"이라는 점이 와닿게. 설계사가 "이건 나에게 필요하다"고 느끼게 쓴다. 너무 건조한 정보 나열 금지, 그렇다고 과장도 금지\n'
      + '- 호칭은 "고객님"으로 통일 ("설계사님" 같은 호칭은 쓰지 말 것 — 어색함 방지, 개인 이름도 넣지 않음)\n'
      + '- 톤: 카카오톡 채널 안내글처럼 짧은 줄·줄바꿈으로 폰에서 읽기 좋게, 따뜻하고 담백하게\n'
      + '- 반드시 맨 앞은 "(광고) 오원트금융연구소"로 시작\n'
      + '- 핵심 정보(이 사실만 사용, 지어내기 금지): ' + PROMO_FACTS + '\n'
      + '- 일정 줄에는 반드시 "매주 토요일"을 함께 표기 (예: "7/4·11·18·25 매주 토요일, 4주")\n'
      + '- 신청서 링크 포함: ' + MKT_APPLY_LINK + '\n'
      + `- 수강료 안내 다음 줄에 결제 안내 한 줄: "결제하기: ${PROMO_PAY_LINK}" (링크 한 글자도 바꾸지 말 것)\n`
      + (guide ? '- 대표님 추가 지시: ' + guide + '\n' : '')
      + '- 수익·성과 보장, 과장 표현 절대 금지\n'
      + `- 맨 끝 줄: ${PROMO_OPTOUT}\n`
      + '- 전체 400자 이내, 마크다운·이모지 없이. 문자 본문만 출력';
    const r = await anthropic.messages.create({
      model: MODEL, max_tokens: 1000, system,
      messages: [{ role: 'user', content: ask }],
    });
    const template = enforceAdRules(r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'));

    const batch = {
      batchId: 'b' + Date.now(),
      ts: new Date().toISOString(),
      text: template,
      items: targets.map((t) => ({ name: t.name, phone: t.phone })),
      status: '대기',
    };
    PROMO.push(batch);
    savePromo();
    appendDiary({
      ts: batch.ts, agentId: 'care', agentName: '고객관리', project: '머니트레이닝랩', kind: 'hand',
      entry: `[손] CRM 홍보 오늘치 ${batch.items.length}명 준비 (예상 비용 약 ${(batch.items.length * PROMO_UNIT_PRICE).toLocaleString()}원) — 대표님 승인 대기`,
    });
    res.json({
      batch: { batchId: batch.batchId, text: template, count: batch.items.length,
               cost: batch.items.length * PROMO_UNIT_PRICE, unitPrice: PROMO_UNIT_PRICE,
               sample: batch.items.slice(0, 5) },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /promo/approve: 오늘치 발송 승인 → 발송 → 시트 도장 ─────
// 휴먼인더루프: 이 창구 없이는 절대 발송 안 됨. 야간(21~08시)엔 법 위반 방지로 거부.
app.post('/promo/approve', async (req, res) => {
  console.log('📨 /promo/approve 요청 도착 —', new Date().toLocaleString('ko-KR'));
  try {
    const { batchId } = req.body || {};
    const batch = PROMO.find((b) => b.batchId === batchId && b.status === '대기');
    if (!batch) return res.status(400).json({ error: '승인할 대기 묶음이 없습니다.' });
    if (!solapi || !SOLAPI_SENDER) return res.status(503).json({ error: 'Solapi 키 또는 발신번호가 없습니다.' });
    const h = koreaHour();
    if (h >= 21 || h < 8) {
      return res.status(403).json({ error: `지금은 한국시간 ${h}시 — 광고 문자는 밤 9시~아침 8시 발송이 법으로 금지돼 있습니다. 아침 8시 이후 승인해 주세요.` });
    }

    // 발송 (한 번에 — Solapi는 묶음 발송 지원)
    // 호칭은 전원 "고객님" 통일 (2026-06-08 대표님 결정 — CRM 이름 칸에 회사·직함이 섞여 있어 안전하게)
    const messages = batch.items.map((it) => ({
      to: it.phone, from: SOLAPI_SENDER,
      text: batch.text.replace(/\{이름\}/g, '고객'),
    }));
    const result = await solapi.send(messages);
    const okN = (result.groupInfo && result.groupInfo.count && result.groupInfo.count.registeredSuccess) || messages.length;

    // 시트에 발송완료 도장 (한 번에 — batchUpdate)
    const { tab, applicants, statusCol, sheets } = await readPeople(CRM_SHEET_ID, CRM_SHEET_TAB);
    const stamp = '발송완료 ' + new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const phones = new Set(batch.items.map((i) => i.phone));
    const data = applicants.filter((a) => phones.has(a.phone) && !a.status).map((a) => ({
      range: `'${tab.replace(/'/g, "''")}'!${colLetter(statusCol)}${a.row}`,
      values: [[stamp]],
    }));
    if (data.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: CRM_SHEET_ID,
        requestBody: { valueInputOption: 'RAW', data },
      });
    }

    batch.status = '발송완료 ' + stamp;
    savePromo();
    const cost = batch.items.length * PROMO_UNIT_PRICE;
    appendDiary({
      ts: new Date().toISOString(), agentId: 'care', agentName: '고객관리', project: '머니트레이닝랩', kind: 'hand',
      entry: `[손] 대표님 승인으로 CRM 홍보 문자 ${batch.items.length}명 발송 (접수 ${okN}건, 예상 비용 약 ${cost.toLocaleString()}원) — 시트 도장 ${data.length}건`,
    });
    pushNotify({
      kind: 'sent', agentId: 'care',
      title: `CRM 홍보 문자 발송 완료 ${batch.items.length}명`,
      body: `접수 ${okN}건 · 예상 비용 약 ${cost.toLocaleString()}원 · 시트 도장 ${data.length}건`,
    });
    res.json({ sent: batch.items.length, registered: okN, stamped: data.length, cost });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /promo/reject: 묶음 보류 ─────────────────────────────────
app.post('/promo/reject', (req, res) => {
  const { batchId } = req.body || {};
  const batch = PROMO.find((b) => b.batchId === batchId && b.status === '대기');
  if (!batch) return res.status(400).json({ error: '보류할 대기 묶음이 없습니다.' });
  batch.status = '보류';
  savePromo();
  res.json({ rejected: batch.items.length });
});

// ============================================================
// 마케팅 손 — 두 번째 실제 도구 (2026-06-08)
// 역할: 강의 홍보 콘텐츠 4종을 한 번에 생성 → 화면에서 복사 → 대표님이 각 플랫폼에 게시.
//      (플랫폼 자동 게시는 다음 단계 — 지금은 생성 자동 + 게시 복붙이 가장 빠르고 정직한 구조)
// ============================================================

// 신청서 공개 링크 (콘텐츠 CTA에 들어감 — 바뀌면 환경변수로 교체)
const MKT_APPLY_LINK = process.env.MKT_APPLY_LINK
  || 'https://docs.google.com/forms/d/e/1FAIpQLSejqqWGxDVeDqPkNHQXM2ATY5e8o06CWcFpbT7sEBpqAKhONg/viewform';

// 이번 강의 기본 정보 (사실만 — 콘텐츠가 지어내지 않게 한 곳에서 관리)
const LECTURE_FACTS =
  '강의명: 10억 목돈마련 절대법칙 / 4주 과정, 매주 목요일 저녁 7시~10시(총 4회) / '
  + '줌(Zoom) 비대면 / 수강료 55만원(카드 결제 가능) / '
  + '1차 신청마감 6월 12일(금) 저녁 6시, 이후 강의 전날까지 추가 접수 가능 / '
  + '강사: 오원트금융연구소 오상열 대표(CFP 25년)';

// ── /mkt/content: 홍보 콘텐츠 4종 생성 ───────────────────────
// 받는 것: { project, guide } — guide = 대표님 추가 지시(선택)
app.post('/mkt/content', async (req, res) => {
  console.log('📣 /mkt/content 요청 도착 —', new Date().toLocaleString('ko-KR'));
  try {
    const { project, guide } = req.body || {};
    const system = buildSystemPrompt('mkt', project || '머니트레이닝랩');
    const ask =
      '이번 주 목표: "10억 목돈마련 절대법칙" 비대면 강의 100명 모집 (6월 12일 금요일 1차 마감).\n'
      + '강의 정보(이 사실만 사용, 지어내기 금지): ' + LECTURE_FACTS + '\n'
      + '신청서 링크: ' + MKT_APPLY_LINK + '\n'
      + (guide ? '대표님 추가 지시: ' + guide + '\n' : '')
      + '\n아래 홍보 콘텐츠 4종을 만들어라. 각 콘텐츠는 반드시 그 구분표로 시작한다.\n'
      + '[[유튜브쇼츠]] 쇼츠용 30~45초 대본 (첫 3초 후킹 문구 3개 제안 + 본 대본)\n'
      + '[[인스타블로그]] 인스타그램 캡션(해시태그 포함) + 네이버 블로그용 제목·도입부 카피\n'
      + '[[카톡채널]] 카카오톡 채널 발송용 안내 글 (폰에서 읽기 좋게 짧은 줄·줄바꿈)\n'
      + '[[맞벌이타깃]] "맞벌이 직장인 부자" 타깃 카피 — 맞벌이 부부의 현실(둘이 버는데 안 모이는 이유) 공감으로 시작해 강의로 연결\n'
      + '\n규칙:\n'
      + '- 금융 콘텐츠다. 수익·성과 보장, 과장·허위 표현 절대 금지 ("무조건", "100% 됩니다" 금지)\n'
      + '- 각 콘텐츠 끝에 신청 유도 CTA 한 줄 (신청서 링크 표기, 유튜브·인스타는 "프로필 링크에서 신청" 문구도 함께)\n'
      + '- 마크다운 기호(#, *, -) 없이 일반 글로. 콘텐츠 사이 설명·인사말 없이 4종만 출력';
    const r = await anthropic.messages.create({
      model: MODEL, max_tokens: 16000, thinking: { type: 'adaptive' },
      system, messages: [{ role: 'user', content: ask }],
    });
    const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

    // [[구분표]] 기준으로 4종을 나눈다 (못 나누면 통째로 한 덩어리)
    const LABELS = { 유튜브쇼츠: '유튜브/쇼츠 대본', 인스타블로그: '인스타·블로그 카피', 카톡채널: '카톡 채널 안내 글', 맞벌이타깃: '맞벌이 직장인 타깃 카피' };
    const found = [...text.matchAll(/\[\[(유튜브쇼츠|인스타블로그|카톡채널|맞벌이타깃)\]\]/g)];
    const parts = found.length
      ? found.map((m, i) => ({
          key: m[1], label: LABELS[m[1]],
          text: text.slice(m.index + m[0].length, i + 1 < found.length ? found[i + 1].index : undefined).trim(),
        }))
      : [{ key: '전체', label: '홍보 콘텐츠', text: text.trim() }];

    appendDiary({
      ts: new Date().toISOString(), agentId: 'mkt', agentName: '마케팅', project: project || '머니트레이닝랩', kind: 'hand',
      entry: `[손] 강의 홍보 콘텐츠 ${parts.length}종 생성 (${parts.map((p) => p.label).join('/')})${guide ? ` — 지시: ${String(guide).slice(0, 80)}` : ''}`,
    });
    res.json({ parts, applyLink: MKT_APPLY_LINK });
  } catch (e) {
    console.error('[/mkt/content 오류]', e.message);
    res.status(500).json({ error: e.message });
  }
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
