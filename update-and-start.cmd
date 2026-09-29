@echo off
rem Update the official DeepSeek Harness desktop checkout, rebuild only what the
rem incoming commits need, then launch it. Upstream files stay untouched, so the
rem git pull is always a fast-forward.
rem
rem Options are forwarded, for example: update-and-start.cmd --check
setlocal
set "ROOT=%~dp0.."
set "NODE=D:\Compile\Node\node.exe"
if not exist "%NODE%" set "NODE=node"
cd /d "%ROOT%"
"%NODE%" "%ROOT%\desktop\update-and-start.js" %*
endlocal
