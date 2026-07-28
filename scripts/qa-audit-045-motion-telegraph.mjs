/**
 * QA 0.4.5 — Motion feel + DT/GBR colors + AZS GBR-call alarm.
 * Run: node scripts/qa-audit-045-motion-telegraph.mjs
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function makeCtx() {
  const store = {};
  return new Proxy({}, {
    get(t, k) {
      if (k in store) return store[k];
      if (k === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set(t, k, v) { store[k] = v; return true; }
  });
}
function makeEl(id) {
  const el = {
    id, style: {}, dataset: {}, _cls: new Set(['hidden']),
    classList: { add: c => el._cls.add(c), remove: c => el._cls.delete(c), contains: c => el._cls.has(c) },
    innerHTML: '', textContent: '', addEventListener: () => {},
    querySelector: () => makeEl(id + '-c'), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 730 }),
    getContext: () => makeCtx(), width: 0, height: 0
  };
  return el;
}
const els = {};
globalThis.__FD_HEADLESS__ = true;
globalThis.window = { devicePixelRatio: 2, addEventListener: () => {}, requestAnimationFrame: () => {} };
globalThis.document = {
  getElementById: id => (els[id] || (els[id] = makeEl(id))),
  documentElement: { style: { setProperty: () => {} }, dataset: {}, classList: { add() {}, remove() {} } },
  body: { appendChild: () => {} },
  addEventListener: () => {},
  createElement: () => makeEl('x')
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };

const { FD } = await import(pathToFileURL(path.join(root, 'js/main.js')).href);
const { Road } = await import(pathToFileURL(path.join(root, 'js/world/roadNetwork.js')).href);
const { Depot, GBRBase } = await import(pathToFileURL(path.join(root, 'js/world/map.js')).href);
const { Game } = await import(pathToFileURL(path.join(root, 'js/core/gameState.js')).href);
const { CONFIG } = await import(pathToFileURL(path.join(root, 'js/config/index.js')).href);
const { GameVersion } = await import(pathToFileURL(path.join(root, 'js/config/gameVersion.js')).href);
const { UI } = await import(pathToFileURL(path.join(root, 'js/ui/hud.js')).href);
const { beginLaneShift, updateLane } = await import(pathToFileURL(path.join(root, 'js/vehicles/vehicle.js')).href);
const { laneList } = await import(pathToFileURL(path.join(root, 'js/systems/trafficSystem.js')).href);
const { stationNeedsGbrCall } = await import(pathToFileURL(path.join(root, 'js/systems/gbrPursuit.js')).href);
const { ScalperPhase, setScalperPhase } = await import(pathToFileURL(path.join(root, 'js/systems/entityFsm.js')).href);
const { makeGBR } = await import(pathToFileURL(path.join(root, 'js/vehicles/vehicleFactory.js')).href);
const { drawVehicle } = await import(pathToFileURL(path.join(root, 'js/ui/renderer.js')).href);

const stubEl = () => ({ classList: { add: () => {}, remove: () => {} }, style: {}, textContent: '', innerHTML: '' });
for (const k of ['warning', 'panel', 'statMoney', 'statBonuses', 'statTraffic', 'statTime',
  'tankerSub', 'gbrSub', 'gbrTitle', 'lightSub', 'endTitle', 'endDesc', 'endStats',
  'btnRestart', 'btnMenu']) UI[k] = stubEl();
UI.btnTanker = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnGbr = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnLight = stubEl(); UI.btnSpeed = stubEl(); UI.btnNext = stubEl(); UI.screenEnd = stubEl();

Road.build(420, 730);
Depot.init();
GBRBase.init();

const findings = [];
function record(id, severity, ok, detail) {
  findings.push({ id, severity, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}/${severity}  ${id} — ${detail}`);
}

record('VER', 'CRITICAL', GameVersion.version === '0.4.5', `GameVersion=${GameVersion.version}`);
record('DT-COLOR', 'CRITICAL', CONFIG.fuels.diesel.color.toLowerCase() === '#6d4c41',
  `diesel=${CONFIG.fuels.diesel.color}`);
record('MF-CFG', 'HIGH', (CONFIG.motionFeel?.laneSteer ?? 0) >= 0.25,
  `laneSteer=${CONFIG.motionFeel?.laneSteer}`);

FD.newGame('campaign', 1);
const car = FD.makeCar(0);
car.lane = 0; car.state = 'drive'; car.s = 200; car.prevS = 200; car.v = 50;
Game.vehicles = [car];
beginLaneShift(car, 1, { dur: 1.0 });
let maxSteer = 0;
for (let i = 0; i < 40; i++) {
  updateLane(laneList(car.laneChange ? car.laneChange.from : car.lane), 0.05);
  maxSteer = Math.max(maxSteer, Math.abs(car.visualSteer || 0));
}
record('STEER', 'HIGH', maxSteer > 0.08, `max|steer|=${maxSteer.toFixed(3)}`);
record('ROLL', 'HIGH', Math.abs(car.visualRoll || 0) > 0.02 || maxSteer > 0.1,
  `roll=${(car.visualRoll || 0).toFixed(3)}`);

// GBR draw path does not throw
const g = makeGBR(1);
g.lane = 0; g.state = 'drive'; g.s = 10; g.prevS = 10;
const ctx = makeCtx();
try {
  drawVehicle(ctx, g);
  record('GBR-DRAW', 'HIGH', true, 'drawVehicle(gbr) ok');
} catch (e) {
  record('GBR-DRAW', 'HIGH', false, String(e.message || e));
}

FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[1], 'diesel');
const slot = Road.slots[1];
const sc = FD.makeScalper();
sc.wanted = true; sc.crimeStarted = true; sc.alarmStationId = slot.i; sc.pursuedBy = null;
sc.scalperId = 88;
setScalperPhase(sc, ScalperPhase.DRIVING);
Game.vehicles = [sc];
record('ALARM-ON', 'CRITICAL', stationNeedsGbrCall(slot), 'needs call when unpursued');
sc.pursuedBy = 3;
record('ALARM-OFF', 'CRITICAL', !stationNeedsGbrCall(slot), 'clears when pursued');

const failed = findings.filter(f => !f.ok);
const criticalFail = failed.filter(f => f.severity === 'CRITICAL');
const verdict = criticalFail.length ? 'FAIL' : (failed.length ? 'PASS_WITH_WARNINGS' : 'PASS');

const md = [
  '# QA 0.4.5 — Motion / telegraph colors / AZS alarm',
  '',
  `Version: ${GameVersion.version}`,
  `Verdict: **${verdict}** (${findings.filter(f => f.ok).length}/${findings.length} pass)`,
  '',
  '## Results',
  ...findings.map(f => `- [${f.ok ? 'x' : ' '}] **${f.id}** (${f.severity}): ${f.detail}`),
  ''
].join('\n');

fs.writeFileSync(path.join(root, 'docs/QA_045_MOTION_TELEGRAPH_AUDIT.md'), md);
fs.writeFileSync(path.join(root, 'docs/qa-045-motion-telegraph-raw.json'),
  JSON.stringify({ version: GameVersion.version, verdict, findings }, null, 2));
console.log('\nVerdict:', verdict);
process.exit(criticalFail.length ? 1 : 0);
