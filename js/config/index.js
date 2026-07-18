import { balance } from './balance.js';
import { levels, endless } from './levels.js';

export const CONFIG = { ...balance, levels, endless };
CONFIG.pump.bufferMax = function () {
  return CONFIG.station.resLevels[CONFIG.station.resLevels.length - 1] * this.bufferFrac;
};
