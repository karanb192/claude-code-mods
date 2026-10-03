# Build a mod: shape check and files (Build steps 2 and 3)

Read at step 2, after the person said yes to the plan. Step 2 turns every name in the plan into a line in the types; step 3 writes the files. Every code template below was validated with `--strict`, loaded headlessly, typechecked and tested on the build in its stamp. Stamp legend: sources.md.

## 1. Where the files go

Write into the directory the person named, or `./<name>/` in the current workspace. That rule comes before every other instruction in this file.

- Never write under `~/.claude/`. The in-session folder `~/.claude/dev-mods/<session-id>/<name>/` belongs to the in-session flow (sources.md): its first save asks the person "Enable for this session" in the middle of a turn, the mod loads only in the session that made it, and the folder is deleted once it is older than `cleanupPeriodDays`. Only when the person asks to try the mod live in this session: say the folder is temporary, write there, and copy the result into the workspace at handoff. [src: docs create > Ask Claude for a mod; docs create > Use the mod in other sessions | checked 2.1.288 | recheck: that page moves the folder or drops the prompt]
- The skill never installs, enables or copies a mod anywhere else. Promotion is the person's call.
- Name: the validator refuses a plugin name that starts with `claude-`, `anthropic-`, `anthropics-` or `cc-plugin-`. [src: observed (validate) | checked 2.1.288 | recheck: a validate run prints a name refusal not quoted in limits.md]

## 2. Shape check (step 2)

