import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import importPlugin from 'eslint-plugin-import';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import promisePlugin from 'eslint-plugin-promise';

/**
 * A+ ESLint configuration for TypeScript projects
 * - Type-aware linting
 * - Import organization and validation
 * - Promise handling best practices
 * - JSDoc validation
 * - Naming conventions
 * - Code style consistency
 */
export default [
  {
    // Apply to all TypeScript files in src directory
    files: ['src/**/*.ts'],

    // Language options with type-aware parsing
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: '.',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },

    // Enable all required plugins
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
      jsdoc: jsdocPlugin,
      promise: promisePlugin,
    },

    // Rules configuration
    rules: {
      // Base rule sets
      ...eslint.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      ...importPlugin.configs.recommended.rules,
      ...promisePlugin.configs.recommended.rules,

      // TypeScript specific rules
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Prohibit any type
      '@typescript-eslint/no-explicit-any': 'error',

      // Enforce explicit return types on functions and class methods (warning for transition)
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],

      // Enforce naming conventions as warnings during transition
      '@typescript-eslint/naming-convention': [
        'warn',
        // Interface names should be PascalCase
        {
          selector: 'interface',
          format: ['PascalCase'],
        },
        // Type aliases should be PascalCase
        {
          selector: 'typeAlias',
          format: ['PascalCase'],
        },
        // Enum names should be PascalCase
        {
          selector: 'enum',
          format: ['PascalCase'],
        },
        // Class names should be PascalCase
        {
          selector: 'class',
          format: ['PascalCase'],
        },
        // Private members should be camelCase and start with underscore
        {
          selector: 'memberLike',
          modifiers: ['private'],
          format: ['camelCase'],
          leadingUnderscore: 'require',
        },
      ],

      // Don't prohibit console logs since this is a backend application
      'no-console': 'off',

      // Turn off no-undef as TypeScript handles this
      'no-undef': 'off',

      // Warn on case fallthrough issues
      'no-case-declarations': 'off',

      // Warn on empty blocks
      'no-empty': 'warn',

      // Useless escape warning
      'no-useless-escape': 'warn',

      // Conditional assignment warning
      'no-cond-assign': 'warn',

      // Maximum line length
      'max-len': [
        'warn',
        {
          code: 120, // Increased to 120
          ignoreComments: true,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
        },
      ],

      // Import plugin rules
      'import/no-unresolved': 'off', // TypeScript handles this
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',
      'import/no-cycle': 'error',
      'import/no-useless-path-segments': 'error',

      // Promise handling
      'promise/always-return': 'warn',
      'promise/catch-or-return': 'warn',
      'promise/no-nesting': 'warn',

      // JSDoc validation
      'jsdoc/require-jsdoc': [
        'warn',
        {
          publicOnly: true,
          require: {
            ClassDeclaration: false,
            MethodDefinition: false,
            FunctionDeclaration: false,
          },
          exemptEmptyFunctions: true,
        },
      ],
      'jsdoc/check-param-names': 'warn',
      'jsdoc/check-types': 'warn',
    },
  },
];
