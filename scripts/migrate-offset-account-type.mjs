#!/usr/bin/env node
/**
 * Promotes the offset ledger from a user-created CUSTOM account type to the built-in 'offset' type
 * inside a SpendVault backup JSON file.
 *
 * The app performs the same migration on every load (see FinanceContext's account-type migration
 * block), so restoring an un-migrated backup is already safe. This script exists for the other
 * direction: a backup file kept on disk, inspected by hand, diffed, or fed to something that reads it
 * without going through the app. After running it the file matches what the app would write out on its
 * next export, so a `git diff` of two backups no longer shows a phantom custom type.
 *
 * What it changes, and nothing else:
 *   1. accounts[].type — every offset spelling ('offset', 'Offset Ledger', ...) becomes 'offset'.
 *   2. customAccountTypes — those same spellings are dropped; the offset ledger is native now, and a
 *      native type listed as a custom one makes the account-type pickers show it twice.
 *
 * Account ids are untouched, so transactions keep pointing at the same ledger.
 *
 * Usage:
 *   node scripts/migrate-offset-account-type.mjs <backup.json>              # writes <backup>.migrated.json
 *   node scripts/migrate-offset-account-type.mjs <backup.json> -o out.json  # writes out.json
 *   node scripts/migrate-offset-account-type.mjs <backup.json> --in-place   # rewrites it, keeping a .bak
 *   node scripts/migrate-offset-account-type.mjs <backup.json> --check      # reports only, writes nothing
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv } from 'node:process';

// Mirror of OFFSET_TYPE_ALIASES in src/types.ts. Kept as a literal because this script runs under
// plain node with no TypeScript loader — if you add a spelling there, add it here too.
const OFFSET_TYPE_ALIASES = ['offset', 'offset ledger', 'offset_ledger', 'offset-ledger', 'offsetledger'];
const CANONICAL_TYPE = 'offset';
const isOffsetAlias = (type) =>
  typeof type === 'string' && OFFSET_TYPE_ALIASES.includes(type.trim().toLowerCase());

function parseArgs(argv) {
  const opts = { input: null, output: null, inPlace: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--in-place' || arg === '-i') opts.inPlace = true;
    else if (arg === '--check' || arg === '-n') opts.check = true;
    else if (arg === '-o' || arg === '--out') opts.output = argv[++i];
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (opts.input === null) opts.input = arg;
    else throw new Error(`Unexpected extra argument: ${arg}`);
  }
  return opts;
}

/** Returns the migrated data plus a description of what moved. Pure — `data` is not mutated. */
export function migrateOffsetAccountType(data) {
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const renamedAccounts = [];

  const migratedAccounts = accounts.map((acc) => {
    if (!isOffsetAlias(acc?.type) || acc.type === CANONICAL_TYPE) return acc;
    renamedAccounts.push({ name: acc.name, from: acc.type });
    return { ...acc, type: CANONICAL_TYPE };
  });

  // Accounts that were ALREADY on the exact canonical key still count as migrated ledgers for the
  // report — the custom-type entry beside them is the thing that has to go, and a run that says
  // "0 accounts" while dropping a type reads like it touched the wrong file.
  const offsetAccounts = migratedAccounts.filter((acc) => acc?.type === CANONICAL_TYPE);

  const customTypes = Array.isArray(data.customAccountTypes) ? data.customAccountTypes : [];
  const droppedTypes = customTypes.filter(isOffsetAlias);
  const keptTypes = customTypes.filter((t) => !isOffsetAlias(t));

  const changed = renamedAccounts.length > 0 || droppedTypes.length > 0;

  return {
    changed,
    report: { renamedAccounts, droppedTypes, offsetAccounts: offsetAccounts.map((a) => a.name) },
    // Key order is preserved by spreading the original first, so the output diffs cleanly against it.
    data: changed
      ? { ...data, accounts: migratedAccounts, ...(Array.isArray(data.customAccountTypes) ? { customAccountTypes: keptTypes } : {}) }
      : data,
  };
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n`);
    process.exit(2);
  }

  if (opts.help || !opts.input) {
    console.log(`Usage: node scripts/migrate-offset-account-type.mjs <backup.json> [-o out.json] [--in-place] [--check]

Moves the offset ledger from a custom account type to the built-in 'offset' type.
  -o, --out <file>   write the result to <file>
  -i, --in-place     rewrite the input, keeping a .bak alongside it
  -n, --check        report what would change, write nothing`);
    process.exit(opts.help ? 0 : 2);
  }

  if (opts.inPlace && opts.output) {
    console.error('Pass either --in-place or -o, not both.');
    process.exit(2);
  }
  if (!existsSync(opts.input)) {
    console.error(`No such file: ${opts.input}`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(readFileSync(opts.input, 'utf8'));
  } catch (e) {
    console.error(`${opts.input} is not valid JSON: ${e.message}`);
    process.exit(1);
  }

  // A backup always has an accounts array. Anything else is a different file, and rewriting it would
  // do real damage under --in-place.
  if (typeof data !== 'object' || data === null || !Array.isArray(data.accounts)) {
    console.error(`${opts.input} does not look like a SpendVault backup (no 'accounts' array).`);
    process.exit(1);
  }

  const { changed, report, data: migrated } = migrateOffsetAccountType(data);

  for (const { name, from } of report.renamedAccounts) {
    console.log(`  account  "${name}": type '${from}' -> '${CANONICAL_TYPE}'`);
  }
  for (const type of report.droppedTypes) {
    console.log(`  custom type '${type}' dropped (now built-in)`);
  }

  if (!changed) {
    console.log(`${basename(opts.input)}: already migrated — nothing to do.`);
    process.exit(0);
  }

  console.log(
    `${basename(opts.input)}: ${report.offsetAccounts.length} offset ledger(s) now on the built-in type` +
      (report.offsetAccounts.length ? ` (${report.offsetAccounts.join(', ')})` : '')
  );

  if (opts.check) {
    console.log('--check: no files written.');
    process.exit(0);
  }

  let target;
  if (opts.inPlace) {
    const backup = `${opts.input}.bak`;
    copyFileSync(opts.input, backup);
    console.log(`  original saved to ${backup}`);
    target = opts.input;
  } else {
    target = opts.output || opts.input.replace(/(\.json)?$/i, '.migrated.json');
  }

  // 2-space indent matches the app's own export (Settings' buildFileAndShare), so a migrated file and
  // a freshly exported one are byte-comparable.
  writeFileSync(target, `${JSON.stringify(migrated, null, 2)}\n`);
  console.log(`  written to ${target}`);
}

// Guarded so migrateOffsetAccountType can be imported (by a test, or a larger migration) without the
// CLI firing on import.
// fileURLToPath, not URL.pathname: the repo path contains a space, and pathname would leave it
// percent-encoded so the comparison never matched and the CLI silently did nothing.
if (resolve(argv[1] || '') === resolve(fileURLToPath(import.meta.url))) {
  main();
}
