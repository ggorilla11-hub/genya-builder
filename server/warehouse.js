// ═══════════════════════════════════════════════════════════════════════════
// 🏭 발행창고 (1단계) — 캠페인 고르기 + 한줄카피 재료 넣기.
//
//   ★ 발행 무접촉. 이 파일엔 발행 함수도, 발행 호출도 없다.
//     예약표(발행예약)도 안 건드린다. 읽지도 쓰지도 않는다.
//   ★ 진실은 시트다. 화면은 시트를 비추기만 한다.
//     → 대표님이 시트에서 고치면 화면에 그대로 반영된다(배포 0).
//   ★ 캠페인 표를 코드에 안 박은 이유: 랜딩페이지가 새로 생겨도 대표님이 한 줄
//     추가하면 끝. 개발자·배포를 안 거친다.
// ═══════════════════════════════════════════════════════════════════════════

const CAMP_TAB = '캠페인';
const COPY_TAB = '한줄카피';
const MAX_COPIES = 60;   // 캠페인 1개 = 카피 60개

let _deps = null;   // { sheetsClient, sheetId }
function init(deps) { _deps = deps; }

const cell = (r, i) => String((r || [])[i] == null ? '' : (r || [])[i]).trim();

// ── 캠페인 표 읽기 ────────────────────────────────────────────────────────
//   FORMULA로 읽는 이유: 시트가 '+82…'·'=…' 같은 값을 수식으로 오해해 #ERROR!로
//   바꿔버려도 원문이 그대로 돌아온다(발행 스케줄러에서 실측으로 확인한 함정).
async function readCampaigns() {
  const sheets = _deps.sheetsClient();
  if (!sheets) throw new Error('구글 열쇠 없음');
  const got = await sheets.spreadsheets.values.get({
    spreadsheetId: _deps.sheetId, range: `'${CAMP_TAB}'!A2:G`, valueRenderOption: 'FORMULA',
  });
  return (got.data.values || [])
    .filter((r) => cell(r, 0) && cell(r, 1))            // ★2026-07-18 새 컬럼: 서비스·진단명 없는 줄은 무시
    .map((r) => ({
      // ★설계 컬럼: 서비스 | 진단명 | 콘텐츠주제 | 코드 | 진단URL(도착지) | 랜딩URL(최종목적지) | 상태
      service: cell(r, 0), name: cell(r, 1), contentTopic: cell(r, 2), code: cell(r, 3),
      diagUrl: cell(r, 4), landingUrl: cell(r, 5), status: cell(r, 6),
      // ★live 판정 = 진단URL(E)만 본다. 쇼츠가 보내는 도착지니까. 랜딩URL(F)은 없어도 live(표시만).
      live: cell(r, 6) === '활성' && /^https?:\/\//i.test(cell(r, 4)),
      key: [cell(r, 0), cell(r, 1), cell(r, 2)].join('/'),   // 캠페인 신원 = 서비스/진단명/콘텐츠주제
    }));
}

// ── 한줄카피 읽기 ─────────────────────────────────────────────────────────
async function readCopies(key) {
  const sheets = _deps.sheetsClient();
  if (!sheets) throw new Error('구글 열쇠 없음');
  const got = await sheets.spreadsheets.values.get({
    spreadsheetId: _deps.sheetId, range: `'${COPY_TAB}'!A2:E`, valueRenderOption: 'FORMULA',
  });
  return (got.data.values || [])
    .filter((r) => cell(r, 0) === key && cell(r, 2))
    .map((r) => ({ key: cell(r, 0), no: cell(r, 1), copy: cell(r, 2), status: cell(r, 3) || '대기', at: cell(r, 4) }))
    .sort((a, b) => String(a.no).localeCompare(String(b.no)));
}

// ── 업로드 파일 → 카피 배열 ───────────────────────────────────────────────
//   ★txt(한 줄에 하나)를 권장한다. csv·json도 받지만 함정이 있어 안내한다:
//     · csv: 좋은 카피일수록 쉼표가 들어간다("국민연금 68만원, 이걸로…") → 칸이 쪼개짐
//     · csv: 엑셀이 EUC-KR로 저장 → 서버가 UTF-8로 읽어 전부 깨짐
//     · json: 따옴표 하나 틀리면 60개가 통째로 안 들어감
//   그래서 어떤 형식이 와도 '한 줄 = 카피 하나'로 최대한 살려낸다.
function parseCopies(text, filename) {
  const raw = String(text || '');
  const name = String(filename || '').toLowerCase();

  // 한글이 깨진 채로 올라왔는지(EUC-KR을 UTF-8로 읽은 흔적) 감지
  const broken = /�/.test(raw);

  let lines = [];
  if (name.endsWith('.json') || /^\s*[[{]/.test(raw)) {
    try {
      const j = JSON.parse(raw);
      const arr = Array.isArray(j) ? j : (j.copies || j.list || j.items || []);
      lines = arr.map((x) => (typeof x === 'string' ? x : (x && (x.copy || x.text || x.카피)) || ''));
    } catch (e) {
      return { error: 'JSON 형식이 깨졌습니다(따옴표·쉼표 확인). txt로 올리시면 이런 문제가 없습니다.' };
    }
  } else {
    // txt·csv 공통: 한 줄 = 카피 하나. csv라도 쉼표로 쪼개지 않는다(카피 안의 쉼표를 지키려고).
    lines = raw.split(/\r?\n/);
  }

  const copies = lines
    .map((s) => String(s == null ? '' : s).trim())
    .map((s) => s.replace(/^["']|["']$/g, '').trim())      // 감싼 따옴표만 벗김
    .map((s) => s.replace(/^\d{1,3}[.)\t]\s*/, '').trim())  // "1. 카피" 같은 번호 매김 제거
    .filter(Boolean)
    .filter((s) => !/^(한줄카피|카피|copy|번호|no)$/i.test(s));   // 헤더줄 제거

  return { copies, broken };
}

// ── 카피 저장 (캠페인 것만 갈아끼움) ──────────────────────────────────────
//   ★같은 캠페인의 기존 카피를 지우고 새로 넣는다. 다른 캠페인 줄은 안 건드린다.
async function saveCopies(key, copies) {
  const sheets = _deps.sheetsClient();
  if (!sheets) throw new Error('구글 열쇠 없음');
  const got = await sheets.spreadsheets.values.get({
    spreadsheetId: _deps.sheetId, range: `'${COPY_TAB}'!A2:E`, valueRenderOption: 'FORMULA',
  });
  const all = got.data.values || [];
  const keep = all.filter((r) => cell(r, 0) !== key);   // 다른 캠페인 줄은 그대로 보존
  const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const rows = copies.slice(0, MAX_COPIES).map((c, i) => [key, String(i + 1).padStart(3, '0'), c, '대기', now]);

  await sheets.spreadsheets.values.clear({ spreadsheetId: _deps.sheetId, range: `'${COPY_TAB}'!A2:E` });
  const merged = [...keep, ...rows];
  if (merged.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: _deps.sheetId, range: `'${COPY_TAB}'!A2`,
      valueInputOption: 'RAW', requestBody: { values: merged },
    });
  }
  return { saved: rows.length, kept: keep.length, dropped: Math.max(0, copies.length - MAX_COPIES) };
}

module.exports = { init, readCampaigns, readCopies, parseCopies, saveCopies, CAMP_TAB, COPY_TAB, MAX_COPIES };
