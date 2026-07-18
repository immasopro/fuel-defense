/** Форматирование сумм в рублях (экономика полностью в ₽) */
export function fmtRub(n) {
  const v = Math.round(n);
  return '₽' + v.toLocaleString('ru-RU');
}

export function fmtRubDelta(n) {
  const sign = n >= 0 ? '+' : '−';
  return sign + fmtRub(Math.abs(n));
}
