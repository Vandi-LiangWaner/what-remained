param([string]$ElectronZip, [string]$OutputDirectory = 'release')
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $project '.runtime'
if (!(Test-Path (Join-Path $runtime 'electron.exe'))) {
  if (!$ElectronZip) { throw 'Pass -ElectronZip with the official Electron 36.9.5 Windows x64 archive.' }
  Expand-Archive -LiteralPath $ElectronZip -DestinationPath $runtime -Force
}
$release = if ([IO.Path]::IsPathRooted($OutputDirectory)) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $project $OutputDirectory }
$portable = Join-Path $release 'What Remained-portable'
New-Item -ItemType Directory -Force -Path $portable | Out-Null
Get-ChildItem -LiteralPath $runtime | Where-Object Name -ne 'resources' | Copy-Item -Destination $portable -Recurse -Force
Move-Item -LiteralPath (Join-Path $portable 'electron.exe') -Destination (Join-Path $portable 'What Remained.exe') -Force
$application = Join-Path $portable 'resources\app'
New-Item -ItemType Directory -Force -Path $application | Out-Null
foreach ($part in @('desktop','ui','core.cjs','package.json')) {Copy-Item -LiteralPath (Join-Path $project $part) -Destination $application -Recurse -Force}
Copy-Item -LiteralPath (Join-Path $project 'README.md') -Destination $portable -Force
if (Test-Path -LiteralPath (Join-Path $project 'docs')) { Copy-Item -LiteralPath (Join-Path $project 'docs') -Destination $portable -Recurse -Force }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Uninstall.ps1') -Destination $portable -Force
$zip = Join-Path $release 'What Remained-1.1.0-portable.zip'
if(Test-Path $zip){Remove-Item -LiteralPath $zip}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($portable,$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$setup = Join-Path $release 'What Remained-1.1.0-Setup.exe'
& $compiler /nologo /target:winexe "/out:$setup" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/resource:$zip,payload.zip" (Join-Path $PSScriptRoot 'Installer.cs')
if($LASTEXITCODE -ne 0){throw 'Installer compilation failed'}
Get-FileHash -LiteralPath $zip,$setup | ForEach-Object {"$($_.Hash)  $([IO.Path]::GetFileName($_.Path))"} | Set-Content (Join-Path $release 'SHA256SUMS.txt')
Write-Output "Built: $setup"
Write-Output "Portable: $zip"
