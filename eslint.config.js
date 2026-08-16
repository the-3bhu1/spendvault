import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Build output and the native platform shells: all generated, none authored here.
  globalIgnores(['dist', 'android', 'ios']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // A leading underscore is how this codebase already marks a binding as
      // deliberately unused — a positional param it has to declare but not read,
      // or a destructured key it is skipping past.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // Emoji in user-facing strings are separated from the following text by an
      // en-space (U+2002); a plain space sets them too close. Those live in
      // template literals, which the rule inspects by default.
      'no-irregular-whitespace': ['error', { skipTemplates: true }],
    },
  },
])
