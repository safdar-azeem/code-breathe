import tsParser from '@typescript-eslint/parser'
import vueParser from 'vue-eslint-parser'
import plugin from './plugin.mjs'

export const scriptFiles = ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue}']
export const defaultIgnores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/dist-ssr/**',
  '**/build/**',
  '**/coverage/**',
  '**/.git/**',
  '**/.nuxt/**',
  '**/.next/**',
  '**/.output/**',
  '**/.cache/**',
  '**/vendor/**',
  '**/logs/**',
  '**/*.min.js',
  '**/*.generated.*',
]

export default [
  { name: 'code-breathe/ignores', ignores: defaultIgnores },
  {
    name: 'code-breathe/scripts',
    files: scriptFiles,
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'code-breathe': plugin },
    rules: { 'code-breathe/logical-groups': 'error' },
  },
  {
    name: 'code-breathe/vue',
    files: ['**/*.vue'],
    languageOptions: { parser: vueParser, parserOptions: { parser: tsParser } },
  },
  {
    name: 'code-breathe/commonjs',
    files: ['**/*.{cjs,cts}'],
    languageOptions: { sourceType: 'commonjs' },
  },
]
