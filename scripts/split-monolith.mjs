/**
 * One-time splitter: reads ../fuel-defense.html (or ../../fuel-defense.html)
 * and generates modular JS files under js/
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const srcHtml = fs.readFileSync(path.join(root, '..', 'fuel-defense.html'), 'utf8');

const styleMatch = srcHtml.match(/<style>([\s\S]*?)<\/style>/);
const bodyMatch = srcHtml.match(/<body>([\s\S]*?)<\/body>/);
const scriptMatch = srcHtml.match(/<script>([\s\S]*)<\/script>/);
if (!styleMatch || !bodyMatch || !scriptMatch) throw new Error('parse failed');

fs.writeFileSync(path.join(root, 'css', 'style.css'), styleMatch[1].trim() + '\n');

let htmlBody = bodyMatch[1].trim();
const indexHtml = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#10141a">
<title>Fuel Defense</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body>
${htmlBody}
<script type="module" src="js/main.js"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'index.html'), indexHtml);

let code = scriptMatch[1]
  .replace(/^"use strict";\s*/, '')
  .replace(/\bboot\(\);\s*$/, '');

// Extract CONFIG block
const configStart = code.indexOf('const CONFIG = {');
const configEnd = code.indexOf('};', configStart) + 2;
const configBody = code.slice(configStart + 'const CONFIG = '.length, configEnd - 1);
const codeWithoutConfig = code.slice(0, configStart) + code.slice(configEnd);

// Split levels from CONFIG
const levelsIdx = configBody.indexOf('levels: [');
const endlessIdx = configBody.indexOf('endless: {');
const preLevels = configBody.slice(0, levelsIdx).trim();
const levelsBlock = configBody.slice(levelsIdx, endlessIdx).trim();
const endlessBlock = configBody.slice(endlessIdx).trim().replace(/,\s*$/, '');

const write = (rel, content) => {
  const p = path.join(root, 'js', rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

write('config/constants.js', `/** Event names for EventBus (prepared for future decoupling) */
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

write('config/balance.js', `import { CONFIG as _self } from './index.js';

/** Game balance — numeric parameters (levels in levels.js) */
export const balance = {
${preLevels.replace(/^/gm, '  ')}
  pump: {
    rates:   [8, 10.5, 13.5, 17, 21],
    upCosts: [90, 150, 250, 400],
    bufferFrac: 0.05,
    bufferMax() { return _self.station.resLevels[_self.station.resLevels.length - 1] * this.bufferFrac; },
    bufferFillTime: 10,
    fastMult: 2,
    maxPerStation: 5,
    queueMax: 4,
    queueSpeed: 42
  },
};
`);

// Fix balance.js - pump was in preLevels already. Let me fix the script...

console.log('split-monolith: partial run - use manual files');
