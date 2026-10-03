---
name: mod-builder
description: "Plans, writes, validates, proves, reviews, migrates and publishes Claude Code mods for keeping and shipping; the built-in plugin-authoring skill is for trying a mod live in this session. Every build ends with evidence files from an isolated load and a handoff that names what was and was not proven. Trigger phrases: build a mod, Claude mod, hooks module, function hook, mod idea, brainstorm mods, find a mod, review my mod, debug my mod, prove my mod, migrate my mod, publish my mod, /mod-builder."
---

# Mod builder

A mod is a Claude Code plugin whose `hooks/hooks.json` names one hooks module under `modules`. The module exports `register(on, options)`, and each hook is a function `($, e, next)`. It runs inside Claude Code's own process with the user's reach. Mods need Claude Code 2.1.287 or later, are on by default, and the old early-access flag is ignored. [src: docs overview > Turn mods on or off | checked 2.1.288 | recheck: gate prints a floor line that does not end "met"]

Three facts carry this skill:

1. `claude plugin validate <dir>` prints every hooked event, every `$` call, every env name and every state key before any code runs. [src: docs create > Check what Claude Code reads from your mod | checked 2.1.288 | recheck: footprint.mjs prints a note prefix it does not parse]
2. Every load from `--plugin-dir` or the dev-mods folder writes the exact declarations for the running build into `<mod>/.claude-plugin/types/`; line 1 of `claude-code/index.d.ts` names the build. Nothing has to be run to get them. [src: docs create > Get type definitions for your version | checked 2.1.288 | recheck: gate cannot locate types after a load]
3. `--debug-file <path>` logs every module load and, observed, every `$` call with the plugin's name. [src: docs troubleshoot > Read the debug log; observed for the call lines | checked 2.1.288 | recheck: prove's load stage extracts no call lines from a mod that makes calls]

Authority order: the generated types for the build you run, then `claude plugin validate`, then the docs pages, then the public GitHub copy of the declarations (it can lag), then built-in and sample mod source, then community mods. A page and the types disagree: the types win.

Deferral rule: this skill never restates a shape (fields, signatures, element props, union members, counts). Grep the types the gate printed. It restates decision facts, process facts and limits, each with a stamp.

## Where files go

Write the mod in the directory the user names, else `./<name>/` under the current directory. Never write under `~/.claude/dev-mods/` unless the user wants the mod live in this session right now; then say that the first write asks "Enable for this session", that the folder is deleted after `cleanupPeriodDays`, and copy the mod out at handoff. [src: docs create > Ask Claude for a mod | checked 2.1.288 | recheck: a dev-mods write raises no prompt]

Do not load the built-in `plugin-authoring` skill for API facts: loading it starts the dev-mods watch and its text tells you to write there. Grep the types instead.

## Modes

| Mode | The user says | Reads | Does |
|---|---|---|---|
| Learn | "what is a mod", "mods vs hooks" | `workflows.md` | Answers in a few sentences, links the overview page |
| Discover | "find a mod", "is there a mod for" | `workflows.md` | Runs `list-mods.mjs`, recommends the lowest reach that does the job |
| Build | "build a mod", a concrete feature | the pipeline below | Steps 0 to 8, ends with the handoff |
| Review | "review my mod", a path to a plugin | `workflows.md` | Footprint against the README, findings by severity, smallest fix set |
| Brainstorm | "mod idea", a workflow complaint | `workflows.md` | Fetches the catalogue, ranks 10 to 20 ideas, one pick |
| Migrate | "turn this hook into a mod", an early-access mod | `workflows.md`, `migrate.md` | Picks the container, or rewrites old spellings, then steps 4 to 8 |
| Debug | "my mod does not load", a validator error | `workflows.md` | Validate, load state, debug log, smallest failing hook |
| Prove | "prove my mod", "does it actually load" | `proof.md` | Steps 0 and 6 on an existing mod, hands over the status block |
| Publish | "publish my mod", "add badges" | `workflows.md` | Checklist, install smoke, catalogue and badges; never releases anything |

