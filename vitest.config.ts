import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/core/**/*.ts', 'src/pseudo/**/*.ts'],
      exclude: [
        'src/core/**/*.test.ts',
        'src/pseudo/**/*.test.ts',
        'src/core/errors.ts',
        'src/core/logger.ts',
        'src/core/github-engine.ts', // network-bound: exercised via integration tests only
        'src/core/ingest.ts', // network + fflate: integration only
      ],
      thresholds: { lines: 80, branches: 70 },
    },
  },
});
