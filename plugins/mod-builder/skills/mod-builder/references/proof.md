# Proof: the harness, the status words, and what may be claimed

Read this at the Prove step, in Prove mode, and before writing any sentence that says a mod works. A mod is done when files a stranger can open show it loaded and behaved, and the handoff never reports a stage that did not run. The harness writes those files and the status block; the skill pastes the block and adds nothing to it. Stamp legend: `[src: <pointer> | checked <build> | recheck: <trigger>]`.

## Run it

```sh
node <skill>/scripts/prove.mjs <mod-dir> --plan '<Surface line>' [--env '<names>'] [--state '<keys>'] \
  [--command <name>] [--interactive <script>] [--install] [--continue] [--json]
```

Exit 0 all run stages passed, 1 a stage FAILED, 2 blocked (no `claude` at or above the floor, no `claude plugin test`, no TypeScript route, no tmux for `--interactive`, unusable harness home), 3 three strikes. Preconditions never skip silently. [src: scripts/prove.mjs | checked 2.1.288 | recheck: tests/scripts.test.mjs fails on an exit code]

The harness home is `$MOD_BUILDER_HOME` or `~/.cache/mod-builder` (created 0700; refused when a symlink, owned by another user, or readable by group or others). Each run copies the mod to `<home>/runs/<yyyymmdd-hhmmss>-<name>/mod/` (without `.claude-plugin/types/`, `node_modules/`, `.git/`), records `source.sha256`, and writes `evidence/`, `status.txt` and `run.json`. Every child runs with `CLAUDE_CONFIG_DIR=<home>/config`, `--strict-mcp-config`, the early-access flag removed from its environment, and the run folder as its working directory, so the person's own config is never read or written. [src: scripts/prove.mjs | checked 2.1.288 | recheck: the isolation stage fails on a clean run]

Only the interactive stage needs a model, so it needs one login to the harness home: `CLAUDE_CONFIG_DIR=<home>/config claude auth login`. Validate, load, typecheck, test, command and install-smoke need none: a `-p` load with no login still loads the mod, fires `session.start`, writes the types, and runs a `/command` the mod registered before it prints `Not logged in · Please run /login` and exits 1 (observed). A command whose hook itself reaches the model reads `unverified (harness home not logged in: ...)` instead. [src: observed | checked 2.1.288 | recheck: a no-login load stops writing types, or a no-login `-p "/cmd"` stops answering]

## Stages and evidence files

| Stage | Runs | Passes when | Evidence |
|---|---|---|---|
| validate | `claude plugin validate --strict --json`, then the footprint diff against `--plan`, `--env`, `--state` | validate succeeds and nothing widens or goes ungraded | `validate.json`, `footprint.txt` |
| load | `claude -p ok --plugin-dir <run>/mod --debug-file evidence/load.log`, 90 s | the log has `hooks module <name>@inline loaded (` and no `not loaded`, `hook skipped:` or `did not load` for the mod | `load.log` (events, `settled in` lines, `$` call lines, `$.ui.log` lines and the type-root line are extracted as extra evidence) |
| typecheck | `tsc -p` (or `npx -y -p typescript tsc -p`) after the load wrote the types; a root tsconfig that does not extend the generated one is swapped in the run copy with a warning | exit 0 | `tsc.txt` |
| test | `claude plugin test <run>/mod` | exit 0 and at least one pass; no test file reads `not applicable (no test files)` | `test.txt` |
| command | when the footprint lists `command.run{command=X}` or `--command X`: `claude -p "/X"` | exit 0, the log shows `command.run settled` for the mod and no `no command.run hook answered it` | `evidence/command.out`, `evidence/command.log` |
| interactive | only with `--interactive <script>`: a private tmux server, 200 by 50, `claude --plugin-dir` | every `expect` matched and the loaded line is in the log | `stream.raw`, `screen-NN.txt`, `screen-NN.ansi`, `interactive.log` |
| install-smoke | only with `--install`: a temp marketplace, `claude plugin marketplace add`, `claude plugin install <name>@<mkt> --scope user`, then a plain `claude -p ok` | the same load check, with no `--plugin-dir` | its load log under `evidence/` |
| isolation | always | no log names the real `~/.claude` or `~/.claude.json`; no loaded line from another provenance than `@inline`, `@builtin` or the temp marketplace; the real config files and `~/.claude/projects/` unchanged; the source tree hashes unchanged | the isolation line in `status.txt` and `run.json` |

