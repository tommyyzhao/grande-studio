# shadcn-svelte: Installation & Setup

## Prerequisites

- Node.js 18+
- SvelteKit 2.x project
- Svelte 5.x
- Tailwind CSS v4 (via `@tailwindcss/vite`)

## Create a New Project

```bash
# Create SvelteKit project with Tailwind CSS
npx sv create my-app --add tailwindcss
cd my-app
npm install
```

This sets up SvelteKit 2 with Tailwind v4 using `@tailwindcss/vite` plugin.

## Initialize shadcn-svelte

```bash
npx shadcn-svelte@latest init
```

The CLI prompts for:

| Prompt | Default | Notes |
|--------|---------|-------|
| Base color | Slate | Options: slate, gray, zinc, neutral, stone |
| Global CSS file | src/app.css | Path to your CSS file |
| Components alias | $lib/components | Where components are imported from |
| Utils alias | $lib/utils | Location of cn() utility |
| Hooks alias | $lib/hooks | Custom hooks directory |
| UI alias | $lib/components/ui | Where UI components are installed |

### What `init` generates

1. **`components.json`** — Configuration file at project root
2. **`$lib/utils.ts`** — The `cn()` class merging utility
3. **CSS variables** — Theme colours appended to your CSS file
4. **Dependencies** — Installs `clsx`, `tailwind-merge`, `tailwind-variants`, `bits-ui`

## components.json

```json
{
  "$schema": "https://shadcn-svelte.com/schema.json",
  "style": "default",
  "tailwind": {
    "css": "src/app.css",
    "baseColor": "zinc"
  },
  "aliases": {
    "components": "$lib/components",
    "utils": "$lib/utils",
    "hooks": "$lib/hooks",
    "ui": "$lib/components/ui"
  }
}
```

| Field | Purpose |
|-------|---------|
| `$schema` | JSON schema for IDE autocomplete |
| `style` | Component style preset |
| `tailwind.css` | Path to global CSS file where vars are written |
| `tailwind.baseColor` | Base neutral colour palette |
| `aliases.components` | Import path for components |
| `aliases.utils` | Import path for cn() utility |
| `aliases.hooks` | Import path for hooks |
| `aliases.ui` | Where `add` installs component files |

## Vite Configuration

```typescript
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),  // MUST come before sveltekit()
    sveltekit(),
  ],
});
```

**Critical:** `tailwindcss()` plugin MUST be listed before `sveltekit()`.

## Path Aliases

SvelteKit provides `$lib` by default. For custom aliases:

```javascript
// svelte.config.js
export default {
  kit: {
    alias: {
      "@/*": "./src/lib/*",
    },
  },
};
```

## Adding Components

```bash
# Add a single component
npx shadcn-svelte@latest add button

# Add multiple components
npx shadcn-svelte@latest add button card dialog input

# Add ALL components
npx shadcn-svelte@latest add -a

# Overwrite existing files
npx shadcn-svelte@latest add button -o

# Skip prompts
npx shadcn-svelte@latest add button -y

# Skip dependency installation
npx shadcn-svelte@latest add button --no-deps
```

### Where files land

Components are installed to `$lib/components/ui/<component-name>/`:

```
src/lib/components/ui/
  button/
    index.ts          # Re-exports
    button.svelte     # Component implementation
  dialog/
    index.ts
    dialog-close.svelte
    dialog-content.svelte
    dialog-description.svelte
    dialog-footer.svelte
    dialog-header.svelte
    dialog-overlay.svelte
    dialog-title.svelte
  ...
```

Each component directory has an `index.ts` that re-exports all sub-components.

### Import conventions

```typescript
// Namespace import (preferred for multi-part components)
import * as Card from "$lib/components/ui/card/index.js";
// Usage: <Card.Root>, <Card.Header>, <Card.Title>

// Direct import (for single-export components)
import { Button } from "$lib/components/ui/button/index.js";
import { Input } from "$lib/components/ui/input/index.js";

// Always include .js extension for SvelteKit module resolution
```

## The cn() Utility

Created at `$lib/utils.ts`:

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Use to merge Tailwind classes without conflicts:

```svelte
<div class={cn("px-4 py-2 bg-primary", isActive && "bg-accent", className)}>
```

## Updating Components

Re-run `add` with `-o` (overwrite) to update a component:

```bash
npx shadcn-svelte@latest add button -o
```

This replaces the component files entirely. If you've customised a component, your changes will be lost. Consider diffing before overwriting.

## TypeScript Strict Mode

shadcn-svelte components are TypeScript-compatible. For strict mode, ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

All component props are properly typed via bits-ui and internal type definitions.

## Proxy Support

For network-restricted environments:

```bash
HTTP_PROXY="http://proxy:8080" npx shadcn-svelte@latest init
```

Or use the `--proxy` flag:

```bash
npx shadcn-svelte@latest init --proxy http://proxy:8080
```

## Root Layout Setup

After init, configure your root layout:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import "../app.css";
  import { ModeWatcher } from "mode-watcher";
  import { Toaster } from "$lib/components/ui/sonner/index.js";
  let { children } = $props();
</script>

<ModeWatcher />
<Toaster />
{@render children?.()}
```

This sets up:
- Global CSS with theme variables
- Dark mode support via mode-watcher
- Toast notifications via svelte-sonner
