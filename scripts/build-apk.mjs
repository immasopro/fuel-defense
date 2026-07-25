#!/usr/bin/env node
/** Prepare www, sync Capacitor, assemble signed release APK. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), 'android-sdk');
const javaHome = process.env.JAVA_HOME || '/usr/lib/jvm/java-21-openjdk-amd64';
const keystore = join(root, 'android/app/fuel-defense-release.jks');

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    stdio: 'inherit',
    env: {
      ...process.env,
      ANDROID_HOME: androidHome,
      ANDROID_SDK_ROOT: androidHome,
      JAVA_HOME: javaHome,
      PATH: `${join(androidHome, 'platform-tools')}:${join(javaHome, 'bin')}:${process.env.PATH}`
    }
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

writeFileSync(join(root, 'android/local.properties'), `sdk.dir=${androidHome.replace(/\\/g, '/')}\n`);

if (!existsSync(keystore)) {
  run('keytool', [
    '-genkeypair', '-v',
    '-keystore', keystore,
    '-alias', 'fueldefense',
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-storepass', process.env.FD_KEYSTORE_PASSWORD || 'fueldefense',
    '-keypass', process.env.FD_KEY_PASSWORD || 'fueldefense',
    '-dname', 'CN=Fuel Defense, OU=Games, O=immasopro, L=Moscow, ST=Moscow, C=RU'
  ]);
}

run(process.execPath, [join(root, 'scripts/prepare-www.mjs')]);
run('npx', ['cap', 'sync', 'android']);

const gradlew = join(root, 'android', 'gradlew');
run(gradlew, ['assembleRelease', '--no-daemon'], { cwd: join(root, 'android') });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const built = join(root, 'android/app/build/outputs/apk/release/app-release.apk');
if (!existsSync(built)) {
  console.error('APK not found:', built);
  process.exit(1);
}

const outDir = join(root, 'dist');
mkdirSync(outDir, { recursive: true });
const outApk = join(outDir, `fuel-defense-v${pkg.version}.apk`);
copyFileSync(built, outApk);
console.log('APK:', outApk);
