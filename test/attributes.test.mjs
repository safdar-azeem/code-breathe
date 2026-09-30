import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { sortAttributes } = require('../src/attributes.cjs')
const editorPrettier = require('../editor/prettier.cjs')
const prettier = require('prettier')
const preset = require('../src/prettier.cjs')

const sort = async (text, options = {}) => {
  const result = await sortAttributes(text, { parser: 'vue', ...options })
  assert.equal(typeof result.formatted, 'string')
  return result.formatted
}

const ordered = (text, attributes) => {
  let previous = -1
  for (const attribute of attributes) {
    const position = text.indexOf(attribute)
    assert.ok(position >= 0, `Missing attribute: ${attribute}\n${text}`)
    assert.ok(position > previous, `Unexpected order for: ${attribute}\n${text}`)
    previous = position
  }
}

const tag = (name, attributes, { selfClosing = false } = {}) =>
  `<${name}\n${attributes.map((attribute) => `  ${attribute}`).join('\n')}\n${selfClosing ? '/>' : `></${name}>`}`

test('matches the complete WebsiteSectionHost shortest-rendered-attribute example', async () => {
  const input = `<template>
  <WebsiteSectionHost
    v-if="renderSection && id"
    :section="renderSection"
    :mode="website.mode.value"
    :state="runtime?.state"
    :save-state="runtime?.saveState"
    :error-message="runtime?.errorMessage"
    :page-info="runtime?.pageInfo"
    :pagination-state="runtime?.paginationState"
    :pagination-error-message="runtime?.paginationErrorMessage"
    :logo="website.logo.value"
    :pages="website.pages.value"
    :selected="selected"
    @select="select"
    @retry="retry"
    @load-more="loadMore"
    @navigate="website.navigate"
    @update="update"
    @contact="website.contact"
  />
</template>
`
  const expected = `<template>
  <WebsiteSectionHost
    v-if="renderSection && id"
    @retry="retry"
    @select="select"
    @update="update"
    :selected="selected"
    @load-more="loadMore"
    :state="runtime?.state"
    :section="renderSection"
    :mode="website.mode.value"
    :logo="website.logo.value"
    @contact="website.contact"
    :pages="website.pages.value"
    @navigate="website.navigate"
    :page-info="runtime?.pageInfo"
    :save-state="runtime?.saveState"
    :error-message="runtime?.errorMessage"
    :pagination-state="runtime?.paginationState"
    :pagination-error-message="runtime?.paginationErrorMessage"
  />
</template>
`
  assert.equal(await sort(input), expected)
  assert.equal(await sort(expected), expected)
})

test('native, PascalCase and kebab-case elements use identical sorting', async () => {
  const attributes = [
    'aria-label="Open account settings"',
    'class="profile-button"',
    '@click="open"',
    ':disabled="loading"',
    'id="profile"',
  ]
  const expected = [
    'id="profile"',
    '@click="open"',
    ':disabled="loading"',
    'class="profile-button"',
    'aria-label="Open account settings"',
  ]
  for (const name of ['button', 'MyComponent', 'my-component']) {
    for (const selfClosing of [false, true]) {
      const input = `<template>${tag(name, attributes, { selfClosing })}</template>`
      const output = await sort(input)
      ordered(output, expected)
      assert.equal(await sort(output), output)
      assert.ok(output.includes(selfClosing ? '/>' : `></${name}>`))
    }
  }
})

test('TypeScript template assertions participate in safe sorting without rewriting text', async () => {
  for (const expression of [
    'value as SomeType',
    'value!',
    'value satisfies SomeType',
    'value as SomeType | (() => void)',
  ]) {
    const binding = `:value="${expression}"`
    const label = 'aria-label="A considerably longer template assertion label"'
    const input = `<script setup lang="ts">\ntype SomeType = string | number\nconst value: SomeType = 1\n</script>\n<template>${tag('Component', [binding, label, 'id="x"'])}</template>`
    const output = await sort(input)
    ordered(output, ['id="x"', binding, label])
    assert.equal(output.split(binding).length - 1, 1)
    assert.equal(
      output.slice(0, input.indexOf('<template>')),
      input.slice(0, input.indexOf('<template>'))
    )
    assert.equal(await sort(output), output)
  }
})

