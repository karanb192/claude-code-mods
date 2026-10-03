#!/usr/bin/env node
// The isolated harness. Copies a mod into a run folder under the harness home, drives a child
// `claude` with its own config dir through the stages below, keeps one evidence file per stage,
// and prints the status block the skill pastes verbatim.
//
//   node prove.mjs <mod-dir> [--plan '<calls>'] [--env '<names>'] [--state '<keys>'] [--command <name>]
//                  [--interactive <script>] [--install] [--continue] [--json]
//
// Stages: validate, load, typecheck, test, command, interactive (only with --interactive),
// install-smoke (only with --install), isolation (always). The run stops at the first FAILED
// stage unless --continue; isolation runs either way.
// Exit 0 no stage FAILED; 1 a stage FAILED; 2 blocked (precondition or tooling error);
// 3 the same stage failed the same way three runs in a row for this mod path and source.
// MOD_BUILDER_HOME moves the harness home. MOD_BUILDER_REAL_HOME names the home whose
// .claude and .claude.json the isolation stage watches (default: your home; tests only).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { footprint, loadRules, parsePlan } from './footprint.mjs'
import {
  FLOOR, LOAD_TIMEOUT_MS, cmpVersion, findClaude, harnessHome, hashTree, isMain, matchLog,
  parseArgs, parseValidateJson, runClaude, slash, tildify, typesVersion, which
} from './lib.mjs'

// ---------- every text this script matches, and where it comes from ----------
// Debug-log line forms (loaded, notLoaded, didNotLoad, skipped, settled, call, uiLog, typeRoot,
// noCommandHook) are the LOG_PATTERNS table in lib.mjs, each labelled documented or observed.
export const PROVE_PATTERNS = {
  // observed on 2.1.288: a -p run with no login loads the mod first, then prints this and exits 1
  notLoggedIn: /Not logged in/,
  // observed on 2.1.288: `claude plugin test` summary lines and failing-test lines
  testPass: /^\s*(\d+) pass\s*$/m,
  testFail: /^\s*(\d+) fail\s*$/m,
  testFailLine: /^\(fail\) .*$/m,
  // observed on 2.1.288: `claude plugin test` when a setting or the process turns modules off
  turnedOff: /hooks modules are turned off[^\n]*/,
  // tsc with --pretty false
  tscError: /^.*error TS\d+:.*$/m
}

// First-run screens of an interactive session, matched on the captured pane text. `keys` is
// what answers it; none means the stage cannot go on and reads unverified with `why`.
export const FIRST_RUN = [
  // observed on 2.1.288, on screen, fresh config dir
  { id: 'theme', re: /Choose the text style that looks best with your terminal/, keys: ['Enter'] },
  // observed on 2.1.288, on screen, fresh config dir with no login
  { id: 'login', re: /Select login method:/, why: 'harness home not logged in' },
  // string in the 2.1.288 binary, not yet seen on screen here
  { id: 'apiKey', re: /Detected a custom API key in your environment|Do you want to use this API key\?/, why: 'an API key in the environment asks for approval; unset it or log in the harness home' },
  // observed on 2.1.288, on screen: the dialog highlights "No, exit" first, so Down then Enter picks "Yes, I trust this folder"
  { id: 'trust', re: /project you created or one you trust/i, keys: ['Down', 'Enter'] }
]
// string in the 2.1.288 binary, not yet seen on screen here: the footer of an idle prompt
export const READY = /\? for shortcuts/

// ---------- small helpers ----------

const IS_WIN = process.platform === 'win32'
const STAGES = ['validate', 'load', 'typecheck', 'test', 'command', 'interactive', 'install-smoke', 'isolation']
const EXCLUDE = ['.claude-plugin/types', 'node_modules', '.git']
const USAGE = "usage: node prove.mjs <mod-dir> [--plan '<calls>'] [--env '<names>'] [--state '<keys>'] [--command <name>] [--interactive <script>] [--install] [--continue] [--json]"

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const sha = s => createHash('sha256').update(s).digest('hex')
const readText = (f, enc = 'utf8') => { try { return fs.readFileSync(f, enc) } catch { return '' } }
const firstLine = s => (s || '').split('\n').map(l => l.trim()).find(Boolean) || ''
const clip = (s, n = 160) => (s.length > n ? s.slice(0, n - 3) + '...' : s)
const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const shq = s => (/^[\w@%+=:,./~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)
const mask = s => s.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[masked]')
const stripStamp = l => l.replace(/^\S+ \[[A-Z]+\] /, '').replace(/^\] /, '')

function stampNow(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const passed = (detail, extra = {}) => ({ status: 'passed', detail, ...extra })
const failed = (reason, detail, extra = {}) => ({ status: 'failed', reason: clip(reason.trim()), detail, ...extra })
const na = reason => ({ status: 'not applicable', reason })
const unverified = reason => ({ status: 'unverified', reason })

export function statusWord(r) {
  if (r.status === 'passed') return `ran and passed${r.counts ? ` (${r.counts})` : ''}`
  if (r.status === 'failed') return `ran and FAILED (${r.reason})`
  return `${r.status} (${r.reason})`
}

function stageLine(label, r) {
  const word = statusWord(r)
  return `${(label + ':').padEnd(15)}${word}${r.detail ? ' '.repeat(Math.max(3, 27 - word.length)) + r.detail : ''}`
}

function testFiles(dir) {
  const out = []
  const walk = rel => {
    for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (r === '.claude-plugin/types' || ent.name === 'node_modules' || ent.name === '.git') continue
      if (ent.isDirectory()) walk(r)
      else if (/\.test\.tsx?$/.test(ent.name)) out.push(r)
    }
  }
  walk('')
  return out
}

