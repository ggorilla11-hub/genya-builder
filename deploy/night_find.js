// night_find.js — 🌙 밤샘 발굴 (서버 자동 · 대표별 · 2026-07-27 대표님 지시)
//
// ★★이 파일이 하는 일은 셋뿐이다: ① 켜둔 대표를 훑는다 ② 그 대표 키워드로 발굴을 부른다 ③ 적어둔다.
//   발송·답글·메일·카톡·외부로 나가는 동작은 ★코드 자체가 없다.
//   그래서 서버가 실수로도 발송할 수 없다(할 줄 아는 코드가 여기 없으니까).
//   고객에게 나가는 것은 지금도 앞으로도 화면 [승인] 버튼 → /api/approval/act 뿐이다.
//
// ★기존 발굴 로직은 한 줄도 건드리지 않는다. hunterDesk.collect를 ★주입받아 부르기만 한다.
//   (2026-07-27 회귀 사고: 기존 함수를 고쳤다가 발굴이 통째로 깨졌다. 다시는 안 한다.)
//
// ★"밤엔 로그인이 없는데 누구 것인지 어떻게 아나?" — 대표님 질문의 답:
//   낮에 대표가 [내 밤샘 발굴 켜기]를 누를 때 ★그때의 로그인으로 프로필(직업·키워드)을 적어둔다.
//   밤에는 서버가 그 ★켜둔 목록만 훑는다. 로그인이 필요 없다 — 공개 게시글 검색이라서.
//   아침엔 각자 로그인해서 ★자기 것만 본다(남의 리드는 안 보인다).
//
// ★개인정보 저장 0:
//   · 대표 구분은 이메일이 아니라 ★sha256 지문(되돌릴 수 없음)으로 한다.
//   · 리드는 ★공개 게시글의 링크·짧은 발췌·채널·점수만. 작성자·이름·연락처는 담지 않는다.

const crypto = require('crypto');
const { google } = require('googleapis');

const RUN_COLL = 'genya_night_find';                    // 회차 기록
const PROF_COLL = 'genya_night_profiles';               // 켜둔 대표 프로필
const PROJECT = process.env.GENYA_MEM_PROJECT || 'moneya-72fe6';
const DB = `projects/${PROJECT}/databases/(default)/documents`;
const 발췌길이 = 90;
const 보관 = 60;
const 링크기억 = 3000;
const 대표상한 = Number(process.env.NIGHT_OWNER_MAX) || 20;      // 한 번에 훑을 대표 수
const RUN_MS = Number(process.env.NIGHT_FIND_MS) || 90000;       // 대표 한 명당 상한(밤이라 넉넉히)

// ── 대표 지문: 이메일을 되돌릴 수 없게 ──
function 지문(email) {
  return crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex').slice(0, 32);
}

function _fs() {
  // ★2026-07-27 실측: 시트용 자격(GOOGLE_SERVICE_ACCOUNT_JSON)으로는 Firestore가 403이다.
  //   이미 잘 돌아가는 토큰 보관함과 ★같은 자격(GOOGLE_SA_JSON)을 쓴다.
  const raw = process.env.GOOGLE_SA_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!raw) throw new Error('GOOGLE_SA_JSON 없음 — 밤샘 결과를 적어둘 수 없어요');
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/datastore'],
  });
  return google.firestore({ version: 'v1', auth });
}
async function _add(coll, fields) {
  await _fs().projects.databases.documents.createDocument({ parent: DB, collectionId: coll, requestBody: { fields } });
}
async function _query(coll, where, limit, orderBy) {
  const q = { from: [{ collectionId: coll }], limit: Math.max(1, Math.min(200, limit || 20)) };
  if (where) q.where = where;
  if (orderBy) q.orderBy = [{ field: { fieldPath: orderBy }, direction: 'DESCENDING' }];
  const r = await _fs().projects.databases.documents.runQuery({ parent: DB, requestBody: { structuredQuery: q } });
  return (r.data || []).filter((x) => x.document).map((x) => x.document.fields || {});
}
const _같음 = (칸, 값) => ({ fieldFilter: { field: { fieldPath: 칸 }, op: 'EQUAL', value: { stringValue: String(값) } } });
const _풀기 = (f) => { try { return JSON.parse((f.json || {}).stringValue || '{}'); } catch (e) { return null; } };

