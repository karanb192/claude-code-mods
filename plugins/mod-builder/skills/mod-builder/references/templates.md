# File templates

Copy these, then change the names. Every template validates on Claude Code 2.1.272 as written.

## `.claude-plugin/plugin.json`

```json
{
  "name": "MOD_NAME",
  "version": "0.1.0",
  "description": "ONE_SENTENCE. Needs function hooks (early access).",
  "author": { "name": "AUTHOR" },
  "license": "MIT"
}
```

The validator warns when `author` is missing. Keep the description honest about what the mod reaches; the scanner shows the description beside the footprint.

## `hooks/hooks.json`

```json
{
  "description": "MOD_NAME: EVENTS_HOOKED. Needs CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1; builds without function hooks ignore the modules key.",
  "modules": ["./register.ts"]
}
```

Classic `command`, `prompt`, `agent` and `http` hooks can sit in the same file beside `modules`.

## `hooks/register.ts`, the L0 shape

```ts
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    $.ui.log(`MOD_NAME loaded in ${e.cwd}`)
    return r
  })
}
```

Footprint: `hooks: session.start`, `calls: $.ui.log`. Reach L0.

## A `tool.call` guard with a matcher

```ts
on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
  if (typeof e.command === 'string' && e.command.includes('rm -rf /')) {
    return { deny: 'MOD_NAME refused it' }
  }
  return next(e)
})
```

The matcher keeps visibility to Bash calls. Without it the scanner records "sees every tool call".

## An after-hook that rewrites a result

```ts
on('tool.call', { tool: ['Read', 'Grep'] }, async ($, e, next) => {
  const r = await next(e)
  if (r && typeof r.text === 'string') return { ...r, text: scrub(r.text) }
  return r
})
```

## A hook with `.catch`

```ts
on('tool.call', async ($, e, next) => {
  const r = await next(e)
  await $.store.set('last', e.tool)
  return r
}).catch(($, e, next) => (next.called ? next(e) : { deny: next.error.kind }))
```

Without `.catch`, a throw or a 10 second overrun skips the hook with one dim line.

## A band above the prompt

```tsx
on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
  const { Box, Text } = await $.ui.resolve(e)
  const drawn = await next(e)
  const rows = Math.max(1, e.props.maxRows - 1)
  return (
    <Box>
      {drawn}
      <Text dimColor>{lines.slice(0, rows).join('\n')}</Text>
    </Box>
  )
})
```

Name the file `register.tsx`, add the tsconfig below, and never name a local variable `h`.

## `tsconfig.json`, only when the mod draws with JSX or you want `tsc`

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "types": [],
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment"
  },
  "include": [".claude/types", "hooks"]
}
```

Run `/plugin-types` in a session first; `.claude/types/` is git-ignored.

## `.gitignore`

```
.claude/types/
node_modules/
```

## README section, "What it can reach"

```markdown
## What it can reach

Validated on Claude Code VERSION:

    ❯ ./register.ts hooks: EVENTS
    ❯ ./register.ts calls: CALLS

Reach LEVEL. THREAT_MODEL_FIVE_LINES

![reach](https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/badges/OWNER--REPO--NAME-reach.svg)
![validates](https://raw.githubusercontent.com/karanb192/awesome-claude-code-mods/main/badges/OWNER--REPO--NAME-validates.svg)
```

The badges exist once the nightly scan has seen the public repo. To be seen sooner, add `owner/repo` to `data/seeds.txt` in the list repo by pull request.
