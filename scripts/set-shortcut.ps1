# Refresh the desktop/Start Menu shortcut icon for the unpackaged Electron shell.
param(
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [Parameter(Mandatory = $true)][string]$Icon,
    [string]$Arguments = '.',
    [string]$Name = 'DeepSeek Harness'
)

$ErrorActionPreference = 'Stop'

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
