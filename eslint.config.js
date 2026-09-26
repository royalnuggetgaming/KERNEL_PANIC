// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const THREE_ALLOWED = ['src/assets/**', 'src/render/**', 'src/app/**', 'src/debug/**'];

export default defineConfig(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.vite/**'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'vite.config.ts', 'vitest.config.ts', 'scripts/*.mjs'],
          defaultProject: './tsconfig.node.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/prefer-for-of': 'off',
      '@typescript-eslint/no-unnecessary-condition': ['error', { allowConstantLoopConditions: true }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'Enums are banned (erasableSyntaxOnly).' },
        { selector: 'TSModuleDeclaration[kind="namespace"]', message: 'Namespaces are banned.' },
        { selector: 'ExportDefaultDeclaration', message: 'Use named exports.' },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: THREE_ALLOWED,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'three', message: "'three' is only allowed in assets/, render/, app/ and debug/." },
          ],
          patterns: [
            { group: ['three/*'], message: "'three' is only allowed in assets/, render/, app/ and debug/." },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/class-methods-use-this': 'off',
    },
  },
  {
    files: ['eslint.config.js', 'vite.config.ts', 'vitest.config.ts', 'scripts/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-syntax': 'off',
      'no-console': 'off',
    },
  },
);
