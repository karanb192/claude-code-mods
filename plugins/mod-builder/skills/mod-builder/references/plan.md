# Plan a mod (Build step 1)

Read at step 1, before any code exists, with events.md for the Observe names and nouns.md for the Do names. The output is the plan block in section 7, the one SKILL.md shows and the handoff carries: the container verdict, the Observe and Do lines, the lifecycle rows, one channel row per piece of text or state, the cost line, the gates, then Surface, Reach, Sees, Env, State, Failure and Uninstall. Shapes are not decided here: step 2 greps them from the types the gate printed (build.md). Stamp legend: sources.md.

## 1. Container test

Decide what kind of thing the request is before naming any event. A mod is the right container only when the feature needs at least one of these:

- state shared across events in one process (count tool calls, then answer a command with the count);
- something drawn live: a pane, a band above the prompt, a restyled or replaced row;
- a slash command answered in process, with no Claude turn;
- stepping into an event in process: rewrite or deny a tool call, rewrite a prompt, a subagent's model, a section of the system prompt.

[src: docs overview > Compare mods, settings hooks, skills, and MCP servers | checked 2.1.288 | recheck: that comparison table changes]

Otherwise name the other container and stop:

| Verdict | When | Hand over instead |
|---|---|---|
| settings hook | one script on one lifecycle event can block, allow, rewrite or log; nothing drawn, no state across events | the script and its settings entry; say "a settings hook is enough" |
| skill | the person keeps pasting the same instructions, or wants Claude to work differently | a SKILL.md, or one line in the project's instructions |
| scheduled task | the work must run while no session is open | the person's scheduler, or a scheduled cloud agent |
| external tool | Claude needs tools that reach an outside system | an MCP server |
| not buildable | changing the permission prompt; anything before the trust prompt is answered or before plugins load; drawing in `claude -p`, the SDK, the VS Code panel or a cloud session | the reason and its source line |

[src: docs admin > Know which controls still apply (permission prompt, trust prompt); docs overview > Where mods run | checked 2.1.288 | recheck: either page changes those lines]

When the person asked for a mod by name and the request also fits the settings-hook row (a guard that denies a call, for example), give the settings-hook alternative in one line and build the mod unless they switch. A deny on a tool call counts as stepping into an event. Decided; no source.

A mod that replaces a working settings hook keeps the hook until the mod is proven on every session type it must cover. Decided; no source.

## 2. Observe and Do

Write two lines before anything else, and infer both when the person gave a feature instead of events.

- Observe: each event with the matcher that narrows it, names from events.md. Prefer `tool.call{tool=Bash}` over `tool.call`.
- Do: what the mod must do, as methods on `$`, names from nouns.md.

What a bare hook sees, so the plan can say it: `tool.call` with no matcher sees every tool call, subagent and MCP calls included; `prompt.submit` sees every prompt; `*` sees every event except `telemetry.*`, which must be hooked by name. [src: docs events > Filter which events a hook handles; docs reference > Telemetry | checked 2.1.288 | recheck: gate prints drift touching tool.call, or a `*` hook receives a telemetry event]

Then one line per method: the hook that calls it, and what breaks if it is removed. Remove every method where nothing breaks.

## 3. Lifecycle rows

Five rows, each with a value and where it came from (a doc comment in the types, a docs heading, or "decided"). A row left blank is the most common cause of a mod that works once and then not again.

