# claude-code-mods

Claude Mods and the tools to build them. Four plugins install from this marketplace:

- [image-peek](plugins/image-peek): move the cursor onto a pasted image marker for a large preview pane, with an inline fallback in narrow windows. macOS and Ghostty, with experimental iTerm2 and Herdr support via a startup override.
- [fable-pin](plugins/fable-pin): pin subagents to one model.
- [cache-tax](https://github.com/karanb192/cache-tax): price cold sends and keep the prompt cache warm for a window you set.
- [mod-builder](plugins/mod-builder): plan a mod's capabilities, write it, diff its footprint against the plan, prove it loads in an isolated run, and hand over with evidence.

Each mod's README includes validator output and a threat model. The [landing page](https://claude-code-mods.karanbansal.in/) lists the plugins.

## Install

```sh
claude plugin marketplace add karanb192/claude-code-mods
claude plugin install image-peek@claude-code-mods
claude plugin install mod-builder@claude-code-mods
claude plugin install fable-pin@claude-code-mods
claude plugin install cache-tax@claude-code-mods
```

Then say "what is a Mod", "find a Mod", "build a Mod", "brainstorm Mods",
"migrate this hook", "review my Mod", "debug my Mod" or "publish my Mod" in
a session, or type `/mod-builder`.

## What a mod is

A Claude Mod is a Claude Code plugin whose `hooks/hooks.json` names a JavaScript or TypeScript hooks module. The module exports `register(on, options)`, and each hook is `on("event", matcher, async ($, e, next) => result)`. `$` is the engine interface, an object of nouns with verbs on each (`$.ui.log`, `$.fs.write`, `$.process.run`, `$.http.fetch`, `$.model.classify`, `$.agent.spawn`). `e` is the event. `next(e)` runs every hook beneath and then the engine, and returning without `next` answers in the engine's place. The code runs inside Claude Code's own process, with the process's reach, and costs no tokens unless it calls the model.

Mods require Claude Code 2.1.287 or later and are enabled by default. The old `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` flag is ignored by these versions. See [Anthropic's mod documentation](https://code.claude.com/docs/en/plugins/mods/overview#turn-mods-on-or-off).

## Why a budget

Every `$` call is spelled out in full, so `claude plugin validate` can print what a mod will touch before any of its code runs. That printout is the mod's footprint. The skill treats it as a budget. Every idea must justify each process, file, network, model or UI capability it requests, and the plan states the resulting reach level before code exists. After the validator runs, the printed `calls:` line has to match the plan. A call that is not in the plan gets removed, or the reason it stays gets written down. Nothing widens silently.

Reach levels come from the scanner behind https://github.com/karanb192/awesome-claude-code-mods, which grades every mod on GitHub nightly. L0 draws and remembers. L1 reads files, settings, environment or the transcript. L2 writes files, runs processes or drives Claude. L3 reaches the network. The scoreboard is https://mods.aidojo.si/ and the post that explains it is https://karanbansal.in/blog/claude-mods-scoreboard/.

## What the skill asks and produces

Build mode starts with a gate: it checks the installed Claude Code can load mods, generates this build's type declarations with a headless load, and reports whether the skill's own references have drifted from them. Then it asks one thing before code, which events the mod must observe and what it must be able to do, shows the surface and the reach level, and waits for a yes. Every event and method in the plan is grepped in the generated types before a line is written. It writes `.claude-plugin/plugin.json`, `hooks/hooks.json`, a typed `hooks/register.ts`, one test on the official kit, a README and a DECISIONS file; runs the validator and diffs every call, env name and state key against the plan; requires the test to be seen failing once; proves the mod in an isolated child process with its own config dir (validate, load, typecheck, test, command, and on request an interactive terminal stage and an install smoke test), each stage leaving an evidence file; and ends with a five-line threat model and a handoff whose status words come only from the script.

Brainstorm mode starts from a workflow problem, fetches the nightly scan of every mod on GitHub, and proposes 10 to 20 ideas. Each carries its trigger event, the benefit, the `$` calls, the reach level, the privacy risk in one line, whether it belongs in a mod, a shell hook or an external tool, and the mod that already does it if one exists. The list is ranked by benefit per unit of reach and ends with one pick.

Review mode runs the validator on an existing mod and treats every call the README does not explain as a finding. Discover mode checks the live catalogue before it recommends a Mod. Migrate mode chooses between a skill, classic hook, Mod and external tool. Debug mode starts with the current binary's types and validator output. Publish mode prepares validation, a threat model, README evidence and catalogue badges, but never releases anything automatically.

## A worked example

Ask for a mod that logs one line when a session starts and refuses `rm -rf /` in Bash. The plan comes back first:

```
Observe: session.start; tool.call{tool=Bash}
Do: $.ui.log
Surface: $.ui.log
Reach: L0 draws and remembers
Sees: Bash calls
```

Say yes and three files land:

```ts
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    $.ui.log(`hello-mod loaded in ${e.cwd}`)
    return r
  })
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (typeof e.command === 'string' && e.command.includes('rm -rf /')) return { deny: 'hello-mod refused it' }
    return next(e)
  })
}
```

The validator output gets pasted as printed:

```
❯ ./register.ts hooks: session.start, tool.call{tool=Bash}
❯ ./register.ts calls: $.ui.log
```

The calls line matches the plan, so the threat model follows:

```
Threat model for hello-mod (reach L0, draws and remembers)
1. Reads:    nothing beyond the event payload
2. Runs:     nothing
3. Sends:    nothing leaves the machine
4. Persists: nothing
5. Hostile input: a crafted Bash command can only match or not match one literal string; nothing from e reaches a process, a file or the network
```

Load it for one session with `claude --plugin-dir .`. The same mod lives at https://github.com/karanb192/awesome-claude-code-mods/tree/main/examples/hello-mod.

## What is in the skill

- `SKILL.md`, the pipeline, under 200 lines; the only file loaded when the skill triggers.
- `references/`, one file per step: plan, build, events, nouns, ui-and-state, limits, testing, proof, threat-model, composing, workflows, migrate, sources, invitation. Each restated fact carries a stamp naming its source, the build it was checked on and what would make it stale. Shapes are never restated; the references give the grep into the generated types.
- `data/api-map.json`, the baseline of every event, method, element, site and limit extracted from the build the skill was verified on; `data/api-assertions.json`, value-level checks; `data/reach-rules.json`, the grader.
- `scripts/gate.mjs`, step 0: version floor, can mods load, the types for this build, drift against the baseline, toolchain state.
- `scripts/footprint.mjs`, runs the validator, grades reach, diffs calls, env names and state keys against the plan, exits 1 on a widened footprint or an ungraded call.
- `scripts/api-check.mjs`, reads the running build's types and reports every name in the references that no longer exists, plus what the build added since the baseline.
- `scripts/prove.mjs`, the isolated harness: copies the mod, drives a child `claude` under its own config dir, writes one evidence file per stage and a status block the skill pastes unchanged.
- `scripts/list-mods.mjs`, fetches the nightly scan and filters it by keyword.
- `scripts/star-invitation.mjs`, records the optional invitation before asking.
- `assets/probe-mod/`, the tiny mod the gate loads to make the engine write the types.
- `tests/`, `node --test` suites: offline against a stub `claude`, live when a real one is on PATH.

## Optional invitation

After a useful outcome, the skill may offer one optional star invitation.
It records the offer in `~/.cache/claude-code-mods/star-invitation.json`
(or under `XDG_CACHE_HOME`) before asking, so later conversations skip it.
Clearing the cache or using another machine can reset the record. Starring
through GitHub CLI requires an explicit yes. If the helper cannot run or
write its record, the skill skips the invitation.

## License

MIT. See `license`.
