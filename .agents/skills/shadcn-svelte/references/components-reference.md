# shadcn-svelte: Component API Reference

All components import from `$lib/components/ui/<name>/index.js`.

---

## Button

```bash
npx shadcn-svelte@latest add button
```

```svelte
import { Button, buttonVariants } from "$lib/components/ui/button/index.js";
```

### Variants

| Variant | Description |
|---------|-------------|
| `default` | Primary background with foreground text |
| `destructive` | Red/danger styling |
| `outline` | Border with transparent background |
| `secondary` | Secondary background colour |
| `ghost` | No background, hover effect only |
| `link` | Underline on hover, inline text style |

### Sizes

| Size | Class | Dimensions |
|------|-------|------------|
| `xs` | `h-6 text-xs` | Extra small |
| `sm` | `h-8` | Small |
| `default` | `h-9` | Standard |
| `lg` | `h-10` | Large |
| `icon` | `size-9` | Square icon button |
| `icon-xs` | `size-6` | Small icon button |
| `icon-sm` | `size-8` | Medium icon button |
| `icon-lg` | `size-10` | Large icon button |

### Props

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `variant` | `ButtonVariant` | `"default"` | Visual style |
| `size` | `ButtonSize` | `"default"` | Size preset |
| `href` | `string` | — | Renders as `<a>` when set |
| `type` | `string` | `"button"` | HTML button type |
| `disabled` | `boolean` | `false` | Disabled state |
| `class` | `string` | — | Additional CSS classes |
| `ref` | `HTMLElement` | — | Bindable element reference |

### Examples

```svelte
<!-- Standard -->
<Button>Click me</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline" size="sm">Cancel</Button>

<!-- As link -->
<Button href="/dashboard">Dashboard</Button>

<!-- Icon button -->
<Button variant="outline" size="icon" aria-label="Settings">
  <SettingsIcon />
</Button>

<!-- With icon and text -->
<Button variant="outline" size="sm">
  <PlusIcon /> New Item
</Button>

<!-- Disabled with spinner -->
<Button disabled>
  <Spinner /> Loading...
</Button>

<!-- Using buttonVariants for non-Button elements -->
<a href="/login" class={buttonVariants({ variant: "outline" })}>Login</a>
```

---

## Card

```bash
npx shadcn-svelte@latest add card
```

```svelte
import * as Card from "$lib/components/ui/card/index.js";
```

### Sub-components

| Component | Purpose |
|-----------|---------|
| `Card.Root` | Container wrapper |
| `Card.Header` | Top section |
| `Card.Title` | Heading text |
| `Card.Description` | Subtitle/description |
| `Card.Action` | Action button in header |
| `Card.Content` | Main content area |
| `Card.Footer` | Bottom section |

### Example

```svelte
<Card.Root class="w-full max-w-sm">
  <Card.Header>
    <Card.Title>Login</Card.Title>
    <Card.Description>Enter your credentials</Card.Description>
    <Card.Action>
      <Button variant="link">Sign Up</Button>
    </Card.Action>
  </Card.Header>
  <Card.Content>
    <div class="grid gap-4">
      <div class="grid gap-1.5">
        <Label for="email">Email</Label>
        <Input id="email" type="email" placeholder="Email" />
      </div>
      <div class="grid gap-1.5">
        <Label for="password">Password</Label>
        <Input id="password" type="password" />
      </div>
    </div>
  </Card.Content>
  <Card.Footer class="flex-col gap-2">
    <Button class="w-full">Login</Button>
    <Button variant="outline" class="w-full">Login with Google</Button>
  </Card.Footer>
</Card.Root>
```

---

## Dialog

```bash
npx shadcn-svelte@latest add dialog
```

```svelte
import * as Dialog from "$lib/components/ui/dialog/index.js";
```

### Sub-components

`Dialog.Root`, `Dialog.Trigger`, `Dialog.Content`, `Dialog.Header`, `Dialog.Title`, `Dialog.Description`, `Dialog.Footer`, `Dialog.Close`

### Basic Usage

```svelte
<Dialog.Root>
  <Dialog.Trigger>
    <Button variant="outline">Edit Profile</Button>
  </Dialog.Trigger>
  <Dialog.Content class="sm:max-w-[425px]">
    <Dialog.Header>
      <Dialog.Title>Edit Profile</Dialog.Title>
      <Dialog.Description>Make changes to your profile.</Dialog.Description>
    </Dialog.Header>
    <!-- form fields -->
    <Dialog.Footer>
      <Button type="submit">Save changes</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
```

