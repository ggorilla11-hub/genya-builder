// ─────────────────────────────────────────────────────────────
// approval_skill.js — 🗂️ Step 2-C · 결재함 백엔드 (독립 모듈)
// 무엇을·왜: 지니야가 "12명 갱신 안내 보낼까요?"를 결재함에 올리고 → 회장님 웹앱 승인 →
//   지니야가 실제 발송(SMS/Gmail)하고 결과를 기록. 명세서 Ch 3-C · 시나리오 6·7.
//
// ★설계 결재(A/B/A):
//   - 저장위치 A) 회원 본인 구글시트 `결재함` 탭 (서버 저장 0 · 원칙1)
//   - 페이로드 B) 기준(필터)+템플릿만 저장, 승인 시 명단 재조회 (개인정보 최소 · 8-2 · 항상 최신)
//   - 발송채널 A) SMS(솔라피)+Gmail 지금 실동작. 알림톡은 Step 2-D에서 매핑.
//
// ★무접촉: 하이브리드 라우터(Step 2-1)·엄마2 파일 무접촉. main_server는 require+init+엔드포인트 추가만.
// ★재사용: 회원시트(findOrCreateMemberSheet)·발송(SMS/Gmail)은 main_server가 init으로 주입.
//          명단 조회·컬럼 동의어는 sheets_crud_skill(Step 2-B) 재사용.
// ★대량 안전: 10건+ 승인은 이중확인(confirmed). ★로컬 안전: APPROVAL_TEST_TO 설정 시 모든 발송을 그 번호로만.
//
// 사용: const approval = require('./approval_skill');
//        approval.init({ anthropic, model, getMemberSheet, ensureTab, sendSms, sendGmail });
//        create/list/act/plan
// ─────────────────────────────────────────────────────────────
'use strict';
const crud = require('./sheets_crud_skill'); // 명단 loadTable + resolveColumn 재사용(Step 2-B)

let _anthropic = null, _MODEL = 'claude-opus-4-8';
let _getMemberSheet = null; // (ma) => {id, sheets}
let _ensureTab = null;      // (sheets, id, title) => void
let _sendSms = null;        // (ma, to, text) => {ok, sent, error}
let _sendGmail = null;      // (ma, to, subject, text) => {ok, sent, error}

const APPROVAL_TAB = '결재함';
const HEADER = ['id', '생성일시', '요청내용', '채널', '대상수', '승인상태', '결과', '기준JSON', '템플릿', '수정일시'];
const BULK = 10; // 대량 이중확인 기준

function init(opts) {
  opts = opts || {};
  if (opts.anthropic) _anthropic = opts.anthropic;
  if (opts.model) _MODEL = opts.model;
  if (opts.getMemberSheet) _getMemberSheet = opts.getMemberSheet;
  if (opts.ensureTab) _ensureTab = opts.ensureTab;
  if (opts.sendSms) _sendSms = opts.sendSms;
  if (opts.sendGmail) _sendGmail = opts.sendGmail;
}

