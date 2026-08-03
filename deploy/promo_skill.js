// ═══════════════════════════════════════════════════════════════════
// promo_skill.js · 홍보마케팅비서 2단계 · 원고 12종 생성 엔진 (Day 1-1)
//
//   무엇을·왜: 한줄카피 하나를 넣으면 채널별 원고 12종을 만든다.
//              지금은 대표님이 채널마다 직접 쓰셔야 한다. 그 시간을 없앤다.
//
//   ★독립 모듈이다. main_server.js 는 require + init + 라우터 3줄만 바뀐다(CLAUDE.md 6-2 ⑦).
//   ★서버 저장 0. 시트를 읽어 프롬프트에 넣고, 결과는 시트에 쓰고 끝(Day 1-2에서 연결).
//   ★발송 코드 없음. 이 파일은 글만 만든다.
//
//   실측으로 확인한 두 가지 함정 — 반드시 지킨다:
//     ① Sonnet5는 생각(thinking)이 기본 ON이고 max_tokens를 생각과 본문이 나눠 쓴다.
//        끄지 않으면 생각이 예산을 다 먹어 본문이 0자가 된다(교육생 빈 화면 실사고).
//     ② 0자가 나와도 "성공"으로 세면 진단이 거짓말을 한다(CLAUDE.md 6-7).
// ═══════════════════════════════════════════════════════════════════
'use strict';

const P = require('./promo_prompts');
const U = require('./promo_utm');

let _anthropic = null;
let _MODEL = 'claude-sonnet-5';   // ★대표 절대규칙: 모든 LLM = Claude Sonnet. 날짜접미사 금지.

function init(opts) {
  opts = opts || {};
  if (opts.anthropic) _anthropic = opts.anthropic;
  if (opts.model) _MODEL = opts.model;
}

// ═══ [1] 환각 차단 — 사실자료 파서 (스펙 B-1) ══════════════════════
//   왜: 지니야가 DESIRE를 "다섯 글자"라 하고 항목 5개를 지어냈다(실측).
//       실제로는 여섯 글자다. 인포그래픽에서는 "10명 중 6명" 통계까지 날조했다.
//   원칙: 회장님이 적어주신 것만 쓴다. 안 적힌 건 구체적으로 말하지 않는다.
//         ★단, 원고는 정상적으로 완성한다(회장님 지시). 일반 톤으로 쓸 뿐이다.

// 미기재로 보는 값 — "없음"이라 적으셔도, 아예 안 적으셔도 같게 처리
const _EMPTY = /^(없음|미정|해당없음|모름|[-_\s]*)$/;

// 키 → 이 키가 없을 때 금지할 주제 (사실자료_양식.md 10개 항목과 1:1)
const FACT_KEYS = {
  DESIRE약자: 'DESIRE가 무엇의 약자인지',
  D: 'DESIRE의 D가 무엇인지', E: 'DESIRE의 E가 무엇인지', S: 'DESIRE의 S가 무엇인지',
  I: 'DESIRE의 I가 무엇인지', R: 'DESIRE의 R가 무엇인지', E2: 'DESIRE의 마지막 E가 무엇인지',
  집짓기1: '금융집짓기 1단계', 집짓기2: '금융집짓기 2단계', 집짓기3: '금융집짓기 3단계',
  집짓기4: '금융집짓기 4단계', 집짓기5: '금융집짓기 5단계', 집짓기6: '금융집짓기 6단계',
  집짓기7: '금융집짓기 7단계', 집짓기8: '금융집짓기 8단계',
  오행1: '금융오행 1요소', 오행2: '금융오행 2요소', 오행3: '금융오행 3요소',
  오행4: '금융오행 4요소', 오행5: '금융오행 5요소',
  진단_수입지출: '수입지출 진단이 무엇을 보는지',
  진단_자산부채: '자산부채 진단이 무엇을 보는지',
  진단_연금: '연금 진단이 무엇을 보는지',
  CTA_재무상담: '재무상담 CTA 문구', CTA_부트캠프: '부트캠프 CTA 문구',
  CTA_일반강의: '일반인 강의 CTA 문구', CTA_전문가강의: '전문가 강의 CTA 문구',
  대표경력: '오상열 대표의 경력·자격',
  대표숫자: '오상열 대표 관련 숫자(구독자·회차·연차 등)',
  금지표현: '쓰면 안 되는 표현',
  회사명: '회사 정식 명칭', 부트캠프명: '부트캠프 정식 명칭',
  가격허용: '가격을 원고에 써도 되는지', 가격: '교육비·구독료 금액',
  진단5분_대상: '5분 진단이 무엇을 진단하는지',
  진단5분_문항: '5분 진단의 문항 수·구성',
  진단5분_결과: '5분 진단 결과 화면에 나오는 것',
  진단5분_CTA: '5분 진단 이후의 다음 단계',
  오원트미션: '오원트금융연구소의 미션',
  지니야정의: '지니야가 무엇인지', 지니야대상: '지니야의 대상 고객',
  지니야차별점: '지니야가 다른 AI 비서와 다른 점',
};