### Controlled Open State

```svelte
<script lang="ts">
  let open = $state(false);
</script>

<Dialog.Root bind:open>
  <Dialog.Content>...</Dialog.Content>
</Dialog.Root>

<!-- Open programmatically -->
<Button onclick={() => { open = true; }}>Open Dialog</Button>
```

---

## Sheet

```bash
npx shadcn-svelte@latest add sheet
```

```svelte
import * as Sheet from "$lib/components/ui/sheet/index.js";
```

### Sub-components

`Sheet.Root`, `Sheet.Trigger`, `Sheet.Content`, `Sheet.Header`, `Sheet.Title`, `Sheet.Description`, `Sheet.Footer`, `Sheet.Close`, `Sheet.Overlay`, `Sheet.Portal`

### Side Positions

| Value | Description |
|-------|-------------|
| `top` | Slides from top |
| `right` | Slides from right (default) |
| `bottom` | Slides from bottom |
| `left` | Slides from left |

### Example

```svelte
<Sheet.Root>
  <Sheet.Trigger>
    <Button variant="outline">Open</Button>
  </Sheet.Trigger>
  <Sheet.Content side="right" class="w-[400px] sm:w-[540px]">
    <Sheet.Header>
      <Sheet.Title>Settings</Sheet.Title>
      <Sheet.Description>Configure preferences.</Sheet.Description>
    </Sheet.Header>
    <!-- content -->
    <Sheet.Footer>
      <Sheet.Close>
        <Button>Done</Button>
      </Sheet.Close>
    </Sheet.Footer>
  </Sheet.Content>
</Sheet.Root>
```

---

## Select

```bash
npx shadcn-svelte@latest add select
```

```svelte
import * as Select from "$lib/components/ui/select/index.js";
```

### Sub-components

`Select.Root`, `Select.Trigger`, `Select.Content`, `Select.Item`, `Select.Group`, `Select.Label`, `Select.Separator`, `Select.ScrollUpButton`, `Select.ScrollDownButton`

### Controlled with $state

```svelte
<script lang="ts">
  let value = $state("");

  const fruits = [
    { value: "apple", label: "Apple" },
    { value: "banana", label: "Banana" },
    { value: "cherry", label: "Cherry" },
  ];
</script>

<Select.Root type="single" bind:value>
  <Select.Trigger class="w-[180px]">
    {value ? fruits.find(f => f.value === value)?.label : "Select a fruit..."}
  </Select.Trigger>
  <Select.Content>
    <Select.Group>
      <Select.Label>Fruits</Select.Label>
      {#each fruits as fruit (fruit.value)}
        <Select.Item value={fruit.value}>{fruit.label}</Select.Item>
      {/each}
    </Select.Group>
  </Select.Content>
</Select.Root>
```

---

## Input

```bash
npx shadcn-svelte@latest add input
```

```svelte
import { Input } from "$lib/components/ui/input/index.js";
```

```svelte
<!-- Basic -->
<Input type="email" placeholder="Email" />

<!-- Disabled -->
<Input disabled type="email" placeholder="Email" />

<!-- File input -->
<Input type="file" />

<!-- With two-way binding -->
<script lang="ts">
  let email = $state("");
</script>
<Input bind:value={email} type="email" placeholder="Email" />
```

---

## Label

```bash
npx shadcn-svelte@latest add label
```

```svelte
import { Label } from "$lib/components/ui/label/index.js";

<Label for="email">Email</Label>
<Input id="email" type="email" />
```

---

## Textarea

```bash
npx shadcn-svelte@latest add textarea
```

```svelte
import { Textarea } from "$lib/components/ui/textarea/index.js";

<Textarea placeholder="Type your message here." />
```

---

## Badge

```bash
npx shadcn-svelte@latest add badge
```

```svelte
import { Badge } from "$lib/components/ui/badge/index.js";

<Badge>Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="outline">Outline</Badge>
<Badge variant="destructive">Destructive</Badge>
```

**Variants:** `default`, `secondary`, `destructive`, `outline`

---

## Separator

```bash
npx shadcn-svelte@latest add separator
```

```svelte
import { Separator } from "$lib/components/ui/separator/index.js";

<Separator />                            <!-- horizontal -->
<Separator orientation="vertical" />     <!-- vertical -->
<Separator class="my-4" />               <!-- with spacing -->
```

