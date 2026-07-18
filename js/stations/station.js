import { CONFIG } from '../config/index.js';
import { Pump } from './pump.js';

class Station{
  constructor(fuel) {
    this.unlocked = [fuel];
    this.resLevel = 1;
    this.cap = CONFIG.station.resLevels[0];
    this.res = Math.round(this.cap * CONFIG.station.startFill);  // стартовая доля, далее — из нефтебазы
    this.pumps = [new Pump(fuel)];
    this.pocket = [];   // карман ожидания (до pocketMax машин)
    this.served = 0;
    this.slot = null;
    // резерв канистр (улучшение за $500)
    this.canisterUp = false;
    this.canRes = 0;
    this.canCap = CONFIG.canisterReserve.cap;
    this.canCd = 0;
    // автоматический вызов ГБР (улучшение за 50 000 ₽)
    this.gbrAutoCall = false;
    this.gbrAutoCallOn = false;
    this.gbrAlarm = 0; // таймер всплывающего сообщения над станцией
  }
}

export { Station };
