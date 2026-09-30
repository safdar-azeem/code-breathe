import { execFileSync } from 'node:child_process'
import { lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import fg from 'fast-glob'
import ignore from 'ignore'
import * as prettier from 'prettier'
import { defaultIgnores } from './eslint.mjs'

export const readOptional = async (file) => {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

export const gitFiles = (cwd, base) => {
  const git = (args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const gitRoot = git(['rev-parse', '--show-toplevel']).trim()
    const localRoot = path.resolve(cwd)
    const relative = (file) =>
      path.relative(localRoot, path.join(gitRoot, file)).split(path.sep).join('/')
    let reference = 'HEAD'
    if (base) {
      if (base.startsWith('-')) throw new Error('Invalid base reference.')
      reference = git(['merge-base', 'HEAD', base]).trim()
    } else {
      try {
        git(['rev-parse', '--verify', 'HEAD'])
      } catch {
        reference = undefined
      }
    }
    const changed = reference
      ? git(['diff', '--name-only', '--diff-filter=ACMR', '-z', reference, '--'])
      : git(['ls-files', '--full-name', '--cached', '-z'])
    const untracked = git(['ls-files', '--full-name', '--others', '--exclude-standard', '-z'])
    return [
      ...new Set([...changed.split('\0'), ...untracked.split('\0')].filter(Boolean).map(relative)),
    ].filter((file) => file && !file.startsWith('../') && !path.isAbsolute(file))
  } catch (error) {
    throw new Error(
      `Unable to select Git changes. Use explicit files or --all. ${error.stderr?.toString().trim() ?? error.message}`
    )
  }
}

export const collectFiles = async ({ cwd, patterns = [], all = false, changed = false, base }) => {
  cwd = await realpath(cwd)
  const selected = changed || base ? gitFiles(cwd, base) : all ? ['**/*'] : patterns
  const matches = []
  for (const pattern of selected) {
    const absolute = path.resolve(cwd, pattern)
    const relative = path.relative(cwd, absolute)
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`File selection must stay inside the project: ${pattern}`)
    }
    let stat
    try {
      stat = await lstat(absolute)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (stat?.isSymbolicLink()) continue
    if (stat?.isFile()) matches.push(relative.split(path.sep).join('/'))
    else
      matches.push(
        ...(await fg(stat?.isDirectory() ? `${relative || '.'}/**/*` : pattern, {
          cwd,
          dot: true,
          onlyFiles: true,
          followSymbolicLinks: false,
          ignore: defaultIgnores,
        }))
      )
  }

  const ignored = ignore()
    .add(defaultIgnores)
    .add([
      '**/*.tgz',
      '**/*.lock',
      '**/package-lock.json',
      '**/pnpm-lock.yaml',
      '**/.env',
      '**/.env.*',
    ])
  for (const name of ['.gitignore', '.prettierignore']) {
    const content = await readOptional(path.join(cwd, name))
    if (content) ignored.add(content)
  }
  const files = []
  for (const file of [...new Set(matches.map((file) => file.replace(/^\.\//, '')))].sort()) {
    if (ignored.ignores(file)) continue
    const absolute = path.join(cwd, file)
    const actual = await realpath(absolute)
    const relative = path.relative(cwd, actual)
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue
    const info = await prettier.getFileInfo(absolute)
    if (info.inferredParser) files.push(file)
  }
  return files
}
