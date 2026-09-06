@echo off
rem Copy Electron to dsh-desktop.exe and stamp deepseek.ico (Windows taskbar groups by exe name).
setlocal
set "ROOT=%~dp0.."
set "SRC=%ROOT%\node_modules\electron\dist\electron.exe"
set "DEST=%ROOT%\node_modules\electron\dist\dsh-desktop.exe"
set "ICO=%ROOT%\deepseek.ico"
set "RCEDIT=%ROOT%\node_modules\rcedit\bin\rcedit.exe"
if not exist "%SRC%" exit /b 0
if not exist "%ICO%" exit /b 0
if not exist "%RCEDIT%" exit /b 0
copy /Y "%SRC%" "%DEST%" >nul
"%RCEDIT%" "%DEST%" --set-icon "%ICO%"
endlocal
