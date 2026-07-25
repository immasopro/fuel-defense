import { CONFIG } from '../config/index.js';
import { CANVAS } from '../config/constants.js';
import { Game } from '../core/gameState.js';
import { fmtTime, clamp } from '../core/utils.js';
import { fmtRub } from '../core/currency.js';
import { GameVersion } from '../config/gameVersion.js';
import { innerLaneList, isLightGreen } from '../systems/trafficSystem.js';
import { getServedHudText } from '../systems/spawnSystem.js';
import { canDispatchTanker, tankerButtonSub } from '../systems/tankerLogistics.js';
import { gbrButtonSub, gbrCallCost, canDispatchGbr } from '../systems/gbrLogistics.js';
import { refreshTankerOrderQuote, isTankerOrderOpen } from './tankerOrderMenu.js';
import { ensureBonusBalance } from '../systems/fuelOrderSystem.js';
import {
  getUnlocked, setUnlocked, migrateCampaignSave, isEndlessUnlocked, getEndlessBest
} from '../systems/campaignSave.js';
import { clearRunEconomy } from '../systems/runEconomySave.js';

export const UI = {};

const PATCH_SEEN_KEY = 'fd_seen_version';

function bindTap(el, fn) {
  // touchend + preventDefault: без 300мс-задержки и без "призрачного" click
  el.addEventListener('touchend', e => { e.preventDefault(); fn(e); }, { passive: false });
  el.addEventListener('click', e => fn(e));
}

/** Короткое нажатие — onShort, удержание ≥450 мс — onLong */
function bindLongTap(el, onShort, onLong, holdMs = 450) {
  let t0 = 0;
  let longDone = false;
  let skipClick = false;
  el.addEventListener('touchstart', () => {
    t0 = Date.now();
    longDone = false;
    skipClick = false;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    e.preventDefault();
    const dt = Date.now() - t0;
    if (dt >= holdMs) {
      longDone = true;
      skipClick = true;
      onLong(e);
    } else if (!longDone) {
      onShort(e);
      skipClick = true;
    }
  }, { passive: false });
  el.addEventListener('click', e => {
    if (skipClick) {
      skipClick = false;
      return;
    }
    onShort(e);
  });
}

function getUnlockedLevel() {
  return getUnlocked();
}
function setUnlockedLevel(n) {
  setUnlocked(n);
}

/** Автоподстройка под DPI / размер экрана: canvas DPR + CSS --ui-scale для HUD. */
function resize() {
  const vv = window.visualViewport;
  const rect = UI.stage.getBoundingClientRect();
  // visualViewport точнее на Android WebView при системном масштабе / cutout
  UI.cssW = Math.max(1, vv ? Math.min(rect.width, vv.width) : rect.width);
  UI.cssH = Math.max(1, vv ? Math.min(rect.height, vv.height) : rect.height);

  const rawDpr = (vv && vv.scale > 0)
    ? (window.devicePixelRatio || 1) * vv.scale
    : (window.devicePixelRatio || 1);
  UI.dpr = Math.min(Math.max(rawDpr, 1), CANVAS.maxDevicePixelRatio);

  UI.cv.width = Math.max(1, Math.round(UI.cssW * UI.dpr));
  UI.cv.height = Math.max(1, Math.round(UI.cssH * UI.dpr));
  UI.scale = Math.min(UI.cssW / UI.LW, UI.cssH / UI.LH);
  UI.ox = (UI.cssW - UI.LW * UI.scale) / 2;
  UI.oy = (UI.cssH - UI.LH * UI.scale) / 2;

  // UI density: mdpi≈1 при ширине designWidth; clamp чтобы HUD не ломался на 2K/ldpi
  const uiScale = clamp(UI.cssW / CANVAS.designWidth, 0.82, 1.4);
  const root = document.documentElement;
  if (root?.style?.setProperty) {
    root.style.setProperty('--ui-scale', uiScale.toFixed(3));
    root.style.setProperty('--dpr', String(UI.dpr));
  }
  if (root && root.dataset) {
    root.dataset.density = UI.dpr >= 2.5 ? 'xxxhdpi'
      : UI.dpr >= 2 ? 'xxhdpi'
        : UI.dpr >= 1.5 ? 'xhdpi'
          : UI.dpr >= 1.0 ? 'hdpi' : 'mdpi';
  }
}

