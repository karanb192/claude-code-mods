#!/usr/bin/env node
// Shared code for the mod-builder scripts. Not a command: import it.
//
//   import { FLOOR, findClaude, locateTypes, extractApiMap, ... } from './lib.mjs'
//
// Node 18 or newer, no dependencies.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const FLOOR = '2.1.287'
export const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))
export const SKILL_DIR = path.dirname(SCRIPTS_DIR)
export const PROBE_SRC = path.join(SKILL_DIR, 'assets', 'probe-mod')
export const LOAD_TIMEOUT_MS = 90_000

const IS_WIN = process.platform === 'win32'
const VERSION_RE = /^(\d+\.\d+\.\d+)/
const TYPES_LINE_RE = /^\/\/ Written by Claude Code (\d+\.\d+\.\d+)/

export function slash(p) { return p.split(path.sep).join('/') }

export function tildify(p) {
  const home = os.homedir()
  return p === home || p.startsWith(home + path.sep) ? '~' + slash(p.slice(home.length)) : slash(p)
}

export function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

function isExecutable(p) {
  try {
    if (!fs.statSync(p).isFile()) return false
    fs.accessSync(p, fs.constants.X_OK)
    return true
  } catch { return false }
}

export function which(name, env = process.env) {
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const p = path.join(dir, name + ext)
      if (isExecutable(p)) return p
    }
  }
  return null
}

export function runClaude(bin, args, { cwd, env = process.env, timeoutMs = 60_000, input = '' } = {}) {
  const childEnv = { ...env }
  // The early-access flag is ignored from 2.1.287 on; deleting it keeps a stale
  // value in the caller's shell from changing what a proof shows.
  delete childEnv.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS
  const r = spawnSync(bin, args, {
    cwd, env: childEnv, input, encoding: 'utf8', timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024, shell: IS_WIN && /\.(cmd|bat)$/i.test(bin)
  })
  return {
    code: r.status,
    stdout: r.stdout || '',
    stderr: (r.stderr || '') + (r.error ? `\n${r.error.message}` : ''),
    timedOut: r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM'
  }
}

function versionOf(bin, env) {
  const r = runClaude(bin, ['--version'], { env, timeoutMs: 30_000 })
  return r.stdout.trim().match(VERSION_RE)?.[1] || null
}

// Returns { bin, version, source } for the binary the scripts will run, or null.
// Extra fields: pathBin and pathVersion when CLAUDE_CODE_EXECPATH names another
// binary than PATH does; ignoredExecPath when that variable names nothing runnable.
export function findClaude(env = process.env) {
  const exec = env.CLAUDE_CODE_EXECPATH
  const onPath = which('claude', env)
  if (exec && isExecutable(exec)) {
    const found = { bin: exec, version: versionOf(exec, env), source: 'CLAUDE_CODE_EXECPATH' }
    if (onPath && fs.realpathSync(onPath) !== fs.realpathSync(exec)) {
      found.pathBin = onPath
      found.pathVersion = versionOf(onPath, env)
    }
    return found
  }
  if (!onPath) return exec ? { bin: null, version: null, source: null, ignoredExecPath: exec } : null
  const found = { bin: onPath, version: versionOf(onPath, env), source: 'PATH' }
  if (exec) found.ignoredExecPath = exec
  return found
}

// The harness home holds the isolated config dir, generated types, runs and the
// strike record. Refused when it could leak: a symlink, someone else's, or open
// to group or other.
export function harnessHome(env = process.env) {
  const dir = path.resolve(env.MOD_BUILDER_HOME || path.join(os.homedir(), '.cache', 'mod-builder'))
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const st = fs.lstatSync(dir)
  if (st.isSymbolicLink()) throw new Error(`harness home ${tildify(dir)} is a symlink; point MOD_BUILDER_HOME at a real directory`)
  if (!st.isDirectory()) throw new Error(`harness home ${tildify(dir)} is not a directory`)
  if (!IS_WIN) {
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
      throw new Error(`harness home ${tildify(dir)} is owned by uid ${st.uid}, not by you`)
    }
    if (st.mode & 0o077) {
      throw new Error(`harness home ${tildify(dir)} is open to group or other (mode ${(st.mode & 0o777).toString(8)}); run chmod 700 ${tildify(dir)}`)
    }
  }
  const home = {
    dir,
    config: path.join(dir, 'config'),
    types: path.join(dir, 'types'),
    runs: path.join(dir, 'runs'),
    probe: path.join(dir, 'probe'),
    strikes: path.join(dir, 'strikes.json')
  }
  for (const d of [home.config, home.types, home.runs, home.probe]) fs.mkdirSync(d, { recursive: true, mode: 0o700 })
  return home
}

