#!/usr/bin/env node
// SpendVault release tooling — one entry point that behaves the same on macOS, Windows and Linux.
//
//   npm run release:doctor                 what this machine can build with, and what is missing
//   npm run release:setup [-- <options>]   one-time setup per machine (signing folder, git hooks)
//   npm run release:apk [-- --local|--docker]   a signed APK, to install directly
//   npm run release:aab [-- --local|--docker]   a signed App Bundle, to upload to Google Play
//
// The signing key never lives in the repo. Each machine keeps it in <home>/.spendvault/ — the
// keystore plus signing.properties — which android/app/build.gradle reads directly and the Docker
// builder mounts read-only. See docs/RELEASE.md.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { spawnOnPath } from './lib/spawn-on-path.mjs';
import { activeBrand } from './brand.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const SIGNING_DIR = path.join(os.homedir(), '.spendvault');
const SIGNING_FILE = path.join(SIGNING_DIR, 'signing.properties');
const DEFAULT_STORE_NAME = 'spendvault-release-key.jks';
const LEGACY_KEY_PROPS = path.join(ROOT, 'android', 'key.properties');
// What each kind of release runs and where Gradle leaves it. Play only accepts an App Bundle (.aab);
// an APK is what installs straight onto a phone. Both are signed with the same verified key.
const ARTIFACTS = {
  apk: { task: 'assembleRelease', label: 'APK', built: path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk') },
  aab: { task: 'bundleRelease', label: 'App Bundle', built: path.join(ROOT, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab') },
};
const RELEASE_DIR = path.join(ROOT, 'release');
const REQUIRED_JAVA = 21; // android/app/capacitor.build.gradle compiles for Java 21

// ---- small utilities ---------------------------------------------------------------------------

const say = (s = '') => process.stdout.write(`${s}\n`);
const fail = (msg) => { process.stderr.write(`\nERROR: ${msg}\n`); process.exit(1); };

/** Run a command attached to this terminal; exit on failure. npm/npx/gradlew.bat are .cmd/.bat
 *  shims on Windows, which Node only spawns through a shell. */
function run(cmd, args, opts = {}) {
  say(`\n$ ${[cmd, ...args].join(' ')}`);
  const r = spawnOnPath(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: IS_WIN, ...opts });
  if (r.error) fail(`could not start ${cmd}: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} exited with ${r.status}`);
}

function capture(cmd, args, opts = {}) {
  const r = spawnOnPath(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
  return { ok: !r.error && r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`, missing: !!r.error };
}

/** Java .properties, as Gradle reads them: `\` escapes, `\uXXXX`, continuation lines, `=`/`:`. */
function readProps(file) {
  const unescape = s => s.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (_, u, c) =>
    u ? String.fromCharCode(parseInt(u, 16)) : ({ t: '\t', n: '\n', r: '\r', f: '\f' }[c] ?? c));
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^\s+/, '');
    if (!line || line[0] === '#' || line[0] === '!') continue;
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i].replace(/^\s+/, '');
    let j = 0;
    let key = '';
    while (j < line.length && !/[=:\s]/.test(line[j])) key += line[j] === '\\' ? line.slice(j, (j += 2)) : line[j++];
    while (j < line.length && /\s/.test(line[j])) j++;
    if (line[j] === '=' || line[j] === ':') j++;
    while (j < line.length && /\s/.test(line[j])) j++;
    out[unescape(key)] = unescape(line.slice(j));
  }
  return out;
}

const escapeProp = v => String(v)
  .replace(/\\/g, '\\\\')
  .replace(/^ /, '\\ ')
  .replace(/[\u0000-\u001f\u007f-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** The certificate fingerprint build.gradle enforces — read from there so there is one copy. */
function expectedCertSha() {
  const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
  return /RELEASE_CERT_SHA256 = '([0-9a-f]{64})'/.exec(gradle)?.[1];
}

// ---- what this machine has ---------------------------------------------------------------------

/** The JDK Gradle will run on, found the way Gradle finds it. */
function javaInfo() {
  const gradleHome = process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle');
  let home = null;
  let from = 'java on PATH';
  for (const f of [path.join(gradleHome, 'gradle.properties'), path.join(ROOT, 'android', 'gradle.properties')]) {
    const v = fs.existsSync(f) && readProps(f)['org.gradle.java.home'];
    if (v) { home = v; from = f; break; }
  }
  if (!home && process.env.JAVA_HOME) { home = process.env.JAVA_HOME; from = 'JAVA_HOME'; }
  const bin = name => (home ? path.join(home, 'bin', IS_WIN ? `${name}.exe` : name) : name);
  const r = capture(bin('java'), ['-version']);
  const m = /version "(\d+)(?:\.(\d+))?/.exec(r.out);
  const major = m ? (m[1] === '1' ? Number(m[2]) : Number(m[1])) : null;
  return { home, from, major: r.ok ? major : null, keytool: bin('keytool') };
}

function androidSdk() {
  const lp = path.join(ROOT, 'android', 'local.properties');
  const fromFile = fs.existsSync(lp) && readProps(lp)['sdk.dir'];
  if (fromFile) return { dir: fromFile, from: 'android/local.properties' };
  for (const v of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) if (process.env[v]) return { dir: process.env[v], from: v };
  const guess = IS_WIN ? path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Android', 'sdk')
      : path.join(os.homedir(), 'Android', 'Sdk');
  return fs.existsSync(guess) ? { dir: guess, from: 'default location', needsEnv: true } : null;
}

function dockerState() {
  if (capture('docker', ['--version']).missing) return 'missing';
  return capture('docker', ['info', '--format', '{{.ServerVersion}}']).ok ? 'running' : 'stopped';
}

function signingState() {
  if (process.env.SV_KEYSTORE_FILE) return { kind: 'env', ok: true, label: 'SV_KEYSTORE_* environment variables' };
  if (fs.existsSync(SIGNING_FILE)) {
    const p = readProps(SIGNING_FILE);
    const storeFile = p.storeFile || DEFAULT_STORE_NAME;
    const store = path.resolve(SIGNING_DIR, storeFile);
    const missing = ['storePassword', 'keyAlias', 'keyPassword'].filter(k => !p[k]);
    const problems = [
      ...(fs.existsSync(store) ? [] : [`keystore not found at ${store}`]),
      ...(missing.length ? [`signing.properties is missing ${missing.join(', ')}`] : []),
    ];
    return {
      kind: 'machine', ok: problems.length === 0, problems, store, props: p,
      // The Docker builder sees this folder at /root/.spendvault, so only a path inside it resolves.
      dockerUsable: !path.isAbsolute(storeFile),
      label: SIGNING_FILE,
    };
  }
  if (fs.existsSync(LEGACY_KEY_PROPS)) return { kind: 'legacy', ok: true, label: 'android/key.properties (legacy)' };
  return { kind: 'none', ok: false, label: 'none' };
}

function gitState() {
  const head = capture('git', ['rev-parse', '--short', 'HEAD']);
  const status = capture('git', ['status', '--porcelain']);
  const hooks = capture('git', ['config', '--get', 'core.hooksPath']);
  return {
    sha: head.ok ? head.out.trim() : 'nogit',
    dirty: status.ok && status.out.trim().length > 0,
    hooks: hooks.ok && hooks.out.trim() === '.githooks',
  };
}

function survey() {
  const java = javaInfo();
  const sdk = androidSdk();
  const docker = dockerState();
  const signing = signingState();
  const git = gitState();
  const localReady = java.major === REQUIRED_JAVA && !!sdk && signing.ok;
  const dockerReady = docker === 'running' && signing.kind === 'machine' && signing.ok && signing.dockerUsable;
  return { java, sdk, docker, signing, git, localReady, dockerReady };
}

// ---- doctor ------------------------------------------------------------------------------------

function doctor() {
  const s = survey();
  const mark = ok => (ok ? '[ok]' : '[!!]');
  say(`SpendVault release doctor — ${os.platform()} ${os.arch()}, node ${process.version}`);
  say(`Repo: ${ROOT}\n`);

  say('Signing');
  say(`  ${mark(s.signing.ok)} source: ${s.signing.label}`);
  for (const p of s.signing.problems || []) say(`       ${p}`);
  if (s.signing.kind === 'none') say('       Run: npm run release:setup -- --keystore <path-to-.jks>   (docs/RELEASE.md §2)');
  if (s.signing.kind === 'legacy') say('       Secrets sit inside the checkout. Move them out: npm run release:setup -- --from-key-properties');
  if (s.signing.kind === 'machine' && !s.signing.dockerUsable) say('       storeFile is an absolute path — the Docker builder cannot see it. Keep the .jks in this folder.');
  if (s.signing.kind === 'machine' && fs.existsSync(LEGACY_KEY_PROPS)) say('  [!!] android/key.properties also exists — ignored now, but it still holds secrets in the checkout. Delete it.');
  if (fs.existsSync(path.join(ROOT, DEFAULT_STORE_NAME))) say(`  [!!] ${DEFAULT_STORE_NAME} sits in the repo folder — keep it only in ${SIGNING_DIR}.`);

  say('\nLocal toolchain (Android Studio route)');
  say(`  ${mark(s.java.major === REQUIRED_JAVA)} JDK ${s.java.major ?? 'not found'} (needs ${REQUIRED_JAVA}) — from ${s.java.from}${s.java.home ? `: ${s.java.home}` : ''}`);
  say(`  ${mark(!!s.sdk)} Android SDK ${s.sdk ? `${s.sdk.dir} (${s.sdk.from})` : 'not found'}`);

  say('\nDocker route');
  say(`  ${mark(s.docker === 'running')} Docker ${s.docker}${s.docker === 'stopped' ? ' — start Docker Desktop' : ''}`);

  say('\nRepo hygiene');
  say(`  ${mark(s.git.hooks)} pre-commit guard ${s.git.hooks ? 'installed' : 'not installed — run: npm run release:setup'}`);
  const pollutedGradle = readPropsSafe(path.join(ROOT, 'android', 'gradle.properties'))['org.gradle.java.home'];
  if (pollutedGradle) say('  [!!] android/gradle.properties sets org.gradle.java.home — move it to ~/.gradle/gradle.properties');

  say('\nRoutes');
  say(`  local : ${s.localReady ? 'READY' : 'not ready'}`);
  say(`  docker: ${s.dockerReady ? 'READY' : 'not ready'}`);
  say(`  npm run release:apk will use: ${s.localReady ? 'local' : s.dockerReady ? 'docker' : 'nothing — fix the [!!] items above'}`);
  return s;
}

function readPropsSafe(file) {
  return fs.existsSync(file) ? readProps(file) : {};
}

// ---- setup -------------------------------------------------------------------------------------

function prompt(question, { hidden = false } = {}) {
  if (!process.stdin.isTTY) fail('setup needs to ask for passwords — run it in an interactive terminal.');
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = s => { if (!rl.muted) write(s); };
    rl.question(question, answer => {
      rl.close();
      if (hidden) say();
      resolve(answer);
    });
    rl.muted = hidden;
  });
}

function lockDown(target) {
  if (IS_WIN) return; // a folder under %USERPROFILE% is already readable only by this user
  fs.chmodSync(target, fs.statSync(target).isDirectory() ? 0o700 : 0o600);
}

function verifyWithKeytool(store, alias, storePassword) {
  const expected = expectedCertSha();
  const r = capture(javaInfo().keytool, ['-list', '-v', '-keystore', store, '-alias', alias, '-storepass:env', 'SV_KT_PASS'],
    { env: { ...process.env, SV_KT_PASS: storePassword } });
  if (r.missing) return say('  keytool not found here — the first release build verifies the key instead.');
  if (!r.ok) fail(`keytool could not read the keystore with that alias/password:\n${r.out.trim()}`);
  const sha = /SHA256:\s*([0-9A-F:]+)/i.exec(r.out)?.[1]?.replace(/:/g, '').toLowerCase();
  if (sha !== expected) fail(`this keystore is NOT the SpendVault release key.\n  expected ${expected}\n  got      ${sha}`);
  say('  [ok] keystore opens with that password and carries the SpendVault release certificate');
}

async function setup(args) {
  const flag = name => args.includes(name);
  const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

  say('==> Git hooks for this clone');
  run('git', ['config', 'core.hooksPath', '.githooks'], { shell: false });
  say('  [ok] pre-commit guard active (blocks keystores, secrets and machine-specific paths)');

  let source = null;
  let props = null;
  if (flag('--from-key-properties')) {
    if (!fs.existsSync(LEGACY_KEY_PROPS)) fail('android/key.properties does not exist.');
    const p = readProps(LEGACY_KEY_PROPS);
    // Gradle resolved it with file() in the app project, i.e. relative to android/app.
    source = path.resolve(ROOT, 'android', 'app', p.storeFile || '');
    props = { keyAlias: p.keyAlias, storePassword: p.storePassword, keyPassword: p.keyPassword };
  } else if (value('--keystore')) {
    source = path.resolve(value('--keystore'));
  } else {
    say(`\nSigning: ${signingState().label}`);
    say('Nothing else to do. To set up signing: npm run release:setup -- --keystore <path-to-.jks>');
    return;
  }

  if (!fs.existsSync(source)) fail(`keystore not found: ${source}`);
  if (fs.existsSync(SIGNING_FILE) && !flag('--force')) fail(`${SIGNING_FILE} already exists. Re-run with --force to replace it.`);

  say(`\n==> Signing folder ${SIGNING_DIR}`);
  fs.mkdirSync(SIGNING_DIR, { recursive: true });
  lockDown(SIGNING_DIR);
  const target = path.join(SIGNING_DIR, path.basename(source));
  if (path.resolve(source) !== target) {
    if (fs.existsSync(target) && sha256File(target) !== sha256File(source)) fail(`${target} exists and differs from ${source}. Move it aside first.`);
    fs.copyFileSync(source, target);
  }
  lockDown(target);
  say(`  [ok] keystore at ${target}`);

  if (!props) {
    const alias = (await prompt('Key alias [spendvault]: ')) || 'spendvault';
    const storePassword = await prompt('Keystore password: ', { hidden: true });
    const keyPassword = (await prompt('Key password (Enter if same as keystore): ', { hidden: true })) || storePassword;
    props = { keyAlias: alias, storePassword, keyPassword };
  }
  verifyWithKeytool(target, props.keyAlias, props.storePassword);

  const body = [
    '# SpendVault release signing for THIS machine. Read by android/app/build.gradle and mounted',
    '# read-only into the Docker builder. Never copy it into the repo. See docs/RELEASE.md.',
    `storeFile=${escapeProp(path.basename(target))}`,
    `keyAlias=${escapeProp(props.keyAlias)}`,
    `storePassword=${escapeProp(props.storePassword)}`,
    `keyPassword=${escapeProp(props.keyPassword)}`,
    '',
  ].join('\n');
  fs.writeFileSync(SIGNING_FILE, body, { mode: 0o600 });
  lockDown(SIGNING_FILE);
  say(`  [ok] wrote ${SIGNING_FILE}`);

  if (fs.existsSync(LEGACY_KEY_PROPS)) say('\nandroid/key.properties is now ignored. Delete it so no secrets stay in the checkout.');
  if (path.dirname(source) !== SIGNING_DIR && source.startsWith(ROOT)) say(`Also delete ${path.relative(ROOT, source)} from the repo folder once you have a backup.`);
  say('\nDone. Check with: npm run release:doctor');
}

// ---- build -------------------------------------------------------------------------------------

function artifactName(git, kind) {
  const utils = fs.readFileSync(path.join(ROOT, 'src', 'utils.ts'), 'utf8');
  const version = /export const APP_VERSION = '([^']+)'/.exec(utils)?.[1] || 'v0';
  return `SpendVault-${version}-${git.sha}${git.dirty ? '-dirty' : ''}.${kind}`;
}

function buildLocal(s, name, kind) {
  const { task, built } = ARTIFACTS[kind];
  const env = { ...process.env };
  if (s.sdk.needsEnv) env.ANDROID_HOME = s.sdk.dir;
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) run('npm', ['ci', '--no-audit', '--no-fund']);
  run('npm', ['run', 'build']);
  run('npx', ['cap', 'sync', 'android']);
  fs.rmSync(built, { force: true });
  const androidDir = path.join(ROOT, 'android');
  // sh rather than ./gradlew: the executable bit does not always survive a checkout made elsewhere.
  if (IS_WIN) run('gradlew.bat', [task], { cwd: androidDir, env });
  else run('sh', ['./gradlew', task], { cwd: androidDir, env, shell: false });
  if (!fs.existsSync(built)) fail(`Gradle finished but ${path.relative(ROOT, built)} is missing.`);
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  fs.copyFileSync(built, path.join(RELEASE_DIR, name));
}

function buildDocker(name, kind) {
  const env = { ...process.env, SV_SIGNING_DIR: SIGNING_DIR, SV_APK_NAME: name, SV_ARTIFACT: kind };
  run('docker', ['compose', 'build', 'spendvault-apk'], { env, shell: false });
  run('docker', ['compose', 'run', '--rm', 'spendvault-apk'], { env, shell: false });
}

function build(args) {
  const s = survey();
  const want = args.includes('--docker') ? 'docker' : args.includes('--local') ? 'local' : null;
  const route = want || (s.localReady ? 'local' : s.dockerReady ? 'docker' : null);
  if (!route) { doctor(); fail('this machine cannot build a signed release yet — see the [!!] items above.'); }
  if (route === 'local' && !s.localReady) { doctor(); fail('the local route is not ready on this machine.'); }
  if (route === 'docker' && !s.dockerReady) { doctor(); fail('the Docker route is not ready on this machine.'); }
  if (s.git.dirty) say('WARNING: uncommitted changes — the build is named -dirty and is not reproducible from a commit.');

  const kind = args.includes('--aab') ? 'aab' : 'apk';
  const brand = activeBrand();
  if (kind === 'aab' && brand !== 'vault') fail(`the ${brand} logo is in place, and an App Bundle is for Google Play — run: npm run brand:vault (and commit it)`);
  if (brand !== 'vault') say(`NOTE: built with the ${brand} logo — for sideloaded testing only (npm run brand:vault switches back).`);
  const name = artifactName(s.git, kind);
  const out = path.join(RELEASE_DIR, name);
  fs.rmSync(out, { force: true });
  say(`==> Building ${name} via the ${route} route`);
  if (route === 'local') buildLocal(s, name, kind);
  else buildDocker(name, kind);
  if (!fs.existsSync(out)) fail(`build finished but ${path.relative(ROOT, out)} was not produced.`);

  const size = fs.statSync(out).size;
  say(`\n==> Signed release ${ARTIFACTS[kind].label} (certificate verified against the SpendVault release key)`);
  say(`    ${out}`);
  say(`    ${(size / 1024 / 1024).toFixed(1)} MB (${size} bytes)`);
  say(`    SHA-256 ${sha256File(out)}`);
}

// ---- main --------------------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);
if (command === 'doctor') doctor();
else if (command === 'setup') await setup(rest);
else if (command === 'build') build(rest);
else {
  say('usage: node scripts/release-apk.mjs <doctor|setup|build> [options]');
  say('  setup --keystore <file.jks> [--force]   import a keystore into ~/.spendvault (asks for passwords)');
  say('  setup --from-key-properties [--force]   move an existing android/key.properties setup there');
  say('  build [--local|--docker] [--aab]        build a signed APK (or, with --aab, an App Bundle) into release/');
  process.exit(command ? 1 : 0);
}
