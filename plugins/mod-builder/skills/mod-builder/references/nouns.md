# Nouns: every $ method, its reach level and label

Read this at step 1, when the plan's Do line is written, and when a footprint is graded. `$` is the only door a hooks module has to the host, so what a mod can do is exactly the calls it spells on `$`, and `claude plugin validate` prints them before any code runs. Levels and labels below are the ones `data/reach-rules.json` applies (first matching rule wins); a call no rule matches prints as ungraded and stops the footprint. Signatures and result shapes are not here: `grep -n "^      fs: {" <types>/claude-code/index.d.ts` opens a noun, and each method's doc comment sits above it. Stamp legend: `[src: <pointer> | checked <build> | recheck: <trigger>]`.

<!-- api-check: ignore $.ui.selection, ui.selection -->

## Reach levels
| Level | Name | What lands here |
|---|---|---|
| L0 | draws and remembers | the screen, audio, the plugin's own store and state, the clock, command listing and registration, session facts |
| L1 | reads | files, env vars, settings, the transcript, the system prompt, a credential handle, telemetry; also writing the prompt box (`$.prompt.fill`, `$.prompt.suggest`), while reading it is L0 |
| L2 | writes or runs or drives Claude | writes files, runs processes, sets env vars or config, or drives Claude (model calls, agents, prompts, tools, commands, compaction, messages) |
| L3 | network | `$.http.fetch`, `$.mcp.call`, `$.mcp.connect` |

A mod's level is the maximum over its calls. The level orders risk; it says nothing about intent, and it says nothing about what the mod sees (a pet game that hooks every tool call is L0 and sees every tool call). Both go in the plan. [src: data/reach-rules.json, docs admin.md "Review what a mod can do" | checked 2.1.288 | recheck: footprint prints ungraded for a call on this page]

## Show and remember
```api-methods
$.plugin.name
$.plugin.root
$.ui.notice
$.ui.invalidate
$.ui.blit
$.ui.resolve
$.ui.log
$.ui.ask
$.ui.toast
$.ui.status
$.ui.open
$.ui.close
$.ui.panes
$.ui.scroll
$.ui.focus
$.ui.copy
$.audio.play
$.audio.speak
$.store.get
$.store.set
$.store.delete
$.store.keys
$.state.get
$.state.set
$.clock.now
$.clock.sleep
$.clock.after
$.clock.every
```
- `$.plugin`: L0, no label; `name` and `root` are values, not calls; `root` is the absolute folder holding plugin.json. [src: d.ts CoreEngineInterface plugin | checked 2.1.288 | recheck: gate drift line names $.plugin]
- `$.ui`: every method in the block L0 draws. Claude Code 2.1.288 adds `$.ui.selection`, which returns the person's last mouse selection and the transcript row it lies in; the rules grade it L1 reads the transcript. It is not in the block above because the 2.1.287 baseline lacks it (migrate.md, Since the baseline). `$.ui.resolve` returns the element table synchronously (never `await` it); `$.ui.open` resolves placed or waiting (`isPlaced`); `$.ui.ask` rejects on dismiss, on "Chat about this" and in `-p`, and reaches other hooks as a `tool.call` of the `AskUserQuestion` tool; `$.ui.log` is a dim transcript line Claude never reads, or the debug log with `{ to: 'debug' }`. Panes, sites and redraws: `ui-and-state.md`. [src: d.ts CoreEngineInterface ui (selection since 2.1.288), data/reach-rules.json, docs events.md | checked 2.1.288 | recheck: api-check SHAPE DRIFT ui.resolve.sync]
- `$.audio`: L0 plays audio; `$.audio.play` uses `afplay` on macOS and plays nothing in Linux or Windows terminals; `$.audio.speak` uses the platform synthesizer. [src: d.ts CoreEngineInterface audio | checked 2.1.288 | recheck: gate drift line names $.audio]
- `$.store`: L0 persists state; one JSON store per plugin, shared by every session on the machine, 4 MiB in total, cleared after `cleanupPeriodDays` unread; get then set is not atomic, so give each item its own key and re-read right before writing. [src: docs interface.md "Save from more than one session", d.ts store.set | checked 2.1.288 | recheck: api-check SHAPE DRIFT store.cap]
- `$.state`: L0 persists state; any plugin reads, only the owner writes; a write inside a `ui.render` hook is refused; `/clear`, `/resume`, `/branch` reset it. Contract and reload: `ui-and-state.md`. [src: d.ts CoreEngineInterface state | checked 2.1.288 | recheck: api-check SHAPE DRIFT state.ownerOnly]
- `$.clock`: L0, no label; `$.clock.sleep` counts against the hook's 10 s budget, every other `$` wait does not; timers from `$.clock.after` and `$.clock.every` die on every reload. [src: d.ts HookBudget, docs api.md | checked 2.1.288 | recheck: api-check SHAPE DRIFT budget.ms]

