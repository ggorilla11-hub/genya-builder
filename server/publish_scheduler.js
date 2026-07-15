// ═══════════════════════════════════════════════════════════════════════════
// 📅 발행 스케줄러 — 예약표(제니야_발행관제)를 읽어 "지금 발행할 것"을 찾는 두뇌.
//
// ★ 이 파일은 읽기 전용이다. 발행 함수가 아예 없다(작업 3 단계).
// ★ 기존 9시 유튜브·인스타 자동발행 경로와 완전 별개. 그 코드는 한 글자도 안 건드린다.
// ★ 예외는 밖으로 안 나간다(server.js에서 독립 try/catch로 한 번 더 감쌈).
//
// 시계는 이 파일 밖에 있다(server.js의 별도 setInterval). 시계를 바꿔도 여기는 안 바뀐다.
// ═══════════════════════════════════════════════════════════════════════════

const PUB_SHEET_ID = process.env.PUB_SHEET_ID || '1PmV9Xqt1v6eDZQ6p0av2rqZNyIH_XmUAjFCj1rYYvaY';
const RESV_TAB_NAME = '발행예약';
const TOKEN_TAB_NAME = '발행채널토큰';
const TOKEN_HEADER = ['채널ID', '채널명', '토큰(암호화)', '연결일시', '상태'];

// ★ 자물쇠. 실제 발행은 대표님이 눈으로 확인한 뒤 작업 4에서 연다.
//   지금은 발행 함수 자체가 없으므로 이게 열려도 아무것도 안 나간다(2중 안전).
const DRY_RUN = true;

const STUCK_MIN = 30;   // '발행중'이 이만큼 멈춰 있으면 사람이 봐야 함

// 예약표 컬럼 = 시트와 1:1. ★여기 바꾸면 아래 WRITE_RANGE도 같이 바꿀 것.
const C = { id: 0, when: 1, ch: 2, kind: 3, content: 4, media: 5, title: 6, caption: 7,
            link: 8, tag: 9, tags: 10, vis: 11, status: 12, pubAt: 13, url: 14, verify: 15, memo: 16 };
// 서버가 쓰는 칸 = 상태~메모(M~Q). 대표님이 채우는 A~L은 절대 안 건드린다.
const WRITE_FROM = 'M', WRITE_TO = 'Q';
// 시트가 수식으로 오해할 수 있는 글자 칸 → FORMULA로 읽어 원문 복구(실측 검증됨)
const TEXT_COLS = [C.id, C.ch, C.kind, C.content, C.media, C.title, C.caption, C.link, C.tag, C.tags, C.vis, C.status, C.url, C.verify, C.memo];

let _deps = null;   // { sheetsClient, encToken, decToken }
function init(deps) { _deps = deps; }

// ── ★ 3-4 폴백 규칙 — 어느 토큰을 쓸지 정하는 '단 하나의' 규칙 ──────────────
//   순수 함수(시트·네트워크 안 탐) → 밖에서 시험할 수 있다. server.js의 ytClient()가 이걸 쓴다.
//   규칙: ① 채널ID를 줬고 그 채널 토큰이 있으면 그걸 쓴다
//        ② 아니면(채널ID 없음·모르는 채널·적재 실패·빈 탭) 기존 전역 토큰으로 복귀
//        ③ 그것도 없으면 null (호출부가 '연결 안 됨'으로 처리)
//   → 기존 9시 발행은 ytClient()를 인자 없이 부르므로 항상 ②·기존과 100% 동일.
function pickToken(channelId, channelTokens, globalToken) {
  const t = channelId && channelTokens && channelTokens[channelId];
  return t || globalToken || null;
}

