import { CONFIG } from '../config/index.js';
import { CAMPAIGN_LEVEL_COUNT } from '../config/levels.js';

const KEY_UNLOCKED = 'fd_unlocked';
const KEY_ENDLESS_UNLOCKED = 'fd_endless_unlocked';
const KEY_ENDLESS_BEST = 'fd_endless_best';
const KEY_CAMPAIGN_COMPLETE = 'fd_campaign_complete';

function readInt(key, fallback) {
  try {
    const v = parseInt(localStorage.getItem(key), 10);
    return Number.isFinite(v) ? v : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeInt(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) { }
}

function readFlag(key) {
  try { return localStorage.getItem(key) === '1'; } catch (e) { return false; }
}

function writeFlag(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) { }
}

/** Миграция: старая кампания из 10 уровней → разблокировка Endless при прохождении. */
export function migrateCampaignSave() {
  const unlocked = getUnlocked();
  if (unlocked >= 10 && !isEndlessUnlocked()) {
    setEndlessUnlocked(true);
    if (unlocked >= CAMPAIGN_LEVEL_COUNT) setCampaignComplete(true);
  }
}

export function getUnlocked() {
  return Math.min(Math.max(readInt(KEY_UNLOCKED, 1), 1), CONFIG.levels.length);
}

export function setUnlocked(n) {
  writeInt(KEY_UNLOCKED, Math.min(Math.max(n, 1), CONFIG.levels.length));
}

export function isEndlessUnlocked() {
  return readFlag(KEY_ENDLESS_UNLOCKED);
}

export function setEndlessUnlocked(on) {
  writeFlag(KEY_ENDLESS_UNLOCKED, on);
}

export function isCampaignComplete() {
  return readFlag(KEY_CAMPAIGN_COMPLETE);
}

export function setCampaignComplete(on) {
  writeFlag(KEY_CAMPAIGN_COMPLETE, on);
  if (on) setEndlessUnlocked(true);
}

export function getEndlessBest() {
  return Math.max(0, readInt(KEY_ENDLESS_BEST, 0));
}

export function setEndlessBest(n) {
  writeInt(KEY_ENDLESS_BEST, Math.max(0, Math.floor(n)));
}

/** Обновить рекорд Endless; возвращает true, если установлен новый. */
export function tryUpdateEndlessBest(served) {
  const prev = getEndlessBest();
  if (served > prev) {
    setEndlessBest(served);
    return true;
  }
  return false;
}
