// ─────────────────────────────────────────────────────────────
// ppt_skill.js — S-3 PPT 스킬 (독립 모듈, 한 줄 호출) ★v4 🛠️스킬창고 부품
// 무엇을·왜: 세미나·제안서 슬라이드(pptx) 자동 생성.
// 사용: const { makeDeck } = require('.../ppt_skill');
//        await makeDeck({title, subtitle, slides:[{title, bullets:[]}]}, 'out.pptx');
// ★공통 자산(도구). 슬라이드 내용은 일반 금융지식/템플릿(개별 상품 단정 X). /parksugeun 무접촉.
// ─────────────────────────────────────────────────────────────
'use strict';
const path = require('path');
const pptxgen = require('pptxgenjs');
const FONT = '맑은 고딕';
const NAVY = '0B1F3A', TEAL = '0F8A6E', INK = '1A1C1E';

async function makeDeck(spec, outPath) {
  const p = new pptxgen();
  p.layout = 'LAYOUT_WIDE';

  // 표지
  const cover = p.addSlide();
  cover.background = { color: 'F4F7FA' };
  cover.addText(spec.title || '제안서', { x: 0.7, y: 2.2, w: 11.6, fontSize: 40, bold: true, color: NAVY, fontFace: FONT });
  if (spec.subtitle) cover.addText(spec.subtitle, { x: 0.7, y: 3.4, w: 11.6, fontSize: 18, color: TEAL, fontFace: FONT });
  cover.addText('오원트금융연구소 · 지니야 자동 생성', { x: 0.7, y: 6.6, fontSize: 12, color: '888888', fontFace: FONT });

  // 내용 슬라이드
  (spec.slides || []).forEach((s) => {
    const slide = p.addSlide();
    slide.addText(s.title || '', { x: 0.6, y: 0.5, w: 12, fontSize: 26, bold: true, color: NAVY, fontFace: FONT });
    slide.addShape(p.ShapeType.line, { x: 0.6, y: 1.4, w: 12.1, h: 0, line: { color: TEAL, width: 2 } });
    const bullets = (s.bullets || []).map((b) => ({ text: b, options: { bullet: { code: '2022' }, fontSize: 18, color: INK, fontFace: FONT, paraSpaceAfter: 10 } }));
    slide.addText(bullets, { x: 0.9, y: 1.8, w: 11.5, h: 5 });
  });

  await p.writeFile({ fileName: outPath });
  return outPath;
}

module.exports = { makeDeck };

// ── 자체 시연: 보장분석 제안 세미나 덱 생성 ──
if (require.main === module) {
  (async () => {
    const out = path.join(__dirname, 'out', 'S3_보장분석_제안세미나.pptx');
    await makeDeck({
      title: '내 보험, 제대로 됐을까?',
      subtitle: '보장분석 무료 점검 세미나',
      slides: [
        { title: '왜 점검이 필요할까요', bullets: ['보장 공백 — 정작 필요할 때 안 나오는 경우', '과보험·중복 — 매달 새는 보험료', '시대 변화 — 고가차·전기차, 늘어난 병원비'] },
        { title: '이렇게 도와드립니다', bullets: ['현재 증권 3축 점검(대물 한도·자상 전환·빠진 특약)', '보완안 + 왜 그런지 이유까지', '2~3개사 비교표로 한눈에'] },
        { title: '다음 단계', bullets: ['오늘 증권만 주시면 무료로 분석해 드립니다', '결과는 한 장 요약 + 추천 1개', '※ 최종 판단은 고객님 — 저는 검토 포인트만'] },
      ],
    }, out);
    const fs = require('fs');
    const kb = Math.round(fs.statSync(out).size / 1024);
    // 검증: pptx=zip(PK 매직)
    const head = fs.readFileSync(out).slice(0, 2).toString('latin1');
    console.log(`[S-3 생성] ${out} (${kb}KB) · 매직=${head} (PK=정상 pptx) · 슬라이드 4장(표지+3)`);
  })().catch((e) => { console.error('오류:', e.message); process.exit(1); });
}
