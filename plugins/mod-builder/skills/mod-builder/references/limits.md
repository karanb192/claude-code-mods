# Limits, refusals, log lines and troubleshooting

Read this when a plan has to fit a number, when validate refuses, when a mod does nothing, or when a log line needs reading. Each row carries a stamp `[src: <pointer> | checked <build> | recheck: <trigger>]`. Rows marked observed come from runs on this machine, not from the docs; they are never cited as documented.
<!-- api-check: ignore tool.calls, $.noun.event -->

## Numeric limits
```api-budget
ms
catchMs
lingerMs
```
| Limit | Value | Stamp |
|---|---|---|
| A hook's own time per dispatch (`next` and `$` waits excluded, `$.clock.sleep` included; streaming hooks count only their own code) | 10 s | [src: d.ts HookBudget \| checked 2.1.288 \| recheck: api-check SHAPE DRIFT budget.ms] |
| A `.catch` handler's grace, fresh from its call | 1 s | [src: d.ts HookBudget \| checked 2.1.288 \| recheck: api-check SHAPE DRIFT budget.catchMs] |
| Running on after `next.signal` aborted, before "lingering" is reported | 5 s | [src: d.ts HookBudget \| checked 2.1.288 \| recheck: gate drift line in the budget family] |
| All `session.end` hooks together, `$` waits included | 1.5 s | [src: d.ts SessionEndInput \| checked 2.1.288 \| recheck: api-check SHAPE DRIFT sessionEnd.bound] |
| `$.process.run` timeout; each captured stream | 30 s default, 10 min max; 4194304 bytes | [src: d.ts ProcessRunInit \| checked 2.1.288 \| recheck: api-check SHAPE DRIFT process.run.timeout] |
| `$.process.spawn` unread output before the child blocks | 1048576 characters | [src: d.ts ProcessSpawnChunk \| checked 2.1.288 \| recheck: gate drift line names process.spawn] |
| `$.model.complete` output tokens | 1024 default, up to 64000 or the model's limit | [src: docs reference.md Limits \| checked 2.1.287 \| recheck: gate drift line names model.complete] |
| `$.fs.read`, `$.fs.write` | 4 MiB per file | [src: docs reference.md Limits \| checked 2.1.287 \| recheck: a 4 MiB read succeeds] |
| `$.store` | 4 MiB of JSON in total | [src: d.ts store.set \| checked 2.1.288 \| recheck: api-check SHAPE DRIFT store.cap] |
| `$.session.messages()` | newest 4096 entries | [src: docs reference.md Limits \| checked 2.1.287 \| recheck: gate drift line names session.messages] |
| Prompt or tool-result `context` the model reads whole | 100,000 characters (200,000 together), then a head and a path | [src: d.ts PromptSubmitInput context \| checked 2.1.288 \| recheck: gate drift line names prompt.submit] |
| One `Text` string child; `Code` and `Markdown` source | 10,000 characters | [src: docs reference.md Limits, Elements \| checked 2.1.287 \| recheck: a kit mount of 10,001 characters validates] |
| `Svg` source | 131072 characters | [src: d.ts SvgProps \| checked 2.1.288 \| recheck: gate drift line in the elements family] |
| `Raster`; `Image` | 512 by 256 cells, 1024 colour pairs; 255 by 255 cells, 2 MiB of bytes | [src: docs reference.md Elements, d.ts RasterProps \| checked 2.1.288 \| recheck: gate drift line in the elements family] |
| A `Client` tree or post; one module call | 20,000 nodes, 32 deep, 100,000 characters; 1 s | [src: d.ts ClientElements, ClientModule \| checked 2.1.288 \| recheck: gate drift line in the elements family] |
| Redraws of the visible pane, expanded band, hint line | 30 a second in the terminal, 10 elsewhere | [src: docs reference.md Limits \| checked 2.1.287 \| recheck: a timer redraw test sees another rate] |
| `$.ui.blit` repaints | up to 120 a second taken, about 60 shown | [src: d.ts ui.blit \| checked 2.1.288 \| recheck: gate drift line names ui.blit] |
| `$.ui.toast` | 4 s unless `timeoutMs` | [src: d.ts ui.toast \| checked 2.1.288 \| recheck: gate drift line names ui.toast] |
| A pane opened unasked; docking in fullscreen | from 144 columns, 110 once asked; docks from 110 | [src: d.ts UiOpenResult \| checked 2.1.288 \| recheck: api-check SHAPE DRIFT pane.floor] |
| Command, tool, agent type and pane names | letters, digits, `_`, `-`, up to 64 | [src: docs reference.md Limits \| checked 2.1.287 \| recheck: validate accepts a 65-character name] |
| `$.ui.ask` | 2 to 4 options (fewer are padded with Yes and No), header chip 12 characters | [src: d.ts AskOptions \| checked 2.1.288 \| recheck: gate drift line names $.ui.ask] |
| Matcher depth; `command.run` exit code in `-p` | 8 levels; 0 to 255 | [src: d.ts NarrowDepth, CommandRunResult \| checked 2.1.288 \| recheck: gate drift line names command.run] |
| One `claude plugin test` test | 5 s unless `timeoutMs` | [src: d.ts test, docs reference.md \| checked 2.1.288 \| recheck: a 6 s test passes without timeoutMs] |