The skill never restates a shape: input fields, result arms, options, props. Read each from the types the gate printed (`<types>` below is that folder: a mod's `.claude-plugin/types/` after a load, or the harness cache). Every `$` method is also an event of the same name, so one recipe covers both.

```sh
D=<types>/claude-code/index.d.ts
grep -n "'tool.call': " "$D"            # 1st hit: input type with its doc comment above; 2nd: result type
grep -n "'store.get': " "$D"            # a $ method: 1st hit its argument, 2nd its value (OpValueOf)
grep -n "^      agent: {" "$D" | head -1  # the noun on $; read down to the method and its doc comment
grep -nE "export (type|interface) PaneOpenArgs\b" "$D"   # any named type
grep -n "export type RenderPropsOf" "$D"   # render-site props; find the component's key below it
grep -n "export type Elements = " "$D"     # element tables, one per surface
grep -n "declare module 'claude-code/testing'" "$D"   # the test kit
grep -n "^ *Bash: " <types>/claude-code-tools/index.d.ts   # a built-in tool: 1st hit its input, 2nd its result
```

[src: observed (grep on the generated file) | checked 2.1.288 | recheck: a recipe line returns no hit]

Write the shapes list into the handoff, one row per plan item: the name, `file:line`, and the arm the mod uses (for example "tool.call, index.d.ts:NNNN, returns a deny"). A plan item with no row is not written. When the types and a docs page disagree, the types win. [src: docs create > Get type definitions for your version | checked 2.1.288 | recheck: that page changes its authority note]

## 3. The files (step 3)

| File | When | Notes |
|---|---|---|
| `.claude-plugin/plugin.json` | always | `types` only when the mod uses `$.state` or adds a noun |
| `hooks/hooks.json` | always | `modules` holds exactly one path, relative to this file |
| `hooks/register.ts` | always | `.tsx` only when it writes JSX; `.js`, `.mjs`, `.cjs`, `.jsx`, `.mts`, `.cts` also load |
| `types/index.d.ts` | `$.state` or a new noun | the contract; composing.md for nouns |
| `tests/register.test.ts` | always | any name ending `.test.ts` or `.test.tsx` runs |
| `README.md`, `DECISIONS.md` | always | templates below |
| `.gitignore` | always | `.claude-plugin/types/` |

[src: docs reference > Files; d.ts header (module suffixes, ES modules only) | checked 2.1.288 | recheck: gate prints drift touching Register]

No `tsconfig.json` from the skill. The first load writes `{ "extends": "./.claude-plugin/types/tsconfig.json" }` at the mod's root when none exists and never touches an existing one; commit that one line so an editor finds the types after a load. An older tsconfig that includes `.claude/types` makes `tsc` fail with `Cannot find module 'claude-code'`: replace it with the extends line. The types folder carries its own `.gitignore` of `*`; the mod's entry is belt and braces. [src: observed (load writes, tsc) | checked 2.1.288 | recheck: a load's `type root of` line lists different files]

`claude plugin init` scaffolds a different kind of plugin (command hooks), not a mod: write the files directly. [src: observed (init probe) | checked 2.1.288 | recheck: init writes a `modules` key]

## 4. Code the validator can read

The validator reads the module's source the way the engine does; a module it cannot read does not load. Each row gives the rule and the visible prefix of the refusal. Long refusals are cut by the validator itself with `… [+N chars]`: the tail is truncated, so match on the prefix. Every source-analysis refusal also ends with the reminder that `$` is always spelled in full at the call site.

<!-- api-check: ignore tool.calls, $.noun.method, $.noun -->

| Rule | Refusal (visible prefix) |
|---|---|
| Spell every call `$.noun.method(...)`; no `$[x]`, no `?.` on `$` | `a computed or optional member access on $` |
| Never bind a noun or `$` itself to a name, never destructure them | `$.ui is used as a value (a noun of $ bound, passed or read)`; `$ itself is bound to a name` |
| Pass `$` only to a function declared at the top level of the same file (the calls line then reads `(via name)`); never to a method, an inner function or an imported one | (refused at validate; the helpers `read` and `update` from `claude-code` are the exceptions) |
| Event names in `on` are string literals | `the event name passed to on() is not a string literal` |
| The event exists | `"tool.calls" is not an event` |
| One unmatched hook per event; add a matcher for a second | `on("session.start") is registered twice without a matcher; the first is at` (tail truncated) |
| No second `on` declared inside `register` | `"on" is declared again (shadowed)` |
| `import` declarations only, relative, inside the plugin; the one bare import is `claude-code`; ES modules, no `require` | `a dynamic import(); a hooks module imports its own files with an import declaration` (tail truncated) |
| `$.env.get` and `$.env.set` take a literal name | `$.env.get takes a literal name as its first argument` |
| `$.state` references use a literal plugin and key, declared in the contract | `<plugin>.<key> is not declared: the manifest's types contract must name it in interface PluginState` |
| The contract holds `declare module` and type or interface declarations only; no `export {}` | ``path "types": line N: `export` at the top level is followed by`` |
| `Client` module paths are string literals | (the `surface modules:` note lists them) |
| Telemetry hooks carry the `{ to: 'collector' }` matcher | (refused at validate) |

[src: observed (validate refusals); docs create > Check what Claude Code reads from your mod; docs reference > Telemetry | checked 2.1.288 | recheck: a validate run prints a refusal whose visible prefix is not in this table or limits.md]

Rules the validator does not catch:

- Type `register`: `import type { Register } from 'claude-code'`. Untyped, strict `tsc` fails with TS7006 while validate and load pass. A `.js` module types it with `/** @type {import('claude-code').Register} */`. [src: observed (tsc); d.ts header | checked 2.1.288 | recheck: tsc accepts an untyped register]
- Never name anything `h` or `Fragment`: both are the environment's globals in the hooks module and in surface modules. Write no `@jsx` pragma. A starter's `/** @jsx h */` and `/** @jsxFrag Fragment */` are harmless and may be deleted; a pragma naming any other factory is a defect even though nothing refuses it, because it retargets the JSX and hides `<Client>` tags from the footprint. [src: observed (pragma probe) and the global h doc comment in claude-code/index.d.ts | checked 2.1.288 | recheck: a .tsx probe with /** @jsx h */ fails validate or load, or the h doc comment changes]
- `$.ui.resolve(e)` returns the element table synchronously: never `await` it. [src: d.ts ui noun resolve | checked 2.1.288 | recheck: gate prints drift touching $.ui.resolve]
- `e` is frozen: pass a copy to `next`. Call `next(e)` once per time core should act; a second `next(e)` on `tool.call` is a retry; a hook that returns while its `next` is pending aborts what runs beneath. [src: d.ts EngineEventOf tool.call, Next; docs events > Handle a hook that fails | checked 2.1.288 | recheck: gate prints drift touching Next]
- Give `.catch` to any hook whose failure must not pass silently, and know its grace is 1 s. A guard fails closed by answering a deny there. [src: d.ts HookBudget catchMs | checked 2.1.288 | recheck: api-check prints SHAPE DRIFT budget.catchMs]
- Register commands last in `session.start`, or inside `try`: a refused name throws and skips the rest of the hook. [src: docs test > Follow the test kit's rules (a rejected call skips the rest of the hook) | checked 2.1.288 | recheck: a test shows the hook continuing after a refused register]
- Comment only a non-obvious constraint or a reason; never narrate what a line does. Decided; no source.
- Never write `$.state` inside a render hook; write from a press handler or another event. No timer globals: use `$.clock`. [src: d.ts state noun; docs api > Run work in the background | checked 2.1.288 | recheck: gate prints drift touching $.state.set]

## 5. Templates

Replace `MOD_NAME`, `AUTHOR` and the text in capitals. Each is the shape the stamp names as checked; the test for it is in testing.md.

`.claude-plugin/plugin.json`. Drop `types` when the mod has no `$.state` and adds no noun. Drop `userConfig` when it takes no options. A `userConfig` field needs `type`, `title` and `description`; without `title` the validator refuses it. Missing `author` is a warning, which `--strict` (and so prove.mjs) treats as an error. Options and dependencies: composing.md. [src: observed (validate --strict on this template and without title or author); docs reference > Commands | checked 2.1.288 | recheck: a validate run accepts a field with no title]

```json
{
  "name": "MOD_NAME",
  "version": "0.1.0",
  "description": "ONE SENTENCE: what it does and what it reaches.",
  "author": { "name": "AUTHOR" },
  "license": "MIT",
  "types": "./types/index.d.ts",
  "userConfig": {
    "greeting": { "type": "string", "title": "Greeting", "description": "Word logged when the mod starts", "default": "loaded" }
  }
}
```

`hooks/hooks.json`. Settings hooks may sit beside `modules` under `hooks`. A file with no `modules` key makes validate pass with no `hooks:` line.

```json
{
  "description": "MOD_NAME: EVENTS_HOOKED",
  "modules": ["./register.ts"]
}
```

`types/index.d.ts`, the state contract. The outer key is the plugin's name.

```ts
declare module 'claude-code' {
  interface PluginState {
    'MOD_NAME': { count: number }
  }
}
```

`hooks/register.ts`: typed, reads options, keeps a count in `$.state`, saves it to `$.store` on every change, reloads it after `/clear`, guards one tool with a matcher, fails closed, answers a command.

```ts
import type { Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

const count = atom({ plugin: 'MOD_NAME', key: 'count' } as const, 0)

export const register: Register = (on, options) => {
  const greeting = typeof options.greeting === 'string' ? options.greeting : 'loaded'
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    $.ui.log(`MOD_NAME ${greeting} in ${e.cwd}`)
    await $.command.register({ name: 'MOD_NAME', description: 'Show how many Bash calls ran' })
    return started
  })
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const saved = await $.store.get('count')
    if (typeof saved === 'number') await update($, count, () => saved)
    return next(e)
  })
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (typeof e.command === 'string' && e.command.includes('rm -rf /')) return { deny: 'MOD_NAME refused rm -rf /' }
    const n = await update($, count, c => c + 1)
    await $.store.set('count', n)
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'MOD_NAME could not check this call' }))
  on('command.run', { command: 'MOD_NAME' }, async $ => ({ text: `Bash calls: ${await read($, count)}` }))
}
```

Its footprint: `hooks: session.start, classic.SessionStart{source=clear|resume|fork}, tool.call{tool=Bash}, command.run{command=MOD_NAME}`; `calls: $.command.register, $.state.get, $.state.set, $.store.get, $.store.set, $.ui.log` (the `read` and `update` helpers print as `$.state.get` and `$.state.set`); `state reads` and `state writes` name `MOD_NAME.count`; the manifest notes say the contract declares that key. Reach L0. [src: observed (validate, load, tsc, plugin test of this template) | checked 2.1.288 | recheck: prove.mjs fails any stage on this template]

`.gitignore`: two lines, `.claude-plugin/types/` and `node_modules/`.

`README.md`. The version triple is three different facts: the build the mod was written against (line 1 of the generated `index.d.ts` at the first load), the build the proof block ran on, and the floor the gate printed. The reach section is pasted from the footprint and the threat model, never written from intent.

```markdown
# MOD_NAME
ONE SENTENCE.
Built on Claude Code BUILT_ON. Proven on BUILD_IN_PROOF_BLOCK (stages: STAGES_THAT_PASSED). Requires Claude Code FLOOR or later.

## What it can reach

    ❯ ./register.ts hooks: EVENTS
    ❯ ./register.ts calls: CALLS

Reach LEVEL. THREAT_MODEL_FIVE_LINES

## Install

One session: `claude --plugin-dir ./MOD_NAME`. To keep it, install it from a marketplace, then run `/reload-plugins` in an open session. Installed copies are cached by version: bump `version` before reinstalling.

## Options
OPTION: what it changes, its default. Stored under `pluginConfigs` in settings; a change reloads the mod.
## Limitations
What it does not catch, by name. Where it draws nothing (the VS Code panel, `claude -p`, the SDK, cloud sessions) and what it does there instead.
## Uninstall
Disable it in `/plugin`. It leaves: STORE_KEYS_AND_FILES, or nothing.
```

`DECISIONS.md`. The assumptions list is the honest part: every assumption the proof did not cover, with what breaks if it is wrong.

```markdown
# Decisions: MOD_NAME

## Decisions
- DECISION. Rejected: ALTERNATIVE, because REASON.
## Assumptions not verified
- ASSUMPTION. If wrong: CONSEQUENCE. How to check: COMMAND OR PROBE.
```

[src: docs create > Share your mod (say which version you tested with; cached by version); docs reference > Settings and environment variables | checked 2.1.288 | recheck: that page changes its sharing or caching lines]
