/** Единый источник версии и списка изменений текущего патча */

export const GameVersion = {
  version: '0.4.4',
  buildStamp: '2026-07-27T13:40:00Z',
  changes: [
    'Три полноценные полосы с 1 уровня (параметр laneCount)',
    'COLL-001: лидер при gap≤0 не теряется + bumperFloor',
    'COLL-002: soft-fix до безопасного latOff при обгоне',
    'EXITING Scalper в collision; без stall-jump',
    'GBR CHASE мигалка + yield вправо; PATROL/RETURNING без приоритета',
    'Очередь АЗС по длинам автомобилей'
  ],
  architectureDoc: 'ARCHITECTURE_NOTES.md'
};
