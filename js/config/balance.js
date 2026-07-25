/** Numeric balance parameters — все суммы в рублях (₽) */
export const balance = {
  defeatTime: 10,
  truckUnlockAt: 30,
  giveUpLaps: 2,
  needMin: 0.65,
  needMax: 0.9,
  bgTrafficEnabled: false,

  holder: { max: 5, gap: 20 },
  trafficLight: { redDur: 10, cooldown: 60 },
  overtake: { chance: 0.32 },
  visual: { pocketDur: 0.75, pullInDur: 0.7, pullOutDur: 0.65 },

  road: {
    laneWidth: 15,
    marginX: 46,
    marginTop: 70,
    marginBottom: 56,
    cornerR: 64,
    serviceLat: 30,
    pumpDepth: 14,
    queueGap: 21,
    stationTankLat: 48,
    approachOffset: 12,
    decelLen: 24,
    accelLen: 20,
    pocketLat: 38,
    pocketGap: 18,
    pocketDepth: 70,
    pocketGrabDist: 36,
    pocketForceTime: 1.5,
    apronDepth: 68,
    pullInDist: 14,
    passReleaseDist: 55,
    forcePullInTime: 1.2,
    forcePullInDist: 28,
    tankerDecisionBack: 48,
    tankerCommitBack: 24
  },

  carTypes: {
    sedan: { name: 'Легковая',    len: 19, w: 9,  maxV: 78, accel: 55, brake: 115, tank: 30 },
    suv:   { name: 'Внедорожник', len: 23, w: 10, maxV: 64, accel: 45, brake: 100, tank: 55 },
    truck: { name: 'Фура',        len: 36, w: 11, maxV: 46, accel: 28, brake: 80,  tank: 130 }
  },

  // price — доход ₽/литр
  fuels: {
    a92:    { name: 'АИ-92',  short: '92', color: '#4caf50', price: 90 },
    a95:    { name: 'АИ-95',  short: '95', color: '#42a5f5', price: 113 },
    diesel: { name: 'Дизель', short: 'ДТ', color: '#ff9800', price: 104 }
  },
  canister: { prob: 0.30, red: 10, green: 20 },

  /** Себестоимость закупки топлива, ₽/л (базовая; гибкий заказ — см. fuelOrder) */
  fuelCostPerLiter: 70,

  /** Гибкий заказ бензовоза (v0.4.2+) */
  fuelOrder: {
    percents: [20, 30, 40, 50, 60, 70, 80, 90, 100],
    pricePerLiter: {
      20: 105, 30: 100, 40: 95, 50: 90, 60: 85, 70: 80, 80: 75, 90: 70, 100: 70
    },
    /** Кэшбэк бонусами от стоимости закупки */
    cashbackPct: {
      20: 3, 30: 3, 40: 3, 50: 5, 60: 5, 70: 5, 80: 5, 90: 7, 100: 7
    },
    /** v0.4.2: до 100% стоимости улучшения можно оплатить бонусами */
    bonusShareStation: 1,
    bonusShareDepot: 1
  },

  /**
   * Аварийный обмен бонусов на деньги (v0.4.2.1).
   * Курс 2 бонуса = 1 ₽; только фиксированные пакеты. Магазин — отдельное ТЗ.
   */
  bonusExchange: {
    rate: 2,
    packs: [
      { id: 'small', bonuses: 10000, money: 5000 },
      { id: 'medium', bonuses: 50000, money: 25000 },
      { id: 'large', bonuses: 100000, money: 50000 }
    ]
  },

  depot: {
    levels: [1500, 2500, 4000, 6000, 9000, 13000, 18000, 25000, 35000, 50000],
    deliveryFrac: 0.02,
    upgradeCosts: [30000, 55000, 100000, 180000, 320000, 580000, 1050000, 1900000, 3400000]
  },

  /** Вместимость одного рейса бензовоза (отдельная ветка прокачки) */
  tankerTruck: {
    levels: [1000, 1500, 2250, 3250, 4750, 6750, 9500, 13000, 16500, 20000],
    upgradeCosts: [80000, 160000, 320000, 640000, 1280000, 2560000, 5120000, 10240000, 20480000]
  },

  /** Автопарк — макс. число бензовозов */
  fleet: {
    maxCount: [1, 2, 3],
    upgradeCosts: [500000, 1500000]
  },

  logistics: {
    prepDuration: 20
  },

  canisterReserve: {
    cost: 45000,
    cap: 100,
    cooldown: 30,
    refillRate: 10
  },

  gbrAutoCall: { cost: 50000 },

  station: {
    cost: 12600,
    startFill: 0.5,
    resLevels: [280, 420, 600, 800, 1000],
    resCosts:  [5400, 8550, 13500, 20700],
    minReserve: 5,
    pocketMax: 5,
    pocketMaxWait: 40
  },
  pump: {
    rates:   [8, 10.5, 13.5, 17, 21],
    upCosts: [8100, 13500, 22500, 36000],
    bufferFrac: 0.05,
    bufferFillTime: 10,
    fastMult: 2,
    maxPerStation: 5,
    queueMax: 4,
    queueSpeed: 42
  },
  fuelUnlock: { base: 14400, growth: 2.3 },
  addPump: {
    base: 15300,
    countGrowth: 1.6,
    fuelGrowth: 1.3
  },

  tanker: {
    stationRate: 100,
    depotRate: 250,
    speed: 52, len: 40
  },

  gbr: {
    towTime: 5,
    returnSpeed: 60,
    accel: 120, brake: 180,
    len: 22,
    visionRadius: 500,
    patrolMaxLaps: 5,
    chaseFollowDist: 14,
    arrestDist: 22,
    /** Приоритетное движение только в CHASE */
    chaseDrive: {
      gapMin: 1.5,
      overtakeTrigger: 90,
      overtakeDur: 1.35,
      outerAheadPad: 4,
      outerBehindPad: 8
    }
  },

  gbrBase: {
    baseCallCost: 5000,
    prepDuration: 10,
    speeds: [100, 100, 100, 100, 100, 110, 120, 130, 140, 150],
    upgradeCosts: [50000, 125000, 250000, 500000, 1250000, 2500000, 5000000, 10000000, 20000000]
  },

  scalper: {
    spawnIntervalMult: 10,
    speed: 64,
    accel: 45, brake: 100,
    len: 23,
    color: '#ab47bc',
    baseMaxLiters: 100,
    evolutionStep: 500,
    evolutionBonus: 50,
    fillRate: 25,
    retryChance: 0.2,
    /** Выход с карты (EXITING) — независимо от updateLane */
    exitSpeed: 55,
    exitArriveDist: 12,
    exitMaxTime: 35,
    exitStallMax: 1.0,
    exitMinStep: 3
  },

  follow: {
    gapMin: 7,
    gapK: 1.6,
    reactMin: 0.28,
    reactMax: 0.55,
    emergencyGap: 12,
    overtakeTrigger: 22,
    overtakeDur: 2.8
  },

  ui: { tapRadius: 48, tankLabelTime: 3 }
};