// ── 시트가 대표님 입력을 바꾸는 함정들(전부 실측 확인) ────────────────────────
//   · "09:00" → "9:00"          (0이 떨어짐)
//   · "2026. 7. 20" / "2026/7/20" / "오전 9:00"  (대표님이 칠 수 있는 다른 형식)
//   · 시간 없이 날짜만 → 몇 시인지 모름 = 멋대로 0시 발행 금지, 오류로 잡아 알림
function parseKST(s) {
  const t = String(s == null ? '' : s).trim();
  const m = t.match(/^(\d{4})\D{1,2}(\d{1,2})\D{1,2}(\d{1,2})\D{1,2}(?:(오전|오후|AM|PM)\s*)?(\d{1,2}):(\d{2})/i);
  if (!m) return null;
  let [, y, mo, d, ap, h, mi] = m;
  h = +h;
  if (ap) { const pm = /오후|PM/i.test(ap); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return new Date(Date.UTC(+y, +mo - 1, +d, h - 9, +mi));   // KST = UTC+9
}
const fmtKST = (dt) => new Date(dt.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const isBroken = (v) => /^#(ERROR!|REF!|VALUE!|NAME\?|N\/A|DIV\/0!)/.test(String(v == null ? '' : v).trim());

// ── 예약표 읽기 ───────────────────────────────────────────────────────────
//   두 번 읽는다:
//   ① 보통 읽기  = 날짜 칸(시트가 예쁘게 포맷한 값이 필요)
//   ② FORMULA 읽기 = 글자 칸. 대표님이 "+82 10-…"·"=1+1"을 치면 시트가 수식으로 바꿔
//      보통 읽기엔 #ERROR!·계산결과가 오는데, FORMULA로 읽으면 원문이 그대로 온다(실측).
//      → 대표님이 따옴표 같은 규칙을 외울 필요가 없다.
async function readRows() {
  const sheets = _deps.sheetsClient();
  if (!sheets) throw new Error('구글 열쇠 없음');
  const range = `'${RESV_TAB_NAME}'!A2:Q`;   // ★꼬리표 추가로 P→Q. 컬럼 늘리면 여기도 늘릴 것.
  const [plain, formula] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: PUB_SHEET_ID, range }),
    sheets.spreadsheets.values.get({ spreadsheetId: PUB_SHEET_ID, range, valueRenderOption: 'FORMULA' }),
  ]);
  const a = plain.data.values || [], b = formula.data.values || [];
  const n = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const pr = a[i] || [], fr = b[i] || [];
    const row = pr.slice();
    for (const k of TEXT_COLS) if (fr[k] !== undefined) row[k] = fr[k];   // 글자 칸은 원문 우선
    out.push(row.length || pr.length ? row : []);
  }
  return out;
}

async function findDue(now) {
  const rows = await readRows();
  const due = [], waiting = [], bad = [], stuck = [];
  const cell = (r, i) => String(r[i] == null ? '' : r[i]).trim();   // ★ 시트는 공백을 보존한다 → 무조건 털어낸다

  rows.forEach((r, i) => {
    const rowNo = i + 2;
    if (!r || !r.length) return;                    // 중간 빈 행 — 건너뛰되 뒤는 계속 읽힘(실측)

    const status = cell(r, C.status);
    const ch = cell(r, C.ch);
    const id = cell(r, C.id);
    const label = `${ch || '?'} / ${cell(r, C.content) || cell(r, C.title) || '(내용없음)'}`;

    if (status === '발행중') {
      const since = parseKST(cell(r, C.pubAt));
      if (since && (now - since) / 60000 > STUCK_MIN) stuck.push({ rowNo, id, label });
      return;
    }
    if (status !== '대기') return;                   // 완료·실패·보류는 대상 아님

    const brokenAt = [C.when, C.ch, C.content, C.title, C.caption, C.link].filter((k) => isBroken(r[k]));
    if (brokenAt.length) { bad.push({ rowNo, id, label, why: '시트가 값을 깨뜨림 — 그 칸을 다시 입력해 주세요' }); return; }

    const when = parseKST(cell(r, C.when));
    if (!when) {
      const raw = cell(r, C.when);
      bad.push({ rowNo, id, label, why: raw ? `예약일시를 못 읽음: "${raw}" (예: 2026-07-20 09:00)` : '예약일시가 비어 있음' });
      return;
    }
    (when <= now ? due : waiting).push({ rowNo, id, label, when, ch, content: cell(r, C.content), job: toJob(r, cell) });
  });

  return { total: rows.length, due, waiting, bad, stuck };
}

