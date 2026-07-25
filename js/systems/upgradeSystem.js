import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Depot, GBRBase } from '../world/map.js';
import { Station } from '../stations/station.js';
import { Pump } from '../stations/pump.js';
import { addFloat } from './economySystem.js';
import { fmtRubDelta } from '../core/currency.js';
import { onFleetLevelUp } from './tankerLogistics.js';
import { onGbrBaseLevelUp, gbrBaseUpgradeCost } from './gbrLogistics.js';
import {
  payWithBonus, canAffordWithBonus, stationBonusShare, depotBonusShare
} from './fuelOrderSystem.js';

function resUpgradeCost(st) {
  return st.resLevel >= 5 ? null : CONFIG.station.resCosts[st.resLevel - 1];
}

function pumpUpgradeCost(pump) {
  return pump.level >= 5 ? null : CONFIG.pump.upCosts[pump.level - 1];
}

function fuelUnlockCost(st) {
  if (st.unlocked.length >= Object.keys(CONFIG.fuels).length) return null;
  return Math.round(CONFIG.fuelUnlock.base *
    Math.pow(CONFIG.fuelUnlock.growth, st.unlocked.length - 1) / 5) * 5;
}

function addPumpCost(st) {
  if (st.pumps.length >= CONFIG.pump.maxPerStation) return null;
  const c = CONFIG.addPump.base *
    Math.pow(CONFIG.addPump.countGrowth, st.pumps.length - 1) *
    Math.pow(CONFIG.addPump.fuelGrowth, st.unlocked.length - 1);
  return Math.round(c / 5) * 5;
}

function payStation(cost, x, y) {
  const r = payWithBonus(cost, stationBonusShare());
  if (!r.ok) return false;
  addFloat(x, y, fmtRubDelta(-r.cash) + (r.bonus ? ' +' + r.bonus + ' б.' : ''), '#ef5350');
  return true;
}

function payDepot(cost, x, y) {
  const r = payWithBonus(cost, depotBonusShare());
  if (!r.ok) return false;
  addFloat(x, y, fmtRubDelta(-r.cash) + (r.bonus ? ' +' + r.bonus + ' б.' : ''), '#ef5350');
  return true;
}

/** Только рубли — бонусы нельзя тратить на бензовоз / ГБР / прочее. */
function payCashOnly(cost, x, y) {
  if (cost == null || Game.money < cost) return false;
  Game.money -= cost;
  addFloat(x, y, fmtRubDelta(-cost), '#ef5350');
  return true;
}

function actionBuildStation(slot, fuel) {
  if (slot.station || !canAffordWithBonus(CONFIG.station.cost, stationBonusShare())) return false;
  if (!payStation(CONFIG.station.cost, slot.pos.x, slot.pos.y - 18)) return false;
  slot.station = new Station(fuel);
  slot.station.slot = slot;
  return true;
}

function actionUpgradeReservoir(st) {
  const c = resUpgradeCost(st);
  if (c == null || !canAffordWithBonus(c, stationBonusShare())) return false;
  if (!payStation(c, st.slot.pos.x, st.slot.pos.y - 18)) return false;
  st.resLevel++;
  st.cap = CONFIG.station.resLevels[st.resLevel - 1];
  return true;
}

function actionUpgradePump(st, j) {
  const pump = st.pumps[j];
  if (!pump) return false;
  const c = pumpUpgradeCost(pump);
  if (c == null || !canAffordWithBonus(c, stationBonusShare())) return false;
  if (!payStation(c, st.slot.pos.x, st.slot.pos.y - 18)) return false;
  pump.level++;
  return true;
}

function actionUnlockFuel(st, fuel) {
  const c = fuelUnlockCost(st);
  if (c == null || st.unlocked.includes(fuel) || !canAffordWithBonus(c, stationBonusShare())) return false;
  if (!payStation(c, st.slot.pos.x, st.slot.pos.y - 18)) return false;
  st.unlocked.push(fuel);
  return true;
}

function actionAddPump(st, fuel) {
  const c = addPumpCost(st);
  if (c == null || !st.unlocked.includes(fuel) || !canAffordWithBonus(c, stationBonusShare())) return false;
  if (!payStation(c, st.slot.pos.x, st.slot.pos.y - 18)) return false;
  st.pumps.push(new Pump(fuel));
  return true;
}

function actionBuyCanisterReserve(st) {
  const c = CONFIG.canisterReserve.cost;
  if (st.canisterUp || !canAffordWithBonus(c, stationBonusShare())) return false;
  if (!payStation(c, st.slot.pos.x, st.slot.pos.y - 18)) return false;
  st.canisterUp = true;
  st.canRes = st.canCap;
  return true;
}

function actionBuyGbrAutoCall(st) {
  const c = CONFIG.gbrAutoCall.cost;
  if (st.gbrAutoCall || Game.money < c) return false;
  if (!payCashOnly(c, st.slot.pos.x, st.slot.pos.y - 18)) return false;
  st.gbrAutoCall = true;
  st.gbrAutoCallOn = false;
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
  if (!payCashOnly(c, Depot.pos.x, Depot.pos.y - 30)) return false;
  Game.tankerTruck.level++;
  return true;
}

function actionUpgradeFleet() {
  const c = fleetUpgradeCost();
  if (c == null || Game.money < c) return false;
  if (!payCashOnly(c, Depot.pos.x, Depot.pos.y - 30)) return false;
  Game.fleet.level++;
  onFleetLevelUp();
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
  if (c == null || !canAffordWithBonus(c, depotBonusShare())) return false;
  if (!payDepot(c, Depot.pos.x, Depot.pos.y - 30)) return false;
  Game.depot.level++;
  Game.depot.cap = Depot.cap();
  return true;
}

export { resUpgradeCost, pumpUpgradeCost, fuelUnlockCost, addPumpCost,
  tankerTruckUpgradeCost, fleetUpgradeCost, gbrBaseUpgradeCost,
  actionBuildStation, actionUpgradeReservoir, actionUpgradePump, actionUnlockFuel,
  actionAddPump, actionBuyCanisterReserve, actionBuyGbrAutoCall, actionUpgradeDepot,
  actionUpgradeTankerTruck, actionUpgradeFleet, actionUpgradeGbrBase };
