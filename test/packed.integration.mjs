import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises'
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
  const managedInstructionFiles = ['AGENTS.md', 'CLAUDE.md', '.cursor/rules/code-breathe.mdc']
  const managedInstructions = await Promise.all(
    managedInstructionFiles.map((file) => readFile(path.join(consumer, file), 'utf8'))
  )
  for (const instructions of managedInstructions) {
    assert.match(instructions, /multiline Vue\/HTML attributes/i)
    assert.match(instructions, /v-if.*v-for.*priority/i)
    assert.match(instructions, /safe attributes.*shortest.to.longest/i)
    assert.match(instructions, /(?:unsafe|barrier).*preserve.*order/i)
  }
  assert.match(run(consumer, process.execPath, [cli, 'init']), /already initialized/i)
  for (const [index, file] of managedInstructionFiles.entries())
    assert.equal(await readFile(path.join(consumer, file), 'utf8'), managedInstructions[index])
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
  assert.match(formatted, /computed\(\(\) => props.name\)\nconst upper/)
  assert.match(formatted, /website.select\(\)\nconst retry/)

  const settings = JSON.parse(await readFile(path.join(consumer, '.vscode/settings.json'), 'utf8'))
  const editorPath = path.join(consumer, settings['prettier.prettierPath'])
  const configFiles = [
    'package.json',
    'eslint.config.mjs',
    '.prettierrc.json',
    '.prettierignore',
    '.editorconfig',
    '.gitignore',
    '.vscode/settings.json',
    '.vscode/extensions.json',
    'AGENTS.md',
    'CLAUDE.md',
    '.cursor/rules/code-breathe.mdc',
  ]
  const configSnapshots = await Promise.all(
    configFiles.map((file) => readFile(path.join(consumer, file), 'utf8'))
  )
  const attributeFixtures = {
    'Attributes.vue': `<script setup lang="ts">
const label = 'safe'
</script>
<template>
  <Widget
    v-if="visible"
    aria-label="A long label"
    :disabled="loading"
    @click.stop="open"
    id="card"
    class="card"
  />
  <my-widget
    :title="title"
    class="card"
    @close="close"
    :loading="loading"
  />
  <Widget id="custom" v-bind="attrs" />
</template>
<style scoped>
.card { color: red; }
</style>
`,
    'TypeScriptAttributes.vue': `<script setup lang="ts">
type SomeType = string | number

const value: SomeType = 1
</script>
<template>
  <Widget
    :value="value as SomeType"
    aria-label="A considerably longer assertion label"
    id="cast"
  />
  <Widget
    :value="value!"
    aria-label="A considerably longer nonnull label"
    id="nonnull"
  />
  <Widget
    :value="value satisfies SomeType"
    aria-label="A considerably longer satisfies label"
    id="satisfies"
  />
  <p>{{ value as SomeType }}</p>
  <button
    aria-label="A sortable sibling label"
    @click="select"
    id="sibling"
  >Select</button>
</template>
`,
    'attributes.html': `<main>
  <button
    aria-label="Open account settings"
    class="profile-button"
    :disabled="loading"
    @click="open"
    id="profile"
  >Settings</button>
  <div class="box"></div>
</main>
`,
    'unchanged.js': 'const value=1\n',
    'unchanged.css': '.box{color:red}\n',
  }
  for (const [file, source] of Object.entries(attributeFixtures))
    await writeFile(path.join(consumer, file), source)
  const editorOutputs = JSON.parse(
    run(consumer, process.execPath, [
      '-e',
      `const { createRequire } = require('node:module');
const editor = require(${JSON.stringify(editorPath)});
const packedRequire = createRequire(${JSON.stringify(editorPath)});
const plain = packedRequire('prettier');
const fixtures = ${JSON.stringify(attributeFixtures)};
(async () => {
  const outputs = { dependencyResolutions: Object.fromEntries(
    ['prettier', 'vue-eslint-parser', '@typescript-eslint/parser'].map(name => [name, packedRequire.resolve(name)])
  ) };
  for (const [file, source] of Object.entries(fixtures)) {
    const filepath = require('node:path').join(process.cwd(), file);
    const config = await plain.resolveConfig(filepath, { editorconfig: true });
    const options = { ...config, filepath };
    outputs[file] = {
      plain: await plain.format(source, options),
      editor: await editor.format(source, options),
    };
  }
  const file = 'attributes.html';
  const source = outputs[file].plain;
  const options = {
    ...(await plain.resolveConfig(file, { editorconfig: true })),
    filepath: require('node:path').join(process.cwd(), file),
    cursorOffset: source.indexOf('profile-button') + 7,
  };
  outputs.cursor = await editor.formatWithCursor(source, options);
  process.stdout.write(JSON.stringify(outputs));
})().catch(error => { console.error(error); process.exitCode = 1; });`,
    ])
  )
  for (const [dependency, resolution] of Object.entries(editorOutputs.dependencyResolutions)) {
    const dependencyDirectory = await realpath(
      path.join(consumer, 'node_modules/code-breathe/node_modules', dependency)
    )
    assert.ok(
      resolution.startsWith(dependencyDirectory + path.sep),
      `Packed consumer did not resolve its own nested ${dependency}: ${resolution}`
    )
  }
  assert.notEqual(editorOutputs['Attributes.vue'].editor, editorOutputs['Attributes.vue'].plain)
  assert.notEqual(
    editorOutputs['TypeScriptAttributes.vue'].editor,
    editorOutputs['TypeScriptAttributes.vue'].plain
  )
  assert.notEqual(editorOutputs['attributes.html'].editor, editorOutputs['attributes.html'].plain)
  assert.equal(editorOutputs['unchanged.js'].editor, editorOutputs['unchanged.js'].plain)
  assert.equal(editorOutputs['unchanged.css'].editor, editorOutputs['unchanged.css'].plain)
  for (const [binding, label, id] of [
    [
      ':value="value as SomeType"',
      'aria-label="A considerably longer assertion label"',
      'id="cast"',
    ],
    [':value="value!"', 'aria-label="A considerably longer nonnull label"', 'id="nonnull"'],
    [
      ':value="value satisfies SomeType"',
      'aria-label="A considerably longer satisfies label"',
      'id="satisfies"',
    ],
    ['@click="select"', 'aria-label="A sortable sibling label"', 'id="sibling"'],
  ]) {
    const output = editorOutputs['TypeScriptAttributes.vue'].editor
    const positions = [id, binding, label].map((attribute) => {
      assert.equal(output.split(attribute).length - 1, 1)
      return output.indexOf(attribute)
    })
    assert.ok(positions[0] < positions[1])
    assert.ok(positions[1] < positions[2])
  }
  const openingOrder = [
    'id="profile"',
    '@click="open"',
    ':disabled="loading"',
    'class="profile-button"',
    'aria-label="Open account settings"',
  ]
  const positions = openingOrder.map((attribute) =>
    editorOutputs['attributes.html'].editor.indexOf(attribute)
  )
  assert.ok(
    positions.every(
      (position, index) => position >= 0 && (!index || position > positions[index - 1])
    )
  )
  assert.equal(editorOutputs.cursor.formatted, editorOutputs['attributes.html'].editor)
  assert.equal(
    editorOutputs.cursor.cursorOffset,
    editorOutputs.cursor.formatted.indexOf('profile-button') + 7
  )
  for (const file of ['Attributes.vue', 'TypeScriptAttributes.vue'])
    for (const block of ['script', 'style']) {
      const pattern = new RegExp('<' + block + '\\b[^>]*>[\\s\\S]*?<\\/' + block + '>')
      assert.equal(
        editorOutputs[file].editor.match(pattern)?.[0],
        editorOutputs[file].plain.match(pattern)?.[0]
      )
    }
  run(consumer, 'npm', ['run', 'format:files', '--', ...Object.keys(attributeFixtures)])
  for (const file of Object.keys(attributeFixtures))
    assert.equal(await readFile(path.join(consumer, file), 'utf8'), editorOutputs[file].editor)
  assert.match(
    run(consumer, process.execPath, [cli, 'format', ...Object.keys(attributeFixtures)]),
    /0 changed; 0 error\(s\)/
  )
  run(consumer, process.execPath, [cli, 'check', ...Object.keys(attributeFixtures)])
  for (const [index, file] of configFiles.entries())
    assert.equal(await readFile(path.join(consumer, file), 'utf8'), configSnapshots[index])
  run(consumer, process.execPath, [cli, 'format', '--all'])
  run(consumer, process.execPath, [cli, 'check', '--all'])
  run(consumer, process.execPath, [cli, 'doctor'])
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
    'Packed consumer passed: nested dependencies, managed instructions, init, CLI/editor JS/TS attribute ordering, cursor mapping, unchanged configs/scripts/styles, idempotency, and ESLint editor runtime.'
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