// ── ★ 예약ID 기준 쓰기 (행번호로 쓰면 안 되는 이유) ─────────────────────────
//   읽고→발행하고→쓰는 사이는 몇 초~몇 분이다. 그 사이 대표님이 위쪽 행을 하나 지우면
//   행번호가 밀려서 '완료'가 엉뚱한 행에 찍힌다(안 나간 게 나갔다고 표시되고, 나간 건 또 나감).
//   → 쓰기 직전에 예약ID로 그 행을 '다시 찾아' 번호를 확인하고, 못 찾으면 안 쓴다.
//   ※ 작업 3에서는 호출하지 않는다(읽기 전용). 작업 4 발행 붙일 때 쓴다.
async function findRowById(id) {
  if (!id) return -1;
  const sheets = _deps.sheetsClient();
  const got = await sheets.spreadsheets.values.get({ spreadsheetId: PUB_SHEET_ID, range: `'${RESV_TAB_NAME}'!A2:A`, valueRenderOption: 'FORMULA' });
  const ids = (got.data.values || []).map((r) => String((r || [])[0] == null ? '' : r[0]).trim());
  const i = ids.indexOf(String(id).trim());
  return i < 0 ? -1 : i + 2;
}

// ── 채널별 토큰 (3-2·3-3) ────────────────────────────────────────────────
//   기존 '제니야_유튜브토큰' 탭은 절대 안 지운다. 복사만 한다.
//   토큰은 AES-256-GCM 암호문으로만 시트에 넣는다(기존 GOOGLE_TOKEN_KEY 패턴 재사용).
async function ensureTokenTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: PUB_SHEET_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === TOKEN_TAB_NAME)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: PUB_SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: TOKEN_TAB_NAME } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId: PUB_SHEET_ID, range: `'${TOKEN_TAB_NAME}'!A1`, valueInputOption: 'RAW', requestBody: { values: [TOKEN_HEADER] } });
  }
}

// 시트 → { 채널ID: refresh_token } (복호화). 실패하면 {} → 호출부가 기존 전역 토큰으로 폴백.
async function loadChannelTokens() {
  const sheets = _deps.sheetsClient(); if (!sheets) return {};
  const got = await sheets.spreadsheets.values.get({ spreadsheetId: PUB_SHEET_ID, range: `'${TOKEN_TAB_NAME}'!A2:E`, valueRenderOption: 'FORMULA' });
  const out = {};
  for (const r of (got.data.values || [])) {
    const id = String((r || [])[0] || '').trim(), enc = String((r || [])[2] || '').trim();
    if (!id || !enc || enc === '(미이관)') continue;
    try { out[id] = _deps.decToken(enc); } catch (e) { /* 복호화 실패한 행은 없는 셈 → 폴백 */ }
  }
  return out;
}

