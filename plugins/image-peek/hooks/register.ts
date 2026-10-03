import type { EngineInterface, Register, RenderInput } from 'claude-code';
import type { PreviewImage, PreviewSession } from '../types/index.d.ts';
import { fitImage, markers, selectedImage } from './selection.ts';

const STATE = { plugin: 'image-peek', key: 'session' } as const;
const PANE = 'image-peek';
const LIMIT = 24;

function blank(sessionId = ''): PreviewSession {
  return { sessionId, images: {}, observed: [], enabled: true, highestNativeId: 0 };
}

function imageResult(text: string): PreviewImage | null {
  try {
    const data = JSON.parse(text);
    if (data.ok !== true || typeof data.path !== 'string' || !data.path.startsWith('/')
      || !Number.isInteger(data.width) || !Number.isInteger(data.height)
      || data.width < 1 || data.height < 1 || data.width * data.height > 64_000_000) return null;
    return { path: data.path, width: data.width, height: data.height };
  } catch { return null; }
}

let session = blank();
let active: string | null = null;
let docked = false;
let dismissed: string | null = null;
let viewport = { columns: 180, rows: 48 };
let busy = false;
let ready = false;
let generation = 0;
let lastDraft = '';
let lastCursor = -1;
let failed = false;

async function save($: EngineInterface) {
  await $.state.set(STATE, session);
}

async function close($: EngineInterface) {
  active = null;
  docked = false;
  await $.ui.close({ id: PANE });
  $.ui.invalidate('ui.render');
}

async function cleanup($: EngineInterface, id: string) {
  try {
    await $.process.run(['/usr/bin/osascript', '-l', 'JavaScript', `${$.plugin.root}/hooks/clipboard.js`, 'cleanup', id], { timeoutMs: 3000 });
  } catch {
    $.ui.log('Image Peek could not remove its temporary preview files.');
  }
}

async function reset($: EngineInterface) {
  generation++;
  const ending = session.sessionId;
  session = blank();
  dismissed = null;
  lastDraft = '';
  lastCursor = -1;
  try { await close($); await save($); }
  finally { if (ending) await cleanup($, ending); }
}

async function update($: EngineInterface) {
  if (!ready || busy) return;
  busy = true;
  const epoch = generation;
  try {
    if (!session.sessionId) {
      session = blank(await $.session.id());
      await save($);
    }
    const draft = await $.prompt.read();
    if (draft.text === lastDraft && draft.cursor === lastCursor) return;
    const textChanged = draft.text !== lastDraft;
    lastDraft = draft.text;
    lastCursor = draft.cursor;
    const ids = [...new Set(markers(draft.text).map(marker => marker.id))];
    const fresh = ids.filter(id => !session.observed.includes(id) && !(id in session.images)
      && Number(id) > session.highestNativeId);
    session.observed = ids;
    for (const id of fresh) session.highestNativeId = Math.max(session.highestNativeId, Number(id));
    for (const id of fresh) session.images[id] = null;
    if (session.enabled && fresh.length === 1) {
      const capturedSession = session.sessionId;
      const result = await $.process.run(['/usr/bin/osascript', '-l', 'JavaScript', `${$.plugin.root}/hooks/clipboard.js`, 'capture', capturedSession], { timeoutMs: 3000 });
      if (epoch !== generation) { await cleanup($, capturedSession); return; }
      session.images[fresh[0]!] = result.exitCode === 0 ? imageResult(result.stdout) : null;
    }
    const keys = Object.keys(session.images);
    for (const id of keys.slice(0, Math.max(0, keys.length - LIMIT))) delete session.images[id];
    if (textChanged || fresh.length) await save($);
    const current = await $.prompt.read();
    if (epoch !== generation) return;
    const id = session.enabled ? selectedImage(current.text, current.cursor) : null;
    if (id !== dismissed) dismissed = null;
    if (id === active || (id !== null && id === dismissed)) return;
    if (!id) { await close($); return; }
    active = id;
    const entry = session.images[id];
    const columns = entry
      ? fitImage(entry.width, entry.height, Math.floor(viewport.columns * 0.72) - 2, viewport.rows - 8).columns + 2
      : 64;
    const opened = await $.ui.open({ id: PANE, title: `Image #${id}`, columns });
    if (epoch !== generation) return;
    docked = opened.isPlaced;
    $.ui.invalidate('ui.render');
  } catch {
    await close($);
    if (!failed) $.ui.log('Image preview is unavailable. Paste the image again, or use /image-peek off.');
    failed = true;
  } finally { busy = false; }
}