// ---------- the real config, watched by the isolation stage ----------

const encodeProject = p => p.replace(/[^a-zA-Z0-9]/g, '-')

function realSnapshot(realHome) {
  const stat = f => { try { return fs.statSync(f).mtimeMs } catch { return null } }
  const cfgFile = path.join(realHome, '.claude.json')
  let cfg = null
  for (let i = 0; i < 2 && !cfg; i++) {
    try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')) } catch (e) { if (e.code === 'ENOENT') break; sleep(200) }
  }
  let projects = []
  try { projects = fs.readdirSync(path.join(realHome, '.claude', 'projects')) } catch {}
  return {
    claudeJson: stat(cfgFile),
    settings: stat(path.join(realHome, '.claude', 'settings.json')),
    projectKeys: Object.keys(cfg?.projects || {}),
    pluginUsage: cfg?.pluginUsage || {},
    projects
  }
}

// ---------- interactive script ----------

export function parseScript(text, file = 'script') {
  const steps = []
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '')
    if (!line.trim() || line.trim().startsWith('#')) return
    const m = line.match(/^\s*(type|key|expect|wait|screen)(?:\s+(.*))?$/)
    const where = `${file}:${i + 1}`
    if (!m) throw new Error(`${where}: unknown line "${line.trim()}" (want type TEXT, key NAME, expect TEXT, wait MS or screen)`)
    const [, verb, arg = ''] = m
    if (['type', 'key', 'expect'].includes(verb) && !arg) throw new Error(`${where}: ${verb} needs a value`)
    if (verb === 'wait' && !/^\d+$/.test(arg.trim())) throw new Error(`${where}: wait needs milliseconds`)
    steps.push({ verb, arg: verb === 'wait' ? Number(arg.trim()) : arg })
  })
  return steps
}

// ---------- the run ----------

