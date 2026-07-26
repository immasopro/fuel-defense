/** Единый источник версии и списка изменений текущего патча */

export const GameVersion = {
  version: '0.4.3.2',
  buildStamp: '2026-07-26T14:35:00Z',
  changes: [
    'FIX: GBR больше не телепортируется на базу после поимки у базы',
    'RETURNING завершается только по кольцевой дистанции (не Euclidean)',
    'Поимка сразу после базы — полный круг до PREPARING'
  ],
  architectureDoc: 'ARCHITECTURE_NOTES.md'
};
