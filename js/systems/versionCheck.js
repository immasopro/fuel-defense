import { GameVersion } from '../config/gameVersion.js';

/** Встроенная версия клиента — синхронизировать с version.json при деплое */
export const GAME_VERSION = GameVersion.version;

let remoteInfo = null;
let checkTimer = 0;

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export function isNewerVersion(remoteVersion) {
  if (!remoteVersion) return false;
  return compareVersions(remoteVersion, GAME_VERSION) > 0;
}

export async function fetchRemoteVersion() {
  try {
    const url = 'version.json?_=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.version) return null;
    return data;
  } catch {
    return null;
  }
}

export async function checkForUpdate() {
  const data = await fetchRemoteVersion();
  if (data) remoteInfo = data;
  return remoteInfo;
}

export function getRemoteVersionInfo() {
  return remoteInfo;
}

export function hasPendingUpdate() {
  return remoteInfo && isNewerVersion(remoteInfo.version);
}

export function tickVersionCheck(dt) {
  checkTimer += dt;
  if (checkTimer < 60) return;
  checkTimer = 0;
  checkForUpdate();
}

export function resetVersionCheckTimer() {
  checkTimer = 0;
}

export function _setRemoteVersionForTest(info) {
  remoteInfo = info;
}