| Row | The question | Facts that decide it |
|---|---|---|
| engage | what turns it on: the load, a command, a matcher, an option | `session.start` fires once per loaded mod before the first prompt and again when that mod reloads; never after `/clear`, `/resume` or `/branch` [src: d.ts EngineEventOf session.start \| checked 2.1.288 \| recheck: gate prints drift touching session.start] |
| persist across reload | what a save during development or `/reload-plugins` keeps | `register` runs again in a fresh environment: module variables and timers are gone; `$.state` and `$.store` keep their values [src: docs create > Keep working on a mod; d.ts state noun \| checked 2.1.288 \| recheck: gate prints drift touching $.state] |
| survive /clear | what `/clear`, `/resume`, `/branch` do to it | every `$.state` value returns to its default and no `session.start` follows; reload from `$.store` in a `classic.SessionStart` hook matched on source `clear`, `resume`, `fork`; `session.end` fires first with reason `clear` [src: docs interface > Keep state; d.ts SessionEndInput \| checked 2.1.288 \| recheck: the classic SessionStart source union in the types drops clear, resume or fork] |
| survive compaction | what the model still knows after `/compact` | text a turn carried (prompt context, tool result context, appended rows) is summarised with the history; system prompt sections are sent again; `prompt.context` is computed again; a `session.compact` hook can rewrite or skip; `classic.SessionStart` fires with source `compact` and resets nothing [src: d.ts EngineEventOf prompt.context; docs interface > Keep state \| checked 2.1.288 \| recheck: gate prints drift touching prompt.context or session.compact] |
| visible to subagents | does it act for subagents too | `tool.call`, `turn.step`, `turn.complete` and `session.append` fire for subagents and carry the subagent's id; `agent.spawn` is where a subagent's model or prompt changes; a main-loop-only rule checks that id is absent [src: d.ts EngineEventOf turn.step, turn.complete; docs events > Follow a turn; docs events > Guard or change a tool call; docs reference > Session \| checked 2.1.288 \| recheck: a grep for TurnCompleteInput in the types finds nothing] |

## 4. Need to channel, with tokens per turn

One row per piece of text or state the mod handles: the need, the channel, and what it costs the person in tokens per turn. Text the model reads is the only thing that costs tokens; drawing and storing cost none. A plan that injects text and names no token cost is incomplete: estimate characters divided by four and write the number.

| Need | Channel | Tokens per turn |
|---|---|---|
| text the model reads with one prompt | a `prompt.submit` hook adding context on the way down | its size on that turn; it then rides in the history on every later request until compaction |
| text fixed before the first request | `prompt.context` (once per conversation) | its size once, then in the history like the first message |
| a standing instruction on every request | `prompt.section`, or `prompt.compose` with a `session` section | its size on every request, read from the prompt cache while it stays the same |
| a note beside one tool's result | a `tool.call` result carrying context | per matched call; past 100,000 characters the model reads a head and a path |
| a note after a command | a `command.run` result carrying context | once per run; the person never sees it |
| a tool Claude can call | `$.tool.register` plus a `tool.call` hook | the description on every request (cached), the result per call |
| a refusal | a matched `tool.call` hook returning a deny | the reason text, only when it refuses |
| what each stored row says | `session.append` | nothing added unless the hook adds text; it sees every row |
| state for this session | `$.state` | 0 |
| state across sessions | `$.store` | 0 |
| an indicator | `$.ui.status`, `$.ui.toast`, `$.ui.notice`, a band | 0; draws only in the terminal and the Desktop Code tab |
| work in the background | `$.clock.after`, `$.clock.every` | 0; timers die on reload |
| a command with no turn | `$.command.register` plus a `command.run` hook | 0 unless the result carries context |
| a question to the person | `$.ui.ask` | 0; it rejects on dismiss and in `claude -p` |

[src: d.ts PromptSubmitResult, CommandRunResult, ToolCallResult (context docs), EngineEventOf prompt.section, prompt.context, tool.describe; docs interface > Keep state; docs overview > Where mods run | checked 2.1.288 | recheck: a grep for one of those names in the types finds nothing]

Never measure a channel with `/context`; proof.md says why and what to run instead.

## 5. Cost rules

Write one cost line in the plan when the Do line drives Claude or the Observe line answers a cached event.

