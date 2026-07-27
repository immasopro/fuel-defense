/** Аварийный обмен бонусов на деньги — v0.4.2.1
 * Курс фиксированный 2:1. Только три пакета. Без магазина и произвольного ввода.
 */

import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { ensureBonusBalance } from './fuelOrderSystem.js';

export function getExchangeRate() {
  return CONFIG.bonusExchange?.rate || 2;
}

export function getExchangePacks() {
  return CONFIG.bonusExchange?.packs || [];
}

export function getExchangePack(id) {
  return getExchangePacks().find(p => p.id === id) || null;
}

export function canExchangePack(pack, bonuses) {
  const bal = bonuses != null ? bonuses : ensureBonusBalance();
  if (!pack) return false;
  return bal >= pack.bonuses;
}

export function listExchangePacks(bonuses) {
  const bal = bonuses != null ? bonuses : ensureBonusBalance();
  const rate = getExchangeRate();
  return getExchangePacks().map(p => ({
    id: p.id,
    label: p.id === 'small' ? 'Малый' : p.id === 'medium' ? 'Средний' : p.id === 'large' ? 'Большой' : p.id,
    bonuses: p.bonuses,
    money: p.money,
    available: bal >= p.bonuses,
    rate
  }));
}

/**
 * Атомарный обмен пакета.
 * @returns {{ ok: boolean, bonusesSpent?: number, moneyGained?: number, error?: string }}
 */
export function exchangeBonusPack(packId) {
  const pack = getExchangePack(packId);
  if (!pack) return { ok: false, error: 'unknown_pack' };
  ensureBonusBalance();
  if (Game.bonuses < pack.bonuses) return { ok: false, error: 'insufficient_bonuses' };

  const rate = getExchangeRate();
  const moneyGained = Math.round(pack.bonuses / rate);
  if (moneyGained !== pack.money) return { ok: false, error: 'rate_mismatch' };

  const beforeBonuses = Game.bonuses;
  const beforeMoney = Game.money;
  Game.bonuses = beforeBonuses - pack.bonuses;
  Game.money = beforeMoney + moneyGained;

  if (Game.bonuses !== beforeBonuses - pack.bonuses || Game.money !== beforeMoney + moneyGained) {
    Game.bonuses = beforeBonuses;
    Game.money = beforeMoney;
    return { ok: false, error: 'atomic_failed' };
  }

  return { ok: true, bonusesSpent: pack.bonuses, moneyGained };
}

/** @deprecated use getExchangeRate */
export const BONUS_EXCHANGE_RATE = 2;
export const BONUS_EXCHANGE_PACKS = [
  { id: 'small', bonuses: 10000, money: 5000, label: 'Малый' },
  { id: 'medium', bonuses: 50000, money: 25000, label: 'Средний' },
  { id: 'large', bonuses: 100000, money: 50000, label: 'Большой' }
];
