import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve, win32 } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import {
  decryptBackupFile,
  encryptBackupFile,
  parseBackupKey,
} from "../src/lib/backup-crypto.mjs";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
}

function run(command, args) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "inherit"], env: process.env });
    child.once("error", rejectCommand);
    child.once("close", (code) => {
      if (code === 0) resolveCommand();
      else rejectCommand(new Error(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function hashFile(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function main() {
  required("PGHOST");
  required("PGDATABASE");
  required("PGUSER");
  required("PGPASSWORD");
  const backupDirectory = required("MOJO_BACKUP_OFFSITE_DIR");
  const offsiteHostPath = required("MOJO_BACKUP_OFFSITE_HOST_PATH");
  if (!isAbsolute(backupDirectory) || !(isAbsolute(offsiteHostPath) || win32.isAbsolute(offsiteHostPath))) {
    throw new Error("The encrypted backup destination and mounted off-site host path must be absolute.");
  }
  if (resolve(backupDirectory) === resolve(process.cwd(), "backups")) {
    throw new Error("Backups must not be written to the repository-local backups directory.");
  }
  const key = parseBackupKey(required("MOJO_BACKUP_ENCRYPTION_KEY"));
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "mojo-backup-"));
  const dumpPath = join(temporaryDirectory, "database.dump");
  const verificationPath = join(temporaryDirectory, "verification.dump");
  const stamp = new Date().toISOString().replaceAll(/[-:.]/g, "");
  const finalName = `mojo_${stamp}_${randomUUID()}.dump.enc`;
  const stagingPath = join(backupDirectory, `.${finalName}.${randomUUID()}.partial`);
  const finalPath = join(backupDirectory, finalName);
  const originalUmask = process.umask(0o077);

  try {
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    await run("pg_dump", ["--format=custom", "--no-owner", "--file", dumpPath]);
    await encryptBackupFile(dumpPath, stagingPath, key);
    await decryptBackupFile(stagingPath, verificationPath, key);
    await run("pg_restore", ["--list", verificationPath]);
    await rename(stagingPath, finalPath);
    const [backupStat, sha256] = await Promise.all([stat(finalPath), hashFile(finalPath)]);
    console.log(JSON.stringify({
      backup: basename(finalPath),
      bytes: backupStat.size,
      sha256,
      encrypted: true,
      verified: true,
    }));
  } finally {
    process.umask(originalUmask);
    await rm(temporaryDirectory, { recursive: true, force: true });
    await rm(stagingPath, { force: true });
  }
}

main().catch((error) => {
  console.error("Encrypted backup failed.", error);
  process.exitCode = 1;
});
