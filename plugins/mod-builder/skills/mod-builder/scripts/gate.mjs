#!/usr/bin/env node
// Step 0: checks this machine can build and prove a mod, finds this build's types,
// and diffs them against the skill's baseline and references. Prints the block the
// skill pastes verbatim when any line is not ok.
//
// usage: node gate.mjs [mod-dir] [--types <path>] [--json]
//
// Exit 0 proceed, 1 proceed with references partly stale, 2 stop.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULTS, runApiCheck } from './api-check.mjs'
import {
  FLOOR, SKILL_DIR, cmpVersion, findClaude, harnessHome, isMain, locateTypes, parseArgs, runClaude, slash, tildify, which
} from './lib.mjs'

const USAGE = 'usage: node gate.mjs [mod-dir] [--types <path>] [--json]'
const LABEL_WIDTH = 13

function list(names, max = 6) {
  return names.length > max ? `${names.slice(0, max).join(', ')}, and ${names.length - max} more` : names.join(', ')
}

function claudeLine(c) {
  const where = `${c.source} ${c.bin}`
  const extra = []
  if (c.pathBin) extra.push(`PATH ${c.pathBin} is ${c.pathVersion || 'unknown'}`)
  if (c.ignoredExecPath) extra.push(`CLAUDE_CODE_EXECPATH ${c.ignoredExecPath} is not executable, ignored`)
  const floor = cmpVersion(c.version, FLOOR) >= 0 ? `floor ${FLOOR} met` : `below floor ${FLOOR}`
  return `${c.version} (${where}${extra.length ? '; ' + extra.join('; ') : ''}); ${floor}`
}

function modsLoad(claude) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-builder-gate-'))
  try {
    const r = runClaude(claude.bin, ['plugin', 'test', tmp], { cwd: tmp, timeoutMs: 60_000 })
    const text = `${r.stdout}\n${r.stderr}`
    if (/no hooks module to load/.test(text)) return { line: 'yes (claude plugin test: no hooks module to load)' }
    const here = text.match(/hooks modules are turned off here(?: \(([^)]*)\))?/)
    if (here) return { line: `no, turned off here (${here[1] || 'a setting or policy'})`, stop: `mods are turned off here (${here[1] || 'a setting or policy'}); remove the setting or ask the admin` }
    if (/hooks modules are turned off (?:for installed plugins )?in this process/.test(text)) {
      return { line: 'no, turned off in this process', stop: 'mods are turned off in this process; no setting on this machine turns them back on' }
    }
    const first = text.trim().split('\n')[0] || `exit ${r.code}, no output`
    return { line: `unknown (claude plugin test printed: ${first})` }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

function driftLine(res) {
  const groups = new Map()
  for (const d of res.drift.filter(d => d.sign === '+')) {
    if (!groups.has(d.family)) groups.set(d.family, [])
    groups.get(d.family).push(d.name)
  }
  const removed = res.drift.filter(d => d.sign === '-').map(d => d.name)
  if (!groups.size && !removed.length && !res.shapeDrift.length) return 'none'
  const parts = [...groups].map(([fam, names]) => `+${names.length} ${fam}${names.length === 1 ? '' : 's'} (${list(names)})`)
  parts.push(removed.length ? `${removed.length} removed (${list(removed)})` : '0 removed')
  parts.push(`${res.shapeDrift.length} shape drift${res.shapeDrift.length ? ` (${list(res.shapeDrift.map(s => s.id))})` : ''}`)
  return parts.join(', ')
}

function referencesLine(res) {
  if (!res.refs.found) return `none at ${slash(path.relative(SKILL_DIR, res.refs.dir)) || '.'}/ (0 stale reported; nothing to check)`
  if (res.stale.length || res.shapeDrift.length) {
    const bits = []
    if (res.stale.length) bits.push(`${res.stale.length} stale: ${list(res.stale.map(s => s.name))}`)
    if (res.shapeDrift.length) bits.push(`${res.shapeDrift.length} shape drift: ${list(res.shapeDrift.map(s => s.id))}`)
    return `partly stale (${bits.join('; ')})`
  }
  return `usable (0 stale, ${res.uncovered.length} uncovered)`
}

