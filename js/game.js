import { CONFIG } from './config/index.js';
import { SPAWN_START_INTERVAL } from './config/levels.js';
import { Game } from './core/gameState.js';
import { Road } from './world/roadNetwork.js';
import { updateLane } from './vehicles/vehicle.js';
import { innerLaneList, outerLaneList, releaseHolderBurst } from './systems/trafficSystem.js';
import { currentDiff, tickSpawnPipeline, getTargetCars, scalperCooldown } from './systems/spawnSystem.js';
import { updateDefeatTimer, endGame, checkFuelCrisis } from './systems/defeatSystem.js';
import { addFloat } from './systems/economySystem.js';
import { distributeDepotFuel } from './stations/reservoir.js';
import { tickSpecialSpawns, updateVehicles, postStationMaintenance } from './systems/stationSystem.js';
import { initLogistics, tickTankerLogistics } from './systems/tankerLogistics.js';
import { initGbrLogistics, tickGbrLogistics } from './systems/gbrLogistics.js';
import { initScalperEvolution } from './systems/scalperEvolution.js';
import { resetPursuitState, tickGbrPursuit } from './systems/gbrPursuit.js';
import { resetScalperLifecycleState } from './systems/scalperLifecycle.js';
import { tickVersionCheck } from './systems/versionCheck.js';
import { updateHUD } from './ui/hud.js';
import { updatePanelLive, closePanel } from './ui/stationPanel.js';
import { UI } from './ui/hud.js';
import { clearRunEconomy, saveRunEconomy } from './systems/runEconomySave.js';

export function newGame(mode, levelIdx) {
  Game.mode = mode;
  Game.levelIdx = mode === 'campaign' ? (levelIdx || 1) : 0;
  Game.modeCfg = mode === 'endless' ? CONFIG.endless : CONFIG.levels[Game.levelIdx - 1];
  Game.state = 'play';
  Game.money = Game.modeCfg.startMoney;
  Game.bonuses = 0;
  Game.time = 0;
  Game.depot = { level: 1, res: CONFIG.depot.levels[0], cap: CONFIG.depot.levels[0] };
  Game.vehicles = [];
  Game.holder = [];
  Game.holderPriorityWait = null;
  Game.prepared = null;
  Game.floats = [];
  Game.spawnTimer = SPAWN_START_INTERVAL;
  Game.defeatT = 0;
  Game.light = { phase: 'green', redT: 0, cd: 0 };
  Game.scalperTimer = scalperCooldown();
  Game.tanker = { unit: null };
  Game.tankerTruck = { level: 1 };
  Game.fleet = { level: 1 };
  initLogistics();
  Game.gbrBase = { level: 1 };
  initGbrLogistics();
  initScalperEvolution();
  Game.gbr = { unit: null };
  resetPursuitState();
  resetScalperLifecycleState();
  Game.scalper = { unit: null };
  Game.stats = { served: 0, spawned: 0, earned: 0, liters: 0, stolenLiters: 0, stolenDamage: 0 };
  Game.tankLabels = {};
  Game.depotLabel = 0;
  Game.bgSpawnTimer = 0;
  Game.paused = false;
  Game.menuOpen = false;
  Game.menuReturnAfterManual = false;
  Game.defeatReason = null;
  for (const slot of Road.slots) slot.station = null;
  closePanel();
  UI.warning.classList.add('hidden');
}

/** Полный перезапуск текущего уровня — тот же режим и номер уровня. */
export function restartCurrentLevel() {
  const mode = Game.mode;
  const levelIdx = Game.levelIdx;
  closePanel();
  if (UI.screenEnd) UI.screenEnd.classList.add('hidden');
  if (UI.warning) UI.warning.classList.add('hidden');
  clearRunEconomy();
  newGame(mode, levelIdx);
  saveRunEconomy();
  updateHUD();
}

function updateTrafficLight(dt) {
  if (Game.light.redT > 0) {
    Game.light.redT -= dt;
    Game.defeatT = 0;
    if (Game.light.redT <= 0) {
      Game.light.redT = 0;
      Game.light.phase = 'green';
      Game.light.cd = CONFIG.trafficLight.cooldown;
      addFloat(Road.posAt(Road.spawnS, 0).x, Road.posAt(Road.spawnS, 0).y - 22, '🟢 ПУСК', '#8bc34a');
    }
  } else if (Game.light.cd > 0) {
    Game.light.cd -= dt;
  }
}

function updateTimersAndWarning(dt) {
  for (const k in Game.tankLabels) {
    Game.tankLabels[k] -= dt;
    if (Game.tankLabels[k] <= 0) delete Game.tankLabels[k];
  }
  if (Game.depotLabel > 0) Game.depotLabel -= dt;
  for (const f of Game.floats) f.t += dt;
  Game.floats = Game.floats.filter(f => f.t < f.life);
  if (Game.defeatT > 0.15) {
    UI.warning.textContent =
      '⚠️ НАКОПИТЕЛЬ ПОЛОН! ' + Math.max(0, CONFIG.defeatTime - Game.defeatT).toFixed(1) + 'с';
    UI.warning.classList.remove('hidden');
  } else {
    UI.warning.classList.add('hidden');
  }
}

export function update(dt) {
  if (Game.state === 'play') tickVersionCheck(dt);
  if (Game.state !== 'play' || Game.paused) { updateHUD(); return; }
  Game.time += dt;
  const diff = currentDiff();
  const L = Road.length;

  const inner = innerLaneList();
  const outer = outerLaneList();
  updateLane(inner, dt);
  updateLane(outer, dt);

  updateTrafficLight(dt);
  tickSpawnPipeline(dt, diff);
  releaseHolderBurst();
  tickSpecialSpawns(dt, diff);
  updateDefeatTimer(dt);
  if (Game.state !== 'play') return;

  distributeDepotFuel(dt);
  tickTankerLogistics(dt);
  tickGbrLogistics(dt);
  tickGbrPursuit();
  updateVehicles(dt, L);
  if (Game.state !== 'play') return;
  if (checkFuelCrisis()) return;
  if (Game.mode === 'campaign') {
    const target = getTargetCars();
    if (target != null && Game.stats.served >= target) {
      if (Game.money < 0) endGame(false, 'bankruptcy');
      else endGame(true);
      return;
    }
  }
  postStationMaintenance(dt);
  updateTimersAndWarning(dt);

  updateHUD();
  updatePanelLive();
}
