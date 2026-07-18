import { Game } from '../core/gameState.js';
import { closePanel } from './stationPanel.js';
import { openManual, closeManual, isManualOpen } from './manual.js';
import { showMenu } from './hud.js';
import { hasPendingUpdate, getRemoteVersionInfo } from '../systems/versionCheck.js';
import { restartCurrentLevel } from '../game.js';

let bound = false;

export function isGameMenuOpen() {
  const el = document.getElementById('game-menu');
  return !!Game.menuOpen && el && !el.classList.contains('hidden');
}

function menuEl() {
  return document.getElementById('game-menu');
}

function updateBlockEl() {
  return document.getElementById('menu-update');
}

function menuButtonsEl() {
  return document.getElementById('menu-main-buttons');
}

function restartConfirmEl() {
  return document.getElementById('menu-restart-confirm');
}

function renderUpdateBlock() {
  const block = updateBlockEl();
  if (!block) return;
  if (!hasPendingUpdate()) {
    block.classList.add('hidden');
    block.innerHTML = '';
    return;
  }
  const info = getRemoteVersionInfo();
  const notes = (info.notes || []).slice(0, 5);
  let html = '<hr class="menu-hr"><p class="menu-update-title">Доступна новая версия</p>';
  html += '<p class="menu-update-ver">' + info.version + '</p>';
  if (notes.length) {
    html += '<p class="menu-update-label">Исправлено:</p><ul class="menu-update-notes">';
    for (const n of notes) html += '<li>' + n + '</li>';
    html += '</ul>';
  }
  html += '<button type="button" class="menu-btn menu-btn-update" id="menu-btn-reload">Обновить</button>';
  block.innerHTML = html;
  block.classList.remove('hidden');
  const btn = document.getElementById('menu-btn-reload');
  if (btn) btn.onclick = () => { location.reload(); };
}

export function openGameMenu() {
  if (Game.state !== 'play') return;
  buildGameMenuOnce();
  hideRestartConfirm();
  closePanel();
  Game.paused = true;
  Game.menuOpen = true;
  Game.menuReturnAfterManual = false;
  const el = menuEl();
  if (el) el.classList.remove('hidden');
  renderUpdateBlock();
}

export function closeGameMenu() {
  hideRestartConfirm();
  Game.menuOpen = false;
  Game.menuReturnAfterManual = false;
  Game.paused = false;
  const el = menuEl();
  if (el) el.classList.add('hidden');
}

export function resumeFromMenuAfterManual() {
  Game.paused = true;
  Game.menuOpen = true;
  hideRestartConfirm();
  const el = menuEl();
  if (el) el.classList.remove('hidden');
  renderUpdateBlock();
}

function confirmAbort() {
  return typeof window !== 'undefined' &&
    window.confirm('Прервать текущую игру?');
}

function goMainMenu() {
  if (!confirmAbort()) return;
  closeGameMenu();
  closeManual();
  showMenu();
}

function openManualFromMenu() {
  Game.menuReturnAfterManual = true;
  const el = menuEl();
  if (el) el.classList.add('hidden');
  openManual({ fromMenu: true });
}

export function showRestartConfirm() {
  const confirm = restartConfirmEl();
  const buttons = menuButtonsEl();
  if (confirm) confirm.classList.remove('hidden');
  if (buttons) buttons.classList.add('menu-menu-buttons-hidden');
}

export function hideRestartConfirm() {
  const confirm = restartConfirmEl();
  const buttons = menuButtonsEl();
  if (confirm) confirm.classList.add('hidden');
  if (buttons) buttons.classList.remove('menu-menu-buttons-hidden');
}

/** Подтверждённый рестарт текущего уровня — полный сброс без выхода в главное меню. */
export function confirmRestartLevel() {
  hideRestartConfirm();
  closeGameMenu();
  closeManual();
  restartCurrentLevel();
}

export function requestRestartLevel() {
  if (Game.state !== 'play' || !Game.menuOpen) return;
  showRestartConfirm();
}

function buildGameMenuOnce() {
  if (bound) return;
  bound = true;
  const cont = document.getElementById('menu-btn-continue');
  const restart = document.getElementById('menu-btn-restart');
  const man = document.getElementById('menu-btn-manual');
  const home = document.getElementById('menu-btn-home');
  const backdrop = document.getElementById('game-menu-backdrop');
  const restartYes = document.getElementById('menu-restart-yes');
  const restartNo = document.getElementById('menu-restart-no');
  if (cont) cont.onclick = () => closeGameMenu();
  if (restart) restart.onclick = () => requestRestartLevel();
  if (man) man.onclick = () => openManualFromMenu();
  if (home) home.onclick = () => goMainMenu();
  if (backdrop) backdrop.onclick = () => closeGameMenu();
  if (restartYes) restartYes.onclick = () => confirmRestartLevel();
  if (restartNo) restartNo.onclick = () => hideRestartConfirm();
}

export function initGameMenuUi(bindTap) {
  buildGameMenuOnce();
  const btn = document.getElementById('btn-menu-hud');
  if (btn && bindTap) bindTap(btn, () => {
    if (isGameMenuOpen()) closeGameMenu();
    else if (!isManualOpen()) openGameMenu();
  });
}
