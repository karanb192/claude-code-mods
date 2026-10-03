import { describe, expect, mock, test } from 'claude-code/testing';
import type { TestBody } from 'claude-code/testing';
import type { CommandRunInput, PromptBox, SessionStartInput } from 'claude-code';
import type { PreviewSession } from '../types/index.d.ts';
import { fitImage, selectedImage } from '../hooks/selection.ts';

const start: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/project' };
const sessionId = '11111111-1111-4111-8111-111111111111';
const command = (args: string): CommandRunInput => ({
  command: 'image-peek', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 180 },
});

function world(on: Parameters<TestBody>[1], terminal = 'ghostty') {
  const clock = mock.clock(on);
  mock.env(on, { TERM_PROGRAM: terminal });
  let draft: PromptBox = { text: '', cursor: 0 };
  let state: PreviewSession | undefined;
  const processes: string[][] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const logs: string[] = [];
  let captures = 0;
  let captureFails = false;
  let cleanupFails = false;
  on('session.start', (_, e) => ({ cwd: e.cwd }));
  on('session.id', () => ({ value: sessionId }));
  on('prompt.read', () => ({ value: draft }));
  on('state.get', () => ({ value: { value: state, version: 0 } }));
  on('state.set', (_, e) => { state = JSON.parse(JSON.stringify(e.value)); return { value: { isSet: true, version: 1 } }; });
  on('process.run', (_, e) => {
    processes.push([...e.argv]);
    if (cleanupFails && e.argv.includes('cleanup')) throw new Error('Cleanup unavailable');
    let stdout = 'Darwin\n';
    if (e.argv.includes('capture')) {
      captures++;
      stdout = JSON.stringify(captureFails ? { ok: false } : { ok: true, path: `/tmp/image-${captures}.png`, width: 1200, height: 800 });
    }
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } };
  });
  on('command.register', (_, e) => ({ value: { command: e.name } }));
  on('ui.open', (_, e) => { opened.push(e.id); return { value: { isPlaced: true } }; });
  on('ui.close', (_, e) => { closed.push(e.id); return { value: undefined }; });
  on('ui.log', (_, e) => { logs.push(e.text); return { value: undefined }; });
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }));
  on('session.end', (_, e) => ({ sessionId: e.sessionId }));
  on('prompt.edit', (_, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }));
  on('prompt.fill', () => ({ isFilled: true, text: '[Image #1]', cursor: 10 }));
  return {
    clock, processes, opened, closed, logs,
    draft: (text: string, cursor = text.length) => { draft = { text, cursor }; },
    state: () => state,
    captureFails: () => { captureFails = true; },
    cleanupFails: () => { cleanupFails = true; },
  };
}

