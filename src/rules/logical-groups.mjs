const macros = new Set([
  'defineProps',
  'defineEmits',
  'defineModel',
  'defineOptions',
  'defineSlots',
  'defineExpose',
])

const effects = new Set([
  'watch',
  'watchEffect',
  'watchPostEffect',
  'watchSyncEffect',
  'onMounted',
  'onBeforeMount',
  'onUpdated',
  'onBeforeUpdate',
  'onUnmounted',
  'onBeforeUnmount',
  'onActivated',
  'onDeactivated',
  'onErrorCaptured',
  'onRenderTracked',
  'onRenderTriggered',
  'onServerPrefetch',
  'onScopeDispose',
  'onWatcherCleanup',
])

const unwrap = (expression) => {
  let node = expression
  while (
    node &&
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'AwaitExpression',
      'ChainExpression',
    ].includes(node.type)
  ) {
    node = node.expression ?? node.argument
  }
  return node
}

export default {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    schema: [],
    docs: {
      description:
        'Separate logical groups, callback declarations, and multiline declarations without reordering code.',
    },
    messages: { separate: 'Add a blank line between {{previous}} and {{current}}.' },
  },
  create(context) {
    const source = context.sourceCode

    return {
      Program(program) {
        const vueScript = Boolean(source.parserServices?.getDocumentFragment)
        const imported = new Map()
        const namespaces = new Set()
        for (const statement of program.body) {
          if (statement.type !== 'ImportDeclaration' || statement.source.value !== 'vue') continue
          for (const specifier of statement.specifiers) {
            if (specifier.type === 'ImportSpecifier') {
              imported.set(
                specifier.local.name,
                specifier.imported.name ?? specifier.imported.value
              )
            } else if (specifier.type === 'ImportNamespaceSpecifier') {
              namespaces.add(specifier.local.name)
            }
          }
        }

        // Resolve real imported bindings; a local function called computed/onMounted is not a Vue API.
        const vueCall = (call) => {
          const callee = call.callee
          if (callee.type === 'Identifier') {
            let scope = source.getScope(call)
            while (scope) {
              const variable = scope.set.get(callee.name)
              if (variable) {
                return variable.defs.some((definition) => definition.type === 'ImportBinding')
                  ? imported.get(callee.name)
                  : undefined
              }
              scope = scope.upper
            }
          }
          if (
            callee.type === 'MemberExpression' &&
            !callee.computed &&
            callee.object.type === 'Identifier' &&
            namespaces.has(callee.object.name)
          )
            return callee.property.name
        }

        const expressionGroup = (expression) => {
          const node = unwrap(expression)
          if (node?.type === 'CallExpression') {
            const name = node.callee.type === 'Identifier' ? node.callee.name : undefined
            if (vueScript && name === 'withDefaults') return expressionGroup(node.arguments[0])
            if (vueScript && macros.has(name)) return 'props/emits'
            const api = vueCall(node)
            if (api === 'computed') return 'derived state'
            if (effects.has(api)) return 'effects/lifecycle'
          }
          if (['ArrowFunctionExpression', 'FunctionExpression'].includes(node?.type))
            return 'methods'
          return 'state/composables'
        }

        const group = (statement) => {
          const node = statement.declaration ?? statement
          if (['ImportDeclaration', 'TSImportEqualsDeclaration'].includes(node.type))
            return 'imports'
          if (
            ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration'].includes(
              node.type
            )
          )
            return 'types'
          if (['FunctionDeclaration', 'TSDeclareFunction', 'ClassDeclaration'].includes(node.type))
            return 'methods'
          if (node.type === 'VariableDeclaration') {
            const groups = node.declarations.map((declaration) => expressionGroup(declaration.init))
            return groups.every((value) => value === groups[0]) ? groups[0] : 'state/composables'
          }
          if (node.type === 'ExpressionStatement') return expressionGroup(node.expression)
          return 'statements'
        }

        const hasCallback = (node) => {
          if (!node) return false
          if (['ArrowFunctionExpression', 'FunctionExpression'].includes(node.type)) return true
          return (source.visitorKeys[node.type] ?? []).some((key) => {
            const child = node[key]
            return Array.isArray(child) ? child.some(hasCallback) : hasCallback(child)
          })
        }

        const standalone = (statement) => {
          const node = statement.declaration ?? statement
          if (node.type === 'FunctionDeclaration') return Boolean(node.body)
          if (node.type === 'VariableDeclaration') {
            return (
              node.loc.start.line !== node.loc.end.line ||
              node.declarations.some((declaration) => hasCallback(declaration.init))
            )
          }
          if (node.type === 'ExpressionStatement') {
            return node.loc.start.line !== node.loc.end.line || hasCallback(node.expression)
          }
          return false
        }

        for (let index = 1; index < program.body.length; index++) {
          const previous = program.body[index - 1]
          const current = program.body[index]
          const previousGroup = group(previous)
          const currentGroup = group(current)
          const previousNode = previous.declaration ?? previous
          const currentNode = current.declaration ?? current
          // Overload signatures belong immediately beside their implementation.
          if (
            previousNode.type === 'TSDeclareFunction' &&
            ['TSDeclareFunction', 'FunctionDeclaration'].includes(currentNode.type) &&
            previousNode.id?.name === currentNode.id?.name
          )
            continue
          if (previousGroup === currentGroup && !standalone(previous) && !standalone(current))
            continue

          // Walk every comment so leading comments stay attached and trailing comments stay in place.
          const comments = source
            .getCommentsBefore(current)
            .filter((comment) => comment.range[0] >= previous.range[1])
          const trailing = comments.filter(
            (comment) => comment.loc.start.line === previous.loc.end.line
          )
          const leading = comments.find((comment) => comment.loc.start.line > previous.loc.end.line)
          const start = trailing.at(-1) ?? previous
          const end = leading ?? current
          const range = [start.range[1], end.range[0]]
          const gap = source.text.slice(...range)
          // Never cross HTML boundaries between two <script> blocks or modify comment contents.
          if (!/^\s*$/.test(gap) || (gap.match(/\n/g) ?? []).length >= 2) continue

          context.report({
            node: current,
            messageId: 'separate',
            data: { previous: previousGroup, current: currentGroup },
            fix: (fixer) => {
              const eol = source.text.includes('\r\n') ? '\r\n' : '\n'
              return fixer.replaceTextRange(range, `${eol}${eol}${gap.match(/[\t ]*$/)[0]}`)
            },
          })
        }
      },
    }
  },
}
