@echo off
setlocal

set "EXE=%~dp0..\src-tauri\target\release\onemind-desktop-tauri.exe"
set "LOG=%TEMP%\onemind-tauri-main.log"

echo Launching: %EXE%
echo Main log : %LOG%
echo.

start "" "%EXE%"