test('valid TypeScript directive and interpolation expressions do not disable sibling sorting', async () => {
  const input = `<script setup lang="ts">\nconst value: string | number = 1\n</script>\n<template>
${tag('Component', [':value="value as number"', 'aria-label="A considerably longer label"', 'id="x"'])}
<p>{{ value satisfies number }}</p>
${tag('button', ['aria-label="A sortable sibling label"', 'id="y"', '@click="select"'])}
</template>`
  const output = await sort(input)
  ordered(output, [
    'id="x"',
    ':value="value as number"',
    'aria-label="A considerably longer label"',
  ])
  ordered(output.slice(output.indexOf('<button')), [
    'id="y"',
    '@click="select"',
    'aria-label="A sortable sibling label"',
  ])
  assert.ok(output.includes('<p>{{ value satisfies number }}</p>'))
  assert.equal(await sort(output), output)
})

test('template sorting does not parse unrelated invalid TypeScript script content', async () => {
  const script = '<script setup lang="ts">\nconst broken: =\n</script>'
  const input = `${script}\n<template>${tag('Component', [':value="value as number"', 'aria-label="A considerably longer label"', 'id="x"'])}</template>`
  const output = await sort(input)
  assert.ok(output.startsWith(script))
  ordered(output, [
    'id="x"',
    ':value="value as number"',
    'aria-label="A considerably longer label"',
  ])
})

test('generic script setup declarations do not prevent typed template sorting', async () => {
  const script =
    '<script setup lang="ts" generic="T extends string">\nconst props = defineProps<{ value: T }>()\n</script>'
  const input = `${script}\n<template>${tag('Component', [':value="props.value as T"', 'aria-label="A considerably longer label"', 'id="x"'])}</template>`
  const output = await sort(input)
  assert.ok(output.startsWith(script))
  ordered(output, [
    'id="x"',
    ':value="props.value as T"',
    'aria-label="A considerably longer label"',
  ])
  assert.equal(await sort(output), output)
})

test('genuinely malformed TypeScript template expressions fail closed for the source', async () => {
  for (const expression of ['value as', 'value satisfies', 'value! +']) {
    const input = `<script setup lang="ts">\nconst value: number = 1\n</script>\n<template>${tag('Component', [`:value="${expression}"`, 'aria-label="A considerably longer label"', 'id="x"'])}\n${tag('button', ['class="sortable sibling class"', 'id="y"'])}</template>`
    assert.equal(await sort(input), input)
    assert.equal(await sort(await sort(input)), input)
  }
})

test('TypeScript assertions do not hide calls or mutations from ordering barriers', async () => {
  for (const expression of [
    'getValue() as SomeType',
    'getValue()!',
    'getValue() satisfies SomeType',
    'counter++ as number',
    '(value = next) satisfies SomeType',
  ]) {
    const binding = `:value="${expression}"`
    const input = `<script setup lang="ts">\nconst value: number = 1\n</script>\n<template>${tag('Component', ['aria-label="before the barrier"', 'id="x"', binding, 'data-description="after the barrier"', 'ref="y"'])}</template>`
    const output = await sort(input)
    ordered(output, [
      'id="x"',
      'aria-label="before the barrier"',
      binding,
      'ref="y"',
      'data-description="after the barrier"',
    ])
    assert.equal(output.split(binding).length - 1, 1)
    assert.equal(await sort(output), output)
  }
})

test('compares full attribute text, ignoring indentation rather than sorting names', async () => {
  const input = `<template>
  <div
          :a="extremelyLongValue"
    :longer="x"
      disabled
      data-z="123456"
  />
</template>`
  const output = await sort(input)
  ordered(output, ['disabled', ':longer="x"', 'data-z="123456"', ':a="extremelyLongValue"'])
  assert.equal((output.match(/disabled/g) || []).length, 1)
})