## Validator rules and their exact refusals
`claude plugin validate <dir>` (or the manifest path) reads the module statically; `--strict` fails on warnings, `--json` puts each error in `contents[].errors[]` as `{ path, message, code }`. Source-analysis errors start ``<file>, compiled line N `<source>`: `` and most end with the tail `; $ is always spelled $.noun.event(...) at the call site, on is always on("<event>", hook), and next.to always next.to(e, "<tier>")`. Long messages are cut by the validator itself with `… [+N chars]`; there is no flag for the full text. [src: tooling probe on 2.1.288 | checked 2.1.288 | recheck: a validate run prints a prefix not listed here]

| Rule | Visible prefix after the location | Truncated |
|---|---|---|
| Spell every call in full, noun then method; no computed or optional access | `a computed or optional member access on $` | no |
| Never bind, pass or read a noun as a value | `$.ui is used as a value (a noun of $ bound, passed or read)` | no |
| Never bind `$` itself | `$ itself is bound to a name (bound, passed, spread, returned or read)` | no |
| Event names are string literals | `the event name passed to on() is not a string literal` | yes, tail truncated |
| Only declared event names | `"tool.calls" is not an event` | no |
| No dynamic `import()` | `a dynamic import(); a hooks module imports its own files with an import declaration, as in import { name } from "./file.js"` | yes, tail truncated |
| One unmatched registration per event | `on("session.start") is registered twice without a matcher; the first is at` | yes, tail truncated |
| Env names are literals | `$.env.get takes a literal name as its first argument, so the variables a module reads and writes can be listed (got the variable k)` | no |
| Every `$.state` key is declared | `<plugin>.<key> is not declared: the manifest's types contract must name it in interface PluginState { ... }` | no |
| A contract holds only `declare module` and types | ``path "types": line N: `export` at the top level is followed by `type` or `interface`: a contract exports types and nothing else`` | no |
| Names that look like Anthropic's | `Plugin name "<name>" is reserved` (the rest lists `claude-`, `anthropic-`, `anthropics-`, `cc-plugin-`) | no |
| `author` in the manifest (warning; fails only with `--strict`) | `author: No author information provided` | no |

Docs-only rules with no captured text: no second `on` inside `register` (`"on" is declared again (shadowed)`); `$` passes only to a top-level function in the same file (printed `(via name)`); imports stay inside the plugin and the one bare import is `claude-code`; a telemetry hook in an installed mod needs `{ to: 'collector' }`; a `Client` module path is a literal. [src: docs create.md "Check what Claude Code reads", d.ts ClientProps | checked 2.1.287 | recheck: a validate run refuses one of these with new text]

Note lines a passing run prints, per module: `hooks:` (matchers in braces), `calls:` (or `calls: nothing on $`), `env reads:`, `env writes:`, `state reads:`, `state writes:`, `surface modules:`, and for the manifest `types <path> declares on $:` and `types <path> declares state:`. A failed validate still prints them; a hooks.json without `modules` prints no `hooks:` line at all. [src: tooling probe on 2.1.288 | checked 2.1.288 | recheck: footprint parses a note prefix not in this list]

## Debug-log line forms
Written with `claude --debug` or `--debug-file <path>`; grep for the mod's name.

| Line | Status | Means |
|---|---|---|
| `hooks module <name>@inline loaded (worker, environment N, tier user); events: ...` | documented | the module loaded; lists its events (`@<marketplace>` when installed, `@builtin` for built-ins) |
| `hooks module <name>@inline not loaded: <reason>` | documented | refused at load (reasons below) |
| `<name>: <event> hook skipped: <reason>` | documented | a hook threw, timed out or returned the wrong shape |
| `ui.render (<Site>): a hook returned a tree that does not validate` | documented | a drawing was refused; the engine drew its own |
| `hooks module <name>@inline <event> settled in Nms (worker hop, next() included)` | observed on 2.1.288 | that hook ran |
| `$.<noun>.<verb> (<name>): <detail>` | observed on 2.1.288 | that call was made, with its argument summary |
| `[<name>] $.ui.log: <text>`, `[<name>] $.ui.log (to debug): <text>` | observed on 2.1.288 | the mod's own log lines |
| `type root of <name> at <dir>: entries ...; wrote ...` | observed on 2.1.288 | the types and root tsconfig the load wrote |
| `plugin.register: <name> (user, <name>@inline), judged by core alone: admitted` | observed on 2.1.288 | no policy hook refused it |

