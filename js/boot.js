import { Road } from './world/roadNetwork.js';
import { Depot, GBRBase } from './world/map.js';
import { Game } from './core/gameState.js';
import { clamp } from './core/utils.js';
import { UI, bindTap, bindLongTap, resize, updateHUD, renderMenu, showMenu, markVersionSeen } from './ui/hud.js';
import { handleTap, handlePanelAction, openGbrBasePanel } from './ui/stationPanel.js';
import { closePanel } from './ui/stationPanel.js';
import { newGame, restartCurrentLevel } from './game.js';
import { CONFIG } from './config/index.js';
import { callGBR } from './systems/spawnSystem.js';
import { toggleSpeedBoost } from './systems/speedBoost.js';
import { toggleTrafficLight } from './systems/trafficSystem.js';
import { toggleDebugOverlay } from './debug/debugOverlay.js';
import { initManualUi } from './ui/manual.js';
import { initGameMenuUi } from './ui/gameMenu.js';
import { initTankerOrderUi, openTankerOrderMenu } from './ui/tankerOrderMenu.js';
import { initUpgradePaymentUi } from './ui/upgradePaymentMenu.js';
import { initBonusAccountUi } from './ui/bonusAccountMenu.js';
import { checkForUpdate, isNewerVersion } from './systems/versionCheck.js';
import { showVersionNotification } from './ui/versionNotification.js';
import { isEndlessUnlocked } from './systems/campaignSave.js';
import { CAMPAIGN_LEVEL_COUNT } from './config/levels.js';
import {
  clearRunEconomy, consumeResumePending, markResumePending, tryRestoreRunEconomy, saveRunEconomy
} from './systems/runEconomySave.js';
let eventsBound = false;

function isNativeApp() {
  try {
    const C = globalThis.Capacitor;
    return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  } catch {
    return false;
  }
}

/** Нативный immersive fullscreen + скрытие браузерной кнопки ⛶ в APK. */
async function applyNativeFullscreen() {
  if (!isNativeApp()) return;
  document.documentElement.classList.add('fd-native');
  const btnFs = document.getElementById('btn-fs');
  if (btnFs) btnFs.classList.add('hidden');
  try {
    const StatusBar = globalThis.Capacitor?.Plugins?.StatusBar;
    if (StatusBar) {
      if (StatusBar.setOverlaysWebView) await StatusBar.setOverlaysWebView({ overlay: true });
      if (StatusBar.hide) await StatusBar.hide();
    }
  } catch {
    /* native MainActivity already enforces immersive mode */
  }
}

function destroy() {
  closePanel();
  if (UI.screenEnd) UI.screenEnd.classList.add('hidden');
  if (UI.warning) UI.warning.classList.add('hidden');
}

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  bindTap(UI.panel, e => {
    const b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (b && !b.disabled) handlePanelAction(b.dataset);
  });
  bindTap(UI.btnTanker, () => openTankerOrderMenu());
  bindLongTap(UI.btnGbr, () => callGBR(), () => openGbrBasePanel());
  if (UI.btnSpeed) bindTap(UI.btnSpeed, () => toggleSpeedBoost());
  bindTap(UI.btnLight, () => toggleTrafficLight());
  bindTap(UI.levelRow, e => {
    const b = e.target.closest ? e.target.closest('[data-lvl]') : null;
    if (b && !b.disabled) {
      markVersionSeen();
      UI.screenStart.classList.add('hidden');
      Boot.startLevel('campaign', +b.dataset.lvl);
    }
  });
  bindTap(document.getElementById('btn-endless'), () => {
    if (!isEndlessUnlocked()) return;
    markVersionSeen();
    UI.screenStart.classList.add('hidden');
    Boot.startLevel('endless');
  });
  bindTap(document.getElementById('btn-restart'), () => Boot.restart());
  bindTap(UI.btnNext, () => {
    UI.screenEnd.classList.add('hidden');
    if (Game.mode === 'campaign' && Game.levelIdx === CAMPAIGN_LEVEL_COUNT) {
      if (isEndlessUnlocked()) Boot.startLevel('endless');
    } else if (Game.mode === 'campaign') {
      Boot.startLevel('campaign', Game.levelIdx + 1);
    }
  });
  bindTap(document.getElementById('btn-menu'), () => showMenu());
  const btnFs = document.getElementById('btn-fs');
  if (btnFs && !isNativeApp()) {
    bindTap(btnFs, () => {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen();
      else if (document.exitFullscreen) document.exitFullscreen();
    });
  }
  bindTap(document.getElementById('btn-debug'), () => {
    const on = toggleDebugOverlay();
    const btn = document.getElementById('btn-debug');
    if (btn) {
      btn.classList.toggle('active', on);
      btn.textContent = on ? 'DBG ✓' : 'DBG';
    }
  });
  initManualUi(bindTap);
  initGameMenuUi(bindTap);
  initTankerOrderUi();
  initUpgradePaymentUi();
  initBonusAccountUi(bindTap);
  window.addEventListener('pagehide', () => markResumePending());
  window.addEventListener('beforeunload', () => markResumePending());
}

