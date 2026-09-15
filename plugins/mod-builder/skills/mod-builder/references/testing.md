# Testing a Mod

Anthropic's built-in Mods use `claude-code/testing`. The Mod under test loads
above the hooks a test registers with `on`, so those test hooks are the world
below the Mod. Each `$` call the Mod makes reaches them. If no test hook
answers an event, the test kit throws and names that event.

Use the current binary's generated types and the built-in Mods README when a
test API changes. This file gives the smallest useful shapes, not a substitute
for the runtime contract.

## File layout and command

Put a test in `tests/` and name it after the source it covers:

```
hooks/register.ts
tests/register.test.ts
```

Run it with:

```sh
claude plugin test <mod-dir>
```

The current type declarations accept `prepend`, `user`, `append` and `builtin`.
A normal installed Mod uses `user`. Use
another tier only when the test needs to prove tier-specific behaviour.

## Minimal event test

This test drives a `session.start` hook and supplies the core answer beneath
the Mod. Replace the imports and event shape only after checking
`/plugin-types`.

```ts
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

describe('register', () => {
  test('reports that the Mod loaded', async ($, on) => {
    const lines: string[] = []

    on('ui.log', ($, e) => {
      lines.push(e.text)
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))

    await $.session.start({
      surface: 'terminal',
      isInteractive: true,
      cwd: '/work',
    })

    expect(lines).toContain('MOD_NAME loaded in /work')
  })
})
```

## Test a denial or rewrite

Drive the public engine call. Register the core answer only for the path that
should be allowed. The assertion proves that the Mod stopped or changed the
right thing without running a real command.

```ts
test('refuses the dangerous Bash command', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, ($, e) => ({ result: e.command }))

  await expect(
    $.tool.call({ tool: 'Bash', command: 'rm -rf /' }),
  ).resolves.toMatchObject({ deny: expect.any(String) })
})
```

The exact result shape is event-specific. Check the generated types before
copying the assertion. Test both the denied and allowed path whenever the Mod
changes an event.

## Test time without waiting

Use the official clock mock for a Mod that uses `$.clock.sleep`, `after` or
`every`. Start the operation, settle the hooks, then advance only the time the
test needs.

```ts
test('updates after one tick', async ($, on) => {
  const clock = mock.clock(on)
  const lines: string[] = []

  on('ui.log', ($, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  const starting = $.session.start({
    surface: 'terminal',
    isInteractive: true,
    cwd: '/work',
  })
  await clock.settle()
  await clock.advance(1_000)
  await starting

  expect(lines).toContain('MOD_NAME ticked')
})
```

Add `mock` to the import in this example. Use `mock.env(on, variables)` for
environment reads and `mock.store(on, entries)` for persisted state. Keep
fixtures under `tests/fixtures/` only after more than one test needs them.

## What every test should prove

| Mod behaviour | Minimum assertion |
|---|---|
| Event change or denial | The denied and allowed result. |
| Process, file or network call | Literal argv, path or host received by the lower hook. |
| State | Stored value after the user-visible action. |
| UI | Rendered text or the action from `$.ui.press`; do not assert pixels. |
| Time | State before and after `clock.advance`. |

Tests do not replace `claude plugin validate`. Run both: tests prove a chosen
behaviour, while validation declares the complete reach and visibility.