export function prove(argv, env = process.env) {
  const args = parseArgs(argv, { flags: ['install', 'continue', 'json', 'help'], values: ['plan', 'env', 'state', 'command', 'interactive'] })
  if (args.help) return { usage: true }
  if (args._.length !== 1) throw blocked(USAGE)
  const src = path.resolve(args._[0])
  const realHome = path.resolve(env.MOD_BUILDER_REAL_HOME || os.homedir())
  const before = realSnapshot(realHome)

  // Preconditions: each one exits 2 with its cause.
  let name
  try { name = JSON.parse(fs.readFileSync(path.join(src, '.claude-plugin', 'plugin.json'), 'utf8')).name } catch (e) {
    throw blocked(`no readable .claude-plugin/plugin.json under ${tildify(src)} (${e.code || e.message})`)
  }
  if (!name) throw blocked(`.claude-plugin/plugin.json under ${tildify(src)} has no name`)
  let home
  try { home = harnessHome(env) } catch (e) { throw blocked(e.message) }
  const childEnv = { ...env, CLAUDE_CONFIG_DIR: home.config }
  const claude = findClaude(childEnv)
  if (!claude?.bin) throw blocked('no claude binary on PATH; install Claude Code')
  if (!claude.version) throw blocked(`${claude.bin} --version printed no version`)
  if (cmpVersion(claude.version, FLOOR) < 0) throw blocked(`Claude Code ${claude.version} is below the floor ${FLOOR}; update Claude Code`)
  if (runClaude(claude.bin, ['plugin', 'test', '--help'], { env: childEnv, cwd: home.dir, timeoutMs: 30_000 }).code !== 0) {
    throw blocked(`claude plugin test --help did not exit 0 on ${claude.version}`)
  }
  const tscBin = which('tsc', env)
  const npx = tscBin ? null : which('npx', env)
  if (!tscBin && !npx) throw blocked('no TypeScript route: no tsc and no npx on PATH')
  const ts = tscBin ? { bin: tscBin, pre: [], label: 'tsc' } : { bin: npx, pre: ['-y', '-p', 'typescript', 'tsc'], label: 'npx -y -p typescript tsc' }
  let script = null
  if (args.interactive) {
    const file = path.resolve(args.interactive)
    let text
    try { text = fs.readFileSync(file, 'utf8') } catch (e) { throw blocked(`cannot read --interactive ${args.interactive} (${e.code || e.message})`) }
    try { script = parseScript(text, args.interactive) } catch (e) { throw blocked(e.message) }
    if (!IS_WIN && !which('tmux', env)) throw blocked('--interactive needs tmux, and tmux is not on PATH')
  }
  let plan, rules
  try { plan = parsePlan({ plan: args.plan, env: args.env, state: args.state }); rules = loadRules() } catch (e) { throw blocked(e.message) }

  // Run folder: a copy of the source, its hashes, and an evidence folder.
  const base = path.join(home.runs, `${stampNow()}-${name.replace(/[^A-Za-z0-9._-]/g, '-')}`)
  let run = base
  for (let i = 2; fs.existsSync(run); i++) run = `${base}-${i}`
  const mod = path.join(run, 'mod')
  const ev = path.join(run, 'evidence')
  fs.mkdirSync(ev, { recursive: true, mode: 0o700 })
  const sourceHashes = hashTree(src, { exclude: EXCLUDE })
  const sourceFull = hashTree(src, { exclude: ['node_modules', '.git'] })
  fs.writeFileSync(path.join(run, 'source.sha256'), sourceHashes.join('\n') + '\n')
  fs.cpSync(src, mod, {
    recursive: true,
    filter: s => {
      const rel = slash(path.relative(src, s))
      return !(rel === '.claude-plugin/types' || rel.startsWith('.claude-plugin/types/') || rel.split('/').some(p => p === 'node_modules' || p === '.git'))
    }
  })
  const sourceKey = sha(sourceHashes.join('\n'))
  const commands = []
  const child = (stage, a, { cwd = run, timeoutMs = 60_000 } = {}) => {
    const t0 = Date.now()
    const r = runClaude(claude.bin, a, { cwd, env: childEnv, timeoutMs })
    commands.push(`${stage}: claude ${a.map(x => shq(tildify(x))).join(' ')} (cwd ${tildify(cwd)}) exit ${r.timedOut ? 'timeout' : r.code} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
    return r
  }
  const sessionArgs = log => ['--plugin-dir', mod, '--debug-file', log, '--strict-mcp-config']
  const ctx = { name, src, run, mod, ev, home, claude, childEnv, ts, plan, rules, args, script, child, sessionArgs, commands }

  const results = {}
  let report = null
  let stopped = null
  for (const stage of STAGES.slice(0, -1)) {
    if (stopped && !args.continue && !(stage === 'interactive' && !script) && !(stage === 'install-smoke' && !args.install)) {
      results[stage] = unverified(`not run: ${stopped} FAILED; --continue runs the rest`)
      continue
    }
    const fn = { validate: stageValidate, load: stageLoad, typecheck: stageTypecheck, test: stageTest, command: stageCommand, interactive: stageInteractive, 'install-smoke': stageInstall }[stage]
    try {
      results[stage] = fn(ctx, report)
    } catch (e) {
      results[stage] = failed(`${stage} stage error: ${e.message}`)
    }
    if (stage === 'validate') report = results.validate.report || null
    if (results[stage].status === 'failed' && !stopped) stopped = stage
  }
  results.isolation = stageIsolation(ctx, { before, realHome, sourceHashes, sourceFull })

  // Block, strikes, run.json.
  const typesFile = path.join(mod, '.claude-plugin', 'types', 'claude-code', 'index.d.ts')
  const tv = typesVersion(readText(typesFile).split('\n', 1)[0])
  const via = claude.source === 'CLAUDE_CODE_EXECPATH' ? 'CLAUDE_CODE_EXECPATH' : 'PATH'
  const versionPart = tv
    ? `${tv} (types line 1; ${via} binary${tv !== claude.version ? ` ${claude.version}` : ''})`
    : `${claude.version} (claude --version, no types written; ${via} binary)`
  const ui = uiEvidence(report, results, ctx)
  const block = [
    `proof: ${name} on Claude Code ${versionPart}, run ${tildify(run)}`,
    ...STAGES.map(s => stageLine(s, results[s])),
    `${'ui evidence:'.padEnd(15)}${ui}`
  ].join('\n')

  const firstFail = STAGES.find(s => results[s].status === 'failed')
  const strike = recordStrike(home, `${src}#${sourceKey}`, src, firstFail ? `${firstFail}:${normalizeSig(results[firstFail].reason, run)}` : null)
  const exit = strike?.count >= 3 ? 3 : firstFail ? 1 : 0
  const strikeLine = exit === 3 ? `three strikes on ${firstFail}: stop and report` : null

  const loadLines = results.load.lines || []
  if (loadLines.length) fs.writeFileSync(path.join(ev, 'load-lines.txt'), loadLines.join('\n') + '\n')
  fs.writeFileSync(path.join(ev, 'commands.txt'), commands.join('\n') + '\n')
  fs.writeFileSync(path.join(run, 'status.txt'), block + '\n')
  const json = {
    name, mod: src, run, startedAt: path.basename(run).slice(0, 15),
    claude: { bin: claude.bin, version: claude.version, source: claude.source }, typesVersion: tv,
    stages: Object.fromEntries(STAGES.map(s => {
      const { report: _r, lines: _l, ...rest } = results[s]
      return [s, { ...rest, word: statusWord(results[s]) }]
    })),
    uiEvidence: ui, footprint: report ? { hooks: report.hooks, calls: report.calls } : null, tmuxSocket: ctx.tmuxSocket || null,
    strikes: strike, exit, strikeLine, block, loadLines
  }
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify(json, null, 2) + '\n')
  return json
}

function blocked(msg) { const e = new Error(msg); e.blocked = true; return e }

function normalizeSig(reason, run) {
  return reason.split(run).join('<run>').replace(/\[[\d.]+m?s\]/g, '').replace(/\s+/g, ' ').trim()
}

function recordStrike(home, key, src, signature) {
  let all = {}
  try { all = JSON.parse(fs.readFileSync(home.strikes, 'utf8')) } catch {}
  // A changed source starts a new count, so older entries for this path are dropped.
  for (const k of Object.keys(all)) if (k !== key && all[k]?.mod === src) delete all[k]
  if (!signature) {
    delete all[key]
    fs.writeFileSync(home.strikes, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 })
    return null
  }
  const prev = all[key]
  const count = prev?.signature === signature ? prev.count + 1 : 1
  all[key] = { mod: src, signature, count, at: new Date().toISOString() }
  fs.writeFileSync(home.strikes, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 })
  return all[key]
}

