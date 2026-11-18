import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'out/',
      'dist/',
      'release/',
      'node_modules/',
      'test-results/',
      'playwright-report/',
      'coverage/',
      'docs/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Main, preload, shared and config files run in Node.
    files: ['**/*.{ts,mts,js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Renderer runs in the browser with React.
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    // Pinned: eslint-plugin-react's 'detect' still calls APIs removed in ESLint 10.
    settings: { react: { version: '19.3' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },
  eslintConfigPrettier,
);
