// ─────────────────────────────────────────────────────────────
// pdf_skill.js — S-1 PDF 스킬 (독립 모듈, 한 줄 호출) ★v4 🛠️스킬창고 부품
// 무엇을·왜: 증권·약관·청구서 PDF "읽기"(텍스트/보장 추출) + "생성"(안내문·청구서 PDF).
// 사용: const { readPdf, makePdf } = require('.../pdf_skill');
//        const r = await readPdf('증권.pdf');           // {pages, text, covers}
//        await makePdf({title,subtitle,sections}, 'out.pdf');
// ★공통 자산(전 회원 공유) — 고객 데이터 아님(도구). /parksugeun 무접촉.
// ─────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { PDFParse } = require('pdf-parse');

const KR_FONT = 'C:\\Windows\\Fonts\\malgun.ttf';

/** PDF 읽기: 텍스트 + (자동차보험이면) 핵심 보장 추출 */
async function readPdf(input) {
  const buf = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  const parser = new PDFParse({ data: buf });
  const r = await parser.getText(); await parser.destroy();
  const text = (Array.isArray(r.pages) ? r.pages.map((p) => p.text !== undefined ? p.text : p).join('\n') : r.text || '').replace(/[ \t]+/g, ' ');
  const flat = text.replace(/\s+/g, ' ');
  const covers = [];
  ['대물', '자기신체사고', '자동차상해', '대인배상', '무보험', '긴급출동', '자기차량'].forEach((k) => {
    const i = flat.indexOf(k); if (i >= 0) covers.push({ 항목: k, 내용: flat.slice(i, i + 40).trim() });
  });
  return { pages: Array.isArray(r.pages) ? r.pages.length : undefined, chars: text.length, covers, text };
}

/** PDF 생성: {title, subtitle, sections:[{heading, lines:[]}]} → 한글 PDF 파일 */
function makePdf(spec, outPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 54 });
    doc.registerFont('KR', KR_FONT); doc.font('KR');
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    doc.fontSize(22).fillColor('#0B1F3A').text(spec.title || '문서');
    if (spec.subtitle) doc.moveDown(0.2).fontSize(11).fillColor('#666').text(spec.subtitle);
    doc.moveDown(0.8);
    (spec.sections || []).forEach((s) => {
      doc.fontSize(14).fillColor('#0F8A6E').text(s.heading || '');
      doc.moveDown(0.2).fontSize(11).fillColor('#1A1C1E');
      (s.lines || []).forEach((l) => doc.text('• ' + l, { indent: 6, lineGap: 2 }));
      doc.moveDown(0.6);
    });
    if (spec.footer) doc.moveDown(0.5).fontSize(9).fillColor('#999').text(spec.footer);
    doc.end();
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
  });
}

module.exports = { readPdf, makePdf };

// ── 자체 시연: 샘플 증권 읽기 + 안내 PDF 생성 ──
if (require.main === module) {
  (async () => {
    const SAMPLE = ''; // 배포: 셀프테스트 샘플 경로 제거
    console.log('[S-1 읽기] 샘플 증권 →');
    const r = await readPdf(SAMPLE);
    console.log(`  ${r.pages}p / ${r.chars}자 · 보장: ${r.covers.map((c) => c.항목).join(', ')}`);
    const out = path.join(__dirname, 'out', 'S1_고객안내문.pdf');
    await makePdf({
      title: '자동차보험 만기 안내',
      subtitle: '오원트금융연구소 · 지니야 자동 생성 (검토 후 발송)',
      sections: [
        { heading: '안내 말씀', lines: ['가입하신 자동차보험 만기가 다가와 안내드립니다.', '현재 보장을 점검하고, 필요 시 보완안을 준비했습니다.'] },
        { heading: '현재 보장(증권 기준)', lines: r.covers.map((c) => `${c.항목}: ${c.내용}`) },
        { heading: '다음 단계', lines: ['편하실 때 상담 일정을 잡아드립니다.', '※ 실제 수치·한도는 증권 원문 기준 — 상담 시 최종 확인.'] },
      ],
      footer: '본 문서는 지니야가 생성한 초안입니다. 발송 전 담당 설계사 검토 필수.',
    }, out);
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log(`[S-1 생성] ${out} (${kb}KB)`);
  })().catch((e) => { console.error('오류:', e.message); process.exit(1); });
}
