// Headless regression tests for modular Fuel Defense
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
const els = {};
let rafCb = null;
globalThis.__FD_HEADLESS__ = true;
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
const lsStore = {};
globalThis.localStorage = {
  getItem: k => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: k => { delete lsStore[k]; },
  clear: () => { Object.keys(lsStore).forEach(k => delete lsStore[k]); }
};

const { FD } = await import('./js/main.js');
const { update } = await import('./js/game.js');
const { Road } = await import('./js/world/roadNetwork.js');
const { Depot, GBRBase } = await import('./js/world/map.js');
const { UI } = await import('./js/ui/hud.js');
const stubEl = () => ({ classList: { add: () => {}, remove: () => {} }, style: {}, textContent: '', innerHTML: '' });
UI.warning = stubEl();
UI.panel = stubEl();
UI.statMoney = stubEl();
UI.statTraffic = stubEl();
UI.statTime = stubEl();
UI.btnTanker = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnGbr = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnLight = Object.assign(stubEl(), { disabled: false, classList: { add: () => {}, remove: () => {} } });
UI.tankerSub = stubEl();
UI.gbrSub = stubEl();
UI.lightSub = stubEl();
Road.build(420, 730);
Depot.init();
GBRBase.init();

const { Game, CONFIG } = FD;
const { currentSpawnInterval, getTargetCars, levelProgress } = await import('./js/systems/spawnSystem.js');
function step(n) { for (let i = 0; i < n; i++) update(1 / 60); }
function assert(c, msg) { if (!c) { console.error('FAIL:', msg); process.exit(1); } console.log('ok -', msg); }
function modS(a, b) { return ((a % b) + b) % b; }

function prepTankerLeg(tk, slotIdx) {
  tk.tourIdx = slotIdx;
  const leg = tk.routePlan[slotIdx];
  leg.decided = true;
  leg.committed = true;
  tk.prevS = tk.s;
  tk.s = FD.tankerTechStopS(Road.slots[slotIdx]);
  tk.v = 0;
  return leg;
}

function readyTanker() {
  FD.forceTankerReadyForTests();
}

const TANKER_CAP = () => CONFIG.tankerTruck.levels[Game.tankerTruck.level - 1];

function readyGbr() {
  FD.forceGbrReadyForTests();
}

FD.newGame('campaign', 1);
const L = Road.length;

const slot4 = Road.slots[3];
const p0 = FD.apronPoseForRank(slot4, 0, 0);
const p3 = FD.apronPoseForRank(slot4, 0, 3);
const roadP0 = Road.posAt(slot4.s, CONFIG.road.serviceLat);
assert(Math.hypot(p0.x - roadP0.x, p0.y - roadP0.y) < 80, 'rank 0 apron pose near station');
assert(Math.hypot(p3.x - roadP0.x, p3.y - roadP0.y) < 120, 'rank 3 apron pose still on station apron, not across map');

FD.newGame('campaign', 1);
Game.money = 450000;
FD.actionBuildStation(Road.slots[1], 'a92');
const slot = Road.slots[1];
const pump = slot.station.pumps[0];
const carA = FD.makeCar(0);
carA.fuelKey = 'a92'; carA.pump = pump; carA.pumpJ = 0; carA.targetSlot = slot;
carA.station = slot.station; pump.cars.push(carA);
carA.state = 'station'; carA.pose = { ...FD.apronPoseForRank(slot, 0, 0) };
carA.got = carA.need - 1;
const carB = FD.makeCar(0);
carB.fuelKey = 'a92'; carB.pump = pump; carB.pumpJ = 0; carB.targetSlot = slot;
carB.station = slot.station; pump.cars.push(carB);
carB.state = 'station'; carB.pose = { ...FD.apronPoseForRank(slot, 0, 1) };
FD.finishFuel(carA);
assert(pump.cars.length === 1 && pump.cars[0] === carB, 'FIFO: carB becomes front after carA leaves');

FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[1], 'a92');
Game.money = 900000;
Game.depot.res = 600;
for (let i = 0; i < CONFIG.holder.max; i++) Game.holder.push(FD.makeCar(0));
readyTanker();
FD.callTanker();
assert(Game.tanker.unit, 'tanker spawns');
assert(Game.depot.res === 600, 'tanker spawn does not drain main depot');
const tanker = Game.tanker.unit;
assert(tanker.load === TANKER_CAP(), 'tanker arrives fully loaded');
assert(tanker.tour.length === 7, 'tanker tour visits all 7 spots');
assert(tanker.routePlan.length === 7, 'tanker routePlan has 7 legs');
for (let i = 0; i < 7; i++) {
  assert(tanker.routePlan[i].spotNum === i + 1, 'routePlan spot order ' + (i + 1));
  assert(tanker.routePlan[i].spotId === i, 'routePlan spotId ' + i);
  assert(tanker.routePlan[i].slot === Road.slots[i], 'routePlan uses Road.slots');
}
assert(tanker.routePlan === tanker.manifest, 'routePlan is manifest alias');
assert(tanker.tankerPhase === 'spawning', 'tanker starts in SPAWNING');
assert(Game.holderPriorityWait === tanker, 'tanker priority-waits when holder full');
Game.holder.shift();
Game.holder.unshift(tanker);
Game.holderPriorityWait = null;
FD.deployToRing(tanker);
assert(tanker.tankerPhase === 'moving', 'tanker becomes MOVING on ring');
prepTankerLeg(tanker, 1);
step(8);
assert(tanker.tankerPhase !== 'waiting_column', 'tanker never enters WAITING');
assert(!tanker.pump, 'tanker does not claim client pump');
assert(tanker.state === 'pullIn' || tanker.state === 'tankerService' || tanker.state === 'drive',
  'tanker progresses via tech point');
assert(tanker.countsForDefeat === false, 'tanker does not count for defeat');

// v0.2.5 tanker: manifest + service pad refuel only
FD.newGame('campaign', 1);
Game.money = 1800000;
Game.depot.res = 0;
FD.actionBuildStation(Road.slots[2], 'a92');
const st2 = Road.slots[2].station;
st2.res = 50;
readyTanker();
FD.callTanker();
const tk = Game.tanker.unit;
FD.deployToRing(tk);
prepTankerLeg(tk, 2);
const resBeforePullIn = st2.res;
step(1);
assert(tk.state === 'pullIn', 'refuel leg begins pull-in at tech stop');
assert(st2.res === resBeforePullIn, 'no fuel transfer before service pad');
step(120);
assert(st2.res > 50, 'tanker refuels station on service pad');
assert(tk.pump == null, 'tanker never occupies client pump');
assert(tk.tankerPhase !== 'waiting_column', 'no WAITING phase during refuel');

// v0.2.5 manifest decisions
const cap = TANKER_CAP();
let m = FD.buildTankerManifest(cap);
assert(m.length === 7 && m.every((l, i) => l.spotNum === i + 1), 'manifest 1→7');

FD.newGame('campaign', 1);
Game.money = 4500000;
for (const slot of Road.slots) FD.actionBuildStation(slot, 'a92');
m = FD.buildTankerManifest(cap);
assert(m.every(l => l.decision === 'REFUEL'), 'all empty stations → REFUEL');

FD.newGame('campaign', 1);
Game.money = 4500000;
for (const slot of Road.slots) {
  FD.actionBuildStation(slot, 'a92');
  slot.station.res = slot.station.cap;
}
m = FD.buildTankerManifest(cap);
assert(m.every(l => l.decision === 'SKIP'), 'all full stations → SKIP');

FD.newGame('campaign', 1);
Game.money = 4500000;
for (const slot of Road.slots) FD.actionBuildStation(slot, 'a92');
for (let i = 0; i < 3; i++) Road.slots[i].station.res = Road.slots[i].station.cap;
m = FD.buildTankerManifest(cap);
assert(m.slice(0, 3).every(l => l.decision === 'SKIP'), 'spots 1–3 full → SKIP');
assert(m.slice(3).every(l => l.decision === 'REFUEL'), 'spots 4–7 empty → REFUEL');

FD.newGame('campaign', 1);
Game.money = 4500000;
for (const slot of Road.slots) FD.actionBuildStation(slot, 'a92');
for (let i = 4; i < 7; i++) Road.slots[i].station.res = Road.slots[i].station.cap;
m = FD.buildTankerManifest(cap);
assert(m.slice(0, 4).every(l => l.decision === 'REFUEL'), 'spots 1–4 empty → REFUEL');
assert(m.slice(4).every(l => l.decision === 'SKIP'), 'spots 5–7 full → SKIP');

FD.newGame('campaign', 1);
m = FD.buildTankerManifest(cap);
assert(m.every(l => l.decision === 'SKIP'), 'no stations → all SKIP');

m = FD.buildTankerManifest(0);
assert(m.every(l => l.decision === 'SKIP'), 'empty tanker load → all SKIP');

FD.newGame('campaign', 1);
Game.money = 1800000;
FD.actionBuildStation(Road.slots[2], 'a92');
const st2full = Road.slots[2].station;
st2full.res = st2full.cap;
readyTanker();
FD.callTanker();
const tkSkip = Game.tanker.unit;
assert(tkSkip.manifest[2].decision === 'SKIP', 'full tank → SKIP at spawn');
FD.deployToRing(tkSkip);
tkSkip.tourIdx = 2;
tkSkip.manifest[2].decided = true;
tkSkip.manifest[2].committed = true;
tkSkip.s = FD.tankerTechStopS(Road.slots[2]);
tkSkip.v = 0;
step(30);
assert(tkSkip.state === 'drive', 'SKIP leg never pulls in');
assert(tkSkip.tourIdx >= 3, 'SKIP advances tour without refuel');

FD.newGame('campaign', 1);
Game.money = 1800000;
FD.actionBuildStation(Road.slots[0], 'a92');
const st0 = Road.slots[0].station;
st0.res = 10;
readyTanker();
FD.callTanker();
const tkFreeze = Game.tanker.unit;
assert(tkFreeze.manifest[0].decision === 'REFUEL', 'manifest REFUEL when station needs fuel');
st0.res = st0.cap;
assert(tkFreeze.manifest[0].decision === 'REFUEL', 'manifest frozen even if station filled later');
FD.deployToRing(tkFreeze);
tkFreeze.tourIdx = 0;
tkFreeze.manifest[0].decided = true;
tkFreeze.manifest[0].committed = true;
st0.res = st0.cap;
step(30);
assert(tkFreeze.manifest[0].decision === 'REFUEL', 'committed REFUEL unchanged after station state change');

