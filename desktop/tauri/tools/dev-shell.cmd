@echo off
setlocal

call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\LaunchDevCmd.bat" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b %errorlevel%

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

pnpm dev
exit /b %errorlevel%
