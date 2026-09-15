import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { AgentSpawnInput, CommandRunInput, SessionStartInput } from 'claude-code'

tier('user')

// A test gets the engine's own $, so agent.spawn takes the full event input,
// pinned fields included. That is what lets the fork branch be driven here.
const session: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }
const spawn = (over: Partial<AgentSpawnInput>): AgentSpawnInput => ({
  tool_use_id: 't1',
  prompt: 'worker task',
  description: 'worker',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'opus',
  background: false,
  fork: false,
  model: 'opus',
  ...over,
})
const run = (args: string): CommandRunInput => ({
  command: 'fable-pin',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
})

describe('register', () => {
  test('pins a subagent to fable and leaves a fork alone', async ($, on) => {
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    const seen: string[] = []
    on('agent.spawn', ($, e) => {
      seen.push(`${e.fork ? 'fork' : 'agent'}:${e.model}`)
      return { model: String(e.model), agentId: 'a1' }
    })

    await $.session.start(session)
    await $.agent.spawn(spawn({}))
    await $.agent.spawn(spawn({ fork: true, subagentType: 'fork' }))

    expect(seen).toEqual(['agent:fable', 'fork:opus'])
  })

  test('leaves the model alone after /fable-pin off', async ($, on) => {
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    const models: (string | undefined)[] = []
    on('agent.spawn', ($, e) => {
      models.push(e.model)
      return { model: String(e.model), agentId: 'a1' }
    })

    await $.session.start(session)
    const { text } = await $.command.run(run('off'))
    await $.agent.spawn(spawn({}))

    expect(text).toContain('fable-pin is off')
    expect(models).toEqual(['opus'])
  })
})