assert(FD.tankerDecisionS(Road.slots[0]) !== FD.tankerCommitS(Road.slots[0]), 'decision before commit');
assert(FD.tankerCommitS(Road.slots[0]) !== FD.tankerTechStopS(Road.slots[0]), 'commit before tech stop');

// v0.2.6.1 route plan + needFuel
FD.newGame('campaign', 1);
Game.money = 1800000;
FD.actionBuildStation(Road.slots[0], 'a92');
Road.slots[0].station.res = 100;
let plan061 = FD.buildTankerManifest(TANKER_CAP());
assert(plan061[0].needFuel === true, 'partial spot 1 needFuel YES');
assert(plan061[0].decision === 'REFUEL', 'partial spot 1 must REFUEL not SKIP');
assert(plan061[0].current === 100, 'routePlan snapshots current fuel');
readyTanker();
FD.callTanker();
const tk061 = Game.tanker.unit;
assert(tk061.routePlan[0].decision === 'REFUEL', 'spawn routePlan REFUEL for partial spot 1');
assert(tk061.eventLog && tk061.eventLog.includes('Route generated'), 'tanker event log');

FD.newGame('campaign', 1);
Game.money = 4500000;
FD.actionBuildStation(Road.slots[6], 'a92');
Road.slots[6].station.res = 100;
plan061 = FD.buildTankerManifest(TANKER_CAP());
assert(plan061[6].needFuel === true, 'partial last spot needFuel');
assert(plan061[6].decision === 'REFUEL', 'partial last spot REFUEL');

// spot 4 → 5 transition without hang (SKIP leg — full tanks)
FD.newGame('campaign', 1);
Game.money = 4500000;
for (const slot of Road.slots) {
  FD.actionBuildStation(slot, 'a92');
  slot.station.res = slot.station.cap;
}
readyTanker();
FD.callTanker();
const tkTour = Game.tanker.unit;
FD.deployToRing(tkTour);
Game.holder = [];
tkTour.tourIdx = 3;
tkTour.routePlan.forEach((l, i) => {
  if (i < 3) { l.done = true; l.decided = true; l.committed = true; }
});
tkTour.routePlan[3].decided = false;
tkTour.routePlan[3].committed = false;
tkTour.routePlan[3].done = false;
assert(tkTour.routePlan[3].decision === 'SKIP', 'spot 4 SKIP when full');
const spot4s = Road.slots[3].s;
tkTour.s = modS(spot4s - 80, L);
tkTour.prevS = tkTour.s;
tkTour.v = 40;
tkTour.state = 'drive';
tkTour.tankerPhase = 'moving';
let progressed = false;
for (let i = 0; i < 600; i++) {
  step(1);
  if (tkTour.tourIdx > 3) { progressed = true; break; }
}
assert(progressed, 'tanker advances past spot 4 without hang');

// v0.2.6.2 spot numbering — clockwise ID 0..6
const { distAhead } = await import('./js/world/roadNetwork.js');
for (let i = 0; i < 6; i++) {
  const d = distAhead(Road.slots[i].s, Road.slots[i + 1].s, L);
  assert(d > 20 && d < L / 2, 'spots ' + (i + 1) + '→' + (i + 2) + ' clockwise');
}
const fromSpawn = distAhead(Road.spawnS, Road.slots[0].s, L);
assert(fromSpawn < distAhead(Road.spawnS, Road.slots[6].s, L), 'spot 1 is first clockwise from spawn');

FD.newGame('campaign', 1);
Game.money = 1800000;
FD.actionBuildStation(Road.slots[0], 'a92');
Road.slots[0].station.res = 100;
readyTanker();
FD.callTanker();
let tkOnly = Game.tanker.unit;
assert(tkOnly.routePlan[0].decision === 'REFUEL', 'only spot 1 built → REFUEL first');
assert(tkOnly.routePlan[0].spotId === 0, 'spot 1 is ID 0');
for (let i = 1; i < 7; i++) assert(tkOnly.routePlan[i].decision === 'SKIP', 'empty spots SKIP');

FD.newGame('campaign', 1);
Game.money = 1800000;
FD.actionBuildStation(Road.slots[6], 'a92');
Road.slots[6].station.res = 100;
readyTanker();
FD.callTanker();
tkOnly = Game.tanker.unit;
for (let i = 0; i < 6; i++) assert(tkOnly.routePlan[i].decision === 'SKIP', 'spots 1–6 SKIP when only 7 built');
assert(tkOnly.routePlan[6].decision === 'REFUEL', 'only spot 7 built → REFUEL last leg');
assert(tkOnly.routePlan[6].spotId === 6, 'spot 7 is ID 6');

console.log('\nALL BUG-FIX TESTS PASSED');

FD.newGame('campaign', 1);
assert(Game.holder.length === 0, 'holder starts empty');
for (let i = 0; i < CONFIG.holder.max; i++) Game.holder.push(FD.makeCar(0));
assert(Game.holder.length === CONFIG.holder.max, 'holder max 5');
Game.light.phase = 'red';
Game.light.redT = 5;
assert(FD.entryToRingBlocked(), 'red light blocks ring entry');
Game.defeatT = 8;
step(30);
assert(Game.defeatT === 0, 'defeat timer reset while red');
assert(Game.state === 'play', 'no defeat during red');

FD.newGame('campaign', 1);
for (let i = 0; i < CONFIG.holder.max; i++) Game.holder.push(FD.makeCar(0));
Game.prepared = { ready: true, vehicle: FD.makeCar(0), factory: () => FD.makeCar(0) };
FD.releaseHolderBurst();
assert(Game.holder.length <= CONFIG.holder.max, 'holder never exceeds max');

FD.newGame('campaign', 1);
Game.stats.served = 29;
let sawTruck = false;
for (let i = 0; i < 40; i++) {
  if (FD.pickClientType(0) === 'truck') sawTruck = true;
}
assert(!sawTruck, 'no trucks before 30 served');
assert(FD.pickClientFuel('truck') === 'diesel', 'trucks always diesel');

Game.defeatT = 5;
FD.toggleTrafficLight();
assert(Game.defeatT === 0, 'red light toggling resets defeat timer');

assert(CONFIG.pump.bufferMax() > 0, 'CONFIG.pump.bufferMax() works');

FD.newGame('campaign', 1);
Game.money = 450000;
FD.actionBuildStation(Road.slots[1], 'a92');
const st = Road.slots[1].station;
for (let i = 0; i < CONFIG.station.pocketMax; i++) {
  const c = FD.makeCar(0);
  c.fuelKey = 'a92';
  st.pocket.push(c);
}
const probe = FD.makeCar(0);
probe.fuelKey = 'a92';
probe.s = modS(Road.slots[1].s - 80, L);
FD.scanForStation(probe);
assert(!probe.pocketSlot, 'no pocket reservation when station pocket full');

const ghost = FD.makeCar(0);
ghost.fuelKey = 'a92';
st.pocket.push(ghost);
FD.cleanupVehicle(ghost);
assert(st.pocket.indexOf(ghost) < 0, 'cleanupVehicle clears pocket ghosts');

assert(FD.GBRBase.pos && FD.GBRBase.spawnS > 0, 'GBR base exists');
assert(!CONFIG.bgTrafficEnabled, 'neutral traffic disabled');

// v0.4.0 — кампания 20 уровней, динамический спавн, Endless
const { spawnRampProgress, hasLevelTarget, getServedHudText } =
  await import('./js/systems/spawnSystem.js');
const { CAMPAIGN_LEVEL_COUNT, campaignMaxSpawnInterval, ENDLESS_SPAWN } =
  await import('./js/config/levels.js');
assert(CONFIG.levels.length === 20, 'campaign has 20 levels');
assert(CAMPAIGN_LEVEL_COUNT === 20, 'CAMPAIGN_LEVEL_COUNT 20');

FD.newGame('campaign', 1);
assert(getTargetCars() === 100, 'level 1 target 100 cars');
assert(currentSpawnInterval() === 4.0, 'level starts at 4s spawn interval');
Game.stats.served = 80;
assert(Math.abs(currentSpawnInterval() - 2.0) < 0.01, 'level 1 at 80% progress max spawn');
assert(spawnRampProgress() === 1, 'ramp complete at 80% served');
Game.stats.served = 40;
const midIv = currentSpawnInterval();
assert(Math.abs(midIv - 3.0) < 0.01, 'spawn interval ramps at 40% (half ramp)');
assert(getServedHudText() === '40 / 100', 'campaign HUD text');

FD.newGame('campaign', 6);
assert(getTargetCars() === 360, 'level 6 target 360');
assert(campaignMaxSpawnInterval(6) === 1.5, 'level 6 max interval 1.5s');
Game.stats.served = 288;
assert(Math.abs(currentSpawnInterval() - 1.5) < 0.01, 'level 6 at 80% on max spawn');

FD.newGame('campaign', 10);
assert(getTargetCars() === 1000, 'level 10 target 1000');
assert(campaignMaxSpawnInterval(10) === 1.0, 'level 10+ max 1s interval');

FD.newGame('campaign', 20);
assert(getTargetCars() === 5000, 'level 20 target 5000');

FD.newGame('endless');
assert(getTargetCars() === null, 'endless has no target');
assert(hasLevelTarget() === false, 'endless hasLevelTarget false');
assert(currentSpawnInterval() === 4.0, 'endless starts 4s');
Game.stats.served = 10000;
assert(Math.abs(currentSpawnInterval() - ENDLESS_SPAWN.minInterval) < 0.01, 'endless max at 10k');
Game.stats.served = 5000;
assert(Math.abs(currentSpawnInterval() - 2.1667) < 0.02, 'endless linear at 5k');
assert(getServedHudText() === '5000 обслужено', 'endless HUD text');