// ═══ 프로필 — 대표가 낮에 켜둔다 ═══
//   ★담는 것: 지문·켜짐·직업·키워드뿐. 이름도 이메일도 담지 않는다.
async function saveProfile(email, { 켜짐, 직업, 키워드 }) {
  const id = 지문(email);
  if (!id) throw new Error('누구인지 알 수 없어요(로그인 필요)');
  const 정리 = (키워드 || []).map((k) => String(k || '').trim()).filter(Boolean).slice(0, 20);
  const p = { 지문: id, 켜짐: !!켜짐, 직업: String(직업 || '').slice(0, 40), 키워드: 정리, at: new Date().toISOString() };
  await _add(PROF_COLL, {
    지문: { stringValue: id },
    켜짐: { stringValue: p.켜짐 ? 'Y' : 'N' },
    at: { stringValue: p.at },
    json: { stringValue: JSON.stringify(p) },
  });
  return p;
}
// 같은 지문이 여러 번 저장됐으면 ★가장 최근 것만 쓴다(덮어쓰기 대신 최신 우선)
async function loadProfile(email) {
  const rows = await _query(PROF_COLL, _같음('지문', 지문(email)), 50, 'at');
  const ps = rows.map(_풀기).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return ps[0] || null;
}
async function listOn() {
  const rows = await _query(PROF_COLL, _같음('켜짐', 'Y'), 200, 'at');
  const 최신 = {};
  rows.map(_풀기).filter(Boolean).sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .forEach((p) => { 최신[p.지문] = p; });                      // 나중 것이 이긴다
  // 그 뒤에 꺼버린 대표는 빠져야 하므로 '꺼짐' 기록도 확인한다
  const off = (await _query(PROF_COLL, _같음('켜짐', 'N'), 200, 'at')).map(_풀기).filter(Boolean);
  off.forEach((p) => { const cur = 최신[p.지문]; if (cur && String(p.at) > String(cur.at)) delete 최신[p.지문]; });
  return Object.values(최신).slice(0, 대표상한);
}

// ── 공개 게시글에서 ★적어둘 것만 (작성자·이름·연락처 담지 않음) ──
function _간추리기(l) {
  return {
    채널: String((l && (l.channel || l.source)) || '기타'),
    링크: String((l && (l.sourceUrl || l.link)) || ''),
    발췌: String((l && l.text) || '').replace(/\s+/g, ' ').trim().slice(0, 발췌길이),
    등급: String((l && (l.grade || l.tier)) || ''),
    점수: Number((l && l.score) || 0) || 0,
    판정: String((l && l.verdict) || ''),
  };
}
function _핫인가(x) { return /^(A|S)$/i.test(x.등급) || x.점수 >= 60 || x.판정 === '고객'; }

// ═══ 한 대표 몫 돌리기 ═══
async function runOne(deps, prof) {
  const 시작 = Date.now();
  const at = new Date().toISOString();
  let desk = null, 시간초과 = false, 오류 = '';
  try {
    const bail = new Promise((r) => setTimeout(() => { 시간초과 = true; r(null); }, RUN_MS));
    // ★그 대표의 키워드로 부른다. 기존 collect를 그대로 쓴다(고치지 않는다).
    desk = await Promise.race([deps.collect({ 키워드: prof.키워드 || [], 직업: prof.직업 || '' }, { max: deps.max || 30 }), bail]);
  } catch (e) { 오류 = String(e.message || '').slice(0, 160); }

  const 간추림 = ((desk && desk.leads) || []).map(_간추리기).filter((x) => x.링크);

  // ★중복 제거 — 링크 기준. ★그 대표의 지난 회차하고만 비교한다(남의 것과 안 섞인다).
  const 이전링크 = new Set();
  try {
    const 지난 = await loadRuns(prof.지문, 보관);
    for (const r of 지난) for (const x of (r.리드 || [])) { if (이전링크.size < 링크기억) 이전링크.add(x.링크); }
  } catch (e) { /* 못 읽어도 이번 것은 적어둔다 */ }

  const 본것 = new Set(); const 신규리드 = [];
  for (const x of 간추림) {
    if (본것.has(x.링크)) continue;
    본것.add(x.링크);
    if (이전링크.has(x.링크)) continue;
    신규리드.push(x);
  }
  const 채널별 = {};
  신규리드.forEach((x) => { 채널별[x.채널] = (채널별[x.채널] || 0) + 1; });

  const 회차 = {
    지문: prof.지문, 직업: prof.직업 || '', at,
    건수: 간추림.length, 신규: 신규리드.length, 중복: 간추림.length - 신규리드.length,
    핫: 신규리드.filter(_핫인가).length, 채널별, 시간초과,
    오류: 오류 || String((desk && desk.오류) || ''),
    걸린초: Math.round((Date.now() - 시작) / 1000),
    리드: 신규리드.slice(0, 200),
    발송함: false,                                       // ★언제나 false — 이 파일엔 발송 코드가 없다
  };
  let 저장됨 = false, 저장오류 = '';
  try {
    await _add(RUN_COLL, {
      지문: { stringValue: 회차.지문 }, at: { stringValue: at },
      신규: { integerValue: String(회차.신규) },
      json: { stringValue: JSON.stringify(회차) },
    });
    저장됨 = true;
  } catch (e) { 저장오류 = String(e.message || '').slice(0, 160); }
  return Object.assign({}, 회차, { 저장됨, 저장오류 });
}

