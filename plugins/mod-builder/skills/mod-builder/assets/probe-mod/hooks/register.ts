import type { Register } from 'claude-code';

const RUNS = { plugin: 'probe-mod', key: 'runs' } as const;

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e);
    const { value = 0 } = await $.state.get(RUNS);
    const runs = value + 1;
    await $.state.set(RUNS, runs);
    const tag = await $.env.get('MOD_BUILDER_PROBE');
    $.ui.log(`probe-mod: start ${runs}${tag ? ` (${tag})` : ''}`, { to: 'debug' });
    await $.command.register({ name: 'probe-mod', description: 'Print how many sessions probe-mod has seen (probe-mod)', immediate: true });
    return started;
  });

  on('command.run', { command: 'probe-mod' }, async ($) => {
    const { value = 0 } = await $.state.get(RUNS);
    return { text: `probe-mod: ${value} start(s) seen` };
  });
};
