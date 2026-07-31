// ─────────────────────────────────────────────────────────────
// filming_solapi.js — 🎬 촬영용 문자키 보관함 (메모리)
//
// 무엇을·왜: 촬영 씬6에서 [승인] → 대표님 폰에 문자가 와야 한다.
//   그런데 문자키 저장은 ①구글 로그인 ②Firestore ③TOKEN_ENC_KEY 세 가지를 요구한다.
//   촬영은 비로그인이고 로컬엔 그 자격이 없어 아예 등록을 못 했다.
//   → 명단(filming_roster)·결재함(filming_approval)에서 검증된 방식 그대로 ★메모리 보관함을 둔다.
//
// ★안전:
//   - 촬영 모드에서만 쓰인다. 라이브는 이 파일을 require 조차 안 한다.
//   - 서버를 끄면 사라진다(디스크·구글에 안 남는다).
//   - ★키 값은 로그·응답에 절대 안 찍는다(앞 4자리 힌트만).
//   - 발신번호를 ★수신 화이트리스트로도 쓴다 → 승인해도 대표님 폰 한 곳으로만 간다.
// ─────────────────────────────────────────────────────────────
'use strict';

let _keys = null;   // { apiKey, apiSecret, sender }

/** 저장(덮어쓰기). 번호는 숫자만 남긴다. */
function save(apiKey, apiSecret, sender) {
  apiKey = String(apiKey || '').trim();
  apiSecret = String(apiSecret || '').trim();
  sender = String(sender || '').replace(/[^0-9]/g, '');
  if (!apiKey || !apiSecret || !sender) return { ok: false, error: 'API Key·Secret·발신번호를 모두 넣어 주세요.' };
  _keys = { apiKey, apiSecret, sender };
  // ★발신번호를 수신 화이트리스트로도 건다 — 승인해도 ★대표님 폰 한 곳으로만 나간다.
  //   (approval_skill 의 안전모드가 이 값을 읽어 수신자를 강제 교체한다)
  process.env.SAFE_PHONE_WHITELIST = sender;
  console.log('[🎬촬영문자키] 등록됨 · 발신번호 ***' + sender.slice(-4) + ' · 수신 화이트리스트도 같은 번호(키 미출력)');
  return { ok: true, keyHint: apiKey.slice(0, 4), sender };
}

/** 조회. 없으면 null (호출부가 "등록해 주세요"로 안내) */
function load() { return _keys ? { apiKey: _keys.apiKey, apiSecret: _keys.apiSecret, sender: _keys.sender } : null; }
function has() { return !!_keys; }
function clear() { _keys = null; }

module.exports = { save, load, has, clear };
