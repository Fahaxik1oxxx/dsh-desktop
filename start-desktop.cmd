@echo off
rem DeepSeek Harness 桌面版启动器（备用；桌面快捷方式一般直接指向 electron.exe）
setlocal
set "ELEC=%~dp0node_modules\electron\dist\electron.exe"
if not exist "%ELEC%" (
  echo [ERROR] Electron 未安装。请先进入 desktop 目录执行: npm install
  pause
  exit /b 1
)
start "DeepSeek Harness" /D "%~dp0" "%ELEC%" .
endlocal
