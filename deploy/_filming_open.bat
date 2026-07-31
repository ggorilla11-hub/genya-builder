@echo off
rem Waits until the filming server answers, then opens it in CHROME.
rem ASCII only on purpose - this file must never depend on codepage.
setlocal
set N=0
:wait
set /a N+=1
if %N% gtr 90 goto giveup
curl -s -o nul "http://localhost:8080/health"
if errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait
)

rem --- Chrome first (filming must open in Chrome, not Edge) ---
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if defined CHROME (
  start "" "%CHROME%" "http://localhost:8080/"
  exit /b 0
)

rem --- Chrome not found: fall back to the default browser so filming still works ---
start "" "http://localhost:8080/"
exit /b 0

:giveup
exit /b 1
