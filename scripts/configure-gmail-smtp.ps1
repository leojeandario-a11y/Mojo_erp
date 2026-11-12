$ErrorActionPreference = "Stop"
$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $repositoryRoot ".env"
$accountEmail = "mojopiktures@gmail.com"
$senderEmail = $accountEmail
$recipientEmail = $accountEmail

git -C $repositoryRoot check-ignore --quiet -- .env
if ($LASTEXITCODE -ne 0) {
  throw ".env must be ignored by Git before saving SMTP credentials."
}

$securePassword = Read-Host "Google 16-character app password (input is hidden)" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $appPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer) -replace "\s", ""
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}
if ($appPassword -notmatch "^[A-Za-z0-9]{16}$") {
  throw "The Google app password must contain exactly 16 letters and digits after spaces are removed; $($appPassword.Length) characters were entered. No email was sent and settings were not saved."
}

$settings = [ordered]@{
  SMTP_HOST     = "smtp.gmail.com"
  SMTP_PORT     = "465"
  SMTP_SECURE   = "true"
  SMTP_USER     = $accountEmail
  SMTP_PASSWORD = $appPassword
  SMTP_FROM     = $senderEmail
}

$existingLines = if (Test-Path -LiteralPath $envPath) {
  [System.IO.File]::ReadAllLines($envPath)
} else {
  @()
}
$updatedKeys = @{}
$updatedLines = foreach ($line in $existingLines) {
  $matched = $false
  foreach ($key in $settings.Keys) {
    if ($line -match "^\s*$([regex]::Escape($key))\s*=") {
      $updatedKeys[$key] = $true
      $matched = $true
      $value = [string]$settings[$key]
      if ($key -eq "SMTP_PASSWORD") {
        "SMTP_PASSWORD=`"$value`""
      } else {
        "$key=$value"
      }
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
foreach ($key in $settings.Keys) {
  if (-not $updatedKeys.ContainsKey($key)) {
    $value = [string]$settings[$key]
    if ($key -eq "SMTP_PASSWORD") {
      $newLines.Add("SMTP_PASSWORD=`"$value`"")
    } else {
      $newLines.Add("$key=$value")
    }
  }
}

$tokenExists = $false
foreach ($line in $newLines) {
  if ($line -match "^\s*MOJO_SCHEDULED_TASK_TOKEN\s*=\s*(.{32,})\s*$") {
    $tokenExists = $true
    break
  }
}
if (-not $tokenExists) {
  $tokenBytes = [byte[]]::new(32)
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($tokenBytes)
  } finally {
    $random.Dispose()
  }
  $token = [BitConverter]::ToString($tokenBytes) -replace "-", ""
  $newLines.Add("MOJO_SCHEDULED_TASK_TOKEN=$token")
}

[System.IO.File]::WriteAllLines(
  $envPath,
  $newLines,
  [System.Text.UTF8Encoding]::new($false)
)
Remove-Variable appPassword, securePassword

Push-Location $repositoryRoot
try {
  & node scripts/test-gmail-smtp.mjs $recipientEmail
  if ($LASTEXITCODE -ne 0) {
    throw "SMTP settings were saved locally, but the test email could not be sent. Check the provider settings and app password."
  }
} finally {
  Pop-Location
}
