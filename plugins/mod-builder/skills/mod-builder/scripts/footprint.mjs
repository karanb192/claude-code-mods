#!/usr/bin/env node
// Prints a mod's static footprint from `claude plugin validate --json`, grades its reach with
// the same rules as the awesome-claude-code-mods scanner, and diffs the calls against a plan.
//
//   node footprint.mjs <plugin-dir> [--plan '$.ui.log,$.store.get'] [--claude <path>]
//
// Exit 0 when validation passes and every printed call is in the plan (or no plan was given).
// Exit 1 when validation fails or the validator printed a call the plan did not list.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const RULES = [
  [/^\$\.http\.fetch$/, 3, 'network'],
  [/^\$\.mcp\.call$/, 3, 'MCP servers'],
  [/^\$\.process\.run$/, 2, 'runs processes'],
  [/^\$\.fs\.write$/, 2, 'writes files'],
  [/^\$\.env\.set$/, 2, 'sets env vars'],
  [/^\$\.config\.set$/, 2, 'changes config'],
  [/^\$\.(model\.\w+|agent\.spawn|prompt\.submit|tool\.call|command\.run|turn\.abort|session\.compact|tool\.register)$/, 2, 'drives Claude'],
  [/^\$\.prompt\.(fill|suggest)$/, 1, 'writes the prompt box'],
  [/^\$\.fs\.(read|readFile|list|stat|exists|ancestors)$/, 1, 'reads files'],
  [/^\$\.env\.get$/, 1, 'reads env vars'],
  [/^\$\.settings\.read$/, 1, 'reads settings'],
  [/^\$\.session\.(messages|authorize)$/, 1, 'reads the transcript'],
  [/^\$\.telemetry\.\w+$/, 1, 'telemetry'],
  [/^\$\.audio\.\w+$/, 0, 'plays audio'],
  [/^\$\.store\.\w+$/, 0, 'persists state'],
  [/^\$\.ui\.\w+$/, 0, 'draws'],
  [/^\$\.agent\.list$/, 0, null],
  [/^\$\.(clock|command|plugin|session|config)\.\w+$/, 0, null],
]
const LEVEL_NAMES = ['draws and remembers', 'reads', 'writes or runs', 'network']

function grade(calls) {
  let level = 0
  const labels = new Set()
  for (const call of calls) {
    const rule = RULES.find(([re]) => re.test(call))
    if (!rule) { labels.add(`other: ${call}`); level = Math.max(level, 1); continue }
    level = Math.max(level, rule[1])
    if (rule[2]) labels.add(rule[2])
  }
  const order = l => RULES.findIndex(r => r[2] === l)
  return { level, name: LEVEL_NAMES[level], labels: [...labels].sort((a, b) => order(a) - order(b)) }
}

function visibility(hooks) {
  const sees = new Set()
  for (const { event, matcher } of hooks) {
    if (event === '*') sees.add('everything')
    else if (event === 'tool.call') sees.add(matcher.tool ? `${matcher.tool} calls` : 'every tool call')
    else if (event === 'prompt.submit') sees.add('every prompt')
    else if (event === 'prompt.context' || event === 'prompt.section') sees.add('the system prompt')
    else if (event === 'session.compact') sees.add('compaction')
    else if (event === 'agent.spawn') sees.add('subagent spawns')
    else if (event === 'skill.prompt') sees.add(matcher.skill ? `the ${matcher.skill} skill` : 'every skill')
    else if (event.startsWith('classic.')) sees.add('classic hooks')
  }
  return [...sees]
}

function parseHooks(text) {
  const out = []
  for (const m of text.matchAll(/([\w.*-]+)(\{[^}]*\})?/g)) {
    const matcher = {}
    if (m[2]) for (const kv of m[2].slice(1, -1).split(',')) {
      const [k, v] = kv.split('=').map(s => s.trim())
      if (k) matcher[k] = v
    }
    out.push({ event: m[1], matcher })
  }
  return out
}

const args = process.argv.slice(2)
const target = args.find(a => !a.startsWith('--'))
if (!target) { console.error('usage: node footprint.mjs <plugin-dir> [--plan "$.a.b,$.c.d"] [--claude <path>]'); process.exit(2) }
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const plan = (flag('--plan') ?? '').split(',').map(s => s.trim()).filter(Boolean)
const claude = flag('--claude') ?? 'claude'

let manifest = resolve(target)
if (!manifest.endsWith('.json')) manifest = join(manifest, '.claude-plugin', 'plugin.json')
if (!existsSync(manifest)) { console.error(`no manifest at ${manifest}`); process.exit(2) }

const run = spawnSync(claude, ['plugin', 'validate', '--json', manifest], { encoding: 'utf8' })
if (run.error) { console.error(`could not run ${claude}: ${run.error.message}`); process.exit(2) }
let report
try { report = JSON.parse(run.stdout) } catch { console.error(run.stdout || run.stderr); process.exit(2) }

const hooks = [], calls = new Set(), surfaces = [], notes = [], errors = []
for (const part of [report.manifest, ...(report.contents ?? [])]) {
  if (!part) continue
  errors.push(...(part.errors ?? []))
  for (const note of part.notes ?? []) {
    notes.push(note)
    const h = note.match(/^(\S+) hooks: (.*)$/)
    const c = note.match(/^(\S+) calls: (.*)$/)
    const s = note.match(/surface modules: (.*)$/)
    if (h) hooks.push(...parseHooks(h[2]))
    if (c) for (const call of c[2].split(',').map(x => x.trim()).filter(Boolean)) calls.add(call)
    if (s) surfaces.push(...s[1].split(',').map(x => x.trim()))
  }
}

console.log(`validate: ${report.success ? 'passed' : 'FAILED'}`)
for (const line of notes) console.log(`  ❯ ${line}`)
for (const err of errors) console.log(`  ✘ ${typeof err === 'string' ? err : JSON.stringify(err)}`)

const sorted = [...calls].sort()
const reach = grade(sorted)
console.log(`hooks: ${hooks.map(h => h.event + (Object.keys(h.matcher).length ? '{' + Object.entries(h.matcher).map(([k, v]) => `${k}=${v}`).join(',') + '}' : '')).join(', ') || '(none)'}`)
console.log(`calls: ${sorted.join(', ') || '(none)'}`)
if (surfaces.length) console.log(`surface modules: ${surfaces.join(', ')}`)
console.log(`reach: L${reach.level} ${reach.name}${reach.labels.length ? ' (' + reach.labels.join(', ') + ')' : ''}`)
const sees = visibility(hooks)
console.log(`sees: ${sees.join(', ') || 'only the events listed'}`)

let exit = report.success ? 0 : 1
if (plan.length) {
  const extra = sorted.filter(c => !plan.includes(c))
  const unused = plan.filter(c => !calls.has(c))
  const planned = grade(plan)
  console.log(`plan: ${plan.join(', ')} (L${planned.level} ${planned.name})`)
  if (extra.length) { console.log(`WIDER THAN PLAN: ${extra.join(', ')}. Remove the call or write down why the plan grows.`); exit = 1 }
  if (unused.length) console.log(`planned but unused: ${unused.join(', ')}. Drop them from the plan.`)
  if (!extra.length && !unused.length) console.log('plan and footprint match')
}
process.exit(exit)
