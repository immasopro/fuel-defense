import { CONFIG } from '../config/index.js';
import { compareVersions } from './versionCheck.js';

/** Старая шкала нефтебазы (≤0.2.x): вместимости по уровню */
const LEGACY_DEPOT_CAPS = [1500, 3500, 7000];

/** Ближайший уровень новой шкалы по вместимости */
export function migrateDepotLevel(legacyLevel, legacyCap) {
  const cap = legacyCap != null
    ? legacyCap
    : LEGACY_DEPOT_CAPS[Math.max(0, (legacyLevel || 1) - 1)];
  const levels = CONFIG.depot.levels;
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 0; i < levels.length; i++) {
    const d = Math.abs(levels[i] - cap);
    if (d < bestDiff) {
      bestDiff = d;
      best = i + 1;
    }
  }
  return best;
}

/** Миграция объекта сохранения ≤0.2.x → 0.3.0 */
export function migrateSaveObject(save) {
  if (!save || typeof save !== 'object') return save;
  const ver = save.version || '0.2.0';
  if (compareVersions(ver, '0.3.0') >= 0) return save;

  const depotLevel = migrateDepotLevel(save.depot?.level, save.depot?.cap);
  const newCap = CONFIG.depot.levels[depotLevel - 1];
  const res = Math.min(save.depot?.res ?? newCap, newCap);

  return {
    ...save,
    version: '0.3.0',
    depot: { level: depotLevel, res, cap: newCap },
    tankerTruck: { level: 1 },
    fleet: { level: 1 },
    tanker: undefined
  };
}

/** Применить миграцию к полям Game (если загружено старое сохранение) */
export function applyLegacyGameMigration(saveVersion) {
  if (!saveVersion || compareVersions(saveVersion, '0.3.0') >= 0) return false;
  return true;
}
