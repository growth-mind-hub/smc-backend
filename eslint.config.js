import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', '.npm-cache/**', 'coverage/**', 'data/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],
      'no-duplicate-imports': 'error',
      'no-implicit-coercion': 'error',
      'no-return-assign': 'error',
      'no-throw-literal': 'error',
      'no-promise-executor-return': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-useless-return': 'error',
      'no-template-curly-in-string': 'error',
    },
  },
];
