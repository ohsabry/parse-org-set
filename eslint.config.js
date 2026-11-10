import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier/flat'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import { flatConfigs as importX } from 'eslint-plugin-import-x'
import unusedImports from 'eslint-plugin-unused-imports'
import { configs as tseslint } from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['reference/', '**/dist/']),

  js.configs.recommended,
  tseslint.recommended,
  importX.recommended,
  importX.typescript,

  {
    languageOptions: {
      // Type-aware linting (needed by no-floating-promises): each file is
      // checked with the tsconfig that covers it.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    settings: {
      // `bun:test` is built into Bun, not a package in node_modules.
      'import-x/core-modules': ['bun:test'],
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
    plugins: { 'unused-imports': unusedImports },
    rules: {
      'no-undef': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-nested-ternary': 'error',
      'no-warning-comments': 'warn',
      'prefer-template': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: ":matches(PropertyDefinition, MethodDefinition)[accessibility='private']",
          message:
            'Use # instead of private or underscore to declare a private method or property: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_class_fields',
        },
      ],

      'import-x/namespace': 'off',
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', ['unknown']],
          alphabetize: { order: 'asc' },
        },
      ],
      'import-x/no-extraneous-dependencies': [
        'error',
        // The CLI bundles core into its published file, so core is a dev dependency there.
        { devDependencies: ['**/test/**', '**/e2e/**', 'eslint.config.js', 'packages/cli/src/**'] },
      ],

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'no-public' }],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],

      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
      ],
    },
  },

  // Plain JS files (just this config, for now) aren't in any tsconfig,
  // so type-aware rules are switched off for them.
  { files: ['**/*.js'], extends: [tseslint.disableTypeChecked] },

  // Near the end, so it can turn off any rule that would fight Prettier's formatting.
  prettier,

  // eslint-config-prettier turns `curly` off, but the "all" option never
  // conflicts with Prettier, so it's safe to switch back on.
  { rules: { curly: ['error', 'all'] } },
)
