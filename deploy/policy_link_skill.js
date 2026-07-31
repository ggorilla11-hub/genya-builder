// ─────────────────────────────────────────────────────────────
// policy_link_skill.js — 🔗 증권 해석 → 명단 반영 (3단계 · 독립 모듈 · 2026-07-31 대표님 승인)
//
// 무엇을·왜:
//   증권을 읽어 드린 뒤 대표가 "반영해줘"라고 하시면 ★실제로 명단에 넣는다.
//
// ★이걸 만든 진짜 이유 (2026-07-31 실측 사고):
//   전에는 "반영해줘"가 도구를 ★아예 안 부르고 일반 대화로 흘렀다. 그런데 지니야는
//   "1번 김철수 님 명단에 반영했습니다" 하고 ★표까지 그려 보였다 — 실제로는 한 글자도 안 바뀌었다.
//   = 되는 척(거짓 완료). 대표님 원칙 중 가장 위험한 사고다.
//   그래서 이 모듈은 ★반영한 뒤 명단을 다시 읽어, ★진짜 바뀐 값으로만 보고한다.
//
// ★휴먼인더루프: 증권을 읽었다고 ★저절로 쓰지 않는다. 대표가 "반영해줘"라고 하실 때만 이 모듈이 돈다.
//                삭제는 아예 하지 않는다. 새 고객 추가는 "추가해줘"라고 하실 때만.
// ★심장 재활용: 실제 쓰기는 ★기존 명단 도구(sheets_crud 의 planWrite/commit)가 한다. 새로 안 만든다.
// ★무접촉: 라우터·22블록·발송·결재 안 건드림. 서버에 증권을 저장하지 않는다(대화에 실려 온 글만 본다).
// ─────────────────────────────────────────────────────────────
'use strict';
const _text = require('./policy_text_skill');

let _crud = null;
function init(opts) {
  opts = opts || {};
  if (opts.sheetsCrud) _crud = opts.sheetsCrud;
  try { _text.init(opts); } catch (e) {}
}

// 증권에서 읽은 칸 → 명단 칸 (실제 칸 이름은 resolveColumn 이 시트에 맞춰 찾아준다)
const 칸짝 = [
  ['보험사', '보험사'],
  ['상품명', '가입상품'],
  ['증권번호', '증권번호'],
  ['계약일', '가입일'],
  ['만기일', '만기일'],
  ['보험료', '월보험료'],
];

/** 증권 해석 답에 붙는 표시 — 이 글이 "증권 해석 결과"인지 알아보는 표식 */
const 해석표식 = /증권 내용을 읽었어요/;

/** 대화에서 ★직전 증권 해석 답을 찾는다 (서버는 아무것도 기억하지 않는다) */
function 직전증권답(history) {
  const h = Array.isArray(history) ? history : [];
  for (let i = h.length - 1; i >= 0; i--) {
    const m = h[i] || {};
    const role = String(m.role || '').toLowerCase();
    const 글 = String(m.content || m.text || '');
    if ((role === 'assistant' || role === 'gen') && 해석표식.test(글)) return 글;
  }
  // 역할 표시가 없는 화면도 있으므로, 역할을 못 믿을 때는 글 내용으로 찾는다
  for (let i = h.length - 1; i >= 0; i--) {
    const 글 = String((h[i] || {}).content || (h[i] || {}).text || '');
    if (해석표식.test(글)) return 글;
  }
  return '';
}

/** 해석 답에서 "명단에서 ○○ 님을 찾았어요" 의 이름을 뽑는다 */
function 답속이름(글) {
  const m = String(글 || '').match(/명단에서\s+([가-힣A-Za-z]{2,10})\s*님을\s*찾았어요/);
  if (m) return m[1];
  const m2 = String(글 || '').match(/([가-힣A-Za-z]{2,10})\s*님은 아직 명단에 없어요/);
  return m2 ? m2[1] : '';
}

/** 두 값이 사실상 같은가 (쉼표·공백·'원' 차이는 같은 값으로 본다) */
function 같은값(a, b) {
  const n = (x) => String(x == null ? '' : x).replace(/[\s,원]/g, '');
  return n(a) === n(b) && n(a) !== '';
}

/**
 * "반영해줘" 를 실제로 처리한다.
 * @param {string} q        대표가 하신 말("반영해줘"·"추가해줘" 등)
 * @param {object} opts     { ma, history }
 */
