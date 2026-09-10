@echo off
rem Copy Electron to DeepSeekHarness.exe and stamp a BMP ICO.
rem Windows taskbar groups by executable name; electron.exe always shows the default icon.
setlocal
set "ROOT=%~dp0.."
set "SRC=%ROOT%\node_modules\electron\dist\electron.exe"
set "DEST=%ROOT%\node_modules\electron\dist\DeepSeekHarness.exe"
set "ICO=%ROOT%\assets\deepseek-win.ico"
if not exist "%ICO%" set "ICO=%ROOT%\assets\deepseek.ico"
set "RCEDIT=%ROOT%\node_modules\rcedit\bin\rcedit.exe"
if not exist "%SRC%" exit /b 0
if not exist "%ICO%" exit /b 0
if not exist "%RCEDIT%" exit /b 0
copy /Y "%SRC%" "%DEST%" >nul
"%RCEDIT%" "%DEST%" --set-icon "%ICO%"
endlocal
