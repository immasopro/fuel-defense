#!/usr/bin/env node
/** Copy web assets into www/ for Capacitor sync. */
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

for (const name of ['index.html', 'css', 'js', 'version.json']) {
  const src = join(root, name);
  if (!existsSync(src)) throw new Error(`missing ${name}`);
  cpSync(src, join(www, name), { recursive: true });
}

// Capacitor shell expects relative asset paths; keep as-is.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(
  join(www, 'build.json'),
  JSON.stringify({ name: pkg.name, version: pkg.version, builtAt: new Date().toISOString() }, null, 2)
);

console.log(`www/ ready (v${pkg.version})`);
