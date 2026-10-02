import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

let result = 'skip';
try {
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  if (isAbsolute(cache)) {
    const directory = join(cache, 'claude-code-mods');
    mkdirSync(directory, { recursive: true });
    // Exclusive creation prevents simultaneous or later sessions from asking again.
    writeFileSync(join(directory, 'star-invitation.json'),
      JSON.stringify({ star_invitation_shown: true }), { flag: 'wx', mode: 0o600 });
    result = 'offer';
  }
} catch {
  // An unusable record suppresses the invitation without affecting the task.
}
console.log(result);
