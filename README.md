# code-breathe

Consistent formatting and readable blank lines for Vue, JavaScript, and TypeScript.
Version **0.0.5**. Works with portfolios, stores, blogs, dashboards, services, and libraries.

## Install and initialize

```sh
yarn add -D code-breathe
yarn code-breathe init
```

Or use `npm install -D code-breathe` followed by `npx --no-install code-breathe init`,
or `pnpm add -D code-breathe` followed by `pnpm exec code-breathe init`.
Use Node **22.13+ on the 22.x line or 24+**. No global installation is needed.

Initialization installs no other packages, performs no source formatting, and never
changes your dev-server command. It adds tiny shared configuration references,
formatting scripts, VS Code/Cursor save settings, extension recommendations, and
managed instructions for AGENTS.md, CLAUDE.md, and Cursor.
It preserves existing instructions, editor comments, and unrelated settings.
Running it twice makes no further changes. Use `init --dry-run` to preview, or
`--no-editor` / `--no-agents` to omit those integrations.

Enable **Prettier – Code formatter** and **ESLint** in your editor and trust the
workspace to allow its local tools. Saving supported files runs formatting and
blank-line fixes. The extension recommendations do not install extensions automatically.
VS Code/Cursor integration requires a normal `node_modules` installation; Yarn PnP
is not supported by the generated editor settings in this release.
Other editors can run the CLI through their save hooks.

## Commands

```sh
yarn format:files src/components/Profile.vue src/main.ts
yarn format:check
yarn format

yarn code-breathe check --base origin/main
yarn code-breathe check --all
yarn code-breathe doctor
```

`format:files` accepts explicit files, directories, or quoted globs. The full-project
`format` script is an explicit choice. Checks never write files. `format:check` checks
staged, unstaged, and untracked local files; a clean checkout has no local changes.
In CI use `check --all`, or fetch the comparison branch and use `check --base <ref>`.
Git discovery is never allowed for write operations, so a formatting command cannot
automatically rewrite other developers' dirty files.
Run formatting after agent edits using only the paths that agent changed.

## Readable grouping

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useSection } from './data'

const props = defineProps<{ label: string }>()

const section = useSection('socials')

const heading = computed(() => props.label.toUpperCase())
</script>
```

Missing boundaries are inserted between imports, types, Vue props/emits,
state/composable declarations, imported Vue computed values, methods, and imported
Vue lifecycle/effects. Top-level multiline declarations get a blank line before and
after them. Related one-line computed values, functions, and callbacks stay together;
blank lines previously inserted between them are removed unless comments separate them.
Simple one-line composable calls remain together. Inline callbacks stay inside their expressions;
nested function bodies are not spaced by this rule. Function overload signatures
remain attached to their implementation. Imported aliases and Vue namespace imports
are supported.
Comments stay attached. Source order and nested function bodies are preserved.
This is syntax-based grouping, not an attempt to infer every conceptual relationship.
React and other JavaScript/TypeScript projects receive generic grouping; React-specific
hook grouping is not part of 0.0.5.

Prettier handles Vue, JS/TS, JSX/TSX, HTML, CSS/SCSS, JSON, YAML, Markdown, GraphQL,
and its other built-in languages. Semantic blank-line fixes apply only to script files.
Python, Java, Rust, and PHP are not supported without additional formatter integrations.

## Safe Vue and HTML attribute ordering

Multiline opening tags use the same ordering for native elements and Vue components,
including PascalCase, kebab-case, normal, and self-closing tags. Existing Prettier
wrapping remains authoritative: this feature does not expand a short single-line tag.
Within safely sortable attribute lists, structural `v-if` and `v-for` directives
stay first, preserving their relative order. Other attributes sort shortest to
longest by their complete formatted text, including values and expressions but
excluding indentation. Equal-length attributes keep their original order.

```vue
<button
  id="profile"
  @click="open"
  :disabled="loading"
  class="profile-button"
  aria-label="Open account settings"
