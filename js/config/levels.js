/** Campaign and endless mode definitions (v0.2.1 — progress by cars served) */
export const SPAWN_START_INTERVAL = 4.0;

export const levels = [
  { name: 'Уровень 1',  targetCars: 100, endInterval: 2.5,  startMoney: 28800,
    scalper: { firstAt: 60, intervalStart: 45, intervalEnd: 35 }, canister: [0, .05] },
  { name: 'Уровень 2',  targetCars: 140, endInterval: 2.2,  startMoney: 28800,
    scalper: { firstAt: 55, intervalStart: 40, intervalEnd: 30 }, canister: [.03, .09] },
  { name: 'Уровень 3',  targetCars: 190, endInterval: 2.0,  startMoney: 27000,
    scalper: { firstAt: 50, intervalStart: 36, intervalEnd: 26 }, canister: [.05, .13] },
  { name: 'Уровень 4',  targetCars: 250, endInterval: 1.8,  startMoney: 27000,
    scalper: { firstAt: 45, intervalStart: 32, intervalEnd: 22 }, canister: [.08, .17] },
  { name: 'Уровень 5',  targetCars: 320, endInterval: 1.6,  startMoney: 25200,
    scalper: { firstAt: 40, intervalStart: 28, intervalEnd: 18 }, canister: [.10, .22] },
  { name: 'Уровень 6',  targetCars: 400, endInterval: 1.45, startMoney: 25200,
    scalper: { firstAt: 38, intervalStart: 26, intervalEnd: 16 }, canister: [.12, .24] },
  { name: 'Уровень 7',  targetCars: 500, endInterval: 1.30, startMoney: 23400,
    scalper: { firstAt: 35, intervalStart: 24, intervalEnd: 14 }, canister: [.14, .26] },
  { name: 'Уровень 8',  targetCars: 620, endInterval: 1.20, startMoney: 23400,
    scalper: { firstAt: 32, intervalStart: 22, intervalEnd: 12 }, canister: [.16, .28] },
  { name: 'Уровень 9',  targetCars: 760, endInterval: 1.10, startMoney: 21600,
    scalper: { firstAt: 30, intervalStart: 20, intervalEnd: 11 }, canister: [.18, .30] },
  { name: 'Уровень 10', targetCars: 900, endInterval: 1.0,  startMoney: 21600,
    scalper: { firstAt: 28, intervalStart: 18, intervalEnd: 10 }, canister: [.20, .32] }
];

export const endless = {
  startMoney: 28800,
  baseTarget: 900,
  targetStep: 200,
  scalper: { firstAt: 25, intervalStart: 16, intervalEnd: 8 },
  canister: [0, .35]
};
