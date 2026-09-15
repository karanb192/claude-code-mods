# Gotchas from people who shipped mods

Each entry names where it came from. "Verified" means the mod-builder author reproduced it on Claude Code 2.1.272 on 2026-09-15. Function hooks are early access; re-check any of these after a Claude Code update.

## Loading and the flag

1. Nothing loads unless `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` is set. Per session as a prefix (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .`) or in `~/.claude/settings.json` under `env`. Setting it globally loads the hooks module of every installed plugin that ships one. Source: https://github.com/karanb192/awesome-claude-code-mods#turn-mods-on. Verified: a `session.start` hook fired with the flag and not without, same binary, same minute.
2. The API can change between releases without notice. Source: Anthropic's mods README, https://github.com/anthropics/claude-code/tree/main/mods.
3. A hot reload that fails partway leaves the old version loaded. Restart the session. Source: cc-arcade README, https://github.com/sezaakgun/cc-arcade#troubleshooting.
4. Builds without function hooks ignore the `modules` key in `hooks/hooks.json`, so a mod does nothing there rather than failing. Source: the hello-mod example, https://github.com/karanb192/awesome-claude-code-mods/tree/main/examples/hello-mod.

## The validator

5. Old shell-hook event names are not events. `on("PreToolUse", ...)` fails validation. Verified; the message on 2.1.272 reads: `"PreToolUse" is not an event; $ is always spelled $.noun.event(...) at the call site, on is always on("<event>", hook), and next.to always next.to(e, "<tier>")`. The classic seam is `on("classic.PreToolUse", ...)`.
6. A computed or optional member access on `$` fails validation. `$[n].read(...)` and `$.fs?.read(...)` are both refused. Verified; the message begins `a computed or optional member access on $`. The engine inventories calls statically, so every call is spelled out in full.
7. `$.env.get` takes a LITERAL variable name, and the validator lists what you read and write. Source: the `$` cheat sheet (Anthropic, 2026-09-09), linked in `reading.md`.
8. `claude plugin validate` needs no login and works offline. It prints `hooks:` and `calls:` per module and `surface modules:` when Client modules exist. Verified.

## Types

9. Types are never committed. Run `/plugin-types` inside a Claude Code session in the plugin folder with function hooks on. It writes `.claude/types/`, which is git-ignored, and `tsc` fails with a missing `claude-code` module until it exists. Source: cc-pr-tracker README, https://github.com/sezaakgun/cc-pr-tracker; cc-arcade `.gitignore`.
10. Regenerate the types after every Claude Code update rather than editing them. Source: Arunjay4213/claude-mods README, https://github.com/Arunjay4213/claude-mods.
11. The tsconfig that shipped mods use: `"jsx": "react"`, `"jsxFactory": "h"`, `"jsxFragmentFactory": "Fragment"`, `"types": []`, `"moduleResolution": "bundler"`, `"noEmit": true`, and `"include": [".claude/types", "hooks"]`. Source: cc-arcade `tsconfig.json`, https://github.com/sezaakgun/cc-arcade/blob/main/tsconfig.json; Anthropic's `mods/tsconfig.json` uses the same compiler options with a wider `include`.

## Drawing

12. Nothing draws in `claude -p`, the desktop app or mobile. Client surface modules draw on the terminal only. Source: cc-arcade README (https://github.com/sezaakgun/cc-arcade#limits), claude-games README (https://github.com/mohi-devhub/claude-games), cc-pokedex README (https://github.com/deonmenezes/claude-mods-pokedex), cc-pr-tracker README (https://github.com/sezaakgun/cc-pr-tracker). claude-mermaid falls back to plain art on surfaces that strip colour (https://github.com/galElmalah/claude-mermaid).
13. Never name a local variable `h` in a surface module. Every JSX tag compiles to a call of `h`, and a local `h` breaks the board at its first draw. Source: cc-arcade README (https://github.com/sezaakgun/cc-arcade#develop), claude-games README, cc-pokedex README.
14. Write `Client` module paths as string literals. The engine reads them off the source. Source: same three READMEs as item 13.
15. The band above the prompt (`AbovePrompt`) is about half the terminal height and redraws about ten times a second. Keep it short. Source: cc-arcade README (https://github.com/sezaakgun/cc-arcade#limits), Mindful-Claude README (https://github.com/halluton/Mindful-Claude), cc-pr-tracker README ("a limited number of rows, about half the terminal").
16. Clamp what you draw to `e.props.maxRows`. cc-arcade's hooks module does `Math.max(8, e.props.maxRows - 2)` before laying out a board. Source: https://github.com/sezaakgun/cc-arcade/blob/main/hooks/register.tsx.
17. A surface module that throws or overruns its time budget is unmounted and replaced by one line naming the plugin and the module. Source: cc-arcade README troubleshooting.

## Hook behaviour

18. A throw or a 10 second overrun skips the hook silently, with one dim line, unless the hook declared `.catch`. `.catch` runs on a grace budget with the same `next` and answers instead. A wrong-shaped return is always skipped. Source: the `$` cheat sheet.
19. A hook never sees the dispatches it raised itself. Its `$` calls, its `next`, its spawned agent all skip it. Sibling hooks and other plugins see them. Source: the cheat sheet and the architecture PDF section 6.4.
20. Core has a side effect on `tool.call`, `prompt.submit`, `agent.spawn`, `command.run`, `config.set` and `session.compact`. No `next` and it did not happen. `next` twice and it happened twice. Source: the cheat sheet.
21. Ids on `e` are pinned: `tool`, `tool_use_id`, `agentId`, `origin`, `provider`, `trigger`, keys. Rewriting them has no effect. Source: the cheat sheet.
22. `next` is frozen and built once per dispatch per hook. A hook cannot decorate it for the hook beneath. Source: the architecture PDF section 3.1.

## Organisation machines

23. On a managed machine or a Team or Enterprise plan, `sec-default` sits outermost. A person's plugins cannot touch classic hooks, prompt sections, settings reads or an org-provided tool's description there. A mod that hooks those works on a personal machine and silently does less on a managed one. Source: the cheat sheet and Anthropic's mods README.
