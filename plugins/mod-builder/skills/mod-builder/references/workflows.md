# Workflows beyond building

Read this for Learn, Discover, Review, Debug, Migrate, Publish or Brainstorm. API truth comes from the types the gate printed and from `claude plugin validate`, never from a community mod or a catalogue row. `<skill-dir>` is the folder that holds SKILL.md.

## Learn

Answer in this order, in a few sentences:

1. A mod is a Claude Code plugin whose hooks module runs inside Claude Code and handles the engine's events as functions `($, e, next)`.
2. A skill gives Claude instructions. A settings hook is a shell command, HTTP request or prompt that Claude Code runs on a lifecycle event (admins also see agent hooks). An MCP server gives Claude tools. A mod can observe, rewrite or answer engine events, call `$`, and draw in the terminal and the Desktop Code tab. [src: docs overview > Compare mods, settings hooks, skills, and MCP servers; docs admin (hook types) | checked 2.1.288 | recheck: the overview's comparison table gains or loses a row]
3. The version: the floor the gate prints or later; mods are on by default and the early-access flag is ignored. Run `node <skill-dir>/scripts/gate.mjs` to show the user's own build. [src: docs overview > Turn mods on or off | checked 2.1.288 | recheck: gate's floor line changes]
4. Link the overview first: https://code.claude.com/docs/en/plugins/mods/overview. Link the catalogue only when the user asks for examples or existing mods.

Do not dump the API when two sentences answer the question. Read `events.md` or `nouns.md` only for a question about a specific capability, and answer shapes by grepping the types, never from memory.

## Discover

Run `node <skill-dir>/scripts/list-mods.mjs <keywords>` before recommending any community mod. Search with the user's workflow words first, then with likely event and capability words. Report, for each hit: name, URL, reach, what it sees, validate status. Report once: the scan time and the build the catalogue was scanned on (the first output line). When that build is newer than the user's, say so.

- Prefer the mod that does the job at the lowest reach.
- Flag a failed validation, L2 or L3 reach before suggesting an install.
- No hit: say "nothing on the current catalogue", never "nothing exists".
- The fetch failed: say so and that nothing was checked. Never fall back to a remembered list of categories.

Installing: say which Claude Code version the mod's README names, then give its route, usually `/plugin marketplace add <repo>` and `/plugin install <name>@<marketplace>`, or `/reload-plugins` after a shell install. Never install, enable or run a mod unless the user explicitly asks. [src: docs overview > Install or update a mod | checked 2.1.288 | recheck: an install from the README route fails]

## Migrate

Two kinds of request come here.

**Should this be a mod.** Classify the current solution before writing code; `plan.md` holds the full container test.

| Need | Choose |
|---|---|
| Claude needs instructions or a reusable procedure | Skill |
| One shell command responds to one classic event | Settings hook |
| Work runs on a schedule with no session events | Scheduled task |
| Code needs engine events, `$`, middleware or in-app drawing | Mod |
| The job does not need the Claude Code session | External tool |

State the chosen form and why. Mod: continue with Build at step 1. Anything else: give the smallest working shape for that form and stop. Do not convert a working settings hook into a mod because mods are newer.

**A mod written for early access.**

1. Run `claude plugin validate <dir>`. The duplicate-hook, dynamic-import and name-prefix refusals come from here with exact text; `limits.md` maps each to its fix.
2. Run `node <skill-dir>/scripts/api-check.mjs --mod <dir>`. Each `MIGRATE <id> <file>:<line>: <old> -> <new>` line is one early-access spelling; `migrate.md` holds the table behind every id it prints, `M.early` included.
3. Apply each row. A hit that is not really the old form stays, with one sentence why.
4. Run the Build pipeline from step 4 through the handoff. The typecheck stage also catches an untyped `register` and an old tsconfig include that the scan missed.

## Debug

Debug in this order and stop at the first step that names the cause:

