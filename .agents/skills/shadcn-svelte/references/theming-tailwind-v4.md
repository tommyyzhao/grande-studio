# shadcn-svelte: Theming & Tailwind CSS v4 Integration

## Overview

shadcn-svelte uses CSS variables for theming, integrated with Tailwind CSS v4's CSS-first configuration system. There is **no `tailwind.config.js`** — all configuration happens in CSS.

## Tailwind v4 Setup

### Vite Plugin

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

### app.css Structure

```css
@import "tailwindcss";

/* CSS variables for light mode */
:root {
  /* ... theme variables ... */
}

/* CSS variables for dark mode */
.dark {
  /* ... dark overrides ... */
}

/* Register variables with Tailwind */
@theme inline {
  /* ... --color-* mappings ... */
}
```

## CSS Variable Naming Convention

shadcn-svelte uses a **background/foreground** naming pattern:

- `--primary` = background colour for primary elements
- `--primary-foreground` = text colour on primary backgrounds

Usage in Tailwind: `bg-primary text-primary-foreground`

## Complete Variable Reference

### Layout

| Variable | Purpose | Light Value | Dark Value |
|----------|---------|-------------|------------|
| `--radius` | Border radius base | `0.625rem` | `0.625rem` |

### Base Colours

| Variable | Purpose | Light (oklch) | Dark (oklch) |
|----------|---------|---------------|--------------|
| `--background` | Page background | `1 0 0` | `0.145 0 0` |
| `--foreground` | Default text | `0.145 0 0` | `0.985 0 0` |
| `--card` | Card background | `1 0 0` | `0.145 0 0` |
| `--card-foreground` | Card text | `0.145 0 0` | `0.985 0 0` |
| `--popover` | Popover background | `1 0 0` | `0.145 0 0` |
| `--popover-foreground` | Popover text | `0.145 0 0` | `0.985 0 0` |

### Semantic Colours

| Variable | Purpose | Light (oklch) | Dark (oklch) |
|----------|---------|---------------|--------------|
| `--primary` | Primary actions | `0.205 0 0` | `0.922 0 0` |
| `--primary-foreground` | Text on primary | `0.985 0 0` | `0.205 0 0` |
| `--secondary` | Secondary elements | `0.97 0 0` | `0.269 0 0` |
| `--secondary-foreground` | Text on secondary | `0.205 0 0` | `0.985 0 0` |
| `--muted` | Muted backgrounds | `0.97 0 0` | `0.269 0 0` |
| `--muted-foreground` | Muted text | `0.556 0 0` | `0.708 0 0` |
| `--accent` | Accent/hover state | `0.97 0 0` | `0.269 0 0` |
| `--accent-foreground` | Text on accent | `0.205 0 0` | `0.985 0 0` |
| `--destructive` | Danger/error | `0.577 0.245 27.325` | `0.704 0.191 22.216` |

### UI Elements

| Variable | Purpose |
|----------|---------|
| `--border` | Default border colour |
| `--input` | Input border colour |
| `--ring` | Focus ring colour |

### Chart Colours

`--chart-1` through `--chart-5` — predefined chart palette.

### Sidebar Colours

`--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring`

## @theme inline Block

The `@theme inline` block registers CSS variables with Tailwind v4 so they're available as utility classes:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius: var(--radius);
}
```

This creates utility classes like `bg-primary`, `text-muted-foreground`, `border-border`, etc.

## Adding Custom Colour Tokens

To add a new colour that works with shadcn-svelte's system:

### Step 1: Define CSS Variables

```css
:root {
  --warning: oklch(0.84 0.16 84);
  --warning-foreground: oklch(0.28 0.07 46);
  --success: oklch(0.72 0.19 142);
  --success-foreground: oklch(0.98 0.02 142);
}

.dark {
  --warning: oklch(0.41 0.11 46);
  --warning-foreground: oklch(0.99 0.02 95);
  --success: oklch(0.45 0.15 142);
  --success-foreground: oklch(0.98 0.02 142);
}
```

### Step 2: Register with Tailwind

```css
@theme inline {
  /* existing mappings... */
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
}
```

### Step 3: Use in Components

```svelte
<Badge class="bg-warning text-warning-foreground">Warning</Badge>
<Badge class="bg-success text-success-foreground">Active</Badge>
```

## Base Colour Presets

shadcn-svelte ships with 5 neutral palettes. Choose during `init`:

| Preset | Character |
|--------|-----------|
| `neutral` | Pure neutral grays |
| `stone` | Warm neutral tones |
| `zinc` | Cool blue-gray tones |
| `gray` | Standard gray |
| `slate` | Cool slate tones |

To switch after init, replace the CSS variable values in app.css. See [shadcn-svelte.com/docs/theming](https://www.shadcn-svelte.com/docs/theming) for complete colour values per preset.

## OKLCH Colour Format

shadcn-svelte uses OKLCH (Lightness, Chroma, Hue) for all colour values:

```
oklch(L C H)
```

- **L** (Lightness): 0 (black) to 1 (white)
- **C** (Chroma): 0 (gray) to ~0.4 (max saturation)
- **H** (Hue): 0-360 degrees on colour wheel

Benefits over HSL:
- Perceptually uniform lightness
- Better colour interpolation
- More predictable contrast ratios

## Dark Mode Integration

CSS variables automatically switch via the `.dark` class on `<html>`:

```css
:root {
  --background: oklch(1 0 0);       /* white */
  --foreground: oklch(0.145 0 0);   /* near-black */
}

.dark {
  --background: oklch(0.145 0 0);   /* near-black */
  --foreground: oklch(0.985 0 0);   /* near-white */
}
```

The `mode-watcher` package manages the `.dark` class. See `common-pitfalls.md` for SSR considerations.

## Tailwind v4 Key Differences from v3

| Feature | Tailwind v3 | Tailwind v4 |
|---------|-------------|-------------|
| Configuration | `tailwind.config.js` | CSS `@theme` directive |
| Content scanning | `content: [...]` array | Automatic detection |
| Vite integration | PostCSS plugin | `@tailwindcss/vite` plugin |
| Colour registration | `theme.extend.colors` | `@theme inline { --color-* }` |
| Plugin system | JS plugins | CSS `@plugin` directive |

**No `content` array needed.** Tailwind v4 automatically scans all files in your project. If classes aren't detected, ensure files are within the project root directory.

## Avoiding Conflicts

1. **Don't use `tailwind.config.js`** — Tailwind v4 ignores it. Use `@theme inline` in CSS.
2. **Don't duplicate variable names** — shadcn-svelte's `--primary` is already registered as `--color-primary`. Don't create another `--color-primary`.
3. **Use `@theme inline`** (not just `@theme`) — `inline` prevents generating additional CSS custom properties that could conflict.
4. **Plugin order matters** — `tailwindcss()` before `sveltekit()` in vite.config.ts.
