/**
 * Smoke: import all modules + FrameTimer + simulated rAF loop.
 * Run: node scripts/audit-imports.mjs
 */
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(jsRoot).filter(f => !f.endsWith(`${path.sep}main.js`));
let failed = 0;
for (const f of files) {
  const rel = './' + path.relative(root, f).replace(/\\/g, '/');
  try {
    await import(pathToFileURL(path.join(root, rel)).href);
    console.log('import ok:', rel);
  } catch (e) {
    console.error('import FAIL:', rel, e.message);
    failed++;
  }
}

import { FrameTimer } from '../js/core/timer.js';
const timer = new FrameTimer();
const d0 = timer.step(1000);
const d1 = timer.step(1016.67);
if (d0 !== 0 || !(d1 > 0 && d1 < 0.05)) {
  console.error('FrameTimer FAIL: d0=', d0, 'd1=', d1);
  failed++;
} else {
  console.log('FrameTimer ok: first dt=0, second dt=', d1.toFixed(4));
}

// Simulated browser frame loop (boot + rAF)
delete globalThis.__FD_HEADLESS__;
const els = {};
function makeCtx() {
  const store = {};
  return new Proxy({}, {
    get(t, k) { if (k in store) return store[k]; if (k === 'measureText') return () => ({ width: 10 }); return () => {}; },
    set(t, k, v) { store[k] = v; return true; }
  });
}
function makeEl(id) {
  const el = {
    id, style: {}, dataset: {}, disabled: false, _cls: new Set(['hidden']),
    classList: { add: c => el._cls.add(c), remove: c => el._cls.delete(c), contains: c => el._cls.has(c) },
    innerHTML: '', textContent: '', addEventListener: () => {},
    querySelector: () => makeEl(id + '-c'), querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 730 }),
    getContext: () => makeCtx(), width: 0, height: 0
  };
  return el;
}
let rafCb = null;
globalThis.window = {
  devicePixelRatio: 2,
  addEventListener: () => {},
  requestAnimationFrame: cb => { rafCb = cb; },
  requestFullscreen: () => {}
};
globalThis.document = {
  getElementById: id => (els[id] || (els[id] = makeEl(id))),
  documentElement: { requestFullscreen: () => {} },
  exitFullscreen: () => {}
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

try {
  await import(pathToFileURL(path.join(root, 'js/main.js')).href);
  if (!rafCb) throw new Error('boot did not register rAF');
  const { FD } = await import(pathToFileURL(path.join(root, 'js/main.js')).href);
  FD.newGame('campaign', 1);
  for (let i = 0; i < 120; i++) {
    rafCb(1000 + i * 16.67);
  }
  const { Game } = await import(pathToFileURL(path.join(root, 'js/core/gameState.js')).href);
  if (Game.state !== 'play') throw new Error('expected play state after newGame');
  if (!Number.isFinite(Game.time)) throw new Error('Game.time not finite after frames');
  if (!Game.vehicles.length) throw new Error('no vehicles spawned');
  console.log('rAF loop ok: Game.time=', Game.time.toFixed(4), 'vehicles=', Game.vehicles.length);
} catch (e) {
  console.error('rAF loop FAIL:', e.message);
  failed++;
}

globalThis.__FD_HEADLESS__ = true;
process.exit(failed ? 1 : 0);