## Read the session and the host
```api-methods
$.session.messages
$.session.cwd
$.session.root
$.session.model
$.session.turns
$.session.id
$.session.repo
$.session.surfaces
$.session.surface
$.session.usage
$.session.version
$.session.compact
$.session.send
$.session.append
$.session.authorize
$.settings.read
$.env.get
$.env.set
$.fs.read
$.fs.write
$.fs.list
$.fs.exists
$.fs.stat
$.fs.ancestors
```
- `$.session`: `$.session.messages` L1 reads the transcript (newest 4096 entries); `$.session.authorize` L1 holds a credential (an opaque handle only `$.http.fetch` spends, toward a first-party host only); `$.session.compact`, `$.session.send`, `$.session.append` L2 drives Claude (`$.session.append` stores either a `user` row the model reads or a `system` notice the model never reads; a send counts as delivered once queued); the rest L0. `$.session.surface` is deprecated for `$.session.surfaces`; its rule grades it L0. [src: d.ts CoreEngineInterface session | checked 2.1.288 | recheck: gate drift line names $.session]
- `$.settings`: L1 reads settings; a snapshot with `env` included; never reads `~/.claude.json` or the login. [src: d.ts settings.read | checked 2.1.288 | recheck: gate drift line names $.settings.read]
- `$.env`: `$.env.get` L1 reads env vars, `$.env.set` L2 sets env vars; names are string literals or validate refuses; a set reaches every process and MCP server started after it. [src: d.ts CoreEngineInterface env, docs admin.md | checked 2.1.288 | recheck: validate accepts a non-literal env name]
- `$.fs`: `$.fs.write` L2 writes files, the rest L1 reads files; relative paths resolve against the session's working directory; 4 MiB per file; a write is not atomic; deny rules never cover `$.fs`, so guard with an allow-list on the resolved real path. [src: d.ts CoreEngineInterface fs, docs admin.md | checked 2.1.288 | recheck: gate drift line names $.fs]

