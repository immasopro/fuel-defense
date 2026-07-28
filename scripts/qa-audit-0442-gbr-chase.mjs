/**
 * QA 0.4.4.2 — CHASE free-lane, aggressive overtake, cut-off arrest.
 * Run: node scripts/qa-audit-0442-gbr-chase.mjs
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
    id, style: {}, dataset: {}, disabled: false, _cls: new Set(['hidden']),
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
const { mod } = await import(pathToFileURL(path.join(root, 'js/core/utils.js')).href);
const { serviceLane, exitLane, laneCount } = await import(pathToFileURL(path.join(root, 'js/world/lanes.js')).href);
const { laneList, allLaneLists } = await import(pathToFileURL(path.join(root, 'js/systems/trafficSystem.js')).href);
const { canStartOvertake, isChasePriorityGbr, updateLane } =
  await import(pathToFileURL(path.join(root, 'js/vehicles/vehicle.js')).href);
const { makeGBR, makeScalper } = await import(pathToFileURL(path.join(root, 'js/vehicles/vehicleFactory.js')).href);
const { ScalperPhase, GbrPhase, setScalperPhase } =
  await import(pathToFileURL(path.join(root, 'js/systems/entityFsm.js')).href);
const { initGbrOnSpawn, updateGBR, gbrCanArrestNow, gbrIsCuttingOff, startArrest } =
  await import(pathToFileURL(path.join(root, 'js/systems/specialVehicles.js')).href);
const { assignGbrTarget } = await import(pathToFileURL(path.join(root, 'js/systems/gbrPursuit.js')).href);

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
FD.makeGBR = makeGBR;

const findings = [];
function record(id, severity, ok, detail) {
  findings.push({ id, severity, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}/${severity}  ${id} — ${detail}`);
}

record('VER', 'CRITICAL', GameVersion.version === '0.4.4.2', `GameVersion=${GameVersion.version}`);
const CD = CONFIG.gbr.chaseDrive;
record('CFG-CAP', 'HIGH', CD.bumperCapFrac >= 0.7 && CD.outerAheadPad <= 16,
  `bumperCapFrac=${CD.bumperCapFrac} outerAheadPad=${CD.outerAheadPad}`);
record('CFG-FORCE', 'HIGH', CD.forceAheadPad < CD.outerAheadPad,
  `forceAhead=${CD.forceAheadPad} forceBehind=${CD.forceBehindPad}`);
record('CFG-CUT', 'CRITICAL', !!CD.cutOff?.passBehind, `cutOff.passBehind=${CD.cutOff?.passBehind}`);

FD.newGame('campaign', 1);
const L = Road.length;

// Bumper: CHASE behind slow car on L0 should keep higher vt than old 0.35*maxV after updateLane ticks
const slow = FD.makeCar(0);
slow.lane = 0; slow.state = 'drive'; slow.s = 500; slow.prevS = 500; slow.v = 20; slow.maxV = 25; slow.len = 22;
const gbr = makeGBR(1);
initGbrOnSpawn(gbr);
gbr.lane = 0; gbr.state = 'drive'; gbr.s = 470; gbr.prevS = 470; gbr.v = 40; gbr.maxV = 100;
const sc = makeScalper();
sc.scalperId = 55; sc.wanted = true; sc.crimeStarted = true;
sc.lane = 0; sc.state = 'drive'; sc.s = 800; sc.prevS = 800; sc.v = 55; sc.maxV = 55;
setScalperPhase(sc, ScalperPhase.DRIVING);
Game.vehicles = [slow, gbr, sc];
assignGbrTarget(gbr, sc);
record('CHASE-PRIO', 'CRITICAL', isChasePriorityGbr(gbr), `phase=${gbr.gbrPhase}`);
record('OVT-CIV', 'HIGH', canStartOvertake(gbr, slow, 20, CONFIG.follow), 'can overtake civilian');
gbr.overtake = null; gbr.overtakeToLane = null;
record('OVT-TGT', 'HIGH', canStartOvertake(gbr, sc, 20, CONFIG.follow), 'can overtake own target for cut-off');

for (let i = 0; i < 90; i++) {
  for (const list of allLaneLists()) updateLane(list, 1 / 30);
}
record('SPEED-L0', 'HIGH', gbr.v > gbr.maxV * 0.4,
  `after jam ticks v=${gbr.v.toFixed(1)} (want >40% maxV)`);

// Free lane: not forced to target lane each chase tick
gbr.lane = 2;
gbr.s = mod(sc.s - 100, L);
gbr.prevS = gbr.s;
gbr.overtake = null; gbr.laneChange = null; gbr.latOff = 0;
gbr.cutOffHoldT = 0;
const rem = new Set();
updateGBR(gbr, 1 / 30, L, rem);
record('FREE-LANE', 'CRITICAL', gbr.lane === 2 || !!gbr.laneChange,
  `lane=${gbr.lane} laneChange=${!!gbr.laneChange} (not teleported to ${sc.lane})`);

// Cut-off block → arrest
const sc2 = makeScalper();
sc2.scalperId = 56; sc2.wanted = true; sc2.crimeStarted = true;
sc2.lane = 1; sc2.state = 'drive'; sc2.s = 300; sc2.prevS = 300; sc2.v = 30;
setScalperPhase(sc2, ScalperPhase.DRIVING);
const g2 = makeGBR(2);
initGbrOnSpawn(g2);
g2.lane = 1; g2.state = 'drive'; g2.s = 318; g2.prevS = 318; g2.v = 40; g2.maxV = 100;
g2.cutOffHoldT = 0.3;
Game.vehicles = [sc2, g2];
assignGbrTarget(g2, sc2);
record('CUT-GEOM', 'CRITICAL', gbrIsCuttingOff(g2, sc2, L), 'GBR ahead same lane blocks');
record('CUT-ARREST', 'CRITICAL', gbrCanArrestNow(g2, sc2), 'cut-off allows arrest');
updateGBR(g2, 1 / 30, L, new Set());
record('CUT-PHASE', 'CRITICAL',
  g2.gbrPhase === GbrPhase.ARREST && sc2.scalperPhase === ScalperPhase.ARRESTING,
  `gbr=${g2.gbrPhase} sc=${sc2.scalperPhase}`);

const failed = findings.filter(f => !f.ok);
const criticalFail = failed.filter(f => f.severity === 'CRITICAL');
const verdict = criticalFail.length ? 'FAIL' : (failed.length ? 'PASS_WITH_WARNINGS' : 'PASS');

const md = [
  '# QA 0.4.4.2 — CHASE free-lane / cut-off arrest',
  '',
  `Version: ${GameVersion.version} | lanes: ${laneCount()}`,
  `Verdict: **${verdict}** (${findings.filter(f => f.ok).length}/${findings.length} pass)`,
  '',
  '## Results',
  ...findings.map(f => `- [${f.ok ? 'x' : ' '}] **${f.id}** (${f.severity}): ${f.detail}`),
  ''
].join('\n');

fs.writeFileSync(path.join(root, 'docs/QA_0442_GBR_CHASE_AUDIT.md'), md);
fs.writeFileSync(path.join(root, 'docs/qa-0442-gbr-chase-raw.json'),
  JSON.stringify({ version: GameVersion.version, verdict, findings }, null, 2));
console.log('\nVerdict:', verdict);
process.exit(criticalFail.length ? 1 : 0);
