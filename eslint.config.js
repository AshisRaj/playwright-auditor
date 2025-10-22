import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  // Ignore build and report artifacts
  {
    ignores: [
      'dist/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/test-results/**',
      '**/test-report/**',
      '**/allure-results/**',
      '**/allure-report/**',
      '**/playwright-report/**',
      '**/specs/**',
      '**/logs/**',
      '**/temp/**',
      '**services/**',
      '**/tsconfig.json',
      '**/tsconfig.*.json',
      '**/package*.json',
      '**/openapitools.json',
      '**/executors.json',
      '.vscode/**',
      '**/utils/test-scenarios.json',
      '**/configs/executor.json',
      '**/artifacts/**/*cookies.json',
      '**/artifacts/reports/**',
      'playwright.config.ts',
      'eslint.config.js',
      '**/.husky/*',
    ],
  },

  // Base language options (Node + ESM)
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // JavaScript rules
  js.configs.recommended,

  // TypeScript rules (applies only to *.ts/tsx)
  ...tseslint.configs.recommended,
  {
    files: [
      'tests/**/*.{ts,tsx,js,jsx}',
      '**/*.spec.{ts,tsx,js,jsx}',
      '**/*.test.{ts,tsx,js,jsx}',
      '**/*.{ts,tsx,js,jsx}',
    ],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        // Variable names (camelCase or UPPER_CASE for constants)
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'objectLiteralProperty',
          format: null, // disables the rule for object literal properties
          modifiers: ['requiresQuotes'],
          filter: {
            // Exclude any property name that contains an underscore
            regex: '^[^_]+$',
            match: true,
          },
        },

        // Function names (camelCase)
        {
          selector: 'function',
          format: ['camelCase'],
        },
        //Method names (camelCase)
        {
          selector: 'method',
          format: ['camelCase'],
        },
        // Class names (PascalCase)
        {
          selector: 'class',
          format: ['PascalCase'],
        },
        // Interface names (PascalCase with "I" prefix)
        {
          selector: 'interface',
          format: ['PascalCase'],
          // custom: {
          //   regex: '^I[A-Z]',
          //   match: true,
          // },
        },
        // Type aliases (PascalCase)
        {
          selector: 'typeAlias',
          format: ['PascalCase'],
        },
        // Enum names (PascalCase)
        {
          selector: 'enum',
          format: ['PascalCase'],
        },
        // Enum members (UPPER_CASE or PascalCase)
        {
          selector: 'enumMember',
          format: ['UPPER_CASE', 'PascalCase'],
        },
        // Property names (camelCase)
        {
          selector: 'property',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
          modifiers: ['requiresQuotes'], // ✅ Allow quoted keys to bypass the rule
          filter: {
            // Exclude any property name that contains an underscore
            regex: '^[^_]+$',
            match: true,
          },
        },
      ],
    },
  },

  // Turn off formatting-related rules to let Prettier handle style
  prettier,
];