// ---------- stages ----------

function stageValidate(ctx) {
  const { mod, ev, child, plan, rules } = ctx
  const r = child('validate', ['plugin', 'validate', '--strict', '--json', mod], { timeoutMs: 60_000 })
  fs.writeFileSync(path.join(ev, 'validate.json'), r.stdout)
  let raw
  try { raw = JSON.parse(r.stdout) } catch {
    return failed(`claude plugin validate printed no JSON (exit ${r.code}): ${firstLine(r.stderr || r.stdout)}`, 'evidence/validate.json')
  }
  const parsed = parseValidateJson(raw)
  // footprint() reads every matcher as an object; a hook with no matcher must arrive as {}.
  const report = { ...parsed, hooks: parsed.hooks.map(h => ({ ...h, matcher: h.matcher || {} })) }
  const out = footprint(report, { plan, rules })
  fs.writeFileSync(path.join(ev, 'footprint.txt'), out.lines.join('\n') + '\n')
  if (!report.success) {
    const e = report.errors[0]
    return failed(e ? `${e.path ? e.path + ': ' : ''}${e.message}` : `validate failed (exit ${r.code})`, 'evidence/validate.json, evidence/footprint.txt', { report })
  }
  const bad = out.lines.find(l => /^(WIDER THAN PLAN|env outside plan|state outside plan|ungraded):/.test(l))
  if (bad) return failed(bad, 'evidence/footprint.txt', { report })
  const reach = `reach L${out.reach.level} ${out.reach.name}${out.reach.labels.length ? ` (${out.reach.labels.join(', ')})` : ''}`
  let detail
  if (!plan) detail = `evidence/validate.json; no plan given; ${reach}`
  else if (out.diff.match) detail = 'evidence/validate.json; plan and footprint match'
  else detail = `evidence/validate.json; planned but unused: ${out.diff.unused.join(', ')}`
  return passed(detail, { report })
}

// The checks a load log must pass for one plugin id; shared by load and install-smoke.
function checkLoaded(text, err, name, prov) {
  const mine = m => m[1] === name && m[2] === prov
  const loaded = matchLog(text, 'loaded').find(mine)
  const refused = matchLog(text, 'notLoaded').find(mine)
  const didNot = matchLog(text, 'didNotLoad').find(m => m[1] === name)
  const skipped = matchLog(text, 'skipped').find(m => m[1] === name)
  const stderrRefusal = err.split('\n').find(l => l.startsWith(`${name}: hooks module not loaded`) || l.startsWith(`${name}: hooks module did not load`))
  const problem = refused || didNot || skipped
  if (problem) return { ok: false, why: stripStamp(problem[0]) }
  if (stderrRefusal) return { ok: false, why: stderrRefusal.trim() }
  if (!loaded) return { ok: false, why: null }
  return { ok: true, loaded, events: loaded[4].split(',').map(s => s.trim()).filter(Boolean) }
}

function stageLoad(ctx) {
  const { name, ev, child, sessionArgs } = ctx
  const log = path.join(ev, 'load.log')
  const r = child('load', ['-p', 'ok', ...sessionArgs(log)], { timeoutMs: LOAD_TIMEOUT_MS })
  fs.writeFileSync(path.join(ev, 'load.out'), r.stdout)
  fs.writeFileSync(path.join(ev, 'load.err'), r.stderr)
  const text = readText(log)
  const lines = []
  const keep = (key, pick) => { for (const m of matchLog(text, key).filter(pick)) lines.push(stripStamp(m[0])) }
  keep('loaded', m => m[1] === name)
  keep('typeRoot', m => m[1] === name)
  keep('settled', m => m[1] === name)
  keep('call', m => m[2] === name)
  keep('uiLog', m => m[1] === name)
  const c = checkLoaded(text, r.stderr, name, 'inline')
  if (!c.ok) {
    const why = c.why || `no "hooks module ${name}@inline loaded" line in the log; ${r.timedOut ? `timed out after ${LOAD_TIMEOUT_MS / 1000} s` : `exit ${r.code}`}${firstLine(r.stdout + '\n' + r.stderr) ? ': ' + firstLine(r.stdout + '\n' + r.stderr) : ''}`
    return failed(why, 'evidence/load.log', { lines })
  }
  const login = PROVE_PATTERNS.notLoggedIn.test(r.stdout) ? 'none' : 'yes'
  return passed(`evidence/load.log: hooks module ${name}@inline loaded; events: ${c.events.join(', ')}`, { lines, login })
}