test('equal rendered lengths retain input order without an alphabetical tiebreaker', async () => {
  const input = `<template>${tag('Card', [':mode="mode"', ':logo="logo"', '@z="z"', '@a="a"'])}</template>`
  const output = await sort(input)
  ordered(output, ['@z="z"', '@a="a"', ':mode="mode"', ':logo="logo"'])
  assert.equal(await sort(output), output)
})

test('structural directives retain existing relative order above ordinary attributes', async () => {
  for (const priority of [
    ['v-if="visible"', 'v-for="item in items"'],
    ['v-for="item in items"', 'v-if="visible"'],
  ]) {
    const input = `<template>${tag('div', ['class="some-long-class"', priority[0], 'id="x"', priority[1]])}</template>`
    ordered(await sort(input), [...priority, 'id="x"', 'class="some-long-class"'])
  }
})

test('bare object spreads stay anchored while sortable groups on both sides are ordered', async () => {
  for (const spread of ['v-bind="attrs"', 'v-on="listeners"']) {
    const input = `<template>${tag('Card', [
      'aria-label="before the spread"',
      'id="x"',
      spread,
      'data-testid="after the spread"',
      'ref="y"',
    ])}</template>`
    const output = await sort(input)
    ordered(output, [
      'id="x"',
      'aria-label="before the spread"',
      spread,
      'ref="y"',
      'data-testid="after the spread"',
    ])
    assert.equal(await sort(output), output)
  }
})

test('does not move bare v-bind across overriding explicit attributes', async () => {
  for (const attributes of [
    ['id="custom"', 'v-bind="attrs"'],
    ['v-bind="attrs"', 'id="custom"'],
    ['foo="value"', 'v-bind="props"'],
  ]) {
    const input = `<template>${tag('Card', attributes)}</template>`
    assert.equal(await sort(input), input)
  }
})

test('dynamic binding/event arguments remain barriers with expressions untouched', async () => {
  for (const dynamic of [
    ':[attributeName]="value"',
    '@[eventName]="handler"',
    'v-bind:[attributeName]="value"',
    'v-on:[eventName]="handler"',
    ':[names[current]]="obj.value"',
  ]) {
    const input = `<template>${tag('Card', ['aria-label="before"', 'id="x"', dynamic, 'data-long="after"', 'ref="y"'])}</template>`
    const output = await sort(input)
    ordered(output, ['aria-label="before"', dynamic, 'data-long="after"'])
    assert.equal(output.split(dynamic).length - 1, 1)
    assert.equal(await sort(output), output)
  }
})

test('custom directives never cross one another or neighboring attributes', async () => {
  const input = `<template>${tag('Card', [
    'aria-label="first group"',
    'id="x"',
    'v-tooltip="message"',
    'class="middle group"',
    'v-focus',
    'v-permission="permission"',
    'data-testid="last group"',
    'ref="y"',
  ])}</template>`
  const output = await sort(input)
  ordered(output, [
    'aria-label="first group"',
    'v-tooltip="message"',
    'class="middle group"',
    'v-focus',
    'v-permission="permission"',
    'data-testid="last group"',
  ])
  assert.equal(await sort(output), output)
})

test('binding expressions with explicit calls or mutations cannot cross surrounding attrs', async () => {
  for (const expression of [
    'getValue()',
    '++counter',
    'counter++',
    '(value = next)',
    'new Thing()',
    'values.map(mapper)',
  ]) {
    const unsafe = `:value="${expression}"`
    const input = `<template>${tag('Card', ['aria-label="before"', 'id="x"', unsafe, 'data-label="after"', 'ref="y"'])}</template>`
    const output = await sort(input)
    ordered(output, ['aria-label="before"', unsafe, 'data-label="after"'])
    assert.equal(output.split(unsafe).length - 1, 1)
  }
})

test('implicit coercion expressions are boundaries rather than ordinary property reads', async () => {
  for (const expression of [
    '+value',
    '-value',
    '~value',
    'value + 1',
    'value == 1',
    'value < other',
    '`${value}`',
  ]) {
    const coercion = `:value="${expression}"`
    const input = `<template>${tag('Card', ['aria-label="before"', 'id="x"', coercion, 'data-label="after"', 'ref="y"'])}</template>`
    const output = await sort(input)
    ordered(output, ['aria-label="before"', coercion, 'data-label="after"'])
  }
})

