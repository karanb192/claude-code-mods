#!/usr/bin/env node
// Fetches the nightly scan of every Claude Mod on GitHub and prints one line per mod, so an idea
// can be checked against what already exists before it is proposed.
//
//   node list-mods.mjs [keyword ...]     keywords match name, description, hooked events and $ calls
//   node list-mods.mjs --json            the raw mods array
//
// Data: https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/data/mods.json
const URL = 'https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/data/mods.json'

const args = process.argv.slice(2)
const json = args.includes('--json')
const words = args.filter(a => !a.startsWith('--')).map(w => w.toLowerCase())

const res = await fetch(URL)
if (!res.ok) { console.error(`fetch failed: ${res.status} ${res.statusText}`); process.exit(1) }
const data = await res.json()
const mods = data.mods.filter(m => m.kind === 'mod')

const text = m => [m.name, m.description, ...m.hooks.map(h => h.event), ...m.calls].join(' ').toLowerCase()
const hits = words.length ? mods.filter(m => words.every(w => text(m).includes(w))) : mods

if (json) { console.log(JSON.stringify(hits, null, 2)); process.exit(0) }

console.log(`${data.generated}, Claude Code ${data.claudeVersion}: ${mods.length} mods on GitHub${words.length ? `, ${hits.length} match "${words.join(' ')}"` : ''}`)
for (const m of hits.sort((a, b) => b.stars - a.stars)) {
  const events = [...new Set(m.hooks.map(h => h.event))].join(' ')
  const sees = m.sees.length ? ` sees ${m.sees.join(', ')}` : ''
  console.log(`\n${m.name}  L${m.reach.level} ${m.reach.name}${m.reach.labels.length ? ' (' + m.reach.labels.join(', ') + ')' : ''}  ${m.stars} stars  ${m.validate.status}`)
  console.log(`  ${m.url}`)
  console.log(`  hooks: ${events || '(none)'}${sees}`)
  console.log(`  calls: ${m.calls.join(', ') || '(none)'}`)
  console.log(`  ${m.description}`)
}
