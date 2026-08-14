import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  // tsconfig.json sets jsx: "preserve" for Next.js's own compiler. Vite 6's
  // default oxc transform ignores esbuild.jsx overrides, so fall back to the
  // esbuild transform pipeline (which does respect it) for test files.
  oxc: false,
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    // Default environment stays 'node' for speed (API routes, lib/ tests).
    // Component/page tests opt into jsdom individually via a
    // `// @vitest-environment jsdom` docblock at the top of the test file.
    environment: 'node',
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**', 'tests/e2e/**', 'infra/**', 'fetch-blogs/**'],
    setupFiles: ['./vitest.setup.ts'],
    // RTL's asyncUtilTimeout (see vitest.setup.ts) can exceed vitest's
    // default 5000ms per-test timeout under a large parallel suite.
    testTimeout: 40000,
    // Each jsdom test file spins up its own DOM. Running too many at once
    // starves React's effect/timer scheduling and makes waitFor() assertions
    // flaky, so cap concurrency for a deterministic `npm test`.
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
      reportOnFailure: true,
    },
  },
});
