# The `$` nouns and verbs, with reach levels

`$` is the engine interface: an object of nouns, each an object of verbs. It is the only door. The environment that runs a hooks module has no ambient file system or network, so what a mod did is exactly the calls it made on `$`. Every call is spelled `$.noun.verb(...)` literally; `claude plugin validate` inventories every call statically and refuses computed or optional access (verified on Claude Code 2.1.272, the error text is in `gotchas.md`).

Verb descriptions come from the `$` cheat sheet (Anthropic, 2026-09-09). Reach levels and labels come from the scanner's grader, `tools/grade.mjs` in https://github.com/karanb192/awesome-claude-code-mods, copied here so a plan and a badge agree.

## The four reach levels

| Level | Name | Meaning |
|---|---|---|
| L0 | draws and remembers | Touches only the screen, the plugin's own store, the clock, commands, session reads, and `$.agent.list`. |
| L1 | reads | Reads files, environment variables, settings, or the transcript. Writes the prompt box. Any call the grader does not recognise also lands here, labelled `other: <call>`. |
| L2 | writes or runs | Writes files, runs processes, sets environment variables or configuration, or drives Claude (model calls, spawning agents, submitting prompts, calling tools, running commands, aborting turns, compacting, registering tools). |
| L3 | network | `$.http.fetch` or `$.mcp.call`. |

A mod's level is the maximum over its calls. The level orders rows; it says nothing about intent. A game that hooks every tool call to feed a pet is L0 and sees every tool call. Both facts belong in the plan.

## Nouns and verbs

| Call | What it does | Level | Scanner label |
|---|---|---|---|
| `$.tool.call` | run a tool through the hooks and permissions | L2 | drives Claude |
| `$.tool.list` | tools the model has now | L1 | other |
| `$.tool.register` | give the model a new tool | L2 | drives Claude |
| `$.command.run` | run `/command` as if typed | L2 | drives Claude |
| `$.command.list` | slash commands available | L0 | |
| `$.command.register` | add `/yourcommand` | L0 | |
| `$.prompt.submit` | queue a prompt as this plugin | L2 | drives Claude |
| `$.prompt.fill` | write the prompt box | L1 | writes the prompt box |
| `$.prompt.suggest` | propose dim text into the prompt box | L1 | writes the prompt box |
| `$.agent.spawn` | start a subagent, resolves when it settles | L2 | drives Claude |
| `$.agent.list` | subagents: id, name, parentId, status | L0 | |
| `$.turn.abort` | cancel the running turn | L2 | drives Claude |
| `$.session.id` | session identity | L0 | |
| `$.session.cwd` | where the session runs | L0 | |
| `$.session.repo` | the repository | L0 | |
| `$.session.model` | which model | L0 | |
| `$.session.surfaces` | the surfaces attached now | L0 | |
| `$.session.turns` | turns so far | L0 | |
| `$.session.usage` | context window fill, rate limits, cost | L0 | |
| `$.session.messages` | the transcript, one entry per message | L1 | reads the transcript |
| `$.session.authorize` | opaque credential handle, spent by `http.fetch` | L1 | reads the transcript |
| `$.session.compact` | compact now, through `session.compact` like `/compact` | L2 | drives Claude |
| `$.model.complete` | one completion on the session's client | L2 | drives Claude |
| `$.model.fork` | tool-less completion over this transcript, cache-shared | L2 | drives Claude |
| `$.model.classify` | pick one of your labels for a text | L2 | drives Claude |
| `$.ui.log` | a transcript line | L0 | draws |
| `$.ui.notice` | a line under a dialog | L0 | draws |
| `$.ui.toast` | the notification bar | L0 | draws |
| `$.ui.status` | your status-line slot | L0 | draws |
| `$.ui.ask` | the engine's AskUserQuestion dialog | L0 | draws |
| `$.ui.open` | open a pane | L0 | draws |
| `$.ui.close` | close a pane | L0 | draws |
| `$.ui.invalidate` | re-run a cached event: `ui.render`, `prompt.section`, `tool.describe` | L0 | draws |
| `$.ui.resolve` | the element constructors for `e.surface` | L0 | draws |
| `$.fs.read` | read a file on the host, with the process's reach | L1 | reads files |
| `$.fs.write` | write a file on the host | L2 | writes files |
| `$.fs.list` | list a directory | L1 | reads files |
| `$.fs.stat` | kind, size, mtime | L1 | reads files |
| `$.fs.exists` | whether a path exists; never rejects | L1 | reads files |
| `$.fs.ancestors` | named instruction files above cwd | L1 | reads files |
| `$.settings.read` | the resolved settings, or one source's layer: `{ source: "policy" }` | L1 | reads settings |
| `$.config.set` | change a `/config` row through the menu's own door | L2 | changes config |
| `$.config.list` | the `/config` rows | L0 | |
| `$.env.get` | one variable by LITERAL name; validate lists what you read | L1 | reads env vars |
| `$.env.set` | set one variable by literal name | L2 | sets env vars |
| `$.store.get` | per-plugin persisted JSON: read | L0 | persists state |
| `$.store.set` | write | L0 | persists state |
| `$.store.delete` | delete | L0 | persists state |
| `$.store.keys` | list keys | L0 | persists state |
| `$.http.fetch` | through the host; `{ auth }` spends an authorize handle | L3 | network |
| `$.process.run` | argv on the host, no shell; resolves `{ exitCode, stdout, stderr }` | L2 | runs processes |
| `$.mcp.call` | a tool on a connected MCP server | L3 | MCP servers |
| `$.clock.now` | the time | L0 | |
| `$.clock.sleep` | wait | L0 | |
| `$.clock.after` | a one-shot timer, cancel-able | L0 | |
| `$.clock.every` | a repeating timer, cancel-able | L0 | |
| `$.audio.play` | a clip | L0 | plays audio |
| `$.audio.speak` | the platform synthesizer | L0 | plays audio |
| `$.plugin.name` | who you are | L0 | |
| `$.plugin.root` | where you live | L0 | |

