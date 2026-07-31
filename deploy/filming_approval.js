// ─────────────────────────────────────────────────────────────
// filming_approval.js — 🎬 촬영용 결재함 (메모리)
//
// 무엇을·왜: 촬영 씬5·6에서 "결재함에 올려" → 실제로 8건이 쌓이고, 승인까지 눌러 봐야 한다.
//   그런데 본 결재함은 구글 시트에 쓴다 → 촬영 모드는 구글을 안 부르므로 저장이 실패했다.
//   그래서 ★명단(filming_roster)에서 이미 검증된 방식 그대로, 메모리 저장소를 하나 붙인다.
//
// ★안전:
//   - approval_skill 의 setSource(box) 훅에만 꽂힌다. 훅이 없으면(라이브) 본 코드가 그대로 구글로 간다.
//   - 구글을 아예 안 부른다. 실제 결재함 시트에 촬영 흔적이 남지 않는다.
//   - 서버를 껐다 켜면 비워진다(촬영 리허설 반복 가능).
//   - ★발송 하드가드(승인 버튼 이중 채널·403 차단)는 여기서 손대지 않는다 — 저장소만 바꾼다.
// ─────────────────────────────────────────────────────────────
'use strict';

let _rows = null;   // [헤더행, 자료행, 자료행 …] — 시트 values 와 같은 모양

function enable(approval) {
  if (!approval || typeof approval.setSource !== 'function') throw new Error('filming_approval: setSource 없는 approval');
  _rows = [approval.HEADER.slice()];
  approval.setSource({
    values: () => _rows,
    append: (row) => { _rows.push(row.slice()); },
    // _rowNum 은 1-based 시트 행번호(헤더=1) → 배열 인덱스는 -1
    update: (rowNum, row) => { const i = Number(rowNum) - 1; if (i > 0 && i < _rows.length) _rows[i] = row.slice(); },
  });
  console.log('[🎬촬영결재함] 메모리 결재함 켜짐 (구글 시트 접근 0 · 실제 결재함 무접촉)');
  return true;
}

/** 시험·진단용 — 지금 몇 건 쌓였는지 */
function count() { return _rows ? Math.max(0, _rows.length - 1) : 0; }
function rows() { return _rows ? _rows.slice(1) : []; }
function reset() { if (_rows) _rows = [_rows[0]]; }

module.exports = { enable, count, rows, reset };
