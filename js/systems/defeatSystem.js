import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { fmtTime } from '../core/utils.js';
import { fmtRub } from '../core/currency.js';
import {
  getTargetCars, hasLevelTarget, getSpawnedCars, countVehiclesOnMap, isLevelTrafficVehicle
} from './spawnSystem.js';
import { quoteFuelOrder, canAffordFuelOrder } from './fuelOrderSystem.js';
import { hasActiveTankerDelivery, hasReadyTanker } from './tankerLogistics.js';
import { sortedStationSlots } from '../world/map.js';
import { innerLaneList, spawnClear, isLightGreen } from './trafficSystem.js';
import { closePanel } from '../ui/stationPanel.js';
import { UI } from '../ui/hud.js';
import {
  getUnlocked, setUnlocked, setCampaignComplete,
  tryUpdateEndlessBest, getEndlessBest
} from './campaignSave.js';
import { CAMPAIGN_LEVEL_COUNT } from '../config/levels.js';
import { isScalperLeavingMap } from './scalperLifecycle.js';
import { formatExtendedStatsHtml } from './runStats.js';

function clientNeedsService(v) {
  if (!isLevelTrafficVehicle(v)) return false;
  if (v.kind === 'car') return !v.served;
  if (v.kind === 'scalper' || v.isScalper) {
    if (isScalperLeavingMap(v)) return false;
    return true;
  }
  if (v.kind === 'corporate') return !v.served;
  return false;
}

/** Есть трафик, которому ещё нужно обслуживание / топливо. */
function hasWaitingClients() {
  if (hasLevelTarget()) {
    const target = getTargetCars();
    // Пока бюджет не исчерпан — ещё будут клиенты.
    if (target != null && getSpawnedCars() < target) return true;
  } else {
    return true;
  }
  for (const v of Game.holder || []) {
    if (clientNeedsService(v)) return true;
  }
  if (Game.holderPriorityWait && clientNeedsService(Game.holderPriorityWait)) return true;
  for (const v of Game.vehicles || []) {
    if (clientNeedsService(v)) return true;
  }
  if (Game.prepared && !Game.prepared.ready) return true;
  if (Game.prepared?.vehicle && clientNeedsService(Game.prepared.vehicle)) return true;
  return false;
}

function isFuelExhausted() {
  if (Game.depot.res > 0.01) return false;
  const slots = sortedStationSlots();
  if (!slots.length) return false;
  for (const slot of slots) {
    if (slot.station && slot.station.res > 0.01) return false;
  }
  return true;
}

function isTankerCreditBlocked() {
  if (hasActiveTankerDelivery()) return false;
  if (!sortedStationSlots().length) return true;
  const minQuote = quoteFuelOrder(20);
  const cannotPay = !canAffordFuelOrder(minQuote);
  if (hasReadyTanker()) return cannotPay;
  const hasQueued = Game.logistics?.trucks.some(t =>
    t.state === 'PREPARING' || t.state === 'WAIT_PREPARING');
  if (hasQueued) return cannotPay;
  return cannotPay;
}

function isFuelCrisisCondition() {
  if (hasActiveTankerDelivery()) return false;
  return hasWaitingClients() && isFuelExhausted() && isTankerCreditBlocked();
}

/**
 * Топливный кризис с таймером (v0.4.3.3).
 * @returns {boolean} true если уровень завершён поражением
 */
function checkFuelCrisis(dt) {
  if (Game.state !== 'play') return false;
  if (!isFuelCrisisCondition()) {
    Game.fuelCrisisT = 0;
    return false;
  }
  const step = dt > 0 ? dt : 0;
  Game.fuelCrisisT = (Game.fuelCrisisT || 0) + step;
  const limit = CONFIG.fuelCrisisTime ?? 8;
  if (Game.fuelCrisisT >= limit) {
    endGame(false, 'fuel_crisis');
    return true;
  }
  return false;
}

function updateDefeatTimer(dt) {
  if (!isLightGreen()) { Game.defeatT = 0; return; }
  if (Game.holder.length < CONFIG.holder.max) { Game.defeatT = 0; return; }
  const first = Game.holder[0];
  if (!first || first.countsForDefeat === false) { Game.defeatT = 0; return; }
  if (spawnClear(innerLaneList(), first.len)) { Game.defeatT = 0; return; }
  Game.defeatT += dt;
  if (Game.defeatT >= CONFIG.defeatTime) { endGame(false, 'traffic'); return true; }
  return false;
}

/**
 * Завершение кампании: spawned >= target и клиентский трафик = 0.
 * @returns {boolean}
 */
function checkLevelComplete() {
  if (Game.state !== 'play') return false;
  if (Game.mode !== 'campaign') return false;
  const target = getTargetCars();
  if (target == null) return false;
  if (getSpawnedCars() < target) return false;
  if (countVehiclesOnMap() > 0) return false;
  if (Game.money < 0) endGame(false, 'bankruptcy');
  else endGame(true);
  return true;
}

function formatServedLine() {
  if (Game.mode === 'endless') {
    return '⛽ Обслужено машин: <b>' + Game.stats.served + '</b>';
  }
  const target = getTargetCars();
  return '🚦 Поток: <b>' + getSpawnedCars() + ' / ' + target + '</b><br>' +
    '⛽ Обслужено: <b>' + Game.stats.served + '</b>';
}

