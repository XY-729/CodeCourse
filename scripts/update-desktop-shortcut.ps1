param(
    [Parameter(Mandatory = $true)]
    [string]$TargetPath,

    [string]$ShortcutPath = (Join-Path ([Environment]::GetFolderPath("Desktop")) "CodeCourse.lnk")
)

$resolvedTarget = [System.IO.Path]::GetFullPath($TargetPath)
if (-not (Test-Path -LiteralPath $resolvedTarget)) {
    throw "CodeCourse executable not found: $resolvedTarget"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $resolvedTarget
$shortcut.WorkingDirectory = Split-Path -Parent $resolvedTarget
$shortcut.IconLocation = "$resolvedTarget,0"
$shortcut.Description = "CodeCourse"
$shortcut.Save()

$saved = $shell.CreateShortcut($ShortcutPath)
[PSCustomObject]@{
    Shortcut = $ShortcutPath
    Target = $saved.TargetPath
    WorkingDirectory = $saved.WorkingDirectory
    Icon = $saved.IconLocation
}
