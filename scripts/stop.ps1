$ErrorActionPreference = 'Stop'
$projectPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dataPath = Join-Path $projectPath 'data'

function Clear-StaleTunnelLock([string]$LockPath) {
  if (-not (Test-Path -LiteralPath $LockPath)) { return }
  try {
    # A live runner keeps its lock handle open, so this exclusive open fails.
    # DeleteOnClose removes the opened file without a close-then-delete race
    # that could accidentally remove a new runner's replacement lock.
    $staleLock = [System.IO.FileStream]::new($LockPath, [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None, 4096,
      [System.IO.FileOptions]::DeleteOnClose)
    $staleLock.Dispose()
    Write-Host 'Stale tunnel lock cleared.'
  } catch [System.IO.IOException] {
    Write-Host 'Tunnel lock is still in use; it was left unchanged.'
  } catch [System.UnauthorizedAccessException] {
    Write-Host 'Tunnel lock could not be opened; it was left unchanged.'
  }
}

foreach ($serviceName in @('tunnel', 'server')) {
  $pidFile = Join-Path $dataPath ($serviceName + '.pid')
  if (-not (Test-Path -LiteralPath $pidFile)) { continue }
  $servicePid = 0
  if (-not [int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$servicePid)) { continue }
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $servicePid" -ErrorAction SilentlyContinue
  if (-not $processInfo) { continue }
  $expectedPath = if ($serviceName -eq 'tunnel') { Join-Path $projectPath 'tools\cloudflared.exe' } else { Join-Path $projectPath 'src\cli.mjs' }
  $isOwned = if ($serviceName -eq 'tunnel') { $processInfo.ExecutablePath -eq $expectedPath } else { $processInfo.Name -eq 'node.exe' -and $processInfo.CommandLine.Contains($expectedPath) }
  if ($isOwned) { Stop-Process -Id $servicePid; Write-Host ($serviceName + ' stopped.') }
}
Clear-StaleTunnelLock (Join-Path $dataPath 'tunnel.lock')
Write-Host 'If you launched npm start manually, press Ctrl+C in that terminal to stop it.'
