import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
      "infra/**",
      "fetch-blogs/**",
      "coverage/**",
      ".scannerwork/**",
      ".tools/**",
      "reports/**",
      "scratch/**",
      "public/**",
      "**/*.min.js",
      ".claude/worktrees/**",
    ],
  },
  {
    extends: [...next],
  }
]);
