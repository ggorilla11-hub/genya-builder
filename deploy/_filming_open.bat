@echo off
rem Waits until the filming server answers, then opens the browser.
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
start "" "http://localhost:8080/"
exit /b 0
:giveup
exit /b 1