// ═══ 🔒 발송 안전 하드가드 (실고객 오발송 원천차단) ═══
// 원칙: 라이브 발송을 명시적으로 켜지(APPROVAL_LIVE_SEND=1) 않는 한, 모든 발송을
//       "안전 화이트리스트"로 강제 리다이렉트한다. 화이트리스트 env를 빠뜨려도
//       폴백(회장님 본인)으로만 나가 실고객에게는 절대 발송되지 않는다.
const SAFE_FALLBACK_EMAIL = 'ggorilla11@gmail.com'; // 회장님 본인(오상열)
const SAFE_FALLBACK_PHONE = '010-5424-5332';        // 회장님 본인(오상열)
function _liveSend() { return String(process.env.APPROVAL_LIVE_SEND || '') === '1'; }
function _normPhone(p) { return String(p || '').replace(/[^0-9]/g, ''); }
function _emailWhitelist() {
  const raw = String(process.env.SAFE_EMAIL_WHITELIST || process.env.APPROVAL_TEST_EMAIL || '').trim();
  const list = raw ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
  return list.length ? list : [SAFE_FALLBACK_EMAIL.toLowerCase()];
}
function _phoneWhitelist() {
  const raw = String(process.env.SAFE_PHONE_WHITELIST || process.env.APPROVAL_TEST_TO || '').trim();
  const list = raw ? raw.split(',').map((s) => _normPhone(s)).filter(Boolean) : [];
  return list.length ? list : [_normPhone(SAFE_FALLBACK_PHONE)];
}
function _mask(s) { s = String(s || ''); return s.length <= 4 ? '***' : s.slice(0, 2) + '***' + s.slice(-2); }
// 발송 직전 수신자 안전 판정. 라이브 아니면 화이트리스트로 강제. 반환 {to, blocked, test, safeMode}
function safeRecipient(channel, to) {
  const live = _liveSend();
  if (channel === 'gmail') {
    const wl = _emailWhitelist(); const orig = String(to || '').trim().toLowerCase();
    if (live) return { to, blocked: false, test: false, safeMode: false };
    if (orig && wl.includes(orig)) return { to, blocked: false, test: true, safeMode: true };
    return { to: wl[0], blocked: true, test: true, safeMode: true };
  }
  const wl = _phoneWhitelist(); const orig = _normPhone(to);
  if (live) return { to, blocked: false, test: false, safeMode: false };
  if (orig && wl.includes(orig)) return { to, blocked: false, test: true, safeMode: true };
  return { to: wl[0], blocked: true, test: true, safeMode: true };
}

// ── 결재함 탭 로드(없으면 헤더 생성). 회원 본인 시트에만. ──
async function _load(ma) {
  const { id, sheets } = await _getMemberSheet(ma);
  await _ensureTab(sheets, id, APPROVAL_TAB);
  const got = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${APPROVAL_TAB}!A1:J1000` });
  let values = got.data.values || [];
  if (!values.length || !(values[0] || []).length) {
    await sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${APPROVAL_TAB}!A1`, valueInputOption: 'RAW', requestBody: { values: [HEADER] } });
    values = [HEADER];
  }
  return { id, sheets, values };
}
function _obj(row, rowNum) { const o = { _rowNum: rowNum }; HEADER.forEach((h, i) => o[h] = (row && row[i]) || ''); return o; }
function _rowArr(o) { return HEADER.map((h) => o[h] != null ? String(o[h]) : ''); }
function _now() { return new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 16); } // KST 분 단위
let _idSeq = 0; // 같은 밀리초 다건 생성 시 ID 충돌 방지(모듈 카운터)
function _genId() { _idSeq = (_idSeq + 1) % 100000; return 'a-' + new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now() % 100000).padStart(5, '0') + '-' + String(_idSeq).padStart(3, '0'); }

// ═══ 1·2. 결재 생성 (지니야가 올림) ═══
//   input: { 요청내용, 채널('sms'|'gmail'), criteria:{컬럼:값}, 템플릿, 대상요약? }
async function create(ma, input) {
  input = input || {};
  const criteria = input.criteria || {};
  // ★5단계: 채널 기본=메일(gmail) 우선. 미지정이면 대상 이메일이 명단에 있으면 gmail, 없으면 sms.
  let 채널 = input.채널 === 'gmail' ? 'gmail' : (input.채널 === 'sms' ? 'sms' : '');
  if (!채널) { 채널 = 'gmail'; try { const tg = await _resolveTargets(ma, criteria, 'gmail'); if (!tg.contactCol || !tg.targets.length) 채널 = 'sms'; } catch (e) {} }
  const 템플릿 = String(input.템플릿 || '').trim();
  const 요청내용 = String(input.요청내용 || '').trim() || '(내용 없음)';
  if (!템플릿) return { ok: false, message: '보낼 메시지 템플릿이 비어 있어요.' };
  // 대상수 미리 계산(재조회·개인정보 저장 안 함 — 숫자만)
  let 대상수 = 0;
  try { const t = await _resolveTargets(ma, criteria, 채널); 대상수 = t.targets.length; } catch (e) {}
  const { id, sheets, values } = await _load(ma);
  const o = { id: _genId(), 생성일시: _now(), 요청내용, 채널, 대상수: String(대상수), 승인상태: '대기', 결과: '-', 기준JSON: JSON.stringify(criteria), 템플릿, 수정일시: '' };
  await sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${APPROVAL_TAB}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [_rowArr(o)] } });
  return { ok: true, approval: _publicView(o), message: `결재함에 올렸어요. ${요청내용} (대상 ${대상수}명, 채널 ${채널}). 승인해 주세요.` };
}

