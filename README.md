# code-breathe

Automatic formatting, readable code spacing, and safe Vue/HTML attribute ordering.

### Features

- Vue, JavaScript, TypeScript, JSX/TSX, HTML, CSS, JSON, Markdown, GraphQL, and more
- Readable blank-line grouping for JS/TS
- Safe Vue/HTML attribute ordering
- Prettier + ESLint integration
- VS Code and Cursor format-on-save
- CLI and coding-agent friendly
- Respects existing Prettier, EditorConfig, and ignore settings

### Installation

```sh
npm install -D code-breathe
```

```sh
yarn add -D code-breathe
```

```sh
pnpm add -D code-breathe
```

## Initialize

```sh
npx --no-install code-breathe init
```

Initialization adds:

- formatting scripts
- Prettier and ESLint configuration
- VS Code / Cursor settings
- editor format-on-save support
- managed instructions for Codex, Claude, and Cursor

It does not format your source files or change your dev command.

## Format

### Specific files

```sh
npm run format:files -- src/components/Card.vue src/main.ts
```

### Directory

```sh
npm run format:files -- src/components
```

### Glob

```sh
npm run format:files -- "src/**/*.vue"
```

### Entire project

```sh
npm run format
```

### Check changed files

```sh
npm run format:check
```

## Other commands

```sh
# Check the entire project
npx --no-install code-breathe check --all

# Check changes against a branch
npx --no-install code-breathe check --base origin/main

# Validate project setup
npx --no-install code-breathe doctor

# Preview initialization
npx --no-install code-breathe init --dry-run

# Initialize without editor settings
npx --no-install code-breathe init --no-editor

# Initialize without agent instructions
npx --no-install code-breathe init --no-agents
```

## How formatting works

`code-breathe` uses Prettier for standard formatting, then applies readable code grouping and safe Vue/HTML attribute ordering.

### JavaScript / TypeScript

Before:

```ts
import { computed } from 'vue'
import { useUser } from './user'
const props = defineProps<{ name: string }>()
const user = useUser()
const title = computed(() => props.name)
const open = () => user.open()
```

After:

```ts
import { computed } from 'vue'
import { useUser } from './user'

const props = defineProps<{ name: string }>()

const user = useUser()

const title = computed(() => props.name)

const open = () => user.open()
```

### Vue / HTML attributes

Before:

```vue
<Component
  :title="title"
  class="profile-card"
  v-if="visible"
  aria-label="Open profile"
  @click="open"
  id="card"
/>
```

After:

```vue
<Component
  v-if="visible"
  id="card"
  @click="open"
  :title="title"
  class="profile-card"
  aria-label="Open profile"
/>
```

Safe `v-if` and `v-for` directives stay first. Other safe attributes are ordered from shortest to longest.

Risky constructs such as object spreads, dynamic arguments, custom directives, and conflicting attributes keep their original position.

## License

MIT
