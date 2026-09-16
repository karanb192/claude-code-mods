# claude-code-mods

Claude Mods and the tools to build them. The first tool is `mod-builder`, a skill that plans a mod's capability budget before it writes a line, then validates the result and writes the threat model. The first mod is `fable-pin`, which pins every subagent to one model by rewriting `agent.spawn`. The second is `cache-tax`, the Mod form of the hook of the same name in claude-code-hooks: it stops a cold send once with its price, keeps the 1-hour prompt cache alive for a window you set, and keeps score of what cold writes cost. Both were built with the skill and their READMEs carry the validator output and the threat model. All three install from this marketplace.

## Install

```sh
claude plugin marketplace add karanb192/claude-code-mods
claude plugin install mod-builder@claude-code-mods
claude plugin install fable-pin@claude-code-mods
claude plugin install cache-tax@claude-code-mods
```

Then say "what is a Mod", "find a Mod", "build a Mod", "brainstorm Mods",
"migrate this hook", "review my Mod", "debug my Mod" or "publish my Mod" in
a session, or type `/mod-builder`.

## What a mod is

A Claude Mod is a Claude Code plugin whose `hooks/hooks.json` names a TypeScript module. The module exports `register(on)`, and each hook is `on("event", matcher, async ($, e, next) => result)`. `$` is the engine interface, an object of nouns with verbs on each (`$.ui.log`, `$.fs.write`, `$.process.run`, `$.http.fetch`, `$.model.classify`, `$.agent.spawn`). `e` is the event. `next(e)` runs every hook beneath and then the engine, and returning without `next` answers in the engine's place. The code runs inside Claude Code's own process, with the process's reach, and costs no tokens unless it calls the model.

Anthropic calls the primitive function hooks. The design thread opened on 2026-09-03 and the built-in mods landed in the claude-code repo on 2026-09-09. It is early access. Nothing loads unless `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is set, and the API can change between releases. The design thread is https://github.com/anthropics/claude-code/issues/91870.

## Why a budget

Every `$` call is spelled out in full, so `claude plugin validate` can print what a mod will touch before any of its code runs. That printout is the mod's footprint. The skill treats it as a budget. Every idea must justify each process, file, network, model or UI capability it requests, and the plan states the resulting reach level before code exists. After the validator runs, the printed `calls:` line has to match the plan. A call that is not in the plan gets removed, or the reason it stays gets written down. Nothing widens silently.

Reach levels come from the scanner behind https://github.com/karanb192/awesome-claude-code-mods, which grades every mod on GitHub nightly. L0 draws and remembers. L1 reads files, settings, environment or the transcript. L2 writes files, runs processes or drives Claude. L3 reaches the network. The post that explains the scoreboard is https://karanbansal.in/blog/claude-mods-scoreboard/.

## What the skill asks and produces

Build mode asks one thing before code, which events the mod must observe and what it must be able to do, then shows the surface and the reach level and waits for a yes. It writes `.claude-plugin/plugin.json`, `hooks/hooks.json` and `hooks/register.ts`, adds a tsconfig and a surface module only if the mod draws, runs the validator, pastes the output, diffs the calls against the plan, and ends with a five-line threat model: what it reads, what it runs, what it sends, what it persists, and what happens when its input is hostile.

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

Load it for one session with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .`. The same mod, validated on Claude Code 2.1.272, lives at https://github.com/karanb192/awesome-claude-code-mods/tree/main/examples/hello-mod.

## What is in the skill

- `SKILL.md`, the pipeline, under 300 lines.
- `references/events.md`, every engine event with payload and result, derived from Anthropic's cheat sheet and architecture paper.
- `references/nouns.md`, every `$` noun and verb tagged with its reach level, the same rules the scanner uses.
- `references/gotchas.md`, what people who shipped mods put in their READMEs, each with the URL.
- `references/threat-model.md`, the five-line template with worked examples.
- `references/templates.md`, the file shapes that validate as written.
- `references/reading.md`, every link.
- `scripts/footprint.mjs`, runs the validator, grades reach, diffs calls against the plan, exits 1 on a widened footprint.
- `scripts/list-mods.mjs`, fetches the nightly scan and filters it by keyword.

## License

MIT. See `license`.