The load pass condition is the documented loaded line alone; the `settled in`, `$.<noun>.<verb> (<name>)` and `[<name>] $.ui.log` lines are observed forms that add evidence and never decide a pass. [src: docs troubleshoot.md "Read the debug log"; load logs observed | checked 2.1.288 | recheck: the load stage passes with no loaded line, or extracts nothing from a mod that ran]

Interactive script lines: `type TEXT` (sends the text, then Escape, then Enter; Escape closes a typeahead suggestion that would otherwise run instead of the text), `key NAME`, `expect TEXT` (polls 20 s, saves the screen and fails naming the text), `wait MS`, `screen`. The session is ready at the prompt marker plus 5 s for the loaded line, because the banner can draw before the mod loads. First-run prompts are answered from a table of observed texts at the top of `prove.mjs`; every capture masks `sk-ant-` tokens; the server is killed on every exit path. [src: third-party observations built into prove.mjs, not yet reproduced here | checked 2.1.287 | recheck: the interactive stage times out on a first-run prompt not in the table]

## Status words
The block uses four stage words and nothing else:
- `ran and passed`
- `ran and FAILED (<first error line>)`
- `not applicable (<reason>)`
- `unverified (<reason>)`, for a stage that should run and could not: `unverified (harness home not logged in: ...)`, `unverified (needs a live probe: steps in proof.md)`. A missing tmux is a precondition, not a stage word: `prove.mjs --interactive` refuses to start with exit 2, so a drawing mod on a machine with no tmux reports `ui evidence: unverified (interactive not requested)`.

`ui evidence:` reads `status line only`, `drawn and driven (screen-NN.txt)`, `not applicable`, or `unverified (<reason>)`. The words tested, works, loads, draws and verified appear in a reply only beside a stage that reads `ran and passed`. The skill never writes or edits a status word: a stage the script did not run cannot appear as passed. [src: scripts/prove.mjs status block | checked 2.1.288 | recheck: a handoff carries a status word not in this list]

Shape of the block (placeholders, not a run):
```text
proof: <name> on Claude Code <version from types line 1> (<PATH|CLAUDE_CODE_EXECPATH> binary), run <home>/runs/<stamp>-<name>
validate:      <status>   evidence/validate.json; <plan diff verdict>
load:          <status>   evidence/load.log: hooks module <name>@inline loaded; events: <list>
typecheck:     <status>   evidence/tsc.txt
test:          <status>   evidence/test.txt
command:       <status>
interactive:   <status>
install-smoke: <status>
isolation:     <status>
ui evidence:   <value>
```

## What each kind of mod must show

| The mod | Stages that must read `ran and passed` |
|---|---|
| Hooks only (guards, rewrites, logging) | validate, load, typecheck, test, isolation |
| Adds a command | the above plus command (no login needed unless the hook reaches the model) |
| Draws a pane, band or site | the above plus interactive, with a script that opens and drives what it draws; a `-p` run never counts |
| Injects text the model reads (`prompt.context`, `prompt.section`, `prompt.submit` context, tool-result context, `session.append`) | the above plus the live probe below, with the person's quoted lines pasted |
| Meant to be installed, not run from a folder | the above plus install-smoke |

When a required stage reads `not applicable` or `unverified`, the mod is not done: the handoff names the stage and its reason, and the person decides whether to run it.

Definition of done: every stage the table names reads `ran and passed`, or carries `unverified` or `not applicable` with its reason in the handoff; the test was seen failing once (change the behaviour, run the kit, see the failure, change it back); and the handoff carries the build stamp. A stage with zero tests, a `-p` run, or a passing validate never stands in for a missing stage. [src: scripts/prove.mjs, docs overview.md "Where mods run" | checked 2.1.288 | recheck: a mod meeting this definition fails in a fresh session]

## What a stage proves and what it cannot
- validate: what the module declares and reaches, and that the engine can read it; not behaviour.
- load: that this build loads it and which hooks ran at `session.start`; not drawing (`-p` draws nothing; panes count as placed and unseen).
- typecheck: the code fits the shapes this build wrote; not behaviour.
- test: the hooks' logic against stubs, and validity of a tree per surface; not that the engine loads it, not how an app paints it.
- interactive: real screen text in the terminal under a script; never the Desktop app, VS Code or a phone.
- install-smoke: the installed route and the version cache; not other machines.
[src: docs test.md, overview.md | checked 2.1.288 | recheck: a stage starts covering what this list says it cannot]

## Live probes for text the model reads
The harness cannot see what the model read. For a context mod the person runs a probe in a real session and pastes the quoted lines; the skill writes the questions and reads the answers.

