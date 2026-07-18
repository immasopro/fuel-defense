import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { fmtRubDelta } from '../core/currency.js';
import { checkScalperEvolutionThreshold } from './scalperEvolution.js';
import { StationApi } from './stationApi.js';

function tankerTruckCapacity() {
  return CONFIG.tankerTruck.levels[Game.tankerTruck.level - 1];
}

function tankerDeliveryLiters() {
  return tankerTruckCapacity();
}

function tankerDeliveryCost() {
  return tankerDeliveryLiters() * CONFIG.fuelCostPerLiter;
}

function tankerCreditLimit() {
  return -tankerDeliveryCost();
}

function canOrderTanker(money) {
  const cost = tankerDeliveryCost();
  const bal = money != null ? money : Game.money;
  return bal - cost >= tankerCreditLimit();
}

function addFloat(x, y, txt, color) {
  Game.floats.push({ x, y, txt, color, t: 0, life: 1.3 });
}

function finishFuel(v) {
  const F = CONFIG.fuels[v.fuelKey];
  const pay = Math.round(v.got * F.price);
  if (pay > 0) {
    Game.money += pay;
    Game.stats.earned += pay;
    addFloat(v.pose.x, v.pose.y - 14, fmtRubDelta(pay), '#8bc34a');
  }
  Game.stats.liters += v.got;
  if (v.station) v.station.served++;
  if (v.canister && v.canisterLiters > 0 && v.station && v.station.canisterUp &&
      v.station.canRes > 0.5 && v.station.canCd <= 0) {
    const amt = Math.min(v.canisterLiters, v.station.canRes);
    v.station.canRes -= amt;
    v.canisterGot = amt;
    const cPay = Math.round(amt * F.price);
    Game.money += cPay;
    Game.stats.earned += cPay;
    Game.stats.liters += amt;
    addFloat(v.pose.x, v.pose.y - 28, fmtRubDelta(cPay) + ' 🧴', v.canisterColor === 'green' ? '#8bc34a' : '#ef5350');
    if (v.station.canRes <= 0.01) {
      v.station.canRes = 0;
      v.station.canCd = CONFIG.canisterReserve.cooldown;
    }
  }
  const st = v.station;
  StationApi.releaseColumn(v);
  if (st) StationApi.promotePocket(st, st.slot);
  v.served = true;
  v.pocketSlot = null;
  v.station = null;
  v.stopS = null;
  v.state = 'waitMerge';
  v.mergeT = 0;
}

function recordScalperTheft(amt) {
  Game.stats.stolenLiters += amt;
  Game.stats.stolenDamage += amt * CONFIG.fuelCostPerLiter;
  checkScalperEvolutionThreshold();
}

function finishScalperFuel(v, amt) {
  v.totalGot += amt;
  recordScalperTheft(amt);
}

function removeScalper(sc, removeSet, early) {
  StationApi.removeDealer(sc, removeSet, early);
}

export { addFloat, finishFuel, finishScalperFuel, removeScalper, recordScalperTheft,
  tankerDeliveryLiters, tankerDeliveryCost, tankerCreditLimit, canOrderTanker, tankerTruckCapacity };
