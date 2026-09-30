import { lstat, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { applyEdits, modify, parse } from 'jsonc-parser'
import { readOptional } from './files.mjs'

const start = '<!-- code-breathe:start -->'
const end = '<!-- code-breathe:end -->'
const marker = '// Managed by code-breathe.'

const packageManager = (pkg, cwdFiles) =>
  pkg.packageManager?.split('@')[0] ??
  (cwdFiles.has('pnpm-lock.yaml') ? 'pnpm' : cwdFiles.has('yarn.lock') ? 'yarn' : 'npm')

const command = (manager, script) =>
  manager === 'npm' ? `npm run ${script} --` : `${manager} ${script}`

const json = (content, name) => {
  const errors = []
  const value = parse(content, errors, { allowTrailingComma: true })
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Cannot safely merge ${name}: expected a valid JSON/JSONC object.`)
  }
  return value
}

const edit = (content, keys, value) => {
  const current = keys.reduce((object, key) => object?.[key], parse(content))
  if (JSON.stringify(current) === JSON.stringify(value)) return content
  return applyEdits(
    content,
    modify(content, keys, value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
    })
  )
}

const managedBlock = (content, block, name) => {
  const original = content ?? ''
  const first = original.indexOf(start)
  const last = original.indexOf(end)
  if (first >= 0 !== last >= 0 || (first >= 0 && last < first)) {
    throw new Error(`Incomplete code-breathe block in ${name}; repair it before initializing.`)
  }
  if (first >= 0) {
    const current = original.slice(first, last + end.length)
    if (current.replace(/\s+/g, ' ') === block.replace(/\s+/g, ' ')) return original
    return original.slice(0, first) + block + original.slice(last + end.length)
  }
  return `${original.trimEnd()}${original.trim() ? '\n\n' : ''}${block}\n`
}

export const initialize = async ({
  cwd = process.cwd(),
  dryRun = false,
  editor = true,
  agents = true,
  log = console.log,
} = {}) => {
  cwd = path.resolve(cwd)
  const packageFile = path.join(cwd, 'package.json')
  const packageText = await readOptional(packageFile)
  if (!packageText) throw new Error('Run init in a project directory containing package.json.')
  const pkg = json(packageText, 'package.json')
  const require = createRequire(packageFile)
  try {
    require.resolve('code-breathe/package.json')
  } catch {
    throw new Error('Install code-breathe as a development dependency before running init.')
  }
  const files = new Set()
  for (const name of ['yarn.lock', 'pnpm-lock.yaml']) {
    if ((await readOptional(path.join(cwd, name))) !== undefined) files.add(name)
  }
  const manager = packageManager(pkg, files)
  if (!['npm', 'yarn', 'pnpm', 'bun'].includes(manager))
    throw new Error(`Unsupported package manager: ${manager}`)

  // Build every proposed change before writing, so configuration conflicts do not leave a half-initialized project.
  const plan = new Map()
  const notes = []
  const propose = async (name, next) => {
    // Do not overwrite shared configuration through file or directory symlinks.
    let target = path.join(cwd, name)
    while (target !== cwd) {
      try {
        if ((await lstat(target)).isSymbolicLink())
          throw new Error(
            `Cannot safely update symlinked configuration: ${name}. No files were changed.`
          )
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      target = path.dirname(target)
    }
    const original = await readOptional(path.join(cwd, name))
    if (next !== original) plan.set(name, next)
  }

  for (const name of [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    'eslint.config.mts',
    'eslint.config.cts',
    '.eslintrc',
    '.eslintrc.json',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.yml',
    '.eslintrc.yaml',
  ]) {
    const content = await readOptional(path.join(cwd, name))
    if (content !== undefined && !(name === 'eslint.config.mjs' && content.startsWith(marker))) {
      throw new Error(
        `Existing ${name} detected. Preserve your rules and merge the code-breathe/eslint preset manually; see README's existing-configuration instructions. No files were changed.`
      )
    }
  }
  if (pkg.eslintConfig)
    throw new Error(
      'Existing package.json eslintConfig detected; migrate it to a flat configuration first. No files were changed.'
    )

  // Keep project-specific additions to a managed preset wrapper on later init runs.
  if ((await readOptional(path.join(cwd, 'eslint.config.mjs'))) === undefined) {
    await propose(
      'eslint.config.mjs',
      `${marker}\nimport config from 'code-breathe/eslint'\n\nexport default config\n`
    )
  }
  let nextPackage = packageText
  if (
    pkg.scripts !== undefined &&
    (!pkg.scripts || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts))
  ) {
    throw new Error('package.json scripts must be an object.')
  }
  const scripts = {
    format: 'code-breathe format --all',
    'format:files': 'code-breathe format',
    'format:check': 'code-breathe check --changed',
  }
  for (const [name, value] of Object.entries(scripts)) {
    if (pkg.scripts?.[name] && pkg.scripts[name] !== value) {
      throw new Error(
        `Existing script ${name} conflicts with code-breathe. Rename it or set it to ${JSON.stringify(value)} before init. No files were changed.`
      )
    }
    nextPackage = edit(nextPackage, ['scripts', name], value)
  }
  await propose('package.json', nextPackage)

  const prettierNames = [
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.yml',
    '.prettierrc.yaml',
    '.prettierrc.toml',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.mjs',
    '.prettierrc.ts',
    '.prettierrc.mts',
    '.prettierrc.cts',
    'prettier.config.js',
    'prettier.config.cjs',
    'prettier.config.mjs',
    'prettier.config.ts',
    'prettier.config.mts',
    'prettier.config.cts',
  ]
  let hasPrettier = pkg.prettier !== undefined
  for (const name of prettierNames)
    hasPrettier ||= (await readOptional(path.join(cwd, name))) !== undefined
  if (!hasPrettier) await propose('.prettierrc.json', '"code-breathe/prettier"\n')
  else notes.push('Preserved existing Prettier preferences.')

  if ((await readOptional(path.join(cwd, '.prettierignore'))) === undefined) {
    await propose(
      '.prettierignore',
      'node_modules/\ndist/\ndist-ssr/\nbuild/\ncoverage/\n.next/\n.nuxt/\n.output/\n*.generated.*\n.env\n.env.*\n'
    )
  }
  if ((await readOptional(path.join(cwd, '.editorconfig'))) === undefined) {
    // Indentation belongs to Prettier so an existing three-space preference remains authoritative.
    await propose(
      '.editorconfig',
      'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\n'
    )
  }

  if (editor) {
    const settingsName = '.vscode/settings.json'
    let settings = (await readOptional(path.join(cwd, settingsName))) ?? '{}\n'
    const existing = json(settings, settingsName)
    const required = {
      'editor.formatOnSave': true,
      'editor.defaultFormatter': 'esbenp.prettier-vscode',
      'prettier.requireConfig': true,
      'prettier.prettierPath': './node_modules/code-breathe/editor/prettier.cjs',
      'prettier.ignorePath': '.prettierignore',
      'eslint.nodePath': './node_modules/code-breathe/editor',
      'eslint.validate': ['vue', 'javascript', 'javascriptreact', 'typescript', 'typescriptreact'],
    }
    for (const [key, value] of Object.entries(required)) {
      const next =
        key === 'eslint.validate' && Array.isArray(existing[key])
          ? [...new Set([...existing[key], ...value])]
          : value
      settings = edit(settings, [key], next)
    }
    settings = edit(settings, ['editor.codeActionsOnSave', 'source.fixAll.eslint'], 'always')
    for (const language of [
      'vue',
      'javascript',
      'javascriptreact',
      'typescript',
      'typescriptreact',
    ]) {
      settings = edit(
        settings,
        [`[${language}]`, 'editor.defaultFormatter'],
        'esbenp.prettier-vscode'
      )
      settings = edit(settings, [`[${language}]`, 'editor.formatOnSave'], true)
      settings = edit(
        settings,
        [`[${language}]`, 'editor.codeActionsOnSave', 'source.fixAll.eslint'],
        'always'
      )
      if (existing[`[${language}]`]?.['editor.codeActionsOnSave']?.['source.fix'] === 'never') {
        settings = edit(
          settings,
          [`[${language}]`, 'editor.codeActionsOnSave', 'source.fix'],
          undefined
        )
      }
    }
    await propose(settingsName, settings.endsWith('\n') ? settings : settings + '\n')

    const extensionName = '.vscode/extensions.json'
    let extensions = (await readOptional(path.join(cwd, extensionName))) ?? '{}\n'
    const current = json(extensions, extensionName)
    if (current.recommendations !== undefined && !Array.isArray(current.recommendations))
      throw new Error(`${extensionName}: recommendations must be an array.`)
    const recommendations = [
      ...new Set([
        ...(current.recommendations ?? []),
        'esbenp.prettier-vscode',
        'dbaeumer.vscode-eslint',
      ]),
    ]
    extensions = edit(extensions, ['recommendations'], recommendations)
    await propose(extensionName, extensions.endsWith('\n') ? extensions : extensions + '\n')

    const gitignore = (await readOptional(path.join(cwd, '.gitignore'))) ?? ''
    const block =
      '# code-breathe editor configuration\n!.vscode/\n.vscode/*\n!.vscode/settings.json\n!.vscode/extensions.json'
    if (!gitignore.includes(block))
      await propose('.gitignore', `${gitignore.trimEnd()}\n\n${block}\n`)
  }

  if (agents) {
    const invocation = command(manager, 'format:files')
    const instructions = `${start}\n## Formatting with code-breathe\n\n- After changing files, run \`${invocation} <files...>\` with only the files you changed.\n- Keep unrelated dirty files untouched; reserve full-project formatting for an explicit request.\n- Keep imports, types, props/emits, state/composables, computed values, methods, and lifecycle/effects separated by a blank line. The formatter inserts missing boundaries.\n- Separate each top-level arrow/function callback declaration and multiline declaration with a blank line. Keep simple one-line composable calls together; do not add blank lines inside inline callbacks or split function overload signatures.\n- Formatting remains separate from the dev server.\n- Run \`${command(manager, 'format:check').replace(/ --$/, '')}\` to check local changes; CI uses \`code-breathe check --all\` or \`--base <ref>\`.\n${end}`
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
      await propose(
        name,
        managedBlock(await readOptional(path.join(cwd, name)), instructions, name)
      )
    }
    const cursorName = '.cursor/rules/code-breathe.mdc'
    const oldCursor = await readOptional(path.join(cwd, cursorName))
    if (oldCursor && !oldCursor.includes(start))
      throw new Error(
        `Existing ${cursorName} is not managed by code-breathe. No files were changed.`
      )
    await propose(
      cursorName,
      `---\ndescription: Format changed files and preserve logical code grouping with code-breathe\nalwaysApply: true\n---\n\n${instructions}\n`
    )
  }

  for (const [name, content] of plan) {
    log(`${dryRun ? 'Would update' : 'Updated'}: ${name}`)
    if (!dryRun) {
      await mkdir(path.dirname(path.join(cwd, name)), { recursive: true })
      await writeFile(path.join(cwd, name), content)
    }
  }
  for (const note of notes) log(note)
  log(
    plan.size === 0
      ? 'Already initialized.'
      : dryRun
        ? 'Dry run complete; no files changed.'
        : 'Initialized code-breathe. Enable the recommended Prettier and ESLint editor extensions to format on save.'
  )
  return { changed: [...plan.keys()], notes }
}
