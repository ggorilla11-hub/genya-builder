@echo off
title 지니야 촬영 모드 (샘플 80명)
cd /d "%~dp0"

echo.
echo  ==================================================
echo     [ 지니야 촬영 모드 ]
echo  --------------------------------------------------
echo     명단 : 촬영용 샘플 80명 (가짜 고객)
echo     구글 : 실제 고객 시트 안 봅니다
echo     발송 : 문자, 메일 전부 막혀 있습니다
echo  ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [멈춤] node 를 찾을 수 없습니다.
  echo         Node.js 가 설치돼 있어야 합니다.
  echo.
  pause
  exit /b 1
)

if not exist "main_server.js" (
  echo  [멈춤] main_server.js 가 이 폴더에 없습니다.
  echo         지금 폴더: %CD%
  echo.
  pause
  exit /b 1
)

set FILMING_MODE=1
set PORT=8080

echo  서버를 켜는 중입니다. 준비되면 브라우저가 저절로 열립니다.
echo  끄실 때는 이 검은 창을 닫으세요.
echo.

start "" /min "%~dp0_filming_open.bat"

node main_server.js

echo.
echo  촬영 모드가 종료됐습니다. 아무 키나 누르면 창이 닫힙니다.
pause >nul
