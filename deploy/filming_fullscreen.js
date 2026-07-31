// ─────────────────────────────────────────────────────────────
// filming_fullscreen.js — 🎬 촬영 B-2 · 전체 화면 명단 (독립 모듈)
//
// 무엇을·왜: "명단 띄워봐" 했을 때 대화 말풍선 안 작은 글씨가 아니라
//   ★화면 가득 큰 표로 띄운다. 뒤에서 풀샷으로 찍어도 읽히게.
//   (대표님 원칙: 촬영용 가짜 화면이 아니라 실제로 쓸모 있는 기능이다.
//    설계사가 명단을 크게 볼 때도 그대로 쓴다.)
//
// 이 파일이 하는 일은 딱 하나 — 말이 "명단 띄워달라"는 뜻인지 판단하고,
//   화면이 그릴 수 있는 표 데이터를 만들어 준다. 서버 라우터는 손대지 않는다.
//
// ★안전: 이 모듈은 FILMING_MODE=1 일 때만 require 된다(main_server 부팅부).
//   라이브(메인·교육생)에서는 읽히지도 않으므로 화면·동작이 그대로다.
// ─────────────────────────────────────────────────────────────
'use strict';

// ★맨 앞에 오는 칸(대표님이 먼저 보길 원하는 순서). 나머지 칸은 이 뒤에 원래 순서대로 다 붙는다.
//   (전엔 이 5칸만 보냈는데, 2026-07-31 지시로 ★20칸 전부 보내고 가로 스크롤로 넘겨보게 바뀜)
const SHOW_COLS = ['번호', '고객명', '가입상품', '보험사', '만기일'];

/** "명단 띄워봐" 류인가 — 말투 흔들려도 잡히게 넓게 본다. */
function wantsRoster(q) {
  const s = String(q || '');
  // ★"시트 보여줘"도 명단 요청이다(2026-07-31 대표님 지시). 촬영 모드에선 이 80명이 곧 시트다.
  if (!/명단|시트|스프레드시트|엑셀|고객\s*목록|고객\s*리스트|리스트|목록|만기|고객\s*전체|전체\s*고객/.test(s)) return false;
  // "띄워/보여/열어/올려/펼쳐" 같은 화면에 띄우라는 말이 있어야 전체 화면을 연다.
  // (그냥 "명단 몇 명이야" 같은 질문은 지금처럼 말로만 답한다)
  return /띄워|띄우|보여|열어|열어봐|펼쳐|크게|전체\s*화면|풀\s*화면|화면에/.test(s);
}

/**
 * ★말로 명단 밀기 — "우측으로 밀어봐"·"아래로 내려봐" (2026-07-31 대표님 지시)
 * 손 안 대고 말로 표를 조작한다. 방향을 못 알아들으면 null(=평소대로 대화).
 * @returns {{dir:string}|null}  dir: right|left|down|up|end|start|bottom|top
 */
function wantsScroll(q) {
  const s = String(q || '').replace(/\s+/g, ' ');
  // 표를 움직이라는 뜻의 말이 있어야 한다. (그냥 "오른쪽 사람" 같은 말에 반응하면 안 된다)
  if (!/밀어|밀기|밀|넘겨|넘기|스크롤|내려|올려|가봐|가 봐|이동|보여줘|봐/.test(s)) return null;
  // 명단 얘기가 아닌 게 확실하면 뺀다(예: 캘린더·발굴 화면 조작은 이 기능이 아니다)
  if (/발굴|캘린더|일정|결재|약관/.test(s)) return null;

  const 끝 = /맨\s*(끝|오른쪽|우측)|끝까지|제일\s*(끝|오른쪽|우측)/.test(s);
  const 처음 = /맨\s*(앞|처음|왼쪽|좌측)|처음으로|제일\s*(앞|왼쪽|좌측)/.test(s);
  const 맨아래 = /맨\s*(아래|밑|마지막)|끝까지\s*내려|마지막까지/.test(s);
  const 맨위 = /맨\s*위|처음\s*으로\s*올려|위로\s*끝까지/.test(s);

  // ★"맨 끝까지"처럼 방향 단어 없이 끝만 말할 때가 있다 → 끝/처음을 먼저 본다.
  if (맨아래) return { dir: 'bottom' };
  if (맨위) return { dir: 'top' };
  if (끝) return { dir: 'end' };
  if (처음) return { dir: 'start' };

  if (/(오른쪽|우측|우로|right)/.test(s)) return { dir: 'right' };
  if (/(왼쪽|좌측|좌로|left)/.test(s)) return { dir: 'left' };
  if (/(아래|밑|다음|내려)/.test(s)) return { dir: 'down' };
  if (/(위로|윗|이전|올려)/.test(s)) return { dir: 'up' };
  // 방향 없이 "더 밀어봐"·"더 보여줘" → 오른쪽(칸 더 보기)이 기본
  if (/더\s*(밀어|넘겨|보여|봐)/.test(s)) return { dir: 'right' };
  return null;
}

