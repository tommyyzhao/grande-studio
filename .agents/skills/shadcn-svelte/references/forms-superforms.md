# shadcn-svelte: Forms with sveltekit-superforms + Zod

## Overview

shadcn-svelte's Form components integrate with **sveltekit-superforms** for validation and **Zod** for schema definition. The form components (powered by Formsnap) handle accessibility, ARIA attributes, and error display.

## Dependencies

```bash
npm i -D sveltekit-superforms zod
npx shadcn-svelte@latest add form input label
```

## Architecture

```
Schema (Zod) → Server Load (superValidate) → Client (superForm) → shadcn Form Components
                                            ↓
                                Server Action (validate + process)
```

## End-to-End Implementation

### 1. Define Schema

```typescript
// src/routes/settings/schema.ts
import { z } from "zod";

export const formSchema = z.object({
  username: z.string().min(2, "Username must be at least 2 characters").max(50),
  email: z.string().email("Invalid email address"),
  bio: z.string().max(160).optional(),
  role: z.enum(["admin", "user", "editor"]),
  notifications: z.boolean().default(false),
});

export type FormSchema = typeof formSchema;
```

### 2. Server Load Function

```typescript
// src/routes/settings/+page.server.ts
import type { PageServerLoad, Actions } from "./$types.js";
import { superValidate } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import { formSchema } from "./schema";
import { fail } from "@sveltejs/kit";

export const load: PageServerLoad = async () => {
  // Empty form with defaults from schema
  return {
    form: await superValidate(zod4(formSchema)),
  };
};

// With existing data (e.g., edit form)
export const load: PageServerLoad = async ({ params }) => {
  const user = await db.getUser(params.id);
  return {
    form: await superValidate(user, zod4(formSchema)),
  };
};
```

### 3. Server Action

```typescript
// src/routes/settings/+page.server.ts (continued)
export const actions: Actions = {
  default: async (event) => {
    const form = await superValidate(event, zod4(formSchema));

    if (!form.valid) {
      return fail(400, { form });
    }

    // Process validated data
    await db.updateUser(form.data);

    return { form };
  },
};
```

### 4. Form Component

```svelte
<!-- src/routes/settings/settings-form.svelte -->
<script lang="ts">
  import * as Form from "$lib/components/ui/form/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { formSchema, type FormSchema } from "./schema";
  import {
    type SuperValidated,
    type Infer,
    superForm,
  } from "sveltekit-superforms";
  import { zod4Client } from "sveltekit-superforms/adapters";

  let { data }: { data: { form: SuperValidated<Infer<FormSchema>> } } = $props();

  const form = superForm(data.form, {
    validators: zod4Client(formSchema),
  });

  const { form: formData, enhance } = form;
</script>

<form method="POST" use:enhance>
  <!-- Text input -->
  <Form.Field {form} name="username">
    <Form.Control>
      {#snippet children({ props })}
        <Form.Label>Username</Form.Label>
        <Input {...props} bind:value={$formData.username} />
      {/snippet}
    </Form.Control>
    <Form.Description>Your public display name.</Form.Description>
    <Form.FieldErrors />
  </Form.Field>

  <!-- Email input -->
  <Form.Field {form} name="email">
    <Form.Control>
      {#snippet children({ props })}
        <Form.Label>Email</Form.Label>
        <Input {...props} bind:value={$formData.email} type="email" />
      {/snippet}
    </Form.Control>
    <Form.FieldErrors />
  </Form.Field>

  <!-- Textarea -->
  <Form.Field {form} name="bio">
    <Form.Control>
      {#snippet children({ props })}
        <Form.Label>Bio</Form.Label>
        <Textarea {...props} bind:value={$formData.bio} placeholder="Tell us about yourself" />
      {/snippet}
    </Form.Control>
    <Form.Description>Max 160 characters.</Form.Description>
    <Form.FieldErrors />
  </Form.Field>

  <!-- Select -->
  <Form.Field {form} name="role">
    <Form.Control>
      {#snippet children({ props })}
        <Form.Label>Role</Form.Label>
        <Select.Root type="single" bind:value={$formData.role} name={props.name}>
          <Select.Trigger {...props} class="w-[200px]">
            {$formData.role || "Select a role"}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="admin">Admin</Select.Item>
            <Select.Item value="user">User</Select.Item>
            <Select.Item value="editor">Editor</Select.Item>
          </Select.Content>
        </Select.Root>
      {/snippet}
    </Form.Control>
    <Form.FieldErrors />
  </Form.Field>

  <!-- Switch/Checkbox -->
  <Form.Field {form} name="notifications">
    <Form.Control>
      {#snippet children({ props })}
        <div class="flex items-center gap-2">
          <Switch {...props} bind:checked={$formData.notifications} />
          <Form.Label>Enable notifications</Form.Label>
        </div>
      {/snippet}
    </Form.Control>
    <Form.FieldErrors />
  </Form.Field>

  <Form.Button>Save changes</Form.Button>
</form>
```

