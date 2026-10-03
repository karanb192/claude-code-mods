# Migrate: early-access mods to 2.1.287 or later

Read this in Migrate mode, or in Review when a mod predates the public release. Run `node <skill>/scripts/api-check.mjs --mod <dir>` first: it prints `MIGRATE <id> <file>:<line>: <old> -> <new>` for every row marked "scan" below. Rows marked "validate" surface as refusals in `claude plugin validate`; rows marked "review" need a reader. Then apply the table, run the footprint and prove the result like any build. Stamp legend: `[src: <pointer> | checked <build> | recheck: <trigger>]`.
<!-- api-check: ignore ui.selection, $.ui.selection -->

## Early access to 2.1.287

| Id | Old (early access) | New (2.1.287 or later) | Caught by |
|---|---|---|---|
| M.flag | `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in a README, settings or scripts | Delete it; 2.1.287 and later ignore it at any value and mods are on by default | scan |
| M.types | `/plugin-types` in a README or script; `.claude/types/` in tsconfig or `.gitignore` | Delete; every load from `--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS` or dev-mods writes `.claude-plugin/types/`, which ignores itself | scan |
| M.tsconfig | tsconfig `include` naming `.claude/types` | Delete the tsconfig (the engine writes one that extends `./.claude-plugin/types/tsconfig.json`) or make it that one line; the engine never replaces an existing tsconfig, so a stale one fails `tsc` with `Cannot find module 'claude-code'` | scan |
| M.desc | a description or README saying "Needs function hooks" or "early access" | Drop it; the README says "Claude Code 2.1.287 or later" and the version it was tested on | scan |
| M.register | `export function register(on)`, untyped | `import type { Register } from 'claude-code'` and `export const register: Register = (on, options) => ...`; strict `tsc` fails on the implicit any otherwise | scan |
| M.resolve | `await $.ui.resolve(e)` | `$.ui.resolve(e)`; it is synchronous | scan |
| M.npx | `npx tsc -p .` | `tsc -p <dir>` or `npx -y -p typescript tsc -p <dir>`; bare `npx tsc` installs an unrelated package | scan |
| M.deps | tsconfig `include` pointing at another mod's `types/` to use its noun | List the provider under `dependencies` in plugin.json; the engine writes its contract into `.claude-plugin/types/<plugin>/index.d.ts` | review |
| M.spawn | `agent.spawn` or `$.agent.spawn` read as the finished agent's text | It resolves once the agent started; the answer is that agent's own `turn.complete` | review |
| M.surface | "nothing draws on Desktop", `Svg` assumed in the terminal | The Desktop Code tab draws; branch on `e.surface` and the element tables in `ui-and-state.md` | review |
| M.telemetry | a `*` hook expected to see telemetry | Hook `telemetry.*` by name with `{ to: 'collector' }`; `*` never selects telemetry | validate |
| M.dup | a second unmatched `on('<event>')` for one event | One per event, or a matcher on each | validate |
| M.catch | a `.catch` described or relied on as a 10 s grace | The grace is 1 s, fresh from the handler's call | review |
| M.retry | a review rule "call `next` exactly once" | A second `next(e)` on `tool.call` is a documented retry; flag only a `next` never called where core must act, or a return while `next` is pending | review |
| M.sources | links to the cheat sheet, the architecture paper or the tracking issue | The docs pages under code.claude.com/docs/en/plugins/mods/ and the types the build writes | review |

[src: docs overview.md "Turn mods on or off", create.md "Get the types for your build", events.md, d.ts Register, ui.resolve, AgentSpawnResult, HookBudget; tooling probe on 2.1.288 | checked 2.1.288 | recheck: api-check --mod misses a pattern this table names]

## Meanings that changed (review by hand)
- `prompt.context` fires once per conversation for the first message, not per turn. [src: docs reference.md Prompts | checked 2.1.288 | recheck: gate drift line names prompt.context]
- `turn.complete` carries the answer and fires for subagent turns too; `{ text }` is the result, not the input. [src: d.ts EngineEventOf 'turn.complete' | checked 2.1.288 | recheck: gate drift line names turn.complete]
- `session.start` fires once per loaded mod and on each reload, never after `/clear`, `/resume`, `/branch`; reload `$.state` from `classic.SessionStart`. [src: docs reference.md Session | checked 2.1.288 | recheck: gate drift line names session.start]
- `agent.offer` withholds a type and cannot add one; `$.agent.register` adds. [src: d.ts AgentOfferInput | checked 2.1.288 | recheck: gate drift line names agent.offer]
- An unstubbed `$` call in a kit test rejects inside the mod and skips the hook; the test fails only at a later assertion. [src: docs test.md | checked 2.1.288 | recheck: a kit run throws at the unstubbed call]
- The dim failure line appears only in sessions that hot-reload a plugin folder; installed mods log to the debug log. [src: docs troubleshoot.md | checked 2.1.287 | recheck: an installed mod's skip reaches the transcript]
- Redraws are throttled to 30 a second in the terminal for the visible pane, band and hint line, 10 elsewhere. [src: docs reference.md Limits | checked 2.1.287 | recheck: a timer redraw test sees another rate]
- New since early access, worth a second look in any old mod: `$.state` with its contract, `$.process.spawn`, `$.session.append`, `$.session.send`, `$.tool.check`, `$.ui.open` resolving `isPlaced`, and the events `session.end`, `session.append`, `prompt.compose`, `prompt.attachment`, `ui.close`, `ui.focus`, `ui.scroll`. [src: docs reference.md | checked 2.1.288 | recheck: gate drift line names one of them]

## Since the baseline

The baseline is the build `data/api-map.json` was extracted from. Each later build the gate reports gets one entry here: what was added or removed, with a pointer to its doc comment. A name listed here is in no `api-*` block until the baseline is regenerated, so the gate reports it as uncovered.

### 2.1.288
- `+ $.ui.selection` (method, under `$.ui`) and `+ ui.selection` (op event): resolves what the person last selected with the mouse, as copy would take it, with the transcript row it lies in; `undefined` with nothing selected, with fullscreen off, in `-p`, and on a remote surface. [src: d.ts CoreEngineInterface ui selection | checked 2.1.288 | recheck: gate drift line stops listing ui.selection]
- Reach: the seed rules grade it L0 through `ui.*`, but it reads transcript text the person chose; grade it by hand as reading the transcript until a rule names it. [src: data/reach-rules.json | checked 2.1.288 | recheck: a rule for ui.selection lands in data/reach-rules.json]
- No other event, method, element, site, tier or budget value changed between 2.1.287 and 2.1.288. [src: name diff of the 2.1.287 snapshot and the types a 2.1.288 load wrote | checked 2.1.288 | recheck: gate drift line names anything else]
