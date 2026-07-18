// ─────────────────────────────────────────────────────────────
// pension_analysis_skill.js — 📊 연금분석제안비서 (배선B · 독립 모듈) ★v7 스킬창고 부품
// 무엇을·왜: 변액연금 가입설계서 2개(PDF/이미지) → 최저보증·사업비·수익률·연금액 추출
//   → 표지 있는 "고객용 연금 제안서"(코치 완성본 포맷): 표지 → 노후공백 → 2상품 비교
//     (단리보증형 vs 투자형) → 수령 시뮬 막대그래프 → 성향별 추천.
//
// 사용: const { analyzePension } = require('./pension_analysis_skill');
//        const r = await analyzePension({ images:[{data:base64, mime}, ...], name });
//        r = { ok, html, rows(엑셀용), engine, disclaimer }
//
// ★공통 자산(도구). 고객 데이터 아님. /parksugeun·jenya·기존 시트 무접촉.
// ★원칙1(Zero data ingress): 설계서는 인자로만 받아 메모리에서 지니야 눈에 넘기고 버린다(서버 저장 0).
// ★정직: 없는 값 지어내기 금지("자료에서 확인 필요") · 연금액은 "예시" 표기 · 원금손실/예금자보호 고지 포함.
// ★가입권유 아님 — 중립 비교·성향별 안내. 최종 판단·가입은 고객·설계사(휴먼인더루프).
// ─────────────────────────────────────────────────────────────
'use strict';
try { require('dotenv').config(); } catch (e) {}

const ANSWER_MODEL = 'claude-sonnet-5'; // ★대표 절대규칙: 모든 LLM = Sonnet. mini 금지. 날짜접미사 금지.

const DISCLAIMER =
  '본 제안서는 제출된 가입설계서 기준의 "예시"이며, 실제 수령액은 적립금·수익률·사업비·해지공제 등에 따라 달라집니다. 변액연금은 실적배당형으로 원금 손실이 발생할 수 있고 예금자보호 대상이 아닙니다(최저보증 옵션은 약관 조건 충족 시 적용). 가입 전 상품설명서·약관을 확인하시고, 최종 판단은 고객 본인과 담당 설계사가 합니다. ※ 제출 전 검토하세요.';

