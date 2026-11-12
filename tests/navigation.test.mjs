import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the navigation indicator follows the active module route", async () => {
  const source = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");

  assert.match(source, /const isActive = pathname === href \|\| pathname\.startsWith\(`\$\{href\}\/`\)/);
  assert.match(source, /\{isActive && <span className="nav-active-dot"/);
  assert.doesNotMatch(source, /key === "dashboard" && <span className="nav-active-dot"/);
});
