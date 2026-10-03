# Events: when each fires and what a hook may do

Read this at step 1, when the plan's Observe line is being written, or when a hook's behaviour is in doubt. It names every engine event, grouped as the docs reference groups them, with one decision line each: when it fires, and whether a hook observes, rewrites a field, or answers. Shapes (input fields, result fields, union members) are never restated here; read them from the types the engine wrote for the running build. Stamp legend: `[src: <pointer> | checked <build> | recheck: <trigger>]`; a d.ts pointer names the key or type whose doc comment holds the fact.

## Read a shape from the types
The grep recipe lives in build.md section 2 only: `grep -n "'tool.call': " <types>/claude-code/index.d.ts` gives the input type and the result type, and the same line works for a `$` call as an event (`'fs.read': `) and for any named type. `<types>` is the folder the gate's `types:` line prints.

## Tools
```api-events
tool.call
tool.check
tool.describe
```
- `tool.call`: before any tool runs, subagent and MCP calls included; rewrite argument fields (never `tool`, `tool_use_id`, `agentId`), answer `{ deny }` (Claude reads the reason, so write an instruction) or `{ result }`; managed PreToolUse hooks run first and their block is final. [src: d.ts EngineEventOf 'tool.call', docs events.md "Where settings hooks run" | checked 2.1.288 | recheck: gate drift line names tool.call]
- `tool.check`: after `tool.call` and PreToolUse hooks, before the mode settles an ask; the hook decides (`allow`, `ask`, `deny`) and cannot change the call; where the built-in guard loads it cannot lift a `deny` rule unless the organisation allows it. [src: d.ts EngineEventOf 'tool.check', docs admin.md | checked 2.1.288 | recheck: gate drift line names tool.check]
- `tool.describe`: once per tool when its description is first sent; rewrite the description or move the tool behind tool search; cached until `$.ui.invalidate`, and an unstable answer spends the prompt cache. [src: d.ts EngineEventOf 'tool.describe' | checked 2.1.288 | recheck: gate drift line names tool.describe]

## Prompts and what Claude reads
```api-events
prompt.submit
prompt.fill
prompt.suggest
prompt.edit
prompt.compose
prompt.section
prompt.context
prompt.attachment
skill.prompt
attribution.text
```
- `prompt.submit`: a prompt is submitted, before its turn; rewrite the text (the transcript shows it), add context only Claude reads, or answer `{ drop }`; `next(e)` resolves when the turn starts, not when it ends; a broken hook never blocks a prompt. [src: d.ts EngineEventOf 'prompt.submit', PromptSubmitResult | checked 2.1.288 | recheck: gate drift line names prompt.submit]
- `prompt.fill`: text is about to go into the prompt box as a draft; rewrite text or mode, or answer not filled to keep it out. [src: d.ts EngineEventOf 'prompt.fill' | checked 2.1.288 | recheck: gate drift line names prompt.fill]
- `prompt.suggest`: the dim suggestion is about to show; rewrite, or answer not shown to drop it; never shows while the box holds text, a turn runs, or headless. [src: d.ts PromptSuggestResult | checked 2.1.288 | recheck: gate drift line names prompt.suggest]
- `prompt.edit`: the person edits the prompt box (a burst of keys is one edit); rewrite text, cursor or paint; answering without `next` consumes the key. [src: d.ts EngineEventOf 'prompt.edit' | checked 2.1.288 | recheck: gate drift line names prompt.edit]
- `prompt.compose`: a system prompt is rendered; answer the section list; every `shared` section must precede every `session` one or the hook is skipped. [src: d.ts EngineEventOf 'prompt.compose' | checked 2.1.288 | recheck: gate drift line names prompt.compose]
- `prompt.section`: once per named section; answer new text or `{ text: null }` to omit; cached until invalidated, and an unstable answer spends the prompt cache. [src: d.ts EngineEventOf 'prompt.section', docs events.md | checked 2.1.288 | recheck: gate drift line names prompt.section]
- `prompt.context`: once per conversation, for the blocks sent with the first message (not per turn); re-read on invalidate, compaction or `/clear`. [src: d.ts EngineEventOf 'prompt.context', docs reference.md Prompts | checked 2.1.288 | recheck: gate drift line names prompt.context]
- `prompt.attachment`: once per message the engine injects on its own (reminders, mode changes); rewrite or omit; the answer holds per attachment for the process. [src: d.ts EngineEventOf 'prompt.attachment' | checked 2.1.288 | recheck: gate drift line names prompt.attachment]
- `skill.prompt`: a skill's text is expanded (slash, Skill tool, preload); rewrite it; an unstable rewrite spends the prompt cache. [src: d.ts EngineEventOf 'skill.prompt', docs events.md | checked 2.1.288 | recheck: gate drift line names skill.prompt]
- `attribution.text`: commit or PR attribution text is composed; rewrite or blank it. [src: d.ts EngineEventOf 'attribution.text' | checked 2.1.288 | recheck: gate drift line names attribution.text]

