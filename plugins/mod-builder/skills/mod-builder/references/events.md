# Engine events

Every event a hooks module can register with `on("<event>", matcher?, hook)`. Derived from the `$` cheat sheet (Anthropic, 2026-09-09), the architecture PDF (Alice Poteat, August 2026) and the type declarations Anthropic publishes with its built-in mods, `mods/types/claude-code.d.ts`; links are in `reading.md`. Where a row says "types file", the shape was read from that declaration file. Function hooks are early access, so the shapes below can change between Claude Code releases. When a shape matters, run `/plugin-types` in a session and read `.claude/types/claude-code.d.ts`. That file is the truth for the binary you run.

## How to read a row

`e` is the event payload, a plain immutable value. To change it, pass `next` a copy with a changed field. Ids on `e` are pinned (`tool`, `tool_use_id`, `agentId`, `origin`, `provider`, `trigger`, keys); the rest is yours to rewrite. The result column is what the hook must return, either from `next(e)` or in the engine's place.

A row marked "core has a side effect" means: no `next` and the action did not happen, `next` twice and it happened twice. The cheat sheet marks twelve events that way: `tool.call`, `prompt.submit`, `prompt.fill`, `prompt.suggest`, `turn.step`, `session.compact`, `agent.spawn`, `command.run`, `config.set`, `ui.press`, `ui.input`, `ui.message`, plus `classic.*` and `*`. Every other row is a question the engine asks with no side effect of its own.

## Tool events

| Event | `e` | Result | Notes |
|---|---|---|---|
| `tool.call` | `{ tool, tool_use_id, agentId?, ...input }` | the tool result, or `{ deny: "reason" }` | The tool input fields sit on `e` as own fields (`e.command` for Bash). Inside a subagent, `agentId` is set. Core has a side effect. |
| `tool.describe` | what the model is told a tool is; `e.provider` says who ships it | the description | Cached; call `$.ui.invalidate("tool.describe")` to re-run. |
| `tool.check` | the permission decision for a call | `{ decision }` | Types file: fires after the `tool.call` and PreToolUse hooks and before the mode settles an ask; `$.tool.check` runs the same chain and executes nothing. |

Matcher examples: `on("tool.call", { tool: "Bash" }, ...)`, `on("tool.call", { tool: ["Read", "Grep"] }, ...)`. An array matches when any element matches. An empty array matches nothing.

## Prompt events

| Event | `e` | Result | Notes |
|---|---|---|---|
| `prompt.submit` | the typed prompt | `{ text, context[] }` | Core runs the turn. A hook on this event sees every prompt the user types. Core has a side effect. |
| `prompt.fill` | text written into the prompt box | the text, rewritten or refused | Raised by `$.prompt.fill`. Core has a side effect. |
| `prompt.suggest` | the dim proposal shown after a turn | the proposal, rewritten or refused | Raised by `$.prompt.suggest`. Core has a side effect. |
| `prompt.context` | per-turn injected context | the context | The scanner counts this as "sees the system prompt". Types file: the blocks prepended to a conversation's first user message; re-run with `$.ui.invalidate("prompt.context")`. |
| `prompt.section` | a system-prompt section | the section | Same visibility note as above. Types file: cached by name for the session until `$.ui.invalidate("prompt.section")`; match `{ name: "memory" }` for one section. |

## Turn events

| Event | `e` | Result | Notes |
|---|---|---|---|
| `turn.start` | `{ turnId, text }` | pass-through | Before the turn runs. |
| `turn.step` | one model request | streamed | An `async function*` hook: `yield* next({ ...e, model, effort })`. The only streaming event on the sheet. Core has a side effect: no `next` and no request is sent. |
| `turn.complete` | `{ text }` plus usage | pass-through | After the turn. |

## Session events

| Event | `e` | Result | Notes |
|---|---|---|---|
| `session.start` | `{ cwd, surface, isInteractive }` | `{ cwd }` | Once per session. Types file: `surface` is `terminal` under the REPL and null for a `-p` run or the SDK; `isInteractive` is false for both. Core echoes `{ cwd }`; a hook's own value does not change the session. |
| `session.receive` | an inbound delivery before it enters context | `{ text }` or `{ consumed }` | Return `{ consumed }` to keep it out of the transcript. |
| `session.compact` | `{ trigger, agentId?, instructions?, messages }` | `{ messages }` or `{ skip }` | Types file: `trigger` is `manual`, `auto`, `plugin` or `precompute`, so `/compact` and auto-compaction both pass here; `agentId` names a subagent's own transcript. Core has a side effect. |
| `session.attach` | `{ surface, clientId }` | pass-through | A surface (desktop, phone) joined. |
| `session.detach` | `{ surface, clientId }` | pass-through | A surface left. |