## Nouns other mods add

A mod can add a noun in the `engine.create` fold. Anthropic's built-in `telemetry` mod adds `$.telemetry.log` and `$.telemetry.mark` (L1, label `telemetry`), which record a first-party analytics row and send nothing where analytics are off. A community mod, `autotel`, adds `$.autotel`. Any other added noun grades as L1 `other`. A mod that depends on another mod's noun needs that mod installed and its types on the tsconfig `include` path (mods README, `reading.md`).

## Signatures seen in shipped source

The cheat sheet names verbs, not argument shapes. These shapes are read from Anthropic's `diff` mod (`mods/diff/hooks/register.ts`) and cc-arcade's `hooks/register.tsx`, both linked in `reading.md`. Confirm against `.claude/types/claude-code.d.ts` after `/plugin-types`.

| Call | Shape seen |
|---|---|
| `$.store.get(key)`, `$.store.set(key, value)` | string key, JSON value |
| `$.fs.read(path)`, `$.fs.stat(path)`, `$.fs.list(path)` | string path |
| `$.fs.write(path, content)` | string path, string content |
| `$.process.run(argv, init)` | argv array, no shell; resolves `{ exitCode, stdout, stderr }` |
| `$.ui.log(text)`, `$.ui.status(text)`, `$.ui.toast(text)` | string |
| `$.ui.open(pane)`, `$.ui.close(pane)` | the pane object, `{ id }` on the cheat sheet |
| `$.ui.invalidate('ui.render')` | the event name |
| `$.ui.resolve(e)` | the render event, returns the element table |
| `$.command.register(spec)` | a command spec object |
| `$.clock.now()`, `$.clock.after(ms, fn)`, `$.clock.every(ms, fn)` | milliseconds and a callback |
| `$.session.id()`, `$.session.messages()` | no arguments |

## Visibility, from the events hooked

Reach is what a mod can do. Visibility is what it sees. The scanner records:

| Hook | Recorded as |
|---|---|
| `*` | everything |
| `tool.call` with no `tool` matcher | every tool call |
| `tool.call` with `{ tool: "Bash" }` | Bash calls |
| `prompt.submit` | every prompt |
| `prompt.context` or `prompt.section` | the system prompt |
| `session.compact` | compaction |
| `agent.spawn` | subagent spawns |
| `skill.prompt` with no `skill` matcher | every skill |
| `classic.*` | classic hooks |

Add a matcher whenever the mod only needs some of an event. `{ tool: "Bash" }` instead of every tool call is the single cheapest privacy win in a plan.

## The budget test for a plan

For each verb the plan lists, write one line: the hook that calls it, and what breaks if it is removed. If nothing breaks, remove it. Then read the level off the table and write it into the plan before any code exists. After `claude plugin validate`, the printed `calls:` line must match the plan exactly. A call the validator prints that the plan did not list is a defect in the plan or in the code, and the plan wins until a reason is written down.
