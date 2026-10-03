# mod-builder

A Claude Code skill that plans, writes, validates, proves, reviews, migrates and publishes mods: plugins whose `hooks/hooks.json` names a hooks module exporting `register(on, options)`. Every build ends with evidence files from an isolated load and a handoff that says what was proven and what was not.

## Why it exists next to the built-in skill

Claude Code ships a built-in `plugin-authoring` skill. It tells Claude what a mod is, where the exact type declarations for your build are written, and how to run a mod from a folder, and it writes the mod into a session folder that loads live. Use it to try an idea in the session you are in. mod-builder is for a mod you want to keep or ship. It reads the same generated types for every API shape and does not repeat them. What it adds is the process around the code: a gate that checks your build can load mods at all; a plan that lists every `$` call and names the reach level before code exists; a footprint check that compares `claude plugin validate` with that plan and stops on anything extra; a test that was seen failing before it passed; an isolated harness that loads the mod in a separate Claude Code process and keeps the evidence (the engine's own load and call lines, a typecheck against your build's types, the test run, and a scripted terminal session when the mod draws); a five-line threat model written from the validator's output; a DECISIONS file that lists what was not verified; and a handoff whose status words cannot say a stage passed when it did not run. It also checks itself: `api-check.mjs` reads your build's declarations and reports which names and facts in the skill no longer match, so the skill says "the types win here" instead of being quietly wrong.

## Install

```sh
claude plugin marketplace add karanb192/claude-code-mods
claude plugin install mod-builder@claude-code-mods
```

Run `/reload-plugins` in a session that is already open. Then ask for what you want: "build a mod that ...", "find a mod for ...", "brainstorm mods", "review my mod", "debug my mod", "prove my mod", "migrate my mod", "publish my mod", or type `/mod-builder`.

Requirements: Claude Code 2.1.287 or later (mods are on by default; no flag is needed), Node 18 or later, and TypeScript for the typecheck stage (a global `tsc`, or the skill runs `npx -y -p typescript tsc`). tmux is optional and only needed to drive a mod that draws.

## What a build hands back

The mod's files in the folder you name (or `./<name>/`), never in Claude Code's session folder unless you ask for a live try. Then, in order: the plan, the gate lines, the validator footprint and its diff against the plan, the shapes the code relies on, the proof status block with its run folder, the test result with "seen failing", the threat model, a DECISIONS summary, how to run and keep the mod, and a stamp naming the Claude Code build it was proven on. The skill never installs, enables or copies the mod anywhere itself.

## Stages that need a login

The proof harness runs a separate Claude Code with its own config folder, so it never writes to your real `~/.claude` (it only reads it to check that nothing changed). One stage, and sometimes a second, needs that separate config to be logged in once.

| Stage | Needs a login | Needs tmux |
|---|---|---|
| validate (footprint against the plan) | no | no |
| load (headless load, debug log) | no | no |
| typecheck (against the generated types) | no | no |
| test (`claude plugin test`) | no | no |
| command (runs the mod's slash command headlessly) | only when the command's hook reaches the model | no |
| interactive (scripted terminal session, screen captures) | yes | yes |
| install-smoke (installs through a temporary marketplace) | no | no |
| isolation (checks nothing outside the run folder changed) | no | no |

To log the harness in once:

```sh
CLAUDE_CONFIG_DIR=~/.cache/mod-builder/config claude auth login
```

Without it, the interactive stage reports `unverified (harness home not logged in)`, and a command whose hook reaches the model reports `unverified (harness home not logged in: ...)`. Neither reports a pass it did not earn.

## The harness home

Everything the scripts write lives in `~/.cache/mod-builder/`, or in `$MOD_BUILDER_HOME` if you set it. The folder is created with owner-only permissions, and the scripts refuse to use it if it is a symlink, owned by someone else, or readable by others.

- `config/`: the separate Claude Code config the harness runs with (and its login, if you made one).
- `types/<version>/`: the declarations for each Claude Code build, generated once by loading a tiny probe mod.
- `probe/`: copies of that probe mod.
- `runs/<timestamp>-<name>/`: one folder per proof run, with a copy of the mod, `evidence/`, `status.txt` and `run.json`.
- `strikes.json`: repeated-failure counts, so a stage that fails three times the same way stops the run.

To remove it, log the harness out if you logged it in, then delete the folder:

```sh
CLAUDE_CONFIG_DIR=~/.cache/mod-builder/config claude auth logout
rm -rf ~/.cache/mod-builder
```

Nothing else on your machine depends on it. The next run recreates it.

## What is in the skill

- `skills/mod-builder/SKILL.md`: the modes, the gate, the build pipeline, the handoff contract and the forbidden claims. It is the only file loaded when the skill triggers.
- `skills/mod-builder/references/`: one file per step or topic (plan, build, events, nouns, ui-and-state, limits, testing, proof, threat-model, composing, workflows, migrate, sources, invitation), each read only when its step needs it.
- `skills/mod-builder/scripts/`: `gate.mjs` (can this build load mods, where are the types), `footprint.mjs` (validator output graded and diffed against the plan), `prove.mjs` (the isolated harness), `api-check.mjs` (the skill's names and facts against your build's types; `--mod` lists early-access spellings in a mod), `list-mods.mjs` (the nightly catalogue of every mod on GitHub), `star-invitation.mjs` (records the optional invitation below).
- `skills/mod-builder/data/`: the baseline API map, value checks over the declarations, and the reach rules.
- `skills/mod-builder/tests/`: `node --test` self-tests for the scripts, offline with a stub `claude` and live when a real one is on PATH.

## Optional invitation

After a useful result, the skill may offer one optional star invitation. It records the offer in `~/.cache/claude-code-mods/star-invitation.json` (or under `XDG_CACHE_HOME`) before asking, so later conversations skip it. Clearing the cache or using another machine can reset the record. Starring through the GitHub CLI needs an explicit yes. If the helper cannot run or write its record, the skill skips the invitation.

## License

MIT.
