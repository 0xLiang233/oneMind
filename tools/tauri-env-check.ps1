$ErrorActionPreference = 'Stop'

function Get-RegistryValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )

  try {
    $item = Get-ItemProperty -Path $Path -ErrorAction Stop
    return $item.$Name
  } catch {
    return $null
  }
}

function Get-CommandVersion {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string]$Argument = '--version'
  )

  try {
    $output = & $Command $Argument 2>$null | Select-Object -First 1
    if ($LASTEXITCODE -eq 0 -and $output) {
      return ($output | Out-String).Trim()
    }
  } catch {
  }

  return $null
}

function Test-WebView2Runtime {
  $candidates = @(
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  )

  foreach ($path in $candidates) {
    $pv = Get-RegistryValue -Path $path -Name 'pv'
    if ($pv) {
      return [pscustomobject]@{
        Installed = $true
        Version = $pv
        Source = $path
      }
    }
  }

  return [pscustomobject]@{
    Installed = $false
    Version = $null
    Source = $null
  }
}

function Get-EdgeVersion {
  $paths = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
  )

  foreach ($path in $paths) {
    if (Test-Path -LiteralPath $path) {
      try {
        return (Get-Item -LiteralPath $path).VersionInfo.ProductVersion
      } catch {
      }
    }
  }

  return $null
}

function Test-VcRedist {
  $paths = @(
    'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
  )

  foreach ($path in $paths) {
    $installed = Get-RegistryValue -Path $path -Name 'Installed'
    $version = Get-RegistryValue -Path $path -Name 'Version'
    if ($installed -eq 1) {
      return [pscustomobject]@{
        Installed = $true
        Version = $version
        Source = $path
      }
    }
  }

  return [pscustomobject]@{
    Installed = $false
    Version = $null
    Source = $null
  }
}

function Get-OsInfo {
  $os = Get-CimInstance Win32_OperatingSystem
  $computer = Get-CimInstance Win32_ComputerSystem

  return [pscustomobject]@{
    Caption = $os.Caption
    Version = $os.Version
    BuildNumber = $os.BuildNumber
    Architecture = $os.OSArchitecture
    TotalMemoryGB = [math]::Round($computer.TotalPhysicalMemory / 1GB, 2)
  }
}

function Get-WebView2LoaderHints {
  $paths = @(
    'C:\Windows\System32\WebView2Loader.dll',
    'C:\Windows\SysWOW64\WebView2Loader.dll'
  )

  $found = @()
  foreach ($path in $paths) {
    if (Test-Path -LiteralPath $path) {
      $found += $path
    }
  }
  return $found
}

function Get-TauriReadiness {
  param(
    [Parameter(Mandatory = $true)]$OsInfo,
    [Parameter(Mandatory = $true)]$WebView2,
    [Parameter(Mandatory = $true)]$VcRedist
  )

  $issues = New-Object System.Collections.Generic.List[string]

  if (-not $WebView2.Installed) {
    $issues.Add('WebView2 Runtime 未安装')
  }

  if (-not $VcRedist.Installed) {
    $issues.Add('Microsoft Visual C++ x64 Runtime 未检测到')
  }

  $build = 0
  [void][int]::TryParse($OsInfo.BuildNumber, [ref]$build)
  if ($build -lt 17763) {
    $issues.Add("Windows 构建号过低: $($OsInfo.BuildNumber)")
  }

  return [pscustomobject]@{
    Ready = $issues.Count -eq 0
    Issues = $issues
  }
}

$osInfo = Get-OsInfo
$webView2 = Test-WebView2Runtime
$vcRedist = Test-VcRedist
$edgeVersion = Get-EdgeVersion
$rustVersion = Get-CommandVersion -Command 'rustc'
$cargoVersion = Get-CommandVersion -Command 'cargo'
$nodeVersion = Get-CommandVersion -Command 'node'
$pnpmVersion = Get-CommandVersion -Command 'pnpm'
$webView2LoaderHints = Get-WebView2LoaderHints
$tauriReadiness = Get-TauriReadiness -OsInfo $osInfo -WebView2 $webView2 -VcRedist $vcRedist

$report = [pscustomobject]@{
  timestamp = (Get-Date).ToString('s')
  os = $osInfo
  webView2 = $webView2
  edge = [pscustomobject]@{
    Version = $edgeVersion
  }
  vcRedist = $vcRedist
  toolchain = [pscustomobject]@{
    rustc = $rustVersion
    cargo = $cargoVersion
    node = $nodeVersion
    pnpm = $pnpmVersion
  }
  hints = [pscustomobject]@{
    WebView2LoaderDll = $webView2LoaderHints
  }
  tauriReadiness = $tauriReadiness
}

$reportDir = Join-Path -Path $PSScriptRoot -ChildPath '..\artifacts'
$reportDir = [System.IO.Path]::GetFullPath($reportDir)
if (-not (Test-Path -LiteralPath $reportDir)) {
  New-Item -ItemType Directory -Path $reportDir | Out-Null
}

$reportPath = Join-Path -Path $reportDir -ChildPath 'tauri-env-report.json'
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host ''
Write-Host '=== Tauri Environment Check ==='
Write-Host "Report: $reportPath"
Write-Host ''
Write-Host "OS            : $($osInfo.Caption) ($($osInfo.Version), build $($osInfo.BuildNumber), $($osInfo.Architecture))"
Write-Host "Memory        : $($osInfo.TotalMemoryGB) GB"
Write-Host "WebView2      : $(if ($webView2.Installed) { 'Installed ' + $webView2.Version } else { 'Missing' })"
Write-Host "WebView2 Reg  : $(if ($webView2.Source) { $webView2.Source } else { '-' })"
Write-Host "Edge          : $(if ($edgeVersion) { $edgeVersion } else { 'Not found' })"
Write-Host "VC++ Runtime  : $(if ($vcRedist.Installed) { 'Installed ' + $vcRedist.Version } else { 'Missing' })"
Write-Host "rustc         : $(if ($rustVersion) { $rustVersion } else { 'Not found' })"
Write-Host "cargo         : $(if ($cargoVersion) { $cargoVersion } else { 'Not found' })"
Write-Host "node          : $(if ($nodeVersion) { $nodeVersion } else { 'Not found' })"
Write-Host "pnpm          : $(if ($pnpmVersion) { $pnpmVersion } else { 'Not found' })"

if ($webView2LoaderHints.Count -gt 0) {
  Write-Host "Loader DLL    : $($webView2LoaderHints -join ', ')"
} else {
  Write-Host 'Loader DLL    : Not found in system directories'
}

Write-Host ''
if ($tauriReadiness.Ready) {
  Write-Host 'Tauri Ready   : YES'
} else {
  Write-Host 'Tauri Ready   : NO'
  Write-Host 'Issues:'
  foreach ($issue in $tauriReadiness.Issues) {
    Write-Host " - $issue"
  }
}

Write-Host ''
Write-Host 'Next step: copy the JSON report from artifacts/tauri-env-report.json if you need deeper diagnosis.'