/**
 * 시트 「캠페인」 탭의 `내용_사실자료` 한 칸을 파싱한다.
 * 형식: `키: 값` 한 줄씩.  모르는 키는 무시한다(오타로 잘못 주입되는 것보다 안전).
 */
function parseFacts(cell) {
  const filled = {};
  String(cell || '').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([^:：]+)[:：]\s*(.*)$/);
    if (!m) return;
    const key = m[1].trim();
    const val = m[2].trim();
    if (!FACT_KEYS[key]) return;      // 모르는 키 — 무시
    if (_EMPTY.test(val)) return;     // 값이 비면 채운 걸로 안 봄
    filled[key] = val;
  });
  const missing = Object.keys(FACT_KEYS).filter((k) => !filled[k]);
  return { filled, missing, filledCount: Object.keys(filled).length, missingCount: missing.length };
}

/** 프롬프트에 넣을 사실자료 블록을 만든다. */
function factBlock(facts) {
  const out = [];

  // ① 채워진 것 — 이 문장만 쓰게 한다
  if (facts.filledCount) {
    out.push('<사실자료> ★아래는 회장님이 확인해 주신 사실이다. 이 문장을 그대로 쓴다.');
    out.push('  바꿔 말하거나 살을 붙이지 마라. 여기 없는 내용을 이 주제에 덧붙이지 마라.');
    Object.keys(facts.filled).forEach((k) => out.push(`  · ${k} = ${facts.filled[k]}`));
    out.push('</사실자료>');
  }

  // ② 비어 있는 것 — 구체적 창작을 막는다. 원고 자체는 계속 쓴다.
  if (facts.missingCount) {
    out.push('<모르는것> ★아래 항목은 확인된 사실이 없다. 절대 지어내지 마라.');
    facts.missing.forEach((k) => out.push(`  · ${FACT_KEYS[k]}`));
    out.push('  이 항목들에 대해서는:');
    out.push('   - 구체적인 정의·풀이·항목 이름을 쓰지 않는다');
    out.push('   - 개수를 말하지 않는다 ("5가지", "8단계" 같은 표현 금지)');
    out.push('   - 숫자·수치·연차·금액·비율·통계를 쓰지 않는다');
    out.push('   - 약자를 글자별로 풀지 않는다');
    out.push('  ★대신 이름만 쓰고 일반적인 톤으로 넘어간다. 원고는 정상적으로 완성한다.');
    out.push('  예) O "DESIRE 진단으로 지금 내 위치를 확인할 수 있습니다."');
    out.push('      X "DESIRE는 다섯 글자로, D는 방향성, E는 실행력…"');
    out.push('      X "10명 중 6명이 자기 성향을 잘못 알고 있습니다"');
    out.push('</모르는것>');
  }
  return out.join('\n');
}

// 만들어진 원고에 금지 표현이 남았는지 훑는다(프롬프트만으로 100% 막지 못하므로).
const _BANNED = /다섯\s*글자|여섯\s*글자|다섯\s*가지\s*항목|[0-9]\s*가지\s*(지표|항목)|[0-9]+단계의?\s*(구성|항목)|[0-9]+명\s*중\s*[0-9]+명/;
function scanBanned(text) {
  const m = String(text || '').match(_BANNED);
  return m ? m[0] : null;
}

