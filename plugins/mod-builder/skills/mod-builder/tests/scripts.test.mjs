// node --test 'plugins/mod-builder/skills/mod-builder/tests/*.test.mjs'
//
// One file, one top-level describe per package. Offline sections run everywhere with
// a stub `claude`; live sections need a real claude at or above the floor on PATH and
// print a skip line otherwise. Fixtures are heredocs here, never committed folders.
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as H from './helpers.mjs'
import {
  FLOOR, LOG_PATTERNS, cmpVersion, diffApiMap, extractApiMap, findClaude, harnessHome, hashTree,
  matchLog, methodNames, parseValidateJson, readTypes, runClaude
} from '../scripts/lib.mjs'
import { driftLine as gateDriftLine, referencesLine as gateReferencesLine } from '../scripts/gate.mjs'

after(() => H.cleanup())

const BASELINE = H.readJson(path.join(H.DATA_DIR, 'api-map.json'))
const ASSERTIONS = H.readJson(path.join(H.DATA_DIR, 'api-assertions.json'))
const SNAPSHOT = H.snapshotPath()
const LIVE = H.realClaude()
const IS_WIN = process.platform === 'win32'

const snapshotSkip = SNAPSHOT ? false : 'no 2.1.287 snapshot (set MOD_BUILDER_SNAPSHOT or add tests/fixtures/claude-code-2.1.287.d.ts)'
const liveSkip = LIVE ? false : `no claude at or above ${FLOOR} on PATH`
if (snapshotSkip) console.log(`# skip: snapshot tests: ${snapshotSkip}`)
if (liveSkip) console.log(`# skip: live tests: ${liveSkip}`)

const stripDate = m => ({ ...m, extractedAt: undefined })

// =====================================================================================
// Package A: lib.mjs, gate.mjs, api-check.mjs, data/api-map.json, data/api-assertions.json
// =====================================================================================

const IMAGE_PEEK_VALIDATE = JSON.parse(String.raw`{
  "success": true, "strict": false, "target": "<abs path>/.claude-plugin/plugin.json",
  "manifest": { "file": "<abs path>/.claude-plugin/plugin.json", "type": "plugin", "errors": [], "warnings": [],
    "notes": [
      "types ./types/index.d.ts declares on $: nothing (no EngineInterface member)",
      "types ./types/index.d.ts declares state: image-peek.session"
    ] },
  "contents": [ { "file": "<abs path>/hooks/hooks.json", "type": "hooks", "errors": [], "warnings": [],
    "notes": [
      "./register.ts hooks: session.start, prompt.edit, prompt.fill, command.run{command=image-peek}, session.end, session.compact, ui.render{component=AbovePrompt}, ui.render{component=Pane, requestId=image-peek}, ui.close{id=image-peek}",
      "./register.ts calls: $.clock.every, $.command.register, $.env.get, $.process.run, $.prompt.read, $.session.id, $.state.get, $.state.set (via save), $.ui.close, $.ui.invalidate, $.ui.log, $.ui.open (via update), $.ui.panes, $.ui.resolve",
      "./register.ts env writes: nothing",
      "./register.ts env reads: CLAUDE_CODE_FORCE_TERMINAL_IMAGES, GHOSTTY_RESOURCES_DIR, HERDR_ENV, TERM_PROGRAM",
      "./register.ts state writes: image-peek.session",
      "./register.ts state reads: image-peek.session"
    ] } ]
}`)

const STATE_NOTYPES_VALIDATE = JSON.parse(String.raw`{
  "success": false, "strict": false, "target": "<abs path>/.claude-plugin/plugin.json",
  "manifest": { "file": "<abs path>/.claude-plugin/plugin.json", "type": "plugin", "errors": [], "warnings": [], "notes": [] },
  "contents": [ { "file": "<abs path>/hooks/hooks.json", "type": "hooks",
    "errors": [ { "path": "modules../register.ts", "message": "probe-state-notypes.count is not declared: the manifest's types contract must name it in interface PluginState { probe-state-notypes: { count: ... } }", "code": null } ],
    "warnings": [ "author: No author information provided" ],
    "notes": [
      "./register.ts hooks: session.start",
      "./register.ts calls: $.state.get, $.state.set",
      "./register.ts state writes: probe-state-notypes.count",
      "./register.ts state reads: probe-state-notypes.count"
    ] } ]
}`)

const MATCHERS_VALIDATE = {
  success: true,
  manifest: { errors: [], warnings: [], notes: [] },
  contents: [{
    errors: [], warnings: [],
    notes: [
      './register.ts hooks: tool.call{tool=/"^mcp__github__"/}, tool.check{tool=Read|Grep}, session.start',
      './register.ts calls: $.store.get (via readNote, loadAll), $.store.set',
      './other.ts calls: nothing on $'
    ]
  }]
}

const OBSERVED_LOG = String.raw`2026-10-03T09:53:51.591Z [DEBUG] hooks module marker-mod@inline loaded (worker, environment 1, tier user); events: session.start
2026-10-03T09:53:51.650Z [DEBUG] type root of marker-mod at /tmp/m/.claude-plugin/types: entries claude-code, claude-code-tools, claude-code-mcp; wrote .claude-plugin/types/claude-code/index.d.ts, tsconfig.json
2026-10-03T09:53:51.667Z [DEBUG] $.fs.write (marker-mod): /tmp/m.marker (32 bytes)
2026-10-03T09:53:51.668Z [DEBUG] [marker-mod] $.ui.log: marker-mod: wrote marker
2026-10-03T09:53:51.668Z [DEBUG] [marker-mod] $.ui.log (to debug): marker-mod: debug line
2026-10-03T09:53:51.672Z [DEBUG] hooks module marker-mod@inline session.start settled in 10.5ms (worker hop, next() included)
2026-10-03T09:53:52.000Z [DEBUG] hooks module other-mod@inline not loaded: only managed plugins and built-in plugins run (allowManagedHooksOnly / disableAllHooks)
first-mod: tool.call hook skipped: threw Error: boom
first-mod registered /tally but no command.run hook answered it
first-mod: ui.render (Pane) refused: Box prop "flexDirection" must be one of row, column; the engine drew its own
`

