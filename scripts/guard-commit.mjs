#!/usr/bin/env node
// Pre-commit guard, wired up per clone by `npm run release:setup` (git config core.hooksPath .githooks).
//
// This repo is worked on from more than one machine, macOS and Windows both. This stops the things
// that let one machine's setup leak into a branch every machine shares: signing secrets, per-machine
// config, absolute home-directory paths, build output and OS clutter. Only ADDED lines are checked,
// so it never objects to what is already committed.
//
// A genuine false positive can be committed with: git commit --no-verify
import path from 'node:path';
import { spawnOnPath } from './lib/spawn-on-path.mjs';

// Inside a hook, GIT_EXEC_PATH names the git that is running this commit — use that very binary.
const GIT = process.env.GIT_EXEC_PATH
  ? path.join(process.env.GIT_EXEC_PATH, process.platform === 'win32' ? 'git.exe' : 'git')
  : 'git';
const git = (...args) => {
  const r = spawnOnPath(GIT, ['-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.error?.message || r.stderr}`);
  return r.stdout;
};

const BLOCKED_FILES = [
  [/\.(jks|keystore|p12|pfx)$/i, 'a keystore'],
  [/(^|\/)(key|signing)\.properties$/, 'signing secrets'],
  [/(^|\/)local\.properties$/, "a machine's SDK path"],
  [/(^|\/)\.env(\.[^/]+)?$/, 'environment secrets', p => p.endsWith('.env.example')],
  [/\.(apk|aab)$/i, 'a build artifact'],
  [/(^|\/)spendvault_backup_[^/]*\.json$/, 'personal financial data'],
  [/(^|\/)(\.DS_Store|Thumbs\.db|ehthumbs\.db|desktop\.ini)$/i, 'OS clutter'],
];

// Placeholders that docs and templates use in place of a real user or secret.
const PLACEHOLDER = String.raw`(?!you\b|me\b|<|%|\$|USERNAME\b|REPLACE_WITH|\.\.\.)`;
const CONFIG_FILE = /\.(properties|gradle|kts|env|ya?ml|json|toml|xml)(\.[\w-]+)?$|(^|\/)\.env/;
// key=value files, where any value after a password key IS the password.
const PROPS_FILE = /\.(properties|env|ya?ml|json|toml|xml)(\.[\w-]+)?$|(^|\/)\.env/;
// Build scripts, where `storePassword: p['storePassword']` is code — only a quoted literal is a secret.
const GRADLE_FILE = /\.(gradle|kts)$/;
const BLOCKED_LINES = [
  [new RegExp(String.raw`/Users/${PLACEHOLDER}[A-Za-z0-9._-]+/`), 'an absolute macOS home path'],
  [new RegExp(String.raw`\b[A-Za-z]:[\\/]+Users[\\/]+${PLACEHOLDER}[^\\/\s"'\x60]+`, 'i'), 'an absolute Windows home path'],
  [new RegExp(String.raw`/home/${PLACEHOLDER}[a-z0-9._-]+/`), 'an absolute Linux home path'],
  [/^\s*org\.gradle\.java\.home\s*[=:]/, 'a machine-specific JDK path (belongs in ~/.gradle/gradle.properties)', CONFIG_FILE],
  [/^\s*sdk\.dir\s*[=:]/, 'a machine-specific SDK path (belongs in android/local.properties)', CONFIG_FILE],
  [new RegExp(String.raw`^\s*(storePassword|keyPassword|SV_KEYSTORE_PASSWORD|SV_KEY_PASSWORD)\s*[=:]\s*${PLACEHOLDER}\S`), 'a signing password', PROPS_FILE],
  [/(?<![\w'".])(storePassword|keyPassword)(?:\s*[=:(]\s*|\s+)(['"])(?!\$)[^'"]+\2/, 'a hardcoded signing password', GRADLE_FILE],
];

const problems = [];

for (const file of git('diff', '--cached', '--name-only', '--diff-filter=ACR', '-z').split('\0').filter(Boolean)) {
  for (const [pattern, what, allow] of BLOCKED_FILES) {
    if (pattern.test(file) && !(allow && allow(file))) problems.push(`${file}: ${what} — this file must not be committed`);
  }
}

let file = null;
let lineNo = 0;
for (const line of git('diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=ACMR').split('\n')) {
  if (line.startsWith('+++ ')) { file = line.slice(4).replace(/^b\//, ''); continue; }
  const hunk = /^@@ -\S+ \+(\d+)/.exec(line);
  if (hunk) { lineNo = Number(hunk[1]); continue; }
  if (!file || !line.startsWith('+')) continue;
  const text = line.slice(1);
  for (const [pattern, what, onlyIn] of BLOCKED_LINES) {
    if ((!onlyIn || onlyIn.test(file)) && pattern.test(text)) problems.push(`${file}:${lineNo}: ${what}`);
  }
  lineNo++;
}

if (problems.length) {
  process.stderr.write('\nCommit blocked — machine-specific or secret content is staged:\n\n');
  for (const p of problems) process.stderr.write(`  ${p}\n`);
  process.stderr.write('\nUnstage it (git restore --staged <file>), or move the setting somewhere per-machine — see\n');
  process.stderr.write('docs/RELEASE.md. A genuine false positive: git commit --no-verify\n\n');
  process.exit(1);
}
