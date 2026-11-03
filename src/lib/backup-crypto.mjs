import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { appendFile, open, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

export const BACKUP_MAGIC = Buffer.from("MOJOERP1", "ascii");
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = BACKUP_MAGIC.length + IV_LENGTH;

export function parseBackupKey(value) {
  if (/^[\da-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  if (!/^[\da-z+/]+={0,2}$/i.test(value)) {
    throw new TypeError("MOJO_BACKUP_ENCRYPTION_KEY must be 32 bytes encoded as hex or base64.");
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new TypeError("MOJO_BACKUP_ENCRYPTION_KEY must be 32 bytes encoded as hex or base64.");
  }
  return key;
}

export function encryptBackup(plaintext, key, iv = randomBytes(IV_LENGTH)) {
  if (key.length !== 32 || iv.length !== IV_LENGTH) throw new RangeError("Invalid backup encryption key or IV.");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([BACKUP_MAGIC, iv, ciphertext, cipher.getAuthTag()]);
}

export function decryptBackup(encrypted, key) {
  if (key.length !== 32 || encrypted.length <= HEADER_LENGTH + TAG_LENGTH
    || !encrypted.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new TypeError("The encrypted backup format is invalid.");
  }
  const iv = encrypted.subarray(BACKUP_MAGIC.length, HEADER_LENGTH);
  const tag = encrypted.subarray(-TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(encrypted.subarray(HEADER_LENGTH, -TAG_LENGTH)),
    decipher.final(),
  ]);
}

export async function encryptBackupFile(source, target, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let targetCreated = false;
  try {
    await writeFile(target, Buffer.concat([BACKUP_MAGIC, iv]), { flag: "wx", mode: 0o600 });
    targetCreated = true;
    await pipeline(createReadStream(source), cipher, createWriteStream(target, { flags: "a" }));
    await appendFile(target, cipher.getAuthTag());
  } catch (error) {
    if (targetCreated) await rm(target, { force: true });
    throw error;
  }
}

export async function decryptBackupFile(source, target, key) {
  const encryptedSize = (await stat(source)).size;
  if (encryptedSize <= HEADER_LENGTH + TAG_LENGTH) {
    throw new TypeError("The encrypted backup is incomplete.");
  }

  const file = await open(source, "r");
  let header;
  let tag;
  try {
    header = Buffer.alloc(HEADER_LENGTH);
    tag = Buffer.alloc(TAG_LENGTH);
    const headerRead = await file.read(header, 0, HEADER_LENGTH, 0);
    const tagRead = await file.read(tag, 0, TAG_LENGTH, encryptedSize - TAG_LENGTH);
    if (headerRead.bytesRead !== HEADER_LENGTH || tagRead.bytesRead !== TAG_LENGTH
      || !header.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
      throw new TypeError("The encrypted backup format is invalid.");
    }
  } finally {
    await file.close();
  }

  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(BACKUP_MAGIC.length));
  decipher.setAuthTag(tag);
  const targetFile = await open(target, "wx", 0o600);
  try {
    await targetFile.close();
    await pipeline(
      createReadStream(source, { start: HEADER_LENGTH, end: encryptedSize - TAG_LENGTH - 1 }),
      decipher,
      createWriteStream(target, { flags: "a" }),
    );
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  }
}
