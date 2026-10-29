import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("French, Haitian Creole, and English dictionaries have matching keys", async () => {
  const source = await readFile(new URL("../src/lib/i18n.ts", import.meta.url), "utf8");
  const dictionaries = Array.from(source.matchAll(/^\s{2}(fr|ht|en): \{\n([\s\S]*?)^\s{2}\},?$/gm));
  assert.equal(dictionaries.length, 3);

  const keysByLocale = dictionaries.map(([, locale, contents]) => {
    const keys = Array.from(contents.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm), (match) => match[1]);
    assert.equal(new Set(keys).size, keys.length, `${locale} has duplicate translation keys`);
    return { locale, keys: keys.sort() };
  });
  assert.deepEqual(keysByLocale[1].keys, keysByLocale[0].keys, "Haitian Creole keys match French");
  assert.deepEqual(keysByLocale[2].keys, keysByLocale[0].keys, "English keys match French");
});
