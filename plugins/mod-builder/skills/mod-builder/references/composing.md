# Composing mods

Read when a mod adds a noun to `$`, calls another mod's noun, shares `$.state` with another mod, takes options, or must survive an organisation's policy. A single-file mod meets none of these. Stamp legend: sources.md.

<!-- api-check: ignore $.memo, $.memo.remember, memo.remember -->

## Add a noun to `$`

`engine.create` is the fold that builds `$`, once per load or reload, core innermost. A hook is written in post-order: `const built = await next(e)` is `$` as built so far, and the hook returns it with its own noun added. A step may add nouns and withhold nouns; it may never replace a noun another step added (the step fails, naming both plugins, and its plugin unloads). Inside that hook `$` is the empty table, so any `$` call there is a compile error. The hook has no budget and takes no `.catch`; its failure is the load's. [src: d.ts EngineEventOf engine.create, EngineCreateInput, NoEngineInterface, Registration | checked 2.1.288 | recheck: gate prints drift touching EngineCreateInput]

```ts
import type { Register } from 'claude-code'
import type { Memo } from '../types/index.d.ts'

export const register: Register = on => {
  const notes = new Map<string, string>()
  on('engine.create', async (_$, e, next) => {
    const built = await next(e)
    const memo: Memo = { remember: async input => { notes.set(input.key, input.text) } }
    return { ...built, memo }
  })
}
```

The contract is `types/index.d.ts`, named by `"types": "./types/index.d.ts"` in plugin.json: one self-contained declaration file with no import or reference, its exported names led by the noun's PascalCase name, declaring the noun on `EngineInterface`. Exported types are allowed; a bare `export {}` is refused. The validator then prints `types ./types/index.d.ts declares on $: $.memo`. [src: d.ts header (contract rules); observed (validate) | checked 2.1.288 | recheck: a validate run prints a different declares line]

```ts
export type Memo = { remember(input: MemoRemember): Promise<void> }
export type MemoRemember = { key: string; text: string }

declare module 'claude-code' {
  interface EngineInterface { memo: Memo }
}
```

Rules for a noun, from the built-in mods' own practice:

- The contract is the only declaration of the noun. The mod's hooks import its types from the folder, and the value `engine.create` returns is checked against `EngineInterface`, so the implementation cannot drift from what callers read.
- Every method on the noun is an event: the contract above also types a hook on the `remember` event of `memo`, with `e` its argument and the result its return.
- Two plugins that give one event two different types do not compile together.
- A test of a mod that calls another's noun seats a provider: an inline plugin whose `engine.create` hook adds the noun. With no provider loaded, the `$` build refuses the hook and names the noun nobody provides. A test of the provider seats an inline caller instead.

[src: mods/README.md in the claude-code repository > Composing mods: noun contracts; observed (provider and caller tests) | checked 2.1.288 | recheck: a provider test built this way fails]

## Depend on another mod

List the provider under `dependencies` in the dependent's plugin.json. Each load from a folder the person owns lays the provider's contract into the dependent's `.claude-plugin/types/<provider>/index.d.ts`, which the generated tsconfig already covers, so the noun is typed on the dependent's `$`. Never copy the contract, and never point a tsconfig at the provider's folder. Among installed mods a mod runs before the mods it lists under `dependencies`; the debug log prints the order as `hooks module order: dependencies register <dependent>@inline, <provider>@inline`. [src: docs create > Get type definitions for your version; docs events > The order mods run in; observed (two --plugin-dir loads, tsc) | checked 2.1.288 | recheck: a load stops writing `.claude-plugin/types/<provider>/`]

A call on another mod's noun appears in the dependent's `calls:` line; the reach grader has no rule for it, so grade it by hand from the provider's footprint and say so in the plan.

## Share `$.state` between mods

