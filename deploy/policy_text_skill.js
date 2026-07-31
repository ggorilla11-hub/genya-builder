// ─────────────────────────────────────────────────────────────
// policy_text_skill.js — 📄 증권 "텍스트" 해석 (1단계 · 독립 모듈 · 2026-07-31 대표님 승인)
//
// 무엇을·왜:
//   설계사가 증권 내용을 ★글자로 붙여넣으면 지니야가 읽고 이해한다.
//   (사진·PDF는 다음 단계 — 이번엔 텍스트만. 사진 경로는 기존 policy_analysis_skill.js 가 따로 담당한다)
//
// ★성배(대표님): 증권 ★형식이 달라도 이해해야 한다.
//   그래서 낱말표·정규식으로 칸을 파내지 않는다. ★두뇌가 읽고, 구조화된 칸으로 돌려주게 한다.
//   회사마다·상품마다 증권 생김새가 다르므로 하드코딩은 반드시 언젠가 깨진다.
//
// ★환각 금지(절대원칙 6):
//   - 증권에 없는 값은 ★빈칸으로 둔다. 추측해서 채우지 않는다.
//   - 못 읽은 항목은 "증권에 안 적혀 있어요"라고 말한다.
//   - 요약·조언은 ★추출된 값에서만 나온다.
//
// ★제로 인그레스(절대원칙 4):
//   증권 글자는 이 요청을 처리하는 동안 메모리에만 있다가 버린다. 서버 저장·캐시 0.
//   명단에 반영하는 것은 ★대표 지시가 있을 때 기존 명단 도구(sheets_crud)가 회원 시트에 한다.
//
// ★무접촉: 라우터·22블록·발송·결재·촬영 파일 안 건드림. 이 모듈은 roster_gate 가 불러 쓴다.
// ─────────────────────────────────────────────────────────────
'use strict';

let _anthropic = null;
let _MODEL = 'claude-opus-4-8';   // 증권 해석 = 정확도 우선(대표님 성배: 속도보다 똑똑함)
let _crud = null;

function init(opts) {
  opts = opts || {};
  if (opts.anthropic) _anthropic = opts.anthropic;
  if (opts.model) _MODEL = opts.model;
  if (opts.sheetsCrud) _crud = opts.sheetsCrud;
}

// ── 두뇌가 채워 넣을 칸 (증권 생김새와 무관한 "뜻" 기준) ──────────
//  ※칸 이름은 ★영문만 쓸 수 있다(도구 규격: ^[a-zA-Z0-9_.-]$ · 한글 키는 400 오류).
//    그래서 넘겨받은 뒤 아래 _한글로() 로 우리말 칸으로 되돌려 쓴다.
const EXTRACT_TOOL = {
  name: 'policy_fields',
  description: '증권 글에서 읽어낸 내용을 칸에 담아 넘긴다. ★적혀 있지 않은 칸은 반드시 빈 문자열로 둔다(추측 금지).',
  input_schema: {
    type: 'object',
    properties: {
      policyholder: { type: 'string', description: '계약자. 없으면 빈칸' },
      insured: { type: 'string', description: '피보험자. 없으면 빈칸' },
      insurer: { type: 'string', description: '보험사. 없으면 빈칸' },
      product: { type: 'string', description: '상품명. 없으면 빈칸' },
      policy_no: { type: 'string', description: '증권번호. 없으면 빈칸' },
      contract_date: { type: 'string', description: '계약일. YYYY-MM-DD 로. 없으면 빈칸' },
      maturity_date: { type: 'string', description: '만기일. YYYY-MM-DD 로. 종신이면 "종신". 없으면 빈칸' },
      payment_term: { type: 'string', description: '납입기간. 예: 20년납 / 전기납. 없으면 빈칸' },
      premium: { type: 'string', description: '보험료. 숫자와 단위 그대로. 예: 118,000원. 없으면 빈칸' },
      payment_cycle: { type: 'string', description: '납입주기(월납·연납 등). 없으면 빈칸' },
      renewable: { type: 'string', description: '갱신형/비갱신형. 안 적혀 있으면 빈칸' },
      coverages: {
        type: 'array',
        description: '담보(보장) 한 줄씩. 증권에 적힌 것만.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '담보명' },
            amount: { type: 'string', description: '가입금액. 적힌 그대로. 없으면 빈칸' },
            period: { type: 'string', description: '보장기간. 없으면 빈칸' },
            note: { type: 'string', description: '비고. 없으면 빈칸' },
          },
          required: ['name'],
        },
      },
      riders: { type: 'array', items: { type: 'string' }, description: '특약 이름들. 없으면 빈 배열' },
      notes: { type: 'string', description: '위 칸에 안 들어가는 중요한 내용. 없으면 빈칸' },
      unreadable: { type: 'string', description: '글이 잘렸거나 알아볼 수 없어 못 읽은 부분. 없으면 빈칸' },
      summary: { type: 'string', description: '설계사에게 실제로 쓸모 있는 핵심 3~5줄. ★위 칸에서 실제로 읽은 것만 근거로 쓴다. 보장 공백·중복·만기 임박·갱신 부담처럼 눈여겨볼 점이 실제 값에서 보이면 짚는다. 없는 사실은 절대 만들지 않는다.' },
      customer_name: { type: 'string', description: '이 증권의 주인으로 볼 이름(피보험자 우선, 없으면 계약자). 없으면 빈칸' },
    },
    required: ['summary'],
  },
};

