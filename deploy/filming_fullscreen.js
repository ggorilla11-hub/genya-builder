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
  if (!/명단|고객\s*목록|고객\s*리스트|리스트|목록|만기/.test(s)) return false;
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

module.exports = { wantsRoster, wantsScroll, wantsMonth, build, SHOW_COLS, _todayYM };
