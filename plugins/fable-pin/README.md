# fable-pin

Every subagent runs on the model you chose, not the one a prompt asked for. This mod rewrites `model` on `agent.spawn` to `fable` unless the spawn is a fork, which inherits the parent's model anyway. `/fable-pin off` turns it off for the session and remembers that, `/fable-pin on` turns it back on, `/fable-pin status` says which.

Why it exists: a standing rule such as "every agent runs on fable" lives in a settings file that the model reads and sometimes ignores. A hook on `agent.spawn` cannot be ignored. The Agent tool's own `model` parameter is what gets rewritten, so the subagent's transcript shows the pinned model as its own.

## What it can reach

Validated on Claude Code 2.1.272:

    ❯ ./register.ts hooks: session.start, command.run{command=fable-pin}, agent.spawn
    ❯ ./register.ts calls: $.command.register, $.store.get, $.store.set

Reach L0, draws and remembers. Sees subagent spawns.

    Threat model for fable-pin (reach L0, draws and remembers)
    1. Reads:    nothing beyond the event payload; one boolean from its own $.store
    2. Runs:     nothing
    3. Sends:    nothing leaves the machine
    4. Persists: one boolean, "enabled", in $.store, until /fable-pin changes it
    5. Hostile input: the only text the mod reads is the /fable-pin argument, compared against two literals; a crafted prompt or tool result cannot reach a process, a file, the network or the model; if the hook throws, the engine skips it and the spawn proceeds unpinned, with one dim line in the transcript

## Install

Function hooks are early access. Nothing loads without the flag.

For one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/fable-pin

To keep it on, add this to `~/.claude/settings.json`, which also loads the hooks module of every other installed plugin that ships one:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

Then from this marketplace:

    claude plugin marketplace add karanb192/claude-code-mods
    claude plugin install fable-pin@claude-code-mods

## Change the target model

`TARGET` at the top of `hooks/register.ts` is the alias or full model id the spawn is rewritten to. An alias resolves the way the Agent tool's `model` parameter does.

## Typecheck

Run `/plugin-types` inside a session in this folder, then `npx tsc -p .` with the tsconfig from the mod-builder templates. Never commit `.claude/types/`.

## Test

    claude plugin test plugins/fable-pin

One test drives `session.start` and two `agent.spawn` calls through the mod with the official kit from `claude-code/testing`: a subagent asking for another model comes out pinned to the target, a fork keeps its model.
