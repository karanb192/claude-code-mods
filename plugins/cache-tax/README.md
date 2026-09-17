# cache-tax, the Mod

The [cache-tax hook](https://github.com/karanb192/claude-code-hooks/tree/main/plugins/cache-tax) shows you the price of coming back to a cold prompt cache. This is the same tool rebuilt as a Claude Mod, running inside Claude Code instead of reading the transcript from disk, and it does three things the hook cannot.

**It stops you once.** Press Enter on a session whose 1-hour cache has lapsed and whose context is over 50k tokens, and the message is dropped before anything is sent, with the price on screen. Press Enter on the same message again and it goes through. One deliberate payment instead of an accidental one. `/cache-tax guard warn` turns that into a price shown while the message sends, which is what the hook does by default.

**It keeps the cache warm for a window you set.** `/keepwarm` arms a six-hour timer (`/keepwarm 90m` for your own window, `/keepwarm always` to arm one at every session start) that re-arms on every model request; after 50 idle minutes it sends one tool-less fork over the session's own transcript, which the server answers from cache, refreshing the hour. A ping costs one cache read, about five cents on 200k tokens, against $4.00 for the re-write. It stops itself the moment a ping reads nothing or writes more than a tenth of what it read. After you pay a cold write, guarded or not, it arms this for you for three hours.

**It keeps score.** `/cache-tax` shows warm or cold, context size, the cold price, the break-even (how many pings cost one cold write, and how much idle that covers), keepwarm state, the guard mode, and this session's cold writes with their total.

Why a mod. A settings hook cannot run on a timer, cannot send a model call, and receives no token counts, so the hook guesses the cache state from the transcript's timestamps and missed compactions until 1.0.2. The mod gets each request's time on `turn.step`, the live context size on `turn.complete`, the compaction itself on `session.compact`, and a `/clear` through the classic SessionStart seam, after which nothing priced before it still exists. Nothing here reads a file.

## Commands

    /keepwarm               keep warm for six hours
    /keepwarm 90m           keep warm for a window of your own (also 2h30m, 6h)
    /keepwarm always        arm a six-hour window at every session start, remembered across sessions
    /keepwarm 6h every 2m   pinging every two minutes; a testing knob, floor 1m, forgotten after this window
    /keepwarm status        the line the status slot shows
    /keepwarm off           stop, forget the window, and turn always off
    /cache-tax              the card
    /cache-tax guard warn   show the price and send (the hook's default)
    /cache-tax guard refuse drop a cold send once, the resend goes through (this mod's default)

The refusal, verbatim:

    cache-tax: the prompt cache went cold 2h00m ago. Sending this re-writes 200,502 tokens at $20/MTok = $4.01 (a warm turn would have cost $0.05). Send it again to pay it, and keepwarm will then hold the cache for 3h00m. Or /clear and start from a note.

The status slot while keepwarm is armed reads `keepwarm 5h10m left · ping in 37m · last ping read 200k $0.05`, and after a stop `keepwarm stopped: the ping read 0 and wrote 180k tokens ($3.60), the cache was already gone`.

## Both forms installed

The hook and the mod share a name and a job, so having both means two guards on every cold send. The mod checks at session start whether the hook's `/cache-tax:status` command exists and says so once. Keep one. The hook stays for people who have not turned on function hooks. One thing to know before uninstalling the hook: the 🧊 row in a status line wired to `cache-tax.js` comes from the hook's files, and a mod cannot draw into the status line.

## What it can reach

Validated on Claude Code 2.1.272 and 2.1.273:

    ❯ Validating hooks: /Users/karanbansal/GitHub/.worktrees/ccm-product/plugins/cache-tax/hooks/hooks.json
    ❯ ./register.ts calls: $.clock.after (via arm), $.clock.now, $.command.list, $.command.register, $.model.fork (via ping), $.session.usage, $.store.delete (via startWindow, stop), $.store.get, $.store.set, $.ui.log, $.ui.status

Reach L2, drives Claude. Sees every prompt you type, every model request's timing and every answer's token counts.

    Threat model for cache-tax (reach L2, drives Claude)
    1. Reads:    of each prompt, whether it starts with a slash and nothing else (the text is passed on untouched, never kept, never logged); the time; the token counts and model id the engine already holds on turn.complete and on the fork's reply; the resume fields Claude Code computes for settings hooks; the command list once at start; four values from its own $.store
    2. Runs:     one $.model.fork per idle stretch inside a keepwarm window, one per ping period (50 minutes unless the testing knob set it, floor 1 minute), never outside the window, never after a readback that read nothing or wrote more than a tenth of what it read
    3. Sends:    nothing leaves the machine except the fork, an API request over the session's own transcript with a fixed one-line prompt
    4. Persists: the keepwarm deadline, the ping period, the always switch and the guard mode in $.store; the session's cold-write tally lives in memory and dies with the session
    5. Hostile input: the only text it parses is the argument of its two commands, matched against a duration regex and five literals; of the prompt text only the first non-blank character is inspected, for a slash; tool results and files never reach a branch; the fork's prompt is a constant, so nothing crafted can be sent through it; a refusal only ever drops the user's own message, and the resend is unconditional; if a hook throws, the engine skips it and the message enters unguarded, with one dim line

## Cost and the plan-limit question

Prices are the list table, where Fable 5.1 reads at $0.25, writes the 1h tier at $20 and answers at $50 per million tokens; Sonnet 5 has its own row ($0.20, $4, $10). On an API key the arithmetic is plain. A ping bills the cache read, its own few uncached tokens at the base rate, and whatever the model says back at the output rate; the figure in the status slot counts all of it, since a fork takes no output cap and a model at high effort may think before it says "warm". A comeback after the lapse is a write. The card prints the read-only upper bound for your model, 80 pings on Fable 5.1, with the idle that covers at the current ping period; a real ping costs a little more than a read, so the true break-even sits below that number. On a subscription the dollars are a yardstick, not the bill, and how a cache read weighs against the 5-hour and weekly limits is not documented anywhere I could find. Watch the rate-limit row of your status line during the first window.

## Limits

- Function hooks are early access; nothing loads without `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, and the API can change between releases.
- The hour and the 50-minute ping assume the 1-hour tier, which is what the main conversation uses.
- A ping that reads warm proves the cache was warm then. A model or effort switch, an edited CLAUDE.md or a changed tool list invalidates the prefix regardless of time, and the next real message pays.
- The guard fires on the second cold send of a resumed session only if Claude Code passed the resume fields; on older versions the first turn seeds it.
- The cold-write tally is per session and in memory; /clear empties it.
- Context size is the engine's live window figure. A turn's own usage is its responses summed, which on a ten-step turn is ten reads of the context, so it is only the fallback where the host reports no live figure.

## Install

For one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/cache-tax

To keep it on, add this to `~/.claude/settings.json`, which also loads the hooks module of every other installed plugin that ships one:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

Then from this marketplace:

    claude plugin marketplace add karanb192/claude-code-mods
    claude plugin install cache-tax@claude-code-mods

## Prove it on your own session

The mock-clock tests prove the timer, the guard and the scoring, not that a fork hits the main cache. One ping proves that, and it costs one cache read. In any warm session:

    > Reply with one word: ready
    > /keepwarm 1h every 1m

Watch the status slot after a minute. `last ping read 20k $0.01` with a read close to your context size means the fork shared the cache and refreshed it. `keepwarm stopped: the ping wrote ...` means it did not, and the mod has already turned itself off; please open an issue with the two numbers. A terminal that cannot reach your login shows `stopped: the engine did not send the ping, either the snapshot was cold or the API call failed` instead.

## Tests and typecheck

`claude plugin test plugins/cache-tax` runs twenty-six tests on the mock clock: the bare command, the always switch seeded with a stale window and a testing knob, a partial write and a zero read stopping the loop while a ping's own few tokens do not, output and uncached input in the ping figure with Sonnet 5 priced as itself, the break-even line, the refusal and the resend, slash commands and warm and small sends passing, warn mode, a paid cold write scored and arming keepwarm, context taken from the live window rather than a turn's summed usage, /clear forgetting everything, an unguarded full miss scored, silence after a compaction, the resume seeding, the both-forms notice, and the keepwarm cases from 0.1. For types, run `/plugin-types` inside a session in this folder, then `npx -p typescript tsc -p .`. Never commit `.claude/types/`.