async function applyFromHistory(q, opts) {
  opts = opts || {};
  if (!_crud) return { kind: '🔗 명단 반영', text: '명단 도구가 준비되지 않았어요.' };

  const 답 = 직전증권답(opts.history);
  if (!답) {
    return { kind: '🔗 명단 반영', text: '무엇을 반영할지 못 찾았어요. 증권 내용을 먼저 올려주시면 읽고 나서 반영해 드릴게요.' };
  }

  // ★해석 답(표)에서 값을 다시 읽는다 — 1단계 해석기를 그대로 재활용(지어내기 통로를 안 만든다)
  const r = await _text.extract(답);
  if (!r.ok) return { kind: '🔗 명단 반영', text: '방금 읽어 드린 증권 내용을 다시 정리하지 못했어요. 증권을 한 번만 더 올려 주시겠어요?' };
  const f = r.fields || {};

  const 이름 = 답속이름(답) || String(f.피보험자 || f.계약자 || f.고객이름추정 || '').trim();
  if (!이름) return { kind: '🔗 명단 반영', text: '이 증권이 어느 고객 것인지 몰라서 반영을 못 했어요. "○○님 증권이야" 하고 이름을 알려주세요.' };

  const table = await _crud.loadTable(opts.ma || null);
  const hits = _crud.findByName(table, 이름) || [];

  // ── 명단에 없는 분 ──
  if (!hits.length) {
    if (!/추가/.test(String(q || ''))) {
      return { kind: '🔗 명단 반영', text: `${이름} 님은 명단에 없어서 반영할 곳이 없어요. 새로 추가할까요? "명단에 추가해줘" 하시면 넣어 드릴게요. (아직 아무것도 안 바꿨습니다)` };
    }
    const fields = { [table.nameCol]: 이름 };
    for (const [증권칸, 명단칸] of 칸짝) { const v = String(f[증권칸] || '').trim(); if (v) fields[명단칸] = v; }
    const planned = await _crud.planWrite(opts.ma || null, 'create', { fields });
    if (!planned.ok) return { kind: '🔗 명단 반영', text: planned.message || '추가하지 못했어요.' };
    const done = await _crud.commit(opts.ma || null, planned.pending.action, planned.pending.sig, { 즉시: true });
    if (!done.ok) return { kind: '🔗 명단 반영', text: done.message || '추가하지 못했어요. (명단은 그대로입니다)' };
    // ★진짜 들어갔는지 다시 읽어 확인 — "됐다"는 말로 끝내지 않는다
    const t2 = await _crud.loadTable(opts.ma || null);
    const 확인 = (_crud.findByName(t2, 이름) || [])[0];
    if (!확인) return { kind: '🔗 명단 반영', text: `${이름} 님을 추가했다고 나왔는데 다시 읽어보니 명단에 없어요. 반영되지 않았습니다.` };
    const 줄 = 칸짝.map(([증권칸, 명단칸]) => { const c = _crud.resolveColumn(명단칸, t2.header); return c && 확인[c] ? `| ${c} | ${확인[c]} |` : ''; }).filter(Boolean);
    return { kind: '🔗 명단 반영', applied: true,
      text: `${이름} 님을 명단에 새로 추가했어요. ★다시 읽어 확인한 값입니다.\n\n| 항목 | 값 |\n|---|---|\n${줄.join('\n')}` };
  }

  if (hits.length > 1) {
    return { kind: '🔗 명단 반영', text: `'${이름}' 님과 비슷한 분이 여럿이에요 — ${hits.map((x) => x[table.nameCol]).join(', ')}. 누구인지 정확히 알려주시면 반영할게요. (아직 아무것도 안 바꿨습니다)` };
  }

  // ── 명단에 있는 분: 다른 칸만 골라 반영 ──
  const 대상 = hits[0];
  const 실제이름 = 대상[table.nameCol] || 이름;
  const 할일 = [];
  for (const [증권칸, 명단칸] of 칸짝) {
    const 새값 = String(f[증권칸] || '').trim();
    if (!새값) continue;                                   // 증권에 없는 값은 건드리지 않는다
    const col = _crud.resolveColumn(명단칸, table.header);
    if (!col) continue;                                    // 명단에 없는 칸은 이번엔 만들지 않는다(범위 밖)
    const 전 = String(대상[col] || '');
    if (같은값(전, 새값)) continue;                        // 같으면 안 건드린다
    할일.push({ col, 전, 후: 새값 });
  }
  if (!할일.length) {
    return { kind: '🔗 명단 반영', text: `${실제이름} 님 명단은 이미 이 증권과 같아요. 바꿀 게 없어서 그대로 뒀습니다.` };
  }

  // ★실제 쓰기 — 기존 심장 도구(planWrite → commit)를 그대로 쓴다
  const 성공 = [], 실패 = [];
  for (const it of 할일) {
    try {
      const planned = await _crud.planWrite(opts.ma || null, 'update', { name: 실제이름, field: it.col, value: it.후 });
      if (!planned.ok) { 실패.push({ ...it, 왜: planned.message || '준비 실패' }); continue; }
      const done = await _crud.commit(opts.ma || null, planned.pending.action, planned.pending.sig, { 즉시: true });
      if (!done.ok) { 실패.push({ ...it, 왜: done.message || '반영 실패' }); continue; }
      성공.push(it);
    } catch (e) { 실패.push({ ...it, 왜: e.message }); }
  }

  // ★★거짓 완료 차단 — 명단을 ★다시 읽어 진짜 값으로만 보고한다
  const t2 = await _crud.loadTable(opts.ma || null);
  const 확인 = (_crud.findByName(t2, 실제이름) || [])[0] || {};
  const 줄 = [];
  let 진짜반영 = 0;
  for (const it of 할일) {
    const 지금 = String(확인[it.col] || '');
    const 됐나 = 같은값(지금, it.후);
    if (됐나) 진짜반영++;
    줄.push(`| ${it.col} | ${it.전 || '(빈칸)'} | ${지금 || '(빈칸)'} | ${됐나 ? '반영됨' : '★반영 안 됨'} |`);
  }

  let text = 진짜반영 === 할일.length
    ? `${실제이름} 님 명단에 ${진짜반영}군데 반영했어요. ★반영한 뒤 명단을 다시 읽어 확인한 값입니다.\n\n`
    : `${실제이름} 님 명단에 ${진짜반영}군데만 반영됐어요. ${할일.length - 진짜반영}군데는 ★들어가지 않았습니다(있는 그대로 알려드립니다).\n\n`;
  text += `| 항목 | 이전 | 지금 | |\n|---|---|---|---|\n${줄.join('\n')}`;
  if (실패.length) text += `\n\n안 된 이유: ` + 실패.map((x) => `${x.col} — ${x.왜}`).join(' / ');

  console.log(`[🔗명단반영] ${실제이름} · 시도 ${할일.length} · 실제 반영 ${진짜반영}`);
  return { kind: '🔗 명단 반영', applied: 진짜반영 > 0, 반영수: 진짜반영, 시도수: 할일.length, text };
}

module.exports = { init, applyFromHistory, 직전증권답, 답속이름, 칸짝, 같은값 };
