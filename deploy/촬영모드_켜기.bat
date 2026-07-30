@echo off
chcp 65001 >nul
title 🎬 지니야 촬영 모드 (샘플 80명)
cd /d "%~dp0"

echo.
echo  ═══════════════════════════════════════════════
echo    🎬 지니야 촬영 모드
echo   ───────────────────────────────────────────────
echo    명단   : 촬영용 샘플 80명 (가짜 고객)
echo    구글   : 실제 고객 시트 안 봅니다
echo    발송   : 문자·메일 전부 막혀 있습니다
echo   ═══════════════════════════════════════════════
echo.
echo    잠시 후 브라우저가 열립니다. 끄실 땐 이 검은 창을 닫으세요.
echo.

set FILMING_MODE=1

start "" cmd /c "timeout /t 6 >nul & start http://localhost:8080/login"
node main_server.js

echo.
echo  촬영 모드가 종료됐습니다. 아무 키나 누르면 창이 닫힙니다.
pause >nul