## Agent events

| Event | `e` | Result | Notes |
|---|---|---|---|
| `agent.spawn` | `{ prompt, model, provider, parentAgentId?, ... }` | `{ text }` | Resolves when the subagent settles. Core has a side effect. |
| `agent.offer` | which agent types the model is offered | the list | Hook it to add or hide agent types. |

`$.agent.list()` maps an `agentId` seen on `tool.call` to `{ id, name, parentId, status }`. Origin (which plugin raised a dispatch) and agent (which loop it runs in) are separate axes.

## Command events

| Event | `e` | Result | Notes |
|---|---|---|---|
| `command.run` | `/name args`, seen by the test kit as `{ command, args, origin: { kind } }` | `{ text }` | Register your own with `$.command.register`, then hook `command.run` with `{ command: "yourname" }`. Core has a side effect. |
| `command.describe` | a command's listing; `e.provider` | the listing | Relabel or hide a command. |

## Config events

| Event | `e` | Result | Notes |
|---|---|---|---|
| `config.set` | `{ key, value, previous, provider }` | `{ value }` or `{ deny }` | A `/config` row changed. Core has a side effect. |
| `config.describe` | a row as the menu lists it | the row | Relabel or hide. |

## UI events

| Event | `e` | Result | Notes |
|---|---|---|---|
| `ui.render` | `{ surface, component, props }` | an element tree | Match on `component`. Resolve elements with `await $.ui.resolve(e)`. Wrap what `next(e)` drew, or replace it. No side effect. |
| `ui.press` | a Button you drew was pressed; `e.plugin`, `e.element` (path such as `0.1.2`, or a `key`), `e.component` | pass-through | Another plugin can hook your button by matcher: `{ plugin: "name", element: "0.1.copy" }`. Core has a side effect: the `onPress` closure is the bottom of this chain (PDF 3.2.4). |
| `ui.input` | an Input you drew received text | pass-through | Same addressing as `ui.press`. Core has a side effect. |
| `ui.message` | data posted by your Client surface module via `surface.post` | `{}` from core; `{ props }` hands the instance its next props | Besides Buttons, the way surface-side code talks back to the hooks module. Types file: only the drawing plugin's own hooks see it. Core has a side effect. |
| `ui.resolve` | the element table for a surface | the table | A plugin above can restyle or restrict what plugins beneath draw with. |

