import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { fmtDuration, parseDuration } from '../hooks/register'

tier('user')

const MIN = 60 * 1000
const HOUR = 60 * MIN

function turn(usage = { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 200000, cache_creation_input_tokens: 500, model: 'claude-fable-5-1' }) {
  return { answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't' + Math.random(), reason: 'answer', usage } as any
}

function world(on: any, forkAnswers: Array<null | { read: number; write: number }>) {
  mock.store(on, {})
  const forks: number[] = []
  const status: Array<string | undefined> = []
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_: any, e: any) => ({ value: { command: e.name } }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('ui.status', (_: any, e: any) => { status.push(e.text); return { value: undefined } })
  on('model.fork', ($: any, e: any) => {
    forks.push(Date.now())
    const a = forkAnswers.shift()
    if (a === null || a === undefined) return { value: null }
    return { value: { text: 'warm', usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: a.read, cache_creation_input_tokens: a.write } } }
  })
  return { forks, status }
}

describe('parse and format', () => {
  test('durations', async () => {
    expect(parseDuration('6h')).toBe(6 * HOUR)
    expect(parseDuration('90m')).toBe(90 * MIN)
    expect(parseDuration('2h30m')).toBe(150 * MIN)
    expect(parseDuration('soon')).toBe(null)
    expect(fmtDuration(150 * MIN)).toBe('2h30m')
    expect(fmtDuration(7 * MIN)).toBe('7m')
  })
})

describe('register', () => {
  test('pings 50 minutes after the last request, then again, and reports the read', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on, [{ read: 200000, write: 0 }, { read: 200000, write: 0 }])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const r = await $.command.run({ command: 'keepwarm', args: '6h', origin: { kind: 'composer' } } as any)
    expect(r.text).toMatch(/keepwarm on for 6h00m/)
    await $.turn.complete(turn())
    await clock.advance(49 * MIN)
    expect(w.forks.length).toBe(0)
    await clock.advance(1 * MIN)
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toMatch(/keepwarm 5h10m left · ping in 50m · last ping read 200k \$0.05/)
    await clock.advance(50 * MIN)
    expect(w.forks.length).toBe(2)
  })

  test('a new turn resets the countdown', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on, [{ read: 180000, write: 0 }])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'keepwarm', args: '6h', origin: { kind: 'composer' } } as any)
    await $.turn.complete(turn())
    await clock.advance(40 * MIN)
    await $.turn.complete(turn())
    await clock.advance(40 * MIN)
    expect(w.forks.length).toBe(0)
    await clock.advance(10 * MIN)
    expect(w.forks.length).toBe(1)
  })

  test('stops when a ping reads cold, and when the engine refuses the fork', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on, [{ read: 0, write: 180000 }, { read: 180000, write: 0 }])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'keepwarm', args: '6h', origin: { kind: 'composer' } } as any)
    await $.turn.complete(turn())
    await clock.advance(50 * MIN)
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toMatch(/keepwarm stopped: the ping wrote 180k tokens \(\$3\.60\)/)
    await clock.advance(120 * MIN)
    expect(w.forks.length).toBe(1)

    const s = await $.command.run({ command: 'keepwarm', args: 'status', origin: { kind: 'composer' } } as any)
    expect(s.text).toMatch(/stopped/)
  })

  test('a null fork stops it too', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on, [null])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'keepwarm', args: '1h', origin: { kind: 'composer' } } as any)
    await $.turn.complete(turn())
    await clock.advance(50 * MIN)
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toMatch(/cold snapshot/)
  })

  test('the window ends and off cancels', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on, [{ read: 180000, write: 0 }, { read: 180000, write: 0 }, { read: 180000, write: 0 }])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'keepwarm', args: '70m', origin: { kind: 'composer' } } as any)
    await $.turn.complete(turn())
    await clock.advance(50 * MIN)
    expect(w.forks.length).toBe(1)
    await clock.advance(50 * MIN)
    expect(w.forks.length).toBe(1)
    expect(w.status.at(-1)).toBe(undefined)

    await $.command.run({ command: 'keepwarm', args: '6h', origin: { kind: 'composer' } } as any)
    await $.turn.complete(turn())
    await clock.advance(10 * MIN)
    const off = await $.command.run({ command: 'keepwarm', args: 'off', origin: { kind: 'composer' } } as any)
    expect(off.text).toBe('keepwarm is off')
    await clock.advance(60 * MIN)
    expect(w.forks.length).toBe(1)
  })

  test('subagent turns do not touch the timer', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const w = world(on, [{ read: 180000, write: 0 }])
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run({ command: 'keepwarm', args: '6h', origin: { kind: 'composer' } } as any)
    await $.turn.complete(turn())
    await clock.advance(40 * MIN)
    await $.turn.complete({ ...turn(), agentId: 'a1' })
    await clock.advance(10 * MIN)
    expect(w.forks.length).toBe(1)
  })
})
