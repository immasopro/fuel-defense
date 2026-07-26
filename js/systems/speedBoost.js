/** Ускорение времени 2x — v0.4.3
 * Лимит: 60 с реального времени на уровень при timeScale=2.
 * Пауза не расходует лимит. Рекламный SDK не подключаем.
 */

import { Game } from '../core/gameState.js';

export const SPEED_BOOST_DEFAULT_SECONDS = 60;

export function initSpeedBoost() {
  Game.timeScale = 1;
  Game.speedBoost = {
    remaining: SPEED_BOOST_DEFAULT_SECONDS,
    limit: SPEED_BOOST_DEFAULT_SECONDS
  };
}

export function getSpeedBoostRemaining() {
  return Math.max(0, Game.speedBoost?.remaining ?? 0);
}

export function isSpeedBoostActive() {
  return (Game.timeScale || 1) > 1.01;
}

/** Вкл/выкл 2x. После исчерпания лимита включить нельзя. */
export function toggleSpeedBoost() {
  if (!Game.speedBoost) initSpeedBoost();
  if (isSpeedBoostActive()) {
    Game.timeScale = 1;
    return true;
  }
  if (getSpeedBoostRemaining() <= 0) {
    Game.timeScale = 1;
    return false;
  }
  Game.timeScale = 2;
  return true;
}

/**
 * Тик лимита по реальному времени (не симуляционному).
 * Вызывать только в play и не на паузе.
 */
export function tickSpeedBoost(realDt) {
  if (!Game.speedBoost) return;
  if (!isSpeedBoostActive()) return;
  if (!(realDt > 0)) return;
  Game.speedBoost.remaining -= realDt;
  if (Game.speedBoost.remaining <= 0) {
    Game.speedBoost.remaining = 0;
    Game.timeScale = 1;
  }
}

/** API для будущей рекламы — добавить секунды реального 2x. */
export function addSpeedBoostTime(seconds) {
  if (!Game.speedBoost) initSpeedBoost();
  const n = Number(seconds);
  if (!(n > 0)) return getSpeedBoostRemaining();
  Game.speedBoost.remaining += n;
  return Game.speedBoost.remaining;
}

/** Подпись: `2x 0:60`, `2x 0:42` */
export function speedBoostLabel() {
  const s = Math.max(0, Math.ceil(getSpeedBoostRemaining()));
  if (s <= 99) return '2x 0:' + String(s).padStart(2, '0');
  const m = Math.floor(s / 60);
  const r = s % 60;
  return '2x ' + m + ':' + String(r).padStart(2, '0');
}

export function canEnableSpeedBoost() {
  return getSpeedBoostRemaining() > 0 || isSpeedBoostActive();
}
