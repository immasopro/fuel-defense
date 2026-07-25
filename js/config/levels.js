/** Campaign (20 levels) and Endless mode — v0.4.0 */

/** 0,25 авто/сек — один клиент каждые 4 с */
export const SPAWN_START_INTERVAL = 4.0;

/** Первые 80 % уровня — плавный разгон, последние 20 % — максимум */
export const SPAWN_RAMP_FRAC = 0.8;

/** Минимальный интервал спавна (макс. скорость) по тирам кампании */
export const CAMPAIGN_MAX_INTERVAL = {
  /** уровни 1–5: 0,5 авто/с */
  tier1: 2.0,
  /** уровни 6–9: 0,667 авто/с */
  tier2: 1.5,
  /** уровни 10–20: 1 авто/с */
  tier3: 1.0
};

export const ENDLESS_SPAWN = {
  startInterval: 4.0,
  minInterval: 1 / 3,
  rampCars: 10000
};

const TARGETS = [
  100, 130, 170, 220, 280, 360, 460, 600, 770, 1000,
  1500, 1690, 1900, 2150, 2420, 2730, 3080, 3470, 3910, 5000
];

function scalperForLevel(i) {
  const firstAt = Math.max(22, 62 - i * 2);
  const intervalStart = Math.max(12, 46 - i * 2);
  const intervalEnd = Math.max(8, 36 - i * 1.3);
  return { firstAt, intervalStart: Math.round(intervalStart), intervalEnd: Math.round(intervalEnd) };
}

function canisterForLevel(i) {
  const lo = Math.min(0.32, (i - 1) * 0.018);
  const hi = Math.min(0.38, lo + 0.08);
  return [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100];
}

function startMoneyForLevel(i) {
  return 50000;
}

export const levels = TARGETS.map((targetCars, idx) => {
  const i = idx + 1;
  return {
    name: 'Уровень ' + i,
    targetCars,
    startMoney: startMoneyForLevel(i),
    scalper: scalperForLevel(i),
    canister: canisterForLevel(i)
  };
});

export const CAMPAIGN_LEVEL_COUNT = levels.length;

export function campaignMaxSpawnInterval(levelIdx) {
  if (levelIdx <= 5) return CAMPAIGN_MAX_INTERVAL.tier1;
  if (levelIdx <= 9) return CAMPAIGN_MAX_INTERVAL.tier2;
  return CAMPAIGN_MAX_INTERVAL.tier3;
}

export const endless = {
  startMoney: 50000,
  scalper: { firstAt: 25, intervalStart: 16, intervalEnd: 8 },
  canister: [0, .35]
};