// ═══ [2] LLM 호출 — 실측으로 확인한 함정 두 개를 여기서 막는다 ═════
async function _call(system, userText, maxTokens) {
  if (!_anthropic) throw new Error('promo_skill.init(anthropic) 를 먼저 불러 주세요');
  const r = await _anthropic.messages.create({
    model: _MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },            // ★① 생각을 끈다 — 안 끄면 본문이 0자가 된다
    system,
    messages: [{ role: 'user', content: userText }],
  });
  const text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) {                                  // ★② 빈 응답을 성공으로 세지 않는다
    throw new Error(`원고가 비어서 나왔어요 (stop=${r.stop_reason}, 출력토큰=${r.usage.output_tokens}/${maxTokens})`);
  }
  return {
    text,
    truncated: r.stop_reason === 'max_tokens',
    inTok: r.usage.input_tokens,
    outTok: r.usage.output_tokens,
  };
}

// ═══ [3] 원고 한 종류 만들기 (자동 검사 + 1회 보강) ════════════════
async function generateOne(kind, ctx, copy) {
  const t0 = Date.now();
  const usage = { inTok: 0, outTok: 0 };
  const sys = P.systemFor(kind, ctx);

  let r = await _call(sys, '한줄카피: ' + copy, kind.max);
  usage.inTok += r.inTok; usage.outTok += r.outTok;
  let text = r.text;
  let fixed = '—';

  // 목표 ±20% 밖이면 딱 1회만 다시 부른다(2회 이상은 비용·시간이 커진다)
  if (!P.inRange(kind, text)) {
    const before = text.length;
    const r2 = await _call(sys, P.fixInstruction(kind, text), kind.max);
    usage.inTok += r2.inTok; usage.outTok += r2.outTok;
    text = r2.text;
    fixed = before < kind.target ? '보강' : '압축';
  }

  return {
    kind: kind.key, label: kind.label, target: kind.target,
    text, chars: text.length,
    rate: Math.round((text.length / kind.target) * 100),
    inRange: P.inRange(kind, text),
    fixed, banned: scanBanned(text),
    ms: Date.now() - t0, usage, url: ctx.url,
  };
}

// ═══ [4] 팟캐스트 — 3분할 순차 생성 (앞부분을 넘겨 중복 방지) ══════
async function generatePodcast(ctx, copy) {
  const t0 = Date.now();
  const usage = { inTok: 0, outTok: 0 };
  const parts = [];
  for (const part of P.PODCAST_PARTS) {
    const sys = P.systemForPodcastPart(part, ctx, parts);
    const r = await _call(sys, '한줄카피: ' + copy, P.PODCAST.max);
    usage.inTok += r.inTok; usage.outTok += r.outTok;
    parts.push(r.text);
  }
  const text = parts.join('\n\n');
  return {
    kind: P.PODCAST.key, label: P.PODCAST.label, target: P.PODCAST.target,
    text, chars: text.length,
    rate: Math.round((text.length / P.PODCAST.target) * 100),
    inRange: text.length >= P.PODCAST.target * 0.8 && text.length <= P.PODCAST.target * 1.2,
    fixed: '3분할', banned: scanBanned(text),
    ms: Date.now() - t0, usage, url: ctx.url, parts: parts.map((p) => p.length),
  };
}

// ═══ [5] 12종 한 번에 ═══════════════════════════════════════════════
/**
 * @param {object} campaign  시트 「캠페인」 탭 한 줄
 *        { service, content, tone, landing, campaignKey, facts }
 * @param {string} copy      한줄카피
 * @param {number} copyNo    카피 번호 1~60
 */
