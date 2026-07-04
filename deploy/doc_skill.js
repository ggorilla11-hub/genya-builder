// ─────────────────────────────────────────────────────────────
// doc_skill.js — S-4 문서 스킬 (독립 모듈, 한 줄 호출) ★v4 🛠️스킬창고 부품
// 무엇을·왜: 상담 보고서·안내문(docx) 자동 생성.
// 사용: const { makeDoc } = require('.../doc_skill');
//        await makeDoc({title, subtitle, sections:[{heading, paras:[]}]}, 'out.docx');
// ★공통 자산(도구). 초안만 — 발송·제출은 사람 확인. /parksugeun 무접촉.
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx');
const FONT = '맑은 고딕';

async function makeDoc(spec, outPath) {
  const kids = [];
  kids.push(new Paragraph({ children: [new TextRun({ text: spec.title || '문서', bold: true, size: 40, font: FONT })] }));
  if (spec.subtitle) kids.push(new Paragraph({ children: [new TextRun({ text: spec.subtitle, size: 20, color: '666666', font: FONT })] }));
  kids.push(new Paragraph({ text: '' }));
  (spec.sections || []).forEach((s) => {
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: s.heading || '', bold: true, size: 26, color: '0F8A6E', font: FONT })] }));
    (s.paras || []).forEach((p) => kids.push(new Paragraph({ children: [new TextRun({ text: p, size: 22, font: FONT })] })));
    kids.push(new Paragraph({ text: '' }));
  });
  if (spec.footer) kids.push(new Paragraph({ children: [new TextRun({ text: spec.footer, italics: true, size: 18, color: '999999', font: FONT })] }));

  const doc = new Document({ sections: [{ properties: {}, children: kids }] });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

module.exports = { makeDoc };

// ── 자체 시연: 상담 보고서 생성 ──
if (require.main === module) {
  (async () => {
    const out = path.join(__dirname, 'out', 'S4_상담보고서.docx');
    await makeDoc({
      title: '고객 상담 보고서',
      subtitle: '오원트금융연구소 · 지니야 자동 생성 (검토용 초안)',
      sections: [
        { heading: '상담 개요', paras: ['일시: 상담일 기준', '주제: 자동차보험 보장분석 및 재설계 제안', '상담 방식: 대면/유선(해당 표시)'] },
        { heading: '현재 보장 요약', paras: ['증권 기준 3축(대물 한도 · 자기신체/자동차상해 · 빠진 특약)을 점검함.', '취약 항목과 보완 방향을 정리함(구체 수치는 증권 원문 기준).'] },
        { heading: '제안 내용', paras: ['A안: 현 보험사 보완 / B안: 우수사 이전 / C안: 재설계.', '각 안의 핵심 차이와 추천 1개를 한 장 요약으로 제시.'] },
        { heading: '다음 단계', paras: ['고객 최종 판단 후 진행(설계사는 검토 포인트 제시).', '필요 서류·일정 안내.'] },
      ],
      footer: '본 보고서는 지니야가 생성한 초안입니다. 발송·제출 전 담당 설계사 검토 필수.',
    }, out);
    const kb = Math.round(fs.statSync(out).size / 1024);
    const head = fs.readFileSync(out).slice(0, 2).toString('latin1');
    console.log(`[S-4 생성] ${out} (${kb}KB) · 매직=${head} (PK=정상 docx)`);
  })().catch((e) => { console.error('오류:', e.message); process.exit(1); });
}
