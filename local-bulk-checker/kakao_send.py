# -*- coding: utf-8 -*-
# B-2 카카오톡 개인톡 발송 (대표 PC 로컬 · pywinauto) — ★안전 최우선.
#
# ★★ 1번 원칙: 회원 한 명의 카톡 계정도 잃지 않는다.
# ★ 기본 = DRY_RUN(발송 0·카톡 무접촉, 계획만 출력). 실제 발송은 --send + 면책동의(consent.ack) + 본인 확인 후에만.
# ★ 대화이력 안전: 카톡 "검색" 자체가 필터(친구 아니면 검색조차 안 됨). 검색 결과 0 → 자동 건너뜀(새 채팅방 0).
# ★ 발송 주체 = 사람(B-2: 사람이 개인문구 작성). 이 스크립트는 검색·열기·주입·전송의 '노가다'만 자동화.
# ★ 엄마(개발팀장)는 대표 실계정 미접촉 — 실제 실행·셀렉터 튜닝은 대표 환경(본인 1건 → 극소량).
#
# 입력: safe-list.json = { "recipients": [ {"name","phone","text"[, "image"]}, ... ] }
#   (text = 공통인사+개인문구 합본. text 없으면 'no-text'로 건너뜀 — 빈 발송 금지)
# 사용:
#   python kakao_send.py safe-list.json            # DRY_RUN(기본): 계획만, 발송 0
#   python kakao_send.py safe-list.json --send     # 실발송(★consent.ack 필요 + 본인 1건부터)
#
# 안전장치: 대화이력만(검색필터)·새 방 0·40초+지터·하루/시간 상한·야간(21~08) 차단·킬스위치(STOP 파일)·
#           이상신호 자동정지·내용 자체점검(스팸/광고)·감사로그(audit.jsonl, 로컬)·면책 동의(consent.ack).

import sys, os, json, time, random, datetime
try: sys.stdout.reconfigure(encoding="utf-8")   # 콘솔 cp949에서도 한글·기호(⚠) 안 깨지게
except Exception: pass
try: sys.stdin.reconfigure(encoding="utf-8")    # 한글 입력/redirect 안정
except Exception: pass

PER_MSG_SEC = 40            # 건당 최소 간격(초)
JITTER_SEC = 6              # ±지터
DAILY_CAP = 50             # 하루 상한(소량)
HOURLY_CAP = 30
NIGHT_START, NIGHT_END = 21, 8   # 야간(21~08) 차단
FAIL_STOP = 5              # 연속 실패 이 수 이상 → 자동 정지(이상신호)
WINDOW_TITLE = "카카오톡"    # ★본인 1건에서 실제 창 제목으로 튜닝
STOP_FILE = "STOP"          # 이 파일 생기면 즉시 중단(킬스위치)
CONSENT_FILE = "consent.ack"  # 면책 동의 표시 파일(실발송 전 본인이 생성)
AUDIT = "audit.jsonl"

AD_WORDS = ["광고","홍보","판매","구매","할인","특가","이벤트","무료","쿠폰","적립","세일","프로모"]
SPAM_WORDS = ["대출","도박","카지노","코인","원금보장","투자수익"]

def content_flags(text):
    t = text or ""
    ad = [w for w in AD_WORDS if w in t]
    spam = [w for w in SPAM_WORDS if w in t]
    flags = []
    if spam: flags.append("규제/스팸 의심: " + ",".join(spam))
    if ad and "(광고)" not in t: flags.append("광고성(" + ",".join(ad) + ") → (광고)표시·수신거부·야간금지 필요")
    return flags

def mask(p):
    d = "".join(ch for ch in str(p or "") if ch.isdigit())
    return "***" if len(d) < 7 else d[:3] + "-****-" + d[-4:]

def is_night():
    h = datetime.datetime.now().hour
    return h >= NIGHT_START or h < NIGHT_END

def killed():
    return os.path.exists(STOP_FILE)