[src: docs troubleshoot.md "Read the debug log", load logs on 2.1.288 | checked 2.1.288 | recheck: prove's load stage extracts no settled or call lines from a mod that ran]

## Troubleshooting messages and where they appear
A failure line goes to the transcript (dim) only in a session that hot-reloads a plugin folder; to the debug log in other interactive sessions; to stderr in `claude -p --plugin-dir` text runs (`<name>: hooks module not loaded: <reason>`); a refusal by another mod goes to the debug log only. [src: docs troubleshoot.md "Find out why a mod does nothing" | checked 2.1.288 | recheck: a -p refusal stops reaching stderr]

| Message contains | Cause and fix | Where |
|---|---|---|
| `no hooks module to load` (from `claude plugin test` in an empty folder) | mods can load here | shell |
| `hooks modules are turned off here` | `disableAllHooks`, `allowManagedHooksOnly` or a policy; stop and name it | shell |
| `hooks modules are turned off in this process` | installed mods turned off remotely; nothing local fixes it | shell |
| `disableAllHooks in managed settings`, `only managed plugins and built-in plugins run`, `... in this mode (--bare)`, `another plugin of that name loads first` | refusal reasons after `not loaded:`; the last means a name clash | debug log, stderr in `-p` |
| `hooks module did not load:` (`options do not fit plugin.json userConfig:`) | top-level throw with file and line (or a bad option; the line ends naming the `pluginConfigs` entry) | debug log, transcript in hot reload |
| `registered /<cmd> but no command.run hook answered it` | no hook answered, or it was skipped (look for `hook skipped` naming `command.run`) | the command's reply |
| `was unloaded: it crashed the hooks worker` | a hook blocked the shared worker | debug log, transcript |
| `hooks: mods that run in the hooks worker are off for this session: it crashed 3 times` | every non-built-in mod unloaded; `/reload-plugins` restores | transcript, every session |
| `ui.render (Pane) refused: <reason>; the engine drew its own` | the tree did not validate | transcript with `--plugin-dir` |
| `reload failed, the previous version stays loaded:` | a save broke the module; fix and save again | transcript |
| `mods are limited to your organization's by policy (allowManagedModsOnly)` | the guard refused a user mod | debug log, hot-reload transcript |
| `tried to lift a deny rule in your settings` | a `tool.check` approval of a denied call; it stays denied | transcript and debug log, once per mod |
| `a hook changed this call's input after the model wrote it` | auto mode denies a call a hook rewrote | the reason Claude reads |
| `ui.open: focus is true or left out` | `false` passed to `focus`, `closeOnEscape` or `holdToasts` | thrown in the hook |

[src: docs troubleshoot.md, admin.md, interface.md | checked 2.1.287 | recheck: a run prints one of these with different words]

## Observed only (not in the docs)
- `claude -p <text> --plugin-dir <dir>` with no login loads the mod, fires `session.start`, writes the types, then prints `Not logged in · Please run /login` and exits 1. [src: observed | checked 2.1.288 | recheck: a no-login load writes no types or prints another line]
- The engine writes a root `tsconfig.json` only when none exists and never overwrites one, so a stale tsconfig keeps failing `tsc` with `Cannot find module 'claude-code'`. [src: observed | checked 2.1.288 | recheck: a load rewrites an existing tsconfig]
- Bare `npx tsc` installs an unrelated package; use `tsc -p <dir>` or `npx -y -p typescript tsc -p <dir>`. [src: observed | checked 2.1.288 | recheck: npx tsc resolves to TypeScript]
- `claude plugin init --with hooks` writes a classic shell hook and no `modules` key: not a mod scaffold. [src: observed, docs plugin-authoring reference | checked 2.1.288 | recheck: init writes a modules key]
- A kit stub that returns `undefined` for a `$` call skips the mod's hook (`no implementation` or `returned no result` under `the engine reported:`). [src: observed | checked 2.1.288 | recheck: the kit accepts an undefined stub]
- The Desktop Code tab runs its own bundled build, which can lag the CLI; a mod proven on the CLI may not load there. Check the version Desktop logs. [src: third-party report, not reproduced here | checked 2.1.287 | recheck: Desktop logs the same version as the CLI]
- Awaiting `$.prompt.submit` or `$.command.run` inside a hook the running turn waits on hangs or rejects; fire it without awaiting, or from `$.clock.after`. [src: docs api.md, d.ts command.run; hang reported by a third party | checked 2.1.288 | recheck: an awaited submit inside command.run resolves]
- An installed copy and a `--plugin-dir` copy with one name: the first loaded wins and the other logs `another plugin of that name loads first`. [src: docs troubleshoot.md; clash reported by a third party | checked 2.1.287 | recheck: gate's name-clash line and a load log disagree]
