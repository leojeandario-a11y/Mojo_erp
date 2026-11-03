#requires -Version 7.0
$ErrorActionPreference = "Stop"

function ConvertTo-PlainText([Security.SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $repoRoot
$password = $null
$confirmation = $null
$plainPassword = $null
$plainConfirmation = $null
$process = $null

try {
  Write-Host "Local password recovery for the active mojo_erp database."
  Write-Host "This resets the account password and revokes its active sessions."
  $email = (Read-Host "Account email").Trim()
  if ([string]::IsNullOrWhiteSpace($email)) {
    throw "An account email is required."
  }

  $confirmationText = Read-Host "Type RESET to continue"
  if ($confirmationText -cne "RESET") {
    throw "Password reset cancelled."
  }

  $password = Read-Host "New password (12–128 characters; input is hidden)" -AsSecureString
  $confirmation = Read-Host "Confirm new password (input is hidden)" -AsSecureString
  $plainPassword = ConvertTo-PlainText $password
  $plainConfirmation = ConvertTo-PlainText $confirmation
  if ($plainPassword.Length -lt 12 -or $plainPassword.Length -gt 128) {
    throw "The password must contain 12–128 characters."
  }
  if (-not [string]::Equals($plainPassword, $plainConfirmation, [StringComparison]::Ordinal)) {
    throw "The passwords do not match."
  }

  $nodeCode = @'
const { loadEnvConfig } = require("@next/env");
const { createHash, randomBytes } = require("node:crypto");
loadEnvConfig(process.cwd());

async function main() {
  let serialized = "";
  for await (const chunk of process.stdin) serialized += chunk;
  const input = JSON.parse(serialized);
  const email = String(input.email || "").trim();
  const password = String(input.password || "");
  if (!email || password.length < 12 || password.length > 128) {
    throw new Error("Invalid recovery input.");
  }

  const { Pool } = require("pg");
  const database = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST,
        port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
      };
  if (!database.connectionString && (!database.host || !database.database || !database.user || !database.password)) {
    throw new Error("Database configuration is incomplete. Check the local .env file.");
  }

  const pool = new Pool({ ...database, connectionTimeoutMillis: 5000 });
  let tokenHash = null;
  try {
    const { rows: [db] } = await pool.query("SELECT current_database() AS name");
    if (db.name !== "mojo_erp") {
      throw new Error(`Refusing recovery against database "${db.name}"; expected "mojo_erp".`);
    }

    const health = await fetch("http://127.0.0.1:3000/api/health", { signal: AbortSignal.timeout(10000) });
    const healthBody = await health.json().catch(() => null);
    if (!health.ok || healthBody?.status !== "ok") {
      throw new Error("The local application is not healthy on port 3000.");
    }

    const client = await pool.connect();
    const token = randomBytes(32).toString("base64url");
    tokenHash = createHash("sha256").update(token).digest("hex");
    try {
      await client.query("BEGIN");
      const { rows: [user] } = await client.query(
        "SELECT id FROM users WHERE lower(email::text)=lower($1) AND is_active FOR UPDATE",
        [email],
      );
      if (!user) throw new Error("No active account matches that email.");

      const { rows: [limits] } = await client.query(
        `SELECT
           (SELECT count(*)::int FROM audit_logs
            WHERE module='auth'
              AND action IN ('PASSWORD_RESET_REQUEST','PASSWORD_RESET')
              AND ip_address='127.0.0.1'
              AND occurred_at>=now()-interval '15 minutes') AS ip_attempts,
           (SELECT count(*)::int FROM password_reset_tokens
            WHERE user_id=$1 AND created_at>=now()-interval '15 minutes') AS user_attempts`,
        [user.id],
      );
      if (limits.ip_attempts >= 10 || limits.user_attempts >= 3) {
        throw new Error("Password recovery rate limit reached. Wait before trying again.");
      }

      await client.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.ip','127.0.0.1',true)",
        [user.id],
      );
      await client.query(
        "UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [user.id],
      );
      await client.query(
        "INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '10 minutes')",
        [user.id, tokenHash],
      );
      await client.query(
        "SELECT log_auth_event('PASSWORD_RESET_REQUEST','success','Local password recovery')",
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    try {
      const response = await fetch("http://127.0.0.1:3000/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || "The application rejected the password reset.");
      }
      console.log("Password reset complete. Active sessions were revoked; sign in with the new password.");
    } catch (error) {
      await pool.query(
        "UPDATE password_reset_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL",
        [tokenHash],
      );
      throw error;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Local password recovery failed.");
  process.exitCode = 1;
});
'@

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = (Get-Command node -ErrorAction Stop).Source
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
  $startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
  [void]$startInfo.ArgumentList.Add("-e")
  [void]$startInfo.ArgumentList.Add($nodeCode)

  $process = [Diagnostics.Process]::Start($startInfo)
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $payload = @{ email = $email; password = $plainPassword } | ConvertTo-Json -Compress
  $process.StandardInput.WriteLine($payload)
  $process.StandardInput.Close()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  if ($stdout) { Write-Host $stdout.TrimEnd() }
  if ($stderr) { [Console]::Error.WriteLine($stderr.TrimEnd()) }
  if ($process.ExitCode -ne 0) {
    throw "Local password recovery failed."
  }
} finally {
  if ($process) { $process.Dispose() }
  if ($password) { $password.Dispose() }
  if ($confirmation) { $confirmation.Dispose() }
  $plainPassword = $null
  $plainConfirmation = $null
  $payload = $null
  Pop-Location
}
