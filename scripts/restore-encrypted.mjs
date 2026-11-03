import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { decryptBackupFile, parseBackupKey } from "../src/lib/backup-crypto.mjs";

function run(command, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, ...options.env },
    });
    child.once("error", rejectCommand);
    child.once("close", (code) => {
      if (code === 0) resolveCommand();
      else rejectCommand(new Error(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function main() {
  const [, , mode, inputPath] = process.argv;
  if (!["--verify", "--restore"].includes(mode) || !inputPath) {
    throw new Error("Usage: node scripts/restore-encrypted.mjs --verify <backup.enc> | --restore <backup.enc>");
  }
  const keyValue = process.env.MOJO_BACKUP_ENCRYPTION_KEY;
  if (!keyValue) throw new Error("MOJO_BACKUP_ENCRYPTION_KEY must be configured.");
  const key = parseBackupKey(keyValue);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "mojo-restore-"));
  const dumpPath = join(temporaryDirectory, basename(inputPath).replace(/\.enc$/i, ".dump"));

  try {
    await decryptBackupFile(inputPath, dumpPath, key);
    await run("pg_restore", ["--list", dumpPath]);
    if (mode === "--verify") {
      console.log("Encrypted backup authentication and PostgreSQL archive checks passed.");
      return;
    }

    const target = process.env.MOJO_RESTORE_TEST_DATABASE;
    if (!target || !/^[a-z][a-z0-9_]*_restore_test$/.test(target)) {
      throw new Error("MOJO_RESTORE_TEST_DATABASE must be a dedicated database name ending in _restore_test.");
    }
    if (target.toLowerCase() === process.env.PGDATABASE?.toLowerCase()) {
      throw new Error("Refusing to restore into the configured source database.");
    }
    if (!process.env.PGHOST || !process.env.PGUSER || !process.env.PGPASSWORD) {
      throw new Error("PGHOST, PGUSER, and PGPASSWORD are required for an isolated restore test.");
    }

    await run("createdb", ["--template=template0", target], { env: { PGDATABASE: "postgres" } });
    await run("pg_restore", ["--no-owner", "--exit-on-error", "--dbname", target, dumpPath]);
    console.log(JSON.stringify({
      backup: basename(inputPath),
      restoredTo: target,
      destructive: false,
      note: "The isolated restore-test database was retained for manual verification.",
    }));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Encrypted restore verification failed.", error);
  process.exitCode = 1;
});
