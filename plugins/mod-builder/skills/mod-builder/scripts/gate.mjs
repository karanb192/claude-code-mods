#!/usr/bin/env node
// Step 0: checks this machine can build and prove a mod, finds this build's types,
// and diffs them against the skill's baseline and references. Prints the block the
// skill pastes verbatim when any line is not ok. A line that needs attention starts
// with "! "; a line that is fine has no marker. --json lists those line keys in "attention".
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
    if (/no hooks module to load/.test(text)) return { ok: true, line: 'yes (claude plugin test ran; it found no module there, as expected)' }
    const here = text.match(/hooks modules are turned off here(?: \(([^)]*)\))?/)
    if (here) return { line: `no, turned off here (${here[1] || 'a setting or policy'})`, stop: `mods are turned off here (${here[1] || 'a setting or policy'}); remove the setting or ask the admin` }
    if (/hooks modules are turned off (?:for installed plugins )?in this process/.test(text)) {
      return { line: 'no, turned off in this process', stop: 'mods are turned off in this process; no setting on this machine turns them back on' }
    }
    const first = text.trim().split('\n')[0] || `exit ${r.code}, no output`
    return { line: `unknown (claude plugin test printed: ${first})` }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

// Each line builder returns { line, ok }; ok false puts "! " in front of the line.
// Additions alone are fine: a newer build adds names the plan may simply not use.
export function driftLine(res) {
  const ok = !res.drift.some(d => d.sign === '-') && !res.shapeDrift.length
  return { line: driftText(res), ok }
}