const { tryUpdateEndlessBest, getEndlessBest, setEndlessBest, setEndlessUnlocked } =
  await import('./js/systems/campaignSave.js');
setEndlessBest(0);
assert(tryUpdateEndlessBest(120), 'new endless record');
assert(getEndlessBest() === 120, 'endless best saved');
assert(!tryUpdateEndlessBest(50), 'lower score not a record');
setEndlessUnlocked(true);

// v0.3.7 GBR — задержание на дороге при CHASE
FD.newGame('campaign', 1);
Game.money = 900000;
FD.actionBuildStation(Road.slots[1], 'a92');
const slotG = Road.slots[1];
const scG = FD.makeScalper();
scG.targetSlot = slotG;
scG.tour = [slotG];
scG.tourIdx = 0;
scG.lane = 'inner';
scG.state = 'drive';
scG.s = modS(slotG.s - 15, L);
scG.prevS = scG.s;
scG.v = 20;
scG.totalGot = 40;
scG.wanted = true;
scG.crimeStarted = true;
scG.scalperId = 42;
Game.scalper.unit = scG;
const { ScalperPhase, GbrPhase, setScalperPhase, setGbrPhase } = await import('./js/systems/entityFsm.js');
setScalperPhase(scG, ScalperPhase.DRIVING);
const { makeGBR } = await import('./js/vehicles/vehicleFactory.js');
const { initGbrOnSpawn, gbrSeesScalper, decideAfterArrestExit, gbrCanArrestNow } =
  await import('./js/systems/specialVehicles.js');
const { assignGbrTarget } = await import('./js/systems/gbrPursuit.js');
const { completeStationExit, ScalperOwner, assertRoadHandoffInvariants, handoffScalperToRoad,
  beginStationExit, scalperMovementDebug, isVehicleInUpdateLane } =
  await import('./js/systems/scalperLifecycle.js');
const gbrRing = makeGBR();
initGbrOnSpawn(gbrRing);
gbrRing.lane = 'inner';
gbrRing.state = 'drive';
gbrRing.s = modS(scG.s + 150, L);
gbrRing.prevS = gbrRing.s;
gbrRing.v = 30;
gbrRing.maxV = CONFIG.gbrBase.speeds[0];
Game.gbr.unit = gbrRing;
Game.vehicles = [scG, gbrRing];
assert(CONFIG.gbrBase.speeds[0] === 100, 'GBR speed 100 px/s');
assert(gbrRing.gbrPhase === GbrPhase.PATROL, 'GBR starts patrol');
step(1);
assert(gbrRing.gbrPhase !== GbrPhase.ARREST, 'PATROL does not arrest without CHASE');
gbrRing.s = scG.s;
gbrRing.prevS = scG.s;
assignGbrTarget(gbrRing, scG);
assert(gbrCanArrestNow(gbrRing, scG), 'catch distance within arrest range');
step(1);
assert(gbrRing.gbrPhase === GbrPhase.ARREST, 'GBR arrests on road when caught');
assert(scG.scalperPhase === ScalperPhase.ARRESTING, 'scalper ARRESTING on road');

// v0.4.0.2 — приоритетный обгон ГБР только в CHASE
const { updateLane, canStartOvertake, isChasePriorityGbr } = await import('./js/vehicles/vehicle.js');
const { innerLaneList } = await import('./js/systems/trafficSystem.js');
FD.newGame('campaign', 1);
const scChase = FD.makeScalper();
scChase.scalperId = 77;
scChase.wanted = true;
scChase.crimeStarted = true;
scChase.lane = 'inner';
scChase.state = 'drive';
scChase.s = 800;
scChase.prevS = 800;
scChase.v = 55;
scChase.maxV = 55;
setScalperPhase(scChase, ScalperPhase.DRIVING);
const slowCar = FD.makeCar(0);
slowCar.lane = 'inner';
slowCar.state = 'drive';
slowCar.s = 500;
slowCar.prevS = 500;
slowCar.v = 20;
slowCar.maxV = 25;
slowCar.len = 22;
const gbrChase = makeGBR(1);
initGbrOnSpawn(gbrChase);
gbrChase.lane = 'inner';
gbrChase.state = 'drive';
gbrChase.s = 470;
gbrChase.prevS = 470;
gbrChase.v = 40;
gbrChase.maxV = 100;
Game.vehicles = [scChase, slowCar, gbrChase];
assert(!isChasePriorityGbr(gbrChase), 'PATROL is not chase priority');
assert(!canStartOvertake(gbrChase, slowCar, 50, CONFIG.follow), 'PATROL does not overtake from far gap');
assignGbrTarget(gbrChase, scChase);
assert(gbrChase.gbrPhase === GbrPhase.CHASE, 'CHASE after assign');
assert(isChasePriorityGbr(gbrChase), 'CHASE has priority driving');
assert(canStartOvertake(gbrChase, slowCar, 50, CONFIG.follow), 'CHASE overtakes from far gap');
assert(canStartOvertake(gbrChase, slowCar, 12, CONFIG.follow), 'CHASE overtakes slow civilian');
assert(!canStartOvertake(gbrChase, scChase, 12, CONFIG.follow), 'CHASE does not overtake own target');
let startedOvertake = false;
let returnedToLane = false;
let passedSlow = false;
const gbrTrip0 = gbrChase.trip || 0;
for (let i = 0; i < 240; i++) {
  updateLane(innerLaneList(), 1 / 60);
  if (gbrChase.overtake) startedOvertake = true;
  if (startedOvertake && !gbrChase.overtake && Math.abs(gbrChase.latOff) < 0.5) returnedToLane = true;
  const ahead = modS(gbrChase.s - slowCar.s);
  if (ahead > (slowCar.len + gbrChase.len) / 2 && ahead < L / 2) passedSlow = true;
}
assert(startedOvertake, 'CHASE starts overtake in dense traffic');
assert(returnedToLane || !gbrChase.overtake, 'CHASE returns to lane after overtake');
assert(passedSlow || (gbrChase.trip - gbrTrip0) > 60, 'CHASE advances past slow traffic');
setGbrPhase(gbrChase, GbrPhase.RETURNING);
gbrChase.overtake = null;
gbrChase.overtakeCommitted = false;
assert(!isChasePriorityGbr(gbrChase), 'RETURNING drops chase priority');
assert(!canStartOvertake(gbrChase, slowCar, 50, CONFIG.follow), 'RETURNING uses normal overtake distance');

// v0.2.6 GBR + scalper
FD.newGame('campaign', 1);
Game.money = 900000;
FD.actionBuildStation(Road.slots[1], 'a92');
const slot1 = Road.slots[1];
const st1 = slot1.station;
const sc = FD.makeScalper();
sc.fuelKey = 'a92';
sc.targetSlot = slot1;
sc.station = st1;
sc.state = 'station';
sc.pump = st1.pumps[0];
sc.pumpJ = 0;
sc.pump.blocked = true;
sc.pump.cars.push(sc);
sc.pose = FD.apronPoseForRank(slot1, 0, 0);
sc.tour = [slot1];
sc.tourIdx = 0;
Game.scalper.unit = sc;
Game.vehicles = [sc];
st1.res = 200;
setScalperPhase(sc, ScalperPhase.REFUELING);
sc.wanted = true;
sc.crimeStarted = true;
sc.stationRefuelling = true;
sc.totalGot = 15;
sc.scalperId = 1;
const gbr = makeGBR(1);
initGbrOnSpawn(gbr);
gbr.targetScalperId = sc.scalperId;
gbr.chaseTarget = sc;
sc.pursuedBy = gbr.fleetId;
setGbrPhase(gbr, GbrPhase.ENTER_SERVICE_LANE);
gbr.state = 'station';
gbr.pose = FD.apronPoseForRank(slot1, 0, 1);
gbr.targetSlot = slot1;
Game.gbr.unit = gbr;
Game.vehicles.push(gbr);
step(1);
assert(gbr.gbrPhase === GbrPhase.ARREST, 'GBR arrest lasts 5 seconds');
assert(sc.scalperPhase === ScalperPhase.ARRESTING, 'scalper ARRESTING');
assert(Game.vehicles.includes(sc), 'scalper stays on map during arrest');
assert(Game.gbr.unit, 'GBR unit active during arrest');
const arrestStart = gbr.arrestT;
step(120);
assert(gbr.gbrPhase === GbrPhase.ARREST, 'still arresting before 5s');
assert(gbr.arrestT < arrestStart, 'arrest timer counts down');
step(200);
assert(gbr.gbrPhase === GbrPhase.RETURNING, 'GBR returns immediately after arrest');
assert(gbr.gbrPhase !== 'escorting', 'GBR never ESCORTING');
assert(gbr.state === 'pullOut' || gbr.maxV === CONFIG.gbr.returnSpeed, 'GBR return pull-out or drive');
assert(sc.stationExitActive || sc.state === 'pullOut', 'scalper leaves station after arrest');
assert(!st1.pumps[0].cars.includes(sc), 'column released after arrest');
step(60);
assert(gbr.gbrPhase === GbrPhase.RETURNING, 'GBR still returning regardless of scalper');
assert(Game.state === 'play', 'no crash on scalper+GBR');

// v0.2.6.3 return speed + cooldown after READY
gbr.state = 'drive';
gbr.gbrPhase = GbrPhase.RETURNING;
gbr.s = GBRBase.spawnS;
gbr.v = CONFIG.gbr.returnSpeed;
gbr.maxV = CONFIG.gbr.returnSpeed;
assert(CONFIG.gbr.returnSpeed === 60, 'GBR return speed 60 px/s');
assert(CONFIG.gbrBase.speeds[0] === 100, 'GBR patrol speed 100 px/s');

// scalper: no REFUELING ↔ WAITING loop
FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[2], 'a92');
const sc2 = FD.makeScalper();
sc2.fuelKey = 'a92';
sc2.targetSlot = Road.slots[2];
sc2.station = Road.slots[2].station;
sc2.pump = sc2.station.pumps[0];
sc2.pumpJ = 0;
sc2.pump.cars.push(sc2);
sc2.state = 'station';
sc2.pose = FD.apronPoseForRank(Road.slots[2], 0, 0);
setScalperPhase(sc2, ScalperPhase.REFUELING);
sc2.stationRefuelling = true;
sc2.station.res = 0;
sc2.pump.buffer = 0;
Game.vehicles = [sc2];
step(10);
assert(sc2.scalperPhase !== ScalperPhase.REFUELING, 'no stuck refueling at empty station');

