import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Depot, GBRBase } from '../world/map.js';
import { Station } from '../stations/station.js';
import { Pump } from '../stations/pump.js';
import { addFloat } from './economySystem.js';
import { fmtRubDelta } from '../core/currency.js';
import { onFleetLevelUp } from './tankerLogistics.js';
import { onGbrBaseLevelUp, gbrBaseUpgradeCost } from './gbrLogistics.js';

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
  addFloat(slot.pos.x, slot.pos.y - 18, fmtRubDelta(-CONFIG.station.cost), '#ef5350');
  return true;
}

function actionUpgradeReservoir(st) {
  const c = resUpgradeCost(st);
  if (c == null || Game.money < c) return false;
  Game.money -= c;
  st.resLevel++;
  st.cap = CONFIG.station.resLevels[st.resLevel - 1];
  addFloat(st.slot.pos.x, st.slot.pos.y - 18, fmtRubDelta(-c), '#ef5350');
  return true;
}

function actionUpgradePump(st, j) {
  const pump = st.pumps[j];
  if (!pump) return false;
  const c = pumpUpgradeCost(pump);
  if (c == null || Game.money < c) return false;
  Game.money -= c;
  pump.level++;
  addFloat(st.slot.pos.x, st.slot.pos.y - 18, fmtRubDelta(-c), '#ef5350');
  return true;
}

function actionUnlockFuel(st, fuel) {
  const c = fuelUnlockCost(st);
  if (c == null || st.unlocked.includes(fuel) || Game.money < c) return false;
  Game.money -= c;
  st.unlocked.push(fuel);
  addFloat(st.slot.pos.x, st.slot.pos.y - 18, fmtRubDelta(-c), '#ef5350');
  return true;
}

function actionAddPump(st, fuel) {
  const c = addPumpCost(st);
  if (c == null || !st.unlocked.includes(fuel) || Game.money < c) return false;
  Game.money -= c;
  st.pumps.push(new Pump(fuel));
  addFloat(st.slot.pos.x, st.slot.pos.y - 18, fmtRubDelta(-c), '#ef5350');
  return true;
}

function actionBuyCanisterReserve(st) {
  if (st.canisterUp || Game.money < CONFIG.canisterReserve.cost) return false;
  Game.money -= CONFIG.canisterReserve.cost;
  st.canisterUp = true;
  st.canRes = st.canCap;
  addFloat(st.slot.pos.x, st.slot.pos.y - 18, fmtRubDelta(-CONFIG.canisterReserve.cost), '#ef5350');
  return true;
}

function actionBuyGbrAutoCall(st) {
  if (st.gbrAutoCall || Game.money < CONFIG.gbrAutoCall.cost) return false;
  Game.money -= CONFIG.gbrAutoCall.cost;
  st.gbrAutoCall = true;
  st.gbrAutoCallOn = false;
  addFloat(st.slot.pos.x, st.slot.pos.y - 18, fmtRubDelta(-CONFIG.gbrAutoCall.cost), '#ef5350');
  return true;
}

function tankerTruckUpgradeCost() {
  return Game.tankerTruck.level >= CONFIG.tankerTruck.levels.length
    ? null : CONFIG.tankerTruck.upgradeCosts[Game.tankerTruck.level - 1];
}

function fleetUpgradeCost() {
  return Game.fleet.level >= CONFIG.fleet.maxCount.length
    ? null : CONFIG.fleet.upgradeCosts[Game.fleet.level - 1];
}

function actionUpgradeTankerTruck() {
  const c = tankerTruckUpgradeCost();
  if (c == null || Game.money < c) return false;
  Game.money -= c;
  Game.tankerTruck.level++;
  addFloat(Depot.pos.x, Depot.pos.y - 30, fmtRubDelta(-c), '#ef5350');
  return true;
}

function actionUpgradeFleet() {
  const c = fleetUpgradeCost();
  if (c == null || Game.money < c) return false;
  Game.money -= c;
  Game.fleet.level++;
  onFleetLevelUp();
  addFloat(Depot.pos.x, Depot.pos.y - 30, fmtRubDelta(-c), '#ef5350');
  return true;
}

function actionUpgradeGbrBase() {
  const c = gbrBaseUpgradeCost();
  if (c == null || Game.money < c) return false;
  Game.money -= c;
  Game.gbrBase.level++;
  onGbrBaseLevelUp();
  addFloat(GBRBase.pos.x, GBRBase.pos.y - 20, fmtRubDelta(-c), '#ef5350');
  return true;
}

function actionUpgradeDepot() {
  const c = Depot.upgradeCost();
  if (c == null || Game.money < c) return false;
  Game.money -= c;
  Game.depot.level++;
  Game.depot.cap = Depot.cap();
  addFloat(Depot.pos.x, Depot.pos.y - 30, fmtRubDelta(-c), '#ef5350');
  return true;
}

export { resUpgradeCost, pumpUpgradeCost, fuelUnlockCost, addPumpCost,
  tankerTruckUpgradeCost, fleetUpgradeCost, gbrBaseUpgradeCost,
  actionBuildStation, actionUpgradeReservoir, actionUpgradePump, actionUnlockFuel,
  actionAddPump, actionBuyCanisterReserve, actionBuyGbrAutoCall, actionUpgradeDepot,
  actionUpgradeTankerTruck, actionUpgradeFleet, actionUpgradeGbrBase };