/**
 * ★B-5 카드 순회 — "다음"·"이전" (2026-07-31 대표님 지시)
 * "김철수 카드 띄워" 다음에 "다음" 하면 이영희 → 최동욱 … 순서대로 넘어간다.
 * @returns {'next'|'prev'|null}
 */
function wantsStep(q) {
  const s = String(q || '').trim().replace(/\s+/g, ' ');
  if (!s || s.length > 20) return null;                 // 긴 문장은 순회 명령이 아니다

  // ★"다음 달 만기"·"다음 주 일정" 처럼 시간을 뜻하는 '다음'은 순회가 아니다.
  if (/다음\s*(달|주|월|해|년|분기|번에|에는|엔)/.test(s)) return null;
  // 명단을 통째로 띄우라는 말과도 겹치지 않게 한다.
  if (/명단|시트|전체|목록|리스트|8명|띄워|보여줘/.test(s)) return null;

  // ★"다음"이 들어가면 카드 순회다(2026-07-31 대표님 지시).
  //   "다음카드"·"다음 고객카드"·"다음 사람"·"다음 거"·"다음 분"·"다음이요" 전부 포함.
  //   전엔 목록에 딱 맞는 말만 잡아서 대표님이 조금만 달리 말하면 못 알아들었다.
  if (/(^|\s)(다음|담)([\s가-힣]{0,6})?$|^다음\b|넘겨|넘어가|next/.test(s)) return 'next';
  if (/(^|\s)(이전|전|앞)([\s가-힣]{0,6})?$|^이전\b|뒤로|되돌|back|prev/.test(s)) return 'prev';
  return null;
}

/**
 * ⚠️ 옛 지름길 판별기 — 2026-07-31 "길 합치기"로 ★서버에서 더 이상 부르지 않는다.
 *   낱말 규칙으로 칸 이름을 뽑다가 "출산했으니" 같은 오인식을 냈다.
 *   지금은 ★LLM이 이름을 뽑는다(sheets_crud_skill 도구호출). 여기에 손대지 말 것.
 *   시험 호환을 위해 남겨만 둔다.
 */
function wantsAddField(q, names) {
  const s = String(q || '').trim();
  if (!s) return null;
  // ★발송은 절대 여기로 오면 안 된다(승인 필수 영역).
  if (/문자|메일|이메일|카톡|알림톡|발송|보내|결재|승인해\s*줘/.test(s)) return null;
  // 항목을 만들라는 말인가
  if (!/(칸|컬럼|항목|필드)\s*(을|를)?\s*(추가|만들|생성|넣)|추가해|기록해|업데이트|적어|남겨/.test(s)) return null;

  // 대상 고객: 문장에 이름이 있으면 그 사람. 없으면 화면이 알려준 "지금 보는 고객".
  let 대상 = '';
  (names || []).forEach((n) => { if (n && s.includes(n)) 대상 = n; });

  // 항목 이름 뽑기: "○○ 컬럼/항목/칸 추가" 또는 "○○했으니 추가"
  let 칸 = '';
  // ★"출산했으니 컬럼 추가"를 먼저 본다 — 안 그러면 "출산했으니" 통째가 칸 이름이 된다(실측으로 잡음).
  let m = s.match(/([가-힣]{2,10}?)\s*(?:했으니|해서|하셔서|하셨으니)/);
  if (m) 칸 = m[1];
  if (!칸) { m = s.match(/([가-힣A-Za-z0-9()·\s]{1,12}?)\s*(?:칸|컬럼|항목|필드)\s*(?:을|를)?\s*(?:추가|만들|생성|넣)/); if (m) 칸 = m[1]; }
  if (!칸) { m = s.match(/([가-힣]{2,10})\s*(?:을|를)\s*(?:추가|기록|남겨|적어)/); if (m) 칸 = m[1]; }
  if (!칸) return null;

  // 대상 이름이 항목명에 섞여 들어온 경우 떼어낸다("이영희 득남출산 컬럼" → "득남출산")
  if (대상) 칸 = 칸.split(대상).join('');
  칸 = 칸.replace(/^(그냥|바로|지금|좀)\s*/g, '').replace(/님\s*$/, '').trim();
  if (!칸 || 칸.length > 12) return null;

  // 값: "오늘 날짜"면 오늘, 아니면 'O' 표시
  const 오늘 = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const 값 = /오늘|금일|today/.test(s) ? 오늘 : 오늘;   // 이벤트 기록은 날짜가 기본
  return { 칸, 대상, 값 };
}