async function generateAll(campaign, copy, copyNo) {
  if (!copy || !String(copy).trim()) throw new Error('한줄카피를 입력해 주세요');
  const facts = parseFacts(campaign.facts);
  const block = factBlock(facts);

  const ctxFor = (kindKey) => ({
    service: campaign.service, content: campaign.content, tone: campaign.tone,
    url: U.buildUtm(campaign.landing, kindKey, campaign.campaignKey, copyNo),
    factBlock: block,
    sourceBlock: P.sourceBlock(campaign.source),   // ★대표님 자료 — 없으면 빈 문자열(기존과 동일)
  });

  // 팟캐스트만 순차(앞부분이 필요), 나머지 11종은 동시에
  const jobs = P.KINDS.map((k) => generateOne(k, ctxFor(k.key), copy)
    .catch((e) => ({ kind: k.key, label: k.label, target: k.target, ok: false, error: e.message,
                     text: '', chars: 0, rate: 0, inRange: false, fixed: '—', banned: null,
                     ms: 0, usage: { inTok: 0, outTok: 0 } })));
  const podJob = generatePodcast(ctxFor(P.PODCAST.key), copy)
    .catch((e) => ({ kind: P.PODCAST.key, label: P.PODCAST.label, target: P.PODCAST.target,
                     ok: false, error: e.message, text: '', chars: 0, rate: 0, inRange: false,
                     fixed: '3분할', banned: null, ms: 0, usage: { inTok: 0, outTok: 0 } }));

  const results = (await Promise.all(jobs.concat([podJob])))
    .map((r) => Object.assign({ ok: true }, r))
    .sort((a, b) => (a.kind === 'podcast' ? 7 : 0) - (b.kind === 'podcast' ? 7 : 0));

  const inTok = results.reduce((s, r) => s + (r.usage ? r.usage.inTok : 0), 0);
  const outTok = results.reduce((s, r) => s + (r.usage ? r.usage.outTok : 0), 0);

  return {
    copy, copyNo, results,
    요약: {
      성공: results.filter((r) => r.ok !== false).length,
      실패: results.filter((r) => r.ok === false).length,
      범위안: results.filter((r) => r.inRange).length,
      금지표현: results.filter((r) => r.banned).map((r) => `${r.label}: ${r.banned}`),
      사실자료: `채움 ${facts.filledCount} · 미기재 ${facts.missingCount}`,
      토큰: { 입력: inTok, 출력: outTok },
    },
  };
}

// ═══ [6] 라우터 (Day 1-2) ═══════════════════════════════════════════
//   main_server.js 는 require + init + app.use 3줄만 바뀐다. 기존 라우트 무접촉.
//   ★기존 /api/promo/draft·expand 는 교육생이 쓰는 중이라 건드리지 않는다.
//     새 기능은 /api/promo2/* 로 따로 낸다.
const express = require('express');
const SHEET = require('./promo_sheet');

const router = express.Router();

// 로그인 게이트 — main_server 의 sessionOf 를 주입받아 쓴다(직접 require 안 함)
let _sessionOf = null;
function _gate(req, res) {
  if (typeof _sessionOf === 'function' && !_sessionOf(req)) {
    res.status(401).json({ ok: false, error: '로그인이 필요해요' });
    return false;
  }
  return true;
}
function _fail(res, e) {
  res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
}

// 캠페인 목록
router.get('/campaigns', async (req, res) => {
  if (!_gate(req, res)) return;
  try {
    const list = await SHEET.readCampaigns();
    res.json({ ok: true, count: list.length, campaigns: list.map((c) => ({
      campaignKey: c.campaignKey, service: c.service, content: c.content,
      landing: c.landing, tone: c.tone, status: c.status,
      // 사실자료 원문은 안 내려보낸다 — 화면엔 채움/미기재 개수만
      사실자료: (function () { const f = parseFacts(c.facts); return `채움 ${f.filledCount} · 미기재 ${f.missingCount}`; })(),
    })) });
  } catch (e) { _fail(res, e); }
});

// 한줄카피 목록
router.get('/copies', async (req, res) => {
  if (!_gate(req, res)) return;
  try {
    const key = String(req.query.key || '').trim();
    if (!key) return res.status(400).json({ ok: false, error: '캠페인을 골라 주세요' });
    const copies = await SHEET.readCopies(key);
    res.json({ ok: true, count: copies.length, copies });
  } catch (e) { _fail(res, e); }
});