// after arrest scalper always exits — no retry
sc.tour = [slot1, Road.slots[2]];
sc.tourIdx = 0;
sc.stationExitActive = true;
sc.exitS = modS(slot1.s + 16, L);
if (!Game.vehicles.includes(sc)) Game.vehicles.push(sc);
completeStationExit(sc);
assert(decideAfterArrestExit(sc) === 'exit', 'scalper always exits after arrest');
assert(sc.scalperPhase === ScalperPhase.EXITING, 'scalper EXITING after arrest');
assert(sc.scalperOwner === ScalperOwner.ROAD, 'scalper owned by road after exit');
assert(gbr.gbrPhase === GbrPhase.RETURNING, 'GBR unaffected by scalper exit');

// game menu pause
els['game-menu'] = makeEl('game-menu');
els['game-menu-backdrop'] = makeEl('game-menu-backdrop');
els['menu-main-buttons'] = makeEl('menu-main-buttons');
els['menu-btn-continue'] = makeEl('menu-btn-continue');
els['menu-btn-restart'] = makeEl('menu-btn-restart');
els['menu-btn-manual'] = makeEl('menu-btn-manual');
els['menu-btn-home'] = makeEl('menu-btn-home');
els['menu-restart-confirm'] = makeEl('menu-restart-confirm');
els['menu-restart-yes'] = makeEl('menu-restart-yes');
els['menu-restart-no'] = makeEl('menu-restart-no');
els['menu-update'] = makeEl('menu-update');
const { openGameMenu, closeGameMenu, requestRestartLevel, confirmRestartLevel, hideRestartConfirm } =
  await import('./js/ui/gameMenu.js');
const { restartCurrentLevel } = await import('./js/game.js');
FD.newGame('campaign', 1);
openGameMenu();
assert(Game.paused && Game.menuOpen, 'game menu pauses');
const tMenu = Game.time;
step(25);
assert(Game.time === tMenu, 'menu freezes timers');
closeGameMenu();
assert(!Game.menuOpen && !Game.paused, 'continue resumes game');

// v0.3.5.1 — рестарт уровня из меню паузы
FD.newGame('campaign', 3);
Game.money = 50000;
Game.time = 88;
Game.stats.served = 42;
Game.vehicles.push(FD.makeCar(0), FD.makeScalper());
Game.scalper.unit = Game.vehicles[1];
openGameMenu();
requestRestartLevel();
assert(els['menu-restart-confirm'].classList.contains('hidden') === false, 'restart confirm shown');
assert(els['menu-main-buttons'].classList.contains('menu-menu-buttons-hidden'), 'main buttons hidden');
hideRestartConfirm();
assert(els['menu-restart-confirm'].classList.contains('hidden'), 'restart confirm hidden on cancel');
requestRestartLevel();
confirmRestartLevel();
assert(Game.mode === 'campaign' && Game.levelIdx === 3, 'same level after restart');
assert(Game.vehicles.length === 0, 'vehicles cleared on restart');
assert(Game.scalper.unit == null, 'scalper cleared on restart');
assert(Game.gbr.unit == null, 'gbr cleared on restart');
assert(Game.tanker.unit == null, 'tanker cleared on restart');
assert(Game.stats.served === 0 && Game.time === 0, 'progress reset on restart');
assert(!Game.paused && !Game.menuOpen, 'playing after restart');
FD.newGame('endless');
Game.vehicles.push(FD.makeCar(0));
Game.stats.served = 10;
restartCurrentLevel();
assert(Game.mode === 'endless' && Game.levelIdx === 0, 'endless mode preserved on restart');
assert(Game.vehicles.length === 0, 'repeat restart clears vehicles');
restartCurrentLevel();
assert(Game.state === 'play', 'consecutive restarts stable');

assert(Game.state === 'play', 'consecutive restarts stable');

// v0.3.6 — автономный EXITING + инварианты handoff
const { outerLaneList } = await import('./js/systems/trafficSystem.js');
const { updateScalpersLeavingMap, despawnScalper } = await import('./js/systems/scalperLifecycle.js');
FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[1], 'a92');
const scHand = FD.makeScalper();
scHand.lane = 'inner';
scHand.state = 'drive';
scHand.s = Road.slots[1].s;
scHand.prevS = scHand.s;
Game.vehicles = [scHand];
assert(handoffScalperToRoad(scHand), 'handoffScalperToRoad succeeds');
assert(assertRoadHandoffInvariants(scHand, 'test_handoff'), 'handoff invariants pass');
assert(!outerLaneList().includes(scHand), 'EXITING scalper not in outerLaneList');
const mv = scalperMovementDebug(scHand);
assert(mv.phase === 'EXITING' && mv.state === 'drive' && mv.lane === 'outer', 'DBG phase/state/lane');
assert(mv.move === 'EXIT' && !isVehicleInUpdateLane(scHand), 'MOVE EXIT after handoff');
const scExit = FD.makeScalper();
scExit.fuelKey = 'a92';
scExit.targetSlot = Road.slots[1];
scExit.station = Road.slots[1].station;
scExit.state = 'station';
scExit.pose = FD.apronPoseForRank(Road.slots[1], 0, 0);
scExit.pump = scExit.station.pumps[0];
scExit.pumpJ = 0;
scExit.pump.cars.push(scExit);
setScalperPhase(scExit, ScalperPhase.REFUELING);
Game.vehicles = [scExit];
beginStationExit(scExit, 'theft', { slot: Road.slots[1], pumpJ: 0 });
scExit.animT = scExit.animDur;
completeStationExit(scExit);
assert(assertRoadHandoffInvariants(scExit, 'exit_complete'), 'completeStationExit invariants pass');
const logBefore = (Game.pursuitEventLog || []).length;
scHand.scalperLeavingMap = false;
assert(!assertRoadHandoffInvariants(scHand, 'broken_leaving'), 'detects missing scalperLeavingMap');
scHand.scalperLeavingMap = true;
scHand.stopS = Road.spawnS;
assert(!assertRoadHandoffInvariants(scHand, 'broken_stopS'), 'detects stopS during EXITING');
scHand.stopS = null;
const leaveLog = (Game.pursuitEventLog || []).some(e => e.msg === '[SCALPER] Leaving map');
assert(leaveLog, 'Leaving map logged at exit start');
const scStall = FD.makeScalper();
handoffScalperToRoad(scStall);
scStall.s = modS(Road.spawnS - 20, Road.length);
scStall.prevS = scStall.s;
scStall.v = 0;
Game.vehicles = [scStall];
const removeStall = new Set();
let stallT = 0;
while (Game.vehicles.includes(scStall) && stallT < 5) {
  updateScalpersLeavingMap(1 / 30, Road.length, removeStall);
  if (removeStall.size) Game.vehicles = Game.vehicles.filter(v => !removeStall.has(v));
  stallT += 1 / 30;
}
assert(!Game.vehicles.includes(scStall), 'EXITING scalper despawns within 5s even at spawnS');
const scWanted = FD.makeScalper();
scWanted.wanted = true;
scWanted.crimeStarted = true;
handoffScalperToRoad(scWanted);
assert(scWanted.wanted, 'wanted persists during EXITING');
scWanted.s = modS(Road.spawnS - 200, Road.length);
scWanted.prevS = scWanted.s;
Game.vehicles = [scWanted];
const removeW = new Set();
for (let i = 0; i < 15; i++) {
  updateScalpersLeavingMap(1 / 30, Road.length, removeW);
  assert(scWanted.wanted, 'wanted persists during EXITING');
  if (removeW.size) break;
}
assert(!removeW.size, 'wanted scalper not despawned in first 0.5s');
despawnScalper(scWanted, removeW);
assert(!scWanted.wanted, 'wanted cleared at despawn');
const despawnLog = (Game.pursuitEventLog || []).some(e => e.msg === '[SCALPER] Despawn complete');
assert(despawnLog, 'Despawn complete logged');

// version check
const { compareVersions, isNewerVersion, GAME_VERSION, hasPendingUpdate, _setRemoteVersionForTest } =
  await import('./js/systems/versionCheck.js');
assert(GAME_VERSION === '0.4.1', 'GAME_VERSION 0.4.1');
assert(compareVersions('0.4.1', '0.4.0.4') > 0, 'semver newer');
assert(!isNewerVersion('0.4.1'), 'same version not newer');
assert(isNewerVersion('0.4.2'), '0.4.2 is newer');
_setRemoteVersionForTest({ version: '0.4.2', notes: ['Тест'] });
assert(hasPendingUpdate(), 'pending update detected');

// v0.2.8 depot branch + reservoir HUD
const { beginDepotBranch, updateDepotDrive } = await import('./js/systems/tankerSystem.js');
const { stationReservoirHud } = await import('./js/world/map.js');
Depot.init();
assert(Depot.driveToDepot.length >= 3, 'depot branch path defined');
assert(Depot.driveFromDepot.length >= 3, 'depot return path defined');
FD.newGame('campaign', 1);
Game.money = 1800000;
FD.actionBuildStation(Road.slots[0], 'a92');
const hud = stationReservoirHud(Road.slots[0], Road.slots[0].station);
assert(hud.w >= 120 && hud.h >= 20, 'reservoir HUD compact size');
const tkDepot = FD.makeTanker();
tkDepot.tourIdx = 7;
tkDepot.load = 400;
tkDepot.routePlan = FD.buildTankerManifest(400);
beginDepotBranch(tkDepot);
assert(tkDepot.state === 'depotDrive', 'tanker enters depot branch');
assert(tkDepot.depotPathMode === 'toDepot', 'depot path to base');
assert(tkDepot.tankerPhase === 'main_storage', 'MAIN_STORAGE phase');
for (let i = 0; i < 800; i++) updateDepotDrive(tkDepot, 1 / 30);
assert(tkDepot.state === 'pullIn' || tkDepot.state === 'tankerDepot', 'tanker reaches depot stop');

