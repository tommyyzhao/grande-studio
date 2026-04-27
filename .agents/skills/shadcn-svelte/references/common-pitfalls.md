# shadcn-svelte: Common Pitfalls & Fixes

## 1. Wrong CLI

**Problem:** Using `npx shadcn@latest` (React CLI) instead of the Svelte port.

**Fix:** Always use:
```bash
npx shadcn-svelte@latest init
npx shadcn-svelte@latest add <component>
```

The React CLI (`shadcn`) generates React components with JSX — they will not work in a Svelte project.

---

## 2. Vite Plugin Order

**Problem:** Tailwind classes not applied, styles missing.

**Fix:** `tailwindcss()` MUST come before `sveltekit()` in vite.config.ts:

```typescript
// ✅ Correct
plugins: [tailwindcss(), sveltekit()]

// ❌ Wrong — Tailwind won't process Svelte files correctly
plugins: [sveltekit(), tailwindcss()]
```

---

## 3. Using tailwind.config.js

**Problem:** Creating a `tailwind.config.js` file (Tailwind v3 pattern) — it's ignored by Tailwind v4.

**Fix:** Use CSS-first configuration in `app.css`:

```css
/* ✅ Tailwind v4 — use @theme inline */
@theme inline {
  --color-primary: var(--primary);
  --color-secondary: var(--secondary);
}

/* ❌ Don't create tailwind.config.js */
```

---

## 4. Missing .js Extension in Imports

**Problem:** `Cannot find module '$lib/components/ui/button'`

**Fix:** SvelteKit requires `.js` extension for module resolution:

```typescript
// ✅ Correct
import { Button } from "$lib/components/ui/button/index.js";
import * as Card from "$lib/components/ui/card/index.js";

// ❌ Wrong
import { Button } from "$lib/components/ui/button";
import { Button } from "$lib/components/ui/button/index";
```

---

## 5. Using Slots Instead of Snippets

**Problem:** Components not rendering children, or getting `<slot>` deprecation warnings.

**Fix:** shadcn-svelte v2 uses Svelte 5 snippets:

```svelte
<!-- ✅ Svelte 5 snippets -->
<Popover.Trigger>
  {#snippet child({ props })}
    <Button {...props}>Open</Button>
  {/snippet}
</Popover.Trigger>

<Form.Control>
  {#snippet children({ props })}
    <Input {...props} bind:value={$formData.name} />
  {/snippet}
</Form.Control>

<!-- ❌ Svelte 4 slots — don't use -->
<Popover.Trigger>
  <Button slot="trigger">Open</Button>
</Popover.Trigger>
```

---

## 6. Not Spreading Props in Form.Control

**Problem:** Form inputs lack accessibility attributes, screen readers can't associate labels with inputs.

**Fix:** Always spread `{...props}` from the `children` snippet:

```svelte
<!-- ✅ Correct — props spread on input -->
<Form.Control>
  {#snippet children({ props })}
    <Form.Label>Name</Form.Label>
    <Input {...props} bind:value={$formData.name} />
  {/snippet}
</Form.Control>

<!-- ❌ Wrong — missing props spread -->
<Form.Control>
  {#snippet children({ props })}
    <Form.Label>Name</Form.Label>
    <Input bind:value={$formData.name} />
  {/snippet}
</Form.Control>
```

---

## 7. SSR Hydration with Dialog/Sheet Open State

**Problem:** Hydration mismatch errors when Dialog or Sheet is initialised as open.

**Fix:** Never initialise open state as `true`. Let it start `false` and open client-side:

```svelte
<!-- ✅ Correct — starts closed -->
<script lang="ts">
  let open = $state(false);
</script>
<Dialog.Root bind:open>...</Dialog.Root>

<!-- ❌ Wrong — causes hydration mismatch -->
<script lang="ts">
  let open = $state(true);  // SSR renders open, client expects closed
</script>
<Dialog.Root bind:open>...</Dialog.Root>
```

If you need a dialog open on page load, open it in an `$effect`:

```svelte
<script lang="ts">
  import { browser } from "$app/environment";

  let open = $state(false);

  $effect(() => {
    if (browser) open = true;
  });
</script>
```

---

## 8. cn() Import Path

**Problem:** `Cannot find module 'cn'` or importing from the wrong place.

**Fix:** Import from `$lib/utils.js` — this file is created by `shadcn-svelte init`:

```typescript
// ✅ Correct
import { cn } from "$lib/utils.js";

// ❌ Wrong — cn is not a package
import { cn } from "cn";
import { cn } from "@shadcn/utils";
```

---

## 9. Tailwind v4 Content Scanning

**Problem:** Tailwind utility classes not applied — classes "purged" in production.