function endGame(win, reason) {
  const defeatReason = reason || (win ? 'win' : 'traffic');
  Game.state = win ? 'win' : 'over';
  Game.defeatReason = defeatReason;
  Game.fuelCrisisT = 0;
  closePanel();
  UI.warning.classList.add('hidden');
  const target = getTargetCars();
  const campaignFinal = win && Game.mode === 'campaign' && Game.levelIdx === CAMPAIGN_LEVEL_COUNT;
  let endlessNewRecord = false;

  if (defeatReason === 'bankruptcy') {
    UI.endTitle.textContent = '💥 ИГРА ОКОНЧЕНА';
    UI.endTitle.style.color = '#ef5350';
    UI.endDesc.textContent =
      'Вы завершили уровень, но не смогли рассчитаться за закупленное топливо.';
  } else if (defeatReason === 'fuel_crisis') {
    UI.endTitle.textContent = '💥 ИГРА ОКОНЧЕНА';
    UI.endTitle.style.color = '#ef5350';
    UI.endDesc.textContent = 'Недостаточно топлива для завершения уровня.';
    if (UI.btnRestart) UI.btnRestart.textContent = 'Начать заново';
    if (UI.btnMenu) UI.btnMenu.textContent = 'Главное меню';
  } else if (Game.mode === 'endless' && !win) {
    endlessNewRecord = tryUpdateEndlessBest(Game.stats.served);
    UI.endTitle.textContent = '💥 ИГРА ОКОНЧЕНА';
    UI.endTitle.style.color = '#ef5350';
    UI.endDesc.textContent = 'Накопитель переполнен — пробка не рассеялась за ' + CONFIG.defeatTime +
      ' с. Обслужено ' + Game.stats.served + ' машин.' +
      (endlessNewRecord ? ' 🏆 Новый рекорд!' : '');
    if (UI.btnRestart) UI.btnRestart.textContent = 'ЕЩЁ РАЗ';
    if (UI.btnMenu) UI.btnMenu.textContent = 'В МЕНЮ';
  } else if (campaignFinal) {
    setCampaignComplete(true);
    UI.endTitle.textContent = '🏆 КАМПАНИЯ ПРОЙДЕНА!';
    UI.endTitle.style.color = '#8bc34a';
    UI.endDesc.textContent =
      'Поздравляем! Вы прошли все ' + CAMPAIGN_LEVEL_COUNT + ' уровней кампании. ' +
      'Разблокирован бесконечный режим — проверьте, сколько машин сможете обслужить!';
    if (UI.btnRestart) UI.btnRestart.textContent = 'ЕЩЁ РАЗ';
    if (UI.btnMenu) UI.btnMenu.textContent = 'В МЕНЮ';
  } else {
    if (UI.btnRestart) UI.btnRestart.textContent = 'ЕЩЁ РАЗ';
    if (UI.btnMenu) UI.btnMenu.textContent = 'В МЕНЮ';
    UI.endTitle.textContent = win ? '🏆 ПОБЕДА!' : '💥 ИГРА ОКОНЧЕНА';
    UI.endTitle.style.color = win ? '#8bc34a' : '#ef5350';
    UI.endDesc.textContent = win
      ? ('Уровень ' + Game.levelIdx + ' пройден — поток ' + target + ' машин завершён!')
      : ('Накопитель переполнен, и въезд остался заблокирован ' + CONFIG.defeatTime +
        ' секунд.');
  }

  let statsHtml = '⏱ Время: <b>' + fmtTime(Game.time) + '</b><br>' + formatServedLine() + '<br>' +
    '🛢 Отпущено топлива: <b>' + Math.round(Game.stats.liters) + ' л</b><br>' +
    '🚨 Украдено: <b>' + Math.round(Game.stats.stolenLiters) + ' л</b><br>' +
    '💰 Заработано: <b>' + fmtRub(Game.stats.earned) + '</b><br>' +
    '💳 Баланс: <b>' + fmtRub(Game.money) + '</b>';

  if (Game.mode === 'endless' && !win) {
    statsHtml += '<br>🏆 Лучший результат: <b>' + getEndlessBest() + '</b>';
    if (endlessNewRecord) statsHtml += '<br><b>Новый рекорд!</b>';
  }

  UI.endStats.innerHTML = statsHtml;
  if (UI.endStatsExt) {
    UI.endStatsExt.innerHTML = formatExtendedStatsHtml();
    UI.endStatsExt.classList.add('hidden');
  }
  if (UI.btnEndStats) {
    UI.btnEndStats.textContent = '📊 Подробная статистика';
    UI.btnEndStats.classList.remove('hidden');
  }

  if (win && defeatReason !== 'bankruptcy') {
    if (Game.mode === 'campaign' && Game.levelIdx < CAMPAIGN_LEVEL_COUNT) {
      setUnlocked(Math.max(getUnlocked(), Game.levelIdx + 1));
      UI.btnNext.textContent = 'Уровень ' + (Game.levelIdx + 1);
      UI.btnNext.classList.remove('hidden');
    } else if (campaignFinal) {
      UI.btnNext.textContent = '∞ Бесконечный режим';
      UI.btnNext.classList.remove('hidden');
    } else {
      UI.btnNext.classList.add('hidden');
    }
  } else {
    UI.btnNext.classList.add('hidden');
  }
  UI.screenEnd.classList.remove('hidden');
}

export {
  updateDefeatTimer, endGame, checkFuelCrisis, checkLevelComplete,
  hasWaitingClients, isFuelExhausted, isTankerCreditBlocked, isFuelCrisisCondition,
  countVehiclesOnMap
};
