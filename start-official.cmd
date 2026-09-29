@echo off
rem Launch the official DeepSeek Harness desktop shell (apps/desktop).
rem
rem The shell itself is upstream code; this launcher only supplies the local
rem checkout and environment. `start:desktop` skips the build and reuses the
rem artifacts already present under apps/desktop/lib and apps/desktop-host/lib,
rem so run `pnpm run dev:desktop` once after pulling new sources.
rem
rem First launch also prepares the bundled runtime (Node + Python, ~270 MB) and
rem can take several minutes; a slow or filtered network may need HTTPS_PROXY.
rem
rem Keep this file ASCII-only with CRLF endings: cmd.exe mis-parses LF-only
rem batch files that contain UTF-8 multibyte characters.
setlocal
set "ROOT=%~dp0.."
set "NODE=D:\Compile\Node\node.exe"
if not exist "%NODE%" set "NODE=node"
cd /d "%ROOT%"

rem Use the real harness home so sessions, workspaces, and credentials are the
rem ones the user already has. Without this the development launcher would
rem create an empty home under apps/desktop/.desktop-build.
if not defined DSH_HOME set "DSH_HOME=%USERPROFILE%\.dsh"

rem Daily use: no automatic Renderer DevTools window (F12 still toggles it).
set "DSH_DESKTOP_OPEN_DEVTOOLS=0"

rem Only consulted when the Electron binary still has to be downloaded.
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"

rem Repair the environment, then launch. start.js prunes dangling pnpm
rem virtual-hoist links (the upstream launcher realpathSyncs every link and
rem fails with ENOENT on a dangling one), stamps the app icon into the
rem executable, and skips the upstream preparation when its result is still
rem valid for this checkout.
"%NODE%" "%~dp0start.js"
endlocal
