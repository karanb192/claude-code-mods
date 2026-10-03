# Sources

Read this when a source, a stamp or a link is in question. The skill fetches nothing at trigger time; these are the places to look.

## Authority order

1. The types the running build writes into `<mod>/.claude-plugin/types/` on every load; line 1 of `claude-code/index.d.ts` names the build, and the gate prints the path.
2. `claude plugin validate <dir>` on that mod and build.
3. The docs pages below.
4. The public GitHub copy of the declarations. It can be older than your build.
5. Built-in and sample mod source.
6. Community mods and the catalogue: examples and discovery only, never API authority.

When a lower item disagrees with a higher one, state the conflict and follow the higher one. Never call an API absent because a page or the GitHub copy omits it, nor present because a community mod uses it: grep the types.

## Stamp legend

Every restated fact carries `[src: <pointer> | checked <build> | recheck: <observable trigger>]`. Pointers: `d.ts <TypeName>` (grep that name in the types the gate printed); `docs <page> > <heading>` (https://code.claude.com/docs/en/plugins/mods/<page>, at that heading); `observed` (seen in a real run on the build named, not documented, so true for that build only). `checked` is the build on which the fact was last confirmed. `recheck` is an event that should send you back to the source, such as a gate drift line or a validate message not listed in `limits.md`, never a date.

## Docs pages

- Overview (what a mod is, turning mods on, where mods run, built-in mods): https://code.claude.com/docs/en/plugins/mods/overview
- Create (write, validate, test and share a mod; where types are written): https://code.claude.com/docs/en/plugins/mods/create
- Interface (render sites, elements, panes, keys, `$.state`): https://code.claude.com/docs/en/plugins/mods/interface
- Events (observe, rewrite, answer; tool guards; order of mods; failing hooks): https://code.claude.com/docs/en/plugins/mods/events
- API (commands, tools, model calls, background work, messages between sessions): https://code.claude.com/docs/en/plugins/mods/api
- Test (the kit, stubs, timers, drawings): https://code.claude.com/docs/en/plugins/mods/test
- Troubleshoot (load failures, skipped hooks, the debug log): https://code.claude.com/docs/en/plugins/mods/troubleshoot
- Admin (the built-in guard, deny rules, policy mods, review table): https://code.claude.com/docs/en/plugins/mods/admin
- Reference (files, events, methods, render sites, elements, limits, settings, commands): https://code.claude.com/docs/en/plugins/mods/reference
- Gallery (what each element looks like): https://code.claude.com/docs/en/plugins/mods/gallery
- Every page's index: https://code.claude.com/docs/llms.txt; the launch post: https://claude.dev/blog/getting-started-with-claude-code-mods/

## The built-in skill

Claude Code ships a built-in `plugin-authoring` skill (plugin `cc-plugin-plugin-authoring`, no mod code). It is the narrative: what a plugin of function hooks is, the drawing walkthrough, and work that outlives a dispatch. Read its reference for prose, read the types for shapes; this skill adds the plan, footprint, tests, proof and threat model. Loading it starts the session's dev-mods watch, so this skill does not load it. [src: docs overview > Mods built into Claude Code; docs create > Ask Claude for a mod | checked 2.1.288 | recheck: `/plugin` lists the built-in under another name]

## Anthropic source

- Built-in mods (`agents-md`, `diff`, `sec-default`, `telemetry`): https://github.com/anthropics/claude-code/tree/main/mods
- Public copy of the declarations (can lag your build): https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts
- Sample mods (`token-weather`, `blast-radius`, `replay-theater`), each a complete plugin: https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods

## The catalogue

- Every mod on GitHub with its footprint and reach, rescanned nightly: https://github.com/karanb192/awesome-claude-code-mods
- The data `list-mods.mjs` reads: https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/data/mods.json
- The scanner's reach grader, mirrored by `data/reach-rules.json`: https://github.com/karanb192/awesome-claude-code-mods/blob/main/tools/grade.mjs
- How a mod gets listed and badged: https://github.com/karanb192/awesome-claude-code-mods/blob/main/contributing.md
- The scoreboard, https://mods.aidojo.si/ (behind a bot shield; open it in a browser), and the post on reach levels: https://karanbansal.in/blog/claude-mods-scoreboard/

## History (superseded 2026-10-01)

Early-access artefacts; know them when you meet them, never follow them.

- The design thread, issue 91870: https://github.com/anthropics/claude-code/issues/91870. Replaced by the docs pages.
- The `$` cheat sheet (an SVG) and the "Function Hooks: Core Architecture" paper attached to that thread. Replaced by the reference and events pages and the types.
- `/plugin-types` and a `.claude/types/` folder. Gone; the engine writes `.claude-plugin/types/` on every load.
- The `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` flag. Ignored at any value from the floor on.
- Community READMEs written for early access that advise the flag, `/plugin-types` or a `.claude/types` tsconfig include. Stale on those points; `migrate.md` has the new forms.
