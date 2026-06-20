# -*- coding: utf-8 -*-
# 안전장치 자가 실측 (★발송 0·카톡 무접촉·pywinauto 불필요). FakeGUI로 각 가드를 발동시켜 PASS/FAIL.
import sys, os, datetime
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass
import kakao_send as K

PASS = 0; FAIL = 0
def check(label, cond):
    global PASS, FAIL
    print(("  PASS  " if cond else "  FAIL  ") + label)
    if cond: PASS += 1
    else: FAIL += 1

class FakeGUI:   # ★카톡 미접촉: 검색은 friends 집합으로, 전송은 로그만(발송 0)
    def __init__(self, friends): self.friends = set(friends); self.log = []
    def search_and_check(self, name): return name in self.friends
    def open_first_and_send(self, text, image=None, arm=False): self.log.append((text, arm))   # 실제 전송 없음

now_h = datetime.datetime.now().hour

print("=== 안전장치 자가 실측 (발송 0) ===")

# 5) 내용 자체점검
check("자체점검: 광고성 문구 → 경고", len(K.content_flags("할인 이벤트 구매하세요")) > 0)
check("자체점검: 정상 문구 → 경고 없음", len(K.content_flags("안녕하세요, 잘 지내시죠?")) == 0)

# 6) 킬스위치
open(K.STOP_FILE, "w").close()
check("킬스위치: STOP 파일 → run_guard 중단", K.run_guard({"hour": now_h}, arm=False) == "킬스위치(STOP)")
os.remove(K.STOP_FILE)

# 3) 상한
check("상한: 하루 상한 도달 → 중단", K.run_guard({"sent": K.DAILY_CAP, "hour": now_h}, arm=False) is not None)
check("상한: 시간당 상한 도달 → 중단", K.run_guard({"hour_sent": K.HOURLY_CAP, "hour": now_h}, arm=False) is not None)

# 7) 이상신호
check("이상신호: 연속 실패 → 중단", K.run_guard({"fail_streak": K.FAIL_STOP, "hour": now_h}, arm=False) is not None)

# 4) 야간(현재 시각 기준 — 정보)
gd = K.run_guard({"hour": now_h}, arm=True)
print("  INFO  야간차단: 지금 %d시 → arm preflight/guard=%s" % (now_h, gd or "통과(주간)"))

# 8) 면책 동의 게이트
if os.path.exists(K.CONSENT_FILE): os.remove(K.CONSENT_FILE)
ok, why = K.preflight(arm=True)
check("면책: consent.ack 없으면 차단", (not ok) and "면책" in why)
open(K.CONSENT_FILE, "w").close()
# 동의 후엔 (야간/킬스위치 없으면) 통과 — 야간이면 야간으로 차단되는게 정상
ok2, why2 = K.preflight(arm=False)   # arm=False라 야간 무관
check("면책: consent.ack 있으면 통과(arm=False)", ok2)
os.remove(K.CONSENT_FILE)

# 1) 대화이력만(검색0→skip·새방0) + 9) 감사 + DRY_RUN
g = FakeGUI(friends=["홍길동"])
cnt = {"sent":0,"hour_sent":0,"hour":now_h,"fail_streak":0}
check("대화이력: 검색0(친구아님) → skip(새 방 0)", K.process_recipient(g, "낯선이", "010", "hi", None, arm=False, dry=False, counters=cnt) == "skip")
check("대화이력: 친구 + arm=False → injected(발송0)", K.process_recipient(g, "홍길동", "010", "hi", None, arm=False, dry=False, counters=cnt) == "injected")
check("발송0 확인: FakeGUI 전송로그에 arm=True 없음", all(arm is False for _, arm in g.log))

# DRY_RUN
check("DRY_RUN: process_recipient → plan(발송0)", K.process_recipient(None, "아무개", "010", "hi", None, arm=False, dry=True, counters=cnt) == "plan")

print("\n결과: PASS %d · FAIL %d  (★실제 카톡 전송 0)" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
