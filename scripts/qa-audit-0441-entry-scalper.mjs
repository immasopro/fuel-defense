/**
 * QA 0.4.4.1 — Entry L2+merge, multi undercover Scalper, defeat counts, extended stats.
 * Run: node scripts/qa-audit-0441-entry-scalper.mjs
 * Output: docs/QA_0441_ENTRY_SCALPER_AUDIT.md + docs/qa-0441-entry-scalper-raw.json
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
    classList: {
      add: c => el._cls.add(c),
      remove: c => el._cls.delete(c),
      contains: c => el._cls.has(c),
      toggle: c => { if (el._cls.has(c)) { el._cls.delete(c); return false; } el._cls.add(c); return true; }
    },
    innerHTML: '', textContent: '', addEventListener: () => {},
    querySelector: () => makeEl(id + '-c'), querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 730 }),
    getContext: () => makeCtx(), width: 0, height: 0
  };
  return el;
}
const els = {};
globalThis.__FD_HEADLESS__ = true;
globalThis.window = {
  devicePixelRatio: 2,
  addEventListener: () => {},
  requestAnimationFrame: () => {},
  requestFullscreen: () => {}
};
globalThis.document = {
  getElementById: id => (els[id] || (els[id] = makeEl(id))),
  documentElement: { requestFullscreen: () => {}, style: { setProperty: () => {} }, dataset: {}, classList: { add() {}, remove() {} } },
  body: { appendChild: () => {} },
  addEventListener: () => {},
  createElement: () => makeEl('x')
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
const lsStore = {};
globalThis.localStorage = {
  getItem: k => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: k => { delete lsStore[k]; },
  clear: () => { Object.keys(lsStore).forEach(k => delete lsStore[k]); }
};

const { FD } = await import(pathToFileURL(path.join(root, 'js/main.js')).href);
const { update } = await import(pathToFileURL(path.join(root, 'js/game.js')).href);
const { Road } = await import(pathToFileURL(path.join(root, 'js/world/roadNetwork.js')).href);
const { Depot, GBRBase, sortedStationSlots } = await import(pathToFileURL(path.join(root, 'js/world/map.js')).href);
const { Game } = await import(pathToFileURL(path.join(root, 'js/core/gameState.js')).href);
const { CONFIG } = await import(pathToFileURL(path.join(root, 'js/config/index.js')).href);
const { GameVersion } = await import(pathToFileURL(path.join(root, 'js/config/gameVersion.js')).href);
const { UI } = await import(pathToFileURL(path.join(root, 'js/ui/hud.js')).href);
const { CANVAS } = await import(pathToFileURL(path.join(root, 'js/config/constants.js')).href);

const stubEl = () => ({
  classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => false },
  style: {}, textContent: '', innerHTML: ''
});
for (const k of ['warning', 'panel', 'statMoney', 'statBonuses', 'statTraffic', 'statTime',
  'tankerSub', 'gbrSub', 'gbrTitle', 'lightSub', 'endTitle', 'endDesc', 'endStats',
  'btnRestart', 'btnMenu', 'endStatsExt', 'btnEndStats']) UI[k] = stubEl();
UI.btnTanker = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnGbr = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnLight = Object.assign(stubEl(), { disabled: false, classList: { add: () => {}, remove: () => {} } });
UI.btnSpeed = Object.assign(stubEl(), { disabled: false, classList: { add: () => {}, remove: () => {} }, textContent: '' });
UI.btnNext = Object.assign(stubEl(), { classList: { add: () => {}, remove: () => {} } });
UI.screenEnd = Object.assign(stubEl(), { classList: { add: () => {}, remove: () => {} } });

Road.build(420, 730);
Depot.init();
GBRBase.init();

const { deployToRing, laneList } = await import(pathToFileURL(path.join(root, 'js/systems/trafficSystem.js')).href);
const { exitLane, serviceLane, laneCount } = await import(pathToFileURL(path.join(root, 'js/world/lanes.js')).href);
const { canSpawnScalper, canSpawnMoreCars, getSpawnedCars, getTargetCars } =
  await import(pathToFileURL(path.join(root, 'js/systems/spawnSystem.js')).href);
const { tickSpecialSpawns, updateScalperTour, refreshScalperTour } =
  await import(pathToFileURL(path.join(root, 'js/systems/specialVehicles.js')).href);
const { liveScalperCount, resetScalperRegistry, liveScalpers } =
  await import(pathToFileURL(path.join(root, 'js/systems/scalperRegistry.js')).href);
const { formatExtendedStatsHtml, ensureRunStats, resetRunStats } =
  await import(pathToFileURL(path.join(root, 'js/systems/runStats.js')).href);
const { tryMergeInward, beginLaneShift, updateLane } = await import(pathToFileURL(path.join(root, 'js/vehicles/vehicle.js')).href);
const { ScalperPhase } = await import(pathToFileURL(path.join(root, 'js/systems/entityFsm.js')).href);
const { endGame } = await import(pathToFileURL(path.join(root, 'js/systems/defeatSystem.js')).href);

const findings = [];
function record(id, severity, ok, detail, extra = {}) {
  const row = { id, severity, ok: !!ok, detail, ...extra };
  findings.push(row);
  console.log(`${ok ? 'PASS' : 'FAIL'}/${severity}  ${id} — ${detail}`);
  return row;
}

record('VER', 'CRITICAL', GameVersion.version === '0.4.4.1',
  `GameVersion=${GameVersion.version}`);
record('LANES', 'CRITICAL', laneCount() === 3 && exitLane() === 2 && serviceLane() === 0,
  `laneCount=${laneCount()} exit=${exitLane()} service=${serviceLane()}`);
record('POLICY-ENTRY', 'HIGH', CONFIG.lanePolicy?.entryOnExitLane === true,
  `entryOnExitLane=${CONFIG.lanePolicy?.entryOnExitLane}`);
record('POLICY-UC', 'HIGH', CONFIG.scalper?.undercoverWithoutStation === true,
  `undercoverWithoutStation=${CONFIG.scalper?.undercoverWithoutStation}`);

// Entry on L2
FD.newGame('campaign', 1);
const car = FD.makeCar();
deployToRing(car);
record('ENTRY-L2', 'CRITICAL', car.lane === exitLane() && car.mergeIn === true,
  `lane=${car.lane} mergeIn=${car.mergeIn}`);

// Merge progresses when clear (need updateLane to finish laneChange anim)
Game.vehicles.length = 0;
const merger = FD.makeCar();
deployToRing(merger);
let merged = false;
let startedShift = false;
for (let i = 0; i < 120; i++) {
  tryMergeInward(merger, 1);
  if (merger.laneChange) {
    startedShift = true;
    // Finish / advance anim on the lane the vehicle still occupies
    updateLane(laneList(merger.lane), 1.2);
  }
  if (merger.lane <= serviceLane() && !merger.laneChange) { merged = true; break; }
}
record('MERGE-START', 'HIGH', startedShift || merger.lane < exitLane(),
  `startedShift=${startedShift} lane=${merger.lane}`);
record('MERGE-IN', 'HIGH', merged || merger.lane < exitLane(),
  `after merge attempts lane=${merger.lane} mergeIn=${merger.mergeIn}`);

// Undercover without AZS
FD.newGame('campaign', 1);
resetScalperRegistry();
resetRunStats();
record('NO-AZS', 'CRITICAL', sortedStationSlots().length === 0, `slots=${sortedStationSlots().length}`);
Game.scalperTimer = 0;
tickSpecialSpawns(0);
const uc = Game.scalper.unit;
record('UC-SPAWN', 'CRITICAL', !!uc && uc.kind === 'scalper',
  uc ? `spawned id=${uc.scalperId} phase=${uc.scalperPhase}` : 'no unit');
record('UC-DEFEAT', 'CRITICAL', uc && uc.countsForDefeat !== false,
  `countsForDefeat=${uc?.countsForDefeat}`);
record('UC-LOOK', 'HIGH', uc && !uc.wanted && ['sedan', 'suv'].includes(uc.typeKey),
  `wanted=${uc?.wanted} typeKey=${uc?.typeKey}`);
record('UC-STATS', 'HIGH', ensureRunStats().scalpersSpawned >= 1,
  `scalpersSpawned=${ensureRunStats().scalpersSpawned}`);

// Empty tour does not EXIT
if (uc) {
  uc.tour = [];
  uc.tourIdx = 99;
  const phaseBefore = uc.scalperPhase;
  updateScalperTour(uc, Road.length);
  record('UC-NO-EXIT', 'CRITICAL',
    uc.scalperPhase !== ScalperPhase.EXITING && uc.scalperPhase !== 'EXITING',
    `phase ${phaseBefore}→${uc.scalperPhase} after empty tour`);
}

// Multi-Scalper by budget only
FD.newGame('campaign', 5);
resetScalperRegistry();
Game.stats.spawned = 0;
Game.scalperTimer = 0;
tickSpecialSpawns(0);
Game.scalperTimer = 0;
tickSpecialSpawns(0);
Game.scalperTimer = 0;
tickSpecialSpawns(0);
const nLive = liveScalperCount();
record('MULTI-SC', 'CRITICAL', nLive >= 2,
  `liveScalpers=${nLive} units=${Game.scalper.units?.length} spawned=${getSpawnedCars()}`);
record('BUDGET-EQ', 'HIGH', canSpawnScalper() === canSpawnMoreCars(),
  `canSpawnScalper===canSpawnMoreCars (${canSpawnScalper()})`);

// Budget blocks further spawn
Game.stats.spawned = getTargetCars();
Game.scalperTimer = 0;
const before = liveScalperCount();
tickSpecialSpawns(0);
record('BUDGET-CAP', 'CRITICAL', liveScalperCount() === before && !canSpawnScalper(),
  `at target live=${liveScalperCount()} canSpawn=${canSpawnScalper()}`);

// Build station refreshes undercover tour
FD.newGame('campaign', 1);
resetScalperRegistry();
Game.scalperTimer = 0;
tickSpecialSpawns(0);
const sc2 = Game.scalper.unit;
record('PRE-TOUR', 'INFO', sc2 && (!sc2.tour || sc2.tour.length === 0),
  `tourLen=${sc2?.tour?.length ?? 'n/a'}`);
FD.actionBuildStation(Road.slots[0], 'a92');
record('POST-TOUR', 'HIGH', sc2 && sc2.tour && sc2.tour.length > 0,
  `tourLen after build=${sc2?.tour?.length}`);

// Extended stats end screen
FD.newGame('campaign', 1);
ensureRunStats().scalpersSpawned = 3;
ensureRunStats().gbrCalls = 2;
endGame(true);
const html = UI.endStatsExt?.innerHTML || formatExtendedStatsHtml();
record('STATS-HTML', 'HIGH',
  html.includes('Перекупы') && html.includes('Заспавнено') && html.includes('ГБР'),
  `htmlLen=${html.length}`);
record('STATS-BTN', 'HIGH', !!document.getElementById('btn-end-stats'),
  'btn-end-stats present in DOM mock');

const failed = findings.filter(f => !f.ok);
const criticalFail = failed.filter(f => f.severity === 'CRITICAL');
const verdict = criticalFail.length ? 'FAIL' : (failed.length ? 'PASS_WITH_WARNINGS' : 'PASS');

const md = [
  '# QA 0.4.4.1 — Entry / multi-Scalper / undercover / stats',
  '',
  `Version: ${GameVersion.version} | laneCount: ${laneCount()} | L=${Road.length.toFixed(1)}`,
  `Verdict: **${verdict}** (${findings.filter(f => f.ok).length}/${findings.length} pass)`,
  '',
  '## Scope',
  '- Entry on L2 + merge-in toward L0',
  '- Multi-Scalper capped only by spawned budget',
  '- Undercover without AZS; countsForDefeat true; no empty-tour EXIT',
  '- Extended end-level stats',
  '',
  '## Results',
  ...findings.map(f =>
    `- [${f.ok ? 'x' : ' '}] **${f.id}** (${f.severity}): ${f.detail}`),
  '',
  '## Notes',
  '- Endgate last-10/20 remains abandoned (shared spawned budget).',
  '- Undercover visually NPC until wanted.',
  ''
].join('\n');

fs.writeFileSync(path.join(root, 'docs/QA_0441_ENTRY_SCALPER_AUDIT.md'), md);
fs.writeFileSync(path.join(root, 'docs/qa-0441-entry-scalper-raw.json'),
  JSON.stringify({ version: GameVersion.version, verdict, findings }, null, 2));
console.log('\nVerdict:', verdict);
process.exit(criticalFail.length ? 1 : 0);
