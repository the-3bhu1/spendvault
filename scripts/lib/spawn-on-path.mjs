import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EBADARCH = -86;

/**
 * spawnSync that, like a shell, skips a PATH entry it cannot execute and tries the next one.
 *
 * Node does not. On an Apple-silicon Mac without Rosetta, a leftover Intel binary early on PATH — an
 * old /usr/local Homebrew git is the usual one — fails with EBADARCH ("bad CPU type") even though a
 * working copy sits further down, which zsh would quietly have used instead. Windows resolves
 * commands differently (PATHEXT, .cmd shims through a shell) and never hits this, so it is left alone.
 */
export function spawnOnPath(cmd, args, opts = {}) {
  if (process.platform === 'win32' || opts.shell || cmd.includes(path.sep)) return spawnSync(cmd, args, opts);
  let last = null;
  for (const dir of (opts.env?.PATH ?? process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, cmd);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isDirectory()) continue;
    } catch {
      continue;
    }
    last = spawnSync(candidate, args, opts);
    if (last.error?.errno !== EBADARCH) return last;
  }
  return last ?? spawnSync(cmd, args, opts);
}
