/** Numeric balance parameters — все суммы в рублях (₽) */
export const balance = {
  defeatTime: 10,
  /** Таймер поражения при невозможности заказать топливо (v0.4.3.3) */
  fuelCrisisTime: 8,
  truckUnlockAt: 30,
  giveUpLaps: 2,
  needMin: 0.65,
  needMax: 0.9,
  bgTrafficEnabled: false,

  holder: { max: 5, gap: 20 },
  trafficLight: { redDur: 10, cooldown: 60 },
  overtake: { chance: 0.32 },
  /** Политика полос v0.4.4.1 (ПДД РФ: не занимать «левую» без нужды) */
  lanePolicy: {
    /** Въезд всегда на exitLane (L2), затем merge внутрь */
    entryOnExitLane: true,
    /** Сек. между попытками merge L2→L1→L0 */
    mergeRetry: 0.85,
    /** Сек. за медленным лидером до разрешения уйти на L2 */
    overtakePatience: 2.4,
    /** Шанс начать возврат с L2 при свободных L1/L0 */
    returnInChance: 0.45
  },
  visual: { pocketDur: 0.75, pullInDur: 0.7, pullOutDur: 0.65 },

  road: {
    /** Число полноценных полос (v0.4.4 = 3; параметр для будущего 4+) */
    laneCount: 3,
    laneWidth: 15,
    marginX: 46,
    marginTop: 70,
    marginBottom: 56,
    cornerR: 64,
    serviceLat: 30,
    pumpDepth: 14,
    /** Fallback / UI marking; фактический spacing очереди — по len + safety */
    queueGap: 21,
    queueSafetyGap: 4,
    stationTankLat: 48,
    approachOffset: 12,
    decelLen: 24,
    accelLen: 20,
    pocketLat: 38,
    pocketGap: 18,
    pocketSafetyGap: 4,
    pocketDepth: 70,
    pocketGrabDist: 36,
    pocketForceTime: 1.5,
    apronDepth: 100,
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
    diesel: { name: 'Дизель', short: 'ДТ', color: '#6d4c41', price: 104 }
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
    /** v0.4.2.4: бонусами ≤ 99% стоимости; минимум 1% всегда деньгами */
    bonusShareStation: 0.99,
    bonusShareDepot: 0.99
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
    /** Euclidean fallback / station catch; road arrest prefers cut-off block */
    arrestDist: 22,
    /** Глобальный cooldown между фактическими выездами экипажей (v0.4.3) */
    departCooldown: 5,
    /**
     * Уровни базы, на которых интервал выезда −1 с каждый (v0.4.3.1).
     * V → 4с, VIII → 3с, X → 2с. Не влияет на prepDuration.
     */
    departCooldownReductionLevels: [5, 8, 10],
    /** Приоритетное движение только в CHASE (мигалка вкл.) — v0.4.4.2 */
    chaseDrive: {
      gapMin: 1.5,
      overtakeTrigger: 90,
      overtakeDur: 1.15,
      /** Обычный clearance на целевой полосе (ослаблен vs 0.4.4) */
      outerAheadPad: 14,
      outerBehindPad: 12,
      /** Force-обгон в плотном потоке — ещё короче */
      forceAheadPad: 8,
      forceBehindPad: 6,
      forceOvertakeGap: 55,
      /** Bumper-cap при упёртости в не-цель (было жёстко 0.35) */
      bumperCapFrac: 0.88,
      bumperLeadSlack: 14,
      /** Доля ширины полосы: ниже — ещё конфликтуем по lat с исходным лидером (COLL-002) */
      safeLatFrac: 0.55,
      /** NPC уступает CHASE GBR вправо, если свободно */
      yieldLookBack: 70,
      yieldLookAhead: 40,
      /** Подрезание цели → ARREST (дорога) */
      cutOff: {
        /** Начать манёвр обгона/подрезания, когда цель впереди ближе этого */
        passBehind: 70,
        /** Насколько выехать вперёд цели перед врезанием в её полосу */
        passAhead: 16,
        /** Макс. кольцевой выигрыш «ГБР впереди», чтобы считать блок */
        blockAheadMax: 26,
        /** Допуск, если чуть сзади / overlap */
        blockBehindSlop: 5,
        /** Сек. удержания блока до старта ARREST (0 = сразу при блоке+близости) */
        holdSec: 0.25,
        /** Свободная полоса: период между попытками lane shift */
        lanePickRetry: 0.35
      }
    }
  },

  gbrBase: {
    baseCallCost: 5000,
    /**
     * Стоимость следующего выпуска по числу экипажей ON_MISSION (v0.4.3.1).
     * index = count ON_MISSION перед выпуском. RETURNING/PREPARING/READY не считаются.
     */
    callCostsByOnMission: [
      5000, 5000, 5000, 6000, 7000, 8000, 10000, 12000, 15000, 20000
    ],
    /** Первичная и пост-рейд подготовка каждого экипажа (параллельно) */
    prepDuration: 20,
    speeds: [100, 100, 100, 100, 100, 110, 120, 130, 140, 150],
    /** I→II … IX→X (v0.4.3.1) */
    upgradeCosts: [40000, 100000, 200000, 500000, 700000, 900000, 1500000, 2600000, 5000000]
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
    /** Страховка: слишком долгий подход к карману АЗС (v0.4.2.5) */
    pocketApproachMax: 40,
    /** Выход с карты (EXITING) — независимо от updateLane */
    exitSpeed: 55,
    exitArriveDist: 12,
    exitMaxTime: 35,
    exitStallMax: 1.0,
    exitMinStep: 3,
    /**
     * v0.4.4.1: spawn без АЗС (undercover). Несколько Scalper — только budget.
     * Спец-despawn без АЗС НЕ вводим — копятся как трафик.
     */
    undercoverWithoutStation: true
  },

  follow: {
    gapMin: 7,
    /** Минимальный bumper после soft-snap (COLL-001): лидер не теряется */
    bumperFloor: 0.75,
    gapK: 1.6,
    reactMin: 0.28,
    reactMax: 0.55,
    emergencyGap: 12,
    overtakeTrigger: 22,
    overtakeDur: 2.8,
    /** Макс. перемещение за tick (доля len) — anti-tunnel / anti stall-jump */
    maxStepLenFrac: 0.45,
    laneChangeDur: 1.1
  },

  /** v0.4.5 — язык тела машин (не полная физика) */
  motionFeel: {
    laneSteer: 0.32,
    overtakeSteerOut: 0.38,
    overtakeSteerPass: 0.2,
    steerLerp: 10,
    rollFromSteer: 0.55,
    rollLerp: 8,
    /** Торможение: порог ускорения (px/s²) и сила клевка */
    brakeAccel: -28,
    brakeDipScale: 90,
    brakeLerp: 12
  },

  ui: { tapRadius: 48, tankLabelTime: 3 }
};