Components you can match on `ui.render`: `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `AskUserQuestion`, `Spinner`, `TurnDuration`, `InfoNotice`, `SessionMode`, `PromptHint`, `AbovePrompt`, `Pane`.

Elements every surface offers: `Box`, `Text`, `Button`, `Input`, `Select`, `Link`, `Code`, `Svg`, `Client`. The terminal draws Ink, desktop draws DOM plus Svg, mobile a smaller table. One tree, the surface picks the constructors. An element the surface does not know renders as a fragment.

A pane: `$.ui.open({ id })` plus `on("ui.render", { component: "Pane", requestId: id }, ...)`. `$.ui.close({ id })` ends it. Redraw with `$.ui.invalidate("ui.render")`; scroll position never moves. Hover is declared on the element (`Box({ hover: { borderColor: "cyan" } })`), applied by the surface, no round trip.

## Skill, engine and admission events

| Event | `e` | Result | Notes |
|---|---|---|---|
| `skill.prompt` | `{ skill, text }` | `{ text }` | Match `{ skill: "name" }` to touch one skill (`skill` is the matcher key in the types file). Without a matcher the scanner records "sees every skill". |
| `engine.create` | the `$` fold itself | the `$` table | The one event not reachable as `$.noun.verb`. Add a noun: `return { ...await next(e), audit: { record } }`. A noun once added belongs to the plugin that added it. |
| `plugin.register` | `{ name, tier, uses[] }` | allow or refuse | Admission. An org plugin on top sees each plugin's static uses and can refuse it. |

## Classic and wildcard

| Event | `e` | Result | Notes |
|---|---|---|---|
| `classic.<Event>` | the exact JSON a settings hook receives (`classic.PreToolUse`, `classic.Stop`, ...) | the exact JSON it returns | Every settings hook is wrapped 1:1. The configured shell hooks are core for that seam. Core has a side effect. |
| `tool.*`, `classic.*` | the union of the matching events | per event | `e` narrows to the union. |
| `*` | every event above and every `$` call (`fs.read`, `http.fetch`, `store.set`, ...) | per event | Same powers at your position: rewrite, refuse, `next.to`. Under `*` the type of `e` is unknown until `next.is("tool.call", e)` narrows it. Core has a side effect wherever the underlying event does. |

## In the types file, not on the cheat sheet

Anthropic's `mods/types/claude-code.d.ts` declares these events too. They are real on 2.1.272 (the built-in `diff` mod hooks three of them); the cheat sheet predates them or leaves them out.

| Event | `e` | Result | Notes |
|---|---|---|---|
| `attribution.text` | `{ kind, text }`, `kind` one of `commit`, `pr`, `exemption`, `remedy` | `{ text }` | The git text the model is about to write. `on("attribution.text", { kind: "commit" }, () => ({ text: "" }))` blanks the commit attribution. |
| `ui.close` | `{ id, origin }`, `origin.kind` one of `plugin`, `person`, `unload` | pass-through or `{ deny }` | Raised by `$.ui.close` and by the engine when the person or an unload closes a pane. |
| `ui.focus` | `{ plugin, element, ... }` | pass-through | Focus moved inside something you drew. The `diff` mod hooks it with `{ plugin: <its name> }`. |
| `ui.scroll` | `{ requestId, by, offset, ... }` | `{}` | The `diff` mod hooks it with `{ requestId: <pane id> }`. Answering without `next` leaves the surface undrawn, so move your own rows by `e.by` and invalidate. |
| `ui.select` | `{ plugin, element, component, surface, value }` | `{ element, value }` | A Select you drew was picked from. `next({ ...e, value })` rewrites the pick. |

Run `/plugin-types` and read the `EngineEvents` keys in `.claude/types/claude-code.d.ts` for the full list on the binary you run.

## Every `$` verb is an event

`on("fs.write", ...)`, `on("http.fetch", ...)`, `on("process.run", ...)`, `on("store.set", ...)` and so on. A hook there sees every call other plugins make on that verb, at its own position in the chain. This is how an audit mod or a policy mod works. The verb table with payloads is in `nouns.md`.

## What `next` carries

| Member | Meaning |
|---|---|
| `next(e)` | Runs every hook beneath, then core. Resolves with the result. Zero or more times. |
| return without `next` | Answer in core's place: `{ deny }` on `tool.call`, or your own result. |
| `next.trace` | After `await`: each lower link's plugin, tier, `e`, result and outcome. |
| `next.origin` | `{ plugin, tier }` of the caller; `{ engine, core }` when the engine raised it. |
| `next.event` | In a glob or `*` hook: which event this dispatch is. |
| `next.is("tool.*", e)` | Type predicate. Narrows `e` and the result to the matching events. |
| `next.to(e, "builtin")` | Managed tier only: continue at a lower tier. Narrows only. |
| `next.signal` | An `AbortSignal` per dispatch. Fires when the chain returned or was cancelled. Stop floating work on it. |
| `next.error`, `next.called` | Inside `.catch`: `{ kind, message, budget }`, and whether you already dispatched. `next(e)` replays. |

## The chain

Five tiers, authority decreasing toward core: `prepend` (org policy), `user` (what you install), `append` (org policy), `builtin` (ships in the binary), `core` (the engine). On the way down each link can refine `e`; core answers by default; on the way up each link can refine the result. Earlier registration wraps more: position is authority. Within one plugin, hooks keep registration order.

On a managed machine or a Team or Enterprise plan, `sec-default` sits outermost, so a person's plugins cannot touch classic hooks, prompt sections, settings reads or an org-provided tool's description.

## Failure and recursion

- A throw or a 10 second overrun skips the hook with one dim line, unless the hook declared `.catch`, which runs on a grace budget with the same `next` and answers instead. A wrong-shaped return is always skipped.
- A hook never sees the dispatches it raised itself (its `$` calls, its `next`, its spawned agent). Its sibling hooks and every other plugin do. This keeps the number of hook invocations linear and lets an audit hook on `*` log a plugin's own `$` calls.

## Five placements, one event

| Placement | Shape |
|---|---|
| before | do the work, then `return next(e)` |
| after | `const r = await next(e)`, use `r`, return it |
| during | `const pending = next(e)`, work beside it, `return pending` |
| instead | return without calling `next` |
| modifying | `return next({ ...e, timeout: 30 })` |

A hook must assume any hook above it can change its result or never call it.
