// ─────────────────────────────────────────────────────────────
// docx_read.js — 📄 워드(.docx)에서 글자 뽑기 (독립 모듈)
//
// 무엇을·왜: +첨부로 워드 파일을 올리면 "곧 지원돼요"로 막혀 분석이 안 됐다.
//   증권·진단서·상담메모를 워드로 주고받는 일이 흔해서 이게 막히면 제안서까지 못 만든다.
//
// ★새 라이브러리를 안 쓴다: .docx는 사실 ZIP이고 안에 word/document.xml 이 들어 있다.
//   이미 설치된 jszip으로 풀어 XML에서 글자만 뽑는다(설치 실패·배포 리스크 0).
//   ※표는 셀 순서대로 한 줄씩 나온다. 서식·이미지는 빠진다(글자 분석엔 충분).
//
// 사용: const { readDocx } = require('./docx_read');
//        const text = await readDocx(buffer);   // 실패하면 예외
// ─────────────────────────────────────────────────────────────
'use strict';

// XML 조각을 사람이 읽는 글자로. 문단(w:p)·줄바꿈(w:br)·탭(w:tab)을 살린다.
function xmlToText(xml) {
  let s = String(xml || '');
  s = s.replace(/<w:tab\b[^>]*\/?>/g, '\t');
  s = s.replace(/<w:br\b[^>]*\/?>/g, '\n');
  s = s.replace(/<\/w:p>/g, '\n');            // 문단 끝 = 줄바꿈
  s = s.replace(/<\/w:tr>/g, '\n');           // 표의 행 끝도 줄바꿈
  s = s.replace(/<\/w:tc>/g, '\t');           // 표의 칸 사이는 탭
  s = s.replace(/<[^>]+>/g, '');              // 나머지 태그 제거
  // XML 이스케이프 복원
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');   // 빈 줄 정리
  return s.trim();
}

/** .docx 버퍼 → 본문 텍스트. 머리말·꼬리말도 있으면 뒤에 붙인다. */
async function readDocx(buf) {
  let JSZip;
  try { JSZip = require('jszip'); }
  catch (e) { throw new Error('워드 읽기 도구를 불러오지 못했어요'); }
  const zip = await JSZip.loadAsync(buf);
  const main = zip.file('word/document.xml');
  if (!main) throw new Error('워드 문서 본문을 찾지 못했어요(형식이 다를 수 있어요)');
  let text = xmlToText(await main.async('string'));
  // 머리말/꼬리말에 실제 내용이 들어 있는 양식도 있어 함께 뽑는다
  const extras = zip.file(/word\/(header|footer)\d*\.xml/) || [];
  for (const f of extras) {
    try { const t = xmlToText(await f.async('string')); if (t && t.length > 1) text += '\n' + t; } catch (e) {}
  }
  return text.trim();
}

module.exports = { readDocx, xmlToText };
