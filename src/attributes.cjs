const vueParser = require('vue-eslint-parser')

const harmlessParserErrors = new Set([
  'non-void-html-element-start-tag-with-trailing-solidus',
  'duplicate-attribute',
])

const rawElements = new Set(['script', 'style'])

const camelize = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
const collisionKey = (name) => name.replace(/[-_:]/g, '').toLowerCase()

// Property reads are assumed side-effect-free. Calls, mutations, spreads, and
// coercion-heavy/unsupported syntax remain ordering boundaries, not guesses.
const readable = (node) => {
  if (!node) return false
  switch (node.type) {
    case 'Identifier':
    case 'Literal':
    case 'ThisExpression':
      return true
    case 'ChainExpression':
    case 'TSAsExpression':
    case 'TSNonNullExpression':
    case 'TSSatisfiesExpression':
      return readable(node.expression)
    case 'MemberExpression':
      return (
        readable(node.object) &&
        (!node.computed ||
          (node.property.type === 'Literal' &&
            (node.property.value === null || typeof node.property.value !== 'object')))
      )
    case 'UnaryExpression':
      return ['!', 'typeof', 'void'].includes(node.operator) && readable(node.argument)
    case 'BinaryExpression':
      return ['===', '!=='].includes(node.operator) && readable(node.left) && readable(node.right)
    case 'LogicalExpression':
      return readable(node.left) && readable(node.right)
    case 'ConditionalExpression':
      return readable(node.test) && readable(node.consequent) && readable(node.alternate)
    case 'ArrayExpression':
      return node.elements.every((element) => element === null || readable(element))
    case 'ObjectExpression':
      return node.properties.every(
        (property) =>
          property.type === 'Property' &&
          property.kind === 'init' &&
          !property.method &&
          !property.computed &&
          readable(property.value)
      )
    case 'TemplateLiteral':
      return node.expressions.length === 0
    default:
      return false
  }
}

const describe = (attribute, source, offset) => {
  const start = attribute.range[0] - offset
  const end = attribute.range[1] - offset
  const text = source.slice(start, end)
  const descriptor = {
    start,
    end,
    text,
    length: text
      .split(/\r?\n/)
      .map((line) => line.trimStart())
      .join('\n').length,
    keys: [],
    priority: false,
    barrier: false,
    runtime: false,
  }
  const key = attribute.key
  if (!attribute.directive) {
    const name = key.rawName ?? key.name
    // Unknown template-language punctuation is not an ordinary HTML attribute.
    descriptor.barrier = !/^[A-Za-z_][\w:.-]*$/.test(name) || name === '__proto__'
    descriptor.keys = [collisionKey(name)]
    if (name.toLowerCase() === 'ref') descriptor.keys.push('reffor', 'refkey')
    return descriptor
  }
  const name = key.name.name
  const argument = key.argument
  const modifiers = key.modifiers.map((modifier) => modifier.name)
  const expression = attribute.value?.expression
  const value = attribute.value
    ? source.slice(attribute.value.range[0] - offset, attribute.value.range[1] - offset)
    : ''
  const hasComments = /\/\*|(^|\s)\/\//.test(value)
  const dynamic = argument && argument.type !== 'VIdentifier'
  const readableValue = expression && readable(expression) && !hasComments
  if (name === 'if' || name === 'for') {
    descriptor.priority = true
    descriptor.keys = [`directive:${name}`]
    descriptor.barrier =
      Boolean(argument) ||
      modifiers.length > 0 ||
      hasComments ||
      (name === 'for'
        ? expression?.type !== 'VForExpression' || !readable(expression.right)
        : !readableValue)
    return descriptor
  }
  if (name === 'bind') {
    descriptor.barrier =
      !argument ||
      dynamic ||
      !readableValue ||
      modifiers.some((modifier) => !['camel', 'prop', 'attr'].includes(modifier))
    if (!dynamic && argument) descriptor.keys = [collisionKey(argument.rawName ?? argument.name)]
    if (descriptor.keys.includes('ref')) descriptor.keys.push('reffor', 'refkey')
    return descriptor
  }
  if (name === 'on') {
    descriptor.barrier = !argument || dynamic || hasComments || !expression
    if (!dynamic && argument) {
      const event = argument.rawName ?? argument.name
      descriptor.keys = [collisionKey(`on${camelize(event)}`)]
      // Vue remaps mouse modifiers; both spellings can collide with explicit listeners.
      if (event.toLowerCase() === 'click' && modifiers.includes('right'))
        descriptor.keys.push('oncontextmenu')
      if (event.toLowerCase() === 'click' && modifiers.includes('middle'))
        descriptor.keys.push('onmouseup')
      if (event.startsWith('vue:'))
        descriptor.keys.push(collisionKey(`on${camelize(event.replace(/^vue:/, 'vnode-'))}`))
      const suffix = modifiers
        .filter((modifier) => ['once', 'capture', 'passive'].includes(modifier))
        .map((modifier) => modifier[0].toUpperCase() + modifier.slice(1))
        .join('')
      if (suffix) descriptor.keys.push(...descriptor.keys.map((key) => collisionKey(key + suffix)))
      if (modifiers.includes('native')) descriptor.barrier = true
    }
    // Inline event calls/statements are deferred by Vue, unlike bound prop calls.
    if (
      expression &&
      !['VOnExpression', 'ArrowFunctionExpression', 'FunctionExpression'].includes(
        expression.type
      ) &&
      !readable(expression)
    )
      descriptor.barrier = true
    return descriptor
  }
  if (name === 'model') {
    descriptor.runtime = true
    descriptor.barrier =
      dynamic ||
      !readableValue ||
      modifiers.some((modifier) => !['lazy', 'number', 'trim'].includes(modifier))
    const prop = argument?.rawName ?? argument?.name ?? 'modelValue'
    descriptor.keys = [
      collisionKey(prop),
      collisionKey(`onUpdate:${prop}`),
      collisionKey(argument ? `${camelize(prop)}Modifiers` : 'modelModifiers'),
    ]
    return descriptor
  }
  if (name === 'show') {
    descriptor.runtime = true
    descriptor.keys = ['directive:show']
    descriptor.barrier = Boolean(argument) || modifiers.length > 0 || !readableValue
    return descriptor
  }
  // Slots, custom directives, v-pre/once/memo/html/text, and unknown forms are
  // pinned. Their evaluation/compilation contracts are not inferred here.
  descriptor.runtime = true
  descriptor.barrier = true
  descriptor.keys = [`directive:${name}`]
  return descriptor
}

