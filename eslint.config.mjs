import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = tseslint.config(
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.serviceworker, self: "readonly" },
    },
  },
  {
    files: ["public/sw.js"],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
  {
    files: ["tests/**/*.mjs", "scripts/**/*.mjs", "src/lib/backup-crypto.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);

export default eslintConfig;
