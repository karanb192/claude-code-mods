#!/usr/bin/env node
// Runs `claude plugin validate --strict --json <mod-dir>`, prints the module's footprint, grades its
// reach with data/reach-rules.json, and diffs calls, env names and state keys against a plan.
//
//   node footprint.mjs <mod-dir> [--plan '$.a.b, $.c.d'] [--env 'NAME, NAME'] [--state 'plugin.key'] [--json]
//
// Giving any of --plan, --env, --state turns the diff on for all three; an omitted one means
// "the plan names none", so an unplanned env read or state key is a widening, never silent.
// Exit 0 ok; 1 failed validate, a widening, or a call no rule grades; 2 tooling error.
import { spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// The validator prints matchers, call lists and helper annotations as text inside the JSON notes.
// Commas split items only outside braces, parentheses and the JSON-quoted body of a /"re"/ matcher.
function splitTop(text) {
  const out = []
  let depth = 0, quoted = false, cur = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      cur += c
      if (c === '\\') { cur += text[++i] ?? ''; continue }
      if (c === '"') quoted = false
      continue
    }
    if (c === '"') quoted = true
    else if (c === '{' || c === '(') depth++
    else if (c === '}' || c === ')') depth--
    else if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const isNothing = s => /^nothing\b/.test(s.trim())
const listOf = s => (isNothing(s) ? [] : splitTop(s))

function parseMatcher(inner) {
  const matcher = {}
  for (const pair of splitTop(inner)) {
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    const key = pair.slice(0, eq).trim()
    const raw = pair.slice(eq + 1).trim()
    matcher[key] = raw.startsWith('/') || raw.startsWith('{') || !raw.includes('|') ? raw : raw.split('|')
  }
  return matcher
}

function parseHook(token) {
  const brace = token.indexOf('{')
  if (brace < 0) return { event: token, matcher: {} }
  return { event: token.slice(0, brace), matcher: parseMatcher(token.slice(brace + 1, token.lastIndexOf('}'))) }
}

const issue = x => (typeof x === 'string' ? { path: '', message: x } : { path: x?.path ?? '', message: x?.message ?? JSON.stringify(x) })
const addAll = (arr, items) => { for (const it of items) if (!arr.includes(it)) arr.push(it) }

// Same contract as lib.mjs parseValidateJson; lib's copy wins when it exists.
export function parseValidateJsonLocal(obj) {
  const r = {
    success: obj?.success === true, errors: [], warnings: [], notes: [], hooks: [], calls: [], via: {},
    envReads: [], envWrites: [], stateReads: [], stateWrites: [], surfaces: [], declares: { nouns: [], state: [] },
  }
  for (const part of [obj?.manifest, ...(obj?.contents ?? [])]) {
    if (!part) continue
    r.errors.push(...(part.errors ?? []).map(issue))
    r.warnings.push(...(part.warnings ?? []).map(issue))
    for (const note of part.notes ?? []) {
      r.notes.push(note)
      let m
      if ((m = note.match(/^types \S+ declares on \$: (.*)$/))) { addAll(r.declares.nouns, listOf(m[1])); continue }
      if ((m = note.match(/^types \S+ declares state: (.*)$/))) { addAll(r.declares.state, listOf(m[1])); continue }
      m = note.match(/^(.+?) (hooks|calls|env reads|env writes|state reads|state writes|surface modules): (.*)$/)
      if (!m) continue
      const items = listOf(m[3])
      if (m[2] === 'hooks') r.hooks.push(...items.map(parseHook))
      else if (m[2] === 'calls') {
        for (const item of items) {
          const c = item.match(/^(\S+)(?:\s+\(via (.*)\))?$/)
          if (!c) continue
          addAll(r.calls, [c[1]])
          if (c[2]) addAll((r.via[c[1]] ??= []), c[2].split(',').map(s => s.trim()).filter(Boolean))
        }
      }
      else if (m[2] === 'env reads') addAll(r.envReads, items)
      else if (m[2] === 'env writes') addAll(r.envWrites, items)
      else if (m[2] === 'state reads') addAll(r.stateReads, items)
      else if (m[2] === 'state writes') addAll(r.stateWrites, items)
      else addAll(r.surfaces, items)
    }
  }
  r.calls.sort()
  return r
}

const lib = existsSync(join(HERE, 'lib.mjs')) ? await import('./lib.mjs') : null
export const parseValidateJson = typeof lib?.parseValidateJson === 'function' ? lib.parseValidateJson : parseValidateJsonLocal

export const LEVEL_NAMES = ['draws and remembers', 'reads', 'writes or runs or drives Claude', 'network']

export function loadRules(file = join(HERE, '..', 'data', 'reach-rules.json')) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function ruleFor(call, rules) {
  const name = call.replace(/^\$\./, '')
  return rules.find(({ pattern }) => pattern.endsWith('.*')
    ? name.startsWith(pattern.slice(0, -1)) && !name.slice(pattern.length - 1).includes('.')
    : name === pattern)
}

export function grade(calls, rules) {
  let level = 0
  const labels = [], ungraded = []
  for (const call of calls) {
    const rule = ruleFor(call, rules)
    if (!rule) { ungraded.push(call); continue }
    level = Math.max(level, rule.level)
    if (rule.label && !labels.includes(rule.label)) labels.push(rule.label)
  }
  const order = l => rules.findIndex(r => r.label === l)
  labels.sort((a, b) => order(a) - order(b))
  return { level, name: LEVEL_NAMES[level], labels, ungraded }
}

const shown = v => (Array.isArray(v) ? v.join('|') : v)

export function sees(hooks) {
  const out = []
  const add = s => { if (!out.includes(s)) out.push(s) }
  for (const { event, matcher: m } of hooks) {
    const matcher = m ?? {}
    if (event === '*') add('every event')
    else if (event === 'tool.call') add(matcher.tool ? `${shown(matcher.tool)} calls` : 'every tool call')
    else if (event === 'prompt.submit') add('every prompt')
    else if (event === 'prompt.section' || event === 'prompt.compose') add('the system prompt')
    else if (event === 'prompt.context') add('the first-message context')
    else if (event === 'prompt.attachment') add('prompt attachments')
    else if (event === 'prompt.edit' || event === 'prompt.fill') add('the prompt box')
    else if (event === 'session.compact') add('compaction')
    else if (event === 'session.append') add('every stored row')
    else if (event === 'session.receive' || event === 'session.send') add('cross-session messages')
    else if (event === 'agent.spawn') add('subagent spawns')
    else if (event === 'tool.check') add('permission decisions')
    else if (event === 'skill.prompt') add(matcher.skill ? `the ${shown(matcher.skill)} skill prompt` : 'every skill prompt')
    else if (event.startsWith('classic.')) add(`classic ${event.slice(8)} input`)
    else if (event === 'ui.render') add(matcher.component ? `what ${shown(matcher.component)} shows` : 'every render site')
    else if (event === 'turn.step') add('every model request')
  }
  return out
}

const hookText = ({ event, matcher }) => {
  const pairs = Object.entries(matcher ?? {}).map(([k, v]) => `${k}=${shown(v)}`)
  return pairs.length ? `${event}{${pairs.join(', ')}}` : event
}

const words = s => (s ?? '').split(/[\s,]+/).map(x => x.trim()).filter(Boolean)
export function parsePlan({ plan, env, state } = {}) {
  if (plan === undefined && env === undefined && state === undefined) return null
  return {
    calls: words(plan).map(c => (c.startsWith('$.') ? c : `$.${c}`)),
    env: words(env),
    state: words(state),
  }
}

const stateMatches = (key, planned) => key === planned || key.endsWith(`.${planned}`)

// Builds the printed footprint from a parsed report. Shared with prove.mjs.
export function footprint(report, { plan = null, rules = loadRules() } = {}) {
  const reach = grade(report.calls, rules)
  const seen = sees(report.hooks)
  const lines = []
  const first = report.errors[0]
  lines.push(report.success ? 'validate: passed' : `validate: FAILED${first ? ` (${first.message})` : ''}`)
  for (const note of report.notes) lines.push(`  ❯ ${note}`)
  for (const w of report.warnings) lines.push(`  ! ${w.path ? w.path + ': ' : ''}${w.message}`)
  for (const e of report.errors) lines.push(`  ✘ ${e.path ? e.path + ': ' : ''}${e.message}`)
  const list = xs => (xs.length ? xs.join(', ') : 'nothing')
  lines.push(`hooks: ${report.hooks.length ? report.hooks.map(hookText).join(', ') : 'nothing'}`)
  lines.push(`calls: ${report.calls.length ? report.calls.join(', ') : 'nothing on $'}`)
  lines.push(`env reads: ${list(report.envReads)}`)
  lines.push(`env writes: ${list(report.envWrites)}`)
  lines.push(`state reads: ${list(report.stateReads)}`)
  lines.push(`state writes: ${list(report.stateWrites)}`)
  lines.push(`surface modules: ${list(report.surfaces)}`)
  lines.push(`reach: L${reach.level} ${reach.name}${reach.labels.length ? ` (${reach.labels.join(', ')})` : ''}`)
  lines.push(`sees: ${seen.length ? seen.join(', ') : 'nothing beyond the events listed'}`)
  for (const call of reach.ungraded) lines.push(`ungraded: ${call} (grade by hand from its doc comment in the types; add a rule)`)

  let diff = null
  if (plan) {
    const env = [...new Set([...report.envReads, ...report.envWrites])]
    const keys = [...new Set([...report.stateReads, ...report.stateWrites])]
    diff = {
      wider: report.calls.filter(c => !plan.calls.includes(c)),
      unused: [
        ...plan.calls.filter(c => !report.calls.includes(c)),
        ...plan.env.filter(n => !env.includes(n)),
        ...plan.state.filter(k => !keys.some(key => stateMatches(key, k))),
      ],
      envOutside: env.filter(n => !plan.env.includes(n)),
      stateOutside: keys.filter(key => !plan.state.some(k => stateMatches(key, k))),
    }
    const planned = grade(plan.calls, rules)
    lines.push(`plan: ${plan.calls.join(', ') || 'no calls'}; env ${plan.env.join(', ') || 'none'}; state ${plan.state.join(', ') || 'none'} (L${planned.level} ${planned.name})`)
    if (diff.wider.length) lines.push(`WIDER THAN PLAN: ${diff.wider.join(', ')}. Remove the call or write down why the plan grows.`)
    if (diff.envOutside.length) lines.push(`env outside plan: ${diff.envOutside.join(', ')}`)
    if (diff.stateOutside.length) lines.push(`state outside plan: ${diff.stateOutside.join(', ')}`)
    if (diff.unused.length) lines.push(`planned but unused: ${diff.unused.join(', ')}. Drop them from the plan.`)
    diff.match = !diff.wider.length && !diff.envOutside.length && !diff.stateOutside.length && !diff.unused.length
    if (diff.match) lines.push('plan and footprint match')
  }
  const widened = diff && (diff.wider.length || diff.envOutside.length || diff.stateOutside.length)
  const exit = !report.success || widened || reach.ungraded.length ? 1 : 0
  return { lines, exit, reach, sees: seen, diff }
}

function findClaudeLocal() {
  const exec = process.env.CLAUDE_CODE_EXECPATH
  if (exec) {
    try { accessSync(exec, constants.X_OK); if (statSync(exec).isFile()) return { bin: exec, source: 'CLAUDE_CODE_EXECPATH' } } catch {}
  }
  return { bin: 'claude', source: 'PATH' }
}

function validate(dir) {
  const found = typeof lib?.findClaude === 'function' ? lib.findClaude() : findClaudeLocal()
  const args = ['plugin', 'validate', '--strict', '--json', dir]
  if (typeof lib?.runClaude === 'function') return lib.runClaude(found.bin, args, { cwd: dir, timeoutMs: 60_000 })
  const env = { ...process.env }
  delete env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS
  const run = spawnSync(found.bin, args, { cwd: dir, env, encoding: 'utf8', timeout: 60_000 })
  if (run.error) throw new Error(`could not run ${found.bin}: ${run.error.message}`)
  return { code: run.status, stdout: run.stdout, stderr: run.stderr }
}

function main(argv) {
  const usage = 'usage: footprint.mjs <mod-dir> [--plan "$.a.b, $.c.d"] [--env "NAME"] [--state "plugin.key"] [--json]'
  const valued = new Set(['--plan', '--env', '--state'])
  const opts = {}
  let target, json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') json = true
    else if (valued.has(a)) { if (i + 1 >= argv.length) return fail(`${a} needs a value`); opts[a.slice(2)] = argv[++i] }
    else if (a.startsWith('--')) return fail(`unknown flag ${a}\n${usage}`)
    else if (target) return fail(usage)
    else target = a
  }
  if (!target) return fail(usage)
  let dir = resolve(target)
  if (dir.endsWith('plugin.json')) dir = dirname(dirname(dir))
  if (!existsSync(join(dir, '.claude-plugin', 'plugin.json'))) return fail(`no .claude-plugin/plugin.json under ${dir}`)

  let run
  try { run = validate(dir) } catch (err) { return fail(err.message) }
  let raw
  try { raw = JSON.parse(run.stdout) } catch {
    return fail(`claude plugin validate printed no JSON (exit ${run.code}): ${(run.stderr || run.stdout || '').trim().split('\n')[0]}`)
  }
  let rules
  try { rules = loadRules() } catch (err) { return fail(`cannot read data/reach-rules.json: ${err.message}`) }
  const report = parseValidateJson(raw)
  const plan = parsePlan(opts)
  const out = footprint(report, { plan, rules })
  if (json) {
    console.log(JSON.stringify({ mod: dir, ...report, reach: out.reach, sees: out.sees, ungraded: out.reach.ungraded, plan, diff: out.diff, exit: out.exit }, null, 2))
  } else {
    console.log(out.lines.join('\n'))
  }
  return out.exit

  function fail(msg) {
    if (json) console.log(JSON.stringify({ error: msg, exit: 2 }))
    else console.error(`footprint: ${msg}`)
    return 2
  }
}

const invoked = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } })()
if (invoked) process.exitCode = main(process.argv.slice(2))
export { main }
