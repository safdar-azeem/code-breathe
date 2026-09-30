#!/usr/bin/env node
import { initialize } from '../src/init.mjs'
import { runFormatting } from '../src/format.mjs'
import { doctor } from '../src/doctor.mjs'

const help = `code-breathe 0.0.5

  code-breathe init [--dry-run] [--no-editor] [--no-agents]
  code-breathe format <files/globs...>
  code-breathe format --all
  code-breathe check [<files/globs...> | --changed | --all | --base <ref>]
  code-breathe doctor

Formatting requires explicit paths or --all. Checks default to local Git changes.
Install the recommended Prettier and ESLint extensions for formatting on save.
`

const main = async () => {
  const args = process.argv.slice(2)
  if (!args.length || args.includes('--help') || args[0] === 'help') {
    console.log(help)
    return 0
  }
  if (args[0] === '--version') {
    console.log('0.0.5')
    return 0
  }
  const action = args.shift()
  const patterns = []
  const options = {}
  let literal = false
  for (let index = 0; index < args.length; index++) {
    const value = args[index]
    if (literal) {
      patterns.push(value)
      continue
    }
    if (value === '--') {
      literal = true
      continue
    }
    if (value === '--all') options.all = true
    else if (value === '--changed') options.changed = true
    else if (value === '--dry-run') options.dryRun = true
    else if (value === '--no-editor') options.editor = false
    else if (value === '--no-agents') options.agents = false
    else if (value === '--base') {
      const base = args[++index]
      if (!base || base.startsWith('-')) throw new Error('--base requires a Git reference.')
      options.base = base
    } else if (value.startsWith('-')) throw new Error(`Unknown option: ${value}`)
    else patterns.push(value)
  }
  if (action === 'init') {
    if (patterns.length || options.all || options.changed || options.base)
      throw new Error('Invalid init arguments. See --help.')
    await initialize(options)
    return 0
  }
  if (action === 'doctor') {
    if (args.length) throw new Error('doctor does not accept arguments.')
    return doctor()
  }
  if (!['format', 'check'].includes(action)) throw new Error(`Unknown command: ${action}`)
  if (options.dryRun || options.editor !== undefined || options.agents !== undefined)
    throw new Error('Setup options apply only to init.')
  const selections =
    Number(Boolean(options.all)) +
    Number(Boolean(options.changed)) +
    Number(Boolean(options.base)) +
    Number(patterns.length > 0)
  if (selections > 1)
    throw new Error('Choose one file selection: paths, --all, --changed, or --base.')
  if (action === 'format' && !selections)
    throw new Error('Formatting requires explicit files or --all.')
  if (action === 'check' && !selections) options.changed = true
  const result = await runFormatting({ ...options, patterns, write: action === 'format' })
  return result.exitCode
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`code-breathe: ${error.message}`)
  process.exitCode = 1
}
