const Game = {
  state: 'menu',
  mode: 'campaign', levelIdx: 1, modeCfg: null,
  money: 0, time: 0,
  depot: { level: 1, res: 1500, cap: 1500 },
  vehicles: [], holder: [], holderPriorityWait: null, prepared: null, floats: [],
  spawnTimer: 0, defeatT: 0,
  light: { phase: 'green', redT: 0, cd: 0 },
  scalperTimer: 0,
  tanker: { cd: 0, unit: null },
  gbr: { cd: 0, unit: null },
  scalper: { unit: null },
  stats: { served: 0, earned: 0, liters: 0 },
  tankLabels: {},   // slot.i → seconds left showing "XXXX / YYYY л"
  depotLabel: 0