// 기존 탭 → 새 탭 '복사'(이사 아님). 이미 이관돼 있으면 아무것도 안 한다(여러 번 돌려도 안전).
async function migrateToken({ oldSheetId, oldTab, channelId, channelName, plainToken }) {
  const sheets = _deps.sheetsClient(); if (!sheets) return { ok: false, why: '구글 열쇠 없음' };
  await ensureTokenTab(sheets);

  const cur = await loadChannelTokens();
  if (cur[channelId]) return { ok: true, already: true, why: '이미 이관됨 — 건너뜀' };
  if (!plainToken) return { ok: false, why: '기존 토큰이 비어 있음' };

  let enc;
  try { enc = _deps.encToken(plainToken); }
  catch (e) { return { ok: false, why: 'GOOGLE_TOKEN_KEY 미설정 — 암호화 불가(기존 발행은 폴백으로 계속 정상)' }; }

  const got = await sheets.spreadsheets.values.get({ spreadsheetId: PUB_SHEET_ID, range: `'${TOKEN_TAB_NAME}'!A2:A`, valueRenderOption: 'FORMULA' });
  const ids = (got.data.values || []).map((r) => String((r || [])[0] || '').trim());
  const at = ids.indexOf(channelId);
  const row = [channelId, channelName, enc, new Date().toISOString().slice(0, 16).replace('T', ' '), '정상'];

  if (at >= 0) await sheets.spreadsheets.values.update({ spreadsheetId: PUB_SHEET_ID, range: `'${TOKEN_TAB_NAME}'!A${at + 2}:E${at + 2}`, valueInputOption: 'RAW', requestBody: { values: [row] } });
  else await sheets.spreadsheets.values.append({ spreadsheetId: PUB_SHEET_ID, range: `'${TOKEN_TAB_NAME}'!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [row] } });

  return { ok: true, already: false, channelId, from: `${oldTab}(원본 그대로 보존)` };
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔌 채널 어댑터 (작업 4) — 얇은 껍데기. 발행 로직은 하나도 새로 안 짠다.
//
//   ★ 채널 하나 추가할 때 건드릴 곳은 딱 2군데:
//      ① ADAPTERS에 함수 1개 추가   ② CHANNELS에 1줄 추가
//      시계·예약표 읽기·자물쇠·기록·검증은 채널을 몰라도 된다 → 안 건드림.
//
//   규격(모든 채널 동일):
//     입력  job = { mediaUrls[], title, caption, visibility, whenKST, ytChannelId }
//     출력        { ok, postUrl, verified: 'O'|'X'|'', why }
//
//   발행 함수는 server.js가 init()으로 넣어준다(_deps.pub) → 이 파일은 server.js를 모른다.
// ═══════════════════════════════════════════════════════════════════════════

// 예약표 '채널' 칸 → 어떤 어댑터로 보낼지. ★채널 추가 = 여기 1줄.
const CHANNELS = {
  '인스타릴스':          { adapter: 'igReel' },
  '인스타캐러셀':        { adapter: 'igCarousel' },
  '유튜브(금융집짓기)':  { adapter: 'youtube', main: true },
  '유튜브(뽀글이)':      { adapter: 'youtube', main: true },   // 같은 채널로 확정(2026-07-16) → 같은 토큰
};

const ADAPTERS = {
  // 릴스 = 영상 1개
  igReel: async (job, P) => {
    if (!job.mediaUrls.length) return { ok: false, why: '미디어URL이 없습니다' };
    const r = await P.postReel(job.mediaUrls[0], job.caption);
    const v = await P.verifyIg(r.mediaId);
    return finishIg(v);
  },
  // 캐러셀 = 이미지 2~10장
  igCarousel: async (job, P) => {
    if (job.mediaUrls.length < 2) return { ok: false, why: `캐러셀은 이미지가 2장 이상이어야 합니다(지금 ${job.mediaUrls.length}장)` };
    const r = await P.postCarousel(job.mediaUrls, job.caption);
    const v = await P.verifyIg(r.mediaId);
    return finishIg(v);
  },
  // 유튜브 = 영상 1개 (+ 예약공개 publishAt)
  youtube: async (job, P) => {
    if (!job.mediaUrls.length) return { ok: false, why: '미디어URL이 없습니다' };
    if (!job.title) return { ok: false, why: '유튜브는 제목이 필수입니다 — 예약표 제목 칸을 채워주세요' };
    // ★ title·description을 '직접' 넘긴다. 안 넘기면 buildCaptions가 캠페인 문구로 덮어써
    //   제목이 "강의"가 되고 꼬리표 붙은 진단링크가 설명에서 사라진다(리허설로 잡음).
    const r = await P.postYoutube(
      { mediaUrl: job.mediaUrls[0], scheduledAt: null },
      { hashtags: job.tags },
      { privacy: job.visibility === '비공개' ? 'private' : job.visibility === '일부공개' ? 'unlisted' : 'public',
        title: job.title, description: job.caption, channelId: job.ytChannelId },
    );
    const v = await P.verifyYoutube(r.videoId);
    if (!v.exists) return { ok: false, verified: 'X', why: v.note || '영상이 채널에 없음' };
    const onMain = v.channelId === P.mainChannelId;
    return { ok: onMain, postUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
             verified: onMain ? 'O' : 'X',
             why: onMain ? '' : `엉뚱한 채널에 올라감(${v.channelTitle || v.channelId})` };
  },
};

// 인스타 공통 마무리 — success 깃발 불신, owner 대조로 실제 게시 확인
function finishIg(v) {
  if (!v.exists) return { ok: false, verified: 'X', why: 'API에 게시물이 없음(발행 실패·삭제)' };
  if (v.ownerMatch === false) return { ok: false, verified: 'X', postUrl: v.permalink || '', why: '다른 계정에 올라감' };
  return { ok: true, postUrl: v.permalink || '', verified: v.ownerMatch === true ? 'O' : '', why: '' };
}

// 예약표 한 줄 → 어댑터가 받는 규격으로 변환
//   · 미디어URL 여러 장(캐러셀)은 한 칸에 줄바꿈으로 넣는다 → 여기서 배열로 편다.
//   · 캡션 = 캡션·본문 + 진단링크 + 해시태그 (대표님이 세 칸에 나눠 쓴 걸 하나로 조립)
//   · ★꼬리표 = 진단링크 뒤에 ?from=... 자동 부착. 대표님은 'yt_pen_001'만 적으면 된다.
//     이름이 src가 아니라 from인 이유: 진단페이지·Apps Script·통합리드 시트('유입경로')가
//     이미 from을 읽어 기록한다(실측). src로 새로 만들면 검증된 배관을 버리게 된다.
//     형식 = 채널_캠페인_번호 (yt·ig·igc·bl·kt / pen·bil·hou·des / 001~060)
function withTag(link, tag) {
  if (!link || !tag) return link || '';
  if (/[?&]from=/.test(link)) return link;              // 대표님이 이미 붙였으면 그대로 존중
  return link + (link.includes('?') ? '&' : '?') + 'from=' + encodeURIComponent(tag);
}

function toJob(r, cell) {
  const mediaUrls = String(cell(r, C.media) || '').split(/[\r\n]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
  const link = withTag(cell(r, C.link), cell(r, C.tag));
  const parts = [cell(r, C.caption), link, cell(r, C.tags)].map((s) => String(s || '').trim()).filter(Boolean);
  return { mediaUrls, title: cell(r, C.title), caption: parts.join('\n\n'), tags: cell(r, C.tags), link,
           visibility: cell(r, C.vis) || '공개', channel: cell(r, C.ch), id: cell(r, C.id) };
}

// 한 건 발행 — ★DRY_RUN이면 여기서 멈춘다(발행 함수 호출 0).
async function runJob(job) {
  const meta = CHANNELS[job.channel];
  if (!meta) return { ok: false, why: `모르는 채널: "${job.channel}" — 예약표 드롭다운에서 고르세요` };
  const fn = ADAPTERS[meta.adapter];
  if (!fn) return { ok: false, why: `어댑터 없음: ${meta.adapter}` };
  if (DRY_RUN) return { ok: false, dry: true, why: `DRY RUN — ${meta.adapter} 어댑터로 갈 예정(실제 발행 안 함)` };
  if (!_deps.pub) return { ok: false, why: '발행 함수가 연결되지 않음' };
  // 어느 유튜브 채널로 보낼지는 ★매핑표가 정한다(채널 추가 = 매핑표 1줄 원칙 유지).
  //   main:true → 본채널. 나중에 다른 채널이 생기면 CHANNELS에 ytChannelId만 적으면 된다.
  const j = { ...job, ytChannelId: meta.ytChannelId || (meta.main ? (_deps.pub.mainChannelId || '') : '') };
  try { return await fn(j, _deps.pub); }
  catch (e) { return { ok: false, why: e.message }; }
}

// ── ★ 예약ID 기준 결과 쓰기 ────────────────────────────────────────────────
//   쓰기 직전에 예약ID로 행을 '다시 찾는다'. 읽고→발행하는 사이 대표님이 행을 지웠으면
//   행번호가 밀려 엉뚱한 줄에 '완료'가 찍히기 때문. 못 찾으면 안 쓴다(=거짓 기록 방지).
//   대표님이 채우는 칸(A~K)은 절대 안 건드린다. 자동 칸(L~P)만 쓴다.
async function writeResult(id, { status, pubAt, url, verified, memo }) {
  const rowNo = await findRowById(id);
  if (rowNo < 0) return { ok: false, why: `예약ID "${id}" 행을 못 찾음 — 쓰지 않음(지워졌거나 바뀜)` };
  const sheets = _deps.sheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: PUB_SHEET_ID, range: `'${RESV_TAB_NAME}'!${WRITE_FROM}${rowNo}:${WRITE_TO}${rowNo}`,   // 상태·발행시각·게시물URL·검증·메모
    valueInputOption: 'RAW',
    requestBody: { values: [[status || '', pubAt || '', url || '', verified || '', memo || '']] },
  });
  return { ok: true, rowNo };
}

// ── 시계가 부르는 곳 (읽기·로그만) ──────────────────────────────────────────
let _busy = false;
let LAST = { at: '', total: 0, due: 0, waiting: 0, bad: 0, stuck: 0, lines: [], error: '' };

async function tick(verbose) {
  if (_busy) return LAST;
  _busy = true;
  try {
    const now = new Date();
    const { total, due, waiting, bad, stuck } = await findDue(now);
    const lines = [];
    for (const x of stuck) lines.push(`⚠️ ${x.rowNo}행 '발행중' ${STUCK_MIN}분 초과 — ${x.label}`);
    for (const x of bad)   lines.push(`❌ ${x.rowNo}행 ${x.why} → ${x.label}`);

    // 발행 대상 처리 — runJob이 DRY_RUN을 스스로 막는다(발행 함수 호출 0).
    //   DRY_RUN이 잠긴 동안 아래 writeResult는 절대 안 돈다(r.dry=true라서).
    for (const x of due) {
      const r = await runJob(x.job);
      if (r.dry) { lines.push(`🚀 ${x.rowNo}행 발행대상 — ${x.label} (예약 ${fmtKST(x.when)}) [${r.why}]`); continue; }
      const nowStr = fmtKST(new Date());
      const w = r.ok
        ? await writeResult(x.id, { status: '완료', pubAt: nowStr, url: r.postUrl, verified: r.verified, memo: '' })
        : await writeResult(x.id, { status: '실패', pubAt: nowStr, url: r.postUrl || '', verified: r.verified || '', memo: r.why || '' });
      lines.push(`${r.ok ? '✅' : '❌'} ${x.rowNo}행 ${x.label} — ${r.ok ? r.postUrl : r.why}${w.ok ? '' : ' / ★기록실패: ' + w.why}`);
    }

    LAST = { at: fmtKST(now), total, due: due.length, waiting: waiting.length, bad: bad.length, stuck: stuck.length,
             dryRun: DRY_RUN, lines, error: '',
             nextUp: waiting.slice().sort((a, b) => a.when - b.when).slice(0, 3).map((x) => `${fmtKST(x.when)} ${x.label}`) };

    // 조용한 로그: 할 일이 있을 때만 찍는다(60초마다 로그 도배 방지)
    if (verbose || due.length || bad.length || stuck.length) {
      console.log(`📅 [발행예약] ${fmtKST(now)} — 총 ${total} / 발행대상 ${due.length} / 대기 ${waiting.length} / 오류 ${bad.length} / 멈춤 ${stuck.length}`);
      for (const l of lines) console.log('   ' + l);
    }
    return LAST;
  } catch (e) {
    LAST = { ...LAST, at: fmtKST(new Date()), error: e.message };
    return LAST;
  } finally { _busy = false; }
}

const last = () => LAST;

module.exports = { init, tick, last, findDue, findRowById, loadChannelTokens, migrateToken, pickToken,
                   runJob, writeResult, toJob, CHANNELS, ADAPTERS, C,
                   parseKST, fmtKST, DRY_RUN, PUB_SHEET_ID, RESV_TAB_NAME, TOKEN_TAB_NAME };
