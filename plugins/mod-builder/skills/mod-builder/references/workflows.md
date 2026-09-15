# Mod workflows beyond building

Read this reference for Learn, Discover, Migrate, Debug or Publish mode.
Function hooks are early access. API truth comes from the source order in
`reading.md`, never from a community Mod alone.

## Learn

Answer in this order:

1. A Mod is a Claude Code plugin that loads TypeScript function hooks inside
   Claude Code.
2. A skill gives Claude instructions. A classic hook runs a shell command when
   an event fires. A Mod can observe or change engine events and draw UI.
3. Name the early-access flag and the current binary's version caveat.
4. Link the official issue first. Link the catalogue only when the reader asks
   for examples or existing Mods.

Do not dump the whole `$` API when a two-sentence explanation answers the
question. Read `events.md` and `nouns.md` only when the user asks how a
specific capability works.

## Discover

Run `node <skill-dir>/scripts/list-mods.mjs <keywords>` before recommending a
community Mod. Search with the user's workflow words, then with likely event
and capability words. Report the scan timestamp, Mod name, URL, reach, what it
sees and the validator status for each recommendation.

Prefer a Mod that solves the job at lower reach. Flag a failed validation or
network reach before suggesting installation. If no hit exists, say "nothing
on the current catalogue" rather than claiming none exists anywhere.

For installation, link the Mod's own README and say that function hooks must
be enabled. Do not install it, enable the global flag, or run its code unless
the user explicitly asks.

## Migrate

Classify the user's current solution before writing code:

| Need | Choose |
|---|---|
| Claude needs instructions or a reusable procedure | Skill |
| One shell command responds to one classic event | Classic hook |
| Code needs engine events, `$`, TypeScript middleware or in-app UI | Mod |
| The job does not need the Claude Code session | External tool |

State the chosen form and why. If the answer is Mod, continue with Build at
step 1. If the answer is not Mod, give the smallest working shape for that
form and stop. Do not convert a working classic hook into a Mod merely because
Mods are newer.

## Debug

Debug in this order:

1. Reproduce with `claude plugin validate .claude-plugin/plugin.json` and
   capture the exact error.
2. In an interactive session, run `/plugin-types`, then inspect the generated
   `.claude/types/claude-code.d.ts` for the event or `$` call in question.
3. Check `hooks/hooks.json` paths, the exported `register(on)`, the enabled
   early-access flag and the current Claude Code version.
4. Reduce the Mod to its smallest failing hook before changing behavior.
5. Run `scripts/footprint.mjs` and compare the resulting hooks and calls to
   the intended plan.

If the current binary conflicts with a reference, report the conflict and use
the current binary. Never patch around a validator error by using computed `$`
access, aliases or optional chaining.

## Publish

Publishing is a handoff, never an automatic release. Before asking the user to
publish, verify:

- `claude plugin validate` passes and the output is pasted into the README.
- The validator output matches the Surface, Reach and Sees lines.
- The five-line threat model matches the validator output.
- The README says how to enable function hooks, install the plugin and disable
  it.
- `/plugin-types` and `tsc` pass when the Mod uses TypeScript or JSX.
- The Mod's source has no secret, token or user-controlled text interpolated
  into process arguments, paths, URLs or prompts.

For a public GitHub repository, explain that the nightly
`awesome-claude-code-mods` scan discovers `hooks/hooks.json` files with a
`modules` key. Provide the badge format and, if discovery has not happened,
offer a PR to `data/seeds.txt`. Do not promise a scan result or a badge before
the public source exists.
