// Shared test helpers: temp dirs, a stub `claude`, script runner, the 2.1.287
// snapshot splitter, synthetic declarations built from a map, and live detection.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLOOR, cmpVersion, findClaude, methodNames } from '../scripts/lib.mjs'

export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url))
export const SKILL_DIR = path.dirname(TESTS_DIR)
export const SCRIPTS_DIR = path.join(SKILL_DIR, 'scripts')
export const DATA_DIR = path.join(SKILL_DIR, 'data')
export const PROBE_MOD = path.join(SKILL_DIR, 'assets', 'probe-mod')

const made = []
export function tmpDir(prefix = 'mb-test-') {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  made.push(d)
  return d
}
export function cleanup() {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true })
}

export function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
  return root
}

export function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')) }

// ---------- stub claude ----------
//
// A CommonJS script named `claude` plus stub.json beside it. Every call is appended
// to calls.jsonl as { args, cwd, configDir, flag }. Config keys:
//   version              what --version prints (default 2.1.288)
//   rules                [{ match, stdout, stderr, code, files }]: first regex over the joined
//                        args wins; files are { absolutePath: content } written before answering
//   test                 'pass' | 'fail' | 'no-test' | 'off-here' | 'off-process' | { stdout, stderr, code }
//   validate             { <plugin name> | default: <validate --json object> }; "<abs path>" in it
//                        is replaced by the mod dir
//   load                 { events, calls, uiLog, extraLog, typesFrom, refuse, reply } for -p runs
//   auth                 { loggedIn }
//   list                 what `plugin list --json` prints
//   details              false makes `plugin details` an unknown command
const STUB = String.raw`#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'stub.json'), 'utf8'))
const version = cfg.version || '2.1.288'
const args = process.argv.slice(2)
fs.appendFileSync(path.join(__dirname, 'calls.jsonl'), JSON.stringify({ args, cwd: process.cwd(), configDir: process.env.CLAUDE_CONFIG_DIR || null, flag: 'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS' in process.env }) + '\n')
const nl = s => (s && !s.endsWith('\n') ? s + '\n' : s || '')
const out = (stdout, code = 0, stderr = '') => { process.stdout.write(nl(stdout)); process.stderr.write(nl(stderr)); process.exitCode = code }
const joined = args.join(' ')
for (const r of cfg.rules || []) {
  if (!new RegExp(r.match).test(joined)) continue
  for (const [p, c] of Object.entries(r.files || {})) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c) }
  return out(r.stdout || '', r.code ?? 0, r.stderr || '')
}
const pluginDirs = []; let debugFile = null; const rest = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--plugin-dir') pluginDirs.push(args[++i])
  else if (args[i] === '--debug-file') debugFile = args[++i]
  else rest.push(args[i])
}
const nameOf = d => { try { return JSON.parse(fs.readFileSync(path.join(d, '.claude-plugin', 'plugin.json'), 'utf8')).name } catch { return path.basename(d) } }
const [a0, a1] = rest
if (a0 === '--version') return out(version + ' (Claude Code)')
if (a0 === 'auth' && a1 === 'status') {
  const li = !!(cfg.auth && cfg.auth.loggedIn)
  return out(JSON.stringify({ loggedIn: li, authMethod: li ? 'claude.ai' : 'none' }, null, 2), li ? 0 : 1)
}
if (a0 === 'plugin' && a1 === 'list') return out(rest.includes('--json') ? JSON.stringify(cfg.list || []) : 'No plugins installed.')
if (a0 === 'plugin' && a1 === 'details') {
  if (cfg.details === false) return out('', 1, "error: unknown command 'details'")
  if (rest.includes('--help')) return out('Usage: claude plugin details [options] <name>')
  return out(rest[2] + ' 0.0.1\n  Source: ' + rest[2] + '@inline\n\nProjected token cost\n  Always-on:   ~0 tok   added to every session')
}
if (a0 === 'plugin' && a1 === 'test') {
  const t = cfg.test || 'pass'
  if (t === 'off-here') return out('', 1, 'claude plugin test: hooks modules are turned off here (disableAllHooks, allowManagedHooksOnly or a policy)')
  if (t === 'off-process') return out('', 1, 'claude plugin test: hooks modules are turned off in this process')
  const dir = rest[2] || process.cwd()
  if (!fs.existsSync(path.join(dir, 'hooks', 'hooks.json'))) return out('', 1, 'claude plugin test: ' + dir + ': no hooks module to load; there is no hooks/hooks.json naming one in "modules"')
  if (typeof t === 'object') return out(t.stdout || '', t.code ?? 0, t.stderr || '')
  const v = {
    pass: ['\ntests/a.test.ts:\n(pass) a > passes [1.00ms]\n(pass) a > also passes [1.00ms]\n\n 2 pass\n 0 fail\nRan 2 tests across 1 file. [0.10s]', 0],
    fail: ['\ntests/a.test.ts:\n(pass) passes [0.96ms]\n(fail) fails on purpose [0.23ms]\n  AssertionError: expect(received).toBe()\n\n 1 pass\n 1 fail\nRan 2 tests across 1 file. [0.24s]', 1],
    'no-test': ['\ntests/b.test.ts:\n(fail) the file did not load\n  it declares no test(): nothing ran\n\n 0 pass\n 1 fail\nRan 1 test across 1 file. [0.24s]', 1]
  }[t]
  return out(v[0], v[1])
}
if (a0 === 'plugin' && a1 === 'validate') {
  let dir = path.resolve(rest.slice(2).filter(x => !x.startsWith('--')).pop() || '.')
  if (dir.endsWith('plugin.json')) dir = path.dirname(path.dirname(dir))
  const v = (cfg.validate || {})[nameOf(dir)] || (cfg.validate || {}).default ||
    { success: true, strict: false, manifest: { type: 'plugin', errors: [], warnings: [], notes: [] }, contents: [] }
  const json = JSON.parse(JSON.stringify(v).split('<abs path>').join(dir))
  if (rest.includes('--json')) return out(JSON.stringify(json, null, 2), json.success ? 0 : 1)
  const notes = [json.manifest, ...(json.contents || [])].flatMap(p => (p && p.notes) || [])
  return out(notes.map(n => '  ❯ ' + n).join('\n') + (json.success ? '\n✔ Validation passed' : '\n✘ Validation failed'), json.success ? 0 : 1)
}
if (a0 === '-p') {
  const L = cfg.load || {}
  const lines = []
  for (const d of pluginDirs) {
    const name = nameOf(d)
    if (L.refuse) {
      lines.push('hooks module ' + name + '@inline not loaded: ' + L.refuse)
      process.stderr.write(name + ': hooks module not loaded: ' + L.refuse + '\n')
      continue
    }
    lines.push('hooks module ' + name + '@inline loaded (worker, environment 1, tier user); events: ' + (L.events || 'session.start'))
    const types = path.join(d, '.claude-plugin', 'types')
    for (const sub of ['claude-code', 'claude-code-tools', 'claude-code-mcp']) {
      const src = L.typesFrom && path.join(L.typesFrom, sub, 'index.d.ts')
      let text = src && fs.existsSync(src) ? fs.readFileSync(src, 'utf8') : '\n'
      if (sub === 'claude-code') text = '// Written by Claude Code ' + version + '.\n' + text.replace(/^\/\/ Written by Claude Code [^\n]*\n/, '')
      fs.mkdirSync(path.join(types, sub), { recursive: true })
      fs.writeFileSync(path.join(types, sub, 'index.d.ts'), text)
    }
    fs.writeFileSync(path.join(types, 'tsconfig.json'), '{ "compilerOptions": { "strict": true, "noEmit": true }, "include": ["../../hooks", "../../types", "../../tests"] }\n')
    fs.writeFileSync(path.join(types, '.gitignore'), '*\n')
    const wrote = ['claude-code', 'claude-code-tools', 'claude-code-mcp'].map(s => '.claude-plugin/types/' + s + '/index.d.ts')
    if (!fs.existsSync(path.join(d, 'tsconfig.json'))) {
      fs.writeFileSync(path.join(d, 'tsconfig.json'), '{ "extends": "./.claude-plugin/types/tsconfig.json" }\n')
      wrote.push('tsconfig.json')
    }
    lines.push('type root of ' + name + ' at ' + types + ': entries claude-code, claude-code-tools, claude-code-mcp; wrote ' + wrote.join(', '))
    for (const c of L.calls || []) lines.push(c + ' (' + name + '): stub')
    for (const t of L.uiLog || []) lines.push('[' + name + '] $.ui.log (to debug): ' + t)
    lines.push('hooks module ' + name + '@inline session.start settled in 1.2ms (worker hop, next() included)')
    for (const x of L.extraLog || []) lines.push(x.split('<name>').join(name))
  }
  if (debugFile) fs.writeFileSync(debugFile, lines.map(l => new Date().toISOString() + ' [DEBUG] ' + l).join('\n') + '\n')
  if (cfg.auth && cfg.auth.loggedIn) return out(L.reply || 'ok')
  return out('Not logged in · Please run /login', 1)
}
out('', 99, 'stub claude: unhandled args: ' + joined)
`

