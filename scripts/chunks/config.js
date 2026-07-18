const CONFIG = {
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
    forcePullInDist: 28
  },

  // Типы машин: len/w — габариты, maxV — скорость (px/с), tank — бак (л)
  carTypes: {
    sedan: { name: 'Легковая',    len: 19, w: 9,  maxV: 78, accel: 55, brake: 115, tank: 30 },
    suv:   { name: 'Внедорожник', len: 23, w: 10, maxV: 64, accel: 45, brake: 100, tank: 55 },
    truck: { name: 'Фура',        len: 36, w: 11, maxV: 46, accel: 28, brake: 80,  tank: 130 }
  },

  // Виды топлива: price — доход $/литр, short — подпись
  fuels: {
    a92:    { name: 'АИ-92',  short: '92', color: '#4caf50', price: 1.0 },
    a95:    { name: 'АИ-95',  short: '95', color: '#42a5f5', price: 1.25 },
    diesel: { name: 'Дизель', short: 'ДТ', color: '#ff9800', price: 1.15 }
  },
  truckPayMult: 1.5,
  canister: { prob: 0.30, red: 10, green: 20 },

  depot: {
    levels: [1500, 3500, 7000],
    deliveryFrac: 0.02,
    upgradeCosts: [400, 900]
  },

  canisterReserve: {
    cost: 500,
    cap: 100,
    cooldown: 30,
    refillRate: 10,
    pricePerLiter: 1.4
  },

  station: {
    cost: 140,
    startFill: 0.5,
    resLevels: [280, 420, 600, 800, 1000],
    resCosts:  [60, 95, 150, 230],
    minReserve: 5,
    pocketMax: 5,
    pocketMaxWait: 40
  },
  pump: {
    rates:   [8, 10.5, 13.5, 17, 21],         // скорость заправки л/с, ур.1–5 (у каждой колонки свой)
    upCosts: [90, 150, 250, 400],             // цена уровней 2–5 (дороже резервуара)
    bufferFrac: 0.05,                         // буфер колонки = 5% от МАКС. резервуара
    bufferMax() { return CONFIG.station.resLevels[CONFIG.station.resLevels.length - 1] * this.bufferFrac; },
    bufferFillTime: 10,                       // полное заполнение буфера, сек (когда колонка свободна)
    fastMult: 2,                              // множитель скорости, пока топливо идёт из буфера
    maxPerStation: 5,                         // максимум колонок на АЗС
    queueMax: 4,                              // 1 обслуживается + 3 ждут
    queueSpeed: 42                            // скорость продвижения по территории АЗС, px/с
  },
  fuelUnlock: { base: 160, growth: 2.3 },     // разблокировка топлива: 160, 370 (экспонента)
  addPump: {                                  // новая колонка — самое дорогое улучшение:
    base: 170,                                // растёт и от числа колонок,
    countGrowth: 1.6,                         // и от числа открытых видов топлива
    fuelGrowth: 1.3
  },

  tanker: {
    cost: 150,
    cooldown: 45,
    stationRate: 100,
    depotRate: 250,
    speed: 52, len: 40
  },

  gbr: {
    cost: 0,
    cooldown: 20,
    towTime: 5,
    speed: 100,
    towSpeed: 30,
    accel: 120, brake: 180,
    len: 22
  },

  scalper: {
    speed: 64,
    accel: 45, brake: 100,
    len: 23,
    color: '#ab47bc',
    maxCanisters: 10,
    maxLiters: 150,
    litersPerCanister: 15,
    fillRate: 25,
    payPerLiter: 1.2
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

  ui: { tapRadius: 48, tankLabelTime: 3 },

  /* ---- КАМПАНИЯ: 5 уровней с нарастающей сложностью.
   * spawn: [интервал в начале, в конце]; canister: [вероятность в начале, в конце];
   * scalper: первый перекуп / интервалы; mix'ы — доли типов и топлива. ---- */
  levels: [
    { name: 'Уровень 1', duration: 150, startMoney: 320, spawn: [3.8, 2.2],
      typeMix: { start: { sedan: .65, suv: .30, truck: .05 }, end: { sedan: .55, suv: .30, truck: .15 } },
      fuelMix: { start: { a92: .60, a95: .30, diesel: .10 }, end: { a92: .45, a95: .35, diesel: .20 } },
      scalper: { firstAt: 60, intervalStart: 45, intervalEnd: 35 },
      canister: [0, .05] },
    { name: 'Уровень 2', duration: 180, startMoney: 320, spawn: [3.5, 1.8],
      typeMix: { start: { sedan: .60, suv: .30, truck: .10 }, end: { sedan: .50, suv: .30, truck: .20 } },
      fuelMix: { start: { a92: .55, a95: .30, diesel: .15 }, end: { a92: .40, a95: .32, diesel: .28 } },
      scalper: { firstAt: 50, intervalStart: 38, intervalEnd: 26 },
      canister: [.03, .09] },
    { name: 'Уровень 3', duration: 210, startMoney: 300, spawn: [3.2, 1.5],
      typeMix: { start: { sedan: .55, suv: .30, truck: .15 }, end: { sedan: .42, suv: .30, truck: .28 } },
      fuelMix: { start: { a92: .50, a95: .32, diesel: .18 }, end: { a92: .36, a95: .31, diesel: .33 } },
      scalper: { firstAt: 40, intervalStart: 32, intervalEnd: 20 },
      canister: [.05, .13] },
    { name: 'Уровень 4', duration: 240, startMoney: 300, spawn: [3.0, 1.3],
      typeMix: { start: { sedan: .50, suv: .30, truck: .20 }, end: { sedan: .38, suv: .30, truck: .32 } },
      fuelMix: { start: { a92: .45, a95: .33, diesel: .22 }, end: { a92: .32, a95: .30, diesel: .38 } },
      scalper: { firstAt: 35, intervalStart: 26, intervalEnd: 16 },
      canister: [.08, .17] },
    { name: 'Уровень 5', duration: 270, startMoney: 280, spawn: [2.8, 1.05],
      typeMix: { start: { sedan: .45, suv: .30, truck: .25 }, end: { sedan: .32, suv: .30, truck: .38 } },
      fuelMix: { start: { a92: .42, a95: .32, diesel: .26 }, end: { a92: .28, a95: .30, diesel: .42 } },
      scalper: { firstAt: 30, intervalStart: 22, intervalEnd: 12 },
      canister: [.10, .22] }
  ],

  /* ---- БЕСКОНЕЧНЫЙ РЕЖИМ: победы нет, сложность растёт постоянно.
   * rampTime — за сколько секунд mix'ы доходят до "конечных" значений;
   * интервал спавна продолжает падать и дальше, до minInterval. ---- */
  endless: {
    rampTime: 270, minInterval: 0.6, startMoney: 320, spawn: [3.4, 1.1],
    typeMix: { start: { sedan: .60, suv: .30, truck: .10 }, end: { sedan: .35, suv: .30, truck: .35 } },
    fuelMix: { start: { a92: .55, a95: .30, diesel: .15 }, end: { a92: .30, a95: .30, diesel: .40 } },
    scalper: { firstAt: 40, intervalStart: 30, intervalEnd: 12 },
    canister: [0, .25]
  }
