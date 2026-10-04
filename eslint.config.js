import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";
import tseslint from "webgpu-renderer-lint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "dist/**",
    ".vite/**",
    "artifacts/**",
    "public/**",
    "benchmarks/results/**",
  ]),
  {
    files: ["**/*.{js,mjs,ts}"],
    extends: [js.configs.recommended],
    // Browser GPU regression scripts run Node orchestration and page.evaluate callbacks.
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.worker },
    },
  },
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Prettier owns formatting; ESLint checks code correctness without competing style rules.
  prettier,
]);
