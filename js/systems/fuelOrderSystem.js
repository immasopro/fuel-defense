/** Гибкий заказ топлива и бонусный счёт — v0.4.2 */

import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { tankerTruckCapacity, canOrderTanker } from './economySystem.js';
import { saveRunEconomy } from './runEconomySave.js';

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

/**
 * Доступность заказа топлива — та же кредитная политика, что canOrderTanker:
 * после списания баланс не ниже −cost (эквивалентно bal >= 0 при положительном cost).
 * Бонусы не учитываются.
 */
export function canAffordFuelOrder(quote, money) {
  const bal = money != null ? money : Game.money;
  const cost = quote?.cost ?? 0;
  return canOrderTanker(bal, cost);
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
  saveRunEconomy();
}

/** Макс. доля стоимости улучшения, которую можно оплатить бонусами. */
export function upgradeBonusShare() {
  const s = CONFIG.fuelOrder.bonusShareStation;
  return s != null ? s : 0.99;
}

/** Минимум денег за улучшение: ≥ 1% и никогда 0 при cost > 0. */
export function minCashForUpgrade(cost) {
  const c = Math.round(cost || 0);
  if (c <= 0) return 0;
  if (c === 1) return 1;
  const maxBonusByShare = Math.floor(c * upgradeBonusShare());
  return Math.max(1, c - maxBonusByShare);
}

/** Макс. бонусов на улучшение: min(баланс, floor(cost×share), cost−minCash). */
export function maxBonusForUpgrade(cost) {
  ensureBonusBalance();
  const c = Math.round(cost || 0);
  if (c <= 0) return 0;
  const maxByShare = Math.floor(c * upgradeBonusShare());
  const maxByCashFloor = c - minCashForUpgrade(c);
  return Math.max(0, Math.min(Game.bonuses, maxByShare, maxByCashFloor));
}

export function bonusUsableForCost(cost, share) {
  const c = Math.round(cost || 0);
  if (c <= 0) return 0;
  const s = share == null ? upgradeBonusShare() : share;
  const maxBonus = Math.min(Math.floor(c * s), c - minCashForUpgrade(c));
  ensureBonusBalance();
  return Math.max(0, Math.min(Game.bonuses, maxBonus));
}

/** Деньги + бонусы покрывают стоимость (доля бонусов до share). */
export function canAffordWithBonus(cost, share) {
  if (cost == null) return false;
  const c = Math.round(cost);
  const bonus = bonusUsableForCost(c, share == null ? upgradeBonusShare() : share);
  const cash = c - bonus;
  return Game.money >= cash && cash >= minCashForUpgrade(c);
}

export function canAffordUpgrade(cost) {
  return canAffordWithBonus(cost, upgradeBonusShare());
}

/**
 * Оплата улучшения: часть бонусами (до share), остальное рублями.
 * @returns {{ ok: boolean, cash: number, bonus: number }}
 */
export function payWithBonus(cost, share) {
  if (cost == null || !canAffordWithBonus(cost, share)) {
    return { ok: false, cash: 0, bonus: 0 };
  }
  const c = Math.round(cost);
  const bonus = bonusUsableForCost(c, share == null ? upgradeBonusShare() : share);
  const cash = c - bonus;
  if (cash < minCashForUpgrade(c) || Game.money < cash) {
    return { ok: false, cash: 0, bonus: 0 };
  }
  Game.money -= cash;
  Game.bonuses = (Game.bonuses || 0) - bonus;
  saveRunEconomy();
  return { ok: true, cash, bonus };
}

/**
 * Оплата с явным количеством бонусов (окно улучшения).
 * bonusSpend ограничивается maxBonusForUpgrade (≤ 99%, cash ≥ 1%).
 */
export function payUpgrade(cost, bonusSpend) {
  const c = Math.round(cost);
  if (!(c > 0)) return { ok: false, cash: 0, bonus: 0 };
  ensureBonusBalance();
  const bonus = Math.max(0, Math.min(Math.round(bonusSpend || 0), maxBonusForUpgrade(c)));
  const cash = c - bonus;
  if (cash < minCashForUpgrade(c)) return { ok: false, cash: 0, bonus: 0 };
  if (Game.money < cash) return { ok: false, cash: 0, bonus: 0 };
  Game.money -= cash;
  Game.bonuses -= bonus;
  saveRunEconomy();
  return { ok: true, cash, bonus };
}

/** v0.4.2.4: до 99% стоимости улучшения можно оплатить бонусами. */
export function stationBonusShare() {
  return CONFIG.fuelOrder.bonusShareStation ?? 0.99;
}

export function depotBonusShare() {
  return CONFIG.fuelOrder.bonusShareDepot ?? 0.99;
}
