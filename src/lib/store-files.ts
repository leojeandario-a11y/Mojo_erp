import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const imageDirectory = resolve(/*turbopackIgnore: true*/
  process.env.STORE_PRODUCT_IMAGES_DIR || join(homedir(), ".mojo-erp", "private-store-product-images"),
);
const imageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

export async function saveStoreProductImage(file: File) {
  const extension = imageTypes.get(file.type);
  if (!extension || file.size === 0 || file.size > 5 * 1024 * 1024) {
    throw new Error("Choose a non-empty PNG, JPEG, or WebP image up to 5 MB.");
  }
  const key = `${randomUUID()}${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const signatureValid = extension === ".jpg"
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : extension === ".png"
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.subarray(0, 4).toString("ascii") === "RIFF"
        && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!signatureValid) throw new Error("The uploaded image file is invalid.");
  await mkdir(imageDirectory, { recursive: true, mode: 0o700 });
  await writeFile(join(imageDirectory, key), bytes, { flag: "wx", mode: 0o600 });
  return { key, bytes, contentType: file.type };
}

export async function readStoreProductImage(key: string) {
  if (extname(key) !== ".jpg" && extname(key) !== ".png" && extname(key) !== ".webp") {
    throw new Error("Invalid product image key.");
  }
  const safeName = key.replace(/[^a-f0-9.-]/gi, "");
  if (safeName !== key) throw new Error("Invalid product image key.");
  const bytes = await readFile(join(imageDirectory, key));
  const contentType = key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return { bytes, contentType };
}

export async function deleteStoreProductImage(key: string) {
  if (extname(key) !== ".jpg" && extname(key) !== ".png" && extname(key) !== ".webp") {
    throw new Error("Invalid product image key.");
  }
  const safeName = key.replace(/[^a-f0-9.-]/gi, "");
  if (safeName !== key) throw new Error("Invalid product image key.");
  await unlink(join(imageDirectory, key));
}
