# Image Peek

Move the text cursor onto a pasted `[Image #1]` marker to see its image. Move away to hide it. Wide windows get a large preview pane with the image centered on a dark canvas. Narrow windows use the area above the prompt. Keyboard focus stays in the prompt.

This first version targets macOS and Ghostty with Claude Code 2.1.287 or later. Cursor selection, native paste, reload and cleanup have been exercised in the actual Claude CLI. User-provided screenshots confirmed image rendering in Ghostty in both layouts. **The latest sizing adjustment still needs a visual check.**

## Install

Run in your shell, then start a new Claude session in Ghostty:

```sh
claude plugin marketplace add karanb192/claude-code-mods
claude plugin install image-peek@claude-code-mods
```

If you already added the marketplace, update it with `claude plugin marketplace update claude-code-mods` before installing. This entry becomes available when the Image Peek change is merged into the marketplace's main branch.

No browser, compiler, separate Mac app or API key is needed. Claude loads the mod and macOS supplies the clipboard reader. Mods are [enabled by default in Claude Code 2.1.287+](https://code.claude.com/docs/en/plugins/mods/overview#turn-mods-on-or-off).

To try a local checkout without installing, run from the repository root:

```sh
claude --plugin-dir ./plugins/image-peek
```

## Use

1. Copy an image and paste it into Claude's prompt using the usual image-paste shortcut.
2. Use the arrow keys to put the text cursor inside or directly beside its `[Image #N]` marker. The preview appears automatically.
3. Move into the surrounding text to hide it. Return to the marker to see the same cached image.

This follows the text cursor, not mouse hover. The conversation remains visible beside or above the preview. The whole image fits within the available width and height, reserving one row for its label. The pane requests up to about 72% of the window's width, adjusted for the image's proportions. Claude may retain a width you previously chose; drag the divider if that makes the pane too narrow.

The inline fallback is smaller because Claude limits the above-prompt area to roughly half the terminal height, including the prompt and other bottom content. There is no zoom or floating overlay. Closing the pane dismisses it until the cursor leaves the marker.

`/image-peek off` stops new captures and hides the preview. `/image-peek on` resumes capture for new pastes. `/image-peek` reports the current setting. These commands do not call a model.

## Limits of this version

Claude's prompt API exposes the marker and cursor but does not provide the draft attachment bytes. Image Peek therefore reads the Mac clipboard when it detects a new native image marker. It checks the draft every 120 ms and saves that clipboard image once.

- Paste one image at a time and wait for the preview before copying another image. If the clipboard changes between the paste and capture, the preview can show the newer clipboard image. It is a convenience preview, not proof of the submitted attachment's contents.
- PNG and TIFF clipboard image data are supported. File paths, drag-and-drop attachments and images that were already present when the mod loaded are not supported capture routes. Re-paste the image from the clipboard.
- Two new markers arriving in the same check produce “Preview unavailable”, since their individual clipboard contents cannot be recovered.
- Only the most recent 24 captures are kept per session. Older markers, resumed sessions and pastes made while disabled may show “Preview unavailable”. A normal hot reload within the same session preserves captured previews.
- Capture rejects input or output over 32 MiB and decoded images over 64 million pixels. Animated images are represented as a single PNG frame when macOS can decode them.
- Clear, resume, compaction and normal exit remove that session's temporary images. A crash, forced termination or cleanup failure can leave files in the macOS temporary directory under `claude-image-peek/`.
- This version enables capture only on macOS when the environment identifies Ghostty. Other terminals receive a notice and no clipboard capture starts.

## Validation

Run from the repository root:

```sh
claude plugin validate plugins/image-peek --strict
claude plugin test plugins/image-peek
```

The strict validator on Claude Code 2.1.287 reported:

```text
  ❯ types ./types/index.d.ts declares on $: nothing (no EngineInterface member)
  ❯ types ./types/index.d.ts declares state: image-peek.session
  ❯ ./register.ts hooks: session.start, prompt.edit, prompt.fill, command.run{command=image-peek}, session.end, session.compact, ui.render{component=AbovePrompt}, ui.render{component=Pane, requestId=image-peek}, ui.close{id=image-peek}
  ❯ ./register.ts calls: $.clock.every, $.command.register, $.env.get, $.process.run, $.prompt.read, $.session.id, $.state.get, $.state.set (via save), $.ui.close, $.ui.invalidate, $.ui.log, $.ui.open (via update), $.ui.panes, $.ui.resolve
  ❯ ./register.ts env writes: nothing
  ❯ ./register.ts env reads: GHOSTTY_RESOURCES_DIR, TERM_PROGRAM
  ❯ ./register.ts state writes: image-peek.session
  ❯ ./register.ts state reads: image-peek.session
```

Tests cover cursor boundaries, separate captures, ambiguous pastes, typed marker substitutes, unsupported terminals, enable/disable, failed capture, cache eviction and cleanup failure. A live CLI check also exercised native image paste, leaving and returning to the marker, hot reload and normal-exit cleanup. That terminal rendered the Image element's alternative text, so it did not verify image pixels. No model turn was submitted during these checks.

A controlled layout probe in the actual CLI used the same 180-column, 48-row terminal for both surfaces. The inline area settled at 15 rows and fitted a landscape image into 50 by 14 cells. A requested 128-column pane provided a 128 by 40 cell body and fitted that image into 126 by 34 cells. This verifies available layout space, not rendered pixels or colors.

The remaining visual check is to paste two distinct images in Ghostty, select each marker, resize the window, and confirm the larger dark preview appears and disappears without moving keyboard focus. Repeat with conversation output above the prompt. On reload, the plugin closes any pane left from its earlier layout.

## Threat model

Reach L2: starts local processes and writes temporary image files.

1. **Reads:** draft text and cursor, session ID, two terminal environment variables, and PNG/TIFF clipboard data after detecting a new image marker. Draft text is parsed in memory and is not saved or sent by this plugin.
2. **Runs:** `/usr/bin/uname -s` to check the platform and `/usr/bin/osascript -l JavaScript` with the bundled clipboard helper. Fixed argument arrays are used; prompt text never becomes a shell command.
3. **Sends:** no network requests, model calls or prompt submissions. Claude's normal handling of an attachment when you send your prompt is unchanged.
4. **Persists:** local session state holds image paths, dimensions, observed marker IDs and the on/off setting. Temporary PNGs use private session directories (0700) and files (0600), with at most 24 retained captures. Normal session cleanup removes the files; stored paths can outlive them.
5. **Hostile input:** session directory names are restricted to UUID characters; existing non-directory cache paths are rejected. Size checks bound accepted image data, but macOS still decodes the clipboard image. A clipboard change during capture discards it; a change before capture cannot be tied back to the original paste. The validator lists `$.process.run`, so review the helper as well as the hooks module.

## Files and API references

- `hooks/register.ts`: detects marker selection, captures new images and draws the preview.
- `hooks/clipboard.js`: macOS clipboard capture and temporary-file cleanup.
- `hooks/selection.ts`: marker boundaries and image sizing.
- `types/index.d.ts`: the plugin's session-state shape.
- `tests/register.test.ts`: Claude's native mod tests.

The implementation uses Claude's [engine interface](https://code.claude.com/docs/en/plugins/mods/reference) and [native interface elements](https://code.claude.com/docs/en/plugins/mods/interface). Generated engine declarations are local development files and are not shipped.