test('duplicate and effective alias conflicts preserve precedence or handler order', async () => {
  for (const conflict of [
    ['class="first-long-class"', ':class="x"'],
    ['style="color: red"', ':style="x"'],
    ['foo="first"', ':foo="x"'],
    [':foo-bar="first"', ':fooBar="x"'],
    ['@foo-bar="first"', '@fooBar="x"'],
    ['@click.right="first"', '@contextmenu="x"'],
    ['@click.middle="first"', '@mouseup="x"'],
    ['@click="firstLongHandler"', 'v-on:click="x"'],
    ['v-model="value"', '@update:model-value="x"'],
    ['v-model:name="value"', ':name="x"'],
    ['v-model:name="value"', '@update:name="x"'],
    ['v-model:name.trim="value"', ':name-modifiers="x"'],
  ]) {
    const input = `<template>${tag('Card', [...conflict, 'id="x"'])}</template>`
    const output = await sort(input)
    ordered(output, conflict)
    assert.equal(await sort(output), output)
  }
})

test('event option modifier suffixes cannot reverse generated handler merges', async () => {
  for (const conflict of [
    ['@click.once="firstLongHandler"', ':onClickOnce="x"'],
    ['@click.capture="firstLongHandler"', ':onClickCapture="x"'],
    ['@click.passive="firstLongHandler"', ':onClickPassive="x"'],
    ['@click.once.capture="firstLongHandler"', ':onClickOnceCapture="x"'],
    ['@click.right.once="firstLongHandler"', ':onContextmenuOnce="x"'],
    ['@click.middle.capture="firstLongHandler"', ':onMouseupCapture="x"'],
  ]) {
    const input = `<template>${tag('button', [...conflict, 'id="x"'])}</template>`
    const output = await sort(input)
    ordered(output, conflict)
    assert.equal(await sort(output), output)
  }
})

test('ref compiler-generated keys preserve overriding explicit ref metadata', async () => {
  for (const metadata of [':ref_for="false"', ':ref_key="key"']) {
    const input = `<template>${tag('div', ['v-for="item in items"', metadata, 'ref="target"'])}</template>`
    ordered(await sort(input), [metadata, 'ref="target"'])
  }
})

test('ordinary bindings, event modifiers, boolean attrs, aria and data attrs retain exact text', async () => {
  const attributes = [
    ':pagination-error-message="runtime?.paginationErrorMessage"',
    '@update:model-value="onModelUpdate"',
    '@keydown.enter="submit"',
    '@click.stop="click"',
    ':aria-label="title"',
    ':data-id="item.id"',
    ':style="item.style"',
    ':class="item.class"',
    ':title="title"',
    'ref="root"',
    'disabled',
  ]
  const input = `<template>${tag('Card', attributes)}</template>`
  const output = await sort(input)
  const expected = attributes
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value.length - b.value.length || a.index - b.index)
    .map(({ value }) => value)
  ordered(output, expected)
  for (const attribute of attributes) assert.equal(output.split(attribute).length - 1, 1)
})

test('v-show and v-model syntax and modifiers survive conservative handling unchanged', async () => {
  const directives = ['v-show="visible"', 'v-model="value"', 'v-model:name.trim="name"']
  for (const directive of directives) {
    const input = `<template>${tag('Card', ['class="long-class"', directive, 'id="x"'])}</template>`
    const output = await sort(input)
    assert.equal(output.split(directive).length - 1, 1)
    assert.equal(await sort(output), output)
  }
})

test('preserves expression spelling, multiline values, children, closing tags and CRLF', async () => {
  const input = `<template>\r\n  <Card\r\n    :title="(item?.name ?? 'unknown')"\r\n    class="line one\r\n      line two"\r\n    id="x"\r\n  ><span>unchanged text</span><!-- child comment --></Card>\r\n</template>\r\n`
  const output = await sort(input)
  assert.ok(output.includes(':title="(item?.name ?? \'unknown\')"'))
  assert.ok(output.includes('class="line one\r\n      line two"'))
  assert.ok(output.includes('><span>unchanged text</span><!-- child comment --></Card>'))
  assert.equal(output.replaceAll('\r\n', '').includes('\n'), false)
  assert.equal(await sort(output), output)
})