- Prompt-cache breakers. Anything that changes the cached prefix between requests bills it again: an answer to `prompt.section`, `tool.describe` or `prompt.context` that differs from the last one; `$.ui.invalidate` on those events when nothing changed; text that varies inside a `shared` section of `prompt.compose`; a model switch. Compute the text once, answer the same text until its content really changes, invalidate only then. [src: d.ts EngineEventOf prompt.section and tool.describe ("an unstable answer spends the prompt cache"), PromptComposeScope, PreModelSwitchHookInput prompt_cache_warm | checked 2.1.288 | recheck: a grep for one of those names in the types finds nothing]
- Fork or complete. `$.model.fork` sends the main thread's last request again with one prompt after it: it sees the whole transcript, the API serves that prefix from the cache, every tool is denied, and the prefix is billed afresh once the cache entry lapsed or after a model switch. `$.model.complete` sees only its own prompt and system text. Fork when the answer needs the conversation; complete, on a small model, when the input fits in the prompt. A fork whose result usage shows almost no cache reads paid for the whole prefix. [src: d.ts model noun (fork, complete), ModelUsage | checked 2.1.288 | recheck: gate prints drift touching $.model.fork]
- Free reads. `$.session.usage()` with no argument costs nothing; the full breakdown calls the token-count API, so keep it out of hot paths. [src: d.ts session noun usage | checked 2.1.288 | recheck: a grep for SessionUsageArgs in the types finds nothing]
- Per-turn gates for every call that drives Claude (`$.model.*`, `$.agent.spawn`, `$.prompt.submit`, `$.tool.call`, `$.command.run`, `$.session.send`, `$.session.append`): hook `turn.complete`; act for the main loop only (no subagent id), only when the turn ended with an answer and was not aborted, only when something worth acting on happened; keep an off switch in `$.store` and a rate limit; start the call after `next(e)` resolved and never hold the turn on it. The field names are in `TurnCompleteInput` (grep recipe in build.md). [src: d.ts TurnCompleteInput, TurnCompleteReason | checked 2.1.288 | recheck: a grep for TurnCompleteInput in the types finds nothing]
- `$.model.*` spends the person's plan or API key. [src: docs admin > Review what a mod can do | checked 2.1.288 | recheck: that table changes]

## 6. Design gates

When the mod touches money, posting or publishing, credentials, a production system, or legal or case data:

- The mod may only annotate (`$.ui.notice`, `$.ui.status`, `$.ui.toast`, a band), draft (`$.prompt.fill`), or ask (a command the person runs, `$.ui.ask`).
- `$.prompt.submit` only from a command the person ran, scheduled with `$.clock.after`, and never awaited inside the `command.run` hook that holds the turn (limits.md has the hang). It waits for the session to go idle and resolves when its turn starts, not when it ends. Never `asUser` for gated text: that sends it as the person's own words. [src: docs api > Start a turn from a background job; d.ts PromptSubmitResult, PromptSubmitInput asUser | checked 2.1.288 | recheck: a grep for PromptSubmitInput in the types finds nothing]
- Never approve a tool call: no `tool.check` hook answering allow, no `tool.call` hook answering in core's place for a gated tool. A mod that approves can lift an `ask` rule, and in auto mode its approval skips the classifier (threat-model.md).
- The gate becomes a test that counts calls to the forbidden method and expects 0 (testing.md), and a line in the README.

## 7. Surface block, the spec extras, and the one question

The budget rules, kept from the previous version:

- A lower level wins: reading `$.session.repo` beats running git with `$.process.run`.
- `$.http.fetch` and `$.mcp.call` name the host and the payload in the plan. No host, no network.
- `$.process.run` names a literal argv. No user text interpolated into argv.
- Every method that drives Claude names the trigger that bounds how often it runs (the list in section 5).

Two rows the spec also carries: failure modes (each failure degrades to one text line; nothing throws into the person's turn) and uninstall (what is left behind: the `$.store` keys by name, any file written).

```
Container: mod (<which of the four needs>)
Observe:   tool.call{tool=Bash}, command.run{command=NAME}
Do:        $.store.get, $.store.set, $.command.register
Lifecycle: engage <...>; reload <...>; /clear <...>; compaction <...>; subagents <...>
Channels:  <need> -> <channel>, <N> tokens per turn
Cost:      <cache, fork or complete, gate> or "drives nothing"
Gates:     <annotate | draft | ask> or "none needed"
Surface:   $.store.get, $.store.set, $.command.register
Reach:     L0 draws and remembers (persists state)
Sees:      Bash calls
Env:       none
State:     none
Failure:   <what the person sees>; Uninstall: <what is left>
```

Reach levels and labels come from nouns.md and `data/reach-rules.json`, written as footprint.mjs prints them: `L<n> <level name> (<labels>)`; `Env:` lists literal variable names and `State:` lists `<plugin>.<key>`, because the validator prints both and footprint.mjs diffs them.

Show the block and ask one question: "Build this?", naming the one choice that changes the build if the answer is no. This is the only blocking question in the pipeline. A reach level that rises after code exists needs a second yes.
