/** Единый источник версии и списка изменений текущего патча */

export const GameVersion = {
  version: '0.4.2.5',
  buildStamp: '2026-07-26T13:30:00Z',
  changes: [
    'Scalper не спавнится в последние 10/20 машин уровня',
    'Исправлен зависший QUEUE/OWNER:STATION после срыва заезда',
    'Timeout подхода к карману АЗС для Scalper',
    'Уже существующий Scalper после порога доживает lifecycle'
  ],
  architectureDoc: 'ARCHITECTURE_NOTES.md'
};