describe('image-peek', () => {
  test('selects either boundary and respects UTF-16 offsets and adjacent images', () => {
    expect(selectedImage('😀 [Image #1] hello', 3)).toBe('1');
    expect(selectedImage('😀 [Image #1] hello', 13)).toBe('1');
    expect(selectedImage('😀 [Image #1] hello', 14)).toBe(null);
    expect(selectedImage('[Image #1][Image #2]', 10)).toBe('2');
    expect(selectedImage('[Image #0]', 2)).toBe(null);
  });

  test('fits portrait and landscape images inside the available cells', () => {
    expect(fitImage(1200, 800, 60, 20)).toEqual({ columns: 60, rows: 20 });
    expect(fitImage(800, 1600, 60, 20)).toEqual({ columns: 20, rows: 20 });
    expect(fitImage(1000, 100, 600, 300)).toEqual({ columns: 255, rows: 12 });
  });

  test('captures once, opens at a marker, hides away, and reopens without recapturing', async ($, on) => {
    const w = world(on);
    await $.session.start(start);
    w.draft('[Image #1] hello', 10);
    await w.clock.advance(120);
    expect(w.state()?.images['1']?.path).toBe('/tmp/image-1.png');
    expect(w.opened).toEqual([]);
    w.draft('[Image #1] hello');
    await w.clock.advance(120);
    expect(w.closed).toEqual(['image-peek']);
    w.draft('[Image #1] hello', 0);
    await w.clock.advance(120);
    expect(w.opened).toHaveLength(0);
    expect(w.processes.filter(argv => argv.includes('capture'))).toHaveLength(1);
  });

  test('keeps separate pasted images associated with their own markers', async ($, on) => {
    const w = world(on);
    await $.session.start(start);
    w.draft('[Image #1]');
    await w.clock.advance(120);
    w.draft('[Image #1] [Image #2]');
    await w.clock.advance(120);
    expect(w.state()?.images['1']?.path).toBe('/tmp/image-1.png');
    expect(w.state()?.images['2']?.path).toBe('/tmp/image-2.png');
  });

  test('fits the Image above the prompt without opening a full-height pane', async ($, on) => {
    const w = world(on);
    await $.session.start(start);
    w.draft('[Image #1]');
    await w.clock.advance(120);
    const ui = await $.ui.mount({ plugin: 'image-peek', surface: 'terminal', component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 32, bodyColumns: 180, scroll: { offset: 0, bodyRows: 32 }, view: {} },
      viewport: { columns: 180, rows: 80, isFullscreen: true } });
    const image = await ui.find({ type: 'Image' });
    expect(image?.props.source).toEqual({ file: '/tmp/image-1.png', format: 'png' });
    expect(image?.props.columns).toBe(93);
    expect(image?.props.rows).toBe(31);
    expect(w.opened).toEqual([]);
    w.draft('[Image #1] hello');
    await w.clock.advance(120);
    expect(await ui.find({ type: 'Image' })).toBeUndefined();
    await ui.unmount();
  });

  test('does not guess when two unseen image markers appear together', async ($, on) => {
    const w = world(on);
    await $.session.start(start);
    w.draft('[Image #1] [Image #2]');
    await w.clock.advance(120);
    expect(w.state()?.images).toEqual({ '1': null, '2': null });
    expect(w.processes.filter(argv => argv.includes('capture'))).toHaveLength(0);
  });

  test('does not read the clipboard for a marker inserted as text by another mod', async ($, on) => {
    const w = world(on);
    await $.session.start(start);
    await $.prompt.fill({ origin: { kind: 'plugin', name: 'example' }, text: '[Image #1]', mode: 'replace' });
    w.draft('[Image #1]');
    await w.clock.advance(120);
    expect(w.state()?.images['1']).toBe(null);
    expect(w.processes.filter(argv => argv.includes('capture'))).toHaveLength(0);
  });

  test('does not capture an attachment that already existed when the mod loaded', async ($, on) => {
    const w = world(on);
    w.draft('[Image #1]');
    await $.session.start(start);
    await w.clock.advance(120);
    expect(w.processes.filter(argv => argv.includes('capture'))).toHaveLength(0);
  });

  test('does not access the clipboard when disabled or in an unsupported terminal', async ($, on) => {
    const w = world(on, 'iTerm.app');
    await $.session.start(start);
    w.draft('[Image #1]');
    await w.clock.advance(240);
    expect(w.processes.filter(argv => argv.includes('capture'))).toHaveLength(0);
    expect(w.logs[0]).toContain('macOS and Ghostty');
  });

  test('off stops capture and on resumes for the next pasted image', async ($, on) => {
    const w = world(on);
    await $.session.start(start);
    await $.command.run(command('off'));
    w.draft('[Image #1]');
    await w.clock.advance(120);
    expect(w.processes.filter(argv => argv.includes('capture'))).toHaveLength(0);
    await $.command.run(command('on'));
    w.draft('[Image #1] [Image #2]');
    await w.clock.advance(120);
    expect(w.state()?.images['2']?.path).toBe('/tmp/image-1.png');
  });

  test('renders an unavailable preview after capture fails, without repeating the process', async ($, on) => {
    const w = world(on);
    w.captureFails();
    await $.session.start(start);
    w.draft('[Image #1]');
    await w.clock.advance(120);
    const ui = await $.ui.mount({ plugin: 'image-peek', surface: 'terminal', component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} },
      viewport: { columns: 80, rows: 30, isFullscreen: true } });
    expect(await ui.find({ type: 'Text', text: /Preview unavailable/ })).toBeDefined();
    await w.clock.advance(240);
    expect(w.processes.filter(argv => argv.includes('capture'))).toHaveLength(1);
    await ui.unmount();
  });

  test('continues after clear even when cache cleanup fails', async ($, on) => {
    const w = world(on);
    await $.session.start(start);
    w.draft('[Image #1]');
    await w.clock.advance(120);
    w.cleanupFails();
    await $.session.end({ reason: 'clear', sessionId, resume: { id: sessionId } });
    expect(w.state()?.images).toEqual({});
    expect(w.logs).toContain('Image Peek could not remove its temporary preview files.');
    w.draft('[Image #1]');
    await w.clock.advance(120);
    expect(w.state()?.images['1']?.path).toBe('/tmp/image-2.png');
  });

  test('does not recapture an old marker after its preview is evicted', async ($, on) => {
    const w = world(on);
    await $.session.start(start);
    for (let id = 1; id <= 25; id++) {
      w.draft(`[Image #${id}]`);
      await w.clock.advance(120);
    }
    expect(Object.keys(w.state()!.images)).toHaveLength(24);
    w.draft('[Image #1]');
    await w.clock.advance(120);
    expect(w.state()?.images['1']).toBeUndefined();
    expect(w.processes.filter(argv => argv.includes('capture'))).toHaveLength(25);
  });
});
