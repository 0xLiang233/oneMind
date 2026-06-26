@echo off
setlocal

set "EXE=%~dp0..\src-tauri\target\debug\onemind-tauri-probe.exe"
set "LOG=%TEMP%\onemind-tauri-probe-main.log"

echo Launching: %EXE%
echo Main log : %LOG%
echo.

if exist "%LOG%" del /f /q "%LOG%"

start "" "%EXE%"

echo If the window hangs or turns white, check:
echo %LOG%
