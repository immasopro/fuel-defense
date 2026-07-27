import { CONFIG } from './config/index.js';
import { Game } from './core/gameState.js';
import { Road } from './world/roadNetwork.js';
import { Depot, GBRBase, sortedStationSlots } from './world/map.js';
import { Station } from './stations/station.js';
import { Pump } from './stations/pump.js';
import { FrameTimer } from './core/timer.js';
import { update, newGame } from './game.js';
import { draw } from './ui/renderer.js';
import { boot, Boot } from './boot.js';
import { callTanker, callGBR } from './systems/spawnSystem.js';
import { tickSpeedBoost, addSpeedBoostTime, toggleSpeedBoost } from './systems/speedBoost.js';
import { endGame } from './systems/defeatSystem.js';
import { makeCar, makeBgCar, makeScalper, makeTanker, pickClientType, pickClientFuel } from './vehicles/vehicleFactory.js';
import { finishFuel } from './systems/economySystem.js';
import { scanForStation, wakePumpQueue, tryApproachPullIn, tryApproachPocket,
  beginPullIn, beginPocketPullIn, cleanupVehicle, processStationPocket, promotePocket } from './stations/stationQueue.js';
import {
  apronPoseForRank, approachStopS, pocketEntryS, decelStopS, pocketPoseForRank,
  holderPose, distAhead, distNearStop, tankerTechStopS, tankerCommitS, tankerDecisionS, tankerTechPose
} from './world/roadNetwork.js';
import { buildTankerManifest, legDecision } from './systems/tankerSystem.js';
import {
  toggleTrafficLight, isLightGreen, entryToRingBlocked,
  addToHolder, deployToRing, releaseHolderBurst
} from './systems/trafficSystem.js';
import {
  actionBuildStation, actionUpgradeReservoir, actionUpgradePump, actionUnlockFuel,
  actionAddPump, actionBuyCanisterReserve, actionUpgradeDepot,
  resUpgradeCost, pumpUpgradeCost, fuelUnlockCost, addPumpCost
} from './systems/upgradeSystem.js';
import { forceTankerReadyForTests } from './systems/tankerLogistics.js';
import { forceGbrReadyForTests } from './systems/gbrLogistics.js';
import { handlePanelAction } from './ui/stationPanel.js';
import { openManual, closeManual, isManualOpen } from './ui/manual.js';

export const FD = {
  Game, Road, Depot, GBRBase, CONFIG, update, newGame, callTanker, callGBR, handlePanelAction, Boot,
  Station, Pump, makeCar, makeBgCar, makeScalper, makeTanker, endGame, scanForStation,
  actionBuildStation, actionUpgradeReservoir, actionUpgradePump, actionUnlockFuel,
  actionAddPump, actionBuyCanisterReserve, actionUpgradeDepot,
  resUpgradeCost, pumpUpgradeCost, fuelUnlockCost, addPumpCost, sortedStationSlots,
  forceTankerReadyForTests, forceGbrReadyForTests,
  addSpeedBoostTime, toggleSpeedBoost,
  wakePumpQueue, tryApproachPullIn, tryApproachPocket, apronPoseForRank, approachStopS,
  pocketEntryS, decelStopS, pocketPoseForRank, holderPose, promotePocket,
  distAhead, distNearStop, tankerTechStopS, tankerCommitS, tankerDecisionS, tankerTechPose,
  buildTankerManifest, legDecision,
  finishFuel, beginPullIn, beginPocketPullIn, distAhead, toggleTrafficLight,
  isLightGreen, entryToRingBlocked, pickClientType, pickClientFuel,
  addToHolder, deployToRing, releaseHolderBurst, cleanupVehicle, processStationPocket,
  openManual, closeManual, isManualOpen
};

if (typeof window !== 'undefined') window.FD = FD;

const timer = new FrameTimer();
function frame(ts) {
  const realDt = timer.step(ts);
  // Лимит 2x считается по реальному времени; симуляция — через timeScale.
  if (Game.state === 'play' && !Game.paused) {
    tickSpeedBoost(realDt);
  }
  const scale = Game.timeScale || 1;
  update(realDt * scale);
  draw();
  requestAnimationFrame(frame);
}

if (!globalThis.__FD_HEADLESS__) {
  boot(frame);
}
