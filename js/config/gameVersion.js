/** Единый источник версии и списка изменений текущего патча */

export const GameVersion = {
  version: '0.4.2.2',
  buildStamp: '2026-07-25T23:15:00Z',
  changes: [
    'Кредит при заказе бензовоза возвращён в новое меню',
    'Единая проверка canOrderTanker для UI и callTanker(order)',
    'В меню: баланс и баланс после заказа; лимит задолженности',
    'Бонусы не покрывают стоимость топлива'
  ],
  architectureDoc: 'ARCHITECTURE_NOTES.md'
};
