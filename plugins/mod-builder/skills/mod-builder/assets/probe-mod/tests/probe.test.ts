import { describe, expect, mock, test } from 'claude-code/testing';
import type { SessionStartInput } from 'claude-code';

const start: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' };

describe('probe-mod', () => {
  test('logs one numbered line per session start, tagged from MOD_BUILDER_PROBE', async ($, on) => {
    mock.env(on, { MOD_BUILDER_PROBE: 'ci' });
    on('session.start', ($, e) => ({ cwd: e.cwd }));
    on('command.register', ($, e) => ({ value: { command: e.name } }));
    const logs: string[] = [];
    on('ui.log', ($, e) => { logs.push(e.text); return { value: undefined }; });

    await $.session.start(start);
    await $.session.start(start);

    expect(logs).toEqual(['probe-mod: start 1 (ci)', 'probe-mod: start 2 (ci)']);
  });
});
