function hitGBRBase(lx, ly) {
  if (!GBRBase.pos) return false;
  return Math.hypot(lx - GBRBase.pos.x, ly - GBRBase.pos.y) < 32;
}

function stationTankPos(slot) {
  const p = Road.posAt(mod(slot.s + 8, Road.length), CONFIG.road.stationTankLat);
  return { x: p.x, y: p.y, a: p.a, w: 18, h: 36 };
}

function hitStationTank(slot, lx, ly) {
  const tp = stationTankPos(slot);
  const dx = lx - tp.x, dy = ly - tp.y;
  return Math.hypot(dx, dy) < 22;
}

function hitDepot(lx, ly) {
  if (!Depot.pos) return false;
  return Math.hypot(lx - Depot.pos.x, ly - Depot.pos.y) < 40;
}

function sortedStationSlots() {
  return Road.slots.filter(s => s.station).sort((a, b) => a.s - b.s);
}

function findFreePump(st) {
  for (let j = 0; j < st.pumps.length; j++) {
    const p = st.pumps[j];
    if (!p.blocked && !p.claimed && p.cars.length === 0) return j;
  }
  return -1;
}

function distributeDepotFuel(dt) {
  const requesters = Road.slots.filter(s => s.station && s.station.res < s.station.cap - 0.5);
  if (!requesters.length || Game.depot.res <= 0) return;
  const totalRate = Depot.deliveryRate();
  const perSt = totalRate / requesters.length;
  for (const slot of requesters) {
    const st = slot.station;
    const amt = Math.min(perSt * dt, Game.depot.res, st.cap - st.res);
    if (amt > 0) { st.res += amt; Game.depot.res -= amt; }
  }
}

function refillCanisterReserve(st, dt) {
  if (!st.canisterUp) return;
  if (st.canCd > 0) { st.canCd -= dt; return; }
  if (st.canRes >= st.canCap - 0.01) return;
  const amt = Math.min(CONFIG.canisterReserve.refillRate * dt, st.canCap - st.canRes, st.res);
  if (amt > 0) { st.canRes += amt; st.res -= amt; }
}

/* ---------- экономика прокачки (используется и панелью, и логикой) ---------- */
function resUpgradeCost(st) {                // 1.1 резервуар — самая дешёвая ветка
  return st.resLevel >= 5 ? null : CONFIG.station.resCosts[st.resLevel - 1];
}
function pumpUpgradeCost(pump) {             // 1.2 уровень колонки — индивидуально
  return pump.level >= 5 ? null : CONFIG.pump.upCosts[pump.level - 1];
}
function fuelUnlockCost(st) {                // 1.3 новое топливо — экспоненциально
  if (st.unlocked.length >= Object.keys(CONFIG.fuels).length) return null;
  return Math.round(CONFIG.fuelUnlock.base *
    Math.pow(CONFIG.fuelUnlock.growth, st.unlocked.length - 1) / 5) * 5;
}
function addPumpCost(st) {                   // 1.4 новая колонка — самое дорогое
  if (st.pumps.length >= CONFIG.pump.maxPerStation) return null;
  const c = CONFIG.addPump.base *
    Math.pow(CONFIG.addPump.countGrowth, st.pumps.length - 1) *
    Math.pow(CONFIG.addPump.fuelGrowth, st.unlocked.length - 1);
  return Math.round(c / 5) * 5;
}

function actionBuildStation(slot, fuel) {
  if (slot.station || Game.money < CONFIG.station.cost) return false;
  Game.money -= CONFIG.station.cost;
  slot.station = new Station(fuel);
  slot.station.slot = slot;
  addFloat(slot.pos.x, slot.pos.y - 18, '-$' + CONFIG.station.cost, '#ef5350');
  return true;
}
function actionUpgradeReservoir(st) {
  const c = resUpgradeCost(st);
  if (c == null || Game.money < c) return false;
  Game.money -= c;
  st.resLevel++;
  st.cap = CONFIG.station.resLevels[st.resLevel - 1];
  addFloat(st.slot.pos.x, st.slot.pos.y - 18, '-$' + c, '#ef5350');
  return true;
}
function actionUpgradePump(st, j) {
  const pump = st.pumps[j];
  if (!pump) return false;
  const c = pumpUpgradeCost(pump);
  if (c == null || Game.money < c) return false;
  Game.money -= c;
  pump.level++;
  addFloat(st.slot.pos.x, st.slot.pos.y - 18, '-$' + c, '#ef5350');
  return true;
}
function actionUnlockFuel(st, fuel) {
  const c = fuelUnlockCost(st);
  if (c == null || st.unlocked.includes(fuel) || Game.money < c) return false;
  Game.money -= c;
  st.unlocked.push(fuel);
  addFloat(st.slot.pos.x, st.slot.pos.y - 18, '-$' + c, '#ef5350');
  return true;
}
function actionAddPump(st, fuel) {
  const c = addPumpCost(st);
  if (c == null || !st.unlocked.includes(fuel) || Game.money < c) return false;
  Game.money -= c;
  st.pumps.push(new Pump(fuel));
  addFloat(st.slot.pos.x, st.slot.pos.y - 18, '-$' + c, '#ef5350');
  return true;
}
function actionBuyCanisterReserve(st) {
  if (st.canisterUp || Game.money < CONFIG.canisterReserve.cost) return false;
  Game.money -= CONFIG.canisterReserve.cost;
  st.canisterUp = true;
  st.canRes = st.canCap;
  addFloat(st.slot.pos.x, st.slot.pos.y - 18, '-$' + CONFIG.canisterReserve.cost, '#ef5350');
  return true;
}
function actionUpgradeDepot() {
  const c = Depot.upgradeCost();
  if (c == null || Game.money < c) return false;
  Game.money -= c;
  Game.depot.level++;
  Game.depot.cap = Depot.cap();
  addFloat(Depot.pos.x, Depot.pos.y - 30, '-$' + c, '#ef5350');
  return true;
}
