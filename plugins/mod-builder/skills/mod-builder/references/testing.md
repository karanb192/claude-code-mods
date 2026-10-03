# Test a mod (Build step 5)

Read at step 5. The output is at least one test file on the official kit that fails when the behaviour changes, seen failing once, plus a gate test when the plan has a gate. Every code block below passed `tsc -p` and `claude plugin test` on the build in its stamp. Stamp legend: sources.md.

<!-- api-check: ignore $.session.start, $.classic.SessionStart, $.ui.mount, $.ui.press, $.turn.step, $.turn.complete -->

## 1. Kit rules

- Files: any name ending `.test.ts` or `.test.tsx`, anywhere in the plugin; each needs at least one `test()` or the run fails with `declares no test(): nothing ran`. Name a file after the source it covers (`tests/register.test.ts` for `hooks/register.ts`); that is a convention, not a rule. [src: docs test > Write a test | checked 2.1.288 | recheck: claude plugin test --help changes its file pattern]
- Run: `claude plugin test <mod-dir>`, no session, login or network. Exit 1 on a failing test, on a file with no `test()`, on a mod with no test files (`no *.test.ts or *.test.tsx under`), on a folder with no mod (`no hooks module to load`), and when mods are off in this shell (`hooks modules are turned off` plus the reason). Output: a `(pass)` or `(fail)` line per test, then ` N pass`, ` N fail`, `Ran N tests across M files.`; a failure carries a block headed `the engine reported:`. [src: docs test > Write a test; docs test > Stub what Claude Code would answer; observed (output format) | checked 2.1.288 | recheck: the output stops matching what prove.mjs parses]
- The test's `$` is the engine's own (`Engine` in `claude-code/testing`): each call fires the event of the same name through the mod's hooks. `on` registers stubs that sit beneath every plugin, and nothing is beneath them. A test cannot fire a mods API call such as `ui.close` directly; drive it through the mod. [src: d.ts testing module TestBody, Engine | checked 2.1.288 | recheck: gate prints drift touching TestBody]
- Register every stub before the first call on `$`; a late one throws `on("ui.render") after the test first called $`. The mods load at that first call, so a `plugin.register` refusal throws there. `session.start` does not run by itself: stub what its hook calls, then fire it. [src: docs test > Follow the test kit's rules; d.ts TestBody | checked 2.1.288 | recheck: a late on() stops throwing]
- An unanswered call does not throw in the test. It rejects inside the mod with `no implementation for <name>`, the kit skips that hook (nothing after the call runs), and the test fails only at a later assertion, with the skip listed under `the engine reported:`. Assert on what the hook should have done, never only on "no throw". [src: docs test > Follow the test kit's rules | checked 2.1.288 | recheck: an unstubbed call fails the test at the call]
- A render hook that returns `next(e)` needs a `ui.render` stub, or mounting fails with `no implementation for ui.render`. [src: docs test > Follow the test kit's rules | checked 2.1.288 | recheck: mounting without the stub succeeds]
- The kit answers `$.ui.invalidate` and `$.state` itself, and every test starts with `$.state` at its defaults. `$.clock` needs `mock.clock(on)`. `mock.store(on, entries)` and `mock.env(on, variables)` answer from memory; `mock.store` returns nothing, so write `store.get` and `store.set` stubs to inspect what was saved. [src: docs test > Look up what a stub returns; d.ts Mock | checked 2.1.288 | recheck: gate prints drift touching Mock]
- One test has 5 s unless `timeoutMs`. `tier()` once at the top of a file (`user` when unsaid). `test(name, { options }, body)` gives the plugin its `userConfig` values; `{ plugins }` loads inline plugins, which close over nothing of the test file. [src: d.ts TestOptions, test, tier, Plugin | checked 2.1.288 | recheck: gate prints drift touching TestOptions]
- `$.ui.ask` reaches a test as a `tool.call` for the AskUserQuestion tool. `$.tool.call` raises `classic.PreToolUse` beneath every plugin's `tool.call` hook and above the test's stubs. A `turn.step` stub is an async generator, and the test reads the stream to its end. [src: docs test > Look up what a stub returns; docs test > Follow the test kit's rules; d.ts EngineClassic | checked 2.1.288 | recheck: gate prints drift touching EngineClassic]

## 2. Stub shapes, by pointer

A stub for a `$` call returns `{ value }` (what the call resolves to in the mod) or `{ deny }` (the call rejects in the mod); a stub for an engine event returns that event's own result. Never copy a stub table: read the type. `grep -n "'command.register': " <types>/claude-code/index.d.ts` gives the call's argument (first hit) and, in `OpValueOf`, the value a stub wraps in `{ value }` (second hit); the same grep on an engine event such as `'tool.call': ` gives its input and the result a stub returns as is. Typecheck the tests (`tsc -p <mod-dir>` after one load); tsc names a wrong stub at once as not assignable to `OpEventResult<"...">`. At run time a bare value fails with `returned neither { value } nor { deny }`, and a stub returning `undefined` is skipped with `returned no result`. The docs table answers `command.register` with `{ value: undefined }`; tsc on the build in this stamp refuses that, because the value is the registered command. Trust tsc over any table. [src: docs test > Stub what Claude Code would answer; observed (tsc, kit run) | checked 2.1.288 | recheck: tsc accepts { value: undefined } for command.register]

## 3. Typed inputs, no casts

The test's `$` takes the full event input, pinned fields included: `$.agent.spawn` in a test wants an `AgentSpawnInput`, not the short argument a plugin passes. That is what lets a test drive a branch the plugin-side call cannot reach, such as a fork. Build inputs as typed values or a typed helper with `Partial` overrides, imported from `claude-code`; never `as any`. A cast keeps compiling after the shape changes; a typed literal fails tsc and names the field (on the build in this stamp, `PromptSubmitInput` requires `wait`). [src: observed (tsc) | checked 2.1.288 | recheck: tsc rejects the helper below on a new build]

```ts
import type { AgentSpawnInput } from 'claude-code'
const spawn = (over: Partial<AgentSpawnInput>): AgentSpawnInput => ({
  tool_use_id: 't1', prompt: 'worker task', description: 'worker', subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' }, parentModel: 'opus', background: false, fork: false, ...over,
})
```

## 4. Shapes that pass

The test for the build.md template: the start path with options, the denied and the allowed path, and the path after `/clear`.

```ts
import { describe, expect, mock, test } from 'claude-code/testing'
import type { CommandRunInput, SessionStartInput } from 'claude-code'

const start: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }
const run: CommandRunInput = {
  command: 'MOD_NAME', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
}

describe('register', () => {
  test('logs the configured greeting', { options: { greeting: 'ready' } }, async ($, on) => {
    const lines: string[] = []
    on('ui.log', ($, e) => { lines.push(e.text); return { value: undefined } })
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    await $.session.start(start)
    expect(lines).toEqual(['MOD_NAME ready in /work'])
  })
  test('refuses rm -rf / and lets ls through', async ($, on) => {
    mock.store(on)
    const ran: string[] = []
    on('tool.call', { tool: 'Bash' }, ($, e) => { ran.push(e.command); return { result: 'ok' } })
    await expect($.tool.call({ tool: 'Bash', command: 'rm -rf /' })).resolves.toMatchObject({ deny: 'MOD_NAME refused rm -rf /' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(ran).toEqual(['ls'])
  })
  test('the count comes back after /clear', async ($, on) => {
    on('store.get', () => ({ value: 7 }))
    on('classic.SessionStart', () => ({}))
    await $.classic.SessionStart({ source: 'clear' })
    expect((await $.command.run(run)).text).toBe('Bash calls: 7')
  })
})
```

Time without waiting, for a `/countdown N` command that toasts at zero from `$.clock.every`: start the work, then move the mock clock only as far as the assertion needs.

```ts
test('the toast comes at zero and not before', async ($, on) => {
  const clock = mock.clock(on)
  const toasts: string[] = []
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  await $.command.run({ command: 'countdown', args: '3', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await clock.advance(2000)
  const early = [...toasts]
  await clock.advance(1000)
  expect([early, toasts]).toEqual([[], ['Time is up']])
})
```

A drawing, on two surfaces, keeping what is beneath; then a gate. The mod draws `prompts: N` in the band above the prompt with a `reset` button, returns `next(e)` while the count is 0, and its `/MOD_NAME` command may only draft with `$.prompt.fill`. The props are the site's own: read `RenderPropsOf` for the component. The mount loop never defaults the surface; the kit checks the tree and its validity per surface, not how a surface paints it.

```ts
const BAND = { plugin: 'MOD_NAME', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const

test('the band draws on both surfaces, keeps what is beneath, and resets', async ($, on) => {
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['beneath'] }))
  await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' }, wait: false })
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: /^prompts: \d+$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: 'beneath' })).toBeDefined()
    await band.unmount()
  }
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'reset' })
  expect(await band.find({ type: 'Text', text: /^prompts:/ })).toBeUndefined()
})

test('gate: the command drafts and never submits', async ($, on) => {
  let submits = 0, fills = 0
  on('prompt.submit', ($, e) => { submits += 1; return { text: e.text } })
  on('prompt.fill', () => { fills += 1; return { isFilled: true } })
  await $.command.run({ command: 'MOD_NAME', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect([submits, fills]).toEqual([0, 1])
})
```

The `beneath` stub is the wrap test: a hook that should keep other mods' drawing must still show the stub's marker. A failing mount names the element or prop the surface refused: fix the tree, not the test. [src: docs test > Test a drawing; d.ts MountTarget, Mounted | checked 2.1.288 | recheck: gate prints drift touching MountTarget]

A policy mod, here one whose `plugin.register` hook refuses a user-tier mod that calls `process.run`, with the reason `mods may not call <calls>` (composing.md): load it as `prepend` and give each test a second mod to judge. The refusal throws at the first call on `$`, naming the refused mod, the mod that refused, and the reason.

```ts
import { expect, test, tier } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

tier('prepend')
const runner: Plugin = {
  name: 'runner',
  register: on => { on('tool.call', async $ => { await $.process.run(['ls']); return { result: 'runner answered' } }) },
}
const reader: Plugin = { name: 'reader', register: on => { on('tool.call', async () => ({ result: 'reader answered' })) } }

test('refuses a mod that starts a process', { plugins: [runner] }, async ($, on) => {
  on('tool.call', () => ({ result: 'core answered' }))
  await expect($.tool.call({ tool: 'Bash', command: 'ls' })).rejects.toThrow('runner: refused by MOD_NAME: mods may not call process.run')
})
test('admits a mod that starts nothing', { plugins: [reader] }, async ($, on) => {
  on('tool.call', () => ({ result: 'core answered' }))
  expect(await $.tool.call({ tool: 'Bash', command: 'ls' })).toEqual({ result: 'reader answered' })
})
```

[src: docs test > Test a policy mod; docs test > Test a timer; observed (all blocks in this section passed tsc and the kit) | checked 2.1.288 | recheck: prove.mjs test stage fails on a mod built from these blocks]

## 5. Seen failing

A test that cannot fail does not count. Before handoff, break the behaviour once (or the expected value), run `claude plugin test`, see the `(fail)` line and exit 1, restore it, and see it pass again. Record `seen failing: yes` with the failing line in the handoff, or `seen failing: no` and why. prove.mjs cannot know this; only the run you did on purpose can.

## 6. What every test should prove

| Mod behaviour | Minimum assertion |
|---|---|
| A denial or a rewrite | Both the denied and the allowed path. |
| A process, file or network call | The literal argv, path or host the stub received. |
| State | The stored value after the visible action, and after `classic.SessionStart` with source `clear`. |
| A drawing | Text found or a press result, on each surface it targets; never pixels. |
| Time | The state before and after the mock clock advances. |
| A gate | The count of calls to the forbidden method is 0. |

Tests do not replace `claude plugin validate`: tests prove a chosen behaviour, the validator lists the whole reach. Typecheck with `tsc -p <mod-dir>` after one load (the generated tsconfig includes `tests`), or `npx -y -p typescript tsc -p <mod-dir>`; never bare `npx tsc`, which installs an unrelated package. [src: observed (npx) | checked 2.1.288 | recheck: gate's typescript line changes route]
