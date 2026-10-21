#!/usr/bin/env node
// Which logo the app is built with. Two sets exist, and switching is nothing but swapping image files —
// no code names either one (the header, splash animation and Settings → About all read public/logo.png
// through TransparentLogo).
//
//   npm run brand          which set is in place
//   npm run brand:rbi      the original e₹ Digital Rupee mark — sideloaded test builds ONLY
//   npm run brand:vault    the vault dial — required for anything that goes to Google Play
//
// Each set is read straight out of git: the commit that replaced the RBI mark (ce0203f) holds the vault
// set, its parent the RBI set. The RBI mark is the Reserve Bank of India's; Play rejects a finance app
// that implies an affiliation with it, which is why `npm run release:aab` refuses to build with it.
// After switching, commit the result so the release is named after a clean commit, not -dirty.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnOnPath } from './lib/spawn-on-path.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT_COMMIT = 'ce0203ffd7e1ca81c6e98b8d1843de5114b69e76';
export const BRANDS = { rbi: `${VAULT_COMMIT}^`, vault: VAULT_COMMIT };

function git(...args) {
  const r = spawnOnPath('git', ['-c', 'core.quotePath=false', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.error?.message || r.stderr}`);
  return r.stdout;
}

/** What ships: the launcher icons and splash screens, and the web logo + favicon. The source images
 *  in assets/ that @capacitor/assets regenerates the Android ones from stay on the vault set — the two
 *  sets don't even name the same files there, and nothing reads them at runtime. */
function brandFiles() {
  return git('diff', '--name-only', '--diff-filter=M', BRANDS.rbi, BRANDS.vault, '--', 'public', 'android/app/src/main/res')
    .split('\n').filter(Boolean);
}

/** 'rbi' | 'vault' | 'mixed' — what the working tree holds right now. */
export function activeBrand() {
  const files = brandFiles();
  const working = git('hash-object', '--', ...files).split('\n').filter(Boolean);
  const matches = brand => {
    const blobs = new Map(git('ls-tree', BRANDS[brand], '--', ...files).split('\n').filter(Boolean)
      .map(line => { const [meta, file] = line.split('\t'); return [file, meta.split(' ')[2]]; }));
    return files.every((f, i) => blobs.get(f) === working[i]);
  };
  return matches('vault') ? 'vault' : matches('rbi') ? 'rbi' : 'mixed';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const want = process.argv[2];
  if (want && !BRANDS[want]) {
    process.stderr.write(`usage: node scripts/brand.mjs [${Object.keys(BRANDS).join('|')}]\n`);
    process.exit(1);
  }
  if (want) {
    const files = brandFiles();
    git('checkout', BRANDS[want], '--', ...files);
    process.stdout.write(`Switched ${files.length} files to the ${want} logo. Commit them before building a release.\n`);
  }
  const now = activeBrand();
  process.stdout.write(`Logo in place: ${now}${now === 'rbi' ? ' (test builds only — never upload to Google Play)' : ''}\n`);
}
