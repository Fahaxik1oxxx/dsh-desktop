# Create or refresh the desktop and Start Menu shortcuts.
# Defaults point at DeepSeekHarness.exe (stamped on npm install). Explorer
# reads the BMP ICO already in that PE, so the shortcut does not depend on
# a sidecar .ico path that can move.
param(
    [string]$Target,
    [string]$WorkDir,
    [string]$Icon,
    [string]$Arguments = '.',
    [string]$Name = 'DeepSeek Harness'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

if (-not $WorkDir) { $WorkDir = $Root }
if (-not $Target) {
    $app = Join-Path $Root 'node_modules\electron\dist\DeepSeekHarness.exe'
    $elec = Join-Path $Root 'node_modules\electron\dist\electron.exe'
    $Target = if (Test-Path $app) { $app } else { $elec }
}
if (-not $Icon) { $Icon = $Target }

if (-not (Test-Path $Target)) {
    Write-Error "Target not found: $Target (run npm install first)"
}

function Write-AppShortcut([string]$Directory) {
    if (-not (Test-Path $Directory)) {
        New-Item -ItemType Directory -Path $Directory | Out-Null
    }
    $lnk = Join-Path $Directory ($Name + '.lnk')
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnk)
    $sc.TargetPath = $Target
    $sc.Arguments = $Arguments
    $sc.WorkingDirectory = $WorkDir
    $sc.IconLocation = "$Icon,0"
    $sc.Description = $Name
    $sc.Save()
}

Write-AppShortcut ([Environment]::GetFolderPath('Desktop'))
Write-AppShortcut (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')

# Ask Explorer to drop a stale icon cache for these .lnk files.
Add-Type -Namespace DshDesktop -Name ShellNotify -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("shell32.dll")]
public static extern void SHChangeNotify(int wEventId, uint uFlags, System.IntPtr dwItem1, System.IntPtr dwItem2);
'@
[DshDesktop.ShellNotify]::SHChangeNotify(0x8000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