/** 오늘(한국시간) 'YYYY-MM'. 시험에서 날짜를 고정할 수 있게 인자로 덮어쓸 수 있다. */
function _todayYM() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7); }

/** 명단에 실제로 있는 만기 달 목록(중복 제거·오름차순) — 지어내지 않는다. */
function _months(rows) {
  const set = new Set();
  (rows || []).forEach((r) => { const v = String(r['만기일'] || ''); if (/^\d{4}-\d{2}/.test(v)) set.add(v.slice(0, 7)); });
  return [...set].sort();
}

/**
 * "8월 만기 띄워봐" 처럼 특정 달을 지목했는가 → 'YYYY-MM' 또는 null.
 * ★연도는 명단에 실제로 있는 값에서 고르되, ★오늘 이후(앞으로 올 만기)를 먼저 본다.
 *   (예전엔 그냥 가장 이른 연도를 골라 2021년 만기를 집어왔다 — 지난 만기를 "챙길 고객"으로 보여주던 결함)
 */
function wantsMonth(q, rows, todayYM) {
  const s = String(q || '');
  const m = s.match(/(\d{1,2})\s*월\s*만기|만기\s*(\d{1,2})\s*월/);
  if (!m) return null;
  const mm = String(Number(m[1] || m[2])).padStart(2, '0');
  const t = todayYM || _todayYM();
  const cands = _months(rows).filter((ym) => ym.slice(5, 7) === mm);
  if (!cands.length) return null;
  const 앞으로 = cands.filter((ym) => ym >= t);
  return 앞으로.length ? 앞으로[0] : cands[cands.length - 1]; // 앞으로 없으면 가장 최근 지난 것
}

/**
 * 화면에 그릴 표를 만든다.
 * @param {object} table  loadTable() 결과 {header, rows, nameCol}
 * @param {string} q      사용자가 한 말
 * @returns {object|null} { title, subtitle, cols, rows[], hi[], total, focusLabel }
 */
function build(table, q, todayYM) {
  if (!table || !Array.isArray(table.rows) || !table.rows.length) return null;
  const header = table.header || [];
  // ★칸을 전부 보낸다. 핵심 5칸을 앞으로 당기고, 나머지는 명단에 있는 순서 그대로 뒤에 붙인다.
  //   명단에 없는 칸은 만들지 않는다(지어내기 금지).
  const 앞 = SHOW_COLS.filter((c) => header.includes(c));
  const cols = 앞.concat(header.filter((h) => h && !앞.includes(h)));
  if (cols.length < 2) return null;

  const all = table.rows;
  const today = todayYM || _todayYM();
  const month = wantsMonth(q, all, today);

  // 강조 대상: 특정 달을 물었으면 그 달, 아니면 "앞으로 가장 가까운 만기 달"
  const hiMonth = month || _nearestMonth(all, today);

  // ★"만기"를 물으면 그 달 사람만 뽑는다(2026-07-31 대표님 정정: "만기 8명 띄워" → 8명만).
  //   "명단 띄워봐"처럼 만기 얘기가 없으면 전체를 보여주고 다가올 만기만 강조한다.
  const 만기질의 = /만기|갱신|임박/.test(String(q || ''));
  const 대상 = (만기질의 && hiMonth)
    ? all.filter((r) => String(r['만기일'] || '').startsWith(hiMonth))
    : all;
  const 골랐나 = 대상.length !== all.length;

  const rows = 대상.map((r, i) => {
    const o = {};
    cols.forEach((c) => { o[c] = String(r[c] || ''); });
    if (!o['번호']) o['번호'] = String(i + 1);
    o._hi = !!(hiMonth && String(r['만기일'] || '').startsWith(hiMonth));
    return o;
  });
  // 강조 대상이 위로 오게(전체를 보여줄 때만 의미 있다)
  if (!골랐나) rows.sort((a, b) => (b._hi ? 1 : 0) - (a._hi ? 1 : 0) || Number(a['번호'] || 0) - Number(b['번호'] || 0));

  const hiCount = rows.filter((r) => r._hi).length;
  const 달표기 = hiMonth ? `${Number(hiMonth.slice(5, 7))}월` : '';
  return {
    title: 골랐나 ? `${달표기} 만기 고객` : '고객 명단',
    subtitle: 골랐나 ? `${rows.length}명` : `전체 ${all.length}명`,
    focusLabel: (!골랐나 && hiCount) ? `${달표기} 만기 ${hiCount}명` : '',
    cols, rows, total: all.length, hiCount,
    picked: 골랐나, month: hiMonth || '',
  };
}

