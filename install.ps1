# Installs Model Viewer for the current user (no admin rights needed):
#   - copies the app to %LOCALAPPDATA%\Programs\ModelViewer
#   - registers it for .step/.stp/.obj/.stl (Open with + default when no other app is chosen)
#   - adds a Start menu shortcut and an entry in Settings > Apps
$ErrorActionPreference = 'Stop'

$src        = Join-Path $PSScriptRoot 'dist\ModelViewer'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\ModelViewer'
$exe        = Join-Path $installDir 'ModelViewer.exe'
$progId     = 'ModelViewer.Model'
$extensions = '.step', '.stp', '.obj', '.stl'
$classes    = 'HKCU:\Software\Classes'

if (-not (Test-Path (Join-Path $src 'ModelViewer.exe'))) {
    throw "Build not found at $src. Run build.ps1 first."
}

# Close running copies so files can be replaced.
Get-Process ModelViewer -ErrorAction SilentlyContinue | Stop-Process -Force
if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }
Copy-Item $src $installDir -Recurse
Copy-Item (Join-Path $PSScriptRoot 'uninstall.ps1') $installDir

function Set-Key($path, $values) {
    New-Item -Path $path -Force | Out-Null
    foreach ($name in $values.Keys) {
        if ($name -eq '') { Set-Item -Path $path -Value $values[$name] }
        else { New-ItemProperty -Path $path -Name $name -Value $values[$name] -Force | Out-Null }
    }
}

# File type (ProgID)
Set-Key "$classes\$progId"                    @{ '' = '3D Model' }
Set-Key "$classes\$progId\DefaultIcon"        @{ '' = "`"$exe`",0" }
Set-Key "$classes\$progId\shell\open\command" @{ '' = "`"$exe`" `"%1`"" }

# Application registration (shows up nicely in "Open with")
$app = "$classes\Applications\ModelViewer.exe"
Set-Key $app                         @{ 'FriendlyAppName' = 'Model Viewer' }
Set-Key "$app\shell\open\command"    @{ '' = "`"$exe`" `"%1`"" }
Set-Key "$app\SupportedTypes"        @{}
foreach ($ext in $extensions) {
    New-ItemProperty -Path "$app\SupportedTypes" -Name $ext -Value '' -Force | Out-Null

    $extKey = "$classes\$ext"
    New-Item -Path "$extKey\OpenWithProgids" -Force | Out-Null
    New-ItemProperty -Path "$extKey\OpenWithProgids" -Name $progId -Value '' -Force | Out-Null
    # Become the default handler only if no other app has claimed the type.
    # (A default the user picked themselves always wins anyway.)
    if (-not (Get-Item $extKey).GetValue('')) { Set-Item -Path $extKey -Value $progId }
}

# Start menu shortcut
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Model Viewer.lnk'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($startMenu)
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $installDir
$lnk.Save()

# Settings > Apps entry
$size = [int]((Get-ChildItem $installDir -Recurse | Measure-Object Length -Sum).Sum / 1KB)
Set-Key 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ModelViewer' @{
    'DisplayName'     = 'Model Viewer'
    'DisplayIcon'     = $exe
    'DisplayVersion'  = '1.0.0'
    'Publisher'       = 'Model Viewer'
    'InstallLocation' = $installDir
    'UninstallString' = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installDir\uninstall.ps1`""
    'NoModify'        = 1
    'NoRepair'        = 1
}
New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ModelViewer' -Name EstimatedSize -Value $size -PropertyType DWord -Force | Out-Null

# Tell Explorer that file associations changed (refreshes icons).
Add-Type -Namespace Win32 -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, int f, IntPtr a, IntPtr b);'
[Win32.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

Write-Host "Model Viewer installed to $installDir"
