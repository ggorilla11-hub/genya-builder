// ─────────────────────────────────────────────────────────────
// main_server.js — 공통 메인(/main) 프로토타입 서버 (부트캠프 공통 자산)
// 무엇을·왜: 지금까지 만든 범용 기술을 한 화면(/main)에 모은다. 8종 능력 카드 뼈대 +
//   이미 검증된 3종(캘린더·시트·약관) 실작동 API.
//
// ★원칙1 (Zero data ingress): 고객 데이터(일정·명단)는 회원 구글에서 "그때 읽어" 응답에 담고
//   서버에 저장하지 않는다(전역 캐시·파일 기록 0). 서버 보관 = 공개약관 텍스트(공통 지식)뿐.
// ★원칙2: /main = 공통(전 회원). 이름·호칭·고객데이터 = 개인 레이어(지금은 대표님 SA 데모).
// ★원칙3: 지금은 SA 공유 데모. 구조는 회원 OAuth 대비(googleAuth()만 교체하면 회원 토큰으로).
// ★안전: 읽기만. 발송·수정·삭제 0. /parksugeun·jenya·기존 시트 무접촉.
// ─────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { google } = require('googleapis');
const { PDFParse } = require('pdf-parse');
// ★3대 창고 모듈을 한 줄씩 "꽂음"
const { askYakgwan } = require('./yakgwan_module');           // 📄 약관창고
const skills = require('./skills_index');                 // 🛠️ 스킬창고
const connectors = require('./connectors_index');     // 🔌 커넥터창고
const memory = require('./memory_module');                   // 🧠 기억 엔진
const _openai = new (require('openai'))({ apiKey: process.env.OPENAI_API_KEY });
// ★워크스페이스 대화 = Anthropic Claude Sonnet 5(대표 지시). 온보딩·OCR·약관·문자초안은 OpenAI 유지.
//   대표가 준 'claude-sonnet-4-6-20250514'는 존재하지 않는 ID → 최신 Sonnet인 claude-sonnet-5로. 날짜접미사 금지.
const _anthropic = new (require('@anthropic-ai/sdk'))({ apiKey: process.env.ANTHROPIC_API_KEY });
const WS_CHAT_MODEL = 'claude-sonnet-5';
// ★대화 품질 업그레이드(2026-07-06): OpenAI 폴백 모델 gpt-4o-mini → gpt-4o. OCR은 이미 gpt-4o.
const CHAT_MODEL = 'gpt-4o';
// ★지니야 공용 페르소나(70대 어르신도 알아듣게·클로드 언급 금지·휴먼인더루프). job=직업 맞춤.
function genyaPersona(job) {
  const j = (job && String(job).trim()) || '1인 사업자';
  return `당신은 "지니야" — ${j}의 든든한 AI 비서입니다.
[역할] 사용자의 직업(${j})에 맞는 전문 비서로서 핵심 업무를 돕습니다. 보험설계사라면 증권 분석·고객 관리·문자 초안·만기 알림 등, 다른 직업이면 그 직업의 핵심 업무를.
[말하기 원칙]
1. 따뜻하고 전문적인 톤. 70대 어르신도 한 번에 알아듣게 쉬운 말로, 전문용어는 풀어서. 자기소개는 "지니야"로만 한다.
2. "클로드"·"AI 모델"·"챗봇" 같은 말은 절대 쓰지 않는다. 너는 그냥 "지니야"다.
3. 막막한 질문엔 한 번에 하나~둘만 되묻는다. 아는 척·지어내기 금지 — 모르면 "확인이 필요해요".
4. 특정 상품·약관 수치는 단정하지 말고 "약관 확인 필요"라고 한다.
5. 중요한 결과물(문서·문자·제출용)은 항상 "보내기/제출 전에 한번 확인해 주세요"를 붙인다(사람이 최종 결정).
6. 발송·수정·삭제는 반드시 사람 승인 후. 고객 개인정보는 함부로 되풀이하지 않는다.
7. 답변은 표·목록·단계로 구조화해 보기 쉽게. 구체적이고 바로 실행할 수 있게 안내한다(막연한 원론 금지).
8. 특정 금융상품·보험사·회사명을 "추천"하거나 가입을 권유하지 않는다(중립적 설명·비교는 가능).
9. 답변 끝에 다음에 도울 것을 짧게 되묻는다(예: "이대로 진행할까요?", "더 도와드릴까요?").`;
}
// ★공통: 모든 대화를 Claude Sonnet 5로. system 별도·role은 user/assistant만·연속 동일role 병합·첫줄 user 보장.
//   Claude 실패(키·에러) 시 OpenAI 폴백 → 대화가 절대 끊기지 않게.
async function askClaude(systemPrompt, messages, maxTokens) {
  maxTokens = maxTokens || 1500;
  const fmt = (messages || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || m.text || '').slice(0, 2000) })).filter((m) => m.content);
  const cleaned = [];
  for (const m of fmt) { if (cleaned.length && cleaned[cleaned.length - 1].role === m.role) cleaned[cleaned.length - 1].content += '\n' + m.content; else cleaned.push(m); }
  if (!cleaned.length) cleaned.push({ role: 'user', content: '(대화 시작)' });
  if (cleaned[0].role === 'assistant') cleaned.unshift({ role: 'user', content: '(대화 시작)' });
  try {
    const r = await _anthropic.messages.create({ model: WS_CHAT_MODEL, max_tokens: maxTokens, system: systemPrompt, messages: cleaned });
    const t = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (t) return t;
    throw new Error('빈 응답');
  } catch (e) {
    const or = await _openai.chat.completions.create({ model: CHAT_MODEL, temperature: 0.5, max_tokens: maxTokens, messages: [{ role: 'system', content: systemPrompt }].concat(cleaned) });
    return (or.choices[0].message.content || '').trim();
  }
}
const SKILL_OUT = require('path').join(__dirname, 'out');

const KEY_FILE = process.env.GOOGLE_SA_JSON || '{}';
const DEMO_TITLE = '지니야빌더_데모_명단';
const SHEET_TAB = '고객명단';
const CAL_ID = process.env.CAL_ID || 'ggorilla11@gmail.com';
const PORT = process.env.PORT || 8080;

// 약관(공개 문서·공통 지식) = 서버 보관 OK
const YAK = JSON.parse(fs.readFileSync(path.join(__dirname, 'yakgwan_pages.json'), 'utf8'));

const app = express();
app.use(express.json({ limit: '50mb' })); // 자료 업로드(base64) 파싱 — 큰 제안서 PDF 다중 업로드 대비 상향

