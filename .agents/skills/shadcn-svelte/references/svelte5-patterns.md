# shadcn-svelte: Svelte 5 Rune Patterns

## Overview

shadcn-svelte v2 is built for Svelte 5. All components use the runes API (`$state`, `$props`, `$derived`, `$effect`) and snippets (not slots). This guide covers patterns specific to using shadcn-svelte with Svelte 5 — not general Svelte 5 fundamentals.

## Receiving Props with $props()

shadcn-svelte components accept standard HTML attributes plus component-specific props:

```svelte
<script lang="ts">
  import { Button, type ButtonProps } from "$lib/components/ui/button/index.js";

  // When wrapping a shadcn component, spread remaining props
  let { class: className, variant = "default", children, ...rest }: ButtonProps = $props();
</script>

<Button {variant} class={className} {...rest}>
  {@render children?.()}
</Button>
```

## Snippets (NOT Slots)

Svelte 5 replaces `<slot>` with snippets. shadcn-svelte v2 uses this throughout.

### Default Children

Most components accept `children` as implicit content:

```svelte
<!-- Just works — children is the default snippet -->
<Button>Click me</Button>
<Badge variant="outline">Status</Badge>
<Card.Title>My Card</Card.Title>
```

### Named Snippets with Parameters

Some components expose named snippets that pass parameters. The most common pattern is `child` (singular) which passes `{ props }`:

```svelte
<!-- Popover.Trigger passes props via child snippet -->
<Popover.Trigger>
  {#snippet child({ props })}
    <Button {...props} variant="outline" role="combobox">
      Select...
    </Button>
  {/snippet}
</Popover.Trigger>

<!-- DropdownMenu.Trigger uses child snippet -->
<DropdownMenu.Trigger>
  {#snippet child({ props })}
    <Button {...props} variant="ghost" size="icon">
      <EllipsisIcon />
    </Button>
  {/snippet}
</DropdownMenu.Trigger>
```

### Form.Control children Snippet

Form.Control passes `{ props }` via a `children` snippet (not `child`):

```svelte
<Form.Control>
  {#snippet children({ props })}
    <Form.Label>Username</Form.Label>
    <Input {...props} bind:value={$formData.username} />
  {/snippet}
</Form.Control>
```

**Critical:** Always spread `{...props}` on the input element — these contain ARIA attributes for accessibility.

### Creating Custom Wrapper Snippets

```svelte
<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";

  let { trigger, content } = $props<{
    trigger: import('svelte').Snippet;
    content: import('svelte').Snippet;
  }>();
</script>

<Dialog.Root>
  <Dialog.Trigger>
    {@render trigger()}
  </Dialog.Trigger>
  <Dialog.Content>
    {@render content()}
  </Dialog.Content>
</Dialog.Root>
```

## Controlled State with $state()

### Dialog / Sheet Open State

```svelte
<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";

  let open = $state(false);

  function handleSave() {
    // Process save...
    open = false; // Close programmatically
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger>
    <Button>Edit</Button>
  </Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Edit Item</Dialog.Title>
    </Dialog.Header>
    <!-- form -->
    <Dialog.Footer>
      <Button onclick={handleSave}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Or open programmatically from elsewhere -->
<Button onclick={() => { open = true; }}>Open from outside</Button>
```

### Select Controlled Value

```svelte
<script lang="ts">
  import * as Select from "$lib/components/ui/select/index.js";

  let theme = $state("light");
</script>

<Select.Root type="single" bind:value={theme}>
  <Select.Trigger class="w-[180px]">
    {theme}
  </Select.Trigger>
  <Select.Content>
    <Select.Item value="light">Light</Select.Item>
    <Select.Item value="dark">Dark</Select.Item>
    <Select.Item value="system">System</Select.Item>
  </Select.Content>
</Select.Root>

<p>Current theme: {theme}</p>
```

### Checkbox / Switch Controlled State

```svelte
<script lang="ts">
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";

  let notifications = $state(true);
  let termsAccepted = $state(false);
</script>

<Switch bind:checked={notifications} />
<Checkbox bind:checked={termsAccepted} />
```

## Derived State with $derived()

```svelte
<script lang="ts">
  let items = $state<string[]>([]);
  let filter = $state("");

  // Derived from reactive state
  const filteredItems = $derived(
    items.filter(item => item.toLowerCase().includes(filter.toLowerCase()))
  );

  const hasSelection = $derived(items.length > 0);
  const statusText = $derived(
    `${filteredItems.length} of ${items.length} items`
  );
</script>

<Input bind:value={filter} placeholder="Filter..." />
<p class="text-sm text-muted-foreground">{statusText}</p>
```