def audit(rec):
    rec["ts"] = datetime.datetime.now().isoformat()
    with open(AUDIT, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

# ── 1-4: 안전장치 통합 — A·B 공통 게이트(preflight) + 자가점검(safety_report) ──
SAFETY = [
    ("DRY_RUN 기본", "실제 전송은 --send + --arm-send 둘 다 있어야"),
    ("면책 동의", CONSENT_FILE + " 있어야 실 GUI(책임=발송자)"),
    ("대화이력만(새 방 0)", "검색 결과 0이면 건너뜀(친구 아님=대화이력 없음)"),
    ("속도", "건당 %d초 ±%d 지터" % (PER_MSG_SEC, JITTER_SEC)),
    ("상한", "하루 %d · 시간 %d" % (DAILY_CAP, HOURLY_CAP)),
    ("야간 차단", "%d~%d시 전송 금지" % (NIGHT_START, NIGHT_END)),
    ("킬스위치", STOP_FILE + " 파일 생기면 즉시 중단"),
    ("이상신호 자동정지", "연속 실패 %d → 정지(우회 0)" % FAIL_STOP),
    ("내용 자체점검", "스팸/광고 필터 + (광고)표시 안내"),
    ("개인정보", "번호 마스킹·로컬 only(서버 0)·감사로그"),
]

def preflight(arm):
    # 실 GUI 실행 전 공통 게이트(A·B 동일). (ok, 사유)
    if not os.path.exists(CONSENT_FILE):
        return False, "면책 동의(%s) 없음 — 위험 인지·책임 귀속 동의 후 생성" % CONSENT_FILE
    if killed():
        return False, "킬스위치(%s) 활성" % STOP_FILE
    if arm and is_night():
        return False, "야간(%d~%d시) 전송 금지" % (NIGHT_START, NIGHT_END)
    return True, "OK"

def safety_report():
    print("=== 안전장치 점검 (★발송 0·읽기·카톡 무접촉) ===")
    for i, (name, desc) in enumerate(SAFETY, 1):
        print("  %2d. %s — %s" % (i, name, desc))
    print("  ─ 현재상태: 면책동의=%s · 킬스위치=%s · 야간=%s" % (
        "있음" if os.path.exists(CONSENT_FILE) else "없음(실GUI 잠금)",
        "활성(중단)" if killed() else "해제",
        "예(전송차단)" if is_night() else "아니오"))
    ok, why = preflight(arm=True)
    print("  ─ preflight(전송ARM 가정): %s%s" % ("통과" if ok else "차단 — ", "" if ok else why))
    print("★ 실제 전송은 --send + --arm-send + consent.ack + 본인 1건부터. 이 점검은 발송 0.")

# ── 클립보드 헬퍼(한글/이모지·이미지 안정 주입) — 베스트에포트, 미설치면 폴백 안내 ──
def _set_clipboard_text(t):
    try:
        import win32clipboard
        win32clipboard.OpenClipboard(); win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardText(t, win32clipboard.CF_UNICODETEXT)
        win32clipboard.CloseClipboard()
    except Exception:
        import subprocess
        subprocess.run("clip", input=t.encode("utf-16-le"), shell=True)   # 폴백(Windows clip)

def _set_clipboard_image(path):
    try:
        from PIL import Image; import io, win32clipboard
        img = Image.open(path).convert("RGB")
        out = io.BytesIO(); img.save(out, "BMP"); data = out.getvalue()[14:]; out.close()
        win32clipboard.OpenClipboard(); win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(win32clipboard.CF_DIB, data); win32clipboard.CloseClipboard()
        return True
    except Exception as e:
        print("      (이미지 클립보드 실패 → 대표 PC에 'pip install pillow pywin32' 또는 이미지인식 폴백:", e, ")")
        return False

# ── 실제 GUI (pywinauto) — DRY_RUN이 아닐 때만 import·실행. ★창제목·셀렉터·좌표는 대표 PC에서 inspect로 튜닝 ──
# ★요소 못 잡으면 이미지인식(좌표) 폴백: pip install pyautogui opencv-python →
#   pyautogui.locateCenterOnScreen('검색창.png') 등으로 버튼/입력창 좌표 찾아 click/typewrite. (대표 PC 캡처 기반)
class KakaoGUI:
    def __init__(self):
        from pywinauto import Desktop          # lazy import (DRY_RUN/inspect 외엔 불필요)
        self.win = Desktop(backend="uia").window(title_re=WINDOW_TITLE + ".*")
        self.win.wait("exists ready", timeout=10)

    def inspect(self):
        # ★읽기 전용(발송 0): 카톡 창 컨트롤 트리 출력 → 대표 PC에서 검색창/결과리스트/입력창 셀렉터 확정용.
        self.win.print_control_identifiers(depth=4)

    def _edits(self):
        return self.win.descendants(control_type="Edit")

    def search_and_check(self, name):
        # 검색창 포커스 → 비우기 → 이름 입력 → 결과 ListItem 유무. ★검색 0 = 친구 아님 → False(건너뜀·새 방 0).
        # TODO(대표 PC 튜닝): 검색 Edit가 _edits()[0]인지 inspect로 확인. 단축키 검색 있으면 그걸로. 못 잡으면 이미지인식 폴백.
        try:
            search = self._edits()[0]                      # 잠정: 첫 Edit = 검색창
            search.set_focus()
            search.type_keys("^a{BACKSPACE}", set_foreground=True)
            search.type_keys(name, with_spaces=True)
        except Exception as e:
            print("   (검색창 못 잡음 → 이미지인식 좌표 폴백 필요:", e, ")"); return False
        time.sleep(1.2)                                    # 결과 로딩 대기
        items = self.win.descendants(control_type="ListItem")   # TODO: 결과 리스트 정확 셀렉터(inspect)
        return len(items) > 0

    def open_first_and_send(self, text, image=None, arm=False):
        # 첫 결과 열기 → 입력창 포커스 → (이미지)·텍스트 주입 → ★arm일 때만 전송(Enter). arm 아니면 주입까지(발송 0).
        items = self.win.descendants(control_type="ListItem")
        if not items: raise RuntimeError("검색 결과 없음")
        items[0].double_click_input()                      # TODO: 클릭/더블클릭/Enter 실제 동작 확인
        time.sleep(1.0)
        box = self._edits()[-1]                             # 잠정: 마지막 Edit = 메시지 입력창
        box.set_focus()
        if image:
            if _set_clipboard_image(image):
                box.type_keys("^v"); time.sleep(0.8)       # ★카톡이 붙여넣기 확인 1단계 띄울 수 있음(주의)
        _set_clipboard_text(text)                          # 한글/이모지 안정 → 클립보드 경유
        box.type_keys("^v"); time.sleep(0.3)
        if arm:
            box.type_keys("{ENTER}")                       # ★실제 전송. arm=False면 여기 안 옴 = 발송 0
        else:
            print("      (--arm-send 아님 → 주입까지만, 전송 안 함 = 발송 0)")

# ── 1-4: 매 건 공통 가드 + 한 건 처리 (A·B-2 동일 코드 = 드리프트 0) ──
def run_guard(counters, arm):
    # 매 건 전 점검: 킬스위치·이상신호·하루/시간 상한·야간. 중단 사유(str) 또는 None.
    if killed(): return "킬스위치(STOP)"
    h = datetime.datetime.now().hour
    if counters.get("hour") != h: counters["hour"] = h; counters["hour_sent"] = 0   # 시간 경계 리셋
    if counters.get("fail_streak", 0) >= FAIL_STOP: return "이상신호(연속 실패 %d)" % FAIL_STOP
    if counters.get("sent", 0) >= DAILY_CAP: return "하루 상한(%d)" % DAILY_CAP
    if counters.get("hour_sent", 0) >= HOURLY_CAP: return "시간당 상한(%d)" % HOURLY_CAP
    if arm and is_night(): return "야간(%d~%d) 차단" % (NIGHT_START, NIGHT_END)
    return None

def process_recipient(gui, name, phone, text, image, arm, dry, counters):
    # 한 건 처리(A·B-2 공통): 내용점검 → dry 시뮬 / 실GUI(검색0=skip·새방0 / 주입·전송). outcome 반환.
    flags = content_flags(text)
    if flags: print("   ⚠ 내용점검:", " / ".join(flags))
    if dry:
        print("   → (DRY_RUN) %s님 전송예정: %s ★발송0" % (name, text.replace(chr(10), " / ")))
        audit({"event": "plan", "name": name}); return "plan"
    try:
        if not gui.search_and_check(name):
            audit({"event": "skip", "reason": "not-found(대화이력없음)", "name": name})
            print("   건너뜀(검색 0 = 친구 아님 → 새 방 0)"); return "skip"
        gui.open_first_and_send(text, image, arm)
    except Exception as e:
        counters["fail_streak"] = counters.get("fail_streak", 0) + 1
        audit({"event": "fail", "name": name, "err": str(e)[:120]}); print("   실패:", e); return "fail"
    counters["fail_streak"] = 0
    if arm:
        counters["sent"] = counters.get("sent", 0) + 1
        counters["hour_sent"] = counters.get("hour_sent", 0) + 1
        audit({"event": "sent", "name": name, "flags": flags}); print("   [전송]")
        time.sleep(PER_MSG_SEC + random.randint(-JITTER_SEC, JITTER_SEC))
    else:
        audit({"event": "injected", "name": name}); print("   [주입·발송0]")
    return "sent" if arm else "injected"

def main():
    args = sys.argv[1:]
    if not args:
        print("사용: python kakao_send.py safe-list.json [--check|--inspect|--send] [--arm-send]"); return
    if "--check" in args:   # 안전장치 자가점검(발송 0·파일 불필요)
        safety_report(); return
    path = args[0]
    inspect = "--inspect" in args
    send = "--send" in args
    arm = "--arm-send" in args            # ★실제 전송(Enter)은 이 플래그까지 있어야(본인 1건 검증 후). 없으면 주입까지=발송 0
    dry = not (send or inspect)

    # ── --inspect: 읽기 전용(발송 0) — 카톡 컨트롤 트리 출력(대표 PC에서 셀렉터 확정용) ──
    if inspect:
        print("=== --inspect (읽기 전용·발송 0): 카톡 컨트롤 트리 출력 ===")
        try:
            KakaoGUI().inspect()
        except Exception as e:
            print("카톡 창 연결 실패:", e, "→ 작업표시줄의 실제 창 이름으로 WINDOW_TITLE 수정 필요.")
        return

    with open(path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)
    recipients = data.get("recipients", []) if isinstance(data, dict) else []

    print("=== A 연속 자동 발송 ===  모드:", "DRY_RUN(발송 0·카톡 무접촉)" if dry else ("★전송 ARM" if arm else "★주입까지(발송 0·검증)"))
    gui = None
    if not dry:
        ok, why = preflight(arm)                       # ★공통 게이트(면책·킬스위치·야간) = A·B 동일
        if not ok: print("★중단:", why); return
        print("★" + ("전송 ARM" if arm else "주입까지(발송0·검증)") + " — 대화이력(검색0=새방0)·40초·상한·야간·킬스위치·이상정지·자체점검 적용. 본인 1건부터.")
        try:
            gui = KakaoGUI()
        except Exception as e:
            print("카톡 창 연결 실패:", e, "→ WINDOW_TITLE·--inspect 확인."); return

    counters = {"sent": 0, "hour_sent": 0, "hour": datetime.datetime.now().hour, "fail_streak": 0}
    tally = {}
    skipped = 0
    for i, r in enumerate(recipients):
        stop = run_guard(counters, arm)                # ★공통 가드(상한·야간·킬스위치·이상신호)
        if stop: print("■ 중단:", stop); audit({"event": "stop", "reason": stop}); break
        name = (r.get("name") or "고객"); text = r.get("text") or ""; image = r.get("image")
        if not text:
            skipped += 1; audit({"event": "skip", "reason": "no-text", "name": name}); print("[%d/%d] %s — 문구 없음(건너뜀)" % (i + 1, len(recipients), name)); continue
        print("[%d/%d] %s %s" % (i + 1, len(recipients), name, mask(r.get("phone"))))
        out = process_recipient(gui, name, r.get("phone"), text, image, arm, dry, counters)   # ★공통 처리
        tally[out] = tally.get(out, 0) + 1
    print("\n결과:", tally, "| 건너뜀(문구없음) %d" % skipped, "(%s)" % ("DRY_RUN=발송0" if dry else ("전송" if arm else "주입=발송0")))
    if dry: print("★ 발송 0. 실발송 = --send + --arm-send + consent.ack + 본인 1건부터. (안전점검: --check)")

if __name__ == "__main__":
    main()