test('comments and malformed opening-tag boundaries are never repaired or relocated', async () => {
  for (const input of [
    '<template><Card\n  class="long"\n  <!-- about the following id -->\n  id="x"\n/></template>',
    '<template><Card\n  class="unterminated\n  id="x"\n/></template>',
    '<template><Card\n  :[broken="x"\n  id="y"\n/></template>',
  ]) {
    assert.equal(await sort(input), input)
  }
})

test('prettier-ignore protects the entire next element while sibling elements remain sortable', async () => {
  const protectedElement = tag('Card', ['aria-label="leave this long attr first"', 'id="x"'])
  const input = `<template>\n<!-- prettier-ignore -->\n${protectedElement}\n${tag('button', ['aria-label="sort sibling"', 'id="y"'])}\n</template>`
  const output = await sort(input)
  assert.ok(output.includes(`<!-- prettier-ignore -->\n${protectedElement}`))
  ordered(output.slice(output.indexOf('<button')), ['id="y"', 'aria-label="sort sibling"'])
})

test('does not touch script, style, Vue custom blocks or unrecognized template languages', async () => {
  const scripts =
    '<script setup lang="ts">\nconst marker = `<Card\\n class="long"\\n id="x"/>`\n</script>'
  const styles = '<style scoped>\n.card::after { content: "<div id=x class=long>"; }\n</style>'
  const custom = '<docs>\n<Card\n  class="long custom content"\n  id="x"\n/>\n</docs>'
  const input = `${scripts}\n<template>${tag('Card', ['class="template class"', 'id="y"'])}</template>\n${styles}\n${custom}\n`
  const output = await sort(input)
  assert.ok(output.includes(scripts))
  assert.ok(output.includes(styles))
  assert.ok(output.includes(custom))
  ordered(output.slice(output.indexOf('<template>'), output.indexOf('</template>')), [
    'id="y"',
    'class="template class"',
  ])
  for (const lang of ['pug', 'jade']) {
    const alternative = `<template lang="${lang}">\nCard(class="long class" id="x")\n</template>`
    assert.equal(await sort(alternative), alternative)
  }
})

test('ordinary HTML documents and nested elements share the same ordering', async () => {
  const input = `<!doctype html>\n<html><body>\n${tag('button', ['aria-label="outer button"', 'id="x"'])}\n<div\n  class="outer-long-class"\n  id="y"\n><span\n  data-description="nested long value"\n  title="z"\n>child</span></div>\n</body></html>`
  const output = await sort(input, { parser: 'html' })
  assert.ok(output.startsWith('<!doctype html>\n<html><body>'))
  ordered(output, [
    'id="x"',
    'aria-label="outer button"',
    'id="y"',
    'class="outer-long-class"',
    'title="z"',
    'data-description="nested long value"',
  ])
  assert.ok(output.includes('>child</span></div>'))
  assert.equal(await sort(output, { parser: 'html' }), output)
})

test('single-line attribute lists and non-template parser requests remain unchanged', async () => {
  const input = '<template><Card class="a long class" id="x" /><div class="box"></div></template>'
  assert.equal(await sort(input), input)
  const script = 'const example = `<Card\n class="long"\n id="x"/>`\n'
  assert.equal(await sort(script, { parser: 'babel' }), script)
})

test('maps a cursor inside a moved attribute to the same expression position', async () => {
  const input = `<template>${tag('Card', [':description="detail.message"', 'id="x"', ':name="name"'])}</template>`
  const cursorOffset = input.indexOf('detail.message') + 'detail.'.length
  const result = await sortAttributes(input, { parser: 'vue', cursorOffset })
  ordered(result.formatted, ['id="x"', ':name="name"', ':description="detail.message"'])
  assert.equal(result.cursorOffset, result.formatted.indexOf('detail.message') + 'detail.'.length)
})