function typescriptLine() {
  const tsc = which('tsc')
  if (tsc) {
    const r = runClaude(tsc, ['--version'], { timeoutMs: 30_000 })
    const v = r.stdout.match(/(\d+\.\d+\.\d+)/)?.[1]
    return `tsc ${v || 'unknown version'} (${tsc})`
  }
  if (which('npx')) return 'npx -y -p typescript tsc (no tsc on PATH; the first typecheck downloads TypeScript)'
  return 'none (no tsc and no npx; the typecheck stage will read unverified)'
}

function loginState(claude, home) {
  const r = runClaude(claude.bin, ['auth', 'status'], { cwd: home.dir, env: { ...process.env, CLAUDE_CONFIG_DIR: home.config }, timeoutMs: 30_000 })
  try { return JSON.parse(r.stdout).loggedIn === true } catch { return r.code === 0 && !/not logged in/i.test(r.stdout + r.stderr) }
}

function modName(modDir) {
  try { return JSON.parse(fs.readFileSync(path.join(modDir, '.claude-plugin', 'plugin.json'), 'utf8')).name || null } catch { return null }
}

function clashLine(claude, name) {
  // The user's own config on purpose: the clash is with what they installed.
  const r = runClaude(claude.bin, ['plugin', 'list', '--json'], { timeoutMs: 60_000 })
  let installed
  try { installed = JSON.parse(r.stdout) } catch { return `unknown (claude plugin list --json printed no JSON)` }
  const hits = installed.filter(p => String(p.id || p.name || '').split('@')[0] === name)
  if (!hits.length) return `none (no installed plugin named ${name})`
  const ids = hits.map(p => `${p.id}${p.enabled === false ? ' (disabled)' : ''}`).join(', ')
  return `${ids} installed; --plugin-dir and the installed copy conflict: ask which one to test against`
}

function detailsLine(claude, home, modDir, name) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: home.config }
  if (runClaude(claude.bin, ['plugin', 'details', '--help'], { env, timeoutMs: 30_000 }).code !== 0) return null
  const r = runClaude(claude.bin, ['--plugin-dir', path.resolve(modDir), 'plugin', 'details', name], { cwd: home.dir, env, timeoutMs: 60_000 })
  const cost = r.stdout.match(/Always-on:\s+(.+?)\s*$/m)?.[1]
  if (r.code !== 0 || !cost) return null
  return `${r.stdout.trim().split('\n')[0]}; always-on ${cost.replace(/\s{2,}/g, ' ')} (claude plugin details)`
}

