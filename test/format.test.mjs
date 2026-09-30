import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import config from '../src/eslint.mjs'
import { runFormatting } from '../src/format.mjs'
import { initialize } from '../src/init.mjs'
import { collectFiles } from '../src/files.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

const quiet = () => {}

const fixture = async (context, files = {}) => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'code-breathe-unit-'))
  context.after(() => rm(cwd, { recursive: true, force: true }))
  for (const [name, content] of Object.entries({
    'package.json': '{"name":"consumer","private":true}',
    ...files,
  })) {
    await mkdir(path.dirname(path.join(cwd, name)), { recursive: true })
    await writeFile(path.join(cwd, name), content)
  }
  await mkdir(path.join(cwd, 'node_modules'), { recursive: true })
  await symlink(root, path.join(cwd, 'node_modules/code-breathe'), 'dir')
  return cwd
}

const fix = async (text, filePath = 'src/example.vue') => {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config, fix: true })
  const [result] = await eslint.lintText(text, { filePath })
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages))
  return result.output ?? text
}

test('inserts exact import, props, composable and computed boundaries', async () => {
  const text = `<script setup lang="ts">
import { computed } from 'vue'
import { useSection } from './data'
const props = withDefaults(defineProps<{ scope?: string }>(), { scope: 'active' })
const active = useSection('socials')
const home = useSection('socials', { scope: 'home' })
const section = computed(() => props.scope === 'home' ? home.value : active.value)
</script>
`
  const output = await fix(text)
  assert.match(output, /from '\.\/data'\n\nconst props/)
  assert.match(output, /scope: 'active' \}\)\n\nconst active/)
  assert.match(output, /const active[^\n]*\nconst home/)
  assert.match(output, /const home[^\n]*\n\nconst section/)
  assert.equal(await fix(output), output)
})

test('supports Vue aliases, namespaces and effects', async () => {
  const alias = await fix(
    "import { computed as derive, onMounted as mount } from 'vue'\nconst state = 1\nconst value = derive(() => state)\nmount(() => {})\n",
    'example.ts'
  )
  assert.match(alias, /state = 1\n\nconst value/)
  assert.match(alias, /derive\(\(\) => state\)\n\nmount/)
  const namespace = await fix(
    "import * as Vue from 'vue'\nconst state = 1\nconst value = Vue.computed(() => state)\n",
    'example.ts'
  )
  assert.match(namespace, /state = 1\n\nconst value/)
})

test('separates each callback declaration while keeping simple composables together', async () => {
  const text = `<script setup lang="ts">
import { computed } from 'vue'
const website = useWebsite()
const profile = useSection('profile')
const id = computed(() => profile.value?.id)
const binding = computed(() => website.binding(id.value))
const select = () => {
  website.select(id.value)
}
const retry = () => {
  website.retry(id.value)
}
</script>
`
  const output = await fix(text)
  assert.match(output, /useWebsite\(\)\nconst profile/)
  assert.match(output, /useSection\('profile'\)\n\nconst id/)
  assert.match(output, /profile.value\?\.id\)\n\nconst binding/)
  assert.match(output, /website.binding\(id.value\)\)\n\nconst select/)
  assert.match(output, /website.select\(id.value\)\n\}\n\nconst retry/)
  assert.equal(await fix(output), output)
})

test('separates multiline calls and traditional functions, not nested callbacks', async () => {
  const text = `const website = useWebsite()
const profile = useSection(
  'profile',
  { scope: 'home' }
)
const socials = useSection('socials')
function select() {
  const values = [1, 2]
  const filtered = values.filter((value) => value > 1)
  return filtered
}
function retry() {
  return website.retry()
}
const transform = function () { return 1 }
const read = function () { return 2 }
`
  const output = await fix(text, 'example.ts')
  assert.match(output, /useWebsite\(\)\n\nconst profile/)
  assert.match(output, /scope: 'home' \}\n\)\n\nconst socials/)
  assert.match(output, /return filtered\n\}\n\nfunction retry/)
  assert.match(output, /values = \[1, 2\]\n  const filtered/)
  assert.match(output, /return 1 \}\n\nconst read/)
  assert.equal(await fix(output, 'example.ts'), output)
})

test('does not classify unrelated computed/on-prefixed functions as Vue APIs', async () => {
  const text =
    "import { computed, onMounted } from './business'\nconst state = 1\nconst a = computed(state)\nconst b = onMounted(a)\nconst c = onPurchase(b)\n"
  const output = await fix(text, 'example.ts')
  assert.match(output, /state = 1\nconst a/)
  assert.match(output, /const a[^\n]*\nconst b[^\n]*\nconst c/)
})

test('preserves multiple trailing comments and leading documentation', async () => {
  const text =
    "import { computed } from 'vue'\nconst state = 1 /* first */ /* second */\n/** Derived state. */\nconst value = computed(() => state)\n"
  const output = await fix(text, 'example.ts')
  assert.match(
    output,
    /\/\* first \*\/ \/\* second \*\/\n\n\/\*\* Derived state\. \*\/\nconst value/
  )
})