function stageTypecheck(ctx) {
  const { mod, ev, ts } = ctx
  const generated = path.join(mod, '.claude-plugin', 'types', 'tsconfig.json')
  if (!fs.existsSync(generated)) return unverified('the load wrote no .claude-plugin/types into the copy')
  const own = path.join(mod, 'tsconfig.json')
  let project = 'tsconfig.json'
  let note = ''
  const extendsGenerated = f => /"extends"\s*:\s*(?:\[[^\]]*)?"(?:\.\/)?\.claude-plugin\/types\/tsconfig\.json"/.test(readText(f))
  if (!fs.existsSync(own) || !extendsGenerated(own)) {
    fs.writeFileSync(path.join(ev, 'tsconfig.json'), JSON.stringify({ extends: '../mod/.claude-plugin/types/tsconfig.json' }, null, 2) + '\n')
    project = path.join('..', 'evidence', 'tsconfig.json')
    note = fs.existsSync(own)
      ? '; the mod\'s tsconfig.json does not extend ./.claude-plugin/types/tsconfig.json, checked with evidence/tsconfig.json'
      : '; no tsconfig.json, checked with evidence/tsconfig.json'
    process.stderr.write(`prove: warning${note.replace(/^;/, ':')}\n`)
  }
  const ver = runClaude(ts.bin, [...ts.pre, '--version'], { cwd: mod, timeoutMs: 300_000 }).stdout.match(/(\d+\.\d+\.\d+)/)?.[1]
  const t0 = Date.now()
  const r = runClaude(ts.bin, [...ts.pre, '-p', project, '--pretty', 'false'], { cwd: mod, timeoutMs: 300_000 })
  ctx.commands.push(`typecheck: ${ts.label} -p ${slash(project)} --pretty false (cwd ${tildify(mod)}) exit ${r.timedOut ? 'timeout' : r.code} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  const output = r.stdout + r.stderr
  fs.writeFileSync(path.join(ev, 'tsc.txt'), output)
  const detail = `evidence/tsc.txt (${ts.label === 'tsc' ? 'tsc' : ts.label}${ver ? ' ' + ver : ''})${note}`
  if (r.code === 0) return passed(detail)
  return failed(output.match(PROVE_PATTERNS.tscError)?.[0] || firstLine(output) || `tsc exit ${r.timedOut ? 'timeout' : r.code}`, detail)
}

function stageTest(ctx) {
  const { mod, ev, child } = ctx
  if (!testFiles(mod).length) return na('no test files')
  const r = child('test', ['plugin', 'test', mod], { timeoutMs: 300_000 })
  const output = r.stdout + r.stderr
  fs.writeFileSync(path.join(ev, 'test.txt'), output)
  const off = output.match(PROVE_PATTERNS.turnedOff)
  if (off) return unverified(off[0])
  const pass = Number(output.match(PROVE_PATTERNS.testPass)?.[1] ?? 0)
  const fail = Number(output.match(PROVE_PATTERNS.testFail)?.[1] ?? 0)
  const counts = `${pass} pass, ${fail} fail`
  if (r.code === 0 && pass >= 1) return passed('evidence/test.txt', { counts })
  const why = output.match(PROVE_PATTERNS.testFailLine)?.[0] || (pass === 0 && r.code === 0 ? '0 pass: no test ran' : firstLine(output) || `exit ${r.code}`)
  return failed(`${counts}; ${why}`, 'evidence/test.txt')
}

function commandName(ctx, report) {
  if (ctx.args.command) return ctx.args.command.replace(/^\//, '')
  for (const h of report?.hooks || []) {
    if (h.event !== 'command.run' || !h.matcher?.command) continue
    const c = [h.matcher.command].flat()[0]
    if (typeof c === 'string' && !c.startsWith('/"')) return c
  }
  return null
}

function stageCommand(ctx, report) {
  const { name, ev, child, sessionArgs, home } = ctx
  const cmd = commandName(ctx, report)
  if (!cmd) return na('no command.run hook')
  const log = path.join(ev, 'command.log')
  const r = child('command', ['-p', `/${cmd}`, ...sessionArgs(log)], { timeoutMs: LOAD_TIMEOUT_MS })
  fs.writeFileSync(path.join(ev, 'command.out'), r.stdout)
  fs.writeFileSync(path.join(ev, 'command.err'), r.stderr)
  if (PROVE_PATTERNS.notLoggedIn.test(r.stdout)) {
    return unverified(`harness home not logged in: run CLAUDE_CONFIG_DIR=${tildify(home.config)} claude auth login once`)
  }
  const text = readText(log)
  const settled = matchLog(text, 'settled').some(m => m[1] === name && m[2] === 'inline' && m[3] === 'command.run')
  const unanswered = matchLog(text, 'noCommandHook').find(m => m[1] === name)
  if (unanswered) return failed(stripStamp(unanswered[0]), 'evidence/command.out, evidence/command.log')
  if (r.code !== 0) return failed(`exit ${r.timedOut ? 'timeout' : r.code}: ${firstLine(r.stdout + '\n' + r.stderr)}`, 'evidence/command.out, evidence/command.log')
  if (!settled) return failed(`no "hooks module ${name}@inline command.run settled" line in the log`, 'evidence/command.out, evidence/command.log')
  return passed(`evidence/command.out: "${clip(firstLine(r.stdout), 80)}"; command.log: ${name}@inline command.run settled`)
}

function loggedIn(ctx) {
  const r = runClaude(ctx.claude.bin, ['auth', 'status'], { cwd: ctx.run, env: ctx.childEnv, timeoutMs: 30_000 })
  try { return JSON.parse(r.stdout).loggedIn === true } catch { return r.code === 0 && !/not logged in/i.test(r.stdout + r.stderr) }
}

// A pane or band (a ui.render hook, or a $.ui.open call) needs the interactive stage to be done.
function stageInteractive(ctx, report) {
  const { name, run, ev, claude, home, script } = ctx
  if (!script) {
    if (!report) return unverified('validate gave no footprint; no --interactive script was run')
    if (report.hooks.some(h => h.event === 'ui.render') || report.calls.includes('$.ui.open')) return unverified('the mod draws; no --interactive script was run')
    return na(report.calls.some(c => DRAW_CALLS.includes(c)) ? 'no ui.render hook or $.ui.open call' : 'draws nothing')
  }
  if (IS_WIN) return unverified('the interactive stage does not run on Windows')
  if (!loggedIn(ctx)) return unverified('harness home not logged in')
  const sock = `mod-builder-${process.pid}`
  ctx.tmuxSocket = sock
  const tmux = (...a) => spawnSync('tmux', ['-L', sock, '-f', '/dev/null', ...a], { encoding: 'utf8' })
  const kill = () => { try { spawnSync('tmux', ['-L', sock, 'kill-server'], { stdio: 'ignore' }) } catch {} }
  const onSignal = () => { kill(); process.exit(130) }
  process.on('exit', kill)
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  const log = path.join(ev, 'interactive.log')
  const stream = path.join(ev, 'stream.raw')
  let n = 0
  const capture = () => mask(tmux('capture-pane', '-p', '-t', 'proof').stdout || '')
  const saveScreen = () => {
    const id = String(++n).padStart(2, '0')
    fs.writeFileSync(path.join(ev, `screen-${id}.txt`), capture())
    fs.writeFileSync(path.join(ev, `screen-${id}.ansi`), mask(tmux('capture-pane', '-e', '-p', '-t', 'proof').stdout || ''))
    return `screen-${id}.txt`
  }
  const dead = () => tmux('display-message', '-p', '-t', 'proof', '#{pane_dead}').stdout.trim() === '1'
  const loadedLine = () => matchLog(readText(log), 'loaded').some(m => m[1] === name && m[2] === 'inline')
  const send = (...keys) => tmux('send-keys', '-t', 'proof', ...keys)
  try {
    const go = path.join(ev, '.go')
    const cmd = ['env', '-u', 'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS', `CLAUDE_CONFIG_DIR=${home.config}`, claude.bin, ...ctx.sessionArgs(log)].map(shq).join(' ')
    const started = tmux('new-session', '-d', '-s', 'proof', '-x', '200', '-y', '50', '-c', run, `while [ ! -f ${shq(go)} ]; do sleep 0.1; done; exec ${cmd}`)
    if (started.status !== 0) return failed(`tmux new-session: ${firstLine(started.stderr)}`, 'evidence/')
    tmux('set-option', '-t', 'proof', 'remain-on-exit', 'on')
    tmux('pipe-pane', '-o', '-t', 'proof', `cat >> ${shq(stream)}`)
    fs.writeFileSync(go, '')
    ctx.commands.push(`interactive: tmux -L ${sock} new-session -x 200 -y 50 -c ${tildify(run)}: claude ${ctx.sessionArgs(log).map(x => shq(tildify(x))).join(' ')}`)

    const answered = {}
    let ready = false, quiet = 0
    for (const end = Date.now() + 60_000; Date.now() < end;) {
      const screen = capture()
      const hit = FIRST_RUN.find(p => p.re.test(screen))
      if (hit) {
        quiet = 0
        if (!hit.keys) { saveScreen(); return unverified(hit.why) }
        if ((answered[hit.id] = (answered[hit.id] || 0) + 1) > 5) return failed(`first-run screen "${hit.id}" did not go away (${saveScreen()})`, 'evidence/interactive.log')
        send(...hit.keys)
        sleep(1000)
        continue
      }
      if (READY.test(screen) || (++quiet >= 6 && loadedLine())) { ready = true; break }
      if (dead()) return failed(`claude exited before the prompt drew (${saveScreen()})`, 'evidence/stream.raw')
      sleep(500)
    }
    if (!ready) return failed(`no prompt within 60 s (${saveScreen()})`, 'evidence/stream.raw')
    for (let i = 0; i < 10 && !loadedLine(); i++) sleep(500)
    if (!loadedLine()) return failed(`no "hooks module ${name}@inline loaded" line within 5 s of the prompt (${saveScreen()})`, 'evidence/interactive.log')

    let expects = 0
    for (const step of script) {
      if (step.verb === 'type') {
        // Text, then Escape, then Enter: Escape closes the suggestion list that Enter would otherwise
        // run in place of what was typed. A leading Escape would close a closeOnEscape pane instead.
        send('-l', step.arg); sleep(150); send('Escape'); sleep(150); send('Enter'); sleep(300)
      } else if (step.verb === 'key') {
        send(step.arg); sleep(300)
      } else if (step.verb === 'wait') {
        sleep(Math.min(step.arg, 120_000))
      } else if (step.verb === 'screen') {
        saveScreen()
      } else {
        let seen = false
        for (const end = Date.now() + 20_000; Date.now() < end && !seen;) { seen = capture().includes(step.arg); if (!seen) sleep(250) }
        if (!seen) return failed(`expect "${clip(step.arg, 60)}" not seen in 20 s (${saveScreen()})`, 'evidence/stream.raw')
        expects++
      }
    }
    const last = saveScreen()
    send('-l', '/exit'); sleep(150); send('Escape'); sleep(150); send('Enter')
    for (let i = 0; i < 20 && !dead(); i++) sleep(250)
    ctx.lastScreen = last
    return passed(`evidence/interactive.log, evidence/${last} (${expects} expect${expects === 1 ? '' : 's'} matched)`)
  } finally {
    kill()
    process.off('exit', kill)
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    for (const f of [stream, log]) if (fs.existsSync(f)) fs.writeFileSync(f, mask(fs.readFileSync(f, 'latin1')), 'latin1')
    fs.rmSync(path.join(ev, '.go'), { force: true })
  }
}

function stageInstall(ctx) {
  const { name, run, mod, ev, child } = ctx
  if (!ctx.args.install) return na('not requested')
  const mkt = `mod-builder-smoke-${path.basename(run).slice(0, 15).replace('-', '')}`
  ctx.marketplace = mkt
  const dir = path.join(run, 'marketplace')
  fs.cpSync(mod, path.join(dir, 'plugins', name), { recursive: true, filter: s => !slash(path.relative(mod, s)).startsWith('.claude-plugin/types') })
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'), JSON.stringify({
    name: mkt, owner: { name: 'mod-builder' }, plugins: [{ name, source: `./plugins/${name}`, description: 'mod-builder install-smoke copy' }]
  }, null, 2) + '\n')
  const setup = []
  const note = (label, r) => setup.push(`$ claude ${label} (exit ${r.timedOut ? 'timeout' : r.code})`, (r.stdout + r.stderr).trim(), '')
  const id = `${name}@${mkt}`
  try {
    const add = child('install-smoke', ['plugin', 'marketplace', 'add', dir], { timeoutMs: 120_000 })
    note(`plugin marketplace add ${tildify(dir)}`, add)
    if (add.code !== 0) return failed(`marketplace add: ${firstLine(add.stdout + '\n' + add.stderr) || `exit ${add.code}`}`, 'evidence/install-setup.txt')
    const inst = child('install-smoke', ['plugin', 'install', id, '--scope', 'user'], { timeoutMs: 120_000 })
    note(`plugin install ${id} --scope user`, inst)
    if (inst.code !== 0) return failed(`install: ${firstLine(inst.stdout + '\n' + inst.stderr) || `exit ${inst.code}`}`, 'evidence/install-setup.txt')
    const log = path.join(ev, 'install.log')
    const r = child('install-smoke', ['-p', 'ok', '--debug-file', log, '--strict-mcp-config'], { timeoutMs: LOAD_TIMEOUT_MS })
    fs.writeFileSync(path.join(ev, 'install.out'), r.stdout)
    fs.writeFileSync(path.join(ev, 'install.err'), r.stderr)
    const c = checkLoaded(readText(log), r.stderr, name, mkt)
    if (!c.ok) return failed(c.why || `no "hooks module ${id} loaded" line in the log; exit ${r.timedOut ? 'timeout' : r.code}`, 'evidence/install.log')
    return passed(`evidence/install.log: hooks module ${id} loaded; events: ${c.events.join(', ')}`)
  } finally {
    note(`plugin uninstall ${id} --scope user`, child('install-smoke', ['plugin', 'uninstall', id, '--scope', 'user'], { timeoutMs: 120_000 }))
    note(`plugin marketplace remove ${mkt}`, child('install-smoke', ['plugin', 'marketplace', 'remove', mkt], { timeoutMs: 120_000 }))
    fs.writeFileSync(path.join(ev, 'install-setup.txt'), setup.join('\n'))
  }
}

function stageIsolation(ctx, { before, realHome, sourceHashes, sourceFull }) {
  const { name, src, run, ev, home } = ctx
  const problems = []
  const notes = []
  const realRe = new RegExp(`(?:${reEscape(slash(realHome))}|~)/\\.claude(?:\\.json|/|(?![\\w.-]))`)
  for (const f of fs.readdirSync(ev).sort()) {
    const p = path.join(ev, f)
    if (!fs.lstatSync(p).isFile() || f === 'isolation.txt' || /\.ansi$/.test(f)) continue
    const lines = readText(p).split('\n')
    const at = lines.findIndex(l => realRe.test(l))
    if (at >= 0) { problems.push(`evidence/${f}:${at + 1} names the real config: ${clip(stripStamp(lines[at].trim()), 120)}`); continue }
  }
  const allowed = new Set(['inline', 'builtin', ctx.marketplace].filter(Boolean))
  for (const f of ['load.log', 'command.log', 'interactive.log', 'install.log']) {
    for (const m of matchLog(readText(path.join(ev, f)), 'loaded')) {
      if (!allowed.has(m[2])) problems.push(`evidence/${f} loaded ${m[1]}@${m[2]}, not from --plugin-dir, built in, or the temp marketplace`)
    }
  }
  const after = realSnapshot(realHome)
  const ours = [run, home.dir].flatMap(p => { let r = p; try { r = fs.realpathSync(p) } catch {} return [...new Set([p, r])] })
  if (after.settings !== before.settings) problems.push(`${tildify(path.join(realHome, '.claude', 'settings.json'))} changed during the run`)
  if (after.claudeJson !== before.claudeJson) {
    const newKeys = after.projectKeys.filter(k => !before.projectKeys.includes(k) && ours.some(o => k === o || k.startsWith(o + path.sep)))
    const usage = [`${name}@inline`, ctx.marketplace && `${name}@${ctx.marketplace}`].filter(Boolean)
      .filter(id => JSON.stringify(after.pluginUsage[id]) !== JSON.stringify(before.pluginUsage[id]))
    if (newKeys.length || usage.length) problems.push(`${tildify(path.join(realHome, '.claude.json'))} gained ${[...newKeys, ...usage].join(', ')}`)
    else notes.push(`${tildify(path.join(realHome, '.claude.json'))} changed during the run with no entry for this run or this mod (another session wrote it)`)
  }
  const gained = after.projects.filter(p => !before.projects.includes(p))
  const mine = gained.filter(p => ours.some(o => p.startsWith(encodeProject(o))))
  if (mine.length) problems.push(`${tildify(path.join(realHome, '.claude', 'projects'))} gained ${mine.join(', ')}`)
  if (gained.length > mine.length) notes.push(`~/.claude/projects gained ${gained.length - mine.length} entr${gained.length - mine.length === 1 ? 'y' : 'ies'} for other folders (another session)`)
  let now = []
  try { now = hashTree(src, { exclude: EXCLUDE }) } catch (e) { problems.push(`source tree unreadable after the run: ${e.message}`) }
  if (now.join('\n') !== readText(path.join(run, 'source.sha256')).trimEnd()) problems.push('source tree hashes differ from source.sha256')
  else if (hashTree(src, { exclude: ['node_modules', '.git'] }).join('\n') !== sourceFull.join('\n')) problems.push('the source gained or changed files under .claude-plugin/types (the engine wrote into the source)')
  fs.writeFileSync(path.join(ev, 'isolation.txt'), [
    `real home watched: ${tildify(realHome)}`,
    `~/.claude.json mtime: ${before.claudeJson ?? 'absent'} -> ${after.claudeJson ?? 'absent'}`,
    `~/.claude/settings.json mtime: ${before.settings ?? 'absent'} -> ${after.settings ?? 'absent'}`,
    `~/.claude/projects entries: ${before.projects.length} -> ${after.projects.length}`,
    `source files hashed: ${sourceHashes.length}`,
    ...problems.map(p => `FAIL ${p}`),
    ...notes.map(n => `note ${n}`),
    problems.length ? '' : 'pass: source unchanged, no real config touched'
  ].join('\n') + '\n')
  if (problems.length) return failed(problems[0], 'evidence/isolation.txt')
  return passed('source unchanged, no real config touched')
}

// ---------- ui evidence ----------

const DRAW_CALLS = ['$.ui.open', '$.ui.toast', '$.ui.notice', '$.ui.blit', '$.ui.ask', '$.ui.status', '$.ui.invalidate']

function uiEvidence(report, results, ctx) {
  if (!report) return 'unverified (validate gave no footprint)'
  const renders = report.hooks.some(h => h.event === 'ui.render')
  const draws = report.calls.filter(c => DRAW_CALLS.includes(c))
  if (!renders && !draws.length) return 'not applicable'
  if (results.interactive.status === 'passed') return `drawn and driven (${ctx.lastScreen})`
  if (!renders && draws.every(c => c === '$.ui.status')) {
    const statusLine = (results.load.lines || []).some(l => l.startsWith(`$.ui.status (${ctx.name})`))
    if (statusLine) return 'status line only'
  }
  if (results.interactive.status === 'not applicable') return 'unverified (the mod draws; no --interactive script was run)'
  return results.interactive.status === 'failed' ? 'unverified (interactive FAILED)' : `unverified (${results.interactive.reason})`
}

// ---------- entry ----------

if (isMain(import.meta)) {
  const json = process.argv.includes('--json')
  let out
  try {
    out = prove(process.argv.slice(2))
  } catch (e) {
    const msg = e.blocked ? e.message : `tooling error: ${e.message}`
    if (json) console.log(JSON.stringify({ error: msg, exit: 2 }, null, 2))
    else console.error(`prove: ${msg}`)
    process.exitCode = 2
  }
  if (out?.usage) console.log(USAGE)
  else if (out) {
    if (json) console.log(JSON.stringify(out, null, 2))
    else {
      const extra = out.loadLines.length ? `\n\nload lines (evidence/load-lines.txt):\n${out.loadLines.map(l => '  ' + l).join('\n')}` : ''
      console.log(out.block + (out.strikeLine ? `\n${out.strikeLine}` : '') + extra)
    }
    process.exitCode = out.exit
  }
}
