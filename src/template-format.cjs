const prettier = require('prettier')
const { sortAttributes } = require('./attributes.cjs')

const finishTemplateFormatting = async (
  formatted,
  options = {},
  cursorOffset,
  originalLength = formatted.length
) => {
  if (
    options.rangeStart > 0 ||
    (Number.isFinite(options.rangeEnd) && options.rangeEnd < originalLength)
  ) {
    return { formatted, cursorOffset }
  }
  let parser = options.parser
  if (!parser && options.filepath) {
    parser = (
      await prettier.getFileInfo(options.filepath, {
        resolveConfig: false,
        plugins: options.plugins,
      })
    ).inferredParser
  }
  return sortAttributes(formatted, { parser, cursorOffset })
}

module.exports = { finishTemplateFormatting }