export function runGate({ modDir, types } = {}) {
  const lines = []
  const stops = []
  const add = (key, value) => lines.push([key, value])
  const out = { lines, claude: null, types: null, apiCheck: null }

  const claude = findClaude()
  out.claude = claude
  const usable = claude?.bin && claude.version
  if (!claude?.bin) {
    add('claude', `not found (no claude on PATH${claude?.ignoredExecPath ? `; CLAUDE_CODE_EXECPATH ${claude.ignoredExecPath} is not executable` : ''})`)
    stops.push('no claude binary; install Claude Code')
  } else if (!claude.version) {
    add('claude', `${claude.bin} printed no version`)
    stops.push(`${claude.bin} --version printed no version`)
  } else {
    add('claude', claudeLine(claude))
    if (cmpVersion(claude.version, FLOOR) < 0) stops.push(`Claude Code ${claude.version} is below the floor ${FLOOR}; update Claude Code`)
  }

  if (usable) {
    const m = modsLoad(claude)
    add('mods load', m.line)
    if (m.stop) stops.push(m.stop)
  } else add('mods load', 'not checked (no usable claude)')

  let home = null
  try { home = harnessHome() } catch (e) { stops.push(e.message) }

  let res = null
  if (usable || types) {
    try {
      const loc = locateTypes({ modDir, typesPath: types, home: home || undefined, claude: usable ? claude : null })
      out.types = loc
      const older = usable && loc.version !== claude.version ? `; claude is ${claude.version}` : ''
      add('types', `${tildify(loc.file)} (written by ${loc.version || 'an unknown build'}, ${loc.source}${older})`)
      res = runApiCheck({ typesLoc: loc })
      out.apiCheck = res
    } catch (e) {
      add('types', `not found (${e.message})`)
      stops.push(`no types for this build: ${e.message}`)
    }
  } else add('types', 'not checked (no usable claude and no --types)')

  const baseline = (() => { try { return JSON.parse(fs.readFileSync(DEFAULTS.baseline, 'utf8')).version } catch { return null } })()
  add('baseline', baseline ? `${slash(path.relative(SKILL_DIR, DEFAULTS.baseline))} stamped ${baseline}` : `missing (${slash(path.relative(SKILL_DIR, DEFAULTS.baseline))})`)
  if (!baseline) stops.push('the baseline map is missing; reinstall the skill')
  add('drift', res ? driftLine(res) : 'not checked')
  add('references', res ? referencesLine(res) : 'not checked')
  add('typescript', typescriptLine())
  add('tmux', process.platform === 'win32' ? 'not on Windows (the interactive stage reads unverified)' : which('tmux') ? 'present' : 'missing (the interactive stage reads unverified (tmux missing))')

  if (home) {
    const login = usable ? loginState(claude, home) : null
    const how = `run CLAUDE_CONFIG_DIR=${tildify(home.config)} claude auth login for command and interactive stages`
    add('harness', `${tildify(home.dir)} (login: ${login === null ? 'not checked' : login ? 'yes' : `no; ${how}`})`)
  } else add('harness', `refused (${stops.find(s => s.startsWith('harness home')) || 'unusable'})`)

  if (modDir && usable) {
    const name = modName(modDir)
    add('name clash', name ? clashLine(claude, name) : 'not checked (no name in .claude-plugin/plugin.json)')
    const details = name && home ? detailsLine(claude, home, modDir, name) : null
    if (details) add('details', details)
  }

  const flagged = res ? [...res.stale.map(s => s.name), ...res.shapeDrift.map(s => s.id)] : []
  if (stops.length) { out.verdict = `stop: ${stops[0]}`; out.exit = 2 }
  else if (flagged.length) { out.verdict = `proceed, references partly stale: ${list([...new Set(flagged)], 10)}`; out.exit = 1 }
  else { out.verdict = 'proceed'; out.exit = 0 }
  add('verdict', out.verdict)
  out.stops = stops
  return out
}

export function formatGate(out) {
  return ['mod-builder gate', ...out.lines.map(([k, v]) => `  ${(k + ':').padEnd(LABEL_WIDTH)}${v}`)].join('\n')
}

if (isMain(import.meta)) {
  let args
  try { args = parseArgs(process.argv.slice(2), { flags: ['json', 'help'], values: ['types'] }) } catch (e) { console.error(`${e.message}\n${USAGE}`); process.exitCode = 2 }
  if (args?.help) console.log(USAGE)
  else if (args) {
    if (args._.length > 1) { console.error(USAGE); process.exitCode = 2 }
    else {
      try {
        const out = runGate({ modDir: args._[0], types: args.types })
        if (args.json) {
          const { apiCheck, ...rest } = out
          console.log(JSON.stringify({ ...rest, block: formatGate(out), apiCheck: apiCheck && { summary: apiCheck.summary, drift: apiCheck.drift, stale: apiCheck.stale, uncovered: apiCheck.uncovered, shapeDrift: apiCheck.shapeDrift } }, null, 2))
        } else console.log(formatGate(out))
        process.exitCode = out.exit
      } catch (e) {
        console.error(`gate: ${e.message}`)
        process.exitCode = 2
      }
    }
  }
}