function driftText(res) {
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

export function referencesLine(res) {
  const ok = res.refs.found && !res.stale.length && !res.shapeDrift.length
  return { line: referencesText(res), ok }
}

function referencesText(res) {
  if (!res.refs.found) return `none at ${slash(path.relative(SKILL_DIR, res.refs.dir)) || '.'}/ (0 stale reported; nothing to check)`
  if (res.stale.length || res.shapeDrift.length) {
    const bits = []
    if (res.stale.length) bits.push(`${res.stale.length} stale: ${list(res.stale.map(s => s.name))}`)
    if (res.shapeDrift.length) bits.push(`${res.shapeDrift.length} shape drift: ${list(res.shapeDrift.map(s => s.id))}`)
    return `partly stale (${bits.join('; ')})`
  }
  const names = [...new Set(res.uncovered.map(u => u.name))]
  return `usable (0 stale, ${names.length} uncovered${names.length ? `: ${list(names, 10)}` : ''})`
}

function typescriptLine() {
  const tsc = which('tsc')
  if (tsc) {
    const r = runClaude(tsc, ['--version'], { timeoutMs: 30_000 })
    const v = r.stdout.match(/(\d+\.\d+\.\d+)/)?.[1]
    return { ok: true, line: `tsc ${v || 'unknown version'} (${tsc})` }
  }
  if (which('npx')) return { line: 'npx -y -p typescript tsc (no tsc on PATH; the first typecheck downloads TypeScript)' }
  return { line: 'none (no tsc and no npx; the typecheck stage will read unverified)' }
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
  try { installed = JSON.parse(r.stdout) } catch { return { line: 'unknown (claude plugin list --json printed no JSON)' } }
  const hits = installed.filter(p => String(p.id || p.name || '').split('@')[0] === name)
  if (!hits.length) return { ok: true, line: `none (no installed plugin named ${name})` }
  const ids = hits.map(p => `${p.id}${p.enabled === false ? ' (disabled)' : ''}`).join(', ')
  return { line: `${ids} installed; --plugin-dir and the installed copy conflict: ask which one to test against` }
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
  const attention = []
  const stops = []
  const add = (key, value, ok = true) => { lines.push([key, value]); if (!ok) attention.push(key) }
  const out = { lines, attention, claude: null, types: null, apiCheck: null }

  const claude = findClaude()
  out.claude = claude
  const usable = claude?.bin && claude.version
  if (!claude?.bin) {
    add('claude', `not found (no claude on PATH${claude?.ignoredExecPath ? `; CLAUDE_CODE_EXECPATH ${claude.ignoredExecPath} is not executable` : ''})`, false)
    stops.push('no claude binary; install Claude Code')
  } else if (!claude.version) {
    add('claude', `${claude.bin} printed no version`, false)
    stops.push(`${claude.bin} --version printed no version`)
  } else {
    add('claude', claudeLine(claude), cmpVersion(claude.version, FLOOR) >= 0)
    if (cmpVersion(claude.version, FLOOR) < 0) stops.push(`Claude Code ${claude.version} is below the floor ${FLOOR}; update Claude Code`)
  }

  if (usable) {
    const m = modsLoad(claude)
    add('mods load', m.line, !!m.ok)
    if (m.stop) stops.push(m.stop)
  } else add('mods load', 'not checked (no usable claude)', false)

  let home = null
  try { home = harnessHome() } catch (e) { stops.push(e.message) }

  let res = null
  if (usable || types) {
    try {
      const loc = locateTypes({ modDir, typesPath: types, home: home || undefined, claude: usable ? claude : null })
      out.types = loc
      const older = usable && loc.version !== claude.version ? `; claude is ${claude.version}` : ''
      const written = `written by ${loc.version || 'an unknown build'}, ${loc.source}${older}`
      add('types', loc.dir ? `${tildify(loc.dir)} (claude-code/index.d.ts inside; ${written})` : `${tildify(loc.file)} (${written})`)
      res = runApiCheck({ typesLoc: loc })
      out.apiCheck = res
    } catch (e) {
      add('types', `not found (${e.message})`, false)
      stops.push(`no types for this build: ${e.message}`)
    }
  } else add('types', 'not checked (no usable claude and no --types)', false)

  const baseline = (() => { try { return JSON.parse(fs.readFileSync(DEFAULTS.baseline, 'utf8')).version } catch { return null } })()
  add('baseline', baseline ? `${slash(path.relative(SKILL_DIR, DEFAULTS.baseline))} stamped ${baseline}` : `missing (${slash(path.relative(SKILL_DIR, DEFAULTS.baseline))})`, !!baseline)
  if (!baseline) stops.push('the baseline map is missing; reinstall the skill')
  // With no types the types line already carries the marker.
  const drift = res ? driftLine(res) : { line: 'not checked', ok: true }
  add('drift', drift.line, drift.ok)
  const refs = res ? referencesLine(res) : { line: 'not checked', ok: true }
  add('references', refs.line, refs.ok)
  const ts = typescriptLine()
  add('typescript', ts.line, !!ts.ok)
  if (process.platform === 'win32') add('tmux', 'not on Windows (the interactive stage reads unverified)', false)
  else if (which('tmux')) add('tmux', 'present')
  else add('tmux', 'absent (do not pass --interactive to prove; it refuses with exit 2)', false)

  if (home) {
    const login = usable ? loginState(claude, home) : null
    const how = `run CLAUDE_CONFIG_DIR=${tildify(home.config)} claude auth login once for the interactive stage, or for a command whose hook reaches the model`
    add('harness', `${tildify(home.dir)} (login: ${login === null ? 'not checked' : login ? 'yes' : `no; ${how}`})`, login === true)
  } else add('harness', `refused (${stops.find(s => s.startsWith('harness home')) || 'unusable'})`, false)

  if (modDir && usable) {
    const name = modName(modDir)
    const clash = name ? clashLine(claude, name) : { line: 'not checked (no name in .claude-plugin/plugin.json)' }
    add('name clash', clash.line, !!clash.ok)
    const details = name && home ? detailsLine(claude, home, modDir, name) : null
    if (details) add('details', details)
  }

  const flagged = res ? [...res.stale.map(s => s.name), ...res.shapeDrift.map(s => s.id)] : []
  if (stops.length) { out.verdict = `stop: ${stops[0]}`; out.exit = 2 }
  else if (flagged.length) { out.verdict = `proceed, references partly stale: ${list([...new Set(flagged)], 10)}`; out.exit = 1 }
  else { out.verdict = 'proceed'; out.exit = 0 }
  add('verdict', out.verdict, out.exit !== 2)
  out.stops = stops
  return out
}

export function formatGate(out) {
  const marked = new Set(out.attention || [])
  return ['mod-builder gate', ...out.lines.map(([k, v]) => `${marked.has(k) ? '! ' : '  '}${(k + ':').padEnd(LABEL_WIDTH)}${v}`)].join('\n')
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