function fmtBonuses(n) {
  return Math.round(n || 0).toLocaleString('ru-RU');
}

function updateHUD() {
  ensureBonusBalance();
  UI.statMoney.textContent = '💰 ' + fmtRub(Game.money);
  if (UI.statBonuses) {
    UI.statBonuses.textContent = '★ БОНУСЫ: ' + fmtBonuses(Game.bonuses);
  }
  if (Game.state === 'play') {
    UI.statTime.textContent = '⛽ ' + getServedHudText();
  } else {
    UI.statTime.textContent = '⏱ —';
  }

  const inner = innerLaneList();
  const stopped = inner.filter(v => v.v < 8).length;
  const holdN = Game.holder.length;
  let txt, col;
  if (Game.defeatT > 0.5) { txt = 'КРИТИЧНО'; col = '#ef5350'; }
  else if (holdN >= CONFIG.holder.max) { txt = 'Накопитель полон'; col = '#ef5350'; }
  else if (stopped >= 6) { txt = 'ПРОБКА'; col = '#ef5350'; }
  else if (stopped >= 3) { txt = 'Плотно'; col = '#ffb300'; }
  else { txt = 'Свободно'; col = '#8bc34a'; }
  UI.statTraffic.textContent = '🚗 ' + inner.length + '+' + holdN + ' · ' + txt;
  UI.statTraffic.style.color = col;

  // бензовоз — Готов / Подготовка; красный если доступен
  UI.tankerSub.textContent = tankerButtonSub();
  const tankerReady = canDispatchTanker() && Game.state === 'play';
  UI.btnTanker.disabled = !tankerReady;
  if (tankerReady) UI.btnTanker.classList.add('tanker-ready');
  else UI.btnTanker.classList.remove('tanker-ready');

  // ГБР — стоимость, READY или таймер подготовки
  UI.gbrSub.textContent = gbrButtonSub(fmtRub);
  const nextGbrCost = gbrCallCost();
  if (Game.state !== 'play') {
    UI.btnGbr.disabled = true;
  } else if (canDispatchGbr() && Game.money < nextGbrCost) {
    UI.btnGbr.disabled = true;
  } else {
    UI.btnGbr.disabled = false;
  }

  const Lt = Game.light;
  if (!isLightGreen()) {
    UI.btnLight.disabled = true;
    UI.btnLight.classList.add('red-mode');
    UI.lightSub.textContent = Lt.redT > 0 ? '🔴 ' + Math.ceil(Lt.redT) + 'с' : '—';
  } else if (Lt.cd > 0) {
    UI.btnLight.disabled = true;
    UI.btnLight.classList.remove('red-mode');
    UI.lightSub.textContent = '⏳ ' + Math.ceil(Lt.cd) + 'с';
  } else {
    UI.btnLight.disabled = Game.state !== 'play';
    UI.btnLight.classList.remove('red-mode');
    UI.lightSub.textContent = 'стоп 10с';
  }

  if (isTankerOrderOpen()) refreshTankerOrderQuote();
}

