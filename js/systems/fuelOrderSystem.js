/** Гибкий заказ топлива и бонусный счёт — v0.4.1 */

import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { tankerTruckCapacity } from './economySystem.js';

export function normalizeOrderPercent(pct) {
  const list = CONFIG.fuelOrder.percents;
  const n = Math.round(Number(pct) / 10) * 10;
  if (list.includes(n)) return n;
  let best = list[0];
  let bestD = Math.abs(n - best);
  for (const p of list) {
    const d = Math.abs(n - p);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/** Расчёт заказа по % загрузки бака бензовоза. */
export function quoteFuelOrder(percent) {
  const pct = normalizeOrderPercent(percent);
  const cap = tankerTruckCapacity();
  const liters = Math.round(cap * pct / 100);
  const pricePerLiter = CONFIG.fuelOrder.pricePerLiter[pct];
  const cost = liters * pricePerLiter;
  const cashbackPct = CONFIG.fuelOrder.cashbackPct[pct];
  const bonuses = Math.round(cost * cashbackPct / 100);
  return { percent: pct, capacity: cap, liters, pricePerLiter, cost, cashbackPct, bonuses };
}

/** Строгая проверка для меню заказа: нужны деньги ≥ стоимости (без кредита). */
export function canAffordFuelOrder(quote, money) {
  const bal = money != null ? money : Game.money;
  const cost = quote?.cost ?? 0;
  return bal >= cost;
}

export function addBonuses(amount) {
  if (!(amount > 0)) return;
  Game.bonuses = (Game.bonuses || 0) + Math.round(amount);
}

export function bonusUsableForCost(cost, share) {
  const maxBonus = Math.floor(cost * share);
  return Math.min(Game.bonuses || 0, maxBonus);
}

export function canAffordWithBonus(cost, share) {
  if (cost == null) return false;
  const bonus = bonusUsableForCost(cost, share);
  return Game.money >= cost - bonus;
}

/**
 * Оплата улучшения: часть бонусами (до share), остальное рублями.
 * @returns {{ ok: boolean, cash: number, bonus: number }}
 */
export function payWithBonus(cost, share) {
  if (cost == null || !canAffordWithBonus(cost, share)) {
    return { ok: false, cash: 0, bonus: 0 };
  }
  const bonus = bonusUsableForCost(cost, share);
  const cash = cost - bonus;
  Game.money -= cash;
  Game.bonuses = (Game.bonuses || 0) - bonus;
  return { ok: true, cash, bonus };
}

export function stationBonusShare() {
  return CONFIG.fuelOrder.bonusShareStation;
}

export function depotBonusShare() {
  return CONFIG.fuelOrder.bonusShareDepot;
}
