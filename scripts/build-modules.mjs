/**
 * Generates modular JS from fuel-defense.html monolith.
 * Run: node scripts/build-modules.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const srcPath = path.join(root, '..', 'fuel-defense.html');
const html = fs.readFileSync(srcPath, 'utf8');

const style = html.match(/<style>([\s\S]*?)<\/style>/)[1].trim();
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].trim();
let js = html.match(/<script>([\s\S]*)<\/script>/)[1]
  .replace(/^"use strict";\s*/, '')
  .replace(/\bboot\(\);\s*$/, '');

fs.writeFileSync(path.join(root, 'css', 'style.css'), style + '\n');
fs.writeFileSync(path.join(root, 'index.html'), `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#10141a">
<title>Fuel Defense v0.2.0</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body>
${body}
<script type="module" src="js/main.js"></script>
</body>
</html>
`);

function w(rel, content) {
  const p = path.join(root, 'js', rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function sliceBetween(startMarker, endMarker) {
  const a = js.indexOf(startMarker);
  const b = js.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + startMarker);
  return js.slice(a, b).trim();
}

function sliceFrom(startMarker, endMarker) {
  const a = js.indexOf(startMarker);
  const b = endMarker ? js.indexOf(endMarker, a) : js.length;
  if (a < 0) throw new Error('marker not found: ' + startMarker);
  return js.slice(a, b).trim();
}

// --- config ---
const configBlock = sliceFrom('const CONFIG = {', '\n};\n\n// хуки');
w('config/levels.js', `/** Campaign and endless mode definitions */
export const levels = [
${configBlock.match(/levels:\s*\[([\s\S]*?)\],\s*\n\s*\/\*/)[1].trim()}
];

export const endless = ${configBlock.match(/endless:\s*(\{[\s\S]*\})\s*$/)[1].trim()};
`);

const balanceInner = configBlock
  .replace(/\/\*[\s\S]*?\*\/\s*levels:\s*\[[\s\S]*?\],\s*\n\s*\/\*[\s\S]*?\*\/\s*endless:\s*\{[\s\S]*\}\s*,?\s*$/, '')
  .trim();

w('config/balance.js', `/** Numeric game balance (see levels.js for campaign/endless) */
export const balance = ${balanceInner};
`);

w('config/constants.js', `/** Shared constants and event names */
export const Events = {
  VehicleSpawned: 'VehicleSpawned',
  VehicleDestroyed: 'VehicleDestroyed',
  PumpReleased: 'PumpReleased',
  StationRefilled: 'StationRefilled',
  FuelTruckArrived: 'FuelTruckArrived',
  GameLost: 'GameLost',
  GameWon: 'GameWon'
};

export const COLORS = {
  bg: '#1d232c', road: '#454c58', roadEdge: '#2a2f38',
  marking: 'rgba(230,237,243,.45)', slot: '#5a6472',
  stub: '#3a404b', apron: 'rgba(90,100,114,.22)'
};

export const CANVAS = {
  designWidth: 420,
  minHeight: 560,
  maxHeight: 940,
  maxDeltaTime: 0.05,
  maxDevicePixelRatio: 2.5
};
`);

w('config/index.js', `import { balance } from './balance.js';
import { levels, endless } from './levels.js';

export const CONFIG = { ...balance, levels, endless };
`);

// --- core ---
const utils = sliceBetween('/* ============================ УТИЛИТЫ', '/* ============================ ROAD');
w('core/utils.js', `${utils.replace(/^\/\*[\s\S]*?\*\/\s*/, '')}
`);

w('core/eventBus.js', `/** Simple pub/sub for future system decoupling */
export class EventBus {
  constructor() {
    this._handlers = new Map();
  }
  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
    return () => this._handlers.get(event).delete(fn);
  }
  emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
}
`);

w('core/timer.js', `import { CANVAS } from '../config/constants.js';

/** Frame delta-time helper */
export class FrameTimer {
  constructor() { this.lastTs = null; }
  step(ts) {
    if (this.lastTs == null) { this.lastTs = ts; return 0; }
    const dt = Math.min((ts - this.lastTs) / 1000, CANVAS.maxDeltaTime);
    this.lastTs = ts;
    return dt;
  }
}
`);

w('core/gameState.js', `${sliceFrom('const Game = {', '\n};\n\nfunction newGame')}
`);
w('core/gameState.js', `export ${sliceFrom('const Game = {', '\n};')};
`);

// Continue building other modules...
console.log('build-modules: config + utils done, building rest...');