// ═══ 밤에 서버가 부르는 것 — 켜둔 대표 전부 ═══
async function runAll(deps) {
  const 대표들 = await listOn();
  const 결과 = [];
  for (const p of 대표들) {                              // ★차례로(동시에 때리면 채널이 막는다)
    try { 결과.push(await runOne(deps, p)); }
    catch (e) { 결과.push({ 지문: p.지문, 직업: p.직업 || '', at: new Date().toISOString(), 신규: 0, 핫: 0, 오류: String(e.message || '').slice(0, 160), 발송함: false }); }
  }
  return {
    대표수: 대표들.length,
    합계신규: 결과.reduce((a, r) => a + (r.신규 || 0), 0),
    합계핫: 결과.reduce((a, r) => a + (r.핫 || 0), 0),
    회차: 결과.map((r) => ({ 지문: r.지문, 직업: r.직업, 신규: r.신규, 핫: r.핫, 걸린초: r.걸린초, 오류: r.오류 || '', 저장됨: !!r.저장됨 })),
    발송함: false,
  };
}

// ═══ 아침에 읽는 것 — ★자기 것만 ═══
async function loadRuns(지문값, limit) {
  const rows = await _query(RUN_COLL, _같음('지문', String(지문값)), Math.min(보관, limit || 12), 'at');
  return rows.map(_풀기).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
async function loadMine(email, limit) { return loadRuns(지문(email), limit); }

function summaryText(runs, now) {
  const 기준 = new Date((now ? new Date(now) : new Date()).getTime());
  기준.setHours(기준.getHours() - 15);                   // 대략 "어젯밤부터"
  const 밤 = (runs || []).filter((r) => new Date(r.at) >= 기준);
  if (!밤.length) return '🌙 밤사이 발굴 기록이 없어요. ([내 밤샘 발굴 켜기]를 안 하셨거나, 아직 예약 시각이 안 지났습니다.)';
  const 총 = 밤.reduce((a, r) => a + (r.신규 || 0), 0);
  const 핫 = 밤.reduce((a, r) => a + (r.핫 || 0), 0);
  const ch = {};
  밤.forEach((r) => Object.keys(r.채널별 || {}).forEach((k) => { ch[k] = (ch[k] || 0) + r.채널별[k]; }));
  const 줄 = Object.keys(ch).sort((a, b) => ch[b] - ch[a]).map((k) => k + ' ' + ch[k]).join(' · ');
  const 탈 = 밤.filter((r) => r.오류 || r.시간초과);
  return `🌙 밤사이 **${총}건** 새로 나왔어요 (핫 ${핫}건 · ${밤.length}회 돌았습니다)`
    + (줄 ? `\n\n${줄}` : '')
    + (탈.length ? `\n\n⚠️ ${탈.length}회는 온전히 못 돌았어요 — ${(탈[0].오류 || '시간 초과')}` : '')
    + '\n\n답글은 대표님이 보시고 [승인]하셔야 나갑니다 — 밤사이 나간 것은 **하나도 없습니다.**';
}

module.exports = { 지문, saveProfile, loadProfile, listOn, runOne, runAll, loadRuns, loadMine, summaryText, _간추리기, _핫인가, RUN_COLL, PROF_COLL };
