# -*- coding: utf-8 -*-
# B-2 인터랙션 층 — 1-1 엔진(kakao_send.KakaoGUI) 위에. ★사람이 한 명씩 개인문구+엔터 → 발송.
# ★발송 주체=사람(매 건 작성·엔터)=최강 방어 + 노가다 0(검색·열기·주입·전송은 지니야 자동).
# ★DRY_RUN 기본·발송0. 실전송 = --send --arm-send + consent.ack + 본인 1건부터. 야간/킬스위치/내용점검/대화이력(검색0=새 방0) 적용.
# 사용: python kakao_b2.py safe-list.json ["공통인사 {이름} 가능"] [--send] [--arm-send] [--image 경로]
import sys, os, json, datetime
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass
try: sys.stdin.reconfigure(encoding="utf-8")
except Exception: pass
# ★1-4 통합: 게이트·가드·한건처리를 kakao_send 공통 함수로 (A·B 동일 코드 = 드리프트 0)
from kakao_send import (KakaoGUI, mask, audit, preflight, run_guard, process_recipient)

def main():
    args = sys.argv[1:]
    if not args:
        print('사용: python kakao_b2.py safe-list.json ["공통인사"] [--send] [--arm-send] [--image 경로]'); return
    path = args[0]
    send = "--send" in args
    arm = "--arm-send" in args
    dry = not send
    image = None
    positional = []
    skip_next = False
    for idx, a in enumerate(args[1:], start=1):
        if skip_next: skip_next = False; continue
        if a == "--image": image = args[idx + 1] if idx + 1 < len(args) else None; skip_next = True; continue
        if a.startswith("--"): continue
        positional.append(a)
    greeting = positional[0] if positional else "안녕하세요 {이름}님, 잘 지내시죠?"

    with open(path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)
    recipients = data.get("recipients", []) if isinstance(data, dict) else []

    print("=== B-2 인터랙션 (사람이 한 명씩 개인문구+엔터) ===  모드:",
          "DRY_RUN(발송0)" if dry else ("★전송 ARM" if arm else "★주입까지(발송0)"))
    print("공통인사:", greeting, "|", ("이미지:" + image if image else "이미지 없음"))
    print("명령: 엔터=보냄, s=이 사람 건너뜀, q=종료\n")

    gui = None
    if not dry:
        ok, why = preflight(arm)                        # ★공통 게이트(면책·킬스위치·야간) = A와 동일
        if not ok: print("★중단:", why); return
        try: gui = KakaoGUI()
        except Exception as e: print("카톡 연결 실패:", e, "→ WINDOW_TITLE·--inspect 확인."); return

    counters = {"sent": 0, "hour_sent": 0, "hour": datetime.datetime.now().hour, "fail_streak": 0}
    tally = {}; skipped = 0
    for i, r in enumerate(recipients):
        stop = run_guard(counters, arm)                 # ★공통 가드(상한·야간·킬스위치·이상신호) = A와 동일
        if stop: print("■ 중단:", stop); audit({"event": "stop", "reason": stop}); break
        name = r.get("name") or "고객"
        hello = greeting.replace("{이름}", name)
        print(f"[{i+1}/{len(recipients)}] {name}님  ({mask(r.get('phone'))})")
        print("   공통:", hello)
        try:
            personal = input(f"   {name}님 개인문구> ")
        except EOFError:
            print("(입력 종료)"); break
        cmd = personal.strip().lower()
        if cmd == "q": print("종료."); break
        if cmd == "s": skipped += 1; audit({"event": "skip", "reason": "user-skip", "name": name}); print("   건너뜀\n"); continue
        full = hello + ("\n" + personal if personal.strip() else "")
        out = process_recipient(gui, name, r.get("phone"), full, image, arm, dry, counters)   # ★공통 처리
        tally[out] = tally.get(out, 0) + 1
        print()

    print("\n결과:", tally, "| 사용자건너뜀 %d" % skipped, "(%s)" % ("DRY_RUN=발송0" if dry else ("전송" if arm else "주입=발송0")))

if __name__ == "__main__":
    main()
