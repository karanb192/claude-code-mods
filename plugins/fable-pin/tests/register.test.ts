import { describe, expect, mock, test, tier } from 'claude-code/testing'

tier('user')

describe('register', () => {
  test('rewrites a subagent model to fable and leaves forks alone', async ($, on) => {
    mock.store(on, {})
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    const seen: string[] = []
    on('agent.spawn', ($, e) => {
      seen.push(`${e.fork ? 'fork' : 'agent'}:${e.model}`)
      return { model: String(e.model), agentId: 'a1' }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    const base = { tool_use_id: 't1', name: 'worker', parentModel: 'opus', permissionMode: 'default', parentAgentId: undefined, provider: 'anthropic' } as any
    await $.agent.spawn({ ...base, fork: false, model: 'opus' })
    await $.agent.spawn({ ...base, fork: true, model: 'opus' })

    expect(seen).toEqual(['agent:fable', 'fork:opus'])
  })
})