let _an = null;
function anthropic() {
  if (!_an) _an = new (require('@anthropic-ai/sdk'))({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _an;
}

function buildSystem(name) {
  return `당신은 보험설계사를 돕는 비서 "지니야"입니다. 변액연금 가입설계서 2개를 비교해 "고객용 연금 제안서"를 만들 재료를 JSON으로만 채웁니다.
말투·표기: 비전문가(고객)도 이해하게. ★나이 추정 호칭 금지. "클로드·AI모델·챗봇" 금지 — 당신은 "지니야".

[추출] 각 설계서에서 아래를 읽는다. 자료에 없으면 지어내지 말고 "확인 필요"로.
  - 상품명/보험사, 유형(단리보증형 / 투자형 / 기타), 최저보증(예: 최저연금적립금·최저사망), 사업비(부가보험료율 등),
    가정수익률(설계서 가정치), 예상연금액(반드시 "예시"로), 예상월연금_만원(막대그래프용 숫자·모르면 0), 특징 한 줄.

[표지] 고객 별칭(없으면 "고객"), 부제, 작성라벨을 채운다.
[노후공백] "왜 연금이 필요한가 / 국민연금만으론 부족한 노후 공백"을 2~3문장 쉬운 말로.
[2상품 비교] 단리보증형 vs 투자형 관점의 장단점을 대조한다(안정성 vs 수익가능성, 최저보증 유무, 사업비, 원금손실 가능성).
[수령 시뮬] 예상월연금_만원 두 값으로 막대 비교(시스템이 그림). 시뮬설명 한 줄(가정 조건 명시, "예시"임 강조).
[성향추천] 안정형 고객 추천(이유), 투자형 고객 추천(이유), 종합의견을 각각 채운다.
[고지] 원금손실 가능·예금자보호 비대상·최저보증은 약관조건 충족 시 적용을 한 줄로.

[정직 규칙] 자료에서 확실히 안 보이는 수치는 지어내지 말 것. 모든 연금액은 "예시"임을 문구에 남긴다. 특정 상품 "가입 권유"가 아니라 "성향별 비교 안내"다.

★반드시 아래 JSON "한 개"만 출력한다(코드펜스·설명·마크다운 금지). 키/구조 정확히:
{"표지":{"고객명":"","부제":"","작성라벨":""},
 "노후공백":"",
 "상품":[{"상품명":"","보험사":"","유형":"단리보증형|투자형|기타","최저보증":"","사업비":"","가정수익률":"","예상연금액":"","예상월연금_만원":0,"특징":""}],
 "비교":{"단리보증형":"","투자형":""},
 "시뮬설명":"",
 "성향추천":{"안정형":"","투자형":"","종합":""},
 "고지":"",
 "요약":""}
고객 별칭 힌트: ${name || '(없음)'}`;
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// 수령 시뮬 막대그래프(SVG) — 예상월연금_만원 두 값 비교
function barChart(prods) {
  var vals = prods.map(function (p) { return Math.max(0, Number(p && p.예상월연금_만원) || 0); });
  var max = Math.max(1, vals[0] || 0, vals[1] || 0);
  if (!(vals[0] > 0) && !(vals[1] > 0)) return '<p class="note">예상 월연금 숫자를 설계서에서 확정하지 못해 막대그래프는 생략합니다(값 확인 필요). 위 비교표의 "예상연금액(예시)"를 참고하세요.</p>';
  var W = 620, H = 220, pad = 44, bw = 120, gap = 150, x0 = 150;
  var colors = ['#14213d', '#2a9d8f'];
  var bars = prods.map(function (p, i) {
    var v = vals[i]; var h = Math.round((H - pad - 30) * (v / max)); var x = x0 + i * gap; var y = H - pad - h;
    return '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="6" fill="' + colors[i] + '"/>' +
      '<text x="' + (x + bw / 2) + '" y="' + (y - 8) + '" text-anchor="middle" font-size="15" font-weight="700" fill="' + colors[i] + '">' + esc(v ? (v + '만원') : '확인 필요') + '</text>' +
      '<text x="' + (x + bw / 2) + '" y="' + (H - pad + 20) + '" text-anchor="middle" font-size="12" fill="#556">' + esc((p.상품명 || ('상품' + (i + 1))).slice(0, 14)) + '</text>';
  }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:620px;height:auto"><line x1="120" y1="' + (H - pad) + '" x2="' + (W - 20) + '" y2="' + (H - pad) + '" stroke="#dbe2ea" stroke-width="1.5"/><text x="30" y="40" font-size="12" fill="#8a93a3">예상 월수령(만원·예시)</text>' + bars + '</svg>';
}

function renderHTML(d) {
  var cover = d.표지 || {}; var prods = (d.상품 || []).slice(0, 2);
  var rows = prods.map(function (p) {
    return '<tr><td><b>' + esc(p.상품명) + '</b><div class="small">' + esc(p.보험사) + '</div></td><td>' + esc(p.유형) + '</td><td>' + esc(p.최저보증) + '</td><td>' + esc(p.사업비) + '</td><td>' + esc(p.가정수익률) + '</td><td><b>' + esc(p.예상연금액) + '</b><div class="small">예시</div></td></tr>';
  }).join('');
  var cmp = d.비교 || {}; var seong = d.성향추천 || {};
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>지니야 연금 제안서</title>
<style>
  :root{--navy:#0d1b2a;--navy2:#14213d;--teal:#2a9d8f;--teal-d:#0f766e;--gold:#d4a017;--ink:#1a1f28;--line:#dbe2ea;--bg:#f5f7fa;}
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  body{font-family:Pretendard,'맑은 고딕','Malgun Gothic',sans-serif;color:var(--ink);background:var(--bg);margin:0;}
  .wrap{max-width:900px;margin:0 auto;padding:24px;}
  .card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin:16px 0;break-inside:avoid;page-break-inside:avoid;}
  h2{font-size:16px;color:var(--navy);margin:0 0 12px;padding-left:10px;border-left:4px solid var(--teal);}
  table{width:100%;border-collapse:collapse;font-size:13px;} th{background:var(--navy2);color:#fff;text-align:left;padding:8px 10px;font-weight:600;}
  td{border-bottom:1px solid var(--line);padding:8px 10px;vertical-align:top;} td.small,.small{color:#556;font-size:11.5px;}
  .note{color:#6b7280;font-size:12px;line-height:1.6;}
  .cmp{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  .cmp .box{border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.6;}
  .cmp .box.a{border-top:3px solid var(--navy2);} .cmp .box.b{border-top:3px solid var(--teal);}
  .cmp .box h3{margin:0 0 6px;font-size:13px;} .cmp .box.a h3{color:var(--navy2);} .cmp .box.b h3{color:var(--teal-d);}
  .seong .row{border-left:3px solid var(--gold);background:#fdf6e3;border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:13px;line-height:1.6;}
  .seong .row b{color:#8a6d0f;}
  .gaji{background:#fdecea;border-left:4px solid #e76f51;border-radius:8px;padding:11px 13px;color:#8a2f22;font-size:12px;line-height:1.6;}
  .foot{color:#8a93a3;font-size:11px;text-align:center;margin:18px 0;line-height:1.6;}
  /* ★표지: 별도 페이지 */
  .cover{background:linear-gradient(135deg,var(--navy),var(--navy2));color:#fff;border:0;min-height:360px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;page-break-after:always;break-after:page;}
  .cover .badge{background:var(--gold);color:#241a00;font-weight:700;border-radius:999px;padding:5px 14px;font-size:12px;margin-bottom:16px;}
  .cover h1{font-size:28px;margin:0 0 8px;} .cover .who{font-size:17px;color:#cfe3ff;margin-bottom:6px;} .cover .sub{color:#9db4d6;font-size:13px;}
  @media print{body{background:#fff;}.wrap{max-width:none;padding:0;}}
</style></head><body><div class="wrap">
  <div class="card cover">
    <span class="badge">연금 제안서</span>
    <h1>노후를 위한 연금 설계</h1>
    <div class="who">${esc(cover.고객명 || '고객')} 님 맞춤 제안</div>
    <div class="sub">${esc(cover.부제 || '변액연금 2상품 비교 · 지니야 자동 생성(코치 검토용)')}</div>
    <div class="sub" style="margin-top:10px">${esc(cover.작성라벨 || '')}</div>
  </div>
  <div class="card"><h2>왜 연금인가 · 노후 공백</h2><p class="note" style="font-size:13px;color:#374151">${esc(d.노후공백)}</p></div>
  <div class="card"><h2>2상품 비교 (단리보증형 vs 투자형)</h2>
    <table><thead><tr><th>상품</th><th>유형</th><th>최저보증</th><th>사업비</th><th>가정수익률</th><th>예상연금액</th></tr></thead><tbody>${rows || '<tr><td colspan=6 class="small">설계서 2개를 올려주세요</td></tr>'}</tbody></table>
    <div class="cmp" style="margin-top:14px"><div class="box a"><h3>🛡️ 단리보증형</h3>${esc(cmp.단리보증형) || '—'}</div><div class="box b"><h3>📈 투자형</h3>${esc(cmp.투자형) || '—'}</div></div>
  </div>
  <div class="card"><h2>수령 시뮬레이션 (예시)</h2>${barChart(prods)}${d.시뮬설명 ? `<p class="note">${esc(d.시뮬설명)}</p>` : ''}</div>
  <div class="card seong"><h2>성향별 추천</h2>
    <div class="row"><b>안정을 원하시면</b> — ${esc(seong.안정형) || '—'}</div>
    <div class="row"><b>수익을 원하시면</b> — ${esc(seong.투자형) || '—'}</div>
    ${seong.종합 ? `<div class="row"><b>종합 의견</b> — ${esc(seong.종합)}</div>` : ''}
  </div>
  <div class="card"><h2>꼭 확인하세요</h2><div class="gaji">${esc(d.고지 || '변액연금은 실적배당형으로 원금 손실이 발생할 수 있으며 예금자보호 대상이 아닙니다. 최저보증은 약관 조건 충족 시 적용됩니다.')}</div></div>
  ${d.요약 ? `<div class="card"><h2>한 줄 요약</h2><div style="background:#e8f4f2;border-left:4px solid var(--teal);border-radius:8px;padding:12px 14px;color:#134e4a;font-weight:600">${esc(d.요약)}</div></div>` : ''}
  <div class="foot">${esc(DISCLAIMER)}</div>
</div></body></html>`;
}

function toRows(d) {
  var rows = [['상품', '보험사', '유형', '최저보증', '사업비', '가정수익률', '예상연금액(예시)', '예상월연금(만원)']];
  (d.상품 || []).forEach(function (p) { rows.push([p.상품명, p.보험사, p.유형, p.최저보증, p.사업비, p.가정수익률, p.예상연금액, p.예상월연금_만원]); });
  return rows;
}

// 텍스트 응답에서 JSON 안전 파싱(코드펜스·잡텍스트 방어)
function parseJSON(txt) {
  var s = String(txt || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  try { return JSON.parse(s); } catch (e) {}
  var a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {} }
  return null;
}

/** 변액연금 설계서(PDF·이미지) 2개 → 표지 있는 연금 제안서. images=[{data:base64, mime}] */
async function analyzePension(input) {
  const { images, name } = input || {};
  const imgs = Array.isArray(images) ? images.filter((x) => x && x.data) : [];
  if (!imgs.length) throw new Error('연금 설계서(images)가 비어있음');

  const totalMB = imgs.reduce((s, im) => s + (im.data ? im.data.length * 0.75 : 0), 0) / (1024 * 1024);
  if (totalMB > 20) {
    return { ok: false, html: '', rows: [], error: 'too_large', report: `설계서 파일이 너무 커요(총 약 ${Math.round(totalMB)}MB). 최저보증·수익률·연금액이 보이는 핵심 페이지만 올려주세요.`, disclaimer: DISCLAIMER };
  }

  const content = []; const bad = [];
  imgs.forEach((im, i) => {
    const mime = String(im.mime || 'image/jpeg').toLowerCase();
    if (mime === 'application/pdf' || /pdf/.test(mime)) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: im.data } });
    } else if (/^image\//.test(mime)) {
      const mt = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime) ? mime : 'image/jpeg';
      content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: im.data } });
    } else { bad.push(`설계서 ${i + 1}(${mime || '알 수 없음'})`); return; }
    content.push({ type: 'text', text: `— 위는 연금 설계서 ${i + 1} 입니다.` });
  });
  if (!content.some((c) => c.type === 'document' || c.type === 'image')) {
    return { ok: false, html: '', rows: [], error: 'unreadable', report: `올려주신 파일을 읽지 못했어요(${bad.join(', ')}). 설계서는 이미지(jpg·png)나 PDF로 올려주세요.`, disclaimer: DISCLAIMER };
  }
  content.push({ type: 'text', text: '위 변액연금 설계서(들)를 비교해 지정한 JSON 하나만 출력해 주세요.' });

  let data = null;
  try {
    const r = await anthropic().messages.create({ model: ANSWER_MODEL, max_tokens: 8000, system: buildSystem(name), messages: [{ role: 'user', content }] });
    const txt = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    data = parseJSON(txt);
  } catch (e) {
    // ★크기·토큰 등 명백한 API 실패만 사용자 안내(파일 문제). 그 외/JSON 파싱 실패는 아래 "확인 필요" 고정 틀로.
    if (/too large|maximum|size|token|payload|400/i.test(e.message || '')) {
      return { ok: false, html: '', rows: [], error: e.message, report: '연금 설계서 분석 중 문제가 생겼어요 (설계서 PDF가 크거나 페이지가 많은 것 같아요 — 최저보증·수익률·연금액이 보이는 핵심 페이지만 올려보세요). 파일을 확인하고 다시 시도해 주세요.', disclaimer: DISCLAIMER };
    }
    data = null;
  }
  // ★대표 지시: LLM이 JSON을 못 뱉어도 날것 텍스트 대신 "확인 필요" 채운 고정 틀로(renderMd 날것 폴백 최소화). 항상 예쁜 제안서 틀을 반환.
  if (!data || typeof data !== 'object') {
    data = { 표지: {}, 노후공백: '설계서에서 내용을 확실히 읽지 못했어요. 최저보증·수익률·연금액이 보이는 페이지로 다시 올려주시면 정확히 채워드려요.', 상품: [], 비교: {}, 시뮬설명: '', 성향추천: {}, 고지: '', 요약: '' };
  }
  return { ok: true, html: renderHTML(data), rows: toRows(data), data, engine: ANSWER_MODEL, disclaimer: DISCLAIMER };
}

module.exports = { analyzePension, renderHTML, DISCLAIMER }; // renderHTML: 구조 미리보기/검증용 노출

if (require.main === module) {
  console.log('📊 연금분석제안비서 — 포맷: 표지 → 노후공백 → 2상품비교(단리보증 vs 투자형) → 수령 시뮬 막대그래프 → 성향별 추천');
  console.log('   LLM:', ANSWER_MODEL, '· 서버 저장 0 · 연금액=예시 · 원금손실/예금자보호 고지 포함');
}