test('keeps whitespace and end-of-attribute cursors attached to the sorted tag', async () => {
  const options = { ...preset, parser: 'html' }
  const source = await prettier.format(
    '<button aria-label="Long label" class="profile-button" id="profile">X</button>',
    options
  )
  for (const cursorOffset of [
    source.indexOf('class=') - 1,
    source.indexOf('aria-label="Long label"') + 'aria-label="Long label"'.length,
  ]) {
    const result = await editorPrettier.formatWithCursor(source, { ...options, cursorOffset })
    assert.match(result.formatted[result.cursorOffset], /\s/)
  }
  const cursorOffset = source.indexOf('id="profile"') + 'id="profile"'.length
  const result = await editorPrettier.formatWithCursor(source, { ...options, cursorOffset })
  assert.equal(
    result.cursorOffset,
    result.formatted.indexOf('id="profile"') + 'id="profile"'.length
  )
})

test('editor check agrees with its attribute-aware format without altering non-template checks', async () => {
  const options = { ...preset, parser: 'html' }
  const source = await prettier.format('<button aria-label="Long label" id="x">X</button>', options)
  assert.equal(await editorPrettier.check(source, options), false)
  assert.equal(
    await editorPrettier.check(await editorPrettier.format(source, options), options),
    true
  )
  assert.equal(
    await editorPrettier.check('const n = 1\n', { ...preset, parser: 'babel' }),
    await prettier.check('const n = 1\n', { ...preset, parser: 'babel' })
  )
})

test('editor Prettier pipeline sorts after authoritative wrapping and remains idempotent', async () => {
  const input = `<template><Card aria-label="a very long readable label" id="x" :title="title" /></template>`
  const options = { ...preset, parser: 'vue' }
  const output = await editorPrettier.format(input, options)
  ordered(output, ['id="x"', ':title="title"', 'aria-label="a very long readable label"'])
  assert.equal(await editorPrettier.format(output, options), output)
  const cursorOffset = input.indexOf('title"') + 2
  const withCursor = await editorPrettier.formatWithCursor(input, { ...options, cursorOffset })
  assert.equal(withCursor.formatted, output)
  assert.equal(
    withCursor.formatted.slice(withCursor.cursorOffset - 2, withCursor.cursorOffset + 3),
    'title'
  )
})

test('partial range formatting never applies attribute sorting outside its original input range', async () => {
  const input = `<template>\n<Card${' '.repeat(200)}aria-label="first long attr" id="x" />\n<Other aria-label="second long attr" id="y" />\n</template>`
  const options = { ...preset, parser: 'vue', rangeStart: 0, rangeEnd: input.indexOf('<Other') }
  assert.equal(await editorPrettier.format(input, options), await prettier.format(input, options))
  const withCursor = { ...options, cursorOffset: input.indexOf('second long attr') + 2 }
  assert.deepEqual(
    await editorPrettier.formatWithCursor(input, withCursor),
    await prettier.formatWithCursor(input, withCursor)
  )
})

test('singleAttributePerLine false remains authoritative and stable through template sorting', async () => {
  for (const printWidth of [35, 80, 100]) {
    const options = { ...preset, parser: 'vue', singleAttributePerLine: false, printWidth }
    const short = '<template><Card class="box" id="x" /></template>'
    assert.equal(await editorPrettier.format(short, options), await prettier.format(short, options))
    const input =
      '<template><Card :long-prop="{alpha: longVariableName, beta: longVariableName}" id="x" :title="title" class="very long class string with multiple words" /></template>'
    const first = await editorPrettier.format(input, options)
    assert.equal(await editorPrettier.format(first, options), first)
  }
})

test('editor bridge preserves normal Prettier output for unrelated languages', async () => {
  for (const [parser, text] of [
    ['babel', 'const value={a:1,b:2};'],
    ['typescript', 'const value: string="x";'],
    ['css', '.box{color:red;background:white}'],
    ['json', '{"b":2,"a":1}'],
    ['markdown', '# Heading\n\nSome **text**.'],
    ['graphql', 'query { user { name id } }'],
  ]) {
    const options = { ...preset, parser }
    assert.equal(await editorPrettier.format(text, options), await prettier.format(text, options))
  }
})
