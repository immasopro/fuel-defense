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

/** Полная загрузка по старой цене (для HUD/тестов совместимости). */
function tankerDeliveryCost() {
  return quoteFullLegacyCost();
}

function quoteFullLegacyCost() {
  return tankerDeliveryLiters() * CONFIG.fuelCostPerLiter;
}

function tankerCreditLimit(cost) {
  const c = cost != null ? cost : tankerDeliveryCost();
  return -c;
}

function canOrderTanker(money, cost) {
  const c = cost != null ? cost : tankerDeliveryCost();
  const bal = money != null ? money : Game.money;
  return bal - c >= tankerCreditLimit(c);
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
  if (!(amt > 0)) return;
  Game.stats.stolenLiters += amt;
  Game.stats.stolenDamage += amt * CONFIG.fuelCostPerLiter;
  checkScalperEvolutionThreshold();
}

/** Заправка перекупа: топливо только в его таре, в глобальный счётчик — после побега. */
function finishScalperFuel(v, amt) {
  if (!(amt > 0) || !v) return;
  v.totalGot += amt;
}

/** Успешный побег с карты — засчитываем вынесенное топливо. */
function commitScalperEscapeTheft(sc) {
  if (!sc || sc.theftCommitted || sc.theftForfeited) return;
  sc.theftCommitted = true;
  const amt = sc.totalGot || 0;
  if (amt > 0.01) recordScalperTheft(amt);
}

/** Задержание ГБР — топливо не идёт в усиление перекупов. */
function forfeitScalperTheft(sc) {
  if (!sc) return;
  sc.theftForfeited = true;
}

function removeScalper(sc, removeSet, early) {
  StationApi.removeDealer(sc, removeSet, early);
}

export { addFloat, finishFuel, finishScalperFuel, removeScalper, recordScalperTheft,
  commitScalperEscapeTheft, forfeitScalperTheft,
  tankerDeliveryLiters, tankerDeliveryCost, tankerCreditLimit, canOrderTanker, tankerTruckCapacity };
