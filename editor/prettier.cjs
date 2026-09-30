// Stable path for editors even when npm/pnpm isolates this package's dependencies.
const prettier = require('prettier')
const { finishTemplateFormatting } = require('../src/template-format.cjs')

module.exports = {
  ...prettier,
  async format(source, options) {
    const formatted = await prettier.format(source, options)
    return (await finishTemplateFormatting(formatted, options, undefined, source.length)).formatted
  },
  async formatWithCursor(source, options) {
    const result = await prettier.formatWithCursor(source, options)
    return {
      ...result,
      ...(await finishTemplateFormatting(
        result.formatted,
        options,
        result.cursorOffset,
        source.length
      )),
    }
  },
  async check(source, options) {
    const formatted = await prettier.format(source, options)
    return (
      (await finishTemplateFormatting(formatted, options, undefined, source.length)).formatted ===
      source
    )
  },
}
