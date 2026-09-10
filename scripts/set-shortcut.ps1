# Create or refresh the desktop and Start Menu shortcuts.
# Defaults point at DeepSeekHarness.exe (stamped on npm install) and assets/deepseek.ico.
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
if (-not $Icon) {
    $winIco = Join-Path $Root 'assets\deepseek-win.ico'
    $Ico = Join-Path $Root 'assets\deepseek.ico'
    $Icon = if (Test-Path $winIco) { $winIco } else { $Ico }
}
if (-not $Target) {
    $app = Join-Path $Root 'node_modules\electron\dist\DeepSeekHarness.exe'
    $elec = Join-Path $Root 'node_modules\electron\dist\electron.exe'
    $Target = if (Test-Path $app) { $app } else { $elec }
}

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