- Any plugin reads any value; only its owner writes it. Another plugin changes a value by hooking `state.set` with a matcher on the plugin and the key, then passing `next` another value: it can contribute, veto or observe. The reference is pinned; only the value is rewritten. [src: d.ts state noun ("its owner alone writes it"), OpEventOf state.set | checked 2.1.288 | recheck: api-check prints SHAPE DRIFT state.ownerOnly]
- Read back what landed: a hook above may have rewritten the value, and a write with `ifVersion` can miss, so `$.state.set` answers only whether it landed and the version; a `$.state.get` reads what stands. [src: d.ts StateSetResult | checked 2.1.288 | recheck: gate prints drift touching StateSetResult]
- To read another plugin's value with types, its `PluginState` declaration must reach your types: list it under `dependencies`.
- Keys print as `<plugin>.<key>` in `state reads:` and `state writes:`, and the plan's `State:` line lists them.

## The organisation's three control points

- Which mods load: a `plugin.register` hook. It reads where the mod would run and what its module uses, the calls spelled `noun.method` (`process.run`), without the `$.` the validator prints, and may refuse it. A check that throws fails open: add a `.catch` that refuses user-tier mods so it fails closed. [src: docs admin > Enforce a policy with a mod of your own; docs admin > Refuse mods when your check fails; d.ts PluginRegisterUses | checked 2.1.288 | recheck: gate prints drift touching PluginRegisterUses]

```ts
import type { Register } from 'claude-code'

const BLOCKED = ['process.run', 'process.spawn']

export const register: Register = on => {
  on('plugin.register', async ($, e, next) => {
    const hit = e.uses.calls.filter(call => BLOCKED.includes(call))
    if (e.tier === 'user' && hit.length > 0) return { refuse: `mods may not call ${hit.join(', ')}` }
    return next(e)
  }).catch(async ($, e, next) => (e.tier === 'user' ? { refuse: 'policy check failed' } : next(e)))
}
```

- Which nouns exist: an `engine.create` hook. Managed plugins come first in the fold, so an organisation's withholding wins.
- What every mod does: a hook on any call by name (a hook on `fs.write` sees every `$.fs.write` another mod makes) or on `*`, at the top of every chain. `*` does not select `telemetry.*`. [src: docs admin > Enforce a policy with a mod of your own; docs reference > Telemetry | checked 2.1.288 | recheck: gate prints drift touching the glob rules]

```ts
on('*', ($, e, next) => {
  $.ui.log(`${next.origin.plugin} raised ${next.event}`, { to: 'debug' })
  return next(e)
})
```

Placement is the mechanism. Managed `prependPlugins` and `appendPlugins` (read from managed settings, never a repository's) put the organisation's mods before or after every mod a person installs; only a mod in one of them can call `next.to`. Setting `prependPlugins` replaces the default, so it must name `sec-default@builtin` to keep the built-in guard. [src: docs reference > Settings and environment variables; docs admin > Install your organization's mods and set the order | checked 2.1.288 | recheck: either section changes]

A mod written for other people expects all three: a plugin above may withhold a noun it calls, deny an event it raises, or refuse it at `plugin.register`. Treat a deny, a missing noun and a refusal as normal outcomes, never as bugs.

## Options from the manifest

`register(on, options)` receives the values of the fields the manifest's `userConfig` declares, defaults filled in, validated against each field's type before the module loads; read install-time settings here, never through `$.env.get`. The values live in settings under `pluginConfigs`, keyed by the plugin id (`<name>@<marketplace>`), or `<name>@inline` for `--plugin-dir`; sensitive ones go to secure storage. Each non-secret field is a `/config` row, and a change reloads the module with the new options. A string field that lists `options` is a picker, and a stored value outside the list counts as unset. A required field with no value fails the load with `options do not fit plugin.json userConfig`. Tests pass values with `test(name, { options }, body)`. The value types: `PluginOptions`. [src: d.ts PluginOptions, Register; docs reference > Settings and environment variables; docs troubleshoot > `options do not fit plugin.json userConfig` | checked 2.1.288 | recheck: gate prints drift touching PluginOptions]

A field needs `type`, `title` and `description` (without `title` the validator refuses it); build.md has a manifest that passes. The plugins manifest reference is the contract for the rest of the field. [src: observed (validate) | checked 2.1.288 | recheck: a validate run accepts a field with no title]
