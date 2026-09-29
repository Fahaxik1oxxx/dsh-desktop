@echo off
rem Open the console output of the last hidden launch in Notepad.
rem
rem Keep this file ASCII-only with CRLF endings: cmd.exe mis-parses LF-only
rem batch files that contain UTF-8 multibyte characters.
setlocal
set "ROOT=%~dp0"
set "LOG=%ROOT%logs\desktop.log"
if not exist "%ROOT%logs" mkdir "%ROOT%logs"
if not exist "%LOG%" echo (no launch log yet - run the DeepSeek Harness shortcut first) > "%LOG%"
start "" notepad "%LOG%"
endlocal