## Drive Claude
```api-methods
$.model.complete
$.model.fork
$.model.classify
$.prompt.submit
$.prompt.read
$.prompt.fill
$.prompt.suggest
$.prompt.compose
$.tool.list
$.tool.call
$.tool.check
$.tool.register
$.command.list
$.command.run
$.command.register
$.config.list
$.config.set
$.agent.spawn
$.agent.list
$.agent.register
$.turn.abort
$.telemetry.log
$.telemetry.mark
```
- `$.model`: every method L2 drives Claude and spends the person's plan or API key; `$.model.complete` never rejects for a provider failure, so check whether it answered. [src: d.ts CoreEngineInterface model, docs api.md | checked 2.1.288 | recheck: gate drift line names $.model]
- `$.prompt`: `$.prompt.submit` L2 drives Claude (resolves when its turn starts, so never await it in a hook the running turn waits on; with `asUser` the model reads the text as the person's own); `$.prompt.fill`, `$.prompt.suggest` L1 writes the prompt box; `$.prompt.compose` L1 reads the system prompt; `$.prompt.read` L0. [src: d.ts CoreEngineInterface prompt, docs api.md | checked 2.1.288 | recheck: gate drift line names $.prompt]
- `$.tool`: `$.tool.call`, `$.tool.check`, `$.tool.register` L2 drives Claude; `$.tool.list` L0. `$.tool.check` runs the permission chain and executes nothing; `$.tool.register` rejects until `session.start` binds the session. [src: d.ts CoreEngineInterface tool | checked 2.1.288 | recheck: gate drift line names $.tool]
- `$.command`: `$.command.run` L2 drives Claude and rejects inside a hook the turn waits on; `$.command.list`, `$.command.register` L0; a register that throws (a taken or built-in name) skips the whole `session.start` hook, so register last or inside try. [src: d.ts command.run, docs api.md "Add a command" | checked 2.1.288 | recheck: gate drift line names $.command]
- `$.config`: `$.config.set` L2 changes config; `$.config.list` L0. [src: d.ts CoreEngineInterface config | checked 2.1.288 | recheck: gate drift line names $.config]
- `$.agent`: `$.agent.spawn`, `$.agent.register` L2 drives Claude; `$.agent.list` L0; a spawn runs in the background and resolves once started, not when done. [src: d.ts AgentSpawnResult | checked 2.1.288 | recheck: api-check SHAPE DRIFT agent.spawn.result]
- `$.turn`: `$.turn.abort` L2 drives Claude; it rejects for a turn that is not the running one. [src: d.ts CoreEngineInterface turn | checked 2.1.288 | recheck: gate drift line names $.turn]
- `$.telemetry`: L1 telemetry; rows are queued only when the engine or a built-in calls. [src: docs reference.md "Mods API methods" | checked 2.1.288 | recheck: gate drift line names $.telemetry]

## Leave the process
```api-methods
$.http.fetch
$.mcp.call
$.mcp.connect
$.process.run
$.process.spawn
```
- `$.http`: L3 network; refused when the organisation turns off web fetching; that policy covers `$.http.fetch` only. [src: docs admin.md "Know which controls still apply" | checked 2.1.287 | recheck: a fetch is refused with web fetching on]
- `$.mcp`: L3 network; `$.mcp.call` has no permission prompt (the hooks above it are the grant); `$.mcp.connect` reaches only servers the plugin's own manifest lists. [src: d.ts CoreEngineInterface mcp | checked 2.1.288 | recheck: gate drift line names $.mcp]
- `$.process`: L2 runs processes; argv with no shell; `$.process.run` times out at 30 s by default, 10 minutes at most; CLI only; neither deny rules nor the Bash sandbox apply. [src: d.ts ProcessRunInit, docs overview.md | checked 2.1.288 | recheck: api-check SHAPE DRIFT process.run.timeout]

A noun another mod adds (through `engine.create`, listed under `dependencies`) grades as ungraded until a rule names it: grade it by hand from its doc comment in `.claude-plugin/types/<plugin>/index.d.ts`. [src: docs create.md types table | checked 2.1.287 | recheck: footprint grades a plugin noun without a rule]

## Visibility: what a mod sees
Reach is what a mod can do; visibility is what it reads from events. The footprint's `sees:` line comes from the hooks and lists what the mod watches, the rows below; hooked lifecycle events such as `session.start`, `session.end` and `command.run` carry no content worth naming and are left out by design:

| Hook | Sees |
|---|---|
| `*` | every event except telemetry, every `$` call of mods after it |
| `tool.call` with no `tool` matcher (with one) | every tool call, subagents and MCP included (only those tools) |
| `tool.check` | every permission decision, and can approve before the person is asked |
| `prompt.submit` | every prompt |
| `prompt.context`, `prompt.section`, `prompt.compose`, `prompt.attachment` | the system prompt or the first-message context |
| `prompt.edit`, `prompt.fill` | the prompt box as it is typed |
| `turn.step` | every model request and its streamed answer |
| `session.append` | every row the conversation stores |
| `session.receive`, `session.send` | messages between sessions |
| `session.compact` | the whole conversation at compaction |
| `agent.spawn` | subagent prompts |
| `skill.prompt` with no `skill` matcher | every expanded skill |
| `classic.*` | every settings hook payload |
| `ui.render` with a component matcher | what that site shows |

A matcher is the cheapest privacy win: `{ tool: 'Bash' }` instead of every tool call. [src: docs admin.md review table | checked 2.1.287 | recheck: footprint prints a sees row not in this table]

## The budget test for a plan
For each method the plan lists, write one line: the hook that calls it, and what breaks if it is removed. If nothing breaks, remove it. Read the level off this page and write it into the plan before any code exists. After validate, the printed `calls:` line (and the `env` and `state` lines) must match the plan exactly; a call the validator prints that the plan did not list is a defect in the plan or the code, and the plan wins until a reason is written down.
