param(
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"
$token = $env:MOJO_SCHEDULED_TASK_TOKEN
if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 32) {
  throw "Set MOJO_SCHEDULED_TASK_TOKEN to a private value of at least 32 characters."
}

$uri = "$($BaseUrl.TrimEnd('/'))/api/internal/scheduled-notifications"
$result = Invoke-RestMethod -Method Post -Uri $uri -Headers @{
  Authorization = "Bearer $token"
} -TimeoutSec 120

$result | ConvertTo-Json -Depth 5
