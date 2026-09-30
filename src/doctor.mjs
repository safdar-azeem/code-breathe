import path from 'node:path'
import { createRequire } from 'node:module'
import { initialize } from './init.mjs'

export const doctor = async ({ cwd = process.cwd(), log = console.log } = {}) => {
  const require = createRequire(path.resolve(cwd, 'package.json'))
  let failures = 0
  for (const specifier of [
    'code-breathe/package.json',
    'code-breathe/prettier',
    'code-breathe/eslint',
  ]) {
    try {
      log(`OK: ${specifier}: ${require.resolve(specifier)}`)
    } catch {
      failures++
      log(`Missing: ${specifier}`)
    }
  }
  try {
    const result = await initialize({ cwd, dryRun: true, log })
    if (result.changed.length) {
      failures++
      log('Setup is incomplete. Run code-breathe init and review the reported changes.')
    }
  } catch (error) {
    failures++
    log(error.message)
  }
  log(
    'Editor extension installation and workspace trust must be checked in your editor; CLI diagnostics cannot verify them.'
  )
  return failures ? 1 : 0
}
