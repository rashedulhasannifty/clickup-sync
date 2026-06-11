// Root ESLint flat config for the NestJS backend (src + test).
// The web app under apps/web has its own config and is ignored here.
//
// Deliberately uses the NON type-checked recommended set: it's fast, runs
// without a tsconfig project, and avoids a flood of type-aware findings on an
// existing codebase. `any` is allowed (untrusted ClickUp payloads + test
// fixtures rely on it); unused vars are a warning with an underscore escape.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'apps/**', 'coverage', 'prisma/migrations/**']),
  {
    files: ['{src,test}/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-function': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
]);
