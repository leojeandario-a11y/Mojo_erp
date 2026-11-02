import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { File as BufferFile } from "node:buffer";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const MAX_FINANCE_DOCUMENT_SIZE = 10 * 1024 * 1024;

const supportedTypes = {
  ".pdf": { mimeType: "application/pdf", signature: (bytes: Buffer) => bytes.subarray(0, 5).toString("ascii") === "%PDF-" },
  ".jpg": { mimeType: "image/jpeg", signature: (bytes: Buffer) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  ".jpeg": { mimeType: "image/jpeg", signature: (bytes: Buffer) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  ".png": { mimeType: "image/png", signature: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
} as const;

export class FinanceDocumentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function isUploadedFile(value: FormDataEntryValue | null): value is globalThis.File {
  return value instanceof BufferFile;
}

function documentRoot() {
  return process.env.FINANCE_DOCUMENTS_DIR?.trim()
    ? path.resolve(process.env.FINANCE_DOCUMENTS_DIR)
    : path.join(homedir(), ".mojo-erp", "private-finance-documents");
}

function safeOriginalName(name: string) {
  const baseName = path.basename(name.replaceAll("\\", "/"));
  const safeName = Array.from(baseName)
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join("")
    .trim()
    .slice(0, 180);
  return safeName || "supporting-document";
}

export async function storeFinanceDocument(file: File) {
  if (file.size < 1 || file.size > MAX_FINANCE_DOCUMENT_SIZE) {
    throw new FinanceDocumentError("Supporting documents must be between 1 byte and 10 MB.", 413);
  }

  const fileName = safeOriginalName(file.name);
  const extension = path.extname(fileName).toLowerCase() as keyof typeof supportedTypes;
  const type = supportedTypes[extension];
  if (!type || file.type !== type.mimeType) {
    throw new FinanceDocumentError("Only PDF, JPEG, and PNG supporting documents are accepted.", 415);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!type.signature(bytes)) {
    throw new FinanceDocumentError("The uploaded file content does not match its file type.", 415);
  }

  const storageKey = `${randomUUID()}${extension}`;
  const root = documentRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(path.join(root, storageKey), bytes, { flag: "wx", mode: 0o600 });

  return {
    storageKey,
    fileName,
    mimeType: type.mimeType,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function isSafeFinanceDocumentKey(storageKey: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/i.test(storageKey);
}

export async function readFinanceDocument(storageKey: string) {
  if (!isSafeFinanceDocumentKey(storageKey)) {
    throw new FinanceDocumentError("Document not found.", 404);
  }
  try {
    return await readFile(path.join(documentRoot(), storageKey));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new FinanceDocumentError("Document file is missing from local storage.", 404);
    }
    throw error;
  }
}

export async function removeFinanceDocument(storageKey: string) {
  if (!isSafeFinanceDocumentKey(storageKey)) return;
  await rm(path.join(documentRoot(), storageKey), { force: true });
}