### 5. Page Component

```svelte
<!-- src/routes/settings/+page.svelte -->
<script lang="ts">
  import SettingsForm from "./settings-form.svelte";
  let { data } = $props();
</script>

<div class="max-w-2xl mx-auto py-8">
  <h1 class="text-2xl font-bold mb-6">Settings</h1>
  <SettingsForm {data} />
</div>
```

## Form Component Anatomy

| Component | Purpose | Required |
|-----------|---------|----------|
| `Form.Field` | Scopes form state for a named field | Yes |
| `Form.Control` | Renders control with correct ARIA attributes | Yes |
| `Form.Label` | Accessible label linked to control | Yes |
| `Form.Description` | Helper text below input | No |
| `Form.FieldErrors` | Displays validation errors for the field | Yes |
| `Form.Button` | Submit button (disabled during submission) | Yes |

## Critical Pattern: The children Snippet

`Form.Control` passes `{ props }` via a `children` snippet. You **must** spread `{...props}` on the input element:

```svelte
<Form.Control>
  {#snippet children({ props })}
    <Form.Label>Field Name</Form.Label>
    <Input {...props} bind:value={$formData.fieldName} />
  {/snippet}
</Form.Control>
```

The `props` object contains `id`, `aria-describedby`, `aria-invalid`, and other accessibility attributes. Without spreading, the form loses ARIA bindings.

## superForm Options

```typescript
const form = superForm(data.form, {
  // Client-side validation
  validators: zod4Client(formSchema),

  // Prevent full page reload
  // (use:enhance already handles this)

  // Reset form after successful submit
  resetForm: true,

  // Scroll to first error
  scrollToError: "smooth",

  // Custom error handling
  onError: ({ result }) => {
    toast.error("Something went wrong");
  },

  // After successful update
  onUpdated: ({ form }) => {
    if (form.valid) {
      toast.success("Settings saved");
    }
  },
});
```

## Destructured Stores

```typescript
const {
  form: formData,    // Writable store of form data ($formData.fieldName)
  errors,            // Validation errors ($errors.fieldName)
  constraints,       // HTML validation constraints
  message,           // Status messages from server
  enhance,           // Progressive enhancement action
  submitting,        // Boolean: is form submitting?
  delayed,           // Boolean: submission taking long?
  timeout,           // Boolean: submission timed out?
} = superForm(data.form, options);
```

## Multiple Forms on One Page

Each form needs a unique schema ID:

```typescript
// schema.ts
export const loginSchema = z.object({ /* ... */ });
export const registerSchema = z.object({ /* ... */ });

// +page.server.ts
export const load = async () => ({
  loginForm: await superValidate(zod4(loginSchema), { id: "login" }),
  registerForm: await superValidate(zod4(registerSchema), { id: "register" }),
});

export const actions = {
  login: async (event) => {
    const form = await superValidate(event, zod4(loginSchema));
    // ...
  },
  register: async (event) => {
    const form = await superValidate(event, zod4(registerSchema));
    // ...
  },
};
```

```svelte
<!-- Use named actions -->
<form method="POST" action="?/login" use:loginEnhance>
  <!-- login form fields -->
</form>

<form method="POST" action="?/register" use:registerEnhance>
  <!-- register form fields -->
</form>
```

## Validation Adapters

superforms supports multiple validators. For Zod with shadcn-svelte:

```typescript
// Server-side
import { zod4 } from "sveltekit-superforms/adapters";
await superValidate(zod4(schema));

// Client-side
import { zod4Client } from "sveltekit-superforms/adapters";
superForm(data.form, { validators: zod4Client(schema) });
```

**Note:** The `zod4` adapter is for Zod v4+. For older Zod versions, use `zod` adapter instead.

## Error Display Patterns

### Field-Level Errors

```svelte
<Form.FieldErrors />
<!-- Automatically displays errors for the parent Form.Field -->
```

### Custom Error Display

```svelte
<Form.Field {form} name="email">
  <Form.Control>
    {#snippet children({ props })}
      <Form.Label>Email</Form.Label>
      <Input {...props} bind:value={$formData.email}
        class={$errors.email ? "border-destructive" : ""} />
    {/snippet}
  </Form.Control>
  <Form.FieldErrors class="text-sm text-destructive" />
</Form.Field>
```

### Form-Level Errors

For cross-field validation (e.g., password confirmation):

```typescript
const schema = z.object({
  password: z.string().min(8),
  confirm: z.string(),
}).refine((data) => data.password === data.confirm, {
  message: "Passwords don't match",
  path: ["confirm"],
});
```