describe('A: lib.mjs', () => {
  it('FLOOR is the floor and cmpVersion compares dotted numbers, not strings', () => {
    assert.equal(FLOOR, '2.1.287')
    assert.equal(cmpVersion('2.1.288', '2.1.287'), 1)
    assert.equal(cmpVersion('2.1.287', '2.1.287'), 0)
    assert.equal(cmpVersion('2.1.99', '2.1.287'), -1)
    assert.equal(cmpVersion('2.10.0', '2.9.9'), 1)
  })

  it('parseValidateJson reads every note form from the image-peek report', () => {
    const r = parseValidateJson(IMAGE_PEEK_VALIDATE)
    assert.equal(r.success, true)
    assert.deepEqual(r.errors, [])
    assert.equal(r.notes.length, 8)
    assert.deepEqual(r.hooks.find(h => h.event === 'ui.render' && h.matcher.component === 'Pane'), { event: 'ui.render', matcher: { component: 'Pane', requestId: 'image-peek' } })
    assert.deepEqual(r.hooks.find(h => h.event === 'session.start'), { event: 'session.start', matcher: {} })
    assert.equal(r.calls.length, 14)
    assert.ok(r.calls.includes('$.state.set') && r.calls.includes('$.ui.open'))
    assert.ok(!r.calls.some(c => c.includes('via')))
    assert.deepEqual(r.via, { '$.state.set': ['save'], '$.ui.open': ['update'] })
    assert.deepEqual(r.envWrites, [])
    assert.deepEqual(r.envReads, ['CLAUDE_CODE_FORCE_TERMINAL_IMAGES', 'GHOSTTY_RESOURCES_DIR', 'HERDR_ENV', 'TERM_PROGRAM'])
    assert.deepEqual(r.stateReads, ['image-peek.session'])
    assert.deepEqual(r.stateWrites, ['image-peek.session'])
    assert.deepEqual(r.declares, { nouns: [], state: ['image-peek.session'] })
  })

  it('parseValidateJson keeps the footprint of a failed validate', () => {
    const r = parseValidateJson(STATE_NOTYPES_VALIDATE)
    assert.equal(r.success, false)
    assert.equal(r.errors.length, 1)
    assert.equal(r.errors[0].path, 'modules../register.ts')
    assert.match(r.errors[0].message, /is not declared/)
    assert.deepEqual(r.warnings, [{ path: null, message: 'author: No author information provided' }])
    assert.deepEqual(r.calls, ['$.state.get', '$.state.set'])
  })

  it('parseValidateJson keeps regex matchers as written, splits arrays, reads "nothing on $"', () => {
    const r = parseValidateJson(MATCHERS_VALIDATE)
    assert.deepEqual(r.hooks[0], { event: 'tool.call', matcher: { tool: '/"^mcp__github__"/' } })
    assert.deepEqual(r.hooks[1], { event: 'tool.check', matcher: { tool: ['Read', 'Grep'] } })
    assert.deepEqual(r.calls, ['$.store.get', '$.store.set'])
    assert.deepEqual(r.via, { '$.store.get': ['readNote', 'loadAll'] })
    assert.deepEqual(parseValidateJson({ success: true, contents: [{ notes: ['./r.ts calls: nothing on $'] }] }).calls, [])
  })

  it('LOG_PATTERNS match the debug lines a load writes', () => {
    const one = k => matchLog(OBSERVED_LOG, k)
    assert.deepEqual(one('loaded').map(m => [m[1], m[2], m[4]]), [['marker-mod', 'inline', 'session.start']])
    assert.equal(one('notLoaded')[0][1], 'other-mod')
    assert.deepEqual(one('settled').map(m => [m[1], m[3], m[4]]), [['marker-mod', 'session.start', '10.5']])
    assert.deepEqual(one('call').map(m => [m[1], m[2]]), [['$.fs.write', 'marker-mod']])
    assert.deepEqual(one('uiLog').map(m => [m[1], Boolean(m[2]), m[3]]), [['marker-mod', false, 'marker-mod: wrote marker'], ['marker-mod', true, 'marker-mod: debug line']])
    assert.equal(one('typeRoot')[0][1], 'marker-mod')
    assert.deepEqual(one('skipped').map(m => [m[1], m[2]]), [['first-mod', 'tool.call']])
    assert.equal(one('noCommandHook')[0][2], 'tally')
    assert.equal(one('renderRefused')[0][1], 'Pane')
    for (const src of Object.values(LOG_PATTERNS)) assert.doesNotThrow(() => new RegExp(src, 'm'))
  })

  it('hashTree lists sorted hashes and honours exclude', () => {
    const d = H.writeFiles(H.tmpDir(), { 'b.txt': 'b', 'a/x.ts': 'x', 'node_modules/m.js': 'm', '.claude-plugin/types/claude-code/index.d.ts': 't', '.claude-plugin/plugin.json': '{}' })
    const list = hashTree(d, { exclude: ['node_modules', '.claude-plugin/types'] })
    assert.deepEqual(list.map(l => l.split('  ')[1]), ['.claude-plugin/plugin.json', 'a/x.ts', 'b.txt'])
    assert.match(list[0], /^[0-9a-f]{64} {2}/)
    fs.writeFileSync(path.join(d, 'b.txt'), 'changed')
    assert.notDeepEqual(hashTree(d, { exclude: ['node_modules', '.claude-plugin/types'] }), list)
  })

  it('harnessHome creates 0700 subdirs and refuses a symlink or an open dir', { skip: IS_WIN && 'POSIX modes' }, () => {
    const root = H.tmpDir()
    const home = harnessHome({ MOD_BUILDER_HOME: path.join(root, 'home') })
    for (const k of ['config', 'types', 'runs', 'probe']) assert.equal(fs.statSync(home[k]).mode & 0o777, 0o700)
    assert.equal(home.strikes, path.join(root, 'home', 'strikes.json'))
    fs.symlinkSync(home.dir, path.join(root, 'link'))
    assert.throws(() => harnessHome({ MOD_BUILDER_HOME: path.join(root, 'link') }), /symlink/)
    fs.mkdirSync(path.join(root, 'open'), { mode: 0o755 })
    fs.chmodSync(path.join(root, 'open'), 0o755)
    assert.throws(() => harnessHome({ MOD_BUILDER_HOME: path.join(root, 'open') }), /open to group or other/)
  })

  it('findClaude prefers a runnable CLAUDE_CODE_EXECPATH and ignores a missing one', () => {
    const a = H.tmpDir(), b = H.tmpDir()
    H.writeStubClaude(a, { version: '2.1.290' })
    H.writeStubClaude(b, { version: '2.1.288' })
    const viaPath = findClaude(H.stubEnv(b, { CLAUDE_CODE_EXECPATH: path.join(a, 'missing') }))
    assert.equal(viaPath.source, 'PATH')
    assert.equal(viaPath.version, '2.1.288')
    assert.equal(viaPath.ignoredExecPath, path.join(a, 'missing'))
    const viaExec = findClaude(H.stubEnv(b, { CLAUDE_CODE_EXECPATH: path.join(a, 'claude') }))
    assert.deepEqual([viaExec.source, viaExec.version, viaExec.pathVersion], ['CLAUDE_CODE_EXECPATH', '2.1.290', '2.1.288'])
    assert.equal(findClaude(H.bareEnv()), null)
  })

  it('runClaude drops the early-access flag from the child env', () => {
    const bin = H.tmpDir()
    H.writeStubClaude(bin)
    runClaude(path.join(bin, 'claude'), ['--version'], { env: { ...process.env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' } })
    assert.equal(H.stubCalls(bin)[0].flag, false)
  })

  it('extractApiMap round-trips the baseline through synthetic declarations', () => {
    const dir = H.synthTypes(BASELINE, H.tmpDir())
    const { main, tools } = readTypes({ dir })
    assert.deepEqual(stripDate(extractApiMap(main, tools)), stripDate(BASELINE))
  })

  it('extractApiMap throws, naming the family, when the d.ts shape changed', () => {
    const dir = H.synthTypes(BASELINE, H.tmpDir())
    const f = path.join(dir, 'claude-code', 'index.d.ts')
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('export type EngineEventOf = {', 'export type EngineEvents = {'))
    const { main, tools } = readTypes({ dir })
    assert.throws(() => extractApiMap(main, tools), /the d\.ts shape changed; fix the extractor \(engine events\)/)
    assert.throws(() => extractApiMap('// no version line\n'), /\(version line\)/)
  })

  it('extractApiMap on the 2.1.287 snapshot equals data/api-map.json', { skip: snapshotSkip }, () => {
    const { main, tools } = readTypes({ dir: H.splitSnapshot(SNAPSHOT, H.tmpDir()) })
    assert.deepEqual(stripDate(extractApiMap(main, tools)), stripDate(BASELINE))
  })

  it('the 2.1.288 delta is exactly + ui.selection (op event) and + $.ui.selection (method)', { skip: snapshotSkip }, () => {
    const dir = H.make288(H.splitSnapshot(SNAPSHOT, H.tmpDir()), H.tmpDir())
    const { main, tools } = readTypes({ dir })
    assert.deepEqual(diffApiMap(BASELINE, extractApiMap(main, tools)), [
      { sign: '+', family: 'op event', name: 'ui.selection' },
      { sign: '+', family: 'method', name: '$.ui.selection' }
    ])
  })
})

describe('A: data files', () => {
  it('api-map.json is the 2.1.287 baseline with every family above its floor', () => {
    assert.equal(BASELINE.version, '2.1.287')
    assert.ok(BASELINE.events.engine.length >= 40 && BASELINE.events.op.length >= 50 && BASELINE.events.classic.length >= 30)
    assert.ok(methodNames(BASELINE).length >= 70 && BASELINE.components.length >= 15)
    assert.equal(BASELINE.surfaces.length, 4)
    assert.equal(BASELINE.tiers.length, 5)
    assert.deepEqual(Object.keys(BASELINE.budget).sort(), ['catchMs', 'lingerMs', 'ms'])
    assert.ok(!methodNames(BASELINE).includes('$.ui.selection'))
  })

  it('api-assertions.json rows have every field, unique ids, and compile', () => {
    const ids = new Set()
    for (const a of ASSERTIONS) {
      for (const k of ['id', 'about', 'pattern', 'claim', 'file']) assert.equal(typeof a[k], 'string', `${a.id} ${k}`)
      assert.ok(!ids.has(a.id), `duplicate ${a.id}`)
      ids.add(a.id)
      assert.doesNotThrow(() => new RegExp(a.pattern, 'm'))
    }
    assert.ok(ids.size >= 10)
  })

  it('every assertion matches the 2.1.287 snapshot and a 2.1.288 file', { skip: snapshotSkip }, () => {
    const d287 = H.splitSnapshot(SNAPSHOT, H.tmpDir())
    const d288 = H.make288(d287, H.tmpDir())
    for (const dir of [d287, d288]) {
      const { main, tools } = readTypes({ dir })
      for (const a of ASSERTIONS) assert.match(main + '\n' + tools, new RegExp(a.pattern, 'm'), `${a.id} on ${readTypes({ dir }).version}`)
    }
  })

  it('no em or en dashes in the shipped data', () => {
    for (const f of ['api-map.json', 'api-assertions.json']) assert.doesNotMatch(fs.readFileSync(path.join(H.DATA_DIR, f), 'utf8'), /[\u2013\u2014]/)
  })
})

describe('A: api-check.mjs', () => {
  const baselineTypes = () => H.synthTypes(BASELINE, H.tmpDir())
  const emptySkill = () => path.join(H.tmpDir(), 'SKILL.md')

  it('reports 0 stale and 0 uncovered on the shipped references and SKILL.md against the baseline names', () => {
    const r = H.runScript('api-check.mjs', ['--types', baselineTypes(), '--json'])
    const res = JSON.parse(r.stdout)
    assert.deepEqual(res.stale, [], res.stale.map(s => `${s.name} at ${s.file}:${s.line}`).join('\n'))
    assert.deepEqual(res.uncovered, [])
    assert.match(res.summary, /references: 0 stale, 0 uncovered, \d+ shape drift$/)
  })

  it('on a 2.1.288 map the shipped references leave exactly ui.selection and $.ui.selection uncovered', () => {
    const newer = JSON.parse(JSON.stringify(BASELINE))
    newer.methods.ui.push('selection')
    newer.events.op.push('ui.selection')
    const res = JSON.parse(H.runScript('api-check.mjs', ['--types', H.synthTypes(newer, H.tmpDir(), { version: '2.1.288' }), '--json']).stdout)
    assert.deepEqual(res.stale, [])
    assert.deepEqual(res.uncovered.map(u => u.name).sort(), ['$.ui.selection', 'ui.selection'])
  })

  it('reports STALE and a removed method when the build drops a name a block lists', () => {
    const refs = H.writeFiles(H.tmpDir(), { 'nouns.md': `# nouns\n\n${H.allMethodsBlock(BASELINE)}\n` })
    const types = H.synthTypes(H.withoutMethod(BASELINE, 'ui', 'blit'), H.tmpDir())
    const r = H.runScript('api-check.mjs', ['--types', types, '--refs', refs, '--skill', emptySkill()])
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /^- \$\.ui\.blit \(method\)$/m)
    assert.match(r.stdout, /^STALE \$\.ui\.blit at [^:]+\/nouns\.md:\d+$/m)
    assert.match(r.stdout, /^drift: \+0 methods, \+0 events, 1 removed; references: 1 stale, \d+ uncovered, \d+ shape drift$/m)
  })

  it('scans backticked prose, honours the ignore escape, skips file names and test-kit event calls', () => {
    const refs = H.writeFiles(H.tmpDir(), {
      'a.md': [
        '<!-- api-check: ignore $.topo.read, tool.calls -->',
        'Use `$.ui.nope` and `$.nonoun` here; `classic.Nope`, `next.nope`, `turn.nope`.',
        'Fine: `$.ui.log`, `$.ui`, `on("tool.call", h)`, `command.run{command=x}`, `classic.Stop`, `next.to(e, "core")`.',
        'Fine too: `plugin.json`, `command.out`, `process.env`, `$.session.start(input)`, `$.topo.read`, `"tool.calls" is not an event`.',
        '```ts',
        'const x = $.ui.ignoredInCode()',
        '```'
      ].join('\n')
    })
    const r = H.runScript('api-check.mjs', ['--types', baselineTypes(), '--refs', refs, '--skill', emptySkill(), '--json'])
    const stale = JSON.parse(r.stdout).stale.map(s => s.name).sort()
    assert.deepEqual(stale, ['$.nonoun', '$.ui.nope', 'classic.Nope', 'next.nope', 'turn.nope'])
  })

  it('reports UNCOVERED, NO BLOCK, a wrong budget value and an unknown block kind', () => {
    const refs = H.writeFiles(H.tmpDir(), {
      'e.md': ['```api-events', ...BASELINE.events.engine, ...BASELINE.events.op.slice(1), ...BASELINE.events.classic, '```',
        '```api-budget', 'ms: 10_000', 'catchMs: 2000', 'lingerMs', '```', '```api-widgets', 'Thing', '```'].join('\n')
    })
    const r = H.runScript('api-check.mjs', ['--types', baselineTypes(), '--refs', refs, '--skill', emptySkill()])
    assert.match(r.stdout, new RegExp(`^UNCOVERED ${BASELINE.events.op[0].replace('.', '\\.')} \\(api-events\\)$`, 'm'))
    assert.match(r.stdout, /^NO BLOCK api-methods: \d+ live names not listed in references \(not counted\)$/m)
    assert.match(r.stdout, new RegExp(`^NO BLOCK api-classic: ${BASELINE.events.classic.length} live names not listed in references \\(not counted\\)$`, 'm'))
    assert.doesNotMatch(r.stdout, /^UNCOVERED classic\./m)
    assert.match(r.stdout, /^STALE catchMs=2000 at /m)
    assert.match(r.stdout, /^STALE api-widgets \(unknown block kind\) at /m)
    assert.equal(r.code, 1)
  })

  it('an op event is covered by its method in api-methods; classic counts only once an api-classic block exists', () => {
    const [op0, op1] = BASELINE.events.op
    const methods = methodNames(BASELINE).filter(m => m !== `$.${op1}`)
    const [c0, c1, ...cRest] = BASELINE.events.classic
    const run = files => JSON.parse(H.runScript('api-check.mjs', ['--types', baselineTypes(), '--refs', H.writeFiles(H.tmpDir(), files), '--skill', emptySkill(), '--json']).stdout)
    const events = ['```api-events', ...BASELINE.events.engine, c0, '```'].join('\n')
    const methodsBlock = ['```api-methods', ...methods, '```'].join('\n')
    assert.ok(methodNames(BASELINE).includes(`$.${op0}`) && methodNames(BASELINE).includes(`$.${op1}`))

    const a = run({ 'e.md': events, 'm.md': methodsBlock })
    assert.deepEqual(a.stale, [])
    assert.deepEqual(a.uncovered.map(u => u.name).sort(), [`$.${op1}`, op1].sort())
    assert.deepEqual(a.noBlock.find(b => b.kind === 'classic'), { kind: 'classic', count: BASELINE.events.classic.length })

    const b = run({ 'e.md': events, 'm.md': methodsBlock, 'c.md': ['```api-classic', ...cRest.map(c => c.replace(/^classic\./, '')), '```'].join('\n') })
    assert.deepEqual(b.stale, [])
    assert.deepEqual(b.uncovered.filter(u => u.kind === 'classic').map(u => u.name), [c1])
    assert.equal(b.noBlock.find(x => x.kind === 'classic'), undefined)

    const text = H.runScript('api-check.mjs', ['--types', baselineTypes(), '--refs', H.writeFiles(H.tmpDir(), { 'c.md': '```api-classic\nclassic.Nope\n```\n' }), '--skill', emptySkill()]).stdout
    assert.match(text, /^STALE classic\.Nope at [^:]+\/c\.md:2$/m)
  })

  it('a missing references dir reports 0 stale and says so', () => {
    const r = H.runScript('api-check.mjs', ['--types', baselineTypes(), '--refs', path.join(H.tmpDir(), 'none'), '--skill', emptySkill()])
    assert.match(r.stdout, /^references: none at .* \(0 stale reported; nothing to check\)$/m)
    assert.match(r.stdout, /references: 0 stale, 0 uncovered/)
  })

  it('a declaration that no longer holds is SHAPE DRIFT and exit 1', () => {
    const r = H.runScript('api-check.mjs', ['--types', baselineTypes(), '--refs', path.join(H.tmpDir(), 'none'), '--skill', emptySkill()])
    assert.equal(r.code, 1)
    assert.match(r.stdout, /^SHAPE DRIFT budget\.ms: "[^"]+" no longer matches \(cited at references\/limits\.md\)$/m)
  })

  it('--mod prints MIGRATE lines for early-access leftovers', () => {
    const mod = H.writeFiles(H.tmpDir(), {
      'README.md': 'Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1, then /plugin-types and npx tsc -p .\nNeeds early access.\nexport function register(on) {}\n',
      '.claude-plugin/plugin.json': '{ "name": "old", "description": "Does a thing. Needs function hooks (early access)" }',
      'tsconfig.json': '{ "include": [".claude/types", "hooks"] }',
      'hooks/register.ts': 'const { Box } = await $.ui.resolve(e)\n'
    })
    const r = H.runScript('api-check.mjs', ['--types', baselineTypes(), '--refs', path.join(H.tmpDir(), 'none'), '--skill', emptySkill(), '--mod', mod, '--json'])
    const ids = JSON.parse(r.stdout).migrate.map(m => `${m.id} ${m.file}:${m.line}`).sort()
    assert.deepEqual(ids, ['M.desc .claude-plugin/plugin.json:1', 'M.early README.md:2', 'M.flag README.md:1', 'M.npx README.md:1', 'M.register README.md:3', 'M.resolve hooks/register.ts:1', 'M.tsconfig tsconfig.json:1', 'M.types README.md:1'])
    const text = H.runScript('api-check.mjs', ['--types', baselineTypes(), '--refs', path.join(H.tmpDir(), 'none'), '--skill', emptySkill(), '--mod', mod]).stdout
    assert.match(text, /^MIGRATE M\.resolve hooks\/register\.ts:1: await \$\.ui\.resolve\( -> /m)
    assert.match(text, /; mod: 8 migrate$/m)
  })

  it('--mod flags an untyped register in hooks modules, and early access or function hooks in a plugin.json description', () => {
    const mod = H.writeFiles(H.tmpDir(), {
      '.claude-plugin/plugin.json': '{\n  "name": "old",\n  "description": "A pane mod (early access)"\n}\n',
      'hooks/register.js': 'export function register(on) {\n}\n',
      'hooks/two.mjs': 'export async function register(on, options) {}\n',
      'hooks/lib/three.ts': 'export function register( on ,opts ) {}\n',
      'hooks/typed.ts': "import type { On } from 'claude-code'\nexport function register(on: On) {}\nexport function register(on, options: Options) {}\n",
      'hooks/notes.md': 'export function register(on) {}\n',
      'src/other.ts': 'export function register(on) {}\n',
      '.gitignore': '.claude/types/\n'
    })
    const run = m => JSON.parse(H.runScript('api-check.mjs', ['--types', baselineTypes(), '--refs', path.join(H.tmpDir(), 'none'), '--skill', emptySkill(), '--mod', m, '--json']).stdout).migrate
    const found = run(mod)
    assert.deepEqual(found.map(m => `${m.id} ${m.file}:${m.line}`).sort(), [
      'M.desc .claude-plugin/plugin.json:3', 'M.register hooks/lib/three.ts:1', 'M.register hooks/register.js:1', 'M.register hooks/two.mjs:1', 'M.tsconfig .gitignore:1'
    ])
    assert.equal(found.find(m => m.id === 'M.register').to, "import type { Register } from 'claude-code'; export const register: Register = (on, options) => ...")
    const fh = H.writeFiles(H.tmpDir(), { '.claude-plugin/plugin.json': { name: 'x', description: 'Built on function hooks' } })
    assert.deepEqual(run(fh).map(m => `${m.id} ${m.file}:${m.line}: ${m.old}`), ['M.desc .claude-plugin/plugin.json:3: function hooks'])
  })

  it('--help lists every MIGRATE id', () => {
    const r = H.runScript('api-check.mjs', ['--help'])
    assert.equal(r.code, 0)
    for (const id of ['M.flag', 'M.types', 'M.tsconfig', 'M.resolve', 'M.npx', 'M.register', 'M.early', 'M.desc']) assert.match(r.stdout, new RegExp(`^  ${id.replace('.', '\\.')} `, 'm'))
  })

  it('--write-baseline writes the live map to --baseline', () => {
    const out = path.join(H.tmpDir(), 'map.json')
    const r = H.runScript('api-check.mjs', ['--types', baselineTypes(), '--baseline', out, '--write-baseline', '--refs', path.join(H.tmpDir(), 'none'), '--skill', emptySkill()])
    assert.match(r.stdout, /^wrote .*map\.json from the live types$/m)
    assert.deepEqual(stripDate(H.readJson(out)), stripDate(BASELINE))
  })

  it('a types path that holds nothing is a tooling error, exit 2', () => {
    const r = H.runScript('api-check.mjs', ['--types', path.join(H.tmpDir(), 'nothing')])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /^api-check: no declarations at /)
    assert.equal(H.runScript('api-check.mjs', ['--nope']).code, 2)
  })
})

describe('A: gate.mjs (stub claude)', () => {
  const setup = (config = {}) => {
    const bin = H.tmpDir()
    const types = H.synthTypes(BASELINE, H.tmpDir(), { version: '2.1.288' })
    H.writeStubClaude(bin, { version: '2.1.288', test: 'pass', load: { typesFrom: types }, list: [], ...config })
    const home = path.join(H.tmpDir(), 'home')
    const env = H.stubEnv(bin, { MOD_BUILDER_HOME: home, MOD_BUILDER_PROBE_DIR: H.probeModDir() })
    return { bin, home, env }
  }
  const block = out => Object.fromEntries(out.split('\n').slice(1).map(l => l.match(/^(?:! | {2})([a-z ]+):\s+(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
  const marked = out => out.split('\n').slice(1).filter(l => l.startsWith('! ')).map(l => l.match(/^! ([a-z ]+):/)[1])
  // A PATH with the stub claude and node only: no tsc, no npx, no tmux.
  const narrowPath = bin => {
    const nodeDir = H.tmpDir()
    fs.symlinkSync(process.execPath, path.join(nodeDir, path.basename(process.execPath)))
    return `${bin}${path.delimiter}${nodeDir}`
  }

  it('prints the block in order, generates types under the harness config, and proceeds', () => {
    const { bin, home, env } = setup()
    const r = H.runScript('gate.mjs', [], { env })
    assert.ok([0, 1].includes(r.code), r.stdout + r.stderr)
    const lines = r.stdout.split('\n')
    assert.equal(lines[0], 'mod-builder gate')
    assert.deepEqual(Object.keys(block(r.stdout)), ['claude', 'mods load', 'types', 'baseline', 'drift', 'references', 'typescript', 'tmux', 'harness', 'verdict'])
    const b = block(r.stdout)
    assert.match(b.claude, /^2\.1\.288 \(PATH .*claude\); floor 2\.1\.287 met$/)
    assert.equal(b['mods load'], 'yes (claude plugin test ran; it found no module there, as expected)')
    assert.match(b.types, /types\/2\.1\.288 \(claude-code\/index\.d\.ts inside; written by 2\.1\.288, generated\)$/)
    assert.ok(fs.existsSync(path.join(b.types.replace(/ \(.*$/, '').replace(/^~/, process.env.HOME), 'claude-code', 'index.d.ts')), 'the types line names a folder holding claude-code/index.d.ts')
    assert.equal(b.baseline, 'data/api-map.json stamped 2.1.287')
    assert.match(b.harness, /\(login: no; run CLAUDE_CONFIG_DIR=.*config claude auth login once for the interactive stage, or for a command whose hook reaches the model\)$/)
    assert.match(b.verdict, /^proceed/)
    const flags = marked(r.stdout)
    assert.ok(flags.includes('harness'), 'login: no needs attention')
    for (const fine of ['claude', 'mods load', 'types', 'baseline', 'verdict']) assert.ok(!flags.includes(fine), `${fine} is fine and carries no marker`)
    assert.ok(fs.existsSync(path.join(home, 'types', '2.1.288', 'claude-code', 'index.d.ts')))
    const load = H.stubCalls(bin).find(c => c.args[0] === '-p')
    assert.equal(load.configDir, path.join(home, 'config'))
    assert.equal(load.flag, false)
    assert.ok(load.args.includes('--strict-mcp-config') && load.args.includes('--debug-file'))
    const again = H.runScript('gate.mjs', [], { env })
    assert.match(block(again.stdout).types, /\(claude-code\/index\.d\.ts inside; written by 2\.1\.288, cache\)$/)
  })

  it('marks every line that needs attention with "! " and lists the keys in --json attention', () => {
    const { env } = setup()
    const narrow = { ...env, PATH: narrowPath(env.PATH.split(path.delimiter)[0]) }
    const r = H.runScript('gate.mjs', [], { env: narrow })
    const b = block(r.stdout)
    assert.equal(b.tmux, process.platform === 'win32' ? 'not on Windows (the interactive stage reads unverified)' : 'absent (do not pass --interactive to prove; it refuses with exit 2)')
    assert.equal(b.typescript, 'none (no tsc and no npx; the typecheck stage will read unverified)')
    const flags = marked(r.stdout)
    for (const key of ['tmux', 'typescript', 'harness']) assert.ok(flags.includes(key), `${key} needs attention: ${r.stdout}`)
    for (const line of r.stdout.trim().split('\n').slice(1)) assert.match(line, /^(! | {2})[a-z ]+: /)
    const j = JSON.parse(H.runScript('gate.mjs', ['--json'], { env: narrow }).stdout)
    assert.deepEqual(j.attention, flags)
    assert.match(j.block, /^! tmux: +\S/m)
  })

  it('drift and references lines: additions and uncovered names alone carry no marker', () => {
    const add = { sign: '+', name: 'ui.selection', family: 'op event' }
    const base = { drift: [add, { sign: '+', name: '$.ui.selection', family: 'method' }], shapeDrift: [], stale: [], refs: { found: true }, uncovered: [{ name: 'ui.selection' }, { name: '$.ui.selection' }] }
    assert.deepEqual(gateDriftLine(base), { line: '+1 op event (ui.selection), +1 method ($.ui.selection), 0 removed, 0 shape drift', ok: true })
    assert.deepEqual(gateReferencesLine(base), { line: 'usable (0 stale, 2 uncovered: ui.selection, $.ui.selection)', ok: true })
    assert.equal(gateDriftLine({ ...base, drift: [add, { sign: '-', name: '$.ui.blit', family: 'method' }] }).ok, false)
    assert.equal(gateDriftLine({ ...base, shapeDrift: [{ id: 'budget.ms' }] }).ok, false)
    assert.deepEqual(gateReferencesLine({ ...base, uncovered: [] }), { line: 'usable (0 stale, 0 uncovered)', ok: true })
    assert.equal(gateReferencesLine({ ...base, stale: [{ name: '$.ui.blit' }] }).ok, false)
  })

  it('reports the drift a newer build adds', () => {
    const { env, bin } = setup()
    const newer = JSON.parse(JSON.stringify(BASELINE))
    newer.methods.ui.push('selection')
    newer.events.op.push('ui.selection')
    H.setStubConfig(bin, { version: '2.1.288', test: 'pass', load: { typesFrom: H.synthTypes(newer, H.tmpDir()) } })
    const b = block(H.runScript('gate.mjs', [], { env }).stdout)
    assert.match(b.drift, /^\+1 op event \(ui\.selection\), \+1 method \(\$\.ui\.selection\), 0 removed, \d+ shape drift/)
  })

  it('stops below the floor', () => {
    const { env } = setup({ version: '2.1.280' })
    const r = H.runScript('gate.mjs', [], { env })
    assert.equal(r.code, 2)
    assert.match(block(r.stdout).claude, /below floor 2\.1\.287$/)
    assert.match(block(r.stdout).verdict, /^stop: Claude Code 2\.1\.280 is below the floor 2\.1\.287/)
  })

  it('stops when mods are turned off here, naming the setting', () => {
    const { env } = setup({ test: 'off-here' })
    const r = H.runScript('gate.mjs', [], { env })
    assert.equal(r.code, 2)
    assert.equal(block(r.stdout)['mods load'], 'no, turned off here (disableAllHooks, allowManagedHooksOnly or a policy)')
    assert.match(block(r.stdout).verdict, /^stop: mods are turned off here/)
  })

  it('stops when mods are turned off in this process', () => {
    const r = H.runScript('gate.mjs', [], { env: setup({ test: 'off-process' }).env })
    assert.equal(r.code, 2)
    assert.equal(block(r.stdout)['mods load'], 'no, turned off in this process')
  })

  it('stops with no claude on PATH', () => {
    const r = H.runScript('gate.mjs', [], { env: H.bareEnv({ MOD_BUILDER_HOME: path.join(H.tmpDir(), 'home') }) })
    assert.equal(r.code, 2)
    assert.match(block(r.stdout).claude, /^not found/)
    assert.match(block(r.stdout).verdict, /^stop: no claude binary/)
  })

  it('stops when the harness home is open to others', { skip: IS_WIN && 'POSIX modes' }, () => {
    const { env, home } = setup()
    fs.mkdirSync(home, { mode: 0o755 })
    fs.chmodSync(home, 0o755)
    const r = H.runScript('gate.mjs', [], { env })
    assert.equal(r.code, 2)
    assert.match(block(r.stdout).verdict, /^stop: harness home .* is open to group or other/)
  })

  it('stops when the probe load writes no types, citing the log', () => {
    const r = H.runScript('gate.mjs', [], { env: setup({ load: { refuse: 'disableAllHooks in managed settings' } }).env })
    assert.equal(r.code, 2)
    assert.match(block(r.stdout).types, /^not found \(types not generated \(hooks module probe-mod@inline not loaded: disableAllHooks in managed settings\); log /)
  })

  it('with a mod dir: reads its own types, reports a name clash and the details line', () => {
    const { env } = setup({ list: [{ id: 'clashy@some-mkt', enabled: true }] })
    const mod = H.writeFiles(H.tmpDir(), { '.claude-plugin/plugin.json': { name: 'clashy' }, 'hooks/hooks.json': { modules: ['./register.ts'] } })
    H.synthTypes(BASELINE, path.join(mod, '.claude-plugin', 'types'), { version: '2.1.288' })
    const out = H.runScript('gate.mjs', [mod], { env }).stdout
    const b = block(out)
    assert.match(b.types, /\.claude-plugin\/types \(claude-code\/index\.d\.ts inside; written by 2\.1\.288, mod\)$/)
    assert.equal(b['name clash'], 'clashy@some-mkt installed; --plugin-dir and the installed copy conflict: ask which one to test against')
    assert.ok(marked(out).includes('name clash'))
    assert.ok(!marked(H.runScript('gate.mjs', [mod], { env: setup().env }).stdout).includes('name clash'), 'no clash, no marker')
    assert.equal(b.details, 'clashy 0.0.1; always-on ~0 tok added to every session (claude plugin details)')
  })

  it('--json prints the verdict, exit and the block', () => {
    const r = H.runScript('gate.mjs', ['--json'], { env: setup().env })
    const j = JSON.parse(r.stdout)
    assert.equal(j.exit, r.code)
    assert.match(j.verdict, /^proceed/)
    assert.match(j.block, /^mod-builder gate\n {2}claude: {6}/)
  })
})

describe('A: live (real claude)', { skip: liveSkip }, () => {
  // Isolated: a temp harness home, and a temp CLAUDE_CONFIG_DIR for the two commands the
  // gate runs under the caller's own config (plugin test, plugin list).
  const env = () => ({ ...process.env, MOD_BUILDER_HOME: path.join(H.tmpDir(), 'home'), CLAUDE_CONFIG_DIR: H.tmpDir(), MOD_BUILDER_PROBE_DIR: H.probeModDir() })
  let typesDir = null

  it('gate exits 0 or 1 with no stop and generates this build\'s types', () => {
    const e = env()
    const r = H.runScript('gate.mjs', [], { env: e })
    assert.ok([0, 1].includes(r.code), r.stdout + r.stderr)
    assert.doesNotMatch(r.stdout, /verdict: +stop/)
    typesDir = path.join(e.MOD_BUILDER_HOME, 'types', LIVE.version)
    assert.ok(fs.existsSync(path.join(typesDir, 'claude-code', 'index.d.ts')))
  })

  it('api-check exits 0 against the generated types', () => {
    const r = H.runScript('api-check.mjs', ['--types', typesDir])
    assert.equal(r.code, 0, r.stdout + r.stderr)
  })

  it('every assertion matches the generated types and nothing in the baseline is gone', () => {
    const { main, tools } = readTypes({ dir: typesDir })
    for (const a of ASSERTIONS) assert.match(main + '\n' + tools, new RegExp(a.pattern, 'm'), a.id)
    assert.deepEqual(diffApiMap(BASELINE, extractApiMap(main, tools)).filter(d => d.sign === '-'), [])
  })
})

// =====================================================================================
// Package B: footprint.mjs, data/reach-rules.json
// =====================================================================================

const { footprint: fpBuild, grade: fpGrade, loadRules: fpRules, ruleFor: fpRuleFor } = await import('../scripts/footprint.mjs')

// One validator report for one hooks module, built from its note lines (shape of `plugin validate --json`).
const validateReport = (notes, manifestNotes = []) => ({
  success: true, strict: true, target: '<abs path>/.claude-plugin/plugin.json',
  manifest: { file: '<abs path>/.claude-plugin/plugin.json', type: 'plugin', errors: [], warnings: [], notes: manifestNotes },
  contents: [{ file: '<abs path>/hooks/hooks.json', type: 'hooks', errors: [], warnings: [], notes }]
})

// Captured from `claude plugin validate --strict --json` on 2.1.288 (fable-pin, assets/probe-mod).
const FABLE_PIN_VALIDATE = validateReport([
  './register.ts hooks: session.start, command.run{command=fable-pin}, agent.spawn',
  './register.ts calls: $.command.register, $.store.get, $.store.set'
])
const PROBE_MOD_VALIDATE = validateReport([
  './register.ts hooks: session.start, command.run{command=probe-mod}',
  './register.ts calls: $.command.register, $.env.get, $.state.get, $.state.set, $.ui.log',
  './register.ts env writes: nothing',
  './register.ts env reads: MOD_BUILDER_PROBE',
  './register.ts state writes: probe-mod.runs',
  './register.ts state reads: probe-mod.runs'
], ['types ./types/index.d.ts declares on $: nothing (no EngineInterface member)', 'types ./types/index.d.ts declares state: probe-mod.runs'])
const REGEX_MATCHER = '/"^mcp__(a|b){1,2},x}"/'

describe('B: footprint.mjs', () => {
  const bin = H.tmpDir()
  H.writeStubClaude(bin, {
    version: '2.1.288',
    validate: {
      'fable-pin': FABLE_PIN_VALIDATE,
      'image-peek': IMAGE_PEEK_VALIDATE,
      'probe-mod': PROBE_MOD_VALIDATE,
      'quiet-mod': validateReport(['./register.ts hooks: session.start', './register.ts calls: nothing on $']),
      'odd-mod': validateReport(['./register.ts hooks: session.start', './register.ts calls: $.ui.log, $.zzz.nope']),
      'regex-mod': validateReport([`./register.ts hooks: tool.call{tool=${REGEX_MATCHER}}, session.start`, './register.ts calls: $.ui.log'])
    }
  })
  const env = H.stubEnv(bin, { CLAUDE_CONFIG_DIR: path.join(H.tmpDir(), 'config') })
  const root = H.tmpDir()
  const modDir = name => name === 'probe-mod' ? H.probeModDir() : H.writeFiles(path.join(root, name), { '.claude-plugin/plugin.json': { name, version: '0.0.1' } })
  const fp = (name, args = []) => H.runScript('footprint.mjs', [modDir(name), ...args], { env })
  const line = (out, key) => out.split('\n').find(l => l.startsWith(`${key}: `))

  it('grades fable-pin L0, persists state, and runs validate --strict --json on the directory', () => {
    const r = fp('fable-pin')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(line(r.stdout, 'validate'), 'validate: passed')
    assert.equal(line(r.stdout, 'hooks'), 'hooks: session.start, command.run{command=fable-pin}, agent.spawn')
    assert.equal(line(r.stdout, 'calls'), 'calls: $.command.register, $.store.get, $.store.set')
    assert.equal(line(r.stdout, 'reach'), 'reach: L0 draws and remembers (persists state)')
    assert.equal(line(r.stdout, 'sees'), 'sees: subagent spawns')
    const call = H.stubCalls(bin).find(c => c.args[0] === 'plugin' && c.args[1] === 'validate' && c.args.at(-1) === path.join(root, 'fable-pin'))
    assert.deepEqual(call.args, ['plugin', 'validate', '--strict', '--json', path.join(root, 'fable-pin')])
    assert.equal(call.flag, false)
  })

  it('grades image-peek L2 with every call graded', () => {
    const r = fp('image-peek')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(line(r.stdout, 'reach'), 'reach: L2 writes or runs or drives Claude (runs processes, reads env vars, persists state, draws)')
    assert.equal(line(r.stdout, 'env reads'), 'env reads: CLAUDE_CODE_FORCE_TERMINAL_IMAGES, GHOSTTY_RESOURCES_DIR, HERDR_ENV, TERM_PROGRAM')
    assert.equal(line(r.stdout, 'sees'), 'sees: the prompt box, compaction, what AbovePrompt shows, what Pane shows')
    assert.doesNotMatch(r.stdout, /^ungraded:/m)
  })

  it('grades assets/probe-mod L1 with its env read and state key', () => {
    const r = fp('probe-mod')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(line(r.stdout, 'reach'), 'reach: L1 reads (reads env vars, persists state, draws)')
    assert.equal(line(r.stdout, 'env reads'), 'env reads: MOD_BUILDER_PROBE')
    assert.equal(line(r.stdout, 'env writes'), 'env writes: nothing')
    assert.equal(line(r.stdout, 'state reads'), 'state reads: probe-mod.runs')
    assert.equal(line(r.stdout, 'state writes'), 'state writes: probe-mod.runs')
    assert.equal(line(r.stdout, 'hooks'), 'hooks: session.start, command.run{command=probe-mod}')
  })

  it('grades a mod with "calls: nothing on $" L0 with no label', () => {
    const r = fp('quiet-mod')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(line(r.stdout, 'calls'), 'calls: nothing on $')
    assert.equal(line(r.stdout, 'reach'), 'reach: L0 draws and remembers')
    assert.equal(line(r.stdout, 'sees'), 'sees: nothing beyond the events listed')
  })

  it('prints an unknown method as ungraded and exits 1; it never lifts silently', () => {
    const r = fp('odd-mod')
    assert.equal(r.code, 1)
    assert.match(r.stdout, /^ungraded: \$\.zzz\.nope \(grade by hand from its doc comment in the types; add a rule\)$/m)
    assert.equal(line(r.stdout, 'reach'), 'reach: L0 draws and remembers (draws)')
  })

  it('--plan that matches prints "plan and footprint match" and exits 0', () => {
    const r = fp('fable-pin', ['--plan', '$.command.register, $.store.get, store.set'])
    assert.equal(r.code, 0, r.stdout)
    assert.match(r.stdout, /^plan and footprint match$/m)
    assert.doesNotMatch(r.stdout, /WIDER THAN PLAN|outside plan|planned but unused/)
  })

  it('a call outside --plan is WIDER THAN PLAN and exits 1', () => {
    const r = fp('fable-pin', ['--plan', '$.command.register, $.store.get'])
    assert.equal(r.code, 1)
    assert.match(r.stdout, /^WIDER THAN PLAN: \$\.store\.set\. /m)
    assert.doesNotMatch(r.stdout, /plan and footprint match/)
  })

  it('an env read outside --env is "env outside plan" and exits 1', () => {
    const plan = ['--plan', '$.command.register, $.env.get, $.state.get, $.state.set, $.ui.log', '--state', 'probe-mod.runs']
    const r = fp('probe-mod', plan)
    assert.equal(r.code, 1)
    assert.match(r.stdout, /^env outside plan: MOD_BUILDER_PROBE$/m)
    assert.doesNotMatch(r.stdout, /WIDER THAN PLAN|state outside plan/)
    const ok = fp('probe-mod', [...plan, '--env', 'MOD_BUILDER_PROBE'])
    assert.equal(ok.code, 0, ok.stdout)
    assert.match(ok.stdout, /^plan and footprint match$/m)
  })

  it('"planned but unused" is reported and exits 0: it is not a widening', () => {
    const r = fp('fable-pin', ['--plan', '$.command.register, $.store.get, $.store.set, $.ui.log', '--env', 'HOME'])
    assert.equal(r.code, 0, r.stdout)
    assert.match(r.stdout, /^planned but unused: \$\.ui\.log, HOME\. Drop them from the plan\.$/m)
  })

  it('a regex matcher with braces, a bar and a comma survives parsing', () => {
    const parsed = parseValidateJson(validateReport([`./register.ts hooks: tool.call{tool=${REGEX_MATCHER}}, session.start`]))
    assert.deepEqual(parsed.hooks, [{ event: 'tool.call', matcher: { tool: REGEX_MATCHER } }, { event: 'session.start', matcher: {} }])
    const r = fp('regex-mod')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(line(r.stdout, 'hooks'), `hooks: tool.call{tool=${REGEX_MATCHER}}, session.start`)
    assert.equal(line(r.stdout, 'sees'), `sees: ${REGEX_MATCHER} calls`)
  })

  it('footprint() takes a hook with no matcher as null or {} alike', () => {
    const base = { success: true, errors: [], warnings: [], notes: [], calls: [], envReads: [], envWrites: [], stateReads: [], stateWrites: [], surfaces: [] }
    const a = fpBuild({ ...base, hooks: [{ event: 'tool.call', matcher: null }, { event: 'session.start', matcher: null }] })
    const b = fpBuild({ ...base, hooks: [{ event: 'tool.call', matcher: {} }, { event: 'session.start' }] })
    assert.deepEqual(a.lines, b.lines)
    assert.ok(a.lines.includes('hooks: tool.call, session.start'))
    assert.ok(a.lines.includes('sees: every tool call'))
  })

  it('a dir with no manifest is a tooling error, exit 2', () => {
    const r = H.runScript('footprint.mjs', [H.tmpDir()], { env })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /no \.claude-plugin\/plugin\.json/)
  })

  it('grades the spawn, append and deprecated methods the rules call out', () => {
    const rules = fpRules()
    assert.deepEqual(fpGrade(['$.process.spawn'], rules), { level: 2, name: 'writes or runs or drives Claude', labels: ['runs processes'], ungraded: [] })
    assert.deepEqual(fpGrade(['$.session.append'], rules), { level: 2, name: 'writes or runs or drives Claude', labels: ['drives Claude'], ungraded: [] })
    assert.deepEqual(fpGrade(['$.session.surface'], rules), { level: 0, name: 'draws and remembers', labels: [], ungraded: [] })
    assert.deepEqual(fpGrade(['$.ui.selection'], rules), { level: 1, name: 'reads', labels: ['reads the transcript'], ungraded: [] })
  })

  it('reach rules name only methods in data/api-map.json and grade every one of them', () => {
    const rules = fpRules()
    const methods = new Set(methodNames(BASELINE).map(m => m.slice(2)))
    const nouns = new Set(Object.keys(BASELINE.methods))
    // ui.selection arrived in 2.1.288, after the 2.1.287 baseline.
    const since = BASELINE.version === '2.1.287' ? new Set(['ui.selection']) : new Set()
    for (const { pattern, level, label } of rules) {
      assert.ok([0, 1, 2, 3].includes(level), pattern)
      assert.ok(label === null || typeof label === 'string', pattern)
      if (pattern.endsWith('.*')) assert.ok(nouns.has(pattern.slice(0, -2)), `${pattern}: no such noun`)
      else assert.ok(methods.has(pattern) || since.has(pattern), `${pattern}: no such method in api-map.json`)
    }
    assert.deepEqual(methodNames(BASELINE).filter(m => !fpRuleFor(m, rules)), [])
  })
})

// =====================================================================================
// Package C: prove.mjs
// =====================================================================================

const { spawnSync: spawnC } = await import('node:child_process')

// A stub tsc beside the stub claude: `--version` prints 5.9.3; STUB_TSC=fail prints one error and exits 2.
const STUB_TSC = String.raw`#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const args = process.argv.slice(2)
fs.appendFileSync(path.join(__dirname, 'tsc-calls.jsonl'), JSON.stringify({ args, cwd: process.cwd() }) + '\n')
if (args[0] === '--version') { process.stdout.write('Version 5.9.3\n'); return }
if (process.env.STUB_TSC === 'fail') { process.stdout.write("hooks/register.ts(5,11): error TS2322: Type 'string' is not assignable to type 'number'.\n"); process.exitCode = 2 }
`

const DEMO_VALIDATE = {
  success: true, strict: true,
  manifest: { type: 'plugin', errors: [], warnings: [], notes: [] },
  contents: [{ type: 'hooks', errors: [], warnings: [], notes: [
    './register.ts hooks: session.start, command.run{command=demo-mod}',
    './register.ts calls: $.command.register, $.ui.log'
  ] }]
}

const demoMod = (dir, extra = {}) => H.writeFiles(dir, {
  '.claude-plugin/plugin.json': { name: 'demo-mod', version: '0.0.1', description: 'prove fixture', author: { name: 'test' } },
  'hooks/hooks.json': { modules: ['./register.ts'] },
  'hooks/register.ts': "import type { Register } from 'claude-code'\nexport const register: Register = on => {\n  on('session.start', ($, e, next) => next(e))\n}\n",
  'tests/demo.test.ts': "import { test } from 'claude-code/testing'\ntest('runs', async () => {})\n",
  ...extra
})

describe('C: prove.mjs (stub claude)', () => {
  const setup = ({ config = {}, files = {}, noTests = false, envExtra = {} } = {}) => {
    const bin = H.tmpDir()
    H.writeStubClaude(bin, {
      version: '2.1.288', test: 'pass', list: [], validate: { 'demo-mod': DEMO_VALIDATE },
      ...config,
      rules: [{ match: '^plugin test --help$', stdout: 'Usage: claude plugin test [dir]' }, ...(config.rules || [])],
      load: { typesFrom: H.synthTypes(BASELINE, H.tmpDir(), { version: '2.1.288' }), ...(config.load || {}) }
    })
    fs.writeFileSync(path.join(bin, 'tsc'), STUB_TSC, { mode: 0o755 })
    const root = H.tmpDir()
    const mod = demoMod(path.join(root, 'demo-mod'), files)
    if (noTests) fs.rmSync(path.join(mod, 'tests'), { recursive: true })
    const realHome = path.join(root, 'real-home')
    fs.mkdirSync(path.join(realHome, '.claude', 'projects'), { recursive: true })
    fs.writeFileSync(path.join(realHome, '.claude.json'), '{ "projects": {} }\n')
    fs.writeFileSync(path.join(realHome, '.claude', 'settings.json'), '{}\n')
    const home = path.join(root, 'home')
    const env = H.stubEnv(bin, { MOD_BUILDER_HOME: home, MOD_BUILDER_REAL_HOME: realHome, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1', ...envExtra })
    return { bin, mod, home, realHome, env }
  }
  const prove = (s, args = []) => H.runScript('prove.mjs', [s.mod, ...args], { env: s.env })
  const block = out => Object.fromEntries(out.split('\n').slice(1, 10).map(l => l.match(/^([a-z -]+):\s+(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
  const runDir = out => out.split('\n')[0].match(/, run (.*)$/)[1].replace(/^~/, process.env.HOME)

  it('runs every default stage in an isolated copy and prints the block', () => {
    const s = setup({ files: { 'node_modules/x/index.js': 'x', '.git/HEAD': 'ref', '.claude-plugin/types/old.d.ts': '// old' } })
    const before = hashTree(s.mod)
    const r = prove(s)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    const lines = r.stdout.split('\n')
    assert.match(lines[0], /^proof: demo-mod on Claude Code 2\.1\.288 \(types line 1; PATH binary\), run .*\/runs\/\d{8}-\d{6}-demo-mod$/)
    const b = block(r.stdout)
    assert.deepEqual(Object.keys(b), ['validate', 'load', 'typecheck', 'test', 'command', 'interactive', 'install-smoke', 'isolation', 'ui evidence'])
    assert.equal(lines[1], 'validate:      ran and passed             evidence/validate.json; no plan given; reach L0 draws and remembers (draws)')
    assert.equal(b.load, 'ran and passed             evidence/load.log: hooks module demo-mod@inline loaded; events: session.start')
    assert.equal(b.typecheck, 'ran and passed             evidence/tsc.txt (tsc 5.9.3)')
    assert.equal(b.test, 'ran and passed (2 pass, 0 fail)   evidence/test.txt')
    assert.equal(b.command, `unverified (harness home not logged in: run CLAUDE_CONFIG_DIR=${path.join(s.home, 'config')} claude auth login once)`)
    assert.equal(b.interactive, 'not applicable (draws nothing)')
    assert.equal(b['install-smoke'], 'not applicable (not requested)')
    assert.equal(b.isolation, 'ran and passed             source unchanged, no real config touched')
    assert.equal(b['ui evidence'], 'not applicable')

    const run = runDir(r.stdout)
    assert.equal(fs.readFileSync(path.join(run, 'status.txt'), 'utf8'), lines.slice(0, 10).join('\n') + '\n')
    for (const f of ['source.sha256', 'run.json', 'evidence/validate.json', 'evidence/footprint.txt', 'evidence/load.log', 'evidence/load-lines.txt', 'evidence/tsc.txt', 'evidence/test.txt', 'evidence/command.out', 'evidence/isolation.txt', 'evidence/commands.txt']) {
      assert.ok(fs.existsSync(path.join(run, f)), f)
    }
    const j = H.readJson(path.join(run, 'run.json'))
    assert.equal(j.exit, 0)
    assert.equal(j.stages.typecheck.word, 'ran and passed')
    assert.equal(j.typesVersion, '2.1.288')
    for (const gone of ['node_modules', '.git', '.claude-plugin/types/old.d.ts']) assert.ok(!fs.existsSync(path.join(run, 'mod', gone)), gone)
    assert.doesNotMatch(fs.readFileSync(path.join(run, 'source.sha256'), 'utf8'), /node_modules|\.git\/|old\.d\.ts/)
    assert.deepEqual(hashTree(s.mod), before)
    assert.ok(!fs.existsSync(path.join(s.mod, 'tsconfig.json')))

    const calls = H.stubCalls(s.bin)
    assert.ok(calls.length >= 5)
    for (const c of calls) {
      assert.equal(c.configDir, path.join(s.home, 'config'), c.args.join(' '))
      assert.equal(c.flag, false)
    }
    for (const c of calls.filter(c => c.args[0] === '-p')) {
      assert.ok(c.args.includes('--strict-mcp-config'))
      assert.equal(c.cwd, run)
    }
    assert.ok(calls.some(c => c.args.join(' ') === `-p /demo-mod --plugin-dir ${path.join(run, 'mod')} --debug-file ${path.join(run, 'evidence', 'command.log')} --strict-mcp-config`))
  })

  it('reads interactive unverified for a mod that draws and no --interactive script', () => {
    const notes = (hooks, calls) => ({ ...DEMO_VALIDATE, contents: [{ type: 'hooks', errors: [], warnings: [], notes: [`./register.ts hooks: ${hooks}`, `./register.ts calls: ${calls}`] }] })
    const render = setup({ config: { validate: { 'demo-mod': notes('session.start, ui.render{component=AbovePrompt}', '$.ui.log') } } })
    const r = prove(render)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.equal(block(r.stdout).interactive, 'unverified (the mod draws; no --interactive script was run)')
    assert.equal(block(r.stdout)['ui evidence'], 'unverified (the mod draws; no --interactive script was run)')
    const open = setup({ config: { validate: { 'demo-mod': notes('session.start', '$.ui.open, $.ui.log') } } })
    assert.equal(block(prove(open).stdout).interactive, 'unverified (the mod draws; no --interactive script was run)')
    const toast = setup({ config: { validate: { 'demo-mod': notes('session.start', '$.ui.toast') } } })
    const t = block(prove(toast).stdout)
    assert.equal(t.interactive, 'not applicable (no ui.render hook or $.ui.open call)')
    assert.equal(t['ui evidence'], 'unverified (the mod draws; no --interactive script was run)')
  })

  it('reads not applicable with no test files and never calls plugin test on the mod', () => {
    const s = setup({ noTests: true })
    const r = prove(s)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.equal(block(r.stdout).test, 'not applicable (no test files)')
    assert.ok(!H.stubCalls(s.bin).some(c => c.args[0] === 'plugin' && c.args[1] === 'test' && c.args[2] !== '--help'))
  })

  it('checks a stale tsconfig through evidence/tsconfig.json and says so', () => {
    const s = setup({ files: { 'tsconfig.json': { compilerOptions: { types: [] }, include: ['.claude/types', 'hooks', 'tests'] } } })
    const r = prove(s)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.equal(block(r.stdout).typecheck, "ran and passed             evidence/tsc.txt (tsc 5.9.3); the mod's tsconfig.json does not extend ./.claude-plugin/types/tsconfig.json, checked with evidence/tsconfig.json")
    const run = runDir(r.stdout)
    assert.deepEqual(H.readJson(path.join(run, 'evidence', 'tsconfig.json')), { extends: '../mod/.claude-plugin/types/tsconfig.json' })
    const tsc = fs.readFileSync(path.join(s.bin, 'tsc-calls.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).find(c => c.args[0] === '-p')
    assert.deepEqual(tsc.args, ['-p', path.join('..', 'evidence', 'tsconfig.json'), '--pretty', 'false'])
    assert.equal(fs.realpathSync(tsc.cwd), fs.realpathSync(path.join(run, 'mod')))
  })

  it('fails typecheck on a type error, stops there, and --continue runs the rest', () => {
    const s = setup({ envExtra: { STUB_TSC: 'fail' } })
    const r = prove(s)
    assert.equal(r.code, 1)
    const b = block(r.stdout)
    assert.equal(b.typecheck, "ran and FAILED (hooks/register.ts(5,11): error TS2322: Type 'string' is not assignable to type 'number'.)   evidence/tsc.txt (tsc 5.9.3)")
    assert.equal(b.test, 'unverified (not run: typecheck FAILED; --continue runs the rest)')
    assert.equal(b.command, 'unverified (not run: typecheck FAILED; --continue runs the rest)')
    assert.match(b.isolation, /^ran and passed/)
    const c = block(prove(s, ['--continue']).stdout)
    assert.match(c.typecheck, /^ran and FAILED/)
    assert.equal(c.test, 'ran and passed (2 pass, 0 fail)   evidence/test.txt')
  })

  it('fails load on a refusal and on a skipped hook', () => {
    const s = setup({ config: { load: { refuse: 'only managed plugins and built-in plugins run (allowManagedHooksOnly / disableAllHooks)' } } })
    const b = block(prove(s).stdout)
    assert.equal(b.load, 'ran and FAILED (hooks module demo-mod@inline not loaded: only managed plugins and built-in plugins run (allowManagedHooksOnly / disableAllHooks))   evidence/load.log')
    assert.equal(b.typecheck, 'unverified (not run: load FAILED; --continue runs the rest)')
    const t = setup({ config: { load: { extraLog: ['<name>: session.start hook skipped: threw Error: boom'] } } })
    assert.equal(block(prove(t).stdout).load, 'ran and FAILED (demo-mod: session.start hook skipped: threw Error: boom)   evidence/load.log')
  })

  it('fails validate when the footprint is wider than the plan', () => {
    const s = setup()
    const r = prove(s, ['--plan', '$.ui.log'])
    assert.equal(r.code, 1)
    assert.match(block(r.stdout).validate, /^ran and FAILED \(WIDER THAN PLAN: \$\.command\.register\. .*\)   evidence\/footprint\.txt$/)
    assert.equal(block(prove(s, ['--plan', '$.ui.log, $.command.register']).stdout).validate, 'ran and passed             evidence/validate.json; plan and footprint match')
  })

  it('proves the command when the harness home is logged in, and fails it when no hook settles', () => {
    const settled = 'hooks module <name>@inline command.run settled in 0.5ms (worker hop, next() included)'
    const s = setup({ config: { auth: { loggedIn: true }, load: { reply: 'demo-mod: 3 runs', extraLog: [settled] } } })
    assert.equal(block(prove(s).stdout).command, 'ran and passed             evidence/command.out: "demo-mod: 3 runs"; command.log: demo-mod@inline command.run settled')
    const t = setup({ config: { auth: { loggedIn: true } } })
    assert.equal(block(prove(t).stdout).command, 'ran and FAILED (no "hooks module demo-mod@inline command.run settled" line in the log)   evidence/command.out, evidence/command.log')
    const u = setup({ config: { auth: { loggedIn: true }, load: { extraLog: ['<name> registered /demo-mod but no command.run hook answered it'] } } })
    assert.match(block(prove(u).stdout).command, /^ran and FAILED \(demo-mod registered \/demo-mod but no command\.run hook answered it\)/)
  })

  it('exits 3 on the third identical failure; a changed source starts over', () => {
    const s = setup({ config: { test: 'fail' } })
    assert.equal(prove(s).code, 1)
    assert.equal(prove(s).code, 1)
    const third = prove(s)
    assert.equal(third.code, 3)
    assert.match(third.stdout, /^three strikes on test: stop and report$/m)
    assert.match(block(third.stdout).test, /^ran and FAILED \(1 pass, 1 fail; \(fail\) fails on purpose/)
    const strikes = H.readJson(path.join(s.home, 'strikes.json'))
    const [entry] = Object.values(strikes)
    assert.equal(entry.count, 3)
    assert.match(entry.signature, /^test:1 pass, 1 fail; \(fail\) fails on purpose$/)
    fs.appendFileSync(path.join(s.mod, 'hooks', 'register.ts'), '// changed\n')
    assert.equal(prove(s).code, 1)
    assert.deepEqual(Object.values(H.readJson(path.join(s.home, 'strikes.json'))).map(e => e.count), [1])
    H.setStubConfig(s.bin, { version: '2.1.288', test: 'pass', rules: [{ match: '^plugin test --help$', stdout: 'Usage' }], validate: { 'demo-mod': DEMO_VALIDATE }, load: { typesFrom: H.synthTypes(BASELINE, H.tmpDir(), { version: '2.1.288' }) } })
    assert.equal(prove(s).code, 0)
    assert.deepEqual(H.readJson(path.join(s.home, 'strikes.json')), {})
  })

  it('fails isolation when a log names the real config or a foreign provenance', () => {
    const s = setup()
    H.setStubConfig(s.bin, { version: '2.1.288', test: 'pass', rules: [{ match: '^plugin test --help$', stdout: 'Usage' }], validate: { 'demo-mod': DEMO_VALIDATE }, load: { typesFrom: H.synthTypes(BASELINE, H.tmpDir()), extraLog: [`reading ${s.realHome}/.claude/settings.json`] } })
    const r = prove(s)
    assert.equal(r.code, 1)
    assert.match(block(r.stdout).isolation, /^ran and FAILED \(evidence\/command\.log:\d+ names the real config: reading .*\/real-home\/\.claude\/settings\.json\)   evidence\/isolation\.txt$/)
    const t = setup({ config: { load: { extraLog: ['hooks module stray@some-mkt loaded (worker, environment 2, tier user); events: session.start'] } } })
    assert.match(block(prove(t).stdout).isolation, /^ran and FAILED \(evidence\/load\.log loaded stray@some-mkt, not from --plugin-dir, built in, or the temp marketplace\)/)
  })

  it('blocks with exit 2 on each precondition', () => {
    assert.equal(prove(setup({ config: { version: '2.1.280' } })).code, 2)
    const below = prove(setup({ config: { version: '2.1.280' } }))
    assert.match(below.stderr, /below the floor 2\.1\.287/)
    const noHelp = setup()
    H.setStubConfig(noHelp.bin, { version: '2.1.288' })
    assert.match(prove(noHelp).stderr, /claude plugin test --help did not exit 0/)
    const s = setup()
    assert.match(H.runScript('prove.mjs', [path.dirname(s.mod)], { env: s.env }).stderr, /no readable \.claude-plugin\/plugin\.json/)
    assert.equal(H.runScript('prove.mjs', [path.dirname(s.mod)], { env: s.env }).code, 2)
    const missing = prove(s, ['--interactive', path.join(s.mod, 'nope.txt')])
    assert.equal(missing.code, 2)
    assert.match(missing.stderr, /cannot read --interactive/)
    const bad = path.join(H.tmpDir(), 'bad.script')
    fs.writeFileSync(bad, 'type hello\nclick here\n')
    assert.match(prove(s, ['--interactive', bad]).stderr, /bad\.script:2: unknown line "click here"/)
    if (!IS_WIN) {
      const nodeOnly = H.tmpDir()
      fs.symlinkSync(process.execPath, path.join(nodeOnly, 'node'))
      const good = path.join(H.tmpDir(), 'ok.script')
      fs.writeFileSync(good, 'screen\n')
      const noTmux = H.runScript('prove.mjs', [s.mod, '--interactive', good], { env: { ...s.env, PATH: `${s.bin}${path.delimiter}${nodeOnly}` } })
      assert.equal(noTmux.code, 2)
      assert.match(noTmux.stderr, /--interactive needs tmux/)
      const open = setup()
      fs.mkdirSync(open.home, { recursive: true, mode: 0o755 })
      fs.chmodSync(open.home, 0o755)
      assert.match(prove(open).stderr, /open to group or other/)
    }
  })

  it('runs install-smoke only with --install, under the harness config, and removes what it added', () => {
    const ok = { stdout: 'done' }
    const s = setup({ config: { rules: [
      { match: '^plugin marketplace add ', ...ok }, { match: '^plugin install ', ...ok },
      { match: '^plugin uninstall ', ...ok }, { match: '^plugin marketplace remove ', ...ok }
    ] } })
    const r = prove(s, ['--install'])
    assert.equal(r.code, 1)
    assert.match(block(r.stdout)['install-smoke'], /^ran and FAILED \(no "hooks module demo-mod@mod-builder-smoke-\d{14} loaded" line in the log; exit 1\)   evidence\/install\.log$/)
    const run = runDir(r.stdout)
    const mkt = H.readJson(path.join(run, 'marketplace', '.claude-plugin', 'marketplace.json'))
    assert.deepEqual(mkt.plugins.map(p => [p.name, p.source]), [['demo-mod', './plugins/demo-mod']])
    const seq = H.stubCalls(s.bin).map(c => c.args).filter(a => a[0] === 'plugin' && a[1] !== 'validate' && a[1] !== 'test' || (a[0] === '-p' && !a.includes('--plugin-dir')))
    assert.deepEqual(seq.map(a => a.slice(0, 3).join(' ')), ['plugin marketplace add', `plugin install demo-mod@${mkt.name}`, '-p ok --debug-file', `plugin uninstall demo-mod@${mkt.name}`, 'plugin marketplace remove'])
    assert.ok(H.stubCalls(s.bin).every(c => c.configDir === path.join(s.home, 'config')))
    assert.equal(block(prove(s).stdout)['install-smoke'], 'not applicable (not requested)')
  })

  const tmuxSkip = IS_WIN ? 'Windows' : spawnC('tmux', ['-V']).status === 0 ? false : 'tmux missing'
  it('drives a session in a private tmux server, masks keys, and kills the server', { skip: tmuxSkip }, () => {
    const s = setup({ config: { auth: { loggedIn: true }, validate: { 'demo-mod': { ...DEMO_VALIDATE, contents: [{ type: 'hooks', errors: [], warnings: [], notes: ['./register.ts hooks: ui.render{component=AbovePrompt}', './register.ts calls: $.ui.log'] }] } } } })
    // A fake interactive claude: one theme screen, then a prompt that echoes what it is sent.
    const fake = H.tmpDir()
    fs.writeFileSync(path.join(fake, 'claude'), String.raw`#!/usr/bin/env node
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path')
const args = process.argv.slice(2)
if (args.includes('-p') || ['plugin', 'auth', '--version'].includes(args[0])) {
  const r = spawnSync(process.execPath, [${JSON.stringify(path.join(s.bin, 'claude'))}, ...args], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}
const log = args[args.indexOf('--debug-file') + 1]
const name = JSON.parse(fs.readFileSync(path.join(args[args.indexOf('--plugin-dir') + 1], '.claude-plugin', 'plugin.json'), 'utf8')).name
process.stdout.write(process.env.FAKE_FIRST === 'login' ? 'Select login method:\n' : 'Choose the text style that looks best with your terminal\n')
let ready = false, buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', d => {
  buf += d
  for (let i; (i = buf.search(/[\r\n]/)) >= 0;) {
    const line = buf.slice(0, i).replace(/\x1b/g, '').trim(); buf = buf.slice(i + 1)
    if (!ready) { ready = true; process.stdout.write('\x1b[2J\x1b[H'); fs.writeFileSync(log, 'x [DEBUG] hooks module ' + name + '@inline loaded (worker, environment 1, tier user); events: ui.render\n'); process.stdout.write('? for shortcuts\n'); continue }
    if (line === '/exit') process.exit(0)
    if (line) process.stdout.write('you typed: ' + line + ' sk-ant-api03-secretsecret\n')
  }
})
`, { mode: 0o755 })
    const script = path.join(H.tmpDir(), 'drive.script')
    fs.writeFileSync(script, '# drive the fake\ntype hello\nexpect you typed: hello\nscreen\n')
    const env = { ...s.env, PATH: `${fake}${path.delimiter}${s.env.PATH}` }
    const r = H.runScript('prove.mjs', [s.mod, '--interactive', script], { env })
    const b = block(r.stdout)
    assert.equal(b.interactive, 'ran and passed             evidence/interactive.log, evidence/screen-02.txt (1 expect matched)', r.stdout + r.stderr)
    assert.equal(b['ui evidence'], 'drawn and driven (screen-02.txt)')
    const run = runDir(r.stdout)
    const screen = fs.readFileSync(path.join(run, 'evidence', 'screen-01.txt'), 'utf8')
    assert.match(screen, /you typed: hello sk-ant-\[masked\]/)
    assert.doesNotMatch(screen + fs.readFileSync(path.join(run, 'evidence', 'stream.raw'), 'latin1'), /secretsecret/)
    assert.ok(fs.existsSync(path.join(run, 'evidence', 'screen-01.ansi')))
    const sock = H.readJson(path.join(run, 'run.json')).tmuxSocket
    assert.match(sock, /^mod-builder-\d+$/)
    assert.notEqual(spawnC('tmux', ['-L', sock, 'has-session']).status, 0)

    const login = H.runScript('prove.mjs', [s.mod, '--interactive', script], { env: { ...env, FAKE_FIRST: 'login' } })
    assert.equal(block(login.stdout).interactive, 'unverified (harness home not logged in)')
    assert.equal(block(login.stdout)['ui evidence'], 'unverified (harness home not logged in)')
  })
})

describe('C: live prove (real claude)', { skip: liveSkip }, () => {
  const encode = p => p.replace(/[^a-zA-Z0-9]/g, '-')
  const projects = () => { try { return fs.readdirSync(path.join(process.env.HOME, '.claude', 'projects')) } catch { return [] } }
  const env = () => ({ ...process.env, MOD_BUILDER_HOME: path.join(H.tmpDir(), 'home') })
  const block = out => Object.fromEntries(out.split('\n').slice(1, 10).map(l => l.match(/^([a-z -]+):\s+(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
  const check = (mod, args, e) => {
    const before = hashTree(mod)
    const listed = projects()
    const r = H.runScript('prove.mjs', [mod, ...args], { env: e })
    assert.deepEqual(hashTree(mod), before, 'source tree changed')
    const home = e.MOD_BUILDER_HOME
    const gained = projects().filter(p => !listed.includes(p))
    assert.deepEqual(gained.filter(p => p.startsWith(encode(home)) || p.startsWith(encode(fs.realpathSync(home)))), [], 'the real ~/.claude/projects gained an entry for the harness')
    return { r, b: block(r.stdout) }
  }

  it('passes validate, load, typecheck, test and isolation on the probe mod', () => {
    const { r, b } = check(H.probeModDir(), [], env())
    assert.ok([0].includes(r.code), r.stdout + r.stderr)
    for (const s of ['validate', 'load', 'typecheck', 'test', 'isolation']) assert.match(b[s], /^ran and passed/, `${s}: ${b[s]}`)
    assert.match(r.stdout.split('\n')[0], /^proof: probe-mod on Claude Code \d+\.\d+\.\d+ \(types line 1; /)
  })

  it('fails only typecheck on a mod with a deliberate type error', () => {
    const mod = demoMod(path.join(H.tmpDir(), 'type-error-mod'), {
      '.claude-plugin/plugin.json': { name: 'type-error-mod', version: '0.0.1', description: 'prove fixture with a type error', author: { name: 'test' } },
      'hooks/register.ts': "import type { Register } from 'claude-code'\n\nexport const register: Register = on => {\n  on('session.start', ($, e, next) => {\n    const count: number = 'one'\n    $.ui.log(`type-error-mod: ${count}`, { to: 'debug' })\n    return next(e)\n  })\n}\n",
      'tests/demo.test.ts': "import { expect, test } from 'claude-code/testing'\n\ntest('logs on session start', async ($, on) => {\n  on('session.start', ($, e) => ({ cwd: e.cwd }))\n  const logs: string[] = []\n  on('ui.log', ($, e) => { logs.push(e.text); return { value: undefined } })\n  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })\n  expect(logs).toEqual(['type-error-mod: one'])\n})\n"
    })
    const { r, b } = check(mod, ['--continue'], env())
    assert.equal(r.code, 1, r.stdout + r.stderr)
    assert.match(b.typecheck, /^ran and FAILED \(hooks\/register\.ts\(5,11\): error TS2322: /)
    for (const s of ['validate', 'load', 'test', 'isolation']) assert.match(b[s], /^ran and passed/, `${s}: ${b[s]}`)
  })
})