test('does not alter nested function bodies or separate overloads', async () => {
  const text =
    'function fn(a: string): string\nfunction fn(a: number): number\nfunction fn(a: string | number) {\nconst state = 1\nreturn a\n}\n'
  assert.equal(await fix(text, 'example.ts'), text)
})

test('preserves two Vue script blocks and CRLF', async () => {
  const text =
    '<script lang="ts">\nexport const version = 1\n</script>\n<script setup lang="ts">\nconst props = defineProps<{ value: number }>()\nconst state = props.value\n</script>\n'
  const output = await fix(text)
  assert.match(output, /<\/script>\n<script setup/)
  assert.match(output, /defineProps<\{ value: number \}>\(\)\n\nconst state/)
  const crlf =
    "import { computed } from 'vue'\r\nconst state = 1\r\nconst value = computed(() => state)\r\n"
  const fixed = await fix(crlf, 'example.ts')
  assert.match(fixed, /state = 1\r\n\r\nconst value/)
  assert.equal(fixed.replaceAll('\r\n', '').includes('\n'), false)
})

test('formats Vue/TS/JSX/CSS/JSON and preserves existing indentation', async (context) => {
  const cwd = await fixture(context, {
    '.prettierrc.json': '{"tabWidth":3,"semi":false,"singleQuote":true}',
    'src/example.vue':
      '<script setup lang="ts">\nimport { computed } from "vue"\nconst props=defineProps<{value:number}>()\nconst a=1\nconst b=computed(()=>a)\n</script>\n<template><div :id="String(a)" class="box">{{b}}</div></template>',
    'src/component.tsx':
      'import React from "react"\nconst value=1\nexport const View=()=> <div>{value}</div>',
    'style.css': '.box{color:red}',
    'data.json': '{"nested":{"value":1}}',
  })
  const before = await readFile(path.join(cwd, 'src/example.vue'), 'utf8')
  const check = await runFormatting({ cwd, all: true, log: quiet })
  assert.equal(check.exitCode, 1)
  assert.equal(await readFile(path.join(cwd, 'src/example.vue'), 'utf8'), before)
  assert.equal((await runFormatting({ cwd, all: true, write: true, log: quiet })).exitCode, 0)
  const output = await readFile(path.join(cwd, 'style.css'), 'utf8')
  assert.match(output, /\n {3}color:/)
  assert.equal((await runFormatting({ cwd, all: true, log: quiet })).exitCode, 0)
})

test('uses common ignore rules and refuses out-of-project writes', async (context) => {
  const cwd = await fixture(context, {
    '.prettierignore': 'vendor-docs/\n',
    '.gitignore': 'scratch.js\n',
    'app.js': 'const app=1',
    'scratch.js': 'const scratch=1',
    'vendor-docs/example.js': 'const docs=1',
    'dist/output.js': 'const output=1',
    'api.generated.ts': 'const api=1',
    '.env': 'TOKEN=secret',
  })
  assert.deepEqual(await collectFiles({ cwd, all: true }), ['app.js', 'package.json'])
  await assert.rejects(
    runFormatting({ cwd, write: true, patterns: ['../outside.js'] }),
    /inside the project/
  )
  await assert.rejects(runFormatting({ cwd, write: true, changed: true }), /check-only/)
})

test('does not overwrite a malformed source file', async (context) => {
  const text = 'const x = {'
  const cwd = await fixture(context, { 'broken.ts': text })
  const result = await runFormatting({ cwd, patterns: ['broken.ts'], write: true, log: quiet })
  assert.equal(result.errors, 1)
  assert.equal(await readFile(path.join(cwd, 'broken.ts'), 'utf8'), text)
})