/** 도구가 준 영문 칸 → 우리말 칸 (아래 코드·시험은 전부 우리말 칸을 쓴다) */
function _한글로(x) {
  x = x || {};
  return {
    계약자: x.policyholder || '', 피보험자: x.insured || '',
    보험사: x.insurer || '', 상품명: x.product || '', 증권번호: x.policy_no || '',
    계약일: x.contract_date || '', 만기일: x.maturity_date || '', 납입기간: x.payment_term || '',
    보험료: x.premium || '', 납입주기: x.payment_cycle || '', 갱신형여부: x.renewable || '',
    보장내역: (Array.isArray(x.coverages) ? x.coverages : []).map((c) => ({
      담보명: (c && c.name) || '', 가입금액: (c && c.amount) || '', 보장기간: (c && c.period) || '', 비고: (c && c.note) || '',
    })),
    특약: Array.isArray(x.riders) ? x.riders : [],
    기타메모: x.notes || '', 못읽은부분: x.unreadable || '',
    설계사요약: x.summary || '', 고객이름추정: x.customer_name || '',
  };
}

function systemPrompt() {
  return `당신은 25년 경력 보험 전문가입니다. 설계사가 넘긴 ★증권(보험 증권) 글을 읽고 내용을 정리합니다.

[가장 중요한 원칙]
· 증권은 보험사마다·상품마다 생김새가 다릅니다. 표든, 줄글이든, 항목 나열이든, 영문이 섞였든 ★뜻으로 읽으세요.
· ★증권에 적혀 있지 않은 값은 절대 채우지 마세요. 빈칸으로 두고, 못 읽은 것은 '못읽은부분'에 적으세요.
· 보험료·가입금액·날짜는 ★글에 적힌 숫자 그대로 옮기세요. 계산해서 바꾸거나 어림잡지 마세요.
· 상품명이 낯설어도 지어내지 마세요. 적힌 그대로 옮기면 됩니다.

[설계사요약 쓰는 법]
· 설계사가 바로 쓸 수 있게 핵심만. 예) 무엇이 보장되고, 언제 끝나고, 얼마를 내고, 눈에 띄는 점.
· ★실제로 읽어낸 값에서만 말하세요. "사망보장이 부족해 보입니다" 같은 판단은 ★그 값이 실제로 보일 때만.
· 금액 비교·적정성 판단이 필요하면 근거(어느 칸의 어떤 값)를 함께 말하세요.
· 이모지·장식기호는 쓰지 않습니다. 70대 어르신도 알아듣는 쉬운 말로.

반드시 policy_fields 도구로 결과를 넘기세요.`;
}

