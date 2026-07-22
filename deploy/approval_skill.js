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

// 로컬 실측 안전: 설정 시 모든 발송을 회장님 본인 대상으로만(실고객 보호). 프로덕션은 미설정 → 실대상.
function _testTo() { return String(process.env.APPROVAL_TEST_TO || '').trim(); }
function _testEmail() { return String(process.env.APPROVAL_TEST_EMAIL || '').trim(); }

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
function _genId() { return 'a-' + new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now() % 100000).padStart(5, '0'); }

// ═══ 1·2. 결재 생성 (지니야가 올림) ═══
//   input: { 요청내용, 채널('sms'|'gmail'), criteria:{컬럼:값}, 템플릿, 대상요약? }
async function create(ma, input) {
  input = input || {};
  const 채널 = input.채널 === 'gmail' ? 'gmail' : 'sms';
  const criteria = input.criteria || {};
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
    o.승인상태 = '거부'; o.수정일시 = _now(); await _updateRow(sheets, sid, o);
    return { ok: true, approval: _publicView(o), message: '거부 처리했어요. 발송하지 않습니다.' };
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
    // 실제 발송(로컬은 APPROVAL_TEST_TO로만)
    const result = await _dispatch(ma, o, targets, contactCol);
    o.승인상태 = result.fail === 0 ? '완료' : (result.ok === 0 ? '실패' : '부분실패');
    o.결과 = `${result.ok}/${targets.length} 성공${result.fail ? ` · 실패 ${result.fail}` : ''}${_testTo() || _testEmail() ? ' (테스트발송)' : ''}`;
    o.수정일시 = _now(); await _updateRow(sheets, sid, o);
    return { ok: true, approval: _publicView(o), result, message: `발송 완료. ${o.결과}` };
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
// ── 실제 발송(채널별). 로컬 안전 오버라이드. 가짜성공 없음(sent 확인). ──
async function _dispatch(ma, o, targets, contactCol) {
  const header = Object.keys(targets[0] || {});
  let ok = 0, fail = 0; const errors = [];
  for (const row of targets) {
    const text = _render(o.템플릿, row, header);
    let to = contactCol ? String(row[contactCol]).trim() : '';
    try {
      let r;
      if (o.채널 === 'gmail') {
        if (_testEmail()) to = _testEmail(); // 로컬 안전
        r = await _sendGmail(ma, to, o.요청내용 || '안내', (_testTo() || _testEmail() ? '[테스트] ' : '') + text);
      } else {
        if (_testTo()) to = _testTo();        // 로컬 안전
        r = await _sendSms(ma, to, (_testTo() || _testEmail() ? '[테스트] ' : '') + text);
      }
      if (r && r.sent) ok++; else { fail++; if (r && r.error) errors.push(r.error); }
    } catch (e) { fail++; errors.push(e.message); }
  }
  return { ok, fail, errors: errors.slice(0, 3) };
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

module.exports = { init, create, list, act, plan, APPROVAL_TAB, HEADER };