test('Git checks include local and committed changes against a base', async (context) => {
  const cwd = await fixture(context, { '.gitignore': 'node_modules/\n', 'a.js': 'const a = 1\n' })
  const git = (args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
  git(['init', '-q'])
  git(['config', 'user.email', 'fixture@example.test'])
  git(['config', 'user.name', 'Fixture'])
  git(['add', '.'])
  git(['commit', '-qm', 'base'])
  const base = git(['rev-parse', 'HEAD'])
  await writeFile(path.join(cwd, 'a.js'), 'const a=2')
  git(['add', 'a.js'])
  git(['commit', '-qm', 'change'])
  await writeFile(path.join(cwd, 'untracked.js'), 'const b=1')
  assert.deepEqual(await collectFiles({ cwd, changed: true }), ['untracked.js'])
  assert.deepEqual(await collectFiles({ cwd, base }), ['a.js', 'untracked.js'])
  assert.equal((await runFormatting({ cwd, base, log: quiet })).exitCode, 1)
})

test('init is idempotent and supports CommonJS consumer projects', async (context) => {
  const cwd = await fixture(context)
  const result = await initialize({ cwd, log: quiet })
  assert.ok(result.changed.includes('AGENTS.md'))
  const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['format:files'], 'code-breathe format')
  assert.equal(pkg.type, undefined)
  const settings = JSON.parse(await readFile(path.join(cwd, '.vscode/settings.json'), 'utf8'))
  assert.equal(settings['[vue]']['editor.codeActionsOnSave']['source.fixAll.eslint'], 'always')
  assert.equal(settings['prettier.prettierPath'], './node_modules/code-breathe/editor/prettier.cjs')
  assert.deepEqual((await initialize({ cwd, log: quiet })).changed, [])
  const require = createRequire(path.join(cwd, 'package.json'))
  assert.ok(require('code-breathe/editor/prettier').version)
  const extended =
    "// Managed by code-breathe.\nimport config from 'code-breathe/eslint'\n\nexport default [...config, { ignores: ['generated/**'] }]\n"
  await writeFile(path.join(cwd, 'eslint.config.mjs'), extended)
  assert.deepEqual((await initialize({ cwd, log: quiet })).changed, [])
  assert.equal(await readFile(path.join(cwd, 'eslint.config.mjs'), 'utf8'), extended)
})

test('Git selection works from a nested project directory', async (context) => {
  const cwd = await fixture(context, {
    '.gitignore': 'node_modules/\n',
    'app/a.js': 'const a = 1\n',
  })
  const git = (args) => execFileSync('git', args, { cwd, stdio: 'pipe' })
  git(['init', '-q'])
  git(['add', '.'])
  assert.deepEqual(await collectFiles({ cwd: path.join(cwd, 'app'), changed: true }), ['a.js'])
  await writeFile(path.join(cwd, 'app/b.js'), 'const b=1')
  assert.deepEqual(await collectFiles({ cwd: path.join(cwd, 'app'), changed: true }), [
    'a.js',
    'b.js',
  ])
})

test('init refuses symlinked editor directories before writing', async (context) => {
  const cwd = await fixture(context)
  await mkdir(path.join(cwd, 'shared'))
  await symlink(path.join(cwd, 'shared'), path.join(cwd, '.vscode'), 'dir')
  await assert.rejects(initialize({ cwd, log: quiet }), /symlinked configuration/)
  assert.equal(
    await readFile(path.join(cwd, 'package.json'), 'utf8'),
    '{"name":"consumer","private":true}'
  )
})

test('init preserves JSONC comments, user instructions, and Prettier preferences', async (context) => {
  const cwd = await fixture(context, {
    'package.json':
      '{"name":"consumer","packageManager":"yarn@1.22.22","prettier":{"tabWidth":3},"scripts":{"dev":"vite"}}',
    '.vscode/settings.json':
      '{\n// Preserve this comment.\n"editor.fontSize": 16,\n"[vue]": { "editor.codeActionsOnSave": { "source.fix": "never" } }\n}',
    'AGENTS.md': '# Project\n\nNever delete user files.\n',
  })
  await initialize({ cwd, log: quiet })
  const settings = await readFile(path.join(cwd, '.vscode/settings.json'), 'utf8')
  assert.match(settings, /Preserve this comment/)
  assert.match(settings, /"editor.fontSize": 16/)
  const instructions = await readFile(path.join(cwd, 'AGENTS.md'), 'utf8')
  assert.match(instructions, /Never delete user files/)
  assert.match(instructions, /yarn format:files/)
  assert.equal(
    JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')).prettier.tabWidth,
    3
  )
  assert.deepEqual((await initialize({ cwd, log: quiet })).changed, [])
})

test('dry-run leaves the project unchanged', async (context) => {
  const cwd = await fixture(context)
  const original = await readFile(path.join(cwd, 'package.json'), 'utf8')
  const result = await initialize({ cwd, dryRun: true, log: quiet })
  assert.ok(result.changed.length)
  assert.equal(await readFile(path.join(cwd, 'package.json'), 'utf8'), original)
  await assert.rejects(readFile(path.join(cwd, 'AGENTS.md')), { code: 'ENOENT' })
})

test('existing ESLint/script conflicts and invalid JSON abort before writing', async (context) => {
  for (const files of [
    { 'eslint.config.mjs': 'export default []' },
    { 'package.json': '{"scripts":{"format":"custom-formatter"}}' },
    { '.vscode/settings.json': '{ broken' },
  ]) {
    const cwd = await fixture(context, files)
    const original = await readFile(path.join(cwd, 'package.json'), 'utf8')
    await assert.rejects(initialize({ cwd, log: quiet }))
    assert.equal(await readFile(path.join(cwd, 'package.json'), 'utf8'), original)
    await assert.rejects(readFile(path.join(cwd, 'AGENTS.md')), { code: 'ENOENT' })
  }
})