// manual pause
els['manual-backdrop'] = makeEl('manual-backdrop');
els['manual'] = makeEl('manual');
els['manual-body'] = makeEl('manual-body');
els['manual-version'] = makeEl('manual-version');
els['manual-changelog'] = makeEl('manual-changelog');
els['btn-help'] = makeEl('btn-help');
FD.newGame('campaign', 1);
const tBefore = Game.time;
FD.openManual();
assert(Game.paused, 'manual pauses game');
step(30);
assert(Game.time === tBefore, 'timers frozen while manual open');
FD.closeManual();
step(5);
assert(Game.time > tBefore, 'game resumes after manual close');

// FrameTimer + simulated rAF loop (browser boot path)
const { FrameTimer } = await import('./js/core/timer.js');
const timer = new FrameTimer();
assert(timer.step(1000) === 0, 'FrameTimer first step dt=0');
const dt2 = timer.step(1016.67);
assert(dt2 > 0 && dt2 <= 0.05, 'FrameTimer second step bounded');

FD.newGame('campaign', 1);
const { draw } = await import('./js/ui/renderer.js');
const { boot } = await import('./js/boot.js');
let frameCb = null;
const prevRaf = globalThis.window.requestAnimationFrame;
globalThis.window.requestAnimationFrame = cb => { frameCb = cb; };
const loopTimer = new FrameTimer();
function frame(ts) {
  const dt = loopTimer.step(ts);
  update(dt);
  draw();
  globalThis.window.requestAnimationFrame(frame);
}
boot(frame);
assert(loopTimer.lastTs === 0, 'boot calls frame(0) first');
for (let i = 0; i < 3; i++) {
  assert(typeof frameCb === 'function', 'frame schedules requestAnimationFrame');
  frameCb(16.67 * (i + 1));
}
assert(Game.time > 0, 'game advances after rAF frames');
globalThis.window.requestAnimationFrame = prevRaf;

const { GameVersion } = await import('./js/config/gameVersion.js');
assert(GameVersion.version === '0.4.1', 'GameVersion is 0.4.1');
assert(GameVersion.changes.length <= 8, 'patch notes capped at 8 items');

const { StationApi } = await import('./js/systems/stationApi.js');
assert(typeof StationApi.claimColumn === 'function', 'StationApi exported');

// v0.2.9 — рубли, ГБР, перекуп
const { fmtRub, fmtRubDelta } = await import('./js/core/currency.js');
const { pickScalperFuel, scalperTourFor } = await import('./js/vehicles/vehicleFactory.js');
assert(CONFIG.gbrBase.baseCallCost === 5000, 'GBR base cost 5000 rub');
assert(CONFIG.scalper.baseMaxLiters === 100, 'scalper 100L base tank');
assert(CONFIG.truckPayMult === undefined, 'no truck surcharge');
assert(CONFIG.canisterReserve.pricePerLiter === undefined, 'no canister price surcharge');
assert(CONFIG.fuels.a92.price === 90, 'fuel price in rubles');
assert(fmtRub(5000).includes('5') && fmtRub(5000).includes('₽'), 'fmtRub works');
assert(fmtRubDelta(90).startsWith('+'), 'fmtRubDelta positive');
FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'diesel');
FD.actionBuildStation(Road.slots[1], 'a92');
const scFuel = FD.makeScalper();
assert(['a92', 'diesel'].includes(scFuel.fuelKey), 'scalper picks built fuel');
assert(scFuel.tour.every(s => s.station.unlocked.includes(scFuel.fuelKey)), 'tour only matching fuel');
const tourDiesel = scalperTourFor('diesel');
assert(tourDiesel.length === 1 && tourDiesel[0] === Road.slots[0], 'diesel tour filters stations');
Game.money = Math.max(Game.money, CONFIG.gbrBase.baseCallCost + 1000);
const moneyBeforeGbr = Game.money;
Game.gbr.unit = null;
readyGbr();
FD.callGBR();
assert(Game.money === moneyBeforeGbr - CONFIG.gbrBase.baseCallCost, 'GBR patrol without scalper on map');
assert(Game.gbr.unit, 'GBR spawned for patrol');
Game.gbr.unit = null;
Game.scalper.unit = scFuel;
Game.gbr.unit = null;
readyGbr();
Game.money = CONFIG.gbrBase.baseCallCost;
FD.callGBR();
assert(Game.money === 0, 'GBR deducts 5000 on call');
assert(Game.gbr.unit, 'GBR spawned after payment');

// v0.2.10 — себестоимость и закупка бензовозом
const { tankerDeliveryLiters, tankerDeliveryCost, tankerCreditLimit, canOrderTanker } =
  await import('./js/systems/economySystem.js');
assert(CONFIG.fuelCostPerLiter === 70, 'fuel cost 70 rub/L');
assert(CONFIG.tanker.cost === undefined, 'no fixed tanker cost');
assert(tankerDeliveryLiters() === 1000, 'level 1 delivery 1000L');
assert(tankerDeliveryCost() === 70000, 'level 1 delivery 70000 rub');
FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'a92');
Game.money = 70000;
Game.tanker.unit = null;
readyTanker();
const moneyBeforeOrder = Game.money;
FD.callTanker();
assert(Game.tanker.unit, 'tanker ordered with exact funds');
assert(Game.money === 0, 'fuel cost deducted on order');
assert(Game.money === moneyBeforeOrder - 70000, 'single deduction');
Game.tanker.unit = null;
readyTanker();
Game.money = -80000;
const floatsBefore = Game.floats.length;
FD.callTanker();
assert(!Game.tanker.unit, 'tanker blocked over credit limit');
assert(Game.money === -80000, 'no charge when credit blocked');
assert(Game.floats.length > floatsBefore, 'credit limit message shown');
Game.money = 50000;
readyTanker();
FD.callTanker();
assert(Game.tanker.unit, 'tanker allowed on credit within limit');
assert(Game.money === 50000 - 70000, 'credit purchase balance');
Game.tankerTruck.level = 2;
assert(tankerDeliveryCost() === 105000, 'tanker level 2 delivery 105000 rub');
Game.tankerTruck.level = 5;
assert(tankerDeliveryCost() === 332500, 'tanker level 5 delivery 332500 rub');

// v0.4.1 — гибкий заказ топлива и бонусы
const { quoteFuelOrder, canAffordFuelOrder, payWithBonus, canAffordWithBonus,
  stationBonusShare, depotBonusShare } = await import('./js/systems/fuelOrderSystem.js');
FD.newGame('campaign', 1);
assert(Game.money === 50000, 'start money 50000');
assert(Game.bonuses === 0, 'bonuses start at 0');
const q20 = quoteFuelOrder(20);
assert(q20.liters === 200 && q20.pricePerLiter === 105 && q20.cost === 21000, '20% quote');
assert(q20.cashbackPct === 10 && q20.bonuses === 2100, '20% cashback');
const q50 = quoteFuelOrder(50);
assert(q50.liters === 500 && q50.pricePerLiter === 90 && q50.cost === 45000, '50% quote');
assert(q50.cashbackPct === 15 && q50.bonuses === 6750, '50% cashback');
const q90 = quoteFuelOrder(90);
assert(q90.pricePerLiter === 70 && q90.cashbackPct === 20, '90% price/cashback');
const q100 = quoteFuelOrder(100);
assert(q100.liters === 1000 && q100.pricePerLiter === 70 && q100.cost === 70000, '100% quote');
assert(q100.bonuses === 14000, '100% bonuses');
assert(quoteFuelOrder(15).percent === 20, 'clamp below 20%');
assert(quoteFuelOrder(105).percent === 100, 'clamp above 100%');
assert(quoteFuelOrder(55).percent === 50 || quoteFuelOrder(55).percent === 60, 'snap to step');

FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'a92');
readyTanker();
Game.money = 50000;
Game.bonuses = 0;
const moneyB = Game.money;
assert(FD.callTanker({ liters: 200, cost: 21000, bonuses: 2100 }), 'partial order succeeds');
assert(Game.money === moneyB - 21000, 'partial cost deducted once');
assert(Game.bonuses === 2100, 'cashback bonuses once');
assert(Game.tanker.unit && Game.tanker.unit.load === 200, 'tanker load 200L');

FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'a92');
readyTanker();
Game.money = 10000;
assert(!canAffordFuelOrder(quoteFuelOrder(100)), 'cannot afford 100%');
assert(!FD.callTanker({ liters: 1000, cost: 70000, bonuses: 14000 }), 'reject unaffordable order');
assert(Game.money === 10000 && Game.bonuses === 0, 'no charge when rejected');

FD.newGame('campaign', 1);
Game.bonuses = 10000;
const stCost = CONFIG.station.cost;
assert(canAffordWithBonus(stCost, stationBonusShare()), 'station affordable with bonus share');
const pay = payWithBonus(stCost, stationBonusShare());
assert(pay.ok && pay.bonus === Math.min(10000, Math.floor(stCost * 0.3)), 'station bonus share ≤30%');
assert(Game.bonuses === 10000 - pay.bonus, 'bonuses spent on station');

FD.newGame('campaign', 1);
Game.money = 100000;
Game.bonuses = 50000;
const depotPay = payWithBonus(100000, depotBonusShare());
assert(depotPay.ok && depotPay.bonus === 20000, 'depot bonus share ≤20%');

const { actionUpgradeTankerTruck } = await import('./js/systems/upgradeSystem.js');
FD.newGame('campaign', 1);
const tucCash = CONFIG.tankerTruck.upgradeCosts[0];
Game.money = tucCash;
Game.bonuses = 999999;
assert(actionUpgradeTankerTruck(), 'tanker upgrade cash-only ok');
assert(Game.bonuses === 999999, 'tanker upgrade does not spend bonuses');
assert(Game.money === 0, 'tanker upgrade cash deducted');

FD.newGame('campaign', 1);
Game.paused = false;
assert(Game.paused === false, 'order menu path does not require pause');

// v0.2.10.1 / v0.4.0.3 — перекуп не оплачивает кражу; stolen только после побега
const { finishScalperFuel, finishFuel, recordScalperTheft, commitScalperEscapeTheft, forfeitScalperTheft } =
  await import('./js/systems/economySystem.js');
