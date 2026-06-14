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
  if (typeof runDuePromo === 'function') runDuePromo().catch(() => {});       // 앱 폴링이 서버를 깨우면 밀린 예약도 확인
  if (typeof runDuePayments === 'function') runDuePayments().catch(() => {}); // 밀린 결제 처리도 확인
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
const crypto = require('crypto');
const { Storage } = require('@google-cloud/storage');

// 시트 주소(ID)는 비밀이 아니라서 코드에 기본값으로 둔다 (환경변수로 바꿀 수도 있음)
const LEAD_SHEET_ID  = process.env.LEAD_SHEET_ID || '1L15eUgHO81MN5rTYj5351a5RbFGptxNSMnTzMQLDRmk';
const LEAD_SHEET_TAB = process.env.LEAD_SHEET_TAB || '';   // 비우면 "응답" 탭 → 첫 탭 순서로 자동 선택
const SOLAPI_SENDER  = (process.env.SOLAPI_SENDER || '').replace(/\D/g, '');  // 발신번호 (Solapi에 등록된 번호)
// 강의 수강료 결제 링크 (페이플) — 안내문의 수강료 다음 줄에 들어간다
const CARE_PAY_LINK  = process.env.CARE_PAY_LINK || 'https://link.payple.kr/NzcxOjc3NTQwNTcxNzMzMTMy';