// ── 🔑 구글 OAuth 로그인 통합 (auth-oauth/.env에서 자격, 하드코딩 0) ──
try { require('dotenv').config(); } catch (e) {}
const crypto = require('crypto');
const OA_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const OA_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
// ★배포 콜백 자동화: env 미설정 시 Render 배포 도메인(RENDER_EXTERNAL_URL)으로 콜백 → 로그인 후 배포 서버(genya.html)로 복귀
// ★redirect_uri 확정: 배포에선 무조건 배포 도메인. Render env에 localhost가 잘못 들어있어도 무시(env 최우선의 함정 방어).
const _DEPLOY = 'https://genya-builder.onrender.com';
const _isLocalDev = /^809[012]$/.test(String(process.env.PORT || ''));  // 로컬 개발 포트(8090/8091/8092)만 localhost
let _envRedirect = process.env.GOOGLE_OAUTH_REDIRECT;
if (_envRedirect && /localhost/i.test(_envRedirect) && !_isLocalDev) _envRedirect = null; // 배포인데 localhost env면 무시
const OA_REDIRECT = _envRedirect || (_isLocalDev ? `http://localhost:${process.env.PORT}/auth/google/callback` : _DEPLOY + '/auth/google/callback');
// ★"확인 안 된 앱" 경고 제거: 로그인은 openid·email·profile만(민감 스코프 없음 → 경고 안 뜸).
//   캘린더·시트·드라이브(민감)는 그 기능 쓸 때 /auth/google/connect 로 별도 동의(incremental).
const LOGIN_SCOPES = ['openid', 'email', 'profile'];
const DATA_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'];
const OA_SCOPES = LOGIN_SCOPES;
const OA_CONFIGURED = !!(OA_ID && OA_SECRET);
// ★회원 간 격리: 세션ID → {email, tokens}. 서버 메모리에만(디스크·DB 0, 회원 데이터 저장 0=토큰뿐)
const sessions = new Map();
function oaClient() { return new google.auth.OAuth2(OA_ID, OA_SECRET, OA_REDIRECT); }
function sidOf(req) { const m = /(?:^|;\s*)genya_sid=([^;]+)/.exec(req.headers.cookie || ''); return m && m[1]; }
function sessionOf(req) { const s = sidOf(req); return s && sessions.get(s); }
// ★핵심: 로그인했으면 회원 구글 OAuth 클라이언트(회원 토큰), 아니면 null → 각 함수가 SA로 폴백
//   카카오 로그인 세션은 구글 토큰이 없어(s.tokens 없음) → null → 데이터 기능엔 구글 연결 필요(정직).
function memberAuth(req) { const s = sessionOf(req); if (!s || !s.tokens) return null; const c = oaClient(); c.setCredentials(s.tokens); return c; }
// ★스코프 판별: 로그인만(email/profile) vs 데이터(캘린더·시트·드라이브) 동의 여부. 일반 대화는 데이터 불필요.
function grantedScope(req) { const s = sessionOf(req); if (!s) return ''; return String(s.scope || (s.tokens && s.tokens.scope) || ''); }
function hasDataScope(req) { return /calendar|spreadsheets|\/drive/.test(grantedScope(req)); }
function isScopeError(e) { return /insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT|Insufficient Permission|invalid_scope|PERMISSION_DENIED/i.test((e && e.message) || ''); }

// ★구글 연결 게이트 + SA 잔재 제거: 데이터 기능은 "회원 구글 토큰"이 있을 때만.
//   없으면(카카오·미로그인) SA로 폴백하지 않고 "구글 연결 필요"로 정직히 게이트(대표 SA 데이터 노출 0).
function gateGoogle(req, res) {
  const ma = memberAuth(req);
  if (ma && hasDataScope(req)) return ma; // ★로그인만 하고 데이터 스코프 없으면 통과 안 함(500 방지)
  const s = sessionOf(req);
  res.json({ ok: true, needsGoogle: true, needsConnect: true, connectUrl: '/auth/google/connect', provider: s ? s.provider : null, message: s ? '내 데이터(캘린더·시트·드라이브)를 보려면 구글 데이터 연결이 필요해요' : '로그인이 필요해요' });
  return null;
}

// ── 💬 카카오 로그인 (구글과 동일 패턴 · 자격은 env, 하드코딩 0) ──
//   ★카카오 = "누구인지"(신원)만. 회원 구글 데이터(캘린더·시트·드라이브)는 카카오로 못 얻음
//   → 카카오 로그인 후에도 데이터 기능은 [구글 연결]이 필요(원칙1). 정직히 분리.
const KA_KEY = process.env.KAKAO_REST_KEY || '';
let _envKa = process.env.KAKAO_REDIRECT;
if (_envKa && /localhost/i.test(_envKa) && !_isLocalDev) _envKa = null;
const KA_REDIRECT = _envKa || (_isLocalDev ? `http://localhost:${process.env.PORT}/auth/kakao/callback` : _DEPLOY + '/auth/kakao/callback');
const KA_CONFIGURED = !!KA_KEY;

// ── SA 폴백(데모). 로그인 시엔 memberAuth가 우선 ──
function googleAuth(scopes) {
  const creds = JSON.parse(KEY_FILE);
  return new google.auth.GoogleAuth({ credentials: creds, scopes });
}

