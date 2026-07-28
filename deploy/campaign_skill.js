/**
 * 📣 campaign_skill.js — 캠페인(명단 일괄) 발송 (2026-07-28 대표님 승인)
 *
 *   나인톡·보케어가 하는 "명단 전체에 같은 내용 한 번에" 기능.
 *   ★독립 모듈: 기존 22블록·결재함·발굴·밤샘 코드에 손대지 않는다. 발송 함수만 주입받아 쓴다.
 *
 * ═══ 안전 설계 (되돌릴 수 없는 실발송이라 겹겹이) ═══
 *   ① 미리보기(preview)는 ★발송 0. 대상 수·내용·예상 비용·법규 점검만 돌려준다.
 *   ② 실제 발송(send)은 ★[승인] 버튼만 보내는 이중 채널(humanApproval)이 있어야 실행된다.
 *   ③ ★소량 테스트를 먼저 하지 않으면 대량 발송을 거부한다(대표님 지시).
 *   ④ 광고성이면 (광고) 표시·수신거부 문구를 자동으로 붙이고, 야간(21~08시) 발송을 막는다.
 *      — 정보통신망법 제50조. 위반 시 과태료·발신번호 차단이라 대표님을 지키는 장치다.
 *   ⑤ 배치로 나눠 보내고, 성공·실패를 ★실제로 센다(가짜 성공 없음).
 *
 * ═══ 개인정보 (제로 인그레스) ═══
 *   연락처는 ★메모리에서만 다루고 서버에 저장하지 않는다.
 *   결과·로그에 남기는 번호는 ★마스킹(010****1234)뿐이다.
 */

const 야간시작 = 21, 야간끝 = 8;           // 광고 문자 금지 시간(KST)
const 배치크기 = 100;                       // 한 번에 보내는 수(솔라피 부담·중단 시 피해 최소화)
const 배치간격ms = 1000;
const SMS_한도 = 90;                        // 이 길이를 넘으면 LMS(요금이 다르다)
const 요금 = { SMS: 20, LMS: 50 };          // 대략 단가(원). 정확한 값은 회원 솔라피 계약에 따름

let _deps = { sendSms: null, sendGmail: null };
function init(deps) { _deps = Object.assign(_deps, deps || {}); }

