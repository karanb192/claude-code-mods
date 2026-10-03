# UI and state: where a mod draws, with what, and what it remembers

Read this when the plan names a pane, the band, a restyled site, or a value a drawing depends on. Element props, site props and the `Client` surface API are shapes: read them in the types (`grep -n "export type Elements" <types>/claude-code/index.d.ts`, `grep -n "export type RenderPropsOf" ...`, `grep -n "Props = {" ...`). Stamp legend: `[src: <pointer> | checked <build> | recheck: <trigger>]`.

## Render sites and which surfaces raise them
```api-components
AskUserQuestion
UserMessage
AssistantMessage
ToolUse
ToolResult
ToolGroup
ToolProgress
CommandOutput
Spinner
TurnDuration
InfoNotice
SessionMode
PromptHint
AbovePrompt
Pane
```
```api-surfaces
terminal
desktop
mobile
vscode
```
- Raised on every surface: `AskUserQuestion`, `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `CommandOutput`, `Pane`. Terminal and desktop only: `Spinner`, `SessionMode`, `PromptHint`, `AbovePrompt`. Terminal only: `ToolProgress`, `TurnDuration`, `InfoNotice`. The docs table says "Terminal, Desktop" for the first group; the types win. [src: d.ts RenderPropsOf "Raised on" comments | checked 2.1.288 | recheck: gate drift line in the components or surfaces family]
- Hook a site with a matcher (`{ component: 'Pane' }`); for a pane, also check `e.requestId` is your id. At an engine-drawn site, `next(e)` returns a reference to the engine's drawing: return it, wrap it in a Box beside your elements, or pass changed props. [src: docs interface.md "Change what Claude Code already draws" | checked 2.1.287 | recheck: a kit mount of a wrapping hook loses the marker beneath]
- An `AskUserQuestion` tree must hold the engine reference exactly once, your elements above it, or the engine draws its own dialog. The permission prompt is not a site; add a line under it with `$.ui.notice`. [src: docs interface.md | checked 2.1.287 | recheck: a mounted AskUserQuestion tree with two references draws]
- `e.surface` is what the client declared: a drawing fact, never a policy key. Size a `Pane` or band tree to `e.props.bodyColumns`, not the viewport. [src: d.ts RenderInputOf surface, docs reference.md "Render sites" | checked 2.1.288 | recheck: gate drift line names ui.render]

## Elements per surface
```api-elements
terminal: Box
terminal: Text
terminal: Button
terminal: Input
terminal: Select
terminal: Link
terminal: Code
terminal: Markdown
terminal: Client
terminal: Raster
terminal: Image
desktop: Box
desktop: Text
desktop: Button
desktop: Input
desktop: Select
desktop: Svg
desktop: Link
desktop: Code
desktop: Markdown
desktop: Client
mobile: Box
mobile: Text
mobile: Button
mobile: Svg
mobile: Link
mobile: Code
mobile: Markdown
vscode: Box
vscode: Text
vscode: Button
vscode: Input
vscode: Select
vscode: Svg
vscode: Link
vscode: Code
vscode: Markdown
```
- An element the surface lacks, a prop the element does not take, or a child where none goes fails the whole tree, and the engine draws its own site. Draw shared elements only, or branch on `e.surface`; `Svg` never draws in the terminal (a pane of only an `Svg` opens empty there). [src: d.ts Elements, docs gallery.md | checked 2.1.288 | recheck: gate drift line in the elements family]
- Elements come from `$.ui.resolve(e)`, synchronous; `h` and `Fragment` are environment globals, so no file of the mod declares, imports or takes either name. A `Client` module path is a string literal relative to the hooks module. [src: d.ts global h, ClientProps | checked 2.1.288 | recheck: api-check SHAPE DRIFT ui.resolve.sync]

## Panes
- A pane draws only after `$.ui.open({ id })` (id: letters, digits, `_`, `-`, up to 64); opening draws nothing, then `ui.render` fires for `{ component: 'Pane', requestId: id }`. A sidebar in a fullscreen terminal from 110 columns, else inline above the prompt; several panes become tabs. [src: docs interface.md "Pick where to draw", d.ts CommandPresentation | checked 2.1.288 | recheck: api-check SHAPE DRIFT pane.floor]
- Floors: opened in answer to the person (a command, prompt, `Button`, `Input` or `Select`), placed at any width; opened unasked (timer, `session.start`, `turn.start`, a queued prompt), placed only from 144 columns, or 110 for an id the person opened before. `focus: true` does not count as asked. [src: d.ts UiOpenResult | checked 2.1.288 | recheck: api-check SHAPE DRIFT pane.floor]
- `$.ui.open` resolves `isPlaced`: when false it carries a reason, no `ui.render` fires, and the pane appears once the person opens it or the terminal widens. Check it and fall back to the band, a toast or a command reply. A `-p` run places every pane and draws none. [src: d.ts ui.open, docs interface.md "When a pane waits" | checked 2.1.288 | recheck: a -p load log shows isPlaced false]
- `focus`, `closeOnEscape`, `holdToasts` accept only `true`; `false` throws (`ui.open: focus is true or left out`), which skips the calling hook. `rows` and `columns` are requests; the docked pane ignores `rows`, the inline one `columns`. [src: docs interface.md "Open a pane at the right time" | checked 2.1.287 | recheck: an open with focus false stops throwing]
- Focus is granted only while the prompt is empty and nothing else holds the keys; it arrives by `focus: true` from a command or press, Ctrl+X then Tab, or a click. Keys while focused (Tab, arrows, Enter, hotkeys, paging, Ctrl+X resize and close, Esc): the table in interface.md "What each key does". A mod cannot bind Tab or arrows; a Client's key handler never gets Escape. [src: docs interface.md "Keyboard focus and hotkeys", d.ts ClientKeyEvent | checked 2.1.288 | recheck: a scripted interactive run shows a key doing otherwise]
- Hotkeys: one digit or one lowercase letter; the later of two buttons wins; they reach a `Button` only while its site holds the keyboard, except a bare digit typed into an empty prompt, which presses a band `Button`. To open a pane mid-turn, register the command with `immediate: true`. [src: docs reference.md "Elements", api.md | checked 2.1.287 | recheck: a kit press by hotkey fails]

## The band above the prompt
- `AbovePrompt` is one shared strip. Return `next(e)` to show nothing; a tree replaces what later mods draw; to keep theirs put `await next(e)` among the children of a `Box`. Yield (`next(e)`) while `e.props.hasSurvey` is true. [src: docs interface.md "Band above the prompt", blog getting-started | checked 2.1.288 | recheck: gate drift line names AbovePrompt]
- Height: at most `e.props.maxRows` (about half the terminal, prompt included); a taller tree scrolls. Width: `e.props.bodyColumns`, narrower while a pane is docked. The person collapses it with Ctrl+X Ctrl+A. [src: d.ts AbovePrompt maxRows | checked 2.1.288 | recheck: gate drift line names AbovePrompt]

## Redraws
```api-invalidatable
ui.render
prompt.section
prompt.context
prompt.attachment
tool.describe
command.describe
config.describe
```
- A drawing is a snapshot. The engine redraws on a props or width change, never on a timer and never for a module variable; call `$.ui.invalidate` with one of the names above after your data changes, or keep the value in `$.state`. Redraws of the visible pane, expanded band and hint line are throttled to 30 a second in the terminal, 10 elsewhere; faster calls coalesce. [src: d.ts InvalidatableEventName, docs reference.md "Limits" | checked 2.1.288 | recheck: api-check SHAPE DRIFT invalidatable]

## The $.state contract
- Lifetimes: a module variable dies on every reload (every save during development); `$.state` lasts the session and survives a reload; `$.store` lasts until deleted or `cleanupPeriodDays` unread. A value a drawing depends on goes in `$.state`. [src: docs interface.md "Keep state" | checked 2.1.287 | recheck: a value survives a save in a load log]
- Declare each value in `types/index.d.ts` as `declare module 'claude-code' { interface PluginState { '<plugin>': { key: Type } } }` (no `export` line), and point the manifest's `types` field at it, or validate fails with `<plugin>.<key> is not declared`. [src: docs interface.md "Declare the values", tooling probe | checked 2.1.288 | recheck: validate passes an undeclared key]
- Write `plugin` and `key` as string literals (only a family member's `id` may be computed). Use `atom`, `read`, `update`, `derive`, `memberOf` from `claude-code`; `update` retries on a version miss, so two presses before a redraw both land. [src: d.ts UpdateFunction, docs reference.md | checked 2.1.288 | recheck: api-check SHAPE DRIFT state.ownerOnly]
- A read inside a `ui.render` hook subscribes that site, and a later write redraws it with no invalidate. A write inside a render hook is refused: write from a callback or another event. Only the owning plugin writes; others rewrite through a `state.set` hook. [src: d.ts CoreEngineInterface state, docs interface.md | checked 2.1.288 | recheck: api-check SHAPE DRIFT state.ownerOnly]
- `/clear`, `/resume` and `/branch` reset every value to its default and `session.start` does not fire. Save to `$.store` on every change, and reload only from `classic.SessionStart` matched `{ source: ['clear', 'resume', 'fork'] }`, as build.md's template does (unmatched it also fires at startup and after compaction, which reset nothing). [src: docs interface.md "Load a saved value again after /clear" | checked 2.1.287 | recheck: a kit test of classic.SessionStart with source clear shows the default]
- `$.store` is one store per plugin, shared by every session on the machine. A machine-wide value (a counter across sessions) may be reloaded anywhere; per-session data (the files read in this session) must never be reloaded at `session.start`, or a new session starts with another session's data. Carry it across `/clear` alone, for example by saving it under a key in a `session.end` hook matched on reason `clear` and reading that key back in `classic.SessionStart` matched on source `clear`. [src: docs interface.md "Save from more than one session"; d.ts store noun ("kept between sessions") | checked 2.1.288 | recheck: that docs section stops calling the store shared]
- Unverified: whether `$.state` still holds the session's values inside a `session.end` hook with reason `clear`, or has already reset. The carry above depends on it. Probe: a throwaway mod that writes `$.state` from a command, logs `$.state.get` with `{ to: 'debug' }` from `session.end` matched on reason `clear`, then a real session that runs the command, runs `/clear`, and greps the debug log for the logged value. Until that probe is run, save to `$.store` on every change rather than at `session.end`, and say so in DECISIONS.md. [src: none; the kit does not model the reset | checked 2.1.288 | recheck: the probe above is run]

## Where drawing appears
| Where Claude Code runs | Hooks run | Drawing appears |
|---|---|---|
| `claude` in a terminal (editor terminals, JetBrains) | yes | yes |
| Desktop app Code tab | yes | yes, minus terminal-only sites and elements |
| Desktop WSL session | no | no |
| VS Code chat panel | yes | no |
| `claude -p`, Agent SDK | yes | no (panes count as placed, `$.ui.log` reaches the host) |
| Remote Control | yes, on the machine's session | in that machine's terminal |
| Cloud session | for plugins that reach it | no |

Where nothing draws, fall back to a transcript line or a command's text reply; `$.session.surfaces()` lists what is attached now, and `$.process` is CLI only. [src: docs overview.md "Where mods run", d.ts process | checked 2.1.287 | recheck: a Desktop or VS Code run draws what this table says it does not]
