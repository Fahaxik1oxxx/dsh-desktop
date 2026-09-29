' launch-hidden.vbs - start the official desktop without a console window.
'
' The official development launcher is a node/tsx process chain, so starting it
' from a .cmd or a shortcut always leaves a console window. WScript.Shell.Run with
' window style 0 (SW_HIDE) hides the whole chain; its output goes to
' logs\desktop.log, which the "View launch log" shortcut opens.
Option Explicit
Dim sh, fso, root, logDir, logFile, script, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = fso.BuildPath(root, "logs")
If Not fso.FolderExists(logDir) Then fso.CreateFolder logDir

logFile = fso.BuildPath(logDir, "desktop.log")
script = fso.BuildPath(root, "start-official.cmd")

cmd = "cmd /c call """ & script & """ > """ & logFile & """ 2>&1"
sh.Run cmd, 0, False