**Fix:** Tailwind v4 automatically scans all files in the project directory. No `content: [...]` array is needed. However:

- Ensure all files using Tailwind classes are within the project root
- Don't use dynamic class construction:

```svelte
<!-- ✅ Full class names (detectable) -->
<div class={cn(active ? "bg-primary" : "bg-secondary")}>

<!-- ❌ Dynamic class parts (not detectable) -->
<div class={`bg-${color}-500`}>
```

---

## 10. Sonner Theme Without mode-watcher

**Problem:** Toast notifications ignore dark mode or cause errors.

**Fix:** Sonner uses `mode-watcher` for theme detection. If you remove mode-watcher, also update Toaster:

```svelte
<!-- With mode-watcher (default setup) -->
<Toaster />

<!-- Without mode-watcher — set theme manually or remove theme prop -->
<Toaster theme="light" />
```

---

## 11. Select Component Missing type Prop

**Problem:** Select component doesn't work or throws errors.

**Fix:** `Select.Root` requires the `type` prop:

```svelte
<!-- ✅ Correct -->
<Select.Root type="single" bind:value>

<!-- ❌ Wrong — missing type -->
<Select.Root bind:value>
```

---

## 12. Using on:click Instead of onclick

**Problem:** Event handlers not firing.

**Fix:** Svelte 5 uses `on*` props, not `on:*` directives:

```svelte
<!-- ✅ Svelte 5 -->
<Button onclick={handleClick}>Click</Button>
<Input oninput={handleInput} />

<!-- ❌ Svelte 4 -->
<Button on:click={handleClick}>Click</Button>
<Input on:input={handleInput} />
```

---

## 13. Data Table: Missing createSvelteTable Import

**Problem:** Table doesn't render or throws "createSvelteTable is not a function."

**Fix:** Import from shadcn's data-table helper, not from @tanstack directly:

```typescript
// ✅ Correct — uses shadcn-svelte's wrapper
import { createSvelteTable, FlexRender } from "$lib/components/ui/data-table";

// ❌ Wrong — raw TanStack import may not have Svelte bindings
import { createSvelteTable } from "@tanstack/svelte-table";
```

Note: The `data-table` component provides `createSvelteTable`, `FlexRender`, `renderComponent`, and `renderSnippet` helpers.

---

## 14. Data Table State Updates

**Problem:** Sorting, filtering, or pagination not reactive.

**Fix:** Use the callback pattern with `$state` for all TanStack Table state:

```typescript
// ✅ Correct — callback pattern
let sorting = $state<SortingState>([]);

const table = createSvelteTable({
  get data() { return data; },  // Getter for reactivity
  columns,
  state: {
    get sorting() { return sorting; },
  },
  onSortingChange: (updater) => {
    sorting = typeof updater === "function" ? updater(sorting) : updater;
  },
  getSortedRowModel: getSortedRowModel(),
});

// ❌ Wrong — plain assignment, not reactive
const table = createSvelteTable({
  data,  // Not reactive — use getter
  columns,
  state: { sorting },  // Not reactive — use getter
});
```

---

## 15. @theme vs @theme inline

**Problem:** Extra CSS custom properties generated, conflicting with shadcn-svelte's variables.

**Fix:** Use `@theme inline` (not `@theme`) to prevent Tailwind from generating additional properties:

```css
/* ✅ Correct */
@theme inline {
  --color-primary: var(--primary);
}

/* ❌ May cause conflicts */
@theme {
  --color-primary: var(--primary);
}
```

---

## 16. Superforms Adapter Version

**Problem:** Form validation not working, type errors.

**Fix:** Use the correct superforms adapter for your Zod version:

```typescript
// Zod v4+
import { zod4 } from "sveltekit-superforms/adapters";
import { zod4Client } from "sveltekit-superforms/adapters";

// Zod v3 (older)
import { zod } from "sveltekit-superforms/adapters";
import { zodClient } from "sveltekit-superforms/adapters";
```

---

## Debugging Checklist

When something isn't working:

1. **Check CLI version:** `npx shadcn-svelte@latest` (not `shadcn`)
2. **Check vite.config.ts:** Plugin order correct?
3. **Check imports:** `.js` extension present?
4. **Check snippets:** Using `{#snippet}` not `<slot>`?
5. **Check props spread:** `{...props}` in Form.Control?
6. **Check class merging:** Using `cn()` from `$lib/utils.js`?
7. **Check Tailwind:** `@theme inline` in app.css?
8. **Check console:** Any hydration warnings?
9. **Check dependencies:** `bits-ui` installed?
10. **Check component files:** Files exist in `$lib/components/ui/<name>/`?
