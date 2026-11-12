$ErrorActionPreference = "Stop"
$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $repositoryRoot ".env"

git -C $repositoryRoot check-ignore --quiet -- .env
if ($LASTEXITCODE -ne 0) {
  throw ".env must be ignored by Git before saving Google credentials."
}

$clientId = Read-Host "Google OAuth client ID"
$calendarId = Read-Host "Google Calendar ID (press Enter for primary)"
if ([string]::IsNullOrWhiteSpace($calendarId)) {
  $calendarId = "primary"
}
$secureClientSecret = Read-Host "Google OAuth client secret (input is hidden)" -AsSecureString
$secureRefreshToken = Read-Host "Google OAuth refresh token (input is hidden)" -AsSecureString

function ConvertFrom-SecureInput([System.Security.SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

try {
  $clientSecret = ConvertFrom-SecureInput $secureClientSecret
  $refreshToken = ConvertFrom-SecureInput $secureRefreshToken
  $values = [ordered]@{
    GOOGLE_CLIENT_ID     = $clientId.Trim()
    GOOGLE_CLIENT_SECRET = $clientSecret
    GOOGLE_REFRESH_TOKEN = $refreshToken
    GOOGLE_CALENDAR_ID   = $calendarId.Trim()
  }

  foreach ($key in $values.Keys) {
    $value = [string]$values[$key]
    if ([string]::IsNullOrWhiteSpace($value) -or $value.Contains("`n") -or $value.Contains("`r") -or $value.Contains('"')) {
      throw "A Google Calendar setting is empty or contains unsupported characters. No settings were saved."
    }
  }

  $existingLines = if (Test-Path -LiteralPath $envPath) {
    [System.IO.File]::ReadAllLines($envPath)
  } else {
    @()
  }
  $updatedKeys = @{}
  $updatedLines = foreach ($line in $existingLines) {
    $matched = $false
    foreach ($key in $values.Keys) {
      if ($line -match "^\s*$([regex]::Escape($key))\s*=") {
        $updatedKeys[$key] = $true
        $matched = $true
        "$key=`"$([string]$values[$key])`""
        break
      }
    }
    if (-not $matched) {
      $line
    }
  }

  $newLines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in $updatedLines) {
    $newLines.Add($line)
  }
  foreach ($key in $values.Keys) {
    if (-not $updatedKeys.ContainsKey($key)) {
      $newLines.Add("$key=`"$([string]$values[$key])`"")
    }
  }

  [System.IO.File]::WriteAllLines(
    $envPath,
    $newLines,
    [System.Text.UTF8Encoding]::new($false)
  )
  Write-Host "Google Calendar settings were saved in the Git-ignored .env file. No credentials were displayed."
} finally {
  if ($secureClientSecret) { $secureClientSecret.Dispose() }
  if ($secureRefreshToken) { $secureRefreshToken.Dispose() }
  Remove-Variable clientSecret, refreshToken, values -ErrorAction SilentlyContinue
}