// 구글 열쇠: ① server/google-key.json 파일(로컬) ② GOOGLE_SERVICE_ACCOUNT_JSON 환경변수(Render)
//   환경변수 값은 ⓐ 그냥 JSON 한 줄 또는 ⓑ Base64(줄바꿈·따옴표가 없어 복붙 중 안 깨짐) 둘 다 받는다.
function googleCreds() {
  const keyFile = path.join(__dirname, 'google-key.json');
  try {
    if (fs.existsSync(keyFile)) return JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (raw) {
      const txt = raw.trim();
      // '{' 로 시작하면 그냥 JSON, 아니면 Base64로 보고 풀어서 JSON 파싱
      const json = txt.startsWith('{') ? txt : Buffer.from(txt, 'base64').toString('utf8');
      return JSON.parse(json);
    }
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

// 신청자(리드) 시트 읽기 — "활성 캠페인"의 신청시트를 읽는다 (없으면 기본 리드시트)
//   전문가/일반인 등 캠페인마다 신청 폼·시트가 달라도 그 캠페인 것만 읽고 도장 찍는다
function activeLeadSheet() {
  const c = (typeof CAMPAIGN !== 'undefined' && CAMPAIGN) ? CAMPAIGN : {};
  return { id: c.leadSheetId || LEAD_SHEET_ID, tab: c.leadSheetTab || LEAD_SHEET_TAB };
}
const readApplicants = () => { const L = activeLeadSheet(); return readPeople(L.id, L.tab); };

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
    const cName = CAMPAIGN.name || '강의';
    const cOnline = CAMPAIGN.mode === '비대면';
    const cPay  = CAMPAIGN.payLink || CARE_PAY_LINK;
    const ask =
      '강의 신청자에게 보낼 "감사 + 강의 안내" 문자 한 통을 써라.\n'
      + '- 받는 사람 이름 자리는 반드시 {이름} 으로 표기 (예: "{이름}님, 신청 감사합니다")\n'
      + `- 이번 강의: ${cName} (${cOnline ? '비대면 — 줌(Zoom)' : '대면'})\n`
      + (CAMPAIGN.facts ? `- 강의 사실(이 정보만 사용, 지어내기 금지): ${CAMPAIGN.facts}\n` : '')
      + (guide ? `- 대표님이 꼭 넣으라는 내용: ${guide}\n` : '- 일시·접속링크 등 확정 정보가 없으면 "확정되는 대로 다시 안내드립니다"로 처리\n')
      + `- 수강료 안내 바로 다음 줄에 결제 안내 한 줄을 넣어라: "결제하기: ${cPay}" (링크 주소는 한 글자도 바꾸지 말 것)\n`
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
            spreadsheetId: activeLeadSheet().id,
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

// 홍보 발송 묶음 보관소 — [{batchId, ts, text, items, status, sendAt?}]
//   status: '대기' · '예약' · '발송중'(보내는 중) · '발송완료 …' · '보류' · '예약실패'
//   ★ 영구 저장: 로컬 JSON(빠른 캐시) + 구글시트 '제니야_예약저장' 탭(재시작에도 안 날아감).
//     Render 무료 플랜은 재시작 시 디스크가 초기화되므로, 시트가 진짜 원본이다.
const RESV_SHEET_ID = process.env.RESV_SHEET_ID || CRM_SHEET_ID;   // 기본: CRM 시트(쓰기 권한 있음)
const RESV_TAB      = process.env.RESV_TAB || '제니야_예약저장';

let PROMO = loadJson('홍보대기.json');

async function ensureResvTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: RESV_SHEET_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === RESV_TAB)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: RESV_SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: RESV_TAB } } }] },
    });
  }
}
// 시트에 PROMO 전체를 덮어쓴다 (묶음 수가 적어 통째로 기록)
async function savePromoToSheet() {
  const sheets = sheetsClient();
  if (!sheets || !RESV_SHEET_ID) return false;
  await ensureResvTab(sheets);
  const header = ['batchId', 'status', 'sendAt', 'ts', 'scheduledTs', 'tries', 'test', 'text', 'items(phone\\tname)'];
  const rows = PROMO.map((b) => [
    b.batchId, b.status || '', b.sendAt || '', b.ts || '', b.scheduledTs || '', String(b.tries || 0),
    b.test ? '1' : '', b.text || '',
    (b.items || []).map((i) => (i.phone || '') + '\t' + (i.name || '')).join('\n'),
  ]);
  await sheets.spreadsheets.values.clear({ spreadsheetId: RESV_SHEET_ID, range: `'${RESV_TAB}'!A2:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: RESV_SHEET_ID, range: `'${RESV_TAB}'!A1`,
    valueInputOption: 'RAW', requestBody: { values: [header, ...rows] },
  });
  return true;
}
// 시트에서 PROMO를 복원한다 (서버 시작 시) — 탭이 없으면 null
async function loadPromoFromSheet() {
  const sheets = sheetsClient();
  if (!sheets || !RESV_SHEET_ID) return null;
  let got;
  try { got = await sheets.spreadsheets.values.get({ spreadsheetId: RESV_SHEET_ID, range: `'${RESV_TAB}'!A1:Z` }); }
  catch (e) { return null; }
  const rows = got.data.values || [];
  if (rows.length < 1) return [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    const items = String(r[8] || '').split('\n').filter(Boolean).map((line) => {
      const t = line.split('\t'); return { phone: t[0], name: t[1] || '고객' };
    });
    out.push({
      batchId: r[0], status: r[1] || '', sendAt: r[2] || undefined, ts: r[3] || '',
      scheduledTs: r[4] || undefined, tries: Number(r[5] || 0), test: r[6] === '1', text: r[7] || '', items,
    });
  }
  return out;
}
// 시트 저장 직렬화 — 쓰기를 줄로 세워 충돌 방지. ★중요: 반환 promise는 "이 호출의 기록이 끝난 뒤" 풀린다
//   (그래야 await savePromo()가 시트 기록 완료까지 진짜로 기다림 → 끄기 전에 확실히 저장됨)
let resvChain = Promise.resolve();
function savePromoToSheetSafe() {
  const next = resvChain.catch(() => {}).then(() => savePromoToSheet());
  resvChain = next.catch((e) => console.warn('⚠️ 예약 시트 저장 실패:', e.message));
  return resvChain;
}
// 저장: 로컬 JSON(즉시) + 구글시트(영구). 중요한 곳에선 await로 시트 기록까지 보장.
const savePromo = () => { saveJson('홍보대기.json', PROMO); return savePromoToSheetSafe(); };

// 서버 시작 시: 구글시트에서 예약 복원 (재시작으로 로컬 JSON이 비었어도 시트가 살린다)
(async () => {
  const fromSheet = await loadPromoFromSheet().catch(() => null);
  if (fromSheet) {
    PROMO = fromSheet;
    saveJson('홍보대기.json', PROMO);
    const sched = PROMO.filter((b) => b.status === '예약').length;
    console.log(`📅 예약 시트에서 복원: 총 ${PROMO.length}건 (예약 대기 ${sched}건)`);
    const stuck = PROMO.filter((b) => b.status === '발송중');
    if (stuck.length) {
      pushNotify({ kind: 'sent', agentId: 'care', title: '⚠️ 발송 중 중단된 묶음 확인 필요',
        body: `${stuck.length}건이 '발송중' 상태로 남아 있습니다(재시작 중 끊김). 중복발송 방지를 위해 자동 재발송하지 않습니다 — 확인 바랍니다.` });
    }
  }
})();

// 한국시간 부품 분해 (예약 야간보정용 — Render는 UTC라 꼭 변환)
function koreaParts(d) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = {}; f.formatToParts(d).forEach((x) => { if (x.type !== 'literal') p[x.type] = x.value; });
  let h = Number(p.hour); if (h === 24) h = 0;
  return { y: +p.year, mo: +p.month, da: +p.day, h, mi: +p.minute };
}
// 야간차단(밤 21시~아침 8시)에 걸린 예약 시각을 다음 허용시각(아침 8시 정각 KST)으로 당긴다.
function snapToAllowed(target) {
  const p = koreaParts(target);
  if (p.h >= 8 && p.h < 21) return target;          // 이미 허용 시간대 → 그대로
  let Y = p.y, M = p.mo, D = p.da;
  if (p.h >= 21) {                                   // 밤 → 다음날 아침 8시
    const t = new Date(Date.UTC(Y, M - 1, D + 1));   // 월말·연말 넘김 자동 처리
    Y = t.getUTCFullYear(); M = t.getUTCMonth() + 1; D = t.getUTCDate();
  }
  // 새벽(8시 전)이면 같은 날 아침 8시. 08:00 KST = 그날 08:00 UTC − 9시간.
  return new Date(Date.UTC(Y, M - 1, D, 8, 0, 0) - 9 * 3600 * 1000);
}

// 한 묶음을 실제로 발송하고 시트 도장·영업일기·알림까지 처리한다. (수동 승인·예약 자동발송 공통)
//   ※ 호칭은 전원 "고객님" 통일 (2026-06-08 결정 — CRM 이름 칸에 회사·직함이 섞여 있어 안전하게)
async function sendPromoBatch(batch) {
  batch.status = '발송중';       // 보내기 직전 영구표시 → 재시작 중 끊겨도 중복발송 안 됨
  await savePromo();
  const messages = batch.items.map((it) => ({
    to: it.phone, from: SOLAPI_SENDER,
    text: batch.text.replace(/\{이름\}/g, '고객'),
  }));
  const result = await solapi.send(messages);
  const okN = (result.groupInfo && result.groupInfo.count && result.groupInfo.count.registeredSuccess) || messages.length;

  const stamp = '발송완료 ' + new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  // 시트에 발송완료 도장 (테스트 묶음은 CRM 시트를 전혀 안 건드린다)
  let stampedCount = 0;
  if (!batch.test) {
    const { tab, applicants, statusCol, sheets } = await readPeople(CRM_SHEET_ID, CRM_SHEET_TAB);
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
    stampedCount = data.length;
  }

  batch.status = (batch.test ? '발송완료(테스트) ' : '발송완료 ') + stamp;
  delete batch.sendAt;
  await savePromo();      // 발송완료를 시트에 확정 기록 → 중복발송 방지
  const cost = batch.items.length * PROMO_UNIT_PRICE;
  appendDiary({
    ts: new Date().toISOString(), agentId: 'care', agentName: '고객관리', project: '머니트레이닝랩', kind: 'hand',
    entry: `[손] ${batch.test ? '예약 테스트 ' : 'CRM 홍보 '}문자 ${batch.items.length}명 발송 (접수 ${okN}건, 예상 비용 약 ${cost.toLocaleString()}원) — 시트 도장 ${stampedCount}건`,
  });
  pushNotify({
    kind: 'sent', agentId: 'care',
    title: `${batch.test ? '🧪 예약 테스트 발송 완료' : 'CRM 홍보 문자 발송 완료'} ${batch.items.length}명`,
    body: `접수 ${okN}건 · 예상 비용 약 ${cost.toLocaleString()}원${batch.test ? ' (테스트 — 시트 안 건드림)' : ` · 시트 도장 ${stampedCount}건`}`,
  });
  return { sent: batch.items.length, registered: okN, stamped: stampedCount, cost };
}

// ============================================================
// 강의 모집 캠페인 — "한 장"의 중앙 강의정보 (매달 여기만 바꾸면 모든 손이 이 값을 쓴다)
// 저장: 로컬 JSON + 구글시트 '제니야_캠페인' 탭 (재시작에도 유지)
// ============================================================
const CAMPAIGN_DEFAULT = {
  id: '',                  // 캠페인 고유 번호 (자동) — 콘텐츠·현황을 캠페인별로 분리
  title: '전문가 대면과정 7월',        // 캠페인 구분용 제목 (월·과정별 — 드롭다운에 표시)
  name: '전문가 대면과정 (금융집짓기 상담전문가)',
  date: '2026년 7월 4·11·18·25일 매주 토요일 13~18시 (4주 대면) + 수료 후 1년 온라인',
  startDate: '',           // 개강일 (YYYY-MM-DD) — 제니야 코치가 오늘과 비교해 할 일 판정
  endDate: '',             // 종료일 (YYYY-MM-DD)
  price: 1100000,
  mode: '대면',            // 대면 / 비대면 (안내 문자가 대면=장소, 비대면=줌 링크로 갈림)
  place: '',               // 대면 장소 (확정 시 입력)
  onlineLink: '',          // 비대면 줌(Zoom) 접속 링크
  capacity: '',            // 정원
  applyLink: 'https://docs.google.com/forms/d/e/1FAIpQLSejqqWGxDVeDqPkNHQXM2ATY5e8o06CWcFpbT7sEBpqAKhONg/viewform',
  payLink: PROMO_PAY_LINK,
  facts: PROMO_FACTS,      // 홍보·콘텐츠가 쓰는 사실 한 줄
  prepare: '',             // 준비물 (결제후 안내에 들어감)
  notice: '',              // 추가 안내 (결제후 안내에 들어감)
  listenTarget: '',        // 소셜리스닝: 어떤 고민하는 사람
  listenKeywords: '',      // 소셜리스닝: 키워드
  contentNote: '',         // 업로드한 포스터·쇼츠·홍보글 위치/메모
  kakaoChannel: '금융집짓기', // 카카오 채널명 (모든 콘텐츠 끝 "검색→채널추가" 문구에 들어감)
  hashtags: '#재테크 #재무설계 #목돈마련 #맞벌이', // SNS 쇼츠 caption 끝 해시태그 (과정별)
  // ── 캠페인별 데이터 출처 분리 (어느 결제DB·신청시트를 읽고, CRM 설계사 대상인지) ──
  payTab: '전문가강의결제DB',   // 이 캠페인 결제내역을 읽을 AI머니야_마케팅DB 탭 (실제 탭: 전문가강의결제DB / 일반인강의결제DB)
  leadSheetId: '',         // 이 캠페인 신청자 시트 ID (비우면 기본 신청자 시트 사용)
  leadSheetTab: '',        // 신청자 탭 (비우면 기본)
  crmPromo: true,          // CRM 설계사 홍보 문자 대상인가 (false면 SNS 매스 — 미발송 인원 안 띄움)
};
const CAMP_FIELDS = ['title', 'name', 'date', 'startDate', 'endDate', 'price', 'mode', 'place', 'onlineLink', 'capacity', 'applyLink', 'payLink', 'facts', 'prepare', 'notice', 'listenTarget', 'listenKeywords', 'contentNote', 'kakaoChannel', 'hashtags', 'payTab', 'leadSheetId', 'leadSheetTab', 'crmPromo'];
function newCampaignId() { return 'cmp' + Date.now() + Math.floor(Math.random() * 1000); }
function toBool(v) { return !(v === false || v === 'false' || v === 'N' || v === 'n' || v === '아니오' || v === 0 || v === '0' || v === ''); }
// 옛 탭 이름 자동 교정 (실제 AI머니야 탭은 "…결제DB") — 저장된 캠페인도 로드 시 바로잡힌다
const PAYTAB_FIX = { '전문가강의DB': '전문가강의결제DB', '일반인강의DB': '일반인강의결제DB' };
function normalizeCampaign(obj) {
  const c = Object.assign({}, CAMPAIGN_DEFAULT, obj || {});
  if (!c.id) c.id = newCampaignId();
  c.price = Number(String(c.price).replace(/\D/g, '')) || 0;
  c.mode = (c.mode === '비대면') ? '비대면' : '대면';
  if (PAYTAB_FIX[c.payTab]) c.payTab = PAYTAB_FIX[c.payTab];
  c.crmPromo = (obj && obj.crmPromo !== undefined) ? toBool(obj.crmPromo) : true;
  return c;
}

// ── 다중 캠페인: CAMPAIGNS 배열 + 활성 1개 ──────────────────────
//   한 번에 한 캠페인만 "활성". CAMPAIGN은 항상 활성 캠페인을 가리키므로
//   기존 손들(콘텐츠·홍보·결제후)은 코드 변경 없이 그대로 활성 캠페인 정보를 쓴다.
let CAMPAIGNS = [];
let ACTIVE_ID = '';
let CAMPAIGN = normalizeCampaign({});   // 활성 캠페인 (아래 init에서 실제 값으로 교체)
function setActiveCampaign(id) {
  const found = CAMPAIGNS.find((c) => c.id === id);
  if (found) { ACTIVE_ID = found.id; CAMPAIGN = found; }
  return found;
}
function ensureCampaigns() {
  if (!CAMPAIGNS.length) { CAMPAIGNS = [normalizeCampaign({})]; }
  const act = CAMPAIGNS.find((c) => c.id === ACTIVE_ID) || CAMPAIGNS[0];
  ACTIVE_ID = act.id; CAMPAIGN = act;
}
(function initCampaignsFromLocal() {
  const raw = loadJson('캠페인.json');
  if (raw && Array.isArray(raw.campaigns) && raw.campaigns.length) {
    CAMPAIGNS = raw.campaigns.map(normalizeCampaign);
    ACTIVE_ID = raw.activeId || '';
  } else if (raw && !Array.isArray(raw) && (raw.name || raw.title)) {
    CAMPAIGNS = [normalizeCampaign(raw)];   // 옛 단일 캠페인 → 배열로 승격
  }
  ensureCampaigns();
})();
const CAMPAIGN_TAB = process.env.CAMPAIGN_TAB || '제니야_캠페인';

async function saveCampaignToSheet() {
  const sheets = sheetsClient();
  if (!sheets || !RESV_SHEET_ID) return;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: RESV_SHEET_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === CAMPAIGN_TAB)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: RESV_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: CAMPAIGN_TAB } } }] } });
  }
  const rows = [['activeId', ACTIVE_ID], ['campaigns', JSON.stringify(CAMPAIGNS)]];
  await sheets.spreadsheets.values.clear({ spreadsheetId: RESV_SHEET_ID, range: `'${CAMPAIGN_TAB}'!A1:Z` });
  await sheets.spreadsheets.values.update({ spreadsheetId: RESV_SHEET_ID, range: `'${CAMPAIGN_TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });
}
let campChain = Promise.resolve();
function saveCampaign() {
  saveJson('캠페인.json', { campaigns: CAMPAIGNS, activeId: ACTIVE_ID });
  const next = campChain.catch(() => {}).then(() => saveCampaignToSheet());
  campChain = next.catch((e) => console.warn('⚠️ 캠페인 시트 저장 실패:', e.message));
  return campChain;
}
async function loadCampaignFromSheet() {
  const sheets = sheetsClient();
  if (!sheets || !RESV_SHEET_ID) return false;
  let got;
  try { got = await sheets.spreadsheets.values.get({ spreadsheetId: RESV_SHEET_ID, range: `'${CAMPAIGN_TAB}'!A1:B` }); }
  catch (e) { return false; }
  const rows = got.data.values || [];
  if (!rows.length) return false;
  const map = {};
  rows.forEach((r) => { if (r[0]) map[r[0]] = r[1] || ''; });
  if (map.campaigns) {                 // 새 형식 (JSON 묶음)
    let arr; try { arr = JSON.parse(map.campaigns); } catch (e) { arr = null; }
    if (Array.isArray(arr) && arr.length) {
      CAMPAIGNS = arr.map(normalizeCampaign);
      ACTIVE_ID = map.activeId || '';
      ensureCampaigns();
      return true;
    }
  }
  const hasOld = Object.keys(map).some((k) => CAMPAIGN_DEFAULT.hasOwnProperty(k));
  if (hasOld) {                        // 옛 형식 (키-값 단일 캠페인) → 승격
    const obj = {};
    Object.keys(map).forEach((k) => { if (CAMPAIGN_DEFAULT.hasOwnProperty(k)) obj[k] = map[k]; });
    CAMPAIGNS = [normalizeCampaign(obj)];
    ACTIVE_ID = '';
    ensureCampaigns();
    return true;
  }
  return false;
}
(async () => {
  const ok = await loadCampaignFromSheet().catch(() => false);
  if (ok) { saveJson('캠페인.json', { campaigns: CAMPAIGNS, activeId: ACTIVE_ID }); console.log(`📋 캠페인 복원: ${CAMPAIGNS.length}개, 활성=${CAMPAIGN.name}`); }
})();

// ── /campaign/config: 활성 캠페인 강의정보 읽기 / 저장 ──
app.get('/campaign/config', (req, res) => res.json(CAMPAIGN));
// ── /campaign/list: 드롭다운용 캠페인 목록 + 활성 id ──
app.get('/campaign/list', (req, res) => res.json({
  campaigns: CAMPAIGNS.map((c) => ({ id: c.id, title: c.title, name: c.name, mode: c.mode })),
  activeId: ACTIVE_ID,
}));
app.post('/campaign/config', async (req, res) => {
  console.log('📋 /campaign/config 저장 —', new Date().toLocaleString('ko-KR'));
  try {
    const b = req.body || {};
    CAMP_FIELDS.forEach((k) => {
      if (b[k] === undefined) return;
      if (k === 'price') CAMPAIGN[k] = Number(String(b[k]).replace(/\D/g, '')) || 0;
      else if (k === 'mode') CAMPAIGN[k] = (b[k] === '비대면') ? '비대면' : '대면';
      else if (k === 'crmPromo') CAMPAIGN[k] = toBool(b[k]);
      else CAMPAIGN[k] = String(b[k]);
    });
    await saveCampaign();
    res.json({ ok: true, campaign: CAMPAIGN });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// ── /campaign/activate: 다른 캠페인으로 전환 (화면 전체가 그 캠페인으로 바뀜) ──
app.post('/campaign/activate', async (req, res) => {
  const id = (req.body || {}).id;
  const found = setActiveCampaign(id);
  if (!found) return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
  await saveCampaign();
  res.json({ ok: true, activeId: ACTIVE_ID, campaign: CAMPAIGN });
});
// ── /campaign/new: 현재 캠페인을 통째 복제 → 새 캠페인 (콘텐츠는 안 따라옴, 강의정보만 새로) ──
app.post('/campaign/new', async (req, res) => {
  try {
    const b = req.body || {};
    const src = CAMPAIGN || CAMPAIGN_DEFAULT;
    const copy = normalizeCampaign(Object.assign({}, src, { id: '' }));   // 강의정보 복제 + 새 id
    if (b.title !== undefined && String(b.title).trim()) copy.title = String(b.title).trim();
    if (b.mode !== undefined) copy.mode = (b.mode === '비대면') ? '비대면' : '대면';
    CAMPAIGNS.push(copy);
    setActiveCampaign(copy.id);          // 만들면 바로 활성
    await saveCampaign();
    res.json({ ok: true, activeId: ACTIVE_ID, campaign: CAMPAIGN, count: CAMPAIGNS.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// ── /campaign/delete: 캠페인 삭제 (마지막 1개는 못 지움) + 그 캠페인 콘텐츠도 정리 ──
app.post('/campaign/delete', async (req, res) => {
  try {
    const id = (req.body || {}).id;
    if (CAMPAIGNS.length <= 1) return res.status(400).json({ error: '마지막 캠페인은 지울 수 없습니다.' });
    const before = CAMPAIGNS.length;
    CAMPAIGNS = CAMPAIGNS.filter((c) => c.id !== id);
    if (CAMPAIGNS.length === before) return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    const cBefore = CONTENTS.length;
    CONTENTS = CONTENTS.filter((c) => c.campaignId !== id);
    ensureCampaigns();
    await saveCampaign();
    if (CONTENTS.length !== cBefore) await saveContents();
    res.json({ ok: true, activeId: ACTIVE_ID, campaign: CAMPAIGN });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 콘텐츠 보관함 — 대표가 만든 포스터·쇼츠 등은 드라이브/유튜브에 두고 링크를 보관 ──
//    (Render 무료서버는 재시작 시 파일 소실 → 파일 자체가 아니라 링크+설명을 영구저장)
let CONTENTS = loadJson('콘텐츠.json'); if (!Array.isArray(CONTENTS)) CONTENTS = [];
const CONTENT_TAB = process.env.CONTENT_TAB || '제니야_콘텐츠';
async function saveContentsToSheet() {
  const sheets = sheetsClient();
  if (!sheets || !RESV_SHEET_ID) return;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: RESV_SHEET_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === CONTENT_TAB)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: RESV_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: CONTENT_TAB } } }] } });
  }
  const rows = CONTENTS.map((c) => [c.id, c.type || '', c.name || '', c.link || '', c.note || '', c.body || '', c.ts || '', c.campaignId || '']);
  await sheets.spreadsheets.values.clear({ spreadsheetId: RESV_SHEET_ID, range: `'${CONTENT_TAB}'!A1:Z` });
  await sheets.spreadsheets.values.update({ spreadsheetId: RESV_SHEET_ID, range: `'${CONTENT_TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: [['id', 'type', 'name', 'link', 'note', 'body', 'ts', 'campaignId'], ...rows] } });
}
let contentChain = Promise.resolve();
function saveContents() {
  saveJson('콘텐츠.json', CONTENTS);
  const next = contentChain.catch(() => {}).then(() => saveContentsToSheet());
  contentChain = next.catch((e) => console.warn('⚠️ 콘텐츠 시트 저장 실패:', e.message));
  return contentChain;
}
async function loadContentsFromSheet() {
  const sheets = sheetsClient();
  if (!sheets || !RESV_SHEET_ID) return null;
  let got;
  try { got = await sheets.spreadsheets.values.get({ spreadsheetId: RESV_SHEET_ID, range: `'${CONTENT_TAB}'!A2:H` }); }
  catch (e) { return null; }
  return (got.data.values || []).filter((r) => r[0]).map((r) => ({ id: r[0], type: r[1] || '', name: r[2] || '', link: r[3] || '', note: r[4] || '', body: r[5] || '', ts: r[6] || '', campaignId: r[7] || '' }));
}
(async () => { const fromSheet = await loadContentsFromSheet().catch(() => null); if (fromSheet) { CONTENTS = fromSheet; saveJson('콘텐츠.json', CONTENTS); } })();

// 활성 캠페인의 콘텐츠만 (campaignId 없는 옛 콘텐츠는 활성 캠페인 것으로 본다)
function myContents() { return CONTENTS.filter((c) => !c.campaignId || c.campaignId === ACTIVE_ID); }
app.get('/campaign/contents', (req, res) => res.json({ contents: myContents() }));
app.post('/campaign/contents', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.link && !b.name && !b.body) return res.status(400).json({ error: '이름·링크·내용 중 하나는 필요합니다.' });
    const item = { id: 'c' + Date.now() + Math.floor(Math.random() * 1000), type: String(b.type || '기타'), name: String(b.name || ''), link: String(b.link || ''), note: String(b.note || ''), body: String(b.body || ''), ts: new Date().toISOString(), campaignId: ACTIVE_ID };
    CONTENTS.push(item);
    await saveContents();
    res.json({ ok: true, item });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/campaign/contents/delete', async (req, res) => {
  const id = (req.body || {}).id;
  const before = CONTENTS.length;
  CONTENTS = CONTENTS.filter((c) => c.id !== id);
  if (CONTENTS.length !== before) await saveContents();
  res.json({ ok: true, removed: before - CONTENTS.length });
});

// ============================================================
// 파이어베이스 스토리지 — 큰 파일(쇼츠·오디오) 브라우저 직접 업로드
//   같은 프로젝트(moneya-72fe6) 서비스계정으로 서명 URL 발급 → 브라우저가 버킷에 직접 PUT
//   → 공개 다운로드 토큰 부여 → 링크 자동 보관. (무료서버는 파일 바이트를 안 거침)
// ============================================================
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'moneya-72fe6.firebasestorage.app';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 300);
const UPLOAD_KINDS = { '쇼츠': 1, '오디오': 1, '카드뉴스': 1, '텍스트': 1 };   // 파일 업로드 대상(영상·오디오·이미지·문서). 텍스트는 직접입력+파일첨부 병행
let _bucket = null;
function storageBucket() {
  if (_bucket) return _bucket;
  const creds = googleCreds();
  if (!creds) return null;
  const storage = new Storage({ projectId: creds.project_id, credentials: creds });
  _bucket = storage.bucket(STORAGE_BUCKET);
  return _bucket;
}
function safeName(s) { return String(s || 'file').replace(/[^\w.\-가-힣]/g, '_').slice(-80) || 'file'; }

// ① 업로드 허가증(서명 URL) 발급 — 브라우저가 이 URL로 버킷에 직접 PUT
app.post('/content/upload-url', async (req, res) => {
  try {
    const b = req.body || {};
    if (!UPLOAD_KINDS[b.kind]) return res.status(400).json({ error: '업로드 대상이 아닌 종류입니다.' });
    const bucket = storageBucket();
    if (!bucket) return res.status(503).json({ error: '스토리지가 아직 설정되지 않았습니다.' });
    const size = Number(b.size || 0);
    if (size > MAX_UPLOAD_MB * 1024 * 1024) return res.status(400).json({ error: `파일이 너무 큽니다(최대 ${MAX_UPLOAD_MB}MB).` });
    const contentType = String(b.contentType || 'application/octet-stream');
    const objectPath = `genya-content/${ACTIVE_ID || 'none'}/${b.kind}/${Date.now()}_${safeName(b.filename)}`;
    const [url] = await bucket.file(objectPath).getSignedUrl({
      version: 'v4', action: 'write', expires: Date.now() + 15 * 60 * 1000, contentType,
    });
    res.json({ ok: true, uploadUrl: url, objectPath, contentType });
  } catch (e) { console.warn('upload-url 오류:', e.message); res.status(500).json({ error: e.message }); }
});

// ② 업로드 완료 통보 — 공개 다운로드 토큰 부여 후 콘텐츠로 보관(링크 자동, 대표는 링크 안 만짐)
app.post('/content/uploaded', async (req, res) => {
  try {
    const b = req.body || {};
    if (!UPLOAD_KINDS[b.kind]) return res.status(400).json({ error: '종류 오류' });
    const bucket = storageBucket();
    if (!bucket) return res.status(503).json({ error: '스토리지 미설정' });
    const objectPath = String(b.objectPath || '');
    if (!objectPath) return res.status(400).json({ error: '파일 경로 누락' });
    const token = crypto.randomUUID();
    await bucket.file(objectPath).setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
    const link = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
    const item = { id: 'c' + Date.now() + Math.floor(Math.random() * 1000), type: String(b.kind), name: String(b.name || objectPath.split('/').pop()), link, note: '', body: '', ts: new Date().toISOString(), campaignId: ACTIVE_ID };
    CONTENTS.push(item);
    await saveContents();
    res.json({ ok: true, item });
  } catch (e) { console.warn('uploaded 오류:', e.message); res.status(500).json({ error: e.message }); }
});

// 스토리지 상태(설정됨?) — 화면이 업로드/링크 모드 결정에 사용
app.get('/storage/status', (req, res) => res.json({ configured: !!storageBucket(), bucket: STORAGE_BUCKET, maxMb: MAX_UPLOAD_MB }));
// CORS 초기화(브라우저 직접 업로드 허용) — 권한 부여 후 한 번 호출(멱등).
//   ※ 기존 CORS(AI머니야 등)를 덮어쓰지 않도록 읽어서 우리 규칙만 추가(병합).
app.get('/storage/init', async (req, res) => {
  try {
    const bucket = storageBucket();
    if (!bucket) return res.status(503).json({ error: '스토리지 자격 없음(서비스계정 키 확인)' });
    const [md] = await bucket.getMetadata();
    const existing = Array.isArray(md.cors) ? md.cors : [];
    const origins = (process.env.UPLOAD_ORIGINS || 'https://jenya.onrender.com,http://localhost:3000').split(',').map((s) => s.trim());
    const hasOurs = existing.some((r) => (r.origin || []).some((o) => origins.indexOf(o) >= 0));
    const ours = { origin: origins, method: ['PUT', 'GET', 'HEAD', 'OPTIONS'], responseHeader: ['Content-Type', 'x-goog-resumable'], maxAgeSeconds: 3600 };
    const merged = hasOurs ? existing : existing.concat([ours]);
    if (!hasOurs) await bucket.setCorsConfiguration(merged);
    res.json({ ok: true, alreadySet: hasOurs, rules: merged.length, preservedExisting: existing.length, origins });
  } catch (e) { res.status(500).json({ error: e.message, hint: 'jenya-server 서비스계정에 Storage 관리자(roles/storage.admin) 권한이 필요합니다(버킷 권한에서 부여).' }); }
});

// ============================================================
// Phase 2 길A(완전자동) — 쇼츠 → Make.com 웹훅 → Buffer 예약
//   승인 1번이면: 제니야가 날짜·채널·문구 계획을 만들어 Make 웹훅으로 POST → Make가 Buffer로 인스타·페북·유튜브·틱톡 예약
//   ※ Buffer 인증은 Make의 Buffer 모듈(OAuth)이 처리. 제니야엔 Buffer 키 불필요. MAKE_WEBHOOK_URL만 설정.
// ============================================================
let DEPLOYS = loadJson('배포.json'); if (!Array.isArray(DEPLOYS)) DEPLOYS = [];
const DEPLOY_CHANNELS = (process.env.DEPLOY_CHANNELS || 'instagram,facebook,youtube,tiktok').split(',').map((s) => s.trim());
function planDateISO(i) {            // 시작일(기본 내일)부터 간격(기본 1일)마다, 시각(기본 오전10시 KST)
  const hourKst = Number(process.env.POST_HOUR_KST || 10);     // 예약 시각(KST 시) — env로 변경
  const interval = Number(process.env.POST_INTERVAL_DAYS || 1); // 며칠 간격 (1=매일, 2=격일)
  const startOff = Number(process.env.POST_START_OFFSET_DAYS || 1); // 며칠 뒤부터 (1=내일)
  const k = new Date(Date.now() + 9 * 3600 * 1000);            // 지금(KST)
  // KST hourKst = UTC (hourKst-9). Date.UTC가 음수 시각도 올바른 순간으로 환산.
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + startOff + i * interval, hourKst - 9, 0, 0)).toISOString();
}
function extractCopy(facts) {   // 홍보사실에서 "대표 카피: ..." 한 줄만 추출(있으면 후크로)
  const m = String(facts || '').match(/대표\s*카피\s*[:：]\s*["“']?\s*([^"”'\/\n]+?)\s*["”']?\s*(?:\/|\n|$)/);
  return m ? m[1].trim() : '';
}
// SNS 쇼츠용 짧은 caption (5~7줄): 핵심카피 → 강의명·형식 → 개강일 → 신청링크 → 카톡 → 해시태그
function shortsCaption(c) {
  const lines = [];
  const copy = extractCopy(c.facts);
  lines.push('💰 ' + (copy || c.name || '강의'));
  const form = (c.mode === '비대면') ? '줌 과정' : '대면 과정';
  if (copy && c.name) lines.push(`${c.name} · ${form}`);  // 후크가 카피일 때만 강의명 줄 추가(중복 방지)
  else lines.push(form);
  const open = ymdToDate(c.startDate) || parseOpenDate(c.date);
  if (open) lines.push(`📅 ${open.getUTCMonth() + 1}/${open.getUTCDate()} 개강`);
  if (c.applyLink) lines.push(`▶ 신청 ${c.applyLink}`);
  if (c.kakaoChannel) lines.push(`카톡 '${c.kakaoChannel}' 검색→친구추가`);
  lines.push(c.hashtags || process.env.POST_HASHTAGS || '#재테크 #재무설계 #목돈마련 #맞벌이');
  return lines.join('\n');
}
function capTitle(s) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > 90 ? s.slice(0, 89).trim() + '…' : s; }
// 채널별 caption: 유튜브=짧은 제목+긴 설명 / 인스타=해시태그 많이 / 페북·틱톡=공통 짧은 본문
function buildCaptions(c) {
  const copy = extractCopy(c.facts);
  const hook = copy || c.name || '강의';
  const base = shortsCaption(c);                                  // 공통 짧은 본문(해시태그 포함)
  const tags = c.hashtags || process.env.POST_HASHTAGS || '#재테크 #재무설계 #목돈마련 #맞벌이';
  const open = ymdToDate(c.startDate) || parseOpenDate(c.date);
  const openStr = open ? `${open.getUTCMonth() + 1}/${open.getUTCDate()} 개강` : '';
  const ytTitle = capTitle(c.name ? `${hook} | ${c.name}` : hook);   // 유튜브 제목 ≤90자(제한 100 안전)
  const ytDesc = ['💰 ' + hook, c.name || '', openStr, c.date ? ('일정: ' + c.date) : '',
    c.applyLink ? ('▶ 신청 ' + c.applyLink) : '', c.kakaoChannel ? (`카톡 '${c.kakaoChannel}' 검색→친구추가`) : '', tags].filter(Boolean).join('\n');
  return {
    title: ytTitle,                       // 안전한 기본 제목(≤90) — 유튜브 필수 충족
    description: ytDesc,                   // 유튜브·페북 설명(설명 중심)
    youtube_title: ytTitle,
    instagram_title: base + ' #쇼츠 #릴스 #돈공부 #경제공부',   // 인스타: 해시태그 더
    facebook_title: base,
    tiktok_title: base,
  };
}
function buildPlan(kind) {
  const c = CAMPAIGN || {};
  const items = myContents().filter((x) => x.type === kind && x.link);
  return items.map((s, i) => ({
    name: s.name || '', mediaUrl: s.link, scheduledAt: planDateISO(i),
    channels: DEPLOY_CHANNELS, caption: shortsCaption(c),
  }));
}
// ── 발행 도구 = Upload-Post (API 하나로 인스타·페북·유튜브·틱톡 직접 예약. Make·Buffer 불필요) ──
//   대표님 1회: upload-post.com 가입 → 프로필에 내 SNS 연결 → API 키. 그 뒤는 제니야가 코드로 예약.
const UPLOADPOST_URL = process.env.UPLOADPOST_URL || 'https://api.upload-post.com/api/upload';
function posterReady() { return !!(process.env.UPLOADPOST_API_KEY && process.env.UPLOADPOST_USER); }
async function postOneToUploadPost(p, c) {
  const caps = buildCaptions(c);
  const form = new FormData();
  form.append('user', process.env.UPLOADPOST_USER);
  (p.channels || DEPLOY_CHANNELS).forEach((ch) => form.append('platform[]', ch));
  form.append('video', p.mediaUrl);              // 공개 URL 허용(파이어베이스 링크)
  form.append('title', caps.title);              // 안전한 짧은 제목(≤90) — 유튜브 100자 제한 충족
  form.append('description', caps.description);  // 유튜브·페북 설명(설명 중심)
  form.append('youtube_title', caps.youtube_title);
  form.append('instagram_title', caps.instagram_title);   // 인스타: 해시태그 많이
  form.append('facebook_title', caps.facebook_title);
  form.append('tiktok_title', caps.tiktok_title);
  if (p.scheduledAt) { form.append('scheduled_date', p.scheduledAt); form.append('timezone', 'Asia/Seoul'); }
  form.append('async_upload', 'true');
  const r = await fetch(UPLOADPOST_URL, { method: 'POST', headers: { Authorization: `Apikey ${process.env.UPLOADPOST_API_KEY}` }, body: form });
  const body = await r.text().catch(() => '');
  let job = ''; try { const j = JSON.parse(body); job = j.job_id || j.id || ''; } catch (e) {}
  return { ok: r.ok, status: r.status, job, body: String(body).slice(0, 300) };
}

// 배포 계획 미리보기 (날짜·채널·문구)
app.get('/content/plan', (req, res) => {
  const kind = req.query.kind || '쇼츠';
  const posts = buildPlan(kind);
  const approved = DEPLOYS.find((d) => d.campaignId === ACTIVE_ID && d.kind === kind) || null;
  res.json({ webhookConfigured: posterReady(), count: posts.length, posts, approved });
});
// 승인 → Upload-Post로 각 쇼츠를 인스타·페북·유튜브·틱톡에 직접 예약
app.post('/content/plan/approve', async (req, res) => {
  try {
    const kind = (req.body || {}).kind || '쇼츠';
    if (!posterReady()) return res.status(400).json({ error: '발행 도구가 아직 연결되지 않았습니다. Render에 UPLOADPOST_API_KEY·UPLOADPOST_USER를 넣어 주세요.' });
    const posts = buildPlan(kind);
    if (!posts.length) return res.status(400).json({ error: '예약할 ' + kind + '가 없습니다. 먼저 업로드하세요.' });
    const c = CAMPAIGN || {};
    let sent = 0; const fails = []; const results = [];
    for (let i = 0; i < posts.length; i++) {
      const out = await postOneToUploadPost(posts[i], c);
      if (out.ok) { sent++; results.push({ i: i + 1, job: out.job }); } else fails.push({ i: i + 1, status: out.status, body: out.body });
      if (i < posts.length - 1) await new Promise((rs) => setTimeout(rs, 400));
    }
    if (!sent) return res.status(502).json({ error: '발행 도구가 모두 거부했습니다.', fails });
    DEPLOYS = DEPLOYS.filter((d) => !(d.campaignId === ACTIVE_ID && d.kind === kind));
    DEPLOYS.push({ campaignId: ACTIVE_ID, kind, approvedAt: new Date().toISOString(), count: sent });
    saveJson('배포.json', DEPLOYS);
    try { pushNotify({ kind: 'report', title: `${kind} ${sent}건 SNS 예약 완료`, body: c.name || '' }); } catch (e) {}
    res.json({ ok: true, count: sent, failed: fails.length, fails, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 발행 이력 조회 (재업로드 없이 job_id·채널별 상태 확인) ──
app.get('/content/jobs', async (req, res) => {
  if (!posterReady()) return res.status(400).json({ error: '발행 도구 미연결' });
  try {
    const r = await fetch('https://api.upload-post.com/api/uploadposts/history', { headers: { Authorization: `Apikey ${process.env.UPLOADPOST_API_KEY}` } });
    const text = await r.text().catch(() => '');
    let data; try { data = JSON.parse(text); } catch (e) { data = String(text).slice(0, 2000); }
    res.status(r.ok ? 200 : 502).json({ status: r.status, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// Phase 4 — 텍스트(docx) → 블로그 8편 연재 (제니야가 떠먹여주는 반자동)
//   추출 → 제N편 분리 → 편별 블로그 글 재구성(LLM, 저품질 방지) → 격일 일정 → 코치 UI(복사·네이버 글쓰기·발행완료)
//   네이버는 자동발행 막힘/탐지 위험 → 발행만 대표 손(복사붙여넣기), 그 외 전부 자동.
// ============================================================
let SERIES = loadJson('블로그.json'); if (!Array.isArray(SERIES)) SERIES = [];
const BLOG_TAB = process.env.BLOG_TAB || '제니야_블로그연재';
let blogChain = Promise.resolve();
async function saveSeriesToSheet() {
  const sheets = sheetsClient(); if (!sheets || !RESV_SHEET_ID) return;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: RESV_SHEET_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === BLOG_TAB)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: RESV_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: BLOG_TAB } } }] } });
  }
  await sheets.spreadsheets.values.update({ spreadsheetId: RESV_SHEET_ID, range: `'${BLOG_TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: [['series', JSON.stringify(SERIES)]] } });
}
function saveSeries() {
  saveJson('블로그.json', SERIES);
  blogChain = blogChain.catch(() => {}).then(() => saveSeriesToSheet()).catch((e) => console.warn('⚠️ 블로그 시트 저장 실패:', e.message));
  return blogChain;
}
(async () => {
  const sheets = sheetsClient(); if (!sheets || !RESV_SHEET_ID) return;
  try {
    const got = await sheets.spreadsheets.values.get({ spreadsheetId: RESV_SHEET_ID, range: `'${BLOG_TAB}'!A1:B1` });
    const row = (got.data.values || [])[0]; if (row && row[0] === 'series' && row[1]) { const arr = JSON.parse(row[1]); if (Array.isArray(arr)) { SERIES = arr; saveJson('블로그.json', SERIES); console.log(`📖 블로그 연재 복원: ${SERIES.length}개`); } }
  } catch (e) {}
})();

function addDaysYMD(days) { const n = new Date(Date.now() + 9 * 3600 * 1000); n.setUTCDate(n.getUTCDate() + days); return n.toISOString().slice(0, 10); }
async function extractTextFromUrl(url) {
  const res = await fetch(url); if (!res.ok) throw new Error('파일 다운로드 실패 ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const path0 = decodeURIComponent(String(url).split('?')[0]).toLowerCase();
  if (path0.endsWith('.docx')) { const mammoth = require('mammoth'); return (await mammoth.extractRawText({ buffer: buf })).value || ''; }
  if (path0.endsWith('.pdf')) { const pdf = require('pdf-parse/lib/pdf-parse.js'); return (await pdf(buf)).text || ''; }
  return buf.toString('utf8');
}
function splitEpisodes(text) {
  text = String(text || '').replace(/\r/g, '');
  const re = /제\s*(\d+)\s*편/g; const marks = []; let m;
  while ((m = re.exec(text))) marks.push({ n: Number(m[1]), idx: m.index });
  const segs = marks.map((mk, i) => ({ n: mk.n, srcText: text.slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : text.length).trim() }));
  const byN = {};
  segs.forEach((s) => {
    const lines = s.srcText.split('\n').map((x) => x.trim()).filter(Boolean);
    let topic = ''; for (const ln of lines) { const t = ln.replace(/^제\s*\d+\s*편\s*[.:)]?\s*/, '').trim(); if (t) { topic = t; break; } }
    s.srcTitle = (topic || ('제' + s.n + '편')).trim().slice(0, 40);   // 주제명만(목록이 "N편"을 이미 붙임)
    if (!byN[s.n] || s.srcText.length > byN[s.n].srcText.length) byN[s.n] = s; // 목차(짧음) vs 본문(긺) → 긴 것
  });
  return Object.keys(byN).map((k) => byN[k]).sort((a, b) => a.n - b.n);
}
function activeSeries() { return SERIES.find((s) => s.campaignId === ACTIVE_ID) || null; }
function parseBlog(t) {
  t = String(t || '');
  const g = (re) => (t.match(re) || [])[1] || '';
  let title = g(/\[제목\]\s*([\s\S]*?)\s*\[본문\]/).trim();
  let body = g(/\[본문\]\s*([\s\S]*?)\s*\[해시태그\]/).trim();
  let tags = g(/\[해시태그\]\s*([\s\S]*)$/).trim();
  if (!title && !body) { const lines = t.trim().split('\n'); title = (lines.shift() || '').trim(); body = lines.join('\n').trim(); }
  return { title, body, hashtags: tags };
}
// 강의정보 기반 CTA 블록 (6/25 개강·4주 목요일 줌·55만 — date에서 자동 추출). 8편 공통.
function ctaBlock(c) {
  const open = ymdToDate(c.startDate) || parseOpenDate(c.date);
  const dateStr = open ? `${open.getUTCFullYear()}년 ${open.getUTCMonth() + 1}월 ${open.getUTCDate()}일 개강` : '';
  const wk = (String(c.date).match(/(\d+)\s*주/) || [])[1];
  const dow = (String(c.date).match(/([월화수목금토일])\s*요일/) || [])[1];
  const place = (c.mode === '비대면') ? '줌' : '대면';
  const won = c.price ? `${Math.round(Number(c.price) / 10000)}만원` : '';
  const inner = [wk ? wk + '주' : '', dow ? dow + '요일' : '', place].filter(Boolean).join(' ') + (won ? ', ' + won : '');
  const lines = [];
  if (dateStr) lines.push(`📅 ${dateStr} (${inner})`);
  if (c.applyLink) lines.push(`▶ ${c.name || '강의'} 신청: ${c.applyLink}`);
  if (c.kakaoChannel) lines.push(`카카오톡 '${c.kakaoChannel}' 검색 → 채널 추가`);
  return lines.join('\n');
}
async function rewriteEpisode(c, ep) {
  const system = '당신은 오원트금융연구소 오상열 대표(CFP 25년, 금융연수원 외래교수)의 1인칭 관점으로 쓰는 네이버 블로그 글 작가입니다. 실제 강의 내용을 바탕으로, 검색에 잘 걸리고 신뢰가는 고품질 글을 씁니다. 저품질(채우기 텍스트, 의미 없는 반복, 과장·수익보장)은 절대 금지. 1인칭 경험·전문가 관점, 소제목으로 구조화, 구체적 예시.';
  const ask = `다음 강의 내용을 네이버 블로그 글 1편으로 재구성해 주세요.\n\n[원본: 제${ep.n}편]\n${String(ep.srcText).slice(0, 6000)}\n\n[요구사항]\n- 도입(공감 후크) → 본문(## 소제목 3~5개, 구체 설명·예시) → 마무리(요약+행동제안)\n- 1인칭("제가 25년간…"), 전문가 관점, 검색 잘 되게 핵심 키워드 자연스럽게\n- ⚠️ 본문에는 신청링크·카톡채널·CTA·연락처를 넣지 마세요 (시스템이 맨 끝에 자동으로 붙입니다)\n- 해시태그 8~12개 (재테크·재무설계 등 + 이 편 주제 키워드)\n- 분량 1200~1800자, 마크다운(소제목 ##) 사용\n\n[출력 형식 — 이 마커 그대로]\n[제목]\n(한 줄 제목)\n[본문]\n(마크다운 본문, CTA 없이)\n[해시태그]\n(#태그들)`;
  const r = await anthropic.messages.create({ model: MODEL, max_tokens: 4000, system, messages: [{ role: 'user', content: ask }] });
  const out = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const p = parseBlog(out);
  const fullText = [p.title, '', p.body, '', '─────────────', ctaBlock(c), '', p.hashtags].filter((x) => x !== undefined).join('\n').trim();
  return { title: p.title || ep.srcTitle, body: p.body, hashtags: p.hashtags, fullText };
}

// 연재 만들기: 추출 → 분리 → 일정(격일) → 저장 (글 재구성은 발행일에 lazy)
app.post('/blog/build', async (req, res) => {
  try {
    const c = CAMPAIGN || {};
    const b = req.body || {};
    const mine = myContents().filter((x) => x.type === '텍스트');
    let src = b.contentId ? mine.find((x) => x.id === b.contentId) : null;
    if (!src) src = mine.find((x) => x.link) || mine.find((x) => x.body); // 파일 우선, 없으면 직접입력
    if (!src) return res.status(400).json({ error: '텍스트 칸에 docx/pdf 파일이나 글이 없습니다.' });
    const text = src.link ? await extractTextFromUrl(src.link) : String(src.body || '');
    if (!text || text.length < 50) return res.status(400).json({ error: '추출된 텍스트가 너무 짧습니다(추출 실패?).' });
    let eps = splitEpisodes(text);
    if (eps.length < 2) return res.status(400).json({ error: `"제N편" 목차를 못 찾았습니다(찾은 편수 ${eps.length}). 원본 목차 표기를 확인하세요.` });
    const interval = Number(process.env.BLOG_INTERVAL_DAYS || 2);
    const startOff = Number(process.env.BLOG_START_OFFSET || 0);
    const episodes = eps.map((e, i) => ({ n: e.n, srcTitle: e.srcTitle, srcText: e.srcText, scheduledDate: addDaysYMD(startOff + i * interval), published: false, publishedAt: '', blog: null }));
    SERIES = SERIES.filter((s) => s.campaignId !== ACTIVE_ID);
    SERIES.push({ campaignId: ACTIVE_ID, sourceContentId: src.id, createdAt: new Date().toISOString(), intervalDays: interval, episodes });
    await saveSeries();
    res.json({ ok: true, count: episodes.length, episodes: episodes.map((e) => ({ n: e.n, title: e.srcTitle, scheduledDate: e.scheduledDate, chars: e.srcText.length })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// 상태: 오늘 발행할 편(없으면 다음 편 날짜) + 진행률. 오늘 편은 글을 lazy 생성·캐시.
app.get('/blog/status', async (req, res) => {
  try {
    const s = activeSeries();
    if (!s) return res.json({ hasSeries: false });
    const today = addDaysYMD(0);
    const total = s.episodes.length;
    const publishedCount = s.episodes.filter((e) => e.published).length;
    const due = s.episodes.find((e) => !e.published && e.scheduledDate <= today);
    const nextUp = s.episodes.find((e) => !e.published && e.scheduledDate > today);
    let todayEp = null;
    if (due) {
      if (!due.blog) { const c = CAMPAIGN || {}; due.blog = await rewriteEpisode(c, due); await saveSeries(); }
      todayEp = { n: due.n, title: due.blog.title, fullText: due.blog.fullText, scheduledDate: due.scheduledDate };
    }
    res.json({
      hasSeries: true, total, publishedCount,
      today: todayEp,
      next: nextUp ? { n: nextUp.n, date: nextUp.scheduledDate } : null,
      allDone: publishedCount >= total,
      episodes: s.episodes.map((e) => ({ n: e.n, title: (e.blog && e.blog.title) || e.srcTitle, scheduledDate: e.scheduledDate, published: e.published })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// 한 편 발행 완료 표시
app.post('/blog/published', async (req, res) => {
  const n = Number((req.body || {}).n);
  const s = activeSeries(); if (!s) return res.status(400).json({ error: '연재 없음' });
  const ep = s.episodes.find((e) => e.n === n); if (!ep) return res.status(404).json({ error: '해당 편 없음' });
  ep.published = true; ep.publishedAt = new Date().toISOString();
  await saveSeries();
  try { pushNotify({ kind: 'report', title: `블로그 ${n}편 발행 완료`, body: (ep.blog && ep.blog.title) || ep.srcTitle }); } catch (e) {}
  res.json({ ok: true });
});

// ============================================================
// 키워드 소셜리스닝 — 관심자 명단 자동 수집 (공식 무료 API: 유튜브 댓글 + 네이버 검색)
//   완전 자동·합법·무료. 접촉(댓글·DM)은 대표 직접(계정보호). 공통 리드 엔진.
// ============================================================
let LEADS = loadJson('관심자.json'); if (!Array.isArray(LEADS)) LEADS = [];
const LEADS_TAB = process.env.LEADS_TAB || '제니야_관심자명단';
let leadsChain = Promise.resolve();
async function saveLeadsToSheet() {
  const sheets = sheetsClient(); if (!sheets || !RESV_SHEET_ID) return;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: RESV_SHEET_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === LEADS_TAB)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: RESV_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: LEADS_TAB } } }] } });
  }
  const rows = LEADS.slice(-2000).map((l) => [l.ts, l.source, l.author, l.text, l.link, l.keyword, l.campaignId]);
  await sheets.spreadsheets.values.clear({ spreadsheetId: RESV_SHEET_ID, range: `'${LEADS_TAB}'!A1:Z` });
  await sheets.spreadsheets.values.update({ spreadsheetId: RESV_SHEET_ID, range: `'${LEADS_TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: [['ts', 'source', 'author', 'text', 'link', 'keyword', 'campaignId'], ...rows] } });
}
function saveLeads() { saveJson('관심자.json', LEADS); leadsChain = leadsChain.catch(() => {}).then(() => saveLeadsToSheet()).catch((e) => console.warn('⚠️ 관심자 시트 저장 실패:', e.message)); return leadsChain; }
(async () => { const sheets = sheetsClient(); if (!sheets || !RESV_SHEET_ID) return; try { const got = await sheets.spreadsheets.values.get({ spreadsheetId: RESV_SHEET_ID, range: `'${LEADS_TAB}'!A2:G` }); const rows = got.data.values || []; if (rows.length) { LEADS = rows.filter((r) => r[4]).map((r) => ({ ts: r[0], source: r[1], author: r[2], text: r[3], link: r[4], keyword: r[5], campaignId: r[6] })); saveJson('관심자.json', LEADS); console.log(`🔍 관심자 명단 복원: ${LEADS.length}건`); } } catch (e) {} })();

function leadsKeywords() {
  const raw = String((CAMPAIGN || {}).listenKeywords || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  return raw.length ? raw : ['재테크', '맞벌이 재테크', '10억 모으기', '종잣돈', '목돈 마련', '재무설계', '노후준비', '경제적 자유', 'FIRE', '직장인 재테크', '적금 추천', '투자 초보', '가계부', '돈 안 모임', '부자되는 법'];
}
const LEAD_INTENT = /(어떻게|어떡|추천|모으|모이|막막|시작|초보|고민|할까요|방법|좋을까|궁금|문의|해야|도와|알려|얼마)/;
function leadKey(l) { return (l.link || '') + '|' + (l.author || '') + '|' + String(l.text || '').slice(0, 20); }
async function collectYouTube(keywords, key) {
  const out = [];
  for (const kw of keywords) {
    let s; try { s = await (await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=4&q=${encodeURIComponent(kw)}&key=${key}`)).json(); } catch (e) { continue; }
    for (const it of (s.items || [])) {
      const vid = it.id && it.id.videoId; if (!vid) continue;
      let cs; try { cs = await (await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&maxResults=15&order=relevance&videoId=${vid}&key=${key}`)).json(); } catch (e) { continue; }
      (cs.items || []).forEach((ci) => { const sn = ci.snippet && ci.snippet.topLevelComment && ci.snippet.topLevelComment.snippet; if (!sn) return; const text = String(sn.textOriginal || ''); if (!LEAD_INTENT.test(text)) return; out.push({ source: '유튜브', author: sn.authorDisplayName || '', text: text.slice(0, 160), link: `https://www.youtube.com/watch?v=${vid}&lc=${ci.id}`, keyword: kw }); });
    }
  }
  return out;
}
async function collectNaver(keywords, id, secret) {
  const out = []; const hdr = { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret };
  const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim();
  for (const kw of keywords) {
    for (const [api, src, af] of [['kin', '네이버 지식iN', null], ['cafearticle', '네이버 카페', null], ['blog', '네이버 블로그', 'bloggername']]) {
      let r; try { r = await (await fetch(`https://openapi.naver.com/v1/search/${api}.json?display=5&sort=date&query=${encodeURIComponent(kw)}`, { headers: hdr })).json(); } catch (e) { continue; }
      (r.items || []).forEach((it) => { out.push({ source: src, author: af ? strip(it[af]) : '', text: strip(it.title), link: it.link || '', keyword: kw }); });
    }
  }
  return out;
}
function leadsConfigured() { return !!(process.env.YOUTUBE_API_KEY || (process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET)); }
async function runLeadCollect() {
  if (!leadsConfigured()) return { error: '무료 API 키 미설정 (YOUTUBE_API_KEY 또는 NAVER_CLIENT_ID/SECRET).' };
  const kws = leadsKeywords().slice(0, 6);   // 할당량 보호: 회당 6개 키워드
  let found = [];
  if (process.env.YOUTUBE_API_KEY) { try { found = found.concat(await collectYouTube(kws, process.env.YOUTUBE_API_KEY)); } catch (e) {} }
  if (process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) { try { found = found.concat(await collectNaver(kws, process.env.NAVER_CLIENT_ID, process.env.NAVER_CLIENT_SECRET)); } catch (e) {} }
  const seen = new Set(LEADS.map(leadKey)); let added = 0; const now = new Date().toISOString();
  found.forEach((l) => { const k = leadKey(l); if (l.link && !seen.has(k)) { seen.add(k); LEADS.push({ id: 'l' + Date.now() + Math.floor(Math.random() * 1000), ts: now, campaignId: ACTIVE_ID, source: l.source, author: l.author, text: l.text, link: l.link, keyword: l.keyword }); added++; } });
  if (added) { await saveLeads(); try { pushNotify({ kind: 'report', title: `관심자 ${added}명 새로 수집`, body: kws.slice(0, 3).join(', ') }); } catch (e) {} }
  return { ok: true, added, total: LEADS.length };
}
let LEAD_LAST_DAY = '';
async function runDueLeads() { if (!leadsConfigured()) return; const d = addDaysYMD(0); if (d === LEAD_LAST_DAY) return; LEAD_LAST_DAY = d; await runLeadCollect().catch(() => {}); }
app.post('/leads/collect', async (req, res) => { try { res.json(await runLeadCollect()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/leads/today', (req, res) => {
  const today = addDaysYMD(0);
  const mine = LEADS.filter((l) => !l.campaignId || l.campaignId === ACTIVE_ID);
  const todayList = mine.filter((l) => String(l.ts).slice(0, 10) === today);
  const show = (todayList.length ? todayList : mine).slice(-40).reverse();
  res.json({ configured: leadsConfigured(), todayCount: todayList.length, total: mine.length, leads: show.map((l) => ({ source: l.source, author: l.author, text: l.text, link: l.link, keyword: l.keyword })) });
});

// ============================================================
// 대표 유튜브 채널 댓글 → 가망고객 발굴 (핫/웜, 무료 YouTube Data API · API키만)
//   대표 본인 채널 공개 댓글 읽기 = 합법·무료. 답글(접촉)은 대표 직접(계정보호).
// ============================================================
let YTLEADS = loadJson('유튜브리드.json'); if (!Array.isArray(YTLEADS)) YTLEADS = [];
const YTLEADS_TAB = process.env.YTLEADS_TAB || '제니야_유튜브리드';
const YT_HANDLE = (process.env.YT_CHANNEL_HANDLE || 'OhSangRyul').replace(/^@/, '');
const YT_HOT = /(상담|신청|연락|등록|수강|문의|디엠|dm|카톡|어떻게\s*신청)/i;
const YT_WARM = /(고민|10억|억\s*모|재테크|종잣돈|목돈|노후|돈\s*안?\s*모|얼마|어떻게\s*모|시작|초보|추천|투자|적금|가계부|모으|모이)/;
function ytTier(t) { if (YT_HOT.test(t)) return '🔥핫'; if (YT_WARM.test(t)) return '🌤웜'; return ''; }
let ytChain = Promise.resolve();
async function saveYtLeadsToSheet() {
  const sheets = sheetsClient(); if (!sheets || !RESV_SHEET_ID) return;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: RESV_SHEET_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === YTLEADS_TAB)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: RESV_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: YTLEADS_TAB } } }] } });
  }
  const rows = YTLEADS.slice(-2000).map((l) => [l.ts, l.tier, l.author, l.text, l.link, l.videoTitle, l.commentId]);
  await sheets.spreadsheets.values.clear({ spreadsheetId: RESV_SHEET_ID, range: `'${YTLEADS_TAB}'!A1:Z` });
  await sheets.spreadsheets.values.update({ spreadsheetId: RESV_SHEET_ID, range: `'${YTLEADS_TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: [['ts', 'tier', 'author', 'text', 'link', 'videoTitle', 'commentId'], ...rows] } });
}
function saveYtLeads() { saveJson('유튜브리드.json', YTLEADS); ytChain = ytChain.catch(() => {}).then(() => saveYtLeadsToSheet()).catch((e) => console.warn('⚠️ 유튜브리드 시트 저장 실패:', e.message)); return ytChain; }
(async () => { const sheets = sheetsClient(); if (!sheets || !RESV_SHEET_ID) return; try { const got = await sheets.spreadsheets.values.get({ spreadsheetId: RESV_SHEET_ID, range: `'${YTLEADS_TAB}'!A2:G` }); const rows = got.data.values || []; if (rows.length) { YTLEADS = rows.filter((r) => r[6]).map((r) => ({ ts: r[0], tier: r[1], author: r[2], text: r[3], link: r[4], videoTitle: r[5], commentId: r[6] })); saveJson('유튜브리드.json', YTLEADS); console.log(`▶️ 유튜브 리드 복원: ${YTLEADS.length}건`); } } catch (e) {} })();

async function ytUploadsPlaylist(key) {
  let r; try { r = await (await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=${encodeURIComponent(YT_HANDLE)}&key=${key}`)).json(); } catch (e) { return null; }
  let item = (r.items || [])[0];
  if (!item) { // 핸들로 못 찾으면 검색 폴백
    try { const s = await (await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(YT_HANDLE)}&key=${key}`)).json(); const cid = s.items && s.items[0] && s.items[0].id && s.items[0].id.channelId; if (cid) { const r2 = await (await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${cid}&key=${key}`)).json(); item = (r2.items || [])[0]; } } catch (e) {}
  }
  return item && item.contentDetails && item.contentDetails.relatedPlaylists && item.contentDetails.relatedPlaylists.uploads;
}
async function runYtLeadCollect() {
  const key = process.env.YOUTUBE_API_KEY; if (!key) return { error: 'YOUTUBE_API_KEY 미설정' };
  const uploads = await ytUploadsPlaylist(key); if (!uploads) return { error: `채널을 찾지 못했습니다(@${YT_HANDLE}). 핸들(YT_CHANNEL_HANDLE) 확인.` };
  const maxV = Math.min(Number(process.env.YT_MAX_VIDEOS || 30), 50);
  let pl; try { pl = await (await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails,snippet&maxResults=${maxV}&playlistId=${uploads}&key=${key}`)).json(); } catch (e) { return { error: '영상 목록 조회 실패' }; }
  const vids = (pl.items || []).map((it) => ({ id: it.contentDetails && it.contentDetails.videoId, title: it.snippet && it.snippet.title })).filter((v) => v.id);
  const seen = new Set(YTLEADS.map((l) => l.commentId)); let added = 0; const now = new Date().toISOString();
  for (const v of vids) {
    let cs; try { cs = await (await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&order=time&maxResults=50&videoId=${v.id}&key=${key}`)).json(); } catch (e) { continue; }
    (cs.items || []).forEach((ci) => {
      const sn = ci.snippet && ci.snippet.topLevelComment && ci.snippet.topLevelComment.snippet; if (!sn) return;
      const text = String(sn.textOriginal || ''); const tier = ytTier(text); if (!tier) return;
      if (seen.has(ci.id)) return; seen.add(ci.id);
      YTLEADS.push({ commentId: ci.id, ts: now, tier, author: sn.authorDisplayName || '', text: text.slice(0, 200), link: `https://www.youtube.com/watch?v=${v.id}&lc=${ci.id}`, videoTitle: v.title || '', publishedAt: sn.publishedAt || '' });
      added++;
    });
  }
  if (added) { await saveYtLeads(); try { pushNotify({ kind: 'report', title: `유튜브 가망고객 ${added}명 발굴`, body: '@' + YT_HANDLE }); } catch (e) {} }
  return { ok: true, added, total: YTLEADS.length };
}
let YT_LAST_DAY = '';
async function runDueYtLeads() { if (!process.env.YOUTUBE_API_KEY) return; const d = addDaysYMD(0); if (d === YT_LAST_DAY) return; YT_LAST_DAY = d; await runYtLeadCollect().catch(() => {}); }
app.post('/ytleads/collect', async (req, res) => { try { res.json(await runYtLeadCollect()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/ytleads/today', (req, res) => {
  const today = addDaysYMD(0);
  const todayList = YTLEADS.filter((l) => String(l.ts).slice(0, 10) === today);
  const show = (todayList.length ? todayList : YTLEADS).slice();
  const ord = { '🔥핫': 0, '🌤웜': 1 };
  show.sort((a, b) => (ord[a.tier] != null ? ord[a.tier] : 9) - (ord[b.tier] != null ? ord[b.tier] : 9));
  res.json({ configured: !!process.env.YOUTUBE_API_KEY, handle: '@' + YT_HANDLE, todayCount: todayList.length, total: YTLEADS.length, hot: YTLEADS.filter((l) => l.tier === '🔥핫').length, leads: show.slice(0, 50).map((l) => ({ tier: l.tier, author: l.author, text: l.text, link: l.link, video: l.videoTitle })) });
});

// ── 진단: 발행 도구(Upload-Post) 연결 상태 (키는 가려서) ──
app.get('/content/webhook-check', (req, res) => {
  const key = process.env.UPLOADPOST_API_KEY || '';
  res.json({
    posterReady: posterReady(),
    provider: 'upload-post',
    apiKeySet: !!key, apiKeyTail: key ? key.slice(-4) : '',
    user: process.env.UPLOADPOST_USER || '(미설정)',
    endpoint: UPLOADPOST_URL,
    channels: DEPLOY_CHANNELS,
  });
});

// ── /promo/status: CRM 손 상태 + 비용 예상 ───────────────────
app.get('/promo/status', async (req, res) => {
  runDuePromo().catch(() => {});   // 앱을 열어 서버가 깨면 밀린 예약부터 확인
  const out = {
    crmSheet: !!CRM_SHEET_ID, solapi: !!solapi, sender: !!SOLAPI_SENDER,
    crmPromo: !!CAMPAIGN.crmPromo,   // 이 캠페인이 CRM 설계사 문자 대상인지 (false면 SNS 매스)
    dailyLimit: PROMO_DAILY_LIMIT, unitPrice: PROMO_UNIT_PRICE,
    pendingBatches: PROMO.filter((b) => b.status === '대기').map((b) => ({
      batchId: b.batchId, count: b.items.length, cost: b.items.length * PROMO_UNIT_PRICE, ts: b.ts, text: b.text,
    })),
    scheduledBatches: PROMO.filter((b) => b.status === '예약').map((b) => ({
      batchId: b.batchId, count: b.items.length, cost: b.items.length * PROMO_UNIT_PRICE, text: b.text, sendAt: b.sendAt,
    })),
  };
  // CRM 설계사 대상 캠페인일 때만 미발송 인원 계산 (일반인 등 비대상은 미발송 안 띄움)
  if (CAMPAIGN.crmPromo && CRM_SHEET_ID && googleCreds()) {
    try {
      const { tab, applicants } = await readPeople(CRM_SHEET_ID, CRM_SHEET_TAB);
      const seen = new Set();
      const fresh = applicants.filter((a) => !a.status && !PROMO_EXCLUDE_ROLES.includes(a.role)
                                          && !seen.has(a.phone) && seen.add(a.phone));
      out.crmTab = tab; out.total = applicants.length; out.remaining = fresh.length;
      out.remainingCost = fresh.length * PROMO_UNIT_PRICE;
    } catch (e) { out.crmError = e.message; }
  }
  // 오늘 발송한 명수 (테스트 제외) — 발송완료 도장 날짜가 오늘인 묶음
  const todayMD = new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric' });
  out.sentToday = PROMO.filter((b) => !b.test && String(b.status).startsWith('발송완료') && String(b.status).includes(todayMD))
                       .reduce((s, b) => s + b.items.length, 0);
  res.json(out);
});

// ── /promo/draft: 오늘치 묶음 준비 (발송 아님 — 승인 대기로만) ──
// 받는 것: { limit, guide } — limit 기본 500 (하루치), guide = 대표님 추가 지시
app.post('/promo/draft', async (req, res) => {
  console.log('📨 /promo/draft 요청 도착 —', new Date().toLocaleString('ko-KR'));
  try {
    if (!CAMPAIGN.crmPromo) {
      return res.status(400).json({ error: `이 캠페인("${CAMPAIGN.title || CAMPAIGN.name}")은 CRM 설계사 문자 대상이 아닙니다. CRM 홍보 문자는 설계사 과정 캠페인에서만 쓰고, 일반인 과정은 SNS·콘텐츠로 모읍니다. (캠페인 설정에서 "CRM 설계사 대상"을 켜면 사용 가능)` });
    }
    if (!CRM_SHEET_ID) {
      return res.status(503).json({ error: 'CRM 시트가 아직 연결 안 됐습니다. ① 엑셀 파일을 열어 "파일→Google Sheets로 저장" ② 새 시트를 jenya-server 서비스 계정에 편집자 공유 ③ 새 시트 주소의 ID를 환경변수 CRM_SHEET_ID에 넣고 서버 재시작.' });
    }
    const limit = Math.max(1, Math.min(Number((req.body || {}).limit) || PROMO_DAILY_LIMIT, 1000));
    const guide = (req.body || {}).guide;
    // 캠페인 중앙설정을 우선 사용 (없으면 기존 환경변수 기본값) — 매달 한 곳만 바꾸면 됨
    const cName  = CAMPAIGN.name      || PROMO_PRODUCT;
    const cFacts = CAMPAIGN.facts     || PROMO_FACTS;
    const cApply = CAMPAIGN.applyLink || MKT_APPLY_LINK;
    const cPay   = CAMPAIGN.payLink   || PROMO_PAY_LINK;

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
    if (!cFacts) {
      return res.status(503).json({ error: `홍보 대상 "${cName}"의 확정 정보(일정·기간·수강료·마감)가 캠페인 설정에 아직 없습니다. 「캠페인 설정」에서 강의 사실을 입력해 주세요.` });
    }

    // 홍보 문구: 마케팅 손의 "카톡 채널 안내글" 톤 + 법적 요건은 아래 enforceAdRules가 한 번 더 강제
    const system = buildSystemPrompt('care', '머니트레이닝랩');
    const ask =
      '기존 고객(대부분 보험설계사)에게 보낼 교육과정 홍보 "광고 문자" 한 통을 써라.\n'
      + `- 홍보 대상: ${cName}\n`
      + '- 각도(가장 중요): 받는 사람은 보험설계사다. "설계사 본인의 상담 전문성을 높이고, 고객에게 신뢰받는 재무상담 무기를 갖는 과정"이라는 점이 와닿게. 설계사가 "이건 나에게 필요하다"고 느끼게 쓴다. 너무 건조한 정보 나열 금지, 그렇다고 과장도 금지\n'
      + '- 호칭은 "고객님"으로 통일 ("설계사님" 같은 호칭은 쓰지 말 것 — 어색함 방지, 개인 이름도 넣지 않음)\n'
      + '- 톤: 카카오톡 채널 안내글처럼 짧은 줄·줄바꿈으로 폰에서 읽기 좋게, 따뜻하고 담백하게\n'
      + '- 반드시 맨 앞은 "(광고) 오원트금융연구소"로 시작\n'
      + '- 핵심 정보(이 사실만 사용, 지어내기 금지): ' + cFacts + '\n'
      + '- 일정 줄은 핵심 정보의 날짜·요일·기간을 그대로 정확히 표기 (요일을 지어내거나 바꾸지 말 것)\n'
      + '- 신청서 링크 포함: ' + cApply + '\n'
      + `- 수강료 안내 다음 줄에 결제 안내 한 줄: "결제하기: ${cPay}" (링크 한 글자도 바꾸지 말 것)\n`
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

// ── /promo/test-draft: 예약 테스트 묶음 (대표님 본인 번호 1건만) ──
// CRM 명단을 전혀 안 읽는다. 받는 사람은 발신번호(대표님 본인) 1명 고정 → 진짜 설계사에겐 절대 안 감.
app.post('/promo/test-draft', (req, res) => {
  if (!solapi || !SOLAPI_SENDER) return res.status(503).json({ error: 'Solapi 키 또는 발신번호가 없어 테스트를 못 합니다.' });
  const text = enforceAdRules('(광고) [예약 발송 테스트] 제니야 예약 발송 기능 점검용 문자입니다. 실제 홍보가 아닙니다.');
  const batch = {
    batchId: 'btest' + Date.now(),
    ts: new Date().toISOString(),
    text,
    items: [{ name: '대표님(테스트)', phone: SOLAPI_SENDER }],   // 본인 번호 1건 고정
    status: '대기',
    test: true,
  };
  PROMO.push(batch);
  savePromo();
  res.json({ batch: { batchId: batch.batchId, text, count: 1, cost: PROMO_UNIT_PRICE, unitPrice: PROMO_UNIT_PRICE, sample: [{ name: '대표님(테스트)' }], test: true } });
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
    if (!batch.test && (h >= 21 || h < 8)) {     // 테스트(본인 번호)는 광고규제 무관 → 야간차단 면제
      return res.status(403).json({ error: `지금은 한국시간 ${h}시 — 광고 문자는 밤 9시~아침 8시 발송이 법으로 금지돼 있습니다. 아침 8시 이후 발송하거나, "예약 발송"으로 아침 시간에 걸어 두세요.` });
    }
    const out = await sendPromoBatch(batch);
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /promo/schedule: 예약 발송 등록 (= 대표님 승인 + 발송 시각 지정) ──
// 휴먼인더루프: '대기' 묶음(대표님이 직접 만든 것)만 예약 가능. 자동 생성·발송은 절대 없음.
// 야간차단 시간대를 고르면 자동으로 다음 허용시각(아침 8시)으로 당긴다.
app.post('/promo/schedule', async (req, res) => {
  console.log('📨 /promo/schedule 요청 도착 —', new Date().toLocaleString('ko-KR'));
  try {
    const { batchId, sendAt } = req.body || {};
    const batch = PROMO.find((b) => b.batchId === batchId && b.status === '대기');
    if (!batch) return res.status(400).json({ error: '예약할 대기 묶음이 없습니다. (이미 발송·예약·보류됐을 수 있어요)' });
    if (!solapi || !SOLAPI_SENDER) return res.status(503).json({ error: 'Solapi 키 또는 발신번호가 없습니다.' });
    const want = new Date(sendAt);
    if (isNaN(want.getTime())) return res.status(400).json({ error: '예약 시간을 알아듣지 못했습니다.' });

    // 테스트(본인 번호)는 광고규제 무관 → 야간 보정 없이 입력 시각 그대로
    const eff = batch.test ? want : snapToAllowed(want);
    const snapped = !batch.test && eff.getTime() !== want.getTime();
    batch.status = '예약';
    batch.sendAt = eff.toISOString();
    batch.scheduledTs = new Date().toISOString();
    batch.tries = 0;
    delete batch.sendError;
    await savePromo();      // 예약을 시트에 확정 저장 후 응답 → 재시작에도 안 날아감

    const cost = batch.items.length * PROMO_UNIT_PRICE;
    const when = eff.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    appendDiary({
      ts: new Date().toISOString(), agentId: 'care', agentName: '고객관리', project: '머니트레이닝랩', kind: 'hand',
      entry: `[손] CRM 홍보 ${batch.items.length}명 예약 발송 등록 — ${when} 발송 예정 (대표님 승인 완료)`,
    });
    res.json({ batchId, count: batch.items.length, cost, sendAt: batch.sendAt, when, snapped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /promo/schedule/cancel: 예약 취소 → 다시 승인 대기로 ──────
app.post('/promo/schedule/cancel', (req, res) => {
  const { batchId } = req.body || {};
  const batch = PROMO.find((b) => b.batchId === batchId && b.status === '예약');
  if (!batch) return res.status(400).json({ error: '취소할 예약이 없습니다. (이미 발송됐거나 취소됨)' });
  batch.status = '대기';
  delete batch.sendAt; delete batch.scheduledTs; delete batch.tries; delete batch.sendError;
  savePromo();
  res.json({ ok: true, count: batch.items.length });
});

// ── 예약 발송 자동 처리기 ────────────────────────────────────
// 대표님이 "예약 발송"으로 승인해 둔 묶음만 자동 발송한다. (승인 없는 자동 생성·발송 절대 없음)
// ※ Render 무료 플랜은 15분 무접속 시 잠들어 1분 타이머가 멈춘다 → 앱을 열거나(/notify·/promo/status 폴링)
//   외부 크론이 /promo/tick 을 치면, 서버가 깨는 즉시 밀린 예약을 확인해 보낸다.
let promoTickRunning = false;
async function runDuePromo() {
  if (promoTickRunning) return { ran: false };
  if (!solapi || !SOLAPI_SENDER) return { ran: false };
  promoTickRunning = true;
  let sent = 0;
  try {
    const now = Date.now();
    const due = PROMO.filter((b) => b.status === '예약' && b.sendAt && new Date(b.sendAt).getTime() <= now);
    for (const batch of due) {
      const h = koreaHour();
      if (!batch.test && (h >= 21 || h < 8)) continue;   // 안전장치: 혹시 야간이면 보류(테스트는 면제)
      try {
        await sendPromoBatch(batch);    // 성공 시 status가 '발송완료…'로 바뀌고 sendAt 제거됨
        sent++;
      } catch (e) {
        batch.tries = (batch.tries || 0) + 1;
        batch.sendError = e.message;
        if (batch.tries >= 3) {
          batch.status = '예약실패';
          delete batch.sendAt;
          pushNotify({ kind: 'sent', agentId: 'care',
            title: 'CRM 예약 발송 실패 — 확인 필요',
            body: `${batch.items.length}명 묶음 발송이 3회 실패했습니다. (${e.message}) 「대기·비용 보기」에서 다시 시도해 주세요.` });
        } else {
          batch.sendAt = new Date(now + 10 * 60 * 1000).toISOString();   // 10분 뒤 재시도
        }
        savePromo();
      }
    }
  } finally { promoTickRunning = false; }
  return { ran: true, sent };
}
setInterval(() => { runDuePromo().catch(() => {}); runDuePayments().catch(() => {}); }, 60 * 1000);
// 외부 크론(cron-job.org 등)이 아침에 깨우며 호출할 수 있는 입구 — 호출만으로 밀린 예약 발송
app.get('/promo/tick', async (req, res) => { res.json(await runDuePromo()); });

// ── /tick: 외부 크론용 "통합" 입구 (이거 하나면 CRM 홍보 예약 + 결제후 손 둘 다 처리) ──
// cron-job.org는 이 주소 하나만 주기적으로 부르면 된다.
app.get('/tick', async (req, res) => {
  const promo = await runDuePromo().catch((e) => ({ error: e.message }));
  const pay   = await runDuePayments().catch((e) => ({ error: e.message }));
  runDueLeads().catch(() => {});   // 하루 1회 관심자(키워드) 자동 수집
  runDueYtLeads().catch(() => {}); // 하루 1회 대표 유튜브 채널 가망고객 발굴
  res.json({ ok: true, ts: new Date().toISOString(), promo, pay });
});

// ============================================================
// 결제후 손 — 네 번째 실제 도구 (2026-06-12)
// 역할: AI머니야_마케팅DB(전문가강의DB/일반인강의DB)에 쌓이는 "결제완료" 줄을 읽어
//       → 우리 신청자(리드) 시트에 "결제완료" 도장 → 결제감사+대면안내 문자 자동발송
//       → 알림함 기록 → 모집현황 집계.
// 안전 원칙:
//   · 기존 페이플 웹훅(ohwant-webhook)·AI머니야 시트는 절대 안 건드린다(읽기 전용).
//   · 처음 켤 때 이미 있던 결제는 "기준선"으로 표시만 하고 문자 안 보냄(과거 결제자 오발송 방지).
//   · 대면안내(일정·장소)를 입력해 "켜기" 전에는 자동발송 안 함.
//   · 주문번호로 중복방지(같은 결제 두 번 처리 안 함). 거래성 안내라 야간차단·승인 없이 즉시 발송(광고 아님).
// ============================================================
const PAY_RESULT_SHEET_ID = process.env.PAY_RESULT_SHEET_ID || '19hcUDUn85JW86eAwvV1ZEUMprMNvtWzRlLxhzMxjoU0';
const PAY_WATCH = [
  { tab: '전문가강의DB', course: '전문가 대면과정', expected: 1100000 },
  { tab: '일반인강의DB', course: '일반인 강의',     expected: 550000  },
];

// 결제시트 전화번호는 앞 0이 빠져 있을 때가 있다 ("1047813996" → "01047813996")
function normPhone(v) {
  let p = String(v || '').replace(/\D/g, '');
  if ((p.length === 9 || p.length === 10) && /^1[0-9]/.test(p)) p = '0' + p;
  return /^01[016789]\d{7,8}$/.test(p) ? p : null;
}

let PAYCFG = loadJson('결제후설정.json');
if (Array.isArray(PAYCFG)) PAYCFG = {};         // 기본은 객체 {enabled, place, schedule, prepare, notice, baselineDone}
let PAYSEEN = loadJson('결제처리.json');         // 처리(또는 기준선)된 주문번호 목록 (중복방지)
const PAYFAIL = {};                              // 주문번호 → 실패횟수 (메모리, 3회면 포기+알림)

// 결제후 손 상태 영구저장 — 같은 시트의 '제니야_결제상태' 탭 (재시작에도 enabled·기준선·중복방지 유지)
const PAYSTATE_TAB = process.env.PAYSTATE_TAB || '제니야_결제상태';
async function savePayStateToSheet() {
  const sheets = sheetsClient();
  if (!sheets || !RESV_SHEET_ID) return;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: RESV_SHEET_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === PAYSTATE_TAB)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: RESV_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: PAYSTATE_TAB } } }] } });
  }
  const rows = [['config', JSON.stringify(PAYCFG)]];
  PAYSEEN.forEach((oid) => rows.push(['seen', oid]));
  await sheets.spreadsheets.values.clear({ spreadsheetId: RESV_SHEET_ID, range: `'${PAYSTATE_TAB}'!A1:Z` });
  await sheets.spreadsheets.values.update({ spreadsheetId: RESV_SHEET_ID, range: `'${PAYSTATE_TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });
}
let payChain = Promise.resolve();
function savePayStateSafe() {
  const next = payChain.catch(() => {}).then(() => savePayStateToSheet());
  payChain = next.catch((e) => console.warn('⚠️ 결제상태 시트 저장 실패:', e.message));
  return payChain;
}
async function loadPayStateFromSheet() {
  const sheets = sheetsClient();
  if (!sheets || !RESV_SHEET_ID) return false;
  let got;
  try { got = await sheets.spreadsheets.values.get({ spreadsheetId: RESV_SHEET_ID, range: `'${PAYSTATE_TAB}'!A1:B` }); }
  catch (e) { return false; }
  const rows = got.data.values || [];
  if (!rows.length) return false;
  const seen = []; let cfg = null;
  rows.forEach((r) => {
    if (r[0] === 'config') { try { cfg = JSON.parse(r[1] || '{}'); } catch (e) {} }
    else if (r[0] === 'seen' && r[1]) seen.push(r[1]);
  });
  if (cfg) PAYCFG = cfg;
  PAYSEEN = seen;
  return true;
}
const savePayCfg  = () => { saveJson('결제후설정.json', PAYCFG); return savePayStateSafe(); };
const savePaySeen = () => { saveJson('결제처리.json', PAYSEEN); return savePayStateSafe(); };

// 서버 시작 시: 결제후 손 상태 복원 (enabled·기준선·중복방지 목록이 재시작에도 유지)
(async () => {
  const ok = await loadPayStateFromSheet().catch(() => false);
  if (ok) {
    saveJson('결제후설정.json', PAYCFG); saveJson('결제처리.json', PAYSEEN);
    console.log(`💳 결제 상태 시트 복원: enabled=${!!PAYCFG.enabled}, 처리됨 ${PAYSEEN.length}건`);
  }
})();

// 활성 캠페인의 결제DB 한 곳만 본다 (전문가 캠페인=전문가강의DB, 일반인 캠페인=일반인강의DB)
//   course=강의명, expected=수강료를 캠페인에서 가져와 결제문자·검증이 그 캠페인 것으로 나간다
function activeWatch() {
  if (!CAMPAIGN.payTab) return [];
  return [{ tab: CAMPAIGN.payTab, course: CAMPAIGN.name || '강의', expected: Number(CAMPAIGN.price) || 0 }];
}

// 결제시트의 (활성 캠페인) 강의 탭에서 "결제완료 + 주문번호 있는" 진짜 결제 줄만 뽑는다
async function readPaidRows() {
  const sheets = sheetsClient();
  if (!sheets) throw new Error('구글 열쇠가 없습니다.');
  const out = [];
  for (const w of activeWatch()) {
    let got;
    try {
      got = await sheets.spreadsheets.values.get({ spreadsheetId: PAY_RESULT_SHEET_ID, range: `'${w.tab}'!A2:I` });
    } catch (e) { continue; }                    // 탭이 없으면 건너뜀
    (got.data.values || []).forEach((r) => {
      const status = String(r[6] || '').trim();
      const oid    = String(r[7] || '').trim();
      if (!status.includes('결제완료') || !oid) return;   // 진짜 결제만 (테스트 "신청" 줄 제외)
      out.push({
        tab: w.tab, course: w.course, expected: w.expected,
        when: String(r[0] || '').trim(),
        name: String(r[1] || '').trim() || '고객',
        phone: normPhone(r[2]),
        email: String(r[3] || '').trim(),
        goods: String(r[4] || '').trim(),
        amount: Number(String(r[5] || '0').replace(/\D/g, '')) || 0,
        oid,
      });
    });
  }
  return out;
}

// 결제감사+안내 문자 본문 (거래성 안내) — 전부 "활성 캠페인" 강의정보에서 가져온다(단일 진실 원천)
//   대면이면 "· 장소", 비대면이면 "· 접속(줌)"으로 갈린다.
function buildPayThanksText(p) {
  const online = CAMPAIGN.mode === '비대면';
  const schedule = CAMPAIGN.date;
  const place = CAMPAIGN.place;
  const onlineLink = CAMPAIGN.onlineLink;
  const prepare = CAMPAIGN.prepare;
  const notice = CAMPAIGN.notice;
  let t = `[오원트금융연구소] ${p.name}님, ${p.course} 결제가 완료되었습니다(${p.amount.toLocaleString()}원). 감사합니다.`;
  if (schedule) t += `\n· 일정: ${schedule}`;
  if (online) {
    // 비대면: 줌 링크가 입력돼 있으면 바로 안내, 비어 있으면 "강의 1시간 전 카톡 안내"로 (링크를 결제 시점에 안 주는 운영)
    if (onlineLink) t += `\n· 접속(줌): ${onlineLink}`;
    else            t += `\n· 줌 접속 링크는 강의 시작 1시간 전 카카오톡으로 안내드립니다.`;
  } else {
    if (place) t += `\n· 장소: ${place}`;
  }
  if (prepare)  t += `\n· 준비물: ${prepare}`;
  if (notice)   t += `\n${notice}`;
  t += `\n문의 010-5424-5332`;
  return t;
}

// 결제 한 건 처리: 문자 발송 → 리드시트 도장 → 알림 → 일기
async function processOnePayment(p) {
  // ① 결제감사+대면안내 문자 (거래성 — 야간차단·승인 없이 즉시)
  if (solapi && SOLAPI_SENDER && p.phone) {
    await solapi.send([{ to: p.phone, from: SOLAPI_SENDER, text: buildPayThanksText(p) }]);
  }
  // ② 우리 신청자(리드) 시트에 결제완료 도장 (전화번호 매칭, 기존 값 뒤에 덧붙임)
  let stamped = false, matched = false;
  try {
    const L = activeLeadSheet();   // 활성 캠페인의 신청시트에 도장
    const { tab, applicants, statusCol, sheets } = await readPeople(L.id, L.tab);
    const hit = applicants.find((a) => a.phone === p.phone);
    if (hit) {
      matched = true;
      const when = new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const stamp = (hit.status ? hit.status + ' / ' : '') + `결제완료 ${p.amount.toLocaleString()}원 ${when}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: L.id,
        range: `'${tab.replace(/'/g, "''")}'!${colLetter(statusCol)}${hit.row}`,
        valueInputOption: 'RAW', requestBody: { values: [[stamp]] },
      });
      stamped = true;
    }
  } catch (e) { /* 도장 실패는 치명적 아님 — 문자는 이미 나갔다 */ }

  // ③ 알림함 + 영업일기
  const amt = p.amount.toLocaleString();
  const mismatch = p.amount !== p.expected;
  pushNotify({
    kind: 'pay', agentId: 'care',
    title: `💰 ${p.name}님 결제완료 — ${p.course} ${amt}원`,
    body: (matched ? '신청 명단에서 확인됨. ' : '⚠️ 신청 명단에 없던 분입니다. ')
        + '결제감사·대면안내 문자 발송함.' + (mismatch ? ` ⚠️ 금액 불일치(기대 ${p.expected.toLocaleString()}원).` : ''),
  });
  appendDiary({
    ts: new Date().toISOString(), agentId: 'care', agentName: '고객관리', project: '머니트레이닝랩', kind: 'hand',
    entry: `[손] 결제후: ${p.name}님 ${p.course} ${amt}원 결제완료 — 대면안내 문자 발송, 리드시트 도장 ${stamped ? 'O' : 'X'}${matched ? '' : '(명단 외)'}`,
  });
}

// 새 결제완료 줄만 자동 처리 (기준선 이후, 켜져 있을 때만)
let payTickRunning = false;
async function runDuePayments() {
  if (payTickRunning) return { ran: false };
  if (!PAYCFG.enabled) return { ran: false, reason: 'off' };
  if (!CAMPAIGN.payTab) return { ran: false, reason: 'no-paytab' };
  payTickRunning = true;
  let sent = 0;
  try {
    // 안전장치: 활성 캠페인의 결제DB가 아직 기준선이 안 잡혔으면, 먼저 기준선만 잡고(발송 0) 끝낸다.
    //          (다른 캠페인으로 전환했는데 그 DB에 과거 결제가 있을 때 무더기 발송 방지)
    if (!(PAYCFG.baselinedTabs || []).includes(CAMPAIGN.payTab)) {
      const baselined = await seedPayBaseline();
      payTickRunning = false;
      return { ran: true, sent: 0, baselinedTab: CAMPAIGN.payTab, baselined };
    }
    const paid = await readPaidRows();
    const seen = new Set(PAYSEEN);
    for (const p of paid) {
      if (seen.has(p.oid)) continue;
      try {
        await processOnePayment(p);
        PAYSEEN.push(p.oid); seen.add(p.oid); await savePaySeen();
        sent++;
      } catch (e) {
        PAYFAIL[p.oid] = (PAYFAIL[p.oid] || 0) + 1;
        if (PAYFAIL[p.oid] >= 3) {               // 3회 실패하면 포기(무한반복 방지) + 대표 알림
          PAYSEEN.push(p.oid); seen.add(p.oid); await savePaySeen();
          pushNotify({ kind: 'pay', agentId: 'care', title: '결제후 처리 실패 — 확인 필요',
            body: `${p.name}님 ${p.course} 처리가 3회 실패(${e.message}). 수동 확인 바랍니다.` });
        }
      }
    }
    return { ran: true, sent };
  } catch (e) {
    return { ran: true, sent, error: e.message };
  } finally { payTickRunning = false; }
}

// 기준선 잡기: (활성 캠페인 결제DB의) 지금까지 결제완료를 "처리됨"으로만 표시(문자 안 보냄)
//   캠페인 전환 시 새 결제DB의 과거 결제가 무더기 발송되는 걸 막는다 (탭별 1회).
async function seedPayBaseline() {
  const paid = await readPaidRows();
  const seen = new Set(PAYSEEN);
  let added = 0;
  paid.forEach((p) => { if (!seen.has(p.oid)) { PAYSEEN.push(p.oid); seen.add(p.oid); added++; } });
  if (CAMPAIGN.payTab) {
    PAYCFG.baselinedTabs = PAYCFG.baselinedTabs || [];
    if (!PAYCFG.baselinedTabs.includes(CAMPAIGN.payTab)) PAYCFG.baselinedTabs.push(CAMPAIGN.payTab);
  }
  await savePaySeen(); await savePayCfg();
  return added;
}

// ── /pay/status: 결제후 손 상태 ──
app.get('/pay/status', async (req, res) => {
  runDuePayments().catch(() => {});              // 앱을 열어 서버가 깨면 밀린 결제부터 확인
  const out = {
    enabled: !!PAYCFG.enabled, baselineDone: !!PAYCFG.baselineDone, processed: PAYSEEN.length,
    mode: CAMPAIGN.mode, payTab: CAMPAIGN.payTab || '',
    config: { place: CAMPAIGN.place || '', schedule: CAMPAIGN.date || '', onlineLink: CAMPAIGN.onlineLink || '', prepare: CAMPAIGN.prepare || '', notice: CAMPAIGN.notice || '' },
    googleKey: !!googleCreds(), solapi: !!solapi,
  };
  try {
    const paid = await readPaidRows();
    const seen = new Set(PAYSEEN);
    out.totalPaid = paid.length;
    out.unprocessed = paid.filter((p) => !seen.has(p.oid)).length;
  } catch (e) { out.error = e.message; }
  res.json(out);
});

// ── /pay/config: 대면안내 입력 + 켜기/끄기 (처음 켤 때 기준선 자동) ──
app.post('/pay/config', async (req, res) => {
  console.log('📨 /pay/config 요청 도착 —', new Date().toLocaleString('ko-KR'));
  try {
    const b = req.body || {};
    // 준비물·추가안내는 활성 캠페인에 저장 (일정·장소·줌은 「캠페인 설정」이 단일 출처)
    let campChanged = false;
    if (b.prepare !== undefined) { CAMPAIGN.prepare = String(b.prepare); campChanged = true; }
    if (b.notice  !== undefined) { CAMPAIGN.notice  = String(b.notice);  campChanged = true; }
    if (campChanged) await saveCampaign();
    let baselined = 0;
    if (b.enable === true) {
      if (!CAMPAIGN.payTab) {
        return res.status(400).json({ error: '이 캠페인의 결제DB 탭이 설정되지 않았습니다. 「캠페인 설정」에서 결제DB를 골라 주세요.' });
      }
      const hasWhere = CAMPAIGN.mode === '비대면' ? CAMPAIGN.onlineLink : CAMPAIGN.place;
      if (!CAMPAIGN.date && !hasWhere) {
        const what = CAMPAIGN.mode === '비대면' ? '일정·줌 링크' : '일정·장소';
        return res.status(400).json({ error: `안내 정보(${what})가 없습니다. 「캠페인 설정」에서 입력한 뒤 켜 주세요.` });
      }
      if (!(PAYCFG.baselinedTabs || []).includes(CAMPAIGN.payTab)) { baselined = await seedPayBaseline(); }
      PAYCFG.baselineDone = true;
      PAYCFG.enabled = true;
    } else if (b.enable === false) {
      PAYCFG.enabled = false;
    }
    await savePayCfg();
    res.json({ ok: true, enabled: !!PAYCFG.enabled, baselined, campaign: CAMPAIGN });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /pay/tick: 외부 크론·수동용 (호출만으로 밀린 결제 처리) ──
app.get('/pay/tick', async (req, res) => { res.json(await runDuePayments()); });

// ── /campaign/stats: 모집현황 (신청 N · 결제 N · 매출 N · 전환율) ──
app.get('/campaign/stats', async (req, res) => {
  try {
    const out = {};
    const leadId  = CAMPAIGN.leadSheetId  || LEAD_SHEET_ID;
    const leadTab = CAMPAIGN.leadSheetTab || LEAD_SHEET_TAB;
    try {
      const { applicants } = await readPeople(leadId, leadTab);
      out.apply = applicants.length;
    } catch (e) { out.apply = null; out.applyError = e.message; }
    const paid = await readPaidRows();   // 활성 캠페인의 결제DB만
    out.paid = paid.length;
    out.revenue = paid.reduce((s, p) => s + p.amount, 0);
    out.byCourse = CAMPAIGN.payTab ? [{ course: CAMPAIGN.name || '강의', paid: out.paid, revenue: out.revenue }] : [];
    out.convRate = (out.apply && out.apply > 0) ? Math.round(out.paid / out.apply * 1000) / 10 : null;
    out.contentCount = DIARY.filter((d) => d.agentId === 'mkt' && /콘텐츠.*생성/.test(d.entry || '')).length;
    const mine = myContents();
    out.uploads = {
      total: mine.length,
      poster: mine.filter((c) => c.type === '포스터').length,
      shorts: mine.filter((c) => c.type === '쇼츠').length,
      cardnews: mine.filter((c) => c.type === '카드뉴스').length,
      // 콘텐츠 자동화 공장 5종
      courseinfo: mine.filter((c) => c.type === '과정정보').length,
      text: mine.filter((c) => c.type === '텍스트').length,
      keyword: mine.filter((c) => c.type === '키워드').length,
      audio: mine.filter((c) => c.type === '오디오').length,
    };
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /campaign/today: "대표님, 오늘 하실 일" 코치 배너용 상태 ──
//    활성 과정의 개강일(startDate)·종료일(endDate)을 오늘(KST)과 비교해 지금 할 일을 코치 말투로 안내.
//    개강일은 startDate 우선, 없으면 일정(date) 텍스트에서 "YYYY년 M월 D" 첫 날짜를 추출(옛 캠페인 호환).
const SHORTS_GOAL = 20;     // 한 달치 쇼츠 목표 (20일치)
function ymdToDate(s) {     // "2026-06-18" → 그 날 00:00 UTC (KST 자정 비교용)
  const m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
function parseOpenDate(s) {  // 자유 텍스트 "…2026년 6월 18·25일…"에서 첫 날짜
  const m = String(s || '').match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
function kstMidnight() {
  const n = new Date(Date.now() + 9 * 3600 * 1000);      // UTC→KST
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}
function mdLabel(d) { return d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : ''; }
app.get('/campaign/today', (req, res) => {
  const c = CAMPAIGN || {};
  const mine = myContents();
  const cnt = (t) => mine.filter((x) => x.type === t).length;
  const counts = { 쇼츠: cnt('쇼츠'), 과정정보: cnt('과정정보'), 텍스트: cnt('텍스트'), 키워드: cnt('키워드'), 오디오: cnt('오디오'), 카드뉴스: cnt('카드뉴스') };
  const open = ymdToDate(c.startDate) || parseOpenDate(c.date);   // 개강일 (시작일 우선)
  const end = ymdToDate(c.endDate);                               // 종료일 (선택)
  const today = kstMidnight();
  const dday = open ? Math.round((open.getTime() - today.getTime()) / 86400000) : null;
  const shorts = counts['쇼츠'];
  const courseName = c.name || c.title || '이번 과정';
  const openLabel = mdLabel(open);
  let stage, headline, sub, tone;
  if (!open) {
    // (예외) 개강일 미입력 → 입력 유도
    stage = 'needdate'; tone = 'gray';
    headline = `${courseName}의 개강일을 먼저 입력해 주세요.`;
    sub = '「캠페인 설정 → 과정 시작일·종료일」을 넣으면, 제니야가 오늘 날짜와 비교해 지금 하실 일을 안내합니다.';
  } else if (dday >= 0) {
    // 개강 전 = 모객 기간
    if (shorts < SHORTS_GOAL) {
      // ① 콘텐츠 미완 → 모객 집중
      stage = 'recruit'; tone = 'purple';
      headline = `${courseName} ${openLabel} 개강 (D-${dday}). 지금은 모객 집중 기간입니다!`;
      sub = `쇼츠 ${shorts}/${SHORTS_GOAL}일치 올렸어요. 나머지를 업로드해 한 달치 홍보를 예약하세요. (자동배포 연결은 곧)`;
    } else {
      // ② 콘텐츠 완료 → 현황 지켜보기
      stage = 'ready'; tone = 'green';
      headline = `홍보 예약 완료! (${courseName} D-${dday}) 이제 신청·결제 현황을 지켜보세요. 🎉`;
      sub = '쇼츠 20일치가 준비됐습니다. 진행판 ③ 신청·결제에서 들어오는 신청과 결제를 확인하세요.';
    }
  } else {
    // ③ 개강 지남 (진행 중 또는 종료) → 다음 달 과정 준비 종용
    stage = 'next'; tone = 'blue';
    const ended = end && today.getTime() > end.getTime();
    headline = ended
      ? `${courseName}이(가) 끝났습니다! 지금 바로 다음 달 과정 정보를 입력하세요.`
      : `${courseName}이(가) 시작됐습니다! 지금 바로 다음 달 과정 정보를 입력하세요.`;
    sub = '한 달치 마케팅을 미리 예약해둬야 합니다. 진행판 「+ 새 캠페인」으로 다음 달 과정을 만들고, 쇼츠 20일치부터 올리세요.';
  }
  res.json({
    title: c.title || '', name: c.name || '', mode: c.mode || '',
    startDate: c.startDate || '', endDate: c.endDate || '', date: c.date || '',
    open: open ? open.toISOString().slice(0, 10) : '', openLabel, dday,
    counts, shortsGoal: SHORTS_GOAL, stage, tone, headline, sub,
  });
});

// ── /pay/test: 발송 테스트 (돈 안 쓰고 검증, 완전 분리 경로) ──
//   dryRun=true  → 문자 본문만 반환 (0원, 발송 안 함)
//   dryRun=false → 대표님 본인 번호(발신번호)로만 1통 발송 (~33원, 110만 결제 아님)
//   ※ AI머니야 시트·리드시트·중복방지(PAYSEEN) 전부 안 건드림. 받는 번호는 서버가 고정(임의 번호 차단).
app.post('/pay/test', async (req, res) => {
  console.log('📨 /pay/test 요청 도착 —', new Date().toLocaleString('ko-KR'));
  try {
    const b = req.body || {};
    // 미리보기·테스트 샘플도 "활성 캠페인"의 강의명·수강료로 (전문가/일반인 자동 반영)
    const sample = {
      name: (b.name && String(b.name).trim()) || '홍길동(테스트)',
      course: CAMPAIGN.name || '강의',
      amount: Number(CAMPAIGN.price) || 0,
    };
    const text = buildPayThanksText(sample);
    if (b.dryRun) return res.json({ dryRun: true, text });
    if (!solapi || !SOLAPI_SENDER) return res.status(503).json({ error: 'Solapi 키 또는 발신번호가 없어 테스트 발송을 못 합니다.' });
    // 받는 번호 = 발신번호(대표님 본인). 파라미터로 받는 번호를 못 바꾼다 → 악용·오발송 차단.
    await solapi.send([{ to: SOLAPI_SENDER, from: SOLAPI_SENDER, text }]);
    res.json({ sent: true, to: SOLAPI_SENDER, text });
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

// ── /mkt/content: 채널별 × 관계온도별 홍보 콘텐츠 생성 ─────────
// 핵심: 받는 사람과 오대표의 "관계 온도"(🔥거래설계사/🌤채널친구/❄️처음본 사람)에 따라 톤이 다르고,
//       채널마다 형식이 다르다(쇼츠 대본/카드뉴스/페북글/짧은안내/LMS/블로그긴글).
//       강의정보(facts) 기반 생성 + 모든 콘텐츠에 "카카오톡 '○○' 검색→채널추가" 문구 자동.
app.post('/mkt/content', async (req, res) => {
  console.log('📣 /mkt/content 요청 도착 —', new Date().toLocaleString('ko-KR'));
  try {
    const { project, guide } = req.body || {};
    const cName  = CAMPAIGN.name      || '강의';
    const cFacts = CAMPAIGN.facts     || LECTURE_FACTS;
    const cApply = CAMPAIGN.applyLink || MKT_APPLY_LINK;
    const cKakao = CAMPAIGN.kakaoChannel || '금융집짓기';
    const ctaLine = `카카오톡에서 '${cKakao}' 검색 → 채널 추가`;
    const system = buildSystemPrompt('mkt', project || '머니트레이닝랩');
    const ask =
      `이번 캠페인 목표: "${cName}" 모집.\n`
      + '강의 정보(이 사실만 사용, 지어내기 금지): ' + cFacts + '\n'
      + '신청서 링크: ' + cApply + '\n'
      + `카카오 채널명: ${cKakao}\n`
      + (guide ? '대표님 추가 지시: ' + guide + '\n' : '')
      + '\n★ 가장 중요 — 받는 사람과 오상열 대표의 "관계 온도"에 따라 톤을 완전히 다르게 써라:\n'
      + '  🌤 카톡 채널친구(관심있어 추가): 관심유도. 부담 적게, 호기심·혜택 중심으로 "이런 과정이 열립니다".\n'
      + '  ❄️ SNS 처음 본 사람: 가치증명·신뢰구축. 먼저 오대표가 왜 믿을 만한지(경력·철학)와 가치를 보여주고, 결제는 천천히. 첫 줄부터 팔지 말 것. CTA는 "채널 추가"로 부드럽게.\n'
      + '  (※ 🔥 거래한 설계사용 문자(LMS)는 여기서 만들지 마라 — 그건 CRM 홍보 손이 따로 만들어 실제 발송한다. 여기선 게시용 콘텐츠만.)\n'
      + '\n아래 5종을 각각 그 구분표로 시작해 만들어라:\n'
      + '[[카톡채널]] 🌤 카톡 채널친구용 짧은 안내 — 관심유도, 폰에서 읽기 좋게 짧은 줄·줄바꿈\n'
      + '[[유튜브쇼츠]] ❄️ 유튜브 쇼츠 30~45초 대본 (첫 3초 후킹 문구 3개 제안 + 본 대본) — 가치증명\n'
      + '[[인스타]] ❄️ 인스타 — 카드뉴스 슬라이드 문구(슬라이드 1~6 형태) + 릴스 캡션(해시태그 포함) — 가치증명\n'
      + '[[페북]] ❄️ 페이스북 텍스트+링크글 — 공감 스토리로 시작해 가치증명, 끝에 링크\n'
      + '[[블로그]] ❄️ 네이버 블로그 긴 정보글 (제목 + 본문 600자 이상) — 정보·가치 중심\n'
      + '\n규칙:\n'
      + '- 금융 콘텐츠다. 수익·성과 보장, 과장·허위 표현 절대 금지 ("무조건", "100% 됩니다" 금지).\n'
      + `- 모든 콘텐츠 맨 끝에 반드시 이 한 줄 포함: "${ctaLine}"\n`
      + '- ❄️(SNS 4종)는 신청링크보다 "채널 추가"를 앞세운다. 🌤 카톡은 신청링크도 함께 넣는다.\n'
      + '- 마크다운 기호(#, *, -) 없이 일반 글로. 콘텐츠 사이 설명·인사말 없이 5종만 출력.';
    const r = await anthropic.messages.create({
      model: MODEL, max_tokens: 20000, thinking: { type: 'adaptive' },
      system, messages: [{ role: 'user', content: ask }],
    });
    let text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

    const LABELS = {
      카톡채널:   '🌤 카톡 채널 · 관심친구 · 관심유도',
      유튜브쇼츠: '❄️ 유튜브 쇼츠 대본 · 가치증명',
      인스타:     '❄️ 인스타 카드뉴스/릴스 · 가치증명',
      페북:       '❄️ 페이스북 텍스트+링크 · 가치증명',
      블로그:     '❄️ 블로그 긴 정보글 · 가치증명',
    };
    const found = [...text.matchAll(/\[\[(카톡채널|유튜브쇼츠|인스타|페북|블로그)\]\]/g)];
    let parts = found.length
      ? found.map((m, i) => ({
          key: m[1], label: LABELS[m[1]],
          text: text.slice(m.index + m[0].length, i + 1 < found.length ? found[i + 1].index : undefined).trim(),
        }))
      : [{ key: '전체', label: '홍보 콘텐츠', text: text.trim() }];
    // 카카오 채널추가 문구가 빠진 콘텐츠는 코드가 한 번 더 보강 (요구사항: 모든 발송물에 필수)
    parts = parts.map((p) => p.text.includes(cKakao) ? p : { ...p, text: p.text + '\n' + ctaLine });

    appendDiary({
      ts: new Date().toISOString(), agentId: 'mkt', agentName: '마케팅', project: project || '머니트레이닝랩', kind: 'hand',
      entry: `[손] 채널별 홍보 콘텐츠 ${parts.length}종 생성 (관계온도별 톤)${guide ? ` — 지시: ${String(guide).slice(0, 80)}` : ''}`,
    });
    res.json({ parts, applyLink: cApply, kakaoChannel: cKakao });
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
