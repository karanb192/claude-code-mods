import type { Register } from 'claude-code'

const TARGET = 'fable'
const KEY = 'enabled'

export const register: Register = on => {
  let enabled = true

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const saved = await $.store.get(KEY)
    enabled = saved !== false
    await $.command.register({
      name: 'fable-pin',
      description: 'Pin every subagent to the fable model: on, off or status (fable-pin)',
      argumentHint: '[on | off | status]',
      immediate: true,
    })
    return r
  })

  on('command.run', { command: 'fable-pin' }, async ($, e) => {
    const arg = String(e.args ?? '').trim()
    if (arg === 'on' || arg === 'off') {
      enabled = arg === 'on'
      await $.store.set(KEY, enabled)
    }
    return { text: enabled ? `fable-pin is on: every subagent runs on ${TARGET}, forks inherit` : 'fable-pin is off: subagents keep the model they asked for' }
  })

  // Forks always inherit the parent's model, so rewriting theirs would be ignored anyway.
  on('agent.spawn', async ($, e, next) => {
    if (!enabled || e.fork || e.model === TARGET) return next(e)
    return next({ ...e, model: TARGET })
  })
}
