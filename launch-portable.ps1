$ErrorActionPreference = "Stop"
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = "http://127.0.0.1:8798/"
$serverScript = Join-Path $appDir "portable-tcp-server.ps1"

function Test-TweetCardStudio {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $appUrl -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content -match "Tweet Card Studio"
  } catch {
    return $false
  }
}

function Show-LauncherError([string]$message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, "Tweet Card Studio", "OK", "Error") | Out-Null
}

if (-not (Test-TweetCardStudio)) {
  if (-not (Test-Path -LiteralPath $serverScript)) {
    Show-LauncherError "portable-tcp-server.ps1 was not found. Extract or copy the complete folder before launching."
    exit 1
  }

  $powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $serverScript + '" -Port 8798'
  try {
    Start-Process -FilePath $powershell -ArgumentList $arguments -WorkingDirectory $appDir -WindowStyle Hidden | Out-Null
  } catch {
    Show-LauncherError "Could not start the portable server: $($_.Exception.Message)"
    exit 1
  }

  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 200
    if (Test-TweetCardStudio) {
      $ready = $true
      break
    }
  }
  if (-not $ready) {
    Show-LauncherError "The app did not start. Port 8798 may be used by another program."
    exit 1
  }
}

Start-Process -FilePath $appUrl