/**
 * ★앞으로 다가올 만기 중 가장 가까운 달 — 강조 기준. 없으면 null(강조 안 함).
 * 지난 만기(예: 2021년)를 "챙길 고객"으로 강조하면 안 된다.
 */
function _nearestMonth(rows, todayYM) {
  const t = todayYM || _todayYM();
  const 앞으로 = _months(rows).filter((ym) => ym >= t);
  return 앞으로.length ? 앞으로[0] : null;
}

/**
 * ★B-5 순회 대상 — 다가올(또는 지목한) 만기 달 고객을 명단 순서대로.
 * 이름만 준다(개인정보 최소). 화면이 이 순서로 카드를 넘긴다.
 * ★B-6 대비: 항목이 늘어나도 이 함수는 이름 순서만 다루므로 영향 없다.
 */
function stepOrder(table, q, todayYM) {
  if (!table || !Array.isArray(table.rows)) return [];
  const today = todayYM || _todayYM();
  const ym = wantsMonth(q, table.rows, today) || _nearestMonth(table.rows, today);
  const 대상 = ym ? table.rows.filter((r) => String(r['만기일'] || '').startsWith(ym)) : table.rows;
  const nameCol = table.nameCol || '고객명';
  return 대상.map((r) => String(r[nameCol] || '').trim()).filter(Boolean);
}

/**
 * ★촬영 모드 두뇌 주입 (2026-07-31 대표님 지시)
 * 촬영 모드에선 이 80명이 곧 지니야의 시트다. 그래서 일반 대화에서도
 * "시트가 없어요"·"업로드하세요"·"조회 결과가 없어요" 같은 말을 하면 안 된다.
 * → 시스템 프롬프트에 붙일 명단 사실을 만들어 준다. ★값은 명단에서 그대로 읽는다(지어내지 않음).
 */
function brainContext(table, todayYM) {
  if (!table || !Array.isArray(table.rows) || !table.rows.length) return '';
  const today = todayYM || _todayYM();
  const ym = _nearestMonth(table.rows, today);
  const 곧만기 = ym ? table.rows.filter((r) => String(r['만기일'] || '').startsWith(ym)) : [];
  const nameCol = table.nameCol || '고객명';
  const 줄 = (r) => (table.header || []).map((h) => `${h}:${r[h] || ''}`).join(' · ');

  let s = '\n[고객 명단 — 지금 연결되어 있는 실제 데이터]\n';
  s += `당신(지니야)에게는 고객 명단이 ★이미 연결돼 있다. 전체 ${table.rows.length}명, 항목 ${(table.header || []).length}개(${(table.header || []).join('·')}).\n`;
  s += `★"시트가 없다"·"연결해 달라"·"업로드해 달라"·"조회 결과가 이 대화에 없다"는 말을 절대 하지 마라 — 명단은 아래에 다 있다.\n`;
  if (곧만기.length) {
    s += `다가오는 만기: ${Number(ym.slice(5, 7))}월 ${곧만기.length}명 — ${곧만기.map((r) => r[nameCol]).join(', ')}\n`;
    s += '그 ' + 곧만기.length + '명의 전체 값:\n';
    곧만기.forEach((r, i) => { s += `  ${i + 1}) ${줄(r)}\n`; });
  }
  // 나머지는 이름·상품·만기일만(프롬프트가 너무 길어지지 않게). 물어보면 이 안에서 답한다.
  const 나머지 = table.rows.filter((r) => !곧만기.includes(r));
  if (나머지.length) {
    s += `나머지 ${나머지.length}명(이름 · 가입상품 · 만기일):\n`;
    나머지.forEach((r) => { s += `  ${r[nameCol]} · ${r['가입상품'] || ''} · ${r['만기일'] || ''}\n`; });
  }
  s += '★이 명단에 없는 고객·값은 지어내지 마라. 명단에 없으면 "명단에 없어요"라고 말한다.\n';
  return s;
}

module.exports = { wantsRoster, wantsScroll, wantsStep, stepOrder, wantsMonth, wantsAddField, build, brainContext, SHOW_COLS, _todayYM };
