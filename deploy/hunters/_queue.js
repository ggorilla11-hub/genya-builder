// ─────────────────────────────────────────────────────────────
// hunters/_queue.js — 채널별 "한 줄 세우기" 공용 부품 (기자가 아님·_ 로 시작하므로 자동등록 제외)
//
// 왜 필요한가(2026-07-27 실제 사고):
//   네이버 4채널이 키 한 세트를 공유하는데 AI 여러 명이 동시에 나가면서
//   "Rate limit exceeded"가 떠 블로그·뉴스가 통째로 실패했다.
//   → 같은 회사 API로 나가는 호출을 ★한 줄로 세우고 사이에 간격을 둔다.
//   하루 한도는 넉넉해도 ★초당 속도는 막힌다.
// ─────────────────────────────────────────────────────────────
'use strict';

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 회사별로 독립된 대기줄을 만든다(네이버 줄과 카카오 줄은 서로 안 막는다).
 * @param gapMs 호출 사이 간격
 * @param retry 속도 제한이면 몇 번까지 다시 시도할지
 * @param isRate 응답이 "속도 제한"인지 판정하는 함수
 */
function makeQueue(gapMs, retry, isRate) {
  let chain = Promise.resolve();
  function queued(fn) {
    const run = chain.then(async () => {
      for (let t = 0; t <= retry; t++) {
        const r = await fn();
        // 속도 제한이면 조금 더 쉬었다 다시 — 실패로 버리지 않는다
        if (isRate && isRate(r)) { if (t < retry) { await _sleep(gapMs * (t + 2) * 3); continue; } }
        return r;
      }
    });
    // 다음 호출은 이 호출이 끝나고 gapMs 뒤에 (실패해도 줄은 계속 흐른다)
    chain = run.then(() => _sleep(gapMs), () => _sleep(gapMs));
    return run;
  }
  return { queued };
}

module.exports = { makeQueue };