// Splits on `sep` outside (), {} and /"..."/ regex literals.
function splitTop(s, sep = ',') {
  const out = []
  let depth = 0, inRe = false, cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (!inRe && c === '/' && s[i + 1] === '"') { inRe = true; cur += c; continue }
    if (inRe && c === '"' && s[i + 1] === '/') { inRe = false; cur += '"/'; i++; continue }
    if (!inRe && (c === '(' || c === '{')) depth++
    if (!inRe && (c === ')' || c === '}')) depth--
    if (!inRe && depth === 0 && c === sep) { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function listOrNothing(v) {
  const t = v.trim()
  return !t || /^nothing\b/.test(t) ? [] : splitTop(t)
}

function parseMatcher(body) {
  const m = {}
  for (const part of splitTop(body)) {
    const eq = part.indexOf('=')
    if (eq < 0) { m[part] = true; continue }
    const k = part.slice(0, eq).trim(), v = part.slice(eq + 1).trim()
    m[k] = v.startsWith('/"') ? v : v.includes('|') ? v.split('|') : v
  }
  return m
}

const issue = x => typeof x === 'string' ? { path: null, message: x } : { path: x?.path ?? null, message: x?.message ?? JSON.stringify(x) }
const NOTE_RE = /^(\S+) (hooks|calls|env reads|env writes|state reads|state writes|surface modules): (.*)$/
const DECLARES_RE = /^types (\S+) declares (on \$|state): (.*)$/

// Reads the object `claude plugin validate --json` prints.
export function parseValidateJson(obj) {
  const parts = [obj.manifest, ...(obj.contents || [])].filter(Boolean)
  const r = {
    success: obj.success === true,
    errors: parts.flatMap(p => (p.errors || []).map(issue)),
    warnings: parts.flatMap(p => (p.warnings || []).map(issue)),
    notes: parts.flatMap(p => p.notes || []),
    hooks: [], calls: [], via: {},
    envReads: [], envWrites: [], stateReads: [], stateWrites: [], surfaces: [],
    declares: { nouns: [], state: [] }
  }
  const add = (list, v) => { if (!list.includes(v)) list.push(v) }
  for (const note of r.notes) {
    const d = note.match(DECLARES_RE)
    if (d) { for (const v of listOrNothing(d[3])) add(d[2] === 'state' ? r.declares.state : r.declares.nouns, v); continue }
    const m = note.match(NOTE_RE)
    if (!m) continue
    const [, , kind, rest] = m
    if (kind === 'hooks') {
      for (const h of listOrNothing(rest)) {
        const b = h.indexOf('{')
        const hook = b < 0 ? { event: h, matcher: {} } : { event: h.slice(0, b), matcher: parseMatcher(h.slice(b + 1, h.lastIndexOf('}'))) }
        if (!r.hooks.some(x => JSON.stringify(x) === JSON.stringify(hook))) r.hooks.push(hook)
      }
    } else if (kind === 'calls') {
      for (const c of listOrNothing(rest)) {
        const v = c.match(/^(\S+)\s+\(via ([^)]*)\)$/)
        const name = v ? v[1] : c
        add(r.calls, name)
        if (v) for (const fn of v[2].split(',').map(s => s.trim()).filter(Boolean)) add(r.via[name] ||= [], fn)
      }
    } else {
      const key = { 'env reads': 'envReads', 'env writes': 'envWrites', 'state reads': 'stateReads', 'state writes': 'stateWrites', 'surface modules': 'surfaces' }[kind]
      for (const v of listOrNothing(rest)) add(r[key], v)
    }
  }
  return r
}

// Debug-log line forms, as regex sources (use with the "m" flag).
export const LOG_PATTERNS = {
  // documented: troubleshoot.md, "Read the debug log"
  loaded: String.raw`hooks module (\S+)@(\S+) loaded \(([^)]*)\); events: (.*)$`,
  // documented: troubleshoot.md, "Nothing the mod adds appears"
  notLoaded: String.raw`hooks module (\S+)@(\S+) not loaded: (.*)$`,
  // documented: troubleshoot.md, "hooks module did not load"
  didNotLoad: String.raw`(\S+?):? hooks module did not load: (.*)$`,
  // observed on 2.1.288
  settled: String.raw`hooks module (\S+)@(\S+) (\S+) settled in ([\d.]+)ms`,
  // observed on 2.1.288
  call: String.raw`(?:^|\] )(\$\.[a-z]+\.[A-Za-z]+) \(([^)\s]+)\)(?:: (.*))?$`,
  // observed on 2.1.288
  uiLog: String.raw`\[(\S+)\] \$\.ui\.log( \(to debug\))?: (.*)$`,
  // observed on 2.1.288
  typeRoot: String.raw`type root of (\S+) at (.+?): entries ([^;]*); wrote (.*)$`,
  // documented: troubleshoot.md, "hook skipped"
  skipped: String.raw`(\S+): (\S+) hook skipped: (.*)$`,
  // documented: troubleshoot.md, "no command.run hook answered it"
  noCommandHook: String.raw`(\S+) registered /(\S+) but no command\.run hook answered it`,
  // documented: interface.md and troubleshoot.md, a tree that does not validate
  renderRefused: String.raw`ui\.render \((\w+)\)(?: refused: |: a hook returned a tree that does not validate)(.*)$`
}

export function matchLog(text, key) {
  return [...text.matchAll(new RegExp(LOG_PATTERNS[key], 'gm'))]
}

// Sorted "<sha256>  <relative path>" lines for every file under dir.
export function hashTree(dir, { exclude = [] } = {}) {
  const out = []
  const skip = rel => exclude.some(ex => ex.includes('/') ? rel === ex || rel.startsWith(ex + '/') : rel.split('/').includes(ex))
  const walk = rel => {
    for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (skip(r)) continue
      const abs = path.join(dir, r)
      if (ent.isDirectory()) walk(r)
      else if (ent.isSymbolicLink()) out.push([r, createHash('sha256').update('symlink:' + fs.readlinkSync(abs)).digest('hex')])
      else if (ent.isFile()) out.push([r, createHash('sha256').update(fs.readFileSync(abs)).digest('hex')])
    }
  }
  walk('')
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([r, h]) => `${h}  ${r}`)
}