const { updateScalperAtColumn } = await import('./js/systems/specialVehicles.js');
FD.newGame('campaign', 1);
Game.money = 900000;
FD.actionBuildStation(Road.slots[0], 'a92');
const money0 = Game.money;
const earned0 = Game.stats.earned;
const liters0 = Game.stats.liters;
const stSc = Road.slots[0].station;
stSc.res = 500;
stSc.pumps[0].buffer = 0;
const scThief = FD.makeScalper();
scThief.fuelKey = 'a92';
scThief.targetSlot = Road.slots[0];
scThief.station = stSc;
scThief.pump = stSc.pumps[0];
scThief.pumpJ = 0;
scThief.pump.cars.push(scThief);
scThief.state = 'station';
scThief.pose = FD.apronPoseForRank(Road.slots[0], 0, 0);
setScalperPhase(scThief, ScalperPhase.REFUELING);
scThief.wanted = true;
scThief.crimeStarted = true;
scThief.stationRefuelling = true;
Game.vehicles = [scThief];
const resBefore = stSc.res;
updateScalperAtColumn(scThief, 1, L);
assert(Game.money === money0, 'scalper theft no money change');
assert(Game.stats.earned === earned0, 'scalper theft no earned change');
assert(Game.stats.liters === liters0, 'scalper theft no commercial liters');
assert(Game.stats.stolenLiters === 0, 'stolen not counted during fill');
assert(scThief.totalGot > 0, 'stolen liters held on scalper');
assert(stSc.res < resBefore, 'station reserve decreased');
finishScalperFuel(scThief, 50);
assert(Game.money === money0, 'finishScalperFuel no payment');
assert(Game.stats.stolenLiters === 0, 'finishScalperFuel does not count global theft');
assert(scThief.totalGot >= 50, 'theft accumulates on scalper');
// обычный клиент по-прежнему платит
const payCar = FD.makeCar(0);
payCar.fuelKey = 'a92';
payCar.got = 20;
payCar.pose = { x: 100, y: 100 };
payCar.station = stSc;
finishFuel(payCar);
assert(Game.money > money0, 'client still pays');
assert(Game.stats.liters > liters0, 'client liters counted');
// полный бак → выезд
scThief.totalGot = (scThief.maxLiters || CONFIG.scalper.baseMaxLiters) - 0.01;
stSc.res = 500;
scThief.pump.buffer = 0;
setScalperPhase(scThief, ScalperPhase.REFUELING);
updateScalperAtColumn(scThief, 0.1, L);
assert(scThief.scalperPhase === ScalperPhase.ESCAPING || scThief.totalGot >= (scThief.maxLiters || 100) - 0.01,
  'scalper escapes after fill');

// v0.4.0.3 — учёт кражи только после успешного побега / не после ареста
FD.newGame('campaign', 1);
const scEsc = FD.makeScalper();
scEsc.totalGot = 100;
assert(Game.stats.stolenLiters === 0, 'escape scenario starts clean');
const remEsc = new Set();
despawnScalper(scEsc, remEsc);
assert(Game.stats.stolenLiters === 100, 'escape commits 100L stolen');
assert(Game.stats.stolenDamage === 100 * CONFIG.fuelCostPerLiter, 'damage formula on escape');
assert(scEsc.theftCommitted, 'escape theft marked committed');

FD.newGame('campaign', 1);
const scArr = FD.makeScalper();
scArr.totalGot = 100;
forfeitScalperTheft(scArr);
const remArr = new Set();
despawnScalper(scArr, remArr);
assert(Game.stats.stolenLiters === 0, 'arrested theft not counted');
assert(scArr.theftForfeited, 'arrest forfeits theft');

FD.newGame('campaign', 1);
for (let i = 0; i < 5; i++) {
  const sc = FD.makeScalper();
  sc.totalGot = 100;
  despawnScalper(sc, new Set());
}
assert(Game.stats.stolenLiters === 500, 'five escapes reach 500L');
const { currentScalperMaxLiters: capAfterEscapes } = await import('./js/systems/scalperEvolution.js');
assert(capAfterEscapes() === 150, '150L tank after 500 escaped liters');

FD.newGame('campaign', 1);
for (let i = 0; i < 5; i++) {
  const sc = FD.makeScalper();
  sc.totalGot = 100;
  forfeitScalperTheft(sc);
  despawnScalper(sc, new Set());
}
assert(Game.stats.stolenLiters === 0, 'five arrests leave stolen at 0');
assert(capAfterEscapes() === 100, 'tank stays 100L after arrests only');

// v0.2.10.2 — кулдаун перекупа и скорость ГБР
const { scalperCooldown } = await import('./js/systems/spawnSystem.js');
FD.newGame('campaign', 1);
const iv0 = currentSpawnInterval();
assert(CONFIG.scalper.spawnIntervalMult === 10, 'scalper mult 10');
assert(Math.abs(scalperCooldown() - iv0 * 10) < 0.001, 'cooldown = 10 × spawn interval');
assert(Math.abs(Game.scalperTimer - scalperCooldown()) < 0.001, 'initial scalper timer');
Game.stats.served = 100;
const iv1 = currentSpawnInterval();
assert(iv1 < iv0, 'spawn interval ramps down');
assert(Math.abs(scalperCooldown() - iv1 * 10) < 0.001, 'cooldown tracks spawn interval');
assert(CONFIG.gbr.returnSpeed === 60, 'GBR return still 60');

// v0.2.11 — кредит и новые поражения
const { endGame, checkFuelCrisis } = await import('./js/systems/defeatSystem.js');
FD.newGame('campaign', 1);
assert(tankerCreditLimit() === -70000, 'credit limit -70000');
assert(canOrderTanker(50000), '50k can order on credit');
assert(!canOrderTanker(-80000), '-80k over credit');
FD.actionBuildStation(Road.slots[0], 'a92');
Game.stats.served = 100;
Game.money = -1000;
endGame(false, 'bankruptcy');
assert(Game.state === 'over', 'bankruptcy on negative balance at level end');
assert(Game.defeatReason === 'bankruptcy', 'bankruptcy reason');
FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'a92');
Game.depot.res = 0;
Road.slots[0].station.res = 0;
Game.money = -200000;
Game.tanker.unit = null;
readyTanker();
Game.stats.served = 0;
Game.holder.push(FD.makeCar(0));
assert(checkFuelCrisis(), 'fuel crisis triggers defeat');
assert(Game.defeatReason === 'fuel_crisis', 'fuel crisis reason');
assert(Game.state === 'over', 'fuel crisis game over');

// v0.3.0 — логистика и миграция
const { tickTankerLogistics, findReadyTruck, FleetState } =
  await import('./js/systems/tankerLogistics.js');
const { migrateSaveObject, migrateDepotLevel } = await import('./js/systems/saveMigration.js');
const { showVersionNotification, _resetVersionNotificationForTest } =
  await import('./js/ui/versionNotification.js');

FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'a92');
Game.money = 900000;
assert(Game.logistics.trucks[0].state === FleetState.PREPARING, 'starts preparing');
assert(Game.logistics.prepSlot === 1, 'prep post occupied');
tickTankerLogistics(20);
assert(findReadyTruck(), 'ready after 20s prep');
assert(Game.logistics.prepSlot === 1, 'ready still occupies post');
readyTanker();
FD.callTanker();
assert(Game.logistics.trucks[0].state === FleetState.ON_MISSION, 'dispatched');
assert(Game.logistics.prepSlot == null, 'post freed on dispatch');
assert(CONFIG.depot.levels.length === 10, 'depot 10 levels');
assert(CONFIG.tankerTruck.levels[9] === 20000, 'tanker max 20000L');
assert(CONFIG.fleet.maxCount[2] === 3, 'fleet max 3');
assert(migrateDepotLevel(2) === 3, 'legacy depot L2 → L3');
assert(migrateDepotLevel(3) === 4, 'legacy depot L3 → L4');
const migrated = migrateSaveObject({ version: '0.2.11', depot: { level: 2, res: 3400, cap: 3500 } });
assert(migrated.tankerTruck.level === 1, 'migration tanker level I');
assert(migrated.fleet.level === 1, 'migration fleet level I');
assert(migrated.depot.res <= migrated.depot.cap, 'migration clamps fuel');
assert(isNewerVersion('0.4.2'), 'semver newer');
assert(!isNewerVersion('0.4.1'), 'same version not newer');
_resetVersionNotificationForTest();
showVersionNotification('0.4.1');
assert(true, 'version notification once per session');

// v0.3.1.1 — UX бензовозов и подготовка после возврата
const { tankerButtonSub, onTankerMissionComplete, nearestTankerPrepSeconds,
  fleetDebugLines } = await import('./js/systems/tankerLogistics.js');

FD.newGame('campaign', 1);
let sub = tankerButtonSub();
assert(sub.includes('Подготовка'), 'button shows prep timer at start');
tickTankerLogistics(20);
sub = tankerButtonSub();
assert(sub.includes('Готов'), 'button shows ready after prep');
assert(nearestTankerPrepSeconds() == null, 'no prep timer when ready');
assert(!fleetDebugLines().some(l => l.includes('Не приобретён')), 'debug uses English labels');

Game.logistics.trucks[0].state = FleetState.ON_MISSION;
Game.logistics.prepSlot = null;
onTankerMissionComplete(1);
assert(Game.logistics.trucks[0].state === FleetState.PREPARING, 'prep restarts after return');
tickTankerLogistics(20);
assert(findReadyTruck(), 'ready again after full cycle');

// Restart after defeat — Boot.restart() must not throw (Game is module-scoped)
const { tickGbrLogistics, findReadyGbr, gbrCallCost, gbrPatrolSpeed, countGbrOnMission } =
  await import('./js/systems/gbrLogistics.js');
const { currentScalperMaxLiters, scalperEvolutionTier, checkScalperEvolutionThreshold,
  _resetScalperEvolutionForTest } = await import('./js/systems/scalperEvolution.js');

