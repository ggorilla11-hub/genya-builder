// ─────────────────────────────────────────────────────────────
// policy_analysis_skill.js — 🛡️ 증권분석비서 (배선A · 독립 모듈) ★v7 스킬창고 부품
// 무엇을·왜: 고객 증권(사진/PDF/분석파일) → ①증권 유형 자동판별 ②유형별 양식으로 보장분석
//   ③필요자금=오상열 금융집짓기 공식 ④상품 1·2·3위 제안(인수지침 반영) ⑤약관 대조(있으면)
//   → 코치 완성본 수준 HTML 리포트(딥네이비+teal+골드, 인쇄 컬러 유지, 페이지 분리).
//
// 사용: const { analyzePolicy } = require('./policy_analysis_skill');
//        const r = await analyzePolicy({ images:[{data:base64, mime}], annualIncome, job, debt });
//        r = { ok, type, html, rows(엑셀용), engine, disclaimer }
//
// ★공통 자산(전 회원 공유·도구). 고객 데이터 아님(도구). /parksugeun·jenya·기존 시트 무접촉.
// ★원칙1(Zero data ingress): 증권 파일은 호출 인자로만 받아 메모리에서 지니야 눈에 넘기고 버린다.
//   이 모듈은 파일 저장·전역 캐시 0. (서버 디스크에 고객 증권을 쓰지 않는다.)
// ★불변 원칙: 특정 상품 "가입권유" 아님 — 이론상 최적 비교·제안. 실제 인수는 청약·심사에서 확정(휴먼인더루프).
// ★정직: 없는 값 지어내기 금지("자료에서 확인 필요"), 출처 '상품의정석·인카' 표기 금지 → "인수지침 반영".
// ─────────────────────────────────────────────────────────────
'use strict';
try { require('dotenv').config(); } catch (e) {}

const ANSWER_MODEL = 'claude-sonnet-5'; // ★대표 절대규칙: 모든 LLM = Sonnet. mini 금지. 날짜접미사 금지.

// ── 필요자금 공식(오상열 CFP 금융집짓기 · rag_formulas 원문 — 지어내기 0) ──
//   연소득 없으면 직장인 4,000만 / 주부 3,000만 가정.
const 필요자금공식 = {
  '사망·후유장해': '연소득 × 3배 + 부채',
  '암 진단금': '연소득 × 2배',
  '뇌혈관 진단금': '연소득 × 1배',
  '심혈관(허혈성) 진단금': '연소득 × 1배',
  '실손의료비': '5,000만원(실손 가입 = 있음)',
  '적정 월보험료': '월소득의 8~10% (미혼 1인 5%)',
};

// ── 유형별 양식(대표 완성본 골격) ──
const 유형양식 = {
  종합증권: '보장분석형 — 필요·준비·부족(gap) 표 + 상품 매트릭스. 사망/암/뇌/심/실손/수술·입원/납입면제를 축으로.',
  운전자보험: '운전 리스크형 — 형사 3종(교통사고처리지원금·변호사선임비용·자동차사고 벌금) 중심으로 준비 여부와 한도 점검.',
  암보험: '치료 여정형 — 진단(진단금)→치료(수술·항암·표적/면역)→요양(요양병원·간병·통원)의 단계별 준비 점검.',
  기타: '핵심 담보 위주 보장 점검(사망/진단/실손/수술·입원). 유형이 불명확하면 무리하게 단정하지 않는다.',
};

const DISCLAIMER =
  '이 분석은 제출하신 증권에 보이는 정보 기준의 "이론상 보장분석·제안"입니다. 실제 인수 가능 여부(정상·할증·거절)와 최종 가입은 청약·심사에서 확정되며, 발송·제출 전 담당 설계사가 반드시 검토해야 합니다. ※ 제출 전 검토하세요.';

