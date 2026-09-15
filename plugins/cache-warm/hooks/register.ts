import type { EngineInterface, Register } from 'claude-code'

const PING_AFTER_MS = 50 * 60 * 1000
const MIN_PING_MS = 60 * 1000
const PING_PROMPT = 'Reply with the single word: warm'
const KEY_DEADLINE = 'deadline'
const KEY_EVERY = 'every'

// $ per million tokens, [cache read, 1h cache write], list prices September 2026.
const PRICES: Array<[string, number, number]> = [
  ['fable-5-1', 0.25, 20],
  ['fable-5', 1, 20],
  ['opus-5', 0.5, 10],
  ['opus-4', 0.5, 10],
  ['sonnet', 0.3, 6],
  ['haiku', 0.1, 2],
]

type PingRecord = { at: number; read: number; write: number; usd: number | null; warm: boolean }

type State = {
  deadline: number
  every: number
  lastRequestAt: number
  lastModel: string | null
  pending: { cancel: () => void } | null
  last: PingRecord | null
  stopped: string | null
}

function priceOf(model: string | null): [number, number] | null {
  const m = (model ?? '').toLowerCase()
  for (const [family, read, write] of PRICES) if (m.includes(family)) return [read, write]
  return null
}

export function parseDuration(text: string): number | null {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(text.trim())
  if (!m || (m[1] === undefined && m[2] === undefined)) return null
  return (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 * 1000
}

export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`
}

function fmtUsd(usd: number | null): string {
  return usd == null ? 'n/a' : '$' + usd.toFixed(2)
}

function fmtTok(n: number): string {
  return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n)
}

function statusText(s: State, now: number): string | undefined {
  if (s.stopped) return `keepwarm stopped: ${s.stopped}`
  if (!s.deadline) return undefined
  const pingText = s.last ? ` · last ping read ${fmtTok(s.last.read)} ${fmtUsd(s.last.usd)}` : ''
  const nextText = s.lastRequestAt ? ` · ping in ${fmtDuration(s.lastRequestAt + s.every - now)}` : ' · waiting for the first turn'
  return `keepwarm ${fmtDuration(s.deadline - now)} left${nextText}${pingText}`
}

function disarm(s: State) {
  if (s.pending) s.pending.cancel()
  s.pending = null
}

async function stop($: EngineInterface, s: State, why: string | null) {
  s.deadline = 0
  s.every = PING_AFTER_MS
  s.stopped = why
  disarm(s)
  await $.store.set(KEY_DEADLINE, 0)
  await $.store.delete(KEY_EVERY)
  $.ui.status(statusText(s, await $.clock.now()))
}

async function arm($: EngineInterface, s: State) {
  disarm(s)
  if (!s.deadline) return
  const now = await $.clock.now()
  if (now >= s.deadline) return stop($, s, null)
  if (s.lastRequestAt) {
    const delay = Math.max(1000, s.lastRequestAt + s.every - now)
    s.pending = $.clock.after(delay, () => { void ping($, s) })
  }
  $.ui.status(statusText(s, now))
}

async function ping($: EngineInterface, s: State) {
  s.pending = null
  if (!s.deadline) return
  const now = await $.clock.now()
  if (now >= s.deadline) return arm($, s)
  // A turn in the meantime re-armed the timer; this callback is stale.
  if (now - s.lastRequestAt < s.every - 1000) return
  let reply
  try {
    reply = await $.model.fork({ prompt: PING_PROMPT })
  } catch (err) {
    return stop($, s, `the ping failed, ${err instanceof Error ? err.message : String(err)}`)
  }
  if (reply === null) return stop($, s, 'the engine did not send the ping, either the snapshot was cold or the API call failed')
  const u = reply.usage
  const price = priceOf(s.lastModel)
  const warm = u.cache_read_input_tokens >= u.cache_creation_input_tokens
  const usd = price ? (u.cache_read_input_tokens * price[0] + u.cache_creation_input_tokens * price[1]) / 1e6 : null
  s.last = { at: now, read: u.cache_read_input_tokens, write: u.cache_creation_input_tokens, usd, warm }
  if (!warm) return stop($, s, `the ping wrote ${fmtTok(u.cache_creation_input_tokens)} tokens (${fmtUsd(usd)}), the cache was already gone`)
  s.lastRequestAt = now
  await arm($, s)
}

export const register: Register = on => {
  const s: State = { deadline: 0, every: PING_AFTER_MS, lastRequestAt: 0, lastModel: null, pending: null, last: null, stopped: null }

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const saved = await $.store.get(KEY_DEADLINE)
    const savedEvery = await $.store.get(KEY_EVERY)
    const now = await $.clock.now()
    s.deadline = typeof saved === 'number' && saved > now ? saved : 0
    s.every = typeof savedEvery === 'number' && savedEvery >= MIN_PING_MS ? savedEvery : PING_AFTER_MS
    await $.command.register({
      name: 'keepwarm',
      description: 'Keep the prompt cache warm for a window, 6h or 90m, or off, or status (cache-warm)',
      argumentHint: '[6h | off | status]',
      immediate: true,
    })
    $.ui.status(statusText(s, now))
    return r
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const words = String(e.args ?? '').trim().split(/\s+/).filter(Boolean)
    const now = await $.clock.now()
    if (words[0] === 'off') {
      await stop($, s, null)
      return { text: 'keepwarm is off' }
    }
    if (words.length && words[0] !== 'status') {
      const window = parseDuration(words[0])
      if (window == null) return { text: 'keepwarm takes a window such as 6h or 90m, or off, or status' }
      // "every 2m" is a testing knob and lasts only for the window it was given with.
      let every = PING_AFTER_MS
      if (words[1] === 'every') {
        const period = parseDuration(words[2] ?? '')
        if (period == null || period < MIN_PING_MS) return { text: 'every takes a period of at least 1m' }
        every = period
      }
      s.every = every
      if (every === PING_AFTER_MS) await $.store.delete(KEY_EVERY)
      else await $.store.set(KEY_EVERY, every)
      s.deadline = now + window
      s.stopped = null
      await $.store.set(KEY_DEADLINE, s.deadline)
      await arm($, s)
      return { text: `keepwarm on for ${fmtDuration(window)}, a ping ${fmtDuration(every)} after each idle stretch keeps the cache read, not re-written` }
    }
    return { text: statusText(s, now) ?? 'keepwarm is off' }
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) s.lastRequestAt = await $.clock.now()
    yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      const now = await $.clock.now()
      // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
      if (now - s.lastRequestAt > e.durationMs) s.lastRequestAt = now
      if (e.usage && e.usage.model) s.lastModel = e.usage.model
      await arm($, s)
    }
    return r
  })
}