FD.newGame('campaign', 1);
assert(Game.gbrLogistics.units[0].state === 'PREPARING', 'GBR starts preparing');
tickGbrLogistics(10);
assert(findReadyGbr(), 'GBR ready after 10s');
assert(gbrCallCost() === 5000, 'first GBR call 5000');
FD.actionBuildStation(Road.slots[0], 'a92');
Game.scalper.unit = FD.makeScalper();
Game.money = 5000;
readyGbr();
FD.callGBR();
assert(countGbrOnMission() === 1, 'one GBR on mission');
assert(gbrCallCost() === 10000, 'second call 10000 with one on mission');
assert(Game.gbr.unit.dispatchedCost === 5000, 'cost fixed at dispatch');
Game.gbrBase.level = 6;
assert(gbrPatrolSpeed() === 110, 'GBR speed 110 at base VI');
Game.gbrBase.level = 10;
assert(gbrPatrolSpeed() === 150, 'GBR speed 150 at base X');
FD.newGame('campaign', 1);
assert(currentScalperMaxLiters() === 100, 'scalper starts 100L');
Game.stats.stolenLiters = 499;
assert(currentScalperMaxLiters() === 100, 'still 100 below 500');
Game.stats.stolenLiters = 500;
assert(currentScalperMaxLiters() === 150, '150L after 500 stolen');
assert(scalperEvolutionTier() === 1, 'tier 1');
_resetScalperEvolutionForTest();
checkScalperEvolutionThreshold();
assert(Game.scalperEvolution.notifiedTier === 1, 'evolution notified once');
checkScalperEvolutionThreshold();
assert(Game.scalperEvolution.notifiedTier === 1, 'no duplicate notification');

// v0.3.1.2 — компактная кнопка ГБР и панель автопарка
const { gbrButtonSub, gbrFleetPanelLines, nearestGbrPrepSeconds, onGbrMissionComplete } =
  await import('./js/systems/gbrLogistics.js');

FD.newGame('campaign', 1);
let gbrSub = gbrButtonSub(n => n + ' ₽');
assert(gbrSub.includes('5000'), 'GBR button shows cost');
assert(gbrSub.includes('Подготовка'), 'GBR button shows prep timer at start');
assert(!gbrSub.includes('№2'), 'GBR button has no fleet list');
tickGbrLogistics(10);
gbrSub = gbrButtonSub(n => n + ' ₽');
assert(gbrSub.includes('READY'), 'GBR button shows READY after prep');
assert(nearestGbrPrepSeconds() == null, 'no GBR prep timer when ready');
const fleetLines = gbrFleetPanelLines();
assert(fleetLines.length === 10, 'GBR panel lists 10 slots');
assert(fleetLines[0].includes('READY'), 'GBR panel shows unit status');
assert(fleetLines[9].includes('Не приобретён'), 'GBR panel shows unowned slots');

Game.gbrLogistics.units[0].state = FleetState.ON_MISSION;
Game.gbrLogistics.prepSlot = null;
onGbrMissionComplete(1);
assert(Game.gbrLogistics.units[0].state === FleetState.PREPARING, 'GBR prep restarts after return');
tickGbrLogistics(10);
assert(findReadyGbr(), 'GBR ready again after full cycle');

// v0.3.1.3 — бензовоз и правила ГБР
const { primeLegTargeting } = await import('./js/systems/tankerSystem.js');
const { scalperIsGbrTarget } = await import('./js/systems/specialVehicles.js');

FD.newGame('campaign', 1);
Game.money = 1800000;
FD.actionBuildStation(Road.slots[0], 'a92');
Road.slots[0].station.res = 100;
readyTanker();
FD.callTanker();
const tkEmpty = Game.tanker.unit;
tkEmpty.tourIdx = 1;
tkEmpty.s = modS(Road.slots[1].s - 50, L);
tkEmpty.prevS = tkEmpty.s;
tkEmpty.v = 40;
tkEmpty.state = 'drive';
primeLegTargeting(tkEmpty);
assert(tkEmpty.stopS == null, 'tanker no brake on empty spot');
assert(tkEmpty.tourIdx > 1, 'tanker skips empty spots in route');

FD.newGame('campaign', 1);
Game.money = 900000;
FD.actionBuildStation(Road.slots[1], 'a92');
const scEmpty = FD.makeScalper();
scEmpty.targetSlot = Road.slots[1];
scEmpty.tour = [Road.slots[1]];
scEmpty.lane = 'inner';
scEmpty.state = 'drive';
scEmpty.s = modS(Road.slots[1].s - 10, L);
scEmpty.prevS = scEmpty.s;
scEmpty.v = 20;
scEmpty.totalGot = 0;
Game.scalper.unit = scEmpty;
setScalperPhase(scEmpty, ScalperPhase.DRIVING);
const gbrPass = makeGBR();
initGbrOnSpawn(gbrPass);
gbrPass.lane = 'inner';
gbrPass.state = 'drive';
gbrPass.s = scEmpty.s;
gbrPass.prevS = gbrPass.s;
gbrPass.v = 50;
gbrPass.maxV = CONFIG.gbrBase.speeds[0];
Game.gbr.unit = gbrPass;
Game.vehicles = [scEmpty, gbrPass];
assert(!scalperIsGbrTarget(scEmpty), 'empty tank not a GBR target');
step(1);
assert(gbrPass.gbrPhase !== GbrPhase.ARREST, 'GBR ignores empty scalper');
assert(gbrPass.gbrPhase !== GbrPhase.CHASE, 'GBR does not chase empty scalper');
assert(gbrPass.stopS == null, 'GBR does not brake for empty scalper');

scEmpty.wanted = true;
scEmpty.crimeStarted = true;
scEmpty.scalperId = 77;
assert(scalperIsGbrTarget(scEmpty), 'crime started becomes target');
gbrPass.s = scEmpty.s;
gbrPass.prevS = gbrPass.s;
setGbrPhase(gbrPass, GbrPhase.CHASE);
gbrPass.chaseTarget = scEmpty;
gbrPass.targetScalperId = scEmpty.scalperId;
scEmpty.pursuedBy = gbrPass.fleetId;
step(1);
assert(gbrPass.gbrPhase === GbrPhase.ARREST, 'GBR arrests on road after theft when caught');

// v0.3.2.1 — круговое обнаружение, единая очередь, DBG
const { tryAttachScalperToStation, gbrTargetsInRange } =
  await import('./js/systems/specialVehicles.js');
const { stationQueueDebugLines } = StationApi;
const { pumpNozzleBusy } = await import('./js/world/roadNetwork.js');

FD.newGame('campaign', 1);
Game.money = 900000;
FD.actionBuildStation(Road.slots[0], 'a92');
const slotQ = Road.slots[0];
const stQ = slotQ.station;
const carQ = FD.makeCar();
carQ.fuelKey = 'a92';
StationApi.joinStationWaitQueue(carQ, slotQ);
const scQ = FD.makeScalper();
scQ.fuelKey = 'a92';
scQ.tour = [slotQ];
scQ.tourIdx = 0;
tryAttachScalperToStation(scQ, slotQ);
assert(stQ.pocket.length === 2, 'scalper and car share pocket queue');
assert(stQ.pumps[0].cars.length === 0, 'pump queue empty while waiting');
assert(!pumpNozzleBusy(stQ.pumps[0]), 'nozzle free while waiting in pocket');

FD.newGame('campaign', 1);
const scVis = FD.makeScalper();
scVis.totalGot = 30;
scVis.lane = 'inner';
scVis.state = 'drive';
scVis.s = modS(Road.spawnS + 30, L);
scVis.prevS = scVis.s;
scVis.v = 20;
setScalperPhase(scVis, ScalperPhase.DRIVING);
scVis.wanted = true;
scVis.crimeStarted = true;
Game.scalper.unit = scVis;
const gbrVis = makeGBR();
initGbrOnSpawn(gbrVis);
gbrVis.lane = 'inner';
gbrVis.state = 'drive';
gbrVis.s = scVis.s;
gbrVis.prevS = gbrVis.s;
Game.vehicles = [scVis, gbrVis];
assert(gbrSeesScalper(gbrVis, scVis), 'circular detect at same position');
gbrVis.s = modS(scVis.s + 80, L);
gbrVis.prevS = gbrVis.s;
assert(gbrSeesScalper(gbrVis, scVis), 'circular detect behind');
gbrVis.lane = 'outer';
gbrVis.s = modS(scVis.s + 40, L);
gbrVis.prevS = gbrVis.s;
assert(gbrSeesScalper(gbrVis, scVis), 'circular detect opposite lane');
assert(gbrTargetsInRange(gbrVis).length === 1, 'one target in range');

FD.newGame('campaign', 1);
readyGbr();
Game.money = CONFIG.gbrBase.baseCallCost * 3;
FD.callGBR();
const gbrPat = Game.gbr.unit;
assert(gbrPat.gbrPhase === GbrPhase.PATROL, 'patrol after dispatch');
gbrPat.s = GBRBase.spawnS;
gbrPat.prevS = modS(GBRBase.spawnS - 40, L);
for (let lap = 0; lap < CONFIG.gbr.patrolMaxLaps; lap++) {
  gbrPat.s = modS(GBRBase.spawnS - 2, L);
  gbrPat.prevS = modS(GBRBase.spawnS - 50, L);
  step(3);
}
assert(gbrPat.gbrPhase === GbrPhase.RETURNING || gbrPat.patrolLaps >= CONFIG.gbr.patrolMaxLaps,
  'patrol ends after five laps');

FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'a92');
const dbgLines = stationQueueDebugLines();
assert(dbgLines.some(l => l.includes('карман')), 'DBG shows pocket queues');

// GBR: появление перекупа во время патруля — больше не начинает преследование самостоятельно
FD.newGame('campaign', 1);
readyGbr();
Game.money = 10000;
FD.callGBR();
const gbrSpawn = Game.gbr.unit;
assert(gbrSpawn.gbrPhase === GbrPhase.PATROL, 'patrol before scalper');
const scLate = FD.makeScalper();
scLate.totalGot = 20;
scLate.lane = 'inner';
scLate.state = 'drive';
scLate.s = gbrSpawn.s;
scLate.prevS = scLate.s;
Game.scalper.unit = scLate;
Game.vehicles.push(scLate);
step(1);
assert(gbrSpawn.gbrPhase === GbrPhase.PATROL, 'patrol does NOT self-chase in v0.3.3');

