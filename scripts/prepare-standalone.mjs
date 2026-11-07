import { cp, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const standaloneDirectory = resolve(".next/standalone");
const publicDirectory = resolve("public");
const staticDirectory = resolve(".next/static");

for (const directory of [standaloneDirectory, publicDirectory, staticDirectory]) {
  const details = await stat(directory).catch(() => null);
  if (!details?.isDirectory()) {
    throw new Error(`Required standalone build directory is missing: ${directory}`);
  }
}

await mkdir(resolve(standaloneDirectory, ".next"), { recursive: true });
await Promise.all([
  cp(publicDirectory, resolve(standaloneDirectory, "public"), { recursive: true, force: true }),
  cp(staticDirectory, resolve(standaloneDirectory, ".next/static"), { recursive: true, force: true }),
]);
