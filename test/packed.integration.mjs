import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(path.join(tmpdir(), 'code-breathe-packed-'))

const run = (cwd, executable, args, env = process.env) =>
  execFileSync(executable, args, { cwd, encoding: 'utf8', env, stdio: 'pipe' })

try {
  const packed = JSON.parse(run(root, 'npm', ['pack', '--json', '--pack-destination', temporary]))
  const consumer = path.join(temporary, 'consumer')
  await mkdir(consumer)
  await writeFile(path.join(consumer, 'package.json'), '{"name":"packed-consumer","private":true}')
  run(consumer, 'npm', [
    'install',
    '--ignore-scripts',
    '--install-strategy=nested',
    '--no-audit',
    '--no-fund',
    '-D',
    path.join(temporary, packed[0].filename),
  ])
  const cli = path.join(consumer, 'node_modules/code-breathe/bin/code-breathe.mjs')
  run(consumer, process.execPath, [cli, 'init'])
  assert.match(run(consumer, process.execPath, [cli, 'init']), /already initialized/i)
  await writeFile(
    path.join(consumer, 'Profile.vue'),
    '<script setup lang="ts">\nimport { computed } from "vue"\nconst props=defineProps<{name:string}>()\nconst website=useWebsite()\nconst profile=useSection("profile")\nconst label=computed(()=>props.name)\nconst upper=computed(()=>label.value.toUpperCase())\nconst select=()=>website.select()\nconst retry=()=>website.retry()\n</script>\n<template><p>{{label}}</p></template>'
  )
  run(consumer, 'npm', ['run', 'format:files', '--', 'Profile.vue'])
  assert.match(
    await readFile(path.join(consumer, 'Profile.vue'), 'utf8'),
    /from 'vue'\n\nconst props/
  )
  const formatted = await readFile(path.join(consumer, 'Profile.vue'), 'utf8')
  assert.match(formatted, /useWebsite\(\)\nconst profile/)
  assert.match(formatted, /computed\(\(\) => props.name\)\n\nconst upper/)
  assert.match(formatted, /website.select\(\)\n\nconst retry/)
  run(consumer, process.execPath, [cli, 'format', '--all'])
  run(consumer, process.execPath, [cli, 'check', '--all'])
  run(consumer, process.execPath, [cli, 'doctor'])
  const settings = JSON.parse(await readFile(path.join(consumer, '.vscode/settings.json'), 'utf8'))
  run(consumer, process.execPath, [
    '-e',
    `const p = require(${JSON.stringify(path.join(consumer, settings['prettier.prettierPath']))}); if (!p.version) process.exit(1)`,
  ])
  run(
    consumer,
    process.execPath,
    [
      '-e',
      'const { ESLint } = require("eslint"); (async () => { const e = new ESLint({fix:true}); const [r] = await e.lintText("import x from \\\"x\\\"\\nconst y=1\\n", {filePath:"sample.ts"}); if (r.errorCount || !r.output?.includes("\\n\\n")) process.exit(1) })().catch(() => process.exit(1))',
    ],
    { ...process.env, NODE_PATH: path.join(consumer, settings['eslint.nodePath']) }
  )
  console.log(
    'Packed consumer passed: nested dependencies, init, CLI, Prettier and ESLint editor runtimes.'
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