function draw($: EngineInterface, e: RenderInput<'Pane' | 'AbovePrompt', 'terminal'>) {
  const { Box, Text, Image } = $.ui.resolve(e);
  const entry = active ? session.images[active] : null;
  const columns = Math.max(1, e.props.bodyColumns - 2);
  const pane = e.component === 'Pane';
  const bodyRows = pane ? e.props.scroll.bodyRows : e.props.maxRows;
  const rows = Math.max(1, bodyRows - 1);
  const textStyle = pane ? { color: '#d1d5db' } : { dimColor: true };
  const children = entry ? [
    Text({ ...textStyle, children: `Image #${active} · ${entry.width} × ${entry.height}` }),
    Image({ key: `image-${active}`, source: { file: entry.path, format: 'png' },
      ...fitImage(entry.width, entry.height, columns, rows), alt: `Image #${active} · Terminal image rendering is unavailable. See Image Peek's terminal setup instructions.` }),
  ] : [Text({ ...textStyle, children: `Image #${active} · Preview unavailable. Paste it again to preview.` })];
  return Box({ flexDirection: 'column', flexShrink: 0,
    ...(pane ? { width: e.props.bodyColumns, height: bodyRows, backgroundColor: '#202327', alignItems: 'center', justifyContent: 'center' } as const
      : { alignItems: 'flex-start' } as const), children });
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    if (!e.isInteractive || e.surface !== 'terminal') return result;
    const terminal = await $.env.get('TERM_PROGRAM');
    const ghostty = await $.env.get('GHOSTTY_RESOURCES_DIR');
    const herdr = await $.env.get('HERDR_ENV') === '1';
    const iterm = terminal === 'iTerm.app';
    const forced = await $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES');
    const platform = await $.process.run(['/usr/bin/uname', '-s']);
    if (platform.stdout.trim() !== 'Darwin' || (terminal !== 'ghostty' && !ghostty && !iterm && !herdr)) {
      $.ui.log('Image Peek needs macOS with Ghostty, iTerm2 or Herdr. No clipboard access started.');
      return result;
    }
    if ((herdr || iterm) && !forced) {
      $.ui.log('Image Peek: iTerm2 and Herdr need a fresh Claude process launched with CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1. Use iTerm2 3.7.3+ or Herdr 0.9.1+ with graphics enabled in a compatible terminal.');
    }
    const id = await $.session.id();
    const stored = (await $.state.get(STATE)).value;
    session = stored?.sessionId === id ? JSON.parse(JSON.stringify(stored)) : blank(id);
    await $.ui.close({ id: PANE });
    const draft = await $.prompt.read();
    for (const marker of markers(draft.text)) {
      if (!(marker.id in session.images)) session.images[marker.id] = null;
      session.highestNativeId = Math.max(session.highestNativeId, Number(marker.id));
    }
    await save($);
    ready = true;
    $.clock.every(120, async () => { await update($); });
    await $.command.register({ name: PANE, description: 'Turn automatic pasted-image previews on or off', argumentHint: '[on|off]', immediate: true });
    return result;
  });

  on('prompt.edit', async ($, e, next) => {
    const result = await next(e);
    if (ready) {
      // Native image paste bypasses this event. Text that looks like a chip is not an attachment.
      const existing = new Set(markers(e.text).map(marker => marker.id));
      for (const marker of markers(result.text)) {
        if (!existing.has(marker.id) && !(marker.id in session.images)) session.images[marker.id] = null;
      }
    }
    return result;
  });

  on('prompt.fill', async ($, e, next) => {
    for (const marker of markers(e.text)) {
      if (!(marker.id in session.images)) session.images[marker.id] = null;
    }
    return next(e);
  });

  on('command.run', { command: PANE }, async ($, e) => {
    const arg = e.args.trim();
    if (arg !== 'on' && arg !== 'off' && arg !== '') return { text: 'Use /image-peek on or /image-peek off.' };
    if (arg) {
      session.enabled = arg === 'on';
      lastCursor = -1;
      await save($);
      if (!session.enabled) await close($);
    }
    return { text: `Image Peek is ${session.enabled ? 'on' : 'off'}. Move the cursor onto a pasted image marker to preview it.` };
  });

  on('session.end', async ($, e, next) => {
    const running = ready;
    ready = false;
    if (running) {
      try { await reset($); }
      catch { $.ui.log('Image Peek could not finish preview cleanup.'); }
    }
    const result = await next(e);
    ready = running && (e.reason === 'clear' || e.reason === 'resume');
    return result;
  });

  on('session.compact', async ($, e, next) => {
    const running = ready;
    ready = false;
    try {
      const result = await next(e);
      if (running) {
        try { await reset($); }
        catch { $.ui.log('Image Peek could not finish preview cleanup.'); }
      }
      return result;
    } finally { ready = running; }
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e);
    if (!docked && e.viewport) viewport = { columns: e.viewport.columns, rows: e.viewport.rows };
    if (!active || e.props.hasSurvey || e.props.maxRows < 2) return next(e);
    const panes = await $.ui.panes();
    docked = panes.some(pane => pane.id === PANE && pane.isPlaced);
    if (docked) return next(e);
    const other = await next(e);
    const { Box } = $.ui.resolve(e);
    return Box({ flexDirection: 'column', children: [other, draw($, e)] });
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    if (!active || e.surface !== 'terminal') return next(e);
    if (e.props.placement === 'dock' && e.viewport) {
      viewport = { columns: e.viewport.columns + e.props.bodyColumns + 1, rows: e.viewport.rows };
    }
    if (!docked) { docked = true; $.ui.invalidate('ui.render'); }
    return draw($, e);
  });

  on('ui.close', { id: PANE }, ($, e, next) => {
    if (e.origin.kind === 'person') {
      dismissed = active;
      active = null;
      docked = false;
      $.ui.invalidate('ui.render');
    }
    return next(e);
  });
};
