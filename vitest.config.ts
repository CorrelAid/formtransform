import { defineConfig } from 'vitest/config';

// Three projects, split by what a failure means:
//   unit        — a transformation behaves wrongly (fast, no fixtures on disk)
//   integration — the library mishandles a whole hand-authored survey
//   contract    — output drifted from the blessed registry snapshots, so either
//                 the emitter regressed or the snapshots need re-blessing
//                 (`npm run bless`)
// Run one with `npm run test:unit` / `test:integration` / `test:contract`.
const shared = { globals: true, environment: 'node' as const };

export default defineConfig({
  test: {
    ...shared,
    projects: [
      {
        test: {
          ...shared,
          name: 'unit',
          include: ['src/test/**/*.test.ts'],
          exclude: ['src/test/contract/**', 'src/test/integration/**'],
        },
      },
      {
        test: {
          ...shared,
          name: 'integration',
          include: ['src/test/integration/**/*.test.ts'],
        },
      },
      {
        test: {
          ...shared,
          name: 'contract',
          include: ['src/test/contract/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['dist', 'node_modules', '**/*.test.ts'],
    },
  },
});