// 민감필드(기준JSON)는 UI로 그대로 안 내보내고 요약만. 템플릿·상태는 노출(회장님 본인 것).
function _publicView(o) {
  return { id: o.id, 생성일시: o.생성일시, 요청내용: o.요청내용, 채널: o.채널, 대상수: Number(o.대상수) || 0, 승인상태: o.승인상태, 결과: o.결과, 템플릿: o.템플릿, 수정일시: o.수정일시 };
}

// ═══ 3. 결재함 조회 (엄마1 UI가 부름) ═══
//   응답 계약(표준안): { ok, count, 대기, items:[_publicView...] } — 최신순.
async function list(ma, opts) {
  opts = opts || {};
  const { values } = await _load(ma);
  const items = [];
  for (let i = 1; i < values.length; i++) { const r = values[i]; if (!r || !r[0]) continue; items.push(_publicView(_obj(r, i + 1))); }
  items.reverse(); // 최신순
  const filtered = opts.status ? items.filter((x) => x.승인상태 === opts.status) : items;
  return { ok: true, count: filtered.length, 대기: items.filter((x) => x.승인상태 === '대기').length, items: filtered };
}

async function _find(ma, id) {
  const { id: sid, sheets, values } = await _load(ma);
  for (let i = 1; i < values.length; i++) { if (values[i] && values[i][0] === id) return { sid, sheets, o: _obj(values[i], i + 1) }; }
  return { sid, sheets, o: null };
}
async function _updateRow(sheets, sid, o) {
  await sheets.spreadsheets.values.update({ spreadsheetId: sid, range: `${APPROVAL_TAB}!A${o._rowNum}:J${o._rowNum}`, valueInputOption: 'RAW', requestBody: { values: [_rowArr(o)] } });
}