Probe rules:
- Quote, do not confirm: ask the model for the exact line it received, never yes or no.
- Use a fresh marker line for every probe, so an earlier answer cannot be repeated.
- Open each session with a neutral message (`Reply with the single word: ready`) so history does not anchor the answer.
- Keep a control session with no `--plugin-dir` beside the probed one.
- Never use `/context` as a measurement: it adds tokens of its own (reported by a third party, not measured here).
[src: third-party probe method adopted as rules | checked 2.1.287 | recheck: a control session quotes a line it never received]

Seven steps:
1. Before turning the mod on: ask for the marker line; expect NONE.
2. On: ask again; expect the exact line.
3. A later turn: ask again; expect it still there, or the plan's stated lifetime.
4. `/compact` with the instruction "drop every quoted line", then ask; record what survived.
5. Off: ask; expect NONE.
6. On, then `/clear`, then ask for the mod's status; expect the default unless the mod reloads from `classic.SessionStart`.
7. One cheap subagent: ask it for the line and record the answer either way (subagent visibility is not documented).
Then install the mod for real and repeat step 2 in a plain session.
[src: docs interface.md "Load a saved value again after /clear"; probe method observed | checked 2.1.287 | recheck: a step's expected answer differs in a control session]

A scratch diagnostic when a context mod seems to do nothing: a throwaway mod that injects one marker, flips it on a command, writes `$.ui.log` with `{ to: 'debug' }` when its hook runs, and reads `$.prompt.compose()` inside `turn.step`; comparing the log, the composed prompt and the model's answer separates "the hook did not run" from "the hook ran and the request did not change". It never ships in a deliverable. [src: d.ts prompt.compose, ui.log | checked 2.1.288 | recheck: gate drift line names prompt.compose]

## Three strikes
A failure signature is `<stage>:<first error line>`, kept per mod path and source hash in `strikes.json`. The third identical consecutive failure exits 3 with `three strikes on <stage>: stop and report`; the skill stops and hands over with that stage FAILED. A pass or a different signature resets the count. [src: scripts/prove.mjs | checked 2.1.288 | recheck: the self-test for three strikes fails]

## Forbidden claims
- "It works" from validate alone or from `tsc` alone.
- Any drawing claim from a `-p` run, and any Desktop or VS Code claim without the person's own confirmation.
- The model's reply as evidence that a hook ran; the debug-log line is the evidence.
- "Tested" without a test that was seen failing when the behaviour changed.
- A rendered or hand-made image or text block presented as a screen; captures are only `screen-NN.txt`, `screen-NN.ansi` or a real screen capture the person took, each named by path.
- A pass, or any status word, on a stage the script did not run; the block is pasted, never written.
- An API declared absent because a docs page omits it, or present because a community mod uses it; the types decide.
- `/context` output as a token count.

[src: docs overview.md "Where mods run", reference.md note on the types | checked 2.1.287 | recheck: a handoff makes one of these claims and a reviewer accepts it]

## Worked example
Run on this machine with `node scripts/prove.mjs assets/probe-mod --plan '$.command.register,$.env.get,$.state.get,$.state.set,$.ui.log' --env MOD_BUILDER_PROBE --state probe-mod.runs`, exit 0. The block below is the script's output, pasted unchanged; the run directory path is shortened to `~`. [src: observed | checked 2.1.288 | recheck: the same command prints a different stage word]

```
proof: probe-mod on Claude Code 2.1.288 (types line 1; PATH binary), run ~/.cache/mod-builder/runs/20261003-164753-probe-mod
validate:      ran and passed             evidence/validate.json; plan and footprint match
load:          ran and passed             evidence/load.log: hooks module probe-mod@inline loaded; events: session.start, command.run
typecheck:     ran and passed             evidence/tsc.txt (tsc 5.9.3)
test:          ran and passed (1 pass, 0 fail)   evidence/test.txt
command:       ran and passed             evidence/command.out: "probe-mod: probe-mod: 1 start(s) seen"; command.log: probe-mod@inline command.run settled
interactive:   not applicable (not requested)
install-smoke: not applicable (not requested)
isolation:     ran and passed             source unchanged, no real config touched
ui evidence:   not applicable
```

Below the block the script printed the load lines it extracted from `evidence/load.log`: the documented `loaded` line with the events list, the `type root of` line naming the six files the load wrote, the `session.start settled in 9.8ms` line, one `$.command.register (probe-mod): /probe-mod listed` call line, and the mod's own `[probe-mod] $.ui.log (to debug): probe-mod: start 1` line. The command stage ran `claude -p "/probe-mod"` with no login and got the command's text back, which is why it reads `ran and passed` rather than `unverified`.
