# Threat model template (Build step 7)

Five lines, one per question, written after the validator has printed the footprint. Fill each from the `hooks:`, `calls:`, `env reads:`, `env writes:`, `state reads:` and `state writes:` lines, not from the intent. A line that says "nothing" is a good line; leave it in, because the reader checks for the absence. Stamp legend: sources.md.

```
Threat model for <mod-name> (reach L<n>, <level name>)
1. Reads:    <files, env vars by name, settings, transcript, state keys, or "nothing beyond the event payload">
2. Runs:     <processes by argv, or "nothing">
3. Sends:    <hosts and what data, or "nothing leaves the machine">
4. Persists: <what goes into $.store, $.state or files, and for how long, or "nothing">
5. Hostile input: <what happens when the prompt, a tool result, a file, a message or a network reply is crafted to abuse this mod>
```

## How to answer line 5

The mod's input is whatever `e` carries plus whatever its `$` reads return. Assume every one of those is attacker-controlled:

- A hook on `prompt.submit` receives text the person pasted from anywhere.
- A hook on `tool.call` after `next(e)` receives tool output, including the contents of a file or a web page.
- A hook that reads a file with `$.fs.read` receives whatever the repository's author put there.
- A hook that calls `$.http.fetch` receives whatever the server sends; `$.mcp.call` returns whatever the server's tool returns; `$.process.run` returns whatever the program printed.
- A hook on `session.receive` receives a message from another session or a relay; its text and the sender's name are untrusted, whoever the sender claims to be. [src: docs api > Send and receive messages between sessions | checked 2.1.288 | recheck: gate prints drift touching SessionReceiveOrigin]
- A hook on `session.append` sees every row before it is stored, the model's own output and tool results included, and whatever it writes there the model reads on every later request. A `$.session.append` row is a user-role row the model reads. [src: docs reference > Session; docs admin > Review what a mod can do | checked 2.1.288 | recheck: gate prints drift touching SessionAppendArgs]
- Text the mod sends with `$.prompt.submit` and `asUser` reads to the model as the person's own words, with no line naming the mod. [src: docs api > Start a turn from a background job | checked 2.1.288 | recheck: gate prints drift touching PromptSubmitInput]
- Text the mod builds from repository files into `prompt.context`, `prompt.section` or a tool result's context is instruction-shaped input the repository's author controls.
- A policy mod reading `plugin.register`: the tier and the uses are the host's reading of the module, but the name, root, version and provenance are the plugin's own word, so a rule keyed on them is one a rename walks past. [src: d.ts PluginRegisterInput | checked 2.1.288 | recheck: gate prints drift touching PluginRegisterInput]

For each, ask: does the mod pass that text into `$.process.run` argv, into `$.fs.write` as a path or content, into `$.prompt.submit`, `$.session.send` or `$.session.append`, into `$.model.*`, into an approval from `tool.check`, or into a `$.http.fetch` URL or body? Every yes is a line 5 finding. Name the mitigation (allowlist, literal path, no interpolation, a path checked through `$.fs.stat` with `resolve` so its real path is known before a write) or accept the risk in writing. [src: d.ts FsStatOptions | checked 2.1.288 | recheck: gate prints drift touching FsStatOptions]