const _마스크 = (p) => { const s = String(p || '').replace(/[^0-9]/g, ''); return s.length < 7 ? '***' : s.slice(0, 3) + '****' + s.slice(-4); };
// ★2026-07-29 대표님 실측: 고객 엑셀 12줄이 "형식 오류 11건"으로 통째로 버려졌다.
//   원인 — 엑셀이 전화번호를 ★숫자로 저장하면 앞의 0이 사라진다(01011112222 → 1011112222).
//   국가번호(+82)·작은따옴표·공백·하이픈도 실제 파일에 흔하다.
//   ★정상 번호를 형식 오류로 버리지 않는다. 넓게 받아 하나의 표준형(01xxxxxxxxx)으로 만든다.
const _정규화 = (p) => {
  let s = String(p == null ? '' : p).trim();
  s = s.replace(/^['"`\s]+/, '');            // 엑셀 텍스트 강제용 앞 따옴표
  s = s.replace(/[^\d+]/g, '');              // 하이픈·공백·점·괄호 제거(숫자와 +만)
  if (/^\+?82/.test(s)) s = '0' + s.replace(/^\+?82/, '');   // +82 10 … → 010 …
  s = s.replace(/\D/g, '');
  if (s.length === 10 && /^1[016789]/.test(s)) s = '0' + s;  // ★엑셀이 날린 앞 0을 되살린다
  return s;
};
const _휴대폰 = (s) => /^01[016789]\d{7,8}$/.test(String(s || ''));
// 왜 오류인지 대표님이 보실 수 있게 — ★원문을 마스킹해 보여준다(개인정보 노출 없이 원인 파악)
const _원문마스크 = (v) => { const s = String(v == null ? '' : v).trim(); return s.length <= 4 ? s : s.slice(0, 3) + '****' + s.slice(-2); };
function _kst() { const d = new Date(Date.now() + 9 * 3600e3); return { 시: d.getUTCHours(), 날짜: d.toISOString().slice(0, 10) }; }

/** 명단 행에서 연락처·이름 뽑기 (칸 이름이 제각각이라 넓게 본다) */
function _연락처(row) {
  for (const k of Object.keys(row || {})) {
    if (!/(연락처|휴대폰|핸드폰|전화|번호|폰|mobile|phone)/i.test(k)) continue;
    const v = _정규화(row[k]);
    if (_휴대폰(v)) return v;                       // ★시트 명단도 같은 정규화를 쓴다(기준이 갈리지 않게)
  }
  return '';
}
function _이름(row) {
  for (const k of Object.keys(row || {})) if (/(고객명|성명|이름|name)/i.test(k)) { const v = String(row[k] || '').trim(); if (v) return v; }
  return '';
}

/**
 * 대상 고르기 — 명단 전체 또는 조건.
 * ★조건 판정은 호출부(main_server)가 이미 쓰는 함수를 넘겨받아 쓴다(따로 만들지 않는다 → 기준이 갈리지 않게).
 * @returns {{대상:[], 전체:number, 연락처없음:number, 라벨:string}}
 */
function 대상고르기(table, opts) {
  const rows = (table && table.rows) || [];
  const o = opts || {};
  // ★파일 업로드로 받은 번호 목록 (2026-07-28 추가)
  //   ★서버 저장 0 — 이 요청에서만 쓰고 버린다. 파일 자체도 서버에 남기지 않는다.
  //   중복·빈 번호·형식 오류를 ★세어서 알려준다(지어내지 않는다).
  if (Array.isArray(o.직접대상) && o.직접대상.length) {
    const 대상 = [], 본 = new Set();
    let 형식오류 = 0, 빈칸 = 0;
    const 오류샘플 = [];
    for (const x of o.직접대상) {
      const raw = (x && x.번호 !== undefined) ? x.번호 : x;
      const 원문 = String(raw == null ? '' : raw).trim();
      // ★정직한 분류: 진짜 ★빈 칸과, 값은 있는데 ★번호가 아닌 것(abc·02-xxx)을 갈라 센다.
      //   합쳐서 "빈 번호"라고 하면 대표님께 사실과 다르게 보고하는 것이 된다.
      if (!원문) { 빈칸++; continue; }
      const p = _정규화(원문);
      if (!_휴대폰(p)) {
        형식오류++;
        if (오류샘플.length < 3) 오류샘플.push(_원문마스크(원문));   // ★왜 오류인지 보시라고
        continue;
      }
      if (본.has(p)) continue;                      // 중복 제거(같은 분께 두 번 안 감)
      본.add(p);
      대상.push({ 번호: p, 이름: (x && x.이름) || '고객' });
    }
    return { 대상, 전체: o.직접대상.length, 연락처없음: 빈칸, 형식오류, 오류샘플,
      중복제거: o.직접대상.length - 빈칸 - 형식오류 - 대상.length,
      라벨: o.label || '업로드한 파일' };
  }
  let 골라진 = rows, 라벨 = '명단 전체';
  if (Array.isArray(o.names) && o.names.length) {
    const set = new Set(o.names);
    골라진 = rows.filter((r) => set.has(_이름(r)));
    라벨 = o.label || '고른 대상';
  }
  const 대상 = [], 본 = new Set();
  let 연락처없음 = 0;
  for (const r of 골라진) {
    const p = _연락처(r);
    if (!p) { 연락처없음++; continue; }
    if (본.has(p)) continue;                 // 같은 번호 중복 제거(두 번 가면 민원)
    본.add(p);
    대상.push({ 번호: p, 이름: _이름(r) || '고객' });
  }
  return { 대상, 전체: 골라진.length, 연락처없음, 라벨 };
}

/** 변수 치환 — #{고객명} 같은 것 */
function 내용만들기(본문, 사람) {
  return String(본문 || '')
    .replace(/#\{?고객명\}?/g, 사람.이름 || '고객')
    .replace(/#\{?이름\}?/g, 사람.이름 || '고객');
}

/**
 * ★광고 법규(정보통신망법 제50조) 자동 적용.
 *   광고성이면 (광고) 표시 + 무료 수신거부 방법을 반드시 넣는다.
 *   이미 들어 있으면 중복해서 붙이지 않는다.
 */
function 법규적용(본문, 광고, 수신거부) {
  let t = String(본문 || '').trim();
  if (!광고) return { 본문: t, 붙임: [] };
  const 붙임 = [];
  if (!/^\(광고\)/.test(t)) { t = '(광고) ' + t; 붙임.push('(광고) 표시'); }
  const 거부 = String(수신거부 || '').trim();
  // ★2026-07-28 대표님 확정: 무료수신거부는 ★솔라피가 자동으로 붙인다.
  //   그때 우리가 또 붙이면 ★한 문자에 수신거부가 두 번 들어간다 → 솔라피 자동이면 우리는 손대지 않는다.
  if (/^(solapi|솔라피|자동)$/i.test(거부)) {
    붙임.push('무료수신거부(솔라피가 자동 부착)');
  } else if (!/(무료거부|수신거부|080)/.test(t)) {
    t += 거부 ? `\n무료수신거부 ${거부}` : '\n수신거부: 회신 요청';
    붙임.push('수신거부 방법');
  }
  return { 본문: t, 붙임 };
}

/** 법규·시간 점검 — 막아야 하면 막는 이유를 돌려준다 */
function 점검(본문, 광고) {
  const 경고 = [], 막음 = [];
  const { 시 } = _kst();
  if (광고 && (시 >= 야간시작 || 시 < 야간끝)) {
    막음.push(`지금은 야간(${야간시작}시~${야간끝}시)이라 광고 문자를 보낼 수 없어요. 정보통신망법상 금지 시간입니다. 낮에 보내주세요.`);
  }
  if (광고) 경고.push('광고성 문자는 ★사전에 수신동의를 받은 분에게만 보낼 수 있어요. 동의 없는 번호가 섞이면 과태료 대상입니다.');
  if (!String(본문 || '').trim()) 막음.push('보낼 내용이 비어 있어요.');
  if (String(본문 || '').length > 2000) 막음.push('내용이 너무 길어요(2000자 초과).');
  return { 경고, 막음 };
}

/** 예상 비용 — 길이로 SMS/LMS 판정 */
function 비용(본문, 건수) {
  const 종류 = String(본문 || '').length > SMS_한도 ? 'LMS' : 'SMS';
  return { 종류, 단가: 요금[종류], 건수, 예상원: 요금[종류] * 건수 };
}

/**
 * ① 미리보기 — ★발송 0. 대표님이 눈으로 확인하실 것 전부.
 */
function 미리보기(table, opts) {
  const o = opts || {};
  const sel = 대상고르기(table, o);
  const { 본문: 최종본문, 붙임 } = 법규적용(o.본문, !!o.광고, o.수신거부);
  const chk = 점검(최종본문, !!o.광고);
  const cost = 비용(최종본문, sel.대상.length);
  // ★2026-07-28 대표님 지시: 미리보기는 간결하게 — 샘플은 ★1건만(한 명 예시로 충분).
  const 샘플 = sel.대상.slice(0, 1).map((p) => ({ 받는사람: p.이름, 번호: _마스크(p.번호), 내용: 내용만들기(최종본문, p) }));
  return {
    ok: true, 발송함: false,                      // ★여기서는 절대 안 보낸다
    대상수: sel.대상.length, 라벨: sel.라벨,
    명단행수: sel.전체, 연락처없음: sel.연락처없음,
    형식오류: sel.형식오류 || 0, 중복제거: sel.중복제거 || 0,
    본문: 최종본문, 광고: !!o.광고, 법규자동적용: 붙임,
    비용: cost, 경고: chk.경고, 막음: chk.막음,
    샘플, 배치: { 크기: 배치크기, 회차: Math.ceil(sel.대상.length / 배치크기) },
    안내: '이건 미리보기예요. 실제로는 한 통도 안 나갔습니다. 보내려면 소량 테스트 후 [승인]을 눌러주세요.',
  };
}

/**
 * ② 소량 테스트 — ★대표님 번호로 1통만. 대량 발송의 전제 조건.
 */
async function 테스트발송(ma, opts) {
  const o = opts || {};
  const 받을번호 = _정규화(o.테스트번호);
  if (!받을번호) return { ok: false, error: '테스트로 받으실 번호가 필요해요.' };
  const { 본문: 최종본문 } = 법규적용(o.본문, !!o.광고, o.수신거부);
  const chk = 점검(최종본문, !!o.광고);
  if (chk.막음.length) return { ok: false, error: chk.막음.join(' ') };
  const 내용 = 내용만들기(최종본문, { 이름: o.테스트이름 || '고객' });
  const r = await _deps.sendSms(ma, 받을번호, '[테스트] ' + 내용);
  return { ok: !!(r && r.sent), 발송함: !!(r && r.sent), 받는번호: _마스크(받을번호),
    내용: 내용, error: (r && r.error) || '',
    안내: (r && r.sent) ? '테스트 1통을 보냈어요. 받아보신 뒤 문제없으면 [승인]으로 전체 발송하실 수 있어요.' : '테스트 발송이 실패했어요 — 전체 발송은 막습니다.' };
}

/**
 * ③ 실제 캠페인 발송 — ★[승인] 버튼만 통과.
 *   humanApproval !== true 면 무조건 거부한다(하드가드).
 *   testedAt 없으면(소량 테스트 안 했으면) 거부한다.
 */
async function 발송(ma, opts) {
  const o = opts || {};
  // ★★하드가드 1 — 사람이 버튼을 눌렀는가
  if (o.humanApproval !== true) {
    return { ok: false, 발송함: false, 차단: '승인버튼아님',
      error: '대량 발송은 화면 결재함의 [승인] 버튼으로만 나갑니다. 말이나 글로는 나가지 않아요.' };
  }
  // ★★하드가드 2 — 소량 테스트를 먼저 했는가(대표님 지시)
  if (!o.tested) {
    return { ok: false, 발송함: false, 차단: '테스트안함',
      error: '먼저 대표님 번호로 소량 테스트를 한 번 해주세요. 테스트 없이 전체 발송은 막고 있습니다.' };
  }
  const sel = 대상고르기(o.table, o);
  const { 본문: 최종본문 } = 법규적용(o.본문, !!o.광고, o.수신거부);
  const chk = 점검(최종본문, !!o.광고);
  if (chk.막음.length) return { ok: false, 발송함: false, 차단: '법규·내용', error: chk.막음.join(' ') };
  if (!sel.대상.length) return { ok: false, 발송함: false, 차단: '대상0', error: '보낼 대상이 없어요.' };
  // ★★하드가드 3 — 대량이면 건수를 눈으로 확인했는가("정말 4000명?")
  if (sel.대상.length >= 10 && o.confirmedCount !== sel.대상.length) {
    return { ok: false, 발송함: false, 차단: '건수재확인',
      대상수: sel.대상.length,
      error: `정말 ${sel.대상.length}명 전원에게 보낼까요? 확인을 위해 이 숫자를 그대로 다시 보내주세요.` };
  }

  const 결과 = { 성공: 0, 실패: 0, 실패목록: [] };
  const 시작 = Date.now();
  for (let i = 0; i < sel.대상.length; i += 배치크기) {
    const 묶음 = sel.대상.slice(i, i + 배치크기);
    for (const 사람 of 묶음) {
      try {
        const r = await _deps.sendSms(ma, 사람.번호, 내용만들기(최종본문, 사람));
        if (r && r.sent) 결과.성공++;
        else { 결과.실패++; if (결과.실패목록.length < 200) 결과.실패목록.push({ 번호: _마스크(사람.번호), 이름: 사람.이름, 사유: (r && r.error) || '실패' }); }
      } catch (e) {
        결과.실패++;
        if (결과.실패목록.length < 200) 결과.실패목록.push({ 번호: _마스크(사람.번호), 이름: 사람.이름, 사유: e.message });
      }
    }
    if (i + 배치크기 < sel.대상.length) await new Promise((r) => setTimeout(r, 배치간격ms));
  }
  return { ok: true, 발송함: 결과.성공 > 0, 대상수: sel.대상.length,
    성공: 결과.성공, 실패: 결과.실패, 실패목록: 결과.실패목록,
    걸린초: Math.round((Date.now() - 시작) / 1000),
    안내: `${sel.대상.length}명 중 ${결과.성공}건 성공 · ${결과.실패}건 실패. 실제로 센 숫자입니다.` };
}

/**
 * ④ 예약 발송 준비 — 2026-07-28 대표님 지시.
 *   ★실제 예약은 솔라피가 들고 있는다(우리 서버는 번호를 저장하지 않는다 → 개인정보 서버 저장 0).
 *   ★즉시 발송과 ★똑같은 하드가드를 탄다: 승인 버튼 · 소량 테스트 · 건수 재확인 · 법규.
 *   ★광고성이면 예약 시각이 야간(21~08시)이어도 거부한다 — 그때 실제로 나가기 때문이다.
 *   @returns {{ok, messages, 대상수, 표시, error, 차단}}  messages는 호출부가 솔라피로 넘긴다.
 */
function 예약준비(opts) {
  const o = opts || {};
  if (o.humanApproval !== true) {
    return { ok: false, 차단: '승인버튼아님', error: '예약도 화면 [승인] 버튼으로만 걸 수 있어요. 말이나 글로는 걸리지 않습니다.' };
  }
  if (!o.tested) {
    return { ok: false, 차단: '테스트안함', error: '먼저 대표님 번호로 소량 테스트를 해주세요. 테스트 없이 예약은 막고 있습니다.' };
  }
  // 예약 시각 — 화면이 +09:00 오프셋을 붙여 보낸다(서버가 UTC라도 어긋나지 않게)
  const when = new Date(String(o.예약시각 || ''));
  if (!o.예약시각 || isNaN(when.getTime())) return { ok: false, 차단: '시각오류', error: '예약 시각을 정확히 골라주세요.' };
  if (when.getTime() <= Date.now() + 60000) return { ok: false, 차단: '지난시각', error: '지금보다 최소 1분 뒤로 잡아주세요.' };
  const kst = new Date(when.getTime() + 9 * 3600e3);
  const 시 = kst.getUTCHours();
  if (o.광고 && (시 >= 야간시작 || 시 < 야간끝)) {
    return { ok: false, 차단: '야간광고',
      error: `예약하신 시각이 ${시}시예요. 광고 문자는 야간(${야간시작}시~${야간끝}시)에 보낼 수 없습니다(정보통신망법). 낮 시간으로 잡아주세요.` };
  }
  const sel = 대상고르기(o.table, o);
  const { 본문: 최종본문 } = 법규적용(o.본문, !!o.광고, o.수신거부);
  const chk = 점검(최종본문, false);            // ★지금 시각 야간 검사는 안 한다 — 예약은 위에서 ★예약 시각으로 검사했다
  if (chk.막음.length) return { ok: false, 차단: '법규·내용', error: chk.막음.join(' ') };
  if (!sel.대상.length) return { ok: false, 차단: '대상0', error: '보낼 대상이 없어요.' };
  if (sel.대상.length >= 10 && o.confirmedCount !== sel.대상.length) {
    return { ok: false, 차단: '건수재확인', 대상수: sel.대상.length,
      error: `정말 ${sel.대상.length}명 전원에게 예약할까요? 확인을 위해 이 숫자를 그대로 다시 보내주세요.` };
  }
  const messages = sel.대상.map((p) => ({ to: p.번호, text: 내용만들기(최종본문, p) }));
  const 표시 = `${kst.toISOString().slice(0, 10)} ${String(시).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
  return { ok: true, messages, 대상수: sel.대상.length, 표시, 예약ISO: when.toISOString() };
}

module.exports = { init, 대상고르기, 미리보기, 테스트발송, 발송, 예약준비, 법규적용, 점검, 비용, 내용만들기, _마스크 };
