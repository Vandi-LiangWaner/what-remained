$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$answer=[System.Windows.Forms.MessageBox]::Show('Remove this Reminiscence installation? Your notebook and backups will stay in Documents\Reminiscence.','Uninstall Reminiscence','YesNo','Question')
if($answer -ne 'Yes'){exit}
$installRoot=[IO.Path]::GetFullPath($PSScriptRoot)
if(!(Test-Path -LiteralPath (Join-Path $installRoot 'Reminiscence.exe')) -or !(Test-Path -LiteralPath (Join-Path $installRoot 'resources\app\package.json'))){throw 'This is not a Reminiscence installation.'}
$metadata=Get-Content -LiteralPath (Join-Path $installRoot 'resources\app\package.json') -Raw | ConvertFrom-Json
if($metadata.name -ne 'reminiscence'){throw 'Unexpected application; no files removed.'}
# Resolve and verify each target before removing any application files. Notebook data is never a target.
$programShortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'Reminiscence\Reminiscence.lnk'
$desktopShortcut=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Reminiscence.lnk'
foreach($shortcut in @($programShortcut,$desktopShortcut)){if(Test-Path -LiteralPath $shortcut){Remove-Item -LiteralPath $shortcut}}
Remove-Item -LiteralPath $installRoot -Recurse -Force
