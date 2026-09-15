# cache-warm

Claude Code's main conversation rides a 1-hour prompt cache. Come back at minute 59 and your next message costs cents; come back at minute 61 and the whole context is re-written at the cache-write rate, 80x a read on Fable 5.1. This mod keeps the cache alive on purpose for a window you set. `/keepwarm 6h` arms a timer that re-arms on every model request; after 50 idle minutes it sends one tool-less fork over the session's own transcript, which the server answers from cache and refreshes the timer. A ping costs one cache read of your context, about $0.05 on 200k tokens, against a $4.00 re-write.

It stops itself. A ping whose usage shows a write instead of a read means the cache was already gone, so pinging on would pay the write again; the mod turns off and says so in its status slot. When the engine reports a cold snapshot it never sends the fork at all. `/keepwarm off` and `/keepwarm status` do what they say. The window survives a restart of the session; the timer arms again after the first turn.

Why a mod and not a hook: a settings hook only runs when an event fires, and nothing fires while you sit idle at the prompt. It also cannot send a request. `$.clock.after` runs inside the live process while the session idles, and `$.model.fork` sends a completion that shares the main thread's prompt cache and appends nothing to the transcript.

The countdown starts from the last model request, not the last turn: `turn.step` stamps the moment each request goes out, and `turn.complete` re-arms after the last one. Subagent requests use a different prefix and are ignored.

## Commands

    /keepwarm 6h            keep warm for six hours (also 90m, 2h30m)
    /keepwarm 6h every 2m   same, pinging every two minutes; a testing knob, floor 1m
    /keepwarm status        the line the status slot shows
    /keepwarm off           stop, forget the window

Status slot while armed: `keepwarm 5h10m left · ping in 37m · last ping read 200k $0.05`. Stopped: `keepwarm stopped: the ping wrote 180k tokens ($3.60), the cache was already gone`.

## What it can reach

Validated on Claude Code 2.1.272:

    ❯ ./register.ts hooks: session.start, command.run{command=keepwarm}, turn.step, turn.complete
    ❯ ./register.ts calls: $.clock.after (via arm), $.clock.now, $.command.register, $.model.fork (via ping), $.store.get, $.store.set, $.ui.status

Reach L2, drives Claude. Sees the timing of every model request and nothing of its content.

    Threat model for cache-warm (reach L2, drives Claude)
    1. Reads:    the time; two numbers from its own $.store; the token counts and model id the engine already holds on turn.complete and on the fork's reply
    2. Runs:     one $.model.fork per idle stretch inside the window, at most one per 50 minutes (1 minute floor), never outside the window, never after a cold readback
    3. Sends:    nothing leaves the machine except the fork itself, which is an API request over the session's own transcript with a fixed one-line prompt
    4. Persists: the deadline and the ping period in $.store, until /keepwarm off or the window ends
    5. Hostile input: the only text it parses is the /keepwarm argument, matched against a duration regex and three literals; prompt text, tool results and files never reach it; the fork's prompt is a constant, so nothing crafted can be sent through it; if a hook throws, the engine skips it and the session runs unwarmed, with one dim line

## Cost and the plan-limit question

Prices are the same list table as [cache-tax](https://github.com/karanb192/claude-code-hooks/tree/main/plugins/cache-tax): Fable 5.1 reads at $0.25 and writes the 1h tier at $20 per million tokens. On an API key the arithmetic is plain: a ping is a read, a comeback after the lapse is a write, and 80 pings cost one write. On a subscription the dollars are a yardstick, not the bill, and how a cache read weighs against the 5-hour and weekly limits is not documented anywhere I could find. Watch the rate-limit row of your status line during the first window.

## Limits

- Function hooks are early access; nothing loads without `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, and the API can change between releases.
- The 50-minute period assumes the 1-hour tier, which is what the main conversation uses. Nothing here helps a 5-minute cache.
- A ping that reads warm proves the cache was warm at that moment. It does not prove the next real message will hit: a model or effort switch, an edited CLAUDE.md or a changed tool list invalidates the prefix regardless of time.
- The mod cannot see the compaction request or a subagent's cost; it only accounts for its own forks.

## Install

For one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/cache-warm

To keep it on, add this to `~/.claude/settings.json`, which also loads the hooks module of every other installed plugin that ships one:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

Then from this marketplace:

    claude plugin marketplace add karanb192/claude-code-mods
    claude plugin install cache-warm@claude-code-mods

## Prove it on your own session

The mock-clock tests prove the timer logic, not that a fork hits the main cache. One ping proves that, and it costs one cache read. In any warm session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/cache-warm
    > Reply with one word: ready
    > /keepwarm 1h every 1m

Watch the status slot after a minute. `last ping read 20k $0.01` with a read close to your context size means the fork shared the cache and refreshed it. `keepwarm stopped: the ping wrote ...` means it did not, and the mod has already turned itself off; please open an issue with the two numbers. A nested terminal that cannot reach your login shows `stopped: the engine reported a cold snapshot` instead, because the fork never reached the API.

## Tests and typecheck

`claude plugin test plugins/cache-warm` runs seven tests on the mock clock: the 50-minute ping, the reset on a new turn, the cold-readback stop, the null-fork stop, the window end, `off`, and subagent turns being ignored. For types, run `/plugin-types` inside a session in this folder, then `npx -p typescript tsc -p .`. Never commit `.claude/types/`.
