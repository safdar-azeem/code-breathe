import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as prettier from 'prettier'
import { ESLint } from 'eslint'
import preset from './prettier.cjs'
import eslintConfig from './eslint.mjs'
import { collectFiles } from './files.mjs'

export const runFormatting = async ({
  cwd = process.cwd(),
  write = false,
  patterns = [],
  all = false,
  changed = false,
  base,
  log = console.log,
}) => {
  if (write && (changed || base))
    throw new Error('Formatting requires explicit paths or --all; Git discovery is check-only.')
  if (!all && !changed && !base && patterns.length === 0)
    throw new Error('Provide files, --all, or --changed.')
  const files = await collectFiles({ cwd, patterns, all, changed, base })
  // Only spacing rules run here; a project's unrelated lint fixes must not change program behavior.
  const eslint = new ESLint({
    cwd: path.resolve(cwd),
    overrideConfigFile: true,
    overrideConfig: eslintConfig,
    fix: true,
  })
  let differences = 0
  let errors = 0
  for (const file of files) {
    try {
      const absolute = path.resolve(cwd, file)
      const original = await readFile(absolute, 'utf8')
      const config = (await prettier.resolveConfig(absolute, { editorconfig: true })) ?? preset
      let formatted = await prettier.format(original, { ...config, filepath: absolute })
      if (/\.(?:[cm]?[jt]sx?|vue)$/.test(file)) {
        const [result] = await eslint.lintText(formatted, { filePath: absolute })
        if (result.errorCount)
          throw new Error(
            result.messages
              .map((message) => `${message.line}:${message.column} ${message.message}`)
              .join('\n')
          )
        formatted = await prettier.format(result.output ?? formatted, {
          ...config,
          filepath: absolute,
        })
      }
      if (original !== formatted) {
        differences++
        if (write) await writeFile(absolute, formatted)
        log(`${write ? 'Formatted' : 'Needs formatting'}: ${file}`)
      }
    } catch (error) {
      errors++
      log(`Error: ${file}: ${error.message}`)
    }
  }
  log(
    `${files.length} file(s) ${write ? 'formatted' : 'checked'}; ${differences} changed; ${errors} error(s).`
  )
  return {
    files: files.length,
    differences,
    errors,
    exitCode: errors || (!write && differences) ? 1 : 0,
  }
}
