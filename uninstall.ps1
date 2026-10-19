# Removes Model Viewer and its file associations for the current user.
$ErrorActionPreference = 'SilentlyContinue'

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\ModelViewer'
$progId     = 'ModelViewer.Model'
$classes    = 'HKCU:\Software\Classes'

Get-Process ModelViewer | Stop-Process -Force

foreach ($ext in '.step', '.stp', '.obj', '.stl') {
    Remove-ItemProperty -Path "$classes\$ext\OpenWithProgids" -Name $progId
    if ((Get-Item "$classes\$ext").GetValue('') -eq $progId) { Set-Item -Path "$classes\$ext" -Value '' }
}
Remove-Item "$classes\$progId" -Recurse -Force
Remove-Item "$classes\Applications\ModelViewer.exe" -Recurse -Force
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ModelViewer' -Recurse -Force
Remove-Item (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Model Viewer.lnk') -Force

Add-Type -Namespace Win32 -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, int f, IntPtr a, IntPtr b);'
[Win32.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

# This script may be running from inside the install folder; delete it after exit.
Start-Process cmd.exe -ArgumentList "/c timeout /t 2 >nul & rmdir /s /q `"$installDir`"" -WindowStyle Hidden
Write-Host 'Model Viewer uninstalled.'