function renderMenu() {
  migrateCampaignSave();
  const unlocked = getUnlockedLevel();
  let html = '';
  for (let i = 1; i <= CONFIG.levels.length; i++) {
    const locked = i > unlocked;
    html += '<button class="lvl-btn" data-lvl="' + i + '"' + (locked ? ' disabled' : '') + '>' +
      (locked ? '🔒' : i) + '</button>';
  }
  UI.levelRow.innerHTML = html;
  const endlessSection = document.getElementById('endless-section');
  const endlessBtn = document.getElementById('btn-endless');
  const endlessRecord = document.getElementById('endless-record');
  if (endlessSection && endlessBtn) {
    if (isEndlessUnlocked()) {
      endlessSection.classList.remove('hidden');
      endlessBtn.disabled = false;
      const best = getEndlessBest();
      endlessBtn.textContent = '∞ Бесконечный режим';
      if (endlessRecord) {
        endlessRecord.textContent = best > 0 ? 'Рекорд: ' + best + ' машин' : '';
      }
    } else {
      endlessSection.classList.add('hidden');
      endlessBtn.disabled = true;
      if (endlessRecord) endlessRecord.textContent = '';
    }
  }
  renderPatchNotes();
}

function getSeenVersion() {
  try { return localStorage.getItem(PATCH_SEEN_KEY) || ''; } catch (e) { return ''; }
}

function markVersionSeen() {
  try { localStorage.setItem(PATCH_SEEN_KEY, GameVersion.version); } catch (e) { }
  renderPatchNotes();
}

function renderPatchNotes() {
  const verEl = document.getElementById('game-version');
  const notesEl = document.getElementById('patch-notes');
  const buildEl = document.getElementById('build-footer');
  if (!verEl || !notesEl) return;

  verEl.textContent = 'Версия ' + GameVersion.version;
  const seen = getSeenVersion() === GameVersion.version;
  const collapsed = seen || notesEl.classList.contains('collapsed');

  const items = GameVersion.changes.slice(0, 8);
  let html = '<div class="patch-head">' +
    '<span class="patch-title">Что нового</span>' +
    '<button type="button" class="patch-toggle" id="patch-toggle" aria-expanded="' + (!collapsed) + '">' +
    (collapsed ? '▸' : '▾') + '</button></div>';
  if (!collapsed) {
    html += '<ul class="patch-list">';
    for (const line of items) html += '<li>' + line + '</li>';
    html += '<li class="patch-arch">Полный список изменений — ' + GameVersion.architectureDoc + '</li>';
    html += '</ul>';
  }
  notesEl.innerHTML = html;
  if (collapsed) notesEl.classList.add('collapsed');
  else notesEl.classList.remove('collapsed');
  if (seen) notesEl.classList.add('seen');
  else notesEl.classList.remove('seen');

  const toggle = document.getElementById('patch-toggle');
  if (toggle) {
    toggle.onclick = e => {
      e.stopPropagation();
      const isCollapsed = notesEl.classList.contains('collapsed');
      if (isCollapsed) notesEl.classList.remove('collapsed');
      else notesEl.classList.add('collapsed');
      toggle.textContent = isCollapsed ? '▸' : '▾';
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      if (!isCollapsed) {
        const list = notesEl.querySelector('.patch-list');
        if (!list) {
          let listHtml = '<ul class="patch-list">';
          for (const line of items) listHtml += '<li>' + line + '</li>';
          listHtml += '<li class="patch-arch">Полный список изменений — ' + GameVersion.architectureDoc + '</li>';
          listHtml += '</ul>';
          notesEl.insertAdjacentHTML('beforeend', listHtml);
        }
      }
    };
  }

  if (buildEl) {
    const stamp = GameVersion.buildStamp ? new Date(GameVersion.buildStamp) : new Date();
    const stampStr = isNaN(stamp.getTime())
      ? GameVersion.buildStamp
      : stamp.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
    buildEl.textContent = 'Build: ' + GameVersion.version + '\n' + stampStr;
  }
}

function showMenu() {
  Game.state = 'menu';
  clearRunEconomy();
  renderMenu();
  UI.screenEnd.classList.add('hidden');
  UI.screenStart.classList.remove('hidden');
}

export { bindTap, bindLongTap, getUnlockedLevel as getUnlocked, setUnlockedLevel as setUnlocked,
  resize, updateHUD, renderMenu, showMenu, markVersionSeen, renderPatchNotes };