Two smells to flag in line 5 or in review: a hook on an event core must act on that never calls `next` (it answers in core's place every time), and a `tool.check` hook that answers allow.

## Policy facts a reader checks the mitigation against

- Mods are not sandboxed. A mod runs as the person, with their access to files, processes, the network, environment variables and settings. Sandboxing isolates the Bash commands Claude runs, not a process a mod starts. [src: docs overview > What a mod can reach; docs admin > Know which controls still apply | checked 2.1.288 | recheck: either page changes its sandbox line]
- The built-in guard (`cc-plugin-sec-default` in `/plugin`) loads ahead of every mod a person installs only on a machine with managed settings, or for a person signed in with a Team or Enterprise plan; API key and third-party provider users get it only with managed settings. Where it does not load, none of the next three facts applies. [src: docs admin > Know what happens by default | checked 2.1.288 | recheck: that section changes]
- Where the guard loads, a person's mod cannot approve a tool call that a `deny` rule refuses, in whichever settings file the rule sits, unless managed settings set `allowModsToOverrideDenyRules`; a block from a managed `PreToolUse` hook is final. A `tool.check` hook that tries is told `tried to lift a deny rule in your settings` and the call stays denied. [src: docs admin > Set options on the built-in guard; docs troubleshoot > A message about the deny rules in your settings | checked 2.1.288 | recheck: that message changes]
- A mod can approve a call that an `ask` rule would prompt for, or that a `PreToolUse` hook outside managed settings blocked. In auto mode a call the mod approves runs without a classifier check. [src: docs admin > Know what happens by default | checked 2.1.288 | recheck: that section changes]
- Deny rules and managed hooks cover Claude's tool calls, never a mod's own `$.fs` and `$.process` calls: with `Read(.env)` denied, a mod can still read that file or start a program that does. [src: docs admin > Know what happens by default | checked 2.1.288 | recheck: that section changes]
- Organisation network policy refuses a `$.http.fetch` when web fetching or nonessential traffic is off; it does not cover a program started with `$.process.run`, which reaches the network with the person's own access. [src: docs admin > Know which controls still apply | checked 2.1.288 | recheck: that section changes]
- `$.env.set` sets the variable for Claude Code and for every command and MCP server started after it. `$.env.get` and `$.settings.read` can read API keys. [src: docs admin > Review what a mod can do | checked 2.1.288 | recheck: that table changes]
- `$.session.authorize` hands back a handle, never the secret; `$.http.fetch` spends it only toward a first-party host, and it is null with a third-party provider, a gateway or no login. It is not a token for any other service. [src: d.ts session noun authorize, HttpInit | checked 2.1.288 | recheck: gate prints drift touching SessionAuthorization]
- `allowManagedModsOnly` refuses every mod a person brings (installed, `--plugin-dir`, written in a session); the organisation's own mods and the built-ins still load. `--safe-mode` turns every installed mod off, the organisation's included. [src: docs admin > Stop user-installed mods from loading; docs admin > Know which controls still apply | checked 2.1.288 | recheck: either section changes]
- A guard that matches command text is a reminder for Claude, not a hard block: a determined command gets past a pattern. Real enforcement is a permission rule or the server's own protection. Say so in the README's limitations. [src: docs events > Guard or change a tool call | checked 2.1.288 | recheck: that section drops the reminder line]
- The permission prompt cannot be restyled, but a mod can answer a call before the prompt appears. [src: docs admin > Know which controls still apply | checked 2.1.288 | recheck: that section changes]

The design gates in plan.md (annotate, draft or ask; no approvals) exist because of these facts, and each gate is a test (testing.md).

## Examples

A redaction mod that hooks `tool.call` for Read and Bash and rewrites the result text:

```
Threat model for secret-scrub (reach L0, draws and remembers)
1. Reads:    the result text of Read and Bash calls, in memory only
2. Runs:     nothing
3. Sends:    nothing leaves the machine
4. Persists: a counter of redactions per session in $.store, cleared on session.start
5. Hostile input: a crafted tool result can only change what gets redacted; the pattern set is fixed in source, so no input reaches a process, a file or the network
```

A CI watcher that polls GitHub for the current repository:

```
Threat model for ci-watch (reach L3, network)
1. Reads:    $.session.repo to find the remote; env GITHUB_TOKEN (read by literal name); nothing else
2. Runs:     nothing
3. Sends:    GET api.github.com/repos/<owner>/<repo>/actions/runs every 60 s, with GITHUB_TOKEN as the bearer token to that host only; the repo name is the only data sent
4. Persists: the last seen run id in $.store
5. Hostile input: a malicious API reply can only change the drawn text; run names are rendered as Text, never executed or written; the repo name from git config is checked against owner/name before it enters the URL
```

The session's own credential from `$.session.authorize` is never the token for GitHub: it is spent only toward a first-party host.

## Where it goes

Paste the five lines into the mod's README under "What it can reach", above the install steps. Keep it in sync with the validator: when the `calls:`, `env` or `state` lines change, the threat model changes in the same commit.
