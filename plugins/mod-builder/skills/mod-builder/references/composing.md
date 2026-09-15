# Composing mods

Three things the architecture paper and Anthropic's built-in mods README cover that a single-file mod never meets: adding a noun to `$`, an organization's control points, and options from the manifest. Section numbers refer to the paper attached to issue #91870.

## Add a noun to `$`

`engine.create` is the fold that builds `$` (4.1). Its bottom returns the empty table, the core step adds the primitives, and every plugin above adds its own nouns to what `next(e)` returned. A step adds nouns and may withhold them; it never replaces one, and a name once added belongs to the plugin that added it for the life of the fold. `engine.create` is the one event not reachable as `$.noun.event`.

```ts
on('engine.create', async ($, e, next) => {
  const below = await next(e)
  return { ...below, cache: createCache(below) }
})
```

Types come by declaration merging into `EngineInterface` (4.3). Keep the contract in `types/index.d.ts`, a declaration file with no imports that exports the noun's types and declares the noun:

```ts
declare module 'claude-code' {
  interface EngineInterface { cache: Cache }
  interface Cache { evict(input: { key: string }): Promise<void> }
}
```

Rules, from the built-in mods README:

- The contract is the only declaration of the noun. The mod's own hooks import from `../types`, and the value the `engine.create` hook returns is checked against `EngineInterface['cache']`, so the implementation cannot drift from what callers read.
- A mod that calls another's noun imports the same file by path and never copies it. Until `/plugin-types` writes installed plugins' contracts beside `claude-code.d.ts`, point the tsconfig `include` at that mod's `types/` folder.
- Every verb on the noun is an event. The declaration above also types `on('cache.evict', ...)`, with `e` its argument and the result its return type.
- Two plugins that give one event two different types do not compile in the authoring project.
- A test of a mod that calls another's noun seats a provider: an inline plugin whose `engine.create` hook adds the noun, then answers its calls the way it answers the engine's, `on('cache.evict', ($, e) => ({ value: undefined }))`. With no provider loaded the `$` build refuses the hook and names the noun nobody provides.

`$.telemetry` in Anthropic's `telemetry` mod is the shipped example; its `types/index.d.ts` is the shape to copy.

## An organization's control points

Three hooks give an organization the whole surface (4.2, 5, and the cheat sheet):

- Which plugins may exist is a hook on `plugin.register`. It sees each plugin's static uses, the same lines `claude plugin validate` prints, and may refuse it.
- Which nouns exist is a hook on `engine.create`. The organization's plugin sits on top, so it returns last: it can let only named nouns through, or forbid additions by returning what the core step returned. Restricting what a verb does needs nothing here, because every verb is already an event: hook `fs.read`, or `*`.
- What every plugin does is one hook on `*`, at the top of every chain:

```ts
on('*', ($, e, next) => {
  $.ui.log(`${JSON.stringify(next.origin)} called ${next.event}`)
  return next(e)
})
```

Placement is the mechanism. Managed settings name the plugins prepended and appended, and the organization owns both tiers. On a managed machine or a Team or Enterprise plan, `sec-default` sits outermost unless managed `prependPlugins` says otherwise, so a person's plugins cannot touch classic hooks, prompt sections, settings reads or an organization-provided tool's description (built-in mods README). First in every chain sees every event before any other plugin and every result after, and nothing beneath it can bypass it.

A mod written for other people should expect all three: a plugin above may withhold a noun you call, deny an event you raise, or refuse your plugin at `plugin.register`. Treat `{ deny }` and a missing noun as normal outcomes, not bugs.

## Options from the manifest

`register(on, options)`: the second argument is the plugin's configured options, typed `PluginOptions`, sourced through the manifest's `userConfig` (1.1; the plugin reference documents `userConfig` as values the person is prompted for at enable time). When the person changes them, `register` runs again with the new object and the hooks close over it (types file). Read installation-time settings there, not through `$.env.get`.

```json
{
  "name": "MOD_NAME",
  "userConfig": {
    "target": { "type": "string", "description": "Model alias every subagent is pinned to", "default": "fable" }
  }
}
```

Check the exact `userConfig` field shape against the plugin reference before shipping it; the page, not this file, is the contract for the manifest.