// ═══ 4·5·6. 승인/거부/수정 (+승인 시 실제 발송·결과 기록) ═══
async function act(ma, input) {
  input = input || {};
  const id = String(input.id || '');
  const action = String(input.action || '');
  const { sid, sheets, o } = await _find(ma, id);
  if (!o) return { ok: false, message: '그 결재 건을 못 찾았어요.' };
  if (o.승인상태 !== '대기') return { ok: false, message: `이미 처리된 건이에요(현재: ${o.승인상태}).` };

  if (action === 'reject') {
    const reason = String(input.reason || '').trim();
    o.승인상태 = '거부'; o.결과 = reason ? ('사유: ' + reason) : '거부'; o.수정일시 = _now(); await _updateRow(sheets, sid, o);
    return { ok: true, approval: _publicView(o), message: '반려했어요. 발송하지 않습니다.' + (reason ? ' (사유: ' + reason + ')' : '') };
  }
  if (action === 'edit') {
    const e = input.edits || {};
    if (e.요청내용 != null) o.요청내용 = String(e.요청내용);
    if (e.템플릿 != null) o.템플릿 = String(e.템플릿);
    if (e.criteria != null) { o.기준JSON = JSON.stringify(e.criteria); try { const t = await _resolveTargets(ma, e.criteria, o.채널); o.대상수 = String(t.targets.length); } catch (x) {} }
    o.수정일시 = _now(); await _updateRow(sheets, sid, o);
    return { ok: true, approval: _publicView(o), message: '수정했어요. 여전히 승인 대기 상태예요.' };
  }
  if (action === 'approve') {
    const criteria = (() => { try { return JSON.parse(o.기준JSON || '{}'); } catch (e) { return {}; } })();
    const { targets, contactCol } = await _resolveTargets(ma, criteria, o.채널);
    if (!targets.length) { o.승인상태 = '완료'; o.결과 = '대상 0명(발송 없음)'; o.수정일시 = _now(); await _updateRow(sheets, sid, o); return { ok: true, approval: _publicView(o), message: '지금 조건에 맞는 대상이 없어 발송하지 않았어요.' }; }
    // 대량 이중확인
    if (targets.length >= BULK && !input.confirmed) {
      return { ok: false, needsBulkConfirm: true, count: targets.length, message: `${targets.length}명에게 발송합니다. 실수 방지를 위해 한 번 더 확인해 주세요.` };
    }
    // 실제 발송(🔒 하드가드: 라이브 아니면 화이트리스트=회장님 본인으로만)
    const result = await _dispatch(ma, o, targets, contactCol);
    // ★4단계: 전부 실패면 승인 대기 유지(재시도 가능) + 원인 안내. 상태(승인상태) 안 바꿈.
    if (result.ok === 0 && result.fail > 0) {
      o.결과 = `발송 실패(${result.fail}건)${result.errors && result.errors.length ? ' · ' + result.errors[0] : ''}`;
      o.수정일시 = _now(); await _updateRow(sheets, sid, o); // 승인상태='대기' 그대로
      return { ok: false, approval: _publicView(o), result, message: `발송 실패 — 승인 대기에 그대로 뒀어요. 원인: ${(result.errors && result.errors[0]) || '알 수 없음'}. 확인 후 다시 승인해 주세요.` };
    }
    const 채널명 = o.채널 === 'gmail' ? '메일' : '문자';
    o.승인상태 = result.fail === 0 ? '완료' : '부분실패';
    o.결과 = `${채널명} 발송 완료 ${result.ok}/${targets.length}${result.fail ? ` · 실패 ${result.fail}` : ''}${result.safeMode ? ` · 🔒안전모드(회장님 본인에게만)` : ''}`;
    o.수정일시 = _now(); await _updateRow(sheets, sid, o);
    const safeMsg = result.safeMode ? ` 🔒 안전 모드 — 실제 ${채널명}은 회장님 본인에게만 갔어요(실고객 ${result.blocked}명 보호 차단).` : '';
    return { ok: true, approval: _publicView(o), result, message: `${o.결과}.${safeMsg}` };
  }
  return { ok: false, message: '알 수 없는 동작이에요(approve/reject/edit).' };
}

