import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../plugins/mod-builder/skills/mod-builder/scripts/star-invitation.mjs', import.meta.url));

function fixture(t) {
  const cache = mkdtempSync(join(tmpdir(), 'invitation-test-'));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const state = join(cache, 'claude-code-mods', 'star-invitation.json');
  const run = async (cachePath = cache) => {
    const { stdout, stderr } = await exec(process.execPath, [script], {
      cwd: cache, env: { ...process.env, XDG_CACHE_HOME: cachePath },
    });
    assert.equal(stderr, '');
    return stdout.trim();
  };
  return { cache, state, run };
}

test('later processes do not repeat the invitation', async t => {
  const { state, run } = fixture(t);
  assert.equal(await run(), 'offer');
  assert.deepEqual(JSON.parse(readFileSync(state, 'utf8')), { star_invitation_shown: true });
  assert.equal(await run(), 'skip');
});

test('concurrent processes offer only once', async t => {
  const { run } = fixture(t);
  const results = await Promise.all(Array.from({ length: 12 }, () => run()));
  assert.equal(results.filter(x => x === 'offer').length, 1);
  assert.equal(results.filter(x => x === 'skip').length, 11);
});

test('an invalid existing record is preserved', async t => {
  const { cache, state, run } = fixture(t);
  mkdirSync(join(cache, 'claude-code-mods'));
  writeFileSync(state, 'interrupted write');
  assert.equal(await run(), 'skip');
  assert.equal(readFileSync(state, 'utf8'), 'interrupted write');
});

test('an unusable cache skips', async t => {
  const { cache, run } = fixture(t);
  const blocked = join(cache, 'blocked');
  writeFileSync(blocked, 'file, not a directory');
  assert.equal(await run(blocked), 'skip');
});

test('a relative cache skips without writing', async t => {
  const { cache, run } = fixture(t);
  assert.equal(await run('relative-cache'), 'skip');
  assert.equal(existsSync(join(cache, 'relative-cache')), false);
});

test('an existing directory at the record skips', async t => {
  const { state, run } = fixture(t);
  mkdirSync(state, { recursive: true });
  assert.equal(await run(), 'skip');
});