## Commands and configuration
```api-events
command.run
command.describe
config.set
config.describe
```
- `command.run`: a slash command is about to run; answer `{ text }` (printed under the mod's name, Claude reads it), `{}` (prints nothing) or `next(e)`; an answer after `next` replaces printed output only; unanswered prints `registered /<name> but no command.run hook answered it`. [src: d.ts EngineEventOf 'command.run', docs troubleshoot.md | checked 2.1.288 | recheck: gate drift line names command.run]
- `command.describe`: once per command for the typeahead and `/help`; rewrite description, hint, hidden; cached until invalidated. [src: d.ts EngineEventOf 'command.describe' | checked 2.1.288 | recheck: gate drift line names command.describe]
- `config.set`: a `/config` row is about to change; rewrite the value or answer `{ deny }`. [src: d.ts EngineEventOf 'config.set' | checked 2.1.288 | recheck: gate drift line names config.set]
- `config.describe`: once per `/config` row; rewrite label, description, hidden; cached until invalidated or the plugins change. [src: d.ts EngineEventOf 'config.describe' | checked 2.1.288 | recheck: gate drift line names config.describe]

## Turns
```api-events
turn.start
turn.step
turn.complete
```
- `turn.start`: a main-thread turn begins; observe only (a subagent's run raises none). [src: d.ts EngineEventOf 'turn.start' | checked 2.1.288 | recheck: gate drift line names turn.start]
- `turn.step`: one model request; the hook is an async generator (`yield* next(e)`), rewrites only model and effort, and each `next(e)` call opens a new request; yielding without `next` sends none. [src: d.ts EngineEventOf 'turn.step', StreamHookBody | checked 2.1.288 | recheck: gate drift line names turn.step]
- `turn.complete`: a turn ended, subagent turns included (filter on `agentId`); answer `{ text }` to show a line under the answer; the transcript record is never rewritten. [src: d.ts EngineEventOf 'turn.complete' | checked 2.1.288 | recheck: gate drift line names turn.complete]

## Session
```api-events
session.start
session.end
session.compact
session.receive
session.send
session.append
session.attach
session.detach
session.measure
```
- `session.start`: once per loaded mod before the first prompt (awaited, so commands registered here exist on turn one) and again on a reload of that mod; never after `/clear`, `/resume`, `/branch`. [src: d.ts EngineEventOf 'session.start', docs reference.md Session | checked 2.1.288 | recheck: gate drift line names session.start]
- `session.end`: exit, `/clear`, `/resume`, `/branch` (reported as resume), logout; observe; every hook shares one 1.5 s bound, `$` waits included. [src: d.ts SessionEndInput | checked 2.1.288 | recheck: api-check SHAPE DRIFT sessionEnd.bound]
- `session.compact`: before compaction (manual, auto, plugin, precompute); answer the kept messages or `{ skip }`. [src: d.ts EngineEventOf 'session.compact' | checked 2.1.288 | recheck: gate drift line names session.compact]
- `session.receive`: a delivery from another session or agent, before it is queued; rewrite or `{ consumed }`; the sender name is the sender's claim, never a guard key. [src: d.ts SessionReceiveInput, docs api.md | checked 2.1.288 | recheck: gate drift line names session.receive]
- `session.send`: a message is about to leave; rewrite or readdress, or refuse with an undelivered answer. [src: d.ts EngineEventOf 'session.send' | checked 2.1.288 | recheck: gate drift line names session.send]
- `session.append`: once per row the conversation stores; rewrite content only; answering without `next` is skipped and the row kept; only a plugin's own note may be refused. [src: d.ts SessionAppendResult | checked 2.1.288 | recheck: gate drift line names session.append]
- `session.attach`, `session.detach`: a remote client joins or leaves; observe only. [src: d.ts EngineEventOf 'session.attach' | checked 2.1.288 | recheck: gate drift line names session.attach]
- `session.measure`: after each main-thread turn and when a rate-limit window moves a point; observe only. [src: d.ts EngineEventOf 'session.measure' | checked 2.1.288 | recheck: gate drift line names session.measure]

## Subagents
```api-events
agent.offer
agent.spawn
```
- `agent.offer`: a subagent type is listed for Claude and again at dispatch; withhold only (adding a type is `$.agent.register`); a plugin's own spawn of a withheld type still runs. [src: d.ts AgentOfferInput | checked 2.1.288 | recheck: gate drift line names agent.offer]
- `agent.spawn`: the Agent tool is about to start a subagent; rewrite model, prompt and the other open fields or `{ deny }`; resolves once the agent started, and its answer is that agent's own `turn.complete`. [src: d.ts AgentSpawnResult | checked 2.1.288 | recheck: api-check SHAPE DRIFT agent.spawn.result]

## Interface
```api-events
ui.render
ui.resolve
ui.press
ui.input
ui.select
ui.focus
ui.scroll
ui.message
```
- `ui.render`: a render site is drawn, once per input value, load or invalidate; return a tree, `next(e)`, or `next` with changed props; a tree that fails validation draws the engine's own. Sites and elements: `ui-and-state.md`. [src: d.ts EngineEventOf 'ui.render' | checked 2.1.288 | recheck: gate drift line names ui.render]
- `ui.resolve`: once per app, site and mod at load; restyle or leave out elements; a table of its own is skipped. [src: d.ts EngineEventOf 'ui.resolve' | checked 2.1.288 | recheck: gate drift line names ui.resolve]
- `ui.press`, `ui.input`, `ui.select`: a control a mod drew is used; another mod's hook runs before the drawing mod's callback and may rewrite or answer for it. [src: docs interface.md "Respond to presses" | checked 2.1.287 | recheck: a kit press test sees the callback run before a hook above]
- `ui.focus`: the focus ring of a pane or band is about to move; rewrite the target element, or hold the ring by not calling `next`. [src: d.ts UiFocusInput | checked 2.1.288 | recheck: gate drift line names ui.focus]
- `ui.scroll`: a site's window is about to move; rewrite the offset only; no `next` leaves the site undrawn. [src: d.ts EngineEventOf 'ui.scroll' | checked 2.1.288 | recheck: gate drift line names ui.scroll]
- `ui.message`: a `Client` this plugin drew posts data; only this plugin's hooks see it. Closing a pane is the op event `ui.close` (origin plugin, person or unload); a hook may hold the pane open except on unload. [src: d.ts EngineEventOf 'ui.message', PaneCloseOrigin | checked 2.1.288 | recheck: gate drift line names ui.message]

## Other mods
```api-events
plugin.register
engine.create
```
- `plugin.register`: once per hooks module about to load or reload; answer `{ refuse }`; key policy on tier and uses, never on name, root or version (the plugin's own word); a policy hook that throws fails open unless its `.catch` refuses. [src: d.ts PluginRegisterInput, docs admin.md | checked 2.1.288 | recheck: gate drift line names plugin.register]
- `engine.create`: while `$` is built, once per load; add or withhold a noun, never replace one; no budget, no `.catch`, and `$` inside is empty. [src: d.ts EngineEventOf 'engine.create', HookBudget | checked 2.1.288 | recheck: gate drift line names engine.create]

## Telemetry
```api-events
telemetry.log
telemetry.mark
```
- `telemetry.log`, `telemetry.mark`: a usage record is about to be logged; an installed mod's hook needs the matcher `{ to: 'collector' }` or validate fails; `*` and negations never select them; a hook rewrites content, never the destination. [src: docs reference.md Telemetry, d.ts TelemetryDestination | checked 2.1.288 | recheck: validate stops refusing an unmatched telemetry hook]

## Settings hook events and $ calls
Every settings hook event is `classic.<Event>` with the hook's stdin JSON as `e`; the chain is managed hooks, then mods, then the other settings hooks as core, and it fires with no settings hook configured. `classic.PreToolUse` alone has the tool call envelope and fires inside `tool.call` beneath every mod. `classic.SessionStart` fires after `/clear`, `/resume`, `/branch` and compaction, so it is the reload point for `$.state` (`ui-and-state.md`). Every `$` method is also an event named without `$.` (`fs.read`, `ui.open`); a hook there sees calls from mods after it and answers `{ value }`, `{ deny }` (the caller's promise rejects) or `next(e)`. [src: d.ts ClassicEventOf, OpEventOf | checked 2.1.288 | recheck: gate drift line in the classic or op family]

## next, order and failure
```api-next
to
signal
is
event
origin
trace
budget
error
called
```
- `next(e)` runs everything beneath, then core; returning without it answers in core's place; `e` is frozen, so pass a copy; a second `next(e)` on `tool.call` is a retry; returning while `next` is pending aborts what runs beneath. [src: d.ts Next, EngineEventOf 'tool.call' | checked 2.1.288 | recheck: gate drift line in the next family]
- `next.to` skips to `append`, `builtin` or `core`, only from a mod in `prependPlugins` or `appendPlugins`, with a literal tier; `next.error` and `next.called` exist only in `.catch`; `next.budget` reads own time left. [src: docs reference.md "The hook function" | checked 2.1.288 | recheck: gate drift line in the next family]
- A hook never sees the dispatches it raises through `$`; its plugin's other hooks and every other plugin do. [src: d.ts EventCalls "calling hook alone skipped" | checked 2.1.288 | recheck: a load log shows a hook settling on its own dispatch]

```api-tiers
prepend
user
append
builtin
core
```
- Chain order, outermost first: the guard and `prependPlugins` (and other organisation mods), mods the person installs, `appendPlugins`, other built-ins, core. Among installed mods a mod runs before the mods it lists under `dependencies`; within a module, `on` order, first outermost. [src: docs events.md "The order mods run in" | checked 2.1.287 | recheck: a load log lists environments in another order]
- One unmatched registration per event (a second fails validate); `*` and negations skip telemetry. [src: docs events.md "Filter which events" | checked 2.1.288 | recheck: validate accepts a duplicate unmatched hook]
- Failure: before `next`, the hook is skipped and the next handler runs; after `next` resolved, that result stands. A `.catch` gets a fresh 1 s grace, one per registration. Budget: 10 s of own time; `next` and `$` waits do not count except `$.clock.sleep`; streaming hooks count only their own code. Limits and the failure line forms: `limits.md`. [src: d.ts HookBudget, docs events.md "Handle a hook that fails" | checked 2.1.288 | recheck: api-check SHAPE DRIFT budget.ms or budget.catchMs]