// ── 명단 재조회: criteria로 필터(동의어 컬럼 지원). 채널별 연락처 컬럼 확인. ──
async function _resolveTargets(ma, criteria, 채널) {
  const table = await crud.loadTable(ma); // Step 2-B 재사용
  const contactCol = 채널 === 'gmail' ? crud.resolveColumn('이메일', table.header) : crud.resolveColumn('연락처', table.header);
  let rows = table.rows;
  Object.entries(criteria || {}).forEach(([k, v]) => {
    const col = crud.resolveColumn(k, table.header); if (!col) return;
    const val = String(v);
    rows = rows.filter((r) => String(r[col]).includes(val));
  });
  const targets = rows.filter((r) => !contactCol || String(r[contactCol]).trim()); // 연락처 있는 대상만
  return { targets, contactCol, header: table.header };
}
// ── #{컬럼} 치환(동의어 지원) ──
function _render(tpl, row, header) {
  return String(tpl).replace(/#\{([^}]+)\}/g, (m, name) => { const col = crud.resolveColumn(name.trim(), header); return col && row[col] != null ? String(row[col]) : m; });
}
// ── 실제 발송(채널별). 🔒 하드가드: 라이브 아니면 화이트리스트(회장님)로 강제. 가짜성공 없음(sent 확인). ──
async function _dispatch(ma, o, targets, contactCol) {
  const header = Object.keys(targets[0] || {});
  let ok = 0, fail = 0, blocked = 0, safeMode = false; const errors = [];
  const nameCol = crud.resolveColumn('고객명', header) || crud.resolveColumn('이름', header);
  for (const row of targets) {
    const text = _render(o.템플릿, row, header);
    const rawTo = contactCol ? String(row[contactCol]).trim() : '';
    const who = (nameCol && row[nameCol]) ? String(row[nameCol]) : '';
    const safe = safeRecipient(o.채널, rawTo);
    if (safe.safeMode) safeMode = true;
    if (safe.blocked) { blocked++; console.log(`[🔒안전차단] 실고객 ${o.채널} 발송 차단됨: ${_mask(rawTo)} → 회장님 본인(${_mask(safe.to)})으로 대체`); }
    const isG = o.채널 === 'gmail';
    // ★3단계 안전모드 표시: 메일=본문 상단에 실제 수신자 명시, 문자=[테스트] 접두. 제목엔 [테스트].
    const testHead = (safe.test && isG) ? ('실제 수신자: ' + (who ? who + ' ' : '') + '(' + (rawTo || '연락처 없음') + ')\n\n') : '';
    const smsPrefix = (safe.test && !isG) ? '[테스트] ' : '';
    const body = testHead + smsPrefix + text;
    const subject = (safe.test ? '[테스트] ' : '') + (o.요청내용 || '안내');
    try {
      let r;
      if (isG) r = await _sendGmail(ma, safe.to, subject, body);
      else r = await _sendSms(ma, safe.to, body);
      if (r && r.sent) ok++; else { fail++; if (r && r.error) errors.push(r.error); }
    } catch (e) { fail++; errors.push(e.message); }
  }
  return { ok, fail, blocked, safeMode, errors: errors.slice(0, 3) };
}

// ═══ (편의) 자연어 → 결재 초안 (지니야 자동 생성 보조) ═══
//   text → {요청내용, 채널, criteria, 템플릿, 대상요약} JSON. 저장 안 함(초안). 실패해도 대화 안 끊김.
async function plan(ma, text) {
  if (!_anthropic) return { ok: false, message: '엔진 미초기화' };
  let header = [];
  try { const t = await crud.loadTable(ma); header = t.header; } catch (e) {}
  const sys = `너는 결재함 보조다. 대표의 요청을 아래 JSON으로만 변환한다(설명 금지, 순수 JSON).
{"요청내용":"짧은 제목","채널":"sms 또는 gmail","criteria":{"컬럼명":"포함값"},"템플릿":"#{고객명}님 ... 안내 문자. 존댓말·짧게"}
- 시트 컬럼 후보: ${header.join(', ') || '고객명, 연락처, 만기일, 보험사, 가입상품'}
- criteria는 명단을 거르는 조건(예: {"만기일":"2026-08"}). 없으면 {}.
- 템플릿엔 #{고객명} 같은 시트 컬럼 치환자를 쓴다. 광고·과장 금지, 정보성만.`;
  try {
    const r = await _anthropic.messages.create({ model: _MODEL, max_tokens: 600, system: sys, messages: [{ role: 'user', content: String(text || '') }] });
    const raw = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    let 대상수 = 0; try { const t = await _resolveTargets(ma, j.criteria || {}, j.채널 === 'gmail' ? 'gmail' : 'sms'); 대상수 = t.targets.length; } catch (e) {}
    return { ok: true, draft: { 요청내용: j.요청내용 || '안내', 채널: j.채널 === 'gmail' ? 'gmail' : 'sms', criteria: j.criteria || {}, 템플릿: j.템플릿 || '', 대상수 } };
  } catch (e) { return { ok: false, message: '무엇을 누구에게 보낼지 조금 더 구체적으로 말씀해 주세요.', error: e.message }; }
}

// ═══ 7. Function Calling · 지니야 대화에 노출되는 결재/발송 도구 3개 ═══
//   ★회장님 지적 수정: 지니야가 "발송 못 한다"고 답하던 근본원인 = 대화에 발송 도구가 없었음.
//   이 도구 루프를 orderHandler가 호출 → 지니야가 실제로 결재함 저장·조회·발송(승인 후)을 수행.
// ★Anthropic API 규칙: input_schema properties 키는 ^[a-zA-Z0-9_.-]{1,64}$ (한글 불가) → 영문 키 사용, 내부에서 한글 필드로 매핑
const TOOLS = [
  { name: 'create_approval', description: '회장님이 문자·이메일 발송을 지시하면, 실제로 보내기 전에 발송 초안을 "결재함"에 저장한다. 대상은 고객명단(구글시트)에서 조건으로 자동 조회된다. 저장 후 회장님이 승인하면 실제 발송된다. 예: "김철수님에게 신상품 안내 메일 보내줘" → criteria:{"고객명":"김철수"}, channel:"gmail". ★당신은 실제로 발송할 수 있으니 절대 "직접 못 보낸다"고 답하지 말 것.',
    input_schema: { type: 'object', properties: { title: { type: 'string', description: '짧은 제목(예: 신상품 안내)' }, channel: { type: 'string', enum: ['sms', 'gmail'], description: '문자면 sms, 이메일이면 gmail. ★미지정 시 메일(gmail) 우선 — 고객 이메일이 명단에 있으면 gmail, 없으면 sms로 자동 결정된다. 회장님이 "문자로"라고 명시할 때만 sms.' }, criteria: { type: 'object', description: '대상 조건(예: {"고객명":"김철수"} 또는 {"만기일":"2026-08"}). 전체면 {}' }, template: { type: 'string', description: '보낼 문구. #{고객명} 같은 시트 컬럼 치환자 사용. 정보성·존댓말·짧게' } }, required: ['template'] } },
  { name: 'list_approvals', description: '결재함에 올라온 발송 건들을 조회한다(대기/완료 등). "결재함 보여줘", "뭐 올라와 있어?" 등에 사용.',
    input_schema: { type: 'object', properties: { status: { type: 'string', description: '대기/완료/거부 중 하나로 필터. 생략시 전체' } } } },
  { name: 'approve_and_send', description: '회장님이 특정 결재 건을 "승인"·"보내"라고 명시적으로 지시할 때만 실제 발송한다. 지니야가 스스로 승인하지 않는다. id는 list_approvals로 확인.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, confirmed: { type: 'boolean', description: '10건 이상 대량 발송 재확인 시 true' } }, required: ['id'] } },
];
function systemPrompt() {
  return `당신은 "지니야" — 회장님의 문자·이메일 발송을 결재함으로 처리하는 비서입니다.
[핵심 능력 — 절대 "못 한다"고 말하지 마세요]
당신은 실제로 발송할 수 있습니다. 방식: 결재함에 저장(create_approval) → 회장님 승인 → 실제 발송(approve_and_send).
[규칙]
1. "○○에게 ○○ 보내줘"라고 하면 create_approval로 결재함에 올리고 "결재함에 올렸어요. 승인하시면 보내드릴게요"라고 안내한다. 절대 "직접 발송은 못 한다"고 하지 않는다.
2. 대상·문구가 애매하면 한두 가지만 되묻는다. 문구는 정보성·존댓말·짧게 자동 작성. 채널은 메일(gmail)을 기본으로 한다 — 고객 이메일이 명단에 있으면 gmail, 없으면 sms. 회장님이 "문자로"라고 명시할 때만 sms.
3. 스스로 승인·발송하지 않는다. 회장님이 "승인"·"보내"라고 명시할 때만 approve_and_send.
4. 실측 안전모드에서는 실제로 회장님 본인에게만 발송된다(실고객 보호). 이 점을 정직히 안내한다.
5. 말투: 따뜻하고 쉽게. '클로드'·'AI' 같은 말은 쓰지 않는다.`;
}
// ═══ 명단 주입(큰불 수정) ═══ 질의 속 고객을 실제 시트에서 찾아 컨텍스트로 주입.
//   loadTable(null)=서비스계정 읽기(회원 OAuth·데이터스코프 없어도 동작). 실패해도 '' 반환(대화 안 끊김).
async function _rosterContext(userText) {
  try {
    const table = await crud.loadTable(null); // 🔑 SA 읽기(회원 로그인 무관)
    if (!table || !Array.isArray(table.rows) || !table.rows.length) return '';
    const header = table.header || [];
    // 질의에서 한글 이름 후보 추출(2~4자, '님' 허용)
    const names = []; const re = /([가-힣]{2,4})\s*님?/g; let m;
    while ((m = re.exec(String(userText || ''))) !== null) { if (!names.includes(m[1])) names.push(m[1]); }
    if (!names.length) return '';
    const seen = new Set(); const blocks = [];
    for (const nm of names) {
      const rows = crud.findByName(table, nm); if (!rows.length) continue; // 전체 컬럼 검색
      for (const row of rows.slice(0, 3)) {
        if (seen.has(row._rowNum)) continue; seen.add(row._rowNum);
        const kv = header.filter((h) => h && String(row[h] || '').trim()).map((h) => `${h}: ${row[h]}`).join(', ');
        if (kv) blocks.push('· ' + kv);
      }
    }
    if (!blocks.length) return '\n[명단 조회] 질의에 언급된 고객(' + names.join(', ') + ')을 시트에서 못 찾았어요. 값을 지어내지 말고 "명단에서 그 고객을 못 찾았어요"라고 안내한다.';
    return '\n[명단 조회 결과 — 실제 시트 데이터(서비스계정)] 아래는 회원 고객명단 시트에서 찾은 해당 고객의 실제 값이다. 안내문·문자·메일을 쓸 때 이 실제 값(만기일·상품·보험사·연락처 등)을 그대로 반영하고 없는 값은 지어내지 마라. create_approval의 criteria는 이 고객을 정확히 지정하고(예: {"고객명":"홍길동"}), template엔 실제 만기일·상품을 담아 구체적으로 쓴다.\n' + blocks.join('\n');
  } catch (e) { return ''; }
}
// 지니야 대화 루프(자체 도구호출 · 하이브리드 라우터 무접촉). create=저장(발송X), approve_and_send만 실제 발송(하드가드).
async function runChat(ma, messages) {
  if (!_anthropic) return { ok: false, reply: '엔진이 초기화되지 않았어요.' };
  const conv = (messages || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || m.text || '') })).filter((m) => m.content);
  if (!conv.length) return { ok: true, reply: '무엇을 보내드릴까요?' };
  // ★큰불수정: Claude 호출 전에 명단(SA)에서 질의 속 고객의 실제 데이터를 읽어 시스템 프롬프트에 주입.
  //   → 안내문에 실제 만기일·상품 반영. 연락처는 승인 발송 시 criteria 재조회로 자동 사용(_dispatch·PII 미저장).
  let sysBase = systemPrompt();
  try { const last = (messages || []).slice().reverse().find((x) => (x.role || 'user') !== 'assistant'); const rctx = await _rosterContext((last && (last.content || last.text)) || ''); if (rctx) sysBase += rctx; } catch (e) {}
  const trace = []; let pending = null;
  for (let hop = 0; hop < 5; hop++) {
    let r;
    try { r = await _anthropic.messages.create({ model: _MODEL, max_tokens: 1200, system: sysBase, tools: TOOLS, messages: conv }); }
    catch (e) { return { ok: false, reply: '지금 잠깐 응답이 어려워요. 잠시 후 다시 말씀해 주세요.', error: e.message }; }
    const toolUses = (r.content || []).filter((b) => b.type === 'tool_use');
    const textOut = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!toolUses.length) return { ok: true, reply: textOut || '네, 말씀하세요.', pending, trace };
    conv.push({ role: 'assistant', content: r.content });
    const results = [];
    for (const t of toolUses) {
      let out;
      try {
        if (t.name === 'create_approval') { const i = t.input || {}; out = await create(ma, { 요청내용: i.title, 채널: i.channel, criteria: i.criteria, 템플릿: i.template }); if (out.ok) { pending = out.approval; trace.push({ tool: 'create_approval', id: out.approval && out.approval.id }); } }
        else if (t.name === 'list_approvals') { out = await list(ma, { status: (t.input && t.input.status) || '' }); }
        else if (t.name === 'approve_and_send') { out = await act(ma, { id: (t.input && t.input.id) || '', action: 'approve', confirmed: !!(t.input && t.input.confirmed) }); trace.push({ tool: 'approve_and_send', id: t.input && t.input.id }); }
        else out = { ok: false, message: '알 수 없는 도구' };
      } catch (e) { out = { ok: false, message: e.message }; }
      results.push({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(out).slice(0, 3000) });
    }
    conv.push({ role: 'user', content: results });
  }
  return { ok: true, reply: '요청이 조금 복잡해요. 한 가지씩 다시 말씀해 주시겠어요?', pending, trace };
}

module.exports = { init, create, list, act, plan, runChat, TOOLS, APPROVAL_TAB, HEADER, safeRecipient };
