#!/usr/bin/env node
// Diffs the running build's declarations against the baseline map, the names the
// skill's references restate, and the value-level assertions; optionally scans a
// mod for early-access leftovers.
//
// usage: node api-check.mjs [--types <dir>] [--baseline data/api-map.json] [--refs references/]
//          [--skill SKILL.md] [--mod <dir>] [--write-baseline] [--json]
//
// --mod prints MIGRATE <id> <file>:<line> for each leftover. The ids:
//   M.flag      CLAUDE_CODE_ENABLE_FUNCTION_HOOKS, anywhere
//   M.types     /plugin-types, anywhere
//   M.tsconfig  .claude/types, anywhere (tsconfig.json, .gitignore)
//   M.resolve   await $.ui.resolve(, anywhere
//   M.npx       npx tsc, anywhere
//   M.register  an untyped register(on): in README files, and in .js/.mjs/.ts/.tsx under hooks/
//   M.early     "early access", in README files
//   M.desc      "Needs function hooks" anywhere; "early access" or "function hooks" in a plugin.json description
//
// Exit 0: no stale name, no shape drift, no migrate finding. 1: findings. 2: tooling error.
// Additions and uncovered names never fail the check.
import fs from 'node:fs'
import path from 'node:path'
import {
  FLOOR, SKILL_DIR, diffApiMap, eventNames, extractApiMap, findClaude, isMain, locateTypes,
  methodNames, parseArgs, readTypes, slash, tildify
} from './lib.mjs'

const USAGE = 'usage: node api-check.mjs [--types <dir>] [--baseline data/api-map.json] [--refs references/] [--skill SKILL.md] [--mod <dir>] [--write-baseline] [--json]'
const REGISTER_TO = "import type { Register } from 'claude-code'; export const register: Register = (on, options) => ..."

export const DEFAULTS = {
  baseline: path.join(SKILL_DIR, 'data', 'api-map.json'),
  assertions: path.join(SKILL_DIR, 'data', 'api-assertions.json'),
  refs: path.join(SKILL_DIR, 'references'),
  skill: path.join(SKILL_DIR, 'SKILL.md')
}

const EVENT_FAMILIES = ['tool', 'ui', 'agent', 'prompt', 'command', 'config', 'telemetry', 'skill', 'attribution', 'session', 'plugin', 'turn', 'engine', 'model', 'audio', 'mcp', 'fs', 'store', 'state', 'clock', 'http', 'process', 'settings', 'env']
const FILE_EXT = new Set(['json', 'jsonl', 'ts', 'tsx', 'js', 'mjs', 'cjs', 'mts', 'cts', 'jsx', 'md', 'txt', 'yml', 'yaml', 'sh', 'html', 'css', 'sha256', 'toml', 'lock', 'png', 'svg', 'raw', 'ansi', 'log', 'out', 'err'])
// Placeholders the validator's own refusal text uses, and Node names that look like events.
const DEFAULT_IGNORE = ['$.noun', '$.noun.event', '$.noun.verb', '$.noun.method', 'process.env', 'process.argv', 'process.platform', 'process.exit', 'process.cwd', 'fs.promises']
const BLOCK_KINDS = ['events', 'classic', 'methods', 'nouns', 'components', 'surfaces', 'elements', 'invalidatable', 'tiers', 'budget', 'next', 'tools']

