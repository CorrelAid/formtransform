import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const tsParser = tseslint.parser;

export default defineConfig([
  // Global: fail on eslint-disable directives that no longer suppress anything,
  // so dead disables can't accumulate.
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Base configs
  js.configs.recommended,
  tseslint.configs.recommended,

  // Type-aware linting for TS modules in the tsconfig project. Tests, generated
  // code, and *.d.ts sit outside the tsconfig (or are excluded), so the project
  // service can't type them — they fall back to non-type-checked linting.
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: ['src/**/*.ts'],
    ignores: [
      'src/test/**',
      'src/**/*.test.ts',
      'src/generated/**',
      'src/types/**/*.d.ts',
    ],
  })),
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/test/**',
      'src/**/*.test.ts',
      'src/generated/**',
      'src/types/**/*.d.ts',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Complexity gates (warn-level ratchet — caps existing hotspots, blocks
  // regression growth via --max-warnings).
  {
    files: ['**/*.{ts,js,mjs}'],
    rules: {
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 5],
    },
  },

  // Ratchet rules: pervasive in this XLSForm/DDI parser codebase. Kept as
  // warnings (capped via --max-warnings) so existing hits don't block, but any
  // new one counts against the cap. Tighten toward 'error' as hotspots clear.
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },

  // Ignore build output, generated code, vendored checkouts, tests and the
  // vitest config. These sit outside the tsconfig project (projectService can't
  // type them) and are not shipped — Prettier still formats them via the
  // format script.
  {
    ignores: [
      'dist/**',
      '**/*.d.ts',
      'src/generated/**',
      '.github/',
      '_xlsform2lstsv/**',
      'docs/**',
      'src/test/**',
      'tests/**',
      'vitest.config.ts',
      '**/*.test.ts',
    ],
  },
]);