/** 증권 글 → 구조화된 칸 (두뇌가 읽는다 · 하드코딩 0) */
async function extract(text) {
  if (!_anthropic) return { ok: false, message: '해석 엔진이 준비되지 않았어요.' };
  const 글 = String(text || '').trim();
  if (!글) return { ok: false, message: '읽을 증권 내용이 없어요.' };
  try {
    const r = await _anthropic.messages.create({
      model: _MODEL, max_tokens: 4000,
      system: systemPrompt(),
      messages: [{ role: 'user', content: '아래는 설계사가 넘긴 증권 내용입니다. 읽고 정리해 주세요.\n\n' + 글.slice(0, 30000) }],
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'policy_fields' },
    });
    const tu = (r.content || []).find((b) => b.type === 'tool_use' && b.name === 'policy_fields');
    if (!tu || !tu.input) return { ok: false, message: '증권을 읽었는데 정리가 잘 안 됐어요. 내용을 조금 더 붙여 주시겠어요?' };
    return { ok: true, fields: _한글로(tu.input) };
  } catch (e) {
    console.log('[📄증권해석] 실패: ' + e.message);
    return { ok: false, message: '증권을 읽는 중에 문제가 있었어요. 잠시 후 다시 넣어 주세요.' };
  }
}

/** 읽어낸 것 중 ★실제로 값이 있는 칸만 사람 말로 (빈칸을 "없음"이라 지어내지 않는다) */
function 표만들기(f) {
  const 줄 = [];
  const 넣기 = (이름, 값) => { const v = String(값 == null ? '' :값).trim(); if (v) 줄.push(`| ${이름} | ${v} |`); };
  넣기('보험사', f.보험사); 넣기('상품명', f.상품명); 넣기('증권번호', f.증권번호);
  넣기('계약자', f.계약자); 넣기('피보험자', f.피보험자);
  넣기('계약일', f.계약일); 넣기('만기일', f.만기일); 넣기('납입기간', f.납입기간);
  넣기('보험료', f.보험료 + (String(f.납입주기 || '').trim() ? ` (${f.납입주기})` : ''));
  넣기('갱신형', f.갱신형여부);
  if (!줄.length) return '';
  return '| 항목 | 내용 |\n|---|---|\n' + 줄.join('\n');
}
function 보장표(f) {
  const list = Array.isArray(f.보장내역) ? f.보장내역.filter((x) => x && String(x.담보명 || '').trim()) : [];
  if (!list.length) return '';
  const 금액있음 = list.some((x) => String(x.가입금액 || '').trim());
  const 기간있음 = list.some((x) => String(x.보장기간 || '').trim());
  const head = ['담보'].concat(금액있음 ? ['가입금액'] : []).concat(기간있음 ? ['보장기간'] : []);
  const rows = list.map((x) => ['· ' + x.담보명]
    .concat(금액있음 ? [String(x.가입금액 || '').trim() || '(증권에 없음)'] : [])
    .concat(기간있음 ? [String(x.보장기간 || '').trim() || '(증권에 없음)'] : []));
  return '| ' + head.join(' | ') + ' |\n|' + head.map(() => '---').join('|') + '|\n'
    + rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n');
}

/**
 * 이 증권의 주인이 명단에 있는가 — ★찾기만 한다(쓰지 않는다).
 * 대표가 "반영해"라고 하시면 그때 기존 명단 도구(sheets_crud)가 회원 시트에 기록한다.
 */
async function 명단연결(이름, ma) {
  const n = String(이름 || '').trim();
  if (!n || !_crud || typeof _crud.loadTable !== 'function') return null;
  try {
    const t = await _crud.loadTable(ma || null);
    const hits = _crud.findByName(t, n) || [];
    if (hits.length === 1) return { 상태: '있음', 이름: hits[0][t.nameCol] || n, 행: hits[0], 표: t };
    if (hits.length > 1) return { 상태: '여럿', 후보: hits.map((r) => r[t.nameCol]).filter(Boolean).slice(0, 5) };
    const 비슷 = _crud.suggestNames ? _crud.suggestNames(t.rows.map((r) => r[t.nameCol]), n, { max: 3 }) : [];
    return { 상태: '없음', 비슷 };
  } catch (e) {
    console.log('[📄증권해석→명단] 조회 실패: ' + e.message);
    return null;
  }
}

