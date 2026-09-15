# Reading list

Everything the skill relies on, with the URL. Fetch before trusting any shape; the API is early access.

## Anthropic

- The design thread for function hooks, with the architecture PDF, demo videos, the cheat sheet and the updates: https://github.com/anthropics/claude-code/issues/91870
- The `$` cheat sheet (an SVG; every noun and verb, every engine event, the five tiers, the failure and recursion rules, the UI elements): https://github.com/user-attachments/assets/2fad9a87-d37f-4e00-9d4e-1aadf9326e77
- Function Hooks: Core Architecture (PDF, Alice Poteat, August 2026): https://github.com/user-attachments/files/31802150/EXTERNAL.Function.Hooks.Core.Architecture.pdf
- Anthropic's built-in mods (`diff`, `sec-default`, `telemetry`), the test kit (`claude plugin test <dir>`, `claude-code/testing` with `mock.env`, `mock.store`, `mock.clock`), and the noun-contract convention: https://github.com/anthropics/claude-code/tree/main/mods
- The tsconfig those mods build with: https://github.com/anthropics/claude-code/blob/main/mods/tsconfig.json
- The type declarations those mods are written against, the same file `/plugin-types` writes; every event and every `$` signature on the current binary: https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts

## The scanner and the list

- Every mod on GitHub with its footprint and reach level, rescanned nightly: https://github.com/karanb192/awesome-claude-code-mods
- The raw data the brainstorm mode fetches (`mods[]` with `id`, `repo`, `name`, `description`, `kind`, `hooks[]`, `calls[]`, `reach{level,labels}`, `sees[]`, `validate{status}`, `stars`, `url`): https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/data/mods.json
- The reach rules copied into `nouns.md`: https://github.com/karanb192/awesome-claude-code-mods/blob/main/tools/grade.mjs
- How to get the two badges and how a mod gets listed: https://github.com/karanb192/awesome-claude-code-mods/blob/main/contributing.md
- The scoreboard page, generated from the same data and served from `docs/` in the list repo: https://mods.karanbansal.in/ (the custom domain was being set up on 2026-09-15; if it does not resolve, open `docs/index.html` in the list repo)
- The smallest working mod, validated on 2.1.272: https://github.com/karanb192/awesome-claude-code-mods/tree/main/examples/hello-mod
- The post that explains the scoreboard and the reach idea: https://karanbansal.in/blog/claude-mods-scoreboard/

## Mods whose READMEs taught the gotchas

- cc-arcade (surface modules, `h`, string-literal Client paths, half-terminal band, ten redraws a second, hot-reload failure): https://github.com/sezaakgun/cc-arcade
- claude-games (same rules, independently stated): https://github.com/mohi-devhub/claude-games
- cc-pokedex: https://github.com/deonmenezes/claude-mods-pokedex
- Mindful-Claude (ten redraws a second on the surface's own clock, `/plugin-types` then `tsc`): https://github.com/halluton/Mindful-Claude
- cc-pr-tracker (limited rows above the prompt, `tsc` fails until `/plugin-types` runs): https://github.com/sezaakgun/cc-pr-tracker
- Arunjay4213/claude-mods (regenerate types after an update): https://github.com/Arunjay4213/claude-mods
- claude-mermaid (plain-art fallback where colour is stripped): https://github.com/galElmalah/claude-mermaid

## Local commands (Claude Code 2.1.272)

- `claude plugin validate .claude-plugin/plugin.json` prints the footprint; `--json` gives it as `contents[].notes[]`; `--strict` turns warnings into errors.
- `claude plugin validate .` at a repo root validates a marketplace manifest.
- `/plugin-types` inside a session writes `.claude/types/`. Never commit it.
- `claude plugin test <dir>` runs the test kit. Documented in Anthropic's mods README; not verified on the machine this skill was written on.
- `claude --plugin-dir <dir>` loads a mod from a folder and hot-reloads on save.
