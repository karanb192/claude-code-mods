# Threat model template

Five lines, one per question, written after the validator has printed the footprint. Fill each from the `calls:` and `hooks:` lines, not from the intent. A line that says "nothing" is a good line; leave it in, because the reader checks for the absence.

```
Threat model for <mod-name> (reach L<n>, <level name>)
1. Reads:    <files, env vars, settings, transcript, or "nothing beyond the event payload">
2. Runs:     <processes by argv, or "nothing">
3. Sends:    <hosts and what data, or "nothing leaves the machine">
4. Persists: <what goes into $.store or files, and for how long, or "nothing">
5. Hostile input: <what happens when the prompt, a tool result, a file, or a network reply is crafted to abuse this mod>
```

## How to answer line 5

The mod's input is whatever `e` carries plus whatever its `$` reads return. Assume every one of those is attacker-controlled:

- A hook on `prompt.submit` receives text the user pasted from anywhere.
- A hook on `tool.call` after `next(e)` receives tool output, including the contents of a file or a web page.
- A hook that reads a file with `$.fs.read` receives whatever the repository author put there.
- A hook that calls `$.http.fetch` receives whatever the server sends.

For each, ask: does the mod pass that text into `$.process.run` argv, into `$.fs.write` as a path or content, into `$.prompt.submit`, into `$.model.*`, or into a `$.http.fetch` URL or body? Every yes is a line 5 finding. Name the mitigation (allowlist, literal path, no interpolation) or accept the risk in writing.

## Examples

A redaction mod that hooks `tool.call` for Read, Grep and Bash and rewrites the result text:

```
Threat model for secret-scrub (reach L0, draws and remembers)
1. Reads:    the result text of Read, Grep and Bash calls, in memory only
2. Runs:     nothing
3. Sends:    nothing leaves the machine
4. Persists: a counter of redactions per session in $.store, cleared on session.start
5. Hostile input: a crafted tool result can only change what gets redacted; the regex set is fixed in source, so no input reaches a process, a file or the network
```

A CI watcher that polls GitHub:

```
Threat model for ci-watch (reach L3, network)
1. Reads:    $.session.repo to find the remote; nothing else
2. Runs:     nothing
3. Sends:    GET api.github.com/repos/<owner>/<repo>/actions/runs every 30 s with the token from $.session.authorize; the repo name is the only data sent
4. Persists: the last seen run id in $.store
5. Hostile input: a malicious API reply can only change the drawn text; run names are rendered as Text, never executed or written; if the repo name came from git config, it is validated against owner/name before it enters the URL
```

## Where it goes

Paste the five lines into the mod's README under a "What it can reach" heading, above the install steps. Keep it in sync with the validator: when the `calls:` line changes, the threat model changes in the same commit.