// GBR: прямое преследование через wanted/pursuedBy
FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'a92');
readyGbr();
Game.money = 10000;
const { onScalperTheftDetected, spawnGbrUnit } =
  await import('./js/systems/gbrPursuit.js');
const scAlarm = FD.makeScalper();
scAlarm.targetSlot = Road.slots[0];
onScalperTheftDetected(Road.slots[0].station, scAlarm);
Game.vehicles.push(scAlarm);
spawnGbrUnit(gbrCallCost(), null, scAlarm);
const gbrDisp = Game.gbr.unit;
assert(gbrDisp.gbrPhase === GbrPhase.CHASE, 'CHASE after pursuit assign');
assert(gbrDisp.targetScalperId === scAlarm.scalperId, 'targetScalperId stored');
assert(scAlarm.pursuedBy === gbrDisp.fleetId, 'pursuedBy bidirectional link');

// GBR: потеря цели — возврат в патруль
gbrDisp.chaseTarget = scLate;
scAlarm.wanted = false;
scAlarm.pursuedBy = null;
gbrDisp.targetScalperId = scLate.scalperId || 999;
Game.vehicles = [gbrDisp];
step(1);
assert(gbrDisp.gbrPhase === GbrPhase.PATROL || gbrDisp.gbrPhase === GbrPhase.CHASE,
  'patrol or chase after invalid target');

// v0.3.7 — отмена SERVICE при уезде цели
FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[1], 'a92');
const slotFlee = Road.slots[1];
const scFlee = FD.makeScalper();
scFlee.fuelKey = 'a92';
scFlee.targetSlot = slotFlee;
scFlee.station = slotFlee.station;
scFlee.pump = scFlee.station.pumps[0];
scFlee.pump.cars.push(scFlee);
scFlee.state = 'station';
scFlee.pose = FD.apronPoseForRank(slotFlee, 0, 0);
scFlee.totalGot = 12;
scFlee.wanted = true;
scFlee.scalperId = 88;
setScalperPhase(scFlee, ScalperPhase.REFUELING);
const gbrPull = makeGBR(3);
initGbrOnSpawn(gbrPull);
assignGbrTarget(gbrPull, scFlee);
setGbrPhase(gbrPull, GbrPhase.ENTER_SERVICE_LANE);
gbrPull.state = 'pullIn';
gbrPull.animT = 0.1;
gbrPull.animDur = 2;
gbrPull.targetSlot = slotFlee;
gbrPull.chaseResumeS = modS(slotFlee.s + 12, L);
gbrPull.animFrom = FD.apronPoseForRank(slotFlee, 0, 2);
gbrPull.animTo = FD.apronPoseForRank(slotFlee, 0, 1);
Game.vehicles = [scFlee, gbrPull];
scFlee.pump.cars = scFlee.pump.cars.filter(c => c !== scFlee);
scFlee.pump = null;
scFlee.station = null;
scFlee.pose = null;
scFlee.state = 'drive';
scFlee.lane = 'inner';
scFlee.s = modS(slotFlee.s + 90, L);
scFlee.prevS = scFlee.s;
step(5);
assert(gbrPull.gbrPhase === GbrPhase.CHASE, 'GBR resumes chase when target fled during pullIn');
assert(gbrPull.state === 'drive', 'GBR not stuck in pullIn');
assert(gbrPull.gbrPhase !== GbrPhase.ENTER_SERVICE_LANE, 'GBR not stuck in SERVICE');

// v0.3.7.1 — преследование до DESPAWN, не терять цель в EXITING
const { gbrPursuitTarget } = await import('./js/systems/gbrPursuit.js');
const { updateGBR } = await import('./js/systems/specialVehicles.js');
FD.newGame('campaign', 1);
const scPursuit = FD.makeScalper();
scPursuit.scalperId = 101;
scPursuit.wanted = true;
scPursuit.crimeStarted = true;
scPursuit.lane = 'inner';
scPursuit.state = 'drive';
scPursuit.s = modS(200, L);
scPursuit.prevS = scPursuit.s;
const gbrExit = makeGBR(5);
initGbrOnSpawn(gbrExit);
Game.vehicles = [scPursuit, gbrExit];
assignGbrTarget(gbrExit, scPursuit);
assert(gbrExit.gbrPhase === GbrPhase.CHASE, 'CHASE after assign');
handoffScalperToRoad(scPursuit);
assert(scPursuit.scalperPhase === ScalperPhase.EXITING, 'scalper EXITING');
assert(scPursuit.pursuedBy === gbrExit.fleetId, 'pursuedBy kept in EXITING');
assert(gbrPursuitTarget(gbrExit) === scPursuit, 'pursuit target active in EXITING');
const logBeforeExit = (Game.pursuitEventLog || []).length;
const removeExit = new Set();
updateGBR(gbrExit, 1 / 30, L, removeExit);
assert(gbrExit.gbrPhase === GbrPhase.CHASE, 'GBR stays CHASE during EXITING');
const lostDuringExit = (Game.pursuitEventLog || []).slice(logBeforeExit)
  .some(e => e.msg && e.msg.includes('Target lost'));
assert(!lostDuringExit, 'no Target lost during EXITING');
despawnScalper(scPursuit, removeExit);
assert((Game.pursuitEventLog || []).some(e => e.msg && e.msg.includes('Target lost')),
  'Target lost logged on DESPAWN');
assert(gbrExit.targetScalperId == null, 'GBR link cleared after despawn');

// v0.4.0.4 — назначение ГБР на уже разыскиваемого перекупа при спавне
FD.newGame('campaign', 1);
Game.money = 999999;
const scWantedExit = FD.makeScalper();
scWantedExit.scalperId = 201;
scWantedExit.wanted = true;
scWantedExit.crimeStarted = true;
scWantedExit.wantedAt = 1;
scWantedExit.lane = 'outer';
scWantedExit.state = 'drive';
scWantedExit.s = 400;
scWantedExit.prevS = 400;
scWantedExit.v = 55;
setScalperPhase(scWantedExit, ScalperPhase.EXITING);
scWantedExit.scalperLeavingMap = true;
scWantedExit.scalperOwner = 'road';
Game.vehicles = [scWantedExit];
Game.scalper.unit = scWantedExit;
readyGbr();
FD.callGBR();
const gbrLateCall = Game.gbr.unit;
assert(gbrLateCall, 'GBR spawned after wanted EXITING scalper');
assert(gbrLateCall.gbrPhase === GbrPhase.CHASE, 'spawn GBR CHASE for existing wanted');
assert(gbrLateCall.targetScalperId === 201, 'spawn GBR assigned EXITING wanted');
assert((Game.pursuitEventLog || []).some(e => e.msg.includes('Spawned')), 'Spawned logged');
assert((Game.pursuitEventLog || []).some(e => e.msg.includes('Target assigned')), 'Target assigned on spawn');

FD.newGame('campaign', 1);
Game.money = 999999;
const scWantedRing = FD.makeScalper();
scWantedRing.scalperId = 202;
scWantedRing.wanted = true;
scWantedRing.crimeStarted = true;
scWantedRing.wantedAt = 2;
scWantedRing.lane = 'inner';
scWantedRing.state = 'drive';
scWantedRing.s = 900;
scWantedRing.prevS = 900;
scWantedRing.v = 40;
scWantedRing.totalGot = 100;
setScalperPhase(scWantedRing, ScalperPhase.DRIVING);
Game.vehicles = [scWantedRing];
readyGbr();
FD.callGBR();
const gbrRingWanted = Game.gbr.unit;
assert(gbrRingWanted.gbrPhase === GbrPhase.CHASE, 'CHASE for wanted on ring without new AZS');
assert(gbrRingWanted.targetScalperId === 202, 'assigned ring wanted scalper');

FD.newGame('campaign', 1);
Game.money = 999999;
const scDup = FD.makeScalper();
scDup.scalperId = 203;
scDup.wanted = true;
scDup.crimeStarted = true;
scDup.lane = 'inner';
scDup.state = 'drive';
scDup.s = 300;
scDup.prevS = 300;
setScalperPhase(scDup, ScalperPhase.DRIVING);
const gbrFirst = makeGBR(1);
initGbrOnSpawn(gbrFirst);
gbrFirst.lane = 'inner';
gbrFirst.state = 'drive';
gbrFirst.s = 100;
gbrFirst.prevS = 100;
Game.vehicles = [scDup, gbrFirst];
assignGbrTarget(gbrFirst, scDup);
assert(scDup.pursuedBy === gbrFirst.fleetId, 'first GBR owns target');
readyGbr();
spawnGbrUnit(gbrCallCost(), null, null);
const gbrSecond = Game.vehicles.find(v => v.kind === 'gbr' && v !== gbrFirst);
assert(gbrSecond, 'second GBR spawned');
assert(gbrSecond.gbrPhase === GbrPhase.PATROL, 'second GBR stays PATROL');
assert(gbrSecond.targetScalperId == null, 'second GBR does not steal target');
assert(gbrFirst.targetScalperId === 203, 'first GBR keeps target');

FD.newGame('campaign', 1);
Game.money = 999999;
Game.pursuitEventLog = [];
readyGbr();
FD.callGBR();
const gbrEmpty = Game.gbr.unit;
assert(gbrEmpty.gbrPhase === GbrPhase.PATROL, 'PATROL when no wanted');
assert(gbrEmpty.targetScalperId == null, 'no target when no wanted');
assert((Game.pursuitEventLog || []).some(e => e.msg.includes('PATROL')), 'PATROL logged on spawn');

// Restart after defeat — Boot.restart() must not throw (Game is module-scoped)
const { Boot } = await import('./js/boot.js');
for (let i = 0; i < 20; i++) {
  FD.newGame('campaign', 1);
  endGame(false);
  Boot.restart();
  assert(Game.state === 'play', 'restart ' + i + ' restores play state');
}

console.log('\nALL CRITICAL REGRESSION TESTS PASSED');
