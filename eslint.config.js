import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import sveltePlugin from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  ...sveltePlugin.configs['flat/recommended'],
  {
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
      },
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-nested-template-literals': 'off',
      'complexity': ['error', 10],
      'max-depth': ['error', 5],
      'max-lines': ['error', 300],
      'max-lines-per-function': ['error', 50],
      'max-nested-callbacks': ['error', 3],
      'no-console': 'warn',
    },
  },
  {
    files: ['scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-nested-template-literals': 'off',
      'complexity': ['error', 10],
      'max-depth': ['error', 5],
      'max-lines': ['error', 300],
      'max-lines-per-function': ['error', 50],
      'max-nested-callbacks': ['error', 3],
      'no-console': 'off',
    },
  },
  {
    files: ['worker/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.worker,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'sonarjs/no-nested-template-literals': 'off',
      'sonarjs/slow-regex': 'off',
      'sonarjs/cognitive-complexity': ['error', 15],
      'complexity': ['error', 10],
      'max-depth': ['error', 5],
      'max-lines': ['error', 300],
      'max-lines-per-function': ['error', 50],
      'max-nested-callbacks': ['error', 3],
      'no-console': 'off',
    },
  },
  {
    ignores: [
      'node_modules/',
      'dist/',
      'static/data/',
      'static/images/',
      '.githooks/',
      '.claude/',
      'tests/e2e/',
      'vitest.config.ts',
      '*.config.*',
    ],
  },
];