// ── 회원 명단 시트 읽기(원칙1: 읽어서 반환, 서버 저장 0). ma=회원토큰/없으면 SA ──
async function readRoster(ma) {
  const auth = ma || googleAuth([
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
  ]);
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });
  const f = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.spreadsheet' and name='${DEMO_TITLE}' and trashed=false`,
    fields: 'files(id)',
  });
  const id = (f.data.files || [])[0] && f.data.files[0].id;
  if (!id) return [];
  const got = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${SHEET_TAB}!A1:T50` });
  const [H, ...body] = got.data.values || [[]];
  return body.filter((r) => r && r.length).map((r) => { const o = {}; H.forEach((h, i) => o[h] = r[i] || ''); return o; });
}

function prepFor(c) {
  if (!c) return [];
  const notes = [];
  if (c['가입상품'] === '자동차보험' && String(c['만기일']).startsWith('2026-07')) notes.push(`7월 자동차 만기(${c['만기일']}) → 보험사 비교표 준비`);
  if (String(c['비고']).includes('자산가')) notes.push(`자산가 고객 → ${String(c['비고']).replace('자산가, ', '')} 준비(3포인트)`);
  if (!notes.length && c['비고']) notes.push(c['비고']);
  return notes;
}

// ── 📅 캘린더 브리핑: 회원 캘린더 오늘 일정 + 명단 자동 연결 ──
app.get('/api/calendar', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return; // ★회원 구글 토큰으로만(SA 폴백 제거)
    const roster = await readRoster(ma);
    const byName = {}; roster.forEach((c) => byName[c['고객명']] = c);
    const cal = google.calendar({ version: 'v3', auth: ma });
    const now = new Date(); const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const timeMin = new Date(y, m, d, 0, 0, 0).toISOString();
    const timeMax = new Date(y, m, d, 23, 59, 59).toISOString();
    const ev = await cal.events.list({ calendarId: 'primary', timeMin, timeMax, singleEvents: true, orderBy: 'startTime' });
    const events = (ev.data.items || []).map((e) => {
      const start = (e.start || {}).dateTime || (e.start || {}).date || '';
      const time = start.length >= 16 ? start.slice(11, 16) : '종일';
      const title = e.summary || '(제목없음)';
      const name = Object.keys(byName).find((n) => title.includes(n));
      return { time, title, prep: prepFor(byName[name]) };
    });
    res.json({ ok: true, date: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, count: events.length, events });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 📊 시트 명단 정리: 필터/정렬(원칙1: 읽기만, 저장 0) ──
app.get('/api/sheets', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return; // ★회원 구글 토큰으로만
    const roster = await readRoster(ma);
    const july = roster.filter((o) => o['가입상품'] === '자동차보험' && String(o['만기일']).startsWith('2026-07'));
    const byDue = [...july].sort((a, b) => String(a['만기일']).localeCompare(String(b['만기일'])));
    const rich = roster.filter((o) => String(o['비고']).includes('자산가') || Number(o['연소득(만원)']) >= 15000);
    const slim = (arr) => arr.map((o) => ({ 고객명: o['고객명'], 만기일: o['만기일'], 보험사: o['보험사'], 직업: o['직업'], 비고: o['비고'] }));
    res.json({ ok: true, total: roster.length, q1_7월만기: slim(july), q2_만기임박순: slim(byDue), q3_자산가: slim(rich) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 📄 약관 검색: 약관 창고(RAG 모듈)에서 근거 찾아 쉽게 답 + 출처(페이지). 없으면 "확인 필요" ──
app.get('/api/yakgwan', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ ok: true, note: '질문을 입력하세요(예: 무보험차상해가 뭐야? / 자기신체사고와 자동차상해 차이?)' });
    const r = await askYakgwan(q);
    res.json({ ok: true, query: q, found: r.found, answer: r.answer, sources: r.sources, pages: r.pages });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 📁 드라이브 증권 검색: 회원 드라이브에서 파일 찾기 + 열어서 보장 읽기 ──
//    ★원칙1: 고객 파일은 회원 드라이브에만. 서버는 메모리로 받아 읽고 버림(저장 0).
app.get('/api/drive', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return; // ★회원 구글 토큰으로만
    const q = String(req.query.q || '증권').trim();
    const readId = req.query.read;
    const drive = google.drive({ version: 'v3', auth: ma });

    if (readId) {
      // 찾은 증권 열어서 핵심 보장 읽기(메모리, 저장 0)
      const meta = await drive.files.get({ fileId: readId, fields: 'name' });
      const dl = await drive.files.get({ fileId: readId, alt: 'media' }, { responseType: 'arraybuffer' });
      const buf = Buffer.from(dl.data);
      const parser = new PDFParse({ data: buf });
      const r = await parser.getText(); await parser.destroy();
      const text = (Array.isArray(r.pages) ? r.pages.map((p) => p.text !== undefined ? p.text : p).join(' ') : r.text || '').replace(/\s+/g, ' ');
      const covers = [];
      ['대물', '자기신체사고', '자동차상해', '대인배상', '무보험', '긴급출동', '자기차량'].forEach((k) => {
        const i = text.indexOf(k); if (i >= 0) covers.push({ 항목: k, 내용: text.slice(i, i + 40).trim() });
      });
      return res.json({ ok: true, name: meta.data.name, sizeKB: Math.round(buf.length / 1024), covers, note: '메모리에서 읽고 버림 — 서버 저장 0' });
    }

    // 검색: 이름에 q 포함(공백 분리 AND)
    const terms = q.split(/\s+/).filter(Boolean);
    const qstr = terms.map((t) => `name contains '${t.replace(/'/g, '')}'`).join(' and ') + ` and trashed=false`;
    const r = await drive.files.list({ q: qstr, fields: 'files(id,name,webViewLink,modifiedTime)' });
    res.json({ ok: true, query: q, count: (r.data.files || []).length, files: (r.data.files || []).map((f) => ({ id: f.id, name: f.name, link: f.webViewLink })) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 🛠️ 스킬창고: 목록 + 샘플 생성(실제 파일) ──
// ★⚠️1 차단(회사 존폐): 생성물(/files)은 로그인한 본인만 접근. 미로그인 = 401 차단(URL 알아도 못 받음).
app.use('/files', (req, res, next) => { if (!sessionOf(req)) return res.status(401).send('로그인 필요 — 생성물은 로그인한 본인만 접근 가능(오원트 서버 개인정보 금지구역)'); next(); }, express.static(SKILL_OUT));
app.get('/api/skills', (req, res) => res.json({ ok: true, list: skills.list }));
// ★★고객 데이터 무유입 원칙(절대·회사 존폐): 이 gen은 "공용 고정 템플릿"만 만든다 — 고객 이름·증권번호·진단서 등
//   개인정보를 받는 입력 경로가 없다(아래 내용은 전부 하드코딩 문구). SKILL_OUT(서버 디스크)은 개인정보 금지구역.
//   ▶ 향후 "고객 데이터로 문서 생성" 기능을 붙일 땐 절대 SKILL_OUT에 쓰지 말 것.
//     반드시 (a) 회원 본인 드라이브로 직행 저장(/api/drive/upload 방식: 메모리 Buffer→drive.files.create(회원토큰)),
//     또는 (b) 생성 즉시 서버에서 삭제(fs.unlink). 이 원칙을 어기면 고객 데이터가 서버에 남는다.
app.get('/api/skills/gen', async (req, res) => {
  try {
    if (!sessionOf(req)) return res.status(401).json({ ok: false, error: '로그인 필요' });
    const type = String(req.query.type || 'pdf');
    let file;
    if (type === 'pdf') { file = 'S1_고객안내문.pdf'; await skills.pdf.makePdf({ title: '자동차보험 만기 안내', subtitle: '지니야 자동 생성 (검토 후 발송)', sections: [{ heading: '안내', lines: ['만기가 다가와 안내드립니다.', '보장 점검 후 보완안을 준비했습니다.'] }], footer: '발송 전 담당 설계사 검토 필수.' }, path.join(SKILL_OUT, file)); }
    else if (type === 'excel') { file = 'S2_자동차보험_3사비교표.xlsx'; skills.excel.makeSheet({ title: '3사비교(예시)', headers: ['항목', '삼성화재', 'DB손해보험', '현대해상'], rows: [['대물배상', '3억', '3억', '3억'], ['자기신체/자동차상해', '자동차상해', '자동차상해', '자기신체'], ['무보험차상해', '2억', '2억', '2억'], ['월 보험료', '설계사 견적', '설계사 견적', '설계사 견적']] }, path.join(SKILL_OUT, file)); }
    else if (type === 'ppt') { file = 'S3_보장분석_제안세미나.pptx'; await skills.ppt.makeDeck({ title: '내 보험, 제대로 됐을까?', subtitle: '보장분석 무료 점검 세미나', slides: [{ title: '왜 점검이 필요할까요', bullets: ['보장 공백', '과보험·중복', '시대 변화'] }, { title: '이렇게 도와드립니다', bullets: ['3축 점검', '보완안+이유', '3사 비교표'] }] }, path.join(SKILL_OUT, file)); }
    else if (type === 'doc') { file = 'S4_상담보고서.docx'; await skills.doc.makeDoc({ title: '고객 상담 보고서', subtitle: '지니야 자동 생성 (검토용 초안)', sections: [{ heading: '상담 개요', paras: ['주제: 자동차보험 보장분석'] }, { heading: '제안', paras: ['A/B/C안 + 추천 1개 한 장 요약.'] }], footer: '발송·제출 전 검토 필수.' }, path.join(SKILL_OUT, file)); }
    else return res.status(400).json({ ok: false, error: '알 수 없는 type' });
    const kb = Math.round(fs.statSync(path.join(SKILL_OUT, file)).size / 1024);
    res.json({ ok: true, type, file, url: '/files/' + encodeURIComponent(file), sizeKB: kb });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── ⚖️ 상품비교 스킬: 제안서 사진(들) → 담보비교 + 적정성(오상열 CFP 공식) + 우선순위(이론상 최적) ──
//   ★원칙1(Zero data ingress): 사진은 base64로 받아 메모리에서 지니야 눈에 넘기고 버린다(서버 디스크 저장 0).
//   ★불변: 중립 비교(추천 아님) · 4·5단계 준비 중 · "실제 인수는 심사에서 확정"(휴먼인더루프).
app.post('/api/compare', async (req, res) => {
  try {
    const b = req.body || {};
    const images = Array.isArray(b.images) ? b.images : [];
    if (!images.length) return res.json({ ok: true, note: '제안서 사진을 1~4장 올려주세요 (예: 삼성생명 The퍼스트 · 삼성화재 간편365). 연봉·부채를 함께 주시면 적정성까지 계산해요.' });
    const r = await skills.compare.compareProducts({ images, annualIncome: b.annualIncome, debt: b.debt });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 🔌 커넥터창고: 목록 + 연결 수 ──
app.get('/api/connectors', (req, res) => res.json({ ok: true, connectedCount: connectors.connectedCount, list: connectors.list }));

// ★카드→대화 맥락: 프론트가 보낸 activeSkill 코드 → 사람이 읽는 작업명(시스템 프롬프트 주입용). 카드에서 시작한 작업을 지니야가 기억·이어감.
const SKILL_CTX = {
  insurance_review: '보험 증권 분석(보장 진단)',
  product_compare: '상품 비교(제안서 담보·보험료·인수 비교)',
  yakgwan: '약관 해석(근거·출처로 쉽게 설명)',
  lead_gen: '고객 발굴',
  renewal: '만기·생일 관리',
  add_agent: '새 비서(맞춤 기능) 추가 요청 — 반복 업무를 듣고, 만들 수 있으면 방법을 안내한다. 어려우면 "이 비서는 아직 제가 못 만들어요. 본사 오상열 대표님(ggorilla11@gmail.com)께 요청해 주세요"라고 정직히 안내(지어내기·있는 척 금지)',
  add_tool: '새 도구·커넥터 추가 요청 — 연결 가능하면 방법 안내, 아직 안 되는 도구면 "본사 오상열 대표님(ggorilla11@gmail.com)께 요청해 주세요"라고 정직히 안내',
};
// ── 💬 Order Made: 자연어 → 실제 모듈 라우팅 + ★결정·요청 자동 기억(회원 구글) ──
async function orderHandler(req, res) {
  try {
    const q = String((req.body && (req.body.q || req.body.message)) || req.query.q || '').trim();
    const ma = memberAuth(req);
    const canData = !!(ma && hasDataScope(req)); // ★데이터 스코프까지 있는 회원만 캘린더·시트·드라이브 호출
    if (!q) return res.json({ ok: true, kind: 'idle', text: '무엇이든 말씀하세요 (예: "무보험차상해가 뭐야?" / "이번 주 만기 고객 정리해줘")' });
    // ★데이터가 필요한데 권한이 없으면 대화를 막지 말고 "연결하기" 안내(일반 대화는 아래 LLM으로 무조건 응답)
    const needConnect = { kind: '🔗 구글 데이터 연결 필요', text: '이 질문은 캘린더·시트·드라이브를 읽어야 답할 수 있어요. 아래 버튼으로 한 번만 연결하면 바로 알려드릴게요. (일반 질문은 연결 없이도 대답해요)', needsConnect: true, connectUrl: '/auth/google/connect' };
    const activeSkill = String((req.body && req.body.activeSkill) || '');
    let out = {};
    if (activeSkill && SKILL_CTX[activeSkill]) {
      // ★카드에서 시작한 작업 맥락: 키워드 라우팅(증권→드라이브 "해당 파일 없음") 건너뛰고 LLM이 맥락 유지해 이어서 답한다
      const job = String((req.body && req.body.job) || req.query.job || '');
      const hist = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-10) : [];
      const sys = genyaPersona(job) + `\n[현재 작업] 지금 사용자는 "${SKILL_CTX[activeSkill]}" 작업을 진행 중이다. 앞서 지니야가 안내한 내용(예: 사진·파일 업로드 요청)을 기억한 채 맥락을 유지하고 그 작업을 이어서 돕는다. 맥락을 잃고 "해당 파일 없음" 같은 엉뚱한 답을 하지 마라. 파일이 필요하면 화면 아래 ＋ 버튼으로 올려달라고 자연스럽게 안내한다.`;
      const text = await askClaude(sys, hist.concat([{ role: 'user', content: q }]), 1500);
      out = { kind: '💬 지니야', text, engine: 'claude-sonnet-5' };
    } else if (/약관|무보험|대물|자기신체|자동차상해|담보|보장.*(뭐|무엇|차이)/.test(q)) {
      const r = await askYakgwan(q); out = { kind: '📄 약관창고', text: r.answer, sources: r.sources }; // 공통 지식(구글 불필요)
    } else if (/만기|명단|자산가|고객.*(정리|목록|누구)/.test(q)) {
      if (!canData) { out = needConnect; } else { const s = await connectors.sheet(ma); out = { kind: '🔌 시트 커넥터', text: `7월 만기 ${s.july만기.length}명 · 임박순 ${s.임박순.join(' → ')}\n자산가: ${s.자산가.join(', ')}` }; }
    } else if (/증권|드라이브|서류|파일.*찾/.test(q)) {
      if (!canData) { out = needConnect; } else { const d = await connectors.drive(q.replace(/찾아줘|보여줘|줘/g, '').trim() || '증권', ma); out = { kind: '🔌 드라이브 커넥터', text: d.length ? d.map((f) => '📄 ' + f.name).join('\n') : '해당 파일 없음' }; }
    } else if (/일정|브리핑|오늘.*(뭐|일정)|아침/.test(q)) {
      if (!canData) { out = needConnect; } else { const c = await connectors.calendar(ma); out = { kind: '🔌 캘린더 커넥터', text: c.map((e) => `${e.time} ${e.title}${e.prep[0] ? ' → ' + e.prep[0] : ''}`).join('\n') || '오늘 일정 없음' }; }
    } else {
      // ★워크스페이스 대화 = Claude Sonnet 5(askClaude 공통) + 히스토리(-10) + 직업 페르소나
      const job = String((req.body && req.body.job) || req.query.job || '');
      const hist = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-10) : [];
      const text = await askClaude(genyaPersona(job), hist.concat([{ role: 'user', content: q }]), 1500);
      out = { kind: '💬 지니야', text, engine: 'claude-sonnet-5' };
    }
    // ★연결1: 결정·요청이면 회원 구글시트에 자동 기억(서버 저장 0) — 데이터 스코프 있는 회원만(없으면 조용히 건너뜀)
    let saved = null;
    if (canData && /준비|해줘|만들어|보내|정리|초안|잡아|하기로|예약|하자|올려/.test(q)) {
      const nameM = q.match(/([가-힣]{2,4})님/);
      try { await memory.saveMemory({ type: '요청', subject: nameM ? nameM[1] : '', text: q }, ma); saved = { subject: nameM ? nameM[1] : '', text: q }; } catch (e) {}
    }
    res.json({ ok: true, ...out, saved });
  } catch (e) {
    // ★권한부족이 여기까지 새면 대화 전체가 막히지 않도록 "연결하기"로 정직히 안내(500 대신)
    if (isScopeError(e)) return res.json({ ok: true, kind: '🔗 구글 데이터 연결 필요', text: '이 질문은 내 구글 데이터를 읽어야 해요. 아래 버튼으로 연결해 주세요. (일반 질문은 연결 없이도 대답해요)', needsConnect: true, connectUrl: '/auth/google/connect' });
    res.status(500).json({ ok: false, error: e.message });
  }
}
app.get('/api/order', orderHandler);   // 단발(카드·솔브 등)
app.post('/api/order', orderHandler);  // ★워크스페이스 대화(히스토리 body 전달)

// ── 🧠 기억 엔진 (★로그인 회원 자기 구글시트에만 · 회원 간 격리 · SA 폴백 제거) ──
app.get('/api/memory/recent', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; res.json({ ok: true, list: await memory.recallRecent(8, ma) }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
app.get('/api/memory/recall', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; res.json({ ok: true, list: await memory.recallMemory(req.query.q || '', ma) }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
app.get('/api/memory/lead', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; const r = await memory.recallRecent(8, ma); const dec = r.find((m) => m.type === '결정' || m.type === '요청'); res.json({ ok: true, lead: dec ? memory.leadLine(dec) : null }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
app.get('/api/memory/save', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; const r = await memory.saveMemory({ type: req.query.type || '메모', subject: req.query.subject || '', text: req.query.text || '' }, ma); res.json({ ok: true, ...r }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
app.get('/api/memory/delete', async (req, res) => { try { const ma = gateGoogle(req, res); if (!ma) return; res.json({ ok: true, ...(await memory.deleteMemory(parseInt(req.query.row, 10), ma)) }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });

// ── 🎓 온보딩: 회원 프로필(직업·설문) = 회원 본인 구글시트에만 저장(원칙1) ──
//   ★회원 OAuth는 SA와 달리 자기 드라이브에 시트 생성 가능 → 없으면 만들어줌(진짜 다회원).
const PROFILE_TAB = '지니야_프로필';
async function findOrCreateMemberSheet(ma) {
  const drive = google.drive({ version: 'v3', auth: ma }), sheets = google.sheets({ version: 'v4', auth: ma });
  const f = await drive.files.list({ q: `mimeType='application/vnd.google-apps.spreadsheet' and name='${DEMO_TITLE}' and trashed=false`, fields: 'files(id)' });
  let id = (f.data.files || [])[0] && f.data.files[0].id;
  if (!id) { const c = await sheets.spreadsheets.create({ requestBody: { properties: { title: DEMO_TITLE }, sheets: [{ properties: { title: SHEET_TAB } }] }, fields: 'spreadsheetId' }); id = c.data.spreadsheetId; }
  return { id, sheets };
}
async function ensureTab(sheets, id, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
  if (!(meta.data.sheets || []).some((s) => s.properties.title === title)) await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
}
app.get('/api/profile', async (req, res) => {
  try { const ma = gateGoogle(req, res); if (!ma) return; const { id, sheets } = await findOrCreateMemberSheet(ma);
    let rows = []; try { const g = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${PROFILE_TAB}!A1:B20` }); rows = g.data.values || []; } catch (e) {}
    const p = {}; rows.forEach((r) => { if (r[0]) p[r[0]] = r[1] || ''; });
    res.json({ ok: true, onboarded: !!p['직업'], profile: p });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/profile/save', async (req, res) => {
  try { const ma = gateGoogle(req, res); if (!ma) return; const { id, sheets } = await findOrCreateMemberSheet(ma);
    await ensureTab(sheets, id, PROFILE_TAB);
    const rows = [['직업', String(req.query.job || '')], ['하는일', String(req.query.work || '')], ['주고객', String(req.query.clients || '')], ['반복업무', String(req.query.pain || '')], ['맡길기능', String(req.query.tasks || '')], ['철칙', String(req.query.rule || '')], ['설문방식', String(req.query.mode || '')], ['생성일', new Date().toISOString().slice(0, 10)]];
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${PROFILE_TAB}!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });
    res.json({ ok: true, saved: true, sheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit` });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// 온보딩 화면(로그인 게이트)
app.get('/onboarding', (req, res) => { res.redirect('/'); }); // ★옛날 축소판 제거 → v4(genya.html)로 통일

// 🤖 목표 → 실제 능력 배정(LLM이 우리 실제 커넥터/창고로 매핑. 글자매칭 아님)
app.get('/api/agents/assign', async (req, res) => {
  try {
    const goals = String(req.query.goals || '').split('|').map((s) => s.trim()).filter(Boolean);
    if (!goals.length) return res.json({ ok: true, agents: [] });
    const CATALOG = '가능한 실제 능력(우리 엔진): 발굴(유튜브 공개댓글 Hot/Warm), 리스닝(공개 커뮤니티 보험고민 탐지), 시트(고객명단 만기·자산가 정리), 캘린더(일정+준비물 브리핑), 드라이브(증권·서류 검색·읽기), 약관(약관 근거+출처 답), 스킬(PDF·엑셀·PPT·문서 생성), 기억(정한 것 기억·먼저 리딩), 웹조사(실시간 상품·시세).';
    const sys = `너는 온보딩 배정기다. 사용자의 목표 각각에 대해 위 "실제 능력" 중 맞는 것을 1~2개 배정한다. 목록에 있는 이름만 쓴다. JSON 배열만: [{"goal":"목표","agents":["능력명"],"why":"짧은근거"}]. ${CATALOG}`;
    const r0 = await askClaude(sys, [{ role: 'user', content: '목표들:\n' + goals.map((g, i) => (i + 1) + '. ' + g).join('\n') }], 500);
    let raw = (r0 || '').trim(); raw = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
    let agents = []; try { agents = JSON.parse(raw); } catch (e) {}
    res.json({ ok: true, agents });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 📤 자료 올리기 = ★원천 차단(서버 통과 0): 파일은 브라우저→구글 드라이브 직행한다.
//   서버는 회원 access_token'만' 발급하고, 파일 바이트는 오원트 서버를 절대 지나가지 않는다.
//   refresh_token은 서버 세션에만(브라우저 미노출). 노출되는 access_token은 drive.file 스코프(앱이 만든 파일만).
//   ※ 구 방식 POST /api/drive/upload(base64가 서버 RAM을 통과)는 대표 지시로 폐기함.
app.get('/api/drive/token', async (req, res) => {
  try {
    const ma = gateGoogle(req, res); if (!ma) return;              // 회원 구글 세션 없으면 거부(SA 폴백 없음)
    const t = await ma.getAccessToken();                            // 단기 access_token만. refresh_token 미노출
    if (!t || !t.token) return res.status(401).json({ ok: false, error: '토큰 없음 — 구글 재연결 필요' });
    res.json({ ok: true, token: t.token, note: '브라우저 직행 업로드용 단기 access_token(drive.file). 파일은 서버 안 지남.' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 🗣️ 자연어 대화/업로드 텍스트 → 프로필 추출(실제 LLM, 하드코딩 아님)
// ★E4 수정: POST(body.text) 지원 → 긴 자유서술도 안전(GET 쿼리 길이 431 회피). GET은 하위호환.
async function _extractHandler(req, res) {
  try {
    let text = String((req.body && req.body.text) || req.query.text || '').trim();
    if (!text) return res.json({ ok: true, profile: {} });
    if (text.length > 4000) text = text.slice(0, 4000); // 초장문 방어(크래시 없이 앞부분만)
    const sys = `너는 온보딩 도우미다. 사용자가 자기 일을 설명한 글에서 아래 필드를 뽑아 JSON만 출력한다(없으면 빈칸): {"job":"직업","work":"하는 일","clients":"주 고객","pain":"반복 업무","tasks":"맡길 기능","rule":"철칙"}. tasks는 서로 다른 목표가 여럿이면 세미콜론(;)으로 구분해 한 줄로. 지어내지 말고 글에 있는 것만.`;
    const r0 = await askClaude(sys, [{ role: 'user', content: text }], 400);
    let raw = (r0 || '').trim(); raw = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    let profile = {}; try { profile = JSON.parse(raw); } catch (e) {}
    res.json({ ok: true, profile });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
}
app.post('/api/onboard/extract', _extractHandler);
app.get('/api/onboard/extract', _extractHandler);

// ── 🗣️ 온보딩 대화: 지니야가 자연스럽게 응답(실제 LLM). ★구글 데이터 불필요 = 로그인·권한 없이도 무조건 대답 ──
app.post('/api/onboard/chat', async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').trim();
    if (!text) return res.json({ ok: true, reply: '편하게 말씀해 주세요. 어떤 일을 하시나요?' });
    const history = Array.isArray(req.body && req.body.history) ? req.body.history.slice(-8) : [];
    const sys = genyaPersona(String((req.body && req.body.job) || '')) + '\n[지금 상황] 맞춤 비서를 만드는 온보딩 대화 중. 고객의 직업·제일 힘든 일·맡기고 싶은 일·꼭 지켜야 할 철칙을 한 번에 하나씩 자연스럽게 파악한다(짧고 다정하게 2~3문장). 이미 들은 건 다시 묻지 않는다. 정보가 어느 정도 모이면 아래 \'이 정보로 지니야 만들기\' 버튼을 누르시면 만들어 드린다고 안내한다.';
    const msgs = history.filter((m) => m && m.text).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.text).slice(0, 800) }));
    msgs.push({ role: 'user', content: text.slice(0, 800) });
    const reply = await askClaude(sys, msgs, 500);
    res.json({ ok: true, reply: reply || '네, 알겠어요. 조금 더 말씀해 주세요.' });
  } catch (e) { res.json({ ok: false, reply: '지금 잠깐 응답이 어려워요. 다시 한 번 말씀해 주세요.', error: e.message }); }
});

// ── 📄 ★문제4: 증권 이미지 OCR → 보장분석(gpt-4o 비전). 구글 불필요. ★서버 저장 0: 메모리에서 OpenAI로만 전달, 디스크 미기록 ──
// ★만능 처리기: 어떤 파일이 와도(이미지·PDF·엑셀·텍스트) 판별→변환→분석. "이미지로 올려주세요 멈춤" 제거.
//   서버 저장 0(메모리에서만 처리). 변환 불가 형식만 정직하게 안내. 새 의존성 없음(xlsx·pdf_skill 기존 사용).
app.post('/api/coverage/analyze', async (req, res) => {
  try {
    const dataUrl = String((req.body && req.body.dataUrl) || '');
    const mime = String((req.body && req.body.mime) || '');
    const name = String((req.body && req.body.name) || '');
    if (!dataUrl) return res.json({ ok: false, error: '파일이 없어요.' });
    const b64 = dataUrl.replace(/^data:[^,]*,/, '');
    const ext = (name.split('.').pop() || '').toLowerCase();
    const isImg = /^data:image\//i.test(dataUrl) || /^image\//i.test(mime) || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
    const isPdf = /pdf/i.test(mime) || /^data:application\/pdf/i.test(dataUrl) || ext === 'pdf';
    const isXls = /sheet|excel|spreadsheet|csv/i.test(mime) || ['xlsx', 'xls', 'csv'].includes(ext);
    const isTxt = /^text\//i.test(mime) || ['txt', 'md'].includes(ext);
    const isDoc = /wordprocessing|msword/i.test(mime) || ['docx', 'doc'].includes(ext);
    const isHwp = ['hwp', 'hwpx'].includes(ext);
    const sys = '너는 서류 분석 비서 "지니야"다. 주어진 자료가 무엇인지 먼저 파악하고(보험증권/제안서/고객명단/계약서/보상서류/견적서 등), 그에 맞게 핵심을 비전문가도 알기 쉽게 정리한다. 담보·금액·조건은 표로. 자료에서 확실히 안 보이는 수치는 지어내지 말고 "자료에서 확인 필요"라고 한다. 마지막 줄에 반드시 "※ 제출·발송 전 반드시 검토하세요"를 붙인다.';
    async function claudeText(userText) {
      const ar = await _anthropic.messages.create({ model: WS_CHAT_MODEL, max_tokens: 1400, system: sys, messages: [{ role: 'user', content: userText }] });
      return (ar.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    }
    let analysis = '';
    if (isImg) {
      const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      const mediaType = (m && m[1]) || (/^image\//i.test(mime) ? mime : 'image/jpeg');
      const data = m ? m[2] : b64;
      try {
        const ar = await _anthropic.messages.create({ model: WS_CHAT_MODEL, max_tokens: 1400, system: sys, messages: [{ role: 'user', content: [{ type: 'text', text: '이 자료를 분석해줘.' }, { type: 'image', source: { type: 'base64', media_type: mediaType, data: data } }] }] });
        analysis = (ar.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        if (!analysis) throw new Error('빈 응답');
      } catch (e) {
        const r = await _openai.chat.completions.create({ model: 'gpt-4o', temperature: 0.2, max_tokens: 1200, messages: [{ role: 'system', content: sys }, { role: 'user', content: [{ type: 'text', text: '이 자료를 분석해줘.' }, { type: 'image_url', image_url: { url: dataUrl } }] }] });
        analysis = (r.choices[0].message.content || '').trim();
      }
    } else if (isPdf) {
      try {
        // ★PDF = Claude 문서모드(표·담보를 시각적으로 정확히 봄, 서버 변환 라이브러리 불필요)
        const ar = await _anthropic.messages.create({ model: WS_CHAT_MODEL, max_tokens: 1600, system: sys, messages: [{ role: 'user', content: [{ type: 'text', text: '이 문서를 분석해줘.' }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }] }] });
        analysis = (ar.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        if (!analysis) throw new Error('빈 응답');
      } catch (e) {
        // 폴백: 텍스트 추출 후 분석(표 정밀도는 낮지만 끊기지 않게)
        try { const { readPdf } = require('./pdf_skill'); const pr = await readPdf(Buffer.from(b64, 'base64')); analysis = await claudeText('아래는 PDF에서 추출한 텍스트야. 무엇인지 파악하고 분석해줘:\n\n' + String(pr.text || '').slice(0, 12000)); } catch (e2) { analysis = ''; }
      }
    } else if (isXls) {
      try {
        const XLSX = require('xlsx');
        const wb = XLSX.read(Buffer.from(b64, 'base64'), { type: 'buffer' });
        let dump = ''; wb.SheetNames.slice(0, 3).forEach((nm) => { dump += '[' + nm + ']\n' + XLSX.utils.sheet_to_csv(wb.Sheets[nm]).slice(0, 6000) + '\n\n'; });
        analysis = await claudeText('아래는 엑셀/CSV 내용이야(시트별). 무엇인지 파악하고 핵심을 분석·요약해줘:\n\n' + dump);
      } catch (e) { analysis = ''; }
    } else if (isTxt) {
      try { analysis = await claudeText('아래 텍스트 자료를 분석해줘:\n\n' + Buffer.from(b64, 'base64').toString('utf8').slice(0, 12000)); } catch (e) { analysis = ''; }
    } else if (isDoc || isHwp) {
      return res.json({ ok: true, needsConvert: true, message: (isHwp ? '한글(hwp)' : '워드(docx)') + '는 곧 지원돼요. 지금은 PDF로 저장하거나 내용을 복사해서 올려주시면 바로 분석할게요.' });
    } else {
      return res.json({ ok: true, needsConvert: true, message: '이 형식은 아직 지원 안 돼요(' + (ext || mime || '알 수 없음') + '). 이미지·PDF·엑셀·텍스트로 올려주세요.' });
    }
    if (!analysis) return res.json({ ok: false, error: '분석에 실패했어요. 이미지·PDF로 올려주시면 바로 될 거예요.' });
    res.json({ ok: true, analysis }); // ★결과만 반환, 파일·결과 서버 저장 안 함
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 💬 ★문제5: 안내 문자 초안(실제 LLM). 구글 불필요. 발송 안 함(초안만) ──
app.get('/api/draft/message', async (req, res) => {
  try {
    const topic = String(req.query.topic || '자동차보험 만기 안내');
    const rule = String(req.query.rule || '발송 전 반드시 확인');
    const draftSys = '너는 보험설계사의 비서 지니야다. 고객에게 보낼 짧고 따뜻한 안내 문자 "초안"만 쓴다(실제 발송 안 함). 과장·단정 금지, 부담 주지 않기. 고객 이름은 OOO로. 마지막에 "(발송 전 확인)"을 붙인다.';
    const draft = await askClaude(draftSys, [{ role: 'user', content: '주제: ' + topic + '\n꼭 지킬 철칙: ' + rule }], 400);
    res.json({ ok: true, draft });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 📱 ★문제3: 솔라피 연결정보 저장 = ★회원 본인 구글시트에만(서버 저장 0). 데이터 스코프 없으면 연결 안내 ──
app.post('/api/connect/solapi/save', async (req, res) => {
  try {
    const ma = memberAuth(req);
    if (!ma || !hasDataScope(req)) return res.json({ ok: true, needsConnect: true, connectUrl: '/auth/google/connect', message: '내 시트에 저장하려면 구글 데이터 연결이 필요해요.' });
    const key = String((req.body && req.body.key) || ''), secret = String((req.body && req.body.secret) || ''), from = String((req.body && req.body.from) || '');
    const { id, sheets } = await findOrCreateMemberSheet(ma);
    await ensureTab(sheets, id, '지니야_연결');
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: '지니야_연결!A1', valueInputOption: 'RAW', requestBody: { values: [['솔라피_API_KEY', key], ['솔라피_SECRET', secret], ['솔라피_발신번호', from], ['솔라피_저장일', new Date().toISOString().slice(0, 10)]] } });
    res.json({ ok: true, saved: true }); // ★오원트 서버엔 저장 안 함, 회원 구글시트에만
  } catch (e) { if (isScopeError(e)) return res.json({ ok: true, needsConnect: true, connectUrl: '/auth/google/connect' }); res.status(500).json({ ok: false, error: e.message }); }
});

// ── 미연결 능력(대기) 상태 ──
app.get('/api/status', (req, res) => {
  // ★실제 상태를 정직 반영(런타임 확인 가능한 것 위주)
  res.json({
    ok: true,
    abilities: {
      yakgwan: 'active(약관RAG)',
      openai: process.env.OPENAI_API_KEY ? 'active' : 'no-key',
      googleOAuth: OA_CONFIGURED ? 'active' : 'no-key',
      kakaoLogin: KA_CONFIGURED ? 'active' : 'no-key',
      calendar: '회원 구글 연결 시 active', sheets: '회원 구글 연결 시 active', drive: '회원 구글 연결 시 active',
      skills: 'active(PDF·엑셀·PPT·문서 생성)',
      gmail: '인증 대기', solapi: '회원 키 저장 시', leads: '준비 중(서버 브라우저 미설치)', listening: '준비 중(검색API)',
    },
  });
});

// ── 🔑 OAuth 로그인 라우트 ──
function loginPage(body) { return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Pretendard,'맑은 고딕',sans-serif;max-width:520px;margin:60px auto;padding:0 18px;color:#1a1f28;text-align:center;">${body}</body>`; }
app.get('/login', (req, res) => {
  const s = sessionOf(req);
  if (s) return res.redirect('/');
  const warnG = OA_CONFIGURED ? '' : '<div style="background:#FBF0DC;color:#8a4d18;padding:10px;border-radius:10px;margin-bottom:10px;font-size:13px;">⚠️ 구글 OAuth 미설정</div>';
  const warnK = KA_CONFIGURED ? '' : '<div style="background:#FBF0DC;color:#8a4d18;padding:10px;border-radius:10px;margin-bottom:10px;font-size:13px;">⚠️ 카카오 미설정 — KAKAO_REST_KEY 필요(대표님 카카오 개발자센터)</div>';
  res.send(loginPage(`${warnG}${warnK}<h1 style="color:#0B1F3A;">지니야빌더</h1><p style="color:#6b7a8d">주문제작 AI 비서 · 내 데이터는 내 것만</p>
    <div style="margin-top:22px;display:flex;flex-direction:column;gap:11px;align-items:center;">
      <a href="/auth/google" style="display:inline-flex;gap:10px;align-items:center;justify-content:center;width:260px;background:#fff;border:1px solid #dadce0;border-radius:10px;padding:13px 20px;color:#3c4043;text-decoration:none;font-size:15px;">🟦 Google로 시작하기</a>
      <a href="/auth/kakao" style="display:inline-flex;gap:10px;align-items:center;justify-content:center;width:260px;background:#FEE500;border:none;border-radius:10px;padding:13px 20px;color:#3a2a00;text-decoration:none;font-size:15px;font-weight:600;">💬 카카오로 시작하기</a>
    </div>
    <p style="color:#98a4b2;font-size:12px;margin-top:16px;line-height:1.6;">카카오는 로그인(신원)까지 — 캘린더·시트·드라이브 등 <b>내 데이터 기능은 [구글 연결]이 필요</b>합니다.</p>
    <p style="margin-top:18px;font-size:12px;"><a href="/privacy" style="color:#98a4b2;">개인정보처리방침</a> · <a href="/terms" style="color:#98a4b2;">이용약관</a></p>`));
});
// ── 📄 개인정보처리방침 · 서비스 이용약관(구글 앱 인증용) — 정적 페이지 ──
app.get(['/privacy', '/privacy.html', '/개인정보처리방침'], (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get(['/terms', '/terms.html', '/이용약관'], (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));

app.get('/auth/google', (req, res) => {
  if (!OA_CONFIGURED) return res.status(503).send('OAuth 미설정');
  // ★로그인은 비민감 스코프(openid·email·profile)만 → 강제 동의(consent)·refresh토큰(offline) 불필요.
  //   계정 선택(select_account)만 → 매번 뜨는 동의 화면 제거. (데이터 연결에서만 consent 유지)
  res.redirect(oaClient().generateAuthUrl({ prompt: 'select_account', scope: LOGIN_SCOPES }));
});
// ★데이터 연결(캘린더·시트·드라이브) — 그 기능 실제로 쓸 때만 별도 동의(incremental). 여기서만 민감 스코프 요청.
// ★작업A2: 도구별 최소권한 스코프(incremental 누적). scope 파라미터 없으면 기존 일괄(하위호환)
const CONNECT_SCOPES = {
  calendar: ['https://www.googleapis.com/auth/calendar.readonly'],
  sheets: ['https://www.googleapis.com/auth/spreadsheets'],
  drive: ['https://www.googleapis.com/auth/drive.file'],
  gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose'],
};
app.get('/auth/google/connect', (req, res) => {
  if (!OA_CONFIGURED) return res.status(503).send('OAuth 미설정');
  const returnTo = String(req.query.returnTo || '5');
  const tool = String(req.query.scope || '');
  const scopes = (tool && CONNECT_SCOPES[tool]) ? LOGIN_SCOPES.concat(CONNECT_SCOPES[tool]) : LOGIN_SCOPES.concat(DATA_SCOPES);
  const state = Buffer.from(JSON.stringify({ connect: true, returnTo: returnTo })).toString('base64');
  console.log('[OAUTH connect] tool =', tool || '(all)', '| redirect_uri =', OA_REDIRECT, '| isLocalDev =', _isLocalDev, '| PORT =', process.env.PORT || '(none)');
  res.redirect(oaClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', include_granted_scopes: true, scope: scopes, state: state }));
});
app.get('/auth/google/callback', async (req, res) => {
  try {
    const code = req.query.code; if (!code) return res.status(400).send('code 없음');
    // ★connect(데이터 스코프)일 때만 state 해석. 로그인(openid/email/profile)은 기존대로.
    let isConnect = false, returnTo = '10';
    if (req.query.state) {
      try { const o = JSON.parse(Buffer.from(String(req.query.state), 'base64').toString()); if (o && o.connect) { isConnect = true; returnTo = o.returnTo || '10'; } }
      catch (e) { if (req.query.state === 'connect') isConnect = true; } // 구버전 호환
    }
    const c = oaClient(); const { tokens } = await c.getToken(code); c.setCredentials(tokens);
    const ui = await google.oauth2({ version: 'v2', auth: c }).userinfo.get();
    const s = crypto.randomBytes(16).toString('hex');
    // ★작업A2: 도구별 incremental 연결 시 이전 스코프 누적(병합) — 새 연결이 기존 연결을 덮지 않게
    const _old = sessionOf(req);
    const _mergedScope = (((_old && _old.scope) || '') + ' ' + (tokens.scope || '')).trim();
    sessions.set(s, { email: ui.data.email, name: ui.data.name, tokens, scope: _mergedScope, provider: 'google' });
    res.setHeader('Set-Cookie', `genya_sid=${s}; HttpOnly; Path=/; SameSite=Lax${process.env.RENDER ? '; Secure' : ''}`);
    res.redirect(isConnect ? ('/?connected=1&screen=' + encodeURIComponent(returnTo)) : '/'); // 데이터 연결이면 원래 화면으로 복귀
  } catch (e) { res.status(500).send('로그인 오류: ' + e.message); }
});
app.get('/logout', (req, res) => { const s = sidOf(req); if (s) sessions.delete(s); res.setHeader('Set-Cookie', 'genya_sid=; Path=/; Max-Age=0'); res.redirect('/login'); });
app.get('/me', (req, res) => { const s = sessionOf(req); res.json(s ? { ok: true, email: s.email, name: s.name, provider: s.provider, hasGoogleData: !!s.tokens, hasData: hasDataScope(req), scopes: (s.scope || (s.tokens && s.tokens.scope) || '') } : { ok: false }); });

// ── 💬 카카오 로그인 라우트 (구글과 동일 구조: authorize → callback) ──
app.get('/auth/kakao', (req, res) => {
  if (!KA_CONFIGURED) return res.status(503).send('카카오 미설정 — KAKAO_REST_KEY 필요');
  const url = `https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(KA_KEY)}&redirect_uri=${encodeURIComponent(KA_REDIRECT)}&scope=account_email,profile_nickname`;
  res.redirect(url);
});
app.get('/auth/kakao/callback', async (req, res) => {
  try {
    const code = req.query.code; if (!code) return res.status(400).send('code 없음');
    // 1) 토큰 교환 (form-urlencoded)
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: KA_KEY, redirect_uri: KA_REDIRECT, code });
    const tr = await fetch('https://kauth.kakao.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const tok = await tr.json();
    if (!tok.access_token) return res.status(500).send('카카오 토큰 실패: ' + JSON.stringify(tok));
    // 2) 사용자 정보(신원)
    const ur = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: 'Bearer ' + tok.access_token } });
    const u = await ur.json();
    const email = (u.kakao_account && u.kakao_account.email) || `kakao_${u.id}`;
    const name = (u.properties && u.properties.nickname) || '카카오 회원';
    // 3) 세션 (★구글 토큰 없음 → 데이터 기능은 구글 연결 필요). 토큰만 메모리·회원 격리·저장0
    const s = crypto.randomBytes(16).toString('hex');
    sessions.set(s, { email, name, provider: 'kakao' }); // s.tokens(구글) 없음
    res.setHeader('Set-Cookie', `genya_sid=${s}; HttpOnly; Path=/; SameSite=Lax${process.env.RENDER ? '; Secure' : ''}`);
    res.redirect('/');
  } catch (e) { res.status(500).send('카카오 로그인 오류: ' + e.message); }
});

// 화면(no-store) — ★로그인 게이트: 미로그인 시 /login
// /main = 홈 대시보드(코치 디자인·실데이터 배선), /work = 작업공간(3대 창고·능력·대화)
app.get('/main', (req, res) => {
  if (!sessionOf(req)) return res.redirect('/login');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.redirect('/'); // ★옛날 홈 축소판 제거 → v4(genya.html)로 통일
});
app.get('/work', (req, res) => {
  if (!sessionOf(req)) return res.redirect('/login');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.redirect('/'); // ★옛날 작업공간 축소판 제거 → v4(genya.html)로 통일
});
// ★기본 URL / → v4 통합 페이지(genya.html). 로그인 화면0부터. "Not Found" 없음.
// ★기본 URL / → v4 통합 페이지(genya.html) + OG 태그 주입(카톡 썸네일). genya.html 파일은 무수정, 서버가 <head>에 끼워 서빙.
// ★카톡 인앱 브라우저 탈출: 카톡으로 링크를 열면 구글 로그인이 403(disallowed_useragent)로 막힘.
//   → 페이지 뜨자마자(다른 JS·로그인 로직보다 먼저) 카톡 브라우저를 감지해 안드=크롬, iOS=사파리로 다시 연다.
//   OG 태그와 동일하게 genya.html은 무수정, 서버가 <head> 최상단에 끼워 서빙.
const KAKAO_ESCAPE = `<script>
(function(){
  var ua = navigator.userAgent || '';
  if (ua.match(/KAKAOTALK/i)) {
    if (ua.match(/Android/i)) {
      location.href = 'intent://' + location.href.replace(/https?:\\/\\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
    } else if (ua.match(/iPhone|iPad|iPod/i)) {
      location.href = location.href + (location.href.indexOf('?') > -1 ? '&' : '?') + 'openExternalBrowser=1';
    }
  }
})();
</script>`;
const OG_TAGS = [
  '<meta property="og:type" content="website">',
  '<meta property="og:url" content="https://genya-builder.onrender.com">',
  '<meta property="og:title" content="당신의 사업을 더 걱정하는 1인사업자를 위한 AI 비서">',
  '<meta property="og:description" content="사람이 해야 하는 일을 제외한 나머지 모든 일은 AI가 합니다 · 오상열 CFP 오원트금융연구소">',
  '<meta property="og:image" content="https://firebasestorage.googleapis.com/v0/b/moneya-72fe6.firebasestorage.app/o/%EC%A7%80%EB%8B%88%EC%95%BC%EB%B9%8C%EB%8D%94_%EC%B9%B4%ED%86%A1_OG_final.png?alt=media&token=1df332a4-56ee-46c0-b174-a3453d98324e">',
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta name="twitter:card" content="summary_large_image">'
].join('\n');
app.get('/', (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'genya.html'), 'utf8');
  // ★인증 게이트: 서버가 실제 세션 여부를 권위있게 주입(클라 라우팅 레이스 제거). 로그인 안 됐으면 클라가 로그인화면만 보이게 강제.
  const authed = !!sessionOf(req);
  html = html.replace('<head>', '<head>\n' + KAKAO_ESCAPE + '\n<script>window.__AUTHED=' + (authed ? 'true' : 'false') + ';</script>'); // ★카톡 탈출 + 인증상태 주입(<head> 최상단, 다른 JS보다 먼저)
  html = html.replace('</head>', OG_TAGS + '\n</head>');
  res.setHeader('Cache-Control', 'no-store');
  res.send(html);
});

app.listen(PORT, () => console.log(`[공통 메인+로그인] http://localhost:${PORT}/login (OAuth ${OA_CONFIGURED ? 'ON' : 'OFF'}, 약관 ${YAK.pageCount}p) — 회원토큰 우선·SA 폴백`));