export const MIGRATE_RULES = [
  { id: 'M.flag', re: /CLAUDE_CODE_ENABLE_FUNCTION_HOOKS(?:=[\w-]*)?/, to: `remove it; Claude Code ${FLOOR} and later ignore the flag` },
  { id: 'M.types', re: /\/plugin-types\b/, to: 'remove it; every load writes .claude-plugin/types/' },
  { id: 'M.tsconfig', re: /\.claude\/types\/?/, to: '.claude-plugin/types/ (written on load); tsconfig.json is { "extends": "./.claude-plugin/types/tsconfig.json" }' },
  { id: 'M.resolve', re: /await\s+\$\.ui\.resolve\(/, to: '$.ui.resolve( (it returns, it does not resolve)' },
  { id: 'M.npx', re: /\bnpx\s+tsc\b/, to: 'tsc -p <dir>, or npx -y -p typescript tsc -p <dir>' },
  { id: 'M.register', readme: true, re: /register(?:\s*:\s*Register)?\s*=\s*(?:async\s*)?\(?\s*on\s*\)?\s*=>|function\s+register\s*\(\s*on\s*\)/, to: REGISTER_TO },
  // Hooks modules: an exported register function whose one or two parameters carry no type.
  { id: 'M.register', hooks: true, re: /export\s+(?:async\s+)?function\s+register\s*\(\s*on\s*(?:,\s*[A-Za-z_$][\w$]*\s*)?\)/, to: REGISTER_TO },
  { id: 'M.early', readme: true, re: /early[ -]access/i, to: `drop it; say Claude Code ${FLOOR} or later` },
  { id: 'M.desc', re: /Needs function hooks[^"\n]*/, to: `drop it; say Claude Code ${FLOOR} or later in the README` }
]
const DESC_RULE = { id: 'M.desc', re: /early[ -]access|function hooks/i, to: `drop it; say Claude Code ${FLOOR} or later in the README` }
const HOOKS_CODE = /^hooks\/.*\.(js|mjs|ts|tsx)$/
const MOD_TEXT = /\.(md|json|ts|tsx|js|mjs|cjs|mts|cts|jsx|sh|ya?ml|txt)$|^\.gitignore$/

function liveSets(live) {
  const methods = new Set(methodNames(live))
  return {
    methods,
    nouns: new Set(Object.keys(live.methods)),
    events: new Set(eventNames(live)),
    next: new Set(live.nextMembers),
    families: new Set([...EVENT_FAMILIES, ...eventNames(live).map(e => e.split('.')[0])])
  }
}

function blockItems(kind, raw) {
  const t = raw.replace(/\s+(#|\/\/).*$/, '').trim()
  if (!t || t.startsWith('#') || t.startsWith('//')) return null
  if (kind === 'elements') {
    const m = t.match(/^(\w+):\s*(\w+)$/)
    return m ? { name: `${m[1]}: ${m[2]}` } : { name: t, bad: true }
  }
  if (kind === 'budget') {
    const m = t.match(/^(\w+)(?:\s*[:=]\s*([\d_]+))?$/)
    return m ? { name: m[1], value: m[2] && Number(m[2].replace(/_/g, '')) } : { name: t, bad: true }
  }
  let name = t.split(/\s+/)[0].replace(/\{.*\}$/, '')
  if (kind === 'next') name = name.replace(/^next\./, '')
  if (kind === 'nouns') name = name.replace(/^\$\./, '')
  if (kind === 'methods' && !name.startsWith('$.')) name = '$.' + name
  if (kind === 'classic' && !name.startsWith('classic.')) name = 'classic.' + name
  return { name }
}

function liveForKind(kind, live) {
  switch (kind) {
    case 'events': return eventNames(live)
    case 'classic': return live.events.classic
    case 'methods': return methodNames(live)
    case 'nouns': return Object.keys(live.methods)
    case 'elements': return Object.entries(live.elements).flatMap(([s, l]) => l.map(e => `${s}: ${e}`))
    case 'budget': return Object.keys(live.budget)
    case 'next': return live.nextMembers
    default: return live[kind] || []
  }
}

function spans(line) {
  return [...line.matchAll(/``\s?(.+?)\s?``|`([^`]+)`/g)].map(m => m[1] ?? m[2])
}

// Scans one markdown file: api-* fenced blocks, and backticked names in prose.
function scanFile(text, live, sets, out, rel) {
  const ignore = new Set(DEFAULT_IGNORE)
  for (const m of text.matchAll(/<!--\s*api-check:\s*ignore\s+([\s\S]*?)-->/g)) {
    for (const t of m[1].split(/[,\s]+/).filter(Boolean)) { ignore.add(t); ignore.add(t.replace(/^\$\./, '')) }
  }
  const ignored = n => ignore.has(n) || ignore.has(n.replace(/^\$\./, ''))
  const stale = (name, line, kind) => { if (!ignored(name)) out.stale.push({ name, file: rel, line: line + 1, kind }) }
  const isExt = n => FILE_EXT.has(n.split('.').pop())
  const lines = text.split('\n')
  let fence = null
  lines.forEach((line, i) => {
    const f = line.match(/^\s*(`{3,}|~{3,})\s*([^\s`]*)/)
    if (f && !fence) { fence = { mark: f[1], info: f[2], start: i }; return }
    if (fence && line.trim().startsWith(fence.mark)) { fence = null; return }
    if (fence) {
      if (!fence.info.startsWith('api-')) return
      const kind = fence.info.slice(4)
      if (!BLOCK_KINDS.includes(kind)) { if (i === fence.start + 1) stale(`api-${kind} (unknown block kind)`, fence.start, 'block'); return }
      const item = blockItems(kind, line)
      if (!item) return
      out.blocks[kind] ||= new Set()
      out.blocks[kind].add(item.name)
      const known = new Set(liveForKind(kind, live))
      if (item.bad || !known.has(item.name)) stale(item.name, i, `api-${kind}`)
      else if (kind === 'budget' && item.value !== undefined && live.budget[item.name] !== item.value) stale(`${item.name}=${item.value}`, i, 'api-budget')
      return
    }
    for (const span of spans(line)) {
      for (const m of span.matchAll(/\$\.([a-z][a-zA-Z]*)(?:\.([a-zA-Z]+))?/g)) {
        // The test kit's $ also raises any event by name ($.session.start(input), $.classic.Stop(...)).
        const name = `${m[1]}.${m[2]}`
        if (m[2]) { if (!sets.methods.has('$.' + name) && !sets.events.has(name)) stale('$.' + name, i, 'prose') }
        else if (!sets.nouns.has(m[1])) stale(`$.${m[1]}`, i, 'prose')
      }
      for (const m of span.matchAll(/(?<![\w$.])classic\.([A-Za-z]+)\b/g)) {
        if (!sets.events.has(m[0]) && !isExt(m[0])) stale(m[0], i, 'prose')
      }
      for (const m of span.matchAll(/(?<![\w$.])next\.([a-z][a-zA-Z]*)/g)) {
        if (!sets.next.has(m[1]) && !isExt(m[0])) stale(m[0], i, 'prose')
      }
      const candidates = [span.trim().replace(/\{[^}]*\}$/, '').replace(/\(\)$/, ''), ...[...span.matchAll(/['"]([a-z]+\.[a-zA-Z]+)['"]/g)].map(m => m[1])]
      for (const c of new Set(candidates)) {
        const fam = c.match(/^([a-z]+)\.[a-zA-Z]+$/)?.[1]
        if (!fam || fam === 'classic' || !sets.families.has(fam) || sets.events.has(c) || isExt(c)) continue
        stale(c, i, 'prose')
      }
    }
  })
}

function scanMod(modDir) {
  const found = []
  const walk = rel => {
    for (const ent of fs.readdirSync(path.join(modDir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.name === 'node_modules' || ent.name === '.git' || r === '.claude-plugin/types') continue
      if (ent.isDirectory()) { walk(r); continue }
      if (!ent.isFile() || !MOD_TEXT.test(ent.name)) continue
      const readme = /^readme/i.test(ent.name)
      const hooksCode = HOOKS_CODE.test(r)
      const text = fs.readFileSync(path.join(modDir, r), 'utf8')
      const lines = text.split('\n')
      lines.forEach((line, i) => {
        for (const rule of MIGRATE_RULES) {
          if (rule.readme ? !readme : rule.hooks ? !hooksCode : false) continue
          const m = line.match(rule.re)
          if (m) found.push({ id: rule.id, file: r, line: i + 1, old: m[0].trim(), to: rule.to })
        }
      })
      if (ent.name === 'plugin.json') {
        let desc
        try { desc = JSON.parse(text).description } catch {}
        const m = typeof desc === 'string' && desc.match(DESC_RULE.re)
        const line = Math.max(0, lines.findIndex(l => /"description"\s*:/.test(l))) + 1
        if (m && !found.some(f => f.id === 'M.desc' && f.file === r && f.line === line)) {
          found.push({ id: DESC_RULE.id, file: r, line, old: m[0], to: DESC_RULE.to })
        }
      }
    }
  }
  walk('')
  return found
}

// Uncovered live names, per block kind, across the union of every block of that kind.
// An op event (noun.method) is covered by its method $.noun.method in an api-methods block.
// Classic events count only once some reference holds an api-classic block; a kind with no
// block at all is reported once in noBlock and not counted.
export function coverage(blocks, live, noBlock = []) {
  const uncovered = []
  const has = (kind, n) => blocks[kind]?.has(n) ?? false
  const ops = new Set(live.events.op)
  for (const kind of BLOCK_KINDS.filter(k => k !== 'nouns')) {
    let names = liveForKind(kind, live)
    if (kind === 'events') names = names.filter(n => !n.startsWith('classic.'))
    if (!blocks[kind]) { noBlock.push({ kind, count: names.length }); continue }
    for (const n of names) {
      if (has(kind, n)) continue
      if (kind === 'events' && ops.has(n) && has('methods', `$.${n}`)) continue
      if (kind === 'classic' && has('events', n)) continue
      uncovered.push({ name: kind === 'next' ? `next.${n}` : n, kind })
    }
  }
  return uncovered
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export function runApiCheck(opts = {}) {
  const baselinePath = path.resolve(opts.baseline || DEFAULTS.baseline)
  const refsDir = path.resolve(opts.refs || DEFAULTS.refs)
  const skillPath = path.resolve(opts.skill || DEFAULTS.skill)
  const assertionsPath = path.resolve(opts.assertions || DEFAULTS.assertions)
  const loc = opts.typesLoc || locateTypes({ typesPath: opts.types, claude: opts.types ? null : findClaude() })
  const { main, tools } = readTypes(loc)
  const live = extractApiMap(main, tools)
  const res = {
    live: { version: live.version, file: loc.file, source: loc.source },
    baseline: null, drift: [], stale: [], uncovered: [], noBlock: [], shapeDrift: [], migrate: [],
    refs: { dir: refsDir, found: false, files: 0 }, wroteBaseline: null
  }
  if (opts.writeBaseline) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
    fs.writeFileSync(baselinePath, JSON.stringify(live, null, 2) + '\n')
    res.wroteBaseline = baselinePath
  }
  const base = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  res.baseline = { version: base.version, file: baselinePath }
  res.drift = diffApiMap(base, live)

  const sets = liveSets(live)
  const scan = { stale: res.stale, blocks: {} }
  const relTo = p => slash(path.relative(path.dirname(refsDir), p))
  if (fs.existsSync(refsDir) && fs.statSync(refsDir).isDirectory()) {
    const files = fs.readdirSync(refsDir).filter(f => f.endsWith('.md')).sort()
    res.refs = { dir: refsDir, found: true, files: files.length }
    for (const f of files) {
      const p = path.join(refsDir, f)
      scanFile(fs.readFileSync(p, 'utf8'), live, sets, scan, relTo(p))
    }
    res.uncovered.push(...coverage(scan.blocks, live, res.noBlock))
  }
  if (fs.existsSync(skillPath)) scanFile(fs.readFileSync(skillPath, 'utf8'), live, sets, { stale: res.stale, blocks: {} }, relTo(skillPath))

  const haystack = main + '\n' + tools
  for (const a of JSON.parse(fs.readFileSync(assertionsPath, 'utf8'))) {
    if (!new RegExp(a.pattern, 'm').test(haystack)) res.shapeDrift.push({ id: a.id, claim: a.claim, file: a.file })
  }
  if (opts.mod) res.migrate = scanMod(path.resolve(opts.mod))

  const adds = res.drift.filter(d => d.sign === '+')
  const addMethods = adds.filter(d => d.family === 'method').length
  const addEvents = adds.filter(d => d.family.endsWith('event')).length
  const addOther = adds.length - addMethods - addEvents
  const removed = res.drift.filter(d => d.sign === '-').length
  res.summary = `drift: +${addMethods} methods, +${addEvents} events, ${addOther ? `+${addOther} other, ` : ''}${removed} removed; ` +
    `references: ${res.stale.length} stale, ${res.uncovered.length} uncovered, ${res.shapeDrift.length} shape drift` +
    (opts.mod ? `; mod: ${res.migrate.length} migrate` : '')
  res.exit = res.stale.length || res.shapeDrift.length || res.migrate.length ? 1 : 0
  return res
}

export function formatApiCheck(res) {
  const out = []
  out.push(`api-check: baseline ${res.baseline.version} (${tildify(res.baseline.file)}), live ${res.live.version} (${tildify(res.live.file)}, ${res.live.source})`)
  if (res.wroteBaseline) out.push(`wrote ${tildify(res.wroteBaseline)} from the live types`)
  for (const d of res.drift) out.push(`${d.sign} ${d.name} (${d.family})`)
  for (const s of res.stale) out.push(`STALE ${s.name} at ${s.file}:${s.line}`)
  for (const u of res.uncovered) out.push(`UNCOVERED ${u.name} (api-${u.kind})`)
  for (const b of res.noBlock) out.push(`NO BLOCK api-${b.kind}: ${plural(b.count, 'live name')} not listed in references (not counted)`)
  for (const s of res.shapeDrift) out.push(`SHAPE DRIFT ${s.id}: "${s.claim}" no longer matches (cited at ${s.file})`)
  for (const m of res.migrate) out.push(`MIGRATE ${m.id} ${m.file}:${m.line}: ${m.old} -> ${m.to}`)
  if (!res.refs.found) out.push(`references: none at ${tildify(res.refs.dir)} (0 stale reported; nothing to check)`)
  out.push(res.summary)
  return out.join('\n')
}

// --help prints the id list from the header above, so the two never disagree.
const migrateIds = () => fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n')
  .filter(l => /^\/\/ {3}M\./.test(l)).map(l => '  ' + l.slice(5)).join('\n')

// process.exitCode, not process.exit: stdout to a pipe is asynchronous on macOS and
// an early exit cuts the report short.
if (isMain(import.meta)) {
  let args
  try {
    args = parseArgs(process.argv.slice(2), { flags: ['write-baseline', 'json', 'help'], values: ['types', 'baseline', 'refs', 'skill', 'mod'] })
  } catch (e) { console.error(`${e.message}\n${USAGE}`); process.exitCode = 2 }
  if (args?.help) console.log(`${USAGE}\n\nMIGRATE ids printed by --mod:\n${migrateIds()}`)
  else if (args) {
    try {
      const res = runApiCheck({ ...args, writeBaseline: args['write-baseline'] })
      console.log(args.json ? JSON.stringify(res, null, 2) : formatApiCheck(res))
      process.exitCode = res.exit
    } catch (e) {
      console.error(`api-check: ${e.message}`)
      process.exitCode = 2
    }
  }
}