function initDom() {
  UI.stage = document.getElementById('stage');
  UI.cv = document.getElementById('cv');
  UI.ctx = UI.cv.getContext('2d');
  UI.panel = document.getElementById('panel');
  UI.warning = document.getElementById('warning');
  UI.statMoney = document.getElementById('stat-money');
  UI.statBonuses = document.getElementById('stat-bonuses');
  UI.statTraffic = document.getElementById('stat-traffic');
  UI.statTime = document.getElementById('stat-time');
  UI.btnTanker = document.getElementById('btn-tanker');
  UI.btnGbr = document.getElementById('btn-gbr');
  UI.btnSpeed = document.getElementById('btn-speed');
  UI.btnLight = document.getElementById('btn-light');
  UI.tankerSub = UI.btnTanker.querySelector('.sub');
  UI.gbrTitle = UI.btnGbr.querySelector('.t');
  UI.gbrSub = UI.btnGbr.querySelector('.sub');
  UI.lightSub = document.getElementById('light-sub');
  UI.screenStart = document.getElementById('screen-start');
  UI.screenEnd = document.getElementById('screen-end');
  UI.endTitle = document.getElementById('end-title');
  UI.endDesc = document.getElementById('end-desc');
  UI.endStats = document.getElementById('end-stats');
  UI.btnNext = document.getElementById('btn-next');
  UI.btnRestart = document.getElementById('btn-restart');
  UI.btnMenu = document.getElementById('btn-menu');
  UI.levelRow = document.getElementById('level-row');
  UI.panelRef = null;

  UI.LW = 420;
  const rect = UI.stage.getBoundingClientRect();
  UI.LH = clamp(Math.round(UI.LW * (rect.height / Math.max(1, rect.width))), 560, 940);
  Road.build(UI.LW, UI.LH);
  Depot.init();
  GBRBase.init();
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 150));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize);
    window.visualViewport.addEventListener('scroll', resize);
  }
  // Android: пересчёт после первого layout / смены density
  requestAnimationFrame(() => resize());
  setTimeout(resize, 300);

  let tStart = null;
  UI.cv.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    tStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  UI.cv.addEventListener('touchend', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (tStart && Math.hypot(t.clientX - tStart.x, t.clientY - tStart.y) < 12)
      handleTap(t.clientX, t.clientY);
    tStart = null;
  }, { passive: false });
  UI.cv.addEventListener('click', e => handleTap(e.clientX, e.clientY));
}

export const Boot = {
  start(startFrame) {
    initDom();
    applyNativeFullscreen();
    bindEvents();
    renderMenu();
    updateHUD();
    checkForUpdate().then(info => {
      if (info && isNewerVersion(info.version)) showVersionNotification(info.version);
    });
    // После reload/закрытия APK — восстановить money/bonuses того же уровня
    const resume = consumeResumePending();
    if (resume && (resume.mode === 'campaign' || resume.mode === 'endless')) {
      markVersionSeen();
      if (UI.screenStart) UI.screenStart.classList.add('hidden');
      Boot.startLevel(resume.mode, resume.levelIdx, { resumeEconomy: true });
    }
    startFrame(0);
  },

  startLevel(mode, levelIdx, opts) {
    destroy();
    if (!opts?.resumeEconomy) clearRunEconomy();
    newGame(mode, levelIdx);
    if (opts?.resumeEconomy) tryRestoreRunEconomy();
    saveRunEconomy();
    updateHUD();
  },

  restart() {
    clearRunEconomy();
    restartCurrentLevel();
  },

  destroy() {
    destroy();
  }
};

/** @deprecated use Boot.start */
export function boot(startFrame) {
  Boot.start(startFrame);
}