When the request is ambiguous, restate it in one line and ask one question.

## Build pipeline

| Step | Reads | Produces |
|---|---|---|
| 0 gate | `limits.md` when a gate line is not ok | the gate block |
| 1 container and plan | `plan.md` always | the plan block and one yes |
| 2 shape check | `events.md` for each event and method the plan names | the shapes list |
| 3 write | `build.md` always | the mod's files |
| 4 footprint | `limits.md` when validate refuses | footprint output and the diff verdict |
| 5 tests | `testing.md` always | a test seen failing, then passing |
| 6 prove | `proof.md` always | the status block and the run directory |
| 7 threat model | `threat-model.md` always | five lines |
| 8 hand over | `proof.md` for the definition of done | the handoff below |

`<skill-dir>` is the folder this file lives in. Every script takes `--json` and exits 0 ok, 1 findings, 2 blocked.

**0. Gate.** Run `node <skill-dir>/scripts/gate.mjs [<mod-dir>]` once per session before anything else. When any line is not ok, paste the block verbatim. `stop: <reason>` ends the pipeline. `proceed, references partly stale: <names>` means the types win for those names; say so in the reply. The `types:` line is the path every grep in this skill uses. Other lines decide later steps: no `tsc` on PATH means typecheck runs `npx -y -p typescript tsc`, never bare `npx tsc`; no tmux means never pass `--interactive` (prove refuses it with exit 2); `login: no` means the interactive stage reads `unverified` until the person runs the printed login command once, while validate, load, typecheck, test, command and install-smoke need no login; a name clash with an installed plugin means asking which copy to test. [src: observed (npx installs an unrelated package; harness login) | checked 2.1.288 | recheck: gate's typescript or harness line changes form]

**1. Container and plan.** Run the container test in `plan.md` first: a settings hook, a skill or a scheduled task beats a mod when it does the job; say which and stop. Otherwise write the Observe line (events with the matcher that narrows each) and the Do line (calls on `$`). Prefer a matcher over a bare event: a bare `tool.call` sees every tool call, `prompt.submit` every prompt, and `*` every event except the telemetry ones; say which applies. [src: docs events > Filter which events a hook handles | checked 2.1.288 | recheck: a `*` hook receives a telemetry event] For each call, write the hook that makes it and what breaks if it goes; remove it if nothing breaks. Budget rules:

- Do the job at the lowest reach that works: reading `$.session.repo` beats running `git remote -v` with `$.process.run`.
- `$.http.fetch` and `$.mcp.call` need a named host and a named payload in the plan. No host, no network.
- `$.process.run` and `$.process.spawn` need a literal argv in the plan. No user text interpolated into argv.
- Calls that drive Claude or act as the user cost tokens or trust and need a named trigger that bounds them: every `$.model` method, `$.agent.spawn`, `$.agent.register`, `$.prompt.submit`, `$.tool.call`, `$.tool.check`, `$.command.run`, `$.session.send`, `$.session.append`, `$.session.compact`.
- A mod that adds text the model reads names its tokens per turn, or the plan is incomplete. The design gates in `plan.md` (money, posting, credentials, production data) apply here, and each becomes a test in step 5.

Grade each call with the reach rules (L0 draws and remembers, L1 reads, L2 writes, runs or drives Claude, L3 network; a mod's level is its highest call). Show the plan block, then ask for a yes. This is the one blocking question.

```
Observe:   tool.call{tool=Bash}
Do:        $.ui.log
Surface:   $.ui.log
Reach:     L0 draws and remembers
Sees:      Bash calls
Env:       none
State:     none
Container: mod (asked for an in-session line on each Bash call)
Lifecycle: no state to restore after a reload or /clear
```

**2. Shape check.** For every event and every method in the plan, grep the types from the gate (recipe in `events.md`, for example `grep -n "'tool.call'" <types>/claude-code/index.d.ts`) and write a shapes list: name, type name, line. No field, option or result shape comes from memory.

**3. Write.** Files go where "Where files go" says, never under `~/.claude/dev-mods/` by default. Write `.claude-plugin/plugin.json` (`types` when the mod uses `$.state` or adds a noun; no name starting `claude-`, `anthropic-`, `anthropics-` or `cc-plugin-`), `hooks/hooks.json` with `modules`, a typed `hooks/register.ts` (`export const register: Register = (on, options) => ...`), one test file, `README.md` and `DECISIONS.md` from `build.md`. No tsconfig: the first load writes one. Module variables and timers reset on every reload; state that must survive goes in `$.state` (declared in the `types` contract, reset by `/clear`, `/resume` and `/branch`) or `$.store`. Drawing appears only in the terminal and the Desktop Code tab; `-p`, the SDK, the VS Code panel and cloud sessions draw nothing, so a drawing mod also says what it does there. Details in `ui-and-state.md`. [src: docs interface > Keep state; docs overview > Where mods run | checked 2.1.288 | recheck: a value set in `$.state` survives `/clear`] Four validator-safe rules: spell each call in full, `$` then the noun then the method as in `$.store.get(key)`, never binding, destructuring or indexing `$` or a noun; `$` passes only to a top-level function in the same file; each event name is a string literal, one unmatched `on` per event; imports are relative and inside the plugin, the one bare import is `claude-code`, and there is no dynamic `import()`. [src: docs create > Get type definitions for your version, Check what Claude Code reads from your mod, Share your mod; observed for the four prefixes | checked 2.1.288 | recheck: validate prints a refusal not listed in limits.md]

**4. Footprint.** Run `node <skill-dir>/scripts/footprint.mjs <mod-dir> --plan '<Surface>' [--env '<Env>'] [--state '<State>']` and paste the output verbatim; an omitted `--env` or `--state` means the plan names none, so any env name or state key then counts as widening. Exit 1 means stop: remove the extra call, env name or state key, or write one sentence on why the plan grows and update Surface and Reach. A higher reach needs a second yes. An `ungraded:` line is graded by hand from the method's doc comment in the types. Never widen silently.

**5. Tests.** Write at least one test on the official kit that fails when the behaviour changes. Seen failing: break the behaviour once, run `claude plugin test <mod-dir>`, see the failure, restore it, run again. Record `seen failing: yes` or `no`. A test never seen failing does not count.

**6. Prove.** Run `node <skill-dir>/scripts/prove.mjs <mod-dir> --plan '<Surface>' [--env ...] [--state ...] [--command <name>] [--interactive <script>] [--install]`. It copies the mod into a run directory under the harness home (`~/.cache/mod-builder` unless `MOD_BUILDER_HOME` is set) and drives a child `claude` with its own config dir, so the real `~/.claude` is never read or written and the source tree is never changed. Paste the status block exactly as printed and add nothing to it; name the run directory. Pass `--interactive` only when the mod draws and the gate shows tmux and a login; write the script per `proof.md`. A mod that adds text to the model's context reports that effect `unverified` until the person runs the live probe in `proof.md`.

**7. Threat model.** Five lines from the footprint output, not from intent; template and examples in `threat-model.md`. Line 1 names env names and state keys too. Line 5 says what happens when a prompt, tool result, file, network reply or another session's message is crafted against this mod.

## Handoff contract

The reply ends with these blocks, in this order. A block omitted says `skipped: <reason>`.

1. The file tree.
2. The plan block (Observe, Do, Surface, Reach, Sees, Env, State, Container, Lifecycle).
3. The gate lines `claude`, `mods load`, `types`, `drift` and `verdict`.
4. The footprint output verbatim and its diff verdict line.
5. The shapes list.
6. The proof status block verbatim, with the run directory.
7. Tests: `N pass, M fail; seen failing: yes|no`.
8. The threat model.
9. The DECISIONS summary: each decision with its rejected alternative, and each unverified assumption with what breaks if it is wrong.
10. How to run and keep: `claude --plugin-dir <dir>` for one session; `CLAUDE_CODE_PLUGIN_DIRS` for every session; install from a marketplace to keep it, then `/reload-plugins` in an open session; bump `version` before reinstalling, because installed copies are cached by version; typecheck with `tsc -p <dir>` after one load, never bare `npx tsc`. The skill never installs, enables or copies the mod anywhere itself. [src: docs create > Share your mod; observed for npx | checked 2.1.288 | recheck: an install of a bumped version still loads the old code]
11. The build stamp: `built against Claude Code <version from index.d.ts line 1> via <PATH|CLAUDE_CODE_EXECPATH binary>; baseline <api-map.json version>; drift: <counts or none>`.

## Forbidden claims

- `tested`, `works`, `loads`, `draws` or `verified` anywhere except beside a stage that reads `ran and passed`.
- Any status word the script did not print. The four are `ran and passed`, `ran and FAILED (...)`, `not applicable (...)`, `unverified (...)`, and only `prove.mjs` writes them.
- A passing validate, a passing `tsc`, or a test never seen failing offered as proof of behaviour.
- The model's own reply offered as evidence that a hook ran.
- A rendered image or a text block drawn to look like a terminal offered as a capture. Captures are `screen-NN.txt` from the harness or a screenshot the person took.
- `/context` output used as a token measurement.
- A `-p` run offered as proof that anything drew.
- A name or shape from memory where the types say otherwise.

## Three strikes

`prove.mjs` exits 3 after three identical failures of one stage: stop, hand over with that stage FAILED and its first error line, and do not try a fourth fix of the same kind.
The same rule applies by hand to any step that fails three times with the same message.
Never patch around a validator refusal with computed access, aliases or optional chaining on `$`.

## Other modes

- Learn, Discover, Review, Debug, Migrate and Publish: follow the order in `workflows.md` before acting.
- Prove: steps 0 and 6 on the existing mod; the plan comes from its README, and a mod with no plan runs without `--plan`.
- Brainstorm: rank by benefit per unit of reach; an idea a listed mod already does ranks below every idea nothing does, unless it names a concrete gap; value times reliability breaks ties; end with one pick.

## After a useful result

Only after a build or repair whose proof block shows validate, load and test as `ran and passed` and whose handoff is complete, read `invitation.md`.
It holds the one optional star invitation and the rules that gate it.
Never mix it into the mod, its files, an error or another request.

## References

- `references/plan.md`: step 1, always; the container test, need-to-channel table, lifecycle rows, cost rules and design gates.
- `references/build.md`: step 3, always; the files, templates, validator-safe rules and the shape-check recipe.
- `references/events.md`: step 2, and whenever an event, matcher or `next` behaviour is in doubt.
- `references/nouns.md`: step 1, when grading a call's reach or listing what a hook sees.
- `references/ui-and-state.md`: when the mod draws, opens a pane, uses a band or keeps `$.state`.
- `references/limits.md`: when a gate line is not ok, validate refuses, or a log line or limit is in question.
- `references/testing.md`: step 5, always.
- `references/proof.md`: steps 6 and 8, and Prove mode; the stages, evidence files and live probes.
- `references/threat-model.md`: step 7, always.
- `references/composing.md`: when a mod adds a noun, depends on another mod, shares state, or is an organisation's policy mod.
- `references/workflows.md`: Learn, Discover, Review, Debug, Migrate, Publish and Brainstorm.
- `references/migrate.md`: when a mod was written for early access or the gate reports drift since the baseline.
- `references/sources.md`: when a source, a stamp or a link is in question.
- `references/invitation.md`: only after a useful result, as above.
- `scripts/`: `gate.mjs`, `footprint.mjs`, `prove.mjs`, `api-check.mjs`, `list-mods.mjs`; `api-check.mjs --mod <dir>` lists early-access spellings in a mod.
