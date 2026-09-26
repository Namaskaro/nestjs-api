/**
 * Создаёт deterministic identity key
 * для точного сопоставления текстовых goals.
 *
 * Нормализация устраняет только
 * технические различия представления:
 *
 * - Unicode compatibility form;
 * - регистр;
 * - пробелы по краям;
 * - повторные внутренние whitespace.
 *
 * ВАЖНО:
 *
 * это НЕ semantic equivalence.
 *
 * Например:
 *
 * "долгие прогулки"
 * "много ходить пешком"
 *
 * останутся разными goals.
 */
export function normalizeConsultationGoalText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