// 한줄카피 올리기(txt 한 줄에 하나 · 최대 60)
router.post('/copies', async (req, res) => {
  if (!_gate(req, res)) return;
  try {
    const b = req.body || {};
    const key = String(b.key || '').trim();
    if (!key) return res.status(400).json({ ok: false, error: '캠페인을 골라 주세요' });
    const lines = String(b.text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return res.status(400).json({ ok: false, error: '카피가 한 줄도 없어요' });
    const kept = lines.slice(0, 60);
    const saved = await SHEET.appendCopies(key, kept.map((c, i) => ({ no: i + 1, copy: c })));
    res.json({ ok: true, saved, dropped: lines.length - kept.length });
  } catch (e) { _fail(res, e); }
});

// ★2단계 핵심 — 카피 1건 → 원고 12종
router.post('/expand12', async (req, res) => {
  if (!_gate(req, res)) return;
  try {
    const b = req.body || {};
    const key = String(b.key || '').trim() || 'direct';
    const copyNo = Number(b.copyNo) || 1;
    let copy = String(b.copy || '').trim();

    // ★시트가 아직 없어도 돌아가야 한다(회장님 지시: 작동 우선).
    //   화면에서 캠페인 정보를 직접 받으면 시트 없이 바로 만든다.
    //   시트가 준비되면 key 로 시트에서 읽어 온다.
    let campaign;
    if (b.campaign && b.campaign.landing) {
      campaign = {
        campaignKey: key,
        service: String(b.campaign.service || '부트캠프'),
        content: String(b.campaign.content || ''),
        tone: String(b.campaign.tone || '도전·성장·긴급. 과장·허위·확정수익 표현 절대 금지.'),
        landing: String(b.campaign.landing),
        facts: String(b.campaign.facts || ''),
        source: String(b.campaign.source || ''),   // ★대표님 자료(참고 원천) — facts 와 별개 통로
      };
    } else {
      campaign = await SHEET.findCampaign(key);
      if (!copy) {
        const copies = await SHEET.readCopies(key);
        const hit = copies.find((c) => c.no === copyNo);
        if (!hit) return res.status(400).json({ ok: false, error: `${copyNo}번 카피를 못 찾았어요` });
        copy = hit.copy;
      }
    }
    if (!copy) return res.status(400).json({ ok: false, error: '한줄카피를 입력해 주세요' });

    const out = await generateAll(campaign, copy, copyNo);

    // 시트에 기록(실패해도 원고는 화면에 보여준다 — 거짓 성공 금지 위해 사실대로 알림)
    //   ★시트가 아직 없으면 저장을 건너뛰고 그 사실을 숨기지 않는다.
    let saved = 0, saveError = null;
    if (process.env.PROMO_SHEET_ID) {
      try { saved = await SHEET.appendScripts(key, copyNo, out.results, _MODEL); }
      catch (e) { saveError = e.message; }
    } else {
      saveError = '시트 미연결 — 원고는 만들었지만 저장은 안 했어요(PROMO_SHEET_ID 등록 전)';
    }

    res.json({ ok: true, copy: out.copy, copyNo, 요약: out.요약, saved, saveError,
      results: out.results.map((r) => ({
        kind: r.kind, label: r.label, target: r.target, chars: r.chars, rate: r.rate,
        inRange: r.inRange, fixed: r.fixed, banned: r.banned, ms: r.ms,
        url: r.url, text: r.text, error: r.error || null,
      })) });
  } catch (e) { _fail(res, e); }
});

// 만들어진 원고 조회
router.get('/scripts', async (req, res) => {
  if (!_gate(req, res)) return;
  try {
    const key = String(req.query.key || '').trim();
    if (!key) return res.status(400).json({ ok: false, error: '캠페인을 골라 주세요' });
    const rows = await SHEET.readScripts(key, req.query.no);
    res.json({ ok: true, count: rows.length, scripts: rows });
  } catch (e) { _fail(res, e); }
});

// 진단 창구 — ★실제와 같은 함수를 탄다(CLAUDE.md 6-7). 진단만 통과하는 일 없게.
router.get('/diag', async (req, res) => {
  if (!_gate(req, res)) return;
  try {
    const d = await SHEET.diag();
    res.json({ ok: true, 시트: d, 모델: _MODEL, 종류수: P.KINDS.length + 1 });
  } catch (e) { _fail(res, e); }
});

// init 에서 sessionOf 도 받는다
const _initBase = init;
function initAll(opts) {
  _initBase(opts);
  if (opts && opts.sessionOf) _sessionOf = opts.sessionOf;
}

module.exports = {
  init: initAll,
  router,
  parseFacts, factBlock, scanBanned, FACT_KEYS,
  generateOne, generatePodcast, generateAll,
  KINDS: P.KINDS, PODCAST: P.PODCAST,
};