>
  Settings
</button>
```

Ordering is conservative rather than a refactor. Expressions, modifiers, names,
values, children, and tag names are never rewritten by the attribute sorter.
Bare object bindings/listener objects, dynamic arguments, custom directives,
duplicate or potentially overlapping bindings, comments, and other uncertain
constructs preserve their ordering. No object binding is blindly moved ahead of
explicit attributes. Inline scripts, styles, and Vue custom blocks are outside
the attribute sorter's scope. Formatting again produces the same ordering.

Vue SFCs using `lang="ts"` or `lang="tsx"` support TypeScript template expressions,
including `as`, non-null assertions, and `satisfies`. The sorter does not parse
script content, and malformed template expressions leave the source unchanged.

As with normal template formatting, ordinary value/member reads are assumed to
be pure. JavaScript getters or proxies can make otherwise simple-looking reads
observable; the formatter cannot prove their application-specific behavior.
Expressions with known execution or mutation risks are left in place, and a
`<!-- prettier-ignore -->` comment can protect an element whose ordering has
special meaning in your application.

The CLI and the existing Prettier editor bridge use the same sorting behavior.
No new initialization step or editor configuration is needed when upgrading an
already-initialized project. Using the plain Prettier package directly does not
apply code-breathe's attribute ordering.

## Existing preferences and ignored files

Existing Prettier configuration and EditorConfig preferences remain authoritative.
Fresh projects get two spaces, single quotes, no semicolons, 100-column wrapping,
LF line endings, and one attribute per line. Override any preference in your project:

```js
// prettier.config.mjs
import preset from 'code-breathe/prettier'

export default { ...preset, tabWidth: 3 }
```

The CLI respects root `.gitignore` and `.prettierignore`. Dependency directories,
build output, common framework output, generated `*.generated.*` files, lockfiles,
and environment files are excluded by default. Add project-specific generated paths
to `.prettierignore`; do not place Builto-specific paths in this package.
The same spacing rule powers editor saves and the CLI. Their file selection can differ:
the CLI additionally respects `.gitignore`; editors use `.prettierignore` and the ESLint
configuration. Put generated-file exclusions in both configurations when needed.

## Existing ESLint configurations or script names

Initialization refuses conflicting ESLint configs or formatting script names before
writing any files. It does not silently replace your linting rules.
For an existing project, add this preset to your flat config manually:

```js
import breathe from 'code-breathe/eslint'

export default [
  ...breathe,
  // Your existing rules and overrides.
]
```

Use `code-breathe format` and `code-breathe check` directly, or add the three scripts
shown by `init --help` to your package.json. The CLI uses only the package's formatting
rules, so it will not trigger unrelated business-logic ESLint fixes.
For editor integration, see the generated settings from initialization in a clean
project: point Prettier to `./node_modules/code-breathe/editor/prettier.cjs` and
`eslint.nodePath` to `./node_modules/code-breathe/editor`, enable format-on-save,
and enable `source.fixAll.eslint`. Keep your project ESLint configuration active.

## Package exports

- `code-breathe/prettier`: shared Prettier configuration.
- `code-breathe/eslint`: shared flat ESLint configuration.
- `code-breathe/plugin`: standalone logical-group ESLint plugin.
- `code-breathe`: programmatic `runFormatting()` and `initialize()` plus configs.

The tools are package dependencies, including the TypeScript version needed by the
parser. Consumer projects do not have to install them individually, and their app's
TypeScript dependency is unaffected. Editor entry points resolve package dependencies
without relying on npm/Yarn hoisting or pnpm flattening.

## Development

```sh
npm install
npm test
npm run test:integration
npm run format:check
npm pack
```

The tests live in this standalone package and verify formatting, initialization,
Git selection, configuration conflicts, and editor runtime resolution.
Publishing is a separate explicit action. MIT licensed.