// ---------- the declarations ----------

export function typesVersion(text) {
  return text.split('\n', 1)[0].match(TYPES_LINE_RE)?.[1] || null
}

function blockLines(lines, startRe, endRe) {
  const i = lines.findIndex(l => startRe.test(l))
  if (i < 0) return null
  const out = []
  for (let j = i + 1; j < lines.length && !endRe.test(lines[j]); j++) out.push(lines[j])
  return out
}

const keysOf = (block, re) => (block || []).map(l => l.match(re)?.[1]).filter(Boolean)

function unionLiterals(text, name, seen = new Set()) {
  if (seen.has(name)) return []
  seen.add(name)
  const m = text.match(new RegExp(`^  export type ${name} = ([^\\n]+);$`, 'm'))
  if (!m) return []
  return m[1].split('|').map(s => s.trim()).flatMap(t => {
    const lit = t.match(/^'([^']+)'$|^"([^"]+)"$/)
    if (lit) return [lit[1] ?? lit[2]]
    return /^[A-Z]\w*$/.test(t) ? unionLiterals(text, t, seen) : []
  })
}

function nounsOf(block) {
  const methods = {}
  let noun = null
  for (const l of block || []) {
    const open = l.match(/^      (\w+)\??: \{\s*$/)
    if (open) { noun = open[1]; methods[noun] ||= []; continue }
    if (/^      \};?\s*$/.test(l)) { noun = null; continue }
    const m = noun && l.match(/^          (\w+)\??\s*[:(<]/)
    if (m && !methods[noun].includes(m[1])) methods[noun].push(m[1])
  }
  return methods
}

const FLOORS = { 'engine events': 40, 'op events': 50, 'classic events': 30, methods: 70, components: 15, surfaces: 4, tiers: 5, budget: 3 }

// Reads the two module files a load writes into a map of every name the build declares.
export function extractApiMap(claudeCodeDts, toolsDts = '') {
  const version = typesVersion(claudeCodeDts)
  if (!version) throw new Error('the d.ts shape changed; fix the extractor (version line)')
  const lines = claudeCodeDts.split('\n')
  const END = /^  \};?\s*$/
  const QUOTED = /^      ['"]([^'"]+)['"]\??:/
  const engine = keysOf(blockLines(lines, /^  export type EngineEventOf = \{/, END), QUOTED)
  const op = keysOf(blockLines(lines, /^  export type OpEventOf = \{/, END), QUOTED)
  const classic = [...new Set([...claudeCodeDts.matchAll(/hook_event_name: '([A-Za-z]+)'/g)].map(m => 'classic.' + m[1]))].sort()
  const methods = nounsOf(blockLines(lines, /^  export interface CoreEngineInterface \{/, END))
  for (const [noun, list] of Object.entries(nounsOf(blockLines(lines, /^  export interface EngineInterface extends CoreEngineInterface \{/, END)))) {
    methods[noun] = [...new Set([...(methods[noun] || []), ...list])]
  }
  const MEMBER = /^      readonly (\w+)\??:/
  const nextMembers = [...new Set([
    ...keysOf(blockLines(lines, /^  export type Next</, END), MEMBER),
    ...keysOf(blockLines(lines, /^  export type Caught = \{/, END), MEMBER)
  ])]
  const elements = {}
  let surface = null
  for (const l of blockLines(lines, /^  export type Elements = \{/, END) || []) {
    const open = l.match(/^      (\w+): \{\s*$/)
    if (open) { surface = open[1]; elements[surface] = []; continue }
    if (/^      \};?\s*$/.test(l)) { surface = null; continue }
    const el = surface && l.match(/^          (\w+)\??:/)
    if (el) elements[surface].push(el[1])
  }
  const tiers = (claudeCodeDts.match(/const TIERS: readonly \[([^\]]+)\]/)?.[1] || '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  const budget = {}
  for (const l of blockLines(lines, /^  export type HookBudget = \{/, END) || []) {
    const b = l.match(/^      readonly (\w+): ([\d_]+);/)
    if (b) budget[b[1]] = Number(b[2].replace(/_/g, ''))
  }
  const toolLines = (toolsDts || claudeCodeDts).split('\n')
  const tools = keysOf(blockLines(toolLines, /^  interface BuiltinToolInputs \{/, /^  \}\s*$/), /^    "?([\w-]+)"?\??:/)
  const map = {
    version,
    extractedAt: new Date().toISOString().slice(0, 10),
    events: { engine, op, classic },
    methods,
    nextMembers,
    components: unionLiterals(claudeCodeDts, 'RenderComponent'),
    surfaces: unionLiterals(claudeCodeDts, 'RenderSurface'),
    elements,
    invalidatable: unionLiterals(claudeCodeDts, 'InvalidatableEventName'),
    tiers,
    budget,
    tools
  }
  const counts = {
    'engine events': engine.length, 'op events': op.length, 'classic events': classic.length,
    methods: methodNames(map).length, components: map.components.length, surfaces: map.surfaces.length,
    tiers: tiers.length, budget: Object.keys(budget).length
  }
  for (const [family, floor] of Object.entries(FLOORS)) {
    if (counts[family] < floor) throw new Error(`the d.ts shape changed; fix the extractor (${family})`)
  }
  return map
}

export function methodNames(map) {
  return Object.entries(map.methods).flatMap(([noun, list]) => list.map(m => `$.${noun}.${m}`))
}

export function eventNames(map) {
  return [...map.events.engine, ...map.events.op, ...map.events.classic]
}

// Every family as a flat list of names, keyed by a label used in diff lines.
export function families(map) {
  return {
    'engine event': map.events.engine,
    'op event': map.events.op,
    'classic event': map.events.classic,
    method: methodNames(map),
    'next member': map.nextMembers.map(m => `next.${m}`),
    component: map.components,
    surface: map.surfaces,
    element: Object.entries(map.elements).flatMap(([s, list]) => list.map(e => `${s}: ${e}`)),
    invalidatable: map.invalidatable,
    tier: map.tiers,
    budget: Object.entries(map.budget).map(([k, v]) => `${k}=${v}`),
    tool: map.tools
  }
}

// [{ sign: '+'|'-', family, name }] from baseline to live.
export function diffApiMap(base, live) {
  const out = []
  const b = families(base), l = families(live)
  for (const fam of Object.keys(l)) {
    const bs = new Set(b[fam] || []), ls = new Set(l[fam])
    for (const n of l[fam]) if (!bs.has(n)) out.push({ sign: '+', family: fam, name: n })
    for (const n of b[fam] || []) if (!ls.has(n)) out.push({ sign: '-', family: fam, name: n })
  }
  return out
}

// Reads a types location into { main, tools, version }.
export function readTypes(loc) {
  if (loc.file && !loc.dir) {
    const main = fs.readFileSync(loc.file, 'utf8')
    return { main, tools: main, version: typesVersion(main) }
  }
  const main = fs.readFileSync(path.join(loc.dir, 'claude-code', 'index.d.ts'), 'utf8')
  const toolsFile = path.join(loc.dir, 'claude-code-tools', 'index.d.ts')
  const tools = fs.existsSync(toolsFile) ? fs.readFileSync(toolsFile, 'utf8') : ''
  return { main, tools, version: typesVersion(main) }
}

function typesAt(p) {
  if (!p || !fs.existsSync(p)) return null
  const st = fs.statSync(p)
  if (st.isFile()) {
    const dir = path.basename(p) === 'index.d.ts' && path.basename(path.dirname(p)) === 'claude-code' ? path.dirname(path.dirname(p)) : null
    return dir ? { dir, file: p } : { dir: null, file: p }
  }
  for (const dir of [p, path.dirname(p)]) {
    const file = path.join(dir, 'claude-code', 'index.d.ts')
    if (fs.existsSync(file)) return { dir, file }
  }
  return null
}

function firstLine(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(200)
    const n = fs.readSync(fd, buf, 0, 200, 0)
    return buf.subarray(0, n).toString('utf8')
  } finally { fs.closeSync(fd) }
}

// Finds this build's declarations; generates them with a headless probe load when
// nothing usable is on disk. Returns { dir, file, version, source }.
export function locateTypes({ modDir, typesPath, home, claude } = {}) {
  const tag = (loc, source) => ({ ...loc, version: typesVersion(firstLine(loc.file)), source })
  if (typesPath) {
    const loc = typesAt(path.resolve(typesPath))
    if (!loc) throw new Error(`no declarations at ${typesPath} (want a dir holding claude-code/index.d.ts, or that file)`)
    return tag(loc, 'file')
  }
  if (modDir) {
    const loc = typesAt(path.join(path.resolve(modDir), '.claude-plugin', 'types'))
    if (loc) return tag(loc, 'mod')
  }
  if (!claude?.version) throw new Error('no claude binary to generate types with, and no --types path')
  const h = typeof home === 'string' ? { dir: home, types: path.join(home, 'types') } : home || harnessHome()
  const cached = typesAt(path.join(h.types, claude.version))
  if (cached && typesVersion(firstLine(cached.file)) === claude.version) return tag(cached, 'cache')
  const dir = generateTypes({ home: h, claude })
  return tag(typesAt(dir), 'generated')
}

// Loads a copy of the probe mod headlessly under the harness config so the engine
// writes this build's types, then keeps them under <home>/types/<version>/.
export function generateTypes({ home, claude, probeSrc } = {}) {
  const h = typeof home === 'string' ? harnessHome({ ...process.env, MOD_BUILDER_HOME: home }) : home || harnessHome()
  const src = probeSrc || process.env.MOD_BUILDER_PROBE_DIR || PROBE_SRC
  const name = JSON.parse(fs.readFileSync(path.join(src, '.claude-plugin', 'plugin.json'), 'utf8')).name
  const copy = path.join(h.probe, claude.version)
  const log = copy + '.log'
  fs.rmSync(copy, { recursive: true, force: true })
  fs.rmSync(log, { force: true })
  fs.cpSync(src, copy, { recursive: true, filter: s => !slash(s).includes('/.claude-plugin/types') && !slash(s).includes('/node_modules') })
  const env = { ...process.env, CLAUDE_CONFIG_DIR: h.config }
  const r = runClaude(claude.bin, ['-p', 'ok', '--plugin-dir', copy, '--debug-file', log, '--strict-mcp-config'], { cwd: h.probe, env, timeoutMs: LOAD_TIMEOUT_MS })
  const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''
  const refusal = text.match(new RegExp(`hooks module ${name}@inline not loaded: .*`))?.[0]
  if (!text.includes(`type root of ${name} at`) || !text.includes(`hooks module ${name}@inline loaded`)) {
    const why = refusal || (r.timedOut ? `timed out after ${LOAD_TIMEOUT_MS / 1000} s` : `exit ${r.code}${(r.stdout + r.stderr).trim() ? ': ' + (r.stdout + r.stderr).trim().split('\n')[0] : ''}`)
    throw new Error(`types not generated (${why}); log ${tildify(log)}`)
  }
  const written = path.join(copy, '.claude-plugin', 'types')
  const v = typesVersion(firstLine(path.join(written, 'claude-code', 'index.d.ts')))
  if (v !== claude.version) throw new Error(`binary says ${claude.version}, types say ${v}; log ${tildify(log)}`)
  const dest = path.join(h.types, v)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 })
  for (const ent of fs.readdirSync(written)) fs.renameSync(path.join(written, ent), path.join(dest, ent))
  return dest
}

export function parseArgs(argv, { flags = [], values = [] } = {}) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const [k, inline] = a.startsWith('--') ? a.slice(2).split(/=(.*)/s) : [null]
    if (k && flags.includes(k)) out[k] = true
    else if (k && values.includes(k)) {
      const v = inline ?? argv[++i]
      if (v === undefined) throw new Error(`--${k} needs a value`)
      out[k] = v
    } else if (k) throw new Error(`unknown flag --${k}`)
    else out._.push(a)
  }
  return out
}

export function isMain(meta) {
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(meta.url)) } catch { return false }
}