export function writeStubClaude(binDir, config = {}) {
  fs.mkdirSync(binDir, { recursive: true })
  const bin = path.join(binDir, 'claude')
  fs.writeFileSync(bin, STUB, { mode: 0o755 })
  fs.writeFileSync(path.join(binDir, 'stub.json'), JSON.stringify(config, null, 2))
  return bin
}

export function setStubConfig(binDir, config) {
  fs.writeFileSync(path.join(binDir, 'stub.json'), JSON.stringify(config, null, 2))
}

export function stubCalls(binDir) {
  const f = path.join(binDir, 'calls.jsonl')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
}

// A child env with the stub first on PATH and nothing from the session that runs the tests.
export function stubEnv(binDir, extra = {}) {
  const env = { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  delete env.CLAUDE_CODE_EXECPATH
  return { ...env, ...extra }
}

// PATH with no claude on it, for the "not found" cases.
export function bareEnv(extra = {}) {
  const env = { ...process.env, PATH: path.dirname(process.execPath) }
  delete env.CLAUDE_CODE_EXECPATH
  return { ...env, ...extra }
}

export function runScript(name, args = [], { env = process.env, cwd = SKILL_DIR, timeout = 180_000 } = {}) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, name), ...args], { env, cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

// ---------- declarations ----------

// The docs snapshot is one file: the claude-code module, then the tools module. It is
// not shipped with the skill; point MOD_BUILDER_SNAPSHOT at it, or drop it into
// tests/fixtures/. Tests that need it print a skip line without it.
export function snapshotPath() {
  for (const p of [process.env.MOD_BUILDER_SNAPSHOT, path.join(TESTS_DIR, 'fixtures', 'claude-code-2.1.287.d.ts')]) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

const TOOLS_HEADER = "// The inputs of the built-in tools this build has"

// Writes the snapshot as a load writes it: claude-code/index.d.ts and claude-code-tools/index.d.ts.
export function splitSnapshot(file, outDir) {
  const text = fs.readFileSync(file, 'utf8')
  const cut = text.indexOf(TOOLS_HEADER)
  if (cut < 0) throw new Error('snapshot has no tools section')
  writeFiles(outDir, {
    'claude-code/index.d.ts': text.slice(0, cut).replace(/\n+$/, '\n'),
    'claude-code-tools/index.d.ts': text.slice(cut)
  })
  return outDir
}

function editLines(file, fn) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  fs.writeFileSync(file, fn(lines).join('\n'))
}

export function copyTypes(srcDir, outDir) {
  fs.cpSync(srcDir, outDir, { recursive: true })
  return outDir
}

// The 2.1.288 delta applied to a 2.1.287 split: $.ui.selection and the ui.selection op event.
export function make288(typesDir, outDir) {
  copyTypes(typesDir, outDir)
  editLines(path.join(outDir, 'claude-code', 'index.d.ts'), lines => {
    lines[0] = '// Written by Claude Code 2.1.288.'
    const core = lines.findIndex(l => /^  export interface CoreEngineInterface \{/.test(l))
    const ui = lines.findIndex((l, i) => i > core && /^      ui: \{\s*$/.test(l))
    const uiEnd = lines.findIndex((l, i) => i > ui && /^      \};/.test(l))
    lines.splice(uiEnd, 0, '          selection: () => Promise<UiSelection | undefined>;')
    const op = lines.findIndex(l => /^  export type OpEventOf = \{/.test(l))
    lines.splice(op + 1, 0, "      'ui.selection': Record<never, never>;")
    return lines
  })
  return outDir
}

// Drops one `$.noun.method` line from CoreEngineInterface.
export function removeMethod(typesDir, noun, method) {
  editLines(path.join(typesDir, 'claude-code', 'index.d.ts'), lines => {
    const core = lines.findIndex(l => /^  export interface CoreEngineInterface \{/.test(l))
    const open = lines.findIndex((l, i) => i > core && new RegExp(`^      ${noun}: \\{\\s*$`).test(l))
    const at = lines.findIndex((l, i) => i > open && new RegExp(`^          ${method}\\??\\s*[:(<]`).test(l))
    if (at < 0) throw new Error(`no ${noun}.${method}`)
    lines.splice(at, 1)
    return lines
  })
  return typesDir
}

// Declarations shaped like the real ones, carrying exactly the names in an api map.
export function synthTypes(map, outDir, { version = map.version } = {}) {
  const q = s => `'${s}'`
  const main = [
    `// Written by Claude Code ${version}.`,
    "declare module 'claude-code' {",
    '  export interface BuiltinToolInputs {',
    '  }',
    '  export interface CoreEngineInterface {',
    ...Object.entries(map.methods).flatMap(([noun, list]) => [`      ${noun}: {`, ...list.map(m => `          ${m}: () => void;`), '      };']),
    '  }',
    '  export type Elements = {',
    ...Object.entries(map.elements).flatMap(([s, list]) => [`      ${s}: {`, ...list.map(e => `          ${e}: ElementConstructor<${e}Props>;`), '      };']),
    '  };',
    '  export type EngineEventOf = {',
    ...map.events.engine.map(e => `      ${q(e)}: unknown;`),
    '  };',
    '  export type HookBudget = {',
    ...Object.entries(map.budget).map(([k, v]) => `      readonly ${k}: ${v};`),
    '  };',
    ...map.events.classic.map((c, i) => `  type Classic${i}HookInput = BaseHookInput & {\n      hook_event_name: ${q(c.replace(/^classic\./, ''))};\n  };`),
    `  export type InvalidatableEventName = ${map.invalidatable.map(q).join(' | ')};`,
    '  export type Next<N extends EventName = EventName> = {',
    ...map.nextMembers.map(m => `      readonly ${m}: unknown;`),
    '  };',
    '  export type OpEventOf = {',
    ...map.events.op.map(e => `      ${q(e)}: unknown;`),
    '  };',
    `  export type RenderComponent = ${map.components.map(q).join(' | ')};`,
    `  export type RenderSurface = ${map.surfaces.map(q).join(' | ')};`,
    `  const TIERS: readonly [${map.tiers.map(t => `"${t}"`).join(', ')}];`,
    '}',
    ''
  ].join('\n')
  const tools = ["declare module 'claude-code' {", '  interface BuiltinToolInputs {', ...map.tools.map(t => /^\w+$/.test(t) ? `    ${t}: {}` : `    "${t}": {}`), '  }', '}', ''].join('\n')
  return writeFiles(outDir, { 'claude-code/index.d.ts': main, 'claude-code-tools/index.d.ts': tools })
}

export function withoutMethod(map, noun, method) {
  const copy = JSON.parse(JSON.stringify(map))
  copy.methods[noun] = copy.methods[noun].filter(m => m !== method)
  return copy
}

export function allMethodsBlock(map) {
  return ['```api-methods', ...methodNames(map), '```'].join('\n')
}

// ---------- mods ----------

export function writeProbeMod(dir) {
  return writeFiles(dir, {
    '.claude-plugin/plugin.json': { name: 'probe-mod', version: '0.0.1', description: '[probe] test probe', author: { name: 'test' } },
    'hooks/hooks.json': { modules: ['./register.ts'] },
    'hooks/register.ts': "import type { Register } from 'claude-code'\nexport const register: Register = on => {\n  on('session.start', ($, e, next) => next(e))\n}\n"
  })
}

export function probeModDir() {
  return fs.existsSync(path.join(PROBE_MOD, '.claude-plugin', 'plugin.json')) ? PROBE_MOD : writeProbeMod(path.join(tmpDir('mb-probe-'), 'probe-mod'))
}

// ---------- live ----------

// The real claude when one at or above the floor is on PATH, else null.
export function realClaude() {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: tmpDir('mb-cfg-') }
  delete env.CLAUDE_CODE_EXECPATH
  const c = findClaude(env)
  return c?.bin && c.version && cmpVersion(c.version, FLOOR) >= 0 ? c : null
}
