import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, '..', 'fuel-defense.html'), 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1]
  .replace(/^"use strict";\s*/, '')
  .replace(/\bboot\(\);\s*$/, '');

function between(a, b) {
  const i = js.indexOf(a);
  const j = js.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('marker: ' + a);
  return js.slice(i, j).trim();
}

const sections = {
  utils: between('const clamp', '/* ============================ ROAD'),
  road: between('const Road = {', '/* ============================ STATION'),
  station: between('class Pump', '/* ============================ НЕФТЕБАЗА'),
  depot: between('const Depot = {', '/* ============================ БАЗА ГБР'),
  gbrbase: between('const GBRBase = {', 'function hitGBRBase'),
  hits: between('function hitGBRBase', '/* ============================ VEHICLES'),
  vehicles: between('function baseVehicle', '/* ============================ GAME'),
  gamechunk: between('function newGame', '/* ============================ RENDER'),
  render: between('const COLORS = {', '/* ============================ UI'),
  ui: between('const UI = {}', '/* ============================ ЦИКЛ'),
  boot: between('function boot()', '/* =====================================================================\n *  CONFIG'),
  config: between('const CONFIG = {', '};'),
  gamestate: between('const Game = {', '};'),
};

const out = path.join(__dirname, 'chunks');
fs.mkdirSync(out, { recursive: true });
for (const [k, v] of Object.entries(sections)) {
  fs.writeFileSync(path.join(out, k + '.js'), v + '\n');
  console.log(k, v.split('\n').length);
}
