param(
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"
$token = $env:MOJO_SCHEDULED_TASK_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
  $envPath = Join-Path (Split-Path $PSScriptRoot -Parent) ".env"
  if (Test-Path -LiteralPath $envPath) {
    $tokenLine = Get-Content -LiteralPath $envPath |
      Where-Object { $_ -match "^MOJO_SCHEDULED_TASK_TOKEN=([A-Za-z0-9_-]{32,})$" } |
      Select-Object -Last 1
    if ($tokenLine) {
      $token = $tokenLine -replace "^MOJO_SCHEDULED_TASK_TOKEN=", ""
    }
  }
}
if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 32) {
  throw "Set MOJO_SCHEDULED_TASK_TOKEN to a private value of at least 32 characters."
}

$uri = "$($BaseUrl.TrimEnd('/'))/api/internal/scheduled-notifications"
$result = Invoke-RestMethod -Method Post -Uri $uri -Headers @{
  Authorization = "Bearer $token"
} -TimeoutSec 120

$result | ConvertTo-Json -Depth 5