---

## Skeleton

```bash
npx shadcn-svelte@latest add skeleton
```

```svelte
import { Skeleton } from "$lib/components/ui/skeleton/index.js";

<!-- Text placeholder -->
<Skeleton class="h-4 w-[250px]" />

<!-- Avatar placeholder -->
<Skeleton class="size-12 rounded-full" />

<!-- Card placeholder -->
<div class="flex flex-col space-y-3">
  <Skeleton class="h-[125px] w-[250px] rounded-xl" />
  <div class="space-y-2">
    <Skeleton class="h-4 w-[250px]" />
    <Skeleton class="h-4 w-[200px]" />
  </div>
</div>
```

---

## Sonner (Toast)

```bash
npx shadcn-svelte@latest add sonner
```

### Setup (root layout)

```svelte
<!-- +layout.svelte -->
<script lang="ts">
  import { Toaster } from "$lib/components/ui/sonner/index.js";
  let { children } = $props();
</script>

<Toaster />
{@render children?.()}
```

### Usage

```svelte
<script lang="ts">
  import { toast } from "svelte-sonner";
</script>

<!-- Basic types -->
toast("Default message")
toast.success("Saved successfully")
toast.error("Something went wrong")
toast.warning("Are you sure?")
toast.info("FYI")

<!-- With description and action -->
toast("Event created", {
  description: "Sunday, December 03, 2023 at 9:00 AM",
  action: {
    label: "Undo",
    onClick: () => console.info("Undo"),
  },
})

<!-- Promise-based -->
toast.promise(fetchData(), {
  loading: "Loading...",
  success: "Data loaded",
  error: "Failed to load",
})
```

---

## Combobox (Popover + Command Pattern)

```bash
npx shadcn-svelte@latest add popover command
```

Not a standalone component — built by composing Popover and Command. See SKILL.md for full implementation pattern.

**Key state variables:**
- `let open = $state(false)` — popover visibility
- `let value = $state("")` — selected value
- `let triggerRef = $state<HTMLButtonElement>(null!)` — focus management
- `const selectedLabel = $derived(items.find(i => i.value === value)?.label)` — display text

---

## Table (Basic)

```bash
npx shadcn-svelte@latest add table
```

```svelte
import * as Table from "$lib/components/ui/table/index.js";
```

### Sub-components

`Table.Root`, `Table.Header`, `Table.Body`, `Table.Footer`, `Table.Row`, `Table.Head`, `Table.Cell`, `Table.Caption`

### Example

```svelte
<Table.Root>
  <Table.Caption>Recent invoices</Table.Caption>
  <Table.Header>
    <Table.Row>
      <Table.Head>Invoice</Table.Head>
      <Table.Head>Status</Table.Head>
      <Table.Head class="text-right">Amount</Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each invoices as invoice (invoice.id)}
      <Table.Row>
        <Table.Cell class="font-medium">{invoice.id}</Table.Cell>
        <Table.Cell>{invoice.status}</Table.Cell>
        <Table.Cell class="text-right">{invoice.amount}</Table.Cell>
      </Table.Row>
    {/each}
  </Table.Body>
  <Table.Footer>
    <Table.Row>
      <Table.Cell colspan={2}>Total</Table.Cell>
      <Table.Cell class="text-right">$2,500.00</Table.Cell>
    </Table.Row>
  </Table.Footer>
</Table.Root>
```

For sorting, filtering, pagination — use Data Table with TanStack Table. See SKILL.md.

---

## Complete Component List (50+)

Accordion, Alert, Alert Dialog, Aspect Ratio, Avatar, Badge, Breadcrumb, Button, Button Group, Calendar, Card, Carousel, Chart, Checkbox, Collapsible, Combobox, Command, Context Menu, Data Table, Date Picker, Dialog, Drawer, Dropdown Menu, Empty, Field, Form, Hover Card, Input, Input Group, Input OTP, Item, Kbd, Label, Menubar, Navigation Menu, Pagination, Popover, Progress, Radio Group, Range Calendar, Resizable, Scroll Area, Select, Separator, Sheet, Sidebar, Skeleton, Slider, Sonner, Spinner, Switch, Table, Tabs, Textarea, Toggle, Toggle Group, Tooltip.

Install any component: `npx shadcn-svelte@latest add <name>`