let _an = null;
function anthropic() {
  if (!_an) _an = new (require('@anthropic-ai/sdk'))({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _an;
}

// LLM이 채워야 할 구조(코드가 HTML로 렌더 → 스타일·인쇄·페이지분리는 코드가 통제)
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['종합증권', '운전자보험', '암보험', '기타'] },
    고객: {
      type: 'object', additionalProperties: false,
      properties: {
        이름: { type: 'string' }, 직업: { type: 'string' }, 연령대: { type: 'string' },
        연소득기준: { type: 'string' }, 비고: { type: 'string' },
      },
      required: ['이름', '직업', '연령대', '연소득기준', '비고'],
    },
    준비현황: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { 담보: { type: 'string' }, 가입금액: { type: 'string' }, 보험사: { type: 'string' }, 비고: { type: 'string' } },
        required: ['담보', '가입금액', '보험사', '비고'],
      },
    },
    보장분석: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          항목: { type: 'string' }, 필요: { type: 'string' }, 준비: { type: 'string' },
          부족: { type: 'string' }, 판정: { type: 'string', enum: ['충분', '부족', '과다', '확인 필요'] }, 근거: { type: 'string' },
        },
        required: ['항목', '필요', '준비', '부족', '판정', '근거'],
      },
    },
    상품제안: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          순위: { type: 'string' }, 생손보: { type: 'string' }, 회사: { type: 'string' }, 상품: { type: 'string' },
          핵심담보: { type: 'string' }, 이유: { type: 'string' }, 인수지침: { type: 'string' },
        },
        required: ['순위', '생손보', '회사', '상품', '핵심담보', '이유', '인수지침'],
      },
    },
    약관노트: { type: 'string' },
    요약: { type: 'string' },
  },
  required: ['type', '고객', '준비현황', '보장분석', '상품제안', '약관노트', '요약'],
};

function buildSystem(annualIncome, job, debt) {
  const 연소득 = annualIncome ? `${annualIncome}` : '(미입력 — 직장인 4,000만/주부 3,000만 가정 후 그 가정을 비고에 명시)';
  const 부채 = debt ? `${debt}` : '(미입력)';
  const 공식표 = Object.entries(필요자금공식).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
  const 양식표 = Object.entries(유형양식).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
  return `당신은 보험설계사를 돕는 비서 "지니야"입니다. 제출된 증권(사진/PDF/분석파일)을 보고 "코치가 손으로 만든 완성본 수준"의 보장분석을 JSON으로 채웁니다.
말투·표기: 비전문가도 이해하게. ★나이를 추정한 호칭 금지. "클로드·AI모델·챗봇" 금지 — 당신은 "지니야".

[1단계 — 증권 유형 자동판별] 증권을 보고 아래 중 하나로 type을 정한다. 애매하면 '기타'로.
${양식표}

[2단계 — 준비현황] 증권에서 실제로 확인되는 담보·가입금액·보험사를 준비현황에 그대로 옮긴다.
  - ★증권에 없거나 금액이 안 보이면 지어내지 말고 "확인 필요"로 적는다.

[3단계 — 보장분석(필요·준비·부족 gap)] 아래 오상열 금융집짓기 공식으로만 "필요"를 계산한다(임의 수치 금지).
  필요자금 공식:
${공식표}
  고객 연소득 = ${연소득} / 부채 = ${부채}.
  - 각 항목에 필요/준비/부족/판정(충분·부족·과다·확인 필요)/근거를 채운다. 부족하면 얼마나 부족한지 근거를 든다.
  - 연소득이 미입력이면 위 가정을 쓰되, 고객.비고와 근거에 "연소득 가정치 기준"임을 반드시 명시한다.
  - 유형이 운전자보험이면 형사3종 중심, 암보험이면 진단→치료→요양 단계 중심으로 보장분석 항목을 구성한다.

[4단계 — 상품제안 1·2·3위] 부족을 메우는 실제 상품을 생보/손보로 나눠 1·2·3위로 제안한다.
  - 특정 회사·상품명을 쓰되, 인수 난이도는 "인수지침 반영"으로 표기한다.
  - ★출처를 '상품의정석'이나 '인카'로 절대 표기하지 마라. 인수지침 필드에는 "인수지침 반영"과 간편/일반심사 성격만 적는다(예: "간편심사형 — 병력 있어도 상대적으로 수월(인수지침 반영)").
  - ★단정 금지: "A사 거절/B사 통과" 식으로 확정하지 말고 "참고·예측" 수준으로.

[5단계 — 약관노트] 이 필드에는 당신이 약관 원문을 지어내지 마라. "약관 정밀 대조는 시스템이 별도로 채운다"는 전제로, 고객이 특히 확인하면 좋을 약관 포인트(면책기간·감액기간 등)만 한두 줄 남긴다.

[요약] 설계사가 고객에게 한 문장으로 전할 핵심(가장 시급한 부족담보 1~2개)을 요약에 적는다.

[정직 규칙] 자료에서 확실히 안 보이는 수치는 지어내지 말 것. 모든 제안은 "가입권유"가 아니라 "이론상 최적 비교·제안"이다.`;
}