/** 증권 값과 명단에 이미 있는 값을 나란히 (다른 데가 있으면 대표가 판단하시게) */
function 대조(f, 행, 표) {
  if (!행 || !표) return '';
  const 찾 = (이름) => { const c = _crud.resolveColumn(이름, 표.header); return c ? { 칸: c, 값: String(행[c] || '').trim() } : null; };
  const 쌍 = [['보험사', f.보험사], ['가입상품', f.상품명], ['증권번호', f.증권번호], ['만기일', f.만기일], ['월보험료', f.보험료], ['가입일', f.계약일]];
  const 줄 = [];
  for (const [칸이름, 새값] of 쌍) {
    const v = String(새값 == null ? '' : 새값).trim();
    if (!v) continue;                                    // 증권에 없으면 비교 안 함
    const cur = 찾(칸이름);
    if (!cur) { 줄.push(`| ${칸이름} | (명단에 그 칸이 없음) | ${v} | 새 칸 필요 |`); continue; }
    const 같나 = cur.값 && v && (cur.값.replace(/[\s,원]/g, '') === v.replace(/[\s,원]/g, ''));
    줄.push(`| ${cur.칸} | ${cur.값 || '(비어 있음)'} | ${v} | ${같나 ? '같음' : (cur.값 ? '다름' : '채울 수 있음')} |`);
  }
  if (!줄.length) return '';
  return '| 칸 | 지금 명단 | 이 증권 | |\n|---|---|---|---|\n' + 줄.join('\n');
}

/**
 * 증권 텍스트 한 건을 끝까지 처리해 ★사람이 읽는 답을 만든다.
 * @param {string} text  대표가 붙여넣은 글(증권 + 앞뒤 말)
 * @param {object} opts  { ma, 이름힌트 }
 */
async function analyzeText(text, opts) {
  opts = opts || {};
  const r = await extract(text);
  if (!r.ok) return { kind: '📄 증권 해석', text: r.message };
  const f = r.fields || {};

  const 이름 = String(opts.이름힌트 || '').trim() || String(f.고객이름추정 || '').trim();
  const 연결 = 이름 ? await 명단연결(이름, opts.ma) : null;

  let out = '증권 내용을 읽었어요.\n\n';
  const 기본 = 표만들기(f);
  if (기본) out += 기본 + '\n\n';
  const 보장 = 보장표(f);
  if (보장) out += '**보장 내용**\n' + 보장 + '\n\n';
  const 특약 = (Array.isArray(f.특약) ? f.특약 : []).filter((x) => String(x || '').trim());
  if (특약.length) out += '**특약** — ' + 특약.join(' · ') + '\n\n';
  if (String(f.기타메모 || '').trim()) out += String(f.기타메모).trim() + '\n\n';
  if (String(f.설계사요약 || '').trim()) out += '**핵심 정리**\n' + String(f.설계사요약).trim() + '\n\n';
  if (String(f.못읽은부분 || '').trim()) out += '못 읽은 부분: ' + String(f.못읽은부분).trim() + '\n(지어내지 않고 있는 그대로 말씀드립니다)\n\n';

  // ── 명단 연결 ──
  if (연결 && 연결.상태 === '있음') {
    out += `명단에서 ${연결.이름} 님을 찾았어요.\n\n`;
    const t = 대조(f, 연결.행, 연결.표);
    if (t) out += t + '\n\n';
    out += `이 내용을 ${연결.이름} 님 명단에 반영할까요? "반영해줘" 하시면 바로 넣어 드릴게요.`;
  } else if (연결 && 연결.상태 === '여럿') {
    out += `명단에 비슷한 분이 여럿이에요 — ${연결.후보.join(', ')}. 누구인지 알려주시면 그분께 연결할게요.`;
  } else if (연결 && 연결.상태 === '없음') {
    out += `${이름} 님은 아직 명단에 없어요.`
      + (연결.비슷 && 연결.비슷.length ? ` (혹시 ${연결.비슷.join(', ')} 님인가요?)` : '')
      + ` 새 고객으로 명단에 추가할까요? "명단에 추가해줘" 하시면 넣어 드릴게요.`;
  } else if (!이름) {
    out += '이 증권이 어느 고객 것인지는 안 적혀 있어요. "○○ 증권이야" 하고 이름을 알려주시면 명단에 연결해 드릴게요.';
  }

  return { kind: '📄 증권 해석', text: out.trim(), fields: f, 명단: 연결 ? 연결.상태 : null, viaPolicy: true };
}

module.exports = { init, extract, analyzeText, 명단연결, EXTRACT_TOOL, systemPrompt, _internals: { 표만들기, 보장표, 대조 } };