### Combobox Selected Label Pattern

```svelte
<script lang="ts">
  const frameworks = [
    { value: "sveltekit", label: "SvelteKit" },
    { value: "nextjs", label: "Next.js" },
  ];

  let value = $state("");

  const selectedLabel = $derived(
    frameworks.find(f => f.value === value)?.label
  );
</script>

<!-- Display derived label in trigger -->
<Button>{selectedLabel || "Select framework..."}</Button>
```

## Effects with $effect()

Use sparingly — prefer `$derived` when possible.

```svelte
<script lang="ts">
  let dialogOpen = $state(false);

  // Side effect: log when dialog state changes
  $effect(() => {
    if (dialogOpen) {
      console.log("Dialog opened");
    }
  });
</script>
```

### Focus Management

```svelte
<script lang="ts">
  import { tick } from "svelte";

  let open = $state(false);
  let triggerRef = $state<HTMLButtonElement>(null!);

  function closeAndRefocus() {
    open = false;
    tick().then(() => triggerRef.focus());
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger bind:ref={triggerRef}>
    {#snippet child({ props })}
      <Button {...props}>Open</Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content>
    <!-- on selection: -->
    <Command.Item onSelect={() => closeAndRefocus()}>
      Option
    </Command.Item>
  </Popover.Content>
</Popover.Root>
```

## Wrapping shadcn Components

### Basic Wrapper

```svelte
<!-- AppButton.svelte -->
<script lang="ts">
  import { Button, type ButtonProps } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";

  let { class: className, children, ...rest }: ButtonProps = $props();
</script>

<Button class={cn("app-specific-class", className)} {...rest}>
  {@render children?.()}
</Button>
```

### Wrapper with Custom Logic

```svelte
<!-- ConfirmButton.svelte -->
<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";

  let {
    confirmMessage = "Are you sure?",
    onConfirm,
    children,
    ...buttonProps
  } = $props<{
    confirmMessage?: string;
    onConfirm: () => void;
    children?: import('svelte').Snippet;
  }>();

  let open = $state(false);
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger>
    <Button {...buttonProps}>
      {@render children?.()}
    </Button>
  </Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Confirm</Dialog.Title>
      <Dialog.Description>{confirmMessage}</Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => { open = false; }}>Cancel</Button>
      <Button variant="destructive" onclick={() => { onConfirm(); open = false; }}>
        Confirm
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
```

### Extending with Additional Props

```svelte
<!-- StatusBadge.svelte -->
<script lang="ts">
  import { Badge } from "$lib/components/ui/badge/index.js";

  type Status = "active" | "inactive" | "pending";

  let { status, ...rest } = $props<{ status: Status }>();

  const variantMap: Record<Status, string> = {
    active: "default",
    inactive: "secondary",
    pending: "outline",
  };
</script>

<Badge variant={variantMap[status]} {...rest}>
  {status}
</Badge>
```

## Passing Classes

Always use `cn()` for class merging:

```svelte
<script lang="ts">
  import { cn } from "$lib/utils.js";

  let { class: className, ...rest } = $props<{ class?: string }>();
</script>

<div class={cn("default-padding default-margin", className)} {...rest}>
  <!-- content -->
</div>
```

**Why cn()?** It uses `tailwind-merge` to resolve class conflicts:

```typescript
cn("px-4 py-2", "px-8")  // → "px-8 py-2" (px-4 removed, not duplicated)
cn("text-red-500", "text-blue-500")  // → "text-blue-500" (last wins)
```

## Event Handling

Svelte 5 uses `on*` props (not `on:*` directives):

```svelte
<!-- ✅ Svelte 5 -->
<Button onclick={() => console.log("clicked")}>Click</Button>
<Input oninput={(e) => handleInput(e)} />

<!-- ❌ Svelte 4 (don't use) -->
<Button on:click={() => console.log("clicked")}>Click</Button>
```

## Bindable Props

Components from bits-ui support bind directives:

```svelte
<Dialog.Root bind:open={dialogOpen} />
<Select.Root bind:value={selectedValue} />
<Popover.Root bind:open={popoverOpen} />
<Switch bind:checked={isEnabled} />
<Checkbox bind:checked={isChecked} />
<Popover.Trigger bind:ref={triggerRef} />
```

## Generic Components

Data Table uses Svelte 5 generics:

```svelte
<script lang="ts" generics="TData, TValue">
  import type { ColumnDef } from "@tanstack/table-core";

  let { data, columns }: {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
  } = $props();
</script>
```

This enables type-safe data tables where column definitions are checked against the data type.