// ── HTML 렌더: 코치 완성본 템플릿(딥네이비+teal+골드, 인쇄 컬러 유지, 페이지 분리) ──
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function 판정색(p) { return p === '부족' ? '#e76f51' : p === '과다' ? '#d4a017' : p === '충분' ? '#2a9d8f' : '#8a93a3'; }

function renderHTML(d, yakgwanBlock) {
  const 고객 = d.고객 || {};
  const 현황 = (d.준비현황 || []).map((r) => `<tr><td>${esc(r.담보)}</td><td class="num">${esc(r.가입금액)}</td><td>${esc(r.보험사)}</td><td>${esc(r.비고)}</td></tr>`).join('');
  const 분석 = (d.보장분석 || []).map((r) => `<tr><td>${esc(r.항목)}</td><td class="num">${esc(r.필요)}</td><td class="num">${esc(r.준비)}</td><td class="num">${esc(r.부족)}</td><td><b style="color:${판정색(r.판정)}">${esc(r.판정)}</b></td><td class="small">${esc(r.근거)}</td></tr>`).join('');
  const 제안 = (d.상품제안 || []).map((r) => `<tr><td><b>${esc(r.순위)}</b></td><td>${esc(r.생손보)}</td><td>${esc(r.회사)}</td><td>${esc(r.상품)}</td><td>${esc(r.핵심담보)}</td><td class="small">${esc(r.이유)}</td><td class="small">${esc(r.인수지침)}</td></tr>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>지니야 보장분석 리포트</title>
<style>
  :root{--navy:#0d1b2a;--navy2:#14213d;--teal:#2a9d8f;--teal-d:#0f766e;--gold:#d4a017;--ink:#1a1f28;--line:#dbe2ea;--bg:#f5f7fa;}
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{font-family:Pretendard,'맑은 고딕','Malgun Gothic',sans-serif;color:var(--ink);background:var(--bg);margin:0;}
  .wrap{max-width:900px;margin:0 auto;padding:24px;}
  .card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin:16px 0;break-inside:avoid;page-break-inside:avoid;}
  .hero{background:linear-gradient(135deg,var(--navy),var(--navy2));color:#fff;border:0;}
  .hero h1{margin:0 0 4px;font-size:22px;} .hero .sub{color:#9db4d6;font-size:13px;}
  .badge{display:inline-block;background:var(--gold);color:#241a00;font-weight:700;border-radius:999px;padding:4px 12px;font-size:12px;margin-top:10px;}
  h2{font-size:16px;color:var(--navy);margin:0 0 12px;padding-left:10px;border-left:4px solid var(--teal);}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  th{background:var(--navy2);color:#fff;text-align:left;padding:8px 10px;font-weight:600;}
  td{border-bottom:1px solid var(--line);padding:8px 10px;vertical-align:top;}
  td.num{text-align:right;white-space:nowrap;} td.small{color:#556;font-size:12px;}
  .sum{background:#e8f4f2;border-left:4px solid var(--teal);border-radius:8px;padding:12px 14px;color:#134e4a;font-weight:600;}
  .note{color:#6b7280;font-size:12px;line-height:1.6;}
  .foot{color:#8a93a3;font-size:11px;text-align:center;margin:18px 0;line-height:1.6;}
  @media print{body{background:#fff;}.wrap{max-width:none;padding:0;}}
</style></head><body><div class="wrap">
  <div class="card hero">
    <h1>보장분석 리포트</h1>
    <div class="sub">지니야 자동 생성 · 코치 검토용 · ${esc(고객.이름 || '고객')} 님</div>
    <span class="badge">${esc(d.type || '보장분석')}</span>
  </div>
  <div class="card"><h2>고객 요약</h2>
    <table><tr><th>이름</th><td>${esc(고객.이름)}</td><th>직업</th><td>${esc(고객.직업)}</td></tr>
    <tr><th>연령대</th><td>${esc(고객.연령대)}</td><th>연소득 기준</th><td>${esc(고객.연소득기준)}</td></tr></table>
    ${고객.비고 ? `<p class="note">${esc(고객.비고)}</p>` : ''}
  </div>
  <div class="card"><h2>① 준비 현황 (증권에서 확인)</h2>
    <table><thead><tr><th>담보</th><th>가입금액</th><th>보험사</th><th>비고</th></tr></thead><tbody>${현황 || '<tr><td colspan=4 class="small">확인된 담보 없음</td></tr>'}</tbody></table>
  </div>
  <div class="card"><h2>② 보장분석 — 필요 · 준비 · 부족 (오상열 금융집짓기 공식)</h2>
    <table><thead><tr><th>항목</th><th>필요</th><th>준비</th><th>부족</th><th>판정</th><th>근거</th></tr></thead><tbody>${분석 || '<tr><td colspan=6 class="small">분석 항목 없음</td></tr>'}</tbody></table>
  </div>
  <div class="card"><h2>③ 상품 제안 — 1·2·3위 (인수지침 반영)</h2>
    <table><thead><tr><th>순위</th><th>생손보</th><th>회사</th><th>상품</th><th>핵심담보</th><th>이유</th><th>인수</th></tr></thead><tbody>${제안 || '<tr><td colspan=7 class="small">제안 없음</td></tr>'}</tbody></table>
  </div>
  <div class="card"><h2>④ 약관 정밀</h2>
    ${yakgwanBlock || ''}
    ${d.약관노트 ? `<p class="note">📌 확인 포인트: ${esc(d.약관노트)}</p>` : ''}
  </div>
  ${d.요약 ? `<div class="card"><h2>한 줄 요약</h2><div class="sum">${esc(d.요약)}</div></div>` : ''}
  <div class="foot">${esc(DISCLAIMER)}</div>
</div></body></html>`;
}

// 엑셀(CSV)용 평면 행
function toRows(d) {
  const rows = [['구분', '항목', '필요', '준비', '부족', '판정', '근거']];
  (d.보장분석 || []).forEach((r) => rows.push(['보장분석', r.항목, r.필요, r.준비, r.부족, r.판정, r.근거]));
  (d.상품제안 || []).forEach((r) => rows.push(['제안', `${r.순위} ${r.생손보}`, r.회사, r.상품, r.핵심담보, r.이유, r.인수지침]));
  return rows;
}

/** 증권(PDF·이미지)들 → 유형판별 + 보장분석 + 제안 리포트. images=[{data:base64, mime}] */
async function analyzePolicy(input) {
  const { images, annualIncome, job, debt } = input || {};
  const imgs = Array.isArray(images) ? images.filter((x) => x && x.data) : [];
  if (!imgs.length) throw new Error('증권 파일(images)이 비어있음');

  // 크기 가드(큰 PDF 방어)
  const totalMB = imgs.reduce((s, im) => s + (im.data ? im.data.length * 0.75 : 0), 0) / (1024 * 1024);
  if (totalMB > 20) {
    return { ok: false, type: '기타', html: '', rows: [], error: 'too_large', report: `증권 파일이 너무 커요(총 약 ${Math.round(totalMB)}MB). 담보가 보이는 핵심 페이지만 올려주시면 바로 분석해드릴게요.`, disclaimer: DISCLAIMER };
  }

  // PDF→문서모드, 이미지→Vision, 못 읽는 형식은 정직 표시
  const content = []; const bad = [];
  imgs.forEach((im, i) => {
    const mime = String(im.mime || 'image/jpeg').toLowerCase();
    if (mime === 'application/pdf' || /pdf/.test(mime)) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: im.data } });
    } else if (/^image\//.test(mime)) {
      const mt = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime) ? mime : 'image/jpeg';
      content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: im.data } });
    } else { bad.push(`증권 ${i + 1}(${mime || '알 수 없음'})`); return; }
    content.push({ type: 'text', text: `— 위는 증권 ${i + 1} 입니다.` });
  });
  if (!content.some((c) => c.type === 'document' || c.type === 'image')) {
    return { ok: false, type: '기타', html: '', rows: [], error: 'unreadable', report: `올려주신 파일을 읽지 못했어요(${bad.join(', ')}). 증권은 이미지(jpg·png)나 PDF로 올려주세요.`, disclaimer: DISCLAIMER };
  }
  content.push({ type: 'text', text: '위 증권(들)을 유형 판별 후 보장분석 JSON으로 채워주세요.' });

  const system = buildSystem(annualIncome, job, debt);
  let data = null;
  try {
    const r = await anthropic().messages.create({
      model: ANSWER_MODEL, max_tokens: 8000, system,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }],
    });
    const txt = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    data = JSON.parse(txt);
  } catch (e) {
    const hint = /too large|maximum|size|token|payload|400/i.test(e.message || '') ? ' (증권 PDF가 크거나 페이지가 많은 것 같아요 — 핵심 페이지만 올려보세요)' : '';
    return { ok: false, type: '기타', html: '', rows: [], error: e.message, report: '증권 분석 중 문제가 생겼어요' + hint + '. 파일을 확인하고 다시 시도해 주세요.', disclaimer: DISCLAIMER };
  }

  // 약관 정밀 — 있는 상품군만 근거, 없으면 "수집 완료 시 자동대조" 정직 표시
  let yakgwanBlock = '';
  try {
    const { askYakgwan } = require('./yakgwan_module');
    const q = data.type === '암보험' ? '암 진단비 지급 조건과 면책·감액 기간' : data.type === '운전자보험' ? '운전자보험 교통사고처리지원금·변호사선임비용 지급 조건' : '진단비·수술비 지급 조건과 면책 기간';
    const yr = await askYakgwan(q);
    const 관련없음 = !yr || !yr.found || /없어요|원문 확인이 필요|관련이 없|자동차보험/.test(yr.answer || '');
    if (!관련없음) { yakgwanBlock = `<p class="note">${esc(yr.answer)}</p><p class="small">근거: ${esc((yr.sources || []).join(', ') || '약관')}</p>`; }
    else { yakgwanBlock = '<p class="note">이 증권군의 약관 정밀 대조는 <b>수집 완료 시 자동 대조</b>됩니다. 현재 수집된 약관에 해당 상품군이 없어, 약관이 들어오면 지급조건·면책/감액 기간까지 근거·페이지로 대조해드려요. (없는 내용은 지어내지 않습니다)</p>'; }
  } catch (e) { yakgwanBlock = '<p class="note">약관 정밀 대조는 수집 완료 시 자동 대조됩니다.</p>'; }

  return { ok: true, type: data.type || '기타', html: renderHTML(data, yakgwanBlock), rows: toRows(data), data, engine: ANSWER_MODEL, disclaimer: DISCLAIMER };
}

module.exports = { analyzePolicy, 필요자금공식, 유형양식, DISCLAIMER };

// ── 자체 시연(구조만; 실제 호출은 배포 API에서) ──
if (require.main === module) {
  console.log('🛡️ 증권분석비서 — 필요자금 공식:');
  Object.entries(필요자금공식).forEach(([k, v]) => console.log(`   ${k}: ${v}`));
  console.log('   유형양식:', Object.keys(유형양식).join(' / '));
}
