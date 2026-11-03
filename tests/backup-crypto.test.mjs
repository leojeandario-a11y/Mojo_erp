import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decryptBackup,
  decryptBackupFile,
  encryptBackup,
  encryptBackupFile,
  parseBackupKey,
} from "../src/lib/backup-crypto.mjs";

const key = Buffer.alloc(32, 71);

test("parses exact 256-bit backup keys", () => {
  assert.deepEqual(parseBackupKey(key.toString("hex")), key);
  assert.deepEqual(parseBackupKey(key.toString("base64")), key);
  assert.throws(() => parseBackupKey("too-short"), TypeError);
});

test("encrypts and authenticates a backup before returning plaintext", () => {
  const data = Buffer.from("private payroll and finance dump");
  const encrypted = encryptBackup(data, key);
  assert.notDeepEqual(encrypted, data);
  assert.deepEqual(decryptBackup(encrypted, key), data);
  assert.throws(() => decryptBackup(encrypted, Buffer.alloc(32, 72)));
  const tampered = Buffer.from(encrypted);
  tampered[25] ^= 1;
  assert.throws(() => decryptBackup(tampered, key));
});

test("encrypts and decrypts files as streams", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mojo-backup-"));
  const source = join(directory, "source.dump");
  const encrypted = join(directory, "source.dump.enc");
  const restored = join(directory, "restored.dump");
  const data = Buffer.alloc(1024 * 1024, 17);
  try {
    await writeFile(source, data);
    await encryptBackupFile(source, encrypted, key);
    await decryptBackupFile(encrypted, restored, key);
    assert.deepEqual(await readFile(restored), data);
    const badTarget = join(directory, "bad.dump");
    await assert.rejects(() => decryptBackupFile(encrypted, badTarget, Buffer.alloc(32, 73)));
    await assert.rejects(() => access(badTarget));

    const existingTarget = join(directory, "existing.dump");
    await writeFile(existingTarget, "keep");
    await assert.rejects(() => encryptBackupFile(source, existingTarget, key));
    assert.equal(await readFile(existingTarget, "utf8"), "keep");
    await assert.rejects(() => decryptBackupFile(encrypted, existingTarget, key));
    assert.equal(await readFile(existingTarget, "utf8"), "keep");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
