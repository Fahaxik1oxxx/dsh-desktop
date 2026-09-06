@echo off
rem DeepSeek Harness 桌面版启动器。优先启动带应用图标的 DeepSeekHarness.exe，
rem 这样 Windows 任务栏按该文件名分组，而不是 Electron 默认图标。
setlocal
set "DIST=%~dp0node_modules\electron\dist"
set "APP=%DIST%\DeepSeekHarness.exe"
set "ELEC=%DIST%\electron.exe"
if exist "%APP%" (
  start "DeepSeek Harness" /D "%~dp0" "%APP%" .
  endlocal
  exit /b 0
)
if not exist "%ELEC%" (
  echo [ERROR] Electron 未安装。请先进入 desktop 目录执行: npm install
  pause
  exit /b 1
)
start "DeepSeek Harness" /D "%~dp0" "%ELEC%" .
endlocal