const ignoredElement = (element, source, offset) => {
  const siblings = element.parent?.children ?? []
  for (let index = siblings.indexOf(element) - 1; index >= 0; index--) {
    const sibling = siblings[index]
    if (sibling.type === 'VText' && !sibling.value.trim()) continue
    if (sibling.type === 'VHTMLComment') {
      return /prettier-ignore(?:-attribute)?\b/.test(sibling.value)
    }
    break
  }
  // Parser versions differ in how preceding HTML comments enter children.
  const before = source.slice(0, element.range[0] - offset).trimEnd()
  if (!before.endsWith('-->')) return false
  const start = before.lastIndexOf('<!--')
  return start >= 0 && /prettier-ignore(?:-attribute)?\b/.test(before.slice(start + 4, -3))
}

const sortAttributes = (source, { parser, cursorOffset } = {}) => {
  const unchanged = () => ({ formatted: source, cursorOffset })
  if (!['vue', 'html'].includes(parser)) return unchanged()
  const prefix = parser === 'html' ? '<template>\n' : ''
  const document = prefix ? `${prefix}${source}\n</template>` : source
  let root
  try {
    root = vueParser
      .parseForESLint(document, {
        filePath: 'attributes.vue',
        parser: false,
        ecmaVersion: 'latest',
        vueFeatures: { styleCSSVariableInjection: false },
      })
      .services.getDocumentFragment()
    if (parser === 'vue' && root) {
      const scripts = root.children.filter(
        (element) => element.type === 'VElement' && element.name === 'script'
      )
      const typed = scripts.some((element) =>
        element.startTag.attributes.some(
          (attribute) =>
            !attribute.directive &&
            attribute.key.name === 'lang' &&
            ['ts', 'tsx'].includes(attribute.value?.value)
        )
      )
      if (typed) {
        // Keep structural errors from the discovery pass. Expression errors are
        // validated again below with the template's TypeScript-capable parser.
        if (root.errors?.some((error) => error.code && !harmlessParserErrors.has(error.code)))
          return unchanged()
        let templateDocument = document
        for (const script of scripts) {
          const [start, end] = script.range
          // Mask complete script elements (including generic setup attributes),
          // preserving UTF-16 offsets/newlines without parsing script content.
          templateDocument =
            templateDocument.slice(0, start) +
            templateDocument.slice(start, end).replace(/[^\r\n]/g, ' ') +
            templateDocument.slice(end)
        }
        root = vueParser
          .parseForESLint(templateDocument, {
            filePath: 'attributes.vue',
            parser: { '<template>': require('@typescript-eslint/parser') },
            ecmaVersion: 'latest',
            // Vue 3 TypeScript unions use | as type syntax, not Vue 2 filters.
            vueFeatures: { styleCSSVariableInjection: false, filter: false },
          })
          .services.getDocumentFragment()
      }
    }
  } catch {
    return unchanged()
  }
  if (
    !root ||
    root.errors?.some(
      (error) =>
        !harmlessParserErrors.has(error.code) &&
        !(
          parser === 'html' &&
          error.code === 'incorrectly-opened-comment' &&
          /^<!doctype\s/i.test(document.slice(error.index - 2))
        )
    )
  )
    return unchanged()
  const offset = prefix.length
  const edits = []
  const visit = (element) => {
    if (element.type !== 'VElement') return
    if (rawElements.has(element.name) || ignoredElement(element, source, offset)) return
    if (
      element.startTag.attributes.some(
        (attribute) => attribute.directive && attribute.key.name.name === 'pre'
      )
    )
      return
    const attributes = element.startTag.attributes
    if (attributes.length > 1) {
      const descriptors = attributes.map((attribute) => describe(attribute, source, offset))
      const keys = new Map()
      for (const item of descriptors) {
        for (const key of item.keys) {
          if (!keys.has(key)) keys.set(key, [])
          keys.get(key).push(item)
        }
      }
      for (const matching of keys.values()) {
        if (matching.length > 1) for (const item of matching) item.barrier = true
      }
      if (descriptors.filter((item) => item.runtime).length > 1) {
        for (const item of descriptors) if (item.runtime) item.barrier = true
      }
      const groups = []
      let group = []
      for (const item of descriptors) {
        const previous = group.at(-1)
        const gap = previous ? source.slice(previous.end, item.start) : ''
        // Sort only genuine multiline attribute lists, preserving all original
        // whitespace slots. Comments or same-line formatting form boundaries.
        if (item.barrier || (previous && !/^\s*\n\s*$/.test(gap))) {
          if (group.length > 1) groups.push(group)
          group = []
        }
        if (!item.barrier) group.push(item)
      }
      if (group.length > 1) groups.push(group)
      for (const original of groups) {
        const sorted = [...original].sort(
          (left, right) =>
            Number(right.priority) - Number(left.priority) ||
            (left.priority ? 0 : left.length - right.length)
        )
        if (sorted.every((item, index) => item === original[index])) continue
        let replacement = ''
        const mappings = []
        for (let index = 0; index < sorted.length; index++) {
          if (index) replacement += source.slice(original[index - 1].end, original[index].start)
          const item = sorted[index]
          mappings.push({
            start: item.start,
            end: item.end,
            target: original[0].start + replacement.length,
          })
          replacement += item.text
        }
        const start = original[0].start
        const end = original.at(-1).end
        // A permutation must never add/remove bytes beyond the attribute order.
        if (replacement.length === end - start) edits.push({ start, end, replacement, mappings })
      }
    }
    if (!['pre', 'textarea'].includes(element.name))
      for (const child of element.children) visit(child)
  }
  for (const template of root.children ?? []) {
    if (template.type !== 'VElement' || template.name !== 'template') continue
    if (
      template.startTag.attributes.some(
        (attribute) =>
          !attribute.directive && attribute.key.name === 'lang' && attribute.value?.value !== 'html'
      )
    )
      continue
    for (const child of template.children) visit(child)
  }
  let formatted = source
  let mappedCursor = cursorOffset
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    formatted = formatted.slice(0, edit.start) + edit.replacement + formatted.slice(edit.end)
    if (Number.isInteger(cursorOffset) && cursorOffset >= edit.start && cursorOffset <= edit.end) {
      const attribute = edit.mappings.find(
        (item) => cursorOffset >= item.start && cursorOffset <= item.end
      )
      if (attribute) mappedCursor = attribute.target + cursorOffset - attribute.start
      else {
        // A whitespace cursor belongs to the next attribute's original slot.
        // Keep it in whitespace when that attribute moves rather than leaving
        // it at an absolute offset that could now land inside another value.
        const next = edit.mappings
          .filter((item) => item.start > cursorOffset)
          .sort((left, right) => left.start - right.start)[0]
        if (next)
          mappedCursor = Math.max(
            0,
            next.target -
              Math.min(
                next.start - cursorOffset,
                formatted.slice(0, next.target).match(/\s*$/)[0].length
              )
          )
      }
    }
  }
  return { formatted, cursorOffset: mappedCursor }
}

module.exports = { sortAttributes }