1. `claude plugin validate <dir>`. Paste the exact error. A pass with no `hooks:` line means `hooks/hooks.json` has settings hooks and no `modules` key; a file with neither key fails. [src: docs troubleshoot > `validate` passes and lists no `hooks` line | checked 2.1.288 | recheck: a mod without modules prints a hooks line]
2. `node <skill-dir>/scripts/gate.mjs <dir>`: the floor, and whether mods can load at all. `no hooks module to load` from an empty dir means they can; `turned off here` names a setting; `turned off in this process` means installed mods were switched off remotely. [src: docs troubleshoot > Check whether mods can load | checked 2.1.288 | recheck: gate's mods load line shows a message not in limits.md]
3. Load with a debug log: `claude --debug-file ./mod-debug.log --plugin-dir <dir>`, then `grep -n '<name>' ./mod-debug.log` for `not loaded:`, `did not load`, `hook skipped:`, `refused by`, `does not validate` and `no command.run hook answered it`. Or run `node <skill-dir>/scripts/prove.mjs <dir>`, which does the same in an isolated home and keeps the log as `evidence/load.log`.
4. Know where the failure line appears: dim in the transcript only in a session that hot-reloads a plugin directory; otherwise only in the debug log; on stderr in a `claude -p --plugin-dir` text run. [src: docs troubleshoot > Find out why a mod does nothing | checked 2.1.288 | recheck: a skipped hook in an installed mod prints a transcript line]
5. Grep the types for the event or call in doubt (recipe in `events.md`).
6. Reduce the mod to its smallest failing hook before changing behaviour.
7. Run `footprint.mjs` and compare hooks, calls, env names and state keys with the intended plan.

Common causes, each in `limits.md` or `ui-and-state.md`: edits that never reach an installed copy (installed copies are cached by version); a value that resets on reload (module variables); a value that resets after `/clear`, `/resume` or `/branch` (`$.state`, restored from `$.store` in a `classic.SessionStart` hook); a pane that never appears (the column floor and the placed result of `$.ui.open`).

If the build conflicts with a reference, report the conflict and follow the types. Never patch around a validator refusal with computed access, aliases or optional chaining on `$`.

## Review

Review an existing mod in this order. Report findings by severity, each with the exact file and the event or `$` call.

1. Footprint against the README: take the README's "What it can reach" section (Surface, Reach, Sees, Env, State) as the plan and run `footprint.mjs <dir> --plan '...' --env '...' --state '...'`. Every call, env name or state key the README does not explain is a finding.
2. Each event against `events.md`. Flag unbounded visibility, such as a bare `tool.call`, `prompt.submit`, `session.append` or `skill.prompt`, or a `*` hook, where a matcher would do the job.
3. Each call against `nouns.md`. Flag a call of higher reach than the job needs, an unnamed network host, and non-literal input in a process argument, path, URL or prompt.
4. `next`. Flag a hook that never calls `next(e)` on an event core must act on, unless it deliberately answers; flag a return while `next` is pending, which aborts what runs beneath. A deliberate second `next(e)` on `tool.call` is a retry, not a finding. A hook whose failure the user must notice has a `.catch`, which gets a 1 s grace. [src: docs events > Guard or change a tool call; d.ts HookBudget | checked 2.1.288 | recheck: a grep for HookBudget in the types finds nothing]
5. `api-check.mjs --mod <dir>` for early-access spellings.
6. The threat model and README against the footprint. A missing claim is a finding even when the code is harmless.
7. `prove.mjs <dir>` (validate, load, typecheck, test). Paste the status block and state what it did not prove.

End with the smallest fix set. Do not rewrite the mod or raise its reach unless the user asks for the implementation.

## Publish

Publishing is a handoff, never an automatic release, push or post. Before asking the user to publish, verify:

- The latest proof block reads `ran and passed` for validate, load, typecheck and test, and the tests were seen failing.
- The footprint matches the README's Surface, Reach, Sees, Env and State lines, and the threat model matches the footprint.
- The README states the version triple (built on: types line 1; validated on; requires: the floor), how to install, and how to turn the mod off in `/plugin`.
- `version` in `plugin.json` is higher than the last installed copy, because installed copies are cached by version.
- The name does not start with `claude-`, `anthropic-`, `anthropics-` or `cc-plugin-`.
- No secret, token or user-controlled text reaches a process argument, path, URL or prompt.
- For the installed route, `prove.mjs <dir> --install` runs an install smoke through a temporary marketplace under the harness home. It needs no login: it passes on the debug log's loaded line.

[src: docs create > Share your mod; observed for the prefix list | checked 2.1.288 | recheck: validate passes a name with one of these prefixes]

Sharing routes: the directory or a zip for a few people; a marketplace of your own (a folder or repo with `.claude-plugin/marketplace.json`) for a team; managed settings for an organisation; a public marketplace repo or Anthropic's plugin directory for anyone. [src: docs create > Share your mod | checked 2.1.288 | recheck: the page's route list changes]

For a public GitHub repo, the nightly scan behind https://github.com/karanb192/awesome-claude-code-mods lists any repo that ships `hooks/hooks.json` with a `modules` key. The badges are `https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/badges/OWNER--REPO--NAME-reach.svg` and the same with `-validates.svg`, where `NAME` is the `name` in `plugin.json`. To be listed sooner, offer a pull request that adds `owner/repo` to `data/seeds.txt` there. The scoreboard is https://mods.aidojo.si/. Never promise a scan result or a badge before the public source exists. [src: observed (list README and contributing page) | checked 2.1.288 | recheck: list-mods.mjs fails to fetch or a badge URL returns 404]

## Brainstorm

1. Start from the workflow problem: the moment in the user's day that hurts, in one sentence. Do not start from what mods can do.
2. Fetch what exists: `node <skill-dir>/scripts/list-mods.mjs` for every mod, or with keywords to filter (all words must match). Report the count, the scan time and the catalogue's build. Derive the covered categories from that result. If the fetch fails, say so and fill the Exists column with "not checked".
3. Propose 10 to 20 ideas, one row each, every column filled:

| Column | Content |
|---|---|
| Idea | one line |
| Trigger | the event with its matcher |
| Benefit | what the user gets, one line |
| Calls | the `$` calls, graded from `nouns.md` |
| Reach | L0 to L3, the highest call |
| Risk | privacy or security, one line |
| Form | mod, settings hook, skill, scheduled task or external tool, with the reason |
| Exists | the mod that already does it with its URL, "nothing on the list", or "not checked" |
| Score | value (1 to 3) times reliability (1 to 3); reliability is how deterministic the trigger signal is |

Form rules: a settings hook when one command on one classic event does the job; a skill when Claude only needs instructions; an external tool when the job needs neither the session's events nor `$`; a mod otherwise.

4. Rank by benefit per unit of reach. With equal benefit, the lower reach wins. An idea a listed mod already does ranks below every idea nothing does, unless it names a concrete gap in that mod. Score breaks the remaining ties.
5. End with the ranked table and one pick, with the reason in one sentence. Offer to build the pick in Build mode.

A Brainstorm reply always holds the fetch result line, the table, the ranking and the one pick.
