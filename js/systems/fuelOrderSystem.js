/** Гибкий заказ топлива и бонусный счёт — v0.4.2 */

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

export function ensureBonusBalance() {
  if (Game.bonuses == null || !Number.isFinite(Game.bonuses)) Game.bonuses = 0;
  Game.bonuses = Math.max(0, Math.round(Game.bonuses));
  return Game.bonuses;
}

export function addBonuses(amount) {
  if (!(amount > 0)) return;
  ensureBonusBalance();
  Game.bonuses += Math.round(amount);
}

/** Макс. бонусов, которые можно потратить на улучшение: min(баланс, стоимость). */
export function maxBonusForUpgrade(cost) {
  ensureBonusBalance();
  const c = Math.round(cost || 0);
  if (c <= 0) return 0;
  return Math.min(Game.bonuses, c);
}

export function bonusUsableForCost(cost, share) {
  const s = share == null ? 1 : share;
  const maxBonus = Math.floor(Math.round(cost) * s);
  ensureBonusBalance();
  return Math.min(Game.bonuses, maxBonus);
}

/** Деньги + бонусы покрывают стоимость (доля бонусов до share, по умолчанию 100%). */
export function canAffordWithBonus(cost, share) {
  if (cost == null) return false;
  const bonus = bonusUsableForCost(cost, share == null ? 1 : share);
  return Game.money >= Math.round(cost) - bonus;
}

export function canAffordUpgrade(cost) {
  return canAffordWithBonus(cost, 1);
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
  const cash = Math.round(cost) - bonus;
  Game.money -= cash;
  Game.bonuses = (Game.bonuses || 0) - bonus;
  return { ok: true, cash, bonus };
}

/**
 * Оплата с явным количеством бонусов (окно улучшения).
 * bonusSpend ограничивается min(cost, баланс).
 */
export function payUpgrade(cost, bonusSpend) {
  const c = Math.round(cost);
  if (!(c > 0)) return { ok: false, cash: 0, bonus: 0 };
  ensureBonusBalance();
  const bonus = Math.max(0, Math.min(Math.round(bonusSpend || 0), maxBonusForUpgrade(c)));
  const cash = c - bonus;
  if (Game.money < cash) return { ok: false, cash: 0, bonus: 0 };
  Game.money -= cash;
  Game.bonuses -= bonus;
  return { ok: true, cash, bonus };
}

/** v0.4.2: до 100% стоимости улучшения можно оплатить бонусами. */
export function stationBonusShare() {
  return CONFIG.fuelOrder.bonusShareStation ?? 1;
}

export function depotBonusShare() {
  return CONFIG.fuelOrder.bonusShareDepot ?? 1;
}
